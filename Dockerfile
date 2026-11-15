# A.R.E.S. Twin — backend FastAPI + estáticos del repo, listo para Cloud Run.
# Build:  docker build -t ares-twin .
# Run:    docker run --rm -p 8080:8080 ares-twin   (http://localhost:8080)
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    SCOUT_DATA_DIR=/tmp/selene-scout

WORKDIR /app

COPY server/requirements.txt server/requirements-scout.txt server/
# Scout zone analyses need the geospatial stack (rasterio, numpy, pyproj, STAC clients, Pillow);
# the rasterio wheel bundles GDAL but links the system libexpat.
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install -r server/requirements-scout.txt

# El contexto lo filtra .dockerignore (sin .git, .venv*, credenciales, tests ni datos crudos).
COPY . .

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin ares \
    && chmod -R a+rX /app
USER 10001

EXPOSE 8080

# Cloud Run inyecta $PORT. --proxy-headers para que el rate-limit vea la IP real del cliente.
CMD ["sh", "-c", "exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
