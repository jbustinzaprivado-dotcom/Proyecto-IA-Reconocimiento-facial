# Sistema Inteligente de Reconocimiento Facial

Actividad Nro. 05. Aplicación web para registrar personas, capturar su rostro con la cámara, reconocerlas y consultar el historial, con una API en FastAPI y un frontend en React.

Este README dice cómo poner el proyecto en marcha y **qué es real y qué está simulado**. El proceso completo (decisiones, dudas y un informe por fase) está en [`docs/PROCESO.md`](docs/PROCESO.md).

## Estado

**Fases 1 (MVP), 2 (reconocimiento real), 3 (probabilidades y análisis) y 4 (Machine Learning) completas.** Frontend y backend funcionan juntos con reconocimiento facial real (InsightFace o SFace), modo evaluación y análisis del umbral. Los umbrales quedaron **sin calibrar** por decisión del equipo (D112): la Fase 3 da las herramientas para medirlos, no la medición. El modelo de probabilidad calibrada existe y se verificó con datos de prueba, pero **todavía no hay uno entrenado con datos reales** (hacen falta al menos 50 intentos evaluados). Falta la Fase 5.

> **Léelo antes de usarlo**
>
> - **Los umbrales y los límites de calidad son provisionales.** El reconocimiento usa modelos reales (InsightFace por defecto, SFace como alternativa), pero cada uno tiene su propia escala de similitud y todavía no se calibró con fotos del equipo. `FACE_ENGINE=simulated` sigue existiendo solo para pruebas: ese **no** reconoce personas.
> - **Licencia de los modelos:** los pesos de InsightFace son solo para investigación no comercial. SFace y YuNet (OpenCV) no tienen esa restricción.
> - **No detecta fotos de fotos:** una foto impresa o en un celular delante de la cámara se acepta (detección de vida: Fase 5).
> - **La API no tiene autenticación** (llega en la Fase 5). No la expongas a Internet tal como está.
> - **La probabilidad calibrada solo informa** y solo vale con un modelo entrenado con muchos intentos evaluados, de personas distintas y con etiquetas correctas. Entrenar viene **apagado** (`ML_TRAINING_ENABLED=false`).
> - **Las tasas de error del análisis valen lo que valgan las etiquetas.** El modo evaluación marca cada intento según lo que tú indiques, y con pocos intentos el análisis avisa de que es una muestra pequeña. Los CSV del historial llevan nombres de personas y la API no tiene autenticación.
> - **Los datos que se guardan son biométricos.** Solo se guardan los vectores (embeddings), no las fotos, y nunca salen en una respuesta.
> - **El texto de consentimiento es provisional** (`v0-provisional`) y no es asesoría legal. Debe revisarlo el equipo.
> - Nunca se probó contra un Postgres o Supabase reales, solo SQLite.

## Carpetas

| Carpeta | Contenido |
|---|---|
| [`frontend/`](frontend/README.md) | React 19, Vite, TypeScript y Tailwind CSS. 6 páginas: Dashboard, Registro, Reconocimiento (con modo evaluación), Historial, Probabilidades (análisis del umbral) y Entrenamiento ML |
| [`backend/`](backend/README.md) | FastAPI, SQLAlchemy, Alembic y scikit-learn. 13 endpoints más `health` |
| [`docs/`](docs/PROCESO.md) | `PROCESO.md` (registro vivo del proyecto) y `PRUEBA_MANUAL.md` (prueba de la cámara real) |

## Puesta en marcha

Necesitas Python 3.13 y Node 24. Desde la raíz del proyecto, en dos terminales (los comandos son para Windows).

**Terminal 1: backend**

```bash
cd backend
python -m venv venv
venv/Scripts/python.exe -m pip install -r requirements-dev.txt
venv/Scripts/python.exe -m pip install --no-deps -r requirements-insightface.txt
copy .env.example .env
venv/Scripts/python.exe -m app.scripts.download_models
venv/Scripts/alembic.exe upgrade head
venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

**Terminal 2: frontend**

```bash
cd frontend
npm install
npm run dev:api
```

Abre <http://localhost:5173>. La documentación interactiva de la API está en <http://localhost:8000/docs>.

`download_models` baja los pesos de los modelos (unos 327 MB en total), muestra cada archivo con su origen y tamaño y **pregunta antes de descargar**. Sin ellos la API arranca, pero registrar rostros y reconocer responden 503 con el motivo. Para probar sin descargar nada, pon `FACE_ENGINE=simulated` en `backend/.env`.

## Dos modos del frontend

| Comando | Datos | Cuándo usarlo |
|---|---|---|
| `npm run dev` | **Simulados** en el navegador, sin backend | Diseñar o probar la interfaz sin el servidor |
| `npm run dev:api` | Los del backend real | Probar el sistema completo |

Con el backend real, la base de datos parte **vacía**: el Dashboard muestra ceros y Reconocimiento avisa que aún no hay rostros registrados hasta que registres a alguien desde la página de Registro. Las fotos deben tener **un solo rostro**, con buena luz y nitidez; si no, se rechazan con un mensaje que dice por qué.

## Pruebas

```bash
cd backend && venv/Scripts/python.exe -m pytest      # 461 pruebas
cd backend && venv/Scripts/ruff.exe check .          # lint
cd frontend && npm test                              # 232 pruebas
cd frontend && npm run build                         # tipos y compilación
```

La cámara real de tu equipo no se puede probar de forma automática: sigue la lista de [`docs/PRUEBA_MANUAL.md`](docs/PRUEBA_MANUAL.md).

## Problemas frecuentes

- **El frontend dice "No se pudo conectar con el servidor":** el backend no está encendido, o Vite usa un puerto distinto de 5173 y el navegador bloquea las peticiones. Agrega ese puerto a `CORS_ORIGINS` en `backend/.env` y reinicia la API.
- **Un cambio en el código del backend no se nota:** el servidor no recarga solo. Deténlo (Ctrl+C) y vuelve a arrancarlo.
