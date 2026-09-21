import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HistoryItem } from '../types/facial'
import { formatDateTime, formatDecimal, formatPercent } from '../utils/format'

interface ProbabilityChartProps {
  items: HistoryItem[]
}

const SIMILARITY = 'Similitud'
const PROBABILITY = 'Probabilidad calibrada'

export default function ProbabilityChart({ items }: ProbabilityChartProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">Aún no hay intentos para graficar.</p>
  }

  const ordered = [...items].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const data = ordered.map((item) => ({
    fecha: formatDateTime(item.created_at),
    [SIMILARITY]: item.similitud,
    [PROBABILITY]: item.probabilidad_calibrada,
  }))
  // The most recent attempt defines the threshold line
  const threshold = ordered[ordered.length - 1].umbral

  return (
    <div
      role="img"
      aria-label="Gráfico de similitud y probabilidad calibrada por intento, con la línea del umbral"
      className="h-80 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
          <XAxis dataKey="fecha" stroke="var(--color-muted)" fontSize={12} />
          <YAxis
            domain={[0, 1]}
            stroke="var(--color-muted)"
            fontSize={12}
            tickFormatter={(value: number) => formatDecimal(value)}
          />
          <Tooltip
            formatter={(value, name) => [
              name === PROBABILITY ? formatPercent(Number(value)) : formatDecimal(Number(value)),
              String(name),
            ]}
          />
          <Legend formatter={(value) => <span className="text-ink">{value}</span>} />
          <ReferenceLine
            y={threshold}
            stroke="var(--color-ink)"
            strokeDasharray="6 4"
            label={{
              value: `Umbral ${formatDecimal(threshold)}`,
              position: 'insideBottomRight',
              fill: 'var(--color-muted)',
              fontSize: 12,
            }}
          />
          <Line type="linear" dataKey={SIMILARITY} stroke="var(--color-brand)" strokeWidth={2} />
          <Line type="linear" dataKey={PROBABILITY} stroke="var(--color-accent)" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
