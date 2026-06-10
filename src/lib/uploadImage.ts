import { supabase } from './supabase'

/** Resize an image file to maxSize (longest edge) and return a JPEG blob. */
function resizeImage(file: File, maxSize = 640): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Falha ao processar imagem'))),
        'image/jpeg',
        0.85
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')) }
    img.src = url
  })
}

/** Upload a project image and return its public URL. */
export async function uploadProjectImage(projectId: string, file: File): Promise<string> {
  const blob = await resizeImage(file)
  const path = `${projectId}.jpg`
  const { error } = await supabase.storage
    .from('project-images')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  const { data } = supabase.storage.from('project-images').getPublicUrl(path)
  // cache-bust so the new image shows immediately after replacing
  return `${data.publicUrl}?t=${Date.now()}`
}
