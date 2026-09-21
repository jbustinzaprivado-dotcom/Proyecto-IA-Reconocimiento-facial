import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import type { Person, RecognitionResult } from '../types/facial'
import Reconocimiento from './Reconocimiento'

vi.mock('../services/api', () => ({ recognize: vi.fn(), listPersons: vi.fn() }))
vi.mock('../components/CameraCapture', () => ({
  default: ({ onChange }: { maxImages: number; onChange: (images: Blob[]) => void }) => (
    <div>
      <button type="button" onClick={() => onChange([new Blob(['foto'], { type: 'image/jpeg' })])}>
        Agregar foto
      </button>
      <button type="button" onClick={() => onChange([])}>
        Quitar foto
      </button>
    </div>
  ),
}))

const match: RecognitionResult = {
  persona_id: 12,
  nombre: 'Carlos',
  similitud: 0.87,
  distancia: 0.26,
  umbral: 0.75,
  coincide: true,
  probabilidad_calibrada: 0.93,
  confianza: 'alta',
}

const person = (id: number, nombre: string, activo = true, rostros = 3): Person => ({
  id,
  nombre,
  email: `${nombre.toLowerCase()}@example.com`,
  activo,
  rostros,
  created_at: '2026-09-01T10:00:00Z',
  consentimiento_at: '2026-09-01T10:00:00Z',
  consentimiento_version: 'v1',
})

const people = [
  person(10, 'Ana Torres'),
  person(12, 'Carlos'),
  person(14, 'Inactivo', false),
  person(15, 'Sin fotos', true, 0),
]

const evaluationSwitch = () =>
  screen.getByRole('switch', { name: 'Modo evaluación' }) as HTMLInputElement

const expectedSelect = () =>
  screen.getByLabelText('¿Quién está frente a la cámara?') as HTMLSelectElement

const recognizeButton = () => screen.getByRole('button', { name: 'Reconocer' }) as HTMLButtonElement

beforeEach(() => {
  vi.mocked(api.recognize).mockReset()
  vi.mocked(api.listPersons).mockReset()
  vi.mocked(api.listPersons).mockResolvedValue({ success: true, resultado: people })
})

describe('Reconocimiento', () => {
  it('keeps Reconocer disabled until there is a photo', () => {
    render(<Reconocimiento />)
    expect(recognizeButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    expect(recognizeButton().disabled).toBe(false)
  })

  it('sends the captured image and shows the result with the notice', async () => {
    vi.mocked(api.recognize).mockResolvedValue({ success: true, resultado: match })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(recognizeButton())

    expect(await screen.findByRole('heading', { name: 'Carlos' })).toBeTruthy()
    expect(api.recognize).toHaveBeenCalledWith(expect.any(Blob))
    expect(screen.getByText('Coincide')).toBeTruthy()
    expect(
      screen.getByText(/no debe usarse como única base para decisiones importantes/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nueva consulta' })).toBeTruthy()
  })

  it('shows "Reconociendo…" and blocks the controls while it works', async () => {
    let finish: (value: Awaited<ReturnType<typeof api.recognize>>) => void = () => {}
    vi.mocked(api.recognize).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(recognizeButton())

    const working = await screen.findByRole('button', { name: 'Reconociendo…' })
    expect((working as HTMLButtonElement).disabled).toBe(true)
    // Blocked through the disabled fieldset: the button matches :disabled but its own property stays false
    expect(screen.getByRole('button', { name: 'Agregar foto' }).matches(':disabled')).toBe(true)

    finish({ success: true, resultado: match })
    expect(await screen.findByRole('heading', { name: 'Carlos' })).toBeTruthy()
    expect(recognizeButton().disabled).toBe(false)
  })

  it('shows the API error and offers a new query', async () => {
    vi.mocked(api.recognize).mockResolvedValue({
      success: false,
      error: 'No se pudo conectar con el servidor',
    })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(recognizeButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('No se pudo conectar con el servidor')
    expect(screen.getByRole('button', { name: 'Nueva consulta' })).toBeTruthy()
  })

  it('turns an unexpected exception into an error message and re-enables the button', async () => {
    vi.mocked(api.recognize).mockRejectedValue(new Error('boom'))
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(recognizeButton())

    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
    expect(recognizeButton().disabled).toBe(false)
  })

  it('clears the previous result when the photo changes', async () => {
    vi.mocked(api.recognize).mockResolvedValue({ success: true, resultado: match })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(recognizeButton())
    await screen.findByRole('heading', { name: 'Carlos' })

    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }))
    expect(screen.queryByRole('heading', { name: 'Carlos' })).toBeNull()
    expect(recognizeButton().disabled).toBe(true)
  })

  it('clears the result with Nueva consulta', async () => {
    vi.mocked(api.recognize).mockResolvedValue({ success: true, resultado: match })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(recognizeButton())
    await screen.findByRole('heading', { name: 'Carlos' })

    fireEvent.click(screen.getByRole('button', { name: 'Nueva consulta' }))
    expect(screen.queryByRole('heading', { name: 'Carlos' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nueva consulta' })).toBeNull()
    expect(recognizeButton().disabled).toBe(true)
  })
})

describe('Reconocimiento: modo evaluación', () => {
  async function evaluate(choice: string) {
    fireEvent.click(evaluationSwitch())
    await screen.findByLabelText('¿Quién está frente a la cámara?')
    fireEvent.change(expectedSelect(), { target: { value: choice } })
  }

  it('is off by default: no person is asked for and none is sent', async () => {
    vi.mocked(api.recognize).mockResolvedValue({ success: true, resultado: match })
    render(<Reconocimiento />)
    expect(evaluationSwitch().checked).toBe(false)
    expect(screen.queryByLabelText('¿Quién está frente a la cámara?')).toBeNull()
    expect(api.listPersons).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(recognizeButton())
    await screen.findByRole('heading', { name: 'Carlos' })
    expect(vi.mocked(api.recognize).mock.calls[0]).toHaveLength(1)
  })

  it('offers only the active people who have faces, and "Desconocido", with nobody chosen', async () => {
    render(<Reconocimiento />)
    fireEvent.click(evaluationSwitch())
    expect(screen.getByText('Cargando…')).toBeTruthy()

    const select = await screen.findByLabelText('¿Quién está frente a la cámara?')
    expect(
      Array.from((select as HTMLSelectElement).options).map((o) => [o.value, o.textContent]),
    ).toEqual([
      ['', 'Elige una opción'],
      ['10', 'Ana Torres'],
      ['12', 'Carlos'],
      ['desconocido', 'Desconocido (nadie registrado)'],
    ])
    expect((select as HTMLSelectElement).value).toBe('')
    expect(api.listPersons).toHaveBeenCalledTimes(1)
  })

  it('does not offer somebody with no faces of the model in use, who the server would refuse', async () => {
    render(<Reconocimiento />)
    fireEvent.click(evaluationSwitch())
    const select = (await screen.findByLabelText(
      '¿Quién está frente a la cámara?',
    )) as HTMLSelectElement
    const names = Array.from(select.options).map((option) => option.textContent)
    expect(names).not.toContain('Sin fotos')
    expect(names).not.toContain('Inactivo')
    expect(screen.queryByText(/Todavía no hay personas activas con rostros/)).toBeNull()
  })

  it('says so when nobody has faces yet, and still offers "Desconocido"', async () => {
    vi.mocked(api.listPersons).mockResolvedValue({
      success: true,
      resultado: [person(15, 'Sin fotos', true, 0)],
    })
    render(<Reconocimiento />)
    fireEvent.click(evaluationSwitch())
    const select = (await screen.findByLabelText(
      '¿Quién está frente a la cámara?',
    )) as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['', 'desconocido'])
    expect(screen.getByText(/Todavía no hay personas activas con rostros/)).toBeTruthy()
  })

  it('does not recognize until somebody is chosen, and says why', async () => {
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    expect(recognizeButton().disabled).toBe(false)

    fireEvent.click(evaluationSwitch())
    await screen.findByLabelText('¿Quién está frente a la cámara?')
    expect(recognizeButton().disabled).toBe(true)
    expect(screen.getByText('Elige quién está frente a la cámara para reconocer.')).toBeTruthy()

    fireEvent.change(expectedSelect(), { target: { value: '12' } })
    expect(recognizeButton().disabled).toBe(false)
    expect(screen.queryByText('Elige quién está frente a la cámara para reconocer.')).toBeNull()
  })

  it('sends the chosen person with the photo', async () => {
    vi.mocked(api.recognize).mockResolvedValue({
      success: true,
      resultado: { ...match, etiqueta: 'acierto' },
    })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    await evaluate('12')
    fireEvent.click(recognizeButton())

    expect(await screen.findByRole('heading', { name: 'Carlos' })).toBeTruthy()
    expect(api.recognize).toHaveBeenCalledWith(expect.any(Blob), '12')
    expect(screen.getByText('Acierto')).toBeTruthy()
  })

  it('sends "desconocido" when nobody registered is there', async () => {
    vi.mocked(api.recognize).mockResolvedValue({
      success: true,
      resultado: { ...match, etiqueta: 'falso_positivo' },
    })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    await evaluate('desconocido')
    fireEvent.click(recognizeButton())

    await screen.findByRole('heading', { name: 'Carlos' })
    expect(api.recognize).toHaveBeenCalledWith(expect.any(Blob), 'desconocido')
    expect(screen.getByText('Falso positivo')).toBeTruthy()
  })

  it('keeps the mode and the person for the next attempt', async () => {
    vi.mocked(api.recognize).mockResolvedValue({ success: true, resultado: match })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    await evaluate('10')
    fireEvent.click(recognizeButton())
    await screen.findByRole('heading', { name: 'Carlos' })

    fireEvent.click(screen.getByRole('button', { name: 'Nueva consulta' }))
    expect(evaluationSwitch().checked).toBe(true)
    expect(expectedSelect().value).toBe('10')
    // The list of people is not asked for again
    expect(api.listPersons).toHaveBeenCalledTimes(1)
  })

  it('clears the previous result when the person changes, so a label never sits next to another person', async () => {
    vi.mocked(api.recognize).mockResolvedValue({
      success: true,
      resultado: { ...match, etiqueta: 'acierto' },
    })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    await evaluate('12')
    fireEvent.click(recognizeButton())
    await screen.findByText('Acierto')

    fireEvent.change(expectedSelect(), { target: { value: '10' } })
    expect(screen.queryByRole('heading', { name: 'Carlos' })).toBeNull()
    expect(screen.queryByText('Acierto')).toBeNull()
  })

  it('clears the previous result when the mode is turned off, and goes back to sending only the photo', async () => {
    vi.mocked(api.recognize).mockResolvedValue({
      success: true,
      resultado: { ...match, etiqueta: 'acierto' },
    })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    await evaluate('12')
    fireEvent.click(recognizeButton())
    await screen.findByText('Acierto')

    fireEvent.click(evaluationSwitch())
    expect(screen.queryByRole('heading', { name: 'Carlos' })).toBeNull()
    expect(screen.queryByLabelText('¿Quién está frente a la cámara?')).toBeNull()

    vi.mocked(api.recognize).mockClear()
    fireEvent.click(recognizeButton())
    await screen.findByRole('heading', { name: 'Carlos' })
    expect(vi.mocked(api.recognize).mock.calls[0]).toHaveLength(1)
  })

  it('shows the error of the list of people with a retry, and keeps recognizing blocked', async () => {
    vi.mocked(api.listPersons)
      .mockResolvedValueOnce({ success: false, error: 'No se pudo conectar con el servidor' })
      .mockResolvedValueOnce({ success: true, resultado: people })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    fireEvent.click(evaluationSwitch())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No se pudo conectar con el servidor')
    expect(recognizeButton().disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText('¿Quién está frente a la cámara?')).toBeTruthy()
  })

  it('shows the API error of an attempt, for example a person without faces for this model', async () => {
    vi.mocked(api.recognize).mockResolvedValue({
      success: false,
      error: 'Esa persona no tiene rostros registrados con este modelo.',
    })
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    await evaluate('10')
    fireEvent.click(recognizeButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Esa persona no tiene rostros registrados con este modelo.')
    await waitFor(() => expect(recognizeButton().disabled).toBe(false))
    // The person stays chosen, to try again with another photo
    expect(expectedSelect().value).toBe('10')
  })

  it('blocks the switch and the choice of person while it recognizes, so the label always fits the person', async () => {
    vi.mocked(api.recognize).mockReturnValue(new Promise(() => {}))
    render(<Reconocimiento />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto' }))
    await evaluate('10')
    fireEvent.click(recognizeButton())
    await screen.findByRole('button', { name: 'Reconociendo…' })
    expect(evaluationSwitch().disabled).toBe(true)
    expect(expectedSelect().disabled).toBe(true)
    expect(api.recognize).toHaveBeenCalledTimes(1)
  })
})
