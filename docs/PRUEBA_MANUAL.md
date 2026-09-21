# Prueba manual de la cámara real

Esta lista cubre lo único que las pruebas automáticas y el navegador integrado de Claude no pueden verificar: **la cámara real de tu equipo**. Tiene dos partes: la **Parte A** (unos 15 minutos) prueba la cámara y la interfaz con datos simulados y la **Parte B** (unos 10 minutos más) repite lo esencial contra el backend real.

## Antes de empezar (Parte A)

1. En una terminal, dentro de `frontend/`:
   ```bash
   npm install
   npm run dev
   ```
2. Abre <http://localhost:5173> en **Brave, Chrome o Edge**. La cámara solo funciona en `localhost` o con HTTPS.
3. Deja las herramientas de desarrollo (F12) abiertas en la pestaña **Consola**. Anota cualquier mensaje en rojo.

> **Importante:** con `npm run dev` la aplicación usa **datos simulados** (`.env.development` trae `VITE_USE_MOCKS=true`). Por eso el reconocimiento de la Parte A **no identifica tu rostro de verdad**: siempre alterna entre "Carlos, coincide" y "Sin candidato". Lo que se prueba aquí es la **cámara y la interfaz**, no la calidad del reconocimiento. El backend real se prueba en la Parte B.

## Datos de la prueba

| | |
|---|---|
| Fecha | |
| Quién probó | |
| Navegador y versión (menú, "Acerca de") | |
| Cámara (integrada o modelo de la externa) | |
| Sistema operativo | |

## Parte A: pasos (datos simulados)

Marca cada paso con ✅ o ❌ y escribe lo que viste si algo no coincide.

### A. Permiso y vista previa (página **Registro facial**)

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| A1 | Abre **Registro facial**. | Aparece "Solicitando acceso a la cámara…" y el navegador pide permiso. | |
| A2 | Pulsa **Permitir**. | Se ve tu imagen en vivo y "Capturar" se habilita. | |
| A3 | Levanta la mano derecha. | En la vista previa parece la **izquierda**, como en un espejo. | |
| A4 | Sostén una hoja con texto frente a la cámara. | En la vista previa el texto se ve **al revés**. | |

### B. Captura de fotos (misma página)

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| B1 | Pulsa **Capturar** 3 veces, cambiando un poco la posición. | El contador dice "3 de 5" y hay 3 miniaturas. | |
| B2 | Mira las miniaturas con la hoja de texto del paso A4. | **El texto se lee bien** (la foto guardada NO está en espejo). | |
| B3 | Pulsa la papelera de la miniatura 2. | El contador baja a "2 de 5" y quedan 2 miniaturas. | |
| B4 | Captura 3 fotos más hasta llegar a "5 de 5". | "Capturar" y "Subir imágenes" se deshabilitan. | |
| B5 | Quita una foto. | "Capturar" vuelve a habilitarse. | |

### C. Registro completo

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| C1 | Escribe nombre "Prueba Uno" y un correo válido. | Sin mensajes de error. | |
| C2 | Escribe una sola letra en el nombre y sal del campo. | Aparece "Escribe el nombre (mínimo 2 caracteres)." y el borde se pone rojo. | |
| C3 | Corrige el nombre. Mira el texto de consentimiento. | Es un texto **provisional** con partes marcadas entre corchetes. | |
| C4 | Marca la casilla de consentimiento y pulsa **Registrar**. | Aparece "Registro completado" con el nombre y la cantidad de imágenes. | |
| C5 | Pulsa **Registrar otra persona**. | El formulario queda vacío y la cámara vuelve a mostrar tu imagen. | |

### D. Reconocimiento (página **Reconocimiento**)

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| D1 | Abre **Reconocimiento** desde el menú. | La cámara arranca. | |
| D2 | Pulsa **Capturar**. | Aparece 1 miniatura y "Capturar" se deshabilita ("1 de 1"). | |
| D3 | Pulsa **Reconocer**. | Muestra "Reconociendo…" y luego una tarjeta con "Carlos" y "Coincide" (dato simulado). | |
| D4 | Pulsa **Nueva consulta**. | La tarjeta desaparece y la cámara vuelve a mostrar tu imagen. | |
| D5 | Captura otra vez y pulsa **Reconocer**. | Ahora la tarjeta dice "Sin candidato" y "No coincide" (dato simulado). | |

### E. Cuando la cámara falla

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| E1 | Haz clic en el candado de la barra de direcciones, pon **Cámara** en "Bloquear" y recarga. | Aparece "No se pudo acceder a la cámara. Puedes subir una imagen desde tu equipo." | |
| E2 | En ese estado, pulsa **Subir imagen** y elige una foto JPEG o PNG. | La foto se agrega como miniatura y se puede usar. | |
| E3 | Restablece el permiso de la cámara y recarga. | La cámara vuelve a funcionar. | |
| E4 | Abre otra aplicación que use la cámara (Zoom, Teams, la app Cámara de Windows) y recarga la página. | Aparece el mismo aviso de cámara no disponible, o el navegador informa que está en uso. | |
| E5 | Solo si tienes más de una cámara: mira si aparece un selector. | El selector lista tus cámaras y al cambiarla cambia la imagen. | |

### F. Móvil simulado

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| F1 | En F12, activa el modo dispositivo (ícono de celular) y elige un ancho de unos 375 px. | La barra lateral pasa a un botón de menú. La cámara y los botones siguen usables. | |
| F2 | Con el menú abierto, pulsa Escape. | El menú se cierra. | |

## Parte B: contra el backend real

Haz esto después de la Parte A. Usa la misma tabla de "Datos de la prueba".

> **Qué SÍ y qué NO se juzga aquí:** el backend usa un motor **real** (InsightFace por defecto), pero su umbral de similitud y sus límites de calidad son **provisionales**: todavía no se calibraron (se decidió dejarlo para más adelante, D112). Anota siempre la **similitud** que ves. Que no te reconozca, o que rechace una foto que a ti te parece buena, es justo la información que sirve para calibrar; no la cuentes como fallo tuyo. Las fotos deben tener **un solo rostro**, con buena luz y sin moverte.

### Preparación

1. Cierra el servidor de la Parte A (Ctrl+C en su terminal). En una terminal, dentro de `backend/`, la primera vez:
   ```bash
   python -m venv venv
   venv/Scripts/python.exe -m pip install -r requirements-dev.txt
   venv/Scripts/python.exe -m pip install --no-deps -r requirements-insightface.txt
   copy .env.example .env
   venv/Scripts/python.exe -m app.scripts.download_models
   ```
   `download_models` muestra lo que va a bajar (unos 327 MB) y pregunta antes de empezar.
2. Aplica las migraciones y arranca la API (deja esta terminal abierta):
   ```bash
   venv/Scripts/alembic.exe upgrade head
   venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
   ```
   Si quieres partir de cero, detén el servidor, borra `backend/dev.db` y repite este paso.
3. En otra terminal, dentro de `frontend/`: `npm run dev:api`. Abre <http://localhost:5173>.

### G. Registro y reconocimiento reales

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| G1 | Abre <http://localhost:8000/api/health>. | Ves `"estado":"ok"`, `"motor":"insightface"` y `"modelo":"insightface-buffalo_l"`. Si sale un error 503, dice qué falta (por ejemplo, los pesos). | |
| G2 | Abre el **Dashboard**. | Con la base vacía: 0 personas, 0 reconocimientos y 0 coincidencias. | |
| G3 | Ve a **Reconocimiento**, captura una foto y pulsa **Reconocer**. | Aparece en rojo: "Aún no hay rostros registrados. Registra a una persona primero." | |
| G4 | En **Registro facial** captura 2 o 3 fotos de frente y con buena luz, escribe un nombre y un correo, acepta el consentimiento y pulsa **Registrar**. | "Registro completado", con tu nombre y las imágenes guardadas. Si rechaza una foto, dice por qué ("Imagen 2: La imagen está borrosa...") y qué número de foto es. | |
| G5 | Registra a otra persona con **el mismo correo**, cambiando las mayúsculas (por ejemplo `ANA@x.com` y `ana@x.com`). | Aparece "Ya existe una persona registrada con ese correo." y no se crea nadie. | |
| G6 | En **Reconocimiento**, captura una foto de frente y pulsa **Reconocer**. | Tu nombre con "Coincide" y una similitud alta. Anota la similitud. Si sale "Sin candidato", anota la similitud. | |
| G7 | Pulsa **Nueva consulta**, tapa la cámara con la mano y reconoce otra vez. | Un rechazo con su motivo ("La imagen está muy oscura...", "No se detectó un rostro." u otro). Nunca un nombre. | |
| G7b | Pídele a otra persona que se ponga junto a ti y reconoce. | "Se detectaron 2 rostros. Envía una foto con una sola persona." | |
| G7c | Con una segunda persona **sin registrar** (con su permiso), captura solo su rostro y reconoce. | "Sin candidato" y "No coincide", con una similitud baja. Anota el valor. | |
| G8 | Abre **Historial**. | Tus intentos, del más nuevo al más viejo, con la hora de tu zona horaria, "Sin candidato" en los rechazos, el **modelo** de cada intento y "Sin evaluar" en la columna Etiqueta (todavía no usaste el modo evaluación). | |
| G9 | Vuelve al **Dashboard**. | Los totales coinciden con lo que hiciste (personas, intentos y coincidencias), la **tasa de coincidencia** es coincidencias entre reconocimientos, y el gráfico "Intentos por día" muestra tus intentos en el día de hoy (en tu zona horaria). | |
| G10 | Abre **Probabilidades**. | Indicadores de umbral y similitud, un gráfico con tus intentos, la sección **Análisis del umbral** y, abajo, "Aún no hay métricas del modelo: Modelo no entrenado." Sin intentos evaluados, el análisis dice que todavía no los hay y cómo conseguirlos. | |

### H. Modo evaluación y análisis del umbral

> **Cómo leer esta parte:** el modo evaluación marca cada intento como acierto o error **según lo que tú indiques**. Si indicas mal quién estaba delante, la etiqueta y las tasas salen mal: es tu palabra, no un dato medido. Con pocos intentos (menos de 30, o menos de 10 de personas registradas o de desconocidos) el análisis avisa de que es una **muestra pequeña**: sirve para ver que funciona, no para decidir un umbral.

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| H1 | En **Reconocimiento**, activa **Modo evaluación**. | Aparece la lista "¿Quién está frente a la cámara?" con las personas registradas y "Desconocido". Con "Elige una opción" el botón **Reconocer** no funciona y dice por qué. | |
| H2 | Elige **tu nombre**, captura una foto de frente y pulsa **Reconocer**. | La tarjeta añade "Evaluación: **Acierto**" (con el icono y el texto). Mientras reconoce no puedes cambiar el interruptor ni la persona. | |
| H3 | Pulsa **Nueva consulta**. | El modo sigue activado y tu nombre sigue elegido. | |
| H4 | Elige **Desconocido**, captura a una persona **sin registrar** (con su permiso) y reconoce. | "Rechazo correcto" si no la reconoce. Si la reconoce como alguien, sale "Falso positivo": anota la similitud. | |
| H5 | Elige el nombre de **otra persona registrada** (no el tuyo) y reconoce tu propia cara. | "Falso positivo" (te reconoció a ti, no a quien dijiste). Es una forma de ver un error a propósito. | |
| H6 | Elige una persona **sin rostros registrados** y reconoce. | Aparece en rojo "La persona esperada no tiene rostros registrados con este modelo." y no se guarda el intento. | |
| H7 | Cambia la persona elegida con un resultado en pantalla. | El resultado anterior desaparece, para que una etiqueta nunca quede junto a otra persona. | |
| H8 | Abre **Historial** y filtra **Evaluación** por "Errores", "Correctos" y "Sin evaluar"; después filtra por **Modelo**. | "Errores" muestra solo falsos positivos y negativos; "Sin evaluar" muestra lo hecho sin el modo. El contador dice cuántos de cuántos intentos. | |
| H9 | Abre **Probabilidades**, sección **Análisis del umbral**. | Aviso de **muestra pequeña** con tus intentos evaluados, métricas con el umbral en uso (precisión, recall, F1, tasas de error y matriz de confusión) y el histograma de similitudes. | |
| H10 | Mueve el deslizador **Umbral simulado**. | Cambian las coincidencias, los falsos positivos y los falsos negativos que habría con ese umbral. Sube el umbral: menos falsos positivos y más falsos negativos. **El umbral real no cambia:** en Reconocimiento la tarjeta sigue mostrando el mismo umbral. **Volver al umbral en uso** lo restablece. | |
| H11 | Pulsa **Descargar historial (CSV)** y **Descargar análisis (CSV)** y ábrelos en Excel. | El del historial empieza con el aviso de que lleva nombres, tiene las tildes bien y una fila por intento; el del análisis tiene 101 filas de umbrales y ningún nombre. No hay vectores en ninguno. | |
| H12 | Vuelve al **Dashboard** y pulsa **Actualizar**. | La tasa y el gráfico incluyen los intentos que acabas de hacer. | |

### I. Modelo de probabilidad (Entrenamiento ML)

> **Antes de empezar:** si tu API ya estaba encendida cuando se agregó esta parte, deténla (Ctrl+C), ejecuta `venv/Scripts/alembic.exe upgrade head` dentro de `backend/` (hay una migración nueva) y vuélvela a arrancar. Sin eso, la página Entrenamiento ML no puede leer sus datos.
>
> **Cómo leer esta parte:** el modelo aprende de los intentos que evaluaste en la sección H. Con pocos intentos (los mínimos son 50 evaluados, 15 en los que el candidato era la persona correcta, 15 en los que no lo era y 3 personas distintas), lo que sale es **orientativo**: sirve para ver que funciona, no para confiar en la probabilidad. Y **no elijas a propósito un nombre distinto al de quien tienes delante** para "provocar un error": el sistema habría identificado bien y aun así cuenta como ejemplo incorrecto, lo que confunde al modelo. Los ejemplos incorrectos buenos son los de personas sin registrar ("Desconocido").

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| I1 | Abre **Entrenamiento ML** en el menú. | Ves cuántos intentos evaluados hay (los de la sección H), cuántos son de cada tipo y de cuántas personas. Si no llegan a los mínimos, dice qué falta (por ejemplo, "Faltan 24 intentos evaluados (hay 26 de 50)"), aparece "Sin calibrar" y el botón **Entrenar modelo** está bloqueado. | |
| I2 | En **Reconocimiento** con el **Modo evaluación**, sigue evaluando hasta cumplir los mínimos: tú con tu nombre elegido (candidato correcto), personas sin registrar con "Desconocido" (candidato incorrecto) y, si hace falta, otras personas registradas con su propio nombre. Vuelve a Entrenamiento ML y pulsa **Actualizar**. | Los conteos suben y aparece "Hay datos suficientes para entrenar." | |
| I3 | Con el servidor aún sin habilitar el entrenamiento, mira la sección **Modelo**. | Dice "El entrenamiento está deshabilitado en el servidor..." y el botón sigue bloqueado aunque haya datos suficientes. | |
| I4 | Detén la API, pon `ML_TRAINING_ENABLED=true` en `backend/.env`, vuélvela a arrancar y recarga la página. | El botón **Entrenar modelo** se habilita y el aviso de "deshabilitado" desaparece. | |
| I5 | Pulsa **Entrenar modelo**. | Muestra "Entrenando…" unos segundos y luego "Modelo entrenado." con una sección **Resultados**: algoritmo elegido, log-loss, Brier, precisión, recall, F1, tasas de error, la matriz de confusión y la comparación de los tres algoritmos con **uno solo marcado "Elegido"**. Anota qué algoritmo salió y sus cifras. | |
| I6 | En **Reconocimiento**, reconoce tu cara y la de una persona sin registrar. | La tarjeta muestra ahora "Probabilidad calibrada" con un porcentaje (antes decía "Sin calibrar"). Tu cara debería tener una probabilidad claramente más alta que la de la persona sin registrar. **La decisión "Coincide" no cambió**: sigue dependiendo de la similitud y el umbral. Anota los dos porcentajes. | |
| I7 | Abre **Historial** y **Probabilidades**. | El Historial muestra el porcentaje en los intentos hechos después de entrenar y "Sin calibrar" en los anteriores. El bloque "Modelo de probabilidad" de Probabilidades dice el algoritmo elegido y con cuántos ejemplos se entrenó, y tiene un enlace a Entrenamiento ML. | |
| I8 | Vuelve a poner `ML_TRAINING_ENABLED=false` y reinicia la API. | Entrenamiento ML vuelve a decir "deshabilitado" y bloquea el botón, pero **el modelo ya entrenado sigue dando probabilidades**. | |

### Cierre (Parte B)

| # | Paso | Qué debe pasar | Resultado |
|---|---|---|---|
| G11 | Detén la API (Ctrl+C en su terminal) y pulsa **Actualizar** en el Dashboard. | Aparecen "No se pudo conectar con el servidor" con un botón **Reintentar**, una vez por cada bloque que no pudo cargar (los totales y el gráfico). | |

### Consola de la Parte B

¿Apareció algún mensaje en rojo? Es normal ver errores de red en el paso G11. Copia cualquier otro:

```
```

## Consola de la Parte A

¿Apareció algún mensaje en rojo en la consola durante la prueba? Cópialo aquí:

```
```

## Cómo entregar el resultado

Cuéntamelo en el chat (o pega esta tabla completada) y lo registro en `docs/PROCESO.md` como **"probado por el equipo"**, con la fecha y el navegador. Si algún paso falla, dime el número y lo que viste: es exactamente lo que este documento busca encontrar.

## Lo que esta prueba NO cubre

- **Celular real:** la cámara en un teléfono exige HTTPS, así que se probará con la demo publicada (Fase 5).
- **Firefox y Safari:** no forman parte de esta prueba.
- **Exactitud del reconocimiento:** con una o dos personas no se mide si reconoce bien; solo se ve el flujo y los valores de similitud. La calibración con más fotos quedó diferida (D112).
- **Calidad de la probabilidad:** con unas pocas decenas de intentos, la probabilidad calibrada es orientativa. Solo se puede confiar en ella con muchos intentos evaluados, de personas distintas y con etiquetas correctas, y solo vale para esta cámara, estas personas y estas condiciones.
- **Tasas de error fiables:** las del análisis necesitan muchos intentos evaluados, con personas y desconocidos distintos, y con etiquetas correctas. Con una prueba de unos pocos intentos solo se comprueba que las cuentas cuadran.
- **Fotos de fotos:** no hay detección de vida; una foto impresa o en un celular delante de la cámara se aceptaría (Fase 5).
- **Postgres o Supabase:** la Parte B usa SQLite. La base real de la demo se prueba en la Fase 5.
