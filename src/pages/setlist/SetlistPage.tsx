import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Layout from '../../components/Layout'
import LyricsView from '../../components/LyricsView'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Setlist, SetlistSong, Song } from '../../types'
import styles from './SetlistPage.module.css'

type Row = SetlistSong & { song: Song }

function SortableSongRow({ ss, index, isSelected, onSelect, onRemove }: {
  ss: Row; index: number; isSelected: boolean
  onSelect: (ss: Row) => void; onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ss.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.songRow} ${isDragging ? styles.dragging : ''} ${isSelected ? styles.songRowSelected : ''}`}
      onClick={() => onSelect(ss)}
    >
      <button
        ref={setActivatorNodeRef}
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        title="Arrastar para reordenar"
      >⋮⋮</button>
      <div className={styles.songNum}>{index + 1}</div>
      <div className={styles.songInfo}>
        <div className={styles.songTitle}>{ss.song?.title}</div>
        <div className={styles.songArtist}>
          {ss.song?.artist}
          {ss.performance_key && <span className={styles.keyChip}>{ss.performance_key}</span>}
          {ss.song?.has_sync && <span className={styles.syncBadge}>sync ✓</span>}
        </div>
      </div>
      <div className={styles.songDur}>
        {ss.song?.duration_sec ? `${Math.floor(ss.song.duration_sec / 60)}:${String(ss.song.duration_sec % 60).padStart(2, '0')}` : ''}
      </div>
      <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); onRemove(ss.id) }}>✕</button>
    </div>
  )
}

export default function SetlistPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [setlist, setSetlist] = useState<Setlist | null>(null)
  const [songs, setSongs] = useState<Row[]>([])
  const [library, setLibrary] = useState<Song[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [showLibrary, setShowLibrary] = useState(false)
  const [selected, setSelected] = useState<Row | null>(null)
  const [editKey, setEditKey] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [status, setStatus] = useState('draft')
  const [duplicating, setDuplicating] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    if (!id || !user) return
    supabase.from('setlists').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (data) {
          setSetlist(data)
          setName(data.name)
          setVenue(data.venue ?? '')
          setStatus(data.status ?? 'draft')
        }
      })
    loadSongs()
  }, [id, user])

  function selectRow(ss: Row) {
    setSelected(ss)
    setEditKey(ss.performance_key ?? '')
    setEditNotes(ss.notes ?? '')
  }

  async function loadSongs() {
    if (!id) return
    const { data } = await supabase
      .from('setlist_songs')
      .select('*, song:songs(*)')
      .eq('setlist_id', id)
      .order('position')
    setSongs((data ?? []) as any)
  }

  async function loadLibrary() {
    if (!user) return
    const existingIds = songs.map(s => s.song_id)
    const [ownRes, projRes] = await Promise.all([
      supabase.from('songs').select('*').eq('owner_id', user.id).order('title'),
      setlist?.band_id
        ? supabase.from('songs').select('*').eq('project_id', setlist.band_id).order('title')
        : Promise.resolve({ data: [] }),
    ])
    const all: Song[] = [...(ownRes.data ?? []), ...(projRes.data ?? [])]
    const seen = new Set<string>()
    const unique = all.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true })
    setLibrary(unique.filter(s => !existingIds.includes(s.id)))
    setShowLibrary(true)
  }

  async function saveVenue(val: string) {
    if (!id) return
    setVenue(val)
    await supabase.from('setlists').update({ venue: val || null }).eq('id', id)
  }

  async function saveStatus(val: string) {
    if (!id) return
    setStatus(val)
    await supabase.from('setlists').update({ status: val }).eq('id', id)
  }

  async function saveSetlistSongMeta() {
    if (!selected) return
    await supabase.from('setlist_songs').update({
      performance_key: editKey.trim() || null,
      notes: editNotes.trim() || null,
    }).eq('id', selected.id)
    setSongs(prev => prev.map(ss =>
      ss.id === selected.id
        ? { ...ss, performance_key: editKey.trim() || undefined, notes: editNotes.trim() || undefined }
        : ss
    ))
    setSelected(prev => prev ? { ...prev, performance_key: editKey.trim() || undefined, notes: editNotes.trim() || undefined } : prev)
  }

  async function addSong(song: Song) {
    if (!id) return
    const pos = songs.length
    await supabase.from('setlist_songs').insert({ setlist_id: id, song_id: song.id, position: pos })
    loadSongs()
    setShowLibrary(false)
  }

  async function removeSong(ssId: string) {
    await supabase.from('setlist_songs').delete().eq('id', ssId)
    setSongs(prev => prev.filter(s => s.id !== ssId))
    if (selected?.id === ssId) setSelected(null)
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = songs.findIndex(s => s.id === active.id)
    const newIndex = songs.findIndex(s => s.id === over.id)
    const reordered = arrayMove(songs, oldIndex, newIndex)
    setSongs(reordered)
    await persistOrder(reordered)
  }

  async function persistOrder(order: Row[]) {
    await Promise.all(order.map((ss, i) =>
      supabase.from('setlist_songs').update({ position: 10000 + i }).eq('id', ss.id)))
    await Promise.all(order.map((ss, i) =>
      supabase.from('setlist_songs').update({ position: i }).eq('id', ss.id)))
  }

  async function saveName() {
    if (!id || !name.trim()) return
    await supabase.from('setlists').update({ name }).eq('id', id)
    setSetlist(prev => prev ? { ...prev, name } : prev)
    setEditingName(false)
  }

  async function duplicateTo(projectId: string) {
    if (!user || !setlist) return
    setDuplicating(false)
    const { data: newSl, error } = await supabase
      .from('setlists')
      .insert({ name: `${setlist.name} (cópia)`, owner_id: user.id, band_id: projectId, is_shared: true })
      .select()
      .single()
    if (error) { alert('Erro ao duplicar: ' + error.message); return }
    if (newSl && songs.length) {
      await supabase.from('setlist_songs').insert(
        songs.map((s, i) => ({ setlist_id: newSl.id, song_id: s.song_id, position: i }))
      )
    }
    if (newSl) navigate(`/setlist/${newSl.id}`)
  }

  const totalSec = songs.reduce((acc, s) => acc + (s.song?.duration_sec ?? 0), 0)
  const totalMin = Math.floor(totalSec / 60)

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.back} onClick={() => setlist?.band_id ? navigate(`/projects/${setlist.band_id}?tab=setlists`) : navigate('/')}>
              ← {setlist?.band_id ? 'Projeto' : 'Início'}
            </button>
            {editingName ? (
              <input
                className={styles.nameInput}
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => e.key === 'Enter' && saveName()}
                autoFocus
              />
            ) : (
              <h1 className={styles.title} onClick={() => setEditingName(true)}>
                {setlist?.name ?? '...'} <span className={styles.editHint}>✎</span>
              </h1>
            )}
            <div className={styles.metaRow}>
              <span className={styles.meta}>
                {songs.length} música{songs.length !== 1 ? 's' : ''}
                {totalMin > 0 ? ` · ~${totalMin} min` : ''}
              </span>
              <input
                className={styles.venueInput}
                value={venue}
                onChange={e => setVenue(e.target.value)}
                onBlur={e => saveVenue(e.target.value)}
                placeholder="Local / evento..."
              />
              <select
                className={styles.statusSelect}
                value={status}
                onChange={e => saveStatus(e.target.value)}
              >
                <option value="draft">Rascunho</option>
                <option value="preparing">A preparar</option>
                <option value="final">Final</option>
                <option value="archived">Arquivada</option>
              </select>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.dupBtn} onClick={() => setDuplicating(true)}>⧉ Duplicar</button>
            <button className={styles.concertBtn} onClick={() => navigate(`/setlist/${id}/concert`)}>
              ▶ Iniciar Concerto
            </button>
          </div>
        </div>

        <div className={styles.layout}>
          <div className={styles.songList}>
            <div className={styles.listHeader}>
              <span className={styles.listTitle}>Ordem das músicas</span>
              <button className={styles.addBtn} onClick={loadLibrary}>+ Adicionar</button>
            </div>

            {songs.length === 0 ? (
              <div className={styles.empty}>
                <p>Sem músicas ainda</p>
                <button className={styles.addBtn} onClick={loadLibrary}>+ Adicionar música</button>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={songs.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  {songs.map((ss, i) => (
                    <SortableSongRow
                      key={ss.id}
                      ss={ss}
                      index={i}
                      isSelected={selected?.id === ss.id}
                      onSelect={selectRow}
                      onRemove={removeSong}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>

          <div className={styles.preview}>
            {selected ? (
              <>
                <div className={styles.previewTitle}>
                  {selected.song.title} — {selected.song.artist}
                </div>

                {/* Per-song fields */}
                <div className={styles.songMeta}>
                  <div className={styles.songMetaField}>
                    <label className={styles.songMetaLabel}>Tom no concerto</label>
                    <input
                      className={styles.songMetaInput}
                      value={editKey}
                      onChange={e => setEditKey(e.target.value)}
                      onBlur={saveSetlistSongMeta}
                      onKeyDown={e => e.key === 'Enter' && (e.currentTarget.blur())}
                      placeholder="ex: Am, G, C#m..."
                    />
                  </div>
                  <div className={styles.songMetaField}>
                    <label className={styles.songMetaLabel}>Notas para a música</label>
                    <textarea
                      className={styles.songMetaNotes}
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      onBlur={saveSetlistSongMeta}
                      placeholder="Intro, tempos, avisos..."
                      rows={2}
                    />
                  </div>
                </div>

                <div className={styles.lyricsDivider} />
                <div className={styles.lyrics}>
                  <LyricsView lyrics={selected.song.edited_lyrics ?? selected.song.lyrics} />
                </div>
              </>
            ) : (
              <div className={styles.previewEmpty}>
                <div className={styles.previewEmptyIcon}>🎵</div>
                <p>Seleciona uma música para ver a letra e editar detalhes</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {duplicating && (
        <ProjectPickerModal
          title="Duplicar setlist para que projeto?"
          onPick={duplicateTo}
          onClose={() => setDuplicating(false)}
        />
      )}

      {showLibrary && (
        <div className={styles.overlay} onClick={() => setShowLibrary(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Biblioteca</span>
              <button className={styles.closeBtn} onClick={() => setShowLibrary(false)}>✕</button>
            </div>
            <input
              className={styles.librarySearch}
              placeholder="Filtrar músicas..."
              value={librarySearch}
              onChange={e => setLibrarySearch(e.target.value)}
              autoFocus
            />
            {library.length === 0 ? (
              <div className={styles.modalEmpty}>
                <p>Sem músicas disponíveis</p>
                <button className={styles.addBtn} onClick={() => { setShowLibrary(false); navigate(setlist?.band_id ? `/search?project=${setlist.band_id}` : '/search') }}>
                  Ir buscar letras →
                </button>
              </div>
            ) : (
              library
                .filter(s => !librarySearch || `${s.title} ${s.artist}`.toLowerCase().includes(librarySearch.toLowerCase()))
                .map(song => (
                  <div key={song.id} className={styles.libraryRow} onClick={() => addSong(song)}>
                    <div className={styles.songInfo}>
                      <div className={styles.songTitle}>{song.title}</div>
                      <div className={styles.songArtist}>{song.artist} {song.has_sync && <span className={styles.syncBadge}>sync ✓</span>}</div>
                    </div>
                    <span className={styles.addIcon}>+</span>
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
