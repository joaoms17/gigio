import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProjectPickerModal from '../../components/ProjectPickerModal'
import { useToast } from '../../components/Toast'
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
  draft: 'rascunho',
  preparing: 'em preparação',
  final: 'final',
  archived: 'arquivado',
}

function dayNumber(dateStr: string): string {
  return String(Number(dateStr.split('-')[2]))
}

/** "set" — e "set 25" quando o ano não é o corrente. */
function monthShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const label = new Date(y, m - 1, d)
    .toLocaleDateString('pt-PT', { month: 'short' })
    .replace('.', '')
  return y === new Date().getFullYear() ? label : `${label} ${String(y).slice(2)}`
}

/* ── Ícones SVG inline ── */

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
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

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}

function IconMic({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
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

  const filtered = setlists.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.band?.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.venue?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Concertos</h1>
            <p className={styles.sub}>{setlists.length} concerto{setlists.length !== 1 ? 's' : ''}</p>
          </div>
          <button className={styles.newBtn} onClick={() => setPicking(true)}>
            <IconPlus />
            Novo concerto
          </button>
        </div>

        {setlists.length > 3 && (
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}><IconSearch /></span>
            <input
              className={styles.searchInput}
              placeholder="Filtrar concertos..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        )}

        {loading ? (
          <div className={styles.grid} aria-hidden="true">
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.cardSkeleton}>
                <div className="skeleton" style={{ width: 56, height: 56, borderRadius: 14, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="skeleton" style={{ height: 16, width: '62%', marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 12, width: '44%', marginBottom: 10 }} />
                  <div className="skeleton" style={{ height: 20, width: 92, borderRadius: 999 }} />
                </div>
                <div className="skeleton" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && !search ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><IconMic /></div>
            <h2 className={styles.emptyTitle}>Ainda sem concertos</h2>
            <p className={styles.emptySub}>Cria o primeiro concerto num projeto para começar.</p>
            <button className={styles.newBtn} onClick={() => setPicking(true)}>
              <IconPlus />
              Criar concerto
            </button>
          </div>
        ) : (
          <>
            {filtered.length === 0 && search && (
              <p className={styles.noMatch}>Nenhum concerto corresponde a "{search}".</p>
            )}
            <div className={styles.grid}>
              {filtered.map(s => {
                const accentColor = s.band?.color ?? '#7C3AED'
                const songCount = s.setlist_songs?.[0]?.count ?? 0
                return (
                  <div
                    key={s.id}
                    className={styles.card}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/setlist/${s.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/setlist/${s.id}`) }}
                  >
                    <div className={styles.dateBlock} style={{ borderColor: accentColor }}>
                      {s.date ? (
                        <>
                          <span className={styles.dateDay}>{dayNumber(s.date)}</span>
                          <span className={styles.dateMonth}>{monthShort(s.date)}</span>
                        </>
                      ) : (
                        <span className={styles.dateEmpty} title="Sem data"><IconCalendar /></span>
                      )}
                    </div>
                    <div className={styles.cardMain}>
                      <div className={styles.cardTitle}>{s.name}</div>
                      <div className={styles.cardSub}>
                        {s.band?.name ?? 'Pessoal'}
                        {s.venue ? ` · ${s.venue}` : ''}
                        {` · ${songCount} música${songCount !== 1 ? 's' : ''}`}
                      </div>
                      {(s.status || s.is_shared) && (
                        <div className={styles.cardTags}>
                          {s.status && (
                            <span className={styles.statusBadge} data-status={s.status}>
                              {STATUS_LABELS[s.status] ?? s.status}
                            </span>
                          )}
                          {s.is_shared && <span className={styles.tagShared}>partilhada</span>}
                        </div>
                      )}
                    </div>
                    <button
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
              <button className={styles.addCard} onClick={() => setPicking(true)}>
                <span className={styles.addCardIcon}><IconPlus size={20} /></span>
                <span>Novo concerto</span>
              </button>
            </div>
          </>
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
