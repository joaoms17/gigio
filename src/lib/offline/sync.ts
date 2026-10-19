/**
 * Concertos offline — a parte de REDE: ler um concerto inteiro do Supabase
 * para a cópia local, guardar os próximos concertos em segundo plano e
 * enviar a ordem mudada sem rede.
 *
 * Escritas sem rede (decisão):
 *  - Reordenar no modo concerto (▲▼): fica PENDENTE neste aparelho (IndexedDB,
 *    sobrevive a fechar a app), por cima da cópia e da rede, e é enviada
 *    quando a rede volta (sendOrder / flushPendingOrders). Se o servidor a
 *    recusar (ex.: sem permissão), deixa de estar pendente e avisa-se.
 *  - Tudo o resto (tom/notas, nome, data, local, acrescentar/remover músicas,
 *    tema): bloqueado sem rede, com aviso — nunca se perde em silêncio.
 */
import { supabase } from '../supabase'
import { isLikelyOffline, runQuery } from './net'
import {
  applyPendingOrder, buildConcert, sameOrder, selectPrefetch, PREFETCH_DAYS, PREFETCH_MAX,
  type OfflineAnnotation, type OfflineConcert,
} from './logic'
import {
  clearPendingOrder, forgetConcert, getPendingOrder, listConcerts, listPendingOrders, loadConcert,
  saveConcert, saveTheme,
} from './store'

/**
 * Sonda de rede para o modo offline (ver net.ts): um GET simples ao
 * Supabase, sem sessão (não espera pela renovação do token) e com 5 s no
 * máximo. Qualquer resposta HTTP = há internet.
 */
export function probeSupabase(): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url) return Promise.resolve(false)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  return fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: ctrl.signal, cache: 'no-store' })
    .then(() => true, () => false)
    .finally(() => clearTimeout(timer))
}

export type FetchResult =
  /** persisted = a cópia ficou guardada neste aparelho (ver saveConcert) */
  | { status: 'ok'; concert: OfflineConcert; persisted: boolean }
  /** Sem rede (ou tempo esgotado): fica a cópia */
  | { status: 'offline' }
  /** O servidor diz que não existe ou que já não há acesso */
  | { status: 'gone' }
  /** Erro do servidor: fica a cópia */
  | { status: 'error' }

/** Há sessão com o token ainda válido (o pedido que acabou de correr não foi anónimo) */
async function hasLiveSession(): Promise<boolean> {
  try {
    const r = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
    ])
    const s = r?.data.session
    return !!s && (!s.expires_at || s.expires_at * 1000 > Date.now())
  } catch { return false }
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Lê um concerto inteiro da rede e grava a cópia: o concerto, as músicas
 * (letras, acordes, tons, notas), as sincronizações e as anotações do
 * utilizador na cloud. Uma ordem por enviar fica por cima. Só substitui a
 * cópia quando o servidor devolveu o concerto (prova de acesso) e as músicas
 * sem erro — nunca grava uma lista vazia de uma resposta sem sessão.
 */
export async function fetchConcert(
  userId: string,
  setlistId: string,
  opts: { timeoutMs?: number; force?: boolean; used?: boolean } = {},
): Promise<FetchResult> {
  const t = opts.timeoutMs ?? 15000
  const force = !!opts.force
  const [sl, rowsRes] = await Promise.all([
    runQuery(supabase.from('setlists').select('*, bands(name, image_url, color, owner_id)').eq('id', setlistId).maybeSingle(), t, force),
    runQuery(supabase.from('setlist_songs').select('*, song:songs(*)').eq('setlist_id', setlistId).order('position'), t, force),
  ])
  if (sl.network || rowsRes.network) return { status: 'offline' }
  if (sl.error || rowsRes.error) return { status: (sl.status >= 500 || rowsRes.status >= 500) ? 'offline' : 'error' }
  if (!sl.data) {
    // Só com uma sessão válida: sem ela o pedido vai com a chave anónima e o
    // RLS esconde tudo — não é prova de que o concerto deixou de existir
    if (await hasLiveSession()) await forgetConcert(userId, setlistId)
    return { status: 'gone' }
  }
  const rawRows = (rowsRes.data ?? []) as { id: string; song?: { id?: string; has_sync?: boolean } | null }[]
  const songIds = Array.from(new Set(rawRows.map(r => r.song?.id).filter((x): x is string => !!x)))
  const syncIds = Array.from(new Set(rawRows.filter(r => r.song?.has_sync && r.song.id).map(r => r.song!.id!)))

  const prev = await loadConcert(userId, setlistId)
  const [syncRes, annRes] = await Promise.all([
    syncIds.length
      ? runQuery(supabase.from('lyric_syncs').select('song_id, lines').in('song_id', syncIds), t, force)
      : Promise.resolve({ data: [], error: null, status: 200, network: false }),
    songIds.length
      ? runQuery(supabase.from('song_annotations').select('song_id, strokes, updated_at').eq('user_id', userId).in('song_id', songIds), t, force)
      : Promise.resolve({ data: [], error: null, status: 200, network: false }),
  ])

  // Sincronizações: as que vieram; se o pedido falhou, as da cópia anterior
  const syncs: Record<string, unknown> = {}
  if (!syncRes.error && Array.isArray(syncRes.data)) {
    for (const r of syncRes.data as { song_id: string; lines: unknown }[]) syncs[r.song_id] = r.lines
  } else if (prev) Object.assign(syncs, prev.syncs)

  // Anotações da cloud: idem (sem as ler, a ausência não quer dizer nada)
  let annotations: Record<string, OfflineAnnotation> = {}
  let annChecked = false
  if (!annRes.error && Array.isArray(annRes.data)) {
    for (const r of annRes.data as { song_id: string; strokes: unknown; updated_at: string | null }[]) {
      if (r.strokes != null) annotations[r.song_id] = { strokes: r.strokes, updated_at: r.updated_at ?? null }
    }
    annChecked = true
  } else if (prev) {
    annotations = prev.annotations
    annChecked = prev.annChecked
  }

  // Ordem mudada sem rede: fica por cima até ser enviada
  const pending = await getPendingOrder(userId, setlistId)
  let rows: unknown[] = rawRows
  if (pending) {
    const ordered = applyPendingOrder(rawRows, pending.ids)
    if (sameOrder(rawRows, ordered.map(r => r.id)) && sameOrder(rawRows, pending.ids)) {
      await clearPendingOrder(userId, setlistId, pending.ids)
    }
    rows = ordered
  }

  const concert = buildConcert({
    userId, setlist: sl.data, rows, syncs, annotations, annChecked, savedAt: Date.now(),
  })
  const persisted = await saveConcert(concert, { used: opts.used })
  return { status: 'ok', concert, persisted }
}

/** profiles.concert_theme → cópia local (null se não veio) */
export async function fetchTheme(userId: string, timeoutMs = 8000): Promise<Record<string, unknown> | null> {
  const r = await runQuery(supabase.from('profiles').select('concert_theme').eq('id', userId).maybeSingle(), timeoutMs)
  const theme = (r.data as { concert_theme?: unknown } | null)?.concert_theme
  if (r.error || !theme || typeof theme !== 'object') return null
  await saveTheme(userId, theme)
  return theme as Record<string, unknown>
}

// ── Guardar os próximos concertos (segundo plano) ─────────────────────────────
const PREFETCH_EVERY_MS = 10 * 60 * 1000
const lastRunKey = (userId: string) => `gigio-offline-prefetch-${userId}`
let running: Promise<number | null> | null = null

function lastRun(userId: string): number {
  try { return Number(localStorage.getItem(lastRunKey(userId))) || 0 } catch { return 0 }
}
function setLastRun(userId: string, at: number) {
  try { localStorage.setItem(lastRunKey(userId), String(at)) } catch { /* */ }
}

/**
 * Uma música ou sincronização mudou com rede (página da música, editor de
 * sincronização): o próximo guardar em segundo plano (voltar ao primeiro
 * plano, rede de volta, reabrir) corre já, sem esperar pelos 10 min
 */
export function markCopiesStale(userId: string) {
  setLastRun(userId, 0)
}

/** Ids da cache antiga (localStorage, antes do IndexedDB): verificados pelo servidor antes de entrarem */
function legacyIds(): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      const m = k && /^gigio_concert_songs_v1_(.+)$/.exec(k)
      if (m) out.push(m[1])
    }
  } catch { /* */ }
  return out.slice(0, PREFETCH_MAX)
}

/** Apaga a cache antiga do localStorage (o volume passou para o IndexedDB; o token da sessão vive lá) */
export function dropLegacyCache() {
  try {
    const dead: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      // (e a cache antiga dos projetos, por projeto e não por utilizador)
      if (k && /^gigio_(concert_songs_v1_|concert_sync_v1_|setlist_meta_v1_|concert_theme_v1$|dashboard_v1_)/.test(k)) dead.push(k)
    }
    dead.forEach(k => localStorage.removeItem(k))
  } catch { /* */ }
}

/**
 * Com rede: guarda os concertos de hoje e dos próximos PREFETCH_DAYS dias
 * (até PREFETCH_MAX), refresca os próximos já guardados e o tema. Nunca dois
 * em paralelo, um concerto de cada vez (não atrasa a interface). Depois de
 * uma volta COMPLETA espera 10 min até à próxima (force: já); uma volta
 * interrompida (a rede caiu, a app foi fechada a meio) não conta — a
 * seguinte (rede de volta, primeiro plano, reabrir) recomeça logo, e os que
 * faltavam ficam guardados. Devolve quantos guardou (null = não correu).
 */
export function prefetchUpcoming(userId: string, opts: { force?: boolean } = {}): Promise<number | null> {
  if (running) return running
  if (isLikelyOffline()) return Promise.resolve(null)
  if (!opts.force && Date.now() - lastRun(userId) < PREFETCH_EVERY_MS) return Promise.resolve(null)
  running = (async () => {
    const today = new Date()
    const until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + PREFETCH_DAYS)
    // Sem filtro de dono: o RLS devolve os meus e os partilhados dos projetos onde sou membro
    const list = await runQuery(
      supabase.from('setlists').select('id, date').gte('date', ymd(today)).lte('date', ymd(until)).order('date', { ascending: true }),
      12000,
    )
    if (list.network || list.error || !Array.isArray(list.data)) return null
    const ids = selectPrefetch(list.data as { id: string; date: string | null }[], today)
    // Os próximos que já estavam guardados (abertos à mão: sem data, mais longe) também se refrescam
    const saved = await listConcerts(userId)
    for (const e of saved) {
      if (ids.length >= PREFETCH_MAX * 2) break
      if (!ids.includes(e.setlistId) && (e.date === null || e.date >= ymd(today))) ids.push(e.setlistId)
    }
    const legacy = legacyIds().filter(id => !ids.includes(id))
    void fetchTheme(userId)
    let n = 0
    for (const id of [...ids, ...legacy]) {
      const r = await fetchConcert(userId, id)
      // Sem rede a meio: pára sem marcar a volta como feita (retoma quando a rede voltar)
      if (r.status === 'offline') return n
      if (r.status === 'ok') n++
    }
    dropLegacyCache()
    setLastRun(userId, Date.now())
    return n
  })().catch(() => null).finally(() => { running = null })
  return running
}

// ── Ordem por enviar ─────────────────────────────────────────────────────────
/** 'stale' = já não é a ordem pendente (enviada por outro caminho, ou há uma mais recente) */
export type SendResult = 'sent' | 'offline' | 'failed' | 'stale'
let orderChain: Promise<unknown> = Promise.resolve()

/**
 * Envia uma ordem (ids de setlist_songs). Em série com qualquer outro envio.
 * Sobre as linhas que o servidor tem AGORA: as que a ordem não conhece
 * (acrescentadas por outro membro) ficam no fim. Duas fases por causa do
 * unique(setlist_id, position): afasta tudo (10000+i), depois assenta (i).
 * 'offline' = fica pendente; 'failed' = recusada (deixa de estar pendente).
 */
export function sendOrder(userId: string, setlistId: string, ids: string[]): Promise<SendResult> {
  const job = orderChain.then(async (): Promise<SendResult> => {
    const still = await getPendingOrder(userId, setlistId)
    if (!still || still.ids.join(',') !== ids.join(',')) return 'stale'
    const cur = await runQuery(
      supabase.from('setlist_songs').select('id, setlist_id, song_id, position').eq('setlist_id', setlistId).order('position'),
      10000,
    )
    if (cur.network || cur.status >= 500) return 'offline'
    if (cur.error || !Array.isArray(cur.data)) {
      await clearPendingOrder(userId, setlistId, ids)
      return 'failed'
    }
    const server = cur.data as { id: string; setlist_id: string; song_id: string; position: number }[]
    const order = applyPendingOrder(server, ids)
    const needsWrite = !sameOrder(server, order.map(r => r.id)) || server.some((r, i) => r.position !== i)
    if (needsWrite) {
      const rows = (offset: number) => order.map((r, i) => ({ id: r.id, setlist_id: r.setlist_id, song_id: r.song_id, position: offset + i }))
      for (const offset of [10000, 0]) {
        const w = await runQuery(supabase.from('setlist_songs').upsert(rows(offset), { onConflict: 'id' }), 10000)
        // A meio (10000+): a próxima tentativa repete as duas fases
        if (w.network || w.status >= 500) return 'offline'
        if (w.error) {
          await clearPendingOrder(userId, setlistId, ids)
          return 'failed'
        }
      }
    }
    await clearPendingOrder(userId, setlistId, ids)
    return 'sent'
  })
  orderChain = job.catch(() => undefined)
  return job.catch(() => 'offline' as const)
}

/**
 * Antes de terminar a sessão: tenta enviar as ordens por enviar e devolve os
 * nomes dos concertos cuja ordem nova AINDA não foi enviada (perde-se ao
 * terminar a sessão — quem chama avisa no diálogo)
 */
export async function unsentOrdersBeforeSignOut(userId: string): Promise<string[]> {
  try {
    await Promise.race([flushPendingOrders(userId), new Promise(r => setTimeout(r, 8000))])
  } catch { /* fica por enviar */ }
  const names: string[] = []
  for (const p of await listPendingOrders(userId).catch(() => [])) {
    names.push((await loadConcert(userId, p.setlistId).catch(() => null))?.setlist.name || 'um concerto')
  }
  return names
}

/** Envia todas as ordens pendentes deste utilizador (ao arrancar, quando a rede volta) */
export async function flushPendingOrders(userId: string): Promise<{ setlistId: string; result: SendResult }[]> {
  if (isLikelyOffline()) return []
  const out: { setlistId: string; result: SendResult }[] = []
  for (const p of await listPendingOrders(userId)) {
    const result = await sendOrder(userId, p.setlistId, p.ids)
    out.push({ setlistId: p.setlistId, result })
    if (result === 'offline') break
  }
  return out
}
