-- ============================================================
-- MIGRATION: fix RLS recursion + band design/features
-- Corre tudo de uma vez. Seguro re-correr (idempotente).
-- Supabase > SQL Editor > New query > Run
-- ============================================================

-- ---------- 1. FIX RECURSÃO RLS (erro 42P17) ----------
create or replace function public.is_band_member(_band_id uuid, _user_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from band_members where band_id = _band_id and user_id = _user_id); $$;

create or replace function public.is_band_owner(_band_id uuid, _user_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from bands where id = _band_id and owner_id = _user_id); $$;

drop policy if exists "band_members_select" on public.band_members;
create policy "band_members_select" on public.band_members for select
  using (user_id = auth.uid() or public.is_band_member(band_id, auth.uid()));

drop policy if exists "band_members_delete" on public.band_members;
create policy "band_members_delete" on public.band_members for delete
  using (user_id = auth.uid() or public.is_band_owner(band_id, auth.uid()));

drop policy if exists "bands_select" on public.bands;
drop policy if exists "bands_select_by_invite" on public.bands;
create policy "bands_select" on public.bands for select using (auth.uid() is not null);

drop policy if exists "setlists_select" on public.setlists;
create policy "setlists_select" on public.setlists for select
  using (owner_id = auth.uid() or (is_shared and public.is_band_member(band_id, auth.uid())));

drop policy if exists "concert_sessions_select" on public.concert_sessions;
create policy "concert_sessions_select" on public.concert_sessions for select
  using (leader_id = auth.uid() or exists (
    select 1 from setlists s where s.id = concert_sessions.setlist_id
      and public.is_band_member(s.band_id, auth.uid())));

-- ---------- 2. NOVAS COLUNAS ----------
-- Instrumento de cada membro (guitarra, bateria, ...)
alter table public.band_members add column if not exists instrument text;

-- Expiração do código de convite
alter table public.bands add column if not exists invite_expires_at timestamptz not null default (now() + interval '7 days');

-- ---------- 3. CÓDIGO DE CONVITE FORMATADO (ex: JZBR-4829) ----------
create or replace function public.gen_band_invite_code(_name text)
returns text language plpgsql as $$
declare letters text;
begin
  letters := upper(substring(regexp_replace(coalesce(_name,''), '[^a-zA-Z]', '', 'g') from 1 for 4));
  if length(letters) < 4 then letters := rpad(letters, 4, 'X'); end if;
  return letters || '-' || lpad((floor(random()*10000))::int::text, 4, '0');
end; $$;

create or replace function public.handle_band_invite_code()
returns trigger language plpgsql as $$
begin
  if new.invite_code is null or new.invite_code !~ '^[A-Z]{4}-[0-9]{4}$' then
    new.invite_code := public.gen_band_invite_code(new.name);
  end if;
  return new;
end; $$;

drop trigger if exists on_band_invite_code on public.bands;
create trigger on_band_invite_code
  before insert on public.bands
  for each row execute function public.handle_band_invite_code();

-- Regenera códigos antigos (formato hex) para o novo formato
update public.bands
  set invite_code = public.gen_band_invite_code(name)
  where invite_code !~ '^[A-Z]{4}-[0-9]{4}$';

-- Membros owner ficam com role 'owner' (caso algum tenha ficado 'member')
update public.band_members bm
  set role = 'owner'
  from public.bands b
  where b.id = bm.band_id and b.owner_id = bm.user_id and bm.role <> 'owner';
