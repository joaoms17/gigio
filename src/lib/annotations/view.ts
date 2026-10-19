/**
 * O que se desenha de uma lista de anotações num layout — partilhado pelo
 * Ensaio (AnnotationLayer) e pelo concerto (AnnotatedLyrics).
 *
 * Duas camadas: a CANETA por cima do texto (caminhos opacos) e o MARCADOR
 * por trás dele (destaques de texto e traços livres de marcador, ver
 * MarkerUnderlay). Tudo vem das caches de anchor.ts (por layout e por item):
 * re-desenhar com o mesmo layout não volta a medir nada.
 */
import {
  isTextHighlight, luminanceOf, markerAlpha, markerOpacity, pathFromSubpaths, resolveHighlight, resolveStroke,
  type AnnItem, type Box, type LayoutModel, type ResolvedHighlight, type ResolvedStroke,
} from './anchor'
import type { MarkerInk } from './measure'

/** Traço da caneta, pronto para um <path> */
export interface PenPath {
  id: string
  color: string
  width: number
  d: string
}

/**
 * Forma do marcador: destaque de texto (um retângulo por row) ou traço
 * livre (caminho). A cor é a cor viva guardada; a translucidez é do grupo
 * da cor (ver markerPaint). `label`: destaque de um rótulo de secção.
 */
export type MarkerShape =
  | { key: string; id: string; color: string; label: boolean; rects: readonly Box[]; radius: number }
  | { key: string; id: string; color: string; label: boolean; d: string; width: number }

/** Opacidade de uma cor do marcador, debaixo da letra ou de um rótulo de secção */
export type MarkerPaint = (color: string, label: boolean) => number

/**
 * Opacidades do marcador para as cores medidas de um layout (fundo, letra,
 * rótulos — ver markerAlpha), em cache por cor. Sem cores medidas: o teto do
 * fundo `fallbackBg` (ou o de uma folha clara).
 */
export function markerPaint(ink: MarkerInk | null | undefined, fallbackBg?: string | null): MarkerPaint {
  const memo = new Map<string, number>()
  const bg = ink?.bg ?? fallbackBg ?? null
  return (color, label) => {
    const key = `${color}|${label ? 1 : 0}`
    let a = memo.get(key)
    if (a === undefined) {
      a = ink && (label ? ink.label : ink.text)
        ? markerAlpha(color, bg, label ? ink.label : ink.text, label ? ink.labelPx : ink.textPx)
        : markerOpacity(luminanceOf(bg) ?? 1)
      memo.set(key, a)
    }
    return a
  }
}

export interface AnnView {
  pen: PenPath[]
  marker: MarkerShape[]
  /** Todos os traços resolvidos (caneta e marcador livre) — para a calha e a borracha */
  resolved: ResolvedStroke[]
  highlights: ResolvedHighlight[]
  /** Extremos verticais (px) do que se desenha; ±Infinity se nada */
  top: number
  bottom: number
}

/** Cantos dos destaques: ligeiramente arredondados, 2–6px conforme o tamanho da letra */
export function highlightRadius(em: number): number {
  return Math.min(6, Math.max(2, Math.round(em * 0.14 * 10) / 10))
}

export function buildView(items: readonly AnnItem[], layout: LayoutModel): AnnView {
  const view: AnnView = { pen: [], marker: [], resolved: [], highlights: [], top: Infinity, bottom: -Infinity }
  const radius = highlightRadius(layout.em)
  items.forEach((s, i) => {
    // Payloads antigos podem repetir ids: a chave leva o índice
    const key = `${i}:${s.id}`
    if (isTextHighlight(s)) {
      const h = resolveHighlight(s, layout)
      view.highlights.push(h)
      if (h.hidden) return
      for (const r of h.rects) {
        if (r.top < view.top) view.top = r.top
        if (r.bottom > view.bottom) view.bottom = r.bottom
      }
      view.marker.push({ key, id: s.id, color: s.color, label: !!layout.section?.(s.ln), rects: h.rects, radius })
      return
    }
    const r = resolveStroke(s, layout)
    view.resolved.push(r)
    if (r.hidden) return
    const half = r.width / 2
    for (const sp of r.subpaths) {
      for (let k = 1; k < sp.length; k += 2) {
        if (sp[k] - half < view.top) view.top = sp[k] - half
        if (sp[k] + half > view.bottom) view.bottom = sp[k] + half
      }
    }
    const d = pathFromSubpaths(r.subpaths)
    if (r.hl) view.marker.push({ key, id: r.id, color: r.color, label: false, d, width: r.width })
    else view.pen.push({ id: r.id, color: r.color, width: r.width, d })
  })
  return view
}
