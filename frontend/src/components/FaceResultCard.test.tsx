import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RecognitionResult } from '../types/facial'
import FaceResultCard from './FaceResultCard'

const match: RecognitionResult = {
  persona_id: 12,
  nombre: 'Carlos',
  similitud: 0.87,
  distancia: 0.26,
  umbral: 0.75,
  coincide: true,
  probabilidad_calibrada: 0.93,
  confianza: 'alta',
}

const rejection: RecognitionResult = {
  persona_id: null,
  nombre: null,
  similitud: 0.31,
  distancia: 1.38,
  umbral: 0.75,
  coincide: false,
  probabilidad_calibrada: null,
  confianza: 'baja',
}

describe('FaceResultCard', () => {
  it('shows a match with its identity, distance, confidence and probability as a percentage', () => {
    render(<FaceResultCard result={match} />)
    expect(screen.getByRole('heading', { name: 'Carlos' })).toBeTruthy()
    expect(screen.getByText('Coincide')).toBeTruthy()
    expect(screen.getByText('0.26')).toBeTruthy()
    expect(screen.getByText('Alta')).toBeTruthy()
    // Testing Library normalizes spaces when searching, so the exact non-breaking space is checked apart
    expect(screen.getByText('93 %').textContent).toBe('93\u00a0%')
  })

  it('titles the result with a level-2 heading, because the page already has its own h1', () => {
    render(<FaceResultCard result={match} />)
    expect(screen.getByRole('heading', { name: 'Carlos', level: 2 })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  })

  it('shows a rejection with no candidate and an uncalibrated probability', () => {
    render(<FaceResultCard result={rejection} />)
    expect(screen.getByRole('heading', { name: 'Sin candidato' })).toBeTruthy()
    expect(screen.getByText('No coincide')).toBeTruthy()
    expect(screen.getByText('Baja')).toBeTruthy()
    expect(screen.getByText('Sin calibrar')).toBeTruthy()
  })

  it('shows no evaluation where the attempt was not evaluated', () => {
    const { rerender } = render(<FaceResultCard result={match} />)
    expect(screen.queryByText(/Evaluación/)).toBeNull()
    rerender(<FaceResultCard result={{ ...match, etiqueta: null }} />)
    expect(screen.queryByText(/Evaluación/)).toBeNull()
  })

  it('shows how an evaluated attempt turned out, in words', () => {
    const { rerender } = render(<FaceResultCard result={{ ...match, etiqueta: 'acierto' }} />)
    expect(screen.getByText(/Evaluación/)).toBeTruthy()
    expect(screen.getByText('Acierto')).toBeTruthy()
    for (const [etiqueta, text] of [
      ['falso_positivo', 'Falso positivo'],
      ['falso_negativo', 'Falso negativo'],
      ['rechazo_correcto', 'Rechazo correcto'],
    ] as const) {
      rerender(<FaceResultCard result={{ ...rejection, etiqueta }} />)
      expect(screen.getByText(text)).toBeTruthy()
    }
  })

  it('shows the three confidence levels', () => {
    const { rerender } = render(<FaceResultCard result={{ ...match, confianza: 'media' }} />)
    expect(screen.getByText('Media')).toBeTruthy()
    rerender(<FaceResultCard result={{ ...match, confianza: 'alta' }} />)
    expect(screen.getByText('Alta')).toBeTruthy()
  })
})
