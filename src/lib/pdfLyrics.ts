import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

async function openPdf(data: ArrayBuffer) {
  try {
    return await pdfjsLib.getDocument({ data }).promise
  } catch (err: any) {
    if (err?.name === 'PasswordException') {
      throw new Error('Este PDF está protegido por palavra-passe.')
    }
    throw new Error('Não foi possível abrir o PDF. O ficheiro pode estar corrompido.')
  }
}

interface Word { x: number; text: string }

/** Extract lyrics text from a PDF, reconstructing lines from glyph coordinates. */
export async function extractLyricsFromPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await openPdf(buffer)

  const pageLines: string[][] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // Cluster items into lines by Y with tolerance (glyphs on the same visual
    // line often differ by a fraction of a pixel)
    const clusters: { y: number; words: Word[] }[] = []
    for (const item of content.items as any[]) {
      const text = item.str
      if (!text || !text.trim()) continue
      const y = item.transform[5]
      const x = item.transform[4]
      const hit = clusters.find(c => Math.abs(c.y - y) <= 2.5)
      if (hit) {
        hit.words.push({ x, text })
        hit.y = (hit.y + y) / 2
      } else {
        clusters.push({ y, words: [{ x, text }] })
      }
    }

    // Top-to-bottom (PDF Y grows upward)
    clusters.sort((a, b) => b.y - a.y)

    // Median gap between consecutive lines → paragraph break threshold
    const gaps: number[] = []
    for (let i = 1; i < clusters.length; i++) {
      gaps.push(clusters[i - 1].y - clusters[i].y)
    }
    const sorted = [...gaps].sort((a, b) => a - b)
    const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0

    const lines: string[] = []
    let prevY: number | null = null
    for (const c of clusters) {
      if (prevY !== null && medianGap > 0 && prevY - c.y > medianGap * 1.8) {
        lines.push('')
      }
      prevY = c.y
      const text = c.words
        .sort((a, b) => a.x - b.x)
        .map(w => w.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) lines.push(text)
    }
    pageLines.push(lines)
  }

  // Remove headers/footers: lines repeated on (almost) every page, and bare page numbers
  const lineCount = new Map<string, number>()
  for (const lines of pageLines) {
    for (const l of new Set(lines.filter(Boolean))) {
      lineCount.set(l, (lineCount.get(l) ?? 0) + 1)
    }
  }
  const repeated = new Set(
    [...lineCount.entries()]
      .filter(([, n]) => pdf.numPages >= 2 && n >= pdf.numPages)
      .map(([l]) => l)
  )

  const cleaned = pageLines.map(lines =>
    lines
      .filter(l => !repeated.has(l))
      .filter(l => !/^\s*(página\s+)?\d{1,3}\s*(\/\s*\d{1,3})?\s*$/i.test(l))
  )

  const text = cleaned
    .map(lines => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean)
    .join('\n\n')

  if (!text.trim()) {
    throw new Error(
      'Este PDF não tem texto selecionável — provavelmente é uma digitalização (imagem). ' +
      'Tenta copiar a letra de outra fonte ou escrevê-la manualmente.'
    )
  }

  return text
}
