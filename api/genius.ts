import type { VercelRequest, VercelResponse } from '@vercel/node'

const TOKEN = process.env.GENIUS_TOKEN ?? ''
const BASE = 'https://api.genius.com'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!TOKEN) {
    return res.status(503).json({ error: 'Genius token not configured' })
  }

  const path = (req.query.path as string) ?? ''
  const q = req.query.q as string

  try {
    if (path === 'search') {
      const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q ?? '')}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const data = await r.json()
      return res.json(data)
    }

    if (path === 'lyrics') {
      const id = req.query.id as string
      const r = await fetch(`${BASE}/songs/${id}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const data = await r.json()
      const url = data.response?.song?.url
      if (!url) return res.status(404).json({ error: 'Not found' })

      const page = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
      })
      const html = await page.text()
      const lyrics = extractLyrics(html)
      return res.json({ lyrics })
    }

    return res.status(400).json({ error: 'Unknown path' })
  } catch (err) {
    return res.status(500).json({ error: String(err) })
  }
}

// Extrai o conteúdo de uma <div ...> com balanceamento de divs aninhados.
// startContent = índice imediatamente após o '>' da tag de abertura.
function extractBalancedDiv(html: string, startContent: number): { content: string; end: number } {
  let depth = 1
  let i = startContent
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      if (depth === 0) return { content: html.slice(startContent, nextClose), end: nextClose + 6 }
      i = nextClose + 6
    }
  }
  return { content: html.slice(startContent, i), end: i }
}

function extractLyrics(html: string): string {
  const blocks: string[] = []
  const marker = 'data-lyrics-container="true"'
  let searchFrom = 0

  while (true) {
    const attrIdx = html.indexOf(marker, searchFrom)
    if (attrIdx === -1) break
    const tagEnd = html.indexOf('>', attrIdx)
    if (tagEnd === -1) break
    const { content, end } = extractBalancedDiv(html, tagEnd + 1)
    blocks.push(content)
    searchFrom = end
  }

  return blocks
    .map(block => cleanBlock(block))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanBlock(block: string): string {
  // Remove blocos de cabeçalho/contribuidores (data-exclude-from-selection), com aninhamento.
  let cleaned = block
  while (true) {
    const idx = cleaned.indexOf('data-exclude-from-selection="true"')
    if (idx === -1) break
    const divStart = cleaned.lastIndexOf('<div', idx)
    const tagEnd = cleaned.indexOf('>', idx)
    if (divStart === -1 || tagEnd === -1) break
    const { end } = extractBalancedDiv(cleaned, tagEnd + 1)
    cleaned = cleaned.slice(0, divStart) + cleaned.slice(end)
  }

  return cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
}
