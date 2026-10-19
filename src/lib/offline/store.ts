/**
 * Concertos guardados neste aparelho, por utilizador (IndexedDB, ver idb.ts).
 *
 *   u:<user>:concert:<setlist>  cópia completa do concerto (OfflineConcert)
 *   u:<user>:index              resumo dos guardados (listas sem rede)
 *   u:<user>:theme              profiles.concert_theme
 *   u:<user>:order:<setlist>    ordem mudada sem rede, por enviar
 *
 * Tudo o que se lê é validado contra o utilizador pedido (nunca se mostra a
 * cópia de outro). Terminar a sessão apaga tudo (clearOfflineData); entrar
 * com outro utilizador apaga o que não é dele (keepOnlyUser).
 */
import { idbDel, idbDelPrefix, idbEntries, idbGet, idbKeys, idbSet } from './idb'
import {
  concertKey, indexKey, indexEntryOf, keyUser, orderKey, orderPrefix, parseConcert, parseIndex,
  parsePendingOrder, pruneIndex, themeKey, upsertIndex, userPrefix,
  type OfflineConcert, type OfflineIndexEntry, type PendingOrder,
} from './logic'

// ── Avisos para a interface ("guardado às…") ───────────────────────────────
const listeners = new Set<(setlistId: string | null) => void>()
export function onOfflineChange(fn: (setlistId: string | null) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function changed(setlistId: string | null) {
  listeners.forEach(fn => { try { fn(setlistId) } catch { /* */ } })
}

// ── Memória desta sessão: abrir o palco a seguir à página do concerto é instantâneo
const recent = new Map<string, OfflineConcert>()
const RECENT_MAX = 6
function remember(c: OfflineConcert) {
  const k = concertKey(c.userId, c.setlistId)
  recent.delete(k)
  recent.set(k, c)
  if (recent.size > RECENT_MAX) {
    const first = recent.keys().next()
    if (!first.done) recent.delete(first.value)
  }
}

/** A cópia já lida/gravada nesta sessão (síncrono — o 1.º render já a tem) */
export function peekConcert(userId: string, setlistId: string): OfflineConcert | null {
  return recent.get(concertKey(userId, setlistId)) ?? null
}

/**
 * Depois de "Terminar sessão" nada volta a ser gravado (um prefetch a meio
 * não pode repor o que se apagou) até alguém entrar de novo (thawOffline)
 */
let frozen = false
export function thawOffline() { frozen = false }

// Escritas no índice em série (ler → mudar → gravar)
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn)
  chain = p.then(() => undefined, () => undefined)
  return p
}

let persistAsked = false
/** Pede ao browser para não apagar a cache sozinho (Safari 17+, Chrome) — sem bloquear */
function askPersist() {
  if (persistAsked) return
  persistAsked = true
  try {
    const s = (navigator as Navigator & { storage?: { persist?: () => Promise<boolean> } }).storage
    s?.persist?.().catch(() => false)
  } catch { /* sem API */ }
}

export async function loadConcert(userId: string, setlistId: string): Promise<OfflineConcert | null> {
  const c = parseConcert(await idbGet(concertKey(userId, setlistId)), userId, setlistId)
  if (c) remember(c)
  return c ?? peekConcert(userId, setlistId)
}

async function readIndex(userId: string): Promise<OfflineIndexEntry[]> {
  return parseIndex(await idbGet(indexKey(userId)))
}

/** Concertos guardados deste utilizador (resumo; ordenar com sortIndex) */
export async function listConcerts(userId: string): Promise<OfflineIndexEntry[]> {
  return readIndex(userId)
}

/**
 * Grava (ou substitui) a cópia de um concerto e poda: ficam os próximos e os
 * últimos usados; os passados há mais de 30 dias saem. `used` = aberto agora.
 */
export function saveConcert(c: OfflineConcert, opts: { used?: boolean } = {}): Promise<void> {
  if (frozen) return Promise.resolve()
  remember(c)
  return serial(async () => {
    if (frozen) return
    await idbSet(concertKey(c.userId, c.setlistId), c)
    const entries = await readIndex(c.userId)
    const prev = entries.find(e => e.setlistId === c.setlistId)
    const usedAt = opts.used ? Date.now() : prev?.usedAt ?? c.savedAt
    const { keep, drop } = pruneIndex(upsertIndex(entries, indexEntryOf(c, usedAt)), new Date())
    await idbSet(indexKey(c.userId), keep)
    for (const sid of drop) {
      // Este mesmo pode sair (passado há mais de 30 dias): fica só na memória desta sessão
      if (sid !== c.setlistId) recent.delete(concertKey(c.userId, sid))
      await idbDel(concertKey(c.userId, sid))
    }
    askPersist()
  }).then(() => changed(c.setlistId), () => changed(c.setlistId))
}

/** Muda a cópia guardada (ex.: tom/notas gravados, ordem nova) sem ir à rede */
export function patchConcert(userId: string, setlistId: string, fn: (c: OfflineConcert) => OfflineConcert): Promise<void> {
  if (frozen) return Promise.resolve()
  return serial(async () => {
    if (frozen) return
    const cur = parseConcert(await idbGet(concertKey(userId, setlistId)), userId, setlistId) ?? peekConcert(userId, setlistId)
    if (!cur) return
    const next = fn(cur)
    remember(next)
    await idbSet(concertKey(userId, setlistId), next)
    const entries = await readIndex(userId)
    const prev = entries.find(e => e.setlistId === setlistId)
    await idbSet(indexKey(userId), upsertIndex(entries, indexEntryOf(next, prev?.usedAt ?? next.savedAt)))
  }).then(() => changed(setlistId), () => changed(setlistId))
}

/** Marca como aberto agora (conta para "os últimos usados" na poda) */
export function touchConcert(userId: string, setlistId: string): Promise<void> {
  return serial(async () => {
    const entries = await readIndex(userId)
    const prev = entries.find(e => e.setlistId === setlistId)
    if (!prev) return
    await idbSet(indexKey(userId), upsertIndex(entries, { ...prev, usedAt: Date.now() }))
  }).catch(() => undefined)
}

/** O servidor diz que o concerto já não existe (ou deixou de ter acesso): sai da cache */
export function forgetConcert(userId: string, setlistId: string): Promise<void> {
  recent.delete(concertKey(userId, setlistId))
  return serial(async () => {
    await idbDel(concertKey(userId, setlistId))
    await idbDel(orderKey(userId, setlistId))
    const entries = await readIndex(userId)
    await idbSet(indexKey(userId), entries.filter(e => e.setlistId !== setlistId))
  }).then(() => changed(setlistId), () => changed(setlistId))
}

// ── Tema do palco ────────────────────────────────────────────────────────────
export async function saveTheme(userId: string, theme: unknown): Promise<void> {
  if (frozen) return
  if (theme && typeof theme === 'object') await idbSet(themeKey(userId), { userId, theme })
}
export async function loadTheme(userId: string): Promise<Record<string, unknown> | null> {
  const raw = await idbGet<{ userId?: string; theme?: unknown }>(themeKey(userId))
  return raw && raw.userId === userId && raw.theme && typeof raw.theme === 'object'
    ? raw.theme as Record<string, unknown>
    : null
}

// ── Ordem por enviar ─────────────────────────────────────────────────────────
export async function getPendingOrder(userId: string, setlistId: string): Promise<PendingOrder | null> {
  return parsePendingOrder(await idbGet(orderKey(userId, setlistId)), userId, setlistId)
}
export async function setPendingOrder(userId: string, setlistId: string, ids: string[]): Promise<void> {
  if (frozen) return
  const p: PendingOrder = { userId, setlistId, ids, at: Date.now() }
  await idbSet(orderKey(userId, setlistId), p)
  changed(setlistId)
}
/** Apaga a ordem pendente — só se ainda for esta (uma mais recente fica) */
export async function clearPendingOrder(userId: string, setlistId: string, ids?: string[]): Promise<void> {
  if (ids) {
    const cur = await getPendingOrder(userId, setlistId)
    if (cur && cur.ids.join(',') !== ids.join(',')) return
  }
  await idbDel(orderKey(userId, setlistId))
  changed(setlistId)
}
export async function listPendingOrders(userId: string): Promise<PendingOrder[]> {
  const out: PendingOrder[] = []
  for (const [k, v] of await idbEntries(orderPrefix(userId))) {
    const sid = k.slice(orderPrefix(userId).length)
    const p = parsePendingOrder(v, userId, sid)
    if (p) out.push(p)
  }
  return out
}

// ── Privacidade ──────────────────────────────────────────────────────────────
/** Terminar sessão: apaga as cópias de todos os utilizadores neste aparelho */
export async function clearOfflineData(): Promise<void> {
  frozen = true
  recent.clear()
  // Depois das escritas que já estavam na fila
  await serial(() => idbDelPrefix(''))
  changed(null)
}

/** Entrou outro utilizador: apaga o que ficou de outros (sessão que expirou sem "Terminar sessão") */
export async function keepOnlyUser(userId: string): Promise<void> {
  const mine = userPrefix(userId)
  const others = new Set<string>()
  for (const k of await idbKeys('u:')) {
    if (!k.startsWith(mine)) {
      const u = keyUser(k)
      if (u) others.add(u)
    }
  }
  for (const u of others) await idbDelPrefix(userPrefix(u))
  recent.forEach((_c, k) => { if (!k.startsWith(mine)) recent.delete(k) })
}
