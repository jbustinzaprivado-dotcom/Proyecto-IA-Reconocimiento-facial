import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CameraCapture from './CameraCapture'

const camera = vi.hoisted(() => ({ fails: false }))

// A stand-in for react-webcam: it reports the camera as ready, or as unavailable
vi.mock('react-webcam', () => ({
  default: function FakeWebcam({
    onUserMedia,
    onUserMediaError,
  }: {
    onUserMedia?: () => void
    onUserMediaError?: () => void
  }) {
    // Reports once: the callbacks are new functions on every render of CameraCapture
    const reported = useRef(false)
    useEffect(() => {
      if (reported.current) return
      reported.current = true
      if (camera.fails) onUserMediaError?.()
      else onUserMedia?.()
    }, [onUserMedia, onUserMediaError])
    return <video data-testid="webcam" />
  },
}))

// jsdom cannot decode images, so the conversion is replaced by one that depends on the file name
vi.mock('../utils/image', () => ({
  prepareFile: vi.fn(async (file: File) =>
    file.name.endsWith('.txt')
      ? { ok: false, error: 'Formato no permitido. Usa JPEG o PNG.' }
      : { ok: true, image: new Blob([file.name], { type: 'image/jpeg' }) },
  ),
  prepareCanvas: vi.fn(),
}))

const png = (name: string) => new File(['x'], name, { type: 'image/png' })

function upload(files: File[]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => {
  camera.fails = false
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

describe('CameraCapture: uploading files', () => {
  it('adds an uploaded image, shows the counter and reports the images', async () => {
    const onChange = vi.fn()
    render(<CameraCapture maxImages={3} onChange={onChange} />)
    expect(screen.getByText('0 de 3')).toBeTruthy()

    upload([png('a.png')])
    expect(await screen.findByText('1 de 3')).toBeTruthy()
    expect(screen.getByAltText('Imagen 1')).toBeTruthy()
    expect(onChange).toHaveBeenLastCalledWith([expect.any(Blob)])
  })

  it('reports the reason when a file is rejected and keeps the count', async () => {
    const onChange = vi.fn()
    render(<CameraCapture maxImages={3} onChange={onChange} />)
    upload([new File(['x'], 'nota.txt', { type: 'text/plain' })])

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Formato no permitido. Usa JPEG o PNG.',
    )
    expect(screen.getByText('0 de 3')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('discards the files beyond the limit, says so and disables the upload', async () => {
    render(<CameraCapture maxImages={2} onChange={vi.fn()} />)
    upload([png('a.png'), png('b.png'), png('c.png')])

    expect(await screen.findByText('2 de 2')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(
      'Máximo 2 imágenes: se descartaron las sobrantes.',
    )
    expect((document.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Capturar' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('removes an image and reports the rest', async () => {
    const onChange = vi.fn()
    render(<CameraCapture maxImages={3} onChange={onChange} />)
    upload([png('a.png'), png('b.png')])
    await screen.findByText('2 de 3')

    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 1' }))
    expect(screen.getByText('1 de 3')).toBeTruthy()
    expect(onChange).toHaveBeenLastCalledWith([expect.any(Blob)])
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('uses the singular label and a single-file input for one image, and the plural for several', () => {
    const { unmount } = render(<CameraCapture maxImages={1} onChange={vi.fn()} />)
    expect(screen.getByText('Subir imagen')).toBeTruthy()
    expect((document.querySelector('input[type=file]') as HTMLInputElement).multiple).toBe(false)
    unmount()

    render(<CameraCapture maxImages={3} onChange={vi.fn()} />)
    expect(screen.getByText('Subir imágenes')).toBeTruthy()
    expect((document.querySelector('input[type=file]') as HTMLInputElement).multiple).toBe(true)
  })

  it('accepts only JPEG and PNG in the file picker', () => {
    render(<CameraCapture maxImages={1} onChange={vi.fn()} />)
    expect((document.querySelector('input[type=file]') as HTMLInputElement).accept).toBe(
      'image/jpeg,image/png',
    )
  })
})

describe('CameraCapture: the camera', () => {
  it('shows the preview when the camera is available', () => {
    render(<CameraCapture maxImages={1} onChange={vi.fn()} />)
    expect(screen.getByTestId('webcam')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Capturar' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('explains that the camera is unavailable, disables Capturar and keeps the upload', () => {
    camera.fails = true
    render(<CameraCapture maxImages={1} onChange={vi.fn()} />)
    expect(
      screen.getByText('No se pudo acceder a la cámara. Puedes subir una imagen desde tu equipo.'),
    ).toBeTruthy()
    expect(screen.queryByTestId('webcam')).toBeNull()
    expect((screen.getByRole('button', { name: 'Capturar' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((document.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(false)
  })

  it('reports a capture failure when the preview cannot produce an image', async () => {
    render(<CameraCapture maxImages={1} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Capturar' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No se pudo capturar la imagen. Inténtalo de nuevo.',
    )
  })
})
