import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SimilarityBar from './SimilarityBar'

describe('SimilarityBar', () => {
  it('shows the similarity and the threshold as two-decimal numbers', () => {
    render(<SimilarityBar similarity={0.87} threshold={0.75} />)
    expect(screen.getByText('0.87')).toBeTruthy()
    expect(screen.getByText('Umbral 0.75')).toBeTruthy()
    const meter = screen.getByRole('meter', { name: 'Similitud' })
    expect(meter.getAttribute('aria-valuenow')).toBe('0.87')
    expect(meter.getAttribute('aria-valuetext')).toBe('Similitud 0.87, umbral 0.75')
  })

  it('clamps the bar to the 0 to 1 range but still shows the real number', () => {
    const { container, rerender } = render(<SimilarityBar similarity={1.4} threshold={0.75} />)
    expect(screen.getByText('1.40')).toBeTruthy()
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('1')
    expect((container.querySelector('.bg-brand') as HTMLElement).style.width).toBe('100%')

    rerender(<SimilarityBar similarity={-0.2} threshold={0.75} />)
    expect(screen.getByText('-0.20')).toBeTruthy()
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0')
    expect((container.querySelector('.bg-brand') as HTMLElement).style.width).toBe('0%')
  })

  it('places the threshold marker at its position', () => {
    const { container } = render(<SimilarityBar similarity={0.5} threshold={0.75} />)
    expect((container.querySelector('.bg-ink') as HTMLElement).style.left).toBe('75%')
  })
})
