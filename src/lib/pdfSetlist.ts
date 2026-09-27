/* ═══════════════════════════════════════════════════════════════
   PDF → texto (pdf.js). Usado pelo motor de importação
   (src/lib/setlistImport) — que faz a interpretação com
   parseSetlistText. Este módulo é carregado só quando é preciso
   (import dinâmico), para o pdf.js não pesar nas outras páginas.
═══════════════════════════════════════════════════════════════ */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'
import { isSectionHeader, parseSetlistText } from './setlistImport/parse'
import { arrangeColumns, type Cell, type CellRow } from './setlistImport/layout'
import { ImportError } from './setlistImport/errors'

export { normalizeTitle } from './setlistImport/text'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** Formato antigo (compatibilidade): uma entrada por linha, medleys em `songs`. */
export interface SetlistEntry {
  raw: string
  songs: string[]
}

/* Tipos mínimos do pdf.js que usamos (a build legacy não traz tipos úteis) */
interface PdfTextItem { str?: string; transform: number[]; width?: number; height?: number }
interface PdfViewport { width: number; height: number }
interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>
  getViewport(o: { scale: number }): PdfViewport
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> }
  cleanup?(): void
}
interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage> }
const pdfjs = pdfjsLib as unknown as { getDocument(o: { data: ArrayBuffer }): { promise: Promise<PdfDocument> } }

async function openPdf(file: Blob): Promise<PdfDocument> {
  try {
    const buffer = await file.arrayBuffer()
    return await pdfjs.getDocument({ data: buffer }).promise
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'PasswordException') {
      throw new ImportError('unreadable', 'Este PDF está protegido por palavra-passe.')
    }
    throw new ImportError('unreadable', 'Não foi possível abrir o PDF. O ficheiro pode estar corrompido.')
  }
}

interface TextBit { x: number; y: number; w: number; h: number; text: string }

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const letterCount = (s: string) => (s.match(/\p{L}/gu) ?? []).length

/**
 * Texto do PDF linha a linha, de cima para baixo. Itens na mesma linha visual são
 * juntos por ordem horizontal; um intervalo grande (tabelas: "1   Wonderwall   Oasis   G")
 * separa blocos, que saem com TAB (o parser trata-os como colunas). Uma folha com dois
 * sets LADO A LADO sai coluna a coluna (esquerda inteira, depois direita).
 * `heading`: a linha de letra bem maior no topo da 1.ª página (nome sugerido; não é música).
 */
export async function extractPdfLines(file: Blob, opts: { maxPages?: number } = {}): Promise<{ lines: string[]; pages: number; heading: string | null }> {
  const pdf = await openPdf(file)
  const lines: string[] = []
  let heading: string | null = null
  const pages = Math.min(pdf.numPages, opts.maxPages ?? 30)
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const bits: TextBit[] = []
    for (const item of content.items as PdfTextItem[]) {
      const text = typeof item.str === 'string' ? item.str : ''
      if (!text.trim()) continue
      const h = Math.abs(item.height || item.transform?.[3] || 10)
      bits.push({ x: item.transform[4], y: item.transform[5], w: item.width || 0, h, text })
    }
    // Agrupar por linha (tolerância proporcional ao tamanho da letra)
    const rows: { y: number; h: number; bits: TextBit[] }[] = []
    for (const b of bits) {
      const hit = rows.find(r => Math.abs(r.y - b.y) <= Math.max(2, Math.min(r.h, b.h) * 0.45))
      if (hit) { hit.bits.push(b); hit.y = (hit.y + b.y) / 2; hit.h = Math.max(hit.h, b.h) }
      else rows.push({ y: b.y, h: b.h, bits: [b] })
    }
    rows.sort((a, b) => b.y - a.y)
    const cellRows: (CellRow & { h: number })[] = []
    for (const r of rows) {
      r.bits.sort((a, b) => a.x - b.x)
      const cells: Cell[] = []
      let prevEnd: number | null = null
      for (const b of r.bits) {
        const gap = prevEnd === null ? Infinity : b.x - prevEnd
        if (gap > r.h * 1.6) {
          cells.push({ x: b.x, text: b.text })
        } else {
          const cur = cells[cells.length - 1]
          if (gap > r.h * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(b.text)) cur.text += ' '
          cur.text += b.text
        }
        prevEnd = b.x + b.w
      }
      const clean = cells
        .map(c => ({ x: c.x, text: c.text.replace(/\s{2,}/g, ' ').trim() }))
        .filter(c => c.text)
      if (clean.length) cellRows.push({ cells: clean, h: r.h })
    }
    const med = median(cellRows.map(r => r.h))
    if (p === 1 && cellRows.length >= 4) {
      const idx = cellRows.slice(0, 2).findIndex(r => {
        const t = r.cells.map(c => c.text).join(' ')
        return r.h >= med * 1.3 && letterCount(t) >= 3 && !isSectionHeader(t)
      })
      if (idx >= 0) {
        heading = cellRows[idx].cells.map(c => c.text).join(' ').replace(/\s+/g, ' ').trim()
        cellRows.splice(idx, 1)
      }
    }
    lines.push(...arrangeColumns(cellRows, Math.max(6, med * 1.2)).lines)
    page.cleanup?.()
  }
  return { lines, pages: pdf.numPages, heading }
}

/** Renderiza as primeiras páginas em canvas (para OCR de PDFs digitalizados, sem texto). */
export async function renderPdfPages(file: Blob, opts: { maxPages?: number; targetWidth?: number } = {}): Promise<HTMLCanvasElement[]> {
  const pdf = await openPdf(file)
  const out: HTMLCanvasElement[] = []
  const pages = Math.min(pdf.numPages, opts.maxPages ?? 4)
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(4, (opts.targetWidth ?? 1700) / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvasContext: ctx, viewport }).promise
    out.push(canvas)
    page.cleanup?.()
  }
  return out
}

/** Compatibilidade: PDF → entradas de setlist (via `parseSetlistText`). */
export async function extractSetlistFromPdf(file: File): Promise<SetlistEntry[]> {
  const { lines } = await extractPdfLines(file)
  return parseSetlistText(lines.join('\n')).map(e => ({ raw: e.raw, songs: e.songs.map(s => s.title) }))
}
