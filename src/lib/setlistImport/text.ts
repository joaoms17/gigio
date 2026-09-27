/* ═══════════════════════════════════════════════════════════════
   Utilitários de texto do motor de importação — PUROS (sem DOM,
   sem Vite): correm também em Node (scripts/test-setlist-parse.mjs).
═══════════════════════════════════════════════════════════════ */

const COMBINING = /[̀-ͯ]/g

/** Minúsculas, sem acentos nem pontuação, espaços colapsados.
 *  (Igual à antiga `pdfSetlist.normalizeTitle` — mantém compatibilidade.) */
export function normalizeTitle(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(COMBINING, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ').trim()
}

/** Remove acentos mantendo maiúsculas/minúsculas. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(COMBINING, '').normalize('NFC')
}

/**
 * Chave de comparação "tolerante" de títulos: além de normalizar, tira
 * conteúdo entre parênteses/colchetes, "feat. X", sufixos " - Remastered 2011" /
 * " - Live", "&" → "and" e o artigo inicial "the".
 */
export function matchKey(s: string): string {
  let t = stripAccents(s).toLowerCase()
  t = t.replace(/\s[-–—]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|live(?:\s+.*)?|ao vivo.*|ac[uú]stic[oa]|acoustic(?:\s+version)?|radio edit|single version|mono|stereo|bonus track)\s*$/i, '')
  t = t.replace(/\((?:[^()]*)\)|\[(?:[^[\]]*)\]/g, ' ')
  t = t.replace(/\b(?:feat|ft|featuring)\b\.?.*$/i, ' ')
  t = t.replace(/&/g, ' and ')
  t = t.replace(/[^a-z0-9\s]/g, '')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/^the\s+/, '')
  return t || normalizeTitle(s)
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** Coeficiente de Dice sobre bigramas (0..1). Tolera gralhas de OCR. */
export function dice(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0
  if (a.length < 2 || b.length < 2) return 0
  const A = bigrams(a)
  const B = bigrams(b)
  let inter = 0
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0)
  return (2 * inter) / (a.length - 1 + b.length - 1)
}

/**
 * Semelhança entre dois títulos, 0..100.
 * Exato (chave tolerante) = 100; depois Dice, contenção e sobreposição de palavras.
 */
export function titleSimilarity(a: string, b: string): number {
  const x = matchKey(a)
  const y = matchKey(b)
  if (!x || !y) return 0
  if (x === y) return 100
  const cx = x.replace(/ /g, '')
  const cy = y.replace(/ /g, '')
  if (cx === cy) return 98
  let best = Math.round(dice(cx, cy) * 100)
  const [short, long] = cx.length <= cy.length ? [cx, cy] : [cy, cx]
  if (short.length >= 4 && long.includes(short)) {
    best = Math.max(best, Math.round((short.length / long.length) * 100))
  }
  const xw = x.split(' ').filter(w => w.length >= 3)
  const yw = new Set(y.split(' ').filter(w => w.length >= 3))
  if (xw.length > 0 && yw.size > 0) {
    const hit = xw.filter(w => yw.has(w)).length
    // O denominador conta também as palavras curtas: "Kiss Me" ≠ "Kiss"
    const xAll = x.split(' ').filter(w => w.length >= 2).length
    const yAll = y.split(' ').filter(w => w.length >= 2).length
    best = Math.max(best, Math.round((hit / Math.max(xw.length, yw.size, xAll, yAll)) * 100))
  }
  return Math.min(best, 99)
}

/** Semelhança entre nomes de artista (0..100): aceita "Oasis" ⊂ "Oasis & Friends". */
export function artistSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a).replace(/^the /, '')
  const y = normalizeTitle(b).replace(/^the /, '')
  if (!x || !y) return 0
  if (x === y) return 100
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 3 && (` ${long} `).includes(` ${short} `)) return 90
  return Math.round(dice(x.replace(/ /g, ''), y.replace(/ /g, '')) * 100)
}

/* ── Emojis e símbolos decorativos ── */

// Pictográficos + bandeiras + tons de pele + seletores de variação + ZWJ + keycap,
// notas musicais e marcas de verificação/estrelas usadas em listas.
// (O "•" fica de fora: no início é marcador, a meio separa "Título • Artista".)
const EMOJI_RE = /(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|\uFE0E|\uFE0F|\u200D|\u20E3|[\u2669-\u266F\u2605\u2606\u2713\u2714\u2717\u2718\u25CF\u25CB\u25A0\u25A1\u25AA\u25AB\u25B6\u25BA\u27A4\u2794\u279C])/gu

export function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, ' ')
}

/* ── Capitalização de linhas em MAIÚSCULAS ── */

const SMALL_WORDS = new Set([
  // pt
  'a', 'o', 'as', 'os', 'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'com', 'por', 'para', 'pra', 'que', 'ao', 'aos', 'se', 'te', 'me', 'lhe', 'ou',
  // en
  'the', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'or', 'an', 'by', 'with',
])

function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '')
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

/**
 * "MENINO DO BAIRRO NEGRO" → "Menino do Bairro Negro". Só atua em texto todo em
 * maiúsculas; mantém siglas curtas numa só palavra ("ABBA", "YMCA"), palavras
 * com dígitos/pontos/barras ("U2", "AC/DC", "R.E.M.") e numeração romana.
 */
export function smartCase(s: string): string {
  if (!isAllCaps(s)) return s
  const words = s.split(/(\s+)/)
  const real = words.filter(w => w.trim())
  if (real.length === 1 && real[0].replace(/[^\p{L}]/gu, '').length <= 4) return s
  let idx = 0
  return words.map(w => {
    if (!w.trim()) return w
    const i = idx++
    if (/[\d./&]/.test(w)) return w
    if (/^[IVX]{2,4}$/.test(w)) return w
    const lower = w.toLowerCase()
    if (i > 0 && i < real.length - 1 && SMALL_WORDS.has(lower)) return lower
    // Primeira letra (depois de pontuação de abertura) em maiúscula
    return lower.replace(/^([^\p{L}]*)(\p{L})/u, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
  }).join('')
}

/** Posição/contagem sempre com 2 dígitos: 01, 02… */
export const pad2 = (n: number) => String(n).padStart(2, '0')
