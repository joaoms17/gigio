/* ═══════════════════════════════════════════════════════════════
   Correspondência: linha importada ↔ repertório (biblioteca) e
   ↔ resultados online (LRCLIB / Genius). PURO — corre em Node.
═══════════════════════════════════════════════════════════════ */
import type { SearchResult } from '../../types'
import { artistSimilarity, matchKey, normalizeTitle, titleSimilarity } from './text'

/** O que se procura: título (+ artista) e, quando ambíguo, a leitura inversa. */
export interface SongQuery {
  title: string
  artist?: string
  swapped?: { title: string; artist: string }
  /** Texto completo da linha limpa (ex.: "Wonderwall – Oasis") */
  text?: string
}

export interface LibraryCandidate {
  id: string
  title: string
  artist: string
}

interface Reading { title: string; artist?: string }

function readings(q: SongQuery): Reading[] {
  const out: Reading[] = [{ title: q.title, artist: q.artist || undefined }]
  if (q.swapped) out.push({ title: q.swapped.title, artist: q.swapped.artist || undefined })
  if (q.text && normalizeTitle(q.text) !== normalizeTitle(q.title)) out.unshift({ title: q.text })
  return out.filter(r => normalizeTitle(r.title))
}

function pickByArtist<T extends LibraryCandidate>(cands: T[], artist?: string): T {
  if (!artist || cands.length === 1) return cands[0]
  let best = cands[0]
  let bestScore = -1
  for (const c of cands) {
    const s = artistSimilarity(artist, c.artist)
    if (s > bestScore) { best = c; bestScore = s }
  }
  return best
}

/**
 * Procura a linha no repertório. Ordem: título exato (normalizado) → chave tolerante
 * (sem "(ao vivo)", "feat."…) → semelhança ≥ 85 (gralhas de OCR, "of"/"O'").
 * Com artista, desempata entre músicas com o mesmo título e recusa correspondências
 * aproximadas de outro artista.
 */
export function findLibraryMatch<T extends LibraryCandidate>(q: SongQuery, library: readonly T[]): T | null {
  if (library.length === 0) return null
  const rs = readings(q)
  // 1. Igualdade normalizada
  for (const r of rs) {
    const n = normalizeTitle(r.title)
    const cands = library.filter(s => normalizeTitle(s.title) === n)
    if (cands.length) return pickByArtist(cands, r.artist)
  }
  // 2. Chave tolerante
  for (const r of rs) {
    const k = matchKey(r.title)
    if (!k) continue
    const cands = library.filter(s => matchKey(s.title) === k)
    if (cands.length) return pickByArtist(cands, r.artist)
  }
  // 3. Aproximada
  let best: T | null = null
  let bestScore = 0
  for (const r of rs) {
    if (matchKey(r.title).replace(/ /g, '').length < 4) continue
    for (const s of library) {
      const t = titleSimilarity(r.title, s.title)
      if (t < 85) continue
      let score = t
      if (r.artist && s.artist) {
        const a = artistSimilarity(r.artist, s.artist)
        if (a < 50) continue
        score += a >= 80 ? 5 : 0
      }
      if (score > bestScore) { best = s; bestScore = score }
    }
  }
  return best
}

/** Semelhança mínima para propor uma música do repertório "a confirmar" (e nunca criar outra online). */
export const LOOSE_LIBRARY_SCORE = 70

export interface LibraryMatch<T> {
  song: T
  /**
   * Correspondência aproximada (título abreviado, gralha de OCR): escolhida para não
   * duplicar a música, mas mostrada como "A CONFIRMAR".
   */
  loose: boolean
}

/**
 * Como `findLibraryMatch`, mais um 4.º nível — aproximado, para não criar duplicados:
 * - a linha é o início de UMA só música ("SWEET CHILD" → "Sweet Child O' Mine");
 * - a linha começa por uma música e o resto é o artista ("Valerie Amy Winehouse") — exato;
 * - semelhança ≥ 70 ("Walerie", "Valery", "Twist n Shout").
 * Recusa quando o artista lido é claramente outro.
 */
export function matchLibrary<T extends LibraryCandidate>(q: SongQuery, library: readonly T[]): LibraryMatch<T> | null {
  const strict = findLibraryMatch(q, library)
  if (strict) return { song: strict, loose: false }
  if (library.length === 0) return null
  const rs = readings(q)
  const artistOk = (r: Reading, s: T) => !r.artist || !s.artist || artistSimilarity(r.artist, s.artist) >= 40
  const keys = library.map(s => matchKey(s.title))

  for (const r of rs) {
    const k = matchKey(r.title)
    if (k.replace(/ /g, '').length < 4) continue
    // "Valerie Amy Winehouse": começa pelo título e o resto é o artista da música
    let inc: T | null = null
    let incLen = 0
    for (let i = 0; i < library.length; i++) {
      const s = library[i]
      const t = keys[i]
      if (t.length < 4 || t.length <= incLen || !k.startsWith(`${t} `) || !s.artist) continue
      if (artistSimilarity(k.slice(t.length + 1), s.artist) < 70) continue
      inc = s
      incLen = t.length
    }
    if (inc) return { song: inc, loose: false }
    // "SWEET CHILD", "UPTOWN": o início de uma só música (palavras inteiras)
    if (k.length >= 5) {
      const pre = library.filter((s, i) => keys[i].startsWith(`${k} `) && artistOk(r, s))
      if (pre.length === 1) {
        const full = matchKey(pre[0].title)
        if (k.length / full.length >= 0.45 || k.split(' ').length >= 2) return { song: pre[0], loose: true }
      }
    }
  }

  // Gralhas: semelhança ≥ 70. Um título contido noutro ("Kiss Me" / "Kiss") é outra música.
  const words = (s: string) => s.split(' ').filter(Boolean)
  const nested = (a: string, b: string) => {
    const [short, long] = a.length <= b.length ? [words(a), words(b)] : [words(b), words(a)]
    return short.length < long.length && short.every(w => long.includes(w))
  }
  let best: T | null = null
  let bestScore = 0
  for (const r of rs) {
    const k = matchKey(r.title)
    if (k.replace(/ /g, '').length < 4) continue
    for (let i = 0; i < library.length; i++) {
      const s = library[i]
      if (!artistOk(r, s) || nested(k, keys[i])) continue
      const t = titleSimilarity(r.title, s.title)
      if (t > bestScore) { best = s; bestScore = t }
    }
  }
  return best && bestScore >= LOOSE_LIBRARY_SCORE ? { song: best, loose: true } : null
}

/** Repertório ordenado por semelhança com um texto livre (seletor "trocar correspondência"). */
export function rankLibrary<T extends LibraryCandidate>(query: string, library: readonly T[], limit = 8): T[] {
  const q = normalizeTitle(query)
  if (!q) return []
  const scored: { s: T; score: number }[] = []
  for (const s of library) {
    const title = normalizeTitle(s.title)
    const combined = normalizeTitle(`${s.title} ${s.artist}`)
    let score = Math.max(titleSimilarity(query, s.title), titleSimilarity(query, `${s.title} ${s.artist}`) - 5)
    if (title.startsWith(q) || combined.includes(q)) score = Math.max(score, 70 + Math.min(25, q.length))
    if (score >= 40) scored.push({ s, score })
  }
  scored.sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title))
  return scored.slice(0, limit).map(x => x.s)
}

/* ── Resultados online ── */

const JUNK_RESULT = /karaok|tribute|instrumental|in the style of|made famous|backing track|cover version|8-bit|lullaby|piano version/i

/** A pontuação "antiga" do importador (texto livre contra título/título+artista). */
function legacyScore(query: string, r: SearchResult): number {
  const q = normalizeTitle(query)
  const combined = normalizeTitle(`${r.title} ${r.artist}`)
  const titleOnly = normalizeTitle(r.title)
  if (!q) return 0
  if (q === titleOnly || q === combined) return 100
  if (titleOnly.length > 3 && (q.includes(titleOnly) || titleOnly.includes(q)))
    return Math.round((Math.min(q.length, titleOnly.length) / Math.max(q.length, titleOnly.length)) * 100)
  const qWords = q.split(/\s+/).filter(w => w.length >= 3)
  const tWords = new Set(combined.split(/\s+/).filter(w => w.length >= 3))
  if (qWords.length === 0) return 0
  const matching = qWords.filter(w => tWords.has(w)).length
  return Math.round((matching / Math.max(qWords.length, tWords.size)) * 100)
}

/**
 * Confiança (0..100) de que `r` é a música pedida. Considera as duas leituras
 * (Título – Artista / Artista - Título), o artista quando existe e penaliza
 * versões karaoke/tributo que não foram pedidas.
 */
export function scoreResult(q: SongQuery, r: SearchResult): number {
  let best = 0
  for (const rd of readings(q)) {
    let s = Math.max(
      titleSimilarity(rd.title, r.title),
      legacyScore(rd.artist ? `${rd.title} ${rd.artist}` : rd.title, r),
    )
    if (rd.artist) {
      const a = artistSimilarity(rd.artist, r.artist)
      if (a >= 70) s = Math.min(100, s + 5)
      else if (a < 40) s -= 20
    }
    best = Math.max(best, s)
  }
  const asked = `${q.text ?? ''} ${q.title} ${q.artist ?? ''}`
  if (JUNK_RESULT.test(`${r.title} ${r.artist}`) && !JUNK_RESULT.test(asked)) best -= 25
  return Math.max(0, Math.min(100, Math.round(best)))
}

export interface RankedResult {
  result: SearchResult
  score: number
}

/**
 * Ordena resultados: pontuação ↓, depois sync, depois LRCLIB (tem letra) e a ordem
 * original. Remove duplicados (mesmo título+artista), ficando com o melhor.
 */
export function rankResults(q: SongQuery, results: readonly SearchResult[]): RankedResult[] {
  const ranked = results.map((result, i) => ({ result, score: scoreResult(q, result), i }))
  ranked.sort((a, b) =>
    b.score - a.score
    || Number(b.result.has_sync) - Number(a.result.has_sync)
    || Number(b.result.source === 'lrclib') - Number(a.result.source === 'lrclib')
    || a.i - b.i)
  const seen = new Set<string>()
  const out: RankedResult[] = []
  for (const r of ranked) {
    const k = `${matchKey(r.result.title)}::${normalizeTitle(r.result.artist)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ result: r.result, score: r.score })
  }
  return out
}

/** Pontuação mínima para escolher automaticamente um resultado online. */
export const AUTO_PICK_SCORE = 55
/** Abaixo disto, a escolha automática é mostrada como "a confirmar". */
export const CONFIDENT_SCORE = 75

/** Rótulo curto da fonte de um resultado: SYNC (LRCLIB sincronizada), LRCLIB, GENIUS. */
export function resultSourceLabel(r: SearchResult): 'SYNC' | 'LRCLIB' | 'GENIUS' {
  if (r.source === 'lrclib') return r.has_sync ? 'SYNC' : 'LRCLIB'
  return 'GENIUS'
}

/** Texto de pesquisa online para uma linha ("Título Artista", o LRCLIB aceita as duas ordens). */
export function searchQueryFor(q: SongQuery): string {
  return (q.artist ? `${q.title} ${q.artist}` : q.title).replace(/\s+/g, ' ').trim()
}
