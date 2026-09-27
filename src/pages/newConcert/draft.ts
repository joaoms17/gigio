/* ═══════════════════════════════════════════════════════════════
   Rascunho do "Novo concerto" em sessionStorage: a lista em revisão
   (com as correspondências corrigidas), a origem, nome/data/local e
   o PARA. Sobrevive a sair da página, ao "voltar" do gesto e ao
   recarregar do Safari depois de tirar uma foto (falta de memória).
   Só para o separador atual; apaga-se ao criar ou ao descartar.
═══════════════════════════════════════════════════════════════ */
import type { ImporterSnapshot } from '../../components/import'
import type { Mode } from './types'

const KEY = 'gigio-new-concert-draft'
/** Rascunhos mais velhos do que isto não são oferecidos */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface DraftListOrigin {
  key: string
  project: string | null
  label: string
  /** Músicas do concerto copiado que não estão visíveis para o utilizador (ficam de fora) */
  hidden?: number
}

export interface NewConcertDraft {
  v: 1
  userId: string
  savedAt: number
  mode: Mode | null
  /** O utilizador escolheu o PARA à mão (senão usa o valor por defeito) */
  projectSet: boolean
  project: string | null
  nameDraft: string | null
  date: string
  venue: string
  file: ImporterSnapshot | null
  list: ImporterSnapshot | null
  listOrigin: DraftListOrigin | null
  copyExtras: boolean
  /**
   * Id do concerto desta criação (gerado no cliente antes de gravar): retomar o rascunho e
   * repetir escreve no MESMO concerto — nunca cria um segundo.
   */
  concertId?: string | null
}

export function readDraft(userId: string | null): NewConcertDraft | null {
  if (!userId) return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as NewConcertDraft
    if (d?.v !== 1 || d.userId !== userId || Date.now() - d.savedAt > MAX_AGE_MS) return null
    const rows = (d.file?.rows.length ?? 0) + (d.list?.rows.length ?? 0)
    return rows > 0 ? d : null
  } catch {
    return null
  }
}

export function writeDraft(d: NewConcertDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(d))
  } catch { /* cheio / modo privado — o rascunho é só uma conveniência */ }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch { /* ignora */ }
}

/** Quantas músicas tem o rascunho (a lista da origem escolhida) */
export function draftCount(d: NewConcertDraft): number {
  const snap = d.mode === 'import' ? d.file : d.mode === 'copy' || d.mode === 'library' ? d.list : (d.file ?? d.list)
  return snap?.rows.length ?? 0
}

/** "há 5 min", "há 2 h" */
export function agoLabel(ts: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ts) / 60000))
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} min`
  return `há ${Math.round(min / 60)} h`
}
