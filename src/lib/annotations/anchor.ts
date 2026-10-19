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
 *  8. Notas no intervalo (MODE_GAP): um traço que não toca em nenhuma row e
 *     se afasta mais de 0.5em do texto ("x2" entre estrofes, "FIM" depois da
 *     última linha) fica RÍGIDO — X preso a um só carácter, Y à LINHA (como a
 *     margem). Em modo texto, cada ponto seguia a row do seu carácter: com o
 *     verso re-quebrado em 2 rows, o intervalo "por baixo" passava a ser o
 *     intervalo pequeno dentro do verso e a nota achatava-se numa risca entre
 *     as duas metades (opts.noGap mostra-o).
 *  9. Texto: um troço pouco fundo (< 0.35em) DENTRO da row vizinha, de um
 *     traço que pertence à outra (o topo de um círculo largo que entra na
 *     caixa da linha de cima), fica preso à row do traço, em em desde a borda
 *     da vizinha. Preso às letras da vizinha, o arco fugia para o lado quando
 *     essa linha re-quebrava (opts.perRowExcursions mostra-o).
 * 10. Margem empurrada para dentro do bloco (fitToBlock) fica a meia largura
 *     do traço da borda (a tinta não é cortada) e marginGutter diz quanto
 *     espaço lateral o texto deve deixar para não passar por baixo dela.
 * 11. Órfãos só voltam a linhas que não correspondem a nenhuma linha do
 *     retrato guardado (ver rebaseStrokes): senão, no carregamento seguinte,
 *     o traço de um refrão apagado reaparecia no refrão que ficou.
 *
 * Marcador (highlighter)
 *  - Gesto sobre o texto → DESTAQUE DE TEXTO (TextHighlight, MODE_HL_TEXT):
 *    não é um traço, é um intervalo de caracteres de UMA linha, ajustado a
 *    palavras inteiras com a semântica de uma seleção de texto (da 1.ª
 *    palavra tocada à última, em ordem de leitura; um registo por linha).
 *    Desenha-se por trás do texto, um retângulo por row visual: acompanha
 *    qualquer re-quebra sem nada para ancorar (ver resolveHighlight).
 *  - Gesto na margem, sobretudo vertical ou numa folha sem letra → traço
 *    livre de marcador: um AnchoredStroke como os outros (hl = true), largo
 *    (HL_INK_EM) e translúcido, também por trás do texto.
 *  - Destaques na mesma linha nunca se sobrepõem (mergeHighlights): a mesma
 *    cor funde-se, outra cor é recortada.
 *  - Formato: dentro de `anchored`, com modos que a versão anterior (2b52db3)
 *    não conhece (MODE_HL_TEXT, MODE_HL_INK) — ela guarda-os em `extra` e
 *    reescreve-os tal como vieram; nunca os apaga nem os desenha como caneta.
 *    Como ela também não os re-numera quando a letra muda, viajam com o seu
 *    próprio retrato das linhas (MODE_HL_LINES): é contra ele, e não contra
 *    payload.lines, que os itens do marcador passam para a letra atual.
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
  /** Topo do bloco (só para os traços livres, MODE_FREE); sem ele, 0 */
  blockTop?: number
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
  /**
   * A linha é um rótulo de secção ([Refrão] → REFRÃO: texto pequeno, na cor
   * de acento — o marcador por baixo dele é mais leve, ver markerAlpha).
   * Opcional: sem ele, nenhuma é.
   */
  section?(ln: number): boolean
}

/* ═══ Traço ancorado ═══ */

/** Traço de texto: X preso ao carácter */
export const MODE_TEXT = 0
/** Traço de margem (chavetas, setas, notas ao lado): X preso ao eixo do bloco, Y à linha */
export const MODE_MARGIN = 1
/** Margem com Y preso à row do 1.º/último carácter — modelo literal, só para comparação */
export const MODE_MARGIN_ROW = 2
/** Nota no intervalo entre linhas (desvio 8): rígida, X preso a um carácter, Y à linha */
export const MODE_GAP = 3
/**
 * Sem texto onde ancorar ("Sem letra"): px desde o canto do bloco, em
 * centésimas da largura dele — a folha em branco escala com a largura
 */
export const MODE_FREE = 4
export type StrokeMode =
  | typeof MODE_TEXT | typeof MODE_MARGIN | typeof MODE_MARGIN_ROW | typeof MODE_GAP | typeof MODE_FREE
const KNOWN_MODES: readonly number[] = [MODE_TEXT, MODE_MARGIN, MODE_MARGIN_ROW, MODE_GAP, MODE_FREE]
/** Destaque de texto do marcador: intervalo de caracteres de uma linha (TextHighlight) */
export const MODE_HL_TEXT = 5
/**
 * Traço livre de marcador — só no formato guardado: em memória é um
 * AnchoredStroke com hl = true e o modo de ancoragem (texto, margem…)
 */
export const MODE_HL_INK = 6
/**
 * Retrato das linhas a que os itens do marcador estão numerados — só no
 * formato guardado, uma entrada por payload (ver buildPayload). A versão
 * anterior (2b52db3) re-numera os SEUS traços e reescreve payload.lines com
 * a letra nova, mas devolve as entradas do marcador tal como vieram (com a
 * numeração antiga): só um retrato que viaja com elas, em `anchored`, diz a
 * que letra essa numeração se refere.
 */
export const MODE_HL_LINES = 7
/** Id da entrada do retrato (fixo: as cópias juntam-se por id sem a repetir) */
const HL_LINES_ID = 'marcador-linhas'

/* ═══ Marcador ═══ */

/** Largura do traço livre de marcador (em do layout onde se desenha) */
export const HL_INK_EM = 0.9
/** Toque curto: extensão do gesto abaixo disto (em) destaca a palavra tocada */
const HL_TAP_EM = 0.3
/** Gesto sobretudo vertical (altura > isto × largura) → traço livre */
const HL_VERTICAL = 1.5
/** Um ponto conta como "em cima do texto" até esta distância (em) da row, na vertical… */
const HL_NEAR_Y_EM = 0.5
/** …e para lá das pontas da row, na horizontal */
const HL_NEAR_X_EM = 0.5
/** Folga do retângulo de um destaque à volta dos caracteres (em) */
const HL_PAD_X_EM = 0.08
const HL_PAD_Y_EM = 0.04
/** Opacidade dos destaques na cópia antiga em px (os clientes muito antigos desenham-na por cima do texto) */
export const HL_LEGACY_ALPHA = 0.4
/** Teto da opacidade do marcador sobre um fundo claro / escuro (ver markerOpacity, markerAlpha) */
export const HL_OPACITY_LIGHT = 0.42
export const HL_OPACITY_DARK = 0.52
/** Contraste mínimo do texto por cima do marcador (DESIGN-v2) */
export const HL_MIN_CONTRAST = 4.5
/** Texto grande (WCAG: ≥ 24px): o marcador não fica mais fraco do que isto… */
export const HL_MIN_ALPHA_LARGE = 0.25
/** …desde que o texto mantenha este contraste */
const HL_MIN_CONTRAST_LARGE = 3
const HL_LARGE_TEXT_PX = 24

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
/** Nota no intervalo: algum ponto a mais do que isto (em) da row mais próxima */
const GAP_NOTE_EM = 0.5
/** Desvio 9: fundura máxima (em) de um troço dentro da row vizinha que continua preso à sua */
const EXCURSION_EM = 0.35
/** Folga (em) entre o texto e uma chaveta empurrada para dentro do bloco */
const GUTTER_CLEAR_EM = 0.25
/** A calha lateral nunca passa desta fração da largura do bloco (de cada lado) */
const GUTTER_MAX_FRAC = 0.2
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
   * Nota no intervalo (MODE_GAP): o mesmo (ln, c) em todos os pontos, x em em
   * desde o left desse carácter, Y relativo à linha (como a margem).
   * Livre (MODE_FREE): ln = c = 0, x e yv em centésimas da largura do bloco
   * desde o canto dele, yk = Y_IN.
   * x e yv vêm arredondados a 3 casas: o que se grava é o que se desenha.
   */
  p: number[]
  /** Traço livre de marcador: desenha-se translúcido, por trás do texto (só existe quando true) */
  hl?: boolean
  /**
   * Só nos traços órfãos (a maioria das suas linhas desapareceu da letra):
   * o texto dessas linhas, para o traço voltar se a letra voltar. Um órfão
   * fica escondido mas nunca é apagado do payload.
   */
  lines?: SavedLines
}

/**
 * Destaque de texto do marcador: o intervalo [c0, c1) de uma linha, já em
 * palavras inteiras. Um gesto que atravessa várias linhas dá um por linha.
 */
export interface TextHighlight {
  id: string
  color: string
  mode: typeof MODE_HL_TEXT
  ln: number
  /** Início, a contar do 1.º carácter não branco da linha (como c nos traços) */
  c0: number
  /** Fim (exclusivo), na mesma contagem */
  c1: number
  /** O texto destacado: para o reencontrar depois de a linha ser editada */
  t: string
  /**
   * Só nos órfãos (o texto já não está na letra): o texto da linha quando
   * foi destacada. Escondido, nunca apagado; volta se a linha voltar.
   */
  lines?: SavedLines
}

/** O que a lista de anotações guarda: traços (caneta e marcador livre) e destaques de texto */
export type AnnItem = AnchoredStroke | TextHighlight

export interface ResolvedStroke {
  id: string
  color: string
  /** Largura em px no layout de destino (≥ MIN_WIDTH_PX) */
  width: number
  /** Caminhos [x0,y0, x1,y1, ...] em px; vários quando a re-quebra parte o traço */
  subpaths: number[][]
  /** true = não se desenha (órfão, ou a maioria dos pontos ficou sem linha) */
  hidden: boolean
  /**
   * Margem que fitToBlock teve de empurrar para dentro do bloco: 1 = vinha
   * de fora pela esquerda, -1 = pela direita, 0 = cabia (ver marginGutter)
   */
  edge: number
  /** Traço livre de marcador (por trás do texto, translúcido) */
  hl?: boolean
}

export interface ResolvedHighlight {
  id: string
  color: string
  /** Um retângulo por row visual do intervalo (px), de cima para baixo */
  rects: Box[]
  /** true = não se desenha (órfão, texto que já não está na linha, sem caixas) */
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
  /** Topo do bloco (traços livres) */
  top: number
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
  hlMemo: WeakMap<object, WeakMap<TextHighlight, ResolvedHighlight>>
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
  const top = fin(L.blockTop) ? L.blockTop : 0
  return {
    L, em, centerX, minX, maxX, top, rows, lineRows, rowIdx, bands, bandIdx,
    leads: new Map(), rowChars: new Map(), words: new Map(), hits: new Map(), memo: new WeakMap(),
    hlMemo: new WeakMap(),
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
  // Negativo = para lá da borda da vizinha, dentro dela (desvio 9)
  if (d >= gap - n) return [below ? Y_BELOW_FAR : Y_ABOVE_FAR, (gap - d) / em]
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
  // acima da row seguinte mesmo com a entrelinha mais apertada). Junto à
  // vizinha, yv < 0 entra nela (desvio 9) — tanto quanto entrava na origem
  if (zone === 0) return edge + dir * Math.min(yv * em, gap / 2)
  if (zone === 2) return edge + dir * (gap - Math.min(yv * em, gap / 2))
  const n = Math.min(GAP_EDGE_EM * em, gap / 2)
  return edge + dir * (n + yv * (gap - 2 * n))
}

/**
 * Desvio 9 (ver textRefRows): troços dentro de uma row A que entram e saem
 * pelo lado da vizinha B (A ± 1 na sequência), num traço com mais pontos
 * dentro de B do que de A, e a menos de EXCURSION_EM da borda de A do lado de
 * B, passam a contar como pontos do intervalo entre as duas.
 */
function markExcursions(ix: Index, ys: readonly number[], inRow: number[], gapOf: number[]): void {
  const rows = ix.rows
  const n = ys.length
  const count = new Map<number, number>()
  for (const k of inRow) if (k >= 0) count.set(k, (count.get(k) ?? 0) + 1)
  if (count.size < 2) return
  const limit = EXCURSION_EM * ix.em
  const runs: number[][] = []   // [início, fim, A, B]
  let i = 0
  while (i < n) {
    const A = inRow[i]
    if (A < 0) {
      i++
      continue
    }
    let e = i
    while (e + 1 < n && inRow[e + 1] === A) e++
    // Row onde o traço está antes e depois deste troço (saltando o intervalo)
    let prev = -1
    for (let j = i - 1; j >= 0 && prev < 0; j--) prev = inRow[j]
    let next = -1
    for (let j = e + 1; j < n && next < 0; j++) next = inRow[j]
    const B = prev >= 0 ? prev : next
    if (B >= 0 && Math.abs(B - A) === 1 && (prev < 0 || prev === B) && (next < 0 || next === B) &&
      (count.get(B) ?? 0) > (count.get(A) ?? 0)) {
      let depth = 0
      for (let j = i; j <= e; j++) depth = Math.max(depth, B > A ? rows[A].bottom - ys[j] : ys[j] - rows[A].top)
      if (depth < limit) runs.push([i, e, A, B])
    }
    i = e + 1
  }
  for (const [s, e, A, B] of runs) {
    for (let j = s; j <= e; j++) {
      inRow[j] = -1
      // O intervalo entre A e B: o índice da row de baixo
      gapOf[j] = Math.max(A, B)
    }
  }
}

/**
 * Row de referência dos pontos de um traço de TEXTO. Dentro de uma row →
 * essa. No intervalo entre duas rows, por troços seguidos no mesmo
 * intervalo: o troço que entra/sai de uma só das duas rows fica preso a
 * ela (o topo de um círculo pertence à palavra que rodeia, não à linha de
 * cima); entre as duas (seta de uma linha para a outra) → ponto a ponto a
 * mais próxima; solto (sublinhado todo no intervalo) → todo na mais
 * próxima da mediana. Empates → a de cima.
 * Desvio 9: um troço pouco fundo dentro de uma row A, entre pontos presos à
 * row vizinha B (a que tem mais pontos do traço), conta como intervalo — o
 * topo de um círculo largo que entra na caixa da linha de cima é da palavra
 * que rodeia.
 */
function textRefRows(ix: Index, ys: readonly number[], perPoint: boolean, excursions = true): number[] {
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
  if (excursions) markExcursions(ix, ys, inRow, gapOf)
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
 * ponto a ponto (sem troços); anchorSpaces — espaços como âncora, como as
 * letras; noGap — notas no intervalo em modo texto (sem o desvio 8);
 * perRowExcursions — sem o desvio 9
 */
export interface AnchorOptions {
  marginRows?: boolean
  perPointRows?: boolean
  anchorSpaces?: boolean
  noGap?: boolean
  perRowExcursions?: boolean
}

/**
 * Desvio 8: o traço não toca em nenhuma row (todos os pontos no intervalo,
 * antes da 1.ª ou depois da última) e algum ponto fica a mais de
 * GAP_NOTE_EM da row mais próxima — uma nota, não um sublinhado.
 */
function isGapNote(ix: Index, ys: readonly number[]): boolean {
  const far = GAP_NOTE_EM * ix.em
  let farthest = 0
  for (const y of ys) {
    let d = Infinity
    for (const r of ix.rows) {
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
      if (dy < d) d = dy
      if (d === 0) return false
    }
    if (d > farthest) farthest = d
  }
  return farthest > far
}

/** Mediana de uma lista de números (cópia ordenada) */
function median(v: readonly number[]): number {
  const s = v.slice().sort((a, b) => a - b)
  return s[(s.length - 1) >> 1]
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
  let ref = textRefRows(ix, ys, !!opts?.perPointRows, !opts?.perRowExcursions)
  let inside = 0
  const slack = TEXT_SLACK_EM * em
  for (let i = 0; i < n; i++) {
    const r = ix.rows[ref[i]]
    if (xs[i] >= r.left - slack && xs[i] <= r.right + slack) inside++
  }
  const mode: StrokeMode = inside * 2 >= n ? MODE_TEXT : opts?.marginRows ? MODE_MARGIN_ROW : MODE_MARGIN
  // Margem presa à row (modelo literal): a row mais próxima, ponto a ponto
  if (mode === MODE_MARGIN_ROW) ref = textRefRows(ix, ys, true)
  // Nota no intervalo (desvio 8): rígida, presa a um carácter e à linha
  if (mode === MODE_TEXT && !opts?.noGap && isGapNote(ix, ys)) {
    return anchorGap(xs, ys, color, widthPx, ix, id)
  }

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
  return strokeOf(id, color, (fin(widthPx) && widthPx > 0 ? widthPx : MIN_WIDTH_PX) / em, mode, p)
}

function strokeOf(id: string | undefined, color: string, w: number, mode: StrokeMode, p: number[]): AnchoredStroke {
  return {
    id: typeof id === 'string' && id ? id : newId(),
    color: typeof color === 'string' && color ? color : DEFAULT_COLOR,
    w: r3(fin(w) && w > 0 ? w : 0),
    mode,
    p,
  }
}

/**
 * Nota no intervalo (desvio 8): todos os pontos presos à LINHA mais próxima
 * da mediana (Y como na margem: em/frações desde a borda dela e até à
 * vizinha) e a UM carácter dela — o mais perto do meio da nota, na row
 * virada para a nota (a última se está por baixo, a 1.ª se está por cima).
 * Noutro layout a nota acompanha esse carácter e fica toda do mesmo lado da
 * linha, mesmo que ela re-quebre.
 */
function anchorGap(
  xs: readonly number[], ys: readonly number[], color: string, widthPx: number, ix: Index, id?: string,
): AnchoredStroke {
  const em = ix.em
  const my = median(ys)
  const k = nearest(ix.bands, my)
  const band = ix.bands[k]
  const ln = band.ln
  const perRow = charsOf(ix, ln)
  const rs = ix.lineRows.get(ln) ?? []
  const ri = my > band.bottom ? rs.length - 1 : my < band.top ? 0 : Math.max(0, nearest(rs, my))
  let lo = Infinity
  let hi = -Infinity
  for (const x of xs) {
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  const ch = nearestChar(perRow[ri] ?? [], (lo + hi) / 2)
  const c = ch ? ch.c : 0
  const left = ch ? ch.left : rs[ri] ? rs[ri].left : ix.centerX
  const cRel = c - leadOf(ix, ln)
  const p: number[] = []
  for (let i = 0; i < xs.length; i++) {
    const [yk, yv] = encodeY(ys[i], ix.bands, k, em)
    p.push(ln, cRel, r3((xs[i] - left) / em), yk, r3(yv), i > 0 ? 1 : 0)
  }
  return strokeOf(id, color, (fin(widthPx) && widthPx > 0 ? widthPx : MIN_WIDTH_PX) / em, MODE_GAP, p)
}

function blockUnit(ix: Index): number {
  const W = ix.maxX - ix.minX
  return isFinite(W) && W > 0 ? W / 100 : NaN
}

/**
 * Traço numa folha sem texto ("Sem letra", MODE_FREE): px desde o canto do
 * bloco, em centésimas da largura dele — como os traços antigos, escala com
 * a largura (sem deformar). null sem largura de bloco ou sem pontos válidos.
 */
export function anchorFree(
  ptsPx: readonly number[],
  color: string,
  widthPx: number,
  layout: LayoutModel,
  id?: string,
): AnchoredStroke | null {
  const ix = indexOf(layout)
  const u = blockUnit(ix)
  if (!fin(u) || !ptsPx) return null
  const p: number[] = []
  for (let i = 0; i + 1 < ptsPx.length; i += 2) {
    const x = ptsPx[i]
    const y = ptsPx[i + 1]
    if (fin(x) && fin(y)) p.push(0, 0, r3((x - ix.minX) / u), Y_IN, r3((y - ix.top) / u), p.length ? 1 : 0)
  }
  if (!p.length) return null
  return strokeOf(id, color, (fin(widthPx) && widthPx > 0 ? widthPx : MIN_WIDTH_PX) / u, MODE_FREE, p)
}

/**
 * Traços antigos (px do Ensaio, sem âncoras): adotar como antes — re-escalar
 * de (w, h) guardados para o bloco atual (sem h, Y segue o rácio de X) — e
 * ancorar contra o layout atual. Sem texto onde ancorar ("Sem letra") ficam
 * livres (MODE_FREE), escalados só pela largura: a altura guardada era a do
 * aviso "Sem letra", não a da folha.
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
  const empty = isLayoutEmpty(layout)
  const w = saved?.w ?? 0
  const h = saved?.h ?? 0
  const kx = fin(w) && w > 0 && fin(blockW) && blockW > 0 ? blockW / w : 1
  const ky = !empty && fin(h) && h > 0 && fin(blockH) && blockH > 0 ? blockH / h : kx
  const out: AnchoredStroke[] = []
  for (const s of strokes) {
    if (!s || !Array.isArray(s.pts)) continue
    const pts = s.pts.map((v, i) => v * (i % 2 === 0 ? kx : ky))
    const width = (fin(s.width) ? s.width : MIN_WIDTH_PX) * kx
    const a = empty ? anchorFree(pts, s.color, width, layout, s.id) : anchorStroke(pts, s.color, width, layout, s.id)
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

/** resolveStroke dos traços de uma lista (caneta e marcador livre; os destaques de texto ficam de fora) */
export function resolveAll(
  strokes: readonly AnnItem[],
  layout: LayoutModel,
  lineMap?: LineMap | null,
): ResolvedStroke[] {
  const out: ResolvedStroke[] = []
  for (const s of strokes) if (!isTextHighlight(s)) out.push(resolveStroke(s, layout, lineMap))
  return out
}

function computeStroke(a: AnchoredStroke, ix: Index, lineMap: LineMap | null): ResolvedStroke {
  const em = ix.em
  const free = a.mode === MODE_FREE
  const unit = free ? blockUnit(ix) : em
  const w = fin(a.w) && a.w > 0 && fin(unit) ? a.w * unit : 0
  const out: ResolvedStroke = {
    id: a.id,
    color: a.color,
    width: Math.max(MIN_WIDTH_PX, w),
    subpaths: [],
    hidden: false,
    edge: 0,
  }
  if (a.hl) out.hl = true
  const p = Array.isArray(a.p) ? a.p : []
  const n = Math.floor(p.length / P_STRIDE)
  // Folha sem texto: px do bloco em centésimas da largura (não precisa de linhas)
  if (free) {
    const sp: number[] = []
    for (let i = 0; i < n && fin(unit); i++) {
      const x = ix.minX + p[i * P_STRIDE + 2] * unit
      const y = ix.top + p[i * P_STRIDE + 4] * unit
      if (fin(x) && fin(y)) sp.push(x, y)
    }
    if (sp.length) out.subpaths.push(sp)
    out.hidden = a.lines !== undefined || !sp.length
    if (out.hidden) out.subpaths = []
    return out
  }
  // Órfão: as suas linhas já não existem na letra (ver rebaseStrokes)
  if (a.lines || !n || !ix.rows.length) {
    out.hidden = true
    return out
  }
  if (a.mode === MODE_GAP) return computeGap(a, ix, lineMap, out)
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
  if (!textMode) {
    const moved = fitToBlock(out.subpaths, ix, out.width / 2)
    if (a.mode === MODE_MARGIN) out.edge = moved
  }
  out.hidden = out.subpaths.length === 0
  return out
}

/** Nota no intervalo (desvio 8): o carácter dá o X, a linha dá o Y; nunca se parte */
function computeGap(a: AnchoredStroke, ix: Index, lineMap: LineMap | null, out: ResolvedStroke): ResolvedStroke {
  const em = ix.em
  const p = a.p
  const n = Math.floor(p.length / P_STRIDE)
  const sp: number[] = []
  let lost = 0
  for (let i = 0; i < n; i++) {
    const o = i * P_STRIDE
    const ln = lineMap ? lineMap.get(p[o]) : p[o]
    const k = ln !== undefined && fin(ln) ? ix.bandIdx.get(ln) : undefined
    const ch = k !== undefined ? resolveChar(ix, ln as number, p[o + 1]) : null
    const x = ch ? ch.left + p[o + 2] * em : NaN
    const y = k !== undefined ? decodeY(p[o + 3], p[o + 4], ix.bands, k, em) : NaN
    if (fin(x) && fin(y)) sp.push(x, y)
    else lost++
  }
  if (lost * 2 <= n && sp.length) {
    out.subpaths.push(sp)
    fitToBlock(out.subpaths, ix, out.width / 2)
  }
  out.hidden = out.subpaths.length === 0
  return out
}

/**
 * Margem: o traço tem de caber no bloco (o concerto corta o que sai). Desloca
 * o traço INTEIRO para dentro — uma chaveta ou uma nota escrita à mão mantém
 * a forma; só se for mais largo do que o bloco é que cada ponto é limitado.
 * O que sai fica a meia largura do traço da borda (a tinta não é cortada);
 * o que cabe não mexe (no layout onde se desenhou, fica onde se desenhou).
 * Devolve 1 se veio de fora pela esquerda, -1 pela direita, 0 se cabia.
 */
function fitToBlock(subpaths: number[][], ix: Index, half: number): number {
  let lo = Infinity
  let hi = -Infinity
  for (const sp of subpaths) {
    for (let i = 0; i < sp.length; i += 2) {
      if (sp[i] < lo) lo = sp[i]
      if (sp[i] > hi) hi = sp[i]
    }
  }
  if (!(lo < ix.minX || hi > ix.maxX)) return 0
  let minX = ix.minX + half
  let maxX = ix.maxX - half
  if (!(minX <= maxX)) {
    minX = ix.minX
    maxX = ix.maxX
  }
  const fits = hi - lo <= maxX - minX
  const fromLeft = lo < minX
  const shift = fromLeft ? minX - lo : maxX - hi
  for (const sp of subpaths) {
    for (let i = 0; i < sp.length; i += 2) {
      sp[i] = fits ? sp[i] + shift : Math.min(maxX, Math.max(minX, sp[i]))
    }
  }
  return fromLeft ? 1 : -1
}

/**
 * Calha lateral (px, de cada lado) que o texto deve deixar para não passar
 * por baixo das chavetas/notas de margem que fitToBlock teve de empurrar
 * para dentro do bloco (desvio 10). Só depende do X dessas margens — que
 * não muda com a calha (o bloco e o seu centro ficam iguais) —, por isso
 * aplicá-la e voltar a medir dá o mesmo valor: não há ciclo.
 * Uma margem que cabia no bloco nunca toca nas suas linhas (o texto não fica
 * mais largo, em em, do que na origem): não pede calha.
 */
export function marginGutter(resolved: readonly ResolvedStroke[], layout: LayoutModel): number {
  const ix = indexOf(layout)
  const W = ix.maxX - ix.minX
  if (!isFinite(W) || W <= 0) return 0
  let g = 0
  for (const s of resolved) {
    if (s.hidden || !s.edge) continue
    let lo = Infinity
    let hi = -Infinity
    for (const sp of s.subpaths) {
      for (let i = 0; i < sp.length; i += 2) {
        if (sp[i] < lo) lo = sp[i]
        if (sp[i] > hi) hi = sp[i]
      }
    }
    if (!isFinite(lo)) continue
    const reach = s.edge > 0 ? hi - ix.minX : ix.maxX - lo
    g = Math.max(g, reach + s.width / 2 + GUTTER_CLEAR_EM * ix.em)
  }
  return Math.round(Math.min(g, W * GUTTER_MAX_FRAC))
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
 * `exclude`: linhas atuais que já têm dono (não podem receber nenhuma).
 */
export function remapLines(
  saved: SavedLines | ReadonlyMap<number, string> | null | undefined,
  lyrics: string | null | undefined,
  exclude?: ReadonlySet<number> | null,
): Map<number, number> {
  const out = new Map<number, number>()
  const entries = savedEntries(saved).sort((a, b) => a[0] - b[0])
  if (!entries.length) return out
  const cur = String(lyrics ?? '').split('\n').map(l => l.trim())
  // Linha vazia nunca corresponde a nenhuma guardada (as guardadas não são vazias)
  if (exclude) exclude.forEach(j => { if (j >= 0 && j < cur.length) cur[j] = '' })
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
 * for editada. Também só com órfãos: é o retrato que diz a que linhas um
 * órfão NÃO pode voltar (desvio 11). Sem traços nem destaques presos à letra
 * não há nada a guardar.
 */
export function collectLines(strokes: readonly AnnItem[], lyrics: string | null | undefined): SavedLines {
  const out: SavedLines = {}
  if (!strokes.some(s => isTextHighlight(s) || (s.mode !== MODE_FREE && s.p.length >= P_STRIDE))) return out
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
 * com o texto das suas linhas) e volta se essas linhas voltarem — só para
 * linhas NOVAS em relação ao retrato (desvio 11): uma linha atual que
 * corresponde a uma do retrato já é de outro sítio da letra (ex.: o refrão
 * que ficou quando o outro foi apagado).
 * Os traços livres (MODE_FREE) não dependem da letra: ficam como estão.
 * Os destaques de texto seguem o mesmo mapa de linhas (ver rebaseHighlight).
 * `hlSaved`: o retrato a que os itens do MARCADOR (destaques e traços
 * livres de marcador) estão numerados (payload.hlLines — ver MODE_HL_LINES);
 * sem ele, o mesmo dos traços da caneta (`saved`).
 * `changed` = false devolve os mesmos objetos (os caches continuam válidos).
 */
export function rebaseStrokes(
  strokes: readonly AnnItem[],
  saved: SavedLines | null | undefined,
  lyrics: string | null | undefined,
  hlSaved?: SavedLines | null,
): { strokes: AnnItem[]; changed: boolean } {
  const shared = saved ? remapLines(saved, lyrics) : null
  // Marcador: o seu retrato (quando é outro, a versão anterior re-numerou a caneta sem ele)
  const mSaved = hlSaved ?? saved ?? null
  const mShared = mSaved === (saved ?? null) ? shared : mSaved ? remapLines(mSaved, lyrics) : null
  let taken: Set<number> | null = null
  let mTaken: Set<number> | null = null
  let hlCtx: HlRebase | null = null
  let changed = false
  const out = strokes.map((s): AnnItem => {
    if (isTextHighlight(s)) {
      if (!hlCtx) hlCtx = hlRebaseContext(mSaved, mShared, lyrics)
      const h = rebaseHighlight(s, hlCtx)
      if (h !== s) changed = true
      return h
    }
    if (s.mode === MODE_FREE) return s
    const sv = s.hl ? mSaved : saved ?? null
    const sh = s.hl ? mShared : shared
    if (s.lines && sh) {
      if (s.hl && !mTaken) mTaken = new Set(sh.values())
      if (!s.hl && !taken) taken = new Set(sh.values())
    }
    const map = s.lines ? remapLines(s.lines, lyrics, s.hl ? mTaken : taken) : sh
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
      return { ...s, lines: pickLines(s, sv ?? {}) }
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
    if (s.hl) next.hl = true
    return next
  })
  return { strokes: out, changed }
}

/* ═══ Marcador: destaques de texto ═══ */

const WS = /\s/

/** Destaque de texto (e não um traço)? */
export function isTextHighlight(s: AnnItem | null | undefined): s is TextHighlight {
  return !!s && s.mode === MODE_HL_TEXT
}

/** Brancos no início de um texto (o mesmo critério de leadOf) */
function leadLen(t: string): number {
  return t.length - t.replace(/^\s+/, '').length
}

/** Pontos [x0,y0, x1,y1, ...] → coordenadas finitas */
function validPoints(ptsPx: readonly number[] | null | undefined): { xs: number[]; ys: number[] } {
  const xs: number[] = []
  const ys: number[] = []
  if (!ptsPx) return { xs, ys }
  for (let i = 0; i + 1 < ptsPx.length; i += 2) {
    if (fin(ptsPx[i]) && fin(ptsPx[i + 1])) {
      xs.push(ptsPx[i])
      ys.push(ptsPx[i + 1])
    }
  }
  return { xs, ys }
}

/**
 * Carácter tocado por um ponto do marcador: a row mais próxima na vertical
 * (até HL_NEAR_Y_EM dela), dentro da sua extensão (± HL_NEAR_X_EM), e aí a
 * letra debaixo do ponto ou, entre palavras, a mais próxima. null = fora do
 * texto (margem, intervalo entre estrofes).
 */
function pointChar(ix: Index, x: number, y: number): { ln: number; c: number; g: number; inside: boolean } | null {
  const k = nearest(ix.rows, y)
  if (k < 0) return null
  const r = ix.rows[k]
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
  if (dy > HL_NEAR_Y_EM * ix.em) return null
  const slack = HL_NEAR_X_EM * ix.em
  if (x < r.left - slack || x > r.right + slack) return null
  const list = charsOf(ix, r.ln)[r.ri] ?? []
  const ch = letterAt(list, x) ?? nearestChar(list, x)
  return ch ? { ln: r.ln, c: ch.c, g: k, inside: dy === 0 } : null
}

/**
 * O que um gesto do marcador faz (pontos em px do layout de origem):
 *  'text' — destaque de texto (a maioria dos pontos em cima do texto, ou
 *           um toque curto em cima de uma palavra)
 *  'ink'  — traço livre (na margem, sobretudo vertical, folha sem letra)
 *  null   — nada (sem pontos, toque fora do texto)
 */
export function classifyHighlight(ptsPx: readonly number[], layout: LayoutModel): 'text' | 'ink' | null {
  const ix = indexOf(layout)
  const { xs, ys } = validPoints(ptsPx)
  const n = xs.length
  if (!n) return null
  if (!ix.rows.length) return n > 1 ? 'ink' : null
  let l = Infinity
  let r = -Infinity
  let t = Infinity
  let b = -Infinity
  let on = 0
  for (let i = 0; i < n; i++) {
    if (xs[i] < l) l = xs[i]
    if (xs[i] > r) r = xs[i]
    if (ys[i] < t) t = ys[i]
    if (ys[i] > b) b = ys[i]
    if (pointChar(ix, xs[i], ys[i])) on++
  }
  const w = r - l
  const h = b - t
  if (Math.max(w, h) < HL_TAP_EM * ix.em) return on ? 'text' : null
  if (h > HL_VERTICAL * w) return 'ink'
  return on * 2 >= n ? 'text' : 'ink'
}

/**
 * Varrimento de uma row: pelo menos isto (em) de deslocação horizontal…
 * (uma palavra curta varrida para trás não chega: confunde-se com o começo
 * de uma diagonal)
 */
const HL_SWEEP_EM = 3
/**
 * …num troço seguido cujo Y não varia mais do que isto (em). Uma diagonal
 * de declive s só anda s × isto dentro de uma faixa assim: até s ≈ 7 (uma
 * linha abaixo e 11em para o lado) não passa por varrimento
 */
const HL_SWEEP_BAND_EM = 0.4

interface HlHit {
  ln: number
  c: number
  /** Índice global da row */
  g: number
  x: number
  y: number
  /** Dentro da caixa do texto da row (não só na folga à volta) */
  inside: boolean
}

/**
 * Destaques de texto de um gesto, com a semântica de uma seleção de texto:
 * da 1.ª palavra tocada à última, postas em ordem de leitura (um arrasto ao
 * contrário dá o mesmo). Várias linhas: a 1.ª da palavra até ao fim da
 * linha, as do meio inteiras, a última do início até ao fim da palavra.
 * Um registo por linha (rótulos de secção incluídos), c0/c1 a contar do 1.º
 * carácter não branco. [] se nenhum ponto toca no texto.
 *  - Numa row só: de ponta a ponta de TUDO o que o gesto tocou nela (o
 *    vai-e-vem do marca-texto por cima de uma frase).
 *  - Em várias rows (de várias linhas, ou de uma linha re-quebrada): a 1.ª
 *    e a última palavra são as dos pontos onde o gesto começou e acabou
 *    (como a âncora e o foco de uma seleção) — com o mínimo/máximo de tudo
 *    o que foi tocado, a diagonal de uma row para a outra apanhava as
 *    palavras por onde passava (à esquerda do início na 1.ª, à direita do
 *    fim na última). MAS a 1.ª e a última row (em ordem de leitura) vão
 *    também até onde o gesto as VARREU (troço na mesma row, sobretudo na
 *    horizontal — ver HL_SWEEP_*): pintar uma linha para a direita e a
 *    seguinte de volta para a esquerda (em "U") destaca as duas inteiras;
 *    começar a meio, voltar ao início da linha e descer também. Uma row
 *    extrema onde o gesto não começou nem acabou (zigue-zague que volta à
 *    row de partida) conta com tudo o que tocou nela.
 *  - Rows tocadas só na folga (um desvio do traço para baixo da linha, sem
 *    entrar na caixa do texto da vizinha) não contam, exceto a do início e a
 *    do fim.
 * `id`: ids previsíveis (id, id-1, id-2…), para os testes.
 */
export function highlightRange(
  ptsPx: readonly number[],
  color: string,
  layout: LayoutModel,
  id?: string,
): TextHighlight[] {
  const ix = indexOf(layout)
  const { xs, ys } = validPoints(ptsPx)
  const all: HlHit[] = []
  for (let i = 0; i < xs.length; i++) {
    const h = pointChar(ix, xs[i], ys[i])
    if (h) all.push({ ...h, x: xs[i], y: ys[i] })
  }
  if (!all.length) return []
  const first = all[0]
  const last = all[all.length - 1]
  const counted = new Set<number>([first.g, last.g])
  for (const h of all) if (h.inside) counted.add(h.g)
  const hits = all.filter(h => counted.has(h.g))
  let gMin = Infinity
  let gMax = -Infinity
  for (const h of hits) {
    if (h.g < gMin) gMin = h.g
    if (h.g > gMax) gMax = h.g
  }
  const sLn = ix.rows[gMin].ln
  const eLn = ix.rows[gMax].ln
  let sC: number
  let eC: number
  if (gMin === gMax) {
    // Uma row: tudo o que tocou nela
    sC = eC = first.c
    for (const h of hits) {
      if (h.c < sC) sC = h.c
      if (h.c > eC) eC = h.c
    }
  } else {
    sC = rowEnd(hits, gMin, first, last, ix.em, true)
    eC = rowEnd(hits, gMax, first, last, ix.em, false)
    // A mesma linha em várias rows (re-quebrada): a ordem de leitura é a dos caracteres
    if (sLn === eLn && sC > eC) {
      const t = sC
      sC = eC
      eC = t
    }
  }
  // Palavras inteiras: recua até ao início da 1.ª, avança até ao fim da última
  const st = textOf(ix.L, sLn)
  let a = sC
  while (a > 0 && !WS.test(st[a - 1])) a--
  const et = textOf(ix.L, eLn)
  let b = eC + 1
  while (b < et.length && !WS.test(et[b])) b++
  const lns: number[] = []
  ix.lineRows.forEach((_, ln) => { if (ln >= sLn && ln <= eLn) lns.push(ln) })
  lns.sort((p, q) => p - q)
  const out: TextHighlight[] = []
  for (const ln of lns) {
    const t = textOf(ix.L, ln)
    const lead = leadOf(ix, ln)
    const from = ln === sLn ? a : lead
    const to = ln === eLn ? b : t.replace(/\s+$/, '').length
    if (to <= from) continue
    const k = out.length
    out.push({
      id: id ? (k ? `${id}-${k}` : id) : newId(),
      color: typeof color === 'string' && color ? color : DEFAULT_COLOR,
      mode: MODE_HL_TEXT,
      ln,
      c0: from - lead,
      c1: to - lead,
      t: t.slice(from, to),
    })
  }
  return out
}

/**
 * Ponta de um destaque de várias rows numa row extrema `g` (`start`: a 1.ª
 * em ordem de leitura → o carácter mais à esquerda; senão o mais à direita).
 * O do ponto onde o gesto começou/acabou nessa row e, para lá dele, até onde
 * um troço a varreu na horizontal (ver sweptX: a diagonal que só passa por
 * ela não conta). Se o gesto não começou nem acabou nela: tudo o que tocou.
 */
function rowEnd(hits: readonly HlHit[], g: number, first: HlHit, last: HlHit, em: number, start: boolean): number {
  const pick = (a: number, b: number) => (start ? Math.min(a, b) : Math.max(a, b))
  let c = NaN
  if (first.g === g) c = first.c
  if (last.g === g) c = isNaN(c) ? last.c : pick(c, last.c)
  if (isNaN(c)) {
    for (const h of hits) if (h.g === g) c = isNaN(c) ? h.c : pick(c, h.c)
    return c
  }
  let i = 0
  while (i < hits.length) {
    if (hits[i].g !== g) {
      i++
      continue
    }
    // Troço: pontos seguidos nesta row
    let cc = hits[i].c
    let j = i
    for (; j < hits.length && hits[j].g === g; j++) cc = pick(cc, hits[j].c)
    if (sweptX(hits, i, j, HL_SWEEP_BAND_EM * em) >= HL_SWEEP_EM * em) c = pick(c, cc)
    i = j
  }
  return c
}

/**
 * Maior deslocação horizontal (extensão em X) de um troço seguido de
 * hits[i..j) cujo Y fica dentro de uma faixa de `band` px — o varrimento de
 * uma linha (Y quase constante), e não a passagem de uma diagonal.
 */
function sweptX(hits: readonly HlHit[], i: number, j: number, band: number): number {
  let best = 0
  for (let a = i; a < j; a++) {
    let x0 = hits[a].x
    let x1 = x0
    let y0 = hits[a].y
    let y1 = y0
    for (let b = a + 1; b < j; b++) {
      const h = hits[b]
      if (h.y < y0) y0 = h.y
      if (h.y > y1) y1 = h.y
      if (y1 - y0 > band) break
      if (h.x < x0) x0 = h.x
      if (h.x > x1) x1 = h.x
    }
    if (x1 - x0 > best) best = x1 - x0
  }
  return best
}

/**
 * Gesto do marcador → destaques de texto (`marks`) ou um traço livre de
 * marcador (`ink`: ancorado como os traços da caneta, hl = true, largura
 * HL_INK_EM). null = nada a acrescentar.
 */
export function anchorHighlight(
  ptsPx: readonly number[],
  color: string,
  layout: LayoutModel,
  id?: string,
): { marks: TextHighlight[]; ink: AnchoredStroke | null } | null {
  const kind = classifyHighlight(ptsPx, layout)
  if (!kind) return null
  if (kind === 'text') {
    const marks = highlightRange(ptsPx, color, layout, id)
    return marks.length ? { marks, ink: null } : null
  }
  const width = HL_INK_EM * indexOf(layout).em
  const a = isLayoutEmpty(layout)
    ? anchorFree(ptsPx, color, width, layout, id)
    : anchorStroke(ptsPx, color, width, layout, id)
  if (!a) return null
  a.hl = true
  return { marks: [], ink: a }
}

/**
 * Retângulos de um destaque no layout: um por row visual do intervalo, do
 * left do 1.º carácter visível ao right do último dessa row, com a altura
 * da caixa do texto da row e uma pequena folga. Uma linha que quebra noutro
 * sítio (telemóvel, letra maior) dá mais rows e o destaque acompanha-as.
 * Escondido se é órfão, se a linha não existe ou se o texto do intervalo já
 * não é `t` (a letra mudou sem rebase). Em cache por (layout, lineMap, destaque).
 */
export function resolveHighlight(h: TextHighlight, layout: LayoutModel, lineMap?: LineMap | null): ResolvedHighlight {
  const ix = indexOf(layout)
  const key: object = lineMap ?? IDENTITY
  let memo = ix.hlMemo.get(key)
  if (!memo) ix.hlMemo.set(key, (memo = new WeakMap()))
  const hit = memo.get(h)
  if (hit) return hit
  const out = computeHighlight(h, ix, lineMap ?? null)
  memo.set(h, out)
  return out
}

/** resolveHighlight dos destaques de texto de uma lista (os traços ficam de fora) */
export function resolveHighlights(
  items: readonly AnnItem[],
  layout: LayoutModel,
  lineMap?: LineMap | null,
): ResolvedHighlight[] {
  const out: ResolvedHighlight[] = []
  for (const s of items) if (isTextHighlight(s)) out.push(resolveHighlight(s, layout, lineMap))
  return out
}

function computeHighlight(h: TextHighlight, ix: Index, lineMap: LineMap | null): ResolvedHighlight {
  const out: ResolvedHighlight = { id: h.id, color: h.color, rects: [], hidden: true }
  if (h.lines) return out
  const ln = lineMap ? lineMap.get(h.ln) : h.ln
  if (ln === undefined || !fin(ln)) return out
  const rs = ix.lineRows.get(ln)
  if (!rs) return out
  const text = textOf(ix.L, ln)
  const a = leadOf(ix, ln) + h.c0
  const b = leadOf(ix, ln) + h.c1
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > text.length || b <= a) return out
  if (text.slice(a, b) !== h.t) return out
  // Extensão dos caracteres visíveis por row (os espaços colapsados numa quebra não contam)
  const lo: number[] = []
  const hi: number[] = []
  for (let c = a; c < b; c++) {
    const box = ix.L.charRect(ln, c)
    if (!visibleBox(box)) continue
    const ri = rowOfBox(rs, box)
    if (ri < 0) continue
    if (lo[ri] === undefined || box.left < lo[ri]) lo[ri] = box.left
    if (hi[ri] === undefined || box.right > hi[ri]) hi[ri] = box.right
  }
  // Folga vertical, no máximo até meio caminho da row vizinha menos meio px:
  // entre os retângulos de duas rows fica sempre ≥ 1px (nunca dupla
  // opacidade). Com a entrelinha mais apertada (1.0–1.1) as caixas do texto
  // de rows seguidas já se sobrepõem: o retângulo é cortado a meio dessa
  // sobreposição, mesmo que fique mais baixo do que a caixa
  const px = HL_PAD_X_EM * ix.em
  const py = HL_PAD_Y_EM * ix.em
  const gs = ix.rowIdx.get(ln) ?? []
  for (let ri = 0; ri < rs.length; ri++) {
    if (lo[ri] === undefined) continue
    const g = gs[ri]
    const above = g !== undefined && g > 0 ? ix.rows[g - 1] : null
    const below = g !== undefined && g + 1 < ix.rows.length ? ix.rows[g + 1] : null
    let top = rs[ri].top - py
    let bottom = rs[ri].bottom + py
    if (above) top = Math.max(top, (above.bottom + rs[ri].top) / 2 + 0.5)
    if (below) bottom = Math.min(bottom, (rs[ri].bottom + below.top) / 2 - 0.5)
    if (bottom - top < 1) {
      const mid = (rs[ri].top + rs[ri].bottom) / 2
      top = mid - 0.5
      bottom = mid + 0.5
    }
    out.rects.push({ left: lo[ri] - px, top, right: hi[ri] + px, bottom })
  }
  out.hidden = out.rects.length === 0
  return out
}

/** Borracha: ids dos destaques visíveis com algum retângulo a tocar no círculo */
export function highlightsAt(resolved: readonly ResolvedHighlight[], x: number, y: number, radius: number): string[] {
  const ids: string[] = []
  if (!fin(x) || !fin(y) || !fin(radius)) return ids
  for (const h of resolved) {
    if (h.hidden) continue
    for (const r of h.rects) {
      const dx = Math.max(r.left - x, 0, x - r.right)
      const dy = Math.max(r.top - y, 0, y - r.bottom)
      if (dx * dx + dy * dy <= radius * radius) {
        ids.push(h.id)
        break
      }
    }
  }
  return ids
}

function sameColor(a: string, b: string): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase()
}

/** Pedaço [a, b) (absoluto) de um destaque, com outro id */
function highlightPart(o: TextHighlight, a: number, b: number, lead: number, text: string, id: string): TextHighlight {
  return { id, color: o.color, mode: MODE_HL_TEXT, ln: o.ln, c0: a - lead, c1: b - lead, t: text.slice(a, b) }
}

/**
 * Junta destaques novos à lista sem nunca haver dois por cima um do outro
 * (dupla opacidade): na mesma linha, os da MESMA cor que se sobreponham ou
 * toquem (só brancos entre eles) fundem-se com o novo; os de OUTRA cor
 * perdem a parte sobreposta (partidos em dois se o novo ficar no meio; os
 * pedaços sem os brancos da ponta cortada). `lineText` = o texto de cada
 * linha no layout onde se desenhou (LayoutModel.text). Devolve uma lista nova.
 */
export function mergeHighlights(
  items: readonly AnnItem[],
  added: readonly TextHighlight[],
  lineText: (ln: number) => string,
): AnnItem[] {
  let list: AnnItem[] = items.slice()
  for (const m of added) {
    const raw = lineText(m.ln)
    const text = typeof raw === 'string' ? raw : ''
    const lead = leadLen(text)
    let a = lead + m.c0
    let b = lead + m.c1
    if (m.lines || text.slice(a, b) !== m.t) {
      list.push(m)
      continue
    }
    // Intervalo absoluto de um destaque visível desta linha (null se não serve)
    const span = (o: AnnItem): [number, number] | null => {
      if (!isTextHighlight(o) || o.lines || o.ln !== m.ln) return null
      const oa = lead + o.c0
      const ob = lead + o.c1
      return ob > oa && text.slice(oa, ob) === o.t ? [oa, ob] : null
    }
    const blank = (x: number, y: number) => x >= y || !text.slice(x, y).trim()
    // 1. Fusão com a mesma cor, até não crescer mais
    const gone = new Set<AnnItem>()
    let grew = true
    while (grew) {
      grew = false
      for (const o of list) {
        if (gone.has(o) || !isTextHighlight(o) || !sameColor(o.color, m.color)) continue
        const sp = span(o)
        if (!sp) continue
        const touch = sp[1] < a ? blank(sp[1], a) : sp[0] > b ? blank(b, sp[0]) : true
        if (!touch) continue
        gone.add(o)
        a = Math.min(a, sp[0])
        b = Math.max(b, sp[1])
        grew = true
      }
    }
    // 2. Recorte das outras cores
    const next: AnnItem[] = []
    for (const o of list) {
      if (gone.has(o)) continue
      const sp = isTextHighlight(o) && !sameColor(o.color, m.color) ? span(o) : null
      if (!sp || sp[1] <= a || sp[0] >= b) {
        next.push(o)
        continue
      }
      const oh = o as TextHighlight
      let keepId: string | null = oh.id
      let le = a
      while (le > sp[0] && WS.test(text[le - 1])) le--
      if (le > sp[0]) {
        next.push(highlightPart(oh, sp[0], le, lead, text, oh.id))
        keepId = null
      }
      let rs = b
      while (rs < sp[1] && WS.test(text[rs])) rs++
      if (sp[1] > rs) next.push(highlightPart(oh, rs, sp[1], lead, text, keepId ?? newId()))
    }
    next.push({ id: m.id, color: m.color, mode: MODE_HL_TEXT, ln: m.ln, c0: a - lead, c1: b - lead, t: text.slice(a, b) })
    list = next
  }
  return list
}

/* ── Destaques depois de a letra ser editada ── */

interface HlRebase {
  saved: SavedLines | null
  shared: Map<number, number> | null
  lyrics: string | null | undefined
  /** Linhas da letra atual (sem trim) */
  cur: string[]
  /** Linhas atuais que já têm par no retrato (não recebem órfãos nem destaques mudados) */
  used: Set<number>
  /** Linhas do retrato com par, por ordem */
  paired: number[]
}

function hlRebaseContext(saved: SavedLines | null, shared: Map<number, number> | null, lyrics: string | null | undefined): HlRebase {
  const paired = shared ? [...shared.keys()].sort((p, q) => p - q) : []
  return {
    saved,
    shared,
    lyrics,
    cur: String(lyrics ?? '').split('\n'),
    used: new Set(shared ? shared.values() : []),
    paired,
  }
}

/**
 * Ocorrência de `t` em `text` mais próxima de `around`; palavras inteiras
 * primeiro (`wordsOnly`: só essas). -1 se não há
 */
function nearestOccurrence(text: string, t: string, around: number, wordsOnly = false): number {
  let best = -1
  let bestWord = false
  if (!t) return best
  for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + 1)) {
    const word = (i === 0 || WS.test(text[i - 1])) && (i + t.length >= text.length || WS.test(text[i + t.length]))
    if (wordsOnly && !word) continue
    if (best < 0 || (word && !bestWord) || (word === bestWord && Math.abs(i - around) < Math.abs(best - around))) {
      best = i
      bestWord = word
    }
  }
  return best
}

/**
 * Linha MUDADA (sem par no mapa): o destaque procura o seu texto numa linha
 * atual também sem par, entre as vizinhas com par (a linha editada fica no
 * mesmo sítio da estrofe), a mais perto da posição esperada; dentro dela, a
 * ocorrência mais próxima de c0. null se o texto já não existe ali.
 */
function relocateHighlight(h: TextHighlight, ctx: HlRebase): { ln: number; c0: number } | null {
  const shared = ctx.shared
  if (!shared) return null
  let prev = -1
  let next = -1
  for (const k of ctx.paired) {
    if (k < h.ln) prev = k
    else if (k > h.ln) {
      next = k
      break
    }
  }
  const A = prev >= 0 ? (shared.get(prev) as number) : -1
  const B = next >= 0 ? (shared.get(next) as number) : ctx.cur.length
  const want = prev >= 0 ? A + (h.ln - prev) : next >= 0 ? B - (next - h.ln) : h.ln
  let best: { ln: number; c0: number; d: number } | null = null
  for (let j = A + 1; j < B; j++) {
    if (ctx.used.has(j)) continue
    const text = ctx.cur[j]
    if (!text || !text.trim()) continue
    const lead = leadLen(text)
    const at = nearestOccurrence(text, h.t, lead + h.c0)
    if (at < 0) continue
    const d = Math.abs(j - want)
    if (!best || d < best.d) best = { ln: j, c0: at - lead, d }
  }
  return best && { ln: best.ln, c0: best.c0 }
}

/**
 * Um destaque na numeração da letra atual. Linha igual (com par no mapa,
 * o mesmo de rebaseStrokes) → só muda o ln (o texto é o mesmo: c0/c1 valem).
 * Linha mudada → reencontra `t` na linha editada (relocateHighlight); se já
 * não existir fica ÓRFÃO (escondido, com o texto da linha) e volta se a
 * linha voltar — só para linhas novas em relação ao retrato (desvio 11).
 * Sem registo do texto da linha (sem retrato, ou um que não a tem): ver
 * looseHighlight.
 */
function rebaseHighlight(h: TextHighlight, ctx: HlRebase): TextHighlight {
  if (h.lines) {
    const j = remapLines(h.lines, ctx.lyrics, ctx.used).get(h.ln)
    if (j === undefined) return h
    const text = ctx.cur[j] ?? ''
    const lead = leadLen(text)
    if (text.slice(lead + h.c0, lead + h.c1) !== h.t) return h
    return { id: h.id, color: h.color, mode: MODE_HL_TEXT, ln: j, c0: h.c0, c1: h.c1, t: h.t }
  }
  const key = String(h.ln)
  if (!ctx.saved || !ctx.shared || typeof ctx.saved[key] !== 'string') return looseHighlight(h, ctx)
  const j = ctx.shared.get(h.ln)
  if (j !== undefined) return j === h.ln ? h : { ...h, ln: j }
  const at = relocateHighlight(h, ctx)
  if (at) return { id: h.id, color: h.color, mode: MODE_HL_TEXT, ln: at.ln, c0: at.c0, c1: at.c0 + h.t.length, t: h.t }
  return { ...h, lines: { [key]: ctx.saved[key] } }
}

/** Linhas para cada lado onde se procura um destaque sem registo da sua linha */
const HL_LOOSE_LINES = 3

/**
 * Rede de segurança — destaque sem registo do texto da sua linha (não
 * devia acontecer: o retrato do marcador viaja com ele; ex.: um payload
 * mexido à mão). Se o texto continua no sítio, fica; senão procura-o, como
 * palavras inteiras, na própria linha e depois até HL_LOOSE_LINES linhas
 * para cada lado (a mais perto primeiro). Não o encontrando fica como está:
 * o resolver esconde-o (não se apaga). Os rótulos de secção mostram-se com
 * outro texto (REFRÃO): ficam.
 */
function looseHighlight(h: TextHighlight, ctx: HlRebase): TextHighlight {
  const own = ctx.cur[h.ln]
  if (typeof own === 'string') {
    const lead = leadLen(own)
    if (own.slice(lead + h.c0, lead + h.c1) === h.t || /^\[.+\]$/.test(own.trim())) return h
  }
  for (let d = 0; d <= HL_LOOSE_LINES; d++) {
    for (const j of d ? [h.ln + d, h.ln - d] : [h.ln]) {
      const text = ctx.cur[j]
      if (typeof text !== 'string' || !text.trim() || /^\[.+\]$/.test(text.trim())) continue
      const lead = leadLen(text)
      const at = nearestOccurrence(text, h.t, lead + h.c0, true)
      if (at < 0) continue
      return { id: h.id, color: h.color, mode: MODE_HL_TEXT, ln: j, c0: at - lead, c1: at - lead + h.t.length, t: h.t }
    }
  }
  return h
}

/* ── Cor do marcador ── */

/** #rgb / #rrggbb / rgb() / rgba() → [r, g, b]; null se não se reconhece */
function rgbOf(color: unknown): [number, number, number] | null {
  if (typeof color !== 'string') return null
  const c = color.trim()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c)
  if (hex) {
    let h = hex[1]
    if (h.length <= 4) h = h.split('').map(ch => ch + ch).join('')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const fn = /^rgba?\(\s*(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)/i.exec(c)
  if (fn) return [fn[1], fn[2], fn[3]].map(v => Math.min(255, Math.round(Number(v)))) as [number, number, number]
  return null
}

/** Cor com transparência (rgba), para a cópia antiga; um formato desconhecido fica como está */
export function rgbaOf(color: string, alpha: number): string {
  const rgb = rgbOf(color)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color
}

function lumOf(rgb: readonly number[]): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** Luminância relativa (sRGB, 0 = preto, 1 = branco) de uma cor; null se não se reconhece */
export function luminanceOf(color: string | null | undefined): number | null {
  const rgb = rgbOf(color)
  return rgb ? lumOf(rgb) : null
}

/** Contraste (WCAG) entre duas luminâncias */
function contrastOf(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Contraste (WCAG) entre duas cores; null se alguma não se reconhece */
export function contrastRatio(a: string | null | undefined, b: string | null | undefined): number | null {
  const la = luminanceOf(a)
  const lb = luminanceOf(b)
  return la === null || lb === null ? null : contrastOf(la, lb)
}

/** Cor (rgb) de uma camada `color` com opacidade `alpha` por cima de `bg` — como o browser compõe */
export function blendOver(color: string, bg: string, alpha: number): [number, number, number] | null {
  const c = rgbOf(color)
  const b = rgbOf(bg)
  if (!c || !b) return null
  return [0, 1, 2].map(i => b[i] + (c[i] - b[i]) * alpha) as [number, number, number]
}

/**
 * Teto da opacidade do marcador sobre um fundo com esta luminância. Numa
 * folha clara, a cor viva meio transparente é o marca-texto do papel; num
 * fundo escuro um pouco mais (menos turvo) — markerAlpha baixa-a por cor
 * quando o texto por cima perderia contraste.
 */
export function markerOpacity(bgLuminance: number | null | undefined): number {
  return fin(bgLuminance) && bgLuminance < 0.35 ? HL_OPACITY_DARK : HL_OPACITY_LIGHT
}

/**
 * Opacidade de uma cor do marcador debaixo de um texto (`ink`, `textPx`)
 * sobre o fundo `bg`: a maior até ao teto do fundo (markerOpacity) que
 * deixa o texto com contraste ≥ HL_MIN_CONTRAST (DESIGN-v2: 4.5:1). Com uma
 * tinta de cor (concerto: laranja, âmbar…) ou um rótulo de secção na cor de
 * acento isso pode dar um marcador muito fraco: no texto GRANDE (≥ 24px,
 * WCAG) nunca fica abaixo de HL_MIN_ALPHA_LARGE, desde que o texto mantenha
 * ≥ 3:1. Um tema que já tem menos contraste do que o alvo (sem marcador)
 * pede 80% do que tem. Cores que não se reconhecem → o teto.
 */
export function markerAlpha(
  color: string,
  bg: string | null | undefined,
  ink: string | null | undefined,
  textPx?: number,
): number {
  const b = rgbOf(bg)
  const cap = markerOpacity(b ? lumOf(b) : null)
  const c = rgbOf(color)
  const k = rgbOf(ink)
  if (!b || !c || !k) return cap
  const inkL = lumOf(k)
  const base = contrastOf(lumOf(b), inkL)
  const best = (target: number): number => {
    const want = Math.min(target, base * 0.8)
    for (let n = Math.round(cap * 100); n > 0; n--) {
      const a = n / 100
      const mix = [0, 1, 2].map(i => b[i] + (c[i] - b[i]) * a)
      if (contrastOf(lumOf(mix), inkL) >= want) return a
    }
    return 0
  }
  let a = best(HL_MIN_CONTRAST)
  if (fin(textPx) && textPx >= HL_LARGE_TEXT_PX && a < HL_MIN_ALPHA_LARGE) {
    a = Math.max(a, Math.min(HL_MIN_ALPHA_LARGE, best(HL_MIN_CONTRAST_LARGE)))
  }
  return a
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
 * Marcador livre: [id, cor, largura×1000, MODE_HL_INK, runs, cs, xs, ys, modo, linhas?]
 *  (modo = o de ancoragem: texto, margem, intervalo, livre)
 * Destaque de texto: [id, cor, 0, MODE_HL_TEXT, ln, c0, c1, texto, linhas?]
 *  (o 0 está reservado: uma versão futura que o use, ou que junte campos
 *  depois das linhas, é guardada em `extra` e reescrita tal como veio)
 * Retrato do marcador: [id fixo, '', 0, MODE_HL_LINES, linhas] — o texto
 *  (trim) das linhas a que os itens do marcador estão numerados
 * Os modos do marcador são desconhecidos da versão anterior (2b52db3), que
 * guarda estas entradas em `extra` e as reescreve tal como vieram.
 */
export type EncodedStroke = (string | number | number[] | SavedLines)[]

export function encodeAnchored(strokes: readonly AnnItem[]): EncodedStroke[] {
  return strokes.map(s => {
    if (isTextHighlight(s)) {
      const h: EncodedStroke = [s.id, s.color, 0, MODE_HL_TEXT, s.ln, s.c0, s.c1, s.t]
      if (s.lines) h.push(s.lines)
      return h
    }
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
    const w = Math.round(s.w * 1000)
    const e: EncodedStroke = s.hl
      ? [s.id, s.color, w, MODE_HL_INK, runs, cs, xs, ys, s.mode]
      : [s.id, s.color, w, s.mode, runs, cs, xs, ys]
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
export function decodeAnchored(raw: unknown): AnnItem[] {
  return decodeAnchoredParts(raw).strokes
}

/** Destaque de texto guardado → TextHighlight; null se estragado */
function decodeHighlight(e: readonly unknown[], id: string | number, color: unknown): TextHighlight | null {
  const [, , , , ln, c0, c1, t, lines] = e
  if (typeof ln !== 'number' || !Number.isInteger(ln) || ln < 0) return null
  if (typeof c0 !== 'number' || !Number.isInteger(c0) || c0 < 0) return null
  if (typeof c1 !== 'number' || !Number.isInteger(c1) || c1 <= c0) return null
  if (typeof t !== 'string' || t.length !== c1 - c0) return null
  const h: TextHighlight = {
    id: String(id),
    color: typeof color === 'string' && color ? color : DEFAULT_COLOR,
    mode: MODE_HL_TEXT,
    ln,
    c0,
    c1,
    t,
  }
  if (isSavedLines(lines)) h.lines = lines
  return h
}

/**
 * decodeAnchored + as entradas de uma versão FUTURA (modo ou código de Y
 * que esta não conhece), guardadas em bruto em `extra`: quem grava volta a
 * escrevê-las tal como vieram (buildPayload), para um cliente mais antigo
 * nunca apagar o que não sabe desenhar. Também em `extra`: campos a mais
 * depois das linhas (qualquer tipo) e, no destaque, o campo reservado ≠ 0.
 * Entradas estragadas saem. `hlLines`: o retrato do marcador (MODE_HL_LINES).
 */
export function decodeAnchoredParts(raw: unknown): { strokes: AnnItem[]; extra: unknown[]; hlLines: SavedLines | null } {
  const out: AnnItem[] = []
  const extra: unknown[] = []
  let hlLines: SavedLines | null = null
  if (!Array.isArray(raw)) return { strokes: out, extra, hlLines }
  for (const e of raw) {
    if (!Array.isArray(e) || e.length < 4) continue
    const [id, color, w, kind, runs, cs, xs, ys] = e as unknown[]
    if ((typeof id !== 'string' || !id) && !fin(id)) continue
    if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0) continue
    if (kind === MODE_HL_LINES) {
      if (e.length === 5 && w === 0 && isSavedLines(e[4])) hlLines = hlLines ?? e[4]
      else extra.push(e)
      continue
    }
    if (kind === MODE_HL_TEXT) {
      if (w !== 0 || e.length > 9) {
        extra.push(e)
        continue
      }
      const h = decodeHighlight(e, id as string | number, color)
      if (h) out.push(h)
      continue
    }
    // Marcador livre: o modo de ancoragem vem a seguir aos pontos
    const hl = kind === MODE_HL_INK
    const mode = hl ? e[8] : kind
    const lines = hl ? e[9] : e[8]
    if (hl && (typeof mode !== 'number' || !Number.isInteger(mode) || mode < 0)) continue
    if (KNOWN_MODES.indexOf(mode as number) < 0 || e.length > (hl ? 10 : 9)) {
      extra.push(e)
      continue
    }
    if (e.length < 8) continue
    if (!fin(w) || !intArray(runs) || !intArray(cs) || !intArray(xs) || !intArray(ys)) continue
    const n = cs.length
    if (xs.length !== n || ys.length !== n || runs.length % 3 !== 0) continue
    let total = 0
    let valid = true
    let future = false
    for (let r = 0; r < runs.length; r += 3) {
      if (runs[r] < 0 || runs[r + 1] < 0 || runs[r + 2] < 1) valid = false
      if (runs[r + 1] > MAX_CODE) future = true
      total += runs[r + 2]
    }
    if (!valid || total !== n) continue
    if (future) {
      extra.push(e)
      continue
    }
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
      mode: mode as StrokeMode,
      p,
    }
    if (hl) s.hl = true
    if (isSavedLines(lines)) s.lines = lines
    out.push(s)
  }
  return { strokes: out, extra, hlLines }
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
  anchored?: (EncodedStroke | unknown)[]
  lines?: SavedLines
  /**
   * 1 = cópia deste aparelho ainda por juntar à da cloud (gravada sem se
   * conseguir ler a cloud): no próximo pull bem-sucedido junta-se, por id,
   * em vez de "o local ganha". Só no localStorage.
   */
  pend?: number
}

export interface ParsedPayload {
  w: number
  h?: number
  strokes: LegacyStroke[]
  em?: number
  /** null = payload antigo, sem âncoras (migrar a partir de `strokes`) */
  anchored: AnnItem[] | null
  /** null = sem registo do texto das linhas */
  lines: SavedLines | null
  /**
   * Retrato a que os itens do marcador estão numerados (MODE_HL_LINES);
   * null = sem ele (usa-se `lines`). Vai para rebaseStrokes (hlSaved).
   */
  hlLines: SavedLines | null
  /** Entradas de uma versão futura, em bruto (ver decodeAnchoredParts) */
  extra: unknown[]
  /** Por juntar à cloud (ver AnnPayload.pend) */
  pend: boolean
}

/** Item do marcador (destaque de texto ou traço livre de marcador)? */
export function isMarkerItem(s: AnnItem): boolean {
  return isTextHighlight(s) || !!s.hl
}

/** Payload v2 completo, pronto para JSON.stringify / upsert */
export function buildPayload(o: {
  w: number
  h: number
  strokes: readonly LegacyStroke[]
  em: number
  anchored: readonly AnnItem[]
  lyrics: string
  /** Entradas de uma versão futura, reescritas tal como vieram */
  extra?: readonly unknown[]
  pend?: boolean
}): AnnPayload {
  const lines = collectLines(o.anchored, o.lyrics)
  const anchored: unknown[] = [...encodeAnchored(o.anchored), ...(o.extra ?? [])]
  // Itens do marcador → o seu retrato, numa entrada que a versão anterior
  // reescreve tal como veio (mesmo que ela re-numere a caneta e mude `lines`)
  if (o.anchored.some(isMarkerItem) && Object.keys(lines).length) anchored.push([HL_LINES_ID, '', 0, MODE_HL_LINES, lines])
  const out: AnnPayload = {
    w: fin(o.w) ? Math.round(o.w * 10) / 10 : 0,
    h: fin(o.h) ? Math.round(o.h * 10) / 10 : 0,
    strokes: o.strokes.slice(),
    v: 2,
    em: fin(o.em) ? r3(o.em) : undefined,
    anchored,
    lines,
  }
  if (o.pend) out.pend = 1
  return out
}

/** Ids das entradas em bruto (extra) — para juntar duas cópias sem as repetir */
function extraId(e: unknown): string {
  return Array.isArray(e) ? String(e[0]) : ''
}

/**
 * Junta duas cópias por id (a cloud e a deste aparelho): os traços da
 * `base` ficam, os da `mine` que a base não tem juntam-se no fim. Nada se
 * perde — um traço apagado só numa das cópias volta (melhor do que apagar
 * o que não se viu).
 */
export function unionById<T extends { id: string }>(base: readonly T[], mine: readonly T[]): T[] {
  const ids = new Set(base.map(s => s.id))
  return [...base, ...mine.filter(s => !ids.has(s.id))]
}

/** unionById para as entradas em bruto de uma versão futura */
export function unionExtra(base: readonly unknown[], mine: readonly unknown[]): unknown[] {
  const ids = new Set(base.map(extraId))
  return [...base, ...mine.filter(e => !ids.has(extraId(e)))]
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
  if (Array.isArray(raw)) return { w: 0, strokes: legacyList(raw), anchored: null, lines: null, hlLines: null, extra: [], pend: false }
  if (typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const parts = Array.isArray(o.anchored) ? decodeAnchoredParts(o.anchored) : null
  const out: ParsedPayload = {
    w: fin(o.w) ? o.w : 0,
    strokes: legacyList(o.strokes),
    anchored: parts ? parts.strokes : null,
    lines: isSavedLines(o.lines) ? o.lines : null,
    hlLines: parts ? parts.hlLines : null,
    extra: parts ? parts.extra : [],
    pend: o.pend === 1 || o.pend === true,
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
 * payloadHasStrokes com esta letra: os órfãos (as suas linhas saíram da
 * letra; escondidos até voltarem) não contam — senão a tecla "Anotações de
 * ensaio" do concerto levava a uma vista vazia
 */
export function payloadHasVisible(p: ParsedPayload | null | undefined, lyrics: string | null | undefined): boolean {
  if (!p) return false
  if (!p.anchored) return p.strokes.length > 0
  const src = String(lyrics ?? '').split('\n')
  return rebaseStrokes(p.anchored, p.lines, lyrics, p.hlLines).strokes.some(s =>
    isTextHighlight(s) ? highlightFits(s, src) : !s.lines && s.p.length >= P_STRIDE)
}

/**
 * Destaque visível com esta letra (sem layout): não é órfão e o seu texto
 * está na linha. Os rótulos de secção ([Refrão]) mostram-se com outro texto
 * (REFRÃO): aí basta a linha ser um rótulo — o resolver confirma no layout.
 */
function highlightFits(h: TextHighlight, src: readonly string[]): boolean {
  if (h.lines) return false
  const line = src[h.ln]
  if (typeof line !== 'string') return false
  const lead = leadLen(line)
  return line.slice(lead + h.c0, lead + h.c1) === h.t || /^\[.+\]$/.test(line.trim())
}

/**
 * Traços resolvidos (no layout do Ensaio) → formato antigo: um traço por
 * caminho, px inteiros. Os escondidos ficam de fora. Os do marcador vão com
 * cor rgba translúcida (os clientes antigos desenham-nos por cima do texto)
 * e cada row de um destaque de texto vai como um traço horizontal largo.
 */
export function toLegacyStrokes(
  resolved: readonly ResolvedStroke[],
  highlights?: readonly ResolvedHighlight[] | null,
): LegacyStroke[] {
  const out: LegacyStroke[] = []
  for (const s of resolved) {
    if (s.hidden) continue
    s.subpaths.forEach((sp, k) => {
      out.push({
        id: k ? `${s.id}~${k}` : s.id,
        pts: sp.map(v => Math.round(v)),
        color: s.hl ? rgbaOf(s.color, HL_LEGACY_ALPHA) : s.color,
        width: Math.round(s.width * 10) / 10,
      })
    })
  }
  for (const h of highlights ?? []) {
    if (h.hidden) continue
    h.rects.forEach((r, k) => {
      const th = r.bottom - r.top
      const cy = Math.round((r.top + r.bottom) / 2)
      // Pontas redondas: o traço vai de meia altura para dentro de cada lado
      let x0 = r.left + th / 2
      let x1 = r.right - th / 2
      if (x1 < x0) x0 = x1 = (r.left + r.right) / 2
      out.push({
        id: k ? `${h.id}~${k}` : h.id,
        pts: [Math.round(x0), cy, Math.round(x1), cy],
        color: rgbaOf(h.color, HL_LEGACY_ALPHA),
        width: Math.round(th * 10) / 10,
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
