import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { extractSetlistFromPdf, normalizeTitle, type SetlistEntry } from '../lib/pdfSetlist'
import { searchLrclib, getLrclibLyrics } from '../lib/lrclib'
import { searchGenius } from '../lib/genius'
import { getLyricsOvh } from '../lib/lyricsovh'
import { useAuth } from '../hooks/useAuth'
import type { Song, SearchResult, LyricLine } from '../types'
import styles from './SetlistImportModal.module.css'

interface Props {
  setlistId: string
  projectId: string | null
  currentPosition: number
  onClose: () => void
  onImported: () => void
}

interface MatchedEntry {
  id: string
  entry: SetlistEntry
  checked: boolean
  matches: (Song | null)[]
}

type Step = 'upload' | 'review' | 'done' | 'search'

function findMatch(query: string, library: Song[]): Song | null {
  const q = normalizeTitle(query)
  if (!q) return null
  return library.find(s => normalizeTitle(s.title) === q)
    ?? library.find(s => { const t = normalizeTitle(s.title); return t.includes(q) || q.includes(t) })
    ?? null
}

export default function SetlistImportModal({ setlistId, projectId, currentPosition, onClose, onImported }: Props) {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<MatchedEntry[]>([])
  const [importing, setImporting] = useState(false)
  const [addedCount, setAddedCount] = useState(0)
  const [missed, setMissed] = useState<string[]>([])

  // Search step
  const [searchQueue, setSearchQueue] = useState<string[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [addedFromSearch, setAddedFromSearch] = useState(0)

  function handleClose() {
    if (addedCount > 0 || addedFromSearch > 0) onImported()
    else onClose()
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Por favor seleciona um ficheiro PDF.')
      return
    }
    setError(null)
    setParsing(true)
    try {
      const parsed = await extractSetlistFromPdf(file)
      if (parsed.length === 0) { setError('Não foram encontradas entradas no PDF.'); setParsing(false); return }

      let library: Song[] = []
      if (projectId) {
        const { data } = await supabase.from('songs').select('*').eq('project_id', projectId)
        library = data ?? []
      }

      setEntries(parsed.map((entry, i) => ({
        id: String(i), entry, checked: true,
        matches: entry.songs.map(name => findMatch(name, library)),
      })))
      setStep('review')
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao processar o PDF.')
    } finally {
      setParsing(false)
    }
  }

  const checkedEntries = entries.filter(e => e.checked)
  const totalSongs = checkedEntries.reduce((acc, e) => acc + e.entry.songs.length, 0)
  const foundCount = checkedEntries.reduce((acc, e) => acc + e.matches.filter(Boolean).length, 0)

  async function handleImport() {
    setImporting(true)
    let pos = currentPosition
    const inserts: { setlist_id: string; song_id: string; position: number }[] = []
    const missedNames: string[] = []

    for (const e of checkedEntries) {
      for (let i = 0; i < e.entry.songs.length; i++) {
        const match = e.matches[i]
        if (match) inserts.push({ setlist_id: setlistId, song_id: match.id, position: pos++ })
        else missedNames.push(e.entry.songs[i])
      }
    }

    if (inserts.length > 0) await Promise.all(inserts.map(row => supabase.from('setlist_songs').insert(row)))
    setAddedCount(inserts.length)
    setMissed(missedNames)
    setImporting(false)
    setStep('done')
    if (inserts.length > 0) onImported()
  }

  async function runSearch(query: string) {
    if (!query.trim()) return
    setSearchLoading(true)
    setSearchResults([])
    try {
      const [lrc, genius] = await Promise.allSettled([searchLrclib(query), searchGenius(query)])
      const combined = [
        ...(lrc.status === 'fulfilled' ? lrc.value : []),
        ...(genius.status === 'fulfilled' ? genius.value : []),
      ]
      combined.sort((a, b) => (b.has_sync ? 1 : 0) - (a.has_sync ? 1 : 0))
      setSearchResults(combined)
    } finally {
      setSearchLoading(false)
    }
  }

  function startSearch() {
    const queue = missed
    setSearchQueue(queue)
    setSearchIndex(0)
    setSearchQuery(queue[0] ?? '')
    setSearchResults([])
    setAddedFromSearch(0)
    setStep('search')
    if (queue[0]) runSearch(queue[0])
  }

  function advanceSearch(didAdd: boolean) {
    if (didAdd) setAddedFromSearch(n => n + 1)
    const next = searchIndex + 1
    if (next >= searchQueue.length) { onImported(); return }
    setSearchIndex(next)
    const q = searchQueue[next]
    setSearchQuery(q)
    setSearchResults([])
    runSearch(q)
  }

  async function pickResult(r: SearchResult) {
    if (!user) return
    const key = `${r.source}-${r.external_id}`
    setSavingKey(key)
    try {
      let lyrics = '', lines: LyricLine[] | null = null
      if (r.source === 'lrclib') {
        const d = await getLrclibLyrics(r.external_id)
        lyrics = d.lyrics; lines = d.lines
      } else {
        lyrics = await getLyricsOvh(r.artist, r.title)
      }
      const { data: song, error: songErr } = await supabase.from('songs').insert({
        owner_id: user.id, title: r.title, artist: r.artist,
        lyrics, original_lyrics: lyrics, edited_lyrics: lyrics,
        source: r.source === 'lrclib' ? 'lrclib' : 'manual',
        source_provider: r.source,
        has_sync: r.has_sync && !!lines,
        duration_sec: r.duration_sec ? Math.round(r.duration_sec) : null,
        project_id: projectId ?? null, is_user_edited: false,
      }).select().single()
      if (songErr) throw songErr
      if (song && lines?.length) await supabase.from('lyric_syncs').insert({ song_id: song.id, lines })
      if (song) {
        const { count } = await supabase.from('setlist_songs').select('*', { count: 'exact', head: true }).eq('setlist_id', setlistId)
        await supabase.from('setlist_songs').insert({ setlist_id: setlistId, song_id: song.id, position: count ?? 0 })
      }
      advanceSearch(true)
    } catch (err: any) {
      alert('Erro ao guardar: ' + (err?.message ?? err))
    } finally {
      setSavingKey(null)
    }
  }

  const stepTitle =
    step === 'upload' ? 'Importar concerto de PDF' :
    step === 'review' ? 'Rever entradas' :
    step === 'done'   ? 'Importação concluída' :
    `Pesquisar músicas (${searchIndex + 1}/${searchQueue.length})`

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{stepTitle}</span>
          <button className={styles.close} onClick={handleClose}>✕</button>
        </div>

        {step === 'upload' && (
          <div className={styles.body}>
            <div className={styles.uploadZone} onClick={() => fileInputRef.current?.click()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onDragOver={e => e.preventDefault()}
            >
              <div className={styles.uploadIcon}>📄</div>
              <div className={styles.uploadHint}>Clica ou arrasta um PDF aqui</div>
              <div className={styles.uploadSub}>O PDF deve ter uma música por linha</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf"
              style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            {parsing && <div className={styles.parseSpinner}>A analisar PDF...</div>}
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}

        {step === 'review' && (
          <>
            <div className={styles.reviewInfo}>
              {entries.length} entrada{entries.length !== 1 ? 's' : ''} · {totalSongs} música{totalSongs !== 1 ? 's' : ''} · {foundCount} encontrada{foundCount !== 1 ? 's' : ''} na biblioteca
            </div>
            <div className={styles.entryList}>
              {entries.map(e => (
                <div key={e.id} className={`${styles.entryRow} ${!e.checked ? styles.entryUnchecked : ''}`}>
                  <input type="checkbox" className={styles.checkbox} checked={e.checked}
                    onChange={() => setEntries(prev => prev.map(x => x.id === e.id ? { ...x, checked: !x.checked } : x))} />
                  <div className={styles.entryInfo}>
                    {e.entry.songs.length === 1 ? (
                      <div className={styles.songName}>{e.entry.songs[0]}</div>
                    ) : (
                      <>
                        <div className={styles.medleyLabel}>Medley</div>
                        {e.entry.songs.map((s, i) => <div key={i} className={styles.medleySong}>{s}</div>)}
                      </>
                    )}
                  </div>
                  <div className={styles.matchCol}>
                    {e.entry.songs.map((_s, i) => e.matches[i] ? (
                      <div key={i} className={styles.matchFound}>✓ {e.matches[i]!.title}</div>
                    ) : (
                      <div key={i} className={styles.matchMissed}>? não encontrada</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.footer}>
              <button className={styles.cancelBtn} onClick={onClose}>Cancelar</button>
              <button className={styles.importBtn} onClick={handleImport} disabled={totalSongs === 0 || importing}>
                {importing ? 'A importar...' : `Importar ${foundCount > 0 ? `${foundCount} encontrada${foundCount !== 1 ? 's' : ''}` : 'e pesquisar restantes'}`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className={styles.body}>
            <div className={styles.doneIcon}>✅</div>
            <div className={styles.doneTitle}>{addedCount} música{addedCount !== 1 ? 's' : ''} adicionada{addedCount !== 1 ? 's' : ''} da biblioteca</div>
            {missed.length > 0 ? (
              <div className={styles.missedSection}>
                <div className={styles.missedTitle}>{missed.length} não encontrada{missed.length !== 1 ? 's' : ''} na biblioteca</div>
                {missed.map((name, i) => <div key={i} className={styles.missedItem}>{name}</div>)}
                <button className={styles.searchMissedBtn} onClick={startSearch}>
                  Pesquisar {missed.length} música{missed.length !== 1 ? 's' : ''} em falta →
                </button>
              </div>
            ) : (
              <button className={styles.doneBtn} onClick={handleClose}>Fechar</button>
            )}
            {missed.length > 0 && (
              <button className={styles.cancelBtn} style={{ marginTop: 8 }} onClick={handleClose}>Fechar sem pesquisar</button>
            )}
          </div>
        )}

        {step === 'search' && (
          <div className={styles.searchStep}>
            <div className={styles.searchCurrent}>
              {searchQueue[searchIndex]}
            </div>
            <div className={styles.searchForm}>
              <input
                className={styles.searchInput}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runSearch(searchQuery)}
                placeholder="Pesquisar..."
              />
              <button className={styles.searchBtn} onClick={() => runSearch(searchQuery)} disabled={searchLoading}>
                {searchLoading ? '...' : 'Pesquisar'}
              </button>
            </div>

            {searchLoading && <div className={styles.parseSpinner}>A pesquisar...</div>}

            {!searchLoading && searchResults.length > 0 && (
              <div className={styles.resultList}>
                {searchResults.slice(0, 8).map(r => {
                  const key = `${r.source}-${r.external_id}`
                  return (
                    <div key={key} className={styles.resultRow}>
                      <div className={styles.resultInfo}>
                        <div className={styles.resultTitle}>{r.title}</div>
                        <div className={styles.resultArtist}>{r.artist}</div>
                      </div>
                      {r.has_sync && <span className={styles.syncBadge}>sync</span>}
                      <button
                        className={styles.resultAddBtn}
                        onClick={() => pickResult(r)}
                        disabled={savingKey !== null}
                      >
                        {savingKey === key ? '...' : '+ Adicionar'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {!searchLoading && searchResults.length === 0 && searchQuery && (
              <div className={styles.noResults}>Sem resultados. Tenta outro nome.</div>
            )}

            <div className={styles.searchActions}>
              <button className={styles.skipBtn} onClick={() => advanceSearch(false)} disabled={savingKey !== null}>
                Saltar →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
