import {
  ChartLine,
  ClipboardList,
  LockKeyhole,
  ScanFace,
  ShieldCheck,
  UserPlus,
  UserX,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

export const COMPANY = 'Aurora Biometrics'

interface Feature {
  icon: LucideIcon
  title: string
  text: string
}

// Only what the system really does: nothing here promises a result that the pages cannot show
const FEATURES: Feature[] = [
  {
    icon: UserPlus,
    title: 'Registro con consentimiento',
    text: 'Cada persona acepta el tratamiento de su imagen antes de registrarse. Se guarda una representación numérica del rostro y el consentimiento aceptado.',
  },
  {
    icon: ScanFace,
    title: 'Reconocimiento con Deep Learning',
    text: 'Compara un rostro con las personas registradas usando modelos preentrenados (InsightFace o SFace) y un umbral propio de cada modelo.',
  },
  {
    icon: ChartLine,
    title: 'Probabilidad de acierto',
    text: 'Con intentos evaluados, un modelo de Machine Learning estima qué tan probable es que el resultado sea correcto. Sin datos suficientes lo dice, no inventa cifras.',
  },
  {
    icon: ClipboardList,
    title: 'Análisis y reportes',
    text: 'Un panel con los intentos por día, la curva del umbral, los falsos positivos y negativos, y reportes descargables en CSV.',
  },
  {
    icon: ShieldCheck,
    title: 'Roles y auditoría',
    text: 'Tres roles con permisos distintos, y un registro de quién hizo qué y cuándo, sin guardar contraseñas ni nombres de personas.',
  },
  {
    icon: UserX,
    title: 'Datos bajo control',
    text: 'Un administrador puede desactivar a una persona o eliminarla junto con sus datos biométricos. Sus intentos quedan sin su nombre.',
  },
]

const STEPS = [
  {
    title: 'Registrar',
    text: 'Se ingresan el nombre, el correo y de una a cinco fotos, y la persona acepta el consentimiento informado.',
  },
  {
    title: 'Reconocer',
    text: 'Se toma o se sube una foto. El sistema responde si coincide, con la similitud, el umbral y la confianza del resultado.',
  },
  {
    title: 'Analizar',
    text: 'Cada intento queda en el historial. Con el modo evaluación se cuentan los aciertos y los errores para revisar el umbral.',
  },
]

const PRIVACY = [
  'Consentimiento informado antes de guardar cualquier imagen.',
  'Acceso por roles: cada persona ve y hace solo lo que su rol permite.',
  'Los vectores faciales nunca salen en una respuesta ni se muestran en pantalla.',
  'Auditoría de accesos y operaciones, y borrado de una persona cuando se pide.',
  'Un reconocimiento es una ayuda: no debe ser la única base para una decisión importante.',
]

const BUTTON =
  'inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90'
const SECONDARY =
  'inline-block rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium text-ink hover:bg-tint'

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <p className="flex items-center gap-2 font-semibold text-brand">
            <ScanFace size={24} aria-hidden="true" />
            {COMPANY}
          </p>
          <nav aria-label="Secciones" className="hidden items-center gap-5 text-sm sm:flex">
            <a href="#que-hace" className="text-ink hover:text-brand">
              Qué hace
            </a>
            <a href="#como-funciona" className="text-ink hover:text-brand">
              Cómo funciona
            </a>
            <a href="#privacidad" className="text-ink hover:text-brand">
              Privacidad
            </a>
          </nav>
          <Link to="/ingresar" className={BUTTON}>
            Ingresar
          </Link>
        </div>
      </header>

      <main id="contenido" tabIndex={-1}>
        <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <p className="text-sm font-medium text-brand">Reconocimiento facial con IA</p>
          <h1 className="mt-2 text-4xl font-semibold text-ink sm:text-5xl">{COMPANY}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            Sabe quién es quién con control, trazabilidad y respeto por la privacidad. Registra
            rostros con consentimiento, los reconoce con modelos de Deep Learning y estima qué tan
            fiable es cada resultado con Machine Learning.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/ingresar" className={BUTTON}>
              Ingresar
            </Link>
            <a href="#como-funciona" className={SECONDARY}>
              Ver cómo funciona
            </a>
          </div>
        </section>

        <section id="que-hace" aria-labelledby="que-hace-titulo" className="bg-white py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2 id="que-hace-titulo" className="text-2xl font-semibold text-ink">
              Qué hace
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-xl border border-line bg-surface p-5">
                  <Icon size={22} className="text-brand" aria-hidden="true" />
                  <h3 className="mt-3 text-base font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-sm text-muted">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="como-funciona" aria-labelledby="como-titulo" className="py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2 id="como-titulo" className="text-2xl font-semibold text-ink">
              Cómo funciona
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {STEPS.map(({ title, text }, index) => (
                <li key={title} className="rounded-xl border border-line bg-white p-5">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-tint text-sm font-semibold text-brand"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-sm text-muted">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacidad" aria-labelledby="privacidad-titulo" className="bg-white py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2
              id="privacidad-titulo"
              className="flex items-center gap-2 text-2xl font-semibold text-ink"
            >
              <LockKeyhole size={24} className="text-brand" aria-hidden="true" />
              Privacidad y consentimiento
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted">
              Los datos faciales son datos biométricos. El sistema se diseñó con esto presente desde
              el inicio, teniendo en cuenta la Ley N.º 29733 de Protección de Datos Personales del
              Perú.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-ink">
              {PRIVACY.map((item) => (
                <li key={item} className="flex gap-3">
                  <ShieldCheck
                    size={18}
                    className="mt-0.5 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-2xl rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
              El texto de consentimiento de esta versión es provisional y necesita revisión legal
              antes de cualquier uso con personas reales.
            </p>
          </div>
        </section>

        <section aria-labelledby="cta-titulo" className="py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2 id="cta-titulo" className="text-2xl font-semibold text-ink">
              ¿Listo para probarlo?
            </h2>
            <p className="mt-2 text-sm text-muted">Ingresa con tu cuenta para abrir el panel.</p>
            <Link to="/ingresar" className={`${BUTTON} mt-5`}>
              Ingresar
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted">
          <p>
            {COMPANY} es una empresa ficticia creada para una demostración académica (Actividad Nro.
            05). Este sitio no procesa datos reales de terceros.
          </p>
        </div>
      </footer>
    </div>
  )
}
