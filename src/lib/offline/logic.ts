/**
 * Concertos offline — a parte PURA (sem rede, sem IndexedDB, sem React):
 * chaves por utilizador, a cópia de um concerto (o que o palco, a página do
 * concerto e a lista precisam), validação ao ler, poda e escolha do que se
 * guarda antes do concerto. Testada em Node (scripts/test-offline-cache.mjs).
 */
import { concertDaysUntil } from '../concertWhen'
import type { LyricLine, SetlistSong, Song } from '../../types'

/** Versão do formato guardado — outra versão não se lê (volta a guardar-se com rede) */
export const OFFLINE_VERSION = 1
/** Próximos concertos guardados automaticamente: de hoje até N dias */
export const PREFETCH_DAYS = 14
export const PREFETCH_MAX = 10
/** Concertos que não são próximos: os N usados mais recentemente */
export const KEEP_RECENT = 20
/** Passados há mais do que isto: apagados */
export const PAST_DROP_DAYS = 30
/** Próximos com data: no máximo isto (um utilizador com 300 concertos marcados) */
export const KEEP_UPCOMING_MAX = 40

// ── Chaves (sempre com o id do utilizador: nunca se lê a cópia de outro) ─────
export const userPrefix = (userId: string) => `u:${userId}:`
export const concertKey = (userId: string, setlistId: string) => `u:${userId}:concert:${setlistId}`
export const indexKey = (userId: string) => `u:${userId}:index`
export const themeKey = (userId: string) => `u:${userId}:theme`
export const orderKey = (userId: string, setlistId: string) => `u:${userId}:order:${setlistId}`
export const orderPrefix = (userId: string) => `u:${userId}:order:`

/** Utilizador dono de uma chave (null se não é uma chave desta cache) */
export function keyUser(key: string): string | null {
  const m = /^u:([^:]+):/.exec(key)
  return m ? m[1] : null
}

// ── Formato ──────────────────────────────────────────────────────────────────
export interface OfflineSetlist {
  id: string
  name: string
  date: string | null
  venue: string | null
  band_id: string | null
  owner_id: string | null
  is_shared: boolean
  status: string | null
  updated_at: string | null
  bands: { name: string; color: string | null; image_url: string | null; owner_id: string | null } | null
}

export type OfflineRow = SetlistSong & { song: Song }

export interface OfflineAnnotation {
  /** song_annotations.strokes tal como está na cloud (qualquer versão) */
  strokes: unknown
  updated_at: string | null
}

export interface OfflineConcert {
  v: number
  userId: string
  setlistId: string
  /** Quando a cópia foi guardada com dados da rede (ms) */
  savedAt: number
  setlist: OfflineSetlist
  rows: OfflineRow[]
  /** Linhas sincronizadas por música (só as que têm) */
  syncs: Record<string, LyricLine[]>
  /** Anotações do utilizador na cloud, por música (as deste aparelho ficam no localStorage, ver annotations/storage.ts) */
  annotations: Record<string, OfflineAnnotation>
  /** A cloud foi lida para TODAS as músicas: ausência = não há anotações lá */
  annChecked: boolean
}

/** Resumo para as listas (Concertos sem rede, Projetos) — sem letras */
export interface OfflineIndexEntry {
  setlistId: string
  name: string
  date: string | null
  venue: string | null
  bandId: string | null
  bandName: string | null
  bandColor: string | null
  songCount: number
  savedAt: number
  /** Última vez que foi aberto neste aparelho (ms; nunca aberto = savedAt) — ordena os "últimos usados" */
  usedAt: number
  /** Última vez que foi ABERTO à mão (página do concerto, palco, "Guardar para offline") — nunca por um guardar em segundo plano */
  openedAt?: number
  /** Músicas da cópia (uma música editada fora do concerto atualiza as cópias que a têm) */
  songIds?: string[]
}

/** Colunas de songs que o palco, a página do concerto e o PDF usam (sem original_lyrics, source_metadata, structure…) */
const SONG_FIELDS = [
  'id', 'title', 'artist', 'lyrics', 'edited_lyrics', 'chords', 'original_key', 'performance_key',
  'bpm', 'duration_sec', 'has_sync', 'capo', 'tuning', 'notes', 'source', 'owner_id', 'project_id',
  'is_user_edited', 'created_at', 'updated_at',
] as const
const ROW_FIELDS = [
  'id', 'setlist_id', 'song_id', 'position', 'performance_key', 'notes', 'custom_intro', 'custom_ending',
  'estimated_duration',
] as const

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function pick(src: Obj, fields: readonly string[]): Obj {
  const out: Obj = {}
  for (const f of fields) if (src[f] !== undefined) out[f] = src[f]
  return out
}

export function trimSong(song: unknown): Song {
  return pick(isObj(song) ? song : {}, SONG_FIELDS) as unknown as Song
}

export function trimRow(row: unknown): OfflineRow {
  const r = isObj(row) ? row : {}
  return { ...(pick(r, ROW_FIELDS) as unknown as SetlistSong), song: trimSong(r.song) }
}

export function trimSetlist(s: unknown): OfflineSetlist {
  const o = isObj(s) ? s : {}
  const b = isObj(o.bands) ? o.bands : isObj(o.band) ? o.band : null
  return {
    id: String(o.id ?? ''),
    name: str(o.name) ?? '',
    date: str(o.date),
    venue: str(o.venue),
    band_id: str(o.band_id),
    owner_id: str(o.owner_id),
    is_shared: o.is_shared === true,
    status: str(o.status),
    updated_at: str(o.updated_at),
    bands: b ? { name: str(b.name) ?? '', color: str(b.color), image_url: str(b.image_url), owner_id: str(b.owner_id) } : null,
  }
}

function validLines(v: unknown): v is LyricLine[] {
  return Array.isArray(v) && v.length > 0 && v.every(l => isObj(l) && typeof l.time_ms === 'number' && typeof l.text === 'string')
}

export function buildConcert(input: {
  userId: string
  setlist: unknown
  rows: unknown[]
  syncs?: Record<string, unknown>
  annotations?: Record<string, OfflineAnnotation>
  annChecked?: boolean
  savedAt: number
}): OfflineConcert {
  const setlist = trimSetlist(input.setlist)
  const rows = input.rows.map(trimRow).filter(r => !!r.id && !!r.song?.id)
  const songIds = new Set(rows.map(r => r.song.id))
  const syncs: Record<string, LyricLine[]> = {}
  for (const [sid, lines] of Object.entries(input.syncs ?? {})) {
    if (songIds.has(sid) && validLines(lines)) syncs[sid] = lines
  }
  const annotations: Record<string, OfflineAnnotation> = {}
  for (const [sid, a] of Object.entries(input.annotations ?? {})) {
    if (songIds.has(sid) && a && a.strokes != null) annotations[sid] = { strokes: a.strokes, updated_at: a.updated_at ?? null }
  }
  return {
    v: OFFLINE_VERSION,
    userId: input.userId,
    setlistId: setlist.id,
    savedAt: input.savedAt,
    setlist,
    rows,
    syncs,
    annotations,
    annChecked: !!input.annChecked,
  }
}

/**
 * Lê uma cópia guardada: null se não é deste utilizador / concerto, se é de
 * outra versão ou se está estragada. Nunca lança.
 */
export function parseConcert(raw: unknown, userId: string, setlistId: string): OfflineConcert | null {
  if (!isObj(raw)) return null
  if (raw.v !== OFFLINE_VERSION || raw.userId !== userId || raw.setlistId !== setlistId) return null
  if (!isObj(raw.setlist) || raw.setlist.id !== setlistId || !Array.isArray(raw.rows)) return null
  if (typeof raw.savedAt !== 'number' || !isFinite(raw.savedAt)) return null
  const rows = (raw.rows as unknown[]).filter((r): r is OfflineRow =>
    isObj(r) && typeof r.id === 'string' && isObj(r.song) && typeof (r.song as Obj).id === 'string')
  const syncs: Record<string, LyricLine[]> = {}
  if (isObj(raw.syncs)) for (const [k, v] of Object.entries(raw.syncs)) if (validLines(v)) syncs[k] = v
  const annotations: Record<string, OfflineAnnotation> = {}
  if (isObj(raw.annotations)) {
    for (const [k, v] of Object.entries(raw.annotations)) {
      if (isObj(v) && v.strokes != null) annotations[k] = { strokes: v.strokes, updated_at: str(v.updated_at) }
    }
  }
  return {
    v: OFFLINE_VERSION,
    userId,
    setlistId,
    savedAt: raw.savedAt,
    setlist: trimSetlist(raw.setlist),
    rows,
    syncs,
    annotations,
    annChecked: raw.annChecked === true,
  }
}

/** Uma música mudou fora do concerto (letra, acordes, tom, sincronização…) */
export interface SongChange {
  /** Colunas novas de songs (só as que o palco usa ficam — ver trimSong) */
  song?: Partial<Song>
  /** Linhas sincronizadas novas; null = a música deixou de ter sync */
  syncLines?: LyricLine[] | null
}

/** A cópia com a música mudada — null se a cópia não tem esta música */
export function applySongChange(c: OfflineConcert, songId: string, change: SongChange): OfflineConcert | null {
  if (!c.rows.some(r => r.song.id === songId)) return null
  const rows = change.song
    ? c.rows.map(r => (r.song.id === songId ? { ...r, song: trimSong({ ...r.song, ...change.song, id: songId }) } : r))
    : c.rows
  let syncs = c.syncs
  if (change.syncLines !== undefined) {
    syncs = { ...c.syncs }
    if (validLines(change.syncLines)) syncs[songId] = change.syncLines
    else delete syncs[songId]
  }
  return { ...c, rows, syncs }
}

export function indexEntryOf(c: OfflineConcert, usedAt: number, openedAt?: number): OfflineIndexEntry {
  return {
    setlistId: c.setlistId,
    name: c.setlist.name,
    date: c.setlist.date,
    venue: c.setlist.venue,
    bandId: c.setlist.band_id,
    bandName: c.setlist.bands?.name ?? null,
    bandColor: c.setlist.bands?.color ?? null,
    songCount: c.rows.length,
    savedAt: c.savedAt,
    usedAt,
    ...(openedAt ? { openedAt } : {}),
    songIds: Array.from(new Set(c.rows.map(r => r.song.id))),
  }
}

export function parseIndex(raw: unknown): OfflineIndexEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is OfflineIndexEntry =>
    isObj(e) && typeof e.setlistId === 'string' && typeof e.name === 'string' && typeof e.savedAt === 'number')
    .map(e => {
      const out: OfflineIndexEntry = { ...e, usedAt: typeof e.usedAt === 'number' ? e.usedAt : e.savedAt }
      if (typeof e.openedAt !== 'number') delete out.openedAt
      if (!Array.isArray(e.songIds) || !e.songIds.every(x => typeof x === 'string')) delete out.songIds
      return out
    })
}

/** Junta/substitui uma entrada (a mais recente primeiro não importa: a lista ordena) */
export function upsertIndex(entries: OfflineIndexEntry[], entry: OfflineIndexEntry): OfflineIndexEntry[] {
  return [...entries.filter(e => e.setlistId !== entry.setlistId), entry]
}

/**
 * Poda: ficam os próximos (com data, até KEEP_UPCOMING_MAX, os mais perto
 * primeiro) e, dos outros (sem data e passados), os KEEP_RECENT usados mais
 * recentemente. Um passado há mais de PAST_DROP_DAYS dias sai — a menos que
 * tenha sido aberto à mão há menos do que isso (um alinhamento antigo que se
 * vai repetir, uma data escrita com o ano errado). `keepId` (o concerto que
 * se acabou de abrir) nunca sai.
 */
export function pruneIndex(entries: OfflineIndexEntry[], now: Date, keepId?: string): { keep: OfflineIndexEntry[]; drop: string[] } {
  const upcoming: OfflineIndexEntry[] = []
  const others: OfflineIndexEntry[] = []
  const drop: string[] = []
  let pinned: OfflineIndexEntry | null = null
  const recentlyOpened = (e: OfflineIndexEntry) => !!e.openedAt && now.getTime() - e.openedAt <= PAST_DROP_DAYS * 86_400_000
  for (const e of entries) {
    if (e.setlistId === keepId) { pinned = e; continue }
    const days = concertDaysUntil(e.date, now)
    if (days === null) others.push(e)
    else if (days >= 0) upcoming.push(e)
    else if (-days > PAST_DROP_DAYS && !recentlyOpened(e)) drop.push(e.setlistId)
    else others.push(e)
  }
  upcoming.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || b.usedAt - a.usedAt)
  others.sort((a, b) => b.usedAt - a.usedAt)
  const keep = [...upcoming.slice(0, KEEP_UPCOMING_MAX), ...others.slice(0, KEEP_RECENT)]
  for (const e of upcoming.slice(KEEP_UPCOMING_MAX)) drop.push(e.setlistId)
  for (const e of others.slice(KEEP_RECENT)) drop.push(e.setlistId)
  if (pinned) keep.push(pinned)
  return { keep, drop }
}

/** Ordem para as listas offline: hoje/próximos por data, depois sem data, depois passados (mais recente primeiro) */
export function sortIndex(entries: OfflineIndexEntry[], now: Date): OfflineIndexEntry[] {
  const rank = (e: OfflineIndexEntry) => {
    const d = concertDaysUntil(e.date, now)
    return d === null ? 1 : d >= 0 ? 0 : 2
  }
  return [...entries].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return (a.date ?? '').localeCompare(b.date ?? '')
    if (ra === 2) return (b.date ?? '').localeCompare(a.date ?? '')
    return b.usedAt - a.usedAt
  })
}

/** Concertos a guardar antes de sair de casa: de hoje até PREFETCH_DAYS dias, os mais perto primeiro */
export function selectPrefetch(
  list: { id: string; date: string | null }[],
  now: Date,
  days = PREFETCH_DAYS,
  max = PREFETCH_MAX,
): string[] {
  return list
    .map(s => ({ id: s.id, date: s.date, d: concertDaysUntil(s.date, now) }))
    .filter(s => s.d !== null && s.d >= 0 && s.d <= days)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .slice(0, max)
    .map(s => s.id)
}

// ── Ordem pendente (reordenada sem rede) ────────────────────────────────────
export interface PendingOrder {
  userId: string
  setlistId: string
  /** ids de setlist_songs pela ordem pretendida */
  ids: string[]
  at: number
}

export function parsePendingOrder(raw: unknown, userId: string, setlistId: string): PendingOrder | null {
  if (!isObj(raw) || raw.userId !== userId || raw.setlistId !== setlistId) return null
  if (!Array.isArray(raw.ids) || !raw.ids.every(x => typeof x === 'string')) return null
  return { userId, setlistId, ids: raw.ids as string[], at: typeof raw.at === 'number' ? raw.at : 0 }
}

/**
 * Aplica uma ordem pendente a linhas (da cópia ou da rede): primeiro as que
 * a ordem conhece, por essa ordem; as que entretanto apareceram (outro membro
 * acrescentou) ficam no fim, pela ordem em que vêm; as que desapareceram
 * saem. Sem ordem → as linhas como vêm.
 */
export function applyPendingOrder<T extends { id: string }>(rows: T[], ids: string[] | null | undefined): T[] {
  if (!ids || ids.length === 0) return rows
  const byId = new Map(rows.map(r => [r.id, r]))
  const out: T[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const r = byId.get(id)
    if (r && !seen.has(id)) { out.push(r); seen.add(id) }
  }
  for (const r of rows) if (!seen.has(r.id)) { out.push(r); seen.add(r.id) }
  return out
}

export function sameOrder(rows: { id: string }[], ids: string[]): boolean {
  return rows.length === ids.length && rows.every((r, i) => r.id === ids[i])
}

// ── Textos ───────────────────────────────────────────────────────────────────
/** Aviso ao terminar a sessão com ordens por enviar ('' = nenhuma) */
export function unsentOrdersText(names: string[]): string {
  if (names.length === 0) return ''
  const list = names.map(n => `"${n}"`).join(', ')
  return names.length === 1
    ? ` Há uma ordem por enviar de ${list} que se perde.`
    : ` Há ordens por enviar de ${list} que se perdem.`
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** "às 14:32" (hoje) · "ontem às 14:32" · "a 12 out às 14:32" — hora local */
export function savedAtLabel(ts: number, now: Date): string {
  const d = new Date(ts)
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  if (diff <= 0) return `às ${hhmm(d)}`
  if (diff === 1) return `ontem às ${hhmm(d)}`
  return `a ${d.getDate()} ${MONTHS[d.getMonth()]} às ${hhmm(d)}`
}
