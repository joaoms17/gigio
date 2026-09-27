import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './PalcoPage.module.css'
import { STATUS_LABELS } from '../../lib/setlistStatus'
import { mapLegacyProjectColor } from '../../lib/projectColor'

interface Row {
  id: string
  name: string
  date: string
  venue: string | null
  status: string | null
  band: { name: string; color: string } | null
  setlist_songs: { count: number }[]
}

interface PreviewSong {
  position: number
  song: { title: string; duration_sec: number | null } | null
}

const PREVIEW_LIMIT = 5

/* ── Cor de projeto ── */

/** Primeira amostra v2 — o que Projetos mostra para um projeto sem cor */
const DEFAULT_PROJECT_COLOR = '#4CC9F0'

/** Cor do projeto pronta a pintar no LED (null = concerto pessoal, sem projeto). */
function projectLedColor(band: { color: string | null } | null | undefined): string | null {
  if (!band) return null
  const raw = band.color?.trim()
  if (!raw) return DEFAULT_PROJECT_COLOR
  return mapLegacyProjectColor(raw)
}

/* ── Datas / formatação ── */

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Dias entre hoje (local) e uma data 'YYYY-MM-DD'. */
function daysUntil(dateStr: string): number {
  const date = parseLocalDate(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / 86400000)
}

/** "é hoje" / "é amanhã" / "faltam 4 dias" — maiúsculas ficam a cargo do CSS. */
function countdownLabel(dateStr: string): string {
  const diff = daysUntil(dateStr)
  if (diff <= 0) return 'é hoje'
  if (diff === 1) return 'é amanhã'
  return `faltam ${diff} dias`
}

/* Abreviaturas fixas de 3 letras (o Intl pt-PT devolve "segunda"/"set." conforme o motor) */
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "sáb 28 set" — maiúsculas ficam a cargo do CSS. */
function heroDateLabel(dateStr: string): string {
  const date = parseLocalDate(dateStr)
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

function monthShort(dateStr: string): string {
  return MONTHS[parseLocalDate(dateStr).getMonth()]
}

function dayNumber(dateStr: string): string {
  return String(Number(dateStr.split('-')[2])).padStart(2, '0')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "12 músicas" com espaço inquebrável — a contagem nunca parte entre linhas. */
function songsLabel(n: number): string {
  return `${n}\u00A0música${n !== 1 ? 's' : ''}`
}

/** "12 mús" — a contagem abreviada das linhas de concerto (Concertos, Projeto, Calendário). */
function songsShort(n: number): string {
  return `${n} mús`
}

/** Nome do projeto para a meta; concertos sem projeto são "Pessoal" (como em Concertos). */
function projectName(band: { name: string } | null | undefined): string {
  return band?.name ?? 'Pessoal'
}

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 20) return 'Boa tarde'
  return 'Boa noite'
}

/* ── Ícones SVG inline (stroke, currentColor) ── */

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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4.5v15l12.5-7.5L7 4.5Z" />
    </svg>
  )
}

function IconList() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
      <line x1="4" y1="6" x2="5" y2="6" />
      <line x1="4" y1="12" x2="5" y2="12" />
      <line x1="4" y1="18" x2="5" y2="18" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconNote() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  )
}

/** Quadrado-LED com a cor da banda; contorno oco quando é pessoal (sem banda). */
function Led({ color }: { color?: string | null }) {
  return color ? (
    <span className={styles.led} style={{ background: color }} aria-hidden="true" />
  ) : (
    <span className={`${styles.led} ${styles.ledHollow}`} aria-hidden="true" />
  )
}

export default function PalcoPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [events, setEvents] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  /** Primeiras músicas do alinhamento, associadas ao id do concerto a que pertencem. */
  const [preview, setPreview] = useState<{ setlistId: string; songs: PreviewSong[] } | null>(null)

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

  const hero = events[0]
  const heroId = hero?.id

  /* Pré-visualização das primeiras músicas do alinhamento do concerto herói */
  useEffect(() => {
    if (!heroId) return
    let cancelled = false
    supabase
      .from('setlist_songs')
      .select('position, song:songs(title, duration_sec)')
      .eq('setlist_id', heroId)
      .order('position', { ascending: true })
      .limit(PREVIEW_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          toast('Erro ao carregar o alinhamento: ' + error.message, { type: 'error' })
          setPreview({ setlistId: heroId, songs: [] })
        } else {
          /* slice defensivo: a pré-visualização nunca passa de PREVIEW_LIMIT linhas */
          setPreview({
            setlistId: heroId,
            songs: ((data ?? []) as unknown as PreviewSong[]).slice(0, PREVIEW_LIMIT),
          })
        }
      })
    return () => { cancelled = true }
  }, [heroId, toast])

  /* Assistente de criação: importar lista / copiar concerto / repertório / vazio */
  function createConcert() {
    navigate('/concertos/novo')
  }

  const rest = events.slice(1, 6)
  const heroSongs = hero?.setlist_songs?.[0]?.count ?? 0
  const previewSongs = preview && preview.setlistId === heroId ? preview.songs : null
  const previewPending = heroSongs > 0 && previewSongs === null
  const heroRemaining = Math.max(0, heroSongs - (previewSongs?.length ?? 0))
  const heroIsToday = hero ? daysUntil(hero.date) <= 0 : false
  /* Mesma ordem e abreviatura das linhas de Concertos: PROJETO · LOCAL · 12 MÚS */
  const heroMeta: string[] = hero
    ? [projectName(hero.band), hero.venue, songsShort(heroSongs)].filter(
        (s): s is string => Boolean(s),
      )
    : []

  const rawName: string =
    (user?.user_metadata?.display_name as string | undefined)?.trim().split(/\s+/)[0] ||
    user?.email?.split('@')[0] ||
    ''
  const greeting = greetingFor(new Date().getHours())

  return (
    <div className={styles.page}>

      {/* ── TOPO: título + linha mono por baixo (o padrão das outras páginas de destino) ── */}
      <header className={styles.top}>
        <div className={styles.topText}>
          <h1 className={styles.pageTitle}>Palco</h1>
          <p className={styles.greeting}>
            {greeting}{rawName ? `, ${rawName}` : ''}
          </p>
        </div>
        <button
          className={styles.searchBtn}
          onClick={() => navigate('/search')}
          aria-label="Procurar música ou concerto"
        >
          <IconSearch />
          <span>Procurar</span>
        </button>
      </header>

      {/* ── HERO: folha de setlist do próximo concerto ── */}
      {loading ? (
        <div className={styles.hero} aria-hidden="true">
          <div className={styles.heroHead}>
            <div className="skeleton" style={{ height: 12, width: 190 }} />
            <div className="skeleton" style={{ height: 12, width: 80 }} />
          </div>
          <div className={styles.heroBody}>
            <div className={styles.heroMain}>
              <div className="skeleton" style={{ height: 48, width: '75%' }} />
              <div className="skeleton" style={{ height: 12, width: '55%', marginTop: 16 }} />
            </div>
            <div className={styles.heroSet}>
              <div className="skeleton" style={{ height: 11, width: 96, marginBottom: 14 }} />
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className={styles.setRowSkeleton}>
                  <div className="skeleton" style={{ height: 14, width: 20 }} />
                  <div className="skeleton" style={{ height: 14, flex: 1 }} />
                  <div className="skeleton" style={{ height: 14, width: 34 }} />
                </div>
              ))}
            </div>
            <div className={styles.heroActions}>
              <div className="skeleton" style={{ height: 52, width: 230 }} />
              <div className="skeleton" style={{ height: 52, width: 170 }} />
            </div>
          </div>
        </div>
      ) : hero ? (
        <section className={styles.hero} aria-labelledby="palco-hero-title">
          <div className={styles.heroHead}>
            <span className={styles.heroKicker}>
              Próximo concerto <span className={styles.sep}>·</span> {heroDateLabel(hero.date)}
            </span>
            <span className={styles.countdown}>
              {heroIsToday && <span className={styles.liveLed} aria-hidden="true" />}
              {countdownLabel(hero.date)}
            </span>
          </div>

          <div className={styles.heroBody}>
            <div className={styles.heroMain}>
              <h2 id="palco-hero-title" className={styles.heroTitle}>{hero.name}</h2>
              <p className={styles.heroMeta}>
                <Led color={projectLedColor(hero.band)} />
                <span className={styles.heroMetaText}>
                  {heroMeta.map((part, i) => (
                    <Fragment key={i}>
                      {i > 0 && ' '}
                      <span>
                        {part}
                        {/* "·" colado ao segmento anterior: nunca começa uma linha */}
                        {i < heroMeta.length - 1 && <span className={styles.sep}>{'\u00A0·'}</span>}
                      </span>
                    </Fragment>
                  ))}
                </span>
              </p>
            </div>

            <div className={styles.heroSet}>
              <h3 className={styles.setHead}>
                <span>Alinhamento</span>
                <span className={styles.setHeadDur} aria-hidden="true">Dur</span>
              </h3>
              {previewPending ? (
                <div aria-hidden="true">
                  {Array.from({ length: Math.min(PREVIEW_LIMIT, heroSongs) }, (_, i) => (
                    <div key={i} className={styles.setRowSkeleton}>
                      <div className="skeleton" style={{ height: 14, width: 20 }} />
                      <div className="skeleton" style={{ height: 14, flex: 1 }} />
                      <div className="skeleton" style={{ height: 14, width: 34 }} />
                    </div>
                  ))}
                </div>
              ) : previewSongs && previewSongs.length > 0 ? (
                <>
                  <ol className={styles.setList}>
                    {previewSongs.map((item, i) => (
                      <li key={`${item.position}-${i}`} className={styles.setRow}>
                        <span className={styles.setNum}>{pad2(i + 1)}</span>
                        <span className={styles.setTitle}>{item.song?.title ?? 'Música sem título'}</span>
                        <span className={styles.setDur}>{formatDuration(item.song?.duration_sec)}</span>
                      </li>
                    ))}
                  </ol>
                  {heroRemaining > 0 && (
                    <p className={styles.setMore}>+&nbsp;{songsLabel(heroRemaining)}</p>
                  )}
                </>
              ) : (
                <p className={styles.setEmpty}>
                  Ainda sem músicas. Abre o alinhamento para as adicionar.
                </p>
              )}
            </div>

            <div className={styles.heroActions}>
              <button
                className={styles.startBtn}
                onClick={() => navigate(`/setlist/${hero.id}/concert`)}
              >
                <IconPlay size={20} />
                Iniciar concerto
              </button>
              <button
                className={`${styles.secondaryBtn} ${styles.secondaryBtnLg}`}
                onClick={() => navigate(`/setlist/${hero.id}`)}
              >
                <IconList />
                Ver alinhamento
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className={styles.empty} aria-labelledby="palco-empty-title">
          <span className={styles.emptyIcon}><IconMic /></span>
          <h2 id="palco-empty-title" className={styles.emptyTitle}>O palco está à tua espera</h2>
          <p className={styles.emptySub}>
            Ainda não tens concertos agendados. Cria o primeiro e começa a preparar o alinhamento.
          </p>
          <button className={styles.primaryBtn} onClick={createConcert}>
            <IconPlus />
            Criar concerto
          </button>
        </section>
      )}

      {/* ── A SEGUIR ── */}
      {loading ? (
        <div className={styles.section} aria-hidden="true">
          <div className={styles.sectionHead}>
            <div className="skeleton" style={{ height: 11, width: 90 }} />
          </div>
          <div className={styles.panel}>
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.nextRowSkeleton}>
                <div className="skeleton" style={{ height: 40, width: 44 }} />
                <div className={styles.nextRowSkeletonText}>
                  <div className="skeleton" style={{ height: 16, width: '60%' }} />
                  <div className="skeleton" style={{ height: 11, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : rest.length > 0 && (
        <section className={styles.section} aria-labelledby="palco-next-title">
          {/* "A SEGUIR ──────── 02" — o mesmo rótulo de grupo de Concertos/Calendário */}
          <h2
            id="palco-next-title"
            className={styles.groupLabel}
            aria-label={`A seguir: ${rest.length} concerto${rest.length !== 1 ? 's' : ''}`}
          >
            <span>A seguir</span>
            <span className={styles.groupCount}>{pad2(rest.length)}</span>
          </h2>
          <div className={styles.panel}>
            {rest.map(ev => {
              const songs = ev.setlist_songs?.[0]?.count ?? 0
              const statusLabel = ev.status ? STATUS_LABELS[ev.status] : undefined
              return (
                <div
                  key={ev.id}
                  className={`${styles.nextRow} ${statusLabel ? '' : styles.nextRowNoChip}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir ${ev.name}`}
                  onClick={() => navigate(`/setlist/${ev.id}`)}
                  onKeyDown={e => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(`/setlist/${ev.id}`)
                    }
                  }}
                >
                  <div className={styles.dateBlock}>
                    <span className={styles.dateDay}>{dayNumber(ev.date)}</span>
                    <span className={styles.dateMonth}>{monthShort(ev.date)}</span>
                  </div>
                  <div className={styles.nextInfo}>
                    <Led color={projectLedColor(ev.band)} />
                    <div className={styles.nextName}>{ev.name}</div>
                    {/* PROJETO · LOCAL · 8 MÚS — como em Concertos; no telemóvel o LED já
                        identifica o projeto e a meta fica com local · músicas */}
                    <div className={styles.nextSub}>
                      <span className={styles.nextSubBand}>{projectName(ev.band)} · </span>
                      {[ev.venue, songsShort(songs)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {statusLabel && (
                    <span className={styles.statusChip} data-status={ev.status ?? undefined}>
                      {statusLabel}
                    </span>
                  )}
                  {/* ▶ fantasma — atalho para o modo concerto (igual ao Dashboard) */}
                  <button
                    type="button"
                    className={styles.playBtn}
                    aria-label={`Iniciar concerto ${ev.name}`}
                    title="Iniciar concerto"
                    onClick={e => {
                      e.stopPropagation()
                      navigate(`/setlist/${ev.id}/concert`)
                    }}
                  >
                    <IconPlay size={16} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── ATALHOS ── */}
      <section className={styles.section} aria-labelledby="palco-shortcuts-title">
        <h2 id="palco-shortcuts-title" className={styles.groupLabel}>
          <span>Atalhos</span>
        </h2>
        <div className={styles.shortcuts}>
          <button className={styles.secondaryBtn} onClick={createConcert}>
            <IconPlus />
            <span className={styles.shortcutLabel}>Novo concerto</span>
          </button>
          <button className={styles.secondaryBtn} onClick={() => navigate('/search')}>
            <IconNote />
            <span className={styles.shortcutLabel}>Adicionar música</span>
          </button>
          <button className={styles.secondaryBtn} onClick={() => navigate('/calendar')}>
            <IconCalendar />
            <span className={styles.shortcutLabel}>Calendário</span>
          </button>
        </div>
      </section>
    </div>
  )
}
