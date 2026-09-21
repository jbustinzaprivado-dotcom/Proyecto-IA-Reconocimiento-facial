import { describe, expect, it } from 'vitest'
import { MAX_ORIGINAL_BYTES, prepareFile } from './image'

// jsdom has no canvas or createImageBitmap, so the resize and JPEG encoding are covered by the
// browser checks (F7). Here we cover what happens before decoding.
describe('prepareFile', () => {
  it('rejects formats other than JPEG and PNG', async () => {
    const result = await prepareFile(new Blob(['hola'], { type: 'text/plain' }))
    expect(result).toEqual({ ok: false, error: 'Formato no permitido. Usa JPEG o PNG.' })
  })

  it('rejects an original file larger than 20 MB', async () => {
    const huge = new Blob([new Uint8Array(MAX_ORIGINAL_BYTES + 1)], { type: 'image/png' })
    expect(await prepareFile(huge)).toEqual({ ok: false, error: 'La imagen supera los 20 MB.' })
  })

  it('accepts exactly 20 MB and then reports an unreadable image, because it cannot be decoded here', async () => {
    const limit = new Blob([new Uint8Array(MAX_ORIGINAL_BYTES)], { type: 'image/png' })
    expect(await prepareFile(limit)).toEqual({ ok: false, error: 'No se pudo leer la imagen.' })
  })
})
