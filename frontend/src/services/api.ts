import axios, { isAxiosError } from 'axios'
import type { AxiosRequestConfig } from 'axios'
import type {
  AuditPage,
  AuditQuery,
  CsvFile,
  DeletedPerson,
  PurgeResult,
  SessionData,
  User,
  UserCreate,
  UserUpdate,
} from '../types/auth'
import type {
  ApiError,
  AnalysisSummary,
  ApiResponse,
  DashboardSummary,
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
import { endSession, getToken } from './session'

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
// Simulated data only exist in development: a build for a server always talks to the real API
export const USE_MOCKS = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true'
// The simulated data are loaded only when they are used (development, and only if asked for), so
// a build for a server carries none of them
const mock = USE_MOCKS ? await import('./mockData') : null
const TIMEOUT_MS = 60_000
const UNEXPECTED_RESPONSE = 'Respuesta inesperada del servidor'

const client = axios.create({ baseURL: API_URL, timeout: TIMEOUT_MS })

// Every request carries the token of the session, if there is one
client.interceptors.request.use((config) => {
  const token = getToken()
  if (token !== null) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

function fail(error: string): ApiError {
  return { success: false, error }
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null || !('success' in value)) return false
  if (value.success === true) return 'resultado' in value
  return value.success === false && 'error' in value && typeof value.error === 'string'
}

// What a failed request turns into. A 401 for a request that carried a token means the session is
// over (it expired, or the account was deactivated): everybody is told, so the sign-in comes up
function failure<T>(error: unknown, sentToken: boolean, body: unknown): ApiResponse<T> {
  if (!isAxiosError(error)) throw error
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return fail('El servidor tardó demasiado en responder')
  }
  if (error.response) {
    if (error.response.status === 401 && sentToken) endSession('rejected')
    return isApiResponse<T>(body) ? body : fail(UNEXPECTED_RESPONSE)
  }
  return fail('No se pudo conectar con el servidor')
}

// Never rejects for API failures: every outcome comes back as an ApiResponse
async function request<T>(config: AxiosRequestConfig): Promise<ApiResponse<T>> {
  const sentToken = getToken() !== null
  try {
    const { data } = await client.request<unknown>(config)
    return isApiResponse<T>(data) ? data : fail(UNEXPECTED_RESPONSE)
  } catch (error) {
    return failure<T>(error, sentToken, isAxiosError(error) ? error.response?.data : undefined)
  }
}

// A file comes as bytes; a failure still comes as the JSON of the API, which has to be read out of them
async function requestFile(
  config: AxiosRequestConfig,
  filename: string,
): Promise<ApiResponse<CsvFile>> {
  const sentToken = getToken() !== null
  try {
    const { data, headers } = await client.request<ArrayBuffer>({
      ...config,
      responseType: 'arraybuffer',
    })
    const type = String(headers['content-type'] ?? 'text/csv')
    return { success: true, resultado: { blob: new Blob([data], { type }), filename } }
  } catch (error) {
    let body: unknown
    const bytes: unknown = isAxiosError(error) ? error.response?.data : undefined
    // A browser hands over an ArrayBuffer; Node (the tests) a Buffer, which is a view of one
    if (bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)) {
      try {
        body = JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        body = undefined
      }
    }
    return failure<CsvFile>(error, sentToken, body)
  }
}

function toFormData(field: string, images: Blob[]): FormData {
  const form = new FormData()
  for (const image of images) form.append(field, image)
  return form
}

export type CsvKind = 'historial' | 'analisis'

// A CSV, made by the API (it needs the session, so it cannot be a plain link) or, with simulated
// data, in the browser
export function downloadCsv(kind: CsvKind, model?: string): Promise<ApiResponse<CsvFile>> {
  if (mock) return mock.downloadCsv(kind, model)
  return requestFile(
    {
      method: 'GET',
      url: `/api/reportes/${kind}.csv`,
      params: model ? { modelo: model } : undefined,
    },
    `${kind}.csv`,
  )
}

// --- session and users ---------------------------------------------------------------------

export function login(email: string, clave: string): Promise<ApiResponse<SessionData>> {
  if (mock) return mock.login(email, clave)
  return request<SessionData>({ method: 'POST', url: '/api/auth/login', data: { email, clave } })
}

// Who the session belongs to, as the server sees it now
export function getMe(): Promise<ApiResponse<User>> {
  if (mock) return mock.getMe()
  return request<User>({ method: 'GET', url: '/api/auth/yo' })
}

// Every session made before ends, and the answer brings a new one
export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ApiResponse<SessionData>> {
  if (mock) return mock.changePassword(currentPassword, newPassword)
  return request<SessionData>({
    method: 'POST',
    url: '/api/auth/cambiar-clave',
    data: { clave_actual: currentPassword, clave_nueva: newPassword },
  })
}

export function listUsers(): Promise<ApiResponse<User[]>> {
  if (mock) return mock.listUsers()
  return request<User[]>({ method: 'GET', url: '/api/usuarios' })
}

export function createUser(user: UserCreate): Promise<ApiResponse<User>> {
  if (mock) return mock.createUser(user)
  return request<User>({ method: 'POST', url: '/api/usuarios', data: user })
}

export function updateUser(id: number, changes: UserUpdate): Promise<ApiResponse<User>> {
  if (mock) return mock.updateUser(id, changes)
  return request<User>({ method: 'PATCH', url: `/api/usuarios/${id}`, data: changes })
}

export function getAudit(query: AuditQuery): Promise<ApiResponse<AuditPage>> {
  if (mock) return mock.getAudit(query)
  return request<AuditPage>({ method: 'GET', url: '/api/auditoria', params: query })
}

// --- people --------------------------------------------------------------------------------

export function createPerson(person: PersonCreate): Promise<ApiResponse<Person>> {
  if (mock) return mock.createPerson(person)
  return request<Person>({ method: 'POST', url: '/api/personas', data: person })
}

export function uploadFaces(personId: number, images: Blob[]): Promise<ApiResponse<RostroResult>> {
  if (mock) return mock.uploadFaces(personId, images.length)
  return request<RostroResult>({
    method: 'POST',
    url: `/api/personas/${personId}/rostro`,
    data: toFormData('imagenes', images),
  })
}

export function listPersons(): Promise<ApiResponse<Person[]>> {
  if (mock) return mock.listPersons()
  return request<Person[]>({ method: 'GET', url: '/api/personas' })
}

// A deactivated person is no longer recognized, and can be activated again
export function setPersonActive(personId: number, active: boolean): Promise<ApiResponse<Person>> {
  if (mock) return mock.setPersonActive(personId, active)
  return request<Person>({
    method: 'PATCH',
    url: `/api/personas/${personId}`,
    data: { activo: active },
  })
}

// Removes the person, their faces and their consent. It cannot be undone
export function deletePerson(personId: number): Promise<ApiResponse<DeletedPerson>> {
  if (mock) return mock.deletePerson(personId)
  return request<DeletedPerson>({ method: 'DELETE', url: `/api/personas/${personId}` })
}

// Removes everybody who never got a face saved
export function purgePersons(): Promise<ApiResponse<PurgeResult>> {
  if (mock) return mock.purgePersons()
  return request<PurgeResult>({ method: 'POST', url: '/api/personas/limpiar-sin-rostros' })
}

// --- recognition and analysis --------------------------------------------------------------

// `expected` is only sent in the evaluation mode: "desconocido" or the id of the person who is
// really in front of the camera
export function recognize(image: Blob, expected?: string): Promise<ApiResponse<RecognitionResult>> {
  if (mock) return mock.recognize(expected)
  const form = toFormData('imagen', [image])
  if (expected !== undefined) form.append('esperado', expected)
  return request<RecognitionResult>({ method: 'POST', url: '/api/reconocimiento', data: form })
}

export function getHistory(): Promise<ApiResponse<HistoryItem[]>> {
  if (mock) return mock.getHistory()
  return request<HistoryItem[]>({ method: 'GET', url: '/api/reconocimiento/historial' })
}

export function predictProbability(input: PredictionInput): Promise<ApiResponse<PredictionResult>> {
  if (mock) return mock.predictProbability(input)
  return request<PredictionResult>({
    method: 'POST',
    url: '/api/probabilidades/prediccion',
    data: input,
  })
}

export function trainModel(): Promise<ApiResponse<ModelMetrics>> {
  if (mock) return mock.trainModel()
  return request<ModelMetrics>({ method: 'POST', url: '/api/modelos/entrenar' })
}

// Whether there is enough data to train the probability model, and whether one exists
export function getMlStatus(): Promise<ApiResponse<MlStatus>> {
  if (mock) return mock.getMlStatus()
  return request<MlStatus>({ method: 'GET', url: '/api/modelos/estado' })
}

export function getModelMetrics(): Promise<ApiResponse<ModelMetrics>> {
  if (mock) return mock.getModelMetrics()
  return request<ModelMetrics>({ method: 'GET', url: '/api/modelos/metricas' })
}

// Statistics, threshold curve and metrics of one model (the one in use by default). The offset
// tells the API where the days of the viewer start and end
export function getAnalysis(model?: string): Promise<ApiResponse<AnalysisSummary>> {
  const offset = -new Date().getTimezoneOffset()
  if (mock) return mock.getAnalysis(model, offset)
  return request<AnalysisSummary>({
    method: 'GET',
    url: '/api/analisis/resumen',
    params: { modelo: model, desfase_minutos: offset },
  })
}

export function getDashboardSummary(): Promise<ApiResponse<DashboardSummary>> {
  if (mock) return mock.getDashboardSummary()
  return request<DashboardSummary>({ method: 'GET', url: '/api/dashboard/resumen' })
}
