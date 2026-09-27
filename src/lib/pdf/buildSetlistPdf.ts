/**
 * Construtor PURO dos PDFs de concerto: buildSetlistPdf(data, options, fonts) → jsPDF.
 * Sem React, sem DOM, sem I/O — as fontes entram em base64. Corre igual no
 * browser (src/lib/pdfExport.ts) e em Node (scripts/pdf-shots.mjs).
 */
import { jsPDF } from 'jspdf'
import { FAMILY, Painter } from './painter'
import { drawFooters } from './chrome'
import { renderAlinhamento } from './alinhamento'
import { renderRepertorio } from './repertorio'
import { palette, projectColor } from './theme'
import { clean, pad2, setCoverage } from './text'
import { PDF_FONT_FILES, pdfKindName, type PdfData, type PdfFonts, type PdfOptions } from './types'

function registerFonts(doc: jsPDF, fonts: PdfFonts) {
  (Object.keys(PDF_FONT_FILES) as (keyof PdfFonts)[]).forEach(role => {
    const file = PDF_FONT_FILES[role]
    doc.addFileToVFS(file, fonts[role])
    doc.addFont(file, FAMILY[role], 'normal')
  })
}

export function buildSetlistPdf(data: PdfData, options: PdfOptions, fonts: PdfFonts): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true, putOnlyUsedFonts: true })
  registerFonts(doc, fonts)

  // Cobertura real das fontes (cmap) — o que não existe é limpo antes de desenhar
  doc.setFont(FAMILY.body, 'normal')
  const codeMap = (doc.getFont() as unknown as { metadata?: { cmap?: { unicode?: { codeMap?: Record<number, number> } } } })
    .metadata?.cmap?.unicode?.codeMap
  setCoverage(codeMap ? (code: number) => code === 32 || !!codeMap[code] : null)

  try {
    const pal = palette(options.theme)
    const p = new Painter(doc, pal)
    const ledColor = data.meta.subtitle?.trim() ? projectColor(data.meta.color) : null
    const title = clean(data.meta.title).trim() || 'Sem título'
    const kindName = pdfKindName(options.kind, data.meta.context)

    if (options.kind === 'alinhamento') {
      renderAlinhamento(p, data, ledColor, !!options.titlesOnly)
      drawFooters(p, `${kindName} · ${title}`, new Set())
    } else {
      const layout = renderRepertorio(p, data, options, ledColor)
      drawFooters(p, `${kindName} · ${title}`, layout.continues)
      // Marcadores do PDF: um por música "07 · Título"
      doc.outline.add(null, 'Índice', { pageNumber: 1 })
      data.songs.forEach((s, i) => {
        const pg = layout.songPages[i]
        if (pg) doc.outline.add(null, `${pad2(i + 1)} · ${clean(s.title).trim() || 'Sem título'}`, { pageNumber: pg })
      })
    }

    doc.setPage(1)
    doc.setDocumentProperties({
      title: `${title} — ${kindName}`,
      subject: data.meta.subtitle ? clean(data.meta.subtitle) : undefined,
      creator: 'Gigio',
    })
    doc.setLanguage('pt')
    // Abre à largura da página, em scroll contínuo (tablet)
    doc.setDisplayMode('fullwidth', 'continuous')
    return doc
  } finally {
    setCoverage(null)
  }
}
