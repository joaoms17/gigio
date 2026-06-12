// pdfjs-dist v3 legacy build: last version whose legacy bundle supports
// older Safari/iPadOS (v4+ legacy requires Safari 16.4+ even on the worker,
// which crashed with "undefined is not a function" on older tablets).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'

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

interface Word { x: number; w: number; text: string }

/** Join words on a line, omitting the space when glyph runs are contiguous
 * (PDFs often split a word like "care" into "car"+"e"). */
function joinWords(words: Word[], fontSize: number): string {
  const sorted = [...words].sort((a, b) => a.x - b.x)
  let out = ''
  let prevEnd: number | null = null
  for (const w of sorted) {
    if (prevEnd === null) out = w.text
    else {
      const gap = w.x - prevEnd
      out += (gap < Math.max(1, fontSize * 0.15) ? '' : ' ') + w.text
    }
    prevEnd = w.w > 0 ? w.x + w.w : null
    if (prevEnd === null) prevEnd = w.x  // unknown width: fall back to spacing
  }
  return out.replace(/\s+/g, ' ').trim()
}
interface Line { text: string; size: number }

export interface PdfSong {
  lyrics: string
  /** Best guess; '' when nothing usable was found */
  title: string
  artist: string
}

// Section markers that look like headings but aren't song titles
const SECTION_WORDS = /^(refr[aã]o|verso|chorus|intro|outro|ponte|bridge|pre[- ]?chorus|solo|instrumental|interl[uú]dio|coda|final)\s*\d*\s*:?$/i

function cleanMetaTitle(raw: string | undefined | null): string {
  if (!raw) return ''
  let t = String(raw).trim()
  t = t.replace(/^Microsoft Word\s*-\s*/i, '')
  t = t.replace(/\.(docx?|pdf|odt|txt|rtf)$/i, '')
  if (/^(untitled|sem t[ií]tulo|documento?\d*|document\d*)$/i.test(t)) return ''
  return t.trim()
}

function titleFromFilename(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Extract lyrics + title/artist guesses from a PDF, reconstructing lines from glyph coordinates. */
export async function extractLyricsFromPdf(file: File): Promise<PdfSong> {
  const buffer = await file.arrayBuffer()
  const pdf = await openPdf(buffer)

  // Metadata (Title / Author) when the PDF carries it
  let metaTitle = ''
  let metaAuthor = ''
  try {
    const meta = await pdf.getMetadata()
    metaTitle = cleanMetaTitle((meta?.info as any)?.Title)
    metaAuthor = String((meta?.info as any)?.Author ?? '').trim()
  } catch { /* metadata is optional */ }

  const pageLines: Line[][] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // Cluster items into lines by Y with tolerance (glyphs on the same visual
    // line often differ by a fraction of a pixel)
    const clusters: { y: number; size: number; words: Word[] }[] = []
    for (const item of content.items as any[]) {
      const text = item.str
      if (!text || !text.trim()) continue
      const y = item.transform[5]
      const x = item.transform[4]
      // Glyph height ≈ font size; transform[3] is the vertical scale
      const size = Math.abs(item.transform[3]) || item.height || 0
      const w = item.width ?? 0
      const hit = clusters.find(c => Math.abs(c.y - y) <= 2.5)
      if (hit) {
        hit.words.push({ x, w, text })
        hit.y = (hit.y + y) / 2
        hit.size = Math.max(hit.size, size)
      } else {
        clusters.push({ y, size, words: [{ x, w, text }] })
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

    const lines: Line[] = []
    let prevY: number | null = null
    for (const c of clusters) {
      if (prevY !== null && medianGap > 0 && prevY - c.y > medianGap * 1.8) {
        lines.push({ text: '', size: 0 })
      }
      prevY = c.y
      const text = joinWords(c.words, c.size)
      if (text) lines.push({ text, size: c.size })
    }
    pageLines.push(lines)
  }

  // Remove headers/footers: lines repeated on (almost) every page, and bare page numbers
  const lineCount = new Map<string, number>()
  for (const lines of pageLines) {
    for (const l of new Set(lines.map(l => l.text).filter(Boolean))) {
      lineCount.set(l, (lineCount.get(l) ?? 0) + 1)
    }
  }
  const repeated = new Set(
    [...lineCount.entries()]
      .filter(([, n]) => pdf.numPages >= 2 && n >= pdf.numPages)
      .map(([l]) => l)
  )

  const cleaned: Line[][] = pageLines.map(lines =>
    lines
      .filter(l => !l.text || !repeated.has(l.text))
      .filter(l => !/^\s*(página\s+)?\d{1,3}\s*(\/\s*\d{1,3})?\s*$/i.test(l.text) || l.text === '')
  )

  // ── First-line "Title – Artist" rule ──
  // Lyric sheets very often start with a "Song – Artist" line in the same
  // font size as the body, so the size heuristic misses it.
  let firstLineTitle = ''
  let firstLineArtist = ''
  let firstLineRef: Line | null = null
  for (const lines of cleaned) {
    const first = lines.find(l => l.text)
    if (!first) continue
    const m = first.text.length <= 70 && first.text.match(/^(.{1,45}?)\s*[–—]\s*(.{1,45})$|^(.{1,45}?)\s+-\s+(.{1,45})$/)
    if (m) {
      firstLineTitle = (m[1] ?? m[3] ?? '').trim()
      firstLineArtist = (m[2] ?? m[4] ?? '').trim()
      firstLineRef = first
    }
    break
  }

  // ── Heading detection: lines noticeably larger than the body text ──
  const bodySizes = cleaned.flat().filter(l => l.text).map(l => l.size).sort((a, b) => a - b)
  const bodyMedian = bodySizes.length ? bodySizes[Math.floor(bodySizes.length / 2)] : 0

  const isHeading = (l: Line) =>
    l.text.length > 0 &&
    l.text.length <= 60 &&
    bodyMedian > 0 &&
    l.size >= bodyMedian * 1.2 &&
    !SECTION_WORDS.test(l.text)

  const headings: string[] = []
  for (const lines of cleaned) {
    for (const l of lines) {
      if (isHeading(l) && !headings.includes(l.text)) headings.push(l.text)
    }
  }
  // Too many "headings" = the size heuristic misfired; trust none
  const validHeadings = headings.length <= 8 ? headings : []
  const isMedley = validHeadings.length >= 2

  // ── Build lyrics; in a medley, song headings become [Song] section markers.
  // The detected "Title – Artist" first line moves to the form fields.
  const text = cleaned
    .map(lines =>
      lines
        .filter(l => l !== firstLineRef)
        .map(l => {
          if (isMedley && validHeadings.includes(l.text)) return `[${l.text}]`
          return l.text
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    )
    .filter(Boolean)
    .join('\n\n')

  if (!text.trim()) {
    throw new Error(
      'Este PDF não tem texto selecionável — provavelmente é uma digitalização (imagem). ' +
      'Tenta copiar a letra de outra fonte ou escrevê-la manualmente.'
    )
  }

  // ── Title/artist guesses ──
  let title = ''
  let artist = metaAuthor
  if (isMedley) {
    title = validHeadings.join(' / ')
    if (!artist) artist = 'Medley'
  } else if (validHeadings.length === 1) {
    title = validHeadings[0]
  } else if (firstLineTitle) {
    title = firstLineTitle
    if (!artist) artist = firstLineArtist
  } else {
    title = metaTitle || titleFromFilename(file.name)
  }
  // Single heading like "Maria – Blondie": split into title/artist
  if (!isMedley && !firstLineTitle && title) {
    const m = title.match(/^(.{1,45}?)\s*[–—]\s*(.{1,45})$|^(.{1,45}?)\s+-\s+(.{1,45})$/)
    if (m) {
      title = (m[1] ?? m[3] ?? '').trim()
      if (!artist) artist = (m[2] ?? m[4] ?? '').trim()
    }
  }

  return { lyrics: text, title, artist }
}
