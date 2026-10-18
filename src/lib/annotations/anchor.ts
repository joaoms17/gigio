/**
 * Anotações ancoradas ao texto — funções puras (sem DOM, sem React).
 *
 * Os traços desenhados no Ensaio deixam de viver em píxeis do bloco da letra:
 * cada ponto fica preso a um CARÁCTER (linha fonte + posição) e é redesenhado
 * no mesmo sítio relativamente a esse carácter em qualquer layout — outro
 * tamanho de letra, entrelinha, largura, re-quebra das linhas, telemóvel ou
 * tablet, retrato ou paisagem, tema do concerto.
 *
 * Porquê: os dois ecrãs (Ensaio e concerto) têm tamanho de letra, entrelinha,
 * largura, rótulos de secção em px fixos e quebras diferentes; uma
 * transformação linear do bloco inteiro (rácios w/h) nunca alinha — os
 * sublinhados subiam para cima do texto e as chavetas cortavam versos.
 *
 * Modelo
 *  - Linha = índice em lyrics.split('\n') ("ln"), o mesmo do LyricsView
 *    (data-ln). As linhas vazias não são âncoras.
 *  - LayoutModel: medição abstrata de um layout (o DOM implementa-a com Range).
 *  - Ancorar (anchorStroke): por ponto, a row visual mais próxima na vertical;
 *    o traço é de TEXTO se ≥ 50% dos pontos caem na extensão horizontal da sua
 *    row (± 0.5em), senão de MARGEM. Texto: X em em desde o carácter visível
 *    mais próximo. Margem: X em em desde o eixo do bloco (o texto é centrado).
 *    Y relativo à row (ou, na margem, à linha): dentro (fração da altura), ou
 *    no intervalo até à vizinha (em desde a borda junto a ela, fração no meio).
 *  - Resolver (resolveStroke): o inverso no layout de destino. Dois pontos que
 *    estavam na mesma row e caem em rows diferentes (re-quebra) partem o
 *    caminho — nunca uma diagonal por cima do texto.
 *
 * Desvios ao modelo inicial (cada um com teste em scripts/test-annotation-anchors.mjs):
 *  1. Margem: Y relativo à LINHA inteira (união das suas rows), não à row do
 *     1.º/último carácter. Com a row, uma chaveta sobre linhas que passam a
 *     ocupar 2 rows só cobria a 1.ª row de cada uma e acabava a meio da última
 *     linha ("as chavetas descaem e cortam versos"). O modo literal continua
 *     disponível (MODE_MARGIN_ROW, opts.marginRows) só para o teste o mostrar.
 *  2. Texto: a row de referência dos pontos no intervalo entre rows escolhe-se
 *     por troço, não ponto a ponto (ver textRefRows). Ponto a ponto, o topo de
 *     um círculo largo prendia-se à linha de cima e, se essa re-quebrasse, o
 *     círculo rasgava-se para outra linha (opts.perPointRows mostra-o).
 *  3. No intervalo, a zona junto à row VIZINHA também conta em em a partir da
 *     borda dela (Y_*_FAR): um ponto preso à row de cima mas mais perto da de
 *     baixo (o topo de um círculo) volta exatamente ao mesmo sítio.
 *  4. payload.lines guarda o texto de TODAS as linhas (não só as dos traços) e
 *     remapLines alinha pela ordem antes de procurar a mais próxima. Só com a
 *     mais próxima, apagar o 1.º refrão despejava os traços dele por cima dos
 *     do 2.º refrão.
 *  5. c conta a partir do 1.º carácter não branco da linha: recuar ou tirar a
 *     indentação (texto igual com trim) não desloca os traços.
 *  6. Margem fora do bloco: desloca-se o traço inteiro para dentro (mantém a
 *     forma de uma chaveta ou de uma nota escrita), em vez de achatar ponto a
 *     ponto; só um traço mais largo do que o bloco é limitado ponto a ponto.
 *  7. Texto: o carácter de referência é uma LETRA (espaços só se a row não
 *     tiver letras) e, entre duas palavras, a da palavra que o traço mais
 *     cobre (ver anchorChar). Preso ao espaço ou à letra mais próxima, o lado
 *     de um círculo à volta da 1.ª palavra de uma row re-quebrada saltava para
 *     o fim da row de cima (opts.anchorSpaces mostra-o).
 */

/* ═══ Geometria e contrato do layout ═══ */

/** Retângulo em px, no MESMO referencial dos pontos dos traços (o da camada de desenho) */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Medição de um layout da letra. É um retrato imutável: quando o layout muda
 * (resize, rotação, A+/A-, letra editada, fontes carregadas) cria-se um
 * objeto NOVO — os dados derivados ficam em cache por objeto (WeakMap).
 */
export interface LayoutModel {
  /** 1em da letra (o --lyric-size do LyricsView), em px */
  em: number
  /** Extensão horizontal do bloco da letra */
  blockLeft: number
  blockRight: number
  /** Eixo de centragem das linhas (o LyricsView centra o texto) */
  centerX: number
  /** Linhas âncora presentes (data-ln: texto e rótulos de secção; sem quebras) */
  lines: readonly number[]
  /**
   * Rows visuais da linha, de cima para baixo: a caixa do CONTEÚDO do texto
   * (Range.getClientRects do nó de texto, uma por linha de ecrã — ver
   * mergeRowRects), não a line box. [] se a linha não existe.
   */
  rows(ln: number): readonly Box[]
  /** Texto renderizado (o nó de texto: a linha como foi escrita, ou o rótulo da secção) */
  text(ln: number): string
  /**
   * Caixa do carácter `c` (índice UTF-16 em text(ln)); null se não existe ou
   * não tem caixa. Largura 0 = invisível (espaço colapsado). Pedida de forma
   * preguiçosa: só para os caracteres de que o cálculo precisa.
   */
  charRect(ln: number, c: number): Box | null
}

/* ═══ Traço ancorado ═══ */

/** Traço de texto: X preso ao carácter */
export const MODE_TEXT = 0
/** Traço de margem (chavetas, setas, notas ao lado): X preso ao eixo do bloco, Y à linha */
export const MODE_MARGIN = 1
/** Margem com Y preso à row do 1.º/último carácter — modelo literal, só para comparação */
export const MODE_MARGIN_ROW = 2
export type StrokeMode = typeof MODE_TEXT | typeof MODE_MARGIN | typeof MODE_MARGIN_ROW

/*
 * Y fora da row de referência, no intervalo até à vizinha (na sequência
 * vertical global): zona junto a cada borda com n = min(0.5em, intervalo/2),
 * medida em em a partir dessa borda; o meio do intervalo por fração.
 * Sem vizinha (antes da 1.ª / depois da última row): em desde a borda.
 */
/** Y dentro da row/linha: fração 0..1 da altura */
export const Y_IN = 0
/** Por baixo, junto à borda da própria row (ou sem vizinha): em desde essa borda */
export const Y_BELOW = 1
/** Por baixo, no meio do intervalo: fração do meio, a contar do lado da própria row */
export const Y_BELOW_MID = 2
/** Por baixo, junto à row vizinha de baixo: em desde o topo dela */
export const Y_BELOW_FAR = 3
/** Por cima, junto à borda da própria row (ou sem vizinha): em desde essa borda */
export const Y_ABOVE = 4
/** Por cima, no meio do intervalo */
export const Y_ABOVE_MID = 5
/** Por cima, junto à row vizinha de cima: em desde a base dela */
export const Y_ABOVE_FAR = 6
/** Maior código guardado por ponto (yk × 2 + same) */
const MAX_CODE = Y_ABOVE_FAR * 2 + 1

/** Números por ponto em AnchoredStroke.p */
export const P_STRIDE = 6
/** Largura mínima de um traço resolvido (px) */
export const MIN_WIDTH_PX = 1.5

/** Folga horizontal (em) para um ponto contar como "em cima do texto" */
const TEXT_SLACK_EM = 0.5
/** Zona junto a cada borda de um intervalo entre rows (em; no máximo meio intervalo) */
const GAP_EDGE_EM = 0.5
/** em quando o layout não traz um valor válido */
const FALLBACK_EM = 16
const DEFAULT_COLOR = '#000000'

/** Texto (trim) das linhas da letra: { "ln": "texto" } — ver collectLines */
export type SavedLines = Record<string, string>
/** ln guardado → ln na letra atual */
export type LineMap = ReadonlyMap<number, number>

export interface AnchoredStroke {
  id: string
  color: string
  /** Largura em em (px ÷ em do layout onde foi desenhado) */
  w: number
  mode: StrokeMode
  /**
   * Pontos, P_STRIDE números cada: [ln, c, x, yk, yv, same]
   *  ln   — linha fonte
   *  c    — carácter de referência, a contar do 1.º carácter não branco
   *  x    — em: texto → desde o left do carácter; margem → desde o centerX
   *  yk   — Y_IN | Y_BELOW | Y_BELOW_MID | Y_BELOW_FAR | Y_ABOVE | Y_ABOVE_MID | Y_ABOVE_FAR
   *  yv   — fração (Y_IN, *_MID) ou em desde a borda (junto à própria row / à vizinha)
   *  same — 1 = mesma row (margem: mesma linha) que o ponto anterior, na origem
   * x e yv vêm arredondados a 3 casas: o que se grava é o que se desenha.
   */
  p: number[]
  /**
   * Só nos traços órfãos (a maioria das suas linhas desapareceu da letra):
   * o texto dessas linhas, para o traço voltar se a letra voltar. Um órfão
   * fica escondido mas nunca é apagado do payload.
   */
  lines?: SavedLines
}

export interface ResolvedStroke {
  id: string
  color: string
  /** Largura em px no layout de destino (≥ MIN_WIDTH_PX) */
  width: number
  /** Caminhos [x0,y0, x1,y1, ...] em px; vários quando a re-quebra parte o traço */
  subpaths: number[][]
  /** true = não se desenha (órfão, ou a maioria dos pontos ficou sem linha) */
  hidden: boolean
}

/* ═══ Índice derivado do layout (cache por objeto) ═══ */

interface VBand {
  top: number
  bottom: number
}
interface Row extends Box {
  ln: number
  /** Índice da row dentro da sua linha */
  ri: number
}
interface LineBand extends VBand {
  ln: number
}
interface CharBox {
  c: number
  left: number
  right: number
  /** Espaço em branco: só serve de âncora se a row não tiver mais nada */
  ws: boolean
}
interface CharHit {
  /** X de referência do carácter no destino */
  left: number
  /** Índice global da row que o contém */
  g: number
}

interface Index {
  L: LayoutModel
  em: number
  centerX: number
  minX: number
  maxX: number
  /** Todas as rows de todas as linhas, pela ordem vertical */
  rows: Row[]
  lineRows: Map<number, Row[]>
  /** ln → índice global de cada uma das suas rows */
  rowIdx: Map<number, number[]>
  /** Uma banda por linha (união das suas rows), pela ordem vertical */
  bands: LineBand[]
  bandIdx: Map<number, number>
  leads: Map<number, number>
  /** ln → caracteres visíveis de cada row (só quando se ancora) */
  rowChars: Map<number, CharBox[][]>
  /** ln → palavra de cada carácter (só quando se ancora) */
  words: Map<number, Int32Array>
  hits: Map<number, Map<number, CharHit | null>>
  memo: WeakMap<object, WeakMap<AnchoredStroke, ResolvedStroke>>
}

const indexCache = new WeakMap<LayoutModel, Index>()
/** Chave do memo de resolveStroke sem lineMap */
const IDENTITY = {}

function fin(n: unknown): n is number {
  return typeof n === 'number' && isFinite(n)
}

function okBox(b: Box | null | undefined): b is Box {
  return !!b && fin(b.left) && fin(b.top) && fin(b.right) && fin(b.bottom) &&
    b.right >= b.left && b.bottom >= b.top
}

function visibleBox(b: Box | null | undefined): b is Box {
  return okBox(b) && b.right > b.left
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

function indexOf(L: LayoutModel): Index {
  let ix = indexCache.get(L)
  if (!ix) {
    ix = buildIndex(L)
    indexCache.set(L, ix)
  }
  return ix
}

function buildIndex(L: LayoutModel): Index {
  const em = fin(L.em) && L.em > 0 ? L.em : FALLBACK_EM
  const rows: Row[] = []
  const lineRows = new Map<number, Row[]>()
  const lns = Array.isArray(L.lines) ? L.lines : []
  for (const ln of lns) {
    if (!Number.isInteger(ln) || ln < 0 || lineRows.has(ln)) continue
    const raw = L.rows(ln)
    if (!raw || !raw.length) continue
    const boxes: Box[] = []
    for (let i = 0; i < raw.length; i++) if (okBox(raw[i])) boxes.push(raw[i])
    if (!boxes.length) continue
    boxes.sort((a, b) => a.top - b.top)
    const mine = boxes.map((b, ri): Row => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom, ln, ri }))
    lineRows.set(ln, mine)
    for (const r of mine) rows.push(r)
  }
  rows.sort((a, b) => a.top - b.top || a.ln - b.ln || a.ri - b.ri)
  const rowIdx = new Map<number, number[]>()
  rows.forEach((r, g) => {
    let list = rowIdx.get(r.ln)
    if (!list) rowIdx.set(r.ln, (list = []))
    list[r.ri] = g
  })
  const bands: LineBand[] = []
  lineRows.forEach((rs, ln) => {
    let top = Infinity
    let bottom = -Infinity
    for (const r of rs) {
      if (r.top < top) top = r.top
      if (r.bottom > bottom) bottom = r.bottom
    }
    bands.push({ ln, top, bottom })
  })
  bands.sort((a, b) => a.top - b.top || a.ln - b.ln)
  const bandIdx = new Map<number, number>()
  bands.forEach((b, k) => bandIdx.set(b.ln, k))
  const minX = fin(L.blockLeft) ? L.blockLeft : -Infinity
  const maxX = fin(L.blockRight) && L.blockRight >= minX ? L.blockRight : Infinity
  const centerX = fin(L.centerX) ? L.centerX : isFinite(minX) && isFinite(maxX) ? (minX + maxX) / 2 : 0
  return {
    L, em, centerX, minX, maxX, rows, lineRows, rowIdx, bands, bandIdx,
    leads: new Map(), rowChars: new Map(), words: new Map(), hits: new Map(), memo: new WeakMap(),
  }
}

/** Índice da banda mais próxima de y na vertical (dentro, ou a borda mais próxima); empate → a de cima */
function nearest(list: readonly VBand[], y: number): number {
  let best = -1
  let bestD = Infinity
  for (let k = 0; k < list.length; k++) {
    const b = list[k]
    const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0
    // Estritamente menor: num empate fica a anterior — a lista está por ordem vertical
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

function textOf(L: LayoutModel, ln: number): string {
  const t = L.text(ln)
  return typeof t === 'string' ? t : ''
}

/** Caracteres brancos no início do texto (o mesmo critério do trim) */
function leadOf(ix: Index, ln: number): number {
  let v = ix.leads.get(ln)
  if (v === undefined) {
    const t = textOf(ix.L, ln)
    v = t.length - t.replace(/^\s+/, '').length
    ix.leads.set(ln, v)
  }
  return v
}

/** Row (índice na linha) que contém a caixa: maior sobreposição vertical, senão a mais próxima */
function rowOfBox(rs: readonly Row[], b: Box): number {
  let best = -1
  let bestOv = 0
  for (let i = 0; i < rs.length; i++) {
    const ov = Math.min(b.bottom, rs[i].bottom) - Math.max(b.top, rs[i].top)
    if (ov > bestOv) {
      bestOv = ov
      best = i
    }
  }
  return best >= 0 ? best : nearest(rs, (b.top + b.bottom) / 2)
}

/** Caracteres visíveis da linha, separados por row (mede a linha toda — só ao ancorar) */
function charsOf(ix: Index, ln: number): CharBox[][] {
  let per = ix.rowChars.get(ln)
  if (per) return per
  const rs = ix.lineRows.get(ln) ?? []
  const lists: CharBox[][] = rs.map(() => [])
  const text = textOf(ix.L, ln)
  for (let c = 0; c < text.length; c++) {
    const b = ix.L.charRect(ln, c)
    if (!visibleBox(b)) continue
    const ri = rowOfBox(rs, b)
    if (ri >= 0) lists[ri].push({ c, left: b.left, right: b.right, ws: /\s/.test(text[c]) })
  }
  per = lists
  ix.rowChars.set(ln, per)
  return per
}

/** Letra (não espaço) da row cuja caixa contém x */
function letterAt(list: readonly CharBox[], x: number): CharBox | null {
  for (const ch of list) if (!ch.ws && x >= ch.left && x <= ch.right) return ch
  return null
}

/** Índice da palavra de cada carácter da linha (-1 nos espaços) */
function wordsOf(ix: Index, ln: number): Int32Array {
  let w = ix.words.get(ln)
  if (!w) {
    const t = textOf(ix.L, ln)
    w = new Int32Array(t.length)
    let k = -1
    for (let c = 0; c < t.length; c++) {
      const ws = /\s/.test(t[c])
      if (!ws && (c === 0 || /\s/.test(t[c - 1]))) k++
      w[c] = ws ? -1 : k
    }
    ix.words.set(ln, w)
  }
  return w
}

/**
 * Carácter de referência de um ponto de um traço de TEXTO.
 * Em cima de uma letra → essa. Entre duas palavras (no espaço) → se o traço
 * só passa por cima de uma delas, a letra dessa (o lado de um círculo
 * pertence à palavra que rodeia, não à vizinha); senão a mais próxima.
 * Nunca um espaço se houver letras: um espaço pode ser exatamente onde outro
 * layout quebra a linha (e aí colapsa), e o traço saltava para a row de cima.
 */
function anchorChar(
  list: readonly CharBox[], x: number, words: Int32Array, cover: Map<number, number>,
): CharBox | null {
  const on = letterAt(list, x)
  if (on) return on
  let left: CharBox | null = null
  let right: CharBox | null = null
  for (const ch of list) {
    if (ch.ws) continue
    if (ch.right <= x && (!left || ch.right > left.right)) left = ch
    if (ch.left >= x && (!right || ch.left < right.left)) right = ch
  }
  if (!left || !right) return left ?? right ?? nearestChar(list, x, true)
  const wl = words[left.c]
  const wr = words[right.c]
  if (wl !== wr) {
    // Só uma das duas palavras está debaixo do traço → essa; as duas
    // (sublinhado que as apanha) → a mais próxima, cada metade do espaço
    // segue a sua palavra se a linha quebrar ali
    const cl = cover.get(wl) ?? 0
    const cr = cover.get(wr) ?? 0
    if (!cl !== !cr) return cl ? left : right
  }
  return x - left.right <= right.left - x ? left : right
}

/** Carácter mais próximo de x (distância ao intervalo; empate → centro mais perto); letras primeiro */
function nearestChar(list: readonly CharBox[], x: number, spaces = false): CharBox | null {
  let best: CharBox | null = null
  let bestD = Infinity
  let bestC = Infinity
  for (const ch of list) {
    if (ch.ws && !spaces) continue
    const d = x < ch.left ? ch.left - x : x > ch.right ? x - ch.right : 0
    const dc = Math.abs(x - (ch.left + ch.right) / 2)
    if (d < bestD || (d === bestD && dc < bestC)) {
      best = ch
      bestD = d
      bestC = dc
    }
  }
  return best ?? (spaces ? null : nearestChar(list, x, true))
}

/** 1.º (ou último) carácter visível pela ordem do texto (letras primeiro) */
function edgeChar(list: readonly CharBox[], first: boolean): CharBox | null {
  let best: CharBox | null = null
  for (const ch of list) {
    if (!best || (best.ws && !ch.ws) || (best.ws === ch.ws && (first ? ch.c < best.c : ch.c > best.c))) best = ch
  }
  return best
}

/**
 * Carácter (ln, cRel) no layout: X de referência + row que o contém. Um
 * carácter sem caixa (ex.: espaço colapsado numa quebra) usa o vizinho
 * visível mais perto: o right do anterior, ou o left do seguinte.
 */
function resolveChar(ix: Index, ln: number, cRel: number): CharHit | null {
  const rs = ix.lineRows.get(ln)
  if (!rs) return null
  const len = textOf(ix.L, ln).length
  if (!len) return null
  const c = Math.min(len - 1, Math.max(0, Math.round(leadOf(ix, ln) + cRel)))
  let perLine = ix.hits.get(ln)
  if (!perLine) ix.hits.set(ln, (perLine = new Map()))
  const cached = perLine.get(c)
  if (cached !== undefined) return cached
  const gs = ix.rowIdx.get(ln) ?? []
  const at = (k: number) => {
    const b = ix.L.charRect(ln, k)
    return visibleBox(b) ? b : null
  }
  const hit = (left: number, b: Box): CharHit | null => {
    const ri = rowOfBox(rs, b)
    return ri >= 0 && gs[ri] !== undefined ? { left, g: gs[ri] } : null
  }
  let res: CharHit | null = null
  const b = at(c)
  if (b) res = hit(b.left, b)
  else {
    const far = Math.max(c, len - 1 - c)
    for (let d = 1; d <= far && !res; d++) {
      const pb = c - d >= 0 ? at(c - d) : null
      if (pb) {
        res = hit(pb.right, pb)
        break
      }
      const nb = c + d < len ? at(c + d) : null
      if (nb) res = hit(nb.left, nb)
    }
  }
  if (!res && gs[0] !== undefined) res = { left: rs[0].left, g: gs[0] }
  perLine.set(c, res)
  return res
}

/* ═══ Y: dentro da row, ou no intervalo até à vizinha ═══ */

function encodeY(y: number, list: readonly VBand[], k: number, em: number): [number, number] {
  const b = list[k]
  if (y >= b.top && y <= b.bottom) {
    const h = b.bottom - b.top
    return [Y_IN, h > 0 ? (y - b.top) / h : 0.5]
  }
  const below = y > b.bottom
  const d = below ? y - b.bottom : b.top - y
  const nb = below ? list[k + 1] : list[k - 1]
  const near = below ? Y_BELOW : Y_ABOVE
  if (!nb) return [near, d / em]
  const gap = Math.max(0, below ? nb.top - b.bottom : b.top - nb.bottom)
  const n = Math.min(GAP_EDGE_EM * em, gap / 2)
  if (d <= n) return [near, d / em]
  if (d >= gap - n) return [below ? Y_BELOW_FAR : Y_ABOVE_FAR, Math.max(0, gap - d) / em]
  return [below ? Y_BELOW_MID : Y_ABOVE_MID, (d - n) / (gap - 2 * n)]
}

function decodeY(yk: number, yv: number, list: readonly VBand[], k: number, em: number): number {
  const b = list[k]
  if (yk === Y_IN) return b.top + yv * (b.bottom - b.top)
  const below = yk === Y_BELOW || yk === Y_BELOW_MID || yk === Y_BELOW_FAR
  if (!below && yk !== Y_ABOVE && yk !== Y_ABOVE_MID && yk !== Y_ABOVE_FAR) return NaN
  const edge = below ? b.bottom : b.top
  const dir = below ? 1 : -1
  const nb = below ? list[k + 1] : list[k - 1]
  const zone = below ? yk - Y_BELOW : yk - Y_ABOVE // 0 junto à borda, 1 meio, 2 junto à vizinha
  if (!nb) {
    // Sem vizinha (antes da 1.ª / depois da última row): em desde a borda, sem limite
    const d = zone === 0 ? yv : zone === 1 ? GAP_EDGE_EM + yv : 2 * GAP_EDGE_EM
    return edge + dir * d * em
  }
  const gap = Math.max(0, below ? nb.top - b.bottom : b.top - nb.bottom)
  // Junto a uma borda: nunca passa do meio do intervalo (o sublinhado fica
  // acima da row seguinte mesmo com a entrelinha mais apertada)
  if (zone === 0) return edge + dir * Math.min(yv * em, gap / 2)
  if (zone === 2) return edge + dir * (gap - Math.min(yv * em, gap / 2))
  const n = Math.min(GAP_EDGE_EM * em, gap / 2)
  return edge + dir * (n + yv * (gap - 2 * n))
}

/**
 * Row de referência dos pontos de um traço de TEXTO. Dentro de uma row →
 * essa. No intervalo entre duas rows, por troços seguidos no mesmo
 * intervalo: o troço que entra/sai de uma só das duas rows fica preso a
 * ela (o topo de um círculo pertence à palavra que rodeia, não à linha de
 * cima); entre as duas (seta de uma linha para a outra) → ponto a ponto a
 * mais próxima; solto (sublinhado todo no intervalo) → todo na mais
 * próxima da mediana. Empates → a de cima.
 */
function textRefRows(ix: Index, ys: readonly number[], perPoint: boolean): number[] {
  const rows = ix.rows
  const N = rows.length
  const n = ys.length
  if (perPoint) return ys.map(y => nearest(rows, y))
  const inRow: number[] = []
  const gapOf: number[] = []
  for (let i = 0; i < n; i++) {
    const y = ys[i]
    let inside = -1
    let g = 0
    for (let k = 0; k < N; k++) {
      if (rows[k].top <= y) g = k + 1
      if (inside < 0 && y >= rows[k].top && y <= rows[k].bottom) inside = k
    }
    inRow.push(inside)
    gapOf.push(g)
  }
  const ref = inRow.slice()
  const closer = (A: number, B: number, y: number) => (y - rows[A].bottom <= rows[B].top - y ? A : B)
  let i = 0
  while (i < n) {
    if (inRow[i] >= 0) {
      i++
      continue
    }
    let e = i
    while (e + 1 < n && inRow[e + 1] < 0 && gapOf[e + 1] === gapOf[i]) e++
    const A = gapOf[i] - 1
    const B = gapOf[i]
    const before = i > 0 ? inRow[i - 1] : -1
    const after = e + 1 < n ? inRow[e + 1] : -1
    const tA = A >= 0 && (before === A || after === A)
    const tB = B < N && (before === B || after === B)
    let pick = -1
    if (A < 0) pick = B
    else if (B >= N) pick = A
    else if (tA !== tB) pick = tA ? A : B
    else if (!tA) {
      const run = ys.slice(i, e + 1).sort((a, b) => a - b)
      pick = closer(A, B, run[(run.length - 1) >> 1])
    }
    for (let j = i; j <= e; j++) ref[j] = pick >= 0 ? pick : closer(A, B, ys[j])
    i = e + 1
  }
  return ref
}

/* ═══ Ancorar ═══ */

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** true quando o layout não tem texto onde ancorar (letra vazia, "Sem letra") */
export function isLayoutEmpty(layout: LayoutModel): boolean {
  return indexOf(layout).rows.length === 0
}

/**
 * Só para os testes compararem com o modelo literal (ver topo):
 * marginRows — margem com Y preso à row; perPointRows — row de referência
 * ponto a ponto (sem troços); anchorSpaces — espaços como âncora, como as letras
 */
export interface AnchorOptions {
  marginRows?: boolean
  perPointRows?: boolean
  anchorSpaces?: boolean
}

/**
 * Ancora um traço (pontos em px no layout de origem — o Ensaio, no pointerup).
 * Devolve null se não há pontos válidos ou o layout não tem texto.
 */
export function anchorStroke(
  ptsPx: readonly number[],
  color: string,
  widthPx: number,
  layout: LayoutModel,
  id?: string,
  opts?: AnchorOptions,
): AnchoredStroke | null {
  const ix = indexOf(layout)
  if (!ix.rows.length || !ptsPx) return null
  const em = ix.em
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i + 1 < ptsPx.length; i += 2) {
    const x = ptsPx[i]
    const y = ptsPx[i + 1]
    if (fin(x) && fin(y)) {
      xs.push(x)
      ys.push(y)
    }
  }
  const n = xs.length
  if (!n) return null

  // 1-2. Row de referência de cada ponto + modo do traço
  let ref = textRefRows(ix, ys, !!opts?.perPointRows)
  let inside = 0
  const slack = TEXT_SLACK_EM * em
  for (let i = 0; i < n; i++) {
    const r = ix.rows[ref[i]]
    if (xs[i] >= r.left - slack && xs[i] <= r.right + slack) inside++
  }
  const mode: StrokeMode = inside * 2 >= n ? MODE_TEXT : opts?.marginRows ? MODE_MARGIN_ROW : MODE_MARGIN
  // Margem presa à row (modelo literal): a row mais próxima, ponto a ponto
  if (mode === MODE_MARGIN_ROW) ref = textRefRows(ix, ys, true)

  // Texto: quantos pontos caem em cima das letras de cada palavra (por linha)
  const cover = new Map<number, Map<number, number>>()
  if (mode === MODE_TEXT) {
    for (let i = 0; i < n; i++) {
      const r = ix.rows[ref[i]]
      const ch = letterAt(charsOf(ix, r.ln)[r.ri] ?? [], xs[i])
      if (!ch) continue
      const w = wordsOf(ix, r.ln)[ch.c]
      let m = cover.get(r.ln)
      if (!m) cover.set(r.ln, (m = new Map()))
      m.set(w, (m.get(w) ?? 0) + 1)
    }
  }

  // 3-5. Carácter de referência, X, Y e o bit "mesma row"
  const p: number[] = []
  let prevKey = -1
  const lineEdges = new Map<number, (CharBox | null)[]>()
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const y = ys[i]
    let ln: number
    let c = 0
    let xv: number
    let list: readonly VBand[]
    let k: number
    if (mode === MODE_MARGIN) {
      k = nearest(ix.bands, y)
      ln = ix.bands[k].ln
      list = ix.bands
      let edges = lineEdges.get(ln)
      if (!edges) {
        const all: CharBox[] = []
        for (const rc of charsOf(ix, ln)) for (const ch of rc) all.push(ch)
        edges = [edgeChar(all, true), edgeChar(all, false)]
        lineEdges.set(ln, edges)
      }
      const ch = edges[x < ix.centerX ? 0 : 1]
      if (ch) c = ch.c
      xv = (x - ix.centerX) / em
    } else {
      k = ref[i]
      const r = ix.rows[k]
      ln = r.ln
      list = ix.rows
      const rc = charsOf(ix, ln)[r.ri] ?? []
      if (mode === MODE_TEXT) {
        const ch = opts?.anchorSpaces
          ? nearestChar(rc, x, true)
          : anchorChar(rc, x, wordsOf(ix, ln), cover.get(ln) ?? new Map())
        if (ch) {
          c = ch.c
          xv = (x - ch.left) / em
        } else xv = (x - r.left) / em
      } else {
        const ch = edgeChar(rc, x < ix.centerX)
        if (ch) c = ch.c
        xv = (x - ix.centerX) / em
      }
    }
    const [yk, yv] = encodeY(y, list, k, em)
    p.push(ln, c - leadOf(ix, ln), r3(xv), yk, r3(yv), i > 0 && k === prevKey ? 1 : 0)
    prevKey = k
  }
  return {
    id: typeof id === 'string' && id ? id : newId(),
    color: typeof color === 'string' && color ? color : DEFAULT_COLOR,
    w: r3((fin(widthPx) && widthPx > 0 ? widthPx : MIN_WIDTH_PX) / em),
    mode,
    p,
  }
}

/**
 * Traços antigos (px do Ensaio, sem âncoras): adotar como antes — re-escalar
 * de (w, h) guardados para o bloco atual (sem h, Y segue o rácio de X) — e
 * ancorar contra o layout atual. Os que não ancoram (letra vazia) ficam de fora.
 */
export function anchorLegacy(
  saved: { w?: number; h?: number; strokes?: readonly LegacyStroke[] } | null | undefined,
  layout: LayoutModel,
  blockW: number,
  blockH: number,
): AnchoredStroke[] {
  const list = saved?.strokes
  const strokes: readonly LegacyStroke[] = Array.isArray(list) ? list : []
  if (!strokes.length) return []
  const w = saved?.w ?? 0
  const h = saved?.h ?? 0
  const kx = fin(w) && w > 0 && fin(blockW) && blockW > 0 ? blockW / w : 1
  const ky = fin(h) && h > 0 && fin(blockH) && blockH > 0 ? blockH / h : kx
  const out: AnchoredStroke[] = []
  for (const s of strokes) {
    if (!s || !Array.isArray(s.pts)) continue
    const pts = s.pts.map((v, i) => v * (i % 2 === 0 ? kx : ky))
    const a = anchorStroke(pts, s.color, (fin(s.width) ? s.width : MIN_WIDTH_PX) * kx, layout, s.id)
    if (a) out.push(a)
  }
  return out
}

/* ═══ Resolver ═══ */

/**
 * Redesenha um traço ancorado num layout. `lineMap` (de remapLines) traduz as
 * linhas guardadas para a letra atual; sem ele as linhas são as mesmas.
 * O resultado fica em cache por (layout, lineMap, traço) — não o alterar.
 */
export function resolveStroke(a: AnchoredStroke, layout: LayoutModel, lineMap?: LineMap | null): ResolvedStroke {
  const ix = indexOf(layout)
  const key: object = lineMap ?? IDENTITY
  let memo = ix.memo.get(key)
  if (!memo) ix.memo.set(key, (memo = new WeakMap()))
  const hit = memo.get(a)
  if (hit) return hit
  const out = computeStroke(a, ix, lineMap ?? null)
  memo.set(a, out)
  return out
}

/** resolveStroke de uma lista inteira */
export function resolveAll(
  strokes: readonly AnchoredStroke[],
  layout: LayoutModel,
  lineMap?: LineMap | null,
): ResolvedStroke[] {
  return strokes.map(s => resolveStroke(s, layout, lineMap))
}

function computeStroke(a: AnchoredStroke, ix: Index, lineMap: LineMap | null): ResolvedStroke {
  const em = ix.em
  const w = fin(a.w) && a.w > 0 ? a.w * em : 0
  const out: ResolvedStroke = {
    id: a.id,
    color: a.color,
    width: Math.max(MIN_WIDTH_PX, w),
    subpaths: [],
    hidden: false,
  }
  const p = Array.isArray(a.p) ? a.p : []
  const n = Math.floor(p.length / P_STRIDE)
  // Órfão: as suas linhas já não existem na letra (ver rebaseStrokes)
  if (a.lines || !n || !ix.rows.length) {
    out.hidden = true
    return out
  }
  const textMode = a.mode === MODE_TEXT
  const rowMode = textMode || a.mode === MODE_MARGIN_ROW
  let cur: number[] | null = null
  let prevG = -1
  let lost = 0
  for (let i = 0; i < n; i++) {
    const o = i * P_STRIDE
    const ln0 = p[o]
    const ln = lineMap ? lineMap.get(ln0) : ln0
    let x = NaN
    let y = NaN
    let g = -1
    if (ln !== undefined && fin(ln)) {
      if (rowMode) {
        const ch = resolveChar(ix, ln, p[o + 1])
        if (ch) {
          g = ch.g
          x = textMode ? ch.left + p[o + 2] * em : ix.centerX + p[o + 2] * em
          y = decodeY(p[o + 3], p[o + 4], ix.rows, g, em)
        }
      } else {
        const k = ix.bandIdx.get(ln)
        if (k !== undefined) {
          g = k
          x = ix.centerX + p[o + 2] * em
          y = decodeY(p[o + 3], p[o + 4], ix.bands, k, em)
        }
      }
    }
    if (!fin(x) || !fin(y)) {
      lost++
      cur = null
      continue
    }
    // Mesma row na origem, rows diferentes aqui (re-quebra): parte o caminho
    if (!cur || (rowMode && p[o + 5] === 1 && g !== prevG)) {
      cur = []
      out.subpaths.push(cur)
    }
    cur.push(x, y)
    prevG = g
  }
  // A maioria dos pontos ficou sem linha: esconde (não apaga)
  if (lost * 2 > n) out.subpaths = []
  // Um ponto solto que a re-quebra separou do resto não se desenha
  else if (n > 1) out.subpaths = out.subpaths.filter(s => s.length > 2)
  if (!textMode) fitToBlock(out.subpaths, ix)
  out.hidden = out.subpaths.length === 0
  return out
}

/**
 * Margem: o traço tem de caber no bloco (o concerto corta o que sai). Desloca
 * o traço INTEIRO para dentro — uma chaveta ou uma nota escrita à mão mantém
 * a forma; só se for mais largo do que o bloco é que cada ponto é limitado.
 */
function fitToBlock(subpaths: number[][], ix: Index): void {
  let lo = Infinity
  let hi = -Infinity
  for (const sp of subpaths) {
    for (let i = 0; i < sp.length; i += 2) {
      if (sp[i] < lo) lo = sp[i]
      if (sp[i] > hi) hi = sp[i]
    }
  }
  if (!(lo < ix.minX || hi > ix.maxX)) return
  const fits = hi - lo <= ix.maxX - ix.minX
  const shift = lo < ix.minX ? ix.minX - lo : ix.maxX - hi
  for (const sp of subpaths) {
    for (let i = 0; i < sp.length; i += 2) {
      sp[i] = fits ? sp[i] + shift : Math.min(ix.maxX, Math.max(ix.minX, sp[i]))
    }
  }
}

/* ═══ Letra editada depois de desenhar ═══ */

function savedEntries(saved: SavedLines | ReadonlyMap<number, string> | null | undefined): [number, string][] {
  const out: [number, string][] = []
  if (!saved || typeof saved !== 'object') return out
  const push = (k: unknown, v: unknown) => {
    const ln = typeof k === 'number' ? k : Number(k)
    if (!Number.isInteger(ln) || ln < 0 || typeof v !== 'string') return
    const t = v.trim()
    if (t) out.push([ln, t])
  }
  if (saved instanceof Map) saved.forEach((v, k) => push(k, v))
  else for (const k of Object.keys(saved)) push(k, (saved as SavedLines)[k])
  return out
}

/** Acima disto (linhas guardadas × linhas atuais) não se alinha — só a 2.ª passagem */
const MAX_ALIGN_CELLS = 4000000

/**
 * Linhas guardadas → linhas da letra atual, pelo texto (trim).
 *  1. Alinhamento pela ordem (o maior número de linhas iguais sem se
 *     cruzarem; empate → o menor deslocamento total): linha inserida,
 *     removida ou mudada não baralha as outras, e um refrão repetido fica
 *     com a ocorrência certa mesmo quando outra ocorrência foi apagada.
 *  2. As que sobram (ex.: estrofe mudada de sítio) vão para a linha livre com
 *     o mesmo texto mais próxima do índice antigo.
 * Cada linha atual recebe no máximo uma linha guardada. Linha mudada ou
 * apagada → sem entrada no mapa.
 * Com o texto de TODAS as linhas (collectLines) o passo 1 tem contexto para
 * acertar; só com as linhas dos traços (órfãos) é o melhor possível.
 */
export function remapLines(
  saved: SavedLines | ReadonlyMap<number, string> | null | undefined,
  lyrics: string | null | undefined,
): Map<number, number> {
  const out = new Map<number, number>()
  const entries = savedEntries(saved).sort((a, b) => a[0] - b[0])
  if (!entries.length) return out
  const cur = String(lyrics ?? '').split('\n').map(l => l.trim())
  // O caso normal: a letra não mudou nestas linhas
  if (entries.every(([ln, t]) => cur[ln] === t)) {
    for (const [ln] of entries) out.set(ln, ln)
    return out
  }
  const used = new Set<number>()
  const m = entries.length
  const n = cur.length
  if (m * n <= MAX_ALIGN_CELLS) {
    // best[i][j] para os sufixos (entries[i..], cur[j..]): M = pares, C = deslocamento
    const W = n + 1
    const M = new Int32Array((m + 1) * W)
    const C = new Float64Array((m + 1) * W)
    for (let i = m - 1; i >= 0; i--) {
      const [ln, t] = entries[i]
      for (let j = n - 1; j >= 0; j--) {
        const a = (i + 1) * W + j
        const b = i * W + j + 1
        let bm = M[a]
        let bc = C[a]
        if (M[b] > bm || (M[b] === bm && C[b] < bc)) {
          bm = M[b]
          bc = C[b]
        }
        if (cur[j] === t) {
          const d = (i + 1) * W + j + 1
          const mm = M[d] + 1
          const cc = C[d] + Math.abs(j - ln)
          if (mm > bm || (mm === bm && cc <= bc)) {
            bm = mm
            bc = cc
          }
        }
        M[i * W + j] = bm
        C[i * W + j] = bc
      }
    }
    let i = 0
    let j = 0
    while (i < m && j < n) {
      const [ln, t] = entries[i]
      const here = i * W + j
      if (cur[j] === t) {
        const d = (i + 1) * W + j + 1
        if (M[d] + 1 === M[here] && C[d] + Math.abs(j - ln) === C[here]) {
          out.set(ln, j)
          used.add(j)
          i++
          j++
          continue
        }
      }
      const a = (i + 1) * W + j
      if (M[a] === M[here] && C[a] === C[here]) i++
      else j++
    }
  }
  // 2.ª passagem: as que sobram → linha livre com o mesmo texto mais próxima
  const where = new Map<string, number[]>()
  for (let j = 0; j < n; j++) {
    if (!cur[j] || used.has(j)) continue
    let list = where.get(cur[j])
    if (!list) where.set(cur[j], (list = []))
    list.push(j)
  }
  for (const [ln, t] of entries) {
    if (out.has(ln)) continue
    let best = -1
    for (const j of where.get(t) ?? []) {
      if (!used.has(j) && (best < 0 || Math.abs(j - ln) < Math.abs(best - ln))) best = j
    }
    if (best >= 0) {
      out.set(ln, best)
      used.add(best)
    }
  }
  return out
}

/**
 * Retrato do texto (trim) de TODAS as linhas não vazias da letra, para
 * payload.lines — o contexto completo deixa remapLines acertar quando a letra
 * for editada. Sem traços (não órfãos) não há nada a guardar.
 */
export function collectLines(strokes: readonly AnchoredStroke[], lyrics: string | null | undefined): SavedLines {
  const out: SavedLines = {}
  if (!strokes.some(s => !s.lines && s.p.length >= P_STRIDE)) return out
  const src = String(lyrics ?? '').split('\n')
  for (let ln = 0; ln < src.length; ln++) {
    const t = src[ln].trim()
    if (t) out[String(ln)] = t
  }
  return out
}

function pickLines(s: AnchoredStroke, saved: SavedLines): SavedLines {
  const out: SavedLines = {}
  for (let o = 0; o + P_STRIDE <= s.p.length; o += P_STRIDE) {
    const key = String(s.p[o])
    if (typeof saved[key] === 'string') out[key] = saved[key]
  }
  return out
}

/**
 * Passa os traços para a numeração da letra atual. `saved` é o texto das
 * linhas quando os traços foram ancorados (payload.lines); null = sem
 * registo (payload antigo) → ficam como estão. Os pontos cujas linhas
 * desapareceram saem; um traço que perca a maioria fica ÓRFÃO (escondido,
 * com o texto das suas linhas) e volta se essas linhas voltarem.
 * `changed` = false devolve os mesmos objetos (os caches continuam válidos).
 */
export function rebaseStrokes(
  strokes: readonly AnchoredStroke[],
  saved: SavedLines | null | undefined,
  lyrics: string | null | undefined,
): { strokes: AnchoredStroke[]; changed: boolean } {
  const shared = saved ? remapLines(saved, lyrics) : null
  let changed = false
  const out = strokes.map(s => {
    const map = s.lines ? remapLines(s.lines, lyrics) : shared
    const n = Math.floor(s.p.length / P_STRIDE)
    if (!map || !n) return s
    let lost = 0
    let moved = false
    for (let i = 0; i < n; i++) {
      const ln = s.p[i * P_STRIDE]
      const j = map.get(ln)
      if (j === undefined) lost++
      else if (j !== ln) moved = true
    }
    if (lost * 2 > n) {
      if (s.lines) return s
      changed = true
      return { ...s, lines: pickLines(s, saved ?? {}) }
    }
    if (!lost && !moved && !s.lines) return s
    changed = true
    const p: number[] = []
    let gap = false
    for (let i = 0; i < n; i++) {
      const o = i * P_STRIDE
      const j = map.get(s.p[o])
      if (j === undefined) {
        gap = true
        continue
      }
      p.push(j, s.p[o + 1], s.p[o + 2], s.p[o + 3], s.p[o + 4], gap || !p.length ? 0 : s.p[o + 5])
      gap = false
    }
    const next: AnchoredStroke = { id: s.id, color: s.color, w: s.w, mode: s.mode, p }
    return next
  })
  return { strokes: out, changed }
}

/* ═══ Formato guardado (compacto) ═══ */

/**
 * Traço compacto: [id, cor, largura×1000, modo, runs, cs, xs, ys, linhas?]
 *  runs — [ln, código, quantos, ...]: pontos seguidos com a mesma linha e o
 *         mesmo código (yk × 2 + same)
 *  cs   — c de cada ponto, em diferença ao anterior
 *  xs   — x × 1000 (inteiro): texto → absoluto; margem → diferença ao anterior
 *  ys   — yv × 1000 (inteiro), em diferença ao anterior
 *  linhas — só nos órfãos
 */
export type EncodedStroke = (string | number | number[] | SavedLines)[]

export function encodeAnchored(strokes: readonly AnchoredStroke[]): EncodedStroke[] {
  return strokes.map(s => {
    const n = Math.floor(s.p.length / P_STRIDE)
    const runs: number[] = []
    const cs: number[] = []
    const xs: number[] = []
    const ys: number[] = []
    const deltaX = s.mode !== MODE_TEXT
    let pc = 0
    let px = 0
    let py = 0
    for (let i = 0; i < n; i++) {
      const o = i * P_STRIDE
      const ln = s.p[o]
      const code = s.p[o + 3] * 2 + (s.p[o + 5] ? 1 : 0)
      const r = runs.length
      if (r && runs[r - 3] === ln && runs[r - 2] === code) runs[r - 1]++
      else runs.push(ln, code, 1)
      const c = Math.round(s.p[o + 1])
      const x = Math.round(s.p[o + 2] * 1000)
      const y = Math.round(s.p[o + 4] * 1000)
      cs.push(c - pc)
      xs.push(deltaX ? x - px : x)
      ys.push(y - py)
      pc = c
      px = x
      py = y
    }
    const e: EncodedStroke = [s.id, s.color, Math.round(s.w * 1000), s.mode, runs, cs, xs, ys]
    if (s.lines) e.push(s.lines)
    return e
  })
}

function intArray(v: unknown): v is number[] {
  if (!Array.isArray(v)) return false
  for (let i = 0; i < v.length; i++) if (!Number.isInteger(v[i])) return false
  return true
}

function isSavedLines(v: unknown): v is SavedLines {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  for (const k of Object.keys(v)) if (typeof (v as Record<string, unknown>)[k] !== 'string') return false
  return true
}

/** Inverso de encodeAnchored; descarta entradas inválidas em vez de rebentar */
export function decodeAnchored(raw: unknown): AnchoredStroke[] {
  if (!Array.isArray(raw)) return []
  const out: AnchoredStroke[] = []
  for (const e of raw) {
    if (!Array.isArray(e) || e.length < 8) continue
    const [id, color, w, mode, runs, cs, xs, ys, lines] = e as unknown[]
    if ((typeof id !== 'string' || !id) && !fin(id)) continue
    if (mode !== MODE_TEXT && mode !== MODE_MARGIN && mode !== MODE_MARGIN_ROW) continue
    if (!fin(w) || !intArray(runs) || !intArray(cs) || !intArray(xs) || !intArray(ys)) continue
    const n = cs.length
    if (xs.length !== n || ys.length !== n || runs.length % 3 !== 0) continue
    let total = 0
    let valid = true
    for (let r = 0; r < runs.length; r += 3) {
      if (runs[r] < 0 || runs[r + 1] < 0 || runs[r + 1] > MAX_CODE || runs[r + 2] < 1) valid = false
      total += runs[r + 2]
    }
    if (!valid || total !== n) continue
    const deltaX = mode !== MODE_TEXT
    const p = new Array<number>(n * P_STRIDE)
    let i = 0
    let c = 0
    let x = 0
    let y = 0
    for (let r = 0; r < runs.length; r += 3) {
      const ln = runs[r]
      const code = runs[r + 1]
      for (let m = 0; m < runs[r + 2]; m++, i++) {
        c += cs[i]
        x = deltaX ? x + xs[i] : xs[i]
        y += ys[i]
        const o = i * P_STRIDE
        p[o] = ln
        p[o + 1] = c
        p[o + 2] = x / 1000
        p[o + 3] = code >> 1
        p[o + 4] = y / 1000
        p[o + 5] = code & 1
      }
    }
    const s: AnchoredStroke = {
      id: String(id),
      color: typeof color === 'string' && color ? color : DEFAULT_COLOR,
      w: w / 1000,
      mode,
      p,
    }
    if (isSavedLines(lines)) s.lines = lines
    out.push(s)
  }
  return out
}

/** Traço antigo, em px do Ensaio: o que os clientes antigos (PWA em cache) leem */
export interface LegacyStroke {
  id: string
  pts: number[]
  color: string
  width: number
}

/**
 * Payload em localStorage ('gigio_ann_v1_<songId>') e song_annotations.strokes.
 * {w, h, strokes} continua em px do Ensaio para os clientes antigos; os novos
 * usam `anchored` quando existe.
 */
export interface AnnPayload {
  w: number
  h?: number
  strokes: LegacyStroke[]
  v?: number
  /** em do Ensaio quando o payload foi escrito (px) */
  em?: number
  anchored?: EncodedStroke[]
  lines?: SavedLines
}

export interface ParsedPayload {
  w: number
  h?: number
  strokes: LegacyStroke[]
  em?: number
  /** null = payload antigo, sem âncoras (migrar a partir de `strokes`) */
  anchored: AnchoredStroke[] | null
  /** null = sem registo do texto das linhas */
  lines: SavedLines | null
}

/** Payload v2 completo, pronto para JSON.stringify / upsert */
export function buildPayload(o: {
  w: number
  h: number
  strokes: readonly LegacyStroke[]
  em: number
  anchored: readonly AnchoredStroke[]
  lyrics: string
}): AnnPayload {
  return {
    w: fin(o.w) ? Math.round(o.w * 10) / 10 : 0,
    h: fin(o.h) ? Math.round(o.h * 10) / 10 : 0,
    strokes: o.strokes.slice(),
    v: 2,
    em: fin(o.em) ? r3(o.em) : undefined,
    anchored: encodeAnchored(o.anchored),
    lines: collectLines(o.anchored, o.lyrics),
  }
}

function legacyList(v: unknown): LegacyStroke[] {
  if (!Array.isArray(v)) return []
  const out: LegacyStroke[] = []
  for (const s of v) {
    if (!s || typeof s !== 'object' || !Array.isArray((s as LegacyStroke).pts)) continue
    const o = s as Partial<LegacyStroke>
    out.push({
      id: typeof o.id === 'string' ? o.id : String(o.id ?? newId()),
      pts: (o.pts as unknown[]).map(Number),
      color: typeof o.color === 'string' ? o.color : DEFAULT_COLOR,
      width: fin(o.width) ? o.width : 3,
    })
  }
  return out
}

/** Lê qualquer versão do payload (array antigo, {w,h,strokes}, v2); null se não serve */
export function readPayload(raw: unknown): ParsedPayload | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return { w: 0, strokes: legacyList(raw), anchored: null, lines: null }
  if (typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: ParsedPayload = {
    w: fin(o.w) ? o.w : 0,
    strokes: legacyList(o.strokes),
    anchored: Array.isArray(o.anchored) ? decodeAnchored(o.anchored) : null,
    lines: isSavedLines(o.lines) ? o.lines : null,
  }
  if (fin(o.h)) out.h = o.h
  if (fin(o.em)) out.em = o.em
  return out
}

/** Há alguma coisa para mostrar? (âncoras quando existem, senão os traços antigos) */
export function payloadHasStrokes(p: ParsedPayload | null | undefined): boolean {
  if (!p) return false
  return p.anchored ? p.anchored.length > 0 : p.strokes.length > 0
}

/**
 * Traços resolvidos (no layout do Ensaio) → formato antigo: um traço por
 * caminho, px inteiros. Os escondidos ficam de fora.
 */
export function toLegacyStrokes(resolved: readonly ResolvedStroke[]): LegacyStroke[] {
  const out: LegacyStroke[] = []
  for (const s of resolved) {
    if (s.hidden) continue
    s.subpaths.forEach((sp, k) => {
      out.push({
        id: k ? `${s.id}~${k}` : s.id,
        pts: sp.map(v => Math.round(v)),
        color: s.color,
        width: Math.round(s.width * 10) / 10,
      })
    })
  }
  return out
}

/* ═══ Desenho e borracha ═══ */

const r2 = (v: number) => Math.round(v * 100) / 100

/** Caminho SVG suave (pontos médios + curvas quadráticas) de um traço [x0,y0, x1,y1, ...] */
export function smoothPath(pts: readonly number[]): string {
  const n = Math.floor(pts.length / 2)
  if (n < 1) return ''
  const P = (i: number) => `${r2(pts[i * 2])} ${r2(pts[i * 2 + 1])}`
  // Um ponto só: segmento de comprimento 0 — com stroke-linecap round desenha um ponto
  if (n === 1) return `M ${P(0)} L ${P(0)}`
  if (n === 2) return `M ${P(0)} L ${P(1)}`
  let d = `M ${P(0)}`
  d += ` L ${r2((pts[0] + pts[2]) / 2)} ${r2((pts[1] + pts[3]) / 2)}`
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i * 2] + pts[(i + 1) * 2]) / 2
    const my = (pts[i * 2 + 1] + pts[(i + 1) * 2 + 1]) / 2
    d += ` Q ${P(i)} ${r2(mx)} ${r2(my)}`
  }
  d += ` L ${P(n - 1)}`
  return d
}

/** Vários caminhos num só atributo d */
export function pathFromSubpaths(subpaths: readonly (readonly number[])[]): string {
  let d = ''
  for (const sp of subpaths) {
    const part = smoothPath(sp)
    if (part) d = d ? `${d} ${part}` : part
  }
  return d
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx - px
  const qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/** O círculo (x, y, raio) toca algum dos caminhos (pontos e segmentos entre eles)? */
export function hitSubpaths(subpaths: readonly (readonly number[])[], x: number, y: number, radius: number): boolean {
  if (!fin(x) || !fin(y) || !fin(radius)) return false
  const r2max = radius * radius
  for (const sp of subpaths) {
    const n = Math.floor(sp.length / 2)
    if (n === 1 && segDist2(x, y, sp[0], sp[1], sp[0], sp[1]) <= r2max) return true
    for (let i = 1; i < n; i++) {
      if (segDist2(x, y, sp[i * 2 - 2], sp[i * 2 - 1], sp[i * 2], sp[i * 2 + 1]) <= r2max) return true
    }
  }
  return false
}

/** Borracha: ids dos traços visíveis tocados (raio + meia largura do traço) */
export function strokesAt(resolved: readonly ResolvedStroke[], x: number, y: number, radius: number): string[] {
  const ids: string[] = []
  for (const s of resolved) {
    if (!s.hidden && hitSubpaths(s.subpaths, x, y, radius + s.width / 2)) ids.push(s.id)
  }
  return ids
}

/* ═══ Ajudas para a medição no DOM ═══ */

/**
 * Retângulos de Range.getClientRects de uma linha → rows visuais: tira os
 * vazios (largura/altura 0, ex.: espaço colapsado numa quebra) e junta os
 * que se sobrepõem mais de metade na vertical (a mesma linha de ecrã).
 * Aceita DOMRectList.
 */
export function mergeRowRects(rects: ArrayLike<Box>): Box[] {
  const list: Box[] = []
  for (let i = 0; i < rects.length; i++) {
    const b = rects[i]
    if (okBox(b) && b.right > b.left && b.bottom > b.top) list.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom })
  }
  list.sort((a, b) => a.top - b.top || a.left - b.left)
  const out: Box[] = []
  for (const b of list) {
    const last = out[out.length - 1]
    if (last) {
      const ov = Math.min(last.bottom, b.bottom) - Math.max(last.top, b.top)
      const h = Math.min(last.bottom - last.top, b.bottom - b.top)
      if (ov > h * 0.5) {
        last.left = Math.min(last.left, b.left)
        last.right = Math.max(last.right, b.right)
        last.top = Math.min(last.top, b.top)
        last.bottom = Math.max(last.bottom, b.bottom)
        continue
      }
    }
    out.push(b)
  }
  return out
}

/** Retângulos de um Range de 1 carácter → a sua caixa (o mais largo; null se nenhum) */
export function pickCharRect(rects: ArrayLike<Box>): Box | null {
  let best: Box | null = null
  for (let i = 0; i < rects.length; i++) {
    const b = rects[i]
    if (okBox(b) && (!best || b.right - b.left > best.right - best.left)) best = b
  }
  return best ? { left: best.left, top: best.top, right: best.right, bottom: best.bottom } : null
}
