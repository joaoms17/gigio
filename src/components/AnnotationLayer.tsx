import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { supabase } from '../lib/supabase'
import styles from './AnnotationLayer.module.css'

export interface Stroke {
  id: string
  pts: number[]   // flat [x0,y0, x1,y1, ...]
  color: string
  width: number
}

interface Props {
  songId: string
  userId?: string
  tool: 'pen' | 'eraser'
  color: string
  strokeWidth: number
  clearTrigger: number
  disabled?: boolean   // when true, pointer-events:none so page can scroll
}

export interface AnnotationHandle {
  undo: () => void
}

export const ANN_STORAGE_KEY = (id: string) => `gigio_ann_v1_${id}`

export interface SavedAnnotations {
  w: number
  strokes: Stroke[]
}

export function loadAnnotations(songId: string): SavedAnnotations | null {
  try {
    const raw = localStorage.getItem(ANN_STORAGE_KEY(songId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { w: 0, strokes: parsed }
    return parsed
  } catch { return null }
}

export async function pullAnnotations(songId: string, userId: string): Promise<SavedAnnotations | null> {
  try {
    const { data, error } = await supabase
      .from('song_annotations')
      .select('strokes, updated_at')
      .eq('song_id', songId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data?.strokes) return null
    const payload = data.strokes
    if (Array.isArray(payload)) return { w: 0, strokes: payload }
    return payload as SavedAnnotations
  } catch { return null }
}

export async function pushAnnotations(songId: string, userId: string, payload: SavedAnnotations) {
  try {
    await supabase.from('song_annotations').upsert(
      { song_id: songId, user_id: userId, strokes: payload, updated_at: new Date().toISOString() },
      { onConflict: 'song_id,user_id' }
    )
  } catch {}
}

export function annotationPath(pts: number[]): string {
  return smoothPath(pts)
}

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

const AnnotationLayer = forwardRef<AnnotationHandle, Props>(function AnnotationLayer(
  { songId, userId, tool, color, strokeWidth, clearTrigger, disabled = false },
  ref
) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [current, setCurrent] = useState<Stroke | null>(null)
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null)
  const [svgW, setSvgW] = useState(0)
  const [svgH, setSvgH] = useState(0)
  const drawingRef = useRef(false)
  const currentRef = useRef<Stroke | null>(null)
  const prevClearRef = useRef(clearTrigger)

  const loadedRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyRef = useRef<Stroke[][]>([])  // undo snapshots

  useImperativeHandle(ref, () => ({
    undo() {
      if (historyRef.current.length === 0) return
      const prev = historyRef.current[historyRef.current.length - 1]
      historyRef.current = historyRef.current.slice(0, -1)
      setStrokes(prev)
    }
  }))

  useEffect(() => {
    loadedRef.current = false
    const local = loadAnnotations(songId)
    setStrokes(local?.strokes ?? [])
    historyRef.current = []
    loadedRef.current = true
    if (userId) {
      pullAnnotations(songId, userId).then(remote => {
        if (!remote) return
        const localNow = loadAnnotations(songId)
        if (!localNow || localNow.strokes.length === 0) {
          setStrokes(remote.strokes)
          historyRef.current = []
          try { localStorage.setItem(ANN_STORAGE_KEY(songId), JSON.stringify(remote)) } catch {}
        }
      })
    }
  }, [songId, userId])

  useEffect(() => {
    if (!loadedRef.current) return
    const w = layerRef.current?.offsetWidth ?? svgW
    const payload: SavedAnnotations = { w, strokes }
    try { localStorage.setItem(ANN_STORAGE_KEY(songId), JSON.stringify(payload)) } catch {}
    if (userId) {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
      pushTimerRef.current = setTimeout(() => pushAnnotations(songId, userId, payload), 1500)
    }
  }, [strokes, songId, userId])

  useEffect(() => {
    if (clearTrigger !== prevClearRef.current) {
      prevClearRef.current = clearTrigger
      historyRef.current.push([...strokes])
      setStrokes([])
    }
  }, [clearTrigger])

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

    if (tool === 'eraser') {
      historyRef.current.push([...strokes])
      return
    }

    const stroke: Stroke = { id: crypto.randomUUID(), pts: [x, y], color, width: strokeWidth }
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

    const finished = currentRef.current
    currentRef.current = null
    setCurrent(null)

    if (tool !== 'eraser' && finished && finished.pts.length >= 4) {
      historyRef.current.push([...strokes])
      setStrokes(prev => [...prev, finished])
    }
  }

  return (
    <div ref={layerRef} className={styles.layer} style={disabled ? { pointerEvents: 'none' } : {}}>
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
            <path key={s.id} d={smoothPath(s.pts)}
              stroke={s.color} strokeWidth={s.width}
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {current && current.pts.length >= 4 && (
            <path d={smoothPath(current.pts)}
              stroke={current.color} strokeWidth={current.width}
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {tool === 'eraser' && eraserPos && (
            <circle cx={eraserPos.x} cy={eraserPos.y} r={ERASER_RADIUS}
              fill="none" stroke="var(--text3)" strokeWidth={1.5} strokeDasharray="4 3" />
          )}
        </svg>
      )}
    </div>
  )
})

export default AnnotationLayer
