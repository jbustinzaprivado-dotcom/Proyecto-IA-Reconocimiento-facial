import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth, useUser } from '../auth/AuthContext'
import { ROLE_LABEL } from '../auth/roles'
import { changePassword } from '../services/api'
import { formatDateTime } from '../utils/format'
import { PASSWORD_MIN, validatePassword } from '../utils/password'

const UNEXPECTED = 'Ocurrió un error inesperado.'
const INPUT =
  'mt-1 block w-full max-w-sm rounded-lg border border-muted bg-white px-3 py-2 text-ink aria-invalid:border-danger disabled:opacity-50'

export default function Cuenta() {
  const user = useUser()
  const { adopt } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const nextError = validatePassword(next, user.email)
  const repeatError = repeat !== next ? 'Las contraseñas no coinciden.' : null
  const currentError = current === '' ? 'Escribe tu contraseña actual.' : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    setDone(false)
    if (currentError || nextError || repeatError || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await changePassword(current, next)
      if (response.success) {
        // The server ended the sessions made before: this tab carries on with the new one
        adopt(response.resultado)
        setCurrent('')
        setNext('')
        setRepeat('')
        setTouched(false)
        setDone(true)
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
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold text-ink">Mi cuenta</h1>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">Nombre</dt>
        <dd className="text-ink">{user.nombre}</dd>
        <dt className="text-muted">Correo</dt>
        <dd className="text-ink">{user.email}</dd>
        <dt className="text-muted">Rol</dt>
        <dd className="text-ink">{ROLE_LABEL[user.rol]}</dd>
        <dt className="text-muted">Último acceso</dt>
        <dd className="text-ink">
          {user.last_login_at ? formatDateTime(user.last_login_at) : 'Sin registro'}
        </dd>
      </dl>

      <section aria-labelledby="clave-titulo" className="space-y-4">
        <h2 id="clave-titulo" className="text-lg font-semibold text-ink">
          Cambiar contraseña
        </h2>
        <p className="text-sm text-muted">
          Usa al menos {PASSWORD_MIN} caracteres: una frase larga vale más que una palabra rara. Al
          cambiarla se cierran las demás sesiones abiertas con la contraseña anterior.
        </p>
        <form
          noValidate
          onSubmit={(event) => {
            void submit(event)
          }}
          className="space-y-4"
        >
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <div>
              <label htmlFor="clave-actual" className="block text-sm font-medium text-ink">
                Contraseña actual
              </label>
              <input
                id="clave-actual"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                aria-invalid={touched && currentError !== null}
                aria-describedby={touched && currentError ? 'clave-actual-error' : undefined}
                className={INPUT}
              />
              {touched && currentError && (
                <p id="clave-actual-error" className="mt-1 text-sm text-danger">
                  {currentError}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="clave-nueva" className="block text-sm font-medium text-ink">
                Contraseña nueva
              </label>
              <input
                id="clave-nueva"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                aria-invalid={touched && nextError !== null}
                aria-describedby={touched && nextError ? 'clave-nueva-error' : undefined}
                className={INPUT}
              />
              {touched && nextError && (
                <p id="clave-nueva-error" className="mt-1 text-sm text-danger">
                  {nextError}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="clave-repetida" className="block text-sm font-medium text-ink">
                Repite la contraseña nueva
              </label>
              <input
                id="clave-repetida"
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                aria-invalid={touched && repeatError !== null}
                aria-describedby={touched && repeatError ? 'clave-repetida-error' : undefined}
                className={INPUT}
              />
              {touched && repeatError && (
                <p id="clave-repetida-error" className="mt-1 text-sm text-danger">
                  {repeatError}
                </p>
              )}
            </div>
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
          </fieldset>
        </form>
        <div aria-live="polite" className="space-y-2">
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm font-medium text-success">
              Contraseña cambiada. Las demás sesiones se cerraron.
            </p>
          )}
        </div>
      </section>
    </section>
  )
}
