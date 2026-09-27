/* ═══════════════════════════════════════════════════════════════
   Gravação ORDENADA: cria as músicas novas (com letra/sync quando
   escolhidas; vazias caso contrário) e devolve os song_id pela
   ordem da lista. Falhas individuais não param o resto.
═══════════════════════════════════════════════════════════════ */
import { supabase } from '../supabase'
import { createEmptySong, createSongFromResult, type SongOwner } from '../songs'
import { humanizeError, importErrorMessage } from './errors'
import { newSongKey, reusableSongId, setlistFieldsFor } from './rows'
import type { CommitProgress, CommittedItem, ImportCommitResult, ImportRow, SetlistSongExtra } from './types'

/**
 * Cria as músicas que faltam (concorrência 3) e devolve um item por linha, NA ORDEM
 * da lista. Linhas com `songId` (já criadas numa tentativa anterior, no mesmo projeto) não
 * são recriadas; linhas que pedem a mesma música nova partilham uma só criação.
 */
export async function commitRows(
  rows: readonly ImportRow[],
  owner: Pick<SongOwner, 'ownerId' | 'projectId'>,
  opts: { concurrency?: number; onProgress?: (p: CommitProgress) => void } = {},
): Promise<CommittedItem[]> {
  const total = rows.length
  const items: CommittedItem[] = new Array(total)
  const projectId = owner.projectId ?? null
  let done = 0
  const tick = (current: string) => opts.onProgress?.({ phase: 'saving', done, total, current })

  type Outcome = Pick<CommittedItem, 'songId' | 'created' | 'hasLyrics' | 'error'> & { title?: string }

  /** Uma música nova para um grupo de linhas iguais (reutiliza a de uma tentativa anterior, se houver) */
  async function one(group: readonly ImportRow[]): Promise<Outcome> {
    const row = group[0]
    const c = row.choice
    const previous = group.map(r => reusableSongId(r, projectId)).find(Boolean)
    if (previous) return { songId: previous, created: false, hasLyrics: c?.kind === 'online' }
    const songOwner: SongOwner = { ...owner, performanceKey: row.extra?.performance_key ?? row.key ?? null }
    try {
      if (c?.kind === 'online') {
        const song = await createSongFromResult(c.result, songOwner)
        return { title: song.title, songId: song.id, created: true, hasLyrics: !!song.lyrics?.trim() }
      }
      const song = await createEmptySong(row.title, row.artist, songOwner, { durationSec: row.durationSec })
      return { songId: song.id, created: true, hasLyrics: false }
    } catch (e) {
      return { songId: null, created: false, hasLyrics: false, error: importErrorMessage(e, 'Não foi possível criar a música.') }
    }
  }

  // Músicas do repertório não precisam de nada — contam logo como feitas; as novas agrupam-se
  const groups = new Map<string, number[]>()
  rows.forEach((row, i) => {
    if (row.choice?.kind === 'library') {
      items[i] = { rowId: row.id, title: row.title, songId: row.choice.song.id, created: false, hasLyrics: true, setlist: setlistFieldsFor(row) }
      done++
      return
    }
    const key = newSongKey(row) ?? `row:${row.id}`
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  })
  const jobs = [...groups.values()]
  tick(jobs[0] ? rows[jobs[0][0]].title : '')

  let next = 0
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 3, jobs.length) }, async () => {
    while (next < jobs.length) {
      const idx = jobs[next++]
      const first = rows[idx[0]]
      tick(first.title)
      const res = await one(idx.map(i => rows[i]))
      idx.forEach((i, k) => {
        const row = rows[i]
        const own = reusableSongId(row, projectId)
        items[i] = {
          rowId: row.id,
          title: res.title ?? row.title,
          setlist: setlistFieldsFor(row),
          // Uma linha que já tinha a sua música fica com ela; as outras partilham a do grupo
          songId: own ?? res.songId,
          // A música conta como criada uma vez (na 1.ª linha do grupo)
          created: res.created && k === 0,
          hasLyrics: res.hasLyrics,
          ...(res.error && !own ? { error: res.error } : {}),
        }
      })
      done += idx.length
      tick(first.title)
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

type ExistingSetlistSong = SetlistSongExtra & { id: string; song_id: string; position: number; [k: string]: unknown }

/** Posições temporárias da substituição (como o reordenar do concerto: fora de 0…N-1) */
const TEMP_POSITION = 10000

/** "Sem ligação — …" + "O alinhamento ficou como estava." (uma frase por ideia) */
const withNote = (msg: string, note: string) => `${humanizeError(msg).replace(/[\s.]+$/, '')}. ${note}`
const UNCHANGED = 'O alinhamento ficou como estava.'

/**
 * Substitui o alinhamento do concerto pela lista dada (posições 0…N-1). As músicas que já lá
 * estavam mantêm o tom/notas do concerto (a não ser que a lista traga outros).
 * Nunca deixa o concerto vazio a meio: 1) as novas entram em posições temporárias (acima de
 * todas as atuais); 2) só depois saem as antigas; 3) as novas são renumeradas 0…N-1.
 * Uma falha em 1) não muda nada; em 2) tira as novas outra vez; em 3) a ordem já está certa.
 */
export async function replaceSetlistSongs(
  setlistId: string,
  rows: readonly SetlistSongInsert[],
): Promise<{ inserted: number; error: string | null }> {
  const { data, error: readErr } = await supabase.from('setlist_songs').select('*').eq('setlist_id', setlistId)
  if (readErr) return { inserted: 0, error: withNote(readErr.message, UNCHANGED) }
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
  const maxOld = old.reduce((m, o) => Math.max(m, typeof o.position === 'number' ? o.position : -1), -1)
  const base = Math.max(TEMP_POSITION, maxOld + 1, merged.length)

  // 1. Entram as novas (o alinhamento antigo continua lá)
  let added: { id: string; song_id: string; position: number }[] = []
  if (merged.length) {
    const { data: ins, error: insErr } = await supabase.from('setlist_songs')
      .insert(merged.map((r, i) => ({ ...r, setlist_id: setlistId, position: base + i })))
      .select('id, song_id, position')
    if (insErr) return { inserted: 0, error: withNote(insErr.message, UNCHANGED) }
    added = (ins ?? []) as typeof added
  }

  // 2. Saem as antigas (tudo abaixo das posições temporárias)
  const { error: delErr } = await supabase.from('setlist_songs').delete().eq('setlist_id', setlistId).lt('position', base)
  if (delErr) {
    const { error: undoErr } = await supabase.from('setlist_songs').delete().eq('setlist_id', setlistId).gte('position', base)
    return {
      inserted: 0,
      error: undoErr
        ? withNote(delErr.message, 'O concerto ficou com as músicas antigas e, no fim, as da lista — revê o alinhamento.')
        : withNote(delErr.message, UNCHANGED),
    }
  }

  // 3. Assenta as novas em 0…N-1 (se falhar, a ordem já está certa — só os números ficam altos)
  if (added.length) {
    await supabase.from('setlist_songs').upsert(
      added.map(a => ({ id: a.id, setlist_id: setlistId, song_id: a.song_id, position: a.position - base })),
      { onConflict: 'id' },
    )
  }
  return { inserted: merged.length, error: null }
}
