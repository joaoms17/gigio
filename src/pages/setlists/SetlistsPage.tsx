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
  venue: string | null
  status: string | null
  is_shared: boolean
  band: { name: string; color: string } | null
  setlist_songs: { count: number }[]
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  preparing: 'A preparar',
  final: 'Final',
  archived: 'Arquivada',
}

export default function SetlistsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [setlists, setSetlists] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!user) return
    supabase
      .from('setlists')
      .select('id, name, date, venue, status, is_shared, band:bands(name, color), setlist_songs(count)')
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
      .insert({ name: 'Nova Setlist', owner_id: user.id, band_id: projectId, is_shared: true, status: 'draft' })
      .select()
      .single()
    if (data) navigate(`/setlist/${data.id}`)
  }

  const filtered = setlists.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.band?.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.venue?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Setlists</h1>
            <p className={styles.sub}>{setlists.length} setlist{setlists.length !== 1 ? 's' : ''}</p>
          </div>
          <button className={styles.newBtn} onClick={() => setPicking(true)}>+ Nova setlist</button>
        </div>

        {setlists.length > 3 && (
          <input
            className={styles.searchInput}
            placeholder="Filtrar setlists..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}

        {loading ? (
          <div className={styles.grid}>
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.card} style={{ pointerEvents: 'none' }}>
                <div className="skeleton" style={{ height: 4, borderRadius: 0 }} />
                <div className={styles.cardBody}>
                  <div className="skeleton" style={{ height: 16, width: '65%', marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 12, width: '45%', marginBottom: 12 }} />
                  <div className="skeleton" style={{ height: 22, width: 90, borderRadius: 20 }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && !search ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎤</div>
            <p className={styles.emptyTitle}>Ainda sem setlists</p>
            <p className={styles.emptySub}>Cria a primeira setlist num projeto para começar.</p>
            <button className={styles.newBtn} onClick={() => setPicking(true)}>Criar setlist</button>
          </div>
        ) : (
          <div className={styles.grid}>
            {filtered.map(s => {
              const accentColor = s.band?.color ?? '#7C3AED'
              return (
                <div key={s.id} className={styles.card} onClick={() => navigate(`/setlist/${s.id}`)}>
                  <div className={styles.cardAccent} style={{ background: accentColor }} />
                  <div className={styles.cardBody}>
                    <div className={styles.cardTitle}>{s.name}</div>
                    <div className={styles.cardSub}>
                      {s.band?.name ?? 'Pessoal'}
                      {s.venue ? ` · ${s.venue}` : ''}
                    </div>
                    {s.date && (
                      <div className={styles.cardDate}>
                        {new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    )}
                    <div className={styles.cardTags}>
                      <span className={styles.tag}>{s.setlist_songs?.[0]?.count ?? 0} músicas</span>
                      {s.status && s.status !== 'draft' && (
                        <span className={styles.statusBadge} data-status={s.status}>
                          {STATUS_LABELS[s.status] ?? s.status}
                        </span>
                      )}
                      {s.is_shared && <span className={styles.tagShared}>partilhada</span>}
                    </div>
                  </div>
                </div>
              )
            })}
            <div className={styles.addCard} onClick={() => setPicking(true)}>
              <span className={styles.plusBig}>+</span>
              <span>Nova setlist</span>
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
