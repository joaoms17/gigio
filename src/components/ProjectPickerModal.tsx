import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import styles from './ProjectPickerModal.module.css'

interface Project { id: string; name: string; owner_id: string; color?: string | null }

/** Contagens sempre com 2 dígitos: 01, 02… */
const pad2 = (n: number) => String(n).padStart(2, '0')

function Svg({ size = 20, strokeWidth = 2, children }: { size?: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}
const IconClose = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>
const IconChevronRight = () => <Svg size={18}><path d="M9 6l6 6-6 6" /></Svg>
const IconPlus = () => <Svg size={18}><path d="M12 5v14M5 12h14" /></Svg>
const IconLayers = () => (
  <Svg size={28} strokeWidth={1.75}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Svg>
)

export default function ProjectPickerModal({ title, onPick, onClose, busy }: {
  title: string
  onPick: (projectId: string) => void
  onClose: () => void
  busy?: boolean
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const titleId = useId()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const autoPicked = useRef(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('band_members')
      .select('bands(id, name, owner_id, color)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setProjects((data ?? []).map((r: any) => r.bands).filter(Boolean))
        setLoading(false)
      })
  }, [user])

  // Um único projeto → escolhe-o automaticamente, sem obrigar a um toque extra
  useEffect(() => {
    if (loading || autoPicked.current || projects.length !== 1) return
    autoPicked.current = true
    onPick(projects[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, projects])

  const kicker = busy
    ? 'A processar…'
    : loading
      ? 'Projetos'
      : `Projetos · ${pad2(projects.length)}`

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headText}>
            <div className={styles.kicker}>{kicker}</div>
            <h2 id={titleId} className={styles.title}>{title}</h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </header>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.list} role="status" aria-label="A carregar projetos">
              {[0, 1, 2].map(i => (
                <div key={i} className={styles.skelRow}>
                  <span className={styles.lead}><span className={`skeleton ${styles.skelLed}`} /></span>
                  <span className={`skeleton ${styles.skelName}`} style={{ width: `${[52, 38, 45][i]}%` }} />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}><IconLayers /></span>
              <div className={styles.emptyTitle}>Ainda não tens projetos</div>
              <p className={styles.emptyText}>Cria um projeto primeiro para guardar setlists.</p>
              <button type="button" className={styles.btnPrimary} onClick={() => navigate('/projects')}>
                Criar projeto
              </button>
            </div>
          ) : (
            <>
              <div className={styles.list}>
                {projects.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.row}
                    onClick={() => !busy && onPick(p.id)}
                    disabled={busy}
                  >
                    <span className={styles.lead}>
                      <span className={styles.led} style={p.color ? { background: p.color } : undefined} />
                    </span>
                    <span className={styles.name}>{p.name}</span>
                    <span className={styles.role}>{p.owner_id === user?.id ? 'Dono' : 'Membro'}</span>
                    <span className={styles.chev}><IconChevronRight /></span>
                  </button>
                ))}
              </div>
              <button type="button" className={styles.newProject} onClick={() => navigate('/projects')} disabled={busy}>
                <span className={styles.lead}><IconPlus /></span>
                <span className={styles.newLabel}>Novo projeto</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
