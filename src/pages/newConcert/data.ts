/* ═══════════════════════════════════════════════════════════════
   Novo concerto — dados (projetos, concertos a copiar, alinhamento
   de um concerto) e formatação. Sem React.
═══════════════════════════════════════════════════════════════ */
import { supabase } from '../../lib/supabase'
import { mapLegacyProjectColor } from '../../lib/projectColor'
import { humanizeError } from '../../lib/setlistImport/errors'
import type { LibrarySong, SetlistSongExtra } from '../../components/import'

/** Projeto onde o utilizador pode criar concertos (ou só ver, `canCreate: false`). */
export interface ProjectOption {
  id: string
  name: string
  /** Cor pronta a pintar no LED (já remapeada da paleta v1) */
  color: string
  canCreate: boolean
}

/** Concerto visível ao utilizador, candidato a "copiar". */
export interface ConcertOption {
  id: string
  name: string
  date: string | null
  venue: string | null
  bandId: string | null
  bandName: string | null
  bandColor: string | null
  songCount: number
  createdAt: string
}

/** Uma música do alinhamento de um concerto (para copiar). */
export interface ConcertSong {
  song: LibrarySong
  extra: SetlistSongExtra
}

/* ── localStorage: último projeto usado ── */

const LAST_PROJECT_KEY = 'gigio-last-project'
/** Valor guardado para "Pessoal" (sem banda) */
export const PERSONAL = 'pessoal'

/** undefined = nada guardado; null = Pessoal; string = id da banda */
export function readLastProject(): string | null | undefined {
  try {
    const v = localStorage.getItem(LAST_PROJECT_KEY)
    if (!v) return undefined
    return v === PERSONAL ? null : v
  } catch {
    return undefined
  }
}

export function rememberProject(projectId: string | null) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId ?? PERSONAL)
  } catch { /* modo privado — ignora */ }
}

/* ── Cores ── */

/** Primeira amostra v2 — o que Projetos mostra para um projeto sem cor */
const DEFAULT_PROJECT_COLOR = '#4CC9F0'

export function projectLed(raw: string | null | undefined): string {
  const r = raw?.trim()
  return r ? mapLegacyProjectColor(r) : DEFAULT_PROJECT_COLOR
}

/* ── Carregamento ── */

interface RawMembership {
  band_id: string
  role: string | null
  bands: { id: string; name: string; color: string | null } | null
}

export async function fetchProjects(userId: string): Promise<{ projects: ProjectOption[]; error: string | null }> {
  const { data, error } = await supabase
    .from('band_members')
    .select('band_id, role, bands(id, name, color)')
    .eq('user_id', userId)
  if (error) return { projects: [], error: humanizeError(error.message) }
  const rows = (data ?? []) as unknown as RawMembership[]
  const projects = rows
    .filter(r => r.bands)
    .map(r => ({
      id: r.bands!.id,
      name: r.bands!.name,
      color: projectLed(r.bands!.color),
      canCreate: r.role !== 'viewer',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
  return { projects, error: null }
}

interface RawConcert {
  id: string
  name: string
  date: string | null
  venue: string | null
  band_id: string | null
  created_at: string
  band: { name: string; color: string | null } | null
  setlist_songs: { count: number }[] | null
}

/** Concertos visíveis (próprios + das bandas), com pelo menos uma música. */
export async function fetchConcerts(userId: string, bandIds: string[]): Promise<{ concerts: ConcertOption[]; error: string | null }> {
  let q = supabase
    .from('setlists')
    .select('id, name, date, venue, band_id, created_at, band:bands(name, color), setlist_songs(count)')
    .order('date', { ascending: false, nullsFirst: false })
    .limit(200)
  q = bandIds.length > 0
    ? q.or(`owner_id.eq.${userId},band_id.in.(${bandIds.join(',')})`)
    : q.eq('owner_id', userId)
  const { data, error } = await q
  if (error) return { concerts: [], error: humanizeError(error.message) }
  const concerts = ((data ?? []) as unknown as RawConcert[])
    .map(r => ({
      id: r.id,
      name: r.name,
      date: r.date,
      venue: r.venue,
      bandId: r.band_id,
      bandName: r.band?.name ?? null,
      bandColor: r.band ? projectLed(r.band.color) : null,
      songCount: r.setlist_songs?.[0]?.count ?? 0,
      createdAt: r.created_at,
    }))
    .filter(c => c.songCount > 0)
  return { concerts, error: null }
}

interface RawConcertSong {
  position: number
  performance_key: string | null
  notes: string | null
  custom_intro: string | null
  custom_ending: string | null
  song: LibrarySong | null
}

const SONG_COLUMNS = 'id, title, artist, has_sync, performance_key, original_key, project_id, owner_id'

/** Alinhamento de um concerto, pela ordem (músicas invisíveis por permissões ficam de fora). */
export async function fetchConcertSongs(setlistId: string): Promise<ConcertSong[]> {
  const { data, error } = await supabase
    .from('setlist_songs')
    .select(`position, performance_key, notes, custom_intro, custom_ending, song:songs(${SONG_COLUMNS})`)
    .eq('setlist_id', setlistId)
    .order('position', { ascending: true })
  if (error) throw new Error(humanizeError(error.message))
  return ((data ?? []) as unknown as RawConcertSong[])
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter(r => r.song && r.song.id)
    .map(r => ({
      song: r.song as LibrarySong,
      extra: {
        performance_key: r.performance_key,
        notes: r.notes,
        custom_intro: r.custom_intro,
        custom_ending: r.custom_ending,
      },
    }))
}

/** YYYY-MM-DD de hoje (hora local) */
export function todayYmd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/**
 * Concertos do projeto escolhido primeiro; dentro de cada grupo, por "último tocado": os que
 * já passaram (até hoje), do mais recente para trás; depois os próximos, do mais perto para
 * o mais longe; por fim os sem data. (Copiar é quase sempre "o do mês passado".)
 */
export function sortConcerts(list: readonly ConcertOption[], projectId: string | null, today: string = todayYmd()): ConcertOption[] {
  const rank = (c: ConcertOption) => (!c.date ? 2 : c.date <= today ? 0 : 1)
  const byDate = (a: ConcertOption, b: ConcertOption) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (a.date && b.date && a.date !== b.date) {
      // passados: mais recente primeiro; próximos: mais perto primeiro
      return ra === 0 ? (a.date < b.date ? 1 : -1) : (a.date < b.date ? -1 : 1)
    }
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  }
  const mine = list.filter(c => c.bandId === projectId).sort(byDate)
  const other = list.filter(c => c.bandId !== projectId).sort(byDate)
  return [...mine, ...other]
}

/** Concerto que já existe num dia (vindo do Calendário: importar para esse em vez de criar outro). */
export interface DayConcert {
  id: string
  name: string
  bandId: string | null
  ownerId: string
  songCount: number
}

export async function fetchConcertsOnDate(userId: string, bandIds: string[], date: string): Promise<DayConcert[]> {
  let q = supabase
    .from('setlists')
    .select('id, name, band_id, owner_id, setlist_songs(count)')
    .eq('date', date)
    .limit(20)
  q = bandIds.length > 0
    ? q.or(`owner_id.eq.${userId},band_id.in.(${bandIds.join(',')})`)
    : q.eq('owner_id', userId)
  const { data, error } = await q
  if (error) return []
  return ((data ?? []) as unknown as { id: string; name: string; band_id: string | null; owner_id: string; setlist_songs: { count: number }[] | null }[])
    .map(r => ({ id: r.id, name: r.name, bandId: r.band_id, ownerId: r.owner_id, songCount: r.setlist_songs?.[0]?.count ?? 0 }))
}

/** "Bar do Zé · sáb 28 set" → "Bar do Zé" (para não acumular datas ao copiar) */
export function stripDateSuffix(name: string): string {
  return name
    .replace(/\s*\((?:c[óo]pia|copy)\)\s*$/i, '')
    .replace(/\s*[·•|-]\s*(?:(?:seg|ter|qua|qui|sex|s[áa]b|dom)\.?\s+)?\d{1,2}(?:\s+|\/)(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|\d{1,2})\w*(?:[\s/]\d{2,4})?\s*$/i, '')
    .trim() || name
}

/* ── Local (Nominatim) ── */

export interface VenueSuggestion { name: string; detail: string }

export async function searchVenues(query: string, signal?: AbortSignal): Promise<VenueSuggestion[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=pt`,
    { headers: { 'Accept-Language': 'pt' }, signal },
  )
  if (!res.ok) return []
  const data: { display_name: string }[] = await res.json()
  return data.map(r => {
    const parts = r.display_name.split(',')
    return { name: parts[0].trim(), detail: parts.slice(1, 3).map(s => s.trim()).join(', ') }
  })
}

/* ── Formatação ── */

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const pad2 = (n: number) => String(n).padStart(2, '0')

export function isYmd(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function parseLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "sáb 28 set" (+ ano se não for o atual) — maiúsculas ficam a cargo do CSS. */
export function shortDate(ymd: string): string {
  const d = parseLocal(ymd)
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() !== new Date().getFullYear() ? `${base} ${d.getFullYear()}` : base
}

export function dayOfMonth(ymd: string): string {
  return ymd.slice(8, 10)
}

/** "set" / "set 25" quando é de outro ano */
export function monthLabel(ymd: string): string {
  const d = parseLocal(ymd)
  const m = MONTHS[d.getMonth()]
  return d.getFullYear() !== new Date().getFullYear() ? `${m} ${String(d.getFullYear()).slice(2)}` : m
}

/** "18 músicas" com espaço inquebrável */
export function songsLabel(n: number): string {
  return `${n}\u00A0música${n === 1 ? '' : 's'}`
}

/** Pesquisa tolerante (sem acentos/maiúsculas) */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}
