import { useState } from 'react'
import type { FormEvent } from 'react'
import CameraCapture from '../components/CameraCapture'
import { createPerson, uploadFaces } from '../services/api'
import type { Person } from '../types/facial'

const CONSENT_VERSION = 'v0-provisional'
const MAX_IMAGES = 5
const NAME_MIN = 2
const NAME_MAX = 100
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UNEXPECTED = 'Ocurrió un error inesperado.'

const INPUT =
  'mt-1 block w-full rounded-lg border border-muted bg-white px-3 py-2 text-ink aria-invalid:border-danger disabled:opacity-50'
const PRIMARY =
  'rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY =
  'rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50'
const MARK = 'rounded bg-warning-soft px-1 text-warning'

type Step = 'form' | 'saving' | 'done'

function validateName(value: string): string | null {
  const name = value.trim()
  if (name.length < NAME_MIN) return 'Escribe el nombre (mínimo 2 caracteres).'
  if (name.length > NAME_MAX) return 'El nombre no puede superar 100 caracteres.'
  return null
}

function validateEmail(value: string): string | null {
  return EMAIL_PATTERN.test(value.trim()) ? null : 'Escribe un correo válido.'
}

export default function RegistroFacial() {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [images, setImages] = useState<Blob[]>([])
  const [touched, setTouched] = useState({ nombre: false, email: false })
  const [step, setStep] = useState<Step>('form')
  const [error, setError] = useState<string | null>(null)
  // Set as soon as the person exists: from then on only the photo upload can be retried
  const [person, setPerson] = useState<Person | null>(null)
  const [savedImages, setSavedImages] = useState(0)
  const [formKey, setFormKey] = useState(0)
  // After a failed upload the photos can be changed: the earlier ones are kept to go back to them
  const [changing, setChanging] = useState(false)
  const [previous, setPrevious] = useState<Blob[]>([])

  const nameError = validateName(nombre)
  const emailError = validateEmail(email)
  const saving = step === 'saving'
  const canSubmit =
    nameError === null && emailError === null && images.length >= 1 && consent && step === 'form'

  function reset() {
    setNombre('')
    setEmail('')
    setConsent(false)
    setImages([])
    setTouched({ nombre: false, email: false })
    setStep('form')
    setError(null)
    setPerson(null)
    setSavedImages(0)
    setChanging(false)
    setPrevious([])
    setFormKey((key) => key + 1)
  }

  function startChanging() {
    setPrevious(images)
    setImages([])
    setChanging(true)
    setFormKey((key) => key + 1)
  }

  function keepPrevious() {
    setImages(previous)
    setPrevious([])
    setChanging(false)
  }

  async function upload(target: Person) {
    // The component that took the photos goes away while they are uploaded: after a failure the
    // photos that were chosen are the ones to retry, and changing them starts from an empty one
    setChanging(false)
    setPrevious([])
    setStep('saving')
    setError(null)
    try {
      const uploaded = await uploadFaces(target.id, images)
      if (uploaded.success) {
        setSavedImages(uploaded.resultado.imagenes_guardadas)
        setStep('done')
      } else {
        setError(uploaded.error)
        setStep('form')
      }
    } catch {
      setError(UNEXPECTED)
      setStep('form')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched({ nombre: true, email: true })
    if (!canSubmit) return
    setStep('saving')
    setError(null)
    try {
      const created = await createPerson({
        nombre: nombre.trim(),
        email: email.trim(),
        consentimiento_version: CONSENT_VERSION,
      })
      if (!created.success) {
        setError(created.error)
        setStep('form')
        return
      }
      setPerson(created.resultado)
      await upload(created.resultado)
    } catch {
      setError(UNEXPECTED)
      setStep('form')
    }
  }

  if (step === 'done' && person) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold text-ink">Registro facial</h1>
        <div
          role="status"
          className="space-y-1 rounded-lg border border-success/30 bg-success-soft p-4 text-sm text-success"
        >
          <p className="text-base font-semibold">Registro completado</p>
          <p>Persona registrada: {person.nombre}</p>
          <p>Imágenes guardadas: {savedImages}</p>
        </div>
        <button type="button" onClick={reset} className={PRIMARY}>
          Registrar otra persona
        </button>
      </section>
    )
  }

  if (person) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold text-ink">Registro facial</h1>
        {saving ? (
          <p role="status" className="text-sm text-muted">
            Subiendo fotos…
          </p>
        ) : (
          <div className="space-y-4">
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
            >
              <p>
                La persona quedó registrada, pero no se pudieron subir las fotos
                {error ? `: ${error}` : '.'}
              </p>
              <p>
                Si fue un problema de conexión, reintenta con las mismas fotos. Si una foto fue
                rechazada, cámbiala por otra y reintenta: la persona ya está registrada.
              </p>
            </div>

            {changing && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Fotos nuevas</p>
                <p className="text-sm text-muted">
                  Toma o sube de 1 a {MAX_IMAGES} fotos. Reemplazan a las anteriores.
                </p>
                <CameraCapture key={formKey} maxImages={MAX_IMAGES} onChange={setImages} />
              </div>
            )}

            <p className="text-sm text-muted">
              Fotos para subir: {images.length}
              {images.length === 0 && ' (elige al menos una)'}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={images.length === 0}
                onClick={() => {
                  void upload(person)
                }}
                className={PRIMARY}
              >
                Reintentar subida
              </button>
              {changing ? (
                <button type="button" onClick={keepPrevious} className={SECONDARY}>
                  Usar las fotos anteriores
                </button>
              ) : (
                <button type="button" onClick={startChanging} className={SECONDARY}>
                  Cambiar las fotos
                </button>
              )}
              <button type="button" onClick={reset} className={SECONDARY}>
                Abandonar y empezar de nuevo
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Registro facial</h1>

      <form
        noValidate
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <fieldset disabled={saving} className="min-w-0 space-y-6">
          <div>
            <label htmlFor="nombre" className="block text-sm font-medium text-ink">
              Nombre
            </label>
            <input
              id="nombre"
              type="text"
              autoComplete="name"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              onBlur={() => setTouched((state) => ({ ...state, nombre: true }))}
              aria-invalid={touched.nombre && nameError !== null}
              aria-describedby={touched.nombre && nameError ? 'nombre-error' : undefined}
              className={INPUT}
            />
            {touched.nombre && nameError && (
              <p id="nombre-error" className="mt-1 text-sm text-danger">
                {nameError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-ink">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setTouched((state) => ({ ...state, email: true }))}
              aria-invalid={touched.email && emailError !== null}
              aria-describedby={touched.email && emailError ? 'email-error' : undefined}
              className={INPUT}
            />
            {touched.email && emailError && (
              <p id="email-error" className="mt-1 text-sm text-danger">
                {emailError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Imágenes del rostro</p>
            <p className="text-sm text-muted">
              Toma o sube de 1 a {MAX_IMAGES} fotos. Necesitas al menos 1.
            </p>
            <CameraCapture key={formKey} maxImages={MAX_IMAGES} onChange={setImages} />
          </div>

          <fieldset className="min-w-0 space-y-3 rounded-lg border border-line bg-white p-4">
            <legend className="px-1 text-sm font-medium text-ink">Consentimiento informado</legend>
            <div
              role="region"
              tabIndex={0}
              aria-label="Texto del consentimiento"
              className="max-h-48 space-y-2 overflow-y-auto rounded bg-tint p-3 text-sm text-ink"
            >
              <p className="font-medium text-warning">
                Texto provisional ({CONSENT_VERSION}): pendiente de revisión legal. No usar en
                producción.
              </p>
              <p>
                <mark className={MARK}>[Responsable del tratamiento]</mark> tratará tu imagen facial
                y una representación numérica de tu rostro (embedding) con la única finalidad de
                reconocer tu identidad en este sistema.
              </p>
              <p>
                Estos datos son biométricos. Se conservarán durante{' '}
                <mark className={MARK}>[plazo de conservación]</mark> y solo podrán consultarlos
                personas autorizadas.
              </p>
              <p>
                Puedes solicitar el acceso, la rectificación, la cancelación y la oposición al
                tratamiento de tus datos escribiendo a <mark className={MARK}>[contacto]</mark>.
              </p>
              <p>
                El resultado de un reconocimiento facial es una ayuda y no se usará como única base
                para tomar decisiones importantes sobre ti.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1"
              />
              <span>He leído y acepto el tratamiento de mis imágenes faciales.</span>
            </label>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <button type="submit" disabled={!canSubmit} className={PRIMARY}>
            {saving ? 'Registrando…' : 'Registrar'}
          </button>
        </fieldset>
      </form>
    </section>
  )
}
