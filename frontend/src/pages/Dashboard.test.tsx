import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import type { AnalysisSummary } from '../types/facial'
import Dashboard from './Dashboard'

vi.mock('../services/api', () => ({ getDashboardSummary: vi.fn(), getAnalysis: vi.fn() }))
// Recharts needs real layout, which jsdom does not have, so the chart is replaced by a stand-in
vi.mock('../components/DailyAttemptsChart', () => ({
  default: ({ days }: { days: unknown[] }) => <div data-testid="chart">{days.length} días</div>,
}))

const summary = { total_personas: 5, total_reconocimientos: 8, total_coincidencias: 4 }

const analysis: AnalysisSummary = {
  modelo: 'insightface-buffalo_l',
  modelos: [{ modelo: 'insightface-buffalo_l', intentos: 8 }],
  umbral: 0.4,
  total_intentos: 8,
  total_coincidencias: 4,
  tasa_coincidencia: 0.5,
  similitud_promedio_coincidencias: 0.7,
  similitud_promedio_rechazos: 0.3,
  por_dia: Array.from({ length: 14 }, (_, i) => ({
    fecha: `2026-09-${String(i + 1).padStart(2, '0')}`,
    coincidencias: 0,
    rechazos: 0,
  })),
  histograma: [],
  curva: [],
  etiquetados: 0,
  etiquetados_persona: 0,
  etiquetados_desconocido: 0,
  muestra_pequena: true,
  metricas_umbral: null,
}

// The value shown under a label, whatever else the page repeats
function stat(label: string): string {
  const card = screen.getByText(label).parentElement as HTMLElement
  return card.querySelectorAll('p')[1].textContent ?? ''
}

beforeEach(() => {
  vi.mocked(api.getDashboardSummary).mockReset()
  vi.mocked(api.getAnalysis).mockReset()
  vi.mocked(api.getDashboardSummary).mockResolvedValue({ success: true, resultado: summary })
  vi.mocked(api.getAnalysis).mockResolvedValue({ success: true, resultado: analysis })
})

describe('Dashboard', () => {
  it('shows a loading message and then the totals', async () => {
    render(<Dashboard />)
    expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0)

    expect(await screen.findByText('Personas registradas')).toBeTruthy()
    expect(stat('Personas registradas')).toBe('5')
    expect(stat('Reconocimientos')).toBe('8')
    expect(stat('Coincidencias')).toBe('4')
  })

  it('works out the match rate from the totals and shows it as a percentage', async () => {
    render(<Dashboard />)
    await screen.findByText('Tasa de coincidencia')
    expect(stat('Tasa de coincidencia')).toBe('50 %')
  })

  it('rounds the match rate to a whole percentage', async () => {
    vi.mocked(api.getDashboardSummary).mockResolvedValue({
      success: true,
      resultado: { ...summary, total_reconocimientos: 3, total_coincidencias: 1 },
    })
    render(<Dashboard />)
    await screen.findByText('Tasa de coincidencia')
    expect(stat('Tasa de coincidencia')).toBe('33 %')
  })

  it('shows a dash instead of a rate while there are no attempts', async () => {
    vi.mocked(api.getDashboardSummary).mockResolvedValue({
      success: true,
      resultado: { total_personas: 2, total_reconocimientos: 0, total_coincidencias: 0 },
    })
    render(<Dashboard />)
    await screen.findByText('Tasa de coincidencia')
    expect(stat('Tasa de coincidencia')).toBe('—')
  })

  it('shows the attempts per day with the model they are about', async () => {
    render(<Dashboard />)
    const section = await screen.findByRole('region', { name: 'Intentos por día' })
    expect(await within(section).findByTestId('chart')).toBeTruthy()
    expect(within(section).getByTestId('chart').textContent).toBe('14 días')
    expect(within(section).getByText('Modelo: insightface-buffalo_l')).toBeTruthy()
  })

  it('shows the error of the totals with a retry that loads them again', async () => {
    vi.mocked(api.getDashboardSummary)
      .mockResolvedValueOnce({ success: false, error: 'No se pudo conectar con el servidor' })
      .mockResolvedValueOnce({ success: true, resultado: summary })
    render(<Dashboard />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No se pudo conectar con el servidor')
    // The chart does not depend on the totals
    expect(await screen.findByTestId('chart')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Personas registradas')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.getAnalysis).toHaveBeenCalledTimes(1)
  })

  it('shows the error of the chart apart from the totals', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({ success: false, error: 'Modelo no disponible' })
    render(<Dashboard />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Modelo no disponible')
    expect(await screen.findByText('Personas registradas')).toBeTruthy()
    expect(screen.queryByTestId('chart')).toBeNull()
  })

  it('reloads both with Actualizar, disabling the button meanwhile', async () => {
    render(<Dashboard />)
    await screen.findByText('Personas registradas')
    await screen.findByTestId('chart')

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    expect((screen.getByRole('button', { name: 'Actualizar' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await waitFor(() => expect(api.getDashboardSummary).toHaveBeenCalledTimes(2))
    expect(api.getAnalysis).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Personas registradas')).toBeTruthy()
  })
})
