/**
 * Cifras no PDF: normalização de tons (♭/♯), transposição que mantém as
 * colunas da cifra mista e "a cifra cobre a letra?". Puro.
 */
import { parseKey, transposeChord } from '../transpose'
import { isChordLine, matchSection } from './text'

/** "B♭" → "Bb", "F♯m" → "F#m" (o parseKey partilhado só conhece b/#). */
export function normKey(key: string | null | undefined): string {
  return (key ?? '').replace(/\u266D/g, 'b').replace(/\u266F/g, '#').replace(/\u266E/g, '').trim()
}

/** Os dois tons são reconhecidos (dá para transpor de um para o outro)? */
export function canTranspose(fromKey: string, toKey: string): boolean {
  return !!parseKey(normKey(fromKey)) && !!parseKey(normKey(toKey))
}

/** Mesma regra do transpose.ts: tons com bemóis (F, Bb, Eb, Ab, Db, Gb + relativas menores). */
function prefersFlats(idx: number, minor: boolean): boolean {
  const major = minor ? (idx + 3) % 12 : idx
  return [5, 10, 3, 8, 1, 6].includes(major)
}

/** Transpõe um token de acorde, incluindo "(Am)"; barras, "x2" e texto ficam iguais. */
function transposeToken(token: string, semis: number, useFlats: boolean): string {
  const m = token.match(/^(\(?)([A-G][#b]?[^/\s()]*(?:\/[A-G][#b]?)?)(\)?)$/)
  if (!m) return token
  return m[1] + transposeChord(m[2], semis, useFlats) + m[3]
}

/**
 * Transpõe as linhas de acordes de uma cifra de `fromKey` para `toKey`.
 * Cada acorde fica na sua coluna original (compensa "Em"→"F#m" nos espaços
 * seguintes, com pelo menos 1 espaço), para não desalinhar das sílabas por baixo.
 * Tons não reconhecidos → texto sem alterações.
 */
export function transposeSheet(text: string, fromKey: string, toKey: string): string {
  const a = parseKey(normKey(fromKey))
  const b = parseKey(normKey(toKey))
  const src = text.replace(/\u266D/g, 'b').replace(/\u266F/g, '#')
  if (!a || !b) return src
  const semis = ((b.idx - a.idx) % 12 + 12) % 12
  if (!semis) return src
  const useFlats = prefersFlats(b.idx, b.minor)
  return src.split('\n').map(line => {
    if (!line.trim() || matchSection(line) || line.trim().startsWith('[')) return line
    if (!isChordLine(line)) return line
    let out = ''
    for (const m of line.matchAll(/\S+/g)) {
      const col = m.index ?? 0
      const pad = out.length === 0 ? col : Math.max(1, col - out.length)
      out += ' '.repeat(pad) + transposeToken(m[0], semis, useFlats)
    }
    return out
  }).join('\n')
}

/** Linha reduzida a letras/dígitos minúsculos sem acentos (para comparar letra com cifra). */
const normLine = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Fração (0–1) das linhas da letra que aparecem nas linhas de letra da cifra.
 * A cifra "abrevia" muitas vezes ("Verso 2 igual ao 1") — só a substitui
 * quando a cobre quase toda.
 */
export function lyricsCoverage(lyrics: string, sheet: string): number {
  const sheetText = sheet.replace(/\r\n?/g, '\n').split('\n')
    .filter(l => l.trim() && !matchSection(l) && !isChordLine(l))
    .map(normLine)
    .join('')
  const lines = lyrics.replace(/\r\n?/g, '\n').split('\n')
    .map(l => l.trim())
    .filter(l => l && !matchSection(l))
    .map(normLine)
    .filter(Boolean)
  if (!lines.length) return 1
  return lines.filter(l => sheetText.includes(l)).length / lines.length
}
