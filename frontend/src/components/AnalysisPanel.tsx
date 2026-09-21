import { TriangleAlert } from 'lucide-react'
import type { AnalysisSummary } from '../types/facial'
import { plural } from '../utils/analysis'
import { formatDecimal } from '../utils/format'
import HistogramChart from './HistogramChart'
import MetricsPanel from './MetricsPanel'
import ThresholdSimulator from './ThresholdSimulator'

interface AnalysisPanelProps {
  analysis: AnalysisSummary
}

function SmallSampleNotice({ analysis }: AnalysisPanelProps) {
  if (analysis.etiquetados === 0) {
    return (
      <p className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
        <TriangleAlert size={16} aria-hidden="true" className="mr-2 inline align-text-bottom" />
        Todavía no hay intentos evaluados de este modelo. Activa el «Modo evaluación» en
        Reconocimiento para que cada intento cuente como acierto o error.
      </p>
    )
  }
  if (!analysis.muestra_pequena) return null
  return (
    <p className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
      <TriangleAlert size={16} aria-hidden="true" className="mr-2 inline align-text-bottom" />
      Muestra pequeña: hay {plural(
        analysis.etiquetados,
        'intento evaluado',
        'intentos evaluados',
      )}{' '}
      ({analysis.etiquetados_persona} de personas registradas y {analysis.etiquetados_desconocido}{' '}
      de desconocidos). Las tasas de error son solo una primera impresión, no una medida fiable.
    </p>
  )
}

// The statistics of one model: how good it is at the threshold in use, what another threshold
// would do, and how the similarities of its attempts are spread
export default function AnalysisPanel({ analysis }: AnalysisPanelProps) {
  return (
    <div className="space-y-8">
      <SmallSampleNotice analysis={analysis} />

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-ink">
          Con el umbral en uso
          {analysis.umbral !== null && ` (${formatDecimal(analysis.umbral)})`}
        </h3>
        {analysis.metricas_umbral ? (
          <MetricsPanel
            metrics={analysis.metricas_umbral}
            caption="Matriz de confusión con el umbral en uso"
          />
        ) : (
          <p className="text-sm text-muted">Aún no hay intentos evaluados para medir errores.</p>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-ink">Simular otro umbral</h3>
        {/* Another model starts with its own threshold, so the slider starts over */}
        <ThresholdSimulator key={analysis.modelo ?? ''} analysis={analysis} />
      </div>

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-ink">Distribución de la similitud</h3>
        <HistogramChart bins={analysis.histograma} threshold={analysis.umbral} />
      </div>
    </div>
  )
}
