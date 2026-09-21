import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeUser } from '../auth/fixtures'
import type { StoredSession } from './session'

const KEY = 'reconocimiento-facial.sesion'
const HOUR = 3_600_000

// Each test gets its own copy of the module, because the fallback and the listeners live in it
async function load() {
  vi.resetModules()
  return import('./session')
}

function stored(extra: Partial<StoredSession> = {}): StoredSession {
  return { token: 'tok', expiresAt: Date.now() + HOUR, user: makeUser('operador'), ...extra }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('session: saving and loading', () => {
  it('is empty at the start', async () => {
    const session = await load()
    expect(session.loadSession()).toBeNull()
    expect(session.getToken()).toBeNull()
  })

  it('keeps the session in sessionStorage, and gives it back', async () => {
    const session = await load()
    const saved = stored()
    session.saveSession(saved)
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null')).toEqual(saved)
    expect(session.loadSession()).toEqual(saved)
    expect(session.getToken()).toBe('tok')
  })

  it('never puts it in localStorage, which outlives the tab', async () => {
    const session = await load()
    session.saveSession(stored())
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it('survives a reload of the page, which is a new copy of the module', async () => {
    const first = await load()
    first.saveSession(stored({ token: 'otra' }))
    const second = await load()
    expect(second.getToken()).toBe('otra')
  })

  it('removes the session with clearSession', async () => {
    const session = await load()
    session.saveSession(stored())
    session.clearSession()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
    expect(session.loadSession()).toBeNull()
  })

  it('is not fooled by a session that is one millisecond past its time, and removes it', async () => {
    const session = await load()
    session.saveSession(stored({ expiresAt: 5_000 }))
    expect(session.loadSession(4_999)?.token).toBe('tok')
    expect(session.loadSession(5_000)).toBeNull()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('does not hand out the token of an expired session', async () => {
    const session = await load()
    session.saveSession(stored({ expiresAt: Date.now() - 1 }))
    expect(session.getToken()).toBeNull()
  })
})

describe('session: what is stored cannot be trusted', () => {
  const bad: [string, unknown][] = [
    ['not JSON', '{roto'],
    ['a number', 7],
    ['null', null],
    ['no token', { expiresAt: Date.now() + HOUR, user: makeUser() }],
    ['an empty token', { token: '', expiresAt: Date.now() + HOUR, user: makeUser() }],
    ['a token that is not text', { token: 4, expiresAt: Date.now() + HOUR, user: makeUser() }],
    ['no time', { token: 'x', user: makeUser() }],
    ['a time that is text', { token: 'x', expiresAt: 'mañana', user: makeUser() }],
    ['no user', { token: 'x', expiresAt: Date.now() + HOUR }],
    ['a user that is null', { token: 'x', expiresAt: Date.now() + HOUR, user: null }],
    [
      'a user with a role that does not exist',
      { token: 'x', expiresAt: Date.now() + HOUR, user: { ...makeUser(), rol: 'superusuario' } },
    ],
    [
      'a user with no id',
      { token: 'x', expiresAt: Date.now() + HOUR, user: { ...makeUser(), id: undefined } },
    ],
    [
      'a user with no name',
      { token: 'x', expiresAt: Date.now() + HOUR, user: { ...makeUser(), nombre: 7 } },
    ],
    [
      'a user with no address',
      { token: 'x', expiresAt: Date.now() + HOUR, user: { ...makeUser(), email: null } },
    ],
  ]

  it.each(bad)('ignores %s', async (_name, value) => {
    const session = await load()
    window.sessionStorage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value))
    expect(session.loadSession()).toBeNull()
    expect(session.getToken()).toBeNull()
  })

  it.each(['administrador', 'operador', 'consulta'] as const)(
    'accepts the role %s',
    async (role) => {
      const session = await load()
      session.saveSession(stored({ user: makeUser(role) }))
      expect(session.loadSession()?.user.rol).toBe(role)
    },
  )
})

describe('session: when the browser will not store anything', () => {
  it('keeps the session for this tab when saving throws', async () => {
    const session = await load()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    session.saveSession(stored({ token: 'en memoria' }))
    expect(session.getToken()).toBe('en memoria')
  })

  it('keeps the session for this tab when sessionStorage cannot even be reached', async () => {
    const session = await load()
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    session.saveSession(stored({ token: 'sin almacenamiento' }))
    expect(session.getToken()).toBe('sin almacenamiento')
    session.clearSession()
    expect(session.getToken()).toBeNull()
  })

  it('forgets the copy in memory when clearing, or the person could not sign out', async () => {
    const session = await load()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    session.saveSession(stored())
    session.clearSession()
    expect(session.loadSession()).toBeNull()
  })

  it('prefers what is saved in the storage over an old copy in memory', async () => {
    const session = await load()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    session.saveSession(stored({ token: 'primero' }))
    setItem.mockRestore()
    session.saveSession(stored({ token: 'segundo' }))
    expect(session.getToken()).toBe('segundo')
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null').token).toBe('segundo')
  })
})

describe('session: ending it', () => {
  it('clears the session and tells everybody who listens, with the reason', async () => {
    const session = await load()
    const first = vi.fn()
    const second = vi.fn()
    session.onSessionEnded(first)
    session.onSessionEnded(second)
    session.saveSession(stored())

    session.endSession('rejected')

    expect(session.loadSession()).toBeNull()
    expect(first).toHaveBeenCalledExactlyOnceWith('rejected')
    expect(second).toHaveBeenCalledExactlyOnceWith('rejected')
  })

  it('passes on the other reason too', async () => {
    const session = await load()
    const listener = vi.fn()
    session.onSessionEnded(listener)
    session.endSession('expired')
    expect(listener).toHaveBeenCalledExactlyOnceWith('expired')
  })

  it('stops telling somebody who stopped listening', async () => {
    const session = await load()
    const kept = vi.fn()
    const dropped = vi.fn()
    session.onSessionEnded(kept)
    const stop = session.onSessionEnded(dropped)
    stop()
    session.endSession('rejected')
    expect(kept).toHaveBeenCalledTimes(1)
    expect(dropped).not.toHaveBeenCalled()
  })

  it('has cleared the session by the time the listeners hear about it', async () => {
    const session = await load()
    session.saveSession(stored())
    let seen: unknown = 'sin mirar'
    session.onSessionEnded(() => {
      seen = session.loadSession()
    })
    session.endSession('rejected')
    expect(seen).toBeNull()
  })

  it('works with nobody listening and nobody signed in', async () => {
    const session = await load()
    expect(() => session.endSession('expired')).not.toThrow()
  })
})
