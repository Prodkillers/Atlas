"""A.R.E.S. Twin backend (contract docs/contracts.md §3).

Local start (from the repo root):
    .venv-server/bin/uvicorn server.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import copilot, dossier, zones
from .forecast import ForecastService
from .telemetry import TelemetryService, weather_provider_name

VERSION = "2.0.0"
REPO_ROOT = Path(os.environ.get("STATIC_ROOT", Path(__file__).resolve().parent.parent)).resolve()
SNAPSHOT_PATH = REPO_ROOT / "assets" / "data" / "telemetry-snapshot.json"
FORECAST_SNAPSHOT_PATH = REPO_ROOT / "assets" / "data" / "processes-forecast-snapshot.json"

MAX_QUESTION_CHARS = 600
SITE_PATTERN = r"^[a-z0-9][a-z0-9-]{0,47}$"

telemetry_service = TelemetryService(SNAPSHOT_PATH)
forecast_service = ForecastService(FORECAST_SNAPSHOT_PATH)


# --------------------------------------------------------------- rate limit

class RateLimiter:
    """In-memory sliding window: N requests per IP per minute + global cap."""

    def __init__(self, per_ip: int, global_limit: int, window: float = 60.0) -> None:
        self.per_ip, self.global_limit, self.window = per_ip, global_limit, window
        self._hits: dict[str, deque[float]] = {}
        self._global: deque[float] = deque()

    def reset(self) -> None:
        self._hits.clear()
        self._global.clear()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window
        while self._global and self._global[0] < cutoff:
            self._global.popleft()
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= self.per_ip or len(self._global) >= self.global_limit:
            return False
        hits.append(now)
        self._global.append(now)
        if len(self._hits) > 10_000:  # cota de memoria
            for k in [k for k, v in self._hits.items() if not v]:
                del self._hits[k]
        return True


copilot_limiter = RateLimiter(
    per_ip=int(os.environ.get("COPILOT_RATE_PER_MIN", "8")),
    global_limit=int(os.environ.get("COPILOT_GLOBAL_RATE_PER_MIN", "60")),
)
dossier_limiter = RateLimiter(
    per_ip=int(os.environ.get("DOSSIER_RATE_PER_MIN", "3")),
    global_limit=int(os.environ.get("DOSSIER_GLOBAL_RATE_PER_MIN", "20")),
)
analysis_limiter = RateLimiter(
    per_ip=int(os.environ.get("SCOUT_ANALYSIS_RATE_PER_MIN", "4")),
    global_limit=int(os.environ.get("SCOUT_ANALYSIS_GLOBAL_RATE_PER_MIN", "20")),
)


def client_ip(request: Request) -> str:
    # En Cloud Run uvicorn corre con --proxy-headers, así que request.client ya es la IP real.
    return request.client.host if request.client else "unknown"


# ------------------------------------------------------------ static seguro

BLOCKED_TOP = {"server", "scripts", "node_modules", "raw-data", "coverage"}
BLOCKED_NAMES = {"dockerfile", "__pycache__", "requirements.txt", "requirements-dev.txt"}
BLOCKED_SUFFIXES = {".py", ".pyc", ".sh", ".env", ".pem", ".key", ".tif", ".tiff"}


def is_blocked_path(path: str) -> bool:
    parts = [p for p in PurePosixPath(path.replace("\\", "/")).parts if p not in ("", "/", ".")]
    if not parts:
        return False
    if parts[0].lower() in BLOCKED_TOP:
        return True
    for part in parts:
        low = part.lower()
        if part.startswith(".") or low in BLOCKED_NAMES or part == "..":
            return True
    return PurePosixPath(parts[-1].lower()).suffix in BLOCKED_SUFFIXES


class SafeStaticFiles(StaticFiles):
    """StaticFiles that does not expose server code, dotfiles (.git, .venv*, .env…), scripts/ or Dockerfile."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        if is_blocked_path(path):
            raise StarletteHTTPException(status_code=404)
        return await super().get_response(path, scope)


# --------------------------------------------------------------------- app

app = FastAPI(title="S.E.L.E.N.E. Ops API", version=VERSION, docs_url="/api/docs",
              openapi_url="/api/openapi.json", redoc_url=None)

_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _origins_env:
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in _origins_env.split(",") if o.strip()],
                       allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type"], max_age=600)
else:
    # Mismo origen no necesita CORS; además se permite cualquier puerto de localhost para desarrollo.
    app.add_middleware(CORSMiddleware, allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
                       allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type"], max_age=600)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    fields = [".".join(str(p) for p in err.get("loc", [])[1:]) for err in exc.errors()]
    return JSONResponse(status_code=422, content={"error": "invalid-input", "fields": fields})


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": VERSION,
        "providers": {"weather": weather_provider_name(), "ai": copilot.ai_provider_name()},
    }


@app.get("/api/telemetry")
async def telemetry(
    lat: float = Query(..., ge=-90, le=90, allow_inf_nan=False),
    lon: float = Query(..., ge=-180, le=180, allow_inf_nan=False),
    site: str | None = Query(None, pattern=SITE_PATTERN),
):
    result = await telemetry_service.get(lat, lon, site)
    if result is None:
        return JSONResponse(status_code=503, content={"error": "telemetry-unavailable"})
    return result


@app.get("/api/processes/forecast")
async def processes_forecast(
    lat: float = Query(..., ge=-90, le=90, allow_inf_nan=False),
    lon: float = Query(..., ge=-180, le=180, allow_inf_nan=False),
    site: str | None = Query(None, pattern=SITE_PATTERN),
):
    """72 h hourly series for Module 3; process analysis is done in processes.mjs."""
    result = await forecast_service.get(lat, lon, site)
    if result is None:
        return JSONResponse(status_code=503, content={"error": "forecast-unavailable"})
    return result


class CopilotRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=MAX_QUESTION_CHARS)
    context: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=20)

    @field_validator("history")
    @classmethod
    def validate_history(cls, history: list[dict[str, str]]) -> list[dict[str, str]]:
        if any(message.get("role") not in {"user", "assistant"} or not message.get("content")
               for message in history):
            raise ValueError("history entries require user/assistant role and non-empty content")
        return history


class DossierRequest(BaseModel):
    context: dict[str, Any] = Field(default_factory=dict)
    userNotes: str = Field(default="", max_length=4000)


@app.post("/api/copilot")
async def copilot_endpoint(body: CopilotRequest, request: Request):
    if copilot.ai_provider_name() == "none":
        return JSONResponse(status_code=503, content={"error": "no-ai-provider"})
    if not body.question.strip():
        return JSONResponse(status_code=422, content={"error": "invalid-input", "fields": ["question"]})
    if not copilot_limiter.allow(client_ip(request)):
        return JSONResponse(status_code=429, content={"error": "rate-limited"}, headers={"Retry-After": "60"})
    try:
        return await copilot.ask(body.question, body.context, body.history)
    except copilot.AIProviderError:
        return JSONResponse(status_code=503, content={"error": "ai-provider-unavailable"})


@app.post("/api/dossier")
async def dossier_endpoint(body: DossierRequest, request: Request):
    """Generate a long-form, provenance-aware Mission Dossier."""
    if copilot.ai_provider_name() == "none":
        return JSONResponse(status_code=503, content={"error": "no-ai-provider"})
    if not dossier_limiter.allow(client_ip(request)):
        return JSONResponse(status_code=429, content={"error": "rate-limited"}, headers={"Retry-After": "60"})
    try:
        return await dossier.create(body.context, body.userNotes)
    except dossier.DossierProviderError as exc:
        return dossier.create_fallback(body.context, str(exc), body.userNotes)


app.include_router(zones.build_router(zones.get_store_factory(REPO_ROOT), analysis_limiter, client_ip))


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
async def api_not_found(rest: str):
    return JSONResponse(status_code=404, content={"error": "not-found"})


if not re.match(r"^(0|false|no)$", os.environ.get("SERVE_STATIC", "1"), re.I):
    app.mount("/", SafeStaticFiles(directory=REPO_ROOT, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("server.main:app", host="127.0.0.1", port=port, reload=True)

