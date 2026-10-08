/**
 * Convites — tudo o que mexe em códigos de convite e convites por link.
 *
 * Usa os RPCs de supabase/migration_invites_v3.sql (validação no servidor).
 * Enquanto esse SQL não estiver aplicado (o RPC não existe: PGRST202 /
 * 42883 / "Could not find the function"), cai para o comportamento antigo,
 * com leituras/escritas diretas às tabelas — a app continua a funcionar.
 */
import { supabase } from './supabase'
import type {
  InviteRole,
  InviteStatus,
  ProjectCodePeek,
  ProjectInviteDetails,
  ProjectRole,
} from '../types'

const DAY_MS = 86400000

/** Validade de um código prolongado/gerado (igual ao SQL) */
export const CODE_VALID_DAYS = 30
/** Ao copiar/partilhar, prolonga antes se faltar menos do que isto */
export const CODE_REFRESH_DAYS = 3

export const INVITE_MESSAGES = {
  // Sugere PROLONGAR (mantém o código que já foi enviado ao resto da banda);
  // gerar um código novo invalida as cópias que os outros já têm.
  expiredCode: 'Este código expirou. Pede ao dono do projeto para o renovar — em Projeto › Membros › Prolongar (ou para te enviar um código novo).',
  invalidCode: 'Este código não existe ou foi substituído por um novo. Confirma-o ou pede o código atual a quem to enviou.',
  invalidLink: 'Este link de convite já não é válido — o código pode ter sido substituído por um novo. Pede o link atual a quem to enviou.',
  alreadyMember: 'Já és membro deste projeto.',
  rateLimited: 'Demasiadas tentativas com códigos errados — espera um pouco e tenta outra vez.',
  offline: 'Sem ligação — verifica a internet e tenta outra vez.',
  notAuthenticated: 'A tua sessão terminou. Entra outra vez e tenta de novo.',
  forbidden: 'Só o dono ou um admin podem renovar o código.',
  needsOwner: 'Para prolongar ou gerar um código novo, pede ao dono do projeto.',
  inviteInvalid: 'Convite inválido ou já utilizado.',
  inviteExpired: 'Este convite expirou. Pede um convite novo a quem te convidou.',
  inviteRevoked: 'Este convite foi revogado. Pede um convite novo a quem te convidou.',
  inviteAccepted: 'Este convite já foi aceite.',
  inviteForSomeoneElse: 'Este convite é para outra pessoa? Partilha o link — não o aceites.',
  inviteUnavailable: 'Não foi possível abrir este convite. Pede ao dono do projeto o código de convite (Projeto › Membros) e entra com ele.',
  linkInvitesUnavailable: 'Os convites por link ficam disponíveis depois da atualização da base de dados — por agora usa o código de convite abaixo.',
  invitesLoadFailed: 'Não foi possível carregar os convites pendentes.',
  roleNotSaved: 'O papel não foi alterado — esta opção só funciona depois da atualização da base de dados.',
  instrumentNotSaved: 'O instrumento não foi guardado — esta opção só funciona depois da atualização da base de dados.',
} as const

/* ── Formato do código ─────────────────────────────────────────────────── */

/** "jzbr 4829" → "JZBR4829" (só A-Z0-9, maiúsculas — igual a normalize_invite_code) */
export function bareInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Para os campos de texto: normaliza o que se escreve/cola e põe o hífen ("ABCD-1234") */
export function formatInviteCode(raw: string): string {
  const clean = bareInviteCode(raw).slice(0, 8)
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

/**
 * O código dentro do que se escreveu/colou, já formatado ("ABCD-1234"):
 * aceita o código solto (com espaços à volta), a mensagem partilhada pela app
 * (`Código de convite para "X": ABCD-1234 …`) e o link /join?code=…
 * (Sem lookbehind: o Safari antigo rejeita-o e partia o módulo todo.)
 */
export function extractInviteCode(raw: string): string {
  const text = raw.trim()
  // 1. Formato oficial em qualquer sítio do texto
  const strict = /(?:^|[^A-Za-z0-9])([A-Z]{4})-(\d{4})(?![0-9])/.exec(text)
  if (strict) return `${strict[1]}-${strict[2]}`
  // 2. Link de convite: ?code=…
  const param = /[?&]code=([^&#\s]+)/i.exec(text)
  if (param) {
    let value = param[1]
    try { value = decodeURIComponent(value) } catch { /* fica como está */ }
    return formatInviteCode(value)
  }
  // 3. 4 letras + 4 dígitos, em minúsculas ou com espaço no meio
  const loose = /(?:^|[^A-Za-z0-9])([A-Za-z]{4})[\s-]?(\d{4})(?![0-9])/.exec(text)
  if (loose) return `${loose[1].toUpperCase()}-${loose[2]}`
  // 4. A escrever: normaliza o que houver
  return formatInviteCode(text)
}

/** Código completo (8 caracteres) — pronto a espreitar/validar */
export function isCompleteInviteCode(raw: string): boolean {
  return bareInviteCode(raw).length === 8
}

/** Valores possíveis em bands.invite_code: formato atual "ABCD-1234" e antigo sem hífen */
function codeCandidates(raw: string): string[] {
  const bare = bareInviteCode(raw)
  const formatted = bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare
  return formatted === bare ? [bare] : [formatted, bare]
}

/** Mesmo formato de gen_band_invite_code (migration_bands.sql): 4 letras do nome + 4 dígitos */
function generateInviteCode(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X')
  const n = new Uint32Array(1)
  crypto.getRandomValues(n)
  return `${letters}-${String(n[0] % 10000).padStart(4, '0')}`
}

/** Token secreto de um convite por link (64 hex, como o default da tabela) */
export function newInviteToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function joinLink(code: string): string {
  return `${window.location.origin}/join?code=${encodeURIComponent(code)}`
}

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${encodeURIComponent(token)}`
}

/* ── Validade ──────────────────────────────────────────────────────────── */

/** "15 out" — e "15 out 27" quando não é o ano corrente. Maiúsculas via CSS. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso)
  const day = String(date.getDate()).padStart(2, '0')
  const month = date.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '').trim()
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return sameYear ? `${day} ${month}` : `${day} ${month} ${String(date.getFullYear()).slice(2)}`
}

export interface Validity {
  state: 'valid' | 'expiring' | 'expired' | 'unknown'
  /** "Válido até 15 out" · "Expira amanhã" · "Expirado" */
  label: string
  daysLeft: number | null
}

export function validityOf(expiresAt: string | null | undefined, now = Date.now()): Validity {
  if (!expiresAt) return { state: 'unknown', label: '', daysLeft: null }
  const ms = new Date(expiresAt).getTime() - now
  if (Number.isNaN(ms)) return { state: 'unknown', label: '', daysLeft: null }
  const daysLeft = ms / DAY_MS
  if (ms <= 0) return { state: 'expired', label: 'Expirado', daysLeft }
  if (daysLeft < CODE_REFRESH_DAYS) {
    const end = new Date(expiresAt)
    const today = new Date(now)
    const tomorrow = new Date(now + DAY_MS)
    const label = end.toDateString() === today.toDateString()
      ? 'Expira hoje'
      : end.toDateString() === tomorrow.toDateString()
        ? 'Expira amanhã'
        : `Expira a ${formatShortDate(expiresAt)}`
    return { state: 'expiring', label, daysLeft }
  }
  return { state: 'valid', label: `Válido até ${formatShortDate(expiresAt)}`, daysLeft }
}

/** Expirado ou a expirar em menos de CODE_REFRESH_DAYS → prolongar antes de partilhar */
export function needsRefresh(expiresAt: string | null | undefined): boolean {
  const v = validityOf(expiresAt)
  return v.state === 'expired' || v.state === 'expiring'
}

/** Ordem dos papéis (igual a project_role_rank no SQL) */
export function roleRank(role: string | null | undefined): number {
  return role === 'owner' ? 4 : role === 'admin' ? 3 : role === 'editor' ? 2 : role === 'viewer' ? 1 : 0
}

/* ── Erros / RPC disponível? ───────────────────────────────────────────── */

interface RpcError {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

/** O RPC não existe na base de dados (migration_invites_v3.sql ainda não aplicada) */
export function isMissingRpc(error: RpcError | null | undefined): boolean {
  if (!error) return false
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`
  return error.code === 'PGRST202'
    || error.code === '42883'
    || /could not find the function/i.test(text)
    || /function .+ does not exist/i.test(text)
}

/**
 * Falha de rede (sem resposta do servidor). O postgrest-js devolve
 * { message: 'TypeError: Failed to fetch', code: '' } com status 0
 * (Safari: "Load failed"; Firefox: "NetworkError when attempting…").
 */
export function isNetworkError(error: RpcError | null | undefined, status?: number): boolean {
  if (!error) return false
  if (status === 0) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return !error.code && /^(TypeError|FetchError|AbortError)\b|failed to fetch|load failed|networkerror|network request failed/i
    .test(error.message ?? '')
}

let rpcState: boolean | null = null

function noteRpc(error: RpcError | null | undefined) {
  if (!error) rpcState = true
  else if (isMissingRpc(error)) rpcState = false
}

/**
 * Sonda barata (peek com código vazio não devolve nada, não altera nada e
 * não conta como tentativa). Só serve para mostrar avisos com antecedência
 * — cada ação trata sozinha do fallback.
 */
export async function invitesRpcAvailable(): Promise<boolean> {
  if (rpcState !== null) return rpcState
  try {
    const { error } = await supabase.rpc('peek_project_code', { p_code: '' })
    noteRpc(error)
  } catch { /* sem rede: não decide */ }
  return rpcState ?? true
}

/** Chave estável do erro do RPC ("expired", "invalid_code"…) */
function errorKey(error: RpcError): string {
  return (error.message ?? '').trim()
}

export type ErrorReason = 'network' | 'not_authenticated' | 'rate_limited' | 'error'

/** Motivo genérico de um erro (rede, sessão, limite de tentativas, outro) */
function reasonOf(error: RpcError, status?: number): ErrorReason {
  if (isNetworkError(error, status)) return 'network'
  const key = errorKey(error)
  if (key === 'not_authenticated') return 'not_authenticated'
  if (key === 'rate_limited') return 'rate_limited'
  return 'error'
}

/** Texto para o utilizador: mensagens conhecidas, o hint em pt-PT do SQL, ou a mensagem crua */
function humanize(error: RpcError, status?: number, fallback = 'Algo correu mal. Tenta outra vez.'): string {
  switch (reasonOf(error, status)) {
    case 'network': return INVITE_MESSAGES.offline
    case 'not_authenticated': return INVITE_MESSAGES.notAuthenticated
    case 'rate_limited': return INVITE_MESSAGES.rateLimited
    default: return error.hint || error.message || fallback
  }
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null
  return (data as T) ?? null
}

/* ── Entrar com código ─────────────────────────────────────────────────── */

export type PeekResult =
  | { status: 'found'; project: ProjectCodePeek }
  | { status: 'not_found' }
  | { status: 'error'; reason: ErrorReason; message: string }

/** Espreita um código: nome/cor/tipo do projeto, se já expirou e se já sou membro (nunca outros membros) */
export async function peekProjectCode(raw: string, userId?: string): Promise<PeekResult> {
  const bare = bareInviteCode(extractInviteCode(raw))
  if (bare.length < 4) return { status: 'not_found' }

  const { data, error, status } = await supabase.rpc('peek_project_code', { p_code: bare })
  noteRpc(error)
  if (!error) {
    const row = firstRow<ProjectCodePeek>(data)
    return row ? { status: 'found', project: { ...row, is_member: !!row.is_member } } : { status: 'not_found' }
  }
  if (!isMissingRpc(error)) return { status: 'error', reason: reasonOf(error, status), message: humanize(error, status) }

  // Fallback (SQL antigo): qualquer autenticado lê bands
  const { data: band, error: e2, status: s2 } = await supabase
    .from('bands')
    .select('id, name, type, color, image_url, invite_expires_at')
    .in('invite_code', codeCandidates(bare))
    .limit(1)
    .maybeSingle()
  if (e2) return { status: 'error', reason: reasonOf(e2, s2), message: humanize(e2, s2) }
  if (!band) return { status: 'not_found' }
  let isMember = false
  if (userId) {
    const { data: me } = await supabase
      .from('band_members')
      .select('user_id')
      .eq('band_id', band.id)
      .eq('user_id', userId)
      .maybeSingle()
    isMember = !!me
  }
  return {
    status: 'found',
    project: {
      id: band.id,
      name: band.name,
      type: band.type ?? 'band',
      color: band.color ?? null,
      image_url: band.image_url ?? null,
      expired: validityOf(band.invite_expires_at).state === 'expired',
      is_member: isMember,
    },
  }
}

export type JoinResult =
  | { ok: true; projectId: string }
  | { ok: false; reason: 'already_member'; projectId: string; message: string }
  | { ok: false; reason: 'expired' | 'invalid_code' | ErrorReason; message: string }

/** Entra no projeto com o código (papel "editor"). */
export async function joinProjectWithCode(raw: string, userId: string): Promise<JoinResult> {
  const bare = bareInviteCode(extractInviteCode(raw))
  if (bare.length < 4) return { ok: false, reason: 'invalid_code', message: INVITE_MESSAGES.invalidCode }

  const { data, error, status } = await supabase.rpc('join_project_with_code', { p_code: bare })
  noteRpc(error)
  if (!error) {
    // NULL = o código não existe (o SQL não lança erro, para a tentativa ficar registada)
    if (data == null) return { ok: false, reason: 'invalid_code', message: INVITE_MESSAGES.invalidCode }
    return { ok: true, projectId: String(data) }
  }

  if (!isMissingRpc(error)) {
    switch (errorKey(error)) {
      case 'invalid_code':
        return { ok: false, reason: 'invalid_code', message: INVITE_MESSAGES.invalidCode }
      case 'expired':
        return { ok: false, reason: 'expired', message: INVITE_MESSAGES.expiredCode }
      case 'already_member':
        // O detail traz sempre o id do projeto (o peek já não o revela a quem não é membro)
        return { ok: false, reason: 'already_member', projectId: error.details ?? '', message: INVITE_MESSAGES.alreadyMember }
      default:
        return { ok: false, reason: reasonOf(error, status), message: humanize(error, status) }
    }
  }

  return legacyJoin(bare, userId)
}

/** Comportamento antigo (antes da v3): tudo no cliente */
async function legacyJoin(bare: string, userId: string): Promise<JoinResult> {
  const { data: band, error, status } = await supabase
    .from('bands')
    .select('id, invite_expires_at')
    .in('invite_code', codeCandidates(bare))
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, reason: reasonOf(error, status), message: humanize(error, status) }
  if (!band) return { ok: false, reason: 'invalid_code', message: INVITE_MESSAGES.invalidCode }

  // Já é membro? Entra — sem mexer no papel
  const { data: existing } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', band.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) return { ok: false, reason: 'already_member', projectId: band.id, message: INVITE_MESSAGES.alreadyMember }

  if (validityOf(band.invite_expires_at).state === 'expired') {
    return { ok: false, reason: 'expired', message: INVITE_MESSAGES.expiredCode }
  }

  const { error: joinErr, status: s2 } = await supabase
    .from('band_members')
    .insert({ band_id: band.id, user_id: userId, role: 'editor' })
  if (joinErr) {
    return isNetworkError(joinErr, s2)
      ? { ok: false, reason: 'network', message: INVITE_MESSAGES.offline }
      : { ok: false, reason: 'error', message: 'Erro ao entrar: ' + joinErr.message }
  }
  return { ok: true, projectId: band.id }
}

/* ── Gerir o código (dono/admin) ───────────────────────────────────────── */

export interface CodeProject {
  id: string
  name: string
  owner_id: string
  invite_code: string
  invite_expires_at?: string | null
}

export type CodeActionResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; reason: 'needs_owner' | 'forbidden' | ErrorReason; message: string }

function codeRpcError(error: RpcError, status?: number): CodeActionResult {
  if (errorKey(error) === 'forbidden') return { ok: false, reason: 'forbidden', message: INVITE_MESSAGES.forbidden }
  return { ok: false, reason: reasonOf(error, status), message: humanize(error, status) }
}

/** Mantém o código e dá-lhe mais 30 dias */
export async function extendProjectCode(project: CodeProject, userId: string): Promise<CodeActionResult> {
  const { data, error, status } = await supabase.rpc('extend_project_code', { p_band_id: project.id })
  noteRpc(error)
  if (!error) {
    const row = firstRow<{ code: string; expires_at: string }>(data)
    if (row) return { ok: true, code: row.code, expiresAt: row.expires_at }
    return { ok: false, reason: 'error', message: 'O servidor não devolveu o código.' }
  }
  if (!isMissingRpc(error)) return codeRpcError(error, status)

  // Fallback: a policy bands_update antiga só deixa o DONO alterar a banda
  if (project.owner_id !== userId) return { ok: false, reason: 'needs_owner', message: INVITE_MESSAGES.needsOwner }
  const target = Date.now() + CODE_VALID_DAYS * DAY_MS
  const current = project.invite_expires_at ? new Date(project.invite_expires_at).getTime() : 0
  const { data: band, error: e2, status: s2 } = await supabase
    .from('bands')
    .update({ invite_expires_at: new Date(Math.max(target, current)).toISOString() })
    .eq('id', project.id)
    .select('invite_code, invite_expires_at')
    .maybeSingle()
  if (e2) return { ok: false, reason: reasonOf(e2, s2), message: humanize(e2, s2) }
  if (!band) return { ok: false, reason: 'needs_owner', message: INVITE_MESSAGES.needsOwner }
  return { ok: true, code: band.invite_code, expiresAt: band.invite_expires_at }
}

/** Código novo (o antigo deixa de funcionar), válido 30 dias */
export async function regenerateProjectCode(project: CodeProject, userId: string): Promise<CodeActionResult> {
  const { data, error, status } = await supabase.rpc('regenerate_project_code', { p_band_id: project.id })
  noteRpc(error)
  if (!error) {
    const row = firstRow<{ code: string; expires_at: string }>(data)
    if (row) return { ok: true, code: row.code, expiresAt: row.expires_at }
    return { ok: false, reason: 'error', message: 'O servidor não devolveu o código.' }
  }
  if (!isMissingRpc(error)) return codeRpcError(error, status)

  if (project.owner_id !== userId) return { ok: false, reason: 'needs_owner', message: INVITE_MESSAGES.needsOwner }
  const expiresAt = new Date(Date.now() + CODE_VALID_DAYS * DAY_MS).toISOString()
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateInviteCode(project.name)
    if (code === project.invite_code) continue
    const { data: band, error: e2, status: s2 } = await supabase
      .from('bands')
      .update({ invite_code: code, invite_expires_at: expiresAt })
      .eq('id', project.id)
      .select('invite_code, invite_expires_at')
      .maybeSingle()
    if (e2?.code === '23505') continue  // código de outro projeto: tenta outro
    if (e2) return { ok: false, reason: reasonOf(e2, s2), message: humanize(e2, s2) }
    if (!band) return { ok: false, reason: 'needs_owner', message: INVITE_MESSAGES.needsOwner }
    return { ok: true, code: band.invite_code, expiresAt: band.invite_expires_at }
  }
  return { ok: false, reason: 'error', message: 'Não foi possível gerar um código novo. Tenta outra vez.' }
}

/**
 * Código e validade atuais no servidor (o código pode ter sido renovado
 * noutro dispositivo ou por um admin). null se não respondeu a tempo.
 */
export async function fetchProjectCode(projectId: string, timeoutMs = 2500): Promise<{ code: string; expiresAt: string | null } | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const { data, error } = await supabase
      .from('bands')
      .select('invite_code, invite_expires_at')
      .eq('id', projectId)
      .abortSignal(ctrl.signal)
      .maybeSingle()
    if (error || !data?.invite_code) return null
    return { code: data.invite_code, expiresAt: data.invite_expires_at ?? null }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ── Membros: papel e instrumento ──────────────────────────────────────── */

export type MemberUpdateResult = { ok: true } | { ok: false; message: string }

/** Muda o papel de outro membro (só dono/admin; nunca o dono). */
export async function setMemberRole(projectId: string, userId: string, role: InviteRole): Promise<MemberUpdateResult> {
  const { error, status } = await supabase.rpc('set_member_role', { p_band_id: projectId, p_user_id: userId, p_role: role })
  noteRpc(error)
  if (!error) return { ok: true }
  if (!isMissingRpc(error)) return { ok: false, message: humanize(error, status) }

  // Fallback (SQL antigo): sem policy de UPDATE em band_members o update
  // "passa" sem mudar nada — confirmar pelas linhas devolvidas
  const { data, error: e2, status: s2 } = await supabase
    .from('band_members')
    .update({ role })
    .eq('band_id', projectId)
    .eq('user_id', userId)
    .select('role')
  if (e2) return { ok: false, message: humanize(e2, s2) }
  if (!data?.length) return { ok: false, message: INVITE_MESSAGES.roleNotSaved }
  return { ok: true }
}

/** Guarda o instrumento do próprio membro (confirma que a linha mudou mesmo). */
export async function saveMyInstrument(projectId: string, userId: string, instrument: string | null): Promise<MemberUpdateResult> {
  const { data, error, status } = await supabase
    .from('band_members')
    .update({ instrument })
    .eq('band_id', projectId)
    .eq('user_id', userId)
    .select('instrument')
  if (error) return { ok: false, message: humanize(error, status) }
  if (!data?.length) return { ok: false, message: INVITE_MESSAGES.instrumentNotSaved }
  return { ok: true }
}

/* ── Convites por link (project_invites) ───────────────────────────────── */

export type InviteLookup =
  | { status: 'ok'; invite: ProjectInviteDetails }
  | { status: 'not_found' }
  | { status: 'error'; reason: ErrorReason; message: string }

interface InviteRpcRow {
  id: string
  project_id: string
  role: InviteRole
  status: InviteStatus
  expires_at: string
  expired: boolean
  already_member: boolean
  my_role?: ProjectRole | null
  project_name: string
  project_type: string
  project_color: string | null
  project_description: string | null
  project_image_url: string | null
  invited_by_name: string | null
}

export async function getProjectInvite(token: string): Promise<InviteLookup> {
  const { data, error, status } = await supabase.rpc('get_project_invite', { p_token: token })
  noteRpc(error)
  if (!error) {
    const r = firstRow<InviteRpcRow>(data)
    if (!r) return { status: 'not_found' }
    return {
      status: 'ok',
      invite: {
        id: r.id,
        project_id: r.project_id,
        role: r.role,
        status: r.status,
        expires_at: r.expires_at,
        expired: r.expired,
        already_member: r.already_member,
        my_role: r.my_role ?? null,
        invited_by_name: r.invited_by_name,
        project: {
          id: r.project_id,
          name: r.project_name,
          type: r.project_type,
          color: r.project_color,
          description: r.project_description,
          image_url: r.project_image_url,
        },
      },
    }
  }
  if (!isMissingRpc(error)) return { status: 'error', reason: reasonOf(error, status), message: humanize(error, status) }

  // Fallback (SQL antigo). Nota: a policy antiga consulta auth.users e falha
  // com "permission denied" — nesse caso explica o caminho alternativo.
  const { data: inv, error: e2, status: s2 } = await supabase
    .from('project_invites')
    .select('id, project_id, role, status, expires_at, bands(id, name, type, color, description, image_url)')
    .eq('token', token)
    .maybeSingle()
  if (e2) {
    return /permission denied/i.test(e2.message)
      ? { status: 'error', reason: 'error', message: INVITE_MESSAGES.inviteUnavailable }
      : { status: 'error', reason: reasonOf(e2, s2), message: humanize(e2, s2) }
  }
  const band = (inv as { bands?: unknown } | null)?.bands as ProjectInviteDetails['project'] | null | undefined
  if (!inv || !band) return { status: 'not_found' }
  return {
    status: 'ok',
    invite: {
      id: inv.id,
      project_id: inv.project_id,
      role: inv.role,
      status: inv.status,
      expires_at: inv.expires_at,
      expired: inv.status === 'expired' || (inv.status === 'pending' && validityOf(inv.expires_at).state === 'expired'),
      already_member: null,
      my_role: null,
      invited_by_name: null,
      project: {
        id: band.id,
        name: band.name,
        type: band.type ?? 'band',
        color: band.color ?? null,
        description: band.description ?? null,
        image_url: band.image_url ?? null,
      },
    },
  }
}

export type AcceptResult =
  | { ok: true; projectId: string }
  | { ok: false; reason: 'invalid_token' | 'expired' | 'revoked' | 'already_accepted' | ErrorReason; message: string }

/** Aceita o convite (o token chega — não exige que o email coincida). */
export async function acceptProjectInvite(token: string, invite: ProjectInviteDetails, userId: string): Promise<AcceptResult> {
  const { data, error, status } = await supabase.rpc('accept_project_invite', { p_token: token })
  noteRpc(error)
  if (!error) return { ok: true, projectId: String(data) }

  if (!isMissingRpc(error)) {
    switch (errorKey(error)) {
      case 'invalid_token': return { ok: false, reason: 'invalid_token', message: INVITE_MESSAGES.inviteInvalid }
      case 'expired': return { ok: false, reason: 'expired', message: INVITE_MESSAGES.inviteExpired }
      case 'revoked': return { ok: false, reason: 'revoked', message: INVITE_MESSAGES.inviteRevoked }
      case 'already_accepted': return { ok: false, reason: 'already_accepted', message: INVITE_MESSAGES.inviteAccepted }
      default: return { ok: false, reason: reasonOf(error, status), message: humanize(error, status) }
    }
  }

  // Fallback (SQL antigo): já membro → não mexe no papel (nunca baixa um admin)
  const { data: existing } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', invite.project_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!existing) {
    const { error: insertErr, status: s2 } = await supabase
      .from('band_members')
      .insert({ band_id: invite.project_id, user_id: userId, role: invite.role })
    if (insertErr) {
      return isNetworkError(insertErr, s2)
        ? { ok: false, reason: 'network', message: INVITE_MESSAGES.offline }
        : { ok: false, reason: 'error', message: 'Erro ao entrar no projeto: ' + insertErr.message }
    }
    // A policy antiga só deixa quem convidou atualizar — pode não ficar marcado (sem drama)
    await supabase.from('project_invites').update({ status: 'accepted' }).eq('id', invite.id)
  }
  return { ok: true, projectId: invite.project_id }
}

/* ── Convite pendente (sobrevive ao "criar conta → confirmar email") ──── */

const PENDING_KEY = 'gigio-pending-invite'
const PENDING_MAX_AGE_MS = 7 * DAY_MS

interface PendingInvite { kind: 'code' | 'token'; value: string; at: number }

/** Guarda o convite aberto sem sessão, para o retomar depois de entrar/criar conta */
export function savePendingInvite(kind: 'code' | 'token', value: string) {
  if (!value) return
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ kind, value, at: Date.now() } satisfies PendingInvite))
  } catch { /* modo privado / bloqueado */ }
}

export function clearPendingInvite() {
  try { localStorage.removeItem(PENDING_KEY) } catch { /* idem */ }
}

/**
 * Lê e apaga o convite pendente. Devolve o caminho a abrir
 * (/join?code=… ou /invite/…) se tiver menos de 7 dias.
 */
export function takePendingInvite(): string | null {
  let raw: string | null
  try { raw = localStorage.getItem(PENDING_KEY) } catch { return null }
  if (!raw) return null
  clearPendingInvite()
  try {
    const p = JSON.parse(raw) as Partial<PendingInvite>
    if (typeof p.value !== 'string' || !p.value || typeof p.at !== 'number') return null
    if (Date.now() - p.at > PENDING_MAX_AGE_MS) return null
    if (p.kind === 'code') return `/join?code=${encodeURIComponent(p.value)}`
    if (p.kind === 'token') return `/invite/${encodeURIComponent(p.value)}`
  } catch { /* lixo */ }
  return null
}

/* ── Área de transferência ─────────────────────────────────────────────── */

/**
 * Copia texto — também quando o texto só chega depois de um pedido à rede
 * (ex.: prolongar o código antes de copiar). Com uma Promise usa
 * ClipboardItem, que mantém o gesto do utilizador no Safari/iOS.
 */
export async function copyToClipboard(text: string | Promise<string>): Promise<boolean> {
  if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = text.then(t => new Blob([t], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return true
    } catch {
      /* cai para writeText abaixo */
    }
  }
  try {
    await navigator.clipboard.writeText(await text)
    return true
  } catch {
    return false
  }
}
