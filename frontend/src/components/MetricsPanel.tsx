import type { ThresholdMetrics } from '../types/facial'
import { percentOrDash } from '../utils/analysis'
import StatCard from './StatCard'

// The numbers of the model (all present) fit here too: the ones that could not be worked out
// (nothing to divide by) come as null and show a dash
export type MetricsData = Omit<ThresholdMetrics, 'umbral'>

interface MetricsPanelProps {
  metrics: MetricsData
  // Names the table for whoever reads it with a screen reader
  caption?: string
}

export default function MetricsPanel({
  metrics,
  caption = 'Matriz de confusión',
}: MetricsPanelProps) {
  const [[tn, fp], [fn, tp]] = metrics.matriz_confusion
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Precisión" value={percentOrDash(metrics.precision)} />
        <StatCard label="Recall" value={percentOrDash(metrics.recall)} />
        <StatCard label="F1" value={percentOrDash(metrics.f1)} />
        <StatCard
          label="Tasa de falsos positivos"
          value={percentOrDash(metrics.tasa_falsos_positivos)}
        />
        <StatCard
          label="Tasa de falsos negativos"
          value={percentOrDash(metrics.tasa_falsos_negativos)}
        />
        <StatCard label="Muestras" value={metrics.n_muestras} />
      </div>
      <div
        role="region"
        tabIndex={0}
        aria-label={caption}
        className="overflow-x-auto rounded-xl border border-line bg-white"
      >
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-tint text-ink">
            <tr>
              <td className="px-4 py-3" />
              <th scope="col" className="px-4 py-3 font-medium">
                Predicho: no coincide
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Predicho: coincide
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-ink">
            <tr>
              <th scope="row" className="px-4 py-3 font-medium">
                Real: no coincide
              </th>
              <td className="px-4 py-3 tabular-nums">{tn}</td>
              <td className="px-4 py-3 tabular-nums">{fp}</td>
            </tr>
            <tr>
              <th scope="row" className="px-4 py-3 font-medium">
                Real: coincide
              </th>
              <td className="px-4 py-3 tabular-nums">{fn}</td>
              <td className="px-4 py-3 tabular-nums">{tp}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
