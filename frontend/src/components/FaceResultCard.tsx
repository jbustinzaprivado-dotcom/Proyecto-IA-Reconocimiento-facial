import { CircleCheck, CircleX } from 'lucide-react'
import type { ConfidenceLevel, RecognitionResult } from '../types/facial'
import { formatDecimal, formatPercent } from '../utils/format'
import EtiquetaBadge from './EtiquetaBadge'
import SimilarityBar from './SimilarityBar'

interface FaceResultCardProps {
  result: RecognitionResult
}

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

const CONFIDENCE_STYLE: Record<ConfidenceLevel, string> = {
  alta: 'bg-success-soft text-success',
  media: 'bg-warning-soft text-warning',
  baja: 'bg-danger-soft text-danger',
}

export default function FaceResultCard({ result }: FaceResultCardProps) {
  const probability =
    result.probabilidad_calibrada === null
      ? 'Sin calibrar'
      : formatPercent(result.probabilidad_calibrada)

  return (
    <article
      aria-label="Resultado de reconocimiento"
      className="space-y-4 rounded-xl border border-line bg-white p-5 shadow-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Identidad candidata</p>
          <h2 className="text-xl font-semibold text-ink">{result.nombre ?? 'Sin candidato'}</h2>
        </div>
        {result.coincide ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-3 py-1 text-sm font-medium text-success">
            <CircleCheck size={16} aria-hidden="true" />
            Coincide
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-3 py-1 text-sm font-medium text-danger">
            <CircleX size={16} aria-hidden="true" />
            No coincide
          </span>
        )}
      </header>

      <SimilarityBar similarity={result.similitud} threshold={result.umbral} />

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted">Distancia</dt>
          <dd className="font-medium text-ink">{formatDecimal(result.distancia)}</dd>
        </div>
        <div>
          <dt className="text-muted">Confianza</dt>
          <dd>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[result.confianza]}`}
            >
              {CONFIDENCE_LABEL[result.confianza]}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Probabilidad calibrada</dt>
          <dd className="font-medium text-ink">{probability}</dd>
        </div>
      </dl>

      {result.etiqueta && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Evaluación:
          <EtiquetaBadge etiqueta={result.etiqueta} />
        </p>
      )}
    </article>
  )
}
