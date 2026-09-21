# Imagen del backend (FastAPI). Se construye desde esta carpeta:
#   docker build -t aurora-api ./backend
#
# Lleva el motor SFace (pesos de OpenCV Zoo, licencia Apache 2.0), que cabe en un servicio pequeño.
# InsightFace no va en la imagen: sus pesos son solo para investigación no comercial.

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Librerías del sistema que piden OpenCV (libglib) y ONNX Runtime / OpenMP (libgomp)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# El servicio no corre como root
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app
WORKDIR /app

# Primero las dependencias, para que esta capa se reuse mientras requirements.txt no cambie
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# Los pesos de SFace y YuNet se bajan al construir, no al arrancar: la API nunca descarga nada sola.
# Si la descarga falla, la construcción falla con el motivo. La carpeta ml/ es donde se guarda el
# modelo de probabilidad que se entrena desde la página "Entrenamiento ML"
RUN mkdir -p /app/models/ml \
    && python -m app.scripts.download_models --engine sface --yes \
    && chown -R app:app /app/models

USER app

ENV ENVIRONMENT=production \
    FACE_ENGINE=sface \
    MODELS_DIR=/app/models \
    PORT=8000

EXPOSE 8000

# La API arranca aunque el motor no cargue (y lo dice): la comprobación mira que el servicio conteste
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'), timeout=4)"

# Las migraciones se aplican antes de arrancar (no hacen nada si la base ya está al día). Un solo
# proceso: los límites de peticiones y el bloqueo por intentos viven en su memoria
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
