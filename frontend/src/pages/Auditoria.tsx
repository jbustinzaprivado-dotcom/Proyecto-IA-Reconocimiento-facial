import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { getAudit } from '../services/api'
import type { AuditEntry, AuditQuery } from '../types/auth'
import { actionLabel, AUDIT_ACTIONS, AUDIT_RESULTS, resultLabel } from '../utils/audit'
import { formatFullDateTime } from '../utils/format'

const UNEXPECTED = 'Ocurrió un error inesperado.'
const FIELD =
  'mt-1 block w-full rounded-lg border border-muted bg-white px-3 py-2 text-sm text-ink disabled:opacity-50'
const SECONDARY =
  'rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50'

interface Filters {
  usuario: string
  accion: string
  resultado: string
  // The value of a date-and-time field: local time, no zone
  desde: string
}

const NO_FILTERS: Filters = { usuario: '', accion: '', resultado: '', desde: '' }

// What the API is asked for. A blank filter is not sent
function toQuery(filters: Filters): AuditQuery {
  const query: AuditQuery = {}
  if (filters.usuario.trim() !== '') query.usuario = filters.usuario.trim()
  if (filters.accion !== '') query.accion = filters.accion
  if (filters.resultado !== '') query.resultado = filters.resultado
  if (filters.desde !== '') {
    const since = new Date(filters.desde)
    // The field is in the time of the person: the API needs it with its zone
    if (!Number.isNaN(since.getTime())) query.desde = since.toISOString()
  }
  return query
}

// What was asked for: a new object each time, so that asking again with the same filters is a new
// request
interface Request {
  filters: Filters
  attempt: number
}

interface Loaded {
  request: Request
  rows: AuditEntry[]
  next: number | null
  error: string | null
  moreError: string | null
}

export default function Auditoria() {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [applied, setApplied] = useState<Filters>(NO_FILTERS)
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const request = useMemo<Request>(() => ({ filters: applied, attempt }), [applied, attempt])
  // What arrived answers the current request or an older one: only the first is shown
  const current = loaded !== null && loaded.request === request ? loaded : null
  const loading = current === null
  const rows = current?.rows ?? []
  const next = current?.next ?? null

  // The first page again whenever the filters change (or "Actualizar" is pressed)
  useEffect(() => {
    let cancelled = false
    const settle = (result: Omit<Loaded, 'request' | 'moreError'>) => {
      if (!cancelled) setLoaded({ request, moreError: null, ...result })
    }
    getAudit(toQuery(request.filters))
      .then((response) => {
        if (response.success) {
          settle({
            rows: response.resultado.registros,
            next: response.resultado.siguiente,
            error: null,
          })
        } else {
          settle({ rows: [], next: null, error: response.error })
        }
      })
      .catch(() => settle({ rows: [], next: null, error: UNEXPECTED }))
    return () => {
      cancelled = true
    }
  }, [request])

  async function loadMore() {
    if (current === null || current.next === null) return
    const asked = current
    // Only for the request that was on the screen: if the filters changed meanwhile, it is dropped
    const update = (change: (before: Loaded) => Loaded) =>
      setLoaded((before) =>
        before !== null && before.request === asked.request ? change(before) : before,
      )
    setLoadingMore(true)
    update((before) => ({ ...before, moreError: null }))
    try {
      const response = await getAudit({
        ...toQuery(asked.request.filters),
        antes_de_id: asked.next ?? undefined,
      })
      if (response.success) {
        update((before) => ({
          ...before,
          rows: [...before.rows, ...response.resultado.registros],
          next: response.resultado.siguiente,
        }))
      } else {
        update((before) => ({ ...before, moreError: response.error }))
      }
    } catch {
      update((before) => ({ ...before, moreError: UNEXPECTED }))
    } finally {
      setLoadingMore(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // A new object each time, so that pressing Filtrar again asks again
    setApplied({ ...draft })
  }

  function clear() {
    setDraft(NO_FILTERS)
    setApplied({ ...NO_FILTERS })
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Auditoría</h1>
        <button
          type="button"
          onClick={() => setAttempt((count) => count + 1)}
          disabled={loading || loadingMore}
          className={SECONDARY}
        >
          Actualizar
        </button>
      </div>
      <p className="text-sm text-muted">
        Quién hizo qué y cuándo. Solo se lee: no se puede cambiar ni borrar desde aquí. Nunca guarda
        contraseñas, tokens, nombres de personas ni imágenes.
      </p>

      <form noValidate onSubmit={submit} aria-label="Filtros" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="filtro-usuario" className="block text-sm font-medium text-ink">
              Usuario (parte del correo)
            </label>
            <input
              id="filtro-usuario"
              type="text"
              autoComplete="off"
              value={draft.usuario}
              onChange={(event) => setDraft({ ...draft, usuario: event.target.value })}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="filtro-accion" className="block text-sm font-medium text-ink">
              Acción
            </label>
            <select
              id="filtro-accion"
              value={draft.accion}
              onChange={(event) => setDraft({ ...draft, accion: event.target.value })}
              className={FIELD}
            >
              <option value="">Todas</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {actionLabel(action)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filtro-resultado" className="block text-sm font-medium text-ink">
              Resultado
            </label>
            <select
              id="filtro-resultado"
              value={draft.resultado}
              onChange={(event) => setDraft({ ...draft, resultado: event.target.value })}
              className={FIELD}
            >
              <option value="">Todos</option>
              {AUDIT_RESULTS.map((result) => (
                <option key={result} value={result}>
                  {resultLabel(result)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filtro-desde" className="block text-sm font-medium text-ink">
              Desde
            </label>
            <input
              id="filtro-desde"
              type="datetime-local"
              value={draft.desde}
              onChange={(event) => setDraft({ ...draft, desde: event.target.value })}
              className={FIELD}
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
          >
            Filtrar
          </button>
          <button type="button" onClick={clear} className={SECONDARY}>
            Quitar filtros
          </button>
        </div>
      </form>

      {loading ? (
        <p role="status" className="text-sm text-muted">
          Cargando…
        </p>
      ) : current.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
        >
          <span>{current.error}</span>
          <button
            type="button"
            onClick={() => setAttempt((count) => count + 1)}
            className="rounded-lg border border-danger px-3 py-1 font-medium hover:bg-white"
          >
            Reintentar
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No hay registros con estos filtros.</p>
      ) : (
        <>
          <div
            role="region"
            tabIndex={0}
            aria-label="Registro de auditoría"
            className="overflow-x-auto rounded-xl border border-line bg-white"
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Registro de auditoría, del más nuevo al más viejo
              </caption>
              <thead className="border-b border-line bg-tint text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Fecha
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Usuario
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Acción
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Resultado
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Detalle
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Dirección
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-muted">
                      {formatFullDateTime(row.created_at)}
                    </td>
                    <td className="px-4 py-2 text-ink">{row.usuario_email ?? 'Sin usuario'}</td>
                    <td className="px-4 py-2 text-ink">{actionLabel(row.accion)}</td>
                    <td className="px-4 py-2">
                      <span className={row.resultado === 'ok' ? 'text-success' : 'text-warning'}>
                        {resultLabel(row.resultado)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {[
                        row.recurso
                          ? `${row.recurso}${row.recurso_id === null ? '' : ` n.º ${row.recurso_id}`}`
                          : null,
                        row.detalle,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-muted">{row.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">
              {rows.length === 1 ? '1 registro' : `${rows.length} registros`}
              {next === null ? '.' : ' (hay más).'}
            </p>
            {next !== null && (
              <button
                type="button"
                onClick={() => {
                  void loadMore()
                }}
                disabled={loadingMore}
                className={SECONDARY}
              >
                {loadingMore ? 'Cargando…' : 'Cargar más'}
              </button>
            )}
          </div>
          {current?.moreError && (
            <p role="alert" className="text-sm text-danger">
              {current.moreError}
            </p>
          )}
        </>
      )}
    </section>
  )
}
