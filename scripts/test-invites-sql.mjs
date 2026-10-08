/**
 * Testa supabase/migration_invites_v3.sql A SÉRIO, numa Postgres em WASM
 * (@electric-sql/pglite), com stubs mínimos do Supabase:
 *   - papéis anon / authenticated / service_role e os privilégios por omissão
 *     do Supabase (GRANT ALL nas tabelas/funções de public);
 *   - schema auth: auth.users (SEM acesso para authenticated, como no
 *     Supabase), auth.uid() e auth.jwt() a ler os claims do pedido;
 *   - extensões uuid-ossp e pgcrypto no schema "extensions" + search_path
 *     igual ao do Supabase ("$user", public, extensions);
 *   - storage.buckets / storage.objects e a publicação supabase_realtime.
 *
 * Aplica schema.sql + as migrações existentes pela ordem, reproduz os bugs
 * ANTES da v3, aplica a v3 (duas vezes — tem de ser idempotente) e testa
 * como utilizadores diferentes (SET ROLE authenticated + claims do JWT),
 * incluindo os ataques da revisão: escalada a admin pelo UPDATE do convite,
 * força bruta do código, colisão normalizada de códigos, oráculo para anon,
 * e o papel/instrumento dos membros que não se gravava.
 *
 * Uso: node scripts/test-invites-sql.mjs
 */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const SQL_DIR = path.resolve(import.meta.dirname, '../supabase')
const EXISTING = [
  'schema.sql',
  'migration_bands.sql',
  'fix_rls_recursion.sql',
  'migration_v2.sql',
  'migration_project_images.sql',
]
const V3 = 'migration_invites_v3.sql'

// ── Stubs do Supabase ───────────────────────────────────────────────────────
const SUPABASE_STUBS = /* sql */ `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema extensions;
  create extension "uuid-ossp" with schema extensions;
  create extension pgcrypto with schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  -- (de propósito SEM grant: no Supabase "authenticated" não lê auth.users)

  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text,
    owner uuid
  );
  alter table storage.objects enable row level security;

  create publication supabase_realtime;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

// ── Mini harness ────────────────────────────────────────────────────────────
const results = []
let section = ''
function head(title) { section = title; console.log(`\n${title}`) }
async function test(name, fn) {
  try {
    await fn()
    results.push({ ok: true, name: `${section} › ${name}` })
    console.log(`  ok      ${name}`)
  } catch (e) {
    results.push({ ok: false, name: `${section} › ${name}`, e })
    console.log(`  FALHOU  ${name}\n          ${String(e?.message ?? e).split('\n').join('\n          ')}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`)
}
/** Espera que fn falhe; `match` (regex) é testado contra "message code". Devolve o erro. */
async function rejects(fn, match, msg = 'esperava um erro') {
  let err = null
  try { await fn() } catch (e) { err = e }
  if (!err) throw new Error(`${msg} — mas passou`)
  const text = `${err.message} ${err.code ?? ''}`
  if (match && !match.test(text)) throw new Error(`${msg} — erro inesperado: ${text}`)
  return err
}

// ── Base de dados ───────────────────────────────────────────────────────────
const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } })
await db.exec(SUPABASE_STUBS)
await db.exec(`set search_path = "$user", public, extensions`)

const rows = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await rows(sql, params))[0]

async function applyFile(file) {
  const sql = await readFile(path.join(SQL_DIR, file), 'utf8')
  await db.exec(sql)
}

/** Corre fn como um utilizador autenticado (claims do JWT + SET ROLE authenticated) */
async function as(user, fn) {
  const claims = JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' })
  await db.query(
    `select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
    [user.id, claims],
  )
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
/** Corre fn sem sessão (papel anon, sem claims) */
async function asAnon(fn) {
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)
  await db.exec('set role anon')
  try { return await fn() } finally { await db.exec('reset role') }
}

const uid = (n) => `00000000-0000-4000-8000-0000000000${n}`
const U = {
  ana:    { id: uid('0a'), email: 'ana@gigio.test',    name: 'Ana' },     // dona
  bruno:  { id: uid('0b'), email: 'bruno@gigio.test',  name: 'Bruno' },   // admin
  carla:  { id: uid('0c'), email: 'carla@gigio.test',  name: 'Carla' },   // editora
  duarte: { id: uid('0d'), email: 'duarte@gigio.test', name: 'Duarte' },  // de fora
  eva:    { id: uid('0e'), email: 'Eva@Gigio.test',    name: 'Eva' },     // convidada por email
  filipe: { id: uid('0f'), email: 'filipe@gigio.test', name: 'Filipe' },  // de fora
  gil:    { id: uid('10'), email: 'gil@gigio.test',    name: 'Gil' },     // de fora (atacante)
  hugo:   { id: uid('11'), email: 'hugo@gigio.test',   name: 'Hugo' },    // entra por código
  ines:   { id: uid('12'), email: 'ines@gigio.test',   name: 'Ines' },    // dona de outro projeto
  rui:    { id: uid('13'), email: 'rui@gigio.test',    name: 'Rui' },     // ex-membro
}

const DAY = 86400000
const daysFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / DAY
const CODE_RE = /^[A-Z]{4}-[0-9]{4}$/

// ── 1. Migrações existentes ────────────────────────────────────────────────
head('1. Migrações existentes (pela ordem)')
for (const file of EXISTING) {
  await test(`aplica ${file}`, () => applyFile(file))
}
if (results.some(r => !r.ok)) {
  console.log('\nAs migrações existentes não correram — impossível continuar.')
  process.exit(1)
}

for (const u of Object.values(U)) {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('display_name', $3::text))`,
    [u.id, u.email, u.name],
  )
}

// ── 2. Bugs ANTES da v3 (reprodução) ───────────────────────────────────────
head('2. Antes da v3 — reprodução dos bugs')

let band  // projeto "Os Tributos" da Ana
let inviteToken

await test('dona cria o projeto; o trigger fá-la membro "owner"', async () => {
  band = await as(U.ana, () => one(
    `insert into public.bands (name, owner_id) values ('Os Tributos', $1) returning id, invite_code, invite_expires_at, created_at`,
    [U.ana.id],
  ))
  assert(band?.id, 'sem id')
  assert(CODE_RE.test(band.invite_code), `código fora do formato: ${band.invite_code}`)
  const m = await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.ana.id])
  eq(m?.role, 'owner', 'papel da dona')
  await db.query(`insert into public.band_members (band_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'editor')`,
    [band.id, U.bruno.id, U.carla.id])
})

await test('bug 1: a validade conta 7 dias desde a CRIAÇÃO do projeto', async () => {
  const days = (new Date(band.invite_expires_at) - new Date(band.created_at)) / DAY
  assert(Math.abs(days - 7) < 0.01, `esperava 7 dias, obtido ${days}`)
  // Projeto com 10 dias → código expirado há 3, sem forma de renovar
  await db.query(
    `update public.bands set created_at = now() - interval '10 days', invite_expires_at = now() - interval '3 days' where id = $1`,
    [band.id],
  )
})

await test('dona cria convite por link para a Eva (sem RETURNING, como o cliente)', async () => {
  await as(U.ana, () => db.query(
    `insert into public.project_invites (project_id, email, role, invited_by) values ($1, 'eva@gigio.test', 'viewer', $2)`,
    [band.id, U.ana.id],
  ))
  inviteToken = (await one(`select token from public.project_invites where project_id = $1`, [band.id])).token
  assert(inviteToken?.length === 64, 'token')
})

await test('bug 2: a convidada não consegue ler o convite (permission denied em auth.users)', async () => {
  await rejects(
    () => as(U.eva, () => rows(`select * from public.project_invites where token = $1`, [inviteToken])),
    /permission denied for table users/,
  )
})

await test('bug 2b: …e a lista de convites pendentes da dona também falha', async () => {
  await rejects(
    () => as(U.ana, () => rows(`select * from public.project_invites where project_id = $1`, [band.id])),
    /permission denied for table users/,
  )
})

await test('bug 3: a convidada não consegue marcar o convite como aceite', async () => {
  try {
    await as(U.eva, () => db.query(`update public.project_invites set status = 'accepted' where token = $1`, [inviteToken]))
  } catch { /* também conta: falha */ }
  eq((await one(`select status from public.project_invites where token = $1`, [inviteToken])).status, 'pending', 'estado')
})

await test('bug 4: qualquer conta entra em qualquer projeto sem código', async () => {
  await as(U.duarte, () => db.query(
    `insert into public.band_members (band_id, user_id, role) values ($1, $2, 'editor')`, [band.id, U.duarte.id]))
  assert(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.duarte.id]), 'não entrou?')
  await db.query(`delete from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.duarte.id])
})

await test('bug 4b: qualquer conta lê o invite_code de qualquer banda', async () => {
  const r = await as(U.gil, () => rows(`select invite_code from public.bands where id = $1`, [band.id]))
  eq(r.length, 1, 'linhas visíveis')
})

let inesBand  // projeto da Ines, com o código da Ana SEM hífen (colisão normalizada)
await test('bug 5: a unique de invite_code compara o texto cru ("OSTR1234" ≠ "OSTR-1234")', async () => {
  inesBand = await as(U.ines, () => one(
    `insert into public.bands (name, owner_id) values ('Os Tributos Falsos', $1) returning id`, [U.ines.id]))
  const r = await as(U.ines, () => rows(
    `update public.bands set invite_code = $2, created_at = '2000-01-01' where id = $1 returning id`,
    [inesBand.id, band.invite_code.replace('-', '')]))
  eq(r.length, 1, 'o update passou')
})

await test('bug 6: mudar o papel de um membro não faz nada (sem policy de UPDATE em band_members)', async () => {
  const r = await as(U.ana, () => rows(
    `update public.band_members set role = 'viewer' where band_id = $1 and user_id = $2 returning role`, [band.id, U.carla.id]))
  eq(r.length, 0, 'linhas atualizadas')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.carla.id])).role,
    'editor', 'papel')
})

// ── 3. Aplicar a v3 ─────────────────────────────────────────────────────────
head('3. Aplicar migration_invites_v3.sql')

await test('aplica a v3', () => applyFile(V3))
await test('aplica a v3 outra vez (idempotente)', () => applyFile(V3))
if (results.some(r => !r.ok && r.name.startsWith('3.'))) {
  console.log('\nA v3 não correu — impossível continuar.')
  process.exit(1)
}

await test('códigos já expirados ficam válidos mais 30 dias (mesmo código)', async () => {
  const b = await one(`select invite_code, invite_expires_at from public.bands where id = $1`, [band.id])
  eq(b.invite_code, band.invite_code, 'código')
  const d = daysFromNow(b.invite_expires_at)
  assert(d > 29.9 && d <= 30.01, `validade em dias: ${d}`)
})

await test('colisões já existentes desfeitas: o código oficial fica com a Ana, a cópia sem hífen muda', async () => {
  const ines = await one(`select invite_code from public.bands where id = $1`, [inesBand.id])
  assert(CODE_RE.test(ines.invite_code), `código novo fora do formato: ${ines.invite_code}`)
  assert(ines.invite_code.replace('-', '') !== band.invite_code.replace('-', ''), 'continua a colidir')
  const idx = await one(`select indexdef from pg_indexes where indexname = 'bands_invite_code_norm_key'`)
  assert(/unique/i.test(idx?.indexdef ?? '') && /normalize_invite_code/.test(idx.indexdef), `índice: ${idx?.indexdef}`)
})

await test('projetos novos nascem com 30 dias de validade', async () => {
  const b = await as(U.filipe, () => one(
    `insert into public.bands (name, owner_id) values ('Duo Acústico', $1) returning id, invite_expires_at`, [U.filipe.id]))
  const d = daysFromNow(b.invite_expires_at)
  assert(d > 29.9 && d <= 30.01, `validade em dias: ${d}`)
  const m = await as(U.filipe, () => one(`select role from public.band_members where band_id = $1 and user_id = $2`, [b.id, U.filipe.id]))
  eq(m?.role, 'owner', 'o trigger continua a pôr o dono como membro')
})

await test('RPCs são SECURITY DEFINER com search_path = public', async () => {
  const fns = await rows(`
    select p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'peek_project_code','join_project_with_code','regenerate_project_code',
      'extend_project_code','get_project_invite','accept_project_invite','set_member_role')`)
  eq(fns.length, 7, 'número de RPCs')
  for (const f of fns) {
    assert(f.prosecdef, `${f.proname} não é SECURITY DEFINER`)
    assert((f.proconfig ?? []).includes('search_path=public'), `${f.proname} sem search_path=public`)
  }
})

// ── 4. Leitura e inserção direta (endurecimento) ───────────────────────────
head('4. RLS endurecida')

await test('não-membro NÃO lê a banda diretamente (nem o invite_code)', async () => {
  const r = await as(U.gil, () => rows(`select id, invite_code from public.bands where id = $1`, [band.id]))
  eq(r.length, 0, 'linhas visíveis')
})

await test('membro continua a ler a banda', async () => {
  const r = await as(U.carla, () => rows(`select id, invite_code from public.bands where id = $1`, [band.id]))
  eq(r.length, 1, 'linhas visíveis')
})

await test('utilizador sem código NÃO se insere em band_members diretamente', async () => {
  await rejects(
    () => as(U.duarte, () => db.query(
      `insert into public.band_members (band_id, user_id, role) values ($1, $2, 'editor')`, [band.id, U.duarte.id])),
    /row-level security|42501/,
  )
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.duarte.id])), 'entrou!')
})

await test('admin também NÃO insere terceiros diretamente', async () => {
  await rejects(
    () => as(U.bruno, () => db.query(
      `insert into public.band_members (band_id, user_id, role) values ($1, $2, 'admin')`, [band.id, U.gil.id])),
    /row-level security|42501/,
  )
})

await test('anon não pode chamar os RPCs', async () => {
  await rejects(() => asAnon(() => rows(`select * from public.peek_project_code('ABCD-1234')`)), /permission denied|42501/)
  await rejects(() => asAnon(() => rows(`select public.join_project_with_code('ABCD-1234')`)), /permission denied|42501/)
  await rejects(() => asAnon(() => rows(`select public.accept_project_invite($1)`, [inviteToken])), /permission denied|42501/)
  await rejects(() => asAnon(() => rows(`select public.set_member_role($1, $2, 'admin')`, [band.id, U.carla.id])), /permission denied|42501/)
})

await test('anon não executa as auxiliares (deixa de ser oráculo de quem gere que projeto)', async () => {
  const fns = ['is_band_manager(uuid,uuid)', 'is_band_member(uuid,uuid)', 'is_band_owner(uuid,uuid)',
    'normalize_invite_code(text)', 'project_role_rank(text)', 'invite_code_guard(uuid)', 'note_invite_code_failure(uuid,text)']
  for (const f of fns) {
    eq((await one(`select has_function_privilege('anon', 'public.${f}', 'execute') as x`)).x, false, `anon → ${f}`)
  }
  for (const f of fns.slice(0, 5)) {
    eq((await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as x`)).x, true, `authenticated → ${f}`)
  }
  for (const f of fns.slice(5)) {
    eq((await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as x`)).x, false, `authenticated → ${f}`)
  }
  await rejects(() => asAnon(() => one(`select public.is_band_manager($1, $2)`, [band.id, U.ana.id])), /permission denied|42501/)
})

await test('a tabela de tentativas não se lê nem escreve com sessão', async () => {
  await rejects(() => as(U.gil, () => rows(`select * from public.invite_code_attempts`)), /permission denied|42501/)
  await rejects(() => as(U.gil, () => db.query(`delete from public.invite_code_attempts`)), /permission denied|42501/)
})

await test('sem sub no JWT → not_authenticated', async () => {
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)
  await db.exec('set role authenticated')
  try {
    await rejects(() => rows(`select * from public.peek_project_code('ABCD-1234')`), /not_authenticated/)
  } finally { await db.exec('reset role') }
})

// ── 5. Código de convite ────────────────────────────────────────────────────
head('5. Código de convite (peek / join / regenerate / extend)')

let code = band.invite_code

await test('dono gera código novo: formato ABCD-1234, diferente, válido 30 dias', async () => {
  const r = await as(U.ana, () => one(`select * from public.regenerate_project_code($1)`, [band.id]))
  assert(CODE_RE.test(r.code), `formato: ${r.code}`)
  assert(r.code !== code, 'o código não mudou')
  const d = daysFromNow(r.expires_at)
  assert(d > 29.9 && d <= 30.01, `validade: ${d}`)
  const old = code
  code = r.code
  // o antigo deixa de funcionar (join devolve NULL = invalid_code, sem erro)
  const peek = await as(U.duarte, () => rows(`select * from public.peek_project_code($1)`, [old]))
  eq(peek.length, 0, 'código antigo ainda encontrado')
  eq((await as(U.duarte, () => one(`select public.join_project_with_code($1) as id`, [old]))).id, null, 'join do antigo')
})

await test('outro utilizador espreita: só metadados públicos, não expirado', async () => {
  const r = await as(U.duarte, () => db.query(`select * from public.peek_project_code($1)`, [code]))
  eq(r.rows.length, 1, 'linhas')
  eq(r.fields.map(f => f.name).join(','), 'id,name,type,color,image_url,expired,is_member', 'colunas devolvidas')
  eq(r.rows[0].id, band.id, 'id')
  eq(r.rows[0].name, 'Os Tributos', 'nome')
  eq(r.rows[0].expired, false, 'expired')
  eq(r.rows[0].is_member, false, 'is_member')
})

await test('gen_band_invite_code: mesmo formato, dígitos do gerador criptográfico (não random())', async () => {
  const src = (await one(`select prosrc from pg_proc where proname = 'gen_band_invite_code'`)).prosrc
  assert(!/random\s*\(\s*\)/.test(src), 'ainda usa random()')
  const r = await rows(`select public.gen_band_invite_code('Os Tributos') as c from generate_series(1, 300)`)
  assert(r.every(x => /^OSTR-[0-9]{4}$/.test(x.c)), `fora do formato: ${r.find(x => !/^OSTR-[0-9]{4}$/.test(x.c))?.c}`)
  assert(new Set(r.map(x => x.c)).size > 200, 'pouca variedade')
  eq((await one(`select public.gen_band_invite_code('Ó 1') as c`)).c.slice(0, 5), 'XXXX-', 'nome sem letras A-Z')
})

await test('peek normaliza: minúsculas, sem hífen, espaços', async () => {
  const bare = code.replace('-', '')
  for (const variant of [code.toLowerCase(), bare, ` ${bare.slice(0, 4)} ${bare.slice(4)} `, bare.toLowerCase()]) {
    const r = await as(U.duarte, () => rows(`select id from public.peek_project_code($1)`, [variant]))
    eq(r[0]?.id, band.id, `variante "${variant}"`)
  }
})

await test('peek com código vazio/desconhecido → nenhum resultado (sem erro)', async () => {
  eq((await as(U.duarte, () => rows(`select * from public.peek_project_code('')`))).length, 0, 'vazio')
  eq((await as(U.duarte, () => rows(`select * from public.peek_project_code(null)`))).length, 0, 'null')
  eq((await as(U.duarte, () => rows(`select * from public.peek_project_code('ZZZZ-0000')`))).length, 0, 'desconhecido')
})

await test('outro utilizador entra com código válido → editor', async () => {
  const r = await as(U.duarte, () => one(`select public.join_project_with_code($1) as id`, [code.toLowerCase().replace('-', '')]))
  eq(r.id, band.id, 'id devolvido')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.duarte.id]))?.role,
    'editor', 'papel')
  const vis = await as(U.duarte, () => rows(`select id from public.bands where id = $1`, [band.id]))
  eq(vis.length, 1, 'passa a ver a banda')
})

await test('já-membro → already_member com o id do projeto no detail (papel intacto)', async () => {
  const e = await rejects(() => as(U.bruno, () => one(`select public.join_project_with_code($1)`, [code])), /already_member/)
  eq(e.detail, band.id, 'detail')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.bruno.id])).role,
    'admin', 'papel do admin')
})

await test('código inválido → NULL (invalid_code, sem erro — a tentativa fica registada)', async () => {
  eq((await as(U.gil, () => one(`select public.join_project_with_code('QQQQ-9999') as id`))).id, null, 'desconhecido')
  eq((await as(U.gil, () => one(`select public.join_project_with_code('') as id`))).id, null, 'vazio')
  const n = await one(`select count(*)::int as n from public.invite_code_attempts where user_id = $1 and code = 'QQQQ9999'`, [U.gil.id])
  eq(n.n, 1, 'tentativa registada')
  const e = await one(`select count(*)::int as n from public.invite_code_attempts where user_id = $1 and code = ''`, [U.gil.id])
  eq(e.n, 0, 'vazio não conta como tentativa')
})

await test('código expirado é recusado; o peek NÃO dá o id do projeto a quem não é membro', async () => {
  await db.query(`update public.bands set invite_expires_at = now() - interval '1 day' where id = $1`, [band.id])
  const p = await as(U.gil, () => one(`select id, name, expired, is_member from public.peek_project_code($1)`, [code]))
  eq(p?.expired, true, 'peek.expired')
  eq(p?.id, null, 'peek.id (expirado, não-membro)')
  eq(p?.is_member, false, 'peek.is_member')
  eq(p?.name, 'Os Tributos', 'peek.name')
  await rejects(() => as(U.gil, () => one(`select public.join_project_with_code($1)`, [code])), /expired/)
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.gil.id])), 'entrou!')
})

await test('membro com código expirado: o peek diz is_member (com id) e o join → already_member', async () => {
  const p = await as(U.carla, () => one(`select id, expired, is_member from public.peek_project_code($1)`, [code]))
  eq(p?.is_member, true, 'peek.is_member')
  eq(p?.id, band.id, 'peek.id')
  eq(p?.expired, true, 'peek.expired')
  await rejects(() => as(U.carla, () => one(`select public.join_project_with_code($1)`, [code])), /already_member/)
})

await test('editor NÃO pode prolongar nem gerar código', async () => {
  await rejects(() => as(U.carla, () => one(`select * from public.extend_project_code($1)`, [band.id])), /forbidden/)
  await rejects(() => as(U.carla, () => one(`select * from public.regenerate_project_code($1)`, [band.id])), /forbidden/)
  await rejects(() => as(U.gil, () => one(`select * from public.regenerate_project_code($1)`, [band.id])), /forbidden/)
  eq((await one(`select invite_code from public.bands where id = $1`, [band.id])).invite_code, code, 'código mudou')
})

await test('editor NÃO renova por update direto a bands', async () => {
  await as(U.carla, () => db.query(`update public.bands set invite_expires_at = now() + interval '1 year' where id = $1`, [band.id]))
  const d = daysFromNow((await one(`select invite_expires_at from public.bands where id = $1`, [band.id])).invite_expires_at)
  assert(d < 0, 'a validade mudou')
})

await test('admin prolonga: mantém o código, válido 30 dias', async () => {
  const r = await as(U.bruno, () => one(`select * from public.extend_project_code($1)`, [band.id]))
  eq(r.code, code, 'código')
  const d = daysFromNow(r.expires_at)
  assert(d > 29.9 && d <= 30.01, `validade: ${d}`)
  // e o expirado volta a deixar entrar
  const j = await as(U.gil, () => one(`select public.join_project_with_code($1) as id`, [code]))
  eq(j.id, band.id, 'entrou depois de prolongar')
  await db.query(`delete from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.gil.id])
})

await test('admin consegue gerar código novo', async () => {
  const r = await as(U.bruno, () => one(`select * from public.regenerate_project_code($1)`, [band.id]))
  assert(CODE_RE.test(r.code) && r.code !== code, `código: ${r.code}`)
  code = r.code
})

await test('projeto inexistente → not_found', async () => {
  await rejects(() => as(U.ana, () => one(`select * from public.extend_project_code($1)`, [uid('99')])), /not_found/)
})

await test('dono continua a poder renovar por update direto (fallback do cliente)', async () => {
  const r = await as(U.ana, () => rows(
    `update public.bands set invite_expires_at = now() + interval '30 days' where id = $1 returning id`, [band.id]))
  eq(r.length, 1, 'linhas atualizadas')
  // …e gerar um código novo no formato oficial (fallback do cliente: generateInviteCode)
  const r2 = await as(U.ana, () => rows(
    `update public.bands set invite_code = 'OSTR-0001' where id = $1 returning invite_code`, [band.id]))
  eq(r2[0]?.invite_code, 'OSTR-0001', 'código')
  code = 'OSTR-0001'
})

// ── 5b. Sequestro do código por colisão (achado 3) ──────────────────────────
head('5b. Códigos únicos depois de normalizados')

await test('outro dono NÃO copia o código da Ana sem hífen / em minúsculas (formato oficial)', async () => {
  for (const variant of [code.replace('-', ''), code.toLowerCase(), ` ${code}`]) {
    await rejects(
      () => as(U.ines, () => db.query(`update public.bands set invite_code = $2 where id = $1`, [inesBand.id, variant])),
      /invalid_code_format|22023/, `variante "${variant}"`)
  }
})

await test('…nem igual (unique) — e o código da Ana continua a levar ao projeto da Ana', async () => {
  await rejects(
    () => as(U.ines, () => db.query(`update public.bands set invite_code = $2, created_at = '1990-01-01' where id = $1`, [inesBand.id, code])),
    /duplicate key|23505/)
  // mesmo que o índice não existisse, a unique crua apanhava este; o normalizado apanha o resto:
  await rejects(
    () => db.query(`update public.bands set invite_code = $2 where id = $1`, [inesBand.id, code.replace('-', '')]),
    /invalid_code_format|duplicate key/)
  const p = await as(U.hugo, () => one(`select id from public.peek_project_code($1)`, [code.replace('-', '').toLowerCase()]))
  eq(p?.id, band.id, 'peek leva ao projeto da Ana')
})

await test('projeto novo com o mesmo prefixo nunca recebe um código já usado', async () => {
  // força o gerador a colidir: só sobram códigos já ocupados para "OSTR"? Em vez disso,
  // pede um código explícito igual ao da Ana — o trigger troca-o por um livre
  const b = await as(U.ines, () => one(
    `insert into public.bands (name, owner_id, invite_code) values ('Os Tributos II', $1, $2) returning id, invite_code`,
    [U.ines.id, code]))
  assert(CODE_RE.test(b.invite_code) && b.invite_code !== code, `código: ${b.invite_code}`)
  await db.query(`delete from public.bands where id = $1`, [b.id])
})

await test('regenerar continua a funcionar depois das tentativas de colisão', async () => {
  const r = await as(U.ines, () => one(`select * from public.regenerate_project_code($1)`, [inesBand.id]))
  assert(CODE_RE.test(r.code), `código: ${r.code}`)
})

// ── 5c. Força bruta (achados 2 e 15) ────────────────────────────────────────
head('5c. Limite de tentativas com códigos errados')

const wrong = (n) => `ZZZZ-${String(n).padStart(4, '0')}`

await test('9 códigos errados distintos (peek/join) ainda passam; repetir o mesmo não conta', async () => {
  for (let i = 0; i < 9; i++) {
    const fn = i % 2 ? `select id from public.peek_project_code($1)` : `select public.join_project_with_code($1) as id`
    const r = await as(U.hugo, () => rows(fn, [wrong(i)]))
    assert(r.length === 0 || r[0].id === null, `código errado ${wrong(i)} encontrou algo`)
  }
  for (let i = 0; i < 5; i++) await as(U.hugo, () => rows(`select * from public.peek_project_code($1)`, [wrong(0)]))
  const p = await as(U.hugo, () => one(`select id from public.peek_project_code($1)`, [code]))
  eq(p?.id, band.id, 'código certo ainda funciona')
})

await test('10.º código errado → a partir daí rate_limited (mesmo com o código certo)', async () => {
  eq((await as(U.hugo, () => one(`select public.join_project_with_code($1) as id`, [wrong(9)]))).id, null, '10.º')
  await rejects(() => as(U.hugo, () => rows(`select * from public.peek_project_code($1)`, [code])), /rate_limited/)
  await rejects(() => as(U.hugo, () => one(`select public.join_project_with_code($1)`, [code])), /rate_limited/)
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.hugo.id])), 'entrou!')
})

await test('o limite é por conta: outro utilizador não é afetado', async () => {
  const p = await as(U.filipe, () => one(`select id from public.peek_project_code($1)`, [code]))
  eq(p?.id, band.id, 'peek do Filipe')
})

await test('passada uma hora, volta a poder tentar', async () => {
  await db.query(`update public.invite_code_attempts set at = now() - interval '61 minutes' where user_id = $1`, [U.hugo.id])
  const p = await as(U.hugo, () => one(`select id from public.peek_project_code($1)`, [code]))
  eq(p?.id, band.id, 'peek do Hugo')
  await db.query(`delete from public.invite_code_attempts where user_id = $1`, [U.hugo.id])
})

await test('força bruta de 10 000 códigos com o prefixo do nome fica bloqueada ao fim de 10', async () => {
  const found = await as(U.rui, () => db.exec(`
    do $$ declare i int; r record; begin
      for i in 0..9999 loop
        begin
          select * into r from public.peek_project_code('OSTR-' || lpad(i::text, 4, '0'));
        exception when others then
          perform set_config('t.stopped_at', i::text, false);
          exit;
        end;
      end loop;
    end $$;`))
  void found
  const at = Number((await one(`select current_setting('t.stopped_at', true) as v`)).v)
  assert(Number.isFinite(at) && at <= 11, `parou em ${at}`)
  await db.query(`delete from public.invite_code_attempts where user_id = $1`, [U.rui.id])
})

// ── 6. Convites por link ────────────────────────────────────────────────────
head('6. Convites por link (project_invites)')

async function newInvite(email, role, { by = U.ana, expires = null, status = null } = {}) {
  const r = await as(by, () => one(
    `insert into public.project_invites (project_id, email, role, invited_by) values ($1, $2, $3, $4) returning id, token`,
    [band.id, email, role, by.id],
  ))
  if (expires) await db.query(`update public.project_invites set expires_at = $2 where id = $1`, [r.id, expires])
  if (status) await db.query(`update public.project_invites set status = $2 where id = $1`, [r.id, status])
  return r
}

await test('dona cria e lista convites pendentes (com RETURNING)', async () => {
  const r = await newInvite('x@gigio.test', 'editor')
  assert(r.token?.length === 64, 'token')
  const list = await as(U.ana, () => rows(`select id, email from public.project_invites where project_id = $1 and status = 'pending'`, [band.id]))
  assert(list.length >= 2, `lista: ${list.length}`)
})

await test('admin lista convites; editor e estranhos não', async () => {
  eq((await as(U.bruno, () => rows(`select id from public.project_invites where project_id = $1`, [band.id]))).length >= 2, true, 'admin')
  eq((await as(U.carla, () => rows(`select id from public.project_invites where project_id = $1`, [band.id]))).length, 0, 'editora')
  eq((await as(U.gil, () => rows(`select id from public.project_invites where token = $1`, [inviteToken]))).length, 0, 'estranho')
})

await test('convidada lê o seu convite diretamente (email do JWT, sem permission denied)', async () => {
  const r = await as(U.eva, () => rows(`select id, status from public.project_invites where token = $1`, [inviteToken]))
  eq(r.length, 1, 'linhas (email com maiúsculas diferentes)')
})

await test('get_project_invite: dados do convite + projeto, sem emails nem token', async () => {
  const r = await as(U.filipe, () => db.query(`select * from public.get_project_invite($1)`, [inviteToken]))
  eq(r.rows.length, 1, 'linhas')
  const cols = r.fields.map(f => f.name)
  assert(!cols.some(c => /email|token/.test(c)), `expõe: ${cols.join(',')}`)
  const i = r.rows[0]
  eq(i.project_id, band.id, 'project_id')
  eq(i.project_name, 'Os Tributos', 'project_name')
  eq(i.role, 'viewer', 'role')
  eq(i.status, 'pending', 'status')
  eq(i.expired, false, 'expired')
  eq(i.already_member, false, 'already_member')
  eq(i.my_role, null, 'my_role')
  eq(i.invited_by_name, 'Ana', 'invited_by_name')
  const own = await as(U.bruno, () => one(`select already_member, my_role from public.get_project_invite($1)`, [inviteToken]))
  eq(own.already_member, true, 'admin: already_member')
  eq(own.my_role, 'admin', 'admin: my_role (só o de quem pergunta)')
})

await test('get_project_invite com token desconhecido → nenhum resultado', async () => {
  eq((await as(U.eva, () => rows(`select * from public.get_project_invite($1)`, ['f'.repeat(64)]))).length, 0, 'linhas')
  eq((await as(U.eva, () => rows(`select * from public.get_project_invite('')`))).length, 0, 'vazio')
})

await test('convidada aceita: entra com o papel do convite e o convite fica accepted', async () => {
  const r = await as(U.eva, () => one(`select public.accept_project_invite($1) as id`, [inviteToken]))
  eq(r.id, band.id, 'id devolvido')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.eva.id]))?.role,
    'viewer', 'papel')
  const inv = await one(`select status, accepted_by, accepted_at from public.project_invites where token = $1`, [inviteToken])
  eq(inv.status, 'accepted', 'status')
  eq(inv.accepted_by, U.eva.id, 'accepted_by')
  assert(inv.accepted_at, 'accepted_at')
})

await test('aceitar outra vez (mesma pessoa) é idempotente; outra pessoa → already_accepted', async () => {
  eq((await as(U.eva, () => one(`select public.accept_project_invite($1) as id`, [inviteToken]))).id, band.id, 'repetido')
  await rejects(() => as(U.gil, () => one(`select public.accept_project_invite($1)`, [inviteToken])), /already_accepted/)
  const i = await as(U.gil, () => one(`select status, already_member from public.get_project_invite($1)`, [inviteToken]))
  eq(i.status, 'accepted', 'get mostra accepted')
})

await test('não exige que o email coincida (o token chega)', async () => {
  const inv = await newInvite('outra.pessoa@gigio.test', 'editor')
  eq((await as(U.gil, () => one(`select public.accept_project_invite($1) as id`, [inv.token]))).id, band.id, 'id')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.gil.id]))?.role,
    'editor', 'papel')
})

await test('nunca baixa o papel: admin abre convite de viewer → continua admin e NÃO gasta o convite', async () => {
  const inv = await newInvite(U.bruno.email, 'viewer')
  eq((await as(U.bruno, () => one(`select public.accept_project_invite($1) as id`, [inv.token]))).id, band.id, 'id')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.bruno.id])).role,
    'admin', 'papel')
  eq((await one(`select status from public.project_invites where id = $1`, [inv.id])).status, 'pending', 'status')
})

await test('dono abre o próprio link para testar → convite continua pendente para o convidado', async () => {
  const inv = await newInvite('baterista@gigio.test', 'editor')
  eq((await as(U.ana, () => one(`select public.accept_project_invite($1) as id`, [inv.token]))).id, band.id, 'id (dono)')
  const after = await one(`select status, accepted_by from public.project_invites where id = $1`, [inv.id])
  eq(after.status, 'pending', 'status depois do dono')
  eq(after.accepted_by, null, 'accepted_by')
  // o convidado verdadeiro aceita
  eq((await as(U.hugo, () => one(`select public.accept_project_invite($1) as id`, [inv.token]))).id, band.id, 'id (convidado)')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.hugo.id]))?.role,
    'editor', 'papel do convidado')
  eq((await one(`select status from public.project_invites where id = $1`, [inv.id])).status, 'accepted', 'status')
})

await test('sobe o papel: editora aceita convite de admin → admin', async () => {
  const inv = await newInvite(U.carla.email, 'admin')
  await as(U.carla, () => one(`select public.accept_project_invite($1)`, [inv.token]))
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.carla.id])).role,
    'admin', 'papel')
})

await test('dono aceita convite do próprio projeto → continua owner (convite não é gasto)', async () => {
  const inv = await newInvite(U.ana.email, 'viewer')
  await as(U.ana, () => one(`select public.accept_project_invite($1)`, [inv.token]))
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.ana.id])).role,
    'owner', 'papel')
  eq((await one(`select status from public.project_invites where id = $1`, [inv.id])).status, 'pending', 'status')
})

await test('token expirado → expired (e fica pending)', async () => {
  const inv = await newInvite('tarde@gigio.test', 'editor', { expires: new Date(Date.now() - DAY).toISOString() })
  const g = await as(U.filipe, () => one(`select expired from public.get_project_invite($1)`, [inv.token]))
  eq(g.expired, true, 'get.expired')
  await rejects(() => as(U.filipe, () => one(`select public.accept_project_invite($1)`, [inv.token])), /expired/)
  eq((await one(`select status from public.project_invites where id = $1`, [inv.id])).status, 'pending', 'status')
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.filipe.id])), 'entrou!')
})

await test('token revogado → revoked', async () => {
  const inv = await newInvite('revogado@gigio.test', 'editor')
  await as(U.ana, () => db.query(`update public.project_invites set status = 'revoked' where id = $1`, [inv.id]))
  await rejects(() => as(U.filipe, () => one(`select public.accept_project_invite($1)`, [inv.token])), /revoked/)
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.filipe.id])), 'entrou!')
})

await test('token desconhecido → invalid_token', async () => {
  await rejects(() => as(U.filipe, () => one(`select public.accept_project_invite($1)`, ['0'.repeat(64)])), /invalid_token/)
  await rejects(() => as(U.filipe, () => one(`select public.accept_project_invite('')`)), /invalid_token/)
})

await test('convidado não muda o próprio convite por update direto', async () => {
  const inv = await newInvite(U.filipe.email, 'admin')
  try {
    await as(U.filipe, () => db.query(`update public.project_invites set status = 'accepted' where id = $1`, [inv.id]))
  } catch { /* também conta: falha */ }
  await rejects(
    () => as(U.filipe, () => db.query(`update public.project_invites set role = 'admin', status = 'accepted' where id = $1`, [inv.id])),
    /permission denied|42501/)
  eq((await one(`select status from public.project_invites where id = $1`, [inv.id])).status, 'pending', 'status')
})

// ── 7. Escalada pelo UPDATE do convite (achado 1) ──────────────────────────
head('7. Convites: só quem gere o projeto cria/altera, e só o estado')

// Estado aqui: Ana dona · Bruno e Carla admins · Duarte, Gil e Hugo editores ·
// Eva viewer · Ines (dona do próprio projeto), Rui e Filipe de fora
await test('estranho NÃO muda o project_id do próprio convite para um projeto alheio', async () => {
  const inv = await as(U.ines, () => one(
    `insert into public.project_invites (project_id, email, role, invited_by) values ($1, 'ines@gigio.test', 'admin', $2) returning id, token`,
    [inesBand.id, U.ines.id]))
  // inserir diretamente no projeto da Ana: recusado
  await rejects(() => as(U.ines, () => db.query(
    `insert into public.project_invites (project_id, email, role, invited_by) values ($1, 'ines@gigio.test', 'admin', $2)`,
    [band.id, U.ines.id])), /row-level security|42501/)
  // mudar o project_id do próprio convite: recusado (só o estado é alterável)
  await rejects(() => as(U.ines, () => db.query(
    `update public.project_invites set project_id = $1 where id = $2`, [band.id, inv.id])), /permission denied|row-level security|42501/)
  eq((await one(`select project_id from public.project_invites where id = $1`, [inv.id])).project_id, inesBand.id, 'project_id')
  // o convite do próprio projeto continua a funcionar (é a dona → não gasta, devolve o projeto dela)
  eq((await as(U.ines, () => one(`select public.accept_project_invite($1) as id`, [inv.token]))).id, inesBand.id, 'accept no próprio')
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.ines.id])), 'entrou na Ana!')
})

await test('editor NÃO sobe a admin pelo mesmo truque; ex-membro também não volta', async () => {
  // o Rui foi membro e a dona removeu-o
  await db.query(`insert into public.band_members (band_id, user_id, role) values ($1, $2, 'editor')`, [band.id, U.rui.id])
  await as(U.ana, () => db.query(`delete from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.rui.id]))
  for (const u of [U.hugo, U.rui]) {
    const own = await as(u, () => one(`insert into public.bands (name, owner_id) values ($2, $1) returning id`, [u.id, `Projeto ${u.name}`]))
    const inv = await as(u, () => one(
      `insert into public.project_invites (project_id, email, role, invited_by) values ($1, 'x@gigio.test', 'admin', $2) returning id`,
      [own.id, u.id]))
    await rejects(() => as(u, () => db.query(`update public.project_invites set project_id = $1 where id = $2`, [band.id, inv.id])),
      /permission denied|row-level security|42501/, u.name)
  }
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.hugo.id])).role,
    'editor', 'papel do Hugo')
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.rui.id])), 'o Rui voltou!')
})

await test('convite adulterado antes desta correção (project_id trocado) → invalid_token, e o ecrã não o mostra', async () => {
  const inv = await as(U.ines, () => one(
    `insert into public.project_invites (project_id, email, role, invited_by) values ($1, 'ines@gigio.test', 'admin', $2) returning id, token`,
    [inesBand.id, U.ines.id]))
  await db.query(`update public.project_invites set project_id = $1 where id = $2`, [band.id, inv.id])  // como superuser
  eq((await as(U.ines, () => rows(`select * from public.get_project_invite($1)`, [inv.token]))).length, 0, 'get_project_invite')
  await rejects(() => as(U.ines, () => one(`select public.accept_project_invite($1)`, [inv.token])), /invalid_token/)
  assert(!(await one(`select 1 from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.ines.id])), 'entrou!')
})

await test('dono e admin revogam convites; editor e estranhos não', async () => {
  const a = await newInvite('rev1@gigio.test', 'editor')
  const b = await newInvite('rev2@gigio.test', 'editor', { by: U.bruno })
  eq((await as(U.duarte, () => rows(`update public.project_invites set status = 'revoked' where id = $1 returning id`, [a.id]))).length, 0, 'editor')
  eq((await as(U.ines, () => rows(`update public.project_invites set status = 'revoked' where id = $1 returning id`, [a.id]))).length, 0, 'estranha')
  eq((await as(U.duarte, () => rows(`delete from public.project_invites where id = $1 returning id`, [a.id]))).length, 0, 'editor apaga')
  eq((await as(U.bruno, () => rows(`update public.project_invites set status = 'revoked' where id = $1 returning id`, [a.id]))).length, 1, 'admin')
  eq((await as(U.ana, () => rows(`update public.project_invites set status = 'revoked' where id = $1 returning id`, [b.id]))).length, 1, 'dona')
  // nem quem gere muda o papel/token de um convite já enviado
  await rejects(() => as(U.ana, () => db.query(`update public.project_invites set role = 'admin' where id = $1`, [b.id])), /permission denied|42501/)
  await rejects(() => as(U.ana, () => db.query(`update public.project_invites set token = 'x' where id = $1`, [b.id])), /permission denied|42501/)
})

await test('convite de um admin que entretanto deixou de o ser deixa de valer', async () => {
  const inv = await newInvite('novo@gigio.test', 'admin', { by: U.bruno })
  await as(U.ana, () => one(`select public.set_member_role($1, $2, 'editor')`, [band.id, U.bruno.id]))
  eq((await as(U.filipe, () => rows(`select * from public.get_project_invite($1)`, [inv.token]))).length, 0, 'get')
  await rejects(() => as(U.filipe, () => one(`select public.accept_project_invite($1)`, [inv.token])), /invalid_token/)
  await as(U.ana, () => one(`select public.set_member_role($1, $2, 'admin')`, [band.id, U.bruno.id]))
  eq((await as(U.filipe, () => one(`select public.accept_project_invite($1) as id`, [inv.token]))).id, band.id, 'volta a valer')
  await db.query(`delete from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.filipe.id])
})

// ── 8. Papel e instrumento dos membros (achado 6) ──────────────────────────
head('8. Membros: papel (set_member_role) e instrumento')

await test('dono muda o papel; admin também; editor e estranhos não', async () => {
  eq((await as(U.ana, () => one(`select public.set_member_role($1, $2, 'viewer') as r`, [band.id, U.hugo.id]))).r, 'viewer', 'dona')
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.hugo.id])).role, 'viewer', 'papel')
  await as(U.bruno, () => one(`select public.set_member_role($1, $2, 'editor')`, [band.id, U.hugo.id]))
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.hugo.id])).role, 'editor', 'admin')
  await rejects(() => as(U.duarte, () => one(`select public.set_member_role($1, $2, 'viewer')`, [band.id, U.hugo.id])), /forbidden/)
  await rejects(() => as(U.ines, () => one(`select public.set_member_role($1, $2, 'viewer')`, [band.id, U.hugo.id])), /forbidden/)
})

await test('nunca mexe no dono, nunca promove a dono, ninguém muda o próprio papel', async () => {
  await rejects(() => as(U.bruno, () => one(`select public.set_member_role($1, $2, 'viewer')`, [band.id, U.ana.id])), /forbidden/)
  await rejects(() => as(U.ana, () => one(`select public.set_member_role($1, $2, 'owner')`, [band.id, U.hugo.id])), /invalid_role/)
  await rejects(() => as(U.bruno, () => one(`select public.set_member_role($1, $2, 'viewer')`, [band.id, U.bruno.id])), /forbidden/)
  await rejects(() => as(U.ana, () => one(`select public.set_member_role($1, $2, 'viewer')`, [band.id, U.ines.id])), /not_found/)
  eq((await one(`select role from public.band_members where band_id = $1 and user_id = $2`, [band.id, U.ana.id])).role, 'owner', 'dona')
})

await test('update direto do papel dá erro (já não "passa" sem fazer nada)', async () => {
  await rejects(() => as(U.ana, () => db.query(
    `update public.band_members set role = 'admin' where band_id = $1 and user_id = $2`, [band.id, U.hugo.id])), /permission denied|42501/)
})

await test('cada membro muda o PRÓPRIO instrumento; o dos outros não', async () => {
  const r = await as(U.carla, () => rows(
    `update public.band_members set instrument = 'Baixo' where band_id = $1 and user_id = $2 returning instrument`, [band.id, U.carla.id]))
  eq(r[0]?.instrument, 'Baixo', 'próprio')
  const r2 = await as(U.carla, () => rows(
    `update public.band_members set instrument = 'Kazoo' where band_id = $1 and user_id = $2 returning instrument`, [band.id, U.hugo.id]))
  eq(r2.length, 0, 'de outro membro')
})

// ── Resumo ──────────────────────────────────────────────────────────────────
await db.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
if (failed.length) {
  console.log('\nFalharam:')
  for (const f of failed) console.log(`  - ${f.name}`)
  process.exit(1)
}
