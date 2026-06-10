import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './SetlistsPage.module.css'

interface Row {
  id: string
  name: string
  date: string | null
  is_shared: boolean
  band: { name: string } | null
  setlist_songs: { count: number }[]
}

export default function SetlistsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [setlists, setSetlists] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('setlists')
      .select('id, name, date, is_shared, band:bands(name), setlist_songs(count)')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSetlists((data ?? []) as unknown as Row[])
        setLoading(false)
      })
  }, [user])

  async function createInProject(projectId: string) {
    if (!user) return
    const { data } = await supabase
      .from('setlists')
      .insert({ name: 'Nova Setlist', owner_id: user.id, band_id: projectId, is_shared: true })
      .select()
      .single()
    if (data) navigate(`/setlist/${data.id}`)
  }
  const createSetlist = () => setPicking(true)

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Setlists</h1>
          <button className={styles.newBtn} onClick={createSetlist}>+ Nova Setlist</button>
        </div>

        {loading ? (
          <p className={styles.empty}>A carregar...</p>
        ) : setlists.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎤</div>
            <p className={styles.emptyTitle}>Ainda sem setlists</p>
            <button className={styles.newBtn} onClick={createSetlist}>Criar setlist</button>
          </div>
        ) : (
          <div className={styles.grid}>
            {setlists.map((s, i) => (
              <div key={s.id} className={`${styles.card} ${styles[`c${(i % 3) + 1}`]}`} onClick={() => navigate(`/setlist/${s.id}`)}>
                <div className={styles.cardTitle}>{s.name}</div>
                <div className={styles.cardSub}>
                  {s.band?.name ?? 'Solo'}
                  {s.date ? ` · ${new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                </div>
                <div className={styles.cardTags}>
                  <span className={styles.tag}>{s.setlist_songs?.[0]?.count ?? 0} músicas</span>
                  {s.is_shared && <span className={styles.tagShared}>partilhada</span>}
                </div>
              </div>
            ))}
            <div className={styles.addCard} onClick={createSetlist}>
              <span className={styles.plusBig}>+</span>
              <span>Nova Setlist</span>
            </div>
          </div>
        )}
      </div>

      {picking && (
        <ProjectPickerModal
          title="Em que projeto criar a setlist?"
          onPick={(id) => { setPicking(false); createInProject(id) }}
          onClose={() => setPicking(false)}
        />
      )}
    </Layout>
  )
}
