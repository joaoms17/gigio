import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { LyricLine } from '../../types'
import styles from './SyncEditorPage.module.css'

function msToStr(ms: number): string {
  const s = ms / 1000
  const min = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2)
  return `${min}:${sec.padStart(5, '0')}`
}

function parseTimeStr(val: string): number | null {
  const parts = val.split(':')
  if (parts.length === 2) {
    const min = parseInt(parts[0])
    const sec = parseFloat(parts[1])
    if (!isNaN(min) && !isNaN(sec)) return Math.round((min * 60 + sec) * 1000)
  } else {
    const sec = parseFloat(val)
    if (!isNaN(sec) && sec >= 0) return Math.round(sec * 1000)
  }
  return null
}

interface SyncLine { text: string; time_ms: number | null }

export default function SyncEditorPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [song, setSong] = useState<{ title: string; artist: string } | null>(null)
  const [lines, setLines] = useState<SyncLine[]>([])
  const [cursor, setCursor] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioDur, setAudioDur] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const linesRef = useRef<SyncLine[]>([])
  const cursorRef = useRef(0)

  // Keep refs in sync for use inside callbacks without stale closure
  useEffect(() => { linesRef.current = lines }, [lines])
  useEffect(() => { cursorRef.current = cursor }, [cursor])

  useEffect(() => {
    if (!id || !user) return
    supabase.from('songs').select('title, artist, lyrics').eq('id', id).single()
      .then(({ data }) => {
        if (!data) return
        setSong({ title: data.title, artist: data.artist })
        const rawLines = (data.lyrics ?? '').split('\n').filter((l: string) => l.trim())
        supabase.from('lyric_syncs').select('lines').eq('song_id', id).maybeSingle()
          .then(({ data: sync }) => {
            const existing = (sync?.lines ?? []) as LyricLine[]
            setLines(rawLines.map((text: string, i: number) => ({
              text,
              time_ms: existing[i]?.time_ms ?? null,
            })))
          })
      })
  }, [id, user])

  useEffect(() => {
    lineRefs.current[cursor]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [cursor])

  function handleAudioFile(file: File) {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(URL.createObjectURL(file))
    setCurrentTime(0)
    setPlaying(false)
  }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play()
    else a.pause()
  }

  function seek(delta: number) {
    const a = audioRef.current
    if (!a) return
    const t = Math.max(0, Math.min(a.duration || 0, a.currentTime + delta))
    a.currentTime = t
    setCurrentTime(t)
  }

  const tap = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    const ms = Math.round(a.currentTime * 1000)
    const cur = cursorRef.current
    const len = linesRef.current.length
    setLines(prev => {
      const next = [...prev]
      next[cur] = { ...next[cur], time_ms: ms }
      return next
    })
    setCursor(c => Math.min(c + 1, len - 1))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') { e.preventDefault(); tap() }
      if (e.code === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
      if (e.code === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(linesRef.current.length - 1, c + 1)) }
      if (e.code === 'KeyP') { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowLeft') { e.preventDefault(); seek(-5) }
      if (e.code === 'ArrowRight') { e.preventDefault(); seek(5) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tap])

  function undoLast() {
    const idx = [...lines].map((l, i) => ({ ...l, i })).filter(l => l.time_ms !== null).pop()?.i
    if (idx === undefined) return
    setLines(prev => { const n = [...prev]; n[idx] = { ...n[idx], time_ms: null }; return n })
    setCursor(idx)
  }

  function editTime(i: number, val: string) {
    const ms = parseTimeStr(val)
    setLines(prev => { const n = [...prev]; n[i] = { ...n[i], time_ms: ms }; return n })
  }

  function jumpTo(ms: number) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = ms / 1000
    setCurrentTime(ms / 1000)
  }

  async function save() {
    if (!id || !user) return
    setSaving(true)
    const syncLines: LyricLine[] = lines
      .filter(l => l.time_ms !== null)
      .map(l => ({ time_ms: l.time_ms!, text: l.text }))
    await supabase.from('lyric_syncs').upsert({ song_id: id, lines: syncLines }, { onConflict: 'song_id' })
    await supabase.from('songs').update({ has_sync: syncLines.length > 0 }).eq('id', id)
    setSaving(false)
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 2000)
  }

  const tapped = lines.filter(l => l.time_ms !== null).length
  const backTo = searchParams.get('project')
    ? `/songs/${id}?project=${searchParams.get('project')}`
    : `/songs/${id}`

  return (
    <div className={styles.root}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.back} onClick={() => navigate(backTo)}>← Voltar</button>
        <div className={styles.songInfo}>
          <span className={styles.songTitle}>{song?.title ?? '...'}</span>
          <span className={styles.songArtist}>{song?.artist}</span>
        </div>
        <div className={styles.topRight}>
          <span className={styles.prog}>{tapped}/{lines.length} linhas</span>
          <button
            className={`${styles.saveBtn} ${savedOk ? styles.saveBtnOk : ''}`}
            onClick={save} disabled={saving}
          >
            {saving ? 'A guardar...' : savedOk ? '✓ Guardado' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Audio player */}
      <div className={styles.playerBar}>
        {!audioUrl ? (
          <label className={styles.uploadLabel}>
            🎵 Carregar áudio (MP3, M4A, WAV, OGG)
            <input type="file" accept="audio/*" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioFile(f) }} />
          </label>
        ) : (
          <>
            <audio
              ref={audioRef}
              src={audioUrl}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setAudioDur(audioRef.current?.duration ?? 0)}
            />
            <button className={styles.playBtn} onClick={togglePlay}>
              {playing ? '⏸' : '▶'}
            </button>
            <button className={styles.seekBtn} onClick={() => seek(-5)} title="−5s (←)">−5s</button>
            <button className={styles.seekBtn} onClick={() => seek(5)} title="+5s (→)">+5s</button>
            <span className={styles.timeLabel}>{msToStr(currentTime * 1000)}</span>
            <input className={styles.scrubber} type="range"
              min={0} max={audioDur || 100} step={0.05} value={currentTime}
              onChange={e => {
                const t = parseFloat(e.target.value)
                if (audioRef.current) audioRef.current.currentTime = t
                setCurrentTime(t)
              }}
            />
            <span className={styles.durLabel}>{msToStr(audioDur * 1000)}</span>
            <div className={styles.speedGroup}>
              {[0.5, 0.75, 1].map(s => (
                <button key={s}
                  className={`${styles.speedBtn} ${speed === s ? styles.speedActive : ''}`}
                  onClick={() => { setSpeed(s); if (audioRef.current) audioRef.current.playbackRate = s }}
                >{s}×</button>
              ))}
            </div>
            <label className={styles.changeAudio} title="Mudar ficheiro">
              📂
              <input type="file" accept="audio/*" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioFile(f) }} />
            </label>
          </>
        )}
      </div>

      {/* Tap controls */}
      {audioUrl && (
        <div className={styles.tapRow}>
          <button className={styles.tapBtn} onClick={tap}>
            TAP
          </button>
          <div className={styles.tapCurrent}>
            {cursor < lines.length
              ? <><span className={styles.tapLineNum}>#{cursor + 1}</span> {lines[cursor]?.text}</>
              : '✓ Todas marcadas'}
          </div>
          <button className={styles.undoBtn} onClick={undoLast}>↩</button>
          <span className={styles.tapHint}>Espaço = tap · P = play · ← → = ±5s · ↑↓ = linha</span>
        </div>
      )}

      {/* Lines */}
      <div className={styles.linesList}>
        {lines.map((line, i) => (
          <div
            key={i}
            ref={el => { lineRefs.current[i] = el }}
            className={[
              styles.lineRow,
              i === cursor ? styles.lineActive : '',
              line.time_ms !== null ? styles.lineDone : '',
            ].join(' ')}
            onClick={() => setCursor(i)}
          >
            <span className={styles.lineNum}>{i + 1}</span>
            <span className={styles.lineText}>{line.text}</span>
            <input
              className={styles.timeInput}
              value={line.time_ms !== null ? msToStr(line.time_ms) : ''}
              placeholder="—"
              onChange={e => editTime(i, e.target.value)}
              onFocus={() => setCursor(i)}
              onClick={e => e.stopPropagation()}
            />
            {line.time_ms !== null && audioUrl && (
              <button className={styles.jumpBtn} onClick={e => { e.stopPropagation(); jumpTo(line.time_ms!) }}>
                ▶
              </button>
            )}
          </div>
        ))}
        {lines.length === 0 && (
          <div className={styles.empty}>Esta música não tem letra guardada ainda.</div>
        )}
      </div>
    </div>
  )
}
