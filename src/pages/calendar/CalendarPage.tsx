import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './CalendarPage.module.css'
import { STATUS_LABELS } from '../../lib/setlistStatus'

interface Setlist {
  id: string
  name: string
  date: string
  venue: string | null
  status: string | null
  is_shared?: boolean | null
  band: { name: string; color: string } | null
  setlist_songs?: { count: number }[]
}

/** Cabeçalho da grelha — segunda-feira primeiro. */
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
/** Mês abreviado ("set"); maiúsculas via CSS quando é rótulo mono. */
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** Dia da semana abreviado para o bloco de data ("sáb") — o mês já está no contexto. */
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/**
 * Paleta de projeto da v1 → equivalente v2 — o MESMO mapa de Projetos, Dashboard, Palco e Setlist,
 * para o LED de um projeto ter a mesma cor em toda a app (nada de roxo/rosa da v1).
 * Chaves sem "#", em maiúsculas. Cores já v2 (ou personalizadas) passam intactas.
 */
const LEGACY_PROJECT_COLORS: Record<string, string> = {
  '7C3AED': '#4CC9F0',
  'FF4D6D': '#FFC24B',
  '2563EB': '#2F6FEB',
  '059669': '#0E9F6E',
  'D97706': '#B45309',
  'DB2777': '#A8A29E',
  '0891B2': '#0891B2',
  '9333EA': '#64748B',
  'DC2626': '#DC2626',
  '16A34A': '#3DDC97',
}
/** Primeira amostra v2 — o que Projetos mostra para um projeto sem cor */
const DEFAULT_PROJECT_COLOR = '#4CC9F0'

/** Cor do projeto pronta a pintar no LED (null = concerto pessoal, sem projeto). */
function projectLedColor(band: { color?: string | null } | null | undefined): string | null {
  if (!band) return null
  const raw = band.color?.trim()
  if (!raw) return DEFAULT_PROJECT_COLOR
  return LEGACY_PROJECT_COLORS[raw.replace(/^#/, '').toUpperCase()] ?? raw
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseLocal(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function monthShort(dateStr: string) {
  return MONTHS_SHORT[Number(dateStr.slice(5, 7)) - 1] ?? ''
}

function weekdayShort(dateStr: string) {
  return WEEKDAYS_SHORT[parseLocal(dateStr).getDay()] ?? ''
}

/** LED do projeto: quadrado na cor v2, ou contorno para concertos pessoais. */
function Led({ band, className }: { band: Setlist['band']; className: string }) {
  const color = projectLedColor(band)
  return (
    <span
      className={`${className} ${color ? '' : styles.ledOff}`}
      style={color ? { background: color } : undefined}
      title={band?.name ?? 'Pessoal'}
      aria-hidden="true"
    />
  )
}

/** "domingo, 4 de outubro de 2026" — tooltip do bloco de data. */
function longDate(dateStr: string) {
  return parseLocal(dateStr).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
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

function concertCount(n: number) {
  return `${n} concerto${n !== 1 ? 's' : ''}`
}

/* ── Ícones SVG inline (stroke, currentColor) ── */

function IconChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" aria-hidden="true" focusable="false">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" aria-hidden="true" focusable="false">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function IconPlus({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

/** "Partilhada" em linhas estreitas: o chip encolhe a este ícone (projeto = pessoas). */
function IconShared() {
  return (
    <svg className={styles.sharedIcon} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
      <path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2.1.9 3.5 3.1 3.5 5.6" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.5" y="4.5" width="17" height="16" rx="1.5" />
      <path d="M8 2.5v4M16 2.5v4M3.5 10h17" />
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
      .select('id, name, date, venue, status, is_shared, band:bands(name, color), setlist_songs(count)')
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

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthEvents = useMemo(
    () => events.filter(ev => ev.date.startsWith(monthStr)),
    [events, monthStr]
  )

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

  /* Linha de concerto unificada (igual a Concertos / Palco / Dashboard):
     data "26 / SÁB" | LED + nome / meta | chips | ▶ fantasma */
  function renderRow(ev: Setlist) {
    const isToday = ev.date === todayStr
    const isPast = ev.date < todayStr
    const statusLabel = ev.status ? (STATUS_LABELS[ev.status] ?? ev.status) : undefined
    const hasChips = !!statusLabel || !!ev.is_shared
    const songCount = ev.setlist_songs?.[0]?.count
    /* Campos curtos antes do local: a elipse corta o local, nunca a contagem */
    const rest = [songCount != null ? `${songCount} mús` : null, ev.venue].filter(Boolean).join(' · ')
    const open = () => navigate(`/setlist/${ev.id}`)
    return (
      <div
        key={ev.id}
        className={[
          styles.row,
          isToday && styles.rowToday,
          !hasChips && styles.rowNoChips,
          isPast && styles.rowPast,
        ].filter(Boolean).join(' ')}
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
        }}
      >
        <div className={styles.dateBlock} title={longDate(ev.date)}>
          <span className={`${styles.dateDay} ${isToday ? styles.dateToday : ''}`}>
            {ev.date.slice(8, 10)}
          </span>
          <span className={`${styles.dateWeekday} ${isToday ? styles.dateToday : ''}`}>
            {isToday ? 'Hoje' : weekdayShort(ev.date)}
          </span>
        </div>

        <div className={styles.info}>
          <Led band={ev.band} className={styles.led} />
          <div className={styles.name}>{ev.name}</div>
          {/* No telemóvel e na coluna lateral o LED já identifica o projeto */}
          <div className={styles.meta}>
            <span className={styles.metaBand}>{ev.band?.name ?? 'Pessoal'}{rest ? ' · ' : ''}</span>
            {rest}
          </div>
        </div>

        {hasChips && (
          <div className={styles.chips}>
            {statusLabel && (
              <span className={styles.chip} data-status={ev.status ?? undefined}>
                {statusLabel}
              </span>
            )}
            {ev.is_shared && (
              <span className={`${styles.chip} ${styles.chipShared}`} title="Partilhada">
                <IconShared />
                <span className={styles.sharedText}>partilhada</span>
              </span>
            )}
          </div>
        )}

        {/* ▶ fantasma — atalho para o modo concerto (igual a Palco / Dashboard) */}
        <button
          type="button"
          className={styles.playBtn}
          aria-label={`Iniciar concerto ${ev.name}`}
          title="Iniciar concerto"
          onClick={e => { e.stopPropagation(); navigate(`/setlist/${ev.id}/concert`) }}
        >
          <IconPlay />
        </button>
      </div>
    )
  }

  const selectedDate = selected ? parseLocal(selected) : null
  const selectedIsToday = selected === todayStr

  return (
    <div className={styles.page}>

      {/* Calendário é uma vista de Concertos: breadcrumb + mês como título do ecrã */}
      <header className={styles.header}>
        <Breadcrumbs items={[
          { label: 'Concertos', to: '/setlists' },
          { label: 'Calendário' },
        ]} />
        <div className={styles.monthBar}>
          <h1 className={styles.monthLabel} aria-live="polite">
            <span className={styles.monthName}>{MONTHS[month]}</span>
            <span className={styles.monthMeta}>
              {year}
              <span className={styles.sep} aria-hidden="true"> · </span>
              {loading ? 'A carregar…' : concertCount(monthEvents.length)}
            </span>
          </h1>
          <div className={styles.keys} role="group" aria-label="Navegação de mês">
            <button className={`${styles.keyBtn} ${styles.keyIcon}`} onClick={prevMonth} aria-label="Mês anterior">
              <IconChevronLeft />
            </button>
            <button
              className={styles.keyBtn}
              onClick={goToday}
              disabled={viewingCurrentMonth && selected === todayStr}
            >
              Hoje
            </button>
            <button className={`${styles.keyBtn} ${styles.keyIcon}`} onClick={nextMonth} aria-label="Mês seguinte">
              <IconChevronRight />
            </button>
          </div>
        </div>
      </header>

      <div className={styles.body}>

        {/* ── Grelha do mês ── */}
        <section className={styles.calCol} aria-label="Grelha do mês">
          <div className={styles.calPanel} aria-busy={loading}>
            <div className={styles.weekRow} aria-hidden="true">
              {WEEKDAYS.map(d => <div key={d} className={styles.weekDay}>{d}</div>)}
            </div>

            <div className={styles.grid}>
              {calDays.map(date => {
                const dateStr = toYMD(date)
                const isCurrentMonth = date.getMonth() === month
                const isToday = dateStr === todayStr
                const isSelected = dateStr === selected
                const dayEvents = eventsByDate[dateStr] ?? []
                const hasEvent = dayEvents.length > 0
                const longLabel = date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })

                return (
                  <div
                    key={dateStr}
                    className={[
                      styles.cell,
                      !isCurrentMonth && styles.cellOtherMonth,
                      isToday && styles.cellToday,
                      isSelected && styles.cellSelected,
                    ].filter(Boolean).join(' ')}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${isToday ? 'Hoje, ' : ''}${longLabel}${hasEvent ? ` — ${concertCount(dayEvents.length)}` : ''}`}
                    onClick={() => setSelected(isSelected ? null : dateStr)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelected(isSelected ? null : dateStr)
                      }
                    }}
                  >
                    <span className={styles.cellNum}>
                      {date.getDate()}
                      {!isCurrentMonth && date.getDate() === 1 && (
                        <span className={styles.cellMonth}> {monthShort(dateStr)}</span>
                      )}
                    </span>

                    {hasEvent && (
                      <>
                        {/* Telemóvel / tablet retrato: quadrados-LED */}
                        <span className={styles.leds} aria-hidden="true">
                          {dayEvents.slice(0, 3).map(ev => (
                            <Led key={ev.id} band={ev.band} className={styles.led} />
                          ))}
                          {dayEvents.length > 3 && <span className={styles.more}>+{dayEvents.length - 3}</span>}
                        </span>

                        {/* ≥1024px: nome truncado */}
                        <span className={styles.names} aria-hidden="true">
                          {dayEvents.slice(0, 2).map(ev => (
                            <span key={ev.id} className={styles.nameLine}>
                              <Led band={ev.band} className={styles.led} />
                              <span className={styles.nameText}>{ev.name}</span>
                            </span>
                          ))}
                          {dayEvents.length > 2 && <span className={styles.more}>+{dayEvents.length - 2}</span>}
                        </span>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Painel do dia + lista do mês ── */}
        <aside className={styles.side}>
          {selected && selectedDate ? (
            <section className={styles.dayPanel} aria-label={`Concertos a ${selectedDate.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}`}>
              <div className={styles.dayHead}>
                <span className={styles.dayKicker}>
                  {selectedIsToday && <span className={styles.kickerToday}>Hoje · </span>}
                  {selectedDate.toLocaleDateString('pt-PT', { weekday: 'long' })}
                  {selectedDate.getFullYear() !== now.getFullYear() && ` · ${selectedDate.getFullYear()}`}
                </span>
                <h3 className={styles.dayTitle}>
                  {selectedDate.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}
                </h3>
              </div>

              {selectedEvents.length === 0 ? (
                <p className={styles.noEvents}>Sem concertos neste dia.</p>
              ) : (
                <div className={styles.dayRows}>
                  {selectedEvents.map(renderRow)}
                </div>
              )}

              <div className={styles.dayFoot}>
                <button
                  className={styles.secondaryBtn}
                  onClick={createOnSelectedDay}
                  disabled={creating}
                >
                  <IconPlus />
                  {creating
                    ? 'A criar…'
                    : `Criar concerto a ${selectedDate.getDate()} ${monthShort(selected)}`}
                </button>
              </div>
            </section>
          ) : (
            <section className={`${styles.dayPanel} ${styles.dayEmpty}`}>
              <span className={styles.dayEmptyIcon}><IconCalendar /></span>
              <p className={styles.dayEmptyText}>Toca num dia da grelha para ver os concertos.</p>
            </section>
          )}

          {!loading && monthEvents.length > 0 && (
            <section className={styles.monthList} aria-label={`Concertos em ${MONTHS[month]}`}>
              <h3 className={styles.sectionLabel}>
                <span>Concertos em {MONTHS[month]}{year !== now.getFullYear() ? ` ${year}` : ''}</span>
                <span className={styles.sectionCount}>{String(monthEvents.length).padStart(2, '0')}</span>
              </h3>
              <div className={styles.panel}>
                {monthEvents.map(renderRow)}
              </div>
            </section>
          )}
        </aside>

      </div>
    </div>
  )
}
