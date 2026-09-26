export interface PdfSongItem {
  title: string
  lyrics?: string | null
}

export interface PdfExportOptions {
  title: string
  accent?: string | null
  logoUrl?: string | null
  logoInitial?: string | null
  withLyrics?: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Abre uma janela de impressão com a lista de músicas (só títulos, ou título +
 * letra completa por página quando withLyrics). Devolve false se o pop-up foi
 * bloqueado — o chamador deve avisar o utilizador e permitir tentar de novo.
 */
export function exportSongsPdf(songs: PdfSongItem[], opts: PdfExportOptions): boolean {
  const accent = opts.accent ?? '#FF4D6D'
  const logoBlock = opts.logoUrl
    ? `<img class="logo" src="${esc(opts.logoUrl)}" alt="" />`
    : opts.logoInitial
      ? `<div class="logoInitial">${esc(opts.logoInitial.charAt(0).toUpperCase())}</div>`
      : ''

  const rows = opts.withLyrics
    ? songs.map((s, i) => {
        const lyrics = (s.lyrics ?? '').replace(/\r\n/g, '\n').trim()
        return `
      <div class="songBlock">
        <div class="song">
          <span class="num">${i + 1}</span>
          <span class="title">${esc(s.title)}</span>
        </div>
        ${lyrics ? `<div class="lyrics">${esc(lyrics)}</div>` : '<div class="noLyrics">— sem letra —</div>'}
      </div>`
      }).join('')
    : songs.map((s, i) => `
      <div class="song">
        <span class="num">${i + 1}</span>
        <span class="title">${esc(s.title)}</span>
      </div>`
    ).join('')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
      <style>
        @page { size: A4; margin: 18mm 20mm; }
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, 'Segoe UI', sans-serif;
          color: #111; margin: 0; text-align: center;
        }
        .toolbar {
          position: sticky; top: 0; display: flex; gap: 10px; justify-content: flex-end;
          padding: 10px 16px 10px; background: #fff; border-bottom: 1px solid #eee;
        }
        .toolbar button {
          font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
          padding: 9px 20px; border-radius: 10px; border: 1px solid #ccc; background: #f5f5f5;
        }
        .toolbar .print { background: ${accent}; border-color: ${accent}; color: #fff; }
        .header {
          padding: 14px 0 10px;
          display: flex; align-items: center; justify-content: center; gap: 16px;
        }
        .logo { width: 64px; height: 64px; border-radius: 14px; object-fit: cover; flex-shrink: 0; }
        .logoInitial {
          width: 64px; height: 64px; border-radius: 14px; flex-shrink: 0;
          background: ${accent}; color: #fff;
          font-size: 28px; font-weight: 900;
          display: flex; align-items: center; justify-content: center;
        }
        .headerText { text-align: left; }
        .concertName { font-size: 22px; font-weight: 900; letter-spacing: -0.3px; line-height: 1.2; }
        .divider { width: 36px; height: 2.5px; background: ${accent}; border: none; border-radius: 2px; margin: 10px auto; }
        .songs { padding: 0; }
        .song {
          display: flex; align-items: baseline; justify-content: center; gap: 7px;
          padding: 2px 0;
          page-break-inside: avoid;
        }
        .num { font-size: 11px; color: #bbb; font-weight: 700; min-width: 18px; text-align: right; flex-shrink: 0; }
        .title { font-size: 17px; font-weight: 700; }
        .songBlock { page-break-before: always; padding-top: 6px; }
        .songBlock:first-child { page-break-before: auto; }
        .lyrics {
          white-space: pre-wrap; font-size: 13.5px; line-height: 1.55;
          margin-top: 10px; text-align: center;
        }
        .noLyrics { margin-top: 10px; font-size: 12px; color: #bbb; font-style: italic; }
        @media print { .toolbar { display: none; } }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.close()">✕ Fechar</button>
        <button class="print" onclick="window.print()">🖨 Imprimir / PDF</button>
      </div>
      <div class="header">
        ${logoBlock}
        <div class="headerText">
          <div class="concertName">${esc(opts.title)}</div>
        </div>
      </div>
      <hr class="divider" />
      <div class="songs">${rows}</div>
      <script>
        window.onload = () => {
          const img = document.querySelector('img.logo')
          const go = () => setTimeout(() => window.print(), 100)
          if (img && !img.complete) {
            let done = false
            const once = () => { if (!done) { done = true; go() } }
            img.onload = once; img.onerror = once
            setTimeout(once, 1500)
          } else go()
        }
      <\/script>
      </body></html>`

  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  return true
}
