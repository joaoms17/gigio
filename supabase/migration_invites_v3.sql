-- ============================================================
-- GIGIO — Convites v3: códigos renováveis, convites por link e
-- validação no servidor
-- Colar em: Supabase > SQL Editor > New query > Run
-- Corre tudo de uma vez. Seguro re-correr (idempotente).
--
-- Ordem: depois de schema.sql → migration_bands.sql →
--        fix_rls_recursion.sql → migration_v2.sql →
--        migration_project_images.sql
--
-- Testado numa Postgres a sério (PGlite) com:
--   node scripts/test-invites-sql.mjs
-- ============================================================
--
-- Problemas que resolve ("Código de convite expirou…"):
--  1. bands.invite_expires_at = data de CRIAÇÃO + 7 dias e nada o renovava
--     → o código de qualquer projeto com mais de uma semana estava expirado.
--     Agora: dono/admin prolonga (30 dias) ou gera um código novo, e os
--     códigos já expirados são prolongados já (secção 9).
--  2. Convites por link (project_invites): a policy de leitura consultava
--     auth.users, que o papel "authenticated" não pode ler → "permission
--     denied" → o convite aparecia inválido (e a lista de convites
--     pendentes do dono vinha vazia). Agora usa o email do JWT, e o ecrã
--     de aceitar usa get_project_invite().
--  3. O convidado não podia marcar o convite como aceite (a policy de
--     UPDATE é só de quem convidou) → ficava "pending" para sempre.
--     Agora: accept_project_invite().
--  4. Segurança: qualquer conta inseria-se em qualquer projeto sem código
--     (band_members_insert) e lia todas as bandas, incluindo o invite_code
--     (bands_select). Agora só se entra pelos RPCs e só membros/dono veem
--     a banda. Também:
--       - um convite só pode ser criado/alterado por quem gere o projeto,
--         e só o estado muda (antes, quem convidou podia mudar o project_id
--         do próprio convite para um projeto alheio e aceitá-lo como admin);
--       - limite de tentativas com códigos errados (força bruta);
--       - códigos únicos depois de normalizados ("ABCD1234" = "ABCD-1234").
--  5. Mudar o papel / o instrumento no separador Membros não fazia nada
--     (band_members não tinha policy de UPDATE). Agora: set_member_role()
--     e cada membro muda o próprio instrumento.
--
-- Erros dos RPCs: a "message" é uma chave estável que o cliente
-- (src/lib/invites.ts) traduz; o "hint" traz o texto em pt-PT.
--   not_authenticated · invalid_code · expired · already_member (detail =
--   id do projeto) · rate_limited · invalid_token · revoked ·
--   already_accepted · not_found · forbidden · invalid_role ·
--   code_generation_failed
-- Nota: join_project_with_code devolve NULL (não lança erro) quando o
-- código não existe — um erro desfazia o registo da tentativa falhada,
-- e o limite de tentativas deixava de contar.
-- ============================================================


-- ---------- 1. COLUNAS / TABELAS / DEFAULTS ----------

-- Quem aceitou cada convite por link, e quando
alter table public.project_invites add column if not exists accepted_by uuid references public.profiles(id) on delete set null;
alter table public.project_invites add column if not exists accepted_at timestamptz;

-- Projetos novos: código válido 30 dias (era 7, contados da criação)
alter table public.bands alter column invite_expires_at set default (now() + interval '30 days');

-- Tentativas falhadas com códigos de convite (limite contra força bruta).
-- Sem policies: só os RPCs (SECURITY DEFINER) lhe tocam.
create table if not exists public.invite_code_attempts (
  user_id uuid        not null,
  code    text        not null,
  at      timestamptz not null default now()
);
create index if not exists invite_code_attempts_user_at_idx on public.invite_code_attempts (user_id, at);
alter table public.invite_code_attempts enable row level security;
revoke all on public.invite_code_attempts from public, anon, authenticated;


-- ---------- 2. FUNÇÕES AUXILIARES ----------

-- Dono ou admin do projeto (SECURITY DEFINER → não dispara RLS → sem recursão)
create or replace function public.is_band_manager(_band_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from bands where id = _band_id and owner_id = _user_id)
      or exists (
        select 1 from band_members
        where band_id = _band_id and user_id = _user_id and role in ('owner', 'admin')
      );
$$;

-- "jzbr-4829", "JZBR4829", " jzbr 4829 " → "JZBR4829" (só A-Z0-9, maiúsculas)
create or replace function public.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Ordem dos papéis (para nunca baixar o papel de quem já é membro)
create or replace function public.project_role_rank(_role text)
returns int
language sql
immutable
set search_path = public
as $$
  select case _role
    when 'owner'  then 4
    when 'admin'  then 3
    when 'editor' then 2
    when 'viewer' then 1
    else 0
  end;
$$;

-- Mesmo formato de sempre ("ABCD-1234": 4 letras do nome + 4 dígitos), mas
-- os dígitos vêm do gerador criptográfico (gen_random_uuid) e não de random()
create or replace function public.gen_band_invite_code(_name text)
returns text
language plpgsql
volatile
as $$
declare
  letters text;
  n bigint;
begin
  letters := upper(substring(regexp_replace(coalesce(_name, ''), '[^a-zA-Z]', '', 'g') from 1 for 4));
  if length(letters) < 4 then letters := rpad(letters, 4, 'X'); end if;
  n := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint;
  return letters || '-' || lpad((n % 10000)::text, 4, '0');
end;
$$;

-- Limite de tentativas: no máximo 10 códigos ERRADOS (distintos) por hora
-- e por conta. Serializa os pedidos do mesmo utilizador (pedidos em
-- paralelo não contornam a contagem). Só os RPCs chamam isto.
create or replace function public.invite_code_guard(_uid uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  v_fails int;
begin
  perform pg_advisory_xact_lock(hashtext('gigio.invite_code'), hashtext(_uid::text));
  select count(distinct a.code) into v_fails
  from invite_code_attempts a
  where a.user_id = _uid and a.at > now() - interval '1 hour';
  if v_fails >= 10 then
    raise exception using message = 'rate_limited',
      hint = 'Demasiadas tentativas com códigos errados. Espera um pouco e tenta outra vez.';
  end if;
end;
$$;

create or replace function public.note_invite_code_failure(_uid uuid, _code text)
returns void
language sql
volatile
set search_path = public
as $$
  delete from invite_code_attempts where user_id = _uid and at < now() - interval '1 day';
  insert into invite_code_attempts (user_id, code) values (_uid, _code);
$$;


-- ---------- 3. CÓDIGOS ÚNICOS (depois de normalizados) ----------
-- Antes: a unique comparava o texto cru, e "OSTR7219" ≠ "OSTR-7219" →
-- outro dono podia pôr no projeto dele o código da Ana sem hífen e
-- desviar para lá quem escrevesse o código dela.

-- 3a. Desfaz colisões que já existam: fica com o código quem o tem no
--     formato oficial (o gerado pela app), depois o projeto mais antigo;
--     os outros recebem um código novo.
do $$
declare
  r      record;
  v_code text;
  v_try  int;
begin
  for r in
    select d.id, d.name
    from (
      select b.id, b.name,
             row_number() over (
               partition by public.normalize_invite_code(b.invite_code)
               order by (b.invite_code ~ '^[A-Z]{4}-[0-9]{4}$') desc, b.created_at, b.id
             ) as rn
      from public.bands b
    ) d
    where d.rn > 1
  loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      v_code := public.gen_band_invite_code(r.name);
      exit when not exists (
        select 1 from public.bands b
        where public.normalize_invite_code(b.invite_code) = public.normalize_invite_code(v_code)
      );
      if v_try > 100 then
        raise exception 'Não foi possível desfazer códigos de convite repetidos (projeto %)', r.id;
      end if;
    end loop;
    update public.bands set invite_code = v_code where id = r.id;
  end loop;
end $$;

-- 3b. Nunca mais dois projetos com o mesmo código (com ou sem hífen)
create unique index if not exists bands_invite_code_norm_key
  on public.bands (public.normalize_invite_code(invite_code));

-- 3c. Projeto novo: código no formato oficial e que ainda não exista.
--     SECURITY DEFINER para ver os códigos de TODOS os projetos (a RLS
--     de bands só mostra os do próprio).
create or replace function public.handle_band_invite_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_try int := 0;
begin
  if new.invite_code is null
     or new.invite_code !~ '^[A-Z]{4}-[0-9]{4}$'
     or exists (select 1 from bands b
                where public.normalize_invite_code(b.invite_code) = public.normalize_invite_code(new.invite_code)) then
    loop
      v_try := v_try + 1;
      new.invite_code := public.gen_band_invite_code(new.name);
      exit when v_try >= 20 or not exists (
        select 1 from bands b
        where public.normalize_invite_code(b.invite_code) = public.normalize_invite_code(new.invite_code)
      );
    end loop;
  end if;
  return new;
end;
$$;

-- 3d. Alterar o código: só no formato oficial "ABCD-1234"
create or replace function public.guard_band_invite_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.invite_code is distinct from old.invite_code
     and (new.invite_code is null or new.invite_code !~ '^[A-Z]{4}-[0-9]{4}$') then
    raise exception using errcode = '22023', message = 'invalid_code_format',
      hint = 'O código de convite tem de ter o formato ABCD-1234.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_band_invite_code_update on public.bands;
create trigger on_band_invite_code_update
  before update of invite_code on public.bands
  for each row execute function public.guard_band_invite_code();


-- ---------- 4. POLICIES ----------

-- 4a. Convites por link: email do JWT em vez de auth.users (bug 2)
drop policy if exists "project_invites_select" on public.project_invites;
create policy "project_invites_select" on public.project_invites for select
  using (
    invited_by = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_band_manager(project_id, auth.uid())
  );

-- 4b. Convites: criar/alterar/apagar só quem GERE o projeto — no USING e
--     no WITH CHECK. A policy antiga de UPDATE só tinha USING
--     (invited_by = auth.uid()), e quem convidou podia mudar o project_id
--     do próprio convite para um projeto alheio e aceitá-lo como admin.
drop policy if exists "project_invites_insert" on public.project_invites;
create policy "project_invites_insert" on public.project_invites for insert
  with check (invited_by = auth.uid() and public.is_band_manager(project_id, auth.uid()));

drop policy if exists "project_invites_update" on public.project_invites;
create policy "project_invites_update" on public.project_invites for update
  using (public.is_band_manager(project_id, auth.uid()))
  with check (public.is_band_manager(project_id, auth.uid()));

drop policy if exists "project_invites_delete" on public.project_invites;
create policy "project_invites_delete" on public.project_invites for delete
  using (public.is_band_manager(project_id, auth.uid()));

-- …e do convite só se muda o estado (revogar). Projeto, papel, token e
-- quem convidou ficam fixos.
revoke update on public.project_invites from anon, authenticated;
grant update (status, updated_at) on public.project_invites to authenticated;

-- 4c. Bandas: só membros e dono (o "entrar com código" usa peek_project_code)
drop policy if exists "bands_select_by_invite" on public.bands;  -- de fix_band_rls.sql
drop policy if exists "bands_select" on public.bands;
create policy "bands_select" on public.bands for select
  using (owner_id = auth.uid() or public.is_band_member(id, auth.uid()));

-- 4d. Membros: inserção direta só do próprio DONO no seu projeto.
--     Toda a gente entra por join_project_with_code / accept_project_invite.
--     (O dono já é inserido pelo trigger on_band_created, SECURITY DEFINER.)
drop policy if exists "band_members_insert" on public.band_members;
create policy "band_members_insert" on public.band_members for insert
  with check (user_id = auth.uid() and public.is_band_owner(band_id, auth.uid()));

-- 4e. Membros: cada um muda o PRÓPRIO instrumento (antes não havia policy
--     de UPDATE e a alteração não fazia nada). O papel muda-se com
--     set_member_role().
drop policy if exists "band_members_update_self" on public.band_members;
create policy "band_members_update_self" on public.band_members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke update on public.band_members from anon, authenticated;
grant update (instrument) on public.band_members to authenticated;


-- ---------- 5. RPCs: CÓDIGO DE CONVITE ----------
-- (drop + create: permite mudar o tipo de retorno)

-- Espreitar um código: só metadados públicos do projeto (nunca membros nem
-- o código). O id só vem se o código estiver válido ou se quem pergunta já
-- for membro (is_member — só sobre quem chama).
drop function if exists public.peek_project_code(text);
create function public.peek_project_code(p_code text)
returns table (id uuid, name text, type text, color text, image_url text, expired boolean, is_member boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_code text := public.normalize_invite_code(p_code);
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated',
      hint = 'Inicia sessão para usar um código de convite.';
  end if;

  -- Vazio / lixo → nenhum resultado (o cliente usa isto como sonda do RPC)
  if length(v_code) not between 4 and 16 then
    return;
  end if;

  perform public.invite_code_guard(v_uid);

  return query
    select case when b.invite_expires_at >= now() or public.is_band_member(b.id, v_uid) then b.id end,
           b.name, b.type, b.color, b.image_url,
           (b.invite_expires_at < now()),
           public.is_band_member(b.id, v_uid)
    from public.bands b
    where public.normalize_invite_code(b.invite_code) = v_code
    limit 1;

  if not found then
    perform public.note_invite_code_failure(v_uid, v_code);
  end if;
end;
$$;

-- Entrar num projeto com o código → devolve o id do projeto, ou NULL se o
-- código não existir (ver nota no cabeçalho)
drop function if exists public.join_project_with_code(text);
create function public.join_project_with_code(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := public.normalize_invite_code(p_code);
  v_band public.bands%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated',
      hint = 'Inicia sessão para usar um código de convite.';
  end if;

  if length(v_code) not between 4 and 16 then
    return null;
  end if;

  perform public.invite_code_guard(v_uid);

  select b.* into v_band
  from public.bands b
  where public.normalize_invite_code(b.invite_code) = v_code
  limit 1;

  if not found then
    perform public.note_invite_code_failure(v_uid, v_code);
    return null;  -- invalid_code (sem erro, para a tentativa ficar registada)
  end if;

  -- Já é membro: não mexe no papel (o cliente abre o projeto)
  if exists (select 1 from public.band_members m where m.band_id = v_band.id and m.user_id = v_uid) then
    raise exception using message = 'already_member', detail = v_band.id::text,
      hint = 'Já és membro deste projeto.';
  end if;

  if v_band.invite_expires_at < now() then
    raise exception using message = 'expired',
      hint = 'Este código expirou. Pede ao dono do projeto para o renovar.';
  end if;

  -- Mesmo papel que o cliente usava ao entrar por código: 'editor'
  insert into public.band_members (band_id, user_id, role)
  values (v_band.id, v_uid, 'editor')
  on conflict (band_id, user_id) do nothing;

  if not found then  -- corrida: entrou noutro separador entretanto
    raise exception using message = 'already_member', detail = v_band.id::text,
      hint = 'Já és membro deste projeto.';
  end if;

  return v_band.id;
end;
$$;

-- Gerar um código novo (o antigo deixa de funcionar) — só dono/admin
drop function if exists public.regenerate_project_code(uuid);
create function public.regenerate_project_code(p_band_id uuid)
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_band public.bands%rowtype;
  v_code text;
  v_try  int := 0;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated',
      hint = 'Inicia sessão.';
  end if;

  select b.* into v_band from public.bands b where b.id = p_band_id for update;
  if not found then
    raise exception using message = 'not_found', hint = 'Projeto não encontrado.';
  end if;

  if not public.is_band_manager(p_band_id, v_uid) then
    raise exception using errcode = '42501', message = 'forbidden',
      hint = 'Só o dono ou um admin podem renovar o código.';
  end if;

  -- Mesmo formato de sempre (gen_band_invite_code: "ABCD-1234"); repete
  -- se calhar o código atual ou um código de outro projeto
  loop
    v_try := v_try + 1;
    if v_try > 50 then
      raise exception using message = 'code_generation_failed',
        hint = 'Não foi possível gerar um código novo. Tenta outra vez.';
    end if;

    v_code := public.gen_band_invite_code(v_band.name);
    continue when exists (
      select 1 from public.bands b2
      where public.normalize_invite_code(b2.invite_code) = public.normalize_invite_code(v_code)
    );

    begin
      update public.bands b
         set invite_code = v_code,
             invite_expires_at = now() + interval '30 days',
             updated_at = now()
       where b.id = p_band_id;
      exit;
    exception when unique_violation then
      null;  -- outro projeto apanhou o mesmo código no mesmo instante: tenta outro
    end;
  end loop;

  return query
    select b.invite_code, b.invite_expires_at from public.bands b where b.id = p_band_id;
end;
$$;

-- Prolongar o código atual por 30 dias (mantém o código) — só dono/admin
drop function if exists public.extend_project_code(uuid);
create function public.extend_project_code(p_band_id uuid)
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated',
      hint = 'Inicia sessão.';
  end if;

  if not exists (select 1 from public.bands b where b.id = p_band_id) then
    raise exception using message = 'not_found', hint = 'Projeto não encontrado.';
  end if;

  if not public.is_band_manager(p_band_id, v_uid) then
    raise exception using errcode = '42501', message = 'forbidden',
      hint = 'Só o dono ou um admin podem prolongar o código.';
  end if;

  update public.bands b
     set invite_expires_at = greatest(b.invite_expires_at, now() + interval '30 days'),
         updated_at = now()
   where b.id = p_band_id;

  return query
    select b.invite_code, b.invite_expires_at from public.bands b where b.id = p_band_id;
end;
$$;


-- ---------- 6. RPCs: CONVITES POR LINK (project_invites) ----------

-- Dados do convite + projeto para o ecrã de aceitar. Não devolve o email
-- convidado nem o token (o token secreto do link basta para aceitar).
-- my_role: o papel de QUEM PERGUNTA no projeto (ou null) — para o ecrã
-- não oferecer "aceitar" a quem já é membro e não ganha nada com isso.
-- Convites pendentes de quem já não gere o projeto não contam.
drop function if exists public.get_project_invite(text);
create function public.get_project_invite(p_token text)
returns table (
  id uuid,
  project_id uuid,
  role text,
  status text,
  expires_at timestamptz,
  expired boolean,
  already_member boolean,
  my_role text,
  project_name text,
  project_type text,
  project_color text,
  project_description text,
  project_image_url text,
  invited_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated',
      hint = 'Inicia sessão para aceitar o convite.';
  end if;

  if coalesce(length(p_token), 0) < 16 then
    return;
  end if;

  return query
    select i.id, i.project_id, i.role, i.status, i.expires_at,
           (i.status = 'expired' or (i.status = 'pending' and i.expires_at < now())),
           public.is_band_member(i.project_id, v_uid),
           (select m.role from public.band_members m where m.band_id = i.project_id and m.user_id = v_uid),
           b.name, b.type, b.color, b.description, b.image_url,
           p.display_name
    from public.project_invites i
    join public.bands b on b.id = i.project_id
    left join public.profiles p on p.id = i.invited_by
    where i.token = p_token
      and (i.status <> 'pending'
           or (i.invited_by is not null and public.is_band_manager(i.project_id, i.invited_by)))
    limit 1;
end;
$$;

-- Aceitar um convite por link → devolve o id do projeto.
-- Não exige que o email coincida (o token secreto chega). Nunca baixa o
-- papel de quem já é membro; sobe-o se o convite der um papel maior.
-- Quem já é membro e não ganha nada com o convite (ex.: o dono a testar o
-- link) abre o projeto SEM gastar o convite — continua pendente para quem
-- foi convidado.
drop function if exists public.accept_project_invite(text);
create function public.accept_project_invite(p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.project_invites%rowtype;
  v_mem public.band_members%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated',
      hint = 'Inicia sessão para aceitar o convite.';
  end if;

  select i.* into v_inv
  from public.project_invites i
  where i.token = p_token and coalesce(length(p_token), 0) >= 16
  for update;

  if not found then
    raise exception using message = 'invalid_token',
      hint = 'Convite inválido ou já utilizado.';
  end if;

  if v_inv.status = 'revoked' then
    raise exception using message = 'revoked', hint = 'Este convite foi revogado.';
  end if;

  if v_inv.status = 'accepted' then
    -- Duplo toque / voltar a abrir o link: quem aceitou entra na mesma
    if v_inv.accepted_by = v_uid
       or (v_inv.accepted_by is null and public.is_band_member(v_inv.project_id, v_uid)) then
      return v_inv.project_id;
    end if;
    raise exception using message = 'already_accepted', hint = 'Este convite já foi aceite.';
  end if;

  -- Defesa em profundidade: um convite só vale se quem convidou ainda
  -- gere o projeto (apanha convites adulterados antes desta migração e
  -- convites de admins que entretanto deixaram de o ser)
  if v_inv.invited_by is null or not public.is_band_manager(v_inv.project_id, v_inv.invited_by) then
    raise exception using message = 'invalid_token',
      hint = 'Convite inválido ou já utilizado.';
  end if;

  if v_inv.status = 'expired' or v_inv.expires_at < now() then
    raise exception using message = 'expired',
      hint = 'Este convite expirou. Pede um convite novo a quem te convidou.';
  end if;

  select m.* into v_mem
  from public.band_members m
  where m.band_id = v_inv.project_id and m.user_id = v_uid
  for update;

  if found and v_mem.status = 'active'
     and public.project_role_rank(v_inv.role) <= public.project_role_rank(v_mem.role) then
    return v_inv.project_id;  -- já é membro e não ganha nada: não gasta o convite
  end if;

  if not found then
    insert into public.band_members (band_id, user_id, role)
    values (v_inv.project_id, v_uid, v_inv.role)
    on conflict (band_id, user_id) do nothing;
  else
    update public.band_members m
       set role = case
                    when public.project_role_rank(v_inv.role) > public.project_role_rank(m.role)
                    then v_inv.role else m.role
                  end,
           status = 'active'
     where m.band_id = v_inv.project_id and m.user_id = v_uid;
  end if;

  update public.project_invites i
     set status = 'accepted',
         accepted_by = v_uid,
         accepted_at = now(),
         updated_at = now()
   where i.id = v_inv.id;

  return v_inv.project_id;
end;
$$;


-- ---------- 7. RPC: PAPEL DE UM MEMBRO ----------

-- Dono/admin muda o papel de outro membro (admin · editor · viewer).
-- Nunca mexe no dono, nunca promove a dono, e ninguém muda o próprio papel.
drop function if exists public.set_member_role(uuid, uuid, text);
create function public.set_member_role(p_band_id uuid, p_user_id uuid, p_role text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_target text;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated',
      hint = 'Inicia sessão.';
  end if;

  if p_role is null or p_role not in ('admin', 'editor', 'viewer') then
    raise exception using errcode = '22023', message = 'invalid_role', hint = 'Papel inválido.';
  end if;

  if not public.is_band_manager(p_band_id, v_uid) then
    raise exception using errcode = '42501', message = 'forbidden',
      hint = 'Só o dono ou um admin podem mudar o papel dos membros.';
  end if;

  if p_user_id = v_uid then
    raise exception using errcode = '42501', message = 'forbidden',
      hint = 'Não podes mudar o teu próprio papel.';
  end if;

  select m.role into v_target
  from public.band_members m
  where m.band_id = p_band_id and m.user_id = p_user_id
  for update;

  if not found then
    raise exception using message = 'not_found', hint = 'Este membro já não faz parte do projeto.';
  end if;

  if v_target = 'owner' or public.is_band_owner(p_band_id, p_user_id) then
    raise exception using errcode = '42501', message = 'forbidden',
      hint = 'O papel do dono do projeto não se muda.';
  end if;

  update public.band_members m
     set role = p_role
   where m.band_id = p_band_id and m.user_id = p_user_id;

  return p_role;
end;
$$;


-- ---------- 8. PERMISSÕES ----------
-- Por omissão o Supabase dá EXECUTE a anon; os RPCs são só para quem tem sessão.

revoke all on function public.peek_project_code(text)                from public, anon;
revoke all on function public.join_project_with_code(text)           from public, anon;
revoke all on function public.regenerate_project_code(uuid)          from public, anon;
revoke all on function public.extend_project_code(uuid)              from public, anon;
revoke all on function public.get_project_invite(text)               from public, anon;
revoke all on function public.accept_project_invite(text)            from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text)      from public, anon;

grant execute on function public.peek_project_code(text)             to authenticated;
grant execute on function public.join_project_with_code(text)        to authenticated;
grant execute on function public.regenerate_project_code(uuid)       to authenticated;
grant execute on function public.extend_project_code(uuid)           to authenticated;
grant execute on function public.get_project_invite(text)            to authenticated;
grant execute on function public.accept_project_invite(text)         to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text)   to authenticated;

-- Auxiliares usadas nas policies e no índice dos códigos: têm de ser
-- executáveis por authenticated; anon não (is_band_manager / is_band_member
-- respondiam a anon quem gere/está em que projeto). A app só consulta
-- estas tabelas com sessão iniciada.
revoke all on function public.is_band_manager(uuid, uuid)   from public, anon;
revoke all on function public.is_band_member(uuid, uuid)    from public, anon;
revoke all on function public.is_band_owner(uuid, uuid)     from public, anon;
revoke all on function public.normalize_invite_code(text)   from public, anon;
revoke all on function public.project_role_rank(text)       from public, anon;
grant execute on function public.is_band_manager(uuid, uuid)   to authenticated, service_role;
grant execute on function public.is_band_member(uuid, uuid)    to authenticated, service_role;
grant execute on function public.is_band_owner(uuid, uuid)     to authenticated, service_role;
grant execute on function public.normalize_invite_code(text)   to authenticated, service_role;
grant execute on function public.project_role_rank(text)       to authenticated, service_role;

-- Internas: só os RPCs (SECURITY DEFINER) as chamam
revoke all on function public.invite_code_guard(uuid)              from public, anon, authenticated;
revoke all on function public.note_invite_code_failure(uuid, text) from public, anon, authenticated;


-- ---------- 9. DESBLOQUEAR JÁ ----------
-- Códigos que já expiraram voltam a funcionar por mais 30 dias (o mesmo código)
update public.bands
   set invite_expires_at = now() + interval '30 days'
 where invite_expires_at < now();


-- ---------- 10. VERIFICAÇÃO ----------
-- Avisa (separador "Messages" do SQL Editor) se existir alguma policy extra,
-- criada à mão, que volte a abrir o que esta migração fecha.
do $$
declare r record;
begin
  for r in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and (
        (tablename = 'bands' and cmd in ('SELECT', 'ALL') and policyname <> 'bands_select')
        or (tablename = 'band_members' and cmd in ('INSERT', 'ALL') and policyname <> 'band_members_insert')
        or (tablename = 'band_members' and cmd = 'UPDATE' and policyname <> 'band_members_update_self')
        or (tablename = 'project_invites' and cmd in ('INSERT', 'UPDATE', 'ALL')
            and policyname not in ('project_invites_insert', 'project_invites_update'))
      )
  loop
    raise warning 'Policy extra em public.%: "%" (%). Pode reabrir o acesso — revê-a ou apaga-a.',
      r.tablename, r.policyname, r.cmd;
  end loop;
end $$;

-- A API (PostgREST) passa a ver os RPCs novos já
notify pgrst, 'reload schema';
