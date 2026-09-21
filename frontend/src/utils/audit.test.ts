import { describe, expect, it } from 'vitest'
import { actionLabel, AUDIT_ACTIONS, AUDIT_RESULTS, resultLabel } from './audit'

describe('audit words', () => {
  it('says every action the server records, in words', () => {
    // The names the server writes (backend/app): if one is added there, it is added here too
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        'login',
        'cambio_clave',
        'usuario_crear',
        'usuario_actualizar',
        'persona_crear',
        'rostros_registrar',
        'persona_desactivar',
        'persona_activar',
        'persona_eliminar',
        'personas_limpiar',
        'reconocimiento',
        'csv_historial',
        'csv_analisis',
        'entrenar',
        'denegado',
        'admin_crear_comando',
        'clave_restablecida_comando',
      ].sort(),
    )
    for (const action of AUDIT_ACTIONS) expect(actionLabel(action)).not.toBe(action)
  })

  it('has different words for every action', () => {
    const labels = AUDIT_ACTIONS.map(actionLabel)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('says the four results in words', () => {
    expect(AUDIT_RESULTS).toEqual(['ok', 'fallo', 'bloqueado', 'denegado'])
    expect(AUDIT_RESULTS.map(resultLabel)).toEqual(['Correcto', 'Fallo', 'Bloqueado', 'Denegado'])
  })

  it('shows what it does not know as it came', () => {
    expect(actionLabel('algo_nuevo')).toBe('algo_nuevo')
    expect(resultLabel('raro')).toBe('raro')
  })
})
