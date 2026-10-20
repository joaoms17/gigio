/**
 * Concertos guardados neste aparelho, por utilizador (IndexedDB, ver idb.ts).
 *
 *   u:<user>:concert:<setlist>  cópia completa do concerto (OfflineConcert)
 *   u:<user>:index              resumo dos guardados (listas sem rede)
 *   u:<user>:theme              profiles.concert_theme
 *   u:<user>:order:<setlist>    ordem mudada sem rede, por enviar
 *
 * Tudo o que se lê é validado contra o utilizador pedido (nunca se mostra a
 * cópia de outro). Terminar a sessão apaga as cópias (clearOfflineData);
 * entrar com outro utilizador apaga as cópias que não são dele
 * (keepOnlyUser). As ordens por enviar de OUTROS utilizadores ficam (só têm
 * ids; seguem quando esse utilizador voltar a entrar) — as do próprio, ao
 * terminar a sessão, saem depois de ele ser avisado (pendingOrdersWarning).
 */
import { idbDel, idbDelPrefix, idbEntries, idbGet, idbGetStored, idbKeys, idbRead, idbSet, onIdbReady } from './idb'
import {
  applySongChange, concertKey, indexKey, indexEntryOf, keyUser, orderKey, orderPrefix, parseConcert, parseIndex,
  parsePendingOrder, pruneIndex, themeKey, upsertIndex, userPrefix,
  type OfflineConcert, type OfflineIndexEntry, type PendingOrder, type SongChange,
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
// O IndexedDB abriu tarde (arranque a frio lento): quem mostra cópias volta a lê-las
onIdbReady(() => changed(null))

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
  return (await readConcert(userId, setlistId)).concert
}

/**
 * Como loadConcert, mas diz se a resposta é de confiança: `checked` = false
 * quando o IndexedDB ainda não abriu (ou falhou) — "não há cópia" pode ser só
 * "ainda não se sabe" (o palco espera por onOfflineChange e volta a ler)
 */
export async function readConcert(userId: string, setlistId: string): Promise<{ concert: OfflineConcert | null; checked: boolean }> {
  const r = await idbRead(concertKey(userId, setlistId))
  const c = parseConcert(r.value, userId, setlistId)
  if (c) remember(c)
  const concert = c ?? peekConcert(userId, setlistId)
  return { concert, checked: r.reliable || !!concert }
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
 * últimos usados; os passados há mais de 30 dias saem (a menos que tenham
 * sido abertos há menos do que isso). `used` = aberto agora à mão — esse
 * nunca sai na poda. Devolve true só se a cópia ficou MESMO guardada neste
 * aparelho (IndexedDB): false = só na memória desta sessão (navegação
 * privada, IndexedDB bloqueado ou ainda a abrir) ou podada — a interface
 * nunca diz "Disponível offline" sem isto.
 */
export function saveConcert(c: OfflineConcert, opts: { used?: boolean } = {}): Promise<boolean> {
  if (frozen) return Promise.resolve(false)
  remember(c)
  return serial(async () => {
    if (frozen) return false
    const savedCopy = await idbSet(concertKey(c.userId, c.setlistId), c)
    const entries = await readIndex(c.userId)
    const prev = entries.find(e => e.setlistId === c.setlistId)
    const now = Date.now()
    const usedAt = opts.used ? now : prev?.usedAt ?? c.savedAt
    const openedAt = opts.used ? now : prev?.openedAt
    const { keep, drop } = pruneIndex(
      upsertIndex(entries, indexEntryOf(c, usedAt, openedAt)), new Date(), opts.used ? c.setlistId : undefined,
    )
    const savedIndex = await idbSet(indexKey(c.userId), keep)
    for (const sid of drop) {
      // Este mesmo pode sair (passado, nunca aberto à mão): fica só na memória desta sessão
      if (sid !== c.setlistId) recent.delete(concertKey(c.userId, sid))
      await idbDel(concertKey(c.userId, sid))
    }
    askPersist()
    return savedCopy && savedIndex && !drop.includes(c.setlistId)
  }).then(ok => { changed(c.setlistId); return ok }, () => { changed(c.setlistId); return false })
}

/**
 * Quando ficou guardada a cópia que está MESMO neste aparelho (IndexedDB;
 * nada da memória da sessão): null = não há (ou o IndexedDB não está a funcionar)
 */
export async function storedSavedAt(userId: string, setlistId: string): Promise<number | null> {
  const idx = await idbGetStored(indexKey(userId))
  if (!idx.ok) return null
  const e = parseIndex(idx.value).find(x => x.setlistId === setlistId)
  if (!e) return null
  const copy = await idbGetStored(concertKey(userId, setlistId))
  const c = copy.ok ? parseConcert(copy.value, userId, setlistId) : null
  return c ? c.savedAt : null
}

/** Muda a cópia guardada (ex.: tom/notas gravados, ordem nova) sem ir à rede */
export function patchConcert(userId: string, setlistId: string, fn: (c: OfflineConcert) => OfflineConcert | null): Promise<void> {
  if (frozen) return Promise.resolve()
  return serial(async () => {
    if (frozen) return false
    const cur = parseConcert(await idbGet(concertKey(userId, setlistId)), userId, setlistId) ?? peekConcert(userId, setlistId)
    if (!cur) return false
    const next = fn(cur)
    if (!next) return false
    remember(next)
    await idbSet(concertKey(userId, setlistId), next)
    const entries = await readIndex(userId)
    const prev = entries.find(e => e.setlistId === setlistId)
    // Podado entretanto: não volta ao índice
    if (prev) await idbSet(indexKey(userId), upsertIndex(entries, indexEntryOf(next, prev.usedAt, prev.openedAt)))
    return true
  }).then(did => { if (did) changed(setlistId) }, () => changed(setlistId))
}

/**
 * Uma música mudou fora do concerto (página da música, editor de
 * sincronização): as cópias que a têm ficam iguais — o palco sem rede nunca
 * mostra a letra de antes. Devolve quantas cópias mudaram.
 */
export async function patchSongInCopies(userId: string, songId: string, change: SongChange): Promise<number> {
  if (frozen) return 0
  let n = 0
  const entries = await readIndex(userId).catch(() => [] as OfflineIndexEntry[])
  // Sem songIds (índice de uma versão anterior): vê-se a cópia
  const candidates = entries.filter(e => !e.songIds || e.songIds.includes(songId)).map(e => e.setlistId)
  recent.forEach(c => { if (c.userId === userId && !candidates.includes(c.setlistId)) candidates.push(c.setlistId) })
  for (const sid of candidates) {
    let did = false
    await patchConcert(userId, sid, c => {
      const next = applySongChange(c, songId, change)
      did = !!next
      return next
    })
    if (did) n++
  }
  return n
}

/** Marca como aberto agora (conta para "os últimos usados" e para a poda dos passados) */
export function touchConcert(userId: string, setlistId: string): Promise<void> {
  return serial(async () => {
    const entries = await readIndex(userId)
    const prev = entries.find(e => e.setlistId === setlistId)
    if (!prev) return
    const now = Date.now()
    await idbSet(indexKey(userId), upsertIndex(entries, { ...prev, usedAt: now, openedAt: now }))
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
const isOrderKey = (k: string) => k.includes(':order:')

/**
 * Terminar sessão: apaga as cópias de todos os utilizadores neste aparelho e
 * as ordens por enviar de `userId` (quem chama já o avisou). As ordens por
 * enviar de OUTROS utilizadores ficam (só ids, seguem quando eles entrarem).
 */
export async function clearOfflineData(userId?: string): Promise<void> {
  frozen = true
  recent.clear()
  // Depois das escritas que já estavam na fila
  await serial(async () => {
    const keys = await idbKeys('')
    const keepOthers = keys.filter(k => isOrderKey(k) && (!userId || keyUser(k) !== userId))
    if (keepOthers.length === 0) {
      await idbDelPrefix('')
      return
    }
    for (const k of keys) if (!keepOthers.includes(k)) await idbDel(k)
  })
  changed(null)
}

/**
 * Entrou outro utilizador: apaga as cópias que ficaram de outros (sessão que
 * expirou sem "Terminar sessão"). As ordens deles por enviar ficam.
 */
export async function keepOnlyUser(userId: string): Promise<void> {
  const mine = userPrefix(userId)
  for (const k of await idbKeys('u:')) {
    if (!k.startsWith(mine) && keyUser(k) && !isOrderKey(k)) await idbDel(k)
  }
  recent.forEach((_c, k) => { if (!k.startsWith(mine)) recent.delete(k) })
}
