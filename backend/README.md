# Backend: Sistema Inteligente de Reconocimiento Facial

API en Python con FastAPI. El proceso, las decisiones y los informes por fase están en [`../docs/PROCESO.md`](../docs/PROCESO.md).

> **Estado (Fase 5: seguridad y despliegue).** La API exige **inicio de sesión** (JWT, contraseñas con argon2id), tiene **tres roles** (administrador, operador y consulta), gestión de **usuarios**, **auditoría**, borrado de personas con anonimización y **límites** de peticiones, tamaño e intentos de inicio de sesión. Corre en un contenedor (`Dockerfile`) contra SQLite o PostgreSQL/Supabase; ver [`../docs/DESPLIEGUE.md`](../docs/DESPLIEGUE.md) y [`../docs/PRIVACIDAD.md`](../docs/PRIVACIDAD.md).
>
> **Fase 4 (sin calibrar ni entrenar con datos reales):** modelo de **probabilidad calibrada** (Regresión Logística, Random Forest y Gradient Boosting comparados) que se entrena con los intentos del modo evaluación. **Todavía no hay un modelo entrenado con datos reales**: se verificó con datos de prueba y hacen falta al menos 50 intentos evaluados. Antes, en la Fase 3: reconocimiento facial real con **InsightFace** (por defecto) y **SFace**, detección de un solo rostro, validación de calidad, **modo evaluación** (acierto o error de cada intento), **análisis del umbral** (curva, métricas y histograma) y **reportes CSV**. La calibración de los umbrales quedó **diferida** (D112): siguen provisionales. Las tasas de error del análisis solo valen lo que valgan las etiquetas y el tamaño de la muestra.
>
> **Advertencias**
>
> - **Los umbrales y los límites de calidad son provisionales.** Cada modelo tiene su propia escala de similitud y todavía no se calibraron con datos del equipo. No uses el resultado como única base para una decisión importante.
> - **Licencia de los modelos:** los pesos de InsightFace (`buffalo_l`) son **solo para investigación no comercial** [PDF §12]. SFace (Apache-2.0) y YuNet (MIT) no tienen esa restricción. El código de InsightFace es MIT.
> - **No detecta fotos de fotos:** una foto impresa o en un celular delante de la cámara se acepta. La detección de vida no está en el alcance de esta versión.
> - **En producción hay que poner `ENVIRONMENT=production` y un `JWT_SECRET` de al menos 32 caracteres**: sin él la API no arranca. Los límites de peticiones y el bloqueo por intentos viven en la memoria de **un** proceso.
> - **El texto de consentimiento es provisional** y falta la revisión legal (ver `../docs/PRIVACIDAD.md`).
> - Los embeddings son datos biométricos sensibles y nunca salen en una respuesta. Tampoco se guardan las fotos.

Probado con Python 3.13 en Windows.

## Puesta en marcha (Windows, PowerShell)

Desde la carpeta `backend/`:

```bash
python -m venv venv
venv/Scripts/python.exe -m pip install -r requirements-dev.txt
venv/Scripts/python.exe -m pip install --no-deps -r requirements-insightface.txt
copy .env.example .env
venv/Scripts/python.exe -m app.scripts.download_models
venv/Scripts/alembic.exe upgrade head
venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

- `requirements.txt` es lo de producción; `requirements-dev.txt` le suma `pytest`, `httpx` y `ruff`.
- `requirements-insightface.txt` es **opcional** y se instala con `--no-deps`: `insightface` 2.0 declara `opencv-python`, que chocaría con el `opencv-python-headless` que ya usamos, y todo lo demás está fijado en el archivo. `pip check` avisará de que falta `opencv-python`; es lo esperado. El motor SFace no necesita nada de esto.
- Los pesos de los modelos se bajan con `download_models`, que muestra cada archivo, su origen y su tamaño, y **pregunta antes de descargar**. La API nunca descarga nada por su cuenta.

| Motor | Descarga | Peso |
|---|---|---|
| InsightFace `buffalo_l` | `buffalo_l.zip` (github.com/deepinsight/insightface) | 288.6 MB |
| SFace | `face_recognition_sface_2021dec.onnx` y `face_detection_yunet_2023mar.onnx` (github.com/opencv/opencv_zoo) | 38.7 MB y 0.23 MB |

`python -m app.scripts.download_models --engine sface` baja solo SFace. Si tu antivirus inspecciona el HTTPS con un certificado que Python 3.13 rechaza (por ejemplo Avast Web/Mail Shield), el script reintenta sin la comprobación estricta X.509, sigue verificando la cadena de certificados y el nombre del servidor, y lo avisa.

Con el servidor en marcha:

- <http://localhost:8000/api/health> comprueba la API, la base de datos y el modelo cargado. Responde 503 con el motivo si el motor no pudo cargarse (por ejemplo, faltan los pesos).
- <http://localhost:8000/docs> es la documentación interactiva (OpenAPI).

El motor se carga **al arrancar**. Si no puede cargarse, la API arranca igual: el resto responde y solo registrar rostros o reconocer devuelven 503 "El motor facial no está disponible. ...".

## Motores

| `FACE_ENGINE` | Qué es | Vector | Umbral por defecto |
|---|---|---|---|
| `insightface` (por defecto) | ArcFace con el detector SCRFD, en CPU | 512 números | 0.40 (**valor de partida, sin medir**) |
| `sface` | SFace con el detector YuNet, de OpenCV | 128 números | 0.363 (el recomendado por OpenCV) |
| `simulated` | Solo para pruebas y demos sin pesos. **No reconoce personas** | 512 números | 0.75 |

- Cada vector se guarda con el nombre de su modelo (`insightface-buffalo_l`, `sface-2021dec`, `simulated`) y **solo se compara con vectores del mismo modelo**. Al cambiar de motor hay que volver a registrar los rostros.
- `RECOGNITION_THRESHOLD`, si se define, manda sobre el umbral del motor.
- Medido en esta laptop (Windows, CPU): SFace usa unos 223 MB de RAM y responde en unos 20 ms; InsightFace `buffalo_l` usa unos 500 MB (pico de 634 MB al cargar) y responde en unos 150 ms. En un hosting de 512 MB `buffalo_l` probablemente no cabe (no se probó allí).

## Un solo rostro y calidad

Antes de crear el vector se exige **un solo rostro** y que pase las comprobaciones de calidad. Todo rechazo es un 422 con su mensaje en español y no se guarda nada:

| Situación | Mensaje |
|---|---|
| Ningún rostro | "No se detectó un rostro." |
| Solo detecciones dudosas | "No se pudo confirmar que la imagen tenga un rostro. Prueba con otra foto." |
| Varios rostros | "Se detectaron N rostros. Envía una foto con una sola persona." |
| Rostro pequeño | "El rostro es muy pequeño. Acércate a la cámara." |
| Borrosa | "La imagen está borrosa. Mantén la cámara quieta y vuelve a intentarlo." |
| Oscura o quemada | "La imagen está muy oscura. Busca más luz." / "La imagen está muy iluminada. Evita la luz directa sobre el rostro." |

Solo cuentan como "otro rostro" las detecciones con confianza suficiente y tamaño mínimo. Al registrar, el mensaje empieza con la posición de la foto: "Imagen 2: ...".

## Acceso y roles

Todos los endpoints exigen `Authorization: Bearer <token>`, salvo `GET /api/health` y `POST /api/auth/login`. Un token vence (`JWT_EXPIRE_MINUTES`, 60 por defecto) y, en **cada** petición, la API vuelve a comprobar que el usuario existe, está activo, que su rol es el de la base de datos y que sus sesiones no fueron terminadas (cambiar la contraseña las termina). Sin token o con uno inválido: **401** (`WWW-Authenticate: Bearer`). Con un rol sin permiso: **403** «No tienes permiso para hacer esto.» (queda en la auditoría).

| Rol | Puede |
|---|---|
| `administrador` | Todo lo de los otros dos, más: entrenar el modelo, desactivar y eliminar personas, limpiar personas sin rostros, usuarios y auditoría |
| `operador` | Registrar personas y sus rostros, reconocer, ver la lista de personas y bajar el CSV del historial |
| `consulta` | Solo lectura: Dashboard, historial, análisis, métricas, predicción y el CSV del análisis |

Un correo que no existe, una contraseña equivocada y una cuenta desactivada dan **la misma** respuesta («Correo o contraseña incorrectos.»). Cinco fallos seguidos bloquean la cuenta 15 minutos (429), y cada dirección tiene su límite de inicios de sesión por minuto.

| Método | Endpoint | Rol | Notas |
|---|---|---|---|
| POST | `/api/auth/login` | público | `{email, clave}` → `{token, tipo, expira_en, usuario}` |
| GET | `/api/auth/yo` | todos | El usuario de la sesión, como lo ve el servidor ahora |
| POST | `/api/auth/cambiar-clave` | todos | `{clave_actual, clave_nueva}` (mínimo 10 caracteres). Termina las demás sesiones y devuelve una nueva |
| GET, POST | `/api/usuarios` | administrador | Lista y alta (`email`, `nombre`, `rol`, `clave`) |
| PATCH | `/api/usuarios/{id}` | administrador | `nombre`, `rol`, `activo` o `clave` (restablece: termina sus sesiones y levanta el bloqueo). No se puede quitar al último administrador activo ni desactivar la propia cuenta |
| GET | `/api/auditoria` | administrador | Solo lectura, del más nuevo al más viejo. Filtros `usuario`, `accion`, `resultado`, `desde`; página con `antes_de_id` y `limite` (hasta 200) |
| PATCH | `/api/personas/{id}` | administrador | `{activo}`: una persona desactivada deja de ser reconocida |
| DELETE | `/api/personas/{id}` | administrador | Borra la persona, sus vectores y su consentimiento. Sus intentos quedan **sin su nombre** |
| POST | `/api/personas/limpiar-sin-rostros` | administrador | Borra a quien nunca guardó un rostro con ningún modelo |

La auditoría registra inicios de sesión (correctos, fallidos y bloqueados), usuarios, cambios de contraseña, personas, rostros, reconocimientos, CSV, entrenamiento y permisos negados. **Nunca** guarda contraseñas, tokens, vectores, imágenes ni nombres de personas.

## Endpoints

Todas las respuestas usan `{ "success": true, "resultado": ... }` o `{ "success": false, "error": "texto en español" }`. El rol de cada uno está en la tabla de arriba; en esta: `personas` (crear, listar, rostros), `reconocimiento` y `reportes/historial.csv` son para administrador y operador; el resto de lecturas, para los tres roles; entrenar, solo para el administrador.

| Método | Endpoint | Notas |
|---|---|---|
| GET | `/api/health` | API, base de datos y modelo cargado (503 si algo falla) |
| POST | `/api/personas` | 201. Correo en minúsculas y único (409), salvo que esa persona **no tenga ningún rostro**: entonces se completa el mismo registro. Consentimiento `v0-provisional` |
| GET | `/api/personas` | Por nombre. Cada persona trae `rostros`: cuántos rostros del modelo en uso tiene guardados |
| POST | `/api/personas/{id}/rostro` | Campo `imagenes`, 1 a 5 JPEG o PNG de hasta 5 MB, un rostro en cada una. **Reemplaza** los rostros anteriores, todo o nada |
| POST | `/api/reconocimiento` | Campo `imagen`. Sin coincidencia no nombra a nadie. 409 si aún no hay rostros del modelo en uso. Campo opcional `esperado` (**modo evaluación**): `desconocido` o el id de una persona registrada, con rostros del modelo en uso. La respuesta trae entonces `etiqueta` (`acierto`, `falso_positivo`, `falso_negativo` o `rechazo_correcto`). 422 si `esperado` no es válido |
| GET | `/api/reconocimiento/historial` | Los 200 más recientes primero, con `modelo` y `etiqueta` (vacía si no hubo modo evaluación) |
| GET | `/api/analisis/resumen` | Estadísticas de **un modelo**: `modelo` (por defecto el que está en uso), `desfase_minutos` (el del navegador, para agrupar los días). Totales, intentos por día (14 días), histograma (20 rangos), curva de 101 umbrales y métricas con el umbral en uso. 404 si no hay intentos de ese modelo |
| GET | `/api/reportes/historial.csv` | Descarga, con `modelo` opcional. **Lleva los nombres de las personas** (primera línea de aviso), sin vectores |
| GET | `/api/reportes/analisis.csv` | Descarga de la curva de umbrales del modelo, sin nombres |
| GET | `/api/dashboard/resumen` | Totales de personas, reconocimientos y coincidencias |
| POST | `/api/probabilidades/prediccion` | Recibe `similitud`, `distancia` (no se usa), `calidad_imagen` e `iluminacion` (de 0 a 1). `probabilidad_calibrada: null` mientras no haya modelo entrenado |
| GET | `/api/modelos/estado` | Cuántos ejemplos hay, cuántos faltan para entrenar (mínimo 50, 15 de cada tipo y 3 personas) y si ya hay un modelo |
| GET | `/api/modelos/metricas` | Métricas del modelo elegido, comprobado con personas que no vio, y la comparación de los tres algoritmos. 404 mientras no haya modelo |
| POST | `/api/modelos/entrenar` | Entrena y guarda el mejor. **403** si `ML_TRAINING_ENABLED` está apagado (por defecto), 422 si faltan datos (dice qué falta), 409 si ya hay un entrenamiento y 503 sin motor facial |

Errores de imagen: 413 (pesa más de 5 MB o supera 25 megapíxeles), 415 (no es JPEG ni PNG, según sus bytes), 400 (no se puede leer) y 422 (faltan imágenes, hay demasiadas o el rostro no es utilizable). El listado completo de estados y decisiones está en [`../docs/PROCESO.md`](../docs/PROCESO.md) (D80 a D137).

## Comandos habituales

```bash
venv/Scripts/python.exe -m pytest                 # pruebas (las de modelos reales se saltan si faltan los pesos)
venv/Scripts/python.exe -m pytest -m "not real_models"   # sin cargar modelos
venv/Scripts/python.exe -m app.scripts.create_admin      # crea el primer administrador (o --restablecer CORREO)
venv/Scripts/ruff.exe check .                     # lint
venv/Scripts/ruff.exe format --check .            # formato
venv/Scripts/alembic.exe upgrade head             # aplicar migraciones
venv/Scripts/alembic.exe check                    # detecta modelos sin migración
venv/Scripts/alembic.exe revision --autogenerate -m "descripcion"
```

**Contra PostgreSQL de verdad:** con `TEST_DATABASE_URL=postgresql+psycopg2://...` en el entorno, `pytest` corre todos los tests contra ese servidor en vez de SQLite, con el esquema creado por las migraciones (usa una base vacía y desechable: la borra). Se probó con PGlite (PostgreSQL 17 en memoria, que solo admite **una** conexión); Alembic acepta una conexión ya abierta con `config.attributes["connection"]`.

Tras cambiar un modelo hay que crear su migración y **revisarla a mano** antes de aplicarla: Alembic no avisa, por ejemplo, de un valor por defecto que solo sirve en SQLite.

## Configuración (`.env`)

`.env` no se versiona. `.env.example` documenta todas las variables.

| Variable | Qué hace |
|---|---|
| `DATABASE_URL` | SQLite en desarrollo (`sqlite:///./dev.db`, siempre dentro de `backend/`). En la demo, Postgres o Supabase |
| `FACE_ENGINE` | `insightface` (por defecto), `sface` o `simulated` |
| `INSIGHTFACE_MODEL`, `MODELS_DIR` | Paquete de InsightFace (`buffalo_l`) y carpeta de los pesos (`models`, relativa a `backend/`) |
| `RECOGNITION_THRESHOLD` | Umbral de similitud de 0 a 1. Vacío: cada motor usa el suyo |
| `ML_TRAINING_ENABLED` | Permite entrenar el modelo de probabilidad (`false` por defecto; solo un administrador puede hacerlo). Enciéndelo solo para entrenar |
| `ENVIRONMENT` | `development` (por defecto) o `production`. En producción se exige `JWT_SECRET`, se apaga `/docs` y se añaden HSTS y CSP |
| `JWT_SECRET`, `JWT_EXPIRE_MINUTES` | Secreto de las sesiones (obligatorio en producción, 32 caracteres o más; en desarrollo, vacío = uno distinto en cada arranque) y su duración en minutos (1 a 1440, 60 por defecto) |
| `TRUST_FORWARDED_FOR` | Detrás de **un** proxy tuyo, usa la última dirección de `X-Forwarded-For` para los límites por dirección. `false` por defecto |
| `LOGIN_RATE_PER_MINUTE`, `API_RATE_PER_MINUTE`, `MAX_REQUEST_BYTES` | Inicios de sesión por minuto y dirección (10), peticiones por minuto y dirección (120) y tamaño máximo de una petición (26 MB) |
| `CONFIDENCE_MARGIN` | Margen sobre el umbral desde el que la confianza es "alta" (0 a 1, por defecto 0.10). Es una regla, no una probabilidad |
| `MIN_FACE_SIZE`, `MIN_DETECTION_SCORE`, `MIN_SHARPNESS`, `MIN_BRIGHTNESS`, `MAX_BRIGHTNESS` | Límites de calidad. Valores provisionales: 80 px, 0.5, 0.02 y brillo entre 40 y 220. La confianza mínima de detección no puede bajar de 0.3 |
| `CORS_ORIGINS` | Direcciones del frontend permitidas, separadas por comas. Si Vite usa otro puerto, agrégalo aquí: sin eso el navegador bloquea las peticiones y el frontend muestra "No se pudo conectar con el servidor" |
| `MAX_IMAGES_PER_PERSON`, `MAX_IMAGE_BYTES` | Límites de las imágenes del registro |

## Estructura

- `app/main.py` crea la aplicación y carga el motor al arrancar.
- `app/core/` configuración, reglas fijas (`constants.py`) y errores (`errors.py`). `app/database/` conexión y tipos. `app/models/` tablas.
- `app/schemas/` esquemas de entrada y salida. `app/api/routes/` rutas y `app/api/deps.py` dependencias.
- `app/services/` lógica: `face_engines/` (interfaz `FaceEngine`, InsightFace, SFace y el simulado), `face_service.py` (imágenes y un solo rostro), `quality_service.py`, `embedding_service.py`, `persona_service.py`, `recognition_service.py` (reconocer, etiquetar, historial y Dashboard), `analysis_service.py` (curva y métricas) `report_service.py` (CSV) y, de la Fase 4, `ml_scores.py` (calidad e iluminación de 0 a 1), `ml_dataset_service.py` (los ejemplos) y `ml_model_service.py` (entrenar, comprobar, guardar y predecir).
- Fase 5: `core/security.py` (argon2, JWT y reglas de contraseña), `core/middleware.py` y `core/rate_limit.py` (tamaño, límites y cabeceras), `core/network.py` (dirección del cliente), `api/deps.py` (sesión y roles), `services/auth_service.py`, `user_service.py` y `audit_service.py`, y `models/usuario_model.py` y `audit_model.py`.
- `app/scripts/download_models.py` descarga los pesos y `create_admin.py` crea o restablece un administrador.
- `Dockerfile` y `.dockerignore`: la imagen del backend (SFace). El `docker-compose.yml` de la raíz levanta la API con PostgreSQL.
- `alembic/` migraciones. `models/` pesos de los modelos (no se versionan). `tests/` pruebas.
