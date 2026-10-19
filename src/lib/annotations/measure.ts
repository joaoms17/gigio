/**
 * Medição do layout da letra no DOM → LayoutModel (ver anchor.ts).
 *
 * Lê os elementos [data-ln] de um LyricsView (linhas de texto e rótulos de
 * secção; as quebras não são âncoras) e mede o TEXTO com Range — a caixa do
 * conteúdo, não a line box — em px relativos a um elemento-base (a camada
 * onde os traços se desenham). Os dois retângulos vêm de
 * getBoundingClientRect, por isso o scroll de um contentor não conta.
 *
 * Cada medição é um retrato: as rows de todas as linhas medem-se logo (é
 * preciso para o índice de qualquer forma); os caracteres só quando o
 * cálculo os pede, com cache por (ln, c). Quando o layout muda mede-se de
 * novo e compara-se a assinatura (`sig`): igual → fica o retrato anterior e
 * os caches dele (nada a redesenhar, nenhum setState).
 */
import { mergeRowRects, pickCharRect, type Box, type LayoutModel } from './anchor'

export interface MeasuredLayout extends LayoutModel {
  /** Geometria + texto medidos: dois retratos com a mesma assinatura são o mesmo layout */
  sig: string
  /** Tamanho do contentor medido (px) — a base {w, h} da cópia antiga dos traços */
  width: number
  height: number
}

const EMPTY: readonly Box[] = []
const r2 = (v: number) => Math.round(v * 100) / 100

/** O nó de texto da linha: filho direto (num rótulo de secção os traços são ::before/::after) */
function textNodeOf(el: Element): Text | null {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && (n as Text).data.length > 0) return n as Text
  }
  return null
}

function shifted(b: Box | null, ox: number, oy: number): Box | null {
  return b ? { left: b.left - ox, top: b.top - oy, right: b.right - ox, bottom: b.bottom - oy } : null
}

/**
 * Mede a letra dentro de `container` (a raiz de um LyricsView, ou um
 * elemento que a contenha) em coordenadas relativas a `base`.
 * null se algum dos dois não está no documento.
 */
export function measureLayout(container: HTMLElement | null, base: HTMLElement | null): MeasuredLayout | null {
  if (!container || !base || !container.isConnected || !base.isConnected) return null
  const baseRect = base.getBoundingClientRect()
  const ox = baseRect.left
  const oy = baseRect.top
  const cRect = container.getBoundingClientRect()
  const els = container.querySelectorAll<HTMLElement>('[data-ln]')
  // O bloco da letra é o pai das linhas (a raiz do LyricsView): o texto centra-se nele
  const block = els.length ? els[0].parentElement ?? container : container
  const bRect = block === container ? cRect : block.getBoundingClientRect()

  const range = document.createRange()
  const nodes = new Map<number, Text>()
  const texts = new Map<number, string>()
  const rowMap = new Map<number, Box[]>()
  const lines: number[] = []
  let em = 0
  for (let i = 0; i < els.length; i++) {
    const el = els[i]
    const ln = Number(el.getAttribute('data-ln'))
    if (!Number.isInteger(ln) || ln < 0 || nodes.has(ln)) continue
    const node = textNodeOf(el)
    if (!node) continue
    range.selectNodeContents(node)
    // Uma caixa por linha de ecrã; as de largura 0 (espaços colapsados) saem
    const rows = mergeRowRects(range.getClientRects()).map(b => shifted(b, ox, oy) as Box)
    if (!rows.length) continue
    nodes.set(ln, node)
    texts.set(ln, node.data)
    rowMap.set(ln, rows)
    lines.push(ln)
    // 1em = tamanho das linhas de texto (os rótulos de secção têm px fixos)
    if (!em && !el.hasAttribute('data-sec')) {
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs > 0) em = fs
    }
  }
  if (!em) em = parseFloat(getComputedStyle(block).fontSize) || 16

  // Altura máxima de uma row por linha: um carácter com uma caixa mais alta
  // do que isto apanhou duas linhas de ecrã (ver charRect)
  const rowH = new Map<number, number>()
  rowMap.forEach((rs, ln) => rowH.set(ln, Math.max(...rs.map(b => b.bottom - b.top))))

  const chars = new Map<number, Map<number, Box | null>>()
  function charRect(ln: number, c: number): Box | null {
    const node = nodes.get(ln)
    const len = texts.get(ln)?.length ?? 0
    if (!node || !Number.isInteger(c) || c < 0 || c >= len) return null
    let perLine = chars.get(ln)
    if (!perLine) chars.set(ln, (perLine = new Map()))
    const hit = perLine.get(c)
    if (hit !== undefined) return hit
    let box: Box | null = null
    try {
      range.setStart(node, c)
      range.setEnd(node, c + 1)
      // O normal: um carácter = uma caixa, e a união é essa caixa (mais
      // barato do que a lista). Mais alta do que uma row = duas caixas (ex.:
      // na quebra) → a lista, e fica a mais larga
      const b = range.getBoundingClientRect()
      const one = b.width > 0 && b.height > 0 && b.height <= (rowH.get(ln) ?? 0) * 1.25 + 1
      box = shifted(one ? b : pickCharRect(range.getClientRects()), ox, oy)
    } catch {
      // O nó mudou depois da medição (este retrato já vai ser substituído): sem caixa
    }
    perLine.set(c, box)
    return box
  }

  const blockLeft = bRect.left - ox
  const blockRight = bRect.right - ox
  const blockTop = bRect.top - oy
  const parts: (string | number)[] = [r2(em), r2(blockLeft), r2(blockRight), r2(blockTop), r2(cRect.width), r2(cRect.height)]
  for (const ln of lines) {
    parts.push('|', ln, texts.get(ln) as string)
    for (const b of rowMap.get(ln) as Box[]) parts.push(r2(b.left), r2(b.top), r2(b.right), r2(b.bottom))
  }

  return {
    em,
    blockLeft,
    blockRight,
    blockTop,
    centerX: (blockLeft + blockRight) / 2,
    lines,
    rows: ln => rowMap.get(ln) ?? EMPTY,
    text: ln => texts.get(ln) ?? '',
    charRect,
    sig: parts.join(' '),
    width: cRect.width,
    height: cRect.height,
  }
}

/**
 * `fn` quando as fontes da página estiverem carregadas (logo, se já
 * estiverem) e sempre que outra fonte acabar de carregar — o texto muda de
 * largura sem que o bloco mude de tamanho, e o ResizeObserver não vê.
 * Devolve a função que cancela.
 */
export function watchFonts(fn: () => void): () => void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts) return () => {}
  let alive = true
  const run = () => { if (alive) fn() }
  fonts.ready.then(run, () => {})
  if (typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', run)
  return () => {
    alive = false
    if (typeof fonts.removeEventListener === 'function') fonts.removeEventListener('loadingdone', run)
  }
}

/** `fn` uma vez, quando as fontes estiverem prontas (já, se estiverem). Devolve a função que cancela. */
export function whenFontsReady(fn: () => void): () => void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  let alive = true
  const run = () => { if (alive) fn() }
  if (!fonts || fonts.status === 'loaded') run()
  else fonts.ready.then(run, run)
  return () => { alive = false }
}
