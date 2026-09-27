/* ═══════════════════════════════════════════════════════════════
   Fontes → texto: PDF (pdf.js; PDF digitalizado → OCR), FOTO
   (tesseract.js) e ficheiros de texto. Tudo carregado por import()
   dinâmico — nada disto pesa enquanto não se importa.
═══════════════════════════════════════════════════════════════ */
import type { ImportProgress } from './types'
import { ImportError, throwIfAborted } from './errors'

export interface SourceText {
  text: string
  /** O texto veio de OCR (o parser corrige confusões dígito/letra) */
  ocr: boolean
  /** Veio de fotos/screenshots (não de um PDF) */
  image?: boolean
  /** Título detetado (linha de letra maior no topo do PDF/imagem), para sugerir o nome */
  heading?: string | null
}

export interface SourceOptions {
  onProgress?: (p: ImportProgress) => void
  signal?: AbortSignal
}

export type FileKind = 'pdf' | 'image' | 'text'

/** Tipo de ficheiro aceite (ou null). */
export function fileKind(file: File): FileKind | null {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/.test(name)) return 'image'
  if (file.type.startsWith('text/') || /\.(txt|md|csv|tsv)$/.test(name)) return 'text'
  return null
}

/**
 * Nome do ficheiro sem extensão, para pré-preencher o nome do concerto
 * ("Setlist_Quinta_da_Ribeira.pdf" → "Setlist Quinta da Ribeira").
 * Nomes genéricos de câmara/screenshot ("IMG_1234", "Screenshot 2026-…") → null.
 */
const GENERIC_NAME = /^(?:img|image|imagem|photo|foto|pxl|dsc|dcim|scan|screenshot|screen shot|captura de ecr[ãa]|captura|whatsapp image|file|ficheiro)(?:[\s.:,()-]|\d|\b(?:at|de|em|às|as)\b)*$/i

// Lixo de versões/rascunhos em nomes de ficheiro: "Programa FINAL v3(2)", "setlist - cópia"
const FILE_JUNK = /(?:^|[\s_.-])(?:final(?:issim[oa])?|definitiv[oa]|v\s?\d+(?:\.\d+)?|vers[aã]o(?:\s?\d+)?|rev(?:\s?\d+)?|c[oó]pia|copy|setlist|set list|alinhamento|programa(?: musical)?|repert[oó]rio|draft|rascunho|atualizad[oa]|updated)(?=$|[\s_.()[\]-])|\(\s*\d+\s*\)|\[\s*\d+\s*\]/gi

export function fileBaseName(fileName: string): string | null {
  let base = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!base || GENERIC_NAME.test(base) || /^[\d\s.:()-]+$/.test(base)) return null
  for (let i = 0; i < 3; i++) base = base.replace(FILE_JUNK, ' ')
  base = base
    .replace(/(?:\s*[-–—·|]\s*){2,}/g, ' - ')
    .replace(/^[\s\-–—·|.]+|[\s\-–—·|.]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!base || /^[\d\s.:()/-]+$/.test(base) || (base.match(/\p{L}/gu) ?? []).length < 2) return null
  return base
}

/** PDF → texto. Sem texto (digitalização) → OCR das primeiras páginas. */
export async function readPdf(file: File, opts: SourceOptions = {}): Promise<SourceText> {
  opts.onProgress?.({ label: 'A ler o PDF…', progress: null })
  const pdf = await import('../pdfSetlist')
  throwIfAborted(opts.signal)
  const { lines, heading } = await pdf.extractPdfLines(file)
  throwIfAborted(opts.signal)
  const text = lines.join('\n')
  if ((text.match(/\p{L}/gu) ?? []).length >= 6) return { text, ocr: false, heading }
  // PDF digitalizado (só imagem): renderizar e ler com OCR
  opts.onProgress?.({ label: 'PDF sem texto — a ler como imagem…', progress: null })
  const canvases = await pdf.renderPdfPages(file, { maxPages: 4, targetWidth: 1700 })
  throwIfAborted(opts.signal)
  if (canvases.length === 0) throw new ImportError('empty', 'O PDF não tem páginas legíveis.')
  const { recognizeImages } = await import('./ocr')
  const r = await recognizeImages(canvases, opts)
  return { text: r.text, ocr: true, heading: r.heading }
}

/** Uma ou mais imagens (pela ordem) → texto via OCR. */
export async function readImages(files: readonly Blob[], opts: SourceOptions = {}): Promise<SourceText> {
  const { recognizeImages } = await import('./ocr')
  const r = await recognizeImages(files, opts)
  return { text: r.text, ocr: true, image: true, heading: r.heading }
}

/**
 * Miniatura da fonte (1.ª página do PDF / a imagem) para a revisão — URL de objeto
 * (revogar com `URL.revokeObjectURL`). null se não der (PDF estranho, HEIC no Chrome…).
 */
export async function sourcePreview(file: File): Promise<string | null> {
  try {
    if (fileKind(file) === 'image') return URL.createObjectURL(file)
    if (fileKind(file) !== 'pdf') return null
    const pdf = await import('../pdfSetlist')
    const [canvas] = await pdf.renderPdfPages(file, { maxPages: 1, targetWidth: 900 })
    if (!canvas) return null
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    canvas.width = 0
    canvas.height = 0
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}

/** Ficheiro de texto (.txt/.csv) → texto. */
export async function readTextFile(file: File): Promise<SourceText> {
  return { text: await file.text(), ocr: false }
}
