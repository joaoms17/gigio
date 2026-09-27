/* ═══════════════════════════════════════════════════════════════
   Passo 2 — "REVER E CRIAR" (comum a todas as origens):
   Nome (sugerido sempre: nunca bloqueia) · Data · Local + a lista
   01…N pela ordem.
═══════════════════════════════════════════════════════════════ */
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ImportReview, type SetlistImporter } from '../../components/import'
import SongListReview from './SongListReview'
import { pad2, searchVenues, type VenueSuggestion } from './data'
import type { Mode } from './types'
import { IconBlank, IconCheck } from './icons'
import styles from './NewConcertPage.module.css'

export interface ReviewStepProps {
  mode: Mode
  /** Importador da lista (null em "começar vazio") */
  importer: SetlistImporter | null
  /** "PDF · Setlist Quinta da Ribeira" */
  sourceText: string | null
  /** Aviso quando a lista vem de outro projeto */
  crossNote: string | null
  name: string
  onName: (v: string) => void
  /** Nome usado se o campo ficar vazio (título lido, local/projeto + data…) */
  namePlaceholder: string
  nameRef: RefObject<HTMLInputElement | null>
  date: string
  onDate: (v: string) => void
  venue: string
  onVenue: (v: string) => void
  disabled: boolean
  /** Concerto pessoal (a página do concerto pessoal não tem "Importar") */
  isPersonal: boolean
  /** Cópia de um concerto: copiar também tom e notas (ligado por defeito) */
  copyExtras?: boolean
  onCopyExtras?: (on: boolean) => void
  /** Aviso por cima da lista (ex.: "15 de 18 estão no repertório de Banda B") */
  notice?: ReactNode
}

export default function ReviewStep({
  mode, importer, sourceText, crossNote, name, onName, namePlaceholder, nameRef,
  date, onDate, venue, onVenue, disabled, isPersonal, copyExtras, onCopyExtras, notice,
}: ReviewStepProps) {
  const uid = useId()
  const count = mode === 'empty' ? 0 : (importer?.rows.length ?? 0)

  return (
    <div className={styles.review}>
      {/* Aviso importante (ex.: a lista é de outra banda) no topo — visível também no telemóvel */}
      {notice && <div className={styles.reviewNotice}>{notice}</div>}

      <section className={styles.details} aria-labelledby={`${uid}-details`}>
        <h2 id={`${uid}-details`} className={styles.groupLabel}><span>Detalhes</span></h2>
        <div className={styles.detailsPanel}>
          <div className={styles.field}>
            <label htmlFor={`${uid}-name`} className={styles.fieldLabel}>Nome</label>
            <input
              id={`${uid}-name`}
              ref={nameRef}
              className={styles.input}
              value={name}
              onChange={e => onName(e.target.value)}
              placeholder={namePlaceholder}
              enterKeyHint="next"
              autoComplete="off"
              disabled={disabled}
            />
          </div>
          <div className={styles.fieldRow}>
            <div className={`${styles.field} ${styles.fieldDate}`}>
              <label htmlFor={`${uid}-date`} className={styles.fieldLabel}>Data</label>
              <input
                id={`${uid}-date`}
                type="date"
                className={`${styles.input} ${styles.inputDate}`}
                value={date}
                onChange={e => onDate(e.target.value)}
                disabled={disabled}
              />
            </div>
            <VenueField id={`${uid}-venue`} value={venue} onChange={onVenue} disabled={disabled} />
          </div>
        </div>
      </section>

      <section className={styles.lineup} aria-labelledby={`${uid}-lineup`}>
        <h2 id={`${uid}-lineup`} className={styles.groupLabel}>
          <span>Alinhamento</span>
          <span className={styles.groupCount}>{pad2(count)}</span>
        </h2>
        {sourceText && <p className={styles.sourceLine}>{sourceText}</p>}
        {crossNote && <p className={styles.note}>{crossNote}</p>}
        {mode === 'copy' && onCopyExtras && (
          <label className={styles.toggle}>
            <input type="checkbox" checked={!!copyExtras} onChange={e => onCopyExtras(e.target.checked)} disabled={disabled} />
            <span className={styles.toggleBox} aria-hidden="true"><IconCheck size={14} /></span>
            <span className={styles.toggleText}>Copiar também tom e notas de cada música</span>
          </label>
        )}

        {mode === 'import' && importer && <ImportReview importer={importer} />}
        {(mode === 'copy' || mode === 'library') && importer && (
          <SongListReview importer={importer} showStatus={!!crossNote} />
        )}
        {mode === 'empty' && (
          <div className={styles.emptyPanel}>
            <span className={styles.emptyIcon}><IconBlank size={28} /></span>
            <div className={styles.emptyTitle}>Concerto vazio</div>
            <p className={styles.emptyText}>
              {isPersonal
                ? 'Depois de criar, abre-se o repertório para juntares as músicas.'
                : 'Depois de criar, abre-se o repertório para juntares as músicas — ou importas a lista lá dentro.'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

/* ── Local, com sugestões (OpenStreetMap / Nominatim) ── */

function VenueField({ id, value, onChange, disabled }: {
  id: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const [suggestions, setSuggestions] = useState<VenueSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    ctrl.current?.abort()
  }, [])

  function onInput(v: string) {
    onChange(v)
    if (timer.current) clearTimeout(timer.current)
    ctrl.current?.abort()
    const q = v.trim()
    if (q.length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }
    timer.current = setTimeout(() => {
      const c = new AbortController()
      ctrl.current = c
      searchVenues(q, c.signal)
        .then(s => {
          if (c.signal.aborted) return
          setSuggestions(s)
          setOpen(s.length > 0)
        })
        .catch(() => { /* sem rede / cancelado — sem sugestões */ })
    }, 400)
  }

  function pick(s: VenueSuggestion) {
    onChange(s.name)
    setOpen(false)
    setSuggestions([])
  }

  const listId = `${id}-list`
  return (
    <div className={`${styles.field} ${styles.fieldVenue}`}>
      <label htmlFor={id} className={styles.fieldLabel}>Local <span className={styles.optional}>(opcional)</span></label>
      <input
        id={id}
        className={styles.input}
        value={value}
        onChange={e => onInput(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
        placeholder="Ex.: Hard Club"
        autoComplete="off"
        enterKeyHint="done"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
      />
      {open && suggestions.length > 0 && (
        <ul id={listId} className={styles.venueDrop} role="listbox">
          {suggestions.map((s, i) => (
            <li key={`${s.name}-${i}`} role="option" aria-selected="false">
              <button
                type="button"
                className={styles.venueItem}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(s)}
              >
                <span className={styles.venueName}>{s.name}</span>
                {s.detail && <span className={styles.venueDetail}>{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
