import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import LyricsView, { withAlpha } from './LyricsView'
import { LegacyReference } from './AnnotationLayer'
import { LEGACY_PULL_WAIT_MS, cachedLegacy, legacyKey, loadAnnotations, pullAnnotations } from '../lib/annotations/storage'
import {
  marginGutter, pathFromSubpaths, payloadHasStrokes, rebaseStrokes, resolveAll, unionById,
  type AnchoredStroke, type ParsedPayload,
} from '../lib/annotations/anchor'
import { measureLayout, watchFonts, type MeasuredLayout } from '../lib/annotations/measure'

const PAD_V = 16
const PAD_H = 20
const NO_STROKES: AnchoredStroke[] = []
const NO_VIEW = { paths: [] as { id: string; color: string; width: number; d: string }[], gutter: 0, padTop: 0, padBottom: 0 }

/** Âncoras de um payload v2 na numeração desta letra (null se não tem nada) */
function anchoredOf(p: ParsedPayload | null, lyrics: string): AnchoredStroke[] | null {
  if (!p?.anchored || !payloadHasStrokes(p)) return null
  return rebaseStrokes(p.anchored, p.lines, lyrics).strokes
}

/** Payload antigo (px, sem âncoras) com traços, ou null */
function legacyOf(p: ParsedPayload | null): ParsedPayload | null {
  return p && !p.anchored && p.strokes.length > 0 ? p : null
}

/**
 * Read-only view of lyrics + rehearsal annotations (modo concerto). A letra
 * aparece no tamanho e entrelinha do palco; os traços, ancorados ao texto
 * no Ensaio, redesenham-se presos aos mesmos caracteres deste layout.
 * Carrega uma vez por montagem: quem usa dá key={songId}. Nunca grava.
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
  const [local] = useState(() => loadAnnotations(songId))
  const [remote, setRemote] = useState<ParsedPayload | null>(null)
  // Uma v2 deste aparelho ganha (como no Ensaio). A cloud lê-se se aqui não
  // há nada, se o que há é antigo (a v2 da cloud é mais recente) ou se está
  // por juntar (gravado sem a conseguir ler)
  const localFinal = !!local?.anchored && !local.pend && payloadHasStrokes(local)
  const needPull = !!userId && !localFinal
  // A cloud já respondeu (ou cansou-se de esperar: LEGACY_PULL_WAIT_MS)
  const [pulled, setPulled] = useState(!needPull)

  useEffect(() => {
    if (!userId || localFinal) return
    let alive = true
    pullAnnotations(songId, userId).then(r => {
      if (!alive) return
      if (r) setRemote(r)
      setPulled(true)
    })
    const t = setTimeout(() => { if (alive) setPulled(true) }, LEGACY_PULL_WAIT_MS)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [songId, userId, localFinal])

  // Ancorados (v2), na numeração desta letra (pode ter sido editada depois
  // de desenhar). Só em memória — o concerto não grava
  const anchored = useMemo(() => {
    const mine = anchoredOf(local, lyrics)
    const theirs = anchoredOf(remote, lyrics)
    if (mine && theirs && local?.pend) return unionById(theirs, mine)
    if (mine || theirs) return mine ?? theirs
    // Cópia antiga daqui e uma v2 na cloud, mesmo vazia (Limpar noutro
    // aparelho): a da cloud é mais recente — um cliente antigo que tivesse
    // gravado depois tinha-a substituído
    if (remote?.anchored && local && !local.anchored) return NO_STROKES
    return null
  }, [local, remote, lyrics])

  // Antigos (px do Ensaio, sem âncoras), quando não há v2 nenhuma: ancorados
  // contra um layout de referência com as definições do Ensaio
  // (LegacyReference), só em memória e uma vez por sessão (cache). A cópia
  // antiga daqui só depois de a cloud responder (pode ter uma v2)
  const legacy = anchored ? null : (pulled ? legacyOf(local) : null) ?? legacyOf(remote)
  const key = useMemo(() => (legacy ? legacyKey(legacy, lyrics) : ''), [legacy, lyrics])
  const [migrated, setMigrated] = useState<{ key: string; strokes: AnchoredStroke[] } | null>(null)
  const migratedStrokes = !legacy ? null
    : migrated && migrated.key === key ? migrated.strokes
      : cachedLegacy(key)
  const onLegacyReady = useCallback((strokes: AnchoredStroke[], usedLyrics: string) => {
    if (legacy) setMigrated({ key: legacyKey(legacy, usedLyrics), strokes })
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

  // Caminhos resolvidos neste layout — memoizados: a linha ativa muda a cada
  // verso e não pode refazer os traços. Também: a calha lateral que as
  // chavetas de margem pedem (o texto quebra dentro dela em vez de passar
  // por baixo delas) e o espaço que os traços precisam acima da 1.ª e
  // abaixo da última linha (senão eram cortados)
  const view = useMemo(() => {
    if (!layout || strokes.length === 0) return NO_VIEW
    const resolved = resolveAll(strokes, layout)
    let top = 0
    let bottom = layout.height
    const paths: typeof NO_VIEW.paths = []
    for (const s of resolved) {
      if (s.hidden) continue
      for (const sp of s.subpaths) {
        for (let i = 1; i < sp.length; i += 2) {
          top = Math.min(top, sp[i] - s.width / 2)
          bottom = Math.max(bottom, sp[i] + s.width / 2)
        }
      }
      paths.push({ id: s.id, color: s.color, width: s.width, d: pathFromSubpaths(s.subpaths) })
    }
    return {
      paths,
      gutter: marginGutter(resolved, layout),
      padTop: Math.ceil(-top),
      padBottom: Math.ceil(bottom - layout.height),
    }
  }, [strokes, layout])

  // Letra, tamanho, entrelinha ou calha novos: re-mede antes de pintar. A
  // calha só depende do X das margens, que ela não muda: estabiliza à primeira
  useLayoutEffect(() => { measure() }, [lyrics, fontSize, lineHeight, view.gutter, measure])

  // Resize/rotação: uma medição por frame, no máximo. flushSync: os caminhos
  // novos entram já neste frame, não numa tarefa depois de pintar
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    let raf = 0
    const obs = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; flushSync(() => { measure() }) })
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
      {/* Espaço para os traços acima/abaixo da letra — fora do bloco medido,
          para não mudar a medição (nem voltar a medir por causa dele) */}
      <div style={{ paddingTop: view.padTop, paddingBottom: view.padBottom }}>
        <div ref={innerRef} style={{ position: 'relative' }}>
          <LyricsView
            lyrics={lyrics} activeLine={activeLine} accent={accentColor}
            fontSize={fontSize} lineHeight={lineHeight} gutter={view.gutter}
          />
          {view.paths.length > 0 && (
            <svg
              aria-hidden="true"
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
            >
              {view.paths.map((s, i) => (
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
      </div>
      {legacy && !migratedStrokes && refWidth > 0 && (
        <LegacyReference payload={legacy} lyrics={lyrics} width={refWidth} onReady={onLegacyReady} />
      )}
    </div>
  )
}
