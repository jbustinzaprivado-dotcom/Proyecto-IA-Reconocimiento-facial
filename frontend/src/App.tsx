import {
  BrainCircuit,
  ChartLine,
  History,
  LayoutDashboard,
  Menu,
  ScanFace,
  ScrollText,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { canAccess, ROLE_LABEL } from './auth/roles'
import type { Access } from './auth/roles'
import RequireAccess from './components/RequireAccess'
import Login from './pages/Login'
import type { User } from './types/auth'

const Auditoria = lazy(() => import('./pages/Auditoria'))
const Cuenta = lazy(() => import('./pages/Cuenta'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const EntrenamientoML = lazy(() => import('./pages/EntrenamientoML'))
const Historial = lazy(() => import('./pages/Historial'))
const Personas = lazy(() => import('./pages/Personas'))
const Probabilidades = lazy(() => import('./pages/Probabilidades'))
const Reconocimiento = lazy(() => import('./pages/Reconocimiento'))
const RegistroFacial = lazy(() => import('./pages/RegistroFacial'))
const Usuarios = lazy(() => import('./pages/Usuarios'))

const APP_NAME = 'Reconocimiento facial'
const ACCOUNT_PATH = '/cuenta'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  access: Access
  page: ComponentType
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    access: 'todos',
    page: Dashboard,
    end: true,
  },
  {
    to: '/registro',
    label: 'Registro facial',
    icon: UserPlus,
    access: 'personal',
    page: RegistroFacial,
  },
  {
    to: '/reconocimiento',
    label: 'Reconocimiento',
    icon: ScanFace,
    access: 'personal',
    page: Reconocimiento,
  },
  { to: '/personas', label: 'Personas', icon: Users, access: 'personal', page: Personas },
  {
    to: '/probabilidades',
    label: 'Probabilidades',
    icon: ChartLine,
    access: 'todos',
    page: Probabilidades,
  },
  {
    to: '/entrenamiento',
    label: 'Entrenamiento ML',
    icon: BrainCircuit,
    access: 'todos',
    page: EntrenamientoML,
  },
  { to: '/historial', label: 'Historial', icon: History, access: 'todos', page: Historial },
  { to: '/usuarios', label: 'Usuarios', icon: UserCog, access: 'administrador', page: Usuarios },
  {
    to: '/auditoria',
    label: 'Auditoría',
    icon: ScrollText,
    access: 'administrador',
    page: Auditoria,
  },
]

function pageTitle(pathname: string, user: User | null): string {
  if (user === null) return `Iniciar sesión · ${APP_NAME}`
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === ACCOUNT_PATH) return `Mi cuenta · ${APP_NAME}`
  const item = NAV_ITEMS.find((entry) => entry.to === path)
  if (item && !canAccess(user.rol, item.access)) return `Sin permiso · ${APP_NAME}`
  return `${item ? item.label : 'Página no encontrada'} · ${APP_NAME}`
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold text-brand">
      <ScanFace size={24} aria-hidden="true" />
      {APP_NAME}
    </Link>
  )
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {items.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                isActive ? 'bg-tint text-brand' : 'text-ink hover:bg-tint'
              }`
            }
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

// Who is signed in, with the way to change the password and to sign out
function AccountBox({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const { signOut } = useAuth()
  return (
    <div
      aria-label="Tu cuenta"
      role="group"
      className="space-y-2 border-t border-line pt-4 text-sm"
    >
      <div>
        <p className="font-medium text-ink">{user.nombre}</p>
        <p className="text-muted">{ROLE_LABEL[user.rol]}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          to={ACCOUNT_PATH}
          onClick={onNavigate}
          className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-ink hover:bg-tint"
        >
          Mi cuenta
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-ink hover:bg-tint"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink">Página no encontrada</h1>
      <p className="text-sm text-muted">La dirección que abriste no existe.</p>
      <Link
        to="/"
        className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
      >
        Ir al Dashboard
      </Link>
    </section>
  )
}

export default function App() {
  const { status, user } = useAuth()
  const { pathname } = useLocation()
  // The menu is open only for the page it was opened on, so changing page closes it
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const menuOpen = menuPath === pathname
  // While a saved session is being checked there is nothing to say about the page yet
  const title =
    status === 'loading' ? APP_NAME : pageTitle(pathname, status === 'authenticated' ? user : null)

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPath(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  if (status === 'loading') {
    return (
      <p role="status" className="p-8 text-sm text-muted">
        Comprobando tu sesión…
      </p>
    )
  }
  if (status === 'anonymous' || user === null) return <Login />

  const items = NAV_ITEMS.filter((item) => canAccess(user.rol, item.access))

  return (
    <div className="min-h-screen bg-surface text-ink md:flex">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand"
      >
        Saltar al contenido
      </a>

      <aside className="hidden border-r border-line bg-white p-4 md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto">
        <Brand />
        <nav aria-label="Principal" className="mt-6 flex-1">
          <NavLinks items={items} />
        </nav>
        <AccountBox user={user} />
      </aside>

      <header className="sticky top-0 z-40 border-b border-line bg-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <button
            type="button"
            onClick={() => setMenuPath(menuOpen ? null : pathname)}
            aria-expanded={menuOpen}
            aria-controls="menu-movil"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
            className="rounded-lg p-2 text-ink hover:bg-tint"
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
        {menuOpen && (
          <div id="menu-movil" className="space-y-4 border-t border-line p-3">
            <nav aria-label="Principal">
              <NavLinks items={items} onNavigate={() => setMenuPath(null)} />
            </nav>
            <AccountBox user={user} onNavigate={() => setMenuPath(null)} />
          </div>
        )}
      </header>

      <main id="contenido" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-5xl">
          <Suspense
            fallback={
              <p role="status" className="text-sm text-muted">
                Cargando…
              </p>
            }
          >
            <Routes>
              {NAV_ITEMS.map(({ to, access, page: Page }) => (
                <Route
                  key={to}
                  path={to}
                  element={
                    <RequireAccess access={access}>
                      <Page />
                    </RequireAccess>
                  }
                />
              ))}
              <Route path={ACCOUNT_PATH} element={<Cuenta />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  )
}
