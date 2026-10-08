#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Testes da letra de palco + tempos da sincronização
   (src/lib/lyricsTiming.ts — o modo concerto desenha a LETRA e o sync
   só lhe empresta tempos).
   Corre em Node puro:  node scripts/test-lyrics-timing.mjs [-v]
   Transpila o módulo com o esbuild do projeto para uma pasta temporária.
═══════════════════════════════════════════════════════════════ */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const esbuild = require(join(root, 'node_modules/esbuild'))

const out = mkdtempSync(join(tmpdir(), 'lyrics-timing-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
const src = readFileSync(join(root, 'src/lib/lyricsTiming.ts'), 'utf8')
const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'esm', target: 'es2022' })
writeFileSync(join(out, 'lyricsTiming.mjs'), code)
const T = await import(pathToFileURL(join(out, 'lyricsTiming.mjs')).href)
const {
  parseStageLines, normalizeLyric, lineSimilarity, mapSyncToLyrics, mapSyncByOrder,
  timeForLine, stageTimes, activeLineAt, lineStartMs, nextLyricLine, prevLyricLine,
  resolveStageTiming, stageLyricsText, restoreSyncTimes,
} = T

/* ── mini harness ── */
let pass = 0
let fail = 0
const failures = []
const verbose = process.argv.includes('-v')
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; if (verbose) console.log(`✓ ${label}`); return }
  fail++
  failures.push(`✗ ${label}\n    esperado: ${e}\n    obtido:   ${a}`)
}
function ok(cond, label, info) {
  if (cond) { pass++; if (verbose) console.log(`✓ ${label}`); return }
  fail++
  failures.push(`✗ ${label}${info !== undefined ? `\n    ${JSON.stringify(info)}` : ''}`)
}
function test(name, fn) {
  try { fn() } catch (e) { fail++; failures.push(`✗ ${name} — exceção: ${e?.stack ?? e}`) }
}

/* ── fixtures ── */
const LYRICS = [
  '[Verso 1]',
  'Acordo cedo e o café já arrefeceu',
  'A rua inteira ainda a dormir',
  '    (oh, oh)',
  'Levo o casaco que ontem me deixaste',
  '',
  '[Refrão]',
  'Fica comigo até a noite acabar',
  'Fica comigo, não há pressa de ir',
  'Fica comigo até a noite acabar',
  '',
  '[Verso 2]',
  'O elétrico passa e ninguém repara',
  'Nas mãos frias de quem está à espera',
  '',
  '[Refrão]',
  'Fica comigo até a noite acabar',
  'Fica comigo, não há pressa de ir',
  'Fica comigo até a noite acabar',
  '',
  '[Refrão]',
  'Fica comigo até a noite acabar',
  'Fica comigo, não há pressa de ir',
  'Fica comigo até a noite acabar',
].join('\n')

/** Como o editor de sync grava: só linhas não vazias, só as que levaram toque */
function editorSync(text, { sections = false, start = 10000, step = 4000 } = {}) {
  return text.split('\n')
    .filter(l => l.trim())
    .filter(l => sections || !/^\[.+\]$/.test(l.trim()))
    .map((t, i) => ({ text: t, time_ms: start + i * step }))
}

const kinds = lines => lines.map(l => l.kind[0]).join('')
const lyricIdx = lines => lines.flatMap((l, i) => (l.kind === 'lyric' ? [i] : []))
const timedLyrics = (lines, tbl) => lyricIdx(lines).filter(i => tbl[i] != null).length
function increasing(arr) {
  const v = arr.filter(t => t != null)
  for (let i = 1; i < v.length; i++) if (!(v[i] > v[i - 1])) return false
  return true
}

/* ═══ 1. parseStageLines ═══ */
test('parse: tipos, ordem e src', () => {
  const s = parseStageLines(LYRICS)
  eq(s.length, 24, 'parse: mantém todas as linhas')
  eq(kinds(s), 'sllllbslllbsllbslllbslll', 'parse: secção/letra/vazia pela ordem')
  eq(s[0], { kind: 'section', text: '[Verso 1]', label: 'Verso 1', indent: 0, src: 0 }, 'parse: secção')
  eq(s[3], { kind: 'lyric', text: '    (oh, oh)', indent: 4, src: 3 }, 'parse: indentação mantida')
  eq(s[5], { kind: 'blank', text: '', indent: 0, src: 5 }, 'parse: vazia no meio')
  eq(s.filter(l => l.kind === 'section').length, 5, 'parse: 5 secções')
  eq(s.filter(l => l.kind === 'blank').length, 4, 'parse: 4 vazias')
})

test('parse: vazias no início/fim saem, duas seguidas ficam duas', () => {
  const s = parseStageLines('\n\n  \nUm\n\n\nDois\n\n \n')
  eq(kinds(s), 'lbbl', 'parse: só as vazias das pontas saem')
  eq(s[0].src, 3, 'parse: src conta as linhas retiradas')
  eq(s[3].src, 6, 'parse: src da última')
})

test('parse: \\r\\n, espaços múltiplos e espaço no fim', () => {
  const s = parseStageLines('[Intro]\r\nLinha  com   espaços   \r\n\r\n\tCom tab\r\n')
  eq(s.map(l => [l.kind, l.text]), [
    ['section', '[Intro]'], ['lyric', 'Linha  com   espaços'], ['blank', ''], ['lyric', '\tCom tab'],
  ], 'parse: \\r\\n normalizado, espaços internos e tab mantidos, fim limpo')
})

test('parse: letra vazia', () => {
  eq(parseStageLines(''), [], 'parse: string vazia')
  eq(parseStageLines('  \n\n \r\n'), [], 'parse: só espaços')
  eq(parseStageLines(null), [], 'parse: null')
})

/* ═══ 2. normalização / semelhança ═══ */
test('normalizeLyric', () => {
  eq(normalizeLyric('  Não há   PRESSA, de ir!  '), 'nao ha pressa de ir', 'norm: acentos, pontuação, espaços')
  eq(normalizeLyric("Don't  stop — (oh,oh)"), 'dont stop oh oh', 'norm: apóstrofo cola, resto separa')
  ok(lineSimilarity('Levo o casaco que ontem me deixaste', 'Levo o casaco que ontem me deixastee') >= 0.8, 'sim: gralha ≥ 0.8')
  ok(lineSimilarity('Fica comigo até a noite acabar', 'O elétrico passa e ninguém repara') < 0.5, 'sim: linhas diferentes < 0.5')
})

/* ═══ 3. emparelhamento ═══ */
test('sync do editor sem vazias (com secções marcadas)', () => {
  const s = parseStageLines(LYRICS)
  const sync = editorSync(LYRICS, { sections: true })
  const m = mapSyncToLyrics(s, sync)
  eq(m.coverage, 1, 'sem vazias: cobertura 1')
  eq(m.lineBySync.includes(-1), false, 'sem vazias: todas as entradas emparelhadas')
  ok(s.every((l, i) => (l.kind === 'blank') === (m.timeByLine[i] == null)), 'sem vazias: só as vazias ficam sem tempo')
  ok(increasing(m.timeByLine), 'sem vazias: tempos sempre a subir')
})

test('secções não marcadas', () => {
  const s = parseStageLines(LYRICS)
  const m = mapSyncToLyrics(s, editorSync(LYRICS))
  eq(m.coverage, 1, 'sem secções: cobertura 1')
  eq(timedLyrics(s, m.timeByLine), lyricIdx(s).length, 'sem secções: todas as linhas de letra com tempo')
  ok(s.every((l, i) => l.kind !== 'section' || m.timeByLine[i] == null), 'sem secções: secções sem tempo')
})

test('secções marcadas emparelham com a secção', () => {
  const s = parseStageLines(LYRICS)
  const sync = editorSync(LYRICS, { sections: true })
  const m = mapSyncToLyrics(s, sync)
  eq(m.lineBySync[0], 0, 'secções: [Verso 1] → linha 0')
  eq(s[m.lineBySync[5]].text, '[Refrão]', 'secções: 1.º [Refrão] → secção')
  eq(sync.map((e, k) => s[m.lineBySync[k]].text.trim() === e.text.trim()).every(Boolean), true, 'secções: cada entrada no seu texto')
})

test('refrão repetido 3× emparelha pela ordem', () => {
  const s = parseStageLines(LYRICS)
  const sync = editorSync(LYRICS)
  const m = mapSyncToLyrics(s, sync)
  const chorus = s.flatMap((l, i) => (l.text === 'Fica comigo, não há pressa de ir' ? [i] : []))
  eq(chorus.length, 3, 'refrão: 3 ocorrências na letra')
  const entries = sync.flatMap((e, k) => (e.text === 'Fica comigo, não há pressa de ir' ? [k] : []))
  eq(entries.map(k => m.lineBySync[k]), chorus, 'refrão: 1.ª→1.ª, 2.ª→2.ª, 3.ª→3.ª')
})

test('linhas duplicadas seguidas', () => {
  const text = 'Antes\nOh oh\nOh oh\nOh oh\nDepois'
  const s = parseStageLines(text)
  const all = mapSyncToLyrics(s, editorSync(text))
  eq(all.lineBySync, [0, 1, 2, 3, 4], 'duplicadas: 3 entradas → 3 linhas pela ordem')
  const two = mapSyncToLyrics(s, [
    { text: 'Antes', time_ms: 1000 }, { text: 'Oh oh', time_ms: 2000 }, { text: 'Oh oh', time_ms: 3000 }, { text: 'Depois', time_ms: 5000 },
  ])
  eq(two.lineBySync, [0, 1, 2, 4], 'duplicadas: 2 entradas → as 2 primeiras')
  eq(two.timeByLine, [1000, 2000, 3000, null, 5000], 'duplicadas: a 3.ª fica sem tempo')
})

test('espaços/indentação/pontuação não impedem o par', () => {
  const s = parseStageLines('Linha um\n      (oh,   oh!)\nLinha três')
  const m = mapSyncToLyrics(s, [
    { text: 'Linha um', time_ms: 1000 }, { text: '(oh, oh)', time_ms: 2000 }, { text: 'linha TRÊS.', time_ms: 3000 },
  ])
  eq(m.lineBySync, [0, 1, 2], 'espaços: emparelha')
  eq(s[1].text, '      (oh,   oh!)', 'espaços: o palco mostra o texto da letra')
})

test('letra com \\r\\n', () => {
  const s = parseStageLines(LYRICS.replace(/\n/g, '\r\n'))
  const m = mapSyncToLyrics(s, editorSync(LYRICS))
  eq(m.coverage, 1, '\\r\\n: cobertura 1')
  eq(s.length, 24, '\\r\\n: mesmas linhas')
})

/* ═══ 4. letra editada depois de sincronizada ═══ */
test('gralha corrigida', () => {
  const sync = editorSync(LYRICS.replace('deixaste', 'deixate').replace('arrefeceu', 'arefeceu'))
  const s = parseStageLines(LYRICS)
  const m = mapSyncToLyrics(s, sync)
  eq(m.coverage, 1, 'gralha: cobertura 1')
  eq(m.timeByLine[4], 10000 + 3 * 4000, 'gralha: a linha corrigida mantém o tempo')
})

test('linha nova acrescentada', () => {
  const sync = editorSync(LYRICS)
  const edited = LYRICS.replace('A rua inteira ainda a dormir', 'A rua inteira ainda a dormir\nE eu sem saber o que dizer')
  const s = parseStageLines(edited)
  const m = mapSyncToLyrics(s, sync)
  const iNew = s.findIndex(l => l.text === 'E eu sem saber o que dizer')
  eq(m.coverage, 1, 'nova: cobertura 1')
  eq(m.timeByLine[iNew], null, 'nova: linha nova sem tempo do sync')
  eq(timeForLine(iNew, m.timeByLine), (m.timeByLine[iNew - 1] + m.timeByLine[iNew + 1]) / 2, 'nova: tempo interpolado entre as vizinhas')
  eq(s[iNew].kind, 'lyric', 'nova: é desenhada')
})

test('linha removida', () => {
  const sync = editorSync(LYRICS)
  const s = parseStageLines(LYRICS.replace('Nas mãos frias de quem está à espera\n', ''))
  const m = mapSyncToLyrics(s, sync)
  const k = sync.findIndex(e => e.text.startsWith('Nas mãos'))
  eq(m.lineBySync[k], -1, 'removida: entrada sem par')
  eq(m.lineBySync.filter(j => j < 0).length, 1, 'removida: só essa entrada fica sem par')
  // Cobertura sobre o lado menor: todas as linhas da letra têm par
  eq(m.coverage, 1, 'removida: cobertura 1 (todas as linhas da letra emparelhadas)')
  const iChorus2 = s.findIndex((l, i) => i > 12 && l.text === 'Fica comigo até a noite acabar')
  eq(m.timeByLine[iChorus2], sync[k + 1].time_ms, 'removida: o 2.º refrão continua com o seu tempo')
})

test('estrofe trocada de sítio', () => {
  const A = 'Acordo cedo e o café já arrefeceu\nA rua inteira ainda a dormir'
  const B = 'O elétrico passa e ninguém repara\nNas mãos frias de quem está à espera\nLevo o casaco que ontem me deixaste'
  const text = `${A}\n\n${B}`
  const moved = `${B}\n\n${A}`
  const s = parseStageLines(moved)
  const m = mapSyncToLyrics(s, editorSync(text))
  ok(increasing(m.timeByLine), 'trocada: o tempo nunca anda para trás', m.timeByLine)
  eq(m.lineBySync.filter(j => j >= 0).length, 3, 'trocada: fica a estrofe maior (3 linhas)')
  eq(m.coverage, 3 / 5, 'trocada: cobertura 0.6')
  const times = stageTimes(s, m.timeByLine)
  ok(increasing(times), 'trocada: tempos efetivos a subir', times)
})

test('linha do 1.º refrão apagada não rouba o 2.º refrão', () => {
  const sync = editorSync(LYRICS)
  // O cantor tirou a 2.ª linha do 1.º refrão (a mesma frase existe nos refrões seguintes)
  const lines = LYRICS.split('\n')
  lines.splice(8, 1)
  const s = parseStageLines(lines.join('\n'))
  const m = mapSyncToLyrics(s, sync)
  const iVerse2 = s.findIndex(l => l.text.startsWith('O elétrico'))
  eq(m.timeByLine[iVerse2], sync.find(e => e.text.startsWith('O elétrico')).time_ms, 'apagada: verso 2 continua no tempo certo')
  eq(m.lineBySync.filter(j => j < 0).length, 1, 'apagada: só essa entrada fica sem par')
  eq(m.coverage, 1, 'apagada: cobertura 1')
})

test('linha retocada no 1.º refrão não salta para o 2.º', () => {
  const sync = editorSync(LYRICS)
  // Retoque só na 1.ª ocorrência; a versão antiga continua igual no 2.º refrão
  const edited = LYRICS.replace('Fica comigo, não há pressa de ir', 'Fica comigo, não há pressa de partir')
  const s = parseStageLines(edited)
  const m = mapSyncToLyrics(s, sync)
  eq(m.coverage, 1, 'retocada: cobertura 1')
  eq(m.timeByLine[8], sync[5].time_ms, 'retocada: emparelha com a linha retocada (não com o 2.º refrão)')
})

test('tempo escrito fora de ordem não anda para trás', () => {
  const s = parseStageLines('Um\nDois\nTrês\nQuatro\nCinco')
  const m = mapSyncToLyrics(s, [
    { text: 'Um', time_ms: 1000 }, { text: 'Dois', time_ms: 2000 }, { text: 'Três', time_ms: 900000 },
    { text: 'Quatro', time_ms: 4000 }, { text: 'Cinco', time_ms: 5000 },
  ])
  eq(m.timeByLine, [1000, 2000, null, 4000, 5000], 'fora de ordem: só o tempo errado sai')
  eq(timeForLine(2, m.timeByLine), 3000, 'fora de ordem: fica interpolado')
})

test('sync LRC com pausas vazias', () => {
  const s = parseStageLines('Um\nDois\n\nTrês\nQuatro')
  const m = mapSyncToLyrics(s, [
    { text: 'Um', time_ms: 1000 }, { text: 'Dois', time_ms: 2000 }, { text: '', time_ms: 2500 },
    { text: 'Três', time_ms: 6000 }, { text: 'Quatro', time_ms: 7000 }, { text: '', time_ms: 9000 },
  ])
  eq(m.timeByLine, [1000, 2000, 2500, 6000, 7000], 'LRC: pausa → linha vazia entre estrofes; a final fica de fora')
  eq(m.coverage, 1, 'LRC: as vazias não contam para a cobertura')
})

/* ═══ 5. sync de outra letra / vazios ═══ */
test('sync de uma letra completamente diferente', () => {
  const s = parseStageLines(LYRICS)
  const other = 'Outra canção sem nada a ver\nCom versos que não existem aqui\nNem refrão parecido\nNem nada'
  const m = mapSyncToLyrics(s, editorSync(other))
  ok(m.coverage < 0.5, 'diferente: cobertura baixa', m.coverage)
  eq(resolveStageTiming(s, editorSync(other)).mode, 'none', 'diferente: nº de linhas diferente → sem sync')
})

test('sync de outra versão com o mesmo nº de linhas → por ordem', () => {
  const text = '[Verso]\nPrimeira coisa\n\nSegunda coisa\nTerceira coisa'
  const s = parseStageLines(text)
  const sync = editorSync('Outra letra um\nOutra letra dois\nOutra letra três')
  const r = resolveStageTiming(s, sync)
  eq(r.mode, 'order', 'ordem: modo')
  eq(r.timeByLine, [null, 10000, null, 14000, 18000], 'ordem: k-ésima entrada → k-ésima linha de letra')
  eq(mapSyncByOrder(s, sync.slice(0, 2)), null, 'ordem: nº diferente → null')
})

test('sync vazio', () => {
  const s = parseStageLines(LYRICS)
  const m = mapSyncToLyrics(s, [])
  eq(m.coverage, 0, 'vazio: cobertura 0')
  eq(m.timeByLine.every(t => t == null), true, 'vazio: sem tempos')
  eq(resolveStageTiming(s, []).mode, 'none', 'vazio: modo none')
  eq(resolveStageTiming(s, null).times, null, 'vazio: sem tempos efetivos')
})

test('letra vazia', () => {
  const m = mapSyncToLyrics([], editorSync(LYRICS))
  eq(m.timeByLine, [], 'letra vazia: sem linhas')
  eq(m.lineBySync.every(j => j === -1), true, 'letra vazia: nada emparelha')
  eq(resolveStageTiming([], editorSync(LYRICS)).mode, 'none', 'letra vazia: modo none')
})

test('sync parcial (só o início) continua a ser a sync desta letra', () => {
  const s = parseStageLines(LYRICS)
  const r = resolveStageTiming(s, editorSync(LYRICS).slice(0, 4))
  eq(r.mode, 'match', 'parcial: emparelhada')
  eq(r.coverage, 1, 'parcial: cobertura 1')
  ok(lyricIdx(s).every(i => r.times[i] != null), 'parcial: todas as linhas de letra com tempo (estimado)')
  ok(increasing(r.times), 'parcial: tempos a subir', r.times)
})

/* ═══ 6. tempos no palco ═══ */
test('timeForLine', () => {
  const tbl = [null, null, 10000, null, 14000, null, null]
  eq(timeForLine(3, tbl), 12000, 'timeForLine: entre vizinhas')
  eq(timeForLine(4, tbl), 14000, 'timeForLine: com tempo → o seu')
  eq(timeForLine(5, tbl), 16000, 'timeForLine: depois da última → + passo médio')
  eq(timeForLine(6, tbl), 18000, 'timeForLine: 2 depois da última → + 2 passos')
  eq(timeForLine(1, tbl), 8000, 'timeForLine: antes da 1.ª → recua o passo médio')
  eq(timeForLine(0, tbl), 6000, 'timeForLine: antes da 1.ª, 2 linhas')
  eq(timeForLine(0, [null, null, 1000, 5000]), 0, 'timeForLine: antes da 1.ª sem espaço → 0')
  eq(timeForLine(1, [null, null, 1000, 5000]), 500, 'timeForLine: … e as seguintes repartem até à 1.ª')
  eq(timeForLine(2, [null, null, null]), null, 'timeForLine: sem tempos → null')
  eq(timeForLine(2, [1000, null, null], 7000), 5000, 'timeForLine: uma só com tempo → reparte o resto da duração')
  eq(timeForLine(1, [1000, null]), 4000, 'timeForLine: uma só com tempo, sem duração → 3 s')
})

test('stageTimes / activeLineAt / lineStartMs', () => {
  const s = parseStageLines(LYRICS.replace('A rua inteira ainda a dormir', 'A rua inteira ainda a dormir\nLinha nova'))
  const r = resolveStageTiming(s, editorSync(LYRICS), 120000)
  ok(lyricIdx(s).every(i => r.times[i] != null), 'times: todas as linhas de letra com tempo')
  ok(increasing(r.times), 'times: estritamente a subir')
  ok(s.every((l, i) => l.kind === 'lyric' || r.times[i] == null), 'times: secções/vazias sem tempo (não marcadas)')
  eq(activeLineAt(0, r.times), -1, 'activeLineAt: antes da 1.ª → -1')
  eq(activeLineAt(10000, r.times), 1, 'activeLineAt: no tempo exato')
  eq(activeLineAt(10500, r.times), 1, 'activeLineAt: entre linhas → a anterior')
  ok(lyricIdx(s).every(i => activeLineAt(lineStartMs(i, r.times), r.times) === i), 'lineStartMs: cada linha acende a si própria')
  eq(lineStartMs(5, [0, 1, 2, 3, 4, null]), null, 'lineStartMs: sem tempo → null')
  eq(lineStartMs(0, [1000, 1001]), 1000.5, 'lineStartMs: nunca chega à seguinte')
})

test('next/prevLyricLine', () => {
  const s = parseStageLines(LYRICS)
  eq(nextLyricLine(s, -1), 1, 'next: 1.ª linha de letra (salta a secção)')
  eq(nextLyricLine(s, 4), 7, 'next: salta vazia e secção')
  eq(prevLyricLine(s, 7), 4, 'prev: salta secção e vazia')
  eq(prevLyricLine(s, 1), -1, 'prev: antes da 1.ª → -1')
  eq(nextLyricLine(s, s.length - 1), -1, 'next: depois da última → -1')
  eq(prevLyricLine(s, s.length + 5), s.length - 1, 'prev: fora do fim → última')
})

/* ═══ 7. regressões da revisão ═══ */
/** Pôr o relógio no início de cada linha de letra acende essa mesma linha */
const selfLit = (s, times) => lyricIdx(s).every(i => activeLineAt(lineStartMs(i, times), times) === i)
/** Cue (relógio parado em 0): não há linha de letra antes da que o relógio acende */
const cueAtStart = (s, times) => {
  const cur = activeLineAt(0, times)
  return cur <= nextLyricLine(s, -1) && prevLyricLine(s, cur) === -1
}

test('sync começa a 0 ms + linha nova no topo', () => {
  const s = parseStageLines('(a capella)\nPrimeira linha\nSegunda\nTerceira')
  const r = resolveStageTiming(s, [
    { text: 'Primeira linha', time_ms: 0 }, { text: 'Segunda', time_ms: 4000 }, { text: 'Terceira', time_ms: 8000 },
  ])
  eq(r.mode, 'match', 't0: emparelhada')
  ok(increasing(r.times), 't0: tempos estritamente a subir (nunca duas linhas a 0)', r.times)
  eq(r.times[0], 0, 't0: a linha nova fica no início')
  ok(r.times[1] > 0 && r.times[1] <= 1, 't0: a 1.ª da sync desempata por 1 ms', r.times)
  eq(r.times.slice(2), [4000, 8000], 't0: as outras ficam no seu tempo')
  ok(selfLit(s, r.times), 't0: cada linha acende a si própria (lineStartMs)', r.times)
  ok(cueAtStart(s, r.times), 't0: em cue não há linha anterior (‹ = música anterior)', activeLineAt(0, r.times))
  eq(activeLineAt(lineStartMs(0, r.times), r.times), 0, 't0: tocar na linha nova acende-a')
})

test('[Intro] marcada a 0:00 + linha nova no topo', () => {
  const s = parseStageLines('Capo 2\n[Intro]\nLinha um\nLinha dois')
  const r = resolveStageTiming(s, [
    { text: '[Intro]', time_ms: 0 }, { text: 'Linha um', time_ms: 12000 }, { text: 'Linha dois', time_ms: 16000 },
  ])
  ok(increasing(r.times), 'intro0: tempos estritamente a subir', r.times)
  eq(r.times.slice(2), [12000, 16000], 'intro0: a letra sincronizada fica no seu tempo')
  ok(selfLit(s, r.times), 'intro0: cada linha acende a si própria', r.times)
  ok(cueAtStart(s, r.times), 'intro0: em cue não há linha anterior')
})

test('várias linhas novas antes de uma sync a 0 ms', () => {
  const s = parseStageLines('Nota um\nNota dois\nNota três\nPrimeira\nSegunda')
  const r = resolveStageTiming(s, [{ text: 'Primeira', time_ms: 0 }, { text: 'Segunda', time_ms: 3000 }])
  ok(increasing(r.times), 'vários0: tempos estritamente a subir', r.times)
  ok(selfLit(s, r.times), 'vários0: cada linha acende a si própria', r.times)
  ok(cueAtStart(s, r.times), 'vários0: em cue não há linha anterior')
  ok(r.times[3] < 10, 'vários0: a sync a 0 ms só anda uns ms', r.times)
  eq(r.times[4], 3000, 'vários0: a seguinte não mexe')
})

test('aleatório: tempos a 0, toques repetidos, linhas novas/removidas', () => {
  // PRNG determinístico (mulberry32): o mesmo teste em todas as corridas
  let seed = 20261008
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const words = ['mar', 'sol', 'rua', 'luz', 'noite', 'casa', 'vento', 'porto']
  let bad = null
  for (let n = 0; n < 1500 && !bad; n++) {
    const base = Array.from({ length: 3 + Math.floor(rnd() * 10) }, (_, k) =>
      `Linha ${k} do ${words[k % 8]} e da ${words[(k * 3 + 1) % 8]}`)
    let t = rnd() < 0.6 ? 0 : Math.floor(rnd() * 3000)
    const sync = base.map(text => {
      const e = { text, time_ms: t }
      t += [0, 1, 400, 2500, 5000][Math.floor(rnd() * 5)]
      return e
    })
    const lines = base.slice()
    // Letra editada depois: linhas novas (também no topo), secções, vazias, linhas tiradas
    for (let e = Math.floor(rnd() * 4); e > 0; e--) {
      const at = rnd() < 0.4 ? 0 : Math.floor(rnd() * (lines.length + 1))
      const kind = rnd()
      lines.splice(at, 0, kind < 0.5 ? `Nova ${e} ${words[e % 8]}` : kind < 0.75 ? '[Refrão]' : '')
    }
    if (rnd() < 0.3 && lines.length > 3) lines.splice(1 + Math.floor(rnd() * (lines.length - 2)), 1)
    const s = parseStageLines(lines.join('\n'))
    const lastSync = sync[sync.length - 1].time_ms
    const dur = rnd() < 0.5 ? undefined : lastSync + 1000 + Math.floor(rnd() * 60000)
    const r = resolveStageTiming(s, sync, dur)
    if (!r.times) continue
    const max = Math.max(...r.times.filter(x => x != null))
    if (!increasing(r.times)) bad = ['a subir', lines, sync, r.times]
    else if (!lyricIdx(s).every(i => r.times[i] != null)) bad = ['letra com tempo', lines, sync, r.times]
    else if (!selfLit(s, r.times)) bad = ['acende a si própria', lines, sync, r.times]
    else if (!cueAtStart(s, r.times)) bad = ['cue', lines, sync, r.times]
    else if (dur && max >= dur) bad = ['duração', dur, lines, sync, r.times]
  }
  ok(!bad, 'aleatório: 1500 casos — tempos estritos, cada linha acende, cue no início, nunca depois do fim', bad)
})

test('refrões condensados em [Refrão] continuam sincronizados', () => {
  const chorus = [
    'Fica comigo até a noite acabar', 'Fica comigo, não há pressa de ir', 'Dança comigo no meio da rua',
    'Canta comigo a canção que é tua', 'Fica comigo até o sol voltar', 'Fica comigo, deixa-me ficar',
  ]
  const verse = n => [
    `[Verso ${n}]`, `Acordo cedo ${n} e o café arrefeceu`, `A rua inteira ${n} ainda a dormir`,
    `Levo o casaco ${n} que me deixaste`, `E o elétrico ${n} passa devagar`,
  ]
  const full = [...verse(1), '', '[Refrão]', ...chorus, '', ...verse(2), '',
    '[Refrão]', ...chorus, '', '[Refrão]', ...chorus, '', '[Refrão]', ...chorus].join('\n')
  const condensed = [...verse(1), '', '[Refrão]', ...chorus, '', ...verse(2), '',
    '[Refrão]', '', '[Refrão]', '', '[Refrão]'].join('\n')
  const sync = editorSync(full)
  const s = parseStageLines(condensed)
  ok(sync.length > 2 * lyricIdx(s).length, 'condensada: o sync tem mais do dobro das linhas da letra', [sync.length, lyricIdx(s).length])
  const r = resolveStageTiming(s, sync, 200000)
  eq(r.coverage, 1, 'condensada: cobertura 1 (todas as linhas da letra têm par)')
  eq(r.mode, 'match', 'condensada: continua sincronizada (não fica "SYNC DESATUALIZADO")')
  const tOf = text => sync.find(e => e.text === text).time_ms
  const v2 = 'A rua inteira 2 ainda a dormir'
  eq(r.timeByLine[s.findIndex(l => l.text === v2)], tOf(v2), 'condensada: verso 2 no seu tempo')
  ok(increasing(r.times), 'condensada: tempos a subir', r.times)
  // Editor de sync (as mesmas linhas sem vazias): restaura pelo TEXTO, não pela posição
  const raw = condensed.split('\n').filter(l => l.trim())
  const em = mapSyncToLyrics(parseStageLines(raw.join('\n')), sync)
  ok(em.coverage >= 0.5, 'condensada (editor): cobertura ≥ 0.5 → restaura pelo texto', em.coverage)
  eq(em.timeByLine[0], null, 'condensada (editor): [Verso 1] sem tempo (não herda o da linha seguinte)')
  eq(em.timeByLine[1], tOf('Acordo cedo 1 e o café arrefeceu'), 'condensada (editor): cada linha com o seu tempo')
})

test('cobertura no lado menor não aceita a letra de outra música', () => {
  const s = parseStageLines('Uma letra curtinha de outra canção\nCom duas linhas só')
  const r = resolveStageTiming(s, editorSync(LYRICS))
  ok(r.coverage < 0.5, 'outra (curta): cobertura baixa', r.coverage)
  eq(r.mode, 'none', 'outra (curta): sem sync')
  const big = parseStageLines(LYRICS)
  const other = editorSync('Outra canção sem nada a ver\nCom versos que não existem aqui')
  ok(mapSyncToLyrics(big, other).coverage < 0.5, 'outra (sync curto): cobertura baixa')
})

test('a última linha nunca passa da duração (sync parcial)', () => {
  const stanza = k => [
    `Estrofe ${k} primeira linha bonita`, `Estrofe ${k} segunda linha triste`, `Estrofe ${k} terceira linha alegre`,
    `Estrofe ${k} quarta linha final`, `Estrofe ${k} quinta linha extra`,
  ]
  const ballad = Array.from({ length: 10 }, (_, k) => stanza(k + 1).join('\n')).join('\n\n')
  const s = parseStageLines(ballad)
  eq(s.length, 59, 'duração: 10 estrofes, 59 linhas de palco')
  const sync = stanza(1).slice(0, 4).map((text, i) => ({ text, time_ms: 20000 + i * 6000 }))
  const r = resolveStageTiming(s, sync, 180000)
  eq(r.mode, 'match', 'duração: sync parcial emparelhada')
  eq(r.times.slice(0, 4), [20000, 26000, 32000, 38000], 'duração: as linhas sincronizadas ficam no seu tempo')
  const max = Math.max(...r.times.filter(t => t != null))
  ok(max < 180000, 'duração: a última linha fica antes do fim da música', max)
  ok(increasing(r.times), 'duração: tempos a subir', r.times)
  const noDur = resolveStageTiming(s, sync)
  ok(Math.max(...noDur.times.filter(t => t != null)) > 180000, 'duração: sem duração, segue o passo médio')
  // Ficha com duração mais curta do que a sync (aproximada): o passo não encolhe
  const short = resolveStageTiming(s, sync, 30000)
  eq(short.times[4], 44000, 'duração: mais curta do que a sync → passo médio')
  const tbl = [null, null, 10000, null, 14000, null, null]
  eq(timeForLine(5, tbl, 17000), 15000, 'timeForLine: o passo encolhe para caber na duração')
  eq(timeForLine(6, tbl, 17000), 16000, 'timeForLine: … a última antes do fim')
  eq(timeForLine(5, tbl, 100000), 16000, 'timeForLine: duração folgada → passo médio')
})

test('desempenho: 400 linhas × 400 entradas', () => {
  const base = LYRICS.split('\n')
  const big = Array.from({ length: 17 }, (_, k) => base.map(l => (l.trim() && !l.startsWith('[') ? `${l} ${k}` : l)).join('\n')).join('\n\n')
  const s = parseStageLines(big)
  const sync = editorSync(big)
  const t0 = performance.now()
  const r = resolveStageTiming(s, sync)
  const ms = performance.now() - t0
  ok(s.length >= 400 && sync.length >= 250, 'desempenho: tamanho do teste', [s.length, sync.length])
  eq(r.coverage, 1, 'desempenho: cobertura 1')
  ok(ms < 1500, `desempenho: ${ms.toFixed(0)} ms`, ms)
})

/* ═══ 8. revisão: sync sem letra, indentação, símbolos, editor, CR ═══ */
test('sem letra escrita mas com sync: o palco desenha as linhas do sync', () => {
  const sync = [
    { text: 'Primeiro verso inventado', time_ms: 8000 }, { text: 'Segundo verso inventado', time_ms: 12000 },
    { text: '', time_ms: 15000 }, { text: 'Terceiro verso inventado', time_ms: 20000 }, { text: '', time_ms: 26000 },
  ]
  eq(stageLyricsText('', sync), 'Primeiro verso inventado\nSegundo verso inventado\n\nTerceiro verso inventado\n',
    'sem letra: texto = linhas do sync pela ordem')
  eq(stageLyricsText(null, sync), stageLyricsText('', sync), 'sem letra: null = vazia')
  eq(stageLyricsText(' \n \r\n', sync), stageLyricsText('', sync), 'sem letra: só espaços conta como vazia')
  eq(stageLyricsText('Letra escrita', sync), 'Letra escrita', 'com letra: a letra escrita manda sempre')
  eq(stageLyricsText('', []), '', 'sem letra e sync vazio: vazio')
  eq(stageLyricsText('', null), '', 'sem letra e sem sync: vazio')
  const s = parseStageLines(stageLyricsText('', sync))
  eq(kinds(s), 'llbl', 'sem letra: pausa do meio → vazia; a do fim sai')
  const r = resolveStageTiming(s, sync)
  eq(r.mode, 'match', 'sem letra: emparelhada')
  eq(r.coverage, 1, 'sem letra: cobertura 1')
  eq(r.timeByLine, [8000, 12000, 15000, 20000], 'sem letra: cada linha com o seu tempo')
})

test('indentação: colunas (TAB → paragem de 4)', () => {
  const s = parseStageLines('Sem recuo\n  Dois espaços\n    Quatro espaços\n\tUm tab\n  \tEspaços e tab\n\t  Tab e espaços\n \u00A0Espaço duro\n[Refrão]\n')
  eq(s.map(l => l.indent), [0, 2, 4, 4, 4, 6, 2, 0], 'indent: colunas por linha')
  eq(s.map(l => l.text.trimStart()), [
    'Sem recuo', 'Dois espaços', 'Quatro espaços', 'Um tab', 'Espaços e tab', 'Tab e espaços', 'Espaço duro', '[Refrão]',
  ], 'indent: o texto desenhado sai sem a indentação')
  eq(s[3].text, '\tUm tab', 'indent: text continua como foi escrito')
  eq(parseStageLines('\uFEFFLinha com BOM')[0].indent, 0, 'indent: BOM no início não conta')
  eq(parseStageLines('Um\n\n  \nDois').map(l => [l.kind, l.indent]), [
    ['lyric', 0], ['blank', 0], ['blank', 0], ['lyric', 0],
  ], 'indent: vazias (mesmo só com espaços) com 0')
})

test('linhas só de símbolos não roubam tempo nem passos', () => {
  const text = 'Linha alfa do mar\n—\nLinha beta do sol\n...\nLinha gama da rua'
  const s = parseStageLines(text)
  eq(kinds(s), 'lmlml', 'símbolos: tipo mark')
  eq(s[1].text, '—', 'símbolos: desenhados como foram escritos')
  const sync = [
    { text: 'Linha alfa do mar', time_ms: 10000 }, { text: 'Linha beta do sol', time_ms: 14000 },
    { text: 'Linha gama da rua', time_ms: 18000 },
  ]
  const r = resolveStageTiming(s, sync)
  eq(r.mode, 'match', 'símbolos: emparelhada')
  eq(r.coverage, 1, 'símbolos: não contam para a cobertura')
  eq(r.times, [10000, null, 14000, null, 18000], 'símbolos: sem tempo próprio (a alfa fica acesa até à beta)')
  eq(activeLineAt(13000, r.times), 0, 'símbolos: a 13 s continua a alfa')
  eq(nextLyricLine(s, 0), 2, 'símbolos: › salta o "—"')
  eq(prevLyricLine(s, 4), 2, 'símbolos: ‹ salta o "..."')
  const lead = parseStageLines('...\nLinha alfa do mar\nLinha beta do sol')
  eq(nextLyricLine(lead, -1), 1, 'símbolos: a entrada (cue) é a 1.ª linha cantada, não o "..."')
  const rl = resolveStageTiming(lead, sync.slice(0, 2))
  eq(rl.times[0], null, 'símbolos: o "..." inicial não tem tempo estimado')
  // A sync marcou o "—" (o cantor tocou nele no editor): fica com esse tempo
  const marked = resolveStageTiming(s, [
    sync[0], { text: '—', time_ms: 12000 }, sync[1], sync[2],
  ])
  eq(marked.times, [10000, 12000, 14000, null, 18000], 'símbolos: com tempo da sync, acende')
  eq(nextLyricLine(s, 1), 2, 'símbolos: mesmo com tempo, › vai para a linha cantada')
  const m = mapSyncToLyrics(s, [sync[0], { text: '...', time_ms: 12000 }, sync[1], sync[2]])
  eq(m.lineBySync, [0, -1, 2, 4], 'símbolos: "..." da sync não emparelha com o "—"')
  eq(mapSyncByOrder(s, sync)?.timeByLine, [10000, null, 14000, null, 18000], 'símbolos: por ordem só conta letra')
  eq(parseStageLines('♪\n(...)\n- -\nOh oh').map(l => l.kind), ['mark', 'mark', 'mark', 'lyric'], 'símbolos: ♪, (...), - - são mark; "Oh oh" é letra')
})

test('editor: tempos repetidos ou fora de ordem ficam à vista', () => {
  const lines = ['Um um um', 'Dois dois', 'Tres tres']
  eq(restoreSyncTimes(lines, [
    { text: 'Um um um', time_ms: 0 }, { text: 'Dois dois', time_ms: 0 }, { text: 'Tres tres', time_ms: 5000 },
  ]), [0, 0, 5000], 'editor: dois toques a 0 → ambos mantidos')
  eq(restoreSyncTimes(lines, [
    { text: 'Um um um', time_ms: 3000 }, { text: 'Dois dois', time_ms: 9000 }, { text: 'Tres tres', time_ms: 6000 },
  ]), [3000, 9000, 6000], 'editor: tempo fora de ordem mantido (para corrigir)')
  // O palco continua a filtrar o que anda para trás
  eq(mapSyncToLyrics(parseStageLines(lines.join('\n')), [
    { text: 'Um um um', time_ms: 3000 }, { text: 'Dois dois', time_ms: 9000 }, { text: 'Tres tres', time_ms: 6000 },
  ]).timeByLine, [3000, null, 6000], 'palco: o tempo fora de ordem continua fora')
  eq(restoreSyncTimes(['Nova linha', ...lines], [
    { text: 'Um um um', time_ms: 1000 }, { text: 'Tres tres', time_ms: 3000 },
  ]), [null, 1000, null, 3000], 'editor: pelo texto (linha nova e linha sem toque sem tempo)')
  eq(restoreSyncTimes(['Outra canção um', 'Outra canção dois'], [
    { text: 'Nada a ver aqui', time_ms: 1000 }, { text: 'Coisa diferente', time_ms: 2000 },
  ]), [1000, 2000], 'editor: sync de outra letra → por posição')
  eq(restoreSyncTimes(lines, [
    { text: 'Um um um', time_ms: -5 }, { text: 'Dois dois', time_ms: 'x' }, { text: 'Tres tres', time_ms: 5000 },
  ]), [null, null, 5000], 'editor: tempos inválidos → sem tempo')
  eq(restoreSyncTimes(lines, null), [null, null, null], 'editor: sem sync')
  eq(restoreSyncTimes([], [{ text: 'Um um um', time_ms: 0 }]), [], 'editor: sem linhas')
})

test('fim de linha com \\r sozinho: palco e editor partem igual', () => {
  const text = 'Um verso\rDois versos\r\rTres versos'
  const s = parseStageLines(text)
  eq(kinds(s), 'llbl', 'CR: 4 linhas de palco')
  eq(s.map(l => l.src), [0, 0, 0, 0], 'CR: src é o da linha partida por \\n (LyricsView)')
  const mixed = parseStageLines('A primeira\nB segunda\rC terceira\r\nD quarta\r\r\nE quinta')
  eq(mixed.map(l => [l.text, l.src]), [
    ['A primeira', 0], ['B segunda', 1], ['C terceira', 1], ['D quarta', 2], ['', 2], ['E quinta', 3],
  ], 'CR: \\n, \\r, \\r\\n e \\r\\r\\n misturados')
  // Como o editor parte a letra (SyncEditorPage): as mesmas linhas não vazias
  const editorLines = text.split(/\r\n?|\n/).filter(l => l.trim())
  eq(editorLines, s.filter(l => l.kind !== 'blank').map(l => l.text), 'CR: editor = palco')
  const sync = editorLines.map((t, i) => ({ text: t, time_ms: 1000 + i * 1000 }))
  const r = resolveStageTiming(s, sync)
  eq([r.mode, r.coverage], ['match', 1], 'CR: sincronizar no editor não deixa a sync desatualizada')
  eq(restoreSyncTimes(editorLines, sync), [1000, 2000, 3000], 'CR: o editor reabre com os tempos')
})

/* ── resultado ── */
for (const f of failures) console.log(f)
console.log(`\n${pass} ok · ${fail} falharam`)
process.exit(fail ? 1 : 0)
