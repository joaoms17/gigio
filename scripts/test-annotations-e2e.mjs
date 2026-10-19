/**
 * Teste end-to-end das anotações ANCORADAS AO TEXTO, no Chromium, com o build
 * de Supabase fictício e os mocks de scripts/visual-shots.mjs.
 *
 * Desenha no Ensaio (iPad retrato) com eventos de ponteiro reais (caneta e
 * dedo, via CDP) e mede no DOM — caminhos SVG resolvidos (atributo d) contra
 * as caixas do texto (Range) — que os traços continuam presos às mesmas
 * letras no próprio Ensaio (A+ ×2, rodar) e no modo concerto em vários
 * layouts (tablet paisagem/retrato, telemóvel, entrelinhas 1.3 e 2.0).
 * Cenário B: payload ANTIGO {w,h,strokes} (sem âncoras) aberto diretamente no
 * concerto (layout de referência) e depois no Ensaio (migra para v2); também
 * o formato mais antigo, sem h (sempre desenhado a 32px).
 * Cenário D: sincronização com a cloud — cópia antiga local contra uma v2 na
 * cloud, traço desenhado antes de a cloud responder, cloud a falhar.
 * Cenário E: música sem letra (traços livres). Cenário F: nota "FIM" abaixo
 * da última linha (não pode ser cortada). E, no cenário A, cada fotograma
 * depois de A+ (o sublinhado nunca sai de baixo do verso).
 *
 * Uso:
 *   node scripts/test-annotations-e2e.mjs [pasta-das-capturas]
 *   (faz o build de mock antes, como scripts/shots.sh; E2E_NO_BUILD=1 usa o dist que existe)
 * Saída: "N passaram, 0 falharam"; exit ≠ 0 se alguma asserção falhar.
 */
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { USER, SESSION, TABLES, restResponse, staticServer } from './visual-shots.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'shots/ann-e2e'))
const PORT = 4207
const BASE = `http://localhost:${PORT}`

// ── Letra de teste ──────────────────────────────────────────────────────────
// INVENTADA (nunca letras reais): secções, estrofes, um refrão com versos
// repetidos e uma linha longa que cabe numa row no Ensaio do iPad a 32px mas
// quebra no telemóvel, no Ensaio a 40px e no concerto com letra grande.
const LYRICS = [
  '[Verso 1]',                                   // 0
  'A garagem cheira a óleo',                     // 1
  'O baixo desafinou',                           // 2  ← sublinhado (âmbar, caneta)
  'Alguém trouxe bolachas',                      // 3
  'E o metrónomo parou',                         // 4
  '',                                            // 5
  '[Refrão]',                                    // 6
  'Outra vez do zero',                           // 7  ┐
  'Conta até quatro',                            // 8  │ chaveta à esquerda (azul, caneta)
  'Outra vez do zero',                           // 9  │ — versos repetidos
  'Conta até quatro',                            // 10 ┘ círculo em "quatro" da 2.ª vez (vermelho, caneta)
  '',                                            // 11
  '[Verso 2]',                                   // 12
  'Bateram na parede lá do terceiro andar',      // 13 ← sublinhado da linha longa (verde, dedo)
  'Baixamos o volume',                           // 14
].join('\n')
const LN_UNDER = 2
const LN_QUAD = [7, 8, 9, 10]
const LN_CIRCLE = 10
const WORD = 'quatro'
const WORD_PREV = 'até'
const LN_LONG = 13

const SONG_ID = 'sgE'
const SETLIST_ID = 'sE'
const ANN_KEY = `gigio_ann_v1_${SONG_ID}`
const FONT_KEY = 'gigio-rehearsal-font-size'

// Cores da paleta do Ensaio (SongPage: ANN_COLORS) — identificam cada traço
const C = { under: '#f59e0b', bracket: '#2563eb', circle: '#dc2626', long: '#16a34a' }
// Largura escolhida no Ensaio (px a 1em = em do desenho)
const W = { under: 4, bracket: 4, circle: 2, long: 4 }

// Fixtures: uma música e um concerto só com ela (o resto dos fixtures fica igual)
const SONG = {
  ...TABLES.songs[0], id: SONG_ID, title: 'Ensaio na garagem', artist: 'Teste', lyrics: LYRICS,
  edited_lyrics: null, has_sync: false, performance_key: null, original_key: null,
}
TABLES.songs.push(SONG)
TABLES.setlists.push({ ...TABLES.setlists[0], id: SETLIST_ID, name: 'Teste das anotações', setlist_songs: [{ count: 1 }] })
TABLES.setlist_songs.push({
  ...TABLES.setlist_songs[0], id: 'ssE', setlist_id: SETLIST_ID, song_id: SONG_ID, position: 0,
  performance_key: null, notes: null, custom_intro: null, custom_ending: null, song: SONG,
})

/** Outra música num concerto só com ela (cenários que não podem mexer na sgE) */
function addSong(id, setlistId, lyrics) {
  const song = { ...SONG, id, title: `Teste ${id}`, lyrics }
  TABLES.songs.push(song)
  TABLES.setlists.push({ ...TABLES.setlists[0], id: setlistId, name: `Teste ${id}`, setlist_songs: [{ count: 1 }] })
  TABLES.setlist_songs.push({
    ...TABLES.setlist_songs[0], id: `ss_${id}`, setlist_id: setlistId, song_id: id, position: 0,
    performance_key: null, notes: null, custom_intro: null, custom_ending: null, song,
  })
  return song
}
// Instrumental ("Sem letra"): os traços ficam livres na folha
const FREE_ID = 'sgV'
addSong(FREE_ID, 'sV', '')
// A mesma letra, para a nota "FIM" abaixo da última linha
const FIM_ID = 'sgF'
addSong(FIM_ID, 'sF', LYRICS)

// ── Resultados ──────────────────────────────────────────────────────────────
let passed = 0
const failures = []
function ok(cond, label, info) {
  if (cond) { passed++; return true }
  const msg = info === undefined ? label : `${label} — ${typeof info === 'string' ? info : JSON.stringify(info)}`
  failures.push(msg)
  console.log('  FALHOU', msg)
  return false
}
const r1 = v => Math.round(v * 10) / 10
const r3 = v => Math.round(v * 1000) / 1000

// ── Browser, mocks e input ──────────────────────────────────────────────────
/**
 * Contexto novo = outro aparelho. `seed` vai para o localStorage UMA vez (no
 * 1.º carregamento do separador); `cloud` é a linha de song_annotations do
 * utilizador; `concertTheme` é o profiles.concert_theme.
 * Rede da cloud: `dev.pullDelay` (ms) atrasa cada leitura de
 * song_annotations; `dev.pullFail` = quantas leituras ainda falham (500).
 */
async function newDevice(browser, { viewport, phone = false, seed = {}, cloud = null, concertTheme = null }) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: phone, serviceWorkers: 'block',
  })
  const dev = { ctx, cloud, writes: 0, reads: 0, pullDelay: 0, pullFail: 0 }
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    const table = url.pathname.split('/rest/v1/')[1]?.split('/')[0]
    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (table === 'profiles' && url.searchParams.get('select') === 'concert_theme') {
      return json(200, wantsObject ? { concert_theme: concertTheme } : [{ concert_theme: concertTheme }])
    }
    if (table === 'song_annotations') {
      const m = req.method()
      if (m === 'POST' || m === 'PATCH') {
        dev.writes++
        const body = JSON.parse(req.postData() ?? '{}')
        dev.cloud = Array.isArray(body) ? body[0] : body
        return json(201, wantsObject ? dev.cloud : [dev.cloud])
      }
      dev.reads++
      if (dev.pullDelay) await new Promise(r => setTimeout(r, dev.pullDelay))
      if (dev.pullFail > 0) {
        dev.pullFail--
        return json(500, { message: 'falha simulada' })
      }
      const row = dev.cloud && url.searchParams.get('song_id') === `eq.${dev.cloud.song_id}` ? dev.cloud : null
      return json(200, wantsObject ? row : row ? [row] : [])
    }
    return restResponse(route)
  })
  await ctx.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/user') ? USER : SESSION) }))
  await ctx.route(/lrclib|genius|nominatim/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await ctx.addInitScript(({ auth, seed }) => {
    localStorage.setItem('sb-mockproj-auth-token', auth)
    localStorage.setItem('gigio-theme', 'dark')
    if (!sessionStorage.getItem('__e2e_seeded')) {
      sessionStorage.setItem('__e2e_seeded', '1')
      for (const [k, v] of Object.entries(seed)) {
        if (v === null) localStorage.removeItem(k)
        else localStorage.setItem(k, v)
      }
    }
    // Que tipo de ponteiro a app recebeu (caneta / dedo)
    window.__ptypes = []
    document.addEventListener('pointerdown', e => window.__ptypes.push(e.pointerType), true)
    // Layout de referência dos traços antigos (LegacyReference): montagem,
    // largura e o tamanho de letra escolhido — é desmontado logo a seguir
    window.__refLog = []
    const isRef = n => n && n.nodeType === 1 && n.matches('div[aria-hidden="true"]') && n.querySelector('[data-ln]')
    const sizeOf = host => {
      const line = host.querySelector('[data-ln]')
      return line ? line.parentElement.style.getPropertyValue('--lyric-size') : ''
    }
    new MutationObserver(records => {
      for (const rec of records) {
        if (rec.type === 'childList') {
          for (const n of rec.addedNodes) if (isRef(n)) window.__refLog.push({ ev: 'mount', width: n.firstElementChild?.style.width, size: sizeOf(n) })
          for (const n of rec.removedNodes) if (isRef(n)) window.__refLog.push({ ev: 'unmount', size: sizeOf(n) })
        } else if (rec.type === 'attributes') {
          const host = rec.target.closest && rec.target.closest('div[aria-hidden="true"]')
          if (host && isRef(host)) window.__refLog.push({ ev: 'size', size: sizeOf(host) })
        }
      }
      // (o init script corre antes de existir <html>: observa-se o document)
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  }, { auth: JSON.stringify(SESSION), seed })
  dev.page = await ctx.newPage()
  dev.page.on('pageerror', e => ok(false, 'erro de JavaScript na página', String(e).slice(0, 300)))
  return dev
}

/** Traço com a caneta (Apple Pencil): eventos de rato do CDP com pointerType 'pen' */
async function penStroke(page, pts) {
  const cdp = await page.context().newCDPSession(page)
  const ev = (type, [x, y], extra) => cdp.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen', ...extra })
  await ev('mouseMoved', pts[0], { button: 'none', buttons: 0 })
  await ev('mousePressed', pts[0], { button: 'left', buttons: 1, clickCount: 1, force: 0.5 })
  for (const p of pts.slice(1)) await ev('mouseMoved', p, { button: 'left', buttons: 1, force: 0.5 })
  await ev('mouseReleased', pts[pts.length - 1], { button: 'left', buttons: 0, clickCount: 1 })
  await cdp.detach()
}

/** Traço com o dedo: toques reais do CDP (pointerType 'touch') */
async function touchStroke(page, pts) {
  const cdp = await page.context().newCDPSession(page)
  const tp = ([x, y]) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) })
  for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

const payloadOf = (page, key = ANN_KEY) => page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null'), key)
const annStorage = page => page.evaluate(() => {
  const o = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k.startsWith('gigio_ann')) o[k] = localStorage.getItem(k)
  }
  return o
})

// ── Medição no DOM ──────────────────────────────────────────────────────────
const ENSAIO = '[class*="previewInner"]'
const CONCERT = '[class*="annotationsWrap"]'

/**
 * Retrato do que está no ecrã, em px do viewport: rows do TEXTO de cada
 * linha (Range.getClientRects, uma caixa por linha de ecrã), caixas de
 * palavras, e os caminhos da SVG (d, cor, largura, CTM para o viewport).
 * Implementação própria — não usa o código de medição da app.
 */
function snapshotIn([root, words]) {
  const host = document.querySelector(root)
  if (!host) return null
  const els = [...host.querySelectorAll('[data-ln]')]
  if (!els.length) return null
  const lv = els[0].parentElement
  const textEl = els.find(e => !e.hasAttribute('data-sec'))
  const cs = getComputedStyle(textEl)
  const range = document.createRange()
  const textNode = el => [...el.childNodes].find(n => n.nodeType === 3 && n.data.length > 0)
  const merge = rects => {
    const out = []
    for (const b of rects) {
      if (b.width <= 0 || b.height <= 0) continue
      const last = out[out.length - 1]
      if (last && Math.abs(last.t - b.top) < b.height / 2) {
        last.l = Math.min(last.l, b.left); last.r = Math.max(last.r, b.right); last.b = Math.max(last.b, b.bottom)
        continue
      }
      out.push({ l: b.left, t: b.top, r: b.right, b: b.bottom })
    }
    return out
  }
  const rows = {}
  const text = {}
  for (const el of els) {
    const n = textNode(el)
    if (!n) continue
    range.selectNodeContents(n)
    rows[el.dataset.ln] = merge(range.getClientRects())
    text[el.dataset.ln] = n.data
  }
  const wordRects = {}
  for (const [key, ln, word] of words) {
    const el = host.querySelector(`[data-ln="${ln}"]`)
    const n = el && textNode(el)
    const i = n ? n.data.indexOf(word) : -1
    if (i < 0) continue
    range.setStart(n, i)
    range.setEnd(n, i + word.length)
    const parts = merge(range.getClientRects())
    if (parts.length) wordRects[key] = { l: Math.min(...parts.map(p => p.l)), t: Math.min(...parts.map(p => p.t)), r: Math.max(...parts.map(p => p.r)), b: Math.max(...parts.map(p => p.b)), rows: parts.length }
  }
  const svg = host.querySelector('svg')
  const m = svg && svg.getScreenCTM()
  const paths = svg ? [...svg.querySelectorAll(':scope > path')].map(p => ({
    d: p.getAttribute('d') ?? '', color: (p.getAttribute('stroke') ?? '').toLowerCase(), width: parseFloat(p.getAttribute('stroke-width')),
  })) : []
  const svgBox = svg ? svg.getBoundingClientRect() : null
  const bb = lv.getBoundingClientRect()
  return {
    em: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), font: cs.fontFamily, align: cs.textAlign,
    block: { l: bb.left, t: bb.top, r: bb.right, b: bb.bottom },
    layer: svgBox && { l: svgBox.left, t: svgBox.top },
    rows, text, words: wordRects, ctm: m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null, paths,
  }
}
const WORDS = [['word', LN_CIRCLE, WORD], ['prev', LN_CIRCLE, WORD_PREV]]
const snapshot = (page, root) => page.evaluate(snapshotIn, [root, WORDS])

/** Espera que o texto e os traços parem de mexer (fontes, ResizeObserver, rAF) */
async function settle(page, root) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  let prev = null
  for (let i = 0; i < 40; i++) {
    const sig = await page.evaluate(root => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const host = document.querySelector(root)
      if (!host) return res(null)
      const ds = [...host.querySelectorAll('svg > path')].map(p => p.getAttribute('d')).join('|')
      const ln = [...host.querySelectorAll('[data-ln]')].map(e => JSON.stringify(e.getBoundingClientRect())).join('|')
      res(`${ds}#${ln}`)
    }))), root)
    if (sig && sig === prev) return
    prev = sig
    await page.waitForTimeout(80)
  }
}

/** Atributo d → subcaminhos de pontos [x,y] no viewport (curvas Q amostradas) */
function parsePath(d, ctm) {
  const toks = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
  const subs = []
  let cur = null
  let cmd = null
  let px = 0
  let py = 0
  let i = 0
  const num = () => Number(toks[i++])
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) { cmd = toks[i++]; continue }
    if (cmd === 'M') {
      px = num(); py = num()
      cur = [[px, py]]
      subs.push(cur)
      cmd = 'L'
    } else if (cmd === 'L') {
      px = num(); py = num()
      cur.push([px, py])
    } else if (cmd === 'Q') {
      const cx = num(), cy = num(), x = num(), y = num()
      for (let k = 1; k <= 8; k++) {
        const t = k / 8
        cur.push([(1 - t) ** 2 * px + 2 * (1 - t) * t * cx + t * t * x, (1 - t) ** 2 * py + 2 * (1 - t) * t * cy + t * t * y])
      }
      px = x; py = y
    } else throw new Error(`comando SVG inesperado no d: ${cmd}`)
  }
  const [a, b, c, dd, e, f] = ctm ?? [1, 0, 0, 1, 0, 0]
  return subs.map(sp => sp.map(([x, y]) => [a * x + c * y + e, b * x + dd * y + f]))
}

function inPolygon([x, y], poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const bbox = pts => ({
  l: Math.min(...pts.map(p => p[0])), r: Math.max(...pts.map(p => p[0])),
  t: Math.min(...pts.map(p => p[1])), b: Math.max(...pts.map(p => p[1])),
})

/** Todas as rows (de todas as linhas) por ordem vertical — a sequência global */
function rowSequence(S) {
  const all = []
  for (const [ln, rs] of Object.entries(S.rows)) rs.forEach((r, ri) => all.push({ ...r, ln: Number(ln), ri }))
  return all.sort((a, b) => a.t - b.t || a.l - b.l)
}
/** Topo da row seguinte (na vertical) a uma row; Infinity se é a última */
function nextTop(S, row) {
  const seq = rowSequence(S)
  const nxt = seq.find(r => r.t > row.t + (row.b - row.t) / 2)
  return nxt ? nxt.t : Infinity
}

// ── Asserções ───────────────────────────────────────────────────────────────
const EPS = 0.5   // px — arredondamentos (âncoras a 3 casas, d a 2 casas)

function pathByColor(S, label, color) {
  const ps = S.paths.filter(p => p.color === color)
  if (!ok(ps.length === 1, `${label}: um caminho ${color}`, { encontrados: ps.length, cores: S.paths.map(p => p.color) })) return null
  return { ...ps[0], subpaths: parsePath(ps[0].d, S.ctm) }
}

/** Largura do traço escala com em_destino/em_desenho (mínimo 1.5px) */
function checkWidth(label, p, wDrawn, emDrawn, S) {
  const want = Math.max(1.5, wDrawn * S.em / emDrawn)
  ok(Math.abs(p.width - want) <= 0.06, `${label}: largura do traço escala com o em`, { medida: p.width, esperada: r3(want) })
}

/**
 * (1)/(4) Sublinhado da linha `ln`: cada subcaminho fica por baixo de UMA
 * row da linha — todos os pontos abaixo do fundo dela e acima do topo da row
 * seguinte, x dentro da extensão dela ±0.6em — e cada row tem o seu.
 */
function checkUnderline(label, S, ln, color, { minParts = 1 } = {}) {
  const p = pathByColor(S, label, color)
  if (!p) return
  const rows = S.rows[ln] ?? []
  const em = S.em
  const used = new Set()
  const info = []
  p.subpaths.forEach((sp, k) => {
    const bb = bbox(sp)
    const fits = rows.map((r, ri) => {
      const nt = nextTop(S, r)
      const yOk = sp.every(([, y]) => y >= r.b - EPS && y <= nt + EPS)
      const xOk = sp.every(([x]) => x >= r.l - 0.6 * em - EPS && x <= r.r + 0.6 * em + EPS)
      return { ri, yOk, xOk, nt }
    })
    const hit = fits.find(f => f.yOk && f.xOk)
    const near = rows.length ? rows.reduce((best, r, ri) => (Math.abs(bb.t - r.b) < Math.abs(bb.t - rows[best].b) ? ri : best), 0) : -1
    const r = rows[hit ? hit.ri : near]
    info.push({
      sub: k, row: hit ? hit.ri : null,
      y: [r1(bb.t), r1(bb.b)], rowBottom: r && r1(r.b), nextTop: r && r1(nextTop(S, r)),
      x: [r1(bb.l), r1(bb.r)], rowX: r && [r1(r.l), r1(r.r)],
    })
    ok(!!hit, `${label}: subcaminho ${k + 1}/${p.subpaths.length} do sublinhado da linha ${ln} entre a base da sua row e o topo da row seguinte, x na extensão ±0.6em`,
      { pontos: { y: [r1(bb.t), r1(bb.b)], x: [r1(bb.l), r1(bb.r)] }, rows: rows.map(r => ({ x: [r1(r.l), r1(r.r)], y: [r1(r.t), r1(r.b)], seguinte: r1(nextTop(S, r)) })), em })
    if (hit) {
      ok(!used.has(hit.ri), `${label}: um só subcaminho por row da linha ${ln}`, { row: hit.ri })
      used.add(hit.ri)
      const r = rows[hit.ri]
      ok(bb.l <= r.l + 0.6 * em && bb.r >= r.r - 0.6 * em, `${label}: sublinhado cobre a row ${hit.ri + 1} da linha ${ln} de ponta a ponta (±0.6em)`,
        { traço: [r1(bb.l), r1(bb.r)], row: [r1(r.l), r1(r.r)], em })
    }
  })
  ok(used.size === rows.length && p.subpaths.length === rows.length,
    `${label}: linha ${ln} em ${rows.length} row(s) → ${rows.length} subcaminho(s), um por row`, { rows: rows.length, subcaminhos: p.subpaths.length })
  if (minParts > 1) ok(p.subpaths.length >= minParts, `${label}: sublinhado da linha longa partido em ≥${minParts} subcaminhos`, { subcaminhos: p.subpaths.length })
  return { p, info }
}

/** (2) Chaveta à esquerda da quadra: não toca no texto, quase vertical, do topo da 1.ª ao fundo da 4.ª ±0.4em */
function checkBracket(label, S, lns, color) {
  const p = pathByColor(S, label, color)
  if (!p) return
  const em = S.em
  ok(p.subpaths.length === 1, `${label}: chaveta num só caminho`, { subcaminhos: p.subpaths.length })
  const pts = p.subpaths.flat()
  const bb = bbox(pts)
  const rs = lns.flatMap(ln => S.rows[ln] ?? [])
  const textLeft = Math.min(...rs.map(r => r.l))
  const top = S.rows[lns[0]][0].t
  const lastRows = S.rows[lns[lns.length - 1]]
  const bottom = lastRows[lastRows.length - 1].b
  ok(bb.r < textLeft, `${label}: chaveta à esquerda do início do texto dos ${lns.length} versos`, { chavetaDireita: r1(bb.r), textoEsquerda: r1(textLeft), folga: r1(textLeft - bb.r) })
  ok(bb.r + p.width / 2 <= textLeft + EPS, `${label}: a tinta da chaveta não toca nas letras`, { tintaDireita: r1(bb.r + p.width / 2), textoEsquerda: r1(textLeft) })
  const xspan = bb.r - bb.l
  const yspan = bb.b - bb.t
  ok(xspan <= 0.5 * em && yspan >= 4 * Math.max(xspan, 1), `${label}: chaveta quase vertical`, { largura: r1(xspan), altura: r1(yspan), em })
  ok(Math.abs(bb.t - top) <= 0.4 * em && Math.abs(bb.b - bottom) <= 0.4 * em,
    `${label}: chaveta do topo da linha ${lns[0]} ao fundo da linha ${lns[lns.length - 1]} (±0.4em)`,
    { chaveta: [r1(bb.t), r1(bb.b)], texto: [r1(top), r1(bottom)], desvio_em: [r3((bb.t - top) / em), r3((bb.b - bottom) / em)] })
  return { p, bb, textLeft }
}

/** (3) Círculo à volta da palavra: contém a caixa dela (cantos e meios das arestas), não a palavra anterior */
function checkCircle(label, S, color) {
  const p = pathByColor(S, label, color)
  if (!p) return
  const w = S.words.word
  if (!ok(!!w, `${label}: palavra "${WORD}" encontrada na linha ${LN_CIRCLE}`)) return
  ok(p.subpaths.length === 1, `${label}: círculo num só caminho`, { subcaminhos: p.subpaths.length })
  const poly = p.subpaths[0]
  const mx = (w.l + w.r) / 2
  const my = (w.t + w.b) / 2
  const probes = [[w.l, w.t], [w.r, w.t], [w.l, w.b], [w.r, w.b], [mx, w.t], [mx, w.b], [w.l, my], [w.r, my]]
  const out = probes.filter(q => !inPolygon(q, poly))
  const bb = bbox(poly)
  ok(out.length === 0, `${label}: círculo contém a caixa da palavra "${WORD}"`,
    { fora: out.map(q => q.map(r1)), palavra: { x: [r1(w.l), r1(w.r)], y: [r1(w.t), r1(w.b)] }, círculo: { x: [r1(bb.l), r1(bb.r)], y: [r1(bb.t), r1(bb.b)] } })
  const prev = S.words.prev
  if (prev) ok(!inPolygon([(prev.l + prev.r) / 2, (prev.t + prev.b) / 2], poly), `${label}: círculo não engole a palavra anterior ("${WORD_PREV}")`)
  return { p, bb }
}

/** As quatro asserções num layout */
function checkAll(label, S, { emDrawn = 32, expectLongWrap = null } = {}) {
  if (!ok(!!S, `${label}: letra e camada medidas`)) return
  const visible = S.paths.filter(p => p.d)
  ok(visible.length === 4, `${label}: 4 traços desenhados`, { caminhos: visible.length })
  const u = checkUnderline(label, S, LN_UNDER, C.under)
  const b = checkBracket(label, S, LN_QUAD, C.bracket)
  const c = checkCircle(label, S, C.circle)
  const longRows = (S.rows[LN_LONG] ?? []).length
  if (expectLongWrap === true) ok(longRows >= 2, `${label}: a linha longa quebra neste layout (pré-condição)`, { rows: longRows })
  if (expectLongWrap === false) ok(longRows === 1, `${label}: a linha longa cabe numa row neste layout (pré-condição)`, { rows: longRows })
  const l = checkUnderline(label, S, LN_LONG, C.long, { minParts: longRows >= 2 ? 2 : 1 })
  for (const [k, res] of [['under', u], ['bracket', b], ['circle', c], ['long', l]]) if (res?.p) checkWidth(`${label} (${k})`, res.p, W[k], emDrawn, S)
  // Resumo numérico (para a revisão humana)
  const r2r = S.rows[LN_UNDER][0]
  const uBB = u?.p ? bbox(u.p.subpaths.flat()) : null
  console.log(`    ${label}: letra ${r1(S.em)}px · entrelinha ${r3(S.lh)} · bloco ${r1(S.block.l)}–${r1(S.block.r)} · linha longa em ${longRows} row(s)` +
    (uBB ? ` · sublinhado ${r3((uBB.t - r2r.b) / S.em)}–${r3((uBB.b - r2r.b) / S.em)}em abaixo do verso (intervalo ${r3((nextTop(S, r2r) - r2r.b) / S.em)}em)` : '') +
    (b ? ` · chaveta a ${r3((b.textLeft - b.bb.r) / S.em)}em do texto` : '') +
    (l?.p ? ` · linha longa: ${l.p.subpaths.length} subcaminho(s)` : ''))
}

// ── Formas desenhadas (px do viewport, a partir das caixas do texto) ───────
function shapes(S) {
  const em = S.em
  const wob = (i, a = 0.6) => a * Math.sin(i * 1.7)
  const line = (x0, x1, y, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y + wob(i)])
  // (1) sublinhado logo abaixo do verso (5px a 32px ≈ 0.16em)
  const ru = S.rows[LN_UNDER][0]
  const under = line(ru.l - 3, ru.r + 3, ru.b + 0.16 * em, 30)
  // (2) chaveta "[" à esquerda da quadra: 0.8em antes do texto, bicos de 0.25em
  const rs = LN_QUAD.flatMap(ln => S.rows[ln])
  const x0 = Math.min(...rs.map(r => r.l)) - 0.8 * em
  const top = S.rows[LN_QUAD[0]][0].t
  const lastQ = S.rows[LN_QUAD[3]]
  const bottom = lastQ[lastQ.length - 1].b
  const tick = 0.25 * em
  const seg = (a, b, n) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n])
  const bracket = [[x0 + tick, top], ...seg([x0 + tick, top], [x0, top + 2], 4), ...seg([x0, top + 2], [x0, bottom - 2], 30), ...seg([x0, bottom - 2], [x0 + tick, bottom], 4)]
  // (3) laço à volta da palavra (superelipse, como uma volta à mão), fecha com sobreposição
  const w = S.words.word
  const cx = (w.l + w.r) / 2
  const cy = (w.t + w.b) / 2
  const a = (w.r - w.l) / 2 + 0.35 * em
  const b = (w.b - w.t) / 2 + 0.22 * em
  const e = 2 / 3.5
  const circle = Array.from({ length: 57 }, (_, i) => {
    const t = Math.PI + (2 * Math.PI + 0.35) * i / 56
    const c = Math.cos(t)
    const s = Math.sin(t)
    return [cx + a * Math.sign(c) * Math.abs(c) ** e, cy + b * Math.sign(s) * Math.abs(s) ** e]
  })
  // (4) sublinhado da linha longa (que aqui cabe numa row)
  const rl = S.rows[LN_LONG][0]
  const long = line(rl.l - 3, rl.r + 3, rl.b + 0.16 * em, 40)
  return { under, bracket, circle, long }
}

// ── Navegação ───────────────────────────────────────────────────────────────
/**
 * Abre o Ensaio. `wait: false` não espera pela rede parada nem pelos traços
 * (a leitura da cloud pode estar atrasada de propósito); `withText: false`
 * para uma música sem letra (não há [data-ln])
 */
async function openEnsaio(page, { song = SONG_ID, wait = true, withText = true } = {}) {
  await page.goto(`${BASE}/songs/${song}`, { waitUntil: wait ? 'networkidle' : 'domcontentloaded' })
  await page.click('button[title="Ensaio: ler e anotar a letra"]')
  if (withText) await page.waitForSelector(`${ENSAIO} [data-ln]`)
  await page.waitForSelector(`${ENSAIO} svg`)
  if (wait) await settle(page, ENSAIO)
  else await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function openConcert(page, nPaths = 4, { setlist = SETLIST_ID, withText = true } = {}) {
  await page.goto(`${BASE}/setlist/${setlist}/concert`, { waitUntil: 'networkidle' })
  const key = await page.waitForSelector('button[aria-label="Anotações de ensaio"]', { timeout: 8000 }).catch(() => null)
  if (!ok(!!key, 'concerto: a tecla "Anotações de ensaio" aparece')) return false
  await key.click()
  await page.waitForSelector(withText ? `${CONCERT} [data-ln]` : CONCERT)
  const drawn = await page.waitForFunction(([root, n]) => document.querySelector(root)?.querySelectorAll('svg > path').length === n,
    [CONCERT, nPaths], { timeout: 8000 }).then(() => true, () => false)
  ok(drawn, `concerto: ${nPaths} traços aparecem`)
  await settle(page, CONCERT)
  return true
}

/** Capturas do ecrã atual; se a letra não cabe, também com o fim à vista */
async function shots(page, name, scrollSel) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  const more = await page.evaluate(sel => {
    const el = document.querySelector(sel)
    if (!el || el.scrollHeight <= el.clientHeight + 4) return false
    el.scrollTop = el.scrollHeight
    return true
  }, scrollSel)
  if (more) {
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(OUT, `${name}--fim.png`) })
    await page.evaluate(sel => { document.querySelector(sel).scrollTop = 0 }, scrollSel)
  }
}
/**
 * Fotogramas: regista onde está o sublinhado (cor `color`) em relação ao
 * texto da linha `ln` em cada rAF e em cada callback de um ResizeObserver
 * registado DEPOIS dos da app — corre depois do layout, mesmo antes de
 * pintar —, sobre a SVG, o bloco e o próprio caminho (o caminho muda de
 * caixa quando é redesenhado). Ler com window.__stopFrames().
 */
async function watchFrames(page, root, ln, color) {
  await page.evaluate(([root, ln, color]) => {
    const host = document.querySelector(root)
    const svg = host.querySelector('svg')
    const path = [...svg.querySelectorAll(':scope > path')].find(p => (p.getAttribute('stroke') ?? '').toLowerCase() === color)
    const log = []
    const snap = ev => {
      const el = host.querySelector(`[data-ln="${ln}"]`)
      const n = el && [...el.childNodes].find(x => x.nodeType === 3)
      if (!n || !path || !path.isConnected) return
      const g = document.createRange()
      g.selectNodeContents(n)
      const rs = [...g.getClientRects()].filter(b => b.width > 0)
      const pb = path.getBoundingClientRect()
      const em = parseFloat(getComputedStyle(el).fontSize)
      log.push({
        ev, em,
        dy: (pb.top - rs[rs.length - 1].bottom) / em,
        dl: (pb.left - Math.min(...rs.map(b => b.left))) / em,
        dr: (pb.right - Math.max(...rs.map(b => b.right))) / em,
      })
    }
    const ro = new ResizeObserver(() => snap('RO'))
    for (const t of [svg, host, path]) if (t) ro.observe(t)
    let alive = true
    const tick = () => { if (!alive) return; snap('rAF'); requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__stopFrames = () => { alive = false; ro.disconnect(); return log }
  }, [root, ln, color])
}

/** Em todos os fotogramas registados o sublinhado está por baixo do verso (no intervalo) e da mesma largura */
function checkFrames(label, log) {
  const bad = log.filter(f => !(f.dy >= -0.02 && f.dy <= 0.45 && Math.abs(f.dl) <= 0.3 && Math.abs(f.dr) <= 0.3))
  const ems = [...new Set(log.map(f => f.em))]
  ok(log.length >= 3 && ems.length >= 2, `${label}: fotogramas registados antes e depois da mudança`, { fotogramas: log.length, em: ems })
  ok(bad.length === 0, `${label}: em nenhum fotograma o sublinhado sai de baixo do verso (nem é esticado)`,
    bad.slice(0, 4).map(f => ({ ev: f.ev, em: f.em, dy: r3(f.dy), dl: r3(f.dl), dr: r3(f.dr) })))
}

const ENSAIO_SCROLL = '[class*="previewPane"]'
const CONCERT_SCROLL = `[class*="lyricsScroll"]:has(${CONCERT})`

const anchoredLns = enc => {
  const runs = enc[4]
  const out = []
  for (let i = 0; i < runs.length; i += 3) for (let k = 0; k < runs[i + 2]; k++) out.push(runs[i])
  return out
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
const server = staticServer()
await new Promise(r => server.listen(PORT, r))
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const TABLET_PORT = { width: 820, height: 1180 }
const TABLET_LAND = { width: 1180, height: 820 }
const PHONE = { width: 390, height: 844 }

try {
  // ══ Cenário A: traços novos no Ensaio ═══════════════════════════════════
  console.log('— A. Ensaio, iPad retrato 820×1180 (32px): desenhar com caneta e dedo')
  const A = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FONT_KEY]: null, [ANN_KEY]: null } })
  let page = A.page
  await openEnsaio(page)
  let S = await snapshot(page, ENSAIO)
  ok(S.em === 32, 'Ensaio abre a 32px', S.em)
  ok(S.align === 'center', 'Ensaio: letra centrada', S.align)
  ok((S.rows[LN_UNDER] ?? []).length === 1 && LN_QUAD.every(ln => S.rows[ln].length === 1) && S.rows[LN_LONG].length === 1,
    'pré-condição: verso, quadra e linha longa numa row cada no Ensaio a 32px', Object.fromEntries([LN_UNDER, ...LN_QUAD, LN_LONG].map(ln => [ln, S.rows[ln]?.length])))
  const sh = shapes(S)
  const pick = async (color, width) => {
    await page.click(`button[aria-label="Cor ${color}"]`)
    await page.click(`button[aria-label="${width}"]`)
  }
  const waitCount = n => page.waitForFunction(([k, n]) => (JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored?.length ?? 0) === n, [ANN_KEY, n], { timeout: 5000 }).then(() => true, () => false)
  await pick('âmbar', 'Traço médio')
  await penStroke(page, sh.under)
  ok(await waitCount(1), 'traço 1 (sublinhado) gravado')
  await pick('azul', 'Traço médio')
  await penStroke(page, sh.bracket)
  ok(await waitCount(2), 'traço 2 (chaveta) gravado')
  await pick('vermelho', 'Traço fino')
  await penStroke(page, sh.circle)
  ok(await waitCount(3), 'traço 3 (círculo) gravado')
  await pick('verde', 'Traço médio')
  await touchStroke(page, sh.long)
  ok(await waitCount(4), 'traço 4 (sublinhado da linha longa, com o dedo) gravado')
  // (os cliques nos botões da fita são 'mouse')
  const ptypes = await page.evaluate(() => window.__ptypes.filter(t => t !== 'mouse'))
  ok(JSON.stringify(ptypes) === JSON.stringify(['pen', 'pen', 'pen', 'touch']), 'a app recebeu caneta ×3 e dedo ×1', ptypes)

  const P = await payloadOf(page)
  ok(P && P.v === 2 && P.em === 32 && P.w > 0 && P.h > 0 && Array.isArray(P.strokes) && P.strokes.length >= 4,
    'payload v2 com em=32 e a cópia antiga {w,h,strokes} em px', P && { v: P.v, em: P.em, w: P.w, h: P.h, strokes: P.strokes?.length })
  const byColor = Object.fromEntries((P?.anchored ?? []).map(e => [String(e[1]).toLowerCase(), e]))
  ok(byColor[C.under]?.[3] === 0 && byColor[C.bracket]?.[3] === 1 && byColor[C.circle]?.[3] === 0 && byColor[C.long]?.[3] === 0,
    'modos: sublinhados e círculo = texto, chaveta = margem', Object.fromEntries(Object.entries(byColor).map(([k, e]) => [k, e[3]])))
  if (byColor[C.circle]) {
    const lns = anchoredLns(byColor[C.circle])
    const n10 = lns.filter(l => l === LN_CIRCLE).length
    ok(n10 > lns.length / 2 && !lns.includes(8), `círculo ancorado à 2.ª "Conta até quatro" (linha ${LN_CIRCLE}), não à 1.ª (linha 8)`, { linhas: [...new Set(lns)], naLinha10: n10, total: lns.length })
  }
  if (byColor[C.under]) ok(anchoredLns(byColor[C.under]).every(l => l === LN_UNDER), `sublinhado ancorado só à linha ${LN_UNDER}`, [...new Set(anchoredLns(byColor[C.under]))])
  if (byColor[C.long]) ok(anchoredLns(byColor[C.long]).every(l => l === LN_LONG), `sublinhado longo ancorado só à linha ${LN_LONG}`, [...new Set(anchoredLns(byColor[C.long]))])
  ok(P?.lines?.[String(LN_CIRCLE)] === 'Conta até quatro' && P?.lines?.[String(LN_UNDER)] === 'O baixo desafinou', 'payload.lines guarda o texto das linhas')

  await settle(page, ENSAIO)
  S = await snapshot(page, ENSAIO)
  checkAll('Ensaio retrato 32px', S, { expectLongWrap: false })
  await shots(page, 'A1-ensaio-ipad-retrato-32px', ENSAIO_SCROLL)

  console.log('— A. Ensaio: A+ ×2 (40px)')
  ok(await page.evaluate(root => !document.querySelector(root).querySelector('svg').hasAttribute('viewBox'), ENSAIO),
    'Ensaio: SVG sem viewBox (unidades = px da camada, nunca esticada ao novo tamanho)')
  await watchFrames(page, ENSAIO, LN_UNDER, C.under)
  await page.click('button[aria-label="Aumentar letra"]')
  await page.click('button[aria-label="Aumentar letra"]')
  await page.waitForFunction(root => parseFloat(getComputedStyle(document.querySelector(root).querySelector('[data-ln="1"]')).fontSize) === 40, ENSAIO)
  await page.waitForTimeout(250)
  checkFrames('Ensaio A+ ×2', await page.evaluate(() => window.__stopFrames()))
  await settle(page, ENSAIO)
  S = await snapshot(page, ENSAIO)
  checkAll('Ensaio retrato 40px', S, { expectLongWrap: true })
  const P40 = await payloadOf(page)
  ok(JSON.stringify(P40?.anchored) === JSON.stringify(P?.anchored), 'A+ não mexe nas âncoras guardadas')
  await shots(page, 'A2-ensaio-ipad-retrato-40px', ENSAIO_SCROLL)

  console.log('— A. Ensaio: rodar para paisagem 1180×820 (40px)')
  await page.setViewportSize(TABLET_LAND)
  await settle(page, ENSAIO)
  S = await snapshot(page, ENSAIO)
  checkAll('Ensaio paisagem 40px', S)
  ok(JSON.stringify((await payloadOf(page))?.anchored) === JSON.stringify(P?.anchored), 'rodar não mexe nas âncoras guardadas')
  await shots(page, 'A3-ensaio-ipad-paisagem-40px', ENSAIO_SCROLL)
  await A.ctx.close()

  // ── Concerto, vários layouts (outro aparelho com o payload v2) ──────────
  const LAYOUTS = [
    ['tablet paisagem, letra grande (44→64px)', 'C1-concerto-ipad-paisagem-64px', TABLET_LAND, false, { font_size: 44, line_height: 1.6 }],
    ['tablet retrato (32→46px)', 'C2-concerto-ipad-retrato-46px', TABLET_PORT, false, { font_size: 32, line_height: 1.6 }],
    ['telemóvel (32px), via cloud', 'C3-concerto-telemovel-32px', PHONE, true, { font_size: 32, line_height: 1.6 }],
    ['tablet retrato, entrelinha 1.3', 'C4-concerto-ipad-retrato-lh1.3', TABLET_PORT, false, { font_size: 32, line_height: 1.3 }],
    ['tablet paisagem, entrelinha 2.0', 'C5-concerto-ipad-paisagem-lh2.0', TABLET_LAND, false, { font_size: 28, line_height: 2.0 }],
    ['telemóvel, entrelinha 1.3 (28px)', 'C6-concerto-telemovel-lh1.3', PHONE, true, { font_size: 28, line_height: 1.3 }],
    ['telemóvel, entrelinha 2.0 (36px)', 'C7-concerto-telemovel-lh2.0', PHONE, true, { font_size: 36, line_height: 2.0 }],
  ]
  for (const [label, shot, viewport, phone, theme] of LAYOUTS) {
    console.log(`— A. Concerto: ${label}`)
    const viaCloud = label.includes('cloud')
    const dev = await newDevice(browser, {
      viewport, phone, concertTheme: { bg: '#0B0B0C', active_color: '#F2F1EC', accent_color: '#FF6A26', align: 'left', ...theme },
      seed: viaCloud ? { [ANN_KEY]: null } : { [ANN_KEY]: JSON.stringify(P) },
      cloud: viaCloud ? { song_id: SONG_ID, user_id: 'u1', strokes: P, updated_at: new Date().toISOString() } : null,
    })
    const before = await (async () => { await dev.page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); return annStorage(dev.page) })()
    if (await openConcert(dev.page)) {
      const CS = await snapshot(dev.page, CONCERT)
      const wantEm = phone ? theme.font_size : Math.round(theme.font_size * 1.45)
      ok(CS?.em === wantEm && Math.abs(CS.lh - theme.line_height) < 0.01, `concerto ${label}: letra a ${wantEm}px, entrelinha ${theme.line_height}`, CS && { em: CS.em, lh: r3(CS.lh) })
      checkAll(`Concerto ${label}`, CS, { expectLongWrap: phone ? true : null })
      await shots(dev.page, shot, CONCERT_SCROLL)
      ok(JSON.stringify(await annStorage(dev.page)) === JSON.stringify(before) && dev.writes === 0, `concerto ${label}: não escreve no storage nem na cloud`, { cloud: dev.writes })
    }
    await dev.ctx.close()
  }

  // ══ Cenário B: payload ANTIGO {w,h,strokes} sem âncoras ═════════════════
  // Os px saem das caixas do texto do Ensaio (iPad retrato, 28px), como o
  // cliente antigo os gravava: relativos à camada, w/h = offsetWidth/Height
  // do bloco da letra.
  console.log('— B. Medir o Ensaio a 28px (iPad retrato) para fabricar o payload antigo')
  const LEGACY_FONT = 28
  const M = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FONT_KEY]: String(LEGACY_FONT), [ANN_KEY]: null } })
  await openEnsaio(M.page)
  const S28 = await snapshot(M.page, ENSAIO)
  const box = await M.page.evaluate(root => { const el = document.querySelector(root).firstElementChild; return [el.offsetWidth, el.offsetHeight] }, ENSAIO)
  ok(S28.em === LEGACY_FONT && S28.rows[LN_LONG].length === 1, `pré-condição: Ensaio a ${LEGACY_FONT}px com a linha longa numa row`, { em: S28.em, rows: S28.rows[LN_LONG].length })
  ok(Math.abs(S28.layer.l - S28.block.l) < 0.5 && Math.abs(S28.layer.t - S28.block.t) < 0.5, 'a camada começa no canto do bloco da letra (referencial dos px antigos)', { camada: S28.layer, bloco: S28.block })
  ok(await payloadOf(M.page) === null, 'abrir o Ensaio sem anotações não grava nada')
  await M.ctx.close()
  const sh28 = shapes(S28)
  const toLayer = pts => pts.flatMap(([x, y]) => [x - S28.layer.l, y - S28.layer.t])
  const LEGACY = {
    w: box[0], h: box[1],
    strokes: [
      { id: 'velho-1', pts: toLayer(sh28.under), color: C.under.toUpperCase(), width: W.under },
      { id: 'velho-2', pts: toLayer(sh28.bracket), color: C.bracket.toUpperCase(), width: W.bracket },
      { id: 'velho-3', pts: toLayer(sh28.circle), color: C.circle.toUpperCase(), width: W.circle },
      { id: 'velho-4', pts: toLayer(sh28.long), color: C.long.toUpperCase(), width: W.long },
    ],
  }
  const legacyRaw = JSON.stringify(LEGACY)

  // Payload antigo SEM h ({w, strokes}, clientes até ao #37): o Ensaio ainda
  // não tinha A−/A+ e a letra era sempre 32px (SongPage: fontSize={32}) — por
  // isso fabrica-se a partir do Ensaio a 32px, seja qual for o tamanho que o
  // aparelho que vê tem guardado agora
  console.log('— B. Medir o Ensaio a 32px (iPad retrato) para fabricar o payload antigo sem h')
  const NOH_FONT = 32
  const M32 = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FONT_KEY]: String(NOH_FONT), [ANN_KEY]: null } })
  await openEnsaio(M32.page)
  const S32 = await snapshot(M32.page, ENSAIO)
  const box32 = await M32.page.evaluate(root => document.querySelector(root).firstElementChild.offsetWidth, ENSAIO)
  ok(S32.em === NOH_FONT, `pré-condição: Ensaio a ${NOH_FONT}px`, S32.em)
  await M32.ctx.close()
  const sh32 = shapes(S32)
  const toLayer32 = pts => pts.flatMap(([x, y]) => [x - S32.layer.l, y - S32.layer.t])
  const LEGACY_NOH = {
    w: box32,
    strokes: [
      { id: 'velho-1', pts: toLayer32(sh32.under), color: C.under.toUpperCase(), width: W.under },
      { id: 'velho-2', pts: toLayer32(sh32.bracket), color: C.bracket.toUpperCase(), width: W.bracket },
      { id: 'velho-3', pts: toLayer32(sh32.circle), color: C.circle.toUpperCase(), width: W.circle },
      { id: 'velho-4', pts: toLayer32(sh32.long), color: C.long.toUpperCase(), width: W.long },
    ],
  }

  /**
   * Ensaio no telemóvel depois do concerto: o payload antigo (local ou da
   * cloud) migra para v2 contra a referência — as âncoras gravadas têm de
   * apontar para as linhas onde se desenhou, e ficam alinhadas aqui.
   */
  async function phoneEnsaio(dev, tag, shot, emDrawn = LEGACY_FONT) {
    console.log(`— ${tag}. Depois o Ensaio no telemóvel: migra para v2`)
    await dev.page.evaluate(() => { window.__refLog = [] })
    await openEnsaio(dev.page)
    const done = await dev.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.v === 2, ANN_KEY, { timeout: 5000 }).then(() => true, () => false)
    const p = await payloadOf(dev.page)
    ok(done && p?.anchored?.length === 4, `${tag} Ensaio telemóvel: payload antigo passa a v2`, p && { v: p.v, anchored: p.anchored?.length })
    const enc = Object.fromEntries((p?.anchored ?? []).map(e => [String(e[1]).toLowerCase(), e]))
    const want = { [C.under]: [LN_UNDER], [C.bracket]: LN_QUAD, [C.circle]: [LN_CIRCLE], [C.long]: [LN_LONG] }
    const got = Object.fromEntries(Object.entries(enc).map(([c, e]) => [c, { modo: e[3], linhas: [...new Set(anchoredLns(e))] }]))
    ok(Object.entries(want).every(([c, lns]) => enc[c] && anchoredLns(enc[c]).every(l => lns.includes(l))) &&
      enc[C.bracket]?.[3] === 1 && [C.under, C.circle, C.long].every(c => enc[c]?.[3] === 0),
    `${tag} Ensaio telemóvel: âncoras gravadas nas linhas e modos onde se desenhou`, got)
    await settle(dev.page, ENSAIO)
    checkAll(`${tag} Ensaio migrado, telemóvel ${LEGACY_FONT}px`, await snapshot(dev.page, ENSAIO), { emDrawn })
    await shots(dev.page, shot, ENSAIO_SCROLL)
    // A migração segue para a cloud (debounce 1.5s): é o que os outros aparelhos passam a ver
    for (let t = 0; t < 40 && !(dev.cloud?.strokes?.v === 2); t++) await dev.page.waitForTimeout(100)
    ok(dev.cloud?.strokes?.v === 2, `${tag}: migração do telemóvel segue para a cloud (v2)`, { cloud: dev.writes })
    return dev.cloud
  }

  /** O iPad onde se desenhou abre o concerto com o v2 que outro aparelho migrou e mandou para a cloud */
  async function ipadFromCloud(row, tag, shot, emDrawn = LEGACY_FONT) {
    if (!row) return
    console.log(`— ${tag}. iPad retrato recebe da cloud o v2 migrado no telemóvel`)
    const dev = await newDevice(browser, {
      viewport: TABLET_PORT, concertTheme: { font_size: 32, line_height: 1.6 },
      seed: { [FONT_KEY]: String(LEGACY_FONT), [ANN_KEY]: null }, cloud: row,
    })
    if (await openConcert(dev.page)) {
      checkAll(`${tag} concerto iPad retrato (v2 vindo do telemóvel)`, await snapshot(dev.page, CONCERT), { emDrawn })
      await shots(dev.page, shot, CONCERT_SCROLL)
    }
    await dev.ctx.close()
  }

  const refCheck = async (page, label, wantSize, wantW = LEGACY.w) => {
    const log = await page.evaluate(() => window.__refLog)
    const mounts = log.filter(e => e.ev === 'mount')
    const sizes = log.filter(e => e.size).map(e => e.size)
    ok(mounts.length >= 1, `${label}: usou o layout de referência`, log)
    ok(mounts.every(m => m.width === `${wantW}px`), `${label}: referência com a largura guardada (${wantW}px)`, mounts)
    ok(sizes.length && sizes[sizes.length - 1] === `${wantSize}px`, `${label}: referência com o tamanho do Ensaio que dá a altura guardada (${wantSize}px)`, sizes)
    ok(await page.evaluate(() => !document.querySelector('body > div[aria-hidden="true"] [data-ln]')), `${label}: referência desmontada`)
  }

  console.log('— B1. iPad retrato: concerto DIRETAMENTE com o payload antigo (tamanho guardado = o do desenho)')
  const B1 = await newDevice(browser, {
    viewport: TABLET_PORT, concertTheme: { font_size: 32, line_height: 1.6 },
    seed: { [FONT_KEY]: String(LEGACY_FONT), [ANN_KEY]: legacyRaw },
  })
  if (await openConcert(B1.page)) {
    checkAll('Concerto antigo, iPad retrato 46px', await snapshot(B1.page, CONCERT), { emDrawn: LEGACY_FONT })
    await refCheck(B1.page, 'concerto antigo iPad retrato', LEGACY_FONT)
    ok(await B1.page.evaluate(k => localStorage.getItem(k), ANN_KEY) === legacyRaw && B1.writes === 0, 'concerto não migra nem grava o payload antigo', { cloud: B1.writes })
    await shots(B1.page, 'B1-concerto-antigo-ipad-retrato-46px', CONCERT_SCROLL)
    // Desligar e voltar a ligar a vista de anotações: a migração fica em
    // memória (cache da sessão) — não se volta a montar e medir a referência
    const mounts0 = await B1.page.evaluate(() => window.__refLog.filter(e => e.ev === 'mount').length)
    for (let k = 0; k < 2; k++) {
      await B1.page.click('button[aria-label="Anotações de ensaio"]')
      await B1.page.waitForTimeout(150)
    }
    const again = await B1.page.waitForFunction(root => document.querySelector(root)?.querySelectorAll('svg > path').length === 4, CONCERT, { timeout: 5000 }).then(() => true, () => false)
    const mounts1 = await B1.page.evaluate(() => window.__refLog.filter(e => e.ev === 'mount').length)
    ok(again && mounts1 === mounts0, 'concerto: voltar a abrir as anotações usa a migração em cache (sem nova referência)', { antes: mounts0, depois: mounts1, traços: again })
    await settle(B1.page, CONCERT)
    checkAll('Concerto antigo, iPad retrato 46px (cache)', await snapshot(B1.page, CONCERT), { emDrawn: LEGACY_FONT })
  }
  console.log('— B1. Depois o Ensaio no mesmo iPad: migra para v2')
  await openEnsaio(B1.page)
  const migrated = await B1.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.v === 2, ANN_KEY, { timeout: 5000 }).then(() => true, () => false)
  const PB1 = await payloadOf(B1.page)
  ok(migrated && PB1?.anchored?.length === 4, 'Ensaio: payload antigo passa a v2 com 4 traços ancorados', PB1 && { v: PB1.v, anchored: PB1.anchored?.length })
  ok(PB1?.anchored?.map(e => e[3]).join() === '0,1,0,0', 'migrado: modos texto/margem/texto/texto', PB1?.anchored?.map(e => e[3]))
  await settle(B1.page, ENSAIO)
  checkAll(`Ensaio migrado, iPad retrato ${LEGACY_FONT}px`, await snapshot(B1.page, ENSAIO), { emDrawn: LEGACY_FONT, expectLongWrap: false })
  await shots(B1.page, `B2-ensaio-migrado-ipad-retrato-${LEGACY_FONT}px`, ENSAIO_SCROLL)
  // Push com debounce de 1.5s
  for (let t = 0; t < 40 && B1.writes < 1; t++) await B1.page.waitForTimeout(100)
  ok(B1.writes >= 1 && B1.cloud?.strokes?.v === 2, 'migração também segue para a cloud (v2)', { cloud: B1.writes, v: B1.cloud?.strokes?.v })
  await B1.ctx.close()

  console.log('— B2. Telemóvel: concerto DIRETAMENTE com o payload antigo vindo da cloud')
  const B2 = await newDevice(browser, {
    viewport: PHONE, phone: true, concertTheme: { font_size: 32, line_height: 1.6 },
    seed: { [FONT_KEY]: String(LEGACY_FONT), [ANN_KEY]: null },
    cloud: { song_id: SONG_ID, user_id: 'u1', strokes: LEGACY, updated_at: new Date().toISOString() },
  })
  if (await openConcert(B2.page)) {
    checkAll('Concerto antigo, telemóvel 32px', await snapshot(B2.page, CONCERT), { emDrawn: LEGACY_FONT, expectLongWrap: true })
    await refCheck(B2.page, 'concerto antigo telemóvel', LEGACY_FONT)
    ok(await payloadOf(B2.page) === null && B2.writes === 0, 'concerto (telemóvel) não grava nada')
    await shots(B2.page, 'B3-concerto-antigo-telemovel-32px', CONCERT_SCROLL)
  }
  const rowB2 = await phoneEnsaio(B2, 'B2', 'B3-ensaio-migrado-telemovel-28px')
  await B2.ctx.close()
  await ipadFromCloud(rowB2, 'B2c', 'B3c-concerto-ipad-com-v2-do-telemovel')

  // Clientes até ao #37 gravavam só {w, strokes}, sempre a 32px: sem h, a
  // referência fica nos 32px (não no tamanho guardado agora, 28) e com os
  // rótulos de secção do iPad onde se desenhou (deduzidos da largura), não
  // os do telemóvel que vê
  console.log('— B2b. Telemóvel (28px guardado): concerto DIRETAMENTE com um payload antigo sem h ({w, strokes}) desenhado a 32px')
  const B2b = await newDevice(browser, {
    viewport: PHONE, phone: true, concertTheme: { font_size: 32, line_height: 1.6 },
    seed: { [FONT_KEY]: String(LEGACY_FONT), [ANN_KEY]: JSON.stringify(LEGACY_NOH) },
  })
  if (await openConcert(B2b.page)) {
    checkAll('Concerto antigo sem h, telemóvel 32px', await snapshot(B2b.page, CONCERT), { emDrawn: NOH_FONT, expectLongWrap: true })
    await refCheck(B2b.page, 'concerto antigo sem h, telemóvel', NOH_FONT, LEGACY_NOH.w)
    await shots(B2b.page, 'B3b-concerto-antigo-sem-h-telemovel-32px', CONCERT_SCROLL)
  }
  const rowB2b = await phoneEnsaio(B2b, 'B2b', 'B3b-ensaio-migrado-sem-h-telemovel-28px', NOH_FONT)
  await B2b.ctx.close()
  await ipadFromCloud(rowB2b, 'B2d', 'B3d-concerto-ipad-com-v2-sem-h-do-telemovel', NOH_FONT)

  console.log('— B3. iPad paisagem com outro tamanho guardado (44): concerto DIRETAMENTE, depois o Ensaio')
  const B3 = await newDevice(browser, {
    viewport: TABLET_LAND, concertTheme: { font_size: 44, line_height: 1.6 },
    seed: { [FONT_KEY]: '44', [ANN_KEY]: legacyRaw },
  })
  if (await openConcert(B3.page)) {
    checkAll('Concerto antigo, iPad paisagem 64px', await snapshot(B3.page, CONCERT), { emDrawn: LEGACY_FONT })
    await refCheck(B3.page, 'concerto antigo iPad paisagem (guardado 44)', LEGACY_FONT)
    await shots(B3.page, 'B4-concerto-antigo-ipad-paisagem-64px', CONCERT_SCROLL)
  }
  await B3.page.evaluate(() => { window.__refLog = [] })
  await openEnsaio(B3.page)
  const migrated3 = await B3.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.v === 2, ANN_KEY, { timeout: 5000 }).then(() => true, () => false)
  const PB3 = await payloadOf(B3.page)
  ok(migrated3 && PB3?.anchored?.length === 4, 'Ensaio paisagem 44px: payload antigo passa a v2', PB3 && { v: PB3.v, anchored: PB3.anchored?.length })
  await refCheck(B3.page, 'Ensaio paisagem 44px (outro layout → referência)', LEGACY_FONT)
  await settle(B3.page, ENSAIO)
  checkAll('Ensaio migrado, iPad paisagem 44px', await snapshot(B3.page, ENSAIO), { emDrawn: LEGACY_FONT })
  await shots(B3.page, 'B5-ensaio-migrado-ipad-paisagem-44px', ENSAIO_SCROLL)
  await B3.ctx.close()

  // Sem h a largura bate certo com o bloco de agora, mas o tamanho não (40
  // guardado, desenhado a 32): adotar "como hoje" (rácios = 1) prendia os
  // sublinhados às linhas erradas — tem de ir pela referência a 32px
  console.log('— B4. iPad retrato com 40px guardado: Ensaio com o payload antigo sem h (desenhado a 32px)')
  const B4 = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FONT_KEY]: '40', [ANN_KEY]: JSON.stringify(LEGACY_NOH) } })
  await openEnsaio(B4.page)
  const migrated4 = await B4.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.v === 2, ANN_KEY, { timeout: 5000 }).then(() => true, () => false)
  ok(migrated4, 'B4 Ensaio 40px: payload antigo sem h passa a v2')
  await refCheck(B4.page, 'B4 Ensaio iPad 40px, payload sem h', NOH_FONT, LEGACY_NOH.w)
  await settle(B4.page, ENSAIO)
  checkAll('B4 Ensaio migrado, iPad retrato 40px (sem h)', await snapshot(B4.page, ENSAIO), { emDrawn: NOH_FONT })
  await shots(B4.page, 'B6-ensaio-migrado-sem-h-ipad-40px', ENSAIO_SCROLL)
  await B4.ctx.close()

  // ══ Cenário D: sincronização com a cloud ════════════════════════════════
  const cloudV2 = () => ({ song_id: SONG_ID, user_id: 'u1', strokes: P, updated_at: new Date().toISOString() })
  const idsP = (P?.anchored ?? []).map(e => e[0]).sort()
  const ids = p => (p?.anchored ?? []).map(e => e[0]).sort()
  /** Sublinhado (px do viewport) da linha `ln`, como o shapes() */
  const underOf = (S, ln) => {
    const r = S.rows[ln][0]
    return Array.from({ length: 31 }, (_, i) => [r.l - 3 + (r.r - r.l + 6) * i / 30, r.b + 0.16 * S.em + 0.6 * Math.sin(i * 1.7)])
  }
  const pathCount = (page, root) => page.evaluate(root => document.querySelector(root)?.querySelectorAll('svg > path').length ?? 0, root)

  console.log('— D1. Telemóvel com uma cópia ANTIGA local (cliente antigo) e a v2 na cloud (o iPad já migrou)')
  const D1 = await newDevice(browser, {
    viewport: PHONE, phone: true, concertTheme: { font_size: 32, line_height: 1.6 },
    seed: { [FONT_KEY]: String(LEGACY_FONT), [ANN_KEY]: legacyRaw }, cloud: cloudV2(),
  })
  if (await openConcert(D1.page)) {
    // As larguras dizem de onde vêm os traços: a v2 foi desenhada a 32px, a cópia antiga a 28
    checkAll('D1 concerto telemóvel (a v2 da cloud ganha à cópia antiga local)', await snapshot(D1.page, CONCERT), { emDrawn: 32, expectLongWrap: true })
    ok(await D1.page.evaluate(() => !window.__refLog.some(e => e.ev === 'mount')), 'D1 concerto: não migra a cópia antiga (a cloud tem âncoras)', await D1.page.evaluate(() => window.__refLog))
  }
  await openEnsaio(D1.page)
  ok(await D1.page.evaluate(() => !window.__refLog.some(e => e.ev === 'mount')), 'D1 Ensaio: espera pela cloud antes de migrar a cópia antiga (não chega a montar a referência)', await D1.page.evaluate(() => window.__refLog))
  const switched = await D1.page.waitForFunction(([k, want]) => {
    const p = JSON.parse(localStorage.getItem(k) ?? 'null')
    return p?.v === 2 && JSON.stringify((p.anchored ?? []).map(e => e[0]).sort()) === JSON.stringify(want)
  }, [ANN_KEY, idsP], { timeout: 5000 }).then(() => true, () => false)
  ok(switched, 'D1 Ensaio: a cópia local passa a ser a v2 da cloud (não a migração da antiga)', ids(await payloadOf(D1.page)))
  await D1.page.waitForTimeout(2000)
  ok(D1.writes === 0 && JSON.stringify(D1.cloud.strokes.anchored) === JSON.stringify(P.anchored),
    'D1 Ensaio: não grava a cópia antiga por cima da v2 da cloud', { escritas: D1.writes, cloud: ids(D1.cloud.strokes) })
  await settle(D1.page, ENSAIO)
  checkAll(`D1 Ensaio telemóvel ${LEGACY_FONT}px (v2 da cloud)`, await snapshot(D1.page, ENSAIO), { emDrawn: 32 })
  await D1.ctx.close()

  console.log('— D2. iPad sem cópia local, a v2 na cloud e a leitura dela atrasada 7s: desenha-se antes de a cloud responder')
  const D2 = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FONT_KEY]: null, [ANN_KEY]: null }, cloud: cloudV2() })
  D2.pullDelay = 7000
  // (a leitura só começa depois de t2: até t2 + 7s a cloud não respondeu)
  const t2 = Date.now()
  await openEnsaio(D2.page, { wait: false })
  ok(await pathCount(D2.page, ENSAIO) === 0, 'D2: folha vazia enquanto a cloud não responde')
  await penStroke(D2.page, underOf(await snapshot(D2.page, ENSAIO), 4))
  const drawn2 = await D2.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored?.length === 1, ANN_KEY, { timeout: 3000 }).then(() => true, () => false)
  await D2.page.waitForTimeout(1700)   // > debounce do envio (1.5s)
  ok(drawn2 && Date.now() - t2 < 6900 && D2.writes === 0, 'D2: antes de a cloud responder o traço fica só neste aparelho (nada é enviado)', { ms: Date.now() - t2, escritas: D2.writes })
  for (let t = 0; t < 100 && !(D2.cloud?.strokes?.anchored?.length === 5); t++) await D2.page.waitForTimeout(100)
  const cloud2 = D2.cloud?.strokes
  const merged2 = cloud2?.anchored?.length === 5
  ok(merged2 && idsP.every(id => ids(cloud2).includes(id)), 'D2: quando a cloud responde, junta-se a v2 dela ao traço novo e envia-se tudo (5 traços)', { cloud: ids(cloud2), escritas: D2.writes })
  ok(ids(await payloadOf(D2.page)).length === 5 && await pathCount(D2.page, ENSAIO) === 5, 'D2: o Ensaio mostra e guarda os 5 traços', { local: ids(await payloadOf(D2.page)).length, caminhos: await pathCount(D2.page, ENSAIO) })
  await D2.ctx.close()

  console.log('— D3. Leitura da cloud a falhar: o traço fica "por juntar" e junta-se quando a cloud volta')
  const D3 = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FONT_KEY]: null, [ANN_KEY]: null }, cloud: cloudV2() })
  D3.pullFail = 1000
  await openEnsaio(D3.page, { wait: false })
  await penStroke(D3.page, underOf(await snapshot(D3.page, ENSAIO), 4))
  const drawn3 = await D3.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored?.length === 1, ANN_KEY, { timeout: 3000 }).then(() => true, () => false)
  await D3.page.waitForTimeout(3500)
  const P3 = await payloadOf(D3.page)
  ok(drawn3 && P3?.pend === 1 && D3.writes === 0 && D3.reads >= 2, 'D3: sem conseguir ler a cloud nada é enviado; o local fica marcado "por juntar" e volta a tentar ler', { pend: P3?.pend, escritas: D3.writes, leituras: D3.reads })
  D3.pullFail = 0
  await openEnsaio(D3.page)
  for (let t = 0; t < 60 && !(D3.cloud?.strokes?.anchored?.length === 5); t++) await D3.page.waitForTimeout(100)
  const P3b = await payloadOf(D3.page)
  ok(D3.cloud?.strokes?.anchored?.length === 5 && idsP.every(id => ids(D3.cloud.strokes).includes(id)) && ids(P3).every(id => ids(D3.cloud.strokes).includes(id)),
    'D3: a cloud volta → junta-se (v2 dela + o traço daqui) e envia-se', { cloud: ids(D3.cloud?.strokes), escritas: D3.writes })
  ok(P3b?.anchored?.length === 5 && P3b.pend === undefined && await pathCount(D3.page, ENSAIO) === 5, 'D3: o local fica com os 5 traços e deixa de estar "por juntar"', { local: P3b?.anchored?.length, pend: P3b?.pend })
  await D3.ctx.close()

  // ══ Cenário E: música sem letra (instrumental) ═══════════════════════════
  const FREE_KEY = `gigio_ann_v1_${FREE_ID}`
  /** Caixa (viewport) do bloco da letra, da SVG e dos caminhos, sem [data-ln] */
  const freeSnap = (page, root) => page.evaluate(root => {
    const host = document.querySelector(root)
    const svg = host?.querySelector('svg')
    const block = host?.querySelector('[class*="hint"]')?.parentElement
    const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width } }
    return svg && block ? { block: box(block), svg: box(svg), paths: [...svg.querySelectorAll(':scope > path')].map(p => ({ ...box(p), width: parseFloat(p.getAttribute('stroke-width')) })) } : null
  }, root)
  console.log('— E1. Instrumental: desenhar no Ensaio (iPad) e ver no concerto')
  const E1 = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FREE_KEY]: null }, concertTheme: { font_size: 32, line_height: 1.6 } })
  await openEnsaio(E1.page, { song: FREE_ID, withText: false })
  const fe = await freeSnap(E1.page, ENSAIO)
  // Diagonal (o caminho suavizado passa pelos pontos: a caixa é a dos extremos)
  const zig = Array.from({ length: 25 }, (_, i) => [fe.block.l + 120 + i * 8, fe.block.t + 160 + i * 1.25])
  await penStroke(E1.page, zig)
  const savedE = await E1.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored?.length === 1, FREE_KEY, { timeout: 3000 }).then(() => true, () => false)
  const PE = await payloadOf(E1.page, FREE_KEY)
  const fe2 = await freeSnap(E1.page, ENSAIO)
  ok(savedE && PE.anchored[0][3] === 4, 'E1: o traço numa folha sem letra é gravado (modo livre)', PE?.anchored?.map(e => e[3]))
  const zb = bbox(zig)
  const pe = fe2?.paths[0]
  ok(fe2?.paths.length === 1 && Math.abs(pe.l - zb.l) < 1.5 && Math.abs(pe.t - zb.t) < 1.5 && Math.abs(pe.r - zb.r) < 1.5 && Math.abs(pe.b - zb.b) < 1.5,
    'E1: depois de levantar a caneta o traço fica onde foi desenhado', { caminhos: fe2?.paths.length, traço: pe, desenhado: zb })
  if (await openConcert(E1.page, 1, { setlist: 'sV', withText: false })) {
    const fc = await freeSnap(E1.page, CONCERT)
    const k = fc.block.w / fe.block.w
    const want = { l: fc.block.l + (zb.l - fe.block.l) * k, t: fc.block.t + (zb.t - fe.block.t) * k, r: fc.block.l + (zb.r - fe.block.l) * k, b: fc.block.t + (zb.b - fe.block.t) * k }
    const pc = fc.paths[0]
    // (traço fino por omissão: 2px)
    ok(fc.paths.length === 1 && ['l', 't', 'r', 'b'].every(s => Math.abs(pc[s] - want[s]) < 2) && Math.abs(pc.width - Math.max(1.5, 2 * k)) < 0.1,
      'E1 concerto: o traço livre aparece escalado pela largura da folha', { traço: pc, esperado: want, k: r3(k) })
  }
  await E1.ctx.close()

  console.log('— E2. Instrumental com um payload ANTIGO (px): vê-se no concerto e no Ensaio (e migra)')
  const oldFree = { w: fe.block.w, h: 40, strokes: [{ id: 'livre-1', pts: zig.flatMap(([x, y]) => [x - fe.svg.l, y - fe.svg.t]), color: '#2563EB', width: 4 }] }
  const E2 = await newDevice(browser, { viewport: PHONE, phone: true, seed: { [FREE_KEY]: JSON.stringify(oldFree) }, concertTheme: { font_size: 32, line_height: 1.6 } })
  if (await openConcert(E2.page, 1, { setlist: 'sV', withText: false })) {
    const fc = await freeSnap(E2.page, CONCERT)
    const k = fc.block.w / oldFree.w
    ok(fc.paths.length === 1 && Math.abs(fc.paths[0].l - (fc.block.l + (zb.l - fe.svg.l) * k)) < 2 && Math.abs(fc.paths[0].t - (fc.block.t + (zb.t - fe.svg.t) * k)) < 2,
      'E2 concerto: o traço antigo de uma música sem letra aparece (escalado pela largura)', { caminhos: fc.paths.length, traço: fc.paths[0] })
  }
  await openEnsaio(E2.page, { song: FREE_ID, withText: false })
  const migratedE = await E2.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.v === 2, FREE_KEY, { timeout: 5000 }).then(() => true, () => false)
  const fe3 = await freeSnap(E2.page, ENSAIO)
  ok(migratedE && (await payloadOf(E2.page, FREE_KEY)).anchored[0][3] === 4 && fe3.paths.length === 1, 'E2 Ensaio: o traço antigo vê-se e passa a v2 (livre)', { caminhos: fe3?.paths.length })
  await E2.ctx.close()

  // ══ Cenário F: nota escrita abaixo da última linha ("FIM") ═══════════════
  console.log('— F. Nota "FIM" abaixo da última linha: inteira no concerto e no Ensaio depois de A+')
  const FIM_KEY = `gigio_ann_v1_${FIM_ID}`
  const F = await newDevice(browser, { viewport: TABLET_PORT, seed: { [FONT_KEY]: null, [FIM_KEY]: null }, concertTheme: { font_size: 32, line_height: 1.6 } })
  await openEnsaio(F.page, { song: FIM_ID })
  const SF = await snapshot(F.page, ENSAIO)
  const lastF = SF.rows[14][0]
  const fimTop = lastF.b + 0.8 * SF.em
  const fimH = 0.7 * SF.em
  const fim = Array.from({ length: 31 }, (_, i) => [(lastF.l + lastF.r) / 2 - SF.em + i * (2 * SF.em / 30), fimTop + (i % 2 ? 0 : fimH)])
  await penStroke(F.page, fim)
  const savedF = await F.page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored?.length === 1, FIM_KEY, { timeout: 3000 }).then(() => true, () => false)
  ok(savedF, 'F: nota gravada')
  /** A nota (o único caminho) em relação à última linha, à SVG e ao que o scroll alcança */
  const fimCheck = async (label, root, scrollSel, frameSel) => {
    const g = await F.page.evaluate(([root, scrollSel, frameSel]) => {
      const host = document.querySelector(root)
      const p = host.querySelector('svg > path')
      if (!p) return null
      const n = [...host.querySelector('[data-ln="14"]').childNodes].find(x => x.nodeType === 3)
      const rg = document.createRange()
      rg.selectNodeContents(n)
      const rs = [...rg.getClientRects()].filter(b => b.width > 0)
      const pb = p.getBoundingClientRect()
      const sv = host.querySelector('svg').getBoundingClientRect()
      const sc = document.querySelector(scrollSel)
      const scb = sc.getBoundingClientRect()
      const fr = frameSel ? document.querySelector(frameSel).getBoundingClientRect() : null
      return {
        em: parseFloat(getComputedStyle(n.parentElement).fontSize), w: parseFloat(p.getAttribute('stroke-width')),
        p: { t: pb.top, b: pb.bottom, l: pb.left, r: pb.right }, last: rs[rs.length - 1].bottom, svgBottom: sv.bottom,
        reach: scb.top - sc.scrollTop + sc.scrollHeight, frame: fr && { t: fr.top, b: fr.bottom, l: fr.left, r: fr.right },
      }
    }, [root, scrollSel, frameSel])
    if (!ok(!!g, `${label}: nota desenhada`)) return
    const h = g.p.b - g.p.t
    ok(g.p.t > g.last + 0.5 * g.em && Math.abs(h - fimH * g.em / SF.em) <= 0.25 * fimH * g.em / SF.em,
      `${label}: nota abaixo da última linha, com a altura de quando foi escrita`, { topo_em: r3((g.p.t - g.last) / g.em), altura: r1(h), esperada: r1(fimH * g.em / SF.em) })
    // No Ensaio a SVG estende-se até à nota (a borracha tem de lhe chegar);
    // no concerto (só leitura) desenha fora da sua caixa, dentro da moldura
    if (!frameSel) ok(g.p.b + g.w / 2 <= g.svgBottom + 0.5, `${label}: a SVG estende-se até à nota`, { nota: r1(g.p.b + g.w / 2), svg: r1(g.svgBottom) })
    ok(g.p.b + g.w / 2 <= g.reach + 0.5, `${label}: o scroll chega à nota`, { nota: r1(g.p.b + g.w / 2), scroll: r1(g.reach) })
    if (g.frame) ok(g.p.t - g.w / 2 >= g.frame.t - 0.5 && g.p.b + g.w / 2 <= g.frame.b + 0.5 && g.p.l >= g.frame.l - 0.5 && g.p.r <= g.frame.r + 0.5,
      `${label}: a nota não é cortada pela moldura`, { nota: g.p, moldura: g.frame })
  }
  await fimCheck('F Ensaio 32px', ENSAIO, ENSAIO_SCROLL, null)
  if (await openConcert(F.page, 1, { setlist: 'sF' })) {
    await fimCheck('F concerto iPad retrato 46px', CONCERT, `[class*="lyricsScroll"]`, `${CONCERT} > div`)
    await shots(F.page, 'F1-concerto-nota-fim', CONCERT_SCROLL)
  }
  await openEnsaio(F.page, { song: FIM_ID })
  for (let k = 0; k < 6; k++) await F.page.click('button[aria-label="Aumentar letra"]')
  await F.page.waitForFunction(root => parseFloat(getComputedStyle(document.querySelector(root).querySelector('[data-ln="1"]')).fontSize) === 56, ENSAIO)
  await settle(F.page, ENSAIO)
  await fimCheck('F Ensaio 56px (letra mais alta do que o painel)', ENSAIO, ENSAIO_SCROLL, null)
  await shots(F.page, 'F2-ensaio-nota-fim-56px', ENSAIO_SCROLL)
  await F.ctx.close()
} catch (e) {
  ok(false, 'exceção no teste', String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '))
} finally {
  await browser.close()
  server.close()
}

console.log(`\ncapturas em ${OUT}`)
if (failures.length) {
  console.log('\nFalhas:')
  for (const f of failures) console.log(' -', f)
}
console.log(`\n${passed} passaram, ${failures.length} falharam`)
process.exit(failures.length ? 1 : 0)
