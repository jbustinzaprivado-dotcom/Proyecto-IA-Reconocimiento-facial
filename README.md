# Aurora Biometrics: Sistema Inteligente de Reconocimiento Facial

Actividad Nro. 05. Aplicación web para registrar personas con su consentimiento, reconocerlas por su rostro con modelos de Deep Learning y analizar qué tan fiable es cada resultado con Machine Learning, con una API en FastAPI, un frontend en React, control de acceso por roles y auditoría.

> **Aurora Biometrics es una empresa ficticia** creada para una demostración académica. El sistema no debe usarse con personas reales hasta que el consentimiento (hoy provisional) tenga revisión legal: ver [`docs/PRIVACIDAD.md`](docs/PRIVACIDAD.md).

El proceso completo (decisiones, dudas y un informe por fase) está en [`docs/PROCESO.md`](docs/PROCESO.md).

## Estado

**Las cinco fases están completas, sin publicar.** Reconocimiento facial real (InsightFace o SFace), modo evaluación, análisis del umbral, modelo de probabilidad calibrada, inicio de sesión con tres roles, gestión de usuarios y personas, auditoría, una landing y todo lo necesario para desplegar: contenedor Docker, `vercel.json`, guía de despliegue y guía de privacidad. **Falta publicarlo**: eso lo haces tú con [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) (no había Docker ni cuentas de Render, Supabase o Vercel donde se desarrolló).

> **Léelo antes de usarlo**
>
> - **Los umbrales y los límites de calidad son provisionales.** Cada modelo tiene su propia escala de similitud y no se calibró con fotos del equipo. `FACE_ENGINE=simulated` existe solo para pruebas y **no** reconoce personas.
> - **Licencia de los modelos:** los pesos de InsightFace son solo para investigación no comercial. La demo publicada usa SFace y YuNet (OpenCV, sin esa restricción).
> - **No detecta fotos de fotos:** una foto impresa o en un celular delante de la cámara se acepta.
> - **La probabilidad calibrada solo informa** y solo vale con un modelo entrenado con muchos intentos evaluados. **Todavía no hay uno entrenado con datos reales.** Entrenar viene apagado (`ML_TRAINING_ENABLED=false`) y solo lo hace un administrador.
> - **Los datos que se guardan son biométricos.** Solo se guardan los vectores (embeddings), no las fotos, y nunca salen en una respuesta.
> - **El texto de consentimiento es provisional** (`v0-provisional`) y no es asesoría legal.
> - **Cerrar sesión no invalida el token en el servidor** hasta que venza (60 minutos) o se cambie la contraseña.
> - **Los límites de peticiones y el bloqueo por intentos viven en la memoria de un proceso.**
> - **Probado contra un PostgreSQL 17 real** (PGlite) pero **no** contra Supabase, y sin publicar. Ver la sección de despliegue.

## Carpetas

| Carpeta | Contenido |
|---|---|
| [`frontend/`](frontend/README.md) | React 19, Vite, TypeScript y Tailwind CSS. Landing, inicio de sesión y 10 páginas según el rol: Dashboard, Registro, Reconocimiento (con modo evaluación), Personas, Probabilidades (análisis del umbral), Entrenamiento ML, Historial, Usuarios, Auditoría y Mi cuenta. Se publica en Vercel (`vercel.json`) |
| [`backend/`](backend/README.md) | FastAPI, SQLAlchemy, Alembic y scikit-learn. Inicio de sesión (JWT, argon2id), 3 roles, usuarios, auditoría, límites y el reconocimiento. `Dockerfile` para el contenedor |
| [`docs/`](docs/PROCESO.md) | `PROCESO.md` (registro vivo), `DESPLIEGUE.md` (Vercel, contenedor, Supabase y GitHub), `PRIVACIDAD.md` y `PRUEBA_MANUAL.md` (cámara real, roles y sitio publicado) |
| `docker-compose.yml` | La API con un PostgreSQL 16, para probar en tu máquina lo mismo que se publica |

## Roles

| Rol | Puede |
|---|---|
| Administrador | Todo: usuarios, auditoría, entrenar el modelo, desactivar y eliminar personas |
| Operador | Registrar personas, reconocer, ver la lista de personas y el CSV del historial |
| Consulta | Solo leer: Dashboard, historial, análisis y métricas |

## Puesta en marcha (local)

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
venv/Scripts/python.exe -m app.scripts.create_admin
venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

`create_admin` pide el correo, el nombre y la contraseña (mínimo 10 caracteres) de tu primer administrador: sin él nadie puede entrar. `download_models` baja los pesos (unos 327 MB en total), muestra cada archivo con su origen y tamaño y **pregunta antes de descargar**. Para probar sin descargar nada, pon `FACE_ENGINE=simulated` en `backend/.env`.

**Terminal 2: frontend**

```bash
cd frontend
npm install
npm run dev:api
```

Abre <http://localhost:5173>: verás la landing; pulsa **Ingresar** e inicia sesión. La documentación interactiva de la API está en <http://localhost:8000/docs> (solo fuera de producción).

**Con Docker** (API y PostgreSQL): ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md), sección 10.

## Dos modos del frontend

| Comando | Datos | Cuándo usarlo |
|---|---|---|
| `npm run dev` | **Simulados** en el navegador, sin backend, con tres cuentas de demostración (administrador, operador y consulta; contraseña `demo-clave-123`) | Diseñar o probar la interfaz sin el servidor. **Solo existen en desarrollo**: una compilación de producción no los incluye |
| `npm run dev:api` | Los del backend real | Probar el sistema completo |

Con el backend real, la base de datos parte **vacía**. Las fotos deben tener **un solo rostro**, con buena luz y nitidez; si no, se rechazan con un mensaje que dice por qué y se pueden cambiar sin volver a registrar a la persona.

## Publicar

Frontend en **Vercel**, backend en un **contenedor Docker** (Render es solo un ejemplo: el PDF no nombra ningún hosting) y base de datos en **Supabase**. El paso a paso, las variables, la comprobación posterior y los problemas frecuentes están en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

Subir el código a GitHub: crea un repositorio **vacío** y, en esta carpeta:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

## Pruebas

```bash
cd backend && venv/Scripts/python.exe -m pytest      # 969 pruebas
cd backend && venv/Scripts/ruff.exe check .          # lint
cd frontend && npm test                              # 655 pruebas
cd frontend && npm run build                         # tipos y compilación (exige VITE_API_URL)
```

Las pruebas del backend también corren contra un PostgreSQL real con `TEST_DATABASE_URL` (ver `backend/README.md`). La cámara real y el sitio publicado no se pueden probar de forma automática: sigue la lista de [`docs/PRUEBA_MANUAL.md`](docs/PRUEBA_MANUAL.md).

## Problemas frecuentes

- **El frontend dice "No se pudo conectar con el servidor":** el backend no está encendido, o Vite usa un puerto distinto de 5173 y el navegador bloquea las peticiones. Agrega ese puerto a `CORS_ORIGINS` en `backend/.env` y reinicia la API.
- **Un cambio en el código del backend no se nota:** el servidor no recarga solo. Deténlo (Ctrl+C) y vuelve a arrancarlo.
- **Después de actualizar el código, el login falla o faltan tablas:** corre `alembic upgrade head` y crea tu administrador con `create_admin`.
- **`npm run build` dice que falta `VITE_API_URL`:** es intencional: defínela (por ejemplo `VITE_API_URL=http://localhost:8000`).
