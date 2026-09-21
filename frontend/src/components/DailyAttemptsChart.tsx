import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisDay } from '../types/facial'
import { formatDay, plural } from '../utils/analysis'

interface DailyAttemptsChartProps {
  days: AnalysisDay[]
}

const MATCHES = 'Coincidencias'
const REJECTIONS = 'Rechazos'

export default function DailyAttemptsChart({ days }: DailyAttemptsChartProps) {
  const matches = days.reduce((sum, day) => sum + day.coincidencias, 0)
  const rejections = days.reduce((sum, day) => sum + day.rechazos, 0)
  if (matches + rejections === 0) {
    return <p className="text-sm text-muted">Aún no hay intentos en los últimos días.</p>
  }

  const data = days.map((day) => ({
    dia: formatDay(day.fecha),
    [MATCHES]: day.coincidencias,
    [REJECTIONS]: day.rechazos,
  }))

  return (
    <div
      role="img"
      aria-label={`Intentos por día (${plural(days.length, 'día mostrado', 'días mostrados')}): ${plural(matches, 'coincidencia', 'coincidencias')} y ${plural(rejections, 'rechazo', 'rechazos')}`}
      className="h-72 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
          <XAxis dataKey="dia" stroke="var(--color-muted)" fontSize={12} />
          <YAxis allowDecimals={false} stroke="var(--color-muted)" fontSize={12} />
          <Tooltip />
          <Legend formatter={(value) => <span className="text-ink">{value}</span>} />
          <Bar dataKey={MATCHES} stackId="intentos" fill="var(--color-success)" />
          <Bar dataKey={REJECTIONS} stackId="intentos" fill="var(--color-danger)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
