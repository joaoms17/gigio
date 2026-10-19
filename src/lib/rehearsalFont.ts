/**
 * Tamanho da letra no modo Ensaio — A− / A+ na fita de ferramentas,
 * persistido globalmente (a preferência do músico vale para todas as músicas).
 *
 * Partilhado pelo Ensaio (SongPage) e pelo concerto (AnnotatedLyrics): as
 * anotações antigas, sem âncoras, foram desenhadas em px sobre a letra do
 * Ensaio, e o concerto reconstrói esse layout para as ancorar.
 */

export const REHEARSAL_FONT_KEY = 'gigio-rehearsal-font-size'
export const REHEARSAL_FONT_MIN = 22
export const REHEARSAL_FONT_MAX = 56
export const REHEARSAL_FONT_STEP = 4
export const REHEARSAL_FONT_DEFAULT = 32
/** Entrelinha da letra no Ensaio (o LyricsView recebe-a como lineHeight) */
export const REHEARSAL_LINE_HEIGHT = 1.6

/**
 * Anotações antigas sem altura guardada ({w, strokes}, clientes até ao #36):
 * o Ensaio ainda não tinha A−/A+ e a letra era sempre 32px — o h e o A±
 * entraram juntos (#38). O tamanho guardado agora não diz nada sobre elas.
 */
export const LEGACY_NO_H_FONT = 32
/**
 * Largura do bloco do Ensaio a partir da qual quem desenhou tinha (muito
 * provavelmente) as medidas de tablet nos rótulos de secção (ecrã ≥ 768px).
 * Só decide sozinha nos payloads sem h; com h, a altura escolhe.
 * No tempo dos payloads sem h (jun–set, até ao #37) havia a barra lateral de
 * 236px ao lado do Ensaio nos ecrãs largos e o painel tinha 20px de padding
 * de cada lado: iPad em retrato (810–834px) → bloco de 533–557px, paisagem
 * → 800px ou mais; telemóvel em retrato (≤ 430px, padding 16) → até 398px.
 * Com 714 (o ecrã menos o padding, sem a barra) o iPad em retrato contava
 * como telemóvel e os traços desciam ~4–8px por rótulo.
 * Ambíguo e por isso mal classificado: iPad mini em retrato (744px, sem a
 * barra antes do #35: bloco de 704px com medidas de telemóvel) e telemóvel
 * deitado sem a barra — sem h não há como os distinguir.
 */
export const LEGACY_TABLET_MIN_W = 470

export function clampRehearsalFont(v: number): number {
  return Math.min(REHEARSAL_FONT_MAX, Math.max(REHEARSAL_FONT_MIN, v))
}

export function loadRehearsalFont(): number {
  try {
    const v = parseInt(localStorage.getItem(REHEARSAL_FONT_KEY) ?? '', 10)
    if (Number.isFinite(v)) return clampRehearsalFont(v)
  } catch { /* storage bloqueado: fica o tamanho por omissão */ }
  return REHEARSAL_FONT_DEFAULT
}

export function saveRehearsalFont(v: number): void {
  try { localStorage.setItem(REHEARSAL_FONT_KEY, String(v)) } catch { /* sem storage: só nesta sessão */ }
}

/**
 * Tamanhos que o Ensaio pode ter tido, por ordem crescente, mais `current`
 * (o guardado agora — pode vir de uma versão com outro passo).
 * Não só 22, 26, …, 54: a partir dos 32 por omissão, A± chega a 24, 28, …,
 * 56, e depois de bater no mínimo (22) chega a 26, 30, …, 54 — ou seja, todos
 * os pares de 22 a 56.
 */
export function rehearsalFontCandidates(current = loadRehearsalFont()): number[] {
  const out: number[] = []
  for (let s = REHEARSAL_FONT_MIN; s <= REHEARSAL_FONT_MAX; s += REHEARSAL_FONT_STEP / 2) out.push(s)
  const c = clampRehearsalFont(current)
  if (out.indexOf(c) < 0) {
    out.push(c)
    out.sort((a, b) => a - b)
  }
  return out
}
