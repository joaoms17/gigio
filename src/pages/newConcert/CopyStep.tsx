/* ═══════════════════════════════════════════════════════════════
   Passo 1 › COPIAR CONCERTO — lista dos concertos visíveis (projeto
   escolhido primeiro, mais recentes primeiro); ao escolher, mostra
   01–05 do alinhamento e a opção "copiar também tom e notas".
═══════════════════════════════════════════════════════════════ */
import { useState } from 'react'
import type { ConcertOption, ConcertSong } from './data'
import { dayOfMonth, fold, monthLabel, pad2, shortDate, songsLabel } from './data'
import { IconAlert, IconCheck, IconSearch } from './icons'
import styles from './NewConcertPage.module.css'

const PREVIEW = 5
const FILTER_FROM = 8

export type CopySongsState = ConcertSong[] | 'loading' | 'error'

export interface CopyStepProps {
  /** Já ordenados; null = a carregar */
  concerts: ConcertOption[] | null
  error: string | null
  projectId: string | null
  projectName: string
  selectedId: string | null
  songs: Record<string, CopySongsState | undefined>
  withExtras: boolean
  onToggleExtras: (on: boolean) => void
  onSelect: (id: string) => void
  onRetry: (id: string) => void
}

export default function CopyStep(p: CopyStepProps) {
  const [query, setQuery] = useState('')
  const q = fold(query)
  const list = (p.concerts ?? []).filter(c => !q || fold(`${c.name} ${c.venue ?? ''} ${c.bandName ?? ''}`).includes(q))
  const mine = list.filter(c => c.bandId === p.projectId)
  const others = list.filter(c => c.bandId !== p.projectId)
  const groups = [
    { key: 'mine', label: p.projectId ? p.projectName : 'Pessoal', items: mine },
    { key: 'others', label: p.projectId ? 'Outros projetos' : 'Dos projetos', items: others },
  ].filter(g => g.items.length > 0)

  if (p.concerts === null) {
    return (
      <div className={styles.groups} aria-hidden="true">
        <div className={styles.panel}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={styles.cSkel}>
              <div className="skeleton" style={{ width: 40, height: 34 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: '55%', height: 16 }} />
                <div className="skeleton" style={{ width: '30%', height: 11, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (p.concerts.length === 0) {
    return (
      <div className={styles.emptyPanel}>
        <div className={styles.emptyTitle}>Nada para copiar</div>
        <p className={styles.emptyText}>
          {p.error ? `Não foi possível carregar os concertos: ${p.error}` : 'Ainda não há concertos com músicas. Importa uma lista ou escolhe do repertório.'}
        </p>
      </div>
    )
  }

  return (
    <div className={styles.groups}>
      {p.concerts.length >= FILTER_FROM && (
        <div className={styles.filterWrap}>
          <span className={styles.filterIcon}><IconSearch /></span>
          <input
            className={styles.filterInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filtrar por nome, local ou projeto"
            aria-label="Filtrar concertos"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
          />
        </div>
      )}

      {groups.length === 0 && (
        <p className={styles.noMatch}>Nenhum concerto corresponde a “{query}”.</p>
      )}

      {groups.map(g => (
        <section key={g.key} aria-label={g.label}>
          <h2 className={styles.groupLabel}>
            <span>{g.label}</span>
            <span className={styles.groupCount}>{pad2(g.items.length)}</span>
          </h2>
          <ul className={styles.panel}>
            {g.items.map(c => {
              const on = c.id === p.selectedId
              const songs = p.songs[c.id]
              return (
                <li key={c.id} className={`${styles.cItem} ${on ? styles.cItemOn : ''}`}>
                  <button
                    type="button"
                    className={styles.cRow}
                    onClick={e => {
                      const item = e.currentTarget.closest('li')
                      p.onSelect(c.id)
                      // Mostra a pré-visualização que abre por baixo (a barra fixa não a tapa: scroll-margin)
                      if (!on && item) requestAnimationFrame(() => item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
                    }}
                    aria-expanded={on}
                  >
                    <span className={styles.dateBlock} title={c.date ? shortDate(c.date) : 'Sem data'}>
                      {c.date ? (
                        <>
                          <span className={styles.dateDay}>{dayOfMonth(c.date)}</span>
                          <span className={styles.dateMonth}>{monthLabel(c.date)}</span>
                        </>
                      ) : (
                        <>
                          <span className={`${styles.dateDay} ${styles.dim}`}>--</span>
                          <span className={styles.dateMonth}>s/d</span>
                        </>
                      )}
                    </span>
                    <span className={styles.cInfo}>
                      <span
                        className={`${styles.led} ${c.bandColor ? '' : styles.ledHollow}`}
                        style={c.bandColor ? { background: c.bandColor } : undefined}
                        aria-hidden="true"
                      />
                      <span className={styles.cName}>{c.name}</span>
                      <span className={styles.cMeta}>
                        {[c.bandId !== p.projectId ? (c.bandName ?? 'Pessoal') : null, songsLabel(c.songCount), c.venue].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={`${styles.radio} ${on ? styles.radioOn : ''}`} aria-hidden="true">
                      {on && <IconCheck size={14} />}
                    </span>
                  </button>

                  {on && (
                    <div className={styles.preview}>
                      <CopyPreview concert={c} songs={songs} withExtras={p.withExtras} onRetry={() => p.onRetry(c.id)} />
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={p.withExtras}
                          onChange={e => p.onToggleExtras(e.target.checked)}
                        />
                        <span className={styles.toggleBox} aria-hidden="true"><IconCheck size={14} /></span>
                        <span className={styles.toggleText}>Copiar também tom e notas de cada música</span>
                      </label>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function CopyPreview({ concert, songs, withExtras, onRetry }: {
  concert: ConcertOption
  songs: CopySongsState | undefined
  withExtras: boolean
  onRetry: () => void
}) {
  if (!songs || songs === 'loading') {
    return (
      <div className={styles.previewList} aria-hidden="true">
        {Array.from({ length: Math.min(PREVIEW, concert.songCount) }, (_, i) => (
          <div key={i} className={styles.previewSkel}>
            <div className="skeleton" style={{ width: 18, height: 12 }} />
            <div className="skeleton" style={{ width: `${[62, 48, 70, 40, 55][i]}%`, height: 13 }} />
          </div>
        ))}
      </div>
    )
  }
  if (songs === 'error') {
    return (
      <div className={styles.inlineError} role="alert">
        <IconAlert />
        <span>Não foi possível abrir o alinhamento.</span>
        <button type="button" className={styles.ghostBtn} onClick={onRetry}>Tentar de novo</button>
      </div>
    )
  }
  const hidden = concert.songCount - songs.length
  return (
    <>
      <div className={styles.previewHead}>
        <span>Alinhamento</span>
        <span>{pad2(songs.length)}</span>
      </div>
      <ol className={styles.previewList}>
        {songs.slice(0, PREVIEW).map((s, i) => {
          const key = withExtras ? s.extra.performance_key : null
          const hasNotes = withExtras && !!(s.extra.notes || s.extra.custom_intro || s.extra.custom_ending)
          return (
            <li key={`${s.song.id}-${i}`} className={styles.previewRow}>
              <span className={styles.previewNum}>{pad2(i + 1)}</span>
              <span className={styles.previewTitle}>{s.song.title}</span>
              {hasNotes && <span className={styles.previewNote}>Nota</span>}
              {key && <span className={`${styles.chip} ${styles.chipKey}`}>{key}</span>}
            </li>
          )
        })}
      </ol>
      {songs.length > PREVIEW && (
        <p className={styles.previewMore}>+&nbsp;{songsLabel(songs.length - PREVIEW)}</p>
      )}
      {hidden > 0 && (
        <p className={styles.previewWarn}>
          {hidden === 1 ? 'Uma música não está' : `${hidden} músicas não estão`} disponíve{hidden === 1 ? 'l' : 'is'} para ti e fica{hidden === 1 ? '' : 'm'} de fora.
        </p>
      )}
    </>
  )
}
