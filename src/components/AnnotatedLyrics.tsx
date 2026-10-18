import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import LyricsView, { withAlpha } from './LyricsView'
import { LegacyReference, loadAnnotations, pullAnnotations } from './AnnotationLayer'
import {
  pathFromSubpaths, payloadHasStrokes, rebaseStrokes, resolveAll,
  type AnchoredStroke, type ParsedPayload,
} from '../lib/annotations/anchor'
import { measureLayout, watchFonts, type MeasuredLayout } from '../lib/annotations/measure'

const PAD_V = 16
const PAD_H = 20
const NO_STROKES: AnchoredStroke[] = []

/**
 * Read-only view of lyrics + rehearsal annotations (modo concerto). A letra
 * aparece no tamanho e entrelinha do palco; os traços, ancorados ao texto
 * no Ensaio, redesenham-se presos aos mesmos caracteres deste layout.
 * Carrega uma vez por montagem: quem usa dá key={songId}.
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
  const innerRef = useRef<HTMLDivElement>(null)
  // Local primeiro; a cloud só se aqui não houver nada
  const [local] = useState(() => loadAnnotations(songId))
  const [remote, setRemote] = useState<ParsedPayload | null>(null)
  const data = payloadHasStrokes(local) ? local : remote

  useEffect(() => {
    if (!userId || payloadHasStrokes(local)) return
    let alive = true
    pullAnnotations(songId, userId).then(r => { if (alive && r) setRemote(r) })
    return () => { alive = false }
  }, [songId, userId, local])

  // Ancorados (v2): passados para a numeração desta letra (pode ter sido
  // editada depois de desenhar). Só em memória — o concerto não grava
  const anchored = useMemo(
    () => (data?.anchored ? rebaseStrokes(data.anchored, data.lines, lyrics).strokes : null),
    [data, lyrics],
  )

  // Antigos (px do Ensaio, sem âncoras): ancorados contra um layout de
  // referência com as definições do Ensaio (LegacyReference), só em memória
  const legacy = data && !data.anchored && data.strokes.length > 0 ? data : null
  const [migrated, setMigrated] = useState<{ from: ParsedPayload; lyrics: string; strokes: AnchoredStroke[] } | null>(null)
  const migratedStrokes = migrated && migrated.from === legacy && migrated.lyrics === lyrics ? migrated.strokes : null
  const onLegacyReady = useCallback((strokes: AnchoredStroke[], usedLyrics: string) => {
    if (legacy) setMigrated({ from: legacy, lyrics: usedLyrics, strokes })
  }, [legacy])

  const strokes = anchored ?? migratedStrokes ?? NO_STROKES

  // Medição do próprio LyricsView. Mesma geometria → mesmo objeto (nada a
  // redesenhar); a linha ativa só muda o fundo, não o layout
  const [layout, setLayout] = useState<MeasuredLayout | null>(null)
  const layoutRef = useRef<MeasuredLayout | null>(null)
  const measure = useCallback(() => {
    const inner = innerRef.current
    const next = inner ? measureLayout(inner, inner) : null
    const prev = layoutRef.current
    if (!next || (prev && prev.sig === next.sig)) return
    layoutRef.current = next
    setLayout(next)
  }, [])

  // Letra, tamanho ou entrelinha novos: re-mede antes de pintar
  useLayoutEffect(() => { measure() }, [lyrics, fontSize, lineHeight, measure])

  // Resize/rotação: uma medição por frame, no máximo
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    let raf = 0
    const obs = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure() })
    })
    obs.observe(el)
    return () => {
      obs.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [measure])

  // Fontes carregadas: o texto muda de largura sem o bloco mudar de tamanho
  useEffect(() => watchFonts(measure), [measure])

  // Largura do Ensaio onde os traços antigos foram desenhados; os payloads
  // mais antigos (só um array) não a têm → a largura daqui
  const refWidth = legacy ? (legacy.w > 0 ? legacy.w : layout?.width ?? 0) : 0

  // Caminhos resolvidos neste layout — memoizados: a linha ativa muda a cada
  // verso e não pode refazer os traços
  const paths = useMemo(() => {
    if (!layout || strokes.length === 0) return []
    return resolveAll(strokes, layout)
      .filter(s => !s.hidden)
      .map(s => ({ id: s.id, color: s.color, width: s.width, d: pathFromSubpaths(s.subpaths) }))
  }, [strokes, layout])

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
    <div style={frameStyle}>
      <div ref={innerRef} style={{ position: 'relative' }}>
        <LyricsView lyrics={lyrics} activeLine={activeLine} accent={accentColor} fontSize={fontSize} lineHeight={lineHeight} />
        {paths.length > 0 && (
          <svg
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            {paths.map((s, i) => (
              <path
                // Payloads antigos podem repetir ids (cópias partidas em vários traços)
                key={`${i}:${s.id}`}
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
      {legacy && !migratedStrokes && refWidth > 0 && (
        <LegacyReference payload={legacy} lyrics={lyrics} width={refWidth} onReady={onLegacyReady} />
      )}
    </div>
  )
}
