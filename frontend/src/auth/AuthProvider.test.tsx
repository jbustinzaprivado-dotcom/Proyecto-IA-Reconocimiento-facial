import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import { endSession, loadSession, saveSession } from '../services/session'
import type { SessionData } from '../types/auth'
import { useAuth, useUser } from './AuthContext'
import AuthProvider, { SESSION_EXPIRED, SESSION_REJECTED } from './AuthProvider'
import { makeUser } from './fixtures'

vi.mock('../services/api', () => ({ login: vi.fn(), getMe: vi.fn() }))

const HOUR = 3_600_000

function sessionData(role: 'administrador' | 'operador' | 'consulta' = 'operador'): SessionData {
  return { token: 'nuevo', tipo: 'Bearer', expira_en: 3600, usuario: makeUser(role) }
}

// Shows what the provider knows, and has a button for each thing a page can ask of it
function Probe() {
  const auth = useAuth()
  return (
    <div>
      <p data-testid="estado">{auth.status}</p>
      <p data-testid="usuario">{auth.user ? `${auth.user.nombre} (${auth.user.rol})` : 'nadie'}</p>
      <p data-testid="aviso">{auth.notice ?? 'sin aviso'}</p>
      <button
        type="button"
        onClick={() => {
          void auth.signIn('ana@example.com', 'la clave').then((problem) => {
            document.title = problem ?? 'entró'
          })
        }}
      >
        entrar
      </button>
      <button type="button" onClick={auth.signOut}>
        salir
      </button>
      <button type="button" onClick={() => auth.adopt(sessionData('consulta'))}>
        adoptar
      </button>
    </div>
  )
}

const renderProbe = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

const state = () => screen.getByTestId('estado').textContent
const who = () => screen.getByTestId('usuario').textContent
const notice = () => screen.getByTestId('aviso').textContent

function savedSession(
  extra: { expiresAt?: number; role?: 'administrador' | 'operador' | 'consulta' } = {},
) {
  saveSession({
    token: 'guardado',
    expiresAt: extra.expiresAt ?? Date.now() + HOUR,
    user: makeUser(extra.role ?? 'operador'),
  })
}

beforeEach(() => {
  window.sessionStorage.clear()
  vi.mocked(api.login).mockReset()
  vi.mocked(api.getMe).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AuthProvider: starting', () => {
  it('starts signed out when there is no saved session, without asking the server', () => {
    renderProbe()
    expect(state()).toBe('anonymous')
    expect(who()).toBe('nadie')
    expect(notice()).toBe('sin aviso')
    expect(api.getMe).not.toHaveBeenCalled()
  })

  it('checks a saved session with the server before trusting it', async () => {
    savedSession()
    let answer: (value: Awaited<ReturnType<typeof api.getMe>>) => void = () => {}
    vi.mocked(api.getMe).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderProbe()
    expect(state()).toBe('loading')
    expect(api.getMe).toHaveBeenCalledTimes(1)

    await act(async () => answer({ success: true, resultado: makeUser('operador') }))
    expect(state()).toBe('authenticated')
    expect(who()).toBe('Operador (operador)')
  })

  it('takes the user as the server says it is now, and saves that', async () => {
    savedSession({ role: 'consulta' })
    vi.mocked(api.getMe).mockResolvedValue({
      success: true,
      resultado: makeUser('administrador', { nombre: 'Ana Nueva' }),
    })
    renderProbe()
    await waitFor(() => expect(state()).toBe('authenticated'))
    expect(who()).toBe('Ana Nueva (administrador)')
    expect(loadSession()?.user.rol).toBe('administrador')
    expect(loadSession()?.token).toBe('guardado')
  })

  it('ignores a saved session that is past its time', () => {
    savedSession({ expiresAt: Date.now() - 1 })
    renderProbe()
    expect(state()).toBe('anonymous')
    expect(api.getMe).not.toHaveBeenCalled()
  })

  it('signs out, saying so, when the server cannot confirm the session', async () => {
    savedSession()
    vi.mocked(api.getMe).mockResolvedValue({
      success: false,
      error: 'No se pudo conectar con el servidor',
    })
    renderProbe()
    await waitFor(() => expect(state()).toBe('anonymous'))
    expect(notice()).toBe('No se pudo comprobar tu sesión. No se pudo conectar con el servidor')
    expect(loadSession()).toBeNull()
  })

  it('signs out, saying so, when asking the server fails outright', async () => {
    savedSession()
    vi.mocked(api.getMe).mockRejectedValue(new Error('boom'))
    renderProbe()
    await waitFor(() => expect(state()).toBe('anonymous'))
    expect(notice()).toBe('No se pudo comprobar tu sesión.')
    expect(loadSession()).toBeNull()
  })

  it('tells the person the session ended when the server refuses its token', async () => {
    savedSession()
    // What the api layer does on a 401 for a request that carried the token
    vi.mocked(api.getMe).mockImplementation(() => {
      endSession('rejected')
      return Promise.resolve({ success: false, error: 'Tu sesión no es válida o venció.' })
    })
    renderProbe()
    await waitFor(() => expect(state()).toBe('anonymous'))
    expect(notice()).toBe(SESSION_REJECTED)
    expect(loadSession()).toBeNull()
  })

  it('does not change anything if it goes away before the server answers', async () => {
    savedSession()
    let answer: (value: Awaited<ReturnType<typeof api.getMe>>) => void = () => {}
    vi.mocked(api.getMe).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { unmount } = renderProbe()
    unmount()
    await act(async () => answer({ success: true, resultado: makeUser('operador') }))
    expect(loadSession()?.token).toBe('guardado')
  })
})

describe('AuthProvider: signing in and out', () => {
  it('signs in, keeps the session for the time the server says, and returns no problem', async () => {
    const before = Date.now()
    vi.mocked(api.login).mockResolvedValue({
      success: true,
      resultado: sessionData('administrador'),
    })
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'entrar' }))
    await waitFor(() => expect(state()).toBe('authenticated'))

    expect(api.login).toHaveBeenCalledWith('ana@example.com', 'la clave')
    expect(who()).toBe('Administrador (administrador)')
    expect(document.title).toBe('entró')
    const saved = loadSession()
    expect(saved?.token).toBe('nuevo')
    expect(saved?.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000)
    expect(saved?.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000)
    expect(saved?.user.rol).toBe('administrador')
  })

  it('gives back the problem when the sign-in fails, and stays signed out', async () => {
    vi.mocked(api.login).mockResolvedValue({
      success: false,
      error: 'Correo o contraseña incorrectos.',
    })
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'entrar' }))
    await waitFor(() => expect(document.title).toBe('Correo o contraseña incorrectos.'))
    expect(state()).toBe('anonymous')
    expect(loadSession()).toBeNull()
  })

  it('clears the earlier notice when the person signs in', async () => {
    renderProbe()
    act(() => endSession('expired'))
    expect(notice()).toBe(SESSION_EXPIRED)
    vi.mocked(api.login).mockResolvedValue({ success: true, resultado: sessionData() })
    fireEvent.click(screen.getByRole('button', { name: 'entrar' }))
    await waitFor(() => expect(state()).toBe('authenticated'))
    expect(notice()).toBe('sin aviso')
  })

  it('signs out by hand: the session is gone and there is nothing to explain', async () => {
    savedSession()
    vi.mocked(api.getMe).mockResolvedValue({ success: true, resultado: makeUser('operador') })
    renderProbe()
    await waitFor(() => expect(state()).toBe('authenticated'))
    fireEvent.click(screen.getByRole('button', { name: 'salir' }))
    expect(state()).toBe('anonymous')
    expect(who()).toBe('nadie')
    expect(notice()).toBe('sin aviso')
    expect(loadSession()).toBeNull()
  })

  it('adopts a new session, as after a change of password', async () => {
    savedSession()
    vi.mocked(api.getMe).mockResolvedValue({ success: true, resultado: makeUser('operador') })
    renderProbe()
    await waitFor(() => expect(state()).toBe('authenticated'))
    fireEvent.click(screen.getByRole('button', { name: 'adoptar' }))
    expect(who()).toBe('Consulta (consulta)')
    expect(loadSession()?.token).toBe('nuevo')
  })
})

describe('AuthProvider: the session ends', () => {
  it.each([
    ['rejected', SESSION_REJECTED],
    ['expired', SESSION_EXPIRED],
  ] as const)('says why when it ends as %s', async (reason, text) => {
    savedSession()
    vi.mocked(api.getMe).mockResolvedValue({ success: true, resultado: makeUser('operador') })
    renderProbe()
    await waitFor(() => expect(state()).toBe('authenticated'))
    act(() => endSession(reason))
    expect(state()).toBe('anonymous')
    expect(who()).toBe('nadie')
    expect(notice()).toBe(text)
  })

  it('has different words for the two reasons', () => {
    expect(SESSION_EXPIRED).not.toBe(SESSION_REJECTED)
    expect(SESSION_EXPIRED).toContain('venció')
  })

  it('signs out by itself when the time of the session runs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    savedSession({ expiresAt: Date.now() + HOUR })
    vi.mocked(api.getMe).mockResolvedValue({ success: true, resultado: makeUser('operador') })
    renderProbe()
    await act(async () => {
      await Promise.resolve()
    })
    expect(state()).toBe('authenticated')

    act(() => {
      vi.advanceTimersByTime(HOUR - 1)
    })
    expect(state()).toBe('authenticated')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(state()).toBe('anonymous')
    expect(notice()).toBe(SESSION_EXPIRED)
    expect(loadSession()).toBeNull()
  })

  it('starts the count again with a new session, so a change of password does not end it early', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    savedSession({ expiresAt: Date.now() + 1000 })
    vi.mocked(api.getMe).mockResolvedValue({ success: true, resultado: makeUser('operador') })
    renderProbe()
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('button', { name: 'adoptar' }))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(state()).toBe('authenticated')
    act(() => {
      vi.advanceTimersByTime(HOUR)
    })
    expect(state()).toBe('anonymous')
  })

  it('does not keep a timer for someone who is signed out', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    renderProbe()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('AuthProvider: the hooks', () => {
  it('useAuth refuses to work outside the provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useAuth needs an AuthProvider around it')
    quiet.mockRestore()
  })

  it('useUser refuses to work when nobody is signed in', () => {
    function NeedsUser() {
      return <p>{useUser().nombre}</p>
    }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <AuthProvider>
          <NeedsUser />
        </AuthProvider>,
      ),
    ).toThrow('useUser was used outside a session')
    quiet.mockRestore()
  })
})
