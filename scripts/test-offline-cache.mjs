#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Testes da cache de concertos offline (src/lib/offline/):
   chaves por utilizador, formato guardado (o que se corta, o que se
   valida ao ler — serialização JSON de ida e volta), poda, escolha do
   que se guarda antes do concerto, ordem por enviar e, no store, o
   isolamento entre utilizadores, a poda ao gravar, "Terminar sessão"
   e "entrou outro utilizador"; e os pedidos com limite de tempo / o
   modo offline (net.ts).
   Corre em Node puro:  node scripts/test-offline-cache.mjs [-v]
   Junta os módulos com o esbuild do projeto (sem IndexedDB no Node, o
   store usa a memória — o mesmo caminho da navegação privada).
   Letras e nomes INVENTADOS.
═══════════════════════════════════════════════════════════════ */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const esbuild = require(join(root, 'node_modules/esbuild'))

const out = mkdtempSync(join(tmpdir(), 'offline-cache-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
async function bundle(entry, name) {
  const r = await esbuild.build({
    entryPoints: [join(root, entry)], bundle: true, format: 'esm', platform: 'neutral',
    target: 'es2022', write: false, logLevel: 'silent',
  })
  const file = join(out, `${name}.mjs`)
  writeFileSync(file, r.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}
const L = await bundle('src/lib/offline/logic.ts', 'logic')
const S = await bundle('src/lib/offline/store.ts', 'store')
const N = await bundle('src/lib/offline/net.ts', 'net')

/* ── mini harness ── */
let pass = 0
let fail = 0
const failures = []
const verbose = process.argv.includes('-v')
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; if (verbose) console.log(`✓ ${label}`); return }
  fail++
  failures.push(`✗ ${label}\n    esperado: ${e}\n    obtido:   ${a}`)
}
function ok(cond, label, info) {
  if (cond) { pass++; if (verbose) console.log(`✓ ${label}`); return }
  fail++
  failures.push(`✗ ${label}${info !== undefined ? `\n    ${JSON.stringify(info)}` : ''}`)
}
async function test(name, fn) {
  try { await fn() } catch (e) { fail++; failures.push(`✗ ${name} — exceção: ${e?.stack ?? e}`) }
}

/* ── Fixtures (inventadas) ── */
const NOW = new Date(2026, 9, 19, 15, 30)   // 19 out 2026, 15:30 (hora local)
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayFrom = (base, n) => ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n))

const LYRICS = '[Verso]\nA carrinha parou na rotunda\nE o baixo ficou lá dentro\n\n[Refrão]\nMais uma volta, mais uma volta'
const song = (id, extra = {}) => ({
  id, title: `Canção ${id}`, artist: 'Banda de Teste', lyrics: LYRICS, edited_lyrics: null,
  original_lyrics: 'texto antigo que o palco não usa', source_metadata: { muito: 'grande' }, structure: [{ x: 1 }],
  chords: 'G D Em C', original_key: 'G', performance_key: null, bpm: 96, duration_sec: 200,
  has_sync: false, capo: 2, source: 'manual', owner_id: 'uA', created_at: '2026-01-01T00:00:00Z', ...extra,
})
const row = (i, s, extra = {}) => ({
  id: `ss${i}`, setlist_id: 's1', song_id: s.id, position: i, performance_key: i === 1 ? 'A' : null,
  notes: i === 0 ? 'Entrar depois do brinde' : null, custom_intro: i === 1 ? '2 compassos de bateria' : null,
  custom_ending: null, song: s, ...extra,
})
const SETLIST = {
  id: 's1', name: 'Festa do Largo', date: dayFrom(NOW, 1), venue: 'Coreto', band_id: 'b1', owner_id: 'uA',
  is_shared: true, status: 'final', updated_at: '2026-10-18T10:00:00Z', description: 'não é preciso', notes: 'idem',
  created_at: '2026-01-01T00:00:00Z', bands: { name: 'Os Ensaiados', color: '#7C3AED', image_url: null, owner_id: 'uA' },
}
const SYNC = [{ time_ms: 1000, text: 'A carrinha parou na rotunda' }, { time_ms: 4000, text: 'E o baixo ficou lá dentro' }]
const sgA = song('sgA', { has_sync: true })
const sgB = song('sgB')
const ROWS = [row(0, sgA), row(1, sgB)]

await test('chaves por utilizador', () => {
  eq(L.concertKey('uA', 's1'), 'u:uA:concert:s1', 'concertKey')
  eq(L.indexKey('uA'), 'u:uA:index', 'indexKey')
  eq(L.themeKey('uA'), 'u:uA:theme', 'themeKey')
  eq(L.orderKey('uA', 's1'), 'u:uA:order:s1', 'orderKey')
  ok(L.concertKey('uA', 's1') !== L.concertKey('uB', 's1'), 'o mesmo concerto tem chaves diferentes por utilizador')
  eq(L.keyUser('u:uA:concert:s1'), 'uA', 'keyUser lê o utilizador')
  eq(L.keyUser('gigio_ann_v1_sg1'), null, 'keyUser: chave que não é desta cache')
  ok(L.concertKey('uA', 's1').startsWith(L.userPrefix('uA')) && !L.concertKey('uAB', 's1').startsWith(L.userPrefix('uA')),
    'o prefixo de um utilizador não apanha outro com id parecido')
})

await test('buildConcert: só as colunas que o palco usa', () => {
  const c = L.buildConcert({
    userId: 'uA', setlist: SETLIST, rows: ROWS,
    syncs: { sgA: SYNC, sgZ: SYNC, sgB: [{ time_ms: 'x', text: 1 }] },
    annotations: { sgB: { strokes: { v: 2, anchored: [] }, updated_at: '2026-10-18T09:00:00Z' }, sgZ: { strokes: { v: 2 }, updated_at: null } },
    annChecked: true, savedAt: NOW.getTime(),
  })
  eq([c.v, c.userId, c.setlistId, c.savedAt], [L.OFFLINE_VERSION, 'uA', 's1', NOW.getTime()], 'cabeçalho da cópia')
  const s0 = c.rows[0].song
  ok(!('original_lyrics' in s0) && !('source_metadata' in s0) && !('structure' in s0), 'song: sem original_lyrics / source_metadata / structure', Object.keys(s0))
  eq([s0.title, s0.lyrics, s0.chords, s0.original_key, s0.bpm, s0.duration_sec, s0.has_sync, s0.capo],
    [sgA.title, LYRICS, 'G D Em C', 'G', 96, 200, true, 2], 'song: título, letra, acordes, tom, bpm, duração, sync, capo')
  eq([c.rows[1].performance_key, c.rows[1].custom_intro, c.rows[0].notes], ['A', '2 compassos de bateria', 'Entrar depois do brinde'], 'linhas: tom, intro e notas do concerto')
  ok(!('description' in c.setlist) && c.setlist.bands?.name === 'Os Ensaiados', 'setlist: resumo com o projeto', c.setlist)
  eq(Object.keys(c.syncs), ['sgA'], 'syncs: só as das músicas do concerto e com linhas válidas')
  eq(Object.keys(c.annotations), ['sgB'], 'anotações: só as das músicas do concerto')
  eq(c.annChecked, true, 'annChecked')
  const noSong = L.buildConcert({ userId: 'uA', setlist: SETLIST, rows: [...ROWS, { id: 'ssX', song: null }], savedAt: 1 })
  eq(noSong.rows.length, 2, 'linha sem música (apagada) não entra')
})

await test('parseConcert: serialização e validação', () => {
  const c = L.buildConcert({ userId: 'uA', setlist: SETLIST, rows: ROWS, syncs: { sgA: SYNC }, annChecked: false, savedAt: NOW.getTime() })
  const back = L.parseConcert(JSON.parse(JSON.stringify(c)), 'uA', 's1')
  eq(back, c, 'JSON ida e volta = a mesma cópia')
  eq(L.parseConcert(c, 'uB', 's1'), null, 'outro utilizador → null (nunca a cópia de outro)')
  eq(L.parseConcert(c, 'uA', 's2'), null, 'outro concerto → null')
  eq(L.parseConcert({ ...c, v: 99 }, 'uA', 's1'), null, 'outra versão do formato → null')
  eq(L.parseConcert({ ...c, savedAt: 'ontem' }, 'uA', 's1'), null, 'savedAt inválido → null')
  eq(L.parseConcert(null, 'uA', 's1'), null, 'null → null')
  eq(L.parseConcert('lixo', 'uA', 's1'), null, 'texto → null')
  eq(L.parseConcert({ ...c, rows: 'x' }, 'uA', 's1'), null, 'rows estragadas → null')
  const partial = L.parseConcert({ ...c, rows: [...c.rows, { id: 7 }, null, { id: 'ssY', song: null }], syncs: { sgA: SYNC, sgB: 'x' } }, 'uA', 's1')
  eq([partial?.rows.length, Object.keys(partial?.syncs ?? {})], [2, ['sgA']], 'linhas e syncs estragadas saem, o resto fica')
})

const entry = (id, date, usedAt, extra = {}) => ({
  setlistId: id, name: `Concerto ${id}`, date, venue: null, bandId: null, bandName: null, bandColor: null,
  songCount: 3, savedAt: usedAt, usedAt, ...extra,
})

await test('pruneIndex: próximos, últimos usados, passados', () => {
  const t = NOW.getTime()
  const list = [
    entry('hoje', dayFrom(NOW, 0), t - 5000),
    entry('amanha', dayFrom(NOW, 1), t - 100),
    entry('longe', dayFrom(NOW, 90), t - 1e9),
    entry('semdata', null, t - 50),
    entry('passado10', dayFrom(NOW, -10), t - 10),
    entry('passado30', dayFrom(NOW, -30), t - 20),
    entry('passado31', dayFrom(NOW, -31), t),
    entry('passado200', dayFrom(NOW, -200), t),
  ]
  const { keep, drop } = L.pruneIndex(list, NOW)
  eq(keep.map(e => e.setlistId).sort(), ['amanha', 'hoje', 'longe', 'passado10', 'passado30', 'semdata'], 'ficam os próximos (até muito longe), sem data e passados ≤ 30 dias')
  eq(drop.sort(), ['passado200', 'passado31'], 'saem os passados há mais de 30 dias (mesmo usados agora)')

  const many = Array.from({ length: 26 }, (_, i) => entry(`p${i}`, dayFrom(NOW, -1 - (i % 20)), t - i * 1000))
  const r2 = L.pruneIndex([...many, entry('prox', dayFrom(NOW, 3), 0)], NOW)
  eq(r2.keep.length, 1 + L.KEEP_RECENT, `próximos + os ${L.KEEP_RECENT} usados mais recentemente`)
  ok(r2.keep.some(e => e.setlistId === 'prox'), 'um próximo nunca usado fica')
  eq(r2.drop.sort(), ['p20', 'p21', 'p22', 'p23', 'p24', 'p25'], 'saem os menos usados')

  const lots = Array.from({ length: L.KEEP_UPCOMING_MAX + 5 }, (_, i) => entry(`f${String(i).padStart(2, '0')}`, dayFrom(NOW, i + 1), t))
  const r3 = L.pruneIndex(lots, NOW)
  eq(r3.keep.length, L.KEEP_UPCOMING_MAX, `próximos: no máximo ${L.KEEP_UPCOMING_MAX}`)
  ok(r3.drop.every(id => Number(id.slice(1)) >= L.KEEP_UPCOMING_MAX), 'saem os mais longe', r3.drop)
  eq(L.pruneIndex([], NOW), { keep: [], drop: [] }, 'lista vazia')
})

await test('sortIndex: próximos por data, sem data, passados', () => {
  const list = [entry('p', dayFrom(NOW, -2), 1), entry('n', null, 5), entry('b', dayFrom(NOW, 5), 1), entry('a', dayFrom(NOW, 0), 1), entry('n2', null, 9)]
  eq(L.sortIndex(list, NOW).map(e => e.setlistId), ['a', 'b', 'n2', 'n', 'p'], 'hoje, depois, sem data (mais usado primeiro), passados')
})

await test('selectPrefetch: hoje + 14 dias, até 10', () => {
  const list = [
    { id: 'ontem', date: dayFrom(NOW, -1) }, { id: 'hoje', date: dayFrom(NOW, 0) }, { id: 'd14', date: dayFrom(NOW, 14) },
    { id: 'd15', date: dayFrom(NOW, 15) }, { id: 'semdata', date: null }, { id: 'd3', date: dayFrom(NOW, 3) },
  ]
  eq(L.selectPrefetch(list, NOW), ['hoje', 'd3', 'd14'], 'só de hoje a 14 dias, por data (sem data e passados não)')
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `x${i}`, date: dayFrom(NOW, i % 14) }))
  eq(L.selectPrefetch(many, NOW).length, L.PREFETCH_MAX, `no máximo ${L.PREFETCH_MAX}`)
  eq(L.selectPrefetch(many, NOW)[0], 'x0', 'os mais perto primeiro')
})

await test('applyPendingOrder / sameOrder', () => {
  const r = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  eq(L.applyPendingOrder(r, ['c', 'a', 'b']).map(x => x.id), ['c', 'a', 'b'], 'ordem pendente aplicada')
  eq(L.applyPendingOrder([...r, { id: 'd' }], ['c', 'a', 'b']).map(x => x.id), ['c', 'a', 'b', 'd'], 'linha nova (outro membro) fica no fim')
  eq(L.applyPendingOrder([{ id: 'a' }, { id: 'c' }], ['c', 'b', 'a']).map(x => x.id), ['c', 'a'], 'linha removida sai')
  eq(L.applyPendingOrder(r, null).map(x => x.id), ['a', 'b', 'c'], 'sem ordem: como vem')
  eq(L.applyPendingOrder(r, ['a', 'a', 'b']).map(x => x.id), ['a', 'b', 'c'], 'ids repetidos não duplicam linhas')
  ok(L.sameOrder(r, ['a', 'b', 'c']) && !L.sameOrder(r, ['b', 'a', 'c']) && !L.sameOrder(r, ['a', 'b']), 'sameOrder')
  eq(L.parsePendingOrder({ userId: 'uA', setlistId: 's1', ids: ['a'], at: 5 }, 'uB', 's1'), null, 'ordem pendente de outro utilizador → null')
  eq(L.parsePendingOrder({ userId: 'uA', setlistId: 's1', ids: [1] }, 'uA', 's1'), null, 'ids inválidos → null')
})

await test('savedAtLabel', () => {
  eq(L.savedAtLabel(new Date(2026, 9, 19, 9, 5).getTime(), NOW), 'às 09:05', 'hoje')
  eq(L.savedAtLabel(new Date(2026, 9, 18, 22, 40).getTime(), NOW), 'ontem às 22:40', 'ontem')
  eq(L.savedAtLabel(new Date(2026, 9, 12, 14, 32).getTime(), NOW), 'a 12 out às 14:32', 'outro dia')
})

await test('parseIndex: robusto', () => {
  eq(L.parseIndex('x'), [], 'não é lista → []')
  eq(L.parseIndex([{ setlistId: 's1', name: 'A', savedAt: 5 }, { nada: 1 }, null]).map(e => [e.setlistId, e.usedAt]), [['s1', 5]], 'entradas estragadas saem; usedAt por omissão = savedAt')
})

/* ── Store (memória: sem IndexedDB no Node) ── */
const today = new Date()
const mk = (userId, id, date, extra = {}) => L.buildConcert({
  userId, setlist: { ...SETLIST, id, name: `Concerto ${id}`, date }, rows: ROWS.map(r => ({ ...r, setlist_id: id })),
  syncs: { sgA: SYNC }, annotations: { sgB: { strokes: { v: 2, anchored: [] }, updated_at: null } }, annChecked: true,
  savedAt: Date.now(), ...extra,
})

await test('store: cópia por utilizador', async () => {
  await S.saveConcert(mk('uA', 's1', dayFrom(today, 1)), { used: true })
  const a = await S.loadConcert('uA', 's1')
  eq([a?.setlist.name, a?.rows.length, Object.keys(a?.syncs ?? {})], ['Concerto s1', 2, ['sgA']], 'uA lê a sua cópia')
  eq(await S.loadConcert('uB', 's1'), null, 'uB não lê a cópia de uA')
  eq(S.peekConcert('uB', 's1'), null, 'nem da memória da sessão')
  eq((await S.listConcerts('uA')).map(e => e.setlistId), ['s1'], 'índice de uA')
  eq(await S.listConcerts('uB'), [], 'índice de uB vazio')
  ok(S.peekConcert('uA', 's1')?.setlistId === 's1', 'peekConcert (síncrono) depois de gravar')
})

await test('store: poda ao gravar', async () => {
  for (let i = 0; i < 24; i++) await S.saveConcert(mk('uA', `old${i}`, dayFrom(today, -1 - (i % 25))))
  await S.saveConcert(mk('uA', 'ancient', dayFrom(today, -60)))
  const ids = (await S.listConcerts('uA')).map(e => e.setlistId)
  ok(ids.includes('s1'), 'o próximo fica')
  ok(!ids.includes('ancient'), 'passado há 60 dias sai logo')
  eq(ids.length, 1 + L.KEEP_RECENT, `próximo + ${L.KEEP_RECENT} recentes`)
  ok(!!S.peekConcert('uA', 'ancient'), 'o passado acabado de abrir fica só na memória desta sessão')
  const kept = ids.filter(id => id.startsWith('old'))
  const dropped = Array.from({ length: 24 }, (_, i) => `old${i}`).filter(id => !kept.includes(id))
  eq(dropped.length, 24 - L.KEEP_RECENT, 'saem os excedentes')
  eq(await S.loadConcert('uA', dropped[0]), null, 'a cópia podada é apagada (não só o índice)')
})

await test('store: patch, tema e ordem pendente', async () => {
  await S.patchConcert('uA', 's1', c => ({ ...c, rows: c.rows.map(r => r.id === 'ss1' ? { ...r, performance_key: 'Bb' } : r) }))
  eq((await S.loadConcert('uA', 's1'))?.rows[1].performance_key, 'Bb', 'patchConcert muda a cópia (tom novo no palco sem rede)')
  await S.patchConcert('uB', 's1', c => ({ ...c, rows: [] }))
  eq((await S.loadConcert('uA', 's1'))?.rows.length, 2, 'patch de outro utilizador não mexe na de uA')

  await S.saveTheme('uA', { bg: '#000000', font_size: 40 })
  eq(await S.loadTheme('uA'), { bg: '#000000', font_size: 40 }, 'tema de uA')
  eq(await S.loadTheme('uB'), null, 'tema por utilizador (não global)')

  await S.setPendingOrder('uA', 's1', ['ss1', 'ss0'])
  eq((await S.getPendingOrder('uA', 's1'))?.ids, ['ss1', 'ss0'], 'ordem pendente guardada')
  eq(await S.getPendingOrder('uB', 's1'), null, 'ordem pendente por utilizador')
  eq((await S.listPendingOrders('uA')).map(p => p.setlistId), ['s1'], 'lista de pendentes')
  await S.clearPendingOrder('uA', 's1', ['ss0', 'ss1'])
  ok(!!(await S.getPendingOrder('uA', 's1')), 'não apaga uma ordem mais recente (ids diferentes)')
  await S.clearPendingOrder('uA', 's1', ['ss1', 'ss0'])
  eq(await S.getPendingOrder('uA', 's1'), null, 'apaga a ordem enviada')
})

await test('store: entrou outro utilizador / terminar sessão', async () => {
  await S.saveConcert(mk('uB', 's9', dayFrom(today, 2)))
  await S.setPendingOrder('uB', 's9', ['ss0'])
  await S.keepOnlyUser('uA')
  eq(await S.loadConcert('uB', 's9'), null, 'keepOnlyUser: a cópia de outro sai')
  eq(await S.getPendingOrder('uB', 's9'), null, 'keepOnlyUser: as pendentes de outro saem')
  ok(!!(await S.loadConcert('uA', 's1')), 'keepOnlyUser: as do próprio ficam')

  let notified = 0
  const unsub = S.onOfflineChange(() => { notified++ })
  await S.clearOfflineData()
  unsub()
  eq([await S.loadConcert('uA', 's1'), await S.listConcerts('uA'), await S.loadTheme('uA')], [null, [], null], 'terminar sessão apaga tudo')
  ok(notified > 0, 'avisa a interface')
  await S.saveConcert(mk('uA', 's2', dayFrom(today, 1)))
  eq(await S.loadConcert('uA', 's2'), null, 'depois de terminar sessão nada volta a ser gravado (um prefetch a meio)')
  S.thawOffline()
  await S.saveConcert(mk('uA', 's2', dayFrom(today, 1)))
  ok(!!(await S.loadConcert('uA', 's2')), 'depois de entrar de novo volta a gravar')
})

/* ── Rede (net.ts): pedidos com limite de tempo e modo offline ── */
await test('net: erros de rede vs erros do servidor', () => {
  ok(N.isNetworkError({ message: 'TypeError: Failed to fetch' }, 0), 'status 0 = rede')
  ok(N.isNetworkError({ message: 'TypeError: Load failed' }), 'Safari "Load failed" = rede')
  ok(N.isNetworkError({ message: 'NetworkError when attempting to fetch resource.' }), 'Firefox = rede')
  ok(!N.isNetworkError({ message: 'permission denied for table setlists' }, 403), 'erro do servidor ≠ rede')
})

await test('net: runQuery', async () => {
  let retried = null
  const builder = (result, delay = 0) => ({
    retry(v) { retried = v; return this },
    then(res, rej) { return new Promise(r => setTimeout(() => r(result), delay)).then(res, rej) },
  })
  const okRes = await N.runQuery(builder({ data: [1], error: null, status: 200 }), 1000)
  eq([okRes.data, okRes.network, retried], [[1], false, false], 'sucesso; sem as retentativas do postgrest (retry(false))')
  const srv = await N.runQuery(builder({ data: null, error: { message: 'proibido' }, status: 403 }), 1000)
  ok(srv.error && !srv.network && !N.isLikelyOffline(), 'erro do servidor não liga o modo offline', srv)
  const t0 = Date.now()
  const slow = await N.runQuery(builder({ data: [1], error: null, status: 200 }, 5000), 80)
  ok(slow.network && slow.data === null && Date.now() - t0 < 1000, 'tempo esgotado = falha de rede (não espera 5 s)', { ms: Date.now() - t0 })
  ok(N.isLikelyOffline(), 'depois de uma falha de rede: modo offline')
  let called = false
  const skip = await N.runQuery({ then(res) { called = true; return Promise.resolve({ data: 1, error: null, status: 200 }).then(res) } }, 1000)
  ok(skip.network && !called, 'em modo offline nem vai à rede')
  const forced = await N.runQuery(builder({ data: [2], error: null, status: 200 }), 1000, true)
  ok(forced.data?.[0] === 2 && !N.isLikelyOffline(), 'force (Guardar para offline) vai à rede; o sucesso sai do modo offline')
  N.setNetProbe(async () => false)
  await N.runQuery(builder({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }), 1000)
  ok(N.isLikelyOffline(), 'fetch partido (status 0) → offline; com sonda fica até ela responder')
  N.markNetOk()
  ok(!N.isLikelyOffline(), 'markNetOk sai do modo offline')
  N.setNetProbe(null)
})

/* ── resultado ── */
for (const f of failures) console.log(f)
console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
