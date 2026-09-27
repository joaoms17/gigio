/* ═══════════════════════════════════════════════════════════════
   Criação de músicas no repertório — helper partilhado
   (importação de setlists, criação de concertos, pesquisa).
═══════════════════════════════════════════════════════════════ */
import { supabase } from './supabase'
import { getLrclibLyrics } from './lrclib'
import { getLyricsOvh } from './lyricsovh'
import type { LyricLine, SearchResult, Song } from '../types'

export interface SongOwner {
  /** Utilizador que cria (owner_id) */
  ownerId: string
  /** Projeto/banda (project_id); null = repertório pessoal */
  projectId: string | null
  /** Tom a guardar na música (performance_key), p.ex. o tom anotado na setlist importada */
  performanceKey?: string | null
}

export interface ResultLyrics {
  lyrics: string
  /** Linhas sincronizadas (LRC) quando existem */
  lines: LyricLine[] | null
  provider: 'lrclib' | 'lyricsovh'
}

/** Letra de um resultado de pesquisa: LRCLIB (com sync) ou lyrics.ovh (descoberta via Genius). */
export async function fetchResultLyrics(r: SearchResult): Promise<ResultLyrics> {
  if (r.source === 'lrclib') {
    const d = await getLrclibLyrics(r.external_id)
    return { lyrics: d.lyrics ?? '', lines: d.lines, provider: 'lrclib' }
  }
  const lyrics = await getLyricsOvh(r.artist, r.title)
  return { lyrics, lines: null, provider: 'lyricsovh' }
}

function baseRow(owner: SongOwner) {
  const row: Record<string, unknown> = {
    owner_id: owner.ownerId,
    project_id: owner.projectId ?? null,
    is_user_edited: false,
  }
  if (owner.performanceKey) row.performance_key = owner.performanceKey
  return row
}

/**
 * Cria uma música a partir de um resultado LRCLIB/Genius, com a letra e — quando há —
 * a sincronização (`lyric_syncs`). Se a letra não se conseguir obter (rede), a música é
 * criada na mesma com título/artista (a letra adiciona-se depois).
 * Lança erro só se a própria música não puder ser gravada.
 */
export async function createSongFromResult(
  result: SearchResult,
  owner: SongOwner,
  opts: { lyrics?: ResultLyrics } = {},
): Promise<Song> {
  let fetched: ResultLyrics
  try {
    fetched = opts.lyrics ?? await fetchResultLyrics(result)
  } catch {
    fetched = { lyrics: '', lines: null, provider: result.source === 'lrclib' ? 'lrclib' : 'lyricsovh' }
  }
  const lyrics = (fetched.lyrics ?? '').trim()
  const lines = fetched.lines?.length ? fetched.lines : null
  const { data: song, error } = await supabase.from('songs').insert({
    ...baseRow(owner),
    title: result.title,
    artist: result.artist ?? '',
    lyrics,
    original_lyrics: lyrics,
    edited_lyrics: lyrics,
    source: result.source === 'lrclib' ? 'lrclib' : 'manual',
    source_provider: lyrics ? fetched.provider : 'manual',
    has_sync: !!lines,
    duration_sec: result.duration_sec ? Math.round(result.duration_sec) : null,
  }).select().single()
  if (error) throw error
  if (!song) throw new Error('A música não foi criada.')
  if (lines) {
    const { error: syncErr } = await supabase.from('lyric_syncs').insert({ song_id: song.id, lines })
    if (syncErr && song.has_sync) {
      // Sem sync gravada, a música não pode dizer que a tem
      await supabase.from('songs').update({ has_sync: false }).eq('id', song.id)
      return { ...song, has_sync: false } as Song
    }
  }
  return song as Song
}

/** Cria uma música sem letra (a letra adiciona-se depois na página da música). */
export async function createEmptySong(
  title: string,
  artist: string,
  owner: SongOwner,
  opts: { durationSec?: number | null } = {},
): Promise<Song> {
  const { data: song, error } = await supabase.from('songs').insert({
    ...baseRow(owner),
    title: title.trim(),
    artist: (artist ?? '').trim(),
    lyrics: '',
    original_lyrics: '',
    edited_lyrics: '',
    source: 'manual',
    source_provider: 'manual',
    has_sync: false,
    duration_sec: opts.durationSec ? Math.round(opts.durationSec) : null,
  }).select().single()
  if (error) throw error
  if (!song) throw new Error('A música não foi criada.')
  return song as Song
}
