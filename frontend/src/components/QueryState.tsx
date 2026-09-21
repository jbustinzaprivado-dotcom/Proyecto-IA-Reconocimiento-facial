import type { ReactNode } from 'react'

interface QueryStateProps {
  loading: boolean
  error: string | null
  onRetry: () => void
  errorPrefix?: string
  children: ReactNode
}

export default function QueryState({
  loading,
  error,
  onRetry,
  errorPrefix,
  children,
}: QueryStateProps) {
  if (loading) {
    return (
      <p role="status" className="text-sm text-muted">
        Cargando…
      </p>
    )
  }
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
      >
        <span>{errorPrefix ? `${errorPrefix} ${error}` : error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-danger px-3 py-1 font-medium hover:bg-white"
        >
          Reintentar
        </button>
      </div>
    )
  }
  return <>{children}</>
}
