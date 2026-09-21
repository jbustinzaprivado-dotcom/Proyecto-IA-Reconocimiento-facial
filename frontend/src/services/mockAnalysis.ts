// The analysis of the simulated data, worked out in the browser. It follows the same rules as the
// API so that what is seen without a backend behaves like the real thing
import type {
  AnalysisBin,
  AnalysisDay,
  AnalysisSummary,
  CurvePoint,
  HistoryItem,
  ThresholdMetrics,
} from '../types/facial'

// An attempt of the evaluation mode: who the operator said was in front of the camera
export interface LabeledAttempt {
  similitud: number
  esperado: 'persona' | 'desconocido'
  // For a person: was the closest one that person?
  correcto: boolean
  // For a person: which one (the probability model checks people apart)
  personaId?: number
}

const DAYS_SHOWN = 14
const HISTOGRAM_BINS = 20
const CURVE_POINTS = 101
// Below these numbers of labeled attempts the errors are only a first impression
const MIN_LABELED = 30
const MIN_PER_KIND = 10
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

interface Counts {
  tp: number
  fp: number
  fn: number
  tn: number
}

// Expected person and the closest one was that person: TP if it clears the threshold, else FN.
// Expected person but the closest was someone else: FP if it clears the threshold, else FN.
// Expected unknown: FP if it clears the threshold, else TN.
export function confusionAt(labeled: LabeledAttempt[], threshold: number): Counts {
  const counts: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const attempt of labeled) {
    const clears = attempt.similitud >= threshold
    if (attempt.esperado === 'desconocido') {
      if (clears) counts.fp += 1
      else counts.tn += 1
    } else if (!clears) {
      counts.fn += 1
    } else if (attempt.correcto) {
      counts.tp += 1
    } else {
      counts.fp += 1
    }
  }
  return counts
}

export function metricsAt(labeled: LabeledAttempt[], threshold: number): ThresholdMetrics {
  const { tp, fp, fn, tn } = confusionAt(labeled, threshold)
  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall)
  return {
    umbral: threshold,
    precision,
    recall,
    f1,
    tasa_falsos_positivos: ratio(fp, fp + tn),
    tasa_falsos_negativos: ratio(fn, fn + tp),
    matriz_confusion: [
      [tn, fp],
      [fn, tp],
    ],
    n_muestras: tp + fp + fn + tn,
  }
}

// YYYY-MM-DD of the moment in the time zone given by the offset in minutes ahead of UTC
function localDay(iso: string, offsetMinutes: number): string {
  return new Date(Date.parse(iso) + offsetMinutes * MINUTE_MS).toISOString().slice(0, 10)
}

function perDay(history: HistoryItem[], offsetMinutes: number): AnalysisDay[] {
  if (history.length === 0) return []
  // The window ends on the day of the newest attempt, so that the sample data always shows
  const newest = history.reduce((a, b) =>
    Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a,
  )
  const last = Date.parse(`${localDay(newest.created_at, offsetMinutes)}T00:00:00Z`)
  const days: AnalysisDay[] = []
  for (let i = DAYS_SHOWN - 1; i >= 0; i -= 1) {
    days.push({
      fecha: new Date(last - i * DAY_MS).toISOString().slice(0, 10),
      coincidencias: 0,
      rechazos: 0,
    })
  }
  for (const item of history) {
    const day = days.find((d) => d.fecha === localDay(item.created_at, offsetMinutes))
    if (!day) continue
    if (item.coincide) day.coincidencias += 1
    else day.rechazos += 1
  }
  return days
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length
}

export function computeAnalysis(input: {
  history: HistoryItem[]
  labeled: LabeledAttempt[]
  model: string
  threshold: number
  offsetMinutes: number
}): AnalysisSummary {
  const { history, labeled, model, threshold, offsetMinutes } = input
  const hits = history.filter((item) => item.coincide)
  const misses = history.filter((item) => !item.coincide)

  const histogram: AnalysisBin[] = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    desde: Math.round((i / HISTOGRAM_BINS) * 10_000) / 10_000,
    hasta: Math.round(((i + 1) / HISTOGRAM_BINS) * 10_000) / 10_000,
    coincidencias: 0,
    rechazos: 0,
  }))
  for (const item of history) {
    // The small extra keeps 0.15 in the bin that starts at 0.15
    const index = Math.min(Math.floor(item.similitud * HISTOGRAM_BINS + 1e-9), HISTOGRAM_BINS - 1)
    if (item.coincide) histogram[index].coincidencias += 1
    else histogram[index].rechazos += 1
  }

  const curve: CurvePoint[] = Array.from({ length: CURVE_POINTS }, (_, i) => {
    const t = i / 100
    const { tp, fp, fn, tn } = confusionAt(labeled, t)
    return {
      umbral: t,
      coincidencias: history.filter((item) => item.similitud >= t).length,
      verdaderos_positivos: tp,
      falsos_positivos: fp,
      falsos_negativos: fn,
      verdaderos_negativos: tn,
      tasa_falsos_positivos: ratio(fp, fp + tn),
      tasa_falsos_negativos: ratio(fn, fn + tp),
    }
  })

  const persons = labeled.filter((a) => a.esperado === 'persona').length
  const unknown = labeled.length - persons
  return {
    modelo: model,
    modelos: [{ modelo: model, intentos: history.length }],
    umbral: threshold,
    total_intentos: history.length,
    total_coincidencias: hits.length,
    tasa_coincidencia: history.length === 0 ? 0 : hits.length / history.length,
    similitud_promedio_coincidencias: average(hits.map((item) => item.similitud)),
    similitud_promedio_rechazos: average(misses.map((item) => item.similitud)),
    por_dia: perDay(history, offsetMinutes),
    histograma: histogram,
    curva: curve,
    etiquetados: labeled.length,
    etiquetados_persona: persons,
    etiquetados_desconocido: unknown,
    muestra_pequena:
      labeled.length < MIN_LABELED || persons < MIN_PER_KIND || unknown < MIN_PER_KIND,
    metricas_umbral: labeled.length === 0 ? null : metricsAt(labeled, threshold),
  }
}

const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r']
const WARNING =
  'AVISO: este archivo contiene nombres de personas. No lo compartas sin autorización.'

// A name typed by a person must never become a formula when the file is opened
function cell(value: string): string {
  const safe = FORMULA_STARTS.some((start) => value.startsWith(start)) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

const ETIQUETAS = ['acierto', 'falso_positivo', 'falso_negativo', 'rechazo_correcto']

export function historyCsv(history: HistoryItem[]): string {
  const rows = [
    [WARNING],
    ['fecha', 'persona', 'similitud', 'distancia', 'umbral', 'resultado', 'modelo', 'etiqueta'],
    ...history.map((item) => [
      item.created_at,
      item.nombre ?? 'Sin candidato',
      item.similitud.toFixed(4),
      item.distancia.toFixed(4),
      item.umbral.toFixed(4),
      item.coincide ? 'Coincide' : 'No coincide',
      item.modelo,
      item.etiqueta && ETIQUETAS.includes(item.etiqueta) ? item.etiqueta : '',
    ]),
  ]
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function analysisCsv(analysis: AnalysisSummary): string {
  const rate = (value: number | null) => (value === null ? '' : value.toFixed(4))
  const rows = [
    [
      'modelo',
      'umbral',
      'coincidencias',
      'verdaderos_positivos',
      'falsos_positivos',
      'falsos_negativos',
      'verdaderos_negativos',
      'tasa_falsos_positivos',
      'tasa_falsos_negativos',
    ],
    ...analysis.curva.map((p) => [
      analysis.modelo ?? '',
      p.umbral.toFixed(2),
      String(p.coincidencias),
      String(p.verdaderos_positivos),
      String(p.falsos_positivos),
      String(p.falsos_negativos),
      String(p.verdaderos_negativos),
      rate(p.tasa_falsos_positivos),
      rate(p.tasa_falsos_negativos),
    ]),
  ]
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
