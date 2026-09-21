import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Landing, { COMPANY } from './Landing'

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )

describe('Landing', () => {
  it('names the company in the only h1 of the page', () => {
    renderLanding()
    expect(COMPANY).toBe('Aurora Biometrics')
    const h1 = screen.getAllByRole('heading', { level: 1 })
    expect(h1).toHaveLength(1)
    expect(h1[0].textContent).toBe('Aurora Biometrics')
  })

  it('has the header, the main content and the footer as landmarks', () => {
    renderLanding()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('contentinfo')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Saltar al contenido' }).getAttribute('href')).toBe(
      '#contenido',
    )
    expect(screen.getByRole('main').id).toBe('contenido')
  })

  it('leads to the sign-in from the header, the start and the end', () => {
    renderLanding()
    const links = screen.getAllByRole('link', { name: 'Ingresar' })
    expect(links).toHaveLength(3)
    for (const link of links) expect(link.getAttribute('href')).toBe('/ingresar')
  })

  it('has the sections in order, each one with its heading and an address to reach it', () => {
    renderLanding()
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles).toEqual([
      'Qué hace',
      'Cómo funciona',
      'Privacidad y consentimiento',
      '¿Listo para probarlo?',
    ])
    const nav = screen.getByRole('navigation', { name: 'Secciones' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['#que-hace', '#como-funciona', '#privacidad'])
    for (const id of ['que-hace', 'como-funciona', 'privacidad']) {
      expect(document.getElementById(id)).toBeTruthy()
    }
    expect(screen.getByRole('link', { name: 'Ver cómo funciona' }).getAttribute('href')).toBe(
      '#como-funciona',
    )
  })

  it('describes six things the system does, each with its own title', () => {
    renderLanding()
    const section = document.getElementById('que-hace') as HTMLElement
    const titles = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(titles).toEqual([
      'Registro con consentimiento',
      'Reconocimiento con Deep Learning',
      'Probabilidad de acierto',
      'Análisis y reportes',
      'Roles y auditoría',
      'Datos bajo control',
    ])
  })

  it('explains the three steps as an ordered list', () => {
    renderLanding()
    const section = document.getElementById('como-funciona') as HTMLElement
    const steps = within(section).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(within(section).getByRole('list').tagName).toBe('OL')
    expect(steps.map((li) => li.querySelector('h3')?.textContent)).toEqual([
      'Registrar',
      'Reconocer',
      'Analizar',
    ])
  })

  it('says that the biometric data need care, and that the consent text is provisional', () => {
    renderLanding()
    const section = document.getElementById('privacidad') as HTMLElement
    expect(within(section).getByText(/datos biométricos/)).toBeTruthy()
    expect(within(section).getByText(/Ley N\.º 29733/)).toBeTruthy()
    expect(within(section).getByText(/es provisional y necesita revisión legal/)).toBeTruthy()
    expect(
      within(section).getByText(/no debe ser la única base para una decisión importante/),
    ).toBeTruthy()
  })

  it('says in the footer that the company is invented and no real data are processed', () => {
    renderLanding()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText(/empresa ficticia/)).toBeTruthy()
    expect(within(footer).getByText(/no procesa datos reales de terceros/)).toBeTruthy()
  })

  it('does not promise what the pages cannot show: no invented figures', () => {
    renderLanding()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\d+\s?%/)
    expect(text).not.toMatch(/100\s?%|garantiz|infalible|sin errores/i)
  })

  it('hides its decorative icons from assistive technology', () => {
    renderLanding()
    const icons = document.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(5)
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true')
  })
})
