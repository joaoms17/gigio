/* ═══════════════════════════════════════════════════════════════
   Gravação ORDENADA: cria as músicas novas (com letra/sync quando
   escolhidas; vazias caso contrário) e devolve os song_id pela
   ordem da lista. Falhas individuais não param o resto.
═══════════════════════════════════════════════════════════════ */
import { supabase } from '../supabase'
import { createEmptySong, createSongFromResult, type SongOwner } from '../songs'
import { humanizeError, importErrorMessage } from './errors'
import { setlistFieldsFor } from './rows'
import type { CommitProgress, CommittedItem, ImportCommitResult, ImportRow, SetlistSongExtra } from './types'

/**
 * Cria as músicas que faltam (concorrência 3) e devolve um item por linha, NA ORDEM
 * da lista. Linhas com `songId` (já criadas numa tentativa anterior) não são recriadas.
 */
export async function commitRows(
  rows: readonly ImportRow[],
  owner: Pick<SongOwner, 'ownerId' | 'projectId'>,
  opts: { concurrency?: number; onProgress?: (p: CommitProgress) => void } = {},
): Promise<CommittedItem[]> {
  const total = rows.length
  const items: CommittedItem[] = new Array(total)
  let done = 0
  const tick = (current: string) => opts.onProgress?.({ phase: 'saving', done, total, current })

  async function one(row: ImportRow): Promise<CommittedItem> {
    const setlist = setlistFieldsFor(row)
    const base = { rowId: row.id, title: row.title, setlist }
    const c = row.choice
    if (c?.kind === 'library') return { ...base, songId: c.song.id, created: false, hasLyrics: true }
    if (row.songId) return { ...base, songId: row.songId, created: false, hasLyrics: c?.kind === 'online' }
    const songOwner: SongOwner = { ...owner, performanceKey: row.extra?.performance_key ?? row.key ?? null }
    try {
      if (c?.kind === 'online') {
        const song = await createSongFromResult(c.result, songOwner)
        return { ...base, title: song.title, songId: song.id, created: true, hasLyrics: !!song.lyrics?.trim() }
      }
      const song = await createEmptySong(row.title, row.artist, songOwner, { durationSec: row.durationSec })
      return { ...base, songId: song.id, created: true, hasLyrics: false }
    } catch (e) {
      return { ...base, songId: null, created: false, hasLyrics: false, error: importErrorMessage(e, 'Não foi possível criar a música.') }
    }
  }

  // Músicas do repertório não precisam de nada — contam logo como feitas
  const pending: number[] = []
  rows.forEach((row, i) => {
    if (row.choice?.kind === 'library') {
      items[i] = { rowId: row.id, title: row.title, songId: row.choice.song.id, created: false, hasLyrics: true, setlist: setlistFieldsFor(row) }
      done++
    } else {
      pending.push(i)
    }
  })
  tick(rows[pending[0]]?.title ?? '')

  let next = 0
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 3, pending.length) }, async () => {
    while (next < pending.length) {
      const i = pending[next++]
      tick(rows[i].title)
      items[i] = await one(rows[i])
      done++
      tick(rows[i].title)
    }
  })
  await Promise.all(workers)
  return items
}

/** Resumo do resultado (contagens + ids pela ordem). */
export function summarizeCommit(items: CommittedItem[]): ImportCommitResult {
  const ok = items.filter(i => i.songId)
  return {
    items,
    songIds: ok.map(i => i.songId as string),
    created: items.filter(i => i.created).length,
    reused: ok.filter(i => !i.created).length,
    failed: items.length - ok.length,
    withoutLyrics: items.filter(i => i.created && !i.hasLyrics).length,
  }
}

export interface SetlistSongInsert extends SetlistSongExtra {
  song_id: string
}

/** Linhas de `setlist_songs` prontas a inserir (só as gravadas com sucesso, pela ordem). */
export function toSetlistInserts(result: ImportCommitResult | CommittedItem[]): SetlistSongInsert[] {
  const items = Array.isArray(result) ? result : result.items
  return items.filter(i => i.songId).map(i => {
    const row: SetlistSongInsert = { song_id: i.songId as string }
    for (const k of ['performance_key', 'notes', 'custom_intro', 'custom_ending'] as const) {
      const v = i.setlist[k]
      if (v != null && v !== '') row[k] = v
    }
    return row
  })
}

async function nextPosition(setlistId: string): Promise<number> {
  const { data } = await supabase.from('setlist_songs')
    .select('position').eq('setlist_id', setlistId)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  return (data?.position ?? -1) + 1
}

/**
 * Insere as músicas no concerto, pela ordem dada, num só insert em lote.
 * - `startPosition` (ex.: 0 num concerto novo) — posições startPosition…startPosition+N-1;
 * - sem `startPosition`: acrescenta ao fim (max(position)+1, nunca antes de `minPosition`)
 *   e repete uma vez se colidir com a restrição única (setlist_id, position).
 */
export async function insertSetlistSongs(
  setlistId: string,
  rows: readonly SetlistSongInsert[],
  opts: { startPosition?: number; minPosition?: number } = {},
): Promise<{ inserted: number; error: string | null }> {
  if (rows.length === 0) return { inserted: 0, error: null }
  const attempt = async () => {
    const base = opts.startPosition ?? Math.max(opts.minPosition ?? 0, await nextPosition(setlistId))
    return supabase.from('setlist_songs').insert(rows.map((r, i) => ({ ...r, setlist_id: setlistId, position: base + i })))
  }
  let { error } = await attempt()
  if (error && error.code === '23505' && opts.startPosition === undefined) ({ error } = await attempt())
  if (error) return { inserted: 0, error: humanizeError(error.message) }
  return { inserted: rows.length, error: null }
}

type ExistingSetlistSong = SetlistSongExtra & { song_id: string; position: number; [k: string]: unknown }

/**
 * Substitui o alinhamento do concerto pela lista dada (posições 0…N-1). As músicas que já lá
 * estavam mantêm o tom/notas do concerto (a não ser que a lista traga outros). Se a inserção
 * falhar, o alinhamento anterior é reposto.
 */
export async function replaceSetlistSongs(
  setlistId: string,
  rows: readonly SetlistSongInsert[],
): Promise<{ inserted: number; error: string | null }> {
  const { data, error: readErr } = await supabase.from('setlist_songs').select('*').eq('setlist_id', setlistId)
  if (readErr) return { inserted: 0, error: humanizeError(readErr.message) }
  const old = (data ?? []) as ExistingSetlistSong[]
  const byId = new Map(old.map(o => [o.song_id, o]))
  const merged = rows.map(r => {
    const prev = byId.get(r.song_id)
    if (!prev) return r
    const out: SetlistSongInsert = { ...r }
    for (const k of ['performance_key', 'notes', 'custom_intro', 'custom_ending'] as const) {
      const v = prev[k]
      if ((out[k] == null || out[k] === '') && v != null && v !== '') out[k] = v
    }
    return out
  })
  const { error: delErr } = await supabase.from('setlist_songs').delete().eq('setlist_id', setlistId)
  if (delErr) return { inserted: 0, error: humanizeError(delErr.message) }
  const res = await insertSetlistSongs(setlistId, merged, { startPosition: 0 })
  if (res.error && old.length) {
    // Repõe o que lá estava (melhor um alinhamento antigo do que um concerto vazio)
    await supabase.from('setlist_songs').insert(old)
  }
  return res
}
