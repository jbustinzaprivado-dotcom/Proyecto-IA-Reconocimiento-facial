import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import type { HistoryItem } from '../types/facial'
import Historial from './Historial'

vi.mock('../services/api', () => ({ getHistory: vi.fn() }))

const base = { umbral: 0.75, distancia: 0.5 }
const INSIGHT = 'insightface-buffalo_l'
const SFACE = 'sface-2021dec'

// Deliberately out of order, to check that the page sorts by date
const items: HistoryItem[] = [
  {
    ...base,
    id: 2,
    persona_id: null,
    nombre: null,
    similitud: 0.31,
    coincide: false,
    probabilidad_calibrada: null,
    created_at: '2026-09-15T09:20:00Z',
    modelo: SFACE,
    etiqueta: null,
  },
  {
    ...base,
    id: 1,
    persona_id: 10,
    nombre: 'Ana Torres',
    similitud: 0.74,
    coincide: false,
    probabilidad_calibrada: 0.41,
    created_at: '2026-09-14T13:10:00Z',
    modelo: INSIGHT,
    etiqueta: 'falso_negativo',
  },
  {
    ...base,
    id: 3,
    persona_id: 12,
    nombre: 'Carlos',
    similitud: 0.87,
    coincide: true,
    probabilidad_calibrada: 0.93,
    created_at: '2026-09-19T15:42:00Z',
    modelo: INSIGHT,
    etiqueta: 'acierto',
  },
  {
    ...base,
    id: 4,
    persona_id: 10,
    nombre: 'Ana Torres',
    similitud: 0.91,
    coincide: true,
    probabilidad_calibrada: 0.97,
    created_at: '2026-09-18T17:05:00Z',
    modelo: SFACE,
    etiqueta: 'falso_positivo',
  },
]

function rows(): string[][] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    )
}

const people = () => rows().map((row) => row[1])

beforeEach(() => {
  vi.mocked(api.getHistory).mockReset()
  vi.mocked(api.getHistory).mockResolvedValue({ success: true, resultado: items })
})

describe('Historial', () => {
  it('lists the attempts from newest to oldest', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    expect(people()).toEqual(['Carlos', 'Ana Torres', 'Sin candidato', 'Ana Torres'])
    expect(screen.getByText('4 de 4 intentos')).toBeTruthy()
  })

  it('formats the numbers: decimals for similarity, percentage or "Sin calibrar" for probability', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    const [newest, , withoutCandidate] = rows()
    expect(newest.slice(2, 5)).toEqual(['0.87', '0.50', '0.75'])
    expect(newest[5]).toBe('Coincide')
    expect(newest[6]).toBe('93\u00a0%')
    expect(withoutCandidate[5]).toBe('No coincide')
    expect(withoutCandidate[6]).toBe('Sin calibrar')
  })

  it('makes the scrollable table reachable with the keyboard', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    const region = screen.getByRole('region', { name: 'Tabla de intentos' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(within(region).getByRole('table')).toBeTruthy()
  })

  it('filters by result', async () => {
    render(<Historial />)
    await screen.findByRole('table')

    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'coincide' } })
    expect(people()).toEqual(['Carlos', 'Ana Torres'])
    expect(screen.getByText('2 de 4 intentos')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'no-coincide' } })
    expect(people()).toEqual(['Sin candidato', 'Ana Torres'])
  })

  it('filters by person name without caring about case, and combines with the result', async () => {
    render(<Historial />)
    await screen.findByRole('table')

    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'ANA' } })
    expect(people()).toEqual(['Ana Torres', 'Ana Torres'])

    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'coincide' } })
    expect(people()).toEqual(['Ana Torres'])
    expect(screen.getByText('1 de 4 intentos')).toBeTruthy()
  })

  it('shows the model and the label of each attempt, "Sin evaluar" where there is none', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers.slice(-2)).toEqual(['Modelo', 'Etiqueta'])

    const [newest, second, third, oldest] = rows()
    expect(newest.slice(7)).toEqual([INSIGHT, 'Acierto'])
    expect(second.slice(7)).toEqual([SFACE, 'Falso positivo'])
    expect(third.slice(7)).toEqual([SFACE, 'Sin evaluar'])
    expect(oldest.slice(7)).toEqual([INSIGHT, 'Falso negativo'])
  })

  it('offers each model that appears, in order, and filters by it', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    const select = screen.getByLabelText('Modelo') as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Todos',
      INSIGHT,
      SFACE,
    ])

    fireEvent.change(select, { target: { value: SFACE } })
    expect(people()).toEqual(['Ana Torres', 'Sin candidato'])
    expect(screen.getByText('2 de 4 intentos')).toBeTruthy()

    fireEvent.change(select, { target: { value: INSIGHT } })
    expect(people()).toEqual(['Carlos', 'Ana Torres'])

    fireEvent.change(select, { target: { value: '' } })
    expect(rows()).toHaveLength(4)
  })

  it('filters by whether the evaluation was right, wrong or missing', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    const filter = screen.getByLabelText('Evaluación')

    fireEvent.change(filter, { target: { value: 'correcto' } })
    expect(people()).toEqual(['Carlos'])

    fireEvent.change(filter, { target: { value: 'error' } })
    expect(people()).toEqual(['Ana Torres', 'Ana Torres'])
    expect(screen.getByText('2 de 4 intentos')).toBeTruthy()

    fireEvent.change(filter, { target: { value: 'sin-evaluar' } })
    expect(people()).toEqual(['Sin candidato'])

    fireEvent.change(filter, { target: { value: 'todos' } })
    expect(rows()).toHaveLength(4)
  })

  it('combines the model, the evaluation and the result filters', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: SFACE } })
    fireEvent.change(screen.getByLabelText('Evaluación'), { target: { value: 'error' } })
    expect(people()).toEqual(['Ana Torres'])
    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'no-coincide' } })
    expect(screen.getByText('Ningún intento coincide con los filtros.')).toBeTruthy()
  })

  it('says so when no attempt matches the filters', async () => {
    render(<Historial />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'zzz' } })
    expect(screen.getByText('Ningún intento coincide con los filtros.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows a message and no filters when there are no attempts yet', async () => {
    vi.mocked(api.getHistory).mockResolvedValue({ success: true, resultado: [] })
    render(<Historial />)
    expect(await screen.findByText('Aún no hay intentos registrados.')).toBeTruthy()
    expect(screen.queryByLabelText('Resultado')).toBeNull()
  })

  it('shows the error with a retry button and no table', async () => {
    vi.mocked(api.getHistory).mockResolvedValue({
      success: false,
      error: 'Respuesta inesperada del servidor',
    })
    render(<Historial />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Respuesta inesperada del servidor')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
