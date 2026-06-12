import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './HomePage.module.css'

interface SetlistCard {
  id: string
  name: string
  date: string | null
  is_shared: boolean
  band: { name: string } | null
  setlist_songs: { song: { duration_sec: number | null; has_sync: boolean } | null }[]
}

interface Stats {
  setlistsTotal: number
  setlistsShared: number
  songsTotal: number
  songsWithLyrics: number
  bandsTotal: number
  membersTotal: number
}

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [setlists, setSetlists] = useState<SetlistCard[]>([])
  const [stats, setStats] = useState<Stats>({ setlistsTotal: 0, setlistsShared: 0, songsTotal: 0, songsWithLyrics: 0, bandsTotal: 0, membersTotal: 0 })
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (!user) return
    load()
  }, [user])

  async function load() {
    if (!user) return
    const [slRes, songsRes, bandsRes] = await Promise.all([
      supabase.from('setlists')
        .select('id, name, date, is_shared, band:bands(name), setlist_songs(song:songs(duration_sec, has_sync))')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('songs').select('id, lyrics').eq('owner_id', user.id),
      supabase.from('band_members').select('bands(id, name)').eq('user_id', user.id),
    ])

    const sl = (slRes.data ?? []) as unknown as SetlistCard[]
    setSetlists(sl)

    const songs = songsRes.data ?? []
    const myBands = (bandsRes.data ?? []).map((r: any) => r.bands).filter(Boolean)
    const bandIds = myBands.map((b: any) => b.id)

    let membersTotal = 0
    if (bandIds.length) {
      const { count } = await supabase.from('band_members').select('*', { count: 'exact', head: true }).in('band_id', bandIds)
      membersTotal = count ?? 0
    }

    setStats({
      setlistsTotal: sl.length,
      setlistsShared: sl.filter(s => s.is_shared).length,
      songsTotal: songs.length,
      songsWithLyrics: songs.filter((s: any) => (s.lyrics ?? '').trim().length > 0).length,
      bandsTotal: myBands.length,
      membersTotal,
    })
    setLoading(false)
  }

  async function createInProject(projectId: string) {
    if (!user) return
    const { data } = await supabase
      .from('setlists')
      .insert({ name: 'Novo Concerto', owner_id: user.id, band_id: projectId, is_shared: true })
      .select()
      .single()
    if (data) navigate(`/setlist/${data.id}`)
  }
  const createSetlist = () => setPicking(true)

  function cardInfo(s: SetlistCard) {
    const songs = s.setlist_songs ?? []
    const count = songs.length
    const totalSec = songs.reduce((a, x) => a + (x.song?.duration_sec ?? 0), 0)
    const hasSync = songs.some(x => x.song?.has_sync)
    return { count, totalMin: Math.floor(totalSec / 60), hasSync }
  }

  const displayName = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? ''

  // próximo concerto = setlist com data futura mais próxima
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const upcoming = setlists
    .filter(s => s.date && new Date(s.date) >= today)
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())[0]

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 className={styles.title}>Olá, {displayName}</h1>
          {upcoming && (
            <p className={styles.nextConcert}>
              Próximo concerto: <strong>{upcoming.band?.name ?? upcoming.name}</strong> · {new Date(upcoming.date!).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}
            </p>
          )}
        </div>

        <div className={styles.stats}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Concertos</div>
            <div className={styles.statNum}>{stats.setlistsTotal}</div>
            <div className={styles.statSub}>{stats.setlistsShared} partilhada{stats.setlistsShared !== 1 ? 's' : ''}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Músicas</div>
            <div className={styles.statNum}>{stats.songsTotal}</div>
            <div className={styles.statSub}>{stats.songsWithLyrics} com letras</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Projetos</div>
            <div className={styles.statNum}>{stats.bandsTotal}</div>
            <div className={styles.statSub}>{stats.membersTotal} membro{stats.membersTotal !== 1 ? 's' : ''} total</div>
          </div>
        </div>

        <div className={styles.sectionLabel}>CONCERTOS RECENTES</div>
        {loading ? (
          <p className={styles.empty}>A carregar...</p>
        ) : setlists.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎤</div>
            <p className={styles.emptyTitle}>Ainda sem concertos</p>
            <p className={styles.emptySub}>Cria o teu primeiro para começar</p>
            <button className={styles.newBtn} onClick={createSetlist}>Criar concerto</button>
          </div>
        ) : (
          <div className={styles.grid}>
            {setlists.slice(0, 6).map((s, i) => {
              const info = cardInfo(s)
              return (
                <div key={s.id} className={`${styles.card} ${styles[`c${(i % 3) + 1}`]}`} onClick={() => navigate(`/setlist/${s.id}`)}>
                  <div className={styles.cardTitle}>{s.name}</div>
                  <div className={styles.cardSub}>
                    {s.band?.name ?? 'Solo'}
                    {s.date ? ` · ${new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </div>
                  <div className={styles.cardTags}>
                    <span className={styles.tag}>{info.count} música{info.count !== 1 ? 's' : ''}</span>
                    {info.totalMin > 0 && <span className={styles.tagDur}>{info.totalMin} min</span>}
                    {info.hasSync && <span className={styles.tagSync}>sync</span>}
                    {s.is_shared && <span className={styles.tagShared}>partilhada</span>}
                  </div>
                </div>
              )
            })}
            <div className={styles.addCard} onClick={createSetlist}>
              <span className={styles.plusBig}>+</span>
              <span>Novo Concerto</span>
            </div>
          </div>
        )}
      </div>

      {picking && (
        <ProjectPickerModal
          title="Em que projeto criar o concerto?"
          onPick={(id) => { setPicking(false); createInProject(id) }}
          onClose={() => setPicking(false)}
        />
      )}
    </Layout>
  )
}
