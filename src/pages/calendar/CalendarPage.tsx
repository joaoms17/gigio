import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './CalendarPage.module.css'

interface Setlist {
  id: string
  name: string
  date: string
  venue: string | null
  status: string | null
  band: { name: string; color: string } | null
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseLocal(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function buildCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  // Monday-first: Mon=0 … Sun=6
  const startOffset = (firstDay.getDay() + 6) % 7
  const total = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7

  const days: Date[] = []
  for (let i = 0; i < total; i++) {
    days.push(new Date(year, month, 1 - startOffset + i))
  }
  return days
}

export default function CalendarPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const todayStr = toYMD(new Date())

  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [selected, setSelected] = useState<string | null>(todayStr)
  const [events, setEvents] = useState<Setlist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadEvents()
  }, [user])

  async function loadEvents() {
    if (!user) return
    setLoading(true)
    const { data: memberships } = await supabase
      .from('band_members')
      .select('band_id')
      .eq('user_id', user.id)

    const bandIds = (memberships ?? []).map((m: any) => m.band_id)

    let query = supabase
      .from('setlists')
      .select('id, name, date, venue, status, band:bands(name, color)')
      .not('date', 'is', null)
      .order('date', { ascending: true })

    if (bandIds.length > 0) {
      query = query.or(`owner_id.eq.${user.id},band_id.in.(${bandIds.join(',')})`)
    } else {
      query = query.eq('owner_id', user.id)
    }

    const { data } = await query
    setEvents((data ?? []) as unknown as Setlist[])
    setLoading(false)
  }

  const calDays = useMemo(() => buildCalendarDays(year, month), [year, month])

  const eventsByDate = useMemo(() => {
    const map: Record<string, Setlist[]> = {}
    for (const ev of events) {
      if (!map[ev.date]) map[ev.date] = []
      map[ev.date].push(ev)
    }
    return map
  }, [events])

  const selectedEvents = selected ? (eventsByDate[selected] ?? []) : []

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  return (
    <Layout>
      <div className={styles.page}>

        {/* Month header */}
        <div className={styles.monthNav}>
          <button className={styles.navBtn} onClick={prevMonth}>‹</button>
          <h1 className={styles.monthTitle}>{MONTHS[month]} {year}</h1>
          <button className={styles.navBtn} onClick={nextMonth}>›</button>
        </div>

        {/* Weekday labels */}
        <div className={styles.weekRow}>
          {WEEKDAYS.map(d => <div key={d} className={styles.weekDay}>{d}</div>)}
        </div>

        {/* Calendar grid */}
        <div className={styles.grid}>
          {calDays.map(date => {
            const dateStr = toYMD(date)
            const isCurrentMonth = date.getMonth() === month
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selected
            const dayEvents = eventsByDate[dateStr] ?? []
            const hasEvent = dayEvents.length > 0

            return (
              <div
                key={dateStr}
                className={[
                  styles.cell,
                  !isCurrentMonth && styles.cellOtherMonth,
                  isToday && styles.cellToday,
                  isSelected && styles.cellSelected,
                  hasEvent && styles.cellHasEvent,
                ].filter(Boolean).join(' ')}
                onClick={() => setSelected(isSelected ? null : dateStr)}
              >
                <span className={styles.cellNum}>{date.getDate()}</span>
                {hasEvent && (
                  <div className={styles.dots}>
                    {dayEvents.slice(0, 3).map(ev => (
                      <span
                        key={ev.id}
                        className={styles.dot}
                        style={{ background: ev.band?.color ?? '#7C3AED' }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Selected day events */}
        {selected && (
          <div className={styles.dayEvents}>
            <div className={styles.dayTitle}>
              {selected === todayStr ? 'Hoje' : parseLocal(selected).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            {selectedEvents.length === 0 ? (
              <p className={styles.noEvents}>Sem eventos neste dia.</p>
            ) : (
              <div className={styles.eventList}>
                {selectedEvents.map(ev => {
                  const accent = ev.band?.color ?? '#7C3AED'
                  return (
                    <div
                      key={ev.id}
                      className={styles.eventRow}
                      onClick={() => navigate(`/setlist/${ev.id}`)}
                      style={{ borderLeftColor: accent }}
                    >
                      <div className={styles.eventName}>{ev.name}</div>
                      <div className={styles.eventMeta}>
                        {ev.band?.name && <span style={{ color: accent }}>{ev.band.name}</span>}
                        {ev.venue && <span className={styles.eventVenue}> · {ev.venue}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* This month's events list */}
        {!loading && (() => {
          const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
          const monthEvents = events.filter(ev => ev.date.startsWith(monthStr))
          if (monthEvents.length === 0) return null
          return (
            <div className={styles.monthList}>
              <div className={styles.monthListTitle}>Eventos em {MONTHS[month]}</div>
              {monthEvents.map(ev => {
                const accent = ev.band?.color ?? '#7C3AED'
                const d = parseLocal(ev.date)
                return (
                  <div
                    key={ev.id}
                    className={styles.monthEventRow}
                    onClick={() => navigate(`/setlist/${ev.id}`)}
                  >
                    <div className={styles.mDateBadge} style={{ background: accent + '22', color: accent }}>
                      <span className={styles.mDay}>{d.getDate()}</span>
                      <span className={styles.mMon}>{d.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '')}</span>
                    </div>
                    <div className={styles.mInfo}>
                      <div className={styles.mName}>{ev.name}</div>
                      {ev.band?.name && <div className={styles.mProject} style={{ color: accent }}>{ev.band.name}</div>}
                    </div>
                    <span className={styles.mChevron}>›</span>
                  </div>
                )
              })}
            </div>
          )
        })()}

      </div>
    </Layout>
  )
}
