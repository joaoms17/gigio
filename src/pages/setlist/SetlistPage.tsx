import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import SetlistImportModal from '../../components/SetlistImportModal'
import { supabase } from '../../lib/supabase'
import { exportSongsPdf } from '../../lib/pdfExport'
import { fmtSection } from '../../components/LyricsView'
import { useAuth } from '../../hooks/useAuth'
import {
  cacheSetlistMeta, getCachedSetlistMeta,
  cacheSetlistSongs, getCachedSetlistSongs,
} from '../../lib/concertCache'
import type { Setlist, SetlistSong, Song } from '../../types'
import styles from './SetlistPage.module.css'

type Row = SetlistSong & { song: Song }

function SortableSongRow({ ss, index, selected, onSelect, onEdit, onRemove, onOverrides }: {
  ss: Row; index: number; selected: boolean
  onSelect: (ss: Row) => void
  onEdit: (songId: string) => void; onRemove: (id: string) => void
  onOverrides: (ss: Row) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ss.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const hasOverrides = !!(ss.performance_key || ss.notes || ss.custom_intro || ss.custom_ending)
  // Clique na linha = selecionar para pré-visualizar; o modal de tom/notas
  // abre só via os chips (ou pelo botão "Tom & notas" no painel direito)
  const openOv = (e: MouseEvent) => { e.stopPropagation(); onOverrides(ss) }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.songRow} ${isDragging ? styles.dragging : ''} ${selected ? styles.songRowSelected : ''}`}
      onClick={() => onSelect(ss)}
      title="Pré-visualizar letra"
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
          {ss.performance_key && (
            <button
              className={styles.keyChip}
              onClick={openOv}
              aria-label={`Tom nesta setlist: ${ss.performance_key} — editar tom e notas`}
              title="Tom, notas, intro e final desta música nesta setlist"
            >{ss.performance_key}</button>
          )}
          {ss.notes && <span className={styles.notesIndicator} onClick={openOv} role="img" aria-label={`Notas: ${ss.notes}`} title={ss.notes}>📝</span>}
          {(ss.custom_intro || ss.custom_ending) && <span className={styles.notesIndicator} onClick={openOv} role="img" aria-label="Tem intro/final custom" title="Tem intro/final custom">🎬</span>}
          {ss.song?.has_sync && <span className={styles.syncBadge} aria-label="Letra sincronizada">sync ✓</span>}
          {!hasOverrides && (
            <button
              className={styles.ghostChip}
              onClick={openOv}
              title="Tom, notas, intro e final desta música nesta setlist"
            >＋ Tom · Notas</button>
          )}
        </div>
      </div>
      <div className={styles.songDur}>
        {ss.song?.duration_sec ? `${Math.floor(ss.song.duration_sec / 60)}:${String(ss.song.duration_sec % 60).padStart(2, '0')}` : ''}
      </div>
      <div className={styles.songActions}>
        <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); onEdit(ss.song_id) }} title="Editar música">✎</button>
        <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); onRemove(ss.id) }} title="Remover da setlist">✕</button>
      </div>
    </div>
  )
}

/** Pré-visualização de letra: secções [X] como etiquetas, linhas vazias como respiro */
function PreviewLyrics({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const t = line.trim()
        const sec = t.match(/^\[(.+?)\]$/)
        if (sec) return (
          <div key={i} className={styles.previewSectionRow}>
            <span className={styles.sectionTag}>{fmtSection(sec[1])}</span>
          </div>
        )
        if (t === '') return <div key={i} className={styles.previewBreak} />
        return <div key={i} className={styles.previewLine}>{line}</div>
      })}
    </>
  )
}

export default function SetlistPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const autoAddDone = useRef(false)
  const [setlist, setSetlist] = useState<Setlist | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [projectImage, setProjectImage] = useState<string | null>(null)
  const [projectColor, setProjectColor] = useState<string | null>(null)
  const [songs, setSongs] = useState<Row[]>([])
  const [library, setLibrary] = useState<Song[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [libSelection, setLibSelection] = useState<Set<string>>(new Set())
  const [showLibrary, setShowLibrary] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [songsLoading, setSongsLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [venueSuggestions, setVenueSuggestions] = useState<{ name: string; detail: string }[]>([])
  const [showVenueDrop, setShowVenueDrop] = useState(false)
  const venueDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [date, setDate] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [dupBusy, setDupBusy] = useState(false)
  const [removedSong, setRemovedSong] = useState<Row | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [canDelete, setCanDelete] = useState(false)

  // Painel direito (≥1024px): música selecionada para pré-visualização.
  // Derivado com fallback para a primeira música — sobrevive a remoções/reordenações.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Per-setlist song overrides modal
  const [overrideRow, setOverrideRow] = useState<Row | null>(null)
  const [ovKey, setOvKey] = useState('')
  const [ovNotes, setOvNotes] = useState('')
  const [ovIntro, setOvIntro] = useState('')
  const [ovEnding, setOvEnding] = useState('')
  const [ovSaving, setOvSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    if (!id || !user) return
    supabase.from('setlists').select('*, bands(name, image_url, color, owner_id)').eq('id', id).single()
      .then(async ({ data, error }) => {
        if (data && !error) {
          setIsOffline(false)
          setSetlist(data)
          setProjectName((data as any).bands?.name ?? null)
          setProjectImage((data as any).bands?.image_url ?? null)
          setProjectColor((data as any).bands?.color ?? null)
          setName(data.name)
          setVenue(data.venue ?? '')
          setDate(data.date ?? '')
          cacheSetlistMeta(id, data)
          // Check delete permission: setlist owner OR band owner OR band admin
          const isSetlistOwner = data.owner_id === user.id
          const isBandOwner = (data as any).bands?.owner_id === user.id
          if (isSetlistOwner || isBandOwner) {
            setCanDelete(true)
          } else if (data.band_id) {
            const { data: mem } = await supabase
              .from('band_members').select('role')
              .eq('band_id', data.band_id).eq('user_id', user.id).maybeSingle()
            setCanDelete(mem?.role === 'owner' || mem?.role === 'admin')
          }
        } else {
          const cached = getCachedSetlistMeta<any>(id)
          if (cached) {
            setIsOffline(true)
            setSetlist(cached)
            setProjectName(cached.bands?.name ?? null)
            setProjectImage(cached.bands?.image_url ?? null)
            setProjectColor(cached.bands?.color ?? null)
            setName(cached.name)
            setVenue(cached.venue ?? '')
            setDate(cached.date ?? '')
          }
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
    const { data, error } = await supabase
      .from('setlist_songs')
      .select('*, song:songs(*)')
      .eq('setlist_id', id)
      .order('position')
    if (data && !error) {
      setSongs(data as any)
      cacheSetlistSongs(id, data)
    } else {
      const cached = getCachedSetlistSongs<Row>(id)
      if (cached) setSongs(cached)
    }
    setSongsLoading(false)
  }

  async function loadLibrary() {
    if (!user || libraryLoading) return
    // Abre o modal já com skeleton — o fetch pode demorar 1-3s em rede lenta
    setLibrary([])
    setLibSelection(new Set())
    setLibrarySearch('')
    setLibraryLoading(true)
    setShowLibrary(true)
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
    setLibraryLoading(false)
  }

  function closeLibrary() {
    setShowLibrary(false)
    setLibSelection(new Set())
  }

  async function addSelectedSongs(): Promise<boolean> {
    if (!id || libSelection.size === 0) return true
    const toAdd = library.filter(s => libSelection.has(s.id))
    // positions can have gaps after removals, so length would collide with
    // the unique (setlist_id, position) constraint — use max position + 1
    const basePos = songs.reduce((m, s) => Math.max(m, s.position), -1) + 1
    const { error } = await supabase.from('setlist_songs').insert(
      toAdd.map((s, i) => ({ setlist_id: id, song_id: s.id, position: basePos + i }))
    )
    if (error) { toast('Erro ao adicionar: ' + error.message, { type: 'error' }); return false }
    await loadSongs()
    closeLibrary()
    return true
  }

  // Atalho para a pesquisa: adiciona primeiro as músicas já selecionadas
  // (antes descartava-as sem aviso) e só depois navega
  async function goToSearch() {
    if (libSelection.size > 0) {
      const ok = await addSelectedSongs()
      if (!ok) return
    } else {
      closeLibrary()
    }
    navigate(setlist?.band_id ? `/search?project=${setlist.band_id}&setlist=${id}` : `/search?setlist=${id}`)
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
    setVenueSuggestions([])
    setShowVenueDrop(false)
    await supabase.from('setlists').update({ venue: val || null }).eq('id', id)
  }

  function onVenueInput(val: string) {
    setVenue(val)
    if (venueDebounceRef.current) clearTimeout(venueDebounceRef.current)
    if (val.trim().length < 3) { setVenueSuggestions([]); setShowVenueDrop(false); return }
    venueDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&accept-language=pt`, { headers: { 'Accept-Language': 'pt' } })
        const data: { display_name: string }[] = await res.json()
        const suggestions = data.map(r => { const parts = r.display_name.split(','); return { name: parts[0].trim(), detail: parts.slice(1, 3).map(s => s.trim()).join(', ') } })
        setVenueSuggestions(suggestions)
        setShowVenueDrop(suggestions.length > 0)
      } catch { /* ignore */ }
    }, 400)
  }

  async function saveDate(val: string) {
    if (!id) return
    setDate(val)
    await supabase.from('setlists').update({ date: val || null }).eq('id', id)
  }

  function openOverrides(ss: Row) {
    setOverrideRow(ss)
    setOvKey(ss.performance_key ?? '')
    setOvNotes(ss.notes ?? '')
    setOvIntro(ss.custom_intro ?? '')
    setOvEnding(ss.custom_ending ?? '')
  }

  async function saveOverrides() {
    if (!overrideRow) return
    setOvSaving(true)
    const patch = {
      performance_key: ovKey.trim() || null,
      notes: ovNotes.trim() || null,
      custom_intro: ovIntro.trim() || null,
      custom_ending: ovEnding.trim() || null,
    }
    await supabase.from('setlist_songs').update(patch).eq('id', overrideRow.id)
    setSongs(prev => prev.map(s => s.id === overrideRow.id ? ({ ...s, ...patch } as Row) : s))
    setOvSaving(false)
    setOverrideRow(null)
  }

  async function removeSong(ssId: string) {
    const row = songs.find(s => s.id === ssId)
    if (!row) return
    const { error } = await supabase.from('setlist_songs').delete().eq('id', ssId)
    if (error) { toast('Erro ao remover: ' + error.message, { type: 'error' }); return }
    setSongs(prev => prev.filter(s => s.id !== ssId))
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setRemovedSong(row)
    undoTimerRef.current = setTimeout(() => setRemovedSong(null), 6000)
  }

  async function undoRemove() {
    if (!removedSong) return
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    const row = removedSong
    setRemovedSong(null)
    const { data, error } = await supabase.from('setlist_songs').insert({
      setlist_id: row.setlist_id,
      song_id: row.song_id,
      position: row.position,
      notes: row.notes ?? null,
      performance_key: row.performance_key ?? null,
      custom_intro: row.custom_intro ?? null,
      custom_ending: row.custom_ending ?? null,
    }).select('*, song:songs(*)').single()
    if (error || !data) { toast('Erro ao anular: ' + (error?.message ?? 'tenta de novo'), { type: 'error' }); return }
    setSongs(prev => [...prev, data as Row].sort((a, b) => a.position - b.position))
  }

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [])

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
    // 2 upserts em lote em vez de 2×N updates. As duas fases são obrigatórias:
    // unique(setlist_id, position) — primeiro afasta tudo (10000+i), depois assenta (i)
    const rowsAt = (offset: number) => order.map((ss, i) => ({
      id: ss.id, setlist_id: ss.setlist_id, song_id: ss.song_id, position: offset + i,
    }))
    const { error: e1 } = await supabase.from('setlist_songs').upsert(rowsAt(10000), { onConflict: 'id' })
    if (e1) {
      toast('Erro ao reordenar: ' + e1.message, { type: 'error' })
      await loadSongs()
      return
    }
    const { error: e2 } = await supabase.from('setlist_songs').upsert(rowsAt(0), { onConflict: 'id' })
    if (e2) {
      toast('Erro ao reordenar: ' + e2.message, { type: 'error' })
      await loadSongs()
    }
  }

  async function saveName() {
    if (!id || !name.trim()) return
    if (name === setlist?.name) { setEditingName(false); return }
    await supabase.from('setlists').update({ name }).eq('id', id)
    setSetlist(prev => prev ? { ...prev, name } : prev)
    setEditingName(false)
  }

  function cancelNameEdit() {
    setName(setlist?.name ?? '')
    setEditingName(false)
  }

  async function deleteSetlist() {
    if (!id) return
    if (!await confirmDialog({ title: 'Apagar concerto', message: `Apagar o concerto "${setlist?.name}"? Esta ação não pode ser desfeita.`, confirmLabel: 'Apagar', danger: true })) return
    const { error: e1 } = await supabase.from('setlist_songs').delete().eq('setlist_id', id)
    if (e1) { toast('Erro ao apagar músicas do concerto: ' + e1.message, { type: 'error' }); return }
    const { error: e2 } = await supabase.from('setlists').delete().eq('id', id)
    if (e2) { toast('Erro ao apagar concerto: ' + e2.message, { type: 'error' }); return }
    setlist?.band_id ? navigate(`/projects/${setlist.band_id}?tab=setlists`) : navigate('/setlists')
  }

  async function duplicateTo(projectId: string) {
    if (!user || !setlist || dupBusy) return
    // Mantém o picker aberto com busy — evita re-toques que criam duplicados
    setDupBusy(true)
    const { data: newSl, error } = await supabase
      .from('setlists')
      .insert({ name: `${setlist.name} (cópia)`, owner_id: user.id, band_id: projectId, is_shared: true })
      .select()
      .single()
    if (error) {
      setDupBusy(false)
      toast('Erro ao duplicar: ' + error.message, { type: 'error' })
      return
    }
    if (newSl && songs.length) {
      await supabase.from('setlist_songs').insert(
        songs.map((s, i) => ({ setlist_id: newSl.id, song_id: s.song_id, position: i }))
      )
    }
    setDupBusy(false)
    setDuplicating(false)
    if (newSl) navigate(`/setlist/${newSl.id}`)
  }

  function exportPdf(withLyrics: boolean) {
    if (!setlist) return
    const ok = exportSongsPdf(
      songs.map(ss => ({
        title: ss.song?.title ?? '',
        lyrics: ss.song?.edited_lyrics ?? ss.song?.lyrics,
      })),
      {
        title: setlist.name,
        accent: projectColor,
        logoUrl: projectName ? projectImage : null,
        logoInitial: projectName,
        withLyrics,
      }
    )
    // false = pop-up bloqueado; o utilizador pode permitir e tocar de novo
    if (!ok) toast('Permite pop-ups para exportar o PDF.', { type: 'error' })
  }

  const selectedRow = songs.find(s => s.id === selectedId) ?? songs[0] ?? null
  const previewText = ((selectedRow?.song?.edited_lyrics ?? selectedRow?.song?.lyrics) ?? '').trim()
  const overrideSummary = selectedRow
    ? [
        selectedRow.performance_key && `tom neste concerto: ${selectedRow.performance_key}`,
        selectedRow.custom_intro && `intro: ${selectedRow.custom_intro}`,
        selectedRow.custom_ending && `final: ${selectedRow.custom_ending}`,
        selectedRow.notes && `notas: ${selectedRow.notes}`,
      ].filter(Boolean).join(' · ')
    : ''

  const totalSec = songs.reduce((acc, s) => acc + (s.song?.duration_sec ?? 0), 0)
  const totalMin = Math.floor(totalSec / 60)
  const durationLabel = totalMin >= 60
    ? `${Math.floor(totalMin / 60)}h${String(totalMin % 60).padStart(2, '0')}`
    : `${totalMin} min`
  const filteredLibrary = library.filter(s =>
    !librarySearch || `${s.title} ${s.artist}`.toLowerCase().includes(librarySearch.toLowerCase())
  )

  return (
    <>
      <div className={styles.page}>
        {isOffline && (
          <div className={styles.offlineBanner}>
            Sem ligação — a mostrar dados em cache
          </div>
        )}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Breadcrumbs items={
              setlist?.band_id
                ? [
                    { label: 'Projetos', to: '/' },
                    { label: projectName ?? 'Projeto', to: `/projects/${setlist.band_id}?tab=setlists` },
                    { label: setlist?.name ?? 'Concerto' },
                  ]
                : [
                    { label: 'Concertos', to: '/setlists' },
                    { label: setlist?.name ?? 'Concerto' },
                  ]
            } />
            {editingName ? (
              <input
                className={styles.nameInput}
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveName()
                  else if (e.key === 'Escape') cancelNameEdit()
                }}
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
                {totalMin > 0 ? ` · ~${durationLabel}` : ''}
              </span>
              <div className={styles.venueWrap}>
                <div className={styles.metaField}>
                  <span className={styles.metaIcon}>📍</span>
                  <input
                    className={styles.venueInput}
                    value={venue}
                    onChange={e => onVenueInput(e.target.value)}
                    onBlur={e => saveVenue(e.target.value)}
                    placeholder="Local / evento..."
                  />
                </div>
                {showVenueDrop && (
                  <div className={styles.venueDrop}>
                    {venueSuggestions.map((s, i) => (
                      <div key={i} className={styles.venueDropItem}
                        onMouseDown={e => { e.preventDefault(); saveVenue(s.name) }}
                      >
                        <span className={styles.venueDropName}>{s.name}</span>
                        {s.detail && <span className={styles.venueDropDetail}>{s.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}
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
            </div>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.concertBtn} onClick={() => navigate(`/setlist/${id}/concert`)}>
              ▶ Iniciar Concerto
            </button>
            <div className={styles.secondaryActions}>
              {setlist?.band_id && (
                <button className={styles.dupBtn} onClick={() => setShowImport(true)}>Importar PDF</button>
              )}
              <button className={styles.dupBtn} onClick={() => exportPdf(false)}>Exportar lista</button>
              <button className={styles.dupBtn} onClick={() => exportPdf(true)}>Exportar repertório</button>
              <button className={styles.dupBtn} onClick={() => setDuplicating(true)}>Duplicar</button>
              {canDelete && <button className={styles.deleteBtn} onClick={deleteSetlist}>Apagar</button>}
            </div>
          </div>
        </div>

        {/* ≥1024px: duas colunas — alinhamento à esquerda, pré-visualização à direita */}
        <div className={styles.columns}>
          <div className={styles.songList}>
            <div className={styles.listHeader}>
              <span className={styles.listTitle}>Ordem das músicas</span>
              <button className={styles.addBtn} onClick={loadLibrary} disabled={libraryLoading}>
                {libraryLoading ? 'A carregar...' : '+ Adicionar'}
              </button>
            </div>

            {songsLoading ? (
              <div aria-hidden="true">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className={`skeleton ${styles.skeletonRow}`} />
                ))}
              </div>
            ) : songs.length === 0 ? (
              <div className={styles.empty}>
                <p>Sem músicas ainda</p>
                <button className={styles.addBtn} onClick={loadLibrary} disabled={libraryLoading}>+ Adicionar música</button>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={songs.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  {songs.map((ss, i) => (
                    <SortableSongRow
                      key={ss.id}
                      ss={ss}
                      index={i}
                      selected={selectedRow?.id === ss.id}
                      onSelect={row => setSelectedId(row.id)}
                      onEdit={songId => navigate(`/songs/${songId}?setlist=${id}`)}
                      onRemove={removeSong}
                      onOverrides={openOverrides}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>

          {/* Painel da música selecionada — só leitura + 2 ações; escondido <1024px via CSS */}
          <aside className={styles.previewPanel} aria-label="Pré-visualização da música selecionada">
            {songsLoading ? (
              <div aria-hidden="true">
                {[0, 1, 2].map(i => (
                  <div key={i} className={`skeleton ${styles.skeletonRow}`} />
                ))}
              </div>
            ) : !selectedRow ? (
              <div className={styles.previewEmpty}>
                <span className={styles.previewEmptyIcon} aria-hidden="true">♪</span>
                <p>Adiciona músicas ao alinhamento para veres a letra aqui.</p>
              </div>
            ) : (
              <>
                <div className={styles.previewHeader}>
                  <div className={styles.previewHeadText}>
                    <h2 className={styles.previewSongTitle}>{selectedRow.song?.title}</h2>
                    <div className={styles.previewArtist}>{selectedRow.song?.artist}</div>
                    {overrideSummary && <div className={styles.previewOverridesLine}>{overrideSummary}</div>}
                  </div>
                  <div className={styles.previewActions}>
                    <button
                      className={styles.previewActionBtn}
                      onClick={() => navigate(`/songs/${selectedRow.song_id}?setlist=${id}`)}
                    >✎ Editar letra</button>
                    <button
                      className={styles.previewActionBtn}
                      onClick={() => openOverrides(selectedRow)}
                    >Tom & notas</button>
                  </div>
                </div>
                {previewText ? (
                  <div className={styles.previewBody}>
                    <PreviewLyrics text={previewText} />
                  </div>
                ) : (
                  <div className={styles.previewEmpty}>
                    <span className={styles.previewEmptyIcon} aria-hidden="true">🎤</span>
                    <p>Esta música ainda não tem letra.</p>
                    <button
                      className={styles.addBtn}
                      onClick={() => navigate(`/songs/${selectedRow.song_id}?setlist=${id}`)}
                    >+ Adicionar letra</button>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      </div>

      {/* Per-setlist overrides modal */}
      {overrideRow && (
        <div className={styles.overlay} onClick={() => setOverrideRow(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.modalTitle}>{overrideRow.song?.title}</span>
                <div className={styles.ovSubtitle}>Só neste concerto — não altera a música original</div>
              </div>
              <button className={styles.closeBtn} onClick={() => setOverrideRow(null)} aria-label="Fechar">✕</button>
            </div>

            <div className={styles.ovField}>
              <label className={styles.ovLabel}>Tom nesta setlist</label>
              <input
                className={styles.ovInput}
                value={ovKey}
                onChange={e => setOvKey(e.target.value)}
                placeholder={overrideRow.song?.performance_key || overrideRow.song?.original_key || 'ex: G, Am, F#'}
              />
            </div>

            <div className={styles.ovField}>
              <label className={styles.ovLabel}>Intro</label>
              <input
                className={styles.ovInput}
                value={ovIntro}
                onChange={e => setOvIntro(e.target.value)}
                placeholder="ex: 4 compassos só bateria"
              />
            </div>

            <div className={styles.ovField}>
              <label className={styles.ovLabel}>Final</label>
              <input
                className={styles.ovInput}
                value={ovEnding}
                onChange={e => setOvEnding(e.target.value)}
                placeholder="ex: termina em fade, segue direto para a próxima"
              />
            </div>

            <div className={styles.ovField}>
              <label className={styles.ovLabel}>Notas</label>
              <textarea
                className={styles.ovTextarea}
                value={ovNotes}
                onChange={e => setOvNotes(e.target.value)}
                placeholder="Notas visíveis no modo concerto..."
                rows={3}
              />
            </div>

            <button className={styles.ovSaveBtn} onClick={saveOverrides} disabled={ovSaving}>
              {ovSaving ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {showImport && setlist?.band_id && (
        <SetlistImportModal
          setlistId={id!}
          projectId={setlist.band_id}
          currentPosition={songs.length}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadSongs() }}
        />
      )}

      {duplicating && (
        <ProjectPickerModal
          title="Duplicar concerto para que projeto?"
          onPick={duplicateTo}
          onClose={() => !dupBusy && setDuplicating(false)}
          busy={dupBusy}
        />
      )}

      {showLibrary && (
        <div className={styles.overlay} onClick={closeLibrary}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Biblioteca</span>
              <button className={styles.closeBtn} onClick={closeLibrary} aria-label="Fechar">✕</button>
            </div>
            <input
              className={styles.librarySearch}
              placeholder="Filtrar músicas..."
              value={librarySearch}
              onChange={e => setLibrarySearch(e.target.value)}
              autoFocus
            />
            {libraryLoading ? (
              <div aria-hidden="true">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`skeleton ${styles.skeletonRow}`} />
                ))}
              </div>
            ) : library.length === 0 ? (
              <div className={styles.modalEmpty}>
                <p>{setlist?.band_id ? 'Nenhuma música no repertório do projeto.' : 'Sem músicas na biblioteca.'}</p>
                <button className={styles.addBtn} onClick={goToSearch}>
                  🔍 Pesquisar música nova
                </button>
              </div>
            ) : (
              <>
                <button className={styles.searchNewBtn} onClick={goToSearch}>
                  🔍 Pesquisar música que não está aqui
                </button>
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

      {removedSong && (
        <div className={styles.undoSnackbar} role="status">
          <span className={styles.undoText}>Música removida</span>
          <button className={styles.undoBtn} onClick={undoRemove}>Anular</button>
        </div>
      )}
    </>
  )
}
