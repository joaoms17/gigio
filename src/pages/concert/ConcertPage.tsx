import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
import { fmtSection, withAlpha } from '../../components/LyricsView'
import type { SetlistSong, Song, ConcertTheme, LyricLine } from '../../types'
import styles from './ConcertPage.module.css'
import { DEFAULT_CONCERT_THEME, normalizeConcertTheme } from '../../lib/concertTheme'

type Row = SetlistSong & { song: Song }
type ContentView = 'lyrics' | 'chords' | 'annotations'

function fmtTime(secs: number) {
  const s = Math.max(0, Math.floor(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Posição de setlist sempre com 2 dígitos: 01, 02… (assinatura v2) */
function pad2(n: number) {
  return String(n).padStart(2, '0')
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
    <svg width="28" height="28" viewBox="0 0 24 24" {...sp} strokeWidth={2.5}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  next: (
    <svg width="28" height="28" viewBox="0 0 24 24" {...sp} strokeWidth={2.5}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  play: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.5 4.5v15L19.5 12z" />
    </svg>
  ),
  pause: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4.5" height="14" rx="0.8" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="0.8" />
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
  const [syncLines, setSyncLines] = useState<LyricLine[] | null>(null)
  const [viewMode, setViewMode] = useState<'semi' | 'manual'>('semi')
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showSetlist, setShowSetlist] = useState(false)
  const [scrollFollowing, setScrollFollowing] = useState(true)
  const [contentView, setContentView] = useState<ContentView>('lyrics')
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [annAvailable, setAnnAvailable] = useState(false)

  // Effective font size — scales with viewport so all modes stay consistent
  const [isTablet, setIsTablet] = useState(() => window.innerWidth >= 768)
  useEffect(() => {
    const handler = () => setIsTablet(window.innerWidth >= 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  const displayFontSize = isTablet ? Math.round(theme.font_size * 1.45) : theme.font_size
  const displayLineHeight = theme.line_height ?? 1.6

  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef              = useRef<number>(0)
  const activeLineRef         = useRef<HTMLDivElement>(null)
  const lyricsScrollRef       = useRef<HTMLDivElement>(null)
  const touchStartRef         = useRef<{ x: number; y: number } | null>(null)
  const programmaticScrollRef = useRef(false)
  const scrollTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncLinesRef          = useRef<LyricLine[] | null>(null)
  const progressTrackRef      = useRef<HTMLDivElement>(null)
  const scrubbingRef          = useRef(false)
  const setlistListRef        = useRef<HTMLOListElement>(null)

  useEffect(() => { syncLinesRef.current = syncLines }, [syncLines])

  // ── Persist position per setlist ──────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    try { sessionStorage.setItem(`concert-pos-${id}`, String(songIdx)) } catch {}
  }, [id, songIdx])

  // Bounds-check a restored index once the songs arrive
  useEffect(() => {
    if (songs.length > 0 && songIdx >= songs.length) setSongIdx(songs.length - 1)
  }, [songs.length, songIdx])

  // ── Load (with offline cache fallback) ──────────────────────────────────
  useEffect(() => {
    if (!id || !user) return
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
    supabase.from('profiles').select('concert_theme').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.concert_theme) {
          setTheme(normalizeConcertTheme(data.concert_theme as Partial<ConcertTheme>))
          cacheTheme(data.concert_theme)
        } else {
          const cached = getCachedTheme<Partial<ConcertTheme>>()
          if (cached) setTheme(normalizeConcertTheme(cached))
        }
      })
    return () => { wakeLock?.release(); document.removeEventListener('visibilitychange', onVisibilityChange); stopTimer() }
  }, [id, user])

  // ── Song change ─────────────────────────────────────────────────────────
  useEffect(() => {
    const song = songs[songIdx]?.song
    if (!song) return
    setLineIdx(0); setElapsed(0); stopTimer(); setPlaying(false)
    setScrollFollowing(true)
    setContentView('lyrics')
    // Annotation availability: local first, remote as fallback
    const local = loadAnnotations(song.id)
    if (local && local.strokes.length > 0) setAnnAvailable(true)
    else {
      setAnnAvailable(false)
      if (user) pullAnnotations(song.id, user.id).then(r => {
        if (r && r.strokes.length > 0) setAnnAvailable(true)
      })
    }
    if (lyricsScrollRef.current) lyricsScrollRef.current.scrollTop = 0
    if (song.has_sync) {
      supabase.from('lyric_syncs').select('lines').eq('song_id', song.id).single()
        .then(({ data }) => {
          const lines = data?.lines as LyricLine[] ?? null
          if (lines) {
            setSyncLines(lines)
            cacheSyncLines(song.id, lines)
          } else {
            setSyncLines(getCachedSyncLines<LyricLine[]>(song.id))
          }
        }, () => setSyncLines(getCachedSyncLines<LyricLine[]>(song.id)))
    } else {
      setSyncLines(null)
    }
  }, [songIdx, songs])

  // ── Scroll following ─────────────────────────────────────────────────────
  function recenterActiveLine(behavior: ScrollBehavior = 'smooth') {
    if (viewMode !== 'semi' || !scrollFollowing) return
    if (!activeLineRef.current) return
    programmaticScrollRef.current = true
    activeLineRef.current.scrollIntoView({ behavior, block: 'center' })
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 800)
  }

  useEffect(() => {
    recenterActiveLine()
  }, [lineIdx, viewMode, scrollFollowing])

  // Switching views (lyrics/chords/annotations) → restore scroll-follow and
  // snap the lyrics view back to the active line
  useEffect(() => {
    setScrollFollowing(true)
    if (contentView !== 'lyrics') return
    requestAnimationFrame(() => {
      if (viewMode === 'semi' && activeLineRef.current) {
        programmaticScrollRef.current = true
        activeLineRef.current.scrollIntoView({ behavior: 'auto', block: 'center' })
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false }, 800)
      }
    })
  }, [contentView])

  // Re-center when the tablet rotates / viewport resizes
  useEffect(() => {
    function onResize() {
      // iOS reflows the layout after the rotation animation — re-center a
      // couple of times so it lands centred whenever the reflow settles.
      requestAnimationFrame(() => recenterActiveLine('auto'))
      setTimeout(() => recenterActiveLine('auto'), 350)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [viewMode, scrollFollowing, lineIdx])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (viewMode === 'semi' && syncLinesRef.current) {
        if (e.key === ' ') { e.preventDefault(); togglePlay() }
        else if (e.key === 'ArrowLeft')  { e.preventDefault(); seekDelta(-5) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); seekDelta(5) }
      } else if (viewMode === 'manual') {
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance() }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); retreat() }
      }
      if (e.key === 'ArrowUp')   { e.preventDefault(); if (songIdx > 0) setSongIdx(s => s - 1) }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (songIdx < songs.length - 1) setSongIdx(s => s + 1) }
      if (e.key === 'Escape') exitConcert()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [songIdx, lineIdx, songs.length, viewMode, playing, elapsed])

  // ── Timer ────────────────────────────────────────────────────────────────
  function startTimer() {
    startRef.current = Date.now() - elapsed * 1000
    timerRef.current = setInterval(() => {
      const secs = (Date.now() - startRef.current) / 1000
      setElapsed(secs)
      const sl = syncLinesRef.current
      if (sl) {
        const ms = secs * 1000
        let idx = 0
        for (let i = 0; i < sl.length; i++) {
          if (sl[i].time_ms <= ms) idx = i
        }
        setLineIdx(idx)
      }
    }, 80)
    setPlaying(true)
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current)
    setPlaying(false)
  }

  function togglePlay() { playing ? stopTimer() : startTimer() }

  // ── Seek ─────────────────────────────────────────────────────────────────
  function seekTo(time: number) {
    const dur = songs[songIdx]?.song?.duration_sec ?? 0
    const t = Math.max(0, dur ? Math.min(time, dur) : time)
    setElapsed(t)
    startRef.current = Date.now() - t * 1000
    const sl = syncLinesRef.current
    if (sl) {
      const ms = t * 1000
      let idx = 0
      for (let i = 0; i < sl.length; i++) {
        if (sl[i].time_ms <= ms) idx = i
      }
      setLineIdx(idx)
    }
  }

  function seekDelta(delta: number) { seekTo(elapsed + delta) }

  // ── Scrubbing on the progress bar ────────────────────────────────────────
  function scrubToClientX(clientX: number) {
    const track = progressTrackRef.current
    if (!track || duration <= 0) return
    const rect = track.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    seekTo(frac * duration)
  }
  function handleScrubStart(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubbingRef.current = true
    scrubToClientX(e.clientX)
  }
  function handleScrubMove(e: React.PointerEvent<HTMLDivElement>) {
    if (scrubbingRef.current) scrubToClientX(e.clientX)
  }
  function handleScrubEnd() { scrubbingRef.current = false }

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

  // ── Swipe (horizontal = change song) ────────────────────────────────────
  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }
  function handleTouchEnd(e: React.TouchEvent) {
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

  function handleScroll() {
    if (programmaticScrollRef.current) return
    setScrollFollowing(false)
  }

  // ── Manual mode nav ───────────────────────────────────────────────────────
  function advance() {
    if (lineIdx < lines.length - 1) setLineIdx(l => l + 1)
    else if (songIdx < songs.length - 1) setSongIdx(s => s + 1)
  }
  function retreat() {
    if (lineIdx > 0) setLineIdx(l => l - 1)
    else if (songIdx > 0) setSongIdx(s => s - 1)
  }

  // ── Reorder inside concert (setlist panel ↑↓) ───────────────────────────
  async function moveSong(from: number, to: number) {
    if (to < 0 || to >= songs.length) return
    const prevSongs = songs
    const prevIdx = songIdx
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
    if (id) cacheSetlistSongs(id, next)
    // Persist in two batched upserts — the unique(setlist_id, position)
    // constraint forces the two phases (park at 10000+, then land at final).
    // setlist_id/song_id incluídos porque o tuplo do INSERT é validado
    // (NOT NULL) antes de o conflito virar UPDATE.
    const rows = (offset: number) => next.map((ss, i) => ({
      id: ss.id, setlist_id: ss.setlist_id, song_id: ss.song_id, position: offset + i,
    }))
    let { error } = await supabase.from('setlist_songs').upsert(rows(10000), { onConflict: 'id' })
    if (!error) {
      ({ error } = await supabase.from('setlist_songs').upsert(rows(0), { onConflict: 'id' }))
    }
    if (error) {
      setSongs(prevSongs)
      setSongIdx(prevIdx)
      if (id) cacheSetlistSongs(id, prevSongs)
      toast('Não foi possível guardar a nova ordem', { type: 'error' })
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRow  = songs[songIdx]
  const currentSong = currentRow?.song
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

  // Visor do transporte quando não há play: diz em que estado o palco está
  // (em vez de um vazio entre ‹ e a film strip)
  const deckStatus = playbackContext
    ? 'Sem sincronização'
    : contentView === 'chords' ? 'Acordes' : 'Modo manual'

  // Map the active sync line onto the plain-lyrics line shown in the
  // annotations view (occurrence-aware so repeated chorus lines resolve
  // to the right verse).
  let annActiveLine = -1
  if (contentView === 'annotations' && viewMode === 'semi' && syncLines) {
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
    programmaticScrollRef.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false }, 800)
  }, [annActiveLine, contentView, viewMode, scrollFollowing])

  // Opening the setlist panel → bring the current song into view inside the
  // list (scrollTop on the list only — never scroll the page container)
  useEffect(() => {
    if (!showSetlist) return
    const list = setlistListRef.current
    const row = list?.querySelector<HTMLElement>('[data-current]')
    if (!list || !row) return
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2)
  }, [showSetlist])

  // Stage palette from the concert theme → CSS variables consumed by the
  // module (secondary inks are the user's ink with alpha, computed here in
  // JS because old iPadOS Safari can't mix colours in CSS)
  const stageStyle = {
    background: theme.bg,
    '--stage-bg': theme.bg,
    '--stage-ink': theme.active_color,
    '--stage-ink-2': withAlpha(theme.active_color, 0.72),
    '--stage-ink-3': withAlpha(theme.active_color, 0.56),
    '--stage-accent': theme.accent_color,
    '--stage-accent-soft': withAlpha(theme.accent_color, 0.14),
  } as CSSProperties

  // Duração total do alinhamento (micro-rótulo do painel ≡) — mesmo formato da setlist
  const totalMin = Math.floor(songs.reduce((acc, s) => acc + (s.song?.duration_sec ?? 0), 0) / 60)
  const totalLabel = totalMin <= 0 ? null
    : totalMin >= 60 ? `${Math.floor(totalMin / 60)}h${pad2(totalMin % 60)}` : `${totalMin} min`

  const countNow   = songs.length > 0 ? pad2(songIdx + 1) : '--'
  const countTotal = songs.length > 0 ? pad2(songs.length) : '--'

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
          <button
            className={`${styles.key} ${showSetlist ? styles.keyOn : ''}`}
            onClick={() => setShowSetlist(s => !s)}
            title="Alinhamento"
            aria-label="Alinhamento"
            aria-pressed={showSetlist}
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

      {/* ── Chords view ── */}
      {contentView === 'chords' ? (
        <div className={styles.lyricsScroll} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
        <div className={styles.lyricsScroll} onScroll={handleScroll} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
          style={{ ['--lyric-size' as any]: `${displayFontSize}px`, ['--lyric-lh' as any]: displayLineHeight }}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div style={{ height: syncLines ? '40vh' : '12px', flexShrink: 0 }} />
          {lines.length === 0 ? (
            <div className={styles.emptyLyrics}>
              <span className={styles.emptyTitle}>Sem letra disponível</span>
              <span className={styles.emptyHint}>Desliza ou usa as setas para mudar de música</span>
            </div>
          ) : lines.map((line, i) => {
            const t = line.trim()
            if (t === '') {
              // Stanza gap ≈ 0.9× the font — anything bigger reads as a page break
              return <div key={i} style={{ height: `${Math.round(displayFontSize * 0.9)}px`, flexShrink: 0 }} />
            }
            // With sync, jump the clock too — otherwise the timer snaps
            // the highlight back within <100ms (+1ms guards float rounding)
            const jump = () => {
              if (syncLines?.[i]) seekTo((syncLines[i].time_ms + 1) / 1000)
              else setLineIdx(i)
            }
            const sec = t.match(/^\[(.+?)\]$/)
            if (sec) return (
              <div
                key={i}
                ref={i === lineIdx ? activeLineRef : null}
                className={`${styles.sectionLabel} ${i < lineIdx ? styles.past : ''}`}
                onClick={jump}
              >
                {fmtSection(sec[1])}
              </div>
            )
            return (
              <div
                key={i}
                ref={i === lineIdx ? activeLineRef : null}
                className={[
                  styles.lyricLine,
                  i === lineIdx ? styles.lyricActive : '',
                  i < lineIdx ? styles.past : '',
                ].join(' ')}
                onClick={jump}
              >
                {line}
              </div>
            )
          })}
          <div style={{ height: '50vh' }} />
        </div>
      ) : (
        <div
          className={styles.lyricsScroll}
          style={{ ['--lyric-size' as any]: `${displayFontSize}px`, ['--lyric-lh' as any]: displayLineHeight }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div style={{ height: syncLines ? '40vh' : '12px', flexShrink: 0 }} />
          {lines.length === 0 ? (
            <div className={styles.emptyLyrics}>
              <span className={styles.emptyTitle}>Sem letra disponível</span>
              <span className={styles.emptyHint}>Desliza ou usa as setas para mudar de música</span>
            </div>
          ) : lines.map((line, i) => {
            const t = line.trim()
            if (t === '') {
              return <div key={i} style={{ height: `${Math.round(displayFontSize * 0.9)}px`, flexShrink: 0 }} />
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

      {/* ── Re-sync button ── */}
      {contentView !== 'chords' && viewMode === 'semi' && !scrollFollowing && (
        <div className={styles.resyncWrap}>
          <button className={styles.resyncBtn} onClick={() => setScrollFollowing(true)}>
            {ICONS.follow}
            Seguir letra
          </button>
        </div>
      )}

      {/* ── Setlist panel (≡) — printed-setlist rows: 01 · title · key · ↑↓ ── */}
      {showSetlist && (
        <div className={styles.setlistPanel}>
          <div className={styles.panelHead}>
            <span>Alinhamento</span>
            <span aria-hidden="true">·</span>
            <span>{songs.length} {songs.length === 1 ? 'música' : 'músicas'}</span>
            {totalLabel && <>
              <span aria-hidden="true">·</span>
              <span>{totalLabel}</span>
            </>}
          </div>
          <ol ref={setlistListRef} className={styles.setlist} aria-label="Alinhamento">
            {songs.map((ss, i) => {
              const isCurrent = i === songIdx
              const title = ss.song?.title ?? ''
              const songKey = ss.performance_key ?? ss.song?.original_key
              return (
                <li
                  key={ss.id}
                  data-current={isCurrent || undefined}
                  className={[
                    styles.row,
                    isCurrent ? styles.rowCurrent : '',
                    i < songIdx ? styles.rowPast : '',
                  ].join(' ')}
                >
                  <button
                    className={styles.rowMain}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => { setSongIdx(i); setShowSetlist(false) }}
                  >
                    <span className={styles.rowNum}>{pad2(i + 1)}</span>
                    <span className={styles.rowTitle}>{title}</span>
                    {songKey && <span className={styles.rowKey}>{songKey}</span>}
                  </button>
                  <span className={styles.reorderBtns}>
                    <button
                      className={styles.reorderBtn}
                      disabled={i === 0}
                      onClick={() => moveSong(i, i - 1)}
                      title="Subir"
                      aria-label={`Subir ${title}`}
                    >{ICONS.up}</button>
                    <button
                      className={styles.reorderBtn}
                      disabled={i === songs.length - 1}
                      onClick={() => moveSong(i, i + 1)}
                      title="Descer"
                      aria-label={`Descer ${title}`}
                    >{ICONS.down}</button>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {/* ── Transport: fader progress (with sync) + keys + film strip ── */}
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

        {/* ‹ · visor (▶ ou estado) · A SEGUIR · DEPOIS · ›
            As teclas de música ficam SEMPRE nos cantos — o › (o alvo mais
            usado ao vivo) está sempre encostado à direita, em qualquer ecrã. */}
        <div className={styles.controlsRow}>
          <button
            className={`${styles.key} ${styles.navKey}`}
            onClick={() => prevSong && setSongIdx(s => s - 1)}
            disabled={!prevSong}
            title={prevSong ? `Anterior — ${prevSong.title}` : 'Sem música anterior'}
            aria-label={prevSong ? `Música anterior — ${prevSong.title}` : 'Música anterior'}
          >{ICONS.prev}</button>

          {/* Visor: play/pausa com sync; senão, estado (LED apagado) */}
          <div className={styles.deck}>
            {playbackContext && syncLines ? (
              <button
                className={styles.playKey}
                onClick={togglePlay}
                aria-label={playing ? 'Pausar' : 'Reproduzir'}
              >
                {playing ? ICONS.pause : ICONS.play}
              </button>
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

          {/* Film strip: the next 1-2 songs — tap to jump (hidden on phones) */}
          {nextSong && (
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
            aria-label={nextSong ? `Música seguinte — ${nextSong.title}` : 'Música seguinte'}
          >{ICONS.next}</button>
        </div>
      </footer>
    </div>
  )
}
