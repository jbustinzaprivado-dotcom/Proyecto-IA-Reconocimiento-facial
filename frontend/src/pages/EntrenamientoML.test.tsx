import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asRole } from '../auth/testWrappers'
import * as api from '../services/api'
import type { MlStatus, ModelMetrics } from '../types/facial'
import EntrenamientoML from './EntrenamientoML'

vi.mock('../services/api', () => ({
  getMlStatus: vi.fn(),
  trainModel: vi.fn(),
  getModelMetrics: vi.fn(),
}))

const MODEL = 'insightface-buffalo_l'

const missing: MlStatus = {
  modelo_facial: MODEL,
  entrenamiento_habilitado: true,
  ejemplos: 26,
  ejemplos_correctos: 12,
  ejemplos_incorrectos: 14,
  personas: 4,
  minimo_ejemplos: 50,
  minimo_por_tipo: 15,
  minimo_personas: 3,
  faltan: [
    'Faltan 24 intentos evaluados (hay 26 de 50).',
    'Faltan 3 intentos en los que el candidato era la persona correcta (hay 12 de 15).',
  ],
  datos_suficientes: false,
  entrenado: false,
  entrenado_en: null,
  algoritmo: null,
}

const ready: MlStatus = {
  ...missing,
  ejemplos: 60,
  ejemplos_correctos: 30,
  ejemplos_incorrectos: 30,
  faltan: [],
  datos_suficientes: true,
}

const trained: MlStatus = {
  ...ready,
  entrenado: true,
  entrenado_en: '2026-09-20T16:00:00Z',
  algoritmo: 'gradient_boosting',
}

const metrics: ModelMetrics = {
  precision: 0.9,
  recall: 0.85,
  f1: 0.87,
  tasa_falsos_positivos: 0.06,
  tasa_falsos_negativos: 0.15,
  matriz_confusion: [
    [28, 2],
    [4, 26],
  ],
  n_muestras: 60,
  algoritmo: 'gradient_boosting',
  modelo_facial: MODEL,
  entrenado_en: '2026-09-20T16:00:00Z',
  log_loss: 0.27,
  brier: 0.08,
  ejemplos_correctos: 30,
  ejemplos_incorrectos: 30,
  personas: 4,
  comparacion: [
    {
      algoritmo: 'regresion_logistica',
      nombre: 'Regresión Logística',
      log_loss: 0.34,
      brier: 0.1,
      precision: 0.8,
      recall: 0.8,
      f1: 0.8,
      tasa_falsos_positivos: 0.1,
      tasa_falsos_negativos: 0.2,
      elegido: false,
    },
    {
      algoritmo: 'gradient_boosting',
      nombre: 'Gradient Boosting',
      log_loss: 0.27,
      brier: 0.08,
      precision: 0.9,
      recall: 0.85,
      f1: 0.87,
      tasa_falsos_positivos: 0.06,
      tasa_falsos_negativos: 0.15,
      elegido: true,
    },
  ],
}

const section = (name: string) => screen.getByRole('region', { name })
const trainButton = () =>
  screen.getByRole('button', {
    name: /Entrenar modelo|Entrenando…|Volver a entrenar/,
  }) as HTMLButtonElement

// The value under the label of a card. The table repeats some labels as column headers
function stat(scope: HTMLElement, label: string): string {
  const name = within(scope)
    .getAllByText(label)
    .find((element) => element.tagName === 'P') as HTMLElement
  return (name.parentElement as HTMLElement).querySelectorAll('p')[1].textContent ?? ''
}

beforeEach(() => {
  vi.mocked(api.getMlStatus).mockReset()
  vi.mocked(api.trainModel).mockReset()
  vi.mocked(api.getModelMetrics).mockReset()
  vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: missing })
  vi.mocked(api.getModelMetrics).mockResolvedValue({ success: true, resultado: metrics })
})

describe('EntrenamientoML: los datos', () => {
  it('shows a loading message and then the counts of the examples', async () => {
    render(<EntrenamientoML />, { wrapper: asRole() })
    expect(screen.getByText('Cargando…')).toBeTruthy()
    await screen.findByRole('region', { name: 'Datos' })
    const data = section('Datos')
    expect(stat(data, 'Intentos evaluados')).toBe('26')
    expect(stat(data, 'Candidato correcto')).toBe('12')
    expect(stat(data, 'Candidato incorrecto')).toBe('14')
    expect(stat(data, 'Personas distintas')).toBe('4')
    expect(within(data).getByText(`Modelo facial: ${MODEL}`)).toBeTruthy()
  })

  it('says the minimums to train, taken from what the API says', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({
      success: true,
      resultado: { ...missing, minimo_ejemplos: 80, minimo_por_tipo: 20, minimo_personas: 5 },
    })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const data = await screen.findByRole('region', { name: 'Datos' })
    expect(data.textContent).toContain(
      'al menos 80 intentos evaluados, 20 de cada tipo y 5 personas distintas',
    )
  })

  it('lists what is missing while there is not enough data', async () => {
    render(<EntrenamientoML />, { wrapper: asRole() })
    const data = await screen.findByRole('region', { name: 'Datos' })
    expect(within(data).getByText('Todavía no hay datos suficientes:')).toBeTruthy()
    expect(
      within(data)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(missing.faltan)
    expect(within(data).queryByText('Hay datos suficientes para entrenar.')).toBeNull()
  })

  it('says there is enough data, and lists nothing missing', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const data = await screen.findByRole('region', { name: 'Datos' })
    expect(within(data).getByText('Hay datos suficientes para entrenar.')).toBeTruthy()
    expect(within(data).queryByText('Todavía no hay datos suficientes:')).toBeNull()
    expect(within(data).queryByRole('listitem')).toBeNull()
  })

  it('does not name a face model when there is none', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({
      success: true,
      resultado: { ...missing, modelo_facial: null },
    })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const data = await screen.findByRole('region', { name: 'Datos' })
    expect(within(data).queryByText(/Modelo facial:/)).toBeNull()
  })

  it('shows the error of the status with a retry that loads it again', async () => {
    vi.mocked(api.getMlStatus)
      .mockResolvedValueOnce({ success: false, error: 'No se pudo conectar con el servidor' })
      .mockResolvedValueOnce({ success: true, resultado: missing })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No se pudo conectar con el servidor')
    expect(screen.queryByRole('button', { name: 'Entrenar modelo' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('region', { name: 'Datos' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('EntrenamientoML: actualizar', () => {
  it('loads the counts again, so that attempts evaluated meanwhile are counted', async () => {
    vi.mocked(api.getMlStatus)
      .mockResolvedValueOnce({ success: true, resultado: missing })
      .mockResolvedValueOnce({ success: true, resultado: ready })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const data = await screen.findByRole('region', { name: 'Datos' })
    expect(stat(data, 'Intentos evaluados')).toBe('26')

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    expect((screen.getByRole('button', { name: 'Actualizar' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await waitFor(() => expect(api.getMlStatus).toHaveBeenCalledTimes(2))
    expect(stat(await screen.findByRole('region', { name: 'Datos' }), 'Intentos evaluados')).toBe(
      '60',
    )
  })

  it('cannot be pressed while it is training', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
    vi.mocked(api.trainModel).mockReturnValue(new Promise(() => {}))
    render(<EntrenamientoML />, { wrapper: asRole() })
    await screen.findByRole('region', { name: 'Modelo' })
    fireEvent.click(trainButton())
    await screen.findByRole('button', { name: 'Entrenando…' })
    expect((screen.getByRole('button', { name: 'Actualizar' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('EntrenamientoML: el modelo', () => {
  it('says "Sin calibrar" and blocks training while there is no model and not enough data', async () => {
    render(<EntrenamientoML />, { wrapper: asRole() })
    const model = await screen.findByRole('region', { name: 'Modelo' })
    expect(within(model).getByText('Sin calibrar:')).toBeTruthy()
    expect(model.textContent).toContain('todavía no hay un modelo entrenado')
    expect(trainButton().textContent).toBe('Entrenar modelo')
    expect(trainButton().disabled).toBe(true)
    expect(screen.queryByRole('region', { name: 'Resultados' })).toBeNull()
    expect(api.getModelMetrics).not.toHaveBeenCalled()
  })

  it('allows training once there is enough data and the server allows it', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
    render(<EntrenamientoML />, { wrapper: asRole() })
    await screen.findByRole('region', { name: 'Modelo' })
    expect(trainButton().disabled).toBe(false)
    expect(screen.queryByText(/deshabilitado en el servidor/)).toBeNull()
  })

  it('blocks training, and says how to turn it on, when the server has it off', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({
      success: true,
      resultado: { ...ready, entrenamiento_habilitado: false },
    })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const model = await screen.findByRole('region', { name: 'Modelo' })
    expect(trainButton().disabled).toBe(true)
    expect(
      within(model).getByText(/ML_TRAINING_ENABLED=true en su \.env y reinicia la API/),
    ).toBeTruthy()
  })

  it('trains, shows that it is working, and then loads the status again', async () => {
    let finish: (value: Awaited<ReturnType<typeof api.trainModel>>) => void = () => {}
    vi.mocked(api.getMlStatus)
      .mockResolvedValueOnce({ success: true, resultado: ready })
      .mockResolvedValueOnce({ success: true, resultado: trained })
    vi.mocked(api.trainModel).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<EntrenamientoML />, { wrapper: asRole() })
    await screen.findByRole('region', { name: 'Modelo' })

    fireEvent.click(trainButton())
    expect(trainButton().textContent).toBe('Entrenando…')
    expect(trainButton().disabled).toBe(true)
    expect(screen.getByText('Puede tardar unos segundos.')).toBeTruthy()

    finish({ success: true, resultado: metrics })
    expect(await screen.findByText('Modelo entrenado.')).toBeTruthy()
    expect(api.trainModel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(api.getMlStatus).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('region', { name: 'Resultados' })).toBeTruthy()
    expect(trainButton().textContent).toBe('Volver a entrenar')
  })

  it('shows what the server says when it refuses, and loads the counts again', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
    vi.mocked(api.trainModel).mockResolvedValue({
      success: false,
      error: 'No hay datos suficientes para entrenar. Faltan 3 personas distintas evaluadas.',
    })
    render(<EntrenamientoML />, { wrapper: asRole() })
    await screen.findByRole('region', { name: 'Modelo' })
    fireEvent.click(trainButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'No hay datos suficientes para entrenar. Faltan 3 personas distintas evaluadas.',
    )
    await waitFor(() => expect(api.getMlStatus).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Modelo entrenado.')).toBeNull()
    await screen.findByRole('region', { name: 'Modelo' })
    // The error stays on screen after the counts are loaded again
    expect(screen.getByRole('alert').textContent).toContain('No hay datos suficientes')
  })

  it('turns an unexpected exception into an error message and enables the button again', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
    vi.mocked(api.trainModel).mockRejectedValue(new Error('boom'))
    render(<EntrenamientoML />, { wrapper: asRole() })
    await screen.findByRole('region', { name: 'Modelo' })
    fireEvent.click(trainButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
    await screen.findByRole('region', { name: 'Modelo' })
    expect(trainButton().disabled).toBe(false)
  })

  it('clears the previous message when it trains again', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
    vi.mocked(api.trainModel)
      .mockResolvedValueOnce({ success: false, error: 'Ya hay un entrenamiento en curso.' })
      .mockResolvedValueOnce({ success: true, resultado: metrics })
    render(<EntrenamientoML />, { wrapper: asRole() })
    await screen.findByRole('region', { name: 'Modelo' })
    fireEvent.click(trainButton())
    await screen.findByRole('alert')
    await screen.findByRole('region', { name: 'Modelo' })

    fireEvent.click(trainButton())
    expect(await screen.findByText('Modelo entrenado.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says when the model was trained and with which algorithm, and offers to train again', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: trained })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const model = await screen.findByRole('region', { name: 'Modelo' })
    expect(model.textContent).toMatch(/Modelo entrenado el .+ \(Gradient Boosting\)\./)
    expect(within(model).queryByText('Sin calibrar:')).toBeNull()
    expect(trainButton().textContent).toBe('Volver a entrenar')
    expect(trainButton().disabled).toBe(false)
  })
})

describe('EntrenamientoML: los resultados', () => {
  beforeEach(() => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: trained })
  })

  it('shows the model that was kept, how it was checked and its numbers', async () => {
    render(<EntrenamientoML />, { wrapper: asRole() })
    const results = await screen.findByRole('region', { name: 'Resultados' })
    expect(await within(results).findByText('Muestras')).toBeTruthy()
    expect(results.textContent).toContain('Algoritmo elegido: Gradient Boosting.')
    expect(results.textContent).toContain('Entrenado con 60 ejemplos de 4 personas registradas')
    expect(results.textContent).toContain('comprobado con personas que el modelo no había visto')
    expect(stat(results, 'Log-loss')).toBe('0.27')
    expect(stat(results, 'Brier')).toBe('0.08')
    expect(stat(results, 'Muestras')).toBe('60')
    expect(within(results).queryByText('Ejemplos')).toBeNull()
  })

  it('shows the metrics and the confusion matrix of the kept model', async () => {
    render(<EntrenamientoML />, { wrapper: asRole() })
    const results = await screen.findByRole('region', { name: 'Resultados' })
    await within(results).findByRole('region', { name: 'Matriz de confusión del modelo elegido' })
    expect(stat(results, 'Precisión')).toBe('90 %')
    expect(stat(results, 'Recall')).toBe('85 %')
    expect(stat(results, 'F1')).toBe('87 %')
    const matrix = within(results).getByRole('region', {
      name: 'Matriz de confusión del modelo elegido',
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
      ['28', '2'],
      ['4', '26'],
    ])
  })

  it('compares the algorithms and says which one was kept', async () => {
    render(<EntrenamientoML />, { wrapper: asRole() })
    const results = await screen.findByRole('region', { name: 'Resultados' })
    const table = await within(results).findByRole('region', {
      name: 'Comparación de los algoritmos',
    })
    expect(within(table).getByText('Regresión Logística')).toBeTruthy()
    expect(within(table).getAllByText('Elegido')).toHaveLength(1)
  })

  it('warns that the numbers are only as good as the labels and the number of examples', async () => {
    render(<EntrenamientoML />, { wrapper: asRole() })
    const results = await screen.findByRole('region', { name: 'Resultados' })
    const warning = await within(results).findByText(
      /Estas cifras valen lo que valgan las etiquetas/,
    )
    expect(warning.textContent).toContain('con pocos son solo una primera impresión')
    expect(warning.textContent).toContain('para esta cámara, estas personas y estas condiciones')
  })

  it('shows a dash for a rate that could not be worked out', async () => {
    vi.mocked(api.getModelMetrics).mockResolvedValue({
      success: true,
      resultado: { ...metrics, precision: null, f1: null },
    })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const results = await screen.findByRole('region', { name: 'Resultados' })
    await within(results).findByRole('region', { name: 'Matriz de confusión del modelo elegido' })
    expect(stat(results, 'Precisión')).toBe('—')
    expect(stat(results, 'F1')).toBe('—')
  })

  it('shows the error of the results apart, and retries only them', async () => {
    vi.mocked(api.getModelMetrics)
      .mockResolvedValueOnce({ success: false, error: 'Modelo no entrenado.' })
      .mockResolvedValueOnce({ success: true, resultado: metrics })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const results = await screen.findByRole('region', { name: 'Resultados' })
    const alert = await within(results).findByRole('alert')
    expect(alert.textContent).toContain(
      'No se pudieron leer los resultados del modelo: Modelo no entrenado.',
    )
    // The data and the model keep working
    expect(screen.getByRole('region', { name: 'Datos' })).toBeTruthy()
    expect(trainButton().disabled).toBe(false)

    fireEvent.click(within(results).getByRole('button', { name: 'Reintentar' }))
    expect(await within(results).findByText('Muestras')).toBeTruthy()
    expect(api.getMlStatus).toHaveBeenCalledTimes(1)
    expect(api.getModelMetrics).toHaveBeenCalledTimes(2)
  })

  it('asks for the results again after another training, because the numbers may have changed', async () => {
    const retrained: MlStatus = { ...trained, entrenado_en: '2026-09-21T09:00:00Z' }
    vi.mocked(api.getMlStatus)
      .mockResolvedValueOnce({ success: true, resultado: trained })
      .mockResolvedValueOnce({ success: true, resultado: retrained })
    vi.mocked(api.trainModel).mockResolvedValue({ success: true, resultado: metrics })
    render(<EntrenamientoML />, { wrapper: asRole() })
    const results = await screen.findByRole('region', { name: 'Resultados' })
    await within(results).findByText('Muestras')
    expect(api.getModelMetrics).toHaveBeenCalledTimes(1)

    fireEvent.click(trainButton())
    await screen.findByText('Modelo entrenado.')
    await waitFor(() => expect(api.getModelMetrics).toHaveBeenCalledTimes(2))
  })
})

describe('EntrenamientoML: who may train', () => {
  it.each(['operador', 'consulta'] as const)(
    'does not offer training to the %s, and says why',
    async (role) => {
      vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
      render(<EntrenamientoML />, { wrapper: asRole(role) })
      await screen.findByText('Solo un administrador puede entrenar el modelo.')
      expect(screen.queryByRole('button', { name: 'Entrenar modelo' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Volver a entrenar' })).toBeNull()
      // Everything else is still there to read
      expect(screen.getByText('Intentos evaluados')).toBeTruthy()
    },
  )

  it('does not tell someone who cannot train how to turn the training on in the server', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({
      success: true,
      resultado: { ...ready, entrenamiento_habilitado: false },
    })
    render(<EntrenamientoML />, { wrapper: asRole('operador') })
    await screen.findByText('Solo un administrador puede entrenar el modelo.')
    expect(screen.queryByText(/ML_TRAINING_ENABLED/)).toBeNull()
  })

  it('offers training to the administrator', async () => {
    vi.mocked(api.getMlStatus).mockResolvedValue({ success: true, resultado: ready })
    render(<EntrenamientoML />, { wrapper: asRole('administrador') })
    const button = await screen.findByRole('button', { name: 'Entrenar modelo' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('Solo un administrador puede entrenar el modelo.')).toBeNull()
  })
})
