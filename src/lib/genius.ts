import type { SearchResult } from '../types'

// Genius só é usado para DESCOBERTA (a Search API oficial funciona via proxy).
// As letras vêm do lyrics.ovh (o Genius bloqueia scraping server-side com 403).
const PROXY = '/api/genius'

export async function searchGenius(query: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(`${PROXY}?path=search&q=${encodeURIComponent(query)}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.response?.hits ?? []).slice(0, 8).map((hit: any) => ({
      title: hit.result.title,
      artist: hit.result.primary_artist.name,
      source: 'text' as const,
      has_sync: false,
      external_id: String(hit.result.id),
    }))
  } catch {
    return []
  }
}
