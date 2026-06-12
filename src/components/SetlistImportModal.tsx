import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { extractSetlistFromPdf, normalizeTitle, type SetlistEntry } from '../lib/pdfSetlist'
import type { Song } from '../types'
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

type Step = 'upload' | 'review' | 'done'

function findMatch(query: string, library: Song[]): Song | null {
  const q = normalizeTitle(query)
  if (!q) return null
  return library.find(s => normalizeTitle(s.title) === q)
    ?? library.find(s => { const t = normalizeTitle(s.title); return t.includes(q) || q.includes(t) })
    ?? null
}

export default function SetlistImportModal({ setlistId, projectId, currentPosition, onClose, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<MatchedEntry[]>([])
  const [importing, setImporting] = useState(false)
  const [addedCount, setAddedCount] = useState(0)
  const [missed, setMissed] = useState<string[]>([])

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Por favor seleciona um ficheiro PDF.')
      return
    }
    setError(null)
    setParsing(true)
    try {
      const parsed = await extractSetlistFromPdf(file)
      if (parsed.length === 0) {
        setError('Não foram encontradas entradas no PDF.')
        setParsing(false)
        return
      }

      let library: Song[] = []
      if (projectId) {
        const { data } = await supabase.from('songs').select('*').eq('project_id', projectId)
        library = data ?? []
      }

      const matched: MatchedEntry[] = parsed.map((entry, i) => ({
        id: String(i),
        entry,
        checked: true,
        matches: entry.songs.map(name => findMatch(name, library)),
      }))

      setEntries(matched)
      setStep('review')
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao processar o PDF.')
    } finally {
      setParsing(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function toggleEntry(id: string) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, checked: !e.checked } : e))
  }

  const checkedEntries = entries.filter(e => e.checked)
  const totalSongs = checkedEntries.reduce((acc, e) => acc + e.entry.songs.length, 0)
  const foundCount = checkedEntries.reduce((acc, e) => acc + e.matches.filter(Boolean).length, 0)
  const totalEntries = entries.length

  async function handleImport() {
    setImporting(true)
    let pos = currentPosition
    const inserts: { setlist_id: string; song_id: string; position: number }[] = []
    const missedNames: string[] = []

    for (const e of checkedEntries) {
      for (let i = 0; i < e.entry.songs.length; i++) {
        const match = e.matches[i]
        if (match) {
          inserts.push({ setlist_id: setlistId, song_id: match.id, position: pos++ })
        } else {
          missedNames.push(e.entry.songs[i])
        }
      }
    }

    if (inserts.length > 0) {
      await Promise.all(inserts.map(row => supabase.from('setlist_songs').insert(row)))
    }

    setAddedCount(inserts.length)
    setMissed(missedNames)
    setImporting(false)
    setStep('done')
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>
            {step === 'upload' && 'Importar setlist de PDF'}
            {step === 'review' && 'Rever entradas'}
            {step === 'done' && 'Importação concluída'}
          </span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        {step === 'upload' && (
          <div className={styles.body}>
            <div
              className={styles.uploadZone}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
            >
              <div className={styles.uploadIcon}>📄</div>
              <div className={styles.uploadHint}>Clica ou arrasta um PDF aqui</div>
              <div className={styles.uploadSub}>O PDF deve ter uma música por linha</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={handleInputChange}
            />
            {parsing && <div className={styles.parseSpinner}>A analisar PDF...</div>}
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}

        {step === 'review' && (
          <>
            <div className={styles.reviewInfo}>
              {totalEntries} entrada{totalEntries !== 1 ? 's' : ''} · {totalSongs} música{totalSongs !== 1 ? 's' : ''} · {foundCount} encontrada{foundCount !== 1 ? 's' : ''} na biblioteca
            </div>
            <div className={styles.entryList}>
              {entries.map(e => (
                <div key={e.id} className={`${styles.entryRow} ${!e.checked ? styles.entryUnchecked : ''}`}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={e.checked}
                    onChange={() => toggleEntry(e.id)}
                  />
                  <div className={styles.entryInfo}>
                    {e.entry.songs.length === 1 ? (
                      <div className={styles.songName}>{e.entry.songs[0]}</div>
                    ) : (
                      <>
                        <div className={styles.medleyLabel}>Medley</div>
                        {e.entry.songs.map((s, i) => (
                          <div key={i} className={styles.medleySong}>{s}</div>
                        ))}
                      </>
                    )}
                  </div>
                  <div className={styles.matchCol}>
                    {e.entry.songs.map((_s, i) => {
                      const match = e.matches[i]
                      return match ? (
                        <div key={i} className={styles.matchFound}>✓ {match.title} – {match.artist}</div>
                      ) : (
                        <div key={i} className={styles.matchMissed}>? não encontrada</div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.footer}>
              <button className={styles.cancelBtn} onClick={onClose}>Cancelar</button>
              <button
                className={styles.importBtn}
                onClick={handleImport}
                disabled={foundCount === 0 || importing}
              >
                {importing ? 'A importar...' : `Importar ${foundCount} música${foundCount !== 1 ? 's' : ''} encontrada${foundCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className={styles.body}>
            <div className={styles.doneIcon}>✅</div>
            <div className={styles.doneTitle}>{addedCount} música{addedCount !== 1 ? 's' : ''} adicionada{addedCount !== 1 ? 's' : ''}</div>
            {missed.length > 0 && (
              <div className={styles.missedSection}>
                <div className={styles.missedTitle}>Não encontradas na biblioteca</div>
                {missed.map((name, i) => (
                  <div key={i} className={styles.missedItem}>{name}</div>
                ))}
                <div className={styles.missedHint}>Adiciona estas músicas à biblioteca e importa novamente.</div>
              </div>
            )}
            <button className={styles.doneBtn} onClick={onImported}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  )
}
