import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeUser } from '../auth/fixtures'
import { asRole } from '../auth/testWrappers'
import * as api from '../services/api'
import type { User } from '../types/auth'
import Usuarios from './Usuarios'

vi.mock('../services/api', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
}))

const me = makeUser('administrador', { id: 1, nombre: 'Ana Admin', email: 'ana@example.com' })
const omar = makeUser('operador', {
  id: 2,
  nombre: 'Omar Operador',
  email: 'omar@example.com',
  last_login_at: '2026-09-19T15:42:00Z',
})
const carla = makeUser('consulta', {
  id: 3,
  nombre: 'carla Consulta',
  email: 'carla@example.com',
  activo: false,
})

function renderPage(users: User[] = [omar, me, carla]) {
  vi.mocked(api.listUsers).mockResolvedValue({ success: true, resultado: users })
  return render(<Usuarios />, { wrapper: asRole('administrador', { user: me }) })
}

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const roleSelect = (name: string) => screen.getByLabelText(`Rol de ${name}`) as HTMLSelectElement
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => {
  vi.mocked(api.listUsers).mockReset()
  vi.mocked(api.createUser).mockReset()
  vi.mocked(api.updateUser).mockReset()
})

describe('Usuarios: the list', () => {
  it('shows the accounts by name, ignoring capitals, with role, state and last access', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    const names = Array.from(document.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelector('p')?.textContent ?? '',
    )
    expect(names.map((name) => name.replace('Tú', ''))).toEqual([
      'Ana Admin',
      'carla Consulta',
      'Omar Operador',
    ])
    expect(roleSelect('Omar Operador').value).toBe('operador')
    expect(roleSelect('carla Consulta').value).toBe('consulta')
    expect(within(row('Omar Operador')).getByText('Activa')).toBeTruthy()
    expect(within(row('carla Consulta')).getByText('Desactivada')).toBeTruthy()
    expect(within(row('carla Consulta')).getByText('Nunca')).toBeTruthy()
    expect(within(row('Omar Operador')).queryByText('Nunca')).toBeNull()
    expect(screen.getByText('omar@example.com')).toBeTruthy()
  })

  it('offers the three roles, with their names', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    expect(
      Array.from(roleSelect('Omar Operador').options).map((option) => option.textContent),
    ).toEqual(['Administrador', 'Operador', 'Consulta'])
  })

  it('marks your own account, which cannot be deactivated from here', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    expect(within(row('Ana Admin')).getByText('Tú')).toBeTruthy()
    expect(within(row('Omar Operador')).queryByText('Tú')).toBeNull()
    const own = within(row('Ana Admin')).getByRole('button', {
      name: /Desactivar/,
    }) as HTMLButtonElement
    expect(own.disabled).toBe(true)
    expect(own.title).toBe('No puedes desactivar tu propia cuenta')
    const other = within(row('Omar Operador')).getByRole('button', {
      name: /Desactivar/,
    }) as HTMLButtonElement
    expect(other.disabled).toBe(false)
    expect(other.title).toBe('')
  })

  it('shows the error of the list with a retry that asks again', async () => {
    vi.mocked(api.listUsers).mockResolvedValueOnce({
      success: false,
      error: 'No tienes permiso para hacer esto.',
    })
    render(<Usuarios />, { wrapper: asRole('administrador', { user: me }) })
    expect((await screen.findByRole('alert')).textContent).toContain(
      'No tienes permiso para hacer esto.',
    )

    vi.mocked(api.listUsers).mockResolvedValue({ success: true, resultado: [me] })
    fireEvent.click(button('Reintentar'))
    await screen.findByText('Ana Admin')
    expect(api.listUsers).toHaveBeenCalledTimes(2)
  })
})

describe('Usuarios: changing the role', () => {
  it('changes it with the server, shows the answer and says so', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.updateUser).mockResolvedValue({
      success: true,
      resultado: { ...omar, rol: 'consulta' },
    })
    fireEvent.change(roleSelect('Omar Operador'), { target: { value: 'consulta' } })

    await waitFor(() => expect(roleSelect('Omar Operador').value).toBe('consulta'))
    expect(api.updateUser).toHaveBeenCalledExactlyOnceWith(2, { rol: 'consulta' })
    expect((await screen.findByRole('status')).textContent).toBe('Rol de Omar Operador: Consulta.')
  })

  it('keeps the old role and says why when the server refuses', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.updateUser).mockResolvedValue({
      success: false,
      error: 'Debe quedar al menos un administrador activo.',
    })
    fireEvent.change(roleSelect('Ana Admin'), { target: { value: 'operador' } })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Debe quedar al menos un administrador activo.',
    )
    expect(roleSelect('Ana Admin').value).toBe('administrador')
  })

  it('locks only that row while it works', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    let finish: (value: Awaited<ReturnType<typeof api.updateUser>>) => void = () => {}
    vi.mocked(api.updateUser).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fireEvent.change(roleSelect('Omar Operador'), { target: { value: 'consulta' } })

    await waitFor(() => expect(roleSelect('Omar Operador').disabled).toBe(true))
    expect(
      (
        within(row('Omar Operador')).getByRole('button', {
          name: /Desactivar/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(roleSelect('carla Consulta').disabled).toBe(false)

    finish({ success: true, resultado: { ...omar, rol: 'consulta' } })
    await waitFor(() => expect(roleSelect('Omar Operador').disabled).toBe(false))
  })

  it('turns an unexpected exception into a message', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.updateUser).mockRejectedValue(new Error('boom'))
    fireEvent.change(roleSelect('Omar Operador'), { target: { value: 'consulta' } })
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
    expect(roleSelect('Omar Operador').disabled).toBe(false)
  })

  it('clears the earlier message when the next change starts', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.updateUser).mockResolvedValueOnce({ success: false, error: 'Falló.' })
    fireEvent.change(roleSelect('Omar Operador'), { target: { value: 'consulta' } })
    await screen.findByRole('alert')

    let finish: (value: Awaited<ReturnType<typeof api.updateUser>>) => void = () => {}
    vi.mocked(api.updateUser).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    fireEvent.change(roleSelect('Omar Operador'), { target: { value: 'consulta' } })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    finish({ success: true, resultado: omar })
  })
})

describe('Usuarios: deactivating and activating', () => {
  it('deactivates an account, and the button becomes the way back', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.updateUser).mockResolvedValue({
      success: true,
      resultado: { ...omar, activo: false },
    })
    fireEvent.click(button('Desactivar a Omar Operador'))

    await screen.findByText('Omar Operador: cuenta desactivada.')
    expect(api.updateUser).toHaveBeenCalledExactlyOnceWith(2, { activo: false })
    expect(within(row('Omar Operador')).getByText('Desactivada')).toBeTruthy()
    expect(button('Activar a Omar Operador')).toBeTruthy()
  })

  it('activates an account that was deactivated', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.updateUser).mockResolvedValue({
      success: true,
      resultado: { ...carla, activo: true },
    })
    fireEvent.click(button('Activar a carla Consulta'))
    await screen.findByText('carla Consulta: cuenta activada.')
    expect(api.updateUser).toHaveBeenCalledExactlyOnceWith(3, { activo: true })
    expect(within(row('carla Consulta')).getByText('Activa')).toBeTruthy()
  })

  it('does not change the row when the server refuses', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.updateUser).mockResolvedValue({ success: false, error: 'No.' })
    fireEvent.click(button('Desactivar a Omar Operador'))
    await screen.findByRole('alert')
    expect(within(row('Omar Operador')).getByText('Activa')).toBeTruthy()
  })
})

describe('Usuarios: a new password for someone', () => {
  async function open(name = 'Omar Operador') {
    renderPage()
    await screen.findByText('Omar Operador')
    fireEvent.click(button(`Nueva contraseña para ${name}`))
  }

  it('opens a field under the row, for that person only', async () => {
    await open()
    expect(screen.getByLabelText('Contraseña nueva para Omar Operador')).toBeTruthy()
    expect(screen.queryByLabelText('Contraseña nueva para carla Consulta')).toBeNull()
    expect(button('Nueva contraseña para Omar Operador').disabled).toBe(true)
  })

  it('has the field of a password that a browser knows is a new one', async () => {
    await open()
    const field = screen.getByLabelText('Contraseña nueva para Omar Operador') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.autocomplete).toBe('new-password')
  })

  it('says what is wrong with a password that does not follow the rules, and sends nothing', async () => {
    await open()
    expect(screen.queryByText(/al menos 10 caracteres/)).toBeNull()
    fireEvent.click(button('Guardar'))
    expect(screen.getByText('La contraseña debe tener al menos 10 caracteres.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Contraseña nueva para Omar Operador'), {
      target: { value: 'omar@example.com' },
    })
    fireEvent.click(button('Guardar'))
    expect(screen.getByText('La contraseña no puede ser igual al correo.')).toBeTruthy()
    expect(api.updateUser).not.toHaveBeenCalled()
  })

  it('sets it, says that the sessions of that person closed, and closes the field', async () => {
    await open()
    vi.mocked(api.updateUser).mockResolvedValue({ success: true, resultado: omar })
    fireEvent.change(screen.getByLabelText('Contraseña nueva para Omar Operador'), {
      target: { value: 'una clave nueva larga' },
    })
    fireEvent.click(button('Guardar'))

    await screen.findByText(
      'Contraseña nueva para Omar Operador. Sus sesiones abiertas se cerraron.',
    )
    expect(api.updateUser).toHaveBeenCalledExactlyOnceWith(2, { clave: 'una clave nueva larga' })
    expect(screen.queryByLabelText('Contraseña nueva para Omar Operador')).toBeNull()
  })

  it('keeps the field open when the server refuses, to try another', async () => {
    await open()
    vi.mocked(api.updateUser).mockResolvedValue({ success: false, error: 'No sirve.' })
    fireEvent.change(screen.getByLabelText('Contraseña nueva para Omar Operador'), {
      target: { value: 'una clave nueva larga' },
    })
    fireEvent.click(button('Guardar'))
    expect((await screen.findByRole('alert')).textContent).toBe('No sirve.')
    expect(screen.getByLabelText('Contraseña nueva para Omar Operador')).toBeTruthy()
  })

  it('closes with Cancelar without sending anything', async () => {
    await open()
    fireEvent.click(button('Cancelar'))
    expect(screen.queryByLabelText('Contraseña nueva para Omar Operador')).toBeNull()
    expect(api.updateUser).not.toHaveBeenCalled()
    expect(button('Nueva contraseña para Omar Operador').disabled).toBe(false)
  })

  it('moves to another person when asked for one, with the field empty', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Contraseña nueva para Omar Operador'), {
      target: { value: 'algo que se escribió' },
    })
    fireEvent.click(button('Nueva contraseña para carla Consulta'))
    expect(screen.queryByLabelText('Contraseña nueva para Omar Operador')).toBeNull()
    expect(
      (screen.getByLabelText('Contraseña nueva para carla Consulta') as HTMLInputElement).value,
    ).toBe('')
  })
})

describe('Usuarios: creating one', () => {
  const nameField = () => screen.getByLabelText('Nombre') as HTMLInputElement
  const emailField = () => screen.getByLabelText('Correo electrónico') as HTMLInputElement
  const roleField = () => screen.getByLabelText('Rol') as HTMLSelectElement
  const passwordField = () => screen.getByLabelText('Contraseña inicial') as HTMLInputElement
  const create = () =>
    screen.getByRole('button', { name: /Crear usuario|Creando/ }) as HTMLButtonElement

  function fill(
    name = ' Nora  Nueva ',
    address = ' nora@example.com ',
    secret = 'una clave larga 1',
  ) {
    fireEvent.change(nameField(), { target: { value: name } })
    fireEvent.change(emailField(), { target: { value: address } })
    fireEvent.change(passwordField(), { target: { value: secret } })
  }

  const nora = makeUser('operador', { id: 9, nombre: 'Nora Nueva', email: 'nora@example.com' })

  it('starts on Operador, the role that most accounts have', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    expect(roleField().value).toBe('operador')
    expect(passwordField().type).toBe('password')
    expect(passwordField().autocomplete).toBe('new-password')
  })

  it('says what is wrong at each field, after trying, and sends nothing', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    expect(screen.queryByText('Escribe un correo válido.')).toBeNull()
    fireEvent.click(create())
    expect(screen.getByText('El nombre debe tener entre 2 y 100 caracteres.')).toBeTruthy()
    expect(screen.getByText('Escribe un correo válido.')).toBeTruthy()
    expect(screen.getByText('La contraseña debe tener al menos 10 caracteres.')).toBeTruthy()
    expect(nameField().getAttribute('aria-describedby')).toBe('usuario-nombre-error')
    expect(emailField().getAttribute('aria-describedby')).toBe('usuario-email-error')
    expect(api.createUser).not.toHaveBeenCalled()
  })

  it('does not accept a password equal to the address', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    fill('Nora Nueva', 'nora@example.com', 'nora@example.com')
    fireEvent.click(create())
    expect(screen.getByText('La contraseña no puede ser igual al correo.')).toBeTruthy()
    expect(api.createUser).not.toHaveBeenCalled()
  })

  it('creates it with the name and the address as they are, and shows it in the list', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.createUser).mockResolvedValue({ success: true, resultado: nora })
    fill()
    fireEvent.change(roleField(), { target: { value: 'consulta' } })
    fireEvent.click(create())

    await screen.findByText('Usuario creado: Nora Nueva.')
    expect(api.createUser).toHaveBeenCalledExactlyOnceWith({
      email: 'nora@example.com',
      nombre: ' Nora  Nueva ',
      rol: 'consulta',
      clave: 'una clave larga 1',
    })
    expect(within(row('Nora Nueva')).getByText('nora@example.com')).toBeTruthy()
    // Sorted with the others, not at the end
    const names = Array.from(document.querySelectorAll('tbody tr p:first-child')).map((p) =>
      p.textContent?.replace('Tú', ''),
    )
    expect(names).toEqual(['Ana Admin', 'carla Consulta', 'Nora Nueva', 'Omar Operador'])
  })

  it('empties the form after creating, so the password does not stay on the screen', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.createUser).mockResolvedValue({ success: true, resultado: nora })
    fill()
    fireEvent.change(roleField(), { target: { value: 'administrador' } })
    fireEvent.click(create())
    await screen.findByText('Usuario creado: Nora Nueva.')
    expect(nameField().value).toBe('')
    expect(emailField().value).toBe('')
    expect(passwordField().value).toBe('')
    expect(roleField().value).toBe('operador')
    expect(screen.queryByText('Escribe un correo válido.')).toBeNull()
  })

  it('keeps what was typed and says why when the server refuses (an address already used)', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.createUser).mockResolvedValue({
      success: false,
      error: 'Ya existe un usuario con ese correo.',
    })
    fill()
    fireEvent.click(create())
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ya existe un usuario con ese correo.',
    )
    // A field of type email drops the spaces around what is typed
    expect(emailField().value).toBe('nora@example.com')
    expect(passwordField().value).toBe('una clave larga 1')
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('turns an unexpected exception into a message', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    vi.mocked(api.createUser).mockRejectedValue(new Error('boom'))
    fill()
    fireEvent.click(create())
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
  })

  it('locks the form while it works and sends only one request', async () => {
    renderPage()
    await screen.findByText('Omar Operador')
    let finish: (value: Awaited<ReturnType<typeof api.createUser>>) => void = () => {}
    vi.mocked(api.createUser).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fill()
    fireEvent.click(create())
    await waitFor(() => expect(create().textContent).toBe('Creando…'))
    expect(create().matches(':disabled')).toBe(true)
    fireEvent.click(create())
    expect(api.createUser).toHaveBeenCalledTimes(1)
    finish({ success: true, resultado: nora })
    await screen.findByText('Usuario creado: Nora Nueva.')
  })
})
