import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth'
import styles from './Layout.module.css'

interface Props { children: React.ReactNode }

export default function Layout({ children }: Props) {
  const navigate = useNavigate()

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
          <NavLink to="/search" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>🎵</span> Buscar Letras
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>
            <span className={styles.icon}>⚙️</span> Definições
          </NavLink>
        </nav>

        <div className={styles.bottom}>
          <button className={styles.signOut} onClick={handleSignOut}>↪ Sair</button>
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  )
}