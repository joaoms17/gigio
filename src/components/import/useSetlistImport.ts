/* ═══════════════════════════════════════════════════════════════
   useSetlistImport — estado do importador (fonte → revisão → gravar).
   Liga o motor (src/lib/setlistImport) aos componentes <ImportSource>
   e <ImportReview>. Usado pelo SetlistImportModal (acrescentar a um
   concerto) e pelo wizard de criação de concertos.
═══════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  forceEntry, parseSetlist, tidyTitle, type ParseOptions, type SetlistDocMeta, type SkippedLine,
} from '../../lib/setlistImport/parse'
import { matchLibrary, rankResults, searchQueryFor, type RankedResult } from '../../lib/setlistImport/match'
import {
  autoOnlineChoice, countRows, entriesToRows, insertIndexFor, markRepeats, rowQuery, songsToRows,
} from '../../lib/setlistImport/rows'
import { createResolver, type OnlineOutcome, type Resolver } from '../../lib/setlistImport/resolve'
import {
  fileBaseName, fileKind, readImages, readPdf, readTextFile, sourcePreview, type SourceText,
} from '../../lib/setlistImport/sources'
import { commitRows, summarizeCommit } from '../../lib/setlistImport/commit'
import { ImportError, humanizeError, importErrorMessage, isAbort } from '../../lib/setlistImport/errors'
import type {
  CommitProgress, ImportCommitResult, ImportCounts, ImportProgress, ImportRow, ImportSourceKind,
  LibrarySong, RowChoice, SetlistSongExtra,
} from '../../lib/setlistImport/types'

export interface UseSetlistImportOptions {
  /** Banda/projeto cujo repertório serve de correspondência (e onde as músicas novas são criadas); null = pessoal */
  projectId: string | null
  /**
   * false = o destino ainda não é conhecido (projetos a carregar/falharam): não carrega
   * repertório nenhum — as linhas ficam "a procurar" e não se grava.
   */
  ready?: boolean
  /** Pesquisar online automaticamente as linhas que não estão no repertório (predefinição: true) */
  autoResolve?: boolean
}

export interface ImportSourceInfo {
  kind: ImportSourceKind
  /** Nome sugerido (título do documento, ficheiro sem extensão, concerto copiado…) — null se genérico */
  name: string | null
  /** Data/local lidos no documento (para pré-preencher os detalhes do concerto) */
  meta?: SetlistDocMeta
}

/** Leitura alternativa da mesma lista, oferecida na revisão. */
export interface ImportSuggestion {
  kind: 'commas' | 'columns'
  /** Quantas músicas dá essa leitura */
  count: number
}

/** O que se guarda para retomar uma revisão (rascunho). */
export interface ImporterSnapshot {
  rows: ImportRow[]
  source: ImportSourceInfo | null
  skipped: SkippedLine[]
  parsed: { text: string; opts: ParseOptions } | null
}

export interface SetlistImporter {
  /* ── Fonte ── */
  /** 'source' até haver uma lista; 'review' depois */
  phase: 'source' | 'review'
  /** De onde veio a lista atual */
  source: ImportSourceInfo | null
  /** Miniaturas da fonte (imagens / 1.ª página do PDF) — URLs de objeto */
  previews: string[]
  /** A ler (PDF/OCR) — label + progresso 0..1 (null = indeterminado) */
  busy: ImportProgress | null
  /** Erro da última leitura (mensagem pronta a mostrar) */
  error: string | null
  clearError(): void
  /** Texto do painel TEXTO (fica no importador: fechar/voltar não o perde) */
  draftText: string
  setDraftText(text: string): void
  /** Ficheiros escolhidos/arrastados: 1 PDF, 1+ imagens (lidas pela ordem) ou .txt. true = passou para revisão */
  importFiles(files: File[] | FileList): Promise<boolean>
  importPdf(file: File): Promise<boolean>
  importImages(files: File[]): Promise<boolean>
  importText(text: string, name?: string | null): boolean
  /** Linhas já resolvidas (repertório / copiar concerto) → revisão */
  loadSongs(items: readonly { song: LibrarySong; extra?: SetlistSongExtra; sourceExtra?: SetlistSongExtra }[], source?: ImportSourceInfo): void
  /** Cancela a leitura em curso (PDF/OCR) */
  cancelSource(): void

  /* ── Repertório ── */
  library: LibrarySong[]
  libraryLoading: boolean
  /** O repertório não carregou (rede) — não é "vazio" */
  libraryError: string | null
  reloadLibrary(): void

  /* ── Revisão ── */
  rows: ImportRow[]
  counts: ImportCounts
  /** Há pesquisas online em fila/em curso */
  resolving: boolean
  /** Linhas com texto que o parser deixou de fora (ver / repor) */
  ignored: SkippedLine[]
  /** Repõe uma linha ignorada, no sítio onde estava */
  restoreIgnored(order: number): void
  /** Outra leitura possível ("separar por vírgulas", "ler coluna a coluna") */
  suggestion: ImportSuggestion | null
  applySuggestion(): void
  dismissSuggestion(): void
  /** Muda o nome (e artista) → volta a procurar no repertório e online */
  rename(id: string, title: string, artist?: string): void
  /** Troca título ↔ artista ("Artista - Título") */
  swapTitleArtist(id: string): void
  remove(id: string): void
  /** Última linha removida (para "Desfazer") */
  lastRemoved: ImportRow | null
  undoRemove(): void
  move(id: string, delta: -1 | 1): void
  moveTo(id: string, index: number): void
  chooseLibrary(id: string, song: LibrarySong): void
  chooseOnline(id: string, ranked: RankedResult): void
  chooseEmpty(id: string): void
  /** Aceita a escolha automática da linha (deixa de estar "a confirmar") */
  confirmChoice(id: string): void
  /** Repete a pesquisa online desta linha */
  retry(id: string): void
  /** Repete todas as pesquisas que falharam por rede */
  retryOffline(): void
  /** Pesquisa online com texto livre (seletor de correspondência) */
  searchRow(id: string, query: string): void
  /** Acrescenta linhas escritas à mão (passam pelo parser). Devolve quantas entraram */
  addLines(text: string): number
  /** Liga/desliga o tom e as notas copiados de um concerto (linhas com `sourceExtra`) */
  setExtrasEnabled(on: boolean): void

  /* ── Gravar ── */
  committing: boolean
  commitProgress: CommitProgress | null
  /**
   * Espera pelo repertório e pelas pesquisas em curso (máx. ~20 s), cria as músicas novas e
   * devolve os song_id PELA ORDEM da lista. Não mexe em setlists — usar `insertSetlistSongs`
   * com `toSetlistInserts(result)`. Repetir depois de uma falha não duplica músicas.
   */
  commit(): Promise<ImportCommitResult>

  /* ── Rascunho ── */
  snapshot(): ImporterSnapshot
  restore(snap: ImporterSnapshot): void

  /** Volta ao início (descarta a lista) */
  reset(): void
}

const LIB_COLUMNS = 'id, title, artist, has_sync, performance_key, original_key, project_id, owner_id'
const RESOLVE_WAIT_MS = 20000
const LIBRARY_WAIT_MS = 15000

const EMPTY_MESSAGES: Record<'pdf' | 'image' | 'text', string> = {
  pdf: 'Não encontrei músicas neste PDF. Confirma que é a lista do concerto — ou usa FOTO/TEXTO.',
  image: 'Não consegui ler músicas nesta imagem. Tenta uma foto mais próxima, direita e com boa luz — ou cola o texto.',
  text: 'Não encontrei músicas neste texto. Escreve ou cola uma música por linha.',
}

const idle = () => ({ state: 'idle' as const, query: '', results: [] })

function libraryChoice(song: LibrarySong, loose: boolean): RowChoice {
  return loose ? { kind: 'library', song, auto: true, loose: true } : { kind: 'library', song, auto: true }
}

/** Nome sugerido: título do documento → título grande no topo → nome do ficheiro. */
function pickName(meta: SetlistDocMeta, heading: string | null | undefined, fileName: string | null): string | null {
  const fromMeta = meta.title ? tidyTitle(meta.title) : ''
  const fromHeading = heading ? tidyTitle(heading) : ''
  return fromMeta || fromHeading || fileName || null
}

export function useSetlistImport({ projectId, ready = true, autoResolve = true }: UseSetlistImportOptions): SetlistImporter {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [phase, setPhase] = useState<'source' | 'review'>('source')
  const [source, setSource] = useState<ImportSourceInfo | null>(null)
  const [busy, setBusy] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')
  const [rows, setRowsState] = useState<ImportRow[]>([])
  const [lastRemoved, setLastRemoved] = useState<{ row: ImportRow; index: number } | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitProgress, setCommitProgress] = useState<CommitProgress | null>(null)
  const [skipped, setSkipped] = useState<SkippedLine[]>([])
  const [parsed, setParsed] = useState<{ text: string; opts: ParseOptions } | null>(null)
  const [suggestion, setSuggestion] = useState<ImportSuggestion | null>(null)
  const [previews, setPreviews] = useState<string[]>([])

  // Repertório: carregado por chave (projeto ou pessoal); "a carregar" = chave diferente
  const libKey = !ready ? '' : projectId ? `p:${projectId}` : userId ? `u:${userId}` : ''
  const [lib, setLib] = useState<{ key: string; songs: LibrarySong[] }>({ key: '', songs: [] })
  const [libErr, setLibErr] = useState<{ key: string; message: string } | null>(null)
  const [libReload, setLibReload] = useState(0)
  const libFailed = !!libKey && libErr?.key === libKey
  const libraryLoading = !ready || (!!libKey && lib.key !== libKey && !libFailed)

  const rowsRef = useRef<ImportRow[]>([])
  const libRef = useRef(lib)
  const libKeyRef = useRef(libKey)
  const libErrRef = useRef(libErr)
  const autoRef = useRef(autoResolve)
  const sourceCtrl = useRef<AbortController | null>(null)
  const previewsRef = useRef<string[]>([])
  useLayoutEffect(() => {
    libKeyRef.current = libKey
    libErrRef.current = libErr
    autoRef.current = autoResolve
  }, [libKey, libErr, autoResolve])

  const setRows = useCallback((next: ImportRow[]) => {
    const marked = markRepeats(next)
    rowsRef.current = marked
    setRowsState(marked)
  }, [])
  const updateRows = useCallback((fn: (prev: ImportRow[]) => ImportRow[]) => setRows(fn(rowsRef.current)), [setRows])
  const patchRow = useCallback((id: string, fn: (r: ImportRow) => ImportRow) => {
    updateRows(prev => prev.map(r => (r.id === id ? fn(r) : r)))
  }, [updateRows])

  const replacePreviews = useCallback((urls: string[]) => {
    previewsRef.current.forEach(u => URL.revokeObjectURL(u))
    previewsRef.current = urls
    setPreviews(urls)
  }, [])

  /* ── Fila de pesquisas online ── */
  // Criada uma vez; os eventos ligam-se num efeito (só chegam depois do render — respostas da rede)
  const [resolver] = useState<Resolver>(() => createResolver())
  useEffect(() => {
    resolver.setHandlers({
      onStart(id, query) {
        patchRow(id, r => (r.search.query === query ? { ...r, search: { ...r.search, state: 'searching' } } : r))
      },
      onDone(id, query, outcome: OnlineOutcome) {
        patchRow(id, r => {
          if (r.search.query !== query) return r
          if (outcome.status === 'offline') return { ...r, search: { ...r.search, state: 'offline', results: [] } }
          const q = r.search.custom ? { title: query } : rowQuery(r)
          const results = rankResults(q, outcome.results)
          const choice = r.choice ?? autoOnlineChoice(results)
          return { ...r, choice, search: { ...r.search, state: 'done', results } }
        })
      },
    })
    return () => resolver.setHandlers(null)
  }, [resolver, patchRow])

  const queueSearch = useCallback((id: string, custom?: string) => {
    const row = rowsRef.current.find(r => r.id === id)
    if (!row) return
    const query = (custom?.trim() || searchQueryFor(rowQuery(row))).trim()
    if (!query) return
    patchRow(id, r => ({ ...r, search: { state: 'queued', query, results: [], custom: !!custom?.trim() } }))
    resolver.enqueue(id, query)
  }, [patchRow, resolver])

  /**
   * Aplica o repertório às linhas: as automáticas voltam a ser procuradas, e uma escolha
   * manual de uma música que NÃO está neste repertório (mudou o PARA, cópia de outra banda)
   * também — o concerto nunca fica com músicas de outro projeto. Põe na fila as que
   * precisam de pesquisa online.
   */
  const applyLibrary = useCallback((songs: LibrarySong[]) => {
    const ids = new Set(songs.map(s => s.id))
    const toSearch: string[] = []
    updateRows(prev => prev.map(r => {
      const c = r.choice
      if (c?.kind === 'empty') return r
      if (c?.kind === 'online' && !c.auto) return r
      if (c?.kind === 'library' && !c.auto && ids.has(c.song.id)) return r
      const m = matchLibrary(rowQuery(r), songs)
      if (m) {
        if (c?.kind === 'library' && c.song.id === m.song.id && !!c.loose === m.loose && c.auto) return r
        resolver.cancel(r.id)
        const search = r.search.state === 'queued' || r.search.state === 'searching' ? { ...r.search, state: 'idle' as const } : r.search
        return { ...r, choice: libraryChoice(m.song, m.loose), search, songId: undefined }
      }
      if (c?.kind === 'library') {
        // Deixou de estar no repertório (mudou o projeto)
        if (r.search.state === 'done') return { ...r, choice: autoOnlineChoice(r.search.results), songId: undefined }
        if (r.search.state === 'idle' || r.search.state === 'offline') toSearch.push(r.id)
        return { ...r, choice: null, songId: undefined }
      }
      if (!c && r.search.state === 'idle') toSearch.push(r.id)
      return r
    }))
    if (autoRef.current) toSearch.forEach(id => queueSearch(id))
  }, [updateRows, resolver, queueSearch])

  // Carregar o repertório (projeto ou pessoal) e re-aplicar às linhas. Uma falha de rede
  // NÃO conta como "repertório vazio" (senão tudo seria criado em duplicado).
  useEffect(() => {
    if (!libKey) return
    let cancelled = false
    const base = supabase.from('songs').select(LIB_COLUMNS)
    const q = projectId ? base.eq('project_id', projectId) : base.eq('owner_id', userId as string)
    q.order('title').then(
      ({ data, error }) => {
        if (cancelled) return
        if (error) {
          setLibErr({ key: libKey, message: humanizeError(error.message) })
          return
        }
        const next = { key: libKey, songs: (data ?? []) as LibrarySong[] }
        libRef.current = next
        setLib(next)
        setLibErr(prev => (prev?.key === libKey ? null : prev))
        applyLibrary(next.songs)
      },
      (e: unknown) => {
        if (!cancelled) setLibErr({ key: libKey, message: importErrorMessage(e) })
      },
    )
    return () => { cancelled = true }
  }, [libKey, projectId, userId, applyLibrary, libReload])

  const reloadLibrary = useCallback(() => {
    setLibErr(null)
    setLibReload(n => n + 1)
  }, [])

  const retryOfflineRef = useRef<() => void>(() => {})
  // A rede voltou / a app voltou ao ecrã: repetir o que falhou
  useEffect(() => {
    function onBack() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const err = libErrRef.current
      if (err && err.key === libKeyRef.current) reloadLibrary()
      retryOfflineRef.current()
    }
    window.addEventListener('online', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      window.removeEventListener('online', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [reloadLibrary])

  // Ao desmontar: parar leituras e pesquisas, libertar miniaturas
  useEffect(() => () => {
    sourceCtrl.current?.abort()
    resolver.cancelAll()
    previewsRef.current.forEach(u => URL.revokeObjectURL(u))
    previewsRef.current = []
  }, [resolver])

  const libReady = useCallback(() => !!libKeyRef.current && libRef.current.key === libKeyRef.current, [])

  /* ── Entrada de uma lista ── */
  const ingest = useCallback((newRows: ImportRow[], info: ImportSourceInfo) => {
    resolver.cancelAll()
    const haveLib = libReady()
    const songs = haveLib ? libRef.current.songs : []
    const ids = new Set(songs.map(s => s.id))
    const matched = newRows.map(r => {
      // Escolha de outro repertório (cópia de outra banda): volta a procurar neste
      if (r.choice?.kind === 'library' && haveLib && !ids.has(r.choice.song.id)) r = { ...r, choice: null }
      if (r.choice) return r
      const m = haveLib ? matchLibrary(rowQuery(r), songs) : null
      return m ? { ...r, choice: libraryChoice(m.song, m.loose) } : r
    })
    setRows(matched)
    setLastRemoved(null)
    setSource(info)
    setError(null)
    setPhase('review')
    if (haveLib && autoRef.current) matched.filter(r => !r.choice).forEach(r => queueSearch(r.id))
  }, [resolver, setRows, queueSearch, libReady])

  /** Texto → linhas (guarda o texto para as leituras alternativas e as linhas ignoradas). */
  const ingestText = useCallback((text: string, opts: ParseOptions, info: (meta: SetlistDocMeta) => ImportSourceInfo): boolean => {
    const res = parseSetlist(text, opts)
    if (res.entries.length === 0) return false
    setParsed({ text, opts })
    setSkipped(res.skipped)
    setSuggestion(res.suggest.columns ? { kind: 'columns', count: res.suggest.columns }
      : res.suggest.commas ? { kind: 'commas', count: res.suggest.commas } : null)
    ingest(entriesToRows(res.entries), info(res.meta))
    return true
  }, [ingest])

  const runSource = useCallback(async (
    kind: 'pdf' | 'image' | 'text',
    fileName: string | null,
    read: (signal: AbortSignal, onProgress: (p: ImportProgress) => void) => Promise<SourceText>,
    files: File[] = [],
  ): Promise<boolean> => {
    sourceCtrl.current?.abort()
    const ctrl = new AbortController()
    sourceCtrl.current = ctrl
    setError(null)
    setBusy({ label: kind === 'pdf' ? 'A ler o PDF…' : kind === 'image' ? 'A preparar a imagem…' : 'A ler…', progress: null })
    try {
      const { text, ocr, image, heading } = await read(ctrl.signal, p => { if (!ctrl.signal.aborted) setBusy(p) })
      if (ctrl.signal.aborted) return false
      const ok = ingestText(text, { ocr, image }, meta => ({ kind, name: pickName(meta, heading, fileName), meta }))
      if (!ok) { setError(EMPTY_MESSAGES[kind]); return false }
      // Miniatura da fonte para a revisão (em segundo plano)
      replacePreviews([])
      if (kind === 'image') replacePreviews(files.map(f => URL.createObjectURL(f)))
      else if (kind === 'pdf' && files[0]) {
        void sourcePreview(files[0]).then(url => {
          if (!url) return
          if (sourceCtrl.current && sourceCtrl.current !== ctrl) { URL.revokeObjectURL(url); return }
          replacePreviews([url])
        })
      }
      return true
    } catch (e) {
      if (ctrl.signal.aborted || isAbort(e)) return false
      setError(importErrorMessage(e))
      return false
    } finally {
      if (sourceCtrl.current === ctrl) {
        sourceCtrl.current = null
        setBusy(null)
      }
    }
  }, [ingestText, replacePreviews])

  const importPdf = useCallback((file: File) =>
    runSource('pdf', fileBaseName(file.name), (signal, onProgress) => readPdf(file, { signal, onProgress }), [file]), [runSource])

  const importImages = useCallback((files: File[]) =>
    runSource('image', files[0] ? fileBaseName(files[0].name) : null,
      (signal, onProgress) => readImages(files, { signal, onProgress }), files), [runSource])

  const importText = useCallback((text: string, name: string | null = null) => {
    const ok = ingestText(text, {}, meta => ({ kind: 'text', name: name ?? (meta.title ? tidyTitle(meta.title) || null : null), meta }))
    if (!ok) { setError(EMPTY_MESSAGES.text); return false }
    replacePreviews([])
    return true
  }, [ingestText, replacePreviews])

  const importFiles = useCallback(async (list: File[] | FileList): Promise<boolean> => {
    const files = Array.from(list)
    if (files.length === 0) return false
    const pdf = files.find(f => fileKind(f) === 'pdf')
    if (pdf) return importPdf(pdf)
    const images = files.filter(f => fileKind(f) === 'image')
    if (images.length) return importImages(images)
    const txt = files.find(f => fileKind(f) === 'text')
    if (txt) return runSource('text', fileBaseName(txt.name), () => readTextFile(txt))
    setError('Formato não suportado. Usa um PDF, uma foto/screenshot ou texto.')
    return false
  }, [importPdf, importImages, runSource])

  const loadSongs = useCallback((items: readonly { song: LibrarySong; extra?: SetlistSongExtra; sourceExtra?: SetlistSongExtra }[], info?: ImportSourceInfo) => {
    setParsed(null)
    setSkipped([])
    setSuggestion(null)
    replacePreviews([])
    ingest(songsToRows(items), info ?? { kind: 'library', name: null })
  }, [ingest, replacePreviews])

  const cancelSource = useCallback(() => {
    sourceCtrl.current?.abort()
    sourceCtrl.current = null
    setBusy(null)
  }, [])

  /* ── Edição das linhas ── */
  const rematchOne = useCallback((row: ImportRow): ImportRow => {
    const m = libReady() ? matchLibrary(rowQuery(row), libRef.current.songs) : null
    return m ? { ...row, choice: libraryChoice(m.song, m.loose) } : { ...row, choice: null }
  }, [libReady])

  const rename = useCallback((id: string, title: string, artist?: string) => {
    const t = title.replace(/\s+/g, ' ').trim()
    if (!t) return
    resolver.cancel(id)
    let needsSearch = false
    patchRow(id, r => {
      const next = rematchOne({
        ...r,
        title: t,
        artist: (artist ?? r.artist).replace(/\s+/g, ' ').trim(),
        swapped: undefined,
        text: undefined,
        songId: undefined,
        search: idle(),
      })
      needsSearch = !next.choice
      return next
    })
    if (needsSearch && autoRef.current && libReady()) queueSearch(id)
  }, [patchRow, queueSearch, rematchOne, resolver, libReady])

  const swapTitleArtist = useCallback((id: string) => {
    const r = rowsRef.current.find(x => x.id === id)
    if (!r || !r.artist) return
    rename(id, r.artist, r.title)
  }, [rename])

  const remove = useCallback((id: string) => {
    const index = rowsRef.current.findIndex(r => r.id === id)
    if (index < 0) return
    resolver.cancel(id)
    setLastRemoved({ row: rowsRef.current[index], index })
    updateRows(prev => prev.filter(r => r.id !== id))
  }, [resolver, updateRows])

  const undoRemove = useCallback(() => {
    if (!lastRemoved) return
    const { row, index } = lastRemoved
    updateRows(prev => [...prev.slice(0, index), row, ...prev.slice(index)])
    setLastRemoved(null)
    if (!row.choice && (row.search.state === 'queued' || row.search.state === 'searching')) queueSearch(row.id)
  }, [lastRemoved, updateRows, queueSearch])

  const moveTo = useCallback((id: string, index: number) => {
    updateRows(prev => {
      const from = prev.findIndex(r => r.id === id)
      if (from < 0) return prev
      const to = Math.max(0, Math.min(prev.length - 1, index))
      if (to === from) return prev
      const next = prev.slice()
      const [row] = next.splice(from, 1)
      next.splice(to, 0, row)
      return next
    })
  }, [updateRows])

  const move = useCallback((id: string, delta: -1 | 1) => {
    const from = rowsRef.current.findIndex(r => r.id === id)
    if (from >= 0) moveTo(id, from + delta)
  }, [moveTo])

  const chooseLibrary = useCallback((id: string, song: LibrarySong) => {
    resolver.cancel(id)
    patchRow(id, r => ({
      ...r,
      choice: { kind: 'library', song, auto: false },
      songId: undefined,
      search: r.search.state === 'queued' || r.search.state === 'searching' ? { ...r.search, state: 'idle' } : r.search,
    }))
  }, [patchRow, resolver])

  const chooseOnline = useCallback((id: string, ranked: RankedResult) => {
    patchRow(id, r => ({
      ...r,
      choice: { kind: 'online', result: ranked.result, score: ranked.score, auto: false },
      songId: undefined,
    }))
  }, [patchRow])

  const chooseEmpty = useCallback((id: string) => {
    patchRow(id, r => ({ ...r, choice: { kind: 'empty' }, songId: undefined }))
  }, [patchRow])

  const confirmChoice = useCallback((id: string) => {
    patchRow(id, r => {
      const c = r.choice
      if (c?.kind === 'library') return { ...r, choice: { kind: 'library', song: c.song, auto: false } }
      if (c?.kind === 'online') return { ...r, choice: { ...c, auto: false } }
      return r
    })
  }, [patchRow])

  const retry = useCallback((id: string) => {
    const r = rowsRef.current.find(x => x.id === id)
    if (!r) return
    queueSearch(id, r.search.custom ? r.search.query : undefined)
  }, [queueSearch])

  const retryOffline = useCallback(() => {
    rowsRef.current.filter(r => r.search.state === 'offline').forEach(r => retry(r.id))
  }, [retry])
  useLayoutEffect(() => { retryOfflineRef.current = retryOffline }, [retryOffline])

  const searchRow = useCallback((id: string, query: string) => {
    if (query.trim()) queueSearch(id, query)
  }, [queueSearch])

  const addLines = useCallback((text: string) => {
    const newRows = entriesToRows(parseSetlist(text).entries).map(r => rematchOne({ ...r, order: undefined }))
    if (newRows.length === 0) return 0
    updateRows(prev => [...prev, ...newRows])
    setPhase('review')
    if (autoRef.current && libReady()) newRows.filter(r => !r.choice).forEach(r => queueSearch(r.id))
    return newRows.length
  }, [rematchOne, updateRows, queueSearch, libReady])

  const restoreIgnored = useCallback((order: number) => {
    const sk = skipped.find(s => s.order === order)
    if (!sk) return
    const entry = forceEntry(sk.text, sk.order, parsed?.opts)
    setSkipped(prev => prev.filter(s => s.order !== order))
    if (!entry) return
    const row = rematchOne(entriesToRows([entry])[0])
    updateRows(prev => {
      const i = insertIndexFor(prev, order)
      return [...prev.slice(0, i), row, ...prev.slice(i)]
    })
    if (!row.choice && autoRef.current && libReady()) queueSearch(row.id)
  }, [skipped, parsed, rematchOne, updateRows, queueSearch, libReady])

  const applySuggestion = useCallback(() => {
    if (!parsed || !suggestion) return
    const opts: ParseOptions = { ...parsed.opts, ...(suggestion.kind === 'commas' ? { splitCommas: true } : { splitColumns: true }) }
    const info = source ?? { kind: 'text' as const, name: null }
    ingestText(parsed.text, opts, meta => ({ ...info, meta: { ...meta, ...info.meta } }))
    setSuggestion(null)
  }, [parsed, suggestion, source, ingestText])

  const dismissSuggestion = useCallback(() => setSuggestion(null), [])

  const setExtrasEnabled = useCallback((on: boolean) => {
    updateRows(prev => prev.map(r => (r.sourceExtra ? { ...r, extra: on ? r.sourceExtra : undefined } : r)))
  }, [updateRows])

  const reset = useCallback(() => {
    sourceCtrl.current?.abort()
    sourceCtrl.current = null
    resolver.cancelAll()
    setRows([])
    setLastRemoved(null)
    setSource(null)
    setBusy(null)
    setError(null)
    setSkipped([])
    setParsed(null)
    setSuggestion(null)
    replacePreviews([])
    setPhase('source')
  }, [resolver, setRows, replacePreviews])

  /* ── Rascunho ── */
  const snapshot = useCallback((): ImporterSnapshot => ({
    // Sem resultados online (pesados; voltam a procurar-se) — as escolhas ficam
    rows: rowsRef.current.map(r => ({ ...r, search: idle() })),
    source,
    skipped,
    parsed,
  }), [source, skipped, parsed])

  const restore = useCallback((snap: ImporterSnapshot) => {
    resolver.cancelAll()
    setRows(snap.rows.map(r => ({ ...r, search: idle() })))
    setSource(snap.source)
    setSkipped(snap.skipped ?? [])
    setParsed(snap.parsed ?? null)
    setSuggestion(null)
    setLastRemoved(null)
    setError(null)
    replacePreviews([])
    setPhase(snap.rows.length ? 'review' : 'source')
    if (libReady()) applyLibrary(libRef.current.songs)
  }, [resolver, setRows, replacePreviews, applyLibrary, libReady])

  /* ── Gravar ── */
  const commit = useCallback(async (): Promise<ImportCommitResult> => {
    if (!userId) throw new ImportError('unreadable', 'A sessão terminou — entra de novo para gravar.')
    setCommitting(true)
    try {
      // 1. O repertório tem de estar carregado (senão tudo seria criado em duplicado)
      if (!libReady()) {
        setCommitProgress({ phase: 'resolving', done: 0, total: rowsRef.current.length, current: 'A carregar o repertório…' })
        const t0 = Date.now()
        while (!libReady()) {
          const err = libErrRef.current
          if (err && err.key === libKeyRef.current) throw new ImportError('offline', `Não foi possível carregar o repertório — ${err.message}`)
          if (!libKeyRef.current || Date.now() - t0 > LIBRARY_WAIT_MS) {
            throw new ImportError('offline', 'O repertório ainda não carregou — tenta de novo daqui a pouco.')
          }
          await new Promise(r => setTimeout(r, 200))
        }
        // applyLibrary corre no mesmo tick do carregamento: dar-lhe um render
        await new Promise(r => setTimeout(r, 0))
      }
      // 2. Pesquisas em curso
      if (resolver.size > 0) {
        const total = rowsRef.current.length
        const pendingNow = () => rowsRef.current.filter(r => r.search.state === 'queued' || r.search.state === 'searching').length
        const tick = setInterval(() => setCommitProgress({ phase: 'resolving', done: total - pendingNow(), total, current: 'A procurar letras…' }), 250)
        setCommitProgress({ phase: 'resolving', done: total - pendingNow(), total, current: 'A procurar letras…' })
        await Promise.race([resolver.idle(), new Promise(r => setTimeout(r, RESOLVE_WAIT_MS))])
        clearInterval(tick)
        if (resolver.size > 0) {
          // Demorou demais: as que faltam ficam sem letra
          resolver.cancelAll()
          updateRows(prev => prev.map(r => (r.search.state === 'queued' || r.search.state === 'searching'
            ? { ...r, search: { ...r.search, state: 'idle' } } : r)))
        }
      }
      const current = rowsRef.current
      const items = await commitRows(current, { ownerId: userId, projectId }, { onProgress: setCommitProgress })
      const created = new Map(items.filter(i => i.created && i.songId).map(i => [i.rowId, i.songId as string]))
      if (created.size) updateRows(prev => prev.map(r => (created.has(r.id) ? { ...r, songId: created.get(r.id) } : r)))
      return summarizeCommit(items)
    } finally {
      setCommitting(false)
      setCommitProgress(null)
    }
  }, [userId, projectId, resolver, updateRows, libReady])

  const counts = useMemo(() => countRows(rows, libraryLoading), [rows, libraryLoading])

  return {
    phase, source, previews, busy, error,
    clearError: useCallback(() => setError(null), []),
    draftText, setDraftText,
    importFiles, importPdf, importImages, importText, loadSongs, cancelSource,
    library: lib.key === libKey ? lib.songs : [],
    libraryLoading,
    libraryError: libFailed ? libErr!.message : null,
    reloadLibrary,
    rows, counts,
    resolving: counts.searching > 0,
    ignored: skipped,
    restoreIgnored,
    suggestion, applySuggestion, dismissSuggestion,
    rename, swapTitleArtist, remove,
    lastRemoved: lastRemoved?.row ?? null,
    undoRemove, move, moveTo, chooseLibrary, chooseOnline, chooseEmpty, confirmChoice,
    retry, retryOffline, searchRow, addLines, setExtrasEnabled,
    committing, commitProgress, commit,
    snapshot, restore,
    reset,
  }
}
