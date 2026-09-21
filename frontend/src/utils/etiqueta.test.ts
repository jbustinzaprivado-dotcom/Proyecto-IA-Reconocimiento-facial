import { describe, expect, it } from 'vitest'
import type { Etiqueta } from '../types/facial'
import { ETIQUETA_TEXT, isCorrect } from './etiqueta'

describe('etiqueta', () => {
  it('counts a hit and a correct rejection as right, and the two mistakes as wrong', () => {
    expect(isCorrect('acierto')).toBe(true)
    expect(isCorrect('rechazo_correcto')).toBe(true)
    expect(isCorrect('falso_positivo')).toBe(false)
    expect(isCorrect('falso_negativo')).toBe(false)
  })

  it('has a Spanish text for every label', () => {
    const all: Etiqueta[] = ['acierto', 'rechazo_correcto', 'falso_positivo', 'falso_negativo']
    expect(all.map((etiqueta) => ETIQUETA_TEXT[etiqueta])).toEqual([
      'Acierto',
      'Rechazo correcto',
      'Falso positivo',
      'Falso negativo',
    ])
  })
})
