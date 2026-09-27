/* ═══════════════════════════════════════════════════════════════
   Passo 1 › DO REPERTÓRIO — lista com pesquisa e multi-seleção.
   A ordem dos toques define a ordem do concerto: cada música
   escolhida mostra o seu número (01, 02…). Depois de escolher com a
   pesquisa preenchida, o texto fica selecionado: escrever a próxima
   substitui-o ("val" → Valerie → "kiss" → Kiss…).
═══════════════════════════════════════════════════════════════ */
import { useMemo, useRef, useState } from 'react'
import type { LibrarySong } from '../../components/import'
import { fold, pad2 } from './data'
import { IconSearch } from './icons'
import styles from './NewConcertPage.module.css'

const MAX_ROWS = 400

export interface LibraryStepProps {
  library: LibrarySong[]
  loading: boolean
  projectName: string
  isPersonal: boolean
  picked: LibrarySong[]
  onToggle: (song: LibrarySong) => void
  /** Limpar a seleção (longe do primário; com "Desfazer" na barra) */
  onClear: () => void
  /** O repertório não carregou */
  error?: string | null
  onRetry?: () => void
}

export default function LibraryStep(p: LibraryStepProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const order = useMemo(() => new Map(p.picked.map((s, i) => [s.id, i + 1])), [p.picked])
  const index = useMemo(() => p.library.map(s => ({ s, text: fold(`${s.title} ${s.artist ?? ''}`) })), [p.library])
  const q = fold(query)
  const filtered = q ? index.filter(x => x.text.includes(q)).map(x => x.s) : p.library
  const shown = filtered.slice(0, MAX_ROWS)

  function toggle(s: LibrarySong) {
    p.onToggle(s)
    // Com a pesquisa preenchida: seleciona o texto para a próxima escrita o substituir
    if (query.trim()) {
      const el = inputRef.current
      if (el) { el.focus(); el.select() }
    }
  }

  if (p.error && !p.loading) {
    return (
      <div className={styles.emptyPanel} role="alert">
        <div className={styles.emptyTitle}>Não foi possível carregar o repertório</div>
        <p className={styles.emptyText}>{p.error}</p>
        {p.onRetry && <button type="button" className={styles.secondaryBtn} onClick={p.onRetry}>Tentar de novo</button>}
      </div>
    )
  }

  if (!p.loading && p.library.length === 0) {
    return (
      <div className={styles.emptyPanel}>
        <div className={styles.emptyTitle}>Repertório vazio</div>
        <p className={styles.emptyText}>
          {p.isPersonal ? 'Ainda não tens músicas no teu repertório.' : `${p.projectName} ainda não tem músicas.`}
          {' '}Importa uma lista — as músicas que faltam são criadas ao mesmo tempo.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.groups}>
      <div className={styles.filterWrap}>
        <span className={styles.filterIcon}><IconSearch /></span>
        <input
          ref={inputRef}
          className={styles.filterInput}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={p.isPersonal ? 'Procurar no teu repertório' : `Procurar no repertório de ${p.projectName}`}
          aria-label="Procurar no repertório"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
        />
      </div>

      <section aria-label="Repertório">
        <h2 className={styles.groupLabel}>
          <span>Toca nas músicas pela ordem do concerto</span>
          {p.picked.length > 0 && (
            <button type="button" className={`${styles.ghostBtn} ${styles.groupAction}`} onClick={p.onClear}>
              Limpar seleção
            </button>
          )}
          <span className={styles.groupCount}>
            {p.loading ? '--' : q ? `${pad2(filtered.length)}/${pad2(p.library.length)}` : pad2(p.library.length)}
          </span>
        </h2>

        {p.loading ? (
          <div className={styles.panel} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className={styles.sSkel}>
                <div className="skeleton" style={{ width: 28, height: 28 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: `${[58, 44, 66, 38, 52, 47][i]}%`, height: 15 }} />
                  <div className="skeleton" style={{ width: '28%', height: 11, marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className={styles.noMatch}>Nenhuma música corresponde a “{query}”.</p>
        ) : (
          <ul className={styles.panel}>
            {shown.map(s => {
              const n = order.get(s.id)
              const key = s.performance_key || s.original_key
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`${styles.sRow} ${n ? styles.sRowOn : ''}`}
                    onClick={() => toggle(s)}
                    aria-pressed={!!n}
                    aria-label={n ? `${s.title} — escolhida, posição ${n}` : `${s.title} — escolher`}
                  >
                    <span className={`${styles.badge} ${n ? styles.badgeOn : ''}`} aria-hidden="true">
                      {n ? pad2(n) : ''}
                    </span>
                    <span className={styles.sBody}>
                      <span className={styles.sTitle}>{s.title}</span>
                      {s.artist && <span className={styles.sArtist}>{s.artist}</span>}
                    </span>
                    <span className={styles.sChips}>
                      {s.has_sync && <span className={`${styles.chip} ${styles.chipSync}`}>Sync</span>}
                      {key && <span className={`${styles.chip} ${styles.chipKey}`}>{key}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {filtered.length > MAX_ROWS && (
          <p className={styles.noMatch}>A mostrar {MAX_ROWS} de {filtered.length} — escreve para filtrar.</p>
        )}
      </section>

    </div>
  )
}
