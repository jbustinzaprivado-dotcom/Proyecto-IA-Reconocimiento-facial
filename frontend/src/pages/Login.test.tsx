import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asRole } from '../auth/testWrappers'
import Login from './Login'

const flags = vi.hoisted(() => ({ mocks: false }))
vi.mock('../services/api', () => ({
  get USE_MOCKS() {
    return flags.mocks
  },
}))

const signIn = vi.fn<(email: string, password: string) => Promise<string | null>>()

function renderLogin(notice: string | null = null) {
  return render(<Login />, {
    wrapper: asRole('administrador', { status: 'anonymous', user: null, notice, signIn }),
  })
}

const email = () => screen.getByLabelText('Correo electrónico') as HTMLInputElement
const password = () => screen.getByLabelText('Contraseña') as HTMLInputElement
const submit = () => screen.getByRole('button', { name: /Entrar|Entrando/ }) as HTMLButtonElement

function fill(address = 'ana@example.com', secret = 'la clave') {
  fireEvent.change(email(), { target: { value: address } })
  fireEvent.change(password(), { target: { value: secret } })
}

beforeEach(() => {
  flags.mocks = false
  signIn.mockReset()
  signIn.mockResolvedValue(null)
})

describe('Login: the form', () => {
  it('has a heading and two labeled fields, the password hidden', () => {
    renderLogin()
    expect(screen.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeTruthy()
    expect(email().type).toBe('email')
    expect(email().autocomplete).toBe('username')
    expect(password().type).toBe('password')
    expect(password().autocomplete).toBe('current-password')
  })

  it('keeps Entrar off until there is an address and a password', () => {
    renderLogin()
    expect(submit().disabled).toBe(true)
    fireEvent.change(email(), { target: { value: 'ana@example.com' } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(password(), { target: { value: 'x' } })
    expect(submit().disabled).toBe(false)
    fireEvent.change(email(), { target: { value: '   ' } })
    expect(submit().disabled).toBe(true)
  })

  it('does nothing when the form is sent with a field empty', () => {
    renderLogin()
    fireEvent.submit(email().closest('form') as HTMLFormElement)
    fireEvent.change(email(), { target: { value: 'ana@example.com' } })
    fireEvent.submit(email().closest('form') as HTMLFormElement)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('signs in with the address without the spaces around it, and the password as typed', async () => {
    renderLogin()
    fill('  ana@example.com  ', '  con espacios  ')
    fireEvent.click(submit())
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1))
    expect(signIn).toHaveBeenCalledWith('ana@example.com', '  con espacios  ')
  })

  it('can be sent with the keyboard, which is sending the form', async () => {
    renderLogin()
    fill()
    fireEvent.submit(email().closest('form') as HTMLFormElement)
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1))
  })
})

describe('Login: while it works and when it fails', () => {
  it('shows "Entrando…" and locks the form until the server answers', async () => {
    let finish: (value: string | null) => void = () => {}
    signIn.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderLogin()
    fill()
    fireEvent.click(submit())

    await waitFor(() => expect(submit().textContent).toBe('Entrando…'))
    expect(submit().disabled).toBe(true)
    expect(email().disabled).toBe(true)
    expect(password().disabled).toBe(true)

    finish('Correo o contraseña incorrectos.')
    await screen.findByRole('alert')
    expect(submit().textContent).toBe('Entrar')
    expect(email().disabled).toBe(false)
    expect(password().disabled).toBe(false)
  })

  it('shows what the server says when the sign-in is refused, and keeps what was typed', async () => {
    signIn.mockResolvedValue('Demasiados intentos fallidos. Vuelve a intentarlo en 15 minutos.')
    renderLogin()
    fill('ana@example.com', 'otra clave')
    fireEvent.click(submit())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'Demasiados intentos fallidos. Vuelve a intentarlo en 15 minutos.',
    )
    expect(email().value).toBe('ana@example.com')
    expect(password().value).toBe('otra clave')
  })

  it('turns an unexpected exception into a message', async () => {
    signIn.mockRejectedValue(new Error('boom'))
    renderLogin()
    fill()
    fireEvent.click(submit())
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
    expect(submit().disabled).toBe(false)
  })

  it('clears the message when the next attempt starts', async () => {
    signIn.mockResolvedValueOnce('Correo o contraseña incorrectos.')
    renderLogin()
    fill()
    fireEvent.click(submit())
    await screen.findByRole('alert')

    let finish: (value: string | null) => void = () => {}
    signIn.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(submit())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    finish(null)
  })

  it('shows nothing of its own when it works: the app leaves the page', async () => {
    renderLogin()
    fill()
    fireEvent.click(submit())
    await waitFor(() => expect(signIn).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Login: why the person is here', () => {
  it('says nothing when they simply arrived', () => {
    renderLogin(null)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says why the session ended, when it was not their doing', () => {
    renderLogin('Tu sesión venció. Inicia sesión otra vez.')
    expect(screen.getByRole('status').textContent).toBe('Tu sesión venció. Inicia sesión otra vez.')
  })
})

describe('Login: the demonstration accounts', () => {
  it('are not shown with real data', async () => {
    renderLogin()
    // Give the panel, if it were going to load, the time to do it
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('Cuentas de demostración')).toBeNull()
    expect(screen.queryByText(/demo-clave-123/)).toBeNull()
  })

  it('are listed with simulated data, with the password that is public', async () => {
    flags.mocks = true
    renderLogin()
    expect(await screen.findByRole('heading', { name: 'Cuentas de demostración' })).toBeTruthy()
    expect(screen.getByText('demo-clave-123')).toBeTruthy()
    for (const name of ['Administrador', 'Operador', 'Consulta']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.getByText('(admin@demo.test)')).toBeTruthy()
  })

  it('fill the form when one is chosen, and that is all: they do not sign in', async () => {
    flags.mocks = true
    renderLogin()
    fireEvent.click(await screen.findByRole('button', { name: 'Operador' }))
    expect(email().value).toBe('operador@demo.test')
    expect(password().value).toBe('demo-clave-123')
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('Login: the demonstration accounts in a build for a server', () => {
  it('are not there at all, whatever the variable says', async () => {
    vi.resetModules()
    vi.stubEnv('DEV', false)
    flags.mocks = true
    // The modules are new copies: the wrapper has to come from the same ones as the page
    const { default: ProductionLogin } = await import('./Login')
    const fresh = await import('../auth/testWrappers')
    render(<ProductionLogin />, {
      wrapper: fresh.asRole('administrador', { status: 'anonymous', user: null, signIn }),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('Cuentas de demostración')).toBeNull()
    expect(screen.queryByText(/demo-clave-123/)).toBeNull()
    vi.unstubAllEnvs()
  })
})
