import type { CSSProperties } from 'react'
import styles from './LyricsView.module.css'

const SECTION_MAP: Record<string, string> = {
  verse: 'VERSO',
  'pre-chorus': 'PRÉ-CHORUS',
  prechorus: 'PRÉ-CHORUS',
  'post-chorus': 'PÓS-CHORUS',
  chorus: 'CHORUS',
  bridge: 'PONTE',
  intro: 'INTRO',
  outro: 'OUTRO',
  hook: 'HOOK',
  refrain: 'REFRÃO',
  instrumental: 'INSTRUMENTAL',
  solo: 'SOLO',
  interlude: 'INTERLÚDIO',
}

export function fmtSection(raw: string) {
  const numMatch = raw.match(/(\d+)\s*$/)
  const num = numMatch ? ' ' + numMatch[1] : ''
  const key = raw.replace(/\d+\s*$/, '').replace(/[:]/g, '').trim().toLowerCase()
  const label = SECTION_MAP[key] ?? raw.replace(/\s*\d+\s*$/, '').toUpperCase()
  return label + num
}

/**
 * Cor → [r, g, b]. Aceita #rgb, #rgba, #rrggbb, #rrggbbaa e rgb()/rgba()
 * (dados antigos do concert_theme); devolve null para qualquer outro formato.
 */
export function parseRgb(color: unknown): [number, number, number] | null {
  // Tolerante a um concert_theme guardado incompleto (cor em falta) —
  // o modo palco nunca pode rebentar por causa de uma preferência
  if (typeof color !== 'string') return null
  const c = color.trim()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c)
  if (hex) {
    let h = hex[1]
    if (h.length <= 4) h = h.split('').map(ch => ch + ch).join('')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const fn = /^rgba?\(\s*(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)/i.exec(c)
  if (fn) {
    const ch = (v: string) => Math.min(255, Math.round(Number(v)))
    return [ch(fn[1]), ch(fn[2]), ch(fn[3])]
  }
  return null
}

/**
 * Cor do utilizador (concert_theme) com transparência, calculada em JS —
 * o Safari do iPadOS antigo não mistura cores em CSS. Um formato que não
 * se reconhece devolve `fallback` (para fundos tintados: nunca a cor opaca,
 * que tapava a letra) ou, sem fallback, a cor tal como está (tintas de texto).
 */
export function withAlpha(color: string, alpha: number, fallback?: string): string {
  const rgb = parseRgb(color)
  if (!rgb) return fallback ?? color
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

export default function LyricsView({ lyrics, activeLine, accent, fontSize, lineHeight }: {
  lyrics: string; activeLine?: number; accent?: string
  fontSize?: number; lineHeight?: number
}) {
  if (!lyrics?.trim()) return <span className={styles.hint}>Sem letra</span>
  const vars: Record<string, string | number> = {}
  if (fontSize) vars['--lyric-size'] = `${fontSize}px`
  if (lineHeight) vars['--lyric-lh'] = lineHeight
  // Acento explícito (modo palco) — senão os rótulos usam o --accent-text da app
  if (accent) {
    vars['--lyric-accent'] = accent
    // Mesma faixa da linha ativa do palco (--stage-accent-soft, 0.14)
    vars['--lyric-accent-soft'] = withAlpha(accent, 0.14, 'transparent')
  }
  const rootStyle = Object.keys(vars).length ? (vars as CSSProperties) : undefined
  return (
    <div className={styles.root} style={rootStyle}>
      {lyrics.split('\n').map((line, i) => {
        const t = line.trim()
        const sec = t.match(/^\[(.+?)\]$/)
        if (sec) return <div key={i} className={styles.section}>{fmtSection(sec[1])}</div>
        if (t === '') return <div key={i} className={styles.break} />
        const active = i === activeLine
        return (
          <div
            key={i}
            data-activeline={active || undefined}
            // Destaque só de fundo + barra: pôr a negrito refazia o fluxo do
            // texto e desalinhava os traços das anotações desenhados por cima
            className={active ? `${styles.line} ${styles.lineActive}` : styles.line}
          >
            {line}
          </div>
        )
      })}
    </div>
  )
}
