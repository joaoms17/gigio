import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../lib/supabase'
import ExportPdfSheet from '../../components/ExportPdfSheet'
import type { PdfData, PdfKind } from '../../lib/pdfExport'
import { useAuth } from '../../hooks/useAuth'
import type { Song } from '../../types'
import styles from './LibraryPage.module.css'

type FilterChip = 'all' | 'sync' | 'edited'

const FILTERS: [FilterChip, string][] = [
  ['all', 'Todas'],
  ['sync', 'Com sync'],
  ['edited', 'Editadas'],
]

/** 245 → "4:05" */
function formatDuration(sec?: number): string | null {
  if (!sec || sec <= 0) return null
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/* ── Ícones SVG inline (stroke + currentColor) ── */

function Svg({ size = 18, stroke = 2, children }: { size?: number; stroke?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const IconSearch = () => <Svg><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21" /></Svg>
const IconChevron = () => <Svg size={16}><path d="m6 9 6 6 6-6" /></Svg>
const IconPencil = () => <Svg><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></Svg>
const IconX = ({ size = 18 }: { size?: number }) => <Svg size={size}><path d="M6 6l12 12M18 6 6 18" /></Svg>
const IconCheck = ({ size = 14 }: { size?: number }) => <Svg size={size} stroke={3}><path d="M20 6 9 17l-5-5" /></Svg>
const IconDownload = () => <Svg><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Svg>
const IconPlus = ({ size = 20 }: { size?: number }) => <Svg size={size} stroke={2.25}><path d="M12 5v14M5 12h14" /></Svg>
const IconSelect = () => <Svg><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="m8 12 3 3 5-6" /></Svg>
const IconTrash = () => <Svg><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></Svg>
const IconMusic = () => <Svg size={28} stroke={1.75}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Svg>

export default function LibraryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'title' | 'artist' | 'recent'>('title')
  const [chip, setChip] = useState<FilterChip>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  // Bulk selection
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [pdfKind, setPdfKind] = useState<PdfKind | null>(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('songs')
      .select('*')
      .eq('owner_id', user.id)
      .order('title')
      .then(({ data }) => {
        setSongs(data ?? [])
        setLoading(false)
      })
  }, [user])

  /** Which setlists use this song — shown before deleting */
  async function setlistsUsing(songIds: string[]): Promise<string[]> {
    const { data } = await supabase
      .from('setlist_songs')
      .select('setlist:setlists(name)')
      .in('song_id', songIds)
    const names = (data ?? []).map((r: any) => r.setlist?.name).filter(Boolean)
    return [...new Set(names)] as string[]
  }

  function toggleSelect(id: string) {
    setSelection(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelecting(false)
    setSelection(new Set())
  }

  async function bulkDelete() {
    const ids = [...selection]
    if (ids.length === 0) return
    const used = await setlistsUsing(ids)
    const usedList = `${used.slice(0, 4).join(', ')}${used.length > 4 ? '…' : ''}`
    // Eliminar é destrutivo e só vive no modo "Selecionar" — com uma única
    // música, a confirmação nomeia-a e diz em que concertos está.
    const single = ids.length === 1 ? songs.find(s => s.id === ids[0]) : undefined
    const confirmed = single
      ? await confirmDialog({
          title: 'Eliminar música',
          message: `Eliminar "${single.title}"?${used.length ? ` Está em ${used.length} concerto${used.length !== 1 ? 's' : ''}: ${usedList}.` : ''} Será removida de todas as setlists.`,
          confirmLabel: 'Eliminar',
          danger: true,
        })
      : await confirmDialog({
          title: `Eliminar ${ids.length} músicas`,
          message: `Eliminar ${ids.length} músicas da biblioteca?${used.length ? ` Algumas estão em setlists: ${usedList}.` : ''} Serão removidas de todas as setlists.`,
          confirmLabel: 'Eliminar tudo',
          danger: true,
        })
    if (!confirmed) return
    setBulkBusy(true)
    await supabase.from('songs').delete().in('id', ids)
    setSongs(prev => prev.filter(s => !selection.has(s.id)))
    setBulkBusy(false)
    exitSelectMode()
  }

  // All tags present in the library (for the tag filter row)
  const allTags = [...new Set(songs.flatMap(s => s.tags ?? []))].sort()

  const filtered = songs
    .filter(s =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.artist.toLowerCase().includes(search.toLowerCase())
    )
    .filter(s => {
      if (chip === 'sync') return !!s.has_sync
      if (chip === 'edited') return !!s.is_user_edited
      return true
    })
    .filter(s => !tagFilter || (s.tags ?? []).includes(tagFilter))
    .sort((a, b) => {
      if (sort === 'artist') return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
      if (sort === 'recent') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
      return a.title.localeCompare(b.title)
    })

  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selection.has(s.id))
  const hasFilters = !!search || chip !== 'all' || !!tagFilter

  /** Exporta as músicas filtradas atuais, pela ordem da vista */
  function exportPdf(withLyrics: boolean) {
    setPdfKind(withLyrics ? 'repertorio' : 'alinhamento')
  }

  function pdfData(): PdfData {
    return {
      meta: { title: 'A minha biblioteca', context: 'library' },
      songs: filtered.map(s => ({
        title: s.title,
        artist: s.artist,
        key: s.performance_key || s.original_key || null,
        originalKey: s.original_key,
        bpm: s.bpm,
        capo: s.capo,
        durationSec: s.duration_sec,
        lyrics: s.edited_lyrics ?? s.lyrics,
        chords: s.chords,
      })),
    }
  }

  function toggleSelectAll() {
    setSelection(allFilteredSelected ? new Set() : new Set(filtered.map(s => s.id)))
  }

  function clearFilters() {
    setSearch('')
    setChip('all')
    setTagFilter(null)
  }

  const plural = (n: number) => `música${n !== 1 ? 's' : ''}`
  const countLabel = loading
    ? 'A carregar…'
    : filtered.length !== songs.length
      ? `${filtered.length} de ${songs.length} ${plural(songs.length)}`
      : `${songs.length} ${plural(songs.length)}`

  const colsClass = `${styles.cols} ${selecting ? styles.colsSelecting : ''}`

  return (
    <div className={`${styles.page} ${selecting ? styles.pageSelecting : ''}`}>
      {/* ── Cabeçalho ── */}
      <header className={styles.header}>
        <div className={styles.headText}>
          <h1 className={styles.pageTitle}>Repertório</h1>
          <span className={styles.count} aria-live="polite">{countLabel}</span>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${styles.secondaryBtn} ${selecting ? styles.secondaryOn : ''}`}
            aria-pressed={selecting}
            onClick={() => selecting ? exitSelectMode() : setSelecting(true)}
          >
            {selecting ? <IconX /> : <IconSelect />}
            <span>{selecting ? 'Cancelar' : 'Selecionar'}</span>
          </button>
          {!selecting && (
            <button type="button" className={styles.primaryBtn} onClick={() => navigate('/search')}>
              <IconPlus />
              <span>Nova música</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Pesquisa + ordenação ── */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><IconSearch /></span>
          <input
            className={styles.searchInput}
            placeholder="Título ou artista"
            aria-label="Procurar no repertório por título ou artista"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.selectWrap}>
          <select className={styles.select} value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Ordenar">
            <option value="title">Título A–Z</option>
            <option value="artist">Artista A–Z</option>
            <option value="recent">Recentes</option>
          </select>
          <span className={styles.selectChevron}><IconChevron /></span>
        </div>
      </div>

      {/* ── Filtros + exportação ── */}
      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <div className={styles.segmented} role="group" aria-label="Filtrar músicas">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`${styles.segBtn} ${chip === value ? styles.segActive : ''}`}
                aria-pressed={chip === value}
                onClick={() => setChip(value)}
              >{label}</button>
            ))}
          </div>
          {allTags.length > 0 && (
            <div className={styles.tags} role="group" aria-label="Filtrar por etiqueta">
              {allTags.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.tag} ${tagFilter === t ? styles.tagActive : ''}`}
                  aria-pressed={tagFilter === t}
                  onClick={() => setTagFilter(prev => prev === t ? null : t)}
                >#{t}</button>
              ))}
            </div>
          )}
        </div>

        {selecting ? (
          <div className={styles.filterActions}>
            <button type="button" className={styles.secondaryBtn} onClick={toggleSelectAll} disabled={filtered.length === 0}>
              <span className={`${styles.check} ${allFilteredSelected ? styles.checkOn : ''}`} aria-hidden="true">
                {allFilteredSelected && <IconCheck size={13} />}
              </span>
              <span>{allFilteredSelected ? 'Limpar seleção' : 'Selecionar tudo'}</span>
            </button>
          </div>
        ) : !loading && filtered.length > 0 ? (
          /* No telemóvel desce para o fim da lista (exportar é raro; a lista vem primeiro) */
          <div className={`${styles.filterActions} ${styles.exportActions}`} role="group" aria-label="Exportar PDF">
            <span className={styles.exportLabel} aria-hidden="true">
              Exportar <span className={styles.exportSep}>·</span> {filtered.length} {plural(filtered.length)}
            </span>
            <button type="button" className={styles.secondaryBtn} onClick={() => exportPdf(false)}>
              <IconDownload />
              <span>Lista PDF</span>
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => exportPdf(true)}>
              <IconDownload />
              <span>Repertório PDF</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* ── Catálogo ── */}
      <section className={styles.panel} aria-busy={loading} aria-label="Músicas">
        {(loading || filtered.length > 0) && (
          <div className={`${styles.thead} ${colsClass}`} aria-hidden="true">
            {selecting && <span />}
            <span>Título</span>
            <span>Artista</span>
            <span>Tom</span>
            <span>Duração</span>
            <span>Sync</span>
            {!selecting && <span />}
          </div>
        )}

        {loading ? (
          <div className={styles.rows}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className={`${styles.skelRow} ${styles.cols}`} aria-hidden="true">
                <div className="skeleton" style={{ height: 14, width: `${55 + (i % 3) * 14}%` }} />
                <div className="skeleton" style={{ height: 12, width: `${35 + (i % 2) * 22}%` }} />
                <div className={`skeleton ${styles.skelWide}`} style={{ height: 22, width: 30 }} />
                <div className={`skeleton ${styles.skelWide}`} style={{ height: 12, width: 36 }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>{hasFilters ? <IconSearch /> : <IconMusic />}</span>
            <p className={styles.emptyTitle}>{hasFilters ? 'Sem resultados' : 'Repertório vazio'}</p>
            <p className={styles.emptyText}>
              {hasFilters
                ? 'Nenhuma música corresponde a estes filtros.'
                : 'Procura a letra de uma música para começar o teu repertório.'}
            </p>
            {hasFilters ? (
              <button type="button" className={styles.secondaryBtn} onClick={clearFilters}>
                <IconX />
                <span>Limpar filtros</span>
              </button>
            ) : (
              <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/search')}>
                <IconSearch />
                <span>Procurar letras</span>
              </button>
            )}
          </div>
        ) : (
          <div className={styles.rows}>
            {filtered.map(song => {
              const isSelected = selection.has(song.id)
              const keyChip = song.performance_key ?? song.original_key
              const duration = formatDuration(song.duration_sec)
              return (
                <div
                  key={song.id}
                  className={`${styles.row} ${colsClass} ${selecting && isSelected ? styles.rowSelected : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selecting ? isSelected : undefined}
                  onClick={() => selecting ? toggleSelect(song.id) : navigate(`/songs/${song.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') { selecting ? toggleSelect(song.id) : navigate(`/songs/${song.id}`) } }}
                >
                  {selecting && (
                    <span className={styles.checkCell}>
                      <span className={`${styles.check} ${isSelected ? styles.checkOn : ''}`} aria-hidden="true">
                        {isSelected && <IconCheck />}
                      </span>
                    </span>
                  )}
                  <span className={styles.cTitle}>{song.title}</span>
                  <span className={styles.meta}>
                    <span className={styles.cArtist}>{song.artist}</span>
                    <span className={`${styles.cKey} ${keyChip ? '' : styles.cEmpty}`}>
                      {keyChip ? <span className={styles.keyChip}>{keyChip}</span> : '—'}
                    </span>
                    <span className={`${styles.cDur} ${duration ? '' : styles.cEmpty}`}>{duration ?? '—'}</span>
                    {/* Célula vazia com o mesmo "—" do TOM e da DURAÇÃO (escondida no telemóvel) */}
                    <span className={`${styles.cSync} ${song.has_sync ? '' : styles.cEmpty}`}>
                      {song.has_sync ? <span className={styles.syncChip}>Sync</span> : '—'}
                    </span>
                  </span>
                  {/* Só ✎ na linha — eliminar vive no modo "Selecionar" (destrutivo fora da parede de ações) */}
                  {!selecting && (
                    <span className={styles.actions}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={e => { e.stopPropagation(); navigate(`/songs/${song.id}`) }}
                        title="Editar"
                        aria-label={`Editar ${song.title}`}
                      >
                        <IconPencil />
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {pdfKind && (
        <ExportPdfSheet kind={pdfKind} data={pdfData()} onClose={() => setPdfKind(null)} />
      )}

      {/* ── Barra de ações em bloco ── */}
      {selecting && selection.size > 0 && (
        <div className={styles.bulkBar} role="region" aria-label="Ações da seleção">
          <span className={styles.bulkCount}>
            <span className={styles.bulkLed} aria-hidden="true" />
            {selection.size} selecionada{selection.size !== 1 ? 's' : ''}
          </span>
          <button type="button" className={styles.bulkDeleteBtn} onClick={bulkDelete} disabled={bulkBusy}>
            <IconTrash />
            <span>{bulkBusy ? 'A eliminar…' : 'Eliminar'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
