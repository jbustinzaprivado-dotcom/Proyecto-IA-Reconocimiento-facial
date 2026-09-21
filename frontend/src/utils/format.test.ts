import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDecimal, formatPercent } from './format'

describe('formatDecimal', () => {
  it('shows two decimals', () => {
    expect(formatDecimal(0.87)).toBe('0.87')
    expect(formatDecimal(1)).toBe('1.00')
    expect(formatDecimal(0.126)).toBe('0.13')
  })
})

describe('formatPercent', () => {
  it('rounds to a whole percentage with a non-breaking space', () => {
    expect(formatPercent(0.934)).toBe('93\u00a0%')
    expect(formatPercent(0.5)).toBe('50\u00a0%')
    expect(formatPercent(0)).toBe('0\u00a0%')
  })
})

describe('formatDateTime', () => {
  it('shows day, month and 24-hour time', () => {
    expect(formatDateTime('2026-09-14T13:10:00Z')).toMatch(/^\d{1,2}\/\d{1,2},? \d{2}:\d{2}$/)
  })
})
