import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeUser } from '../auth/fixtures'
import { asRole } from '../auth/testWrappers'
import * as api from '../services/api'
import type { SessionData } from '../types/auth'
import Cuenta from './Cuenta'

vi.mock('../services/api', () => ({ changePassword: vi.fn() }))

const adopt = vi.fn()

function renderPage(user = makeUser('operador', { email: 'omar@example.com', nombre: 'Omar' })) {
  return render(<Cuenta />, { wrapper: asRole(user.rol, { user, adopt }) })
}

const current = () => screen.getByLabelText('Contraseña actual') as HTMLInputElement
const next = () => screen.getByLabelText('Contraseña nueva') as HTMLInputElement
const repeat = () => screen.getByLabelText('Repite la contraseña nueva') as HTMLInputElement
const save = () =>
  screen.getByRole('button', { name: /Cambiar contraseña|Guardando/ }) as HTMLButtonElement

function fill(now = 'la clave de ahora', later = 'una clave nueva larga', again = later) {
  fireEvent.change(current(), { target: { value: now } })
  fireEvent.change(next(), { target: { value: later } })
  fireEvent.change(repeat(), { target: { value: again } })
}

const session: SessionData = {
  token: 'nuevo',
  tipo: 'Bearer',
  expira_en: 3600,
  usuario: makeUser('operador'),
}

beforeEach(() => {
  adopt.mockReset()
  vi.mocked(api.changePassword).mockReset()
  vi.mocked(api.changePassword).mockResolvedValue({ success: true, resultado: session })
})

describe('Cuenta: who you are', () => {
  it('shows the name, the address, the role and the last access', () => {
    renderPage(
      makeUser('operador', {
        nombre: 'Omar',
        email: 'omar@example.com',
        last_login_at: '2026-09-19T15:42:00Z',
      }),
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeTruthy()
    expect(screen.getByText('Omar')).toBeTruthy()
    expect(screen.getByText('omar@example.com')).toBeTruthy()
    expect(screen.getByText('Operador')).toBeTruthy()
    expect(screen.queryByText('Sin registro')).toBeNull()
  })

  it('says so when there is no record of a last access', () => {
    renderPage()
    expect(screen.getByText('Sin registro')).toBeTruthy()
  })
})

describe('Cuenta: the form', () => {
  it('has three labeled password fields that a browser knows how to handle', () => {
    renderPage()
    expect(current().type).toBe('password')
    expect(current().autocomplete).toBe('current-password')
    expect(next().autocomplete).toBe('new-password')
    expect(repeat().autocomplete).toBe('new-password')
  })

  it('shows no error before anything is sent', () => {
    renderPage()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(current().getAttribute('aria-invalid')).toBe('false')
  })

  it('says what is wrong, at each field, when it is sent empty, and asks nothing of the server', () => {
    renderPage()
    fireEvent.click(save())
    expect(screen.getByText('Escribe tu contraseña actual.')).toBeTruthy()
    expect(screen.getByText('La contraseña debe tener al menos 10 caracteres.')).toBeTruthy()
    expect(current().getAttribute('aria-invalid')).toBe('true')
    expect(current().getAttribute('aria-describedby')).toBe('clave-actual-error')
    expect(next().getAttribute('aria-describedby')).toBe('clave-nueva-error')
    expect(api.changePassword).not.toHaveBeenCalled()
  })

  it('refuses a new password that is too short, the address, or that is not repeated well', () => {
    renderPage()
    fill('la de ahora', 'corta', 'corta')
    fireEvent.click(save())
    expect(screen.getByText('La contraseña debe tener al menos 10 caracteres.')).toBeTruthy()

    fill('la de ahora', 'omar@example.com', 'omar@example.com')
    fireEvent.click(save())
    expect(screen.getByText('La contraseña no puede ser igual al correo.')).toBeTruthy()

    fill('la de ahora', 'una clave nueva larga', 'una clave nueva larga distinta')
    fireEvent.click(save())
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy()
    expect(repeat().getAttribute('aria-describedby')).toBe('clave-repetida-error')
    expect(api.changePassword).not.toHaveBeenCalled()
  })

  it('sends the current and the new password, and carries on with the new session', async () => {
    renderPage()
    fill('la clave de ahora', 'una clave nueva larga')
    fireEvent.click(save())

    await screen.findByText('Contraseña cambiada. Las demás sesiones se cerraron.')
    expect(api.changePassword).toHaveBeenCalledExactlyOnceWith(
      'la clave de ahora',
      'una clave nueva larga',
    )
    expect(adopt).toHaveBeenCalledExactlyOnceWith(session)
  })

  it('empties the fields after a change, so the passwords do not stay on the screen', async () => {
    renderPage()
    fill()
    fireEvent.click(save())
    await screen.findByRole('status')
    expect(current().value).toBe('')
    expect(next().value).toBe('')
    expect(repeat().value).toBe('')
    expect(screen.queryByText('Escribe tu contraseña actual.')).toBeNull()
  })

  it('locks the form and says "Guardando…" while it works', async () => {
    let finish: (value: Awaited<ReturnType<typeof api.changePassword>>) => void = () => {}
    vi.mocked(api.changePassword).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderPage()
    fill()
    fireEvent.click(save())
    await waitFor(() => expect(save().textContent).toBe('Guardando…'))
    // The whole form is a disabled fieldset, which disables what is inside it
    expect(save().matches(':disabled')).toBe(true)
    expect(current().matches(':disabled')).toBe(true)
    // A second press while it works does not send a second request
    fireEvent.click(save())
    expect(api.changePassword).toHaveBeenCalledTimes(1)

    finish({ success: true, resultado: session })
    await screen.findByRole('status')
    expect(save().matches(':disabled')).toBe(false)
  })

  it('shows what the server says when it refuses, and keeps what was typed to try again', async () => {
    vi.mocked(api.changePassword).mockResolvedValue({
      success: false,
      error: 'La contraseña actual no es correcta.',
    })
    renderPage()
    fill('mala', 'una clave nueva larga')
    fireEvent.click(save())
    expect((await screen.findByRole('alert')).textContent).toBe(
      'La contraseña actual no es correcta.',
    )
    expect(current().value).toBe('mala')
    expect(next().value).toBe('una clave nueva larga')
    expect(adopt).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('turns an unexpected exception into a message', async () => {
    vi.mocked(api.changePassword).mockRejectedValue(new Error('boom'))
    renderPage()
    fill()
    fireEvent.click(save())
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
    expect(save().matches(':disabled')).toBe(false)
  })

  it('clears the earlier result when it is sent again', async () => {
    renderPage()
    fill()
    fireEvent.click(save())
    await screen.findByRole('status')

    vi.mocked(api.changePassword).mockResolvedValue({ success: false, error: 'Otra vez no.' })
    fill()
    fireEvent.click(save())
    await screen.findByRole('alert')
    expect(screen.queryByRole('status')).toBeNull()

    vi.mocked(api.changePassword).mockResolvedValue({ success: true, resultado: session })
    fireEvent.click(save())
    await screen.findByRole('status')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
