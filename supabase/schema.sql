-- ============================================================
-- GIGIO — Database Schema
-- Colar em: Supabase > SQL Editor > New query > Run
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extensão da tabela auth.users do Supabase)
-- ============================================================
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  concert_theme jsonb not null default '{
    "bg": "#0d0d0d",
    "active_color": "#ffffff",
    "accent_color": "#FF4D6D",
    "font_size": 26
  }'::jsonb,
  created_at   timestamptz not null default now()
);

-- Cria perfil automaticamente quando um utilizador se regista
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- BANDS
-- ============================================================
create table public.bands (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique default upper(substring(replace(uuid_generate_v4()::text, '-', ''), 1, 8)),
  created_at  timestamptz not null default now()
);

-- ============================================================
-- BAND MEMBERS
-- ============================================================
create table public.band_members (
  band_id    uuid not null references public.bands(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (band_id, user_id)
);

-- Owner é membro automaticamente ao criar a banda
create or replace function public.handle_new_band()
returns trigger as $$
begin
  insert into public.band_members (band_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_band_created
  after insert on public.bands
  for each row execute function public.handle_new_band();

-- ============================================================
-- SONGS
-- ============================================================
create table public.songs (
  id           uuid primary key default uuid_generate_v4(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  artist       text not null,
  lyrics       text not null default '',
  chords       text,
  bpm          int,
  duration_sec int,
  source       text not null default 'manual' check (source in ('lrclib', 'genius', 'manual')),
  source_url   text,
  has_sync     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- LYRIC SYNC (timestamps LRC)
-- ============================================================
create table public.lyric_syncs (
  song_id uuid primary key references public.songs(id) on delete cascade,
  lines   jsonb not null default '[]'::jsonb  -- [{time_ms, text}]
);

-- ============================================================
-- SETLISTS
-- ============================================================
create table public.setlists (
  id         uuid primary key default uuid_generate_v4(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  band_id    uuid references public.bands(id) on delete set null,
  name       text not null,
  date       date,
  is_shared  boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- SETLIST SONGS (ordem das músicas)
-- ============================================================
create table public.setlist_songs (
  id         uuid primary key default uuid_generate_v4(),
  setlist_id uuid not null references public.setlists(id) on delete cascade,
  song_id    uuid not null references public.songs(id) on delete cascade,
  position   int not null,
  notes      text,
  unique (setlist_id, position)
);

-- ============================================================
-- CONCERT SESSIONS (sync em tempo real para bandas)
-- ============================================================
create table public.concert_sessions (
  id              uuid primary key default uuid_generate_v4(),
  setlist_id      uuid not null references public.setlists(id) on delete cascade,
  leader_id       uuid not null references public.profiles(id) on delete cascade,
  current_song_position int not null default 0,
  current_line_index    int not null default 0,
  is_playing      boolean not null default false,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.bands          enable row level security;
alter table public.band_members   enable row level security;
alter table public.songs          enable row level security;
alter table public.lyric_syncs    enable row level security;
alter table public.setlists       enable row level security;
alter table public.setlist_songs  enable row level security;
alter table public.concert_sessions enable row level security;

-- Profiles: cada um vê/edita o seu
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Bands: membros vêem, owner edita/apaga
create policy "bands_select" on public.bands for select
  using (exists (select 1 from public.band_members where band_id = bands.id and user_id = auth.uid()));
create policy "bands_insert" on public.bands for insert with check (owner_id = auth.uid());
create policy "bands_update" on public.bands for update using (owner_id = auth.uid());
create policy "bands_delete" on public.bands for delete using (owner_id = auth.uid());

-- Band members
create policy "band_members_select" on public.band_members for select
  using (exists (select 1 from public.band_members bm where bm.band_id = band_members.band_id and bm.user_id = auth.uid()));
create policy "band_members_insert" on public.band_members for insert with check (user_id = auth.uid());
create policy "band_members_delete" on public.band_members for delete
  using (user_id = auth.uid() or exists (select 1 from public.bands where id = band_id and owner_id = auth.uid()));

-- Songs: dono gere, membros da mesma banda vêem
create policy "songs_select" on public.songs for select using (owner_id = auth.uid());
create policy "songs_insert" on public.songs for insert with check (owner_id = auth.uid());
create policy "songs_update" on public.songs for update using (owner_id = auth.uid());
create policy "songs_delete" on public.songs for delete using (owner_id = auth.uid());

-- Lyric syncs: seguem a song
create policy "lyric_syncs_select" on public.lyric_syncs for select
  using (exists (select 1 from public.songs where id = lyric_syncs.song_id and owner_id = auth.uid()));
create policy "lyric_syncs_upsert" on public.lyric_syncs for all
  using (exists (select 1 from public.songs where id = lyric_syncs.song_id and owner_id = auth.uid()));

-- Setlists: dono gere; membros da banda vêem as partilhadas
create policy "setlists_select" on public.setlists for select
  using (
    owner_id = auth.uid()
    or (is_shared and exists (
      select 1 from public.band_members where band_id = setlists.band_id and user_id = auth.uid()
    ))
  );
create policy "setlists_insert" on public.setlists for insert with check (owner_id = auth.uid());
create policy "setlists_update" on public.setlists for update using (owner_id = auth.uid());
create policy "setlists_delete" on public.setlists for delete using (owner_id = auth.uid());

-- Setlist songs
create policy "setlist_songs_select" on public.setlist_songs for select
  using (exists (select 1 from public.setlists where id = setlist_songs.setlist_id and (
    owner_id = auth.uid()
    or (is_shared and exists (select 1 from public.band_members where band_id = setlists.band_id and user_id = auth.uid()))
  )));
create policy "setlist_songs_all" on public.setlist_songs for all
  using (exists (select 1 from public.setlists where id = setlist_songs.setlist_id and owner_id = auth.uid()));

-- Concert sessions: membros da banda vêem, líder controla
create policy "concert_sessions_select" on public.concert_sessions for select
  using (exists (
    select 1 from public.setlists s
    join public.band_members bm on bm.band_id = s.band_id
    where s.id = concert_sessions.setlist_id and bm.user_id = auth.uid()
  ) or leader_id = auth.uid());
create policy "concert_sessions_insert" on public.concert_sessions for insert with check (leader_id = auth.uid());
create policy "concert_sessions_update" on public.concert_sessions for update using (leader_id = auth.uid());

-- ============================================================
-- REALTIME (para sync de concerto)
-- ============================================================
alter publication supabase_realtime add table public.concert_sessions;
