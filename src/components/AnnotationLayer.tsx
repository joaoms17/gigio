import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createPortal, flushSync } from 'react-dom'
import LyricsView, { type SectionMetrics } from './LyricsView'
import {
  HL_INK_EM, anchorFree, anchorHighlight, anchorLegacy, anchorStroke, buildPayload, classifyHighlight, collectLines,
  highlightRange, highlightsAt, isLayoutEmpty, marginGutter, mergeHighlights, payloadHasStrokes,
  rebaseStrokes, resolveAll, resolveHighlight, resolveHighlights, smoothPath, strokesAt, toLegacyStrokes, unionById,
  unionExtra,
  type AnchoredStroke, type AnnItem, type AnnPayload, type ParsedPayload,
} from '../lib/annotations/anchor'
import { measureLayout, watchFonts, whenFontsReady, type MeasuredLayout } from '../lib/annotations/measure'
import { buildView, highlightRadius, markerPaint, type MarkerShape } from '../lib/annotations/view'
import MarkerUnderlay from './MarkerUnderlay'
import {
  ANN_STORAGE_KEY, LEGACY_PULL_WAIT_MS, cachedLegacy, fetchAnnotations, legacyKey, loadAnnotations, pushAnnotations,
  rememberLegacy,
} from '../lib/annotations/storage'
import {
  LEGACY_NO_H_FONT, LEGACY_TABLET_MIN_W, REHEARSAL_LINE_HEIGHT, loadRehearsalFont, rehearsalFontCandidates,
} from '../lib/rehearsalFont'
import styles from './AnnotationLayer.module.css'

/** Traço em curso, em px da camada — só existe entre o pointerdown e o pointerup */
interface DraftStroke {
  pts: number[]   // [x0,y0, x1,y1, ...]
  color: string
  width: number
  /** Caneta, ou marcador (destaque de texto / traço livre — decide-se ao levantar) */
  kind: 'pen' | 'hl'
}

/** Ferramenta do Ensaio */
export type AnnTool = 'pen' | 'highlighter' | 'eraser'

interface Props {
  /** Carrega uma vez por montagem: quem usa dá key={songId} */
  songId: string
  userId?: string
  /** A letra que o LyricsView por baixo mostra — os traços ancoram-se às suas linhas */
  lyrics: string
  /** Tamanho da letra (A−/A+): ao mudar, re-mede antes de pintar */
  fontSize?: number
  tool: AnnTool
  /** Cor da ferramenta ativa (a caneta e o marcador têm paletas próprias) */
  color: string
  /** Espessura da caneta (px); o marcador tem a sua (HL_INK_EM) */
  strokeWidth: number
  disabled?: boolean   // when true, pointer-events:none so page can scroll
  /**
   * Bloco da letra (o elemento que envolve o LyricsView). Os traços ficam
   * presos aos caracteres que lá estão; os px antigos {w, h} medem-se nele.
   * Sem ele usa-se o pai da camada.
   */
  contentRef?: { current: HTMLElement | null }
  /** Calha lateral que o LyricsView tem agora (ver onGutter) — ao mudar, re-mede */
  gutter?: number
  /**
   * Calha lateral (px) que o texto deve deixar para não passar por baixo das
   * chavetas de margem empurradas para dentro do bloco (A+, rodar): quem usa
   * dá-a ao LyricsView (prop gutter) e devolve-a aqui
   */
  onGutter?: (px: number) => void
}

export interface AnnotationHandle {
  undo: () => void
  /** Limpar: apaga tudo (também os traços escondidos); Desfazer recupera */
  clear: () => void
}

const ERASER_RADIUS = 18
/** Nova tentativa de ler a cloud depois de uma falha (ms); a última repete-se */
const PULL_RETRY_MS = [3000, 8000, 20000, 45000, 60000]

/* O que a próxima gravação faz: nada, só este dispositivo, ou também a cloud */
const SAVE_NONE = 0
const SAVE_LOCAL = 1
const SAVE_ALL = 2

/**
 * O que este aparelho tinha guardado ao abrir:
 *  none   — nada (ou vazio): a cloud entra
 *  v2     — âncoras: o local ganha à cloud
 *  pend   — âncoras ainda por juntar à cloud (gravadas sem a conseguir ler)
 *  legacy — px antigos (cliente antigo): a v2 da cloud, se existir, é mais
 *           recente (um cliente antigo que gravasse depois tinha-a apagado)
 */
type LocalKind = 'none' | 'v2' | 'pend' | 'legacy'

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
function uniqueIds(list: AnnItem[]): AnnItem[] {
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

/* ═══ Traços antigos (px, sem âncoras): layout de referência ═══ */

/** Medidas dos rótulos que quem desenhou tinha, deduzidas da largura do bloco */
function legacyMetricsFor(width: number): SectionMetrics {
  return width >= LEGACY_TABLET_MIN_W ? 'tablet' : 'phone'
}

/**
 * Tamanho do Ensaio e medidas dos rótulos (telemóvel/tablet) que reproduzem
 * o bloco onde os traços antigos foram desenhados. Com a altura guardada (h):
 * o par cuja altura mais se aproxima de h — primeiro o tamanho atual com as
 * medidas deduzidas da largura (o caso normal), depois, para cada medida,
 * pesquisa binária nos tamanhos (a altura cresce com eles). Os rótulos têm
 * px fixos por media query: medidos no aparelho que VÊ (telemóvel) e não no
 * que desenhou (iPad), a altura de 3 rótulos falhava ~21px e escolhia-se 30px
 * para um desenho a 28px. Sem h: 32px (ver LEGACY_NO_H_FONT).
 * Mexe só no LyricsView escondido da referência.
 */
function fitLegacyReference(box: HTMLElement, root: HTMLElement, h: number | undefined, current: number, guess: SectionMetrics) {
  const set = (m: SectionMetrics, s: number) => {
    root.setAttribute('data-metrics', m)
    root.style.setProperty('--lyric-size', `${s}px`)
  }
  if (!(h && h > 0)) {
    set(guess, LEGACY_NO_H_FONT)
    return
  }
  const heightAt = (m: SectionMetrics, s: number) => {
    set(m, s)
    return box.getBoundingClientRect().height
  }
  let best = { m: guess, s: current, d: Math.abs(heightAt(guess, current) - h) }
  if (best.d > 1) {
    const list = rehearsalFontCandidates(current)
    const other: SectionMetrics = guess === 'tablet' ? 'phone' : 'tablet'
    for (const m of [guess, other]) {
      let lo = 0
      let hi = list.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (heightAt(m, list[mid]) >= h) hi = mid
        else lo = mid + 1
      }
      for (const k of [lo - 1, lo]) {
        if (k < 0) continue
        const d = Math.abs(heightAt(m, list[k]) - h)
        // Empate (meio px) → fica o que veio antes (o atual, as medidas deduzidas)
        if (d < best.d - 0.5) best = { m, s: list[k], d }
      }
    }
  }
  set(best.m, best.s)
}

/**
 * Layout de referência para traços antigos (px do Ensaio, sem âncoras): um
 * LyricsView com as definições do Ensaio onde foram desenhados — a largura
 * guardada (w), entrelinha 1.6, o tamanho e as medidas dos rótulos que dão a
 * altura guardada (fitLegacyReference) —, fora do ecrã e fora do fluxo.
 * Ancora os traços contra ele e entrega-os em onReady, com a letra usada —
 * quem usa desmonta-o logo a seguir. Não grava nada.
 */
export function LegacyReference({ payload, lyrics, width, onReady }: {
  payload: ParsedPayload
  lyrics: string
  width: number
  onReady: (strokes: AnchoredStroke[], lyrics: string) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size] = useState(loadRehearsalFont)
  const guess = legacyMetricsFor(width)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    // Força o layout já: as fontes que o texto usa começam a carregar e o
    // estado de document.fonts passa a contar com elas
    box.getBoundingClientRect()
    return whenFontsReady(() => {
      const root = box.firstElementChild as HTMLElement | null
      // Sem letra ("Sem letra") não há tamanho a acertar: os traços ficam livres
      if (root && root.querySelector('[data-ln]')) fitLegacyReference(box, root, payload.h, size, guess)
      const L = measureLayout(box, box)
      const out = L ? anchorLegacy(payload, L, L.width, L.height) : []
      rememberLegacy(legacyKey(payload, lyrics), out)
      onReady(out, lyrics)
    })
  }, [payload, lyrics, size, guess, onReady])

  return createPortal(
    <div
      aria-hidden="true"
      style={{ position: 'fixed', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div
        ref={boxRef}
        style={{ position: 'absolute', left: 0, top: 0, width, visibility: 'hidden', pointerEvents: 'none' }}
      >
        <LyricsView
          lyrics={lyrics}
          fontSize={payload.h ? size : LEGACY_NO_H_FONT}
          lineHeight={REHEARSAL_LINE_HEIGHT}
          metrics={guess}
        />
      </div>
    </div>,
    document.body,
  )
}

/* ═══ Camada de desenho do Ensaio ═══ */

interface Initial {
  strokes: AnnItem[]
  /** Entradas de uma versão futura (em bruto) — regravadas tal como vieram */
  extra: unknown[]
  /** Payload antigo (px, sem âncoras) à espera do DOM e das fontes para ser ancorado */
  legacy: ParsedPayload | null
  save: number
  kind: LocalKind
}

/** O que está guardado neste dispositivo, já na numeração da letra atual */
function initialLoad(songId: string, lyrics: string): Initial {
  const p = loadAnnotations(songId)
  if (!p) return { strokes: [], extra: [], legacy: null, save: SAVE_NONE, kind: 'none' }
  if (p.anchored) {
    const r = rebaseStrokes(p.anchored, p.lines, lyrics, p.hlLines)
    const has = r.strokes.length > 0 || p.extra.length > 0
    return {
      strokes: uniqueIds(r.strokes),
      extra: p.extra,
      legacy: null,
      // Letra editada desde que se gravou: grava já a nova numeração
      save: r.changed ? SAVE_ALL : SAVE_NONE,
      kind: p.pend ? 'pend' : has ? 'v2' : 'none',
    }
  }
  const has = payloadHasStrokes(p)
  return { strokes: [], extra: [], legacy: has ? p : null, save: SAVE_NONE, kind: has ? 'legacy' : 'none' }
}

/**
 * Camada de desenho do Ensaio. O estado canónico é a lista de traços
 * ANCORADOS ao texto (src/lib/annotations/anchor.ts): cada ponto preso a um
 * carácter de uma linha da letra. Desenha-se sempre a partir dela, resolvida
 * contra a medição atual do LyricsView — A+/A−, rotação, resize e letra
 * editada só re-medem e re-resolvem; nada é re-escalado por rácios.
 * Sem letra ("Sem letra") os traços ficam livres na folha (MODE_FREE).
 * Marcador: os destaques de texto e os traços livres de marcador entram na
 * mesma lista (e no mesmo Desfazer) e desenham-se por trás do texto
 * (MarkerUnderlay, irmã da camada): o PAI da camada tem de ser um contexto
 * de empilhamento (isolation: isolate) — no Ensaio, o .previewInner.
 *
 * Cloud: o local ganha, exceto (1) uma cópia antiga em px deste aparelho,
 * que perde para uma v2 da cloud (é mais velha), e (2) o que se desenhou
 * antes de a cloud ser lida (ou sem a conseguir ler): junta-se por id à
 * cópia da cloud quando ela chegar, e só então se envia — nunca se grava por
 * cima do que não se leu.
 */
const AnnotationLayer = forwardRef<AnnotationHandle, Props>(function AnnotationLayer(
  { songId, userId, lyrics, fontSize, tool, color, strokeWidth, disabled = false, contentRef, gutter = 0, onGutter },
  ref
) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [init] = useState(() => initialLoad(songId, lyrics))
  const [strokes, setStrokes] = useState<AnnItem[]>(init.strokes)
  const [layout, setLayout] = useState<MeasuredLayout | null>(null)
  const [current, setCurrent] = useState<DraftStroke | null>(null)
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null)
  const [svgW, setSvgW] = useState(0)
  const [svgH, setSvgH] = useState(0)
  const drawingRef = useRef(false)
  const currentRef = useRef<DraftStroke | null>(null)
  const activePointerRef = useRef<number | null>(null)

  // Espelhos do estado para os handlers e efeitos (sempre o mais recente)
  const strokesRef = useRef<AnnItem[]>(init.strokes)
  const extraRef = useRef<unknown[]>(init.extra)
  const layoutRef = useRef<MeasuredLayout | null>(null)
  // Letra a que os traços (e os snapshots de Desfazer) estão numerados
  const lyricsRef = useRef(lyrics)
  const saveRef = useRef(init.save)
  // O utilizador já mexeu nesta montagem
  const touchedRef = useRef(false)
  // Ids dos traços desenhados nesta montagem
  const addedRef = useRef<Set<string>>(new Set())
  // Sincronização com a cloud (ver LocalKind)
  const kindRef = useRef<LocalKind>(init.kind)
  const pullOkRef = useRef(false)
  const pendRef = useRef(init.kind === 'pend')
  // Cópia antiga deste aparelho à espera: null quando a cloud a substituiu
  const localLegacyRef = useRef<ParsedPayload | null>(init.legacy)
  const localMigratedRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Payload à espera do debounce — para flush em pagehide/visibilitychange
  const pendingPushRef = useRef<AnnPayload | null>(null)
  const historyRef = useRef<AnnItem[][]>([])  // undo snapshots (listas ancoradas); um gesto = um passo
  // Limpar também apaga as entradas de versões futuras; Desfazer devolve-as
  const clearedExtraRef = useRef(new WeakMap<AnnItem[], unknown[]>())
  // Borracha: o snapshot de Desfazer só entra quando o gesto apaga alguma coisa
  const eraseSnapRef = useRef(false)
  // Pan com 2 dedos: posições dos pointers ativos + estado do gesto de scroll
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const panRef = useRef<{ el: HTMLElement | null; lastY: number } | null>(null)
  const onGutterRef = useRef(onGutter)
  useLayoutEffect(() => { onGutterRef.current = onGutter })
  // A cloud já respondeu à 1.ª leitura (bem ou mal), ou passou
  // LEGACY_PULL_WAIT_MS: só então se migra uma cópia antiga deste aparelho
  // (a cloud pode ter uma v2, que ganha — ver reconcile)
  const [cloudSettled, setCloudSettled] = useState(!userId || init.kind !== 'legacy')

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

  const commit = useCallback((next: AnnItem[], save: number) => {
    strokesRef.current = next
    saveRef.current = Math.max(saveRef.current, save)
    setStrokes(next)
  }, [])

  /** Alteração feita pelo utilizador: snapshot para Desfazer + grava (local e cloud) */
  const edit = useCallback((next: AnnItem[]) => {
    historyRef.current.push(strokesRef.current)
    touchedRef.current = true
    commit(next, SAVE_ALL)
  }, [commit])

  /**
   * Traços antigos já ancorados. Da cloud: juntam-se (por id) ao que já há
   * aqui e gravam-se. Deste aparelho: mostram-se já, mas só se gravam depois
   * de a cloud responder (se ela tiver uma v2, ganha — ver reconcile).
   */
  const finishLegacy = useCallback((list: AnnItem[], origin: 'local' | 'remote') => {
    // Sem nada ancorado não se toca em nada: o payload antigo fica como está
    if (!list.length) return
    if (origin === 'local') {
      if (!localLegacyRef.current) return
      localMigratedRef.current = true
    }
    historyRef.current = []
    const save = origin === 'remote' || !userId || pullOkRef.current ? SAVE_ALL : SAVE_NONE
    // Desenhado entretanto (as fontes demoraram): junta, não substitui
    commit(uniqueIds(unionById(list, strokesRef.current)), save)
  }, [commit, userId])

  // Migração à espera do layout de referência (ver adoptLegacy)
  const [legacyJob, setLegacyJob] = useState<{ payload: ParsedPayload; origin: 'local' | 'remote'; width: number } | null>(null)

  /**
   * Traços antigos (px do Ensaio, sem âncoras). Guardados neste mesmo layout
   * ({w, h} = o bloco agora): adotar como antes e ancorar logo contra o DOM.
   * Guardados com outro tamanho de letra ou outra largura — o tamanho é
   * global (A± noutra música), rodar o iPad, outro aparelho — ou sem h (era
   * sempre 32px): re-escalar por rácios punha os sublinhados a riscar o
   * texto, por isso ancoram-se contra o layout de referência
   * (LegacyReference), como no concerto. Sem letra: ficam livres.
   */
  const adoptLegacy = useCallback((p: ParsedPayload, origin: 'local' | 'remote') => {
    const L = measure()
    if (!L) return
    const empty = isLayoutEmpty(L)
    const same = !empty && p.w > 0 && !!p.h && Math.abs(L.width - p.w) <= 1 && Math.abs(L.height - p.h) <= 1
    if (empty || same) {
      finishLegacy(anchorLegacy(p, L, L.width, L.height), origin)
      return
    }
    const cached = cachedLegacy(legacyKey(p, lyricsRef.current))
    if (cached) finishLegacy(cached, origin)
    else setLegacyJob({ payload: p, origin, width: p.w > 0 ? p.w : L.width })
  }, [measure, finishLegacy])

  const onLegacyReady = useCallback((list: AnchoredStroke[], usedLyrics: string) => {
    setLegacyJob(null)
    if (!legacyJob) return
    // A letra mudou enquanto a referência media: passa para a numeração atual
    const now = lyricsRef.current
    const out = usedLyrics === now ? list : rebaseStrokes(list, collectLines(list, usedLyrics), now).strokes
    finishLegacy(out, legacyJob.origin)
  }, [legacyJob, finishLegacy])

  /**
   * A cloud respondeu (R = o que lá está, null se nada). Decide o que fica,
   * segundo o que este aparelho tinha ao abrir (LocalKind). Devolve a função
   * que cancela uma migração ainda à espera das fontes.
   */
  const reconcile = useCallback((R: ParsedPayload | null): (() => void) => {
    const kind = kindRef.current
    const remote = R && (payloadHasStrokes(R) || R.extra.length > 0) ? R : null
    if (kind === 'v2') return () => {}
    // Uma v2 na cloud — mesmo vazia (Limpar noutro aparelho) — é mais recente
    // do que uma cópia antiga daqui
    const v2 = R?.anchored && (remote || kind === 'legacy') ? R : null
    if (v2?.anchored) {
      const r = rebaseStrokes(v2.anchored, v2.lines, lyricsRef.current, v2.hlLines)
      const base = uniqueIds(r.strokes)
      let mine = strokesRef.current
      if (kind === 'legacy') {
        // A cópia antiga daqui é mais velha do que a v2 da cloud: fica a da
        // cloud + o que se desenhou agora
        localLegacyRef.current = null
        mine = mine.filter(s => addedRef.current.has(s.id))
      }
      const next = unionById(base, mine)
      extraRef.current = unionExtra(v2.extra, kind === 'legacy' ? [] : extraRef.current)
      historyRef.current = []
      const ownChanges = next.length > base.length || kind === 'pend'
      // Re-numerado (letra editada noutro lado) ou com traços daqui → devolve-se à cloud
      commit(next, ownChanges || r.changed ? SAVE_ALL : SAVE_LOCAL)
      return () => {}
    }
    if (kind === 'legacy') {
      // Cloud vazia ou também antiga: o local ganha — grava-se a migração
      // daqui (se ainda não acabou, grava-se quando acabar: pullOk já é true)
      // (cópia do array: com o mesmo, o React não voltava a renderizar e não se gravava)
      if (localMigratedRef.current) commit(strokesRef.current.slice(), SAVE_ALL)
      return () => {}
    }
    // Cloud com o formato antigo: migra-se e junta-se ao que há aqui
    if (remote) return whenFontsReady(() => adoptLegacy(remote, 'remote'))
    // Cloud vazia: o que ficou à espera (desenhado antes, ou por juntar) segue agora
    if (pendRef.current || touchedRef.current) commit(strokesRef.current.slice(), SAVE_ALL)
    return () => {}
  }, [commit, adoptLegacy])

  useImperativeHandle(ref, () => ({
    undo() {
      const h = historyRef.current
      if (h.length === 0) return
      const prev = h[h.length - 1]
      historyRef.current = h.slice(0, -1)
      const ex = clearedExtraRef.current.get(prev)
      if (ex) extraRef.current = ex
      touchedRef.current = true
      commit(prev, SAVE_ALL)
    },
    clear() {
      clearedExtraRef.current.set(strokesRef.current, extraRef.current)
      extraRef.current = []
      edit([])
    },
  }), [commit, edit])

  // Letra mudou (re-numerar os traços e os snapshots), A+/A− (o texto
  // re-fluiu) ou a calha lateral mudou: re-mede antes de pintar — os traços
  // nunca aparecem um frame fora do sítio
  useLayoutEffect(() => {
    const prev = lyricsRef.current
    if (prev !== lyrics) {
      lyricsRef.current = lyrics
      const rebase = (list: AnnItem[]) => rebaseStrokes(list, collectLines(list, prev), lyrics)
      historyRef.current = historyRef.current.map(snap => rebase(snap).strokes)
      const r = rebase(strokesRef.current)
      if (r.changed) commit(r.strokes, SAVE_ALL)
    }
    measure()
  }, [lyrics, fontSize, gutter, measure, commit])

  // Payload antigo neste dispositivo: ancora quando a cloud tiver respondido
  // (se tiver uma v2, esta cópia já não conta) e as fontes estiverem prontas
  // (medido com a fonte de recurso, o texto tinha outra largura)
  useEffect(() => {
    const legacy = init.legacy
    if (!legacy || !cloudSettled) return
    return whenFontsReady(() => { if (localLegacyRef.current) adoptLegacy(legacy, 'local') })
  }, [init, adoptLegacy, cloudSettled])

  useEffect(() => {
    if (cloudSettled) return
    const t = setTimeout(() => setCloudSettled(true), LEGACY_PULL_WAIT_MS)
    return () => clearTimeout(t)
  }, [cloudSettled])

  // Cloud: lida ao abrir; se falhar, volta a tentar (e quando a rede volta).
  // Enquanto não for lida, nada do que se grava aqui segue para lá
  useEffect(() => {
    if (!userId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let cancel = () => {}
    const run = () => {
      timer = null
      fetchAnnotations(songId, userId).then(res => {
        if (!alive) return
        if (!res.ok) {
          setCloudSettled(true)
          timer = setTimeout(run, PULL_RETRY_MS[Math.min(attempt++, PULL_RETRY_MS.length - 1)])
          return
        }
        pullOkRef.current = true
        window.removeEventListener('online', onOnline)
        cancel = reconcile(res.payload)
        setCloudSettled(true)
      })
    }
    const onOnline = () => {
      if (pullOkRef.current || !timer) return
      clearTimeout(timer)
      run()
    }
    window.addEventListener('online', onOnline)
    run()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      cancel()
    }
  }, [songId, userId, reconcile])

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
    // Para a cloud só depois de a ler (o local v2 ganha sempre: segue já)
    const push = mode === SAVE_ALL && !!userId && (pullOkRef.current || kindRef.current === 'v2')
    if (push) pendRef.current = false
    else if (mode === SAVE_ALL && userId) pendRef.current = true
    const L = layoutRef.current
    const base = {
      w: L ? L.width : 0,
      h: L ? L.height : 0,
      strokes: L ? toLegacyStrokes(resolveAll(strokes, L), resolveHighlights(strokes, L)) : [],
      em: L ? L.em : NaN,
      anchored: strokes,
      lyrics: lyricsRef.current,
      extra: extraRef.current,
    }
    const payload = buildPayload({ ...base, pend: pendRef.current })
    try { localStorage.setItem(ANN_STORAGE_KEY(songId), JSON.stringify(payload)) } catch { /* storage cheio/bloqueado */ }
    // A cópia antiga deste aparelho foi substituída por uma v2: já não há nada a migrar
    if (kindRef.current === 'legacy' && localLegacyRef.current === null) kindRef.current = 'v2'
    if (push && userId) {
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
  // não muda o tamanho de nada observado, por isso não há ciclo. flushSync:
  // os caminhos novos entram já neste frame (fora de um evento, o React só
  // os escrevia numa tarefa seguinte, depois de pintar — mais um frame com
  // os traços no sítio antigo por cima do texto já re-fluído)
  useEffect(() => {
    const el = layerRef.current
    if (!el) return
    const basisEl = contentRef?.current ?? el
    let raf = 0
    const obs = new ResizeObserver(entries => {
      for (const en of entries) {
        // A SVG ocupa sempre a camada (só decide se se monta e até onde desce)
        if (en.target === el) {
          setSvgW(en.contentRect.width)
          setSvgH(en.contentRect.height)
        }
      }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; flushSync(() => { measure() }) })
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

  // Caminhos resolvidos no layout atual (cache por traço e por layout em
  // anchor.ts): a caneta por cima do texto, o marcador por trás; a calha
  // que as margens pedem e até onde o desenho desce
  const view = useMemo(() => {
    if (!layout) return { paths: [], marker: [] as MarkerShape[], gutter: 0, bottom: 0 }
    const v = buildView(strokes, layout)
    return { paths: v.pen, marker: v.marker, gutter: marginGutter(v.resolved, layout), bottom: Math.max(0, v.bottom) }
  }, [strokes, layout])

  // Gesto do marcador em curso: o que vai ficar quando se levantar — as
  // palavras inteiras já ajustadas (como uma seleção de texto) ou o traço livre
  const draftMarker = useMemo((): MarkerShape[] => {
    if (!current || current.kind !== 'hl' || !layout) return []
    const kind = classifyHighlight(current.pts, layout)
    if (kind === 'text') {
      const radius = highlightRadius(layout.em)
      return highlightRange(current.pts, current.color, layout, 'rascunho').map(m => ({
        key: `rascunho:${m.id}`, id: m.id, color: m.color, label: !!layout.section?.(m.ln), rects: resolveHighlight(m, layout).rects, radius,
      }))
    }
    if (kind === 'ink' && current.pts.length >= 4) {
      return [{ key: 'rascunho', id: 'rascunho', color: current.color, label: false, d: smoothPath(current.pts), width: HL_INK_EM * layout.em }]
    }
    return []
  }, [current, layout])

  // Calha pedida pelas margens → quem usa aplica-a ao LyricsView e devolve-a
  // em `gutter` (o efeito de cima re-mede). Só depende do X das margens, que
  // a calha não muda: estabiliza à primeira
  useLayoutEffect(() => {
    if (view.gutter !== gutter) onGutterRef.current?.(view.gutter)
  }, [view.gutter, gutter])
  useEffect(() => () => onGutterRef.current?.(0), [])

  const getXY = useCallback((e: React.PointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  /** Borracha: apaga (por id) os traços e os destaques cujo desenho atual passa no círculo */
  function eraseAt(x: number, y: number) {
    const L = layoutRef.current
    if (!L) return
    const list = strokesRef.current
    const ids = [
      ...strokesAt(resolveAll(list, L), x, y, ERASER_RADIUS),
      ...highlightsAt(resolveHighlights(list, L), x, y, ERASER_RADIUS),
    ]
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

    const stroke: DraftStroke = { pts: [x, y], color, width: strokeWidth, kind: tool === 'highlighter' ? 'hl' : 'pen' }
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

    if (tool === 'eraser' || !finished) return
    // Marcador: sobre o texto → destaque das palavras tocadas (um toque
    // destaca a palavra), fundido com os da mesma cor e a recortar os de
    // outra; na margem/vertical/folha sem letra → traço livre de marcador.
    // Um gesto = um passo de Desfazer, mesmo com várias linhas
    if (finished.kind === 'hl') {
      const L = measure()
      const res = L ? anchorHighlight(finished.pts, finished.color, L) : null
      if (!L || !res) return
      if (res.ink) addedRef.current.add(res.ink.id)
      for (const m of res.marks) addedRef.current.add(m.id)
      edit(res.ink ? [...strokesRef.current, res.ink] : mergeHighlights(strokesRef.current, res.marks, ln => L.text(ln)))
      return
    }
    if (finished.pts.length >= 4) {
      // Ancora contra o DOM de agora (o que o músico viu ao desenhar); sem
      // texto onde ancorar ("Sem letra") fica livre na folha
      const L = measure()
      const a: AnchoredStroke | null = !L ? null
        : isLayoutEmpty(L) ? anchorFree(finished.pts, finished.color, finished.width, L)
          : anchorStroke(finished.pts, finished.color, finished.width, L)
      if (a) {
        addedRef.current.add(a.id)
        edit([...strokesRef.current, a])
      }
    }
  }

  // Traços abaixo do fim da camada (uma nota depois da última linha, e a
  // letra encolheu com A−… ou cresceu e a camada acaba no texto): a SVG
  // estende-se até eles, para se verem, apagarem e chegar-lhes com o scroll
  const svgHeight = view.bottom > svgH ? Math.ceil(view.bottom) : undefined
  // Marcador (e o gesto do marcador em curso), por trás do texto
  const marker = draftMarker.length ? [...view.marker, ...draftMarker] : view.marker
  // Opacidade por cor: depende da folha (--surface do tema da app) e da cor
  // e do tamanho da letra e dos rótulos por cima (medidos com o layout)
  const paint = useMemo(() => markerPaint(layout?.ink), [layout])

  return (
    <>
      <div ref={layerRef} className={styles.layer}>
        {svgW > 0 && (
          // Sem viewBox: as unidades são os px da própria SVG (o referencial
          // dos pontos). Com um viewBox posto pelo ResizeObserver, durante um
          // frame depois de A±/rodar os traços certos eram esticados ao novo tamanho
          <svg
            className={styles.svg}
            style={{
              cursor: disabled ? 'default' : tool === 'eraser' ? 'none' : 'crosshair',
              pointerEvents: disabled ? 'none' : 'all',
              touchAction: disabled ? 'auto' : 'none',
              height: svgHeight,
              overflow: 'visible',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {view.paths.map(s => (
              <path key={s.id} d={s.d}
                stroke={s.color} strokeWidth={s.width}
                fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {current && current.kind === 'pen' && current.pts.length >= 4 && (
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
      {/* Irmã da camada (que tem z-index 2, por cima da letra): fica por trás
          do texto — o pai da camada tem de ser um contexto de empilhamento */}
      <MarkerUnderlay shapes={marker} paint={paint} height={svgHeight} />
    </>
  )
})

export default AnnotationLayer
