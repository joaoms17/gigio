import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './LibraryPage.module.css'

type FilterChip = 'all' | 'sync' | 'edited'

export default function LibraryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'title' | 'artist' | 'recent'>('title')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [chip, setChip] = useState<FilterChip>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  // Bulk selection
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('songs')
      .select('*')
      .eq('owner_id', user.id)
      .order('title')
      .then(({ data }) => {
        setSongs(data ?? [])
        setLoading(false)
      })
  }, [user])

  /** Which setlists use this song — shown before deleting */
  async function setlistsUsing(songIds: string[]): Promise<string[]> {
    const { data } = await supabase
      .from('setlist_songs')
      .select('setlist:setlists(name)')
      .in('song_id', songIds)
    const names = (data ?? []).map((r: any) => r.setlist?.name).filter(Boolean)
    return [...new Set(names)] as string[]
  }

  async function deleteSong(song: Song) {
    const used = await setlistsUsing([song.id])
    const usageMsg = used.length
      ? ` Está em ${used.length} concerto${used.length !== 1 ? 's' : ''}: ${used.slice(0, 4).join(', ')}${used.length > 4 ? '…' : ''}.`
      : ''
    if (!await confirmDialog({
      title: 'Eliminar música',
      message: `Eliminar "${song.title}"?${usageMsg} Será removida de todas as setlists.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })) return
    setDeleting(song.id)
    await supabase.from('songs').delete().eq('id', song.id)
    setSongs(prev => prev.filter(s => s.id !== song.id))
    setDeleting(null)
  }

  function toggleSelect(id: string) {
    setSelection(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelecting(false)
    setSelection(new Set())
  }

  async function bulkDelete() {
    const ids = [...selection]
    if (ids.length === 0) return
    const used = await setlistsUsing(ids)
    const usageMsg = used.length
      ? ` Algumas estão em setlists: ${used.slice(0, 4).join(', ')}${used.length > 4 ? '…' : ''}.`
      : ''
    if (!await confirmDialog({
      title: `Eliminar ${ids.length} música${ids.length !== 1 ? 's' : ''}`,
      message: `Eliminar ${ids.length} música${ids.length !== 1 ? 's' : ''} da biblioteca?${usageMsg} Serão removidas de todas as setlists.`,
      confirmLabel: 'Eliminar tudo',
      danger: true,
    })) return
    setBulkBusy(true)
    await supabase.from('songs').delete().in('id', ids)
    setSongs(prev => prev.filter(s => !selection.has(s.id)))
    setBulkBusy(false)
    exitSelectMode()
  }

  // All tags present in the library (for the tag filter row)
  const allTags = [...new Set(songs.flatMap(s => s.tags ?? []))].sort()

  const filtered = songs
    .filter(s =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.artist.toLowerCase().includes(search.toLowerCase())
    )
    .filter(s => {
      if (chip === 'sync') return !!s.has_sync
      if (chip === 'edited') return !!s.is_user_edited
      return true
    })
    .filter(s => !tagFilter || (s.tags ?? []).includes(tagFilter))
    .sort((a, b) => {
      if (sort === 'artist') return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
      if (sort === 'recent') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
      return a.title.localeCompare(b.title)
    })

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Músicas</h1>
          <span className={styles.count}>{songs.length} música{songs.length !== 1 ? 's' : ''}</span>
          <button className={styles.searchBtn} onClick={() => navigate('/search')}>+ Buscar letras</button>
        </div>

        <div className={styles.filterRow}>
          <input
            className={styles.searchInput}
            placeholder="Filtrar por título ou artista..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className={styles.sortSelect} value={sort} onChange={e => setSort(e.target.value as any)}>
            <option value="title">Título A–Z</option>
            <option value="artist">Artista A–Z</option>
            <option value="recent">Recentes</option>
          </select>
        </div>

        {/* Filter chips */}
        <div className={styles.chipRow}>
          {([['all', 'Todas'], ['sync', 'Com sync'], ['edited', 'Editadas']] as [FilterChip, string][]).map(([value, label]) => (
            <button
              key={value}
              className={`${styles.chip} ${chip === value ? styles.chipActive : ''}`}
              onClick={() => setChip(value)}
            >{label}</button>
          ))}
          {allTags.map(t => (
            <button
              key={t}
              className={`${styles.chip} ${tagFilter === t ? styles.chipActive : ''}`}
              onClick={() => setTagFilter(prev => prev === t ? null : t)}
            >#{t}</button>
          ))}
          <button
            className={`${styles.chip} ${selecting ? styles.chipActive : ''}`}
            style={{ marginLeft: 'auto' }}
            onClick={() => selecting ? exitSelectMode() : setSelecting(true)}
          >
            {selecting ? '✕ Cancelar' : '☑ Selecionar'}
          </button>
        </div>

        <div className={styles.list}>
          {loading ? (
            <>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} className={styles.row} style={{ pointerEvents: 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ height: 14, width: `${55 + (i % 3) * 12}%`, marginBottom: 7 }} />
                    <div className="skeleton" style={{ height: 11, width: `${30 + (i % 2) * 15}%` }} />
                  </div>
                </div>
              ))}
            </>
          ) : filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🎵</div>
              <p>{search || chip !== 'all' || tagFilter ? 'Sem resultados com estes filtros' : 'Biblioteca vazia'}</p>
              {!search && chip === 'all' && !tagFilter && (
                <button className={styles.goSearch} onClick={() => navigate('/search')}>Ir buscar letras →</button>
              )}
            </div>
          ) : (
            filtered.map(song => (
              <div
                key={song.id}
                className={`${styles.row} ${selecting && selection.has(song.id) ? styles.rowSelected : ''}`}
                onClick={() => selecting ? toggleSelect(song.id) : navigate(`/songs/${song.id}`)}
              >
                {selecting && (
                  <span className={selection.has(song.id) ? styles.selChecked : styles.selCircle}>
                    {selection.has(song.id) ? '✓' : '○'}
                  </span>
                )}
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitle}>{song.title}</div>
                  <div className={styles.rowArtist}>
                    {song.artist}
                    {song.has_sync && <span className={styles.syncBadge}>sync</span>}
                    <span className={`${styles.sourceBadge} ${styles[song.source]}`}>{song.source}</span>
                  </div>
                </div>
                {!selecting && (
                  <>
                    <button
                      className={styles.iconBtn}
                      onClick={e => { e.stopPropagation(); navigate(`/songs/${song.id}`) }}
                      title="Editar"
                    >✎</button>
                    <button
                      className={styles.iconBtn}
                      onClick={e => { e.stopPropagation(); deleteSong(song) }}
                      disabled={deleting === song.id}
                      title="Eliminar"
                    >
                      {deleting === song.id ? '...' : '✕'}
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Bulk actions bar */}
        {selecting && selection.size > 0 && (
          <div className={styles.bulkBar}>
            <span className={styles.bulkCount}>{selection.size} selecionada{selection.size !== 1 ? 's' : ''}</span>
            <button className={styles.bulkDeleteBtn} onClick={bulkDelete} disabled={bulkBusy}>
              {bulkBusy ? 'A eliminar...' : '🗑 Eliminar'}
            </button>
          </div>
        )}
      </div>
    </Layout>
  )
}
