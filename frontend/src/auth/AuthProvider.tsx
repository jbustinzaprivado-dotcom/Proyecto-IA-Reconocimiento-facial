import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getMe, login } from '../services/api'
import { clearSession, loadSession, onSessionEnded, saveSession } from '../services/session'
import type { EndReason } from '../services/session'
import type { SessionData, User } from '../types/auth'
import { AuthContext } from './AuthContext'
import type { AuthState, AuthStatus } from './AuthContext'

export const SESSION_EXPIRED = 'Tu sesión venció. Inicia sesión otra vez.'
export const SESSION_REJECTED = 'Tu sesión no es válida o venció. Inicia sesión otra vez.'

interface Snapshot {
  status: AuthStatus
  user: User | null
  notice: string | null
  // When the token stops being valid, in milliseconds since 1970
  expiresAt: number | null
}

const SIGNED_OUT: Snapshot = { status: 'anonymous', user: null, notice: null, expiresAt: null }

function initial(): Snapshot {
  const stored = loadSession()
  if (stored === null) return SIGNED_OUT
  return { status: 'loading', user: stored.user, notice: null, expiresAt: stored.expiresAt }
}

function endedBy(reason: EndReason): Snapshot {
  return { ...SIGNED_OUT, notice: reason === 'expired' ? SESSION_EXPIRED : SESSION_REJECTED }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Snapshot>(initial)

  // The server refused the token, or the time of the session ran out
  useEffect(() => onSessionEnded((reason) => setState(endedBy(reason))), [])

  // A session saved by an earlier visit is trusted only after the server confirms it
  useEffect(() => {
    if (state.status !== 'loading') return
    let cancelled = false
    getMe()
      .then((response) => {
        if (cancelled) return
        const stored = loadSession()
        if (response.success && stored !== null) {
          saveSession({ ...stored, user: response.resultado })
          setState({ ...state, status: 'authenticated', user: response.resultado })
        } else if (stored !== null) {
          // Not a rejected token (that one ends the session by itself): the server could not say
          clearSession()
          const why = response.success ? '' : ` ${response.error}`
          setState({ ...SIGNED_OUT, notice: `No se pudo comprobar tu sesión.${why}` })
        } else {
          setState(SIGNED_OUT)
        }
      })
      .catch(() => {
        if (cancelled) return
        clearSession()
        setState({ ...SIGNED_OUT, notice: 'No se pudo comprobar tu sesión.' })
      })
    return () => {
      cancelled = true
    }
  }, [state])

  useEffect(() => {
    if (state.status !== 'authenticated' || state.expiresAt === null) return
    const wait = Math.max(0, state.expiresAt - Date.now())
    const timer = setTimeout(() => {
      clearSession()
      setState(endedBy('expired'))
    }, wait)
    return () => clearTimeout(timer)
  }, [state.status, state.expiresAt])

  const adopt = useCallback((session: SessionData) => {
    const expiresAt = Date.now() + session.expira_en * 1000
    saveSession({ token: session.token, expiresAt, user: session.usuario })
    setState({ status: 'authenticated', user: session.usuario, notice: null, expiresAt })
  }, [])

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const response = await login(email, password)
      if (!response.success) return response.error
      adopt(response.resultado)
      return null
    },
    [adopt],
  )

  const signOut = useCallback(() => {
    clearSession()
    setState(SIGNED_OUT)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      status: state.status,
      user: state.user,
      notice: state.notice,
      signIn,
      signOut,
      adopt,
    }),
    [state.status, state.user, state.notice, signIn, signOut, adopt],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
