/**
 * Onde as anotações vivem: localStorage deste aparelho, POR UTILIZADOR
 * ('gigio_ann_u_<userId>_<songId>') e a cloud (song_annotations.strokes,
 * jsonb). Partilhado pelo Ensaio (AnnotationLayer), pelo concerto
 * (AnnotatedLyrics) e pelo ConcertPage (tecla "Anotações de ensaio").
 *
 * Antes eram só por música ('gigio_ann_v1_<songId>'): num iPad partilhado
 * pela banda, o membro seguinte via (e podia enviar para a conta dele) os
 * desenhos do anterior. As antigas passam para o 1.º utilizador que entra
 * depois de a app arrancar (adoptLegacyAnnotations) — quem as desenhou, na
 * prática: a sessão dele continua guardada quando a app atualiza.
 */
import { supabase } from '../supabase'
import { runQuery } from '../offline/net'
import { loadRehearsalFont } from '../rehearsalFont'
import { readPayload, type AnchoredStroke, type AnnPayload, type ParsedPayload } from './anchor'

const LEGACY_PREFIX = 'gigio_ann_v1_'
const userPrefix = (userId: string) => `gigio_ann_u_${userId}_`
/** Chave deste aparelho para a música (sem utilizador — só transitório: a antiga) */
export const ANN_STORAGE_KEY = (songId: string, userId?: string | null) =>
  userId ? `${userPrefix(userId)}${songId}` : `${LEGACY_PREFIX}${songId}`

/**
 * Cópia antiga (px) deste aparelho: quanto se espera pela cloud antes de a
 * migrar. Se a cloud tiver uma v2, é mais recente e ganha — migrar logo
 * mostrava por um instante os traços antigos (re-escalados por rácios pelo
 * cliente antigo) e montava a referência para nada. Rede lenta: passado
 * este tempo mostra-se a cópia daqui e a da cloud substitui-a quando chegar.
 */
export const LEGACY_PULL_WAIT_MS = 1500

/** Payload guardado neste dispositivo por este utilizador (qualquer versão), já lido — null se não há */
export function loadAnnotations(songId: string, userId?: string | null): ParsedPayload | null {
  try {
    const raw = localStorage.getItem(ANN_STORAGE_KEY(songId, userId))
    return raw ? readPayload(JSON.parse(raw)) : null
  } catch { return null }
}

let adopted = false
/**
 * As anotações antigas, só por música, passam a ser deste utilizador — uma
 * vez por arranque da app, para o 1.º utilizador com sessão. Se ele já tem
 * uma cópia sua dessa música, a antiga fica onde está (não se perde nem
 * passa por cima).
 */
export function adoptLegacyAnnotations(userId: string) {
  if (adopted || !userId) return
  adopted = true
  try {
    const legacy: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LEGACY_PREFIX)) legacy.push(k)
    }
    for (const k of legacy) {
      const target = ANN_STORAGE_KEY(k.slice(LEGACY_PREFIX.length), userId)
      if (localStorage.getItem(target) !== null) continue
      const v = localStorage.getItem(k)
      if (v === null) continue
      localStorage.setItem(target, v)
      localStorage.removeItem(k)
    }
  } catch { /* armazenamento bloqueado */ }
}

/**
 * Terminar sessão: apaga as cópias deste utilizador que já estão na cloud.
 * As por juntar (pend: desenhadas sem a conseguir ler) ficam — só dele, e
 * seguem para a cloud quando ele voltar a entrar.
 */
export function clearUserAnnotations(userId: string) {
  if (!userId) return
  try {
    const mine: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(userPrefix(userId))) mine.push(k)
    }
    for (const k of mine) {
      let pend = false
      try { pend = !!readPayload(JSON.parse(localStorage.getItem(k) ?? 'null'))?.pend } catch { /* estragada: sai */ }
      if (!pend) localStorage.removeItem(k)
    }
  } catch { /* */ }
}

/**
 * Lê a cópia da cloud. ok = false quando não foi possível ler (rede, erro):
 * não é o mesmo que "não há nada na cloud" — sem a ler, não se pode gravar
 * por cima dela.
 */
export async function fetchAnnotations(
  songId: string,
  userId: string,
): Promise<{ ok: boolean; payload: ParsedPayload | null }> {
  // Sem rede responde logo (não espera pelas retentativas nem pela renovação
  // da sessão); com rede, desiste ao fim de 15 s — é como uma falha de leitura
  const { data, error } = await runQuery(
    supabase
      .from('song_annotations')
      .select('strokes, updated_at')
      .eq('song_id', songId)
      .eq('user_id', userId)
      .maybeSingle(),
    15000,
  )
  if (error) return { ok: false, payload: null }
  const strokes = (data as { strokes?: unknown } | null)?.strokes
  return { ok: true, payload: strokes ? readPayload(strokes) : null }
}

export async function pullAnnotations(songId: string, userId: string): Promise<ParsedPayload | null> {
  return (await fetchAnnotations(songId, userId)).payload
}

export async function pushAnnotations(
  songId: string,
  userId: string,
  payload: AnnPayload,
  retry = true
) {
  try {
    const { error } = await supabase.from('song_annotations').upsert(
      { song_id: songId, user_id: userId, strokes: payload, updated_at: new Date().toISOString() },
      { onConflict: 'song_id,user_id' }
    )
    if (error) throw error
  } catch {
    // Rede fraca em palco: uma retentativa única após 2s em vez de falhar em silêncio
    if (retry) setTimeout(() => pushAnnotations(songId, userId, payload, false), 2000)
  }
}

/* Migrações de traços antigos já feitas nesta sessão (o concerto não grava:
   sem isto, cada abertura da vista de anotações voltava a montar e a medir a
   referência — ver LegacyReference) */
const legacyCache = new Map<string, AnchoredStroke[]>()
const LEGACY_CACHE_MAX = 24

/** Chave da migração de um payload antigo para uma letra (o tamanho guardado entra no desempate) */
export function legacyKey(p: ParsedPayload, lyrics: string): string {
  return JSON.stringify([p.w, p.h ?? 0, p.strokes, lyrics, loadRehearsalFont()])
}

/** Traços antigos já ancorados para esta chave nesta sessão (ver legacyKey) */
export function cachedLegacy(key: string): AnchoredStroke[] | null {
  return legacyCache.get(key) ?? null
}

export function rememberLegacy(key: string, strokes: AnchoredStroke[]) {
  if (legacyCache.size >= LEGACY_CACHE_MAX) {
    const first = legacyCache.keys().next()
    if (!first.done) legacyCache.delete(first.value)
  }
  legacyCache.set(key, strokes)
}
