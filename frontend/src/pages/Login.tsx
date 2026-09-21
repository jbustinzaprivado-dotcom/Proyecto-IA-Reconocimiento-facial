import { ScanFace } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { USE_MOCKS } from '../services/api'

// In a build for a server `import.meta.env.DEV` is false, so this is null and the simulated
// accounts are not even in the files that are published
const DemoAccounts = import.meta.env.DEV ? lazy(() => import('../components/DemoAccounts')) : null

const UNEXPECTED = 'Ocurrió un error inesperado.'
const INPUT =
  'mt-1 block w-full rounded-lg border border-muted bg-white px-3 py-2 text-ink disabled:opacity-50'

export default function Login() {
  const { signIn, notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit = email.trim() !== '' && password !== '' && !busy

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      // Nothing to do when it works: the app notices the session and leaves this page
      const problem = await signIn(email.trim(), password)
      if (problem !== null) setError(problem)
    } catch {
      setError(UNEXPECTED)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-line bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-brand">
          <ScanFace size={24} aria-hidden="true" />
          Reconocimiento facial
        </div>
        <h1 className="text-2xl font-semibold text-ink">Iniciar sesión</h1>

        {notice && (
          <p
            role="status"
            className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
          >
            {notice}
          </p>
        )}

        <form
          noValidate
          onSubmit={(event) => {
            void submit(event)
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="correo" className="block text-sm font-medium text-ink">
              Correo electrónico
            </label>
            <input
              id="correo"
              type="email"
              autoComplete="username"
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="clave" className="block text-sm font-medium text-ink">
              Contraseña
            </label>
            <input
              id="clave"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              className={INPUT}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {USE_MOCKS && DemoAccounts && (
          <Suspense fallback={null}>
            <DemoAccounts
              disabled={busy}
              onChoose={(address, secret) => {
                setEmail(address)
                setPassword(secret)
              }}
            />
          </Suspense>
        )}
      </div>
    </main>
  )
}
