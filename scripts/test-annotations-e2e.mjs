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
 * Cenário H: MARCADOR — escolhido pela fita como um utilizador; destaques de
 * texto (palavras inteiras, toque numa palavra, várias linhas), fusão e
 * recorte sem dupla opacidade, traço livre de marcador na margem, borracha,
 * Desfazer e Limpar; medidos contra as caixas do texto (Range) no Ensaio
 * (tema claro e escuro) e no concerto (vários layouts, palco escuro e claro,
 * linha ativa). "Por baixo do texto" mede-se nos PÍXEIS: os da letra ficam
 * intactos (com a camada forçada por cima, ficavam tingidos). Também: a
 * versão publicada antes do marcador (2b52db3, PWA em cache) a ler e a
 * regravar um payload com destaques — no módulo e num build dela no
 * browser — e a letra editada depois de destacar.
 *
 * Uso:
 *   node scripts/test-annotations-e2e.mjs [pasta-das-capturas]
 *   (faz o build de mock antes, como scripts/shots.sh; E2E_NO_BUILD=1 usa o dist que existe;
 *    também faz o build de 2b52db3 numa pasta temporária — E2E_NO_OLD=1 salta-o)
 * Saída: "N passaram, 0 falharam"; exit ≠ 0 se alguma asserção falhar.
 */
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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
const ANN_KEY = `gigio_ann_u_u1_${SONG_ID}`
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

// ── Marcador (cenário H) ────────────────────────────────────────────────────
// Letra INVENTADA. No Ensaio do iPad retrato a 32px cada linha cabe numa row;
// a linha longa (11) quebra no telemóvel.
const HL_LINES = [
  '[Verso 1]',                                   // 0
  'A carrinha avariou na curva da serra',        // 1  H1 amarelo "avariou na curva" → H6 azul "na curva da serra" recorta-o
  'Ficámos a afinar à luz do telemóvel',         // 2  H2 toque em "afinar"
  'O vocalista esqueceu-se do microfone',        // 3  caneta: sublinhado âmbar
  '',                                            // 4
  '[Refrão]',                                    // 5
  'Toca mais alto que a chuva lá fora',          // 6  ┐ H3 rosa, 3 linhas: "chuva lá fora"
  'Ninguém arruma os cabos',                     // 7  │ inteira              H7: traço livre de marcador
  'Até a noite acabar de vez',                   // 8  ┘ "Até a noite" → H6 funde: "Até a noite acabar"   (laranja) na margem
  '',                                            // 9
  '[Verso 2]',                                   // 10
  'Bateram à porta por causa do volume',         // 11 verde, inteira (com o dedo)
  'Desligámos tudo às três da manhã',            // 12 H6 amarelo inteira; verde "às três" parte-o em dois
]
const HL_LYRICS = HL_LINES.join('\n')
const HL_ID = 'sgH'
addSong(HL_ID, 'sH', HL_LYRICS)
// Letra editada depois de destacar (H9): o servidor só "recebe" a edição quando o teste a põe aqui
const HL9_ID = 'sgH9'
const songH9 = addSong(HL9_ID, 'sH9', HL_LYRICS)
// Com sync: a linha ativa do concerto (fundo tintado) por cima de destaques
const HLS_ID = 'sgHs'
const songHs = addSong(HLS_ID, 'sHs', HL_LYRICS)
songHs.has_sync = true
TABLES.lyric_syncs.push({
  song_id: HLS_ID,
  // A 1.ª linha de letra entra ao 1s; as outras muito depois (fica ativa a 1.ª)
  lines: HL_LINES.filter(l => l.trim() && !/^\[.+\]$/.test(l.trim())).map((text, i) => ({ text, time_ms: i === 0 ? 1000 : 200000 + i * 1000 })),
})

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
async function newDevice(browser, { viewport, phone = false, seed = {}, cloud = null, concertTheme = null, appTheme = 'dark' }) {
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
  await ctx.addInitScript(({ auth, seed, appTheme }) => {
    localStorage.setItem('sb-mockproj-auth-token', auth)
    localStorage.setItem('gigio-theme', appTheme)
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
  }, { auth: JSON.stringify(SESSION), seed, appTheme })
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
      // Marcador (por trás do texto): retângulos e traços livres
      const mk = host.querySelector('svg[data-ann="marcador"]')?.innerHTML ?? ''
      res(`${ds}#${ln}#${mk}`)
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
async function openEnsaio(page, { song = SONG_ID, wait = true, withText = true, base = BASE } = {}) {
  await page.goto(`${base}/songs/${song}`, { waitUntil: wait ? 'networkidle' : 'domcontentloaded' })
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

// ── Marcador (cenário H): payload, medição e asserções ─────────────────────
const HL_KEY = `gigio_ann_u_u1_${HL_ID}`
// Cores do marcador (SongPage: HL_COLORS) — gravadas opacas em cada destaque
const HC = { amarelo: '#FFE01A', verde: '#5CE65C', rosa: '#FF5FAF', azul: '#3DB8FF', laranja: '#FF9A1F' }
// Largura do traço livre de marcador (em)
const HL_INK_EM = 0.9
const MARKER = 'svg[data-ann="marcador"]'

/** Destaques de texto de um payload ([id, cor, 0, 5, ln, c0, c1, texto, linhas?]); os órfãos ficam de fora */
const hlRecs = P => (P?.anchored ?? []).filter(e => Array.isArray(e) && e[3] === 5 && !e[8])
  .map(e => ({ id: String(e[0]), color: String(e[1]), ln: e[4], c0: e[5], c1: e[6], t: e[7] }))
const recAt = (P, ln, t) => hlRecs(P).find(r => r.ln === ln && r.t === t)
const recsOn = (P, ln) => hlRecs(P).filter(r => r.ln === ln)
/** Traços livres de marcador ([id, cor, w×1000, 6, runs, cs, xs, ys, modo de ancoragem, linhas?]) */
const hlInks = P => (P?.anchored ?? []).filter(e => Array.isArray(e) && e[3] === 6)
/** Traços da caneta (modos 0–4) */
const penEntries = P => (P?.anchored ?? []).filter(e => Array.isArray(e) && e[3] < 5)
/** Anotações (sem o retrato das linhas do marcador, modo 7 — uma entrada por payload, não é um item) */
const itemsOf = P => (P?.anchored ?? []).filter(e => !(Array.isArray(e) && e[3] === 7))
const jsonSet = list => JSON.stringify(list.map(e => JSON.stringify(e)).sort())

const waitN = (page, key, n, timeout = 5000) => page.waitForFunction(([k, n]) =>
  (JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored ?? []).filter(e => !(Array.isArray(e) && e[3] === 7)).length === n,
[key, n], { timeout }).then(() => true, () => false)
const waitRec = (page, key, ln, t) => page.waitForFunction(([k, ln, t]) => (JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored ?? [])
  .some(e => e[3] === 5 && e[4] === ln && e[7] === t), [key, ln, t], { timeout: 5000 }).then(() => true, () => false)
const waitMarker = (page, root, n) => page.waitForFunction(([root, sel, n]) => (document.querySelector(root)?.querySelectorAll(`${sel} g[data-hl]`).length ?? -1) === n,
  [root, MARKER, n], { timeout: 8000 }).then(() => true, () => false)

/**
 * Retrato do marcador, em px do viewport: por destaque esperado (do payload)
 * o texto que está nesse intervalo da linha e a extensão dos seus
 * caracteres NÃO BRANCOS por row (Range de cada carácter — implementação
 * própria); as rows das linhas `lns`; e o que a camada do marcador desenha
 * (grupos g[data-hl] com os retângulos, traços livres path[data-hl]).
 */
function hlSnapIn([root, recs, lns, sel]) {
  const host = document.querySelector(root)
  if (!host) return null
  const lineEl = ln => host.querySelector(`[data-ln="${ln}"]`)
  const textNode = el => el && [...el.childNodes].find(n => n.nodeType === 3 && n.data.length > 0)
  const range = document.createRange()
  const box = b => ({ l: b.left, t: b.top, r: b.right, b: b.bottom })
  const rowsOf = (n, a, b) => {
    const out = []
    for (let c = a; c < b; c++) {
      if (/\s/.test(n.data[c])) continue
      range.setStart(n, c)
      range.setEnd(n, c + 1)
      const q = [...range.getClientRects()].find(x => x.width > 0 && x.height > 0)
      if (!q) continue
      const cy = (q.top + q.bottom) / 2
      const row = out.find(o => cy > o.t && cy < o.b)
      if (row) {
        row.l = Math.min(row.l, q.left); row.r = Math.max(row.r, q.right)
        row.t = Math.min(row.t, q.top); row.b = Math.max(row.b, q.bottom)
      } else out.push(box(q))
    }
    return out.sort((p, q) => p.t - q.t)
  }
  const expect = {}
  for (const h of recs) {
    const n = textNode(lineEl(h.ln))
    if (!n) { expect[h.id] = { found: false, rows: [] }; continue }
    const lead = n.data.length - n.data.replace(/^\s+/, '').length
    expect[h.id] = { found: true, text: n.data.slice(lead + h.c0, lead + h.c1), rows: rowsOf(n, lead + h.c0, lead + h.c1) }
  }
  const lines = {}
  for (const ln of lns) {
    const n = textNode(lineEl(ln))
    if (n) lines[ln] = rowsOf(n, 0, n.data.length)
  }
  const svg = host.querySelector(sel)
  // Opacidade do grupo da cor (um <g opacity> por cor; os rótulos de secção têm o seu, data-rotulo)
  const alphaOf = el => parseFloat(el.closest('g[opacity]')?.getAttribute('opacity') ?? 'NaN')
  const groups = svg ? [...svg.querySelectorAll('g[data-hl]')].map(g => ({
    id: g.getAttribute('data-hl'), fill: (g.getAttribute('fill') ?? '').toLowerCase(),
    opacity: alphaOf(g), label: !!g.closest('g[data-rotulo]'),
    rects: [...g.querySelectorAll('rect')].map(r => ({ ...box(r.getBoundingClientRect()), rx: parseFloat(r.getAttribute('rx')) })).sort((p, q) => p.t - q.t),
  })) : []
  const inks = svg ? [...svg.querySelectorAll('path[data-hl]')].map(p => ({
    id: p.getAttribute('data-hl'), stroke: (p.getAttribute('stroke') ?? '').toLowerCase(), width: parseFloat(p.getAttribute('stroke-width')), d: p.getAttribute('d') ?? '',
    opacity: alphaOf(p),
  })) : []
  // Grupos de cor: um por cor (e rótulo)
  const colorGroups = svg ? [...svg.querySelectorAll(':scope > g')].map(g => ({
    opacity: parseFloat(g.getAttribute('opacity')), label: g.hasAttribute('data-rotulo'),
    fills: [...new Set([...g.querySelectorAll('[data-hl]')].map(x => (x.getAttribute('fill') !== 'none' && x.getAttribute('fill')) || x.getAttribute('stroke')).map(c => (c ?? '').toLowerCase()))],
  })) : []
  // Fundo opaco por trás da letra (o 1.º antepassado com fundo) e a cor dos rótulos de secção
  let bgEl = host
  while (bgEl && !/^rgb\(|^rgba\((?:[^,]+,){3}\s*(?:1|0?\.[5-9]\d*)\)$/.test(getComputedStyle(bgEl).backgroundColor)) bgEl = bgEl.parentElement
  const sec = host.querySelector('[data-sec]')
  const m = svg && svg.getScreenCTM()
  const cs = svg && getComputedStyle(svg)
  // O que corta o desenho na horizontal: o 1.º antepassado com overflow ≠ visible, dentro do ecrã
  let clipEl = svg ? svg.parentElement : null
  while (clipEl && getComputedStyle(clipEl).overflowX === 'visible') clipEl = clipEl.parentElement
  const cb = clipEl ? clipEl.getBoundingClientRect() : { left: 0, right: innerWidth }
  const clip = { l: Math.max(0, cb.left), r: Math.min(innerWidth, cb.right) }
  const txt = host.querySelector('[data-ln]:not([data-sec])')
  const tcs = getComputedStyle(txt)
  const blockEl = txt.parentElement
  return {
    em: parseFloat(tcs.fontSize), lh: parseFloat(tcs.lineHeight) / parseFloat(tcs.fontSize), ink: tcs.color,
    bg: bgEl ? getComputedStyle(bgEl).backgroundColor : null,
    labelInk: sec ? getComputedStyle(sec).color : null, labelPx: sec ? parseFloat(getComputedStyle(sec).fontSize) : 0,
    colorGroups,
    block: box(blockEl.getBoundingClientRect()),
    layer: svg ? {
      z: cs.zIndex, pe: cs.pointerEvents, pos: cs.position,
      iso: getComputedStyle(svg.parentElement).isolation,
      // Mesmo contexto de empilhamento que a letra (z-index -1 fica por trás dela, à frente do fundo)
      withText: svg.parentElement.contains(txt),
    } : null,
    ctm: m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null,
    clip,
    // Caminhos da camada da CANETA (o marcador nunca pode lá estar)
    pen: host.querySelectorAll(`svg:not(${sel.replace('svg', '')}) path`).length,
    groups, inks, expect, lines,
  }
}
const hlSnap = (page, root, recs, lns = []) => page.evaluate(hlSnapIn, [root, recs, lns, MARKER])

// Contraste (WCAG), implementação própria — à parte da de anchor.ts
const lumRgb = rgb => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
const contrastRgb = (a, b) => (Math.max(lumRgb(a), lumRgb(b)) + 0.05) / (Math.min(lumRgb(a), lumRgb(b)) + 0.05)
/** Opacidade esperada de uma cor do marcador neste layout (as cores medidas: fundo, letra, rótulos) */
const alphaFor = (H, color, label = false) =>
  NEWA.markerAlpha(color, H.bg, label ? H.labelInk : H.ink, label ? H.labelPx : H.em)

/**
 * Destaques de texto num layout: cada um no texto guardado, na cor guardada,
 * um retângulo por row do texto, x = palavras inteiras (±0.15em), a cobrir
 * ≥80% da altura da caixa do texto da row sem invadir a vizinha; a camada
 * por trás do texto; translúcidos, cada cor no seu grupo com a opacidade que
 * o fundo e a letra pedem — e a letra por cima com contraste ≥ 4.5:1 (no
 * texto grande, com o marcador mínimo, ≥ 3:1); nenhum retângulo por cima de
 * outro. `bg`: 'claro' | 'escuro' — o teto da opacidade que o fundo medido dá.
 */
function checkHighlights(label, H, recs, { bg = null } = {}) {
  if (!ok(!!H?.layer, `${label}: camada do marcador presente`)) return
  const em = H.em
  const tol = 0.15 * em
  ok(H.layer.z === '-1' && H.layer.pos === 'absolute' && H.layer.pe === 'none' && H.layer.iso === 'isolate' && H.layer.withText,
    `${label}: camada do marcador por trás do texto (z-index -1 no mesmo contexto isolado da letra) e sem apanhar toques`, H.layer)
  if (bg) {
    const cap = NEWA.markerOpacity(NEWA.luminanceOf(H.bg))
    ok(cap === (bg === 'claro' ? NEWA.HL_OPACITY_LIGHT : NEWA.HL_OPACITY_DARK), `${label}: fundo ${bg} medido (${H.bg}) → teto ${cap}`, { fundo: H.bg, teto: cap })
  }
  // Um grupo por cor (e por rótulo): nunca duas vezes a mesma cor
  const keys = H.colorGroups.flatMap(g => g.fills.map(f => `${f}|${g.label}`))
  ok(new Set(keys).size === keys.length && H.colorGroups.every(g => g.fills.length === 1), `${label}: um grupo por cor`, H.colorGroups)
  ok(H.groups.length === recs.length, `${label}: ${recs.length} destaque(s) desenhado(s)`, { desenhados: H.groups.map(g => g.id), esperados: recs.map(r => `${r.id}:${r.t}`) })
  const all = []
  for (const h of recs) {
    const e = H.expect[h.id]
    ok(!!e?.found && e.text === h.t, `${label}: "${h.t}" está no intervalo guardado da linha ${h.ln}`, e && { texto: e.text })
    const g = H.groups.find(x => x.id === h.id)
    if (!ok(!!g, `${label}: destaque "${h.t}" desenhado`)) continue
    ok(g.fill === h.color.toLowerCase(), `${label}: "${h.t}" na cor guardada`, { fill: g.fill, cor: h.color })
    const want = alphaFor(H, h.color, g.label)
    ok(g.opacity > 0.1 && g.opacity < 0.7 && Math.abs(g.opacity - want) < 0.005, `${label}: "${h.t}" translúcido, a ${r3(want)} (fundo ${H.bg}, ${g.label ? `rótulo ${H.labelInk}` : `letra ${H.ink}`})`,
      { opacidade: g.opacity, esperada: want })
    const ink = cssRgb(g.label ? H.labelInk : H.ink)
    const k = contrastRgb(mix(cssRgb(H.bg), hexRgb(h.color), g.opacity), ink)
    const large = !g.label && em >= 24 && g.opacity <= NEWA.HL_MIN_ALPHA_LARGE + 0.005
    ok(k >= (large ? 3 : 4.5), `${label}: "${h.t}" — o texto por cima tem contraste ${r1(k)}:1 (≥ ${large ? 3 : 4.5}:1)`, { contraste: k })
    const rows = e?.rows ?? []
    ok(rows.length >= 1 && g.rects.length === rows.length, `${label}: "${h.t}" — um retângulo por row do texto (${rows.length})`, { retângulos: g.rects.length, rows: rows.length })
    g.rects.forEach((r, k) => {
      const w = rows[k]
      if (!w) return
      const cover = (Math.min(r.b, w.b) - Math.max(r.t, w.t)) / (w.b - w.t)
      ok(Math.abs(r.l - w.l) <= tol && Math.abs(r.r - w.r) <= tol, `${label}: "${h.t}" row ${k + 1}: x do retângulo = palavras inteiras (±0.15em)`,
        { dl_em: r3((r.l - w.l) / em), dr_em: r3((r.r - w.r) / em), retângulo: [r1(r.l), r1(r.r)], texto: [r1(w.l), r1(w.r)] })
      ok(cover >= 0.8, `${label}: "${h.t}" row ${k + 1}: cobre ≥80% da altura da caixa do texto`, { cobre: r3(cover), retângulo: [r1(r.t), r1(r.b)], texto: [r1(w.t), r1(w.b)] })
      ok(r.t >= w.t - 0.25 * em && r.b <= w.b + 0.25 * em, `${label}: "${h.t}" row ${k + 1}: não invade as rows vizinhas`, { retângulo: [r1(r.t), r1(r.b)], texto: [r1(w.t), r1(w.b)] })
      all.push({ ...r, id: h.id, k })
    })
  }
  // Nunca dupla opacidade: nenhum retângulo por cima de outro (de outro destaque, ou de outra row do mesmo)
  const over = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l)
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
      if (w > 0.5 && h > 0.5) over.push([`${a.id}#${a.k + 1}`, `${b.id}#${b.k + 1}`, r1(w), r1(h)])
    }
  }
  ok(over.length === 0, `${label}: nenhum retângulo por cima de outro (sem dupla opacidade)`, over)
}

/**
 * Traço livre de marcador na margem das linhas `lns`: um caminho na camada do
 * marcador (não na da caneta), largo (0.9em deste layout), à esquerda do
 * texto e da altura das linhas (±0.4em), quase vertical
 */
function checkMarkerInk(label, H, color, lns) {
  const ps = H?.inks.filter(p => p.stroke === color.toLowerCase()) ?? []
  if (!ok(ps.length === 1, `${label}: um traço livre de marcador ${color} na camada do marcador`, { traços: H?.inks.map(p => p.stroke) })) return
  const p = ps[0]
  const em = H.em
  ok(Math.abs(p.width - HL_INK_EM * em) <= 0.1, `${label}: traço de marcador largo (0.9em = ${r1(HL_INK_EM * em)}px)`, { largura: p.width })
  const pts = parsePath(p.d, H.ctm).flat()
  const bb = bbox(pts)
  const rows = lns.flatMap(ln => H.lines[ln] ?? []).sort((a, b) => a.t - b.t)
  if (!ok(rows.length >= lns.length, `${label}: linhas ${lns.join(', ')} medidas`)) return
  const textLeft = Math.min(...rows.map(r => r.l))
  const top = rows[0].t
  const bottom = rows[rows.length - 1].b
  ok(bb.r < textLeft, `${label}: traço de marcador à esquerda do texto das linhas ${lns.join('–')}`, { traçoDireita: r1(bb.r), textoEsquerda: r1(textLeft) })
  ok(Math.abs(bb.t - top) <= 0.4 * em && Math.abs(bb.b - bottom) <= 0.4 * em, `${label}: traço de marcador do topo da linha ${lns[0]} ao fundo da linha ${lns[lns.length - 1]} (±0.4em)`,
    { traço: [r1(bb.t), r1(bb.b)], texto: [r1(top), r1(bottom)], desvio_em: [r3((bb.t - top) / em), r3((bb.b - bottom) / em)] })
  ok(bb.r - bb.l <= 0.6 * em, `${label}: traço de marcador quase vertical`, { largura: r1(bb.r - bb.l), em })
  // A tinta (meia largura para cada lado) não é cortada pela moldura nem pela borda do ecrã
  ok(bb.l - p.width / 2 >= H.clip.l - 0.5 && bb.r + p.width / 2 <= H.clip.r + 0.5, `${label}: a tinta do traço de marcador não é cortada (moldura / ecrã)`,
    { tinta: [r1(bb.l - p.width / 2), r1(bb.r + p.width / 2)], visível: [r1(H.clip.l), r1(H.clip.r)] })
  return { clearance: r3((textLeft - (bb.r + p.width / 2)) / em) }
}

// ── Píxeis (ordem de pintura e translucidez) ──────────────────────────────
let decoder = null
/** Píxeis RGBA de uma zona do viewport (px CSS): captura e descodifica num separador à parte */
async function grab(page, b) {
  const x = Math.max(0, Math.floor(b.l))
  const y = Math.max(0, Math.floor(b.t))
  const clip = { x, y, width: Math.max(1, Math.ceil(b.r) - x), height: Math.max(1, Math.ceil(b.b) - y) }
  const png = await page.screenshot({ clip })
  if (!decoder) decoder = await browser.newPage()
  const img = await decoder.evaluate(async b64 => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const cv = new OffscreenCanvas(bmp.width, bmp.height)
    const g = cv.getContext('2d')
    g.drawImage(bmp, 0, 0)
    return { w: bmp.width, h: bmp.height, d: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data) }
  }, png.toString('base64'))
  const k = img.w / clip.width
  const px = (ix, iy) => {
    const o = (Math.min(img.h - 1, Math.max(0, iy)) * img.w + Math.min(img.w - 1, Math.max(0, ix))) * 4
    return [img.d[o], img.d[o + 1], img.d[o + 2]]
  }
  return {
    /** Mediana 3×3 (px do aparelho) à volta de um ponto do viewport */
    at(vx, vy) {
      const cx = Math.round((vx - clip.x) * k)
      const cy = Math.round((vy - clip.y) * k)
      const s = []
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s.push(px(cx + dx, cy + dy))
      return [0, 1, 2].map(c => s.map(p => p[c]).sort((a, b) => a - b)[4])
    },
    /** Menor distância (RGB) a uma cor, em toda a zona */
    minDist(c) {
      let best = Infinity
      for (let o = 0; o < img.d.length; o += 4) {
        const d = Math.hypot(img.d[o] - c[0], img.d[o + 1] - c[1], img.d[o + 2] - c[2])
        if (d < best) best = d
      }
      return best
    },
  }
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const cssRgb = s => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

/** Põe a linha `ln` a meio do seu contentor de scroll (a captura é do viewport; a janela nunca faz scroll) */
async function reveal(page, root, ln) {
  await page.evaluate(([root, ln]) => {
    const el = document.querySelector(root).querySelector(`[data-ln="${ln}"]`)
    let sc = el.parentElement
    while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement
    if (sc) {
      const a = el.getBoundingClientRect()
      const b = sc.getBoundingClientRect()
      sc.scrollTop += (a.top + a.bottom) / 2 - (b.top + b.top + Math.min(b.height, innerHeight - b.top)) / 2
    }
    window.scrollTo(0, 0)
  }, [root, ln])
  await frames(page)
}

/** Centro (viewport) de um espaço da linha `ln` com caixa própria e as letras vizinhas na mesma row */
const spaceIn = (page, root, ln, word) => page.evaluate(([root, ln, word]) => {
  const n = [...document.querySelector(root).querySelector(`[data-ln="${ln}"]`).childNodes].find(x => x.nodeType === 3)
  const r = document.createRange()
  const rectOf = c => { r.setStart(n, c); r.setEnd(n, c + 1); return [...r.getClientRects()].find(q => q.width > 0) }
  const i0 = word ? n.data.indexOf(word) : 0
  const i1 = word ? i0 + word.length : n.data.length
  for (let c = i0 + 1; c < i1 - 1; c++) {
    if (n.data[c] !== ' ') continue
    const s = rectOf(c)
    const p = rectOf(c - 1)
    const q = rectOf(c + 1)
    if (s && p && q && s.width > 2 && Math.abs(p.top - s.top) < 1 && Math.abs(q.top - s.top) < 1) return { x: (s.left + s.right) / 2, y: (s.top + s.bottom) / 2 }
  }
  return null
}, [root, ln, word])

/** Ponto de fundo: a meio do intervalo entre a última row de `above` e a 1.ª de `below`, ao centro do bloco */
const gapPoint = (page, root, above, below) => page.evaluate(([root, above, below]) => {
  const host = document.querySelector(root)
  const a = host.querySelector(`[data-ln="${above}"]`).getBoundingClientRect()
  const b = host.querySelector(`[data-ln="${below}"]`).getBoundingClientRect()
  const blk = host.querySelector('[data-ln]').parentElement.getBoundingClientRect()
  return { x: (blk.left + blk.right) / 2, y: (a.bottom + b.top) / 2 }
}, [root, above, below])

const setMarkerZ = async (page, root, z) => {
  await page.evaluate(([root, sel, z]) => { document.querySelector(root).querySelector(sel).style.zIndex = z }, [root, MARKER, z])
  await frames(page)
}

/**
 * Ordem de pintura, nos píxeis: dentro da palavra destacada há píxeis com a
 * cor exata da letra (o texto está por cima). Para mostrar que a medida
 * distingue, repete-se com a camada do marcador forçada por cima do texto:
 * aí todos os píxeis da letra ficam tingidos.
 */
async function checkUnderText(label, page, root, ln, word) {
  await reveal(page, root, ln)
  const w = await wordBox(page, root, ln, word)
  if (!ok(!!w, `${label}: palavra "${word}" na linha ${ln}`)) return
  const ink = cssRgb(await page.evaluate(([root, ln]) => getComputedStyle(document.querySelector(root).querySelector(`[data-ln="${ln}"]`)).color, [root, ln]))
  const zone = { l: w.l + 1, t: w.t + 1, r: w.r - 1, b: w.b - 1 }
  const under = (await grab(page, zone)).minDist(ink)
  await setMarkerZ(page, root, '5')
  const over = (await grab(page, zone)).minDist(ink)
  await setMarkerZ(page, root, '')
  ok(under <= 30 && over >= under + 30, `${label}: o destaque fica POR BAIXO do texto — a letra de "${word}" mantém a sua cor (com a camada por cima ficava tingida)`,
    { distânciaÀCorDaLetra: { real: r1(under), camadaForçadaPorCima: r1(over) }, letra: ink })
}

/**
 * Translucidez, nos píxeis: num espaço destacado (sem letras) a cor é a do
 * fundo com UMA camada da cor do destaque à opacidade da camada — nem opaca,
 * nem dupla. `bgAt`: ponto de fundo (ou a cor de fundo esperada por baixo).
 */
async function checkBlend(label, page, root, ln, word, hex, alpha, bg) {
  await reveal(page, root, ln)
  const pt = await spaceIn(page, root, ln, word)
  if (!ok(!!pt, `${label}: há um espaço destacado em "${word ?? `linha ${ln}`}" (mesma row)`)) return
  const got = (await grab(page, { l: pt.x - 4, t: pt.y - 4, r: pt.x + 4, b: pt.y + 4 })).at(pt.x, pt.y)
  const want = mix(bg, hexRgb(hex), alpha)
  ok(maxDiff(got, want) <= 6, `${label}: espaço destacado em "${word ?? `linha ${ln}`}" = fundo + ${hex} a ${alpha} (translúcido, uma só camada)`,
    { medido: got, esperado: want.map(Math.round), fundo: bg, duplo: mix(want, hexRgb(hex), alpha).map(Math.round) })
}

/** Cor do fundo num ponto do intervalo entre estrofes */
async function bgColor(page, root, above, below) {
  await reveal(page, root, above)
  const p = await gapPoint(page, root, above, below)
  return (await grab(page, { l: p.x - 4, t: p.y - 4, r: p.x + 4, b: p.y + 4 })).at(p.x, p.y)
}

/** Caixa (viewport) de uma palavra (a n-ésima ocorrência) numa linha */
const wordBox = (page, root, ln, word, nth = 0) => page.evaluate(([root, ln, word, nth]) => {
  const el = document.querySelector(root)?.querySelector(`[data-ln="${ln}"]`)
  const n = el && [...el.childNodes].find(x => x.nodeType === 3)
  if (!n) return null
  let i = -1
  for (let k = 0; k <= nth; k++) i = n.data.indexOf(word, i + 1)
  if (i < 0) return null
  const r = document.createRange()
  r.setStart(n, i)
  r.setEnd(n, i + word.length)
  const rs = [...r.getClientRects()].filter(b => b.width > 0)
  return { l: Math.min(...rs.map(b => b.left)), r: Math.max(...rs.map(b => b.right)), t: Math.min(...rs.map(b => b.top)), b: Math.max(...rs.map(b => b.bottom)), rows: rs.length }
}, [root, ln, word, nth])

/** Gestos à mão: um ponto a uma fração da palavra; linha com tremor */
const at = (w, f = 0.5) => [w.l + (w.r - w.l) * f, (w.t + w.b) / 2]
const stroke = (a, b, n = 16) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n + 0.8 * Math.sin(i * 1.3)])

/**
 * Tudo o que o payload do cenário H desenha num layout: os destaques, o traço
 * livre de marcador na margem do refrão, o sublinhado da caneta (por cima do
 * texto) e, nos píxeis, a ordem de pintura e a translucidez. `L`: as linhas
 * (mudam quando a letra é editada).
 */
async function checkHlLayout(label, page, root, recs, L, { bg, emDrawn = 32, pixels = true } = {}) {
  await settle(page, root)
  const H = await hlSnap(page, root, recs, [...L.ink, L.pen, L.long])
  checkHighlights(label, H, recs, { bg })
  const ink = checkMarkerInk(label, H, HC.laranja, L.ink)
  const S = await snapshot(page, root)
  ok(H.pen === 1 && S.paths.length === 1, `${label}: só o traço da caneta na camada da caneta (o marcador nunca)`, { caneta: H.pen })
  const u = checkUnderline(label, S, L.pen, C.under)
  if (u?.p) checkWidth(`${label} (caneta)`, u.p, W.under, emDrawn, S)
  const longRec = recs.find(r => r.ln === L.long)
  const longRows = longRec ? H.expect[longRec.id]?.rows.length : 0
  if (pixels) {
    await checkUnderText(label, page, root, L.afinar, 'afinar')
    const bgPx = await bgColor(page, root, L.pen, L.pen + 2)
    await checkBlend(label, page, root, L.pink, null, HC.rosa, alphaFor(H, HC.rosa), bgPx)
    await checkBlend(label, page, root, L.long, null, HC.verde, alphaFor(H, HC.verde), bgPx)
  }
  const alphas = H.colorGroups.map(g => `${g.fills[0]}${g.label ? ' (rótulo)' : ''} ${g.opacity}`).join(', ')
  console.log(`    ${label}: letra ${r1(H.em)}px · entrelinha ${r3(H.lh)} · opacidades ${alphas} · linha longa em ${longRows} row(s)` +
    (ink ? ` · marcador da margem a ${ink.clearance}em do texto (tinta)` : ''))
  return H
}

/** Transpila um anchor.ts (o atual ou o de um commit) para um módulo importável */
const tmpDirs = []
async function importAnchor(src, name) {
  const esbuild = createRequire(import.meta.url)(path.join(ROOT, 'node_modules/esbuild'))
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gigio-e2e-anchor-'))
  tmpDirs.push(dir)
  const file = path.join(dir, `${name}.mjs`)
  writeFileSync(file, esbuild.transformSync(src, { loader: 'ts', format: 'esm', target: 'es2022' }).code)
  return import(pathToFileURL(file).href)
}
// O anchor.ts atual (cenário H: a opacidade esperada de cada cor, a compatibilidade)
const NEWA = await importAnchor(readFileSync(path.join(ROOT, 'src/lib/annotations/anchor.ts'), 'utf8'), 'anchor-atual')

// ════════════════════════════════════════════════════════════════════════════
if (!process.env.E2E_NO_BUILD) {
  console.log('build com Supabase fictício…')
  execSync('npx vite build --logLevel error', {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, VITE_SUPABASE_URL: 'https://mockproj.supabase.co', VITE_SUPABASE_ANON_KEY: 'mockanon' },
  })
}
// A versão publicada antes do marcador (PR #45), possivelmente em cache no
// iPad: build dela (git archive) numa pasta temporária, com o mesmo Supabase
// fictício — o cenário H8 abre-a no browser com um payload com destaques
const OLD_COMMIT = '2b52db3'
const OLD_PORT = 4208
const OLD_BASE = `http://localhost:${OLD_PORT}`
const OLD_DIR = path.join(os.tmpdir(), `gigio-e2e-${OLD_COMMIT}`)
let oldDist = null
if (!process.env.E2E_NO_OLD) {
  try {
    if (!process.env.E2E_NO_BUILD || !existsSync(path.join(OLD_DIR, 'dist/index.html'))) {
      console.log(`build da versão publicada (${OLD_COMMIT}) com Supabase fictício…`)
      rmSync(OLD_DIR, { recursive: true, force: true })
      mkdirSync(OLD_DIR, { recursive: true })
      execSync(`git archive ${OLD_COMMIT} | tar -x -C "${OLD_DIR}"`, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
      symlinkSync(path.join(ROOT, 'node_modules'), path.join(OLD_DIR, 'node_modules'), 'dir')
      execSync('npx vite build --logLevel error', {
        cwd: OLD_DIR, stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, VITE_SUPABASE_URL: 'https://mockproj.supabase.co', VITE_SUPABASE_ANON_KEY: 'mockanon' },
      })
    }
    oldDist = path.join(OLD_DIR, 'dist')
  } catch (e) {
    console.log(`  (aviso) sem o build de ${OLD_COMMIT}: H8 fica só a nível de módulo — ${String(e?.stderr ?? e).split('\n').filter(Boolean).slice(-2).join(' | ')}`)
  }
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
const server = staticServer()
await new Promise(r => server.listen(PORT, r))
const oldServer = oldDist ? staticServer(oldDist) : null
if (oldServer) await new Promise(r => oldServer.listen(OLD_PORT, r))
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
  const FREE_KEY = `gigio_ann_u_u1_${FREE_ID}`
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
  const FIM_KEY = `gigio_ann_u_u1_${FIM_ID}`
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

  // ══ Cenário H: marcador (highlighter) ═══════════════════════════════════
  const HL_STAGE = { bg: '#0B0B0C', active_color: '#F2F1EC', accent_color: '#FF6A26', align: 'left' }
  // Palco claro: não há predefinição, mas o fundo é configurável (profiles.concert_theme)
  const STAGE_LIGHT = { bg: '#FFFFFF', active_color: '#151517', accent_color: '#C2410C' }
  // Linhas que o payload do cenário H usa (a letra editada, H9, muda-as)
  const LH = { afinar: 2, pen: 3, ink: [6, 7, 8], pink: 7, long: 11 }
  // Letra editada depois de destacar (H8, H9): uma linha nova acima e uma palavra nova dentro da linha de "afinar"
  const ED_LINES = HL_LINES.slice()
  ED_LINES.splice(1, 0, 'Chegámos tarde ao ensaio')
  ED_LINES[3] = 'Ficámos todos a afinar à luz do telemóvel'
  const EDITED = ED_LINES.join('\n')
  // Toque do dedo num botão da fita. A pausa: logo a seguir a um gesto de
  // toque do CDP, o Chromium não gera o click de um toque (chegam pointerdown,
  // pointerup e touchend, mas não o click) — ninguém toca numa cor 0ms depois
  // de levantar o dedo
  const tap = async (page, label) => {
    await page.waitForTimeout(350)
    await page.tap(`button[aria-label="${label}"]`)
  }
  /** Escolhe uma ferramenta, cor ou espessura na fita e confirma que ficou escolhida (aria-pressed) */
  const choose = async (page, label) => {
    await tap(page, label)
    ok((await pressedOf(page, [label]))[label] === 'true', `fita: ${label} escolhido`)
  }
  const pressedOf = (page, labels) => page.evaluate(ls => Object.fromEntries(ls.map(l => [l, document.querySelector(`button[aria-label="${l}"]`)?.getAttribute('aria-pressed') ?? null])), labels)
  const toTop = (page, sel) => page.evaluate(sel => { const el = document.querySelector(sel); if (el) el.scrollTop = 0 }, sel)

  console.log('— H1. Ensaio iPad retrato (32px, tema claro): Marcador escolhido na fita, arrasto a começar a meio de uma palavra')
  const HA = await newDevice(browser, { viewport: TABLET_PORT, appTheme: 'light', seed: { [FONT_KEY]: null, [HL_KEY]: null } })
  const hp = HA.page
  await openEnsaio(hp, { song: HL_ID })
  const S0 = await snapshot(hp, ENSAIO)
  ok(S0.em === 32 && HL_LINES.every((l, ln) => !l.trim() || (S0.rows[ln]?.length ?? 0) === 1),
    'H pré-condição: Ensaio a 32px, cada linha numa row', Object.fromEntries(Object.entries(S0.rows).map(([k, v]) => [k, v.length])))
  // Fita: Caneta | Marcador | Borracha (com o dedo, como no iPad)
  const stripH = () => hp.evaluate(() => document.querySelector('[role="toolbar"][aria-label="Ferramentas de anotação"]').getBoundingClientRect().height)
  const strip0 = await stripH()
  const TOOLS = ['Caneta', 'Marcador', 'Borracha']
  let pr = await pressedOf(hp, TOOLS)
  ok(pr.Caneta === 'true' && pr.Marcador === 'false' && pr.Borracha === 'false', 'H1 fita: abre com a Caneta', pr)
  await choose(hp, 'Marcador')
  pr = await pressedOf(hp, TOOLS)
  ok(pr.Caneta === 'false' && pr.Marcador === 'true' && pr.Borracha === 'false', 'H1 fita: Marcador escolhido (aria-pressed)', pr)
  const fita = await hp.evaluate(tools => {
    const q = l => document.querySelector(`button[aria-label="${l}"]`)
    return {
      tamanhos: Object.fromEntries(tools.map(l => { const b = q(l).getBoundingClientRect(); return [l, [Math.round(b.width), Math.round(b.height)]] })),
      rótulos: tools.map(l => q(l).textContent.trim()),
      ícone: !!q('Marcador').querySelector('svg[stroke="currentColor"]'),
      cores: [...document.querySelectorAll('button[aria-label^="Marcador "]')].map(b => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')]),
      caneta: document.querySelectorAll('button[aria-label^="Cor "]').length,
      espessuras: ['Traço fino', 'Traço médio', 'Traço grosso'].map(l => q(l)?.disabled ?? null),
    }
  }, TOOLS)
  ok(Object.values(fita.tamanhos).every(([w, h]) => w >= 44 && h >= 44), 'H1 fita: Caneta, Marcador e Borracha com alvo ≥44px no tablet', fita.tamanhos)
  ok(fita.rótulos.join() === TOOLS.join() && fita.ícone, 'H1 fita: ícone (traço, currentColor) + rótulo curto', { rótulos: fita.rótulos, ícone: fita.ícone })
  ok(JSON.stringify(fita.cores) === JSON.stringify([['Marcador amarelo', 'true'], ['Marcador verde', 'false'], ['Marcador rosa', 'false'], ['Marcador azul', 'false'], ['Marcador laranja', 'false']]) && fita.caneta === 0,
    'H1 fita: com o Marcador as amostras passam às cores do marcador (amarelo por omissão)', { cores: fita.cores, coresDaCaneta: fita.caneta })
  ok(fita.espessuras.every(d => d === true), 'H1 fita: espessuras desativadas com o Marcador', fita.espessuras)
  ok(Math.abs(await stripH() - strip0) < 0.5, 'H1 fita: a fita não muda de altura ao trocar de ferramenta', { antes: strip0, depois: await stripH() })

  // Arrasto com a caneta (Apple Pencil) de meio "avariou" a meio "curva"
  let a = await wordBox(hp, ENSAIO, 1, 'avariou')
  let b = await wordBox(hp, ENSAIO, 1, 'curva')
  await penStroke(hp, stroke(at(a, 0.45), at(b, 0.55), 20))
  ok(await waitN(hp, HL_KEY, 1), 'H1: destaque gravado')
  let PH = await payloadOf(hp, HL_KEY)
  const h1 = recAt(PH, 1, 'avariou na curva')
  ok(!!h1 && h1.c0 === HL_LINES[1].indexOf('avariou') && h1.c1 === HL_LINES[1].indexOf('curva') + 5 && h1.color === HC.amarelo && hlRecs(PH).length === 1,
    'H1: começado a meio de "avariou", acabado a meio de "curva" → "avariou na curva" (palavras inteiras), amarelo', hlRecs(PH))
  await settle(hp, ENSAIO)
  let HH = await hlSnap(hp, ENSAIO, hlRecs(PH))
  checkHighlights('H1 Ensaio claro', HH, hlRecs(PH), { bg: 'claro' })
  ok(HH.pen === 0 && (await pathCount(hp, ENSAIO)) === 0, 'H1: o destaque não é um traço da caneta (camada da caneta vazia)', { caneta: HH.pen })
  await checkUnderText('H1 Ensaio claro', hp, ENSAIO, 1, 'avariou')
  const bgLight = await bgColor(hp, ENSAIO, 3, 5)
  await checkBlend('H1 Ensaio claro', hp, ENSAIO, 1, 'na curva', HC.amarelo, alphaFor(HH, HC.amarelo), bgLight)

  console.log('— H2. Toque curto (dedo) numa palavra → só essa palavra; toque na margem → nada')
  a = await wordBox(hp, ENSAIO, 2, 'afinar')
  await touchStroke(hp, [at(a)])
  ok(await waitN(hp, HL_KEY, 2), 'H2: destaque do toque gravado')
  ok(await hp.evaluate(() => window.__ptypes[window.__ptypes.length - 1]) === 'touch', 'H2: a app recebeu um toque do dedo')
  PH = await payloadOf(hp, HL_KEY)
  const h2 = recAt(PH, 2, 'afinar')
  ok(!!h2 && h2.c0 === HL_LINES[2].indexOf('afinar') && recsOn(PH, 2).length === 1, 'H2: um toque em "afinar" destaca só "afinar"', recsOn(PH, 2))
  const r2 = (await snapshot(hp, ENSAIO)).rows[2][0]
  await touchStroke(hp, [[r2.l - 2 * 32, (r2.t + r2.b) / 2]])
  await hp.waitForTimeout(400)
  ok(itemsOf(await payloadOf(hp, HL_KEY)).length === 2, 'H2: um toque na margem (fora do texto) não acrescenta nada')
  await settle(hp, ENSAIO)
  checkHighlights('H2 Ensaio claro', await hlSnap(hp, ENSAIO, hlRecs(PH)), hlRecs(PH))

  console.log('— H3. Arrasto por 3 linhas (rosa): fim da 1.ª, a do meio inteira, início da 3.ª; um gesto = um passo de Desfazer')
  await choose(hp, 'Marcador rosa')
  const draw3 = async () => {
    const c = await wordBox(hp, ENSAIO, 6, 'chuva')
    const n = await wordBox(hp, ENSAIO, 8, 'noite')
    await penStroke(hp, stroke(at(c, 0.4), at(n, 0.6), 30))
  }
  await draw3()
  ok(await waitN(hp, HL_KEY, 5), 'H3: 3 destaques gravados (um por linha)')
  PH = await payloadOf(hp, HL_KEY)
  const want3 = [[6, 'chuva lá fora'], [7, 'Ninguém arruma os cabos'], [8, 'Até a noite']]
  ok(want3.every(([ln, t]) => recAt(PH, ln, t)?.color === HC.rosa && recsOn(PH, ln).length === 1),
    'H3: "chuva lá fora" · "Ninguém arruma os cabos" (inteira) · "Até a noite", a rosa', [6, 7, 8].map(ln => recsOn(PH, ln).map(r => r.t)))
  await settle(hp, ENSAIO)
  checkHighlights('H3 Ensaio claro', await hlSnap(hp, ENSAIO, hlRecs(PH)), hlRecs(PH))
  await tap(hp, 'Desfazer')
  ok(await waitN(hp, HL_KEY, 2) && await waitMarker(hp, ENSAIO, 2), 'H3: um Desfazer tira os 3 destaques do gesto de uma vez')
  await draw3()
  ok(await waitN(hp, HL_KEY, 5), 'H3: refeito')

  console.log('— H. Linha longa inteira, a verde, com o dedo')
  await choose(hp, 'Marcador verde')
  a = await wordBox(hp, ENSAIO, 11, 'Bateram')
  b = await wordBox(hp, ENSAIO, 11, 'volume')
  await touchStroke(hp, stroke(at(a), at(b), 24))
  ok(await waitRec(hp, HL_KEY, 11, HL_LINES[11]), 'H: linha longa destacada inteira (verde, com o dedo)', recsOn(await payloadOf(hp, HL_KEY), 11))

  console.log('— H6. Sobreposição: outra cor recorta (e parte em dois), a mesma cor funde — nunca dupla opacidade')
  await choose(hp, 'Marcador azul')
  a = await wordBox(hp, ENSAIO, 1, 'na')
  b = await wordBox(hp, ENSAIO, 1, 'serra')
  await penStroke(hp, stroke(at(a), at(b), 20))
  ok(await waitRec(hp, HL_KEY, 1, 'na curva da serra'), 'H6: azul "na curva da serra" gravado')
  PH = await payloadOf(hp, HL_KEY)
  ok(recsOn(PH, 1).length === 2 && recAt(PH, 1, 'avariou')?.id === h1?.id && recAt(PH, 1, 'avariou')?.color === HC.amarelo && recAt(PH, 1, 'na curva da serra')?.color === HC.azul,
    'H6: o amarelo "avariou na curva" perde a parte sobreposta → "avariou" (o mesmo destaque); o azul fica com "na curva da serra"', recsOn(PH, 1))
  await settle(hp, ENSAIO)
  checkHighlights('H6 recorte, Ensaio claro', await hlSnap(hp, ENSAIO, hlRecs(PH)), hlRecs(PH))
  await checkBlend('H6 recorte, Ensaio claro (onde estava o amarelo)', hp, ENSAIO, 1, 'na curva', HC.azul, alphaFor(HH, HC.azul), bgLight)

  await choose(hp, 'Marcador rosa')
  const old8 = recAt(PH, 8, 'Até a noite')
  a = await wordBox(hp, ENSAIO, 8, 'noite')
  b = await wordBox(hp, ENSAIO, 8, 'acabar')
  await penStroke(hp, stroke(at(a), at(b), 16))
  ok(await waitRec(hp, HL_KEY, 8, 'Até a noite acabar'), 'H6: rosa por cima de parte do rosa gravado')
  PH = await payloadOf(hp, HL_KEY)
  ok(recsOn(PH, 8).length === 1 && !!old8 && !hlRecs(PH).some(r => r.id === old8.id) && hlRecs(PH).length === 7,
    'H6: a mesma cor funde-se num só destaque "Até a noite acabar"', recsOn(PH, 8))

  await choose(hp, 'Marcador amarelo')
  a = await wordBox(hp, ENSAIO, 12, 'Desligámos')
  b = await wordBox(hp, ENSAIO, 12, 'manhã')
  await penStroke(hp, stroke(at(a), at(b), 24))
  ok(await waitRec(hp, HL_KEY, 12, HL_LINES[12]), 'H6: linha 12 inteira a amarelo')
  const whole12 = recAt(await payloadOf(hp, HL_KEY), 12, HL_LINES[12])
  await choose(hp, 'Marcador verde')
  const drawSplit = async () => {
    const x = await wordBox(hp, ENSAIO, 12, 'às')
    const y = await wordBox(hp, ENSAIO, 12, 'três')
    await penStroke(hp, stroke(at(x), at(y), 12))
  }
  await drawSplit()
  ok(await waitRec(hp, HL_KEY, 12, 'às três'), 'H6: verde "às três" gravado')
  PH = await payloadOf(hp, HL_KEY)
  const l12 = recsOn(PH, 12).sort((p, q) => p.c0 - q.c0)
  ok(l12.length === 3 && l12[0].t === 'Desligámos tudo' && l12[0].color === HC.amarelo && l12[0].id === whole12?.id &&
    l12[1].t === 'às três' && l12[1].color === HC.verde && l12[2].t === 'da manhã' && l12[2].color === HC.amarelo && l12[2].id !== whole12?.id,
  'H6: verde no meio do amarelo parte-o em dois ("Desligámos tudo" · "às três" · "da manhã")', l12)
  await settle(hp, ENSAIO)
  checkHighlights('H6 fusão e corte em dois, Ensaio claro', await hlSnap(hp, ENSAIO, hlRecs(PH)), hlRecs(PH))
  await tap(hp, 'Desfazer')
  const undone = await hp.waitForFunction(([k, t]) => {
    const all = JSON.parse(localStorage.getItem(k) ?? 'null')?.anchored ?? []
    return all.filter(e => e[3] === 5 && e[4] === 12).length === 1 && all.some(e => e[4] === 12 && e[7] === t)
  }, [HL_KEY, HL_LINES[12]], { timeout: 5000 }).then(() => true, () => false)
  ok(undone && recAt(await payloadOf(hp, HL_KEY), 12, HL_LINES[12])?.id === whole12?.id,
    'H6: um Desfazer volta ao amarelo inteiro (o corte e o verde são um só passo)', recsOn(await payloadOf(hp, HL_KEY), 12))
  await drawSplit()
  ok(await waitRec(hp, HL_KEY, 12, 'às três'), 'H6: verde refeito')

  console.log('— H7. Traço livre de marcador na margem do refrão (laranja)')
  await choose(hp, 'Marcador laranja')
  let Sx = await snapshot(hp, ENSAIO)
  const refr = LH.ink.flatMap(ln => Sx.rows[ln])
  const mx = Math.min(...refr.map(r => r.l)) - 0.8 * Sx.em
  const topR = Sx.rows[6][0].t
  const botR = Sx.rows[8][Sx.rows[8].length - 1].b
  await penStroke(hp, Array.from({ length: 25 }, (_, i) => [mx + 0.8 * Math.sin(i * 1.1), topR + (botR - topR) * i / 24]))
  ok(await waitN(hp, HL_KEY, 11), 'H7: traço de marcador gravado')
  PH = await payloadOf(hp, HL_KEY)
  const inkE = hlInks(PH)
  ok(inkE.length === 1 && inkE[0][1] === HC.laranja && inkE[0][8] === 1 && Math.abs(inkE[0][2] - HL_INK_EM * 1000) <= 1,
    'H7: gravado como traço livre de marcador (modo 6), ancorado à margem, 0.9em de largura', inkE.map(e => ({ cor: e[1], w: e[2], modo: e[3], ancoragem: e[8] })))
  await settle(hp, ENSAIO)
  HH = await hlSnap(hp, ENSAIO, hlRecs(PH), LH.ink)
  checkMarkerInk('H7 Ensaio claro', HH, HC.laranja, LH.ink)
  ok(HH.pen === 0, 'H7: o traço de marcador não está na camada da caneta', { caneta: HH.pen })

  console.log('— H. Caneta (cada ferramenta lembra a sua cor) e sublinhado por cima do texto')
  await choose(hp, 'Caneta')
  pr = await pressedOf(hp, ['Caneta', 'Cor vermelho', 'Traço fino'])
  ok(pr.Caneta === 'true' && pr['Cor vermelho'] === 'true' && pr['Traço fino'] === 'true', 'H: de volta à Caneta, com a cor e a espessura dela', pr)
  ok(await hp.evaluate(() => ['Traço fino', 'Traço médio', 'Traço grosso'].every(l => !document.querySelector(`button[aria-label="${l}"]`).disabled)), 'H: espessuras ativas com a Caneta')
  await choose(hp, 'Cor âmbar')
  await choose(hp, 'Traço médio')
  Sx = await snapshot(hp, ENSAIO)
  const ru = Sx.rows[LH.pen][0]
  await penStroke(hp, Array.from({ length: 31 }, (_, i) => [ru.l - 3 + (ru.r - ru.l + 6) * i / 30, ru.b + 0.16 * Sx.em + 0.6 * Math.sin(i * 1.7)]))
  ok(await waitN(hp, HL_KEY, 12), 'H: sublinhado da caneta gravado')
  await choose(hp, 'Marcador')
  pr = await pressedOf(hp, ['Marcador laranja'])
  ok(pr['Marcador laranja'] === 'true', 'H: o Marcador lembra a sua cor (laranja)', pr)
  await choose(hp, 'Caneta')
  pr = await pressedOf(hp, ['Cor âmbar', 'Traço médio'])
  ok(pr['Cor âmbar'] === 'true' && pr['Traço médio'] === 'true', 'H: a Caneta lembra a sua (âmbar, médio)', pr)

  const P_H = await payloadOf(hp, HL_KEY)
  const recsH = hlRecs(P_H)
  ok(recsH.length === 10 && hlInks(P_H).length === 1 && penEntries(P_H).length === 1,
    'H: payload final com 10 destaques, 1 traço de marcador e 1 da caneta', { destaques: recsH.map(r => `${r.ln}:${r.t}`), marcador: hlInks(P_H).length, caneta: penEntries(P_H).length })
  ok(P_H.v === 2 && P_H.em === 32 && [1, 2, 6, 7, 8, 11, 12].every(ln => P_H.lines?.[String(ln)] === HL_LINES[ln]),
    'H: payload v2 com o texto das linhas destacadas (lines)', P_H.lines)
  console.log('— H. Ensaio claro: tudo junto')
  await checkHlLayout('H Ensaio claro', hp, ENSAIO, recsH, LH, { bg: 'claro' })
  // Cópia antiga {w,h,strokes} (px do Ensaio) para os clientes muito antigos: cada row de um
  // destaque é um traço horizontal largo e translúcido (rgba) no sítio do retângulo
  HH = await hlSnap(hp, ENSAIO, recsH, LH.ink)
  const lay = (await snapshot(hp, ENSAIO)).layer
  const badCopy = []
  for (const r of recsH) {
    const g = HH.groups.find(x => x.id === r.id)
    const parts = P_H.strokes.filter(s => s.id === r.id || s.id.startsWith(`${r.id}~`))
    const [cr, cg, cb] = hexRgb(r.color)
    if (!g || parts.length !== g.rects.length) { badCopy.push({ t: r.t, partes: parts.length, retângulos: g?.rects.length }); continue }
    parts.forEach((s, k) => {
      const q = g.rects[k]
      const w = s.width
      const fine = s.color === `rgba(${cr}, ${cg}, ${cb}, 0.4)` && s.pts.length === 4 && s.pts[1] === s.pts[3] &&
        Math.abs(w - (q.b - q.t)) <= 1 && Math.abs(s.pts[1] + lay.t - (q.t + q.b) / 2) <= 1 &&
        Math.abs(s.pts[0] - w / 2 + lay.l - q.l) <= 1.5 && Math.abs(s.pts[2] + w / 2 + lay.l - q.r) <= 1.5
      if (!fine) badCopy.push({ t: r.t, traço: s, retângulo: { l: r1(q.l - lay.l), r: r1(q.r - lay.l), t: r1(q.t - lay.t), b: r1(q.b - lay.t) } })
    })
  }
  ok(badCopy.length === 0, 'H: cópia antiga (px) — cada row de destaque é um traço horizontal largo rgba(…, 0.4) no sítio do retângulo', badCopy.slice(0, 3))
  const inkCopy = P_H.strokes.find(s => s.id === String(hlInks(P_H)[0]?.[0]))
  ok(!!inkCopy && inkCopy.color === 'rgba(255, 154, 31, 0.4)' && Math.abs(inkCopy.width - HL_INK_EM * 32) <= 0.1,
    'H: cópia antiga — o traço de marcador vai em rgba translúcido e largo', inkCopy && { cor: inkCopy.color, largura: inkCopy.width })
  ok(P_H.strokes.find(s => s.id === String(penEntries(P_H)[0]?.[0]))?.color === '#F59E0B', 'H: cópia antiga — a caneta continua opaca')
  await toTop(hp, ENSAIO_SCROLL)
  await shots(hp, 'H1-ensaio-ipad-retrato-claro', ENSAIO_SCROLL)
  await choose(hp, 'Marcador')
  await hp.screenshot({ path: path.join(OUT, 'H1b-fita-marcador-ipad-retrato-claro.png'), clip: { x: 0, y: 0, width: TABLET_PORT.width, height: 420 } })

  console.log('— H5. Borracha, Desfazer e Limpar com destaques')
  await choose(hp, 'Borracha')
  ok((await pressedOf(hp, ['Borracha'])).Borracha === 'true', 'H5: Borracha escolhida')
  const hAf = recAt(P_H, 2, 'afinar')
  await reveal(hp, ENSAIO, 2)
  a = await wordBox(hp, ENSAIO, 2, 'afinar')
  await penStroke(hp, stroke(at(a, 0.35), at(a, 0.65), 6))
  ok(await waitN(hp, HL_KEY, 11), 'H5: a borracha apaga o destaque tocado')
  const P5 = await payloadOf(hp, HL_KEY)
  ok(!!hAf && !hlRecs(P5).some(r => r.id === hAf.id) && hlRecs(P5).length === 9 && hlInks(P5).length === 1 && penEntries(P5).length === 1,
    'H5: só "afinar" saiu', hlRecs(P5).map(r => r.t))
  ok(await waitMarker(hp, ENSAIO, 9), 'H5: e deixou de se desenhar')
  await tap(hp, 'Desfazer')
  ok(await waitN(hp, HL_KEY, 12) && recAt(await payloadOf(hp, HL_KEY), 2, 'afinar')?.id === hAf?.id, 'H5: Desfazer repõe o mesmo destaque')
  ok(await waitMarker(hp, ENSAIO, 10), 'H5: e volta a desenhar-se')
  await reveal(hp, ENSAIO, 7)
  HH = await hlSnap(hp, ENSAIO, recsH)
  const pinks = recsH.filter(r => r.color === HC.rosa)
  const centres = pinks.map(r => { const q = HH.groups.find(g => g.id === r.id).rects[0]; return [(q.l + q.r) / 2, (q.t + q.b) / 2] })
  await penStroke(hp, [...stroke(centres[0], centres[1], 10), ...stroke(centres[1], centres[2], 10).slice(1)])
  ok(await waitN(hp, HL_KEY, 9), 'H5: um gesto da borracha apaga os 3 destaques rosa por onde passa (e mais nada)')
  await tap(hp, 'Desfazer')
  ok(await waitN(hp, HL_KEY, 12) && pinks.every(r => hlRecs(P_H).some(x => x.id === r.id)) &&
    jsonSet((await payloadOf(hp, HL_KEY)).anchored) === jsonSet(P_H.anchored), 'H5: um Desfazer repõe os 3 (um gesto = um passo)')
  await hp.waitForTimeout(350)
  await hp.tap('[role="toolbar"] button:has-text("Limpar")')
  await hp.tap('[role="alertdialog"] button:has-text("Limpar")')
  ok(await waitN(hp, HL_KEY, 0), 'H5: Limpar apaga tudo (destaques, marcador livre e caneta)')
  const PL = await payloadOf(hp, HL_KEY)
  ok(PL.strokes.length === 0 && !(await hp.$(`${ENSAIO} ${MARKER}`)) && (await pathCount(hp, ENSAIO)) === 0,
    'H5: depois de Limpar não fica nada desenhado, nem na cópia antiga', { cópiaAntiga: PL.strokes.length })
  await tap(hp, 'Desfazer')
  ok(await waitN(hp, HL_KEY, 12) && jsonSet((await payloadOf(hp, HL_KEY)).anchored) === jsonSet(P_H.anchored), 'H5: Desfazer depois de Limpar repõe tudo, igual')
  ok(await waitMarker(hp, ENSAIO, 10), 'H5: e volta a desenhar-se')
  await HA.ctx.close()

  console.log('— H. Ensaio no tema escuro (o mesmo payload, outro aparelho)')
  const HD = await newDevice(browser, { viewport: TABLET_PORT, appTheme: 'dark', seed: { [FONT_KEY]: null, [HL_KEY]: JSON.stringify(P_H) } })
  await openEnsaio(HD.page, { song: HL_ID })
  ok(await waitMarker(HD.page, ENSAIO, recsH.length), 'H Ensaio escuro: destaques desenhados')
  await checkHlLayout('H Ensaio escuro', HD.page, ENSAIO, recsH, LH, { bg: 'escuro' })
  await toTop(HD.page, ENSAIO_SCROLL)
  await shots(HD.page, 'H2-ensaio-ipad-retrato-escuro', ENSAIO_SCROLL)
  ok(JSON.stringify(await payloadOf(HD.page, HL_KEY)) === JSON.stringify(P_H) && HD.writes === 0, 'H Ensaio escuro: abrir não regrava nada')
  await HD.ctx.close()

  // ── H4: o mesmo payload no concerto ─────────────────────────────────────
  const HL_LAYOUTS = [
    ['iPad paisagem, letra grande (44→64px)', 'H4a-concerto-ipad-paisagem-64px', TABLET_LAND, false, { font_size: 44, line_height: 1.6 }],
    ['telemóvel 32px, via cloud', 'H4b-concerto-telemovel-32px', PHONE, true, { font_size: 32, line_height: 1.6 }],
    ['iPad retrato, entrelinha 1.3', 'H4c-concerto-ipad-retrato-lh1.3', TABLET_PORT, false, { font_size: 32, line_height: 1.3 }],
    ['telemóvel, entrelinha 1.3 (28px)', 'H4d-concerto-telemovel-lh1.3', PHONE, true, { font_size: 28, line_height: 1.3 }],
    ['iPad paisagem, entrelinha 2.0', 'H4e-concerto-ipad-paisagem-lh2.0', TABLET_LAND, false, { font_size: 28, line_height: 2.0 }],
    ['telemóvel, entrelinha 2.0 (36px)', 'H4f-concerto-telemovel-lh2.0', PHONE, true, { font_size: 36, line_height: 2.0 }],
    ['iPad retrato, palco claro (fundo personalizado)', 'H4g-concerto-ipad-retrato-palco-claro', TABLET_PORT, false, { font_size: 32, line_height: 1.6, ...STAGE_LIGHT }],
    ['telemóvel, palco claro', 'H4h-concerto-telemovel-palco-claro', PHONE, true, { font_size: 32, line_height: 1.6, ...STAGE_LIGHT }],
  ]
  for (const [label, shot, viewport, phone, theme] of HL_LAYOUTS) {
    console.log(`— H4. Concerto: ${label}`)
    const viaCloud = label.includes('cloud')
    const lightStage = theme.bg === STAGE_LIGHT.bg
    const dev = await newDevice(browser, {
      viewport, phone, concertTheme: { ...HL_STAGE, ...theme },
      seed: viaCloud ? { [HL_KEY]: null } : { [HL_KEY]: JSON.stringify(P_H) },
      cloud: viaCloud ? { song_id: HL_ID, user_id: 'u1', strokes: P_H, updated_at: new Date().toISOString() } : null,
    })
    if (await openConcert(dev.page, 1, { setlist: 'sH' })) {
      ok(await waitMarker(dev.page, CONCERT, recsH.length), `H4 ${label}: destaques desenhados`)
      const H = await checkHlLayout(`H4 concerto ${label}`, dev.page, CONCERT, recsH, LH, { bg: lightStage ? 'claro' : 'escuro' })
      const wantEm = phone ? theme.font_size : Math.round(theme.font_size * 1.45)
      ok(H.em === wantEm && Math.abs(H.lh - theme.line_height) < 0.01, `H4 ${label}: letra a ${wantEm}px, entrelinha ${theme.line_height}`, { em: H.em, lh: r3(H.lh) })
      if (phone) {
        const rows = H.expect[recAt(P_H, LH.long, HL_LINES[LH.long]).id].rows.length
        ok(rows >= 2, `H4 ${label}: a linha longa destacada quebra (pré-condição) → um retângulo por row`, { rows })
      }
      await toTop(dev.page, CONCERT_SCROLL)
      await shots(dev.page, shot, CONCERT_SCROLL)
      ok(dev.writes === 0, `H4 ${label}: o concerto não grava`, { cloud: dev.writes })
    }
    await dev.ctx.close()
  }

  console.log('— H4. Concerto com SÓ destaques (sem caneta), um deles num rótulo de secção: a tecla das anotações aparece e desenha-os')
  // [Refrão] (linha 5) mostra-se como REFRÃO: texto pequeno na cor de acento — o seu destaque é mais leve
  const recLabel = { id: 'rotulo-1', color: HC.amarelo, ln: 5, c0: 0, c1: 6, t: 'REFRÃO' }
  const recsHO = [...recsH, recLabel]
  const P_HO = { ...P_H, anchored: [...P_H.anchored.filter(e => e[3] === 5), [recLabel.id, recLabel.color, 0, 5, 5, 0, 6, recLabel.t]], strokes: [] }
  const HO = await newDevice(browser, { viewport: PHONE, phone: true, concertTheme: { ...HL_STAGE, font_size: 32, line_height: 1.6 }, seed: { [HL_KEY]: JSON.stringify(P_HO) } })
  if (await openConcert(HO.page, 0, { setlist: 'sH' })) {
    ok(await waitMarker(HO.page, CONCERT, recsHO.length), 'H4 só destaques: desenhados')
    await settle(HO.page, CONCERT)
    const H = await hlSnap(HO.page, CONCERT, recsHO)
    checkHighlights('H4 só destaques, telemóvel', H, recsHO, { bg: 'escuro' })
    ok(H.pen === 0 && H.inks.length === 0, 'H4 só destaques: sem caneta nem marcador livre', { caneta: H.pen, marcador: H.inks.length })
    const gl = H.groups.find(g => g.id === recLabel.id)
    const gt = H.groups.find(g => g.fill === HC.amarelo.toLowerCase() && !g.label)
    ok(!!gl && gl.label && !!gt && gl.opacity < gt.opacity && H.labelPx < 16,
      'H4 rótulo de secção destacado: no grupo dos rótulos, mais leve do que o mesmo amarelo na letra', gl && gt && { rótulo: gl.opacity, letra: gt.opacity, tamanhoDoRótulo: H.labelPx })
    await reveal(HO.page, CONCERT, 5)
    await shots(HO.page, 'H4j-concerto-telemovel-rotulo-destacado', CONCERT_SCROLL)
  }
  await HO.ctx.close()

  console.log('— H4. Concerto só com destaques escondidos (o texto já não está na letra): sem tecla de anotações')
  const P_HX = {
    w: P_H.w, h: P_H.h, strokes: [], v: 2, em: 32, lines: {},
    anchored: [
      ['orfao-1', HC.amarelo, 0, 5, 2, 4, 9, 'linha', { 2: 'Uma linha que já não existe na letra' }],
      ['velho-1', HC.verde, 0, 5, 2, 0, 5, 'zzzzz'],
    ],
  }
  const HX = await newDevice(browser, { viewport: PHONE, phone: true, concertTheme: { ...HL_STAGE }, seed: { [HL_KEY]: JSON.stringify(P_HX) } })
  await HX.page.goto(`${BASE}/setlist/sH/concert`, { waitUntil: 'networkidle' })
  await HX.page.waitForTimeout(1500)
  ok(!(await HX.page.$('button[aria-label="Anotações de ensaio"]')), 'H4 só destaques escondidos: a tecla "Anotações de ensaio" não aparece (levava a uma vista vazia)')
  await HX.ctx.close()

  console.log('— H4. Concerto com sync: a linha ativa (fundo tintado) não esconde os destaques')
  const HS = await newDevice(browser, { viewport: TABLET_PORT, concertTheme: { ...HL_STAGE, font_size: 24, line_height: 1.6 }, seed: { [`gigio_ann_u_u1_${HLS_ID}`]: JSON.stringify(P_H) } })
  if (await openConcert(HS.page, 1, { setlist: 'sHs' })) {
    // Da espera, "Linha ›" entra na 1.ª linha de letra (a dos destaques amarelo e azul)
    await HS.page.tap('button[aria-label="Linha seguinte"]')
    const act = await HS.page.waitForSelector(`${CONCERT} [data-ln="1"][data-activeline]`, { timeout: 5000 }).then(() => true, () => false)
    if (await HS.page.$('button[aria-label="Pausar"]')) await HS.page.tap('button[aria-label="Pausar"]')
    ok(act, 'H4 linha ativa: a 1.ª linha (com destaques) fica ativa')
    await HS.page.waitForTimeout(700)
    await settle(HS.page, CONCERT)
    const H = await hlSnap(HS.page, CONCERT, recsH)
    checkHighlights('H4 concerto com a linha ativa', H, recsH, { bg: 'escuro' })
    const st = await HS.page.evaluate(([root, sel]) => {
      const el = document.querySelector(root).querySelector('[data-ln="1"]')
      const be = getComputedStyle(el, '::before')
      return { fundo: getComputedStyle(el).backgroundColor, faixa: { z: be.zIndex, fundo: be.backgroundColor }, marcador: getComputedStyle(document.querySelector(root).querySelector(sel)).zIndex }
    }, [CONCERT, MARKER])
    ok(st.fundo === 'rgba(0, 0, 0, 0)' && st.faixa.z === '-2' && st.faixa.fundo !== 'rgba(0, 0, 0, 0)' && st.marcador === '-1',
      'H4 linha ativa: a faixa tintada fica por trás do marcador (::before a z-index -2, marcador a -1)', st)
    if (act) {
      await reveal(HS.page, CONCERT, 1)
      const pt = await spaceIn(HS.page, CONCERT, 1, 'na curva')
      const end = await wordBox(HS.page, CONCERT, 1, 'serra')
      const zone = await grab(HS.page, { l: pt.x - 4, t: pt.y - 4, r: end.r + H.em + 4, b: pt.y + 4 })
      const got = zone.at(pt.x, pt.y)
      const tint = zone.at(end.r + 0.8 * H.em, pt.y)
      const want = mix(tint, hexRgb(HC.azul), alphaFor(H, HC.azul))
      ok(maxDiff(got, want) <= 8 && maxDiff(got, tint) >= 40, 'H4 linha ativa: o destaque azul vê-se por cima da faixa tintada (faixa + uma camada azul)',
        { medido: got, esperado: want.map(Math.round), faixaSozinha: tint })
      await shots(HS.page, 'H4i-concerto-linha-ativa', CONCERT_SCROLL)
    }
  }
  await HS.ctx.close()

  // ── H8: a versão publicada antes do marcador (2b52db3) ───────────────────
  console.log(`— H8. Compatibilidade (módulo): o anchor.ts de ${OLD_COMMIT} lê e regrava o payload com destaques`)
  let OLDA = null
  try {
    OLDA = await importAnchor(execSync(`git show ${OLD_COMMIT}:src/lib/annotations/anchor.ts`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), 'anchor-2b52db3')
  } catch { /* sem git ou sem o commit */ }
  const markerE = P_H.anchored.filter(e => e[3] >= 5)
  if (ok(!!OLDA, `H8: anchor.ts de ${OLD_COMMIT} disponível (git show)`)) {
    const po = OLDA.readPayload(JSON.parse(JSON.stringify(P_H)))
    ok(po.anchored.length === penEntries(P_H).length && po.anchored.every(s => [0, 1, 2, 3, 4].includes(s.mode)),
      `H8 ${OLD_COMMIT}: só decodifica os traços da caneta — destaques e marcador livre nunca entram como caneta`, po.anchored.map(s => s.mode))
    ok(jsonSet(po.extra) === jsonSet(markerE), `H8 ${OLD_COMMIT}: guarda os destaques e o marcador livre em extra, tal como vieram`, { extra: po.extra.length, marcador: markerE.length })
    const re = OLDA.buildPayload({ w: P_H.w, h: P_H.h, strokes: P_H.strokes, em: P_H.em, anchored: po.anchored, lyrics: HL_LYRICS, extra: po.extra })
    ok(jsonSet(re.anchored.filter(e => e[3] >= 5)) === jsonSet(markerE), `H8 ${OLD_COMMIT}: ao gravar reescreve-os iguais`)
    const sig = p => JSON.stringify(p.anchored.filter(s => s.mode === 5 || s.hl).sort((x, y) => (x.id < y.id ? -1 : 1)))
    const pn = NEWA.readPayload(JSON.parse(JSON.stringify(re)))
    ok(sig(pn) === sig(NEWA.readPayload(JSON.parse(JSON.stringify(P_H)))) && NEWA.payloadHasVisible(pn, HL_LYRICS),
      'H8: a versão atual lê os mesmos destaques e o mesmo marcador livre depois dessa regravação')
    // Destaques da versão atual visíveis com a letra `lyr`, e na linha certa (a mesma do texto da linha onde foram feitos)
    const fits = (p, lyr) => NEWA.rebaseStrokes(p.anchored, p.lines, lyr.join('\n'), p.hlLines).strokes
      .filter(x => x.mode === 5 && !x.lines && (lyr[x.ln] ?? '').slice(x.c0, x.c1) === x.t &&
        lyr[x.ln].replace('todos ', '') === HL_LINES[recsH.find(r => r.id === x.id)?.ln ?? -1]).length
    const fitFull = fits(NEWA.readPayload(JSON.parse(JSON.stringify(P_H))), ED_LINES)
    ok(fitFull === recsH.length, 'H8: (referência) com o payload da versão atual, os destaques seguem a letra editada', { visíveis: fitFull, de: recsH.length })
    // A 2b52db3 regrava "lines" só com as linhas da caneta, mas o retrato do marcador (modo 7) vai com os destaques
    ok(markerE.filter(e => e[3] === 7).length === 1 && jsonSet(re.anchored.filter(e => e[3] === 7)) === jsonSet(markerE.filter(e => e[3] === 7)),
      `H8 ${OLD_COMMIT}: o retrato das linhas do marcador é reescrito tal como veio`)
    // Só destaques e nenhum traço da caneta que ela conheça (apagou o seu único traço): a 2b52db3
    // grava lines = {} — com a letra editada depois, a versão atual continua a saber para onde foram
    const reOnly = OLDA.buildPayload({ w: P_H.w, h: P_H.h, strokes: [], em: P_H.em, anchored: [], lyrics: HL_LYRICS, extra: po.extra })
    const fitOnly = fits(NEWA.readPayload(JSON.parse(JSON.stringify(reOnly))), ED_LINES)
    ok(JSON.stringify(reOnly.lines) === '{}' && fitOnly === recsH.length,
      `H8 ${OLD_COMMIT} sem traços próprios (lines = {}), letra editada depois: os ${recsH.length} destaques visíveis e na linha certa`, { visíveis: fitOnly, linhas: reOnly.lines })
    // A 2b52db3 abre a letra JÁ editada: re-numera a caneta, grava lines com a letra nova e devolve
    // os destaques com a numeração antiga — a versão atual põe-nos na linha certa pelo retrato do marcador
    const reb = OLDA.rebaseStrokes(po.anchored, po.lines, EDITED)
    const reEd = OLDA.buildPayload({ w: P_H.w, h: P_H.h, strokes: [], em: P_H.em, anchored: reb.strokes, lyrics: EDITED, extra: po.extra })
    const pEd = NEWA.readPayload(JSON.parse(JSON.stringify(reEd)))
    const fitEd = fits(pEd, ED_LINES)
    const inkEd = NEWA.rebaseStrokes(pEd.anchored, pEd.lines, EDITED, pEd.hlLines).strokes.find(x => x.hl)
    ok(reb.changed && reEd.lines['2'] === ED_LINES[2] && fitEd === recsH.length && inkEd && LH.ink.map(l => l + 1).includes(inkEd.p[0]),
      `H8 ${OLD_COMMIT} re-numera a caneta com a letra editada: os destaques e o marcador livre continuam nas suas linhas`, { visíveis: fitEd, de: recsH.length, marcador: inkEd?.p[0] })
  }

  if (oldDist) {
    // A versão publicada guarda as anotações deste aparelho só por música (a atual adota-as para o utilizador que entra)
    const HL_KEY_OLD = `gigio_ann_v1_${HL_ID}`
    console.log(`— H8. A versão publicada (${OLD_COMMIT}, build próprio no browser) abre o Ensaio com destaques, apaga, desenha e grava`)
    const O = await newDevice(browser, {
      viewport: TABLET_PORT, seed: { [FONT_KEY]: null, [HL_KEY_OLD]: JSON.stringify(P_H) },
      cloud: { song_id: HL_ID, user_id: 'u1', strokes: P_H, updated_at: new Date().toISOString() },
    })
    await openEnsaio(O.page, { song: HL_ID, base: OLD_BASE })
    const drawnOld = await O.page.evaluate(root => [...document.querySelector(root).querySelectorAll('svg path')].map(p => (p.getAttribute('stroke') ?? '').toLowerCase()), ENSAIO)
    const hlColors = Object.values(HC).map(c => c.toLowerCase())
    ok(drawnOld.length === penEntries(P_H).length && !drawnOld.some(c => hlColors.includes(c)),
      `H8 ${OLD_COMMIT} no browser: desenha só a caneta — nenhum destaque nem marcador livre como caneta opaca`, { caminhos: drawnOld })
    await shots(O.page, 'H8-ensaio-versao-2b52db3', ENSAIO_SCROLL)
    // A borracha dela passa por cima de "afinar": não o vê, não o apaga
    await O.page.click('button[aria-label="Borracha"]')
    a = await wordBox(O.page, ENSAIO, 2, 'afinar')
    await penStroke(O.page, stroke(at(a, 0.2), at(a, 0.8), 8))
    await O.page.waitForTimeout(500)
    ok(JSON.stringify(await payloadOf(O.page, HL_KEY_OLD)) === JSON.stringify(P_H), `H8 ${OLD_COMMIT}: a borracha passa por cima de um destaque sem o apagar`)
    // Um traço novo da caneta: grava (local e cloud) com o que não conhece reescrito tal como veio
    await O.page.click('button[aria-label="Cor vermelho"]')
    const So = await snapshot(O.page, ENSAIO)
    const r12 = So.rows[12][0]
    await penStroke(O.page, Array.from({ length: 21 }, (_, i) => [r12.l + (r12.r - r12.l) * i / 20, r12.b + 0.16 * So.em + 0.6 * Math.sin(i * 1.7)]))
    ok(await waitN(O.page, HL_KEY_OLD, itemsOf(P_H).length + 1), `H8 ${OLD_COMMIT}: traço novo da caneta gravado`)
    for (let t = 0; t < 40 && O.writes < 1; t++) await O.page.waitForTimeout(100)
    const PO = await payloadOf(O.page, HL_KEY_OLD)
    ok(jsonSet(PO.anchored.filter(e => e[3] >= 5)) === jsonSet(markerE) && penEntries(PO).length === penEntries(P_H).length + 1,
      `H8 ${OLD_COMMIT}: grava com os destaques e o marcador livre iguais (neste aparelho)`)
    ok(O.writes >= 1 && jsonSet((O.cloud?.strokes?.anchored ?? []).filter(e => e[3] >= 5)) === jsonSet(markerE), `H8 ${OLD_COMMIT}: e na cloud`, { escritas: O.writes })
    await O.ctx.close()
    console.log(`— H8. Outro aparelho (versão atual) recebe da cloud o que a ${OLD_COMMIT} gravou`)
    const N = await newDevice(browser, { viewport: PHONE, phone: true, concertTheme: { ...HL_STAGE, font_size: 32, line_height: 1.6 }, seed: { [HL_KEY]: null }, cloud: O.cloud })
    if (await openConcert(N.page, 2, { setlist: 'sH' })) {
      ok(await waitMarker(N.page, CONCERT, recsH.length), 'H8 concerto: destaques desenhados')
      await settle(N.page, CONCERT)
      const H = await hlSnap(N.page, CONCERT, recsH, LH.ink)
      checkHighlights(`H8 concerto (versão atual) com o que a ${OLD_COMMIT} gravou`, H, recsH, { bg: 'escuro' })
      checkMarkerInk('H8 concerto', H, HC.laranja, LH.ink)
      await toTop(N.page, CONCERT_SCROLL)
      await shots(N.page, 'H8-concerto-depois-da-2b52db3', CONCERT_SCROLL)
    }
    await N.ctx.close()
  }

  // ── H9: letra editada depois de destacar ────────────────────────────────
  console.log('— H9. Letra editada (linha inserida acima; palavra nova dentro de uma linha destacada): os destaques ficam nas mesmas palavras')
  const HL9_KEY = `gigio_ann_u_u1_${HL9_ID}`
  const L9 = { afinar: 3, pen: 4, ink: [7, 8, 9], pink: 8, long: 12 }
  const H9 = await newDevice(browser, { viewport: TABLET_PORT, appTheme: 'light', seed: { [FONT_KEY]: null, [HL9_KEY]: JSON.stringify(P_H) } })
  await openEnsaio(H9.page, { song: HL9_ID })
  ok(await waitMarker(H9.page, ENSAIO, recsH.length), 'H9: destaques no Ensaio antes de editar')
  await H9.page.click('button[title="Editar o texto da letra"]')
  await H9.page.fill('textarea[aria-label="Letra"]', EDITED)
  await H9.page.click('button[title="Ensaio: ler e anotar a letra"]')
  await H9.page.waitForSelector(`${ENSAIO} [data-ln="13"]`)
  const renum = await H9.page.waitForFunction(([k, t]) => JSON.parse(localStorage.getItem(k) ?? 'null')?.lines?.['2'] === t,
    [HL9_KEY, ED_LINES[2]], { timeout: 5000 }).then(() => true, () => false)
  const P9 = await payloadOf(H9.page, HL9_KEY)
  const recs9 = hlRecs(P9)
  const moved = recsH.map(r => {
    const n = recs9.find(x => x.id === r.id)
    const dc = r.ln === 2 ? 'todos '.length : 0
    return { t: r.t, ok: !!n && n.ln === r.ln + 1 && n.t === r.t && n.c0 === r.c0 + dc && n.c1 === r.c1 + dc, antes: [r.ln, r.c0], depois: n && [n.ln, n.c0] }
  })
  ok(renum && recs9.length === recsH.length && moved.every(m => m.ok),
    'H9: a letra editada regrava os destaques na numeração nova — linha +1, o mesmo texto ("afinar" segue a palavra dentro da linha editada)', moved.filter(m => !m.ok))
  await settle(H9.page, ENSAIO)
  await checkHlLayout('H9 Ensaio, letra editada', H9.page, ENSAIO, recs9, L9, { bg: 'claro', pixels: false })
  await toTop(H9.page, ENSAIO_SCROLL)
  await shots(H9.page, 'H9-ensaio-letra-editada', ENSAIO_SCROLL)
  // A edição chega ao servidor: o concerto neste aparelho (payload já renumerado)…
  songH9.lyrics = EDITED
  if (await openConcert(H9.page, 1, { setlist: 'sH9' })) {
    ok(await waitMarker(H9.page, CONCERT, recs9.length), 'H9 concerto: destaques desenhados')
    await checkHlLayout('H9 concerto iPad retrato (payload renumerado)', H9.page, CONCERT, recs9, L9, { bg: 'escuro', pixels: false })
    await toTop(H9.page, CONCERT_SCROLL)
    await shots(H9.page, 'H9-concerto-letra-editada', CONCERT_SCROLL)
  }
  await H9.ctx.close()
  // …e outro aparelho que ainda tem o payload ANTIGO (renumera só em memória)
  const H9b = await newDevice(browser, { viewport: PHONE, phone: true, concertTheme: { ...HL_STAGE, font_size: 32, line_height: 1.6 }, seed: { [HL9_KEY]: JSON.stringify(P_H) } })
  if (await openConcert(H9b.page, 1, { setlist: 'sH9' })) {
    ok(await waitMarker(H9b.page, CONCERT, recs9.length), 'H9 telemóvel: destaques desenhados')
    await checkHlLayout('H9 concerto telemóvel (payload antigo, letra editada)', H9b.page, CONCERT, recs9, L9, { bg: 'escuro', pixels: false })
    ok(JSON.stringify(await payloadOf(H9b.page, HL9_KEY)) === JSON.stringify(P_H) && H9b.writes === 0, 'H9 telemóvel: o concerto não regrava')
  }
  await H9b.ctx.close()
} catch (e) {
  ok(false, 'exceção no teste', String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '))
} finally {
  await browser.close()
  server.close()
  oldServer?.close()
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
}

console.log(`\ncapturas em ${OUT}`)
if (failures.length) {
  console.log('\nFalhas:')
  for (const f of failures) console.log(' -', f)
}
console.log(`\n${passed} passaram, ${failures.length} falharam`)
process.exit(failures.length ? 1 : 0)
