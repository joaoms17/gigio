/* ═══════════════════════════════════════════════════════════════
   Foto / screenshot → texto (OCR com tesseract.js, 'por+eng').
   O tesseract.js é carregado dinamicamente (só quando se lê uma foto)
   e descarrega o motor + dicionários na 1.ª utilização → precisa de
   internet. Antes do OCR, a imagem é reduzida a ≤2000px, passada a
   tons de cinzento com contraste esticado e invertida quando é um
   screenshot em modo escuro (texto claro em fundo escuro).
═══════════════════════════════════════════════════════════════ */
import type { ImportProgress } from './types'
import { ImportError, abortError, isAbort, isOffline, throwIfAborted } from './errors'
import { arrangeOcrLines, mergeScreens, wordsToCells, type OcrLine } from './layout'

type TesseractModule = typeof import('tesseract.js')
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>
type TesseractPage = Awaited<ReturnType<TesseractWorker['recognize']>>['data']

const MAX_SIDE = 2000
const MIN_SIDE = 1000

export const OFFLINE_OCR_MESSAGE = 'Sem ligação — ler fotos precisa de internet. Sem rede, no iPhone/iPad: abre a foto em Fotos, toca no ícone de texto (Texto em Direto), "Copiar tudo" e cola em TEXTO.'

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  close(): void
}

async function decodeImage(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch { /* Safari/HEIC: tenta via <img> */ }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode'))
      img.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new ImportError('unsupported', 'Não foi possível abrir esta imagem. Usa uma foto JPG/PNG ou um screenshot.')
  }
}

/**
 * Prepara uma imagem para OCR: ≤2000px (ou ampliada até ~1400px se for pequena),
 * tons de cinzento, contraste esticado (percentis 1–99) e inversão automática
 * de screenshots escuros.
 */
export async function prepareImageForOcr(input: Blob | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  let decoded: Decoded
  if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
    decoded = { source: input, width: input.width, height: input.height, close: () => {} }
  } else {
    decoded = await decodeImage(input as Blob)
  }
  const longest = Math.max(decoded.width, decoded.height)
  if (!longest) { decoded.close(); throw new ImportError('unsupported', 'A imagem está vazia.') }
  const scale = longest > MAX_SIDE ? MAX_SIDE / longest : longest < MIN_SIDE ? Math.min(2, 1400 / longest) : 1
  const w = Math.max(1, Math.round(decoded.width * scale))
  const h = Math.max(1, Math.round(decoded.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) { decoded.close(); throw new ImportError('unsupported', 'Este dispositivo não conseguiu processar a imagem.') }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Fundo branco: PNGs transparentes não ficam pretos
  ctx.fillStyle = 'rgb(255,255,255)'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(decoded.source, 0, 0, w, h)
  decoded.close()

  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const n = w * h
  const lum = new Uint8ClampedArray(n)
  const hist = new Uint32Array(256)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8
    lum[i] = l
    hist[l]++
  }
  const pct = (q: number) => {
    const target = n * q
    let acc = 0
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v }
    return 255
  }
  let lo = pct(0.01)
  let hi = pct(0.99)
  if (hi - lo < 24) { lo = 0; hi = 255 }
  const range = hi - lo
  const mid = (lo + hi) / 2
  let dark = 0
  for (let v = 0; v < mid; v++) dark += hist[v]
  // Maioria escura depois de esticar → texto claro sobre fundo escuro (modo escuro)
  const invert = dark / n > 0.55
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let v = ((lum[i] - lo) * 255) / range
    v = v < 0 ? 0 : v > 255 ? 255 : v
    if (invert) v = 255 - v
    d[p] = d[p + 1] = d[p + 2] = v
    d[p + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** Linhas do resultado do tesseract (com geometria: colunas, título grande, pares título/artista). */
function linesFromPage(page: TesseractPage): { lines: string[]; heading: string | null } {
  const lines: OcrLine[] = []
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        if (line.confidence < 20) continue
        const bb = line.bbox
        const height = line.rowAttributes?.rowHeight || (bb.y1 - bb.y0)
        const words = (line.words ?? []).map(w => ({ text: w.text ?? '', x0: w.bbox.x0, x1: w.bbox.x1 }))
        const cells = words.length ? wordsToCells(words, height) : []
        const text = (cells.length ? cells.map(c => c.text).join('\t') : (line.text ?? '')).replace(/ {2,}/g, ' ').trim()
        if (!text) continue
        lines.push({ text, height, x0: bb.x0, y0: bb.y0, y1: bb.y1, cells: cells.length ? cells : undefined })
      }
    }
  }
  if (lines.length === 0) {
    return { lines: (page.text ?? '').split('\n').map(s => s.trim()).filter(Boolean), heading: null }
  }
  return arrangeOcrLines(lines)
}

function isNetworkError(e: unknown): boolean {
  const msg = typeof e === 'string' ? e : (e as { message?: string } | null)?.message ?? ''
  return /network|fetch|load|import|failed|dynamically imported|403|404|timeout/i.test(msg)
}

function toImportError(e: unknown): Error {
  if (isAbort(e)) return abortError()
  if (e instanceof ImportError) return e
  if (isOffline() || isNetworkError(e)) return new ImportError('offline', OFFLINE_OCR_MESSAGE)
  return new ImportError('unreadable', 'Não foi possível ler a imagem. Tenta uma foto mais nítida — ou cola o texto.')
}

/**
 * Lê uma ou mais imagens (pela ordem) e devolve o texto (uma linha por música quando
 * possível) e o título grande do topo, se houver (nome da playlist/concerto). Vários screenshots de uma playlist longa são concatenados sem repetir as
 * músicas que aparecem em dois ecrãs.
 */
export async function recognizeImages(
  images: readonly (Blob | HTMLCanvasElement)[],
  opts: { onProgress?: (p: ImportProgress) => void; signal?: AbortSignal } = {},
): Promise<{ text: string; heading: string | null }> {
  const { onProgress, signal } = opts
  if (images.length === 0) return { text: '', heading: null }
  if (isOffline()) throw new ImportError('offline', OFFLINE_OCR_MESSAGE)
  throwIfAborted(signal)
  const total = images.length
  const current = { index: 0 }
  const report = (label: string, progress: number | null) => { if (!signal?.aborted) onProgress?.({ label, progress }) }
  const readingLabel = () => (total > 1 ? `A ler imagem ${current.index + 1} de ${total}…` : 'A ler a imagem…')

  report('A preparar o leitor de texto…', 0.02)
  let mod: TesseractModule
  try {
    mod = await import('tesseract.js')
  } catch (e) {
    throw toImportError(e)
  }
  throwIfAborted(signal)
  const createWorker = mod.createWorker ?? (mod as unknown as { default?: TesseractModule }).default?.createWorker
  if (!createWorker) throw new ImportError('unreadable', 'O leitor de texto não está disponível.')

  let worker: TesseractWorker | null = null
  const onAbort = () => { void worker?.terminate() }
  signal?.addEventListener('abort', onAbort)
  try {
    worker = await createWorker('por+eng', undefined, {
      logger: m => {
        const p = typeof m.progress === 'number' ? m.progress : 0
        switch (m.status) {
          case 'loading tesseract core': report('A preparar o leitor de texto…', 0.03 + 0.1 * p); break
          case 'initializing tesseract': report('A preparar o leitor de texto…', 0.14); break
          case 'loading language traineddata': report('A descarregar dicionários (só da 1.ª vez)…', 0.15 + 0.25 * p); break
          case 'initializing api': report('A preparar o leitor de texto…', 0.4); break
          case 'recognizing text': report(readingLabel(), 0.42 + 0.58 * ((current.index + p) / total)); break
        }
      },
      // Sem isto, um erro de carregamento é relançado dentro do worker (erro não tratado)
      errorHandler: () => {},
    })
    throwIfAborted(signal)
    const screens: string[][] = []
    let heading: string | null = null
    for (let i = 0; i < total; i++) {
      current.index = i
      report(readingLabel(), 0.42 + 0.58 * (i / total))
      const canvas = await prepareImageForOcr(images[i])
      throwIfAborted(signal)
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
      throwIfAborted(signal)
      const page = linesFromPage(data)
      screens.push(page.lines)
      heading ??= page.heading
      // Liberta a memória do canvas já (iPad com várias fotos grandes)
      canvas.width = 0
      canvas.height = 0
    }
    report('A organizar a lista…', 1)
    return { text: mergeScreens(screens).join('\n'), heading }
  } catch (e) {
    if (signal?.aborted) throw abortError()
    throw toImportError(e)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (worker) void worker.terminate().catch(() => {})
  }
}
