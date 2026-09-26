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
  /**
   * Element whose size is the coordinate basis for the strokes (the lyrics
   * block). Its height tracks the text (font size changes, rewraps) instead
   * of the pane's min-height. Falls back to the layer element itself.
   */
  contentRef?: { current: HTMLElement | null }
}

export interface AnnotationHandle {
  undo: () => void
}

export const ANN_STORAGE_KEY = (id: string) => `gigio_ann_v1_${id}`

export interface SavedAnnotations {
  w: number
  /** Content height at draw time — optional: older payloads only stored `w`. */
  h?: number
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

export async function pushAnnotations(
  songId: string,
  userId: string,
  payload: SavedAnnotations,
  retry = true
) {
  try {
    const { error } = await supabase.from('song_annotations').upsert(
      { song_id: songId, user_id: userId, strokes: payload, updated_at: new Date().toISOString() },
      { onConflict: 'song_id,user_id' }
    )
    if (error) throw error
  } catch {
    // Rede fraca em palco: uma retentativa única após 2s em vez de falhar em silêncio
    if (retry) setTimeout(() => pushAnnotations(songId, userId, payload, false), 2000)
  }
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

/** Nearest scrollable ancestor — the pane the two-finger pan should move. */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/** Scale stroke coordinates by independent X/Y ratios. */
function scaleStrokes(strokes: Stroke[], kx: number, ky: number): Stroke[] {
  if (!isFinite(kx) || !isFinite(ky) || kx <= 0 || ky <= 0 || (kx === 1 && ky === 1)) return strokes
  return strokes.map(s => ({ ...s, pts: s.pts.map((p, i) => p * (i % 2 === 0 ? kx : ky)) }))
}

/**
 * Ratios to map coordinates saved at (fromW, fromH) onto (toW, toH).
 * Legacy payloads have no height — Y then follows the width ratio, as before.
 */
function scaleRatios(fromW: number, fromH: number | undefined, toW: number, toH: number) {
  const kx = fromW > 0 && toW > 0 ? toW / fromW : 1
  const ky = fromH && fromH > 0 && toH > 0 ? toH / fromH : kx
  return { kx, ky }
}

const AnnotationLayer = forwardRef<AnnotationHandle, Props>(function AnnotationLayer(
  { songId, userId, tool, color, strokeWidth, clearTrigger, disabled = false, contentRef },
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
  const activePointerRef = useRef<number | null>(null)
  const prevClearRef = useRef(clearTrigger)
  // Dimensions the current stroke coordinates are expressed in (for
  // rotation/resize/font-size rescaling): content width and content height
  const strokesWRef = useRef(0)
  const strokesHRef = useRef(0)

  const loadedRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Payload à espera do debounce — para flush em pagehide/visibilitychange
  const pendingPushRef = useRef<SavedAnnotations | null>(null)
  const historyRef = useRef<Stroke[][]>([])  // undo snapshots
  // Pan com 2 dedos: posições dos pointers ativos + estado do gesto de scroll
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const panRef = useRef<{ el: HTMLElement | null; lastY: number } | null>(null)

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
    // Strokes are saved with the content size (w, h) they were drawn at —
    // rescale X by the width ratio and Y by the height ratio so rotation,
    // resizes and font-size changes keep them aligned with the text
    const adopt = (payload: SavedAnnotations | null) => {
      const basisEl = contentRef?.current ?? layerRef.current
      const curW = basisEl?.offsetWidth ?? 0
      const curH = basisEl?.offsetHeight ?? 0
      const { kx, ky } = scaleRatios(payload?.w ?? 0, payload?.h, curW, curH)
      setStrokes(scaleStrokes(payload?.strokes ?? [], kx, ky))
      strokesWRef.current = curW || payload?.w || 0
      strokesHRef.current = curH || (payload?.h ? payload.h * ky : 0)
      historyRef.current = []
    }
    adopt(loadAnnotations(songId))
    loadedRef.current = true
    if (userId) {
      pullAnnotations(songId, userId).then(remote => {
        if (!remote) return
        const localNow = loadAnnotations(songId)
        if (!localNow || localNow.strokes.length === 0) {
          adopt(remote)
          try { localStorage.setItem(ANN_STORAGE_KEY(songId), JSON.stringify(remote)) } catch {}
        }
      })
    }
  }, [songId, userId])

  useEffect(() => {
    if (!loadedRef.current) return
    // Save with the dimensions the coordinates are expressed in, not whatever
    // the layout happens to measure mid-rotation
    const basisEl = contentRef?.current ?? layerRef.current
    const w = strokesWRef.current || basisEl?.offsetWidth || svgW
    const h = strokesHRef.current || basisEl?.offsetHeight || 0
    const payload: SavedAnnotations = { w, h, strokes }
    try { localStorage.setItem(ANN_STORAGE_KEY(songId), JSON.stringify(payload)) } catch {}
    if (userId) {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
      pendingPushRef.current = payload
      pushTimerRef.current = setTimeout(() => {
        pushTimerRef.current = null
        pendingPushRef.current = null
        pushAnnotations(songId, userId, payload)
      }, 1500)
    }
  }, [strokes, songId, userId])

  // Flush do debounce ao fechar/esconder a página — as anotações têm de
  // chegar à cloud antes de o tablet ser fechado no fim do ensaio
  useEffect(() => {
    if (!userId) return
    const flush = () => {
      if (!pushTimerRef.current || !pendingPushRef.current) return
      clearTimeout(pushTimerRef.current)
      pushTimerRef.current = null
      const payload = pendingPushRef.current
      pendingPushRef.current = null
      pushAnnotations(songId, userId, payload)
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      // Navegação interna (unmount): não deixar o push pendente perder-se
      flush()
    }
  }, [songId, userId])

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
    const basisEl = contentRef?.current ?? el

    // Rotation/resize/font-size change: rescale existing strokes from the
    // basis they are expressed in to the new content size (X by the width
    // ratio, Y by the height ratio)
    const rescale = (newW: number, newH: number) => {
      const fromW = strokesWRef.current
      const fromH = strokesHRef.current
      // First real measurement: adopt it as the basis, points stay as-is
      if (fromW === 0 && newW > 0) strokesWRef.current = newW
      if (fromH === 0 && newH > 0) strokesHRef.current = newH
      if (fromW <= 0 || newW <= 0) return
      const wChanged = Math.abs(newW - fromW) > 1
      const hChanged = fromH > 0 && newH > 0 && Math.abs(newH - fromH) > 1
      if (!wChanged && !hChanged) return
      const { kx, ky } = scaleRatios(fromW, fromH, newW, newH)
      strokesWRef.current = newW
      strokesHRef.current = newH > 0 ? newH : fromH > 0 ? fromH * ky : 0
      setStrokes(prev => scaleStrokes(prev, kx, ky))
      historyRef.current = historyRef.current.map(snap => scaleStrokes(snap, kx, ky))
    }

    const obs = new ResizeObserver(entries => {
      for (const en of entries) {
        // The svg canvas always spans the layer itself
        if (en.target === el) {
          setSvgW(en.contentRect.width)
          setSvgH(en.contentRect.height)
        }
        if (en.target === basisEl) {
          rescale(en.contentRect.width, en.contentRect.height)
        }
      }
    })
    obs.observe(el)
    if (basisEl !== el) obs.observe(basisEl)
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
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)

    // Segundo dedo: touch-action:none bloqueia o scroll nativo, por isso o
    // gesto de 2 dedos cancela o stroke em curso e passa a fazer pan manual
    if (pointersRef.current.size >= 2) {
      drawingRef.current = false
      currentRef.current = null
      setCurrent(null)
      setEraserPos(null)
      activePointerRef.current = null
      const ys = [...pointersRef.current.values()].map(p => p.y)
      panRef.current = {
        el: getScrollParent(layerRef.current),
        lastY: ys.reduce((a, b) => a + b, 0) / ys.length,
      }
      return
    }
    if (panRef.current) return

    // Palm rejection: follow only the first active pointer; ignore extra
    // simultaneous touches (resting palm, second finger) until it lifts
    if (activePointerRef.current !== null && activePointerRef.current !== e.pointerId) return
    activePointerRef.current = e.pointerId
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
    const tracked = pointersRef.current.get(e.pointerId)
    if (tracked) { tracked.x = e.clientX; tracked.y = e.clientY }

    // Pan de 2 dedos ativo: traduz o scrollTop do contentor e não desenha
    if (panRef.current && pointersRef.current.size >= 2) {
      const ys = [...pointersRef.current.values()].map(p => p.y)
      const avgY = ys.reduce((a, b) => a + b, 0) / ys.length
      const dy = avgY - panRef.current.lastY
      panRef.current.lastY = avgY
      if (panRef.current.el) panRef.current.el.scrollTop -= dy
      return
    }

    // While drawing, only the tracked pointer may contribute points
    if (drawingRef.current && activePointerRef.current !== null && e.pointerId !== activePointerRef.current) return
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

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(e.pointerId)

    // Fim (ou redução) do gesto de pan: sem 2 dedos deixa de haver scroll,
    // e o dedo restante não retoma o desenho (o stroke foi cancelado)
    if (panRef.current) {
      if (pointersRef.current.size < 2) panRef.current = null
      return
    }

    // A lifted palm/extra finger must not end the tracked stroke
    if (activePointerRef.current !== null && e.pointerId !== activePointerRef.current) return
    activePointerRef.current = null
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
    <div ref={layerRef} className={styles.layer}>
      {svgW > 0 && (
        <svg
          className={styles.svg}
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          style={{
            cursor: disabled ? 'default' : tool === 'eraser' ? 'none' : 'crosshair',
            pointerEvents: disabled ? 'none' : 'all',
            touchAction: disabled ? 'auto' : 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
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
