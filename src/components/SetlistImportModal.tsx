import { useId, useRef, useState, type ReactNode } from 'react'
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

/* ── Apresentação v2 ── */

/** Contagens e posições sempre com 2 dígitos: 01, 02… */
const pad2 = (n: number) => String(n).padStart(2, '0')

function Svg({ size = 20, strokeWidth = 2, className, children }: {
  size?: number; strokeWidth?: number; className?: string; children: ReactNode
}) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}
const IconClose = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>
const IconFile = () => (
  <Svg size={28} strokeWidth={1.75}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
)
const IconUpload = () => <Svg size={18}><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></Svg>
const IconCheck = ({ size = 14 }: { size?: number }) => <Svg size={size} strokeWidth={2.5}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
const IconArrowRight = () => <Svg size={18}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
const IconArrowLeft = () => <Svg size={18}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
const IconPlus = () => <Svg size={18}><path d="M12 5v14M5 12h14" /></Svg>
const IconEye = () => (
  <Svg size={18}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)
const IconChevronDown = ({ className }: { className?: string }) => <Svg className={className}><path d="M6 9l6 6 6-6" /></Svg>
const IconSearch = ({ size = 18 }: { size?: number }) => (
  <Svg size={size} strokeWidth={size > 20 ? 1.75 : 2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>
)
const IconOffline = () => (
  <Svg size={28} strokeWidth={1.75}>
    <path d="M2 2l20 20M16.7 11.1a11 11 0 0 1 2.3 1.5M5 12.6a11 11 0 0 1 5.2-2.4M10.7 5.1A16 16 0 0 1 22.6 9M1.4 9a16 16 0 0 1 4.7-2.9M8.5 16.1a6 6 0 0 1 7 0M12 20h.01" />
  </Svg>
)
const IconAlert = () => <Svg size={18}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></Svg>

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
  const titleId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
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
    // Base = max(position)+1 — o comprimento da lista colide com o unique
    // (setlist_id, position) quando há buracos deixados por remoções
    const { data: last } = await supabase.from('setlist_songs')
      .select('position').eq('setlist_id', setlistId)
      .order('position', { ascending: false }).limit(1).maybeSingle()
    let pos = Math.max(currentPosition, (last?.position ?? -1) + 1)
    const inserts: { setlist_id: string; song_id: string; position: number }[] = []
    const missedNames: string[] = []
    for (const e of checkedEntries) {
      for (let i = 0; i < e.entry.songs.length; i++) {
        const match = e.matches[i]
        if (match) inserts.push({ setlist_id: setlistId, song_id: match.id, position: pos++ })
        else missedNames.push(e.entry.songs[i])
      }
    }
    let inserted = inserts.length
    if (inserts.length > 0) {
      const results = await Promise.all(inserts.map(row => supabase.from('setlist_songs').insert(row)))
      inserted = results.filter(r => !r.error).length
      if (inserted < inserts.length) {
        toast(`${inserts.length - inserted} música${inserts.length - inserted === 1 ? ' não foi adicionada' : 's não foram adicionadas'} ao concerto`, { type: 'error' })
      }
    }
    setAddedCount(inserted)
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
    if (song) await addToSetlist(song.id)
  }

  // Posição = max(position)+1 — usar o count colide com o unique
  // (setlist_id, position) quando há buracos deixados por remoções
  async function addToSetlist(songId: string): Promise<void> {
    const { data: last } = await supabase.from('setlist_songs')
      .select('position').eq('setlist_id', setlistId)
      .order('position', { ascending: false }).limit(1).maybeSingle()
    const { error } = await supabase.from('setlist_songs')
      .insert({ setlist_id: setlistId, song_id: songId, position: (last?.position ?? -1) + 1 })
    if (error) throw error
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
    if (song) await addToSetlist(song.id)
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
    step === 'bulk'   ? 'Músicas em falta' :
    (searchQueue[searchIndex] ?? 'Pesquisar')
  // Micro-rótulo mono por cima do título — passo / contagem
  const stepKicker =
    step === 'upload' ? 'Passo 01 / 03 · Ficheiro' :
    step === 'review' ? 'Passo 02 / 03 · Rever' :
    step === 'done'   ? 'Passo 03 / 03 · Resultado' :
    step === 'bulk'   ? `Em falta · ${pad2(missed.length)}` :
    `Pesquisar · ${pad2(searchIndex + 1)} / ${pad2(searchQueue.length)}`
  const withResultCount = missed.filter(n => (preloaded[n]?.length ?? 0) > 0).length

  function confClass(score: number) {
    return score >= 80 ? styles.chipOk : score >= 50 ? styles.chipWarn : styles.chipDanger
  }

  return (
    <div
      className={styles.overlay}
      onClick={() => { if (step === 'upload' && !parsing) handleClose() }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headText}>
            <div className={styles.kicker}>{stepKicker}</div>
            <h2 id={titleId} className={styles.title}>{stepTitle}</h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={requestClose}
            disabled={importing || bulkImporting}
            aria-label="Fechar"
          >
            <IconClose />
          </button>
        </header>

        {/* ═══ 01 · Ficheiro ═══ */}
        {step === 'upload' && (
          <div className={styles.scroll}>
            <button
              type="button"
              className={`${styles.dropZone} ${dragOver ? styles.dropZoneOver : ''}`}
              aria-label="Escolher PDF da setlist"
              aria-disabled={parsing}
              aria-describedby={`${titleId}-drop`}
              onClick={() => { if (!parsing) fileInputRef.current?.click() }}
              onDrop={e => {
                e.preventDefault(); setDragOver(false)
                if (parsing) return
                const f = e.dataTransfer.files[0]; if (f) handleFile(f)
              }}
              onDragOver={e => { e.preventDefault(); if (!dragOver && !parsing) setDragOver(true) }}
              onDragLeave={e => {
                // Ignora a passagem para elementos filhos (evita piscar o estado)
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
              }}
            >
              <span className={styles.dropIcon}><IconFile /></span>
              <span className={styles.dropTitle}>{dragOver ? 'Larga para importar' : 'Setlist em PDF'}</span>
              <span id={`${titleId}-drop`} className={styles.dropSub}>Números e ruído são removidos automaticamente</span>
              <span className={styles.dropCta} aria-hidden="true"><IconUpload />Escolher PDF</span>
              <span className={styles.dropMeta}>ou arrasta o ficheiro para aqui</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                // Limpa o valor para permitir voltar a escolher o mesmo ficheiro após um erro
                e.target.value = ''
                if (f) handleFile(f)
              }} />
            {parsing && (
              <div className={styles.status} role="status">
                <div className={styles.progressLabel}>A analisar PDF…</div>
                <div className={styles.track}><div className={styles.indeterminate} /></div>
              </div>
            )}
            {error && (
              <div className={styles.error} role="alert">
                <IconAlert />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {/* ═══ 02 · Rever ═══ */}
        {step === 'review' && (
          <>
            <div className={styles.strip}>
              <div className={styles.stripGroup}>
                <span><b className={styles.stripNum}>{pad2(entries.length)}</b> entrada{entries.length !== 1 ? 's' : ''}</span>
                <span className={styles.sep} aria-hidden="true">·</span>
                <span><b className={styles.stripNum}>{pad2(totalSongs)}</b> música{totalSongs !== 1 ? 's' : ''}</span>
                <span className={styles.sep} aria-hidden="true">·</span>
                <span><b className={styles.stripNum}>{pad2(foundCount)}</b> na biblioteca</span>
              </div>
            </div>
            <div className={styles.scroll}>
              <div className={styles.list}>
                {entries.map((e, idx) => (
                  <label key={e.id} className={`${styles.row} ${styles.entryRow} ${!e.checked ? styles.rowOff : ''}`}>
                    <input type="checkbox" className={styles.checkbox} checked={e.checked}
                      onChange={() => setEntries(prev => prev.map(x => x.id === e.id ? { ...x, checked: !x.checked } : x))} />
                    <span className={styles.num}>{pad2(idx + 1)}</span>
                    <span className={styles.entryInfo}>
                      {e.entry.songs.length > 1 && (
                        <span className={styles.medleyLabel}>Medley · {pad2(e.entry.songs.length)}</span>
                      )}
                      <span className={e.entry.songs.length > 1 ? styles.medleySongs : styles.singleSong}>
                        {e.entry.songs.map((s, i) => {
                          const m = e.matches[i]
                          return (
                            <span key={i} className={styles.songLine}>
                              <span className={styles.songText}>
                                <span className={styles.songName}>{s}</span>
                                {m && normalizeTitle(m.title) !== normalizeTitle(s) && (
                                  <span className={styles.matchTitle}>
                                    <IconArrowRight />
                                    <span className={styles.matchTitleText}>{m.title}</span>
                                  </span>
                                )}
                              </span>
                              {m
                                ? <span className={`${styles.chip} ${styles.chipOk}`}><IconCheck size={11} />Biblioteca</span>
                                : <span className={`${styles.chip} ${styles.chipWarn}`}>Em falta</span>}
                            </span>
                          )
                        })}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className={styles.footer}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
              <button type="button" className={styles.btnPrimary} onClick={handleImport} disabled={totalSongs === 0 || importing}>
                {importing ? 'A importar…' : `Importar${foundCount > 0 ? ` ${foundCount} encontradas` : ''}`}
              </button>
            </div>
          </>
        )}

        {/* ═══ 03 · Resultado ═══ */}
        {step === 'done' && (
          <>
            <div className={styles.scroll}>
              <div className={styles.readout}>
                <div className={styles.readoutCell}>
                  <span className={styles.readoutNum}>{pad2(addedCount)}</span>
                  <span className={styles.readoutLabel}>
                    música{addedCount !== 1 ? 's' : ''} adicionada{addedCount !== 1 ? 's' : ''} da biblioteca
                  </span>
                </div>
                <div className={styles.readoutCell}>
                  <span className={`${styles.readoutNum} ${missed.length > 0 ? styles.readoutWarn : ''}`}>{pad2(missed.length)}</span>
                  <span className={styles.readoutLabel}>
                    não encontrada{missed.length !== 1 ? 's' : ''} na biblioteca
                  </span>
                </div>
              </div>

              {missed.length > 0 && (
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <span className={styles.label}>Em falta · pesquisa online</span>
                  </div>
                  {!isPreloadingDone && preloadTotal.current > 0 && (
                    <div className={styles.progress} role="status">
                      <div className={styles.progressLabel}>
                        <span className={styles.progressCount}>{pad2(preloadDone)}/{pad2(preloadTotal.current)}</span>
                        <span className={styles.progressSep} aria-hidden="true">—</span>
                        <span className={styles.progressTitle}>A pré-carregar pesquisas…</span>
                      </div>
                      <div className={styles.track}>
                        <div className={styles.fill}
                          style={{ width: `${Math.round(preloadDone / preloadTotal.current * 100)}%` }} />
                      </div>
                    </div>
                  )}
                  <div className={styles.list}>
                    {missed.map((name, i) => {
                      const pre = preloaded[name]
                      return (
                        <div key={i} className={`${styles.row} ${styles.missedRow}`}>
                          <span className={styles.num}>{pad2(i + 1)}</span>
                          <span className={styles.missedName}>{name}</span>
                          {Array.isArray(pre) ? (
                            <span className={`${styles.chip} ${pre.length > 0 ? styles.chipOk : ''}`}>
                              {pre.length} resultado{pre.length !== 1 ? 's' : ''}
                            </span>
                          ) : pre === null ? (
                            <span className={`${styles.chip} ${styles.chipWarn}`}>Sem ligação</span>
                          ) : (
                            <span className={styles.chip}>A pesquisar</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
            <div className={`${styles.footer} ${styles.footerStack}`}>
              {missed.length > 0 ? (
                <>
                  <button type="button" className={styles.btnSecondary} onClick={handleClose}>
                    Fechar sem pesquisar
                  </button>
                  <button type="button" className={styles.btnPrimary} onClick={startBulk}>
                    Pesquisar {missed.length} música{missed.length !== 1 ? 's' : ''} em falta
                    <IconArrowRight />
                  </button>
                </>
              ) : (
                <button type="button" className={styles.btnPrimary} onClick={handleClose}>Fechar</button>
              )}
            </div>
          </>
        )}

        {/* ═══ Pesquisa um a um ═══ */}
        {step === 'search' && (
          lyricsPreview ? (
            /* ── Pré-visualização da letra ── */
            <>
              <div className={styles.previewBar}>
                <button type="button" className={styles.btnGhost} onClick={() => setLyricsPreview(null)}>
                  <IconArrowLeft />
                  <span>Voltar</span>
                </button>
                <div className={styles.previewMeta}>
                  <div className={styles.previewTitle}>{lyricsPreview.result.title}</div>
                  <div className={styles.previewArtist}>{lyricsPreview.result.artist}</div>
                </div>
                {lyricsPreview.result.has_sync && <span className={`${styles.chip} ${styles.chipOk}`}>Sync</span>}
              </div>
              <div className={styles.scroll}>
                {lyricsPreview.loading ? (
                  <div className={styles.skelLines} role="status" aria-label="A carregar letra">
                    {[72, 58, 80, 44, 66, 52, 76, 38].map((w, i) => (
                      <span key={i} className={`skeleton ${styles.skelLine}`} style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : (
                  <pre className={styles.lyricsText}>{lyricsPreview.lyrics}</pre>
                )}
              </div>
              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => pickResult(lyricsPreview.result)}
                  disabled={savingKey !== null}
                >
                  {savingKey ? 'A guardar…' : <><IconPlus />Adicionar ao concerto</>}
                </button>
              </div>
            </>
          ) : (
            /* ── Lista de resultados ── */
            <>
              <div className={styles.toolbar}>
                <div className={styles.searchField}>
                  <span className={styles.searchIcon}><IconSearch /></span>
                  <input
                    className={styles.input}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runManualSearch()}
                    placeholder="Pesquisar..."
                    aria-label="Pesquisar título ou artista"
                    enterKeyHint="search"
                  />
                </div>
                <button type="button" className={styles.btnSecondary} onClick={runManualSearch} disabled={searchLoading}>
                  {searchLoading ? '…' : 'Pesquisar'}
                </button>
              </div>

              <div className={styles.scroll}>
                {searchLoading ? (
                  <div className={styles.list} role="status" aria-label="A pesquisar">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className={`${styles.row} ${styles.skelRow}`}>
                        <span className={`skeleton ${styles.skelTitle}`} />
                        <span className={`skeleton ${styles.skelSub}`} />
                      </div>
                    ))}
                  </div>
                ) : searchError ? (
                  <div className={styles.empty}>
                    <span className={styles.emptyIcon}><IconOffline /></span>
                    <div className={styles.emptyTitle}>Sem ligação</div>
                    <p className={styles.emptyText}>Não foi possível pesquisar.</p>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={() => loadResults(searchQuery.trim() || searchQueue[searchIndex], true)}
                    >
                      Tentar de novo
                    </button>
                  </div>
                ) : searchResults.length > 0 ? (
                  <>
                    <div className={styles.sectionHead}>
                      <span className={styles.label}>Resultados · {pad2(Math.min(searchResults.length, 8))}</span>
                    </div>
                    <div className={styles.list}>
                      {searchResults.slice(0, 8).map(r => {
                        const key = `${r.source}-${r.external_id}`
                        return (
                          <div key={key} className={`${styles.row} ${styles.resultRow}`}>
                            <div className={styles.resultInfo}>
                              <div className={styles.resultTitle}>{r.title}</div>
                              <div className={styles.resultMeta}>
                                <span className={styles.resultArtist}>{r.artist}</span>
                                {r.has_sync && <span className={`${styles.chip} ${styles.chipOk}`}>Sync</span>}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`${styles.btnSecondary} ${styles.btnCompact}`}
                              onClick={() => openPreview(r)}
                              aria-label={`Ver letra de ${r.title}`}
                            >
                              <IconEye />
                              <span className={styles.btnText}>Ver</span>
                            </button>
                            <button
                              type="button"
                              className={`${styles.btnSecondary} ${styles.btnCompact}`}
                              onClick={() => pickResult(r)}
                              disabled={savingKey !== null}
                              aria-label={`Adicionar ${r.title}`}
                            >
                              {savingKey === key
                                ? <span className={styles.busy}>…</span>
                                : <><IconPlus /><span className={styles.btnText}>Adicionar</span></>}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </>
                ) : searchQuery ? (
                  <div className={styles.empty}>
                    <span className={styles.emptyIcon}><IconSearch size={28} /></span>
                    <div className={styles.emptyTitle}>Sem resultados</div>
                    <p className={styles.emptyText}>Tenta outro nome.</p>
                  </div>
                ) : null}
              </div>

              <div className={styles.footer}>
                <span className={styles.footerMeta}>
                  {addedFromSearch > 0 && `${pad2(addedFromSearch)} adicionada${addedFromSearch !== 1 ? 's' : ''}`}
                </span>
                <button type="button" className={styles.btnSecondary} onClick={() => advanceSearch(false)} disabled={savingKey !== null}>
                  Saltar
                  <IconArrowRight />
                </button>
              </div>
            </>
          )
        )}

        {/* ═══ Em falta · importação em lote ═══ */}
        {step === 'bulk' && (
          <>
            <div className={styles.strip}>
              {bulkProgress ? (
                /* Progresso item a item durante o import em lote */
                <div className={styles.progress} role="status">
                  <div className={styles.progressLabel}>
                    <span className={styles.progressCount}>
                      {pad2(bulkProgress.done + 1)}/{pad2(bulkProgress.total)}
                    </span>
                    <span className={styles.progressSep} aria-hidden="true">—</span>
                    <span className={styles.progressTitle}>{bulkProgress.current}</span>
                  </div>
                  <div className={styles.track}>
                    <div className={styles.fill}
                      style={{ width: `${Math.round(bulkProgress.done / bulkProgress.total * 100)}%` }} />
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.stripRow}>
                    <span>
                      <b className={styles.stripNum}>{pad2(bulkSelected.length)}</b> de {pad2(missed.length)} selecionadas
                    </span>
                    {preloadTotal.current > 0 && (
                      <span>
                        {isPreloadingDone
                          ? <><b className={styles.stripNum}>{pad2(withResultCount)}</b> com resultado</>
                          : `A carregar · ${pad2(preloadDone)}/${pad2(preloadTotal.current)}`}
                      </span>
                    )}
                  </div>
                  {preloadTotal.current > 0 && !isPreloadingDone && (
                    <div className={`${styles.track} ${styles.stripTrack}`}>
                      <div className={styles.fill}
                        style={{ width: `${Math.round(preloadDone / preloadTotal.current * 100)}%` }} />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className={styles.scroll}>
              <div className={styles.list}>
                {missed.map((name, idx) => {
                  const isAdded = bulkAdded.has(name)
                  const checked = bulkChecked[name] !== false
                  const results = preloaded[name]
                  const topResult = getBulkResult(name)
                  const isExpanded = bulkExpanded === name
                  return (
                    <div key={name}>
                      <label className={`${styles.row} ${styles.bulkRow} ${!checked && !isAdded ? styles.rowOff : ''}`}>
                        <input type="checkbox" className={styles.checkbox}
                          checked={isAdded || checked}
                          disabled={isAdded || bulkImporting}
                          onChange={() => setBulkChecked(prev => ({ ...prev, [name]: !checked }))} />
                        <span className={styles.num}>{pad2(idx + 1)}</span>
                        <span className={styles.bulkMain}>
                          <span className={styles.songName}>{name}</span>
                          {isAdded ? (
                            <span className={styles.bulkAdded}><IconCheck />Adicionada ao concerto</span>
                          ) : topResult ? (
                            <span className={styles.bulkMeta}>
                              <span className={styles.bulkMatch}>
                                {topResult.title}
                                <span className={styles.bulkMatchArtist}> · {topResult.artist}</span>
                              </span>
                              {topResult.has_sync && <span className={`${styles.chip} ${styles.chipOk}`}>Sync</span>}
                              {(() => {
                                const s = matchScore(name, topResult)
                                return <span className={`${styles.chip} ${confClass(s)}`}>{s}%</span>
                              })()}
                            </span>
                          ) : results === undefined ? (
                            <span className={styles.bulkNote}>A carregar…</span>
                          ) : results === null ? (
                            <span className={`${styles.bulkNote} ${styles.bulkNoteWarn}`}>
                              Sem ligação — a pesquisa falhou; será adicionada sem letra
                            </span>
                          ) : (
                            <span className={styles.bulkNote}>Sem resultado — será adicionada sem letra</span>
                          )}
                        </span>
                        {!isAdded && !!results && results.length > 0 && (
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${isExpanded ? styles.iconBtnOn : ''}`}
                            aria-label={isExpanded ? 'Fechar alternativas' : 'Trocar correspondência'}
                            aria-expanded={isExpanded}
                            onClick={() => setBulkExpanded(isExpanded ? null : name)}
                          >
                            <IconChevronDown className={`${styles.chev} ${isExpanded ? styles.chevUp : ''}`} />
                          </button>
                        )}
                      </label>

                      {isExpanded && (
                        <div className={styles.alts}>
                          <div className={styles.altsLabel}>Alternativas</div>
                          {results?.slice(0, 6).map(r => {
                            const rKey = `${r.source}-${r.external_id}`
                            const tKey = topResult ? `${topResult.source}-${topResult.external_id}` : null
                            const isActive = rKey === tKey
                            return (
                              <button
                                type="button"
                                key={rKey}
                                className={`${styles.altRow} ${isActive ? styles.altRowActive : ''}`}
                                aria-pressed={isActive}
                                onClick={() => { setBulkOverrides(prev => ({ ...prev, [name]: r })); setBulkExpanded(null) }}
                              >
                                <span className={styles.resultInfo}>
                                  <span className={styles.resultTitle}>{r.title}</span>
                                  <span className={styles.resultMeta}>
                                    <span className={styles.resultArtist}>{r.artist}</span>
                                    {r.has_sync && <span className={`${styles.chip} ${styles.chipOk}`}>Sync</span>}
                                  </span>
                                </span>
                                {isActive && <span className={styles.altCheck}><IconCheck size={18} /></span>}
                              </button>
                            )
                          })}
                          <button
                            type="button"
                            className={`${styles.altRow} ${styles.altEmpty}`}
                            onClick={() => { setBulkOverrides(prev => ({ ...prev, [name]: null })); setBulkExpanded(null) }}
                          >
                            <IconPlus />
                            Sem letra (criar entrada vazia)
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.btnSecondary} onClick={startSearch} disabled={bulkImporting}>
                Um a um
                <IconArrowRight />
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={bulkImporting || bulkSelected.length === 0}
                onClick={handleBulkImport}
              >
                {bulkImporting
                  ? 'A guardar…'
                  : `Importar ${bulkSelected.length} música${bulkSelected.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
