import { useEffect, useRef, useState } from 'react'
import LyricsView from './LyricsView'
import { loadAnnotations, annotationPath, type SavedAnnotations } from './AnnotationLayer'

const PAD_V = 16
const PAD_H = 20

/**
 * Read-only view of lyrics + rehearsal annotations, scaled to fit the
 * available width. Renders at the width the strokes were drawn at and
 * applies a CSS transform so the drawing stays pixel-aligned with the text.
 */
export default function AnnotatedLyrics({ songId, lyrics }: { songId: string; lyrics: string }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<SavedAnnotations | null>(null)
  const [outerW, setOuterW] = useState(0)
  const [innerH, setInnerH] = useState(0)

  useEffect(() => { setData(loadAnnotations(songId)) }, [songId])

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
  const contentW = Math.max(0, outerW - PAD_H * 2)
  const baseW = data?.w && data.w > 0 ? data.w : contentW
  const scale = contentW > 0 && baseW > 0 ? contentW / baseW : 1

  return (
    <div
      ref={outerRef}
      style={{
        background: '#ffffff',
        borderRadius: 12,
        overflow: 'hidden',
        padding: `${PAD_V}px ${PAD_H}px`,
        height: innerH > 0 ? innerH * scale + PAD_V * 2 : undefined,
        // Light-mode vars so the lyrics are readable regardless of app theme
        ['--text' as any]: '#0f0f14',
        ['--text2' as any]: '#5c5c78',
        ['--text3' as any]: '#9898b4',
      }}
    >
      <div
        ref={innerRef}
        style={{
          position: 'relative',
          width: baseW || '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <LyricsView lyrics={lyrics} />
        {data && data.strokes.length > 0 && (
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            {data.strokes.map(s => (
              <path
                key={s.id}
                d={annotationPath(s.pts)}
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
