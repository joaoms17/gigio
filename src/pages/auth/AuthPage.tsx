import { useState } from 'react'
import { signIn, signUp } from '../../lib/auth'
import styles from './AuthPage.module.css'

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) throw error
      } else {
        const { error } = await signUp(email, password, name)
        if (error) throw error
      }
    } catch (err: any) {
      setError(err.message ?? 'Erro desconhecido')
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
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.btn} type="submit" disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  )
}
