import { ROLE_LABEL } from '../auth/roles'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../services/mockData'

interface DemoAccountsProps {
  disabled: boolean
  // Fills the sign-in form; it does not sign in
  onChoose: (email: string, password: string) => void
}

// The simulated accounts of `npm run dev`. Only the sign-in loads this, and only in development, so
// a build for a server has none of it
export default function DemoAccounts({ disabled, onChoose }: DemoAccountsProps) {
  return (
    <section aria-labelledby="demo-titulo" className="space-y-2 rounded-lg bg-tint p-3">
      <h2 id="demo-titulo" className="text-sm font-semibold text-ink">
        Cuentas de demostración
      </h2>
      <p className="text-sm text-muted">
        Datos simulados, solo para desarrollo. Contraseña de todas:{' '}
        <code className="rounded bg-white px-1">{DEMO_PASSWORD}</code>
      </p>
      <ul className="space-y-1 text-sm">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChoose(account.email, DEMO_PASSWORD)}
              className="font-medium text-brand underline disabled:opacity-50"
            >
              {ROLE_LABEL[account.rol]}
            </button>{' '}
            <span className="text-muted">({account.email})</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
