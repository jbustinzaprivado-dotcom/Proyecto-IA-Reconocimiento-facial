import type { AnalysisBin, CurvePoint } from '../types/facial'
import { formatDecimal, formatPercent } from './format'

const NONE = '—'

// The curve has one point for every hundredth, so a threshold is looked up by its hundredth
export function pointAt(curve: CurvePoint[], threshold: number): CurvePoint | null {
  return curve.find((point) => Math.abs(point.umbral - threshold) < 0.005) ?? null
}

// The threshold in use, brought to the hundredth the slider can show
export function snapToHundredth(value: number): number {
  return Math.round(value * 100) / 100
}

export function binLabel(bin: AnalysisBin): string {
  return `${formatDecimal(bin.desde)}–${formatDecimal(bin.hasta)}`
}

// The bin that holds the threshold: it starts at or below it and ends above it (the last one holds 1)
export function binOf(bins: AnalysisBin[], threshold: number): AnalysisBin | null {
  return (
    bins.find(
      (bin) =>
        threshold >= bin.desde && (threshold < bin.hasta || (bin.hasta >= 1 && threshold <= 1)),
    ) ?? null
  )
}

// "1 intento", "2 intentos": the noun agrees with the count
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

// A rate that could not be worked out (nothing to divide by) is shown as a dash, never as 0 %
export function percentOrDash(value: number | null): string {
  return value === null ? NONE : formatPercent(value)
}

// "12/09" for the day 2026-09-12; no Date is made so that no time zone can move the day
export function formatDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`
}
