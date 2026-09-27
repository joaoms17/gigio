import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './SetlistsPage.module.css'
import { mapLegacyProjectColor } from '../../lib/projectColor'
import { concertWhen, isUpcoming, compareUpcoming, comparePast, type ConcertWhen } from '../../lib/concertWhen'

interface Row {
  id: string
  name: string
  date: string | null
  venue: string | null
  band_id?: string | null
  band: { name: string; color: string } | null
  setlist_songs: { count: number }[]
}

interface MonthGroup {
  key: string
  label: string
  items: Row[]
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
/** Dia da semana abreviado para o bloco de data ("sáb"); maiúsculas via CSS.
 *  O mês já está no rótulo do grupo — o bloco mostra dia + dia da semana. */
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Primeira amostra v2 — o que Projetos mostra para um projeto sem cor */
const DEFAULT_PROJECT_COLOR = '#4CC9F0'

/** Secção "Passados" aberta/fechada — preferência local (recolhida por defeito). */
const PAST_OPEN_KEY = 'gigio-past-open'

function readPastOpen(): boolean {
  try { return localStorage.getItem(PAST_OPEN_KEY) === '1' } catch { return false }
}

function writePastOpen(open: boolean) {
  try { localStorage.setItem(PAST_OPEN_KEY, open ? '1' : '0') } catch { /* modo privado / bloqueado */ }
}

/** Cor do projeto pronta a pintar no LED (null = concerto pessoal, sem projeto). */
function projectLedColor(band: { color?: string | null } | null | undefined): string | null {
  if (!band) return null
  const raw = band.color?.trim()
  if (!raw) return DEFAULT_PROJECT_COLOR
  return mapLegacyProjectColor(raw)
}

/** Concerto pessoal = sem projeto (band_id null). Sem a coluna, vale a ausência do projeto. */
function isPersonal(r: Row): boolean {
  return r.band_id === undefined ? !r.band : r.band_id === null
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Dia com 2 dígitos: "04". */
function dayNumber(dateStr: string): string {
  return dateStr.slice(8, 10)
}

function weekdayShort(dateStr: string): string {
  return WEEKDAYS_SHORT[parseLocal(dateStr).getDay()] ?? ''
}

/** "domingo, 4 de outubro de 2026" — tooltip do bloco de data. */
function longDate(dateStr: string): string {
  return parseLocal(dateStr).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Agrupa concertos COM data por mês, como uma agenda impressa.
 * 'asc' (próximos): hoje primeiro, depois por data · 'desc' (passados): mais recente primeiro.
 */
function groupByMonth(rows: Row[], order: 'asc' | 'desc'): MonthGroup[] {
  const sorted = [...rows].sort(order === 'asc' ? compareUpcoming : comparePast)
  const groups: MonthGroup[] = []
  for (const r of sorted) {
    const key = (r.date ?? '').slice(0, 7)
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      const [y, m] = key.split('-').map(Number)
      group = { key, label: `${MONTHS[m - 1] ?? ''} ${y}`, items: [] }
      groups.push(group)
    }
    group.items.push(r)
  }
  return groups
}

/* ── Ícones SVG inline (stroke, currentColor) ── */

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.5" y="4.5" width="17" height="16" rx="1.5" />
      <path d="M8 2.5v4M16 2.5v4M3.5 10h17" />
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

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </svg>
  )
}

/** ▸ da secção "Passados" — roda para ▾ quando aberta */
function IconChevron() {
  return (
    <svg className={styles.pastChevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" aria-hidden="true" focusable="false">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 10.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17v4M8.5 21h7" />
    </svg>
  )
}

/** Chip do estado que a DATA diz: HOJE (acento cheio + LED a piscar) · AMANHÃ / EM N DIAS (acento suave) · REALIZADO (neutro). */
function WhenChip({ when }: { when: ConcertWhen }) {
  if (!when.label) return null
  return (
    <span className={styles.chip} data-when={when.kind}>
      {when.kind === 'today' && <span className={styles.liveLed} aria-hidden="true" />}
      {when.label}
    </span>
  )
}

export default function SetlistsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [setlists, setSetlists] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [pastOpen, setPastOpen] = useState(readPastOpen)

  useEffect(() => {
    if (!user) return
    supabase
      .from('setlists')
      .select('id, name, date, venue, band_id, band:bands(name, color), setlist_songs(count)')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSetlists((data ?? []) as unknown as Row[])
        setLoading(false)
      })
  }, [user])

  /* Assistente de criação (escolhe o projeto em "PARA:" e a origem da lista) */
  function createConcert() {
    navigate('/concertos/novo')
  }

  function togglePast() {
    setPastOpen(open => {
      writePastOpen(!open)
      return !open
    })
  }

  const filtered = useMemo(() => setlists.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.band?.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.venue?.toLowerCase().includes(search.toLowerCase())
  ), [setlists, search])

  const todayStr = toYMD(new Date())

  /* Próximos (hoje/futuro + sem data no fim) e passados — o filtro vale para os dois */
  const sections = useMemo(() => {
    // Referência = hoje (muda ao virar o dia: "hoje" passa a "realizado")
    const ref = parseLocal(todayStr)
    const upcoming: Row[] = []
    const past: Row[] = []
    for (const s of filtered) (isUpcoming(s.date, ref) ? upcoming : past).push(s)
    const undated = upcoming.filter(s => !s.date)
    const upcomingGroups: MonthGroup[] = [
      ...groupByMonth(upcoming.filter(s => !!s.date), 'asc'),
      ...(undated.length > 0 ? [{ key: 'none', label: 'Sem data', items: undated }] : []),
    ]
    return {
      upcomingGroups,
      upcomingCount: upcoming.length,
      pastGroups: groupByMonth(past, 'desc'),
      pastCount: past.length,
    }
  }, [filtered, todayStr])

  const searching = !!search
  /* Com pesquisa ativa, os passados que correspondam aparecem sempre */
  const showPast = pastOpen || searching

  const isEmpty = !loading && setlists.length === 0
  const countLabel = loading
    ? 'A carregar…'
    : search
      ? `${filtered.length} de ${setlists.length} concertos`
      : `${setlists.length} concerto${setlists.length !== 1 ? 's' : ''}`

  /* Linha de concerto unificada (Concertos / Calendário / Dashboard):
     data "26 / SÁB" | LED + nome / meta | chips | ▶ fantasma */
  function renderRow(s: Row) {
    const songCount = s.setlist_songs?.[0]?.count ?? 0
    const when = concertWhen(s.date, parseLocal(todayStr))
    const personal = isPersonal(s)
    const isToday = when.kind === 'today'
    const isPast = when.kind === 'past'
    const hasChips = !!when.label || personal
    /* Campos curtos antes do local: a elipse corta o local, nunca a contagem */
    const rest = [`${songCount} mús`, s.venue].filter(Boolean).join(' · ')
    const ledColor = projectLedColor(s.band)
    const open = () => navigate(`/setlist/${s.id}`)
    return (
      <div
        key={s.id}
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
        {/* Bloco de data: "26" condensado + "SÁB" mono (o mês está no rótulo do grupo) */}
        <div className={styles.dateBlock} title={s.date ? longDate(s.date) : 'Sem data'}>
          {s.date ? (
            <>
              <span className={`${styles.dateDay} ${isToday ? styles.dateToday : ''}`}>
                {dayNumber(s.date)}
              </span>
              <span className={styles.dateWeekday}>{weekdayShort(s.date)}</span>
            </>
          ) : (
            <>
              <span className={`${styles.dateDay} ${styles.dateNone}`} aria-hidden="true">--</span>
              <span className={styles.dateWeekday}>s/d</span>
            </>
          )}
        </div>

        {/* LED do projeto junto ao nome; meta alinhada com o texto */}
        <div className={styles.info}>
          <span
            className={`${styles.led} ${ledColor ? '' : styles.ledOff}`}
            style={ledColor ? { background: ledColor } : undefined}
            title={s.band?.name ?? 'Pessoal'}
            aria-hidden="true"
          />
          <div className={styles.name}>{s.name}</div>
          <div className={styles.meta}>
            {/* No telemóvel o LED já identifica o projeto; pessoal → chip PESSOAL */}
            {s.band && <span className={styles.metaBand}>{s.band.name} · </span>}
            {rest}
          </div>
        </div>

        {hasChips && (
          <div className={styles.chips}>
            <WhenChip when={when} />
            {personal && <span className={styles.chip}>Pessoal</span>}
          </div>
        )}

        {/* ▶ fantasma — atalho para o modo concerto (igual a Palco / Dashboard) */}
        <button
          type="button"
          className={styles.playBtn}
          aria-label={`Iniciar concerto ${s.name}`}
          title="Iniciar concerto"
          onClick={e => { e.stopPropagation(); navigate(`/setlist/${s.id}/concert`) }}
        >
          <IconPlay />
        </button>
      </div>
    )
  }

  function renderGroup(group: MonthGroup) {
    return (
      <section key={group.key} className={styles.group} aria-label={group.label}>
        <h3 className={styles.groupLabel}>
          <span>{group.label}</span>
          <span className={styles.groupCount}>{pad2(group.items.length)}</span>
        </h3>
        <div className={styles.panel}>
          {group.items.map(renderRow)}
        </div>
      </section>
    )
  }

  return (
    <>
      <div className={styles.page}>
        <header className={`${styles.header} ${isEmpty ? styles.headerEmpty : ''}`}>
          <div className={styles.headText}>
            <h1 className={styles.pageTitle}>Concertos</h1>
            <span className={styles.count} aria-live="polite">{countLabel}</span>
          </div>
          <div className={styles.headActions}>
            {/* Vista de calendário — filha de Concertos (breadcrumb CONCERTOS / CALENDÁRIO) */}
            <button className={`${styles.secondaryBtn} ${styles.calBtn}`} onClick={() => navigate('/calendar')}>
              <IconCalendar />
              Calendário
            </button>
            {!isEmpty && (
              <button className={styles.primaryBtn} onClick={createConcert}>
                <IconPlus />
                Novo concerto
              </button>
            )}
          </div>
        </header>

        {setlists.length > 3 && (
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}><IconSearch /></span>
            <input
              className={styles.searchInput}
              placeholder="Filtrar por nome, projeto ou local"
              aria-label="Filtrar concertos"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        )}

        {loading ? (
          <div className={styles.groups} aria-hidden="true">
            {[4, 2].map((n, g) => (
              <section key={g} className={styles.group}>
                <div className={`skeleton ${styles.skelLabel}`} />
                <div className={styles.panel}>
                  {Array.from({ length: n }, (_, i) => (
                    <div key={i} className={styles.skelRow}>
                      <div className={`skeleton ${styles.skelDate}`} />
                      <div className={styles.skelMain}>
                        <div className={`skeleton ${styles.skelName}`} />
                        <div className={`skeleton ${styles.skelMeta}`} />
                      </div>
                      <div className={`skeleton ${styles.skelChip}`} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : isEmpty ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}><IconMic /></span>
            <h2 className={styles.emptyTitle}>Ainda sem concertos</h2>
            <p className={styles.emptySub}>Cria o primeiro concerto num projeto para começar.</p>
            <button className={styles.primaryBtn} onClick={createConcert}>
              <IconPlus />
              Criar concerto
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.inlineEmpty}>
            <p className={styles.inlineEmptyText}>Nenhum concerto corresponde a “{search}”.</p>
            <button className={styles.secondaryBtn} onClick={() => setSearch('')}>
              Limpar filtro
            </button>
          </div>
        ) : (
          <div className={styles.sections}>
            {/* ── Próximos: hoje primeiro, por data; "Sem data" no fim ── */}
            {(sections.upcomingCount > 0 || !searching) && (
              <section className={styles.section} aria-labelledby="concerts-upcoming">
                <h2 id="concerts-upcoming" className={styles.sectionHead}>
                  Próximos<span className={styles.sectionCount}> · {pad2(sections.upcomingCount)}</span>
                </h2>
                {sections.upcomingCount === 0 ? (
                  /* Só a frase: o CTA "Novo concerto" já está no cabeçalho, logo acima */
                  <div className={styles.inlineEmpty}>
                    <p className={styles.inlineEmptyText}>Nenhum concerto marcado.</p>
                  </div>
                ) : (
                  <div className={styles.groups}>
                    {sections.upcomingGroups.map(renderGroup)}
                  </div>
                )}
              </section>
            )}

            {/* ── Passados: recolhidos por defeito, mais recente primeiro ── */}
            {sections.pastCount > 0 && (
              <section className={styles.section} aria-labelledby="concerts-past">
                {searching ? (
                  <h2 id="concerts-past" className={styles.sectionHead}>
                    Passados<span className={styles.sectionCount}> · {pad2(sections.pastCount)}</span>
                  </h2>
                ) : (
                  <h2 className={styles.pastHead}>
                    <button
                      type="button"
                      id="concerts-past"
                      className={styles.pastToggle}
                      aria-expanded={pastOpen}
                      aria-controls="concerts-past-list"
                      onClick={togglePast}
                    >
                      <IconChevron />
                      <span className={styles.pastLabel}>
                        Passados<span className={styles.sectionCount}> · {pad2(sections.pastCount)}</span>
                      </span>
                      <span className={styles.pastHint} aria-hidden="true">{pastOpen ? 'Esconder' : 'Mostrar'}</span>
                    </button>
                  </h2>
                )}
                {showPast && (
                  <div id="concerts-past-list" className={styles.groups}>
                    {sections.pastGroups.map(renderGroup)}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </>
  )
}
