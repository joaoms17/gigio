import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../components/Toast'
import { PROJECT_TYPE_LABELS, ROLE_LABELS } from '../../types'
import type { ProjectType, ProjectCodePeek, ProjectInviteDetails } from '../../types'
import {
  acceptProjectInvite,
  bareInviteCode,
  clearPendingInvite,
  extractInviteCode,
  getProjectInvite,
  INVITE_MESSAGES,
  type InviteLookup,
  isCompleteInviteCode,
  joinProjectWithCode,
  peekProjectCode,
  roleRank,
  savePendingInvite,
} from '../../lib/invites'
import { mapLegacyProjectColor } from '../../lib/projectColor'
import styles from './InvitePage.module.css'
import Wordmark from '../../components/Wordmark'

/** Ecrã de erro/estado do convite por link (inválido, expirado, já aceite…) */
interface InviteProblem {
  title: string
  message: string
  /** Já faz parte do projeto → oferecer "Abrir projeto" em vez de um beco sem saída */
  projectId?: string
  /** Nota secundária (ex.: "este convite é para outra pessoa?") */
  note?: string
  /** Falha de rede / servidor → "Tentar outra vez" */
  retry?: boolean
  /** Sessão terminou → "Entrar outra vez" */
  login?: boolean
}

const PROBLEM_TITLES = {
  invalid_token: 'Convite inválido',
  expired: 'Convite expirado',
  revoked: 'Convite revogado',
  already_accepted: 'Convite já aceite',
} as const

/** LED do projeto: paleta v2 (remapeia cores antigas guardadas nos dados) */
function ledColor(c: string | null | undefined): string {
  return c ? mapLegacyProjectColor(c) : 'var(--text3)'
}

function typeLabelOf(type: string): string {
  return PROJECT_TYPE_LABELS[type as ProjectType] ?? type
}

/* Benefícios — a mesma setlist impressa do login (01/02/03): o convite é,
   muitas vezes, o primeiro contacto de um músico novo com a app */
const BENEFITS = [
  'Setlists partilhadas com a banda, sempre atualizadas',
  'Letras, tons e anotações de cada música à mão',
  'Modo palco legível no escuro — mesmo sem internet',
]

const pad2 = (n: number) => String(n).padStart(2, '0')

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
            <Wordmark className={styles.wordmark} />
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

  /** Código que veio no link (/join?code=…), já normalizado — "" se não veio */
  const linkCode = extractInviteCode(inviteCode ?? '')

  const [invite, setInvite] = useState<ProjectInviteDetails | null>(null)
  const [inviteProblem, setInviteProblem] = useState<InviteProblem | null>(null)
  /** Muda para voltar a pedir o convite ("Tentar outra vez") */
  const [inviteAttempt, setInviteAttempt] = useState(0)
  const [accepting, setAccepting] = useState(false)
  const [done, setDone] = useState(false)
  const [codeInput, setCodeInput] = useState(linkCode)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [joiningByCode, setJoiningByCode] = useState(false)
  /** Projeto do código escrito/colado (peek) — mostrado antes de entrar; só vale para esse código */
  const [peeked, setPeeked] = useState<{ code: string; project: ProjectCodePeek } | null>(null)
  const preview = peeked && peeked.code === bareInviteCode(codeInput) ? peeked.project : null
  /** Código ainda é o do link (não foi escrito à mão) → mensagens a falar do link */
  const codeFromLink = !!linkCode && bareInviteCode(codeInput) === bareInviteCode(linkCode)
  const invalidMessage = codeFromLink ? INVITE_MESSAGES.invalidLink : INVITE_MESSAGES.invalidCode

  const authRedirect = `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`

  // Sem sessão: guarda o convite para o retomar depois de criar conta (a
  // confirmação por email pode trazer a pessoa de volta à página inicial).
  // Com sessão: já está aqui — o pendente deixa de ser preciso.
  useEffect(() => {
    if (authLoading) return
    if (user) clearPendingInvite()
    else if (token) savePendingInvite('token', token)
    else if (linkCode) savePendingInvite('code', linkCode)
  }, [authLoading, user, token, linkCode])

  // Código completo → espreita o projeto: mostra o nome e, se expirou, avisa logo
  useEffect(() => {
    if (token || !user || !isCompleteInviteCode(codeInput)) return
    let alive = true
    const code = bareInviteCode(codeInput)
    const timer = setTimeout(async () => {
      const res = await peekProjectCode(code, user.id)
      if (!alive) return
      if (res.status === 'found') {
        setPeeked({ code, project: res.project })
        // Já é membro: abre o projeto, mesmo com o código expirado
        setCodeError(res.project.expired && !res.project.is_member ? INVITE_MESSAGES.expiredCode : null)
      } else if (res.status === 'not_found') {
        setPeeked(null)
        setCodeError(invalidMessage)
      } else if (res.reason === 'rate_limited' || res.reason === 'not_authenticated') {
        setPeeked(null)
        setCodeError(res.message)
      }
      // erro de rede: fica calado — o botão "Entrar" volta a tentar e explica
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [codeInput, token, user, invalidMessage])

  /** Resultado de get_project_invite → ecrã de aceitar, ou o estado (inválido, expirado, já aceite…) */
  function showInvite(res: InviteLookup) {
    if (res.status === 'not_found') {
      setInviteProblem({ title: PROBLEM_TITLES.invalid_token, message: INVITE_MESSAGES.inviteInvalid })
      return
    }
    if (res.status === 'error') {
      setInviteProblem(res.reason === 'not_authenticated'
        ? { title: 'Sessão terminada', message: res.message, login: true }
        : { title: res.reason === 'network' ? 'Sem ligação' : 'Convite indisponível', message: res.message, retry: true })
      return
    }
    const inv = res.invite
    if (inv.status === 'accepted') {
      setInviteProblem(inv.already_member
        ? { title: PROBLEM_TITLES.already_accepted, message: `Já fazes parte de ${inv.project.name}.`, projectId: inv.project_id }
        : { title: PROBLEM_TITLES.already_accepted, message: INVITE_MESSAGES.inviteAccepted })
      return
    }
    if (inv.status === 'revoked') {
      setInviteProblem({ title: PROBLEM_TITLES.revoked, message: INVITE_MESSAGES.inviteRevoked })
      return
    }
    // Já é membro e o convite não lhe dá nada (ex.: o dono a testar o link):
    // abre o projeto e NÃO aceita — o convite fica para quem foi convidado
    if (inv.already_member && roleRank(inv.my_role) >= roleRank(inv.role)) {
      setInviteProblem({
        title: 'Já fazes parte',
        message: `Já és membro de ${inv.project.name}.`,
        projectId: inv.project_id,
        note: inv.status === 'pending' && !inv.expired ? INVITE_MESSAGES.inviteForSomeoneElse : undefined,
      })
      return
    }
    if (inv.expired) {
      setInviteProblem({ title: PROBLEM_TITLES.expired, message: INVITE_MESSAGES.inviteExpired })
      return
    }
    setInviteProblem(null)
    setInvite(inv)
  }

  useEffect(() => {
    if (!token || authLoading || !user) return
    let alive = true
    getProjectInvite(token).then(res => { if (alive) showInvite(res) })
    return () => { alive = false }
  }, [token, authLoading, user, inviteAttempt])

  function retryInvite() {
    setInviteProblem(null)
    setInvite(null)
    setInviteAttempt(n => n + 1)
  }

  async function acceptInvite() {
    if (!invite || !user || !token || accepting) return
    setAccepting(true)
    // Servidor: valida o convite, nunca baixa o papel de quem já é membro e marca-o como aceite
    const res = await acceptProjectInvite(token, invite, user.id)
    if (!res.ok) {
      setAccepting(false)
      switch (res.reason) {
        case 'not_authenticated':
          setInviteProblem({ title: 'Sessão terminada', message: res.message, login: true })
          return
        case 'invalid_token':
        case 'expired':
        case 'revoked':
        case 'already_accepted':
          setInviteProblem({ title: PROBLEM_TITLES[res.reason], message: res.message })
          return
        default:  // rede / outro: fica no ecrã, pode tocar outra vez
          toast(res.message, { type: 'error' })
          return
      }
    }
    setDone(true)
    setTimeout(() => navigate(`/projects/${res.projectId}`), 1800)
  }

  async function joinByCode() {
    if (!user || !codeInput.trim() || joiningByCode) return
    // Já é membro (o peek disse): abre o projeto sem passar pelo "entrar"
    if (preview?.is_member && preview.id) { navigate(`/projects/${preview.id}`); return }
    setJoiningByCode(true)
    setCodeError(null)

    // O botão "Entrar" já é a confirmação explícita — sem confirm redundante.
    // Código, validade e já-membro são validados no servidor (src/lib/invites.ts).
    const res = await joinProjectWithCode(codeInput, user.id)
    if (res.ok) { navigate(`/projects/${res.projectId}`); return }

    setJoiningByCode(false)
    if (res.reason === 'already_member' && res.projectId) {
      // Já é membro: entra — sem mexer no papel
      toast(res.message)
      navigate(`/projects/${res.projectId}`)
      return
    }
    if (res.reason === 'invalid_code') {
      // O código deixou de existir (ex.: o dono gerou um novo) — esquece o projeto mostrado
      setPeeked(null)
      setCodeError(invalidMessage)
      return
    }
    setCodeError(res.message)
  }

  if (authLoading) {
    return <Loading label="A carregar…" />
  }

  if (!user) {
    return (
      <Shell>
        <div className={styles.label}>Convite</div>
        <h1 className={styles.title}>Tens um convite!</h1>
        {/* O código à vista: se a conta for criada noutro browser (link do email
            de confirmação), dá para o anotar e escrever depois */}
        {linkCode && !token ? (
          <div className={styles.codeCard}>
            <span className={styles.codeCardLabel}>Código de convite</span>
            <span className={styles.codeCardValue}>{linkCode}</span>
          </div>
        ) : token ? (
          <div className={styles.codeCard}>
            <span className={styles.codeCardLabel}>Convite pessoal</span>
            <span className={styles.codeCardHint}>Depois de entrares, volta a abrir este link se não fores levado ao convite.</span>
          </div>
        ) : null}
        <p className={styles.sub}>Faz login ou cria uma conta para aceitar o convite e entrar no projeto.</p>
        <button
          className={styles.btn}
          onClick={() => {
            if (token) savePendingInvite('token', token)
            else if (linkCode) savePendingInvite('code', linkCode)
            navigate(authRedirect)
          }}
        >
          Entrar / Criar conta
          <IconArrowRight />
        </button>
      </Shell>
    )
  }

  // Token-based invite flow
  if (token) {
    if (inviteProblem) {
      const member = !!inviteProblem.projectId
      return (
        <Shell>
          <div className={`${styles.stateIcon} ${member ? styles.stateSuccess : styles.stateError}`}>
            {member ? <IconCheck /> : <IconX />}
          </div>
          <h1 className={styles.title}>{inviteProblem.title}</h1>
          <p className={styles.sub}>{inviteProblem.message}</p>
          {inviteProblem.note && <p className={styles.note}>{inviteProblem.note}</p>}
          <div className={styles.actions}>
            {member ? (
              <button className={styles.btn} onClick={() => navigate(`/projects/${inviteProblem.projectId}`)}>
                Abrir projeto<IconArrowRight />
              </button>
            ) : inviteProblem.login ? (
              <button className={styles.btn} onClick={() => navigate(authRedirect)}>
                Entrar outra vez<IconArrowRight />
              </button>
            ) : inviteProblem.retry ? (
              <>
                <button className={styles.btn} onClick={retryInvite}>Tentar outra vez</button>
                <button className={styles.btnSecondary} onClick={() => navigate('/join')}>
                  Tenho um código de convite
                </button>
              </>
            ) : (
              <button className={styles.btnSecondary} onClick={() => navigate('/join')}>
                Tenho um código de convite
              </button>
            )}
            <button className={styles.btnGhost} onClick={() => navigate('/')}>Ir para o início</button>
          </div>
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
          <p className={styles.metaLine} role="status">A redirecionar para {invite.project.name}…</p>
        </Shell>
      )
    }

    const typeLabel = typeLabelOf(invite.project.type)
    const expiry = new Date(invite.expires_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })
    const roleLabel = ROLE_LABELS[invite.role] ?? invite.role

    return (
      <Shell>
        <div className={styles.label}>Convite para projeto</div>
        <div className={styles.project}>
          <span className={styles.led} style={{ background: ledColor(invite.project.color) }} aria-hidden="true" />
          <h1 className={styles.projectName}>{invite.project.name}</h1>
        </div>
        <p className={styles.metaLine}>
          {typeLabel}
          <span className={styles.sep} aria-hidden="true">·</span>
          {roleLabel}
          <span className={styles.sep} aria-hidden="true">·</span>
          Expira a {expiry}
        </p>
        <p className={styles.inviteMsg}>
          {invite.already_member && invite.my_role
            ? <>Já és membro como <strong>{ROLE_LABELS[invite.my_role] ?? invite.my_role}</strong>. Aceitar muda o teu papel para <strong>{roleLabel}</strong>.</>
            : invite.invited_by_name
              ? <>{invite.invited_by_name} convidou-te para entrar neste projeto como <strong>{roleLabel}</strong>.</>
              : <>Foste convidado para entrar neste projeto como <strong>{roleLabel}</strong>.</>}
        </p>
        {invite.project.description && (
          <p className={styles.projectDesc}>{invite.project.description}</p>
        )}
        <div className={styles.actions}>
          <button
            className={styles.btn}
            onClick={acceptInvite}
            disabled={accepting}
          >
            {accepting
              ? 'A entrar…'
              : invite.already_member
                ? <>Aceitar papel de {roleLabel}<IconArrowRight /></>
                : <>Entrar em {invite.project.name}<IconArrowRight /></>}
          </button>
          <button className={styles.btnGhost} onClick={() => navigate('/')}>
            Recusar
          </button>
        </div>
      </Shell>
    )
  }

  // Code-based join
  const canEnterPreview = preview && !preview.expired && !preview.is_member
  const memberPreview = preview?.is_member && preview.id ? preview : null
  return (
    <Shell>
      <div className={styles.label}>Código de convite</div>
      <h1 className={styles.title}>Entrar num projeto</h1>
      <p className={styles.sub}>Introduz o código de convite que recebeste.</p>
      <div className={styles.codeForm}>
        {/* Sem maxLength: o browser cortava o que se colava (" ABCD-1234",
            a mensagem partilhada, o link) antes de extractInviteCode o ler */}
        <input
          className={styles.codeInput}
          value={codeInput}
          onChange={e => { setCodeInput(extractInviteCode(e.target.value)); setCodeError(null) }}
          placeholder="XXXX-0000"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={e => e.key === 'Enter' && joinByCode()}
          aria-label="Código de convite"
          aria-invalid={codeError ? true : undefined}
          aria-describedby={codeError ? 'invite-code-error' : preview ? 'invite-code-preview' : undefined}
        />
        {preview && (
          <div id="invite-code-preview" className={styles.codePreview}>
            <span className={styles.led} style={{ background: ledColor(preview.color) }} aria-hidden="true" />
            <span className={styles.codePreviewName}>{preview.name}</span>
            <span
              className={`${styles.codePreviewTag} ${
                preview.is_member ? styles.codePreviewMember : preview.expired ? styles.codePreviewExpired : ''}`}
            >
              {preview.is_member ? 'Já és membro' : preview.expired ? 'Expirado' : typeLabelOf(preview.type)}
            </span>
          </div>
        )}
        {codeError && <p id="invite-code-error" className={styles.codeError} role="alert">{codeError}</p>}
        <button
          className={styles.btn}
          onClick={joinByCode}
          disabled={joiningByCode || !codeInput.trim()}
        >
          {joiningByCode
            ? 'A verificar…'
            : memberPreview
              ? <>Abrir {memberPreview.name}<IconArrowRight /></>
              : <>{canEnterPreview ? `Entrar em ${preview.name}` : 'Entrar no projeto'}<IconArrowRight /></>}
        </button>
      </div>
      <button className={styles.backLink} onClick={() => navigate('/')}>
        <IconArrowLeft />
        Voltar ao início
      </button>
    </Shell>
  )
}
