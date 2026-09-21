import { CircleCheck } from 'lucide-react'
import type { MlAlgorithmResult } from '../types/facial'
import { percentOrDash } from '../utils/analysis'
import { formatDecimal } from '../utils/format'

interface AlgorithmComparisonProps {
  results: MlAlgorithmResult[]
}

const HEADERS = [
  'Algoritmo',
  'Log-loss',
  'Brier',
  'Precisión',
  'Recall',
  'F1',
  'Tasa de falsos positivos',
  'Tasa de falsos negativos',
]

// The three algorithms side by side: the lower the log-loss and the Brier score, the better the
// probabilities. The kept one says so in words, not only by its place or its color
export default function AlgorithmComparison({ results }: AlgorithmComparisonProps) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label="Comparación de los algoritmos"
      className="overflow-x-auto rounded-xl border border-line bg-white"
    >
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Comparación de los algoritmos</caption>
        <thead className="bg-tint text-ink">
          <tr>
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line text-ink">
          {results.map((result) => (
            <tr key={result.algoritmo} className={result.elegido ? 'bg-success-soft/40' : ''}>
              <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium">
                {result.nombre}
                {result.elegido && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                    <CircleCheck size={14} aria-hidden="true" />
                    Elegido
                  </span>
                )}
              </th>
              <td className="px-4 py-3 tabular-nums">{formatDecimal(result.log_loss)}</td>
              <td className="px-4 py-3 tabular-nums">{formatDecimal(result.brier)}</td>
              <td className="px-4 py-3 tabular-nums">{percentOrDash(result.precision)}</td>
              <td className="px-4 py-3 tabular-nums">{percentOrDash(result.recall)}</td>
              <td className="px-4 py-3 tabular-nums">{percentOrDash(result.f1)}</td>
              <td className="px-4 py-3 tabular-nums">
                {percentOrDash(result.tasa_falsos_positivos)}
              </td>
              <td className="px-4 py-3 tabular-nums">
                {percentOrDash(result.tasa_falsos_negativos)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
