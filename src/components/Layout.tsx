import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import styles from './Layout.module.css'

interface Props { children: React.ReactNode }

const DOT_PALETTE = ['#7C3AED', '#FF4D6D', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2', '#9333EA']
function colorFor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return DOT_PALETTE[h % DOT_PALETTE.length]
}

interface Project { id: string; name: string; color?: string }

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])

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

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <span className={styles.gig}>gig</span><span className={styles.io}>io</span>
        </div>

        <nav className={styles.nav}>
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>🎸</span> Projetos
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>🎵</span> Músicas
          </NavLink>
          <NavLink to="/setlists" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>📋</span> Setlists
          </NavLink>
          <NavLink to="/search" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>🔍</span> Buscar
          </NavLink>

          {projects.length > 0 && (
            <div className={styles.bandsSection}>
              <div className={styles.bandsLabel}>OS MEUS PROJETOS</div>
              {projects.map(p => (
                <NavLink
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className={({ isActive }) => isActive ? styles.bandLinkActive : styles.bandLink}
                >
                  <span className={styles.dot} style={{ background: p.color ?? colorFor(p.id) }} />
                  <span className={styles.bandName}>{p.name}</span>
                </NavLink>
              ))}
              <button className={styles.newBand} onClick={() => navigate('/')}>
                <span className={styles.plus}>+</span> Novo projeto
              </button>
            </div>
          )}
        </nav>

        <div className={styles.bottom}>
          <NavLink to="/settings" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>⚙️</span> Definições
          </NavLink>
          <button className={styles.signOut} onClick={handleSignOut}>↪ Sair</button>
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  )
}
