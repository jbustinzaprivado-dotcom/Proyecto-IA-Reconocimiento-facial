import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MlAlgorithmResult } from '../types/facial'
import AlgorithmComparison from './AlgorithmComparison'

const result = (overrides: Partial<MlAlgorithmResult>): MlAlgorithmResult => ({
  algoritmo: 'regresion_logistica',
  nombre: 'Regresión Logística',
  log_loss: 0.341,
  brier: 0.104,
  precision: 0.85,
  recall: 0.8,
  f1: 0.82,
  tasa_falsos_positivos: 0.1,
  tasa_falsos_negativos: 0.2,
  elegido: false,
  ...overrides,
})

const results = [
  result({}),
  result({ algoritmo: 'random_forest', nombre: 'Random Forest', log_loss: 0.29, brier: 0.085 }),
  result({
    algoritmo: 'gradient_boosting',
    nombre: 'Gradient Boosting',
    log_loss: 0.27,
    brier: 0.08,
    precision: null,
    f1: null,
    tasa_falsos_positivos: 0,
    elegido: true,
  }),
]

function rows() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => ({
      name: within(row).getByRole('rowheader').textContent ?? '',
      cells: within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    }))
}

describe('AlgorithmComparison', () => {
  it('shows one row for each algorithm, in the order given', () => {
    render(<AlgorithmComparison results={results} />)
    expect(rows().map((row) => row.name.replace('Elegido', ''))).toEqual([
      'Regresión Logística',
      'Random Forest',
      'Gradient Boosting',
    ])
  })

  it('shows the log-loss and the Brier score as decimals and the rates as percentages', () => {
    render(<AlgorithmComparison results={results} />)
    expect(rows()[0].cells).toEqual(['0.34', '0.10', '85 %', '80 %', '82 %', '10 %', '20 %'])
  })

  it('shows a dash for a rate that could not be worked out, and 0 % for a real zero', () => {
    render(<AlgorithmComparison results={results} />)
    const kept = rows()[2].cells
    expect(kept[2]).toBe('—')
    expect(kept[4]).toBe('—')
    expect(kept[5]).toBe('0 %')
  })

  it('says in words which one was kept, and only that one', () => {
    render(<AlgorithmComparison results={results} />)
    expect(screen.getAllByText('Elegido')).toHaveLength(1)
    expect(rows()[2].name).toContain('Elegido')
    expect(rows()[0].name).not.toContain('Elegido')
  })

  it('names every column', () => {
    render(<AlgorithmComparison results={results} />)
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Algoritmo',
      'Log-loss',
      'Brier',
      'Precisión',
      'Recall',
      'F1',
      'Tasa de falsos positivos',
      'Tasa de falsos negativos',
    ])
  })

  it('makes the scrollable table reachable with the keyboard', () => {
    render(<AlgorithmComparison results={results} />)
    const region = screen.getByRole('region', { name: 'Comparación de los algoritmos' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(within(region).getByRole('table')).toBeTruthy()
  })
})
