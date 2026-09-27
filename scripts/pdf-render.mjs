/**
 * Renderiza as páginas de um PDF para PNG (pdf.js no Chromium do sistema).
 * Uso: node scripts/pdf-render.mjs <ficheiro.pdf> <pasta-destino> [maxPaginas] [escala]
 */
import { chromium } from 'playwright-core'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const [pdfPath, outDir, maxPagesArg, scaleArg] = process.argv.slice(2)
if (!pdfPath || !outDir) { console.error('uso: pdf-render.mjs <pdf> <out> [max] [escala]'); process.exit(1) }
const maxPages = Number(maxPagesArg ?? 12)
const scale = Number(scaleArg ?? 1.5)
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
  for (let i = 1; i <= n; i++) {
    const p = await doc.getPage(i)
    const vp = p.getViewport({ scale })
    const c = document.createElement('canvas')
    c.id = `p${i}`; c.width = vp.width; c.height = vp.height; c.style.display = 'block'
    document.body.appendChild(c)
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
  }
  const outline = await doc.getOutline()
  window.__meta = { pages: doc.numPages, outline: (outline || []).map(o => o.title) }
  return n
}, { worker, data, maxPages, scale })
const base = path.basename(pdfPath, '.pdf')
for (let i = 1; i <= count; i++) {
  await page.locator(`#p${i}`).screenshot({ path: path.join(outDir, `${base}-p${String(i).padStart(2, '0')}.png`) })
}
const meta = await page.evaluate(() => window.__meta)
console.log(JSON.stringify({ file: base, rendered: count, ...meta }))
await browser.close()
