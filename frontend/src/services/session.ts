import type { Role, User } from '../types/auth'

// The session lives in sessionStorage: it ends when the tab is closed, and no other tab or site
// can read it. (Anything that can run script inside the page can still read it: see the README.)
const KEY = 'reconocimiento-facial.sesion'
const ROLES: readonly Role[] = ['administrador', 'operador', 'consulta']

export interface StoredSession {
  token: string
  // Milliseconds since 1970, when the token stops being valid
  expiresAt: number
  user: User
}

export type EndReason = 'expired' | 'rejected'

// Used only when the browser refuses to store anything (a private window, blocked site data)
let fallback: StoredSession | null = null
const listeners = new Set<(reason: EndReason) => void>()

function store(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) return false
  const user = value as Partial<Record<keyof User, unknown>>
  return (
    typeof user.id === 'number' &&
    typeof user.email === 'string' &&
    typeof user.nombre === 'string' &&
    typeof user.rol === 'string' &&
    (ROLES as readonly string[]).includes(user.rol)
  )
}

function isStored(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false
  const session = value as Partial<Record<keyof StoredSession, unknown>>
  return (
    typeof session.token === 'string' &&
    session.token !== '' &&
    typeof session.expiresAt === 'number' &&
    isUser(session.user)
  )
}

function read(): StoredSession | null {
  try {
    const raw = store()?.getItem(KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      return isStored(parsed) ? parsed : null
    }
  } catch {
    return null
  }
  return fallback
}

// The saved session, unless it is missing, damaged or past its time (which also removes it)
export function loadSession(now: number = Date.now()): StoredSession | null {
  const session = read()
  if (session === null) return null
  if (session.expiresAt <= now) {
    clearSession()
    return null
  }
  return session
}

export function saveSession(session: StoredSession): void {
  fallback = null
  try {
    store()?.setItem(KEY, JSON.stringify(session))
  } catch {
    fallback = session
  }
  // A browser that refuses to store still has to keep the session for this tab
  if (store() === null) fallback = session
}

export function clearSession(): void {
  fallback = null
  try {
    store()?.removeItem(KEY)
  } catch {
    // Nothing to remove if the browser does not let us reach it
  }
}

export function getToken(): string | null {
  return loadSession()?.token ?? null
}

// The session ended: the server did not accept the token, or its time was up
export function endSession(reason: EndReason): void {
  clearSession()
  listeners.forEach((listener) => listener(reason))
}

export function onSessionEnded(listener: (reason: EndReason) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
