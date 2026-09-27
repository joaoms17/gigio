/* ═══════════════════════════════════════════════════════════════
   Revisão da lista copiada / escolhida do repertório: 01…N pela
   ordem, com tom e notas copiados, subir/descer/remover e desfazer.
   (A importação usa <ImportReview>; aqui as músicas já existem.)
═══════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react'
import { StatusChip, type SetlistImporter } from '../../components/import'
import { rowStatus } from '../../lib/setlistImport'
import { pad2 } from './data'
import { IconClose, IconDown, IconUp } from './icons'
import styles from './NewConcertPage.module.css'

export default function SongListReview({ importer, showStatus, disabled }: {
  importer: SetlistImporter
  /** Mostrar o estado de cada linha (cópia de outro projeto: há músicas a procurar/criar) */
  showStatus?: boolean
  /** A criar o concerto: a lista fica só de leitura (também antes/depois de `commit()`) */
  disabled?: boolean
}) {
  const { rows } = importer
  const committing = importer.committing || !!disabled
  const [undoHiddenFor, setUndoHiddenFor] = useState<string | null>(null)

  // "Desfazer" some ao fim de alguns segundos
  const lastRemovedId = importer.lastRemoved?.id ?? null
  useEffect(() => {
    if (!lastRemovedId) return
    const t = setTimeout(() => setUndoHiddenFor(lastRemovedId), 8000)
    return () => clearTimeout(t)
  }, [lastRemovedId])
  const showUndo = !!importer.lastRemoved && undoHiddenFor !== lastRemovedId && !committing

  return (
    <div className={styles.listWrap}>
      {rows.length === 0 ? (
        <div className={styles.emptyPanel}>
          <div className={styles.emptyTitle}>Lista vazia</div>
          <p className={styles.emptyText}>Volta atrás para escolher músicas — ou cria o concerto vazio.</p>
        </div>
      ) : (
        <ol className={styles.list} aria-label="Alinhamento, pela ordem">
          {rows.map((row, i) => {
            const c = row.choice
            const status = rowStatus(row, importer.libraryLoading)
            const libKey = c?.kind === 'library' ? (c.song.performance_key || c.song.original_key || '') : ''
            const key = row.extra?.performance_key || libKey || row.key || ''
            const artist = c?.kind === 'library' ? c.song.artist : c?.kind === 'online' ? c.result.artist : row.artist
            const notes = [
              row.extra?.custom_intro ? `Intro: ${row.extra.custom_intro}` : null,
              row.extra?.custom_ending ? `Final: ${row.extra.custom_ending}` : null,
              row.extra?.notes ? row.extra.notes : null,
            ].filter((n): n is string => !!n)
            return (
              <li key={row.id} className={styles.lRow}>
                <span className={styles.num} aria-hidden="true">{pad2(i + 1)}</span>
                <div className={styles.lBody}>
                  <span className={styles.lTitle}>{row.title}</span>
                  {(artist || key || showStatus) && (
                    <span className={styles.lMeta}>
                      {showStatus && <StatusChip status={status} />}
                      {key && <span className={`${styles.chip} ${styles.chipKey}`}>{key}</span>}
                      {artist && <span className={styles.lArtist}>{artist}</span>}
                    </span>
                  )}
                  {notes.length > 0 && <span className={styles.lNote}>{notes.join(' · ')}</span>}
                </div>
                <div className={styles.lActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => importer.move(row.id, -1)}
                    disabled={committing || i === 0}
                    aria-label={`Subir ${row.title}`}
                  >
                    <IconUp />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => importer.move(row.id, 1)}
                    disabled={committing || i === rows.length - 1}
                    aria-label={`Descer ${row.title}`}
                  >
                    <IconDown />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => importer.remove(row.id)}
                    disabled={committing}
                    aria-label={`Remover ${row.title} da lista`}
                  >
                    <IconClose />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {showUndo && importer.lastRemoved && (
        <div className={styles.undo} role="status">
          <span>Removida: <b>{importer.lastRemoved.title}</b></span>
          <button type="button" className={styles.ghostBtn} onClick={importer.undoRemove}>Desfazer</button>
        </div>
      )}
    </div>
  )
}
