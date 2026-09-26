import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth'
import { useAuth } from '../hooks/useAuth'
import { useConfirm } from './ConfirmDialog'
import styles from './Layout.module.css'

interface Props { children?: React.ReactNode }

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

const ICONS = {
  palco: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  concertos: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  repertorio: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="18" r="3" />
      <path d="M10 18V5l9-2v12" />
      <circle cx="16" cy="15" r="3" />
    </svg>
  ),
  projetos: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M17 4.5c1.8.8 3 2.6 3 4.5s-1.2 3.7-3 4.5M19.5 14.6c1.6 1.3 2.5 3.2 2.5 5.4" />
    </svg>
  ),
  sair: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
}

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const confirmDialog = useConfirm()
  const [offline, setOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const displayName: string = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? ''

  async function handleSignOut() {
    const ok = await confirmDialog({
      title: 'Terminar sessão',
      message: 'Tens a certeza que queres terminar a sessão?',
      confirmLabel: 'Sair',
      danger: true,
    })
    if (!ok) return
    await signOut()
    navigate('/auth')
  }

  const navItems = [
    { to: '/', end: true, icon: ICONS.palco, label: 'Palco' },
    { to: '/setlists', icon: ICONS.concertos, label: 'Concertos' },
    { to: '/library', icon: ICONS.repertorio, label: 'Repertório' },
    { to: '/projects', icon: ICONS.projetos, label: 'Projetos' },
  ]

  return (
    <div className={styles.shell}>

      {offline && (
        <div className={styles.offlineBanner}>
          ⚡ Sem ligação — as alterações podem não ser guardadas
        </div>
      )}

      {/* ── RAIL (desktop + tablet) ── */}
      <aside className={styles.rail}>
        <div className={styles.logoMark} aria-hidden="true">g</div>

        <nav className={styles.railNav} aria-label="Navegação principal">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${styles.railItem} ${isActive ? styles.railActive : ''}`}
            >
              <span className={styles.railIcon}>{item.icon}</span>
              <span className={styles.railLabel}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.railBottom}>
          <NavLink
            to="/settings"
            className={({ isActive }) => `${styles.railAvatar} ${isActive ? styles.railAvatarActive : ''}`}
            style={{ background: colorFor(user?.id ?? '') }}
            title="Perfil e definições"
            aria-label="Perfil e definições"
          >
            {initials(displayName)}
          </NavLink>
          <button className={styles.signOutBtn} onClick={handleSignOut} title="Terminar sessão" aria-label="Terminar sessão">
            {ICONS.sair}
          </button>
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
          aria-label="Perfil e definições"
        >
          {initials(displayName)}
        </button>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className={styles.main}>
        {children ?? <Outlet />}
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
