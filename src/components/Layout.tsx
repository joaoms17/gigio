import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import styles from './Layout.module.css'

interface Props { children: React.ReactNode }

const PALETTE = ['#7C3AED', '#FF4D6D', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2', '#9333EA']
function colorFor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

function shortDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'amanhã'
  return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }).replace('.', '')
}

interface UpcomingEvent { id: string; name: string; date: string; band: { name: string; color: string } | null }

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [upcoming, setUpcoming] = useState<UpcomingEvent[]>([])
  const [offline, setOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const displayName: string = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? ''

  useEffect(() => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]
    supabase
      .from('band_members')
      .select('band_id')
      .eq('user_id', user.id)
      .then(async ({ data: memberships }) => {
        const bandIds = (memberships ?? []).map((m: any) => m.band_id)
        let query = supabase
          .from('setlists')
          .select('id, name, date, band:bands(name, color)')
          .gte('date', today)
          .order('date', { ascending: true })
          .limit(6)
        if (bandIds.length > 0) {
          query = query.or(`owner_id.eq.${user.id},band_id.in.(${bandIds.join(',')})`)
        } else {
          query = query.eq('owner_id', user.id)
        }
        const { data } = await query
        setUpcoming((data ?? []) as unknown as UpcomingEvent[])
      })
  }, [user])

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  const navItems = [
    { to: '/projects', icon: '⊞', label: 'Projetos' },
    { to: '/', end: true, icon: '⊟', label: 'Calendário' },
    { to: '/library', icon: '♪', label: 'Músicas' },
    { to: '/setlists', icon: '≡', label: 'Concertos' },
    { to: '/search', icon: '⌕', label: 'Buscar' },
  ]

  return (
    <div className={styles.shell}>

      {offline && (
        <div className={styles.offlineBanner}>
          ⚡ Sem ligação — as alterações podem não ser guardadas
        </div>
      )}

      {/* ── DESKTOP SIDEBAR ── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          <div className={styles.logo}>
            <span className={styles.gig}>gig</span><span className={styles.io}>io</span>
          </div>

          <nav className={styles.nav}>
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className={styles.projects}>
            <div className={styles.projectsLabel}>Próximos eventos</div>
            <div className={styles.projectList}>
              {upcoming.length === 0 ? (
                <span className={styles.noEvents}>Sem eventos agendados</span>
              ) : upcoming.map(ev => (
                <NavLink
                  key={ev.id}
                  to={`/setlist/${ev.id}`}
                  className={({ isActive }) => `${styles.projectItem} ${isActive ? styles.projectActive : ''}`}
                >
                  <span className={styles.projectDot} style={{ background: ev.band?.color ?? colorFor(ev.id) }} />
                  <span className={styles.projectName}>{ev.name}</span>
                  <span className={styles.eventDate}>{shortDate(ev.date)}</span>
                </NavLink>
              ))}
            </div>
          </div>

          <div className={styles.sidebarBottom}>
            <NavLink
              to="/settings"
              className={({ isActive }) => `${styles.bottomItem} ${isActive ? styles.navActive : ''}`}
            >
              <div className={styles.userAvatar} style={{ background: colorFor(user?.id ?? '') }}>
                {initials(displayName)}
              </div>
              <span className={styles.userName}>{displayName}</span>
            </NavLink>
            <button className={styles.signOutBtn} onClick={handleSignOut} title="Sair">
              <span className={styles.signOutIcon}>→</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── MOBILE TOP BAR ── */}
      <header className={styles.topbar}>
        <div className={styles.topLogo}>
          <span className={styles.gig}>gig</span><span className={styles.io}>io</span>
        </div>
        <button
          className={styles.topUser}
          onClick={() => navigate('/settings')}
          style={{ background: colorFor(user?.id ?? '') }}
        >
          {initials(displayName)}
        </button>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className={styles.main}>
        {children}
      </main>

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      <nav className={styles.bottomNav}>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `${styles.tabItem} ${isActive ? styles.tabActive : ''}`}
          >
            <span className={styles.tabIcon}>{item.icon}</span>
            <span className={styles.tabLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

    </div>
  )
}
