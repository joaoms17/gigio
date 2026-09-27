/**
 * Primitivas de desenho sobre o jsPDF: fontes por papel, medição, corte e
 * quebra de texto, formas vetoriais (setas, ▶, LED) — as fontes não têm setas.
 * Unidades: pontos (pt). y cresce para baixo. Texto sempre na linha de base.
 */
import type { jsPDF } from 'jspdf'
import type { Palette } from './theme'

export const PAGE_W = 595.28
export const PAGE_H = 841.89

export type FontRole = 'display' | 'body' | 'semi' | 'mono' | 'monoBold'

export const FAMILY: Record<FontRole, string> = {
  display: 'GigioDisplay',
  body: 'GigioBody',
  semi: 'GigioSemi',
  mono: 'GigioMono',
  monoBold: 'GigioMonoBold',
}

/** Altura das maiúsculas (em em) — para centrar texto na vertical. */
export const CAP: Record<FontRole, number> = {
  display: 0.686, body: 0.686, semi: 0.686, mono: 0.73, monoBold: 0.73,
}

export interface TextStyle {
  role: FontRole
  size: number
  color: string
  /** Espaçamento entre letras em pt (micro-rótulos mono). */
  cs?: number
}

/** Espaçamento dos micro-rótulos mono: 0.08em, como na app. */
export const labelCs = (size: number) => size * 0.08

export class Painter {
  private role: FontRole | null = null
  private size = 0

  doc: jsPDF
  pal: Palette

  constructor(doc: jsPDF, pal: Palette) {
    this.doc = doc
    this.pal = pal
  }

  font(role: FontRole, size: number) {
    if (role !== this.role) {
      this.doc.setFont(FAMILY[role], 'normal')
      this.role = role
    }
    if (size !== this.size) {
      this.doc.setFontSize(size)
      this.size = size
    }
  }

  /** Largura do texto com o espaçamento entre letras incluído. */
  width(text: string, role: FontRole, size: number, cs = 0): number {
    if (!text) return 0
    this.font(role, size)
    return this.doc.getTextWidth(text) + cs * Math.max(0, text.length - 1)
  }

  /** Desenha à esquerda na linha de base y; devolve a largura. */
  text(text: string, x: number, y: number, st: TextStyle): number {
    if (!text) return 0
    this.font(st.role, st.size)
    this.doc.setTextColor(st.color)
    if (st.cs) this.doc.text(text, x, y, { baseline: 'alphabetic', charSpace: st.cs })
    else this.doc.text(text, x, y, { baseline: 'alphabetic' })
    return this.width(text, st.role, st.size, st.cs ?? 0)
  }

  /** Alinhado à direita em `right`; devolve o x inicial. */
  textRight(text: string, right: number, y: number, st: TextStyle): number {
    const w = this.width(text, st.role, st.size, st.cs ?? 0)
    this.text(text, right - w, y, st)
    return right - w
  }

  textCenter(text: string, cx: number, y: number, st: TextStyle): number {
    const w = this.width(text, st.role, st.size, st.cs ?? 0)
    this.text(text, cx - w / 2, y, st)
    return w
  }

  /** Corta com "…" para caber em maxW. */
  fit(text: string, maxW: number, role: FontRole, size: number, cs = 0): string {
    if (this.width(text, role, size, cs) <= maxW) return text
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (this.width(text.slice(0, mid).trimEnd() + '…', role, size, cs) <= maxW) lo = mid
      else hi = mid - 1
    }
    return lo > 0 ? text.slice(0, lo).trimEnd() + '…' : ''
  }

  /**
   * Maior tamanho (entre min e max) a que o texto cabe numa linha de maxW.
   * Margem de 0,3% contra o arredondamento: um tamanho calculado "à justa"
   * dava 515.280000 > 515.28 e o título quebrava à toa numa 2.ª linha.
   */
  fitSize(text: string, role: FontRole, max: number, min: number, maxW: number, cs = 0): number {
    const w = this.width(text, role, max, cs)
    if (w <= maxW) return max
    return Math.max(min, Math.floor(((max * maxW) / w) * 0.997 * 100) / 100)
  }

  /**
   * Quebra por palavras. A 1.ª linha tem largura firstW, as seguintes contW
   * (para o recuo das linhas de continuação). Palavras gigantes partem-se.
   */
  wrap(text: string, firstW: number, contW: number, role: FontRole, size: number, cs = 0): string[] {
    const t = text.replace(/\s+$/, '')
    // Tolerância de arredondamento (ver fitSize)
    const EPS = 0.05
    if (this.width(t, role, size, cs) <= firstW + EPS) return [t]
    const lead = t.match(/^\s*/)?.[0] ?? ''
    const words = t.trim().split(/\s+/)
    const lines: string[] = []
    let cur = lead
    let maxW = firstW + EPS
    const push = () => { lines.push(cur); cur = ''; maxW = contW + EPS }
    for (let word of words) {
      const cand = cur.trim() ? `${cur} ${word}` : `${cur}${word}`
      if (this.width(cand, role, size, cs) <= maxW) { cur = cand; continue }
      if (cur.trim()) push()
      // Palavra maior que a linha: parte à força
      while (this.width(word, role, size, cs) > maxW) {
        let n = word.length - 1
        while (n > 1 && this.width(word.slice(0, n), role, size, cs) > maxW) n--
        cur = word.slice(0, n)
        word = word.slice(n)
        push()
      }
      cur = cur ? `${cur}${word}` : word
    }
    if (cur.trim()) lines.push(cur)
    return lines.length ? lines : ['']
  }

  /* ── Formas ── */

  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.doc.setFillColor(color)
    this.doc.rect(x, y, w, h, 'F')
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, opts: { fill?: string; stroke?: string; lw?: number }) {
    if (opts.fill) this.doc.setFillColor(opts.fill)
    if (opts.stroke) { this.doc.setDrawColor(opts.stroke); this.doc.setLineWidth(opts.lw ?? 0.75) }
    const style = opts.fill && opts.stroke ? 'FD' : opts.fill ? 'F' : 'S'
    this.doc.roundedRect(x, y, w, h, r, r, style)
  }

  hline(x1: number, x2: number, y: number, color: string, lw = 0.75) {
    this.doc.setDrawColor(color)
    this.doc.setLineWidth(lw)
    this.doc.line(x1, y, x2, y)
  }

  /** LED quadrado da cor do projeto (assinatura v2 — nunca círculo). */
  led(x: number, y: number, size: number, color: string) {
    this.roundRect(x, y, size, size, Math.min(1.5, size * 0.2), { fill: color })
  }

  /** Seta ↑ com o fundo em (cx, bottom). */
  arrowUp(cx: number, bottom: number, h: number, color: string) {
    const headH = h * 0.5
    const headW = h * 0.7
    const sw = Math.max(0.9, h * 0.16)
    this.doc.setFillColor(color)
    this.doc.triangle(cx, bottom - h, cx - headW / 2, bottom - h + headH, cx + headW / 2, bottom - h + headH, 'F')
    this.doc.rect(cx - sw / 2, bottom - h + headH - 0.3, sw, h - headH + 0.3, 'F')
  }

  /** Seta ↓ com a ponta em (cx, bottom). */
  arrowDown(cx: number, bottom: number, h: number, color: string) {
    const headH = h * 0.5
    const headW = h * 0.7
    const sw = Math.max(0.9, h * 0.16)
    this.doc.setFillColor(color)
    this.doc.triangle(cx, bottom, cx - headW / 2, bottom - headH, cx + headW / 2, bottom - headH, 'F')
    this.doc.rect(cx - sw / 2, bottom - h, sw, h - headH + 0.3, 'F')
  }

  /** ▶ com a base em (x, bottom), altura h. */
  play(x: number, bottom: number, h: number, color: string) {
    this.doc.setFillColor(color)
    this.doc.triangle(x, bottom - h, x, bottom, x + h * 0.86, bottom - h / 2, 'F')
  }

  /** Pinta o fundo da página (tema escuro). */
  pageBackground() {
    if (this.pal.paper) this.fillRect(0, 0, PAGE_W, PAGE_H, this.pal.paper)
  }
}
