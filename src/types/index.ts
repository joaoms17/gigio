export interface User {
  id: string
  email: string
  display_name: string
  avatar_url?: string
}

export type ProjectType =
  | 'band'
  | 'solo'
  | 'tribute'
  | 'duo'
  | 'dj'
  | 'choir'
  | 'orchestra'
  | 'temporary'
  | 'events'
  | 'other'

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'
export type SetlistStatus = 'draft' | 'preparing' | 'final' | 'archived'

export interface Project {
  id: string
  name: string
  description?: string
  type: ProjectType
  color: string
  image_url?: string
  owner_id: string
  invite_code: string
  invite_expires_at?: string
  created_at: string
  updated_at?: string
}

// Alias para compatibilidade
export type Band = Project

export interface ProjectMember {
  band_id: string
  user_id: string
  role: ProjectRole
  status?: 'active' | 'invited' | 'removed'
  instrument?: string
  joined_at?: string
  profiles?: { display_name: string | null; avatar_url?: string | null }
}

export type BandMember = ProjectMember

export interface ProjectInvite {
  id: string
  project_id: string
  email: string
  role: 'admin' | 'editor' | 'viewer'
  token: string
  status: InviteStatus
  invited_by: string
  expires_at: string
  created_at: string
}

export interface Song {
  id: string
  title: string
  artist: string
  lyrics: string
  original_lyrics?: string
  edited_lyrics?: string
  is_user_edited?: boolean
  chords?: string
  bpm?: number
  duration_sec?: number
  source: 'lrclib' | 'genius' | 'text' | 'manual'
  source_url?: string
  source_provider?: string
  source_metadata?: Record<string, unknown>
  has_sync: boolean
  owner_id: string
  project_id?: string
  original_key?: string
  performance_key?: string
  capo?: number
  tuning?: string
  tags?: string[]
  notes?: string
  structure?: unknown
  confidence_score?: number
  created_at: string
  updated_at?: string
}

export interface LyricLine {
  time_ms: number
  text: string
}

export interface LyricSync {
  song_id: string
  lines: LyricLine[]
}

export interface Setlist {
  id: string
  name: string
  date?: string
  band_id?: string
  owner_id: string
  is_shared: boolean
  venue?: string
  status?: SetlistStatus
  description?: string
  notes?: string
  created_at: string
  updated_at?: string
}

export interface SetlistSong {
  id: string
  setlist_id: string
  song_id: string
  position: number
  notes?: string
  performance_key?: string
  custom_intro?: string
  custom_ending?: string
  estimated_duration?: number
  song?: Song
}

export interface ConcertTheme {
  bg: string
  active_color: string
  accent_color: string
  font_size: number
  line_height?: number
}

export interface SearchResult {
  title: string
  artist: string
  source: 'lrclib' | 'text'
  has_sync: boolean
  duration_sec?: number
  external_id: string
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  band: 'Banda',
  solo: 'Artista solo',
  tribute: 'Tributo',
  duo: 'Duo',
  dj: 'DJ',
  choir: 'Coro',
  orchestra: 'Orquestra',
  temporary: 'Projeto temporário',
  events: 'Casamentos/Eventos',
  other: 'Outro',
}

export const PROJECT_COLORS = [
  '#7C3AED',
  '#FF4D6D',
  '#2563EB',
  '#059669',
  '#D97706',
  '#DB2777',
  '#0891B2',
  '#9333EA',
  '#DC2626',
  '#16A34A',
]

export const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}
