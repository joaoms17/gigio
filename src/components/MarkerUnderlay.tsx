import type { CSSProperties } from 'react'
import type { MarkerPaint, MarkerShape } from '../lib/annotations/view'
import styles from './MarkerUnderlay.module.css'

/**
 * Camada do marcador, POR TRÁS do texto (como uma seleção de texto): os
 * destaques e os traços livres de marcador, cada um na cor viva guardada,
 * num grupo por cor com a opacidade dela (`paint`: depende do fundo e do
 * texto por cima — ver markerAlpha). Dentro de um grupo, onde duas formas
 * da mesma cor se tocam nunca há dupla opacidade (o grupo é composto uma só
 * vez). Os destaques de rótulos de secção têm o seu grupo (mais leve).
 * O contentor tem de ser um contexto de empilhamento (isolation: isolate):
 * a camada fica a z-index -1, atrás do texto mas à frente do fundo dele.
 * Sem formas não se monta nada.
 */
export default function MarkerUnderlay({ shapes, paint, height }: {
  shapes: readonly MarkerShape[]
  paint: MarkerPaint
  /** Altura explícita (px) quando o desenho passa do fim do contentor */
  height?: number
}) {
  if (!shapes.length) return null
  // Grupos pela ordem em que cada cor aparece
  const groups = new Map<string, { color: string; label: boolean; shapes: MarkerShape[] }>()
  for (const s of shapes) {
    const key = `${s.color.toLowerCase()}|${s.label ? 1 : 0}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { color: s.color, label: s.label, shapes: [] }))
    g.shapes.push(s)
  }
  const style: CSSProperties | undefined = height ? { height } : undefined
  return (
    <svg aria-hidden="true" data-ann="marcador" className={styles.under} style={style}>
      {[...groups.entries()].map(([key, g]) => (
        <g key={key} opacity={paint(g.color, g.label)} data-rotulo={g.label ? '' : undefined}>
          {g.shapes.map(s => 'rects' in s ? (
            <g key={s.key} data-hl={s.id} fill={s.color}>
              {s.rects.map((r, k) => {
                const h = Math.max(0, r.bottom - r.top)
                return (
                  <rect
                    key={k}
                    x={r.left}
                    y={r.top}
                    width={Math.max(0, r.right - r.left)}
                    height={h}
                    // Cantos ligeiramente arredondados — nunca mais do que ¼ da altura
                    // (com a entrelinha apertada o retângulo fica mais baixo)
                    rx={Math.min(s.radius, h / 4)}
                  />
                )
              })}
            </g>
          ) : (
            <path
              key={s.key}
              data-hl={s.id}
              d={s.d}
              stroke={s.color}
              strokeWidth={s.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
      ))}
    </svg>
  )
}
