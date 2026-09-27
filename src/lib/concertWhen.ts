/**
 * Estado de um concerto derivado da DATA (não de um campo manual).
 *
 * A data do concerto ('YYYY-MM-DD') é um dia de calendário: interpreta-se em
 * HORA LOCAL (new Date(y, m-1, d)) — nunca `new Date('YYYY-MM-DD')`, que é UTC
 * e em Portugal no inverno/verão pode cair no dia anterior. A diferença conta
 * dias de calendário (meia-noite a meia-noite), imune a mudanças de hora.
 *
 *   0       → 'HOJE'        (today)
 *   1       → 'AMANHÃ'      (tomorrow)
 *   2–13    → 'EM N DIAS'   (soon)
 *   14–59   → 'EM N SEM'    (soon — semanas arredondadas para baixo)
 *   ≥ 60    → sem rótulo    (later — o bloco de data chega)
 *   < 0     → 'REALIZADO'   (past)
 *   sem data→ sem rótulo    (undated — "ainda por marcar")
 */

export type ConcertWhenKind = 'today' | 'tomorrow' | 'soon' | 'later' | 'past' | 'undated'

export interface ConcertWhen {
  kind: ConcertWhenKind
  /** Rótulo curto em maiúsculas para o chip; null = sem chip */
  label: string | null
  /** Dias de calendário até ao concerto (negativo = passou); null = sem data */
  days: number | null
}

const MS_PER_DAY = 86_400_000

/** 'YYYY-MM-DD' (ou ISO com hora — só conta o dia) → Date local à meia-noite; null se inválida. */
export function parseConcertDate(date: string | null | undefined): Date | null {
  if (!date) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return new Date(y, mo - 1, d)
}

/** Dias de calendário de `now` até `date` (0 = hoje). Via UTC dos componentes locais → sem desvios de DST. */
function calendarDaysBetween(date: Date, now: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / MS_PER_DAY)
}

/** Dias até ao concerto (negativo = passou); null sem data. */
export function concertDaysUntil(date: string | null | undefined, now: Date = new Date()): number | null {
  const day = parseConcertDate(date)
  return day ? calendarDaysBetween(day, now) : null
}

export function concertWhen(date: string | null | undefined, now: Date = new Date()): ConcertWhen {
  const days = concertDaysUntil(date, now)
  if (days === null) return { kind: 'undated', label: null, days: null }
  if (days < 0) return { kind: 'past', label: 'REALIZADO', days }
  if (days === 0) return { kind: 'today', label: 'HOJE', days }
  if (days === 1) return { kind: 'tomorrow', label: 'AMANHÃ', days }
  if (days < 14) return { kind: 'soon', label: `EM ${days} DIAS`, days }
  if (days < 60) return { kind: 'soon', label: `EM ${Math.floor(days / 7)} SEM`, days }
  return { kind: 'later', label: null, days }
}

/**
 * Hoje ou no futuro. Concertos SEM DATA contam como próximos (ainda por marcar) —
 * as listas põem-nos no fim da secção "Próximos", num grupo "Sem data".
 */
export function isUpcoming(date: string | null | undefined, now: Date = new Date()): boolean {
  const days = concertDaysUntil(date, now)
  return days === null || days >= 0
}

/** Ordem dos próximos: por data ascendente (hoje primeiro), sem data no fim. */
export function compareUpcoming(a: { date: string | null }, b: { date: string | null }): number {
  if (!a.date || !b.date) return (a.date ? 0 : 1) - (b.date ? 0 : 1)
  return a.date.slice(0, 10).localeCompare(b.date.slice(0, 10))
}

/** Ordem dos passados: mais recente primeiro. */
export function comparePast(a: { date: string | null }, b: { date: string | null }): number {
  return compareUpcoming(b, a)
}
