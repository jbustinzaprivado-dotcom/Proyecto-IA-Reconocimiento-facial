import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { Role } from '../types/auth'
import { AuthContext } from './AuthContext'
import type { AuthState } from './AuthContext'
import { makeUser } from './fixtures'

// A wrapper for `render` that puts a signed-in user of that role around the page, so a page can be
// tested without the provider (which asks the server who is signed in)
export function asRole(role: Role = 'administrador', overrides: Partial<AuthState> = {}) {
  const value: AuthState = {
    status: 'authenticated',
    user: makeUser(role),
    notice: null,
    signIn: () => Promise.resolve(null),
    signOut: () => {},
    adopt: () => {},
    ...overrides,
  }
  return function SignedIn({ children }: { children: ReactNode }) {
    return createElement(AuthContext.Provider, { value }, children)
  }
}
