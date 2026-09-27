/* ═══════════════════════════════════════════════════════════════
   Arrumação das linhas lidas por OCR — PURO (testável em Node).
   - Colunas: palavras muito afastadas na mesma linha (durações, ícones
     de menu "⋯", colunas de tabelas) vêm separadas por TAB.
   - Título grande no topo (nome da playlist / do concerto) não é uma
     música: sai como `heading` (sugestão de nome).
   - Screenshots de playlists (Spotify, Apple Music, YouTube Music…)
     mostram cada música em DUAS linhas: título (maior) e artista
     (menor, logo por baixo). Juntam-se em "Título – Artista" para o
     parser não criar uma "música" com o nome do artista.
   - Vários screenshots seguidos repetem as últimas músicas: tira-se a
     sobreposição.
═══════════════════════════════════════════════════════════════ */
import { normalizeTitle } from './text'
import { looksLikeParallelColumns } from './parse'

/** Um bloco de texto de uma linha visual, com a posição horizontal do início. */
export interface Cell {
  x: number
  text: string
}

export interface CellRow {
  cells: Cell[]
}

export interface OcrLine {
  /** Texto; colunas afastadas separadas por TAB */
  text: string
  /** Altura da linha (px) — tamanho de letra aproximado */
  height: number
  x0: number
  y0: number
  y1: number
  /** Blocos da linha com a posição (colunas); sem isto, a linha é um só bloco em x0 */
  cells?: Cell[]
}

export interface OcrWord {
  text: string
  x0: number
  x1: number
}

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length

/** Palavras de uma linha → blocos; um intervalo > 2,5× a altura da linha começa outro bloco (coluna). */
export function wordsToCells(words: readonly OcrWord[], height: number): Cell[] {
  const cells: Cell[] = []
  let prevX1: number | null = null
  for (const w of words) {
    const t = w.text.trim()
    if (!t) continue
    if (prevX1 === null || w.x0 - prevX1 > height * 2.5) cells.push({ x: w.x0, text: t })
    else cells[cells.length - 1].text += ` ${t}`
    prevX1 = w.x1
  }
  return cells
}

/** Junta as palavras de uma linha; um intervalo > 2,5× a altura da linha vira TAB (outra coluna). */
export function joinWords(words: readonly OcrWord[], height: number): string {
  return wordsToCells(words, height).map(c => c.text).join('\t')
}

const rowText = (cells: readonly Cell[]) => cells.map(c => c.text.trim()).filter(Boolean).join('\t')

/**
 * Folha com listas lado a lado ("SET 1 | SET 2") → a coluna da esquerda inteira e depois a
 * da direita (pela geometria, não pelo TAB: uma linha só com a coluna da direita fica na
 * coluna certa). Só separa quando `looksLikeParallelColumns` o confirma (cabeçalhos nas duas
 * colunas, ou as duas numeradas); uma tabela "Título | Artista | Tom" fica como está.
 * `tol` = tolerância de alinhamento (px/pt).
 */
export function arrangeColumns(rows: readonly CellRow[], tol = 12): { lines: string[]; split: boolean } {
  const plain = rows.map(r => rowText(r.cells)).filter(Boolean)
  const xs = rows
    .flatMap(r => r.cells.slice(1).filter(c => letters(c.text) >= 2).map(c => c.x))
    .sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const x of xs) {
    const last = clusters[clusters.length - 1]
    if (last && x - last[last.length - 1] <= tol) last.push(x)
    else clusters.push([x])
  }
  for (const cl of clusters.filter(c => c.length >= 2).sort((a, b) => b.length - a.length)) {
    const bx = cl[0] - tol / 2
    const left = rows.map(r => r.cells.filter(c => c.x < bx))
    const right = rows.map(r => r.cells.filter(c => c.x >= bx))
    const pairs = rows.map((_, i) => [rowText(left[i]), rowText(right[i])] as const)
    if (!looksLikeParallelColumns(pairs)) continue
    // Antes da 1.ª linha com as duas colunas: título, data… (linha inteira, pela ordem)
    const start = pairs.findIndex(([l, r]) => letters(l) >= 2 && letters(r) >= 2)
    const pre = rows.slice(0, start).map(r => rowText(r.cells)).filter(Boolean)
    const leftLines = pairs.slice(start).map(([l]) => l).filter(Boolean)
    // A coluna da direita pode ter outra coluna (três sets)
    const rightRows = right.slice(start).filter(c => c.length).map(cells => ({ cells }))
    return { lines: [...pre, ...leftLines, ...arrangeColumns(rightRows, tol).lines], split: true }
  }
  return { lines: plain, split: false }
}

/** Primeira coluna com texto a sério (ignora "4:18", "⋯" lido como "a", números). */
function mainCell(text: string): string {
  const cells = text.split('\t').map(c => c.trim()).filter(Boolean)
  return cells.find(c => letters(c) >= 2) ?? cells[0] ?? ''
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function isPair(a: OcrLine, b: OcrLine): boolean {
  if (!mainCell(a.text) || !mainCell(b.text)) return false
  const smaller = b.height <= a.height * 0.86
  const close = b.y0 - a.y1 < a.height * 0.9
  const aligned = Math.abs(a.x0 - b.x0) < Math.max(12, a.height * 1.5)
  return smaller && close && aligned
}

/**
 * Junta pares "título grande + artista pequeno" em "Título – Artista", mas só quando o
 * padrão domina a imagem (≥3 pares e ≥60% das linhas) — uma folha de papel com letra
 * uniforme fica como está.
 */
export function pairTitleArtist(lines: readonly OcrLine[]): string[] {
  const plain = lines.map(l => l.text.trim())
  if (lines.length < 6) return plain
  const out: string[] = []
  let pairs = 0
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]
    const b = lines[i + 1]
    if (b && isPair(a, b)) {
      out.push(`${mainCell(a.text)} – ${mainCell(b.text)}`)
      pairs++
      i++
    } else {
      out.push(a.text.trim())
    }
  }
  return pairs >= 3 && pairs * 2 >= lines.length * 0.6 ? out : plain
}

/**
 * Linhas de uma imagem → texto para o parser + título (se houver um bem maior no topo).
 */
export function arrangeOcrLines(lines: readonly OcrLine[]): { lines: string[]; heading: string | null } {
  let rest = lines.filter(l => l.text.trim())
  let heading: string | null = null
  const med = median(rest.map(l => l.height))
  if (rest.length >= 4) {
    const idx = rest.slice(0, 2).findIndex(l => l.height >= med * 1.35 && letters(mainCell(l.text)) >= 3)
    if (idx >= 0) {
      heading = mainCell(rest[idx].text).replace(/\s+/g, ' ').trim()
      rest = rest.filter((_, i) => i !== idx)
    }
  }
  // Folha com dois sets lado a lado (numa só linha do OCR): coluna a coluna
  if (rest.some(l => (l.cells?.length ?? 0) >= 2)) {
    const cols = arrangeColumns(rest.map(l => ({ cells: l.cells ?? [{ x: l.x0, text: l.text }] })), Math.max(12, med * 1.5))
    if (cols.split) return { lines: cols.lines, heading }
  }
  return { lines: pairTitleArtist(rest), heading }
}

/**
 * Concatena os textos de vários screenshots pela ordem, tirando a sobreposição:
 * se as primeiras linhas de um ecrã repetem as últimas do anterior (com uma linha
 * cortada no topo, no máximo), não se duplicam.
 */
export function mergeScreens(screens: readonly (readonly string[])[]): string[] {
  const out: string[] = []
  for (const screen of screens) {
    const lines = screen.filter(l => l.trim())
    if (out.length === 0) { out.push(...lines); continue }
    const prev = out.map(normalizeTitle)
    const next = lines.map(normalizeTitle)
    let drop = 0
    for (const skip of [0, 1]) {
      const max = Math.min(10, prev.length, next.length - skip)
      for (let k = max; k >= 1; k--) {
        let ok = true
        for (let j = 0; j < k; j++) {
          if (!next[skip + j] || prev[prev.length - k + j] !== next[skip + j]) { ok = false; break }
        }
        if (ok) { drop = skip + k; break }
      }
      if (drop) break
    }
    out.push(...lines.slice(drop))
  }
  return out
}
