import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

export async function extractLyricsFromPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pages: string[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // Group text items by Y position (same line = Y within 2px of each other)
    const lineMap = new Map<number, { x: number; text: string }[]>()

    for (const item of content.items as any[]) {
      if (!item.str?.trim()) continue
      const y = Math.round(item.transform[5])
      const x = item.transform[4]
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push({ x, text: item.str })
    }

    // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a)

    const lines: string[] = []
    let prevY: number | null = null

    for (const y of sortedYs) {
      // Insert blank line if gap between lines is large (paragraph break)
      if (prevY !== null && prevY - y > 20) {
        lines.push('')
      }
      prevY = y

      // Sort words on this line left-to-right
      const words = lineMap.get(y)!.sort((a, b) => a.x - b.x)
      lines.push(words.map(w => w.text).join(' ').trim())
    }

    const pageText = lines.join('\n').trim()
    if (pageText) pages.push(pageText)
  }

  return pages.join('\n\n')
}
