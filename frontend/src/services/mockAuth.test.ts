import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeUser } from '../auth/fixtures'
import type { UserUpdate } from '../types/auth'
import type { ApiResponse } from '../types/facial'

// Each test gets a fresh copy of the module, because the simulated data is mutable state
async function load() {
  vi.resetModules()
  const [auth, session] = await Promise.all([import('./mockAuth'), import('./session')])
  return { auth, session }
}

async function settled<T>(promise: Promise<ApiResponse<T>>): Promise<ApiResponse<T>> {
  await vi.advanceTimersByTimeAsync(600)
  return promise
}

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success) throw new Error(response.error)
  return response.resultado
}

function errorOf<T>(response: ApiResponse<T>): string {
  if (response.success) throw new Error('It worked, and it should not have')
  return response.error
}

type Loaded = Awaited<ReturnType<typeof load>>

// Signed in as one of the simulated accounts, the way the app leaves the session after a sign-in
async function signedInAs(loaded: Loaded, email: string) {
  const session = unwrap(await settled(loaded.auth.login(email, loaded.auth.DEMO_PASSWORD)))
  loaded.session.saveSession({
    token: session.token,
    expiresAt: Date.now() + 3_600_000,
    user: session.usuario,
  })
  return session.usuario
}

beforeEach(() => {
  vi.useFakeTimers()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mockAuth: signing in', () => {
  it('has the three demo accounts, one per role, with the password that is shown', async () => {
    const { auth } = await load()
    expect(auth.DEMO_ACCOUNTS).toEqual([
      { email: 'admin@demo.test', rol: 'administrador' },
      { email: 'operador@demo.test', rol: 'operador' },
      { email: 'consulta@demo.test', rol: 'consulta' },
    ])
    expect(auth.DEMO_PASSWORD).toBe('demo-clave-123')
  })

  it.each([
    ['admin@demo.test', 'administrador'],
    ['operador@demo.test', 'operador'],
    ['consulta@demo.test', 'consulta'],
  ])('signs in %s as the %s, with a session that lasts an hour', async (email, role) => {
    const loaded = await load()
    const session = unwrap(await settled(loaded.auth.login(email, loaded.auth.DEMO_PASSWORD)))
    expect(session.usuario.rol).toBe(role)
    expect(session.usuario.email).toBe(email)
    expect(session.tipo).toBe('Bearer')
    expect(session.expira_en).toBe(3600)
    expect(session.token).not.toBe('')
    // The simulated session is the user without a password of any kind
    expect(JSON.stringify(session)).not.toContain('demo-clave')
  })

  it('does not care about capitals or the spaces around the address', async () => {
    const { auth } = await load()
    const session = unwrap(await settled(auth.login('  ADMIN@Demo.Test ', auth.DEMO_PASSWORD)))
    expect(session.usuario.email).toBe('admin@demo.test')
  })

  it('marks the last time the user signed in', async () => {
    const { auth } = await load()
    expect(
      unwrap(await settled(auth.login('admin@demo.test', auth.DEMO_PASSWORD))).usuario
        .last_login_at,
    ).not.toBeNull()
  })

  it('gives the same answer for a wrong password, an unknown address and a deactivated account', async () => {
    const { auth } = await load()
    const wrong = errorOf(await settled(auth.login('admin@demo.test', 'otra clave')))
    const unknown = errorOf(await settled(auth.login('nadie@demo.test', auth.DEMO_PASSWORD)))
    const off = errorOf(await settled(auth.login('baja@demo.test', auth.DEMO_PASSWORD)))
    expect(wrong).toBe('Correo o contraseña incorrectos.')
    expect(unknown).toBe(wrong)
    expect(off).toBe(wrong)
  })

  it('records the attempts in the audit log, and never the password', async () => {
    const loaded = await load()
    await settled(loaded.auth.login('admin@demo.test', 'esta es la clave equivocada'))
    await settled(loaded.auth.login('nadie@demo.test', 'x'))
    const admin = await signedInAs(loaded, 'admin@demo.test')
    expect(admin.rol).toBe('administrador')
    const page = unwrap(await settled(loaded.auth.getAudit({ accion: 'login', limite: 3 })))
    expect(page.registros.map((row) => [row.usuario_email, row.resultado, row.detalle])).toEqual([
      ['admin@demo.test', 'ok', null],
      ['nadie@demo.test', 'fallo', 'correo desconocido'],
      ['admin@demo.test', 'fallo', null],
    ])
    expect(JSON.stringify(page)).not.toContain('equivocada')
  })
})

describe('mockAuth: who is signed in', () => {
  it('says who the session is for', async () => {
    const loaded = await load()
    await signedInAs(loaded, 'operador@demo.test')
    expect(unwrap(await settled(loaded.auth.getMe())).email).toBe('operador@demo.test')
  })

  it('refuses when nobody is signed in', async () => {
    const { auth } = await load()
    expect(errorOf(await settled(auth.getMe()))).toBe(
      'Tu sesión no es válida o venció. Inicia sesión otra vez.',
    )
  })

  it('refuses when the account was deactivated meanwhile', async () => {
    const loaded = await load()
    await signedInAs(loaded, 'admin@demo.test')
    loaded.session.saveSession({
      token: 'x',
      expiresAt: Date.now() + 3_600_000,
      user: makeUser('consulta', { id: 4, email: 'baja@demo.test' }),
    })
    expect(errorOf(await settled(loaded.auth.getMe()))).toContain('sesión')
  })
})

describe('mockAuth: changing the password', () => {
  it('needs the current password, and says when it is wrong', async () => {
    const loaded = await load()
    await signedInAs(loaded, 'operador@demo.test')
    const error = errorOf(
      await settled(loaded.auth.changePassword('otra', 'una clave nueva larga')),
    )
    expect(error).toBe('La contraseña actual no es correcta.')
    const [row] = unwrap(
      await settled(loaded.auth.getAudit({ accion: 'cambio_clave', limite: 1 })),
    ).registros
    expect([row.resultado, row.detalle]).toEqual(['fallo', 'contraseña actual incorrecta'])
  })

  it('applies the same rules as the server to the new one', async () => {
    const loaded = await load()
    await signedInAs(loaded, 'operador@demo.test')
    const { DEMO_PASSWORD } = loaded.auth
    expect(errorOf(await settled(loaded.auth.changePassword(DEMO_PASSWORD, 'corta')))).toBe(
      'La contraseña debe tener al menos 10 caracteres.',
    )
    expect(
      errorOf(await settled(loaded.auth.changePassword(DEMO_PASSWORD, 'operador@demo.test'))),
    ).toBe('La contraseña no puede ser igual al correo.')
  })

  it('gives a new session, and the new password works from then on', async () => {
    const loaded = await load()
    await signedInAs(loaded, 'operador@demo.test')
    const session = unwrap(
      await settled(loaded.auth.changePassword(loaded.auth.DEMO_PASSWORD, 'una clave nueva larga')),
    )
    expect(session.usuario.email).toBe('operador@demo.test')
    expect(
      errorOf(await settled(loaded.auth.login('operador@demo.test', loaded.auth.DEMO_PASSWORD))),
    ).toBe('Correo o contraseña incorrectos.')
    expect(
      unwrap(await settled(loaded.auth.login('operador@demo.test', 'una clave nueva larga')))
        .usuario.rol,
    ).toBe('operador')
  })

  it('needs a session', async () => {
    const { auth } = await load()
    expect(
      errorOf(await settled(auth.changePassword(auth.DEMO_PASSWORD, 'una clave nueva larga'))),
    ).toContain('sesión')
  })
})

describe('mockAuth: users', () => {
  const NEW = {
    email: 'nuevo@demo.test',
    nombre: 'Nuevo Usuario',
    rol: 'operador' as const,
    clave: 'una clave larga 1',
  }

  it('lists them by name, ignoring capitals', async () => {
    const { auth } = await load()
    const users = unwrap(await settled(auth.listUsers()))
    expect(users.map((user) => user.nombre)).toEqual([
      'Ana Administradora',
      'Bruno Baja',
      'Carla Consulta',
      'Omar Operador',
    ])
    expect(JSON.stringify(users)).not.toContain('demo-clave')
  })

  it('creates one, cleaning the name and the address, and it can sign in', async () => {
    const loaded = await load()
    const user = unwrap(
      await settled(
        loaded.auth.createUser({
          ...NEW,
          email: ' Nuevo@Demo.Test ',
          nombre: '  Nuevo   Usuario ',
        }),
      ),
    )
    expect(user).toMatchObject({
      email: 'nuevo@demo.test',
      nombre: 'Nuevo Usuario',
      rol: 'operador',
      activo: true,
    })
    expect(unwrap(await settled(loaded.auth.login('nuevo@demo.test', NEW.clave))).usuario.id).toBe(
      user.id,
    )
  })

  it.each([
    [{ email: 'no-es-un-correo' }, 'El correo no tiene un formato válido.'],
    [{ nombre: 'A' }, 'El nombre debe tener entre 2 y 100 caracteres.'],
    [{ clave: 'corta' }, 'La contraseña debe tener al menos 10 caracteres.'],
    [{ email: 'ADMIN@demo.test' }, 'Ya existe un usuario con ese correo.'],
  ])('refuses %j with the words of the server', async (change, message) => {
    const { auth } = await load()
    expect(errorOf(await settled(auth.createUser({ ...NEW, ...change })))).toBe(message)
    expect(unwrap(await settled(auth.listUsers()))).toHaveLength(4)
  })

  it('changes the name, the role and the state, and says what changed in the audit log', async () => {
    const loaded = await load()
    await signedInAs(loaded, 'admin@demo.test')
    const changed = unwrap(
      await settled(
        loaded.auth.updateUser(2, { nombre: ' Omar   Nuevo ', rol: 'consulta', activo: false }),
      ),
    )
    expect(changed).toMatchObject({ nombre: 'Omar Nuevo', rol: 'consulta', activo: false })
    const [row] = unwrap(
      await settled(loaded.auth.getAudit({ accion: 'usuario_actualizar', limite: 1 })),
    ).registros
    expect(row.detalle).toBe('nombre cambiado; rol: operador → consulta; cuenta desactivada')
    expect([row.usuario_email, row.recurso, row.recurso_id]).toEqual([
      'admin@demo.test',
      'usuario',
      2,
    ])
  })

  it('sets a new password, which is never written to the audit log', async () => {
    const loaded = await load()
    await settled(loaded.auth.updateUser(2, { clave: 'la clave restablecida 9' }))
    expect(
      unwrap(await settled(loaded.auth.login('operador@demo.test', 'la clave restablecida 9')))
        .usuario.id,
    ).toBe(2)
    const page = unwrap(await settled(loaded.auth.getAudit({ accion: 'usuario_actualizar' })))
    expect(page.registros[0].detalle).toBe('contraseña restablecida')
    expect(JSON.stringify(page)).not.toContain('restablecida 9')
  })

  it.each([
    [999, {}, 'El usuario no existe.'],
    [2, {}, 'No hay nada que cambiar.'],
    [2, { nombre: 'Omar Operador', rol: 'operador', activo: true }, 'No hay nada que cambiar.'],
    [2, { nombre: 'A' }, 'El nombre debe tener entre 2 y 100 caracteres.'],
    [2, { clave: 'corta' }, 'La contraseña debe tener al menos 10 caracteres.'],
  ] as [number, UserUpdate, string][])('refuses the change %#', async (id, change, message) => {
    const { auth } = await load()
    expect(errorOf(await settled(auth.updateUser(id, change)))).toBe(message)
  })

  it('does not let anybody deactivate their own account', async () => {
    const loaded = await load()
    await signedInAs(loaded, 'admin@demo.test')
    expect(errorOf(await settled(loaded.auth.updateUser(1, { activo: false })))).toBe(
      'No puedes desactivar tu propia cuenta.',
    )
  })

  it('keeps at least one active administrator', async () => {
    const loaded = await load()
    expect(errorOf(await settled(loaded.auth.updateUser(1, { rol: 'operador' })))).toBe(
      'Debe quedar al menos un administrador activo.',
    )
    expect(errorOf(await settled(loaded.auth.updateUser(1, { activo: false })))).toBe(
      'Debe quedar al menos un administrador activo.',
    )
    // With a second one, the first may step down
    await settled(loaded.auth.createUser({ ...NEW, rol: 'administrador' }))
    expect(unwrap(await settled(loaded.auth.updateUser(1, { rol: 'operador' }))).rol).toBe(
      'operador',
    )
  })

  it('does not count an inactive administrator, and lets it be changed', async () => {
    const loaded = await load()
    const second = unwrap(await settled(loaded.auth.createUser({ ...NEW, rol: 'administrador' })))
    await settled(loaded.auth.updateUser(second.id, { activo: false }))
    expect(errorOf(await settled(loaded.auth.updateUser(1, { rol: 'consulta' })))).toBe(
      'Debe quedar al menos un administrador activo.',
    )
    expect(unwrap(await settled(loaded.auth.updateUser(second.id, { rol: 'consulta' }))).rol).toBe(
      'consulta',
    )
  })
})

describe('mockAuth: the audit log', () => {
  it('is newest first, with the seed rows', async () => {
    const { auth } = await load()
    const page = unwrap(await settled(auth.getAudit({})))
    expect(page.registros).toHaveLength(10)
    expect(page.registros.map((row) => row.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(page.siguiente).toBeNull()
  })

  it('walks the pages with the next that each one gives', async () => {
    const { auth } = await load()
    const first = unwrap(await settled(auth.getAudit({ limite: 4 })))
    expect(first.registros.map((row) => row.id)).toEqual([10, 9, 8, 7])
    expect(first.siguiente).toBe(7)
    const second = unwrap(
      await settled(auth.getAudit({ limite: 4, antes_de_id: first.siguiente ?? 0 })),
    )
    expect(second.registros.map((row) => row.id)).toEqual([6, 5, 4, 3])
    const last = unwrap(
      await settled(auth.getAudit({ limite: 4, antes_de_id: second.siguiente ?? 0 })),
    )
    expect(last.registros.map((row) => row.id)).toEqual([2, 1])
    expect(last.siguiente).toBeNull()
  })

  it('says there is no next page when the last one is exactly full', async () => {
    const { auth } = await load()
    const page = unwrap(await settled(auth.getAudit({ limite: 10 })))
    expect(page.registros).toHaveLength(10)
    expect(page.siguiente).toBeNull()
  })

  it('never gives more than the biggest page, or fewer than one row', async () => {
    const { auth } = await load()
    expect(unwrap(await settled(auth.getAudit({ limite: 0 }))).registros).toHaveLength(1)
    expect(unwrap(await settled(auth.getAudit({ limite: 100000 }))).registros).toHaveLength(10)
  })

  it('filters by part of the address, ignoring capitals', async () => {
    const { auth } = await load()
    const page = unwrap(await settled(auth.getAudit({ usuario: ' OPERADOR ' })))
    expect(page.registros.map((row) => row.usuario_email)).toEqual(
      Array(4).fill('operador@demo.test'),
    )
  })

  it('a row with no user is never found by a part of an address', async () => {
    const { auth } = await load()
    const page = unwrap(await settled(auth.getAudit({ usuario: '@' })))
    expect(page.registros.every((row) => row.usuario_email !== null)).toBe(true)
  })

  it('filters by action and by result, exactly', async () => {
    const { auth } = await load()
    expect(unwrap(await settled(auth.getAudit({ accion: 'login' }))).registros).toHaveLength(4)
    expect(unwrap(await settled(auth.getAudit({ accion: 'logi' }))).registros).toHaveLength(0)
    const failed = unwrap(await settled(auth.getAudit({ resultado: 'fallo' }))).registros
    expect(failed.map((row) => row.accion)).toEqual(['entrenar', 'login'])
    expect(
      unwrap(await settled(auth.getAudit({ accion: 'login', resultado: 'bloqueado' }))).registros,
    ).toHaveLength(1)
  })

  it('filters from a moment on, that moment included', async () => {
    const { auth } = await load()
    const page = unwrap(await settled(auth.getAudit({ desde: '2026-09-19T09:00:00Z' })))
    expect(page.registros.map((row) => row.id)).toEqual([10, 9, 8])
    const after = unwrap(await settled(auth.getAudit({ desde: '2026-09-19T09:00:01Z' })))
    expect(after.registros.map((row) => row.id)).toEqual([10, 9])
  })

  it('gives a copy, so changing it does not alter the log', async () => {
    const { auth } = await load()
    unwrap(await settled(auth.getAudit({}))).registros[0].accion = 'cambiado'
    expect(unwrap(await settled(auth.getAudit({}))).registros[0].accion).toBe('entrenar')
  })

  it('adds a row with who did it, and no user when nobody is signed in', async () => {
    const loaded = await load()
    loaded.auth.track('persona_crear', { resource: 'persona', resourceId: 9 })
    await signedInAs(loaded, 'operador@demo.test')
    loaded.auth.track('persona_activar', { resource: 'persona', resourceId: 9 })
    const rows = unwrap(
      await settled(loaded.auth.getAudit({ accion: 'persona_activar' })),
    ).registros
    expect(rows[0].usuario_email).toBe('operador@demo.test')
    const created = unwrap(
      await settled(loaded.auth.getAudit({ accion: 'persona_crear', limite: 1 })),
    ).registros
    expect(created[0]).toMatchObject({ usuario_email: null, recurso_id: 9, resultado: 'ok' })
  })
})
