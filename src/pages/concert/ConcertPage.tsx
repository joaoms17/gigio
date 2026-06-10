import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { SetlistSong, Song, ConcertTheme, LyricLine } from '../../types'
import styles from './ConcertPage.module.css'

const DEFAULT_THEME: ConcertTheme = {
  bg: '#0d0d0d', active_color: '#ffffff', accent_color: '#FF4D6D', font_size: 32, line_height: 1.6
}

type Row = SetlistSong & { song: Song }

export default function ConcertPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [songs, setSongs] = useState<Row[]>([])
  const [songIdx, setSongIdx] = useState(0)
  const [lineIdx, setLineIdx] = useState(0)
  const [theme, setTheme] = useState<ConcertTheme>(DEFAULT_THEME)
  const [syncLines, setSyncLines] = useState<LyricLine[] | null>(null)
  const [viewMode, setViewMode] = useState<'semi' | 'manual'>('semi')
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showSetlist, setShowSetlist] = useState(false)
  const [scrollFollowing, setScrollFollowing] = useState(true)

  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef              = useRef<number>(0)
  const activeLineRef         = useRef<HTMLDivElement>(null)
  const lyricsScrollRef       = useRef<HTMLDivElement>(null)
  const touchStartRef         = useRef<{ x: number; y: number } | null>(null)
  const programmaticScrollRef = useRef(false)
  const scrollTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncLinesRef          = useRef<LyricLine[] | null>(null)

  useEffect(() => { syncLinesRef.current = syncLines }, [syncLines])

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id || !user) return
    let wakeLock: any = null
    navigator.wakeLock?.request('screen').then(wl => { wakeLock = wl }).catch(() => {})
    supabase.from('setlist_songs').select('*, song:songs(*)').eq('setlist_id', id).order('position')
      .then(({ data }) => setSongs((data ?? []) as any))
    supabase.from('profiles').select('concert_theme').eq('id', user.id).single()
      .then(({ data }) => { if (data?.concert_theme) setTheme(data.concert_theme as ConcertTheme) })
    return () => { wakeLock?.release(); stopTimer() }
  }, [id, user])

  // ── Song change ─────────────────────────────────────────────────────────
  useEffect(() => {
    const song = songs[songIdx]?.song
    if (!song) return
    setLineIdx(0); setElapsed(0); stopTimer(); setPlaying(false)
    setScrollFollowing(true)
    if (lyricsScrollRef.current) lyricsScrollRef.current.scrollTop = 0
    if (song.has_sync) {
      supabase.from('lyric_syncs').select('lines').eq('song_id', song.id).single()
        .then(({ data }) => setSyncLines(data?.lines as LyricLine[] ?? null))
    } else {
      setSyncLines(null)
    }
  }, [songIdx, songs])

  // ── Scroll following ─────────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'semi' || !scrollFollowing) return
    if (!activeLineRef.current) return
    programmaticScrollRef.current = true
    activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 800)
  }, [lineIdx, viewMode, scrollFollowing])

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
      if (e.key === 'Escape') navigate(`/setlist/${id}`)
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRow  = songs[songIdx]
  const currentSong = currentRow?.song
  const plainLines  = (currentSong?.edited_lyrics ?? currentSong?.lyrics ?? '').split('\n')
  const lines       = syncLines ? syncLines.map(l => l.text) : plainLines
  const prevSong    = songs[songIdx - 1]?.song
  const nextSong    = songs[songIdx + 1]?.song
  const displayKey  = currentRow?.performance_key ?? currentSong?.performance_key ?? currentSong?.original_key

  return (
    <div className={styles.page} style={{ background: theme.bg }}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <button className={styles.exitBtn} title="Sair do concerto" onClick={() => navigate(`/setlist/${id}`)}>✕</button>
        <span className={styles.counter} style={{ color: theme.accent_color }}>
          {songIdx + 1} / {songs.length}
        </span>
        <div className={styles.headerRight}>
          <button
            className={styles.modeSwitchBtn}
            style={{ color: theme.accent_color, borderColor: theme.accent_color + '40' }}
            onClick={() => setViewMode(m => m === 'semi' ? 'manual' : 'semi')}
          >
            {viewMode === 'semi' ? 'Semi' : 'Manual'}
          </button>
          <button
            className={styles.modeBtn}
            style={{ color: showSetlist ? theme.accent_color : 'rgba(255,255,255,0.3)' }}
            onClick={() => setShowSetlist(s => !s)}
          >≡</button>
        </div>
      </div>

      {/* ── Song info ── */}
      <div className={styles.songInfo}>
        <div className={styles.songTitle} style={{ color: theme.active_color }}>
          {currentSong?.title}
          {displayKey && (
            <span className={styles.keyChip} style={{ borderColor: theme.accent_color, color: theme.accent_color }}>
              {displayKey}
            </span>
          )}
        </div>
        <div className={styles.songArtist} style={{ color: theme.active_color, opacity: 0.4 }}>
          {currentSong?.artist}
        </div>
      </div>

      {/* ── Notes banner ── */}
      {currentRow?.notes && (
        <div className={styles.notesBanner} style={{ borderColor: theme.accent_color + '40', color: theme.active_color, opacity: 0.6 }}>
          {currentRow.notes}
        </div>
      )}

      {/* ── Lyrics ── */}
      {viewMode === 'semi' ? (
        <div
          ref={lyricsScrollRef}
          className={styles.lyricsScroll}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {lines.length === 0 ? (
            <div className={styles.emptyLyrics} style={{ color: theme.active_color, opacity: 0.25 }}>
              Sem letra disponível
            </div>
          ) : lines.map((line, i) => line.trim() === '' ? (
            <div key={i} style={{ height: `${theme.font_size * (theme.line_height ?? 1.6) * 1.8}px`, flexShrink: 0 }} />
          ) : (
            <div
              key={i}
              ref={i === lineIdx ? activeLineRef : null}
              className={styles.lyricLineManual}
              style={{
                color: theme.active_color,
                fontSize: theme.font_size,
                lineHeight: theme.line_height ?? 1.6,
                fontWeight: i === lineIdx ? 800 : 400,
                opacity: i < lineIdx ? 0.35 : 1,
                background: i === lineIdx ? `${theme.accent_color}22` : 'transparent',
              }}
              onClick={() => setLineIdx(i)}
            >
              {line}
            </div>
          ))}
          <div style={{ height: '50vh' }} />
        </div>
      ) : (
        <div
          className={styles.lyricsScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {lines.length === 0 ? (
            <div className={styles.emptyLyrics} style={{ color: theme.active_color, opacity: 0.25 }}>
              Sem letra disponível
            </div>
          ) : lines.map((line, i) => line.trim() === '' ? (
            <div key={i} style={{ height: `${theme.font_size * (theme.line_height ?? 1.6) * 1.8}px`, flexShrink: 0 }} />
          ) : (
            <div
              key={i}
              className={styles.lyricLineManual}
              style={{
                color: theme.active_color,
                fontSize: theme.font_size,
                lineHeight: theme.line_height ?? 1.6,
                fontWeight: 400,
                opacity: 1,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {/* ── Re-sync button ── */}
      {viewMode === 'semi' && !scrollFollowing && (
        <div className={styles.resyncWrap}>
          <button
            className={styles.resyncBtn}
            style={{ borderColor: theme.accent_color + '80', color: theme.accent_color }}
            onClick={() => setScrollFollowing(true)}
          >
            ↩ Seguir letra
          </button>
        </div>
      )}

      {/* ── Controls (semi + syncLines only) ── */}
      {viewMode === 'semi' && syncLines && (
        <div className={styles.controls}>
          <button
            className={styles.seekBtn}
            style={{ color: theme.active_color, borderColor: `${theme.active_color}20` }}
            onClick={() => seekDelta(-5)}
          >
            <span className={styles.seekArrow}>‹‹</span>
            <span className={styles.seekLabel}>5</span>
          </button>
          <button
            className={styles.playBtn}
            style={{ background: theme.accent_color }}
            onClick={togglePlay}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            className={styles.seekBtn}
            style={{ color: theme.active_color, borderColor: `${theme.active_color}20` }}
            onClick={() => seekDelta(5)}
          >
            <span className={styles.seekLabel}>5</span>
            <span className={styles.seekArrow}>››</span>
          </button>
        </div>
      )}

      {/* ── Prev / Next song ── */}
      <div className={styles.songNav}>
        <button
          className={styles.songNavBtn}
          style={{ color: theme.active_color, opacity: prevSong ? 0.45 : 0.12 }}
          onClick={() => prevSong && setSongIdx(s => s - 1)}
          disabled={!prevSong}
        >
          <span className={styles.navArrow}>‹</span>
          <span className={styles.navSongName}>{prevSong?.title ?? ''}</span>
        </button>
        <button
          className={styles.songNavBtn}
          style={{ color: theme.active_color, opacity: nextSong ? 0.45 : 0.12, textAlign: 'right' }}
          onClick={() => nextSong && setSongIdx(s => s + 1)}
          disabled={!nextSong}
        >
          <span className={styles.navSongName}>{nextSong?.title ?? ''}</span>
          <span className={styles.navArrow}>›</span>
        </button>
      </div>

      {/* ── Setlist panel ── */}
      {showSetlist && (
        <div className={styles.setlistPanel} style={{ borderTopColor: 'rgba(255,255,255,0.06)' }}>
          {songs.map((ss, i) => (
            <button
              key={ss.id}
              className={styles.setlistItem}
              style={{
                background: i === songIdx ? theme.accent_color : 'transparent',
                color: i === songIdx ? '#fff' : theme.active_color,
                opacity: i < songIdx ? 0.3 : 1,
              }}
              onClick={() => { setSongIdx(i); setShowSetlist(false) }}
            >
              <span className={styles.setlistNum}>{i + 1}</span>
              <span className={styles.setlistTitle}>{ss.song?.title}</span>
              {(ss.performance_key ?? ss.song?.original_key) && (
                <span className={styles.setlistKey} style={{ color: i === songIdx ? 'rgba(255,255,255,0.7)' : theme.accent_color }}>
                  {ss.performance_key ?? ss.song?.original_key}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
