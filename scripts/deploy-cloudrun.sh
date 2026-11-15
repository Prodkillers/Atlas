#!/usr/bin/env bash
# Despliega A.R.E.S. Twin (FastAPI + estáticos) en Google Cloud Run desde el código fuente.
#
# Idempotente: se puede ejecutar tantas veces como se quiera. Habilita APIs, crea o
# actualiza secretos en Secret Manager solo si se pasan sus valores, concede acceso
# a la cuenta de servicio de ejecución y vuelve a desplegar (nueva revisión).
#
# Requisitos: gcloud autenticado (`gcloud auth login`) y un proyecto con facturación.
#
# Uso:
#   PROJECT_ID=mi-proyecto ./scripts/deploy-cloudrun.sh
#
# Variables (todas opcionales salvo PROJECT_ID):
#   PROJECT_ID            Proyecto de GCP (obligatorio, o el configurado en gcloud).
#   REGION                Región de Cloud Run (por defecto us-central1).
#   SERVICE               Nombre del servicio (por defecto selene-ops).
#   ALLOWED_ORIGINS       Orígenes CORS separados por coma (p. ej. https://ares.midominio.com).
#   OPENAI_BASE_URL / OPENAI_MODEL / OPENAI_FALLBACK_MODEL   Configuración API/modelos.
#   OPENAI_API_KEY, METEOMATICS_USERNAME, METEOMATICS_PASSWORD
#                         Si se definen en el entorno al ejecutar el script, su valor se
#                         guarda como NUEVA VERSIÓN del secreto homónimo en Secret Manager
#                         (nombres en minúsculas con guiones: openai-api-key, …). Si no se
#                         definen pero el secreto ya existe, se reutiliza su versión latest.
#                         Nunca se pasan como variables de entorno en claro.
#   DRY_RUN=1             Solo imprime los comandos.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-selene-ops}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: define PROJECT_ID o ejecuta 'gcloud config set project <id>'." >&2
  exit 1
fi

run() {
  echo "+ $*"
  if [[ "${DRY_RUN:-0}" != "1" ]]; then "$@"; fi
}

echo "== Proyecto ${PROJECT_ID} · región ${REGION} · servicio ${SERVICE}"

# 1. APIs necesarias (idempotente).
run gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com --project "${PROJECT_ID}"

# 2. Cuenta de servicio de ejecución (por defecto: la de Compute Engine).
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

# 3. Secretos: ENV_VAR -> nombre-del-secreto.
declare -A SECRETS=(
  [OPENAI_API_KEY]=openai-api-key
  [METEOMATICS_USERNAME]=meteomatics-username
  [METEOMATICS_PASSWORD]=meteomatics-password
)
SECRET_BINDINGS=()
for var in "${!SECRETS[@]}"; do
  name="${SECRETS[$var]}"
  value="${!var:-}"
  exists=0
  gcloud secrets describe "${name}" --project "${PROJECT_ID}" >/dev/null 2>&1 && exists=1
  if [[ -n "${value}" ]]; then
    if [[ "${exists}" == "0" ]]; then
      run gcloud secrets create "${name}" --replication-policy=automatic --project "${PROJECT_ID}"
    fi
    echo "+ gcloud secrets versions add ${name} --data-file=- (valor oculto)"
    if [[ "${DRY_RUN:-0}" != "1" ]]; then
      printf '%s' "${value}" | gcloud secrets versions add "${name}" --data-file=- --project "${PROJECT_ID}" >/dev/null
    fi
    exists=1
  fi
  if [[ "${exists}" == "1" ]]; then
    run gcloud secrets add-iam-policy-binding "${name}" --project "${PROJECT_ID}" \
      --member="serviceAccount:${RUNTIME_SA}" --role="roles/secretmanager.secretAccessor" --condition=None >/dev/null
    SECRET_BINDINGS+=("${var}=${name}:latest")
  fi
done

# 4. Variables de entorno no secretas.
ENV_VARS="^@^SERVE_STATIC=1"
[[ -n "${ALLOWED_ORIGINS}" ]] && ENV_VARS+="@ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"
[[ -n "${OPENAI_BASE_URL:-}" ]] && ENV_VARS+="@OPENAI_BASE_URL=${OPENAI_BASE_URL}"
[[ -n "${OPENAI_MODEL:-}" ]] && ENV_VARS+="@OPENAI_MODEL=${OPENAI_MODEL}"
[[ -n "${OPENAI_FALLBACK_MODEL:-}" ]] && ENV_VARS+="@OPENAI_FALLBACK_MODEL=${OPENAI_FALLBACK_MODEL}"

DEPLOY_ARGS=(
  run deploy "${SERVICE}"
  --source "${REPO_ROOT}"
  --project "${PROJECT_ID}"
  --region "${REGION}"
  --service-account "${RUNTIME_SA}"
  --allow-unauthenticated
  --port 8080
  --cpu 1 --memory 1Gi
  --min-instances 0 --max-instances 1 --no-cpu-throttling
  --concurrency 80 --timeout 60
  --set-env-vars "${ENV_VARS}"
)
if (( ${#SECRET_BINDINGS[@]} )); then
  DEPLOY_ARGS+=(--set-secrets "$(IFS=,; echo "${SECRET_BINDINGS[*]}")")
else
  DEPLOY_ARGS+=(--clear-secrets)
fi

# 5. Despliegue (Cloud Build construye el Dockerfile de la raíz).
run gcloud "${DEPLOY_ARGS[@]}"

if [[ "${DRY_RUN:-0}" != "1" ]]; then
  URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
  echo "== Desplegado: ${URL}"
  curl -fsS "${URL}/api/health" && echo
fi
