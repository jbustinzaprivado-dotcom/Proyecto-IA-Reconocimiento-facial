import { useState } from 'react'
import type { FormEvent } from 'react'
import { useUser } from '../auth/AuthContext'
import { canAccess } from '../auth/roles'
import QueryState from '../components/QueryState'
import { useApi } from '../hooks/useApi'
import { deletePerson, listPersons, purgePersons, setPersonActive } from '../services/api'
import type { Person } from '../types/facial'
import { formatDateTime } from '../utils/format'

const UNEXPECTED = 'Ocurrió un error inesperado.'
const SECONDARY =
  'rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50'
const DANGER =
  'rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50'

interface Notice {
  kind: 'ok' | 'error'
  text: string
}

// A name typed to confirm is compared without caring about capitals or repeated spaces: the point
// is to stop and think, not to catch a typo
function normalized(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ').toLowerCase()
}

export default function Personas() {
  const user = useUser()
  const isAdmin = canAccess(user.rol, 'administrador')
  const loaded = useApi(listPersons)
  const [persons, setPersons] = useState<Person[]>([])
  const [seen, setSeen] = useState<Person[] | null>(null)
  if (loaded.data !== seen) {
    setSeen(loaded.data)
    setPersons(loaded.data ?? [])
  }
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<Person | null>(null)
  const [purging, setPurging] = useState(false)
  const [purgeBusy, setPurgeBusy] = useState(false)

  async function toggle(person: Person) {
    setPending(person.id)
    setNotice(null)
    try {
      const response = await setPersonActive(person.id, !person.activo)
      if (response.success) {
        const updated = response.resultado
        setPersons((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        setNotice({
          kind: 'ok',
          text: `${person.nombre}: ${updated.activo ? 'activada' : 'desactivada'}.`,
        })
      } else {
        setNotice({ kind: 'error', text: response.error })
      }
    } catch {
      setNotice({ kind: 'error', text: UNEXPECTED })
    } finally {
      setPending(null)
    }
  }

  async function remove(person: Person) {
    setPending(person.id)
    setNotice(null)
    try {
      const response = await deletePerson(person.id)
      if (response.success) {
        setPersons((list) => list.filter((item) => item.id !== person.id))
        setNotice({ kind: 'ok', text: `Se eliminó a ${person.nombre}.` })
        setDeleting(null)
      } else {
        setNotice({ kind: 'error', text: response.error })
      }
    } catch {
      setNotice({ kind: 'error', text: UNEXPECTED })
    } finally {
      setPending(null)
    }
  }

  async function purge() {
    setPurgeBusy(true)
    setNotice(null)
    try {
      const response = await purgePersons()
      if (response.success) {
        const count = response.resultado.eliminadas
        setNotice({
          kind: 'ok',
          text:
            count === 0
              ? 'No había personas sin rostros.'
              : `Se eliminó ${count === 1 ? '1 persona' : `${count} personas`} sin rostros.`,
        })
        setPurging(false)
        // The server decides who had no faces at all: the list is asked for again
        loaded.reload()
      } else {
        setNotice({ kind: 'error', text: response.error })
      }
    } catch {
      setNotice({ kind: 'error', text: UNEXPECTED })
    } finally {
      setPurgeBusy(false)
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Personas</h1>
        {isAdmin && (
          <button
            type="button"
            disabled={purging || purgeBusy}
            onClick={() => {
              setDeleting(null)
              setPurging(true)
            }}
            className={SECONDARY}
          >
            Limpiar personas sin rostros
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        {isAdmin
          ? 'Aquí se desactiva a una persona (deja de ser reconocida) o se elimina por completo.'
          : 'Solo un administrador puede desactivar o eliminar personas.'}
      </p>

      {purging && (
        <div
          role="group"
          aria-labelledby="limpiar-titulo"
          className="space-y-3 rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning"
        >
          <p id="limpiar-titulo" className="font-medium">
            ¿Eliminar a las personas que nunca llegaron a guardar un rostro?
          </p>
          <p>
            Son registros que se quedaron a medias. Se borran ellas y su consentimiento, y no se
            puede deshacer. Quien tenga rostros de cualquier modelo no se toca.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={purgeBusy}
              onClick={() => {
                void purge()
              }}
              className={DANGER}
            >
              {purgeBusy ? 'Eliminando…' : 'Sí, eliminar'}
            </button>
            <button
              type="button"
              disabled={purgeBusy}
              onClick={() => setPurging(false)}
              className={SECONDARY}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {deleting && (
        <DeleteConfirm
          key={deleting.id}
          person={deleting}
          busy={pending === deleting.id}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void remove(deleting)
          }}
        />
      )}

      <div aria-live="polite">
        {notice && (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`text-sm ${notice.kind === 'error' ? 'text-danger' : 'font-medium text-success'}`}
          >
            {notice.text}
          </p>
        )}
      </div>

      <QueryState loading={loaded.loading} error={loaded.error} onRetry={loaded.reload}>
        {persons.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay personas registradas.</p>
        ) : (
          <div
            role="region"
            tabIndex={0}
            aria-label="Tabla de personas"
            className="overflow-x-auto rounded-xl border border-line bg-white"
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Personas registradas</caption>
              <thead className="border-b border-line bg-tint text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Persona
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Rostros
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Consentimiento
                  </th>
                  {isAdmin && (
                    <th scope="col" className="px-4 py-2 font-medium">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {persons.map((person) => (
                  <tr key={person.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{person.nombre}</p>
                      <p className="text-muted">{person.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={person.activo ? 'text-success' : 'text-warning'}>
                        {person.activo ? 'Activa' : 'Desactivada'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {person.rostros === 0 ? (
                        <span className="text-warning">Sin rostros</span>
                      ) : (
                        person.rostros
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {person.consentimiento_version} · {formatDateTime(person.consentimiento_at)}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={pending === person.id}
                            aria-label={`${person.activo ? 'Desactivar' : 'Activar'} a ${person.nombre}`}
                            onClick={() => {
                              void toggle(person)
                            }}
                            className={SECONDARY}
                          >
                            {person.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button
                            type="button"
                            disabled={pending === person.id}
                            aria-label={`Eliminar a ${person.nombre}`}
                            onClick={() => {
                              setPurging(false)
                              setDeleting(person)
                            }}
                            className={SECONDARY}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </section>
  )
}

interface DeleteConfirmProps {
  person: Person
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

// Deleting cannot be undone, so the name has to be typed
function DeleteConfirm({ person, busy, onCancel, onConfirm }: DeleteConfirmProps) {
  const [typed, setTyped] = useState('')
  const matches = normalized(typed) === normalized(person.nombre)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (matches && !busy) onConfirm()
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby="eliminar-titulo"
      className="space-y-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
    >
      <p id="eliminar-titulo" className="font-medium">
        Eliminar a {person.nombre}
      </p>
      <p>
        Se borran la persona, sus vectores faciales y su consentimiento. Sus intentos anteriores
        quedan en el historial, pero sin su nombre. No se puede deshacer.
      </p>
      <div>
        <label htmlFor="confirmar-nombre" className="block font-medium">
          Escribe «{person.nombre}» para confirmar
        </label>
        <input
          id="confirmar-nombre"
          type="text"
          autoComplete="off"
          // The panel opens because of a click: the keyboard goes straight to what it asks for
          autoFocus
          value={typed}
          disabled={busy}
          onChange={(event) => setTyped(event.target.value)}
          className="mt-1 block w-full max-w-sm rounded-lg border border-muted bg-white px-3 py-2 text-ink"
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!matches || busy} className={DANGER}>
          {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={SECONDARY}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
