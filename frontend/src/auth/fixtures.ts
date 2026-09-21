import type { Role, User } from '../types/auth'
import { ROLE_LABEL } from './roles'

// A user for a test or a story: the id, name and address follow from the role
export function makeUser(role: Role = 'administrador', extra: Partial<User> = {}): User {
  return {
    id: 1,
    email: `${role}@example.com`,
    nombre: ROLE_LABEL[role],
    rol: role,
    activo: true,
    created_at: '2026-09-01T09:00:00Z',
    last_login_at: null,
    ...extra,
  }
}
