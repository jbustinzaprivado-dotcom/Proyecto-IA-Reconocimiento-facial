import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AnalysisSummary, CurvePoint } from '../types/facial'
import AnalysisPanel from './AnalysisPanel'

// Recharts needs real layout, which jsdom does not have, so the charts are replaced by stand-ins
vi.mock('./ThresholdCurveChart', () => ({
  default: ({ simulated }: { simulated: number }) => <div data-testid="curve">{simulated}</div>,
}))
vi.mock('./HistogramChart', () => ({ default: () => <div data-testid="histogram" /> }))

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

const analysis = (modelo: string, umbral: number): AnalysisSummary => ({
  modelo,
  modelos: [{ modelo, intentos: 5 }],
  umbral,
  total_intentos: 5,
  total_coincidencias: 3,
  tasa_coincidencia: 0.6,
  similitud_promedio_coincidencias: 0.8,
  similitud_promedio_rechazos: 0.2,
  por_dia: [],
  histograma: [],
  curva: curve,
  etiquetados: 0,
  etiquetados_persona: 0,
  etiquetados_desconocido: 0,
  muestra_pequena: true,
  metricas_umbral: null,
})

describe('AnalysisPanel', () => {
  it('starts the slider over when the analysis is of another model, whatever the page does in between', () => {
    const { rerender } = render(<AnalysisPanel analysis={analysis('insightface', 0.4)} />)
    fireEvent.change(screen.getByLabelText('Umbral simulado'), { target: { value: '0.9' } })
    expect(screen.getByTestId('curve').textContent).toBe('0.9')

    // Without going through a loading state, as if the data of the other model were already there
    rerender(<AnalysisPanel analysis={analysis('sface', 0.36)} />)
    expect(screen.getByTestId('curve').textContent).toBe('0.36')
  })

  it('keeps the slider where it is while the same model is shown again', () => {
    const { rerender } = render(<AnalysisPanel analysis={analysis('insightface', 0.4)} />)
    fireEvent.change(screen.getByLabelText('Umbral simulado'), { target: { value: '0.9' } })
    rerender(<AnalysisPanel analysis={analysis('insightface', 0.4)} />)
    expect(screen.getByTestId('curve').textContent).toBe('0.9')
  })
})
