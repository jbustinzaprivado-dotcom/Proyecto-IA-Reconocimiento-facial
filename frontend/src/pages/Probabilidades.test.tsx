import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asRole } from '../auth/testWrappers'
import * as api from '../services/api'
import type { Role } from '../types/auth'
import * as download from '../utils/download'
import type {
  AnalysisBin,
  AnalysisSummary,
  CurvePoint,
  HistoryItem,
  ModelMetrics,
} from '../types/facial'
import Probabilidades from './Probabilidades'

vi.mock('../services/api', () => ({
  getHistory: vi.fn(),
  getModelMetrics: vi.fn(),
  getAnalysis: vi.fn(),
  downloadCsv: vi.fn(),
}))
vi.mock('../utils/download', () => ({ saveFile: vi.fn() }))
// Recharts needs real layout, which jsdom does not have, so the charts are replaced by stand-ins
vi.mock('../components/ProbabilityChart', () => ({
  default: ({ items }: { items: unknown[] }) => (
    <div data-testid="chart">{items.length} puntos</div>
  ),
}))
vi.mock('../components/ThresholdCurveChart', () => ({
  default: ({ current, simulated }: { current: number | null; simulated: number }) => (
    <div data-testid="curve">
      en uso {current === null ? 'ninguno' : current} simulado {simulated}
    </div>
  ),
}))
vi.mock('../components/HistogramChart', () => ({
  default: ({ bins, threshold }: { bins: unknown[]; threshold: number | null }) => (
    <div data-testid="histogram">
      {bins.length} rangos umbral {threshold === null ? 'ninguno' : threshold}
    </div>
  ),
}))

const renderPage = (role: Role = 'administrador') =>
  render(
    <MemoryRouter>
      <Probabilidades />
    </MemoryRouter>,
    { wrapper: asRole(role) },
  )

const INSIGHT = 'insightface-buffalo_l'
const SFACE = 'sface-2021dec'

const base = {
  persona_id: 1,
  nombre: 'X',
  distancia: 0.5,
  probabilidad_calibrada: null,
  modelo: INSIGHT,
  etiqueta: null,
}

const history: HistoryItem[] = [
  {
    ...base,
    id: 1,
    similitud: 0.9,
    umbral: 0.6,
    coincide: true,
    created_at: '2026-09-10T10:00:00Z',
  },
  {
    ...base,
    id: 2,
    similitud: 0.8,
    umbral: 0.65,
    coincide: true,
    created_at: '2026-09-11T10:00:00Z',
  },
  {
    ...base,
    id: 3,
    similitud: 0.3,
    umbral: 0.7,
    coincide: false,
    created_at: '2026-09-12T10:00:00Z',
  },
  {
    ...base,
    id: 4,
    similitud: 0.5,
    umbral: 0.75,
    coincide: false,
    created_at: '2026-09-09T10:00:00Z',
  },
]

const metrics: ModelMetrics = {
  precision: 0.94,
  recall: 0.88,
  f1: 0.91,
  tasa_falsos_positivos: 0.06,
  tasa_falsos_negativos: 0.12,
  matriz_confusion: [
    [47, 3],
    [6, 44],
  ],
  n_muestras: 100,
  algoritmo: 'gradient_boosting',
  modelo_facial: INSIGHT,
  entrenado_en: '2026-09-20T16:00:00Z',
  log_loss: 0.27,
  brier: 0.08,
  ejemplos_correctos: 50,
  ejemplos_incorrectos: 50,
  personas: 4,
  comparacion: [],
}

// One point for every hundredth, with numbers that tell each threshold apart
const curve: CurvePoint[] = Array.from({ length: 101 }, (_, i) => ({
  umbral: i / 100,
  coincidencias: 40 - Math.floor(i / 4),
  verdaderos_positivos: 30 - Math.floor(i / 10),
  falsos_positivos: i,
  falsos_negativos: 100 - i,
  verdaderos_negativos: 20 + Math.floor(i / 10),
  tasa_falsos_positivos: i / 200,
  tasa_falsos_negativos: (100 - i) / 200,
}))

const bins: AnalysisBin[] = Array.from({ length: 20 }, (_, i) => ({
  desde: i / 20,
  hasta: (i + 1) / 20,
  coincidencias: 0,
  rechazos: 0,
}))

const analysis: AnalysisSummary = {
  modelo: INSIGHT,
  modelos: [
    { modelo: INSIGHT, intentos: 40 },
    { modelo: SFACE, intentos: 6 },
  ],
  umbral: 0.4,
  total_intentos: 40,
  total_coincidencias: 25,
  tasa_coincidencia: 0.625,
  similitud_promedio_coincidencias: 0.7,
  similitud_promedio_rechazos: 0.3,
  por_dia: [],
  histograma: bins,
  curva: curve,
  etiquetados: 40,
  etiquetados_persona: 20,
  etiquetados_desconocido: 20,
  muestra_pequena: false,
  metricas_umbral: {
    umbral: 0.4,
    precision: 0.9,
    recall: 0.8,
    f1: 0.85,
    tasa_falsos_positivos: 0.1,
    tasa_falsos_negativos: 0.2,
    matriz_confusion: [
      [18, 2],
      [4, 16],
    ],
    n_muestras: 40,
  },
}

const otherModel: AnalysisSummary = {
  ...analysis,
  modelo: SFACE,
  umbral: 0.363,
  total_intentos: 6,
  muestra_pequena: true,
  etiquetados: 6,
  etiquetados_persona: 4,
  etiquetados_desconocido: 2,
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

function stat(scope: HTMLElement, label: string): string {
  const card = within(scope).getByText(label).parentElement as HTMLElement
  return card.querySelectorAll('p')[1].textContent ?? ''
}

const usage = () => section('Intentos y umbral')
const analysisSection = () => section('Análisis del umbral')
const probability = () => section('Modelo de probabilidad')

beforeEach(() => {
  vi.mocked(api.getHistory).mockReset()
  vi.mocked(api.getModelMetrics).mockReset()
  vi.mocked(api.getAnalysis).mockReset()
  vi.mocked(api.downloadCsv).mockReset()
  vi.mocked(download.saveFile).mockReset()
  vi.mocked(api.getHistory).mockResolvedValue({ success: true, resultado: history })
  vi.mocked(api.getModelMetrics).mockResolvedValue({ success: true, resultado: metrics })
  vi.mocked(api.getAnalysis).mockImplementation((model) =>
    Promise.resolve({ success: true, resultado: model === SFACE ? otherModel : analysis }),
  )
  vi.mocked(api.downloadCsv).mockImplementation((kind) =>
    Promise.resolve({
      success: true,
      resultado: { blob: new Blob([`csv de ${kind}`]), filename: `${kind}.csv` },
    }),
  )
})

describe('Probabilidades: intentos y umbral', () => {
  it('derives the threshold and the average similarities from the history', async () => {
    renderPage()
    await screen.findByText('Umbral actual')
    // The most recent attempt (2026-09-12) defines the threshold: 0.70
    expect(stat(usage(), 'Umbral actual')).toBe('0.70')
    // Matches: (0.90 + 0.80) / 2 = 0.85. Rejections: (0.30 + 0.50) / 2 = 0.40
    expect(stat(usage(), 'Similitud promedio de coincidencias')).toBe('0.85')
    expect(stat(usage(), 'Similitud promedio de rechazos')).toBe('0.40')
    expect(screen.getByTestId('chart').textContent).toBe('4 puntos')
  })

  it('shows a dash where there is nothing to average', async () => {
    vi.mocked(api.getHistory).mockResolvedValue({ success: true, resultado: [] })
    renderPage()
    await screen.findByText('Umbral actual')
    expect(stat(usage(), 'Umbral actual')).toBe('—')
    expect(stat(usage(), 'Similitud promedio de coincidencias')).toBe('—')
    expect(stat(usage(), 'Similitud promedio de rechazos')).toBe('—')
  })

  it('shows the history error apart from the rest', async () => {
    vi.mocked(api.getHistory).mockResolvedValue({
      success: false,
      error: 'Respuesta inesperada del servidor',
    })
    renderPage()
    await waitFor(() => expect(within(usage()).getByRole('alert')).toBeTruthy())
    expect(within(usage()).getByRole('alert').textContent).toContain(
      'Respuesta inesperada del servidor',
    )
    expect(await within(probability()).findByText('Precisión')).toBeTruthy()
    expect(await within(analysisSection()).findByText('Umbral simulado')).toBeTruthy()
  })
})

describe('Probabilidades: modelo de probabilidad', () => {
  it('shows the model metrics as percentages and the confusion matrix', async () => {
    renderPage()
    await within(probability()).findByText('Precisión')
    expect(stat(probability(), 'Precisión')).toBe('94 %')
    expect(stat(probability(), 'Recall')).toBe('88 %')
    expect(stat(probability(), 'F1')).toBe('91 %')
    expect(stat(probability(), 'Tasa de falsos positivos')).toBe('6 %')
    expect(stat(probability(), 'Tasa de falsos negativos')).toBe('12 %')
    expect(stat(probability(), 'Muestras')).toBe('100')

    expect(
      within(probability())
        .getByRole('region', { name: 'Matriz de confusión' })
        .getAttribute('tabindex'),
    ).toBe('0')

    const cells = within(within(probability()).getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      )
    expect(cells).toEqual([
      ['47', '3'],
      ['6', '44'],
    ])
  })

  it('says which algorithm was kept and how many examples it learned from', async () => {
    renderPage()
    await within(probability()).findByText('Precisión')
    expect(
      within(probability()).getByText(
        'Algoritmo elegido: Gradient Boosting. Entrenado con 100 ejemplos y comprobado con personas que no había visto.',
      ),
    ).toBeTruthy()
  })

  it('links to the page where the model is trained', async () => {
    renderPage()
    await within(probability()).findByText('Precisión')
    const link = within(probability()).getByRole('link', { name: 'Ir a Entrenamiento ML' })
    expect(link.getAttribute('href')).toBe('/entrenamiento')
  })

  it('shows a dash for a rate of the model that could not be worked out', async () => {
    vi.mocked(api.getModelMetrics).mockResolvedValue({
      success: true,
      resultado: { ...metrics, precision: null, f1: null },
    })
    renderPage()
    await within(probability()).findByText('Precisión')
    expect(stat(probability(), 'Precisión')).toBe('—')
    expect(stat(probability(), 'F1')).toBe('—')
    expect(stat(probability(), 'Recall')).toBe('88\u00a0%')
  })

  it('shows any metrics error with a prefix, without depending on its exact text', async () => {
    vi.mocked(api.getModelMetrics).mockResolvedValue({
      success: false,
      error: 'modelo no entrenado',
    })
    renderPage()
    const alert = await within(probability()).findByRole('alert')
    expect(alert.textContent).toContain('Aún no hay métricas del modelo: modelo no entrenado')
    // The other sections are independent and keep working
    expect(stat(usage(), 'Umbral actual')).toBe('0.70')
    expect(await within(analysisSection()).findByText('Umbral simulado')).toBeTruthy()
  })

  it('retries only the metrics when their retry button is pressed', async () => {
    vi.mocked(api.getModelMetrics)
      .mockResolvedValueOnce({ success: false, error: 'modelo no entrenado' })
      .mockResolvedValueOnce({ success: true, resultado: metrics })
    renderPage()
    await within(probability()).findByRole('alert')

    fireEvent.click(within(probability()).getByRole('button', { name: 'Reintentar' }))
    await within(probability()).findByText('Precisión')
    expect(api.getModelMetrics).toHaveBeenCalledTimes(2)
    expect(api.getHistory).toHaveBeenCalledTimes(1)
    expect(api.getAnalysis).toHaveBeenCalledTimes(1)
  })
})

describe('Probabilidades: análisis del umbral', () => {
  it('shows the errors at the threshold in use, as percentages, with its confusion matrix', async () => {
    renderPage()
    await within(analysisSection()).findByText('Umbral simulado')
    const scope = analysisSection()
    expect(within(scope).getByRole('heading', { name: 'Con el umbral en uso (0.40)' })).toBeTruthy()
    expect(stat(scope, 'Precisión')).toBe('90 %')
    expect(stat(scope, 'Recall')).toBe('80 %')
    expect(stat(scope, 'F1')).toBe('85 %')
    expect(stat(scope, 'Tasa de falsos positivos')).toBe('10 %')
    expect(stat(scope, 'Tasa de falsos negativos')).toBe('20 %')
    expect(stat(scope, 'Muestras')).toBe('40')

    const matrix = within(scope).getByRole('region', {
      name: 'Matriz de confusión con el umbral en uso',
    })
    const cells = within(matrix)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      )
    expect(cells).toEqual([
      ['18', '2'],
      ['4', '16'],
    ])
  })

  it('shows a dash for a rate that could not be worked out, never 0 %', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      success: true,
      resultado: {
        ...analysis,
        metricas_umbral: {
          ...analysis.metricas_umbral!,
          precision: null,
          f1: null,
          tasa_falsos_positivos: null,
        },
      },
    })
    renderPage()
    await within(analysisSection()).findByText('Umbral simulado')
    expect(stat(analysisSection(), 'Precisión')).toBe('—')
    expect(stat(analysisSection(), 'F1')).toBe('—')
    expect(stat(analysisSection(), 'Tasa de falsos positivos')).toBe('—')
    expect(stat(analysisSection(), 'Recall')).toBe('80 %')
  })

  it('passes the histogram and the threshold in use to the charts', async () => {
    renderPage()
    await within(analysisSection()).findByText('Umbral simulado')
    expect(screen.getByTestId('histogram').textContent).toBe('20 rangos umbral 0.4')
  })

  it('does not warn about a sample that is big enough', async () => {
    renderPage()
    await within(analysisSection()).findByText('Umbral simulado')
    expect(within(analysisSection()).queryByText(/Muestra pequeña/)).toBeNull()
    expect(within(analysisSection()).queryByText(/Todavía no hay intentos evaluados/)).toBeNull()
  })

  it('warns about a small sample and says how many attempts there are of each kind', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      success: true,
      resultado: {
        ...analysis,
        muestra_pequena: true,
        etiquetados: 12,
        etiquetados_persona: 8,
        etiquetados_desconocido: 4,
      },
    })
    renderPage()
    const notice = await within(analysisSection()).findByText(/Muestra pequeña/)
    expect(notice.textContent).toContain('12 intentos evaluados')
    expect(notice.textContent).toContain('8 de personas registradas')
    expect(notice.textContent).toContain('4 de desconocidos')
    expect(notice.textContent).toContain('no una medida fiable')
  })

  it('says "1 intento evaluado" in the singular', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      success: true,
      resultado: {
        ...analysis,
        muestra_pequena: true,
        etiquetados: 1,
        etiquetados_persona: 1,
        etiquetados_desconocido: 0,
      },
    })
    renderPage()
    const notice = await within(analysisSection()).findByText(/Muestra pequeña/)
    expect(notice.textContent).toContain('hay 1 intento evaluado (')
  })

  it('explains how to get evaluated attempts when there are none, and hides the error counts', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      success: true,
      resultado: {
        ...analysis,
        etiquetados: 0,
        etiquetados_persona: 0,
        etiquetados_desconocido: 0,
        muestra_pequena: true,
        metricas_umbral: null,
      },
    })
    renderPage()
    const scope = analysisSection()
    const notice = await within(scope).findByText(/Todavía no hay intentos evaluados/)
    expect(notice.textContent).toContain('Activa el «Modo evaluación» en Reconocimiento')
    expect(
      within(scope).getByText('Aún no hay intentos evaluados para medir errores.'),
    ).toBeTruthy()
    expect(within(scope).queryByText('Precisión')).toBeNull()
    expect(within(scope).queryByText('Falsos positivos')).toBeNull()
    // The matches can still be counted for any threshold
    expect(within(scope).getByText('Coincidencias con este umbral')).toBeTruthy()
  })

  it('shows the analysis error apart, and retries only the analysis', async () => {
    vi.mocked(api.getAnalysis)
      .mockResolvedValueOnce({ success: false, error: 'No hay intentos de ese modelo.' })
      .mockResolvedValueOnce({ success: true, resultado: analysis })
    renderPage()
    const alert = await within(analysisSection()).findByRole('alert')
    expect(alert.textContent).toContain('No hay intentos de ese modelo.')
    expect(stat(usage(), 'Umbral actual')).toBe('0.70')

    fireEvent.click(within(analysisSection()).getByRole('button', { name: 'Reintentar' }))
    await within(analysisSection()).findByText('Umbral simulado')
    expect(api.getAnalysis).toHaveBeenCalledTimes(2)
    expect(api.getHistory).toHaveBeenCalledTimes(1)
    expect(api.getModelMetrics).toHaveBeenCalledTimes(1)
  })
})

describe('Probabilidades: simulador del umbral', () => {
  const slider = () => screen.getByLabelText('Umbral simulado') as HTMLInputElement

  async function ready() {
    renderPage()
    await within(analysisSection()).findByText('Coincidencias con este umbral')
  }

  const simulated = () => within(screen.getByRole('group', { name: /Resultado con el umbral/ }))

  it('starts at the threshold in use', async () => {
    await ready()
    expect(slider().value).toBe('0.4')
    expect(screen.getByTestId('curve').textContent).toBe('en uso 0.4 simulado 0.4')
    // Point 40: 40 - floor(40 / 4) = 30 matches, 40 false positives, 60 false negatives
    expect(simulated().getByText('30 de 40')).toBeTruthy()
    expect(simulated().getByText('40 (20 %)')).toBeTruthy()
    expect(simulated().getByText('60 (30 %)')).toBeTruthy()
    expect(simulated().getByText('Verdaderos positivos').nextSibling?.textContent).toBe('26')
    expect(simulated().getByText('Verdaderos negativos').nextSibling?.textContent).toBe('24')
  })

  it('explains that matches count every attempt and the errors only the evaluated ones', async () => {
    await ready()
    const note = screen.getByText(/Las coincidencias se cuentan sobre todos los intentos/)
    expect(note.textContent).toContain('del modelo (40)')
    expect(note.textContent).toContain('solo sobre los evaluados (40)')
  })

  it('does not explain it where there are no evaluated attempts', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      success: true,
      resultado: { ...analysis, etiquetados: 0, metricas_umbral: null },
    })
    await ready()
    expect(screen.queryByText(/Las coincidencias se cuentan sobre/)).toBeNull()
  })

  it('shows what another threshold would have done, without asking the server again', async () => {
    await ready()
    fireEvent.change(slider(), { target: { value: '0.6' } })
    expect(screen.getByLabelText('Umbral simulado')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Resultado con el umbral 0.60' })).toBeTruthy()
    expect(screen.getByTestId('curve').textContent).toBe('en uso 0.4 simulado 0.6')
    // Point 60: 40 - 15 = 25 matches, 60 false positives, 40 false negatives
    expect(simulated().getByText('25 de 40')).toBeTruthy()
    expect(simulated().getByText('60 (30 %)')).toBeTruthy()
    expect(simulated().getByText('40 (20 %)')).toBeTruthy()
    expect(api.getAnalysis).toHaveBeenCalledTimes(1)
  })

  it('finds the hundredth even at the ends of the slider', async () => {
    await ready()
    fireEvent.change(slider(), { target: { value: '0' } })
    expect(simulated().getByText('40 de 40')).toBeTruthy()
    fireEvent.change(slider(), { target: { value: '1' } })
    expect(simulated().getByText('15 de 40')).toBeTruthy()
  })

  it('goes back to the threshold in use, and only offers it once the slider has moved', async () => {
    await ready()
    const back = () => screen.getByRole('button', { name: 'Volver al umbral en uso' })
    expect((back() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(slider(), { target: { value: '0.7' } })
    expect((back() as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(back())
    expect(slider().value).toBe('0.4')
    expect((back() as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not offer to go back when the slider is moved onto the threshold in use', async () => {
    await ready()
    fireEvent.change(slider(), { target: { value: '0.7' } })
    fireEvent.change(slider(), { target: { value: '0.4' } })
    expect(
      (screen.getByRole('button', { name: 'Volver al umbral en uso' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('brings a threshold like 0.363 to the hundredth the slider can show', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({ success: true, resultado: otherModel })
    await ready()
    expect(slider().value).toBe('0.36')
    expect(screen.getByTestId('curve').textContent).toBe('en uso 0.363 simulado 0.36')
  })

  it('says that it is only a simulation and where the real threshold is changed', async () => {
    await ready()
    expect(screen.getByText(/solo una simulación/)).toBeTruthy()
    expect(screen.getByText(/archivo \.env/)).toBeTruthy()
  })

  it('hides the error counts when there are no evaluated attempts', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      success: true,
      resultado: { ...analysis, etiquetados: 0, metricas_umbral: null },
    })
    await ready()
    expect(simulated().queryByText('Falsos positivos')).toBeNull()
    expect(simulated().queryByText('Verdaderos negativos')).toBeNull()
  })
})

describe('Probabilidades: modelo y descargas', () => {
  it('names the only model there is, without a selector', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      success: true,
      resultado: { ...analysis, modelos: [{ modelo: INSIGHT, intentos: 40 }] },
    })
    renderPage()
    expect(await within(analysisSection()).findByText(`Modelo: ${INSIGHT}`)).toBeTruthy()
    expect(within(analysisSection()).queryByLabelText('Modelo')).toBeNull()
  })

  it('lists every model with its attempts and starts on the one in use', async () => {
    renderPage()
    const select = (await within(analysisSection()).findByLabelText('Modelo')) as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      `${INSIGHT} (40 intentos)`,
      `${SFACE} (6 intentos)`,
    ])
    expect(select.value).toBe(INSIGHT)
    expect(api.getAnalysis).toHaveBeenCalledWith(undefined)
  })

  it('asks for the analysis of the chosen model and starts its slider over', async () => {
    renderPage()
    const select = (await within(analysisSection()).findByLabelText('Modelo')) as HTMLSelectElement
    await within(analysisSection()).findByText('Umbral simulado')
    fireEvent.change(screen.getByLabelText('Umbral simulado'), { target: { value: '0.9' } })

    fireEvent.change(select, { target: { value: SFACE } })
    expect(api.getAnalysis).toHaveBeenLastCalledWith(SFACE)
    await waitFor(() =>
      expect(screen.getByTestId('curve').textContent).toBe('en uso 0.363 simulado 0.36'),
    )
    expect(
      within(analysisSection()).getByRole('heading', { name: 'Con el umbral en uso (0.36)' }),
    ).toBeTruthy()
  })

  it('keeps the selector on screen, with the choice made, while the other model loads', async () => {
    renderPage()
    const select = (await within(analysisSection()).findByLabelText('Modelo')) as HTMLSelectElement
    await within(analysisSection()).findByText('Umbral simulado')

    let finish: (value: Awaited<ReturnType<typeof api.getAnalysis>>) => void = () => {}
    vi.mocked(api.getAnalysis).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    fireEvent.change(select, { target: { value: SFACE } })

    expect(within(analysisSection()).getByText('Cargando…')).toBeTruthy()
    // Not the old model's numbers, and the selector is the same element with the new value
    expect(within(analysisSection()).queryByText('Umbral simulado')).toBeNull()
    expect(within(analysisSection()).getByLabelText('Modelo')).toBe(select)
    expect(select.value).toBe(SFACE)

    finish({ success: true, resultado: otherModel })
    await within(analysisSection()).findByText('Umbral simulado')
  })

  it('asks the API for each CSV, for the chosen model, and saves what it gives', async () => {
    renderPage()
    const historyButton = await within(analysisSection()).findByRole('button', {
      name: 'Descargar historial (CSV)',
    })
    fireEvent.click(historyButton)
    await waitFor(() => expect(download.saveFile).toHaveBeenCalledTimes(1))
    expect(api.downloadCsv).toHaveBeenLastCalledWith('historial', undefined)
    const [blob, filename] = vi.mocked(download.saveFile).mock.calls[0]
    expect(filename).toBe('historial.csv')
    expect(blob.size).toBeGreaterThan(0)

    fireEvent.change(within(analysisSection()).getByLabelText('Modelo'), {
      target: { value: SFACE },
    })
    fireEvent.click(
      within(analysisSection()).getByRole('button', { name: 'Descargar análisis (CSV)' }),
    )
    await waitFor(() => expect(download.saveFile).toHaveBeenCalledTimes(2))
    expect(api.downloadCsv).toHaveBeenLastCalledWith('analisis', SFACE)
    expect(vi.mocked(download.saveFile).mock.calls[1][1]).toBe('analisis.csv')
  })

  it('says what went wrong when a CSV cannot be had, and saves nothing', async () => {
    vi.mocked(api.downloadCsv).mockResolvedValue({
      success: false,
      error: 'No tienes permiso para hacer esto.',
    })
    renderPage()
    fireEvent.click(
      await within(analysisSection()).findByRole('button', { name: 'Descargar historial (CSV)' }),
    )
    const alert = await within(analysisSection()).findByRole('alert')
    expect(alert.textContent).toBe('No tienes permiso para hacer esto.')
    expect(download.saveFile).not.toHaveBeenCalled()
  })

  it('turns an unexpected exception into a message', async () => {
    vi.mocked(api.downloadCsv).mockRejectedValue(new Error('boom'))
    renderPage()
    fireEvent.click(
      await within(analysisSection()).findByRole('button', { name: 'Descargar análisis (CSV)' }),
    )
    const alert = await within(analysisSection()).findByRole('alert')
    expect(alert.textContent).toBe('Ocurrió un error inesperado.')
  })

  it('clears an earlier failure when the next download works', async () => {
    vi.mocked(api.downloadCsv).mockResolvedValueOnce({ success: false, error: 'Falló.' })
    renderPage()
    const button = await within(analysisSection()).findByRole('button', {
      name: 'Descargar análisis (CSV)',
    })
    fireEvent.click(button)
    await within(analysisSection()).findByRole('alert')
    fireEvent.click(button)
    await waitFor(() => expect(download.saveFile).toHaveBeenCalledTimes(1))
    expect(within(analysisSection()).queryByRole('alert')).toBeNull()
  })

  it('keeps both buttons off while a download is under way, and says which one', async () => {
    let finish: (value: Awaited<ReturnType<typeof api.downloadCsv>>) => void = () => {}
    vi.mocked(api.downloadCsv).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderPage()
    fireEvent.click(
      await within(analysisSection()).findByRole('button', { name: 'Descargar historial (CSV)' }),
    )
    const busy = await within(analysisSection()).findByRole('button', { name: 'Descargando…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    const other = within(analysisSection()).getByRole('button', {
      name: 'Descargar análisis (CSV)',
    })
    expect((other as HTMLButtonElement).disabled).toBe(true)

    finish({ success: true, resultado: { blob: new Blob(['x']), filename: 'historial.csv' } })
    await within(analysisSection()).findByRole('button', { name: 'Descargar historial (CSV)' })
  })

  it.each(['administrador', 'operador'] as const)(
    'offers both CSV files to the %s',
    async (role) => {
      renderPage(role)
      await within(analysisSection()).findByRole('button', { name: 'Descargar historial (CSV)' })
      expect(
        within(analysisSection()).getByRole('button', { name: 'Descargar análisis (CSV)' }),
      ).toBeTruthy()
    },
  )

  it('offers only the analysis CSV to consulta, because the history has names', async () => {
    renderPage('consulta')
    await within(analysisSection()).findByRole('button', { name: 'Descargar análisis (CSV)' })
    expect(
      within(analysisSection()).queryByRole('button', { name: 'Descargar historial (CSV)' }),
    ).toBeNull()
    expect(within(analysisSection()).queryByText(/incluye los nombres de las personas/)).toBeNull()
  })

  it('warns that the history file has names in it', async () => {
    renderPage()
    await within(analysisSection()).findByText('Umbral simulado')
    const warning = within(analysisSection()).getByText(/incluye los nombres de las personas/)
    expect(warning.textContent).toContain('No lo compartas sin autorización')
  })
})
