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
import SetlistImportModal from '../../components/SetlistImportModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  cacheSetlistMeta, getCachedSetlistMeta,
  cacheSetlistSongs, getCachedSetlistSongs,
} from '../../lib/concertCache'
import type { Setlist, SetlistSong, Song } from '../../types'
import styles from './SetlistPage.module.css'

type Row = SetlistSong & { song: Song }

function SortableSongRow({ ss, index, onEdit, onRemove, onOverrides }: {
  ss: Row; index: number
  onEdit: (songId: string) => void; onRemove: (id: string) => void
  onOverrides: (ss: Row) => void
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
      <div className={styles.songInfo} onClick={() => onOverrides(ss)} style={{ cursor: 'pointer' }} title="Tom, notas, intro e final desta música nesta setlist">
        <div className={styles.songTitle}>{ss.song?.title}</div>
        <div className={styles.songArtist}>
          {ss.song?.artist}
          {ss.performance_key && <span className={styles.keyChip}>{ss.performance_key}</span>}
          {ss.notes && <span className={styles.notesIndicator} title={ss.notes}>📝</span>}
          {(ss.custom_intro || ss.custom_ending) && <span className={styles.notesIndicator} title="Tem intro/final custom">🎬</span>}
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
  const [projectImage, setProjectImage] = useState<string | null>(null)
  const [projectColor, setProjectColor] = useState<string | null>(null)
  const [songs, setSongs] = useState<Row[]>([])
  const [library, setLibrary] = useState<Song[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [libSelection, setLibSelection] = useState<Set<string>>(new Set())
  const [showLibrary, setShowLibrary] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [venueSuggestions, setVenueSuggestions] = useState<{ name: string; detail: string }[]>([])
  const [showVenueDrop, setShowVenueDrop] = useState(false)
  const venueDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [date, setDate] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [canDelete, setCanDelete] = useState(false)

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
    if (!await confirmDialog({ title: 'Apagar concerto', message: `Apagar o concerto "${setlist?.name}"? Esta ação não pode ser desfeita.`, confirmLabel: 'Apagar', danger: true })) return
    const { error: e1 } = await supabase.from('setlist_songs').delete().eq('setlist_id', id)
    if (e1) { alert('Erro ao apagar músicas do concerto: ' + e1.message); return }
    const { error: e2 } = await supabase.from('setlists').delete().eq('id', id)
    if (e2) { alert('Erro ao apagar concerto: ' + e2.message); return }
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

  function exportPdf() {
    if (!setlist) return
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const rows = songs.map((ss, i) => `
      <div class="song">
        <span class="num">${i + 1}</span>
        <span class="title">${esc(ss.song?.title ?? '')}</span>
      </div>`
    ).join('')
    const accent = projectColor ?? '#FF4D6D'
    const logoBlock = projectName
      ? projectImage
        ? `<img class="logo" src="${esc(projectImage)}" alt="${esc(projectName)}" />`
        : `<div class="logoInitial">${esc(projectName.charAt(0).toUpperCase())}</div>`
      : ''
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(setlist.name)}</title>
      <style>
        @page { size: A4; margin: 18mm 20mm; }
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, 'Segoe UI', sans-serif;
          color: #111; margin: 0; text-align: center;
        }
        .toolbar {
          position: sticky; top: 0; display: flex; gap: 10px; justify-content: flex-end;
          padding: 10px 16px 10px; background: #fff; border-bottom: 1px solid #eee;
        }
        .toolbar button {
          font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
          padding: 9px 20px; border-radius: 10px; border: 1px solid #ccc; background: #f5f5f5;
        }
        .toolbar .print { background: ${accent}; border-color: ${accent}; color: #fff; }
        .header {
          padding: 14px 0 10px;
          display: flex; align-items: center; justify-content: center; gap: 16px;
        }
        .logo { width: 64px; height: 64px; border-radius: 14px; object-fit: cover; flex-shrink: 0; }
        .logoInitial {
          width: 64px; height: 64px; border-radius: 14px; flex-shrink: 0;
          background: ${accent}; color: #fff;
          font-size: 28px; font-weight: 900;
          display: flex; align-items: center; justify-content: center;
        }
        .headerText { text-align: left; }
        .concertName { font-size: 22px; font-weight: 900; letter-spacing: -0.3px; line-height: 1.2; }
        .divider { width: 36px; height: 2.5px; background: ${accent}; border: none; border-radius: 2px; margin: 10px auto; }
        .songs { padding: 0; }
        .song {
          display: flex; align-items: baseline; justify-content: center; gap: 7px;
          padding: 2px 0;
          page-break-inside: avoid;
        }
        .num { font-size: 11px; color: #bbb; font-weight: 700; min-width: 18px; text-align: right; flex-shrink: 0; }
        .title { font-size: 17px; font-weight: 700; }
        @media print { .toolbar { display: none; } }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.close()">✕ Fechar</button>
        <button class="print" onclick="window.print()">🖨 Imprimir / PDF</button>
      </div>
      <div class="header">
        ${logoBlock}
        <div class="headerText">
          <div class="concertName">${esc(setlist.name)}</div>
        </div>
      </div>
      <hr class="divider" />
      <div class="songs">${rows}</div>
      <script>
        window.onload = () => {
          const img = document.querySelector('img.logo')
          const go = () => setTimeout(() => window.print(), 100)
          if (img && !img.complete) {
            let done = false
            const once = () => { if (!done) { done = true; go() } }
            img.onload = once; img.onerror = once
            setTimeout(once, 1500)
          } else go()
        }
      <\/script>
      </body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Permite pop-ups para exportar o PDF.'); return }
    w.document.write(html)
    w.document.close()
  }

  const totalSec = songs.reduce((acc, s) => acc + (s.song?.duration_sec ?? 0), 0)
  const totalMin = Math.floor(totalSec / 60)
  const durationLabel = totalMin >= 60
    ? `${Math.floor(totalMin / 60)}h${String(totalMin % 60).padStart(2, '0')}`
    : `${totalMin} min`
  const filteredLibrary = library.filter(s =>
    !librarySearch || `${s.title} ${s.artist}`.toLowerCase().includes(librarySearch.toLowerCase())
  )

  return (
    <Layout>
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
                {totalMin > 0 ? ` · ~${durationLabel}` : ''}
              </span>
            </div>
            <div className={styles.dateVenueGroup}>
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
              <button className={styles.dupBtn} onClick={exportPdf}>Exportar PDF</button>
              <button className={styles.dupBtn} onClick={() => setDuplicating(true)}>Duplicar</button>
              {canDelete && <button className={styles.deleteBtn} onClick={deleteSetlist}>Apagar</button>}
            </div>
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
                    onEdit={songId => navigate(`/songs/${songId}?setlist=${id}`)}
                    onRemove={removeSong}
                    onOverrides={openOverrides}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
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
              <button className={styles.closeBtn} onClick={() => setOverrideRow(null)}>✕</button>
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
