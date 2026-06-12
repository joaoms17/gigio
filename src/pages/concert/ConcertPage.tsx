import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { transposeChordsText } from '../../lib/transpose'
import {
  cacheSetlistSongs, getCachedSetlistSongs,
  cacheSyncLines, getCachedSyncLines,
  cacheTheme, getCachedTheme,
} from '../../lib/concertCache'
import AnnotatedLyrics from '../../components/AnnotatedLyrics'
import { loadAnnotations, pullAnnotations } from '../../components/AnnotationLayer'
import type { SetlistSong, Song, ConcertTheme, LyricLine } from '../../types'
import styles from './ConcertPage.module.css'

const DEFAULT_THEME: ConcertTheme = {
  bg: '#0d0d0d', active_color: '#ffffff', accent_color: '#FF4D6D', font_size: 32, line_height: 1.6
}

type Row = SetlistSong & { song: Song }
type ContentView = 'lyrics' | 'chords' | 'annotations'

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

  useEffect(() => { syncLinesRef.current = syncLines }, [syncLines])

  // ── Load (with offline cache fallback) ──────────────────────────────────
  useEffect(() => {
    if (!id || !user) return
    let wakeLock: any = null
    navigator.wakeLock?.request('screen').then(wl => { wakeLock = wl }).catch(() => {})
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
    supabase.from('profiles').select('concert_theme').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.concert_theme) {
          setTheme(data.concert_theme as ConcertTheme)
          cacheTheme(data.concert_theme)
        } else {
          const cached = getCachedTheme<ConcertTheme>()
          if (cached) setTheme(cached)
        }
      })
    return () => { wakeLock?.release(); stopTimer() }
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

  // ── Reorder inside concert (setlist panel ↑↓) ───────────────────────────
  async function moveSong(from: number, to: number) {
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
    if (id) cacheSetlistSongs(id, next)
    // Persist (two-phase to dodge unique constraints)
    await Promise.all(next.map((ss, i) => supabase.from('setlist_songs').update({ position: 10000 + i }).eq('id', ss.id)))
    await Promise.all(next.map((ss, i) => supabase.from('setlist_songs').update({ position: i }).eq('id', ss.id)))
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRow  = songs[songIdx]
  const currentSong = currentRow?.song
  const plainLines  = (currentSong?.edited_lyrics ?? currentSong?.lyrics ?? '').split('\n')
  const lines       = syncLines ? syncLines.map(l => l.text) : plainLines
  const prevSong    = songs[songIdx - 1]?.song
  const nextSong    = songs[songIdx + 1]?.song
  const displayKey  = currentRow?.performance_key ?? currentSong?.performance_key ?? currentSong?.original_key

  // Chords (transposed to the display key when both keys are known)
  const rawChords = currentSong?.chords ?? ''
  const chordsText = (rawChords && displayKey && currentSong?.original_key && displayKey !== currentSong.original_key)
    ? transposeChordsText(rawChords, currentSong.original_key, displayKey)
    : rawChords
  const chordsTransposed = chordsText !== rawChords

  const hasAnnotations = annAvailable
  const bpm = currentSong?.bpm ?? null

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

  return (
    <div className={styles.page} style={{ background: theme.bg }}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <button className={styles.exitBtn} title="Sair do concerto" onClick={() => navigate(`/setlist/${id}`)}>✕</button>
        <span className={styles.counter} style={{ color: theme.accent_color }}>
          {songIdx + 1} / {songs.length}
        </span>
        <div className={styles.headerRight}>
          {bpm && (
            <button
              className={styles.modeBtn}
              style={{ color: metronomeOn ? theme.accent_color : 'rgba(255,255,255,0.3)' }}
              onClick={() => setMetronomeOn(m => !m)}
              title={`Metrónomo visual — ${bpm} bpm`}
            >
              {metronomeOn
                ? <span className={styles.metroDot} style={{ background: theme.accent_color, animationDuration: `${60 / bpm}s` }} />
                : '◉'}
            </button>
          )}
          {rawChords && (
            <button
              className={styles.modeBtn}
              style={{ color: contentView === 'chords' ? theme.accent_color : 'rgba(255,255,255,0.3)' }}
              onClick={() => setContentView(v => v === 'chords' ? 'lyrics' : 'chords')}
              title="Acordes"
            >♩</button>
          )}
          {hasAnnotations && (
            <button
              className={styles.modeBtn}
              style={{ color: contentView === 'annotations' ? theme.accent_color : 'rgba(255,255,255,0.3)' }}
              onClick={() => setContentView(v => v === 'annotations' ? 'lyrics' : 'annotations')}
              title="Anotações de ensaio"
            >✏</button>
          )}
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

      {/* ── Intro / notes / ending banners ── */}
      {(currentRow?.custom_intro || currentRow?.notes || currentRow?.custom_ending) && (
        <div className={styles.bannerStack}>
          {currentRow?.custom_intro && (
            <div className={styles.notesBanner} style={{ borderColor: theme.accent_color + '70', color: theme.accent_color }}>
              ▶ Intro: {currentRow.custom_intro}
            </div>
          )}
          {currentRow?.notes && (
            <div className={styles.notesBanner} style={{ borderColor: theme.accent_color + '40', color: theme.active_color, opacity: 0.6 }}>
              {currentRow.notes}
            </div>
          )}
          {currentRow?.custom_ending && (
            <div className={styles.notesBanner} style={{ borderColor: theme.accent_color + '40', color: theme.active_color, opacity: 0.55 }}>
              ■ Final: {currentRow.custom_ending}
            </div>
          )}
        </div>
      )}

      {/* ── Chords view ── */}
      {contentView === 'chords' ? (
        <div className={styles.lyricsScroll} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {chordsTransposed && (
            <div className={styles.transposeNote} style={{ color: theme.accent_color }}>
              transposto {currentSong?.original_key} → {displayKey}
            </div>
          )}
          <pre className={styles.chordsPre} style={{ color: theme.active_color }}>
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
              />
            )}
          </div>
          <div style={{ height: '30vh' }} />
        </div>
      ) : viewMode === 'semi' ? (
        <div
          ref={lyricsScrollRef}
          className={styles.lyricsScroll}
          style={{ ['--lyric-size' as any]: `${displayFontSize}px` }}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div style={{ height: '40vh', flexShrink: 0 }} />
          {lines.length === 0 ? (
            <div className={styles.emptyLyrics} style={{ color: theme.active_color, opacity: 0.25 }}>
              Sem letra disponível
            </div>
          ) : lines.map((line, i) => line.trim() === '' ? (
            <div key={i} style={{ height: `${displayFontSize * displayLineHeight * 1.8}px`, flexShrink: 0 }} />
          ) : (
            <div
              key={i}
              ref={i === lineIdx ? activeLineRef : null}
              className={styles.lyricLineManual}
              style={{
                color: theme.active_color,
                lineHeight: displayLineHeight,
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
          style={{ ['--lyric-size' as any]: `${displayFontSize}px` }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div style={{ height: '40vh', flexShrink: 0 }} />
          {lines.length === 0 ? (
            <div className={styles.emptyLyrics} style={{ color: theme.active_color, opacity: 0.25 }}>
              Sem letra disponível
            </div>
          ) : lines.map((line, i) => line.trim() === '' ? (
            <div key={i} style={{ height: `${displayFontSize * displayLineHeight * 1.8}px`, flexShrink: 0 }} />
          ) : (
            <div
              key={i}
              className={styles.lyricLineManual}
              style={{
                color: theme.active_color,
                lineHeight: displayLineHeight,
                fontWeight: 400,
                opacity: 1,
              }}
            >
              {line}
            </div>
          ))}
          <div style={{ height: '50vh' }} />
        </div>
      )}

      {/* ── Re-sync button ── */}
      {contentView !== 'chords' && viewMode === 'semi' && !scrollFollowing && (
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
      {contentView !== 'chords' && viewMode === 'semi' && syncLines && (
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
            {playing ? <span className={styles.pauseIcon} /> : '▶'}
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
            <div
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
              <span className={styles.reorderBtns} onClick={e => e.stopPropagation()}>
                <button
                  className={styles.reorderBtn}
                  style={{ color: 'inherit', opacity: i === 0 ? 0.2 : 0.7 }}
                  disabled={i === 0}
                  onClick={() => moveSong(i, i - 1)}
                >▲</button>
                <button
                  className={styles.reorderBtn}
                  style={{ color: 'inherit', opacity: i === songs.length - 1 ? 0.2 : 0.7 }}
                  disabled={i === songs.length - 1}
                  onClick={() => moveSong(i, i + 1)}
                >▼</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
