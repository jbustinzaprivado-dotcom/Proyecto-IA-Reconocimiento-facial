export type Role = 'administrador' | 'operador' | 'consulta'

export interface User {
  id: number
  email: string
  nombre: string
  rol: Role
  activo: boolean
  created_at: string
  last_login_at: string | null
}

// What the API answers to a sign-in or to a change of password
export interface SessionData {
  token: string
  tipo: 'Bearer'
  // Seconds until the token stops being valid
  expira_en: number
  usuario: User
}

export interface UserCreate {
  email: string
  nombre: string
  rol: Role
  clave: string
}

// Only what is sent is changed. `clave` sets a new password for that user
export interface UserUpdate {
  nombre?: string
  rol?: Role
  activo?: boolean
  clave?: string
}

export interface AuditEntry {
  id: number
  created_at: string
  usuario_email: string | null
  accion: string
  recurso: string | null
  recurso_id: number | null
  resultado: string
  detalle: string | null
  ip: string | null
}

export interface AuditPage {
  registros: AuditEntry[]
  // Pass it as `antes_de_id` to get the next (older) page; null on the last one
  siguiente: number | null
}

export interface AuditQuery {
  usuario?: string
  accion?: string
  resultado?: string
  // A date and time with its zone
  desde?: string
  antes_de_id?: number
  limite?: number
}

export interface DeletedPerson {
  persona_id: number
}

export interface PurgeResult {
  eliminadas: number
}

// A file the API made, ready to be saved by the browser
export interface CsvFile {
  blob: Blob
  filename: string
}
