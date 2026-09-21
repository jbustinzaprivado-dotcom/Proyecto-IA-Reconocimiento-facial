import { useState } from 'react'
import type { FormEvent } from 'react'
import { useUser } from '../auth/AuthContext'
import { ROLE_LABEL, ROLE_OPTIONS } from '../auth/roles'
import QueryState from '../components/QueryState'
import { useApi } from '../hooks/useApi'
import { createUser, listUsers, updateUser } from '../services/api'
import type { Role, User, UserUpdate } from '../types/auth'
import { formatDateTime } from '../utils/format'
import { PASSWORD_MIN, validatePassword } from '../utils/password'

const UNEXPECTED = 'Ocurrió un error inesperado.'
const NAME_MIN = 2
const NAME_MAX = 100
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INPUT =
  'mt-1 block w-full rounded-lg border border-muted bg-white px-3 py-2 text-ink aria-invalid:border-danger disabled:opacity-50'
const PRIMARY =
  'rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY =
  'rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50'

interface Notice {
  kind: 'ok' | 'error'
  text: string
}

function sorted(users: User[]): User[] {
  return [...users].sort(
    (a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()) || a.id - b.id,
  )
}

function validateName(value: string): string | null {
  const name = value.split(/\s+/).filter(Boolean).join(' ')
  return name.length >= NAME_MIN && name.length <= NAME_MAX
    ? null
    : `El nombre debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres.`
}

function validateEmail(value: string): string | null {
  return EMAIL_PATTERN.test(value.trim()) ? null : 'Escribe un correo válido.'
}

export default function Usuarios() {
  const me = useUser()
  const loaded = useApi(listUsers)
  // The list is kept here and updated with what the server answers, so that nothing blinks or
  // loses the keyboard focus after each change
  const [users, setUsers] = useState<User[]>([])
  const [seen, setSeen] = useState<User[] | null>(null)
  if (loaded.data !== seen) {
    setSeen(loaded.data)
    setUsers(loaded.data ? sorted(loaded.data) : [])
  }
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const [resetting, setResetting] = useState<number | null>(null)

  function replace(updated: User) {
    setUsers((list) => sorted(list.map((user) => (user.id === updated.id ? updated : user))))
  }

  async function apply(user: User, changes: UserUpdate, done: string): Promise<boolean> {
    setPending(user.id)
    setNotice(null)
    try {
      const response = await updateUser(user.id, changes)
      if (response.success) {
        replace(response.resultado)
        setNotice({ kind: 'ok', text: done })
        return true
      }
      setNotice({ kind: 'error', text: response.error })
    } catch {
      setNotice({ kind: 'error', text: UNEXPECTED })
    } finally {
      setPending(null)
    }
    return false
  }

  return (
    <section className="space-y-10">
      <h1 className="text-2xl font-semibold text-ink">Usuarios</h1>

      <NewUser
        onCreated={(user) => {
          setUsers((list) => sorted([...list, user]))
          setNotice({ kind: 'ok', text: `Usuario creado: ${user.nombre}.` })
        }}
      />

      <section aria-labelledby="lista-titulo" className="space-y-4">
        <h2 id="lista-titulo" className="text-lg font-semibold text-ink">
          Cuentas
        </h2>
        <div aria-live="polite">
          {notice && (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`text-sm ${notice.kind === 'error' ? 'text-danger' : 'font-medium text-success'}`}
            >
              {notice.text}
            </p>
          )}
        </div>
        <QueryState loading={loaded.loading} error={loaded.error} onRetry={loaded.reload}>
          <div
            role="region"
            tabIndex={0}
            aria-label="Tabla de usuarios"
            className="overflow-x-auto rounded-xl border border-line bg-white"
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Cuentas de usuario</caption>
              <thead className="border-b border-line bg-tint text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Usuario
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Rol
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Último acceso
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isMe={user.id === me.id}
                    busy={pending === user.id}
                    resetting={resetting === user.id}
                    onRole={(role) => {
                      void apply(user, { rol: role }, `Rol de ${user.nombre}: ${ROLE_LABEL[role]}.`)
                    }}
                    onActive={(active) => {
                      void apply(
                        user,
                        { activo: active },
                        `${user.nombre}: cuenta ${active ? 'activada' : 'desactivada'}.`,
                      )
                    }}
                    onStartReset={() => setResetting(user.id)}
                    onCancelReset={() => setResetting(null)}
                    onReset={async (password) => {
                      const ok = await apply(
                        user,
                        { clave: password },
                        `Contraseña nueva para ${user.nombre}. Sus sesiones abiertas se cerraron.`,
                      )
                      if (ok) setResetting(null)
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </section>
    </section>
  )
}

interface UserRowProps {
  user: User
  isMe: boolean
  busy: boolean
  resetting: boolean
  onRole: (role: Role) => void
  onActive: (active: boolean) => void
  onStartReset: () => void
  onCancelReset: () => void
  onReset: (password: string) => Promise<void>
}

function UserRow({
  user,
  isMe,
  busy,
  resetting,
  onRole,
  onActive,
  onStartReset,
  onCancelReset,
  onReset,
}: UserRowProps) {
  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3">
          <p className="font-medium text-ink">
            {user.nombre}
            {isMe && (
              <span className="ml-2 rounded bg-tint px-1.5 py-0.5 text-xs text-brand">Tú</span>
            )}
          </p>
          <p className="text-muted">{user.email}</p>
        </td>
        <td className="px-4 py-3">
          <label>
            <span className="sr-only">Rol de {user.nombre}</span>
            <select
              value={user.rol}
              disabled={busy}
              onChange={(event) => onRole(event.target.value as Role)}
              className="rounded-lg border border-muted bg-white px-2 py-1 text-sm text-ink"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>
        </td>
        <td className="px-4 py-3">
          <span className={user.activo ? 'text-success' : 'text-warning'}>
            {user.activo ? 'Activa' : 'Desactivada'}
          </span>
        </td>
        <td className="px-4 py-3 text-muted">
          {user.last_login_at ? formatDateTime(user.last_login_at) : 'Nunca'}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || (isMe && user.activo)}
              title={isMe && user.activo ? 'No puedes desactivar tu propia cuenta' : undefined}
              aria-label={`${user.activo ? 'Desactivar' : 'Activar'} a ${user.nombre}`}
              onClick={() => onActive(!user.activo)}
              className={SECONDARY}
            >
              {user.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button
              type="button"
              disabled={busy || resetting}
              aria-label={`Nueva contraseña para ${user.nombre}`}
              onClick={onStartReset}
              className={SECONDARY}
            >
              Nueva contraseña
            </button>
          </div>
        </td>
      </tr>
      {resetting && (
        <tr className="border-b border-line bg-tint last:border-0">
          <td colSpan={5} className="px-4 py-3">
            <ResetForm user={user} busy={busy} onCancel={onCancelReset} onSave={onReset} />
          </td>
        </tr>
      )}
    </>
  )
}

function ResetForm({
  user,
  busy,
  onCancel,
  onSave,
}: {
  user: User
  busy: boolean
  onCancel: () => void
  onSave: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const problem = validatePassword(password, user.email)
  const id = `nueva-clave-${user.id}`

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (problem === null) void onSave(password)
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-wrap items-start gap-3">
      <div className="min-w-64 flex-1">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          Contraseña nueva para {user.nombre}
        </label>
        <input
          id={id}
          type="password"
          autoComplete="new-password"
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={touched && problem !== null}
          aria-describedby={touched && problem ? `${id}-error` : undefined}
          className={INPUT}
        />
        {touched && problem && (
          <p id={`${id}-error`} className="mt-1 text-sm text-danger">
            {problem}
          </p>
        )}
      </div>
      <div className="flex gap-2 pt-6">
        <button type="submit" disabled={busy} className={PRIMARY}>
          Guardar
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={SECONDARY}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function NewUser({ onCreated }: { onCreated: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState<Role>('operador')
  const [clave, setClave] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailError = validateEmail(email)
  const nameError = validateName(nombre)
  const passwordError = validatePassword(clave, email)
  const invalid = emailError ?? nameError ?? passwordError

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (invalid !== null || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await createUser({ email: email.trim(), nombre, rol, clave })
      if (response.success) {
        onCreated(response.resultado)
        setEmail('')
        setNombre('')
        setRol('operador')
        setClave('')
        setTouched(false)
      } else {
        setError(response.error)
      }
    } catch {
      setError(UNEXPECTED)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="nuevo-titulo" className="space-y-4">
      <h2 id="nuevo-titulo" className="text-lg font-semibold text-ink">
        Crear usuario
      </h2>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="usuario-nombre" className="block text-sm font-medium text-ink">
              Nombre
            </label>
            <input
              id="usuario-nombre"
              type="text"
              autoComplete="off"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              aria-invalid={touched && nameError !== null}
              aria-describedby={touched && nameError ? 'usuario-nombre-error' : undefined}
              className={INPUT}
            />
            {touched && nameError && (
              <p id="usuario-nombre-error" className="mt-1 text-sm text-danger">
                {nameError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="usuario-email" className="block text-sm font-medium text-ink">
              Correo electrónico
            </label>
            <input
              id="usuario-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={touched && emailError !== null}
              aria-describedby={touched && emailError ? 'usuario-email-error' : undefined}
              className={INPUT}
            />
            {touched && emailError && (
              <p id="usuario-email-error" className="mt-1 text-sm text-danger">
                {emailError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="usuario-rol" className="block text-sm font-medium text-ink">
              Rol
            </label>
            <select
              id="usuario-rol"
              value={rol}
              onChange={(event) => setRol(event.target.value as Role)}
              className={INPUT}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="usuario-clave" className="block text-sm font-medium text-ink">
              Contraseña inicial
            </label>
            <input
              id="usuario-clave"
              type="password"
              autoComplete="new-password"
              value={clave}
              onChange={(event) => setClave(event.target.value)}
              aria-invalid={touched && passwordError !== null}
              aria-describedby="usuario-clave-ayuda"
              className={INPUT}
            />
            <p
              id="usuario-clave-ayuda"
              className={`mt-1 text-sm ${touched && passwordError ? 'text-danger' : 'text-muted'}`}
            >
              {touched && passwordError
                ? passwordError
                : `Al menos ${PASSWORD_MIN} caracteres. Se la entregas tú a la persona; puede cambiarla en Mi cuenta.`}
            </p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={PRIMARY}>
              {busy ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
