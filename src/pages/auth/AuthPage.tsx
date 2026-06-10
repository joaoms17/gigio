import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signIn, signUp } from '../../lib/auth'
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
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
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
      setError(friendlyError(err.message ?? 'Erro desconhecido'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.gig}>gig</span><span className={styles.io}>io</span>
        </div>
        <p className={styles.tagline}>O teu companheiro de palco</p>

        <div className={styles.modeTabs}>
          <button className={mode === 'login' ? styles.activeTab : styles.tab} onClick={() => setMode('login')}>Entrar</button>
          <button className={mode === 'register' ? styles.activeTab : styles.tab} onClick={() => setMode('register')}>Criar conta</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {mode === 'register' && (
            <input
              className={styles.input}
              type="text"
              placeholder="O teu nome"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          )}
          <input
            className={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && (
            <p className={error.startsWith('Conta criada') ? styles.success : styles.error}>
              {error}
            </p>
          )}
          <button className={styles.btn} type="submit" disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  )
}
