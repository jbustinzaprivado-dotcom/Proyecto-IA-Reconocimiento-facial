import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '../types/facial'

// Each test gets a fresh copy of the module, because the simulated data is mutable state
async function load() {
  vi.resetModules()
  return import('./mockData')
}

async function settled<T>(promise: Promise<ApiResponse<T>>): Promise<ApiResponse<T>> {
  await vi.advanceTimersByTimeAsync(600)
  return promise
}

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success) throw new Error(response.error)
  return response.resultado
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mockData', () => {
  it('lists the 5 simulated people, with Carlos as id 12 like the PDF example', async () => {
    const mock = await load()
    const people = unwrap(await settled(mock.listPersons()))
    expect(people).toHaveLength(5)
    expect(people.find((person) => person.nombre === 'Carlos')?.id).toBe(12)
    expect(people.every((person) => person.email.endsWith('@example.com'))).toBe(true)
  })

  it('answers only after the simulated delay', async () => {
    const mock = await load()
    let done = false
    void mock.listPersons().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(599)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it('returns copies, so changing a result does not alter the data', async () => {
    const mock = await load()
    const first = unwrap(await settled(mock.listPersons()))
    first[0].nombre = 'CHANGED'
    const second = unwrap(await settled(mock.listPersons()))
    expect(second[0].nombre).not.toBe('CHANGED')
  })

  it('creates a person with the next id and the accepted consent version', async () => {
    const mock = await load()
    const person = unwrap(
      await settled(
        mock.createPerson({
          nombre: 'Nueva',
          email: 'nueva@example.com',
          consentimiento_version: 'v1',
        }),
      ),
    )
    expect(person.id).toBe(15)
    expect(person.activo).toBe(true)
    expect(person.consentimiento_version).toBe('v1')
    expect(Number.isNaN(Date.parse(person.consentimiento_at))).toBe(false)
    expect(unwrap(await settled(mock.listPersons()))).toHaveLength(6)
  })

  it('confirms the uploaded count and rejects an unknown person', async () => {
    const mock = await load()
    expect(await settled(mock.uploadFaces(12, 2))).toEqual({
      success: true,
      resultado: { persona_id: 12, imagenes_guardadas: 2 },
    })
    expect(await settled(mock.uploadFaces(999, 1))).toEqual({
      success: false,
      error: 'Persona no encontrada',
    })
  })

  it('alternates a match and a rejection, and logs every attempt', async () => {
    const mock = await load()
    const first = unwrap(await settled(mock.recognize()))
    const second = unwrap(await settled(mock.recognize()))
    const third = unwrap(await settled(mock.recognize()))
    expect(first).toMatchObject({
      persona_id: 12,
      nombre: 'Carlos',
      coincide: true,
      confianza: 'alta',
    })
    expect(second).toMatchObject({
      persona_id: null,
      nombre: null,
      coincide: false,
      confianza: 'baja',
    })
    expect(third.coincide).toBe(true)

    const history = unwrap(await settled(mock.getHistory()))
    expect(history).toHaveLength(11)
    expect(history[0].id).toBe(11)
    const dates = history.map((item) => Date.parse(item.created_at))
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
  })

  it('says which model made every sample attempt, and labels a few of them', async () => {
    const mock = await load()
    const history = unwrap(await settled(mock.getHistory()))
    expect(history.every((item) => item.modelo === 'insightface-buffalo_l')).toBe(true)
    const labels = history.map((item) => item.etiqueta).filter((label) => label !== null)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(history.length)
    expect(new Set(labels)).toEqual(new Set(['acierto', 'rechazo_correcto', 'falso_negativo']))
  })

  it('does not label an attempt made without saying who is there', async () => {
    const mock = await load()
    const result = unwrap(await settled(mock.recognize()))
    expect(result.etiqueta).toBeNull()
    const history = unwrap(await settled(mock.getHistory()))
    expect(history[0].etiqueta).toBeNull()
    expect(history[0].modelo).toBe('insightface-buffalo_l')
  })

  describe('evaluation mode', () => {
    // The simulated attempts alternate: a match with Carlos (12), then a rejection
    async function attempt(mock: Awaited<ReturnType<typeof load>>, expected: string) {
      return unwrap(await settled(mock.recognize(expected)))
    }

    it('calls a match with the expected person a hit', async () => {
      const mock = await load()
      expect((await attempt(mock, '12')).etiqueta).toBe('acierto')
    })

    it('calls a match with somebody else, or with an unknown one, a false positive', async () => {
      const mock = await load()
      expect((await attempt(mock, '10')).etiqueta).toBe('falso_positivo')
      await attempt(mock, '10') // the rejection, to get to the next match
      expect((await attempt(mock, 'desconocido')).etiqueta).toBe('falso_positivo')
    })

    it('calls a rejection of an expected person a false negative, and of an unknown one a correct rejection', async () => {
      const mock = await load()
      await attempt(mock, '12') // the match
      expect((await attempt(mock, '12')).etiqueta).toBe('falso_negativo')
      await attempt(mock, '12') // the next match
      expect((await attempt(mock, 'desconocido')).etiqueta).toBe('rechazo_correcto')
    })

    it('ignores case and spaces in "desconocido", and an empty value means not evaluating', async () => {
      const mock = await load()
      await attempt(mock, '12')
      expect((await attempt(mock, '  DESCONOCIDO ')).etiqueta).toBe('rechazo_correcto')
      await attempt(mock, '12')
      expect((await attempt(mock, '')).etiqueta).toBeNull()
    })

    it('writes the label in the history too', async () => {
      const mock = await load()
      await attempt(mock, '12')
      const history = unwrap(await settled(mock.getHistory()))
      expect(history[0].etiqueta).toBe('acierto')
    })

    it('adds every evaluated attempt to the analysis, and only those', async () => {
      const mock = await load()
      const before = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      await attempt(mock, '12')
      await settled(mock.recognize())
      const after = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      expect(after.etiquetados).toBe(before.etiquetados + 1)
      expect(after.etiquetados_persona).toBe(before.etiquetados_persona + 1)
      expect(after.etiquetados_desconocido).toBe(before.etiquetados_desconocido)
      expect(after.total_intentos).toBe(before.total_intentos + 2)
    })

    it('counts a hit as a true positive and an unknown one as such, from what was said', async () => {
      const mock = await load()
      const before = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      await attempt(mock, '12') // match, expected Carlos: TP at the threshold
      await attempt(mock, 'desconocido') // rejection, expected unknown: TN
      const after = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      const [[tn0, fp0], [fn0, tp0]] = before.metricas_umbral!.matriz_confusion
      const [[tn1, fp1], [fn1, tp1]] = after.metricas_umbral!.matriz_confusion
      expect([tn1 - tn0, fp1 - fp0, fn1 - fn0, tp1 - tp0]).toEqual([1, 0, 0, 1])
    })

    it('counts a person taken for somebody else as a false positive in the analysis', async () => {
      const mock = await load()
      const before = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      await attempt(mock, '10') // match with Carlos while Ana was expected
      const after = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      expect(after.metricas_umbral!.matriz_confusion[0][1]).toBe(
        before.metricas_umbral!.matriz_confusion[0][1] + 1,
      )
    })
  })

  describe('analysis', () => {
    it('is about the model in use, with its threshold and 14 days', async () => {
      const mock = await load()
      const analysis = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      expect(analysis.modelo).toBe('insightface-buffalo_l')
      expect(analysis.umbral).toBe(0.75)
      expect(analysis.total_intentos).toBe(8)
      expect(analysis.total_coincidencias).toBe(4)
      expect(analysis.por_dia).toHaveLength(14)
      expect(analysis.curva).toHaveLength(101)
      expect(analysis.histograma).toHaveLength(20)
    })

    it('has a sample that is small, so the warning can be seen without a backend', async () => {
      const mock = await load()
      const analysis = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      expect(analysis.muestra_pequena).toBe(true)
      expect(analysis.etiquetados).toBeGreaterThan(0)
    })

    it('accepts the name of the model in use and refuses any other', async () => {
      const mock = await load()
      expect((await settled(mock.getAnalysis('insightface-buffalo_l', 0))).success).toBe(true)
      expect(await settled(mock.getAnalysis('otro-modelo', 0))).toEqual({
        success: false,
        error: 'No hay intentos de ese modelo.',
      })
    })

    it('moves the days with the offset of the viewer', async () => {
      const mock = await load()
      const utc = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      const ahead = unwrap(await settled(mock.getAnalysis(undefined, 14 * 60)))
      const utcCount = utc.por_dia.map((day) => day.coincidencias + day.rechazos)
      const aheadCount = ahead.por_dia.map((day) => day.coincidencias + day.rechazos)
      expect(utcCount.reduce((a, b) => a + b, 0)).toBe(8)
      expect(aheadCount.reduce((a, b) => a + b, 0)).toBe(8)
      expect(aheadCount).not.toEqual(utcCount)
    })

    it('returns a copy, so changing it does not alter the data', async () => {
      const mock = await load()
      const first = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      first.curva[0].coincidencias = -1
      const second = unwrap(await settled(mock.getAnalysis(undefined, 0)))
      expect(second.curva[0].coincidencias).not.toBe(-1)
    })
  })

  describe('downloadCsv', () => {
    // A Blob gives its text without the mark at the start, so the bytes are read
    async function read(
      mock: Awaited<ReturnType<typeof load>>,
      kind: 'historial' | 'analisis',
      model?: string,
    ) {
      const file = unwrap(await settled(mock.downloadCsv(kind, model)))
      const bytes = new Uint8Array(await file.blob.arrayBuffer())
      return { file, bytes, text: new TextDecoder().decode(bytes.slice(3)) }
    }

    it('hands over the history as a UTF-8 file that opens in Excel, with the warning first', async () => {
      const mock = await load()
      const { file, bytes, text } = await read(mock, 'historial')
      expect(file.filename).toBe('historial.csv')
      expect(file.blob.type).toBe('text/csv;charset=utf-8')
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
      expect(text.startsWith('AVISO')).toBe(true)
      expect(text.split('\r\n')).toHaveLength(8 + 3)
    })

    it('hands over the analysis, without names', async () => {
      const mock = await load()
      const { file, bytes, text } = await read(mock, 'analisis')
      expect(file.filename).toBe('analisis.csv')
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
      expect(text.startsWith('modelo,umbral')).toBe(true)
      expect(text).not.toContain('Carlos')
    })

    it('includes the attempts made since', async () => {
      const mock = await load()
      await settled(mock.recognize())
      expect((await read(mock, 'historial')).text.split('\r\n')).toHaveLength(9 + 3)
    })

    it('gives the history for a model it does not know, rather than nothing', async () => {
      const mock = await load()
      expect((await read(mock, 'analisis', 'otro-modelo')).text).toMatch(/^AVISO/)
    })

    it('is written to the audit log', async () => {
      const mock = await load()
      await settled(mock.downloadCsv('historial'))
      await settled(mock.downloadCsv('analisis', 'otro'))
      const page = unwrap(await settled(mock.getAudit({ limite: 2 })))
      expect(page.registros.map((row) => [row.accion, row.detalle])).toEqual([
        ['csv_analisis', 'modelo: otro'],
        ['csv_historial', 'modelo: en uso'],
      ])
    })
  })

  // The sample has 26 evaluated attempts (12 right, 14 wrong, 4 people): 24 more are enough
  async function evaluateEnough(mock: Awaited<ReturnType<typeof load>>) {
    for (let i = 0; i < 4; i += 1) await settled(mock.recognize('12'))
    for (let i = 0; i < 20; i += 1) await settled(mock.recognize('desconocido'))
  }

  describe('probability model', () => {
    it('says what is missing to train, with the same words as the API', async () => {
      const mock = await load()
      const status = unwrap(await settled(mock.getMlStatus()))
      expect(status).toMatchObject({
        modelo_facial: 'insightface-buffalo_l',
        entrenamiento_habilitado: true,
        ejemplos: 26,
        ejemplos_correctos: 12,
        ejemplos_incorrectos: 14,
        personas: 4,
        minimo_ejemplos: 50,
        minimo_por_tipo: 15,
        minimo_personas: 3,
        datos_suficientes: false,
        entrenado: false,
        entrenado_en: null,
        algoritmo: null,
      })
      expect(status.faltan).toEqual([
        'Faltan 24 intentos evaluados (hay 26 de 50).',
        'Faltan 3 intentos en los que el candidato era la persona correcta (hay 12 de 15).',
        'Falta 1 intento en el que el candidato no era la persona correcta (hay 14 de 15).',
      ])
    })

    it('refuses to train until there are enough evaluated attempts', async () => {
      const mock = await load()
      expect(await settled(mock.getModelMetrics())).toEqual({
        success: false,
        error: 'Modelo no entrenado',
      })
      expect(await settled(mock.trainModel())).toEqual({
        success: false,
        error:
          'No hay datos suficientes para entrenar. Faltan 24 intentos evaluados (hay 26 de 50). ' +
          'Faltan 3 intentos en los que el candidato era la persona correcta (hay 12 de 15). ' +
          'Falta 1 intento en el que el candidato no era la persona correcta (hay 14 de 15).',
      })
      expect((await settled(mock.getModelMetrics())).success).toBe(false)
    })

    it('counts the attempts made during the session as examples', async () => {
      const mock = await load()
      await settled(mock.recognize('12'))
      await settled(mock.recognize('desconocido'))
      await settled(mock.recognize())
      const status = unwrap(await settled(mock.getMlStatus()))
      expect(status.ejemplos).toBe(28)
      expect(status.ejemplos_correctos).toBe(13)
      expect(status.ejemplos_incorrectos).toBe(15)
    })

    it('counts a new person expected during the session', async () => {
      const mock = await load()
      await settled(mock.recognize('99'))
      expect(unwrap(await settled(mock.getMlStatus())).personas).toBe(5)
    })

    it('trains once there is enough, with the three algorithms compared and the last one kept', async () => {
      const mock = await load()
      await evaluateEnough(mock)
      expect(unwrap(await settled(mock.getMlStatus())).datos_suficientes).toBe(true)

      const metrics = unwrap(await settled(mock.trainModel()))
      expect(metrics).toMatchObject({
        n_muestras: 50,
        ejemplos_correctos: 16,
        ejemplos_incorrectos: 34,
        personas: 4,
        algoritmo: 'gradient_boosting',
        modelo_facial: 'insightface-buffalo_l',
      })
      const [[tn, fp], [fn, tp]] = metrics.matriz_confusion
      expect(tn + fp + fn + tp).toBe(50)
      expect(metrics.comparacion.map((c) => c.algoritmo)).toEqual([
        'regresion_logistica',
        'random_forest',
        'gradient_boosting',
      ])
      expect(metrics.comparacion.map((c) => c.elegido)).toEqual([false, false, true])
      expect(metrics.comparacion[2].log_loss).toBe(metrics.log_loss)
      expect(Number.isNaN(Date.parse(metrics.entrenado_en))).toBe(false)

      expect(unwrap(await settled(mock.getModelMetrics()))).toEqual(metrics)
      const status = unwrap(await settled(mock.getMlStatus()))
      expect(status).toMatchObject({ entrenado: true, algoritmo: 'gradient_boosting' })
      expect(status.entrenado_en).toBe(metrics.entrenado_en)
    })

    it('returns copies of the metrics, so changing them does not alter the model', async () => {
      const mock = await load()
      await evaluateEnough(mock)
      const first = unwrap(await settled(mock.trainModel()))
      first.matriz_confusion[0][0] = -1
      const second = unwrap(await settled(mock.getModelMetrics()))
      expect(second.matriz_confusion[0][0]).not.toBe(-1)
    })

    it('leaves the probability uncalibrated until training, then grows with the similarity', async () => {
      const mock = await load()
      const input = { similitud: 0.91, distancia: 0.18, calidad_imagen: 0.8, iluminacion: 0.9 }
      expect(unwrap(await settled(mock.predictProbability(input)))).toEqual({
        probabilidad_calibrada: null,
      })

      await evaluateEnough(mock)
      await settled(mock.trainModel())
      const high = unwrap(await settled(mock.predictProbability(input)))
      const low = unwrap(await settled(mock.predictProbability({ ...input, similitud: 0.5 })))
      expect(high.probabilidad_calibrada).toBeGreaterThan(0.8)
      expect(low.probabilidad_calibrada).toBeLessThan(0.1)
    })
  })

  it('computes the dashboard totals from the data', async () => {
    const mock = await load()
    expect(unwrap(await settled(mock.getDashboardSummary()))).toEqual({
      total_personas: 5,
      total_reconocimientos: 8,
      total_coincidencias: 4,
    })
    await settled(mock.recognize())
    expect(unwrap(await settled(mock.getDashboardSummary()))).toEqual({
      total_personas: 5,
      total_reconocimientos: 9,
      total_coincidencias: 5,
    })
  })
})

describe('mockData: people', () => {
  it('has the number of faces of each person, and Diego (inactive) with none', async () => {
    const mock = await load()
    const people = unwrap(await settled(mock.listPersons()))
    expect(people.map((person) => [person.nombre, person.rostros])).toEqual([
      ['Ana Torres', 5],
      ['Luis Ramírez', 3],
      ['Carlos', 4],
      ['Marta Quispe', 2],
      ['Diego Flores', 0],
    ])
  })

  it('registers a person with no faces, and saving faces sets how many there are', async () => {
    const mock = await load()
    const created = unwrap(
      await settled(
        mock.createPerson({
          nombre: 'Nora',
          email: 'nora@example.com',
          consentimiento_version: 'v1',
        }),
      ),
    )
    expect(created.rostros).toBe(0)
    await settled(mock.uploadFaces(created.id, 3))
    const found = unwrap(await settled(mock.listPersons())).find(
      (person) => person.id === created.id,
    )
    expect(found?.rostros).toBe(3)
    // Saving again replaces the faces, it does not add to them
    await settled(mock.uploadFaces(created.id, 1))
    const again = unwrap(await settled(mock.listPersons())).find(
      (person) => person.id === created.id,
    )
    expect(again?.rostros).toBe(1)
  })

  it('refuses faces for a person that does not exist', async () => {
    const mock = await load()
    expect((await settled(mock.uploadFaces(999, 1))).success).toBe(false)
  })

  it('deactivates and activates a person, and says when there is no such person', async () => {
    const mock = await load()
    const off = unwrap(await settled(mock.setPersonActive(10, false)))
    expect(off.activo).toBe(false)
    expect(unwrap(await settled(mock.setPersonActive(10, true))).activo).toBe(true)
    expect((await settled(mock.setPersonActive(999, true))).success).toBe(false)
  })

  it('deletes a person, and what they did stays in the history without their name', async () => {
    const mock = await load()
    const before = unwrap(await settled(mock.getHistory()))
    const ana = before.filter((item) => item.persona_id === 10)
    expect(ana.length).toBeGreaterThan(0)

    expect(unwrap(await settled(mock.deletePerson(10)))).toEqual({ persona_id: 10 })

    const people = unwrap(await settled(mock.listPersons()))
    expect(people.some((person) => person.id === 10)).toBe(false)
    const after = unwrap(await settled(mock.getHistory()))
    expect(after).toHaveLength(before.length)
    expect(after.filter((item) => item.persona_id === 10)).toEqual([])
    for (const item of after.filter((entry) => ana.some((old) => old.id === entry.id))) {
      expect(item.nombre).toBeNull()
    }
    expect(unwrap(await settled(mock.getDashboardSummary())).total_personas).toBe(4)
  })

  it('says when the person to delete does not exist', async () => {
    const mock = await load()
    expect((await settled(mock.deletePerson(999))).success).toBe(false)
  })

  it('cleans up only the people with no faces, and says how many', async () => {
    const mock = await load()
    expect(unwrap(await settled(mock.purgePersons()))).toEqual({ eliminadas: 1 })
    const names = unwrap(await settled(mock.listPersons())).map((person) => person.nombre)
    expect(names).not.toContain('Diego Flores')
    expect(names).toHaveLength(4)
    expect(unwrap(await settled(mock.purgePersons()))).toEqual({ eliminadas: 0 })
  })

  it('writes what was done to the audit log, without the name of the person', async () => {
    const mock = await load()
    await settled(mock.setPersonActive(10, false))
    await settled(mock.deletePerson(11))
    await settled(mock.purgePersons())
    const page = unwrap(await settled(mock.getAudit({ limite: 3 })))
    expect(page.registros.map((row) => [row.accion, row.recurso, row.recurso_id])).toEqual([
      ['personas_limpiar', 'persona', null],
      ['persona_eliminar', 'persona', 11],
      ['persona_desactivar', 'persona', 10],
    ])
    expect(JSON.stringify(page)).not.toContain('Ana Torres')
    expect(page.registros[0].detalle).toBe('1 personas sin rostros')
  })

  it('writes each recognition to the audit log with only whether it matched', async () => {
    const mock = await load()
    await settled(mock.recognize('12'))
    await settled(mock.recognize())
    const page = unwrap(await settled(mock.getAudit({ accion: 'reconocimiento', limite: 2 })))
    expect(page.registros.map((row) => row.detalle)).toEqual([
      'no coincide',
      'coincide; evaluación: acierto',
    ])
  })

  it('writes a refused training to the audit log as a failure', async () => {
    const mock = await load()
    const count = async () =>
      unwrap(await settled(mock.getAudit({ accion: 'entrenar' }))).registros.length
    const before = await count()
    await settled(mock.trainModel())
    expect(await count()).toBe(before + 1)
    const [newest] = unwrap(
      await settled(mock.getAudit({ accion: 'entrenar', limite: 1 })),
    ).registros
    expect([newest.resultado, newest.recurso]).toEqual(['fallo', 'modelo'])
    expect(newest.detalle).toContain('No hay datos suficientes para entrenar.')
  })
})
