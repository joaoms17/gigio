import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Toast'
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

const STATUS_LABELS: Record<string, string> = {
  draft: 'rascunho',
  preparing: 'em preparação',
  final: 'final',
  archived: 'arquivado',
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseLocal(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function monthShort(dateStr: string) {
  return parseLocal(dateStr)
    .toLocaleDateString('pt-PT', { month: 'short' })
    .replace('.', '')
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

/* ── Ícones SVG inline ── */

function IconChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function IconChevronRight({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function IconPlus({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

export default function CalendarPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const todayStr = toYMD(new Date())

  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [selected, setSelected] = useState<string | null>(todayStr)
  const [events, setEvents] = useState<Setlist[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

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
  function goToday() {
    const now = new Date()
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setSelected(todayStr)
  }

  async function createOnSelectedDay() {
    if (!user || !selected || creating) return
    setCreating(true)
    const { data, error } = await supabase
      .from('setlists')
      .insert({ name: 'Novo Concerto', owner_id: user.id, date: selected, status: 'draft' })
      .select()
      .single()
    setCreating(false)
    if (error || !data) {
      toast('Erro ao criar concerto: ' + (error?.message ?? 'erro desconhecido'), { type: 'error' })
      return
    }
    navigate(`/setlist/${data.id}?add=1`)
  }

  const now = new Date()
  const viewingCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  return (
    <div className={styles.page}>

      {/* Header: título + navegação de mês em segmented */}
      <div className={styles.header}>
        <h1 className={styles.title}>Calendário</h1>
        <div className={styles.segmented} role="group" aria-label="Navegação de mês">
          <button className={styles.segBtn} onClick={prevMonth} aria-label="Mês anterior">
            <IconChevronLeft />
          </button>
          <button
            className={`${styles.segBtn} ${styles.segToday}`}
            onClick={goToday}
            disabled={viewingCurrentMonth && selected === todayStr}
          >
            Hoje
          </button>
          <button className={styles.segBtn} onClick={nextMonth} aria-label="Mês seguinte">
            <IconChevronRight />
          </button>
        </div>
      </div>

      <h2 className={styles.monthTitle}>{MONTHS[month]} {year}</h2>

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
              role="button"
              tabIndex={0}
              aria-label={parseLocal(dateStr).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}
              onClick={() => setSelected(isSelected ? null : dateStr)}
              onKeyDown={e => { if (e.key === 'Enter') setSelected(isSelected ? null : dateStr) }}
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
            <>
              <p className={styles.noEvents}>Sem eventos neste dia.</p>
              <button
                className={styles.createDayBtn}
                onClick={createOnSelectedDay}
                disabled={creating}
              >
                <IconPlus />
                {creating
                  ? 'A criar...'
                  : `Criar concerto a ${parseLocal(selected).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}`}
              </button>
            </>
          ) : (
            <div className={styles.eventList}>
              {selectedEvents.map(ev => {
                const accent = ev.band?.color ?? '#7C3AED'
                const statusLabel = ev.status ? STATUS_LABELS[ev.status] : undefined
                return (
                  <div
                    key={ev.id}
                    className={styles.eventRow}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/setlist/${ev.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/setlist/${ev.id}`) }}
                  >
                    <div className={styles.dateBlock} style={{ borderColor: accent }}>
                      <span className={styles.dateDay}>{parseLocal(ev.date).getDate()}</span>
                      <span className={styles.dateMonth}>{monthShort(ev.date)}</span>
                    </div>
                    <div className={styles.eventInfo}>
                      <div className={styles.eventName}>{ev.name}</div>
                      <div className={styles.eventMeta}>
                        {ev.band?.name && <span style={{ color: accent }}>{ev.band.name}</span>}
                        {ev.venue && (
                          <span className={styles.eventVenue}>
                            {ev.band?.name ? ' · ' : ''}{ev.venue}
                          </span>
                        )}
                      </div>
                    </div>
                    {statusLabel && (
                      <span className={styles.statusBadge} data-status={ev.status ?? undefined}>
                        {statusLabel}
                      </span>
                    )}
                    <button
                      className={styles.playBtn}
                      aria-label={`Iniciar concerto ${ev.name}`}
                      title="Iniciar concerto"
                      onClick={e => { e.stopPropagation(); navigate(`/setlist/${ev.id}/concert`) }}
                    >
                      <IconPlay />
                    </button>
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
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/setlist/${ev.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') navigate(`/setlist/${ev.id}`) }}
                >
                  <div className={styles.dateBlock} style={{ borderColor: accent }}>
                    <span className={styles.dateDay}>{d.getDate()}</span>
                    <span className={styles.dateMonth}>{monthShort(ev.date)}</span>
                  </div>
                  <div className={styles.mInfo}>
                    <div className={styles.mName}>{ev.name}</div>
                    {ev.band?.name && <div className={styles.mProject} style={{ color: accent }}>{ev.band.name}</div>}
                  </div>
                  <span className={styles.mChevron}><IconChevronRight size={20} /></span>
                </div>
              )
            })}
          </div>
        )
      })()}

    </div>
  )
}
