#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Testes das anotações ancoradas ao texto
   (src/lib/annotations/anchor.ts — cada ponto de um traço preso a um
   carácter da letra e redesenhado no mesmo sítio em qualquer layout).
   Corre em Node puro:  node scripts/test-annotation-anchors.mjs [-v]
   Transpila o módulo com o esbuild do projeto para uma pasta temporária.
   Sem DOM: o layout é FICTÍCIO, com as regras do LyricsView — fonte
   monoespaçada (0.55em por carácter), linhas centradas no bloco, quebra
   por largura (overflow-wrap: break-word), entrelinha configurável,
   quebras de estrofe (0.8em) e rótulos de secção em px fixos.
═══════════════════════════════════════════════════════════════ */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const esbuild = require(join(root, 'node_modules/esbuild'))

const out = mkdtempSync(join(tmpdir(), 'annotation-anchors-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
const src = readFileSync(join(root, 'src/lib/annotations/anchor.ts'), 'utf8')
const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'esm', target: 'es2022' })
writeFileSync(join(out, 'anchor.mjs'), code)
const A = await import(pathToFileURL(join(out, 'anchor.mjs')).href)
const {
  anchorStroke, anchorLegacy, resolveStroke, resolveAll, remapLines, rebaseStrokes, collectLines,
  encodeAnchored, decodeAnchored, buildPayload, readPayload, payloadHasStrokes, toLegacyStrokes,
  smoothPath, pathFromSubpaths, hitSubpaths, strokesAt, mergeRowRects, pickCharRect, isLayoutEmpty,
  MODE_TEXT, MODE_MARGIN, MODE_MARGIN_ROW, MODE_GAP, MODE_FREE, P_STRIDE, MIN_WIDTH_PX, Y_IN, Y_BELOW, Y_ABOVE,
  anchorFree, marginGutter, decodeAnchoredParts, unionById, unionExtra, payloadHasVisible,
  // Marcador
  MODE_HL_TEXT, MODE_HL_INK, HL_INK_EM, HL_LEGACY_ALPHA, HL_OPACITY_LIGHT, HL_OPACITY_DARK,
  classifyHighlight, highlightRange, anchorHighlight, resolveHighlight, resolveHighlights, highlightsAt,
  mergeHighlights, isTextHighlight, markerOpacity, luminanceOf, rgbaOf, markerAlpha, HL_MIN_ALPHA_LARGE, MODE_HL_LINES,
} = A

// A versão publicada antes do marcador (PR #45, commit 2b52db3) — possivelmente
// em cache no iPad: tem de preservar os destaques sem os apagar nem desenhar
let OLD = null
try {
  const oldSrc = execSync('git show 2b52db3:src/lib/annotations/anchor.ts', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  writeFileSync(join(out, 'anchor-2b52db3.mjs'), esbuild.transformSync(oldSrc, { loader: 'ts', format: 'esm', target: 'es2022' }).code)
  OLD = await import(pathToFileURL(join(out, 'anchor-2b52db3.mjs')).href)
} catch { /* sem git ou sem o commit: o teste de compatibilidade avisa */ }
const MODE_NAMES = { [MODE_TEXT]: 'texto', [MODE_MARGIN]: 'margem', [MODE_GAP]: 'intervalo', [MODE_FREE]: 'livre' }

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
function test(name, fn) {
  try { fn() } catch (e) { fail++; failures.push(`✗ ${name} — exceção: ${e?.stack ?? e}`) }
}

/* ═══ Layout fictício (as regras do LyricsView) ═══ */
const WS = /\s/

/**
 * Layout de uma letra: em, lh (entrelinha), width (bloco), secFont/secMt/secMb
 * (rótulo de secção em px fixos: 13px, margens 22/8 no tablet; 11px, 18/6 no
 * telemóvel). A caixa de conteúdo do texto tem 1.2em, centrada na line box.
 * pad = calha lateral (px de cada lado, ver marginGutter): o texto quebra
 * dentro dela; o bloco e o centro ficam iguais.
 */
function makeLayout(lyrics, o = {}) {
  const em = o.em ?? 32
  const lh = o.lh ?? 1.6
  const width = o.width ?? 780
  const left = o.left ?? 0
  const cw = (o.charW ?? 0.55) * em
  const contentH = 1.2 * em
  const secFont = o.secFont ?? 13
  const secMt = o.secMt ?? 22
  const secMb = o.secMb ?? 8
  const secCw = secFont * 0.6
  const secContent = secFont * 1.2
  const secLine = secFont * 1.1
  const centerX = left + width / 2
  const info = new Map()
  const lines = typeof lyrics === 'string' && lyrics.trim() ? lyrics.split('\n') : []
  const calls = { rows: 0, chars: 0 }

  function flow(line, yTop) {
    const n = line.length
    let a = 0
    while (a < n && WS.test(line[a])) a++
    let b = n - 1
    while (b >= a && WS.test(line[b])) b--
    // Palavras + o espaço visível antes de cada uma (os outros brancos colapsam)
    const words = []
    let k = a
    let sp = -1
    while (k <= b) {
      const s = k
      while (k <= b && !WS.test(line[k])) k++
      words.push({ s, e: k - 1, sp })
      sp = k
      while (k <= b && WS.test(line[k])) k++
    }
    // pad = calha lateral (padding do LyricsView): o texto quebra dentro, o bloco fica igual
    const maxC = Math.max(1, Math.floor((width - 2 * (o.pad ?? 0)) / cw + 1e-9))
    const rowsC = []
    let cur = []
    for (const w of words) {
      const len = w.e - w.s + 1
      if (cur.length && cur.length + 1 + len <= maxC) {
        cur.push(w.sp)
        for (let c = w.s; c <= w.e; c++) cur.push(c)
        continue
      }
      if (cur.length) { rowsC.push({ items: cur, hang: w.sp }); cur = [] }
      for (let c = w.s; c <= w.e; c++) {
        if (cur.length === maxC) { rowsC.push({ items: cur, hang: -1 }); cur = [] }
        cur.push(c)
      }
    }
    if (cur.length) rowsC.push({ items: cur, hang: -1 })
    const rows = []
    const chars = new Array(n).fill(null)
    rowsC.forEach((r, ri) => {
      const top = yTop + ri * lh * em + (lh * em - contentH) / 2
      const w = r.items.length * cw
      const l = centerX - w / 2
      rows.push({ left: l, right: l + w, top, bottom: top + contentH })
      r.items.forEach((c, j) => { chars[c] = { left: l + j * cw, right: l + (j + 1) * cw, top, bottom: top + contentH } })
      // Espaço onde a linha quebra: fica no fim da row, com largura 0
      if (r.hang >= 0) chars[r.hang] = { left: l + w, right: l + w, top, bottom: top + contentH }
    })
    return { rows, chars }
  }

  let y = 0
  let pending = 0
  let first = true
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    const sec = /^\[(.+?)\]$/.exec(t)
    if (sec) {
      y += first ? 0 : Math.max(pending, secMt)   // .section:first-child sem margem; margens colapsam
      pending = secMb
      const label = sec[1].toUpperCase()
      const w = label.length * secCw
      const top = y + (secLine - secContent) / 2
      const l = centerX - w / 2
      const row = { left: l, right: l + w, top, bottom: top + secContent }
      const chars = label.split('').map((_, k) => ({ left: l + k * secCw, right: l + (k + 1) * secCw, top: row.top, bottom: row.bottom }))
      info.set(i, { text: label, rows: [row], chars })
      y += secLine
    } else if (t === '') {
      y += pending + 0.8 * em
      pending = 0
    } else {
      y += pending
      pending = 0
      const { rows, chars } = flow(lines[i], y)
      info.set(i, { text: lines[i], rows, chars })
      y += rows.length * lh * em
    }
    first = false
  }
  return {
    em,
    blockLeft: left,
    blockRight: left + width,
    centerX,
    lines: [...info.keys()],
    rows(ln) { calls.rows++; return info.get(ln)?.rows ?? [] },
    text(ln) { return info.get(ln)?.text ?? '' },
    charRect(ln, c) { calls.chars++; return info.get(ln)?.chars[c] ?? null },
    // Só para os testes (não fazem parte do LayoutModel)
    height: y + pending,
    calls,
  }
}

/* ── fixtures (letra INVENTADA) ── */
const LYRICS = [
  '[Verso 1]',                                                    // 0
  'Acordo cedo com o rio a passar',                               // 1
  'Há café na mesa e o sol a entrar',                             // 2
  'Guardo as chaves no bolso do casaco',                          // 3
  'E saio para a rua sem olhar para trás',                        // 4
  '',                                                             // 5
  '[Refrão]',                                                     // 6
  'Leva-me contigo, leva-me daqui',                               // 7
  '    (leva-me daqui)',                                          // 8
  'Leva-me contigo até ao fim da linha',                          // 9
  '',                                                             // 10
  '[Verso 2]',                                                    // 11
  'Uma linha muito comprida que não cabe inteira no ecrã do telemóvel e tem de quebrar', // 12
  'Os dias passam devagar',                                       // 13
  '',                                                             // 14
  '[Refrão]',                                                     // 15
  'Leva-me contigo, leva-me daqui',                               // 16
  '    (leva-me daqui)',                                          // 17
  'Leva-me contigo até ao fim da linha',                          // 18
].join('\n')

// Ensaio no iPad (A=32, entrelinha 1.6); A+ e entrelinha apertada; concerto
// (tema 28 × 1.45, entrelinha 1.4, 900px); bloco estreito; telemóvel
const ENSAIO = { em: 32, lh: 1.6, width: 780 }
const GRANDE = { em: 40, lh: 1.6, width: 1000 }
const APERTADO = { em: 32, lh: 1.25, width: 780 }
const CONCERTO = { em: 41, lh: 1.4, width: 900 }
const ESTREITO = { em: 32, lh: 1.6, width: 420 }
const TELEMOVEL = { em: 22, lh: 1.6, width: 340, secFont: 11, secMt: 18, secMb: 6 }
const DESTINOS = { GRANDE, APERTADO, CONCERTO, ESTREITO, TELEMOVEL }

/* ── ajudas ── */
const YELLOW = '#f5c400'
function word(L, ln, w) {
  const i = L.text(ln).indexOf(w)
  if (i < 0) throw new Error(`"${w}" não está na linha ${ln}`)
  return [i, i + w.length - 1]
}
function visible(L, ln) {
  const t = L.text(ln)
  let a = -1
  let b = -1
  for (let c = 0; c < t.length; c++) {
    const r = L.charRect(ln, c)
    if (r && r.right > r.left) { if (a < 0) a = c; b = c }
  }
  return [a, b]
}
/** Todas as rows por ordem vertical, com a linha e o índice na linha */
function allRows(L) {
  const list = []
  for (const ln of L.lines) L.rows(ln).forEach((r, ri) => list.push({ ...r, ln, ri }))
  return list.sort((a, b) => a.top - b.top)
}
function rowAfter(L, row) {
  const list = allRows(L)
  const k = list.findIndex(r => r.top === row.top && r.left === row.left)
  return list[k + 1] ?? null
}
function rowBefore(L, row) {
  const list = allRows(L)
  const k = list.findIndex(r => r.top === row.top && r.left === row.left)
  return k > 0 ? list[k - 1] : null
}
function rowOfChar(L, ln, c) {
  const b = L.charRect(ln, c)
  return L.rows(ln).find(r => r.top <= b.top + 0.01 && r.bottom >= b.bottom - 0.01)
}
/** Último carácter da linha 2 (sem espaço no fim) */
const L2last = L => L.text(2).length - 1
const pairs = flat => { const p = []; for (let i = 0; i + 1 < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p }
const allPts = res => res.subpaths.flatMap(pairs)
function maxDev(a, b) {
  if (a.length !== b.length) return Infinity
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}
function bbox(pts) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  for (const [x, y] of pts) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y) }
  return { left: l, top: t, right: r, bottom: b }
}
function insidePolygon(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
/** Maior salto vertical entre pontos seguidos de um caminho */
function maxStepY(sp) {
  let m = 0
  for (let i = 3; i < sp.length; i += 2) m = Math.max(m, Math.abs(sp[i] - sp[i - 2]))
  return m
}

/* ── traços desenhados à mão (px no layout de origem) ── */
function underline(L, ln, c0, c1, { off = 0.15, n = 40, wob = 0.03 } = {}) {
  const a = L.charRect(ln, c0)
  const b = L.charRect(ln, c1)
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push(a.left + t * (b.right - a.left), a.bottom + off * L.em + Math.sin(t * 9) * wob * L.em)
  }
  return pts
}
function strike(L, ln, c0, c1, { n = 30 } = {}) {
  const a = L.charRect(ln, c0)
  const b = L.charRect(ln, c1)
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push(a.left + t * (b.right - a.left), (a.top + a.bottom) / 2 + Math.sin(t * 7) * 0.03 * L.em)
  }
  return pts
}
function circle(L, ln, c0, c1, { padX = 0.35, padY = 0.15, n = 48 } = {}) {
  const a = L.charRect(ln, c0)
  const b = L.charRect(ln, c1)
  const cx = (a.left + b.right) / 2
  const cy = (a.top + a.bottom) / 2
  const rx = (b.right - a.left) / 2 + padX * L.em
  const ry = (a.bottom - a.top) / 2 + padY * L.em
  const pts = []
  for (let i = 0; i <= n; i++) {
    const th = -Math.PI / 2 + (2 * Math.PI * i) / n
    pts.push(cx + rx * Math.cos(th), cy + ry * Math.sin(th))
  }
  return pts
}
/** Chaveta à esquerda de várias linhas: do topo da 1.ª à base da última row */
function bracket(L, lns, { gapEm = 1.2, bulge = 0.4, n = 60 } = {}) {
  const rs = lns.flatMap(ln => L.rows(ln))
  const top = Math.min(...rs.map(r => r.top))
  const bottom = Math.max(...rs.map(r => r.bottom))
  const x0 = Math.min(...rs.map(r => r.left)) - gapEm * L.em
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push(x0 - bulge * L.em * Math.pow(1 - Math.abs(2 * t - 1), 3), top + t * (bottom - top))
  }
  return pts
}
/** Nota escrita à direita de uma linha ("x2" em zigue-zague) */
function marginNote(L, ln, { n = 24 } = {}) {
  const r = L.rows(ln)[0]
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push(r.right + (1 + t) * L.em, r.top + (i % 2 ? 0.2 : 0.8) * (r.bottom - r.top))
  }
  return pts
}

/* ═══ 1. Identidade ═══ */
test('identidade: ancorar e resolver no mesmo layout devolve os mesmos pontos', () => {
  const L = makeLayout(LYRICS, ENSAIO)
  const last = allRows(L).at(-1)
  const first = allRows(L)[0]
  const [l0, l1] = visible(L, 12)
  const row12b = L.rows(12)[1]
  const c2 = [...Array(L.text(12).length).keys()].filter(c => { const b = L.charRect(12, c); return b && b.right > b.left && b.top === row12b.top })
  const cases = [
    ['sublinhado', underline(L, 2, ...word(L, 2, 'café na mesa')), MODE_TEXT],
    ['risco', strike(L, 3, ...word(L, 3, 'chaves')), MODE_TEXT],
    ['círculo', circle(L, 2, ...word(L, 2, 'café')), MODE_TEXT],
    ['círculo largo (passa o meio do intervalo)', circle(L, 2, ...word(L, 2, 'café'), { padY: 0.32 }), MODE_TEXT],
    ['chaveta', bracket(L, [1, 2, 3, 4]), MODE_MARGIN],
    ['nota à margem', marginNote(L, 13), MODE_MARGIN],
    ['sublinhado no rótulo de secção', underline(L, 6, ...visible(L, 6)), MODE_TEXT],
    ['sublinhado na 2.ª row de uma linha longa', underline(L, 12, c2[0], c2[c2.length - 1]), MODE_TEXT],
    ['risco na linha longa toda (2 rows)', [...strike(L, 12, l0, L.text(12).indexOf(' não') - 1)], MODE_TEXT],
    ['acima da 1.ª row', [first.left - 10, first.top - 40, first.right + 10, first.top - 36, first.left, first.top - 30], MODE_GAP],
    ['abaixo da última row', [last.left, last.bottom + 60, last.right, last.bottom + 70], MODE_GAP],
    ['entre estrofes', [L.centerX - 40, L.rows(5 + 1)[0].top - 30, L.centerX + 40, L.rows(6)[0].top - 28], MODE_GAP],
  ]
  ok(l1 > l0, 'identidade: linha longa com caracteres visíveis')
  for (const [name, pts, mode] of cases) {
    const a = anchorStroke(pts, YELLOW, 4, L, name)
    eq(a?.mode, mode, `identidade: ${name} → modo ${MODE_NAMES[mode]}`)
    const r = resolveStroke(a, L)
    eq(r.subpaths.length, 1, `identidade: ${name} → um caminho`)
    ok(maxDev(r.subpaths[0] ?? [], pts) <= 0.5, `identidade: ${name} → mesmos pontos ±0.5px`, maxDev(r.subpaths[0] ?? [], pts))
    ok(Math.abs(r.width - 4) < 0.05 && !r.hidden, `identidade: ${name} → largura e visível`, r.width)
  }
})

test('identidade aleatória: 400 traços em todo o bloco', () => {
  // PRNG determinístico (mulberry32): o mesmo teste em todas as corridas
  let seed = 20261018
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (const cfg of [ENSAIO, CONCERTO, TELEMOVEL]) {
    const L = makeLayout(LYRICS, cfg)
    let bad = null
    for (let s = 0; s < 400 && !bad; s++) {
      let x = L.blockLeft + 2 + rnd() * (L.blockRight - L.blockLeft - 4)
      let y = -L.em + rnd() * (L.height + 2 * L.em)
      const n = 1 + Math.floor(rnd() * 60)
      const pts = []
      for (let i = 0; i < n; i++) {
        pts.push(x, y)
        x = Math.min(L.blockRight - 1, Math.max(L.blockLeft + 1, x + (rnd() - 0.5) * 0.8 * L.em))
        y += (rnd() - 0.5) * 0.4 * L.em
      }
      const a = anchorStroke(pts, YELLOW, 3, L, `r${s}`)
      const r = resolveStroke(a, L)
      if (r.subpaths.length !== 1) bad = ['caminhos', r.subpaths.length, pts]
      else if (maxDev(r.subpaths[0], pts) > 0.5) bad = ['desvio', maxDev(r.subpaths[0], pts), pts]
    }
    ok(!bad, `identidade aleatória (em ${cfg.em}, ${cfg.width}px): um caminho, ±0.5px`, bad)
  }
})

/* ═══ 2. Outro tamanho / entrelinha ═══ */
test('letra maior / entrelinha diferente: sublinhado e risco seguem os mesmos caracteres', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const [u0, u1] = word(S, 2, 'café na mesa')
  const [s0, s1] = word(S, 3, 'chaves')
  const und = anchorStroke(underline(S, 2, u0, u1), YELLOW, 4, S, 'u')
  const stk = anchorStroke(strike(S, 3, s0, s1), YELLOW, 4, S, 's')
  for (const [name, cfg] of Object.entries({ GRANDE, APERTADO, CONCERTO })) {
    const D = makeLayout(LYRICS, cfg)
    const em = D.em
    const ru = resolveStroke(und, D)
    eq(ru.subpaths.length, 1, `${name}: sublinhado num caminho`)
    const a = D.charRect(2, u0)
    const b = D.charRect(2, u1)
    const row = rowOfChar(D, 2, u0)
    const next = rowAfter(D, row)
    const pts = allPts(ru)
    ok(pts.every(([x]) => x >= a.left - 0.25 * em && x <= b.right + 0.25 * em), `${name}: sublinhado por baixo dos mesmos caracteres`, bbox(pts))
    ok(pts.every(([, y]) => y > row.bottom - 0.01 && y < next.top && y <= row.bottom + (next.top - row.bottom) / 2 + 0.01),
      `${name}: sublinhado abaixo da row e acima da seguinte`, [bbox(pts), row.bottom, next.top])
    ok(Math.abs(ru.width - 4 * em / 32) < 0.05, `${name}: largura escala com o em`, ru.width)
    const rs = resolveStroke(stk, D)
    const sr = rowOfChar(D, 3, s0)
    const h = sr.bottom - sr.top
    const sp = allPts(rs)
    ok(rs.subpaths.length === 1 && sp.every(([, y]) => y >= sr.top + 0.4 * h && y <= sr.top + 0.6 * h),
      `${name}: risco continua a meio da row`, [bbox(sp), sr])
    ok(sp.every(([x]) => x >= D.charRect(3, s0).left - 0.25 * em && x <= D.charRect(3, s1).right + 0.25 * em),
      `${name}: risco por cima dos mesmos caracteres`)
  }
  const tiny = resolveStroke(anchorStroke([10, 10, 20, 10], YELLOW, 1, S), makeLayout(LYRICS, { ...ENSAIO, em: 16 }))
  eq(tiny.width, MIN_WIDTH_PX, 'largura mínima de 1.5px')
})

/* ═══ 3. Re-quebra ═══ */
test('mudança de largura com re-quebra: sublinhado parte em 2 caminhos, sem diagonal', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  eq(S.rows(4).length, 1, 'origem: a linha cabe numa row')
  const [v0, v1] = visible(S, 4)
  const und = anchorStroke(underline(S, 4, v0, v1, { n: 80 }), YELLOW, 4, S, 'u')
  const stk = anchorStroke(strike(S, 4, v0, v1, { n: 60 }), YELLOW, 4, S, 's')
  for (const [name, cfg, ln] of [['ESTREITO', ESTREITO, 4], ['TELEMOVEL', TELEMOVEL, 4]]) {
    const D = makeLayout(LYRICS, cfg)
    const rows = D.rows(ln)
    eq(rows.length, 2, `${name}: a linha passa a 2 rows`)
    const r = resolveStroke(und, D)
    eq(r.subpaths.length, 2, `${name}: sublinhado em 2 caminhos`)
    r.subpaths.forEach((sp, k) => {
      const row = rows[k]
      const next = rowAfter(D, row)
      const pts = pairs(sp)
      ok(pts.every(([, y]) => y > row.bottom - 0.01 && y < next.top), `${name}: caminho ${k + 1} por baixo da row ${k + 1}`, [bbox(pts), row, next.top])
      ok(pts.every(([x]) => x >= row.left - 0.5 * D.em && x <= row.right + 0.5 * D.em), `${name}: caminho ${k + 1} na extensão da row`, [bbox(pts), row])
      ok(maxStepY(sp) < 0.3 * D.em, `${name}: caminho ${k + 1} sem diagonal`, maxStepY(sp))
    })
    const rs = resolveStroke(stk, D)
    eq(rs.subpaths.length, 2, `${name}: risco em 2 caminhos`)
    ok(rs.subpaths.every((sp, k) => pairs(sp).every(([, y]) => y > rows[k].top && y < rows[k].bottom)), `${name}: cada risco dentro da sua row`)
  }
  // Ao contrário: dois sublinhados nas 2 rows do bloco estreito → uma row no Ensaio
  const N = makeLayout(LYRICS, ESTREITO)
  const parts = N.rows(4).map((row, k) => {
    const cs = [...Array(N.text(4).length).keys()].filter(c => { const b = N.charRect(4, c); return b && b.right > b.left && b.top === row.top })
    return anchorStroke(underline(N, 4, cs[0], cs[cs.length - 1]), YELLOW, 4, N, `p${k}`)
  })
  const back = parts.map(p => resolveStroke(p, S))
  const row = S.rows(4)[0]
  ok(back.every(r => r.subpaths.length === 1 && allPts(r).every(([, y]) => y > row.bottom - 0.01 && y < rowAfter(S, row).top)),
    'alargar: os dois sublinhados ficam por baixo da mesma row')
  ok(bbox(allPts(back[0])).right <= bbox(allPts(back[1])).left + S.em * 0.6, 'alargar: lado a lado, pela ordem')
  // Linha longa que já quebrava no Ensaio: sublinhado na 2.ª row, num bloco largo
  const G = makeLayout(LYRICS, { ...ENSAIO, width: 2000 })
  eq(G.rows(12).length, 1, 'bloco largo: a linha longa cabe numa row')
})

/* ═══ 4. Chaveta na margem ═══ */
test('chaveta na margem esquerda de 4 linhas', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const pts = bracket(S, [1, 2, 3, 4])
  const a = anchorStroke(pts, YELLOW, 4, S, 'chaveta')
  eq(a.mode, MODE_MARGIN, 'chaveta: modo margem')
  for (const [name, cfg] of Object.entries(DESTINOS)) {
    const D = makeLayout(LYRICS, cfg)
    const r = resolveStroke(a, D)
    eq(r.subpaths.length, 1, `${name}: chaveta num só caminho`)
    const sp = r.subpaths[0]
    const k = D.em / S.em
    let dev = 0
    for (let i = 0; i < pts.length; i += 2) dev = Math.max(dev, Math.abs((sp[i] - sp[0]) - (pts[i] - pts[0]) * k))
    ok(dev < 0.5, `${name}: x continua a direito (forma escalada pelo em)`, dev)
    const top = D.rows(1)[0].top
    const bottom = D.rows(4).at(-1).bottom
    const bb = bbox(pairs(sp))
    ok(Math.abs(bb.top - top) <= 0.3 * D.em, `${name}: começa no topo da 1.ª row`, [bb.top, top])
    ok(Math.abs(bb.bottom - bottom) <= 0.3 * D.em, `${name}: acaba na base da última row da 4.ª linha`, [bb.bottom, bottom])
    ok(bb.left >= D.blockLeft - 0.01 && bb.right <= D.blockRight + 0.01, `${name}: dentro do bloco`, bb)
    if (name !== 'ESTREITO' && name !== 'TELEMOVEL') {
      const textLeft = Math.min(...[1, 2, 3, 4].flatMap(ln => D.rows(ln)).map(r => r.left))
      ok(bb.right < textLeft, `${name}: fica à esquerda do texto`, [bb.right, textLeft])
    }
  }
  // O concerto tem menos margem (em do bloco): a chaveta é deslocada inteira, não achatada
  const C = makeLayout(LYRICS, CONCERTO)
  const rc = resolveStroke(a, C)
  // Desvio 10: a meia largura do traço da borda (a tinta não é cortada) e marcada para a calha
  ok(Math.abs(bbox(allPts(rc)).left - (C.blockLeft + rc.width / 2)) < 0.01 && rc.edge === 1, 'concerto: encostada ao bloco (deslocada para dentro, a meia largura do traço)', [bbox(allPts(rc)).left, rc.width, rc.edge])
})

test('desvio 1: chaveta com re-quebra cobre a linha toda (Y preso à linha, não à row)', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const pts = bracket(S, [1, 2, 3, 4])
  const D = makeLayout(LYRICS, ESTREITO)
  const rows4 = D.rows(4)
  eq(rows4.length, 2, 'estreito: a 4.ª linha passa a 2 rows')
  const mine = resolveStroke(anchorStroke(pts, YELLOW, 4, S, 'c1'), D)
  const literal = resolveStroke(anchorStroke(pts, YELLOW, 4, S, 'c2', { marginRows: true }), D)
  eq(anchorStroke(pts, YELLOW, 4, S, 'c3', { marginRows: true }).mode, MODE_MARGIN_ROW, 'literal: modo margem/row')
  const bm = bbox(allPts(mine))
  const bl = bbox(allPts(literal))
  ok(Math.abs(bm.bottom - rows4[1].bottom) <= 0.3 * D.em, 'linha: chega à base da 2.ª row da 4.ª linha', [bm.bottom, rows4[1].bottom])
  ok(bl.bottom < rows4[1].top, 'row (literal): fica a meio da 4.ª linha — o defeito', [bl.bottom, rows4[1].top])
})

/* ═══ 5. Círculo ═══ */
test('círculo à volta de uma palavra continua à volta dessa palavra', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const [w0, w1] = word(S, 2, 'café')
  for (const padY of [0.15, 0.32]) {
    const a = anchorStroke(circle(S, 2, w0, w1, { padY }), YELLOW, 3, S, 'o')
    eq(a.mode, MODE_TEXT, `círculo (${padY}): modo texto`)
    for (const [name, cfg] of Object.entries(DESTINOS)) {
      const D = makeLayout(LYRICS, cfg)
      const r = resolveStroke(a, D)
      eq(r.subpaths.length, 1, `${name} (${padY}): um caminho`)
      const poly = allPts(r)
      let enclosed = true
      for (let c = w0; c <= w1; c++) {
        const b = D.charRect(2, c)
        if (!insidePolygon(poly, (b.left + b.right) / 2, (b.top + b.bottom) / 2)) enclosed = false
      }
      ok(enclosed, `${name} (${padY}): a palavra fica dentro do círculo`)
      const bb = bbox(poly)
      const a0 = D.charRect(2, w0)
      const a1 = D.charRect(2, w1)
      ok(bb.left >= a0.left - D.em && bb.right <= a1.right + D.em && bb.top >= a0.top - D.em && bb.bottom <= a0.bottom + D.em,
        `${name} (${padY}): o círculo não foge da palavra`, [bb, a0, a1])
    }
  }
})

test('desvio 2: círculo largo com a linha de cima re-quebrada (row por troço, não por ponto)', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const pts = circle(S, 2, ...word(S, 2, 'café'), { padY: 0.32 })
  const D = makeLayout(LYRICS, ESTREITO)
  eq(D.rows(1).length, 2, 'estreito: a linha de cima passa a 2 rows')
  const mine = bbox(allPts(resolveStroke(anchorStroke(pts, YELLOW, 3, S, 'a'), D)))
  const literal = bbox(allPts(resolveStroke(anchorStroke(pts, YELLOW, 3, S, 'b', { perPointRows: true }), D)))
  ok(mine.top > D.rows(1)[1].bottom - 0.01, 'por troço: o topo fica no intervalo por cima da palavra', [mine.top, D.rows(1)[1].bottom])
  ok(literal.top < D.rows(1)[1].top, 'ponto a ponto (literal): o topo salta para cima de outra row — o defeito', [literal.top, D.rows(1)[1].top])
})

test('desvio 7: círculo na palavra que passa a abrir uma row (âncora em letras, não em espaços)', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const [w0, w1] = word(S, 4, 'olhar')
  const pts = circle(S, 4, w0, w1)
  const D = makeLayout(LYRICS, ESTREITO)
  eq(rowOfChar(D, 4, w0), D.rows(4)[1], 'estreito: "olhar" abre a 2.ª row')
  const mine = resolveStroke(anchorStroke(pts, YELLOW, 3, S, 'a'), D)
  const literal = resolveStroke(anchorStroke(pts, YELLOW, 3, S, 'b', { anchorSpaces: true }), D)
  eq(mine.subpaths.length, 1, 'letras: o círculo fica inteiro')
  let enclosed = true
  for (let c = w0; c <= w1; c++) {
    const b = D.charRect(4, c)
    if (!insidePolygon(allPts(mine), (b.left + b.right) / 2, (b.top + b.bottom) / 2)) enclosed = false
  }
  ok(enclosed, 'letras: "olhar" continua dentro do círculo')
  ok(literal.subpaths.length > 1, 'espaços (literal): o lado esquerdo salta para o fim da row de cima — o defeito', literal.subpaths.length)
})

test('sublinhado ondulado a meio do intervalo fica preso a uma só linha', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const row = S.rows(3)[0]
  const next = S.rows(4)[0]
  const mid = (row.bottom + next.top) / 2
  const pts = []
  for (let i = 0; i < 40; i++) pts.push(row.left + i * 12, mid + (i % 2 ? 2 : -2))
  const a = anchorStroke(pts, YELLOW, 3, S, 'onda')
  const lns = new Set()
  for (let o = 0; o < a.p.length; o += P_STRIDE) lns.add(a.p[o])
  eq(lns.size, 1, 'onda: todos os pontos presos à mesma linha')
  const lit = anchorStroke(pts, YELLOW, 3, S, 'onda2', { perPointRows: true })
  const litLns = new Set()
  for (let o = 0; o < lit.p.length; o += P_STRIDE) litLns.add(lit.p[o])
  eq(litLns.size, 2, 'onda (ponto a ponto): alterna entre as duas linhas')
  const r = resolveStroke(a, makeLayout(LYRICS, ESTREITO))
  ok(r.subpaths.every(sp => maxStepY(sp) < 0.3 * 32), 'onda: sem saltos entre linhas noutro layout')
})

test('aleatório: nenhum layout produz NaN nem rebenta', () => {
  let seed = 7
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const S = makeLayout(LYRICS, ENSAIO)
  const strokes = []
  for (let s = 0; s < 200; s++) {
    let x = rnd() * 780
    let y = -40 + rnd() * (S.height + 80)
    const pts = []
    for (let i = 0, n = 2 + Math.floor(rnd() * 50); i < n; i++) {
      pts.push(x, y)
      x += (rnd() - 0.5) * 30
      y += (rnd() - 0.5) * 14
    }
    strokes.push(anchorStroke(pts, YELLOW, 3, S, `z${s}`))
  }
  const edited = editLines(LYRICS, l => { l.splice(2, 1); l.splice(9, 0, 'Linha nova inventada'); l[13] = 'Outra coisa' })
  let bad = null
  for (const cfg of [ENSAIO, ...Object.values(DESTINOS)]) {
    for (const text of [LYRICS, edited]) {
      const D = makeLayout(text, cfg)
      const map = remapLines(collectLines(strokes, LYRICS), text)
      resolveAll(strokes, D, map).forEach((r, k) => {
        if (!r.subpaths.every(sp => sp.length >= 2 && sp.every(Number.isFinite))) bad = [cfg, r.id]
        if (r.hidden !== (r.subpaths.length === 0)) bad = ['hidden', r.id]
        // Margem: sempre dentro do bloco (o texto segue os caracteres e pode sair, como a própria linha)
        if (strokes[k].mode !== MODE_TEXT && r.subpaths.some(sp => sp.some((v, i) => i % 2 === 0 && (v < D.blockLeft - 0.01 || v > D.blockRight + 0.01)))) bad = ['margem fora do bloco', cfg, r.id]
      })
    }
  }
  ok(!bad, 'aleatório: 200 traços × 6 layouts × 2 letras — números finitos, margem dentro do bloco', bad)
})

/* ═══ 6. Letra editada ═══ */
function editLines(text, fn) {
  const lines = text.split('\n')
  fn(lines)
  return lines.join('\n')
}

test('letra editada: linha inserida, removida, mudada', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const [u0, u1] = word(S, 2, 'café na mesa')
  const und = anchorStroke(underline(S, 2, u0, u1), YELLOW, 4, S, 'u')
  const brk = anchorStroke(bracket(S, [1, 2, 3, 4]), YELLOW, 4, S, 'b')
  const saved = collectLines([und, brk], LYRICS)
  eq(saved['2'], 'Há café na mesa e o sol a entrar', 'collectLines: texto (trim) por linha')
  ok(!('5' in saved) && saved['8'] === '(leva-me daqui)', 'collectLines: sem vazias, sem indentação')

  // Inserida acima
  const ins = editLines(LYRICS, l => l.splice(1, 0, 'Uma linha nova inventada'))
  const mIns = remapLines(saved, ins)
  eq([mIns.get(1), mIns.get(2), mIns.get(4), mIns.get(16)], [2, 3, 5, 17], 'inserida: tudo desce uma linha')
  const D = makeLayout(ins, CONCERTO)
  const r = resolveStroke(und, D, mIns)
  const pts = allPts(r)
  const a = D.charRect(3, u0)
  const b = D.charRect(3, u1)
  ok(r.subpaths.length === 1 && pts.every(([x, y]) => x >= a.left - 0.25 * D.em && x <= b.right + 0.25 * D.em && y > a.bottom - 0.01 && y < a.bottom + 0.5 * D.em),
    'inserida: sublinhado debaixo das mesmas palavras (agora na linha 3)', bbox(pts))

  // Removida acima
  const rem = editLines(LYRICS, l => l.splice(1, 1))
  const mRem = remapLines(saved, rem)
  eq([mRem.has(1), mRem.get(2), mRem.get(4)], [false, 1, 3], 'removida: a linha sai do mapa, as outras sobem')
  const rb = resolveStroke(brk, makeLayout(rem, ENSAIO), mRem)
  ok(!rb.hidden && rb.subpaths.length >= 1, 'removida: chaveta com 3 das 4 linhas continua visível')

  // Mudada
  const chg = LYRICS.replace('Há café na mesa', 'Há chá na mesa')
  const mChg = remapLines(saved, chg)
  eq(mChg.has(2), false, 'mudada: sem par')
  const ru = resolveStroke(und, makeLayout(chg, ENSAIO), mChg)
  ok(ru.hidden && ru.subpaths.length === 0, 'mudada: o sublinhado nessa linha fica escondido')
  const rbb = resolveStroke(brk, makeLayout(chg, ENSAIO), mChg)
  ok(!rbb.hidden, 'mudada: a chaveta (1 de 4 linhas perdida) continua visível')

  // Só a indentação mudou: o texto é o mesmo (trim) e c conta do 1.º não branco
  const [p0, p1] = word(S, 8, 'daqui')
  const par = anchorStroke(underline(S, 8, p0, p1), YELLOW, 4, S, 'p')
  const ind = LYRICS.replace('    (leva-me daqui)', '(leva-me daqui)')
  const Di = makeLayout(ind, ENSAIO)
  const rp = resolveStroke(par, Di, remapLines(collectLines([par], LYRICS), ind))
  const q0 = Di.charRect(8, Di.text(8).indexOf('daqui'))
  ok(Math.abs(bbox(allPts(rp)).left - q0.left) < 0.5, 'indentação tirada: o sublinhado continua em "daqui"', [bbox(allPts(rp)).left, q0.left])
})

test('letra editada: refrão repetido fica com a ocorrência certa', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const [c0, c1] = word(S, 16, 'contigo')
  const second = anchorStroke(circle(S, 16, c0, c1), YELLOW, 3, S, '2.º refrão')
  const first = anchorStroke(underline(S, 7, c0, c1), YELLOW, 3, S, '1.º refrão')
  const saved = collectLines([first, second], LYRICS)
  // Linha inserida antes do 1.º refrão: o 2.º refrão vai para a ocorrência mais próxima (17), não para a 8
  const ins = editLines(LYRICS, l => l.splice(3, 0, 'Outra linha inventada'))
  const mIns = remapLines(saved, ins)
  eq([mIns.get(7), mIns.get(16)], [8, 17], 'refrão + inserida: cada ocorrência com a sua')
  // 1.º refrão apagado inteiro: o 2.º sobe para 11 e os traços do 1.º escondem-se
  const del = editLines(LYRICS, l => l.splice(6, 5))
  const mDel = remapLines(saved, del)
  eq([mDel.get(16), mDel.has(7), mDel.get(13)], [11, false, 8], 'refrão apagado: o 2.º refrão fica com os seus traços')
  const D = makeLayout(del, ENSAIO)
  ok(resolveStroke(first, D, mDel).hidden, 'refrão apagado: os traços do refrão apagado ficam escondidos')
  const r2 = resolveStroke(second, D, mDel)
  const w = D.charRect(11, D.text(11).indexOf('contigo') + 3)
  ok(!r2.hidden && insidePolygon(allPts(r2), (w.left + w.right) / 2, (w.top + w.bottom) / 2), 'refrão apagado: o círculo do 2.º refrão continua à volta de "contigo"')
  // Desvio 4: só com "a mesma linha mais próxima" o refrão apagado despejava-se no que ficou
  const nearestOnly = (ln, t, text) => {
    const cur = text.split('\n').map(x => x.trim())
    let best = -1
    cur.forEach((x, j) => { if (x === t && (best < 0 || Math.abs(j - ln) < Math.abs(best - ln))) best = j })
    return best
  }
  eq(nearestOnly(7, saved['7'], del), 11, 'desvio 4: a regra "mais próxima" punha o 1.º refrão (apagado) em cima do 2.º — o defeito')
  // Duas linhas iguais seguidas, uma apagada: só uma fica com par
  const dup = 'Oh oh\nOh oh\nOh oh\nFim inventado'
  const mDup = remapLines({ 0: 'Oh oh', 1: 'Oh oh', 2: 'Oh oh', 3: 'Fim inventado' }, 'Oh oh\nOh oh\nFim inventado')
  eq([...mDup.entries()].sort((a, b) => a[0] - b[0]), [[0, 0], [1, 1], [3, 2]], 'repetidas: 1-para-1, a que sobra fica sem par')
  ok(dup.length > 0, 'repetidas: fixture')
  // Estrofe mudada de sítio (cruza a ordem): a 2.ª passagem encontra-a
  const moved = 'Linha beta inventada\nLinha alfa inventada'
  eq([...remapLines({ 0: 'Linha alfa inventada', 1: 'Linha beta inventada' }, moved).entries()].sort((a, b) => a[0] - b[0]),
    [[0, 1], [1, 0]], 'trocadas de sítio: cada uma encontra a sua')
})

test('rebaseStrokes: numeração nova, órfãos escondidos e de volta', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const und = anchorStroke(underline(S, 2, ...word(S, 2, 'café na mesa')), YELLOW, 4, S, 'u')
  const brk = anchorStroke(bracket(S, [1, 2, 3, 4]), YELLOW, 4, S, 'b')
  const list = [und, brk]
  const saved = collectLines(list, LYRICS)
  const same = rebaseStrokes(list, saved, LYRICS)
  ok(!same.changed && same.strokes[0] === und && same.strokes[1] === brk, 'rebase: letra igual → os mesmos objetos')
  ok(rebaseStrokes(list, null, 'outra coisa').strokes[0] === und, 'rebase: sem registo das linhas → fica como está')
  const ins = editLines(LYRICS, l => l.splice(0, 0, 'Linha nova inventada'))
  const moved = rebaseStrokes(list, saved, ins)
  ok(moved.changed && moved.strokes[0].p[0] === 3, 'rebase: linhas passam para a numeração nova')
  const D = makeLayout(ins, ENSAIO)
  ok(maxDev(resolveStroke(moved.strokes[0], D).subpaths[0], resolveStroke(und, D, remapLines(saved, ins)).subpaths[0]) < 1e-9,
    'rebase: igual a resolver com o mapa')
  // Linha mudada → órfão (escondido, guarda o texto); a letra volta → reaparece
  const chg = LYRICS.replace('Há café na mesa', 'Há chá na mesa')
  const orph = rebaseStrokes(list, saved, chg)
  const u2 = orph.strokes[0]
  ok(u2.lines && u2.lines['2'] === 'Há café na mesa e o sol a entrar', 'rebase: órfão guarda o texto das suas linhas')
  ok(resolveStroke(u2, makeLayout(chg, ENSAIO)).hidden, 'rebase: órfão escondido')
  ok(!orph.strokes[1].lines && orph.strokes[1].p.length < brk.p.length, 'rebase: a chaveta perde só os pontos da linha mudada')
  const enc = decodeAnchored(JSON.parse(JSON.stringify(encodeAnchored(orph.strokes))))
  ok(enc[0].lines && enc[0].lines['2'] === u2.lines['2'], 'rebase: o órfão sobrevive a gravar/ler')
  // Desvio 11: o retrato também se guarda só com órfãos (diz a que linhas o órfão não pode voltar)
  eq(collectLines([u2], chg), Object.fromEntries(chg.split('\n').map((t, i) => [String(i), t.trim()]).filter(([, t]) => t)), 'rebase: só órfãos → payload.lines com o retrato da letra')
  const back = rebaseStrokes(enc, collectLines(enc, chg), LYRICS)
  ok(!back.strokes[0].lines && !resolveStroke(back.strokes[0], S).hidden, 'rebase: a linha volta → o órfão reaparece')
  ok(maxDev(resolveStroke(back.strokes[0], S).subpaths[0], resolveStroke(und, S).subpaths[0]) < 1e-9, 'rebase: … no mesmo sítio')
})

/* ═══ 7. Casos limite ═══ */
test('acima da 1.ª row e abaixo da última, com outro em', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const first = allRows(S)[0]
  const last = allRows(S).at(-1)
  const up = anchorStroke([first.left, first.top - 48, first.right, first.top - 48], YELLOW, 3, S, 'up')
  const dn = anchorStroke([last.left, last.bottom + 64, last.right, last.bottom + 64], YELLOW, 3, S, 'dn')
  eq([up.p[3], up.p[4]], [Y_ABOVE, 1.5], 'acima: em desde o topo da 1.ª row')
  eq([dn.p[3], dn.p[4]], [Y_BELOW, 2], 'abaixo: em desde a base da última row')
  const D = makeLayout(LYRICS, GRANDE)
  ok(Math.abs(resolveStroke(up, D).subpaths[0][1] - (allRows(D)[0].top - 1.5 * D.em)) < 0.01, 'acima: 1.5em acima com o em novo')
  ok(Math.abs(resolveStroke(dn, D).subpaths[0][1] - (allRows(D).at(-1).bottom + 2 * D.em)) < 0.01, 'abaixo: 2em abaixo com o em novo')
  const inside = anchorStroke([S.rows(3)[0].left + 5, (S.rows(3)[0].top + S.rows(3)[0].bottom) / 2], YELLOW, 3, S)
  eq([inside.p[3], inside.p[4]], [Y_IN, 0.5], 'dentro: fração da altura')
})

test('letra vazia, traço de 1 ponto, números não finitos', () => {
  const E = makeLayout('', ENSAIO)
  ok(isLayoutEmpty(E), 'vazia: sem texto onde ancorar')
  eq(anchorStroke([10, 10, 20, 20], YELLOW, 3, E), null, 'vazia: não ancora')
  ok(isLayoutEmpty(makeLayout('  \n\n ', ENSAIO)), 'só espaços: "Sem letra"')
  const S = makeLayout(LYRICS, ENSAIO)
  const a = anchorStroke(underline(S, 2, 3, 6), YELLOW, 3, S, 'x')
  const re = resolveStroke(a, E)
  ok(re.hidden && re.subpaths.length === 0, 'vazia: resolve sem rebentar (escondido)')
  // Sem texto: os traços antigos ficam livres (MODE_FREE), escalados pela largura
  const lf = anchorLegacy({ w: 390, h: 900, strokes: [{ id: 'z', pts: [10, 20, 30, 40], color: YELLOW, width: 3 }] }, E, 780, 50)
  ok(lf.length === 1 && lf[0].mode === MODE_FREE && maxDev(resolveStroke(lf[0], E).subpaths[0], [20, 40, 60, 80]) < 0.01 && Math.abs(resolveStroke(lf[0], E).width - 6) < 0.01,
    'vazia: legado fica livre, escalado só pela largura (a altura guardada era a do aviso "Sem letra")', lf)

  const dotPts = [S.charRect(2, 4).left + 3, S.charRect(2, 4).bottom + 2]
  const dot = anchorStroke(dotPts, YELLOW, 6, S, 'dot')
  eq(dot.p.length, P_STRIDE, 'ponto: um ponto ancorado')
  const rd = resolveStroke(dot, S)
  ok(rd.subpaths.length === 1 && maxDev(rd.subpaths[0], dotPts) <= 0.5, 'ponto: resolve no mesmo sítio')
  ok(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/.test(pathFromSubpaths(rd.subpaths)), 'ponto: caminho de comprimento 0 (desenha um ponto)', pathFromSubpaths(rd.subpaths))
  ok(resolveStroke(dot, makeLayout(LYRICS, ESTREITO)).subpaths.length === 1, 'ponto: noutro layout continua lá')

  const nf = anchorStroke([NaN, 1, 50, Infinity, ...underline(S, 2, 3, 6, { n: 4 }), -Infinity, 3, 'x', 4], YELLOW, NaN, S, 'nf')
  eq(nf.p.length, 4 * P_STRIDE, 'não finitos: só os pontos válidos')
  ok(nf.w > 0 && isFinite(nf.w), 'não finitos: largura inválida → mínima')
  eq(anchorStroke([NaN, NaN, Infinity, 0], YELLOW, 3, S), null, 'não finitos: nenhum válido → null')
  eq(anchorStroke([], YELLOW, 3, S), null, 'sem pontos → null')
  const far = resolveStroke({ ...a, id: 'far', p: [2, 999, 0, 0, 0.5, 0, 2, 999, 0.2, 0, 0.5, 1] }, S)
  const lastC = S.charRect(2, L2last(S))
  ok(far.subpaths.length === 1 && Math.abs(far.subpaths[0][0] - lastC.left) < 0.01, 'c para lá do fim: limitado ao último carácter', far.subpaths)
  const bad = { ...a, p: [2, 3, NaN, 0, 0.5, 0, 2, 4, 0.1, 9, 0.5, 1, ...a.p] }
  const rb = resolveStroke(bad, S)
  ok(rb.subpaths.flat().every(Number.isFinite), 'não finitos no traço: os pontos maus saem, nada de NaN')
  const weird = {
    em: NaN, blockLeft: NaN, blockRight: undefined, centerX: NaN, lines: [0, 1, -1, 1.5, 'x', 1],
    rows: ln => (ln === 0 ? [{ left: 0, top: 0, right: 100, bottom: 20 }, { left: NaN, top: 0, right: 1, bottom: 1 }] : ln === 1 ? null : []),
    text: ln => (ln === 0 ? 'abc' : undefined),
    charRect: (ln, c) => (c === 1 ? { left: NaN, top: 0, right: 5, bottom: 20 } : { left: c * 30, top: 0, right: c * 30 + 30, bottom: 20 }),
  }
  const w = anchorStroke([10, 10, 40, 25, 70, -5], YELLOW, 3, weird, 'w')
  ok(w && w.p.every(Number.isFinite), 'layout com lixo: ancora com números finitos')
  ok(resolveStroke(w, weird).subpaths.flat().every(Number.isFinite), 'layout com lixo: resolve com números finitos')
})

test('migração: traços antigos em px adotados e ancorados', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const pts = underline(S, 2, ...word(S, 2, 'café'))
  // Gravados num bloco com metade da largura/altura (antes de rodar o iPad)
  const old = { w: 390, h: S.height / 2, strokes: [{ id: 'old', pts: pts.map(v => v / 2), color: YELLOW, width: 2 }] }
  const got = anchorLegacy(old, S, 780, S.height)
  eq(got.length, 1, 'migração: um traço')
  const r = resolveStroke(got[0], S)
  ok(maxDev(r.subpaths[0], pts) <= 0.5 && Math.abs(r.width - 4) < 0.05, 'migração: re-escala w/h e ancora no layout atual')
  const noH = anchorLegacy({ w: 390, strokes: old.strokes }, S, 780, 0)
  ok(maxDev(resolveStroke(noH[0], S).subpaths[0], pts) <= 0.5, 'migração: sem h, Y segue o rácio de X')
})

/* ═══ 8. Formato guardado ═══ */
test('encode/decode compacto', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const list = [
    anchorStroke(underline(S, 2, ...word(S, 2, 'café na mesa')), YELLOW, 4, S, 'u'),
    anchorStroke(bracket(S, [1, 2, 3, 4]), '#e5484d', 3, S, 'b'),
    anchorStroke(circle(S, 16, ...word(S, 16, 'contigo'), { padY: 0.32 }), '#3e63dd', 5, S, 'c'),
    anchorStroke(marginNote(S, 13), '#30a46c', 2, S, 'n'),
    anchorStroke(bracket(S, [1, 2, 3, 4]), YELLOW, 3, S, 'r', { marginRows: true }),
  ]
  const json = JSON.stringify(encodeAnchored(list))
  const back = decodeAnchored(JSON.parse(json))
  eq(back, list, 'encode/decode: ida e volta exata')
  ok(/^\[\["u","#f5c400",\d+,0,\[/.test(json), 'encode: arrays numéricos', json.slice(0, 40))
  ok(!/\d\.\d{4,}/.test(json), 'encode: sem casas decimais a mais')
  eq(decodeAnchored(null), [], 'decode: null')
  eq(decodeAnchored([null, 1, 'x', {}, ['id'], ['id', 'c', 1, 7, [], [], [], []], ['id', 'c', 1, 0, [0, 0, 2], [1], [1], [1]],
    ['id', 'c', 1, 0, [0, 99, 1], [1], [1], [1]], ['id', 'c', 1, 0, [0, 0, 1], [1.5], [1], [1]]]), [], 'decode: entradas inválidas descartadas')
  const p = buildPayload({ w: 780.123, h: 2000.55, strokes: toLegacyStrokes(resolveAll(list, S)), em: 32, anchored: list, lyrics: LYRICS })
  eq([p.v, p.em, p.w, p.h], [2, 32, 780.1, 2000.6], 'payload: v2, em, w, h')
  ok(p.strokes.length === list.length && p.strokes.every(s => s.pts.every(Number.isInteger)), 'payload: traços antigos em px (um por caminho)')
  const rp = readPayload(JSON.parse(JSON.stringify(p)))
  eq(rp.anchored, list, 'readPayload: âncoras de volta')
  eq(rp.lines['16'], 'Leva-me contigo, leva-me daqui', 'readPayload: texto das linhas')
  ok(payloadHasStrokes(rp), 'readPayload: tem anotações')
  const legacy = readPayload({ w: 700, strokes: [{ id: 'a', pts: [1, 2, 3, 4], color: '#000', width: 3 }] })
  ok(legacy.anchored === null && legacy.lines === null && payloadHasStrokes(legacy), 'readPayload: payload antigo → sem âncoras, mas com traços')
  ok(readPayload([{ id: 'a', pts: [1, 2], color: '#000', width: 3 }]).strokes.length === 1, 'readPayload: array muito antigo')
  ok(!payloadHasStrokes(readPayload({ w: 1, strokes: [{ id: 'a', pts: [1, 2] }], v: 2, anchored: [] })), 'readPayload: v2 sem âncoras = nada (os traços antigos são a cópia)')
  eq([readPayload(null), readPayload('x'), readPayload(3)], [null, null, null], 'readPayload: lixo → null')
})

test('tamanho: 40 traços × 150 pontos', () => {
  const lines = []
  for (let k = 0; k < 20; k++) lines.push(`[Verso ${k + 1}]`, `Linha ${k} do mar e da luz inventada`, `Outra linha ${k} sem pressa de acabar`, `E mais uma ${k} para o caderno`, '')
  const text = lines.join('\n')
  const S = makeLayout(text, ENSAIO)
  const list = []
  for (let s = 0; s < 40; s++) {
    const ln = 1 + (s % 20) * 5 + (s % 3)
    const [v0, v1] = visible(S, ln)
    const pts = s % 4 === 0 ? bracket(S, [ln, ln + 1], { n: 150 })
      : s % 4 === 1 ? circle(S, ln, v0 + 2, v0 + 8, { n: 149 })
        : underline(S, ln, v0, v1, { n: 150, wob: 0.08 })
    list.push(anchorStroke(pts, YELLOW, 4, S, `id-${s}-0123456789abcdef`))
  }
  ok(list.every(a => a.p.length === 150 * P_STRIDE), 'tamanho: 150 pontos por traço')
  const p = buildPayload({ w: 780, h: S.height, strokes: toLegacyStrokes(resolveAll(list, S)), em: 32, anchored: list, lyrics: text })
  const bytes = Buffer.byteLength(JSON.stringify(p))
  const anchoredBytes = Buffer.byteLength(JSON.stringify(p.anchored))
  if (verbose) console.log(`   payload ${(bytes / 1024).toFixed(1)}KB (âncoras ${(anchoredBytes / 1024).toFixed(1)}KB)`)
  ok(bytes < 120 * 1024, `tamanho: payload completo < 120KB (${(bytes / 1024).toFixed(1)}KB)`, bytes)
})

/* ═══ 9. Desempenho ═══ */
test('desempenho: 80 linhas e 40 traços resolvem em < 16ms; medição preguiçosa', () => {
  const lines = []
  for (let k = 0; k < 16; k++) lines.push(`[Parte ${k + 1}]`, `Linha ${k} do mar e da luz inventada`, `Outra linha ${k} sem pressa de acabar`, `E mais uma ${k} para o caderno`, '')
  const text = lines.join('\n')
  ok(text.split('\n').length === 80, 'desempenho: 80 linhas')
  const S = makeLayout(text, ENSAIO)
  const list = []
  for (let s = 0; s < 40; s++) {
    const ln = 1 + (s % 16) * 5 + (s % 3)
    const [v0, v1] = visible(S, ln)
    list.push(anchorStroke(s % 3 ? underline(S, ln, v0, v1, { n: 150 }) : circle(S, ln, v0 + 1, v0 + 6, { n: 149 }), YELLOW, 4, S, `p${s}`))
  }
  let best = Infinity
  let calls = null
  for (let run = 0; run < 7; run++) {
    const D = makeLayout(text, CONCERTO)   // objeto novo: sem cache
    const t0 = performance.now()
    const res = resolveAll(list, D)
    best = Math.min(best, performance.now() - t0)
    if (res.some(r => r.hidden)) best = Infinity
    calls = D.calls
  }
  ok(best < 16, `desempenho: resolver ${best.toFixed(2)}ms`, best)
  const distinct = new Set(list.flatMap(a => { const k = []; for (let o = 0; o < a.p.length; o += P_STRIDE) k.push(`${a.p[o]}:${a.p[o + 1]}`); return k })).size
  ok(calls.chars <= distinct, 'desempenho: cada carácter usado medido uma vez', [calls.chars, distinct])
  ok(calls.rows <= 80, 'desempenho: rows medidas uma vez por linha', calls.rows)
  // Um traço curto num layout novo só mede os seus caracteres (não a linha toda)
  const one = anchorStroke(underline(S, 2, 0, 3, { n: 30 }), YELLOW, 4, S, 'curto')
  const F = makeLayout(text, CONCERTO)
  resolveStroke(one, F)
  ok(F.calls.chars <= 4, 'desempenho: traço curto mede só os seus 4 caracteres', F.calls.chars)
  // Cache: o mesmo layout + o mesmo traço → o mesmo resultado, sem recalcular
  const D = makeLayout(text, CONCERTO)
  const r1 = resolveAll(list, D)
  const n1 = D.calls.chars
  const r2 = resolveAll(list, D)
  ok(r1.every((r, i) => r === r2[i]) && D.calls.chars === n1, 'desempenho: memo por layout')
  let t = performance.now()
  for (let s = 0; s < 40; s++) anchorStroke(underline(S, 1 + (s % 16) * 5, 0, 20, { n: 150 }), YELLOW, 4, makeLayout(text, ENSAIO))
  t = performance.now() - t
  ok(t / 40 < 16, `desempenho: ancorar ${(t / 40).toFixed(2)}ms por traço (layout novo de cada vez)`, t / 40)
})

/* ═══ 10. Desenho, borracha, ajudas do DOM ═══ */
test('caminho SVG e borracha', () => {
  eq(smoothPath([]), '', 'path: vazio')
  eq(smoothPath([1, 2, 3, 4]), 'M 1 2 L 3 4', 'path: 2 pontos')
  ok(smoothPath([0, 0, 10, 10, 20, 0, 30, 10]).includes('Q'), 'path: curvas')
  const d = pathFromSubpaths([[0, 0, 10, 10, 20, 0], [30, 0, 40, 0]])
  eq((d.match(/M/g) || []).length, 2, 'path: um M por caminho')
  ok(!/\d\.\d{3,}/.test(smoothPath([1 / 3, 2 / 3, 5 / 7, 1 / 9])), 'path: 2 casas decimais')
  const S = makeLayout(LYRICS, ENSAIO)
  const list = resolveAll([
    anchorStroke(underline(S, 2, 3, 12), YELLOW, 4, S, 'u'),
    anchorStroke(bracket(S, [1, 2, 3, 4]), YELLOW, 4, S, 'b'),
  ], S)
  const [ux, uy] = list[0].subpaths[0]
  eq(strokesAt(list, ux + 3, uy + 3, 18), ['u'], 'borracha: perto do sublinhado → só esse')
  eq(strokesAt(list, S.centerX, -500, 18), [], 'borracha: longe → nada')
  ok(hitSubpaths([[0, 0, 100, 0]], 50, 10, 12), 'borracha: entre dois pontos (segmento)')
  ok(!hitSubpaths([[0, 0, 100, 0]], 50, 30, 12), 'borracha: fora do raio')
  ok(hitSubpaths([[5, 5]], 8, 9, 6), 'borracha: ponto isolado')
  ok(!strokesAt([{ ...list[0], hidden: true }], ux, uy, 18).length, 'borracha: escondidos não se apagam')
})

test('mergeRowRects / pickCharRect', () => {
  const rows = mergeRowRects([
    { left: 10, top: 0, right: 50, bottom: 20 },
    { left: 50, top: 1, right: 90, bottom: 21 },   // mesma linha de ecrã (outro fragmento)
    { left: 90, top: 0, right: 90, bottom: 20 },   // espaço colapsado (largura 0)
    { left: 20, top: 30, right: 70, bottom: 50 },
    { left: NaN, top: 0, right: 1, bottom: 1 },
  ])
  eq(rows, [{ left: 10, top: 0, right: 90, bottom: 21 }, { left: 20, top: 30, right: 70, bottom: 50 }], 'mergeRowRects: 2 rows')
  eq(mergeRowRects([]), [], 'mergeRowRects: vazio')
  eq(pickCharRect([{ left: 0, top: 0, right: 0, bottom: 10 }, { left: 0, top: 20, right: 8, bottom: 30 }]), { left: 0, top: 20, right: 8, bottom: 30 }, 'pickCharRect: o mais largo')
  eq(pickCharRect([]), null, 'pickCharRect: nenhum')
})

/* ═══ 11. Revisão: notas no intervalo, círculos largos, calha, órfãos, folha sem letra, formato ═══ */
// Concerto do tablet como o ConcertPage o monta (tema 32 × 1.45 ≈ 46px, até 900px)
const CONCERTO46 = { em: 46, lh: 1.6, width: 900 }

/** Nota "x2" em zigue-zague (px) com o topo `off` em abaixo da linha e `h` em de altura */
function gapNote(L, ln, { off = 0.25, h = 0.55, n = 30, below = true } = {}) {
  const rs = L.rows(ln)
  const r = below ? rs[rs.length - 1] : rs[0]
  const cx = (r.left + r.right) / 2
  const y0 = below ? r.bottom + off * L.em : r.top - (off + h) * L.em
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push(cx - 0.6 * L.em + t * 1.2 * L.em, y0 + (i % 2 ? 0 : h * L.em) * (0.5 + 0.5 * Math.sin(t * 6)))
  }
  return pts
}
const ysOf = res => allPts(res).map(p => p[1])
const xsOf = res => allPts(res).map(p => p[0])

test('desvio 8: nota no intervalo entre estrofes não se achata quando o verso re-quebra', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const pts = gapNote(S, 4)
  const h0 = Math.max(...pairs(pts).map(p => p[1])) - Math.min(...pairs(pts).map(p => p[1]))
  const a = anchorStroke(pts, YELLOW, 3, S, 'x2')
  eq(a.mode, MODE_GAP, 'nota entre estrofes: modo intervalo')
  ok(a.p.every((v, i) => i % P_STRIDE !== 0 || v === 4), 'nota: presa à linha 4 (a de cima do intervalo)')
  const literal = anchorStroke(pts, YELLOW, 3, S, 'x2-lit', { noGap: true })
  eq(literal.mode, MODE_TEXT, 'sem o desvio 8: modo texto')
  for (const [name, cfg] of Object.entries({ CONCERTO46, ESTREITO, TELEMOVEL, GRANDE })) {
    const D = makeLayout(LYRICS, cfg)
    const rows4 = D.rows(4)
    if (name !== 'GRANDE') eq(rows4.length >= 2, true, `${name}: a linha 4 re-quebra (pré-condição)`)
    const r = resolveStroke(a, D)
    eq(r.subpaths.length, 1, `${name}: nota num só caminho`)
    const ys = ysOf(r)
    const h = Math.max(...ys) - Math.min(...ys)
    const want = h0 * D.em / S.em
    ok(Math.abs(h - want) <= 0.2 * want, `${name}: nota mantém a altura (±20%)`, [h, want])
    const lastBottom = rows4[rows4.length - 1].bottom
    const next = D.rows(6)[0].top
    ok(ys.every(y => y > lastBottom - 0.01 && y < next), `${name}: nota toda abaixo da última row do verso e acima do rótulo`, [Math.min(...ys), Math.max(...ys), lastBottom, next])
    // X: preso a um carácter do verso (fica por baixo dele, dentro do bloco)
    const xs = xsOf(r)
    ok(Math.min(...xs) >= D.blockLeft && Math.max(...xs) <= D.blockRight, `${name}: nota dentro do bloco`)
  }
  // O defeito do modo texto: no concerto a nota cai no intervalo pequeno dentro do verso
  const D = makeLayout(LYRICS, CONCERTO46)
  const lit = resolveStroke(literal, D)
  const ly = ysOf(lit)
  ok(Math.max(...ly) - Math.min(...ly) < 0.2 * h0 * D.em / S.em || Math.min(...ly) < D.rows(4)[1].top,
    'modo texto (literal): a nota achata-se / cai dentro do verso — o defeito', [Math.min(...ly), Math.max(...ly), D.rows(4).map(r => [r.top, r.bottom])])
})

test('desvio 8: nota abaixo da última linha e acima da 1.ª, com a linha re-quebrada', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const fim = gapNote(S, 18, { off: 0.6, h: 0.9 })
  const topo = gapNote(S, 0, { off: 0.4, h: 0.6, below: false })
  const a = anchorStroke(fim, YELLOW, 3, S, 'fim')
  const b = anchorStroke(topo, YELLOW, 3, S, 'topo')
  eq([a.mode, b.mode], [MODE_GAP, MODE_GAP], 'FIM e nota no topo: modo intervalo')
  for (const [name, cfg] of Object.entries({ ESTREITO, TELEMOVEL })) {
    const D = makeLayout(LYRICS, cfg)
    eq(D.rows(18).length >= 2, true, `${name}: a última linha re-quebra (pré-condição)`)
    const ra = resolveStroke(a, D)
    const last = D.rows(18)[D.rows(18).length - 1]
    const ya = ysOf(ra)
    ok(ra.subpaths.length === 1 && ya.every(y => y > last.bottom + 0.5 * D.em), `${name}: FIM continua abaixo da última row`, [Math.min(...ya), last.bottom])
    const ha = Math.max(...ya) - Math.min(...ya)
    ok(Math.abs(ha - 0.9 * D.em * 0.75) <= 0.35 * D.em, `${name}: FIM mantém a altura`, [ha, D.em])
    const rb = resolveStroke(b, D)
    ok(ysOf(rb).every(y => y < D.rows(0)[0].top), `${name}: nota do topo continua acima da 1.ª row`)
  }
  // Um sublinhado (perto da row, nunca a mais de 0.5em) continua em modo texto
  eq(anchorStroke(underline(S, 4, ...visible(S, 4), { off: 0.3 }), YELLOW, 3, S).mode, MODE_TEXT, 'sublinhado a 0.3em no intervalo grande: modo texto')
})

test('desvio 9: círculo largo cujo topo entra na linha de cima fica à volta da palavra', () => {
  const LYR = [
    'Caminho pela praia ao fim da tarde muito azul',   // 0 (longa: re-quebra no concerto)
    'Levo conchas no bolso',                          // 1
    'Volto a casa quando a lua se acender',           // 2
  ].join('\n')
  const S = makeLayout(LYR, ENSAIO)
  const [c0, c1] = word(S, 1, 'conchas')
  for (const padY of [0.45, 0.55]) {
    const pts = circle(S, 1, c0, c1, { padY, padX: 0.3 })
    ok(Math.min(...pairs(pts).map(p => p[1])) < S.rows(0)[S.rows(0).length - 1].bottom, `padY ${padY}: o topo entra na caixa da linha 0 (pré-condição)`)
    const a = anchorStroke(pts, YELLOW, 3, S, 'o')
    eq(a.mode, MODE_TEXT, `padY ${padY}: modo texto`)
    ok(a.p.every((v, i) => i % P_STRIDE !== 0 || v === 1), `padY ${padY}: todos os pontos presos à linha 1 (a da palavra)`)
    const back = resolveStroke(a, S)
    ok(back.subpaths.length === 1 && maxDev(back.subpaths[0], pts) <= 0.5, `padY ${padY}: identidade ±0.5px`, maxDev(back.subpaths[0] ?? [], pts))
    const lit = anchorStroke(pts, YELLOW, 3, S, 'o2', { perRowExcursions: true })
    for (const [name, cfg] of Object.entries({ CONCERTO46, TELEMOVEL })) {
      const D = makeLayout(LYR, cfg)
      eq(D.rows(0).length >= 2, true, `${name}: a linha de cima re-quebra (pré-condição)`)
      const w0 = D.charRect(1, c0)
      const w1 = D.charRect(1, c1)
      const r = resolveStroke(a, D)
      const bb = bbox(allPts(r))
      ok(r.subpaths.length === 1 && bb.left >= w0.left - D.em && bb.right <= w1.right + D.em, `${name} (padY ${padY}): o círculo fica à volta de "conchas"`, [bb, w0.left, w1.right])
      let enclosed = true
      for (let c = c0; c <= c1; c++) {
        const b = D.charRect(1, c)
        if (!insidePolygon(allPts(r), (b.left + b.right) / 2, (b.top + b.bottom) / 2)) enclosed = false
      }
      ok(enclosed, `${name} (padY ${padY}): a palavra fica dentro do círculo`)
      ok(bbox(allPts(r)).top < D.rows(1)[0].top, `${name} (padY ${padY}): o topo continua acima da palavra`)
      if (name === 'CONCERTO46' && padY === 0.55) {
        const lb = bbox(allPts(resolveStroke(lit, D)))
        ok(lb.right > w1.right + D.em, 'sem o desvio 9: o topo foge para o lado — o defeito', [lb.right, w1.right])
      }
    }
  }
})

test('desvio 10: chaveta empurrada para dentro do bloco → calha lateral, sem tocar no texto', () => {
  const LYR = [
    'Caminho pela praia ao fim da tarde azul',   // 39
    'Levo no bolso as conchas que apanhei ao',   // 39
    'O vento sopra forte e eu sigo sem pressa',  // 40
    'Volto a casa quando a lua se acende já',    // 38
  ].join('\n')
  const S = makeLayout(LYR, ENSAIO)
  const rs = [0, 1, 2, 3].flatMap(ln => S.rows(ln))
  const top = Math.min(...rs.map(r => r.top))
  const bottom = Math.max(...rs.map(r => r.bottom))
  const x0 = Math.min(...rs.map(r => r.left)) - 0.3 * S.em
  const pts = []
  for (let i = 0; i < 60; i++) { const t = i / 59; pts.push(x0 - 0.25 * S.em * Math.pow(1 - Math.abs(2 * t - 1), 3), top + t * (bottom - top)) }
  const a = anchorStroke(pts, YELLOW, 3, S, 'chaveta')
  eq(a.mode, MODE_MARGIN, 'chaveta: modo margem')
  ok(marginGutter([resolveStroke(a, S)], S) === 0, 'no Ensaio onde se desenhou: sem calha')
  const textLeft = (L, list) => Math.min(...[0, 1, 2, 3].flatMap(ln => L.rows(ln)).map(r => r.left))
  for (const cfg of [CONCERTO46, TELEMOVEL, ESTREITO]) {
    const D0 = makeLayout(LYR, cfg)
    const r0 = resolveStroke(a, D0)
    eq(r0.edge, 1, `em ${cfg.em}/${cfg.width}: a chaveta vinha de fora (empurrada para dentro)`)
    const bb0 = bbox(allPts(r0))
    if (cfg !== ESTREITO) ok(bb0.right + r0.width / 2 > textLeft(D0), `em ${cfg.em}/${cfg.width}: sem calha a chaveta passa por cima das letras (o defeito)`, [bb0.right, textLeft(D0)])
    const g = marginGutter([r0], D0)
    ok(g > 0 && g <= 0.2 * cfg.width + 0.5, `em ${cfg.em}/${cfg.width}: calha de ${g}px`, g)
    const D1 = makeLayout(LYR, { ...cfg, pad: g })
    const r1 = resolveStroke(a, D1)
    const bb1 = bbox(allPts(r1))
    ok(maxDev(allPts(r1).map(p => p[0]), allPts(r0).map(p => p[0])) < 1e-9, `em ${cfg.em}/${cfg.width}: o X da chaveta não muda com a calha`)
    eq(marginGutter([r1], D1), g, `em ${cfg.em}/${cfg.width}: a calha volta a dar o mesmo valor (sem ciclo)`)
    ok(bb1.right + r1.width / 2 < textLeft(D1), `em ${cfg.em}/${cfg.width}: com a calha a chaveta fica à esquerda do texto`, [bb1.right + r1.width / 2, textLeft(D1)])
    ok(bb1.left - r1.width / 2 >= D1.blockLeft - 0.01, `em ${cfg.em}/${cfg.width}: a tinta não sai do bloco`)
    const t = D1.rows(0)[0].top
    const lastRows = D1.rows(3)
    ok(Math.abs(bb1.top - t) <= 0.3 * D1.em && Math.abs(bb1.bottom - lastRows[lastRows.length - 1].bottom) <= 0.3 * D1.em, `em ${cfg.em}/${cfg.width}: do topo da 1.ª linha à base da 4.ª`)
  }
  // Nota à margem perto do centro (cabe no bloco) não pede calha
  const SL = makeLayout(LYRICS, ENSAIO)
  const note = anchorStroke(marginNote(SL, 13), YELLOW, 3, SL, 'nota')
  const G = makeLayout(LYRICS, GRANDE)
  eq(marginGutter([resolveStroke(note, G)], G), 0, 'margem que cabe: sem calha')
})

test('desvio 11: órfão de um refrão apagado não reaparece no refrão que ficou', () => {
  const V1 = ['[Verso 1]', 'Acordo cedo com o rio a passar', 'Há café na mesa e o sol a entrar', '']
  const R = ['[Refrão]', 'Leva-me contigo, leva-me daqui', 'Leva-me contigo até ao fim da linha', '']
  const V2 = ['[Verso 2]', 'Os dias passam devagar', 'E eu fico à janela a ver', '']
  const before = [...V1, ...R, ...V2, ...R].join('\n')
  const after = [...V1, ...V2, ...R].join('\n')   // 1.º refrão apagado no Editar
  const E0 = makeLayout(before, ENSAIO)
  const s1 = anchorStroke(underline(E0, 5, ...word(E0, 5, 'daqui')), YELLOW, 3, E0, 'r1')    // só no 1.º refrão
  const s2 = anchorStroke(underline(E0, 13, ...word(E0, 13, 'contigo')), YELLOW, 3, E0, 'r2') // só no 2.º
  // Gravar e ler como o AnnotationLayer (buildPayload → JSON → readPayload)
  const save = (strokes, lyrics) => {
    const L = makeLayout(lyrics, ENSAIO)
    return readPayload(JSON.parse(JSON.stringify(buildPayload({ w: 780, h: L.height, strokes: toLegacyStrokes(resolveAll(strokes, L)), em: 32, anchored: strokes, lyrics }))))
  }
  let p = save([s1, s2], before)
  const load1 = rebaseStrokes(p.anchored, p.lines, after)
  ok(load1.changed && load1.strokes[0].lines && !load1.strokes[1].lines && load1.strokes[1].p[0] === 9, 'carregamento 1: r1 órfão, r2 na linha 9')
  p = save(load1.strokes, after)
  const load2 = rebaseStrokes(p.anchored, p.lines, after)
  ok(!load2.changed && load2.strokes[0].lines, 'carregamento 2: r1 continua órfão (não cai no refrão que ficou)', load2.strokes.map(s => s.lines ? 'órfão' : s.p[0]))
  ok(resolveAll(load2.strokes, makeLayout(after, CONCERTO)).filter(r => !r.hidden).length === 1, 'carregamento 2: só um traço visível no concerto')
  // Também só com órfãos no payload
  p = save([load1.strokes[0]], after)
  ok(rebaseStrokes(p.anchored, p.lines, after).strokes[0].lines, 'só órfãos: continua órfão no carregamento seguinte')
  // O refrão volta a ser inserido → o órfão volta para ele
  p = save(load2.strokes, after)
  const back = rebaseStrokes(p.anchored, p.lines, before)
  ok(back.changed && !back.strokes[0].lines && back.strokes[0].p[0] === 5 && back.strokes[1].p[0] === 13, 'refrão reinserido: o órfão volta ao 1.º refrão', back.strokes.map(s => s.lines ? 'órfão' : s.p[0]))
  // Uma só ocorrência de uma linha repetida mudada: o traço dela não salta para a outra
  const changed1 = before.replace('Leva-me contigo, leva-me daqui', 'Leva-me contigo, leva-me já')
  p = save([s1, s2], before)
  const c1 = rebaseStrokes(p.anchored, p.lines, changed1)
  p = save(c1.strokes, changed1)
  const c2 = rebaseStrokes(p.anchored, p.lines, changed1)
  ok(c1.strokes[0].lines && c2.strokes[0].lines, 'ocorrência mudada: o traço fica órfão nos dois carregamentos', c2.strokes.map(s => s.lines ? 'órfão' : s.p[0]))
})

test('folha sem letra (MODE_FREE): traços livres escalam com a largura', () => {
  const E = makeLayout('', { ...ENSAIO, width: 600 })
  ok(isLayoutEmpty(E), 'sem letra: layout vazio')
  const pts = [100, 50, 140, 90, 200, 300]
  const a = anchorFree(pts, YELLOW, 4, E, 'livre')
  eq(a.mode, MODE_FREE, 'livre: modo livre')
  const r = resolveStroke(a, E)
  ok(!r.hidden && maxDev(r.subpaths[0], pts) <= 0.01 && Math.abs(r.width - 4) < 0.01, 'livre: identidade', r)
  const W = makeLayout('', { ...ENSAIO, width: 900, left: 30 })
  const rw = resolveStroke(a, W)
  ok(maxDev(rw.subpaths[0], pts.map((v, i) => (i % 2 ? v * 1.5 : 30 + v * 1.5))) <= 0.02 && Math.abs(rw.width - 6) < 0.01, 'livre: escala com a largura do bloco (sem deformar)', rw.subpaths[0])
  ok(!resolveStroke(a, makeLayout(LYRICS, ENSAIO)).hidden, 'livre: continua visível se a letra aparecer')
  const rb = rebaseStrokes([a], { 0: 'Linha inventada' }, 'Outra coisa')
  ok(!rb.changed && rb.strokes[0] === a, 'livre: a letra editada não lhe mexe')
  eq(decodeAnchored(JSON.parse(JSON.stringify(encodeAnchored([a])))), [a], 'livre: encode/decode exato')
  eq(collectLines([a], LYRICS), {}, 'livre: sem retrato das linhas')
  eq(anchorFree([NaN, 1], YELLOW, 3, E), null, 'livre: sem pontos válidos → null')
})

test('formato: entradas de uma versão futura e "por juntar" sobrevivem a ler/gravar', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const u = anchorStroke(underline(S, 2, 3, 12), YELLOW, 4, S, 'u')
  const future = ['f1', '#ff0000', 3000, 9, [0, 0, 1], [0], [0], [0], { novo: true }]
  const futureCode = ['f2', '#00ff00', 3000, 0, [2, 40, 1], [0], [0], [0]]
  const raw = { w: 780, h: 900, strokes: [], v: 2, anchored: [...encodeAnchored([u]), future, futureCode, ['lixo'], 7], lines: collectLines([u], LYRICS), pend: 1 }
  const p = readPayload(JSON.parse(JSON.stringify(raw)))
  eq(p.anchored.map(s => s.id), ['u'], 'futuro: só o traço conhecido é desenhado')
  eq(p.extra, [future, futureCode], 'futuro: modo e código desconhecidos guardados em bruto (lixo sai)')
  ok(p.pend === true, 'pend: lido')
  const again = buildPayload({ w: 780, h: 900, strokes: [], em: 32, anchored: p.anchored, lyrics: LYRICS, extra: p.extra, pend: p.pend })
  eq(again.anchored.slice(1), [future, futureCode], 'futuro: reescritas tal como vieram')
  eq(again.pend, 1, 'pend: gravado')
  eq(buildPayload({ w: 1, h: 1, strokes: [], em: 32, anchored: [], lyrics: '' }).pend, undefined, 'pend: só quando pedido')
  eq(decodeAnchoredParts(raw.anchored).strokes.length, 1, 'decodeAnchoredParts: um traço')
  const v = anchorStroke(underline(S, 3, 3, 12), YELLOW, 4, S, 'v')
  eq(unionById([u], [u, v]).map(s => s.id), ['u', 'v'], 'unionById: sem repetidos, a base primeiro')
  eq(unionExtra([future], [future, futureCode]).map(e => e[0]), ['f1', 'f2'], 'unionExtra: sem repetidos')
})

test('payloadHasVisible: os órfãos não contam (tecla do concerto)', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const u = anchorStroke(underline(S, 2, ...visible(S, 2)), YELLOW, 3, S, 'u')
  const save = lyrics => readPayload(JSON.parse(JSON.stringify(buildPayload({ w: 780, h: 900, strokes: [], em: 32, anchored: [u], lyrics }))))
  const p = save(LYRICS)
  ok(payloadHasVisible(p, LYRICS), 'visível com a letra onde se desenhou')
  const edited = LYRICS.split('\n').map((l, i) => (i === 2 ? 'Linha inventada que substitui a outra' : l)).join('\n')
  ok(payloadHasStrokes(p) && !payloadHasVisible(p, edited), 'a linha do único traço mudou: órfão → nada visível (payloadHasStrokes continua a contá-lo)')
  // Depois de o Ensaio gravar o órfão (com o texto das suas linhas), continua invisível; e volta com a letra
  const r = rebaseStrokes(p.anchored, p.lines, edited)
  const p2 = readPayload(JSON.parse(JSON.stringify(buildPayload({ w: 780, h: 900, strokes: [], em: 32, anchored: r.strokes, lyrics: edited }))))
  ok(!payloadHasVisible(p2, edited) && payloadHasVisible(p2, LYRICS), 'órfão gravado: invisível com a letra editada, visível se a linha voltar')
  ok(payloadHasVisible({ w: 1, strokes: [{ id: 'x', pts: [1, 2, 3, 4], color: YELLOW, width: 3 }], anchored: null, lines: null, extra: [], pend: false }, ''), 'antigo (px): conta os traços')
  ok(!payloadHasVisible(null, LYRICS), 'sem payload: nada')
})

/* ═══ 12. Marcador (highlighter) ═══ */
const PINK = '#ff5faf'
const GREEN = '#5ce65c'
const BLUE = '#3db8ff'
/** Centro da caixa de um carácter */
function center(L, ln, c) {
  const b = L.charRect(ln, c)
  return [(b.left + b.right) / 2, (b.top + b.bottom) / 2]
}
/** Índice de `w` na linha (a k-ésima ocorrência) */
function at(L, ln, w, k = 0) {
  let i = -1
  for (let j = 0; j <= k; j++) i = L.text(ln).indexOf(w, i + 1)
  if (i < 0) throw new Error(`"${w}" não está na linha ${ln}`)
  return i
}
const leadOfText = t => t.length - t.replace(/^\s+/, '').length
/** Gesto do marcador do centro de um carácter ao centro de outro (pode mudar de linha) */
function sweep(L, [ln0, c0], [ln1, c1], { n = 24, wob = 0.05 } = {}) {
  const [x0, y0] = center(L, ln0, c0)
  const [x1, y1] = center(L, ln1, c1)
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push(x0 + t * (x1 - x0), y0 + t * (y1 - y0) + Math.sin(t * 11) * wob * L.em)
  }
  return pts
}
/** Destaque exatamente de `phrase` (palavras inteiras) na linha */
function mk(L, ln, phrase, color, id, k = 0) {
  const i = at(L, ln, phrase, k)
  return highlightRange(sweep(L, [ln, i], [ln, i + phrase.length - 1]), color, L, id)[0]
}
/** Vertical na margem esquerda das linhas dadas */
function marginBar(L, lns, { gapEm = 1.2, n = 30 } = {}) {
  const rs = lns.flatMap(ln => L.rows(ln))
  const x = Math.min(...rs.map(r => r.left)) - gapEm * L.em
  const top = Math.min(...rs.map(r => r.top))
  const bottom = Math.max(...rs.map(r => r.bottom))
  const pts = []
  for (let i = 0; i < n; i++) pts.push(x + Math.sin(i) * 2, top + ((bottom - top) * i) / (n - 1))
  return pts
}
/** Gravar e ler como o AnnotationLayer (buildPayload → JSON → readPayload) */
function saveLoad(items, lyrics, cfg = ENSAIO) {
  const L = makeLayout(lyrics, cfg)
  return readPayload(JSON.parse(JSON.stringify(buildPayload({
    w: cfg.width, h: L.height, strokes: toLegacyStrokes(resolveAll(items, L), resolveHighlights(items, L)), em: L.em, anchored: items, lyrics,
  }))))
}
/** Caixa esperada de cada row de um destaque (calculada à parte, só com o layout fictício) */
function rowsOfRange(L, h) {
  const lead = leadOfText(L.text(h.ln))
  const rs = L.rows(h.ln)
  const per = new Map()
  for (let c = lead + h.c0; c < lead + h.c1; c++) {
    const b = L.charRect(h.ln, c)
    if (!b || b.right <= b.left) continue
    const ri = rs.findIndex(r => r.top <= b.top + 0.01 && r.bottom >= b.bottom - 0.01)
    const cur = per.get(ri) ?? { left: Infinity, right: -Infinity, top: rs[ri].top, bottom: rs[ri].bottom }
    cur.left = Math.min(cur.left, b.left)
    cur.right = Math.max(cur.right, b.right)
    per.set(ri, cur)
  }
  return [...per.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1])
}

test('marcador: arrasto numa linha ajusta a palavras inteiras', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const a = at(S, 2, 'café') + 2   // a meio de "café"
  const b = at(S, 2, 'mesa') + 1   // a meio de "mesa"
  const pts = sweep(S, [2, a], [2, b])
  eq(classifyHighlight(pts, S), 'text', 'palavras: o gesto em cima do texto é um destaque')
  const hs = highlightRange(pts, YELLOW, S, 'h')
  eq(hs.map(h => [h.id, h.mode, h.ln, h.c0, h.c1, h.t]), [['h', MODE_HL_TEXT, 2, at(S, 2, 'café'), at(S, 2, 'café') + 12, 'café na mesa']],
    'palavras: de "café" a "mesa", inteiras, mesmo começando e acabando a meio')
  eq(highlightRange(sweep(S, [2, b], [2, a]), YELLOW, S).map(h => h.t), ['café na mesa'], 'palavras: ao contrário dá o mesmo')
  const back = [...sweep(S, [2, a], [2, b]), ...sweep(S, [2, b], [2, at(S, 2, 'na')])]
  eq(highlightRange(back, YELLOW, S).map(h => h.t), ['café na mesa'], 'palavras: vai-e-vem numa linha cobre tudo o que tocou')
  const d = at(S, 8, 'daqui')
  const h8 = highlightRange(sweep(S, [8, d + 1], [8, d + 3]), YELLOW, S)
  eq(h8.map(h => [h.c0, h.t]), [[at(S, 8, 'daqui') - 4, 'daqui)']], 'palavras: linha indentada — c0 conta do 1.º não branco (pontuação colada fica)')
  const r = anchorHighlight(pts, YELLOW, S, 'x')
  ok(r && r.ink === null && r.marks.length === 1 && r.marks[0].id === 'x', 'anchorHighlight: destaque, sem traço', r)
  ok(isTextHighlight(r.marks[0]) && !isTextHighlight(anchorStroke(pts, YELLOW, 3, S)), 'isTextHighlight distingue destaque de traço')
})

test('marcador: toque curto destaca a palavra; fora do texto não faz nada', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const c = at(S, 3, 'chaves') + 2
  const [x, y] = center(S, 3, c)
  eq(classifyHighlight([x, y], S), 'text', 'toque: em cima de uma palavra')
  eq(highlightRange([x, y], YELLOW, S).map(h => h.t), ['chaves'], 'toque: a palavra inteira')
  const j = 0.1 * S.em
  eq(highlightRange([x, y, x + j, y + j / 2, x - j / 2, y], YELLOW, S).map(h => h.t), ['chaves'], 'toque com tremor (< 0.3em): a mesma palavra')
  const sp = at(S, 3, ' chaves')
  const [sx, sy] = center(S, 3, sp)
  const onSpace = highlightRange([sx, sy], YELLOW, S).map(h => h.t)
  ok(onSpace.length === 1 && (onSpace[0] === 'as' || onSpace[0] === 'chaves'), 'toque no espaço: a palavra mais próxima', onSpace)
  const row = S.rows(3)[0]
  ok(row.left - S.blockLeft > 0.6 * S.em + 5, 'pré-condição: margem à esquerda da linha 3')
  eq(classifyHighlight([S.blockLeft + 5, (row.top + row.bottom) / 2], S), null, 'toque na margem: nada')
  eq(anchorHighlight([S.blockLeft + 5, (row.top + row.bottom) / 2], YELLOW, S), null, 'toque na margem: anchorHighlight null')
  const lab = S.rows(6)[0]
  const tl = highlightRange([(lab.left + lab.right) / 2, (lab.top + lab.bottom) / 2], YELLOW, S)
  eq(tl.map(h => [h.ln, h.t]), [[6, 'REFRÃO']], 'toque no rótulo de secção: o rótulo')
  eq(classifyHighlight([], S), null, 'sem pontos: nada')
  eq(classifyHighlight([NaN, 1, 2, Infinity], S), null, 'pontos não finitos: nada')
})

test('marcador: arrasto por 2 e 3 linhas tem a semântica de uma seleção de texto', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const two = highlightRange(sweep(S, [1, at(S, 1, 'rio') + 1], [2, at(S, 2, 'sol') + 1], { n: 40 }), PINK, S, 'm')
  eq(two.map(h => [h.id, h.ln, h.t]), [['m', 1, 'rio a passar'], ['m-1', 2, 'Há café na mesa e o sol']],
    '2 linhas: o fim da 1.ª e o início da última')
  const s0 = [2, at(S, 2, 'sol') + 1]
  const e0 = [4, at(S, 4, 'saio') + 1]
  // Diagonal para a esquerda: atravessa "e o" (linha 2) e "para a" (linha 4) a caminho
  const three = highlightRange(sweep(S, s0, e0, { n: 60 }), PINK, S)
  eq(three.map(h => [h.ln, h.t]), [[2, 'sol a entrar'], [3, 'Guardo as chaves no bolso do casaco'], [4, 'E saio']],
    '3 linhas: da palavra onde entrou à palavra onde saiu, a do meio inteira (a diagonal não apanha mais palavras)')
  eq(highlightRange(sweep(S, e0, s0, { n: 60 }), PINK, S).map(h => [h.ln, h.t]), three.map(h => [h.ln, h.t]),
    '3 linhas: de baixo para cima dá o mesmo (ordem de leitura)')
  // Começar e acabar fora do texto: contam os pontos onde entrou e saiu dele
  const [ax, ay] = center(S, 2, at(S, 2, 'sol') + 1)
  const [bx, by] = center(S, 4, at(S, 4, 'saio') + 1)
  const loose = [ax + 6 * S.em, ay - 2 * S.em, ...sweep(S, s0, e0, { n: 60 }), bx - 6 * S.em, by + 2.5 * S.em]
  eq(highlightRange(loose, PINK, S).map(h => h.t), three.map(h => h.t), '3 linhas: pontos fora do texto nas pontas não contam')
  // Por cima de uma quebra de estrofe e de um rótulo: a linha vazia não tem registo, o rótulo entra inteiro
  const cross = highlightRange(sweep(S, [4, at(S, 4, 'trás') + 1], [7, at(S, 7, 'contigo') + 2], { n: 60 }), PINK, S)
  eq(cross.map(h => [h.ln, h.t]), [[4, 'trás'], [6, 'REFRÃO'], [7, 'Leva-me contigo,']], 'estrofes: sem registo na linha vazia, rótulo inteiro')
  // Linha longa partida em rows: um só registo (é uma linha da letra)
  const T = makeLayout(LYRICS, TELEMOVEL)
  ok(T.rows(12).length >= 3, 'pré-condição: linha longa em 3+ rows no telemóvel')
  const lw = highlightRange(sweep(T, [12, at(T, 12, 'comprida') + 1], [12, at(T, 12, 'telemóvel') + 2], { n: 50 }), PINK, T)
  eq(lw.map(h => [h.ln, h.t]), [[12, 'comprida que não cabe inteira no ecrã do telemóvel']], 'linha longa em várias rows: um registo')
})

test('marcador: gestos em U, zigue-zague e varrimentos para trás', () => {
  /** Gesto feito de troços (cada um do centro de um carácter ao de outro) */
  const path = (L, ...legs) => legs.flatMap(([a, b, n], k) => sweep(L, a, b, { n: n ?? 24 }).slice(k ? 2 : 0))
  const end = (L, ln) => L.text(ln).replace(/\s+$/, '').length - 1
  for (const [name, cfg] of [['Ensaio', ENSAIO], ['telemóvel', { ...TELEMOVEL, em: 18, width: 360 }]]) {
    const L = makeLayout(LYRICS, cfg)
    if (L.rows(1).length !== 1 || L.rows(2).length !== 1 || L.rows(3).length !== 1) {
      ok(false, `${name}: pré-condição — linhas 1–3 numa row cada`)
      continue
    }
    const full = ln => L.text(ln).trim()
    // U: linha 1 para a direita, desce pela direita, linha 2 de volta para a esquerda
    const U = path(L, [[1, 0], [1, end(L, 1)]], [[1, end(L, 1)], [2, end(L, 2)], 4], [[2, end(L, 2)], [2, 0]])
    eq(highlightRange(U, YELLOW, L).map(h => [h.ln, h.t]), [[1, full(1)], [2, full(2)]], `${name}: U — as duas linhas varridas ficam inteiras`)
    // Ao contrário (de baixo para cima, também em U)
    const Ur = path(L, [[2, 0], [2, end(L, 2)]], [[2, end(L, 2)], [1, end(L, 1)], 4], [[1, end(L, 1)], [1, 0]])
    eq(highlightRange(Ur, YELLOW, L).map(h => [h.ln, h.t]), [[1, full(1)], [2, full(2)]], `${name}: U de baixo para cima — o mesmo`)
    // Z: linha 1 para a direita, diagonal de volta ao início da linha 2, linha 2 para a direita
    const Z = path(L, [[1, 0], [1, end(L, 1)]], [[1, end(L, 1)], [2, 0], 30], [[2, 0], [2, end(L, 2)]])
    eq(highlightRange(Z, YELLOW, L).map(h => [h.ln, h.t]), [[1, full(1)], [2, full(2)]], `${name}: Z — as duas linhas inteiras`)
    // Começa a meio da linha 1, volta ao início, desce e varre a linha 2 até "mesa"
    const mid = at(L, 1, 'com')
    const back = path(L, [[1, mid], [1, 0]], [[1, 0], [2, 0], 4], [[2, 0], [2, at(L, 2, 'mesa') + 1]])
    eq(highlightRange(back, YELLOW, L).map(h => [h.ln, h.t]), [[1, full(1)], [2, 'Há café na mesa']],
      `${name}: começa a meio e volta ao início — as palavras varridas para trás contam`)
    // Zigue-zague que acaba na row de partida: as outras rows tocadas contam
    const zz = path(L, [[1, 0], [1, end(L, 1)]], [[1, end(L, 1)], [2, end(L, 2)], 4], [[2, end(L, 2)], [2, 0]], [[2, 0], [1, 2], 4])
    eq(highlightRange(zz, YELLOW, L).map(h => [h.ln, h.t]), [[1, full(1)], [2, full(2)]], `${name}: zigue-zague que volta à 1.ª linha — a 2.ª não se perde`)
    // Três linhas em S: 1 →, 2 ←, 3 → até "chaves"
    const S3 = path(L, [[1, 0], [1, end(L, 1)]], [[1, end(L, 1)], [2, end(L, 2)], 4], [[2, end(L, 2)], [2, 0]],
      [[2, 0], [3, 0], 4], [[3, 0], [3, at(L, 3, 'chaves') + 2]])
    eq(highlightRange(S3, YELLOW, L).map(h => [h.ln, h.t]), [[1, full(1)], [2, full(2)], [3, 'Guardo as chaves']], `${name}: S por 3 linhas`)
    // Varrer uma linha com um desvio para a folga da linha de baixo (sem entrar na caixa do texto dela)
    const r1 = L.rows(1)[0]
    const r2 = L.rows(2)[0]
    const dipY = r1.bottom + Math.min((r2.top - r1.bottom) * 0.9, 0.45 * L.em)
    const [ax, ay] = center(L, 1, at(L, 1, 'cedo'))
    const [bx] = center(L, 1, at(L, 1, 'passar') + 2)
    const dip = []
    for (let i = 0; i <= 30; i++) {
      const t = i / 30
      dip.push(ax + t * (bx - ax), i === 15 || i === 16 ? dipY : ay)
    }
    ok(dipY < r2.top && classifyHighlight(dip, L) === 'text', `${name}: pré-condição — o desvio fica na folga, fora da caixa da linha 2`)
    eq(highlightRange(dip, YELLOW, L).map(h => [h.ln, h.t]), [[1, 'cedo com o rio a passar']], `${name}: um desvio para a folga da vizinha não acrescenta a linha de baixo`)
  }
  // Diagonais (não varrem): a 1.ª e a última palavra são as do início e do fim
  const S = makeLayout(LYRICS, ENSAIO)
  const d1 = highlightRange(sweep(S, [1, at(S, 1, 'rio') + 1], [2, at(S, 2, 'café') + 1], { n: 40, wob: 0 }), YELLOW, S)
  eq(d1.map(h => [h.ln, h.t]), [[1, 'rio a passar'], [2, 'Há café']], 'diagonal de uma linha para a seguinte, para trás: não apanha as palavras por onde passa')
})

test('marcador: margem, vertical e folha sem letra → traço livre de marcador', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const bar = marginBar(S, [1, 2, 3, 4])
  eq(classifyHighlight(bar, S), 'ink', 'vertical na margem: traço livre')
  const r = anchorHighlight(bar, BLUE, S, 'barra')
  ok(r && r.marks.length === 0 && r.ink && r.ink.hl === true && r.ink.mode === MODE_MARGIN && r.ink.id === 'barra',
    'vertical na margem: ancorado como uma chaveta (margem), com hl', r && r.ink && { mode: r.ink.mode, hl: r.ink.hl })
  const rs = resolveStroke(r.ink, S)
  ok(rs.hl === true && Math.abs(rs.width - HL_INK_EM * S.em) < 0.05 && maxDev(rs.subpaths[0], bar) <= 0.5,
    'traço livre: largo (0.9em), no sítio onde se desenhou', { w: rs.width })
  const G = makeLayout(LYRICS, GRANDE)
  ok(Math.abs(resolveStroke(r.ink, G).width - HL_INK_EM * G.em) < 0.05, 'traço livre: a largura escala com o em')
  // Vertical por cima do texto (altura > 1.5× largura)
  const cx = S.centerX
  const vt = []
  for (let i = 0; i < 20; i++) vt.push(cx + Math.sin(i) * 3, S.rows(1)[0].top + i * 6)
  eq(classifyHighlight(vt, S), 'ink', 'vertical por cima do texto: traço livre')
  // Horizontal na margem (fora das rows)
  const row = S.rows(3)[0]
  const y = (row.top + row.bottom) / 2
  eq(classifyHighlight([S.blockLeft + 2, y, S.blockLeft + 30, y + 1, S.blockLeft + 50, y], S), 'ink', 'horizontal na margem: traço livre')
  // Entre estrofes, longe das linhas
  const gy = (S.rows(4)[0].bottom + S.rows(6)[0].top) / 2
  const gpts = [cx - 60, gy, cx, gy + 2, cx + 60, gy]
  const gap = anchorHighlight(gpts, BLUE, S)
  ok(gap && gap.ink && gap.ink.hl && gap.ink.mode === anchorStroke(gpts, BLUE, 3, S).mode, 'entre estrofes: traço livre, ancorado como a caneta o ancoraria', gap && gap.ink && gap.ink.mode)
  // Folha sem letra
  const E = makeLayout('', ENSAIO)
  eq(classifyHighlight([10, 10, 200, 30], E), 'ink', 'sem letra: traço livre')
  const fr = anchorHighlight([10, 10, 200, 30], BLUE, E)
  ok(fr && fr.ink && fr.ink.mode === MODE_FREE && fr.ink.hl && !resolveStroke(fr.ink, E).hidden, 'sem letra: livre na folha (MODE_FREE)')
  eq(classifyHighlight([10, 10], E), null, 'sem letra: um ponto só não faz nada')
})

test('marcador: retângulos por row, por trás do texto, em qualquer layout', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const one = mk(S, 2, 'café na mesa', YELLOW, 'um')
  const r1 = resolveHighlight(one, S)
  const want = rowsOfRange(S, one)
  ok(!r1.hidden && r1.rects.length === 1, 'identidade: uma row → um retângulo')
  const rr = r1.rects[0]
  ok(rr.left <= want[0].left && rr.left >= want[0].left - 0.15 * S.em && rr.right >= want[0].right && rr.right <= want[0].right + 0.15 * S.em,
    'identidade: do left do 1.º carácter ao right do último, com pequena folga', [rr, want[0]])
  ok(rr.top <= want[0].top && rr.top >= want[0].top - 0.1 * S.em && rr.bottom >= want[0].bottom && rr.bottom <= want[0].bottom + 0.1 * S.em,
    'identidade: altura da caixa do texto da row com pequena folga', [rr, want[0]])
  ok(resolveHighlight(one, S) === r1, 'cache por layout e destaque')
  const long = mk(S, 12, 'comprida que não cabe inteira no ecrã do telemóvel e tem de quebrar', YELLOW, 'longo')
  for (const [name, cfg] of Object.entries({ ENSAIO, ...DESTINOS })) {
    const D = makeLayout(LYRICS, cfg)
    for (const h of [one, long]) {
      const r = resolveHighlight(h, D)
      const exp = rowsOfRange(D, h)
      const em = D.em
      const fits = r.rects.length === exp.length && r.rects.every((b, k) =>
        b.left <= exp[k].left && b.left >= exp[k].left - 0.15 * em && b.right >= exp[k].right && b.right <= exp[k].right + 0.15 * em &&
        b.top <= exp[k].top && b.top >= exp[k].top - 0.1 * em && b.bottom >= exp[k].bottom && b.bottom <= exp[k].bottom + 0.1 * em)
      ok(!r.hidden && fits, `${name}: "${h.t.slice(0, 16)}…" → um retângulo por row (${exp.length}), presos aos mesmos caracteres`, { got: r.rects.length, exp: exp.length })
      // Nenhum par de retângulos se sobrepõe (sem dupla opacidade dentro do destaque)
      ok(r.rects.every((b, k) => k === 0 || b.top >= r.rects[k - 1].bottom), `${name}: rows sem sobreposição`)
    }
  }
  const T = makeLayout(LYRICS, TELEMOVEL)
  const N = makeLayout(LYRICS, ESTREITO)
  ok(resolveHighlight(long, N).rects.length > resolveHighlight(long, S).rects.length, 'bloco estreito: a linha re-quebra e o destaque acompanha as rows novas',
    [resolveHighlight(long, N).rects.length, resolveHighlight(long, S).rects.length])
  // Escondido: órfão, texto que já não é o mesmo, linha que não existe
  ok(resolveHighlight({ ...one, lines: { 2: 'x' } }, S).hidden, 'órfão: escondido')
  ok(resolveHighlight({ ...one, t: 'chá na mesa' }, S).hidden, 'texto diferente do layout: escondido')
  ok(resolveHighlight({ ...one, ln: 999 }, S).hidden && resolveHighlight(one, makeLayout('', ENSAIO)).hidden, 'linha inexistente / sem letra: escondido')
  // Entre todos os retângulos resolvidos, nenhum NaN
  ok(resolveHighlights([one, long, anchorStroke(underline(S, 2, 3, 6), YELLOW, 3, S)], T).every(h => h.rects.flatMap(b => [b.left, b.top, b.right, b.bottom]).every(Number.isFinite)),
    'resolveHighlights: só os destaques, números finitos')
})

test('marcador: fusão com a mesma cor, recorte da outra — nunca dupla opacidade', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const T = ln => S.text(ln)
  let list = mergeHighlights([], [mk(S, 2, 'café', YELLOW, 'a')], T)
  list = mergeHighlights(list, [mk(S, 2, 'mesa', YELLOW, 'b')], T)
  eq(list.map(h => h.t), ['café', 'mesa'], 'mesma cor com uma palavra no meio: ficam dois')
  const before = list
  list = mergeHighlights(list, [mk(S, 2, 'na', YELLOW, 'c')], T)
  eq(list.map(h => [h.id, h.t]), [['c', 'café na mesa']], 'mesma cor: os três fundem-se num só')
  eq(before.map(h => h.t), ['café', 'mesa'], 'a lista de entrada não muda (Desfazer guarda-a)')
  eq(mergeHighlights([mk(S, 3, 'as', YELLOW, 'x')], [mk(S, 3, 'chaves', YELLOW.toUpperCase(), 'y')], T).map(h => h.t), ['as chaves'],
    'mesma cor (maiúsculas ou não), só um espaço entre eles: fundem-se')
  const big = mk(S, 2, 'Há café na mesa e o sol', YELLOW, 'big')
  const cut = mergeHighlights([big], [mk(S, 2, 'na', GREEN, 'g')], T)
  eq(cut.map(h => [h.color, h.t]), [[YELLOW, 'Há café'], [YELLOW, 'mesa e o sol'], [GREEN, 'na']], 'outra cor no meio: parte o amarelo em dois, sem os espaços da ponta')
  ok(cut[0].id === 'big' && cut[1].id !== 'big' && cut[1].id !== 'g', 'recorte: o pedaço da esquerda fica com o id, o da direita tem um novo')
  eq(mergeHighlights([mk(S, 2, 'café', YELLOW, 'y')], [mk(S, 2, 'Há café na', GREEN, 'g')], T).map(h => [h.id, h.t]), [['g', 'Há café na']],
    'outra cor por cima de tudo: o de baixo sai')
  eq(mergeHighlights([mk(S, 2, 'café na mesa', YELLOW, 'y')], [mk(S, 2, 'Há café', GREEN, 'g')], T).map(h => [h.id, h.t]), [['y', 'na mesa'], ['g', 'Há café']],
    'outra cor no início: o de baixo fica aparado')
  eq(mergeHighlights([mk(S, 3, 'chaves', YELLOW, 'y')], [mk(S, 2, 'café', GREEN, 'g')], T).map(h => h.t), ['chaves', 'café'], 'outra linha: não mexe')
  const pen = anchorStroke(underline(S, 2, 3, 6), YELLOW, 3, S, 'caneta')
  ok(mergeHighlights([pen], [mk(S, 2, 'café', YELLOW, 'y')], T)[0] === pen, 'traços da caneta ficam como estão')
  // Propriedade: 300 destaques aleatórios em 3 cores, em duas linhas (uma re-quebrada)
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const colors = [YELLOW, GREEN, PINK]
  let all = []
  let bad = null
  for (let k = 0; k < 300 && !bad; k++) {
    const ln = k % 2 ? 12 : 2
    const vis = []
    for (let c = 0; c < S.text(ln).length; c++) { const b = S.charRect(ln, c); if (b && b.right > b.left && !/\s/.test(S.text(ln)[c])) vis.push(c) }
    const a = vis[Math.floor(rnd() * vis.length)]
    const b = vis[Math.floor(rnd() * vis.length)]
    const add = highlightRange(sweep(S, [ln, a], [ln, b], { n: 12, wob: 0 }), colors[k % 3], S, `r${k}`)
    all = mergeHighlights(all, add, T)
    for (const l of [2, 12]) {
      const text = S.text(l)
      const iv = all.filter(h => h.ln === l).map(h => ({ a: h.c0, b: h.c1, color: h.color, t: h.t })).sort((p, q) => p.a - q.a)
      for (let i = 0; i < iv.length && !bad; i++) {
        if (text.slice(iv[i].a, iv[i].b) !== iv[i].t) bad = ['texto', iv[i]]
        else if (/^\s|\s$/.test(iv[i].t)) bad = ['brancos na ponta', iv[i]]
        else if (i && iv[i].a < iv[i - 1].b) bad = ['sobreposição', iv[i - 1], iv[i]]
        else if (i && iv[i].color === iv[i - 1].color && !text.slice(iv[i - 1].b, iv[i].a).trim()) bad = ['mesma cor encostada', iv[i - 1], iv[i]]
      }
    }
  }
  ok(!bad, 'aleatório: em cada linha, destaques sem sobreposição, a mesma cor nunca encostada, texto certo', bad)
  ok(new Set(all.map(h => h.id)).size === all.length, 'aleatório: ids únicos')
})

test('marcador: letra editada — linha inserida, editada, apagada, refrão repetido', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const h2 = mk(S, 2, 'café na mesa', YELLOW, 'h2')
  const h16 = mk(S, 16, 'contigo,', YELLOW, 'h16')     // 2.º refrão
  const h8 = mk(S, 8, 'daqui)', YELLOW, 'h8')           // linha indentada
  const list = [h2, h16, h8]
  const saved = collectLines(list, LYRICS)
  ok(saved['2'] === 'Há café na mesa e o sol a entrar' && saved['18'] !== undefined, 'collectLines: só com destaques também guarda o retrato')
  const same = rebaseStrokes(list, saved, LYRICS)
  ok(!same.changed && same.strokes.every((s, i) => s === list[i]), 'letra igual: os mesmos objetos')
  // Inserida acima
  const ins = editLines(LYRICS, l => l.splice(1, 0, 'Uma linha nova inventada'))
  const ri = rebaseStrokes(list, saved, ins)
  eq(ri.strokes.map(h => [h.ln, h.c0, h.t]), [[3, h2.c0, 'café na mesa'], [17, h16.c0, 'contigo,'], [9, h8.c0, 'daqui)']],
    'inserida: cada destaque desce uma linha, o 2.º refrão fica com o seu (17, não 8)')
  const D = makeLayout(ins, CONCERTO)
  const rd = resolveHighlight(ri.strokes[0], D)
  const ex = rowsOfRange(D, ri.strokes[0])
  ok(!rd.hidden && rd.rects.length === ex.length && rd.rects[0].left <= ex[0].left && rd.rects[0].right >= ex[0].right, 'inserida: no concerto, por trás das mesmas palavras')
  // Editada: outra palavra mudou, o texto destacado continua na linha
  const ed = LYRICS.replace('Há café na mesa e o sol a entrar', 'Hoje há café na mesa e o sol')
  const re = rebaseStrokes(list, saved, ed)
  const e0 = re.strokes[0]
  ok(re.changed && e0.ln === 2 && !e0.lines && e0.c0 === 'Hoje há café na mesa e o sol'.indexOf('café') && e0.t === 'café na mesa',
    'editada: reencontra o texto na linha nova', e0)
  ok(!resolveHighlight(e0, makeLayout(ed, ENSAIO)).hidden, 'editada: visível')
  // Editada E com uma linha inserida antes
  const ed2 = editLines(ed, l => l.splice(0, 0, 'Linha nova inventada'))
  eq(rebaseStrokes(list, saved, ed2).strokes[0].ln, 3, 'editada + inserida: segue a linha (3)')
  // Duas ocorrências na linha editada: a mais próxima de c0
  const twice = LYRICS.replace('Há café na mesa e o sol a entrar', 'café na mesa, Há café na mesa e o sol')
  eq(rebaseStrokes([h2], saved, twice).strokes[0].c0, 'café na mesa, Há café na mesa e o sol'.lastIndexOf('café na mesa'), 'editada: ocorrência mais próxima de c0')
  // O texto destacado saiu da linha → órfão (escondido, não apagado)
  const gone = LYRICS.replace('Há café na mesa e o sol a entrar', 'Há chá na mesa e o sol a entrar')
  const ro = rebaseStrokes(list, saved, gone)
  ok(ro.strokes[0].lines && ro.strokes[0].lines['2'] === 'Há café na mesa e o sol a entrar' && ro.strokes.length === 3, 'texto apagado: órfão com o texto da linha')
  ok(resolveHighlight(ro.strokes[0], makeLayout(gone, ENSAIO)).hidden, 'texto apagado: escondido')
  const enc = decodeAnchored(JSON.parse(JSON.stringify(encodeAnchored(ro.strokes))))
  eq(enc, ro.strokes, 'órfão: sobrevive a gravar/ler')
  const back = rebaseStrokes(enc, collectLines(enc, gone), LYRICS)
  ok(!back.strokes[0].lines && back.strokes[0].ln === 2 && back.strokes[0].c0 === h2.c0 && !resolveHighlight(back.strokes[0], S).hidden,
    'a linha volta → o destaque volta ao mesmo sítio', back.strokes[0])
  // Refrão: 1.º apagado inteiro → o do 2.º fica com o seu, o do 1.º fica órfão (2 carregamentos)
  const h7 = mk(S, 7, 'contigo,', PINK, 'h7')
  const del = editLines(LYRICS, l => l.splice(6, 5))
  let p = saveLoad([h7, h16], LYRICS)
  const l1 = rebaseStrokes(p.anchored, p.lines, del)
  eq(l1.strokes.map(h => (h.lines ? 'órfão' : h.ln)), ['órfão', 11], 'refrão apagado: o do 1.º órfão, o do 2.º sobe para 11')
  p = saveLoad(l1.strokes, del)
  const l2 = rebaseStrokes(p.anchored, p.lines, del)
  eq(l2.strokes.map(h => (h.lines ? 'órfão' : h.ln)), ['órfão', 11], 'refrão apagado: no carregamento seguinte o órfão não cai no refrão que ficou')
  eq(resolveHighlights(l2.strokes, makeLayout(del, CONCERTO)).filter(h => !h.hidden).map(h => h.id), ['h16'], 'refrão apagado: só um destaque visível no concerto')
  // Indentação tirada: c0 conta do 1.º não branco
  const ind = LYRICS.replace('    (leva-me daqui)', '(leva-me daqui)')
  const Di = makeLayout(ind, ENSAIO)
  const r8 = rebaseStrokes([h8], collectLines([h8], LYRICS), ind).strokes[0]
  const q = Di.charRect(8, Di.text(8).indexOf('daqui'))
  const r8r = resolveHighlight(r8, Di)
  ok(!r8r.hidden && Math.abs(r8r.rects[0].left - q.left) < 0.15 * Di.em, 'indentação tirada: continua em "daqui)"', r8r.rects[0])
  // Sem registo das linhas (payload regravado pela versão anterior só com destaques: lines = {})
  const nr = rebaseStrokes([h2], {}, LYRICS)
  ok(!nr.changed && nr.strokes[0] === h2 && !resolveHighlight(h2, makeLayout(LYRICS, CONCERTO)).hidden, 'sem registo: fica, e aparece se o texto lá estiver')
  ok(resolveHighlight(h2, makeLayout(gone, ENSAIO)).hidden, 'sem registo e texto mudado: o resolver esconde-o')
})

test('marcador: formato guardado (encode/decode, payload, entradas estragadas)', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const pen = anchorStroke(underline(S, 2, ...word(S, 2, 'café na mesa')), '#dc2626', 4, S, 'caneta')
  const hls = highlightRange(sweep(S, [2, at(S, 2, 'sol')], [4, at(S, 4, 'saio') + 1], { n: 60 }), PINK, S, 'hl')
  const ink = anchorHighlight(marginBar(S, [7, 8, 9]), BLUE, S, 'barra').ink
  const orphan = { ...mk(S, 3, 'chaves', YELLOW, 'orf'), lines: { 3: 'Guardo as chaves no bolso do casaco' } }
  const items = [pen, ...hls, ink, orphan]
  const enc = encodeAnchored(items)
  const json = JSON.stringify(enc)
  eq(decodeAnchored(JSON.parse(json)), items, 'encode/decode: ida e volta exata (caneta, destaques, marcador livre, órfão)')
  eq(enc[1], ['hl', PINK, 0, MODE_HL_TEXT, 2, hls[0].c0, hls[0].c1, hls[0].t], 'destaque: [id, cor, 0, 5, ln, c0, c1, texto]')
  ok(enc[4][3] === MODE_HL_INK && enc[4][8] === MODE_MARGIN && enc[4].length === 9, 'marcador livre: modo 6, ancoragem a seguir aos pontos', enc[4].slice(0, 4).concat(enc[4].slice(8)))
  ok(enc[0][3] === MODE_TEXT && enc[0].length === 8, 'caneta: formato de sempre')
  eq(decodeAnchored([
    ['a', PINK, 0, MODE_HL_TEXT, 2, 3, 3, ''],          // vazio
    ['b', PINK, 0, MODE_HL_TEXT, -1, 0, 2, 'ab'],       // linha negativa
    ['c', PINK, 0, MODE_HL_TEXT, 2, 0, 3, 'ab'],        // texto com outro tamanho
    ['d', PINK, 0, MODE_HL_TEXT, 2, 0, 2],              // sem texto
    ['e', PINK, 0, MODE_HL_TEXT, 2.5, 0, 2, 'ab'],      // linha não inteira
    ['f', BLUE, 900, MODE_HL_INK, [0, 0, 1], [0], [0], [0], 'x'],  // ancoragem inválida
  ]), [], 'decode: destaques e marcadores estragados saem')
  const parts = decodeAnchoredParts([['g', BLUE, 900, MODE_HL_INK, [0, 0, 1], [0], [0], [0], 9], ['h', BLUE, 900, MODE_HL_INK, [0, 99, 1], [0], [0], [0], 0]])
  ok(parts.strokes.length === 0 && parts.extra.length === 2, 'decode: marcador livre com ancoragem ou código futuros → extra (preservado)')
  const p = saveLoad(items, LYRICS)
  eq(p.anchored, items, 'payload: âncoras de volta')
  ok(payloadHasStrokes(p) && p.lines['3'] === 'Guardo as chaves no bolso do casaco', 'payload: tem anotações e o retrato das linhas')
  const onlyHl = saveLoad([hls[0]], LYRICS)
  ok(onlyHl.lines && onlyHl.lines['2'] === LYRICS.split('\n')[2], 'payload só com destaques: guarda o retrato das linhas')
})

test('compatibilidade: a versão publicada (2b52db3) preserva os destaques em extra e reescreve-os iguais', () => {
  if (!OLD) {
    console.log('   (aviso) sem git ou sem o commit 2b52db3: compatibilidade não verificada')
    return
  }
  const S = makeLayout(LYRICS, ENSAIO)
  const pen = anchorStroke(underline(S, 2, ...word(S, 2, 'café na mesa')), '#dc2626', 4, S, 'caneta')
  const hls = highlightRange(sweep(S, [2, at(S, 2, 'sol')], [4, at(S, 4, 'saio') + 1], { n: 60 }), PINK, S, 'hl')
  const ink = anchorHighlight(marginBar(S, [7, 8, 9]), BLUE, S, 'barra').ink
  const orphan = { ...mk(S, 3, 'chaves', YELLOW, 'orf'), lines: { 3: 'Guardo as chaves no bolso do casaco' } }
  const items = [pen, ...hls, ink, orphan]
  const raw = JSON.parse(JSON.stringify(buildPayload({
    w: 780, h: S.height, strokes: toLegacyStrokes(resolveAll(items, S), resolveHighlights(items, S)), em: 32, anchored: items, lyrics: LYRICS,
  })))
  const old = OLD.readPayload(raw)
  eq(old.anchored.map(s => s.id), ['caneta'], 'antiga: só a caneta entra nos traços que desenha')
  eq(old.extra, raw.anchored.slice(1), 'antiga: destaques e marcador livre guardados em extra, em bruto')
  const drawn = OLD.resolveAll(old.anchored, S)
  ok(drawn.length === 1 && drawn[0].color === '#dc2626', 'antiga: nenhum destaque desenhado como caneta opaca')
  // A antiga desenha mais um traço e grava
  const pen2 = OLD.anchorStroke(strike(S, 3, ...word(S, 3, 'chaves')), '#2563eb', 3, S, 'antiga')
  const mine = [...old.anchored, pen2]
  const again = JSON.parse(JSON.stringify(OLD.buildPayload({
    w: 780, h: S.height, strokes: OLD.toLegacyStrokes(OLD.resolveAll(mine, S)), em: 32, anchored: mine, lyrics: LYRICS, extra: old.extra,
  })))
  eq(again.anchored.slice(2), raw.anchored.slice(1), 'antiga: reescreve-os tal como vieram')
  const back = readPayload(again)
  eq(back.extra, [], 'nova: lê tudo de volta (nada fica em extra)')
  eq(back.anchored.filter(s => s.id !== 'antiga'), items, 'nova: destaques, marcador livre e órfão iguais aos originais')
  // Só destaques: a antiga não tem nada que desenhar — a tecla do concerto não aparece, nada rebenta
  const onlyRaw = JSON.parse(JSON.stringify(buildPayload({ w: 780, h: S.height, strokes: [], em: 32, anchored: hls, lyrics: LYRICS })))
  const o2 = OLD.readPayload(onlyRaw)
  // (+1: o retrato das linhas do marcador, também em extra)
  ok(o2.anchored.length === 0 && o2.extra.length === hls.length + 1 && !OLD.payloadHasVisible(o2, LYRICS) && OLD.rebaseStrokes(o2.anchored, o2.lines, LYRICS).strokes.length === 0,
    'antiga, só destaques: nada desenhado, nada perdido', o2.extra.length)
  // …e se a antiga gravar assim, o retrato das linhas sai vazio: a nova continua a mostrá-los
  const w2 = JSON.parse(JSON.stringify(OLD.buildPayload({ w: 780, h: S.height, strokes: [], em: 32, anchored: o2.anchored, lyrics: LYRICS, extra: o2.extra })))
  eq(w2.lines, {}, 'antiga, só destaques: grava lines = {}')
  const n2 = readPayload(w2)
  const r2 = rebaseStrokes(n2.anchored, n2.lines, LYRICS)
  ok(r2.strokes.length === hls.length && resolveHighlights(r2.strokes, makeLayout(LYRICS, CONCERTO)).every(h => !h.hidden) && payloadHasVisible(n2, LYRICS),
    'nova: depois disso continua a mostrar os destaques')
})

test('compatibilidade: a 2b52db3 re-numera a caneta depois de a letra mudar — o marcador segue o seu retrato', () => {
  if (!OLD) {
    console.log('   (aviso) sem git ou sem o commit 2b52db3: compatibilidade não verificada')
    return
  }
  // Letra inventada com uma linha repetida (o destaque é o da 2.ª)
  const L0 = [
    '[Verso 1]',                         // 0
    'Acordo cedo com o rio a passar',    // 1
    'Há café na mesa e o sol a entrar',  // 2
    '',                                  // 3
    '[Refrão]',                          // 4
    'Leva-me daqui sem pressa',          // 5
    'Leva-me daqui sem pressa',          // 6 (repetida)
    'Até ao fim da linha',               // 7
  ].join('\n')
  // Editada fora do Ensaio: uma linha nova no início
  const L1 = editLines(L0, l => l.splice(1, 0, 'Uma linha nova lá em cima'))
  const S0 = makeLayout(L0, ENSAIO)
  const S1 = makeLayout(L1, ENSAIO)
  const pen = anchorStroke(underline(S0, 1, ...word(S0, 1, 'Acordo cedo')), '#dc2626', 3, S0, 'caneta')
  const rep = mk(S0, 6, 'Leva-me daqui', YELLOW, 'rep')
  const uni = mk(S0, 7, 'Até ao', PINK, 'uni')
  const ink = anchorHighlight(marginBar(S0, [7]), BLUE, S0, 'barra').ink
  ok(rep.ln === 6 && uni.ln === 7 && ink && ink.hl, 'pré-condição: destaques nas linhas 6 e 7, traço de marcador ao lado da 7')
  const items = [pen, rep, uni, ink]
  const P0 = JSON.parse(JSON.stringify(buildPayload({ w: 780, h: S0.height, strokes: [], em: 32, anchored: items, lyrics: L0 })))
  const snaps = P0.anchored.filter(e => e[3] === 7)
  ok(snaps.length === 1 && snaps[0][4]['6'] === 'Leva-me daqui sem pressa' && JSON.stringify(snaps[0][4]) === JSON.stringify(P0.lines),
    'payload: uma entrada com o retrato do marcador (igual a lines quando grava a versão atual)', snaps)
  // Referência: a versão atual abre a letra editada diretamente
  const p0 = readPayload(P0)
  const ref = rebaseStrokes(p0.anchored, p0.lines, L1, p0.hlLines).strokes
  const id = (list, k) => list.find(s => s.id === k)
  ok(id(ref, 'rep').ln === 7 && id(ref, 'uni').ln === 8 && id(ref, 'barra').p[0] === 8, 'referência: tudo desce uma linha',
    { rep: id(ref, 'rep').ln, uni: id(ref, 'uni').ln, barra: id(ref, 'barra').p[0] })
  // A 2b52db3 (PWA em cache) abre o Ensaio com a letra editada: re-numera a caneta e grava
  const o = OLD.readPayload(P0)
  const r = OLD.rebaseStrokes(o.anchored, o.lines, L1)
  ok(r.changed && o.extra.length === 4, 'antiga: re-numera a caneta (changed) e guarda os 3 itens + o retrato em extra', o.extra.length)
  const P1 = JSON.parse(JSON.stringify(OLD.buildPayload({ w: 780, h: S1.height, strokes: [], em: 32, anchored: r.strokes, lyrics: L1, extra: o.extra })))
  ok(P1.lines['7'] === 'Leva-me daqui sem pressa' && P1.lines['1'] === 'Uma linha nova lá em cima', 'antiga: grava lines com a letra NOVA')
  // A versão atual volta a abrir: o marcador segue o seu retrato, a caneta o lines
  const p1 = readPayload(P1)
  const back = rebaseStrokes(p1.anchored, p1.lines, L1, p1.hlLines)
  eq(['caneta', 'rep', 'uni', 'barra'].map(k => { const s = id(back.strokes, k); return isTextHighlight(s) ? [s.ln, s.t, !!s.lines] : [s.p[0], !!s.lines] }),
    [[2, false], [7, 'Leva-me daqui', false], [8, 'Até ao', false], [8, false]],
    'nova, depois da antiga: caneta na 2, destaque na 2.ª repetida (7, não a 6), "Até ao" na 8, marcador livre ao lado da 8')
  ok(back.changed, 'nova: re-numerou o marcador (grava já a numeração nova)')
  const rr = resolveHighlight(id(back.strokes, 'rep'), S1)
  ok(!rr.hidden && Math.abs(rr.rects[0].top - S1.rows(7)[0].top) < 0.1 * S1.em, 'destaque desenhado na 2.ª repetida', rr.rects[0])
  const ri = resolveStroke(id(back.strokes, 'barra'), S1)
  const ys = ri.subpaths.flat().filter((_, i) => i % 2)
  ok(Math.min(...ys) > S1.rows(7)[0].bottom, 'marcador livre ao lado da linha certa (8), não uma linha acima', [Math.min(...ys), S1.rows(7)[0].bottom])
  ok(payloadHasVisible(p1, L1), 'payloadHasVisible com o retrato do marcador')
  // A nova grava e volta a abrir: estável
  const P2 = JSON.parse(JSON.stringify(buildPayload({ w: 780, h: S1.height, strokes: [], em: 32, anchored: back.strokes, lyrics: L1 })))
  const p2 = readPayload(P2)
  const again = rebaseStrokes(p2.anchored, p2.lines, L1, p2.hlLines)
  ok(!again.changed && P2.anchored.filter(e => e[3] === 7).length === 1, 'nova grava: estável, um só retrato')
  // A antiga outra vez, agora SEM traços próprios (lines = {}) e a letra muda de novo: o retrato do marcador chega
  const L2 = editLines(L1, l => l.splice(0, 0, 'Outra linha nova inventada'))
  const o3 = OLD.readPayload(JSON.parse(JSON.stringify(buildPayload({ w: 780, h: S1.height, strokes: [], em: 32, anchored: again.strokes.filter(s => s.id !== 'caneta'), lyrics: L1 }))))
  const P3 = JSON.parse(JSON.stringify(OLD.buildPayload({ w: 780, h: 1, strokes: [], em: 32, anchored: o3.anchored, lyrics: L2, extra: o3.extra })))
  eq(P3.lines, {}, 'antiga sem traços próprios: grava lines = {}')
  const p3 = readPayload(P3)
  const S2 = makeLayout(L2, ENSAIO)
  const b3 = rebaseStrokes(p3.anchored, p3.lines, L2, p3.hlLines).strokes
  eq(b3.filter(isTextHighlight).map(h => [h.ln, h.t, !resolveHighlight(h, S2).hidden]), [[8, 'Leva-me daqui', true], [9, 'Até ao', true]],
    'letra editada outra vez: os destaques continuam visíveis e na linha certa')
  ok(payloadHasVisible(p3, L2), 'payloadHasVisible: a tecla do concerto aparece')
})

test('marcador: guarda de versão futura (campos reservados e a mais vão para extra)', () => {
  const lyrics = 'Acordo cedo com o rio a passar'
  const fut5 = ['f1', '#FFE01A', 1, MODE_HL_TEXT, 0, 7, 11, 'cedo']                                // campo reservado ≠ 0
  const fut5b = ['f2', '#FFE01A', 0, MODE_HL_TEXT, 0, 7, 11, 'cedo', { 0: lyrics }, { estilo: 'x' }] // campo a mais
  const fut6 = ['f3', BLUE, 900, MODE_HL_INK, [0, 0, 1], [0], [0], [0], MODE_MARGIN, { 0: lyrics }, 'a mais']
  const futPen = ['f4', '#000', 3000, MODE_TEXT, [0, 0, 1], [0], [0], [0], { 0: lyrics }, 'a mais']
  const fut7 = ['marcador-linhas', '', 0, 7, { 0: lyrics }, 'a mais']
  const okHl = ['h', '#FFE01A', 0, MODE_HL_TEXT, 0, 7, 11, 'cedo']
  const parts = decodeAnchoredParts([fut5, fut5b, fut6, futPen, fut7, okHl])
  eq(parts.strokes.map(s => s.id), ['h'], 'só o destaque de hoje é lido')
  eq(parts.extra, [fut5, fut5b, fut6, futPen, fut7], 'os de uma versão futura ficam em extra, em bruto')
  ok(parts.hlLines === null, 'retrato com campos a mais: não é lido como retrato')
  const out = buildPayload({ w: 1, h: 1, strokes: [], em: 32, anchored: parts.strokes, lyrics, extra: parts.extra })
  ok([fut5, fut5b, fut6, futPen, fut7].every(e => out.anchored.some(x => JSON.stringify(x) === JSON.stringify(e))),
    'regravados tal como vieram (nada se perde)')
  const back = readPayload(JSON.parse(JSON.stringify(out)))
  ok(back.hlLines && back.hlLines['0'] === lyrics && back.extra.length === 5, 'e o retrato novo é lido; os futuros continuam em extra')
})

test('marcador: rede de segurança sem retrato da linha', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const h2 = mk(S, 2, 'café na mesa', YELLOW, 'h2')
  const ins = editLines(LYRICS, l => l.splice(1, 0, 'Uma linha nova inventada'))
  const r = rebaseStrokes([h2], null, ins).strokes[0]
  ok(r.ln === 3 && r.c0 === h2.c0 && !resolveHighlight(r, makeLayout(ins, ENSAIO)).hidden, 'sem retrato: reencontra o texto na linha vizinha', r)
  const far = editLines(LYRICS, l => l.splice(1, 0, 'a', 'b', 'c', 'd'))
  eq(rebaseStrokes([h2], {}, far).strokes[0], h2, 'longe demais: fica como está (escondido pelo resolver, não apagado)')
  const part = mk(S, 3, 'as', YELLOW, 'as')
  const moved = LYRICS.replace('Guardo as chaves', 'Guardo-as chaves')
  ok(rebaseStrokes([part], {}, moved).strokes[0] === part, 'só palavras inteiras ("as" dentro de "Guardo-as" não conta)')
  const lab = S.rows(6)[0]
  const tl = highlightRange([(lab.left + lab.right) / 2, (lab.top + lab.bottom) / 2], YELLOW, S, 'rot')[0]
  ok(rebaseStrokes([tl], {}, LYRICS).strokes[0] === tl, 'rótulo de secção: fica')
})

test('marcador: cópia antiga em px com cor rgba translúcida', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const pen = anchorStroke(underline(S, 2, ...word(S, 2, 'café')), '#DC2626', 4, S, 'caneta')
  const one = mk(S, 3, 'chaves no bolso', '#FFE01A', 'um')
  const long = mk(S, 12, 'comprida que não cabe inteira no ecrã do telemóvel e tem de quebrar', '#5CE65C', 'longo')
  const ink = anchorHighlight(marginBar(S, [1, 2]), '#3DB8FF', S, 'barra').ink
  const items = [pen, one, ink, long]
  const rh = resolveHighlights(items, S)
  const leg = toLegacyStrokes(resolveAll(items, S), rh)
  const byId = Object.fromEntries(leg.map(s => [s.id, s]))
  eq(byId.caneta.color, '#DC2626', 'caneta: a cor de sempre')
  eq(byId.barra.color, rgbaOf('#3DB8FF', HL_LEGACY_ALPHA), 'marcador livre: rgba translúcida')
  eq(rgbaOf('#3DB8FF', 0.4), 'rgba(61, 184, 255, 0.4)', 'rgbaOf: hex → rgba')
  const rows = rh.flatMap(h => h.rects.map((r, k) => [k ? `${h.id}~${k}` : h.id, r, h.color]))
  ok(rows.length === 1 + resolveHighlight(long, S).rects.length, 'destaques: um traço por row')
  for (const [id, r, color] of rows) {
    const s = byId[id]
    const th = r.bottom - r.top
    ok(s && s.color === rgbaOf(color, HL_LEGACY_ALPHA) && Math.abs(s.width - th) <= 0.1 && s.pts.length === 4 && s.pts[1] === s.pts[3] &&
      Math.abs(s.pts[1] - (r.top + r.bottom) / 2) <= 0.5 && Math.abs(s.pts[0] - th / 2 - r.left) <= 1 && Math.abs(s.pts[2] + th / 2 - r.right) <= 1,
    `destaque ${id}: traço horizontal largo da altura da row, de ponta a ponta, rgba`, { s, r })
  }
  ok(leg.every(s => s.pts.every(Number.isInteger)), 'px inteiros')
})

test('marcador: borracha, payloadHasVisible e cor sobre o fundo', () => {
  const S = makeLayout(LYRICS, ENSAIO)
  const h = mk(S, 2, 'café na mesa', YELLOW, 'h')
  const r = resolveHighlight(h, S)
  const b = r.rects[0]
  eq(highlightsAt([r], (b.left + b.right) / 2, (b.top + b.bottom) / 2, 1), ['h'], 'borracha: em cima do destaque')
  eq(highlightsAt([r], b.left - 5, (b.top + b.bottom) / 2, 6), ['h'], 'borracha: a tocar na borda')
  eq(highlightsAt([r], b.left - 30, b.top - 30, 10), [], 'borracha: longe')
  eq(highlightsAt([{ ...r, hidden: true }], (b.left + b.right) / 2, (b.top + b.bottom) / 2, 1), [], 'borracha: escondidos não')
  const ink = anchorHighlight(marginBar(S, [1, 2]), BLUE, S, 'barra').ink
  const ri = resolveStroke(ink, S)
  eq(strokesAt([ri], ri.subpaths[0][0] + HL_INK_EM * S.em * 0.45, ri.subpaths[0][1], 1), ['barra'], 'borracha: o traço livre conta com a largura dele')
  // payloadHasVisible (tecla do concerto)
  ok(payloadHasVisible(saveLoad([h], LYRICS), LYRICS), 'só destaques: a tecla aparece')
  const gone = LYRICS.replace('Há café na mesa e o sol a entrar', 'Há chá na mesa e o sol a entrar')
  ok(!payloadHasVisible(saveLoad([h], LYRICS), gone), 'destaque cujo texto saiu: não conta')
  const lab = S.rows(6)[0]
  const tl = highlightRange([(lab.left + lab.right) / 2, (lab.top + lab.bottom) / 2], YELLOW, S, 'rot')
  ok(payloadHasVisible(saveLoad(tl, LYRICS), LYRICS), 'destaque num rótulo de secção: conta')
  ok(luminanceOf('#0B0B0C') < 0.01 && luminanceOf('#FFFFFF') > 0.99 && luminanceOf('rgb(255, 255, 255)') > 0.99 && luminanceOf('nada') === null, 'luminanceOf')
  ok(markerOpacity(luminanceOf('#0B0B0C')) === HL_OPACITY_DARK && markerOpacity(luminanceOf('#FFFFFF')) === HL_OPACITY_LIGHT && markerOpacity(null) === HL_OPACITY_LIGHT, 'markerOpacity (teto): escuro/claro')
})

test('marcador: opacidade por cor — o texto por cima mantém o contraste (Ensaio, palco, tintas de cor, rótulos)', () => {
  // Implementação própria do contraste (WCAG), à parte da do módulo
  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const lum = rgb => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) }
  const over = (fg, bg, a) => fg.map((v, i) => v * a + bg[i] * (1 - a))
  const contrast = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  const under = (c, bg, ink, a) => contrast(lum(over(hex(c), hex(bg), a)), lum(hex(ink)))
  // Paleta do marcador (SongPage: HL_COLORS) e as escolhas das Definições (SettingsPage: BG_SWATCHES, ACTIVE_SWATCHES)
  const palette = ['#FFE01A', '#5CE65C', '#FF5FAF', '#3DB8FF', '#FF9A1F']
  const stageBg = ['#0B0B0C', '#000000', '#17171A', '#0E1520', '#1A110B']
  const stageInk = ['#F2F1EC', '#FF6A26', '#FFC24B', '#3DDC97', '#4CC9F0']
  // Letra pequena (< 24px): ≥ 4.5:1 sempre
  let worst = Infinity
  let worstAt = null
  const cases = [['#FFFFFF', '#111111'], ['#151517', '#F2F1EC'], ...stageBg.flatMap(bg => stageInk.map(ink => [bg, ink]))]
  for (const [bg, ink] of cases) {
    for (const c of palette) {
      const a = markerAlpha(c, bg, ink, 18)
      const k = under(c, bg, ink, a)
      if (k < worst) { worst = k; worstAt = { bg, ink, c, a } }
    }
  }
  ok(worst >= 4.5, `letra < 24px: contraste por cima do marcador ≥ 4.5:1 em ${cases.length} fundos×tintas × 5 cores (pior ${worst.toFixed(2)})`, worstAt)
  // Letra grande (concerto: 32px+): ≥ 4.5:1 quando o marcador fica visível; senão nunca abaixo de 3:1
  let worstL = Infinity
  let minA = Infinity
  for (const [bg, ink] of cases) {
    for (const c of palette) {
      const a = markerAlpha(c, bg, ink, 32)
      worstL = Math.min(worstL, under(c, bg, ink, a))
      minA = Math.min(minA, a)
      if (a > HL_MIN_ALPHA_LARGE + 1e-9) ok(under(c, bg, ink, a) >= 4.5, `letra grande ${ink} sobre ${bg}, marcador ${c} a ${a}: ≥ 4.5:1`)
    }
  }
  ok(worstL >= 3, `letra grande: nunca abaixo de 3:1 (pior ${worstL.toFixed(2)})`, worstL)
  ok(minA >= 0.18, `letra grande: o marcador nunca fica quase invisível (mínimo ${minA})`, minA)
  // Tinta laranja do palco: antes 0.40 dava 2.2:1 com o amarelo; agora a opacidade baixa
  const aO = markerAlpha('#FFE01A', '#0B0B0C', '#FF6A26', 46)
  ok(aO >= HL_MIN_ALPHA_LARGE - 1e-9 && aO < 0.3 && under('#FFE01A', '#0B0B0C', '#FF6A26', aO) >= 3, 'palco com letra laranja: marcador mais leve, letra ≥ 3:1', aO)
  // Letra branca no palco (o normal): mais vivo do que antes (0.40) onde a cor deixa, sem passar do teto
  const white = palette.map(c => markerAlpha(c, '#0B0B0C', '#F2F1EC', 46))
  ok(white.every(a => a >= 0.44 && a <= HL_OPACITY_DARK), 'palco com letra branca: 0.44–0.52 por cor (menos turvo)', white)
  // Folha clara: o teto (a letra escura tem contraste de sobra)
  ok(palette.every(c => markerAlpha(c, '#FFFFFF', '#111111', 32) === HL_OPACITY_LIGHT), 'Ensaio claro: o teto 0.42 em todas as cores')
  // Rótulos de secção (11–13px, cor de acento): ≥ 4.5:1 — Ensaio claro e escuro, palco
  let worstSec = Infinity
  for (const [bg, ink] of [['#FFFFFF', '#B83B0B'], ['#151517', '#FF8A52'], ['#0B0B0C', '#FF6A26']]) {
    for (const c of palette) worstSec = Math.min(worstSec, under(c, bg, ink, markerAlpha(c, bg, ink, 13)))
  }
  ok(worstSec >= 4.5, `rótulos de secção destacados: ≥ 4.5:1 (pior ${worstSec.toFixed(2)})`, worstSec)
  // Cores que não se reconhecem: o teto, sem NaN
  ok(markerAlpha('nada', '#0B0B0C', '#F2F1EC', 32) === HL_OPACITY_DARK && markerAlpha('#FFE01A', null, '#111', 32) === HL_OPACITY_LIGHT, 'cores desconhecidas: o teto do fundo')
  // Tema sem contraste (letra quase da cor do fundo): pede 80% do que tem, não rebenta
  const weak = markerAlpha('#FFE01A', '#333333', '#555555', 18)
  ok(Number.isFinite(weak) && weak >= 0 && weak <= HL_OPACITY_DARK, 'tema com pouco contraste: um valor válido', weak)
})

test('marcador: entrelinha apertada (1.0–1.2) — os retângulos de rows seguidas nunca se sobrepõem', () => {
  const lines = ['Toca mais alto que a chuva lá fora', 'Ninguém arruma os cabos', 'Até a noite acabar de vez', 'Uma linha muito comprida que não cabe inteira no ecrã do telemóvel e tem de quebrar']
  const text = lines.join('\n')
  for (const lh of [1.0, 1.1, 1.2, 1.6]) {
    for (const [name, cfg] of [['palco', { em: 46, width: 900 }], ['telemóvel', { em: 32, width: 360 }]]) {
      const L = makeLayout(text, { ...cfg, lh })
      const hs = [
        mk(L, 0, 'chuva lá fora', PINK, 'a'),
        highlightRange(sweep(L, [1, 0], [1, L.text(1).length - 1]), GREEN, L, 'b')[0],
        mk(L, 2, 'Até a noite', YELLOW, 'c'),
        highlightRange(sweep(L, [3, 0], [3, L.text(3).length - 1], { n: 80 }), YELLOW, L, 'd')[0],
      ]
      const rects = resolveHighlights(hs, L).flatMap(r => r.rects.map(b => ({ ...b, id: r.id })))
      let minGap = Infinity
      const sorted = rects.slice().sort((p, q) => p.top - q.top)
      for (let i = 1; i < sorted.length; i++) {
        const p = sorted[i - 1]
        const q = sorted[i]
        if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 0) minGap = Math.min(minGap, q.top - p.bottom)
      }
      ok(minGap >= 0.99, `${name}, entrelinha ${lh}: ≥ 1px entre os retângulos de rows seguidas (${minGap.toFixed(2)}px)`, minGap)
      const short = Math.min(...rects.map(b => b.bottom - b.top))
      ok(short >= 0.8 * L.em, `${name}, entrelinha ${lh}: os retângulos continuam a cobrir a maior parte da row (${(short / L.em).toFixed(2)}em)`, short)
    }
  }
})

test('desempenho: 80 linhas, 40 traços e 30 destaques resolvem em < 16ms', () => {
  const lines = []
  for (let k = 0; k < 16; k++) lines.push(`[Parte ${k + 1}]`, `Linha ${k} do mar e da luz inventada`, `Outra linha ${k} sem pressa de acabar`, `E mais uma ${k} para o caderno`, '')
  const text = lines.join('\n')
  const S = makeLayout(text, ENSAIO)
  const list = []
  for (let s = 0; s < 40; s++) {
    const ln = 1 + (s % 16) * 5 + (s % 3)
    const [v0, v1] = visible(S, ln)
    list.push(anchorStroke(s % 3 ? underline(S, ln, v0, v1, { n: 150 }) : circle(S, ln, v0 + 1, v0 + 6, { n: 149 }), YELLOW, 4, S, `p${s}`))
  }
  let marks = []
  for (let k = 0; marks.length < 30; k++) {
    const ln = 1 + (k % 16) * 5 + (k % 3)
    const [v0, v1] = visible(S, ln)
    const to = k % 4 === 0 && ln % 5 < 3 ? [ln + 1, visible(S, ln + 1)[0] + 3] : [ln, v1 - 2]
    marks = mergeHighlights(marks, highlightRange(sweep(S, [ln, v0 + 2], to, { n: 40 }), [YELLOW, GREEN, PINK][k % 3], S, `h${k}`), l => S.text(l))
  }
  const items = [...list, ...marks]
  ok(marks.length >= 30, `desempenho: ${marks.length} destaques`)
  let best = Infinity
  let calls = null
  for (let run = 0; run < 7; run++) {
    const D = makeLayout(text, CONCERTO)
    const t0 = performance.now()
    const rs = resolveAll(items, D)
    const rh = resolveHighlights(items, D)
    best = Math.min(best, performance.now() - t0)
    if (rs.some(r => r.hidden) || rh.some(r => r.hidden) || rs.length !== 40 || rh.length !== marks.length) best = Infinity
    calls = D.calls
  }
  ok(best < 16, `desempenho: resolver traços e destaques ${best.toFixed(2)}ms`, best)
  ok(calls.rows <= 80, 'desempenho: rows medidas uma vez por linha', calls.rows)
  const D = makeLayout(text, CONCERTO)
  const a1 = resolveHighlights(items, D)
  const n1 = D.calls.chars
  const a2 = resolveHighlights(items, D)
  ok(a1.every((r, i) => r === a2[i]) && D.calls.chars === n1, 'desempenho: memo por layout (os retângulos não voltam a medir)')
})

/* ── resultado ── */
for (const f of failures) console.log(f)
console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
