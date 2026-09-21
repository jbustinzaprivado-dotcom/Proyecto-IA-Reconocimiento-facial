# Frontend: Sistema Inteligente de Reconocimiento Facial

Aplicación web en React, Vite, TypeScript y Tailwind CSS v4. Registra personas, captura o sube fotos del rostro, reconoce identidades y muestra similitud, umbral, confianza y probabilidad calibrada. El proceso, las decisiones y los informes por fase están en [`../docs/PROCESO.md`](../docs/PROCESO.md).

Probado con Node 24 y npm 11. Funciona con datos simulados (sin backend) o contra el backend real de [`../backend`](../backend/README.md).

## Comandos

```bash
npm install        # instala las dependencias
npm run dev        # servidor de desarrollo en http://localhost:5173, con datos simulados
npm run dev:api    # igual, pero contra el backend real en http://localhost:8000
npm run build      # comprueba los tipos y compila a dist/
npm run preview    # sirve dist/ para probar la compilación
npm run lint       # oxlint
```

## Variables de entorno

| Variable         | Qué hace                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `VITE_API_URL`   | Dirección del backend. Si falta, usa `http://localhost:8000` (provisional).                            |
| `VITE_USE_MOCKS` | Con el valor exacto `true` usa datos simulados. Cualquier otro valor, o si falta, llama a la API real. |

`.env.development` trae `VITE_USE_MOCKS=true`, así que `npm run dev` funciona sin backend. `.env.api` trae `VITE_USE_MOCKS=false` y lo usa `npm run dev:api` (modo `api` de Vite). Los datos simulados no se incluyen en la compilación de producción. `.env.example` documenta las dos variables.

Para usar el backend real, arráncalo primero (ver `../backend/README.md`) y luego `npm run dev:api`. Si Vite usa otro puerto distinto de 5173, agrégalo a `CORS_ORIGINS` del backend: si no, el navegador bloquea las peticiones y verás "No se pudo conectar con el servidor".

## Páginas

| Ruta              | Página           | Qué muestra                                                                                                                                                                                  |
| ----------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`               | Dashboard        | Totales, tasa de coincidencia e intentos por día                                                                                                                                             |
| `/registro`       | Registro facial  | Alta de la persona y sus fotos                                                                                                                                                               |
| `/reconocimiento` | Reconocimiento   | Reconoce una foto. Con el **Modo evaluación** se indica quién está delante y el intento queda marcado como acierto o error                                                                   |
| `/probabilidades` | Probabilidades   | Umbral y similitudes, **análisis del umbral** (métricas, simulador con curva e histograma, descarga de CSV), aviso de muestra pequeña y métricas del modelo de ML                            |
| `/entrenamiento`  | Entrenamiento ML | Cuántos intentos evaluados hay y cuántos faltan, botón para entrenar el modelo de probabilidad, comparación de los tres algoritmos, métricas y matriz del elegido, y el aviso «sin calibrar» |
| `/historial`      | Historial        | Intentos con modelo y etiqueta, y filtros por resultado, modelo, evaluación y persona                                                                                                        |

## Estructura de `src/`

- `pages/` las 5 páginas, cargadas bajo demanda desde `App.tsx`.
- `components/` `CameraCapture`, `FaceResultCard`, `SimilarityBar`, `ProbabilityChart`, `QueryState` y `StatCard`; y de la Fase 3 `EvaluationSelector`, `EtiquetaBadge`, `AnalysisPanel`, `MetricsPanel`, `ThresholdSimulator`, `ThresholdCurveChart`, `HistogramChart` y `DailyAttemptsChart`; y de la Fase 4 `ModelResults` y `AlgorithmComparison`.
- `services/` `api.ts` (cliente Axios), `mockData.ts` (datos simulados) `mockAnalysis.ts` (el análisis de los datos simulados, con las mismas reglas que la API) y `mockMl.ts` (el modelo de probabilidad simulado: pide los mismos mínimos para entrenar).
- `hooks/` `useApi.ts`. `utils/` `image.ts`, `format.ts`, `etiqueta.ts`, `analysis.ts` y `ml.ts`. `types/` `facial.ts`.

## Ten en cuenta

- **Cámara:** el navegador solo la permite en `localhost` o con HTTPS.
- **Direcciones:** se usan URL limpias (`/historial`). Al publicar, el hosting debe enviar toda ruta a `index.html`.
- **El simulador de umbral solo simula:** mueve el umbral sobre los intentos ya hechos y muestra qué habría pasado. El umbral que usa el sistema se cambia en `RECOGNITION_THRESHOLD`, en el `.env` del backend.
- **Las tasas de error dependen de las etiquetas:** solo cuentan los intentos hechos con el Modo evaluación, y valen lo que valga lo que se indicó. Con pocos intentos (menos de 30, o menos de 10 de personas registradas o de desconocidos) la página avisa de que es una muestra pequeña.
- **El modelo de probabilidad de `npm run dev` es de mentira:** sus números están inventados. Para entrenarlo hay que evaluar unos 24 intentos más en Reconocimiento (los mismos mínimos que el backend). Con `npm run dev:api` el entrenamiento solo funciona si el servidor tiene `ML_TRAINING_ENABLED=true`.
- **Datos simulados:** las etiquetas y el análisis de `npm run dev` son de ejemplo y no vienen del reconocimiento.
- **Los CSV** de `Probabilidades` se descargan directamente del backend, que hoy no tiene autenticación. El del historial lleva nombres de personas.
- **Consentimiento:** el texto de la página de registro es **provisional** (`v0-provisional`) y falta su revisión legal.
- **Navegadores:** se apunta a navegadores actuales (Chrome 111+, Safari 16.4+, Firefox 128+), por Tailwind v4.
