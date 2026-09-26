import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../../components/Layout'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
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
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const setlistId = searchParams.get('setlist')

  const [projectName, setProjectName] = useState<string | null>(null)
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
  const [importingPdf, setImportingPdf] = useState(false)
  const [picker, setPicker] = useState<SearchResult | null>(null)
  const [addedToast, setAddedToast] = useState(false)
  const [setlists, setSetlists] = useState<Setlist[]>([])
  const [owned, setOwned] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) return
    supabase.from('setlists').select('*').eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSetlists(data ?? []))
    supabase.from('songs').select('title, artist').eq('owner_id', user.id)
      .then(({ data }) => setOwned(new Set((data ?? []).map(s => `${s.title}::${s.artist}`.toLowerCase()))))
    if (projectId) {
      supabase.from('bands').select('name').eq('id', projectId).single()
        .then(({ data }) => setProjectName(data?.name ?? null))
    }
  }, [user, projectId])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true); setSearched(true); setResults([])
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
    setResults(combined); setLoading(false)
  }

  async function fetchLyrics(r: SearchResult) {
    if (r.source === 'lrclib') {
      const d = await getLrclibLyrics(r.external_id)
      return { lyrics: d.lyrics, lines: d.lines, provider: 'lrclib' }
    }
    const lyrics = await getLyricsOvh(r.artist, r.title)
    return { lyrics, lines: null as LyricLine[] | null, provider: 'lyricsovh' }
  }

  function keyOf(r: SearchResult) { return `${r.source}-${r.external_id}` }

  function alreadyOwned(r: SearchResult) {
    return owned.has(`${r.title}::${r.artist}`.toLowerCase())
  }

  async function openPreview(r: SearchResult) {
    setPreview({ result: r, lyrics: '', lines: null, loading: true })
    const { lyrics, lines } = await fetchLyrics(r)
    setPreview({ result: r, lyrics, lines, loading: false })
  }

  async function insertSong(opts: {
    title: string; artist: string; lyrics: string
    source: SearchResult['source'] | 'manual'
    has_sync: boolean; duration_sec?: number; lines: LyricLine[] | null
    provider?: string
  }): Promise<string | null> {
    if (!user) return null
    const resolvedSource = opts.source === 'lrclib' ? 'lrclib' : 'manual'
    const { data: song, error } = await supabase.from('songs').insert({
      owner_id: user.id,
      title: opts.title,
      artist: opts.artist,
      lyrics: opts.lyrics,
      original_lyrics: opts.lyrics,
      edited_lyrics: opts.lyrics,
      source: resolvedSource,
      source_provider: opts.provider ?? opts.source ?? 'manual',
      has_sync: opts.has_sync,
      duration_sec: opts.duration_sec ? Math.round(opts.duration_sec) : null,
      project_id: projectId ?? null,
      is_user_edited: false,
    }).select().single()
    if (error) throw error
    if (song && opts.lines?.length) {
      await supabase.from('lyric_syncs').insert({ song_id: song.id, lines: opts.lines })
    }
    return song?.id ?? null
  }

  async function addToSetlist(setlistId: string, songId: string) {
    // positions can have gaps after removals, so the row count would collide
    // with the unique (setlist_id, position) constraint — use max position + 1
    const { data: last } = await supabase.from('setlist_songs')
      .select('position').eq('setlist_id', setlistId)
      .order('position', { ascending: false }).limit(1).maybeSingle()
    const { error } = await supabase.from('setlist_songs')
      .insert({ setlist_id: setlistId, song_id: songId, position: (last?.position ?? -1) + 1 })
    if (error) alert('Erro ao adicionar ao concerto: ' + error.message)
  }

  async function doAdd(r: SearchResult, targetSetlistId: string | null, toProject = false) {
    if (!user || saving) return
    setPicker(null)

    // Duplicate guard: same title+artist already in the library → reuse it
    if (alreadyOwned(r)) {
      const useExisting = await confirm({
        title: 'Música já existe',
        message: `Já tens "${r.title}" de ${r.artist} na biblioteca.`,
        confirmLabel: 'Usar a existente',
      })
      if (useExisting) {
        const { data: existing } = await supabase
          .from('songs')
          .select('id')
          .eq('owner_id', user.id)
          .ilike('title', r.title)
          .ilike('artist', r.artist)
          .limit(1)
          .maybeSingle()
        if (existing) {
          if (targetSetlistId) {
            await addToSetlist(targetSetlistId, existing.id)
            if (setlistId) {
              // veio de uma setlist — fica na página de resultados
              setSaved(prev => [...prev, keyOf(r)])
              setAddedToast(true)
            } else {
              navigate(`/setlist/${targetSetlistId}`)
            }
          } else {
            navigate(`/songs/${existing.id}${projectId ? `?project=${projectId}` : ''}`)
          }
          return
        }
        // couldn't find it (odd) — fall through to normal import
      } else {
        const importAgain = await confirm({
          title: 'Importar duplicado?',
          message: `Isto cria uma cópia de "${r.title}" na biblioteca.`,
          confirmLabel: 'Importar de novo',
          danger: true,
        })
        if (!importAgain) return
      }
    }

    setSaving(keyOf(r))
    try {
      const { lyrics, lines, provider } = await fetchLyrics(r)
      if (!lyrics.trim()) {
        setSaving(null)
        setManual({ title: r.title, artist: r.artist, lyrics: '', setlistId: targetSetlistId })
        return
      }
      const songId = await insertSong({
        title: r.title, artist: r.artist, lyrics,
        source: r.source, has_sync: r.has_sync && !!lines,
        duration_sec: r.duration_sec, lines, provider,
      })
      if (songId && targetSetlistId) await addToSetlist(targetSetlistId, songId)
      setSaved(prev => [...prev, keyOf(r)])
      if (songId && targetSetlistId) {
        if (setlistId) {
          // veio de uma setlist — não expulsar da pesquisa a cada adição
          setAddedToast(true)
        } else {
          navigate(`/setlist/${targetSetlistId}`)
        }
      } else if (songId && (toProject || projectId)) {
        navigate(`/songs/${songId}?project=${projectId ?? ''}`)
      }
    } catch (err: any) {
      alert('Erro ao guardar: ' + (err?.message ?? err))
    } finally {
      setSaving(null)
    }
  }

  async function saveManual() {
    if (!manual || !manual.title.trim() || !manual.artist.trim()) return
    setSavingManual(true)
    try {
      const songId = await insertSong({
        title: manual.title.trim(), artist: manual.artist.trim(),
        lyrics: manual.lyrics, source: 'manual', has_sync: false, lines: null, provider: 'manual',
      })
      if (songId && manual.setlistId) await addToSetlist(manual.setlistId, songId)
      setManual(null)
      if (songId && manual.setlistId) {
        if (setlistId) {
          // veio de uma setlist — fica na página, com atalho no toast
          setAddedToast(true)
        } else {
          navigate(`/setlist/${manual.setlistId}`)
        }
      } else if (songId && projectId) {
        navigate(`/songs/${songId}?project=${projectId}`)
      }
    } catch (err: any) {
      alert('Erro ao guardar: ' + (err?.message ?? err))
    } finally {
      setSavingManual(false)
    }
  }

  // Read a PDF and open the manual form pre-filled with the extracted lyrics
  async function importPdf(file: File) {
    setImportingPdf(true)
    try {
      const { extractLyricsFromPdf } = await import('../../lib/pdfLyrics')
      const { lyrics, title, artist } = await extractLyricsFromPdf(file)
      // Never overwrite what the user already typed
      setManual(m => m
        ? { ...m, lyrics, title: m.title || title, artist: m.artist || artist }
        : { title: query || title, artist: artistQuery || artist, lyrics, setlistId })
    } catch (err: any) {
      alert(err?.message ?? 'Não foi possível ler o PDF. Tenta copiar o texto manualmente.')
    } finally {
      setImportingPdf(false)
    }
  }

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          {setlistId ? (
            <Breadcrumbs items={[
              { label: 'Setlist', to: `/setlist/${setlistId}` },
              { label: 'Adicionar música' },
            ]} />
          ) : projectId ? (
            <Breadcrumbs items={[
              { label: 'Projetos', to: '/' },
              { label: projectName ?? 'Projeto', to: `/projects/${projectId}?tab=repertoire` },
              { label: 'Adicionar música' },
            ]} />
          ) : null}
          <h1 className={styles.title}>
            {setlistId ? 'Adicionar música à setlist' : projectId ? 'Adicionar ao repertório' : 'Buscar Letras'}
          </h1>
          {projectId && projectName && (
            <p className={styles.projectCtx}>Projeto: <strong>{projectName}</strong></p>
          )}
          {!projectId && !setlistId && (
            <p className={styles.sub}>LRClib (com sincronização) e lyrics.ovh</p>
          )}
        </div>

        <form onSubmit={handleSearch} className={styles.searchForm}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Título da música..."
            autoFocus
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
              <span>A pesquisar em LRClib e lyrics.ovh...</span>
            </div>
          )}

          {!loading && results.map(r => {
            const k = keyOf(r)
            const isSaved = saved.includes(k)
            const isSaving = saving === k
            return (
              <div key={k} className={styles.resultRow}>
                <div className={styles.info}>
                  <div className={styles.resultTitle}>
                    {r.title}
                    <span className={`${styles.badge} ${r.source === 'lrclib' ? styles.lrclib : styles.text}`}>
                      {r.source === 'lrclib' ? 'LRClib' : 'Texto'}
                    </span>
                    {r.has_sync && <span className={styles.syncBadge}>sync ✓</span>}
                    {alreadyOwned(r) && <span className={styles.ownedBadge}>já tens</span>}
                  </div>
                  <div className={styles.resultArtist}>
                    {r.artist}
                    {r.duration_sec ? ` · ${Math.floor(r.duration_sec / 60)}:${String(Math.floor(r.duration_sec % 60)).padStart(2, '0')}` : ''}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  {!isSaved && (
                    <button className={styles.previewBtn} onClick={() => openPreview(r)} disabled={isSaving}>
                      Pré-ver
                    </button>
                  )}
                  <button
                    className={isSaved ? styles.savedBtn : styles.addBtn}
                    onClick={() => setlistId ? doAdd(r, setlistId) : projectId ? doAdd(r, null, true) : setPicker(r)}
                    disabled={isSaved || !!saving}
                  >
                    {isSaving ? '...' : isSaved ? (setlistId ? '✓ Adicionada' : '✓ Guardado') : '+ Adicionar'}
                  </button>
                </div>
              </div>
            )
          })}

          {!loading && searched && results.length === 0 && (
            <div className={styles.noResults}>
              <p>Não encontrei letra para "{query}".</p>
              <p className={styles.noResultsSub}>Tenta outro título/artista ou adiciona manualmente.</p>
              <button className={styles.manualBtn} onClick={() => setManual({ title: query, artist: artistQuery, lyrics: '', setlistId })}>
                Adicionar manualmente
              </button>
            </div>
          )}
        </div>

        {!searched && (
          <div className={styles.fallback}>
            <span className={styles.fallbackLabel}>Tens uma letra?</span>
            <div className={styles.fallbackBtns}>
              <button className={styles.fallbackBtn} onClick={() => setManual({ title: '', artist: '', lyrics: '', setlistId })}>
                ✏ Escrever / colar manualmente
              </button>
              <label className={`${styles.fallbackBtn} ${importingPdf ? styles.fallbackBtnBusy : ''}`}>
                {importingPdf ? '⏳ A ler PDF...' : '📄 Importar de PDF'}
                <input
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  disabled={importingPdf}
                  onChange={e => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = '' }}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: escolher destino */}
      {picker && !projectId && (
        <div className={styles.overlay} onClick={() => setPicker(null)}>
          <div className={styles.pickerModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>{picker.title}</div>
                <div className={styles.modalArtist}>{picker.artist}</div>
              </div>
              <button className={styles.closeBtn} onClick={() => setPicker(null)}>✕</button>
            </div>
            <button className={styles.targetRow} onClick={() => doAdd(picker, null)}>
              <span className={styles.targetIcon}>📚</span>
              <span>Só na biblioteca</span>
            </button>
            {setlists.length > 0 && <div className={styles.targetDivider}>Ou directo para um concerto</div>}
            <div className={styles.targetList}>
              {setlists.map(s => (
                <button key={s.id} className={styles.targetRow} onClick={() => doAdd(picker, s.id)}>
                  <span className={styles.targetIcon}>🎤</span>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
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
                <p className={styles.empty}>Sem letra disponível nesta fonte. Podes adicionar manualmente.</p>
              )}
            </div>
            <div className={styles.modalFooter}>
              {preview.lines && <span className={styles.syncNote}>✓ Inclui sincronização ({preview.lines.length} linhas)</span>}
              <button
                className={styles.addBtn}
                onClick={() => { const r = preview.result; setPreview(null); setlistId ? doAdd(r, setlistId) : projectId ? doAdd(r, null, true) : setPicker(r) }}
                disabled={!!saving}
              >
                + Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL MANUAL */}
      {manual && (
        <div className={styles.overlay} onClick={() => setManual(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Nova música</div>
              <button className={styles.closeBtn} onClick={() => setManual(null)}>✕</button>
            </div>
            <div className={styles.manualForm}>
              <div className={styles.manualRow}>
                <input className={styles.manualInput} placeholder="Título *" value={manual.title} onChange={e => setManual({ ...manual, title: e.target.value })} />
                <input className={styles.manualInput} placeholder="Artista *" value={manual.artist} onChange={e => setManual({ ...manual, artist: e.target.value })} />
              </div>
              <div className={styles.pdfRow}>
                <label className={styles.pdfBtn}>
                  {importingPdf ? '⏳ A ler PDF...' : '📄 Importar letra de PDF'}
                  <input
                    type="file"
                    accept="application/pdf"
                    style={{ display: 'none' }}
                    disabled={importingPdf}
                    onChange={e => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = '' }}
                  />
                </label>
              </div>
              <textarea
                className={styles.manualTextarea}
                placeholder="Cola ou escreve a letra aqui...&#10;&#10;[Verso 1]&#10;..."
                value={manual.lyrics}
                onChange={e => setManual({ ...manual, lyrics: e.target.value })}
                rows={10}
              />
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.addBtn}
                onClick={saveManual}
                disabled={savingManual || !manual.title.trim() || !manual.artist.trim()}
              >
                {savingManual ? 'A guardar...' : 'Guardar música'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST: adicionada à setlist de origem, sem sair da pesquisa */}
      {addedToast && setlistId && (
        <div className={styles.addedToast} role="status">
          <span>✓ Adicionada ao concerto</span>
          <button className={styles.addedToastLink} onClick={() => navigate(`/setlist/${setlistId}`)}>
            Ver concerto
          </button>
        </div>
      )}
    </Layout>
  )
}
