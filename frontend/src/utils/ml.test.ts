import { describe, expect, it } from 'vitest'
import { algorithmName } from './ml'

describe('algorithmName', () => {
  it('gives the name of each algorithm in Spanish', () => {
    expect(algorithmName('regresion_logistica')).toBe('Regresión Logística')
    expect(algorithmName('random_forest')).toBe('Random Forest')
    expect(algorithmName('gradient_boosting')).toBe('Gradient Boosting')
  })

  it('shows an algorithm it does not know as it came', () => {
    expect(algorithmName('xgboost')).toBe('xgboost')
    expect(algorithmName('')).toBe('')
  })
})
