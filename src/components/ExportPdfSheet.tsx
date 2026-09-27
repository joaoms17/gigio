import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useToast } from './Toast'
import {
  canShareFile, countSongsWithChords, generateSetlistPdf, hasListNotes, preloadPdfEngine,
  type PdfData, type PdfKind, type PdfSize, type PdfTheme,
} from '../lib/pdfExport'
import styles from './ExportPdfSheet.module.css'

/**
 * Folha de exportação de PDF (v2).
 *  - Repertório: escolhe Tema (Claro/Escuro), Tamanho da letra e "Incluir acordes"
 *    (só quando alguma música tem acordes) → Gerar.
 *  - Alinhamento: gera logo.
 *  - Pronto: "PDF PRONTO · 48 PÁGINAS" → Partilhar (Web Share com ficheiro — é um
 *    toque novo, o iOS recusa share() depois de trabalho assíncrono) e Descarregar.
 *
 * `data` é lido UMA vez ao abrir (pode ser uma função assíncrona que vai buscar
 * letras/acordes); re-renders do pai não voltam a gerar.
 */
export interface ExportPdfSheetProps {
  kind: PdfKind
  data: PdfData | (() => Promise<PdfData>)
  onClose: () => void
}

type Phase = 'loading' | 'options' | 'generating' | 'ready' | 'error'

interface Prefs { theme: PdfTheme; size: PdfSize; chords: boolean; titlesOnly: boolean }
const PREFS_KEY = 'gigio-pdf-prefs'
/** Grande (20pt) por defeito: o repertório lê-se num tablet a ~1 m, no palco. */
const DEFAULT_PREFS: Prefs = { theme: 'light', size: 'grande', chords: true, titlesOnly: false }

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      theme: p.theme === 'dark' ? 'dark' : 'light',
      size: p.size === 'normal' || p.size === 'enorme' ? p.size : 'grande',
      chords: p.chords !== false,
      titlesOnly: p.titlesOnly === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* modo privado */ }
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmtSize = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`

/* ── Ícones SVG inline ── */
function Svg({ size = 20, sw = 2, children }: { size?: number; sw?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
  )
}
const IconClose = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>
const IconShare = () => <Svg><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></Svg>
const IconDownload = () => <Svg><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></Svg>
const IconCheck = () => <Svg size={14} sw={3}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
const IconDoc = () => (
  <Svg size={28} sw={1.75}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" />
  </Svg>
)
const IconAlert = () => <Svg size={28} sw={1.75}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></Svg>

/** Mini-página para o seletor de tema (fundo + linhas de "letra"). */
function ThemeSwatch({ dark }: { dark: boolean }) {
  return (
    <span className={`${styles.swatch} ${dark ? styles.swatchDark : ''}`} aria-hidden="true">
      <span className={styles.swatchTitle} />
      <span className={styles.swatchAccent} />
      <span className={styles.swatchLine} />
      <span className={styles.swatchLine} style={{ width: '70%' }} />
      <span className={styles.swatchLine} style={{ width: '85%' }} />
    </span>
  )
}

const SIZES: { value: PdfSize; label: string; pt: number }[] = [
  { value: 'normal', label: 'Normal', pt: 16 },
  { value: 'grande', label: 'Grande', pt: 20 },
  { value: 'enorme', label: 'Enorme', pt: 24 },
]

export default function ExportPdfSheet({ kind, data, onClose }: ExportPdfSheetProps) {
  const toast = useToast()
  const titleId = useId()
  const source = useRef(data)
  const [phase, setPhase] = useState<Phase>('loading')
  const [pdfData, setPdfData] = useState<PdfData | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const [result, setResult] = useState<{ file: File; pages: number; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canShare, setCanShare] = useState(false)
  /** Cada carregamento/geração tem um id; respostas de execuções antigas são ignoradas. */
  const run = useRef(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null)

  const isRep = kind === 'repertorio'
  const chordCount = pdfData ? countSongsWithChords(pdfData) : 0
  const listHasNotes = !isRep && !!pdfData && hasListNotes(pdfData)

  const generate = useCallback(async (d: PdfData, p: Prefs) => {
    const id = ++run.current
    setPhase('generating')
    setError(null)
    // Deixa o estado "A gerar…" pintar antes do trabalho síncrono do jsPDF
    await new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 30)))
    try {
      const out = await generateSetlistPdf(d, isRep
        ? { kind, theme: p.theme, size: p.size, includeChords: p.chords }
        : { kind, theme: 'light', titlesOnly: p.titlesOnly })
      if (id !== run.current) return
      setResult({ ...out, url: URL.createObjectURL(out.file) })
      setCanShare(canShareFile(out.file))
      setPhase('ready')
    } catch (e) {
      if (id !== run.current) return
      console.error('PDF', e)
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      setError(offline
        ? 'Sem ligação: o motor de PDF ainda não está guardado neste dispositivo. Tenta de novo com internet.'
        : 'Não foi possível gerar o PDF. Tenta de novo.')
      setPhase('error')
    }
  }, [isRep, kind])

  /** Resolve os dados (função assíncrona ou objeto). Só mexe no estado depois do await. */
  const loadData = useCallback(async () => {
    const id = ++run.current
    try {
      const src = source.current
      const d = typeof src === 'function' ? await src() : await Promise.resolve(src)
      if (id !== run.current) return
      setPdfData(d)
      if (isRep) setPhase('options')
      else generate(d, prefs)
    } catch (e) {
      if (id !== run.current) return
      setError(e instanceof Error && e.message ? e.message : 'Não foi possível carregar as músicas.')
      setPhase('error')
    }
    // prefs só interessam ao repertório; o alinhamento gera sempre claro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate, isRep])

  // Abrir: pré-carrega motor + fontes em paralelo com os dados
  useEffect(() => {
    const runs = run
    preloadPdfEngine()
    loadData()
    return () => { runs.current++ }
  }, [loadData])

  // Liberta o object URL anterior (nova geração) e o último ao fechar
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  // Esc fecha; foco inicial no próprio diálogo (sem anel de foco num botão)
  useEffect(() => {
    sheetRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Ao ficar pronto, foco na ação principal
  useEffect(() => { if (phase === 'ready') primaryRef.current?.focus() }, [phase])

  function updatePrefs(patch: Partial<Prefs>) {
    setPrefs(prev => {
      const next = { ...prev, ...patch }
      savePrefs(next)
      return next
    })
  }

  async function share() {
    if (!result) return
    try {
      await navigator.share({ files: [result.file], title: result.file.name })
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return
      toast('Não foi possível partilhar. Usa "Descarregar".', { type: 'error' })
    }
  }

  /** Lista: alterna entre "com intro e notas" e "só títulos" (letra maior) e volta a gerar. */
  function toggleTitlesOnly() {
    if (!pdfData) return
    const next = { ...prefs, titlesOnly: !prefs.titlesOnly }
    updatePrefs({ titlesOnly: next.titlesOnly })
    generate(pdfData, next)
  }

  function retry() {
    if (pdfData) {
      generate(pdfData, prefs)
    } else {
      setPhase('loading')
      setError(null)
      loadData()
    }
  }

  const songsCount = pdfData?.songs.length ?? 0
  const kindLabel = isRep ? 'Repertório' : (pdfData?.meta.context ?? 'concert') === 'concert' ? 'Alinhamento' : 'Lista de músicas'
  const kicker = phase === 'ready' && result
    ? `PDF pronto · ${pad2(result.pages)} página${result.pages !== 1 ? 's' : ''}`
    : `Exportar PDF${pdfData ? ` · ${pad2(songsCount)} música${songsCount !== 1 ? 's' : ''}` : ''}`

  return (
    <div className={styles.overlay} onClick={() => phase !== 'generating' && onClose()}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headText}>
            <div className={`${styles.kicker} ${phase === 'ready' ? styles.kickerReady : ''}`}>
              <span className={styles.kickerLed} aria-hidden="true" />
              <span>{kicker}</span>
            </div>
            <h2 id={titleId} className={styles.title}>
              {kindLabel}
              {pdfData?.meta.title && <span className={styles.titleSub}>{pdfData.meta.title}</span>}
            </h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </header>

        <div className={styles.body} aria-live="polite">
          {(phase === 'loading' || phase === 'generating') && (
            <div className={styles.progress} role="status">
              <div className={styles.progressLabel}>
                {phase === 'loading' ? 'A preparar as músicas…' : `A gerar o PDF${songsCount ? ` · ${pad2(songsCount)} músicas` : ''}…`}
              </div>
              <div className={styles.track}><span className={styles.bar} /></div>
              <p className={styles.hint}>
                {isRep
                  ? 'Capa com índice, uma música por página, com links para saltar.'
                  : 'Lista numerada numa página, pronta a imprimir e colar no palco.'}
              </p>
            </div>
          )}

          {phase === 'options' && pdfData && (
            <>
              <fieldset className={styles.group}>
                <legend className={styles.label}>Tema</legend>
                <div className={styles.themeGrid} role="radiogroup" aria-label="Tema">
                  {([['light', 'Claro', 'Para imprimir'], ['dark', 'Escuro', 'Palco · tablet']] as const).map(([value, label, hint]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={prefs.theme === value}
                      className={`${styles.themeOpt} ${prefs.theme === value ? styles.optOn : ''}`}
                      onClick={() => updatePrefs({ theme: value })}
                    >
                      <ThemeSwatch dark={value === 'dark'} />
                      <span className={styles.optText}>
                        <span className={styles.optLabel}>{label}</span>
                        <span className={styles.optHint}>{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.group}>
                <legend className={styles.label}>Tamanho da letra</legend>
                <div className={styles.sizeGrid} role="radiogroup" aria-label="Tamanho da letra">
                  {SIZES.map(s => (
                    <button
                      key={s.value}
                      type="button"
                      role="radio"
                      aria-checked={prefs.size === s.value}
                      className={`${styles.sizeOpt} ${prefs.size === s.value ? styles.optOn : ''}`}
                      onClick={() => updatePrefs({ size: s.value })}
                    >
                      <span className={styles.sizeSample} style={{ fontSize: `${Math.round(s.pt * 1.05)}px` }} aria-hidden="true">Aa</span>
                      <span className={styles.optLabel}>{s.label}</span>
                      <span className={styles.optHint}>{s.pt} pt</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {chordCount > 0 && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={prefs.chords}
                  className={styles.checkRow}
                  onClick={() => updatePrefs({ chords: !prefs.chords })}
                >
                  <span className={`${styles.check} ${prefs.chords ? styles.checkOn : ''}`} aria-hidden="true">
                    {prefs.chords && <IconCheck />}
                  </span>
                  <span className={styles.optText}>
                    <span className={styles.optLabel}>Incluir acordes</span>
                    <span className={styles.optHint}>
                      {pad2(chordCount)} música{chordCount !== 1 ? 's' : ''} com acordes
                      {(pdfData.meta.context ?? 'concert') === 'concert' && ' · no tom do concerto'}
                    </span>
                  </span>
                </button>
              )}
            </>
          )}

          {phase === 'ready' && result && (
            <div className={styles.ready}>
              <span className={styles.readyIcon}><IconDoc /></span>
              <div className={styles.readyText}>
                <div className={styles.fileName}>{result.file.name}</div>
                <div className={styles.fileMeta}>
                  {pad2(result.pages)} pág. · {fmtSize(result.file.size)}
                  {isRep && ` · ${prefs.theme === 'dark' ? 'Escuro' : 'Claro'} · ${SIZES.find(s => s.value === prefs.size)?.label}`}
                  {listHasNotes && prefs.titlesOnly && ' · Só títulos'}
                </div>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className={styles.error} role="alert">
              <span className={styles.errorIcon}><IconAlert /></span>
              <p className={styles.errorText}>{error}</p>
            </div>
          )}
        </div>

        {phase === 'options' && (
          <footer className={styles.footer}>
            <button type="button" className={styles.primaryBtn} onClick={() => pdfData && generate(pdfData, prefs)}>
              Gerar PDF
            </button>
          </footer>
        )}

        {phase === 'ready' && result && (
          <footer className={`${styles.footer} ${canShare ? styles.footerSplit : ''}`}>
            {canShare && (
              <button
                ref={el => { primaryRef.current = el }}
                type="button"
                className={styles.primaryBtn}
                onClick={share}
              >
                <IconShare />Partilhar
              </button>
            )}
            <a
              ref={el => { if (!canShare) primaryRef.current = el }}
              className={canShare ? styles.secondaryBtn : styles.primaryBtn}
              href={result.url}
              download={result.file.name}
            >
              <IconDownload />Descarregar
            </a>
            {isRep && (
              <button type="button" className={styles.linkBtn} onClick={() => setPhase('options')}>
                Alterar tema ou tamanho
              </button>
            )}
            {listHasNotes && (
              <button type="button" className={styles.linkBtn} onClick={toggleTitlesOnly}>
                {prefs.titlesOnly ? 'Incluir intro e notas' : 'Só títulos · letra maior'}
              </button>
            )}
          </footer>
        )}

        {phase === 'error' && (
          <footer className={styles.footer}>
            <button type="button" className={styles.secondaryBtn} onClick={retry}>Tentar de novo</button>
          </footer>
        )}
      </div>
    </div>
  )
}
