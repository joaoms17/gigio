import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './SetlistsPage.module.css'
import { STATUS_LABELS } from '../../lib/setlistStatus'
import { mapLegacyProjectColor } from '../../lib/projectColor'

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

/** Cor do projeto pronta a pintar no LED (null = concerto pessoal, sem projeto). */
function projectLedColor(band: { color?: string | null } | null | undefined): string | null {
  if (!band) return null
  const raw = band.color?.trim()
  if (!raw) return DEFAULT_PROJECT_COLOR
  return mapLegacyProjectColor(raw)
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
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
 * Agrupa por mês, como uma agenda impressa:
 * meses a partir do corrente (mais próximo primeiro) → "Sem data" → meses passados (mais recente primeiro).
 */
function groupByMonth(rows: Row[], currentYM: string): MonthGroup[] {
  const byMonth = new Map<string, Row[]>()
  const undated: Row[] = []
  for (const r of rows) {
    if (!r.date) { undated.push(r); continue }
    const key = r.date.slice(0, 7)
    const list = byMonth.get(key)
    if (list) list.push(r)
    else byMonth.set(key, [r])
  }

  const toGroup = (key: string, ascending: boolean): MonthGroup => {
    const [y, m] = key.split('-').map(Number)
    const items = [...(byMonth.get(key) ?? [])].sort((a, b) =>
      ascending ? a.date!.localeCompare(b.date!) : b.date!.localeCompare(a.date!)
    )
    return { key, label: `${MONTHS[m - 1]} ${y}`, items }
  }

  const keys = [...byMonth.keys()].sort()
  const upcoming = keys.filter(k => k >= currentYM).map(k => toGroup(k, true))
  const past = keys.filter(k => k < currentYM).reverse().map(k => toGroup(k, false))

  return [
    ...upcoming,
    ...(undated.length > 0 ? [{ key: 'none', label: 'Sem data', items: undated }] : []),
    ...past,
  ]
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

function IconMic() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 10.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17v4M8.5 21h7" />
    </svg>
  )
}

export default function SetlistsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
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
    const { data, error } = await supabase
      .from('setlists')
      .insert({ name: 'Novo Concerto', owner_id: user.id, band_id: projectId, is_shared: true, status: 'draft' })
      .select()
      .single()
    if (error) { toast('Erro ao criar concerto: ' + error.message, { type: 'error' }); return }
    if (data) navigate(`/setlist/${data.id}?add=1`)
  }

  const filtered = useMemo(() => setlists.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.band?.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.venue?.toLowerCase().includes(search.toLowerCase())
  ), [setlists, search])

  const todayStr = toYMD(new Date())
  const groups = useMemo(() => groupByMonth(filtered, todayStr.slice(0, 7)), [filtered, todayStr])

  const isEmpty = !loading && setlists.length === 0
  const countLabel = loading
    ? 'A carregar…'
    : search
      ? `${filtered.length} de ${setlists.length} concertos`
      : `${setlists.length} concerto${setlists.length !== 1 ? 's' : ''}`

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
              <button className={styles.primaryBtn} onClick={() => setPicking(true)}>
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
            <button className={styles.primaryBtn} onClick={() => setPicking(true)}>
              <IconPlus />
              Criar concerto
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.noMatch}>
            <p className={styles.noMatchText}>Nenhum concerto corresponde a “{search}”.</p>
            <button className={styles.secondaryBtn} onClick={() => setSearch('')}>
              Limpar filtro
            </button>
          </div>
        ) : (
          <div className={styles.groups}>
            {groups.map(group => (
              <section key={group.key} className={styles.group} aria-label={group.label}>
                <h2 className={styles.groupLabel}>
                  <span>{group.label}</span>
                  <span className={styles.groupCount}>{String(group.items.length).padStart(2, '0')}</span>
                </h2>
                <div className={styles.panel}>
                  {group.items.map(s => {
                    const songCount = s.setlist_songs?.[0]?.count ?? 0
                    const isToday = s.date === todayStr
                    const isPast = !!s.date && s.date < todayStr
                    const hasChips = !!s.status || s.is_shared
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
                              <span className={`${styles.dateWeekday} ${isToday ? styles.dateToday : ''}`}>
                                {isToday ? 'Hoje' : weekdayShort(s.date)}
                              </span>
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
                            {/* No telemóvel o LED já identifica o projeto */}
                            <span className={styles.metaBand}>{s.band?.name ?? 'Pessoal'} · </span>
                            {rest}
                          </div>
                        </div>

                        {hasChips && (
                          <div className={styles.chips}>
                            {s.status && (
                              <span className={styles.chip} data-status={s.status}>
                                {STATUS_LABELS[s.status] ?? s.status}
                              </span>
                            )}
                            {s.is_shared && (
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
                          aria-label={`Iniciar concerto ${s.name}`}
                          title="Iniciar concerto"
                          onClick={e => { e.stopPropagation(); navigate(`/setlist/${s.id}/concert`) }}
                        >
                          <IconPlay />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
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
    </>
  )
}
