import type { VercelRequest, VercelResponse } from '@vercel/node'

// Proxy só para a Search API oficial do Genius (esconde o token).
// As letras NÃO vêm daqui — o Genius bloqueia scraping de datacenter (403).
// A app busca as letras via lyrics.ovh.
const TOKEN = process.env.GENIUS_TOKEN ?? ''
const BASE = 'https://api.genius.com'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!TOKEN) {
    return res.status(503).json({ error: 'Genius token not configured' })
  }

  const path = (req.query.path as string) ?? ''

  try {
    if (path === 'search') {
      const q = (req.query.q as string) ?? ''
      const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const data = await r.json()
      return res.json(data)
    }
    return res.status(400).json({ error: 'Unknown path' })
  } catch (err) {
    return res.status(500).json({ error: String(err) })
  }
}
