/* ═══════════════════════════════════════════════════════════════
   Procurar a sync de uma música já existente no LRCLIB e gravá-la
   — só quando a letra do resultado corresponde à letra da música.
═══════════════════════════════════════════════════════════════ */
import { supabase } from './supabase'
import { searchLrclib, getLrclibLyrics } from './lrclib'
import { matchExternalSync, normalizeLyric } from './lyricsTiming'
import { patchSongInCopies } from './offline/store'
import type { LyricLine, Song } from '../types'

export type AutoSyncResult = 'synced' | 'nomatch' | 'error'

/** Quantos resultados com sync se experimentam por música */
const MAX_CANDIDATES = 4

async function candidates(song: Pick<Song, 'title' | 'artist'>) {
  const title = song.title.trim()
  const artist = (song.artist ?? '').trim()
  let found = await searchLrclib(title, artist)
  if (artist && !found.some(r => r.has_sync)) {
    const loose = await searchLrclib(`${title} ${artist}`)
    const seen = new Set(found.map(r => r.external_id))
    found = [...found, ...loose.filter(r => !seen.has(r.external_id))]
  }
  return found.filter(r => r.has_sync).slice(0, MAX_CANDIDATES)
}

/**
 * Procura e grava a sync. Com letra escrita, aceita o 1.º resultado cuja letra
 * bate pelo texto; sem letra, só um resultado com o mesmo título.
 */
export async function autoSyncSong(
  song: Pick<Song, 'id' | 'title' | 'artist' | 'lyrics' | 'edited_lyrics'>,
  userId: string,
): Promise<AutoSyncResult> {
  try {
    const written = (song.edited_lyrics ?? song.lyrics ?? '').trim()
    const editorLines = written.split(/\r\n?|\n/).filter(l => l.trim())
    let chosen: LyricLine[] | null = null
    for (const r of await candidates(song)) {
      if (!written && normalizeLyric(r.title) !== normalizeLyric(song.title)) continue
      const d = await getLrclibLyrics(r.external_id)
      if (!d.lines?.length) continue
      if (!written || matchExternalSync(editorLines, d.lines)) { chosen = d.lines; break }
    }
    if (!chosen) return 'nomatch'
    const { error: syncErr } = await supabase.from('lyric_syncs')
      .upsert({ song_id: song.id, lines: chosen }, { onConflict: 'song_id' })
    if (syncErr) return 'error'
    const { error: flagErr } = await supabase.from('songs').update({ has_sync: true }).eq('id', song.id)
    if (flagErr) return 'error'
    patchSongInCopies(userId, song.id, { song: { has_sync: true }, syncLines: chosen }).catch(() => {})
    return 'synced'
  } catch {
    return 'error'
  }
}
