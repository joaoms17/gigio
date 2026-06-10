import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import styles from './Layout.module.css'

interface Props { children: React.ReactNode }

const DOT_PALETTE = ['#FF4D6D', '#7C3AED', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2']
function colorFor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return DOT_PALETTE[h % DOT_PALETTE.length]
}

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [bands, setBands] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!user) return
    supabase
      .from('band_members')
      .select('bands(id, name)')
      .eq('user_id', user.id)
      .then(({ data }) => setBands((data ?? []).map((r: any) => r.bands).filter(Boolean)))
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
            <span className={styles.icon}>🏠</span> Home
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

          <div className={styles.bandsSection}>
            <div className={styles.bandsLabel}>PROJETOS</div>
            {bands.map(b => (
              <NavLink
                key={b.id}
                to={`/band/${b.id}`}
                className={({ isActive }) => isActive ? styles.bandLinkActive : styles.bandLink}
              >
                <span className={styles.dot} style={{ background: colorFor(b.id) }} />
                <span className={styles.bandName}>{b.name}</span>
              </NavLink>
            ))}
            <button className={styles.newBand} onClick={() => navigate('/bands')}>
              <span className={styles.plus}>+</span> Novo projeto
            </button>
          </div>
        </nav>

        <div className={styles.bottom}>
          <NavLink to="/settings" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>⚙️</span> Perfil
          </NavLink>
          <button className={styles.signOut} onClick={handleSignOut}>↪ Sair</button>
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  )
}
