import { describe, expect, it } from 'vitest'
import { canAccess, ROLE_LABEL, ROLE_OPTIONS } from './roles'

describe('roles', () => {
  it('names the three roles', () => {
    expect(ROLE_LABEL).toEqual({
      administrador: 'Administrador',
      operador: 'Operador',
      consulta: 'Consulta',
    })
    expect(ROLE_OPTIONS).toEqual(['administrador', 'operador', 'consulta'])
  })

  it.each([
    ['todos', 'administrador', true],
    ['todos', 'operador', true],
    ['todos', 'consulta', true],
    ['personal', 'administrador', true],
    ['personal', 'operador', true],
    ['personal', 'consulta', false],
    ['administrador', 'administrador', true],
    ['administrador', 'operador', false],
    ['administrador', 'consulta', false],
  ] as const)('a page for "%s" is open to %s: %s', (access, role, allowed) => {
    expect(canAccess(role, access)).toBe(allowed)
  })
})
