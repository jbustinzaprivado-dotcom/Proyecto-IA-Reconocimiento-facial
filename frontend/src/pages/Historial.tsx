import { useMemo, useState } from 'react'
import EtiquetaBadge from '../components/EtiquetaBadge'
import QueryState from '../components/QueryState'
import { useApi } from '../hooks/useApi'
import { getHistory } from '../services/api'
import { isCorrect } from '../utils/etiqueta'
import { formatDateTime, formatDecimal, formatPercent } from '../utils/format'

type ResultFilter = 'todos' | 'coincide' | 'no-coincide'
type EvaluationFilter = 'todos' | 'correcto' | 'error' | 'sin-evaluar'
const ALL_MODELS = ''

const FIELD = 'mt-1 rounded-lg border border-muted bg-white px-3 py-2 text-sm text-ink'

export default function Historial() {
  const { data, error, loading, reload } = useApi(getHistory)
  const [result, setResult] = useState<ResultFilter>('todos')
  const [query, setQuery] = useState('')
  const [model, setModel] = useState(ALL_MODELS)
  const [evaluation, setEvaluation] = useState<EvaluationFilter>('todos')

  // Each model has its own similarity scale, so they are told apart
  const models = useMemo(() => [...new Set((data ?? []).map((item) => item.modelo))].sort(), [data])

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    return [...(data ?? [])]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .filter((item) => result === 'todos' || (result === 'coincide') === item.coincide)
      .filter((item) => model === ALL_MODELS || item.modelo === model)
      .filter((item) => {
        if (evaluation === 'todos') return true
        if (item.etiqueta === null) return evaluation === 'sin-evaluar'
        if (evaluation === 'sin-evaluar') return false
        return (evaluation === 'correcto') === isCorrect(item.etiqueta)
      })
      .filter((item) => term === '' || (item.nombre ?? '').toLowerCase().includes(term))
  }, [data, result, query, model, evaluation])

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Historial</h1>

      <QueryState loading={loading} error={error} onRetry={reload}>
        {data && data.length === 0 && (
          <p className="text-sm text-muted">Aún no hay intentos registrados.</p>
        )}
        {data && data.length > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <label className="block text-sm font-medium text-ink">
                Resultado
                <select
                  value={result}
                  onChange={(event) => setResult(event.target.value as ResultFilter)}
                  className={`${FIELD} block`}
                >
                  <option value="todos">Todos</option>
                  <option value="coincide">Coincide</option>
                  <option value="no-coincide">No coincide</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-ink">
                Modelo
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className={`${FIELD} block`}
                >
                  <option value={ALL_MODELS}>Todos</option>
                  {models.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-ink">
                Evaluación
                <select
                  value={evaluation}
                  onChange={(event) => setEvaluation(event.target.value as EvaluationFilter)}
                  className={`${FIELD} block`}
                >
                  <option value="todos">Todas</option>
                  <option value="correcto">Correctos</option>
                  <option value="error">Errores</option>
                  <option value="sin-evaluar">Sin evaluar</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-ink">
                Persona
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por nombre"
                  className={`${FIELD} block w-64 max-w-full`}
                />
              </label>
              <p role="status" className="ml-auto text-sm text-muted">
                {rows.length} de {data.length} intentos
              </p>
            </div>

            {rows.length === 0 ? (
              <p className="text-sm text-muted">Ningún intento coincide con los filtros.</p>
            ) : (
              <div
                role="region"
                tabIndex={0}
                aria-label="Tabla de intentos"
                className="overflow-x-auto rounded-xl border border-line bg-white"
              >
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-tint text-ink">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Fecha
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Persona
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Similitud
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Distancia
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Umbral
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Resultado
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Probabilidad calibrada
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Modelo
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Etiqueta
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-ink">
                    {rows.map((item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {item.nombre ?? 'Sin candidato'}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{formatDecimal(item.similitud)}</td>
                        <td className="px-4 py-3 tabular-nums">{formatDecimal(item.distancia)}</td>
                        <td className="px-4 py-3 tabular-nums">{formatDecimal(item.umbral)}</td>
                        <td className="px-4 py-3">
                          {item.coincide ? (
                            <span className="inline-block rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                              Coincide
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                              No coincide
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                          {item.probabilidad_calibrada === null
                            ? 'Sin calibrar'
                            : formatPercent(item.probabilidad_calibrada)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{item.modelo}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {item.etiqueta ? (
                            <EtiquetaBadge etiqueta={item.etiqueta} />
                          ) : (
                            <span className="text-muted">Sin evaluar</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  )
}
