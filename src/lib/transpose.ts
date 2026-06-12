// Chord transposition utilities

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const NOTE_INDEX: Record<string, number> = {
  'C': 0, 'B#': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'Fb': 4,
  'F': 5, 'E#': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9,
  'A#': 10, 'Bb': 10, 'B': 11, 'Cb': 11,
}

/** Parse a key string like "Am", "F#", "Bbm" → { root index, minor } or null */
export function parseKey(key: string): { idx: number; minor: boolean } | null {
  const m = key.trim().match(/^([A-G][#b]?)(m|min|minor)?$/i)
  if (!m) return null
  const root = m[1][0].toUpperCase() + (m[1][1] ?? '')
  const idx = NOTE_INDEX[root]
  if (idx === undefined) return null
  return { idx, minor: !!m[2] }
}

/** Semitone distance from one key to another (0-11) */
export function semitonesBetween(fromKey: string, toKey: string): number | null {
  const a = parseKey(fromKey)
  const b = parseKey(toKey)
  if (!a || !b) return null
  return ((b.idx - a.idx) % 12 + 12) % 12
}

/** Whether the target key prefers flats (F, Bb, Eb, Ab, Db, Gb + relative minors) */
function prefersFlats(keyIdx: number, minor: boolean): boolean {
  const majorIdx = minor ? (keyIdx + 3) % 12 : keyIdx
  return [5, 10, 3, 8, 1, 6].includes(majorIdx)
}

function transposeNote(note: string, semitones: number, useFlats: boolean): string {
  const idx = NOTE_INDEX[note]
  if (idx === undefined) return note
  const next = ((idx + semitones) % 12 + 12) % 12
  return useFlats ? FLATS[next] : SHARPS[next]
}

// Matches chord tokens: root + optional quality + optional /bass
const CHORD_RE = /^([A-G][#b]?)([^/\s]*)(\/([A-G][#b]?))?$/

/** Transpose a single chord like "Am7", "F#m7b5", "G/B" */
export function transposeChord(chord: string, semitones: number, useFlats: boolean): string {
  const m = chord.match(CHORD_RE)
  if (!m) return chord
  const root = transposeNote(m[1], semitones, useFlats)
  const quality = m[2] ?? ''
  const bass = m[4] ? '/' + transposeNote(m[4], semitones, useFlats) : ''
  return root + quality + bass
}

const QUALITY_RE = /^(m|maj|min|dim|aug|sus|add|M|mM|º|°|\+|-|\d|#|b|\/|\(|\))/

/** Heuristic: does this token look like a chord? */
function isChordToken(token: string): boolean {
  const m = token.match(CHORD_RE)
  if (!m) return false
  const quality = m[2] ?? ''
  // Bare letter (A, E...) is a chord; or letter followed by chord quality chars
  return quality === '' || QUALITY_RE.test(quality)
}

/** Is this line mostly chords? (used to skip lyric lines in mixed sheets) */
function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  const chordCount = tokens.filter(isChordToken).length
  return chordCount / tokens.length >= 0.6
}

/**
 * Transpose a chords text block. Section headers [Verso] are kept;
 * chord lines are transposed; lyric lines (mixed sheets) are left alone.
 */
export function transposeChordsText(text: string, fromKey: string, toKey: string): string {
  const semis = semitonesBetween(fromKey, toKey)
  if (semis === null || semis === 0) return text
  const target = parseKey(toKey)!
  const useFlats = prefersFlats(target.idx, target.minor)

  return text.split('\n').map(line => {
    if (line.trim().startsWith('[')) return line
    if (!isChordLine(line)) return line
    // Replace tokens preserving whitespace layout
    return line.replace(/\S+/g, token =>
      isChordToken(token) ? transposeChord(token, semis, useFlats) : token
    )
  }).join('\n')
}
