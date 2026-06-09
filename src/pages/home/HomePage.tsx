import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Setlist } from '../../types'
import styles from './HomePage.module.css'

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [setlists, setSetlists] = useState<Setlist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('setlists')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setSetlists(data ?? [])
        setLoading(false)
      })
  }, [user])

  async function createSetlist() {
    if (!user) return
    const { data } = await supabase
      .from('setlists')
      .insert({ name: 'Nova Setlist', owner_id: user.id })
      .select()
      .single()
    if (data) navigate(`/setlist/${data.id}`)
  }

  const displayName = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? ''

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Olá, {displayName}</h1>
            <p className={styles.sub}>{setlists.length} setlist{setlists.length !== 1 ? 's' : ''}</p>
          </div>
          <button className={styles.newBtn} onClick={createSetlist}>+ Nova Setlist</button>
        </div>

        {loading ? (
          <p className={styles.empty}>A carregar...</p>
        ) : setlists.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎤</div>
            <p className={styles.emptyTitle}>Ainda sem setlists</p>
            <p className={styles.emptySub}>Cria a tua primeira setlist para começar</p>
            <button className={styles.newBtn} onClick={createSetlist}>Criar setlist</button>
          </div>
        ) : (
          <div className={styles.grid}>
            {setlists.map((s, i) => (
              <div
                key={s.id}
                className={`${styles.card} ${styles[`c${(i % 3) + 1}`]}`}
                onClick={() => navigate(`/setlist/${s.id}`)}
              >
                <div className={styles.cardTitle}>{s.name}</div>
                <div className={styles.cardMeta}>
                  {s.date ? new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) : 'Sem data'}
                  {s.is_shared && <span className={styles.sharedBadge}>partilhada</span>}
                </div>
              </div>
            ))}
            <div className={styles.addCard} onClick={createSetlist}>
              <span>+</span>
              <span>Nova Setlist</span>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
