/* Chip mono do estado de uma linha importada (BIBLIOTECA, NOVA · LETRA, A PROCURAR…, NOVA · SEM LETRA, SEM LIGAÇÃO). */
import type { RowStatus } from '../../lib/setlistImport/types'
import { ROW_STATUS_LABEL } from '../../lib/setlistImport/rows'
import styles from './Import.module.css'

const STATUS_CLASS: Record<RowStatus, string> = {
  library: styles.chipLibrary,
  online: styles.chipOnline,
  searching: '',
  empty: styles.chipEmpty,
  offline: styles.chipOffline,
}

export default function StatusChip({ status }: { status: RowStatus }) {
  return (
    <span className={`${styles.chip} ${STATUS_CLASS[status]}`}>
      {status === 'searching' && <span className={styles.led} aria-hidden="true" />}
      {ROW_STATUS_LABEL[status]}
    </span>
  )
}
