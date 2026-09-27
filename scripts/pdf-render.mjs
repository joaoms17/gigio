/**
 * Renderiza as páginas de um PDF para PNG (pdf.js no Chromium do sistema).
 * Uso: node scripts/pdf-render.mjs <ficheiro.pdf> <pasta-destino> [maxPaginas] [escala]
 *
 * Variáveis de ambiente:
 *   PDF_SHEET=<colunas>  também gera folhas de contacto "<nome>-sheet-01.png"
 *                        (miniaturas de todas as páginas, <colunas> por linha, 2 linhas por folha)
 *   PDF_PAGES=0          não grava uma PNG por página (útil com PDF_SHEET)
 *
 * Imprime no fim uma linha JSON com: páginas, marcadores, links internos por
 * página e `lines` — nº de linhas de texto na zona de conteúdo de cada página
 * (sem barra de topo nem rodapé), para apanhar páginas quase vazias.
 */
import { chromium } from 'playwright-core'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const [pdfPath, outDir, maxPagesArg, scaleArg] = process.argv.slice(2)
if (!pdfPath || !outDir) { console.error('uso: pdf-render.mjs <pdf> <out> [max] [escala]'); process.exit(1) }
const maxPages = Number(maxPagesArg ?? 12)
const scale = Number(scaleArg ?? 1.5)
const sheetCols = Number(process.env.PDF_SHEET ?? 0)
const writePages = process.env.PDF_PAGES !== '0'
const root = path.resolve(import.meta.dirname, '..')
const pdfjs = await readFile(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.js'), 'utf8')
const worker = await readFile(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.js'), 'utf8')
const data = (await readFile(pdfPath)).toString('base64')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } })
await page.setContent('<html><body style="margin:0;background:#888"></body></html>')
await page.addScriptTag({ content: pdfjs })
const count = await page.evaluate(async ({ worker, data, maxPages, scale }) => {
  const blob = new Blob([worker], { type: 'text/javascript' })
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise
  const n = Math.min(doc.numPages, maxPages)
  // Links internos por página renderizada: páginas de destino
  const links = {}
  const lines = []
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i)
    // Linhas de texto (baselines distintas) entre a barra de topo e o rodapé
    const [, , , H] = p.view
    const tc = await p.getTextContent()
    const ys = new Set()
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue
      const top = H - it.transform[5]
      if (top > 58 && top < H - 40) ys.add(Math.round(top / 3))
    }
    lines.push(ys.size)
    if (i > n) continue
    const annots = (await p.getAnnotations()).filter(a => a.subtype === 'Link' && a.dest)
    if (annots.length) {
      const targets = []
      for (const a of annots) {
        const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest
        targets.push(dest && dest[0] ? (await doc.getPageIndex(dest[0])) + 1 : null)
      }
      links[i] = targets
    }
    const vp = p.getViewport({ scale })
    const c = document.createElement('canvas')
    c.id = `p${i}`; c.width = vp.width; c.height = vp.height; c.style.display = 'block'
    document.body.appendChild(c)
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
  }
  const outline = await doc.getOutline()
  window.__meta = { pages: doc.numPages, outline: (outline || []).map(o => o.title), links, lines }
  return n
}, { worker, data, maxPages, scale })
const base = path.basename(pdfPath, '.pdf')
if (writePages) {
  for (let i = 1; i <= count; i++) {
    await page.locator(`#p${i}`).screenshot({ path: path.join(outDir, `${base}-p${String(i).padStart(2, '0')}.png`) })
  }
}
if (sheetCols > 0) {
  // Folhas de contacto: miniaturas com o nº da página por baixo
  const perSheet = sheetCols * 2
  const sheets = Math.ceil(count / perSheet)
  for (let s = 0; s < sheets; s++) {
    await page.evaluate(({ s, perSheet, cols, count }) => {
      document.getElementById('sheet')?.remove()
      const thumbW = 300
      const first = document.getElementById('p1')
      const thumbH = Math.round(thumbW * first.height / first.width)
      const gap = 14
      const label = 22
      const nOn = Math.min(perSheet, count - s * perSheet)
      const rows = Math.ceil(nOn / cols)
      const c = document.createElement('canvas')
      c.id = 'sheet'
      c.width = cols * thumbW + (cols + 1) * gap
      c.height = rows * (thumbH + label) + (rows + 1) * gap
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#777'
      ctx.fillRect(0, 0, c.width, c.height)
      for (let k = 0; k < nOn; k++) {
        const i = s * perSheet + k + 1
        const src = document.getElementById(`p${i}`)
        const x = gap + (k % cols) * (thumbW + gap)
        const y = gap + Math.floor(k / cols) * (thumbH + label + gap)
        ctx.fillStyle = '#fff'
        ctx.fillRect(x, y, thumbW, thumbH)
        ctx.drawImage(src, x, y, thumbW, thumbH)
        ctx.fillStyle = '#000'
        ctx.font = 'bold 16px monospace'
        ctx.fillText(`p${i}`, x, y + thumbH + 17)
      }
      c.style.display = 'block'
      document.body.prepend(c)
    }, { s, perSheet, cols: sheetCols, count })
    await page.locator('#sheet').screenshot({ path: path.join(outDir, `${base}-sheet-${String(s + 1).padStart(2, '0')}.png`) })
  }
}
const meta = await page.evaluate(() => window.__meta)
console.log(JSON.stringify({ file: base, rendered: count, ...meta }))
await browser.close()
