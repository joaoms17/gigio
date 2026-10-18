import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import LyricsView from './LyricsView'
import { supabase } from '../lib/supabase'
import {
  anchorLegacy, anchorStroke, buildPayload, collectLines, isLayoutEmpty, pathFromSubpaths,
  payloadHasStrokes, readPayload, rebaseStrokes, resolveAll, smoothPath, strokesAt, toLegacyStrokes,
  type AnchoredStroke, type AnnPayload, type ParsedPayload,
} from '../lib/annotations/anchor'
import { measureLayout, watchFonts, whenFontsReady, type MeasuredLayout } from '../lib/annotations/measure'
import { REHEARSAL_LINE_HEIGHT, loadRehearsalFont, rehearsalFontCandidates } from '../lib/rehearsalFont'
import styles from './AnnotationLayer.module.css'

/** Traço em curso, em px da camada — só existe entre o pointerdown e o pointerup */
interface DraftStroke {
  pts: number[]   // [x0,y0, x1,y1, ...]
  color: string
  width: number
}

interface Props {
  /** Carrega uma vez por montagem: quem usa dá key={songId} */
  songId: string
  userId?: string
  /** A letra que o LyricsView por baixo mostra — os traços ancoram-se às suas linhas */
  lyrics: string
  /** Tamanho da letra (A−/A+): ao mudar, re-mede antes de pintar */
  fontSize?: number
  tool: 'pen' | 'eraser'
  color: string
  strokeWidth: number
  disabled?: boolean   // when true, pointer-events:none so page can scroll
  /**
   * Bloco da letra (o elemento que envolve o LyricsView). Os traços ficam
   * presos aos caracteres que lá estão; os px antigos {w, h} medem-se nele.
   * Sem ele usa-se o pai da camada.
   */
  contentRef?: { current: HTMLElement | null }
}

export interface AnnotationHandle {
  undo: () => void
  /** Limpar: apaga tudo (também os traços escondidos); Desfazer recupera */
  clear: () => void
}

export const ANN_STORAGE_KEY = (id: string) => `gigio_ann_v1_${id}`

/** Payload guardado neste dispositivo (qualquer versão), já lido — null se não há */
export function loadAnnotations(songId: string): ParsedPayload | null {
  try {
    const raw = localStorage.getItem(ANN_STORAGE_KEY(songId))
    return raw ? readPayload(JSON.parse(raw)) : null
  } catch { return null }
}

export async function pullAnnotations(songId: string, userId: string): Promise<ParsedPayload | null> {
  try {
    const { data, error } = await supabase
      .from('song_annotations')
      .select('strokes, updated_at')
      .eq('song_id', songId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data?.strokes) return null
    return readPayload(data.strokes)
  } catch { return null }
}

export async function pushAnnotations(
  songId: string,
  userId: string,
  payload: AnnPayload,
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

const ERASER_RADIUS = 18

/* O que a próxima gravação faz: nada, só este dispositivo, ou também a cloud */
const SAVE_NONE = 0
const SAVE_LOCAL = 1
const SAVE_ALL = 2

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

function freshId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  // randomUUID só existe a partir do Safari 15.4
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** Ids repetidos (cópias antigas partidas em vários traços) estragavam a borracha e as keys */
function uniqueIds(list: AnchoredStroke[]): AnchoredStroke[] {
  const seen = new Set<string>()
  return list.map(s => {
    if (!seen.has(s.id)) {
      seen.add(s.id)
      return s
    }
    const id = freshId()
    seen.add(id)
    return { ...s, id }
  })
}

/**
 * Tamanho do Ensaio cuja altura do bloco mais se aproxima de `h`. Primeiro o
 * atual (o caso normal); senão pesquisa binária — a altura cresce com o
 * tamanho da letra. Mexe só no LyricsView escondido da referência.
 */
function bestRehearsalSize(box: HTMLElement, root: HTMLElement, h: number, current: number): number {
  const heightAt = (s: number) => {
    root.style.setProperty('--lyric-size', `${s}px`)
    return box.getBoundingClientRect().height
  }
  let best = current
  let bestD = Math.abs(heightAt(current) - h)
  if (bestD <= 1) return best
  const list = rehearsalFontCandidates(current)
  let lo = 0
  let hi = list.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (heightAt(list[mid]) >= h) hi = mid
    else lo = mid + 1
  }
  for (const k of [lo - 1, lo]) {
    if (k < 0) continue
    const d = Math.abs(heightAt(list[k]) - h)
    // Empate (meio px) → fica o anterior: o atual foi o primeiro
    if (d < bestD - 0.5) {
      bestD = d
      best = list[k]
    }
  }
  return best
}

/**
 * Layout de referência para traços antigos (px do Ensaio, sem âncoras): um
 * LyricsView com as definições do Ensaio (tamanho guardado, entrelinha 1.6)
 * e a largura guardada (w), fora do ecrã e fora do fluxo. Com a altura
 * guardada (h) escolhe o tamanho do Ensaio que a reproduz. Ancora os traços
 * contra ele e entrega-os em onReady, com a letra usada — quem usa
 * desmonta-o logo a seguir. Não grava nada.
 */
export function LegacyReference({ payload, lyrics, width, onReady }: {
  payload: ParsedPayload
  lyrics: string
  width: number
  onReady: (strokes: AnchoredStroke[], lyrics: string) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size] = useState(loadRehearsalFont)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    // Força o layout já: as fontes que o texto usa começam a carregar e o
    // estado de document.fonts passa a contar com elas
    box.getBoundingClientRect()
    return whenFontsReady(() => {
      const root = box.firstElementChild as HTMLElement | null
      const h = payload.h
      if (h && h > 0 && root) root.style.setProperty('--lyric-size', `${bestRehearsalSize(box, root, h, size)}px`)
      const L = measureLayout(box, box)
      onReady(L && !isLayoutEmpty(L) ? anchorLegacy(payload, L, L.width, L.height) : [], lyrics)
    })
  }, [payload, lyrics, size, onReady])

  return createPortal(
    <div
      aria-hidden="true"
      style={{ position: 'fixed', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div
        ref={boxRef}
        style={{ position: 'absolute', left: 0, top: 0, width, visibility: 'hidden', pointerEvents: 'none' }}
      >
        <LyricsView lyrics={lyrics} fontSize={size} lineHeight={REHEARSAL_LINE_HEIGHT} />
      </div>
    </div>,
    document.body,
  )
}

interface Initial {
  strokes: AnchoredStroke[]
  /** Payload antigo (px, sem âncoras) à espera do DOM e das fontes para ser ancorado */
  legacy: ParsedPayload | null
  save: number
}

/** O que está guardado neste dispositivo, já na numeração da letra atual */
function initialLoad(songId: string, lyrics: string): Initial {
  const p = loadAnnotations(songId)
  if (!p) return { strokes: [], legacy: null, save: SAVE_NONE }
  if (p.anchored) {
    const r = rebaseStrokes(p.anchored, p.lines, lyrics)
    // Letra editada desde que se gravou: grava já a nova numeração
    return { strokes: uniqueIds(r.strokes), legacy: null, save: r.changed ? SAVE_ALL : SAVE_NONE }
  }
  return { strokes: [], legacy: payloadHasStrokes(p) ? p : null, save: SAVE_NONE }
}

/**
 * Camada de desenho do Ensaio. O estado canónico é a lista de traços
 * ANCORADOS ao texto (src/lib/annotations/anchor.ts): cada ponto preso a um
 * carácter de uma linha da letra. Desenha-se sempre a partir dela, resolvida
 * contra a medição atual do LyricsView — A+/A−, rotação, resize e letra
 * editada só re-medem e re-resolvem; nada é re-escalado por rácios.
 */
const AnnotationLayer = forwardRef<AnnotationHandle, Props>(function AnnotationLayer(
  { songId, userId, lyrics, fontSize, tool, color, strokeWidth, disabled = false, contentRef },
  ref
) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [init] = useState(() => initialLoad(songId, lyrics))
  const [strokes, setStrokes] = useState<AnchoredStroke[]>(init.strokes)
  const [layout, setLayout] = useState<MeasuredLayout | null>(null)
  const [current, setCurrent] = useState<DraftStroke | null>(null)
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null)
  const [svgW, setSvgW] = useState(0)
  const [svgH, setSvgH] = useState(0)
  const drawingRef = useRef(false)
  const currentRef = useRef<DraftStroke | null>(null)
  const activePointerRef = useRef<number | null>(null)

  // Espelhos do estado para os handlers e efeitos (sempre o mais recente)
  const strokesRef = useRef<AnchoredStroke[]>(init.strokes)
  const layoutRef = useRef<MeasuredLayout | null>(null)
  // Letra a que os traços (e os snapshots de Desfazer) estão numerados
  const lyricsRef = useRef(lyrics)
  const saveRef = useRef(init.save)
  // O utilizador já mexeu nesta montagem — o remoto já não se sobrepõe
  const touchedRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Payload à espera do debounce — para flush em pagehide/visibilitychange
  const pendingPushRef = useRef<AnnPayload | null>(null)
  const historyRef = useRef<AnchoredStroke[][]>([])  // undo snapshots (listas ancoradas)
  // Borracha: o snapshot de Desfazer só entra quando o gesto apaga alguma coisa
  const eraseSnapRef = useRef(false)
  // Pan com 2 dedos: posições dos pointers ativos + estado do gesto de scroll
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const panRef = useRef<{ el: HTMLElement | null; lastY: number } | null>(null)

  /**
   * Mede o LyricsView agora. Mesma geometria que a medição anterior → fica a
   * anterior (os caches dela continuam válidos e nada se redesenha).
   */
  const measure = useCallback((): MeasuredLayout | null => {
    const layer = layerRef.current
    if (!layer) return layoutRef.current
    const next = measureLayout(contentRef?.current ?? layer.parentElement, layer)
    const prev = layoutRef.current
    if (!next || (prev && prev.sig === next.sig)) return prev ?? next
    layoutRef.current = next
    setLayout(next)
    return next
  }, [contentRef])

  const commit = useCallback((next: AnchoredStroke[], save: number) => {
    strokesRef.current = next
    saveRef.current = Math.max(saveRef.current, save)
    setStrokes(next)
  }, [])

  /** Alteração feita pelo utilizador: snapshot para Desfazer + grava (local e cloud) */
  const edit = useCallback((next: AnchoredStroke[]) => {
    historyRef.current.push(strokesRef.current)
    touchedRef.current = true
    commit(next, SAVE_ALL)
  }, [commit])

  /** Traços antigos já ancorados: passam a v2 e gravam-se */
  const finishLegacy = useCallback((list: AnchoredStroke[], save: number) => {
    // Sem texto onde ancorar não se toca em nada: o payload antigo fica como está
    if (!list.length) return
    historyRef.current = []
    // Desenhado entretanto (as fontes demoraram): junta, não substitui
    commit(uniqueIds(touchedRef.current ? [...list, ...strokesRef.current] : list), save)
  }, [commit])

  // Migração à espera do layout de referência (ver adoptLegacy)
  const [legacyJob, setLegacyJob] = useState<{ payload: ParsedPayload; save: number; width: number } | null>(null)

  /**
   * Traços antigos (px do Ensaio, sem âncoras). Guardados neste mesmo layout
   * ({w, h} = o bloco agora): adotar como antes e ancorar logo contra o DOM.
   * Guardados com outro tamanho de letra ou outra largura — o tamanho é
   * global (A± noutra música), rodar o iPad, outro aparelho — re-escalar
   * por rácios punha os sublinhados a riscar o texto: ancoram-se contra o
   * layout de referência (LegacyReference), como no concerto.
   */
  const adoptLegacy = useCallback((p: ParsedPayload, save: number) => {
    const L = measure()
    if (!L || isLayoutEmpty(L)) return
    const same = p.w > 0 && Math.abs(L.width - p.w) <= 1 && (!p.h || Math.abs(L.height - p.h) <= 1)
    if (same) finishLegacy(anchorLegacy(p, L, L.width, L.height), save)
    else setLegacyJob({ payload: p, save, width: p.w > 0 ? p.w : L.width })
  }, [measure, finishLegacy])

  const onLegacyReady = useCallback((list: AnchoredStroke[], usedLyrics: string) => {
    setLegacyJob(null)
    if (!legacyJob) return
    // A letra mudou enquanto a referência media: passa para a numeração atual
    const now = lyricsRef.current
    const out = usedLyrics === now ? list : rebaseStrokes(list, collectLines(list, usedLyrics), now).strokes
    finishLegacy(out, legacyJob.save)
  }, [legacyJob, finishLegacy])

  useImperativeHandle(ref, () => ({
    undo() {
      const h = historyRef.current
      if (h.length === 0) return
      const prev = h[h.length - 1]
      historyRef.current = h.slice(0, -1)
      touchedRef.current = true
      commit(prev, SAVE_ALL)
    },
    clear() {
      edit([])
    },
  }), [commit, edit])

  // Letra mudou (re-numerar os traços e os snapshots) e/ou A+/A− (o texto
  // re-fluiu): re-mede antes de pintar — os traços nunca aparecem um frame
  // fora do sítio
  useLayoutEffect(() => {
    const prev = lyricsRef.current
    if (prev !== lyrics) {
      lyricsRef.current = lyrics
      const rebase = (list: AnchoredStroke[]) => rebaseStrokes(list, collectLines(list, prev), lyrics)
      historyRef.current = historyRef.current.map(snap => rebase(snap).strokes)
      const r = rebase(strokesRef.current)
      if (r.changed) commit(r.strokes, SAVE_ALL)
    }
    measure()
  }, [lyrics, fontSize, measure, commit])

  // Payload antigo neste dispositivo: ancora quando as fontes estiverem
  // prontas (medido com a fonte de recurso, o texto tinha outra largura)
  useEffect(() => {
    const legacy = init.legacy
    if (!legacy) return
    return whenFontsReady(() => adoptLegacy(legacy, SAVE_ALL))
  }, [init, adoptLegacy])

  // Cloud: o local ganha — o remoto só entra se aqui não há nada (nem foi
  // desenhado entretanto)
  useEffect(() => {
    if (!userId) return
    let alive = true
    let cancelFonts = () => {}
    pullAnnotations(songId, userId).then(remote => {
      if (!alive || !remote || !payloadHasStrokes(remote)) return
      if (touchedRef.current || strokesRef.current.length > 0 || payloadHasStrokes(loadAnnotations(songId))) return
      if (remote.anchored) {
        const r = rebaseStrokes(remote.anchored, remote.lines, lyricsRef.current)
        historyRef.current = []
        // Re-numerado (letra editada noutro lado) → devolve-se à cloud também
        commit(uniqueIds(r.strokes), r.changed ? SAVE_ALL : SAVE_LOCAL)
      } else {
        cancelFonts = whenFontsReady(() => adoptLegacy(remote, SAVE_ALL))
      }
    })
    return () => {
      alive = false
      cancelFonts()
    }
  }, [songId, userId, commit, adoptLegacy])

  // Gravar: v2 ancorado + a cópia antiga em px do Ensaio ({w, h, strokes}),
  // para os clientes antigos (PWA em cache) continuarem a ver alguma coisa
  useEffect(() => {
    const mode = saveRef.current
    if (mode === SAVE_NONE) return
    // Um efeito anterior deste mesmo flush (migração, cloud) já fez outro
    // commit que ainda não chegou ao render: grava-se quando chegar — senão
    // gravava-se a lista antiga (ex.: vazia) por cima dos traços migrados
    if (strokes !== strokesRef.current) return
    saveRef.current = SAVE_NONE
    const L = layoutRef.current
    const payload = buildPayload({
      w: L ? L.width : 0,
      h: L ? L.height : 0,
      strokes: L ? toLegacyStrokes(resolveAll(strokes, L)) : [],
      em: L ? L.em : NaN,
      anchored: strokes,
      lyrics: lyricsRef.current,
    })
    try { localStorage.setItem(ANN_STORAGE_KEY(songId), JSON.stringify(payload)) } catch { /* storage cheio/bloqueado */ }
    if (mode === SAVE_ALL && userId) {
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

  // Rotação, resize, barra de scroll: re-mede uma vez por frame. Os traços
  // só se redesenham se a geometria do texto mudou de facto (sig) — redesenhar
  // não muda o tamanho de nada observado, por isso não há ciclo
  useEffect(() => {
    const el = layerRef.current
    if (!el) return
    const basisEl = contentRef?.current ?? el
    let raf = 0
    const obs = new ResizeObserver(entries => {
      for (const en of entries) {
        // The svg canvas always spans the layer itself
        if (en.target === el) {
          setSvgW(en.contentRect.width)
          setSvgH(en.contentRect.height)
        }
      }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure() })
    })
    obs.observe(el)
    if (basisEl !== el) obs.observe(basisEl)
    return () => {
      obs.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [contentRef, measure])

  // Fontes carregadas: o texto muda de largura sem o bloco mudar de tamanho
  useEffect(() => watchFonts(() => { measure() }), [measure])

  // Caminhos resolvidos no layout atual (cache por traço e por layout em anchor.ts)
  const paths = useMemo(() => {
    if (!layout) return []
    return resolveAll(strokes, layout)
      .filter(s => !s.hidden)
      .map(s => ({ id: s.id, color: s.color, width: s.width, d: pathFromSubpaths(s.subpaths) }))
  }, [strokes, layout])

  const getXY = useCallback((e: React.PointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  /** Borracha: apaga (por id) os traços cujo desenho atual passa no círculo */
  function eraseAt(x: number, y: number) {
    const L = layoutRef.current
    if (!L) return
    const ids = strokesAt(resolveAll(strokesRef.current, L), x, y, ERASER_RADIUS)
    if (!ids.length) return
    const next = strokesRef.current.filter(s => ids.indexOf(s.id) < 0)
    if (!eraseSnapRef.current) {
      eraseSnapRef.current = true
      edit(next)
    } else {
      touchedRef.current = true
      commit(next, SAVE_ALL)
    }
  }

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
      eraseSnapRef.current = false
      setEraserPos({ x, y })
      eraseAt(x, y)
      return
    }

    const stroke: DraftStroke = { pts: [x, y], color, width: strokeWidth }
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
      if (drawingRef.current) eraseAt(x, y)
      return
    }

    if (!drawingRef.current || !currentRef.current) return
    const next = { ...currentRef.current, pts: [...currentRef.current.pts, x, y] }
    currentRef.current = next
    setCurrent(next)
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
      // Ancora contra o DOM de agora (o que o músico viu ao desenhar)
      const L = measure()
      const a = L ? anchorStroke(finished.pts, finished.color, finished.width, L) : null
      // Sem texto onde ancorar ("Sem letra"), o traço não se guarda
      if (a) edit([...strokesRef.current, a])
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
          {paths.map(s => (
            <path key={s.id} d={s.d}
              stroke={s.color} strokeWidth={s.width}
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {current && current.pts.length >= 4 && (
            <path d={smoothPath(current.pts)}
              stroke={current.color} strokeWidth={current.width}
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {tool === 'eraser' && eraserPos && (
            <g className={styles.eraser} aria-hidden="true">
              <circle className={styles.eraserRing} cx={eraserPos.x} cy={eraserPos.y} r={ERASER_RADIUS} />
              <path
                className={styles.eraserCross}
                d={`M ${eraserPos.x - 4} ${eraserPos.y} H ${eraserPos.x + 4} M ${eraserPos.x} ${eraserPos.y - 4} V ${eraserPos.y + 4}`}
              />
            </g>
          )}
        </svg>
      )}
      {legacyJob && (
        <LegacyReference payload={legacyJob.payload} lyrics={lyrics} width={legacyJob.width} onReady={onLegacyReady} />
      )}
    </div>
  )
})

export default AnnotationLayer
