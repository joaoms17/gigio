/* ═══════════════════════════════════════════════════════════════
   <ImportReview> — a lista importada, numerada 01…N NA ORDEM ORIGINAL,
   com o estado de cada linha:
     BIBLIOTECA · NOVA · LETRA · A PROCURAR… · NOVA · SEM LETRA · SEM LIGAÇÃO
   Tocar numa linha abre o seletor (trocar correspondência, editar nome,
   remover, subir/descer). Medleys = linhas consecutivas marcadas MEDLEY.
   Cabeçalhos lidos ("SET 2", "INTERVALO") aparecem como divisórias mono
   — não são músicas, mas vê-se que foram entendidos.
   Por cima: a fonte (miniatura), o resumo ("04 A CONFIRMAR" leva às
   linhas incertas, uma a uma), leituras alternativas e as linhas que
   ficaram de fora ("3 linhas ignoradas · ver" — com "repor").
   Não tem scroll próprio: o contentor (modal/página) é que faz scroll.
═══════════════════════════════════════════════════════════════ */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { SetlistImporter } from './useSetlistImport'
import type { ImportRow, RowStatus } from '../../lib/setlistImport/types'
import type { SkippedLine } from '../../lib/setlistImport/parse'
import { ROW_STATUS_LABEL, isUncertain, medleyPosition, rowStatus } from '../../lib/setlistImport/rows'
import { resultSourceLabel } from '../../lib/setlistImport/match'
import { normalizeTitle, pad2 } from '../../lib/setlistImport/text'
import MatchPicker from './MatchPicker'
import StatusChip from './StatusChip'
import {
  IconAlert, IconChevronRight, IconClose, IconDown, IconPlus, IconRetry, IconUp,
} from './icons'
import styles from './Import.module.css'

export interface ImportReviewProps {
  importer: SetlistImporter
  /** Ids de músicas que já estão no concerto — mostra "JÁ NO CONCERTO" */
  existingSongIds?: ReadonlySet<string>
  /** As que já estão no concerto vão ser saltadas: a linha fica esbatida ("JÁ NO CONCERTO · SALTA") */
  skipExisting?: boolean
  /** Esconde a faixa de resumo mono */
  hideSummary?: boolean
  /** Esconde o campo "Acrescentar música" no fim */
  hideAddLine?: boolean
  /** Conteúdo extra por cima da lista (avisos do contentor: banda errada, modo de importação…) */
  top?: ReactNode
  /**
   * O contentor está a gravar (ex.: a criar o concerto antes/depois de `commit()`): a lista
   * fica só de leitura e o seletor fecha. Durante `commit()` já fica desativada sozinha.
   */
  disabled?: boolean
  className?: string
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

const SKIP_LABEL: Record<SkippedLine['reason'], string> = {
  prose: 'Frase',
  chat: 'Conversa',
  app: 'Ecrã da app',
  end: 'Sugestões da app',
  repeat: 'Repetida (mini-player)',
  title: 'Título',
  date: 'Data / local',
  label: 'Informação',
  other: 'Outro',
}

function rowDetail(row: ImportRow, status: RowStatus): ReactNode {
  const c = row.choice
  if (c?.kind === 'library') {
    const differs = normalizeTitle(c.song.title) !== normalizeTitle(row.title)
    const confirm = isUncertain(row) ? <span className={cx(styles.monoTag, styles.monoWarn)}>A confirmar</span> : null
    if (differs) {
      return (
        <>
          <IconChevronRight size={14} />
          <span className={styles.rowDetailText}>
            {c.song.title}{c.song.artist ? <span className={styles.muted}> · {c.song.artist}</span> : null}
          </span>
          {confirm}
        </>
      )
    }
    return <><span className={cx(styles.rowDetailText, styles.muted)}>{c.song.artist || 'No repertório'}</span>{confirm}</>
  }
  if (c?.kind === 'online') {
    const r = c.result
    return (
      <>
        <span className={styles.rowDetailText}>
          {r.title}<span className={styles.muted}> — {r.artist}</span>
        </span>
        <span className={styles.monoTag}>{resultSourceLabel(r)}</span>
        {isUncertain(row) && <span className={cx(styles.monoTag, styles.monoWarn)}>A confirmar</span>}
      </>
    )
  }
  if (status === 'searching') return row.artist ? <span className={cx(styles.rowDetailText, styles.muted)}>{row.artist}</span> : null
  // Sem letra: diz o que acontece E que tocar na linha procura (sem isto não se via que a linha abre o seletor)
  const act = (
    <span className={styles.rowAct} aria-hidden="true">
      Procurar<IconChevronRight size={12} />
    </span>
  )
  if (status === 'offline') {
    return <><span className={cx(styles.rowDetailText, styles.muted)}>A pesquisa falhou — fica sem letra</span>{act}</>
  }
  return (
    <>
      <span className={cx(styles.rowDetailText, styles.muted)}>
        {row.artist ? `${row.artist} · ` : ''}letra adiciona-se depois
      </span>
      {act}
    </>
  )
}

export default function ImportReview({ importer, existingSongIds, skipExisting, hideSummary, hideAddLine, top, disabled: saving, className }: ImportReviewProps) {
  const { rows, counts } = importer
  // A gravar (do contentor ou do próprio commit): nada na lista se mexe
  const committing = importer.committing || !!saving
  const [pickerId, setPickerId] = useState<string | null>(null)
  /** O seletor foi aberto pelo "A CONFIRMAR": ao escolher, passa à linha incerta seguinte */
  const [confirmRun, setConfirmRun] = useState(false)
  const [addText, setAddText] = useState('')
  const [undoHiddenFor, setUndoHiddenFor] = useState<string | null>(null)
  const [showIgnored, setShowIgnored] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const disabled = committing
  const loadingLib = importer.libraryLoading

  // Começou a gravar com o seletor aberto: fecha-o (as escolhas feitas a meio não entravam)
  const [wasCommitting, setWasCommitting] = useState(committing)
  if (wasCommitting !== committing) {
    setWasCommitting(committing)
    if (committing) {
      setPickerId(null)
      setConfirmRun(false)
    }
  }

  // "Desfazer" some ao fim de alguns segundos
  const lastRemovedId = importer.lastRemoved?.id ?? null
  useEffect(() => {
    if (!lastRemovedId) return
    const t = setTimeout(() => setUndoHiddenFor(lastRemovedId), 8000)
    return () => clearTimeout(t)
  }, [lastRemovedId])
  const showUndo = !!importer.lastRemoved && undoHiddenFor !== lastRemovedId && !committing

  // Ampliação da fonte: Escape fecha
  useEffect(() => {
    if (!zoom) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setZoom(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoom])

  const pickerIndex = pickerId ? rows.findIndex(r => r.id === pickerId) : -1
  const pickerRow = pickerIndex >= 0 ? rows[pickerIndex] : null

  const needOnline = counts.online + counts.empty + counts.searching + counts.offline
  const resolvedOnline = needOnline - counts.searching
  const ignored = importer.ignored

  function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (importer.addLines(addText) > 0) setAddText('')
  }

  /** Próxima linha incerta depois de `fromId` (ou a primeira) */
  function nextUncertain(fromId: string | null): string | null {
    const start = fromId ? rows.findIndex(r => r.id === fromId) + 1 : 0
    const after = rows.slice(start).find(isUncertain)
    return after?.id ?? null
  }

  function openConfirmRun() {
    const first = nextUncertain(null)
    if (!first) return
    setConfirmRun(true)
    setPickerId(first)
  }

  function closePicker(chose: boolean) {
    if (confirmRun && chose && pickerId) {
      const next = nextUncertain(pickerId)
      if (next) { setPickerId(next); return }
    }
    setConfirmRun(false)
    setPickerId(null)
  }

  /** Item do resumo; o LED tem a cor do chip de estado das linhas (legenda) */
  const sumItem = (n: number, label: string, led?: string) => (
    <span className={styles.sumItem}>
      {led && <span className={cx(styles.sumLed, led)} aria-hidden="true" />}
      <b>{pad2(n)}</b> {label}
    </span>
  )

  return (
    <div className={cx(styles.review, className)}>
      {importer.previews.length > 0 && (
        <div className={styles.sourceStrip}>
          <span className={styles.sourceStripLabel}>Lido de</span>
          <div className={styles.thumbs}>
            {importer.previews.map((url, i) => (
              <button
                key={url}
                type="button"
                className={styles.thumb}
                onClick={() => setZoom(url)}
                aria-label={`Ver a fonte${importer.previews.length > 1 ? ` (${i + 1} de ${importer.previews.length})` : ''} em grande`}
              >
                <img src={url} alt="" />
              </button>
            ))}
          </div>
          <span className={styles.sourceStripHint}>Toca para comparar</span>
        </div>
      )}

      {!hideSummary && (
        <div className={styles.summary} aria-live="polite">
          {sumItem(counts.total, `música${counts.total === 1 ? '' : 's'}`)}
          {counts.library > 0 && sumItem(counts.library, 'na biblioteca', styles.sumLedLibrary)}
          {counts.online > 0 && sumItem(counts.online, `nova${counts.online === 1 ? '' : 's'} com letra`, styles.sumLedOnline)}
          {counts.empty > 0 && sumItem(counts.empty, 'sem letra', styles.sumLedEmpty)}
          {counts.offline > 0 && sumItem(counts.offline, 'sem ligação', styles.sumLedOffline)}
          {counts.repeat > 0 && sumItem(counts.repeat, `repetida${counts.repeat === 1 ? '' : 's'}`, styles.sumLedEmpty)}
          {counts.searching > 0 && (
            <span className={cx(styles.sumItem, styles.summaryLive)}>
              <span className={styles.led} aria-hidden="true" />
              {loadingLib ? 'A carregar o repertório' : <>A procurar <b>{pad2(resolvedOnline)}/{pad2(needOnline)}</b></>}
            </span>
          )}
          {counts.uncertain > 0 && !committing && (
            <button type="button" className={styles.confirmBtn} onClick={openConfirmRun}>
              <b>{pad2(counts.uncertain)}</b> a confirmar<IconChevronRight size={14} />
            </button>
          )}
        </div>
      )}

      {counts.searching > 0 && needOnline > 0 && !loadingLib && (
        <div className={styles.track} aria-hidden="true">
          <div className={styles.fill} style={{ width: `${Math.round((resolvedOnline / needOnline) * 100)}%` }} />
        </div>
      )}

      {importer.libraryError && !committing && (
        <div className={cx(styles.notice, styles.noticeWarn)} role="alert">
          <span>
            Não foi possível carregar o repertório ({importer.libraryError}). Sem ele não se sabe que músicas já existem —
            criar agora duplicava-as.
          </span>
          <button type="button" className={styles.btnSecondary} onClick={importer.reloadLibrary}>
            <IconRetry />Tentar de novo
          </button>
        </div>
      )}

      {counts.offline > 0 && !committing && (
        <div className={cx(styles.notice, styles.noticeWarn)} role="alert">
          <span>
            {counts.offline === 1 ? 'Uma pesquisa falhou' : `${counts.offline} pesquisas falharam`} por falta de rede —
            {counts.offline === 1 ? ' essa música fica' : ' essas músicas ficam'} sem letra.
          </span>
          <button type="button" className={styles.btnSecondary} onClick={importer.retryOffline}>
            <IconRetry />Tentar de novo
          </button>
        </div>
      )}

      {importer.suggestion && !committing && (
        <div className={cx(styles.notice, styles.noticeInfo)} role="status">
          <span>
            {importer.suggestion.kind === 'commas'
              ? <>A lista veio numa só linha, separada por vírgulas.</>
              : <>Cada linha tem duas colunas — lidas como <b>título – artista</b>. São duas listas lado a lado?</>}
          </span>
          <span className={styles.noticeActions}>
            <button type="button" className={styles.btnGhost} onClick={importer.dismissSuggestion}>Está bem assim</button>
            <button type="button" className={styles.btnSecondary} onClick={importer.applySuggestion}>
              {importer.suggestion.kind === 'commas' ? 'Separar por vírgulas' : 'Ler coluna a coluna'}
              <span className={styles.btnCount}>{pad2(importer.suggestion.count)}</span>
            </button>
          </span>
        </div>
      )}

      {top}

      {rows.length === 0 ? (
        <div className={cx(styles.list, styles.emptyList)}>
          <div className={styles.emptyTitle}>Lista vazia</div>
          <p className={styles.emptyText}>Acrescenta músicas abaixo ou volta atrás para importar outra lista.</p>
        </div>
      ) : (
        <ol className={styles.list} aria-label="Músicas importadas, pela ordem">
          {rows.map((row, i) => {
            const status = rowStatus(row, loadingLib)
            const medley = medleyPosition(rows, i)
            const already = row.choice?.kind === 'library' && !!existingSongIds?.has(row.choice.song.id)
            const detail = rowDetail(row, status)
            // Cabeçalho lido na lista ("SET 2", "INTERVALO", "ENCORE"): divisória mono antes da 1.ª música da secção
            const section = row.section && row.section !== rows[i - 1]?.section ? row.section : null
            return (
              <Fragment key={row.id}>
              {section && (
                <li className={styles.sectionRow} role="separator" aria-label={`Secção: ${section}`}>
                  <span>{section}</span>
                </li>
              )}
              <li
                className={cx(
                  styles.row,
                  medley && styles.rowMedley,
                  medley?.index === 0 && styles.rowMedleyFirst,
                  medley && medley.index === medley.size - 1 && styles.rowMedleyLast,
                  already && skipExisting && styles.rowSkipped,
                )}
              >
                <button
                  type="button"
                  className={styles.rowMain}
                  onClick={() => { setConfirmRun(false); setPickerId(row.id) }}
                  disabled={disabled}
                  aria-label={`${pad2(i + 1)} · ${row.title} — ${ROW_STATUS_LABEL[status]}${isUncertain(row) ? ', a confirmar' : ''}. Trocar correspondência`}
                >
                  <span className={styles.num} aria-hidden="true">{pad2(i + 1)}</span>
                  <span className={styles.rowBody}>
                    {row.note && <span className={styles.rowNote}>{row.note}</span>}
                    <span className={styles.rowTitle}>{row.title}</span>
                    {/* Estado + correspondência na mesma linha (quebra só quando não cabe) */}
                    <span className={styles.rowSub}>
                      <span className={styles.rowMeta}>
                        <StatusChip status={status} />
                        {medley && <span className={styles.chip}>Medley</span>}
                        {row.key && <span className={cx(styles.chip, styles.chipKey)}>{row.key}</span>}
                        {row.repeat && <span className={cx(styles.chip, styles.chipEmpty)}>Repetida</span>}
                        {already && <span className={cx(styles.chip, styles.chipOutline)}>{skipExisting ? 'Já no concerto · salta' : 'Já no concerto'}</span>}
                      </span>
                      {detail && (
                        <span className={cx(styles.rowDetail, (status === 'empty' || status === 'offline') && styles.rowDetailWrap)}>
                          {detail}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={cx(styles.iconBtn, styles.hideOnPhone)}
                    onClick={() => importer.move(row.id, -1)}
                    disabled={disabled || i === 0}
                    aria-label={`Subir ${row.title}`}
                  >
                    <IconUp />
                  </button>
                  <button
                    type="button"
                    className={cx(styles.iconBtn, styles.hideOnPhone)}
                    onClick={() => importer.move(row.id, 1)}
                    disabled={disabled || i === rows.length - 1}
                    aria-label={`Descer ${row.title}`}
                  >
                    <IconDown />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => importer.remove(row.id)}
                    disabled={disabled}
                    aria-label={`Remover ${row.title} da lista`}
                  >
                    <IconClose size={18} />
                  </button>
                </div>
              </li>
              </Fragment>
            )
          })}
        </ol>
      )}

      {showUndo && importer.lastRemoved && (
        <div className={cx(styles.notice, styles.noticeUndo)} role="status">
          <span>Removida: <b>{importer.lastRemoved.title}</b></span>
          <button type="button" className={styles.btnGhost} onClick={importer.undoRemove}>Desfazer</button>
        </div>
      )}

      {ignored.length > 0 && !committing && (
        <div className={styles.ignored}>
          <button
            type="button"
            className={styles.ignoredToggle}
            onClick={() => setShowIgnored(v => !v)}
            aria-expanded={showIgnored}
          >
            <IconAlert size={16} />
            <span>
              <b>{pad2(ignored.length)}</b> linha{ignored.length === 1 ? '' : 's'} ignorada{ignored.length === 1 ? '' : 's'}
            </span>
            <span className={styles.ignoredAct}>{showIgnored ? 'Esconder' : 'Ver'}</span>
          </button>
          {showIgnored && (
            <ul className={styles.ignoredList}>
              {ignored.map(s => (
                <li key={s.order} className={styles.ignoredRow}>
                  <span className={styles.ignoredBody}>
                    <span className={styles.ignoredText}>{s.text}</span>
                    <span className={styles.ignoredWhy}>{SKIP_LABEL[s.reason]}</span>
                  </span>
                  <button type="button" className={styles.btnGhost} onClick={() => importer.restoreIgnored(s.order)}>
                    <IconPlus size={16} />Repor
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!hideAddLine && !committing && (
        <form className={styles.addLine} onSubmit={submitAdd}>
          <input
            className={styles.input}
            value={addText}
            onChange={e => setAddText(e.target.value)}
            placeholder="Acrescentar música…"
            aria-label="Acrescentar música ao fim da lista"
            enterKeyHint="done"
            autoComplete="off"
          />
          <button type="submit" className={styles.btnSecondary} disabled={!addText.trim()}>
            <IconPlus />Acrescentar
          </button>
        </form>
      )}

      {pickerRow && !committing && (
        <MatchPicker
          importer={importer}
          row={pickerRow}
          index={pickerIndex}
          total={rows.length}
          remaining={confirmRun ? rows.filter(isUncertain).length : 0}
          onClose={closePicker}
        />
      )}

      {zoom && (
        <div className={styles.zoomOverlay} onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label="Fonte da lista">
          <img className={styles.zoomImg} src={zoom} alt="Lista original" onClick={e => e.stopPropagation()} />
          <button type="button" className={cx(styles.iconBtn, styles.zoomClose)} onClick={() => setZoom(null)} aria-label="Fechar">
            <IconClose />
          </button>
        </div>
      )}
    </div>
  )
}
