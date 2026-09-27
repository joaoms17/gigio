import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth'
import { useAuth } from '../hooks/useAuth'
import { useConfirm } from './ConfirmDialog'
import styles from './Layout.module.css'

interface Props { children?: React.ReactNode }

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

/* Ícones v2: traço 1.8, cantos secos (miter/square), sempre currentColor */
const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  'aria-hidden': true,
}

const ICONS = {
  palco: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M10 8.5v7l6-3.5z" />
    </svg>
  ),
  concertos: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  repertorio: (
    <svg {...ICON_PROPS}>
      <circle cx="7" cy="18" r="3" />
      <path d="M10 18V5l9-2v12" />
      <circle cx="16" cy="15" r="3" />
    </svg>
  ),
  projetos: (
    <svg {...ICON_PROPS}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M17 4.5c1.8.8 3 2.6 3 4.5s-1.2 3.7-3 4.5M19.5 14.6c1.6 1.3 2.5 3.2 2.5 5.4" />
    </svg>
  ),
  sair: (
    <svg {...ICON_PROPS} width={20} height={20}>
      <path d="M9 21H4V3h5M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
}

/* Um item de navegação acende em todas as rotas da sua secção:
   prefixo terminado em "/" = qualquer subrota; sem "/" = a rota exata ou filhas. */
function matchesSection(path: string, prefixes: string[]) {
  return prefixes.some(p =>
    p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(p + '/'),
  )
}

type SectionKey = 'palco' | 'concertos' | 'repertorio' | 'projetos'

const NAV_ITEMS: { key: SectionKey; to: string; icon: React.ReactNode; label: string; match: string[] }[] = [
  { key: 'palco', to: '/', icon: ICONS.palco, label: 'Palco', match: [] },
  { key: 'concertos', to: '/setlists', icon: ICONS.concertos, label: 'Concertos', match: ['/setlists', '/setlist/', '/calendar'] },
  { key: 'repertorio', to: '/library', icon: ICONS.repertorio, label: 'Repertório', match: ['/library', '/songs/', '/search'] },
  { key: 'projetos', to: '/projects', icon: ICONS.projetos, label: 'Projetos', match: ['/projects'] },
]

/* Secção ativa da navegação. Música (/songs/:id) e Procurar (/search) são
   sub-rotas partilhadas: herdam a secção de onde se veio (?setlist= → Concertos,
   ?project= → Projetos), tal como a raiz das breadcrumbs dessas páginas — o item
   aceso no rail/tab bar e a 1.ª breadcrumb dizem sempre o mesmo. */
function activeSection(pathname: string, search: string): SectionKey | null {
  if (pathname === '/') return 'palco'
  if (pathname.startsWith('/songs/') || pathname === '/search') {
    const q = new URLSearchParams(search)
    if (q.get('setlist')) return 'concertos'
    if (q.get('project')) return 'projetos'
  }
  return NAV_ITEMS.find(item => item.key !== 'palco' && matchesSection(pathname, item.match))?.key ?? null
}

/* Partilhado com as páginas via <Outlet context>: as Breadcrumbs alinham a raiz
   com a secção ativa (sem exports extra neste módulo — fast refresh). */
export interface LayoutOutletContext {
  navSection: { label: string; to: string } | null
  navLabels: string[]
}

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
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

  const sectionKey = activeSection(pathname, search)
  const navItems = NAV_ITEMS.map(item => ({ ...item, active: item.key === sectionKey }))
  const section = NAV_ITEMS.find(item => item.key === sectionKey)
  const outletContext: LayoutOutletContext = {
    navSection: section ? { label: section.label, to: section.to } : null,
    navLabels: NAV_ITEMS.map(item => item.label),
  }
  const settingsActive = matchesSection(pathname, ['/settings'])
  /* Música: página de altura fixa (scroll interno) que gere a própria margem
     com os mesmos valores do contentor — fica fora da normalização */
  const bleed = pathname.startsWith('/songs/')

  return (
    <div className={styles.shell}>

      {offline && (
        <div className={styles.offlineBanner} role="status" aria-live="polite" data-offline-banner="">
          <span className={styles.offlineLed} aria-hidden="true" />
          <span className={styles.offlineLabel}>Sem ligação</span>
          <span className={styles.offlineText}>As alterações podem não ser guardadas</span>
        </div>
      )}

      {/* ── RAIL (tablet + desktop) ── */}
      {/* O <aside> estica a toda a altura (fundo + hairline contínuos);
          o conteúdo interno fica colado ao viewport. */}
      <aside className={styles.rail}>
        <div className={styles.railInner}>
          <Link to="/" className={styles.brand} aria-label="gigio — Palco">
            <span className={styles.logoMark} aria-hidden="true">g</span>
          </Link>

          <nav className={styles.railNav} aria-label="Navegação principal">
            {navItems.map(item => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={item.active ? 'page' : undefined}
                className={`${styles.railItem} ${item.active ? styles.railActive : ''}`}
              >
                <span className={styles.railIcon}>{item.icon}</span>
                <span className={styles.railLabel}>{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className={styles.railBottom}>
            <Link
              to="/settings"
              aria-current={settingsActive ? 'page' : undefined}
              className={`${styles.railItem} ${styles.railAvatarItem} ${settingsActive ? styles.railActive : ''}`}
              title="Perfil e definições"
              aria-label="Perfil e definições"
            >
              <span className={styles.avatar}>{initials(displayName)}</span>
            </Link>
            <button className={styles.signOutBtn} onClick={handleSignOut} title="Terminar sessão" aria-label="Terminar sessão">
              {ICONS.sair}
            </button>
          </div>
        </div>
      </aside>

      {/* ── TOP BAR (telemóvel) ── */}
      <header className={styles.topbar}>
        <div className={styles.wordmark} role="img" aria-label="gigio">
          <span aria-hidden="true">gigio</span>
          <span className={styles.wordmarkDot} aria-hidden="true" />
        </div>
        <button
          className={`${styles.topUser} ${settingsActive ? styles.topUserActive : ''}`}
          onClick={() => navigate('/settings')}
          aria-label="Perfil e definições"
          aria-current={settingsActive ? 'page' : undefined}
        >
          <span className={styles.avatar}>{initials(displayName)}</span>
        </button>
      </header>

      {/* ── CONTEÚDO ── */}
      <main className={`${styles.main} ${bleed ? styles.mainBleed : ''}`}>
        {children ?? <Outlet context={outletContext} />}
      </main>

      {/* ── TAB BAR (telemóvel) ── */}
      <nav className={styles.bottomNav} aria-label="Navegação principal">
        {navItems.map(item => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={item.active ? 'page' : undefined}
            className={`${styles.tabItem} ${item.active ? styles.tabActive : ''}`}
          >
            <span className={styles.tabIcon}>{item.icon}</span>
            <span className={styles.tabLabel}>{item.label}</span>
          </Link>
        ))}
      </nav>

    </div>
  )
}
