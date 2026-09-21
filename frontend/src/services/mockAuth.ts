// Simulated accounts, users and audit log to work without a backend (VITE_USE_MOCKS=true, only in
// development). None of it is real: the passwords here are public
import type {
  AuditEntry,
  AuditPage,
  AuditQuery,
  Role,
  SessionData,
  User,
  UserCreate,
  UserUpdate,
} from '../types/auth'
import type { ApiResponse } from '../types/facial'
import { validatePassword } from '../utils/password'
import { loadSession } from './session'

const DELAY_MS = 400
const SESSION_SECONDS = 3600
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_MIN = 2
const NAME_MAX = 100
const AUDIT_DEFAULT = 100
const AUDIT_MAX = 200
const BAD_CREDENTIALS = 'Correo o contraseña incorrectos.'
const BAD_SESSION = 'Tu sesión no es válida o venció. Inicia sesión otra vez.'
const LAST_ADMIN = 'Debe quedar al menos un administrador activo.'

export const DEMO_PASSWORD = 'demo-clave-123'

export const DEMO_ACCOUNTS: { email: string; rol: Role }[] = [
  { email: 'admin@demo.test', rol: 'administrador' },
  { email: 'operador@demo.test', rol: 'operador' },
  { email: 'consulta@demo.test', rol: 'consulta' },
]

const users: User[] = [
  ['admin@demo.test', 'Ana Administradora', 'administrador', true],
  ['operador@demo.test', 'Omar Operador', 'operador', true],
  ['consulta@demo.test', 'Carla Consulta', 'consulta', true],
  ['baja@demo.test', 'Bruno Baja', 'consulta', false],
].map(([email, nombre, rol, activo], index): User => ({
  id: index + 1,
  email: String(email),
  nombre: String(nombre),
  rol: rol as Role,
  activo: Boolean(activo),
  created_at: '2026-09-01T09:00:00Z',
  last_login_at: null,
}))

const passwords = new Map<string, string>(users.map((user) => [user.email, DEMO_PASSWORD]))

const audit: AuditEntry[] = [
  ['admin@demo.test', 'login', 'ok', null, null, null, '2026-09-18T13:00:00Z'],
  ['admin@demo.test', 'usuario_crear', 'ok', 'usuario', 2, 'rol: operador', '2026-09-18T13:05:00Z'],
  ['operador@demo.test', 'login', 'ok', null, null, null, '2026-09-18T14:00:00Z'],
  ['operador@demo.test', 'persona_crear', 'ok', 'persona', 12, null, '2026-09-18T14:03:00Z'],
  [
    'operador@demo.test',
    'rostros_registrar',
    'ok',
    'persona',
    12,
    '4 imágenes',
    '2026-09-18T14:04:00Z',
  ],
  ['operador@demo.test', 'reconocimiento', 'ok', null, null, 'coincide', '2026-09-18T14:10:00Z'],
  [null, 'login', 'fallo', null, null, 'correo desconocido', '2026-09-19T08:30:00Z'],
  [
    'consulta@demo.test',
    'denegado',
    'denegado',
    null,
    null,
    'POST /api/personas',
    '2026-09-19T09:00:00Z',
  ],
  [
    'consulta@demo.test',
    'login',
    'bloqueado',
    null,
    null,
    'cuenta bloqueada',
    '2026-09-19T09:20:00Z',
  ],
  [
    'admin@demo.test',
    'entrenar',
    'fallo',
    'modelo',
    null,
    'No hay datos suficientes',
    '2026-09-19T10:00:00Z',
  ],
].map(([email, accion, resultado, recurso, recursoId, detalle, fecha], index): AuditEntry => ({
  id: index + 1,
  created_at: String(fecha),
  usuario_email: email === null ? null : String(email),
  accion: String(accion),
  recurso: recurso === null ? null : String(recurso),
  recurso_id: recursoId === null ? null : Number(recursoId),
  resultado: String(resultado),
  detalle: detalle === null ? null : String(detalle),
  ip: '127.0.0.1',
}))

function reply<T>(response: ApiResponse<T>): Promise<ApiResponse<T>> {
  return new Promise((resolve) => setTimeout(() => resolve(response), DELAY_MS))
}

function nextId(items: { id: number }[]): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1
}

// Whoever is signed in, as the simulated accounts know them (or nobody)
function actor(): User | undefined {
  const stored = loadSession()
  return stored ? users.find((user) => user.id === stored.user.id) : undefined
}

// Adds a row to the audit log, done by whoever is signed in
export function track(
  action: string,
  extra: { result?: string; resource?: string; resourceId?: number; detail?: string } = {},
  email: string | null = actor()?.email ?? null,
): void {
  audit.push({
    id: nextId(audit),
    created_at: new Date().toISOString(),
    usuario_email: email,
    accion: action,
    recurso: extra.resource ?? null,
    recurso_id: extra.resourceId ?? null,
    resultado: extra.result ?? 'ok',
    detalle: extra.detail ?? null,
    ip: '127.0.0.1',
  })
}

function sessionFor(user: User): SessionData {
  return {
    token: `simulado-${user.id}-${Date.now()}`,
    tipo: 'Bearer',
    expira_en: SESSION_SECONDS,
    usuario: structuredClone(user),
  }
}

export function login(email: string, password: string): Promise<ApiResponse<SessionData>> {
  const address = email.trim().toLowerCase()
  const user = users.find((candidate) => candidate.email === address)
  if (!user || !user.activo || passwords.get(address) !== password) {
    track(
      'login',
      { result: 'fallo', detail: user ? undefined : 'correo desconocido' },
      user?.email ?? address,
    )
    return reply<SessionData>({ success: false, error: BAD_CREDENTIALS })
  }
  user.last_login_at = new Date().toISOString()
  track('login', {}, user.email)
  return reply({ success: true, resultado: sessionFor(user) })
}

export function getMe(): Promise<ApiResponse<User>> {
  const user = actor()
  if (!user?.activo) return reply<User>({ success: false, error: BAD_SESSION })
  return reply({ success: true, resultado: structuredClone(user) })
}

export function changePassword(current: string, next: string): Promise<ApiResponse<SessionData>> {
  const user = actor()
  if (!user) return reply<SessionData>({ success: false, error: BAD_SESSION })
  if (passwords.get(user.email) !== current) {
    track('cambio_clave', { result: 'fallo', detail: 'contraseña actual incorrecta' })
    return reply<SessionData>({ success: false, error: 'La contraseña actual no es correcta.' })
  }
  const problem = validatePassword(next, user.email)
  if (problem) return reply<SessionData>({ success: false, error: problem })
  passwords.set(user.email, next)
  track('cambio_clave')
  return reply({ success: true, resultado: sessionFor(user) })
}

export function listUsers(): Promise<ApiResponse<User[]>> {
  const sorted = [...users].sort(
    (a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()) || a.id - b.id,
  )
  return reply({ success: true, resultado: structuredClone(sorted) })
}

function cleanName(value: string): string | null {
  const name = value.split(/\s+/).filter(Boolean).join(' ')
  return name.length >= NAME_MIN && name.length <= NAME_MAX ? name : null
}

export function createUser(data: UserCreate): Promise<ApiResponse<User>> {
  const email = data.email.trim().toLowerCase()
  const nombre = cleanName(data.nombre)
  if (!EMAIL_PATTERN.test(email)) {
    return reply<User>({ success: false, error: 'El correo no tiene un formato válido.' })
  }
  if (nombre === null) {
    return reply<User>({
      success: false,
      error: `El nombre debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres.`,
    })
  }
  const problem = validatePassword(data.clave, email)
  if (problem) return reply<User>({ success: false, error: problem })
  if (users.some((user) => user.email === email)) {
    return reply<User>({ success: false, error: 'Ya existe un usuario con ese correo.' })
  }
  const user: User = {
    id: nextId(users),
    email,
    nombre,
    rol: data.rol,
    activo: true,
    created_at: new Date().toISOString(),
    last_login_at: null,
  }
  users.push(user)
  passwords.set(email, data.clave)
  track('usuario_crear', { resource: 'usuario', resourceId: user.id, detail: `rol: ${user.rol}` })
  return reply({ success: true, resultado: structuredClone(user) })
}

function activeAdmins(): number {
  return users.filter((user) => user.rol === 'administrador' && user.activo).length
}

export function updateUser(id: number, changes: UserUpdate): Promise<ApiResponse<User>> {
  const user = users.find((candidate) => candidate.id === id)
  if (!user) return reply<User>({ success: false, error: 'El usuario no existe.' })
  if (changes.activo === false && user.id === actor()?.id) {
    return reply<User>({ success: false, error: 'No puedes desactivar tu propia cuenta.' })
  }
  const leavesAdministration =
    user.rol === 'administrador' &&
    user.activo &&
    (changes.activo === false || (changes.rol !== undefined && changes.rol !== 'administrador'))
  if (leavesAdministration && activeAdmins() <= 1) {
    return reply<User>({ success: false, error: LAST_ADMIN })
  }
  const done: string[] = []
  const name = changes.nombre === undefined ? null : cleanName(changes.nombre)
  if (changes.nombre !== undefined && name === null) {
    return reply<User>({
      success: false,
      error: `El nombre debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres.`,
    })
  }
  if (changes.clave !== undefined) {
    const problem = validatePassword(changes.clave, user.email)
    if (problem) return reply<User>({ success: false, error: problem })
  }
  if (name !== null && name !== user.nombre) {
    user.nombre = name
    done.push('nombre cambiado')
  }
  if (changes.rol !== undefined && changes.rol !== user.rol) {
    done.push(`rol: ${user.rol} → ${changes.rol}`)
    user.rol = changes.rol
  }
  if (changes.activo !== undefined && changes.activo !== user.activo) {
    user.activo = changes.activo
    done.push(changes.activo ? 'cuenta activada' : 'cuenta desactivada')
  }
  if (changes.clave !== undefined) {
    passwords.set(user.email, changes.clave)
    done.push('contraseña restablecida')
  }
  if (done.length === 0) return reply<User>({ success: false, error: 'No hay nada que cambiar.' })
  track('usuario_actualizar', { resource: 'usuario', resourceId: user.id, detail: done.join('; ') })
  return reply({ success: true, resultado: structuredClone(user) })
}

export function getAudit(query: AuditQuery): Promise<ApiResponse<AuditPage>> {
  const limit = Math.max(1, Math.min(query.limite ?? AUDIT_DEFAULT, AUDIT_MAX))
  const term = query.usuario?.trim().toLowerCase()
  const since = query.desde ? Date.parse(query.desde) : null
  const rows = [...audit]
    .reverse()
    .filter(
      (row) =>
        (!term || (row.usuario_email ?? '').toLowerCase().includes(term)) &&
        (!query.accion || row.accion === query.accion) &&
        (!query.resultado || row.resultado === query.resultado) &&
        (since === null || Date.parse(row.created_at) >= since) &&
        (query.antes_de_id === undefined || row.id < query.antes_de_id),
    )
  const page = rows.slice(0, limit)
  const next = rows.length > limit ? page[page.length - 1].id : null
  return reply({ success: true, resultado: { registros: structuredClone(page), siguiente: next } })
}
