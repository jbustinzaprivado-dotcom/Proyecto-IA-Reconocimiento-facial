import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse } from '../types/facial'

interface ApiState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

interface Settled<T> {
  attempt: number
  fetcher: () => Promise<ApiResponse<T>>
  data: T | null
  error: string | null
}

// The fetcher must be a stable reference (the functions of services/api.ts are). A new fetcher,
// for example for another model, starts over: the data of the old one is never shown as current.
// "loading" is derived: it is true until a result for the current attempt and fetcher arrives
export function useApi<T>(fetcher: () => Promise<ApiResponse<T>>): ApiState<T> {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetcher()
      .then((response) => {
        if (cancelled) return
        setSettled(
          response.success
            ? { attempt, fetcher, data: response.resultado, error: null }
            : { attempt, fetcher, data: null, error: response.error },
        )
      })
      .catch(() => {
        if (cancelled) return
        setSettled({ attempt, fetcher, data: null, error: 'Ocurrió un error inesperado.' })
      })
    return () => {
      cancelled = true
    }
  }, [fetcher, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  const current =
    settled !== null && settled.attempt === attempt && settled.fetcher === fetcher ? settled : null

  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
    reload,
  }
}
