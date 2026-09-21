export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

// The same rules as the server (which has the last word): a long password is enough, and it must
// not be the address or the part of it before the @
export function validatePassword(password: string, email = ''): string | null {
  if (password.length < PASSWORD_MIN) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`
  }
  if (password.length > PASSWORD_MAX) {
    return `La contraseña no puede tener más de ${PASSWORD_MAX} caracteres.`
  }
  if (password.trim() === '') return 'La contraseña no puede ser solo espacios.'
  const address = email.trim().toLowerCase()
  if (address !== '') {
    const typed = password.trim().toLowerCase()
    if (typed === address || typed === address.split('@')[0]) {
      return 'La contraseña no puede ser igual al correo.'
    }
  }
  return null
}
