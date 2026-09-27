/* ═══════════════════════════════════════════════════════════════
   <ImportSource> — escolher de onde vem a lista: PDF · FOTO · TEXTO.
   FOTO abre logo o seletor do sistema (no iPhone/iPad: Tirar
   fotografia · Fototeca · Escolher ficheiro), uma ou várias imagens
   lidas pela ordem. TEXTO: colar (botão "Colar" ou ⌘V) — mostra logo
   quantas músicas encontrou. Também aceita arrastar ficheiros e colar
   (⌘V) um screenshot. Quando a leitura termina, o importador passa
   para a fase 'review'.
═══════════════════════════════════════════════════════════════ */
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react'
import type { SetlistImporter } from './useSetlistImport'
import { parseSetlistText } from '../../lib/setlistImport/parse'
import { pad2 } from '../../lib/setlistImport/text'
import { IconAlert, IconCamera, IconClose, IconPaste, IconPdf, IconText } from './icons'
import styles from './Import.module.css'

/** 'photo' fica por compatibilidade (FOTO já não tem painel: abre o seletor do sistema). */
export type ImportSourcePanel = 'photo' | 'text' | null

export interface ImportSourceProps {
  importer: SetlistImporter
  /** Painel aberto à partida (predefinição: nenhum) */
  initialPanel?: ImportSourcePanel
  /** Texto inicial do painel TEXTO (só se o importador ainda não tiver texto) */
  initialText?: string
  /** Esconde a dica mono por baixo das três fontes */
  hideHint?: boolean
  className?: string
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

const TEXT_PLACEHOLDER = '1. Wonderwall – Oasis (G)\n2. Menino do Bairro Negro\n3. Twist and Shout / La Bamba\n…'

export default function ImportSource({ importer, initialPanel = null, initialText = '', hideHint, className }: ImportSourceProps) {
  const [panel, setPanel] = useState<'text' | null>(initialPanel === 'text' ? 'text' : null)
  const [dragging, setDragging] = useState(false)
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const focusText = useRef(false)
  const uid = useId()
  const textId = `${uid}-text`
  const busy = importer.busy
  const text = importer.draftText
  const setText = importer.setDraftText

  // Texto inicial (uma vez, se o importador ainda não tiver nada)
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (initialText && !importer.draftText) importer.setDraftText(initialText)
  }, [initialText, importer])

  // Foca a caixa de texto só quando o utilizador abre o painel (não ao montar: evita o teclado no telemóvel)
  useEffect(() => {
    if (panel === 'text' && focusText.current) {
      focusText.current = false
      textRef.current?.focus()
    }
  }, [panel])

  // Quantas músicas o texto dá (leitura instantânea, antes de avançar). Conta as músicas, não as
  // linhas: um medley "A / B" são duas — o mesmo número que a revisão mostra a seguir.
  const found = useMemo(
    () => (text.trim() ? parseSetlistText(text).reduce((n, e) => n + e.songs.length, 0) : 0),
    [text],
  )

  // Colar um screenshot (⌘V / Ctrl+V) em qualquer sítio fora de campos de texto
  const importerRef = useRef(importer)
  useEffect(() => { importerRef.current = importer })
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.closest('input, textarea, [contenteditable="true"]'))) return
      const imp = importerRef.current
      if (imp.busy || imp.phase !== 'source') return
      const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      if (files.length) {
        e.preventDefault()
        void imp.importFiles(files)
        return
      }
      const pasted = e.clipboardData?.getData('text/plain') ?? ''
      if (pasted.includes('\n')) {
        e.preventDefault()
        imp.setDraftText(pasted)
        setPanel('text')
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  function open(ref: React.RefObject<HTMLInputElement | null>) {
    if (!busy) ref.current?.click()
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    // Limpa o valor para se poder voltar a escolher o mesmo ficheiro depois de um erro
    e.target.value = ''
    if (files.length) void importer.importFiles(files)
  }

  function toggleText() {
    importer.clearError()
    setPasteNote(null)
    focusText.current = true
    setPanel(cur => (cur === 'text' ? null : 'text'))
  }

  function submitText() {
    if (text.trim()) importer.importText(text)
  }

  async function pasteFromClipboard() {
    setPasteNote(null)
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip.trim()) {
        setPasteNote('A área de transferência está vazia — copia a lista primeiro.')
        return
      }
      setText(clip)
    } catch {
      // Sem permissão (ou browser sem API): colar à mão na caixa
      setPasteNote('Toca na caixa e escolhe “Colar”.')
      textRef.current?.focus()
    }
  }

  function onDragOver(e: DragEvent) {
    if (busy || !Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    if (!dragging) setDragging(true)
  }
  function onDragLeave(e: DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
  }
  function onDrop(e: DragEvent) {
    setDragging(false)
    if (busy) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length) {
      e.preventDefault()
      void importer.importFiles(files)
    }
  }

  const pct = busy?.progress != null ? Math.round(Math.max(0, Math.min(1, busy.progress)) * 100) : null
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  return (
    <div
      className={cx(styles.source, dragging && styles.sourceDragging, className)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.tiles} role="group" aria-label="Importar lista de">
        <button
          type="button"
          className={styles.tile}
          onClick={() => { importer.clearError(); setPanel(null); open(pdfRef) }}
          disabled={!!busy}
        >
          <span className={styles.tileIcon}><IconPdf /></span>
          <span className={styles.tileLabel}>PDF</span>
          <span className={styles.tileSub}>Ficheiro da setlist</span>
        </button>
        <button
          type="button"
          className={styles.tile}
          onClick={() => { importer.clearError(); setPanel(null); open(photoRef) }}
          disabled={!!busy}
        >
          <span className={styles.tileIcon}><IconCamera /></span>
          <span className={styles.tileLabel}>Foto</span>
          <span className={styles.tileSub}>Papel ou screenshot</span>
        </button>
        <button
          type="button"
          className={cx(styles.tile, panel === 'text' && styles.tileOn)}
          onClick={toggleText}
          aria-expanded={panel === 'text'}
          aria-controls={textId}
          disabled={!!busy}
        >
          <span className={styles.tileIcon}><IconText /></span>
          <span className={styles.tileLabel}>Texto</span>
          <span className={styles.tileSub}>Colar a lista</span>
        </button>
      </div>

      {panel === 'text' && !busy && (
        <div id={textId} className={styles.panel}>
          {/* Ações por cima da caixa: não ficam debaixo do teclado do telemóvel */}
          <div className={styles.textHead}>
            <span className={cx(styles.hint, styles.textCount)} aria-live="polite">
              {found > 0
                ? <>Encontrei <b>{pad2(found)}</b> música{found === 1 ? '' : 's'}</>
                : text.trim() ? 'Ainda sem músicas — uma por linha' : 'Uma música por linha'}
            </span>
            {canPaste && (
              <button type="button" className={styles.btnSecondary} onClick={() => void pasteFromClipboard()}>
                <IconPaste />Colar
              </button>
            )}
            <button type="button" className={styles.btnPrimary} onClick={submitText} disabled={found === 0}>
              Ler lista
            </button>
          </div>
          {pasteNote && <p className={styles.hint}>{pasteNote}</p>}
          <label htmlFor={`${textId}-area`} className={styles.srOnly}>Lista de músicas, uma por linha</label>
          <textarea
            id={`${textId}-area`}
            ref={textRef}
            className={styles.textarea}
            value={text}
            onChange={e => { setText(e.target.value); setPasteNote(null) }}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitText() } }}
            placeholder={TEXT_PLACEHOLDER}
            spellCheck={false}
            autoCapitalize="sentences"
            rows={7}
          />
          <span className={styles.hint}>Números, tons e durações são ignorados · mensagens de WhatsApp servem</span>
        </div>
      )}

      {!hideHint && !panel && !busy && (
        <div className={styles.hints}>
          <p className={styles.hint}>Foto de papel, screenshot de playlist ou mensagem — uma música por linha</p>
          <p className={styles.hint}>
            Foto: folha direita e com luz · letra manuscrita pode falhar
            <span className={styles.hideOnPhone}> · também podes arrastar o PDF para aqui</span>
          </p>
        </div>
      )}

      {busy && (
        <div className={styles.busy} role="status" aria-live="polite">
          <div className={styles.busyTop}>
            <span className={styles.busyLabel}>{busy.label}</span>
            {pct !== null && <span className={styles.busyPct}>{pct}%</span>}
            <button type="button" className={styles.btnGhost} onClick={importer.cancelSource}>Cancelar</button>
          </div>
          <div className={styles.track}>
            {pct === null
              ? <div className={styles.indeterminate} />
              : <div className={styles.fill} style={{ width: `${pct}%` }} />}
          </div>
        </div>
      )}

      {importer.error && !busy && (
        <div className={styles.error} role="alert">
          <IconAlert />
          <span>{importer.error}</span>
          <button type="button" className={styles.iconBtn} onClick={importer.clearError} aria-label="Fechar aviso">
            <IconClose size={16} />
          </button>
        </div>
      )}

      <input ref={pdfRef} type="file" accept="application/pdf,.pdf,.txt,text/plain" hidden onChange={onPicked} />
      {/* Sem `capture`: o sistema oferece câmara, fototeca e ficheiros no mesmo toque */}
      <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={onPicked} />
    </div>
  )
}
