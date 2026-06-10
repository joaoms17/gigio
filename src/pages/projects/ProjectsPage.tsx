import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  type Project,
  type ProjectType,
  PROJECT_TYPE_LABELS,
  PROJECT_COLORS,
} from '../../types'
import styles from './ProjectsPage.module.css'

interface ProjectWithCounts extends Project {
  memberCount: number
  setlistCount: number
  myRole: string
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

const TYPE_OPTIONS: { value: ProjectType; label: string }[] = Object.entries(
  PROJECT_TYPE_LABELS
).map(([value, label]) => ({ value: value as ProjectType, label }))

export default function ProjectsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Create project form state
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState<ProjectType>('band')
  const [createDesc, setCreateDesc] = useState('')
  const [createColor, setCreateColor] = useState(PROJECT_COLORS[0])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (user) loadProjects()
  }, [user])

  async function loadProjects() {
    if (!user) return
    setLoading(true)

    const { data: memberships } = await supabase
      .from('band_members')
      .select('band_id, role, bands(id, name, description, type, color, image_url, owner_id, invite_code, invite_expires_at, created_at)')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false })

    if (!memberships) { setLoading(false); return }

    const rawProjects = memberships
      .map((m: any) => ({ ...m.bands, myRole: m.role }))
      .filter(Boolean)

    const projectIds = rawProjects.map((p: any) => p.id)

    const [membersRes, setlistsRes] = await Promise.all([
      projectIds.length
        ? supabase.from('band_members').select('band_id').in('band_id', projectIds)
        : Promise.resolve({ data: [] }),
      projectIds.length
        ? supabase.from('setlists').select('band_id').in('band_id', projectIds)
        : Promise.resolve({ data: [] }),
    ])

    const memberCounts: Record<string, number> = {}
    const setlistCounts: Record<string, number> = {}
    ;(membersRes.data ?? []).forEach((r: any) => {
      memberCounts[r.band_id] = (memberCounts[r.band_id] ?? 0) + 1
    })
    ;(setlistsRes.data ?? []).forEach((r: any) => {
      setlistCounts[r.band_id] = (setlistCounts[r.band_id] ?? 0) + 1
    })

    setProjects(
      rawProjects.map((p: any) => ({
        ...p,
        type: p.type ?? 'band',
        color: p.color ?? PROJECT_COLORS[0],
        memberCount: memberCounts[p.id] ?? 0,
        setlistCount: setlistCounts[p.id] ?? 0,
      }))
    )
    setLoading(false)
  }

  async function createProject() {
    if (!user || !createName.trim()) return
    setCreating(true)
    const { data, error } = await supabase
      .from('bands')
      .insert({
        name: createName.trim(),
        description: createDesc.trim() || null,
        type: createType,
        color: createColor,
        owner_id: user.id,
      })
      .select()
      .single()
    setCreating(false)
    if (error) { alert('Erro ao criar projeto: ' + error.message); return }
    setShowCreate(false)
    resetCreateForm()
    await loadProjects()
    if (data) navigate(`/projects/${data.id}`)
  }

  function resetCreateForm() {
    setCreateName('')
    setCreateType('band')
    setCreateDesc('')
    setCreateColor(PROJECT_COLORS[0])
  }

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Os meus projetos</h1>
            <p className={styles.subtitle}>Bandas, projetos e colaborações musicais</p>
          </div>
          <button className={styles.createBtn} onClick={() => setShowCreate(true)}>
            + Criar projeto
          </button>
        </div>

        {loading ? (
          <div className={styles.loadingState}>A carregar projetos...</div>
        ) : projects.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎸</div>
            <h2 className={styles.emptyTitle}>Ainda não tens projetos</h2>
            <p className={styles.emptySub}>
              Cria o teu primeiro projeto musical para começares a organizar repertório, letras e setlists.
            </p>
            <button className={styles.emptyBtn} onClick={() => setShowCreate(true)}>
              Criar primeiro projeto
            </button>
          </div>
        ) : (
          <div className={styles.grid}>
            {projects.map(p => (
              <div
                key={p.id}
                className={styles.card}
                onClick={() => navigate(`/projects/${p.id}`)}
                style={{ '--project-color': p.color } as React.CSSProperties}
              >
                <div className={styles.cardAccent} style={{ background: p.color }} />
                <div className={styles.cardBody}>
                  <div className={styles.cardTop}>
                    <div className={styles.avatar} style={{ background: p.color }}>
                      {p.image_url
                        ? <img src={p.image_url} alt={p.name} className={styles.avatarImg} />
                        : initials(p.name)
                      }
                    </div>
                    <div className={styles.cardInfo}>
                      <div className={styles.cardName}>{p.name}</div>
                      <span className={styles.typeBadge}>
                        {PROJECT_TYPE_LABELS[p.type as ProjectType] ?? p.type}
                      </span>
                    </div>
                  </div>

                  {p.description && (
                    <p className={styles.cardDesc}>{p.description}</p>
                  )}

                  <div className={styles.cardStats}>
                    <span className={styles.stat}>
                      <span className={styles.statNum}>{p.memberCount}</span>
                      {' '}membro{p.memberCount !== 1 ? 's' : ''}
                    </span>
                    <span className={styles.statDot}>·</span>
                    <span className={styles.stat}>
                      <span className={styles.statNum}>{p.setlistCount}</span>
                      {' '}setlist{p.setlistCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className={styles.cardFooter}>
                    <span className={styles.roleBadge} data-role={p.myRole}>
                      {p.myRole}
                    </span>
                    <button
                      className={styles.enterBtn}
                      style={{ background: p.color }}
                      onClick={e => { e.stopPropagation(); navigate(`/projects/${p.id}`) }}
                    >
                      Entrar
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button className={styles.addCard} onClick={() => setShowCreate(true)}>
              <span className={styles.addPlus}>+</span>
              <span>Novo projeto</span>
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <div className={styles.overlay} onClick={() => { setShowCreate(false); resetCreateForm() }}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Criar projeto</span>
              <button className={styles.closeBtn} onClick={() => { setShowCreate(false); resetCreateForm() }}>✕</button>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Nome do projeto *</label>
              <input
                className={styles.input}
                placeholder="ex: Tributo Lady Gaga"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createProject()}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Tipo de projeto</label>
              <select
                className={styles.select}
                value={createType}
                onChange={e => setCreateType(e.target.value as ProjectType)}
              >
                {TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Descrição</label>
              <textarea
                className={styles.textarea}
                placeholder="Descrição opcional..."
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                rows={2}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Cor</label>
              <div className={styles.colorGrid}>
                {PROJECT_COLORS.map(c => (
                  <button
                    key={c}
                    className={`${styles.colorSwatch} ${createColor === c ? styles.colorActive : ''}`}
                    style={{ background: c }}
                    onClick={() => setCreateColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>

            <div className={styles.modalPreview}>
              <div className={styles.previewAvatar} style={{ background: createColor }}>
                {createName ? initials(createName) : '?'}
              </div>
              <div>
                <div className={styles.previewName}>{createName || 'Nome do projeto'}</div>
                <div className={styles.previewType}>{PROJECT_TYPE_LABELS[createType]}</div>
              </div>
            </div>

            <button
              className={styles.submitBtn}
              style={{ background: createColor }}
              onClick={createProject}
              disabled={creating || !createName.trim()}
            >
              {creating ? 'A criar...' : 'Criar projeto'}
            </button>
          </div>
        </div>
      )}
    </Layout>
  )
}
