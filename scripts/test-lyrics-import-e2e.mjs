#!/usr/bin/env node
/**
 * E2E do PDF de LETRAS (uma página = uma música) e do "Parar" da importação,
 * no Chromium, com o build de Supabase fictício e os mocks de scripts/visual-shots.mjs.
 *
 *   L1 Gera um PDF de 5 páginas (letras INVENTADAS; a pág. 3 continua a 2) com o
 *      próprio Chromium; importa-o em Novo concerto → a revisão abre no modo
 *      "Cada página é uma música (com letra)" com 4 músicas, título/artista/1.os versos.
 *   L2 "Sozinho" já existe no repertório → BIBLIOTECA ("Já existe…").
 *   L3 Trocar para "Lista de títulos" → uma linha por linha (como antes); voltar.
 *   L4 Juntar à anterior (botão da linha) → 3 músicas.
 *   L5 Criar: as músicas são criadas COM letra (POST songs); "Parar" a meio →
 *      não cria mais, o concerto sai e o aviso diz o que ficou criado.
 *   L6 Descartar a lista → volta ao início sem criar nada.
 *   Capturas (telemóvel + iPad) da escolha, da revisão e do "Parar".
 *
 * Uso:
 *   node scripts/test-lyrics-import-e2e.mjs <dist-do-build-mock> [pasta-das-capturas]
 *   (build: VITE_SUPABASE_URL=https://mockproj.supabase.co VITE_SUPABASE_ANON_KEY=mockanon npx vite build --outDir <dist>)
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { USER, SESSION, restResponse, staticServer } from './visual-shots.mjs'

const DIST = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../dist'))
const OUT = path.resolve(process.argv[3] ?? path.join(import.meta.dirname, '../shots/lyrics-e2e'))
const PORT = 4231
const BASE = `http://localhost:${PORT}`
const VIEWS = { phone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 } }

let passed = 0
let failed = 0
function ok(cond, label, detail) {
  if (cond) { passed++; if (process.env.E2E_VERBOSE) console.log('  ✓', label); return }
  failed++
  console.log('  ✗', label, detail !== undefined ? JSON.stringify(detail) : '')
}

// ── PDF de letras inventadas ────────────────────────────────────────────────
const PAGES = [
  ['Maré de Setembro', 'Rui Calado', `[Verso 1]
Acordei com o mar a bater na janela,
o café já frio e a rua tão bela
as gaivotas a rir do meu velho chapéu
e eu a contar barcos a subir para o céu

[Refrão]
Ó maré de setembro, leva-me contigo
que eu levo a guitarra e um velho amigo`],
  ['Luzes da Ribeira', 'Ana Prata', `Na ponte de ferro a cidade acendeu,
cada janela um bocado de céu
e os teus olhos a dizer que sim
mesmo quando a noite não tem fim

[Refrão]
Luzes da Ribeira, guardem o meu lugar
que amanhã eu volto para te cantar`],
  [null, null, `e quando o rio parar de correr
eu fico aqui só para te ver

[Final]
Luzes da Ribeira, luzes de alguém
que me esperam sempre, como mais ninguém`],
  ['Sozinho', null, `Uma cadeira vazia ao pé da lareira,
o gato a dormir na manta da avó
e eu aqui a inventar uma canção inteira
para não me sentir assim tão só`],
  ['Canção do Eléctrico 28', 'Os Bilhetes Perdidos', `Sobe a colina a ranger devagar,
leva turistas e a dona Amélia a ralhar
tlim tlim na curva da Graça
e o miúdo a acenar da praça`],
]
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const PDF_HTML = `<!doctype html><meta charset="utf-8"><style>
  body { font-family: Georgia, serif; margin: 0 }
  .page { page-break-after: always; padding: 40px 50px }
  h1 { font-size: 30px; margin: 0 0 6px } .by { font-size: 15px; margin: 0 0 22px; color: #444 }
  pre { font-family: Georgia, serif; font-size: 15px; line-height: 1.5; margin: 0; white-space: pre-wrap }
  .num { position: fixed; bottom: 20px; right: 40px; font-size: 11px }
</style>${PAGES.map(([t, a, l], i) => `<div class="page">${t ? `<h1>${esc(t)}</h1>` : ''}${a ? `<p class="by">${esc(a)}</p>` : ''}<pre>${esc(l)}</pre><div>${i + 1}</div></div>`).join('')}`

await mkdir(OUT, { recursive: true })
const server = staticServer(DIST)
await new Promise(r => server.listen(PORT, r))
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

const pdfPath = path.join(OUT, 'letras-inventadas.pdf')
{
  const p = await browser.newPage()
  await p.setContent(PDF_HTML)
  await writeFile(pdfPath, await p.pdf({ format: 'A5', printBackground: true }))
  await p.close()
}

async function newCtx(viewport, net) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    const table = url.pathname.split('/rest/v1/')[1]?.split('/')[0]
    if (table === 'songs' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      net.songPosts.push(body)
      await new Promise(r => setTimeout(r, net.songDelay))
      const row = { id: `new-${net.songPosts.length}`, ...body }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(req.headers().accept?.includes('vnd.pgrst.object') ? row : [row]) })
    }
    if (table === 'setlists' && req.method() === 'DELETE') net.setlistDeletes++
    if (table === 'setlist_songs' && req.method() === 'POST') net.lineupPosts++
    return restResponse(route)
  })
  await ctx.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/user') ? USER : SESSION) }))
  await ctx.route(/lrclib|genius|nominatim|lyrics\.ovh/, route => { net.online++; return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) })
  await ctx.addInitScript(`
    localStorage.setItem('sb-mockproj-auth-token', ${JSON.stringify(JSON.stringify(SESSION))});
    localStorage.setItem('gigio-theme', 'light');
  `)
  return ctx
}

const rowTitles = page => page.$$eval('ol[aria-label="Músicas importadas, pela ordem"] > li:not([role=separator])', lis =>
  lis.map(li => li.querySelector('[class*="rowTitle"]')?.textContent?.trim() ?? ''))

async function importPdf(page) {
  await page.goto(`${BASE}/concertos/novo`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file][accept*="pdf"]', pdfPath)
  await page.waitForSelector('ol[aria-label="Músicas importadas, pela ordem"]', { timeout: 20000 })
  await page.waitForTimeout(400)
}

for (const [vname, viewport] of Object.entries(VIEWS)) {
  console.log(`# ${vname}`)
  const net = { songPosts: [], songDelay: 50, setlistDeletes: 0, lineupPosts: 0, online: 0 }
  const ctx = await newCtx(viewport, net)
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  pageerror', String(e).split('\n')[0]))

  // L1
  await importPdf(page)
  const lyricsRadio = page.getByRole('radio', { name: /Cada página é uma música/ })
  ok(await lyricsRadio.getAttribute('aria-checked') === 'true', `L1 ${vname}: modo "Cada página é uma música" escolhido automaticamente`)
  ok(await page.getByText('Sugerido').count() === 1, `L1 ${vname}: "Sugerido" no modo detetado`)
  const t1 = await rowTitles(page)
  ok(JSON.stringify(t1) === JSON.stringify(['Maré de Setembro', 'Luzes da Ribeira', 'Sozinho', 'Canção do Eléctrico 28']), `L1 ${vname}: 4 músicas (a pág. 3 continua a 2)`, t1)
  const body = await page.locator('ol[aria-label="Músicas importadas, pela ordem"]').innerText()
  ok(/Rui Calado/.test(body) && /Acordei com o mar a bater na janela/.test(body), `L1 ${vname}: artista e 1.os versos na linha`)
  ok(/Págs\. 2, 3/i.test(body), `L1 ${vname}: "Págs. 2, 3" na música que continua`, body.slice(0, 300))
  // L2
  ok(/Já existe/.test(body), `L2 ${vname}: "Sozinho" já existe no repertório`)
  ok(net.online === 0, `L1 ${vname}: músicas com letra não procuram online`, net.online)
  await page.screenshot({ path: path.join(OUT, `revisao-letras--${vname}.png`), fullPage: true })

  // Seletor de uma música com letra
  await page.getByRole('button', { name: /^01 · Maré de Setembro/ }).click()
  await page.waitForSelector('[role=dialog] pre')
  const pickerText = await page.locator('[role=dialog]').last().innerText()
  ok(/Criar nova com esta letra/.test(pickerText) && !/Online · LRCLIB/.test(pickerText), `L1 ${vname}: seletor sem pesquisa online, com "Criar nova com esta letra"`)
  await page.screenshot({ path: path.join(OUT, `seletor-letra--${vname}.png`) })
  await page.getByRole('button', { name: 'Feito' }).click()

  // L3
  await page.getByRole('radio', { name: /Lista de títulos/ }).click()
  await page.waitForTimeout(300)
  const t3 = await rowTitles(page)
  ok(t3.length > 8, `L3 ${vname}: "Lista de títulos" lê uma música por linha (como antes)`, t3.length)
  await page.screenshot({ path: path.join(OUT, `modo-lista--${vname}.png`) })
  await lyricsRadio.click()
  await page.waitForTimeout(300)
  ok((await rowTitles(page)).length === 4, `L3 ${vname}: voltar a "Cada página é uma música"`)

  // L4
  await page.getByRole('button', { name: 'Juntar Canção do Eléctrico 28 à música anterior' }).click()
  const t4 = await rowTitles(page)
  ok(JSON.stringify(t4) === JSON.stringify(['Maré de Setembro', 'Luzes da Ribeira', 'Sozinho']), `L4 ${vname}: juntar à anterior`, t4)

  // L5: criar e parar a meio
  net.songDelay = 1500
  const create = page.locator('[class*="actionBar"] button').filter({ hasText: /Criar em/ })
  await create.click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Parar'), null, { timeout: 15000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `parar-gravacao--${vname}.png`) })
  await page.getByRole('button', { name: 'Parar', exact: true }).click()
  const toast = await page.waitForSelector('text=/Importação parada/', { timeout: 10000 }).then(h => h.textContent())
  await page.waitForTimeout(1800)
  ok(net.songPosts.length >= 1 && net.songPosts.length < 2 + 1, `L5 ${vname}: parar não cria as restantes`, net.songPosts.length)
  ok(net.songPosts.every(b => (b.lyrics ?? '').length > 40 && b.lyrics === b.edited_lyrics), `L5 ${vname}: músicas criadas COM letra`, net.songPosts.map(b => b.lyrics?.slice(0, 30)))
  ok(net.songPosts[0]?.title === 'Maré de Setembro' && net.songPosts[0]?.artist === 'Rui Calado', `L5 ${vname}: título e artista`, net.songPosts[0])
  ok(/\[Refrão\]/.test(net.songPosts[0]?.lyrics ?? '') && /\n\n/.test(net.songPosts[0]?.lyrics ?? ''), `L5 ${vname}: [Secção] e linha em branco preservadas`)
  ok(net.lineupPosts === 0 && net.setlistDeletes === 1, `L5 ${vname}: nada entra no alinhamento e o concerto sai`, { lineup: net.lineupPosts, del: net.setlistDeletes })
  ok(/já tinha|já tinham/.test(toast ?? '') && /Maré de Setembro/.test(toast ?? ''), `L5 ${vname}: o aviso diz o que ficou criado`, toast)
  await page.screenshot({ path: path.join(OUT, `parado-aviso--${vname}.png`) })

  // L6: descartar
  ok((await rowTitles(page)).length === 3, `L6 ${vname}: a lista fica em revisão depois de parar`)
  const before = net.songPosts.length
  await page.getByRole('button', { name: 'Descartar', exact: true }).click()
  await page.getByRole('button', { name: 'Descartar', exact: true }).last().click() // confirmação
  await page.waitForTimeout(500)
  ok(await page.locator('ol[aria-label="Músicas importadas, pela ordem"]').count() === 0, `L6 ${vname}: descartar volta ao início`)
  ok(net.songPosts.length === before, `L6 ${vname}: descartar não cria nada`)
  await ctx.close()
}

await browser.close()
server.close()
console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passaram, ${failed} falharam · capturas em ${OUT}`)
process.exit(failed === 0 ? 0 : 1)
