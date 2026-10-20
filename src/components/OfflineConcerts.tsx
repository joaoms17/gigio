import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { concertWhen } from '../lib/concertWhen'
import { mapLegacyProjectColor } from '../lib/projectColor'
import { sortIndex, type OfflineIndexEntry } from '../lib/offline/logic'
import { listConcerts, onOfflineChange } from '../lib/offline/store'
import styles from './OfflineConcerts.module.css'

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return y && m && d ? WEEKDAYS[new Date(y, m - 1, d).getDay()] ?? '' : ''
}

function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

/**
 * "DISPONÍVEIS OFFLINE": os concertos guardados neste aparelho, para chegar
 * ao palco sem rede a partir da página inicial (ou de um projeto que nunca
 * foi aberto aqui). Próximos primeiro; ▶ entra direto no modo concerto.
 */
export default function OfflineConcerts({ userId, projectId, limit = 6 }: {
  userId: string
  /** Só os deste projeto */
  projectId?: string
  limit?: number
}) {
  const navigate = useNavigate()
  const [list, setList] = useState<OfflineIndexEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => { listConcerts(userId).then(l => { if (alive) setList(l) }, () => { if (alive) setList([]) }) }
    load()
    const unsub = onOfflineChange(load)
    return () => { alive = false; unsub() }
  }, [userId])

  if (!list) return null
  const now = new Date()
  const items = sortIndex(list.filter(e => !projectId || e.bandId === projectId), now).slice(0, limit)

  return (
    <section className={styles.section} aria-labelledby="offline-concerts-label" data-offline-concerts="">
      <div className={styles.head}>
        <span className={styles.led} aria-hidden="true" />
        <h2 id="offline-concerts-label" className={styles.label}>Disponíveis offline</h2>
        <span className={styles.rule} aria-hidden="true" />
        <span className={styles.count}>{String(items.length).padStart(2, '0')}</span>
      </div>
      {items.length === 0 ? (
        <p className={styles.empty}>
          Nenhum concerto guardado neste aparelho. Com rede, os de hoje e dos próximos 14 dias ficam guardados sozinhos.
        </p>
      ) : (
        <div className={styles.panel}>
          {items.map(e => {
            const when = concertWhen(e.date, now)
            const open = () => navigate(`/setlist/${e.setlistId}`)
            const meta = [`${e.songCount} mús`, e.venue].filter(Boolean).join(' · ')
            return (
              <div
                key={e.setlistId}
                className={styles.row}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={ev => {
                  if (ev.target !== ev.currentTarget) return
                  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open() }
                }}
              >
                <div className={styles.date}>
                  <span className={`${styles.day} ${when.kind === 'today' ? styles.dayToday : ''}`}>
                    {e.date ? e.date.slice(8, 10) : '--'}
                  </span>
                  <span className={styles.weekday}>{e.date ? weekday(e.date) : 's/d'}</span>
                </div>
                <div className={styles.info}>
                  <span
                    className={styles.bandLed}
                    style={{ background: e.bandId ? mapLegacyProjectColor(e.bandColor || '#4CC9F0') : 'transparent' }}
                    aria-hidden="true"
                  />
                  <span className={styles.name}>{e.name}</span>
                  <span className={styles.meta}>{e.bandName ? `${e.bandName} · ${meta}` : meta}</span>
                </div>
                {when.label && <span className={styles.chip} data-when={when.kind}>{when.label}</span>}
                <button
                  type="button"
                  className={styles.play}
                  aria-label={`Iniciar concerto ${e.name}`}
                  title="Iniciar concerto"
                  onClick={ev => { ev.stopPropagation(); navigate(`/setlist/${e.setlistId}/concert`) }}
                >
                  <IconPlay />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
