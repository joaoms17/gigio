import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../components/Toast'
import { PROJECT_TYPE_LABELS, ROLE_LABELS } from '../../types'
import type { ProjectType, ProjectRole } from '../../types'
import styles from './InvitePage.module.css'

interface InviteData {
  id: string
  project_id: string
  email: string
  role: ProjectRole
  status: string
  expires_at: string
  bands: {
    id: string
    name: string
    type: string
    color: string
    description?: string
  }
}

/* Benefícios — a mesma setlist impressa do login (01/02/03): o convite é,
   muitas vezes, o primeiro contacto de um músico novo com a app */
const BENEFITS = [
  'Setlists partilhadas com a banda, sempre atualizadas',
  'Letras, tons e anotações de cada música à mão',
  'Modo palco legível no escuro — mesmo sem internet',
]

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Códigos de convite têm o formato "ABCD-1234" (migration_bands.sql):
 *  normaliza o que o utilizador escreve/cola e insere o hífen sozinho. */
function formatCode(raw: string) {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

/* ── Ícones v2: traço 1.8, cantos secos, currentColor ── */

const ICON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  'aria-hidden': true,
}

function IconX() {
  return (
    <svg {...ICON} width="22" height="22" strokeWidth={2}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg {...ICON} width="22" height="22" strokeWidth={2.2}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconArrowLeft() {
  return (
    <svg {...ICON} width="18" height="18">
      <path d="M20 12H5M11 18l-6-6 6-6" />
    </svg>
  )
}

function IconArrowRight() {
  return (
    <svg {...ICON} width="18" height="18" strokeWidth={2}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

/** Moldura partilhada: wordmark (cartaz) + painel */
function Shell({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <header className={styles.brand}>
          {/* Wordmark v2 (§4.5): "gigio" condensado 800 + quadrado laranja no fim — igual à topbar */}
          <div className={styles.brandTitle}>
            <span className={styles.wordmark} role="img" aria-label="gigio">
              <span aria-hidden="true">gigio</span>
              <span className={styles.wordmarkDot} aria-hidden="true" />
            </span>
          </div>
          <p className={styles.brandLine}>Setlists · Letras · Palco</p>
        </header>
        {/* Só ≥768: enche a coluna da marca como no login */}
        <ol className={styles.benefits} aria-label="O que o gigio faz">
          {BENEFITS.map((b, i) => (
            <li key={i} className={styles.benefit}>
              <span className={styles.num} aria-hidden="true">{pad2(i + 1)}</span>
              <span className={styles.benefitText}>{b}</span>
            </li>
          ))}
        </ol>
        <main className={styles.panel} aria-busy={busy || undefined}>
          {children}
        </main>
      </div>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <Shell busy>
      <div className={styles.loading} role="status">
        <span className={styles.loadingLed} aria-hidden="true" />
        {label}
      </div>
    </Shell>
  )
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const inviteCode = searchParams.get('code')
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [invite, setInvite] = useState<InviteData | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [done, setDone] = useState(false)
  const [codeInput, setCodeInput] = useState(formatCode(inviteCode ?? ''))
  const [codeError, setCodeError] = useState<string | null>(null)
  const [joiningByCode, setJoiningByCode] = useState(false)

  useEffect(() => {
    if (!token || authLoading) return
    fetchInvite()
  }, [token, authLoading, user])

  async function fetchInvite() {
    if (!token) return
    const { data, error } = await supabase
      .from('project_invites')
      .select('*, bands(id, name, type, color, description)')
      .eq('token', token)
      .single()

    if (error || !data) {
      setInviteError('Convite inválido ou já utilizado.')
      return
    }
    if (data.status === 'accepted') {
      setInviteError('Este convite já foi aceite.')
      return
    }
    if (data.status === 'revoked') {
      setInviteError('Este convite foi revogado.')
      return
    }
    if (new Date(data.expires_at) < new Date()) {
      setInviteError('Este convite expirou.')
      return
    }
    setInvite(data as InviteData)
  }

  async function acceptInvite() {
    if (!invite || !user) return
    setAccepting(true)

    // Already a member? Don't touch the existing role (re-accepting an old
    // invite must never downgrade an admin back to the invited role).
    const { data: existing } = await supabase
      .from('band_members')
      .select('role')
      .eq('band_id', invite.project_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!existing) {
      const { error: insertErr } = await supabase
        .from('band_members')
        .insert({ band_id: invite.project_id, user_id: user.id, role: invite.role })
      if (insertErr) { toast('Erro ao entrar no projeto: ' + insertErr.message, { type: 'error' }); setAccepting(false); return }
    }

    await supabase.from('project_invites').update({ status: 'accepted' }).eq('id', invite.id)

    setDone(true)
    setTimeout(() => navigate(`/projects/${invite.project_id}`), 1800)
  }

  async function joinByCode() {
    if (!user || !codeInput.trim()) return
    setJoiningByCode(true)
    setCodeError(null)

    // Formato atual "ABCD-1234"; aceita também códigos antigos sem hífen
    const code = formatCode(codeInput)
    const bare = code.replace('-', '')
    const { data: band, error } = await supabase
      .from('bands')
      .select('id, name, type, color, invite_code, invite_expires_at')
      .in('invite_code', code === bare ? [code] : [code, bare])
      .limit(1)
      .maybeSingle()

    if (error || !band) {
      setCodeError('Código inválido.')
      setJoiningByCode(false)
      return
    }

    if (band.invite_expires_at && new Date(band.invite_expires_at) < new Date()) {
      setCodeError('Este código de convite expirou.')
      setJoiningByCode(false)
      return
    }

    // Already a member? Just go in — don't reset the role.
    const { data: existing } = await supabase
      .from('band_members')
      .select('role')
      .eq('band_id', band.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      navigate(`/projects/${band.id}`)
      return
    }

    // O botão "Entrar no projeto" já é a confirmação explícita — sem confirm redundante.
    const { error: joinErr } = await supabase
      .from('band_members')
      .insert({ band_id: band.id, user_id: user.id, role: 'editor' })

    if (joinErr) { setCodeError('Erro ao entrar: ' + joinErr.message); setJoiningByCode(false); return }

    navigate(`/projects/${band.id}`)
  }

  if (authLoading) {
    return <Loading label="A carregar…" />
  }

  if (!user) {
    return (
      <Shell>
        <div className={styles.label}>Convite</div>
        <h1 className={styles.title}>Tens um convite!</h1>
        <p className={styles.sub}>Faz login ou cria uma conta para aceitar o convite e entrar no projeto.</p>
        <button
          className={styles.btn}
          onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
        >
          Entrar / Criar conta
          <IconArrowRight />
        </button>
      </Shell>
    )
  }

  // Token-based invite flow
  if (token) {
    if (inviteError) {
      return (
        <Shell>
          <div className={`${styles.stateIcon} ${styles.stateError}`}><IconX /></div>
          <h1 className={styles.title}>Convite inválido</h1>
          <p className={styles.sub}>{inviteError}</p>
          <button className={styles.btnSecondary} onClick={() => navigate('/')}>Ir para o início</button>
        </Shell>
      )
    }

    if (!invite) {
      return <Loading label="A verificar convite…" />
    }

    if (done) {
      return (
        <Shell>
          <div className={`${styles.stateIcon} ${styles.stateSuccess}`}><IconCheck /></div>
          <h1 className={styles.title}>Bem-vindo ao projeto!</h1>
          <p className={styles.metaLine} role="status">A redirecionar para {invite.bands.name}…</p>
        </Shell>
      )
    }

    const projectColor = invite.bands.color || 'var(--text3)'
    const typeLabel = PROJECT_TYPE_LABELS[invite.bands.type as ProjectType] ?? invite.bands.type
    const expiry = new Date(invite.expires_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })

    return (
      <Shell>
        <div className={styles.label}>Convite para projeto</div>
        <div className={styles.project}>
          <span className={styles.led} style={{ background: projectColor }} aria-hidden="true" />
          <h1 className={styles.projectName}>{invite.bands.name}</h1>
        </div>
        <p className={styles.metaLine}>
          {typeLabel}
          <span className={styles.sep} aria-hidden="true">·</span>
          {ROLE_LABELS[invite.role]}
          <span className={styles.sep} aria-hidden="true">·</span>
          Expira a {expiry}
        </p>
        <p className={styles.inviteMsg}>
          Foste convidado para entrar neste projeto como <strong>{ROLE_LABELS[invite.role]}</strong>.
        </p>
        {invite.bands.description && (
          <p className={styles.projectDesc}>{invite.bands.description}</p>
        )}
        <div className={styles.actions}>
          <button
            className={styles.btn}
            onClick={acceptInvite}
            disabled={accepting}
          >
            {accepting ? 'A entrar…' : <>Entrar em {invite.bands.name}<IconArrowRight /></>}
          </button>
          <button className={styles.btnGhost} onClick={() => navigate('/')}>
            Recusar
          </button>
        </div>
      </Shell>
    )
  }

  // Code-based join
  return (
    <Shell>
      <div className={styles.label}>Código de convite</div>
      <h1 className={styles.title}>Entrar num projeto</h1>
      <p className={styles.sub}>Introduz o código de convite que recebeste.</p>
      <div className={styles.codeForm}>
        <input
          className={styles.codeInput}
          value={codeInput}
          onChange={e => setCodeInput(formatCode(e.target.value))}
          placeholder="XXXX-0000"
          maxLength={9}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={e => e.key === 'Enter' && joinByCode()}
          aria-label="Código de convite"
          aria-invalid={codeError ? true : undefined}
          aria-describedby={codeError ? 'invite-code-error' : undefined}
        />
        {codeError && <p id="invite-code-error" className={styles.codeError} role="alert">{codeError}</p>}
        <button
          className={styles.btn}
          onClick={joinByCode}
          disabled={joiningByCode || !codeInput.trim()}
        >
          {joiningByCode ? 'A verificar…' : <>Entrar no projeto<IconArrowRight /></>}
        </button>
      </div>
      <button className={styles.backLink} onClick={() => navigate('/')}>
        <IconArrowLeft />
        Voltar ao início
      </button>
    </Shell>
  )
}
