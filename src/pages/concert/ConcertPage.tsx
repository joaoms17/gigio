import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { SetlistSong, Song, ConcertTheme, LyricLine } from '../../types'
import styles from './ConcertPage.module.css'

const DEFAULT_THEME: ConcertTheme = {
  bg: '#0d0d0d', active_color: '#ffffff', accent_color: '#FF4D6D', font_size: 26
}

export default function ConcertPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [songs, setSongs] = useState<(SetlistSong & { song: Song })[]>([])
  const [songIdx, setSongIdx] = useState(0)
  const [lineIdx, setLineIdx] = useState(0)
  const [theme, setTheme] = useState<ConcertTheme>(DEFAULT_THEME)
  const [syncLines, setSyncLines] = useState<LyricLine[] | null>(null)
  const [autoMode, setAutoMode] = useState(false)
  const [offset, setOffset] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef<number>(0)

  useEffect(() => {
    if (!id || !user) return
    // keep screen awake
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

  const currentSong = songs[songIdx]?.song
  const plainLines = currentSong?.lyrics?.split('\n') ?? []
  const lines = syncLines ? syncLines.map(l => l.text) : plainLines
  const duration = currentSong?.duration_sec ?? 0
  const progress = duration ? Math.min(elapsed / duration, 1) : 0

  function advance() {
    if (lineIdx < lines.length - 1) setLineIdx(l => l + 1)
    else if (songIdx < songs.length - 1) { setSongIdx(s => s + 1) }
  }
  function retreat() {
    if (lineIdx > 0) setLineIdx(l => l - 1)
    else if (songIdx > 0) setSongIdx(s => s - 1)
  }

  const visibleStart = Math.max(0, lineIdx - 2)
  const visibleLines = lines.slice(visibleStart, visibleStart + 8)

  return (
    <div className={styles.page} style={{ background: theme.bg }}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.exitBtn} onClick={() => navigate(`/setlist/${id}`)}>✕</button>
        <div className={styles.songName} style={{ color: theme.accent_color }}>
          {currentSong?.title} — {currentSong?.artist}
        </div>
        <div className={styles.headerRight}>
          {syncLines && (
            <button
              className={styles.modeBtn}
              style={{ color: autoMode ? theme.accent_color : undefined }}
              onClick={() => { setAutoMode(m => !m); if (!autoMode) startTimer() }}
            >
              {autoMode ? '⟳ auto' : '✋ manual'}
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className={styles.progressWrap}>
        <div className={styles.progressBg}>
          <div className={styles.progressFill} style={{ width: `${progress * 100}%`, background: theme.accent_color }} />
        </div>
        <div className={styles.progressLabels}>
          <span>{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</span>
          <span>{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}</span>
        </div>
      </div>

      {/* Lyrics */}
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
                color: isActive ? theme.active_color : theme.active_color,
                fontSize: isActive ? theme.font_size : theme.font_size * 0.72,
                opacity: isActive ? 1 : isPast ? 0.25 : 0.45,
                fontWeight: isActive ? 800 : 600,
              }}
            >
              {line || ' '}
            </div>
          )
        })}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <button className={styles.navBtn} style={{ color: theme.active_color, opacity: 0.5 }} onClick={retreat}>← Anterior</button>
        {autoMode && (
          <button className={styles.playBtn} style={{ background: theme.accent_color }} onClick={togglePlay}>
            {playing ? '⏸' : '▶'}
          </button>
        )}
        <button className={styles.navBtn} style={{ color: theme.active_color, opacity: 0.7 }} onClick={advance}>Próxima →</button>
      </div>

      {autoMode && (
        <div className={styles.offsetRow}>
          <span style={{ color: theme.active_color, opacity: 0.3, fontSize: 11 }}>offset</span>
          <button className={styles.offsetBtn} style={{ color: theme.active_color, opacity: 0.4 }} onClick={() => setOffset(o => o - 0.5)}>−</button>
          <span style={{ color: theme.active_color, opacity: 0.5, fontSize: 12, fontWeight: 700 }}>{offset.toFixed(1)}s</span>
          <button className={styles.offsetBtn} style={{ color: theme.active_color, opacity: 0.4 }} onClick={() => setOffset(o => o + 0.5)}>+</button>
        </div>
      )}

      {/* Setlist sidebar */}
      <div className={styles.setlistBar}>
        {songs.map((ss, i) => (
          <button
            key={ss.id}
            className={styles.setlistItem}
            style={{
              background: i === songIdx ? theme.accent_color : 'transparent',
              color: i === songIdx ? '#fff' : i < songIdx ? theme.active_color : theme.active_color,
              opacity: i < songIdx ? 0.3 : 1,
            }}
            onClick={() => setSongIdx(i)}
          >
            {i + 1}. {ss.song?.title}
          </button>
        ))}
      </div>
    </div>
  )
}
