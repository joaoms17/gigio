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
import { mapLegacyProjectColor } from '../../lib/projectColor'
import { extractInviteCode, joinProjectWithCode, takePendingInvite } from '../../lib/invites'

interface ProjectWithCounts extends Project {
  memberCount: number
  setlistCount: number
  myRole: string
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}


function mapColor(c: string): string {
  return mapLegacyProjectColor(c)
}

/** Amostras do seletor de cor (paleta v2, sem duplicados) */
const SWATCHES: string[] = Array.from(new Set(PROJECT_COLORS.map(mapColor)))

/** Cor do projeto pronta a mostrar (LED do quadrado de identidade) */
function projectColor(c: string | null | undefined): string {
  return c ? mapColor(c) : SWATCHES[0]
}

/**
 * Quadrado de identidade: tile neutro (painel + hairline) com a inicial condensada
 * em tinta, ou a foto; a cor do projeto vive só no LED de 10px do canto (spec §3).
 */
function ProjectTile({ color, imageUrl, label }: { color: string | null | undefined; imageUrl?: string | null; label: string }) {
  return (
    <div className={styles.avatar} aria-hidden="true">
      {imageUrl
        ? <img src={imageUrl} alt="" className={styles.avatarImg} />
        : <span className={styles.avatarInitial}>{label}</span>
      }
      <span className={styles.avatarLed} style={{ background: projectColor(color) }} />
    </div>
  )
}

/* ── Ícones SVG inline (stroke, currentColor) ── */

function IconPlus({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
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

function IconChevronDown({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
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

function IconX({ size = 18 }: { size?: number }) {
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

function IconUsers({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconRefresh({ size = 14 }: { size?: number }) {
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
  const [createColor, setCreateColor] = useState(SWATCHES[0])
  const [createImage, setCreateImage] = useState<File | null>(null)
  const [createImagePreview, setCreateImagePreview] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (user) loadProjects()
  }, [user])

  // Convite aberto antes de ter conta (ex.: criou conta e confirmou o email,
  // e o link de confirmação trouxe-o para aqui): retoma-o uma vez
  useEffect(() => {
    if (!user) return
    const pending = takePendingInvite()
    if (pending) navigate(pending)
  }, [user, navigate])

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
      color: p.color ?? SWATCHES[0],
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
    if (!user || !joinCode.trim() || joining) return
    setJoining(true)
    setJoinError(null)
    // O botão de entrada já é a confirmação explícita — sem confirm redundante.
    // Validação (código, validade, já-membro) no servidor: src/lib/invites.ts
    const res = await joinProjectWithCode(joinCode, user.id)
    setJoining(false)
    if (res.ok) {
      setJoinCode('')
      navigate(`/projects/${res.projectId}`)
      return
    }
    if (res.reason === 'already_member' && res.projectId) {
      // Já é membro: abre o projeto — nunca mexe no papel
      setJoinCode('')
      toast(res.message)
      navigate(`/projects/${res.projectId}`)
      return
    }
    setJoinError(res.message)
  }

  function resetCreateForm() {
    setCreateName('')
    setCreateType('band')
    setCreateDesc('')
    setCreateColor(SWATCHES[0])
    pickCreateImage(null)
  }

  function openProject(id: string) {
    navigate(`/projects/${id}`)
  }

  function closeCreate() {
    setShowCreate(false)
    resetCreateForm()
  }

  return (
    <>
      <div className={styles.page}>
        {isOffline && (
          <div className={styles.offlineBanner} role="status">
            <span className={styles.offlineLed} aria-hidden="true" />
            Sem ligação — a mostrar dados em cache
          </div>
        )}

        <header className={styles.top}>
          <h1 className={styles.pageTitle}>Projetos</h1>
          <p className={styles.kicker}>Bandas · tributos · colaborações</p>
        </header>

        {/* CTAs: criar projeto (primário) + entrar com código (painel) */}
        <div className={styles.ctaRow}>
          <section className={styles.ctaPanel} aria-labelledby="projects-create-label">
            <h2 id="projects-create-label" className={styles.label}>Novo projeto</h2>
            <p className={styles.ctaText}>
              Banda, tributo ou projeto a solo — com repertório, letras e concertos partilhados.
            </p>
            <div className={styles.ctaControls}>
              <button className={styles.primaryBtn} onClick={() => setShowCreate(true)}>
                <IconPlus size={20} />
                Criar projeto
              </button>
            </div>
          </section>

          <section className={styles.ctaPanel} aria-labelledby="projects-join-label">
            <h2 id="projects-join-label" className={styles.label}>Entrar com código</h2>
            <p className={styles.ctaText}>Pede ao dono do projeto o código de convite.</p>
            <div className={styles.ctaControls}>
              <div className={styles.joinRow}>
                <input
                  className={styles.joinInput}
                  value={joinCode}
                  onChange={e => { setJoinCode(extractInviteCode(e.target.value)); setJoinError(null) }}
                  onKeyDown={e => e.key === 'Enter' && joinByCode()}
                  placeholder="XXXX-0000"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Código de convite"
                  aria-invalid={joinError ? true : undefined}
                  aria-describedby={joinError ? 'projects-join-error' : undefined}
                />
                <button
                  className={styles.secondaryBtn}
                  onClick={joinByCode}
                  disabled={joining || !joinCode.trim()}
                >
                  {joining ? 'A entrar…' : 'Entrar'}
                  {!joining && <IconArrowRight size={16} />}
                </button>
              </div>
              {joinError && <p id="projects-join-error" className={styles.joinError} role="alert">{joinError}</p>}
            </div>
          </section>
        </div>

        {/* Lista de projetos */}
        <section className={styles.section} aria-labelledby="projects-list-label">
          {/* "OS TEUS PROJETOS ──────── 03" — contagem à direita da régua, como na agenda */}
          <div className={styles.sectionHead}>
            <h2 id="projects-list-label" className={styles.label}>Os teus projetos</h2>
            <span className={styles.rule} aria-hidden="true" />
            {!loading && projects.length > 0 && (
              <span className={styles.headCount} aria-label={`${projects.length} projetos`}>
                {String(projects.length).padStart(2, '0')}
              </span>
            )}
          </div>

          {loading ? (
            <div className={styles.panel} aria-hidden="true">
              {[0, 1, 2].map(i => (
                <div key={i} className={styles.rowSkeleton}>
                  <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 6, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="skeleton" style={{ height: 16, width: '55%', marginBottom: 8 }} />
                    <div className="skeleton" style={{ height: 11, width: '35%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}><IconUsers size={28} /></span>
              <h3 className={styles.emptyTitle}>Ainda não tens projetos</h3>
              <p className={styles.emptySub}>
                Cria o teu primeiro projeto acima — ou entra num já existente com o código de convite.
              </p>
            </div>
          ) : (
            <div className={styles.panel}>
              {projects.map(p => {
                const typeLabel = PROJECT_TYPE_LABELS[p.type as ProjectType] ?? p.type
                const roleLabel = ROLE_LABELS[p.myRole as keyof typeof ROLE_LABELS] ?? p.myRole
                return (
                  <div
                    key={p.id}
                    className={styles.row}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir projeto ${p.name}`}
                    onClick={() => openProject(p.id)}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProject(p.id) }
                    }}
                  >
                    {/* Quadrado de identidade neutro + LED na cor do projeto (ou a foto) */}
                    <ProjectTile color={p.color} imageUrl={p.image_url} label={initials(p.name)} />
                    <div className={styles.rowInfo}>
                      <div className={styles.rowName}>{p.name}</div>
                      <div className={styles.rowMeta}>
                        <span className={styles.metaItem}>
                          {p.memberCount} membro{p.memberCount !== 1 ? 's' : ''}
                        </span>
                        <span className={styles.sep} aria-hidden="true"> · </span>
                        <span className={styles.metaItem}>
                          {p.setlistCount} concerto{p.setlistCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <div className={styles.rowChips}>
                      <span className={styles.chip}>{typeLabel}</span>
                      <span className={styles.chip}>{roleLabel}</span>
                    </div>
                    <span className={styles.rowChevron} aria-hidden="true"><IconChevronRight /></span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Version bar — só em desenvolvimento */}
      {import.meta.env.DEV && (
        <div className={styles.versionBar}>
          <span className={styles.versionHash}>DEV · v {__COMMIT_HASH__}</span>
          <button className={styles.refreshBtn} onClick={hardRefresh}>
            <IconRefresh /> Hard refresh
          </button>
        </div>
      )}

      {showCreate && (
        <div className={styles.overlay} onClick={closeCreate}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalHeadText}>
                <span className={styles.label}>Novo projeto</span>
                <h2 id="create-project-title" className={styles.modalTitle}>Criar projeto</h2>
              </div>
              <button
                className={styles.iconBtn}
                onClick={closeCreate}
                aria-label="Fechar"
              >
                <IconX />
              </button>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="create-project-name">Nome do projeto *</label>
              <input
                id="create-project-name"
                className={styles.input}
                placeholder="ex: Tributo Lady Gaga"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createProject()}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="create-project-type">Tipo de projeto</label>
              <div className={styles.selectWrap}>
                <select
                  id="create-project-type"
                  className={styles.select}
                  value={createType}
                  onChange={e => setCreateType(e.target.value as ProjectType)}
                >
                  {TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span className={styles.selectIcon}><IconChevronDown /></span>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="create-project-desc">Descrição</label>
              <textarea
                id="create-project-desc"
                className={styles.textarea}
                placeholder="Descrição opcional..."
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                rows={2}
              />
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel} id="create-project-color">Cor</span>
              <div className={styles.colorGrid} role="group" aria-labelledby="create-project-color">
                {SWATCHES.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.colorSwatch} ${createColor === c ? styles.colorActive : ''}`}
                    style={{ background: c }}
                    onClick={() => setCreateColor(c)}
                    aria-label={`Cor ${c}`}
                    aria-pressed={createColor === c}
                    title={c}
                  />
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Imagem (opcional)</span>
              <div className={styles.imageRow}>
                <label className={styles.imagePicker}>
                  {createImagePreview
                    ? <img src={createImagePreview} alt="" className={styles.imagePreview} />
                    : <IconCamera size={22} />
                  }
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    aria-label="Escolher imagem do projeto"
                    onChange={e => pickCreateImage(e.target.files?.[0] ?? null)}
                  />
                </label>
                <div className={styles.imageHint}>
                  {createImage
                    ? <button type="button" className={styles.textDangerBtn} onClick={() => pickCreateImage(null)}>Remover imagem</button>
                    : 'Toca para escolher uma foto da banda ou logotipo'
                  }
                </div>
              </div>
            </div>

            {/* Pré-visualização — igual a uma linha da lista */}
            <div className={styles.modalPreview}>
              <span className={styles.label}>Pré-visualização</span>
              <div className={styles.previewRow}>
                <ProjectTile
                  color={createColor}
                  imageUrl={createImagePreview}
                  label={createName ? initials(createName) : '?'}
                />
                <div className={styles.rowInfo}>
                  <div className={styles.rowName}>{createName || 'Nome do projeto'}</div>
                  <div className={styles.rowMeta}>{PROJECT_TYPE_LABELS[createType]}</div>
                </div>
              </div>
            </div>

            <button
              className={`${styles.primaryBtn} ${styles.submitBtn}`}
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
