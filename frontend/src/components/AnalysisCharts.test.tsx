import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AnalysisBin, AnalysisDay, CurvePoint } from '../types/facial'
import DailyAttemptsChart from './DailyAttemptsChart'
import HistogramChart from './HistogramChart'
import ThresholdCurveChart from './ThresholdCurveChart'

// Recharts draws nothing without real layout, so what is checked here is what does not depend on
// it: the messages for "no data" and the text that describes each chart to a screen reader

const days = (counts: Array<[number, number]>): AnalysisDay[] =>
  counts.map(([coincidencias, rechazos], i) => ({
    fecha: `2026-09-${String(i + 1).padStart(2, '0')}`,
    coincidencias,
    rechazos,
  }))

const bins = (counts: Array<[number, number]>): AnalysisBin[] =>
  counts.map(([coincidencias, rechazos], i) => ({
    desde: i / 20,
    hasta: (i + 1) / 20,
    coincidencias,
    rechazos,
  }))

const curve: CurvePoint[] = Array.from({ length: 101 }, (_, i) => ({
  umbral: i / 100,
  coincidencias: 0,
  verdaderos_positivos: 0,
  falsos_positivos: 0,
  falsos_negativos: 0,
  verdaderos_negativos: 0,
  tasa_falsos_positivos: null,
  tasa_falsos_negativos: null,
}))

describe('DailyAttemptsChart', () => {
  it('says so when there is not a single attempt in the days shown', () => {
    render(
      <DailyAttemptsChart
        days={days([
          [0, 0],
          [0, 0],
        ])}
      />,
    )
    expect(screen.getByText('Aún no hay intentos en los últimos días.')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('says so when there are no days at all', () => {
    render(<DailyAttemptsChart days={[]} />)
    expect(screen.getByText('Aún no hay intentos en los últimos días.')).toBeTruthy()
  })

  it('describes the chart with the number of days and the totals', () => {
    render(
      <DailyAttemptsChart
        days={days([
          [2, 1],
          [0, 0],
          [3, 4],
        ])}
      />,
    )
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Intentos por día (3 días mostrados): 5 coincidencias y 5 rechazos',
    )
  })

  it('draws the chart for a single attempt too', () => {
    render(<DailyAttemptsChart days={days([[0, 1]])} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Intentos por día (1 día mostrado): 0 coincidencias y 1 rechazo',
    )
  })
})

describe('HistogramChart', () => {
  it('says so when there are no attempts', () => {
    render(
      <HistogramChart
        bins={bins([
          [0, 0],
          [0, 0],
        ])}
        threshold={0.5}
      />,
    )
    expect(screen.getByText('Aún no hay intentos para el histograma.')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('describes the chart with the number of attempts and the threshold', () => {
    render(
      <HistogramChart
        bins={bins([
          [1, 2],
          [3, 0],
        ])}
        threshold={0.4}
      />,
    )
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Histograma de similitud de 6 intentos, con el umbral en 0.40',
    )
  })

  it('describes it without a threshold when there is none', () => {
    render(<HistogramChart bins={bins([[1, 0]])} threshold={null} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Histograma de similitud de 1 intento',
    )
  })
})

describe('ThresholdCurveChart', () => {
  it('describes the chart and points to the numbers under it', () => {
    render(<ThresholdCurveChart curve={curve} current={0.4} simulated={0.6} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toContain('falsos positivos')
    expect(label).toContain('falsos negativos')
    expect(label).toContain('Los números de abajo')
  })

  it('draws with no threshold in use', () => {
    render(<ThresholdCurveChart curve={curve} current={null} simulated={0.5} />)
    expect(screen.getByRole('img')).toBeTruthy()
  })
})
