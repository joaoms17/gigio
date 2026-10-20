import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/** Onde o supabase-js guarda a sessão (localStorage): sb-<ref>-auth-token — a mesma regra que ele usa */
export const AUTH_STORAGE_KEY = (() => {
  try { return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` } catch { return 'sb-auth-token' }
})()
