/* ═══════════════════════════════════════════════════════════════
   Linhas da revisão: criação a partir do parser ou de músicas do
   repertório, estado visível, contagens. PURO.
═══════════════════════════════════════════════════════════════ */
import type { SetlistTextEntry } from './parse'
import { AUTO_PICK_SCORE, CONFIDENT_SCORE, type RankedResult, type SongQuery } from './match'
import { normalizeTitle } from './text'
import type { ImportCounts, ImportRow, LibrarySong, RowChoice, RowStatus, SetlistSongExtra } from './types'

let seq = 0
/** Id único de linha (estável durante a sessão). */
export function newRowId(): string {
  seq += 1
  return `r${Date.now().toString(36)}${seq.toString(36)}`
}

const idleSearch = () => ({ state: 'idle' as const, query: '', results: [] })

/** Entradas do parser → linhas (medleys viram linhas consecutivas com o mesmo `medleyId`). */
export function entriesToRows(entries: readonly SetlistTextEntry[]): ImportRow[] {
  const rows: ImportRow[] = []
  for (const e of entries) {
    const medleyId = e.songs.length > 1 ? newRowId() : undefined
    for (const s of e.songs) {
      const row: ImportRow = {
        id: newRowId(),
        raw: e.raw,
        title: s.title,
        artist: s.artist ?? '',
        choice: null,
        search: idleSearch(),
        order: e.order,
      }
      if (s.swapped) row.swapped = s.swapped
      if (s.text && normalizeTitle(s.text) !== normalizeTitle(s.title)) row.text = s.text
      if (s.key) row.key = s.key
      if (s.durationSec) row.durationSec = s.durationSec
      if (e.section) row.section = e.section
      if (e.moment) row.note = e.moment
      if (e.repeat) row.repeat = true
      if (medleyId) row.medleyId = medleyId
      rows.push(row)
    }
  }
  return rows
}

/** Músicas escolhidas do repertório / copiadas de um concerto → linhas já resolvidas. */
export function songsToRows(items: readonly { song: LibrarySong; extra?: SetlistSongExtra; sourceExtra?: SetlistSongExtra }[]): ImportRow[] {
  return items.map(({ song, extra, sourceExtra }) => {
    const row: ImportRow = {
      id: newRowId(),
      raw: song.title,
      title: song.title,
      artist: song.artist ?? '',
      choice: { kind: 'library', song, auto: false },
      search: idleSearch(),
    }
    if (extra) row.extra = extra
    if (sourceExtra ?? extra) row.sourceExtra = sourceExtra ?? extra
    return row
  })
}

/** O que procurar para esta linha. */
export function rowQuery(row: ImportRow): SongQuery {
  const q: SongQuery = { title: row.title }
  if (row.artist) q.artist = row.artist
  if (row.swapped) q.swapped = row.swapped
  if (row.text) q.text = row.text
  return q
}

/** Escolha automática a partir dos resultados ordenados (ou null se nenhum convence). */
export function autoOnlineChoice(results: readonly RankedResult[]): RowChoice | null {
  const best = results[0]
  if (!best || best.score < AUTO_PICK_SCORE) return null
  return { kind: 'online', result: best.result, score: best.score, auto: true }
}

/**
 * Estado visível: BIBLIOTECA / NOVA · LETRA / A PROCURAR / NOVA · SEM LETRA / SEM LIGAÇÃO.
 * Enquanto o repertório carrega, uma linha ainda sem escolha está "a procurar" (não
 * "sem letra": pode estar no repertório).
 */
export function rowStatus(row: ImportRow, libraryLoading = false): RowStatus {
  const c = row.choice
  if (c?.kind === 'library') return 'library'
  if (c?.kind === 'online') return 'online'
  if (c?.kind === 'empty') return 'empty'
  if (libraryLoading) return 'searching'
  switch (row.search.state) {
    case 'queued':
    case 'searching':
      return 'searching'
    case 'offline':
      return 'offline'
    default:
      return 'empty'
  }
}

/** Rótulos (pt-PT) dos estados, como aparecem nos chips da revisão. */
export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  library: 'Biblioteca',
  online: 'Nova · letra',
  searching: 'A procurar…',
  empty: 'Nova · sem letra',
  offline: 'Sem ligação',
}

/** Escolha automática a confirmar: online com confiança baixa, ou repertório aproximado. */
export function isUncertain(row: ImportRow): boolean {
  const c = row.choice
  if (c?.kind === 'online') return c.auto && c.score < CONFIDENT_SCORE
  if (c?.kind === 'library') return c.auto && !!c.loose
  return false
}

export function countRows(rows: readonly ImportRow[], libraryLoading = false): ImportCounts {
  const c: ImportCounts = { total: rows.length, library: 0, online: 0, empty: 0, searching: 0, offline: 0, uncertain: 0, repeat: 0 }
  for (const r of rows) {
    c[rowStatus(r, libraryLoading)]++
    if (isUncertain(r)) c.uncertain++
    if (r.repeat) c.repeat++
  }
  return c
}

/**
 * Campos de `setlist_songs` para a linha: os do concerto copiado; senão, o tom lido na
 * lista quando difere do tom da música do repertório (músicas novas levam o tom na própria
 * música) e o momento do evento ("Entrada da noiva") como nota.
 */
export function setlistFieldsFor(row: ImportRow): SetlistSongExtra {
  if (row.extra) {
    const out = { ...row.extra }
    if (row.note && !out.notes) out.notes = row.note
    return out
  }
  const out: SetlistSongExtra = {}
  if (row.key && row.choice?.kind === 'library') {
    const own = row.choice.song.performance_key ?? row.choice.song.original_key ?? ''
    if (normalizeTitle(own) !== normalizeTitle(row.key)) out.performance_key = row.key
  }
  if (row.note) out.notes = row.note
  return out
}

/** Linhas consecutivas com o mesmo medleyId: devolve a posição no grupo (ou null). */
export function medleyPosition(rows: readonly ImportRow[], index: number): { index: number; size: number } | null {
  const id = rows[index]?.medleyId
  if (!id) return null
  let start = index
  while (start > 0 && rows[start - 1].medleyId === id) start--
  let end = index
  while (end < rows.length - 1 && rows[end + 1].medleyId === id) end++
  if (end === start) return null
  return { index: index - start, size: end - start + 1 }
}

/** Onde inserir uma linha com `order` (linha ignorada reposta): antes da 1.ª com order maior. */
export function insertIndexFor(rows: readonly ImportRow[], order: number): number {
  const i = rows.findIndex(r => r.order !== undefined && r.order > order)
  return i < 0 ? rows.length : i
}

/** Marca de novo as repetidas (depois de editar/remover/repor). */
export function markRepeats(rows: readonly ImportRow[]): ImportRow[] {
  const seen = new Set<string>()
  return rows.map(r => {
    const k = r.choice?.kind === 'library' ? `id:${r.choice.song.id}` : `t:${normalizeTitle(r.title)}`
    const repeat = seen.has(k)
    seen.add(k)
    return !!r.repeat === repeat ? r : { ...r, repeat: repeat || undefined }
  })
}
