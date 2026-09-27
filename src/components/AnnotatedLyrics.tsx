import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import LyricsView, { withAlpha } from './LyricsView'
import { loadAnnotations, pullAnnotations, annotationPath, type SavedAnnotations } from './AnnotationLayer'

const PAD_V = 16
const PAD_H = 20

/**
 * Read-only view of lyrics + rehearsal annotations. The text renders at its
 * natural size for the available width; the stroke coordinates (saved with
 * the content width `w` and height `h` they were drawn at) are rescaled —
 * X by the width ratio, Y by the height ratio — to stay aligned with it.
 */
export default function AnnotatedLyrics({
  songId, lyrics, userId, bgColor, textColor, activeLine, accentColor, fontSize, lineHeight,
  noPadding = false,
}: {
  songId: string; lyrics: string; userId?: string
  bgColor?: string; textColor?: string
  activeLine?: number; accentColor?: string
  fontSize?: number; lineHeight?: number
  noPadding?: boolean
}) {
  const padH = noPadding ? 0 : PAD_H
  const padV = noPadding ? 0 : PAD_V
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<SavedAnnotations | null>(null)
  const [outerW, setOuterW] = useState(0)
  const [innerH, setInnerH] = useState(0)

  useEffect(() => {
    const local = loadAnnotations(songId)
    setData(local)
    if (userId && (!local || local.strokes.length === 0)) {
      pullAnnotations(songId, userId).then(remote => { if (remote) setData(remote) })
    }
  }, [songId, userId])

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const obs = new ResizeObserver(e => setOuterW(e[0].contentRect.width))
    obs.observe(el)
    setOuterW(el.offsetWidth)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const obs = new ResizeObserver(e => setInnerH(e[0].contentRect.height))
    obs.observe(el)
    setInnerH(el.offsetHeight)
    return () => obs.disconnect()
  }, [data])

  // Width of the drawing area (inside padding)
  const contentW = Math.max(0, outerW - padH * 2)
  const xRatio = data?.w && data.w > 0 && contentW > 0 ? contentW / data.w : 1
  // Dados antigos sem `h` guardado: Y segue o rácio de largura, como antes
  const yRatio = data?.h && data.h > 0 && innerH > 0 ? innerH / data.h : xRatio

  // Caminhos re-escalados memoizados — evita remapear todos os pontos de
  // todos os traços em cada render (ex.: a cada mudança de linha ativa)
  const scaledPaths = useMemo(
    () => (data?.strokes ?? []).map(s => ({
      id: s.id,
      color: s.color,
      width: s.width * xRatio,
      d: annotationPath(s.pts.map((p, i) => p * (i % 2 === 0 ? xRatio : yRatio))),
    })),
    [data, xRatio, yRatio]
  )

  // Com fundo próprio (modo palco) ocupa o ecrã sem moldura; sem ele é um
  // painel v2 normal (--surface + hairline) e segue o tema da app.
  const hasOwnBg = !!bgColor

  // Tinta: a cor pedida e os seus tons secundários derivados dela (não
  // escrever `--text: var(--text)` — seria uma referência circular).
  const ink: Record<string, string> = {}
  if (textColor) {
    ink['--text'] = textColor
    ink['--text2'] = withAlpha(textColor, 0.68)
    ink['--text3'] = withAlpha(textColor, 0.56)
  }

  const frameStyle: CSSProperties = {
    background: bgColor ?? 'var(--surface)',
    border: hasOwnBg ? 'none' : '1px solid var(--border)',
    borderRadius: hasOwnBg ? 0 : 'var(--radius)',
    overflow: 'hidden',
    padding: `${padV}px ${padH}px`,
    color: textColor ?? 'var(--text)',
    ...(ink as CSSProperties),
  }

  return (
    <div
      ref={outerRef}
      style={frameStyle}
    >
      <div ref={innerRef} style={{ position: 'relative' }}>
        <LyricsView lyrics={lyrics} activeLine={activeLine} accent={accentColor} fontSize={fontSize} lineHeight={lineHeight} />
        {data && data.strokes.length > 0 && (
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            {scaledPaths.map(s => (
              <path
                key={s.id}
                d={s.d}
                stroke={s.color}
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
