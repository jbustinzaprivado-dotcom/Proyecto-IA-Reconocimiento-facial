// The probability model of the simulated data. It follows the same rules as the API for what is
// enough to train, so that the flow can be tried without a backend. The numbers of the model itself
// are made up: they only give the page something to show
import type { MlAlgorithmResult, MlStatus, ModelMetrics } from '../types/facial'
import type { LabeledAttempt } from './mockAnalysis'

export const ML_MINIMUMS = { examples: 50, perClass: 15, people: 3 }

export interface MlCounts {
  examples: number
  correct: number
  wrong: number
  people: number
}

// An example is "correct" when the closest candidate really was the person who was in front of
// the camera; an unknown person is wrong by definition
export function mlCounts(labeled: LabeledAttempt[]): MlCounts {
  const correct = labeled.filter((a) => a.esperado === 'persona' && a.correcto).length
  const people = new Set(
    labeled
      .filter((a) => a.esperado === 'persona' && a.personaId !== undefined)
      .map((a) => a.personaId),
  )
  return {
    examples: labeled.length,
    correct,
    wrong: labeled.length - correct,
    people: people.size,
  }
}

// "Falta 1 intento" or "Faltan 3 intentos", with how many there are of how many are needed
function lack(count: number, nouns: [string, string], have: number, need: number): string {
  const [verb, noun] = count === 1 ? ['Falta', nouns[0]] : ['Faltan', nouns[1]]
  return `${verb} ${count} ${noun} (hay ${have} de ${need}).`
}

export function missingMessages(counts: MlCounts): string[] {
  const missing: string[] = []
  if (counts.examples < ML_MINIMUMS.examples) {
    missing.push(
      lack(
        ML_MINIMUMS.examples - counts.examples,
        ['intento evaluado', 'intentos evaluados'],
        counts.examples,
        ML_MINIMUMS.examples,
      ),
    )
  }
  if (counts.correct < ML_MINIMUMS.perClass) {
    missing.push(
      lack(
        ML_MINIMUMS.perClass - counts.correct,
        [
          'intento en el que el candidato era la persona correcta',
          'intentos en los que el candidato era la persona correcta',
        ],
        counts.correct,
        ML_MINIMUMS.perClass,
      ),
    )
  }
  if (counts.wrong < ML_MINIMUMS.perClass) {
    missing.push(
      lack(
        ML_MINIMUMS.perClass - counts.wrong,
        [
          'intento en el que el candidato no era la persona correcta',
          'intentos en los que el candidato no era la persona correcta',
        ],
        counts.wrong,
        ML_MINIMUMS.perClass,
      ),
    )
  }
  if (counts.people < ML_MINIMUMS.people) {
    missing.push(
      lack(
        ML_MINIMUMS.people - counts.people,
        ['persona distinta evaluada', 'personas distintas evaluadas'],
        counts.people,
        ML_MINIMUMS.people,
      ),
    )
  }
  return missing
}

export function mlStatus(input: {
  counts: MlCounts
  model: string
  trained: ModelMetrics | null
}): MlStatus {
  const { counts, model, trained } = input
  const faltan = missingMessages(counts)
  return {
    modelo_facial: model,
    entrenamiento_habilitado: true,
    ejemplos: counts.examples,
    ejemplos_correctos: counts.correct,
    ejemplos_incorrectos: counts.wrong,
    personas: counts.people,
    minimo_ejemplos: ML_MINIMUMS.examples,
    minimo_por_tipo: ML_MINIMUMS.perClass,
    minimo_personas: ML_MINIMUMS.people,
    faltan,
    datos_suficientes: faltan.length === 0,
    entrenado: trained !== null,
    entrenado_en: trained?.entrenado_en ?? null,
    algoritmo: trained?.algoritmo ?? null,
  }
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator

// What an algorithm would get if it recognized this share of the right ones and rejected this share
// of the wrong ones
function outcome(counts: MlCounts, recall: number, specificity: number) {
  const tp = Math.round(counts.correct * recall)
  const tn = Math.round(counts.wrong * specificity)
  const fn = counts.correct - tp
  const fp = counts.wrong - tn
  const precision = ratio(tp, tp + fp)
  const recallValue = ratio(tp, tp + fn)
  const f1 =
    precision === null || recallValue === null || precision + recallValue === 0
      ? null
      : (2 * precision * recallValue) / (precision + recallValue)
  return {
    matrix: [
      [tn, fp],
      [fn, tp],
    ],
    precision,
    recall: recallValue,
    f1,
    falsePositiveRate: ratio(fp, fp + tn),
    falseNegativeRate: ratio(fn, fn + tp),
  }
}

const ALGORITHMS = [
  {
    key: 'regresion_logistica',
    name: 'Regresión Logística',
    logLoss: 0.34,
    brier: 0.1,
    recall: 0.82,
    specificity: 0.9,
  },
  {
    key: 'random_forest',
    name: 'Random Forest',
    logLoss: 0.29,
    brier: 0.085,
    recall: 0.86,
    specificity: 0.93,
  },
  {
    key: 'gradient_boosting',
    name: 'Gradient Boosting',
    logLoss: 0.27,
    brier: 0.08,
    recall: 0.88,
    specificity: 0.94,
  },
]

// The last one is the best, as it comes out with the log-loss above
export function mlMetrics(counts: MlCounts, model: string, trainedAt: string): ModelMetrics {
  const comparison: MlAlgorithmResult[] = ALGORITHMS.map((algorithm, index) => {
    const result = outcome(counts, algorithm.recall, algorithm.specificity)
    return {
      algoritmo: algorithm.key,
      nombre: algorithm.name,
      log_loss: algorithm.logLoss,
      brier: algorithm.brier,
      precision: result.precision,
      recall: result.recall,
      f1: result.f1,
      tasa_falsos_positivos: result.falsePositiveRate,
      tasa_falsos_negativos: result.falseNegativeRate,
      elegido: index === ALGORITHMS.length - 1,
    }
  })
  const chosen = ALGORITHMS[ALGORITHMS.length - 1]
  const result = outcome(counts, chosen.recall, chosen.specificity)
  return {
    precision: result.precision,
    recall: result.recall,
    f1: result.f1,
    tasa_falsos_positivos: result.falsePositiveRate,
    tasa_falsos_negativos: result.falseNegativeRate,
    matriz_confusion: result.matrix,
    n_muestras: counts.examples,
    algoritmo: chosen.key,
    modelo_facial: model,
    entrenado_en: trainedAt,
    log_loss: chosen.logLoss,
    brier: chosen.brier,
    ejemplos_correctos: counts.correct,
    ejemplos_incorrectos: counts.wrong,
    personas: counts.people,
    comparacion: comparison,
  }
}
