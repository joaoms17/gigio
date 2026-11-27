/* ═══════════════════════════════════════════════════════════════
   PDF de LETRAS: cada página (ou cada bloco com um título grande)
   é uma música. PURO — recebe as linhas de cada página (com o
   tamanho relativo da letra quando o PDF o dá) e devolve músicas
   com título, artista e letra (quebras de linha, linhas em branco e
   marcas [Refrão] preservadas).

   detectLyricsPages decide automaticamente entre "letras" e "lista
   de títulos" (linhas compridas e poucas páginas vs linhas curtas,
   numeradas). A revisão deixa sempre trocar.
═══════════════════════════════════════════════════════════════ */
import { normalizeTitle } from './text'

/** Uma linha de uma página. `text: ''` = linha em branco (separação de estrofes). */
export interface PageLine {
  text: string
  /** Altura da letra (unidades do PDF). Ausente no OCR. */
  size?: number
}

export type PageLines = PageLine[]

export interface LyricsSong {
  title: string
  artist: string
  /** Letra (sem o título/artista), com \n e linhas em branco */
  lyrics: string
  /** Páginas de onde veio (1-based) */
  pages: number[]
}

export type ImportMode = 'list' | 'lyrics'

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length

/** Número de página / rodapé ("3", "- 3 -", "Página 3", "3/12", "pág. 3 de 12"). */
export function isPageNumber(s: string): boolean {
  const t = s.trim()
  return /^[-–—\s]*\d{1,3}[-–—\s]*$/.test(t)
    || /^(?:p[áa]g(?:ina)?\.?|page|p\.)\s*\d{1,3}(?:\s*(?:\/|de|of)\s*\d{1,3})?$/i.test(t)
    || /^\d{1,3}\s*(?:\/|de|of)\s*\d{1,3}$/i.test(t)
}

/** Marca de secção da letra: "[Refrão]", "(Ponte)", "Refrão:", "VERSO 2". */
export function isSectionMarker(s: string): boolean {
  const t = s.trim()
  if (/^\[[^\]]{1,30}\]$/.test(t)) return true
  return /^\(?\s*(?:refr[ãa]o|coro|verso|estrofe|ponte|pr[ée][- ]?refr[ãa]o|intro|outro|final|solo|chorus|verse|bridge|pre[- ]?chorus|hook|interl[úu]dio)(?:\s*\d{1,2})?\s*\)?\s*:?$/i.test(t)
}

const NUMBERED = /^\s*(?:\d{1,3}\s*[.)\-–:]|#\d{1,3}\b)/

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Linhas com conteúdo (sem números de página). */
function contentLines(page: PageLines): PageLine[] {
  return page.filter(l => l.text.trim() && !isPageNumber(l.text))
}

export interface LyricsDetection {
  mode: ImportMode
  /** Explicação curta (depuração/testes) */
  reason: string
}

/**
 * Letras ou lista de títulos? Letras: páginas com muitas linhas, boa parte com 5+ palavras
 * (versos), poucas numeradas; ou marcas [Refrão]/[Verso]. Lista: linhas curtas, numeradas,
 * muitas linhas por página com 1–4 palavras.
 */
export function detectLyricsPages(pages: readonly PageLines[]): LyricsDetection {
  const lines = pages.flatMap(contentLines).map(l => l.text.trim())
  if (lines.length < 6) return { mode: 'list', reason: 'poucas linhas' }
  const numbered = lines.filter(l => NUMBERED.test(l)).length / lines.length
  const long = lines.filter(l => words(l) >= 5).length / lines.length
  const markers = lines.filter(isSectionMarker).length
  const perPage = lines.length / Math.max(1, pages.filter(p => contentLines(p).length > 0).length)
  // Pontuação de frase dentro da linha (vírgulas no meio de versos)
  const commas = lines.filter(l => /\p{L},\s+\p{L}/u.test(l)).length / lines.length
  if (numbered >= 0.4) return { mode: 'list', reason: 'linhas numeradas' }
  if (markers >= 2 && perPage >= 6) return { mode: 'lyrics', reason: 'marcas de secção' }
  if (long >= 0.4 && perPage >= 8) return { mode: 'lyrics', reason: 'versos compridos' }
  if (long >= 0.3 && commas >= 0.1 && perPage >= 8) return { mode: 'lyrics', reason: 'versos com vírgulas' }
  return { mode: 'list', reason: 'linhas curtas' }
}

/* ── Título / artista ── */

/** Linha que pode ser um título (curta, com letras, sem ser verso/marca/rodapé). */
function titleish(s: string): boolean {
  const t = s.trim()
  if (!t || letters(t) < 2 || isSectionMarker(t) || isPageNumber(t)) return false
  if (t.length > 70 || words(t) > 10) return false
  return true
}

/** "Título – Artista" com travessão rodeado de espaços (não "Pôr-do-sol"). */
function splitDash(t: string): { title: string; artist: string } | null {
  const m = t.match(/^(.+?)\s+[–—-]\s+(.+)$/)
  if (!m) return null
  const title = m[1].trim()
  const artist = m[2].trim()
  if (letters(title) < 1 || letters(artist) < 2 || words(artist) > 6) return null
  return { title, artist }
}

const ARTIST_PREFIX = /^(?:por|de|by|artista|int[ée]rprete|m[úu]sica(?:\s+e\s+letra)?|letra(?:\s+e\s+m[úu]sica)?)\s*[:\-–]?\s+(.+)$/i

/** "(cont.)", "continuação" — cabeçalho repetido numa página que continua a música */
const CONT = /\(?\s*(?:cont\.?|continua[çc][ãa]o|continued)\s*\)?\s*$/i

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^["“'«]+|["”'»]+$/g, '').trim()
}

/** Junta linhas numa letra: tira brancos no início/fim e repetições de brancos. */
function joinLyrics(lines: readonly string[]): string {
  const out: string[] = []
  for (const raw of lines) {
    const l = raw.replace(/\s+$/g, '')
    if (!l.trim()) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    out.push(l.trim())
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

interface Block {
  page: number
  lines: PageLine[]
  /** O bloco começa com um título grande (letra maior que o corpo) */
  headed: boolean
}

/**
 * Divide cada página em blocos: por defeito um bloco por página; com tamanhos de letra,
 * cada linha bem maior que o corpo (título) começa um bloco novo.
 */
function toBlocks(pages: readonly PageLines[]): { blocks: Block[]; sized: boolean } {
  const sizes = pages.flatMap(p => p.filter(l => l.text.trim() && l.size).map(l => l.size as number))
  const body = median(sizes)
  const sized = sizes.length > 0 && body > 0
  const big = (l: PageLine) => sized && !!l.size && l.size >= body * 1.25 && titleish(l.text)
  const blocks: Block[] = []
  pages.forEach((page, i) => {
    const lines = page.filter(l => !isPageNumber(l.text) || !l.text.trim())
    let cur: Block | null = null
    for (const l of lines) {
      if (big(l) && cur && cur.lines.some(x => x.text.trim() && !big(x))) {
        blocks.push(cur)
        cur = null
      }
      if (!cur) {
        if (!l.text.trim()) continue
        cur = { page: i + 1, lines: [], headed: big(l) }
      }
      cur.lines.push(l)
    }
    if (cur && cur.lines.some(l => l.text.trim())) blocks.push(cur)
  })
  return { blocks, sized }
}

/**
 * Páginas → músicas. Título = 1.ª linha com conteúdo (ou a linha grande do topo); artista
 * quando é óbvio ("Título – Artista", "por Fulano", ou uma 2.ª linha curta seguida de linha
 * em branco); letra = o resto. Uma página que continua a anterior (começa a meio de uma frase,
 * com minúscula, por uma marca [Refrão], sem o título grande que as outras têm, ou repete o
 * título com "(cont.)") junta-se à música anterior.
 */
export function parseLyricsPages(pages: readonly PageLines[]): LyricsSong[] {
  const { blocks, sized } = toBlocks(pages)
  const anyHeaded = sized && blocks.some(b => b.headed)
  const songs: LyricsSong[] = []
  for (const b of blocks) {
    const nonBlank = b.lines.map((l, i) => ({ l, i })).filter(x => x.l.text.trim())
    if (!nonBlank.length) continue
    const first = nonBlank[0]
    const firstText = first.l.text.trim()
    const prev = songs[songs.length - 1]
    const continues = !!prev && (
      (anyHeaded && !b.headed)
      || /^\p{Ll}/u.test(firstText)
      || isSectionMarker(firstText)
      || !titleish(firstText)
      || (CONT.test(firstText) && normalizeTitle(firstText.replace(CONT, '')) === normalizeTitle(prev.title))
      || normalizeTitle(splitDash(firstText)?.title ?? firstText) === normalizeTitle(prev.title)
    )
    if (continues && prev) {
      // Cabeçalho repetido ("Título (cont.)" / o mesmo título) não entra na letra
      const repeatHead = CONT.test(firstText) || normalizeTitle(splitDash(firstText)?.title ?? firstText) === normalizeTitle(prev.title)
      const rest = b.lines.slice(repeatHead ? first.i + 1 : 0).map(l => l.text)
      const more = joinLyrics(rest)
      if (more) prev.lyrics = prev.lyrics ? `${prev.lyrics}\n\n${more}` : more
      if (!prev.pages.includes(b.page)) prev.pages.push(b.page)
      continue
    }
    if (!titleish(firstText)) {
      // Sem título reconhecível e sem música anterior: usa o início do verso como nome
      songs.push({ title: tidy(firstText).slice(0, 60), artist: '', lyrics: joinLyrics(b.lines.map(l => l.text)), pages: [b.page] })
      continue
    }
    let title = tidy(firstText.replace(CONT, ''))
    let artist = ''
    let bodyStart = first.i + 1
    const dash = splitDash(title)
    if (dash) {
      title = dash.title
      artist = dash.artist
    } else {
      const second = nonBlank[1]
      if (second) {
        const st = second.l.text.trim()
        const pre = st.match(ARTIST_PREFIX)
        const afterSecond = b.lines[second.i + 1]
        const blankAfter = !afterSecond || !afterSecond.text.trim()
        const adjacent = second.i === first.i + 1
        const smallerThanTitle = sized && !!first.l.size && !!second.l.size && second.l.size < first.l.size * 0.95
        if (pre && words(pre[1]) <= 6) {
          artist = tidy(pre[1])
          bodyStart = second.i + 1
        } else if (adjacent && blankAfter && titleish(st) && words(st) <= 4 && st.length <= 40
          && !/[,.;!?]$/.test(st) && !isSectionMarker(st) && (b.headed ? smallerThanTitle || !sized : true)) {
          artist = tidy(st.replace(/^[-–—(]\s*|\s*\)$/g, ''))
          bodyStart = second.i + 1
        }
      }
    }
    songs.push({ title, artist, lyrics: joinLyrics(b.lines.slice(bodyStart).map(l => l.text)), pages: [b.page] })
  }
  return songs
}

/** Texto simples → páginas (form feed \f separa páginas; útil em testes e em .txt). */
export function textToPages(text: string): PageLines[] {
  return text.split('\f').map(p => p.replace(/\r/g, '').split('\n').map(t => ({ text: t })))
}

/** As primeiras linhas da letra (pré-visualização na revisão). */
export function lyricsPreview(lyrics: string, n = 2): string {
  return lyrics.split('\n').map(l => l.trim()).filter(l => l && !isSectionMarker(l)).slice(0, n).join(' / ')
}
