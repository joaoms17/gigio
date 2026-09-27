/**
 * Exportação de PDF no browser (invólucro do construtor puro em src/lib/pdf).
 *
 * - O motor (jspdf + construtor) só é descarregado quando se exporta: import() dinâmico.
 * - As fontes da v2 (TTF em src/lib/pdf/fonts) entram como URLs do Vite, são lidas
 *   com fetch e convertidas para base64 uma única vez (cache em memória). Ficam no
 *   precache do service worker, por isso exportar funciona offline.
 * - Devolve um File "<Nome> — alinhamento.pdf" / "<Nome> — repertório.pdf" pronto
 *   para navigator.share (num gesto novo do utilizador) ou para descarregar.
 */
import { pdfKindName, type PdfContext, type PdfData, type PdfFonts, type PdfKind, type PdfOptions } from './pdf/types'
import displayUrl from './pdf/fonts/ArchivoCondensed-ExtraBold.ttf?url'
import bodyUrl from './pdf/fonts/Archivo-Regular.ttf?url'
import semiUrl from './pdf/fonts/Archivo-SemiBold.ttf?url'
import monoUrl from './pdf/fonts/JetBrainsMono-Medium.ttf?url'
import monoBoldUrl from './pdf/fonts/JetBrainsMono-Bold.ttf?url'

export type {
  PdfContext, PdfData, PdfKind, PdfMeta, PdfOptions, PdfSize, PdfSong, PdfTheme,
} from './pdf/types'

const FONT_URLS: Record<keyof PdfFonts, string> = {
  display: displayUrl,
  body: bodyUrl,
  semi: semiUrl,
  mono: monoUrl,
  monoBold: monoBoldUrl,
}

type Engine = typeof import('./pdf/buildSetlistPdf')

let enginePromise: Promise<Engine> | null = null
let fontsPromise: Promise<PdfFonts> | null = null

function loadEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = import('./pdf/buildSetlistPdf').catch(err => {
      enginePromise = null // permite tentar de novo (ex.: voltou a rede)
      throw err
    })
  }
  return enginePromise
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function loadPdfFonts(): Promise<PdfFonts> {
  if (!fontsPromise) {
    const entries = Object.entries(FONT_URLS) as [keyof PdfFonts, string][]
    fontsPromise = Promise.all(entries.map(async ([role, url]) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Fonte do PDF indisponível (${res.status})`)
      return [role, toBase64(await res.arrayBuffer())] as const
    }))
      .then(pairs => Object.fromEntries(pairs) as unknown as PdfFonts)
      .catch(err => {
        fontsPromise = null
        throw err
      })
  }
  return fontsPromise
}

/** Começa a carregar o motor e as fontes (ex.: ao abrir a folha de exportação). */
export function preloadPdfEngine(): void {
  loadEngine().catch(() => {})
  loadPdfFonts().catch(() => {})
}

/**
 * "Festa de Verão — alinhamento.pdf" / "— repertório.pdf" ("— lista.pdf" fora de
 * um concerto), sem caracteres proibidos em nomes de ficheiro, sem controlo
 * bidi/zero-width, sem ponto inicial (ficheiro oculto no macOS) e cortado por
 * carácter (nunca a meio de um emoji).
 */
export function pdfFileName(title: string, kind: PdfKind, context: PdfContext = 'concert'): string {
  const cleaned = Array.from(title.normalize('NFC'), c => {
    const code = c.codePointAt(0) ?? 0
    return code < 32 || code === 127 ? ' ' : c
  }).join('')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
  const base = Array.from(cleaned).slice(0, 80).join('').trim() || 'Gigio'
  return `${base} — ${pdfKindName(kind, context)}.pdf`
}

export interface GeneratedPdf {
  file: File
  pages: number
}

/** Gera o PDF e devolve o ficheiro + nº de páginas. Lança erro se o motor/fontes não carregarem. */
export async function generateSetlistPdf(data: PdfData, options: PdfOptions): Promise<GeneratedPdf> {
  const [{ buildSetlistPdf }, fonts] = await Promise.all([loadEngine(), loadPdfFonts()])
  const doc = buildSetlistPdf(data, options, fonts)
  const blob = doc.output('blob')
  const file = new File([blob], pdfFileName(data.meta.title, options.kind, data.meta.context), { type: 'application/pdf' })
  return { file, pages: doc.getNumberOfPages() }
}

/** O browser consegue partilhar este ficheiro (Web Share Level 2)? */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** Alguma música tem acordes? (a folha só mostra "Incluir acordes" nesse caso) */
export function countSongsWithChords(data: PdfData): number {
  return data.songs.filter(s => !!s.chords?.trim()).length
}

/**
 * A lista (alinhamento) tem linhas por baixo dos títulos (intro/final/notas, ou
 * artista fora de um concerto)? Só então faz sentido a opção "Só títulos".
 */
export function hasListNotes(data: PdfData): boolean {
  const showArtist = (data.meta.context ?? 'concert') !== 'concert'
  return data.songs.some(s => !!(s.intro?.trim() || s.ending?.trim() || s.notes?.trim() || (showArtist && s.artist?.trim())))
}
