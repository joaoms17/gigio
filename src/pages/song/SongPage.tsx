import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../../components/Layout'
import Breadcrumbs from '../../components/Breadcrumbs'
import LyricsView from '../../components/LyricsView'
import AnnotationLayer, { type AnnotationHandle } from '../../components/AnnotationLayer'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './SongPage.module.css'

const ANN_COLORS = [
  { id: 'red',    value: '#FF4D6D' },
  { id: 'blue',   value: '#2563EB' },
  { id: 'green',  value: '#16A34A' },
  { id: 'orange', value: '#F59E0B' },
  { id: 'dark',   value: '#1e1e2e' },
]
const ANN_WIDTHS = [
  { id: 'thin',   value: 2,  size: 4 },
  { id: 'mid',    value: 4,  size: 7 },
  { id: 'thick',  value: 8,  size: 11 },
]

type Tab = 'lyrics' | 'chords' | 'details'

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

export default function SongPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

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
  // 'ensaio' = view + annotate (default), 'editar' = text editor
  const [mode, setMode] = useState<'ensaio' | 'editar'>('ensaio')

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
  const [annTool, setAnnTool] = useState<'pen' | 'eraser'>('pen')
  const [annColor, setAnnColor] = useState(ANN_COLORS[0].value)
  const [annWidth, setAnnWidth] = useState(ANN_WIDTHS[0].value)
  const [annClear, setAnnClear] = useState(0)
  const [annScrollMode, setAnnScrollMode] = useState(false)
  const annLayerRef = useRef<AnnotationHandle>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDirtyRef = useRef(false)
  // Conflict detection: updated_at as seen at load/last save
  const baseUpdatedAtRef = useRef<string | null>(null)

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
    saveTimer.current = setTimeout(save, 2000)
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
      const overwrite = window.confirm(
        'Atenção: esta música foi alterada por outro membro enquanto editavas.\n\n' +
        'OK = guardar por cima das alterações deles · Cancelar = manter as alterações deles (as tuas edições ficam no editor)'
      )
      if (!overwrite) return
    }

    isDirtyRef.current = false
    setSaving(true)
    const hasEdited = lyrics !== (song.original_lyrics ?? song.lyrics ?? '')
    const newUpdatedAt = new Date().toISOString()
    await supabase.from('songs').update({
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
    baseUpdatedAtRef.current = newUpdatedAt
    setSaving(false)
    setSavedAt(new Date())
  }

  // Save on unmount if dirty
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (isDirtyRef.current && song) save()
    }
  }, [song, lyrics, title, artist, chords, performanceKey, originalKey, bpm, duration, capo, tuning, tags, notes])

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
      <Layout>
        <div className={styles.loading}>A carregar música...</div>
      </Layout>
    )
  }

  if (!song) {
    return (
      <Layout>
        <div className={styles.notFound}>
          <p>Música não encontrada.</p>
          <button onClick={() => navigate(backPath())}>← Voltar</button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className={styles.page}>
        {/* Top bar */}
        <div className={styles.topBar}>
          <Breadcrumbs items={
            setlistId
              ? [
                  { label: 'Setlists', to: '/setlists' },
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
                  { label: 'Biblioteca', to: '/library' },
                  { label: song.title || 'Música' },
                ]
          } />
          <div className={styles.saveState}>
            {saving ? (
              <span className={styles.saving}>A guardar...</span>
            ) : savedAt ? (
              <span className={styles.saved}>✓ Guardado</span>
            ) : null}
          </div>
        </div>

        {/* Header editable */}
        <div className={styles.songHeader}>
          <input
            className={styles.titleInput}
            value={title}
            onChange={e => { setTitle(e.target.value); scheduleSave() }}
            placeholder="Título da música"
          />
          <input
            className={styles.artistInput}
            value={artist}
            onChange={e => { setArtist(e.target.value); scheduleSave() }}
            placeholder="Artista"
          />
          <div className={styles.quickMeta}>
            {song.duration_sec ? <span>{durationLabel(song.duration_sec)}</span> : null}
            {performanceKey && <span className={styles.keyPill}>{performanceKey}</span>}
            {bpm && <span className={styles.bpmPill}>{bpm} bpm</span>}
            {song.is_user_edited && <span className={styles.editedPill}>editada</span>}
            {song.has_sync && <span className={styles.syncPill}>sync ✓</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {(['lyrics', 'chords', 'details'] as Tab[]).map(t => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {{ lyrics: 'Letra', chords: 'Acordes', details: 'Detalhes' }[t]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={styles.content}>
          {tab === 'lyrics' && (
            <div className={styles.editorPane}>
              <div className={styles.editorToolbar}>
                {song.original_lyrics && song.is_user_edited && mode === 'editar' && (
                  <button
                    className={styles.resetBtn}
                    onClick={() => { setLyrics(song.original_lyrics!); scheduleSave() }}
                  >
                    Repor original
                  </button>
                )}
                {/* Mode toggle: Ensaio ↔ Editar letra */}
                <div className={styles.modeToggle}>
                  <button
                    className={`${styles.modeBtn} ${mode === 'ensaio' ? styles.modeBtnActive : ''}`}
                    onClick={() => setMode('ensaio')}
                  >
                    ✏ Ensaio
                  </button>
                  <button
                    className={`${styles.modeBtn} ${mode === 'editar' ? styles.modeBtnActive : ''}`}
                    onClick={() => setMode('editar')}
                  >
                    ✎ Editar letra
                  </button>
                </div>
                <button
                  className={styles.syncEditorBtn}
                  onClick={() => navigate(`/songs/${id}/sync${projectId ? `?project=${projectId}` : ''}`)}
                  title="Editor de sincronização de letra"
                >
                  🎵 Sincronizar
                </button>
              </div>

              {mode === 'ensaio' ? (
                <>
                  {/* Annotation toolbar — colors + sizes + undo only */}
                  <div className={styles.rehearsalBar}>
                    {/* Colors */}
                    <div className={styles.annColors}>
                      {ANN_COLORS.map(c => (
                        <button
                          key={c.id}
                          className={`${styles.annColor} ${annTool === 'pen' && annColor === c.value ? styles.annColorActive : ''}`}
                          style={{ background: c.value, borderColor: annTool === 'pen' && annColor === c.value ? '#fff' : 'transparent' }}
                          onClick={() => { setAnnColor(c.value); setAnnTool('pen'); setAnnScrollMode(false) }}
                        />
                      ))}
                    </div>

                    <div className={styles.annDivider} />

                    {/* Widths */}
                    <div className={styles.annWidths}>
                      {ANN_WIDTHS.map(w => (
                        <button
                          key={w.id}
                          className={`${styles.annWidth} ${annWidth === w.value && annTool === 'pen' ? styles.annWidthActive : ''}`}
                          onClick={() => { setAnnWidth(w.value); setAnnTool('pen'); setAnnScrollMode(false) }}
                        >
                          <span className={styles.annWidthDot} style={{ width: w.size, height: w.size }} />
                        </button>
                      ))}
                    </div>

                    <div className={styles.annDivider} />

                    {/* Eraser */}
                    <button
                      className={`${styles.annTool} ${annTool === 'eraser' && !annScrollMode ? styles.annToolActive : ''}`}
                      onClick={() => { setAnnTool(t => t === 'eraser' ? 'pen' : 'eraser'); setAnnScrollMode(false) }}
                      title="Borracha"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 20H7L3 16l9-9 8 8-4 4z"/>
                        <path d="M6.5 17.5l-4-4"/>
                      </svg>
                    </button>

                    {/* Undo */}
                    <button
                      className={styles.annTool}
                      onClick={() => annLayerRef.current?.undo()}
                      title="Desfazer"
                    >
                      ↩
                    </button>
                  </div>

                  <div className={`${styles.previewPane} ${!annScrollMode ? styles.previewPaneLocked : ''}`}>
                    <div className={styles.previewInner}>
                      <LyricsView lyrics={lyrics} fontSize={32} lineHeight={1.6} />
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
                        />
                      )}
                    </div>
                    {/* Floating scroll/draw toggle */}
                    <button
                      className={`${styles.floatBtn} ${annScrollMode ? styles.floatBtnScroll : styles.floatBtnDraw}`}
                      style={{ position: 'sticky', bottom: '72px', float: 'right', marginRight: '-4px' }}
                      onClick={() => setAnnScrollMode(m => !m)}
                      title={annScrollMode ? 'Scroll — clica para desenhar' : 'Desenho — clica para scroll'}
                    >
                      {annScrollMode ? '↕' : '✏'}
                    </button>
                  </div>
                </>
              ) : (
                <textarea
                  className={styles.lyricsEditor}
                  value={lyrics}
                  onChange={e => { setLyrics(e.target.value); scheduleSave() }}
                  placeholder="Cola ou escreve a letra aqui..."
                  spellCheck={false}
                />
              )}
            </div>
          )}

          {tab === 'chords' && (
            <div className={styles.editorPane}>
              <p className={styles.chordsHint}>
                Usa [Secção] para organizar. Ex: [Verso 1], [Refrão]
              </p>
              <textarea
                className={styles.chordsEditor}
                value={chords}
                onChange={e => { setChords(e.target.value); scheduleSave() }}
                placeholder={`[Intro]\nAm F C G\n\n[Verso 1]\nAm              F\nLetra aqui...`}
                spellCheck={false}
              />
            </div>
          )}

          {tab === 'details' && (
            <div className={styles.detailsPane}>
              <div className={styles.detailsGrid}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Tom de performance</label>
                  <input
                    className={styles.fieldInput}
                    value={performanceKey}
                    onChange={e => { setPerformanceKey(e.target.value); scheduleSave() }}
                    placeholder="ex: G, Am, F#"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Tom original</label>
                  <input
                    className={styles.fieldInput}
                    value={originalKey}
                    onChange={e => { setOriginalKey(e.target.value); scheduleSave() }}
                    placeholder="ex: A"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>BPM</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    min="40"
                    max="300"
                    value={bpm}
                    onChange={e => { setBpm(e.target.value); scheduleSave() }}
                    placeholder="ex: 120"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Duração</label>
                  <input
                    className={styles.fieldInput}
                    value={duration}
                    onChange={e => { setDuration(e.target.value); scheduleSave() }}
                    placeholder="ex: 3:45"
                    inputMode="numeric"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Capo</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    min="0"
                    max="12"
                    value={capo}
                    onChange={e => { setCapo(e.target.value); scheduleSave() }}
                    placeholder="0"
                  />
                </div>
                <div className={`${styles.fieldGroup} ${styles.fullWidth}`}>
                  <label className={styles.fieldLabel}>Afinação</label>
                  <input
                    className={styles.fieldInput}
                    value={tuning}
                    onChange={e => { setTuning(e.target.value); scheduleSave() }}
                    placeholder="ex: Standard, Drop D, Eb"
                  />
                </div>
              </div>

              {concertHistory.length > 0 && (
                <div className={styles.historySection}>
                  <label className={styles.fieldLabel}>Histórico de concertos</label>
                  <ul className={styles.historyList}>
                    {concertHistory.slice(0, 10).map((h, i) => {
                      const dateStr = h.date
                        ? (() => { const [y, m, d] = h.date!.split('-'); return `${d}/${m}/${y}` })()
                        : 'Sem data'
                      return (
                        <li key={i} className={styles.historyItem}>
                          {dateStr}{h.venue ? ` · ${h.venue}` : ''} · {h.setlistName}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              <div className={styles.tagsSection}>
                <label className={styles.fieldLabel}>Tags</label>
                <div className={styles.tagList}>
                  {tags.map(t => (
                    <span key={t} className={styles.tag}>
                      {t}
                      <button className={styles.tagRemove} onClick={() => removeTag(t)}>×</button>
                    </span>
                  ))}
                  <input
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
                    <button key={s} className={styles.tagSuggest} onClick={() => addTag(s)}>{s}</button>
                  ))}
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Notas internas</label>
                <textarea
                  className={styles.notesEditor}
                  value={notes}
                  onChange={e => { setNotes(e.target.value); scheduleSave() }}
                  placeholder="Notas para ensaio, entradas, dinâmicas..."
                  rows={4}
                />
              </div>

              {song.source_provider && (
                <div className={styles.sourceMeta}>
                  Letra importada de <strong>{song.source_provider}</strong>
                  {song.confidence_score ? ` · confiança ${Math.round(song.confidence_score * 100)}%` : ''}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save button — fixed footer */}
        <div className={styles.saveBar}>
          <button
            className={styles.saveBtn}
            onClick={async () => { await save(); navigate(backPath()) }}
            disabled={saving}
          >
            {saving ? 'A guardar...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Layout>
  )
}
