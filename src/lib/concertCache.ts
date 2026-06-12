// Offline cache for concert mode — setlist songs + lyric syncs are stored in
// localStorage when loaded online, and read back when the network fails.

const SONGS_KEY = (setlistId: string) => `gigio_concert_songs_v1_${setlistId}`
const SYNC_KEY  = (songId: string)    => `gigio_concert_sync_v1_${songId}`
const THEME_KEY = 'gigio_concert_theme_v1'

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
