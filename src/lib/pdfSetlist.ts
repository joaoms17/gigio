import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface SetlistEntry {
  raw: string
  songs: string[]
}

export function normalizeTitle(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ').trim()
}

function shouldSkip(line: string): boolean {
  const t = line.trim()
  if (t.length < 3) return true
  if (/^apresenta[çc][aã]o\s*$/i.test(t)) return true
  const nameParts = t.split(/\s*[-–—]\s*/)
  if (nameParts.length >= 3 && nameParts.every(n => /^[A-Za-zÀ-ÿ]{2,}(\s[A-Za-zÀ-ÿ]+)*$/.test(n.trim()))) return true
  return false
}

export async function extractSetlistFromPdf(file: File): Promise<SetlistEntry[]> {
  let pdf: any
  try {
    const buffer = await file.arrayBuffer()
    pdf = await (pdfjsLib as any).getDocument({ data: buffer }).promise
  } catch (err: any) {
    if (err?.name === 'PasswordException') throw new Error('Este PDF está protegido por palavra-passe.')
    throw new Error('Não foi possível abrir o PDF. O ficheiro pode estar corrompido.')
  }

  const entries: SetlistEntry[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    const clusters: { y: number; words: { x: number; text: string }[] }[] = []
    for (const item of content.items as any[]) {
      const text = item.str?.trim()
      if (!text) continue
      const y = item.transform[5]
      const x = item.transform[4]
      const hit = clusters.find(c => Math.abs(c.y - y) <= 3)
      if (hit) {
        hit.words.push({ x, text })
        hit.y = (hit.y + y) / 2
      } else {
        clusters.push({ y, words: [{ x, text }] })
      }
    }

    clusters.sort((a, b) => b.y - a.y)

    for (const c of clusters) {
      const line = c.words.sort((a, b) => a.x - b.x).map(w => w.text).join(' ').trim()
      if (!line || shouldSkip(line)) continue
      const parts = line.split(/\s*\/\s*/).map(s => s.trim()).filter(s => s.length > 1)
      if (parts.length === 0) continue
      entries.push({ raw: line, songs: parts })
    }
  }

  return entries
}
