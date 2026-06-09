import type { SearchResult } from '../types'

// Genius API calls go through a Supabase Edge Function to hide the token
const PROXY = '/api/genius'

export async function searchGenius(query: string): Promise<SearchResult[]> {
  const res = await fetch(`${PROXY}/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.response?.hits ?? []).slice(0, 10).map((hit: any) => ({
    title: hit.result.title,
    artist: hit.result.primary_artist.name,
    source: 'genius' as const,
    has_sync: false,
    external_id: String(hit.result.id),
  }))
}

export async function getGeniusLyrics(id: string): Promise<string> {
  const res = await fetch(`${PROXY}/lyrics/${id}`)
  if (!res.ok) throw new Error('Not found')
  const data = await res.json()
  return data.lyrics ?? ''
}
