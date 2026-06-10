import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { SetlistSong, Song, ConcertTheme, LyricLine } from '../../types'
import styles from './ConcertPage.module.css'

const DEFAULT_THEME: ConcertTheme = {
  bg: '#0d0d0d', active_color: '#ffffff', accent_color: '#FF4D6D', font_size: 26
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
  const [autoMode, setAutoMode] = useState(false)
  const [teleprompterMode, setTeleprompterMode] = useState(true)
  const [offset, setOffset] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSetlist, setShowSetlist] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef<number>(0)
  const saveThemeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const userTouchingRef = useRef(false)

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

  useEffect(() => {
    const song = songs[songIdx]?.song
    if (!song) return
    setLineIdx(0); setElapsed(0); stopTimer(); setPlaying(false)
    if (song.has_sync) {
      supabase.from('lyric_syncs').select('lines').eq('song_id', song.id).single()
        .then(({ data }) => setSyncLines(data?.lines as LyricLine[] ?? null))
    } else {
      setSyncLines(null)
    }
  }, [songIdx, songs])

  // Teleprompter auto-scroll — only when mode is on and user isn't touching
  useEffect(() => {
    if (syncLines || !teleprompterMode || userTouchingRef.current) return
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [lineIdx, syncLines, teleprompterMode])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); retreat() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (songIdx > 0) setSongIdx(s => s - 1) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (songIdx < songs.length - 1) setSongIdx(s => s + 1) }
      else if (e.key === 'Escape') navigate(`/setlist/${id}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [songIdx, lineIdx, songs.length, syncLines])

  function startTimer() {
    startRef.current = Date.now() - elapsed * 1000
    timerRef.current = setInterval(() => {
      const secs = (Date.now() - startRef.current) / 1000
      setElapsed(secs)
      if (syncLines) {
        const ms = (secs + offset) * 1000
        let idx = 0
        for (let i = 0; i < syncLines.length; i++) {
          if (syncLines[i].time_ms <= ms) idx = i
        }
        setLineIdx(idx)
      }
    }, 100)
    setPlaying(true)
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current)
    setPlaying(false)
  }

  function togglePlay() { playing ? stopTimer() : startTimer() }

  function updateTheme(patch: Partial<ConcertTheme>) {
    const next = { ...theme, ...patch }
    setTheme(next)
    if (saveThemeTimer.current) clearTimeout(saveThemeTimer.current)
    saveThemeTimer.current = setTimeout(() => {
      if (user) supabase.from('profiles').update({ concert_theme: next }).eq('id', user.id)
    }, 1500)
  }

  // Swipe detection — 75% horizontal threshold to change song
  function handleTouchStart(e: React.TouchEvent) {
    userTouchingRef.current = true
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartRef.current) {
      const t = e.changedTouches[0]
      const dx = t.clientX - touchStartRef.current.x
      const dy = t.clientY - touchStartRef.current.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const total = absDx + absDy
      if (total > 60 && absDx / total >= 0.75) {
        if (dx < 0 && songIdx < songs.length - 1) setSongIdx(s => s + 1)
        else if (dx > 0 && songIdx > 0) setSongIdx(s => s - 1)
      }
      touchStartRef.current = null
    }
    // Give scroll deceleration time to settle before re-enabling teleprompter
    setTimeout(() => { userTouchingRef.current = false }, 350)
  }

  const currentRow = songs[songIdx]
  const currentSong = currentRow?.song
  const plainLines = (currentSong?.edited_lyrics ?? currentSong?.lyrics ?? '').split('\n')
  const lines = syncLines ? syncLines.map(l => l.text) : plainLines
  const duration = currentSong?.duration_sec ?? 0
  const progress = duration ? Math.min(elapsed / duration, 1) : 0
  const displayKey = currentRow?.performance_key ?? currentSong?.performance_key ?? currentSong?.original_key

  function advance() {
    if (lineIdx < lines.length - 1) setLineIdx(l => l + 1)
    else if (songIdx < songs.length - 1) setSongIdx(s => s + 1)
  }
  function retreat() {
    if (lineIdx > 0) setLineIdx(l => l - 1)
    else if (songIdx > 0) setSongIdx(s => s - 1)
  }

  const visibleStart = Math.max(0, lineIdx - 2)
  const visibleLines = lines.slice(visibleStart, visibleStart + 8)
  const prevSong = songs[songIdx - 1]?.song
  const nextSong = songs[songIdx + 1]?.song

  return (
    <div className={styles.page} style={{ background: theme.bg }}>

      {/* ── Compact header ── */}
      <div className={styles.header}>
        <button className={styles.exitBtn} onClick={() => navigate(`/setlist/${id}`)}>✕</button>
        <span className={styles.counter} style={{ color: theme.accent_color }}>
          {songIdx + 1} / {songs.length}
        </span>
        <div className={styles.headerRight}>
          {!syncLines && (
            <button
              className={styles.modeBtn}
              style={{ color: teleprompterMode ? theme.accent_color : 'rgba(255,255,255,0.25)' }}
              title="Auto-scroll"
              onClick={() => setTeleprompterMode(m => !m)}
            >↕</button>
          )}
          {syncLines && (
            <button
              className={styles.modeBtn}
              style={{ color: autoMode ? theme.accent_color : 'rgba(255,255,255,0.3)' }}
              onClick={() => { setAutoMode(m => !m); if (!autoMode) startTimer() }}
            >{autoMode ? '⟳' : '✋'}</button>
          )}
          <button
            className={styles.modeBtn}
            style={{ color: showSetlist ? theme.accent_color : 'rgba(255,255,255,0.3)' }}
            onClick={() => setShowSetlist(s => !s)}
          >≡</button>
          <button
            className={styles.modeBtn}
            style={{ color: showSettings ? theme.accent_color : 'rgba(255,255,255,0.3)' }}
            onClick={() => setShowSettings(s => !s)}
          >⚙</button>
        </div>
      </div>

      {/* ── Song name above lyrics ── */}
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

      {/* ── Progress bar (sync only) ── */}
      {duration > 0 && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBg}>
            <div className={styles.progressFill} style={{ width: `${progress * 100}%`, background: theme.accent_color }} />
          </div>
          <div className={styles.progressLabels} style={{ color: theme.active_color }}>
            <span>{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</span>
            <span>{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}</span>
          </div>
        </div>
      )}

      {/* ── Notes banner ── */}
      {currentRow?.notes && (
        <div className={styles.notesBanner} style={{ borderColor: theme.accent_color + '40', color: theme.active_color, opacity: 0.6 }}>
          {currentRow.notes}
        </div>
      )}

      {/* ── Lyrics ── */}
      {!syncLines ? (
        <div
          className={styles.lyricsScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {lines.length === 0 ? (
            <div className={styles.emptyLyrics} style={{ color: theme.active_color, opacity: 0.25 }}>
              Sem letra disponível
            </div>
          ) : lines.map((line, i) => (
            <div
              key={i}
              ref={i === lineIdx ? activeLineRef : null}
              className={styles.lyricLineManual}
              style={{
                color: theme.active_color,
                fontSize: theme.font_size * 0.88,
                fontWeight: i === lineIdx ? 800 : 400,
                opacity: i < lineIdx ? 0.3 : 1,
                borderLeftColor: i === lineIdx ? theme.accent_color : 'transparent',
              }}
              onClick={() => setLineIdx(i)}
            >
              {line || ' '}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.lyricsArea} onClick={advance}>
          {visibleLines.map((line, i) => {
            const absIdx = visibleStart + i
            const isActive = absIdx === lineIdx
            const isPast = absIdx < lineIdx
            return (
              <div
                key={absIdx}
                className={styles.lyricLine}
                style={{
                  color: theme.active_color,
                  fontSize: isActive ? theme.font_size : theme.font_size * 0.72,
                  opacity: isActive ? 1 : isPast ? 0.2 : 0.4,
                  fontWeight: isActive ? 800 : 600,
                }}
              >
                {line || ' '}
              </div>
            )
          })}
          {lines.length === 0 && (
            <div className={styles.emptyLyrics} style={{ color: theme.active_color, opacity: 0.25 }}>
              Sem letra disponível
            </div>
          )}
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

        {autoMode && (
          <button className={styles.playBtn} style={{ background: theme.accent_color }} onClick={togglePlay}>
            {playing ? '⏸' : '▶'}
          </button>
        )}

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

      {autoMode && (
        <div className={styles.offsetRow}>
          <span style={{ color: theme.active_color, opacity: 0.3, fontSize: 11 }}>offset</span>
          <button className={styles.offsetBtn} style={{ color: theme.active_color, opacity: 0.4 }} onClick={() => setOffset(o => o - 0.5)}>−</button>
          <span style={{ color: theme.active_color, opacity: 0.5, fontSize: 12, fontWeight: 700 }}>{offset.toFixed(1)}s</span>
          <button className={styles.offsetBtn} style={{ color: theme.active_color, opacity: 0.4 }} onClick={() => setOffset(o => o + 0.5)}>+</button>
        </div>
      )}

      {/* ── Settings panel ── */}
      {showSettings && (
        <div className={styles.settingsPanel} style={{ background: theme.bg, borderColor: 'rgba(255,255,255,0.1)' }}>
          <div className={styles.settingsRow}>
            <span style={{ color: theme.active_color, opacity: 0.5, fontSize: 12 }}>Tamanho</span>
            <div className={styles.settingsControls}>
              <button className={styles.settingBtn} style={{ color: theme.active_color }} onClick={() => updateTheme({ font_size: Math.max(16, theme.font_size - 2) })}>A−</button>
              <span style={{ color: theme.active_color, fontSize: 12, fontWeight: 700, minWidth: 30, textAlign: 'center' }}>{theme.font_size}</span>
              <button className={styles.settingBtn} style={{ color: theme.active_color }} onClick={() => updateTheme({ font_size: Math.min(52, theme.font_size + 2) })}>A+</button>
            </div>
          </div>
          <div className={styles.settingsRow}>
            <span style={{ color: theme.active_color, opacity: 0.5, fontSize: 12 }}>Cor destaque</span>
            <div className={styles.colorRow}>
              {['#FF4D6D','#7C3AED','#2563EB','#059669','#D97706','#ffffff'].map(c => (
                <button
                  key={c}
                  className={styles.colorDot}
                  style={{ background: c, outline: theme.accent_color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
                  onClick={() => updateTheme({ accent_color: c })}
                />
              ))}
            </div>
          </div>
        </div>
      )}

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
