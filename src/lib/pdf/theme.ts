/**
 * Paletas do PDF — os mesmos valores dos tokens de src/index.css (claro/escuro).
 * No PDF não há CSS: os "*-soft" já vêm pré-compostos sobre o fundo (cor sólida).
 */
import type { PdfTheme } from './types'
import { mapLegacyProjectColor } from '../projectColor'

export interface Palette {
  /** Fundo da página; null = papel (não pinta — melhor para imprimir). */
  paper: string | null
  /** Painéis (caixa de notas, grelha de acordes). */
  panel: string
  ink: string
  ink2: string
  ink3: string
  hair: string
  hair2: string
  accent: string
  accentText: string
  onAccent: string
}

const LIGHT: Palette = {
  paper: null,
  panel: '#F4F3EF',      // --surface-2
  ink: '#111111',        // --text
  ink2: '#4A4944',       // --text2
  ink3: '#686760',       // --text3
  hair: '#DAD9D3',       // --border
  hair2: '#BDBCB4',      // --border2
  accent: '#FF5B14',     // --accent
  accentText: '#B83B0B', // --accent-text
  onAccent: '#111111',
}

const DARK: Palette = {
  paper: '#0B0B0C',      // --bg
  panel: '#1D1D20',      // --surface-2
  ink: '#F2F1EC',
  ink2: '#B3B2AB',
  ink3: '#8E8D86',
  hair: '#2A2A2E',
  hair2: '#3D3D43',
  accent: '#FF6A26',
  accentText: '#FF8A52',
  onAccent: '#111111',
}

export function palette(theme: PdfTheme | undefined): Palette {
  return theme === 'dark' ? DARK : LIGHT
}

/** Primeira amostra v2 — o que a app mostra para um projeto sem cor. */
const DEFAULT_PROJECT_COLOR = '#4CC9F0'

/** Cor de projeto dos dados → "#RRGGBB" pronto a pintar (remapeia a paleta v1). */
export function projectColor(raw: string | null | undefined): string {
  const mapped = raw?.trim() ? mapLegacyProjectColor(raw.trim()) : DEFAULT_PROJECT_COLOR
  return toHex(mapped) ?? DEFAULT_PROJECT_COLOR
}

/** "#abc" / "#aabbcc" / "rgb(1,2,3)" → "#AABBCC"; null se não reconhecer. */
export function toHex(color: string): string | null {
  const c = color.trim()
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(ch => ch + ch).join('') : hex[1]
    return `#${h.toUpperCase()}`
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c)
  if (rgb) {
    return '#' + [rgb[1], rgb[2], rgb[3]]
      .map(v => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  return null
}
