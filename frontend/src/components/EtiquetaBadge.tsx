import { CircleCheck, CircleX } from 'lucide-react'
import type { Etiqueta } from '../types/facial'
import { ETIQUETA_TEXT, isCorrect } from '../utils/etiqueta'

interface EtiquetaBadgeProps {
  etiqueta: Etiqueta
}

// The icon and the words say it too, so the color is never the only clue
export default function EtiquetaBadge({ etiqueta }: EtiquetaBadgeProps) {
  const correct = isCorrect(etiqueta)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        correct ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
      }`}
    >
      {correct ? (
        <CircleCheck size={14} aria-hidden="true" />
      ) : (
        <CircleX size={14} aria-hidden="true" />
      )}
      {ETIQUETA_TEXT[etiqueta]}
    </span>
  )
}
