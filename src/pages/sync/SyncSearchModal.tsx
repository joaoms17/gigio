/* ═══════════════════════════════════════════════════════════════
   Procurar sync online (LRCLIB) a partir do editor de sincronização.
   Lista só resultados COM sync; ao escolher, devolve as linhas LRC.
═══════════════════════════════════════════════════════════════ */
import { useEffect, useId, useRef, useState } from 'react'
import { searchLrclib, getLrclibLyrics } from '../../lib/lrclib'
import type { LyricLine, SearchResult } from '../../types'
import styles from './SyncSearchModal.module.css'

function fmtDur(sec?: number) {
  if (!sec) return ''
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function SyncSearchModal({ title, artist, onPick, onClose }: {
  title: string
  artist: string
  /** Devolve true se aplicou (fecha o modal); false mantém-no aberto */
  onPick: (lines: LyricLine[], result: SearchResult) => Promise<boolean> | boolean
  onClose: () => void
}) {
  const titleId = useId()
  const [qTitle, setQTitle] = useState(title)
  const [qArtist, setQArtist] = useState(artist)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const reqRef = useRef(0)

  async function run(t: string, a: string) {
    if (!t.trim()) return
    const req = ++reqRef.current
    setSearching(true)
    setError(null)
    try {
      let found = await searchLrclib(t.trim(), a.trim())
      // Pesquisa estruturada sem resultados com sync → tenta a livre
      if (a.trim() && !found.some(r => r.has_sync)) {
        const loose = await searchLrclib(`${t.trim()} ${a.trim()}`)
        const seen = new Set(found.map(r => r.external_id))
        found = [...found, ...loose.filter(r => !seen.has(r.external_id))]
      }
      if (req === reqRef.current) setResults(found.filter(r => r.has_sync))
    } catch {
      if (req === reqRef.current) setError('Não foi possível pesquisar. Verifica a ligação à internet.')
    } finally {
      if (req === reqRef.current) setSearching(false)
    }
  }

  // Pesquisa inicial com o título/artista da música (fora do corpo do efeito)
  useEffect(() => {
    const t = setTimeout(() => { run(title, artist) }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function pick(r: SearchResult) {
    setBusyId(r.external_id)
    setError(null)
    try {
      const d = await getLrclibLyrics(r.external_id)
      if (!d.lines?.length) { setError('Este resultado afinal não tem sincronização.'); return }
      if (await onPick(d.lines, r)) onClose()
    } catch {
      setError('Não foi possível obter a sincronização deste resultado.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.headText}>
            <div className={styles.kicker}>LRCLIB · só resultados com sync</div>
            <h2 id={titleId} className={styles.title}>Procurar sync online</h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar">✕</button>
        </header>

        <form className={styles.form} onSubmit={e => { e.preventDefault(); run(qTitle, qArtist) }}>
          <input className={styles.input} value={qTitle} onChange={e => setQTitle(e.target.value)}
            placeholder="Título" aria-label="Título" />
          <input className={styles.input} value={qArtist} onChange={e => setQArtist(e.target.value)}
            placeholder="Artista" aria-label="Artista" />
          <button type="submit" className={styles.searchBtn} disabled={searching || !qTitle.trim()}>
            {searching ? 'A pesquisar…' : 'Pesquisar'}
          </button>
        </form>

        <div className={styles.body}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {!searching && results && results.length === 0 && !error && (
            <p className={styles.empty}>Nenhum resultado com sincronização. Experimenta mudar o título ou o artista.</p>
          )}
          {results && results.length > 0 && (
            <ul className={styles.list}>
              {results.map(r => (
                <li key={r.external_id}>
                  <button type="button" className={styles.row} onClick={() => pick(r)} disabled={busyId !== null}>
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{r.title}</span>
                      <span className={styles.rowArtist}>{r.artist}</span>
                    </span>
                    <span className={styles.rowMeta}>
                      {busyId === r.external_id ? 'A aplicar…' : <>{fmtDur(r.duration_sec)} <span className={styles.chip}>SYNC</span></>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
