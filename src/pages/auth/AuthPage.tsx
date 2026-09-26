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
        <div className={styles.logo}>
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
                  {showNewPassword ? '🙈' : '👁'}
                </button>
              </div>
              {error && (
                <p className={styles.error}>
                  <span className={styles.errorIcon} aria-hidden="true">⚠</span>
                  {error}
                </p>
              )}
              <button className={styles.btn} type="submit" disabled={updatingPassword}>
                {updatingPassword ? '...' : 'Guardar nova password'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className={styles.modeTabs}>
              <button className={mode === 'login' ? styles.activeTab : styles.tab} onClick={() => setMode('login')}>Entrar</button>
              <button className={mode === 'register' ? styles.activeTab : styles.tab} onClick={() => setMode('register')}>Criar conta</button>
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
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
              {error && (
                error.startsWith('Conta criada') ? (
                  <p className={styles.success}>{error}</p>
                ) : (
                  <p className={styles.error}>
                    <span className={styles.errorIcon} aria-hidden="true">⚠</span>
                    {error}
                  </p>
                )
              )}
              <button className={styles.btn} type="submit" disabled={loading}>
                {loading ? '...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
              {mode === 'login' && (
                <button
                  type="button"
                  className={styles.forgotLink}
                  onClick={forgotPassword}
                  disabled={sendingReset}
                >
                  {sendingReset ? 'A enviar...' : 'Esqueci-me da password'}
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  )
}
