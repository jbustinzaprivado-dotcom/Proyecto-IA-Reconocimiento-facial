// The words for what the audit log records. An action this list does not know is shown as it came
const ACTION_LABELS: Record<string, string> = {
  login: 'Inicio de sesión',
  cambio_clave: 'Cambio de contraseña',
  usuario_crear: 'Usuario creado',
  usuario_actualizar: 'Usuario modificado',
  persona_crear: 'Persona registrada',
  rostros_registrar: 'Rostros guardados',
  persona_desactivar: 'Persona desactivada',
  persona_activar: 'Persona activada',
  persona_eliminar: 'Persona eliminada',
  personas_limpiar: 'Limpieza de personas sin rostros',
  reconocimiento: 'Reconocimiento',
  csv_historial: 'CSV del historial',
  csv_analisis: 'CSV del análisis',
  entrenar: 'Entrenamiento del modelo',
  denegado: 'Acceso denegado',
  admin_crear_comando: 'Administrador creado (comando)',
  clave_restablecida_comando: 'Contraseña restablecida (comando)',
}

const RESULT_LABELS: Record<string, string> = {
  ok: 'Correcto',
  fallo: 'Fallo',
  bloqueado: 'Bloqueado',
  denegado: 'Denegado',
}

export const AUDIT_ACTIONS: string[] = Object.keys(ACTION_LABELS)
export const AUDIT_RESULTS: string[] = Object.keys(RESULT_LABELS)

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function resultLabel(result: string): string {
  return RESULT_LABELS[result] ?? result
}
