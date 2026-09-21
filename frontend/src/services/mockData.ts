// Simulated data and responses to work without a backend (VITE_USE_MOCKS=true)
import type {
  AnalysisSummary,
  ApiResponse,
  DashboardSummary,
  Etiqueta,
  HistoryItem,
  MlStatus,
  ModelMetrics,
  Person,
  PersonCreate,
  PredictionInput,
  PredictionResult,
  RecognitionResult,
  RostroResult,
} from '../types/facial'
import { analysisCsv, computeAnalysis, historyCsv } from './mockAnalysis'
import type { LabeledAttempt } from './mockAnalysis'
import { track } from './mockAuth'
import { mlCounts, mlMetrics, mlStatus } from './mockMl'
import type { CsvFile, DeletedPerson, PurgeResult } from '../types/auth'

// The simulated accounts, users and audit log live in mockAuth.ts
export {
  changePassword,
  createUser,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  getAudit,
  getMe,
  listUsers,
  login,
  updateUser,
} from './mockAuth'

const DELAY_MS = 600
const THRESHOLD = 0.75
const MODEL = 'insightface-buffalo_l'
const persons: Person[] = [
  {
    id: 10,
    nombre: 'Ana Torres',
    email: 'ana.torres@example.com',
    activo: true,
    created_at: '2026-09-01T14:20:00Z',
    consentimiento_at: '2026-09-01T14:20:00Z',
    consentimiento_version: 'v1',
    rostros: 5,
  },
  {
    id: 11,
    nombre: 'Luis Ramírez',
    email: 'luis.ramirez@example.com',
    activo: true,
    created_at: '2026-09-03T09:05:00Z',
    consentimiento_at: '2026-09-03T09:05:00Z',
    consentimiento_version: 'v1',
    rostros: 3,
  },
  {
    id: 12,
    nombre: 'Carlos',
    email: 'carlos@example.com',
    activo: true,
    created_at: '2026-09-05T16:40:00Z',
    consentimiento_at: '2026-09-05T16:40:00Z',
    consentimiento_version: 'v1',
    rostros: 4,
  },
  {
    id: 13,
    nombre: 'Marta Quispe',
    email: 'marta.quispe@example.com',
    activo: true,
    created_at: '2026-09-08T11:15:00Z',
    consentimiento_at: '2026-09-08T11:15:00Z',
    consentimiento_version: 'v1',
    rostros: 2,
  },
  {
    id: 14,
    nombre: 'Diego Flores',
    email: 'diego.flores@example.com',
    activo: false,
    created_at: '2026-09-10T18:30:00Z',
    consentimiento_at: '2026-09-10T18:30:00Z',
    consentimiento_version: 'v1',
    rostros: 0,
  },
]

// Newest first. distancia follows 2 * (1 - similitud), as in the PDF examples
const history: HistoryItem[] = [
  {
    id: 8,
    persona_id: 12,
    nombre: 'Carlos',
    similitud: 0.87,
    distancia: 0.26,
    umbral: THRESHOLD,
    coincide: true,
    probabilidad_calibrada: 0.93,
    created_at: '2026-09-19T15:42:00Z',
    modelo: MODEL,
    etiqueta: 'acierto',
  },
  {
    id: 7,
    persona_id: null,
    nombre: null,
    similitud: 0.31,
    distancia: 1.38,
    umbral: THRESHOLD,
    coincide: false,
    probabilidad_calibrada: null,
    created_at: '2026-09-19T14:10:00Z',
    modelo: MODEL,
    etiqueta: 'rechazo_correcto',
  },
  {
    id: 6,
    persona_id: 10,
    nombre: 'Ana Torres',
    similitud: 0.91,
    distancia: 0.18,
    umbral: THRESHOLD,
    coincide: true,
    probabilidad_calibrada: 0.97,
    created_at: '2026-09-18T17:05:00Z',
    modelo: MODEL,
    etiqueta: null,
  },
  {
    id: 5,
    persona_id: 13,
    nombre: 'Marta Quispe',
    similitud: 0.68,
    distancia: 0.64,
    umbral: THRESHOLD,
    coincide: false,
    probabilidad_calibrada: 0.22,
    created_at: '2026-09-18T10:30:00Z',
    modelo: MODEL,
    etiqueta: 'falso_negativo',
  },
  {
    id: 4,
    persona_id: 11,
    nombre: 'Luis Ramírez',
    similitud: 0.82,
    distancia: 0.36,
    umbral: THRESHOLD,
    coincide: true,
    probabilidad_calibrada: 0.88,
    created_at: '2026-09-17T16:00:00Z',
    modelo: MODEL,
    etiqueta: null,
  },
  {
    id: 3,
    persona_id: 12,
    nombre: 'Carlos',
    similitud: 0.79,
    distancia: 0.42,
    umbral: THRESHOLD,
    coincide: true,
    probabilidad_calibrada: null,
    created_at: '2026-09-16T12:45:00Z',
    modelo: MODEL,
    etiqueta: null,
  },
  {
    id: 2,
    persona_id: null,
    nombre: null,
    similitud: 0.28,
    distancia: 1.44,
    umbral: THRESHOLD,
    coincide: false,
    probabilidad_calibrada: null,
    created_at: '2026-09-15T09:20:00Z',
    modelo: MODEL,
    etiqueta: null,
  },
  {
    id: 1,
    persona_id: 10,
    nombre: 'Ana Torres',
    similitud: 0.74,
    distancia: 0.52,
    umbral: THRESHOLD,
    coincide: false,
    probabilidad_calibrada: 0.41,
    created_at: '2026-09-14T13:10:00Z',
    modelo: MODEL,
    etiqueta: 'falso_negativo',
  },
]

// Attempts of the evaluation mode: the sample ones and the ones made during this session. The
// closest one was the expected person, except where "correcto" is false
const evaluationSample: LabeledAttempt[] = [
  ...[0.91, 0.88, 0.85, 0.82, 0.79, 0.77, 0.74, 0.7, 0.66, 0.58, 0.52, 0.47].map(
    (similitud, index): LabeledAttempt => ({
      similitud,
      esperado: 'persona',
      correcto: true,
      personaId: 10 + (index % 4),
    }),
  ),
  ...[0.72, 0.6].map((similitud, index): LabeledAttempt => ({
    similitud,
    esperado: 'persona',
    correcto: false,
    personaId: 10 + index,
  })),
  ...[0.62, 0.55, 0.48, 0.44, 0.41, 0.38, 0.33, 0.29, 0.25, 0.22, 0.18, 0.12].map(
    (similitud): LabeledAttempt => ({ similitud, esperado: 'desconocido', correcto: false }),
  ),
]
const evaluationLog: LabeledAttempt[] = [...evaluationSample]

let recognitionCount = 0
let trainedMetrics: ModelMetrics | null = null

function reply<T>(response: ApiResponse<T>): Promise<ApiResponse<T>> {
  return new Promise((resolve) => setTimeout(() => resolve(response), DELAY_MS))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function nextId(items: { id: number }[]): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1
}

export function createPerson(data: PersonCreate): Promise<ApiResponse<Person>> {
  const now = new Date().toISOString()
  const person: Person = {
    id: nextId(persons),
    ...data,
    activo: true,
    created_at: now,
    consentimiento_at: now,
    rostros: 0,
  }
  persons.push(person)
  track('persona_crear', { resource: 'persona', resourceId: person.id })
  return reply({ success: true, resultado: structuredClone(person) })
}

export function uploadFaces(personId: number, count: number): Promise<ApiResponse<RostroResult>> {
  const person = persons.find((candidate) => candidate.id === personId)
  if (!person) return reply<RostroResult>({ success: false, error: 'Persona no encontrada' })
  // Saving faces again replaces the ones that were there
  person.rostros = count
  track('rostros_registrar', {
    resource: 'persona',
    resourceId: personId,
    detail: `${count} imágenes`,
  })
  return reply({ success: true, resultado: { persona_id: personId, imagenes_guardadas: count } })
}

export function setPersonActive(personId: number, active: boolean): Promise<ApiResponse<Person>> {
  const person = persons.find((candidate) => candidate.id === personId)
  if (!person) return reply<Person>({ success: false, error: 'Persona no encontrada' })
  person.activo = active
  track(active ? 'persona_activar' : 'persona_desactivar', {
    resource: 'persona',
    resourceId: personId,
  })
  return reply({ success: true, resultado: structuredClone(person) })
}

// What the person did stays, without them: their attempts lose the name and the number
function forget(personId: number): void {
  for (const item of history) {
    if (item.persona_id === personId) {
      item.persona_id = null
      item.nombre = null
    }
  }
  for (const attempt of evaluationLog) {
    if (attempt.personaId === personId) attempt.personaId = undefined
  }
}

export function deletePerson(personId: number): Promise<ApiResponse<DeletedPerson>> {
  const index = persons.findIndex((candidate) => candidate.id === personId)
  if (index < 0) return reply<DeletedPerson>({ success: false, error: 'Persona no encontrada' })
  persons.splice(index, 1)
  forget(personId)
  track('persona_eliminar', { resource: 'persona', resourceId: personId })
  return reply({ success: true, resultado: { persona_id: personId } })
}

export function purgePersons(): Promise<ApiResponse<PurgeResult>> {
  const empty = persons.filter((person) => person.rostros === 0)
  for (const person of empty) {
    persons.splice(persons.indexOf(person), 1)
    forget(person.id)
  }
  track('personas_limpiar', {
    resource: 'persona',
    detail: `${empty.length} personas sin rostros`,
  })
  return reply({ success: true, resultado: { eliminadas: empty.length } })
}

// What the attempt turned out to be, given who the operator said was there
function labelFor(
  expected: string | undefined,
  matchedId: number | null,
  matches: boolean,
): Etiqueta | null {
  if (expected === undefined || expected.trim() === '') return null
  if (expected.trim().toLowerCase() === 'desconocido') {
    return matches ? 'falso_positivo' : 'rechazo_correcto'
  }
  if (!matches) return 'falso_negativo'
  return matchedId === Number(expected) ? 'acierto' : 'falso_positivo'
}

// Alternates a match (the PDF example) and a rejection, and logs each attempt. With an expected
// person (evaluation mode) the attempt also gets its label
export function recognize(expected?: string): Promise<ApiResponse<RecognitionResult>> {
  recognitionCount += 1
  const isMatch = recognitionCount % 2 === 1
  const resultado: RecognitionResult = isMatch
    ? {
        persona_id: 12,
        nombre: 'Carlos',
        similitud: 0.87,
        distancia: 0.26,
        umbral: THRESHOLD,
        coincide: true,
        probabilidad_calibrada: 0.93,
        confianza: 'alta',
      }
    : {
        persona_id: null,
        nombre: null,
        similitud: 0.31,
        distancia: 1.38,
        umbral: THRESHOLD,
        coincide: false,
        probabilidad_calibrada: null,
        confianza: 'baja',
      }
  const etiqueta = labelFor(expected, resultado.persona_id, resultado.coincide)
  if (etiqueta !== null) {
    const isUnknown = expected?.trim().toLowerCase() === 'desconocido'
    evaluationLog.push({
      similitud: resultado.similitud,
      esperado: isUnknown ? 'desconocido' : 'persona',
      // The simulated closest one is Carlos whenever there is a match
      correcto: !isUnknown && Number(expected) === 12,
      personaId: isUnknown ? undefined : Number(expected),
    })
  }
  resultado.etiqueta = etiqueta
  track('reconocimiento', {
    detail:
      (resultado.coincide ? 'coincide' : 'no coincide') +
      (etiqueta ? `; evaluación: ${etiqueta}` : ''),
  })
  history.unshift({
    id: nextId(history),
    persona_id: resultado.persona_id,
    nombre: resultado.nombre,
    similitud: resultado.similitud,
    distancia: resultado.distancia,
    umbral: resultado.umbral,
    coincide: resultado.coincide,
    probabilidad_calibrada: resultado.probabilidad_calibrada,
    created_at: new Date().toISOString(),
    modelo: MODEL,
    etiqueta,
  })
  return reply({ success: true, resultado })
}

export function listPersons(): Promise<ApiResponse<Person[]>> {
  return reply({ success: true, resultado: structuredClone(persons) })
}

export function getHistory(): Promise<ApiResponse<HistoryItem[]>> {
  return reply({ success: true, resultado: structuredClone(history) })
}

// Uncalibrated (null) until the model is trained, then a logistic curve around the threshold
export function predictProbability(input: PredictionInput): Promise<ApiResponse<PredictionResult>> {
  const probability =
    trainedMetrics !== null ? round(1 / (1 + Math.exp(-12 * (input.similitud - THRESHOLD)))) : null
  return reply({ success: true, resultado: { probabilidad_calibrada: probability } })
}

// Refuses, with the same words as the API, until there are enough evaluated attempts
export function trainModel(): Promise<ApiResponse<ModelMetrics>> {
  const status = mlStatus({
    counts: mlCounts(evaluationLog),
    model: MODEL,
    trained: trainedMetrics,
  })
  if (!status.datos_suficientes) {
    const error = `No hay datos suficientes para entrenar. ${status.faltan.join(' ')}`
    track('entrenar', { result: 'fallo', resource: 'modelo', detail: error })
    return reply<ModelMetrics>({ success: false, error })
  }
  trainedMetrics = mlMetrics(mlCounts(evaluationLog), MODEL, new Date().toISOString())
  track('entrenar', {
    resource: 'modelo',
    detail: `${trainedMetrics.algoritmo}, ${trainedMetrics.n_muestras} ejemplos`,
  })
  return reply({ success: true, resultado: structuredClone(trainedMetrics) })
}

export function getModelMetrics(): Promise<ApiResponse<ModelMetrics>> {
  if (trainedMetrics === null) {
    return reply<ModelMetrics>({ success: false, error: 'Modelo no entrenado' })
  }
  return reply({ success: true, resultado: structuredClone(trainedMetrics) })
}

export function getMlStatus(): Promise<ApiResponse<MlStatus>> {
  return reply({
    success: true,
    resultado: mlStatus({ counts: mlCounts(evaluationLog), model: MODEL, trained: trainedMetrics }),
  })
}

function analysisFor(model: string | undefined, offsetMinutes: number): AnalysisSummary | null {
  if (model !== undefined && model !== MODEL) return null
  return computeAnalysis({
    history,
    labeled: evaluationLog,
    model: MODEL,
    threshold: THRESHOLD,
    offsetMinutes,
  })
}

export function getAnalysis(
  model: string | undefined,
  offsetMinutes: number,
): Promise<ApiResponse<AnalysisSummary>> {
  const analysis = analysisFor(model, offsetMinutes)
  if (analysis === null) {
    return reply<AnalysisSummary>({ success: false, error: 'No hay intentos de ese modelo.' })
  }
  return reply({ success: true, resultado: structuredClone(analysis) })
}

// The CSV is made here, in the browser. The mark at the start tells Excel that it is UTF-8
export function downloadCsv(
  kind: 'historial' | 'analisis',
  model?: string,
): Promise<ApiResponse<CsvFile>> {
  const analysis = analysisFor(model, 0)
  const text =
    kind === 'historial' || analysis === null ? historyCsv(history) : analysisCsv(analysis)
  track(kind === 'historial' ? 'csv_historial' : 'csv_analisis', {
    resource: kind,
    detail: `modelo: ${model ?? 'en uso'}`,
  })
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  return reply({ success: true, resultado: { blob, filename: `${kind}.csv` } })
}

export function getDashboardSummary(): Promise<ApiResponse<DashboardSummary>> {
  return reply({
    success: true,
    resultado: {
      total_personas: persons.length,
      total_reconocimientos: history.length,
      total_coincidencias: history.filter((item) => item.coincide).length,
    },
  })
}
