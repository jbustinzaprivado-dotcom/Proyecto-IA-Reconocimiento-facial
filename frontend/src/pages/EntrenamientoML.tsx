import { useState } from 'react'
import { useUser } from '../auth/AuthContext'
import { canAccess } from '../auth/roles'
import ModelResults from '../components/ModelResults'
import QueryState from '../components/QueryState'
import StatCard from '../components/StatCard'
import { useApi } from '../hooks/useApi'
import { getMlStatus, trainModel } from '../services/api'
import type { MlStatus } from '../types/facial'
import { formatDateTime } from '../utils/format'
import { algorithmName } from '../utils/ml'

const TRAINING_OFF =
  'El entrenamiento está deshabilitado en el servidor. Para habilitarlo pon ML_TRAINING_ENABLED=true en su .env y reinicia la API.'

export default function EntrenamientoML() {
  const user = useUser()
  // Training changes what every later attempt shows: only an administrator may do it
  const canTrain = canAccess(user.rol, 'administrador')
  const status = useApi(getMlStatus)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trainedNow, setTrainedNow] = useState(false)

  async function train() {
    setRunning(true)
    setError(null)
    setTrainedNow(false)
    try {
      const response = await trainModel()
      if (response.success) setTrainedNow(true)
      else setError(response.error)
    } catch {
      setError('Ocurrió un error inesperado.')
    } finally {
      setRunning(false)
      // Also after a refusal: the counts may have changed
      status.reload()
    }
  }

  return (
    <section className="space-y-10">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-ink">Entrenamiento ML</h1>
          <button
            type="button"
            onClick={status.reload}
            disabled={status.loading || running}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50"
          >
            Actualizar
          </button>
        </div>
        <p className="text-sm text-muted">
          El modelo estima la probabilidad de que el candidato más cercano sea la persona correcta.
          Solo informa: que un intento coincida lo sigue decidiendo la similitud contra el umbral.
          Aprende de los intentos hechos con el Modo evaluación de Reconocimiento.
        </p>
      </div>

      <QueryState loading={status.loading} error={status.error} onRetry={status.reload}>
        {status.data && (
          <>
            <DataSection status={status.data} />
            <ModelSection
              status={status.data}
              running={running}
              error={error}
              trainedNow={trainedNow}
              canTrain={canTrain}
              onTrain={() => {
                void train()
              }}
            />
            {status.data.entrenado && (
              <section aria-labelledby="resultado-titulo" className="space-y-4">
                <h2 id="resultado-titulo" className="text-lg font-semibold text-ink">
                  Resultados
                </h2>
                <ModelResults />
              </section>
            )}
          </>
        )}
      </QueryState>
    </section>
  )
}

function DataSection({ status }: { status: MlStatus }) {
  return (
    <section aria-labelledby="datos-titulo" className="space-y-4">
      <h2 id="datos-titulo" className="text-lg font-semibold text-ink">
        Datos
      </h2>
      {status.modelo_facial && (
        <p className="text-sm text-muted">Modelo facial: {status.modelo_facial}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Intentos evaluados" value={status.ejemplos} />
        <StatCard label="Candidato correcto" value={status.ejemplos_correctos} />
        <StatCard label="Candidato incorrecto" value={status.ejemplos_incorrectos} />
        <StatCard label="Personas distintas" value={status.personas} />
      </div>
      <p className="text-sm text-muted">
        Para entrenar hacen falta al menos {status.minimo_ejemplos} intentos evaluados,{' '}
        {status.minimo_por_tipo} de cada tipo y {status.minimo_personas} personas distintas.
      </p>
      {status.datos_suficientes ? (
        <p role="status" className="text-sm font-medium text-success">
          Hay datos suficientes para entrenar.
        </p>
      ) : (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning"
        >
          <p className="font-medium">Todavía no hay datos suficientes:</p>
          <ul className="list-disc space-y-1 pl-5">
            {status.faltan.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

interface ModelSectionProps {
  status: MlStatus
  running: boolean
  error: string | null
  trainedNow: boolean
  canTrain: boolean
  onTrain: () => void
}

function ModelSection({
  status,
  running,
  error,
  trainedNow,
  canTrain,
  onTrain,
}: ModelSectionProps) {
  const blocked = !status.entrenamiento_habilitado || !status.datos_suficientes
  return (
    <section aria-labelledby="modelo-titulo" className="space-y-4">
      <h2 id="modelo-titulo" className="text-lg font-semibold text-ink">
        Modelo
      </h2>
      {status.entrenado && status.entrenado_en ? (
        <p className="text-sm text-ink">
          Modelo entrenado el {formatDateTime(status.entrenado_en)}
          {status.algoritmo && ` (${algorithmName(status.algoritmo)})`}.
        </p>
      ) : (
        <p className="text-sm text-muted">
          <strong className="text-ink">Sin calibrar:</strong> todavía no hay un modelo entrenado,
          así que la probabilidad calibrada no se muestra en los reconocimientos.
        </p>
      )}
      {canTrain && !status.entrenamiento_habilitado && (
        <p className="text-sm text-muted">{TRAINING_OFF}</p>
      )}
      {!canTrain && (
        <p className="text-sm text-muted">Solo un administrador puede entrenar el modelo.</p>
      )}
      {canTrain && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onTrain}
            disabled={blocked || running}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Entrenando…' : status.entrenado ? 'Volver a entrenar' : 'Entrenar modelo'}
          </button>
          {running && <p className="text-sm text-muted">Puede tardar unos segundos.</p>}
        </div>
      )}
      <div aria-live="polite" className="space-y-2">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {trainedNow && <p className="text-sm font-medium text-success">Modelo entrenado.</p>}
      </div>
    </section>
  )
}
