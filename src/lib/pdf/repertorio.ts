/**
 * PDF "Repertório" — letras para fazer scroll no tablet durante o concerto.
 *
 *  - Página 1 = capa + índice (cada linha é um link para a música; continua
 *    nas páginas seguintes com o cabeçalho de colunas repetido).
 *  - Cada música começa numa página nova: barra "07 / 22 · Concerto" +
 *    "↑ ÍNDICE" (link para a página do índice onde a música está), título
 *    condensado grande, artista, chips TOM/BPM/CAPO (crescem com a letra),
 *    caixa de notas do concerto, letra grande com secções, "A SEGUIR".
 *  - Paginação para palco: estrofes até 8 linhas não se partem; maiores deixam
 *    ≥2 linhas de cada lado; rótulo de secção nunca órfão e repetido no topo da
 *    página seguinte ("REFRÃO (cont.)"); o "A SEGUIR" nunca arrasta letra.
 *  - Continuações: "07 / 22 · Título (cont.)"; rodapé "CONTINUA ↓".
 */
import { CAP, PAGE_W, labelCs, type FontRole, type Painter } from './painter'
import {
  CONTENT_BOTTOM, CONTENT_TOP, CONTENT_W, MX, TOPBAR_RULE_Y, drawCoverHeader, drawTopBar,
} from './chrome'
import {
  clean, fmtDur, isChordLine, isMixedChordSheet, matchSection, pad2, plural, sectionLabel,
} from './text'
import { canTranspose, lyricsCoverage, normKey, transposeSheet } from './chords'
import type { PdfData, PdfOptions, PdfSize, PdfSong } from './types'

/** Letra: Normal 16 / Grande 20 / Enorme 24 pt (spec). */
const LYRIC_SIZE: Record<PdfSize, number> = { normal: 16, grande: 20, enorme: 24 }
const TITLE_SIZE: Record<PdfSize, number> = { normal: 40, grande: 44, enorme: 50 }
const ARTIST_SIZE: Record<PdfSize, number> = { normal: 14, grande: 15.5, enorme: 17 }

/**
 * Compactação progressiva de uma música (entrelinha 1.45 → 1.3, espaços
 * menores e, em último caso, letra ×0.94). Escolhe-se o primeiro nível que dá
 * o menor número de páginas — uma música que quase cabe não vira a página a
 * meio por duas linhas.
 */
interface Tier { lh: number; gap: number; scale: number }
const TIERS: Tier[] = [
  { lh: 1.45, gap: 1, scale: 1 },
  { lh: 1.37, gap: 0.82, scale: 1 },
  { lh: 1.3, gap: 0.66, scale: 1 },
  { lh: 1.3, gap: 0.6, scale: 0.94 },
]

/** Onde começa o conteúdo numa página de continuação. */
const FLOW_TOP = CONTENT_TOP - 6
const FLOW_H = CONTENT_BOTTOM - FLOW_TOP
/** Estrofes até 8 linhas passam inteiras para a página seguinte em vez de se partirem. */
const STANZA_KEEP_LINES = 8
/** Uma cifra mista só substitui a letra quando tem ≥85% das linhas da letra. */
const COVERAGE_MIN = 0.85
/** Espaço mínimo entre a última linha e o "A SEGUIR" compacto. */
const TAIL_MIN_GAP = 10

/** Linha de base de uma linha de texto numa caixa de altura lh (tamanho s). */
const baselineIn = (top: number, s: number, lh: number) => top + (lh - s) / 2 + s * 0.8

/** Unidade indivisível: uma linha cantada (com as quebras), um par acorde+letra, uma linha de notas. */
interface Row {
  h: number
  /** Linhas visíveis (para a regra das 8 linhas). */
  lines: number
  /** `atTop`: a linha abre uma página de continuação. */
  draw: (y: number, atTop?: boolean) => void
}

/** Rótulo repetido no topo de uma página de continuação: "REFRÃO (cont.)". */
interface Cont { label: string; neutral: boolean }

interface Group {
  kind: 'section' | 'label' | 'stanza' | 'notes' | 'empty'
  /** Espaço antes — ignorado no topo de uma página. */
  gap: number
  rows: Row[]
  /** Secção/rótulo a que o grupo pertence (repete-se se a quebra cair aqui). */
  cont: Cont | null
}

/** "A SEGUIR" / "FIM": versão normal a seguir à letra, ou compacta na faixa acima do rodapé. */
interface Tail {
  gap: number
  h: number
  compactH: number
  drawFull: (y: number) => void
  drawCompact: (y: number) => void
}

export interface RepertorioLayout {
  /** Página onde começa cada música (1-based). */
  songPages: number[]
  /** Páginas cuja música continua na seguinte (rodapé "CONTINUA ↓"). */
  continues: Set<number>
}

/* ─────────────── Fonte do corpo (letra / cifra) ─────────────── */

interface BodySource {
  lyrics: string | null
  chords: string | null
  mixed: boolean
  /** A cifra mista cobre a letra: substitui-a. */
  replace: boolean
  /** O tom mudou mas a cifra não se consegue transpor: avisar em que tom está. */
  chordsKeyNote: string | null
}

function bodySource(song: PdfSong, includeChords: boolean): BodySource {
  const lyrics = song.lyrics?.trim() ? song.lyrics : null
  let chords = includeChords && song.chords?.trim() ? song.chords : null
  let chordsKeyNote: string | null = null
  const orig = normKey(song.originalKey)
  const key = normKey(song.key)
  if (chords && orig && key && orig !== key) {
    if (canTranspose(orig, key)) chords = transposeSheet(chords, orig, key)
    else chordsKeyNote = `TOM ORIGINAL ${clean(orig)}`
  }
  const mixed = !!chords && isMixedChordSheet(chords)
  const replace = !!chords && mixed && (!lyrics || lyricsCoverage(lyrics, chords) >= COVERAGE_MIN)
  return { lyrics, chords, mixed, replace, chordsKeyNote }
}

const hasBody = (b: BodySource) => !!(b.lyrics || b.chords)

/* ─────────────── Render ─────────────── */

export function renderRepertorio(
  p: Painter,
  data: PdfData,
  opts: PdfOptions,
  projectColor: string | null,
): RepertorioLayout {
  const { doc, pal } = p
  const songs = data.songs
  const n = songs.length
  const size = opts.size ?? 'grande'
  const context = data.meta.context ?? 'concert'
  const continues = new Set<number>()
  const sources = songs.map(s => bodySource(s, !!opts.includeChords))

  /* ═════ Capa + índice (página 1) ═════ */
  p.pageBackground()
  const headerBottom = drawCoverHeader(p, data, { kindLabel: 'REPERTÓRIO', projectColor }, 46, 32)

  if (n === 0) {
    const s = 11
    p.text('SEM MÚSICAS', MX, headerBottom + 40, { role: 'mono', size: s, color: pal.ink3, cs: labelCs(s) })
    return { songPages: [], continues }
  }

  // Geometria do índice (o cabeçalho de colunas repete-se nas continuações)
  const colY1 = headerBottom + 17
  const colYN = TOPBAR_RULE_Y + 22
  const firstTop = colY1 + 7
  const nextTop = colYN + 7
  const rowH = Math.min(34, Math.max(26, (CONTENT_BOTTOM - firstTop) / n))
  const cap1 = Math.max(1, Math.floor((CONTENT_BOTTOM - firstTop + 0.01) / rowH))
  const capN = Math.max(1, Math.floor((CONTENT_BOTTOM - nextTop + 0.01) / rowH))
  const indexPages = 1 + Math.max(0, Math.ceil((n - cap1) / capN))
  /** Página do índice onde a música i está listada (destino do "↑ ÍNDICE"). */
  const indexPageOf = (i: number) => (i < cap1 ? 1 : 2 + Math.floor((i - cap1) / capN))

  const idx: IndexGeo = (() => {
    const pageNumSize = 10.5
    const pageColW = p.width('000', 'mono', pageNumSize)
    const keySize = 9.5
    const keyWs = songs.map(s => (s.key?.trim() ? p.width(clean(normKey(s.key)), 'monoBold', keySize) + 12 : 0))
    const keyColW = Math.max(0, ...keyWs)
    return { pageNumSize, pageColW, keySize, keyColW, keyRight: PAGE_W - MX - pageColW - 20 }
  })()

  drawIndexColumns(p, colY1, idx)
  // Páginas de continuação do índice (preenchidas no fim, quando se sabem as páginas)
  for (let i = 1; i < indexPages; i++) {
    doc.addPage()
    p.pageBackground()
    drawTopBar(p, { label: data.meta.title, suffix: ' · Índice (cont.)' })
    drawIndexColumns(p, colYN, idx)
  }

  /* ═════ Músicas ═════ */
  const S0 = LYRIC_SIZE[size]
  const songPages: number[] = []

  songs.forEach((song, i) => {
    const title = clean(song.title).trim() || 'Sem título'
    const indexPage = indexPageOf(i)
    doc.addPage()
    p.pageBackground()
    songPages.push(doc.getNumberOfPages())
    drawTopBar(p, { num: i + 1, total: n, label: data.meta.title, indexPage })

    const startY = drawSongHeader(p, song, title, size) + 18
    const src = sources[i]

    const build = (t: Tier): { groups: Group[]; tail: Tail | null; S: number } => {
      const S = S0 * t.scale
      return {
        groups: buildBody(p, song, src, S, t),
        tail: context === 'concert' ? nextTail(p, songs, i, S, t) : null,
        S,
      }
    }

    // Nível de compactação: o primeiro com o menor número de páginas.
    // Encolher a letra (scale < 1) só numa música curta (até 2 páginas depois
    // de compactada), onde poupa um ecrã quase vazio; numa música longa, que
    // tem várias páginas de qualquer forma, mantém-se o tamanho escolhido.
    let best = build(TIERS[0])
    let bestPages = flowSong(p, best, startY, false, () => {})
    for (const t of TIERS.slice(1)) {
      if (bestPages === 1) break
      const alt = build(t)
      const pages = flowSong(p, alt, startY, false, () => {})
      if (t.scale < 1 && pages > 2) continue
      if (pages < bestPages) { best = alt; bestPages = pages }
    }

    flowSong(p, best, startY, true, () => {
      continues.add(doc.getNumberOfPages())
      doc.addPage()
      p.pageBackground()
      drawTopBar(p, { num: i + 1, total: n, label: title, suffix: ' (cont.)', indexPage })
    })
  })

  /* ═════ Índice (agora que se sabem as páginas) ═════ */
  const idxTitleSize = Math.min(15.5, Math.max(12.5, rowH * 0.47))
  const numSize = 10
  const titleX = MX + p.width('00', 'monoBold', numSize) + 14
  const tagSize = 7.5
  const tagCs = labelCs(tagSize)
  const tagLabel = 'SEM LETRA'
  const tagW = p.width(tagLabel, 'mono', tagSize, tagCs) + 10
  let page = 1
  let y = firstTop
  let onPage = 0
  songs.forEach((song, i) => {
    const capacity = page === 1 ? cap1 : capN
    if (onPage >= capacity) {
      page++
      y = nextTop
      onPage = 0
    }
    doc.setPage(page)
    const target = songPages[i]
    const mid = y + rowH / 2
    const base = mid + (idxTitleSize * CAP.semi) / 2
    p.text(pad2(i + 1), MX, base, { role: 'monoBold', size: numSize, color: pal.ink3 })
    // Página à direita
    p.textRight(String(target), PAGE_W - MX, base, { role: 'mono', size: idx.pageNumSize, color: pal.ink2 })
    // Tom (chip)
    const key = clean(normKey(song.key))
    if (key) {
      const kw = p.width(key, 'monoBold', idx.keySize)
      const cw = kw + 12
      const chH = 17
      const cx = idx.keyRight - idx.keyColW / 2 - cw / 2
      p.roundRect(cx, mid - chH / 2, cw, chH, 3, { stroke: pal.hair2, lw: 0.75 })
      p.text(key, cx + 6, mid + (idx.keySize * CAP.monoBold) / 2, { role: 'monoBold', size: idx.keySize, color: pal.ink })
    }
    // "SEM LETRA" — o músico sabe antes de lá chegar (coluna fixa, antes do tom)
    const tagRight = (idx.keyColW ? idx.keyRight - idx.keyColW : PAGE_W - MX - idx.pageColW) - 14
    // Sem tom, o título pode ocupar a coluna do tom em vez de ser cortado
    let maxTitleRight = key ? tagRight : PAGE_W - MX - idx.pageColW - 18
    if (!hasBody(sources[i])) {
      const tx = tagRight - tagW
      const th = 14
      p.roundRect(tx, mid - th / 2, tagW, th, 2, { stroke: pal.hair2, lw: 0.7 })
      p.text(tagLabel, tx + 5, mid + (tagSize * CAP.mono) / 2, { role: 'mono', size: tagSize, color: pal.ink3, cs: tagCs })
      maxTitleRight = tx - 10
    }
    // Título + artista
    const t = p.fit(clean(song.title).trim() || 'Sem título', maxTitleRight - titleX, 'semi', idxTitleSize)
    const tw = p.text(t, titleX, base, { role: 'semi', size: idxTitleSize, color: pal.ink })
    const artist = clean(song.artist ?? '').trim()
    if (artist) {
      const ax = titleX + tw + 10
      const aSize = idxTitleSize * 0.78
      if (maxTitleRight - ax > 40) {
        const a = p.fit(artist, maxTitleRight - ax, 'body', aSize)
        p.text(a, ax, base, { role: 'body', size: aSize, color: pal.ink3 })
      }
    }
    // A linha inteira é um link para a música
    doc.link(MX - 6, y, CONTENT_W + 12, rowH, { pageNumber: target })
    const lastOnPage = onPage === capacity - 1 || i === n - 1
    if (!lastOnPage) p.hline(MX, PAGE_W - MX, y + rowH, pal.hair, 0.6)
    y += rowH
    onPage++
  })
  doc.setPage(doc.getNumberOfPages())

  return { songPages, continues }
}

/* ─────────────── Índice ─────────────── */

interface IndexGeo { pageNumSize: number; pageColW: number; keySize: number; keyColW: number; keyRight: number }

function drawIndexColumns(p: Painter, y: number, g: IndexGeo) {
  const { pal } = p
  const s = 8
  const cs = labelCs(s)
  p.text('ÍNDICE  ·  TOCA NUMA MÚSICA PARA ABRIR A LETRA', MX, y, { role: 'mono', size: s, color: pal.ink3, cs })
  p.textRight('PÁG.', PAGE_W - MX, y, { role: 'mono', size: s, color: pal.ink3, cs })
  if (g.keyColW) {
    const w = p.width('TOM', 'mono', s, cs)
    p.text('TOM', g.keyRight - g.keyColW / 2 - w / 2, y, { role: 'mono', size: s, color: pal.ink3, cs })
  }
}

/* ─────────────── Paginação de uma música ─────────────── */

const sumH = (rows: Row[]) => rows.reduce((a, r) => a + r.h, 0)
const sumLines = (rows: Row[]) => rows.reduce((a, r) => a + r.lines, 0)

/**
 * Corre o fluxo de uma música a partir de startY. Com draw=false só conta as
 * páginas (para escolher o nível de compactação). Devolve o nº de páginas.
 */
function flowSong(
  p: Painter,
  body: { groups: Group[]; tail: Tail | null; S: number },
  startY: number,
  draw: boolean,
  addPage: () => void,
): number {
  const { groups, tail, S } = body
  let y = startY
  let atTop = false
  let pages = 1

  const place = (r: Row) => {
    if (draw) r.draw(y, atTop)
    y += r.h
    atTop = false
  }
  const contH = (c: Cont | null) => (c ? contRow(p, c, S).h : 0)
  const newPage = (cont: Cont | null) => {
    pages++
    if (draw) addPage()
    y = FLOW_TOP
    if (cont) place(contRow(p, cont, S))
    atTop = true
  }
  /** Grupos que não se partem (se couberem numa página nova). */
  const whole = (g: Group) => {
    const h = sumH(g.rows)
    if (g.kind === 'stanza') return sumLines(g.rows) <= STANZA_KEEP_LINES && h <= FLOW_H - contH(g.cont)
    if (g.kind === 'notes') return h <= FLOW_H * 0.4
    return true
  }
  const minSide = (g: Group) => (g.kind === 'stanza' ? 2 : 1)
  /** Altura que tem de caber com um rótulo para ele não ficar órfão no fundo. */
  const headNeed = (gi: number, depth = 0): number => {
    const g = groups[gi]
    if (!g) return 0
    const h = sumH(g.rows)
    if (g.kind === 'section' || g.kind === 'label') return g.gap + h + (depth < 3 ? headNeed(gi + 1, depth + 1) : 0)
    if (whole(g)) return g.gap + h
    return g.gap + sumH(g.rows.slice(0, minSide(g)))
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    if (g.kind === 'section' || g.kind === 'label') {
      const need = headNeed(gi) - (atTop ? g.gap : 0)
      if (!atTop && y + need > CONTENT_BOTTOM) newPage(null)
      if (!atTop) y += g.gap
      g.rows.forEach(place)
      continue
    }
    const gap = atTop ? 0 : g.gap
    if (y + gap + sumH(g.rows) <= CONTENT_BOTTOM) {
      y += gap
      g.rows.forEach(place)
      continue
    }
    if (whole(g)) {
      // Passa inteira para a página seguinte (com "SECÇÃO (cont.)" por cima)
      if (!atTop) newPage(g.cont)
      g.rows.forEach(place)
      continue
    }
    // Estrofe grande: parte deixando ≥2 linhas de cada lado
    const side = minSide(g)
    let rest = g.rows
    let first = true
    while (rest.length) {
      const gp = atTop || !first ? 0 : g.gap
      if (y + gp + sumH(rest) <= CONTENT_BOTTOM) {
        y += gp
        rest.forEach(place)
        break
      }
      let fit = 0
      let acc = y + gp
      while (fit < rest.length && acc + rest[fit].h <= CONTENT_BOTTOM) { acc += rest[fit].h; fit++ }
      let m = Math.min(fit, rest.length - side)
      if (m < side) {
        if (!atTop) { newPage(g.cont); first = false; continue }
        m = Math.max(1, fit) // nem numa página nova cabe: parte onde der
      }
      y += gp
      rest.slice(0, m).forEach(place)
      rest = rest.slice(m)
      first = false
      if (rest.length) newPage(g.cont)
    }
  }

  // "A SEGUIR": a seguir à letra; senão compacto na faixa acima do rodapé;
  // senão sozinho na página seguinte. Nunca arrasta letra.
  if (tail) {
    const gap = atTop ? 0 : tail.gap
    if (y + gap + tail.h <= CONTENT_BOTTOM) {
      if (draw) tail.drawFull(y + gap)
    } else if (y + TAIL_MIN_GAP + tail.compactH <= CONTENT_BOTTOM) {
      if (draw) tail.drawCompact(CONTENT_BOTTOM - tail.compactH)
    } else {
      newPage(null)
      if (draw) tail.drawFull(y)
    }
  }
  return pages
}

/* ─────────────── Cabeçalho da música ─────────────── */

/** Chips TOM/BPM/CAPO: crescem com a letra (o tom é o que a banda mais procura). */
interface ChipSizes { val: number; lbl: number; h: number; padX: number; gap: number }
function chipSizes(S: number): ChipSizes {
  const val = Math.max(12, S * 0.8)
  return { val, lbl: Math.max(8.5, S * 0.45), h: val * 1.8, padX: val * 0.58, gap: val * 0.42 }
}

function drawSongHeader(p: Painter, song: PdfSong, title: string, size: PdfSize): number {
  const { pal } = p
  const S = LYRIC_SIZE[size]
  const TS = TITLE_SIZE[size]
  const ts = p.fitSize(title, 'display', TS, TS * 0.72, CONTENT_W)
  let lines = p.wrap(title, CONTENT_W, CONTENT_W, 'display', ts)
  if (lines.length > 3) lines = [lines[0], lines[1], p.fit(lines.slice(2).join(' '), CONTENT_W, 'display', ts)]
  let base = CONTENT_TOP + ts * CAP.display
  lines.forEach((ln, i) => p.text(ln, MX, base + i * ts * 0.98, { role: 'display', size: ts, color: pal.ink }))
  base += (lines.length - 1) * ts * 0.98
  let y = base + ts * 0.18

  const artist = clean(song.artist ?? '').trim()
  if (artist) {
    // Espaço para as descendentes do título ("g", "ç", parênteses) não tocarem
    // nos acentos do artista ("Úteis")
    const as = ARTIST_SIZE[size]
    const ab = base + ts * 0.22 + 6 + as * 0.9
    p.text(p.fit(artist, CONTENT_W, 'body', as), MX, ab, { role: 'body', size: as, color: pal.ink2 })
    y = ab + as * 0.22
  }

  // Chips mono: TOM G · ORIG. A · 104 BPM · CAPO 2 · 3:45
  const cs = chipSizes(S)
  const chips: ChipPart[][] = []
  const key = clean(normKey(song.key))
  const orig = clean(normKey(song.originalKey))
  if (key) chips.push([lbl('TOM', cs), val(key, cs)])
  if (song.bpm && song.bpm > 0) chips.push([val(String(Math.round(song.bpm)), cs), lbl('BPM', cs)])
  if (song.capo && song.capo > 0) chips.push([lbl('CAPO', cs), val(String(song.capo), cs)])
  const dur = fmtDur(song.durationSec)
  if (chips.length || dur) {
    const top = y + 12
    const mid = top + cs.h / 2
    const right = PAGE_W - MX
    let x = MX
    chips.forEach((parts, ci) => {
      const cw = chipWidth(p, parts, cs)
      if (x + cw > right) return
      x += drawChip(p, x, top, parts, cs) + cs.gap * 1.5
      // Tom do concerto diferente do original: "ORIG. A" logo a seguir ao chip do tom
      if (ci === 0 && key && orig && orig !== key) {
        const os = cs.lbl
        x += p.text(`ORIG. ${orig}`, x, mid + (os * CAP.mono) / 2, { role: 'mono', size: os, color: pal.ink3, cs: labelCs(os) }) + cs.gap * 2
      }
    })
    if (dur) {
      const ds = Math.max(10.5, S * 0.6)
      if (x + p.width(dur, 'mono', ds) <= right) {
        p.text(dur, x + (chips.length ? 2 : 0), mid + (ds * CAP.mono) / 2, { role: 'mono', size: ds, color: pal.ink3 })
      }
    }
    y = top + cs.h
  }
  return y
}

interface ChipPart { text: string; role: FontRole; size: number; color: 'ink' | 'ink3'; cs: number }
const lbl = (text: string, s: ChipSizes): ChipPart => ({ text, role: 'mono', size: s.lbl, color: 'ink3', cs: labelCs(s.lbl) })
const val = (text: string, s: ChipSizes): ChipPart => ({ text, role: 'monoBold', size: s.val, color: 'ink', cs: 0 })

function chipWidth(p: Painter, parts: ChipPart[], s: ChipSizes): number {
  const widths = parts.map(pt => p.width(pt.text, pt.role, pt.size, pt.cs))
  return s.padX * 2 + widths.reduce((a, b) => a + b, 0) + s.gap * (parts.length - 1)
}

/** Chip mono seco com contorno. Devolve a largura. */
function drawChip(p: Painter, x: number, top: number, parts: ChipPart[], s: ChipSizes): number {
  const w = chipWidth(p, parts, s)
  p.roundRect(x, top, w, s.h, 3, { stroke: p.pal.hair2, lw: 0.8 })
  const base = top + s.h / 2 + (s.val * CAP.monoBold) / 2
  let cx = x + s.padX
  parts.forEach(pt => {
    cx += p.text(pt.text, cx, base, { role: pt.role, size: pt.size, color: p.pal[pt.color], cs: pt.cs }) + s.gap
  })
  return w
}

/* ─────────────── Corpo ─────────────── */

function buildBody(p: Painter, song: PdfSong, src: BodySource, S: number, t: Tier): Group[] {
  const groups: Group[] = []
  const add = (gs: Group[], gap: number) => {
    if (!gs.length) return
    if (groups.length) gs[0].gap = gap
    groups.push(...gs)
  }
  const partGap = S * 1.1 * t.gap

  // Notas do concerto (intro / final / notas) — no fluxo, para poderem paginar
  const notes: [string, string][] = ([
    ['INTRO', song.intro], ['FINAL', song.ending], ['NOTAS', song.notes],
  ] as [string, string | null | undefined][])
    .filter((r): r is [string, string] => !!r[1]?.trim())
    .map(([l, v]) => [l, clean(v.trim())])
  if (notes.length) add([notesGroup(p, notes, S, !hasBody(src))], 0)

  const { lyrics, chords, mixed, replace, chordsKeyNote } = src
  if (chords && replace) {
    // Cifra com a letra toda por baixo dos acordes: substitui a letra
    if (chordsKeyNote) add([labelGroup(p, `ACORDES · ${chordsKeyNote}`, S)], partGap)
    add(chordGroups(p, chords, S, t, true, chordsKeyNote ? { label: 'ACORDES', neutral: true } : null), chordsKeyNote ? 0 : partGap)
  } else {
    if (chords) {
      const acordes: Cont = { label: 'ACORDES', neutral: true }
      add([labelGroup(p, chordsKeyNote ? `ACORDES · ${chordsKeyNote}` : 'ACORDES', S)], partGap)
      add(chordGroups(p, chords, S, t, mixed, acordes), 0)
    }
    if (lyrics) {
      const letra: Cont | null = chords ? { label: 'LETRA', neutral: true } : null
      if (letra) add([labelGroup(p, 'LETRA', S)], S * 1.3 * t.gap)
      add(lyricGroups(p, lyrics, S, t, letra), letra ? 0 : partGap)
    }
    if (!chords && !lyrics) add([emptyGroup(p, S)], partGap)
  }
  return groups
}

function sectionRow(p: Painter, label: string, S: number, suffix = ''): Row {
  const ls = Math.max(10, S * 0.62)
  const cs = labelCs(ls) * 1.2
  const h = ls * 1.1 + S * 0.3
  return {
    h, lines: 0,
    draw: y => {
      const w = p.text(label, MX, y + ls * 0.9, { role: 'monoBold', size: ls, color: p.pal.accentText, cs })
      if (suffix) p.text(suffix, MX + w, y + ls * 0.9, { role: 'mono', size: ls, color: p.pal.ink3, cs: cs * 0.5 })
    },
  }
}

/** Rótulo neutro ("ACORDES", "LETRA") com hairline até à margem. */
function labelRow(p: Painter, label: string, S: number, suffix = ''): Row {
  const ls = Math.max(9, S * 0.5)
  const cs = labelCs(ls)
  const h = ls * 1.1 + S * 0.45
  return {
    h, lines: 0,
    draw: y => {
      const base = y + ls * 0.9
      let w = p.text(label, MX, base, { role: 'mono', size: ls, color: p.pal.ink3, cs })
      if (suffix) w += p.text(suffix, MX + w, base, { role: 'mono', size: ls, color: p.pal.ink3, cs: cs * 0.5 })
      p.hline(MX + w + 10, PAGE_W - MX, base - (ls * CAP.mono) / 2, p.pal.hair, 0.6)
    },
  }
}

function contRow(p: Painter, c: Cont, S: number): Row {
  return c.neutral ? labelRow(p, c.label, S, ' (cont.)') : sectionRow(p, c.label, S, ' (cont.)')
}

function labelGroup(p: Painter, label: string, S: number): Group {
  return { kind: 'label', gap: 0, rows: [labelRow(p, label, S)], cont: null }
}

/**
 * Agrupa um texto em secções e estrofes. `row` transforma as linhas de texto
 * da estrofe em unidades indivisíveis (a cifra junta acorde + letra).
 */
function stanzaGroups(
  p: Painter,
  text: string,
  S: number,
  cont0: Cont | null,
  gaps: { stanza: number; section: number },
  rowsFor: (lines: string[], idx: number) => { rows: Row[]; consumed: number },
): Group[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: Group[] = []
  let cont = cont0
  let cur: Group | null = null
  let pending = 0
  for (let i = 0; i < lines.length;) {
    const trimmed = lines[i].trim()
    if (!trimmed) { cur = null; pending = Math.max(pending, gaps.stanza); i++; continue }
    const sec = matchSection(trimmed)
    if (sec) {
      const label = sectionLabel(sec)
      out.push({ kind: 'section', gap: out.length ? Math.max(pending, gaps.section) : 0, rows: [sectionRow(p, label, S)], cont: null })
      cont = { label, neutral: false }
      cur = null
      pending = 0
      i++
      continue
    }
    const { rows, consumed } = rowsFor(lines, i)
    i += Math.max(1, consumed)
    if (!rows.length) continue
    if (!cur) {
      cur = { kind: 'stanza', gap: out.length ? pending : 0, rows: [], cont }
      out.push(cur)
    }
    cur.rows.push(...rows)
    pending = 0
  }
  return out
}

function lyricGroups(p: Painter, text: string, S: number, t: Tier, cont0: Cont | null): Group[] {
  const lh = S * t.lh
  const indent = S * 1.3
  return stanzaGroups(p, text, S, cont0, { stanza: S * 0.75 * t.gap, section: S * 1.05 * t.gap }, (lines, i) => {
    const txt = clean(lines[i].trim())
    if (!txt) return { rows: [], consumed: 1 }
    // Linhas longas quebram com recuo (a continuação lê-se como a mesma linha)
    const wrapped = p.wrap(txt, CONTENT_W, CONTENT_W - indent, 'body', S)
    return {
      consumed: 1,
      rows: [{
        h: wrapped.length * lh,
        lines: wrapped.length,
        draw: y => wrapped.forEach((ln, k) =>
          p.text(ln, k === 0 ? MX : MX + indent, baselineIn(y + k * lh, S, lh), { role: 'body', size: S, color: p.pal.ink })),
      }],
    }
  })
}

/**
 * Cifra em mono (colunas alinhadas). mixed=true: acordes no acento por cima
 * da letra em tinta; o tamanho desce do ideal (90% da letra) até 75% para a
 * linha mais comprida caber inteira — um par acorde + letra partido em dois é
 * o que mais custa a ler em palco; só se nem assim couber é que a linha quebra
 * (acorde e letra partidos na mesma coluna). false: grelha só de acordes.
 * Um acorde por cima de uma linha de letra sai sempre no acento, mesmo numa
 * cifra que é quase toda grelha.
 */
function chordGroups(p: Painter, text: string, S: number, t: Tier, mixed: boolean, cont0: Cont | null): Group[] {
  const clines = text.replace(/\r\n?/g, '\n').split('\n').map(l => clean(l).replace(/\s+$/, ''))
  const maxLen = Math.max(1, ...clines.filter(l => l.trim() && !matchSection(l)).map(l => l.length))
  const ideal = S * 0.9
  // Tamanho a que a linha mais comprida cabe (margem contra o arredondamento)
  const fitAll = (CONTENT_W / (MONO_ADVANCE * maxLen)) * 0.995
  const ms = mixed
    ? Math.min(ideal, Math.max(Math.max(11, S * 0.75), fitAll))
    : Math.max(Math.min(ideal, Math.max(10.5, S * 0.65)), Math.min(ideal, fitAll))
  const maxChars = Math.max(10, Math.floor(CONTENT_W / (MONO_ADVANCE * ms)))
  const lh = ms * (t.lh - 0.1)
  const chordLh = ms * Math.min(1.18, t.lh - 0.2)
  /** Acorde → letra por baixo (linha de base a linha de base): o acorde cola à
   *  sua letra e o par seguinte fica visivelmente mais longe. */
  const pairGap = ms * 1.14

  interface Item { text: string; chord: boolean; accent?: boolean }
  const rowOf = (items: Item[]): Row => {
    const heights = items.map((r, k) => (r.chord && items[k + 1] && !items[k + 1].chord ? chordLh : lh))
    return {
      h: heights.reduce((a, b) => a + b, 0),
      lines: items.filter(r => !r.chord).length || items.length,
      draw: y => {
        const bases: number[] = []
        let yy = y
        items.forEach((_, k) => { bases.push(baselineIn(yy, ms, heights[k])); yy += heights[k] })
        items.forEach((r, k) => {
          const pairedWithNext = r.chord && items[k + 1] && !items[k + 1].chord
          const base = pairedWithNext ? bases[k + 1] - pairGap : bases[k]
          p.text(r.text, MX, base, {
            role: r.chord ? 'monoBold' : 'mono',
            size: ms,
            color: r.chord && (r.accent ?? mixed) ? p.pal.accentText : p.pal.ink,
          })
        })
      },
    }
  }

  return stanzaGroups(p, text, S, cont0, { stanza: ms * 0.8 * t.gap, section: S * 0.9 * t.gap }, (_raw, i) => {
    const line = clines[i]
    if (!line.trim()) return { rows: [], consumed: 1 }
    const chord = isChordLine(line)
    const next = clines[i + 1]
    if (chord && next && next.trim() && !matchSection(next) && !isChordLine(next)) {
      // Par acorde + letra: parte os dois na mesma coluna para não desalinhar;
      // cada pedaço (acorde + letra) é uma unidade que fica junta. Os pedaços
      // de continuação levam um recuo de 2 colunas (nos dois, por isso as
      // colunas mantêm-se) e perdem a linha de acordes se ficar vazia.
      const rows: Row[] = []
      const pair = (cs: string, ls: string, cont: boolean) => {
        const pre = cont ? CHORD_CONT_INDENT : ''
        rows.push(rowOf(cs.trim()
          ? [{ text: pre + cs, chord: true, accent: true }, { text: pre + ls, chord: false }]
          : [{ text: pre + ls, chord: false }]))
      }
      let c = line
      let l = next
      let cont = false
      for (;;) {
        const lim = cont ? maxChars - CHORD_CONT_INDENT.length : maxChars
        if (c.length <= lim && l.length <= lim) break
        const cut = pairCut(c, l, lim)
        pair(c.slice(0, cut), l.slice(0, cut), cont)
        const cRest = c.slice(cut)
        const lRest = l.slice(cut)
        const lead = cRest.trim() ? Math.min(leadingSpaces(cRest), leadingSpaces(lRest)) : leadingSpaces(lRest)
        c = cRest.slice(Math.min(lead, cRest.length))
        l = lRest.slice(lead)
        cont = true
      }
      pair(c, l, cont)
      return { rows, consumed: 2 }
    }
    const wrapped = line.length > maxChars
      ? p.wrap(line, CONTENT_W, CONTENT_W, chord ? 'monoBold' : 'mono', ms)
      : [line]
    return { rows: wrapped.map(w => rowOf([{ text: w, chord }])), consumed: 1 }
  })
}

/** Avanço de um carácter da JetBrains Mono (600/1000 em). */
const MONO_ADVANCE = 0.6
const leadingSpaces = (s: string) => s.length - s.trimStart().length
/** Recuo das continuações de um par acorde + letra partido. */
const CHORD_CONT_INDENT = '  '

/**
 * Coluna onde partir um par acorde + letra (≤ lim): de preferência num espaço
 * da letra sem partir nenhum acorde ao meio; senão num espaço da letra; senão lim.
 */
function pairCut(c: string, l: string, lim: number): number {
  const solid = (s: string, k: number) => k >= 0 && k < s.length && s[k] !== ' '
  const lyricGap = (k: number) => k >= l.length || l[k] === ' '
  const min = Math.ceil(lim * 0.5)
  for (let k = lim; k >= min; k--) {
    if (lyricGap(k) && !(solid(c, k - 1) && solid(c, k))) return k
  }
  for (let k = lim; k >= min; k--) if (lyricGap(k)) return k
  return lim
}

/**
 * Caixa de notas do concerto (intro / final / notas) com barra de acento.
 * Uma unidade por linha (painel desenhado aos bocados), por isso notas longas
 * paginam em vez de passarem por cima do rodapé. `big`: música sem letra —
 * as notas são tudo o que o músico tem, saem ao tamanho da letra.
 */
function notesGroup(p: Painter, entries: [string, string][], S: number, big: boolean): Group {
  const { pal } = p
  const vs = big ? Math.max(14, S) : Math.min(18, Math.max(12.5, S * 0.8))
  const lh = vs * 1.35
  const ls = Math.max(8.5, vs * 0.55)
  const lcs = labelCs(ls)
  const bar = 3
  const padX = 14
  const padY = 9
  const rowGap = 4
  const labelW = Math.max(...entries.map(([l]) => p.width(l, 'monoBold', ls, lcs))) + 12
  const valueX = MX + bar + padX + labelW
  const valueW = PAGE_W - MX - padX - valueX
  const laid = entries.map(([l, v]) => ({
    label: l,
    lines: v.split('\n').flatMap(part => p.wrap(part.trim(), valueW, valueW, 'body', vs)),
  }))
  const rows: Row[] = []
  laid.forEach((r, ri) => r.lines.forEach((ln, li) => {
    const top = ri === 0 && li === 0 ? padY : 0
    const lastOfBox = ri === laid.length - 1 && li === r.lines.length - 1
    const bottom = lastOfBox ? padY : li === r.lines.length - 1 ? rowGap : 0
    const h = top + lh + bottom
    const firstOfBox = ri === 0 && li === 0
    rows.push({
      h, lines: 1,
      draw: (y, atTop) => {
        // Caixa partida: a fatia que abre a página seguinte ganha margem em
        // cima (desenhada acima da linha, na folga do topo) e repete o rótulo
        const reopen = !!atTop && !firstOfBox
        const y0 = reopen ? y - padY : y
        // Sobreposição entre fatias para não aparecer uma costura; o painel não
        // pinta a coluna da barra (senão cortava a sobreposição da barra de cima)
        const hh = (lastOfBox ? h : h + 0.6) + (y - y0)
        p.fillRect(MX + bar, y0, CONTENT_W - bar, hh, pal.panel)
        const up = firstOfBox || reopen ? 0 : 0.8
        p.fillRect(MX, y0 - up, bar, hh + up, pal.accent)
        const b = baselineIn(y + top, vs, lh)
        if (li === 0 || reopen) {
          p.text(r.label, MX + bar + padX, b - (vs * CAP.body - ls * CAP.monoBold) / 2, { role: 'monoBold', size: ls, color: pal.accentText, cs: lcs })
        }
        p.text(ln, valueX, b, { role: 'body', size: vs, color: pal.ink })
      },
    })
  }))
  return { kind: 'notes', gap: 0, rows, cont: null }
}

/** Música sem letra (nem cifra): "SEM LETRA" bem visível — as notas ficam por cima. */
function emptyGroup(p: Painter, S: number): Group {
  const ls = Math.max(11, S * 0.62)
  const h = Math.max(56, ls * 4.4)
  return {
    kind: 'empty', gap: 0, cont: null,
    rows: [{
      h, lines: 1,
      draw: y => {
        const { pal, doc } = p
        doc.setLineDashPattern([3, 3], 0)
        p.roundRect(MX, y, CONTENT_W, h, 6, { stroke: pal.hair2, lw: 0.9 })
        doc.setLineDashPattern([], 0)
        p.text('SEM LETRA', MX + 18, y + h / 2 + (ls * CAP.monoBold) / 2, { role: 'monoBold', size: ls, color: pal.ink2, cs: labelCs(ls) })
      },
    }],
  }
}

/* ─────────────── "A SEGUIR" ─────────────── */

/** "A SEGUIR ▶ 08  Título   TOM G" — o cantor sabe o que vem. Na última: "FIM". */
function nextTail(p: Painter, songs: PdfSong[], i: number, S: number, t: Tier): Tail {
  const { pal } = p
  const next = songs[i + 1]
  const gap = Math.max(22, S * 1.3) * t.gap
  // Normal: cresce com a letra
  const ts = Math.max(18, S)
  const ns = Math.max(14, S * 0.8)
  const ls = Math.max(9, S * 0.45)
  const padT = 14
  const h = padT + ts * CAP.semi + Math.max(14, ts * 0.6)
  // Compacta: uma linha na faixa acima do rodapé
  const cts = Math.max(12.5, S * 0.66)
  const cls = Math.max(8.5, S * 0.4)
  const compactH = Math.max(28, cts * 2.1)
  const cs = chipSizes(S)
  const nextKey = next ? clean(normKey(next.key)) : ''
  const nextTitle = next ? clean(next.title).trim() || 'Sem título' : ''

  const line = (y: number, base: number, sz: { t: number; n: number; l: number }, compact: boolean) => {
    p.hline(MX, PAGE_W - MX, y, pal.hair2, 0.9)
    const lcs = labelCs(sz.l)
    let x = MX
    if (!next) {
      x += p.text('FIM', x, base, { role: 'monoBold', size: sz.l, color: pal.ink2, cs: lcs })
      p.text(`  ·  ${plural(songs.length, 'MÚSICA', 'MÚSICAS')}`, x, base, { role: 'mono', size: sz.l, color: pal.ink3, cs: lcs })
      return
    }
    x += p.text('A SEGUIR', x, base, { role: 'mono', size: sz.l, color: pal.ink3, cs: lcs }) + sz.l * 1.3
    const tri = sz.n * 0.72
    p.play(x, base, tri, pal.accent)
    x += tri * 0.86 + sz.n * 0.6
    x += p.text(pad2(i + 2), x, base, { role: 'monoBold', size: sz.n, color: pal.accentText }) + sz.n * 0.65
    let right = PAGE_W - MX
    if (nextKey) {
      if (compact) {
        const kw = p.width(nextKey, 'monoBold', sz.n)
        p.text(nextKey, right - kw, base, { role: 'monoBold', size: sz.n, color: pal.ink })
        const tw = p.width('TOM ', 'mono', sz.l, lcs)
        p.text('TOM ', right - kw - tw, base, { role: 'mono', size: sz.l, color: pal.ink3, cs: lcs })
        right -= kw + tw + 14
      } else {
        const parts = [lbl('TOM', cs), val(nextKey, cs)]
        const w = chipWidth(p, parts, cs)
        drawChip(p, right - w, base - (ts * CAP.semi) / 2 - cs.h / 2, parts, cs)
        right -= w + 14
      }
    }
    const title = p.fit(nextTitle, right - x, 'semi', sz.t)
    p.text(title, x, base, { role: 'semi', size: sz.t, color: pal.ink })
  }

  return {
    gap,
    h: next ? h : padT + ls * CAP.mono + 14,
    compactH: next ? compactH : 26,
    drawFull: y => line(y, next ? y + padT + ts * CAP.semi : y + padT + ls * CAP.mono, { t: ts, n: ns, l: ls }, false),
    drawCompact: y => {
      const hh = next ? compactH : 26
      line(y, y + hh / 2 + (cts * CAP.semi) / 2 + 1, { t: cts, n: cts, l: cls }, true)
    },
  }
}
