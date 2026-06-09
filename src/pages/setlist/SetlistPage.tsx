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
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Setlist, SetlistSong, Song } from '../../types'
import styles from './SetlistPage.module.css'

type Row = SetlistSong & { song: Song }

function SortableSongRow({ ss, index, onSelect, onRemove }: {
  ss: Row; index: number; onSelect: (s: Song) => void; onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ss.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return (
    <div ref={setNodeRef} style={style} className={`${styles.songRow} ${isDragging ? styles.dragging : ''}`} onClick={() => onSelect(ss.song)}>
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
  const [showLibrary, setShowLibrary] = useState(false)
  const [selected, setSelected] = useState<Song | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    if (!id || !user) return
    supabase.from('setlists').select('*').eq('id', id).single()
      .then(({ data }) => { if (data) { setSetlist(data); setName(data.name) } })
    loadSongs()
  }, [id, user])

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
    const { data } = await supabase.from('songs').select('*').eq('owner_id', user.id).order('title')
    setLibrary(data ?? [])
    setShowLibrary(true)
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
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = songs.findIndex(s => s.id === active.id)
    const newIndex = songs.findIndex(s => s.id === over.id)
    const reordered = arrayMove(songs, oldIndex, newIndex)
    setSongs(reordered) // otimista
    await persistOrder(reordered)
  }

  // Duas fases para não colidir com a constraint unique(setlist_id, position)
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

  const totalSec = songs.reduce((acc, s) => acc + (s.song?.duration_sec ?? 0), 0)
  const totalMin = Math.floor(totalSec / 60)

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.back} onClick={() => navigate('/')}>← Home</button>
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
            <p className={styles.meta}>
              {songs.length} música{songs.length !== 1 ? 's' : ''}
              {totalMin > 0 ? ` · ~${totalMin} min` : ''}
            </p>
          </div>
          <button className={styles.concertBtn} onClick={() => navigate(`/setlist/${id}/concert`)}>
            ▶ Iniciar Concerto
          </button>
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
                    <SortableSongRow key={ss.id} ss={ss} index={i} onSelect={setSelected} onRemove={removeSong} />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>

          <div className={styles.preview}>
            <div className={styles.previewTitle}>
              {selected ? `${selected.title} — ${selected.artist}` : 'Seleciona uma música'}
            </div>
            <div className={styles.lyrics}>
              {selected ? <LyricsView lyrics={selected.lyrics} /> : <span className={styles.lyricHint}>A letra aparece aqui</span>}
            </div>
          </div>
        </div>
      </div>

      {showLibrary && (
        <div className={styles.overlay} onClick={() => setShowLibrary(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Biblioteca</span>
              <button className={styles.closeBtn} onClick={() => setShowLibrary(false)}>✕</button>
            </div>
            {library.length === 0 ? (
              <div className={styles.modalEmpty}>
                <p>Sem músicas na biblioteca</p>
                <button className={styles.addBtn} onClick={() => { setShowLibrary(false); navigate('/search') }}>
                  Ir buscar letras →
                </button>
              </div>
            ) : (
              library.map(song => (
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
