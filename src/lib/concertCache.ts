// Offline cache — navigation path (projects → dashboard → setlist) and concert
// mode data are stored in localStorage when loaded online, read back offline.

const SONGS_KEY     = (setlistId: string)  => `gigio_concert_songs_v1_${setlistId}`
const SYNC_KEY      = (songId: string)     => `gigio_concert_sync_v1_${songId}`
const THEME_KEY     = 'gigio_concert_theme_v1'
const PROJECTS_KEY  = (userId: string)     => `gigio_projects_v1_${userId}`
const DASHBOARD_KEY = (projectId: string)  => `gigio_dashboard_v1_${projectId}`
const SETLIST_KEY   = (setlistId: string)  => `gigio_setlist_meta_v1_${setlistId}`

export function cacheSetlistSongs(setlistId: string, rows: unknown[]) {
  try { localStorage.setItem(SONGS_KEY(setlistId), JSON.stringify(rows)) } catch {}
}

export function getCachedSetlistSongs<T>(setlistId: string): T[] | null {
  try {
    const raw = localStorage.getItem(SONGS_KEY(setlistId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function cacheSyncLines(songId: string, lines: unknown) {
  try { localStorage.setItem(SYNC_KEY(songId), JSON.stringify(lines)) } catch {}
}

export function getCachedSyncLines<T>(songId: string): T | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY(songId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function cacheTheme(theme: unknown) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)) } catch {}
}

export function getCachedTheme<T>(): T | null {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ── Navigation path ────────────────────────────────────────────────────────

export function cacheProjects(userId: string, data: unknown) {
  try { localStorage.setItem(PROJECTS_KEY(userId), JSON.stringify(data)) } catch {}
}
export function getCachedProjects<T>(userId: string): T | null {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY(userId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function cacheProjectDashboard(projectId: string, data: unknown) {
  try { localStorage.setItem(DASHBOARD_KEY(projectId), JSON.stringify(data)) } catch {}
}
export function getCachedProjectDashboard<T>(projectId: string): T | null {
  try {
    const raw = localStorage.getItem(DASHBOARD_KEY(projectId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function cacheSetlistMeta(setlistId: string, data: unknown) {
  try { localStorage.setItem(SETLIST_KEY(setlistId), JSON.stringify(data)) } catch {}
}
export function getCachedSetlistMeta<T>(setlistId: string): T | null {
  try {
    const raw = localStorage.getItem(SETLIST_KEY(setlistId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
