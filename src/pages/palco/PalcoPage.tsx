import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './PalcoPage.module.css'

interface Row {
  id: string
  name: string
  date: string
  venue: string | null
  status: string | null
  band: { name: string; color: string } | null
  setlist_songs: { count: number }[]
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'rascunho',
  preparing: 'em preparação',
  final: 'alinhamento final',
}

/** Dias entre hoje (local) e uma data 'YYYY-MM-DD'. */
function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / 86400000)
}

function countdownLabel(dateStr: string): string {
  const diff = daysUntil(dateStr)
  if (diff <= 0) return 'é hoje!'
  if (diff === 1) return 'é amanhã'
  return `faltam ${diff} dias`
}

/** "sábado · 28 set" — maiúsculas ficam a cargo do CSS. */
function heroDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const weekday = date.toLocaleDateString('pt-PT', { weekday: 'long' })
  const dayMonth = date
    .toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })
    .replace('.', '')
    .replace(' de ', ' ')
  return `${weekday} · ${dayMonth}`
}

function monthShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
    .toLocaleDateString('pt-PT', { month: 'short' })
    .replace('.', '')
}

function dayNumber(dateStr: string): string {
  return String(Number(dateStr.split('-')[2]))
}

/* ── Ícones SVG inline ── */

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}

function IconPlay({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function IconList() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="0.5" />
      <circle cx="4" cy="12" r="0.5" />
      <circle cx="4" cy="18" r="0.5" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconNote() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  )
}

export default function PalcoPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [events, setEvents] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const today = new Date().toISOString().split('T')[0]

    async function load() {
      const { data: memberships, error: mErr } = await supabase
        .from('band_members')
        .select('band_id')
        .eq('user_id', user!.id)
      if (cancelled) return
      if (mErr) {
        toast('Erro ao carregar os concertos: ' + mErr.message, { type: 'error' })
        setLoading(false)
        return
      }
      const bandIds = (memberships ?? []).map((m: { band_id: string }) => m.band_id)
      let query = supabase
        .from('setlists')
        .select('id, name, date, venue, status, band:bands(name, color), setlist_songs(count)')
        .gte('date', today)
        .order('date', { ascending: true })
        .limit(6)
      if (bandIds.length > 0) {
        query = query.or(`owner_id.eq.${user!.id},band_id.in.(${bandIds.join(',')})`)
      } else {
        query = query.eq('owner_id', user!.id)
      }
      const { data, error } = await query
      if (cancelled) return
      if (error) {
        toast('Erro ao carregar os concertos: ' + error.message, { type: 'error' })
      } else {
        setEvents((data ?? []) as unknown as Row[])
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [user, toast])

  async function createConcert() {
    if (!user || creating) return
    setCreating(true)
    const { data, error } = await supabase
      .from('setlists')
      .insert({ name: 'Novo Concerto', owner_id: user.id, status: 'draft' })
      .select()
      .single()
    setCreating(false)
    if (error || !data) {
      toast('Erro ao criar concerto: ' + (error?.message ?? 'tenta de novo'), { type: 'error' })
      return
    }
    navigate(`/setlist/${data.id}?add=1`)
  }

  const hero = events[0]
  const rest = events.slice(1, 6)
  const heroAccent = hero?.band?.color ?? '#7C3AED'
  const heroSongs = hero?.setlist_songs?.[0]?.count ?? 0

  return (
    <div className={styles.page}>

      {/* ── TOPO ── */}
      <div className={styles.top}>
        <h1 className={styles.pageTitle}>Palco</h1>
        <button
          className={styles.searchPill}
          onClick={() => navigate('/search')}
          aria-label="Procurar música ou concerto"
        >
          <IconSearch />
          <span className={styles.searchPillText}>Procurar música ou concerto</span>
        </button>
      </div>

      <div className={styles.grid}>
        <div className={styles.mainCol}>

          {/* ── HERO: o próximo concerto ── */}
          {loading ? (
            <div className={styles.heroSkeleton} aria-hidden="true">
              <div className="skeleton" style={{ height: 14, width: 200 }} />
              <div className="skeleton" style={{ height: 48, width: '70%' }} />
              <div className="skeleton" style={{ height: 14, width: '45%' }} />
              <div className={styles.heroSkeletonActions}>
                <div className="skeleton" style={{ height: 60, width: 220, borderRadius: 16 }} />
                <div className="skeleton" style={{ height: 60, width: 170, borderRadius: 16 }} />
              </div>
            </div>
          ) : hero ? (
            <section
              className={styles.hero}
              style={{ background: `linear-gradient(140deg, ${heroAccent}1F 0%, var(--bg2) 62%)` }}
              aria-labelledby="palco-hero-title"
            >
              <div className={styles.heroKicker}>
                <span>{heroDateLabel(hero.date)}</span>
                <span className={styles.heroCountdown}>{countdownLabel(hero.date)}</span>
              </div>
              <h2 id="palco-hero-title" className={styles.heroTitle}>{hero.name}</h2>
              <p className={styles.heroMeta}>
                {hero.venue && <span>{hero.venue}</span>}
                <span>{heroSongs} música{heroSongs !== 1 ? 's' : ''}</span>
                <span>{hero.band?.name ?? 'Pessoal'}</span>
              </p>
              <div className={styles.heroActions}>
                <button
                  className={styles.startBtn}
                  onClick={() => navigate(`/setlist/${hero.id}/concert`)}
                >
                  <IconPlay size={22} />
                  Iniciar concerto
                </button>
                <button
                  className={styles.outlineBtn}
                  onClick={() => navigate(`/setlist/${hero.id}`)}
                >
                  <IconList />
                  Ver alinhamento
                </button>
              </div>
            </section>
          ) : (
            <section className={styles.empty}>
              <div className={styles.emptyIcon}><IconMic /></div>
              <h2 className={styles.emptyTitle}>O palco está à tua espera</h2>
              <p className={styles.emptySub}>
                Ainda não tens concertos agendados. Cria o primeiro e começa a preparar o alinhamento.
              </p>
              <button className={styles.startBtn} onClick={createConcert} disabled={creating}>
                <IconPlus />
                {creating ? 'A criar...' : 'Criar concerto'}
              </button>
            </section>
          )}

          {/* ── A SEGUIR ── */}
          {loading ? (
            <div className={styles.nextList} aria-hidden="true">
              {[0, 1, 2].map(i => (
                <div key={i} className="skeleton" style={{ height: 72, borderRadius: 16 }} />
              ))}
            </div>
          ) : rest.length > 0 && (
            <section aria-labelledby="palco-next-title">
              <h3 id="palco-next-title" className={styles.sectionLabel}>A seguir</h3>
              <div className={styles.nextList}>
                {rest.map(ev => {
                  const songs = ev.setlist_songs?.[0]?.count ?? 0
                  const statusLabel = ev.status ? STATUS_LABELS[ev.status] : undefined
                  return (
                    <div
                      key={ev.id}
                      className={styles.nextRow}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/setlist/${ev.id}`)}
                      onKeyDown={e => { if (e.key === 'Enter') navigate(`/setlist/${ev.id}`) }}
                    >
                      <div className={styles.dateBlock} style={{ borderColor: ev.band?.color ?? 'var(--border2)' }}>
                        <span className={styles.dateDay}>{dayNumber(ev.date)}</span>
                        <span className={styles.dateMonth}>{monthShort(ev.date)}</span>
                      </div>
                      <div className={styles.nextInfo}>
                        <div className={styles.nextName}>{ev.name}</div>
                        <div className={styles.nextSub}>
                          {ev.venue ? `${ev.venue} · ` : ''}
                          {songs} música{songs !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {statusLabel && (
                        <span className={styles.statusBadge} data-status={ev.status ?? undefined}>
                          {statusLabel}
                        </span>
                      )}
                      <button
                        className={styles.rowPlayBtn}
                        aria-label={`Iniciar concerto ${ev.name}`}
                        title="Iniciar concerto"
                        onClick={e => { e.stopPropagation(); navigate(`/setlist/${ev.id}/concert`) }}
                      >
                        <IconPlay size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        {/* ── ATALHOS ── */}
        <aside className={styles.sideCol} aria-label="Atalhos">
          <h3 className={styles.sectionLabel}>Atalhos</h3>
          <button className={styles.dashedBtn} onClick={createConcert} disabled={creating}>
            <IconPlus />
            {creating ? 'A criar...' : 'Novo concerto'}
          </button>
          <button className={styles.dashedBtn} onClick={() => navigate('/search')}>
            <IconNote />
            Adicionar música ao repertório
          </button>
          <button className={styles.calendarLink} onClick={() => navigate('/calendar')}>
            Ver calendário completo →
          </button>
        </aside>
      </div>
    </div>
  )
}
