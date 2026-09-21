import { describe, expect, it } from 'vitest'
import type { AnalysisSummary, HistoryItem } from '../types/facial'
import type { LabeledAttempt } from './mockAnalysis'
import { analysisCsv, computeAnalysis, confusionAt, historyCsv, metricsAt } from './mockAnalysis'

const MODEL = 'insightface-buffalo_l'

function attempt(
  similitud: number,
  esperado: LabeledAttempt['esperado'],
  correcto = true,
): LabeledAttempt {
  return { similitud, esperado, correcto }
}

function item(
  overrides: Partial<HistoryItem> & Pick<HistoryItem, 'similitud' | 'coincide'>,
): HistoryItem {
  return {
    id: 1,
    persona_id: 1,
    nombre: 'Ana',
    distancia: 0.5,
    umbral: 0.5,
    probabilidad_calibrada: null,
    created_at: '2026-09-19T15:00:00Z',
    modelo: MODEL,
    etiqueta: null,
    ...overrides,
  }
}

describe('confusionAt', () => {
  it('counts a person who was recognized as a true positive, and one who was not as a false negative', () => {
    const labeled = [attempt(0.9, 'persona'), attempt(0.3, 'persona')]
    expect(confusionAt(labeled, 0.5)).toEqual({ tp: 1, fp: 0, fn: 1, tn: 0 })
  })

  it('counts a person taken for somebody else as a false positive when it clears the threshold', () => {
    expect(confusionAt([attempt(0.9, 'persona', false)], 0.5)).toEqual({
      tp: 0,
      fp: 1,
      fn: 0,
      tn: 0,
    })
  })

  it('counts a person taken for somebody else below the threshold as a false negative', () => {
    expect(confusionAt([attempt(0.3, 'persona', false)], 0.5)).toEqual({
      tp: 0,
      fp: 0,
      fn: 1,
      tn: 0,
    })
  })

  it('counts an unknown one as a false positive if accepted and a true negative if rejected', () => {
    const labeled = [attempt(0.8, 'desconocido', false), attempt(0.2, 'desconocido', false)]
    expect(confusionAt(labeled, 0.5)).toEqual({ tp: 0, fp: 1, fn: 0, tn: 1 })
  })

  it('accepts what is exactly at the threshold', () => {
    expect(confusionAt([attempt(0.5, 'persona')], 0.5).tp).toBe(1)
    expect(confusionAt([attempt(0.5, 'desconocido', false)], 0.5).fp).toBe(1)
  })
})

describe('metricsAt', () => {
  const labeled = [
    attempt(0.9, 'persona'),
    attempt(0.8, 'persona'),
    attempt(0.7, 'persona', false),
    attempt(0.3, 'persona'),
    attempt(0.6, 'desconocido', false),
    attempt(0.2, 'desconocido', false),
    attempt(0.1, 'desconocido', false),
  ]

  it('works the ratios out from the counts, with the matrix as [[TN, FP], [FN, TP]]', () => {
    // tp 2, fp 2 (the wrong one and the unknown 0.6), fn 1, tn 2
    const metrics = metricsAt(labeled, 0.5)
    expect(metrics.matriz_confusion).toEqual([
      [2, 2],
      [1, 2],
    ])
    expect(metrics.n_muestras).toBe(7)
    expect(metrics.umbral).toBe(0.5)
    expect(metrics.precision).toBeCloseTo(0.5)
    expect(metrics.recall).toBeCloseTo(2 / 3)
    expect(metrics.f1).toBeCloseTo((2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3))
    expect(metrics.tasa_falsos_positivos).toBeCloseTo(0.5)
    expect(metrics.tasa_falsos_negativos).toBeCloseTo(1 / 3)
  })

  it('never mixes up the four counts: with all of them different each lands in its place', () => {
    const different = [
      attempt(0.9, 'persona'),
      attempt(0.8, 'persona'),
      attempt(0.7, 'persona'),
      attempt(0.3, 'persona'),
      attempt(0.25, 'persona'),
      attempt(0.6, 'desconocido', false),
      attempt(0.2, 'desconocido', false),
      attempt(0.1, 'desconocido', false),
      attempt(0.05, 'desconocido', false),
      attempt(0.02, 'desconocido', false),
    ]
    // tp 3, fn 2, fp 1, tn 4
    expect(metricsAt(different, 0.5).matriz_confusion).toEqual([
      [4, 1],
      [2, 3],
    ])
  })

  it('gives null, not 0, for a ratio that has nothing to divide by', () => {
    const metrics = metricsAt([attempt(0.1, 'desconocido', false)], 0.5)
    expect(metrics.precision).toBeNull()
    expect(metrics.recall).toBeNull()
    expect(metrics.f1).toBeNull()
    expect(metrics.tasa_falsos_positivos).toBe(0)
    expect(metrics.tasa_falsos_negativos).toBeNull()
  })

  it('gives no F1 when neither precision nor recall is above zero', () => {
    // The only person is rejected (a false negative) and the only unknown accepted (a false positive)
    const metrics = metricsAt([attempt(0.1, 'persona'), attempt(0.9, 'desconocido', false)], 0.5)
    expect(metrics.precision).toBe(0)
    expect(metrics.recall).toBe(0)
    expect(metrics.f1).toBeNull()
  })
})

describe('computeAnalysis', () => {
  const at = (iso: string, extra: Partial<HistoryItem> = {}) =>
    item({ similitud: 0.6, coincide: true, created_at: iso, ...extra })

  function run(
    history: HistoryItem[],
    labeled: LabeledAttempt[] = [],
    offsetMinutes = 0,
  ): AnalysisSummary {
    return computeAnalysis({ history, labeled, model: MODEL, threshold: 0.5, offsetMinutes })
  }

  it('summarizes the totals and the averages of matches and rejections', () => {
    const summary = run([
      item({ similitud: 0.9, coincide: true }),
      item({ similitud: 0.7, coincide: true }),
      item({ similitud: 0.2, coincide: false }),
      item({ similitud: 0.4, coincide: false }),
    ])
    expect(summary.modelo).toBe(MODEL)
    expect(summary.modelos).toEqual([{ modelo: MODEL, intentos: 4 }])
    expect(summary.umbral).toBe(0.5)
    expect(summary.total_intentos).toBe(4)
    expect(summary.total_coincidencias).toBe(2)
    expect(summary.tasa_coincidencia).toBe(0.5)
    expect(summary.similitud_promedio_coincidencias).toBeCloseTo(0.8)
    expect(summary.similitud_promedio_rechazos).toBeCloseTo(0.3)
  })

  it('has a zero rate and no averages, and no days, without attempts', () => {
    const summary = run([])
    expect(summary.tasa_coincidencia).toBe(0)
    expect(summary.similitud_promedio_coincidencias).toBeNull()
    expect(summary.similitud_promedio_rechazos).toBeNull()
    expect(summary.por_dia).toEqual([])
    expect(summary.metricas_umbral).toBeNull()
  })

  it('has 101 points in the curve, one for every clean hundredth', () => {
    const summary = run([item({ similitud: 0.6, coincide: true })])
    expect(summary.curva).toHaveLength(101)
    expect(summary.curva.map((point) => point.umbral)).toEqual(
      Array.from({ length: 101 }, (_, i) => i / 100),
    )
  })

  it('counts, for every threshold, the attempts that would have matched', () => {
    const summary = run([
      item({ similitud: 0.9, coincide: true }),
      item({ similitud: 0.5, coincide: true }),
      item({ similitud: 0.2, coincide: false }),
    ])
    const at = (t: number) => summary.curva[Math.round(t * 100)].coincidencias
    expect(at(0)).toBe(3)
    expect(at(0.2)).toBe(3)
    expect(at(0.21)).toBe(2)
    expect(at(0.5)).toBe(2)
    expect(at(0.51)).toBe(1)
    expect(at(0.9)).toBe(1)
    expect(at(0.91)).toBe(0)
  })

  it('counts the mistakes of every threshold from the evaluated attempts only', () => {
    const summary = run(
      [item({ similitud: 0.9, coincide: true })],
      [attempt(0.8, 'persona'), attempt(0.6, 'desconocido', false)],
    )
    const p = (t: number) => summary.curva[Math.round(t * 100)]
    expect(p(0.5)).toMatchObject({
      verdaderos_positivos: 1,
      falsos_positivos: 1,
      falsos_negativos: 0,
      verdaderos_negativos: 0,
    })
    expect(p(0.7)).toMatchObject({
      verdaderos_positivos: 1,
      falsos_positivos: 0,
      verdaderos_negativos: 1,
    })
    expect(p(0.9)).toMatchObject({ verdaderos_positivos: 0, falsos_negativos: 1 })
    expect(p(0.9).tasa_falsos_negativos).toBe(1)
    expect(p(0.5).tasa_falsos_positivos).toBe(1)
    expect(p(0.7).tasa_falsos_positivos).toBe(0)
  })

  it('gives null rates in the curve where nothing was evaluated', () => {
    const summary = run([item({ similitud: 0.9, coincide: true })])
    expect(summary.curva[50].tasa_falsos_positivos).toBeNull()
    expect(summary.curva[50].tasa_falsos_negativos).toBeNull()
  })

  it('measures at the threshold in use', () => {
    const summary = run([], [attempt(0.8, 'persona'), attempt(0.2, 'desconocido', false)])
    expect(summary.metricas_umbral).toMatchObject({
      umbral: 0.5,
      n_muestras: 2,
      matriz_confusion: [
        [1, 0],
        [0, 1],
      ],
    })
  })

  describe('histogram', () => {
    const bins = (history: HistoryItem[]) => run(history).histograma

    it('has 20 bins of five hundredths, with clean edges', () => {
      const histogram = bins([])
      expect(histogram).toHaveLength(20)
      expect(histogram[0]).toMatchObject({ desde: 0, hasta: 0.05 })
      expect(histogram[3]).toMatchObject({ desde: 0.15, hasta: 0.2 })
      expect(histogram[19]).toMatchObject({ desde: 0.95, hasta: 1 })
    })

    it('counts matches and rejections apart', () => {
      const histogram = bins([
        item({ similitud: 0.91, coincide: true }),
        item({ similitud: 0.92, coincide: true }),
        item({ similitud: 0.93, coincide: false }),
      ])
      expect(histogram[18]).toMatchObject({ coincidencias: 2, rechazos: 1 })
    })

    it('puts a value on an edge in the bin that starts there, even with floating-point noise', () => {
      // 0.35 - 0.2 is 0.14999999999999997: for all purposes it is 0.15
      const histogram = bins([item({ similitud: 0.35 - 0.2, coincide: false })])
      expect(histogram[2].rechazos).toBe(0)
      expect(histogram[3].rechazos).toBe(1)
    })

    it('puts 0 in the first bin and 1 in the last', () => {
      const histogram = bins([
        item({ similitud: 0, coincide: false }),
        item({ similitud: 1, coincide: true }),
      ])
      expect(histogram[0].rechazos).toBe(1)
      expect(histogram[19].coincidencias).toBe(1)
    })
  })

  describe('per day', () => {
    it('shows 14 days ending on the day of the newest attempt', () => {
      const days = run([at('2026-09-19T15:00:00Z')]).por_dia
      expect(days).toHaveLength(14)
      expect(days[0].fecha).toBe('2026-09-06')
      expect(days[13].fecha).toBe('2026-09-19')
    })

    it('counts matches and rejections of each day', () => {
      const days = run([
        at('2026-09-19T08:00:00Z'),
        at('2026-09-19T10:00:00Z'),
        at('2026-09-19T11:00:00Z', { coincide: false }),
        at('2026-09-18T11:00:00Z', { coincide: false }),
      ]).por_dia
      expect(days[13]).toEqual({ fecha: '2026-09-19', coincidencias: 2, rechazos: 1 })
      expect(days[12]).toEqual({ fecha: '2026-09-18', coincidencias: 0, rechazos: 1 })
      expect(days[11]).toEqual({ fecha: '2026-09-17', coincidencias: 0, rechazos: 0 })
    })

    it('leaves out an attempt older than the 14 days', () => {
      const days = run([at('2026-09-19T15:00:00Z'), at('2026-08-01T10:00:00Z')]).por_dia
      expect(days.reduce((sum, day) => sum + day.coincidencias, 0)).toBe(1)
    })

    it('moves the day with the offset of the viewer, ahead of UTC or behind it', () => {
      const late = at('2026-09-19T23:30:00Z')
      // One hour ahead of UTC it is already the 20th
      const ahead = run([late], [], 60).por_dia
      expect(ahead[13]).toEqual({ fecha: '2026-09-20', coincidencias: 1, rechazos: 0 })
      // Five hours behind it is still the 19th, and an early attempt belongs to the 18th
      const behind = run([late, at('2026-09-19T02:00:00Z')], [], -300).por_dia
      expect(behind[13]).toEqual({ fecha: '2026-09-19', coincidencias: 1, rechazos: 0 })
      expect(behind[12]).toEqual({ fecha: '2026-09-18', coincidencias: 1, rechazos: 0 })
    })

    it('finds the newest attempt whatever the order of the list', () => {
      const days = run([at('2026-09-10T10:00:00Z'), at('2026-09-19T10:00:00Z')]).por_dia
      expect(days[13].fecha).toBe('2026-09-19')
    })
  })

  describe('small sample', () => {
    const many = (persons: number, unknown: number) => [
      ...Array.from({ length: persons }, () => attempt(0.8, 'persona')),
      ...Array.from({ length: unknown }, () => attempt(0.2, 'desconocido', false)),
    ]

    it('counts the evaluated attempts of each kind', () => {
      const summary = run([], many(12, 5))
      expect(summary).toMatchObject({
        etiquetados: 17,
        etiquetados_persona: 12,
        etiquetados_desconocido: 5,
      })
    })

    it('is small below 30 evaluated attempts', () => {
      expect(run([], many(15, 14)).muestra_pequena).toBe(true)
      expect(run([], many(15, 15)).muestra_pequena).toBe(false)
    })

    it('is small when either kind has fewer than 10, even with 30 in all', () => {
      expect(run([], many(21, 9)).muestra_pequena).toBe(true)
      expect(run([], many(9, 21)).muestra_pequena).toBe(true)
      expect(run([], many(20, 10)).muestra_pequena).toBe(false)
    })

    it('is small when nothing has been evaluated', () => {
      expect(run([]).muestra_pequena).toBe(true)
    })
  })
})

describe('historyCsv', () => {
  const rows = (text: string) => text.split('\r\n')

  it('starts with the warning about names, then the header, then one line for each attempt', () => {
    const text = historyCsv([
      item({ similitud: 0.87, coincide: true, distancia: 0.26, umbral: 0.4, etiqueta: 'acierto' }),
    ])
    const lines = rows(text)
    expect(lines[0]).toBe(
      'AVISO: este archivo contiene nombres de personas. No lo compartas sin autorización.',
    )
    expect(lines[1]).toBe('fecha,persona,similitud,distancia,umbral,resultado,modelo,etiqueta')
    expect(lines[2]).toBe(`2026-09-19T15:00:00Z,Ana,0.8700,0.2600,0.4000,Coincide,${MODEL},acierto`)
    expect(lines[3]).toBe('')
  })

  it('says "Sin candidato" and "No coincide" for a rejection, and leaves an unevaluated label empty', () => {
    const text = historyCsv([item({ similitud: 0.1, coincide: false, nombre: null })])
    expect(rows(text)[2]).toBe(
      `2026-09-19T15:00:00Z,Sin candidato,0.1000,0.5000,0.5000,No coincide,${MODEL},`,
    )
  })

  it('makes a name that looks like a formula harmless', () => {
    for (const name of ['=1+1', '+1', '-1', '@SUMA(A1)']) {
      expect(
        rows(historyCsv([item({ similitud: 0.5, coincide: true, nombre: name })]))[2],
      ).toContain(`,'${name},`)
    }
  })

  it('quotes a name with a comma or a quote in it', () => {
    const text = historyCsv([item({ similitud: 0.5, coincide: true, nombre: 'Torres, "Ana"' })])
    expect(rows(text)[2]).toContain(',"Torres, ""Ana""",')
  })

  it('drops a label it does not know instead of writing it', () => {
    const text = historyCsv([
      item({
        similitud: 0.5,
        coincide: true,
        etiqueta: '=cmd' as unknown as HistoryItem['etiqueta'],
      }),
    ])
    expect(rows(text)[2].endsWith(',')).toBe(true)
  })
})

describe('analysisCsv', () => {
  const summary = computeAnalysis({
    history: [item({ similitud: 0.9, coincide: true })],
    labeled: [attempt(0.8, 'persona')],
    model: MODEL,
    threshold: 0.5,
    offsetMinutes: 0,
  })

  it('has a header and one line for every threshold, with no names in it', () => {
    const lines = analysisCsv(summary).split('\r\n')
    expect(lines[0]).toBe(
      'modelo,umbral,coincidencias,verdaderos_positivos,falsos_positivos,falsos_negativos,verdaderos_negativos,tasa_falsos_positivos,tasa_falsos_negativos',
    )
    expect(lines).toHaveLength(1 + 101 + 1)
    expect(analysisCsv(summary)).not.toContain('AVISO')
    expect(analysisCsv(summary)).not.toContain('Ana')
  })

  it('writes the threshold with two decimals, and a rate that does not exist as empty', () => {
    const lines = analysisCsv(summary).split('\r\n')
    // Threshold 0.5: the person at 0.8 is a hit; nobody unknown was evaluated
    expect(lines[51]).toBe(`${MODEL},0.50,1,1,0,0,0,,0.0000`)
  })
})
