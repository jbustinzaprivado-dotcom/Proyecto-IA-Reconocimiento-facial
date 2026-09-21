import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import type { AuditEntry, AuditPage } from '../types/auth'
import Auditoria from './Auditoria'

vi.mock('../services/api', () => ({ getAudit: vi.fn() }))

const entry = (id: number, extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id,
  created_at: '2026-09-19T15:42:10Z',
  usuario_email: 'ana@example.com',
  accion: 'login',
  recurso: null,
  recurso_id: null,
  resultado: 'ok',
  detalle: null,
  ip: '10.0.0.5',
  ...extra,
})

const page = (registros: AuditEntry[], siguiente: number | null = null): AuditPage => ({
  registros,
  siguiente,
})

function answer(...pages: AuditPage[]) {
  const mock = vi.mocked(api.getAudit)
  for (const one of pages) mock.mockResolvedValueOnce({ success: true, resultado: one })
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const lastQuery = () => vi.mocked(api.getAudit).mock.calls.at(-1)?.[0]
const bodyRows = () => Array.from(document.querySelectorAll('tbody tr'))

beforeEach(() => {
  vi.mocked(api.getAudit).mockReset()
})

describe('Auditoria: the rows', () => {
  it('asks for the first page without any filter, and shows a message while it loads', async () => {
    answer(page([entry(1)]))
    render(<Auditoria />)
    expect(screen.getByText('Cargando…')).toBeTruthy()
    await screen.findByText('ana@example.com')
    expect(api.getAudit).toHaveBeenCalledExactlyOnceWith({})
  })

  it('says in words who did what, with the result, the detail and the address', async () => {
    answer(
      page([
        entry(3, {
          accion: 'persona_eliminar',
          recurso: 'persona',
          recurso_id: 12,
          detalle: 'algo más',
          resultado: 'ok',
        }),
        entry(2, { accion: 'denegado', resultado: 'denegado', detalle: 'POST /api/personas' }),
        entry(1, {
          usuario_email: null,
          resultado: 'fallo',
          detalle: 'correo desconocido',
          ip: null,
        }),
      ]),
    )
    render(<Auditoria />)
    await screen.findByText('Persona eliminada')
    const [first, second, third] = bodyRows() as HTMLElement[]
    expect(within(first).getByText('Persona eliminada')).toBeTruthy()
    expect(within(first).getByText('Correcto')).toBeTruthy()
    expect(within(first).getByText('persona n.º 12 · algo más')).toBeTruthy()
    expect(within(first).getByText('10.0.0.5')).toBeTruthy()
    expect(within(second).getByText('Acceso denegado')).toBeTruthy()
    expect(within(second).getByText('Denegado')).toBeTruthy()
    expect(within(second).getByText('POST /api/personas')).toBeTruthy()
    expect(within(third).getByText('Sin usuario')).toBeTruthy()
    expect(within(third).getByText('Fallo')).toBeTruthy()
    // No address, no detail about a resource: a dash where there is nothing to say
    expect(within(third).getByText('—')).toBeTruthy()
  })

  it('shows an action it does not know as it came, and a resource with no number without one', async () => {
    answer(page([entry(1, { accion: 'algo_nuevo', recurso: 'modelo', resultado: 'raro' })]))
    render(<Auditoria />)
    await screen.findByText('algo_nuevo')
    expect(screen.getByText('raro')).toBeTruthy()
    expect(screen.getByText('modelo')).toBeTruthy()
  })

  it('shows the full date, with the year and the seconds', async () => {
    answer(page([entry(1, { created_at: '2026-09-19T15:42:10Z' })]))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    const cell = bodyRows()[0].querySelector('td') as HTMLElement
    expect(cell.textContent).toMatch(/26/)
    expect(cell.textContent).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('counts the rows, in the singular and the plural', async () => {
    answer(page([entry(1)]))
    render(<Auditoria />)
    expect(await screen.findByText('1 registro.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull()
  })

  it('says so when there is nothing to show', async () => {
    answer(page([]))
    render(<Auditoria />)
    expect(await screen.findByText('No hay registros con estos filtros.')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })

  it('says it is read only, and what it never keeps', async () => {
    answer(page([]))
    render(<Auditoria />)
    await screen.findByText('No hay registros con estos filtros.')
    expect(screen.getByText(/no se puede cambiar ni borrar desde aquí/)).toBeTruthy()
    expect(
      screen.getByText(/Nunca guarda contraseñas, tokens, nombres de personas ni imágenes/),
    ).toBeTruthy()
  })
})

describe('Auditoria: more rows', () => {
  it('offers more when the API says there is a next page, and asks for it with that number', async () => {
    answer(page([entry(9), entry(8)], 8), page([entry(7), entry(6)], null))
    render(<Auditoria />)
    await screen.findAllByText('ana@example.com')
    expect(screen.getByText('2 registros (hay más).')).toBeTruthy()

    fireEvent.click(button('Cargar más'))
    await waitFor(() => expect(bodyRows()).toHaveLength(4))
    expect(lastQuery()).toEqual({ antes_de_id: 8 })
    expect(screen.getByText('4 registros.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull()
  })

  it('adds the new rows after the ones already shown, in the order that came', async () => {
    answer(page([entry(9, { accion: 'login' })], 9), page([entry(5, { accion: 'entrenar' })], null))
    render(<Auditoria />)
    await screen.findByText('Inicio de sesión')
    fireEvent.click(button('Cargar más'))
    await screen.findByText('Entrenamiento del modelo')
    expect(bodyRows().map((tr) => tr.querySelectorAll('td')[2].textContent)).toEqual([
      'Inicio de sesión',
      'Entrenamiento del modelo',
    ])
  })

  it('keeps the filters while it walks the pages', async () => {
    answer(page([entry(9)]))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'fallo' } })
    answer(page([entry(4, { resultado: 'fallo' })], 4), page([]))
    fireEvent.click(button('Filtrar'))
    await waitFor(() => expect(lastQuery()).toEqual({ resultado: 'fallo' }))
    await screen.findByText('Fallo', { selector: 'span' })
    fireEvent.click(button('Cargar más'))
    await waitFor(() => expect(lastQuery()).toEqual({ resultado: 'fallo', antes_de_id: 4 }))
  })

  it('says so, without losing the rows, when the next page cannot be had', async () => {
    answer(page([entry(9)], 9))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    vi.mocked(api.getAudit).mockResolvedValueOnce({ success: false, error: 'No hay conexión.' })
    fireEvent.click(button('Cargar más'))
    expect((await screen.findByRole('alert')).textContent).toBe('No hay conexión.')
    expect(bodyRows()).toHaveLength(1)
    expect(button('Cargar más').disabled).toBe(false)
  })

  it('turns an unexpected exception of the next page into a message', async () => {
    answer(page([entry(9)], 9))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    vi.mocked(api.getAudit).mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(button('Cargar más'))
    expect((await screen.findByRole('alert')).textContent).toBe('Ocurrió un error inesperado.')
  })

  it('locks the button while the next page comes', async () => {
    answer(page([entry(9)], 9))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    let finish: (value: Awaited<ReturnType<typeof api.getAudit>>) => void = () => {}
    vi.mocked(api.getAudit).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(button('Cargar más'))
    await waitFor(() => expect(button('Cargando…').disabled).toBe(true))
    expect(button('Actualizar').disabled).toBe(true)
    finish({ success: true, resultado: page([entry(2)]) })
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
  })
})

describe('Auditoria: the filters', () => {
  const user = () => screen.getByLabelText('Usuario (parte del correo)') as HTMLInputElement
  const action = () => screen.getByLabelText('Acción') as HTMLSelectElement
  const result = () => screen.getByLabelText('Resultado') as HTMLSelectElement
  const since = () => screen.getByLabelText('Desde') as HTMLInputElement

  async function shown() {
    answer(page([entry(1)]))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    vi.mocked(api.getAudit).mockClear()
  }

  it('offers every action with words, and "Todas" first', async () => {
    await shown()
    const labels = Array.from(action().options).map((option) => option.textContent)
    expect(labels[0]).toBe('Todas')
    expect(labels).toContain('Inicio de sesión')
    expect(labels).toContain('Acceso denegado')
    expect(labels).toContain('Contraseña restablecida (comando)')
    expect(labels).toHaveLength(18)
    expect(action().value).toBe('')
  })

  it('offers the four results with words', async () => {
    await shown()
    expect(Array.from(result().options).map((option) => option.textContent)).toEqual([
      'Todos',
      'Correcto',
      'Fallo',
      'Bloqueado',
      'Denegado',
    ])
  })

  it('does nothing until Filtrar is pressed', async () => {
    await shown()
    fireEvent.change(user(), { target: { value: 'ana' } })
    fireEvent.change(action(), { target: { value: 'login' } })
    expect(api.getAudit).not.toHaveBeenCalled()
  })

  it('sends only the filters that were filled, with the action and the result as the API knows them', async () => {
    await shown()
    answer(page([]))
    fireEvent.change(user(), { target: { value: '  ana  ' } })
    fireEvent.change(action(), { target: { value: 'persona_eliminar' } })
    fireEvent.change(result(), { target: { value: 'denegado' } })
    fireEvent.click(button('Filtrar'))
    await waitFor(() => expect(api.getAudit).toHaveBeenCalledTimes(1))
    expect(lastQuery()).toEqual({
      usuario: 'ana',
      accion: 'persona_eliminar',
      resultado: 'denegado',
    })
  })

  it('does not send a filter that is only spaces', async () => {
    await shown()
    answer(page([entry(1)]))
    fireEvent.change(user(), { target: { value: '   ' } })
    fireEvent.click(button('Filtrar'))
    await waitFor(() => expect(api.getAudit).toHaveBeenCalledTimes(1))
    expect(lastQuery()).toEqual({})
  })

  it('sends the date as a moment with its zone, from what the person chose in their own time', async () => {
    await shown()
    answer(page([]))
    fireEvent.change(since(), { target: { value: '2026-09-01T12:00' } })
    fireEvent.click(button('Filtrar'))
    await waitFor(() => expect(api.getAudit).toHaveBeenCalledTimes(1))
    const sent = (lastQuery() as { desde: string }).desde
    expect(sent).toMatch(/^2026-09-01T\d{2}:00:00\.000Z$/)
    expect(sent).toBe(new Date('2026-09-01T12:00').toISOString())
  })

  it('shows the new rows in place of the old ones', async () => {
    await shown()
    answer(page([entry(4, { accion: 'entrenar', usuario_email: 'luis@example.com' })]))
    fireEvent.click(button('Filtrar'))
    await screen.findByText('luis@example.com')
    expect(screen.queryByText('ana@example.com')).toBeNull()
    expect(bodyRows()).toHaveLength(1)
  })

  it('takes every filter off with "Quitar filtros", and asks again with none', async () => {
    await shown()
    answer(page([]))
    fireEvent.change(user(), { target: { value: 'ana' } })
    fireEvent.change(result(), { target: { value: 'fallo' } })
    fireEvent.click(button('Filtrar'))
    await waitFor(() => expect(lastQuery()).toEqual({ usuario: 'ana', resultado: 'fallo' }))

    answer(page([entry(1)]))
    fireEvent.click(button('Quitar filtros'))
    await waitFor(() => expect(lastQuery()).toEqual({}))
    expect(user().value).toBe('')
    expect(result().value).toBe('')
    expect(action().value).toBe('')
    expect(since().value).toBe('')
  })

  it('can be sent with the keyboard, which is sending the form', async () => {
    await shown()
    answer(page([]))
    fireEvent.change(user(), { target: { value: 'luis' } })
    fireEvent.submit(user().closest('form') as HTMLFormElement)
    await waitFor(() => expect(lastQuery()).toEqual({ usuario: 'luis' }))
  })
})

describe('Auditoria: when it cannot be had', () => {
  it('shows the error with a retry, and no table', async () => {
    vi.mocked(api.getAudit).mockResolvedValueOnce({
      success: false,
      error: 'No tienes permiso para hacer esto.',
    })
    render(<Auditoria />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No tienes permiso para hacer esto.')
    expect(document.querySelector('table')).toBeNull()

    answer(page([entry(1)]))
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await screen.findByText('ana@example.com')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('turns an unexpected exception into a message', async () => {
    vi.mocked(api.getAudit).mockRejectedValueOnce(new Error('boom'))
    render(<Auditoria />)
    expect((await screen.findByRole('alert')).textContent).toContain('Ocurrió un error inesperado.')
  })

  it('shows an error over the rows of before when a filter fails', async () => {
    answer(page([entry(1)]))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    vi.mocked(api.getAudit).mockResolvedValueOnce({ success: false, error: 'Filtro inválido.' })
    fireEvent.click(button('Filtrar'))
    expect((await screen.findByRole('alert')).textContent).toContain('Filtro inválido.')
    expect(screen.queryByText('ana@example.com')).toBeNull()
  })
})

describe('Auditoria: refreshing', () => {
  it('asks for the first page again, with the filters that are applied', async () => {
    answer(page([entry(1)]))
    render(<Auditoria />)
    await screen.findByText('ana@example.com')
    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'ok' } })
    answer(page([entry(2)]))
    fireEvent.click(button('Filtrar'))
    await screen.findByText('ana@example.com')
    await waitFor(() => expect(api.getAudit).toHaveBeenCalledTimes(2))

    answer(page([entry(3, { usuario_email: 'nuevo@example.com' })]))
    fireEvent.click(button('Actualizar'))
    await screen.findByText('nuevo@example.com')
    expect(lastQuery()).toEqual({ resultado: 'ok' })
    expect(api.getAudit).toHaveBeenCalledTimes(3)
  })

  it('ignores an answer that comes late, after another request was made', async () => {
    let late: (value: Awaited<ReturnType<typeof api.getAudit>>) => void = () => {}
    vi.mocked(api.getAudit).mockReturnValueOnce(new Promise((resolve) => (late = resolve)))
    render(<Auditoria />)
    // The first request is still on its way when a filter is applied
    answer(page([entry(2, { usuario_email: 'segundo@example.com' })]))
    fireEvent.click(button('Filtrar'))
    await screen.findByText('segundo@example.com')
    late({ success: true, resultado: page([entry(1, { usuario_email: 'primero@example.com' })]) })
    await Promise.resolve()
    expect(screen.queryByText('primero@example.com')).toBeNull()
    expect(screen.getByText('segundo@example.com')).toBeTruthy()
  })
})
