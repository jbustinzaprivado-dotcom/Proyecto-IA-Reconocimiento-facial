import { Camera, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import Webcam from 'react-webcam'
import { prepareCanvas, prepareFile } from '../utils/image'
import type { PrepareResult } from '../utils/image'

interface CameraCaptureProps {
  maxImages: number
  onChange: (images: Blob[]) => void
}

interface Capture {
  id: number
  blob: Blob
  url: string
}

type CameraState = 'starting' | 'active' | 'unavailable'

const BUTTON =
  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

export default function CameraCapture({ maxImages, onChange }: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null)
  const nextId = useRef(1)
  const latest = useRef<Capture[]>([])
  const [captures, setCaptures] = useState<Capture[]>([])
  const [cameraState, setCameraState] = useState<CameraState>('starting')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    latest.current = captures
  }, [captures])

  // Release the thumbnail URLs when the component goes away
  useEffect(
    () => () => {
      latest.current.forEach((capture) => URL.revokeObjectURL(capture.url))
    },
    [],
  )

  const full = captures.length >= maxImages
  const videoConstraints: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: 'user' }

  function commit(next: Capture[]) {
    setCaptures(next)
    onChange(next.map((capture) => capture.blob))
  }

  function addResults(results: PrepareResult[], notice: string | null = null) {
    const added: Capture[] = []
    let failure: string | null = null
    for (const result of results) {
      if (result.ok) {
        added.push({
          id: nextId.current++,
          blob: result.image,
          url: URL.createObjectURL(result.image),
        })
      } else {
        failure = result.error
      }
    }
    setError(failure ?? notice)
    if (added.length > 0) commit([...captures, ...added])
  }

  async function handleUserMedia() {
    setCameraState('active')
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((device) => device.kind === 'videoinput'))
    } catch {
      setDevices([])
    }
  }

  async function capture() {
    const canvas = webcamRef.current?.getCanvas()
    if (!canvas) {
      setError('No se pudo capturar la imagen. Inténtalo de nuevo.')
      return
    }
    setBusy(true)
    addResults([await prepareCanvas(canvas)])
    setBusy(false)
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    const room = maxImages - captures.length
    if (files.length === 0 || room <= 0) return
    setBusy(true)
    const results = await Promise.all(files.slice(0, room).map((file) => prepareFile(file)))
    const notice =
      files.length > room ? `Máximo ${maxImages} imágenes: se descartaron las sobrantes.` : null
    addResults(results, notice)
    setBusy(false)
  }

  function remove(id: number) {
    const target = captures.find((item) => item.id === id)
    if (target) URL.revokeObjectURL(target.url)
    setError(null)
    commit(captures.filter((item) => item.id !== id))
  }

  return (
    <section aria-label="Captura de imágenes" className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-line bg-tint">
        {cameraState === 'unavailable' ? (
          <p role="status" className="p-6 text-center text-sm text-muted">
            No se pudo acceder a la cámara. Puedes subir una imagen desde tu equipo.
          </p>
        ) : (
          <>
            {cameraState === 'starting' && (
              <p role="status" className="p-6 text-center text-sm text-muted">
                Solicitando acceso a la cámara…
              </p>
            )}
            <Webcam
              ref={webcamRef}
              audio={false}
              forceScreenshotSourceSize
              videoConstraints={videoConstraints}
              onUserMedia={() => {
                void handleUserMedia()
              }}
              onUserMediaError={() => setCameraState('unavailable')}
              aria-label="Vista previa de la cámara"
              className="w-full -scale-x-100"
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void capture()
          }}
          disabled={cameraState !== 'active' || busy || full}
          className={`${BUTTON} bg-brand text-white hover:bg-brand/90`}
        >
          <Camera size={18} aria-hidden="true" />
          Capturar
        </button>

        <label
          className={`${BUTTON} border border-line bg-white text-ink focus-within:ring-2 focus-within:ring-brand ${
            busy || full ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-tint'
          }`}
        >
          <Upload size={18} aria-hidden="true" />
          {maxImages > 1 ? 'Subir imágenes' : 'Subir imagen'}
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple={maxImages > 1}
            disabled={busy || full}
            onChange={(event) => {
              void handleFiles(event)
            }}
            className="sr-only"
          />
        </label>

        {devices.length > 1 && (
          <select
            aria-label="Cámara"
            value={deviceId ?? ''}
            onChange={(event) => setDeviceId(event.target.value || undefined)}
            className="rounded-lg border border-muted bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">Frontal (predeterminada)</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Cámara ${index + 1}`}
              </option>
            ))}
          </select>
        )}

        <span className="ml-auto text-sm text-muted">
          {captures.length} de {maxImages}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {captures.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {captures.map((item, index) => (
            <li key={item.id} className="relative overflow-hidden rounded-lg border border-line">
              <img
                src={item.url}
                alt={`Imagen ${index + 1}`}
                className="aspect-square w-full object-cover"
              />
              <button
                type="button"
                onClick={() => remove(item.id)}
                disabled={busy}
                aria-label={`Quitar imagen ${index + 1}`}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-danger hover:bg-white disabled:opacity-50"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
