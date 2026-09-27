/* ═══════════════════════════════════════════════════════════════
   Tipos partilhados do motor de importação (linhas em revisão,
   escolhas de correspondência, resultado da gravação).
═══════════════════════════════════════════════════════════════ */
import type { SearchResult, Song } from '../../types'
import type { RankedResult } from './match'

/** Música do repertório como é carregada para correspondência (colunas leves; um `Song` completo também serve). */
export type LibrarySong = Pick<Song, 'id' | 'title' | 'artist'>
  & Partial<Pick<Song, 'has_sync' | 'performance_key' | 'original_key' | 'project_id' | 'owner_id'>>

/** De onde veio a lista. */
export type ImportSourceKind = 'pdf' | 'image' | 'text' | 'library' | 'setlist'

/** Progresso de uma operação longa (ler PDF, OCR). `progress` 0..1 ou null = indeterminado. */
export interface ImportProgress {
  label: string
  progress: number | null
}

/**
 * O que vai ser gravado para uma linha:
 * - `library` — música que já existe no repertório;
 * - `online` — música nova criada a partir de um resultado LRCLIB/Genius (com letra);
 * - `empty` — música nova sem letra (escolha explícita).
 * `null` = ainda por decidir (a pesquisa online decide; sem resultado → criada vazia).
 * `auto: true` = escolhida pelo motor (pode ser refeita se o repertório mudar).
 */
export type RowChoice =
  | { kind: 'library'; song: LibrarySong; auto: boolean; /** Aproximada (abreviatura, gralha) — "A CONFIRMAR" */ loose?: boolean }
  | { kind: 'online'; result: SearchResult; score: number; auto: boolean }
  | { kind: 'empty' }

export type RowSearchState = 'idle' | 'queued' | 'searching' | 'done' | 'offline'

export interface RowSearch {
  state: RowSearchState
  /** Texto pesquisado */
  query: string
  /** Resultados ordenados por confiança (sem duplicados) */
  results: RankedResult[]
  /** Pesquisa escrita à mão no seletor (ordenada por esse texto, não pela linha) */
  custom?: boolean
}

/** Campos de `setlist_songs` que acompanham a música (tom/notas de um concerto copiado). */
export interface SetlistSongExtra {
  performance_key?: string | null
  notes?: string | null
  custom_intro?: string | null
  custom_ending?: string | null
}

export interface ImportRow {
  id: string
  /** Linha original (texto lido) */
  raw: string
  /** Nome (editável) */
  title: string
  /** Artista lido ('' = desconhecido) */
  artist: string
  /** Leitura inversa quando a linha era "A - B" (Artista - Título) */
  swapped?: { title: string; artist: string }
  /** Texto completo da linha limpa (correspondência extra) */
  text?: string
  /** Tom anotado na lista */
  key?: string
  /** Duração anotada (s) */
  durationSec?: number
  /** Secção da lista ("SET 1", "ENCORE") */
  section?: string
  /** Linhas consecutivas com o mesmo id formam um medley */
  medleyId?: string
  choice: RowChoice | null
  search: RowSearch
  /** Campos do concerto a copiar (origem "copiar concerto") */
  extra?: SetlistSongExtra
  /** Música já criada numa gravação anterior (repetir não duplica) */
  songId?: string
  /** Projeto onde `songId` foi criada (null = pessoal): noutro projeto não se reutiliza */
  songProject?: string | null
  /** Posição da linha no documento lido (para repor linhas ignoradas no sítio certo) */
  order?: number
  /** Momento do evento ("Entrada da noiva") — vai para as notas da música no concerto */
  note?: string
  /** A mesma música já está mais acima na lista */
  repeat?: boolean
  /** Tom/notas do concerto copiado (guardados mesmo quando não se copiam: o interruptor volta a pô-los) */
  sourceExtra?: SetlistSongExtra
}

/** Estado visível de uma linha na revisão. */
export type RowStatus = 'library' | 'online' | 'searching' | 'empty' | 'offline'

export interface ImportCounts {
  total: number
  library: number
  online: number
  empty: number
  searching: number
  offline: number
  /** Escolhas automáticas a confirmar (online com confiança baixa, repertório aproximado) */
  uncertain: number
  /** Linhas repetidas */
  repeat: number
}

export interface CommitProgress {
  /** resolving = à espera das pesquisas em curso; saving = a criar músicas */
  phase: 'resolving' | 'saving'
  done: number
  total: number
  /** Nome da música em curso */
  current: string
}

/** Uma linha depois de gravada, pela ORDEM da lista. */
export interface CommittedItem {
  rowId: string
  title: string
  /** null = falhou (ver `error`) */
  songId: string | null
  /** Música nova criada agora */
  created: boolean
  /** Ficou com letra (biblioteca conta como sim) */
  hasLyrics: boolean
  error?: string
  /** Campos para a linha de `setlist_songs` */
  setlist: SetlistSongExtra
}

export interface ImportCommitResult {
  /** Todas as linhas, pela ordem da lista */
  items: CommittedItem[]
  /** Só os ids gravados com sucesso, pela ordem da lista */
  songIds: string[]
  created: number
  reused: number
  failed: number
  /** Criadas sem letra */
  withoutLyrics: number
}
