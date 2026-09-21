import DailyAttemptsChart from '../components/DailyAttemptsChart'
import QueryState from '../components/QueryState'
import StatCard from '../components/StatCard'
import { useApi } from '../hooks/useApi'
import { getAnalysis, getDashboardSummary } from '../services/api'
import { formatPercent } from '../utils/format'

const NONE = '—'

export default function Dashboard() {
  const summary = useApi(getDashboardSummary)
  const analysis = useApi(getAnalysis)

  function reload() {
    summary.reload()
    analysis.reload()
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
        <button
          type="button"
          onClick={reload}
          disabled={summary.loading || analysis.loading}
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50"
        >
          Actualizar
        </button>
      </div>

      <QueryState loading={summary.loading} error={summary.error} onRetry={summary.reload}>
        {summary.data && (
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Personas registradas" value={summary.data.total_personas} />
            <StatCard label="Reconocimientos" value={summary.data.total_reconocimientos} />
            <StatCard label="Coincidencias" value={summary.data.total_coincidencias} />
            <StatCard
              label="Tasa de coincidencia"
              value={
                summary.data.total_reconocimientos === 0
                  ? NONE
                  : formatPercent(
                      summary.data.total_coincidencias / summary.data.total_reconocimientos,
                    )
              }
            />
          </div>
        )}
      </QueryState>

      <section aria-labelledby="por-dia-titulo" className="space-y-4">
        <h2 id="por-dia-titulo" className="text-lg font-semibold text-ink">
          Intentos por día
        </h2>
        <QueryState loading={analysis.loading} error={analysis.error} onRetry={analysis.reload}>
          {analysis.data && (
            <>
              {analysis.data.modelo && (
                <p className="text-sm text-muted">Modelo: {analysis.data.modelo}</p>
              )}
              <DailyAttemptsChart days={analysis.data.por_dia} />
            </>
          )}
        </QueryState>
      </section>
    </section>
  )
}
