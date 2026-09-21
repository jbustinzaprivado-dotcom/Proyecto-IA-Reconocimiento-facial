import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '../auth/AuthContext'
import { canAccess } from '../auth/roles'
import AnalysisPanel from '../components/AnalysisPanel'
import MetricsPanel from '../components/MetricsPanel'
import ProbabilityChart from '../components/ProbabilityChart'
import QueryState from '../components/QueryState'
import StatCard from '../components/StatCard'
import { useApi } from '../hooks/useApi'
import { downloadCsv, getAnalysis, getHistory, getModelMetrics } from '../services/api'
import type { CsvKind } from '../services/api'
import type { AnalysisModel, HistoryItem } from '../types/facial'
import { plural } from '../utils/analysis'
import { saveFile } from '../utils/download'
import { formatDecimal } from '../utils/format'
import { algorithmName } from '../utils/ml'

const NONE = '—'
const DOWNLOAD =
  'rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50'

function averageSimilarity(items: HistoryItem[]): string {
  if (items.length === 0) return NONE
  const total = items.reduce((sum, item) => sum + item.similitud, 0)
  return formatDecimal(total / items.length)
}

export default function Probabilidades() {
  const user = useUser()
  // The history has the names of the people: only whoever registers and recognizes may take it
  const canDownloadHistory = canAccess(user.rol, 'personal')
  const [downloading, setDownloading] = useState<CsvKind | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const history = useApi(getHistory)
  const metrics = useApi(getModelMetrics)

  // undefined: the model in use. Each model has its own similarity scale, so one at a time
  const [model, setModel] = useState<string | undefined>(undefined)
  const fetchAnalysis = useCallback(() => getAnalysis(model), [model])
  const analysis = useApi(fetchAnalysis)

  // The list of models is kept while another analysis loads, so the selector does not vanish
  // (and take the keyboard focus with it)
  const [models, setModels] = useState<AnalysisModel[]>([])
  if (analysis.data && analysis.data.modelos !== models) setModels(analysis.data.modelos)
  const shownModel = model ?? analysis.data?.modelo ?? ''

  // A CSV needs the session, so it cannot be a plain link: it is asked for and then saved
  async function download(kind: CsvKind) {
    setDownloading(kind)
    setDownloadError(null)
    try {
      const response = await downloadCsv(kind, model)
      if (response.success) saveFile(response.resultado.blob, response.resultado.filename)
      else setDownloadError(response.error)
    } catch {
      setDownloadError('Ocurrió un error inesperado.')
    } finally {
      setDownloading(null)
    }
  }

  const indicators = useMemo(() => {
    const items = history.data ?? []
    const latest = items.reduce<HistoryItem | null>(
      (best, item) =>
        best === null || Date.parse(item.created_at) > Date.parse(best.created_at) ? item : best,
      null,
    )
    return {
      threshold: latest ? formatDecimal(latest.umbral) : NONE,
      matches: averageSimilarity(items.filter((item) => item.coincide)),
      rejections: averageSimilarity(items.filter((item) => !item.coincide)),
    }
  }, [history.data])

  return (
    <section className="space-y-10">
      <h1 className="text-2xl font-semibold text-ink">Probabilidades</h1>

      <section aria-labelledby="intentos-titulo" className="space-y-4">
        <h2 id="intentos-titulo" className="text-lg font-semibold text-ink">
          Intentos y umbral
        </h2>
        <QueryState loading={history.loading} error={history.error} onRetry={history.reload}>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Umbral actual" value={indicators.threshold} />
            <StatCard label="Similitud promedio de coincidencias" value={indicators.matches} />
            <StatCard label="Similitud promedio de rechazos" value={indicators.rejections} />
          </div>
          <ProbabilityChart items={history.data ?? []} />
        </QueryState>
      </section>

      <section aria-labelledby="analisis-titulo" className="space-y-4">
        <h2 id="analisis-titulo" className="text-lg font-semibold text-ink">
          Análisis del umbral
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          {models.length > 1 ? (
            <label className="block text-sm font-medium text-ink">
              Modelo
              <select
                value={shownModel}
                onChange={(event) => setModel(event.target.value)}
                className="mt-1 block rounded-lg border border-muted bg-white px-3 py-2 text-sm text-ink"
              >
                {models.map((item) => (
                  <option key={item.modelo} value={item.modelo}>
                    {item.modelo} ({plural(item.intentos, 'intento', 'intentos')})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            shownModel !== '' && <p className="text-sm text-muted">Modelo: {shownModel}</p>
          )}
          <div className="ml-auto flex flex-wrap gap-3">
            {canDownloadHistory && (
              <button
                type="button"
                disabled={downloading !== null}
                onClick={() => {
                  void download('historial')
                }}
                className={DOWNLOAD}
              >
                {downloading === 'historial' ? 'Descargando…' : 'Descargar historial (CSV)'}
              </button>
            )}
            <button
              type="button"
              disabled={downloading !== null}
              onClick={() => {
                void download('analisis')
              }}
              className={DOWNLOAD}
            >
              {downloading === 'analisis' ? 'Descargando…' : 'Descargar análisis (CSV)'}
            </button>
          </div>
        </div>
        {canDownloadHistory && (
          <p className="text-sm text-muted">
            El CSV del historial incluye los nombres de las personas. No lo compartas sin
            autorización.
          </p>
        )}
        {downloadError && (
          <p role="alert" className="text-sm text-danger">
            {downloadError}
          </p>
        )}
        <QueryState loading={analysis.loading} error={analysis.error} onRetry={analysis.reload}>
          {analysis.data && <AnalysisPanel analysis={analysis.data} />}
        </QueryState>
      </section>

      <section aria-labelledby="modelo-titulo" className="space-y-4">
        <h2 id="modelo-titulo" className="text-lg font-semibold text-ink">
          Modelo de probabilidad
        </h2>
        <QueryState
          loading={metrics.loading}
          error={metrics.error}
          onRetry={metrics.reload}
          errorPrefix="Aún no hay métricas del modelo:"
        >
          {metrics.data && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Algoritmo elegido: {algorithmName(metrics.data.algoritmo)}. Entrenado con{' '}
                {metrics.data.n_muestras} ejemplos y comprobado con personas que no había visto.
              </p>
              <MetricsPanel metrics={metrics.data} />
            </div>
          )}
        </QueryState>
        <p className="text-sm">
          <Link to="/entrenamiento" className="font-medium text-brand underline">
            Ir a Entrenamiento ML
          </Link>{' '}
          para ver los datos, la comparación de los algoritmos o entrenar de nuevo.
        </p>
      </section>
    </section>
  )
}
