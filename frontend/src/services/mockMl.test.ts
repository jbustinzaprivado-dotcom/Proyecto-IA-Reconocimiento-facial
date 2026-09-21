import { describe, expect, it } from 'vitest'
import type { ModelMetrics } from '../types/facial'
import type { LabeledAttempt } from './mockAnalysis'
import { missingMessages, mlCounts, mlMetrics, mlStatus } from './mockMl'

const right = (personaId?: number): LabeledAttempt => ({
  similitud: 0.9,
  esperado: 'persona',
  correcto: true,
  personaId,
})
const wrongPerson = (personaId?: number): LabeledAttempt => ({
  similitud: 0.6,
  esperado: 'persona',
  correcto: false,
  personaId,
})
const unknown = (): LabeledAttempt => ({ similitud: 0.2, esperado: 'desconocido', correcto: false })

const many = (count: number, make: () => LabeledAttempt) => Array.from({ length: count }, make)

describe('mlCounts', () => {
  it('counts a right candidate as correct and every other kind of attempt as wrong', () => {
    const counts = mlCounts([right(1), right(1), wrongPerson(2), unknown(), unknown()])
    expect(counts).toEqual({ examples: 5, correct: 2, wrong: 3, people: 2 })
  })

  it('never counts an unknown person as a right candidate, even if the attempt says so', () => {
    const odd: LabeledAttempt = { similitud: 0.9, esperado: 'desconocido', correcto: true }
    expect(mlCounts([odd, odd])).toEqual({ examples: 2, correct: 0, wrong: 2, people: 0 })
  })

  it('never counts an unknown person as a person, even if the attempt carries one', () => {
    const odd: LabeledAttempt = {
      similitud: 0.2,
      esperado: 'desconocido',
      correcto: false,
      personaId: 5,
    }
    expect(mlCounts([odd]).people).toBe(0)
  })

  it('counts every person once, whatever the number of attempts', () => {
    expect(mlCounts([right(1), right(1), right(1), right(2)]).people).toBe(2)
  })

  it('does not count an unknown person as a person, nor an attempt without one', () => {
    expect(mlCounts([unknown(), right(undefined), wrongPerson(undefined)]).people).toBe(0)
  })

  it('counts the person expected even when the closest candidate was someone else', () => {
    expect(mlCounts([wrongPerson(7)]).people).toBe(1)
  })

  it('has nothing without attempts', () => {
    expect(mlCounts([])).toEqual({ examples: 0, correct: 0, wrong: 0, people: 0 })
  })
})

describe('missingMessages', () => {
  const enough = { examples: 50, correct: 25, wrong: 25, people: 3 }

  it('says nothing when there is enough of everything, at the exact minimums too', () => {
    expect(missingMessages(enough)).toEqual([])
    expect(missingMessages({ examples: 50, correct: 15, wrong: 35, people: 3 })).toEqual([])
    expect(missingMessages({ examples: 50, correct: 35, wrong: 15, people: 3 })).toEqual([])
  })

  it('says everything that is missing, in words, when there is nothing', () => {
    expect(missingMessages({ examples: 0, correct: 0, wrong: 0, people: 0 })).toEqual([
      'Faltan 50 intentos evaluados (hay 0 de 50).',
      'Faltan 15 intentos en los que el candidato era la persona correcta (hay 0 de 15).',
      'Faltan 15 intentos en los que el candidato no era la persona correcta (hay 0 de 15).',
      'Faltan 3 personas distintas evaluadas (hay 0 de 3).',
    ])
  })

  it.each([
    [{ ...enough, examples: 49 }, 'Falta 1 intento evaluado (hay 49 de 50).'],
    [
      { ...enough, correct: 14 },
      'Falta 1 intento en el que el candidato era la persona correcta (hay 14 de 15).',
    ],
    [
      { ...enough, wrong: 14 },
      'Falta 1 intento en el que el candidato no era la persona correcta (hay 14 de 15).',
    ],
    [{ ...enough, people: 2 }, 'Falta 1 persona distinta evaluada (hay 2 de 3).'],
  ])('reports one shortage on its own, in the singular', (counts, text) => {
    expect(missingMessages(counts)).toEqual([text])
  })

  it('uses the plural from two on', () => {
    expect(missingMessages({ ...enough, people: 1 })).toEqual([
      'Faltan 2 personas distintas evaluadas (hay 1 de 3).',
    ])
  })
})

describe('mlStatus', () => {
  const enough = { examples: 60, correct: 30, wrong: 30, people: 4 }

  it('says there is enough data, and that there is no model yet', () => {
    const status = mlStatus({ counts: enough, model: 'm', trained: null })
    expect(status).toMatchObject({
      modelo_facial: 'm',
      entrenamiento_habilitado: true,
      ejemplos: 60,
      ejemplos_correctos: 30,
      ejemplos_incorrectos: 30,
      personas: 4,
      minimo_ejemplos: 50,
      minimo_por_tipo: 15,
      minimo_personas: 3,
      faltan: [],
      datos_suficientes: true,
      entrenado: false,
      entrenado_en: null,
      algoritmo: null,
    })
  })

  it('says what is missing and that the data is not enough', () => {
    const status = mlStatus({
      counts: { examples: 10, correct: 5, wrong: 5, people: 1 },
      model: 'm',
      trained: null,
    })
    expect(status.datos_suficientes).toBe(false)
    expect(status.faltan).toHaveLength(4)
  })

  it('says which model is there and when it was trained', () => {
    const trained: ModelMetrics = mlMetrics(enough, 'm', '2026-09-20T16:00:00.000Z')
    const status = mlStatus({ counts: enough, model: 'm', trained })
    expect(status).toMatchObject({
      entrenado: true,
      entrenado_en: '2026-09-20T16:00:00.000Z',
      algoritmo: 'gradient_boosting',
    })
  })
})

describe('mlMetrics', () => {
  it('works the matrix of the kept algorithm out from the counts, as [[TN, FP], [FN, TP]]', () => {
    // 20 right and 30 wrong: recognizes 88 % of the right ones (18) and rejects 94 % of the wrong (28)
    const metrics = mlMetrics({ examples: 50, correct: 20, wrong: 30, people: 4 }, 'm', 'now')
    expect(metrics.matriz_confusion).toEqual([
      [28, 2],
      [2, 18],
    ])
    expect(metrics.n_muestras).toBe(50)
    expect(metrics.precision).toBeCloseTo(0.9)
    expect(metrics.recall).toBeCloseTo(0.9)
    expect(metrics.f1).toBeCloseTo(0.9)
    expect(metrics.tasa_falsos_positivos).toBeCloseTo(2 / 30)
    expect(metrics.tasa_falsos_negativos).toBeCloseTo(0.1)
  })

  it('keeps what it was trained with', () => {
    const metrics = mlMetrics(
      { examples: 50, correct: 20, wrong: 30, people: 4 },
      'sface',
      '2026-01-01',
    )
    expect(metrics).toMatchObject({
      modelo_facial: 'sface',
      entrenado_en: '2026-01-01',
      ejemplos_correctos: 20,
      ejemplos_incorrectos: 30,
      personas: 4,
      algoritmo: 'gradient_boosting',
      log_loss: 0.27,
      brier: 0.08,
    })
  })

  it('compares the three algorithms and keeps the one with the lowest log-loss', () => {
    const metrics = mlMetrics({ examples: 50, correct: 20, wrong: 30, people: 4 }, 'm', 'now')
    expect(metrics.comparacion.map((c) => c.nombre)).toEqual([
      'Regresión Logística',
      'Random Forest',
      'Gradient Boosting',
    ])
    expect(metrics.comparacion.map((c) => c.log_loss)).toEqual([0.34, 0.29, 0.27])
    expect(metrics.comparacion.map((c) => c.elegido)).toEqual([false, false, true])
    const chosen = metrics.comparacion[2]
    expect(chosen.precision).toBe(metrics.precision)
    expect(chosen.tasa_falsos_negativos).toBe(metrics.tasa_falsos_negativos)
  })

  it('gives every algorithm its own numbers', () => {
    const metrics = mlMetrics({ examples: 50, correct: 20, wrong: 30, people: 4 }, 'm', 'now')
    const recalls = metrics.comparacion.map((c) => c.recall)
    expect(new Set(recalls).size).toBe(3)
    expect(recalls[0]).toBeCloseTo(16 / 20)
    expect(recalls[1]).toBeCloseTo(17 / 20)
  })

  it('gives null, not zero, for a rate that has nothing to divide by', () => {
    const metrics = mlMetrics({ examples: 30, correct: 0, wrong: 30, people: 1 }, 'm', 'now')
    expect(metrics.recall).toBeNull()
    expect(metrics.tasa_falsos_negativos).toBeNull()
    expect(metrics.f1).toBeNull()
    expect(metrics.precision).toBe(0)
  })

  it('works out on the counts of the attempts that were given', () => {
    const counts = mlCounts([...many(20, () => right(1)), ...many(30, unknown)])
    const metrics = mlMetrics(counts, 'm', 'now')
    expect(metrics.n_muestras).toBe(50)
    expect(metrics.matriz_confusion[1][1] + metrics.matriz_confusion[1][0]).toBe(20)
  })
})
