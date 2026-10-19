import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, supabase } from '../lib/supabase'
import { thawOffline } from '../lib/offline/store'
import { adoptLegacyAnnotations } from '../lib/annotations/storage'

interface AuthContextValue {
  user: User | null
  loading: boolean
}

export const AuthContext = createContext<AuthContextValue>({ user: null, loading: true })

/**
 * Utilizador da sessão guardada pelo supabase-js neste aparelho (mesmo com o
 * access token expirado). Sem refresh token a sessão não se pode renovar e
 * não conta — sem sessão nenhuma guardada, pede-se login.
 */
function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const s = parsed?.session ?? parsed
    const u = s?.user ?? null
    return u && typeof u.id === 'string' && typeof s?.refresh_token === 'string' && s.refresh_token ? u as User : null
  } catch { return null }
}

/** As anotações antigas deste aparelho (só por música) passam para o 1.º utilizador com sessão */
function withAdoption(u: User | null): User | null {
  if (u) adoptLegacyAnnotations(u.id)
  return u
}

/** Mesmo utilizador e mesmos dados visíveis: mantém o objeto (as páginas que dependem de `user` não recarregam a cada renovação do token) */
function sameUser(a: User | null, b: User | null): boolean {
  if (!a || !b) return a === b
  return a.id === b.id && a.email === b.email
    && JSON.stringify(a.user_metadata ?? null) === JSON.stringify(b.user_metadata ?? null)
}

/**
 * Sessão sem rede: com uma sessão guardada entra-se logo (sem "A carregar…")
 * e o utilizador NUNCA passa a null por falta de rede — o supabase-js, sem
 * conseguir renovar o token, emite INITIAL_SESSION sem sessão mas mantém-na
 * guardada, e renova-a quando a rede volta. Só SIGNED_OUT (sessão terminada
 * ou recusada pelo servidor) ou não haver sessão guardada tiram o utilizador.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => withAdoption(readCachedUser()))
  const [loading, setLoading] = useState(() => !readCachedUser())

  useEffect(() => {
    let alive = true
    const settle = (next: User | null) => {
      if (!alive) return
      withAdoption(next)
      setUser(prev => (sameUser(prev, next) ? prev : next))
      setLoading(false)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        if (event === 'SIGNED_IN') thawOffline()
        settle(session.user)
      } else if (event === 'SIGNED_OUT') {
        settle(null)
      } else {
        // INITIAL_SESSION sem sessão: ou não há nenhuma guardada (login), ou
        // não se conseguiu renovar sem rede (fica a guardada)
        settle(readCachedUser())
      }
    })

    // Rede de segurança: o supabase-js não respondeu (ex.: lock preso)
    const timeout = setTimeout(() => {
      if (!alive) return
      setUser(prev => prev ?? readCachedUser())
      setLoading(false)
    }, 6000)

    return () => {
      alive = false
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>
}
