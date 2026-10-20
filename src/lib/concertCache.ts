// Cache do caminho de navegação (Projetos → projeto) em localStorage, gravada
// quando se carrega com rede e lida sem ela. Os concertos (músicas, letras,
// sincronizações, anotações, tema) vivem no IndexedDB: src/lib/offline/.

const PROJECTS_KEY  = (userId: string)                    => `gigio_projects_v1_${userId}`
const DASHBOARD_KEY = (userId: string, projectId: string) => `gigio_dashboard_v2_${userId}_${projectId}`

function write(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* cheio / bloqueado */ }
}
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function cacheProjects(userId: string, data: unknown) { write(PROJECTS_KEY(userId), data) }
export function getCachedProjects<T>(userId: string): T | null { return read<T>(PROJECTS_KEY(userId)) }

export function cacheProjectDashboard(userId: string, projectId: string, data: unknown) {
  write(DASHBOARD_KEY(userId, projectId), data)
}
export function getCachedProjectDashboard<T>(userId: string, projectId: string): T | null {
  return read<T>(DASHBOARD_KEY(userId, projectId))
}

/**
 * Terminar sessão: apaga a cache de navegação, a cache antiga dos concertos
 * (antes do IndexedDB) e as marcas do modo concerto deste aparelho
 */
export function clearNavigationCache() {
  try {
    const dead: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && /^(gigio_(projects_v1_|dashboard_v\d_|concert_|setlist_meta_v1_)|gigio-offline-prefetch-|gigio-concert-pos-)/.test(k)) dead.push(k)
    }
    dead.forEach(k => localStorage.removeItem(k))
  } catch { /* */ }
}
