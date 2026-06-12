import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
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

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const inviteCode = searchParams.get('code')
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [invite, setInvite] = useState<InviteData | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [done, setDone] = useState(false)
  const [codeInput, setCodeInput] = useState(inviteCode ?? '')
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
      if (insertErr) { alert('Erro ao entrar no projeto: ' + insertErr.message); setAccepting(false); return }
    }

    await supabase.from('project_invites').update({ status: 'accepted' }).eq('id', invite.id)

    setDone(true)
    setTimeout(() => navigate(`/projects/${invite.project_id}`), 1800)
  }

  async function joinByCode() {
    if (!user || !codeInput.trim()) return
    setJoiningByCode(true)
    setCodeError(null)

    const { data: band, error } = await supabase
      .from('bands')
      .select('id, name, type, color, invite_code, invite_expires_at')
      .eq('invite_code', codeInput.trim().toUpperCase())
      .single()

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

    // Confirm before joining — entering a code shouldn't auto-commit
    if (!window.confirm(`Entrar no projeto "${band.name}" como editor?`)) {
      setJoiningByCode(false)
      return
    }

    const { error: joinErr } = await supabase
      .from('band_members')
      .insert({ band_id: band.id, user_id: user.id, role: 'editor' })

    if (joinErr) { setCodeError('Erro ao entrar: ' + joinErr.message); setJoiningByCode(false); return }

    navigate(`/projects/${band.id}`)
  }

  if (authLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.loading}>A carregar...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.logo}>gigio</div>
          <h1 className={styles.title}>Tens um convite!</h1>
          <p className={styles.sub}>Faz login ou cria uma conta para aceitar o convite e entrar no projeto.</p>
          <button
            className={styles.btn}
            onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
          >
            Entrar / Criar conta
          </button>
        </div>
      </div>
    )
  }

  // Token-based invite flow
  if (token) {
    if (inviteError) {
      return (
        <div className={styles.page}>
          <div className={styles.card}>
            <div className={styles.errorIcon}>✕</div>
            <h1 className={styles.title}>Convite inválido</h1>
            <p className={styles.sub}>{inviteError}</p>
            <button className={styles.btn} onClick={() => navigate('/')}>Ir para o início</button>
          </div>
        </div>
      )
    }

    if (!invite) {
      return (
        <div className={styles.page}>
          <div className={styles.card}><div className={styles.loading}>A verificar convite...</div></div>
        </div>
      )
    }

    if (done) {
      return (
        <div className={styles.page}>
          <div className={styles.card}>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.title}>Bem-vindo ao projeto!</h1>
            <p className={styles.sub}>A redirecionar para {invite.bands.name}...</p>
          </div>
        </div>
      )
    }

    const projectColor = invite.bands.color ?? '#7C3AED'

    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.projectBanner} style={{ background: projectColor }}>
            <div className={styles.bannerName}>{invite.bands.name}</div>
            <div className={styles.bannerType}>{PROJECT_TYPE_LABELS[invite.bands.type as ProjectType] ?? invite.bands.type}</div>
          </div>
          <div className={styles.inviteBody}>
            <p className={styles.inviteMsg}>
              Foste convidado para entrar neste projeto como <strong>{ROLE_LABELS[invite.role]}</strong>.
            </p>
            {invite.bands.description && (
              <p className={styles.projectDesc}>{invite.bands.description}</p>
            )}
            <div className={styles.inviteMeta}>
              <span className={styles.expiryNote}>
                Expira em {new Date(invite.expires_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}
              </span>
            </div>
            <button
              className={styles.acceptBtn}
              style={{ background: projectColor }}
              onClick={acceptInvite}
              disabled={accepting}
            >
              {accepting ? 'A entrar...' : `Entrar em ${invite.bands.name}`}
            </button>
            <button className={styles.declineBtn} onClick={() => navigate('/')}>
              Recusar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Code-based join
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>gigio</div>
        <h1 className={styles.title}>Entrar num projeto</h1>
        <p className={styles.sub}>Introduz o código de convite que recebeste.</p>
        <div className={styles.codeForm}>
          <input
            className={styles.codeInput}
            value={codeInput}
            onChange={e => setCodeInput(e.target.value.toUpperCase())}
            placeholder="XXXX-0000"
            maxLength={9}
            onKeyDown={e => e.key === 'Enter' && joinByCode()}
          />
          {codeError && <p className={styles.codeError}>{codeError}</p>}
          <button
            className={styles.btn}
            onClick={joinByCode}
            disabled={joiningByCode || !codeInput.trim()}
          >
            {joiningByCode ? 'A verificar...' : 'Entrar no projeto'}
          </button>
        </div>
        <button className={styles.backLink} onClick={() => navigate('/')}>← Voltar ao início</button>
      </div>
    </div>
  )
}
