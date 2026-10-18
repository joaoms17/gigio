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
  anchorFree, marginGutter, decodeAnchoredParts, unionById, unionExtra,
} = A
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

/* ── resultado ── */
for (const f of failures) console.log(f)
console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
