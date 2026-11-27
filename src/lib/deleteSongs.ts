/* ═══════════════════════════════════════════════════════════════
   Eliminar músicas em lote, com verificação.
   - Por blocos (50 ids): centenas de ids num só `in(...)` dão um URL
     comprido demais e o pedido falha.
   - `.select('id')` devolve as linhas REALMENTE apagadas: uma recusa
     da RLS não dá erro, apaga 0 linhas — sem isto a UI tirava-as e
     elas voltavam ao recarregar.
   O cliente é injetável (testes).
═══════════════════════════════════════════════════════════════ */
import { supabase } from './supabase'

export const DELETE_CHUNK = 50

interface DeleteResult { data: { id: string }[] | null; error: { message: string } | null }
/** O bocado do cliente Supabase que usamos */
export interface SongDeleter {
  from(table: 'songs'): { delete(): { in(col: 'id', ids: string[]): { select(cols: 'id'): PromiseLike<DeleteResult> } } }
}

export interface DeleteSongsResult {
  /** Ids apagados de facto */
  deleted: string[]
  /** Ids que ficaram (erro, sem permissão, rede) */
  failed: string[]
  /** 1.ª mensagem de erro (null se só faltaram por permissão) */
  error: string | null
}

export async function deleteSongsChunked(
  ids: readonly string[],
  opts: { chunk?: number; client?: SongDeleter; onProgress?: (done: number, total: number) => void } = {},
): Promise<DeleteSongsResult> {
  const client = opts.client ?? (supabase as unknown as SongDeleter)
  const size = Math.max(1, opts.chunk ?? DELETE_CHUNK)
  const unique = [...new Set(ids)]
  const deleted: string[] = []
  const failed: string[] = []
  let error: string | null = null
  for (let i = 0; i < unique.length; i += size) {
    const part = unique.slice(i, i + size)
    try {
      const { data, error: err } = await client.from('songs').delete().in('id', part).select('id')
      if (err) {
        error ??= err.message
        failed.push(...part)
      } else {
        const gone = new Set((data ?? []).map(r => r.id))
        for (const id of part) (gone.has(id) ? deleted : failed).push(id)
      }
    } catch (e) {
      error ??= e instanceof Error ? e.message : String(e)
      failed.push(...part)
    }
    opts.onProgress?.(Math.min(i + size, unique.length), unique.length)
  }
  return { deleted, failed, error }
}

/** "3 músicas não foram eliminadas — sem permissão (são de outro membro do projeto?)." */
export function deleteFailureMessage(res: DeleteSongsResult): string | null {
  if (res.failed.length === 0) return null
  const n = res.failed.length
  const head = res.deleted.length
    ? `${res.deleted.length} eliminada${res.deleted.length === 1 ? '' : 's'}, mas ${n} ${n === 1 ? 'não foi' : 'não foram'}`
    : `${n === 1 ? 'A música não foi eliminada' : `${n} músicas não foram eliminadas`}`
  const why = res.error
    ? (/failed to fetch|load failed|network/i.test(res.error) ? 'sem ligação' : res.error)
    : 'sem permissão (podem ser de outro membro do projeto)'
  return `${head} — ${why}. Tenta de novo.`
}
