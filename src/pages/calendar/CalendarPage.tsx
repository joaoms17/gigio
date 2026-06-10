import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './CalendarPage.module.css'

interface UpcomingSetlist {
  id: string
  name: string
  date: string
  venue: string | null
  status: string | null
  band: { name: string; color: string } | null
  setlist_songs: { count: number }[]
}

function parseLocalDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDate(dateStr: string) {
  const d = parseLocalDate(dateStr)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  if (d.getTime() === today.getTime()) return 'Hoje'
  if (d.getTime() === tomorrow.getTime()) return 'Amanhã'
  return d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })
}

function daysUntil(dateStr: string) {
  const d = parseLocalDate(dateStr)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  return `em ${diff} dias`
}

export default function CalendarPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [events, setEvents] = useState<UpcomingSetlist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadEvents()
  }, [user])

  async function loadEvents() {
    if (!user) return
    setLoading(true)

    const today = new Date().toISOString().split('T')[0]

    const { data: memberships } = await supabase
      .from('band_members')
      .select('band_id')
      .eq('user_id', user.id)

    const bandIds = (memberships ?? []).map((m: any) => m.band_id)

    let query = supabase
      .from('setlists')
      .select('id, name, date, venue, status, band:bands(name, color), setlist_songs(count)')
      .gte('date', today)
      .order('date', { ascending: true })

    if (bandIds.length > 0) {
      query = query.or(`owner_id.eq.${user.id},band_id.in.(${bandIds.join(',')})`)
    } else {
      query = query.eq('owner_id', user.id)
    }

    const { data } = await query
    setEvents((data ?? []) as unknown as UpcomingSetlist[])
    setLoading(false)
  }

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Próximos eventos</h1>
          {!loading && (
            <p className={styles.sub}>
              {events.length === 0
                ? 'Nenhum evento agendado'
                : `${events.length} evento${events.length !== 1 ? 's' : ''} agendado${events.length !== 1 ? 's' : ''}`}
            </p>
          )}
        </div>

        {loading ? (
          <div className={styles.list}>
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.card} style={{ pointerEvents: 'none' }}>
                <div className="skeleton" style={{ width: 58, height: 58, borderRadius: 14, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 17, width: '55%', marginBottom: 9 }} />
                  <div className="skeleton" style={{ height: 12, width: '38%', marginBottom: 7 }} />
                  <div className="skeleton" style={{ height: 11, width: '25%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📅</div>
            <p className={styles.emptyTitle}>Sem eventos próximos</p>
            <p className={styles.emptySub}>Adiciona uma data a uma setlist para aparecer aqui.</p>
          </div>
        ) : (
          <div className={styles.list}>
            {events.map(ev => {
              const accent = ev.band?.color ?? '#7C3AED'
              const d = parseLocalDate(ev.date)
              const until = daysUntil(ev.date)
              const isToday = until === 'Hoje'
              return (
                <div
                  key={ev.id}
                  className={`${styles.card} ${isToday ? styles.cardToday : ''}`}
                  onClick={() => navigate(`/setlist/${ev.id}`)}
                >
                  <div className={styles.dateBadge} style={{ background: accent + '22', color: accent }}>
                    <span className={styles.dateDay}>{d.getDate()}</span>
                    <span className={styles.dateMonth}>
                      {d.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '')}
                    </span>
                  </div>

                  <div className={styles.info}>
                    <div className={styles.name}>{ev.name}</div>
                    <div className={styles.meta}>
                      {ev.band?.name && (
                        <span className={styles.project} style={{ color: accent }}>
                          {ev.band.name}
                        </span>
                      )}
                      {ev.venue && (
                        <>
                          {ev.band?.name && <span className={styles.dot}>·</span>}
                          <span className={styles.venue}>{ev.venue}</span>
                        </>
                      )}
                    </div>
                    <div className={styles.countdown} data-today={isToday}>
                      {isToday ? '🎤 ' : ''}{formatDate(ev.date)}
                    </div>
                  </div>

                  <span className={styles.chevron}>›</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
