import { useApi } from '../hooks/useApi'
import { getModelMetrics } from '../services/api'
import { algorithmName } from '../utils/ml'
import AlgorithmComparison from './AlgorithmComparison'
import MetricsPanel from './MetricsPanel'
import QueryState from './QueryState'
import StatCard from './StatCard'
import { formatDecimal } from '../utils/format'

// What the trained model achieves, checked on people it had not seen
export default function ModelResults() {
  const metrics = useApi(getModelMetrics)

  return (
    <QueryState
      loading={metrics.loading}
      error={metrics.error}
      onRetry={metrics.reload}
      errorPrefix="No se pudieron leer los resultados del modelo:"
    >
      {metrics.data && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Algoritmo elegido:{' '}
            <strong className="text-ink">{algorithmName(metrics.data.algoritmo)}</strong>. Entrenado
            con {metrics.data.n_muestras} ejemplos de {metrics.data.personas} personas registradas y
            comprobado con personas que el modelo no había visto. Un intento cuenta como «candidato
            correcto» desde una probabilidad de 50 %.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Log-loss" value={formatDecimal(metrics.data.log_loss)} />
            <StatCard label="Brier" value={formatDecimal(metrics.data.brier)} />
          </div>
          <MetricsPanel metrics={metrics.data} caption="Matriz de confusión del modelo elegido" />
          <h3 className="text-base font-semibold text-ink">Comparación de los algoritmos</h3>
          <AlgorithmComparison results={metrics.data.comparacion} />
          <p className="text-sm text-muted">
            Cuanto más bajos el log-loss y el Brier, mejores las probabilidades. Estas cifras valen
            lo que valgan las etiquetas y la cantidad de ejemplos: con pocos son solo una primera
            impresión, y la probabilidad vale para esta cámara, estas personas y estas condiciones.
          </p>
        </div>
      )}
    </QueryState>
  )
}
