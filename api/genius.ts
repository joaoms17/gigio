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
      // Get song URL from Genius API
      const r = await fetch(`${BASE}/songs/${id}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const data = await r.json()
      const url = data.response?.song?.url
      if (!url) return res.status(404).json({ error: 'Not found' })

      // Scrape lyrics from genius.com page
      const page = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GigioBot/1.0)',
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

function extractLyrics(html: string): string {
  const matches = html.match(/data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g) ?? []
  return matches
    .map(block =>
      block
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
    )
    .join('\n')
    .trim()
}
