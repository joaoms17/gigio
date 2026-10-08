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
  image_position?: number  // 0-100 vertical crop position for the card banner
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

/** Papéis que um convite pode dar (o de dono nunca se convida) */
export type InviteRole = 'admin' | 'editor' | 'viewer'

export interface ProjectInvite {
  id: string
  project_id: string
  email: string
  role: InviteRole
  token: string
  status: InviteStatus
  invited_by: string
  expires_at: string
  created_at: string
  /** migration_invites_v3.sql — quem aceitou o convite por link, e quando */
  accepted_by?: string | null
  accepted_at?: string | null
}

/** O que o RPC peek_project_code devolve: só metadados públicos do projeto */
export interface ProjectCodePeek {
  /** null quando o código expirou e quem pergunta não é membro (não se revela o id) */
  id: string | null
  name: string
  type: ProjectType | string
  color: string | null
  image_url: string | null
  expired: boolean
  /** quem pergunta já é membro (só sobre si próprio) — "Abrir projeto" em vez de entrar */
  is_member: boolean
}

/** Convite por link visto pelo convidado (RPC get_project_invite — sem emails nem token) */
export interface ProjectInviteDetails {
  id: string
  project_id: string
  role: InviteRole
  status: InviteStatus
  expires_at: string
  /** pendente mas já fora da validade (ou marcado como expirado) */
  expired: boolean
  /** null quando não se sabe (base de dados ainda sem a migração v3) */
  already_member: boolean | null
  /** papel de quem abre o convite no projeto (null: não é membro / não se sabe) */
  my_role: ProjectRole | null
  invited_by_name: string | null
  project: {
    id: string
    name: string
    type: ProjectType | string
    color: string | null
    description: string | null
    image_url: string | null
  }
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
  /** Alinhamento da letra no palco — 'left' (como foi escrita) por omissão */
  align?: 'left' | 'center'
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
  '#4CC9F0',
  '#FFC24B',
  '#2F6FEB',
  '#0E9F6E',
  '#B45309',
  '#A8A29E',
  '#0891B2',
  '#64748B',
  '#DC2626',
  '#3DDC97',
]

export const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'Dono',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Visualizador',
}
