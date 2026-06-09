// lyrics.ovh — API grátis de letras (plain), sem chave, funciona server e client.
export async function getLyricsOvh(artist: string, title: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
    )
    if (!res.ok) return ''
    const data = await res.json()
    let lyrics: string = data.lyrics ?? ''
    return lyrics
      .replace(/\r\n/g, '\n')
      .replace(/^Paroles de.*\n/i, '') // remove cabeçalho francês ocasional
      .replace(/''/g, "'") // corrige aspas duplicadas dos dados
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  } catch {
    return ''
  }
}
