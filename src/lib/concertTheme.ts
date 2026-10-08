import type { ConcertTheme } from '../types'

// Defaults v2 do palco (o concert_theme guardado do utilizador continua a mandar)
export const DEFAULT_CONCERT_THEME: ConcertTheme = {
  bg: '#0B0B0C', active_color: '#F2F1EC', accent_color: '#FF6A26', font_size: 32, line_height: 1.6,
  // A letra aparece como foi escrita (o editor e o PDF também alinham à esquerda)
  align: 'left',
}

// Cores de marca da v1 (rosa/roxo). O default da BD (profiles.concert_theme)
// ainda é o tema v1 — sem isto, quem nunca mexeu nas definições subia ao
// palco com contador, rótulos e play cor-de-rosa.
const LEGACY_ACCENTS = ['#ff4d6d', '#7c3aed']
const LEGACY_BG = '#0d0d0d'
const LEGACY_INK = '#ffffff'

const lc = (c: unknown) => (typeof c === 'string' ? c.trim().toLowerCase() : '')

/**
 * Tema guardado → tema de palco: completa campos em falta com os defaults v2
 * e troca as cores de marca da v1 pelas da v2. Personalizações v2 passam intactas.
 */
export function normalizeConcertTheme(saved: Partial<ConcertTheme> | null | undefined): ConcertTheme {
  const s = saved ?? {}
  const t: ConcertTheme = {
    bg: lc(s.bg) ? s.bg! : DEFAULT_CONCERT_THEME.bg,
    active_color: lc(s.active_color) ? s.active_color! : DEFAULT_CONCERT_THEME.active_color,
    accent_color: lc(s.accent_color) ? s.accent_color! : DEFAULT_CONCERT_THEME.accent_color,
    font_size: typeof s.font_size === 'number' && s.font_size > 0 ? s.font_size : DEFAULT_CONCERT_THEME.font_size,
    line_height: typeof s.line_height === 'number' && s.line_height > 0 ? s.line_height : DEFAULT_CONCERT_THEME.line_height,
    align: s.align === 'center' ? 'center' : 'left',
  }
  if (LEGACY_ACCENTS.includes(lc(t.accent_color))) {
    t.accent_color = DEFAULT_CONCERT_THEME.accent_color
    // Tema v1 nunca personalizado → também o fundo e a tinta passam a v2
    if (lc(t.bg) === LEGACY_BG) t.bg = DEFAULT_CONCERT_THEME.bg
    if (lc(t.active_color) === LEGACY_INK) t.active_color = DEFAULT_CONCERT_THEME.active_color
  }
  if (LEGACY_ACCENTS.includes(lc(t.active_color))) t.active_color = DEFAULT_CONCERT_THEME.active_color
  return t
}
