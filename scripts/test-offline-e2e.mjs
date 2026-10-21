/**
 * Teste end-to-end do CONCERTO SEM REDE, no Chromium, com o build de
 * Supabase fictício, o service worker A SÉRIO (perfil persistente) e os
 * mocks de scripts/visual-shots.mjs.
 *
 * Um concerto novo ("Arraial da Ribeira", daqui a 3 dias) que NUNCA é aberto
 * com rede — só o guardar em segundo plano o leva para o aparelho — com tudo
 * o que o palco usa: ordem, títulos, tons (com transposição dos acordes),
 * intro e nota do concerto, letra editada, sincronização, anotações e
 * destaques do Ensaio (os da cloud e os deste aparelho) e o tema do palco.
 *
 *   O1 Com rede: entrar, Projetos e Concertos → o SW fica ativo e a controlar a
 *      página, e os próximos concertos ficam no IndexedDB sem abrir nenhum.
 *   O2 Arranque a frio sem rede (app fechada, modo avião, servidor em baixo)
 *      em '/' → Concertos → o concerto → modo concerto (iPad e telemóvel).
 *   O3 Arranque a frio sem rede direto em /setlist/<id>/concert (retoma a posição).
 *      O3b: sem rede, tocar na linha (editar a música), o atalho do tom/notas
 *      no telemóvel, "Editar letra" do painel no iPad deitado).
 *   O4 Sessão: token expirado + modo avião e + Wi-Fi sem internet (35 s) →
 *      nunca /auth; sem sessão nenhuma → /auth.
 *   O5 A rede cai a meio do concerto: avançar (incluindo a música com sync
 *      nunca pedida sozinha), reordenar, recarregar sem rede; a rede volta →
 *      nada se perdeu e a ordem é enviada. O5b: uma versão nova da app (SW)
 *      não recarrega o palco — só depois de sair dele.
 *   O6 Terminar sessão (sem rede) apaga a cópia; outro utilizador no mesmo
 *      browser não vê os concertos do primeiro (também quando a sessão do
 *      primeiro caiu sem "Terminar sessão").
 *   O7 Barra do modo concerto: sem "Depois" no telemóvel, no iPad ao alto e
 *      deitado; o "A seguir" com a música certa e alinhado.
 *   O8 Guardar em segundo plano interrompido a meio (a app fecha; a rede cai)
 *      e a app volta a abrir / a rede volta → os concertos que faltavam ficam
 *      guardados (perfil próprio, não precisa do O1). O8c: só um pedido falha
 *      (rede fraca) → a volta seguinte (sonda) guarda tudo.
 *   O9 Concerto com data passada há mais de 30 dias aberto com rede: fica
 *      guardado (e diz "Disponível offline" só porque ficou); com o IndexedDB
 *      bloqueado a página diz que este browser não deixa guardar.
 *   O10 IndexedDB lento a abrir (> 2,5 s): sem rede o palco chega à cópia
 *      (nunca fica "não guardado"); com rede, o que se guardou entretanto vai
 *      para o IndexedDB quando ele abre.
 *   O11 Sessão recusada pelo servidor a meio do concerto: o palco fica, o
 *      ecrã não apaga (wake lock) e aparece "Sem sessão".
 *   O12 Letra corrigida na página da música (com rede) → o palco sem rede
 *      mostra a letra nova (a cópia é atualizada e o guardar volta a correr).
 *   O13 Palco aberto sem rede num concerto não guardado: "Não guardado", com
 *      caminho para os guardados e ✕ sem confirmação; a rede volta → o
 *      concerto aparece sem sair do palco.
 *
 * Uso:
 *   node scripts/test-offline-e2e.mjs [pasta-das-capturas]
 *   (faz o build de mock antes, como scripts/shots.sh; E2E_NO_BUILD=1 usa o
 *    dist que existe; ONLY=O1,O7 corre só esses — O2…O6 precisam do O1,
 *    O7 a O13 não; E2E_VERBOSE=1 mostra também as que passam, com os tempos)
 * Saída: "N passaram, 0 falharam"; exit ≠ 0 se alguma asserção falhar.
 * Letras, títulos e nomes INVENTADOS.
 */
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { USER, SESSION, TABLES, DIST, restResponse, staticServer } from './visual-shots.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'shots/off-e2e'))
const PORT = 4227
const BASE = `http://localhost:${PORT}`
const EXE = '/opt/pw-browsers/chromium'
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const want = name => !ONLY || ONLY.includes(name)

const TABLET_PORT = { width: 820, height: 1180 }
const TABLET_LAND = { width: 1180, height: 820 }
const PHONE = { width: 390, height: 844 }

// ── Resultados ──────────────────────────────────────────────────────────────
let passed = 0
const failures = []
const VERBOSE = !!process.env.E2E_VERBOSE
function ok(cond, label, info) {
  if (cond) {
    passed++
    if (VERBOSE) console.log('  ok', label)
    return true
  }
  const msg = info === undefined ? label : `${label} — ${typeof info === 'string' ? info : JSON.stringify(info)}`
  failures.push(msg)
  console.log('  FALHOU', msg)
  return false
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
/** Espera (no Node) até fn() dar verdade; devolve o último valor */
async function until(fn, timeout = 5000, every = 150) {
  const t0 = Date.now()
  let v
  for (;;) {
    try { v = await fn() } catch { v = undefined }
    if (v || Date.now() - t0 > timeout) return v
    await sleep(every)
  }
}

// ── Anotações (formato v2, com o anchor.ts da app) ──────────────────────────
const tmpDirs = []
async function importAnchor() {
  const esbuild = createRequire(import.meta.url)(path.join(ROOT, 'node_modules/esbuild'))
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gigio-off-e2e-anchor-'))
  tmpDirs.push(dir)
  const file = path.join(dir, 'anchor.mjs')
  const src = readFileSync(path.join(ROOT, 'src/lib/annotations/anchor.ts'), 'utf8')
  writeFileSync(file, esbuild.transformSync(src, { loader: 'ts', format: 'esm', target: 'es2022' }).code)
  return import(pathToFileURL(file).href)
}
const A = await importAnchor()

// ── Fixtures: o concerto que só o guardar em segundo plano traz ─────────────
// Mesma conta de datas que visual-shots.mjs (UTC)
const d = days => new Date(Date.now() + days * 86400000).toISOString().split('T')[0]
const SID = 'sOff'
const OFF_NAME = 'Arraial da Ribeira'

const LYR = {
  sgO1: [
    '[Verso 1]',                                  // 0
    'As luzes da feira acendem devagar',          // 1  destaque (cloud) em "luzes"
    'O carrossel parou para descansar',           // 2  sublinhado (cloud) nos 1.os 11 caracteres
    'Há farturas quentes no balcão',              // 3
    'E a banda afina a última canção',            // 4
    '',
    '[Refrão]',
    'Dança comigo até o largo apagar',
    'Dança comigo que a noite está a acabar',
  ].join('\n'),
  sgO2: ['[Verso]', 'Roda a roda o carrossel de agosto', 'Versão antiga desta linha'].join('\n'),
  sgO2edit: ['[Verso]', 'Roda a roda o carrossel de agosto', 'Linha corrigida no ensaio de terça', 'Cavalos de madeira a brilhar ao sol'].join('\n'),
  sgO3: [
    '[Verso]',
    'Açúcar e canela na ponta dos dedos',
    'A fila dá a volta ao coreto',
    'Ninguém tem pressa de ir embora',
    '[Refrão]',
    'Mais uma volta, mais uma volta',
  ].join('\n'),
  sgO4: [
    '[Verso]',                                    // 0
    'Às onze em ponto o céu rebenta',             // 1  sublinhado (deste aparelho)
    'Chovem estrelas sobre o rio',                // 2  destaque (deste aparelho) em "estrelas"
    'E o largo inteiro fica a olhar',             // 3
  ].join('\n'),
  sgO5: ['[Final]', 'Arrumam-se as cadeiras no adro', 'Até para o ano, à mesma hora'].join('\n'),
}
const CHORDS_C = 'C   G   Am   F\nF   G   C'
const CHORDS_D = 'D   A   Bm   G\nG   A   D'

const OFF_SONGS = [
  // id, título, tom original, acordes, bpm, sync
  ['sgO1', 'Luzes da Feira', 'C', CHORDS_C, null, false],
  ['sgO2', 'Carrossel de Agosto', 'G', null, null, false],
  ['sgO3', 'Barraca das Farturas', 'Am', null, 96, true],
  ['sgO4', 'Fogo de Vista', 'E', null, null, false],
  ['sgO5', 'Última Volta', 'A', null, null, false],
].map(([id, title, key, chords, bpm, sync]) => ({
  ...TABLES.songs[0], id, title, artist: 'Banda da Ribeira', original_key: key, performance_key: null,
  lyrics: LYR[id], edited_lyrics: id === 'sgO2' ? LYR.sgO2edit : null, original_lyrics: null,
  chords, bpm, has_sync: sync, duration_sec: 180,
}))
const OFF_ROWS = OFF_SONGS.map((song, i) => ({
  id: `ssO${i + 1}`, setlist_id: SID, song_id: song.id, position: i,
  performance_key: i === 0 ? 'D' : null,
  notes: i === 1 ? 'Baixar meio tom no fim' : null,
  custom_intro: i === 0 ? '2 compassos de acordeão' : null,
  custom_ending: null, song,
}))
TABLES.songs.push(...OFF_SONGS)
TABLES.setlists.push({
  ...TABLES.setlists[0], id: SID, name: OFF_NAME, date: d(3), venue: 'Largo da Feira', status: 'final',
  setlist_songs: [{ count: OFF_ROWS.length }],
})
TABLES.setlist_songs.push(...OFF_ROWS)
// A sync como o editor a grava: só as linhas de letra, com tempo (a 1.ª aos 0,6 s)
const SYNC_LINES = LYR.sgO3.split('\n').filter(l => l.trim() && !/^\[.+\]$/.test(l.trim()))
TABLES.lyric_syncs.push({ song_id: 'sgO3', lines: SYNC_LINES.map((text, i) => ({ text, time_ms: 600 + i * 1500 })) })

// Um alinhamento antigo (data há 45 dias) que se vai repetir, e um concerto
// longe (+40 dias): nenhum dos dois entra no guardar em segundo plano
const PAST_ID = 'sPast'
const PAST_NAME = 'Alinhamento de Verão'
const FAR_ID = 'sFar'
const FAR_NAME = 'Romaria de Setembro'
const EXTRA_SONGS = [
  ['sgP1', 'Carrinha Azul', ['[Verso]', 'Pela estrada fora vai a carrinha azul', 'Leva a bateria e o cheiro a café'].join('\n')],
  ['sgP2', 'Palco no Adro', ['[Verso]', 'No adro da igreja montaram o palco', 'Três lâmpadas tortas e um fio a dançar'].join('\n')],
  ['sgP3', 'Bate o Pé', ['[Refrão]', 'Bate o pé, bate a palma', 'Que a noite ainda agora começou'].join('\n')],
].map(([id, title, lyrics]) => ({
  ...TABLES.songs[0], id, title, artist: 'Banda do Largo', original_key: 'C', performance_key: null,
  lyrics, edited_lyrics: null, original_lyrics: null, chords: null, bpm: null, has_sync: false, duration_sec: 180,
}))
TABLES.songs.push(...EXTRA_SONGS)
for (const [sid, name, date] of [[PAST_ID, PAST_NAME, d(-45)], [FAR_ID, FAR_NAME, d(40)]]) {
  TABLES.setlists.push({ ...TABLES.setlists[0], id: sid, name, date, venue: 'Largo', status: 'final', setlist_songs: [{ count: 3 }] })
  TABLES.setlist_songs.push(...EXTRA_SONGS.map((song, i) => ({
    id: `ss${sid}${i}`, setlist_id: sid, song_id: song.id, position: i,
    performance_key: null, notes: null, custom_intro: null, custom_ending: null, song,
  })))
}

// Anotações da CLOUD (desenhadas no Ensaio de outro aparelho): destaque + sublinhado
const P_CLOUD = A.buildPayload({
  w: 600, h: 400, strokes: [], em: 32, lyrics: LYR.sgO1, anchored: [
    { id: 'hc1', color: '#facc15', mode: A.MODE_HL_TEXT, ln: 1, c0: 3, c1: 8, t: 'luzes' },
    { id: 'pc1', color: '#dc2626', w: 0.12, mode: A.MODE_TEXT, p: [2, 0, 0, A.Y_BELOW, 0.15, 0, 2, 11, 0, A.Y_BELOW, 0.15, 1] },
  ],
})
// Anotações DESTE aparelho (Ensaio no próprio iPad): nunca foram para a cloud. Gravadas
// pela versão anterior da app (só por música, 'gigio_ann_v1_*'): passam para o u1
// quando ele entra (gigio_ann_u_u1_*)
const P_LOCAL = A.buildPayload({
  w: 600, h: 400, strokes: [], em: 32, lyrics: LYR.sgO4, anchored: [
    { id: 'hl1', color: '#22c55e', mode: A.MODE_HL_TEXT, ln: 2, c0: 7, c1: 15, t: 'estrelas' },
    { id: 'pl1', color: '#2563eb', w: 0.12, mode: A.MODE_TEXT, p: [1, 0, 0, A.Y_BELOW, 0.15, 0, 1, 9, 0, A.Y_BELOW, 0.15, 1] },
  ],
})
const SONG_ANN = [{ song_id: 'sgO1', user_id: 'u1', strokes: P_CLOUD, updated_at: '2026-10-01T00:00:00Z' }]

// Tema do palco (profiles.concert_theme) — fundo e acento próprios
const THEME = { bg: '#1A110B', active_color: '#F2F1EC', accent_color: '#3DDC97', font_size: 30, line_height: 1.5, align: 'left' }

// Outro utilizador no mesmo browser (sem concertos)
const USER2 = { ...USER, id: 'u2', email: 'ana@teste.pt', user_metadata: { display_name: 'Ana Teste' } }
const SESSION2 = { ...SESSION, access_token: 'mock-token-u2', refresh_token: 'mock-refresh-u2', user: USER2 }
const fresh = s => ({ ...s, expires_in: 31536000, expires_at: Math.floor(Date.now() / 1000) + 31536000 })
const AUTH_KEY = 'sb-mockproj-auth-token'

// ── Servidor do dist (com "rede em baixo" e uma versão nova do SW) ──────────
const SRV = { down: false, hits: [], swTag: '' }
const distHandler = staticServer().listeners('request')[0]
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname
  if (SRV.down) {
    // Sem rede: o servidor da app também não responde (só o SW pode servir)
    SRV.hits.push(p)
    req.socket.destroy()
    return
  }
  if (p === '/sw.js' && SRV.swTag) {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(`${readFileSync(path.join(DIST, 'sw.js'), 'utf8')}\n// ${SRV.swTag}\n`)
    return
  }
  distHandler(req, res)
})
/** Entradas do precache (URLs únicos: os ícones aparecem duas vezes no manifesto) */
const precacheCount = () => new Set([...readFileSync(path.join(DIST, 'sw.js'), 'utf8').matchAll(/\{url:"([^"]+)"/g)].map(m => m[1])).size

// ── Supabase fictício ───────────────────────────────────────────────────────
/**
 * down = sem internet (todos os pedidos ao Supabase falham como sem rede).
 * gate({ table, method, url }) → null, ou uma promessa que PRENDE o pedido até
 * ser resolvida: 'net' = falha por falta de rede; outra coisa = pedido cortado
 * (a app fechou entretanto)
 */
const NET = { down: false, log: [], writes: [], auth: [], gate: null, tokenReject: false }

function whoOf(req) {
  const a = req.headers()['authorization'] ?? ''
  if (a.includes(SESSION2.access_token)) return 'u2'
  if (a.includes(SESSION.access_token)) return 'u1'
  return 'anon'
}

/** Filtros do PostgREST que a app usa nestas tabelas: eq, in, gte, lte e order */
function filterRows(rows, url) {
  let out = rows.slice()
  for (const [key, val] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
    let m
    if ((m = /^eq\.(.*)$/.exec(val))) out = out.filter(r => String(r[key]) === m[1])
    else if ((m = /^in\.\((.*)\)$/.exec(val))) {
      const set = new Set(m[1].split(',').map(s => s.replace(/^"|"$/g, '')))
      out = out.filter(r => set.has(String(r[key])))
    } else if ((m = /^gte\.(.*)$/.exec(val))) out = out.filter(r => r[key] != null && String(r[key]) >= m[1])
    else if ((m = /^lte\.(.*)$/.exec(val))) out = out.filter(r => r[key] != null && String(r[key]) <= m[1])
  }
  const order = url.searchParams.get('order')
  if (order) {
    const [col, dir] = order.split(',')[0].split('.')
    out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1))
  }
  return out
}

async function restRoute(route) {
  const req = route.request()
  const url = new URL(req.url())
  const table = url.pathname.split('/rest/v1/')[1]?.split('/')[0]
  const method = req.method()
  const who = whoOf(req)
  NET.log.push({ table, method, query: decodeURIComponent(url.search), who, down: NET.down })
  const held = NET.gate?.({ table, method, url })
  if (held) {
    const how = await held
    // A página pode já não existir (a app fechou): o erro do abort não interessa
    return route.abort(how === 'net' ? 'internetdisconnected' : 'failed').catch(() => {})
  }
  if (NET.down) return route.abort('internetdisconnected')
  const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  const many = rows => json(200, wantsObject ? (rows[0] ?? null) : rows)

  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
    const body = req.postData() ? JSON.parse(req.postData()) : null
    NET.writes.push({ table, method, body, query: decodeURIComponent(url.search), who })
    // A música gravada na página da música (PATCH songs?id=eq.X) fica no servidor
    if (table === 'songs' && method === 'PATCH' && body && !Array.isArray(body)) {
      const id = /^eq\.(.*)$/.exec(url.searchParams.get('id') ?? '')?.[1]
      const row = TABLES.songs.find(x => x.id === id)
      if (row) Object.assign(row, body)
    }
    // O servidor guarda a ordem (upsert de setlist_songs): um GET a seguir já a devolve
    if (table === 'setlist_songs' && method === 'POST' && Array.isArray(body)) {
      for (const r of body) {
        const row = TABLES.setlist_songs.find(x => x.id === r.id)
        if (row && typeof r.position === 'number') row.position = r.position
      }
    }
    return restResponse(route)
  }
  // RLS: quem não é o u1 não vê nada do u1
  if (who !== 'u1') {
    if (table === 'profiles' && who === 'u2') return many([{ id: 'u2', display_name: 'Ana Teste', email: USER2.email, concert_theme: null }])
    return many([])
  }
  if (table === 'profiles' && (url.searchParams.get('select') ?? '').includes('concert_theme')) {
    return many([{ id: 'u1', display_name: 'João Silva', email: USER.email, concert_theme: THEME }])
  }
  if (method === 'GET' && !req.headers()['prefer']?.includes('count=exact')) {
    if (table === 'song_annotations') return many(filterRows(SONG_ANN, url))
    if (table === 'setlists' || table === 'setlist_songs' || table === 'lyric_syncs') return many(filterRows(TABLES[table], url))
  }
  return restResponse(route)
}

async function authRoute(route) {
  const req = route.request()
  const url = new URL(req.url())
  NET.auth.push({ path: url.pathname + url.search, down: NET.down })
  if (NET.down) return route.abort('internetdisconnected')
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  if (url.pathname.endsWith('/health')) return json(200, { ok: true })
  if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, body: '' })
  if (url.pathname.endsWith('/user')) return json(200, whoOf(req) === 'u2' ? USER2 : USER)
  if (url.pathname.endsWith('/token')) {
    // O servidor recusa o refresh token (já usado depois de o iOS suspender a app a meio de um refresh)
    if (NET.tokenReject && url.searchParams.get('grant_type') === 'refresh_token') {
      return json(400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' })
    }
    const body = req.postData() ? JSON.parse(req.postData()) : {}
    const grant = url.searchParams.get('grant_type')
    const u2 = grant === 'password' ? body.email === USER2.email : body.refresh_token === SESSION2.refresh_token
    return json(200, fresh(u2 ? SESSION2 : SESSION))
  }
  return json(200, fresh(SESSION))
}

async function wire(ctx) {
  await ctx.route('**/rest/v1/**', restRoute)
  await ctx.route('**/auth/v1/**', authRoute)
  await ctx.route(/lrclib|genius|nominatim/, route => (NET.down
    ? route.abort('internetdisconnected')
    : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })))
  await ctx.addInitScript(() => {
    try { if (!localStorage.getItem('gigio-theme')) localStorage.setItem('gigio-theme', 'dark') } catch { /* */ }
    // Só observação: quando ficou pronto o registo do SW feito pela app (registerSW)
    try {
      const sw = navigator.serviceWorker
      const register = sw.register.bind(sw)
      window.__swReg = null
      sw.register = (...args) => {
        const p = register(...args)
        p.then(() => { window.__swReg = 'ok' }, e => { window.__swReg = `erro: ${e}` })
        return p
      }
    } catch { /* sem SW */ }
  })
}

// ── Perfil persistente (o "iPad"): o SW e o IndexedDB sobrevivem a fechar a app ──
const PROFILE = mkdtempSync(path.join(os.tmpdir(), 'gigio-off-e2e-profile-'))
async function launch({ viewport = TABLET_PORT, offline = false } = {}) {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EXE, viewport, deviceScaleFactor: 2, serviceWorkers: 'allow', offline,
  })
  await wire(ctx)
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]))
  return { ctx, page, errors }
}
/** Modo avião: o browser sem rede, o Supabase e o servidor da app em baixo */
async function netOff(ctx) {
  NET.down = true
  SRV.down = true
  await ctx.setOffline(true)
}
async function netOn(ctx) {
  NET.down = false
  SRV.down = false
  await ctx.setOffline(false)
}

// ── Leitura do IndexedDB da app (sem nunca criar a base) ────────────────────
const idbKeys = page => page.evaluate(() => new Promise(res => {
  let r
  try { r = indexedDB.open('gigio-offline') } catch { res([]); return }
  // A base ainda não existe: não a criar (a app abriria uma base sem o armazém)
  r.onupgradeneeded = () => { try { r.transaction.abort() } catch { /* */ } }
  r.onerror = () => res([])
  r.onsuccess = () => {
    const db = r.result
    if (!db.objectStoreNames.contains('kv')) { db.close(); res([]); return }
    const q = db.transaction('kv').objectStore('kv').getAllKeys()
    q.onsuccess = () => { db.close(); res(q.result.map(String)) }
    q.onerror = () => { db.close(); res([]) }
  }
}))
const idbGet = (page, key) => page.evaluate(key => new Promise(res => {
  let r
  try { r = indexedDB.open('gigio-offline') } catch { res(null); return }
  r.onupgradeneeded = () => { try { r.transaction.abort() } catch { /* */ } }
  r.onerror = () => res(null)
  r.onsuccess = () => {
    const db = r.result
    if (!db.objectStoreNames.contains('kv')) { db.close(); res(null); return }
    const q = db.transaction('kv').objectStore('kv').get(key)
    q.onsuccess = () => { db.close(); res(q.result ?? null) }
    q.onerror = () => { db.close(); res(null) }
  }
}), key)

/** Escreve uma chave no IndexedDB da app (a base já existe: a app abriu-a) */
const idbPut = (page, key, value) => page.evaluate(([key, value]) => new Promise(res => {
  const r = indexedDB.open('gigio-offline')
  r.onerror = () => res(false)
  r.onsuccess = () => {
    const db = r.result
    if (!db.objectStoreNames.contains('kv')) { db.close(); res(false); return }
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(value, key)
    tx.oncomplete = () => { db.close(); res(true) }
    tx.onerror = () => { db.close(); res(false) }
  }
}), [key, value])

// ── Página: atalhos ─────────────────────────────────────────────────────────
const S = {
  counterNow: '[class*="_counterNow_"]',
  counter: '[class*="_counter_"]',
  title: '[class*="_headerTitle_"]',
  sub: '[class*="_headerSub_"]',
  offTag: '[data-offline-tag]',
  annWrap: '[class*="_annotationsWrap_"]',
  next: 'button[aria-label^="Música seguinte"]',
  prev: 'button[aria-label^="Música anterior"]',
}
/** Botão de um diálogo de confirmação (role="dialog" ou "alertdialog" quando é perigoso) */
const confirmBtn = label => `:is([role="dialog"], [role="alertdialog"]) button:has-text("${label}")`
const textOf = (page, sel) => page.locator(sel).first().textContent({ timeout: 2000 }).catch(() => '')
const countOf = (page, sel) => page.locator(sel).count().catch(() => 0)
const pathOf = page => new URL(page.url()).pathname
async function shot(page, name, opts = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts }).catch(e => console.log('  (captura falhou)', name, String(e).split('\n')[0]))
}
/** Palco: espera pelo contador com N e devolve o estado visível */
async function stage(page) {
  return page.evaluate(sel => {
    const t = s => document.querySelector(s)?.textContent?.trim() ?? ''
    const root = document.querySelector('[class*="_page_"]')
    const cs = root ? getComputedStyle(root) : null
    return {
      now: t(sel.counterNow),
      counter: (document.querySelector(sel.counter)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      title: t(sel.title),
      sub: (document.querySelector(sel.sub)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      offline: !!document.querySelector(sel.offTag),
      live: [...document.querySelectorAll('[class*="_liveTag_"]')].some(e => !e.hasAttribute('data-offline-tag')),
      lines: [...document.querySelectorAll('[class*="_lyricLine_"]')].map(e => e.textContent.trim()),
      cues: [...document.querySelectorAll('[class*="_cue_"]')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      bg: cs?.backgroundColor ?? null,
      accent: cs?.getPropertyValue('--stage-accent').trim().toLowerCase() ?? null,
      empty: document.querySelector('[data-stage-empty]')?.getAttribute('data-stage-empty') ?? null,
      deck: (document.querySelector('[class*="_deckNote_"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      transport: !!document.querySelector('[aria-label="Sincronização da letra"]'),
      keys: [...document.querySelectorAll('header button[aria-label]')].map(b => b.getAttribute('aria-label')),
    }
  }, S)
}
async function waitStage(page, now, timeout = 5000) {
  return page.waitForFunction(([sel, now]) => {
    const t = document.querySelector(sel)?.textContent ?? ''
    return now ? t.trim() === now : /\d\d/.test(t)
  }, [S.counterNow, now], { timeout }).then(() => true, () => false)
}
/** Títulos do alinhamento (coluna ou folha) pela ordem do ecrã */
const setlistTitles = page => page.$$eval('#concert-setlist [class*="_rowTitle_"]', els => els.map(e => e.textContent.trim()))

/** Vista "Anotações de ensaio": destaques (marcador) e traços da caneta contra as caixas do texto */
async function annGeometry(page, hlLn, word, penLn, penChars) {
  return page.evaluate(([wrapSel, hlLn, word, penLn, penChars]) => {
    const host = document.querySelector(wrapSel)
    if (!host) return null
    const box = b => ({ l: b.left, r: b.right, t: b.top, b: b.bottom })
    const textNode = el => el && [...el.childNodes].find(n => n.nodeType === 3 && n.data.length > 0)
    const rangeBox = (ln, from, to) => {
      const tn = textNode(host.querySelector(`[data-ln="${ln}"]`))
      if (!tn) return null
      const r = document.createRange()
      r.setStart(tn, Math.max(0, from))
      r.setEnd(tn, Math.min(tn.data.length, to ?? tn.data.length))
      return box(r.getBoundingClientRect())
    }
    const hlEl = host.querySelector(`[data-ln="${hlLn}"]`)
    const hlText = textNode(hlEl)?.data ?? ''
    const wi = hlText.indexOf(word)
    return {
      em: hlEl ? parseFloat(getComputedStyle(hlEl).fontSize) : 0,
      word: wi >= 0 ? rangeBox(hlLn, wi, wi + word.length) : null,
      penText: rangeBox(penLn, 0, penChars),
      rects: [...host.querySelectorAll('svg[data-ann="marcador"] [data-hl] rect, svg[data-ann="marcador"] rect[data-hl]')]
        .map(e => box(e.getBoundingClientRect())),
      pens: [...host.querySelectorAll('svg:not([data-ann]) path')].map(e => box(e.getBoundingClientRect())),
    }
  }, [S.annWrap, hlLn, word, penLn, penChars])
}
/** O destaque cobre a palavra e o sublinhado fica por baixo do texto certo */
function checkAnn(label, g) {
  if (!ok(!!g && !!g.word && !!g.penText, `${label}: letra e anotações no ecrã`, g)) return
  const em = g.em || 30
  const hit = g.rects.find(r => r.l <= g.word.l + 0.35 * em && r.r >= g.word.r - 0.35 * em
    && Math.min(r.b, g.word.b) - Math.max(r.t, g.word.t) >= 0.5 * (g.word.b - g.word.t))
  ok(!!hit, `${label}: destaque por cima da palavra certa`, { word: g.word, rects: g.rects.slice(0, 4), em })
  const pen = g.pens.find(p => p.t >= g.penText.b - 0.4 * em && p.t <= g.penText.b + 0.8 * em
    && Math.abs(p.l - g.penText.l) <= 0.6 * em && p.r <= g.penText.r + 0.6 * em)
  ok(!!pen, `${label}: sublinhado por baixo do verso certo`, { text: g.penText, pens: g.pens.slice(0, 4), em })
}

/** Barra de baixo do palco: o que lá está e as caixas (px do viewport) */
async function barInfo(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[class*="_controlsRow_"]')
    if (!row) return null
    const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } }
    const vis = el => {
      const cs = getComputedStyle(el)
      const b = el.getBoundingClientRect()
      return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0
    }
    const strip = row.querySelector(':scope > [class*="_filmStrip_"]')
    const navs = [...row.querySelectorAll(':scope > [class*="_navKey_"]')]
    const deck = row.querySelector(':scope > [class*="_deck_"]')
    const footer = row.closest('footer')
    const nl = footer?.querySelector('[class*="_nextLine_"]')
    const cards = strip ? [...strip.children] : []
    return {
      gap: parseFloat(getComputedStyle(row).columnGap),
      row: { ...box(row), sw: row.scrollWidth, cw: row.clientWidth },
      kids: [...row.children].filter(vis).map(el => (el.className.match(/_([a-zA-Z]+)_/) ?? [])[1] ?? el.tagName),
      kidBoxes: [...row.children].filter(vis).map(box),
      stripVisible: !!strip && vis(strip),
      cards: cards.filter(vis).map(c => {
        const t = c.querySelector('[class*="_stripTitle_"]')
        return {
          ...box(c),
          label: (c.querySelector('[class*="_stripLabel_"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          title: t?.textContent ?? '',
          titleFits: t ? t.scrollWidth <= t.clientWidth + 1 : false,
        }
      }),
      prev: navs[0] ? box(navs[0]) : null,
      next: navs[1] ? box(navs[1]) : null,
      deck: deck ? box(deck) : null,
      nextLine: nl && vis(nl) ? [...nl.children].map(s => s.textContent.trim()) : null,
      nextLineBox: nl && vis(nl) ? box(nl) : null,
      footerText: footer?.textContent ?? '',
      later: document.querySelectorAll('[class*="stripCardLater"]').length,
      footerBox: footer ? box(footer) : null,
      vw: innerWidth,
    }
  })
}

// ════════════════════════════════════════════════════════════════════════════
if (!process.env.E2E_NO_BUILD) {
  console.log('build com Supabase fictício…')
  execSync('npx vite build --logLevel error', {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, VITE_SUPABASE_URL: 'https://mockproj.supabase.co', VITE_SUPABASE_ANON_KEY: 'mockanon' },
  })
}
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
await new Promise(r => server.listen(PORT, r))

const needO1 = ['O1', 'O2', 'O3', 'O4', 'O5', 'O6'].some(want)
const concertKeys = async page => (await idbKeys(page)).filter(k => k.includes(':concert:')).sort()
/** Avisos (toasts) mostrados desde a última chamada: um observador na página guarda-os todos */
async function trackToasts(page) {
  await page.evaluate(() => {
    window.__toasts = []
    if (window.__toastObs) return
    window.__toastObs = new MutationObserver(ms => {
      for (const m of ms) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue
          const els = n.matches('[role="alert"], [role="status"]') ? [n] : [...n.querySelectorAll('[role="alert"], [role="status"]')]
          for (const e of els) window.__toasts.push(e.textContent.replace(/\s+/g, ' ').trim())
        }
      }
    })
    window.__toastObs.observe(document.body, { childList: true, subtree: true })
  })
}
const toastSeen = (page, text, timeout = 3000) =>
  until(() => page.evaluate(t => (window.__toasts ?? []).some(x => x.includes(t)), text), timeout)
/** Corre um cenário: uma exceção conta como falha e não pára os outros */
async function scenario(name, title, fn) {
  console.log(`— ${name}. ${title}`)
  const opened = []
  try {
    await fn(opened)
  } catch (e) {
    ok(false, `${name}: exceção`, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '))
  } finally {
    for (const c of opened) await c.close().catch(() => {})
    NET.down = false
    NET.gate = null
    NET.tokenReject = false
    SRV.down = false
  }
}

try {
  // ══ O1 ═════════════════════════════════════════════════════════════════════
  if (needO1) await scenario('O1', 'Com rede: entrar, Projetos e Concertos — o SW fica a controlar e os próximos concertos ficam guardados sem abrir nenhum', async opened => {
    const { ctx, page, errors } = await launch()
    opened.push(ctx)
    // Entrar (1.ª visita: o SW instala-se em segundo plano)
    await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' })
    await page.fill('#auth-email', USER.email)
    await page.fill('#auth-password', 'segredo123')
    await page.click('button[type="submit"]')
    await page.waitForURL(u => new URL(u).pathname === '/', { timeout: 10000 })
    // O SW tem de estar ATIVO e a CONTROLAR a página, com o precache completo
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {})
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      let entries = 0
      let html = false
      for (const k of await caches.keys()) {
        const reqs = await (await caches.open(k)).keys()
        entries += reqs.length
        if (reqs.some(r => /\/index\.html(\?|$)/.test(r.url))) html = true
      }
      return { state: reg?.active?.state ?? null, controller: !!navigator.serviceWorker.controller, scope: reg?.scope ?? null, entries, html }
    })
    ok(sw.state === 'activated' && sw.controller, 'O1: service worker ativo e a controlar a página', sw)
    ok(sw.html && sw.entries >= precacheCount(), `O1: precache completo (${precacheCount()} URLs do sw.js, index.html incluído)`, sw)

    // Guardar em segundo plano: hoje até +14 dias (o sOff é daqui a 3 dias).
    // Fica-se na página inicial até acabar (um recarregar a meio é outro caso)
    const saved = () => until(async () => {
      const k = await idbKeys(page)
      return k.includes(`u:u1:concert:${SID}`) && k.includes('u:u1:concert:s1') && k.includes('u:u1:theme') ? k : null
    }, 20000, 300)
    const onHome = await saved()
    ok(!!onHome, 'O1: guardado a partir da página inicial (Projetos)', await idbKeys(page))
    await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
    const keys = await saved() ?? await idbKeys(page)
    const concerts = keys.filter(k => k.includes(':concert:')).sort()
    ok(concerts.includes(`u:u1:concert:${SID}`), 'O1: o concerto nunca aberto ficou guardado no IndexedDB', concerts)
    ok(['s1', 's2', 's4'].every(s => concerts.includes(`u:u1:concert:${s}`)), 'O1: os de hoje e dos próximos dias também (s4 hoje, s1 amanhã, s2 +7)', concerts)
    ok(![
      's5', 's6', 's7', PAST_ID, FAR_ID,
    ].some(s => concerts.includes(`u:u1:concert:${s}`)), 'O1: os passados e os de +30 dias não', concerts)
    ok(keys.every(k => k.startsWith('u:u1:')), 'O1: tudo com o prefixo do utilizador', keys)

    const b = await idbGet(page, `u:u1:concert:${SID}`)
    ok(JSON.stringify(b?.rows?.map(r => r.id)) === JSON.stringify(OFF_ROWS.map(r => r.id)), 'O1: cópia com as 5 músicas pela ordem', b?.rows?.map(r => r.id))
    ok(JSON.stringify(b?.rows?.map(r => r.song?.title)) === JSON.stringify(OFF_SONGS.map(s => s.title)), 'O1: títulos', b?.rows?.map(r => r.song?.title))
    ok(b?.rows?.[0]?.performance_key === 'D' && b?.rows?.[0]?.song?.original_key === 'C' && b?.rows?.[0]?.custom_intro === '2 compassos de acordeão',
      'O1: tom do concerto, tom original e intro', b?.rows?.[0] && { pk: b.rows[0].performance_key, ok: b.rows[0].song?.original_key, intro: b.rows[0].custom_intro })
    ok(b?.rows?.[0]?.song?.chords === CHORDS_C, 'O1: acordes', b?.rows?.[0]?.song?.chords)
    ok(b?.rows?.[1]?.song?.edited_lyrics === LYR.sgO2edit && b?.rows?.[1]?.song?.lyrics === LYR.sgO2 && b?.rows?.[1]?.notes === 'Baixar meio tom no fim',
      'O1: letra editada, letra original e nota do concerto')
    ok(Array.isArray(b?.syncs?.sgO3) && b.syncs.sgO3.length === SYNC_LINES.length, 'O1: sincronização da sgO3', b?.syncs && Object.keys(b.syncs))
    ok(!!b?.annotations?.sgO1 && b?.annChecked === true && !b?.annotations?.sgO4, 'O1: anotações da cloud (sgO1), lidas para todas as músicas', b?.annotations && Object.keys(b.annotations))
    ok(b?.rows?.every(r => !('original_lyrics' in (r.song ?? {}))), 'O1: sem colunas que o palco não usa (original_lyrics)')
    const idx = await idbGet(page, 'u:u1:index')
    const e = Array.isArray(idx) ? idx.find(x => x.setlistId === SID) : null
    ok(!!e && e.songCount === 5 && e.name === OFF_NAME && e.usedAt === e.savedAt && !('openedAt' in e), 'O1: no índice, nunca aberto (usedAt = savedAt, sem openedAt)', e)
    ok(JSON.stringify(e?.songIds) === JSON.stringify(OFF_SONGS.map(x => x.id)), 'O1: no índice, as músicas da cópia (para a atualizar quando uma música muda)', e?.songIds)
    const theme = await idbGet(page, 'u:u1:theme')
    ok(theme?.theme?.bg === THEME.bg && theme?.userId === 'u1', 'O1: tema do palco guardado', theme)
    const opened1 = NET.log.filter(l => l.table === 'setlist_songs' && l.query.includes(`setlist_id=eq.${SID}`)).length
    ok(opened1 >= 1, 'O1: as músicas do concerto vieram só do guardar em segundo plano', opened1)
    const annLocal = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gigio_ann')))
    ok(annLocal.length === 0, 'O1: as anotações da cloud não vão para o localStorage deste aparelho', annLocal)

    // Lista com rede: os guardados levam o chip "Guardado" (não "Offline", que se lia como um estado)
    await page.waitForSelector('[data-offline]', { timeout: 5000 }).catch(() => {})
    const chipRow = page.locator('[role="button"]', { hasText: OFF_NAME }).first()
    ok(await chipRow.locator('[data-offline]').count() === 1, 'O1: chip no concerto guardado, na lista Concertos com rede')
    const chipText = (await chipRow.locator('[data-offline]').first().textContent().catch(() => '')).trim()
    ok(/^Guardado/.test(chipText), 'O1: o chip diz "Guardado"', chipText)
    ok(await countOf(page, '[data-offline-banner]') === 0, 'O1: sem aviso "Sem ligação" com rede')
    await shot(page, 'O1-concertos-online', { fullPage: true })

    // Ensaio NESTE aparelho (anotações locais da sgO4) — o que o cantor desenhou no
    // iPad com a versão anterior da app (chave só por música)
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), ['gigio_ann_v1_sgO4', JSON.stringify(P_LOCAL)])

    // "Disponível offline · Guardado às…" na página de um concerto (o s1; o sOff fica por abrir)
    await page.goto(`${BASE}/setlist/s1`, { waitUntil: 'domcontentloaded' })
    const annKeys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gigio_ann')))
    ok(JSON.stringify(annKeys) === JSON.stringify(['gigio_ann_u_u1_sgO4']), 'O1: as anotações antigas deste aparelho passam a ser do utilizador que entrou (gigio_ann_u_u1_*)', annKeys)
    await page.waitForSelector('[data-offline-status="saved"]', { timeout: 6000 }).catch(() => {})
    const st = await textOf(page, '[data-offline-status]')
    ok(/Disponível offline/i.test(st) && /Guardado às \d\d:\d\d/i.test(st), 'O1: "Disponível offline · Guardado às HH:MM" na página do concerto', st)
    await shot(page, 'O1-concerto-online')
    ok(errors.length === 0, 'O1: sem erros na página', errors)
  })

  // ══ O2 ═════════════════════════════════════════════════════════════════════
  if (want('O2')) await scenario('O2', 'Arranque a frio SEM REDE em "/" → Concertos → o concerto (só guardado em segundo plano) → modo concerto', async opened => {
    NET.down = true
    SRV.down = true
    SRV.hits = []
    const { ctx, page, errors } = await launch({ offline: true })
    opened.push(ctx)
    const t0 = Date.now()
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-offline-concerts]', { timeout: 6000 }).catch(() => {})
    ok(pathOf(page) === '/', 'O2: abre a app sem rede (nunca /auth)', page.url())
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'O2: a página veio do service worker')
    const home = await textOf(page, '[data-offline-concerts]')
    ok(/Disponíveis offline/.test(home) && home.includes(OFF_NAME), `O2: Projetos mostra "Disponíveis offline" com o concerto (${Date.now() - t0} ms)`, home.slice(0, 200))
    const banner = await textOf(page, '[data-offline-banner]')
    ok(/\d+ concertos guardados funcionam sem rede/.test(banner), 'O2: aviso "N concertos guardados funcionam sem rede"', banner)
    ok(await countOf(page, 'main [class*="_offlineBanner_"]') === 0, 'O2: Projetos sem um 2.º "Sem ligação" na página (o aviso global chega)')
    await shot(page, 'O2-projetos-offline', { fullPage: true })

    // Concertos (pelo menu, sem recarregar)
    await page.locator('a[href="/setlists"]:visible').first().click()
    await page.waitForSelector('[data-offline-list]', { timeout: 6000 }).catch(() => {})
    const list = await page.locator('main').first().textContent().catch(() => '')
    ok(list.includes(OFF_NAME) && !/Ainda sem concertos/.test(list), 'O2: Concertos sem rede mostra os guardados (nunca "Ainda sem concertos")', list.slice(0, 160))
    // Sem rede a lista é só dos guardados: o subtítulo di-lo uma vez (sem um chip em cada linha, sem 3.º aviso)
    const sub = await textOf(page, '[data-offline-list]')
    ok(/\d+ guardados? neste aparelho/.test(sub), 'O2: o subtítulo diz "N guardados neste aparelho"', sub)
    ok(await countOf(page, '[data-offline]') === 0, 'O2: sem chip "Guardado" em cada linha (sem rede são todos)')
    ok(!/Concertos disponíveis offline neste aparelho/.test(list), 'O2: sem a nota repetida "Sem ligação · concertos disponíveis offline"')
    const newBtn = page.locator('button', { hasText: 'Novo concerto' }).first()
    ok(await newBtn.getAttribute('aria-disabled') === 'true', 'O2: "Novo concerto" apagado (aria-disabled) sem rede')
    await trackToasts(page)
    // aria-disabled: o Playwright não clica num "desativado" sem force (o dedo, no iPad, toca)
    await newBtn.click({ force: true })
    ok(!!(await toastSeen(page, 'Criar um concerto precisa de rede')) && pathOf(page) === '/setlists', 'O2: o toque em "Novo concerto" diz porquê (e não sai da lista)', await page.evaluate(() => window.__toasts))
    await shot(page, 'O2-concertos-offline', { fullPage: true })

    // Calendário (a partir de Concertos): os guardados nos seus dias, nunca "0 concertos"
    await page.locator('button', { hasText: 'Calendário' }).first().click()
    await page.waitForSelector('[data-offline-calendar]', { timeout: 6000 }).catch(() => {})
    const cal = (await page.locator('main').first().textContent().catch(() => '')) ?? ''
    ok(await countOf(page, '[data-offline-calendar]') === 1 && /Só os guardados neste aparelho/i.test(cal), 'O2: Calendário sem rede — "Sem ligação · só os guardados neste aparelho"', cal.slice(0, 200))
    ok(cal.includes('Ensaio geral') && !/Sem concertos neste dia/.test(cal), 'O2: Calendário sem rede — hoje tem o concerto guardado (Ensaio geral)', cal.slice(0, 300))
    const createDay = page.locator('button', { hasText: /^Criar concerto a/ }).first()
    ok(await createDay.getAttribute('aria-disabled') === 'true', 'O2: Calendário sem rede — "Criar concerto" apagado')
    await shot(page, 'O2-calendario-offline', { fullPage: true })
    // Repertório: "Sem ligação" (nunca "Repertório vazio")
    await page.locator('a[href="/library"]:visible').first().click()
    await page.waitForSelector('[data-library-empty]', { timeout: 6000 }).catch(() => {})
    ok(await page.locator('[data-library-empty]').first().getAttribute('data-library-empty').catch(() => null) === 'offline', 'O2: Repertório sem rede diz "Sem ligação" (nunca "Repertório vazio")', await textOf(page, 'main'))
    await shot(page, 'O2-repertorio-offline')
    await page.locator('a[href="/setlists"]:visible').first().click()
    await page.waitForSelector('[data-offline-list]', { timeout: 6000 }).catch(() => {})

    // O concerto (página): só leitura, músicas da cópia
    await page.getByText(OFF_NAME, { exact: true }).first().click()
    await page.waitForURL(u => new URL(u).pathname === `/setlist/${SID}`, { timeout: 5000 }).catch(() => {})
    await page.waitForSelector('[data-offline-status="readonly"]', { timeout: 6000 }).catch(() => {})
    const st = await textOf(page, '[data-offline-status]')
    ok(/Sem ligação/i.test(st) && /só leitura/i.test(st) && /Cópia guardada às \d\d:\d\d/i.test(st), 'O2: "Sem ligação · só leitura · Cópia guardada às HH:MM"', st)
    const titles = await page.$$eval('[class*="_songTitle_"]', els => els.map(e => e.textContent.trim()))
    ok(JSON.stringify(titles) === JSON.stringify(OFF_SONGS.map(s => s.title)), 'O2: página do concerto com as músicas pela ordem', titles)
    ok(await countOf(page, 'button[aria-label^="Tom nesta setlist: D"]') === 1, 'O2: tom D na 1.ª música')
    ok(await page.locator('input[aria-label="Data do concerto"]').isDisabled().catch(() => false), 'O2: edições bloqueadas (data)')
    await shot(page, 'O2-concerto-offline')

    // Modo concerto
    const t1 = Date.now()
    await page.locator('button', { hasText: 'Iniciar concerto' }).first().click()
    const up = await waitStage(page, '01')
    const upMs = Date.now() - t1
    ok(up, `O2: palco em ${upMs} ms`)
    // O alinhamento vem da memória (já lido pela página do concerto); o tema
    // vem do IndexedDB logo a seguir — mede-se quanto tempo o palco fica com o tema por omissão
    const themed = await page.waitForFunction(() => {
      const el = document.querySelector('[class*="_page_"]')
      return el && getComputedStyle(el).backgroundColor === 'rgb(26, 17, 11)'
    }, null, { timeout: 3000, polling: 16 }).then(() => true, () => false)
    const themeMs = Date.now() - t1 - upMs
    ok(themed, `O2: tema do palco aplicado (${themeMs} ms depois das músicas)`)
    if (themeMs > 150) console.log(`  (nota) o palco mostrou o tema por omissão durante ~${themeMs} ms antes do tema guardado`)
    let s = await stage(page)
    ok(/^01 \/ 05$/.test(s.counter), 'O2: 01 / 05', s.counter)
    ok(s.title === 'Luzes da Feira', 'O2: 1.ª música', s.title)
    ok(/Tom D/.test(s.sub) && s.sub.includes(OFF_NAME), 'O2: "Tom D · Arraial da Ribeira"', s.sub)
    ok(s.offline && !s.live, 'O2: etiqueta OFFLINE (no lugar de AO VIVO)', s)
    ok(/^Offline/i.test(await textOf(page, S.offTag)), 'O2: a etiqueta diz "Offline"', await textOf(page, S.offTag))
    ok(s.cues.some(c => /Intro/i.test(c) && c.includes('2 compassos de acordeão')), 'O2: intro do concerto', s.cues)
    ok(s.lines.includes('As luzes da feira acendem devagar') && s.lines.includes('Dança comigo que a noite está a acabar'), 'O2: letra', s.lines.slice(0, 3))
    ok(s.bg === 'rgb(26, 17, 11)' && s.accent === THEME.accent_color.toLowerCase(), 'O2: tema do palco guardado (fundo e acento)', { bg: s.bg, accent: s.accent })
    ok(await countOf(page, 'button[aria-label^="Editar letra"]') === 0, 'O2: o palco não tem botão "Editar letra" (toques enganados)')
    await shot(page, 'O2-palco-offline-ipad')

    // Alinhamento (folha, iPad ao alto)
    await page.click('button[aria-label="Alinhamento"]')
    await page.waitForSelector('#concert-setlist', { timeout: 3000 }).catch(() => {})
    const order = await setlistTitles(page)
    ok(JSON.stringify(order) === JSON.stringify(OFF_SONGS.map(x => x.title)), 'O2: alinhamento pela ordem', order)
    await page.click('button[aria-label="Fechar alinhamento"]').catch(() => {})
    await page.waitForSelector('#concert-setlist', { state: 'detached', timeout: 3000 }).catch(() => {})

    // Acordes, transpostos para o tom do concerto
    await page.click('button[aria-label="Acordes"]')
    const chords = await textOf(page, '[class*="_chordsPre_"]')
    const tnote = (await textOf(page, '[class*="_transposeNote_"]')).replace(/\s+/g, ' ')
    ok(chords.trim() === CHORDS_D && /C → D/.test(tnote), 'O2: acordes transpostos C → D', { chords, tnote })
    await page.click('button[aria-label="Acordes"]')

    // Anotações da cloud (guardadas com o concerto)
    ok(await countOf(page, 'button[aria-label="Anotações de ensaio"]') === 1, 'O2: tecla "Anotações de ensaio" (só na cloud)')
    await page.click('button[aria-label="Anotações de ensaio"]')
    await page.waitForFunction(sel => document.querySelectorAll(`${sel} svg[data-ann="marcador"] rect`).length > 0
      && document.querySelectorAll(`${sel} svg:not([data-ann]) path`).length > 0, S.annWrap, { timeout: 6000 }).catch(() => {})
    checkAnn('O2 anotações da cloud', await annGeometry(page, 1, 'luzes', 2, 11))
    await shot(page, 'O2-palco-anotacoes-cloud-ipad')
    await page.click('button[aria-label="Anotações de ensaio"]')

    // 2.ª: letra EDITADA e nota
    await page.click(S.next)
    await waitStage(page, '02')
    s = await stage(page)
    ok(s.title === 'Carrossel de Agosto' && s.lines.includes('Linha corrigida no ensaio de terça') && !s.lines.includes('Versão antiga desta linha'),
      'O2: 2.ª música com a letra editada', { title: s.title, lines: s.lines })
    ok(s.cues.some(c => c.includes('Baixar meio tom no fim')), 'O2: nota do concerto', s.cues)

    // 3.ª: sincronização (o relógio anda e acende a linha certa) + metrónomo
    await page.click(S.next)
    await waitStage(page, '03')
    s = await stage(page)
    ok(s.title === 'Barraca das Farturas' && s.transport && !/indisponível/i.test(s.deck), 'O2: 3.ª música com o transporte da sincronização', { title: s.title, transport: s.transport, deck: s.deck })
    ok(s.keys.some(k => /Metrónomo visual — 96 bpm/.test(k)), 'O2: metrónomo (96 bpm)', s.keys)
    await page.click('button[aria-label="Reproduzir"]')
    const lit = await page.waitForFunction(() => document.querySelector('[class*="_lyricActive_"]')?.textContent?.trim(), null, { timeout: 4000 })
      .then(h => h.jsonValue(), () => null)
    ok(lit === SYNC_LINES[0], 'O2: a sync acende a 1.ª linha', lit)
    await page.click('button[aria-label="Pausar"]').catch(() => {})

    // 4.ª: anotações e destaques do Ensaio DESTE aparelho
    await page.click(S.next)
    await waitStage(page, '04')
    ok(await countOf(page, 'button[aria-label="Anotações de ensaio"]') === 1, 'O2: tecla "Anotações de ensaio" (deste aparelho)')
    await page.click('button[aria-label="Anotações de ensaio"]')
    await page.waitForFunction(sel => document.querySelectorAll(`${sel} svg[data-ann="marcador"] rect`).length > 0, S.annWrap, { timeout: 6000 }).catch(() => {})
    checkAnn('O2 anotações deste aparelho', await annGeometry(page, 2, 'estrelas', 1, 9))
    await page.click('button[aria-label="Anotações de ensaio"]')

    // Telemóvel (mesma cópia): OFFLINE e a micro-linha "A seguir"
    await page.setViewportSize(PHONE)
    await page.waitForTimeout(500)
    s = await stage(page)
    const bar = await barInfo(page)
    ok(s.offline && s.title === 'Fogo de Vista', 'O2 telemóvel: OFFLINE e a música certa', { offline: s.offline, title: s.title })
    ok(JSON.stringify(bar?.nextLine) === JSON.stringify(['A seguir', '·', '05', '·', 'Última Volta']), 'O2 telemóvel: "A seguir · 05 · Última Volta"', bar?.nextLine)
    await shot(page, 'O2-palco-offline-telemovel')
    await page.setViewportSize(TABLET_PORT)
    await page.waitForTimeout(300)

    const hits = SRV.hits.filter(p => p !== '/sw.js')
    ok(hits.length === 0, 'O2: nada pedido ao servidor da app (tudo do SW)', hits.slice(0, 5))
    ok(errors.length === 0, 'O2: sem erros na página', errors)
  })

  // ══ O3 ═════════════════════════════════════════════════════════════════════
  if (want('O3')) await scenario('O3', 'Arranque a frio SEM REDE direto em /setlist/<id>/concert (app fechada e reaberta)', async opened => {
    NET.down = true
    SRV.down = true
    const { ctx, page, errors } = await launch({ offline: true })
    opened.push(ctx)
    const t0 = Date.now()
    await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
    const up = await waitStage(page, null, 6000)
    const ms = Date.now() - t0
    ok(up && ms < 3000, `O3: palco com a cópia em ${ms} ms (< 3 s)`)
    const s = await stage(page)
    ok(/^04 \/ 05$/.test(s.counter) && s.title === 'Fogo de Vista', 'O3: retoma a música onde ficou (04 / 05)', { counter: s.counter, title: s.title })
    ok(s.lines.includes('Chovem estrelas sobre o rio'), 'O3: letra', s.lines)
    ok(s.offline && s.bg === 'rgb(26, 17, 11)', 'O3: OFFLINE e tema do palco', { offline: s.offline, bg: s.bg })
    ok(s.empty === null, 'O3: nunca "a carregar" nem "não guardado"', s.empty)
    await shot(page, 'O3-palco-arranque-direto-ipad')
    await page.click(S.prev)
    await page.click(S.prev)
    await page.click(S.prev)
    await waitStage(page, '01')
    const s1 = await stage(page)
    ok(s1.title === 'Luzes da Feira' && s1.cues.some(c => c.includes('2 compassos de acordeão')), 'O3: volta à 1.ª, com a intro', { title: s1.title, cues: s1.cues })
    // Também a página do concerto e a lista, por link direto
    await page.goto(`${BASE}/setlist/${SID}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-offline-status="readonly"]', { timeout: 5000 }).catch(() => {})
    ok(await countOf(page, '[data-offline-status="readonly"]') === 1, 'O3: /setlist/<id> por link direto sem rede')
    ok(errors.length === 0, 'O3: sem erros na página', errors)

    // ── O3b: sem rede, tocar em "Editar música" ──
    console.log('— O3b. Sem rede: tocar em "Editar música" (iPad ao alto, telemóvel, iPad deitado)')
    const BLOCK = 'Editar a música precisa de rede'
    const here = `/setlist/${SID}`
    // Um só padrão: TODAS as ações de edição apagadas da mesma forma (aria-disabled — o toque explica)
    const offState = await page.evaluate(() => {
      const q = sel => [...document.querySelectorAll(sel)]
      const st = el => ({ aria: el.getAttribute('aria-disabled'), op: Number(getComputedStyle(el).opacity) })
      return {
        detalhes: q('button[aria-label^="Ver detalhes"]').map(st)[0],
        remover: q('button[aria-label="Remover da setlist"]').map(st)[0],
        pega: q('button[aria-label="Arrastar para reordenar"]').map(st)[0],
        adicionar: q('button').filter(b => b.textContent.trim() === 'Adicionar').map(st)[0],
        duplicar: q('button').filter(b => b.textContent.trim() === 'Duplicar').map(st)[0],
        lapisTitulo: !!document.querySelector('h1 [class*="_editHint_"]'),
        tomNotas: q('button[aria-label="Definir tom e notas neste concerto"]').length,
      }
    })
    ok(['remover', 'pega', 'adicionar', 'duplicar'].every(k => offState[k]?.aria === 'true' && offState[k].op <= 0.45),
      'O3b: ✕, pega, Adicionar e Duplicar apagados da mesma forma (aria-disabled, opacidade 0,4)', offState)
    ok(!!offState.detalhes && offState.detalhes.aria !== 'true' && offState.detalhes.op > 0.9, 'O3b: o ⓘ (detalhes) continua ativo sem rede', offState.detalhes)
    ok(!offState.lapisTitulo && offState.tomNotas === 0, 'O3b: sem o ✎ do título nem "+ Tom · notas" em só leitura', offState)
    // iPad ao alto: tocar na linha = editar a música → sem rede, o aviso
    await trackToasts(page)
    await page.locator('[class*="_songTitle_"]').first().click({ force: true })
    ok(!!(await toastSeen(page, BLOCK)), `O3b iPad ao alto: tocar na linha (editar) → aviso "${BLOCK}"`, await page.evaluate(() => window.__toasts))
    ok(!(await page.evaluate(() => window.__toasts.some(t => /^Erro/i.test(t)))), 'O3b: o aviso é neutro (sem "ERRO": é o estado esperado sem rede)', await page.evaluate(() => window.__toasts))
    await page.waitForTimeout(500)
    ok(pathOf(page) === here, 'O3b iPad ao alto: fica na página do concerto (nada se abre sem dados)', page.url())
    await page.locator('button[aria-label="Remover da setlist"]').first().click({ force: true })
    ok(!!(await toastSeen(page, 'Tirar músicas do concerto precisa de rede')), 'O3b iPad ao alto: ✕ → "Tirar músicas do concerto precisa de rede"', await page.evaluate(() => window.__toasts))

    // O tom/notas sem rede: o aviso do próprio modal e os botões não podem ficar
    // por baixo do aviso global "Sem ligação" (fixo, por cima dos modais)
    const dlg = page.locator('[role="dialog"]', { hasText: 'Só neste concerto' })
    const coveredInDialog = () => page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find(x => x.textContent.includes('Só neste concerto'))
      if (!d) return null
      const banner = document.querySelector('[data-offline-banner]')
      const btn = t => [...d.querySelectorAll('button')].find(b => b.textContent.replace(/\s+/g, ' ').trim() === t)
      return [
        ['aviso do modal', d.querySelector('[class*="_ovOffline_"]')],
        ['Editar letra e música', btn('Editar letra e música')],
        ['Cancelar', btn('Cancelar')],
        ['Guardar', btn('Guardar')],
      ].filter(([, el]) => el).map(([name, el]) => {
        el.scrollIntoView({ block: 'nearest' })
        const b = el.getBoundingClientRect()
        // Três pontos ao longo do elemento (esquerda, meio, direita)
        const hits = [0.15, 0.5, 0.85].map(f => document.elementFromPoint(b.left + b.width * f, b.top + b.height / 2))
        // Só conta o aviso global (os toasts desaparecem sozinhos)
        const by = hits.find(h => h && !el.contains(h) && banner?.contains(h))
        return { name, covered: !!by, by: by ? 'aviso global "Sem ligação"' : null }
      }).filter(x => x.covered)
    })
    async function checkDialogCover(label, shotName) {
      await dlg.waitFor({ timeout: 3000 }).catch(() => {})
      await page.waitForFunction(() => !document.querySelector('[class*="_toast_"]'), null, { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(250)
      const cov = await coveredInDialog()
      ok(Array.isArray(cov) && cov.length === 0, `${label}: nada do tom/notas fica por baixo do aviso global "Sem ligação"`, cov)
      // O aviso do modal alinhado com os campos e os botões (mesma margem)
      const al = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].find(x => x.textContent.includes('Só neste concerto'))
        const note = d?.querySelector('[class*="_ovOffline_"]')
        const field = d?.querySelector('#ov-key')
        const footer = note?.nextElementSibling
        if (!note || !field || !footer) return null
        const r = document.createRange()
        r.selectNodeContents(note)
        const t = r.getBoundingClientRect()
        return { texto: Math.round(t.left * 10) / 10, campos: Math.round(field.getBoundingClientRect().left * 10) / 10, espacoAbaixo: Math.round((footer.getBoundingClientRect().top - t.bottom) * 10) / 10 }
      })
      ok(!!al && Math.abs(al.texto - al.campos) <= 1, `${label}: aviso "Sem ligação" do modal alinhado com os campos`, al)
      if (shotName) await shot(page, shotName)
    }
    await page.locator('button[aria-label^="Tom nesta setlist: D"]').first().click()
    await checkDialogCover('O3b iPad ao alto')
    await dlg.locator('button[aria-label="Fechar"]').click().catch(() => {})

    // Telemóvel: o ⓘ da linha abre o tom/notas, com o atalho para a música
    await page.setViewportSize(PHONE)
    await page.waitForTimeout(300)
    await page.locator('[class*="_songRow_"]', { hasText: 'Carrossel de Agosto' }).first().locator('button[aria-label^="Ver detalhes"]').click()
    await dlg.waitFor({ timeout: 3000 }).catch(() => {})
    ok(/Sem ligação — o tom e as notas não podem ser guardados agora/.test(await dlg.textContent().catch(() => '')), 'O3b telemóvel: tom/notas com o aviso "Sem ligação"')
    ok(await dlg.locator('button', { hasText: /^Guardar$/ }).isDisabled().catch(() => false), 'O3b telemóvel: "Guardar" desativado')
    await checkDialogCover('O3b telemóvel', 'O3b-tom-notas-telemovel')
    await trackToasts(page)
    await dlg.locator('button', { hasText: 'Editar letra e música' }).click({ force: true })
    ok(!!(await toastSeen(page, BLOCK)), `O3b telemóvel: "Editar letra e música" → aviso "${BLOCK}"`, await page.evaluate(() => window.__toasts))
    await page.waitForTimeout(500)
    ok(pathOf(page) === here && await dlg.count() === 1, 'O3b telemóvel: fica no tom/notas (nada se perde)', page.url())
    await shot(page, 'O3b-editar-musica-telemovel')
    await dlg.locator('button[aria-label="Fechar"]').click().catch(() => {})

    // Telemóvel: a linha de estado parte sem "·" pendurado; o fim da página fica acima do aviso global
    const stLine = await page.evaluate(() => {
      const el = document.querySelector('[data-offline-status]')
      if (!el) return null
      const items = [...el.children].filter(c => c.getBoundingClientRect().width > 0)
      return items.map(c => ({ t: c.textContent.trim(), h: Math.round(c.getBoundingClientRect().height), top: Math.round(c.getBoundingClientRect().top) }))
    })
    const dot = stLine?.find(x => /^· Cópia guardada/.test(x.t))
    ok(!!dot && dot.h <= 20, 'O3b telemóvel: "· Cópia guardada às…" inteiro numa linha (o "·" vai com o texto)', stLine)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(300)
    const bottom = await page.evaluate(() => {
      const banner = document.querySelector('[data-offline-banner]')?.getBoundingClientRect()
      const root = document.querySelector('main > :first-child')
      const kids = root ? [...root.querySelectorAll('button, [class*="_songRow_"]')].filter(e => e.getBoundingClientRect().height > 0) : []
      const last = kids.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]?.getBoundingClientRect()
      return banner && last ? { banner: { top: Math.round(banner.top), bottom: Math.round(banner.bottom) }, ultimo: { top: Math.round(last.top), bottom: Math.round(last.bottom) } } : null
    })
    ok(!!bottom && bottom.ultimo.bottom <= bottom.banner.top, 'O3b telemóvel: no fim do scroll, nada da página fica por baixo do aviso global', bottom)
    const bannerH = await page.evaluate(() => Math.round(document.querySelector('[data-offline-banner]')?.getBoundingClientRect().height ?? 0))
    ok(bannerH > 0 && bannerH <= 46, 'O3b telemóvel: o aviso global numa só linha (texto curto)', bannerH)
    await shot(page, 'O3b-concerto-fim-telemovel')
    // A lista Concertos sem rede no telemóvel (capturas)
    await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-offline-list]', { timeout: 6000 }).catch(() => {})
    await shot(page, 'O3b-concertos-telemovel')
    await page.goto(`${BASE}${here}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-offline-status="readonly"]', { timeout: 6000 }).catch(() => {})

    // iPad deitado (≥1024px): o ⓘ seleciona a música para o painel e abre o tom/notas; o painel tem "Editar letra"
    await page.setViewportSize(TABLET_LAND)
    await page.waitForTimeout(300)
    await page.locator('[class*="_songRow_"]', { hasText: 'Barraca das Farturas' }).first().locator('button[aria-label^="Ver detalhes"]').click()
    await checkDialogCover('O3b iPad deitado', 'O3b-tom-notas-ipad-paisagem')
    await dlg.locator('button[aria-label="Fechar"]').click().catch(() => {})
    const edit = page.locator('aside button', { hasText: 'Editar letra' }).first()
    await edit.waitFor({ timeout: 3000 }).catch(() => {})
    ok(await edit.getAttribute('aria-disabled').catch(() => null) === 'true', 'O3b iPad deitado: "Editar letra" do painel apagado como o ✎')
    await trackToasts(page)
    const t1 = Date.now()
    await edit.click({ force: true, timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(600)
    const where = pathOf(page)
    let seen = null
    if (where !== here) {
      // Abriu a página da música sem rede: o que mostra quando o pedido falha?
      seen = await until(async () => {
        const txt = (await page.locator('main').first().textContent().catch(() => '')) ?? ''
        if (/Música não encontrada/.test(txt)) return 'Música não encontrada'
        if (txt.includes('Açúcar e canela na ponta dos dedos')) return 'letra'
        return null
      }, 15000, 300)
      await shot(page, 'O3b-editar-letra-ipad-paisagem')
    }
    ok(where === here || seen === 'letra',
      'O3b iPad deitado: "Editar letra" do painel sem rede é bloqueado como o ✎ (ou abre a letra guardada) — nunca "Música não encontrada"',
      { url: page.url(), mostra: seen, aoFimDe: `${Math.round((Date.now() - t1) / 100) / 10} s`, avisos: await page.evaluate(() => window.__toasts).catch(() => null) })
    ok(!!(await toastSeen(page, 'Editar a letra precisa de rede')), 'O3b iPad deitado: o toque diz "Editar a letra precisa de rede"', await page.evaluate(() => window.__toasts).catch(() => null))
    // Link direto para a música sem rede: "Sem ligação" logo (nunca "Música não encontrada" ao fim de ~7 s)
    const t2 = Date.now()
    await page.goto(`${BASE}/songs/sgO3?setlist=${SID}`, { waitUntil: 'domcontentloaded' })
    const unav = await until(() => page.locator('[data-song-unavailable]').first().getAttribute('data-song-unavailable').catch(() => null), 8000, 200)
    ok(unav === 'offline' && Date.now() - t2 < 4000, 'O3b: a página da música sem rede diz "Sem ligação" (não "Música não encontrada")', { unav, ms: Date.now() - t2 })
    await shot(page, 'O3b-musica-sem-rede-ipad-paisagem')
    await page.setViewportSize(TABLET_PORT)
    ok(errors.length === 0, 'O3b: sem erros na página', errors)
  })

  // ══ O4 ═════════════════════════════════════════════════════════════════════
  if (want('O4')) await scenario('O4', 'Sessão: access token EXPIRADO sem rede (modo avião e Wi-Fi sem internet) e sem sessão nenhuma', async opened => {
    const expired = JSON.stringify({ ...SESSION, expires_in: -3600, expires_at: Math.floor(Date.now() / 1000) - 3600 })
    // a) modo avião + token expirado
    NET.down = true
    SRV.down = true
    let { ctx, page, errors } = await launch({ offline: true })
    opened.push(ctx)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [AUTH_KEY, expired])
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-offline-concerts]', { timeout: 8000 }).catch(() => {})
    ok(pathOf(page) === '/', 'O4a: token expirado em modo avião → não vai para /auth', page.url())
    ok((await textOf(page, '[data-offline-concerts]')).includes(OFF_NAME), 'O4a: mostra os concertos guardados')
    await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-offline-list]', { timeout: 8000 }).catch(() => {})
    ok(pathOf(page) === '/setlists' && (await page.locator('main').first().textContent()).includes(OFF_NAME), 'O4a: lista Concertos com os guardados', page.url())
    await page.waitForTimeout(6000)
    ok(pathOf(page) === '/setlists', 'O4a: 6 s depois continua (sem /auth)', page.url())

    // c) sem sessão nenhuma → /auth (mesmo com concertos guardados)
    await page.evaluate(k => localStorage.removeItem(k), AUTH_KEY)
    await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(u => new URL(u).pathname === '/auth', { timeout: 6000 }).catch(() => {})
    ok(pathOf(page) === '/auth', 'O4c: sem sessão → /auth (não abre o palco)', page.url())
    ok(await countOf(page, S.counterNow) === 0, 'O4c: o palco não aparece')
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(u => new URL(u).pathname === '/auth', { timeout: 6000 }).catch(() => {})
    ok(pathOf(page) === '/auth', 'O4c: sem sessão, "/" → /auth', page.url())
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [AUTH_KEY, expired])
    ok(errors.length === 0, 'O4a/c: sem erros na página', errors)
    await ctx.close()
    opened.length = 0

    // b) Wi-Fi sem internet (navigator.onLine = true) + token expirado: o supabase-js
    //    tenta renovar e falha; nada pode mandar para /auth nem pendurar o palco
    NET.down = true
    SRV.down = true
    ;({ ctx, page, errors } = await launch({ offline: false }))
    opened.push(ctx)
    const t0 = Date.now()
    await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
    const up = await waitStage(page, null, 8000)
    ok(up && Date.now() - t0 < 3000, `O4b: palco com a cópia em ${Date.now() - t0} ms (< 3 s)`)
    const offAt = await until(() => countOf(page, S.offTag), 25000, 500)
    ok(!!offAt, `O4b: passa a OFFLINE depois de um pedido falhar (${Math.round((Date.now() - t0) / 1000)} s)`)
    const left = 35000 - (Date.now() - t0)
    if (left > 0) await page.waitForTimeout(left)
    ok(pathOf(page) === `/setlist/${SID}/concert`, 'O4b: aos 35 s continua no palco (nunca /auth)', page.url())
    let s = await stage(page)
    ok(/\/ 05$/.test(s.counter) && s.lines.length > 0, 'O4b: alinhamento e letra intactos', s.counter)
    await page.click(S.next)
    await page.waitForTimeout(300)
    s = await stage(page)
    ok(s.lines.length > 0 && s.title !== '—', 'O4b: muda de música', s.title)
    // Sair do palco (sem rede, token expirado): a página do concerto em só leitura, sem /auth
    await page.click('button[aria-label="Sair do concerto"]')
    await page.click(confirmBtn('Sair'))
    await page.waitForSelector('[data-offline-status]', { timeout: 8000 }).catch(() => {})
    ok(pathOf(page) === `/setlist/${SID}` && await countOf(page, '[data-offline-status="readonly"]') === 1, 'O4b: sai para a página do concerto (só leitura)', page.url())
    const hits = SRV.hits.filter(p => p !== '/sw.js')
    ok(hits.length === 0, 'O4b: a app veio toda do SW (Wi-Fi sem internet)', hits.slice(0, 5))
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [AUTH_KEY, JSON.stringify(fresh(SESSION))])
    ok(errors.length === 0, 'O4b: sem erros na página', errors)
  })

  // ══ O5 ═════════════════════════════════════════════════════════════════════
  if (want('O5')) await scenario('O5', 'A rede cai a meio do concerto; reordenar sem rede; a rede volta', async opened => {
    const { ctx, page, errors } = await launch({ viewport: TABLET_LAND })
    opened.push(ctx)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(id => { localStorage.removeItem(`gigio-concert-pos-${id}`); sessionStorage.clear() }, SID)
    NET.log = []
    NET.writes = []
    await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'networkidle' })
    await waitStage(page, '01')
    let s = await stage(page)
    ok(s.live && !s.offline, 'O5: com rede, AO VIVO', s)
    // A sincronização vem com o concerto inteiro (um pedido para todas), nunca música a música
    await until(() => NET.log.some(l => l.table === 'lyric_syncs'), 4000)
    const oneByOne = NET.log.filter(l => l.table === 'lyric_syncs' && l.query.includes('song_id=eq.sgO3')).length
    ok(oneByOne === 0 && NET.log.some(l => l.table === 'lyric_syncs' && /song_id=in\.\(.*sgO3/.test(l.query)),
      'O5: a sync da 3.ª música ainda não tinha sido pedida sozinha', NET.log.filter(l => l.table === 'lyric_syncs').map(l => l.query))

    // A rede cai
    await netOff(ctx)
    await page.waitForSelector(S.offTag, { timeout: 4000 }).catch(() => {})
    ok(await countOf(page, S.offTag) === 1, 'O5: OFFLINE quando a rede cai')
    await page.click(S.next)
    await waitStage(page, '02')
    await page.click(S.next)
    await waitStage(page, '03')
    s = await stage(page)
    ok(s.title === 'Barraca das Farturas' && s.transport && !/indisponível/i.test(s.deck), 'O5: avança para a música com sync (nunca pedida sozinha) e tem o transporte', { title: s.title, transport: s.transport, deck: s.deck })
    await page.click('button[aria-label="Reproduzir"]')
    const lit = await page.waitForFunction(() => document.querySelector('[class*="_lyricActive_"]')?.textContent?.trim(), null, { timeout: 4000 })
      .then(h => h.jsonValue(), () => null)
    ok(lit === SYNC_LINES[0], 'O5: a sync funciona sem rede', lit)
    await page.click('button[aria-label="Pausar"]').catch(() => {})

    // Reordenar sem rede (coluna do alinhamento, iPad deitado)
    await page.click('button:has-text("Editar ordem")')
    await page.click('button[aria-label="Subir Última Volta"]')
    const told = await until(() => countOf(page, 'text=a nova ordem fica neste aparelho'), 3000)
    ok(!!told, 'O5: aviso "Sem rede — a nova ordem fica neste aparelho…"')
    ok(await countOf(page, 'text=Não foi possível guardar a nova ordem') === 0, 'O5: sem aviso de erro')
    // O aviso em palco aparece logo acima da barra e não apanha toques: nunca tapa o visor, o "A seguir"
    // nem as teclas, nem o aviso de pausa no topo da letra
    const toastPos = await page.evaluate(() => {
      const t = document.querySelector('[class*="_toast_"]')
      if (!t) return null
      const tb = t.getBoundingClientRect()
      const footer = document.querySelector('footer')?.getBoundingClientRect()
      const prev = document.querySelector('button[aria-label^="Música anterior"]')
      const pb = prev?.getBoundingClientRect()
      const hit = pb ? document.elementFromPoint(pb.left + pb.width / 2, pb.top + pb.height / 2) : null
      const chip = document.querySelector('[class*="_chipSlot_"] > *')?.getBoundingClientRect()
      return {
        toastTop: Math.round(tb.top), toastBottom: Math.round(tb.bottom), footerTop: footer ? Math.round(footer.top) : null,
        chipBottom: chip ? Math.round(chip.bottom) : null,
        pointer: getComputedStyle(t).pointerEvents, prevHit: !!hit && !!prev && prev.contains(hit),
      }
    })
    ok(!!toastPos && toastPos.footerTop !== null && toastPos.toastBottom < toastPos.footerTop && toastPos.footerTop - toastPos.toastBottom <= 40
      && (toastPos.chipBottom === null || toastPos.toastTop > toastPos.chipBottom) && toastPos.pointer === 'none' && toastPos.prevHit,
      'O5: o aviso fica logo acima da barra (sem tapar as teclas nem o aviso de pausa) e não apanha toques', toastPos)
    // Etiqueta "Ordem por enviar" no alinhamento e o ponto no ≡ (ficam até o servidor a aceitar)
    ok(await countOf(page, '[data-order-pending]') === 1 && /Ordem por enviar/.test(await textOf(page, '[data-order-pending]')), 'O5: "Ordem por enviar" no alinhamento')
    ok(await countOf(page, '[data-order-dot]') === 1, 'O5: ponto no ≡ (ordem por enviar)')
    await shot(page, 'O5-ordem-por-enviar-paisagem')
    await page.click('button:has-text("Concluir")')
    const newOrder = ['ssO1', 'ssO2', 'ssO3', 'ssO5', 'ssO4']
    const newTitles = ['Luzes da Feira', 'Carrossel de Agosto', 'Barraca das Farturas', 'Última Volta', 'Fogo de Vista']
    s = await stage(page)
    ok(/^03 \/ 05$/.test(s.counter) && s.title === 'Barraca das Farturas', 'O5: continua na mesma música', s.counter)
    const pend = await until(() => idbGet(page, `u:u1:order:${SID}`), 3000)
    ok(JSON.stringify(pend?.ids) === JSON.stringify(newOrder), 'O5: ordem pendente no IndexedDB', pend?.ids)
    const copy = await until(async () => {
      const c = await idbGet(page, `u:u1:concert:${SID}`)
      return JSON.stringify(c?.rows?.map(r => r.id)) === JSON.stringify(newOrder) ? c : null
    }, 3000)
    ok(!!copy, 'O5: a cópia do concerto já tem a ordem nova')
    ok(NET.writes.filter(w => w.table === 'setlist_songs').length === 0, 'O5: nada chegou ao servidor sem rede')

    // Recarregar sem rede (o iOS fechou a app): tudo como estava
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitStage(page, '03')
    s = await stage(page)
    ok(/^03 \/ 05$/.test(s.counter) && s.title === 'Barraca das Farturas' && s.offline, 'O5: recarregado sem rede, na mesma música e OFFLINE', { counter: s.counter, title: s.title })
    ok(JSON.stringify(await setlistTitles(page)) === JSON.stringify(newTitles), 'O5: recarregado sem rede, a ordem nova mantém-se', await setlistTitles(page))
    ok(!!(await until(() => countOf(page, '[data-order-pending]'), 3000)), 'O5: recarregado sem rede, "Ordem por enviar" continua')
    await shot(page, 'O5-palco-rede-caiu-paisagem')

    // A rede volta
    await netOn(ctx)
    const sent = await until(() => NET.writes.filter(w => w.table === 'setlist_songs' && w.method === 'POST').length >= 2, 10000, 200)
    const ups = NET.writes.filter(w => w.table === 'setlist_songs' && w.method === 'POST').map(w => w.body)
    ok(!!sent && ups[0]?.every((r, i) => r.position === 10000 + i) && JSON.stringify(ups[1]?.map(r => r.id)) === JSON.stringify(newOrder) && ups[1].every((r, i) => r.position === i),
      'O5: a rede volta → a ordem é enviada (2 upserts)', ups.map(u => u?.map(r => `${r.id}:${r.position}`)))
    ok(!!(await until(() => countOf(page, 'text=Nova ordem de "Arraial da Ribeira" enviada'), 4000)), 'O5: aviso "Nova ordem de … enviada"')
    ok(!!(await until(async () => !(await idbGet(page, `u:u1:order:${SID}`)), 4000)), 'O5: a ordem deixa de estar pendente')
    ok(!!(await until(async () => (await countOf(page, '[data-order-pending]')) === 0 && (await countOf(page, '[data-order-dot]')) === 0, 4000)), 'O5: "Ordem por enviar" e o ponto no ≡ saem')
    const server = TABLES.setlist_songs.filter(r => r.setlist_id === SID).sort((a, b) => a.position - b.position).map(r => r.id)
    ok(JSON.stringify(server) === JSON.stringify(newOrder), 'O5: o servidor ficou com a ordem nova', server)
    await page.waitForSelector(S.offTag, { state: 'detached', timeout: 5000 }).catch(() => {})
    s = await stage(page)
    ok(!s.offline && s.live, 'O5: volta a AO VIVO', { offline: s.offline, live: s.live })
    ok(/^03 \/ 05$/.test(s.counter) && s.title === 'Barraca das Farturas' && JSON.stringify(await setlistTitles(page)) === JSON.stringify(newTitles),
      'O5: nada se perdeu (música, ordem)', s.counter)
    const after = await idbGet(page, `u:u1:concert:${SID}`)
    ok(after?.rows?.length === 5 && !!after?.syncs?.sgO3 && !!after?.annotations?.sgO1 && JSON.stringify(after.rows.map(r => r.id)) === JSON.stringify(newOrder),
      'O5: a cópia continua completa e com a ordem nova', after?.rows?.map(r => r.id))
    ok(await countOf(page, 'button[aria-label^="Editar letra"]') === 0, 'O5: o palco continua sem botão "Editar letra"')

    // ── O5b: uma versão nova da app (SW) não recarrega o palco ──
    console.log('— O5b. Versão nova da app com o palco aberto')
    // Palco aberto com rede e o registo do SW da app pronto (o caminho normal:
    // a verificação de 60 em 60 s ou a do browser). Recarregado SEM rede, o
    // register() pode ficar pendente até a rede voltar e, se a versão nova
    // chegar nesse instante, o workbox-window não a vê (ver o relatório)
    await page.reload({ waitUntil: 'load' })
    await waitStage(page, '03')
    const reg = await until(() => page.evaluate(() => window.__swReg), 8000)
    ok(reg === 'ok', 'O5b: registo do SW da app pronto', reg)
    await page.evaluate(() => {
      window.__palco = 1
      window.__cc = 0
      navigator.serviceWorker.addEventListener('controllerchange', () => { window.__cc++ })
    })
    SRV.swTag = `nova-versao-${Date.now()}`
    // update() repetido: o recarregar acima pode ter deixado em curso a verificação
    // do próprio browser (com o sw.js antigo) e um update() feito nesse instante
    // junta-se a ela — não vê a versão nova até à verificação seguinte (60 s)
    const swapped = await until(async () => {
      if (await page.evaluate(() => window.__cc > 0).catch(() => false)) return true
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {})).catch(() => {})
      return false
    }, 20000, 1000)
    ok(!!swapped, 'O5b: a versão nova do SW ficou ativa')
    await page.waitForTimeout(2500)
    const still = await page.evaluate(() => window.__palco === 1).catch(() => false)
    ok(still && pathOf(page) === `/setlist/${SID}/concert`, 'O5b: o palco NÃO recarrega com uma versão nova', page.url())
    await page.click('button[aria-label="Sair do concerto"]')
    await page.click(confirmBtn('Sair'))
    const reloaded = await until(() => page.evaluate(() => window.__palco === undefined).catch(() => false), 6000, 300)
    ok(!!reloaded && pathOf(page) === `/setlist/${SID}`, 'O5b: recarrega ao sair do palco', page.url())
    // O sw.js "novo" continua a ser servido: repô-lo era outra versão nova a meio do O6
    ok(errors.length === 0, 'O5: sem erros na página', errors)
  })

  // ══ O7 ═════════════════════════════════════════════════════════════════════
  if (want('O7')) await scenario('O7', 'Barra do modo concerto: sem "Depois"; o "A seguir" com a música certa e alinhado', async opened => {
    const browser = await chromium.launch({ executablePath: EXE })
    opened.push(browser)
    const views = [['telemovel', PHONE], ['ipad-retrato', TABLET_PORT], ['ipad-paisagem', TABLET_LAND]]
    for (const [vname, viewport] of views) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block' })
      await wire(ctx)
      await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v) }, [AUTH_KEY, JSON.stringify(fresh(SESSION))])
      const page = await ctx.newPage()
      const phone = viewport.width <= 640
      const wide = viewport.width >= 1024

      /** Abre o concerto na música n (1-based) e mede a barra */
      async function at(setlistId, n) {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
        await page.evaluate(([id, i]) => {
          sessionStorage.setItem(`concert-pos-${id}`, String(i))
          localStorage.removeItem(`gigio-concert-pos-${id}`)
        }, [setlistId, n - 1])
        await page.goto(`${BASE}/setlist/${setlistId}/concert`, { waitUntil: 'networkidle' })
        await waitStage(page, String(n).padStart(2, '0'))
        await page.waitForTimeout(250)
        return barInfo(page)
      }
      function checkBar(label, bar, nextNum, nextTitle, { strip, sync = false }) {
        if (!ok(!!bar, `${label}: barra no ecrã`)) return
        ok(!/Depois/i.test(bar.footerText) && bar.later === 0, `${label}: sem "Depois"`, bar.footerText.slice(0, 120))
        ok(bar.row.sw <= bar.row.cw + 1 && bar.row.r <= bar.vw + 0.5 && bar.row.l >= -0.5, `${label}: nada sai da barra`, bar.row)
        ok(!!bar.prev && !!bar.next && Math.abs(bar.prev.l - bar.row.l) <= 1 && Math.abs(bar.next.r - bar.row.r) <= 1,
          `${label}: ‹ e › nos cantos`, { prev: bar.prev, next: bar.next, row: bar.row })
        // Sem buracos: cada vizinho à distância do gap da linha
        const gaps = bar.kidBoxes.slice(1).map((b, i) => Math.round((b.l - bar.kidBoxes[i].r) * 10) / 10)
        ok(gaps.every(g => Math.abs(g - bar.gap) <= 1), `${label}: sem buracos entre ‹ · visor · A seguir · › (gap ${bar.gap}px)`, { kids: bar.kids, gaps })
        if (strip) {
          ok(bar.stripVisible && bar.cards.length === 1, `${label}: um só cartão ("A seguir")`, bar.cards)
          const c = bar.cards[0]
          if (c) {
            ok(c.label === `A seguir · ${nextNum}` && c.title === nextTitle, `${label}: "A seguir · ${nextNum}" ${nextTitle}`, { label: c.label, title: c.title })
            ok(Math.abs(c.t - bar.next.t) <= 1 && Math.abs(c.b - bar.next.b) <= 1, `${label}: cartão alinhado com as teclas (mesma altura)`, { card: c, next: bar.next })
            ok(Math.abs(bar.next.l - c.r - bar.gap) <= 1, `${label}: cartão encostado ao ›`, { cardR: c.r, nextL: bar.next.l })
            if (sync) ok(c.w >= 200, `${label}: cartão legível ao lado do transporte (≥ 200px)`, c.w)
            else ok(c.titleFits, `${label}: título inteiro, sem reticências`, c.title)
          }
        } else {
          ok(!bar.stripVisible, `${label}: sem cartão na barra`, bar.kids)
        }
        if (phone) {
          ok(nextNum ? JSON.stringify(bar.nextLine) === JSON.stringify(['A seguir', '·', nextNum, '·', nextTitle]) : bar.nextLine === null,
            `${label}: micro-linha ${nextNum ? `"A seguir · ${nextNum} · ${nextTitle}"` : 'ausente na última'}`, bar.nextLine)
          if (bar.nextLineBox) ok(bar.nextLineBox.l >= bar.row.l - 1 && bar.nextLineBox.r <= bar.row.r + 1, `${label}: micro-linha dentro da barra`, bar.nextLineBox)
        } else {
          ok(bar.nextLine === null, `${label}: sem micro-linha no tablet`, bar.nextLine)
        }
      }

      const v = `O7 ${vname}`
      // O caso do pedido: a 10.ª do Jantar → "A seguir · 11" (era também "Depois · 12")
      let bar = await at('s1', 10)
      checkBar(`${v} (10.ª)`, bar, '11', 'Sozinho', { strip: !phone && !wide })
      await shot(page, `O7-barra-${vname}`)
      if (bar?.footerBox) await shot(page, `O7-barra-${vname}-recorte`, { clip: { x: 0, y: bar.footerBox.t - 4, width: viewport.width, height: bar.footerBox.h + 8 } })
      if (wide) {
        // Coluna aberta: o "A seguir" está na coluna, na linha certa
        const tag = await page.$$eval('#concert-setlist li', lis => lis.map(li => ({
          tag: li.querySelector('[class*="_rowTag_"]')?.textContent?.trim() ?? null,
          title: li.querySelector('[class*="_rowTitle_"]')?.textContent?.trim(),
        })).filter(r => r.tag))
        ok(tag.length === 1 && tag[0].tag === 'A seguir' && tag[0].title === 'Sozinho', `${v}: coluna com "A seguir" na 11.ª`, tag)
        // Coluna recolhida: o cartão aparece (sozinho) e fica com o espaço que era do "Depois"
        await page.click('button[aria-label="Alinhamento"]')
        await page.waitForTimeout(300)
        bar = await barInfo(page)
        checkBar(`${v} coluna recolhida`, bar, '11', 'Sozinho', { strip: true })
        ok((bar?.cards?.[0]?.w ?? 0) >= 420 && (bar?.cards?.[0]?.w ?? 0) <= 721, `${v} coluna recolhida: cartão entre 420 e 720px (cresce com o ecrã)`, bar?.cards?.[0]?.w)
        await shot(page, `O7-barra-${vname}-coluna-recolhida`)
        if (bar?.footerBox) await shot(page, `O7-barra-${vname}-coluna-recolhida-recorte`, { clip: { x: 0, y: bar.footerBox.t - 4, width: viewport.width, height: bar.footerBox.h + 8 } })
        await page.click('button[aria-label="Alinhamento"]')
      } else if (!phone) {
        ok(Math.abs((bar?.cards?.[0]?.w ?? 0) - 360) <= 1, `${v}: cartão com 360px`, bar?.cards?.[0]?.w)
      }
      // Com o transporte da sync (2.ª do Jantar)
      bar = await at('s1', 2)
      checkBar(`${v} com sync (2.ª)`, bar, '03', "Isn't She Lovely", { strip: !phone && !wide, sync: true })
      ok(bar?.kids?.includes('deck') && (await countOf(page, '[aria-label="Sincronização da letra"]')) === 1, `${v} com sync: transporte no visor`)
      await shot(page, `O7-barra-${vname}-sync`)
      if (wide) {
        // Coluna recolhida com o transporte: o cartão cresce e o transporte não fica a flutuar num visor largo
        await page.click('button[aria-label="Alinhamento"]')
        await page.waitForTimeout(300)
        bar = await barInfo(page)
        checkBar(`${v} com sync, coluna recolhida`, bar, '03', "Isn't She Lovely", { strip: true, sync: true })
        const tr = await page.evaluate(() => {
          const t = document.querySelector('[aria-label="Sincronização da letra"]')?.getBoundingClientRect()
          const dk = document.querySelector('[class*="_controlsRow_"] > [class*="_deck_"]')?.getBoundingClientRect()
          return t && dk ? { esquerda: Math.round(t.left - dk.left), direita: Math.round(dk.right - t.right) } : null
        })
        ok(!!tr && tr.esquerda <= 100 && tr.direita <= 100, `${v} com sync, coluna recolhida: sem vazios grandes à volta do transporte (≤ 100px)`, tr)
        ok((bar?.cards?.[0]?.w ?? 0) > 420, `${v} com sync, coluna recolhida: o cartão "A seguir" cresce (> 420px)`, bar?.cards?.[0]?.w)
        await shot(page, `O7-barra-${vname}-sync-coluna-recolhida`)
        if (bar?.footerBox) await shot(page, `O7-barra-${vname}-sync-coluna-recolhida-recorte`, { clip: { x: 0, y: bar.footerBox.t - 4, width: viewport.width, height: bar.footerBox.h + 8 } })
        await page.click('button[aria-label="Alinhamento"]')
      }
      // Concerto offline-first (5 músicas): 1.ª e a última (sem seguinte)
      bar = await at(SID, 1)
      checkBar(`${v} ${OFF_NAME} 1.ª`, bar, '02', 'Carrossel de Agosto', { strip: !phone && !wide })
      bar = await at(SID, 5)
      checkBar(`${v} última`, bar, null, null, { strip: false })
      ok(bar && bar.kids.length === 3 && bar.kids[1] === 'deck', `${v} última: ‹ · visor · › (sem ranhura vazia)`, bar?.kids)
      await ctx.close()
    }
  })

  // ══ O6 ═════════════════════════════════════════════════════════════════════
  if (want('O6')) await scenario('O6', 'Terminar sessão limpa a cópia; outro utilizador no mesmo browser não vê os concertos do primeiro', async opened => {
    NET.down = true
    SRV.down = true
    let { ctx, page, errors } = await launch({ offline: true })
    opened.push(ctx)
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
    ok((await idbKeys(page)).some(k => k.startsWith('u:u1:concert:')), 'O6: antes, há concertos do u1 guardados')
    // Uma ordem mudada sem rede ainda por enviar, e anotações do Ensaio: uma já na cloud, outra por juntar (pend)
    await idbPut(page, `u:u1:order:${SID}`, { userId: 'u1', setlistId: SID, ids: ['ssO2', 'ssO1', 'ssO3', 'ssO4', 'ssO5'], at: Date.now() })
    await page.evaluate(([a, b]) => {
      localStorage.setItem('gigio_ann_u_u1_sgO4', a)
      localStorage.setItem('gigio_ann_u_u1_sgPend', b)
    }, [JSON.stringify(P_LOCAL), JSON.stringify({ ...P_LOCAL, pend: 1 })])
    await page.click('button:has-text("Terminar sessão")')
    // Sem rede a ordem não segue: o diálogo diz que se perde (nunca em silêncio)
    const dlgText = await page.locator(':is([role="dialog"], [role="alertdialog"])').first().textContent({ timeout: 4000 }).catch(() => '')
    ok(dlgText.includes(`Há uma ordem por enviar de "${OFF_NAME}" que se perde`), 'O6: terminar sessão com uma ordem por enviar → o diálogo avisa', dlgText)
    await page.click(confirmBtn('Terminar sessão'))
    await page.waitForURL(u => new URL(u).pathname === '/auth', { timeout: 10000 }).catch(() => {})
    ok(pathOf(page) === '/auth', 'O6: terminar sessão SEM REDE → /auth', page.url())
    const keys = await idbKeys(page)
    ok(keys.length === 0, 'O6: IndexedDB vazio depois de terminar sessão', keys)
    const ls = await page.evaluate(() => Object.keys(localStorage).filter(k => /^sb-|gigio_projects|gigio-concert-pos|gigio-offline|gigio_dashboard|gigio_concert/.test(k)))
    ok(ls.length === 0, 'O6: sessão e caches do localStorage apagadas', ls)
    const annLeft = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gigio_ann')).sort())
    ok(JSON.stringify(annLeft) === JSON.stringify(['gigio_ann_u_u1_sgPend']), 'O6: terminar sessão apaga as anotações do u1 já na cloud; as por juntar (pend) ficam, só dele', annLeft)
    await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(u => new URL(u).pathname === '/auth', { timeout: 6000 }).catch(() => {})
    ok(pathOf(page) === '/auth' && await countOf(page, S.counterNow) === 0, 'O6: o palco do u1 já não abre (pede login)', page.url())
    await shot(page, 'O6-sessao-terminada-offline')

    // Outro utilizador entra (com rede) — não vê nada do primeiro
    await netOn(ctx)
    async function login(email) {
      // A app pode já estar a ir para /auth sozinha (sessão terminada): um
      // goto por cima é interrompido por essa navegação — basta esperar por ela
      // Entrada limpa em /auth (sem o "voltar para" de um redirecionamento anterior);
      // se a app interromper o goto com a sua própria ida para /auth, repete-se
      for (let i = 0; i < 3; i++) {
        const ok = await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' }).then(() => true, () => false)
        if (ok) break
        await page.waitForTimeout(400)
      }
      await page.waitForSelector('#auth-email', { timeout: 8000 })
      await page.fill('#auth-email', email)
      await page.fill('#auth-password', 'segredo123')
      await page.click('button[type="submit"]')
      await page.waitForURL(u => new URL(u).pathname === '/', { timeout: 10000 }).catch(() => {})
    }
    async function signOutOnline() {
      await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
      await page.click('button:has-text("Terminar sessão")')
      await page.click(confirmBtn('Terminar sessão'))
      await page.waitForURL(u => new URL(u).pathname === '/auth', { timeout: 10000 }).catch(() => {})
    }
    async function u2SeesNothing(label) {
      await page.waitForTimeout(2500)  // o guardar em segundo plano do u2 (1,5 s depois do arranque)
      const k = await idbKeys(page)
      ok(!k.some(x => x.startsWith('u:u1:') && !x.includes(':order:')), `${label}: nenhuma cópia do u1 no IndexedDB`, k)
      await netOff(ctx)
      await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('text=Nenhum concerto guardado', { timeout: 6000 }).catch(() => {})
      const txt = await page.locator('main').first().textContent().catch(() => '')
      ok(/Nenhum concerto guardado/.test(txt) && !txt.includes(OFF_NAME) && !txt.includes('Jantar'), `${label}: Concertos sem rede não mostra os do u1`, txt.slice(0, 160))
      await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-stage-empty]', { timeout: 6000 }).catch(() => {})
      const s = await stage(page)
      ok(s.empty === 'missing' && !s.lines.length && s.title !== 'Luzes da Feira', `${label}: o palco do concerto do u1 diz "não guardado neste aparelho"`, { empty: s.empty, title: s.title })
      await netOn(ctx)
    }
    await login(USER2.email)
    ok(pathOf(page) === '/', 'O6: o u2 entra', page.url())
    await u2SeesNothing('O6 u2 depois de o u1 terminar sessão')
    await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
    await shot(page, 'O6-outro-utilizador')

    // A sessão do u1 cai SEM "Terminar sessão" (ex.: token recusado) e entra o u2
    await signOutOnline()
    await login(USER.email)
    const back = await until(async () => (await idbKeys(page)).includes(`u:u1:concert:${SID}`), 15000, 300)
    ok(!!back, 'O6: o u1 volta a entrar e a cópia volta a ser guardada')
    // Uma ordem do u1 por enviar quando a sessão dele cai: fica (só ids), para seguir quando ele voltar
    await idbPut(page, `u:u1:order:${SID}`, { userId: 'u1', setlistId: SID, ids: ['ssO2', 'ssO1', 'ssO3', 'ssO4', 'ssO5'], at: Date.now() })
    await page.evaluate(k => localStorage.removeItem(k), AUTH_KEY)
    await login(USER2.email)
    ok(pathOf(page) === '/', 'O6: o u2 entra no lugar do u1', page.url())
    const gone = await until(async () => !(await idbKeys(page)).some(x => x.startsWith('u:u1:') && !x.includes(':order:')), 6000, 300)
    ok(!!gone, 'O6: as cópias do u1 saem quando entra outro utilizador', await idbKeys(page))
    ok((await idbKeys(page)).includes(`u:u1:order:${SID}`), 'O6: a ordem por enviar do u1 fica (não se perde em silêncio)', await idbKeys(page))
    ok(!(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('gigio_ann_u_u2_')))), 'O6: o u2 não fica com anotações do u1')
    await u2SeesNothing('O6 u2 depois de a sessão do u1 cair')
    ok(errors.length === 0, 'O6: sem erros na página', errors)
  })

  // ══ O8 ═════════════════════════════════════════════════════════════════════
  if (want('O8')) await scenario('O8', 'Guardar em segundo plano interrompido a meio (a app fecha; a rede cai) e retomado', async opened => {
    // O guardar vai por data, um concerto de cada vez: s4 (hoje), s1 (amanhã),
    // sOff (+3), s2 (+7), s3 (+14). Prende-se o pedido das músicas do sOff:
    // s4 e s1 ficam guardados, sOff, s2 e s3 ainda não.
    const ALL = ['s4', 's1', SID, 's2', 's3'].map(s => `u:u1:concert:${s}`)
    const missing = keys => ALL.filter(k => !keys.includes(k)).map(k => k.split(':').pop())
    function holdOffSongs() {
      let release = () => {}
      const hit = new Promise(resolve => {
        NET.gate = ({ table, method, url }) => {
          if (table !== 'setlist_songs' || method !== 'GET' || url.searchParams.get('setlist_id') !== `eq.${SID}`) return null
          NET.gate = null
          resolve(true)
          return new Promise(r => { release = r })
        }
      })
      return { hit: Promise.race([hit, sleep(15000).then(() => false)]), release: how => release(how) }
    }
    /** Outro aparelho (perfil próprio, sem SW: aqui só interessa o guardar), já com sessão */
    async function launchDevice(profile) {
      const ctx = await chromium.launchPersistentContext(profile, {
        executablePath: EXE, viewport: TABLET_PORT, deviceScaleFactor: 2, serviceWorkers: 'block',
      })
      await wire(ctx)
      await ctx.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v) } catch { /* */ } }, [AUTH_KEY, JSON.stringify(fresh(SESSION))])
      const page = ctx.pages()[0] ?? await ctx.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(String(e).split('\n')[0]))
      return { ctx, page, errors }
    }
    const throttleOf = page => page.evaluate(() => {
      const v = Number(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('gigio-offline-prefetch-')) ?? '')) || 0
      return v ? `há ${Math.round((Date.now() - v) / 100) / 10} s` : 'sem limite marcado'
    }).catch(() => '?')

    // a) A app fecha a meio do guardar (o iOS mata-a em segundo plano) e é reaberta logo, com rede
    const profA = mkdtempSync(path.join(os.tmpdir(), 'gigio-off-e2e-o8a-'))
    tmpDirs.push(profA)
    let hold = holdOffSongs()
    let { ctx, page, errors } = await launchDevice(profA)
    opened.push(ctx)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    ok(await hold.hit, 'O8a: o guardar em segundo plano chegou ao 3.º concerto (sOff) e ficou preso')
    let keys = await until(async () => { const k = await concertKeys(page); return k.includes('u:u1:concert:s1') ? k : null }, 5000) ?? await concertKeys(page)
    ok(JSON.stringify(missing(keys)) === JSON.stringify([SID, 's2', 's3']), 'O8a: a meio — s4 e s1 guardados; sOff, s2 e s3 ainda não', keys)
    ok(errors.length === 0, 'O8a: sem erros na página (1.ª abertura)', errors)
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
    hold.release('closed')
    await ctx.close()
    opened.length = 0
    ;({ ctx, page, errors } = await launchDevice(profA))
    opened.push(ctx)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
    keys = await until(async () => { const k = await concertKeys(page); return missing(k).length === 0 ? k : null }, 10000, 300) ?? await concertKeys(page)
    ok(missing(keys).length === 0, 'O8a: reaberta com rede (Projetos e Concertos), o guardar completa os que faltavam',
      { faltam: missing(keys), limiteDoGuardar: await throttleOf(page) })
    await page.waitForSelector('[data-offline]', { timeout: 3000 }).catch(() => {})
    const chips = await page.$$eval('[role="button"]', rows => rows.filter(r => r.querySelector('[data-offline]')).map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)))
    await shot(page, 'O8a-concertos-reaberta', { fullPage: true })
    // Passado o limite de 10 min (simulado) e a app de volta ao primeiro plano: completa
    if (missing(keys).length) {
      await page.evaluate(() => {
        const k = Object.keys(localStorage).find(x => x.startsWith('gigio-offline-prefetch-'))
        if (k) localStorage.setItem(k, String(Date.now() - 11 * 60 * 1000))
        document.dispatchEvent(new Event('visibilitychange'))
      })
      keys = await until(async () => { const k = await concertKeys(page); return missing(k).length === 0 ? k : null }, 10000, 300) ?? await concertKeys(page)
      ok(missing(keys).length === 0, 'O8a: (controlo) passado o limite de 10 min, o guardar completa', { faltam: missing(keys), chipsAntes: chips })
    }
    ok(errors.length === 0, 'O8a: sem erros na página', errors)
    await ctx.close()
    opened.length = 0

    // b) A rede cai a meio do guardar (Wi-Fi da sala que vai e vem) e volta com a app aberta
    const profB = mkdtempSync(path.join(os.tmpdir(), 'gigio-off-e2e-o8b-'))
    tmpDirs.push(profB)
    hold = holdOffSongs()
    ;({ ctx, page, errors } = await launchDevice(profB))
    opened.push(ctx)
    await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
    ok(await hold.hit, 'O8b: o guardar chegou ao sOff e ficou preso')
    await until(async () => (await concertKeys(page)).includes('u:u1:concert:s1'), 5000)
    await netOff(ctx)
    hold.release('net')
    await page.waitForTimeout(1500)
    keys = await concertKeys(page)
    ok(JSON.stringify(missing(keys)) === JSON.stringify([SID, 's2', 's3']), 'O8b: com a rede em baixo ficam só s4 e s1', keys)
    await netOn(ctx)
    const tBack = Date.now()
    keys = await until(async () => { const k = await concertKeys(page); return missing(k).length === 0 ? k : null }, 15000, 300) ?? await concertKeys(page)
    ok(missing(keys).length === 0, 'O8b: a rede volta → o guardar retoma e guarda os que faltavam',
      { faltam: missing(keys), esperei: `${Math.round((Date.now() - tBack) / 1000)} s`, limiteDoGuardar: await throttleOf(page) })
    ok(errors.length === 0, 'O8b: sem erros na página', errors)
    await ctx.close()
    opened.length = 0

    // c) Rede fraca: só o 1.º pedido das músicas falha (o browser continua "online"); a sonda
    //    vê que há internet e a volta seguinte guarda tudo — sem esperar 10 min
    const profC = mkdtempSync(path.join(os.tmpdir(), 'gigio-off-e2e-o8c-'))
    tmpDirs.push(profC)
    let failed = 0
    NET.gate = ({ table, method }) => {
      if (table !== 'setlist_songs' || method !== 'GET') return null
      NET.gate = null
      failed++
      return Promise.resolve('net')
    }
    ;({ ctx, page, errors } = await launchDevice(profC))
    opened.push(ctx)
    const tC = Date.now()
    await page.goto(`${BASE}/setlists`, { waitUntil: 'domcontentloaded' })
    keys = await until(async () => { const k = await concertKeys(page); return missing(k).length === 0 ? k : null }, 25000, 500) ?? await concertKeys(page)
    ok(failed === 1 && missing(keys).length === 0, 'O8c: um pedido falhado não deixa o guardar parado 10 min — a volta seguinte guarda tudo',
      { falhou: failed, faltam: missing(keys), aoFimDe: `${Math.round((Date.now() - tC) / 1000)} s`, limiteDoGuardar: await throttleOf(page) })
    ok(errors.length === 0, 'O8c: sem erros na página', errors)
  })

  // ── Aparelhos sem SW para os cenários que não precisam dele ──
  /**
   * Um "aparelho" (contexto novo, sem SW) já com sessão. `quiet`: o guardar em
   * segundo plano não corre (o limite marcado agora) — o cenário controla o
   * que fica guardado. `init`: script extra antes da app (instrumentação)
   */
  async function device(browser, { viewport = TABLET_PORT, session = fresh(SESSION), quiet = false, init = null } = {}) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block' })
    await wire(ctx)
    await ctx.addInitScript(([k, v, quiet]) => {
      try {
        if (!localStorage.getItem('__e2e_seeded')) {
          localStorage.setItem('__e2e_seeded', '1')
          localStorage.setItem(k, v)
          if (quiet) localStorage.setItem('gigio-offline-prefetch-u1', String(Date.now()))
        }
      } catch { /* */ }
    }, [AUTH_KEY, JSON.stringify(session), quiet])
    if (init) await ctx.addInitScript(init)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).split('\n')[0]))
    return { ctx, page, errors }
  }
  const statusOf = page => page.locator('[data-offline-status]').first().getAttribute('data-offline-status').catch(() => null)
  const waitStatus = (page, want, timeout = 8000) => until(async () => (await statusOf(page)) === want, timeout, 200)

  // ══ O9 ═════════════════════════════════════════════════════════════════════
  if (want('O9')) await scenario('O9', 'Concerto com data passada há mais de 30 dias aberto com rede; IndexedDB bloqueado', async opened => {
    const browser = await chromium.launch({ executablePath: EXE })
    opened.push(browser)
    let { ctx, page, errors } = await device(browser, { quiet: true })
    await page.goto(`${BASE}/setlist/${PAST_ID}`, { waitUntil: 'domcontentloaded' })
    ok(!!(await waitStatus(page, 'saved')), 'O9: alinhamento antigo (há 45 dias) aberto com rede → "Disponível offline"', await statusOf(page))
    const st = await textOf(page, '[data-offline-status]')
    ok(/Disponível offline/.test(st) && /Guardado às \d\d:\d\d/.test(st), 'O9: "Disponível offline · Guardado às HH:MM"', st)
    ok((await idbKeys(page)).includes(`u:u1:concert:${PAST_ID}`), 'O9: e a cópia está MESMO no IndexedDB (não foi podada ao gravar)', await idbKeys(page))
    const ent = (await idbGet(page, 'u:u1:index'))?.find?.(e => e.setlistId === PAST_ID)
    ok(!!ent && typeof ent.openedAt === 'number', 'O9: no índice, aberto à mão (openedAt)', ent)
    await shot(page, 'O9-concerto-antigo-guardado')
    // Sem rede, num separador novo (a memória da app vazia = app reaberta)
    NET.down = true
    const p2 = await ctx.newPage()
    await p2.goto(`${BASE}/setlist/${PAST_ID}/concert`, { waitUntil: 'domcontentloaded' })
    const up = await waitStage(p2, '01', 6000)
    const s = await stage(p2)
    ok(up && s.empty === null && s.lines.includes('Pela estrada fora vai a carrinha azul'), 'O9: sem rede, o palco tem o concerto antigo (nunca "não guardado")', { empty: s.empty, lines: s.lines })
    await p2.close()
    NET.down = false
    ok(errors.length === 0, 'O9: sem erros na página', errors)
    await ctx.close()

    // IndexedDB bloqueado (ex.: definições do browser): nunca "Disponível offline"
    ;({ ctx, page, errors } = await device(browser, {
      quiet: true,
      init: () => { IDBFactory.prototype.open = function () { throw new DOMException('bloqueado', 'SecurityError') } },
    }))
    opened.push(ctx)
    await page.goto(`${BASE}/setlist/${FAR_ID}`, { waitUntil: 'domcontentloaded' })
    ok(!!(await waitStatus(page, 'blocked')), 'O9: IndexedDB bloqueado → nunca "Disponível offline"', await statusOf(page))
    ok(/Este browser não deixa guardar para offline/.test(await textOf(page, '[data-offline-status]')), 'O9: diz "Este browser não deixa guardar para offline"', await textOf(page, '[data-offline-status]'))
    await shot(page, 'O9-indexeddb-bloqueado')
    ok(errors.length === 0, 'O9: sem erros na página (IndexedDB bloqueado)', errors)
  })

  // ══ O10 ════════════════════════════════════════════════════════════════════
  if (want('O10')) await scenario('O10', 'IndexedDB lento a abrir (3 s) no arranque', async opened => {
    const browser = await chromium.launch({ executablePath: EXE })
    opened.push(browser)
    // Com ?slowidb=N, a 1.ª abertura da base da app só é entregue N ms depois (WebKit a frio)
    const slowIdb = () => {
      const m = /slowidb=(\d+)/.exec(location.search)
      if (!m) return
      const delay = Number(m[1])
      const orig = IDBFactory.prototype.open
      let first = true
      window.__idbOpenedAt = null
      IDBFactory.prototype.open = function (...a) {
        const req = orig.apply(this, a)
        if (!first || a[0] !== 'gigio-offline') return req
        first = false
        let h = null
        Object.defineProperty(req, 'onsuccess', { configurable: true, get() { return h }, set(fn) { h = fn } })
        req.addEventListener('success', ev => { setTimeout(() => { window.__idbOpenedAt = Date.now(); h && h.call(req, ev) }, delay) })
        return req
      }
    }
    const { ctx, page, errors } = await device(browser, { quiet: true, init: slowIdb })
    // Com rede (IndexedDB normal): guarda o sFar
    await page.goto(`${BASE}/setlist/${FAR_ID}`, { waitUntil: 'domcontentloaded' })
    ok(!!(await waitStatus(page, 'saved')), 'O10: com rede, o concerto fica guardado', await statusOf(page))
    // Sem rede, IndexedDB lento: o palco chega à cópia, sem nunca dizer "não guardado"
    NET.down = true
    const p2 = await ctx.newPage()
    const t0 = Date.now()
    await p2.goto(`${BASE}/setlist/${FAR_ID}/concert?slowidb=3000`, { waitUntil: 'domcontentloaded' })
    const seen = new Set()
    const got = await until(async () => {
      const st = await stage(p2)
      if (st.empty) seen.add(st.empty)
      return st.lines.length > 0 ? st : null
    }, 12000, 150)
    ok(!!got && got.lines.includes('Pela estrada fora vai a carrinha azul'), `O10: sem rede e IndexedDB lento, o palco chega à cópia (${Date.now() - t0} ms)`, { estados: [...seen] })
    ok(!seen.has('missing'), 'O10: nunca "Concerto não guardado neste aparelho" pelo caminho', [...seen])
    await p2.close()
    // Com rede e IndexedDB lento: o que se guarda enquanto ele não abre vai para lá quando abrir
    NET.down = false
    const p3 = await ctx.newPage()
    await p3.goto(`${BASE}/setlist/${PAST_ID}?slowidb=3000`, { waitUntil: 'domcontentloaded' })
    // Cada estado visto e se o IndexedDB já tinha aberto nesse instante
    const trail = []
    const savedLate = await until(async () => {
      // Os dois lidos no mesmo instante (statusOf esperaria pelo elemento)
      const { st, opened } = await p3.evaluate(() => ({
        st: document.querySelector('[data-offline-status]')?.getAttribute('data-offline-status') ?? null,
        opened: !!window.__idbOpenedAt,
      })).catch(() => ({ st: null, opened: false }))
      if (st && (!trail.length || trail[trail.length - 1].st !== st)) trail.push({ st, opened })
      return st === 'saved'
    }, 12000, 100)
    ok(!trail.some(x => x.st === 'saved' && !x.opened), 'O10: com o IndexedDB ainda a abrir, nunca diz "Disponível offline"', trail)
    ok(!!savedLate, 'O10: quando o IndexedDB abre, fica guardado e diz "Disponível offline"', trail)
    await p3.close()
    const p4 = await ctx.newPage()
    await p4.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
    ok((await idbKeys(p4)).includes(`u:u1:concert:${PAST_ID}`), 'O10: depois de fechar, a cópia está no IndexedDB (não ficou só na memória)', await idbKeys(p4))
    ok(errors.length === 0, 'O10: sem erros na página', errors)
  })

  // ══ O11 ════════════════════════════════════════════════════════════════════
  if (want('O11')) await scenario('O11', 'Sessão recusada pelo servidor a meio do concerto: o palco fica e o ecrã não apaga', async opened => {
    const browser = await chromium.launch({ executablePath: EXE })
    opened.push(browser)
    const wake = () => {
      window.__wl = { req: 0, rel: 0, active: 0 }
      try {
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: {
            request: async () => {
              window.__wl.req++; window.__wl.active++
              const s = { released: false, type: 'screen', addEventListener() {}, removeEventListener() {},
                release: async () => { if (!s.released) { s.released = true; window.__wl.rel++; window.__wl.active-- } } }
              return s
            },
          },
        })
      } catch { /* */ }
    }
    // A sessão expira daqui a 125 s: o supabase-js tenta renová-la (a cada 30 s) e o servidor recusa
    const sess = { ...SESSION, expires_in: 125, expires_at: Math.floor(Date.now() / 1000) + 125 }
    const { page, errors } = await device(browser, { quiet: true, session: sess, init: wake })
    await page.goto(`${BASE}/setlist/${FAR_ID}/concert`, { waitUntil: 'domcontentloaded' })
    await waitStage(page, '01', 8000)
    await page.waitForTimeout(800)
    const before = await page.evaluate(() => ({ ...window.__wl }))
    ok(before.req >= 1 && before.active === 1, 'O11: wake lock pedido ao abrir o palco', before)
    NET.tokenReject = true
    const t0 = Date.now()
    await page.waitForFunction(k => !localStorage.getItem(k), AUTH_KEY, { timeout: 75000 }).catch(() => {})
    const gone = !(await page.evaluate(k => localStorage.getItem(k), AUTH_KEY))
    ok(gone, `O11: o supabase-js terminou a sessão (recusada pelo servidor, ${Math.round((Date.now() - t0) / 1000)} s)`)
    await page.waitForTimeout(1200)
    const s = await stage(page)
    ok(pathOf(page) === `/setlist/${FAR_ID}/concert` && s.lines.length > 0, 'O11: o palco fica montado, com a letra', { url: page.url(), lines: s.lines.length })
    const after = await page.evaluate(() => ({ ...window.__wl }))
    ok(after.rel === 0 && after.active === 1, 'O11: o wake lock NÃO é largado (o ecrã não apaga a meio da música)', after)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(300)
    ok((await page.evaluate(() => window.__wl.active)) >= 1, 'O11: e continua depois de a app voltar ao primeiro plano')
    ok(await countOf(page, '[data-session-gone]') === 1 && /Sem sessão/.test(await textOf(page, '[data-session-gone]')), 'O11: aviso discreto "Sem sessão" no lugar de "Ao vivo"')
    await page.click(S.next)
    ok(await waitStage(page, '02', 3000), 'O11: continua a mudar de música')
    await shot(page, 'O11-sessao-terminada-palco')
    ok(errors.length === 0, 'O11: sem erros na página', errors)
  })

  // ══ O12 ════════════════════════════════════════════════════════════════════
  if (want('O12')) await scenario('O12', 'Letra corrigida na página da música (com rede) → o palco sem rede tem a letra nova', async opened => {
    const browser = await chromium.launch({ executablePath: EXE })
    opened.push(browser)
    const song = TABLES.songs.find(x => x.id === 'sgO5')
    const keep = { lyrics: song.lyrics, edited_lyrics: song.edited_lyrics, updated_at: song.updated_at }
    try {
      const { ctx, page, errors } = await device(browser, { quiet: true })
      await page.goto(`${BASE}/setlist/${SID}`, { waitUntil: 'domcontentloaded' })
      ok(!!(await waitStatus(page, 'saved')), 'O12: concerto guardado com rede', await statusOf(page))
      // Corrigir a letra na página da música (gravação automática)
      await page.goto(`${BASE}/songs/sgO5?setlist=${SID}`, { waitUntil: 'domcontentloaded' })
      const ta = page.locator('textarea[aria-label="Letra"]').first()
      await ta.waitFor({ timeout: 6000 })
      const NEW = `${LYR.sgO5}\nLinha corrigida antes de sair de casa`
      await ta.fill(NEW)
      const saved = await until(async () => {
        const c = await idbGet(page, `u:u1:concert:${SID}`)
        return c?.rows?.find(r => r.song?.id === 'sgO5')?.song?.edited_lyrics === NEW
      }, 8000, 250)
      ok(NET.writes.some(w => w.table === 'songs' && w.method === 'PATCH'), 'O12: a letra foi gravada no servidor')
      ok(!!saved, 'O12: a cópia do concerto neste aparelho ficou com a letra nova (sem esperar pelo guardar em segundo plano)')
      ok(await page.evaluate(() => localStorage.getItem('gigio-offline-prefetch-u1')) === '0', 'O12: o guardar em segundo plano volta a correr já (limite dos 10 min posto a zero)')
      // Sem rede, o palco
      NET.down = true
      const p2 = await ctx.newPage()
      await p2.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
      await waitStage(p2, null, 6000)
      for (let i = 0; i < 6 && (await stage(p2)).title !== 'Última Volta'; i++) {
        await p2.click(S.next).catch(() => {})
        await p2.waitForTimeout(200)
      }
      const st = await stage(p2)
      ok(st.title === 'Última Volta' && st.lines.includes('Linha corrigida antes de sair de casa'), 'O12: sem rede, o palco mostra a letra corrigida', { title: st.title, lines: st.lines })
      await shot(p2, 'O12-palco-letra-corrigida')
      ok(errors.length === 0, 'O12: sem erros na página', errors)
    } finally {
      Object.assign(song, keep)
    }
  })

  // ══ O13 ════════════════════════════════════════════════════════════════════
  if (want('O13')) await scenario('O13', 'Palco sem rede num concerto não guardado; a rede volta', async opened => {
    const browser = await chromium.launch({ executablePath: EXE })
    opened.push(browser)
    const { page, errors } = await device(browser, { quiet: true })
    // Wi-Fi da sala sem internet (o browser diz que há rede; os pedidos falham)
    NET.down = true
    await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-stage-empty="missing"]', { timeout: 10000 }).catch(() => {})
    let s = await stage(page)
    ok(s.empty === 'missing', 'O13: "Concerto não guardado neste aparelho"', s.empty)
    ok(/Não guardado/i.test(s.deck) && !/Sem músicas/i.test(s.deck), 'O13: o visor diz "Não guardado" (nunca "Sem músicas")', s.deck)
    ok(await countOf(page, 'button:has-text("Ver concertos guardados")') === 1, 'O13: botão "Ver concertos guardados"')
    await shot(page, 'O13-palco-nao-guardado')
    // ✕ sai logo (não há concerto a interromper)
    await page.click('button[aria-label="Sair do concerto"]')
    await page.waitForURL(u => new URL(u).pathname === `/setlist/${SID}`, { timeout: 4000 }).catch(() => {})
    ok(pathOf(page) === `/setlist/${SID}` && await countOf(page, ':is([role="dialog"], [role="alertdialog"])') === 0, 'O13: ✕ sai sem pedir confirmação', page.url())
    await page.goto(`${BASE}/setlist/${SID}/concert`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-stage-empty="missing"]', { timeout: 10000 }).catch(() => {})
    // A rede volta: o concerto aparece sem sair do palco
    NET.down = false
    const t0 = Date.now()
    const back = await until(async () => (await stage(page)).lines.length > 0, 25000, 300)
    s = await stage(page)
    ok(!!back && s.empty === null && s.lines.includes('As luzes da feira acendem devagar'), `O13: a rede volta → o concerto aparece no palco (${Math.round((Date.now() - t0) / 1000)} s)`, { empty: s.empty, lines: s.lines.slice(0, 2) })
    ok(!s.offline && s.live, 'O13: "Ao vivo"', { offline: s.offline, live: s.live })
    ok(errors.length === 0, 'O13: sem erros na página', errors)
  })
} catch (e) {
  ok(false, 'exceção no teste', String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '))
} finally {
  server.close()
  rmSync(PROFILE, { recursive: true, force: true })
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
}

console.log(`\ncapturas em ${OUT}`)
if (failures.length) {
  console.log('\nFalhas:')
  for (const f of failures) console.log(' -', f)
}
console.log(`\n${passed} passaram, ${failures.length} falharam`)
process.exit(failures.length ? 1 : 0)
