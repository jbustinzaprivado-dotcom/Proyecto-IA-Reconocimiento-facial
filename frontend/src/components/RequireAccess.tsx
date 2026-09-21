import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '../auth/AuthContext'
import { canAccess } from '../auth/roles'
import type { Access } from '../auth/roles'

export function Forbidden() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink">Sin permiso</h1>
      <p className="text-sm text-muted">No tienes permiso para ver esta página.</p>
      <Link
        to="/"
        className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
      >
        Ir al Dashboard
      </Link>
    </section>
  )
}

// Shows the page only to the roles that may use it. The API refuses the rest anyway: this keeps
// people out of pages where everything would fail
export default function RequireAccess({
  access,
  children,
}: {
  access: Access
  children: ReactNode
}) {
  const user = useUser()
  return canAccess(user.rol, access) ? children : <Forbidden />
}
