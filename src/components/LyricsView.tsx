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

function fmtSection(raw: string) {
  const numMatch = raw.match(/(\d+)\s*$/)
  const num = numMatch ? ' ' + numMatch[1] : ''
  const key = raw.replace(/\d+\s*$/, '').replace(/[:]/g, '').trim().toLowerCase()
  const label = SECTION_MAP[key] ?? raw.replace(/\s*\d+\s*$/, '').toUpperCase()
  return label + num
}

export default function LyricsView({ lyrics, activeLine, accent }: { lyrics: string; activeLine?: number; accent?: string }) {
  if (!lyrics?.trim()) return <span className={styles.hint}>Sem letra</span>
  return (
    <>
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
            className={styles.line}
            // Background-only highlight: bolding would reflow the text and
            // misalign the annotation strokes drawn over it
            style={active ? { background: (accent ?? '#FF4D6D') + '33', borderRadius: 8 } : undefined}
          >
            {line}
          </div>
        )
      })}
    </>
  )
}
