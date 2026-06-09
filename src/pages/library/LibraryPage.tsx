import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import LyricsView from '../../components/LyricsView'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './LibraryPage.module.css'

export default function LibraryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Song | null>(null)
  const [search, setSearch] = useState('')
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
    if (!confirm(`Eliminar "${song.title}"? Será removida de todas as setlists.`)) return
    setDeleting(song.id)
    await supabase.from('songs').delete().eq('id', song.id)
    setSongs(prev => prev.filter(s => s.id !== song.id))
    if (selected?.id === song.id) setSelected(null)
    setDeleting(null)
  }

  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.artist.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Músicas</h1>
          <span className={styles.count}>{songs.length} música{songs.length !== 1 ? 's' : ''}</span>
          <button className={styles.searchBtn} onClick={() => navigate('/search')}>+ Buscar letras</button>
        </div>

        <input
          className={styles.searchInput}
          placeholder="Filtrar por título ou artista..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className={styles.layout}>
          <div className={styles.list}>
            {loading ? (
              <p className={styles.empty}>A carregar...</p>
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
                  className={`${styles.row} ${selected?.id === song.id ? styles.rowActive : ''}`}
                  onClick={() => setSelected(song)}
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
                    className={styles.deleteBtn}
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

          <div className={styles.preview}>
            {selected ? (
              <>
                <div className={styles.previewMeta}>
                  <div className={styles.previewTitle}>{selected.title}</div>
                  <div className={styles.previewArtist}>{selected.artist}</div>
                  {selected.duration_sec ? (
                    <div className={styles.previewDur}>
                      {Math.floor(selected.duration_sec / 60)}:{String(selected.duration_sec % 60).padStart(2, '0')}
                    </div>
                  ) : null}
                </div>
                <div className={styles.lyrics}>
                  {selected.lyrics
                    ? <LyricsView lyrics={selected.lyrics} />
                    : <span className={styles.noLyrics}>Sem letra guardada</span>
                  }
                </div>
              </>
            ) : (
              <div className={styles.previewEmpty}>
                <div className={styles.previewEmptyIcon}>📄</div>
                <p>Seleciona uma música para ver a letra</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
