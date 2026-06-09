import type { SearchResult, LyricLine } from '../types'

const BASE = 'https://lrclib.net/api'

export async function searchLrclib(query: string): Promise<SearchResult[]> {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.slice(0, 10).map((item: any) => ({
    title: item.trackName,
    artist: item.artistName,
    source: 'lrclib' as const,
    has_sync: !!item.syncedLyrics,
    duration_sec: item.duration,
    external_id: String(item.id),
  }))
}

export async function getLrclibLyrics(id: string): Promise<{ lyrics: string; lines: LyricLine[] | null }> {
  const res = await fetch(`${BASE}/get/${id}`)
  if (!res.ok) throw new Error('Not found')
  const data = await res.json()
  const lines = data.syncedLyrics ? parseLrc(data.syncedLyrics) : null
  return { lyrics: data.plainLyrics ?? '', lines }
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/\[(\d+):(\d+\.\d+)\](.*)/)
    if (!m) continue
    const time_ms = (parseInt(m[1]) * 60 + parseFloat(m[2])) * 1000
    lines.push({ time_ms, text: m[3].trim() })
  }
  return lines
}
