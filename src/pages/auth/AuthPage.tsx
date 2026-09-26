import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signIn, signUp } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import styles from './AuthPage.module.css'

function friendlyError(msg: string) {
  if (msg.includes('Invalid login')) return 'Email ou password incorretos'
  if (msg.includes('already registered')) return 'Este email já tem conta — faz login'
  if (msg.includes('Password should')) return 'A password precisa de pelo menos 6 caracteres'
  if (msg.includes('valid email')) return 'Introduz um email válido'
  if (msg.includes('confirm')) return 'Confirma o teu email antes de entrar'
  return msg
}

/* ── Ícones SVG inline ── */

function IconEye() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconEyeOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

function IconAlert() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo} aria-label="gigio">
          <span className={styles.gig}>gig</span><span className={styles.io}>io</span>
        </div>
        <p className={styles.tagline}>O teu companheiro de palco</p>

        {recovery ? (
          <>
            <h2 className={styles.recoveryTitle}>Definir nova password</h2>
            <p className={styles.recoveryHint}>Escolhe a nova password para a tua conta.</p>
            <form onSubmit={submitNewPassword} className={styles.form}>
              <div className={styles.passwordWrap}>
                <input
                  className={styles.input}
                  type={showNewPassword ? 'text' : 'password'}
                  name="new-password"
                  autoComplete="new-password"
                  placeholder="Nova password"
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
              {error && (
                <p className={styles.error}>
                  <span className={styles.errorIcon}><IconAlert /></span>
                  {error}
                </p>
              )}
              <button className={styles.btn} type="submit" disabled={updatingPassword}>
                {updatingPassword ? '…' : 'Guardar nova password'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className={styles.modeTabs} role="tablist" aria-label="Entrar ou criar conta">
              <button
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? styles.activeTab : styles.tab}
                onClick={() => setMode('login')}
              >
                Entrar
              </button>
              <button
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? styles.activeTab : styles.tab}
                onClick={() => setMode('register')}
              >
                Criar conta
              </button>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              {mode === 'register' && (
                <input
                  className={styles.input}
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="O teu nome"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              )}
              <input
                className={styles.input}
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <div className={styles.passwordWrap}>
                <input
                  className={styles.input}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="Password"
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
              {error && (
                error.startsWith('Conta criada') ? (
                  <p className={styles.success}>{error}</p>
                ) : (
                  <p className={styles.error}>
                    <span className={styles.errorIcon}><IconAlert /></span>
                    {error}
                  </p>
                )
              )}
              <button className={styles.btn} type="submit" disabled={loading}>
                {loading ? '…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
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
      </div>
    </div>
  )
}
