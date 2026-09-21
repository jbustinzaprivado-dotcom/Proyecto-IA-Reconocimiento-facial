import type { Etiqueta } from '../types/facial'

export const ETIQUETA_TEXT: Record<Etiqueta, string> = {
  acierto: 'Acierto',
  rechazo_correcto: 'Rechazo correcto',
  falso_positivo: 'Falso positivo',
  falso_negativo: 'Falso negativo',
}

// A hit and a correct rejection are what the system should do; the other two are its mistakes
export function isCorrect(etiqueta: Etiqueta): boolean {
  return etiqueta === 'acierto' || etiqueta === 'rechazo_correcto'
}

// What is sent as the expected person when nobody registered is in front of the camera
export const UNKNOWN_EXPECTED = 'desconocido'
