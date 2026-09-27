/* ═══════════════════════════════════════════════════════════════
   Resolução online das linhas que não estão no repertório:
   LRCLIB + Genius em paralelo, com fila de concorrência (máx. 3),
   cancelável, e distinção "sem resultados" ≠ "sem ligação".
═══════════════════════════════════════════════════════════════ */
import { searchLrclib } from '../lrclib'
import { searchGenius } from '../genius'
import type { SearchResult } from '../../types'
import { abortError, isOffline } from './errors'
import { normalizeTitle } from './text'

export type OnlineOutcome =
  | { status: 'ok'; results: SearchResult[] }
  | { status: 'offline' }

const TIMEOUT_MS = 12000
const cache = new Map<string, SearchResult[]>()

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/**
 * Pesquisa online. `offline` quando o LRCLIB falhou por rede/tempo e o Genius não
 * trouxe nada (o `searchGenius` engole erros de rede, por isso o LRCLIB é o indicador).
 * Resultados bem-sucedidos ficam em cache durante a sessão.
 */
export async function searchOnline(query: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<OnlineOutcome> {
  const key = normalizeTitle(query)
  if (!key) return { status: 'ok', results: [] }
  const hit = cache.get(key)
  if (hit) return { status: 'ok', results: hit }
  if (isOffline()) return { status: 'offline' }
  const ms = opts.timeoutMs ?? TIMEOUT_MS
  const [lrc, genius] = await Promise.allSettled([
    withTimeout(searchLrclib(query), ms),
    withTimeout(searchGenius(query), ms),
  ])
  if (opts.signal?.aborted) throw abortError()
  const geniusResults = genius.status === 'fulfilled' ? genius.value : []
  if (lrc.status === 'rejected' && geniusResults.length === 0) return { status: 'offline' }
  const results = [...(lrc.status === 'fulfilled' ? lrc.value : []), ...geniusResults]
  cache.set(key, results)
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
