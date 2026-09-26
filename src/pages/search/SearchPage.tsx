import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
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

/* ── Ícones SVG inline ── */

function IconSearch({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}

function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconX({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

function IconFile({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
      <polyline points="14 2 14 7 19 7" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  )
}

function IconPencil({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function IconBook({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  )
}

function IconMic({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  )
}

function IconAlert({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export default function SearchPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const setlistId = searchParams.get('setlist')

  const [projectName, setProjectName] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [artistQuery, setArtistQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState(false)
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

  async function runSearch() {
    if (!query.trim()) return
    setLoading(true); setSearched(true); setResults([]); setSearchError(false)
    const geniusQuery = artistQuery.trim() ? `${query} ${artistQuery}` : query
    const [lrc, genius] = await Promise.allSettled([
      searchLrclib(query, artistQuery),
      searchGenius(geniusQuery),
    ])
    // Todas as fontes falharam → erro de rede, não "sem resultados"
    if (lrc.status === 'rejected' && genius.status === 'rejected') {
      setSearchError(true); setLoading(false)
      return
    }
    const combined: SearchResult[] = [
      ...(lrc.status === 'fulfilled' ? lrc.value : []),
      ...(genius.status === 'fulfilled' ? genius.value : []),
    ]
    combined.sort((a, b) => (b.has_sync ? 1 : 0) - (a.has_sync ? 1 : 0))
    setResults(combined); setLoading(false)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    runSearch()
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
    if (error) toast('Erro ao adicionar ao concerto: ' + error.message, { type: 'error' })
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
      toast('Erro ao guardar: ' + (err?.message ?? err), { type: 'error' })
    } finally {
      setSaving(null)
    }
  }

  // Cria uma setlist pessoal a partir do picker e adiciona logo a música
  async function createSetlistAndAdd(r: SearchResult) {
    if (!user) return
    const { data, error } = await supabase.from('setlists')
      .insert({ name: 'Novo Concerto', owner_id: user.id })
      .select().single()
    if (error || !data) {
      toast('Erro ao criar concerto: ' + (error?.message ?? 'tenta de novo'), { type: 'error' })
      return
    }
    setSetlists(prev => [data, ...prev])
    doAdd(r, data.id)
  }

  // Fechar o modal manual sem descartar letra por engano:
  // clique no overlay só fecha com o campo vazio; o ✕ confirma quando há texto
  async function closeManual(viaOverlay: boolean) {
    if (!manual) return
    const hasLyrics = manual.lyrics.trim().length > 0
    if (hasLyrics) {
      if (viaOverlay) return
      const ok = await confirm({
        title: 'Descartar letra?',
        message: 'A letra que escreveste ou colaste será perdida.',
        confirmLabel: 'Descartar',
        danger: true,
      })
      if (!ok) return
    }
    setManual(null)
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
      toast('Erro ao guardar: ' + (err?.message ?? err), { type: 'error' })
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
      toast(err?.message ?? 'Não foi possível ler o PDF. Tenta copiar o texto manualmente.', { type: 'error' })
    } finally {
      setImportingPdf(false)
    }
  }

  return (
    <>
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

        {/* ── Pesquisa como herói ── */}
        <form onSubmit={handleSearch} className={styles.searchHero}>
          <div className={styles.heroRow}>
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon}><IconSearch /></span>
              <input
                className={styles.searchInput}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Título da música..."
                autoFocus
              />
            </div>
            <label className={`${styles.pdfHeroBtn} ${importingPdf ? styles.btnBusy : ''}`}>
              <IconFile />
              <span className={styles.pdfHeroLabel}>{importingPdf ? 'A ler PDF...' : 'Importar PDF'}</span>
              <input
                type="file"
                accept="application/pdf"
                style={{ display: 'none' }}
                disabled={importingPdf}
                onChange={e => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = '' }}
              />
            </label>
          </div>
          <div className={styles.heroSubRow}>
            <input
              className={styles.artistInput}
              value={artistQuery}
              onChange={e => setArtistQuery(e.target.value)}
              placeholder="Artista (opcional)"
            />
            <button className={styles.searchBtn} type="submit" disabled={loading}>
              {loading ? 'A pesquisar...' : 'Pesquisar'}
            </button>
          </div>
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
              <div key={k} className={styles.resultCard}>
                <div className={styles.info}>
                  <div className={styles.resultTitle}>
                    {r.title}
                    <span className={`${styles.badge} ${r.source === 'lrclib' ? styles.badgeLrclib : styles.badgeText}`}>
                      {r.source === 'lrclib' ? 'LRClib' : 'Texto'}
                    </span>
                    {r.has_sync && (
                      <span className={styles.syncBadge}>
                        <IconCheck size={11} />
                        sync
                      </span>
                    )}
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
                    {isSaving ? (
                      '...'
                    ) : isSaved ? (
                      <>
                        <IconCheck />
                        {setlistId ? 'Adicionada' : 'Guardado'}
                      </>
                    ) : (
                      <>
                        <IconPlus />
                        Adicionar
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })}

          {!loading && searched && searchError && (
            <div className={styles.stateCard}>
              <div className={`${styles.stateIcon} ${styles.stateIconError}`}><IconAlert /></div>
              <p className={styles.stateTitle}>Sem ligação — não foi possível pesquisar.</p>
              <p className={styles.stateSub}>Verifica a internet e tenta de novo.</p>
              <button className={styles.manualBtn} onClick={runSearch}>
                Tentar de novo
              </button>
            </div>
          )}

          {!loading && searched && !searchError && results.length === 0 && (
            <div className={styles.stateCard}>
              <div className={styles.stateIcon}><IconSearch size={26} /></div>
              <p className={styles.stateTitle}>Não encontrei letra para "{query}".</p>
              <p className={styles.stateSub}>Tenta outro título/artista ou adiciona manualmente.</p>
              <button className={styles.manualBtn} onClick={() => setManual({ title: query, artist: artistQuery, lyrics: '', setlistId })}>
                <IconPencil />
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
                <IconPencil />
                Escrever / colar manualmente
              </button>
              <label className={`${styles.fallbackBtn} ${importingPdf ? styles.btnBusy : ''}`}>
                <IconFile size={16} />
                {importingPdf ? 'A ler PDF...' : 'Importar de PDF'}
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
              <button className={styles.closeBtn} onClick={() => setPicker(null)} aria-label="Fechar">
                <IconX />
              </button>
            </div>
            <button className={styles.targetRow} onClick={() => doAdd(picker, null)}>
              <span className={styles.targetIcon}><IconBook /></span>
              <span>Só na biblioteca</span>
            </button>
            {setlists.length > 0 && <div className={styles.targetDivider}>Ou directo para um concerto</div>}
            <div className={styles.targetList}>
              {setlists.map(s => (
                <button key={s.id} className={styles.targetRow} onClick={() => doAdd(picker, s.id)}>
                  <span className={styles.targetIcon}><IconMic /></span>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
            <button className={styles.newSetlistRow} onClick={() => createSetlistAndAdd(picker)}>
              <IconPlus />
              Novo concerto
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
              <button className={styles.closeBtn} onClick={() => setPreview(null)} aria-label="Fechar">
                <IconX />
              </button>
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
              {preview.lines && (
                <span className={styles.syncNote}>
                  <IconCheck />
                  Inclui sincronização ({preview.lines.length} linhas)
                </span>
              )}
              <button
                className={styles.addBtn}
                onClick={() => { const r = preview.result; setPreview(null); setlistId ? doAdd(r, setlistId) : projectId ? doAdd(r, null, true) : setPicker(r) }}
                disabled={!!saving}
              >
                <IconPlus />
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL MANUAL */}
      {manual && (
        <div className={styles.overlay} onClick={() => closeManual(true)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Nova música</div>
              <button className={styles.closeBtn} onClick={() => closeManual(false)} aria-label="Fechar">
                <IconX />
              </button>
            </div>
            <div className={styles.manualForm}>
              <div className={styles.manualRow}>
                <input className={styles.manualInput} placeholder="Título *" value={manual.title} onChange={e => setManual({ ...manual, title: e.target.value })} />
                <input className={styles.manualInput} placeholder="Artista *" value={manual.artist} onChange={e => setManual({ ...manual, artist: e.target.value })} />
              </div>
              <div className={styles.pdfRow}>
                <label className={`${styles.pdfBtn} ${importingPdf ? styles.btnBusy : ''}`}>
                  <IconFile size={16} />
                  {importingPdf ? 'A ler PDF...' : 'Importar letra de PDF'}
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
          <span className={styles.addedToastMsg}>
            <IconCheck size={15} />
            Adicionada ao concerto
          </span>
          <button className={styles.addedToastLink} onClick={() => navigate(`/setlist/${setlistId}`)}>
            Ver concerto
          </button>
        </div>
      )}
    </>
  )
}
