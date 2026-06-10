import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import styles from './ProjectPickerModal.module.css'

interface Project { id: string; name: string; owner_id: string }

const PALETTE = ['#FF4D6D', '#7C3AED', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2']
function colorFor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export default function ProjectPickerModal({ title, onPick, onClose, busy }: {
  title: string
  onPick: (projectId: string) => void
  onClose: () => void
  busy?: boolean
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('band_members')
      .select('bands(id, name, owner_id)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setProjects((data ?? []).map((r: any) => r.bands).filter(Boolean))
        setLoading(false)
      })
  }, [user])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>{title}</div>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <p className={styles.hint}>A carregar...</p>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🎸</div>
            <p>Ainda não tens projetos.</p>
            <p className={styles.emptySub}>Cria um projeto primeiro para guardar setlists.</p>
            <button className={styles.createBtn} onClick={() => navigate('/bands')}>Criar projeto</button>
          </div>
        ) : (
          <>
            <div className={styles.list}>
              {projects.map(p => (
                <button key={p.id} className={styles.row} onClick={() => !busy && onPick(p.id)} disabled={busy}>
                  <span className={styles.dot} style={{ background: colorFor(p.id) }} />
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.role}>{p.owner_id === user?.id ? 'Dono' : 'Membro'}</span>
                </button>
              ))}
            </div>
            <button className={styles.newProject} onClick={() => navigate('/bands')}>＋ Novo projeto</button>
          </>
        )}
      </div>
    </div>
  )
}
