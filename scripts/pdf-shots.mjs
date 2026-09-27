/**
 * Gera PDFs de exemplo com o construtor real (src/lib/pdf) em Node e
 * renderiza as primeiras páginas em PNG para revisão visual.
 *
 * Uso: node scripts/pdf-shots.mjs <pasta-destino> [maxPaginas=6] [escala=1.3]
 *   ONLY=repertorio-casos,alinhamento-claro   só estes PDFs
 *   PDF_SHEET=5 PDF_PAGES=0                   folhas de contacto em vez de uma PNG por página
 * Cada linha do resumo assinala as páginas "quase vazias" (≤3 linhas de texto).
 *
 * O construtor é empacotado com esbuild (dependência do Vite) para CommonJS
 * em node_modules/.cache/gigio-pdf; as fontes são lidas do disco.
 */
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const [outArg, maxArg, scaleArg] = process.argv.slice(2)
if (!outArg) { console.error('uso: pdf-shots.mjs <pasta> [maxPaginas] [escala]'); process.exit(1) }
const outDir = path.resolve(outArg)
const maxPages = Number(maxArg ?? 6)
const scale = Number(scaleArg ?? 1.3)
await mkdir(outDir, { recursive: true })

/* ── 1. Empacotar o construtor para Node ── */
const cacheDir = path.join(root, 'node_modules/.cache/gigio-pdf')
await mkdir(cacheDir, { recursive: true })
const bundle = path.join(cacheDir, 'builder.cjs')
await build({
  entryPoints: [path.join(root, 'src/lib/pdf/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: bundle,
  external: ['canvg', 'dompurify', 'html2canvas'],
  logLevel: 'warning',
})
const require = createRequire(import.meta.url)
delete require.cache[bundle]
const { buildSetlistPdf, PDF_FONT_FILES } = require(bundle)

/* ── 2. Fontes do disco → base64 ── */
const fonts = {}
for (const [role, file] of Object.entries(PDF_FONT_FILES)) {
  fonts[role] = (await readFile(path.join(root, 'src/lib/pdf/fonts', file))).toString('base64')
}

/* ── 3. Fixtures (letras inventadas — nada com direitos) ── */
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = arr => arr[Math.floor(rnd() * arr.length)]

const LINES = [
  'Desço a rua com o sol a bater no alcatrão',
  'Trago o teu nome escrito na palma da mão',
  'E a cidade acorda devagar',
  'Há um barco parado à espera de partir',
  'Ninguém sabe o caminho mas vamos seguir',
  'Canta comigo até o dia chegar',
  'As janelas abertas deixam entrar o verão',
  'O café da esquina já sabe a minha canção',
  'Não me peças para voltar atrás',
  'Somos feitos de sal e de promessas por cumprir',
  'E se a noite cair, deixa-a cair',
  'Guardei o mar inteiro num bolso do casaco',
  'Um passo, outro passo, e o chão a tremer',
  'Diz-me outra vez o que ficou por dizer',
  'Às três da manhã a avenida é só nossa',
  'Ó-ó-ó, ninguém nos pára agora',
  'Lá, lá, lá, lá — e a rua inteira a cantar connosco',
  'Quando a luz se apagar ainda cá estamos',
  'Pão quente, jornal, e a vizinha à janela a regar os vasos de manjericão',
  'Leva-me contigo, leva-me daqui',
]

function stanza(n) {
  return Array.from({ length: n }, () => pick(LINES)).join('\n')
}

function lyrics(kind = 'normal') {
  if (kind === 'long') {
    const parts = []
    for (let v = 1; v <= 6; v++) {
      parts.push(`[Verso ${v}]\n${stanza(6)}`)
      parts.push(`[Refrão]\n${stanza(4)}\n${stanza(2)}`)
      if (v === 3) parts.push(`[Ponte]\n${stanza(5)}`)
    }
    parts.push(`[Final]\n${stanza(4)}\nLeva-me contigo, leva-me daqui (x4)`)
    return parts.join('\n\n')
  }
  if (kind === 'genius') {
    return `[Intro]\nÓ-ó-ó\n\n[Verse 1: Maria do Cais]\n${stanza(4)}\n\n[Pre-Chorus]\n${stanza(2)}\n\n[Chorus]\n${stanza(4)}\n\n[Verse 2]\n${stanza(4)}\n\n[Chorus]\n${stanza(4)}\n\n[Outro]\n${stanza(2)}`
  }
  if (kind === 'plain') return `${stanza(4)}\n\n${stanza(4)}\n\n${stanza(4)}`
  return `[Verso 1]\n${stanza(4)}\n\n[Refrão]\n${stanza(4)}\n\n[Verso 2]\n${stanza(4)}\n\n[Refrão]\n${stanza(4)}`
}

const MIXED_CHORDS = `[Intro]
G  D/F#  Em  C

[Verso 1]
G                 D/F#
Desço a rua com o sol a bater no alcatrão
Em                    C
Trago o teu nome escrito na palma da mão
G              D
E a cidade acorda devagar

[Refrão]
C          G         D        Em
Canta comigo até o dia chegar
C          G              D
Quando a luz se apagar ainda cá estamos`

const CHART_CHORDS = `[Intro]
| Am  | F   | C   | G   |

[Verso]
| Am  | F   | C   | G   |  x2

[Refrão]
| F   | G   | Am  | Am  |
| F   | G   | C   | C   |`

const TITLES = [
  ['Mar de Agosto', 'Os Dias Úteis'],
  ['Estrada Velha', 'Joana Serra'],
  ['Luz de Presença', 'Os Dias Úteis'],
  ['A Última Dança na Rua do Norte, Outra Vez (Versão Acústica Prolongada)', 'Banda do Largo'],
  ['Canção Para Ninguém', 'Maria do Cais'],
  ['Fado do Estendal', 'Os Dias Úteis'],
  ['Noites de São João', 'Joana Serra'],
  ['Sete Mares', 'The Lighthouse Keepers'],
  ['Dia Útil', 'Os Dias Úteis'],
  ['Bairro Alto às Três', 'Banda do Largo'],
  ['Silêncio', 'Maria do Cais'],
  ['Vira Tu', 'Os Dias Úteis'],
  ['Pão Quente', 'Joana Serra'],
  ['Northern Lights (Live at the Harbour)', 'The Lighthouse Keepers'],
  ['Até Amanhã', 'Os Dias Úteis'],
  ['Janela Aberta', 'Maria do Cais'],
  ['Cais do Sodré', 'Banda do Largo'],
  ['Manjericão', 'Os Dias Úteis'],
  ['Ruas de Setembro', 'Joana Serra'],
  ['Leva-me Daqui', 'Os Dias Úteis'],
  ['Everything We Left Behind', 'The Lighthouse Keepers'],
  ['Encore: Mar de Agosto (reprise)', 'Os Dias Úteis'],
]
const KEYS = ['G', 'Am', 'D', 'E', 'C', 'F#m', 'Bb', 'A', 'Em', 'Eb', 'Dm']

function songs(count) {
  seed = 11
  return Array.from({ length: count }, (_, i) => {
    const [title, artist] = TITLES[i % TITLES.length]
    const s = {
      title: i >= TITLES.length ? `${title} ${Math.floor(i / TITLES.length) + 1}` : title,
      artist,
      key: i % 5 === 3 ? null : KEYS[i % KEYS.length],
      originalKey: KEYS[i % KEYS.length],
      bpm: i % 4 === 1 ? null : 84 + ((i * 7) % 60),
      capo: i % 6 === 2 ? 2 : null,
      durationSec: 170 + ((i * 37) % 140),
      lyrics: lyrics(i === 2 ? 'long' : i === 7 ? 'genius' : i % 3 === 0 ? 'plain' : 'normal'),
    }
    if (i === 5) s.lyrics = null // sem letra
    if (i === 0) { s.key = 'A'; s.originalKey = 'G'; s.chords = MIXED_CHORDS; s.intro = 'Guitarra sozinha 4 compassos, depois entra a banda toda'; s.notes = 'Olhar para o baterista no fim do 2.º refrão — corte seco' }
    if (i === 1) { s.chords = CHART_CHORDS; s.ending = 'Ritardando, acaba no Am' }
    if (i === 3) { s.notes = 'Versão curta: saltar o 2.º verso'; s.intro = 'Piano' }
    if (i === 9) { s.ending = 'Fade out com o público a cantar o refrão' }
    if (i === 12) { s.notes = 'Apresentar a banda aqui\nAgradecer à organização' }
    return s
  })
}

/* Casos-limite reportados na revisão dos PDFs */
function edgeSongs() {
  seed = 23
  const covered = MIXED_CHORDS.split('\n').filter(l => l.startsWith('[') || /[a-zà-ú]{3}/.test(l)).join('\n')
  const bigStanza = Array.from({ length: 12 }, () => pick(LINES)).join('\n')
  return [
    {
      title: 'Cifra parcial (o refrão tem de aparecer)', artist: 'Teste', key: 'G', originalKey: 'G',
      lyrics: '[Verse]\nOne two three\n\n[Chorus]\nOne\nTwo\nThree\nFour',
      chords: '[Verse]\nG       D\nOne two three',
    },
    {
      title: 'Cifra que cobre a letra (substitui)', artist: 'Teste', key: 'G', originalKey: 'G',
      lyrics: covered, chords: MIXED_CHORDS,
    },
    {
      title: 'Tom com bemol Unicode', artist: 'Teste', key: 'B♭', originalKey: 'G', bpm: 96, capo: 1,
      lyrics: covered, chords: MIXED_CHORDS,
      notes: 'CACHÊ 300€ — pagar em dinheiro. €50 para o técnico de som.',
    },
    {
      title: 'Tom com sustenido Unicode', artist: 'Teste', key: 'F♯m', originalKey: 'Em',
      lyrics: covered, chords: MIXED_CHORDS.replace(/\bG\b/g, 'Em'),
    },
    {
      title: 'Tom que não se transpõe', artist: 'Teste', key: 'Lá', originalKey: 'G',
      lyrics: lyrics('normal'), chords: CHART_CHORDS,
    },
    {
      // A cifra encolhe (até 75% da letra) para os pares acorde + letra não
      // quebrarem; a linha de 66 colunas, que nem assim cabe, quebra na mesma coluna
      title: 'Cifra com linhas compridas', artist: 'Teste', key: 'G', originalKey: 'G',
      chords: [
        '[Verso 1]',
        'G                    D/F#                 Em            C',
        'Desço a rua com o sol a bater no alcatrão e o mar lá ao fundo',
        'Am                 C                 D',
        'Trago o teu nome escrito na palma da mão',
        '',
        '[Refrão]',
        'C          G         D        Em                 C       D',
        'Canta comigo até o dia chegar, canta comigo até o sol nascer outra vez',
      ].join('\n'),
      lyrics: '[Verso 1]\nDesço a rua com o sol a bater no alcatrão e o mar lá ao fundo\nTrago o teu nome escrito na palma da mão\n\n[Refrão]\nCanta comigo até o dia chegar, canta comigo até o sol nascer outra vez',
    },
    {
      title: 'Só notas, sem letra', artist: 'Teste', key: 'D',
      intro: 'Bateria sozinha 8 tempos', ending: 'Corte seco no 4.º tempo', notes: 'Instrumental — solo de guitarra, 2 voltas',
    },
    {
      title: 'Notas muito compridas', artist: 'Teste', key: 'E',
      notes: Array.from({ length: 30 }, (_, k) => `${k + 1}. ${pick(LINES)}`).join('\n'),
      lyrics: lyrics('normal'),
    },
    {
      title: 'Estrofe de 12 linhas numa música com um título comprido demais para a barra de topo', artist: 'Teste', key: 'C',
      lyrics: `[Verso 1]\n${stanza(6)}\n\n[Refrão]\n${stanza(4)}\n\n[Verso 2]\n${bigStanza}\n\n[Verso 3]\n${bigStanza}\n\n[Refrão]\n${stanza(4)}`,
    },
  ]
}

const concertMeta = {
  title: 'Festa de Verão — Quinta da Ribeira',
  subtitle: 'Os Dias Úteis',
  date: '2026-09-26',
  venue: 'Quinta da Ribeira, Sintra',
  color: '#7C3AED', // cor v1 → remapeada para #4CC9F0
  context: 'concert',
}

const JOBS = [
  { name: 'alinhamento-claro', data: { meta: concertMeta, songs: songs(22) }, options: { kind: 'alinhamento', theme: 'light' } },
  { name: 'alinhamento-escuro', data: { meta: concertMeta, songs: songs(22) }, options: { kind: 'alinhamento', theme: 'dark' } },
  { name: 'repertorio-claro-normal', data: { meta: concertMeta, songs: songs(22) }, options: { kind: 'repertorio', theme: 'light', size: 'normal', includeChords: true } },
  { name: 'repertorio-escuro-grande', data: { meta: concertMeta, songs: songs(22) }, options: { kind: 'repertorio', theme: 'dark', size: 'grande', includeChords: false } },
  { name: 'alinhamento-40', data: { meta: { ...concertMeta, title: 'Maratona de Natal', venue: 'Coliseu' }, songs: songs(40) }, options: { kind: 'alinhamento', theme: 'light' } },
  { name: 'alinhamento-26', data: { meta: { ...concertMeta, title: 'Casamento Rita & Nuno', venue: null }, songs: songs(26) }, options: { kind: 'alinhamento', theme: 'light' } },
  { name: 'repertorio-escuro-enorme', data: { meta: concertMeta, songs: songs(6) }, options: { kind: 'repertorio', theme: 'dark', size: 'enorme', includeChords: true } },
  { name: 'biblioteca-repertorio', data: { meta: { title: 'A minha biblioteca', context: 'library' }, songs: songs(30) }, options: { kind: 'repertorio', theme: 'light', size: 'normal' } },
  { name: 'biblioteca-lista', data: { meta: { title: 'A minha biblioteca', context: 'library' }, songs: songs(30) }, options: { kind: 'alinhamento', theme: 'light' } },
  { name: 'alinhamento-so-titulos', data: { meta: concertMeta, songs: songs(22) }, options: { kind: 'alinhamento', theme: 'light', titlesOnly: true } },
  { name: 'repertorio-casos', data: { meta: { ...concertMeta, title: 'Casos-limite' }, songs: edgeSongs() }, options: { kind: 'repertorio', theme: 'light', size: 'grande', includeChords: true } },
  { name: 'repertorio-claro-enorme', data: { meta: concertMeta, songs: songs(22) }, options: { kind: 'repertorio', theme: 'light', size: 'enorme', includeChords: true } },
]

const only = process.env.ONLY ? process.env.ONLY.split(',') : null
for (const job of JOBS) {
  if (only && !only.includes(job.name)) continue
  const t0 = Date.now()
  const doc = buildSetlistPdf(job.data, job.options, fonts)
  const bytes = Buffer.from(doc.output('arraybuffer'))
  const file = path.join(outDir, `${job.name}.pdf`)
  await writeFile(file, bytes)
  const ms = Date.now() - t0
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/pdf-render.mjs'), file, outDir, String(maxPages), String(scale)], { encoding: 'utf8' })
  const meta = JSON.parse(out.trim().split('\n').pop())
  const l1 = meta.links?.[1] ?? []
  const l2 = meta.links?.[2] ?? []
  // Páginas quase vazias (≤3 linhas de texto no conteúdo) — rever à mão
  const sparse = (meta.lines ?? []).map((n, i) => [i + 1, n]).filter(([, n]) => n <= 3).map(([pg, n]) => `p${pg}:${n}`)
  console.log(
    `${job.name}: ${meta.pages} págs · ${(bytes.length / 1024).toFixed(0)} KB · ${ms} ms · outline ${meta.outline.length}` +
    (l1.length || l2.length ? ` · links p1→[${l1.join(',')}] p2→[${l2.join(',')}]` : '') +
    (sparse.length ? ` · quase vazias ${sparse.join(' ')}` : ''),
  )
}
