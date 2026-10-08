/**
 * Letra de palco + tempos da sincronização — funções puras (sem React).
 *
 * O palco desenha SEMPRE a letra da música (`edited_lyrics ?? lyrics`), tal
 * como foi escrita: linhas vazias, [Secções], indentação. A sincronização
 * (`lyric_syncs.lines`) só empresta TEMPOS a essas linhas — nunca o texto.
 *
 * Porquê: o editor de sync grava só as linhas não vazias que levaram toque,
 * e uma letra editada depois de sincronizada já não bate com o texto do sync.
 * Por isso cada entrada do sync é emparelhada com uma linha da letra pelo
 * texto (normalizado / parecido), por ordem e sem o tempo andar para trás.
 */

/**
 * lyric — linha cantada; mark — só símbolos ("—", "...", "♪"): desenhada
 * como foi escrita, mas sem tempo próprio e fora dos passos ‹ › e do cue
 * (só tem tempo se a sync a tiver marcado); section — "[Refrão]"; blank — vazia
 */
export type StageLineKind = 'lyric' | 'mark' | 'section' | 'blank'

export interface StageLine {
  kind: StageLineKind
  /** Texto como foi escrito: indentação e espaços mantidos (só sai o espaço no fim) */
  text: string
  /** [Secção]: o rótulo sem os parênteses retos */
  label?: string
  /**
   * Colunas de indentação no início da linha (TAB → próxima paragem de 4).
   * O palco desenha o texto sem ela e recua a linha inteira (quebras incluídas)
   */
  indent: number
  /**
   * Índice desta linha no texto original partido por '\n' (o do LyricsView).
   * Um '\r' sozinho também parte a linha no palco, mas fica com o mesmo src
   */
  src: number
}

/** Entrada gravada em lyric_syncs.lines */
export interface SyncEntry {
  text: string
  time_ms: number
}

export interface SyncMapping {
  /** Tempo (ms) de cada linha de palco (índice de stageLines); null = sem tempo */
  timeByLine: (number | null)[]
  /** Linha de palco de cada entrada do sync; -1 = não emparelhada */
  lineBySync: number[]
  /**
   * Fração emparelhada (0..1), medida sobre o lado menor: linhas de letra do
   * sync ou linhas de letra do palco (ver lyricCoverage)
   */
  coverage: number
}

/** Mesmo critério do LyricsView/editor: "[Refrão]" sozinho numa linha */
const SECTION_RE = /^\[(.+?)\]$/

/** Abaixo disto a sync foi feita para outra versão da letra */
export const MIN_COVERAGE = 0.5
/** Dice de bigramas a partir do qual duas linhas são "a mesma, retocada" */
export const SIMILARITY = 0.8
/** Passo por omissão (ms) quando não há como estimar o ritmo da música */
const DEFAULT_STEP_MS = 3000
/** Distância mínima (ms) entre duas linhas com tempo no palco */
const MIN_GAP_MS = 1
/** Acima disto (entradas × linhas) não se faz o alinhamento — nenhuma letra real lá chega */
const MAX_CELLS = 1_000_000

// Pesos inteiros (somas exatas em float64): uma linha de letra igual vale
// sempre mais do que uma parecida, e as secções/vazias nunca trocam o
// emparelhamento de uma linha de letra
const W_LYRIC = 1_000_000
const W_LYRIC_SIMILAR = 900_000
const W_SECTION = 100_000
const W_SECTION_SIMILAR = 90_000
const W_MARK = 10_000
const W_BLANK = 1
/** Colunas de um TAB na indentação (paragens de 4, como o tab-size do palco) */
const TAB_COLS = 4

// ── Letra ────────────────────────────────────────────────────────────────

/** Colunas da indentação no início de `line` (TAB → próxima paragem de TAB_COLS) */
function indentColumns(line: string): number {
  let col = 0
  for (const ch of line) {
    if (ch === '\t') col = (Math.floor(col / TAB_COLS) + 1) * TAB_COLS
    else if (ch === '\uFEFF') continue // BOM colado ao início: sem largura
    else if (/\s/.test(ch)) col++
    else break
  }
  return col
}

/**
 * Letra → linhas de palco. Mantém TODAS as linhas pela ordem (cada vazia
 * conta); só se retiram as vazias no início e no fim. Fins de linha: `\n`,
 * `\r\n` e `\r` sozinho (CR clássico) — o mesmo que o editor de sync parte.
 */
export function parseStageLines(text: string | null | undefined): StageLine[] {
  // src conta só os '\n' (o LyricsView parte o texto cru por '\n'): as partes
  // de um '\r' sozinho ficam com o src da linha em que estão
  const raw: { line: string; src: number }[] = []
  ;(text ?? '').split('\n').forEach((piece, src) => {
    for (const part of piece.replace(/\r$/, '').split('\r')) raw.push({ line: part, src })
  })
  let start = 0
  let end = raw.length
  while (start < end && raw[start].line.trim() === '') start++
  while (end > start && raw[end - 1].line.trim() === '') end--
  const out: StageLine[] = []
  for (let i = start; i < end; i++) {
    const { src } = raw[i]
    const line = raw[i].line.replace(/\s+$/, '')
    const t = line.trim()
    if (t === '') {
      out.push({ kind: 'blank', text: '', indent: 0, src })
      continue
    }
    const sec = SECTION_RE.exec(t)
    if (sec) {
      out.push({ kind: 'section', text: t, label: sec[1].trim(), indent: 0, src })
      continue
    }
    const kind: StageLineKind = normalizeLyric(t) === '' ? 'mark' : 'lyric'
    out.push({ kind, text: line, indent: indentColumns(line), src })
  }
  return out
}

/**
 * Texto a desenhar no palco: a letra escrita; sem letra escrita mas com
 * sync (LRCLIB só com syncedLyrics, por exemplo), as linhas do sync pela
 * ordem — as entradas vazias (pausas de LRC) ficam linhas vazias.
 */
export function stageLyricsText(
  written: string | null | undefined,
  syncLines: readonly SyncEntry[] | null | undefined,
): string {
  const text = written ?? ''
  if (text.trim() !== '' || !syncLines || syncLines.length === 0) return text
  return syncLines.map(e => (e?.text ?? '').replace(/\s+$/, '')).join('\n')
}

/** Minúsculas, sem acentos, sem pontuação, espaços colapsados */
export function normalizeLyric(s: string): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    // Apóstrofos colam a palavra ("don't" = "dont"); o resto separa
    .replace(/['’‘`ʼ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

type Grams = { map: Map<string, number>; n: number }

function bigrams(key: string): Grams | null {
  const s = key.replace(/\s+/g, '')
  if (s.length < 2) return null
  const map = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    map.set(g, (map.get(g) ?? 0) + 1)
  }
  return { map, n: s.length - 1 }
}

/** Coeficiente de Dice sobre bigramas (multiconjunto) */
function dice(a: Grams, b: Grams): number {
  const [small, big] = a.n <= b.n ? [a, b] : [b, a]
  let inter = 0
  for (const [g, c] of small.map) {
    const d = big.map.get(g)
    if (d) inter += Math.min(c, d)
  }
  return (2 * inter) / (a.n + b.n)
}

/** Dice só quando pode chegar ao limiar (o tamanho já o exclui na maioria dos pares) */
function similarEnough(a: Grams, b: Grams): number {
  const small = Math.min(a.n, b.n)
  if ((2 * small) / (a.n + b.n) < SIMILARITY) return 0
  return dice(a, b)
}

/** Semelhança 0..1 entre duas linhas (1 = iguais depois de normalizar) */
export function lineSimilarity(a: string, b: string): number {
  const ka = normalizeLyric(a)
  const kb = normalizeLyric(b)
  if (ka === kb) return 1
  const ga = bigrams(ka)
  const gb = bigrams(kb)
  return ga && gb ? dice(ga, gb) : 0
}

type Prepared = { kind: StageLineKind; key: string; grams: Grams | null }

/** Mesmo critério do parseStageLines (texto de uma entrada do sync) */
function kindOf(text: string): StageLineKind {
  const t = (text ?? '').trim()
  if (t === '') return 'blank'
  if (SECTION_RE.test(t)) return 'section'
  return normalizeLyric(t) === '' ? 'mark' : 'lyric'
}

function prepare(text: string): Prepared {
  const t = (text ?? '').trim()
  const kind = kindOf(t)
  if (kind === 'blank') return { kind, key: '', grams: null }
  const body = kind === 'section' ? t.slice(1, -1) : t
  const norm = normalizeLyric(body)
  // Só símbolos ("♪", "...") → compara-se o texto cru
  if (norm === '') return { kind, key: `\u0000${body.replace(/\s+/g, ' ').trim()}`, grams: null }
  return { kind, key: norm, grams: bigrams(norm) }
}

function score(a: Prepared, b: Prepared): number {
  if (a.kind !== b.kind) return 0
  if (a.kind === 'blank') return W_BLANK
  // Símbolos: só o mesmo texto (um "—" marcado na sync acende o "—" da letra)
  if (a.kind === 'mark') return a.key === b.key ? W_MARK : 0
  const lyric = a.kind === 'lyric'
  if (a.key === b.key) return lyric ? W_LYRIC : W_SECTION
  if (!a.grams || !b.grams) return 0
  const sim = similarEnough(a.grams, b.grams)
  if (sim < SIMILARITY) return 0
  return Math.round(sim * (lyric ? W_LYRIC_SIMILAR : W_SECTION_SIMILAR))
}

/**
 * Das entradas emparelhadas (pela ordem do sync), fica com o maior conjunto
 * cujos tempos sobem sempre — um tempo escrito à mão fora de ordem perde o
 * tempo (a linha passa a interpolada) em vez de arrastar as outras.
 */
function increasingSubset(times: number[]): boolean[] {
  const n = times.length
  const keep = new Array<boolean>(n).fill(false)
  if (n === 0) return keep
  const tails: number[] = [] // índice do fim da melhor subsequência de cada comprimento
  const prev = new Array<number>(n).fill(-1)
  for (let i = 0; i < n; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (times[tails[mid]] < times[i]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  }
  for (let k = tails[tails.length - 1]; k >= 0; k = prev[k]) keep[k] = true
  return keep
}

/** Põe os tempos nas linhas emparelhadas (só os que mantêm o tempo a subir) */
function applyTimes(
  stageLen: number, sync: readonly SyncEntry[], lineBySync: number[],
): (number | null)[] {
  const timeByLine: (number | null)[] = new Array(stageLen).fill(null)
  const idx: number[] = []
  const times: number[] = []
  for (let k = 0; k < sync.length; k++) {
    if (lineBySync[k] < 0) continue
    const t = validMs(sync[k]?.time_ms)
    if (t == null) continue
    idx.push(k)
    times.push(t)
  }
  const keep = increasingSubset(times)
  for (let r = 0; r < idx.length; r++) {
    if (keep[r]) timeByLine[lineBySync[idx[r]]] = times[r]
  }
  return timeByLine
}

/**
 * Cobertura medida sobre o lado MENOR (linhas de letra do sync vs. da letra):
 * uma letra condensada (refrões repetidos escritos uma vez + "[Refrão]") é um
 * subconjunto do sync, e um sync parcial (só a 1.ª estrofe) é um subconjunto
 * da letra — ambos continuam a ser a sync desta letra. Uma letra de outra
 * música fica baixa dos dois lados.
 */
function lyricCoverage(
  sync: readonly SyncEntry[], lineBySync: number[], stageLines: readonly StageLine[],
): number {
  let total = 0
  let paired = 0
  for (let k = 0; k < sync.length; k++) {
    if (kindOf(sync[k]?.text ?? '') !== 'lyric') continue
    total++
    if (lineBySync[k] >= 0) paired++
  }
  let stageTotal = 0
  for (const l of stageLines) if (l.kind === 'lyric') stageTotal++
  const base = Math.min(total, stageTotal)
  return base === 0 ? 0 : paired / base
}

// ── Emparelhamento ───────────────────────────────────────────────────────

/**
 * Entradas do sync → linhas da letra. Emparelhamento sequencial e monotónico
 * (a k-ésima entrada nunca cai antes da linha da anterior): alinhamento
 * ótimo entre as duas sequências, em que só emparelham linhas do mesmo tipo
 * — texto normalizado igual, ou semelhança ≥ 0.8 (uma gralha corrigida, uma
 * palavra a mais). Uma entrada sem par fica de fora sem arrastar as outras.
 * Com várias soluções igualmente boas, cada entrada fica com a PRIMEIRA linha
 * possível: refrões repetidos emparelham pela ordem.
 *
 * Entradas vazias (pausas de LRC) só emparelham com linhas vazias entre as
 * vizinhas; [Secção] marcadas emparelham com a linha de secção; entradas só
 * com símbolos ("—", "...") só com a mesma linha de símbolos.
 */
export function mapSyncToLyrics(
  stageLines: readonly StageLine[],
  syncLines: readonly SyncEntry[] | null | undefined,
): SyncMapping {
  const sync = syncLines ?? []
  const n = sync.length
  const m = stageLines.length
  const lineBySync = new Array<number>(n).fill(-1)
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
    return { timeByLine: new Array(m).fill(null), lineBySync, coverage: 0 }
  }

  const S = sync.map(e => prepare(e?.text ?? ''))
  const L = stageLines.map(l => prepare(l.kind === 'blank' ? '' : l.text))

  // best[i][j] = melhor pontuação a alinhar sync[i..] com letra[j..]
  const W = m + 1
  const best = new Float64Array((n + 1) * W)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let v = best[(i + 1) * W + j]
      const skipLine = best[i * W + j + 1]
      if (skipLine > v) v = skipLine
      const s = score(S[i], L[j])
      if (s > 0) {
        const take = s + best[(i + 1) * W + j + 1]
        if (take > v) v = take
      }
      best[i * W + j] = v
    }
  }

  // Reconstrução pela frente: emparelha cedo; senão salta a linha da letra
  // (a entrada ainda pode emparelhar adiante); senão a entrada fica sem par
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const cur = best[i * W + j]
    const s = score(S[i], L[j])
    if (s > 0 && s + best[(i + 1) * W + j + 1] === cur) {
      lineBySync[i] = j
      i++
      j++
    } else if (best[i * W + j + 1] === cur) {
      j++
    } else {
      i++
    }
  }

  return {
    timeByLine: applyTimes(m, sync, lineBySync),
    lineBySync,
    coverage: lyricCoverage(sync, lineBySync, stageLines),
  }
}

/** Tempo gravado utilizável (ms ≥ 0) ou null */
function validMs(v: unknown): number | null {
  const t = Number(v)
  return v != null && Number.isFinite(t) && t >= 0 ? t : null
}

/**
 * Editor de sync: tempos já gravados → as linhas do editor (`lines`, as
 * linhas não vazias da letra), pelo TEXTO — a sync só guarda as linhas que
 * levaram toque e pode ter sido feita sobre outra versão da letra. Ao
 * contrário do palco, NÃO tira os tempos repetidos ou fora de ordem: o
 * cantor tem de os ver para os corrigir, e o que não aparece no editor
 * perde-se ao gravar. Sync de outra letra (cobertura baixa) → por posição.
 */
export function restoreSyncTimes(
  lines: readonly string[],
  syncLines: readonly SyncEntry[] | null | undefined,
): (number | null)[] {
  const sync = syncLines ?? []
  const stage = parseStageLines(lines.join('\n'))
  // Uma linha do editor = uma linha de palco (senão, a posição é o que há)
  if (stage.length === lines.length) {
    const mapped = mapSyncToLyrics(stage, sync)
    if (mapped.coverage >= MIN_COVERAGE) {
      const out: (number | null)[] = new Array(lines.length).fill(null)
      mapped.lineBySync.forEach((j, k) => {
        if (j >= 0) out[j] = validMs(sync[k]?.time_ms)
      })
      return out
    }
  }
  return lines.map((_, i) => validMs(sync[i]?.time_ms))
}

/**
 * Plano B para uma sync de outra versão da letra: se o NÚMERO de linhas de
 * letra bate certo, a k-ésima entrada de letra vai para a k-ésima linha de
 * letra (secções, símbolos e vazias ficam sem tempo). Senão, null.
 */
export function mapSyncByOrder(
  stageLines: readonly StageLine[],
  syncLines: readonly SyncEntry[] | null | undefined,
): SyncMapping | null {
  const sync = syncLines ?? []
  const lyricLines: number[] = []
  stageLines.forEach((l, i) => { if (l.kind === 'lyric') lyricLines.push(i) })
  const lyricEntries: number[] = []
  sync.forEach((e, k) => { if (kindOf(e?.text ?? '') === 'lyric') lyricEntries.push(k) })
  if (lyricLines.length === 0 || lyricLines.length !== lyricEntries.length) return null
  const lineBySync = new Array<number>(sync.length).fill(-1)
  lyricEntries.forEach((k, r) => { lineBySync[k] = lyricLines[r] })
  return {
    timeByLine: applyTimes(stageLines.length, sync, lineBySync),
    lineBySync,
    coverage: 1,
  }
}

// ── Tempos no palco ──────────────────────────────────────────────────────

/** Ritmo médio (ms por linha de palco) entre a 1.ª e a última linha com tempo */
function averageStep(timeByLine: readonly (number | null)[], durationMs?: number): number {
  let first = -1
  let last = -1
  for (let i = 0; i < timeByLine.length; i++) {
    if (timeByLine[i] == null) continue
    if (first < 0) first = i
    last = i
  }
  if (first >= 0 && last > first) {
    const step = (timeByLine[last]! - timeByLine[first]!) / (last - first)
    if (step > 0) return step
  }
  // Uma só linha com tempo: as restantes repartem o que falta da música
  if (last >= 0 && durationMs && durationMs > timeByLine[last]!) {
    const remaining = timeByLine.length - last
    if (remaining > 0) return (durationMs - timeByLine[last]!) / remaining
  }
  return DEFAULT_STEP_MS
}

/**
 * Tempo (ms) para a linha `i`. Com tempo → o seu. Sem tempo:
 * - entre duas linhas com tempo → interpolação linear entre as vizinhas;
 * - antes da 1.ª → recua o passo médio a partir dela, sem passar de 0
 *   (sem espaço, repartem o que há até ela; com a 1.ª a 0 ms ficam todas
 *   a 0 — stageTimes desempata, que o relógio não as saberia distinguir);
 * - depois da última → a última + passo médio por linha; com `durationMs`
 *   (maior que a última), o passo encolhe para todas caberem antes do fim.
 * Sem nenhuma linha com tempo → null.
 */
export function timeForLine(
  i: number, timeByLine: readonly (number | null)[], durationMs?: number,
): number | null {
  const len = timeByLine.length
  if (i < 0 || i >= len) return null
  const own = timeByLine[i]
  if (own != null) return own
  let p = i - 1
  while (p >= 0 && timeByLine[p] == null) p--
  let q = i + 1
  while (q < len && timeByLine[q] == null) q++
  if (p >= 0 && q < len) {
    const tp = timeByLine[p]!
    const tq = timeByLine[q]!
    return tp + ((tq - tp) * (i - p)) / (q - p)
  }
  if (p < 0 && q >= len) return null
  const step = averageStep(timeByLine, durationMs)
  if (p < 0) {
    const tq = timeByLine[q]!
    const s = Math.min(step, tq / q)
    return Math.max(0, tq - (q - i) * s)
  }
  // Depois da última: com a duração da música conhecida, as linhas que faltam
  // cabem no que resta dela (um sync parcial nunca empurra a letra para lá do fim)
  const tp = timeByLine[p]!
  let s = step
  if (durationMs && durationMs > tp) s = Math.min(step, (durationMs - tp) / (len - p))
  return tp + (i - p) * s
}

/**
 * Tempos efetivos do palco: todas as linhas de letra com tempo (próprio ou
 * estimado por timeForLine); secções, símbolos e vazias só com o tempo que a
 * sync lhes deu (nunca roubam o destaque de uma linha cantada). null se não
 * houver nenhum tempo.
 *
 * Os tempos sobem SEMPRE (estritamente): o relógio só distingue linhas com
 * instantes diferentes. Uma sync que começa a 0 ms (toque antes do play,
 * "0:00" à mão, [00:00.00] do LRCLIB) com uma linha nova por cima deixaria
 * duas linhas a 0 — a de baixo passa MIN_GAP_MS à frente da anterior.
 */
export function stageTimes(
  stageLines: readonly StageLine[], timeByLine: readonly (number | null)[], durationMs?: number,
): (number | null)[] | null {
  if (!timeByLine.some(t => t != null)) return null
  const out = stageLines.map((l, i) =>
    l.kind === 'lyric' ? timeForLine(i, timeByLine, durationMs) : (timeByLine[i] ?? null))
  let prev = -Infinity
  for (let i = 0; i < out.length; i++) {
    const t = out[i]
    if (t == null) continue
    const v = t > prev ? t : prev + MIN_GAP_MS
    out[i] = v
    prev = v
  }
  return out
}

/** Última linha com tempo ≤ ms (-1 = ainda antes da 1.ª) */
export function activeLineAt(ms: number, times: readonly (number | null)[]): number {
  let idx = -1
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    if (t != null && t <= ms) idx = i
  }
  return idx
}

/**
 * Instante (ms) a pôr no relógio para a linha `i` acender: o seu tempo e uma
 * folga mínima (arredondamentos), sem chegar ao tempo da linha seguinte.
 */
export function lineStartMs(i: number, times: readonly (number | null)[]): number | null {
  const t = times[i]
  if (t == null) return null
  let next: number | null = null
  for (let j = i + 1; j < times.length; j++) {
    const tj = times[j]
    if (tj != null) { next = tj; break }
  }
  const room = next != null && next > t ? (next - t) / 2 : 1
  return t + Math.min(1, room)
}

/** Linha de letra (cantada — sem secções, símbolos e vazias) seguinte a `from` (exclusivo); -1 se não houver */
export function nextLyricLine(stageLines: readonly StageLine[], from: number): number {
  for (let j = Math.max(-1, from) + 1; j < stageLines.length; j++) {
    if (stageLines[j].kind === 'lyric') return j
  }
  return -1
}

/** Linha de letra anterior a `from` (exclusivo); -1 se não houver */
export function prevLyricLine(stageLines: readonly StageLine[], from: number): number {
  for (let j = Math.min(stageLines.length, from) - 1; j >= 0; j--) {
    if (stageLines[j].kind === 'lyric') return j
  }
  return -1
}

// ── Tudo junto ───────────────────────────────────────────────────────────

export type TimingMode = 'match' | 'order' | 'none'

export interface StageTiming {
  /**
   * match — emparelhada pelo texto; order — sync de outra versão da letra,
   * mas com o mesmo número de linhas (por ordem); none — sem sync utilizável
   */
  mode: TimingMode
  /** Cobertura do emparelhamento pelo texto */
  coverage: number
  /** Tempos vindos do sync (por linha de palco) */
  timeByLine: (number | null)[]
  /** Tempos efetivos (stageTimes) — null quando mode = 'none' */
  times: (number | null)[] | null
}

/**
 * Letra + sync → tempos do palco. Cobertura ≥ 0.5 → emparelhamento pelo
 * texto; abaixo disso, por ordem se o nº de linhas de letra bater certo;
 * senão a música fica sem sync (scroll manual) — nunca se desenha o sync.
 */
export function resolveStageTiming(
  stageLines: readonly StageLine[],
  syncLines: readonly SyncEntry[] | null | undefined,
  durationMs?: number,
): StageTiming {
  const empty: (number | null)[] = new Array(stageLines.length).fill(null)
  if (!syncLines || syncLines.length === 0 || stageLines.length === 0) {
    return { mode: 'none', coverage: 0, timeByLine: empty, times: null }
  }
  const matched = mapSyncToLyrics(stageLines, syncLines)
  if (matched.coverage >= MIN_COVERAGE) {
    const times = stageTimes(stageLines, matched.timeByLine, durationMs)
    if (times) return { mode: 'match', coverage: matched.coverage, timeByLine: matched.timeByLine, times }
  }
  const byOrder = mapSyncByOrder(stageLines, syncLines)
  if (byOrder) {
    const times = stageTimes(stageLines, byOrder.timeByLine, durationMs)
    if (times) return { mode: 'order', coverage: matched.coverage, timeByLine: byOrder.timeByLine, times }
  }
  return { mode: 'none', coverage: matched.coverage, timeByLine: empty, times: null }
}
