import { useState } from 'react'
import CameraCapture from '../components/CameraCapture'
import EvaluationSelector from '../components/EvaluationSelector'
import FaceResultCard from '../components/FaceResultCard'
import { recognize } from '../services/api'
import type { RecognitionResult } from '../types/facial'

export default function Reconocimiento() {
  const [images, setImages] = useState<Blob[]>([])
  const [result, setResult] = useState<RecognitionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [cameraKey, setCameraKey] = useState(0)
  // The evaluation mode stays on, with the same person, from one attempt to the next
  const [evaluating, setEvaluating] = useState(false)
  const [expected, setExpected] = useState('')

  function handleImages(next: Blob[]) {
    setImages(next)
    setResult(null)
    setError(null)
  }

  function handleEvaluating(next: boolean) {
    setEvaluating(next)
    setResult(null)
    setError(null)
  }

  function handleExpected(next: string) {
    setExpected(next)
    setResult(null)
    setError(null)
  }

  // With the mode on, somebody has to be chosen first: a wrong label is worse than none
  const missingExpected = evaluating && expected === ''

  async function run() {
    if (images.length === 0 || missingExpected) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const response = evaluating
        ? await recognize(images[0], expected)
        : await recognize(images[0])
      if (response.success) {
        setResult(response.resultado)
      } else {
        setError(response.error)
      }
    } catch {
      setError('Ocurrió un error inesperado.')
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    setImages([])
    setResult(null)
    setError(null)
    setCameraKey((key) => key + 1)
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Reconocimiento</h1>

      <fieldset disabled={running} className="min-w-0">
        <CameraCapture key={cameraKey} maxImages={1} onChange={handleImages} />
      </fieldset>

      <EvaluationSelector
        enabled={evaluating}
        expected={expected}
        onEnabledChange={handleEvaluating}
        onExpectedChange={handleExpected}
        disabled={running}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void run()
          }}
          disabled={images.length === 0 || running || missingExpected}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Reconociendo…' : 'Reconocer'}
        </button>
        {missingExpected && (
          <p className="text-sm text-muted">Elige quién está frente a la cámara para reconocer.</p>
        )}
        {(result || error) && (
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-tint"
          >
            Nueva consulta
          </button>
        )}
      </div>

      <div aria-live="polite" className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {result && (
          <>
            <FaceResultCard result={result} />
            <p className="text-sm text-muted">
              Este resultado es una ayuda para la decisión y no debe usarse como única base para
              decisiones importantes.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
