import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asRole } from '../auth/testWrappers'
import * as api from '../services/api'
import type { Role } from '../types/auth'
import type { Person } from '../types/facial'
import Personas from './Personas'

vi.mock('../services/api', () => ({
  listPersons: vi.fn(),
  setPersonActive: vi.fn(),
  deletePerson: vi.fn(),
  purgePersons: vi.fn(),
}))

const person = (id: number, nombre: string, extra: Partial<Person> = {}): Person => ({
  id,
  nombre,
  email: `${nombre.split(' ')[0].toLowerCase()}@example.com`,
  activo: true,
  created_at: '2026-09-01T10:00:00Z',
  consentimiento_at: '2026-09-01T10:00:00Z',
  consentimiento_version: 'v0-provisional',
  rostros: 3,
  ...extra,
})

const ana = person(10, 'Ana Torres', { rostros: 5 })
const luis = person(11, 'Luis Ramírez', { rostros: 0 })
const diego = person(12, 'Diego Flores', { activo: false })

function renderPage(role: Role = 'administrador', people: Person[] = [ana, luis, diego]) {
  vi.mocked(api.listPersons).mockResolvedValue({ success: true, resultado: people })
  return render(<Personas />, { wrapper: asRole(role) })
}

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const has = (name: string | RegExp) => screen.queryByRole('button', { name })

beforeEach(() => {
  vi.mocked(api.listPersons).mockReset()
  vi.mocked(api.setPersonActive).mockReset()
  vi.mocked(api.deletePerson).mockReset()
  vi.mocked(api.purgePersons).mockReset()
})

describe('Personas: the list', () => {
  it('shows each person with the state, the faces and the consent', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    expect(within(row('Ana Torres')).getByText('ana@example.com')).toBeTruthy()
    expect(within(row('Ana Torres')).getByText('Activa')).toBeTruthy()
    expect(within(row('Ana Torres')).getByText('5')).toBeTruthy()
    expect(within(row('Ana Torres')).getByText(/v0-provisional · /)).toBeTruthy()
    expect(within(row('Diego Flores')).getByText('Desactivada')).toBeTruthy()
  })

  it('says "Sin rostros" for somebody who has none, and only for them', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    expect(within(row('Luis Ramírez')).getByText('Sin rostros')).toBeTruthy()
    expect(within(row('Ana Torres')).queryByText('Sin rostros')).toBeNull()
    expect(screen.getAllByText('Sin rostros')).toHaveLength(1)
  })

  it('says so when nobody is registered yet', async () => {
    renderPage('administrador', [])
    expect(await screen.findByText('Todavía no hay personas registradas.')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })

  it('shows the error of the list with a retry that asks again', async () => {
    vi.mocked(api.listPersons).mockResolvedValueOnce({ success: false, error: 'No hay conexión.' })
    render(<Personas />, { wrapper: asRole('administrador') })
    expect((await screen.findByRole('alert')).textContent).toContain('No hay conexión.')
    vi.mocked(api.listPersons).mockResolvedValue({ success: true, resultado: [ana] })
    fireEvent.click(button('Reintentar'))
    await screen.findByText('Ana Torres')
    expect(api.listPersons).toHaveBeenCalledTimes(2)
  })
})

describe('Personas: what each role sees', () => {
  it('gives the administrator the actions, the cleanup and its explanation', async () => {
    renderPage('administrador')
    await screen.findByText('Ana Torres')
    expect(screen.getByRole('columnheader', { name: 'Acciones' })).toBeTruthy()
    expect(button('Desactivar a Ana Torres')).toBeTruthy()
    expect(button('Activar a Diego Flores')).toBeTruthy()
    expect(button('Eliminar a Ana Torres')).toBeTruthy()
    expect(button('Limpiar personas sin rostros')).toBeTruthy()
    expect(screen.getByText(/se desactiva a una persona/)).toBeTruthy()
  })

  it('gives the operator the list only, and says who can do the rest', async () => {
    renderPage('operador')
    await screen.findByText('Ana Torres')
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).toBeNull()
    expect(has(/Desactivar|Activar|Eliminar|Limpiar/)).toBeNull()
    expect(
      screen.getByText('Solo un administrador puede desactivar o eliminar personas.'),
    ).toBeTruthy()
    expect(within(row('Ana Torres')).getAllByRole('cell')).toHaveLength(4)
  })
})

describe('Personas: deactivating and activating', () => {
  it('deactivates a person and shows the new state and the way back', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    vi.mocked(api.setPersonActive).mockResolvedValue({
      success: true,
      resultado: { ...ana, activo: false },
    })
    fireEvent.click(button('Desactivar a Ana Torres'))

    await screen.findByText('Ana Torres: desactivada.')
    expect(api.setPersonActive).toHaveBeenCalledExactlyOnceWith(10, false)
    expect(within(row('Ana Torres')).getByText('Desactivada')).toBeTruthy()
    expect(button('Activar a Ana Torres')).toBeTruthy()
  })

  it('activates a person who was deactivated', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    vi.mocked(api.setPersonActive).mockResolvedValue({
      success: true,
      resultado: { ...diego, activo: true },
    })
    fireEvent.click(button('Activar a Diego Flores'))
    await screen.findByText('Diego Flores: activada.')
    expect(api.setPersonActive).toHaveBeenCalledExactlyOnceWith(12, true)
  })

  it('changes nothing and says why when the server refuses', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    vi.mocked(api.setPersonActive).mockResolvedValue({
      success: false,
      error: 'La persona no existe.',
    })
    fireEvent.click(button('Desactivar a Ana Torres'))
    expect((await screen.findByRole('alert')).textContent).toBe('La persona no existe.')
    expect(within(row('Ana Torres')).getByText('Activa')).toBeTruthy()
  })

  it('turns an unexpected exception into a message', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    vi.mocked(api.setPersonActive).mockRejectedValue(new Error('boom'))
    fireEvent.click(button('Desactivar a Ana Torres'))
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
    expect(button('Desactivar a Ana Torres').disabled).toBe(false)
  })

  it('locks only that person while it works', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    let finish: (value: Awaited<ReturnType<typeof api.setPersonActive>>) => void = () => {}
    vi.mocked(api.setPersonActive).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(button('Desactivar a Ana Torres'))
    await waitFor(() => expect(button('Desactivar a Ana Torres').disabled).toBe(true))
    expect(button('Eliminar a Ana Torres').disabled).toBe(true)
    expect(button('Eliminar a Luis Ramírez').disabled).toBe(false)
    finish({ success: true, resultado: { ...ana, activo: false } })
    await waitFor(() => expect(button('Activar a Ana Torres').disabled).toBe(false))
  })
})

describe('Personas: deleting one', () => {
  const field = () =>
    screen.getByLabelText(/Escribe «Ana Torres» para confirmar/) as HTMLInputElement
  const confirm = () => button('Eliminar definitivamente')

  async function open() {
    renderPage()
    await screen.findByText('Ana Torres')
    fireEvent.click(button('Eliminar a Ana Torres'))
  }

  it('asks first, says what is lost and what stays, and puts the keyboard on the field', async () => {
    await open()
    expect(screen.getByText('Eliminar a Ana Torres', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText(/vectores faciales y su consentimiento/)).toBeTruthy()
    expect(screen.getByText(/quedan en el historial, pero sin su nombre/)).toBeTruthy()
    expect(screen.getByText(/No se puede deshacer/)).toBeTruthy()
    expect(document.activeElement).toBe(field())
    expect(api.deletePerson).not.toHaveBeenCalled()
  })

  it('keeps the button off until the name is typed', async () => {
    await open()
    expect(confirm().disabled).toBe(true)
    fireEvent.change(field(), { target: { value: 'Ana' } })
    expect(confirm().disabled).toBe(true)
    fireEvent.change(field(), { target: { value: 'Ana Torres' } })
    expect(confirm().disabled).toBe(false)
  })

  it('does not care about capitals or repeated spaces in the name', async () => {
    await open()
    fireEvent.change(field(), { target: { value: '  ana   TORRES ' } })
    expect(confirm().disabled).toBe(false)
  })

  it('does not accept the name of somebody else', async () => {
    await open()
    fireEvent.change(field(), { target: { value: 'Luis Ramírez' } })
    expect(confirm().disabled).toBe(true)
  })

  it('does not send anything when the form is sent without the name', async () => {
    await open()
    fireEvent.submit(field().closest('form') as HTMLFormElement)
    expect(api.deletePerson).not.toHaveBeenCalled()
  })

  it('deletes the person, takes them off the list and says so', async () => {
    await open()
    vi.mocked(api.deletePerson).mockResolvedValue({ success: true, resultado: { persona_id: 10 } })
    fireEvent.change(field(), { target: { value: 'Ana Torres' } })
    fireEvent.click(confirm())

    await screen.findByText('Se eliminó a Ana Torres.')
    expect(api.deletePerson).toHaveBeenCalledExactlyOnceWith(10)
    expect(screen.queryByText('ana@example.com')).toBeNull()
    expect(screen.queryByLabelText(/Escribe «Ana Torres»/)).toBeNull()
    expect(screen.getByText('Luis Ramírez')).toBeTruthy()
  })

  it('keeps the person and the question when the server refuses, and says why', async () => {
    await open()
    vi.mocked(api.deletePerson).mockResolvedValue({
      success: false,
      error: 'La persona no existe.',
    })
    fireEvent.change(field(), { target: { value: 'Ana Torres' } })
    fireEvent.click(confirm())
    expect((await screen.findByRole('alert')).textContent).toBe('La persona no existe.')
    expect(field().value).toBe('Ana Torres')
    expect(screen.getByText('ana@example.com')).toBeTruthy()
  })

  it('turns an unexpected exception into a message', async () => {
    await open()
    vi.mocked(api.deletePerson).mockRejectedValue(new Error('boom'))
    fireEvent.change(field(), { target: { value: 'Ana Torres' } })
    fireEvent.click(confirm())
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
  })

  it('locks the form while it works, and sends one request', async () => {
    await open()
    let finish: (value: Awaited<ReturnType<typeof api.deletePerson>>) => void = () => {}
    vi.mocked(api.deletePerson).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fireEvent.change(field(), { target: { value: 'Ana Torres' } })
    fireEvent.click(confirm())
    await waitFor(() => expect(button('Eliminando…').disabled).toBe(true))
    expect(field().disabled).toBe(true)
    expect(button('Cancelar').disabled).toBe(true)
    fireEvent.submit(field().closest('form') as HTMLFormElement)
    expect(api.deletePerson).toHaveBeenCalledTimes(1)
    finish({ success: true, resultado: { persona_id: 10 } })
    await screen.findByText('Se eliminó a Ana Torres.')
  })

  it('closes with Cancelar, and asking again starts with an empty field', async () => {
    await open()
    fireEvent.change(field(), { target: { value: 'Ana Torres' } })
    fireEvent.click(button('Cancelar'))
    expect(screen.queryByLabelText(/Escribe «Ana Torres»/)).toBeNull()
    fireEvent.click(button('Eliminar a Ana Torres'))
    expect(field().value).toBe('')
    expect(api.deletePerson).not.toHaveBeenCalled()
  })

  it('moves to another person without keeping what was typed for the first', async () => {
    await open()
    fireEvent.change(field(), { target: { value: 'Ana Torres' } })
    fireEvent.click(button('Eliminar a Luis Ramírez'))
    expect(screen.queryByLabelText(/Escribe «Ana Torres»/)).toBeNull()
    const other = screen.getByLabelText(/Escribe «Luis Ramírez» para confirmar/) as HTMLInputElement
    expect(other.value).toBe('')
    expect(button('Eliminar definitivamente').disabled).toBe(true)
  })
})

describe('Personas: cleaning up the ones with no faces', () => {
  async function open() {
    renderPage()
    await screen.findByText('Ana Torres')
    fireEvent.click(button('Limpiar personas sin rostros'))
  }

  it('asks first, and says who is not touched', async () => {
    await open()
    expect(
      screen.getByText(/¿Eliminar a las personas que nunca llegaron a guardar un rostro\?/),
    ).toBeTruthy()
    expect(screen.getByText(/Quien tenga rostros de cualquier modelo no se toca/)).toBeTruthy()
    expect(button('Limpiar personas sin rostros').disabled).toBe(true)
    expect(api.purgePersons).not.toHaveBeenCalled()
  })

  it.each([
    [0, 'No había personas sin rostros.'],
    [1, 'Se eliminó 1 persona sin rostros.'],
    [3, 'Se eliminó 3 personas sin rostros.'],
  ])('says the result when %i were deleted, and asks for the list again', async (count, text) => {
    await open()
    vi.mocked(api.purgePersons).mockResolvedValue({
      success: true,
      resultado: { eliminadas: count },
    })
    vi.mocked(api.listPersons).mockResolvedValue({ success: true, resultado: [ana, diego] })
    fireEvent.click(button('Sí, eliminar'))

    await screen.findByText(text)
    await waitFor(() => expect(screen.queryByText('luis@example.com')).toBeNull())
    expect(api.listPersons).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/¿Eliminar a las personas/)).toBeNull()
  })

  it('closes with Cancelar without asking the server', async () => {
    await open()
    fireEvent.click(button('Cancelar'))
    expect(screen.queryByText(/¿Eliminar a las personas/)).toBeNull()
    expect(api.purgePersons).not.toHaveBeenCalled()
    expect(button('Limpiar personas sin rostros').disabled).toBe(false)
  })

  it('keeps the question and says why when the server refuses', async () => {
    await open()
    vi.mocked(api.purgePersons).mockResolvedValue({
      success: false,
      error: 'No tienes permiso para hacer esto.',
    })
    fireEvent.click(button('Sí, eliminar'))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No tienes permiso para hacer esto.',
    )
    expect(screen.getByText(/¿Eliminar a las personas/)).toBeTruthy()
  })

  it('turns an unexpected exception into a message', async () => {
    await open()
    vi.mocked(api.purgePersons).mockRejectedValue(new Error('boom'))
    fireEvent.click(button('Sí, eliminar'))
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
  })

  it('locks the question while it works', async () => {
    await open()
    let finish: (value: Awaited<ReturnType<typeof api.purgePersons>>) => void = () => {}
    vi.mocked(api.purgePersons).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(button('Sí, eliminar'))
    await waitFor(() => expect(button('Eliminando…').disabled).toBe(true))
    expect(button('Cancelar').disabled).toBe(true)
    finish({ success: true, resultado: { eliminadas: 0 } })
    await screen.findByText('No había personas sin rostros.')
  })

  it('replaces the question about deleting one person, and the other way round', async () => {
    renderPage()
    await screen.findByText('Ana Torres')
    fireEvent.click(button('Eliminar a Ana Torres'))
    fireEvent.click(button('Limpiar personas sin rostros'))
    expect(screen.queryByLabelText(/Escribe «Ana Torres»/)).toBeNull()
    expect(screen.getByText(/¿Eliminar a las personas/)).toBeTruthy()

    fireEvent.click(button('Eliminar a Ana Torres'))
    expect(screen.queryByText(/¿Eliminar a las personas/)).toBeNull()
    expect(screen.getByLabelText(/Escribe «Ana Torres»/)).toBeTruthy()
  })
})
