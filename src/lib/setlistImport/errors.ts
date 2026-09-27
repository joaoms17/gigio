/** Erros da importação com mensagem pronta a mostrar (pt-PT). */
export type ImportErrorCode = 'offline' | 'empty' | 'unreadable' | 'unsupported' | 'aborted'

export class ImportError extends Error {
  readonly code: ImportErrorCode
  constructor(code: ImportErrorCode, message: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}

export function abortError(): ImportError {
  return new ImportError('aborted', 'Cancelado.')
}

export function isAbort(e: unknown): boolean {
  return (e instanceof ImportError && e.code === 'aborted')
    || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError')
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export const OFFLINE_MESSAGE = 'Sem ligação — confirma a rede e tenta de novo.'

/** Erro de rede do fetch/Supabase ("Failed to fetch", "Load failed", "NetworkError…"). */
export function isNetworkMessage(msg: string): boolean {
  return /failed to fetch|load failed|networkerror|network request failed|network error|fetch failed|the internet connection appears to be offline|err_internet_disconnected|timeout|timed out/i.test(msg)
}

/** Mensagem técnica → português (erros de rede viram "Sem ligação"). */
export function humanizeError(msg: string): string {
  const m = msg.replace(/^(?:TypeError|Error):\s*/i, '').trim()
  if (isOffline() || isNetworkMessage(m)) return OFFLINE_MESSAGE
  return m
}

/** Mensagem legível de qualquer erro. */
export function importErrorMessage(e: unknown, fallback = 'Algo correu mal. Tenta de novo.'): string {
  if (e instanceof ImportError) return e.message
  if (e instanceof Error && e.message) return humanizeError(e.message)
  if (typeof e === 'string' && e) return humanizeError(e)
  const msg = (e as { message?: unknown } | null)?.message
  if (typeof msg === 'string' && msg) return humanizeError(msg)
  return fallback
}
