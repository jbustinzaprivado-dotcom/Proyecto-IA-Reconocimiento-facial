import { useState } from 'react'
import type { AnalysisSummary } from '../types/facial'
import { percentOrDash, pointAt, snapToHundredth } from '../utils/analysis'
import { formatDecimal } from '../utils/format'
import StatCard from './StatCard'
import ThresholdCurveChart from './ThresholdCurveChart'

interface ThresholdSimulatorProps {
  analysis: AnalysisSummary
}

// What would have happened with another threshold, over the attempts already made. It only shows:
// the threshold the system uses is changed in the configuration of the server, not from here
export default function ThresholdSimulator({ analysis }: ThresholdSimulatorProps) {
  const inUse = analysis.umbral === null ? null : snapToHundredth(analysis.umbral)
  const [chosen, setChosen] = useState<number | null>(null)
  const simulated = chosen ?? inUse ?? 0.5
  const point = pointAt(analysis.curva, simulated)
  const evaluated = analysis.etiquetados > 0

  return (
    <div className="space-y-4">
      <ThresholdCurveChart curve={analysis.curva} current={analysis.umbral} simulated={simulated} />

      <div className="space-y-3 rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-sm font-medium text-ink">
            Umbral simulado
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={simulated}
              onChange={(event) => setChosen(Number(event.target.value))}
              className="min-w-40 flex-1 accent-brand"
            />
            <output className="w-12 text-base font-semibold tabular-nums">
              {formatDecimal(simulated)}
            </output>
          </label>
          <button
            type="button"
            onClick={() => setChosen(null)}
            disabled={chosen === null || chosen === inUse}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50"
          >
            Volver al umbral en uso
          </button>
        </div>
        <p className="text-sm text-muted">
          Es solo una simulación con los intentos ya hechos. El umbral que usa el sistema se cambia
          en la configuración del servidor (archivo .env).
        </p>
      </div>

      {point && (
        <div
          role="group"
          aria-label={`Resultado con el umbral ${formatDecimal(simulated)}`}
          className="grid gap-4 sm:grid-cols-3"
        >
          <StatCard
            label="Coincidencias con este umbral"
            value={`${point.coincidencias} de ${analysis.total_intentos}`}
          />
          {evaluated && (
            <>
              <StatCard
                label="Falsos positivos"
                value={`${point.falsos_positivos} (${percentOrDash(point.tasa_falsos_positivos)})`}
              />
              <StatCard
                label="Falsos negativos"
                value={`${point.falsos_negativos} (${percentOrDash(point.tasa_falsos_negativos)})`}
              />
              <StatCard label="Verdaderos positivos" value={point.verdaderos_positivos} />
              <StatCard label="Verdaderos negativos" value={point.verdaderos_negativos} />
            </>
          )}
        </div>
      )}
      {evaluated && (
        <p className="text-sm text-muted">
          Las coincidencias se cuentan sobre todos los intentos del modelo (
          {analysis.total_intentos}); los falsos positivos y negativos, solo sobre los evaluados (
          {analysis.etiquetados}).
        </p>
      )}
      {!evaluated && (
        <p className="text-sm text-muted">
          Sin intentos evaluados solo se pueden contar las coincidencias. Los errores se cuentan con
          el «Modo evaluación» de Reconocimiento.
        </p>
      )}
    </div>
  )
}
