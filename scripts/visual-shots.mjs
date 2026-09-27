/**
 * Testes visuais: serve o build com Supabase interceptado (fixtures) e tira
 * screenshots das páginas principais em vários viewports/temas.
 *
 * Uso:
 *   VITE_SUPABASE_URL=https://mockproj.supabase.co VITE_SUPABASE_ANON_KEY=mock npm run build
 *   node scripts/visual-shots.mjs [pasta-destino]
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const DIST = path.resolve(import.meta.dirname, '../dist')
const OUT = process.argv[2] ?? path.resolve(import.meta.dirname, '../shots')
const PORT = 4199

// ── Fixtures ────────────────────────────────────────────────────────────────
const USER = {
  id: 'u1', aud: 'authenticated', email: 'joao@teste.pt', role: 'authenticated',
  app_metadata: {}, user_metadata: { display_name: 'João Silva' },
  created_at: '2026-01-01T00:00:00Z',
}
const SESSION = {
  access_token: 'mock-token', token_type: 'bearer', refresh_token: 'mock-refresh',
  expires_in: 31536000, expires_at: Math.floor(Date.now() / 1000) + 31536000, user: USER,
}

const d = (days) => new Date(Date.now() + days * 86400000).toISOString().split('T')[0]

const SONGS = [
  ['sg1', 'Englishman in New York', 'Sting', 242, false, 'Em'],
  ['sg2', 'Smooth Operator', 'Sade', 256, true, null],
  ['sg3', "Isn't She Lovely", 'Stevie Wonder', 200, true, null],
  ['sg4', "Don't Know Why", 'Norah Jones', 184, true, null],
  ['sg5', "Ain't No Sunshine", 'Bill Withers', 119, true, null],
  ['sg6', 'Stand by Me', 'Stand by Me - Movie Soundtrack', 175, true, null],
  ['sg7', 'Killing Me Softly With His Song', 'Fugees', 254, true, 'G'],
  ['sg8', "If I Ain't Got You", 'Alicia Keys', 210, true, null],
  ['sg9', 'Kiss', 'Prince', 227, true, null],
  ['sg10', 'Valerie', 'Amy Winehouse', 190, true, null],
  ['sg11', 'Sozinho', 'Caetano Veloso', 201, false, 'Am'],
  ['sg12', 'A Minha Casinha', 'Xutos & Pontapés', 178, true, null],
].map(([id, title, artist, duration_sec, has_sync, performance_key]) => ({
  id, title, artist, duration_sec, has_sync, performance_key,
  original_key: performance_key, lyrics: SAMPLE_LYRICS(title), edited_lyrics: null,
  chords: null, bpm: id === 'sg2' ? 104 : null, capo: null, tuning: null, tags: null,
  notes: null, is_user_edited: false, source: 'lrclib', owner_id: 'u1', project_id: 'b1',
  original_lyrics: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', updated_by: 'u1',
}))

function SAMPLE_LYRICS(title) {
  return `[Verso 1]\nI don't drink coffee, I take tea, my dear\nI like my toast done on one side\nAnd you can hear it in my accent when I talk\nI'm an Englishman in New York\n\n[Refrão]\nOh, I'm an alien, I'm a legal alien\nI'm an Englishman in New York\nOh, I'm an alien, I'm a legal alien\nI'm an Englishman in New York\n\n[Verso 2]\nSee me walking down Fifth Avenue\nA walking cane here at my side\n(${title})`
}

const BAND = { id: 'b1', name: 'Casamentos', color: '#7C3AED', image_url: null, owner_id: 'u1', invite_code: 'ABCD1234', created_at: '2026-01-01T00:00:00Z', member_count: 3, type: 'band' }

// Estados pela data: HOJE (s4), AMANHÃ (s1), EM N DIAS / SEM (s2, s3), pessoal futuro (s7)
// e dois REALIZADOS (s5, s6). O s1 continua a ser o concerto das outras capturas.
const SETLISTS = [
  { id: 's1', name: 'Jantar', date: d(1), venue: 'Antes Perdida por Aqui Algures', status: 'preparing' },
  { id: 's2', name: 'Festa da Vila', date: d(7), venue: 'Largo do Rossio', status: 'draft' },
  { id: 's3', name: 'Bar do Cais — acústico', date: d(14), venue: 'Cascais', status: 'final' },
  { id: 's4', name: 'Ensaio geral', date: d(0), venue: 'Estúdio 2', status: 'draft' },
  { id: 's5', name: 'Aniversário do Rui', date: d(-12), venue: 'Quinta do Lago', status: 'final' },
  { id: 's6', name: 'Festa de Natal', date: d(-40), venue: 'Clube Recreativo', status: 'draft' },
  // Pessoal (sem projeto)
  { id: 's7', name: 'Jam de sexta', date: d(30), venue: 'Sabotage Club', status: 'draft', band_id: null, is_shared: false, band: null, bands: null },
].map(s => ({
  owner_id: 'u1', band_id: 'b1', is_shared: true, created_at: '2026-01-01T00:00:00Z',
  band: { name: BAND.name, color: BAND.color },
  bands: { name: BAND.name, image_url: null, color: BAND.color, owner_id: 'u1' },
  setlist_songs: [{ count: s.id === 's1' ? SONGS.length : 8 }],
  ...s,
}))

const SETLIST_SONGS = SONGS.map((song, i) => ({
  id: `ss${i + 1}`, setlist_id: 's1', song_id: song.id, position: i,
  performance_key: i === 6 ? 'G' : null,
  notes: i === 2 ? 'Entrar logo a seguir ao discurso' : null,
  custom_intro: i === 6 ? '4 compassos só bateria' : null, custom_ending: null,
  song, setlist: { name: 'Jantar', date: d(1), venue: 'Quinta da Ribeira' },
}))

const LYRIC_SYNCS = [{ song_id: 'sg2', lines: SAMPLE_LYRICS('Smooth Operator').split('\n').map((text, i) => ({ text, time_ms: i * 4000 })) }]

const TABLES = {
  bands: [BAND],
  band_members: [{ band_id: 'b1', user_id: 'u1', role: 'owner', instrument: 'Voz', bands: BAND, profiles: { display_name: 'João Silva', email: 'joao@teste.pt' } }],
  band_invites: [],
  setlists: SETLISTS,
  setlist_songs: SETLIST_SONGS,
  songs: SONGS,
  lyric_syncs: LYRIC_SYNCS,
  profiles: [{ id: 'u1', display_name: 'João Silva', email: 'joao@teste.pt' }],
  concert_sessions: [],
  annotations: [],
}

// ── Servidor estático do dist ───────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' }
const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(DIST, urlPath)
  if (!existsSync(file) || urlPath === '/') file = path.join(DIST, 'index.html')
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end() }
})

// ── Interceção Supabase ─────────────────────────────────────────────────────
function restResponse(route) {
  const req = route.request()
  const url = new URL(req.url())
  const table = url.pathname.split('/rest/v1/')[1]?.split('/')[0]
  const rows = TABLES[table] ?? []
  const accept = req.headers()['accept'] ?? ''
  const wantsObject = accept.includes('vnd.pgrst.object')
  const method = req.method()

  if (method === 'HEAD' || req.headers()['prefer']?.includes('count=exact')) {
    return route.fulfill({ status: 200, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` }, contentType: 'application/json', body: wantsObject ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows) })
  }
  if (method === 'POST' || method === 'PATCH') {
    const body = req.postData() ? JSON.parse(req.postData()) : {}
    const echo = Array.isArray(body) ? body : { id: `new-${Math.random().toString(36).slice(2, 8)}`, ...body }
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(wantsObject ? echo : [echo]) })
  }
  if (method === 'DELETE') return route.fulfill({ status: 204, body: '' })

  // filtros básicos: id=eq.X / setlist_id=eq.X / song_id=eq.X
  let out = rows
  for (const [key, val] of url.searchParams) {
    const m = /^eq\.(.*)$/.exec(val)
    if (m && key !== 'select' && key !== 'order') out = out.filter(r => String(r[key]) === m[1])
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wantsObject ? (out[0] ?? null) : out) })
}

// Rascunho do "Novo concerto" (sessionStorage): revisão de uma lista importada com linha
// aproximada ("A CONFIRMAR"), momento de evento, repetida, secção ("SET 2") e uma linha de conversa ignorada
const idleSearch = { state: 'idle', query: '', results: [] }
const draftRow = (id, order, title, extra = {}) => ({ id, raw: title, title, artist: '', choice: null, search: idleSearch, order, ...extra })
const NEW_CONCERT_DRAFT = {
  v: 1, userId: 'u1', savedAt: Date.now() - 5 * 60000, mode: 'import', projectSet: false, project: null,
  nameDraft: null, date: d(12), venue: 'Quinta da Ribeira',
  file: {
    rows: [
      draftRow('d1', 1, 'A Thousand Years', { artist: 'Christina Perri', note: 'Entrada da noiva' }),
      draftRow('d2', 2, 'ENGLISHMAN', { raw: '2. ENGLISHMAN (Em)', key: 'Em' }),
      draftRow('d3', 4, 'Valerie'),
      // Cabeçalho lido ("SET 2") → divisória mono na revisão
      draftRow('d4', 5, 'Kiss', { section: 'SET 2' }),
      draftRow('d5', 6, 'Valerie', { section: 'SET 2' }),
    ],
    source: { kind: 'text', name: 'Casamento Ana & Rui', meta: {} },
    skipped: [{ order: 3, raw: 'Chegamos às 19h!', text: 'Chegamos às 19h!', reason: 'chat' }],
    parsed: null,
  },
  list: null, listOrigin: null, copyExtras: true,
}

// ── Screenshots ─────────────────────────────────────────────────────────────
const PAGES = [
  ['concertos', '/setlists'],
  // Novo concerto: passo 1 (origens) e a pré-visualização de "copiar concerto"
  ['novo-concerto', '/concertos/novo'],
  ['novo-concerto-copiar', '/concertos/novo?copy=s1'],
  // Vindo do Calendário num dia que já tem concerto: data visível + "Importar para esse"
  ['novo-concerto-dia', `/concertos/novo?date=${d(1)}`],
  // Revisão retomada de um rascunho (recarregar em ?passo=rever)
  ['novo-concerto-rever', '/concertos/novo?passo=rever', { session: { 'gigio-new-concert-draft': JSON.stringify(NEW_CONCERT_DRAFT) } }],
  ['setlist', '/setlist/s1'],
  ['concerto-modo', '/setlist/s1/concert'],
  // 2.ª música do fixture tem sync — mostra espera/transporte/± linha
  ['concerto-sync', '/setlist/s1/concert', { session: { 'concert-pos-s1': '1' } }],
  ['repertorio', '/library'],
  ['pesquisa', '/search'],
  ['calendario', '/calendar'],
  ['projetos', '/'],
  ['dashboard', '/projects/b1'],
  ['musica', '/songs/sg1'],
  ['sync', '/songs/sg2/sync'],
  ['definicoes', '/settings'],
]
// Páginas sem sessão (contexto próprio, sem token)
const PUBLIC_PAGES = [
  ['auth', '/auth'],
  ['convite', '/join'],
]
const ALL_VIEWS = {
  'phone': { width: 390, height: 844 },
  'tablet-port': { width: 820, height: 1180 },
  'tablet-land': { width: 1180, height: 820 },
}
const VIEWS = Object.entries(ALL_VIEWS).filter(([k]) => (process.env.VIEWS ?? 'phone,tablet-port,tablet-land').split(',').includes(k))
const THEMES = (process.env.THEMES ?? 'light,dark').split(',')
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null

await mkdir(OUT, { recursive: true })
await new Promise(r => server.listen(PORT, r))
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

for (const theme of THEMES) {
  for (const [vname, viewport] of VIEWS) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
    await ctx.route('**/rest/v1/**', restResponse)
    await ctx.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/user') ? USER : SESSION) }))
    await ctx.route(/lrclib|genius|nominatim/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await ctx.addInitScript(`
      localStorage.setItem('sb-mockproj-auth-token', ${JSON.stringify(JSON.stringify(SESSION))});
      localStorage.setItem('gigio-theme', '${theme}');
    `)
    const page = await ctx.newPage()
    for (const [name, route, opts] of PAGES) {
      if (ONLY && !ONLY.includes(name)) continue
      try {
        if (opts?.session) {
          await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
          await page.evaluate(s => { for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, v) }, opts.session)
        }
        await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(700)
        const fullPage = !name.startsWith('concerto-') && name !== 'sync'
        // Numa captura de página inteira, barras position:fixed ficam desenhadas a meio
        // da página — pô-las em fluxo normal para aparecerem no fim, como ao fazer scroll.
        const unfix = fullPage ? await page.addStyleTag({ content: '[class*="bottomNav"],[class*="_actionBar_"]{position:static!important}' }) : null
        await page.screenshot({ path: path.join(OUT, `${name}--${vname}--${theme}.png`), fullPage })
        if (unfix) await unfix.evaluate(el => el.remove())
        console.log('ok', `${name}--${vname}--${theme}`)
      } catch (e) { console.log('FALHOU', name, vname, theme, String(e).split('\n')[0]) }
    }
    await ctx.close()

    // Páginas públicas — sem sessão
    const pub = await browser.newContext({ viewport, deviceScaleFactor: 2 })
    await pub.route('**/rest/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await pub.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await pub.addInitScript(`localStorage.setItem('gigio-theme', '${theme}');`)
    const ppage = await pub.newPage()
    for (const [name, route] of PUBLIC_PAGES) {
      if (ONLY && !ONLY.includes(name)) continue
      try {
        await ppage.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
        await ppage.waitForTimeout(700)
        await ppage.screenshot({ path: path.join(OUT, `${name}--${vname}--${theme}.png`), fullPage: true })
        console.log('ok', `${name}--${vname}--${theme}`)
      } catch (e) { console.log('FALHOU', name, vname, theme, String(e).split('\n')[0]) }
    }
    await pub.close()
  }
}
await browser.close()
server.close()
console.log('shots em', OUT)
