/**
 * Texto para o PDF: limpeza de caracteres que as fontes não têm, formatação
 * de datas/durações em pt-PT e leitura de letras/cifras. Puro.
 */

/* ── Cobertura das fontes embebidas ──
   As TTF em src/lib/pdf/fonts são subconjuntos Latin-1 + –—‘’“”•…↑.
   Tudo o resto é aproximado (NFD sem acentos, tabela abaixo) ou removido,
   para nunca aparecerem quadrados/buracos no PDF. */
const EXTRA_COVERED = '–—‘’“”•…↑'

const REPLACE: Record<string, string> = {
  // Espaços especiais → espaço normal; zero-width → nada
  '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ', '\u202F': ' ', '\u200B': '',
  // Hífens e traços
  '\u2010': '-', '\u2011': '-', '\u2012': '\u2013', '\u2015': '\u2014', '\u2212': '-',
  // Aspas e plicas
  '\u201A': ',', '\u201E': '\u201C', '\u2032': "'", '\u2033': '"', '\u00B4': "'", '\u02BC': '\u2019',
  '\u2039': '<', '\u203A': '>',
  // Letras sem decomposição NFD
  '\u0152': 'OE', '\u0153': 'oe', '\u0141': 'L', '\u0142': 'l', '\u0131': 'i',
  // Setas e notas musicais \u2014 \u266D/\u266F viram b/# (o tom "B\u266D" nunca pode passar a "B")
  '\u2192': '->', '\u2190': '<-', '\u266A': '', '\u266B': '',
  '\u266D': 'b', '\u266F': '#', '\u266E': '',
  // Controlo bidi e zero-width \u2192 nada
  '\u200C': '', '\u200D': '', '\u200E': '', '\u200F': '', '\u2060': '', '\uFEFF': '',
  '\u202A': '', '\u202B': '', '\u202C': '', '\u202D': '', '\u202E': '',
  '\t': '    ',
}

/** "300\u20AC" \u2192 "300 EUR", "\u20AC 20" \u2192 "EUR 20" (as fontes n\u00E3o t\u00EAm o \u20AC). */
function euro(s: string): string {
  if (!s.includes('\u20AC')) return s
  return s.replace(/[ \t]*\u20AC[ \t]*/g, (m, off: number, str: string) => {
    const before = off > 0 && str[off - 1] !== '\n' ? ' ' : ''
    const next = str[off + m.length]
    const after = next !== undefined && next !== '\n' && !/[.,;:!?)\]]/.test(next) ? ' ' : ''
    return `${before}EUR${after}`
  })
}

let covered: ((code: number) => boolean) | null = null

/** Permite ao construtor usar o cmap real da fonte carregada (mais exato). */
export function setCoverage(fn: ((code: number) => boolean) | null) {
  covered = fn
}

function isCovered(code: number): boolean {
  if (covered) return covered(code)
  return (code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF) || EXTRA_COVERED.includes(String.fromCharCode(code))
}

/** Remove/aproxima os caracteres sem glifo nas fontes embebidas. */
export function clean(input: string | null | undefined): string {
  if (!input) return ''
  let out = ''
  // Depois de remover um emoji/símbolo, não deixar dois espaços seguidos
  let dropped = false
  const add = (s: string) => {
    if (dropped && s === ' ' && (out === '' || out.endsWith(' '))) return
    out += s
    if (s !== ' ') dropped = false
  }
  for (const ch of euro(input)) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 10) { add('\n'); dropped = false; continue }
    const rep = REPLACE[ch]
    if (rep !== undefined) { if (rep) add(rep); else dropped = true; continue }
    if (code < 0x20) continue
    if (code <= 0xFFFF && isCovered(code)) { add(ch); continue }
    // Letras com diacríticos fora do Latin-1 (ă, ș, ž…) → letra base
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (base && base !== ch && [...base].every(c => isCovered(c.codePointAt(0) ?? 0))) { add(base); continue }
    // Emojis, símbolos, outras escritas: fora (sem quadrados vazios)
    dropped = true
  }
  return out
}

/* ── Formatação ── */

export const pad2 = (n: number) => String(n).padStart(2, '0')

const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

/** "2026-09-28" → "SEG 28 SET 2026" (data local, sem fuso). null se inválida. */
export function fmtDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(y, m - 1, d)
  if (Number.isNaN(dt.getTime())) return null
  return `${WEEKDAYS[dt.getDay()]} ${pad2(d)} ${MONTHS[m - 1]} ${y}`
}

/** 245 → "4:05" */
export function fmtDur(sec: number | null | undefined): string | null {
  if (!sec || sec <= 0) return null
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`
}

/** Soma em segundos → "1H18" / "42 MIN"; null quando 0. */
export function fmtTotal(sec: number): string | null {
  const min = Math.round(sec / 60)
  if (min <= 0) return null
  return min >= 60 ? `${Math.floor(min / 60)}H${pad2(min % 60)}` : `${min} MIN`
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/* ── Secções da letra ── */

const SECTION_MAP: Record<string, string> = {
  verse: 'VERSO', verso: 'VERSO', estrofe: 'VERSO',
  'pre-chorus': 'PRÉ-REFRÃO', prechorus: 'PRÉ-REFRÃO', 'pre chorus': 'PRÉ-REFRÃO', 'pré-refrão': 'PRÉ-REFRÃO', 'pre-refrão': 'PRÉ-REFRÃO',
  'post-chorus': 'PÓS-REFRÃO', 'pós-refrão': 'PÓS-REFRÃO',
  chorus: 'REFRÃO', refrain: 'REFRÃO', 'refrão': 'REFRÃO', refrao: 'REFRÃO', coro: 'REFRÃO',
  bridge: 'PONTE', ponte: 'PONTE',
  intro: 'INTRO', introdução: 'INTRO', outro: 'FINAL', final: 'FINAL', coda: 'FINAL',
  hook: 'HOOK', instrumental: 'INSTRUMENTAL', solo: 'SOLO',
  interlude: 'INTERLÚDIO', interlúdio: 'INTERLÚDIO', break: 'PAUSA', pausa: 'PAUSA',
}

/** "[Verse 2: Fulano]" → "VERSO 2"; "[Refrão]" → "REFRÃO"; "x2" preservado. */
export function sectionLabel(raw: string): string {
  // Créditos do Genius ("Verse 1: Nome") não interessam em palco
  let s = raw.replace(/:.*$/, '').trim()
  const rep = s.match(/\s*(\(?\s*[x×]\s*\d+\s*\)?)\s*$/i)
  const repeat = rep ? ` ${rep[1].replace(/[()\s]/g, '').replace('×', 'x').toUpperCase()}` : ''
  if (rep) s = s.slice(0, rep.index).trim()
  const num = s.match(/(\d+)\s*$/)
  const key = s.replace(/\d+\s*$/, '').trim().toLowerCase()
  const label = SECTION_MAP[key] ?? key.toUpperCase()
  return clean(`${label}${num ? ` ${num[1]}` : ''}${repeat}`.trim()) || clean(raw.toUpperCase())
}

/** Linha "[Secção]" sozinha → conteúdo; senão null. */
export function matchSection(line: string): string | null {
  const m = line.trim().match(/^\[(.+?)\]$/)
  return m ? m[1] : null
}

/* ── Acordes ── */

const CHORD_RE = /^\(?([A-G][#b]?)([^/\s()]*)(\/([A-G][#b]?))?\)?$/
const QUALITY_RE = /^(m|maj|min|dim|aug|sus|add|M|mM|º|°|\+|-|\d|#|b|\/|\(|\))/

function isChordToken(token: string): boolean {
  if (/^[|:%.\-–x×\d]+$/.test(token)) return true // barras de compasso, "x2", "-"
  const m = token.match(CHORD_RE)
  if (!m) return false
  const quality = m[2] ?? ''
  return quality === '' || QUALITY_RE.test(quality)
}

/** Linha só (ou quase só) com acordes. */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  const chords = tokens.filter(isChordToken).length
  return chords / tokens.length >= 0.6
}

/**
 * Cifra "mista" (acordes por cima da letra). Só substitui a letra no PDF
 * quando a cobre (ver lyricsCoverage em chords.ts); senão aparece em bloco
 * "ACORDES" antes da letra completa, como uma grelha só de acordes.
 */
export function isMixedChordSheet(text: string): boolean {
  let lyric = 0
  let total = 0
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    if (!t || matchSection(t)) continue
    total++
    if (!isChordLine(t)) lyric++
  }
  return lyric >= 2 && lyric / Math.max(1, total) >= 0.25
}
