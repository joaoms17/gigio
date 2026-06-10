import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Layout from '../../components/Layout'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Setlist, SetlistSong, Song } from '../../types'
import styles from './SetlistPage.module.css'

type Row = SetlistSong & { song: Song }

function SortableSongRow({ ss, index, onEdit, onRemove }: {
  ss: Row; index: number
  onEdit: (songId: string) => void; onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ss.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return (
    <div ref={setNodeRef} style={style} className={`${styles.songRow} ${isDragging ? styles.dragging : ''}`}>
      <button
        ref={setActivatorNodeRef}
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
        title="Arrastar para reordenar"
      >⋮⋮</button>
      <div className={styles.songNum}>{index + 1}</div>
      <div className={styles.songInfo}>
        <div className={styles.songTitle}>{ss.song?.title}</div>
        <div className={styles.songArtist}>
          {ss.song?.artist}
          {ss.performance_key && <span className={styles.keyChip}>{ss.performance_key}</span>}
          {ss.notes && <span className={styles.notesIndicator} title={ss.notes}>📝</span>}
          {ss.song?.has_sync && <span className={styles.syncBadge}>sync ✓</span>}
        </div>
      </div>
      <div className={styles.songDur}>
        {ss.song?.duration_sec ? `${Math.floor(ss.song.duration_sec / 60)}:${String(ss.song.duration_sec % 60).padStart(2, '0')}` : ''}
      </div>
      <button className={styles.iconBtn} onClick={() => onEdit(ss.song_id)} title="Editar música">✎</button>
      <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); onRemove(ss.id) }} title="Remover da setlist">✕</button>
    </div>
  )
}

export default function SetlistPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const [searchParams] = useSearchParams()
  const autoAddDone = useRef(false)
  const [setlist, setSetlist] = useState<Setlist | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [songs, setSongs] = useState<Row[]>([])
  const [library, setLibrary] = useState<Song[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [libSelection, setLibSelection] = useState<Set<string>>(new Set())
  const [showLibrary, setShowLibrary] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState('draft')
  const [duplicating, setDuplicating] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    if (!id || !user) return
    supabase.from('setlists').select('*, bands(name)').eq('id', id).single()
      .then(({ data }) => {
        if (data) {
          setSetlist(data)
          setProjectName((data as any).bands?.name ?? null)
          setName(data.name)
          setVenue(data.venue ?? '')
          setDate(data.date ?? '')
          setStatus(data.status ?? 'draft')
        }
      })
    loadSongs()
  }, [id, user])

  useEffect(() => {
    if (autoAddDone.current) return
    if (searchParams.get('add') !== '1') return
    if (!setlist || !user) return
    autoAddDone.current = true
    loadLibrary()
  }, [setlist])

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
    let all: Song[]
    if (setlist?.band_id) {
      const { data } = await supabase.from('songs').select('*').eq('project_id', setlist.band_id).order('title')
      all = data ?? []
    } else {
      const { data } = await supabase.from('songs').select('*').eq('owner_id', user.id).order('title')
      all = data ?? []
    }
    setLibrary(all.filter(s => !existingIds.includes(s.id)))
    setLibSelection(new Set())
    setLibrarySearch('')
    setShowLibrary(true)
  }

  function closeLibrary() {
    setShowLibrary(false)
    setLibSelection(new Set())
  }

  async function addSelectedSongs() {
    if (!id || libSelection.size === 0) return
    const toAdd = library.filter(s => libSelection.has(s.id))
    const basePos = songs.length
    await supabase.from('setlist_songs').insert(
      toAdd.map((s, i) => ({ setlist_id: id, song_id: s.id, position: basePos + i }))
    )
    await loadSongs()
    closeLibrary()
  }

  function toggleSelection(songId: string) {
    setLibSelection(prev => {
      const next = new Set(prev)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      return next
    })
  }

  async function saveVenue(val: string) {
    if (!id) return
    setVenue(val)
    await supabase.from('setlists').update({ venue: val || null }).eq('id', id)
  }

  async function saveDate(val: string) {
    if (!id) return
    setDate(val)
    await supabase.from('setlists').update({ date: val || null }).eq('id', id)
  }

  async function saveStatus(val: string) {
    if (!id) return
    setStatus(val)
    await supabase.from('setlists').update({ status: val }).eq('id', id)
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

  async function deleteSetlist() {
    if (!id) return
    if (!await confirmDialog({ title: 'Apagar setlist', message: `Apagar a setlist "${setlist?.name}"? Esta ação não pode ser desfeita.`, confirmLabel: 'Apagar', danger: true })) return
    await supabase.from('setlist_songs').delete().eq('setlist_id', id)
    await supabase.from('setlists').delete().eq('id', id)
    setlist?.band_id ? navigate(`/projects/${setlist.band_id}?tab=setlists`) : navigate('/setlists')
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
  const filteredLibrary = library.filter(s =>
    !librarySearch || `${s.title} ${s.artist}`.toLowerCase().includes(librarySearch.toLowerCase())
  )

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Breadcrumbs items={
              setlist?.band_id
                ? [
                    { label: 'Projetos', to: '/' },
                    { label: projectName ?? 'Projeto', to: `/projects/${setlist.band_id}?tab=setlists` },
                    { label: setlist?.name ?? 'Setlist' },
                  ]
                : [
                    { label: 'Setlists', to: '/setlists' },
                    { label: setlist?.name ?? 'Setlist' },
                  ]
            } />
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
              <span className={styles.songsChip}>
                ♪ {songs.length} música{songs.length !== 1 ? 's' : ''}
                {totalMin > 0 ? ` · ~${totalMin} min` : ''}
              </span>
              <div className={styles.metaField}>
                <span className={styles.metaIcon}>📍</span>
                <input
                  className={styles.venueInput}
                  value={venue}
                  onChange={e => setVenue(e.target.value)}
                  onBlur={e => saveVenue(e.target.value)}
                  placeholder="Local / evento..."
                />
              </div>
              <div className={styles.metaField}>
                <span className={styles.metaIcon}>📅</span>
                <input
                  className={styles.dateInput}
                  type="date"
                  value={date}
                  onChange={e => saveDate(e.target.value)}
                />
              </div>
              <select
                className={styles.statusSelect}
                data-status={status}
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
            <button className={styles.deleteBtn} onClick={deleteSetlist}>🗑 Apagar</button>
            <button className={styles.dupBtn} onClick={() => setDuplicating(true)}>⧉ Duplicar</button>
            <button className={styles.concertBtn} onClick={() => navigate(`/setlist/${id}/concert`)}>
              ▶ Iniciar Concerto
            </button>
          </div>
        </div>

        {/* Song list — single column */}
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
                    onEdit={songId => navigate(`/songs/${songId}`)}
                    onRemove={removeSong}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
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
        <div className={styles.overlay} onClick={closeLibrary}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Biblioteca</span>
              <button className={styles.closeBtn} onClick={closeLibrary}>✕</button>
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
                <p>{setlist?.band_id ? 'Nenhuma música no repertório do projeto.' : 'Sem músicas na biblioteca.'}</p>
                <button
                  className={styles.addBtn}
                  onClick={() => {
                    closeLibrary()
                    navigate(setlist?.band_id ? `/search?project=${setlist.band_id}&setlist=${id}` : `/search?setlist=${id}`)
                  }}
                >
                  🔍 Pesquisar música nova
                </button>
              </div>
            ) : (
              <>
                {filteredLibrary.map(song => (
                  <div
                    key={song.id}
                    className={`${styles.libraryRow} ${libSelection.has(song.id) ? styles.libraryRowSelected : ''}`}
                    onClick={() => toggleSelection(song.id)}
                  >
                    <div className={styles.songInfo}>
                      <div className={styles.songTitle}>{song.title}</div>
                      <div className={styles.songArtist}>{song.artist} {song.has_sync && <span className={styles.syncBadge}>sync ✓</span>}</div>
                    </div>
                    <span className={libSelection.has(song.id) ? styles.selIconChecked : styles.selIcon}>
                      {libSelection.has(song.id) ? '✓' : '○'}
                    </span>
                  </div>
                ))}
                <button
                  className={styles.searchNewBtn}
                  onClick={() => {
                    closeLibrary()
                    navigate(setlist?.band_id ? `/search?project=${setlist.band_id}&setlist=${id}` : `/search?setlist=${id}`)
                  }}
                >
                  🔍 Pesquisar música que não está aqui
                </button>
                {libSelection.size > 0 && (
                  <div className={styles.modalAddBar}>
                    <button className={styles.addSelectedBtn} onClick={addSelectedSongs}>
                      + Adicionar {libSelection.size} música{libSelection.size !== 1 ? 's' : ''}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
