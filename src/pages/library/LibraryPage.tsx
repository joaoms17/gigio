import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { exportSongsPdf } from '../../lib/pdfExport'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './LibraryPage.module.css'

type FilterChip = 'all' | 'sync' | 'edited'

/** 245 → "4:05" */
function formatDuration(sec?: number): string | null {
  if (!sec || sec <= 0) return null
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function SearchIcon() {
  return (
    <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 16.5 L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function LibraryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const toast = useToast()
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

  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selection.has(s.id))

  /** Exporta as músicas filtradas atuais, pela ordem da vista */
  function exportPdf(withLyrics: boolean) {
    const ok = exportSongsPdf(
      filtered.map(s => ({ title: s.title, lyrics: s.edited_lyrics ?? s.lyrics })),
      { title: 'A minha biblioteca', withLyrics }
    )
    if (!ok) toast('Permite pop-ups para exportar o PDF.', { type: 'error' })
  }

  function toggleSelectAll() {
    setSelection(allFilteredSelected ? new Set() : new Set(filtered.map(s => s.id)))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Repertório</h1>
        <span className={styles.count}>{songs.length} música{songs.length !== 1 ? 's' : ''}</span>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchWrap}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            placeholder="Pesquisar por título ou artista..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className={styles.sortSelect} value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Ordenar">
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
        {selecting && (
          <button
            className={styles.chip}
            style={{ marginLeft: 'auto' }}
            onClick={toggleSelectAll}
          >
            {allFilteredSelected ? 'Limpar seleção' : 'Selecionar tudo'}
          </button>
        )}
        <button
          className={`${styles.chip} ${selecting ? styles.chipActive : ''}`}
          style={selecting ? undefined : { marginLeft: 'auto' }}
          onClick={() => selecting ? exitSelectMode() : setSelecting(true)}
        >
          {selecting ? '✕ Cancelar' : '☑ Selecionar'}
        </button>
      </div>

      {!loading && filtered.length > 0 && !selecting && (
        <div className={styles.exportRow}>
          <button className={styles.exportBtn} onClick={() => exportPdf(false)}>⤓ Exportar lista</button>
          <button className={styles.exportBtn} onClick={() => exportPdf(true)}>⤓ Exportar repertório</button>
        </div>
      )}

      <div className={styles.gridScroll}>
        {loading ? (
          <div className={styles.grid}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className={styles.cardSkeleton} aria-hidden="true">
                <div className="skeleton" style={{ height: 15, width: `${60 + (i % 3) * 12}%`, marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 12, width: `${35 + (i % 2) * 18}%` }} />
                <div className={styles.skeletonFooter}>
                  <div className="skeleton" style={{ height: 20, width: 38, borderRadius: 10 }} />
                  <div className="skeleton" style={{ height: 20, width: 46, borderRadius: 10 }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎵</div>
            <p>{search || chip !== 'all' || tagFilter ? 'Sem resultados com estes filtros' : 'Biblioteca vazia'}</p>
            {!search && chip === 'all' && !tagFilter && (
              <button className={styles.goSearch} onClick={() => navigate('/search')}>Ir buscar letras →</button>
            )}
          </div>
        ) : (
          <div className={styles.grid}>
            {filtered.map(song => {
              const isSelected = selection.has(song.id)
              const keyChip = song.performance_key ?? song.original_key
              const duration = formatDuration(song.duration_sec)
              return (
                <div
                  key={song.id}
                  className={`${styles.card} ${selecting && isSelected ? styles.cardSelected : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selecting ? isSelected : undefined}
                  onClick={() => selecting ? toggleSelect(song.id) : navigate(`/songs/${song.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') { selecting ? toggleSelect(song.id) : navigate(`/songs/${song.id}`) } }}
                >
                  {selecting ? (
                    <span
                      className={`${styles.selMark} ${isSelected ? styles.selMarkChecked : ''}`}
                      aria-hidden="true"
                    >
                      {isSelected ? '✓' : ''}
                    </span>
                  ) : (
                    <div className={styles.cardActions}>
                      <button
                        className={styles.iconBtn}
                        onClick={e => { e.stopPropagation(); navigate(`/songs/${song.id}`) }}
                        title="Editar"
                        aria-label={`Editar ${song.title}`}
                      >✎</button>
                      <button
                        className={`${styles.iconBtn} ${styles.deleteBtn}`}
                        onClick={e => { e.stopPropagation(); deleteSong(song) }}
                        disabled={deleting === song.id}
                        title="Eliminar"
                        aria-label={`Eliminar ${song.title}`}
                      >
                        {deleting === song.id ? '…' : '✕'}
                      </button>
                    </div>
                  )}
                  <div className={styles.cardTitle}>{song.title}</div>
                  <div className={styles.cardArtist}>{song.artist}</div>
                  <div className={styles.cardFooter}>
                    {keyChip && <span className={styles.keyChip}>{keyChip}</span>}
                    {duration && <span className={styles.duration}>{duration}</span>}
                    {song.has_sync && <span className={styles.syncBadge}>sync ✓</span>}
                  </div>
                </div>
              )
            })}
          </div>
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

      {/* FAB — nova música */}
      {!selecting && (
        <button className={styles.fab} onClick={() => navigate('/search')} aria-label="Nova música">
          <span className={styles.fabPlus} aria-hidden="true">＋</span>
          <span className={styles.fabLabel}>Nova música</span>
        </button>
      )}
    </div>
  )
}
