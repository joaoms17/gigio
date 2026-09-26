import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { extractSetlistFromPdf, normalizeTitle, type SetlistEntry } from '../lib/pdfSetlist'
import { searchLrclib, getLrclibLyrics } from '../lib/lrclib'
import { searchGenius } from '../lib/genius'
import { getLyricsOvh } from '../lib/lyricsovh'
import { useAuth } from '../hooks/useAuth'
import { useToast } from './Toast'
import { useConfirm } from './ConfirmDialog'
import type { Song, SearchResult, LyricLine } from '../types'
import styles from './SetlistImportModal.module.css'

interface Props {
  setlistId: string
  projectId: string | null
  currentPosition: number
  onClose: () => void
  onImported: () => void
}

interface MatchedEntry {
  id: string
  entry: SetlistEntry
  checked: boolean
  matches: (Song | null)[]
}

interface LyricsPreview {
  result: SearchResult
  lyrics: string
  loading: boolean
}

type Step = 'upload' | 'review' | 'done' | 'search' | 'bulk'

function matchScore(pdfName: string, result: SearchResult): number {
  const q = normalizeTitle(pdfName)
  const combined = normalizeTitle(`${result.title} ${result.artist}`)
  const titleOnly = normalizeTitle(result.title)
  if (!q) return 0
  if (q === titleOnly || q === combined) return 100
  if (titleOnly.length > 3 && (q.includes(titleOnly) || titleOnly.includes(q)))
    return Math.round(Math.min(q.length, titleOnly.length) / Math.max(q.length, titleOnly.length) * 100)
  const qWords = q.split(/\s+/).filter(w => w.length >= 3)
  const tWords = new Set(combined.split(/\s+/).filter(w => w.length >= 3))
  if (qWords.length === 0) return 0
  const matching = qWords.filter(w => tWords.has(w)).length
  return Math.round(matching / Math.max(qWords.length, tWords.size) * 100)
}

function findMatch(query: string, library: Song[]): Song | null {
  const q = normalizeTitle(query)
  if (!q) return null
  return library.find(s => normalizeTitle(s.title) === q)
    ?? library.find(s => { const t = normalizeTitle(s.title); return t.includes(q) || q.includes(t) })
    ?? null
}

async function fetchResults(query: string): Promise<SearchResult[]> {
  const [lrc, genius] = await Promise.allSettled([searchLrclib(query), searchGenius(query)])
  // Todas as fontes falharam → erro de rede, não "sem correspondência"
  if (lrc.status === 'rejected' && genius.status === 'rejected') {
    throw new Error('Sem ligação — não foi possível pesquisar.')
  }
  const combined = [
    ...(lrc.status === 'fulfilled' ? lrc.value : []),
    ...(genius.status === 'fulfilled' ? genius.value : []),
  ]
  combined.sort((a, b) => (b.has_sync ? 1 : 0) - (a.has_sync ? 1 : 0))
  return combined
}

export default function SetlistImportModal({ setlistId, projectId, currentPosition, onClose, onImported }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<MatchedEntry[]>([])
  const [importing, setImporting] = useState(false)
  const [addedCount, setAddedCount] = useState(0)
  const [missed, setMissed] = useState<string[]>([])

  // Pre-loaded search results — populated in background after import
  // null = a pesquisa falhou (rede), diferente de [] = sem correspondências
  const [preloaded, setPreloaded] = useState<Record<string, SearchResult[] | null>>({})
  const [preloadDone, setPreloadDone] = useState(0)   // how many have finished
  const preloadTotal = useRef(0)

  // Search step
  const [searchQueue, setSearchQueue] = useState<string[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [addedFromSearch, setAddedFromSearch] = useState(0)
  const [lyricsPreview, setLyricsPreview] = useState<LyricsPreview | null>(null)

  const [bulkChecked, setBulkChecked] = useState<Record<string, boolean>>({})
  const [bulkOverrides, setBulkOverrides] = useState<Record<string, SearchResult | null>>({})
  const [bulkExpanded, setBulkExpanded] = useState<string | null>(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  // Progresso item a item do import em lote
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  // Nomes já guardados com sucesso — nunca reprocessados (evita duplicados ao repetir)
  const [bulkAdded, setBulkAdded] = useState<Set<string>>(new Set())

  function handleClose() {
    if (addedCount > 0 || addedFromSearch > 0 || bulkAdded.size > 0) onImported()
    else onClose()
  }

  // Só o ✕ fecha a meio do fluxo, com confirmação quando há estado por terminar
  async function requestClose() {
    if (importing || bulkImporting) return
    const hasWorkInProgress = step === 'review' || step === 'search' || step === 'bulk'
    if (hasWorkInProgress) {
      const ok = await confirm({
        title: 'Descartar importação?',
        message: 'As músicas já adicionadas ficam guardadas, mas o resto da importação será descartado.',
        confirmLabel: 'Descartar',
        danger: true,
      })
      if (!ok) return
    }
    handleClose()
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Por favor seleciona um ficheiro PDF.'); return }
    setError(null); setParsing(true)
    try {
      const parsed = await extractSetlistFromPdf(file)
      if (parsed.length === 0) { setError('Não foram encontradas entradas no PDF.'); setParsing(false); return }
      let library: Song[] = []
      if (projectId) {
        const { data } = await supabase.from('songs').select('*').eq('project_id', projectId)
        library = data ?? []
      }
      setEntries(parsed.map((entry, i) => ({
        id: String(i), entry, checked: true,
        matches: entry.songs.map(name => findMatch(name, library)),
      })))
      setStep('review')
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao processar o PDF.')
    } finally { setParsing(false) }
  }

  const checkedEntries = entries.filter(e => e.checked)
  const totalSongs = checkedEntries.reduce((acc, e) => acc + e.entry.songs.length, 0)
  const foundCount = checkedEntries.reduce((acc, e) => acc + e.matches.filter(Boolean).length, 0)

  // Start pre-fetching results for all missed songs in the background
  function preloadAll(names: string[]) {
    preloadTotal.current = names.length
    setPreloadDone(0)
    setPreloaded({})
    names.forEach(async name => {
      try {
        const results = await fetchResults(name)
        setPreloaded(prev => ({ ...prev, [name]: results }))
      } catch {
        // Falha de rede — marcada como null para não passar por "sem correspondência"
        setPreloaded(prev => ({ ...prev, [name]: null }))
      }
      setPreloadDone(n => n + 1)
    })
  }

  async function handleImport() {
    setImporting(true)
    let pos = currentPosition
    const inserts: { setlist_id: string; song_id: string; position: number }[] = []
    const missedNames: string[] = []
    for (const e of checkedEntries) {
      for (let i = 0; i < e.entry.songs.length; i++) {
        const match = e.matches[i]
        if (match) inserts.push({ setlist_id: setlistId, song_id: match.id, position: pos++ })
        else missedNames.push(e.entry.songs[i])
      }
    }
    if (inserts.length > 0) await Promise.all(inserts.map(row => supabase.from('setlist_songs').insert(row)))
    setAddedCount(inserts.length)
    setMissed(missedNames)
    setImporting(false)
    setStep('done')
    // Pre-load searches for all missed songs immediately
    if (missedNames.length > 0) preloadAll(missedNames)
  }

  function getResultsFor(name: string): SearchResult[] | null | undefined {
    return preloaded[name]
  }

  // Carrega resultados para a query atual; distingue falha de rede de "sem correspondência"
  function loadResults(q: string, force = false) {
    setSearchError(false)
    if (!force) {
      const cached = getResultsFor(q)
      if (cached != null) {
        setSearchResults(cached)
        setSearchLoading(false)
        return
      }
    }
    setSearchResults([])
    setSearchLoading(true)
    fetchResults(q)
      .then(r => { setSearchResults(r); setSearchLoading(false) })
      .catch(() => { setSearchError(true); setSearchLoading(false) })
  }

  function startSearch() {
    const queue = missed.filter(n => !bulkAdded.has(n))
    if (queue.length === 0) { onImported(); return }
    setSearchQueue(queue)
    setSearchIndex(0)
    setAddedFromSearch(0)
    setLyricsPreview(null)
    const first = queue[0]
    setSearchQuery(first ?? '')
    if (first) loadResults(first)
    setStep('search')
  }

  function advanceSearch(didAdd: boolean) {
    if (didAdd) setAddedFromSearch(n => n + 1)
    setLyricsPreview(null)
    const next = searchIndex + 1
    if (next >= searchQueue.length) { onImported(); return }
    setSearchIndex(next)
    const q = searchQueue[next]
    setSearchQuery(q)
    loadResults(q)
  }

  function runManualSearch() {
    if (!searchQuery.trim()) return
    loadResults(searchQuery, true)
  }

  async function openPreview(r: SearchResult) {
    setLyricsPreview({ result: r, lyrics: '', loading: true })
    try {
      let lyrics = ''
      if (r.source === 'lrclib') {
        const d = await getLrclibLyrics(r.external_id)
        lyrics = d.lyrics
      } else {
        lyrics = await getLyricsOvh(r.artist, r.title)
      }
      setLyricsPreview(prev => prev ? { ...prev, lyrics: lyrics || '(Letra não disponível)', loading: false } : null)
    } catch {
      setLyricsPreview(prev => prev ? { ...prev, lyrics: '(Letra não disponível)', loading: false } : null)
    }
  }

  function getBulkResult(name: string): SearchResult | null {
    if (name in bulkOverrides) return bulkOverrides[name]
    return preloaded[name]?.[0] ?? null
  }

  function startBulk() {
    const checked: Record<string, boolean> = {}
    missed.forEach(n => { checked[n] = true })
    setBulkChecked(checked)
    setBulkOverrides({})
    setBulkExpanded(null)
    setStep('bulk')
  }

  async function saveSongAndAdd(r: SearchResult): Promise<void> {
    if (!user) throw new Error('not logged in')
    let lyrics = '', lines: LyricLine[] | null = null
    if (r.source === 'lrclib') {
      const d = await getLrclibLyrics(r.external_id)
      lyrics = d.lyrics; lines = d.lines
    } else {
      lyrics = await getLyricsOvh(r.artist, r.title)
    }
    const { data: song, error: songErr } = await supabase.from('songs').insert({
      owner_id: user.id, title: r.title, artist: r.artist,
      lyrics, original_lyrics: lyrics, edited_lyrics: lyrics,
      source: r.source === 'lrclib' ? 'lrclib' : 'manual',
      source_provider: r.source,
      has_sync: r.has_sync && !!lines,
      duration_sec: r.duration_sec ? Math.round(r.duration_sec) : null,
      project_id: projectId ?? null, is_user_edited: false,
    }).select().single()
    if (songErr) throw songErr
    if (song && lines?.length) await supabase.from('lyric_syncs').insert({ song_id: song.id, lines })
    if (song) {
      const { count } = await supabase.from('setlist_songs').select('*', { count: 'exact', head: true }).eq('setlist_id', setlistId)
      await supabase.from('setlist_songs').insert({ setlist_id: setlistId, song_id: song.id, position: count ?? 0 })
    }
  }

  async function addEmpty(name: string): Promise<void> {
    if (!user) throw new Error('not logged in')
    const { data: song, error: songErr } = await supabase.from('songs').insert({
      owner_id: user.id, title: name, artist: '',
      lyrics: '', original_lyrics: '', edited_lyrics: '',
      source: 'manual', source_provider: 'manual',
      has_sync: false, duration_sec: null,
      project_id: projectId ?? null, is_user_edited: false,
    }).select().single()
    if (songErr) throw songErr
    if (song) {
      const { count } = await supabase.from('setlist_songs').select('*', { count: 'exact', head: true }).eq('setlist_id', setlistId)
      await supabase.from('setlist_songs').insert({ setlist_id: setlistId, song_id: song.id, position: count ?? 0 })
    }
  }

  async function handleBulkImport() {
    setBulkImporting(true)
    // Salta o que já foi adicionado numa tentativa anterior — sem duplicados
    const toProcess = missed.filter(n => bulkChecked[n] !== false && !bulkAdded.has(n))
    let okCount = 0
    let failCount = 0
    for (let i = 0; i < toProcess.length; i++) {
      const name = toProcess[i]
      setBulkProgress({ done: i, total: toProcess.length, current: name })
      try {
        const result = getBulkResult(name)
        if (result) { await saveSongAndAdd(result) } else { await addEmpty(name) }
        okCount++
        setBulkAdded(prev => { const next = new Set(prev); next.add(name); return next })
      } catch {
        // Continua nas falhas individuais; o resumo sai no fim
        failCount++
      }
    }
    setBulkProgress(null)
    setBulkImporting(false)
    const okMsg = `${okCount} adicionada${okCount === 1 ? '' : 's'}`
    if (failCount > 0) {
      toast(`${okMsg}, ${failCount} falh${failCount === 1 ? 'ou' : 'aram'}`, { type: 'error' })
    } else {
      toast(okMsg, { type: 'success' })
      onImported()
    }
  }

  async function pickResult(r: SearchResult) {
    if (!user) return
    const key = `${r.source}-${r.external_id}`
    setSavingKey(key)
    try {
      await saveSongAndAdd(r)
      advanceSearch(true)
    } catch (err: any) {
      toast('Erro ao guardar: ' + (err?.message ?? err), { type: 'error' })
    } finally { setSavingKey(null) }
  }

  const isPreloadingDone = preloadDone >= preloadTotal.current && preloadTotal.current > 0
  const bulkSelected = missed.filter(n => bulkChecked[n] !== false && !bulkAdded.has(n))
  const stepTitle =
    step === 'upload' ? 'Importar concerto de PDF' :
    step === 'review' ? 'Rever entradas' :
    step === 'done'   ? 'Importação concluída' :
    step === 'bulk'   ? `Músicas em falta (${missed.length})` :
    `Pesquisar (${searchIndex + 1}/${searchQueue.length})`

  return (
    <div
      className={styles.overlay}
      onClick={() => { if (step === 'upload' && !parsing) handleClose() }}
    >
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{stepTitle}</span>
          <button className={styles.close} onClick={requestClose}>✕</button>
        </div>

        {step === 'upload' && (
          <div className={styles.body}>
            <div className={styles.uploadZone} onClick={() => fileInputRef.current?.click()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onDragOver={e => e.preventDefault()}
            >
              <div className={styles.uploadIcon}>📄</div>
              <div className={styles.uploadHint}>Clica ou arrasta um PDF aqui</div>
              <div className={styles.uploadSub}>Números e ruído são removidos automaticamente</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf"
              style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            {parsing && <div className={styles.parseSpinner}>A analisar PDF...</div>}
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}

        {step === 'review' && (
          <>
            <div className={styles.reviewInfo}>
              {entries.length} entrada{entries.length !== 1 ? 's' : ''} · {totalSongs} música{totalSongs !== 1 ? 's' : ''} · {foundCount} encontrada{foundCount !== 1 ? 's' : ''} na biblioteca
            </div>
            <div className={styles.entryList}>
              {entries.map(e => (
                <label key={e.id} className={`${styles.entryRow} ${!e.checked ? styles.entryUnchecked : ''}`}>
                  <input type="checkbox" className={styles.checkbox} checked={e.checked}
                    onChange={() => setEntries(prev => prev.map(x => x.id === e.id ? { ...x, checked: !x.checked } : x))} />
                  <div className={styles.entryInfo}>
                    {e.entry.songs.length === 1 ? (
                      <div className={styles.songName}>{e.entry.songs[0]}</div>
                    ) : (
                      <>
                        <div className={styles.medleyLabel}>Medley</div>
                        {e.entry.songs.map((s, i) => <div key={i} className={styles.medleySong}>{s}</div>)}
                      </>
                    )}
                  </div>
                  <div className={styles.matchCol}>
                    {e.entry.songs.map((_s, i) => e.matches[i] ? (
                      <div key={i} className={styles.matchFound}>✓ {e.matches[i]!.title}</div>
                    ) : (
                      <div key={i} className={styles.matchMissed}>? não encontrada</div>
                    ))}
                  </div>
                </label>
              ))}
            </div>
            <div className={styles.footer}>
              <button className={styles.cancelBtn} onClick={onClose}>Cancelar</button>
              <button className={styles.importBtn} onClick={handleImport} disabled={totalSongs === 0 || importing}>
                {importing ? 'A importar...' : `Importar${foundCount > 0 ? ` ${foundCount} encontradas` : ''}`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className={styles.body}>
            <div className={styles.doneIcon}>✅</div>
            <div className={styles.doneTitle}>{addedCount} música{addedCount !== 1 ? 's' : ''} adicionada{addedCount !== 1 ? 's' : ''} da biblioteca</div>
            {missed.length > 0 ? (
              <div className={styles.missedSection}>
                <div className={styles.missedTitle}>{missed.length} não encontrada{missed.length !== 1 ? 's' : ''} na biblioteca</div>
                {missed.map((name, i) => {
                  const pre = preloaded[name]
                  return (
                    <div key={i} className={styles.missedItem}>
                      {name}
                      {Array.isArray(pre) && (
                        <span className={styles.preloadReady}> · {pre.length} resultado{pre.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  )
                })}
                {!isPreloadingDone && preloadTotal.current > 0 && (
                  <div className={styles.preloadProgress}>
                    A pré-carregar pesquisas... {preloadDone}/{preloadTotal.current}
                  </div>
                )}
                <button className={styles.searchMissedBtn} onClick={startBulk}>
                  Pesquisar {missed.length} música{missed.length !== 1 ? 's' : ''} em falta →
                </button>
              </div>
            ) : (
              <button className={styles.doneBtn} onClick={handleClose}>Fechar</button>
            )}
            {missed.length > 0 && (
              <button className={styles.cancelBtn} style={{ display: 'block', margin: '10px auto 0', textAlign: 'center' }} onClick={handleClose}>
                Fechar sem pesquisar
              </button>
            )}
          </div>
        )}

        {step === 'search' && (
          <div className={styles.searchStep}>
            {lyricsPreview ? (
              /* ── Lyrics preview ── */
              <>
                <div className={styles.previewHeader}>
                  <button className={styles.backBtn} onClick={() => setLyricsPreview(null)}>← Voltar</button>
                  <div className={styles.previewMeta}>
                    <div className={styles.previewTitle}>{lyricsPreview.result.title}</div>
                    <div className={styles.previewArtist}>{lyricsPreview.result.artist}</div>
                  </div>
                  <button
                    className={styles.resultAddBtn}
                    onClick={() => pickResult(lyricsPreview.result)}
                    disabled={savingKey !== null}
                  >
                    {savingKey ? '...' : '+ Adicionar'}
                  </button>
                </div>
                <div className={styles.lyricsScroll}>
                  {lyricsPreview.loading
                    ? <div className={styles.parseSpinner}>A carregar letra...</div>
                    : <pre className={styles.lyricsText}>{lyricsPreview.lyrics}</pre>
                  }
                </div>
              </>
            ) : (
              /* ── Results list ── */
              <>
                <div className={styles.searchCurrent}>{searchQueue[searchIndex]}</div>
                <div className={styles.searchForm}>
                  <input
                    className={styles.searchInput}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runManualSearch()}
                    placeholder="Pesquisar..."
                  />
                  <button className={styles.searchBtn} onClick={runManualSearch} disabled={searchLoading}>
                    {searchLoading ? '...' : 'Pesquisar'}
                  </button>
                </div>

                {searchLoading
                  ? <div className={styles.parseSpinner}>A pesquisar...</div>
                  : searchError
                    ? (
                      <div className={styles.noResults}>
                        <div>Sem ligação — não foi possível pesquisar.</div>
                        <button
                          className={styles.retryBtn}
                          onClick={() => loadResults(searchQuery.trim() || searchQueue[searchIndex], true)}
                        >
                          Tentar de novo
                        </button>
                      </div>
                    )
                  : searchResults.length > 0
                    ? (
                      <div className={styles.resultList}>
                        {searchResults.slice(0, 8).map(r => {
                          const key = `${r.source}-${r.external_id}`
                          return (
                            <div key={key} className={styles.resultRow}>
                              <div className={styles.resultInfo}>
                                <div className={styles.resultTitle}>{r.title}</div>
                                <div className={styles.resultArtist}>{r.artist}</div>
                              </div>
                              {r.has_sync && <span className={styles.syncBadge}>sync</span>}
                              <button className={styles.previewBtn} onClick={() => openPreview(r)}>Ver</button>
                              <button
                                className={styles.resultAddBtn}
                                onClick={() => pickResult(r)}
                                disabled={savingKey !== null}
                              >
                                {savingKey === key ? '...' : '+ Adicionar'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    ) : searchQuery
                      ? <div className={styles.noResults}>Sem resultados. Tenta outro nome.</div>
                      : null
                }

                <div className={styles.searchActions}>
                  <button className={styles.skipBtn} onClick={() => advanceSearch(false)} disabled={savingKey !== null}>
                    Saltar →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'bulk' && (
          <div className={styles.searchStep}>
            {bulkProgress ? (
              /* Progresso item a item durante o import em lote */
              <div className={styles.bulkSummary}>
                <div className={styles.bulkSummaryRow}>
                  <span className={styles.bulkProgressLabel}>
                    {bulkProgress.done + 1}/{bulkProgress.total} — {bulkProgress.current}
                  </span>
                </div>
                <div className={styles.bulkProgressBar}>
                  <div className={styles.bulkProgressFill}
                    style={{ width: `${Math.round(bulkProgress.done / bulkProgress.total * 100)}%` }} />
                </div>
              </div>
            ) : (
              <div className={styles.bulkSummary}>
                <div className={styles.bulkSummaryRow}>
                  <span>{bulkSelected.length} de {missed.length} selecionadas</span>
                  {preloadTotal.current > 0 && (
                    <span className={styles.preloadProgress}>
                      {isPreloadingDone
                        ? `${missed.filter(n => (preloaded[n]?.length ?? 0) > 0).length} com resultado`
                        : `A carregar... ${preloadDone}/${preloadTotal.current}`}
                    </span>
                  )}
                </div>
                {preloadTotal.current > 0 && !isPreloadingDone && (
                  <div className={styles.bulkProgressBar}>
                    <div className={styles.bulkProgressFill}
                      style={{ width: `${Math.round(preloadDone / preloadTotal.current * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
            <div className={styles.bulkList}>
              {missed.map(name => {
                const isAdded = bulkAdded.has(name)
                const checked = bulkChecked[name] !== false
                const results = preloaded[name]
                const topResult = getBulkResult(name)
                const isExpanded = bulkExpanded === name
                return (
                  <div key={name}>
                    <label className={`${styles.bulkRow} ${!checked && !isAdded ? styles.bulkUnchecked : ''}`}>
                      <input type="checkbox" className={styles.checkbox}
                        checked={isAdded || checked}
                        disabled={isAdded || bulkImporting}
                        onChange={() => setBulkChecked(prev => ({ ...prev, [name]: !checked }))} />
                      <div className={styles.bulkMain}>
                        <div className={styles.bulkName}>{name}</div>
                        {isAdded ? (
                          <div className={styles.bulkAddedNote}>✓ Adicionada ao concerto</div>
                        ) : topResult ? (
                          <div className={styles.bulkMatchInfo}>
                            <span className={styles.bulkMatchTitle}>{topResult.title}</span>
                            <span className={styles.bulkMatchArtist}> · {topResult.artist}</span>
                            {topResult.has_sync && <span className={styles.syncBadge}>sync</span>}
                            {(() => { const s = matchScore(name, topResult); return (
                              <span className={`${styles.confBadge} ${s >= 80 ? styles.confHigh : s >= 50 ? styles.confMid : styles.confLow}`}>{s}%</span>
                            )})()}
                          </div>
                        ) : results === undefined ? (
                          <div className={styles.bulkLoading}>A carregar...</div>
                        ) : results === null ? (
                          <div className={styles.bulkNoResult}>Sem ligação — a pesquisa falhou; será adicionada sem letra</div>
                        ) : (
                          <div className={styles.bulkNoResult}>Sem resultado — será adicionada sem letra</div>
                        )}
                      </div>
                      {!isAdded && !!results && results.length > 0 && (
                        <button className={styles.bulkChangeBtn} type="button"
                          aria-label={isExpanded ? 'Fechar alternativas' : 'Trocar correspondência'}
                          onClick={() => setBulkExpanded(isExpanded ? null : name)}>
                          {isExpanded ? '▲' : '▾'}
                        </button>
                      )}
                    </label>
                    {isExpanded && (
                      <div className={styles.bulkExpandWrap}>
                        {results?.slice(0, 6).map(r => {
                          const rKey = `${r.source}-${r.external_id}`
                          const tKey = topResult ? `${topResult.source}-${topResult.external_id}` : null
                          const isActive = rKey === tKey
                          return (
                            <div key={rKey}
                              className={`${styles.bulkExpandRow} ${isActive ? styles.bulkExpandRowActive : ''}`}
                              onClick={() => { setBulkOverrides(prev => ({ ...prev, [name]: r })); setBulkExpanded(null) }}>
                              <div className={styles.resultInfo}>
                                <div className={styles.resultTitle}>{r.title}</div>
                                <div className={styles.resultArtist}>{r.artist}</div>
                              </div>
                              {r.has_sync && <span className={styles.syncBadge}>sync</span>}
                              {isActive && <span className={styles.bulkActiveIndicator}>✓</span>}
                            </div>
                          )
                        })}
                        <div className={styles.bulkSemLetraRow}
                          onClick={() => { setBulkOverrides(prev => ({ ...prev, [name]: null })); setBulkExpanded(null) }}>
                          + Sem letra (criar entrada vazia)
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className={styles.footer}>
              <button className={styles.cancelBtn} onClick={startSearch} disabled={bulkImporting}>Um a um →</button>
              <button className={styles.importBtn}
                disabled={bulkImporting || bulkSelected.length === 0}
                onClick={handleBulkImport}>
                {bulkImporting
                  ? 'A guardar...'
                  : `Importar ${bulkSelected.length} música${bulkSelected.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
