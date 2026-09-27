/* ═══════════════════════════════════════════════════════════════
   Motor de importação de setlists — ponto de entrada.

   texto/PDF/foto ──▶ parseSetlistText ──▶ linhas (rows)
        │                                    │ findLibraryMatch (repertório)
        │                                    │ createResolver + searchOnline (LRCLIB/Genius, máx. 3)
        │                                    ▼
        └────────────────────────▶ commitRows (cria músicas, ORDENADO)
                                             ▼
                                   insertSetlistSongs (um insert em lote)

   O pdf.js e o tesseract.js só são carregados quando se lê um PDF/foto.
   A UI (hook + componentes) está em src/components/import/.
═══════════════════════════════════════════════════════════════ */
export { parseSetlist, parseSetlistText, forceEntry, looksLikeParallelColumns, parseDateText, tidyTitle, isSectionHeader } from './parse'
export type { ParsedSong, SetlistTextEntry, ParseOptions, SetlistParse, SkippedLine, SkipReason, SetlistDocMeta } from './parse'
export { normalizeTitle, matchKey, titleSimilarity, artistSimilarity, smartCase, pad2 } from './text'
export {
  findLibraryMatch, matchLibrary, libraryMatchForResult, rankLibrary, rankResults, scoreResult, resultSourceLabel,
  searchQueryFor, AUTO_PICK_SCORE, CONFIDENT_SCORE, LOOSE_LIBRARY_SCORE,
} from './match'
export type { SongQuery, RankedResult, LibraryCandidate, LibraryMatch } from './match'
export { pairTitleArtist, mergeScreens, arrangeColumns, wordsToCells } from './layout'
export type { OcrLine, Cell, CellRow } from './layout'
export {
  entriesToRows, songsToRows, rowQuery, rowStatus, countRows, isUncertain, autoOnlineChoice, autoChoiceFor,
  preferLibrary, newSongKey, reusableSongId, setlistFieldsFor, medleyPosition, newRowId, insertIndexFor,
  markRepeats, ROW_STATUS_LABEL,
} from './rows'
export { searchOnline, createResolver } from './resolve'
export type { OnlineOutcome, Resolver } from './resolve'
export { readPdf, readImages, readTextFile, fileKind, fileBaseName, sourcePreview } from './sources'
export type { SourceText, FileKind } from './sources'
export { commitRows, summarizeCommit, toSetlistInserts, insertSetlistSongs, replaceSetlistSongs } from './commit'
export type { SetlistSongInsert } from './commit'
export { ImportError, importErrorMessage, humanizeError, isNetworkMessage, isAbort, OFFLINE_MESSAGE } from './errors'
export type { ImportErrorCode } from './errors'
export type * from './types'
