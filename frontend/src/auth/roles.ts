import type { Role } from '../types/auth'

export const ROLE_LABEL: Record<Role, string> = {
  administrador: 'Administrador',
  operador: 'Operador',
  consulta: 'Consulta',
}

export const ROLE_OPTIONS: Role[] = ['administrador', 'operador', 'consulta']

// Who may open a page. It mirrors what the API allows: the API is what enforces it, this only
// keeps people from walking into pages that would answer "no permission" to everything
export type Access = 'todos' | 'personal' | 'administrador'

const ALLOWED: Record<Access, readonly Role[]> = {
  todos: ['administrador', 'operador', 'consulta'],
  // Whoever registers and recognizes people
  personal: ['administrador', 'operador'],
  administrador: ['administrador'],
}

export function canAccess(role: Role, access: Access): boolean {
  return ALLOWED[access].includes(role)
}
