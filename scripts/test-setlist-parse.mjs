#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Testes do motor de importação de setlists (parse + correspondência).
   Corre em Node puro:  node scripts/test-setlist-parse.mjs
   Transpila src/lib/setlistImport/{text,parse,match,layout,rows,errors,
   sources}.ts com o TypeScript do projeto para uma pasta temporária e
   importa os módulos.
═══════════════════════════════════════════════════════════════ */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = require(join(root, 'node_modules/typescript'))

const MODULES = ['text', 'parse', 'match', 'layout', 'errors', 'rows', 'sources']
const out = mkdtempSync(join(tmpdir(), 'setlist-parse-'))
for (const name of MODULES) {
  const src = readFileSync(join(root, 'src/lib/setlistImport', `${name}.ts`), 'utf8')
  let js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
  }).outputText
  js = js.replace(/from\s+'\.\/([\w-]+)'/g, "from './$1.mjs'")
  writeFileSync(join(out, `${name}.mjs`), js)
}
const { parseSetlistText, parseSetlist, forceEntry, tidyTitle } = await import(pathToFileURL(join(out, 'parse.mjs')).href)
const { findLibraryMatch, matchLibrary, rankResults, scoreResult } = await import(pathToFileURL(join(out, 'match.mjs')).href)
const text = await import(pathToFileURL(join(out, 'text.mjs')).href)
const { pairTitleArtist, arrangeOcrLines, arrangeColumns, joinWords, wordsToCells, mergeScreens } = await import(pathToFileURL(join(out, 'layout.mjs')).href)
const rowsMod = await import(pathToFileURL(join(out, 'rows.mjs')).href)
const { fileBaseName } = await import(pathToFileURL(join(out, 'sources.mjs')).href)
const errors = await import(pathToFileURL(join(out, 'errors.mjs')).href)
rmSync(out, { recursive: true, force: true })

/* ── mini harness ── */
let pass = 0
let fail = 0
const failures = []
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  failures.push(`✗ ${label}\n    esperado: ${e}\n    obtido:   ${a}`)
}
const titles = entries => entries.map(e => e.songs.map(s => s.title).join(' / '))
const verbose = process.argv.includes('-v')
function check(label, input, expectedTitles, extra) {
  const res = parseSetlistText(input, extra?.opts)
  if (verbose) console.log(`\n# ${label}\n${JSON.stringify(res, null, 1)}`)
  eq(titles(res), expectedTitles, `${label} — títulos`)
  if (extra?.check) extra.check(res)
  return res
}

/* ═══ 1. WhatsApp com números, tons e durações ═══ */
check('WhatsApp: números/tons/durações', `[27/09/26, 21:14] João Baterista: Setlist de sábado 🎸🔥
[27/09/26, 21:14] João Baterista: 1. Wonderwall (G) 4:18
2) Menino do Bairro Negro – Zeca Afonso [Am]
03 - Sweet Child O' Mine - D - 5:56
#4 Creep (tom: G) 3:58
5 - Zombie (Em) (ao vivo)
6. Mr. Brightside 3'42"`,
['Wonderwall', 'Menino do Bairro Negro', "Sweet Child O' Mine", 'Creep', 'Zombie', 'Mr. Brightside'],
{
  check(res) {
    eq(res.map(e => e.songs[0].key ?? null), ['G', 'Am', 'D', 'G', 'Em', null], 'WhatsApp — tons')
    eq(res.map(e => e.songs[0].durationSec ?? null), [258, null, 356, 238, null, 222], 'WhatsApp — durações')
    eq(res[1].songs[0].artist, 'Zeca Afonso', 'WhatsApp — artista com travessão')
  },
})

/* ═══ 2. Texto OCR com lixo ═══ */
check('OCR com lixo', `SETLIST
| Wonderwa11
2. Creep —
3 Zombie ~
._
© ®
l. Hallelujah
~~~ ~~
i l | a e
Sweet Child 0' Mine
Página 1 de 2`,
['Wonderwall', 'Creep', 'Zombie', 'Hallelujah', "Sweet Child 0' Mine"],
{ opts: { ocr: true } })

/* ═══ 3. SET 1 / INTERVALO / ENCORE ═══ */
check('Secções SET/INTERVALO/ENCORE', `SET 1
Tanto Mar
Canção de Engate
--- INTERVALO ---
1º SET
Set 2 - Acústico
Porto Sentido
Encore:
Grândola, Vila Morena
== BIS ==
Encore: Hey Jude`,
['Tanto Mar', 'Canção de Engate', 'Porto Sentido', 'Grândola, Vila Morena', 'Hey Jude'],
{
  check(res) {
    eq(res.map(e => e.section ?? null), ['SET 1', 'SET 1', 'SET 2 - ACÚSTICO', 'ENCORE', 'ENCORE'], 'Secções — rótulos')
  },
})

/* ═══ 4. Medleys ═══ */
check('Medleys A / B, A + B, Medley:', `1. Twist and Shout / La Bamba
2. Sweet Child O' Mine + Paradise City (D)
3. Medley: Tanto Mar, O Homem do Leme, Chuva
4. AC/DC - Highway to Hell`,
['Twist and Shout / La Bamba', "Sweet Child O' Mine / Paradise City", 'Tanto Mar / O Homem do Leme / Chuva', 'AC/DC'],
{
  check(res) {
    eq(res[1].songs[1].key, 'D', 'Medley — tom da 2.ª parte')
    eq(res[3].songs.length, 1, 'AC/DC não é medley')
    eq(res[3].songs[0].swapped, { title: 'Highway to Hell', artist: 'AC/DC' }, 'AC/DC — leitura inversa')
  },
})

/* ═══ 5. Título – Artista ═══ */
check('Título – Artista', `Wonderwall – Oasis
Hallelujah (Jeff Buckley)
Menina Estás à Janela — Vitorino
Pais e Filhos | Legião Urbana`,
['Wonderwall', 'Hallelujah', 'Menina Estás à Janela', 'Pais e Filhos'],
{
  check(res) {
    eq(res.map(e => e.songs[0].artist), ['Oasis', 'Jeff Buckley', 'Vitorino', 'Legião Urbana'], 'Título – Artista — artistas')
  },
})

/* ═══ 6. Artista - Título (guarda as duas leituras) ═══ */
check('Artista - Título', `Oasis - Wonderwall
Xutos & Pontapés - Não Sou o Único
GNR - Dunas`,
['Oasis', 'Xutos & Pontapés', 'GNR'],
{
  check(res) {
    eq(res.map(e => e.songs[0].swapped?.title), ['Wonderwall', 'Não Sou o Único', 'Dunas'], 'Artista - Título — leitura inversa')
  },
})

/* ═══ 7. Emojis e bullets ═══ */
check('Emojis e bullets', `🎤 Setlist 🎤
• Wonderwall 🔥
- Creep
* Zombie ⭐️
▶ Hallelujah
→ Dunas
1️⃣ Tanto Mar
2️⃣ Porto Sentido
✅ Chuva ❤️`,
['Wonderwall', 'Creep', 'Zombie', 'Hallelujah', 'Dunas', 'Tanto Mar', 'Porto Sentido', 'Chuva'])

/* ═══ 8. Tudo em MAIÚSCULAS ═══ */
check('Maiúsculas', `WONDERWALL
CREEP
MENINO DO BAIRRO NEGRO
YMCA
SWEET CHILD O' MINE - GUNS N' ROSES
U2 - ONE`,
['Wonderwall', 'Creep', 'Menino do Bairro Negro', 'YMCA', "Sweet Child O' Mine", 'U2'],
{
  check(res) {
    eq(res[4].songs[0].artist, "Guns N' Roses", 'Maiúsculas — artista capitalizado')
  },
})

/* ═══ 9. Cabeçalhos, datas, local, prosa ═══ */
check('Datas, local e mensagens', `QUINTA DA RIBEIRA
Sábado, 28 de Setembro de 2026
28/09/2026 · 21h30
@ Coliseu dos Recreios
Local: Casino Lisboa
Pessoal, amanhã o soundcheck é às 18h. Tragam os cabos e as estantes, por favor!
Wonderwall
Creep
Total: 1h20
18 músicas
Dunas`,
['Wonderwall', 'Creep', 'Dunas'])

/* ═══ 10. Títulos que parecem ruído mas não são ═══ */
check('Falsos positivos', `99 Luftballons
7 Seconds
10:15 Saturday Night
Total Eclipse of the Heart
Here I Am
Major Tom
Tom Sawyer
Set Fire to the Rain`,
['99 Luftballons', '7 Seconds', '10:15 Saturday Night', 'Total Eclipse of the Heart', 'Here I Am', 'Major Tom', 'Tom Sawyer', 'Set Fire to the Rain'])

/* ═══ 11. Tons "nus" quando o documento os usa ═══ */
check('Tons nus no fim', `1. Wonderwall G
2. Creep G
3. Zombie Em
4. Here I Am C
5. Hallelujah C 4:30`,
['Wonderwall', 'Creep', 'Zombie', 'Here I Am', 'Hallelujah'],
{
  check(res) {
    eq(res.map(e => e.songs[0].key), ['G', 'G', 'Em', 'C', 'C'], 'Tons nus — valores')
  },
})

/* ═══ 12. Folha de cálculo (TAB) ═══ */
check('Colunas TAB', `#\tMúsica\tArtista\tTom\tDuração
1\tWonderwall\tOasis\tG\t4:18
2\tCreep\tRadiohead\tG\t3:58`,
['Wonderwall', 'Creep'],
{
  check(res) {
    eq(res.map(e => [e.songs[0].artist, e.songs[0].key, e.songs[0].durationSec]), [['Oasis', 'G', 258], ['Radiohead', 'G', 238]], 'TAB — artista/tom/duração')
  },
})

/* ═══ 12b. Tabela vinda de PDF (colunas → TAB; tom e duração colados) ═══ */
check('PDF em tabela', ['Setlist Quinta da Ribeira', 'SAB 28/09/2026 · 21h30', 'SET 1', '1. Wonderwall\tOasis\tG\t4:18',
  '3. Twist and Shout / La Bamba\tD\t5:10', '5. Menino do Bairro Negro\tZeca Afonso\tAm 4:02', 'ENCORE', '6. Hallelujah\tJeff Buckley'].join('\n'),
['Wonderwall', 'Twist and Shout / La Bamba', 'Menino do Bairro Negro', 'Hallelujah'],
{
  check(res) {
    eq(res.map(e => [e.songs[0].artist ?? null, e.songs[0].key ?? null, e.section]), [['Oasis', 'G', 'SET 1'], [null, null, 'SET 1'], ['Zeca Afonso', 'Am', 'SET 1'], ['Jeff Buckley', null, 'ENCORE']], 'PDF em tabela — artista/tom/secção')
    eq(res[2].songs[0].durationSec, 242, 'PDF em tabela — duração colada ao tom')
  },
})

/* ═══ 13. Solfejo, bpm, capo e etiquetas ═══ */
check('Solfejo/bpm/capo/etiquetas', `Canção do Mar (Sol) 120 bpm
Tanto Mar - Tom: Lá m
Porto Sentido (capo 2)
Hallelujah (Remastered 2011)
Chuva - Ao Vivo
Numb (Live)
Menino (versão curta)`,
['Canção do Mar', 'Tanto Mar', 'Porto Sentido', 'Hallelujah', 'Chuva', 'Numb', 'Menino'],
{
  check(res) {
    eq(res.map(e => e.songs[0].key ?? null), ['Sol', 'Lá m', null, null, null, null, null], 'Solfejo — tons')
  },
})

/* ═══ 14. Numeração romana, pontos de preenchimento, títulos numéricos ═══ */
check('Romanos, pontos, números', `I. Intro
II. Wonderwall ........ 4:18
III) Creep
1. 22
2. 1979
3. 1-800-273-8255
4 Parte de Mim
Saturday Night`,
['Intro', 'Wonderwall', 'Creep', '22', '1979', '1-800-273-8255', 'Parte de Mim', 'Saturday Night'])

/* ═══ 15. Screenshot de playlist (pares título/artista vindos do OCR) ═══ */
check('Playlist OCR', `Playlist
Shuffle
Wonderwall – Oasis
Creep – Radiohead
Download
Ver tudo`,
['Wonderwall', 'Creep'])

/* ═══ Utilitários de texto ═══ */
eq(text.normalizeTitle('Canção à Beira-Mar!'), 'cancao a beiramar', 'normalizeTitle')
eq(text.matchKey('Wonderwall - Remastered 2011'), 'wonderwall', 'matchKey remaster')
eq(text.matchKey('The Scientist (Live)'), 'scientist', 'matchKey the/parênteses')
eq(text.smartCase('MENINO DO BAIRRO NEGRO'), 'Menino do Bairro Negro', 'smartCase')
eq(text.titleSimilarity('Wonderwal', 'Wonderwall') >= 85, true, 'titleSimilarity tolera gralha')
eq(text.titleSimilarity('Love', 'Love Me Tender') < 60, true, 'titleSimilarity não confunde prefixos')

/* ═══ Correspondência com o repertório ═══ */
const lib = [
  { id: 's1', title: 'Wonderwall', artist: 'Oasis' },
  { id: 's2', title: 'Hallelujah', artist: 'Leonard Cohen' },
  { id: 's3', title: 'Hallelujah', artist: 'Jeff Buckley' },
  { id: 's4', title: "Sweet Child O' Mine", artist: "Guns N' Roses" },
  { id: 's5', title: 'Não Sou o Único', artist: 'Xutos & Pontapés' },
  { id: 's6', title: 'Love Me Tender', artist: 'Elvis Presley' },
  { id: 's7', title: 'Menino do Bairro Negro (ao vivo)', artist: 'Zeca Afonso' },
]
const firstSong = s => parseSetlistText(s, { ocr: true })[0].songs[0]
const libId = s => findLibraryMatch(firstSong(s), lib)?.id ?? null
eq(libId('1. WONDERWALL'), 's1', 'biblioteca: maiúsculas')
eq(libId('Hallelujah – Jeff Buckley'), 's3', 'biblioteca: título + artista desempata')
eq(libId('Hallelujah'), 's2', 'biblioteca: título igual')
eq(libId('Sweet Child of Mine'), 's4', 'biblioteca: variação ortográfica')
eq(libId('Xutos & Pontapés - Não Sou o Único'), 's5', 'biblioteca: Artista - Título')
eq(libId('Love'), null, 'biblioteca: não casa prefixos curtos')
eq(libId('Menino do Bairro Negro'), 's7', 'biblioteca: ignora "(ao vivo)" no repertório')
eq(libId('Wonderwa11'), 's1', 'biblioteca: gralha de OCR')

/* ═══ Pontuação de resultados online ═══ */
const results = [
  { title: 'Wonderwall (Karaoke Version)', artist: 'Karaoke Hits', source: 'lrclib', has_sync: true, external_id: '1' },
  { title: 'Wonderwall', artist: 'Oasis', source: 'text', has_sync: false, external_id: '2' },
  { title: 'Wonderwall - Remastered', artist: 'Oasis', source: 'lrclib', has_sync: true, external_id: '3' },
  { title: 'Champagne Supernova', artist: 'Oasis', source: 'lrclib', has_sync: true, external_id: '4' },
]
const ranked = rankResults(firstSong('Wonderwall – Oasis'), results)
eq(ranked[0].result.external_id, '3', 'online: melhor = título certo + sync + LRCLIB')
eq(ranked.find(r => r.result.external_id === '1').score < ranked[0].score, true, 'online: karaoke penalizado')
eq(scoreResult(firstSong('Oasis - Wonderwall'), results[2]) >= 90, true, 'online: Artista - Título reconhecido')
eq(scoreResult(firstSong('Wonderwall'), results[3]) < 50, true, 'online: outra música do mesmo artista não passa')

/* ═══ Layout do OCR: pares título/artista e vários screenshots ═══ */
// Linhas reais devolvidas pelo tesseract.js (v7, blocks) para um screenshot de playlist sintético
const ocrLines = [
  { text: 'Playlist do Concerto', height: 43, x0: 44, y0: 26, y1: 70 },
  { text: 'Wonderwall 4:18', height: 32, x0: 117, y0: 113, y1: 153 },
  { text: 'Oasis', height: 21.9, x0: 117, y0: 153, y1: 170 },
  { text: 'Creep 4:18', height: 27, x0: 118, y0: 208, y1: 240 },
  { text: 'Radiohead', height: 21.9, x0: 118, y0: 243, y1: 260 },
  { text: 'Menino do Bairro Negro 4:18', height: 31, x0: 119, y0: 297, y1: 330 },
  { text: 'Zeca Afonso', height: 21.9, x0: 117, y0: 333, y1: 350 },
  { text: 'Zombie 4:18', height: 32, x0: 117, y0: 383, y1: 423 },
  { text: 'The Cranberries', height: 21.9, x0: 116, y0: 423, y1: 440 },
  { text: 'Hallelujah 4:18', height: 32, x0: 119, y0: 477, y1: 510 },
  { text: 'Jeff Buckley', height: 21, x0: 115, y0: 513, y1: 534 },
]
const paired = pairTitleArtist(ocrLines)
check('OCR playlist → pares', paired.join('\n'),
  ['Wonderwall', 'Creep', 'Menino do Bairro Negro', 'Zombie', 'Hallelujah'],
  {
    opts: { ocr: true },
    check(res) {
      eq(res.map(e => e.songs[0].artist), ['Oasis', 'Radiohead', 'Zeca Afonso', 'The Cranberries', 'Jeff Buckley'], 'OCR playlist — artistas')
    },
  })
// Folha de papel (letra uniforme) não é emparelhada
const paper = ['Wonderwall', 'Creep', 'Zombie', 'Dunas', 'Chuva', 'Tanto Mar', 'Porto Sentido']
  .map((t, i) => ({ text: t, height: 40, x0: 60, y0: 50 + i * 70, y1: 90 + i * 70 }))
eq(pairTitleArtist(paper), paper.map(l => l.text), 'OCR papel — sem pares')
// Título grande no topo → sugestão de nome; ícone "⋯" lido como "a" numa coluna à parte
const withHeading = [
  { text: 'Concerto Sábado', height: 47, x0: 40, y0: 20, y1: 70 },
  { text: 'Shuffle', height: 24, x0: 70, y0: 90, y1: 115 },
  ...ocrLines.slice(1).map((l, i) => (i === 2 ? { ...l, text: joinWords([{ text: 'Creep', x0: 118, x1: 200 }, { text: 'a', x0: 880, x1: 895 }], 27) } : l)),
]
const arranged = arrangeOcrLines(withHeading)
eq(arranged.heading, 'Concerto Sábado', 'OCR — título grande no topo')
check('OCR playlist com título e ruído', arranged.lines.join('\n'),
  ['Wonderwall', 'Creep', 'Menino do Bairro Negro', 'Zombie', 'Hallelujah'], { opts: { ocr: true } })
eq(parseSetlistText('Creep\ta\n4. Zombie\t|\t3:58', { ocr: true }).map(e => e.songs[0].title), ['Creep', 'Zombie'], 'OCR — colunas de ruído')
eq(mergeScreens([['A – x', 'B – y', 'C – z'], ['B – y', 'C – z', 'D – w']]), ['A – x', 'B – y', 'C – z', 'D – w'], 'screenshots — sobreposição')
eq(mergeScreens([['A – x', 'B – y', 'C – z'], ['z', 'C – z', 'D – w']]), ['A – x', 'B – y', 'C – z', 'D – w'], 'screenshots — linha cortada no topo')
eq(mergeScreens([['A', 'B'], ['C', 'D']]), ['A', 'B', 'C', 'D'], 'screenshots — sem sobreposição')

/* ═══════════════════════════════════════════════════════════════
   Regressões da revisão (criar/importar concerto)
═══════════════════════════════════════════════════════════════ */
const TODAY = new Date(2026, 8, 27)
const P = (s, o = {}) => parseSetlist(s, { today: TODAY, ...o })
const ptitles = r => r.entries.map(e => e.songs.map(x => x.title).join(' / '))

/* ═══ R1. Dois sets lado a lado (TAB): coluna esquerda inteira, depois a direita ═══ */
{
  const r = P('SET 1\tSET 2\nValerie\tDancing Queen\nKiss\tMr. Brightside\nUptown Funk\tShallow')
  eq(ptitles(r), ['Valerie', 'Kiss', 'Uptown Funk', 'Dancing Queen', 'Mr. Brightside', 'Shallow'], 'colunas SET 1 | SET 2 — ordem')
  eq(r.entries.map(e => e.section), ['SET 1', 'SET 1', 'SET 1', 'SET 2', 'SET 2', 'SET 2'], 'colunas SET 1 | SET 2 — secções')
  eq(r.entries.every(e => !e.songs[0].artist), true, 'colunas — a 2.ª coluna não vira artista')
}
eq(ptitles(P('1. Valerie\t7. Dancing Queen\n2. Kiss\t8. Shallow')), ['Valerie', 'Kiss', 'Dancing Queen', 'Shallow'], 'colunas numeradas')
{
  // Sem sinais claros: fica "Título – Artista", mas a revisão oferece ler coluna a coluna
  const amb = 'Valerie\tAmy Winehouse\nKiss\tPrince\nUptown Funk\tMark Ronson\nShallow\tLady Gaga'
  const r = P(amb)
  eq(r.entries.map(e => e.songs[0].artist), ['Amy Winehouse', 'Prince', 'Mark Ronson', 'Lady Gaga'], 'colunas ambíguas — título/artista')
  eq(r.suggest.columns, 8, 'colunas ambíguas — sugestão "ler coluna a coluna"')
  eq(ptitles(P(amb, { splitColumns: true })).slice(0, 5), ['Valerie', 'Kiss', 'Uptown Funk', 'Shallow', 'Amy Winehouse'], 'colunas — leitura forçada')
  eq(P('#\tMúsica\tArtista\n1\tWonderwall\tOasis\n2\tCreep\tRadiohead\n3\tZombie\tThe Cranberries').suggest.columns, undefined, 'tabela com cabeçalho — sem sugestão')
}
// Geometria (PDF / OCR): uma linha só com a coluna da direita fica na direita
{
  const rows = [
    { cells: [{ x: 50, text: 'Casamento Ana & Rui' }] },
    { cells: [{ x: 50, text: 'SET 1' }, { x: 300, text: 'SET 2' }] },
    { cells: [{ x: 50, text: 'Valerie' }, { x: 200, text: 'G' }, { x: 300, text: 'Dancing Queen' }] },
    { cells: [{ x: 50, text: 'Kiss' }, { x: 302, text: 'Mr. Brightside' }] },
    { cells: [{ x: 51, text: 'Uptown Funk' }, { x: 300, text: 'Shallow' }] },
    { cells: [{ x: 300, text: 'Hey Jude' }] },
  ]
  const a = arrangeColumns(rows, 10)
  eq(a.split, true, 'geometria — dois sets separados')
  eq(a.lines, ['Casamento Ana & Rui', 'SET 1', 'Valerie\tG', 'Kiss', 'Uptown Funk', 'SET 2', 'Dancing Queen', 'Mr. Brightside', 'Shallow', 'Hey Jude'], 'geometria — coluna a coluna')
  const table = [
    { cells: [{ x: 50, text: '1. Wonderwall' }, { x: 300, text: 'Oasis' }, { x: 450, text: 'G' }] },
    { cells: [{ x: 50, text: '2. Creep' }, { x: 300, text: 'Radiohead' }] },
    { cells: [{ x: 50, text: '3. Zombie' }, { x: 300, text: 'The Cranberries' }] },
  ]
  eq(arrangeColumns(table, 10).split, false, 'geometria — tabela título/artista não é separada')
  const ocr = [
    { text: 'x', height: 30, x0: 40, y0: 20, y1: 50, cells: [{ x: 40, text: '1. Valerie' }, { x: 600, text: '6. Dancing Queen' }] },
    { text: 'x', height: 30, x0: 40, y0: 70, y1: 100, cells: [{ x: 40, text: '2. Kiss' }, { x: 604, text: '7. Shallow' }] },
    { text: 'x', height: 30, x0: 40, y0: 120, y1: 150, cells: [{ x: 42, text: '3. Creep' }, { x: 600, text: '8. Hey Jude' }] },
    { text: 'x', height: 30, x0: 40, y0: 170, y1: 200, cells: [{ x: 40, text: '4. Zombie' }] },
  ]
  eq(arrangeOcrLines(ocr).lines, ['1. Valerie', '2. Kiss', '3. Creep', '4. Zombie', '6. Dancing Queen', '7. Shallow', '8. Hey Jude'], 'OCR — folha com dois sets')
  eq(wordsToCells([{ text: 'Creep', x0: 118, x1: 200 }, { text: 'a', x0: 880, x1: 895 }], 27), [{ x: 118, text: 'Creep' }, { x: 880, text: 'a' }], 'OCR — blocos com posição')
}

/* ═══ R2. "feat.", "Mr.", "St." não são prosa ═══ */
eq(ptitles(P("Uptown Funk (feat. Bruno Mars) – Mark Ronson\nSt. Elmo's Fire (Man in Motion) – John Parr\nMr. Brightside – The Killers")),
  ['Uptown Funk (feat. Bruno Mars)', "St. Elmo's Fire (Man in Motion)", 'Mr. Brightside'], 'prosa — abreviaturas')
eq(P('Pessoal, amanhã o soundcheck é às 18h. Tragam os cabos e as estantes, por favor!\nWonderwall').skipped.map(x => x.reason), ['prose'], 'prosa — continua a ser ignorada (e reportada)')

/* ═══ R3. Repertório: abreviaturas e gralhas não criam duplicados ═══ */
{
  const lib2 = [
    { id: 'a', title: "Sweet Child O' Mine", artist: "Guns N' Roses" },
    { id: 'b', title: 'Uptown Funk', artist: 'Mark Ronson' },
    { id: 'c', title: 'Valerie', artist: 'Amy Winehouse' },
    { id: 'd', title: 'Twist and Shout', artist: 'The Beatles' },
    { id: 'e', title: 'Kiss', artist: 'Prince' },
    { id: 'f', title: 'Hello Goodbye', artist: 'The Beatles' },
  ]
  const m = s => { const r = matchLibrary(parseSetlistText(s)[0].songs[0], lib2); return r ? `${r.song.id}${r.loose ? '~' : ''}` : null }
  eq(['SWEET CHILD', 'UPTOWN', 'Walerie', 'Valery', 'Twist n Shout'].map(m), ['a~', 'b~', 'c~', 'c~', 'd~'], 'repertório — aproximadas (a confirmar)')
  eq(m('Valerie Amy Winehouse'), 'c', 'repertório — título + artista sem separador')
  eq([m('Kiss Me'), m('Hello'), m('Love'), m('Walerie – Zeca Afonso')], [null, null, null, null], 'repertório — sem falsos positivos')
  eq(text.titleSimilarity('Kiss Me', 'Kiss') < 85, true, 'titleSimilarity — "Kiss Me" ≠ "Kiss"')
  const row = { id: 'x', raw: 'UPTOWN', title: 'UPTOWN', artist: '', choice: { kind: 'library', song: lib2[1], auto: true, loose: true }, search: { state: 'idle', query: '', results: [] } }
  eq(rowsMod.isUncertain(row), true, 'repertório aproximado — "A CONFIRMAR"')
  eq(rowsMod.countRows([row]).uncertain, 1, 'contagem a confirmar')
  eq(rowsMod.rowStatus({ ...row, choice: null }, true), 'searching', 'repertório a carregar — "A PROCURAR", não "SEM LETRA"')
}

/* ═══ R7. Programa de casamento ═══ */
{
  const r = P('Casamento Ana & Rui\nPrograma musical\nQuinta da Ribeira — 12 de Outubro de 2026\nCerimónia\nEntrada da noiva: A Thousand Years – Christina Perri\nJantar\nPrimeira dança: Perfect\nBolo: Happy\nFesta\nValerie')
  eq(ptitles(r), ['A Thousand Years', 'Perfect', 'Happy', 'Valerie'], 'casamento — só as músicas')
  eq(r.entries.map(e => e.moment ?? null), ['Entrada da noiva', 'Primeira dança', 'Bolo', null], 'casamento — momentos')
  eq(r.entries.map(e => e.section), ['CERIMÓNIA', 'JANTAR', 'JANTAR', 'FESTA'], 'casamento — secções')
  eq(r.meta, { title: 'Casamento Ana & Rui', date: '2026-10-12', venue: 'Quinta da Ribeira' }, 'casamento — título, data e local')
  eq(ptitles(P('Festa\nBeijo\nValerie\nChegada')), ['Festa', 'Beijo', 'Valerie', 'Chegada'], 'músicas com nome de momento numa setlist normal')
  const rows = rowsMod.entriesToRows(r.entries)
  eq(rowsMod.setlistFieldsFor(rows[0]), { notes: 'Entrada da noiva' }, 'momento → notas do concerto')
  eq(P('Setlist - Quinta da Ribeira\nSáb 12 out · 21h30\nLocal: Hard Club, Porto\n1. Wonderwall\n2. Creep').meta,
    { title: 'Quinta da Ribeira', date: '2026-10-12', venue: 'Hard Club, Porto' }, 'metadados — "Local:" e data sem ano')
}

/* ═══ R9. WhatsApp numa só linha, vírgulas, conversa ═══ */
eq(ptitles(P('1. Valerie (G) 3:40 / 2. Kiss (A) / 3. Uptown Funk / 4. Dancing Queen')), ['Valerie', 'Kiss', 'Uptown Funk', 'Dancing Queen'], 'WhatsApp — numeração na mesma linha (com /)')
eq(ptitles(P('1. Valerie 2. Kiss 3. Uptown Funk')), ['Valerie', 'Kiss', 'Uptown Funk'], 'WhatsApp — numeração na mesma linha')
eq(ptitles(P('3. Twist and Shout / La Bamba')), ['Twist and Shout / La Bamba'], 'medley numerado continua medley')
{
  const r = P('Valerie, Kiss, Uptown Funk')
  eq(r.suggest.commas, 3, 'vírgulas — sugestão')
  eq(ptitles(P('Valerie, Kiss, Uptown Funk', { splitCommas: true })), ['Valerie', 'Kiss', 'Uptown Funk'], 'vírgulas — separadas')
  const c = P('1. Valerie\n2. Kiss\nChegamos às 19h!\nok boa\n3. Uptown Funk')
  eq(ptitles(c), ['Valerie', 'Kiss', 'Uptown Funk'], 'conversa numa lista numerada fica de fora')
  eq(c.skipped.map(x => [x.reason, x.text]), [['chat', 'Chegamos às 19h!'], ['chat', 'ok boa']], 'conversa — linhas ignoradas reportadas')
  const f = forceEntry(c.skipped[0].text, c.skipped[0].order)
  eq(f.songs[0].title, 'Chegamos às 19h!', 'repor linha ignorada')
}

/* ═══ R10. Screenshot do Spotify ═══ */
{
  const r = P('Playlist do Jantar\nValerie – E Amy Winehouse\nKiss – Prince\nUptown Funk – Mark Ronson\nJoão Silva • 23 músicas, 1 h 20 min\nInício\tPesquisar\nHome | Search\nValerie • Amy Winehouse', { ocr: true, image: true })
  eq(ptitles(r), ['Valerie', 'Kiss', 'Uptown Funk'], 'Spotify — só as músicas')
  eq(r.entries[0].songs[0].artist, 'Amy Winehouse', 'Spotify — badge "E" fora do artista')
  eq(r.skipped.map(x => x.reason), ['title', 'app', 'app', 'app', 'repeat'], 'Spotify — UI e mini-player ignorados')
  const rec = P('Valerie – Amy Winehouse\nKiss – Prince\nMúsicas recomendadas\nShape of You – Ed Sheeran\nLevitating – Dua Lipa', { ocr: true, image: true })
  eq(ptitles(rec), ['Valerie', 'Kiss'], 'Spotify — "Músicas recomendadas" termina a lista')
  const rep = P('Valerie\nKiss\nValerie\nCreep')
  eq(rep.entries.map(e => !!e.repeat), [false, false, true, false], 'repetidas marcadas')
}

/* ═══ R19. Nomes de ficheiro ═══ */
eq(fileBaseName('Casamento Ana&Rui Programa FINAL v3(2).pdf'), 'Casamento Ana&Rui', 'ficheiro — lixo de versões')
eq(fileBaseName('Setlist_Quinta_da_Ribeira.pdf'), 'Quinta da Ribeira', 'ficheiro — "setlist"')
eq(fileBaseName('Bar do Zé - setlist v2 (1).pdf'), 'Bar do Zé', 'ficheiro — sufixos')
eq(fileBaseName('setlist final.pdf'), null, 'ficheiro — só lixo')
eq(fileBaseName('Jantar Bossa Nova.pdf'), 'Jantar Bossa Nova', 'ficheiro — nome normal intacto')
eq(fileBaseName('IMG_1234.jpg'), null, 'ficheiro — câmara')
eq(tidyTitle('SETLIST — QUINTA DA RIBEIRA · 28/09'), 'Quinta da Ribeira', 'título — sem "setlist" nem data')

/* ═══ Linhas ignoradas repostas no sítio certo; erros de rede em português ═══ */
{
  const rows = rowsMod.entriesToRows(P('1. Valerie\n2. Kiss\nChegamos!\n3. Creep\n4. Zombie').entries)
  eq(rowsMod.insertIndexFor(rows, 2), 2, 'repor — antes da linha seguinte')
  eq(errors.humanizeError('TypeError: Failed to fetch'), errors.OFFLINE_MESSAGE, 'erro de rede → "Sem ligação"')
  eq(errors.humanizeError('Load failed'), errors.OFFLINE_MESSAGE, 'erro de rede (Safari) → "Sem ligação"')
  eq(errors.humanizeError('duplicate key value'), 'duplicate key value', 'outros erros ficam')
}

/* ── resultado ── */
if (failures.length) console.log(failures.join('\n'))
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passaram, ${fail} falharam`)
process.exit(fail === 0 ? 0 : 1)
