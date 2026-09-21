import { createContext, useContext } from 'react'
import type { SessionData, User } from '../types/auth'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export interface AuthState {
  // "loading" while a session saved by an earlier visit is still being checked with the server
  status: AuthStatus
  user: User | null
  // Why the person is signed out, when it was not their doing (the session ended)
  notice: string | null
  // The text of the problem, or null when the sign-in worked
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => void
  // Keeps a new session, such as the one the server gives after a change of password
  adopt: (session: SessionData) => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth needs an AuthProvider around it')
  return value
}

// The user of a page that only opens for people who signed in
export function useUser(): User {
  const { user } = useAuth()
  if (user === null) throw new Error('useUser was used outside a session')
  return user
}
