-- ============================================================
-- GIGIO v2 — Migration
-- Executar no Supabase SQL Editor após o schema v1 inicial
-- ============================================================

-- Adicionar colunas novas à tabela bands (projetos)
ALTER TABLE public.bands
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'band',
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#7C3AED',
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Expandir roles em band_members: owner, admin, editor, viewer
ALTER TABLE public.band_members DROP CONSTRAINT IF EXISTS band_members_role_check;
ALTER TABLE public.band_members
  ADD CONSTRAINT band_members_role_check CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));
UPDATE public.band_members SET role = 'editor' WHERE role = 'member';

-- Adicionar status e instrument à band_members (caso não existam)
ALTER TABLE public.band_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'removed')),
  ADD COLUMN IF NOT EXISTS instrument text;

-- ============================================================
-- PROJECT INVITES (convites por email)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_invites (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id   uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  token        text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_invites_select" ON public.project_invites;
CREATE POLICY "project_invites_select" ON public.project_invites FOR SELECT
  USING (
    invited_by = auth.uid()
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.band_members
      WHERE band_id = project_invites.project_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "project_invites_insert" ON public.project_invites;
CREATE POLICY "project_invites_insert" ON public.project_invites FOR INSERT
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.band_members
      WHERE band_id = project_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "project_invites_update" ON public.project_invites;
CREATE POLICY "project_invites_update" ON public.project_invites FOR UPDATE
  USING (
    invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.band_members
      WHERE band_id = project_invites.project_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "project_invites_delete" ON public.project_invites;
CREATE POLICY "project_invites_delete" ON public.project_invites FOR DELETE
  USING (
    invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.band_members
      WHERE band_id = project_invites.project_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- Novos campos em songs (repertório por projeto)
-- ============================================================
ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS project_id      uuid REFERENCES public.bands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_key    text,
  ADD COLUMN IF NOT EXISTS performance_key text,
  ADD COLUMN IF NOT EXISTS capo            int,
  ADD COLUMN IF NOT EXISTS tuning          text,
  ADD COLUMN IF NOT EXISTS original_lyrics text,
  ADD COLUMN IF NOT EXISTS edited_lyrics   text,
  ADD COLUMN IF NOT EXISTS is_user_edited  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags            text[],
  ADD COLUMN IF NOT EXISTS source_provider text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb,
  ADD COLUMN IF NOT EXISTS structure       jsonb,
  ADD COLUMN IF NOT EXISTS notes           text,
  ADD COLUMN IF NOT EXISTS confidence_score float,
  ADD COLUMN IF NOT EXISTS updated_by     uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now();

-- Actualizar RLS de songs para incluir membros de projecto
DROP POLICY IF EXISTS "songs_select" ON public.songs;
CREATE POLICY "songs_select" ON public.songs FOR SELECT
  USING (
    owner_id = auth.uid()
    OR (
      project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.band_members
        WHERE band_id = songs.project_id AND user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "songs_insert" ON public.songs;
CREATE POLICY "songs_insert" ON public.songs FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "songs_update" ON public.songs;
CREATE POLICY "songs_update" ON public.songs FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR (
      project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.band_members
        WHERE band_id = songs.project_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin', 'editor')
      )
    )
  );

DROP POLICY IF EXISTS "songs_delete" ON public.songs;
CREATE POLICY "songs_delete" ON public.songs FOR DELETE
  USING (
    owner_id = auth.uid()
    OR (
      project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.band_members
        WHERE band_id = songs.project_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin', 'editor')
      )
    )
  );

-- ============================================================
-- Novos campos em setlists
-- ============================================================
ALTER TABLE public.setlists
  ADD COLUMN IF NOT EXISTS venue       text,
  ADD COLUMN IF NOT EXISTS status      text DEFAULT 'draft' CHECK (status IN ('draft', 'preparing', 'final', 'archived')),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS notes       text,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

-- Actualizar RLS de setlists para incluir membros de projecto com roles adequados
DROP POLICY IF EXISTS "setlists_select" ON public.setlists;
CREATE POLICY "setlists_select" ON public.setlists FOR SELECT
  USING (
    owner_id = auth.uid()
    OR (is_shared AND EXISTS (
      SELECT 1 FROM public.band_members
      WHERE band_id = setlists.band_id AND user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "setlists_insert" ON public.setlists;
CREATE POLICY "setlists_insert" ON public.setlists FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "setlists_update" ON public.setlists;
CREATE POLICY "setlists_update" ON public.setlists FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR (
      band_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.band_members
        WHERE band_id = setlists.band_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin', 'editor')
      )
    )
  );

DROP POLICY IF EXISTS "setlists_delete" ON public.setlists;
CREATE POLICY "setlists_delete" ON public.setlists FOR DELETE
  USING (
    owner_id = auth.uid()
    OR (
      band_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.band_members
        WHERE band_id = setlists.band_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin')
      )
    )
  );

-- ============================================================
-- Novos campos em setlist_songs
-- ============================================================
ALTER TABLE public.setlist_songs
  ADD COLUMN IF NOT EXISTS performance_key  text,
  ADD COLUMN IF NOT EXISTS custom_intro     text,
  ADD COLUMN IF NOT EXISTS custom_ending    text,
  ADD COLUMN IF NOT EXISTS estimated_duration int;
