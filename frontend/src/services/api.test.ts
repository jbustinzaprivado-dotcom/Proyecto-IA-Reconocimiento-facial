// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

interface Seen {
  method: string
  url: string
  type: string
  body: string
  auth: string
}

let server: http.Server
let baseUrl: string
let seen: Seen[]

function reply(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const method = req.method ?? ''
      const url = req.url ?? ''
      seen.push({
        method,
        url,
        type: req.headers['content-type'] ?? '',
        body: Buffer.concat(chunks).toString('latin1'),
        auth: req.headers.authorization ?? '',
      })
      const key = `${method} ${url}`
      const auth = req.headers.authorization ?? ''
      const asked = Buffer.concat(chunks).toString('utf8')
      if (key === 'POST /api/auth/login') {
        if (asked.includes('"clave":"mala"'))
          return reply(res, 401, { success: false, error: 'Correo o contraseña incorrectos.' })
        return reply(res, 200, {
          success: true,
          resultado: { token: 'tok', tipo: 'Bearer', expira_en: 3600, usuario: { id: 1 } },
        })
      }
      if (key === 'GET /api/auth/yo') {
        if (auth === 'Bearer valido')
          return reply(res, 200, { success: true, resultado: { id: 1 } })
        return reply(res, 401, { success: false, error: 'Tu sesión no es válida o venció.' })
      }
      if (key === 'GET /api/usuarios')
        return reply(res, 403, { success: false, error: 'No tienes permiso para hacer esto.' })
      if (method === 'GET' && url.startsWith('/api/reportes/')) {
        if (auth === '') return reply(res, 401, { success: false, error: 'Sin sesión.' })
        if (auth === 'Bearer caducado')
          return reply(res, 401, { success: false, error: 'Tu sesión no es válida o venció.' })
        if (auth === 'Bearer consulta')
          return reply(res, 403, { success: false, error: 'No tienes permiso para hacer esto.' })
        if (url.includes('modelo=roto')) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          return res.end('boom')
        }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' })
        return res.end(Buffer.from('\uFEFFid,nombre\r\n1,Ana Torres\r\n', 'utf8'))
      }
      if (method === 'PATCH' || method === 'DELETE')
        return reply(res, 200, { success: true, resultado: { ok: true } })
      if (key === 'GET /api/personas') return reply(res, 200, { success: true, resultado: [] })
      if (key === 'GET /api/modelos/metricas')
        return reply(res, 404, { success: false, error: 'modelo no entrenado' })
      if (key === 'GET /api/dashboard/resumen') return reply(res, 200, { detail: 'x' })
      if (key === 'GET /api/modelos/estado')
        return reply(res, 200, { success: true, resultado: { entrenado: false } })
      if (method === 'GET' && url.startsWith('/api/analisis/resumen'))
        return reply(res, 200, { success: true, resultado: { total_intentos: 0 } })
      if (key === 'GET /api/reconocimiento/historial')
        return reply(res, 500, { detail: 'Internal Server Error' })
      if (method === 'POST') return reply(res, 200, { success: true, resultado: { ok: true } })
      return reply(res, 404, { detail: 'Not Found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  seen = []
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function loadApi(useMocks: 'true' | 'false', apiUrl = baseUrl) {
  vi.resetModules()
  vi.stubEnv('VITE_USE_MOCKS', useMocks)
  vi.stubEnv('VITE_API_URL', apiUrl)
  return import('./api')
}

const USER = {
  id: 1,
  email: 'ana@example.com',
  nombre: 'Ana',
  rol: 'administrador' as const,
  activo: true,
  created_at: '2026-09-01T09:00:00Z',
  last_login_at: null,
}

// The API and the session it reads, from the same copy of the modules, with someone signed in
async function loadSignedIn(token = 'valido') {
  vi.resetModules()
  vi.stubEnv('VITE_USE_MOCKS', 'false')
  vi.stubEnv('VITE_API_URL', baseUrl)
  const session = await import('./session')
  session.saveSession({ token, expiresAt: Date.now() + 60_000, user: USER })
  const api = await import('./api')
  return { api, session }
}

const blob = (text: string) => new Blob([text], { type: 'image/jpeg' })
const count = (text: string, needle: string) => text.split(needle).length - 1

describe('api (real mode)', () => {
  it('calls the real API and passes the envelope through', async () => {
    const api = await loadApi('false')
    expect(await api.listPersons()).toEqual({ success: true, resultado: [] })
    expect(seen[0].url).toBe('/api/personas')
  })

  it('keeps the server message when an error status carries the envelope', async () => {
    const api = await loadApi('false')
    expect(await api.getModelMetrics()).toEqual({ success: false, error: 'modelo no entrenado' })
  })

  it('reports an unexpected response for a body that is not the envelope', async () => {
    const api = await loadApi('false')
    expect(await api.getDashboardSummary()).toEqual({
      success: false,
      error: 'Respuesta inesperada del servidor',
    })
  })

  it('reports an unexpected response for a FastAPI { detail } error', async () => {
    const api = await loadApi('false')
    expect(await api.getHistory()).toEqual({
      success: false,
      error: 'Respuesta inesperada del servidor',
    })
  })

  it('reports a connection failure when the server is unreachable', async () => {
    const dead = http.createServer()
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`
    await new Promise((resolve) => dead.close(resolve))

    const api = await loadApi('false', url)
    expect(await api.listPersons()).toEqual({
      success: false,
      error: 'No se pudo conectar con el servidor',
    })
  })

  it('uploads the faces as multipart with the "imagenes" field, once per image', async () => {
    const api = await loadApi('false')
    await api.uploadFaces(7, [blob('uno'), blob('dos')])
    const request = seen[0]
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/api/personas/7/rostro')
    expect(request.type.startsWith('multipart/form-data')).toBe(true)
    expect(count(request.body, 'name="imagenes"')).toBe(2)
  })

  it('recognizes with the "imagen" field, once, and never "imagenes"', async () => {
    const api = await loadApi('false')
    await api.recognize(blob('captura'))
    const request = seen[0]
    expect(request.url).toBe('/api/reconocimiento')
    expect(request.type.startsWith('multipart/form-data')).toBe(true)
    expect(count(request.body, 'name="imagen"')).toBe(1)
    expect(count(request.body, 'name="imagenes"')).toBe(0)
  })

  it('sends who is expected only in the evaluation mode, in the "esperado" field', async () => {
    const api = await loadApi('false')
    await api.recognize(blob('captura'))
    expect(count(seen[0].body, 'name="esperado"')).toBe(0)

    await api.recognize(blob('captura'), '12')
    expect(count(seen[1].body, 'name="esperado"')).toBe(1)
    expect(seen[1].body).toMatch(/name="esperado"\r\n\r\n12\r\n/)
    expect(count(seen[1].body, 'name="imagen"')).toBe(1)

    await api.recognize(blob('captura'), 'desconocido')
    expect(seen[2].body).toMatch(/name="esperado"\r\n\r\ndesconocido\r\n/)
  })

  it('asks for the analysis with the offset of the viewer, and the model only if one is chosen', async () => {
    // Whatever the time zone of the machine, five hours behind UTC is an offset of -300 minutes
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300)
    const api = await loadApi('false')
    const offset = -300
    expect(await api.getAnalysis()).toEqual({ success: true, resultado: { total_intentos: 0 } })
    expect(seen[0].method).toBe('GET')
    expect(seen[0].url).toBe(`/api/analisis/resumen?desfase_minutos=${offset}`)

    await api.getAnalysis('sface-2021dec')
    expect(seen[1].url).toBe(`/api/analisis/resumen?modelo=sface-2021dec&desfase_minutos=${offset}`)
  })

  it('sends the JSON bodies of createPerson and predictProbability', async () => {
    const api = await loadApi('false')
    const person = { nombre: 'Ana', email: 'ana@example.com', consentimiento_version: 'v1' }
    await api.createPerson(person)
    expect(seen[0].url).toBe('/api/personas')
    expect(seen[0].type).toContain('application/json')
    expect(JSON.parse(seen[0].body)).toEqual(person)

    const input = { similitud: 0.9, distancia: 0.2, calidad_imagen: 0.7, iluminacion: 0.6 }
    await api.predictProbability(input)
    expect(seen[1].url).toBe('/api/probabilidades/prediccion')
    expect(JSON.parse(seen[1].body)).toEqual(input)
  })

  it('asks for the status of the probability model with GET /api/modelos/estado', async () => {
    const api = await loadApi('false')
    expect(await api.getMlStatus()).toEqual({ success: true, resultado: { entrenado: false } })
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/modelos/estado' })
  })

  it('trains the model with POST /api/modelos/entrenar', async () => {
    const api = await loadApi('false')
    await api.trainModel()
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/modelos/entrenar' })
  })
})

describe('api (simulated mode)', () => {
  it('tells the status of the probability model without the network', async () => {
    const api = await loadApi('true')
    const status = await api.getMlStatus()
    expect(status.success && status.resultado.entrenado).toBe(false)
    expect(status.success && status.resultado.datos_suficientes).toBe(false)
    expect(seen).toHaveLength(0)
  })

  it('evaluates, analyzes and makes the CSV files without the network', async () => {
    const api = await loadApi('true')
    const recognized = await api.recognize(blob('captura'), '12')
    expect(recognized.success && recognized.resultado.etiqueta).toBe('acierto')

    const analysis = await api.getAnalysis()
    expect(analysis.success && analysis.resultado.modelo).toBe('insightface-buffalo_l')
    expect((await api.getAnalysis('otro')).success).toBe(false)

    const file = await api.downloadCsv('historial')
    expect(file.success && file.resultado.filename).toBe('historial.csv')
    expect(seen).toHaveLength(0)
  })

  it('uses the simulated data and never touches the network', async () => {
    const api = await loadApi('true')
    const response = await api.listPersons()
    expect(response.success && response.resultado.length).toBe(5)
    expect(seen).toHaveLength(0)
  })
})

describe('api: the session', () => {
  it('sends the token of the session with every request, and nothing when there is none', async () => {
    const api = await loadApi('false')
    await api.listPersons()
    expect(seen[0].auth).toBe('')

    const signedIn = await loadSignedIn('valido')
    await signedIn.api.listPersons()
    expect(seen[1].auth).toBe('Bearer valido')
  })

  it('does not use a token that has expired', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_USE_MOCKS', 'false')
    vi.stubEnv('VITE_API_URL', baseUrl)
    const session = await import('./session')
    session.saveSession({ token: 'viejo', expiresAt: Date.now() - 1, user: USER })
    const api = await import('./api')
    await api.listPersons()
    expect(seen[0].auth).toBe('')
  })

  it('signs in with a JSON body, with no token, and gives back the session', async () => {
    const { api } = await loadSignedIn()
    const response = await api.login('ana@example.com', 'la clave')
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/auth/login' })
    expect(JSON.parse(seen[0].body)).toEqual({ email: 'ana@example.com', clave: 'la clave' })
    expect(response.success && response.resultado.token).toBe('tok')
  })

  it('keeps the message of a failed sign-in and does not end any session', async () => {
    const api = await loadApi('false')
    const ended = vi.fn()
    const session = await import('./session')
    session.onSessionEnded(ended)
    expect(await api.login('ana@example.com', 'mala')).toEqual({
      success: false,
      error: 'Correo o contraseña incorrectos.',
    })
    expect(ended).not.toHaveBeenCalled()
  })

  it('ends the session, and says so, when the server refuses the token', async () => {
    const { api, session } = await loadSignedIn('caducado')
    const ended = vi.fn()
    session.onSessionEnded(ended)
    const response = await api.getMe()
    expect(response).toEqual({ success: false, error: 'Tu sesión no es válida o venció.' })
    expect(ended).toHaveBeenCalledExactlyOnceWith('rejected')
    expect(session.loadSession()).toBeNull()
  })

  it('does not end a session that never existed when the server says 401', async () => {
    const api = await loadApi('false')
    const session = await import('./session')
    const ended = vi.fn()
    session.onSessionEnded(ended)
    await api.getMe()
    expect(ended).not.toHaveBeenCalled()
  })

  it('keeps the session when the answer is a refusal for permission (403)', async () => {
    const { api, session } = await loadSignedIn('valido')
    const ended = vi.fn()
    session.onSessionEnded(ended)
    expect(await api.listUsers()).toEqual({
      success: false,
      error: 'No tienes permiso para hacer esto.',
    })
    expect(ended).not.toHaveBeenCalled()
    expect(session.loadSession()?.token).toBe('valido')
  })

  it('asks who the session is for with GET /api/auth/yo', async () => {
    const { api } = await loadSignedIn('valido')
    expect(await api.getMe()).toEqual({ success: true, resultado: { id: 1 } })
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/auth/yo' })
  })

  it('changes the password with the names the API uses', async () => {
    const { api } = await loadSignedIn()
    await api.changePassword('la vieja', 'la nueva clave')
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/auth/cambiar-clave' })
    expect(JSON.parse(seen[0].body)).toEqual({
      clave_actual: 'la vieja',
      clave_nueva: 'la nueva clave',
    })
  })
})

describe('api: users, audit and people', () => {
  it('lists, creates and changes users', async () => {
    const { api } = await loadSignedIn()
    await api.listUsers()
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/usuarios' })

    const user = {
      email: 'o@example.com',
      nombre: 'Omar',
      rol: 'operador' as const,
      clave: 'x'.repeat(10),
    }
    await api.createUser(user)
    expect(seen[1]).toMatchObject({ method: 'POST', url: '/api/usuarios' })
    expect(JSON.parse(seen[1].body)).toEqual(user)

    await api.updateUser(5, { rol: 'consulta', activo: false })
    expect(seen[2]).toMatchObject({ method: 'PATCH', url: '/api/usuarios/5' })
    expect(JSON.parse(seen[2].body)).toEqual({ rol: 'consulta', activo: false })
  })

  it('asks for the audit log with only the filters that were given', async () => {
    const { api } = await loadSignedIn()
    await api.getAudit({})
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/auditoria' })
    await api.getAudit({ usuario: 'ana', accion: 'login', antes_de_id: 40, limite: 50 })
    expect(seen[1].url).toBe('/api/auditoria?usuario=ana&accion=login&antes_de_id=40&limite=50')
    await api.getAudit({ desde: '2026-09-01T12:00:00.000Z' })
    expect(seen[2].url).toBe('/api/auditoria?desde=2026-09-01T12:00:00.000Z')
  })

  it('activates, deactivates, deletes and cleans up people with the routes of the API', async () => {
    const { api } = await loadSignedIn()
    await api.setPersonActive(3, false)
    expect(seen[0]).toMatchObject({ method: 'PATCH', url: '/api/personas/3' })
    expect(JSON.parse(seen[0].body)).toEqual({ activo: false })

    await api.deletePerson(3)
    expect(seen[1]).toMatchObject({ method: 'DELETE', url: '/api/personas/3' })

    await api.purgePersons()
    expect(seen[2]).toMatchObject({ method: 'POST', url: '/api/personas/limpiar-sin-rostros' })
  })
})

describe('api: CSV files', () => {
  it('asks for the file with the session, and hands over its bytes untouched', async () => {
    const { api } = await loadSignedIn('valido')
    const response = await api.downloadCsv('historial')
    expect(seen[0]).toMatchObject({
      method: 'GET',
      url: '/api/reportes/historial.csv',
      auth: 'Bearer valido',
    })
    if (!response.success) throw new Error(response.error)
    expect(response.resultado.filename).toBe('historial.csv')
    const bytes = new Uint8Array(await response.resultado.blob.arrayBuffer())
    // The mark at the start (what tells Excel it is UTF-8) is still there
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('id,nombre\r\n1,Ana Torres\r\n')
    expect(response.resultado.blob.type).toContain('text/csv')
  })

  it('puts the model in the address only when there is one, encoded', async () => {
    const { api } = await loadSignedIn('valido')
    await api.downloadCsv('analisis')
    expect(seen[0].url).toBe('/api/reportes/analisis.csv')
    await api.downloadCsv('analisis', 'sface 2021')
    expect(seen[1].url).toBe('/api/reportes/analisis.csv?modelo=sface+2021')
  })

  it('reads the message of the API out of a failed download', async () => {
    const { api } = await loadSignedIn('consulta')
    expect(await api.downloadCsv('historial')).toEqual({
      success: false,
      error: 'No tienes permiso para hacer esto.',
    })
  })

  it('ends the session when the download is refused because of it', async () => {
    const { api, session } = await loadSignedIn('caducado')
    const ended = vi.fn()
    session.onSessionEnded(ended)
    expect(await api.downloadCsv('historial')).toEqual({
      success: false,
      error: 'Tu sesión no es válida o venció.',
    })
    expect(ended).toHaveBeenCalledExactlyOnceWith('rejected')
  })

  it('reports an unexpected response when the failure is not the JSON of the API', async () => {
    const { api } = await loadSignedIn('valido')
    expect(await api.downloadCsv('analisis', 'roto')).toEqual({
      success: false,
      error: 'Respuesta inesperada del servidor',
    })
  })

  it('reports a connection failure when the server is unreachable', async () => {
    const dead = http.createServer()
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`
    await new Promise((resolve) => dead.close(resolve))
    const api = await loadApi('false', url)
    expect(await api.downloadCsv('historial')).toEqual({
      success: false,
      error: 'No se pudo conectar con el servidor',
    })
  })
})

describe('api: simulated data only exist in development', () => {
  it('never uses them in a build for a server, whatever the variable says', async () => {
    vi.resetModules()
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_USE_MOCKS', 'true')
    vi.stubEnv('VITE_API_URL', baseUrl)
    const api = await import('./api')
    expect(api.USE_MOCKS).toBe(false)
    await api.listPersons()
    expect(seen).toHaveLength(1)
  })

  it('uses them in development when asked to', async () => {
    const api = await loadApi('true')
    expect(api.USE_MOCKS).toBe(true)
  })

  it('does not use them in development unless asked to', async () => {
    const api = await loadApi('false')
    expect(api.USE_MOCKS).toBe(false)
  })
})
