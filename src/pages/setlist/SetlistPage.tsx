import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import SetlistImportModal from '../../components/SetlistImportModal'
import { supabase } from '../../lib/supabase'
import ExportPdfSheet from '../../components/ExportPdfSheet'
import type { PdfData, PdfKind } from '../../lib/pdfExport'
import { fmtSection } from '../../components/LyricsView'
import { useAuth } from '../../hooks/useAuth'
import { useOnline } from '../../hooks/useNetworkStatus'
import { idbAvailable, idbStatus } from '../../lib/offline/idb'
import { applyPendingOrder, savedAtLabel, type OfflineConcert } from '../../lib/offline/logic'
import { getPendingOrder, loadConcert, onOfflineChange, patchConcert, setPendingOrder, storedSavedAt } from '../../lib/offline/store'
import { fetchConcert, sendOrder } from '../../lib/offline/sync'
import type { Setlist, SetlistSong, Song } from '../../types'
import styles from './SetlistPage.module.css'
import { mapLegacyProjectColor } from '../../lib/projectColor'

type Row = SetlistSong & { song: Song }

/** Posição de setlist sempre com 2 dígitos — a assinatura "01 / 02" da v2 */
const pad2 = (n: number) => String(n).padStart(2, '0')
const fmtDur = (sec?: number | null) =>
  sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : ''

/* Abreviaturas fixas (o Intl pt-PT varia entre motores: "seg."/"segunda", "set.") */
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "seg 28 set 2026" (maiúsculas via CSS) a partir de "2026-09-28" — data local, sem fuso */
function fmtDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(y, m - 1, d)
  return `${WEEKDAYS[dt.getDay()]} ${pad2(d)} ${MONTHS[m - 1]} ${y}`
}

/** Primeira amostra v2 — o que Projetos mostra para um projeto sem cor */
const DEFAULT_PROJECT_COLOR = '#4CC9F0'

/** Cor do projeto pronta a pintar (LED e PDF). null = concerto pessoal, sem projeto. */
function projectLedColor(band: { color?: string | null } | null | undefined): string | null {
  if (!band) return null
  const raw = band.color?.trim()
  if (!raw) return DEFAULT_PROJECT_COLOR
  return mapLegacyProjectColor(raw)
}

/* ── Ícones: SVG stroke em currentColor ── */
function Ico({ size = 16, sw = 2, children }: { size?: number; sw?: number; children: ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >{children}</svg>
  )
}
const P = {
  grip: <path d="M5 8h14M5 12h14M5 16h14" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  note: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  doc: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>,
  list: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  /* Exportações: o MESMO download do Repertório (seta + base) */
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  /* Importar: seta a ENTRAR num documento — não se confunde com o download */
  import: <><path d="M5 10V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-1" /><path d="M14 3v5h5M2 14h9M8 11l3 3-3 3" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  flag: <path d="M4 21V4h12l-2 4 2 4H4" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
}

function SortableSongRow({ ss, index, last, selected, readOnly, onSelect, onEdit, onRemove, onOverrides, onLocked }: {
  ss: Row; index: number; last: boolean; selected: boolean; readOnly: boolean
  onSelect: (ss: Row) => void
  onEdit: (songId: string) => void; onRemove: (id: string) => void
  onOverrides: (ss: Row) => void
  /** Sem rede: o toque numa ação apagada diz porquê */
  onLocked: (what: string) => void
}) {
  // Sem rede (só leitura): nada de arrastar — a pega fica apagada e o toque explica
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ss.id, disabled: readOnly })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const hasOverrides = !!(ss.performance_key || ss.notes || ss.custom_intro || ss.custom_ending)
  const openOv = (e: MouseEvent) => { e.stopPropagation(); onOverrides(ss) }
  // Ecrã largo: clique seleciona para pré-visualizar no painel direito.
  // Ecrã estreito (sem painel): clique abre logo o tom/notas — senão o toque não faz nada.
  const onRowClick = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) onSelect(ss)
    else onOverrides(ss)
  }
  const dur = fmtDur(ss.song?.duration_sec)
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.songRow} ${last ? styles.songRowLast : ''} ${isDragging ? styles.dragging : ''} ${selected ? styles.songRowSelected : ''}`}
      onClick={onRowClick}
    >
      <button
        ref={setActivatorNodeRef}
        className={`${styles.dragHandle} ${readOnly ? styles.isOff : ''}`}
        {...attributes}
        {...listeners}
        onClick={e => { e.stopPropagation(); if (readOnly) onLocked('Mudar a ordem aqui precisa de rede — no modo concerto funciona sem rede') }}
        aria-disabled={readOnly || undefined}
        aria-label="Arrastar para reordenar"
        title={readOnly ? 'Reordenar — precisa de rede' : 'Arrastar para reordenar'}
      >
        <Ico size={18}>{P.grip}</Ico>
      </button>
      <span className={styles.songNum}>{pad2(index + 1)}</span>
      <div className={styles.songMain}>
        <span className={styles.songTitle}>{ss.song?.title}</span>
        <div className={styles.metaLine}>
          {ss.song?.artist && <span className={styles.songArtist}>{ss.song.artist}</span>}
          {ss.performance_key && (
            <button
              className={styles.keyChip}
              onClick={openOv}
              aria-label={`Tom nesta setlist: ${ss.performance_key} — editar tom e notas`}
            >{ss.performance_key}</button>
          )}
          {ss.song?.has_sync && <span className={styles.syncChip} aria-label="Letra sincronizada">Sync</span>}
          {ss.notes && (
            <span className={styles.metaIndicator} role="img" onClick={openOv} aria-label={`Notas: ${ss.notes}`} title={ss.notes}>
              <Ico size={15}>{P.doc}</Ico>
            </span>
          )}
          {(ss.custom_intro || ss.custom_ending) && (
            <span className={styles.metaIndicator} role="img" onClick={openOv} aria-label="Tem intro/final custom" title="Tem intro/final custom">
              <Ico size={15}>{P.flag}</Ico>
            </span>
          )}
          {/* Sem rede não se define nada: o atalho sai (o tom/notas que há continua a abrir-se) */}
          {!hasOverrides && !readOnly && (
            <button className={styles.ghostChip} onClick={openOv} aria-label="Definir tom e notas neste concerto">
              <Ico size={12} sw={2.4}>{P.plus}</Ico>Tom · notas
            </button>
          )}
        </div>
      </div>
      {/* Duração: coluna mono à direita em todas as larguras */}
      {dur && <span className={styles.songDur}>{dur}</span>}
      {/* Telemóvel: ✎ escondido (o toque na linha abre tom/notas, com atalho para a música);
          pega e ✕ só aparecem no modo "Editar" da lista */}
      <div className={styles.songActions}>
        {/* Sem rede: apagadas como o resto da edição; o toque diz porquê (o title não aparece no iPad) */}
        <button
          className={`${styles.iconBtn} ${styles.iconBtnEdit} ${readOnly ? styles.isOff : ''}`}
          onClick={e => { e.stopPropagation(); onEdit(ss.song_id) }}
          aria-disabled={readOnly || undefined}
          aria-label="Editar música"
          title={readOnly ? 'Editar música — precisa de rede' : 'Editar música'}
        >
          <Ico size={17}>{P.pencil}</Ico>
        </button>
        <button
          className={`${styles.iconBtn} ${styles.iconBtnDanger} ${readOnly ? styles.isOff : ''}`}
          onClick={e => { e.stopPropagation(); onRemove(ss.id) }}
          aria-disabled={readOnly || undefined}
          aria-label="Remover da setlist"
          title={readOnly ? 'Remover — precisa de rede' : 'Remover da setlist'}
        >
          <Ico size={17}>{P.close}</Ico>
        </button>
      </div>
    </div>
  )
}

/** Pré-visualização de letra: secções [X] como rótulos mono, linhas vazias como respiro */
function PreviewLyrics({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const t = line.trim()
        const sec = t.match(/^\[(.+?)\]$/)
        if (sec) return (
          <div key={i} className={styles.previewSectionRow}>
            <span className={styles.sectionTag}>{fmtSection(sec[1])}</span>
          </div>
        )
        if (t === '') return <div key={i} className={styles.previewBreak} />
        return <div key={i} className={styles.previewLine}>{line}</div>
      })}
    </>
  )
}

export default function SetlistPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const autoAddDone = useRef(false)
  const [setlist, setSetlist] = useState<Setlist | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [projectColor, setProjectColor] = useState<string | null>(null)
  const [songs, setSongs] = useState<Row[]>([])
  const [library, setLibrary] = useState<Song[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [libSelection, setLibSelection] = useState<Set<string>>(new Set())
  const [showLibrary, setShowLibrary] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [songsLoading, setSongsLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [venueSuggestions, setVenueSuggestions] = useState<{ name: string; detail: string }[]>([])
  const [showVenueDrop, setShowVenueDrop] = useState(false)
  const venueDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [date, setDate] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [dupBusy, setDupBusy] = useState(false)
  const [removedSong, setRemovedSong] = useState<Row | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [pdfKind, setPdfKind] = useState<PdfKind | null>(null)
  // A rede falhou ao abrir: está no ecrã a cópia guardada neste aparelho
  const [showingCopy, setShowingCopy] = useState(false)
  // Sem rede e sem cópia (ou o servidor diz que não existe)
  const [unavailable, setUnavailable] = useState<'offline' | 'gone' | 'error' | null>(null)
  // Cópia para usar sem rede: quando ficou guardada NESTE aparelho (lido do
  // IndexedDB — nunca da resposta da rede nem da memória da sessão: "Disponível
  // offline" só com a cópia mesmo guardada). null = não está guardada.
  const [copySavedAt, setCopySavedAt] = useState<number | null>(null)
  // A cópia que está no ecrã sem rede (pode ser só a da memória desta sessão)
  const [shownCopyAt, setShownCopyAt] = useState<number | null>(null)
  // 'ok' | 'opening' (IndexedDB ainda a abrir) | 'blocked' (o browser não deixa guardar, ex.: navegação privada)
  const [storeState, setStoreState] = useState<'ok' | 'opening' | 'blocked'>('ok')
  // O estado da cópia já foi lido (antes disso a linha fica vazia — sem "ainda não está guardado" por um instante)
  const [storeChecked, setStoreChecked] = useState(false)
  const [savingCopy, setSavingCopy] = useState(false)
  const online = useOnline()
  // Sem rede: só leitura (o modo concerto e os PDF funcionam; mudar o concerto não)
  const readOnly = showingCopy || !online
  const [canDelete, setCanDelete] = useState(false)
  // Telemóvel (≤640px): pega de arrasto e ✕ só em modo "Editar" — liberta largura ao texto.
  // Em ≥641px o CSS ignora este estado (as ações estão sempre visíveis).
  const [editMode, setEditMode] = useState(false)

  // Painel direito (≥1024px): música selecionada para pré-visualização.
  // Derivado com fallback para a primeira música — sobrevive a remoções/reordenações.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Per-setlist song overrides modal
  const [overrideRow, setOverrideRow] = useState<Row | null>(null)
  const [ovKey, setOvKey] = useState('')
  const [ovNotes, setOvNotes] = useState('')
  const [ovIntro, setOvIntro] = useState('')
  const [ovEnding, setOvEnding] = useState('')
  const [ovSaving, setOvSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  /** Mostra uma cópia do concerto (a guardada neste aparelho ou a acabada de vir da rede) */
  function showConcert(c: OfflineConcert, pendingIds: string[] | null) {
    const sl = c.setlist as unknown as Setlist & { bands?: { name?: string; color?: string | null } | null }
    setSetlist(sl)
    setProjectName(c.setlist.bands?.name ?? null)
    setProjectColor(projectLedColor(c.setlist.bands))
    setName(c.setlist.name)
    setVenue(c.setlist.venue ?? '')
    setDate(c.setlist.date ?? '')
    setSongs(applyPendingOrder(c.rows as Row[], pendingIds))
    setSongsLoading(false)
    setUnavailable(null)
  }

  // Cópia local primeiro (instantânea, e a única coisa que há sem rede);
  // a rede substitui-a e grava a cópia nova — abrir um concerto com rede
  // deixa-o pronto para usar offline
  useEffect(() => {
    if (!id || !user) return
    let alive = true
    let fromNet = false
    let hadCopy = false
    const userId = user.id
    // O que está MESMO guardado neste aparelho (e se o browser deixa guardar)
    const refreshStored = () => Promise.all([storedSavedAt(userId, id), idbAvailable()]).then(([at, okStore]) => {
      if (!alive) return
      setCopySavedAt(at)
      setStoreState(okStore ? 'ok' : idbStatus() === 'opening' ? 'opening' : 'blocked')
      setStoreChecked(true)
    }, () => {})
    Promise.all([loadConcert(userId, id), getPendingOrder(userId, id)]).then(([c, p]) => {
      if (!alive || !c) return
      hadCopy = true
      setShownCopyAt(c.savedAt)
      if (!fromNet) showConcert(c, p?.ids ?? null)
    }, () => {})
    loadSongs({ used: true }).then(status => {
      if (!alive) return
      fromNet = status === 'ok'
      refreshStored()
      if (status !== 'ok' && !hadCopy) {
        // Ainda pode estar a chegar a cópia: decide depois de a ler
        loadConcert(userId, id).then(c => {
          if (!alive) return
          if (c) {
            setShownCopyAt(c.savedAt)
            showConcert(c, null)
            return
          }
          setSongsLoading(false)
          setUnavailable(status === 'gone' || status === 'error' ? status : 'offline')
        }, () => {})
      }
    })
    // O prefetch em segundo plano (ou o palco) gravou uma cópia mais nova; o IndexedDB abriu tarde
    const unsub = onOfflineChange(sid => {
      if (sid !== null && sid !== id) return
      refreshStored()
      loadConcert(userId, id).then(c => {
        if (!alive || !c) return
        setShownCopyAt(c.savedAt)
        // Sem rede e sem nada no ecrã: a cópia que apareceu entra
        if (!fromNet && !hadCopy) {
          hadCopy = true
          showConcert(c, null)
        }
      }, () => {})
    })
    return () => { alive = false; unsub() }
  }, [id, user])

  useEffect(() => {
    if (autoAddDone.current) return
    if (searchParams.get('add') !== '1') return
    if (!setlist || !user) return
    autoAddDone.current = true
    loadLibrary()
  }, [setlist])

  /**
   * Concerto + músicas da rede (e a cópia offline atualizada). Sem rede ou
   * com erro, fica o que está no ecrã (a cópia) — só leitura.
   */
  async function loadSongs(opts: { used?: boolean; force?: boolean } = {}): Promise<'ok' | 'offline' | 'gone' | 'error'> {
    if (!id || !user) return 'error'
    const r = await fetchConcert(user.id, id, opts)
    if (r.status !== 'ok') {
      setShowingCopy(true)
      return r.status
    }
    setShowingCopy(false)
    showConcert(r.concert, null)
    // Apagar: dono do concerto, dono do projeto ou admin do projeto
    const sl = r.concert.setlist
    if (sl.owner_id === user.id || sl.bands?.owner_id === user.id) setCanDelete(true)
    else if (sl.band_id) {
      const { data: mem } = await supabase
        .from('band_members').select('role')
        .eq('band_id', sl.band_id).eq('user_id', user.id).maybeSingle()
      setCanDelete(mem?.role === 'owner' || mem?.role === 'admin')
    }
    return 'ok'
  }

  // A rede voltou: sai do "só leitura" com os dados verdadeiros
  useEffect(() => {
    if (online && showingCopy) loadSongs()
  }, [online])

  /** "Guardar para offline": lê tudo da rede já (mesmo que um pedido tenha falhado há pouco) */
  async function saveForOffline() {
    if (savingCopy || !id || !user) return
    setSavingCopy(true)
    const status = await loadSongs({ used: true, force: true })
    setSavingCopy(false)
    if (status !== 'ok') toast('Não foi possível guardar — sem ligação', { type: 'error' })
    else if (!(await storedSavedAt(user.id, id))) toast('Este browser não deixou guardar o concerto neste aparelho', { type: 'error' })
  }

  /**
   * Sem rede: o concerto não muda. Todas as ações de edição ficam apagadas
   * (aria-disabled, não disabled: o toque continua a chegar) e o toque diz o
   * quê e porquê — um aviso neutro, não um erro (é o estado esperado sem rede)
   */
  function blocked(what = 'Alterar o concerto precisa de rede'): boolean {
    if (!readOnly) return false
    toast(what)
    return true
  }

  async function loadLibrary() {
    if (!user || libraryLoading || blocked('Acrescentar músicas precisa de rede')) return
    // Abre o modal já com skeleton — o fetch pode demorar 1-3s em rede lenta
    setLibrary([])
    setLibSelection(new Set())
    setLibrarySearch('')
    setLibraryLoading(true)
    setShowLibrary(true)
    const existingIds = songs.map(s => s.song_id)
    let all: Song[]
    if (setlist?.band_id) {
      const { data } = await supabase.from('songs').select('*').eq('project_id', setlist.band_id).order('title')
      all = data ?? []
    } else {
      const { data } = await supabase.from('songs').select('*').eq('owner_id', user.id).order('title')
      all = data ?? []
    }
    setLibrary(all.filter(s => !existingIds.includes(s.id)))
    setLibraryLoading(false)
  }

  function closeLibrary() {
    setShowLibrary(false)
    setLibSelection(new Set())
  }

  async function addSelectedSongs(): Promise<boolean> {
    if (!id || libSelection.size === 0) return true
    const toAdd = library.filter(s => libSelection.has(s.id))
    // positions can have gaps after removals, so length would collide with
    // the unique (setlist_id, position) constraint — use max position + 1
    const basePos = songs.reduce((m, s) => Math.max(m, s.position), -1) + 1
    const { error } = await supabase.from('setlist_songs').insert(
      toAdd.map((s, i) => ({ setlist_id: id, song_id: s.id, position: basePos + i }))
    )
    if (error) { toast('Erro ao adicionar: ' + error.message, { type: 'error' }); return false }
    await loadSongs()
    closeLibrary()
    return true
  }

  // Atalho para a pesquisa: adiciona primeiro as músicas já selecionadas
  // (antes descartava-as sem aviso) e só depois navega
  async function goToSearch() {
    if (libSelection.size > 0) {
      const ok = await addSelectedSongs()
      if (!ok) return
    } else {
      closeLibrary()
    }
    navigate(setlist?.band_id ? `/search?project=${setlist.band_id}&setlist=${id}` : `/search?setlist=${id}`)
  }

  function toggleSelection(songId: string) {
    setLibSelection(prev => {
      const next = new Set(prev)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      return next
    })
  }

  /** Grava um campo do concerto; com erro avisa e volta ao valor guardado (nunca se perde em silêncio) */
  async function saveSetlistField(patch: { name?: string; venue?: string | null; date?: string | null }): Promise<boolean> {
    if (!id || !user) return false
    const { error } = await supabase.from('setlists').update(patch).eq('id', id)
    if (error) {
      toast('Não foi possível guardar: ' + (error.message || 'sem ligação'), { type: 'error' })
      setName(setlist?.name ?? '')
      setVenue(setlist?.venue ?? '')
      setDate(setlist?.date ?? '')
      return false
    }
    setSetlist(prev => (prev ? { ...prev, ...patch } as Setlist : prev))
    // A cópia offline (e o palco sem rede) fica igual
    patchConcert(user.id, id, c => ({ ...c, setlist: { ...c.setlist, ...patch } }))
    return true
  }

  async function saveVenue(val: string) {
    if (!id) return
    setVenue(val)
    setVenueSuggestions([])
    setShowVenueDrop(false)
    if ((val || null) === (setlist?.venue ?? null)) return
    if (blocked('Mudar o local precisa de rede')) { setVenue(setlist?.venue ?? ''); return }
    await saveSetlistField({ venue: val || null })
  }

  function onVenueInput(val: string) {
    setVenue(val)
    if (venueDebounceRef.current) clearTimeout(venueDebounceRef.current)
    if (val.trim().length < 3) { setVenueSuggestions([]); setShowVenueDrop(false); return }
    venueDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&accept-language=pt`, { headers: { 'Accept-Language': 'pt' } })
        const data: { display_name: string }[] = await res.json()
        const suggestions = data.map(r => { const parts = r.display_name.split(','); return { name: parts[0].trim(), detail: parts.slice(1, 3).map(s => s.trim()).join(', ') } })
        setVenueSuggestions(suggestions)
        setShowVenueDrop(suggestions.length > 0)
      } catch { /* ignore */ }
    }, 400)
  }

  async function saveDate(val: string) {
    if (!id || blocked('Mudar a data precisa de rede')) return
    setDate(val)
    await saveSetlistField({ date: val || null })
  }

  function openOverrides(ss: Row) {
    setOverrideRow(ss)
    setOvKey(ss.performance_key ?? '')
    setOvNotes(ss.notes ?? '')
    setOvIntro(ss.custom_intro ?? '')
    setOvEnding(ss.custom_ending ?? '')
  }

  async function saveOverrides(): Promise<boolean> {
    if (!overrideRow || !id || !user) return false
    if (blocked('Mudar o tom e as notas precisa de rede')) return false
    setOvSaving(true)
    const patch = {
      performance_key: ovKey.trim() || null,
      notes: ovNotes.trim() || null,
      custom_intro: ovIntro.trim() || null,
      custom_ending: ovEnding.trim() || null,
    }
    const rowId = overrideRow.id
    const { error } = await supabase.from('setlist_songs').update(patch).eq('id', rowId)
    setOvSaving(false)
    if (error) {
      // O modal fica aberto com o que foi escrito
      toast('Não foi possível guardar o tom e as notas: ' + (error.message || 'sem ligação'), { type: 'error' })
      return false
    }
    setSongs(prev => prev.map(s => s.id === rowId ? ({ ...s, ...patch } as Row) : s))
    // O palco (também sem rede) usa a cópia: tom, notas, intro e final novos
    patchConcert(user.id, id, c => ({
      ...c, rows: c.rows.map(r => (r.id === rowId ? { ...r, ...patch } as typeof r : r)),
    }))
    setOverrideRow(null)
    return true
  }

  // Atalho do modal para a página da música (no telemóvel o ✎ da linha está escondido).
  // Guarda primeiro o tom/notas para não perder o que foi escrito.
  async function openSongFromOverrides() {
    if (!overrideRow || ovSaving) return
    if (blocked('Editar a música precisa de rede')) return
    const songId = overrideRow.song_id
    if (!await saveOverrides()) return
    navigate(`/songs/${songId}?setlist=${id}`)
  }

  async function removeSong(ssId: string) {
    const row = songs.find(s => s.id === ssId)
    if (!row || blocked('Tirar músicas do concerto precisa de rede')) return
    const { error } = await supabase.from('setlist_songs').delete().eq('id', ssId)
    if (error) { toast('Erro ao remover: ' + error.message, { type: 'error' }); return }
    setSongs(prev => prev.filter(s => s.id !== ssId))
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setRemovedSong(row)
    undoTimerRef.current = setTimeout(() => setRemovedSong(null), 6000)
    if (id && user) patchConcert(user.id, id, c => ({ ...c, rows: c.rows.filter(r => r.id !== ssId) }))
  }

  async function undoRemove() {
    if (!removedSong || blocked('Anular precisa de rede')) return
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    const row = removedSong
    setRemovedSong(null)
    const { data, error } = await supabase.from('setlist_songs').insert({
      setlist_id: row.setlist_id,
      song_id: row.song_id,
      position: row.position,
      notes: row.notes ?? null,
      performance_key: row.performance_key ?? null,
      custom_intro: row.custom_intro ?? null,
      custom_ending: row.custom_ending ?? null,
    }).select('*, song:songs(*)').single()
    if (error || !data) { toast('Erro ao anular: ' + (error?.message ?? 'tenta de novo'), { type: 'error' }); return }
    setSongs(prev => [...prev, data as Row].sort((a, b) => a.position - b.position))
    loadSongs()
  }

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [])

  // Lista vazia: o botão "Editar" desaparece — sair do modo para não voltar "preso" nele
  useEffect(() => { if (songs.length === 0) setEditMode(false) }, [songs.length])

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || blocked('Mudar a ordem aqui precisa de rede — no modo concerto funciona sem rede')) return
    const oldIndex = songs.findIndex(s => s.id === active.id)
    const newIndex = songs.findIndex(s => s.id === over.id)
    const reordered = arrayMove(songs, oldIndex, newIndex)
    setSongs(reordered)
    await persistOrder(reordered)
  }

  async function persistOrder(order: Row[]) {
    if (!id || !user) return
    // O mesmo caminho do modo concerto (src/lib/offline/sync.ts): a ordem
    // fica na cópia e "por enviar" até o servidor a aceitar — 2 upserts em
    // lote, afasta tudo (10000+i) e depois assenta (i), por causa do
    // unique(setlist_id, position)
    const ids = order.map(r => r.id)
    await setPendingOrder(user.id, id, ids)
    patchConcert(user.id, id, c => ({ ...c, rows: applyPendingOrder(c.rows, ids) }))
    const result = await sendOrder(user.id, id, ids)
    if (result === 'offline') {
      toast('Sem rede — a nova ordem fica neste aparelho e é enviada quando houver ligação')
    } else if (result === 'failed') {
      toast('Erro ao reordenar', { type: 'error' })
      await loadSongs()
    }
  }

  async function saveName() {
    if (!id || !name.trim()) return
    if (name === setlist?.name) { setEditingName(false); return }
    setEditingName(false)
    if (blocked('Mudar o nome precisa de rede')) { setName(setlist?.name ?? ''); return }
    await saveSetlistField({ name })
  }

  function cancelNameEdit() {
    setName(setlist?.name ?? '')
    setEditingName(false)
  }

  async function deleteSetlist() {
    if (!id || blocked('Apagar o concerto precisa de rede')) return
    if (!await confirmDialog({ title: 'Apagar concerto', message: `Apagar o concerto "${setlist?.name}"? Esta ação não pode ser desfeita.`, confirmLabel: 'Apagar', danger: true })) return
    const { error: e1 } = await supabase.from('setlist_songs').delete().eq('setlist_id', id)
    if (e1) { toast('Erro ao apagar músicas do concerto: ' + e1.message, { type: 'error' }); return }
    const { error: e2 } = await supabase.from('setlists').delete().eq('id', id)
    if (e2) { toast('Erro ao apagar concerto: ' + e2.message, { type: 'error' }); return }
    setlist?.band_id ? navigate(`/projects/${setlist.band_id}?tab=setlists`) : navigate('/setlists')
  }

  async function duplicateTo(projectId: string) {
    if (!user || !setlist || dupBusy || blocked('Duplicar precisa de rede')) return
    // Mantém o picker aberto com busy — evita re-toques que criam duplicados
    setDupBusy(true)
    const { data: newSl, error } = await supabase
      .from('setlists')
      .insert({ name: `${setlist.name} (cópia)`, owner_id: user.id, band_id: projectId, is_shared: true })
      .select()
      .single()
    if (error) {
      setDupBusy(false)
      toast('Erro ao duplicar: ' + error.message, { type: 'error' })
      return
    }
    if (newSl && songs.length) {
      await supabase.from('setlist_songs').insert(
        songs.map((s, i) => ({ setlist_id: newSl.id, song_id: s.song_id, position: i }))
      )
    }
    setDupBusy(false)
    setDuplicating(false)
    if (newSl) navigate(`/setlist/${newSl.id}`)
  }

  /** Dados do PDF: tom/notas/intro/final deste concerto + cor e nome do projeto */
  function pdfData(): PdfData {
    return {
      meta: {
        title: setlist?.name ?? name,
        subtitle: projectName,
        date: date || setlist?.date || null,
        venue: venue || setlist?.venue || null,
        color: projectColor,
        context: 'concert',
      },
      songs: songs.map(ss => ({
        title: ss.song?.title ?? '',
        artist: ss.song?.artist,
        // Tom do concerto > tom de performance da música > original
        key: ss.performance_key || ss.song?.performance_key || ss.song?.original_key || null,
        originalKey: ss.song?.original_key,
        bpm: ss.song?.bpm,
        capo: ss.song?.capo,
        durationSec: ss.song?.duration_sec,
        lyrics: ss.song?.edited_lyrics ?? ss.song?.lyrics,
        chords: ss.song?.chords,
        intro: ss.custom_intro,
        ending: ss.custom_ending,
        notes: ss.notes,
      })),
    }
  }

  function exportPdf(withLyrics: boolean) {
    if (!setlist) return
    setPdfKind(withLyrics ? 'repertorio' : 'alinhamento')
  }

  const selectedRow = songs.find(s => s.id === selectedId) ?? songs[0] ?? null
  const selectedIndex = selectedRow ? songs.findIndex(s => s.id === selectedRow.id) : -1
  const selectedDur = fmtDur(selectedRow?.song?.duration_sec)
  const previewText = ((selectedRow?.song?.edited_lyrics ?? selectedRow?.song?.lyrics) ?? '').trim()
  // Resumo dos overrides deste concerto — pares rótulo/valor para a linha mono
  const overrideItems: [string, string][] = selectedRow
    ? ([
        ['Tom', selectedRow.performance_key],
        ['Intro', selectedRow.custom_intro],
        ['Final', selectedRow.custom_ending],
        ['Notas', selectedRow.notes],
      ] as [string, string | undefined][]).filter((p): p is [string, string] => !!p[1])
    : []

  const totalSec = songs.reduce((acc, s) => acc + (s.song?.duration_sec ?? 0), 0)
  const totalMin = Math.floor(totalSec / 60)
  const durationLabel = totalMin >= 60
    ? `${Math.floor(totalMin / 60)}h${String(totalMin % 60).padStart(2, '0')}`
    : `${totalMin} min`
  const filteredLibrary = library.filter(s =>
    !librarySearch || `${s.title} ${s.artist}`.toLowerCase().includes(librarySearch.toLowerCase())
  )

  return (
    <>
      <div className={styles.page}>
        {unavailable && !setlist ? (
          <div className={styles.empty} role="status" data-offline-unavailable={unavailable}>
            <span className={styles.emptyIcon} aria-hidden="true"><Ico size={28} sw={1.8}>{P.list}</Ico></span>
            <p className={styles.emptyTitle}>
              {unavailable === 'offline' ? 'Concerto não guardado neste aparelho' : 'Concerto indisponível'}
            </p>
            <p className={styles.emptyText}>
              {unavailable === 'gone'
                ? 'Não existe ou já não tens acesso.'
                : unavailable === 'error'
                  ? 'Não foi possível abrir este concerto. Tenta de novo daqui a pouco.'
                  : 'Sem ligação. Abre-o uma vez com rede para o teres disponível offline.'}
            </p>
            <button className={styles.secondaryBtn} onClick={() => navigate('/setlists')}>Ver concertos</button>
          </div>
        ) : (<>
        {/* ══ HEADER ══ ≥1024px: título à esquerda, ações à direita */}
        <header className={styles.header}>
          <div className={styles.headMain}>
            <Breadcrumbs items={
              setlist?.band_id
                ? [
                    { label: 'Projetos', to: '/' },
                    { label: projectName ?? 'Projeto', to: `/projects/${setlist.band_id}?tab=setlists` },
                    { label: setlist?.name ?? 'Concerto' },
                  ]
                : [
                    { label: 'Concertos', to: '/setlists' },
                    { label: setlist?.name ?? 'Concerto' },
                  ]
            } />
            {editingName ? (
              <input
                className={styles.nameInput}
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveName()
                  else if (e.key === 'Escape') cancelNameEdit()
                }}
                aria-label="Nome do concerto"
                autoFocus
              />
            ) : (
              <h1 className={styles.title}>
                {setlist ? (
                  <button type="button" className={styles.titleBtn} onClick={() => { if (!blocked('Mudar o nome precisa de rede')) setEditingName(true) }} title={readOnly ? 'Editar nome — precisa de rede' : 'Editar nome'}>
                    <span className={styles.titleText}>{setlist.name}</span>
                    {/* Sem rede não se edita: sem o ✎ (o toque no título diz porquê) */}
                    {!readOnly && <span className={styles.editHint} aria-hidden="true"><Ico size={18}>{P.pencil}</Ico></span>}
                  </button>
                ) : (
                  <span className={`skeleton ${styles.titleSkeleton}`} aria-label="A carregar" />
                )}
              </h1>
            )}

            {/* Linha de metadados mono — só texto e separadores, como no Palco,
                Dashboard e Concertos: SEG 28 SET 2026 · LOCAL · 12 MÚS · 40 MIN
                Data e local editáveis inline — parecem texto; hairline só em hover/foco */}
            <div className={styles.metaRow}>
              {/* Sem rede: o seletor não abre (o input não apanha o toque) e o toque explica */}
              <label
                className={`${styles.metaField} ${styles.dateField} ${!date ? styles.metaEmpty : ''} ${readOnly ? styles.metaLocked : ''}`}
                onClick={() => { if (readOnly) blocked('Mudar a data precisa de rede') }}
              >
                <span className={styles.metaBox}>
                  <span className={styles.metaText} aria-hidden="true">{date ? fmtDateLabel(date) : 'Sem data'}</span>
                </span>
                {/* Input nativo invisível por cima: o toque em qualquer ponto abre o seletor */}
                <input
                  className={styles.dateInput}
                  type="date"
                  value={date}
                  onChange={e => saveDate(e.target.value)}
                  disabled={readOnly}
                  aria-label="Data do concerto"
                />
              </label>
              <span className={styles.metaSep} aria-hidden="true">·</span>
              <div className={styles.venueWrap}>
                <label className={styles.metaField}>
                  <span className={styles.metaBox}>
                    <span className={styles.venueBox} data-value={venue || 'Local / evento'}>
                      <input
                        className={styles.venueInput}
                        value={venue}
                        size={1}
                        onChange={e => onVenueInput(e.target.value)}
                        onBlur={e => saveVenue(e.target.value)}
                        title={venue || undefined}
                        placeholder="Local / evento"
                        aria-label="Local do concerto"
                        autoComplete="off"
                        readOnly={readOnly}
                        onClick={() => { if (readOnly) blocked('Mudar o local precisa de rede') }}
                      />
                    </span>
                  </span>
                </label>
                {showVenueDrop && (
                  <div className={styles.venueDrop} role="listbox" aria-label="Sugestões de local">
                    {venueSuggestions.map((s, i) => (
                      <div key={i} className={styles.venueDropItem} role="option" aria-selected={false}
                        onMouseDown={e => { e.preventDefault(); saveVenue(s.name) }}
                      >
                        <span className={styles.venueDropName}>{s.name}</span>
                        {s.detail && <span className={styles.venueDropDetail}>{s.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className={`${styles.metaSep} ${styles.metaSepCount}`} aria-hidden="true">·</span>
              {/* "12 mús" — a mesma abreviatura das linhas de Concertos, Palco e Dashboard */}
              <span className={styles.metaCount}>
                {songs.length} mús
                {totalMin > 0 ? ` · ${durationLabel}` : ''}
              </span>
            </div>

            {/* Para usar sem rede: "● DISPONÍVEL OFFLINE · GUARDADO ÀS 14:32" só
                com a cópia MESMO guardada neste aparelho; sem ligação, só leitura
                (o modo concerto funciona na mesma). Os "·" vão com o texto
                seguinte (sem rede, no telemóvel a linha parte sem um "·" pendurado) */}
            {setlist && (() => {
              const shownAt = copySavedAt ?? shownCopyAt
              const status = readOnly ? 'readonly'
                : !storeChecked ? 'checking'
                  : copySavedAt ? 'saved'
                    : storeState === 'blocked' ? 'blocked'
                      : storeState === 'opening' ? 'opening' : 'none'
              return (
                <div className={styles.offlineStatus} role="status" data-offline-status={status}>
                  {status === 'readonly' ? (
                    <>
                      <span className={`${styles.offlineStatusLed} ${styles.offlineStatusLedWarn}`} aria-hidden="true" />
                      <span className={`${styles.offlineStatusMain} ${styles.offlineStatusItem}`}>Sem ligação · só leitura</span>
                      {shownAt && <span className={styles.offlineStatusItem}>· Cópia guardada {savedAtLabel(shownAt, new Date())}</span>}
                    </>
                  ) : status === 'checking' ? null : status === 'saved' && copySavedAt ? (
                    <>
                      <span className={styles.offlineStatusLed} aria-hidden="true" />
                      <span className={`${styles.offlineStatusMain} ${styles.offlineStatusItem}`}>Disponível offline</span>
                      <span className={styles.offlineStatusItem}>· Guardado {savedAtLabel(copySavedAt, new Date())}</span>
                    </>
                  ) : status === 'blocked' ? (
                    <>
                      <span className={`${styles.offlineStatusLed} ${styles.offlineStatusLedOff}`} aria-hidden="true" />
                      <span className={styles.offlineStatusMain}>Este browser não deixa guardar para offline</span>
                    </>
                  ) : status === 'opening' ? (
                    <>
                      <span className={`${styles.offlineStatusLed} ${styles.offlineStatusLedOff}`} aria-hidden="true" />
                      <span className={styles.offlineStatusMain}>A guardar neste aparelho…</span>
                    </>
                  ) : (
                    <>
                      <span className={`${styles.offlineStatusLed} ${styles.offlineStatusLedOff}`} aria-hidden="true" />
                      <span className={styles.offlineStatusMain}>Ainda não está guardado para offline</span>
                      <button type="button" className={styles.offlineSaveBtn} onClick={saveForOffline} disabled={savingCopy}>
                        {savingCopy ? 'A guardar…' : 'Guardar para offline'}
                      </button>
                    </>
                  )}
                </div>
              )
            })()}
          </div>

          <div className={styles.headActions}>
            {/* Ação-assinatura: largura natural (ícone + padding), igual ao Palco */}
            <button className={styles.concertBtn} onClick={() => navigate(`/setlist/${id}/concert`)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M7 4.5v15l12.5-7.5L7 4.5Z" />
              </svg>
              Iniciar concerto
            </button>
            {/* Barra de ferramentas: botões secundários SOLTOS — o mesmo tratamento
                do Repertório ("Lista PDF", "Repertório PDF", ambos com download).
                Sempre UMA linha, sem scroll. Telemóvel: colunas iguais, ícone por
                cima do rótulo e "PDF" como micro-etiqueta mono por baixo */}
            <div className={styles.toolbar} role="group" aria-label="Mais ações do concerto">
              {/* Importar escreve no alinhamento (setlist_songs): só o dono do concerto pode — senão
                  as músicas novas eram criadas no repertório e o alinhamento recusado (RLS) */}
              {setlist && setlist.owner_id === user?.id && (
                <button className={`${styles.toolBtn} ${readOnly ? styles.isOff : ''}`} onClick={() => { if (!blocked('Importar precisa de rede')) setShowImport(true) }} aria-disabled={readOnly || undefined} title="Importar lista (PDF, foto ou texto)">
                  <Ico size={16}>{P.import}</Ico><span className={styles.toolLabel}>Importar</span>
                </button>
              )}
              <button className={styles.toolBtn} onClick={() => exportPdf(false)} title="Exportar a lista de músicas em PDF">
                <Ico size={16}>{P.download}</Ico>
                <span className={styles.toolLabel}>Lista <span className={styles.toolTag}>PDF</span></span>
              </button>
              <button className={styles.toolBtn} onClick={() => exportPdf(true)} title="Exportar o repertório com letras em PDF">
                <Ico size={16}>{P.download}</Ico>
                <span className={styles.toolLabel}>Repertório <span className={styles.toolTag}>PDF</span></span>
              </button>
              <button className={`${styles.toolBtn} ${readOnly ? styles.isOff : ''}`} onClick={() => { if (!blocked('Duplicar precisa de rede')) setDuplicating(true) }} aria-disabled={readOnly || undefined} title="Duplicar para outro projeto">
                <Ico size={16}>{P.copy}</Ico><span className={styles.toolLabel}>Duplicar</span>
              </button>
            </div>
          </div>
        </header>

        {/* ≥1024px: duas colunas — alinhamento à esquerda, pré-visualização à direita */}
        <div className={styles.columns}>
          <section className={styles.songList} aria-label="Alinhamento">
            <div className={styles.listHeader}>
              <span className={styles.listLabel}>
                {projectColor && <span className={styles.led} style={{ background: projectColor }} aria-hidden="true" />}
                <span className={styles.listLabelText}>Alinhamento</span>
                {songs.length > 0 && <span className={styles.listCount}>· {pad2(songs.length)}</span>}
              </span>
              <div className={styles.listHeadActions}>
                {songs.length > 0 && (
                  <button
                    className={`${styles.editToggle} ${editMode ? styles.editToggleOn : ''} ${readOnly && !editMode ? styles.isOff : ''}`}
                    onClick={() => { if (editMode || !blocked('Editar o alinhamento precisa de rede')) setEditMode(v => !v) }}
                    aria-pressed={editMode}
                    aria-disabled={(readOnly && !editMode) || undefined}
                  >{editMode ? 'Concluir' : 'Editar'}</button>
                )}
                <button className={`${styles.secondaryBtn} ${readOnly ? styles.isOff : ''}`} onClick={loadLibrary} disabled={libraryLoading} aria-disabled={readOnly || undefined}>
                  <Ico size={16} sw={2.2}>{P.plus}</Ico>
                  {libraryLoading ? 'A carregar…' : 'Adicionar'}
                </button>
              </div>
            </div>

            {songsLoading ? (
              <div className={styles.skeletonList} aria-hidden="true">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className={`skeleton ${styles.skeletonRow}`} />
                ))}
              </div>
            ) : songs.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon} aria-hidden="true"><Ico size={28} sw={1.8}>{P.list}</Ico></span>
                <p className={styles.emptyTitle}>Sem músicas ainda</p>
                <p className={styles.emptyText}>Adiciona músicas do repertório para montar o alinhamento.</p>
                <button className={`${styles.secondaryBtn} ${readOnly ? styles.isOff : ''}`} onClick={loadLibrary} disabled={libraryLoading} aria-disabled={readOnly || undefined}>
                  <Ico size={16} sw={2.2}>{P.plus}</Ico>Adicionar música
                </button>
              </div>
            ) : (
              <div className={`${styles.rows} ${editMode ? styles.rowsEdit : ''}`}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={songs.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {songs.map((ss, i) => (
                      <SortableSongRow
                        key={ss.id}
                        ss={ss}
                        index={i}
                        last={i === songs.length - 1}
                        selected={selectedRow?.id === ss.id}
                        readOnly={readOnly}
                        onSelect={row => setSelectedId(row.id)}
                        onEdit={songId => { if (!blocked('Editar a música precisa de rede')) navigate(`/songs/${songId}?setlist=${id}`) }}
                        onRemove={removeSong}
                        onOverrides={openOverrides}
                        onLocked={what => blocked(what)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            )}
          </section>

          {/* Painel da música selecionada — só leitura + 2 ações; escondido <1024px via CSS */}
          <aside className={styles.previewPanel} aria-label="Pré-visualização da música selecionada">
            {songsLoading ? (
              <div className={styles.skeletonList} aria-hidden="true">
                {[0, 1, 2].map(i => (
                  <div key={i} className={`skeleton ${styles.skeletonRow}`} />
                ))}
              </div>
            ) : !selectedRow ? (
              <div className={styles.previewEmpty}>
                <span className={styles.emptyIcon} aria-hidden="true"><Ico size={28} sw={1.8}>{P.note}</Ico></span>
                <p className={styles.emptyTitle}>Nada para mostrar</p>
                <p className={styles.emptyText}>Adiciona músicas ao alinhamento para veres a letra aqui.</p>
              </div>
            ) : (
              <>
                <div className={styles.previewHeader}>
                  <div className={styles.previewKicker}>
                    <span className={styles.previewKickerNum}>{pad2(selectedIndex + 1)}</span>
                    <span>/ {pad2(songs.length)}</span>
                    {selectedDur && <><span aria-hidden="true">·</span><span>{selectedDur}</span></>}
                    {selectedRow.song?.has_sync && <span className={styles.syncChip}>Sync</span>}
                  </div>
                  <h2 className={styles.previewSongTitle}>{selectedRow.song?.title}</h2>
                  {selectedRow.song?.artist && <div className={styles.previewArtist}>{selectedRow.song.artist}</div>}
                  {overrideItems.length > 0 && (
                    <div className={styles.ovSummary} aria-label="Alterações neste concerto">
                      <span className={styles.ovSummaryLabel}>Neste concerto</span>
                      {overrideItems.map(([k, v]) => (
                        <span key={k} className={styles.ovSummaryItem}>
                          <span className={styles.ovSummaryKey}>{k}</span>
                          <span className={styles.ovSummaryVal}>{v}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={styles.previewActions}>
                    {/* Sem rede: apagado como o ✎ da linha (a página da música precisa de rede) */}
                    <button
                      className={`${styles.secondaryBtn} ${readOnly ? styles.isOff : ''}`}
                      onClick={() => { if (!blocked('Editar a letra precisa de rede')) navigate(`/songs/${selectedRow.song_id}?setlist=${id}`) }}
                      aria-disabled={readOnly || undefined}
                    ><Ico size={16}>{P.pencil}</Ico>Editar letra</button>
                    <button
                      className={styles.secondaryBtn}
                      onClick={() => openOverrides(selectedRow)}
                    ><Ico size={16}>{P.sliders}</Ico>Tom &amp; notas</button>
                  </div>
                </div>
                {previewText ? (
                  <div className={styles.previewBody}>
                    <PreviewLyrics text={previewText} />
                  </div>
                ) : (
                  <div className={styles.previewEmpty}>
                    <span className={styles.emptyIcon} aria-hidden="true"><Ico size={28} sw={1.8}>{P.mic}</Ico></span>
                    <p className={styles.emptyTitle}>Sem letra</p>
                    <p className={styles.emptyText}>Esta música ainda não tem letra.</p>
                    <button
                      className={`${styles.secondaryBtn} ${readOnly ? styles.isOff : ''}`}
                      onClick={() => { if (!blocked('Acrescentar a letra precisa de rede')) navigate(`/songs/${selectedRow.song_id}?setlist=${id}`) }}
                      aria-disabled={readOnly || undefined}
                    ><Ico size={16} sw={2.2}>{P.plus}</Ico>Adicionar letra</button>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>

        {canDelete && (
          <button className={`${styles.deleteLink} ${readOnly ? styles.isOff : ''}`} onClick={deleteSetlist} aria-disabled={readOnly || undefined}>
            <Ico size={16}>{P.trash}</Ico>
            Apagar este concerto
          </button>
        )}
        </>)}
      </div>

      {/* Per-setlist overrides modal */}
      {overrideRow && (
        <div className={styles.overlay} onClick={() => setOverrideRow(null)}>
          <div
            className={styles.modal}
            role="dialog" aria-modal="true" aria-labelledby="ov-title"
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalHeadText}>
                <div className={styles.kicker}>
                  <span className={styles.kickerLed} aria-hidden="true" />
                  Só neste concerto
                </div>
                <h2 id="ov-title" className={styles.modalTitle}>{overrideRow.song?.title}</h2>
                <p className={styles.modalSub}>Não altera a música original.</p>
              </div>
              <button className={styles.closeBtn} onClick={() => setOverrideRow(null)} aria-label="Fechar">
                <Ico size={20}>{P.close}</Ico>
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Sem rede: o aviso no topo do corpo (à vista sem scroll, na margem dos campos) */}
              {readOnly && (
                <p className={styles.ovOffline} role="status">Sem ligação — o tom e as notas não podem ser guardados agora.</p>
              )}
              <div className={styles.ovField}>
                <label className={styles.ovLabel} htmlFor="ov-key">Tom nesta setlist</label>
                <input
                  id="ov-key"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={ovKey}
                  readOnly={readOnly}
                  onChange={e => setOvKey(e.target.value)}
                  placeholder={overrideRow.song?.performance_key || overrideRow.song?.original_key || 'ex: G, Am, F#'}
                  autoComplete="off"
                />
              </div>

              <div className={styles.ovField}>
                <label className={styles.ovLabel} htmlFor="ov-intro">Intro</label>
                <input
                  id="ov-intro"
                  className={styles.input}
                  value={ovIntro}
                  readOnly={readOnly}
                  onChange={e => setOvIntro(e.target.value)}
                  placeholder="ex: 4 compassos só bateria"
                />
              </div>

              <div className={styles.ovField}>
                <label className={styles.ovLabel} htmlFor="ov-ending">Final</label>
                <input
                  id="ov-ending"
                  className={styles.input}
                  value={ovEnding}
                  readOnly={readOnly}
                  onChange={e => setOvEnding(e.target.value)}
                  placeholder="ex: termina em fade, segue direto para a próxima"
                />
              </div>

              <div className={styles.ovField}>
                <label className={styles.ovLabel} htmlFor="ov-notes">Notas</label>
                <textarea
                  id="ov-notes"
                  className={`${styles.input} ${styles.textarea}`}
                  value={ovNotes}
                  readOnly={readOnly}
                  onChange={e => setOvNotes(e.target.value)}
                  placeholder="Notas visíveis no modo concerto..."
                  rows={3}
                />
              </div>

              {/* Atalho para a música (no telemóvel substitui o ✎ da linha) */}
              <button className={`${styles.ovSongLink} ${readOnly ? styles.isOff : ''}`} onClick={openSongFromOverrides} disabled={ovSaving} aria-disabled={readOnly || undefined}>
                <Ico size={16}>{P.pencil}</Ico>
                <span className={styles.ovSongLinkLabel}>Editar letra e música</span>
                <Ico size={16}>{P.chevron}</Ico>
              </button>
            </div>

            <div className={`${styles.modalFooter} ${styles.modalFooterSplit}`}>
              <button className={styles.secondaryBtn} onClick={() => setOverrideRow(null)}>{readOnly ? 'Fechar' : 'Cancelar'}</button>
              <button className={`${styles.primaryBtn} ${readOnly ? styles.isOff : ''}`} onClick={saveOverrides} disabled={ovSaving} aria-disabled={readOnly || undefined}>
                {ovSaving ? 'A guardar…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pdfKind && setlist && (
        <ExportPdfSheet kind={pdfKind} data={pdfData()} onClose={() => setPdfKind(null)} />
      )}

      {showImport && setlist && setlist.owner_id === user?.id && (
        <SetlistImportModal
          setlistId={id!}
          projectId={setlist.band_id ?? null}
          currentPosition={songs.length}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadSongs() }}
        />
      )}

      {duplicating && (
        <ProjectPickerModal
          title="Duplicar concerto para que projeto?"
          onPick={duplicateTo}
          onClose={() => !dupBusy && setDuplicating(false)}
          busy={dupBusy}
        />
      )}

      {showLibrary && (
        <div className={styles.overlay} onClick={closeLibrary}>
          <div
            className={`${styles.modal} ${styles.modalTall}`}
            role="dialog" aria-modal="true" aria-labelledby="lib-title"
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalHeadText}>
                <div className={styles.kicker}>Adicionar ao alinhamento</div>
                <h2 id="lib-title" className={styles.modalTitle}>Biblioteca</h2>
              </div>
              <button className={styles.closeBtn} onClick={closeLibrary} aria-label="Fechar">
                <Ico size={20}>{P.close}</Ico>
              </button>
            </div>

            <div className={styles.modalTools}>
              <div className={styles.searchField}>
                <span className={styles.searchIcon} aria-hidden="true"><Ico size={18}>{P.search}</Ico></span>
                <input
                  className={`${styles.input} ${styles.searchInput}`}
                  placeholder="Filtrar músicas..."
                  value={librarySearch}
                  onChange={e => setLibrarySearch(e.target.value)}
                  aria-label="Filtrar músicas"
                  autoFocus
                />
              </div>
            </div>

            <div className={styles.modalBody}>
              {libraryLoading ? (
                <div className={styles.skeletonListFlush} aria-hidden="true">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className={`skeleton ${styles.skeletonRow}`} />
                  ))}
                </div>
              ) : library.length === 0 ? (
                <div className={styles.modalEmpty}>
                  <span className={styles.emptyIcon} aria-hidden="true"><Ico size={28} sw={1.8}>{P.note}</Ico></span>
                  <p className={styles.emptyText}>{setlist?.band_id ? 'Nenhuma música no repertório do projeto.' : 'Sem músicas na biblioteca.'}</p>
                  <button className={styles.secondaryBtn} onClick={goToSearch}>
                    <Ico size={16}>{P.search}</Ico>Pesquisar música nova
                  </button>
                </div>
              ) : (
                <>
                  <button className={styles.searchNewBtn} onClick={goToSearch}>
                    <Ico size={18}>{P.search}</Ico>
                    <span className={styles.searchNewLabel}>Pesquisar música que não está aqui</span>
                    <Ico size={16}>{P.chevron}</Ico>
                  </button>
                  {filteredLibrary.length > 0 ? (
                    <div className={styles.libList}>
                      {filteredLibrary.map(song => {
                        const sel = libSelection.has(song.id)
                        return (
                          <div
                            key={song.id}
                            className={`${styles.libraryRow} ${sel ? styles.libraryRowSelected : ''}`}
                            role="checkbox"
                            aria-checked={sel}
                            tabIndex={0}
                            onClick={() => toggleSelection(song.id)}
                            onKeyDown={e => {
                              if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelection(song.id) }
                            }}
                          >
                            <span className={`${styles.check} ${sel ? styles.checkOn : ''}`} aria-hidden="true">
                              {sel && <Ico size={14} sw={3}>{P.check}</Ico>}
                            </span>
                            <div className={styles.libInfo}>
                              <div className={styles.libTitle}>{song.title}</div>
                              <div className={styles.libMeta}>
                                {song.artist && <span className={styles.libArtist}>{song.artist}</span>}
                                {song.has_sync && <span className={styles.syncChip}>Sync</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className={styles.libNoMatch}>Nenhuma música corresponde a “{librarySearch}”.</p>
                  )}
                </>
              )}
            </div>

            {libSelection.size > 0 && (
              <div className={styles.modalFooter}>
                <button className={`${styles.primaryBtn} ${styles.primaryBtnWide}`} onClick={addSelectedSongs}>
                  <Ico size={18} sw={2.4}>{P.plus}</Ico>
                  Adicionar {libSelection.size} música{libSelection.size !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {removedSong && (
        <div className={styles.undoSnackbar} role="status">
          <span className={styles.undoText}>Música removida</span>
          <button className={styles.undoBtn} onClick={undoRemove}>Anular</button>
        </div>
      )}
    </>
  )
}
