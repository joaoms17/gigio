import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import { searchLrclib, getLrclibLyrics } from '../../lib/lrclib'
import { searchGenius } from '../../lib/genius'
import { getLyricsOvh } from '../../lib/lyricsovh'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { SearchResult, LyricLine, Setlist } from '../../types'
import styles from './SearchPage.module.css'

interface PreviewState {
  result: SearchResult
  lyrics: string
  lines: LyricLine[] | null
  loading: boolean
}

interface ManualState {
  title: string
  artist: string
  lyrics: string
  setlistId: string | null
}

export default function SearchPage() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [artistQuery, setArtistQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [manual, setManual] = useState<ManualState | null>(null)
  const [savingManual, setSavingManual] = useState(false)
  const [picker, setPicker] = useState<SearchResult | null>(null)
  const [setlists, setSetlists] = useState<Setlist[]>([])

  useEffect(() => {
    if (!user) return
    supabase
      .from('setlists')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSetlists(data ?? []))
  }, [user])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    setResults([])
    const geniusQuery = artistQuery.trim() ? `${query} ${artistQuery}` : query
    const [lrc, genius] = await Promise.allSettled([
      searchLrclib(query, artistQuery),
      searchGenius(geniusQuery),
    ])
    const combined: SearchResult[] = [
      ...(lrc.status === 'fulfilled' ? lrc.value : []),
      ...(genius.status === 'fulfilled' ? genius.value : []),
    ]
    combined.sort((a, b) => (b.has_sync ? 1 : 0) - (a.has_sync ? 1 : 0))
    setResults(combined)
    setLoading(false)
  }

  async function fetchLyrics(r: SearchResult): Promise<{ lyrics: string; lines: LyricLine[] | null }> {
    if (r.source === 'lrclib') {
      const d = await getLrclibLyrics(r.external_id)
      return { lyrics: d.lyrics, lines: d.lines }
    }
    const lyrics = await getLyricsOvh(r.artist, r.title)
    return { lyrics, lines: null }
  }

  function keyOf(r: SearchResult) {
    return `${r.source}-${r.external_id}`
  }

  async function openPreview(r: SearchResult) {
    setPreview({ result: r, lyrics: '', lines: null, loading: true })
    const { lyrics, lines } = await fetchLyrics(r)
    setPreview({ result: r, lyrics, lines, loading: false })
  }

  async function insertSong(opts: {
    title: string
    artist: string
    lyrics: string
    source: SearchResult['source'] | 'manual'
    has_sync: boolean
    duration_sec?: number
    lines: LyricLine[] | null
  }): Promise<string | null> {
    if (!user) return null
    const { data: song, error } = await supabase
      .from('songs')
      .insert({
        owner_id: user.id,
        title: opts.title,
        artist: opts.artist,
        lyrics: opts.lyrics,
        source: opts.source,
        has_sync: opts.has_sync,
        duration_sec: opts.duration_sec,
      })
      .select()
      .single()
    if (error) throw error
    if (song && opts.lines && opts.lines.length) {
      await supabase.from('lyric_syncs').insert({ song_id: song.id, lines: opts.lines })
    }
    return song?.id ?? null
  }

  async function addToSetlist(setlistId: string, songId: string) {
    const { count } = await supabase
      .from('setlist_songs')
      .select('*', { count: 'exact', head: true })
      .eq('setlist_id', setlistId)
    await supabase.from('setlist_songs').insert({ setlist_id: setlistId, song_id: songId, position: count ?? 0 })
  }

  // Adicionar com destino escolhido (null = só biblioteca)
  async function doAdd(r: SearchResult, setlistId: string | null) {
    if (!user || saving) return
    setPicker(null)
    setSaving(keyOf(r))
    try {
      const { lyrics, lines } = await fetchLyrics(r)
      if (!lyrics.trim()) {
        // sem letra → abrir modal manual, guardando o destino
        setSaving(null)
        setManual({ title: r.title, artist: r.artist, lyrics: '', setlistId })
        return
      }
      const songId = await insertSong({
        title: r.title,
        artist: r.artist,
        lyrics,
        source: r.source,
        has_sync: r.has_sync && !!lines,
        duration_sec: r.duration_sec,
        lines,
      })
      if (songId && setlistId) await addToSetlist(setlistId, songId)
      setSaved(prev => [...prev, keyOf(r)])
    } catch (err: any) {
      alert('Erro ao guardar: ' + (err?.message ?? err))
    } finally {
      setSaving(null)
    }
  }

  async function createSetlistAndAdd(r: SearchResult) {
    if (!user) return
    const { data } = await supabase
      .from('setlists')
      .insert({ name: 'Nova Setlist', owner_id: user.id })
      .select()
      .single()
    if (data) {
      setSetlists(prev => [data, ...prev])
      await doAdd(r, data.id)
    }
  }

  async function saveManual() {
    if (!manual || !manual.title.trim() || !manual.artist.trim()) return
    setSavingManual(true)
    try {
      const songId = await insertSong({
        title: manual.title.trim(),
        artist: manual.artist.trim(),
        lyrics: manual.lyrics,
        source: 'manual',
        has_sync: false,
        lines: null,
      })
      if (songId && manual.setlistId) await addToSetlist(manual.setlistId, songId)
      setManual(null)
    } catch (err: any) {
      alert('Erro ao guardar: ' + (err?.message ?? err))
    } finally {
      setSavingManual(false)
    }
  }

  return (
    <Layout>
      <div className={styles.page}>
        <h1 className={styles.title}>Buscar Letras</h1>
        <p className={styles.sub}>LRClib (com sincronização) e lyrics.ovh. Guarda na biblioteca ou numa setlist.</p>

        <form onSubmit={handleSearch} className={styles.searchForm}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Música ou título..."
          />
          <input
            className={styles.artistInput}
            value={artistQuery}
            onChange={e => setArtistQuery(e.target.value)}
            placeholder="Artista (opcional)"
          />
          <button className={styles.searchBtn} type="submit" disabled={loading}>
            {loading ? 'A pesquisar...' : 'Pesquisar'}
          </button>
        </form>

        <div className={styles.results}>
          {loading && (
            <div className={styles.loadingBox}>
              <div className={styles.spinner} />
              <span>A pesquisar...</span>
            </div>
          )}

          {!loading && results.map(r => {
            const k = keyOf(r)
            const isSaved = saved.includes(k)
            const isSaving = saving === k
            return (
              <div key={k} className={styles.resultRow}>
                <div className={`${styles.thumb} ${styles[r.source]}`} />
                <div className={styles.info}>
                  <div className={styles.resultTitle}>
                    {r.title}
                    {r.source === 'lrclib' ? (
                      <span className={`${styles.badge} ${styles.lrclib}`}>LRClib</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.text}`}>Texto</span>
                    )}
                    {r.has_sync && <span className={styles.syncBadge}>sync ✓</span>}
                  </div>
                  <div className={styles.resultArtist}>
                    {r.artist}
                    {r.duration_sec
                      ? ` · ${Math.floor(r.duration_sec / 60)}:${String(r.duration_sec % 60).padStart(2, '0')}`
                      : ''}
                  </div>
                </div>
                <button className={styles.previewBtn} onClick={() => openPreview(r)} disabled={isSaving}>
                  Pré-ver
                </button>
                <button
                  className={isSaved ? styles.savedBtn : styles.addBtn}
                  onClick={() => setPicker(r)}
                  disabled={isSaved || !!saving}
                >
                  {isSaving ? '...' : isSaved ? '✓ Guardado' : '+ Adicionar'}
                </button>
              </div>
            )
          })}

          {!loading && searched && results.length === 0 && (
            <p className={styles.empty}>Sem resultados para "{query}".</p>
          )}
        </div>

        <div className={styles.fallback}>
          <span className={styles.fallbackLabel}>Não encontraste?</span>
          <button className={styles.fallbackBtn} onClick={() => setManual({ title: query, artist: artistQuery, lyrics: '', setlistId: null })}>
            ✏ Escrever letra manualmente
          </button>
          <button className={styles.fallbackBtn} onClick={() => setManual({ title: query, artist: artistQuery, lyrics: '', setlistId: null })}>
            📋 Colar de texto
          </button>
        </div>
      </div>

      {/* MODAL: escolher destino ao adicionar */}
      {picker && (
        <div className={styles.overlay} onClick={() => setPicker(null)}>
          <div className={styles.pickerModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>Adicionar</div>
                <div className={styles.modalArtist}>{picker.title} — {picker.artist}</div>
              </div>
              <button className={styles.closeBtn} onClick={() => setPicker(null)}>✕</button>
            </div>
            <button className={styles.targetRow} onClick={() => doAdd(picker, null)}>
              <span className={styles.targetIcon}>📚</span>
              <span>Só na biblioteca</span>
            </button>
            {setlists.length > 0 && <div className={styles.targetDivider}>Ou adicionar a uma setlist</div>}
            <div className={styles.targetList}>
              {setlists.map(s => (
                <button key={s.id} className={styles.targetRow} onClick={() => doAdd(picker, s.id)}>
                  <span className={styles.targetIcon}>🎤</span>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
            <button className={styles.newSetlistRow} onClick={() => createSetlistAndAdd(picker)}>
              ＋ Nova setlist
            </button>
          </div>
        </div>
      )}

      {/* MODAL PRÉ-VER */}
      {preview && (
        <div className={styles.overlay} onClick={() => setPreview(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>{preview.result.title}</div>
                <div className={styles.modalArtist}>{preview.result.artist}</div>
              </div>
              <button className={styles.closeBtn} onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className={styles.previewBody}>
              {preview.loading ? (
                <div className={styles.loadingBox}><div className={styles.spinner} /><span>A carregar letra...</span></div>
              ) : preview.lyrics.trim() ? (
                preview.lyrics.split('\n').map((line, i) => (
                  <div key={i} className={line.trim() === '' ? styles.lyricBreak : styles.lyricLine}>{line || ' '}</div>
                ))
              ) : (
                <p className={styles.empty}>Sem letra disponível nesta fonte. Podes adicionar e colar à mão.</p>
              )}
            </div>
            <div className={styles.modalFooter}>
              {preview.lines && <span className={styles.syncNote}>✓ Inclui sincronização ({preview.lines.length} linhas)</span>}
              <button className={styles.addBtn} onClick={() => { const r = preview.result; setPreview(null); setPicker(r) }} disabled={!!saving}>
                + Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ESCREVER / COLAR */}
      {manual && (
        <div className={styles.overlay} onClick={() => setManual(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Nova música</div>
              <button className={styles.closeBtn} onClick={() => setManual(null)}>✕</button>
            </div>
            <div className={styles.manualForm}>
              <div className={styles.manualRow}>
                <input className={styles.manualInput} placeholder="Título" value={manual.title} onChange={e => setManual({ ...manual, title: e.target.value })} />
                <input className={styles.manualInput} placeholder="Artista" value={manual.artist} onChange={e => setManual({ ...manual, artist: e.target.value })} />
              </div>
              <textarea
                className={styles.manualTextarea}
                placeholder="Cola ou escreve a letra aqui...&#10;&#10;[Verso 1]&#10;..."
                value={manual.lyrics}
                onChange={e => setManual({ ...manual, lyrics: e.target.value })}
                rows={12}
              />
            </div>
            <div className={styles.modalFooter}>
              {manual.setlistId && <span className={styles.syncNote}>Será adicionada à setlist escolhida</span>}
              <button className={styles.addBtn} onClick={saveManual} disabled={savingManual || !manual.title.trim() || !manual.artist.trim()}>
                {savingManual ? 'A guardar...' : 'Guardar música'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
