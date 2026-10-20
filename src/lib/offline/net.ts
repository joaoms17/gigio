/**
 * Há rede? navigator.onLine só diz se há Wi-Fi/dados — num Wi-Fi de sala sem
 * internet continua true. Por isso o "offline" da app junta as duas coisas:
 * o browser diz que não há rede, OU um pedido falhou por falta de rede há
 * menos de FAIL_WINDOW_MS (e nenhum correu bem desde então).
 *
 * Com uma sonda (setNetProbe — um pedido simples ao Supabase, sem sessão)
 * o modo offline dura até a sonda conseguir resposta (de 30 em 30 s) ou o
 * browser dizer 'online'; sem sonda, dura FAIL_WINDOW_MS.
 *
 * Os pedidos feitos com runQuery() não esperam pelas retentativas do
 * postgrest (1 s + 2 s + 4 s) nem pela renovação da sessão sem rede (o
 * supabase-js tenta ~25 s antes de cada pedido com o token expirado): têm um
 * limite de tempo próprio e, em modo offline, nem chegam a ir à rede.
 */

const FAIL_WINDOW_MS = 30_000

let lastFailAt = 0
let failTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
let probe: (() => Promise<boolean>) | null = null

/** Sonda "há internet?" (true = o servidor respondeu, seja o que for) */
export function setNetProbe(fn: (() => Promise<boolean>) | null) {
  probe = fn
}

function notify() {
  listeners.forEach(fn => { try { fn() } catch { /* um ouvinte não pára os outros */ } })
}

function browserOnline(): boolean {
  try { return typeof navigator === 'undefined' || navigator.onLine !== false } catch { return true }
}

/** Sem rede (ou ela falhou há pouco): não vale a pena ir à rede */
export function isLikelyOffline(): boolean {
  if (!browserOnline()) return true
  if (!lastFailAt) return false
  return probe ? true : Date.now() - lastFailAt < FAIL_WINDOW_MS
}

/** 1.ª sonda ao fim disto (uma rede lenta que esgotou um pedido volta depressa); depois FAIL_WINDOW_MS */
const FIRST_PROBE_MS = 10_000

function armRetry(first = false) {
  if (failTimer) clearTimeout(failTimer)
  failTimer = setTimeout(async () => {
    failTimer = null
    // Sem sonda: passada a janela volta a tentar-se a rede (avisa quem mostra o estado)
    if (!probe) {
      if (isLikelyOffline()) armRetry()
      notify()
      return
    }
    // Modo avião: nem vale a pena perguntar (o evento 'online' trata do regresso)
    if (!browserOnline()) { armRetry(); return }
    const check = probe
    const reachable = await Promise.resolve().then(() => check()).catch(() => false)
    if (!lastFailAt) return
    if (reachable) markNetOk()
    else armRetry()
  }, probe ? (first ? FIRST_PROBE_MS : FAIL_WINDOW_MS) : FAIL_WINDOW_MS + 50)
}

export function markNetFailure() {
  const was = isLikelyOffline()
  lastFailAt = Date.now()
  // Já offline: a sonda que está marcada chega (não se adia a cada falha)
  if (!was || !failTimer) armRetry(!was)
  if (!was) notify()
}

export function markNetOk() {
  if (!lastFailAt) return
  const was = isLikelyOffline()
  lastFailAt = 0
  if (failTimer) { clearTimeout(failTimer); failTimer = null }
  if (was !== isLikelyOffline()) notify()
}

export function subscribeNet(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { lastFailAt = 0; notify() })
  window.addEventListener('offline', notify)
}

/** Resultado de um pedido do postgrest (o que interessa aqui) */
export interface QueryResult<T> {
  data: T | null
  error: { message?: string; code?: string } | null
  status: number
  /** Falhou por falta de rede / tempo esgotado / modo offline (não por erro do servidor) */
  network: boolean
}

type Builder<T> = PromiseLike<{ data: T | null; error: unknown; status: number }> & {
  retry?: (enabled: boolean) => unknown
}

// Chrome "Failed to fetch", Firefox "NetworkError…", Safari "Load failed"
const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed|fetcherror/i

/** Erro de rede (sem resposta do servidor), não um erro da base de dados */
export function isNetworkError(error: unknown, status?: number): boolean {
  if (status === 0) return true
  const msg = (error as { message?: unknown } | null)?.message
  return typeof msg === 'string' && NETWORK_RE.test(msg)
}

/**
 * Corre um pedido do supabase-js sem retentativas, com limite de tempo, e
 * atualiza o estado da rede. Em modo offline (ver isLikelyOffline) devolve
 * logo uma falha de rede, a menos que `force` (ex.: "Guardar para offline").
 */
export async function runQuery<T>(q: Builder<T>, timeoutMs = 8000, force = false): Promise<QueryResult<T>> {
  if (!force && isLikelyOffline()) return { data: null, error: { message: 'offline' }, status: 0, network: true }
  try { q.retry?.(false) } catch { /* versão sem retry() */ }
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs) })
  try {
    const r = await Promise.race([Promise.resolve(q), timeout])
    if (r === 'timeout') {
      markNetFailure()
      return { data: null, error: { message: 'timeout' }, status: 0, network: true }
    }
    const network = !!r.error && isNetworkError(r.error, r.status)
    if (network) markNetFailure()
    else markNetOk()
    return { data: r.data, error: (r.error as QueryResult<T>['error']) ?? null, status: r.status, network }
  } catch (e) {
    // Sem throwOnError o postgrest não lança: só um fetch partido chega aqui
    markNetFailure()
    return { data: null, error: { message: String((e as Error)?.message ?? e) }, status: 0, network: true }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
