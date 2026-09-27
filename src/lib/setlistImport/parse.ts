/* ═══════════════════════════════════════════════════════════════
   parseSetlistText — texto livre (PDF, OCR de foto, WhatsApp, notas)
   → lista ordenada de entradas (uma por linha útil; medleys = várias
   músicas na mesma entrada). PURO: corre em Node (ver
   scripts/test-setlist-parse.mjs).

   parseSetlist() devolve também o que NÃO entrou (linhas ignoradas,
   para a revisão as mostrar e deixar repor), o título/data/local do
   documento e sugestões ("separar por vírgulas", "ler coluna a coluna").
═══════════════════════════════════════════════════════════════ */
import { matchKey, smartCase, stripAccents, stripEmoji } from './text'

export interface ParsedSong {
  /** Melhor palpite do título (lado esquerdo de "Título – Artista") */
  title: string
  /** Artista, quando a linha tem "Título – Artista" ou "Título (Artista)" */
  artist?: string
  /** Leitura inversa ("Artista - Título"): guardada para pesquisa/correspondência */
  swapped?: { title: string; artist: string }
  /** Texto limpo completo desta música (sem números, tons, durações) */
  text: string
  /** Tom anotado ("G", "Am", "F#m", "Sol") */
  key?: string
  /** Duração anotada, em segundos */
  durationSec?: number
}

export interface SetlistTextEntry {
  /** Linha original, tal como lida */
  raw: string
  /** 1 música; >1 = medley ("A / B", "A + B") */
  songs: ParsedSong[]
  /** Último cabeçalho visto antes da linha ("SET 1", "ENCORE") */
  section?: string
  /** Momento de um evento ("Entrada da noiva: …") — vai para as notas do concerto */
  moment?: string
  /** Posição da linha no documento (comparável com `SkippedLine.order`) */
  order: number
  /** Linha com duas colunas de texto lida como "Título – Artista" (podem ser duas listas lado a lado) */
  fromColumns?: boolean
  /** A mesma música já apareceu antes na lista */
  repeat?: boolean
}

/** Porque é que uma linha com texto não entrou na lista. */
export type SkipReason = 'prose' | 'chat' | 'app' | 'end' | 'repeat' | 'title' | 'date' | 'label' | 'other'

export interface SkippedLine {
  order: number
  /** Linha original */
  raw: string
  /** Texto limpo (sem prefixo de WhatsApp, emojis…) — é o que se repõe */
  text: string
  reason: SkipReason
}

/** Dados do documento: título ("Casamento Ana & Rui"), data (YYYY-MM-DD) e local. */
export interface SetlistDocMeta {
  title?: string
  date?: string
  venue?: string
}

export interface SetlistParse {
  entries: SetlistTextEntry[]
  /** Linhas com texto que ficaram de fora (cabeçalhos de secção não contam) */
  skipped: SkippedLine[]
  meta: SetlistDocMeta
  /** Leituras alternativas (quantas músicas dariam), quando fazem sentido */
  suggest: { commas?: number; columns?: number }
}

export interface ParseOptions {
  /** Texto de OCR: corrige 0/1/5 lidos no meio de palavras ("Wonderwa11" → "Wonderwall") */
  ocr?: boolean
  /** Fonte é uma imagem (screenshot): uma última linha repetida é o mini-player da app */
  image?: boolean
  /** Separar músicas por vírgulas ("Valerie, Kiss, Uptown Funk") */
  splitCommas?: boolean
  /** Linhas com colunas (TAB) = listas lado a lado, lidas coluna a coluna */
  splitColumns?: boolean
  /** "Hoje" (para inferir o ano de datas sem ano) */
  today?: Date
}

/* ── Tons ── */
const NOTE = '[A-G](?:#|b|♯|♭)?'
const QUALITY = '(?:maj7|maj|min|m7|m6|m9|m|7|6|9|sus2|sus4|sus|dim|aug|add9)?'
const KEY_LETTER = `${NOTE}${QUALITY}`
const SOLFEGE = '(?:D[óo]|R[ée]|Mi|F[áa]|Sol|L[áa]|Si)(?:#|b|♯|♭)?(?:\\s?(?:menor|maior|m|M))?'
const KEY_ANY = `(?:${KEY_LETTER}|${SOLFEGE})`
const TOM = '(?:[Tt][Oo][Mm]|[Kk][Ee][Yy]|[Tt]onalidade)'
const SEP = '(?:[-–—|·,;]\\s*)?'

const RE_KEY_ONLY = new RegExp(`^${KEY_ANY}$`)
const RE_TRAIL_KEY_BRACKET = new RegExp(`\\s*${SEP}[([{]\\s*(?:${TOM}\\s*:?\\s*)?(${KEY_ANY})\\s*[)\\]}]\\s*$`)
const RE_TRAIL_KEY_TOM = new RegExp(`\\s*(?:[-–—|·,;(]\\s*)?${TOM}\\s*:?\\s*(${KEY_ANY})\\s*\\)?\\s*$`)
const RE_TRAIL_KEY_SEP = new RegExp(`\\s+[-–—|·]\\s*(${KEY_LETTER})\\s*$`)
const RE_TRAIL_KEY_BARE = new RegExp(`\\s+(${KEY_LETTER})\\s*$`)

/* ── Durações, bpm, capo, etiquetas ── */
const RE_TRAIL_DURATION = /\s*(?:[-–—|·,;]\s*)?[([]?\s*(\d{1,2})\s?[:'’´′]\s?(\d{2})\s*(?:["”″]|'')?\s*[)\]]?\s*$/
const RE_TRAIL_DURATION_MIN = /\s*(?:[-–—|·,;]\s*)?[([]?\s*(\d{1,2})\s?(?:min|m)(?:\s?(\d{1,2})\s?s)?\s*[)\]]?\s*$/i
const RE_TRAIL_BPM = /\s*(?:[-–—|·,;]\s*)?[([]?\s*(?:bpm\s*:?\s*\d{2,3}|\d{2,3}\s*bpm)\s*[)\]]?\s*$/i
const RE_TRAIL_CAPO = /\s*(?:[-–—|·,;]\s*)?[([]?\s*capo\s*:?\s*\d{1,2}\s*(?:ª|º|a|o)?\s*(?:casa|traste|fret)?\s*[)\]]?\s*$/i
const RE_TRAIL_TAG = /\s*(?:[-–—|·,;]\s*)?[([]\s*(?:ao\s+vivo|live|ac[úu]stic[oa]|acoustic(?:\s+version)?|cover|remix|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|vers[ãa]o\b[^)\]]*|version\b[^)\]]*|original|bis|single|radio edit|explicit|expl[íi]cito|clean)\s*[)\]]\s*$/i
const RE_TRAIL_TAG_DASH = /\s+[-–—]\s+(?:ao\s+vivo|live|ac[úu]stic[oa]|acoustic(?:\s+version)?|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|radio edit|single version)\s*$/i
const RE_TRAIL_JUNK = /[\s*•·|_~=,;:>/]+$/
const RE_TRAIL_DASH = /\s+[-–—]+\s*$/

/* ── Início da linha ── */
// WhatsApp: "[28/09/26, 21:14] João: …", "28/09/2026 21:14 - João: …", "[21:14, 28/09/2026] João: …"
const RE_WHATSAPP = /^\s*\[?\s*(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\.?)?|\d{1,2}:\d{2}(?::\d{2})?,?\s+\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s*\]?\s*(?:-\s*)?(?:[^:\n]{1,40}:\s+)?/i
const RE_BULLETS = /^[\s•·▪▫◦‣∙○●■□►▶➤➔→⇒>*+|~_=–—-]+/
const RE_NUM_PAREN = /^[([]\s*(\d{1,3})\s*[)\]]\s*[.:\-–—]?\s*/
const RE_NUM_HASH = /^#\s?(\d{1,3})(?!\d)\s*[.):\-–—]?\s*/
const RE_NUM_DOT = /^(\d{1,3}|[IVX]{1,4}|[ivx]{1,4}|[l|])\s*[.)\]:ºª°](?!\d)\s*[-–—.)]?\s*/
const RE_NUM_DASH = /^(\d{1,3})\s*[-–—]\s*(?=\D)/
const RE_NUM_BARE = /^(\d{1,3})\s*(?=[\p{L}"“'(])/u

/* ── Cabeçalhos e linhas que não são músicas ── */
const RE_HEADER_SET = /^(?:set|parte|bloco|part|ato|acto)\s*(?:\d{1,2}|[ivx]{1,4}|um|dois|tres|one|two|three|final|acustico|eletrico|electrico|unplugged)\b/
const RE_HEADER_SET2 = /^(?:\d{1,2}|[ivx]{1,4})\s*(?:o|a|º|ª|°)?\s*(?:set|parte|bloco)\b/
const RE_HEADER_WORD = /^(?:intervalo|pausa|break|encore|encores|bis|extra|extras|abertura|opening|fecho|setlist|set list|set-list|alinhamento|repertorio|playlist|lista|lista de musicas|musicas|songs|tracklist|soundcheck|passagem de som|apresentacao(?: da banda| dos musicos)?|agradecimentos|discurso|fim|the end|obrigad[oa]|reservas?|suplentes|se houver tempo|if time)$/
const RE_HEADER_LEAD = /^(?:setlist|set list|set-list|alinhamento(?: musical)?|repertorio|playlist|tracklist|programa(?: musical| de musicas)?|lista de musicas|musicas do (?:casamento|evento|concerto))\b/
const RE_LABEL = /^(?:local|sala|venue|onde|morada|hora|horario|data|dia|concerto|evento|cliente|contacto|contato|som|luz|backline|cachet|notas?|obs|observacoes|dress ?code|farda|tom|key|bpm|capo|duracao|total|tempo|chegada|montagem)\s*:/
const RE_VENUE_LABEL = /^(?:local|sala|venue|onde|morada)\s*:\s*(.+)$/i
const RE_PAGE = /^(?:p(?:ag(?:ina)?)?\.?\s*)?\d{1,3}\s*(?:\/|de|of)\s*\d{1,3}$/
const RE_COUNT = /^\d{1,3}\s*(?:musicas|songs|temas|faixas|tracks)\b/
const RE_TOTAL = /^(?:total|duracao)\s*[:=-]?\s*\d/
const RE_URL = /https?:\/\/|www\.|\.com\b|\.pt\b/
// "João Silva • 23 músicas, 1 h 20 min" (cabeçalho de playlist)
const RE_APP_COUNT = /(?:^|[•·|,]|\s)\s*\d{1,4}\s*(?:musicas|songs|faixas|tracks|temas|videos|m[uú]sicas)\b/
const RE_LENGTH_ONLY = /^(?:\d{1,2}\s*h(?:\s*\d{1,2}\s*min)?|\d{1,3}\s*min(?:\s*\d{1,2}\s*s)?)$/
const APP_UI = new Set([
  'shuffle', 'aleatorio', 'modo aleatorio', 'reproduzir', 'reproducao aleatoria', 'reproduzir aleatoriamente',
  'shuffle play', 'download', 'transferir', 'transferido', 'descarregar', 'baixar', 'seguir', 'seguindo',
  'follow', 'following', 'partilhar', 'compartilhar', 'liked songs', 'musicas curtidas',
  'musicas de que gostas', 'a tua biblioteca', 'sua biblioteca', 'your library', 'premium',
  'ver tudo', 'see all', 'ordenar', 'filtrar', 'recomendadas', 'recommended songs', 'musicas recomendadas',
  'adicionar a playlist', 'add to playlist', 'adicionar musicas', 'add songs', 'lista de reproducao',
  'editar lista', 'edit playlist', 'playlist publica', 'public playlist', 'encontrar na playlist',
  'find in playlist', 'add to this playlist', 'adicionar a esta playlist', 'adicionar a esta lista',
  'procurar na playlist', 'search in playlist', 'ouvir agora', 'listen now', 'a tocar', 'now playing',
  'a reproduzir', 'playing from playlist', 'a reproduzir da playlist', 'sort', 'filter', 'edit', 'editar',
  'reproducao automatica', 'autoplay', 'up next', 'a seguir', 'fila', 'queue', 'letra', 'lyrics',
  'guardar', 'save', 'saved', 'guardado', 'mais', 'more', 'play', 'pause', 'pausa', 'baixado', 'downloaded',
])
// Palavras da barra de separadores / menus das apps (uma linha feita SÓ disto não é música)
const UI_WORDS = new Set([
  'inicio', 'pesquisar', 'procurar', 'biblioteca', 'library', 'home', 'search', 'premium', 'criar', 'create',
  'ouvir', 'listen', 'now', 'agora', 'explorar', 'explore', 'browse', 'radio', 'samples', 'amostras',
  'playlists', 'podcasts', 'artistas', 'artists', 'albuns', 'albums', 'downloads', 'perfil', 'profile',
  'definicoes', 'settings', 'shorts', 'subscricoes', 'subscriptions', 'novidades', 'new', 'feed',
])
const UI_FILLER = new Set(['a', 'tua', 'sua', 'your', 'the', 'de', 'e', 'o', 'os', 'as', 'my', 'minha'])
// Fim da lista num screenshot: a partir daqui são sugestões da app
const RE_END_OF_LIST = /^(?:musicas recomendadas|recomendad[ao]s(?: para ti| para esta playlist)?|recommended(?: songs| for (?:you|this playlist))?|based on (?:what'?s in )?this playlist|baseado (?:no que (?:esta|ha) nesta playlist|nesta playlist)|com base (?:no que (?:esta|ha) nesta playlist|nesta playlist)|sugestoes(?: para ti)?|suggested(?: songs)?|mais como (?:isto|esta)|more like this|you might also like|tambem pode(?:s)? gostar|videos relacionados|related)\b/

/* ── Eventos (casamentos, batizados…): "Entrada da noiva: A Thousand Years" ── */
const RE_MOMENT = /^(?:(?:a|o|os|as)\s+)?(?:entrada|saida|cortejo|primeira danca|1a danca|danca(?: dos noivos| dos pais| pai e filha| mae e filho)?|valsa|bolo|corte do bolo|brinde|aliancas|troca de aliancas|assinatura|abertura|cocktail|aperitivo|boas[- ]vindas|welcome(?: drink)?|jantar|almoco|sobremesa|bouquet|lancamento do (?:bouquet|ramo)|ramo|cerimonia|ceremonia|missa|igreja|comunhao|ofertorio|salmo|aleluia|leitura|leituras|votos|beijo|recessional|processional|copo d.?agua|rececao|recepcao|festa|pista|open bar|homenagem|parabens|velas|fogo(?: de artificio)?|slideshow|video|chegada|momento|first dance|cake(?: cutting)?|toast|rings|signing|entrance|exit|dinner|party)\b/
// Momentos que não são nomes de músicas (pesam mais para reconhecer um programa de evento)
const RE_MOMENT_STRONG = /^(?:cerimonia|ceremonia|jantar|almoco|cocktail|aperitivo|copo d.?agua|bolo|corte do bolo|bouquet|lancamento do|brinde|aliancas|troca de aliancas|missa|rececao|recepcao|primeira danca|entrada d[aeo]s?\s|saida d[aeo]s?\s|assinatura|ofertorio|comunhao|first dance|cake)/
const RE_EVENT_TITLE =/^(?:casamento|boda|bodas de|batizado|batismo|aniversario|festa de|jantar de|gala|evento|wedding|programa de|comunhao de|primeira comunhao)\b/

/* ── Datas ── */
const RE_WEEKDAY = /\b(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|ter|qua|qui|sex|sab|dom|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)(?:-feira|\s+feira)?\b\.?/g
const MONTH = '(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|january|february|march|april|may|june|july|august|september|october|november|december|jan|fev|feb|mar|abr|apr|mai|jun|jul|ago|aug|set|sep|sept|out|oct|nov|dez|dec)\\.?'
const RE_DAY_MONTH = new RegExp(`\\b\\d{1,2}\\s*(?:de\\s+)?${MONTH}(?:\\s*(?:de\\s+)?\\d{2,4})?\\b|\\b${MONTH}\\s+\\d{1,2}\\b`, 'g')
const RE_NUMERIC_DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{2}\b/g
const RE_YEAR = /\b(?:19|20)\d{2}\b/g
const RE_TIME = /\b\d{1,2}(?::\d{2}|h\d{0,2})\b/g
const MONTH_NUM: Record<string, number> = {
  jan: 1, janeiro: 1, january: 1, fev: 2, feb: 2, fevereiro: 2, february: 2, mar: 3, marco: 3, march: 3,
  abr: 4, apr: 4, abril: 4, april: 4, mai: 5, may: 5, maio: 5, jun: 6, junho: 6, june: 6, jul: 7, julho: 7,
  july: 7, ago: 8, aug: 8, agosto: 8, august: 8, set: 9, sep: 9, sept: 9, setembro: 9, september: 9,
  out: 10, oct: 10, outubro: 10, october: 10, nov: 11, novembro: 11, november: 11, dez: 12, dec: 12,
  dezembro: 12, december: 12,
}

/** Minúsculas sem acentos, para testes de cabeçalhos/etiquetas */
function norm(s: string): string {
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim()
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
}

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length
}

function isAllCapsLine(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '')
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

/** Tira decorações de cabeçalhos: "--- SET 1 ---", "== ENCORE ==", "*INTERVALO*" */
function stripDecor(s: string): string {
  return s.replace(/^[\s\-=*_~#·•|:.>]+/, '').replace(/[\s\-=*_~#·•|:.<]+$/, '').trim()
}

function isDateLine(n: string): boolean {
  const numeric = (n.match(RE_NUMERIC_DATE) ?? []).length > 0
  const dayMonth = (n.match(RE_DAY_MONTH) ?? []).length > 0
  const weekday = (n.match(RE_WEEKDAY) ?? []).length > 0
  const year = (n.match(RE_YEAR) ?? []).length > 0
  if (!numeric && !dayMonth && !weekday) return false
  const rest = wordCount(n
    .replace(RE_NUMERIC_DATE, ' ').replace(RE_DAY_MONTH, ' ').replace(RE_WEEKDAY, ' ')
    .replace(RE_YEAR, ' ').replace(RE_TIME, ' ')
    .replace(/\b(?:de|do|da|as|a|e|pelas|at)\b/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' '))
  if (numeric || dayMonth) {
    if (rest <= 1) return true
    // Linha de metadados com data completa ("Quinta da Ribeira · Sáb 28/09/2026")
    return year || weekday || /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(n)
  }
  // Só dia da semana: "Sáb 21h" é data; "10:15 Saturday Night" é uma música
  return rest === 0 && /\d/.test(n)
}

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false
  const dt = new Date(y, m - 1, d)
  return dt.getMonth() === m - 1 && dt.getDate() === d
}

/** Ano de uma data sem ano: a próxima ocorrência (uma semana de tolerância para trás). */
function inferYear(m: number, d: number, today: Date): number {
  const y = today.getFullYear()
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7)
  return new Date(y, m - 1, d) < limit ? y + 1 : y
}

/** Data numa linha já normalizada (minúsculas, sem acentos) → YYYY-MM-DD. */
export function parseDateText(n: string, today: Date = new Date()): string | undefined {
  let m = n.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (m && validDate(+m[1], +m[2], +m[3])) return ymd(+m[1], +m[2], +m[3])
  m = n.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    if (validDate(y, +m[2], +m[1])) return ymd(y, +m[2], +m[1])
  }
  const re = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MONTH})(?:\\s*(?:de\\s+)?(\\d{4}))?`)
  m = n.match(re)
  if (m) {
    const mon = MONTH_NUM[m[2].replace('.', '')]
    const d = +m[1]
    if (mon) {
      const y = m[3] ? +m[3] : inferYear(mon, d, today)
      if (validDate(y, mon, d)) return ymd(y, mon, d)
    }
  }
  m = n.match(/\b(\d{1,2})[/.](\d{1,2})\b/)
  if (m && validDate(today.getFullYear(), +m[2], +m[1])) {
    const y = inferYear(+m[2], +m[1], today)
    return ymd(y, +m[2], +m[1])
  }
  return undefined
}

/** Local numa linha de data ("Quinta da Ribeira — 12 de Outubro de 2026" → "Quinta da Ribeira"). */
function venueFromDateLine(line: string): string | undefined {
  const parts = stripDecor(line).split(/\s+[—–|·•-]\s+|\s*[|·•]\s*|,\s+/)
  for (const part of parts) {
    const p = stripDecor(part)
    const n = norm(p)
    if (!n || RE_LABEL.test(n)) continue
    // Uma parte com data/hora não é o local ("12 de Outubro de 2026", "21h30")
    if ([RE_NUMERIC_DATE, RE_DAY_MONTH, RE_YEAR, RE_TIME].some(re => (n.match(re) ?? []).length > 0)) continue
    // Só o dia da semana ("Sábado") também não; "Quinta da Ribeira" sim
    const words = n.replace(RE_WEEKDAY, ' ')
      .replace(/\b(?:de|do|da|dos|das|e|as|a|o|os|pelas|at)\b/g, ' ')
      .replace(/[^\p{L}\s]/gu, ' ')
      .split(/\s+/).filter(w => w.length >= 2)
    if (words.length === 0) continue
    return smartCase(p)
  }
  return undefined
}

/** skip = ignorar; header = secção ("SET 1"); title = título/local do documento (só é secção depois da 1.ª música) */
type Skip = { kind: 'skip'; reason: SkipReason } | { kind: 'header'; label: string } | { kind: 'title'; label: string }

/** Cabeçalhos de secção por palavra-chave ("SET 1", "1º SET", "INTERVALO", "ENCORE", "Setlist …"). */
function keywordHeader(line: string): Skip | null {
  const decor = stripDecor(line)
  const n = norm(decor)
  if (!n) return null
  const words = wordCount(n)
  const label = decor.toUpperCase().replace(/\s+/g, ' ')
  if (RE_HEADER_WORD.test(n)) return { kind: 'header', label }
  if ((RE_HEADER_SET.test(n) && words <= 5) || (RE_HEADER_SET2.test(n) && words <= 3)) return { kind: 'header', label }
  if (RE_HEADER_LEAD.test(n) && words <= 8) return { kind: 'skip', reason: 'title' }
  return null
}

function isMomentLine(n: string): boolean {
  return wordCount(n) <= 5 && RE_MOMENT.test(n) && !/\s[-–—|/+]\s/.test(n)
}

/** "Entrada da noiva: A Thousand Years" → momento + resto. O travessão só num documento de evento. */
function splitMoment(line: string, event: boolean): { moment: string; rest: string } | null {
  const m = line.match(/^([^:：]{2,48}?)\s*[:：]\s+(\S.*)$/) ?? (event ? line.match(/^(.{2,40}?)\s+[-–—]\s+(\S.*)$/) : null)
  if (!m) return null
  const left = stripDecor(m[1])
  const n = norm(left)
  if (!n || wordCount(n) > 5 || !RE_MOMENT.test(n)) return null
  if (letterCount(m[2]) < 2) return null
  return { moment: smartCase(left), rest: m[2].trim() }
}

/** Linha só com números de outra lista / contagens / durações */
function proseProbe(line: string): string {
  return line
    .replace(/^\s*\d{1,3}\s*[.)]\s*/, '')
    .replace(/\b(?:feat|ft|featuring|mr|mrs|ms|st|dr|vs|vol|pt|jr|sr|no|nr|op|n)\.(?=\s)/gi, 'x')
    .replace(/\b(?:\p{Lu}\.){2,}/gu, 'X')
}

/** Linhas que não são músicas (cabeçalhos, datas, locais, UI de apps, prosa). */
function classifyNonSong(line: string, hadNumber: boolean, ctx: Ctx): Skip | null {
  const decor = stripDecor(line)
  const n = norm(decor)
  if (!n) return { kind: 'skip', reason: 'other' }
  const words = wordCount(n)

  const kw = keywordHeader(line)
  if (kw) return kw
  if (ctx.event && isMomentLine(n)) return { kind: 'header', label: decor.toUpperCase().replace(/\s+/g, ' ') }
  if (/:\s*$/.test(line.trim()) && words <= 6) return { kind: 'header', label: decor.toUpperCase() }
  if (RE_LABEL.test(n)) return { kind: 'skip', reason: 'label' }
  if (/^@\s*\S/.test(line.trim())) return { kind: 'skip', reason: 'label' }
  if (RE_PAGE.test(n) || RE_COUNT.test(n) || RE_TOTAL.test(n) || RE_LENGTH_ONLY.test(n)) return { kind: 'skip', reason: 'other' }
  if (RE_URL.test(n)) return { kind: 'skip', reason: 'other' }
  const letters = n.replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (APP_UI.has(letters)) return { kind: 'skip', reason: 'app' }
  if (RE_APP_COUNT.test(n) && !hadNumber) return { kind: 'skip', reason: 'app' }
  if (ctx.ocr) {
    const ws = letters.split(' ').filter(Boolean)
    const strong = ws.filter(w => UI_WORDS.has(w)).length
    if (ws.length >= 2 && strong >= 2 && ws.every(w => UI_WORDS.has(w) || UI_FILLER.has(w))) return { kind: 'skip', reason: 'app' }
  }
  if (isDateLine(n)) return { kind: 'skip', reason: 'date' }
  // Título de evento ("Casamento Ana & Rui") — nome sugerido, não é música
  if (!hadNumber && RE_EVENT_TITLE.test(n) && words <= 8) return { kind: 'title', label: decor }
  // Prosa (mensagens): demasiadas palavras, ou frases completas. Uma linha numerada ou
  // com "Título – Artista" é uma música ("Uptown Funk (feat. Bruno Mars) – Mark Ronson").
  const hasSep = RE_TITLE_ARTIST.test(decor)
  if (hadNumber || hasSep) {
    if (words > 16) return { kind: 'skip', reason: 'prose' }
  } else {
    const probe = proseProbe(line)
    if (words > 12) return { kind: 'skip', reason: 'prose' }
    if (words > 6 && /[.!?]\s+\p{Lu}/u.test(probe)) return { kind: 'skip', reason: 'prose' }
    if (words > 5 && /\?\s*$/.test(line)) return { kind: 'skip', reason: 'prose' }
    // Numa lista numerada, as linhas soltas de conversa ("Chegamos às 19h!", "ok boa")
    if (ctx.numbered && (/[!?]\s*$/.test(line) || (!/\p{Lu}/u.test(line) && words <= 4))) return { kind: 'skip', reason: 'chat' }
  }
  // Cabeçalho "gritado" (nome da sala, título) num documento que NÃO está todo em maiúsculas
  if (!hadNumber && !ctx.mostlyUpper && isAllCapsLine(decor) && words >= 2 && words <= 5
    && !/\s[-–—|•·/+]\s/.test(decor)) {
    return { kind: 'title', label: decor.toUpperCase() }
  }
  // Lista de nomes ("João - Pedro - Maria"): 3+ partes só com palavras
  const parts = decor.split(/\s*[-–—]\s*/)
  if (parts.length >= 3 && parts.every(p => /^[\p{L}]{2,}(?:\s[\p{L}]+)*$/u.test(p.trim()))) return { kind: 'skip', reason: 'other' }
  return null
}

/* ── Contexto do documento (1.ª passagem) ── */
interface Ctx {
  mostlyUpper: boolean
  trailingKeys: boolean
  /** A maioria das linhas é numerada ("1.", "2)") */
  numbered: boolean
  /** Programa de evento (momentos "Entrada…", "Jantar", "Casamento …") */
  event: boolean
  ocr: boolean
}

/** Linha depois da 1.ª limpeza (antes da classificação). */
interface VLine {
  raw: string
  line: string
  order: number
  /** Veio de uma linha com colunas lidas como Título – Artista */
  cols?: boolean
}

interface Prepped extends VLine {
  /** Número de ordem explícito ("1.", "#3", "1 -") */
  explicitNum: number | null
  /** Número "nu" no início ("1 Wonderwall") — só é numeração se encaixar na sequência */
  bareNum: number | null
}

function prepLine(raw: string): string {
  let s = raw.replace(/\u00A0/g, ' ')
  s = s.replace(RE_WHATSAPP, '')
  s = stripEmoji(s)
  // Pontos de preenchimento ("Wonderwall ........ 4:18")
  s = s.replace(/(?:\s*[.·…_]){3,}\s*/g, ' ')
  s = s.replace(/[ \f\v\r]+/g, ' ')
  s = s.replace(RE_BULLETS, '')
  // Aspas à volta da linha inteira
  s = s.replace(/^["“«„](.*)["”»]$/, '$1').replace(/^["“«„]\s*/, '')
  return s.trim()
}

function explicitNumber(line: string): number | null {
  for (const re of [RE_NUM_PAREN, RE_NUM_HASH, RE_NUM_DASH]) {
    const m = line.match(re)
    if (m) return Number(m[1])
  }
  const m = line.match(RE_NUM_DOT)
  if (m) return /^\d+$/.test(m[1]) ? Number(m[1]) : -1
  return null
}

function stripNumbering(line: string, allowBare: boolean): { line: string; had: boolean } {
  for (const re of [RE_NUM_PAREN, RE_NUM_HASH, RE_NUM_DOT, RE_NUM_DASH]) {
    if (re.test(line)) return { line: line.replace(re, '').replace(RE_BULLETS, '').trim(), had: true }
  }
  if (allowBare && RE_NUM_BARE.test(line)) {
    return { line: line.replace(RE_NUM_BARE, '').replace(RE_BULLETS, '').trim(), had: true }
  }
  return { line, had: false }
}

/* ── Limpeza do fim de cada música ── */
interface Cleaned { text: string; key?: string; durationSec?: number }

function cleanTrailing(input: string, ctx: Pick<Ctx, 'trailingKeys'>): Cleaned {
  let s = input.trim()
  let key: string | undefined
  let durationSec: number | undefined
  for (let guard = 0; guard < 8; guard++) {
    const before = s
    let m: RegExpMatchArray | null
    if ((m = s.match(RE_TRAIL_DURATION))) {
      const min = Number(m[1]); const sec = Number(m[2])
      if (min <= 20 && sec < 60 && durationSec === undefined) durationSec = min * 60 + sec
      s = s.slice(0, m.index).trim()
    } else if ((m = s.match(RE_TRAIL_DURATION_MIN)) && letterCount(s.slice(0, m.index)) >= 2) {
      const min = Number(m[1]); const sec = m[2] ? Number(m[2]) : 0
      if (min <= 20 && durationSec === undefined) durationSec = min * 60 + sec
      s = s.slice(0, m.index).trim()
    } else if ((m = s.match(RE_TRAIL_KEY_BRACKET))) {
      key ??= m[1]
      s = s.slice(0, m.index).trim()
    } else if ((m = s.match(RE_TRAIL_KEY_TOM))) {
      key ??= m[1]
      s = s.slice(0, m.index).trim()
    } else if ((m = s.match(RE_TRAIL_KEY_SEP)) && letterCount(s.slice(0, m.index)) >= 2) {
      key ??= m[1]
      s = s.slice(0, m.index).trim()
    } else if ((m = s.match(RE_TRAIL_BPM)) || (m = s.match(RE_TRAIL_CAPO))) {
      s = s.slice(0, m.index).trim()
    } else if ((m = s.match(RE_TRAIL_TAG)) || (m = s.match(RE_TRAIL_TAG_DASH))) {
      s = s.slice(0, m.index).trim()
    } else if (RE_TRAIL_JUNK.test(s) || RE_TRAIL_DASH.test(s)) {
      s = s.replace(RE_TRAIL_JUNK, '').replace(RE_TRAIL_DASH, '').trim()
    }
    if (s === before) break
  }
  // Tom "nu" no fim ("Wonderwall G") — só quando o documento usa esse padrão; uma vez
  if (ctx.trailingKeys) {
    const m = s.match(RE_TRAIL_KEY_BARE)
    if (m && wordCount(s.slice(0, m.index)) >= 1 && letterCount(s.slice(0, m.index)) >= 2) {
      key ??= m[1]
      s = s.slice(0, m.index).replace(RE_TRAIL_JUNK, '').replace(RE_TRAIL_DASH, '').trim()
    }
  }
  s = s.replace(/^["“«„]+\s*/, '').replace(/\s*["”»]+$/, '')
  return { text: s.replace(/\s+/g, ' ').trim(), key, durationSec }
}

/** Confusões típicas de OCR dentro de palavras: 0→o, 1→l, 5→s ("Wonderwa11"). */
function fixOcrDigits(s: string): string {
  return s.replace(/[\p{L}\d']+/gu, tok => {
    const letters = letterCount(tok)
    const digits = (tok.match(/\d/g) ?? []).length
    if (letters < 2 || digits === 0 || digits > 2 || /[2-46-9]/.test(tok) || /^\d/.test(tok)) return tok
    return tok.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's')
  })
}

function isJunk(s: string, hadNumber: boolean): boolean {
  // Títulos só com números ("22", "1979") só quando a linha era um item numerado
  if (hadNumber && /^\d[\d\s\-–.]{1,18}$/.test(s.trim())) return false
  const letters = letterCount(s)
  if (letters < 2) return true
  const nonSpace = s.replace(/\s/g, '').length
  if (letters / nonSpace < 0.5) return true
  const distinct = new Set((s.toLowerCase().match(/\p{L}/gu) ?? [])).size
  if (distinct < 2) return true
  const toks = s.split(/\s+/).filter(Boolean)
  // Ruído de OCR "i l | a e": maioria de tokens de 1 carácter
  if (toks.length >= 3 && toks.filter(t => t.length === 1).length / toks.length > 0.5) return true
  return false
}

const RE_TITLE_ARTIST = /\s+[-–—|•·]\s+|(?<=\p{L})\s?[–—]\s?(?=\p{L})/u
const RE_PAREN_ARTIST = /^(.*\S)\s*\(([^()]{2,40})\)$/

function buildSong(part: string, ctx: Ctx, opts: ParseOptions, hadNumber: boolean): ParsedSong | null {
  const cleaned = cleanTrailing(part, ctx)
  let text = cleaned.text
  let key = cleaned.key
  if (opts.ocr) text = fixOcrDigits(text)
  if (!text || isJunk(text, hadNumber)) return null
  text = smartCase(text)

  let title = text
  let artist: string | undefined
  let swapped: ParsedSong['swapped']
  const sep = text.match(RE_TITLE_ARTIST)
  if (sep && sep.index !== undefined && sep.index > 0) {
    const left = text.slice(0, sep.index).trim()
    let right = text.slice(sep.index + sep[0].length).trim()
    // Badge "explícito" das apps lido como "E" antes do artista ("Valerie – E Amy Winehouse")
    if (opts.ocr) right = right.replace(/^(?:\[E\]|E)\s+(?=\p{Lu})/u, '')
    if (letterCount(left) >= 1 && letterCount(right) >= 2) {
      // "Wonderwall (G) – Oasis": o tom pode estar colado ao título
      const l = cleanTrailing(left, { trailingKeys: false })
      title = l.text || left
      key ??= l.key
      artist = right
      swapped = { title: right, artist: title }
      text = `${title} – ${artist}`
    }
  } else {
    const pm = text.match(RE_PAREN_ARTIST)
    if (pm && /^\p{Lu}/u.test(pm[2].trim()) && !/^(?:feat|ft|with|com|part|pt|prod|vers|reprise|intro|outro|instrumental|man in|from)\b/i.test(pm[2].trim())
      && letterCount(pm[1]) >= 2) {
      title = pm[1].trim()
      artist = pm[2].trim()
    }
  }
  if (letterCount(title) < 1 && !/\d{2}/.test(title)) return null
  const song: ParsedSong = { title, text }
  if (artist) song.artist = artist
  if (swapped) song.swapped = swapped
  if (key) song.key = key.replace('♯', '#').replace('♭', 'b')
  if (cleaned.durationSec) song.durationSec = cleaned.durationSec
  return song
}

const RE_COLUMN_HEADER = /^(?:#|n\.?[ºo]?|musica|titulo|song|title|track|faixa|artista|artist|interprete|tom|key|tonalidade|duracao|duration|tempo|bpm|notas?|obs)$/i

/** Célula só com metadados ("Am 4:02", "G", "120 bpm", "7") → tom/duração, ou null se tem texto. */
function metaCell(c: string): { key?: string; durationSec?: number } | null {
  const toks = c.split(/\s+/)
  if (!toks.every(t => /^#?\d{1,3}[.)]?$/.test(t) || /^\d{1,2}[:'’]\d{2}$/.test(t) || RE_KEY_ONLY.test(t) || /^(?:\d{2,3})?bpm$/i.test(t))) return null
  const out: { key?: string; durationSec?: number } = {}
  for (const t of toks) {
    const d = t.match(/^(\d{1,2})[:'’](\d{2})$/)
    if (d) out.durationSec ??= Number(d[1]) * 60 + Number(d[2])
    else if (RE_KEY_ONLY.test(t)) out.key ??= t
  }
  return out
}

function isColumnHeaderRow(cells: string[]): boolean {
  return cells.filter(c => RE_COLUMN_HEADER.test(stripAccents(c))).length >= 2
}

/** Uma linha de folha de cálculo (colunas separadas por TAB) → "Título – Artista" + tom/duração */
function fromCells(line: string): { line: string; key?: string; durationSec?: number; textCells: number } {
  const cells = line.split(/\t+/).map(c => c.trim()).filter(Boolean)
  // Linha de cabeçalho da tabela ("#  Música  Artista  Tom  Duração")
  if (isColumnHeaderRow(cells)) return { line: '', textCells: 0 }
  let key: string | undefined
  let durationSec: number | undefined
  const text: string[] = []
  for (const c of cells) {
    const meta = metaCell(c)
    if (meta) {
      key ??= meta.key
      durationSec ??= meta.durationSec
      continue
    }
    // Ruído numa coluna à parte (ícone "⋯" lido como "a", "|")
    if (letterCount(c) < 2 && !/\d{2}/.test(c)) continue
    text.push(c)
  }
  return { line: text.slice(0, 2).join(' – '), key, durationSec, textCells: text.length }
}

/* ── Colunas lado a lado ("SET 1 | SET 2") ── */

function isNumberedText(s: string): boolean {
  const n = explicitNumber(prepLine(s))
  return n !== null && n >= 0
}

function isHeaderText(s: string): boolean {
  return keywordHeader(prepLine(s))?.kind === 'header'
}

/**
 * Duas colunas de texto (esquerda/direita da mesma linha visual) são duas listas lado a
 * lado — e não "Título | Artista" — quando há um cabeçalho de secção nas duas ("SET 1 |
 * SET 2") ou quando as duas colunas vêm numeradas ("1. Valerie | 7. Dancing Queen").
 */
export function looksLikeParallelColumns(pairs: readonly (readonly [string, string])[]): boolean {
  const L = pairs.filter(([l]) => letterCount(l) >= 2)
  const R = pairs.filter(([, r]) => letterCount(r) >= 2)
  const both = pairs.filter(([l, r]) => letterCount(l) >= 2 && letterCount(r) >= 2)
  if (R.length < 2 || L.length < 2) return false
  if (both.some(([l, r]) => isHeaderText(l) && isHeaderText(r))) return true
  if (both.length < 2) return false
  const numL = L.filter(([l]) => isNumberedText(l)).length
  const numR = R.filter(([, r]) => isNumberedText(r)).length
  return numL / L.length >= 0.6 && numR / R.length >= 0.6
}

/** Grupos de células de uma linha com TAB: cada grupo começa num texto; tom/duração/nº ficam no grupo. */
function cellGroups(line: string): string[] {
  const cells = line.split(/\t+/).map(c => c.trim()).filter(Boolean)
  const groups: string[][] = []
  let pendingNum: string | null = null
  for (const c of cells) {
    // Número numa coluna à parte ("1 | Wonderwall"): é do texto que vem a seguir
    if (/^#?\d{1,3}[.)ºª]?$/.test(c)) { pendingNum = c; continue }
    if (metaCell(c) || letterCount(c) < 2) {
      if (groups.length) groups[groups.length - 1].push(c)
      continue
    }
    const num = pendingNum ? `${pendingNum.replace(/[.)ºª]$/, '')}. ` : ''
    pendingNum = null
    groups.push([num + c])
  }
  return groups.map(g => g.join('\t'))
}

/**
 * Linhas com TAB que são listas lado a lado → a coluna da esquerda inteira, depois a da
 * direita (a ordem de leitura de uma folha com dois sets). Sem sinais claros fica como está
 * (a menos que `force`).
 */
function expandColumns(lines: VLine[], force: boolean): VLine[] {
  const tabIdx = lines.map((l, i) => (l.line.includes('\t') ? i : -1)).filter(i => i >= 0)
  if (tabIdx.length < 2) return lines
  const groups = new Map<number, string[]>()
  for (const i of tabIdx) {
    const cells = lines[i].line.split(/\t+/).map(c => c.trim()).filter(Boolean)
    if (isColumnHeaderRow(cells)) return lines // tabela com cabeçalho de colunas
    groups.set(i, cellGroups(lines[i].line))
  }
  const multi = tabIdx.filter(i => (groups.get(i)?.length ?? 0) >= 2)
  if (multi.length < 2) return lines
  if (!force) {
    const pairs = tabIdx.map(i => {
      const g = groups.get(i) ?? []
      return [g[0] ?? '', g[1] ?? ''] as const
    })
    if (!looksLikeParallelColumns(pairs)) return lines
  }
  const first = tabIdx[0]
  const last = tabIdx[tabIdx.length - 1]
  const maxCols = Math.max(...multi.map(i => groups.get(i)!.length))
  const out: VLine[] = lines.slice(0, first)
  for (let c = 0; c < maxCols; c++) {
    for (let i = first; i <= last; i++) {
      const g = groups.get(i)
      if (g) {
        if (g[c]) out.push({ raw: lines[i].raw, line: g[c], order: 0 })
      } else if (c === 0) {
        out.push({ ...lines[i] })
      }
    }
  }
  out.push(...lines.slice(last + 1))
  return out
}

/** "1. Valerie 2. Kiss 3. Uptown Funk" / "1. A / 2. B" → uma linha por número (sequencial). */
function splitInlineNumbering(line: string): string[] {
  const re = /(?:^|[\s/,;|])\s*(\d{1,2})\s*[.)]\s+(?=\S)/g
  const marks: { at: number; n: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    marks.push({ at: m.index + m[0].search(/\d/), n: Number(m[1]) })
  }
  if (marks.length < 2 || marks[0].at !== 0) return [line]
  const seq = [marks[0]]
  for (const mk of marks.slice(1)) {
    if (mk.n === seq[seq.length - 1].n + 1) seq.push(mk)
  }
  if (seq.length < 2) return [line]
  const out: string[] = []
  for (let i = 0; i < seq.length; i++) {
    const piece = line.slice(seq[i].at, i + 1 < seq.length ? seq[i + 1].at : undefined)
      .replace(/[\s/,;|]+$/, '').trim()
    if (piece) out.push(piece)
  }
  return out.length >= 2 ? out : [line]
}

/**
 * Texto livre → entradas de setlist (pela ordem original) + o que ficou de fora.
 * - remove numeração ("1.", "01)", "#3", "1 -", "1️⃣"), marcadores ("•", "-", "*"),
 *   durações ("3:45"), tons no fim ("(G)", "[Am]", "- G", "tom: Sol"), "(ao vivo)", emojis;
 * - ignora cabeçalhos (SET 1, INTERVALO, ENCORE, "Setlist:"), datas, locais, linhas de apps,
 *   e — numa lista numerada — as linhas soltas de conversa;
 * - separa medleys por " / " ou " + "; "1. A 2. B 3. C" numa linha são três músicas;
 * - aceita "Título – Artista" e "Artista - Título" (guarda as duas leituras);
 * - programas de evento: "Entrada da noiva: A Thousand Years" → título + momento;
 * - duas colunas lado a lado ("SET 1 | SET 2") → coluna da esquerda, depois a da direita.
 */
export function parseSetlist(text: string, opts: ParseOptions = {}): SetlistParse {
  const today = opts.today ?? new Date()
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n')

  // 1.ª passagem: limpar, colunas lado a lado, numeração na mesma linha, vírgulas
  let vlines: VLine[] = rawLines.map(raw => ({ raw, line: prepLine(raw), order: 0 }))
  vlines = expandColumns(vlines, !!opts.splitColumns)
  const expanded: VLine[] = []
  for (const v of vlines) {
    let pieces = v.line.includes('\t') ? [v.line] : splitInlineNumbering(v.line)
    if (opts.splitCommas) {
      pieces = pieces.flatMap(p => (p.includes('\t') ? [p] : p.split(/\s*[,;]\s*/).filter(s => s.trim())))
    }
    for (const p of pieces) expanded.push({ raw: v.raw, line: p, order: 0 })
  }
  expanded.forEach((v, i) => { v.order = i })

  const prepped: Prepped[] = expanded.map(v => {
    const explicitNum = explicitNumber(v.line)
    const bm = explicitNum === null ? v.line.match(/^(\d{1,3})\s*(?=[\p{L}"“'(])/u) : null
    return { ...v, explicitNum, bareNum: bm ? Number(bm[1]) : null }
  })
  const withLetters = prepped.filter(p => letterCount(p.line) >= 3)
  const upper = withLetters.filter(p => isAllCapsLine(p.line)).length
  let keyLines = 0
  let numberedLines = 0
  let eventScore = 0
  for (const p of withLetters) {
    const noDur = p.line.replace(RE_TRAIL_DURATION, '').replace(RE_TRAIL_DURATION_MIN, '').trim()
    const m = noDur.match(RE_TRAIL_KEY_BARE)
    if (m && letterCount(noDur.slice(0, m.index)) >= 2) keyLines++
    if (p.explicitNum !== null && p.explicitNum >= 0) numberedLines++
    const body = stripNumbering(p.line, false).line
    const n = norm(stripDecor(body))
    if (splitMoment(body, false)) eventScore += 2
    else if (RE_EVENT_TITLE.test(n) && wordCount(n) <= 8) eventScore += 2
    else if (isMomentLine(n)) eventScore += RE_MOMENT_STRONG.test(n) ? 1 : 0.5
  }
  const ctx: Ctx = {
    mostlyUpper: withLetters.length > 0 && upper / withLetters.length >= 0.6,
    trailingKeys: keyLines >= 2 && keyLines / Math.max(1, withLetters.length) >= 0.3,
    numbered: numberedLines >= 3 && numberedLines / Math.max(1, withLetters.length) >= 0.5,
    event: eventScore >= 3,
    ocr: !!opts.ocr,
  }

  // Números "nus" só contam como numeração se encaixarem na sequência vizinha
  const numOf = (p: Prepped | undefined) => (p ? (p.explicitNum !== null && p.explicitNum >= 0 ? p.explicitNum : p.bareNum) : null)
  const nonEmpty = prepped.filter(p => p.line)
  const bareOk = new Set<Prepped>()
  nonEmpty.forEach((p, i) => {
    if (p.bareNum === null) return
    const prev = numOf(nonEmpty[i - 1])
    const next = numOf(nonEmpty[i + 1])
    if ((prev !== null && prev === p.bareNum - 1) || (next !== null && next === p.bareNum + 1)) bareOk.add(p)
  })

  // 2.ª passagem: entradas
  const entries: SetlistTextEntry[] = []
  const skipped: SkippedLine[] = []
  const meta: SetlistDocMeta = {}
  let section: string | undefined
  let ended = false
  const skip = (p: Prepped, reason: SkipReason, textOverride?: string) => {
    const t = (textOverride ?? p.line).replace(/\t+/g, ' ').trim()
    if (letterCount(t) >= 3) skipped.push({ order: p.order, raw: p.raw.trim(), text: t, reason })
  }
  for (const p of prepped) {
    if (!p.line) continue
    if (ended) { skip(p, 'end'); continue }
    let line = p.line
    let lineKey: string | undefined
    let lineDuration: number | undefined
    let fromColumns = false

    // Screenshot: "Músicas recomendadas" / "Baseado no que está nesta playlist" = fim da lista
    if (opts.ocr && entries.length > 0 && RE_END_OF_LIST.test(norm(stripDecor(line)))) {
      ended = true
      skip(p, 'end')
      continue
    }

    // "1º SET", "2 PARTE": o número faz parte do cabeçalho — testar antes de tirar a numeração
    const pre = keywordHeader(line)
    if (pre && pre.kind === 'header') { section = pre.label; continue }

    const num = stripNumbering(line, bareOk.has(p))
    line = num.line
    if (!line) continue

    // Prefixos "Encore: X", "Bis - X", "Medley: A / B"
    const enc = line.match(/^(encore|bis|extra)\s*[:\-–—]\s+(?=\S)/i)
    if (enc) { section = enc[1].toUpperCase(); line = line.slice(enc[0].length) }
    let forcedMedley = false
    const med = line.match(/^medley\s*[:\-–—]?\s+(?=\S)/i)
    if (med) { forcedMedley = true; line = line.slice(med[0].length) }
    line = line.replace(/\s*[([]\s*medley\s*[)\]]\s*$/i, () => { forcedMedley = true; return '' })

    // "Entrada da noiva: A Thousand Years – Christina Perri"
    let moment: string | undefined
    const mo = line.includes('\t') ? null : splitMoment(line, ctx.event)
    if (mo) { moment = mo.moment; line = mo.rest }

    // Barra de separadores da app ("Início\tPesquisar") — antes de juntar as colunas
    if (opts.ocr && line.includes('\t')) {
      const flat = classifyNonSong(line.replace(/\t+/g, ' '), num.had, ctx)
      if (flat && flat.kind === 'skip' && flat.reason === 'app') { skip(p, 'app'); continue }
    }

    if (line.includes('\t')) {
      const cells = fromCells(line)
      line = cells.line
      lineKey = cells.key
      lineDuration = cells.durationSec
      fromColumns = cells.textCells >= 2
      if (!line) continue
    }

    const cls = moment ? null : classifyNonSong(line, num.had, ctx)
    if (cls) {
      if (cls.kind === 'header') {
        section = cls.label.replace(/\s+/g, ' ')
        continue
      }
      if (cls.kind === 'title') {
        if (entries.length > 0) section = cls.label.replace(/\s+/g, ' ')
        else {
          meta.title ??= smartCase(stripDecor(p.line))
          skip(p, 'title')
        }
        continue
      }
      // Data e local do documento ("Quinta da Ribeira — 12 de Outubro de 2026", "Local: …", "@ …")
      if (cls.reason === 'date') {
        const n = norm(line)
        meta.date ??= parseDateText(n, today)
        meta.venue ??= venueFromDateLine(line)
      } else if (cls.reason === 'label') {
        const vl = stripDecor(line).match(RE_VENUE_LABEL)
        if (vl) meta.venue ??= smartCase(vl[1].trim())
        else if (/^@\s*\S/.test(line.trim())) meta.venue ??= smartCase(line.trim().replace(/^@\s*/, ''))
        const dl = norm(line)
        if (/^(?:data|dia)\s*:/.test(dl)) meta.date ??= parseDateText(dl, today)
      } else if (cls.reason === 'title' && entries.length === 0) {
        // "Setlist - Quinta da Ribeira" → "Quinta da Ribeira"
        const rest = stripDecor(line).replace(/^(?:setlist|set list|set-list|alinhamento(?: musical)?|repertório|repertorio|playlist|tracklist|programa(?: musical)?)\b\s*[-–—:·|]?\s*(?:(?:de|do|da)\s+)?/i, '').trim()
        if (/^\p{Lu}/u.test(rest) && letterCount(rest) >= 3) meta.title ??= rest
      }
      skip(p, cls.reason, line)
      continue
    }

    let parts = line.split(/\s+\/{1,2}\s+|\s+\+\s+|\s*\/\/\s*/).filter(s => s.trim())
    // "Medley: A, B, C"
    if (forcedMedley && parts.length === 1) parts = parts[0].split(/\s*,\s*/).filter(s => s.trim())
    const songs: ParsedSong[] = []
    for (const part of parts) {
      const song = buildSong(part, ctx, opts, num.had)
      if (song) songs.push(song)
    }
    if (songs.length === 0) continue
    if (songs.length === 1) {
      if (lineKey && !songs[0].key) songs[0].key = lineKey
      if (lineDuration && !songs[0].durationSec) songs[0].durationSec = lineDuration
    }
    const entry: SetlistTextEntry = { raw: p.raw.trim(), songs, order: p.order }
    if (section) entry.section = section
    if (moment) entry.moment = moment
    if (fromColumns) entry.fromColumns = true
    entries.push(entry)
  }

  // Músicas repetidas. Num screenshot, uma última linha repetida é o mini-player da app.
  const seen = new Set<string>()
  for (const e of entries) {
    const k = e.songs.map(s => matchKey(s.title)).join('/')
    if (seen.has(k)) e.repeat = true
    seen.add(k)
  }
  if (opts.image && entries.length > 2 && entries[entries.length - 1].repeat) {
    const last = entries.pop()!
    skipped.push({ order: last.order, raw: last.raw, text: last.songs.map(s => s.text).join(' / '), reason: 'repeat' })
  }
  skipped.sort((a, b) => a.order - b.order)

  // Leituras alternativas
  const suggest: SetlistParse['suggest'] = {}
  if (!opts.splitCommas && entries.length <= 2 && entries.some(e => (e.raw.match(/,/g) ?? []).length >= 2)) {
    const n = parseSetlist(text, { ...opts, splitCommas: true }).entries.length
    if (n > entries.length) suggest.commas = n
  }
  if (!opts.splitColumns && entries.filter(e => e.fromColumns).length >= 3) {
    const n = parseSetlist(text, { ...opts, splitColumns: true }).entries.length
    if (n > entries.length) suggest.columns = n
  }

  return { entries, skipped, meta, suggest }
}

/** Cabeçalho de secção ("SET 1", "ENCORE", "Setlist") — não serve de título do documento. */
export function isSectionHeader(line: string): boolean {
  return keywordHeader(prepLine(line))?.kind === 'header'
}

/**
 * Título lido (topo do PDF/imagem, nome de ficheiro) → nome de concerto: sem "Setlist -",
 * sem datas/horas soltas nas pontas; MAIÚSCULAS → capitalização normal. '' se não sobrar nada.
 */
export function tidyTitle(s: string): string {
  let t = prepLine(s).replace(/\t+/g, ' ')
  t = t.replace(/^(?:setlist|set list|set-list|alinhamento(?: musical)?|repert[óo]rio|playlist|tracklist|programa(?: musical)?)\b\s*[-–—:·|]?\s*/i, '')
  const parts = t.split(/\s+[—–|·•-]\s+|\s*[|·•]\s*/).map(p => p.trim()).filter(Boolean)
  const kept = parts.filter(p => !isDateLine(norm(p)))
  t = (kept.length ? kept : parts).join(' · ')
  t = stripDecor(t)
  return letterCount(t) >= 2 ? smartCase(t) : ''
}

/** Só as entradas (compatibilidade). */
export function parseSetlistText(text: string, opts: ParseOptions = {}): SetlistTextEntry[] {
  return parseSetlist(text, opts).entries
}

/**
 * Uma linha ignorada que o utilizador quer repor: vira música sem passar pelos filtros
 * de cabeçalhos/prosa (só a limpeza de números, tons e durações).
 */
export function forceEntry(text: string, order: number, opts: ParseOptions = {}): SetlistTextEntry | null {
  const line = prepLine(text.replace(/\t+/g, ' – '))
  const body = stripNumbering(line, true).line || line
  const ctx: Ctx = { mostlyUpper: false, trailingKeys: false, numbered: false, event: false, ocr: !!opts.ocr }
  const song = buildSong(body, ctx, opts, true)
  if (!song) return null
  return { raw: text.trim(), songs: [song], order }
}
