import { describe, expect, it } from 'vitest'
import type { AnalysisBin, CurvePoint } from '../types/facial'
import {
  binLabel,
  binOf,
  formatDay,
  percentOrDash,
  plural,
  pointAt,
  snapToHundredth,
} from './analysis'

const curve: CurvePoint[] = Array.from({ length: 101 }, (_, i) => ({
  umbral: i / 100,
  coincidencias: i,
  verdaderos_positivos: 0,
  falsos_positivos: 0,
  falsos_negativos: 0,
  verdaderos_negativos: 0,
  tasa_falsos_positivos: null,
  tasa_falsos_negativos: null,
}))

const bins: AnalysisBin[] = Array.from({ length: 20 }, (_, i) => ({
  desde: i / 20,
  hasta: (i + 1) / 20,
  coincidencias: 0,
  rechazos: 0,
}))

describe('pointAt', () => {
  it('finds the point of a threshold, at either end too', () => {
    expect(pointAt(curve, 0.4)?.coincidencias).toBe(40)
    expect(pointAt(curve, 0)?.coincidencias).toBe(0)
    expect(pointAt(curve, 1)?.coincidencias).toBe(100)
  })

  it('finds it in spite of the noise of floating point', () => {
    expect(pointAt(curve, 0.35000000000000003)?.coincidencias).toBe(35)
    expect(pointAt(curve, 0.1 + 0.2)?.coincidencias).toBe(30)
  })

  it('finds nothing for a threshold outside the curve', () => {
    expect(pointAt(curve, 1.5)).toBeNull()
    expect(pointAt(curve, -0.2)).toBeNull()
    expect(pointAt([], 0.5)).toBeNull()
  })
})

describe('snapToHundredth', () => {
  it('brings a threshold to the hundredth the slider can show', () => {
    expect(snapToHundredth(0.363)).toBe(0.36)
    expect(snapToHundredth(0.4)).toBe(0.4)
    expect(snapToHundredth(0.756)).toBe(0.76)
    expect(snapToHundredth(0)).toBe(0)
  })
})

describe('binLabel', () => {
  it('shows the range with two decimals', () => {
    expect(binLabel(bins[3])).toBe('0.15–0.20')
    expect(binLabel(bins[19])).toBe('0.95–1.00')
  })
})

describe('binOf', () => {
  it('gives the bin that starts at or below the threshold and ends above it', () => {
    expect(binOf(bins, 0.4)).toBe(bins[8])
    expect(binOf(bins, 0.43)).toBe(bins[8])
    expect(binOf(bins, 0.4999)).toBe(bins[9])
    expect(binOf(bins, 0.5)).toBe(bins[10])
  })

  it('puts the ends in the first and the last bin', () => {
    expect(binOf(bins, 0)).toBe(bins[0])
    expect(binOf(bins, 1)).toBe(bins[19])
    expect(binOf(bins, 0.99)).toBe(bins[19])
  })

  it('gives nothing for a threshold outside the range or without bins', () => {
    expect(binOf(bins, 1.01)).toBeNull()
    expect(binOf(bins, -0.01)).toBeNull()
    expect(binOf([], 0.5)).toBeNull()
  })
})

describe('percentOrDash', () => {
  it('shows a percentage, and a dash for what could not be worked out', () => {
    expect(percentOrDash(0.5)).toBe('50 %')
    expect(percentOrDash(0)).toBe('0 %')
    expect(percentOrDash(null)).toBe('—')
  })
})

describe('plural', () => {
  it('uses the singular for exactly one and the plural for anything else, zero included', () => {
    expect(plural(1, 'intento', 'intentos')).toBe('1 intento')
    expect(plural(0, 'intento', 'intentos')).toBe('0 intentos')
    expect(plural(2, 'intento', 'intentos')).toBe('2 intentos')
    expect(plural(11, 'día', 'días')).toBe('11 días')
  })
})

describe('formatDay', () => {
  it('shows day and month from the text, with no time zone in between', () => {
    expect(formatDay('2026-09-05')).toBe('05/09')
    expect(formatDay('2026-12-31')).toBe('31/12')
    expect(formatDay('2027-01-01')).toBe('01/01')
  })
})
