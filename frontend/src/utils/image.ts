export const MAX_SIDE_PX = 1280
export const JPEG_QUALITY = 0.9
export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const ALLOWED_TYPES = ['image/jpeg', 'image/png']

export type PrepareResult = { ok: true; image: Blob } | { ok: false; error: string }

const fail = (error: string): PrepareResult => ({ ok: false, error })

// Scales down (never up) so the longest side is at most MAX_SIDE_PX, and encodes as JPEG
async function encodeJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<PrepareResult> {
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) return fail('No se pudo procesar la imagen.')

  // JPEG has no transparency: paint white first so a transparent PNG does not turn black
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
  if (!blob) return fail('No se pudo procesar la imagen.')
  if (blob.size > MAX_UPLOAD_BYTES) return fail('La imagen procesada supera los 5 MB.')
  return { ok: true, image: blob }
}

export async function prepareFile(file: Blob): Promise<PrepareResult> {
  if (!ALLOWED_TYPES.includes(file.type)) return fail('Formato no permitido. Usa JPEG o PNG.')
  if (file.size > MAX_ORIGINAL_BYTES) return fail('La imagen supera los 20 MB.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return fail('No se pudo leer la imagen.')
  }
  try {
    return await encodeJpeg(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

export function prepareCanvas(canvas: HTMLCanvasElement): Promise<PrepareResult> {
  return encodeJpeg(canvas, canvas.width, canvas.height)
}
