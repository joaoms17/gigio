import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signIn, signUp } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import styles from './AuthPage.module.css'

/* Benefícios — impressos como uma setlist (01/02/03) */
const BENEFITS = [
  'Setlists partilhadas com a banda, sempre atualizadas',
  'Letras, tons e anotações de cada música à mão',
  'Modo palco legível no escuro — mesmo sem internet',
]

const pad2 = (n: number) => String(n).padStart(2, '0')

function friendlyError(msg: string) {
  if (msg.includes('Invalid login')) return 'Email ou password incorretos'
  if (msg.includes('already registered')) return 'Este email já tem conta — faz login'
  if (msg.includes('Password should')) return 'A password precisa de pelo menos 6 caracteres'
  if (msg.includes('valid email')) return 'Introduz um email válido'
  if (msg.includes('confirm')) return 'Confirma o teu email antes de entrar'
  return msg
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

function IconEye() {
  return (
    <svg {...ICON} width="20" height="20">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <rect x="9.5" y="9.5" width="5" height="5" />
    </svg>
  )
}

function IconEyeOff() {
  return (
    <svg {...ICON} width="20" height="20">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M3 3l18 18" />
    </svg>
  )
}

function IconAlert() {
  return (
    <svg {...ICON} width="16" height="16">
      <path d="M12 3 2 21h20Z" />
      <path d="M12 10v4M12 17.5v.5" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg {...ICON} width="16" height="16" strokeWidth={2.2}>
      <path d="M20 6 9 17l-5-5" />
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

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  // Recuperação de password (link do email → evento PASSWORD_RECOVERY)
  const [recovery, setRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [updatingPassword, setUpdatingPassword] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/'

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!navigator.onLine) {
      setError('Sem internet — não é possível entrar offline')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error, data } = await signIn(email, password)
        if (error) throw error
        if (data.session) navigate(redirectTo, { replace: true })
      } else {
        const { error, data } = await signUp(email, password, name)
        if (error) throw error
        // se confirmação desativada, session já existe
        if (data.session) {
          navigate(redirectTo, { replace: true })
        } else {
          setError('Conta criada! Confirma o teu email para entrar.')
        }
      }
    } catch (err: any) {
      const msg = err.message ?? ''
      if (msg.includes('fetch') || msg.includes('network') || !navigator.onLine) {
        setError('Sem internet — não é possível entrar offline')
      } else {
        setError(friendlyError(msg || 'Erro desconhecido'))
      }
    } finally {
      setLoading(false)
    }
  }

  async function forgotPassword() {
    if (sendingReset) return
    if (!email.trim()) {
      setError('Escreve o teu email em cima para recuperares a password')
      return
    }
    setError('')
    setSendingReset(true)
    // Sem redirectTo o link do email aterra na raiz do site, onde não há
    // listener de PASSWORD_RECOVERY nem formulário de nova password
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth`,
    })
    setSendingReset(false)
    if (error) { setError(friendlyError(error.message)); return }
    toast('Email de recuperação enviado. Vê a tua caixa de entrada.', { type: 'success' })
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword.length < 6) {
      setError('A password precisa de pelo menos 6 caracteres')
      return
    }
    setUpdatingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setUpdatingPassword(false)
    if (error) { setError(friendlyError(error.message)); return }
    toast('Password atualizada com sucesso!', { type: 'success' })
    navigate('/', { replace: true })
  }

  const errorBox = (msg: string) => (
    <p className={styles.error} role="alert">
      <span className={styles.msgIcon}><IconAlert /></span>
      <span>{msg}</span>
    </p>
  )

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        {/* ── Bloco de marca (cartaz) ── */}
        <header className={styles.brand}>
          {/* Wordmark v2 (§4.5): "gigio" condensado 800 + quadrado laranja no fim — igual à topbar */}
          <h1 className={styles.brandTitle}>
            <span className={styles.wordmark} role="img" aria-label="gigio">
              <span aria-hidden="true">gigio</span>
              <span className={styles.wordmarkDot} aria-hidden="true" />
            </span>
          </h1>
          <p className={styles.brandLine}>Setlists · Letras · Palco</p>
        </header>

        {/* Setlist de benefícios (só ≥768) — irmã do cabeçalho para a grelha
            a poder pôr por baixo da marca (paisagem) ou ao lado do painel (retrato) */}
        <ol className={styles.benefits} aria-label="O que o gigio faz">
          {BENEFITS.map((b, i) => (
            <li key={i} className={styles.benefit}>
              <span className={styles.num} aria-hidden="true">{pad2(i + 1)}</span>
              <span className={styles.benefitText}>{b}</span>
            </li>
          ))}
        </ol>

        {/* ── Formulário ── */}
        <main className={styles.panel}>
          {recovery ? (
            <>
              <div className={styles.panelLabel}>Recuperação de acesso</div>
              <h2 className={styles.panelTitle}>Definir nova password</h2>
              <p className={styles.panelHint}>Escolhe a nova password para a tua conta.</p>
              <form onSubmit={submitNewPassword} className={styles.form}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="auth-new-password">Nova password</label>
                  <div className={styles.passwordWrap}>
                    <input
                      id="auth-new-password"
                      className={styles.input}
                      type={showNewPassword ? 'text' : 'password'}
                      name="new-password"
                      autoComplete="new-password"
                      placeholder="Mínimo 6 caracteres"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      required
                      minLength={6}
                      autoFocus
                    />
                    <button
                      type="button"
                      className={styles.eyeBtn}
                      aria-label={showNewPassword ? 'Ocultar password' : 'Mostrar password'}
                      onClick={() => setShowNewPassword(v => !v)}
                    >
                      {showNewPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
                {error && errorBox(error)}
                <button className={styles.btn} type="submit" disabled={updatingPassword}>
                  {updatingPassword ? 'A guardar…' : 'Guardar nova password'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className={styles.modeTabs} role="tablist" aria-label="Entrar ou criar conta">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
                  onClick={() => setMode('login')}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
                  onClick={() => setMode('register')}
                >
                  Criar conta
                </button>
              </div>

              <form onSubmit={handleSubmit} className={styles.form}>
                {mode === 'register' && (
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="auth-name">Nome</label>
                    <input
                      id="auth-name"
                      className={styles.input}
                      type="text"
                      name="name"
                      autoComplete="name"
                      placeholder="O teu nome"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                    />
                  </div>
                )}
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="auth-email">Email</label>
                  <input
                    id="auth-email"
                    className={styles.input}
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="nome@exemplo.pt"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="auth-password">Password</label>
                  <div className={styles.passwordWrap}>
                    <input
                      id="auth-password"
                      className={styles.input}
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      placeholder={mode === 'login' ? 'A tua password' : 'Mínimo 6 caracteres'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      className={styles.eyeBtn}
                      aria-label={showPassword ? 'Ocultar password' : 'Mostrar password'}
                      onClick={() => setShowPassword(v => !v)}
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
                {error && (
                  error.startsWith('Conta criada') ? (
                    <p className={styles.success} role="status">
                      <span className={styles.msgIcon}><IconCheck /></span>
                      <span>{error}</span>
                    </p>
                  ) : errorBox(error)
                )}
                <button className={styles.btn} type="submit" disabled={loading}>
                  {loading
                    ? (mode === 'login' ? 'A entrar…' : 'A criar conta…')
                    : <>{mode === 'login' ? 'Entrar' : 'Criar conta'}<IconArrowRight /></>}
                </button>
                {mode === 'login' && (
                  <button
                    type="button"
                    className={styles.forgotLink}
                    onClick={forgotPassword}
                    disabled={sendingReset}
                  >
                    {sendingReset ? 'A enviar…' : 'Esqueci-me da password'}
                  </button>
                )}
              </form>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
