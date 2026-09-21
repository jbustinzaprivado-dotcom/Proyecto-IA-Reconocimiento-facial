import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import type { Person } from '../types/facial'
import RegistroFacial from './RegistroFacial'

vi.mock('../services/api', () => ({ createPerson: vi.fn(), uploadFaces: vi.fn() }))
vi.mock('../components/CameraCapture', () => ({
  default: ({ maxImages, onChange }: { maxImages: number; onChange: (images: Blob[]) => void }) => (
    <div>
      <span>máximo {maxImages}</span>
      <button type="button" onClick={() => onChange([new Blob(['a'], { type: 'image/jpeg' })])}>
        Agregar 1 foto
      </button>
      <button
        type="button"
        onClick={() =>
          onChange([
            new Blob(['a'], { type: 'image/jpeg' }),
            new Blob(['b'], { type: 'image/jpeg' }),
          ])
        }
      >
        Agregar 2 fotos
      </button>
    </div>
  ),
}))

const person: Person = {
  id: 42,
  nombre: 'Ana Torres',
  email: 'ana@example.com',
  activo: true,
  created_at: '2026-09-20T10:00:00Z',
  consentimiento_at: '2026-09-20T10:00:00Z',
  consentimiento_version: 'v0-provisional',
  rostros: 0,
}

const nameField = () => screen.getByLabelText('Nombre') as HTMLInputElement
const emailField = () => screen.getByLabelText('Correo electrónico') as HTMLInputElement
const consent = () => screen.getByRole('checkbox', { name: /He leído y acepto/ })
const submit = () => screen.getByRole('button', { name: 'Registrar' }) as HTMLButtonElement

function fillForm(name = 'Ana Torres', email = 'ana@example.com') {
  fireEvent.change(nameField(), { target: { value: name } })
  fireEvent.change(emailField(), { target: { value: email } })
}

function completeForm(photos: 1 | 2 = 1, name = 'Ana Torres') {
  fillForm(name)
  fireEvent.click(
    screen.getByRole('button', { name: photos === 1 ? 'Agregar 1 foto' : 'Agregar 2 fotos' }),
  )
  fireEvent.click(consent())
}

beforeEach(() => {
  vi.mocked(api.createPerson).mockReset()
  vi.mocked(api.uploadFaces).mockReset()
})

describe('RegistroFacial: form', () => {
  it('asks for 1 to 5 photos', () => {
    render(<RegistroFacial />)
    expect(screen.getByText('máximo 5')).toBeTruthy()
  })

  it('keeps Registrar disabled until name, email, a photo and the consent are complete', () => {
    render(<RegistroFacial />)
    expect(submit().disabled).toBe(true)

    fillForm()
    expect(submit().disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Agregar 1 foto' }))
    expect(submit().disabled).toBe(true)

    fireEvent.click(consent())
    expect(submit().disabled).toBe(false)

    fireEvent.click(consent())
    expect(submit().disabled).toBe(true)
  })

  it('shows a validation message when leaving an invalid name or email', () => {
    render(<RegistroFacial />)
    fireEvent.change(nameField(), { target: { value: 'A' } })
    fireEvent.blur(nameField())
    expect(screen.getByText('Escribe el nombre (mínimo 2 caracteres).')).toBeTruthy()
    expect(nameField().getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(emailField(), { target: { value: 'a@b' } })
    fireEvent.blur(emailField())
    expect(screen.getByText('Escribe un correo válido.')).toBeTruthy()
    expect(emailField().getAttribute('aria-invalid')).toBe('true')
  })

  it('rejects a name longer than 100 characters and a name made only of spaces', () => {
    render(<RegistroFacial />)
    fireEvent.change(nameField(), { target: { value: 'x'.repeat(101) } })
    fireEvent.blur(nameField())
    expect(screen.getByText('El nombre no puede superar 100 caracteres.')).toBeTruthy()

    fireEvent.change(nameField(), { target: { value: '   ' } })
    expect(screen.getByText('Escribe el nombre (mínimo 2 caracteres).')).toBeTruthy()
  })

  it('links a field to its error message only while that message exists', () => {
    render(<RegistroFacial />)
    expect(nameField().hasAttribute('aria-describedby')).toBe(false)
    expect(emailField().hasAttribute('aria-describedby')).toBe(false)

    fireEvent.change(nameField(), { target: { value: 'A' } })
    fireEvent.blur(nameField())
    const id = nameField().getAttribute('aria-describedby')
    expect(id).toBe('nombre-error')
    expect(document.getElementById(id as string)?.textContent).toBe(
      'Escribe el nombre (mínimo 2 caracteres).',
    )

    fireEvent.change(nameField(), { target: { value: 'Ana' } })
    expect(nameField().hasAttribute('aria-describedby')).toBe(false)
  })

  it('does not show messages before the fields are touched', () => {
    render(<RegistroFacial />)
    fireEvent.change(nameField(), { target: { value: 'A' } })
    expect(screen.queryByText('Escribe el nombre (mínimo 2 caracteres).')).toBeNull()
  })

  it('shows the provisional consent text with its placeholders and version', () => {
    render(<RegistroFacial />)
    expect(
      screen.getByText(/Texto provisional \(v0-provisional\): pendiente de revisión legal/),
    ).toBeTruthy()
    expect(screen.getByText('[Responsable del tratamiento]')).toBeTruthy()
    expect(screen.getByText('[plazo de conservación]')).toBeTruthy()
    expect(screen.getByText('[contacto]')).toBeTruthy()
  })
})

describe('RegistroFacial: saving', () => {
  it('registers the person with trimmed data and the consent version, then uploads the photos', async () => {
    vi.mocked(api.createPerson).mockResolvedValue({ success: true, resultado: person })
    vi.mocked(api.uploadFaces).mockResolvedValue({
      success: true,
      resultado: { persona_id: 42, imagenes_guardadas: 2 },
    })
    render(<RegistroFacial />)
    completeForm(2, '  Ana Torres  ')
    fireEvent.click(submit())

    expect(await screen.findByText('Registro completado')).toBeTruthy()
    expect(api.createPerson).toHaveBeenCalledWith({
      nombre: 'Ana Torres',
      email: 'ana@example.com',
      consentimiento_version: 'v0-provisional',
    })
    expect(api.uploadFaces).toHaveBeenCalledWith(42, [expect.any(Blob), expect.any(Blob)])
    expect(screen.getByText('Persona registrada: Ana Torres')).toBeTruthy()
    expect(screen.getByText('Imágenes guardadas: 2')).toBeTruthy()
  })

  it('locks the form and shows "Registrando…" while it saves', async () => {
    vi.mocked(api.createPerson).mockReturnValue(new Promise(() => {}))
    render(<RegistroFacial />)
    completeForm()
    fireEvent.click(submit())

    expect(await screen.findByRole('button', { name: 'Registrando…' })).toBeTruthy()
    // Blocked through the disabled fieldset: the controls match :disabled but their own property stays false
    expect(nameField().matches(':disabled')).toBe(true)
    expect(emailField().matches(':disabled')).toBe(true)
    expect(consent().matches(':disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Agregar 1 foto' }).matches(':disabled')).toBe(true)
  })

  it('shows "Subiendo fotos…" and not the failure notice while the first upload is in progress', async () => {
    vi.mocked(api.createPerson).mockResolvedValue({ success: true, resultado: person })
    vi.mocked(api.uploadFaces).mockReturnValue(new Promise(() => {}))
    render(<RegistroFacial />)
    completeForm()
    fireEvent.click(submit())

    expect(await screen.findByText('Subiendo fotos…')).toBeTruthy()
    expect(screen.queryByText(/no se pudieron subir las fotos/)).toBeNull()
  })

  it('keeps the form and its data when creating the person fails', async () => {
    vi.mocked(api.createPerson).mockResolvedValue({
      success: false,
      error: 'El correo ya está registrado',
    })
    render(<RegistroFacial />)
    completeForm()
    fireEvent.click(submit())

    expect((await screen.findByRole('alert')).textContent).toBe('El correo ya está registrado')
    expect(api.uploadFaces).not.toHaveBeenCalled()
    expect(nameField().value).toBe('Ana Torres')
    expect(nameField().matches(':disabled')).toBe(false)
    expect(submit().matches(':disabled')).toBe(false)
  })

  it('turns an unexpected exception into an error and keeps the form', async () => {
    vi.mocked(api.createPerson).mockRejectedValue(new Error('boom'))
    render(<RegistroFacial />)
    completeForm()
    fireEvent.click(submit())

    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
    expect(nameField().value).toBe('Ana Torres')
  })
})

describe('RegistroFacial: partial failure', () => {
  async function failFirstUpload() {
    vi.mocked(api.createPerson).mockResolvedValue({ success: true, resultado: person })
    vi.mocked(api.uploadFaces).mockResolvedValueOnce({
      success: false,
      error: 'Respuesta inesperada del servidor',
    })
    render(<RegistroFacial />)
    completeForm()
    fireEvent.click(submit())
    await screen.findByText(/La persona quedó registrada, pero no se pudieron subir las fotos/)
  }

  it('offers to retry only the upload, without creating the person again', async () => {
    await failFirstUpload()
    expect(screen.getByRole('alert').textContent).toContain(
      'La persona quedó registrada, pero no se pudieron subir las fotos: Respuesta inesperada del servidor',
    )
    expect(screen.queryByLabelText('Nombre')).toBeNull()
    expect(api.createPerson).toHaveBeenCalledTimes(1)

    vi.mocked(api.uploadFaces).mockResolvedValueOnce({
      success: true,
      resultado: { persona_id: 42, imagenes_guardadas: 1 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }))

    expect(await screen.findByText('Registro completado')).toBeTruthy()
    expect(api.createPerson).toHaveBeenCalledTimes(1)
    expect(api.uploadFaces).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.uploadFaces).mock.calls[1][0]).toBe(42)
  })

  it('keeps offering the retry when the upload fails again', async () => {
    await failFirstUpload()
    vi.mocked(api.uploadFaces).mockResolvedValueOnce({ success: false, error: 'Otra vez' })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }))

    expect(await screen.findByText(/no se pudieron subir las fotos: Otra vez/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar subida' })).toBeTruthy()
    expect(api.createPerson).toHaveBeenCalledTimes(1)
  })

  it('says how many photos would be uploaded, and that a connection failure can be retried as is', async () => {
    await failFirstUpload()
    expect(screen.getByText(/Fotos para subir: 1/)).toBeTruthy()
    expect(screen.getByText(/reintenta con las mismas fotos/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Reintentar subida' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('lets the photos be changed and retries with the new ones only', async () => {
    await failFirstUpload()
    // No camera until the person asks to change the photos
    expect(screen.queryByText('máximo 5')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar las fotos' }))

    expect(screen.getByText('máximo 5')).toBeTruthy()
    expect(screen.getByText(/Fotos para subir: 0/)).toBeTruthy()
    expect(screen.getByText(/elige al menos una/)).toBeTruthy()
    // Nothing to upload yet: the old photos are not silently sent
    const retry = screen.getByRole('button', { name: 'Reintentar subida' }) as HTMLButtonElement
    expect(retry.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Agregar 2 fotos' }))
    expect(screen.getByText(/Fotos para subir: 2/)).toBeTruthy()
    expect(retry.disabled).toBe(false)

    vi.mocked(api.uploadFaces).mockResolvedValueOnce({
      success: true,
      resultado: { persona_id: 42, imagenes_guardadas: 2 },
    })
    fireEvent.click(retry)

    expect(await screen.findByText('Registro completado')).toBeTruthy()
    expect(api.createPerson).toHaveBeenCalledTimes(1)
    const [personId, images] = vi.mocked(api.uploadFaces).mock.calls[1]
    expect(personId).toBe(42)
    expect(images).toHaveLength(2)
  })

  it('goes back to the earlier photos with "Usar las fotos anteriores"', async () => {
    await failFirstUpload()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar las fotos' }))
    expect(screen.getByText(/Fotos para subir: 0/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Usar las fotos anteriores' }))
    expect(screen.getByText(/Fotos para subir: 1/)).toBeTruthy()
    expect(screen.queryByText('máximo 5')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cambiar las fotos' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usar las fotos anteriores' })).toBeNull()
  })

  it('keeps the new photos when the retry fails again, without the camera', async () => {
    await failFirstUpload()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar las fotos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar 2 fotos' }))
    vi.mocked(api.uploadFaces).mockResolvedValueOnce({ success: false, error: 'Rechazada' })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }))

    expect(await screen.findByText(/no se pudieron subir las fotos: Rechazada/)).toBeTruthy()
    expect(screen.getByText(/Fotos para subir: 2/)).toBeTruthy()
    expect(screen.queryByText('máximo 5')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cambiar las fotos' })).toBeTruthy()
  })

  it('starts the next change with an empty camera, not with the photos of the last one', async () => {
    await failFirstUpload()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar las fotos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar 2 fotos' }))
    vi.mocked(api.uploadFaces).mockResolvedValueOnce({ success: false, error: 'Rechazada' })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }))
    await screen.findByText(/Rechazada/)

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar las fotos' }))
    expect(screen.getByText(/Fotos para subir: 0/)).toBeTruthy()
  })

  it('clears everything with "Abandonar y empezar de nuevo"', async () => {
    await failFirstUpload()
    fireEvent.click(screen.getByRole('button', { name: 'Abandonar y empezar de nuevo' }))

    expect(nameField().value).toBe('')
    expect(emailField().value).toBe('')
    expect((consent() as HTMLInputElement).checked).toBe(false)
    expect(submit().disabled).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('starts a clean form with "Registrar otra persona" after a success', async () => {
    vi.mocked(api.createPerson).mockResolvedValue({ success: true, resultado: person })
    vi.mocked(api.uploadFaces).mockResolvedValue({
      success: true,
      resultado: { persona_id: 42, imagenes_guardadas: 1 },
    })
    render(<RegistroFacial />)
    completeForm()
    fireEvent.click(submit())
    await screen.findByText('Registro completado')

    fireEvent.click(screen.getByRole('button', { name: 'Registrar otra persona' }))
    expect(nameField().value).toBe('')
    expect((consent() as HTMLInputElement).checked).toBe(false)
    expect(submit().disabled).toBe(true)
  })
})
