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

interface Project { id: string; name: string; color?: string }

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const displayName: string = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? ''

  useEffect(() => {
    if (!user) return
    supabase
      .from('band_members')
      .select('bands(id, name, color)')
      .eq('user_id', user.id)
      .then(({ data }) => setProjects((data ?? []).map((r: any) => r.bands).filter(Boolean)))
  }, [user])

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  const navItems = [
    { to: '/', end: true, icon: '⊞', label: 'Projetos' },
    { to: '/library', icon: '♪', label: 'Músicas' },
    { to: '/setlists', icon: '≡', label: 'Setlists' },
    { to: '/search', icon: '⌕', label: 'Buscar' },
  ]

  return (
    <div className={styles.shell}>

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

          {projects.length > 0 && (
            <div className={styles.projects}>
              <div className={styles.projectsLabel}>Projetos</div>
              <div className={styles.projectList}>
                {projects.map(p => (
                  <NavLink
                    key={p.id}
                    to={`/projects/${p.id}`}
                    className={({ isActive }) => `${styles.projectItem} ${isActive ? styles.projectActive : ''}`}
                  >
                    <span className={styles.projectDot} style={{ background: p.color ?? colorFor(p.id) }} />
                    <span className={styles.projectName}>{p.name}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )}

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
