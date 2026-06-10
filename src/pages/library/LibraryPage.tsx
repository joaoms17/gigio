import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './LibraryPage.module.css'

export default function LibraryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'title' | 'artist' | 'recent'>('title')
  const [deleting, setDeleting] = useState<string | null>(null)

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

  async function deleteSong(song: Song) {
    if (!await confirmDialog({ title: 'Eliminar música', message: `Eliminar "${song.title}"? Será removida de todas as setlists.`, confirmLabel: 'Eliminar', danger: true })) return
    setDeleting(song.id)
    await supabase.from('songs').delete().eq('id', song.id)
    setSongs(prev => prev.filter(s => s.id !== song.id))
    setDeleting(null)
  }

  const filtered = songs
    .filter(s =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.artist.toLowerCase().includes(search.toLowerCase())
    )
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
              <p>{search ? `Sem resultados para "${search}"` : 'Biblioteca vazia'}</p>
              {!search && <button className={styles.goSearch} onClick={() => navigate('/search')}>Ir buscar letras →</button>}
            </div>
          ) : (
            filtered.map(song => (
              <div
                key={song.id}
                className={styles.row}
                onClick={() => navigate(`/songs/${song.id}`)}
              >
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitle}>{song.title}</div>
                  <div className={styles.rowArtist}>
                    {song.artist}
                    {song.has_sync && <span className={styles.syncBadge}>sync</span>}
                    <span className={`${styles.sourceBadge} ${styles[song.source]}`}>{song.source}</span>
                  </div>
                </div>
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
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  )
}
