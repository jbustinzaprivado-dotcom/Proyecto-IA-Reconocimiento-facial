import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AuthState } from './auth/AuthContext'
import AuthProvider from './auth/AuthProvider'
import { makeUser } from './auth/fixtures'
import { asRole } from './auth/testWrappers'
import * as api from './services/api'
import { endSession, loadSession, saveSession } from './services/session'
import type { Role, SessionData } from './types/auth'

vi.mock('./services/api', () => ({ USE_MOCKS: false, login: vi.fn(), getMe: vi.fn() }))

// The pages are covered by their own tests: here each one is a stand-in with its heading
vi.mock('./pages/Dashboard', () => ({ default: () => <h1>Dashboard</h1> }))
vi.mock('./pages/RegistroFacial', () => ({ default: () => <h1>Registro facial</h1> }))
vi.mock('./pages/Reconocimiento', () => ({ default: () => <h1>Reconocimiento</h1> }))
vi.mock('./pages/Personas', () => ({ default: () => <h1>Personas</h1> }))
vi.mock('./pages/Probabilidades', () => ({ default: () => <h1>Probabilidades</h1> }))
vi.mock('./pages/EntrenamientoML', () => ({ default: () => <h1>Entrenamiento ML</h1> }))
vi.mock('./pages/Historial', () => ({ default: () => <h1>Historial</h1> }))
vi.mock('./pages/Usuarios', () => ({ default: () => <h1>Usuarios</h1> }))
vi.mock('./pages/Auditoria', () => ({ default: () => <h1>Auditoría</h1> }))
vi.mock('./pages/Cuenta', () => ({ default: () => <h1>Mi cuenta</h1> }))

function renderAt(path: string, role: Role = 'administrador', overrides: Partial<AuthState> = {}) {
  const SignedIn = asRole(role, overrides)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SignedIn>
        <App />
      </SignedIn>
    </MemoryRouter>,
  )
}

const heading = (name: string) => screen.findByRole('heading', { name })
const mainNav = () => screen.getByRole('navigation', { name: 'Principal' })
const labelsOf = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent)

const ALL_PAGES = [
  'Dashboard',
  'Registro facial',
  'Reconocimiento',
  'Personas',
  'Probabilidades',
  'Entrenamiento ML',
  'Historial',
  'Usuarios',
  'Auditoría',
]
const FOR_STAFF = ALL_PAGES.slice(0, 7)
const FOR_EVERYONE = ['Dashboard', 'Probabilidades', 'Entrenamiento ML', 'Historial']

describe('App: routes and titles', () => {
  it.each([
    ['/', 'Dashboard'],
    ['/registro', 'Registro facial'],
    ['/reconocimiento', 'Reconocimiento'],
    ['/personas', 'Personas'],
    ['/probabilidades', 'Probabilidades'],
    ['/entrenamiento', 'Entrenamiento ML'],
    ['/historial', 'Historial'],
    ['/usuarios', 'Usuarios'],
    ['/auditoria', 'Auditoría'],
    ['/cuenta', 'Mi cuenta'],
  ])('shows the page of %s and sets the tab title', async (path, name) => {
    renderAt(path)
    expect(await heading(name)).toBeTruthy()
    expect(document.title).toBe(`${name} · Reconocimiento facial`)
  })

  it('recognizes a trailing slash in the tab title', async () => {
    renderAt('/historial/')
    await heading('Historial')
    expect(document.title).toBe('Historial · Reconocimiento facial')
  })

  it('shows the 404 page for an unknown route, with a link back to the Dashboard', async () => {
    renderAt('/no-existe')
    expect(await heading('Página no encontrada')).toBeTruthy()
    expect(document.title).toBe('Página no encontrada · Reconocimiento facial')
    expect(screen.getByText('La dirección que abriste no existe.')).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: 'Ir al Dashboard' }))
    expect(await heading('Dashboard')).toBeTruthy()
    expect(document.title).toBe('Dashboard · Reconocimiento facial')
  })
})

describe('App: navigation', () => {
  it('lists the nine pages to the administrator and marks only the current one', async () => {
    renderAt('/historial')
    await heading('Historial')
    const links = within(mainNav()).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(ALL_PAGES)
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/registro',
      '/reconocimiento',
      '/personas',
      '/probabilidades',
      '/entrenamiento',
      '/historial',
      '/usuarios',
      '/auditoria',
    ])
    expect(
      links
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((l) => l.textContent),
    ).toEqual(['Historial'])
  })

  it('marks only the Dashboard link on the home route, not on every page', async () => {
    renderAt('/registro')
    await heading('Registro facial')
    expect(
      within(mainNav()).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current'),
    ).toBeNull()
  })

  it('navigates to another page when a link is clicked', async () => {
    renderAt('/')
    await heading('Dashboard')
    fireEvent.click(within(mainNav()).getByRole('link', { name: 'Probabilidades' }))
    expect(await heading('Probabilidades')).toBeTruthy()
    expect(document.title).toBe('Probabilidades · Reconocimiento facial')
  })

  it('offers a skip link that targets the main content', async () => {
    renderAt('/')
    await heading('Dashboard')
    expect(screen.getByRole('link', { name: 'Saltar al contenido' }).getAttribute('href')).toBe(
      '#contenido',
    )
    expect(document.querySelector('main#contenido')).toBeTruthy()
  })
})

describe('App: what each role sees', () => {
  it.each([
    ['administrador', ALL_PAGES],
    ['operador', FOR_STAFF],
    ['consulta', FOR_EVERYONE],
  ] as const)('shows the %s only the pages that role may open', async (role, pages) => {
    renderAt('/', role)
    await heading('Dashboard')
    expect(labelsOf(mainNav())).toEqual(pages)
  })

  it.each([
    ['consulta', '/registro'],
    ['consulta', '/reconocimiento'],
    ['consulta', '/personas'],
    ['consulta', '/usuarios'],
    ['consulta', '/auditoria'],
    ['operador', '/usuarios'],
    ['operador', '/auditoria'],
  ] as const)(
    'does not open %s the page %s: it says there is no permission',
    async (role, path) => {
      renderAt(path, role)
      expect(await heading('Sin permiso')).toBeTruthy()
      expect(screen.getByText('No tienes permiso para ver esta página.')).toBeTruthy()
      expect(document.title).toBe('Sin permiso · Reconocimiento facial')
      // The page itself is never put on the screen, not even for a moment
      expect(
        screen.queryByRole('heading', {
          name: /^(Usuarios|Auditoría|Personas|Registro facial|Reconocimiento)$/,
        }),
      ).toBeNull()
    },
  )

  it.each([
    ['operador', '/registro', 'Registro facial'],
    ['operador', '/reconocimiento', 'Reconocimiento'],
    ['operador', '/personas', 'Personas'],
    ['consulta', '/historial', 'Historial'],
    ['consulta', '/probabilidades', 'Probabilidades'],
    ['consulta', '/entrenamiento', 'Entrenamiento ML'],
    ['consulta', '/cuenta', 'Mi cuenta'],
    ['operador', '/cuenta', 'Mi cuenta'],
  ] as const)('opens for %s the page %s', async (role, path, name) => {
    renderAt(path, role)
    expect(await heading(name)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sin permiso' })).toBeNull()
  })

  it('leads from the page without permission back to the Dashboard', async () => {
    renderAt('/usuarios', 'consulta')
    await heading('Sin permiso')
    fireEvent.click(screen.getByRole('link', { name: 'Ir al Dashboard' }))
    expect(await heading('Dashboard')).toBeTruthy()
  })

  it('still says the page does not exist for an address that never did, whatever the role', async () => {
    renderAt('/usuarios/1', 'consulta')
    expect(await heading('Página no encontrada')).toBeTruthy()
  })
})

describe('App: the account box', () => {
  it('shows who is signed in and with which role', async () => {
    renderAt('/', 'operador', { user: makeUser('operador', { nombre: 'Omar Operador' }) })
    await heading('Dashboard')
    const box = screen.getAllByRole('group', { name: 'Tu cuenta' })[0]
    expect(within(box).getByText('Omar Operador')).toBeTruthy()
    expect(within(box).getByText('Operador')).toBeTruthy()
  })

  it('leads to the account page', async () => {
    renderAt('/')
    await heading('Dashboard')
    const box = screen.getAllByRole('group', { name: 'Tu cuenta' })[0]
    expect(within(box).getByRole('link', { name: 'Mi cuenta' }).getAttribute('href')).toBe(
      '/cuenta',
    )
    fireEvent.click(within(box).getByRole('link', { name: 'Mi cuenta' }))
    expect(await heading('Mi cuenta')).toBeTruthy()
  })

  it('signs out with the button', async () => {
    const signOut = vi.fn()
    renderAt('/', 'administrador', { signOut })
    await heading('Dashboard')
    const box = screen.getAllByRole('group', { name: 'Tu cuenta' })[0]
    fireEvent.click(within(box).getByRole('button', { name: 'Cerrar sesión' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('is also in the mobile menu, which closes when the account page is chosen', async () => {
    renderAt('/', 'operador')
    await heading('Dashboard')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    const menu = document.querySelector('#menu-movil') as HTMLElement
    expect(within(menu).getByRole('group', { name: 'Tu cuenta' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy()
    // The same pages as the side menu, and no others
    expect(labelsOf(within(menu).getByRole('navigation', { name: 'Principal' }))).toEqual(FOR_STAFF)

    fireEvent.click(within(menu).getByRole('link', { name: 'Mi cuenta' }))
    expect(await heading('Mi cuenta')).toBeTruthy()
    expect(document.querySelector('#menu-movil')).toBeNull()
  })
})

describe('App: without a session', () => {
  const signedOut = { status: 'anonymous', user: null } as const

  it.each(['/ingresar', '/usuarios', '/historial', '/cuenta', '/no-existe'])(
    'shows the sign-in on %s, with none of the app around it',
    async (path) => {
      renderAt(path, 'administrador', signedOut)
      expect(await heading('Iniciar sesión')).toBeTruthy()
      expect(document.title).toBe('Iniciar sesión · Reconocimiento facial')
      expect(screen.queryByRole('navigation')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull()
    },
  )

  it('never shows the app to an anonymous status, even if a user was left in the state', async () => {
    renderAt('/usuarios', 'administrador', { status: 'anonymous' })
    expect(await heading('Iniciar sesión')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Usuarios' })).toBeNull()
  })

  it('says why the person is here when the session ended', async () => {
    renderAt('/', 'administrador', {
      ...signedOut,
      notice: 'Tu sesión venció. Inicia sesión otra vez.',
    })
    expect((await screen.findByRole('status')).textContent).toBe(
      'Tu sesión venció. Inicia sesión otra vez.',
    )
  })

  it('does not show the app while a saved session is still being checked', async () => {
    renderAt('/usuarios', 'administrador', { status: 'loading' })
    expect((await screen.findByRole('status')).textContent).toBe('Comprobando tu sesión…')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Usuarios' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).toBeNull()
    expect(document.title).toBe('Reconocimiento facial')
  })
})

describe('App: mobile menu', () => {
  const openButton = () => screen.getByRole('button', { name: 'Abrir menú' })
  const menu = () => document.querySelector('#menu-movil')

  it('starts closed and toggles with the button', async () => {
    renderAt('/')
    await heading('Dashboard')
    expect(menu()).toBeNull()
    expect(openButton().getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(openButton())
    expect(menu()).toBeTruthy()
    const closeButton = screen.getByRole('button', { name: 'Cerrar menú' })
    expect(closeButton.getAttribute('aria-expanded')).toBe('true')
    expect(closeButton.getAttribute('aria-controls')).toBe('menu-movil')

    fireEvent.click(closeButton)
    expect(menu()).toBeNull()
  })

  it('closes with Escape', async () => {
    renderAt('/')
    await heading('Dashboard')
    fireEvent.click(openButton())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu()).toBeNull()
    expect(openButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes when choosing another page', async () => {
    renderAt('/')
    await heading('Dashboard')
    fireEvent.click(openButton())
    fireEvent.click(within(menu() as HTMLElement).getByRole('link', { name: 'Historial' }))
    expect(await heading('Historial')).toBeTruthy()
    expect(menu()).toBeNull()
  })

  it('closes when pressing the link of the page you are already on', async () => {
    renderAt('/historial')
    await heading('Historial')
    fireEvent.click(openButton())
    fireEvent.click(within(menu() as HTMLElement).getByRole('link', { name: 'Historial' }))
    await waitFor(() => expect(menu()).toBeNull())
  })
})

describe('App: the landing page', () => {
  const signedOut = { status: 'anonymous', user: null } as const

  it('is what someone without a session finds at the home address', async () => {
    renderAt('/', 'administrador', signedOut)
    expect(await heading('Aurora Biometrics')).toBeTruthy()
    expect(document.title).toBe('Aurora Biometrics · Reconocimiento facial')
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).toBeNull()
    // None of the app is around it
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull()
  })

  it('leads to the sign-in with the button, and the sign-in leads back', async () => {
    renderAt('/', 'administrador', signedOut)
    await heading('Aurora Biometrics')
    fireEvent.click(screen.getAllByRole('link', { name: 'Ingresar' })[0])
    expect(await heading('Iniciar sesión')).toBeTruthy()
    expect(document.title).toBe('Iniciar sesión · Reconocimiento facial')
    fireEvent.click(screen.getByRole('link', { name: 'Volver al inicio' }))
    expect(await heading('Aurora Biometrics')).toBeTruthy()
  })

  it('shows the sign-in, and not the landing, at the home address when the session ended', async () => {
    renderAt('/', 'administrador', {
      ...signedOut,
      notice: 'Tu sesión venció. Inicia sesión otra vez.',
    })
    expect(await heading('Iniciar sesión')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Tu sesión venció. Inicia sesión otra vez.')
    expect(screen.queryByRole('heading', { name: 'Aurora Biometrics' })).toBeNull()
    expect(document.title).toBe('Iniciar sesión · Reconocimiento facial')
  })

  it('is not there at any other address: those ask for the sign-in', async () => {
    renderAt('/historial', 'administrador', signedOut)
    expect(await heading('Iniciar sesión')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Aurora Biometrics' })).toBeNull()
  })

  it('is not shown to someone who is signed in: the sign-in address goes to the Dashboard', async () => {
    renderAt('/ingresar', 'operador')
    expect(await heading('Dashboard')).toBeTruthy()
    expect(document.title).toBe('Dashboard · Reconocimiento facial')
    expect(screen.queryByRole('heading', { name: 'Aurora Biometrics' })).toBeNull()
  })

  it('is not shown to someone who is signed in at the home address either', async () => {
    renderAt('/', 'consulta')
    expect(await heading('Dashboard')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Aurora Biometrics' })).toBeNull()
  })
})

// The real provider, with the API replaced: the whole way from the sign-in to the page
describe('App: from the sign-in to the page', () => {
  const session = (role: Role): SessionData => ({
    token: 'tok',
    tipo: 'Bearer',
    expira_en: 3600,
    usuario: makeUser(role, { nombre: `Persona ${role}` }),
  })

  function renderWithProvider(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    )
  }

  async function signIn() {
    fireEvent.change(await screen.findByLabelText('Correo electrónico'), {
      target: { value: 'ana@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'la clave' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  }

  beforeEach(() => {
    window.sessionStorage.clear()
    vi.mocked(api.login).mockReset()
    vi.mocked(api.getMe).mockReset()
  })

  it('opens the page that was asked for once the person signs in, with the role that came back', async () => {
    vi.mocked(api.login).mockResolvedValue({ success: true, resultado: session('administrador') })
    renderWithProvider('/usuarios')
    await signIn()
    expect(await heading('Usuarios')).toBeTruthy()
    expect(screen.getAllByText('Persona administrador').length).toBeGreaterThan(0)
    expect(loadSession()?.token).toBe('tok')
  })

  it('says there is no permission when the role that came back cannot open that page', async () => {
    vi.mocked(api.login).mockResolvedValue({ success: true, resultado: session('consulta') })
    renderWithProvider('/usuarios')
    await signIn()
    expect(await heading('Sin permiso')).toBeTruthy()
    expect(labelsOf(mainNav())).toEqual(FOR_EVERYONE)
  })

  it('stays on the sign-in, with the reason, when the server refuses it', async () => {
    vi.mocked(api.login).mockResolvedValue({
      success: false,
      error: 'Correo o contraseña incorrectos.',
    })
    renderWithProvider('/ingresar')
    await signIn()
    expect((await screen.findByRole('alert')).textContent).toBe('Correo o contraseña incorrectos.')
    expect(loadSession()).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('goes back to the sign-in, with nothing left of the app, when the person signs out', async () => {
    vi.mocked(api.login).mockResolvedValue({ success: true, resultado: session('administrador') })
    renderWithProvider('/usuarios')
    await signIn()
    await heading('Usuarios')
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar sesión' })[0])

    // No session and nothing to explain, on an address that is not the home one: the sign-in
    expect(await heading('Iniciar sesión')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Usuarios' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(loadSession()).toBeNull()
  })

  it('goes back to the sign-in, saying so, when the server stops accepting the session', async () => {
    vi.mocked(api.login).mockResolvedValue({ success: true, resultado: session('operador') })
    renderWithProvider('/ingresar')
    await signIn()
    await heading('Dashboard')

    // What the API layer does when a request that carried the token gets a 401
    act(() => endSession('rejected'))
    expect(await heading('Iniciar sesión')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(
      'Tu sesión no es válida o venció. Inicia sesión otra vez.',
    )
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('checks a session left by an earlier visit, and then opens the page', async () => {
    saveSession({
      token: 'guardado',
      expiresAt: Date.now() + 3_600_000,
      user: makeUser('consulta'),
    })
    vi.mocked(api.getMe).mockResolvedValue({ success: true, resultado: makeUser('operador') })
    renderWithProvider('/personas')
    expect(screen.getByText('Comprobando tu sesión…')).toBeTruthy()
    // The server says the role is now operador: that is the one that counts
    expect(await heading('Personas')).toBeTruthy()
    expect(api.login).not.toHaveBeenCalled()
  })

  it('shows the sign-in when the saved session is no longer valid', async () => {
    saveSession({
      token: 'viejo',
      expiresAt: Date.now() + 3_600_000,
      user: makeUser('administrador'),
    })
    vi.mocked(api.getMe).mockImplementation(() => {
      endSession('rejected')
      return Promise.resolve({ success: false, error: 'Tu sesión no es válida o venció.' })
    })
    renderWithProvider('/usuarios')
    expect(await heading('Iniciar sesión')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Tu sesión no es válida')
    expect(screen.queryByRole('heading', { name: 'Usuarios' })).toBeNull()
  })

  it('shows the landing after signing out from the home address, with nothing to explain', async () => {
    vi.mocked(api.login).mockResolvedValue({ success: true, resultado: session('operador') })
    renderWithProvider('/ingresar')
    await signIn()
    await heading('Dashboard')
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar sesión' })[0])
    expect(await heading('Aurora Biometrics')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
