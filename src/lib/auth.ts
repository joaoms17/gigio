import { AUTH_STORAGE_KEY, supabase } from './supabase'
import { clearOfflineData } from './offline/store'
import { clearNavigationCache } from './concertCache'

export async function signUp(email: string, password: string, displayName: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

/**
 * Terminar sessão NESTE aparelho (scope 'local': o iPad em palco não perde a
 * sessão porque se saiu no telemóvel) e apagar tudo o que ficou guardado
 * para usar sem rede. Sem rede o supabase-js não apaga a sessão (o pedido de
 * logout falha e ele guarda-a para tentar de novo) — apaga-se aqui à mão.
 * Quem chama recarrega a app em /auth (window.location), para o cliente do
 * Supabase arrancar sem sessão em memória.
 */
export async function signOut() {
  try {
    await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ])
  } catch { /* sem rede: segue */ }
  try {
    for (const k of [AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-user`]) {
      localStorage.removeItem(k)
    }
  } catch { /* armazenamento bloqueado */ }
  clearNavigationCache()
  try { await clearOfflineData() } catch { /* */ }
}
