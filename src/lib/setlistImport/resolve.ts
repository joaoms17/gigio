/* ═══════════════════════════════════════════════════════════════
   Resolução online das linhas que não estão no repertório:
   LRCLIB + Genius em paralelo, com fila de concorrência (máx. 3),
   cancelável, e distinção "sem resultados" ≠ "sem ligação".
═══════════════════════════════════════════════════════════════ */
import type { SearchResult } from '../../types'
import { abortError, isOffline } from './errors'
import { normalizeTitle } from './text'

export type OnlineOutcome =
  | { status: 'ok'; results: SearchResult[] }
  | { status: 'offline' }

const TIMEOUT_MS = 12000
const LRCLIB_API = 'https://lrclib.net/api'
/** Genius só para DESCOBERTA (via o proxy /api/genius; as letras vêm do lyrics.ovh) */
const GENIUS_PROXY = '/api/genius'
const cache = new Map<string, SearchResult[]>()

/**
 * GET com cancelamento e tempo máximo que abortam o PRÓPRIO pedido (não só a espera: um
 * pedido cancelado liberta mesmo o lugar na fila). Resposta HTTP não-ok (429, 5xx) = erro —
 * nunca "sem resultados".
 */
async function getJson(url: string, signal: AbortSignal | undefined, ms: number): Promise<unknown> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal?.aborted) ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

interface LrclibItem { id: number | string; trackName: string; artistName: string; duration?: number; syncedLyrics?: string | null }
interface GeniusHit { result: { id: number | string; title: string; primary_artist?: { name?: string } } }

async function lrclibSearch(query: string, signal: AbortSignal | undefined, ms: number): Promise<SearchResult[]> {
  const data = await getJson(`${LRCLIB_API}/search?q=${encodeURIComponent(query)}`, signal, ms)
  if (!Array.isArray(data)) throw new Error('Resposta inválida do LRCLIB')
  return (data as LrclibItem[]).slice(0, 12).map(item => ({
    title: item.trackName,
    artist: item.artistName,
    source: 'lrclib' as const,
    has_sync: !!item.syncedLyrics,
    duration_sec: item.duration,
    external_id: String(item.id),
  }))
}

async function geniusSearch(query: string, signal: AbortSignal | undefined, ms: number): Promise<SearchResult[]> {
  const data = await getJson(`${GENIUS_PROXY}?path=search&q=${encodeURIComponent(query)}`, signal, ms) as
    { response?: { hits?: GeniusHit[] } } | null
  return (data?.response?.hits ?? []).slice(0, 8).map(hit => ({
    title: hit.result.title,
    artist: hit.result.primary_artist?.name ?? '',
    source: 'text' as const,
    has_sync: false,
    external_id: String(hit.result.id),
  }))
}

/**
 * Pesquisa online (LRCLIB + Genius em paralelo). `offline` quando o LRCLIB falhou (rede, tempo,
 * HTTP 429/5xx) e o Genius não trouxe nada. Só uma resposta COMPLETA (as duas fontes
 * responderam) fica em cache durante a sessão — uma falha nunca fica como "sem resultados".
 */
export async function searchOnline(query: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<OnlineOutcome> {
  const key = normalizeTitle(query)
  if (!key) return { status: 'ok', results: [] }
  const hit = cache.get(key)
  if (hit) return { status: 'ok', results: hit }
  if (isOffline()) return { status: 'offline' }
  const ms = opts.timeoutMs ?? TIMEOUT_MS
  const [lrc, genius] = await Promise.allSettled([
    lrclibSearch(query, opts.signal, ms),
    geniusSearch(query, opts.signal, ms),
  ])
  if (opts.signal?.aborted) throw abortError()
  const geniusResults = genius.status === 'fulfilled' ? genius.value : []
  if (lrc.status === 'rejected' && geniusResults.length === 0) return { status: 'offline' }
  const results = [...(lrc.status === 'fulfilled' ? lrc.value : []), ...geniusResults]
  if (lrc.status === 'fulfilled' && genius.status === 'fulfilled') cache.set(key, results)
  return { status: 'ok', results }
}

export interface ResolverHandlers {
  onStart(id: string, query: string): void
  onDone(id: string, query: string, outcome: OnlineOutcome): void
}

export interface Resolver {
  /** Define/troca quem recebe os eventos (útil num hook React: liga-se num efeito) */
  setHandlers(h: ResolverHandlers | null): void
  /** Põe (ou volta a pôr) a linha na fila; cancela a pesquisa anterior da mesma linha */
  enqueue(id: string, query: string): void
  cancel(id: string): void
  cancelAll(): void
  /** Pesquisas em fila + em curso */
  readonly size: number
  /** Resolve quando a fila esvazia */
  idle(): Promise<void>
}

/** Fila de pesquisas com concorrência limitada (3 por defeito). */
export function createResolver(initial: ResolverHandlers | null = null, concurrency = 3): Resolver {
  let handlers = initial
  const queue: { id: string; query: string }[] = []
  const active = new Map<string, AbortController>()
  let waiters: (() => void)[] = []

  function settle() {
    if (queue.length === 0 && active.size === 0 && waiters.length) {
      const w = waiters
      waiters = []
      w.forEach(f => f())
    }
  }

  function pump() {
    while (active.size < concurrency && queue.length) {
      const job = queue.shift()!
      const ctrl = new AbortController()
      active.set(job.id, ctrl)
      handlers?.onStart(job.id, job.query)
      searchOnline(job.query, { signal: ctrl.signal })
        .then(
          outcome => { if (!ctrl.signal.aborted) handlers?.onDone(job.id, job.query, outcome) },
          () => { if (!ctrl.signal.aborted) handlers?.onDone(job.id, job.query, { status: 'offline' }) },
        )
        .finally(() => {
          if (active.get(job.id) === ctrl) active.delete(job.id)
          pump()
        })
    }
    settle()
  }

  function cancel(id: string) {
    const qi = queue.findIndex(j => j.id === id)
    if (qi >= 0) queue.splice(qi, 1)
    const ctrl = active.get(id)
    if (ctrl) { ctrl.abort(); active.delete(id) }
    pump()
  }

  return {
    setHandlers(h) { handlers = h },
    enqueue(id, query) {
      cancel(id)
      queue.push({ id, query })
      pump()
    },
    cancel,
    cancelAll() {
      queue.length = 0
      active.forEach(c => c.abort())
      active.clear()
      settle()
    },
    get size() { return queue.length + active.size },
    idle() {
      if (queue.length === 0 && active.size === 0) return Promise.resolve()
      return new Promise<void>(resolve => { waiters.push(resolve) })
    },
  }
}
