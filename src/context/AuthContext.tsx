import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthContextValue {
  user: User | null
  loading: boolean
}

export const AuthContext = createContext<AuthContextValue>({ user: null, loading: true })

function readCachedUser(): User | null {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!key) return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Supabase stores { access_token, refresh_token, user, ... } or { session: {...} }
    return parsed?.user ?? parsed?.session?.user ?? null
  } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Offline: skip network refresh and use cached session directly
    if (!navigator.onLine) {
      const cached = readCachedUser()
      setUser(cached)
      setLoading(false)
      return
    }

    const timeout = setTimeout(() => {
      console.warn('Supabase getSession timeout — trying cache')
      setUser(readCachedUser())
      setLoading(false)
    }, 4000)

    supabase.auth.getSession().then(({ data, error }) => {
      clearTimeout(timeout)
      if (error) console.error('getSession error:', error.message)
      setUser(data.session?.user ?? null)
      setLoading(false)
    }).catch((err) => {
      clearTimeout(timeout)
      console.error('getSession threw:', err)
      setUser(readCachedUser())
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>
}
