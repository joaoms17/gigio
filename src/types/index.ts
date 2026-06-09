export interface User {
  id: string
  email: string
  display_name: string
  avatar_url?: string
}

export interface Band {
  id: string
  name: string
  owner_id: string
  invite_code: string
  invite_expires_at?: string
  created_at: string
}

export interface BandMember {
  band_id: string
  user_id: string
  role: 'owner' | 'member'
  instrument?: string
  display_name?: string
}

export interface Song {
  id: string
  title: string
  artist: string
  lyrics: string
  chords?: string
  bpm?: number
  duration_sec?: number
  source: 'lrclib' | 'genius' | 'text' | 'manual'
  source_url?: string
  has_sync: boolean
  owner_id: string
  created_at: string
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
  created_at: string
}

export interface SetlistSong {
  id: string
  setlist_id: string
  song_id: string
  position: number
  notes?: string
  song?: Song
}

export interface ConcertTheme {
  bg: string
  active_color: string
  accent_color: string
  font_size: number
}

export interface SearchResult {
  title: string
  artist: string
  source: 'lrclib' | 'text'
  has_sync: boolean
  duration_sec?: number
  external_id: string
}
