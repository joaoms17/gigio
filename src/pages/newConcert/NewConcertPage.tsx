/* ═══════════════════════════════════════════════════════════════
   /concertos/novo — assistente de criação de concerto.
   Passo 1 "COMO QUERES COMEÇAR?": IMPORTAR LISTA (PDF · FOTO · TEXTO)
   em destaque, COPIAR CONCERTO, DO REPERTÓRIO, começar vazio.
   Passo 2 "REVER E CRIAR": nome/data/local + lista 01…N pela ordem;
   "CRIAR EM <BANDA> · N MÚSICAS" cria a setlist, as músicas que faltam
   e o alinhamento (posições 0…N-1, um insert em lote).
   O passo vive no URL (?passo=copiar|repertorio|rever): o "voltar"
   do browser/gesto muda de passo sem perder o que já foi feito; a
   lista fica também num rascunho (sessionStorage) — sair da página
   ou o Safari recarregar depois da câmara não a perde.
   Entrada: ?project=<bandId> · ?date=YYYY-MM-DD · ?copy=<setlistId>
═══════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import SetlistImportModal from '../../components/SetlistImportModal'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { humanizeError, importErrorMessage } from '../../lib/setlistImport/errors'
import {
  insertSetlistSongs, toSetlistInserts, useSetlistImport,
  type ImportCommitResult, type ImportSourceInfo, type LibrarySong, type SetlistImporter,
} from '../../components/import'
import {
  fetchConcertSongs, fetchConcerts, fetchConcertsOnDate, fetchProjects, isYmd, pad2, readLastProject,
  rememberProject, shortDate, songsLabel, sortConcerts, stripDateSuffix,
  type ConcertOption, type ConcertSong, type DayConcert, type ProjectOption,
} from './data'
import { agoLabel, clearDraft, draftCount, readDraft, writeDraft, type NewConcertDraft } from './draft'
import { useOnline } from '../../components/import/useOnline'
import { useProjectFit } from './useProjectFit'
import type { Mode, View } from './types'
import ProjectSelect from './ProjectSelect'
import StartStep from './StartStep'
import CopyStep, { type CopySongsState } from './CopyStep'
import LibraryStep from './LibraryStep'
import ReviewStep from './ReviewStep'
import { IconAlert, IconBack, IconClose } from './icons'
import styles from './NewConcertPage.module.css'

const STEP_PARAM = 'passo'
const VIEW_PARAM: Record<Exclude<View, 'start'>, string> = { copy: 'copiar', library: 'repertorio', review: 'rever' }
const PARAM_VIEW: Record<string, View> = { copiar: 'copy', repertorio: 'library', rever: 'review' }

const TITLES: Record<View, string> = {
  start: 'Como queres começar?',
  copy: 'Copiar concerto',
  library: 'Do repertório',
  review: 'Rever e criar',
}

/** "Importada de …" por cima do alinhamento (sem isto, "TEXTO COLADO" solto lia-se como um título) */
const SOURCE_FROM: Record<ImportSourceInfo['kind'], string> = {
  pdf: 'PDF',
  image: 'foto',
  text: 'texto colado',
  library: 'repertório',
  setlist: 'concerto',
}

const MODE_LABEL: Record<Mode, string> = {
  import: 'Lista importada',
  copy: 'Cópia de concerto',
  library: 'Do repertório',
  empty: 'Concerto vazio',
}

/** Fases da gravação (além do progresso do importador) */
type Stage = 'setlist' | 'songs' | 'lineup'

/** Lista carregada no importador de copiar/repertório — `key` evita recarregar (e perder edições) ao voltar */
interface ListOrigin {
  key: string
  /** Projeto de onde vêm as músicas (null = pessoal) */
  project: string | null
  /** "Cópia de Jantar · sáb 28 set" */
  label: string
}

/** Desfazer na seleção do repertório ("Retirada: Valerie", "Seleção limpa") */
interface PickUndo {
  prev: LibrarySong[]
  label: string
}

/**
 * PARA por defeito: ?project → o único projeto → o último usado → o da banda com o concerto
 * criado mais recentemente → o primeiro. (Fica sempre visível no cabeçalho e no primário.)
 */
function resolveDefaultProject(
  projects: ProjectOption[] | null,
  urlProject: string | null,
  last: string | null | undefined,
  recentBand: string | null,
): string | null {
  if (!projects) return urlProject ?? last ?? null
  const ids = projects.filter(p => p.canCreate).map(p => p.id)
  if (urlProject && ids.includes(urlProject)) return urlProject
  if (ids.length === 1) return ids[0]
  if (last === null) return null
  if (last && ids.includes(last)) return last
  if (recentBand && ids.includes(recentBand)) return recentBand
  return ids[0] ?? null
}

function summaryText(res: ImportCommitResult, inserted: number): string {
  const parts = [`Concerto criado com ${songsLabel(inserted)}`]
  if (res.created > 0) {
    parts.push(`${res.created} nova${res.created === 1 ? '' : 's'} no repertório${res.withoutLyrics > 0 ? ` (${res.withoutLyrics} sem letra)` : ''}`)
  }
  if (res.failed > 0) {
    const names = res.items.filter(i => !i.songId).slice(0, 3).map(i => `“${i.title}”`).join(', ')
    parts.push(`${res.failed} não ${res.failed === 1 ? 'entrou' : 'entraram'}: ${names}${res.failed > 3 ? '…' : ''}`)
  }
  return parts.join(' · ')
}

export default function NewConcertPage() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const toast = useToast()
  const confirm = useConfirm()
  const online = useOnline()
  const paraSelectId = useId()

  /* ── Parâmetros de entrada (lidos uma vez) ── */
  const [urlProject] = useState(() => searchParams.get('project'))
  const [lastProject] = useState(readLastProject)
  const [copyParam] = useState(() => searchParams.get('copy'))

  const passo = searchParams.get(STEP_PARAM)
  const urlView: View = passo ? (PARAM_VIEW[passo] ?? 'start') : searchParams.get('copy') ? 'copy' : 'start'

  /* ── Rascunho de uma visita anterior ── */
  const [initialDraft] = useState(() => readDraft(userId))
  // Recarregar em ?passo=rever (o Safari depois da câmara): retoma logo, sem perguntar
  const [autoRestore] = useState(() => !!initialDraft?.mode && passo === VIEW_PARAM.review)
  const [draftOffer, setDraftOffer] = useState<NewConcertDraft | null>(() => (autoRestore ? null : initialDraft))
  const restoreFrom = autoRestore ? initialDraft : null

  /* ── PARA: projeto ── */
  const [projects, setProjects] = useState<ProjectOption[] | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectsTry, setProjectsTry] = useState(0)
  /** undefined = o utilizador ainda não mexeu (usa o valor por defeito) */
  const [pickedProject, setPickedProject] = useState<string | null | undefined>(
    () => (restoreFrom?.projectSet ? restoreFrom.project : undefined),
  )
  /* ── Concertos (copiar) ── */
  const [concerts, setConcerts] = useState<ConcertOption[] | null>(null)
  const [concertsError, setConcertsError] = useState<string | null>(null)
  const recentBand = useMemo(() => {
    let best: ConcertOption | null = null
    for (const c of concerts ?? []) if (c.bandId && (!best || c.createdAt > best.createdAt)) best = c
    return best?.bandId ?? null
  }, [concerts])
  const projectId = pickedProject !== undefined ? pickedProject : resolveDefaultProject(projects, urlProject, lastProject, recentBand)
  /** Sabe-se para onde vai o concerto (sem projetos carregados, NÃO se assume "Pessoal") */
  const projectReady = pickedProject !== undefined || projects !== null || !!urlProject
  const project = projectId ? projects?.find(p => p.id === projectId) ?? null : null
  const projectName = projectId ? (project?.name ?? 'Projeto') : 'Pessoal'

  /* ── Importadores: um para ficheiros/texto, outro para copiar/repertório
        (trocar de origem não deita fora a outra lista) ── */
  const impFile = useSetlistImport({ projectId, ready: projectReady })
  const impList = useSetlistImport({ projectId, ready: projectReady })

  const sortedConcerts = useMemo(() => (concerts ? sortConcerts(concerts, projectId) : null), [concerts, projectId])
  const [copyId, setCopyId] = useState<string | null>(copyParam)
  const [copyExtras, setCopyExtras] = useState(() => restoreFrom?.copyExtras ?? true)
  const [copySongs, setCopySongs] = useState<Record<string, CopySongsState | undefined>>(
    () => (copyParam ? { [copyParam]: 'loading' } : {}),
  )
  const copyPromises = useRef(new Map<string, Promise<ConcertSong[]>>())
  /** Concerto tocado no cartão, à espera do alinhamento para ir direto à revisão */
  const [openingId, setOpeningId] = useState<string | null>(null)
  const openingRef = useRef<string | null>(null)

  /* ── Repertório: seleção pela ordem dos toques ── */
  const [picked, setPicked] = useState<LibrarySong[]>([])
  const [pickUndo, setPickUndo] = useState<PickUndo | null>(null)

  const [listOrigin, setListOrigin] = useState<ListOrigin | null>(() => restoreFrom?.listOrigin ?? null)
  const [mode, setMode] = useState<Mode | null>(() => restoreFrom?.mode ?? null)

  /* ── Detalhes ── */
  /** null = ainda não editado → usa o nome sugerido */
  const [nameDraft, setNameDraft] = useState<string | null>(() => restoreFrom?.nameDraft ?? null)
  /** null = ainda não escolhida → a lida no documento importado (se houver) */
  const [dateDraft, setDate] = useState<string | null>(() => {
    if (restoreFrom?.date) return restoreFrom.date
    const d = searchParams.get('date')
    return isYmd(d) ? d : null
  })
  const [venueDraft, setVenue] = useState<string | null>(() => restoreFrom?.venue || null)
  // Data e local lidos no documento ("Quinta da Ribeira — 12 de Outubro de 2026") preenchem o que está vazio
  const docMeta = mode === 'import' ? impFile.source?.meta : undefined
  const date = dateDraft ?? docMeta?.date ?? ''
  const venue = venueDraft ?? docMeta?.venue ?? ''
  const nameRef = useRef<HTMLInputElement>(null)

  /* ── Gravação ── */
  const [creating, setCreating] = useState(false)
  const [stage, setStage] = useState<Stage | null>(null)
  /** Concerto já criado numa tentativa anterior (repetir não duplica) */
  const createdId = useRef<string | null>(null)
  const [done, setDone] = useState(false)

  /* ── Importar para o concerto que já existe nesse dia ── */
  const [dayConcerts, setDayConcerts] = useState<{ date: string; list: DayConcert[] } | null>(null)
  const [importTarget, setImportTarget] = useState<DayConcert | null>(null)
  const [fitDismissed, setFitDismissed] = useState<string | null>(null)

  // Revisão sem origem (ex.: recarregar a página em ?passo=rever sem rascunho) → início
  const view: View = urlView === 'review' && !mode ? 'start' : urlView
  const viewRef = useRef(view)
  useLayoutEffect(() => { viewRef.current = view })

  /* ── Retomar o rascunho automaticamente (recarregar em ?passo=rever) ── */
  const autoRestored = useRef(false)
  useEffect(() => {
    if (autoRestored.current || !restoreFrom) return
    autoRestored.current = true
    if (restoreFrom.file) impFile.restore(restoreFrom.file)
    if (restoreFrom.list) impList.restore(restoreFrom.list)
  }, [restoreFrom, impFile, impList])

  /* ── Carregar projetos e concertos (e voltar a tentar quando a rede volta) ── */
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const pr = await fetchProjects(userId)
      if (cancelled) return
      if (pr.error) {
        setProjectsError(pr.error)
        setConcertsError(pr.error)
        setConcerts([])
        return
      }
      setProjectsError(null)
      setProjects(pr.projects)
      const cr = await fetchConcerts(userId, pr.projects.map(p => p.id))
      if (cancelled) return
      setConcertsError(cr.error)
      setConcerts(cr.concerts)
    })()
    return () => { cancelled = true }
  }, [userId, projectsTry])

  const retryProjects = useCallback(() => {
    setProjectsError(null)
    setConcerts(null)
    setConcertsError(null)
    setProjectsTry(n => n + 1)
  }, [])

  useEffect(() => {
    if (!projectsError) return
    function onBack() {
      if (navigator.onLine === false || document.visibilityState === 'hidden') return
      retryProjects()
    }
    window.addEventListener('online', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      window.removeEventListener('online', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [projectsError, retryProjects])

  /* ── Concertos que já existem na data escolhida ── */
  useEffect(() => {
    if (!userId || !isYmd(date) || projects === null) return
    let cancelled = false
    fetchConcertsOnDate(userId, projects.map(p => p.id), date).then(list => {
      if (!cancelled) setDayConcerts({ date, list })
    })
    return () => { cancelled = true }
  }, [userId, date, projects])
  const dayConcert = dayConcerts?.date === date ? dayConcerts.list.find(c => c.bandId === projectId) ?? null : null

  /* ── Alinhamento de um concerto (pré-visualização / copiar) ── */
  const ensureCopySongs = useCallback((id: string): Promise<ConcertSong[]> => {
    let pr = copyPromises.current.get(id)
    if (!pr) {
      pr = fetchConcertSongs(id)
      copyPromises.current.set(id, pr)
      setCopySongs(prev => ({ ...prev, [id]: 'loading' }))
      pr.then(
        songs => setCopySongs(prev => ({ ...prev, [id]: songs })),
        () => {
          copyPromises.current.delete(id)
          setCopySongs(prev => ({ ...prev, [id]: 'error' }))
        },
      )
    }
    return pr
  }, [])

  // Link direto ?copy=<id>
  useEffect(() => {
    if (copyParam) void ensureCopySongs(copyParam).catch(() => {})
  }, [copyParam, ensureCopySongs])

  /* ── Navegação entre passos (no URL) ── */
  const goTo = useCallback((next: View, opts: { replace?: boolean } = {}) => {
    const params = new URLSearchParams(location.search)
    params.delete('copy')
    if (next === 'start') params.delete(STEP_PARAM)
    else params.set(STEP_PARAM, VIEW_PARAM[next])
    const search = params.toString()
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: opts.replace, state: opts.replace ? location.state : { newConcertStep: true } },
    )
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    if (urlView === 'review' && !mode) goTo('start', { replace: true })
  }, [urlView, mode, goTo])

  // Cada passo começa no topo
  useEffect(() => { window.scrollTo(0, 0) }, [view])

  function goBack() {
    const parent: View = view === 'review'
      ? (mode === 'copy' ? 'copy' : mode === 'library' ? 'library' : 'start')
      : 'start'
    const st = location.state as { newConcertStep?: boolean } | null
    if (st?.newConcertStep) navigate(-1)
    else goTo(parent, { replace: true })
  }

  function enterReview(next: Mode) {
    setMode(next)
    // Começou outra lista: o rascunho antigo deixa de ser oferecido (e é substituído)
    setDraftOffer(null)
    goTo('review')
  }

  /* ── Rascunho: guardar (com atraso) enquanto há lista; avisar antes de fechar o separador ── */
  const hasWork = !done && (impFile.rows.length > 0 || impList.rows.length > 0)
  const snapFile = impFile.snapshot
  const snapList = impList.snapshot
  useEffect(() => {
    if (!userId || draftOffer || !hasWork) return
    const t = setTimeout(() => {
      writeDraft({
        v: 1,
        userId,
        savedAt: Date.now(),
        mode,
        projectSet: pickedProject !== undefined,
        project: pickedProject ?? null,
        nameDraft,
        date,
        venue,
        file: impFile.rows.length ? snapFile() : null,
        list: impList.rows.length ? snapList() : null,
        listOrigin,
        copyExtras,
      })
    }, 600)
    return () => clearTimeout(t)
  }, [userId, draftOffer, hasWork, mode, pickedProject, nameDraft, date, venue, impFile.rows, impList.rows,
    snapFile, snapList, listOrigin, copyExtras])

  useEffect(() => {
    if (!hasWork && picked.length === 0) return
    function onUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [hasWork, picked.length])

  function restoreDraft() {
    const d = draftOffer
    if (!d) return
    if (d.file) impFile.restore(d.file)
    if (d.list) impList.restore(d.list)
    if (d.projectSet) setPickedProject(d.project)
    setNameDraft(d.nameDraft)
    if (d.date) setDate(d.date)
    setVenue(d.venue)
    setListOrigin(d.listOrigin)
    setCopyExtras(d.copyExtras)
    setDraftOffer(null)
    if (d.mode) {
      setMode(d.mode)
      goTo('review')
    }
  }

  function discardDraftOffer() {
    clearDraft()
    setDraftOffer(null)
  }

  /* ── 01 IMPORTAR: ao ler a lista, avança para a revisão ── */
  function onImported() {
    if (viewRef.current !== 'start') return
    enterReview('import')
  }
  const sourceImporter: SetlistImporter = {
    ...impFile,
    importFiles: async files => {
      const ok = await impFile.importFiles(files)
      if (ok) onImported()
      return ok
    },
    importPdf: async file => {
      const ok = await impFile.importPdf(file)
      if (ok) onImported()
      return ok
    },
    importImages: async files => {
      const ok = await impFile.importImages(files)
      if (ok) onImported()
      return ok
    },
    importText: (text, name) => {
      const ok = impFile.importText(text, name)
      if (ok) onImported()
      return ok
    },
  }

  async function discardImport() {
    const ok = await confirm({
      title: 'Descartar a lista?',
      message: `As ${songsLabel(impFile.rows.length)} importadas saem da revisão. Podes voltar a importar.`,
      confirmLabel: 'Descartar',
      danger: true,
    })
    if (!ok) return
    impFile.reset()
    if (mode === 'import') setMode(null)
    if (impList.rows.length === 0) clearDraft()
  }

  /* ── 02 COPIAR ── */
  function startCopy(c: ConcertOption, songs: ConcertSong[]) {
    const key = `copy:${c.id}`
    if (listOrigin?.key !== key || impList.rows.length === 0) {
      impList.loadSongs(
        songs.map(s => ({ song: s.song, extra: copyExtras ? s.extra : undefined, sourceExtra: s.extra })),
        { kind: 'setlist', name: c.name },
      )
      setListOrigin({
        key,
        project: c.bandId,
        label: `Cópia de ${c.name}${c.date ? ` · ${shortDate(c.date)}` : ''}`,
      })
      // Concerto recorrente: quase sempre no mesmo sítio
      if (!venue.trim() && c.venue) setVenue(c.venue)
    }
    enterReview('copy')
  }

  /** Tocar num concerto do cartão: vai direto à revisão (a lista inteira, com remover) */
  function pickConcert(id: string) {
    const c = concerts?.find(x => x.id === id)
    if (!c || openingRef.current) return
    setCopyId(id)
    openingRef.current = id
    setOpeningId(id)
    ensureCopySongs(id).then(
      songs => {
        if (openingRef.current !== id) return
        openingRef.current = null
        setOpeningId(null)
        if (songs.length === 0) {
          toast('Esse concerto não tem músicas que possas copiar.', { type: 'error' })
          return
        }
        startCopy(c, songs)
      },
      e => {
        if (openingRef.current !== id) return
        openingRef.current = null
        setOpeningId(null)
        toast(`Não foi possível abrir o alinhamento — ${importErrorMessage(e)}`, { type: 'error' })
      },
    )
  }

  function selectConcert(id: string) {
    if (id === copyId) {
      setCopyId(null)
      return
    }
    setCopyId(id)
    void ensureCopySongs(id).catch(() => {})
  }

  function retryConcert(id: string) {
    copyPromises.current.delete(id)
    void ensureCopySongs(id).catch(() => {})
  }

  const copyConcert = copyId ? concerts?.find(c => c.id === copyId) ?? null : null
  const copyList = copyId ? copySongs[copyId] : undefined

  function continueCopy() {
    if (!copyConcert || !Array.isArray(copyList) || copyList.length === 0) return
    startCopy(copyConcert, copyList)
  }

  function toggleCopyExtras(on: boolean) {
    setCopyExtras(on)
    impList.setExtrasEnabled(on)
  }

  /* ── 03 REPERTÓRIO ── */
  function toggleSong(song: LibrarySong) {
    if (picked.some(s => s.id === song.id)) {
      // 2.º toque retira (e renumera): com "Desfazer" na barra
      setPickUndo({ prev: picked, label: `Retirada: ${song.title}` })
      setPicked(picked.filter(s => s.id !== song.id))
    } else {
      setPicked([...picked, song])
    }
  }

  function clearPicked() {
    if (picked.length === 0) return
    setPickUndo({ prev: picked, label: `Seleção limpa · ${songsLabel(picked.length)}` })
    setPicked([])
  }

  function undoPick() {
    if (!pickUndo) return
    setPicked(pickUndo.prev)
    setPickUndo(null)
  }

  // "Desfazer" some ao fim de alguns segundos
  useEffect(() => {
    if (!pickUndo) return
    const t = setTimeout(() => setPickUndo(null), 7000)
    return () => clearTimeout(t)
  }, [pickUndo])

  function continueLibrary() {
    if (picked.length === 0) return
    const key = `library:${projectId ?? ''}:${picked.map(s => s.id).join(',')}`
    if (listOrigin?.key !== key || impList.rows.length === 0) {
      impList.loadSongs(picked.map(song => ({ song })), { kind: 'library', name: null })
      setListOrigin({ key, project: projectId, label: `Do repertório ${projectId ? `de ${projectName}` : 'pessoal'}` })
    }
    setPickUndo(null)
    enterReview('library')
  }

  async function changeProject(id: string | null) {
    if (id === projectId) return
    // A seleção do repertório era do projeto anterior
    if (picked.length > 0) {
      const target = id ? (projects?.find(p => p.id === id)?.name ?? 'outro projeto') : 'Pessoal'
      const ok = await confirm({
        title: `Mudar para ${target}?`,
        message: `As ${songsLabel(picked.length)} escolhidas são do repertório ${projectId ? `de ${projectName}` : 'pessoal'} e saem da seleção.`,
        confirmLabel: 'Mudar',
      })
      if (!ok) return
      setPickUndo(null)
      setPicked([])
    }
    setPickedProject(id)
  }

  /* ── Revisão ── */
  const activeImp: SetlistImporter | null =
    mode === 'import' ? impFile : mode === 'copy' || mode === 'library' ? impList : null

  // Nome: nunca bloqueia — título lido → "<concerto copiado> · <data>" → "<local|projeto> · <data>"
  const shortWhen = date ? shortDate(date) : null
  let suggestedName: string
  if (mode === 'copy' && impList.source?.name) {
    const base = stripDateSuffix(impList.source.name)
    suggestedName = shortWhen ? `${base} · ${shortWhen}` : base
  } else if (mode === 'import' && impFile.source?.name) {
    suggestedName = impFile.source.name
  } else {
    const base = venue.trim() || (projectId ? projectName : '')
    suggestedName = base ? (shortWhen ? `${base} · ${shortWhen}` : base) : (shortWhen ? `Concerto · ${shortWhen}` : 'Novo concerto')
  }
  const nameValue = nameDraft ?? suggestedName

  const sourceText = mode === 'import' && impFile.source
    ? [`Importada de ${SOURCE_FROM[impFile.source.kind]}`, impFile.source.name].filter(Boolean).join(' · ')
    : (mode === 'copy' || mode === 'library') && listOrigin ? listOrigin.label : null

  const crossProject = !!listOrigin && listOrigin.project !== projectId
  const originName = listOrigin?.project
    ? (projects?.find(p => p.id === listOrigin.project)?.name ?? 'outro projeto')
    : 'o repertório pessoal'
  const crossNote = crossProject && (mode === 'copy' || mode === 'library')
    ? `As músicas vêm de ${originName}. As que não estão no repertório ${projectId ? `de ${projectName}` : 'pessoal'} são procuradas e criadas lá.`
    : null

  /* ── "Esta lista é de outra banda?" ── */
  const strictMatched = impFile.rows.filter(r => r.choice?.kind === 'library' && !r.choice.loose).length
  const fit = useProjectFit(impFile.rows, projects, projectId, strictMatched, mode === 'import' && !impFile.libraryLoading)
  const fitKey = fit ? `${fit.projectId}:${projectId ?? ''}` : null
  const fitNotice = fit && fitDismissed !== fitKey && !creating ? (
    <div className={styles.fit} role="status">
      <span className={styles.led} style={{ background: fit.color }} aria-hidden="true" />
      <span className={styles.fitText}>
        <b>{fit.matched} de {fit.total}</b> estão no repertório de <b>{fit.name}</b>
        {projectId ? <> — só {strictMatched} no de {projectName}.</> : <> — não no teu repertório pessoal.</>}
      </span>
      <span className={styles.pendingActions}>
        <button type="button" className={styles.ghostBtn} onClick={() => setFitDismissed(fitKey)}>Manter {projectName}</button>
        <button type="button" className={styles.secondaryBtn} onClick={() => void changeProject(fit.projectId)}>
          Mudar para {fit.name}
        </button>
      </span>
    </div>
  ) : null

  async function create() {
    if (!user || creating || !mode) return
    if (!online) {
      toast('Sem ligação — criar o concerto precisa de rede. A lista fica guardada.', { type: 'error' })
      return
    }
    const title = nameValue.trim() || suggestedName
    const imp = activeImp
    const withSongs = !!imp && mode !== 'empty' && imp.rows.length > 0
    setCreating(true)
    setStage('setlist')
    try {
      const fields = {
        name: title,
        date: date || null,
        venue: venue.trim() || null,
        band_id: projectId,
        is_shared: !!projectId,
      }
      let id = createdId.current
      if (id) {
        // Nova tentativa: atualiza o concerto já criado e limpa um alinhamento parcial
        const { error } = await supabase.from('setlists').update(fields).eq('id', id)
        if (error) {
          toast(`Não foi possível guardar o concerto — ${humanizeError(error.message)}`, { type: 'error' })
          return
        }
        await supabase.from('setlist_songs').delete().eq('setlist_id', id)
      } else {
        const { data, error } = await supabase
          .from('setlists')
          .insert({ ...fields, owner_id: user.id, status: 'draft' })
          .select('id')
          .single()
        if (error || !data) {
          toast(`Não foi possível criar o concerto — ${error ? humanizeError(error.message) : 'tenta de novo'}`, { type: 'error' })
          return
        }
        id = String(data.id)
        createdId.current = id
      }
      rememberProject(projectId)

      if (!withSongs || !imp) {
        clearDraft()
        setDone(true)
        toast('Concerto criado — junta as músicas', { type: 'success' })
        navigate(`/setlist/${id}?add=1`, { replace: true })
        return
      }

      setStage('songs')
      const res = await imp.commit()
      setStage('lineup')
      const inserts = toSetlistInserts(res)
      if (inserts.length === 0) {
        toast('Não foi possível criar as músicas. Confirma a ligação e tenta de novo.', { type: 'error' })
        return
      }
      const { inserted, error } = await insertSetlistSongs(id, inserts, { startPosition: 0 })
      if (error) {
        toast(`O concerto foi criado, mas as músicas não entraram no alinhamento (${error}). Tenta de novo.`, { type: 'error' })
        return
      }
      clearDraft()
      setDone(true)
      toast(summaryText(res, inserted), { type: res.failed > 0 ? 'error' : 'success' })
      navigate(`/setlist/${id}`, { replace: true })
    } catch (e) {
      toast(importErrorMessage(e, 'Algo correu mal — tenta de novo.'), { type: 'error' })
    } finally {
      setCreating(false)
      setStage(null)
    }
  }

  /* ── Barra fixa de ação (Continuar / Criar) ── */
  let bar: {
    info: ReactNode
    sub?: ReactNode
    progress?: number | null
    /** No telemóvel a info some e o botão ocupa a largura toda */
    optionalInfo?: boolean
    secondary?: ReactNode
    primary: ReactNode
    disabled?: boolean
  } | null = null

  if (view === 'copy' && copyConcert) {
    const n = Array.isArray(copyList) ? copyList.length : copyConcert.songCount
    bar = {
      info: <span className={styles.barInfoText}>{copyConcert.name}</span>,
      sub: songsLabel(n),
      primary: 'Continuar',
      disabled: !Array.isArray(copyList) || copyList.length === 0,
    }
  } else if (view === 'library' && (picked.length > 0 || pickUndo)) {
    bar = {
      info: picked.length > 0
        ? <span><b>{pad2(picked.length)}</b> escolhida{picked.length === 1 ? '' : 's'}</span>
        : <span>Nenhuma escolhida</span>,
      sub: pickUndo ? pickUndo.label : picked.map(s => s.title).join(' · '),
      secondary: pickUndo ? (
        <button type="button" className={styles.ghostBtn} onClick={undoPick}>Desfazer</button>
      ) : undefined,
      primary: 'Continuar',
      disabled: picked.length === 0,
    }
  } else if (view === 'review' && mode) {
    const count = activeImp && mode !== 'empty' ? activeImp.rows.length : 0
    const libBlocked = !!activeImp && mode !== 'empty' && (activeImp.libraryLoading || !!activeImp.libraryError)
    const cp = activeImp?.commitProgress ?? null
    let label: string | null = null
    let sub: string | null = null
    let pct: number | null = null
    if (creating) {
      if (stage === 'setlist') label = 'A criar o concerto…'
      else if (stage === 'lineup') { label = 'A montar o alinhamento…'; pct = 1 }
      else if (cp) {
        pct = cp.total ? cp.done / cp.total : null
        if (cp.phase === 'resolving') {
          label = cp.current === 'A carregar o repertório…' ? cp.current : `A procurar letras · ${pad2(cp.done)}/${pad2(cp.total)}`
        } else {
          label = `A criar ${pad2(Math.min(cp.done + 1, cp.total))}/${pad2(cp.total)}`
          sub = cp.current || null
        }
      } else label = 'A preparar…'
    }
    let primary: ReactNode
    if (creating) primary = 'A criar…'
    else if (!online) primary = 'Sem ligação'
    else if (!projectReady) primary = projectsError ? 'Projetos por carregar' : 'A carregar…'
    else if (activeImp?.libraryError && mode !== 'empty') primary = 'Repertório por carregar'
    else if (libBlocked) primary = 'A carregar o repertório…'
    else {
      primary = (
        <span className={styles.barPrimaryInner}>
          <span
            className={`${styles.barLed} ${project ? '' : styles.barLedHollow}`}
            style={project ? { background: project.color } : undefined}
            aria-hidden="true"
          />
          <span className={styles.barPrimaryText}>
            Criar em <span className={styles.barPrimaryName}>{projectName}</span>
            {count > 0 && <> · {count}<span className={styles.barPrimaryUnit}>{`\u00A0música${count === 1 ? '' : 's'}`}</span></>}
          </span>
        </span>
      )
    }
    bar = {
      info: creating
        ? <span>{label}</span>
        : <span className={styles.barInfoText}>{[date ? shortDate(date) : 'Sem data', venue.trim()].filter(Boolean).join(' · ')}</span>,
      sub: creating ? sub : MODE_LABEL[mode],
      progress: creating ? pct : undefined,
      optionalInfo: !creating,
      primary,
      disabled: creating || !userId || !online || !projectReady || libBlocked,
    }
  }

  function onBarPrimary() {
    if (view === 'copy') continueCopy()
    else if (view === 'library') continueLibrary()
    else if (view === 'review') void create()
  }

  const draftLabel = draftOffer?.mode ? MODE_LABEL[draftOffer.mode] : 'Lista'

  return (
    <div className={`${styles.page} ${bar ? styles.pageWithBar : ''}`}>
      {view === 'start' ? (
        <Breadcrumbs items={[{ label: 'Concertos', to: '/setlists' }, { label: 'Novo concerto' }]} />
      ) : (
        <button type="button" className={styles.backBtn} onClick={goBack} disabled={creating}>
          <IconBack size={16} />
          Voltar
        </button>
      )}

      {!online && (
        <div className={styles.offline} role="status">
          <IconAlert size={18} />
          <span>Sem ligação — podes preparar a lista; criar o concerto precisa de rede.</span>
        </div>
      )}

      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.pageTitle}>{TITLES[view]}</h1>
          <div className={styles.headMeta}>
            <ol className={styles.steps} aria-label="Passos">
              <li className={view !== 'review' ? styles.stepOn : ''} aria-current={view !== 'review' ? 'step' : undefined}>
                <span className={styles.stepNum}>01</span>Origem
              </li>
              <li className={view === 'review' ? styles.stepOn : ''} aria-current={view === 'review' ? 'step' : undefined}>
                <span className={styles.stepNum}>02</span>Rever e criar
              </li>
            </ol>
            {date && (
              <span className={styles.dateChip}>
                <span>{shortDate(date)}</span>
                <button
                  type="button"
                  className={styles.dateChipX}
                  onClick={() => setDate('')}
                  disabled={creating}
                  aria-label={`Tirar a data (${shortDate(date)})`}
                >
                  <IconClose size={14} />
                </button>
              </span>
            )}
          </div>
        </div>
        <ProjectSelect
          projects={projects}
          value={projectId}
          onChange={id => void changeProject(id)}
          disabled={creating}
          error={projectsError}
          onRetry={retryProjects}
          selectId={paraSelectId}
        />
      </header>

      {view === 'start' && (
        <StartStep
          importer={sourceImporter}
          pendingImport={impFile.phase === 'review' ? { count: impFile.rows.length, name: impFile.source?.name ?? null } : null}
          onReviewImport={() => enterReview('import')}
          onDiscardImport={discardImport}
          draftOffer={draftOffer ? { count: draftCount(draftOffer), ago: agoLabel(draftOffer.savedAt), label: draftLabel } : null}
          onRestoreDraft={restoreDraft}
          onDiscardDraft={discardDraftOffer}
          dayConcert={dayConcert ? { name: dayConcert.name, songCount: dayConcert.songCount, canImport: dayConcert.ownerId === userId } : null}
          onImportToDay={() => dayConcert && setImportTarget(dayConcert)}
          onOpenDay={() => dayConcert && navigate(`/setlist/${dayConcert.id}`)}
          projectId={projectId}
          projectName={projectName}
          concerts={sortedConcerts}
          concertsError={concertsError}
          onPickConcert={pickConcert}
          openingConcertId={openingId}
          onOpenCopy={() => goTo('copy')}
          librarySize={impList.library.length}
          libraryLoading={impList.libraryLoading}
          libraryError={impList.libraryError}
          onRetryLibrary={impList.reloadLibrary}
          pickedCount={picked.length}
          onOpenLibrary={() => goTo('library')}
          onStartEmpty={() => enterReview('empty')}
        />
      )}

      {view === 'copy' && (
        <CopyStep
          concerts={sortedConcerts}
          error={concertsError}
          projectId={projectId}
          projectName={projectName}
          selectedId={copyId}
          songs={copySongs}
          withExtras={copyExtras}
          onToggleExtras={toggleCopyExtras}
          onSelect={selectConcert}
          onRetry={retryConcert}
        />
      )}

      {view === 'library' && (
        <LibraryStep
          library={impList.library}
          loading={impList.libraryLoading}
          error={impList.libraryError}
          onRetry={impList.reloadLibrary}
          projectName={projectName}
          isPersonal={!projectId}
          picked={picked}
          onToggle={toggleSong}
          onClear={clearPicked}
        />
      )}

      {view === 'review' && mode && (
        <ReviewStep
          mode={mode}
          importer={activeImp}
          sourceText={sourceText}
          crossNote={crossNote}
          name={nameValue}
          onName={setNameDraft}
          namePlaceholder={suggestedName}
          nameRef={nameRef}
          date={date}
          onDate={setDate}
          venue={venue}
          onVenue={setVenue}
          disabled={creating}
          isPersonal={!projectId}
          copyExtras={copyExtras}
          onCopyExtras={toggleCopyExtras}
          notice={fitNotice}
        />
      )}

      {bar && (
        <div className={styles.actionBar}>
          {bar.progress !== undefined && (
            <div className={styles.barTrack} aria-hidden="true">
              {bar.progress === null
                ? <div className={styles.barIndeterminate} />
                : <div className={styles.barFill} style={{ width: `${Math.round(bar.progress * 100)}%` }} />}
            </div>
          )}
          <div className={styles.barInner}>
            <div className={`${styles.barInfo} ${bar.optionalInfo ? styles.barInfoOptional : ''}`} aria-live="polite">
              <span className={styles.barLabel}>{bar.info}</span>
              {bar.sub && <span className={styles.barSub}>{bar.sub}</span>}
            </div>
            {bar.secondary}
            <button
              type="button"
              className={styles.barPrimary}
              onClick={onBarPrimary}
              disabled={bar.disabled}
              aria-busy={creating && view === 'review' ? true : undefined}
            >
              {bar.primary}
            </button>
          </div>
        </div>
      )}

      {importTarget && (
        <SetlistImportModal
          setlistId={importTarget.id}
          projectId={importTarget.bandId}
          currentPosition={importTarget.songCount}
          onClose={() => setImportTarget(null)}
          onImported={() => {
            const id = importTarget.id
            setImportTarget(null)
            navigate(`/setlist/${id}`)
          }}
        />
      )}
    </div>
  )
}
