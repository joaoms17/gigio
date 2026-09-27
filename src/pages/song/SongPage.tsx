import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import Breadcrumbs from '../../components/Breadcrumbs'
import LyricsView from '../../components/LyricsView'
import AnnotationLayer, { type AnnotationHandle } from '../../components/AnnotationLayer'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './SongPage.module.css'

/* Cores de anotação — são DADOS (ficam gravadas em cada traço), não tokens
   da interface. Legíveis sobre a folha clara (--surface) e, no tema escuro,
   a tinta passa a giz para não desaparecer no preto. */
const ANN_COLORS = [
  { id: 'red',    value: '#DC2626', label: 'Vermelho' },
  { id: 'blue',   value: '#2563EB', label: 'Azul' },
  { id: 'green',  value: '#16A34A', label: 'Verde' },
  { id: 'orange', value: '#F59E0B', label: 'Âmbar' },
  { id: 'dark',   value: '#111111', label: 'Tinta' },
]
// No tema escuro a tinta (#111) é invisível — troca-se por giz claro
const ANN_COLORS_DARK = ANN_COLORS.map(c =>
  c.id === 'dark' ? { ...c, value: '#F2F1EC', label: 'Giz' } : c
)
const ANN_WIDTHS = [
  { id: 'thin',   value: 2, label: 'Traço fino' },
  { id: 'mid',    value: 4, label: 'Traço médio' },
  { id: 'thick',  value: 8, label: 'Traço grosso' },
]

// Tamanho da letra no modo ensaio — A− / A+ na fita de ferramentas,
// persistido globalmente (a preferência do músico vale para todas as músicas)
const REHEARSAL_FONT_KEY = 'gigio-rehearsal-font-size'
const REHEARSAL_FONT_MIN = 22
const REHEARSAL_FONT_MAX = 56
const REHEARSAL_FONT_STEP = 4
const REHEARSAL_FONT_DEFAULT = 32

function loadRehearsalFont(): number {
  try {
    const v = parseInt(localStorage.getItem(REHEARSAL_FONT_KEY) ?? '', 10)
    if (Number.isFinite(v)) return Math.min(REHEARSAL_FONT_MAX, Math.max(REHEARSAL_FONT_MIN, v))
  } catch {}
  return REHEARSAL_FONT_DEFAULT
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

function IconPencil({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

/** Olho — modo Ensaio (ler a letra e anotar por cima) */
function IconEye({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconEditText({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M4 6h16" />
      <path d="M4 12h9" />
      <path d="M4 18h5" />
      <path d="M18 12l3 3-6 6h-3v-3l6-6z" />
    </svg>
  )
}

/** Forma de onda — sincronização letra/áudio */
function IconWave({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M3 10v4" />
      <path d="M7 6v12" />
      <path d="M11 3v18" />
      <path d="M15 8v8" />
      <path d="M19 5v14" />
      <path d="M23 10v4" />
    </svg>
  )
}

function IconUndo({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  )
}

function IconEraser({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M20 20H7L3 16l9-9 8 8-4 4z" />
      <path d="M6.5 17.5l-4-4" />
    </svg>
  )
}

function IconTrash({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  )
}

function IconScrollV({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M12 4v16" />
      <polyline points="8 8 12 4 16 8" />
      <polyline points="8 16 12 20 16 16" />
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

function IconX({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

function IconPlus({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function IconReset({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 10 9 10" />
    </svg>
  )
}

function IconArrowLeft({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M19 12H5" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function IconFileMissing({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON_PROPS}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
      <path d="M9.5 13.5l5 5" />
      <path d="M14.5 13.5l-5 5" />
    </svg>
  )
}

type Tab = 'lyrics' | 'chords' | 'details'

const TAB_LABELS: Record<Tab, string> = { lyrics: 'Letra', chords: 'Acordes', details: 'Detalhes' }

const TAG_SUGGESTIONS = [
  'Pop', 'Rock', 'Balada', 'Dançável', 'Entrada', 'Final',
  'Casamento', 'Cerimónia', 'Festa', 'Acústico', 'Português',
  'Inglês', 'Natal', 'Medley',
]

function durationLabel(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Accepts "3:45" or plain seconds ("225"); returns null when empty/invalid. */
function parseDuration(input: string): number | null {
  const t = input.trim()
  if (!t) return null
  const m = t.match(/^(\d+):([0-5]?\d)$/)
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2])
  const secs = parseInt(t)
  return Number.isFinite(secs) && secs > 0 ? secs : null
}

function clockLabel(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function SongPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const confirm = useConfirm()
  const toast = useToast()

  const projectId = searchParams.get('project')
  const setlistId = searchParams.get('setlist')

  const [concertHistory, setConcertHistory] = useState<{setlistName: string, date: string | null, venue: string | null}[]>([])
  const [song, setSong] = useState<Song | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [setlistName, setSetlistName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('lyrics')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  // 'editar' = text editor (default), 'ensaio' = view + annotate
  const [mode, setMode] = useState<'ensaio' | 'editar'>('editar')

  // Editable fields
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [chords, setChords] = useState('')
  const [performanceKey, setPerformanceKey] = useState('')
  const [originalKey, setOriginalKey] = useState('')
  const [bpm, setBpm] = useState('')
  const [duration, setDuration] = useState('')  // "m:ss" or plain seconds
  const [capo, setCapo] = useState('')
  const [tuning, setTuning] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [tagInput, setTagInput] = useState('')

  // Annotation state
  // Paleta consciente do tema (lida no render; a página remonta ao mudar de tema)
  const annPalette = document.documentElement.dataset.theme === 'dark' ? ANN_COLORS_DARK : ANN_COLORS
  const [annTool, setAnnTool] = useState<'pen' | 'eraser'>('pen')
  const [annColor, setAnnColor] = useState(ANN_COLORS[0].value)
  const [annWidth, setAnnWidth] = useState(ANN_WIDTHS[0].value)
  const [annClear, setAnnClear] = useState(0)
  const [annScrollMode, setAnnScrollMode] = useState(false)
  const annLayerRef = useRef<AnnotationHandle>(null)
  // Bloco da letra no ensaio — base de coordenadas das anotações (o
  // AnnotationLayer re-escala quando a altura/largura do texto muda)
  const lyricsContentRef = useRef<HTMLDivElement>(null)

  const [rehearsalFont, setRehearsalFont] = useState(loadRehearsalFont)
  const changeRehearsalFont = useCallback((delta: number) => {
    setRehearsalFont(v => {
      const next = Math.min(REHEARSAL_FONT_MAX, Math.max(REHEARSAL_FONT_MIN, v + delta))
      try { localStorage.setItem(REHEARSAL_FONT_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDirtyRef = useRef(false)
  // Always points at the latest save(): the debounce timer and the unmount
  // cleanup must not capture a stale closure (stale `song`/fields never save)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  // Conflict detection: updated_at as seen at load/last save
  const baseUpdatedAtRef = useRef<string | null>(null)
  // save() also runs from the unmount cleanup — the async confirm dialog
  // must not pop up (nor overwrite) after the page is gone
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!id || !user) return
    load()
  }, [id, user])

  useEffect(() => {
    if (!projectId) { setProjectName(null); return }
    supabase.from('bands').select('name').eq('id', projectId).single()
      .then(({ data }) => setProjectName(data?.name ?? null))
  }, [projectId])

  useEffect(() => {
    if (!setlistId) { setSetlistName(null); return }
    supabase.from('setlists').select('name').eq('id', setlistId).single()
      .then(({ data }) => setSetlistName(data?.name ?? null))
  }, [setlistId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('songs').select('*').eq('id', id).single()
    if (!data) { setLoading(false); return }
    const s = data as unknown as Song
    setSong(s)
    baseUpdatedAtRef.current = (s as any).updated_at ?? null
    supabase
      .from('setlist_songs')
      .select('setlist:setlists(name, date, venue)')
      .eq('song_id', s.id)
      .then(({ data: histData }) => {
        if (histData) {
          const history = histData
            .map((r: any) => r.setlist)
            .filter(Boolean)
            .sort((a: any, b: any) => (b.date ?? '').localeCompare(a.date ?? ''))
            .map((sl: any) => ({ setlistName: sl.name, date: sl.date, venue: sl.venue }))
          setConcertHistory(history)
        }
      })
    setTitle(s.title)
    setArtist(s.artist)
    setLyrics(s.edited_lyrics ?? s.lyrics ?? '')
    setChords(s.chords ?? '')
    setPerformanceKey(s.performance_key ?? '')
    setOriginalKey(s.original_key ?? '')
    setBpm(s.bpm ? String(s.bpm) : '')
    setDuration(s.duration_sec ? `${Math.floor(s.duration_sec / 60)}:${String(s.duration_sec % 60).padStart(2, '0')}` : '')
    setCapo(s.capo ? String(s.capo) : '')
    setTuning(s.tuning ?? '')
    setTags(s.tags ?? [])
    setNotes(s.notes ?? '')
    setLoading(false)
  }

  const scheduleSave = useCallback(() => {
    isDirtyRef.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveRef.current(), 2000)
  }, [])

  async function save() {
    if (!song || !user || !isDirtyRef.current) return

    // Conflict check: did someone else save since we loaded?
    const { data: remote } = await supabase
      .from('songs')
      .select('updated_at, updated_by')
      .eq('id', song.id)
      .single()
    if (
      remote?.updated_at &&
      baseUpdatedAtRef.current &&
      remote.updated_at !== baseUpdatedAtRef.current &&
      remote.updated_by !== user.id
    ) {
      // Página já desmontada (gravação de saída): nunca gravar por cima em conflito
      if (!mountedRef.current) return
      const overwrite = await confirm({
        title: 'Conflito de edição',
        message: 'Esta música foi alterada por outro membro enquanto editavas.',
        confirmLabel: 'Gravar por cima',
        danger: true,
      })
      if (!overwrite) return
    }

    isDirtyRef.current = false
    setSaving(true)
    const hasEdited = lyrics !== (song.original_lyrics ?? song.lyrics ?? '')
    const newUpdatedAt = new Date().toISOString()
    const { error } = await supabase.from('songs').update({
      title: title.trim(),
      artist: artist.trim(),
      lyrics: lyrics,
      edited_lyrics: lyrics,
      is_user_edited: hasEdited,
      chords: chords.trim() || null,
      performance_key: performanceKey.trim() || null,
      original_key: originalKey.trim() || null,
      bpm: bpm ? parseInt(bpm) : null,
      duration_sec: parseDuration(duration),
      capo: capo ? parseInt(capo) : null,
      tuning: tuning.trim() || null,
      tags: tags.length ? tags : null,
      notes: notes.trim() || null,
      updated_by: user.id,
      updated_at: newUpdatedAt,
    }).eq('id', song.id)
    setSaving(false)
    if (error) {
      isDirtyRef.current = true
      toast('Erro ao guardar: ' + error.message, { type: 'error' })
      return
    }
    baseUpdatedAtRef.current = newUpdatedAt
    setSavedAt(new Date())
  }

  useEffect(() => { saveRef.current = save })

  // Save on unmount if dirty
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (isDirtyRef.current) saveRef.current()
    }
  }, [])

  function addTag(t: string) {
    const tag = t.trim()
    if (!tag || tags.includes(tag)) return
    const next = [...tags, tag]
    setTags(next)
    setTagInput('')
    scheduleSave()
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t))
    scheduleSave()
  }

  function backPath() {
    if (setlistId) return `/setlist/${setlistId}`
    if (projectId) return `/projects/${projectId}?tab=repertoire`
    return '/library'
  }

  if (loading) {
    return (
      <div className={styles.page} aria-busy="true">
        <div className={styles.skeletonWrap} role="status" aria-label="A carregar música">
          <div className={`skeleton ${styles.skCrumbs}`} />
          <div className={`skeleton ${styles.skTitle}`} />
          <div className={`skeleton ${styles.skArtist}`} />
          <div className={`skeleton ${styles.skMeta}`} />
          <div className={`skeleton ${styles.skTabs}`} />
          <div className={`skeleton ${styles.skPanel}`} />
        </div>
      </div>
    )
  }

  if (!song) {
    return (
      <div className={styles.page}>
        <div className={styles.notFound}>
          <span className={styles.notFoundIcon}><IconFileMissing /></span>
          <h2 className={styles.notFoundTitle}>Música não encontrada</h2>
          <p className={styles.notFoundText}>Pode ter sido apagada ou já não tens acesso a ela.</p>
          <button type="button" className={styles.primaryBtn} onClick={() => navigate(backPath())}>
            <IconArrowLeft /> Voltar
          </button>
        </div>
      </div>
    )
  }

  // Linha de metadados mono: 4:02 · TOM Em · 104 BPM · CAPO 2
  const durSec = parseDuration(duration)
  const keyVal = performanceKey.trim()
  const capoNum = capo ? parseInt(capo) : 0
  const metaItems: { k: string; node: ReactNode }[] = []
  if (durSec) metaItems.push({ k: 'dur', node: durationLabel(durSec) })
  // Tom como chip contornado (receita "tom musical" da spec). O espaço vem do
  // gap do .metaKey — um nó de texto "Tom " dentro de flex perdia o espaço.
  if (keyVal) metaItems.push({
    k: 'key',
    node: <span className={styles.metaKey}>Tom<span className={styles.keyChip}>{keyVal}</span></span>,
  })
  if (bpm) metaItems.push({ k: 'bpm', node: `${bpm} BPM` })
  if (capoNum > 0) metaItems.push({ k: 'capo', node: `Capo ${capoNum}` })
  const hasMetaLine = metaItems.length > 0 || song.is_user_edited || song.has_sync

  const lyricLineCount = lyrics.split('\n').filter(l => {
    const t = l.trim()
    return t && !/^\[.+\]$/.test(t)
  }).length

  const annPenActive = annTool === 'pen' && !annScrollMode

  return (
    <div className={`${styles.page} ${mode === 'ensaio' && tab === 'lyrics' ? styles.pageRehearsal : ''}`}>
      {/* Top bar: localização + estado da gravação */}
      <div className={styles.topBar}>
        <Breadcrumbs items={
          setlistId
            ? [
                { label: 'Concertos', to: '/setlists' },
                { label: setlistName ?? 'Setlist', to: `/setlist/${setlistId}` },
                { label: song.title || 'Música' },
              ]
            : projectId
            ? [
                { label: 'Projetos', to: '/projects' },
                { label: projectName ?? 'Projeto', to: `/projects/${projectId}` },
                { label: 'Repertório', to: `/projects/${projectId}?tab=repertoire` },
                { label: song.title || 'Música' },
              ]
            : [
                { label: 'Repertório', to: '/library' },
                { label: song.title || 'Música' },
              ]
        } />
        <div className={styles.saveState} aria-live="polite">
          {saving ? (
            <span className={`${styles.saveTag} ${styles.saveTagBusy}`}>
              <span className={styles.saveLed} aria-hidden="true" />A guardar…
            </span>
          ) : savedAt ? (
            <span className={`${styles.saveTag} ${styles.saveTagOk}`}>
              <span className={styles.saveLed} aria-hidden="true" />Guardado {clockLabel(savedAt)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Cabeçalho editável: título (entityTitle) + linha de créditos
          (artista · metadados mono). Os inputs medem-se pelo próprio texto
          (.sizer), para o lápis ficar colado ao título e a hairline de
          hover/focus sublinhar só o texto. */}
      <div className={styles.songHeader}>
        <div className={styles.titleRow}>
          <span className={`${styles.sizer} ${styles.titleSizer}`} data-value={title || 'Título da música'}>
            <input
              className={styles.titleInput}
              size={1}
              value={title}
              onChange={e => { setTitle(e.target.value); scheduleSave() }}
              placeholder="Título da música"
              aria-label="Título da música (editável)"
            />
          </span>
          <span className={styles.editHint} aria-hidden="true"><IconPencil size={18} /></span>
        </div>
        <div className={styles.creditRow}>
          <span className={`${styles.sizer} ${styles.artistSizer}`} data-value={artist || 'Artista'}>
            <input
              className={styles.artistInput}
              size={1}
              value={artist}
              onChange={e => { setArtist(e.target.value); scheduleSave() }}
              placeholder="Artista"
              aria-label="Artista (editável)"
            />
          </span>
          {hasMetaLine && (
            <div className={styles.metaLine}>
              {metaItems.map((m, i) => (
                <span key={m.k} className={styles.metaItem}>
                  {i > 0 && <span className={styles.metaSep} aria-hidden="true">·</span>}
                  {m.node}
                </span>
              ))}
              {song.is_user_edited && <span className={`${styles.chip} ${styles.chipWarn}`}>Editada</span>}
              {song.has_sync && <span className={`${styles.chip} ${styles.chipOk}`}>Sync</span>}
            </div>
          )}
        </div>
      </div>

      {/* Barra de controlo: segmented Letra/Acordes/Detalhes + ferramentas da letra */}
      <div className={styles.controlBar}>
        <div className={styles.segmented} role="tablist" aria-label="Secções da música">
          {(['lyrics', 'chords', 'details'] as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`${styles.segBtn} ${tab === t ? styles.segBtnActive : ''}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === 'lyrics' && (
          <div className={styles.tools}>
            {/* Modo da letra: Ensaio ↔ Editar — botões fantasma de ferramenta
                (o segmented mono fica só para as secções de conteúdo) */}
            <div className={styles.modeGroup} role="group" aria-label="Modo da letra">
              <button
                type="button"
                className={`${styles.toolBtn} ${mode === 'ensaio' ? styles.toolBtnOn : ''}`}
                onClick={() => setMode('ensaio')}
                aria-pressed={mode === 'ensaio'}
                title="Ensaio: ler e anotar a letra"
              >
                <IconEye /> Ensaio
              </button>
              <button
                type="button"
                className={`${styles.toolBtn} ${mode === 'editar' ? styles.toolBtnOn : ''}`}
                onClick={() => setMode('editar')}
                aria-pressed={mode === 'editar'}
                aria-label="Editar letra"
                title="Editar o texto da letra"
              >
                <IconEditText /> Editar
              </button>
            </div>
            <span className={styles.toolSep} aria-hidden="true" />
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => navigate(`/songs/${id}/sync${projectId ? `?project=${projectId}` : ''}`)}
              title="Editor de sincronização de letra"
              aria-label="Sincronizar: abrir editor de sincronização de letra"
            >
              <IconWave /> <span className={styles.syncLabel}>Sincronizar</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={styles.content}>
        {tab === 'lyrics' && (
          <div className={styles.editorPane}>
            {mode === 'ensaio' ? (
              <div className={styles.rehearsal}>
                {/* Fita de ferramentas de anotação */}
                <div className={styles.annStrip} role="toolbar" aria-label="Ferramentas de anotação">
                  <div className={styles.annRow}>
                    {/* Colors */}
                    <div className={styles.annGroup}>
                      {annPalette.map(c => {
                        const on = annPenActive && annColor === c.value
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={`${styles.annSwatchBtn} ${on ? styles.annSwatchOn : ''}`}
                            onClick={() => { setAnnColor(c.value); setAnnTool('pen'); setAnnScrollMode(false) }}
                            aria-label={`Cor ${c.label.toLowerCase()}`}
                            aria-pressed={on}
                            title={c.label}
                          >
                            <span className={styles.annSwatch} style={{ backgroundColor: c.value }} />
                          </button>
                        )
                      })}
                    </div>

                    {/* Widths */}
                    <div className={styles.annGroup}>
                      {ANN_WIDTHS.map(w => {
                        const on = annWidth === w.value && annPenActive
                        return (
                          <button
                            key={w.id}
                            type="button"
                            className={`${styles.annTool} ${on ? styles.annToolOn : ''}`}
                            onClick={() => { setAnnWidth(w.value); setAnnTool('pen'); setAnnScrollMode(false) }}
                            aria-label={w.label}
                            aria-pressed={on}
                            title={w.label}
                          >
                            <span className={styles.annWidthSample} style={{ height: w.value }} />
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className={styles.annRow}>
                    <div className={styles.annGroup}>
                      {/* Eraser */}
                      <button
                        type="button"
                        className={`${styles.annTool} ${annTool === 'eraser' && !annScrollMode ? styles.annToolOn : ''}`}
                        onClick={() => { setAnnTool(t => t === 'eraser' ? 'pen' : 'eraser'); setAnnScrollMode(false) }}
                        title="Borracha"
                        aria-label="Borracha"
                        aria-pressed={annTool === 'eraser' && !annScrollMode}
                      >
                        <IconEraser />
                      </button>

                      {/* Undo */}
                      <button
                        type="button"
                        className={styles.annTool}
                        onClick={() => annLayerRef.current?.undo()}
                        title="Desfazer"
                        aria-label="Desfazer"
                      >
                        <IconUndo />
                      </button>
                    </div>

                    {/* Font size — A− / A+ como teclas */}
                    <div className={styles.annGroup}>
                      <button
                        type="button"
                        className={styles.annKey}
                        onClick={() => changeRehearsalFont(-REHEARSAL_FONT_STEP)}
                        disabled={rehearsalFont <= REHEARSAL_FONT_MIN}
                        title="Diminuir letra"
                        aria-label="Diminuir letra"
                      >
                        <span className={styles.annKeyCap}>A−</span>
                      </button>
                      <button
                        type="button"
                        className={styles.annKey}
                        onClick={() => changeRehearsalFont(REHEARSAL_FONT_STEP)}
                        disabled={rehearsalFont >= REHEARSAL_FONT_MAX}
                        title="Aumentar letra"
                        aria-label="Aumentar letra"
                      >
                        <span className={styles.annKeyCap}>A+</span>
                      </button>
                    </div>

                    {/* Clear all annotations */}
                    <div className={`${styles.annGroup} ${styles.annGroupEnd}`}>
                      <button
                        type="button"
                        className={styles.annClear}
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Limpar anotações',
                            message: 'Apagar todas as anotações desta música? Podes recuperá-las com Desfazer logo a seguir.',
                            confirmLabel: 'Limpar',
                            danger: true,
                          })
                          if (ok) setAnnClear(c => c + 1)
                        }}
                      >
                        <IconTrash /> Limpar
                      </button>
                    </div>
                  </div>
                </div>

                {/* Folha da letra */}
                <div className={styles.previewWrap}>
                  <div className={`${styles.previewPane} ${!annScrollMode ? styles.previewPaneLocked : ''}`}>
                    <div className={styles.previewInner}>
                      <div ref={lyricsContentRef}>
                        <LyricsView lyrics={lyrics} fontSize={rehearsalFont} lineHeight={1.6} />
                      </div>
                      {song && (
                        <AnnotationLayer
                          ref={annLayerRef}
                          songId={song.id}
                          userId={user?.id}
                          tool={annTool}
                          color={annColor}
                          strokeWidth={annWidth}
                          clearTrigger={annClear}
                          disabled={annScrollMode}
                          contentRef={lyricsContentRef}
                        />
                      )}
                    </div>
                  </div>
                  {/* Scroll/draw toggle — fora do painel que faz scroll, para nunca ficar tapado */}
                  <button
                    type="button"
                    className={`${styles.floatBtn} ${annScrollMode ? styles.floatBtnScroll : styles.floatBtnDraw}`}
                    onClick={() => setAnnScrollMode(m => !m)}
                    title={annScrollMode ? 'Modo scroll — toca para anotar' : 'Modo anotação — toca para scroll'}
                    aria-label={annScrollMode ? 'Modo scroll ativo — tocar para anotar' : 'Modo anotação ativo — tocar para fazer scroll'}
                  >
                    {annScrollMode
                      ? <><IconScrollV /><span className={styles.floatLabel}>Scroll</span></>
                      : <><IconPencil /><span className={styles.floatLabel}>Anotar</span></>}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.sheet}>
                <div className={styles.sheetHead}>
                  <span className={styles.label}>
                    Letra<span className={styles.metaSep} aria-hidden="true">·</span>
                    {lyricLineCount} {lyricLineCount === 1 ? 'linha' : 'linhas'}
                  </span>
                  {song.original_lyrics && song.is_user_edited && (
                    <button
                      type="button"
                      className={styles.dangerGhostBtn}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Repor letra original',
                          message: 'Isto substitui a letra editada pela versão original. As tuas edições perdem-se e não há volta atrás. Continuar?',
                          confirmLabel: 'Repor original',
                          danger: true,
                        })
                        if (!ok) return
                        setLyrics(song.original_lyrics!)
                        scheduleSave()
                      }}
                    >
                      <IconReset /> Repor original
                    </button>
                  )}
                </div>
                <textarea
                  className={styles.lyricsEditor}
                  value={lyrics}
                  onChange={e => { setLyrics(e.target.value); scheduleSave() }}
                  placeholder="Cola ou escreve a letra aqui..."
                  spellCheck={false}
                  aria-label="Letra"
                />
              </div>
            )}
          </div>
        )}

        {tab === 'chords' && (
          <div className={styles.editorPane}>
            <div className={styles.sheet}>
              <div className={styles.sheetHead}>
                <span className={styles.label}>Acordes</span>
                <span className={styles.sheetHint}>
                  Usa <code className={styles.code}>[Secção]</code> para organizar — ex.: <code className={styles.code}>[Verso 1]</code>, <code className={styles.code}>[Refrão]</code>
                </span>
              </div>
              <textarea
                className={styles.chordsEditor}
                value={chords}
                onChange={e => { setChords(e.target.value); scheduleSave() }}
                placeholder={`[Intro]\nAm F C G\n\n[Verso 1]\nAm              F\nLetra aqui...`}
                spellCheck={false}
                aria-label="Acordes"
              />
            </div>
          </div>
        )}

        {tab === 'details' && (
          <div className={styles.detailsPane}>
            <div className={styles.detailsCols}>
              <div className={styles.detailsCol}>
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <span className={styles.label}>Performance</span>
                  </div>
                  <div className={styles.detailsGrid}>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="song-pkey">Tom de performance</label>
                      <input
                        id="song-pkey"
                        className={`${styles.fieldInput} ${styles.fieldMono}`}
                        value={performanceKey}
                        onChange={e => { setPerformanceKey(e.target.value); scheduleSave() }}
                        placeholder="ex: G, Am, F#"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="song-okey">Tom original</label>
                      <input
                        id="song-okey"
                        className={`${styles.fieldInput} ${styles.fieldMono}`}
                        value={originalKey}
                        onChange={e => { setOriginalKey(e.target.value); scheduleSave() }}
                        placeholder="ex: A"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="song-bpm">BPM</label>
                      <input
                        id="song-bpm"
                        className={`${styles.fieldInput} ${styles.fieldMono}`}
                        type="number"
                        min="40"
                        max="300"
                        value={bpm}
                        onChange={e => { setBpm(e.target.value); scheduleSave() }}
                        placeholder="ex: 120"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="song-dur">Duração</label>
                      <input
                        id="song-dur"
                        className={`${styles.fieldInput} ${styles.fieldMono}`}
                        value={duration}
                        onChange={e => { setDuration(e.target.value); scheduleSave() }}
                        placeholder="ex: 3:45"
                        inputMode="numeric"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="song-capo">Capo</label>
                      <input
                        id="song-capo"
                        className={`${styles.fieldInput} ${styles.fieldMono}`}
                        type="number"
                        min="0"
                        max="12"
                        value={capo}
                        onChange={e => { setCapo(e.target.value); scheduleSave() }}
                        placeholder="0"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="song-tuning">Afinação</label>
                      <input
                        id="song-tuning"
                        className={styles.fieldInput}
                        value={tuning}
                        onChange={e => { setTuning(e.target.value); scheduleSave() }}
                        placeholder="ex: Standard, Drop D, Eb"
                      />
                    </div>
                  </div>
                </section>

                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <label className={styles.label} htmlFor="song-tag-input">
                      Tags{tags.length > 0 && <><span className={styles.metaSep} aria-hidden="true">·</span>{tags.length}</>}
                    </label>
                  </div>
                  <div className={styles.tagField}>
                    {tags.map(t => (
                      <span key={t} className={styles.tag}>
                        {t}
                        <button
                          type="button"
                          className={styles.tagRemove}
                          onClick={() => removeTag(t)}
                          aria-label={`Remover tag ${t}`}
                        >
                          <IconX size={12} />
                        </button>
                      </span>
                    ))}
                    <input
                      id="song-tag-input"
                      className={styles.tagInput}
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
                        if (e.key === 'Backspace' && !tagInput && tags.length) removeTag(tags[tags.length - 1])
                      }}
                      placeholder={tags.length ? '' : 'Adicionar tag...'}
                    />
                  </div>
                  <div className={styles.tagSuggestions}>
                    {TAG_SUGGESTIONS.filter(s => !tags.includes(s)).slice(0, 8).map(s => (
                      <button
                        key={s}
                        type="button"
                        className={styles.tagSuggest}
                        onClick={() => addTag(s)}
                        aria-label={`Adicionar tag ${s}`}
                      >
                        <IconPlus size={12} />{s}
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              <div className={styles.detailsCol}>
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <label className={styles.label} htmlFor="song-notes">Notas internas</label>
                  </div>
                  <textarea
                    id="song-notes"
                    className={styles.notesEditor}
                    value={notes}
                    onChange={e => { setNotes(e.target.value); scheduleSave() }}
                    placeholder="Notas para ensaio, entradas, dinâmicas..."
                    rows={5}
                  />
                </section>

                {concertHistory.length > 0 && (
                  <section className={styles.section}>
                    <div className={styles.sectionHead}>
                      <span className={styles.label}>
                        Histórico de concertos<span className={styles.metaSep} aria-hidden="true">·</span>{concertHistory.length}
                      </span>
                    </div>
                    <ul className={styles.historyList}>
                      {concertHistory.slice(0, 10).map((h, i) => {
                        const dateStr = h.date
                          ? (() => { const [y, m, d] = h.date!.split('-'); return `${d}.${m}.${y.slice(-2)}` })()
                          : 'S/ data'
                        return (
                          <li key={i} className={styles.historyItem}>
                            <span className={styles.historyDate}>{dateStr}</span>
                            <span className={styles.historyInfo}>
                              <span className={styles.historyName}>{h.setlistName}</span>
                              {h.venue && <span className={styles.historyVenue}>{h.venue}</span>}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}

                {song.source_provider && (
                  <div className={styles.sourceMeta}>
                    Letra importada de <span className={styles.sourceName}>{song.source_provider}</span>
                    {song.confidence_score ? <><span className={styles.metaSep} aria-hidden="true">·</span>Confiança {Math.round(song.confidence_score * 100)}%</> : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* "Concluído" — o autosave já grava; a barra só confirma e sai.
          Escondida no modo ensaio para devolver ~70px de letra. */}
      {mode !== 'ensaio' && (
        <div className={styles.saveBar}>
          <span className={styles.saveHint}>
            <span className={styles.saveHintLed} aria-hidden="true" />
            Gravação automática
          </span>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={async () => { await save(); navigate(backPath()) }}
            disabled={saving}
          >
            {saving ? 'A guardar...' : <><IconCheck /> Concluído</>}
          </button>
        </div>
      )}
    </div>
  )
}
