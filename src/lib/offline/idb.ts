/**
 * Chave → valor mínimo sobre o IndexedDB (sem dependências). Uma só base
 * ('gigio-offline') com um só armazém ('kv'); as chaves têm prefixo por
 * utilizador ('u:<id>:…', ver logic.ts) e os valores são objetos simples
 * (clonados pelo próprio IndexedDB — sem structuredClone).
 *
 * Safari/iPadOS 15+:
 *  - abrir pode demorar (arranque a frio) ou ficar pendurado (WebKit antigo):
 *    espera-se OPEN_WAIT_MS e, enquanto não abre, usa-se a memória — mas o
 *    pedido de abertura continua: quando a base abre, o que ficou na memória
 *    entretanto é gravado nela e avisa-se quem lê (onIdbReady), para a
 *    interface voltar a ler a cópia. Nunca fica "sem cópia" a sessão toda;
 *  - depois de a app estar suspensa, as transações falham com "Connection to
 *    Indexed Database server lost" → fecha, reabre e repete UMA vez; uma
 *    transação que não termina (sem complete/error/abort) desiste ao fim de
 *    TX_TIMEOUT_MS e conta como falhada (a fila de escritas nunca fica presa);
 *  - navegação privada / armazenamento bloqueado → memória (só esta sessão).
 * Nenhuma função lança: as leituras falhadas devolvem null/[] e as escritas
 * falhadas ficam na memória desta sessão (gravadas quando a base abrir).
 */

const DB_NAME = 'gigio-offline'
const DB_VERSION = 1
const STORE = 'kv'
/** 1.ª espera pela abertura; com a abertura ainda a decorrer, as seguintes esperam só SLOW_WAIT_MS */
const OPEN_WAIT_MS = 2500
const SLOW_WAIT_MS = 250
const TX_TIMEOUT_MS = 5000

/** Sem IndexedDB (ou enquanto ele não abre): o que se escreveu nesta sessão */
const memory = new Map<string, unknown>()
/** Apagados enquanto o IndexedDB não estava disponível (aplicados quando abrir) */
const deletedKeys = new Set<string>()
const deletedPrefixes = new Set<string>()

let db: IDBDatabase | null = null
/** Abertura em curso — sem limite de tempo (quem espera é que desiste, ver getDb) */
let opening: Promise<IDBDatabase | null> | null = null
/** Alguém desistiu de esperar pela abertura em curso (lenta / pendurada) */
let slow = false
/** O IndexedDB deu erro a abrir (não é lentidão): não voltar a tentar nesta sessão */
let idbBroken = false

const readyListeners = new Set<() => void>()
/** A base abriu depois de alguém ter desistido de esperar: quem mostra cópias volta a lê-las */
export function onIdbReady(fn: () => void): () => void {
  readyListeners.add(fn)
  return () => { readyListeners.delete(fn) }
}

function hasIdb(): boolean {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB } catch { return false }
}

function rangeOf(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, prefix + '￿')
}

function isDeleted(key: string): boolean {
  if (deletedKeys.has(key)) return true
  for (const p of deletedPrefixes) if (key.startsWith(p)) return true
  return false
}

function openRaw(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      const d = req.result
      const lost = () => {
        if (db === d) { db = null; opening = null }
      }
      // Outra versão da app quer atualizar a base: larga a ligação
      d.onversionchange = () => { try { d.close() } catch { /* */ } lost() }
      ;(d as IDBDatabase & { onclose: (() => void) | null }).onclose = lost
      resolve(d)
    }
    req.onerror = () => resolve(null)
    // onblocked: espera — quem chama não fica à espera (ver getDb)
  })
}

const pendingWrites = () => memory.size > 0 || deletedKeys.size > 0 || deletedPrefixes.size > 0

/** O que ficou na memória (e os apagados) enquanto a base não abria → para a base. false = falhou */
function flushMemory(d: IDBDatabase): Promise<boolean> {
  if (!pendingWrites()) return Promise.resolve(true)
  const entries = Array.from(memory.entries())
  const keys = Array.from(deletedKeys)
  const prefixes = Array.from(deletedPrefixes)
  return run(d, 'readwrite', store => {
    // Primeiro os apagados (o que está na memória é sempre mais recente)
    for (const p of prefixes) {
      if (p) store.delete(rangeOf(p))
      else store.clear()
    }
    for (const k of keys) store.delete(k)
    for (const [k, v] of entries) store.put(v, k)
    return () => true
  }).then(() => {
    // Só o que foi gravado (uma escrita nova entretanto fica para a próxima)
    for (const [k, v] of entries) if (memory.get(k) === v) memory.delete(k)
    keys.forEach(k => deletedKeys.delete(k))
    prefixes.forEach(p => deletedPrefixes.delete(p))
    return true
  }, () => false)
}

function getDb(): Promise<IDBDatabase | null> {
  if (db) return Promise.resolve(db)
  if (idbBroken || !hasIdb()) return Promise.resolve(null)
  if (!opening) {
    opening = openRaw().then(async d => {
      if (!d) {
        idbBroken = true
        opening = null
        return null
      }
      // Sem conseguir gravar o que está na memória, a base não serve (os
      // apagados por aplicar esconderiam o que se gravasse): a próxima chamada reabre
      if (!(await flushMemory(d))) {
        try { d.close() } catch { /* */ }
        opening = null
        return null
      }
      db = d
      // Escrito na memória durante a gravação acima
      if (pendingWrites()) void flushMemory(d)
      if (slow) {
        slow = false
        readyListeners.forEach(fn => { try { fn() } catch { /* */ } })
      }
      return d
    })
  }
  const pending = opening
  return new Promise(resolve => {
    const timer = setTimeout(() => { slow = true; resolve(null) }, slow ? SLOW_WAIT_MS : OPEN_WAIT_MS)
    pending.then(d => { clearTimeout(timer); resolve(d) })
  })
}

function resetDb() {
  const d = db
  db = null
  opening = null
  try { d?.close() } catch { /* */ }
}

/**
 * Uma transação: `fn` faz os pedidos e devolve o que a transação resolve
 * (lido no oncomplete — o valor só conta se a transação terminou bem).
 */
function run<T>(d: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    let read: () => T
    try {
      tx = d.transaction(STORE, mode)
      read = fn(tx.objectStore(STORE))
    } catch (e) {
      reject(e)
      return
    }
    const timer = setTimeout(() => {
      try { tx.abort() } catch { /* já terminou */ }
      reject(new Error('IndexedDB: tempo esgotado'))
    }, TX_TIMEOUT_MS)
    tx.oncomplete = () => { clearTimeout(timer); resolve(read()) }
    tx.onerror = () => { clearTimeout(timer); reject(tx.error ?? new Error('IndexedDB: erro')) }
    tx.onabort = () => { clearTimeout(timer); reject(tx.error ?? new Error('IndexedDB: abortada')) }
  })
}

/** Com o IndexedDB; uma falha (ligação perdida no iOS, transação pendurada) reabre e repete uma vez */
async function withDb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => () => T): Promise<{ ok: true; value: T } | { ok: false }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const d = await getDb()
    if (!d) return { ok: false }
    try {
      return { ok: true, value: await run(d, mode, fn) }
    } catch {
      resetDb()
    }
  }
  return { ok: false }
}

/**
 * Lê uma chave. `reliable` = false quando o IndexedDB ainda está a abrir (ou
 * a transação falhou): "não há" pode querer dizer só "ainda não se sabe"
 */
export async function idbRead<T>(key: string): Promise<{ value: T | null; reliable: boolean }> {
  // A memória tem o que foi escrito depois (e ainda não chegou à base)
  if (memory.has(key)) return { value: memory.get(key) as T, reliable: true }
  const r = await withDb('readonly', store => {
    const req = store.get(key)
    return () => req.result as T | undefined
  })
  if (memory.has(key)) return { value: memory.get(key) as T, reliable: true }
  // Sem IndexedDB de todo (navegação privada, erro): a memória é tudo o que há — é de confiança
  if (!r.ok) return { value: null, reliable: idbStatus() === 'unavailable' }
  return { value: r.value === undefined || isDeleted(key) ? null : r.value, reliable: true }
}

export async function idbGet<T>(key: string): Promise<T | null> {
  return (await idbRead<T>(key)).value
}

/** Só o que está mesmo no IndexedDB (sem a memória): ok = false se ele não está disponível */
export async function idbGetStored<T>(key: string): Promise<{ ok: boolean; value: T | null }> {
  const r = await withDb('readonly', store => {
    const req = store.get(key)
    return () => req.result as T | undefined
  })
  if (!r.ok) return { ok: false, value: null }
  return { ok: true, value: r.value === undefined || isDeleted(key) ? null : r.value }
}

/** true = ficou no IndexedDB; false = só na memória desta sessão (gravada quando a base abrir) */
export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const r = await withDb('readwrite', store => {
    store.put(value, key)
    return () => true
  })
  if (r.ok) {
    memory.delete(key)
    deletedKeys.delete(key)
    return true
  }
  memory.set(key, value)
  return false
}

export async function idbDel(key: string): Promise<void> {
  memory.delete(key)
  const r = await withDb('readwrite', store => {
    store.delete(key)
    return () => true
  })
  if (!r.ok) deletedKeys.add(key)
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
  const got = new Map<string, T>(r.ok ? r.value.filter(([k]) => !isDeleted(k)) : [])
  memory.forEach((v, k) => { if (k.startsWith(prefix)) got.set(k, v as T) })
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
  const keys = new Set<string>(r.ok ? r.value.filter(k => !isDeleted(k)) : [])
  memory.forEach((_v, k) => { if (k.startsWith(prefix)) keys.add(k) })
  return Array.from(keys).sort()
}

/** Apaga tudo o que começa por este prefixo ('' = tudo) */
export async function idbDelPrefix(prefix: string): Promise<void> {
  memory.forEach((_v, k) => { if (k.startsWith(prefix)) memory.delete(k) })
  const r = await withDb('readwrite', store => {
    if (prefix) store.delete(rangeOf(prefix))
    else store.clear()
    return () => true
  })
  if (!r.ok) deletedPrefixes.add(prefix)
}

/** Estado do IndexedDB agora: 'opening' = ainda a abrir (arranque lento); 'unavailable' = não há / falhou */
export function idbStatus(): 'ready' | 'opening' | 'unavailable' {
  if (db) return 'ready'
  if (idbBroken || !hasIdb()) return 'unavailable'
  return 'opening'
}

/** O IndexedDB está a funcionar (false = só memória, por agora) */
export async function idbAvailable(): Promise<boolean> {
  return !!(await getDb())
}
