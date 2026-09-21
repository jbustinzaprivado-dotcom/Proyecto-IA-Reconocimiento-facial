export type ConfidenceLevel = 'alta' | 'media' | 'baja'

// What an attempt of the evaluation mode turned out to be, given who was really in front of the camera
export type Etiqueta = 'acierto' | 'falso_positivo' | 'falso_negativo' | 'rechazo_correcto'

export interface ApiSuccess<T> {
  success: true
  resultado: T
}

export interface ApiError {
  success: false
  error: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export interface Person {
  id: number
  nombre: string
  email: string
  activo: boolean
  created_at: string
  consentimiento_at: string
  consentimiento_version: string
  // How many faces of the model in use are saved. 0 while the registration has no photos yet
  rostros: number
}

export interface PersonCreate {
  nombre: string
  email: string
  consentimiento_version: string
}

export interface RostroResult {
  persona_id: number
  imagenes_guardadas: number
}

export interface RecognitionResult {
  persona_id: number | null
  nombre: string | null
  similitud: number
  distancia: number
  umbral: number
  coincide: boolean
  probabilidad_calibrada: number | null
  confianza: ConfidenceLevel
  // Only in an attempt of the evaluation mode
  etiqueta?: Etiqueta | null
}

export interface HistoryItem {
  id: number
  persona_id: number | null
  nombre: string | null
  similitud: number
  distancia: number
  umbral: number
  coincide: boolean
  probabilidad_calibrada: number | null
  created_at: string
  // The model that made the comparison: each one has its own similarity scale
  modelo: string
  etiqueta: Etiqueta | null
}

export interface DashboardSummary {
  total_personas: number
  total_reconocimientos: number
  total_coincidencias: number
}

export interface PredictionInput {
  similitud: number
  distancia: number
  calidad_imagen: number
  iluminacion: number
}

export interface PredictionResult {
  probabilidad_calibrada: number | null
}

// How one of the algorithms did when it was checked on people it had not seen
export interface MlAlgorithmResult {
  algoritmo: string
  nombre: string
  log_loss: number
  brier: number
  // A rate with nothing to divide by is null, not zero
  precision: number | null
  recall: number | null
  f1: number | null
  tasa_falsos_positivos: number | null
  tasa_falsos_negativos: number | null
  elegido: boolean
}

// What the chosen model achieves on people it had not seen, cutting at a probability of 0.5
export interface ModelMetrics {
  precision: number | null
  recall: number | null
  f1: number | null
  tasa_falsos_positivos: number | null
  tasa_falsos_negativos: number | null
  // [[TN, FP], [FN, TP]], same layout as scikit-learn
  matriz_confusion: number[][]
  n_muestras: number
  algoritmo: string
  modelo_facial: string
  entrenado_en: string
  log_loss: number
  brier: number
  ejemplos_correctos: number
  ejemplos_incorrectos: number
  personas: number
  comparacion: MlAlgorithmResult[]
}

// Whether there is enough data to train the probability model, and whether one exists
export interface MlStatus {
  // The face model these examples and this model belong to (null if the engine is not loaded)
  modelo_facial: string | null
  entrenamiento_habilitado: boolean
  ejemplos: number
  ejemplos_correctos: number
  ejemplos_incorrectos: number
  personas: number
  minimo_ejemplos: number
  minimo_por_tipo: number
  minimo_personas: number
  // What is still needed, in words. Empty when there is enough
  faltan: string[]
  datos_suficientes: boolean
  entrenado: boolean
  entrenado_en: string | null
  algoritmo: string | null
}

export interface AnalysisModel {
  modelo: string
  intentos: number
}

export interface AnalysisDay {
  // YYYY-MM-DD, in the time zone of the viewer
  fecha: string
  coincidencias: number
  rechazos: number
}

export interface AnalysisBin {
  desde: number
  hasta: number
  coincidencias: number
  rechazos: number
}

// What would have happened with this threshold, over every attempt of the model. The counts of
// errors only use the attempts of the evaluation mode
export interface CurvePoint {
  umbral: number
  coincidencias: number
  verdaderos_positivos: number
  falsos_positivos: number
  falsos_negativos: number
  verdaderos_negativos: number
  tasa_falsos_positivos: number | null
  tasa_falsos_negativos: number | null
}

export interface ThresholdMetrics {
  umbral: number
  precision: number | null
  recall: number | null
  f1: number | null
  tasa_falsos_positivos: number | null
  tasa_falsos_negativos: number | null
  // [[TN, FP], [FN, TP]], same layout as scikit-learn
  matriz_confusion: number[][]
  n_muestras: number
}

export interface AnalysisSummary {
  // The model the numbers are about (null before the first attempt)
  modelo: string | null
  modelos: AnalysisModel[]
  umbral: number | null
  total_intentos: number
  total_coincidencias: number
  tasa_coincidencia: number
  similitud_promedio_coincidencias: number | null
  similitud_promedio_rechazos: number | null
  por_dia: AnalysisDay[]
  histograma: AnalysisBin[]
  curva: CurvePoint[]
  etiquetados: number
  etiquetados_persona: number
  etiquetados_desconocido: number
  // True when there are too few labeled attempts for the errors to mean much
  muestra_pequena: boolean
  metricas_umbral: ThresholdMetrics | null
}
