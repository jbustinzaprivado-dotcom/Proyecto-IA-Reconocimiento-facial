# Guía de despliegue

Cómo publicar el sistema como demostración: **frontend en Vercel**, **backend en un contenedor Docker** y
**base de datos en Supabase (PostgreSQL)**, con el código en **GitHub**.

> **Qué está verificado y qué no.** El código, las migraciones y toda la suite de pruebas del backend se
> comprobaron contra un **PostgreSQL 17 real** (PGlite) y contra SQLite; el frontend compila para producción.
> **No se pudo construir la imagen Docker ni desplegar en Render, Supabase o Vercel desde donde se desarrolló**
> (no hay Docker allí ni cuentas tuyas). Esos pasos los haces tú con esta guía; si algo falla, pásame el
> registro (log) y lo corregimos. Los pasos y nombres de botones de cada plataforma pueden haber cambiado:
> donde hay duda, se indica que lo verifiques en su documentación.
>
> **Render es un ejemplo, no un requisito.** El PDF de la actividad no nombra ningún hosting: solo pide
> PostgreSQL o Supabase, HTTPS, autenticación por roles y auditoría. Sirve cualquier servicio que ejecute un
> contenedor.

## 1. Cómo encaja todo

```
Navegador ──HTTPS──▶ Vercel (frontend estático)
    │
    └──────HTTPS──▶ Contenedor de la API (FastAPI + SFace) ──SSL──▶ Supabase (PostgreSQL)
```

- El frontend es un sitio estático. Habla con la API por **cabecera `Authorization`** (no usa cookies), así
  que funciona entre dos dominios; solo hay que permitir el dominio del frontend en `CORS_ORIGINS`.
- **La API no va en Vercel.** Necesita un proceso continuo: OpenCV, ONNX Runtime y scikit-learn pesan mucho
  para una función sin estado, el modelo facial se carga al arrancar, el modelo de probabilidad se guarda en
  disco y los límites de peticiones y el bloqueo por intentos viven en la memoria del proceso.
- La imagen usa **SFace** (licencia Apache 2.0). InsightFace queda para uso local: sus pesos son solo para
  investigación no comercial.

## 2. Qué necesitas

- Cuentas en **GitHub**, **Supabase**, **Render** (o el hosting de contenedores que elijas) y **Vercel**.
- Git en tu máquina y este repositorio.
- Un secreto para las sesiones de al menos 32 caracteres (se genera en el paso 5).

## 3. GitHub

1. En GitHub crea un repositorio **vacío** (sin README, sin `.gitignore`, sin licencia). Mientras el
   consentimiento sea provisional, ponlo **privado**.
2. En la carpeta del proyecto:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

Los `.env`, las bases de datos locales, los entornos virtuales y los pesos de los modelos están en
`.gitignore`: no se suben. Revisa igualmente en GitHub que no haya nada personal antes de hacerlo público.

## 4. Supabase (base de datos)

1. Crea un proyecto. Elige la región más cercana a la de tu API y guarda la **contraseña de la base de
   datos** (no se puede ver luego, solo restablecer).
2. Copia la cadena de conexión en *Project Settings → Database → Connection string* (verifica la ruta, la
   interfaz cambia). Hay tres formas:
   - **Directa** (`db.<ref>.supabase.co:5432`): en general solo IPv6.
   - **Session pooler** (`...pooler.supabase.com:5432`): admite IPv4. **Es la que conviene** para un servicio
     que se queda conectado.
   - **Transaction pooler** (puerto `6543`): pensada para funciones sin estado; no la uses aquí.
3. Conviértela a la forma que entiende SQLAlchemy y agrega SSL:

```
DATABASE_URL=postgresql+psycopg2://postgres.<ref>:<CONTRASEÑA>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

   Si la contraseña tiene caracteres especiales (`@`, `/`, `:`, `#`, `%`), codifícalos (`@` → `%40`, `/` → `%2F`).
4. **No hace falta crear tablas a mano**: la API aplica las migraciones al arrancar.
5. **Seguridad por filas (RLS).** Supabase publica por HTTP las tablas del esquema `public` que no la tienen
   activada, y la clave `anon` del proyecto no es secreta. La migración `bf41ea862b7e` la activa en todas las
   tablas **sin crear ninguna política**, así que esa vía no devuelve nada. La API se conecta con el rol
   `postgres`, dueño de las tablas, que no queda sujeto a RLS. Comprobación posterior en el editor SQL:

```sql
select relname, relrowsecurity from pg_class
where relname in ('personas','face_embeddings','recognition_logs','ml_training_records','usuarios','auditoria','alembic_version');
```

   Todas deben decir `true`. Como refuerzo, puedes desactivar la *Data API* del proyecto (*Project Settings → API*),
   porque esta aplicación no la usa. **Nunca pongas la clave `service_role` en ningún sitio del frontend.**

## 5. Backend en un contenedor (ejemplo: Render)

Se construye con `backend/Dockerfile`. La imagen baja los pesos de SFace al construirse, no corre como root y
aplica las migraciones antes de arrancar.

1. En Render: *New → Web Service → Build and deploy from a Git repository* → tu repositorio.
2. **Root Directory:** `backend`. **Runtime:** Docker. Render detecta el `Dockerfile`.
3. **Health Check Path:** `/api/health`.
4. **Variables de entorno:**

| Variable | Valor |
|---|---|
| `ENVIRONMENT` | `production` (ya es el valor de la imagen; ponlo igual) |
| `JWT_SECRET` | Un secreto de 32 caracteres o más: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. **Sin él la API no arranca en producción** |
| `DATABASE_URL` | La cadena del paso 4 |
| `CORS_ORIGINS` | La dirección exacta de tu frontend en Vercel, sin barra final, por ejemplo `https://aurora-biometrics.vercel.app`. Puedes poner varias separadas por comas |
| `FACE_ENGINE` | `sface` (ya es el valor de la imagen) |
| `TRUST_FORWARDED_FOR` | `false` al principio. Ver la nota de abajo |
| `ML_TRAINING_ENABLED` | `false`. Solo `true` cuando vayas a entrenar |

   El resto (`JWT_EXPIRE_MINUTES`, límites, `MAX_REQUEST_BYTES`) tiene valores por defecto razonables: ver
   `backend/.env.example`.

5. Despliega. Al terminar, abre `https://TU-API.onrender.com/api/health`: debe responder `success: true` con el
   motor `sface`. La primera petición tras un rato dormida tarda más (arranque y carga del modelo).

**Nota sobre las direcciones (`TRUST_FORWARDED_FOR`).** Detrás de un proxy todas las peticiones parecen venir
del proxy, y los límites por dirección (10 inicios de sesión y 120 peticiones por minuto) se **comparten entre
todos**. Con `true`, la API usa la última dirección de `X-Forwarded-For`, que solo es fiable si hay **un**
proxy tuyo delante. Cómo comprobarlo: entra con dos redes distintas y mira en *Auditoría* la columna
«Dirección». Si ves las direcciones reales, déjalo en `true`. Si ves siempre la misma (la del proxy),
déjalo en `false` y sube `LOGIN_RATE_PER_MINUTE` y `API_RATE_PER_MINUTE` si notas bloqueos.

**Límites del plan gratuito (según tu investigación previa en `PROCESO.md`; reverifícalos en Render):**
512 MB de RAM, CPU compartida y el servicio se duerme tras unos 15 minutos sin uso. Con SFace cabe, pero con
poco margen. El modelo de probabilidad entrenado se guarda en `/app/models/ml` y **se pierde en cada nuevo
despliegue** si no montas un disco persistente (los planes gratuitos no lo tienen). Para la demo basta con
volver a entrenarlo.

## 6. El primer administrador

Sin administrador nadie puede entrar. La API no lo crea sola. La forma más simple, que sirve en cualquier
hosting, es ejecutar el comando **desde tu máquina apuntando a la base de Supabase** (después de que la API
haya arrancado al menos una vez, porque las migraciones ya deben estar aplicadas):

```bash
cd backend
# Windows (PowerShell):  $env:DATABASE_URL="postgresql+psycopg2://..."
# Linux o macOS:         export DATABASE_URL="postgresql+psycopg2://..."
python -m app.scripts.create_admin
```

Te pide el correo, el nombre y la contraseña (dos veces, sin mostrarla; mínimo 10 caracteres). Sin teclado
(por ejemplo en la consola de un hosting): `ADMIN_EMAIL`, `ADMIN_NOMBRE` y `ADMIN_PASSWORD` con
`--desde-entorno`. Si olvidaste la contraseña: `python -m app.scripts.create_admin --restablecer CORREO`.
Cada uso queda en la auditoría. Después, las demás cuentas se crean desde la página **Usuarios**.

## 7. Frontend en Vercel

1. En Vercel: *Add New → Project* → importa el repositorio.
2. **Root Directory:** `frontend`. Vercel detecta Vite; `frontend/vercel.json` ya define el comando, la
   carpeta de salida, la reescritura de rutas (una sola página) y las cabeceras de seguridad.
3. **Environment Variables:** `VITE_API_URL` = la dirección de tu API, sin barra final (por ejemplo
   `https://TU-API.onrender.com`). Se usa **al compilar**: si la cambias, vuelve a desplegar. Sin ella,
   `npm run build` se detiene con un aviso claro. **No definas `VITE_USE_MOCKS`**: los datos simulados
   no existen en una compilación de producción.
4. Despliega. Copia la dirección que te da Vercel (`https://….vercel.app`), pégala en `CORS_ORIGINS` del
   backend (paso 5) y vuelve a desplegar el backend.
5. **Endurece la política de contenido.** En `frontend/vercel.json` la cabecera `Content-Security-Policy`
   trae `connect-src 'self' https:` porque la dirección de tu API no se conocía. Cámbiala por la tuya
   (`connect-src 'self' https://TU-API.onrender.com`), haz commit y vuelve a desplegar. Así, aunque
   alguien lograra ejecutar un script en la página, solo podría hablar con tu API.
6. La cámara del navegador exige HTTPS: Vercel lo da. La cabecera `Permissions-Policy` ya permite la cámara
   solo a tu propia página.

## 8. Comprobación después de desplegar

Hazla con las tres cuentas (crea un operador y un consulta desde Usuarios):

- [ ] `https://TU-API…/api/health` responde con el motor `sface`, y `/docs` da 404 (apagado en producción).
- [ ] La landing de Aurora Biometrics carga; **Ingresar** lleva al inicio de sesión.
- [ ] Un correo o contraseña incorrectos dan «Correo o contraseña incorrectos.»; tras 5 fallos, bloqueo temporal.
- [ ] **Administrador:** ve las nueve páginas; crea un usuario; cambia su rol; abre *Auditoría* y ve sus acciones.
- [ ] **Operador:** ve siete páginas; registra a una persona con 1 a 5 fotos y consentimiento; reconoce.
- [ ] **Consulta:** solo Dashboard, Probabilidades, Entrenamiento ML e Historial; en Probabilidades solo baja el
      CSV del análisis; abrir `/usuarios` muestra «Sin permiso».
- [ ] El reconocimiento del **modo evaluación** solo ofrece personas con rostros.
- [ ] Un administrador desactiva y elimina una persona; su historial queda sin nombre.
- [ ] Los CSV se descargan (necesitan la sesión).
- [ ] Al cambiar la contraseña, las demás sesiones se cierran.

## 9. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| «No se pudo conectar con el servidor» | `VITE_API_URL` mal escrita o sin redeploy tras cambiarla; o el dominio del frontend falta en `CORS_ORIGINS`; o la API está dormida (espera y reintenta) |
| El contenedor se reinicia y en el registro dice `JWT_SECRET debe tener al menos 32 caracteres` | Falta `JWT_SECRET` o es corto |
| `alembic` no conecta a la base | `DATABASE_URL` con la forma equivocada, contraseña sin codificar o falta `?sslmode=require`; en Supabase usa el *Session pooler* |
| `429` muy pronto al iniciar sesión | Los límites por dirección se comparten detrás del proxy: ver la nota de `TRUST_FORWARDED_FOR` |
| El reconocimiento dice que el motor no está disponible | Los pesos no se descargaron al construir: mira el registro de la construcción |
| Al registrar, el sistema rechaza una foto | Es la comprobación de calidad (sin cara, borrosa, oscura o muy pequeña): cambia la foto; la pantalla permite cambiarla y reintentar sin volver a registrar a la persona |
| La cámara no abre | Falta HTTPS, o el navegador bloqueó el permiso |

## 10. Probarlo en tu máquina con Docker

```bash
# En la raíz del proyecto. JWT_SECRET de 32 caracteres o más:
export JWT_SECRET="una-frase-larga-y-aleatoria-de-32-caracteres-o-mas"
docker compose up --build
docker compose exec api python -m app.scripts.create_admin
```

`docker-compose.yml` levanta la API y un PostgreSQL 16 propio (`http://localhost:8000`). El frontend se
ejecuta aparte: `npm run dev:api` dentro de `frontend/`.

## 11. Lo que hay que tener presente

- **Los límites viven en la memoria de un solo proceso**: con varias instancias cada una cuenta aparte.
- **Los servicios gratuitos duermen y pueden pausarse** (Supabase pausa los proyectos gratuitos tras una
  semana sin uso): la primera visita tras una pausa puede fallar o tardar.
- **El consentimiento es provisional** y hay obligaciones legales pendientes: ver `docs/PRIVACIDAD.md`.
- Cerrar sesión borra el token del navegador, pero no lo invalida en el servidor hasta que venza.
