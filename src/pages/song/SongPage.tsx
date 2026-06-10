import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../../components/Layout'
import Breadcrumbs from '../../components/Breadcrumbs'
import LyricsView from '../../components/LyricsView'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './SongPage.module.css'

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

export default function SongPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const projectId = searchParams.get('project')

  const [song, setSong] = useState<Song | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('lyrics')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [preview, setPreview] = useState(true)

  // Editable fields
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [chords, setChords] = useState('')
  const [performanceKey, setPerformanceKey] = useState('')
  const [originalKey, setOriginalKey] = useState('')
  const [bpm, setBpm] = useState('')
  const [capo, setCapo] = useState('')
  const [tuning, setTuning] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [tagInput, setTagInput] = useState('')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDirtyRef = useRef(false)

  useEffect(() => {
    if (!id || !user) return
    load()
  }, [id, user])

  useEffect(() => {
    if (!projectId) { setProjectName(null); return }
    supabase.from('bands').select('name').eq('id', projectId).single()
      .then(({ data }) => setProjectName(data?.name ?? null))
  }, [projectId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('songs').select('*').eq('id', id).single()
    if (!data) { setLoading(false); return }
    const s = data as unknown as Song
    setSong(s)
    setTitle(s.title)
    setArtist(s.artist)
    setLyrics(s.edited_lyrics ?? s.lyrics ?? '')
    setChords(s.chords ?? '')
    setPerformanceKey(s.performance_key ?? '')
    setOriginalKey(s.original_key ?? '')
    setBpm(s.bpm ? String(s.bpm) : '')
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
    isDirtyRef.current = false
    setSaving(true)
    const hasEdited = lyrics !== (song.original_lyrics ?? song.lyrics ?? '')
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
      capo: capo ? parseInt(capo) : null,
      tuning: tuning.trim() || null,
      tags: tags.length ? tags : null,
      notes: notes.trim() || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }).eq('id', song.id)
    setSaving(false)
    setSavedAt(new Date())
  }

  // Save on unmount if dirty
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (isDirtyRef.current && song) save()
    }
  }, [song, lyrics, title, artist, chords, performanceKey, originalKey, bpm, capo, tuning, tags, notes])

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
            projectId
              ? [
                  { label: 'Projetos', to: '/' },
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
              onClick={() => { setTab(t); if (t !== 'lyrics') setPreview(false) }}
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
                {song.original_lyrics && song.is_user_edited && (
                  <button
                    className={styles.resetBtn}
                    onClick={() => { setLyrics(song.original_lyrics!); scheduleSave() }}
                  >
                    Repor original
                  </button>
                )}
                <button
                  className={`${styles.previewToggle} ${preview ? styles.previewToggleActive : ''}`}
                  onClick={() => setPreview(v => !v)}
                >
                  {preview ? '✎ Editar' : '👁 Pré-ver'}
                </button>
              </div>
              {preview ? (
                <div className={styles.previewPane}>
                  <LyricsView lyrics={lyrics} />
                </div>
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
