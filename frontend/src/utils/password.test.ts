import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX, PASSWORD_MIN, validatePassword } from './password'

describe('validatePassword', () => {
  it('has the limits of the server', () => {
    expect([PASSWORD_MIN, PASSWORD_MAX]).toEqual([10, 128])
  })

  it('accepts a long enough password of any kind, even one with spaces in it', () => {
    expect(validatePassword('una clave larga y buena')).toBeNull()
    expect(validatePassword('a'.repeat(PASSWORD_MIN))).toBeNull()
    expect(validatePassword('a'.repeat(PASSWORD_MAX))).toBeNull()
  })

  it('asks for at least 10 characters, saying so', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN - 1))).toBe(
      'La contraseña debe tener al menos 10 caracteres.',
    )
    expect(validatePassword('')).toBe('La contraseña debe tener al menos 10 caracteres.')
  })

  it('does not accept more than 128 characters', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MAX + 1))).toBe(
      'La contraseña no puede tener más de 128 caracteres.',
    )
  })

  it('does not accept only spaces, however many', () => {
    expect(validatePassword(' '.repeat(12))).toBe('La contraseña no puede ser solo espacios.')
  })

  it('does not accept the address, in any case, or the part before the @', () => {
    const email = 'AnaTorres2026@Example.com'
    expect(validatePassword('anatorres2026@example.com', email)).toBe(
      'La contraseña no puede ser igual al correo.',
    )
    expect(validatePassword('ANATORRES2026@EXAMPLE.COM', email)).toBe(
      'La contraseña no puede ser igual al correo.',
    )
    expect(validatePassword('  anatorres2026  ', email)).toBe(
      'La contraseña no puede ser igual al correo.',
    )
  })

  it('accepts something that only contains the address, or when no address is known', () => {
    expect(validatePassword('anatorres2026-otra', 'anatorres2026@example.com')).toBeNull()
    expect(validatePassword('anatorres2026', '')).toBeNull()
    expect(validatePassword('anatorres2026')).toBeNull()
  })

  it('checks the length before anything else', () => {
    expect(validatePassword('ana', 'ana@example.com')).toBe(
      'La contraseña debe tener al menos 10 caracteres.',
    )
  })
})
