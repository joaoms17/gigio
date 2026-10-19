/**
 * Chave → valor mínimo sobre o IndexedDB (sem dependências). Uma só base
 * ('gigio-offline') com um só armazém ('kv'); as chaves têm prefixo por
 * utilizador ('u:<id>:…', ver logic.ts) e os valores são objetos simples
 * (clonados pelo próprio IndexedDB — sem structuredClone).
 *
 * Safari/iPadOS 15+:
 *  - abrir pode ficar pendurado (WebKit antigo) → desiste ao fim de
 *    OPEN_TIMEOUT_MS e usa a memória;
 *  - depois de a app estar suspensa, as transações falham com "Connection to
 *    Indexed Database server lost" → fecha, reabre e repete UMA vez;
 *  - navegação privada / armazenamento bloqueado → memória (só esta sessão).
 * Nenhuma função lança: as leituras falhadas devolvem null/[] e as escritas
 * falhadas ficam na memória desta sessão.
 */

const DB_NAME = 'gigio-offline'
const DB_VERSION = 1
const STORE = 'kv'
const OPEN_TIMEOUT_MS = 2500

/** Sem IndexedDB (ou depois de ele falhar): o que se escreveu nesta sessão */
const memory = new Map<string, unknown>()
let dbPromise: Promise<IDBDatabase | null> | null = null
/** O IndexedDB não abriu: não voltar a tentar nesta sessão (cada tentativa custava o timeout) */
let idbBroken = false

function hasIdb(): boolean {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB } catch { return false }
}

function openDb(): Promise<IDBDatabase | null> {
  if (idbBroken || !hasIdb()) return Promise.resolve(null)
  return new Promise(resolve => {
    let settled = false
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        // Abriu depois de se ter desistido: não fica uma ligação órfã
        try { db?.close() } catch { /* já fechada */ }
        return
      }
      settled = true
      clearTimeout(timer)
      if (!db) idbBroken = true
      resolve(db)
    }
    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      finish(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      // Outra versão da app quer atualizar a base: larga a ligação
      db.onversionchange = () => { try { db.close() } catch { /* */ } dbPromise = null }
      ;(db as IDBDatabase & { onclose: (() => void) | null }).onclose = () => { dbPromise = null }
      finish(db)
    }
    req.onerror = () => finish(null)
    // onblocked: espera — o timeout decide
  })
}

function getDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDb()
  return dbPromise
}

function resetDb() {
  const p = dbPromise
  dbPromise = null
  p?.then(db => { try { db?.close() } catch { /* */ } })
}

/**
 * Uma transação: `fn` faz os pedidos e devolve o que a transação resolve
 * (lido no oncomplete — o valor só conta se a transação terminou bem).
 */
function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    let read: () => T
    try {
      tx = db.transaction(STORE, mode)
      read = fn(tx.objectStore(STORE))
    } catch (e) {
      reject(e)
      return
    }
    tx.oncomplete = () => resolve(read())
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: erro'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: abortada'))
  })
}

/** Com o IndexedDB; uma falha (ligação perdida no iOS) reabre e repete uma vez */
async function withDb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => () => T): Promise<{ ok: true; value: T } | { ok: false }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await getDb()
    if (!db) return { ok: false }
    try {
      return { ok: true, value: await run(db, mode, fn) }
    } catch {
      resetDb()
    }
  }
  return { ok: false }
}

function rangeOf(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, prefix + '￿')
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const r = await withDb('readonly', store => {
    const req = store.get(key)
    return () => req.result as T | undefined
  })
  if (r.ok && r.value !== undefined) return r.value
  return memory.has(key) ? (memory.get(key) as T) : null
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const r = await withDb('readwrite', store => {
    store.put(value, key)
    return () => true
  })
  if (r.ok) {
    memory.delete(key)
    return true
  }
  memory.set(key, value)
  return false
}

export async function idbDel(key: string): Promise<void> {
  memory.delete(key)
  await withDb('readwrite', store => {
    store.delete(key)
    return () => true
  })
}

/** Todas as entradas com este prefixo, por ordem de chave */
export async function idbEntries<T>(prefix: string): Promise<[string, T][]> {
  const r = await withDb('readonly', store => {
    const out: [string, T][] = []
    const req = store.openCursor(rangeOf(prefix))
    req.onsuccess = () => {
      const cur = req.result
      if (!cur) return
      out.push([String(cur.key), cur.value as T])
      cur.continue()
    }
    return () => out
  })
  const got = new Map<string, T>(r.ok ? r.value : [])
  memory.forEach((v, k) => { if (k.startsWith(prefix) && !got.has(k)) got.set(k, v as T) })
  return Array.from(got.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** Só as chaves com este prefixo (sem ler os valores — as cópias dos concertos são grandes) */
export async function idbKeys(prefix: string): Promise<string[]> {
  const r = await withDb('readonly', store => {
    const out: string[] = []
    const range = rangeOf(prefix)
    // openKeyCursor (Safari 10.1+); sem ele, um cursor normal
    const req = typeof store.openKeyCursor === 'function' ? store.openKeyCursor(range) : store.openCursor(range)
    req.onsuccess = () => {
      const cur = req.result
      if (!cur) return
      out.push(String(cur.key))
      cur.continue()
    }
    return () => out
  })
  const keys = new Set<string>(r.ok ? r.value : [])
  memory.forEach((_v, k) => { if (k.startsWith(prefix)) keys.add(k) })
  return Array.from(keys).sort()
}

/** Apaga tudo o que começa por este prefixo ('' = tudo) */
export async function idbDelPrefix(prefix: string): Promise<void> {
  memory.forEach((_v, k) => { if (k.startsWith(prefix)) memory.delete(k) })
  await withDb('readwrite', store => {
    if (prefix) store.delete(rangeOf(prefix))
    else store.clear()
    return () => true
  })
}

/** O IndexedDB está a funcionar (false = só memória nesta sessão) */
export async function idbAvailable(): Promise<boolean> {
  return !!(await getDb())
}
