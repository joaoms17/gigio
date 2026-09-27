/* ═══════════════════════════════════════════════════════════════
   Importador de setlists — componentes reutilizáveis.
   const imp = useSetlistImport({ projectId })
   imp.phase === 'source' → <ImportSource importer={imp} />
   imp.phase === 'review' → <ImportReview importer={imp} />
   gravar: const res = await imp.commit()
           await insertSetlistSongs(setlistId, toSetlistInserts(res), { startPosition: 0 })
═══════════════════════════════════════════════════════════════ */
export { default as ImportSource } from './ImportSource'
export type { ImportSourceProps, ImportSourcePanel } from './ImportSource'
export { default as ImportReview } from './ImportReview'
export type { ImportReviewProps } from './ImportReview'
export { default as StatusChip } from './StatusChip'
export { useSetlistImport } from './useSetlistImport'
export type {
  SetlistImporter, UseSetlistImportOptions, ImportSourceInfo, ImporterSnapshot, ImportSuggestion,
} from './useSetlistImport'
export { insertSetlistSongs, toSetlistInserts } from '../../lib/setlistImport/commit'
export type { SetlistSongInsert } from '../../lib/setlistImport/commit'
export type {
  ImportRow, ImportCommitResult, CommittedItem, CommitProgress, ImportCounts, LibrarySong,
  SetlistSongExtra, RowStatus,
} from '../../lib/setlistImport/types'
