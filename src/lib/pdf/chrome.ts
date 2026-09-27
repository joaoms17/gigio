/**
 * Moldura comum às páginas: cabeçalho de capa (LED + projeto, título,
 * linha de metadados), barra de topo das músicas e rodapé "p. X / Y".
 */
import { CAP, PAGE_H, PAGE_W, labelCs, type Painter } from './painter'
import { clean, fmtDateLabel, fmtTotal, plural } from './text'
import type { PdfData } from './types'

/** Margem lateral (pt) — ~14mm: letra grande no tablet sem desperdiçar ecrã. */
export const MX = 40
export const CONTENT_W = PAGE_W - MX * 2
/** Linha de base da barra de topo e do rodapé. */
export const TOPBAR_Y = 34
export const TOPBAR_RULE_Y = 50
/** Onde começa o conteúdo numa página com barra de topo. */
export const CONTENT_TOP = 74
/** Limite inferior do conteúdo (acima do rodapé). */
export const CONTENT_BOTTOM = PAGE_H - 46
export const FOOTER_Y = PAGE_H - 22

export interface CoverInfo {
  kindLabel: string
  projectColor: string | null
}

/** "SÁB 28 SET 2026 · QUINTA DA RIBEIRA · 18 MÚSICAS · 1H18" */
export function metaParts(data: PdfData): string[] {
  const { meta, songs } = data
  const total = songs.reduce((acc, s) => acc + (s.durationSec && s.durationSec > 0 ? s.durationSec : 0), 0)
  return [
    fmtDateLabel(meta.date),
    meta.venue?.trim() ? clean(meta.venue.trim()).toUpperCase() : null,
    plural(songs.length, 'MÚSICA', 'MÚSICAS'),
    fmtTotal(total),
  ].filter((x): x is string => !!x)
}

/**
 * Cabeçalho da primeira página (alinhamento e capa do repertório).
 * Devolve o y logo abaixo do traço grosso.
 */
export function drawCoverHeader(p: Painter, data: PdfData, info: CoverInfo, titleMax: number, titleMin: number): number {
  const { pal } = p
  const top = 40
  // Linha 1: LED + projeto (esquerda) · tipo de PDF (direita)
  const lblSize = 9.5
  const lblCs = labelCs(lblSize)
  const kindW = p.width(info.kindLabel, 'mono', lblSize, lblCs)
  const subtitle = clean(data.meta.subtitle ?? '').toUpperCase()
  let x = MX
  if (info.projectColor && subtitle) {
    const led = 8
    p.led(x, top - lblSize * CAP.mono / 2 - led / 2, led, info.projectColor)
    x += led + 8
  }
  if (subtitle) {
    const s = p.fit(subtitle, CONTENT_W - kindW - 24 - (x - MX), 'monoBold', lblSize, lblCs)
    p.text(s, x, top, { role: 'monoBold', size: lblSize, color: pal.ink2, cs: lblCs })
  }
  p.textRight(info.kindLabel, PAGE_W - MX, top, { role: 'mono', size: lblSize, color: pal.ink3, cs: lblCs })

  // Título: condensado 800 grande; encolhe até titleMin e depois quebra (máx. 3 linhas)
  const title = clean(data.meta.title).trim() || 'Sem título'
  const size = p.fitSize(title, 'display', titleMax, titleMin, CONTENT_W)
  let lines = p.wrap(title, CONTENT_W, CONTENT_W, 'display', size)
  if (lines.length > 3) {
    lines = lines.slice(0, 3)
    lines[2] = p.fit(lines[2] + '…', CONTENT_W, 'display', size)
  }
  let y = top + 20 + size * CAP.display
  lines.forEach((ln, i) => {
    p.text(ln, MX, y + i * size * 0.98, { role: 'display', size, color: pal.ink })
  })
  y += (lines.length - 1) * size * 0.98

  // Metadados mono
  const metaSize = 10.5
  const metaCs = labelCs(metaSize) * 0.6
  const meta = p.fit(metaParts(data).join('  ·  '), CONTENT_W, 'mono', metaSize, metaCs)
  y += 22
  p.text(meta, MX, y, { role: 'mono', size: metaSize, color: pal.ink2, cs: metaCs })

  // Traço grosso de tinta — a setlist impressa
  y += 13
  p.fillRect(MX, y, CONTENT_W, 2, pal.ink)
  return y + 2
}

/**
 * Barra de topo das páginas de música: "07 / 22 · Concerto" + botão "↑ ÍNDICE"
 * (link para a página do índice onde a música está). `suffix` (ex. " (cont.)")
 * nunca é cortado: o rótulo encolhe para lhe dar lugar.
 */
export function drawTopBar(
  p: Painter,
  opts: { num?: number; total?: number; label: string; suffix?: string; indexPage?: number },
) {
  const { pal } = p
  const size = 10
  const cs = labelCs(size) * 0.7
  let x = MX
  // Botão ÍNDICE à direita (desenhado primeiro para saber quanto sobra)
  let rightEdge = PAGE_W - MX
  if (opts.indexPage) {
    const lbl = 'ÍNDICE'
    const lblSize = 9
    const lblCs = labelCs(lblSize)
    const arrowH = 8
    const padX = 9
    const bw = padX + arrowH * 0.7 + 6 + p.width(lbl, 'monoBold', lblSize, lblCs) + padX
    const bh = 22
    const bx = PAGE_W - MX - bw
    const by = TOPBAR_Y - lblSize * CAP.monoBold / 2 - bh / 2
    p.roundRect(bx, by, bw, bh, 4, { stroke: pal.hair2, lw: 0.8 })
    p.arrowUp(bx + padX + arrowH * 0.35, TOPBAR_Y, arrowH, pal.ink2)
    p.text(lbl, bx + padX + arrowH * 0.7 + 6, TOPBAR_Y, { role: 'monoBold', size: lblSize, color: pal.ink2, cs: lblCs })
    // Alvo de toque generoso (≥44px no iPad)
    p.doc.link(bx - 10, 4, PAGE_W - (bx - 10), TOPBAR_RULE_Y - 6, { pageNumber: opts.indexPage })
    rightEdge = bx - 16
  }
  if (opts.num && opts.total) {
    x += p.text(String(opts.num).padStart(2, '0'), x, TOPBAR_Y, { role: 'monoBold', size, color: pal.ink, cs })
    x += p.text(` / ${String(opts.total).padStart(2, '0')}`, x, TOPBAR_Y, { role: 'mono', size, color: pal.ink3, cs })
    x += p.text('  ·  ', x, TOPBAR_Y, { role: 'mono', size, color: pal.ink3, cs })
  }
  const suffix = opts.suffix ?? ''
  const suffixW = p.width(suffix, 'mono', size, cs)
  const label = p.fit(clean(opts.label), rightEdge - x - suffixW, 'mono', size, cs)
  x += p.text(label, x, TOPBAR_Y, { role: 'mono', size, color: pal.ink2, cs })
  if (suffix) p.text(suffix, x, TOPBAR_Y, { role: 'mono', size, color: pal.ink3, cs })
  p.hline(MX, PAGE_W - MX, TOPBAR_RULE_Y, pal.hair, 0.75)
}

/**
 * Rodapé discreto em todas as páginas: "REPERTÓRIO · CONCERTO" … "p. 12 / 48".
 * Quando a música continua na página seguinte, "CONTINUA ↓" abre o rodapé à
 * esquerda — logo por baixo da última linha da letra, onde o olho de quem
 * canta cai — e o rótulo segue-o (antes ficava ao centro e cortava o rótulo).
 */
export function drawFooters(p: Painter, leftLabel: string, continues: Set<number>) {
  const { pal, doc } = p
  const n = doc.getNumberOfPages()
  const size = 8.5
  const cs = labelCs(size)
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    const pg = `p. ${i} / ${n}`
    const pgW = p.width(pg, 'mono', size, cs * 0.5)
    p.text(pg, PAGE_W - MX - pgW, FOOTER_Y, { role: 'mono', size, color: pal.ink3, cs: cs * 0.5 })
    let x = MX
    if (continues.has(i)) {
      const lbl = 'CONTINUA'
      x += p.text(lbl, x, FOOTER_Y, { role: 'monoBold', size, color: pal.ink, cs }) + 5
      const arrowH = 8.5
      p.arrowDown(x + arrowH * 0.35, FOOTER_Y + 0.8, arrowH, pal.accent)
      x += arrowH * 0.7 + 16
    }
    const left = p.fit(clean(leftLabel).toUpperCase(), PAGE_W - MX - pgW - 20 - x, 'mono', size, cs)
    p.text(left, x, FOOTER_Y, { role: 'mono', size, color: pal.ink3, cs })
  }
}
