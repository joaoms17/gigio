import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { transposeChordsText } from '../../lib/transpose'
import {
  cacheSetlistSongs, getCachedSetlistSongs,
  cacheSyncLines, getCachedSyncLines,
  cacheTheme, getCachedTheme,
  getCachedSetlistMeta,
} from '../../lib/concertCache'
import AnnotatedLyrics from '../../components/AnnotatedLyrics'
import { loadAnnotations, pullAnnotations } from '../../components/AnnotationLayer'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { fmtSection, parseRgb, withAlpha } from '../../components/LyricsView'
import type { SetlistSong, Song, ConcertTheme, LyricLine } from '../../types'
import styles from './ConcertPage.module.css'
import { DEFAULT_CONCERT_THEME, normalizeConcertTheme } from '../../lib/concertTheme'

type Row = SetlistSong & { song: Song }
type ContentView = 'lyrics' | 'chords' | 'annotations'

/** Confirmação não-bloqueante no topo da letra ("SINCRONIZADO · 1:24", …) */
type Chip = {
  n: number
  label: string
  value?: string
  suffix?: string
  /** LED aceso = relógio a correr; apagado = parado */
  live: boolean
  ms: number
}

/** Coluna de alinhamento aberta/recolhida (≥1024px) — por dispositivo */
const SIDEBAR_KEY = 'gigio-concert-sidebar'
/**
 * Limiares por media query (e não por innerWidth): o CSS usa exatamente as
 * mesmas, por isso coluna/folha e escala da letra nunca divergem (zoom com
 * larguras fracionárias, pinch-zoom do iOS)
 */
const WIDE_QUERY = '(min-width: 1024px)'
const TABLET_QUERY = '(min-width: 768px)'
/** Voltar a uma música há menos disto retoma onde estava (toque/swipe acidental) */
const RESUME_WINDOW_MS = 2 * 60 * 1000
/** Uma música que arrancou, ou que esteve aberta este tempo, conta como tocada */
const PLAYED_MIN_MS = 45 * 1000
/** LINHA › logo depois de o relógio acender uma linha = confirmar essa linha */
const LINE_GRACE_MS = 800
/** Janela do 2.º toque que confirma mudar de música pelo pedal/setas */
const ARM_MS = 2000
/** Janela do 2.º toque numa linha da coluna com a música a tocar */
const ARM_ROW_MS = 2500

function fmtTime(secs: number) {
  const s = Math.max(0, Math.floor(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Posição de setlist sempre com 2 dígitos: 01, 02… (assinatura v2) */
function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** Linha "cantável" — ignora entradas de sync vazias e marcadores [Secção] */
function isLyricText(text: string) {
  const t = text.trim()
  return t !== '' && !/^\[.+\]$/.test(t)
}

/** Última entrada de sync já alcançada em `ms` (-1 = ainda antes da 1.ª) */
function syncIndexAt(sl: LyricLine[], ms: number) {
  let idx = -1
  for (let i = 0; i < sl.length; i++) {
    if (sl[i].time_ms <= ms) idx = i
  }
  return idx
}

/** Linha de letra seguinte (dir 1) ou anterior (dir -1) a `from`, exclusivo; -1 se não houver */
function findLyric(sl: LyricLine[], from: number, dir: 1 | -1) {
  for (let j = from + dir; j >= 0 && j < sl.length; j += dir) {
    if (isLyricText(sl[j].text)) return j
  }
  return -1
}

/** matchMedia com o evento change (addListener no Safari antigo) */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    try { return window.matchMedia(query).matches } catch { return false }
  })
  useEffect(() => {
    let mql: MediaQueryList
    try { mql = window.matchMedia(query) } catch { return }
    const onChange = () => setMatches(mql.matches)
    onChange()
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [query])
  return matches
}

// Inline stroke icons — replace the old Unicode glyphs (✕ ✎ ✏ ♩ ◉ ≡ ▶ ‹ › ▲ ▼ ↩)
const sp = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
const ICONS = {
  close: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  edit: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  ),
  pen: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  note: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <circle cx="8" cy="18" r="4" />
      <path d="M12 18V3l7 4" />
    </svg>
  ),
  metronome: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <path d="M10 3.5h4L17.5 20a0.6 0.6 0 0 1-.6.7H7.1a0.6 0.6 0 0 1-.6-.7L10 3.5z" />
      <path d="M12 14.5 18.5 5" />
    </svg>
  ),
  list: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  prev: (
    <svg width="26" height="26" viewBox="0 0 24 24" {...sp} strokeWidth={2.5}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  next: (
    <svg width="26" height="26" viewBox="0 0 24 24" {...sp} strokeWidth={2.5}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  // |‹  ›| — saltar uma LINHA de letra (as ‹ › dos cantos são para mudar de música)
  lineBack: (
    <svg width="22" height="22" viewBox="0 0 24 24" {...sp} strokeWidth={2.25}>
      <path d="M6 5v14" />
      <path d="M17 6l-6 6 6 6" />
    </svg>
  ),
  lineNext: (
    <svg width="22" height="22" viewBox="0 0 24 24" {...sp} strokeWidth={2.25}>
      <path d="M18 5v14" />
      <path d="M7 6l6 6-6 6" />
    </svg>
  ),
  play: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.5 4.5v15L19.5 12z" />
    </svg>
  ),
  playSmall: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 3.5v17L21 12z" />
    </svg>
  ),
  pause: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4.5" height="14" rx="0.8" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="0.8" />
    </svg>
  ),
  pauseSmall: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="4" width="5" height="16" rx="1" />
      <rect x="14" y="4" width="5" height="16" rx="1" />
    </svg>
  ),
  up: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  ),
  down: (
    <svg width="20" height="20" viewBox="0 0 24 24" {...sp}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  follow: (
    <svg width="18" height="18" viewBox="0 0 24 24" {...sp}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  ),
}

export default function ConcertPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  // String estável: o objeto `user` muda a cada renovação do token (e ao
  // voltar ao primeiro plano) — depender dele parava o relógio a meio
  const userId = user?.id
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const toast = useToast()

  const [songs, setSongs] = useState<Row[]>([])
  // Restore the position in this setlist (kept per concert in sessionStorage,
  // so exiting to fix a lyric mid-show doesn't send us back to song 1)
  const [songIdx, setSongIdx] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem(`concert-pos-${id}`))
      return Number.isInteger(saved) && saved > 0 ? saved : 0
    } catch { return 0 }
  })
  const [lineIdx, setLineIdx] = useState(0)
  const [theme, setTheme] = useState<ConcertTheme>(DEFAULT_CONCERT_THEME)
  const [concertName, setConcertName] = useState<string | null>(null)
  // Linhas sincronizadas vindas da rede, por música (pré-carregadas para todo
  // o alinhamento no arranque; uma resposta atrasada nunca cai noutra música)
  const [syncById, setSyncById] = useState<Record<string, LyricLine[]>>({})
  // Músicas com has_sync cuja sincronização não se conseguiu obter
  const [syncMissing, setSyncMissing] = useState<Record<string, true>>({})
  const [viewMode, setViewMode] = useState<'semi' | 'manual'>('semi')
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  // O timer já arrancou nesta música? Enquanto não, a música está em "cue"
  const [started, setStarted] = useState(false)
  const [scrollFollowing, setScrollFollowing] = useState(true)
  const [contentView, setContentView] = useState<ContentView>('lyrics')
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [annAvailable, setAnnAvailable] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) !== '0' } catch { return true }
  })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editOrder, setEditOrder] = useState(false)
  // Confirmação de sincronização: flash na linha + chip "SINCRONIZADO · 1:24"
  const [flash, setFlash] = useState<{ idx: number; n: number } | null>(null)
  const [chip, setChip] = useState<Chip | null>(null)
  // Sem sync: nenhuma linha acesa até o cantor tocar numa (marcador manual)
  const [tapMarked, setTapMarked] = useState(false)
  // Coluna com a música a tocar: 1.º toque arma, 2.º salta
  const [armedRow, setArmedRow] = useState<string | null>(null)
  // Linhas do alinhamento já tocadas (não "tudo o que está antes da atual")
  const [played, setPlayed] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(`concert-played-${id}`)
      const arr: unknown = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
    } catch { return new Set<string>() }
  })

  // Viewport — escala da letra (≥768) e coluna de alinhamento (≥1024)
  const isTablet = useMediaQuery(TABLET_QUERY)
  const isWide = useMediaQuery(WIDE_QUERY)
  const displayFontSize = isTablet ? Math.round(theme.font_size * 1.45) : theme.font_size
  const displayLineHeight = theme.line_height ?? 1.6

  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef              = useRef<number>(0)
  // Espelhos síncronos do estado — o estado só muda no próximo render, por
  // isso quem precisa do valor AGORA (startTimer logo a seguir a um seek,
  // atalhos de teclado, o setInterval) lê daqui e nunca de uma closure antiga
  const elapsedRef            = useRef(0)
  const startedRef            = useRef(false)
  const activeLineRef         = useRef<HTMLDivElement>(null)
  const lyricsScrollRef       = useRef<HTMLDivElement>(null)
  const lyricsAreaRef         = useRef<HTMLDivElement>(null)
  const topSpacerRef          = useRef<HTMLDivElement>(null)
  const cueSpacerHRef         = useRef<number | null>(null)
  const touchStartRef         = useRef<{ x: number; y: number } | null>(null)
  const touchActiveRef        = useRef(false)
  const touchMovedRef         = useRef(false)
  const tapStartRef           = useRef<{ x: number; y: number; duringScroll: boolean } | null>(null)
  const lastUserScrollRef     = useRef(0)
  const programmaticScrollRef = useRef(false)
  const scrollTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chipTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armRowTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef                = useRef(0)
  const syncLinesRef          = useRef<LyricLine[] | null>(null)
  const currentRowIdRef       = useRef<string | undefined>(undefined)
  const progressTrackRef      = useRef<HTMLDivElement>(null)
  const scrubRef              = useRef<{ x: number; active: boolean; seeked: boolean } | null>(null)
  const setlistListRef        = useRef<HTMLOListElement>(null)
  const keyHandlerRef         = useRef<(e: KeyboardEvent) => void>(() => {})
  // Última modalidade de input: um botão focado por TOQUE nunca rouba o
  // Espaço/Enter do pedal (só um foco dado por Tab ativa o botão)
  const inputModalityRef      = useRef<'pointer' | 'keyboard'>('pointer')
  // Última linha ancorada por nós (toque, ‹ ›) — para a janela de graça de ›
  const anchorRef             = useRef<{ idx: number; at: number } | null>(null)
  // Pedal ← / PageUp mantido = pausa/retoma (desfaz o recuo do 1.º toque)
  const holdRef               = useRef<{ key: string; pre: number; at: number; wasPlaying: boolean; done: boolean } | null>(null)
  // Mudança de música pelo pedal/setas à espera do 2.º toque
  const songArmRef            = useRef<{ target: number; until: number } | null>(null)
  // Posição de cada música ao sair dela (retoma se voltar em < 2 min)
  const posMemoryRef          = useRef(new Map<string, { t: number; playing: boolean; at: number }>())
  // Linha do alinhamento cujo estado (relógio, cue) está carregado agora
  const loadedRowRef          = useRef<{ id: string; since: number } | null>(null)
  // Reordenar: gravações em série, só a ordem mais recente
  const orderSaveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingOrderRef       = useRef<{ setlistId: string; order: Row[] } | null>(null)
  const orderChainRef         = useRef<Promise<void>>(Promise.resolve())
  // Funções do render mais recente (para listeners registados uma só vez)
  const latestRef = useRef<{
    recenter: (behavior: ScrollBehavior) => void
    scrollToActive: (behavior: ScrollBehavior) => void
    flushOrder: () => void
  }>({ recenter: () => {}, scrollToActive: () => {}, flushOrder: () => {} })

  // ── Current song + sync lines (derived early: effects below need them) ──
  const currentRow   = songs[songIdx]
  const currentSong  = currentRow?.song
  const currentRowId = currentRow?.id
  currentRowIdRef.current = currentRowId
  // Cache local primeiro (instantâneo e offline); a rede substitui quando chega
  const cachedSync = useMemo(() => {
    if (!currentSong?.has_sync) return null
    const c = getCachedSyncLines<LyricLine[]>(currentSong.id)
    return Array.isArray(c) && c.length > 0 ? c : null
  }, [currentSong?.id, currentSong?.has_sync])
  const syncLines: LyricLine[] | null =
    (currentSong?.has_sync ? syncById[currentSong.id] : undefined) ?? cachedSync
  // Lido pelo setInterval e pelos atalhos — sempre a versão deste render
  syncLinesRef.current = syncLines

  // ── Persist position per setlist ──────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    try { sessionStorage.setItem(`concert-pos-${id}`, String(songIdx)) } catch {}
  }, [id, songIdx])

  useEffect(() => {
    if (!id) return
    try { sessionStorage.setItem(`concert-played-${id}`, JSON.stringify(Array.from(played))) } catch {}
  }, [id, played])

  // Bounds-check a restored index once the songs arrive
  useEffect(() => {
    if (songs.length > 0 && songIdx >= songs.length) setSongIdx(songs.length - 1)
  }, [songs.length, songIdx])

  // ── Sidebar / sheet state ────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0') } catch {}
  }, [sidebarOpen])

  // Rodar o iPad muda coluna ↔ folha: fecha a folha e sai da edição
  useEffect(() => {
    setSheetOpen(false)
    finishEditOrder()
    setArmedRow(null)
  }, [isWide])

  // ── Input modality (toque vs teclado) ────────────────────────────────────
  useEffect(() => {
    const onPointer = () => { inputModalityRef.current = 'pointer' }
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key === 'Tab') inputModalityRef.current = 'keyboard'
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKeyCapture, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKeyCapture, true)
    }
  }, [])

  // ── Load (with offline cache fallback) ──────────────────────────────────
  useEffect(() => {
    if (!id || !userId) return
    let wakeLock: any = null
    const acquireWakeLock = () => {
      navigator.wakeLock?.request('screen').then(wl => { wakeLock = wl }).catch(() => {})
    }
    acquireWakeLock()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    supabase.from('setlist_songs').select('*, song:songs(*)').eq('setlist_id', id).order('position')
      .then(({ data, error }) => {
        if (data && data.length > 0 && !error) {
          setSongs(data as any)
          cacheSetlistSongs(id, data)
          preloadSyncs(data as Row[])
        } else {
          const cached = getCachedSetlistSongs<Row>(id)
          if (cached) setSongs(cached)
          else if (data) setSongs(data as any)
        }
      })
      .then(undefined, () => {
        const cached = getCachedSetlistSongs<Row>(id)
        if (cached) setSongs(cached)
      })
    // Concert name for the header subtitle (cached meta as offline fallback —
    // written by the setlist page, so don't overwrite it with a partial row)
    const cachedName = () => {
      const meta = getCachedSetlistMeta<{ name?: string }>(id)
      if (meta?.name) setConcertName(meta.name)
    }
    supabase.from('setlists').select('name').eq('id', id).single()
      .then(({ data }) => {
        if (data?.name) setConcertName(data.name)
        else cachedName()
      }, cachedName)
    supabase.from('profiles').select('concert_theme').eq('id', userId).single()
      .then(({ data }) => {
        if (data?.concert_theme) {
          setTheme(normalizeConcertTheme(data.concert_theme as Partial<ConcertTheme>))
          cacheTheme(data.concert_theme)
        } else {
          const cached = getCachedTheme<Partial<ConcertTheme>>()
          if (cached) setTheme(normalizeConcertTheme(cached))
        }
      })
    // Sem stopTimer() aqui: esta limpeza não é só de desmontagem
    return () => { wakeLock?.release(); document.removeEventListener('visibilitychange', onVisibilityChange) }
  }, [id, userId])

  /**
   * Sincronizações de TODO o alinhamento de uma vez (e para a cache offline):
   * nenhuma música troca de letra simples para sincronizada a meio.
   */
  function preloadSyncs(rows: Row[]) {
    const ids = Array.from(new Set(rows.filter(r => r.song?.has_sync).map(r => r.song.id)))
    if (ids.length === 0) return
    supabase.from('lyric_syncs').select('song_id, lines').in('song_id', ids)
      .then(({ data, error }) => {
        if (error || !data) return
        const got: Record<string, LyricLine[]> = {}
        for (const r of data as { song_id: string; lines: unknown }[]) {
          if (Array.isArray(r.lines) && r.lines.length > 0) {
            got[r.song_id] = r.lines as LyricLine[]
            cacheSyncLines(r.song_id, r.lines)
          }
        }
        setSyncById(m => ({ ...m, ...got }))
        const missing = ids.filter(sid => !got[sid])
        if (missing.length > 0) {
          setSyncMissing(m => {
            const next = { ...m }
            for (const sid of missing) next[sid] = true
            return next
          })
        }
      }, () => {})
  }

  // Pending timers die with the page (the running clock too — only here,
  // never in an effect that can re-run mid-show)
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    if (chipTimerRef.current) clearTimeout(chipTimerRef.current)
    if (armRowTimerRef.current) clearTimeout(armRowTimerRef.current)
    // Uma ordem nova à espera do debounce ainda é gravada
    latestRef.current.flushOrder()
  }, [])

  // ── Song change ─────────────────────────────────────────────────────────
  // Keyed on the setlist row id (not on `songs`): reordering the alinhamento
  // mid-song must not rewind or stop the song that is playing.
  // Layout effect: the reset lands before paint — never a frame of the new
  // lyrics with the previous song's clock (dimmed lines, 40vh spacer).
  useLayoutEffect(() => {
    const row = songs[songIdx]
    if (!row?.song) return
    const now = Date.now()

    // Sair da música anterior: guarda onde estava (um salto acidental — toque
    // na coluna, swipe, ↑/↓ — recupera-se voltando a ela)
    const prev = loadedRowRef.current
    if (prev && prev.id !== row.id) {
      if (startedRef.current) {
        posMemoryRef.current.set(prev.id, { t: currentTime(), playing: !!timerRef.current, at: now })
      }
      if (startedRef.current || now - prev.since >= PLAYED_MIN_MS) markPlayed(prev.id)
    }
    loadedRowRef.current = { id: row.id, since: now }

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    cueSpacerHRef.current = null
    anchorRef.current = null
    holdRef.current = null
    songArmRef.current = null
    setArmedRow(null)
    setFlash(null)
    setChip(null)
    setEditOrder(false)
    setTapMarked(false)
    setScrollFollowing(true)
    setContentView('lyrics')

    // Voltou há pouco? Retoma (a tocar: onde a música vai agora)
    const mem = posMemoryRef.current.get(row.id)
    posMemoryRef.current.delete(row.id)
    const sl = syncLinesRef.current
    let resumeAt: number | null = null
    if (mem && now - mem.at < RESUME_WINDOW_MS) {
      const t = mem.playing ? mem.t + (now - mem.at) / 1000 : mem.t
      const end = Math.max(
        row.song.duration_sec ?? 0,
        sl && sl.length > 0 ? sl[sl.length - 1].time_ms / 1000 + 5 : 0,
      )
      // Uma música que entretanto já teria acabado volta ao cue
      if (!(mem.playing && end > 0 && t >= end)) resumeAt = t
    }

    if (mem && resumeAt != null) {
      elapsedRef.current = resumeAt
      setElapsed(resumeAt)
      setLineIdx(sl ? Math.max(0, syncIndexAt(sl, resumeAt * 1000)) : 0)
      startedRef.current = true
      setStarted(true)
      if (mem.playing) runClock(resumeAt)
      else setPlaying(false)
      showChip(mem.playing
        ? { label: 'Retomado', value: fmtTime(resumeAt), live: true, ms: 2000 }
        : { label: 'Retomado', value: fmtTime(resumeAt), suffix: 'Em pausa', live: false, ms: 2000 })
      // Depois do re-render síncrono (antes de pintar): centra a linha ativa
      requestAnimationFrame(() => latestRef.current.scrollToActive('auto'))
    } else {
      // Cue: parado em 0, à espera da entrada
      elapsedRef.current = 0
      setElapsed(0)
      setLineIdx(0)
      setPlaying(false)
      startedRef.current = false
      setStarted(false)
      if (lyricsScrollRef.current) {
        markProgrammatic()
        lyricsScrollRef.current.scrollTop = 0
      }
    }
  }, [currentRowId])

  // Song data: annotations + this song's sync (the preload may not have it)
  useEffect(() => {
    const song = songs[songIdx]?.song
    if (!song) return
    // Annotation availability: local first, remote as fallback
    const local = loadAnnotations(song.id)
    if (local && local.strokes.length > 0) setAnnAvailable(true)
    else {
      setAnnAvailable(false)
      if (userId) pullAnnotations(song.id, userId).then(r => {
        if (r && r.strokes.length > 0) setAnnAvailable(true)
      })
    }
    if (!song.has_sync || syncById[song.id]) return
    const songId = song.id
    const markMissing = () => setSyncMissing(m => (m[songId] ? m : { ...m, [songId]: true }))
    supabase.from('lyric_syncs').select('lines').eq('song_id', songId).single()
      .then(({ data }) => {
        const lines = (data?.lines as LyricLine[] | undefined) ?? null
        if (Array.isArray(lines) && lines.length > 0) {
          // Guardado por música: uma resposta atrasada nunca aparece noutra
          setSyncById(m => ({ ...m, [songId]: lines }))
          cacheSyncLines(songId, lines)
        } else markMissing() // fica a cache (cachedSync), se existir
      }, markMissing)
  }, [currentRowId])

  // A sincronização chegou (ou mudou) com o relógio já a meio: a linha ativa
  // passa a vir dela, não do 0 com que a música abriu
  useEffect(() => {
    if (!syncLines || !startedRef.current) return
    setLineIdx(Math.max(0, syncIndexAt(syncLines, currentTime() * 1000)))
  }, [syncLines])

  function markPlayed(rowId: string) {
    setPlayed(s => (s.has(rowId) ? s : new Set(s).add(rowId)))
  }

  // ── Timer ────────────────────────────────────────────────────────────────
  // Everything the interval touches is a ref or a state setter, so the
  // callback can never read a stale render.
  function tick() {
    const secs = (Date.now() - startRef.current) / 1000
    elapsedRef.current = secs
    setElapsed(secs)
    const sl = syncLinesRef.current
    if (sl) setLineIdx(Math.max(0, syncIndexAt(sl, secs * 1000)))
  }

  /** Posição real agora (com o timer a correr, mais fresca que o último tick) */
  function currentTime() {
    return timerRef.current ? (Date.now() - startRef.current) / 1000 : elapsedRef.current
  }

  /** Relógio a correr a partir de `t` segundos (sem mexer no cue) */
  function runClock(t: number) {
    if (timerRef.current) clearInterval(timerRef.current)
    startRef.current = Date.now() - t * 1000
    elapsedRef.current = t
    timerRef.current = setInterval(tick, 80)
    setPlaying(true)
  }

  /** Sai do cue (a dica some, o espaçador cresce sem salto — ver [started]) */
  function leaveCue() {
    if (startedRef.current) return
    // O espaçador compacto vai crescer para 40vh — guarda a altura atual
    // para o scroll ser compensado sem salto (useLayoutEffect)
    if (cueSpacerHRef.current == null) {
      cueSpacerHRef.current = topSpacerRef.current?.offsetHeight ?? null
    }
    startedRef.current = true
    setStarted(true)
  }

  /** Arranca a partir de `from` segundos (por omissão, da posição atual) */
  function startTimer(from?: number) {
    const t = from ?? currentTime()
    leaveCue()
    runClock(t)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
      const secs = (Date.now() - startRef.current) / 1000
      elapsedRef.current = secs
      setElapsed(secs)
      const sl = syncLinesRef.current
      if (sl) setLineIdx(Math.max(0, syncIndexAt(sl, secs * 1000)))
    }
    setPlaying(false)
  }

  function togglePlay() {
    if (timerRef.current) stopTimer()
    else startTimer()
  }

  /** De volta ao cue: parado em 0, dica visível, próxima entrada = toque/pedal */
  function backToCue() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setPlaying(false)
    elapsedRef.current = 0
    setElapsed(0)
    setLineIdx(0)
    cueSpacerHRef.current = null
    startedRef.current = false
    setStarted(false)
    anchorRef.current = null
    holdRef.current = null
    setFlash(null)
    setChip(null)
    setScrollFollowing(true)
    const sc = lyricsScrollRef.current
    if (sc) {
      markProgrammatic()
      requestAnimationFrame(() => { markProgrammatic(); sc.scrollTop = 0 })
    }
  }

  // ── Seek ─────────────────────────────────────────────────────────────────
  /**
   * Move o relógio para `time` (s) sem mexer no play/pausa; devolve o tempo
   * final. Sem limite superior: a duração da ficha é aproximada e a sync
   * pode ir além dela (só o scrub da barra fica dentro da duração).
   */
  function seekTo(time: number) {
    const t = Math.max(0, time)
    elapsedRef.current = t
    setElapsed(t)
    startRef.current = Date.now() - t * 1000
    const sl = syncLinesRef.current
    if (sl) setLineIdx(Math.max(0, syncIndexAt(sl, t * 1000)))
    return t
  }

  /**
   * "Estamos aqui": põe o relógio no início da entrada `i` dos syncLines.
   * `start` arranca o timer se estiver parado (toque na letra); os ajustes
   * ‹ LINHA › não mexem no play/pausa.
   */
  function syncToLine(i: number, start: boolean) {
    const entry = syncLinesRef.current?.[i]
    if (!entry) return
    // +1ms: o índice calculado a partir do tempo cai nesta linha (arredondamentos)
    const t = seekTo((entry.time_ms + 1) / 1000)
    setLineIdx(i)
    // O tempo vai explícito — nunca o `elapsed` do render anterior
    if (start && !timerRef.current) startTimer(t)
    else leaveCue()
    anchorRef.current = { idx: i, at: Date.now() }
    setScrollFollowing(true)
    flashLine(i)
    showPositionChip(t)
  }

  /**
   * ‹ LINHA / LINHA › — início da linha de letra anterior/seguinte.
   * `fromKey`: pedal/teclado (nos extremos arma a mudança de música; no ecrã
   * as teclas ficam apagadas e as ‹ › de música estão ao lado).
   */
  function stepLine(dir: 1 | -1, fromKey = false) {
    const sl = syncLinesRef.current
    if (!sl) return
    const nowMs = currentTime() * 1000
    const cur = syncIndexAt(sl, nowMs)
    const first = findLyric(sl, -1, 1)

    if (dir > 0) {
      // Cue: o 1.º avanço é a ENTRADA — igual a tocar na 1.ª linha (seek +
      // arranca), seja a tecla do ecrã seja o pedal
      if (!startedRef.current && !timerRef.current && first >= 0 && cur <= first) {
        syncToLine(first, true)
        return
      }
      // Janela de graça: o relógio acabou de acender esta linha e o cantor
      // carregou › ao entrar nela → confirma-a (re-ancora os ms) em vez de
      // fugir uma linha à frente. Não se aplica a uma linha que acabámos de
      // ancorar nós (›› rápidos continuam a avançar).
      const a = anchorRef.current
      const justAnchored = !!a && a.idx === cur && Date.now() - a.at < 1500
      if (timerRef.current && cur >= 0 && isLyricText(sl[cur].text) &&
          nowMs - sl[cur].time_ms < LINE_GRACE_MS && !justAnchored) {
        syncToLine(cur, false)
        return
      }
      const j = findLyric(sl, cur, 1)
      if (j >= 0) syncToLine(j, false)
      else if (fromKey) armOrGo(songIdx + 1, 'Pedal de novo')
      return
    }

    const j = findLyric(sl, cur, -1)
    if (j >= 0) { syncToLine(j, false); return }
    // Na 1.ª linha (ou na intro): volta a esperar a entrada
    if (startedRef.current || timerRef.current) backToCue()
    else if (fromKey) armOrGo(songIdx - 1, 'Pedal de novo')
  }

  /** Pedal ← / PageUp mantido (auto-repeat): pausa ou retoma, uma vez por pressão */
  function holdBack(k: string) {
    const h = holdRef.current
    if (!h || h.key !== k || h.done) return
    h.done = true
    if (!startedRef.current || !syncLinesRef.current) return
    // O 1.º keydown já recuou uma linha — segurar não era "recuar"
    if (h.wasPlaying) {
      const t = seekTo(h.pre + (Date.now() - h.at) / 1000)
      stopTimer()
      showChip({ label: 'Em pausa', value: fmtTime(t), live: false, ms: 1400 })
    } else {
      const t = seekTo(h.pre)
      startTimer(t)
      showChip({ label: 'Retomado', value: fmtTime(t), live: true, ms: 1400 })
    }
    setFlash(null)
    setScrollFollowing(true)
  }

  /**
   * Mudar de música pelo pedal/setas: o 1.º toque só avisa (chip), o 2.º
   * dentro de 2 s muda. Um pedal a mais nunca atira para outra música.
   */
  function armOrGo(target: number, label: string) {
    if (target < 0 || target >= songs.length) return
    const a = songArmRef.current
    if (a && a.target === target && Date.now() < a.until) {
      songArmRef.current = null
      setSongIdx(target)
      return
    }
    songArmRef.current = { target, until: Date.now() + ARM_MS }
    const title = songs[target]?.song?.title
    showChip({
      label,
      value: `${target > songIdx ? '→' : '←'} ${pad2(target + 1)}${title ? ` · ${title}` : ''}`,
      live: true,
      ms: ARM_MS,
    })
  }

  function flashLine(i: number) {
    setFlash({ idx: i, n: ++seqRef.current })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(null), 750)
  }

  function showChip(c: Omit<Chip, 'n'>) {
    setChip({ ...c, n: ++seqRef.current })
    if (chipTimerRef.current) clearTimeout(chipTimerRef.current)
    chipTimerRef.current = setTimeout(() => setChip(null), c.ms)
  }

  /** "SINCRONIZADO · 1:24" a tocar; "POSIÇÃO · 1:24 · EM PAUSA" parado */
  function showPositionChip(t: number) {
    showChip(timerRef.current
      ? { label: 'Sincronizado', value: fmtTime(t), live: true, ms: 1400 }
      : { label: 'Posição', value: fmtTime(t), suffix: 'Em pausa', live: false, ms: 1400 })
  }

  // ── Scroll following ─────────────────────────────────────────────────────
  function markProgrammatic() {
    programmaticScrollRef.current = true
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    // Long smooth scrolls (compensation + centre) can run close to 1s
    scrollTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false }, 1000)
  }

  /**
   * Scroll only the lyrics container (scrollIntoView could also move the
   * page/body). 'center' = teleponto; 'nearest' = só se estiver fora de vista.
   */
  function scrollLineIntoView(el: HTMLElement, behavior: ScrollBehavior, mode: 'center' | 'nearest') {
    const sc = lyricsScrollRef.current
    if (!sc) return
    const scR = sc.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    let top: number
    if (mode === 'center') {
      top = sc.scrollTop + (r.top - scR.top) - (sc.clientHeight - r.height) / 2
    } else {
      const margin = 24
      if (r.top < scR.top + margin) top = sc.scrollTop + (r.top - scR.top) - margin
      else if (r.bottom > scR.bottom - margin) top = sc.scrollTop + (r.bottom - scR.bottom) + margin
      else return
    }
    markProgrammatic()
    sc.scrollTo({ top: Math.max(0, top), behavior })
  }

  /** Leva a linha ativa à vista (sem olhar para o seguimento automático) */
  function scrollToActive(behavior: ScrollBehavior) {
    if (viewMode !== 'semi' || contentView !== 'lyrics') return
    // Sem sync não há nada a seguir: a página fica onde o cantor a deixou
    // (o toque numa linha centra-a diretamente)
    if (!syncLines) return
    const el = activeLineRef.current
    if (!el) return
    // Em cue a letra fica encostada ao topo — só se garante que se vê
    scrollLineIntoView(el, behavior, !started ? 'nearest' : 'center')
  }

  function recenterActiveLine(behavior: ScrollBehavior = 'smooth') {
    if (!scrollFollowing) return
    scrollToActive(behavior)
  }

  useEffect(() => {
    recenterActiveLine()
  }, [lineIdx, viewMode, scrollFollowing])

  // Fim do cue: o espaçador de topo cresce (compacto → 40vh). Compensa o
  // scroll ANTES de pintar (a letra não salta) e depois desliza suavemente
  // até centrar a linha ativa.
  useLayoutEffect(() => {
    const prev = cueSpacerHRef.current
    cueSpacerHRef.current = null
    if (!started || prev == null) return
    const spacer = topSpacerRef.current
    const sc = lyricsScrollRef.current
    if (spacer && sc) {
      const delta = spacer.offsetHeight - prev
      if (delta !== 0) {
        markProgrammatic()
        sc.scrollTop += delta
      }
    }
    recenterActiveLine('smooth')
  }, [started])

  // Switching views (lyrics/chords/annotations) → restore scroll-follow and
  // snap the lyrics view back to the active line
  useEffect(() => {
    setScrollFollowing(true)
    if (contentView !== 'lyrics') return
    requestAnimationFrame(() => latestRef.current.scrollToActive('auto'))
  }, [contentView])

  // Re-center when the tablet rotates / viewport resizes. The reflow/clamp
  // scroll events iOS fires are ours, not the singer's → marked programmatic
  // BEFORE they arrive, so following never switches off by itself.
  useEffect(() => {
    function onResize() {
      markProgrammatic()
      // iOS reflows the layout after the rotation animation — re-center a
      // couple of times so it lands centred whenever the reflow settles.
      requestAnimationFrame(() => latestRef.current.recenter('auto'))
      setTimeout(() => { markProgrammatic(); latestRef.current.recenter('auto') }, 350)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // A largura da letra muda sem resize da janela (≡ recolhe/expande a
  // coluna): as frases re-partem-se e a linha ativa sairia de vista
  useEffect(() => {
    const el = lyricsAreaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastW = el.clientWidth
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w === lastW) return
      lastW = w
      markProgrammatic()
      requestAnimationFrame(() => latestRef.current.recenter('auto'))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Keyboard / pedal Bluetooth ───────────────────────────────────────────
  // Page-turn pedals send PageDown/PageUp or arrows; some send Space/Enter.
  // One window listener for the page's lifetime that always calls the
  // handler from the LATEST render → no stale songIdx/playing/elapsed.
  function handleKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // A modal dialog (exit confirmation) owns the keyboard
    if (document.querySelector('[aria-modal="true"]')) return
    const target = e.target as HTMLElement | null
    if (target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' || target.isContentEditable
    )) return

    const k = e.key
    if (k === 'Escape') {
      if (sheetOpen) closeSheet()
      else if (editOrder) finishEditOrder()
      else exitConcert()
      return
    }

    const activate = k === ' ' || k === 'Spacebar' || k === 'Enter'
    const back = k === 'ArrowLeft' || k === 'PageUp'
    const fwd = k === 'ArrowRight' || k === 'PageDown'
    const vertical = k === 'ArrowUp' || k === 'ArrowDown'
    if (!activate && !back && !fwd && !vertical) return

    // Espaço/Enter num botão focado por TECLADO (Tab) ativa esse botão. Com o
    // foco deixado por um toque (Chrome foca botões ao toque) é o pedal que
    // manda: tira-se o foco para o browser não "carregar" no botão
    if (activate && target && target !== document.body) {
      const ctl = target.closest<HTMLElement>('button, a[href], [role="button"], [role="slider"]')
      if (ctl) {
        if (inputModalityRef.current === 'keyboard') return
        ctl.blur()
      }
    }
    e.preventDefault() // PageUp/PageDown/espaço nunca fazem scroll por baixo

    // Pedal mantido (auto-repeat do iPadOS): nunca dispara linhas/músicas em
    // série. Só ← / PageUp mantido tem significado: pausa/retoma.
    if (e.repeat) {
      if (back && viewMode === 'semi' && contentView !== 'chords') holdBack(k)
      return
    }
    holdRef.current = null

    if (vertical) {
      const to = k === 'ArrowUp' ? songIdx - 1 : songIdx + 1
      if (to < 0 || to >= songs.length) return
      // A tocar, ↑/↓ (pedais em modo setas) pedem confirmação
      if (timerRef.current) armOrGo(to, k === 'ArrowUp' ? '↑ de novo' : '↓ de novo')
      else setSongIdx(to)
      return
    }

    const dir: 1 | -1 = back ? -1 : 1
    // Acordes: não há transporte à vista — o pedal vira a página (espaço
    // incluído), nunca mexe num relógio escondido
    if (contentView === 'chords') { pageTurn(dir); return }

    if (viewMode === 'semi' && syncLinesRef.current) {
      if (activate) { togglePlay(); return }
      holdRef.current = back && startedRef.current
        ? { key: k, pre: currentTime(), at: Date.now(), wasPlaying: !!timerRef.current, done: false }
        : null
      stepLine(dir, true)
      return
    }
    // Manual (e semi sem sync): virar página
    pageTurn(dir)
  }
  useLayoutEffect(() => {
    keyHandlerRef.current = handleKey
    latestRef.current = { recenter: recenterActiveLine, scrollToActive, flushOrder }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * Virar página no conteúdo visível (~70% do ecrã). Nos extremos, o pedal
   * arma a música seguinte/anterior (2.º toque muda) — como numa estante.
   */
  function pageTurn(dir: 1 | -1) {
    const sc = lyricsScrollRef.current
    if (!sc) return
    const max = sc.scrollHeight - sc.clientHeight
    if (dir > 0 && sc.scrollTop >= max - 4) { armOrGo(songIdx + 1, 'Pedal de novo'); return }
    if (dir < 0 && sc.scrollTop <= 4) { armOrGo(songIdx - 1, 'Pedal de novo'); return }
    // Scroll nosso: não desliga o seguimento nem faz aparecer "Seguir letra"
    markProgrammatic()
    sc.scrollBy({ top: dir * Math.round(sc.clientHeight * 0.7), behavior: 'smooth' })
  }

  // ── Scrubbing on the progress bar ────────────────────────────────────────
  // Um toque solto na barra (a mão a procurar o deck) não faz nada: o seek só
  // começa ao arrastar (>8px) ou quando o dedo pega no fader
  function scrubToClientX(clientX: number) {
    const track = progressTrackRef.current
    if (!track || duration <= 0) return
    const rect = track.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    leaveCue()
    seekTo(frac * duration)
  }
  function handleScrubStart(e: React.PointerEvent<HTMLDivElement>) {
    const track = progressTrackRef.current
    if (!track || duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = track.getBoundingClientRect()
    const faderX = rect.left + rect.width * (progressPct / 100)
    scrubRef.current = { x: e.clientX, active: Math.abs(e.clientX - faderX) <= 24, seeked: false }
  }
  function handleScrubMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = scrubRef.current
    if (!s) return
    if (!s.active) {
      if (Math.abs(e.clientX - s.x) <= 8) return
      s.active = true
    }
    if (!s.seeked) {
      s.seeked = true
      anchorRef.current = null
      setScrollFollowing(true)
    }
    scrubToClientX(e.clientX)
  }
  function handleScrubEnd() {
    const s = scrubRef.current
    scrubRef.current = null
    if (s?.seeked) showPositionChip(currentTime())
  }

  // ── Exit (with confirmation — a stray tap must never end the show) ──────
  async function exitConcert() {
    const ok = await confirmDialog({
      title: 'Sair do concerto',
      message: 'Queres sair do modo concerto? A posição na setlist fica guardada.',
      confirmLabel: 'Sair',
      cancelLabel: 'Continuar',
    })
    if (ok) navigate(`/setlist/${id}`)
  }

  // ── Swipe (horizontal = change song) + tap guard ────────────────────────
  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
    touchActiveRef.current = true
    touchMovedRef.current = false
  }
  function handleTouchMove(e: React.TouchEvent) {
    const s = touchStartRef.current
    if (!s || touchMovedRef.current) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - s.x) > 8 || Math.abs(t.clientY - s.y) > 8) touchMovedRef.current = true
  }
  function handleTouchEnd(e: React.TouchEvent) {
    touchActiveRef.current = false
    if (!touchStartRef.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStartRef.current.x
    const dy = t.clientY - touchStartRef.current.y
    const absDx = Math.abs(dx), absDy = Math.abs(dy)
    const total = absDx + absDy
    if (total > 60 && absDx / total >= 0.75) {
      if (dx < 0 && songIdx < songs.length - 1) setSongIdx(s => s + 1)
      else if (dx > 0 && songIdx > 0) setSongIdx(s => s - 1)
    }
    touchStartRef.current = null
  }
  function handleTouchCancel() {
    touchActiveRef.current = false
    touchStartRef.current = null
  }

  function handleLyricsPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== 'touch') touchMovedRef.current = false
    tapStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      // A finger landing on a list that is still gliding only stops it
      duringScroll: performance.now() - lastUserScrollRef.current < 150,
    }
  }

  /** Um toque verdadeiro — nunca o fim de um scroll, de um swipe ou de um travão de inércia */
  function isRealTap(e: React.MouseEvent) {
    if (touchMovedRef.current) return false
    const g = tapStartRef.current
    if (!g) return true
    if (g.duringScroll) return false
    return Math.abs(e.clientX - g.x) <= 10 && Math.abs(e.clientY - g.y) <= 10
  }

  function handleScroll() {
    // Programmatic scrolls (follow, compensation) are ignored — unless a
    // finger is actually dragging the list right now
    if (programmaticScrollRef.current && !(touchActiveRef.current && touchMovedRef.current)) return
    lastUserScrollRef.current = performance.now()
    setScrollFollowing(false)
  }

  /** Toque numa linha (modo semi) */
  function tapLine(i: number, e: React.MouseEvent<HTMLElement>) {
    if (!isRealTap(e)) return
    if (syncLinesRef.current?.[i]) {
      // "Estamos aqui": seek + arranca se estiver parado
      syncToLine(i, true)
      return
    }
    // Sem sync: marcador manual — acende e centra a linha tocada
    setLineIdx(i)
    setTapMarked(true)
    setScrollFollowing(true)
    scrollLineIntoView(e.currentTarget, 'smooth', 'center')
  }

  // ── Alinhamento (coluna ≥1024 / folha <1024) ────────────────────────────
  function toggleSetlist() {
    finishEditOrder()
    setArmedRow(null)
    if (isWide) setSidebarOpen(o => !o)
    else setSheetOpen(o => !o)
  }
  function closeSheet() {
    setSheetOpen(false)
    finishEditOrder()
  }
  function jumpToSong(i: number, fromSheet: boolean) {
    setArmedRow(null)
    setSongIdx(i)
    if (fromSheet) closeSheet()
  }
  /**
   * Toque numa linha do alinhamento. Na coluna fixa, com a música a tocar,
   * o 1.º toque só arma (uma mão a roçar a coluna não muda de música); a
   * folha abre-se de propósito, por isso lá salta logo.
   */
  function tapSetlistRow(i: number, rowId: string, inSheet: boolean) {
    if (!inSheet && timerRef.current && i !== songIdx && armedRow !== rowId) {
      setArmedRow(rowId)
      if (armRowTimerRef.current) clearTimeout(armRowTimerRef.current)
      armRowTimerRef.current = setTimeout(() => setArmedRow(null), ARM_ROW_MS)
      return
    }
    jumpToSong(i, inSheet)
  }

  // ── Reorder inside concert (Editar ordem ▲▼) ────────────────────────────
  function moveSong(from: number, to: number) {
    if (to < 0 || to >= songs.length) return
    const next = [...songs]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    // Keep pointing at the same song
    let newIdx = songIdx
    if (songIdx === from) newIdx = to
    else if (from < songIdx && to >= songIdx) newIdx = songIdx - 1
    else if (from > songIdx && to <= songIdx) newIdx = songIdx + 1
    setSongs(next)
    setSongIdx(newIdx)
    if (!id) return
    cacheSetlistSongs(id, next)
    // ▲▼ rápidos: grava só a ordem mais recente, depois de uma pausa
    pendingOrderRef.current = { setlistId: id, order: next }
    if (orderSaveTimerRef.current) clearTimeout(orderSaveTimerRef.current)
    orderSaveTimerRef.current = setTimeout(flushOrder, 400)
  }

  /** Grava já a ordem pendente — em série, nunca duas gravações em paralelo */
  function flushOrder() {
    if (orderSaveTimerRef.current) {
      clearTimeout(orderSaveTimerRef.current)
      orderSaveTimerRef.current = null
    }
    const pending = pendingOrderRef.current
    pendingOrderRef.current = null
    if (!pending) return
    orderChainRef.current = orderChainRef.current
      .then(() => persistOrder(pending.setlistId, pending.order))
      .catch(() => {})
  }

  async function persistOrder(setlistId: string, order: Row[]) {
    // Two batched upserts — the unique(setlist_id, position) constraint
    // forces the two phases (park at 10000+, then land at final).
    // setlist_id/song_id incluídos porque o tuplo do INSERT é validado
    // (NOT NULL) antes de o conflito virar UPDATE.
    const rows = (offset: number) => order.map((ss, i) => ({
      id: ss.id, setlist_id: ss.setlist_id, song_id: ss.song_id, position: offset + i,
    }))
    let failed: boolean
    try {
      let { error } = await supabase.from('setlist_songs').upsert(rows(10000), { onConflict: 'id' })
      if (!error) ({ error } = await supabase.from('setlist_songs').upsert(rows(0), { onConflict: 'id' }))
      failed = !!error
    } catch { failed = true }
    if (!failed) return
    // Já há uma ordem mais recente na fila — essa grava por cima
    if (pendingOrderRef.current) return
    toast('Não foi possível guardar a nova ordem', { type: 'error' })
    // Nada de reverter para um instantâneo antigo: a verdade é a do servidor
    try {
      const { data, error } = await supabase
        .from('setlist_songs').select('*, song:songs(*)').eq('setlist_id', setlistId).order('position')
      if (error || !data || data.length === 0 || pendingOrderRef.current) return
      const fresh = data as Row[]
      setSongs(fresh)
      const idx = fresh.findIndex(r => r.id === currentRowIdRef.current)
      if (idx >= 0) setSongIdx(idx)
      cacheSetlistSongs(setlistId, fresh)
    } catch {
      // Sem rede: fica a ordem local (e a da cache) até haver ligação
    }
  }

  function finishEditOrder() {
    flushOrder()
    setEditOrder(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const plainLines  = (currentSong?.edited_lyrics ?? currentSong?.lyrics ?? '').split('\n')
  const lines       = syncLines ? syncLines.map(l => l.text) : plainLines
  const prevSong    = songs[songIdx - 1]?.song
  const nextSong    = songs[songIdx + 1]?.song
  const afterSong   = songs[songIdx + 2]?.song
  const displayKey  = currentRow?.performance_key ?? currentSong?.performance_key ?? currentSong?.original_key

  // Chords (transposed to the display key when both keys are known)
  const rawChords = currentSong?.chords ?? ''
  const chordsText = (rawChords && displayKey && currentSong?.original_key && displayKey !== currentSong.original_key)
    ? transposeChordsText(rawChords, currentSong.original_key, displayKey)
    : rawChords
  const chordsTransposed = chordsText !== rawChords

  const hasAnnotations = annAvailable
  const bpm = currentSong?.bpm ?? null

  // Progress bar: song duration, falling back to the last synced line
  const songDur = currentSong?.duration_sec ?? 0
  const duration = songDur > 0
    ? songDur
    : (syncLines && syncLines.length > 0 ? syncLines[syncLines.length - 1].time_ms / 1000 + 5 : 0)
  const progressPct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0

  // Playback UI only makes sense with sync + semi mode (chords view hides it)
  const playbackContext = contentView !== 'chords' && viewMode === 'semi'
  const showProgress = playbackContext && !!syncLines && duration > 0
  const hasTransport = playbackContext && !!syncLines

  // Visor do transporte quando não há play: diz em que estado o palco está
  // (e nunca "sem sincronização" numa música que a tem e ainda está a chegar)
  const deckStatus = playbackContext
    ? (currentSong?.has_sync
        ? (syncMissing[currentSong.id] ? 'Sync indisponível' : 'Sync a carregar')
        : 'Sem sincronização')
    : contentView === 'chords' ? 'Acordes' : 'Modo manual'

  // Sync position → cue, ‹ LINHA ›, active line
  const elapsedMs     = elapsed * 1000
  const curSyncIdx    = syncLines ? syncIndexAt(syncLines, elapsedMs) : -1
  const prevLyricIdx  = syncLines ? findLyric(syncLines, curSyncIdx, -1) : -1
  const nextLyricIdx  = syncLines ? findLyric(syncLines, curSyncIdx, 1) : -1
  const firstLyricIdx = syncLines ? findLyric(syncLines, -1, 1) : -1
  const semiSync      = viewMode === 'semi' && !!syncLines
  // Cue: música ainda não arrancou — dica + letra encostada ao topo
  const inCue = semiSync && contentView === 'lyrics' && !started && lines.length > 0
  // Intro a tocar, antes da 1.ª linha de letra
  const preRoll = semiSync && started && firstLyricIdx >= 0 && elapsedMs < syncLines![firstLyricIdx].time_ms
  // Em cue/intro: nada aceso, a 1.ª linha de letra pulsa (mesmo com sync a 0 ms)
  const cueLineIdx = (inCue || preRoll) ? firstLyricIdx : -1
  // Linha que o scroll segue (em cue/intro, a 1.ª linha que vai entrar)
  const anchorIdx = cueLineIdx >= 0 ? cueLineIdx : lineIdx
  // Parado a meio da música: tem de se ver (sem olhar para o footer)
  const pausedMidSong = semiSync && contentView !== 'chords' && started && !playing
  // ‹ LINHA na 1.ª linha = voltar a esperar a entrada
  const lineBackToCue = started && prevLyricIdx < 0

  // Map the active sync line onto the plain-lyrics line shown in the
  // annotations view (occurrence-aware so repeated chorus lines resolve
  // to the right verse).
  let annActiveLine = -1
  if (contentView === 'annotations' && viewMode === 'semi' && syncLines && started) {
    const target = syncLines[lineIdx]?.text.trim()
    if (target) {
      let occ = 0
      for (let i = 0; i < lineIdx; i++) {
        if (syncLines[i].text.trim() === target) occ++
      }
      let seen = 0
      for (let i = 0; i < plainLines.length; i++) {
        if (plainLines[i].trim() === target) {
          if (seen === occ) { annActiveLine = i; break }
          seen++
        }
      }
    }
  }

  // Follow the active line in the annotations view — same semantics as the
  // lyrics view: manual scroll pauses following, "Seguir letra" resumes it
  useEffect(() => {
    if (contentView !== 'annotations' || viewMode !== 'semi' || !scrollFollowing) return
    if (annActiveLine < 0) return
    const el = document.querySelector('[data-activeline]')
    if (!el) return
    markProgrammatic()
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [annActiveLine, contentView, viewMode, scrollFollowing])

  // Alinhamento visível (coluna ou folha) → música atual centrada na lista
  // (scrollTop on the list only — never scroll the page container)
  const listVisible = isWide ? sidebarOpen : sheetOpen
  useEffect(() => {
    if (!listVisible) return
    const list = setlistListRef.current
    const row = list?.querySelector<HTMLElement>('[data-current]')
    if (!list || !row) return
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2)
  }, [listVisible, isWide, songs.length > 0])

  // Mudou a música → mantém a atual (e a seguinte) à vista, suavemente
  useEffect(() => {
    if (!listVisible) return
    const list = setlistListRef.current
    const row = list?.querySelector<HTMLElement>('[data-current]')
    if (!list || !row) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight * 2
    if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return
    list.scrollTo({
      top: Math.max(0, top - list.clientHeight / 2 + row.offsetHeight / 2),
      behavior: 'smooth',
    })
  }, [songIdx])

  // Stage palette from the concert theme → CSS variables consumed by the
  // module (secondary inks are the user's ink with alpha, computed here in
  // JS because old iPadOS Safari can't mix colours in CSS). Tinted fills
  // never fall back to the opaque colour (it would hide the lyric).
  const accentRgb = parseRgb(theme.accent_color)
  const inkRgb = parseRgb(theme.active_color)
  // Acento ≈ tinta da letra (ex.: ambos amarelos): o flash precisa de mais corpo
  const accentNearInk = !!accentRgb && !!inkRgb && Math.hypot(
    accentRgb[0] - inkRgb[0], accentRgb[1] - inkRgb[1], accentRgb[2] - inkRgb[2],
  ) < 90
  const stageStyle = {
    background: theme.bg,
    '--stage-bg': theme.bg,
    '--stage-ink': theme.active_color,
    '--stage-ink-2': withAlpha(theme.active_color, 0.72),
    '--stage-ink-3': withAlpha(theme.active_color, 0.56),
    '--stage-accent': theme.accent_color,
    '--stage-accent-soft': withAlpha(theme.accent_color, 0.14, 'rgba(255, 255, 255, 0.10)'),
    '--stage-flash-soft': withAlpha(theme.accent_color, accentNearInk ? 0.28 : 0.14, 'rgba(255, 255, 255, 0.14)'),
  } as CSSProperties

  const lyricVars = {
    '--lyric-size': `${displayFontSize}px`,
    '--lyric-lh': displayLineHeight,
  } as CSSProperties

  // Duração total do alinhamento (micro-rótulo) — mesmo formato da setlist
  const totalMin = Math.floor(songs.reduce((acc, s) => acc + (s.song?.duration_sec ?? 0), 0) / 60)
  const totalLabel = totalMin <= 0 ? null
    : totalMin >= 60 ? `${Math.floor(totalMin / 60)}h${pad2(totalMin % 60)}` : `${totalMin} min`

  const countNow   = songs.length > 0 ? pad2(songIdx + 1) : '--'
  const countTotal = songs.length > 0 ? pad2(songs.length) : '--'

  // Com a coluna aberta, a film strip do footer é redundante
  const showFilmStrip = !!nextSong && !(isWide && sidebarOpen)

  const stanzaGap = `${Math.round(displayFontSize * 0.9)}px`

  /** Cabeçalho + lista do alinhamento — partilhado pela coluna e pela folha */
  function renderSetlist(inSheet: boolean) {
    return (
      <>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>
            Alinhamento
            <span aria-hidden="true"> · </span>
            {songs.length}<span className={styles.srOnly}> {songs.length === 1 ? 'música' : 'músicas'}</span>
            {totalLabel && <>
              <span aria-hidden="true"> · </span>
              {totalLabel}
            </>}
          </span>
          {songs.length > 1 && (
            <button
              type="button"
              className={`${styles.editBtn} ${editOrder ? styles.editBtnOn : ''}`}
              aria-pressed={editOrder}
              onClick={() => {
                if (editOrder) finishEditOrder()
                else { setArmedRow(null); setEditOrder(true) }
              }}
            >{editOrder ? 'Concluir' : 'Editar ordem'}</button>
          )}
        </div>
        <ol ref={setlistListRef} className={styles.setlist} aria-label="Alinhamento">
          {songs.map((ss, i) => {
            const isCurrent = i === songIdx
            const isNext = i === songIdx + 1
            const isArmed = !inSheet && !editOrder && armedRow === ss.id
            const title = ss.song?.title ?? ''
            const songKey = ss.performance_key ?? ss.song?.original_key
            const body = (
              <>
                <span className={styles.rowNum}>{pad2(i + 1)}</span>
                <span className={styles.rowText}>
                  {isArmed
                    ? <span className={styles.rowTag}>Toca de novo · saltar</span>
                    : isNext && <span className={styles.rowTag}>A seguir</span>}
                  <span className={styles.rowTitle}>{title}</span>
                </span>
                {songKey && <span className={styles.rowKey}>{songKey}</span>}
              </>
            )
            return (
              <li
                key={ss.id}
                data-current={isCurrent || undefined}
                className={[
                  styles.row,
                  isCurrent ? styles.rowCurrent : '',
                  !isCurrent && played.has(ss.id) ? styles.rowPast : '',
                  isArmed ? styles.rowArmed : '',
                ].join(' ')}
              >
                {editOrder ? (
                  // Em edição o toque não salta — só as teclas ▲▼ mexem
                  <div className={`${styles.rowMain} ${styles.rowMainStatic}`}>{body}</div>
                ) : (
                  <button
                    type="button"
                    className={styles.rowMain}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => tapSetlistRow(i, ss.id, inSheet)}
                  >{body}</button>
                )}
                {editOrder && (
                  <span className={styles.reorderBtns}>
                    <button
                      type="button"
                      className={styles.reorderBtn}
                      disabled={i === 0}
                      onClick={() => moveSong(i, i - 1)}
                      title="Subir"
                      aria-label={`Subir ${title}`}
                    >{ICONS.up}</button>
                    <button
                      type="button"
                      className={styles.reorderBtn}
                      disabled={i === songs.length - 1}
                      onClick={() => moveSong(i, i + 1)}
                      title="Descer"
                      aria-label={`Descer ${title}`}
                    >{ICONS.down}</button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </>
    )
  }

  const emptyLyrics = (
    <div className={styles.emptyLyrics}>
      <span className={styles.emptyTitle}>Sem letra disponível</span>
      <span className={styles.emptyHint}>Desliza ou usa as setas para mudar de música</span>
    </div>
  )

  return (
    <div className={styles.page} style={stageStyle}>

      {/* ── Header — exit · readout (07 / 22 + ao vivo) · title/sub · keys ── */}
      <header className={styles.header}>
        <button
          className={`${styles.key} ${styles.exitKey}`}
          title="Sair do concerto"
          aria-label="Sair do concerto"
          onClick={exitConcert}
        >{ICONS.close}</button>

        <div className={styles.readout}>
          <div className={styles.counter}>
            <span className={styles.counterNow}>{countNow}</span>
            <span className={styles.counterTotal}> / {countTotal}</span>
          </div>
          <div className={styles.liveTag}>
            <span className={styles.liveLed} aria-hidden="true" />
            Ao vivo
          </div>
        </div>

        <div className={styles.headerInfo}>
          <div className={styles.headerTitle}>
            {currentSong?.title ?? '—'}
          </div>
          {(displayKey || concertName) && (
            <div className={styles.headerSub}>
              {displayKey && <span>Tom <span className={styles.keyVal}>{displayKey}</span></span>}
              {displayKey && concertName && <span aria-hidden="true"> · </span>}
              {concertName && <span>{concertName}</span>}
            </div>
          )}
        </div>

        <div className={styles.headerActions}>
          {/* Teclas condicionais (anotações · acordes · metrónomo) só
              aparecem quando a música as tem — uma tecla apagada parecia
              avariada. Ficam ANTES das fixas e o grupo alinha à direita,
              por isso ✎ ≡ e SEMI/MANUAL nunca mudam de sítio entre músicas. */}
          {hasAnnotations && (
            <button
              className={`${styles.key} ${contentView === 'annotations' ? styles.keyOn : ''}`}
              onClick={() => setContentView(v => v === 'annotations' ? 'lyrics' : 'annotations')}
              title="Anotações de ensaio"
              aria-label="Anotações de ensaio"
              aria-pressed={contentView === 'annotations'}
            >{ICONS.pen}</button>
          )}
          {rawChords && (
            <button
              className={`${styles.key} ${contentView === 'chords' ? styles.keyOn : ''}`}
              onClick={() => setContentView(v => v === 'chords' ? 'lyrics' : 'chords')}
              title="Acordes"
              aria-label="Acordes"
              aria-pressed={contentView === 'chords'}
            >{ICONS.note}</button>
          )}
          {!!bpm && (
            <button
              className={`${styles.key} ${metronomeOn ? styles.keyOn : ''}`}
              onClick={() => setMetronomeOn(m => !m)}
              title={`Metrónomo visual — ${bpm} bpm`}
              aria-label={`Metrónomo visual — ${bpm} bpm`}
              aria-pressed={metronomeOn}
            >
              {metronomeOn ? (
                <span className={styles.metro} aria-hidden="true">
                  <span className={styles.metroLed} style={{ animationDuration: `${60 / bpm}s` }} />
                  <span className={styles.metroBpm}>{bpm}</span>
                </span>
              ) : ICONS.metronome}
            </button>
          )}
          <button
            className={styles.key}
            onClick={() => currentSong && navigate(`/songs/${currentSong.id}?setlist=${id}`)}
            disabled={!currentSong}
            title="Editar letra"
            aria-label="Editar letra"
          >{ICONS.edit}</button>
          {/* ≥1024: recolhe/expande a coluna; abaixo: abre a folha */}
          <button
            className={`${styles.key} ${listVisible ? styles.keyLatched : ''}`}
            onClick={toggleSetlist}
            title={isWide ? (sidebarOpen ? 'Recolher alinhamento' : 'Mostrar alinhamento') : 'Alinhamento'}
            aria-label="Alinhamento"
            aria-expanded={listVisible}
            aria-controls="concert-setlist"
          >{ICONS.list}</button>
          {/* Segmented control: both modes visible, active one lit */}
          <div className={styles.seg} role="group" aria-label="Modo de avanço">
            <button
              className={`${styles.segBtn} ${viewMode === 'semi' ? styles.segBtnOn : ''}`}
              aria-pressed={viewMode === 'semi'}
              onClick={() => setViewMode('semi')}
            >Semi</button>
            <button
              className={`${styles.segBtn} ${viewMode === 'manual' ? styles.segBtnOn : ''}`}
              aria-pressed={viewMode === 'manual'}
              onClick={() => setViewMode('manual')}
            >Manual</button>
          </div>
        </div>
      </header>

      <div className={styles.stageBody}>
        {/* ── Alinhamento sempre à mão (≥1024px) ── */}
        {isWide && sidebarOpen && (
          <aside id="concert-setlist" className={styles.sidebar} aria-label="Alinhamento">
            {renderSetlist(false)}
          </aside>
        )}

        <div className={styles.stageMain}>
          {/* ── Cue sheet: intro / notes / ending ── */}
          {(currentRow?.custom_intro || currentRow?.notes || currentRow?.custom_ending) && (
            <div className={styles.cueStack}>
              {currentRow?.custom_intro && (
                <div className={`${styles.cue} ${styles.cueIntro}`}>
                  <span className={styles.cueLabel}>Intro</span>
                  <span className={styles.cueText}>{currentRow.custom_intro}</span>
                </div>
              )}
              {currentRow?.notes && (
                <div className={styles.cue}>
                  <span className={styles.cueLabel}>Nota</span>
                  <span className={styles.cueText}>{currentRow.notes}</span>
                </div>
              )}
              {currentRow?.custom_ending && (
                <div className={styles.cue}>
                  <span className={styles.cueLabel}>Final</span>
                  <span className={styles.cueText}>{currentRow.custom_ending}</span>
                </div>
              )}
            </div>
          )}

          <div ref={lyricsAreaRef} className={styles.lyricsArea}>
            {/* ── Chords view ── */}
            {contentView === 'chords' ? (
              <div
                ref={lyricsScrollRef}
                className={styles.lyricsScroll}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
              >
                {chordsTransposed && (
                  <div className={styles.transposeNote}>
                    Transposto <span className={styles.keyVal}>{currentSong?.original_key}</span>
                    {' → '}
                    <span className={styles.keyVal}>{displayKey}</span>
                  </div>
                )}
                <pre className={styles.chordsPre}>
                  {chordsText || 'Sem acordes'}
                </pre>
                <div style={{ height: '30vh' }} />
              </div>
            ) : contentView === 'annotations' ? (
              <div
                ref={lyricsScrollRef}
                className={styles.lyricsScroll}
                onScroll={handleScroll}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
              >
                <div className={styles.annotationsWrap}>
                  {currentSong && (
                    <AnnotatedLyrics
                      songId={currentSong.id}
                      userId={user?.id}
                      lyrics={currentSong.edited_lyrics ?? currentSong.lyrics ?? ''}
                      bgColor={theme.bg}
                      textColor={theme.active_color}
                      activeLine={annActiveLine >= 0 ? annActiveLine : undefined}
                      accentColor={theme.accent_color}
                      fontSize={displayFontSize}
                      lineHeight={displayLineHeight}
                      noPadding
                    />
                  )}
                </div>
                <div style={{ height: '30vh' }} />
              </div>
            ) : viewMode === 'semi' ? (
              <div
                ref={lyricsScrollRef}
                className={styles.lyricsScroll}
                style={lyricVars}
                onScroll={handleScroll}
                onPointerDown={handleLyricsPointerDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
              >
                {/* Topo: em cue, a letra começa logo aqui (com a dica); a
                    tocar, 40vh deixam centrar as primeiras linhas */}
                {inCue ? (
                  <div ref={topSpacerRef} className={styles.cueSpacer}>
                    <div className={styles.cueHint}>
                      <span className={styles.cueHintLed} aria-hidden="true" />
                      <span>Toca na 1.ª linha quando entrares</span>
                      <span aria-hidden="true">·</span>
                      <span className={styles.cueHintPlay}>
                        ou {ICONS.playSmall}<span className={styles.srOnly}>Reproduzir</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div ref={topSpacerRef} style={{ height: syncLines ? '40vh' : '12px', flexShrink: 0 }} />
                )}
                {lines.length === 0 ? emptyLyrics : lines.map((line, i) => {
                  const t = line.trim()
                  if (t === '') {
                    // Stanza gap ≈ 0.9× the font — anything bigger reads as a page break
                    return <div key={i} style={{ height: stanzaGap, flexShrink: 0 }} />
                  }
                  // Com sync: só depois de arrancar e de o relógio chegar à
                  // entrada (em cue/intro nada fica aceso). Sem sync: só a
                  // linha que o cantor tocou (nunca a 1.ª "encravada").
                  const active = syncLines
                    ? started && i === lineIdx && elapsedMs >= (syncLines[i]?.time_ms ?? 0)
                    : tapMarked && i === lineIdx
                  const flashEl = flash?.idx === i
                    ? <span key={flash.n} className={styles.flashRing} aria-hidden="true" />
                    : null
                  const sec = t.match(/^\[(.+?)\]$/)
                  if (sec) return (
                    <div
                      key={i}
                      ref={i === anchorIdx ? activeLineRef : null}
                      className={`${styles.sectionLabel} ${i < lineIdx ? styles.past : ''}`}
                      onClick={e => tapLine(i, e)}
                    >
                      {fmtSection(sec[1])}
                      {flashEl}
                    </div>
                  )
                  return (
                    <div
                      key={i}
                      ref={i === anchorIdx ? activeLineRef : null}
                      className={[
                        styles.lyricLine,
                        active ? styles.lyricActive : '',
                        active && pausedMidSong ? styles.lyricPaused : '',
                        i < lineIdx ? styles.past : '',
                        i === cueLineIdx ? styles.lyricCue : '',
                      ].join(' ')}
                      onClick={e => tapLine(i, e)}
                    >
                      {line}
                      {flashEl}
                    </div>
                  )
                })}
                <div style={{ height: '50vh' }} />
              </div>
            ) : (
              <div
                ref={lyricsScrollRef}
                className={styles.lyricsScroll}
                style={lyricVars}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
              >
                {/* Manual: sem linha a centrar, a letra começa no topo */}
                <div style={{ height: '12px', flexShrink: 0 }} />
                {lines.length === 0 ? emptyLyrics : lines.map((line, i) => {
                  const t = line.trim()
                  if (t === '') {
                    return <div key={i} style={{ height: stanzaGap, flexShrink: 0 }} />
                  }
                  const sec = t.match(/^\[(.+?)\]$/)
                  if (sec) return (
                    <div key={i} className={`${styles.sectionLabel} ${styles.isStatic}`}>
                      {fmtSection(sec[1])}
                    </div>
                  )
                  return (
                    <div
                      key={i}
                      className={`${styles.lyricLine} ${styles.isStatic}`}
                    >
                      {line}
                    </div>
                  )
                })}
                <div style={{ height: '50vh' }} />
              </div>
            )}

            {/* Confirmação não-bloqueante ("SINCRONIZADO · 1:24", "PEDAL DE
                NOVO → 08 · …"); parado a meio da música, fica o aviso de pausa */}
            <div className={styles.chipSlot} role="status" aria-live="polite">
              {chip ? (
                <span
                  key={chip.n}
                  className={`${styles.syncChip} ${chip.live ? '' : styles.syncChipIdle}`}
                  style={{ animationDuration: `${chip.ms}ms` }}
                >
                  <span className={`${styles.syncChipLed} ${chip.live ? '' : styles.syncChipLedOff}`} aria-hidden="true" />
                  <span className={styles.syncChipLabel}>{chip.label}</span>
                  {chip.value && <>
                    <span aria-hidden="true">·</span>
                    <span className={styles.syncChipTime}>{chip.value}</span>
                  </>}
                  {chip.suffix && <>
                    <span aria-hidden="true">·</span>
                    <span className={styles.syncChipLabel}>{chip.suffix}</span>
                  </>}
                </span>
              ) : pausedMidSong ? (
                <span className={`${styles.syncChip} ${styles.pauseTag}`}>
                  {ICONS.pauseSmall}
                  <span>Em pausa</span>
                  <span aria-hidden="true">·</span>
                  <span>Toca na linha para retomar</span>
                </span>
              ) : null}
            </div>
          </div>

          {/* ── Re-sync button (só há o que seguir com sincronização) ── */}
          {contentView !== 'chords' && viewMode === 'semi' && !!syncLines && !scrollFollowing && (
            <div className={styles.resyncWrap}>
              <button className={styles.resyncBtn} onClick={() => setScrollFollowing(true)}>
                {ICONS.follow}
                Seguir letra
              </button>
            </div>
          )}

          {/* ── Transport: fader progress (with sync) + keys + film strip ──
              Dentro da coluna do palco: com o alinhamento aberto (≥1024) a coluna
              desce até ao fundo e o deck fica centrado no eixo da letra */}
          <footer className={styles.footer}>
            {showProgress && (
              <div className={styles.progressRow}>
                <span className={styles.progressTime}>
                  {fmtTime(Math.min(elapsed, duration))}
                </span>
                <div
                  className={styles.progressHit}
                  onPointerDown={handleScrubStart}
                  onPointerMove={handleScrubMove}
                  onPointerUp={handleScrubEnd}
                  onPointerCancel={handleScrubEnd}
                  role="slider"
                  aria-label="Posição na música"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(Math.min(elapsed, duration))}
                  aria-valuetext={`${fmtTime(elapsed)} de ${fmtTime(duration)}`}
                >
                  <div ref={progressTrackRef} className={styles.progressBg}>
                    <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
                    <div className={styles.fader} style={{ left: `${progressPct}%` }} />
                  </div>
                </div>
                <span className={`${styles.progressTime} ${styles.progressTimeEnd}`}>
                  {fmtTime(duration)}
                </span>
              </div>
            )}

            {/* ‹ · │ deck (‹ LINHA ▶ LINHA › ou estado) │ · A SEGUIR · DEPOIS · ›
                As teclas de música ficam SEMPRE nos cantos, sem corpo (só
                contorno) e com o nº de destino — não se confundem com as de
                linha, que ficam agrupadas entre hairlines. */}
            <div className={`${styles.controlsRow} ${hasTransport ? styles.hasTransport : ''}`}>
              <button
                className={`${styles.key} ${styles.navKey}`}
                onClick={() => prevSong && setSongIdx(s => s - 1)}
                disabled={!prevSong}
                title={prevSong ? `Anterior — ${prevSong.title}` : 'Sem música anterior'}
                aria-label={prevSong ? `Música anterior — ${pad2(songIdx)} ${prevSong.title}` : 'Música anterior'}
              >
                {ICONS.prev}
                <span className={styles.navKeyNum} aria-hidden="true">{prevSong ? pad2(songIdx) : '--'}</span>
              </button>

              {/* Deck: ajuste fino da letra com sync; senão, estado (LED apagado) */}
              <div className={styles.deck}>
                {hasTransport ? (
                  <div className={styles.transport} role="group" aria-label="Sincronização da letra">
                    <button
                      type="button"
                      className={`${styles.key} ${styles.lineKey}`}
                      onClick={() => stepLine(-1)}
                      disabled={prevLyricIdx < 0 && !lineBackToCue}
                      title={lineBackToCue ? 'Voltar à espera da entrada (← / PageUp)' : 'Linha anterior (← / PageUp)'}
                      aria-label={lineBackToCue ? 'Voltar à espera da entrada' : 'Linha anterior'}
                    >
                      {ICONS.lineBack}
                      <span className={styles.lineKeyLabel} aria-hidden="true">Linha</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.playKey} ${pausedMidSong ? styles.playKeyPaused : ''}`}
                      onClick={togglePlay}
                      title={playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)'}
                      aria-label={playing ? 'Pausar' : 'Reproduzir'}
                    >
                      {playing ? ICONS.pause : ICONS.play}
                    </button>
                    <button
                      type="button"
                      className={`${styles.key} ${styles.lineKey}`}
                      onClick={() => stepLine(1)}
                      disabled={nextLyricIdx < 0 && !(!started && firstLyricIdx >= 0)}
                      title="Linha seguinte (→ / PageDown)"
                      aria-label="Linha seguinte"
                    >
                      {ICONS.lineNext}
                      <span className={styles.lineKeyLabel} aria-hidden="true">Linha</span>
                    </button>
                  </div>
                ) : (
                  <div className={styles.deckNote}>
                    <span className={styles.deckMain}>
                      <span className={styles.deckLed} aria-hidden="true" />
                      <span className={styles.deckText}>{deckStatus}</span>
                    </span>
                    <span className={`${styles.deckText} ${styles.deckHint}`}>Usa o scroll</span>
                  </div>
                )}
              </div>

              {/* Film strip: the next 1-2 songs — tap to jump (hidden on phones
                  and when the alinhamento column is open) */}
              {showFilmStrip && nextSong && (
                <div className={styles.filmStrip}>
                  <button
                    className={styles.stripCard}
                    onClick={() => setSongIdx(songIdx + 1)}
                  >
                    <span className={`${styles.stripLabel} ${styles.stripLabelNext}`}>
                      A seguir · {pad2(songIdx + 2)}
                    </span>
                    <span className={styles.stripTitle}>{nextSong.title}</span>
                  </button>
                  {afterSong && (
                    <button
                      className={`${styles.stripCard} ${styles.stripCardLater}`}
                      onClick={() => setSongIdx(songIdx + 2)}
                    >
                      <span className={styles.stripLabel}>Depois · {pad2(songIdx + 3)}</span>
                      <span className={styles.stripTitle}>{afterSong.title}</span>
                    </button>
                  )}
                </div>
              )}

              <button
                className={`${styles.key} ${styles.navKey}`}
                onClick={() => nextSong && setSongIdx(s => s + 1)}
                disabled={!nextSong}
                title={nextSong ? `Seguinte — ${nextSong.title}` : 'Sem música seguinte'}
                aria-label={nextSong ? `Música seguinte — ${pad2(songIdx + 2)} ${nextSong.title}` : 'Música seguinte'}
              >
                {ICONS.next}
                <span className={styles.navKeyNum} aria-hidden="true">{nextSong ? pad2(songIdx + 2) : '--'}</span>
              </button>
            </div>

            {/* Telemóvel (sem film strip): a seguinte numa micro-linha mono */}
            {nextSong && (
              <div className={styles.nextLine} aria-hidden="true">
                <span className={styles.nextLineTag}>A seguir</span>
                <span>·</span>
                <span>{pad2(songIdx + 2)}</span>
                <span>·</span>
                <span className={styles.nextLineTitle}>{nextSong.title}</span>
              </div>
            )}
          </footer>
        </div>
      </div>

      {/* ── Alinhamento em folha (<1024px) ── */}
      {!isWide && sheetOpen && (
        <div className={styles.sheetLayer}>
          <div className={styles.sheetBackdrop} onClick={closeSheet} aria-hidden="true" />
          <div id="concert-setlist" className={styles.sheet} role="dialog" aria-label="Alinhamento">
            <button
              type="button"
              className={styles.sheetGrip}
              onClick={closeSheet}
              aria-label="Fechar alinhamento"
            >
              <span className={styles.sheetGripBar} aria-hidden="true" />
            </button>
            {renderSetlist(true)}
          </div>
        </div>
      )}
    </div>
  )
}
