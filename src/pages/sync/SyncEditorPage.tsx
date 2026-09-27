import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
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

/** Numeração de setlist: 01, 02… */
function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/* ── Ícones SVG inline (stroke, currentColor) ── */
const ICON_PROPS = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

type IconProps = { size?: number }

function IconArrowLeft({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M19 12H5" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function IconCheck({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <polyline points="4 12 9 17 20 6" />
    </svg>
  )
}

function IconPlay({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS} fill="currentColor">
      <polygon points="7 4 20 12 7 20 7 4" />
    </svg>
  )
}

function IconPause({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS} fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="0.5" />
      <rect x="14" y="5" width="4" height="14" rx="0.5" />
    </svg>
  )
}

function IconChevronsLeft({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  )
}

function IconChevronsRight({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  )
}

function IconChevronLeft({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function IconChevronRight({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function IconArrowUp({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M12 19V5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function IconArrowDown({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M12 5v14" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  )
}

function IconUndo({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  )
}

function IconFolder({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

function IconUpload({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M12 15V3" />
      <polyline points="7 8 12 3 17 8" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  )
}

function IconLyrics({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M4 6h16" />
      <path d="M4 12h12" />
      <path d="M4 18h8" />
    </svg>
  )
}

interface SyncLine { text: string; time_ms: number | null }

export default function SyncEditorPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const confirm = useConfirm()
  const toast = useToast()

  const [song, setSong] = useState<{ title: string; artist: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<SyncLine[]>([])
  const [cursor, setCursor] = useState(0)
  // Draft while typing in a time input; committed on blur/Enter
  const [timeDraft, setTimeDraft] = useState<{ i: number; val: string } | null>(null)
  // Unsaved changes to any line time
  const [dirty, setDirty] = useState(false)
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
        if (!data) { setLoading(false); return }
        setSong({ title: data.title, artist: data.artist })
        const rawLines = (data.lyrics ?? '').split('\n').filter((l: string) => l.trim())
        supabase.from('lyric_syncs').select('lines').eq('song_id', id).maybeSingle()
          .then(({ data: sync }) => {
            const existing = (sync?.lines ?? []) as LyricLine[]
            setLines(rawLines.map((text: string, i: number) => ({
              text,
              time_ms: existing[i]?.time_ms ?? null,
            })))
            setLoading(false)
          })
      })
  }, [id, user])

  useEffect(() => {
    // Enquanto se edita um input de tempo o scroll automático deslocava a
    // lista debaixo do dedo — só centrar quando a linha muda por tap/▶/setas
    if (document.activeElement instanceof HTMLInputElement) return
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
    setDirty(true)
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
    setDirty(true)
    setCursor(idx)
  }

  /** Commit the typed time (blur/Enter) — while typing, the draft is kept as-is. */
  function commitTime(i: number, val: string) {
    setTimeDraft(null)
    const ms = val.trim() === '' ? null : parseTimeStr(val)
    if (ms === linesRef.current[i]?.time_ms) return
    setLines(prev => { const n = [...prev]; n[i] = { ...n[i], time_ms: ms }; return n })
    setDirty(true)
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
    const { error: syncError } = await supabase
      .from('lyric_syncs')
      .upsert({ song_id: id, lines: syncLines }, { onConflict: 'song_id' })
    if (syncError) {
      setSaving(false)
      toast('Erro ao guardar a sincronização: ' + syncError.message, { type: 'error' })
      return
    }
    const { error: songError } = await supabase
      .from('songs')
      .update({ has_sync: syncLines.length > 0 })
      .eq('id', id)
    setSaving(false)
    if (songError) {
      toast('Erro ao guardar a sincronização: ' + songError.message, { type: 'error' })
      return
    }
    setDirty(false)
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 2000)
  }

  async function goBack() {
    if (dirty) {
      const ok = await confirm({
        title: 'Alterações por guardar',
        message: 'Tens tempos de sincronização por guardar. Se saíres agora, essas alterações perdem-se.',
        confirmLabel: 'Sair sem guardar',
        cancelLabel: 'Ficar',
        danger: true,
      })
      if (!ok) return
    }
    navigate(backTo)
  }

  const tapped = lines.filter(l => l.time_ms !== null).length
  const backTo = searchParams.get('project')
    ? `/songs/${id}?project=${searchParams.get('project')}`
    : `/songs/${id}`

  const progressPct = audioDur > 0 ? Math.min(100, (currentTime / audioDur) * 100) : 0

  return (
    <div className={styles.root}>
      {/* ── Header: voltar fantasma · título condensado · Guardar primário ── */}
      <header className={styles.topBar}>
        <div className={styles.bar}>
          <button type="button" className={styles.back} onClick={goBack} aria-label="Voltar à música">
            <IconArrowLeft />
            <span className={styles.backLabel}>Voltar</span>
          </button>
          <div className={styles.songInfo}>
            <div className={styles.kicker}>
              <span className={styles.kickerMode}>
                Sincronização<span className={styles.sep} aria-hidden="true">·</span>
              </span>
              <span className={styles.prog}>{pad2(tapped)}/{pad2(lines.length)} linhas</span>
              {dirty && (
                <span className={styles.dirtyTag}>
                  <span className={styles.dirtyLed} aria-hidden="true" />Por guardar
                </span>
              )}
            </div>
            <h1 className={styles.songTitle}>{song?.title ?? '...'}</h1>
            {song?.artist && <span className={styles.songArtist}>{song.artist}</span>}
          </div>
          <button
            type="button"
            className={`${styles.saveBtn} ${savedOk ? styles.saveBtnOk : ''}`}
            onClick={save}
            disabled={saving}
          >
            {saving ? 'A guardar...' : savedOk ? <><IconCheck /> Guardado</> : 'Guardar'}
          </button>
        </div>
      </header>

      {/* ── Deck: leitor de áudio ── */}
      <section className={styles.deck} aria-label="Leitor de áudio">
        {!audioUrl ? (
          <div className={styles.bar}>
            <label className={styles.uploadLabel}>
              <span className={styles.uploadIcon}><IconUpload /></span>
              <span className={styles.uploadText}>
                <span className={styles.uploadTitle}>Carregar áudio</span>
                <span className={styles.uploadFormats}>MP3 · M4A · WAV · OGG</span>
              </span>
              <span className={styles.uploadCta} aria-hidden="true">Escolher ficheiro</span>
              <input type="file" accept="audio/*" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioFile(f) }} />
            </label>
          </div>
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
            <div className={`${styles.bar} ${styles.deckGrid}`}>
              {/* Transporte — botões-tecla */}
              <div className={styles.transport}>
                <button type="button" className={styles.key} onClick={() => seek(-10)} aria-label="Recuar 10 segundos">
                  <IconChevronsLeft />
                  <span className={styles.keyLabel}>10s</span>
                </button>
                <button type="button" className={styles.key} onClick={() => seek(-5)} aria-label="Recuar 5 segundos">
                  <IconChevronLeft />
                  <span className={styles.keyLabel}>5s</span>
                </button>
                <button
                  type="button"
                  className={`${styles.key} ${styles.playKey} ${playing ? styles.playKeyOn : ''}`}
                  onClick={togglePlay}
                  aria-label={playing ? 'Pausa' : 'Reproduzir'}
                >
                  <span className={styles.playLed} aria-hidden="true" />
                  {playing ? <IconPause /> : <IconPlay />}
                </button>
                <button type="button" className={styles.key} onClick={() => seek(5)} aria-label="Avançar 5 segundos">
                  <span className={styles.keyLabel}>5s</span>
                  <IconChevronRight />
                </button>
                <button type="button" className={styles.key} onClick={() => seek(10)} aria-label="Avançar 10 segundos">
                  <span className={styles.keyLabel}>10s</span>
                  <IconChevronsRight />
                </button>
              </div>

              {/* Contador + scrubber (trilho fino + fader) */}
              <span className={styles.timeLabel} aria-label="Tempo atual">{msToStr(currentTime * 1000)}</span>
              <div className={`${styles.scrubWrap} ${playing ? styles.scrubPlaying : ''}`}>
                <div className={styles.scrubTrack} aria-hidden="true">
                  <div className={styles.scrubFill} style={{ width: `${progressPct}%` }} />
                </div>
                <input className={styles.scrubber} type="range"
                  min={0} max={audioDur || 100} step={0.05} value={currentTime}
                  aria-label="Posição no áudio"
                  onChange={e => {
                    const t = parseFloat(e.target.value)
                    if (audioRef.current) audioRef.current.currentTime = t
                    setCurrentTime(t)
                  }}
                />
              </div>
              <span className={styles.durLabel} aria-label="Duração">{msToStr(audioDur * 1000)}</span>

              {/* Velocidade — segmented mono */}
              <div className={styles.speedGroup} role="group" aria-label="Velocidade de reprodução">
                {[0.5, 0.75, 1].map(s => (
                  <button key={s}
                    type="button"
                    className={`${styles.speedBtn} ${speed === s ? styles.speedActive : ''}`}
                    aria-pressed={speed === s}
                    onClick={() => { setSpeed(s); if (audioRef.current) audioRef.current.playbackRate = s }}
                  >{s}×</button>
                ))}
              </div>

              <label className={styles.changeAudio} title="Mudar ficheiro" aria-label="Mudar ficheiro de áudio">
                <IconFolder />
                <input type="file" accept="audio/*" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioFile(f) }} />
              </label>
            </div>
          </>
        )}
      </section>

      {/* ── TAP ── */}
      {audioUrl && (
        <div className={styles.tapDeck}>
          <div className={`${styles.bar} ${styles.tapRow}`}>
            <button type="button" className={styles.lineNavBtn}
              onClick={() => setCursor(c => Math.max(0, c - 1))}
              disabled={cursor === 0}
              aria-label="Linha anterior"
            >
              <IconArrowUp />
              <span className={styles.lineNavLabel}>Anterior</span>
            </button>
            <button type="button" className={styles.tapBtn} onClick={tap}>
              <span className={styles.tapLabel}>TAP</span>
              <span className={styles.tapSub}>
                Linha {pad2(cursor + 1)}<span className={styles.spaceHint}> · Espaço</span>
              </span>
            </button>
            <button type="button" className={styles.lineNavBtn}
              onClick={() => setCursor(c => Math.min(lines.length - 1, c + 1))}
              disabled={cursor >= lines.length - 1}
              aria-label="Próxima linha"
            >
              <span className={styles.lineNavLabel}>Próxima</span>
              <IconArrowDown />
            </button>
            <button type="button" className={styles.undoBtn} onClick={undoLast} title="Desfazer" aria-label="Desfazer última marcação de tempo">
              <IconUndo />
            </button>
          </div>
          <div className={`${styles.bar} ${styles.kbdHints}`}>
            <span><kbd className={styles.kbd}>Espaço</kbd> TAP</span>
            <span><kbd className={styles.kbd}>P</kbd> Play</span>
            <span><kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> Linha</span>
            <span><kbd className={styles.kbd}>←</kbd><kbd className={styles.kbd}>→</kbd> ±5s</span>
          </div>
        </div>
      )}

      {/* ── Linhas da letra ── */}
      <div className={styles.linesList}>
        {/* A coluna do ▶ (ouvir a partir da linha) só existe com áudio carregado */}
        <div className={`${styles.linesInner} ${audioUrl ? styles.linesWithAudio : ''}`}>
          {lines.length > 0 && (
            <div className={styles.listHead}>
              <span className={styles.listHeadLabel}>
                Letra<span className={styles.sep} aria-hidden="true">·</span>
                {lines.length} {lines.length === 1 ? 'linha' : 'linhas'}
              </span>
              <span className={styles.listHeadTime}>Tempo</span>
            </div>
          )}
          {lines.map((line, i) => {
            const done = line.time_ms !== null
            const trimmed = line.text.trim()
            // [Verso 1] / [Refrão] → rótulo de secção mono
            const isSection = /^\[.+\]$/.test(trimmed)
            return (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el }}
              className={[
                styles.lineRow,
                i === cursor ? styles.lineActive : '',
                done ? styles.lineDone : '',
                isSection ? styles.lineSection : '',
              ].join(' ')}
              onClick={() => setCursor(i)}
            >
              <span className={styles.lineNum}>
                {pad2(i + 1)}
                {/* LED de estado: cheio = sincronizada, vazio = por marcar */}
                <span className={styles.syncLed} aria-hidden="true" />
              </span>
              <span className={styles.lineText}>{isSection ? trimmed.slice(1, -1) : line.text}</span>
              <input
                className={styles.timeInput}
                value={timeDraft?.i === i ? timeDraft.val : line.time_ms !== null ? msToStr(line.time_ms) : ''}
                placeholder="—:——"
                aria-label={`Tempo da linha ${i + 1}`}
                onChange={e => setTimeDraft({ i, val: e.target.value })}
                onBlur={e => commitTime(i, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                onFocus={() => setCursor(i)}
                onClick={e => e.stopPropagation()}
              />
              {done && audioUrl && (
                <button
                  type="button"
                  className={styles.jumpBtn}
                  onClick={e => { e.stopPropagation(); jumpTo(line.time_ms!) }}
                  aria-label={`Ouvir a partir da linha ${i + 1}`}
                >
                  <IconPlay size={14} />
                </button>
              )}
            </div>
            )
          })}
          {loading && lines.length === 0 && (
            <div className={styles.skeletonList} aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={`skeleton ${styles.skeletonLine}`} />
              ))}
            </div>
          )}
          {!loading && lines.length === 0 && (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}><IconLyrics /></span>
              <h2 className={styles.emptyTitle}>Sem letra para sincronizar</h2>
              <p className={styles.emptyText}>Esta música não tem letra guardada ainda.</p>
              <button type="button" className={styles.emptyBtn} onClick={goBack}>
                <IconArrowLeft size={18} /> Voltar à música
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
