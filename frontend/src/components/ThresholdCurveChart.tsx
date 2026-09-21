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
import type { CurvePoint } from '../types/facial'
import { formatDecimal, formatPercent } from '../utils/format'

interface ThresholdCurveChartProps {
  curve: CurvePoint[]
  // The threshold in use and the one being tried on the slider
  current: number | null
  simulated: number
}

const FALSE_POSITIVES = 'Falsos positivos'
const FALSE_NEGATIVES = 'Falsos negativos'

// The rate of each kind of mistake for every possible threshold: raising it trades one for the other
export default function ThresholdCurveChart({
  curve,
  current,
  simulated,
}: ThresholdCurveChartProps) {
  const data = curve.map((point) => ({
    umbral: formatDecimal(point.umbral),
    [FALSE_POSITIVES]: point.tasa_falsos_positivos,
    [FALSE_NEGATIVES]: point.tasa_falsos_negativos,
  }))

  return (
    <div
      role="img"
      aria-label="Tasa de falsos positivos y de falsos negativos para cada umbral posible. Los números de abajo dan el detalle del umbral que elijas"
      className="h-80 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
          <XAxis dataKey="umbral" stroke="var(--color-muted)" fontSize={12} interval={9} />
          <YAxis
            domain={[0, 1]}
            stroke="var(--color-muted)"
            fontSize={12}
            tickFormatter={(value: number) => formatPercent(value)}
          />
          <Tooltip
            formatter={(value, name) => [formatPercent(Number(value)), String(name)]}
            labelFormatter={(label) => `Umbral ${String(label)}`}
          />
          <Legend formatter={(value) => <span className="text-ink">{value}</span>} />
          {current !== null && (
            <ReferenceLine
              x={formatDecimal(current)}
              stroke="var(--color-ink)"
              strokeDasharray="6 4"
              label={{
                value: 'En uso',
                position: 'insideTopLeft',
                fill: 'var(--color-muted)',
                fontSize: 12,
              }}
            />
          )}
          <ReferenceLine
            x={formatDecimal(simulated)}
            stroke="var(--color-brand)"
            strokeWidth={2}
            label={{
              value: 'Simulado',
              position: 'insideTopRight',
              fill: 'var(--color-brand)',
              fontSize: 12,
            }}
          />
          <Line
            type="linear"
            dataKey={FALSE_POSITIVES}
            stroke="var(--color-danger)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="linear"
            dataKey={FALSE_NEGATIVES}
            stroke="var(--color-warning)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
