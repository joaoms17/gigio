-- ============================================================
-- FIX: recursão infinita nas políticas RLS (erro 42P17)
-- Causa: band_members_select referenciava band_members → loop.
-- Solução: funções SECURITY DEFINER que contornam o RLS.
-- Colar em: Supabase > SQL Editor > New query > Run
-- ============================================================

-- Funções auxiliares (correm como owner → não disparam RLS → sem recursão)
create or replace function public.is_band_member(_band_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from band_members
    where band_id = _band_id and user_id = _user_id
  );
$$;

create or replace function public.is_band_owner(_band_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from bands
    where id = _band_id and owner_id = _user_id
  );
$$;

-- ---------- BAND MEMBERS ----------
drop policy if exists "band_members_select" on public.band_members;
create policy "band_members_select" on public.band_members for select
  using (user_id = auth.uid() or public.is_band_member(band_id, auth.uid()));

drop policy if exists "band_members_delete" on public.band_members;
create policy "band_members_delete" on public.band_members for delete
  using (user_id = auth.uid() or public.is_band_owner(band_id, auth.uid()));

-- ---------- BANDS ----------
-- (qualquer autenticado pode ver — necessário para entrar por código de convite)
drop policy if exists "bands_select" on public.bands;
drop policy if exists "bands_select_by_invite" on public.bands;
create policy "bands_select" on public.bands for select
  using (auth.uid() is not null);

-- ---------- SETLISTS ----------
drop policy if exists "setlists_select" on public.setlists;
create policy "setlists_select" on public.setlists for select
  using (
    owner_id = auth.uid()
    or (is_shared and public.is_band_member(band_id, auth.uid()))
  );

-- ---------- CONCERT SESSIONS ----------
drop policy if exists "concert_sessions_select" on public.concert_sessions;
create policy "concert_sessions_select" on public.concert_sessions for select
  using (
    leader_id = auth.uid()
    or exists (
      select 1 from setlists s
      where s.id = concert_sessions.setlist_id
        and public.is_band_member(s.band_id, auth.uid())
    )
  );
