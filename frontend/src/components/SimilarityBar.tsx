import { formatDecimal } from '../utils/format'

interface SimilarityBarProps {
  similarity: number
  threshold: number
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

export default function SimilarityBar({ similarity, threshold }: SimilarityBarProps) {
  const fill = clamp(similarity) * 100
  const marker = clamp(threshold) * 100

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted">Similitud</span>
        <span className="font-semibold text-ink">{formatDecimal(similarity)}</span>
      </div>
      <div
        role="meter"
        aria-label="Similitud"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamp(similarity)}
        aria-valuetext={`Similitud ${formatDecimal(similarity)}, umbral ${formatDecimal(threshold)}`}
        className="relative h-3 rounded-full bg-tint"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${fill}%` }} />
        <div className="absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `${marker}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">Umbral {formatDecimal(threshold)}</p>
    </div>
  )
}
