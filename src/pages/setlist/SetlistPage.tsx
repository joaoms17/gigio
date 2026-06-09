import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Setlist, SetlistSong, Song } from '../../types'
import styles from './SetlistPage.module.css'

export default function SetlistPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [setlist, setSetlist] = useState<Setlist | null>(null)
  const [songs, setSongs] = useState<(SetlistSong & { song: Song })[]>([])
  const [library, setLibrary] = useState<Song[]>([])
  const [showLibrary, setShowLibrary] = useState(false)
  const [selected, setSelected] = useState<Song | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')

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
    loadSongs()
  }

  async function moveUp(index: number) {
    if (index === 0) return
    const a = songs[index], b = songs[index - 1]
    await Promise.all([
      supabase.from('setlist_songs').update({ position: b.position }).eq('id', a.id),
      supabase.from('setlist_songs').update({ position: a.position }).eq('id', b.id),
    ])
    loadSongs()
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
              <span className={styles.listTitle}>Músicas</span>
              <button className={styles.addBtn} onClick={loadLibrary}>+ Adicionar</button>
            </div>

            {songs.length === 0 ? (
              <div className={styles.empty}>
                <p>Sem músicas ainda</p>
                <button className={styles.addBtn} onClick={loadLibrary}>+ Adicionar música</button>
              </div>
            ) : (
              songs.map((ss, i) => (
                <div key={ss.id} className={styles.songRow} onClick={() => setSelected(ss.song)}>
                  <div className={styles.songNum}>{i + 1}</div>
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
                  <div className={styles.songActions}>
                    <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); moveUp(i) }} disabled={i === 0}>↑</button>
                    <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); removeSong(ss.id) }}>✕</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className={styles.preview}>
            <div className={styles.previewTitle}>
              {selected ? `${selected.title} — ${selected.artist}` : 'Seleciona uma música'}
            </div>
            <div className={styles.lyrics}>
              {selected?.lyrics ? selected.lyrics.split('\n').map((line, i) => (
                <div key={i} className={line === '' ? styles.lyricBreak : styles.lyricLine}>{line || ' '}</div>
              )) : <span className={styles.lyricHint}>A letra aparece aqui</span>}
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
