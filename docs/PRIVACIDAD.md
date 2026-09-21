# Privacidad y protección de datos

> **Esto no es asesoría legal.** Describe lo que el sistema hace con los datos y qué falta resolver antes
> de usarlo con personas reales. Un abogado o el responsable de datos de tu organización debe revisar el
> texto de consentimiento, los plazos y las obligaciones ante la autoridad. Aurora Biometrics es una empresa
> ficticia y este sitio es una demostración académica (Actividad Nro. 05).

Fuente de los requisitos: el PDF de la actividad, sección 15 (consentimiento, controles de acceso, HTTPS,
autenticación por roles, auditoría, conservación y eliminación, falsos positivos y negativos, no decidir
solo por una coincidencia, Ley N.º 29733 de Protección de Datos Personales del Perú).

## 1. Qué datos guarda el sistema

| Dato | Dónde | Detalle |
|---|---|---|
| Nombre y correo de una persona | tabla `personas` | Los escribe quien la registra |
| Consentimiento | `personas.consentimiento_at` y `consentimiento_version` | La fecha la pone el servidor (UTC); la versión del texto que se aceptó |
| **Vector facial** (embedding) | `face_embeddings` | Números (`float32`) que representan el rostro, uno por foto y por modelo. **Es un dato biométrico** |
| **Imágenes** | **no se guardan** | La foto se procesa en memoria para sacar el vector y se descarta. Ningún archivo de imagen llega al disco ni a la base de datos |
| Intentos de reconocimiento | `recognition_logs` | Similitud, distancia, umbral, si coincidió, modelo, medidas de calidad de la cara (nitidez, brillo, tamaño), la etiqueta del modo evaluación y la persona candidata si hubo coincidencia |
| Ejemplos del modelo de probabilidad | `ml_training_records` | Números (similitud, calidad, iluminación, resultado real) y el número de la persona esperada. **Sin nombre ni correo** |
| Cuentas de usuario | `usuarios` | Correo, nombre, rol, y la contraseña **solo como hash argon2id**, nunca en claro |
| Auditoría | `auditoria` | Quién hizo qué y cuándo, con la dirección de red. **Nunca** contraseñas, tokens, vectores, imágenes ni nombres de personas registradas |

Lo que el sistema **no** hace: no guarda fotos, no busca rostros fuera de lo que se sube, no compara con
listas externas, no envía datos a terceros por su cuenta.

## 2. Quién puede ver qué

| Rol | Puede |
|---|---|
| Administrador | Todo: usuarios, auditoría, entrenar el modelo, desactivar y eliminar personas |
| Operador | Registrar personas, reconocer, ver la lista de personas y el historial |
| Consulta | Solo ver: dashboard, historial, análisis y métricas. No registra ni reconoce |

Los vectores faciales **nunca** salen por la API ni aparecen en pantalla. El historial muestra el nombre de
la persona reconocida; el CSV del historial (con nombres) solo lo baja quien registra o reconoce.

## 3. Consentimiento

- Se pide antes de guardar nada, con una casilla obligatoria en el registro.
- **El texto actual es provisional** (versión `v0-provisional`) y trae marcas de lo que falta: responsable del
  tratamiento, plazo de conservación y contacto. **No debe usarse con personas reales sin revisión legal.**
- La versión aceptada queda guardada con la persona. Cuando el texto cambie, hay que agregar la versión
  nueva a la lista que acepta el servidor y decidir qué se hace con quien aceptó la anterior.

## 4. Derechos de las personas y cómo se atienden hoy

| Derecho | Situación |
|---|---|
| Acceso | Un administrador o un operador ve a la persona en Personas y su historial. No hay una descarga de "todos mis datos" por persona |
| Rectificación | **No implementada**: no se puede editar el nombre ni el correo de una persona ya registrada. Hoy se elimina y se registra de nuevo |
| Cancelación (supresión) | **Sí**: un administrador elimina a la persona, sus vectores y su consentimiento. Sus intentos anteriores quedan en el historial **sin su nombre** (la referencia se anula) y sus ejemplos del modelo quedan sin grupo |
| Oposición | Un administrador puede **desactivar** a la persona: deja de ser reconocida sin borrar nada |

La eliminación y la limpieza de personas que nunca guardaron un rostro son **manuales** y quedan en la
auditoría. El sistema **no borra nada solo**: el plazo de conservación lo define el responsable (duda 92).

## 5. Medidas de seguridad que hay

- Sesiones firmadas (JWT) que vencen; la contraseña se guarda con argon2id; mínimo 10 caracteres.
- Bloqueo de la cuenta tras 5 fallos (15 minutos) y límites de peticiones y de tamaño.
- Cada petición vuelve a comprobar que el usuario existe, está activo y que su sesión no fue terminada.
- Cabeceras de seguridad; en producción, HSTS y una política de contenido, y la documentación de la API apagada.
- En PostgreSQL, seguridad por filas (RLS) activada en todas las tablas sin ninguna política, para que
  Supabase no las publique por su API HTTP (ver `docs/DESPLIEGUE.md`).
- Auditoría de accesos y operaciones.

## 6. Lo que falta o es una limitación (dilo con claridad si lo presentas)

1. **Consentimiento y avisos: provisionales.** Falta el responsable, el plazo, el contacto y la revisión legal.
2. **Registro del banco de datos personales.** La Ley N.º 29733 prevé obligaciones ante la autoridad
   (Autoridad Nacional de Protección de Datos Personales) por tratar datos personales, y los biométricos son
   sensibles. **Verifica con asesoría legal** qué corresponde y si hay que inscribirlo antes de usarlo.
3. **Transferencia internacional.** Si el backend, la base de datos y el frontend están en Render, Supabase
   y Vercel, los datos se procesan y guardan en servidores fuera del Perú. Hay que revisar sus regiones y
   sus condiciones, y decirlo en el aviso de privacidad.
4. **Sin detección de vida.** Una foto de una foto podría engañar al reconocimiento. No es una herramienta
   de seguridad para controlar accesos.
5. **Sin calibrar con datos reales.** Los umbrales por modelo son valores provisionales; los falsos positivos y
   negativos de verdad dependen de las personas y las condiciones. Los modelos faciales pueden funcionar peor
   con unos grupos que con otros: hay que medirlo antes de confiar en él.
6. **Licencias de los modelos.** Los pesos de InsightFace son solo para investigación no comercial. La demo
   publicada usa SFace (licencia Apache 2.0). Para un uso comercial con InsightFace hace falta licencia.
7. **La sesión del navegador puede leerse por un script de la misma página.** El token vive en
   `sessionStorage`; un ataque XSS podría leerlo. Se mitiga con la política de contenido, no se elimina.
   Cerrar sesión borra el token del navegador, pero **no lo invalida en el servidor**: sigue valiendo hasta que
   venza o se cambie la contraseña.
8. **La auditoría no es inmutable en la base de datos.** Nada de la API la modifica, pero quien tenga acceso
   directo a la base de datos podría hacerlo.
9. **Sin recuperación de contraseña por correo ni segundo factor.** Un administrador restablece contraseñas
   desde la página Usuarios, y hay un comando para restablecer la de un administrador.
10. **Un reconocimiento no debe ser la única base para una decisión importante.** Es una ayuda; lo dice la
    propia interfaz.
