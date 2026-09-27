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
 * Cor do utilizador (concert_theme) com transparência, calculada em JS —
 * o Safari do iPadOS antigo não mistura cores em CSS. Aceita #rgb /
 * #rrggbb; qualquer outro formato é devolvido tal como está.
 */
export function withAlpha(color: string, alpha: number): string {
  // Tolerante a um concert_theme guardado incompleto (cor em falta) —
  // o modo palco nunca pode rebentar por causa de uma preferência
  const m = typeof color === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim()) : null
  if (!m) return color
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
    vars['--lyric-accent-soft'] = withAlpha(accent, 0.14)
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
