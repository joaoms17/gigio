import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { uploadProjectImage } from '../../lib/uploadImage'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  type Project,
  type ProjectType,
  PROJECT_TYPE_LABELS,
  PROJECT_COLORS,
  ROLE_LABELS,
} from '../../types'
import { cacheProjects, getCachedProjects } from '../../lib/concertCache'
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

/* ── Ícones SVG inline ── */

function IconPlus({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconKey({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.85 12.15 21 2" />
      <path d="m15.5 7.5 3 3" />
    </svg>
  )
}

function IconChevronRight({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

function IconArrowRight({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="m14 6 6 6-6 6" />
    </svg>
  )
}

function IconX({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

function IconCamera({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function IconUsers({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconRefresh({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}

const TYPE_OPTIONS: { value: ProjectType; label: string }[] = Object.entries(
  PROJECT_TYPE_LABELS
).map(([value, label]) => ({ value: value as ProjectType, label }))

declare const __COMMIT_HASH__: string

async function hardRefresh() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map(r => r.unregister()))
  }
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map(k => caches.delete(k)))
  }
  window.location.reload()
}

export default function ProjectsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  // Create project form state
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState<ProjectType>('band')
  const [createDesc, setCreateDesc] = useState('')
  const [createColor, setCreateColor] = useState(PROJECT_COLORS[0])
  const [createImage, setCreateImage] = useState<File | null>(null)
  const [createImagePreview, setCreateImagePreview] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (user) loadProjects()
  }, [user])

  async function loadProjects() {
    if (!user) return
    setLoading(true)

    const { data: memberships, error } = await supabase
      .from('band_members')
      .select('band_id, role, bands(*)')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false })

    if (!memberships || error) {
      const cached = getCachedProjects<ProjectWithCounts[]>(user.id)
      if (cached) { setProjects(cached); setIsOffline(true) }
      setLoading(false)
      return
    }

    setIsOffline(false)
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

    const result = rawProjects.map((p: any) => ({
      ...p,
      type: p.type ?? 'band',
      color: p.color ?? PROJECT_COLORS[0],
      memberCount: memberCounts[p.id] ?? 0,
      setlistCount: setlistCounts[p.id] ?? 0,
    }))
    setProjects(result)
    cacheProjects(user.id, result)
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
    if (error) { setCreating(false); toast('Erro ao criar projeto: ' + error.message, { type: 'error' }); return }
    if (data && createImage) {
      try {
        const url = await uploadProjectImage(data.id, createImage)
        await supabase.from('bands').update({ image_url: url }).eq('id', data.id)
      } catch { /* imagem falhou mas projeto foi criado */ }
    }
    setCreating(false)
    setShowCreate(false)
    resetCreateForm()
    await loadProjects()
    if (data) navigate(`/projects/${data.id}`)
  }

  function pickCreateImage(file: File | null) {
    setCreateImage(file)
    if (createImagePreview) URL.revokeObjectURL(createImagePreview)
    setCreateImagePreview(file ? URL.createObjectURL(file) : null)
  }

  async function joinByCode() {
    if (!user || !joinCode.trim()) return
    setJoining(true)
    setJoinError(null)
    const { data: band, error } = await supabase
      .from('bands')
      .select('id, name, invite_expires_at')
      .eq('invite_code', joinCode.trim().toUpperCase())
      .single()
    if (error || !band) { setJoinError('Código inválido.'); setJoining(false); return }
    if (band.invite_expires_at && new Date(band.invite_expires_at) < new Date()) {
      setJoinError('Este código expirou.'); setJoining(false); return
    }
    // Already a member? Just navigate — never reset the existing role.
    const { data: existing } = await supabase
      .from('band_members')
      .select('role')
      .eq('band_id', band.id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!existing) {
      // O botão de entrada já é a confirmação explícita — sem confirm redundante.
      const { error: joinErr } = await supabase
        .from('band_members')
        .insert({ band_id: band.id, user_id: user.id, role: 'editor' })
      if (joinErr) { setJoinError('Erro ao entrar: ' + joinErr.message); setJoining(false); return }
    }
    setJoining(false)
    setJoinCode('')
    navigate(`/projects/${band.id}`)
  }

  function resetCreateForm() {
    setCreateName('')
    setCreateType('band')
    setCreateDesc('')
    setCreateColor(PROJECT_COLORS[0])
    pickCreateImage(null)
  }

  function openProject(id: string) {
    navigate(`/projects/${id}`)
  }

  return (
    <>
      <div className={styles.page}>
        {isOffline && (
          <div className={styles.offlineBanner}>
            Sem ligação — a mostrar dados em cache
          </div>
        )}

        <div className={styles.header}>
          <h1 className={styles.title}>Projetos</h1>
          <p className={styles.subtitle}>Bandas, tributos e colaborações musicais</p>
        </div>

        {/* CTAs: criar projeto + entrar com código */}
        <div className={styles.ctaRow}>
          <button className={styles.createCta} onClick={() => setShowCreate(true)}>
            <span className={styles.ctaIcon}><IconPlus size={22} /></span>
            <span className={styles.ctaText}>
              <span className={styles.ctaTitle}>Criar projeto</span>
              <span className={styles.ctaSub}>Banda, tributo ou projeto a solo</span>
            </span>
          </button>

          <div className={styles.joinCta}>
            <span className={`${styles.ctaIcon} ${styles.joinIcon}`}><IconKey size={20} /></span>
            <div className={styles.joinBody}>
              <span className={styles.joinTitle}>Entrar com código</span>
              <span className={styles.joinSub}>Pede ao dono do projeto o código de convite</span>
              <div className={styles.joinRow}>
                <input
                  className={styles.joinInput}
                  value={joinCode}
                  onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null) }}
                  onKeyDown={e => e.key === 'Enter' && joinByCode()}
                  placeholder="XXXX-0000"
                  maxLength={9}
                  aria-label="Código de convite"
                />
                <button
                  className={styles.joinGo}
                  onClick={joinByCode}
                  disabled={joining || !joinCode.trim()}
                  aria-label="Entrar no projeto"
                >
                  {joining ? <span aria-hidden="true">…</span> : <IconArrowRight size={18} />}
                </button>
              </div>
              {joinError && <p className={styles.joinError} role="alert">{joinError}</p>}
            </div>
          </div>
        </div>

        {loading ? (
          <div className={styles.grid} aria-hidden="true">
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.card} style={{ pointerEvents: 'none' }}>
                <div className="skeleton" style={{ width: 56, height: 56, borderRadius: 16, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="skeleton" style={{ height: 16, width: '65%', marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 12, width: '45%', marginBottom: 10 }} />
                  <div className="skeleton" style={{ height: 20, width: '55%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><IconUsers size={34} /></div>
            <h2 className={styles.emptyTitle}>Ainda não tens projetos</h2>
            <p className={styles.emptySub}>
              Cria o teu primeiro projeto musical para começares a organizar repertório, letras e concertos.
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
                role="button"
                tabIndex={0}
                onClick={() => openProject(p.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProject(p.id) }
                }}
                style={{ '--project-color': p.color } as React.CSSProperties}
              >
                <div className={styles.avatar} style={{ background: p.color }}>
                  {p.image_url
                    ? <img src={p.image_url} alt="" className={styles.avatarImg} />
                    : initials(p.name)
                  }
                </div>
                <div className={styles.cardInfo}>
                  <div className={styles.cardName}>{p.name}</div>
                  <div className={styles.cardMeta}>
                    <span>{p.memberCount} membro{p.memberCount !== 1 ? 's' : ''}</span>
                    <span className={styles.metaDot} aria-hidden="true">·</span>
                    <span>{p.setlistCount} concerto{p.setlistCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className={styles.cardBadges}>
                    <span className={styles.typeBadge}>
                      {PROJECT_TYPE_LABELS[p.type as ProjectType] ?? p.type}
                    </span>
                    <span className={styles.roleBadge} data-role={p.myRole}>
                      {ROLE_LABELS[p.myRole as keyof typeof ROLE_LABELS] ?? p.myRole}
                    </span>
                  </div>
                </div>
                <span className={styles.cardArrow} aria-hidden="true"><IconChevronRight /></span>
              </div>
            ))}

            <button className={styles.addCard} onClick={() => setShowCreate(true)}>
              <IconPlus size={22} />
              <span>Novo projeto</span>
            </button>
          </div>
        )}
      </div>

      {/* Version bar — só em desenvolvimento */}
      {import.meta.env.DEV && (
        <div className={styles.versionBar}>
          <span className={styles.versionHash}>v {__COMMIT_HASH__}</span>
          <button className={styles.refreshBtn} onClick={hardRefresh}>
            <IconRefresh /> Hard refresh
          </button>
        </div>
      )}

      {showCreate && (
        <div className={styles.overlay} onClick={() => { setShowCreate(false); resetCreateForm() }}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Criar projeto</span>
              <button
                className={styles.closeBtn}
                onClick={() => { setShowCreate(false); resetCreateForm() }}
                aria-label="Fechar"
              >
                <IconX />
              </button>
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

            <div className={styles.field}>
              <label className={styles.label}>Imagem (opcional)</label>
              <div className={styles.imageRow}>
                <label className={styles.imagePicker} style={{ background: createImagePreview ? 'transparent' : createColor }}>
                  {createImagePreview
                    ? <img src={createImagePreview} alt="" className={styles.imagePreview} />
                    : <span className={styles.imagePickerIcon}><IconCamera size={22} /></span>
                  }
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => pickCreateImage(e.target.files?.[0] ?? null)}
                  />
                </label>
                <div className={styles.imageHint}>
                  {createImage
                    ? <button className={styles.imageRemove} onClick={() => pickCreateImage(null)}>Remover imagem</button>
                    : 'Toca para escolher uma foto da banda ou logotipo'
                  }
                </div>
              </div>
            </div>

            <div className={styles.modalPreview}>
              <div className={styles.previewAvatar} style={{ background: createColor }}>
                {createImagePreview
                  ? <img src={createImagePreview} alt="" className={styles.imagePreview} />
                  : (createName ? initials(createName) : '?')
                }
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
    </>
  )
}
