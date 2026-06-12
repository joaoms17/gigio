import { useEffect, useRef, useState, useCallback } from 'react'
import styles from './AnnotationLayer.module.css'

interface Stroke {
  id: string
  pts: number[]   // flat [x0,y0, x1,y1, ...]
  color: string
  width: number
}

interface Props {
  songId: string
  tool: 'pen' | 'eraser'
  color: string
  strokeWidth: number
  clearTrigger: number   // increment to trigger clear
}

const STORAGE_KEY = (id: string) => `gigio_ann_v1_${id}`
const ERASER_RADIUS = 18

function smoothPath(pts: number[]): string {
  const n = pts.length / 2
  if (n < 1) return ''
  if (n === 1) return `M ${pts[0]} ${pts[1]}`
  if (n === 2) return `M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]}`

  let d = `M ${pts[0]} ${pts[1]}`
  const m0x = (pts[0] + pts[2]) / 2
  const m0y = (pts[1] + pts[3]) / 2
  d += ` L ${m0x} ${m0y}`
  for (let i = 1; i < n - 1; i++) {
    const cx = pts[i * 2], cy = pts[i * 2 + 1]
    const mx = (pts[i * 2] + pts[(i + 1) * 2]) / 2
    const my = (pts[i * 2 + 1] + pts[(i + 1) * 2 + 1]) / 2
    d += ` Q ${cx} ${cy} ${mx} ${my}`
  }
  d += ` L ${pts[(n - 1) * 2]} ${pts[(n - 1) * 2 + 1]}`
  return d
}

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
}

export default function AnnotationLayer({ songId, tool, color, strokeWidth, clearTrigger }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [current, setCurrent] = useState<Stroke | null>(null)
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null)
  const [svgW, setSvgW] = useState(0)
  const [svgH, setSvgH] = useState(0)
  const drawingRef = useRef(false)
  const currentRef = useRef<Stroke | null>(null)
  const prevClearRef = useRef(clearTrigger)

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY(songId))
      if (saved) setStrokes(JSON.parse(saved))
      else setStrokes([])
    } catch { setStrokes([]) }
  }, [songId])

  // Save to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY(songId), JSON.stringify(strokes)) } catch {}
  }, [strokes, songId])

  // Clear trigger
  useEffect(() => {
    if (clearTrigger !== prevClearRef.current) {
      prevClearRef.current = clearTrigger
      setStrokes([])
    }
  }, [clearTrigger])

  // Observe size for SVG viewBox
  useEffect(() => {
    const el = layerRef.current
    if (!el) return
    const obs = new ResizeObserver(e => {
      setSvgW(e[0].contentRect.width)
      setSvgH(e[0].contentRect.height)
    })
    obs.observe(el)
    setSvgW(el.offsetWidth)
    setSvgH(el.offsetHeight)
    return () => obs.disconnect()
  }, [])

  const getXY = useCallback((e: React.PointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = getXY(e)
    drawingRef.current = true

    if (tool === 'eraser') return

    const stroke: Stroke = {
      id: crypto.randomUUID(),
      pts: [x, y],
      color,
      width: strokeWidth,
    }
    currentRef.current = stroke
    setCurrent(stroke)
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const { x, y } = getXY(e)

    if (tool === 'eraser') {
      setEraserPos({ x, y })
      if (!drawingRef.current) return
      setStrokes(prev => prev.filter(s => {
        for (let i = 0; i < s.pts.length - 1; i += 2) {
          if (dist(s.pts[i], s.pts[i + 1], x, y) < ERASER_RADIUS) return false
        }
        return true
      }))
      return
    }

    if (!drawingRef.current || !currentRef.current) return
    const next = { ...currentRef.current, pts: [...currentRef.current.pts, x, y] }
    currentRef.current = next
    setCurrent({ ...next })
  }

  function onPointerUp(_e: React.PointerEvent<SVGSVGElement>) {
    if (!drawingRef.current) return
    drawingRef.current = false
    setEraserPos(null)

    if (tool !== 'eraser' && currentRef.current && currentRef.current.pts.length >= 4) {
      setStrokes(prev => [...prev, currentRef.current!])
    }
    currentRef.current = null
    setCurrent(null)
  }

  return (
    <div ref={layerRef} className={styles.layer}>
      {svgW > 0 && (
        <svg
          className={styles.svg}
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          style={{ cursor: tool === 'eraser' ? 'none' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {strokes.map(s => (
            <path
              key={s.id}
              d={smoothPath(s.pts)}
              stroke={s.color}
              strokeWidth={s.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {current && current.pts.length >= 4 && (
            <path
              d={smoothPath(current.pts)}
              stroke={current.color}
              strokeWidth={current.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {tool === 'eraser' && eraserPos && (
            <circle
              cx={eraserPos.x}
              cy={eraserPos.y}
              r={ERASER_RADIUS}
              fill="none"
              stroke="var(--text3)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}
        </svg>
      )}
    </div>
  )
}
