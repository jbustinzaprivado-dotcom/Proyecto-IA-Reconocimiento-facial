import QueryState from './QueryState'
import { useApi } from '../hooks/useApi'
import { listPersons } from '../services/api'
import { UNKNOWN_EXPECTED } from '../utils/etiqueta'

interface EvaluationSelectorProps {
  enabled: boolean
  // "desconocido", the id of a person, or "" while nobody has been chosen yet
  expected: string
  onEnabledChange: (enabled: boolean) => void
  onExpectedChange: (expected: string) => void
  // While an attempt is being recognized, who is expected must not change under it
  disabled?: boolean
}

const FIELD = 'mt-1 block rounded-lg border border-muted bg-white px-3 py-2 text-sm text-ink'

// The evaluation mode: the operator says who is really in front of the camera, so that the attempt
// can be marked as right or wrong and the errors can be counted
export default function EvaluationSelector({
  enabled,
  expected,
  onEnabledChange,
  onExpectedChange,
  disabled = false,
}: EvaluationSelectorProps) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-white p-4">
      <label className="flex items-center gap-3 text-sm font-medium text-ink">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          className="h-4 w-4 accent-brand"
        />
        Modo evaluación
      </label>
      <p className="text-sm text-muted">
        Indica quién está frente a la cámara para que cada intento quede marcado como acierto o
        error. Sin el modo, el intento se guarda igual pero sin marca.
      </p>
      {enabled && (
        <PersonChoice expected={expected} onExpectedChange={onExpectedChange} disabled={disabled} />
      )}
    </div>
  )
}

interface PersonChoiceProps {
  expected: string
  onExpectedChange: (expected: string) => void
  disabled: boolean
}

// Only rendered with the mode on, so the list of people is not asked for otherwise
function PersonChoice({ expected, onExpectedChange, disabled }: PersonChoiceProps) {
  const persons = useApi(listPersons)
  // Somebody without faces of the model in use can never be recognized, so the server refuses
  // them: they are not offered
  const choices = (persons.data ?? []).filter((person) => person.activo && person.rostros > 0)

  return (
    <QueryState loading={persons.loading} error={persons.error} onRetry={persons.reload}>
      <label className="block text-sm font-medium text-ink">
        ¿Quién está frente a la cámara?
        <select
          value={expected}
          disabled={disabled}
          onChange={(event) => onExpectedChange(event.target.value)}
          className={FIELD}
        >
          <option value="">Elige una opción</option>
          {choices.map((person) => (
            <option key={person.id} value={String(person.id)}>
              {person.nombre}
            </option>
          ))}
          <option value={UNKNOWN_EXPECTED}>Desconocido (nadie registrado)</option>
        </select>
      </label>
      {choices.length === 0 && (
        <p className="text-sm text-muted">
          Todavía no hay personas activas con rostros del modelo en uso. Solo puedes elegir
          «Desconocido».
        </p>
      )}
    </QueryState>
  )
}
