/**
 * PDF "Alinhamento" — a lista para imprimir e colar no palco (ou partilhar
 * rápido). Numeração mono grande, título em Archivo condensado 800 (mais negro
 * e mais estreito: mais tamanho na mesma largura), tom à direita; notas do
 * concerto numa linha mono por baixo (até 2 linhas, nunca cortadas a meio de
 * um rótulo). O tamanho ajusta-se para caber numa página; acima disso pagina,
 * com o maior tamanho que cabe no mesmo número de páginas.
 * `titlesOnly`: só números, títulos e tons — letra ainda maior.
 */
import { CAP, PAGE_W, labelCs, type FontRole, type Painter } from './painter'
import { CONTENT_BOTTOM, MX, TOPBAR_RULE_Y, drawCoverHeader, drawTopBar } from './chrome'
import { clean, pad2 } from './text'
import { normKey } from './chords'
import { pdfKindName, type PdfData, type PdfSong } from './types'

const MAX_T = 36
const MIN_T = 15
/** Linhas de notas por música. */
const MAX_SUB_LINES = 2
const SEP = '  ·  '
/** Entrelinha do título quando quebra. */
const TITLE_LH = 1.02

/** `name`: nome próprio (artista) — em Archivo, não em mono (mono é para rótulos e valores). */
interface SubSeg { label?: string; value: string; name?: boolean }
interface Piece { label?: string; value: string; sep: boolean; name?: boolean }

/** O nome sai em Archivo um pouco maior que o mono, para igualar a altura-x. */
const NAME_SCALE = 1.12
const valRole = (name?: boolean): FontRole => (name ? 'body' : 'mono')

interface Row {
  ts: number
  lines: string[]
  sub: Piece[][]
  h: number
}

interface Geometry {
  T: number
  numSize: number
  titleX: number
  keySize: number
  subSize: number
  subLh: number
  padT: number
  rows: Row[]
}

const oneLine = (s: string) => clean(s).replace(/\s*\n+\s*/g, ' / ').trim()

function subSegments(s: PdfSong, showArtist: boolean): SubSeg[] {
  const segs: SubSeg[] = []
  if (showArtist && s.artist?.trim()) segs.push({ value: oneLine(s.artist), name: true })
  if (s.intro?.trim()) segs.push({ label: 'INTRO', value: oneLine(s.intro) })
  if (s.ending?.trim()) segs.push({ label: 'FINAL', value: oneLine(s.ending) })
  if (s.notes?.trim()) segs.push({ label: 'NOTAS', value: oneLine(s.notes) })
  return segs
}

/**
 * Distribui os segmentos por até 2 linhas, sem nunca partir um segmento entre
 * linhas quando há mais do que um (um segmento por linha quando não cabem
 * juntos). Um segmento único e comprido quebra por palavras nas 2 linhas.
 * Só se corta com "…" quando não há outra hipótese, e só se o rótulo e parte
 * do valor couberem — o separador "·" nunca fica pendurado.
 */
function layoutSegments(p: Painter, segs: SubSeg[], maxW: number, size: number): Piece[][] {
  if (!segs.length) return []
  const cs = labelCs(size) * 0.5
  const sepW = p.width(SEP, 'mono', size, cs)
  const lblW = (l?: string) => (l ? p.width(`${l} `, 'monoBold', size, cs) : 0)
  // Estilo do valor: mono (notas) ou Archivo (nome do artista)
  const vs = (name?: boolean) => (name ? size * NAME_SCALE : size)
  const vcs = (name?: boolean) => (name ? 0 : cs)
  const valW = (v: string, name?: boolean) => p.width(v, valRole(name), vs(name), vcs(name))
  const fitVal = (v: string, w: number, name?: boolean) => p.fit(v, w, valRole(name), vs(name), vcs(name))
  const minVal = p.width('00000', 'mono', size, cs)

  if (segs.length === 1) {
    const s = segs[0]
    const lw = lblW(s.label)
    if (lw + valW(s.value, s.name) <= maxW) return [[{ label: s.label, value: s.value, sep: false, name: s.name }]]
    const parts = p.wrap(s.value, maxW - lw, maxW, valRole(s.name), vs(s.name), vcs(s.name))
    const rest = parts.slice(1).join(' ')
    return [
      [{ label: s.label, value: parts[0], sep: false, name: s.name }],
      [{ value: fitVal(rest, maxW, s.name), sep: false, name: s.name }],
    ]
  }

  const lines: Piece[][] = [[]]
  let x = 0
  for (const seg of segs) {
    let cur = lines[lines.length - 1]
    const lw = lblW(seg.label)
    const full = lw + valW(seg.value, seg.name)
    if (x + (cur.length ? sepW : 0) + full <= maxW) {
      x += (cur.length ? sepW : 0) + full
      cur.push({ label: seg.label, value: seg.value, sep: cur.length > 0, name: seg.name })
      continue
    }
    // Não cabe no resto desta linha: passa para a seguinte, se houver
    if (cur.length && lines.length < MAX_SUB_LINES) {
      cur = []
      lines.push(cur)
      x = 0
    }
    const lead = cur.length ? sepW : 0
    const room = maxW - x - lead - lw
    if (room < minVal) break
    const v = full <= maxW - x - lead ? seg.value : fitVal(seg.value, room, seg.name)
    if (!v) break
    cur.push({ label: seg.label, value: v, sep: cur.length > 0, name: seg.name })
    x += lead + lw + valW(v, seg.name)
    if (v !== seg.value) {
      if (lines.length >= MAX_SUB_LINES) break
      // Linha cheia: o segmento seguinte começa na linha de baixo
      lines.push([])
      x = 0
    }
  }
  return lines.filter(l => l.length)
}

function measure(p: Painter, songs: PdfSong[], subs: SubSeg[][], T: number): Geometry {
  const numSize = T * 0.7
  const numW = p.width('00', 'monoBold', numSize)
  const titleX = MX + numW + T * 0.55
  const keySize = Math.max(10.5, T * 0.6)
  const keyWs = songs.map(s => (s.key?.trim() ? p.width(clean(normKey(s.key)), 'monoBold', keySize) + keySize * 1.1 : 0))
  const keyColW = Math.max(0, ...keyWs)
  const titleMaxW = PAGE_W - MX - titleX - (keyColW ? keyColW + T * 0.6 : 0)
  const subSize = Math.min(12.5, Math.max(10.5, T * 0.5))
  const subLh = subSize * 1.45
  const padT = T * 0.33
  const padB = T * 0.3
  const rows = songs.map((s, i): Row => {
    const title = clean(s.title).trim() || 'Sem título'
    // Sem tom, o título pode usar a largura toda
    const maxW = s.key?.trim() ? titleMaxW : PAGE_W - MX - titleX
    // Encolhe até 80% para caber numa linha. Se nem assim cabe, quebra em 2
    // linhas ao tamanho da lista (igual às vizinhas — antes saía pequeno E
    // partido); só encolhe se nem em 2 linhas couber.
    let ts = p.fitSize(title, 'display', T, 0, maxW)
    let lines = [title]
    if (ts < T * 0.8) {
      ts = T
      lines = p.wrap(title, maxW, maxW, 'display', ts)
      while (lines.length > 2 && ts > T * 0.75) {
        ts = Math.max(T * 0.75, ts - 0.5)
        lines = p.wrap(title, maxW, maxW, 'display', ts)
      }
      if (lines.length > 2) lines = [lines[0], p.fit(lines.slice(1).join(' '), maxW, 'display', ts)]
    }
    const sub = layoutSegments(p, subs[i], PAGE_W - MX - titleX, subSize)
    const h = padT + ts * CAP.display + (lines.length - 1) * ts * TITLE_LH
      + (sub.length ? subSize * 1.85 + (sub.length - 1) * subLh : 0) + padB
    return { ts, lines, sub, h }
  })
  return { T, numSize, titleX, keySize, subSize, subLh, padT, rows }
}

/** Distribui as linhas por páginas; devolve os índices por página. */
function paginate(rows: Row[], firstTop: number, nextTop: number): number[][] {
  const pages: number[][] = [[]]
  let y = firstTop
  rows.forEach((r, i) => {
    const page = pages[pages.length - 1]
    if (y + r.h > CONTENT_BOTTOM && page.length > 0) {
      pages.push([])
      y = nextTop
    }
    pages[pages.length - 1].push(i)
    y += r.h
  })
  return pages
}

export function renderAlinhamento(p: Painter, data: PdfData, projectColor: string | null, titlesOnly = false) {
  const { pal, doc } = p
  const songs = data.songs
  const showArtist = (data.meta.context ?? 'concert') !== 'concert'
  const subs = songs.map(s => (titlesOnly ? [] : subSegments(s, showArtist)))

  const kindName = pdfKindName('alinhamento', data.meta.context)
  p.pageBackground()
  const headerBottom = drawCoverHeader(p, data, { kindLabel: kindName.toUpperCase(), projectColor }, 44, 30)
  const firstTop = headerBottom + 4
  const nextTop = TOPBAR_RULE_Y + 6

  if (songs.length === 0) {
    const size = 11
    p.text('SEM MÚSICAS', MX, firstTop + 40, { role: 'mono', size, color: pal.ink3, cs: labelCs(size) })
    return
  }

  // Maior tamanho que cabe numa página; se nem no mínimo cabe, o maior que
  // cabe no número mínimo de páginas necessário
  const pagesAtMin = paginate(measure(p, songs, subs, MIN_T).rows, firstTop, nextTop).length
  let geo = measure(p, songs, subs, MIN_T)
  for (let T = MAX_T; T > MIN_T; T -= 0.5) {
    const g = measure(p, songs, subs, T)
    if (paginate(g.rows, firstTop, nextTop).length <= pagesAtMin) { geo = g; break }
  }
  const pages = paginate(geo.rows, firstTop, nextTop)
  const { numSize, titleX, keySize, subSize, subLh, padT } = geo

  pages.forEach((idxs, pi) => {
    let y = firstTop
    if (pi > 0) {
      doc.addPage()
      p.pageBackground()
      drawTopBar(p, { label: data.meta.title, suffix: ` · ${kindName[0].toUpperCase()}${kindName.slice(1)} (cont.)` })
      y = nextTop
    }
    idxs.forEach((i, k) => {
      const r = geo.rows[i]
      const song = songs[i]
      const base = y + padT + r.ts * CAP.display
      // Número mono em tinta (baseline alinhada com o título)
      p.text(pad2(i + 1), MX, base, { role: 'monoBold', size: numSize, color: pal.ink })
      r.lines.forEach((ln, li) => {
        p.text(ln, titleX, base + li * r.ts * TITLE_LH, { role: 'display', size: r.ts, color: pal.ink })
      })
      // Tom à direita, em chip com contorno
      const key = clean(normKey(song.key))
      if (key) {
        const kw = p.width(key, 'monoBold', keySize)
        const chipW = kw + keySize * 1.1
        const chipH = keySize * 1.75
        const cy = base - (r.ts * CAP.display) / 2
        const cx = PAGE_W - MX - chipW
        p.roundRect(cx, cy - chipH / 2, chipW, chipH, 3, { stroke: pal.hair2, lw: 0.9 })
        p.text(key, cx + (chipW - kw) / 2, cy + (keySize * CAP.monoBold) / 2, { role: 'monoBold', size: keySize, color: pal.ink })
      }
      // Linhas mono: artista (biblioteca) · INTRO … · FINAL … · NOTAS …
      if (r.sub.length) {
        const sb = base + (r.lines.length - 1) * r.ts * TITLE_LH + subSize * 1.6
        r.sub.forEach((line, li) => drawPieces(p, line, titleX, sb + li * subLh, subSize))
      }
      y += r.h
      const lastOnPage = k === idxs.length - 1
      if (!lastOnPage) p.hline(MX, PAGE_W - MX, y, pal.hair, 0.6)
    })
  })
}

function drawPieces(p: Painter, pieces: Piece[], x0: number, base: number, size: number) {
  const { pal } = p
  const cs = labelCs(size) * 0.5
  let x = x0
  for (const pc of pieces) {
    if (pc.sep) x += p.text(SEP, x, base, { role: 'mono', size, color: pal.ink3, cs })
    if (pc.label) x += p.text(`${pc.label} `, x, base, { role: 'monoBold', size, color: pal.ink3, cs })
    x += pc.name
      ? p.text(pc.value, x, base, { role: 'body', size: size * NAME_SCALE, color: pal.ink2 })
      : p.text(pc.value, x, base, { role: 'mono', size, color: pal.ink2, cs })
  }
}
