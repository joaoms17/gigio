/* ═══════════════════════════════════════════════════════════════
   Seletor de correspondência de uma linha: editar o nome (volta a
   procurar), escolher outra música do repertório, outro resultado
   online, ou "criar sem letra". Também remove / sobe / desce.
   Mostra o que foi LIDO (para corrigir gralhas de OCR sem ir à foto)
   e, numa escolha automática incerta, "Confirmar".
═══════════════════════════════════════════════════════════════ */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SetlistImporter } from './useSetlistImport'
import type { ImportRow, LibrarySong } from '../../lib/setlistImport/types'
import { rankLibrary, resultSourceLabel, CONFIDENT_SCORE, type RankedResult } from '../../lib/setlistImport/match'
import { isUncertain, rowStatus } from '../../lib/setlistImport/rows'
import { normalizeTitle, pad2 } from '../../lib/setlistImport/text'
import {
  IconCheck, IconClose, IconDown, IconEmpty, IconRetry, IconSearch, IconSwap, IconTrash, IconUp,
} from './icons'
import styles from './Import.module.css'

interface MatchPickerProps {
  importer: SetlistImporter
  row: ImportRow
  index: number
  total: number
  /** A percorrer as linhas "a confirmar": quantas faltam (0 = abertura normal) */
  remaining?: number
  /** `chose` = fez uma escolha (numa sequência "a confirmar", passa à seguinte) */
  onClose(chose: boolean): void
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export default function MatchPicker({ importer, row, index, total, remaining = 0, onClose }: MatchPickerProps) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  // Rascunho do nome; null = segue a linha (outra linha = outro rascunho)
  const [draft, setDraft] = useState<{ id: string; title: string; artist: string } | null>(null)
  const ownDraft = draft?.id === row.id ? draft : null
  const title = ownDraft?.title ?? row.title
  const artist = ownDraft?.artist ?? row.artist
  const changed = title.trim() !== row.title || artist.trim() !== row.artist
  const status = rowStatus(row, importer.libraryLoading)
  const choice = row.choice
  const uncertain = isUncertain(row)
  // O que foi lido (sem a numeração/tom): só quando difere do nome atual
  const read = row.raw.replace(/\s+/g, ' ').trim()
  const showRead = !!read && normalizeTitle(read) !== normalizeTitle(row.title)
    && normalizeTitle(read) !== normalizeTitle(`${row.title} ${row.artist}`)

  // Escape fecha só o seletor (fase de captura: não chega ao modal por baixo)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current(false)
    }
    window.addEventListener('keydown', onKey, true)
    sheetRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const libraryOptions = useMemo(() => {
    const q = [title, artist].filter(Boolean).join(' ')
    const ranked = rankLibrary(q, importer.library, 6)
    const byTitle = rankLibrary(title, importer.library, 6)
    const seen = new Set<string>()
    const out: LibrarySong[] = []
    const current = choice?.kind === 'library' ? choice.song : null
    for (const s of [...(current ? [current] : []), ...ranked, ...byTitle]) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
      if (out.length >= 6) break
    }
    return out
  }, [title, artist, importer.library, choice])

  const online = row.search
  const onlineOptions: RankedResult[] = useMemo(() => {
    const list = online.results.slice(0, 8)
    if (choice?.kind === 'online' && !list.some(r => r.result.external_id === choice.result.external_id && r.result.source === choice.result.source)) {
      list.unshift({ result: choice.result, score: choice.score })
    }
    return list
  }, [online.results, choice])

  function apply() {
    if (!title.trim()) return
    importer.rename(row.id, title, artist)
    setDraft(null)
  }

  function pickLibrary(song: LibrarySong) { importer.chooseLibrary(row.id, song); onClose(true) }
  function pickOnline(r: RankedResult) { importer.chooseOnline(row.id, r); onClose(true) }
  function pickEmpty() { importer.chooseEmpty(row.id); onClose(true) }
  function removeRow() { importer.remove(row.id); onClose(true) }
  function confirm() { importer.confirmChoice(row.id); onClose(true) }

  const current = choice?.kind === 'library' ? `«${choice.song.title}»${choice.song.artist ? ` de ${choice.song.artist}` : ''}`
    : choice?.kind === 'online' ? `«${choice.result.title}» de ${choice.result.artist}` : ''

  const searching = online.state === 'queued' || online.state === 'searching'
  const isLibrary = (s: LibrarySong) => choice?.kind === 'library' && choice.song.id === s.id
  const isOnline = (r: RankedResult) => choice?.kind === 'online'
    && choice.result.external_id === r.result.external_id && choice.result.source === r.result.source
  const emptySelected = choice?.kind === 'empty' || (!choice && (status === 'empty' || status === 'offline'))

  return (
    <div className={styles.pickerOverlay} onClick={() => onClose(false)}>
      <div
        ref={sheetRef}
        className={styles.picker}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.pickerHead}>
          <div className={styles.pickerHeadText}>
            <div className={styles.kicker}>
              {pad2(index + 1)} / {pad2(total)} · {remaining > 0 ? `A confirmar · faltam ${pad2(remaining)}` : 'Trocar correspondência'}
            </div>
            <h2 id={titleId} className={styles.pickerTitle}>{row.title}</h2>
            {showRead && <p className={styles.pickerRead}>Lido: <span>«{read}»</span></p>}
          </div>
          <button type="button" className={styles.iconBtn} onClick={() => onClose(false)} aria-label="Fechar">
            <IconClose />
          </button>
        </header>

        <div className={styles.pickerBody}>
          {uncertain && (
            <div className={styles.confirmBox}>
              <span>
                {choice?.kind === 'library'
                  ? <>Já tens {current} no repertório — é esta?</>
                  : <>Encontrei {current}. É esta a música?</>}
              </span>
              <button type="button" className={styles.btnPrimary} onClick={confirm}>
                <IconCheck />Sim, é esta
              </button>
            </div>
          )}

          {/* ── Nome ── */}
          <form className={styles.section} onSubmit={e => { e.preventDefault(); apply() }}>
              <div className={styles.fields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Título</span>
                  <input
                    className={styles.input}
                    value={title}
                    onChange={e => setDraft({ id: row.id, title: e.target.value, artist })}
                    enterKeyHint="search"
                    autoComplete="off"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Artista · opcional</span>
                  <input
                    className={styles.input}
                    value={artist}
                    onChange={e => setDraft({ id: row.id, title, artist: e.target.value })}
                    enterKeyHint="search"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className={styles.fieldActions}>
                <button type="submit" className={styles.btnSecondary} disabled={!title.trim() || (!changed && searching)}>
                  <IconSearch />{changed ? 'Guardar e procurar' : 'Procurar de novo'}
                </button>
                {row.artist && !changed && (
                  <button type="button" className={styles.btnGhost} onClick={() => importer.swapTitleArtist(row.id)}>
                    <IconSwap />Trocar título e artista
                  </button>
                )}
              </div>
          </form>

          {/* ── Repertório ── */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionLabel}>
                No repertório{libraryOptions.length > 0 ? ` · ${pad2(libraryOptions.length)}` : ''}
              </span>
            </div>
            {importer.libraryLoading ? (
              <div className={styles.options}>
                <div className={styles.skelOpt}><span className={`skeleton ${styles.skelA}`} /><span className={`skeleton ${styles.skelB}`} /></div>
              </div>
            ) : libraryOptions.length > 0 ? (
              <ul className={styles.options}>
                {libraryOptions.map(s => {
                  const on = isLibrary(s)
                  return (
                    <li key={s.id}>
                      <button type="button" className={cx(styles.opt, on && styles.optOn)} onClick={() => pickLibrary(s)} aria-pressed={on}>
                        <span className={styles.optBody}>
                          <span className={styles.optTitle}>{s.title}</span>
                          <span className={styles.optMeta}>
                            {s.artist && <span className={styles.optArtist}>{s.artist}</span>}
                            {s.has_sync && <span className={cx(styles.chip, styles.chipLibrary)}>Sync</span>}
                          </span>
                        </span>
                        {on && <span className={styles.optCheck}><IconCheck /></span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className={styles.inlineNote}><span>Nada parecido no repertório.</span></div>
            )}
          </section>

          {/* ── Online ── */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionLabel}>
                Online · LRCLIB / Genius{online.state === 'done' && onlineOptions.length > 0 ? ` · ${pad2(onlineOptions.length)}` : ''}
              </span>
            </div>
            {searching ? (
              <div className={styles.options} role="status" aria-label="A procurar">
                {[0, 1, 2].map(i => (
                  <div key={i} className={styles.skelOpt}><span className={`skeleton ${styles.skelA}`} /><span className={`skeleton ${styles.skelB}`} /></div>
                ))}
              </div>
            ) : online.state === 'offline' ? (
              <div className={styles.inlineNote}>
                <span>Sem ligação — a pesquisa falhou.</span>
                <button type="button" className={styles.btnSecondary} onClick={() => importer.retry(row.id)}>
                  <IconRetry />Tentar de novo
                </button>
              </div>
            ) : onlineOptions.length > 0 ? (
              <ul className={styles.options}>
                {onlineOptions.map(r => {
                  const on = isOnline(r)
                  return (
                    <li key={`${r.result.source}-${r.result.external_id}`}>
                      <button type="button" className={cx(styles.opt, on && styles.optOn)} onClick={() => pickOnline(r)} aria-pressed={on}>
                        <span className={styles.optBody}>
                          <span className={styles.optTitle}>{r.result.title}</span>
                          <span className={styles.optMeta}>
                            <span className={styles.optArtist}>{r.result.artist}</span>
                            <span className={cx(styles.chip, r.result.has_sync ? styles.chipLibrary : styles.chipOutline)}>{resultSourceLabel(r.result)}</span>
                            <span className={cx(styles.monoTag, r.score < CONFIDENT_SCORE && styles.monoWarn)}>{r.score}%</span>
                          </span>
                        </span>
                        {on && <span className={styles.optCheck}><IconCheck /></span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : online.state === 'done' ? (
              <div className={styles.inlineNote}><span>Sem resultados para “{online.query}”. Corrige o nome acima e procura de novo.</span></div>
            ) : (
              <div className={styles.inlineNote}>
                <span>Queres outra versão desta música?</span>
                <button type="button" className={styles.btnSecondary} onClick={() => importer.retry(row.id)}>
                  <IconSearch />Procurar online
                </button>
              </div>
            )}
          </section>

          {/* ── Sem letra ── */}
          <section className={styles.section}>
            <ul className={styles.options}>
              <li>
                <button type="button" className={cx(styles.opt, emptySelected && styles.optOn)} onClick={pickEmpty} aria-pressed={emptySelected}>
                  <span className={styles.optIcon}><IconEmpty /></span>
                  <span className={styles.optBody}>
                    <span className={styles.optTitle}>Criar sem letra</span>
                    <span className={styles.optMeta}>Nova música “{row.title}” — a letra adiciona-se depois</span>
                  </span>
                  {emptySelected && <span className={styles.optCheck}><IconCheck /></span>}
                </button>
              </li>
            </ul>
          </section>
        </div>

        <footer className={styles.pickerFoot}>
          <button type="button" className={styles.btnDanger} onClick={removeRow}>
            <IconTrash size={18} />Remover
          </button>
          <span className={styles.spacer} />
          <button type="button" className={styles.iconBtn} onClick={() => importer.move(row.id, -1)} disabled={index === 0} aria-label="Subir na lista">
            <IconUp />
          </button>
          <button type="button" className={styles.iconBtn} onClick={() => importer.move(row.id, 1)} disabled={index >= total - 1} aria-label="Descer na lista">
            <IconDown />
          </button>
          <button type="button" className={styles.btnSecondary} onClick={() => onClose(false)}>Feito</button>
        </footer>
      </div>
    </div>
  )
}
