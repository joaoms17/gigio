/**
 * Tipos do motor de PDF (puro — sem React, sem DOM, testável em Node).
 * Ver docs/FEATURE-criar-concerto-e-pdf.md, Parte B.
 */

/** Uma música tal como entra no PDF (já resolvida pelo chamador). */
export interface PdfSong {
  title: string
  artist?: string | null
  /** Tom a mostrar: o do concerto tem prioridade sobre o da música / original. */
  key?: string | null
  /** Tom original da música — para transpor os acordes e mostrar "ORIG." quando difere. */
  originalKey?: string | null
  bpm?: number | null
  capo?: number | null
  durationSec?: number | null
  /** Letra (edited_lyrics ?? lyrics). `[Secção]` numa linha própria vira rótulo. */
  lyrics?: string | null
  /** Cifra/acordes (texto monoespaçado; pode incluir letra por baixo dos acordes). */
  chords?: string | null
  /** Notas deste concerto (setlist_songs). */
  intro?: string | null
  ending?: string | null
  notes?: string | null
}

/** De onde vem o PDF — muda textos (ex.: "A SEGUIR" só faz sentido num concerto). */
export type PdfContext = 'concert' | 'project' | 'library'

export interface PdfMeta {
  /** Nome do concerto, ou "A minha biblioteca", ou nome do projeto. */
  title: string
  /** Nome do projeto/banda (linha mono com o LED por cima do título). */
  subtitle?: string | null
  /** "YYYY-MM-DD" */
  date?: string | null
  venue?: string | null
  /** Cor do projeto tal como está nos dados (é remapeada com mapLegacyProjectColor). */
  color?: string | null
  context?: PdfContext
}

export interface PdfData {
  meta: PdfMeta
  songs: PdfSong[]
}

export type PdfKind = 'alinhamento' | 'repertorio'
export type PdfTheme = 'light' | 'dark'
export type PdfSize = 'normal' | 'grande' | 'enorme'

export interface PdfOptions {
  kind: PdfKind
  /** Claro (imprimir) / Escuro (palco). Por defeito claro. */
  theme?: PdfTheme
  /** Tamanho da letra no repertório: Normal 16pt / Grande 20pt / Enorme 24pt. Por defeito Grande. */
  size?: PdfSize
  /**
   * Repertório: incluir os acordes das músicas que os têm. Uma cifra mista
   * (acordes por cima da letra) só substitui a letra quando a cobre (≥85%);
   * senão sai "ACORDES" e depois a "LETRA" completa.
   */
  includeChords?: boolean
  /** Alinhamento: só números, títulos e tons (sem linhas de notas) — letra ainda maior. */
  titlesOnly?: boolean
}

/** Fontes TTF em base64 (entram por parâmetro — o construtor não faz I/O). */
export interface PdfFonts {
  /** Archivo Condensed ExtraBold — títulos */
  display: string
  /** Archivo Regular — letra, corpo */
  body: string
  /** Archivo SemiBold — títulos de linha */
  semi: string
  /** JetBrains Mono Medium — rótulos, metadados */
  mono: string
  /** JetBrains Mono Bold — números, tons */
  monoBold: string
}

/** Ficheiro de cada fonte em src/lib/pdf/fonts/ (usado pelo browser e pelos scripts Node). */
export const PDF_FONT_FILES: Record<keyof PdfFonts, string> = {
  display: 'ArchivoCondensed-ExtraBold.ttf',
  body: 'Archivo-Regular.ttf',
  semi: 'Archivo-SemiBold.ttf',
  mono: 'JetBrainsMono-Medium.ttf',
  monoBold: 'JetBrainsMono-Bold.ttf',
}

/** Nome do tipo de PDF (minúsculas): "alinhamento" num concerto, "lista" na biblioteca/projeto, "repertório". */
export function pdfKindName(kind: PdfKind, context: PdfContext = 'concert'): string {
  if (kind === 'repertorio') return 'repertório'
  return context === 'concert' ? 'alinhamento' : 'lista'
}
