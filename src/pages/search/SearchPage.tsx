import { useState } from 'react'
import Layout from '../../components/Layout'
import { searchLrclib, getLrclibLyrics } from '../../lib/lrclib'
import { searchGenius, getGeniusLyrics } from '../../lib/genius'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { SearchResult } from '../../types'
import styles from './SearchPage.module.css'

export default function SearchPage() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [filter, setFilter] = useState<'all' | 'lrclib' | 'genius'>('all')

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setResults([])
    const [lrc, genius] = await Promise.allSettled([
      searchLrclib(query),
      searchGenius(query),
    ])
    const combined: SearchResult[] = [
      ...(lrc.status === 'fulfilled' ? lrc.value : []),
      ...(genius.status === 'fulfilled' ? genius.value : []),
    ]
    // LRClib com sync primeiro
    combined.sort((a, b) => (b.has_sync ? 1 : 0) - (a.has_sync ? 1 : 0))
    setResults(combined)
    setLoading(false)
  }

  async function addSong(r: SearchResult) {
    if (!user || saving) return
    setSaving(r.external_id)
    try {
      let lyrics = ''
      let lines = null
      if (r.source === 'lrclib') {
        const data = await getLrclibLyrics(r.external_id)
        lyrics = data.lyrics
        lines = data.lines
      } else {
        lyrics = await getGeniusLyrics(r.external_id)
      }
      const { data: song } = await supabase.from('songs').insert({
        owner_id: user.id,
        title: r.title,
        artist: r.artist,
        lyrics,
        source: r.source,
        has_sync: r.has_sync,
        duration_sec: r.duration_sec,
      }).select().single()

      if (song && lines) {
        await supabase.from('lyric_syncs').insert({ song_id: song.id, lines })
      }
      setSaved(prev => [...prev, r.external_id])
    } catch {
      // silently fail
    } finally {
      setSaving(null)
    }
  }

  const filtered = filter === 'all' ? results : results.filter(r => r.source === filter)

  return (
    <Layout>
      <div className={styles.page}>
        <h1 className={styles.title}>Buscar Letras</h1>
        <p className={styles.sub}>Pesquisa em Genius e LRClib e guarda na tua biblioteca</p>

        <form onSubmit={handleSearch} className={styles.searchForm}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nome da música ou artista..."
          />
          <button className={styles.searchBtn} type="submit" disabled={loading}>
            {loading ? '...' : 'Pesquisar'}
          </button>
        </form>

        {results.length > 0 && (
          <div className={styles.filters}>
            {(['all', 'lrclib', 'genius'] as const).map(f => (
              <button
                key={f}
                className={filter === f ? styles.filterActive : styles.filter}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'Todos' : f === 'lrclib' ? 'LRClib (sync ✓)' : 'Genius'}
              </button>
            ))}
          </div>
        )}

        <div className={styles.results}>
          {filtered.map(r => {
            const isSaved = saved.includes(r.external_id)
            const isSaving = saving === r.external_id
            return (
              <div key={`${r.source}-${r.external_id}`} className={styles.resultRow}>
                <div className={`${styles.thumb} ${styles[r.source]}`} />
                <div className={styles.info}>
                  <div className={styles.resultTitle}>
                    {r.title}
                    <span className={`${styles.badge} ${styles[r.source]}`}>{r.source}</span>
                    {r.has_sync && <span className={styles.syncBadge}>sync ✓</span>}
                  </div>
                  <div className={styles.resultArtist}>
                    {r.artist}
                    {r.duration_sec ? ` · ${Math.floor(r.duration_sec / 60)}:${String(r.duration_sec % 60).padStart(2, '0')}` : ''}
                  </div>
                </div>
                <button
                  className={isSaved ? styles.savedBtn : styles.addBtn}
                  onClick={() => addSong(r)}
                  disabled={isSaved || !!saving}
                >
                  {isSaving ? '...' : isSaved ? '✓ Guardado' : '+ Guardar'}
                </button>
              </div>
            )
          })}
          {!loading && results.length === 0 && query && (
            <p className={styles.empty}>Sem resultados para "{query}"</p>
          )}
        </div>
      </div>
    </Layout>
  )
}
