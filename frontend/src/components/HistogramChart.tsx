import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisBin } from '../types/facial'
import { binLabel, binOf, plural } from '../utils/analysis'
import { formatDecimal } from '../utils/format'

interface HistogramChartProps {
  bins: AnalysisBin[]
  threshold: number | null
}

const MATCHES = 'Coincidencias'
const REJECTIONS = 'Rechazos'

// How the similarities of the attempts are spread, matches apart from rejections
export default function HistogramChart({ bins, threshold }: HistogramChartProps) {
  const total = bins.reduce((sum, bin) => sum + bin.coincidencias + bin.rechazos, 0)
  if (total === 0) {
    return <p className="text-sm text-muted">Aún no hay intentos para el histograma.</p>
  }

  const data = bins.map((bin) => ({
    rango: binLabel(bin),
    [MATCHES]: bin.coincidencias,
    [REJECTIONS]: bin.rechazos,
  }))
  const marked = threshold === null ? null : binOf(bins, threshold)

  return (
    <div
      role="img"
      aria-label={`Histograma de similitud de ${plural(total, 'intento', 'intentos')}${
        threshold === null ? '' : `, con el umbral en ${formatDecimal(threshold)}`
      }`}
      className="h-72 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
          <XAxis dataKey="rango" stroke="var(--color-muted)" fontSize={11} interval={1} />
          <YAxis allowDecimals={false} stroke="var(--color-muted)" fontSize={12} />
          <Tooltip />
          <Legend formatter={(value) => <span className="text-ink">{value}</span>} />
          {marked && threshold !== null && (
            <ReferenceLine
              x={binLabel(marked)}
              stroke="var(--color-ink)"
              strokeDasharray="6 4"
              label={{
                value: `Umbral ${formatDecimal(threshold)}`,
                position: 'top',
                fill: 'var(--color-muted)',
                fontSize: 12,
              }}
            />
          )}
          <Bar dataKey={MATCHES} stackId="intentos" fill="var(--color-success)" />
          <Bar dataKey={REJECTIONS} stackId="intentos" fill="var(--color-danger)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
