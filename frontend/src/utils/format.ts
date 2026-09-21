const dateTimeFormat = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// Similarity, distance and threshold are shown as decimals (0.87), never as a percentage
export function formatDecimal(value: number): string {
  return value.toFixed(2)
}

// Only a calibrated probability is shown as a percentage (93 %)
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}\u00a0%`
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso))
}

const fullDateTimeFormat = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'short',
  timeStyle: 'medium',
  hour12: false,
})

// With the year and the seconds, for a log where the exact moment matters
export function formatFullDateTime(iso: string): string {
  return fullDateTimeFormat.format(new Date(iso))
}
