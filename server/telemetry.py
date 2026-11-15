"""Telemetría meteorológica para los gemelos terrestres (contrato §3).

Proveedores, en orden:
1. Meteomatics (si METEOMATICS_USERNAME y METEOMATICS_PASSWORD existen), con
   presupuesto diario (por defecto 900 de las 1000 consultas/día del plan).
2. Open-Meteo Forecast API (gratuita, sin clave). También es el respaldo si
   Meteomatics falla o agota el presupuesto.
3. Caché vieja (último valor conocido para esas coordenadas, live:false).
4. assets/data/telemetry-snapshot.json (provider:"snapshot", live:false).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import logging

import httpx

CACHE_TTL_SECONDS = 600
# Política de vigencia de la aplicación, no precisión ni latencia garantizada del modelo.
OBSERVATION_MAX_AGE_SECONDS = 1800
OBSERVATION_FUTURE_TOLERANCE_SECONDS = 300
HTTP_TIMEOUT = httpx.Timeout(6.0, connect=3.0)
# Meteomatics tarda ~5–6 s en responder: límite propio, configurable.
METEOMATICS_TIMEOUT = httpx.Timeout(float(os.environ.get("METEOMATICS_TIMEOUT", "20")), connect=5.0)
log = logging.getLogger("ares.weather")
USER_AGENT = "ares-twin/2.0 (+https://github.com/; NASA Space Apps demo)"

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_CURRENT = (
    "shortwave_radiation,temperature_2m,wind_speed_10m,"
    "wind_gusts_10m,relative_humidity_2m,cloud_cover,surface_pressure,wind_direction_10m,precipitation"
)
OPEN_METEO_FIELDS = {
    "shortwave_radiation": "solarRadiationWm2",
    "temperature_2m": "temperatureC",
    "wind_speed_10m": "windSpeedMs",
    "wind_gusts_10m": "windGustMs",
    "relative_humidity_2m": "relativeHumidityPct",
    "cloud_cover": "cloudCoverPct",
    "surface_pressure": "surfacePressurePa",
    "wind_direction_10m": "windDirDeg",
    "precipitation": "precipMm",
}
OPEN_METEO_UNITS = {
    "shortwave_radiation": "W/m²", "temperature_2m": "°C",
    "wind_speed_10m": "m/s", "wind_gusts_10m": "m/s",
    "relative_humidity_2m": "%", "cloud_cover": "%",
    "wind_direction_10m": "°", "precipitation": "mm",
}
OPEN_METEO_SOURCE = {
    "label": "Open-Meteo Forecast API · model «current» values (15 min)",
    "url": "https://open-meteo.com/en/docs",
}

METEOMATICS_URL = "https://api.meteomatics.com"
METEOMATICS_FIELDS = {
    "global_rad:W": "solarRadiationWm2",
    "t_2m:C": "temperatureC",
    "wind_speed_10m:ms": "windSpeedMs",
    "wind_gusts_10m_1h:ms": "windGustMs",
    "relative_humidity_2m:p": "relativeHumidityPct",
    "total_cloud_cover:p": "cloudCoverPct",
    "sfc_pressure:Pa": "surfacePressurePa",
    "wind_dir_10m:d": "windDirDeg",
    "precip_1h:mm": "precipMm",
}
METEOMATICS_SOURCE = {
    "label": "Meteomatics Weather API · modelo mix (now)",
    "url": "https://www.meteomatics.com/en/api/getting-started/",
}

VALUE_KEYS = tuple(OPEN_METEO_FIELDS.values())


class ProviderError(Exception):
    pass


class OptionalPressureError(ProviderError):
    """The provider rejected a query that included optional pressure."""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value <= -999 or value in (-888, -777, -666):
        return None
    return round(float(value), 1)


def _pressure_pa(value: Any, unit: Any) -> float | None:
    """Absolute Earth pressure; never MSL, null coercion or inferred units."""
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not 0 < value <= 120_000 or not isinstance(unit, str)):
        return None
    factor = {"hPa": 100, "Pa": 1}.get(unit)
    if factor is None:
        return None
    pressure = value * factor
    # Cota amplia para superficie terrestre; también detecta hPa mal rotulados Pa.
    return round(float(pressure), 1) if 10_000 <= pressure <= 120_000 else None


def _values(values: dict[str, Any]) -> dict[str, float | None]:
    result = {key: _num(values.get(key)) for key in VALUE_KEYS}
    result["surfacePressurePa"] = _pressure_pa(values.get("surfacePressurePa"), "Pa")
    return result


def cache_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, 2), round(lon, 2))


def weather_provider_name() -> str:
    if os.environ.get("METEOMATICS_USERNAME") and os.environ.get("METEOMATICS_PASSWORD"):
        return "meteomatics"
    return "open-meteo"


# ---------------------------------------------------------------- proveedores

async def fetch_open_meteo(client: httpx.AsyncClient, lat: float, lon: float) -> dict[str, Any]:
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "current": OPEN_METEO_CURRENT,
        "wind_speed_unit": "ms",
        "timezone": "GMT",
    }
    try:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()
        current = data["current"]
        if not isinstance(current, dict):
            raise ProviderError("open-meteo: invalid current")
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise ProviderError(f"open-meteo: {exc}") from exc
    observed = parse_iso(current.get("time"))  # timezone=GMT; acepta también ISO con zona.
    units = data.get("current_units")
    units = units if isinstance(units, dict) else {}
    values = {key: _num(current.get(field)) if units.get(field) == OPEN_METEO_UNITS.get(field)
              and field in OPEN_METEO_UNITS else None for field, key in OPEN_METEO_FIELDS.items()}
    values["surfacePressurePa"] = _pressure_pa(current.get("surface_pressure"), units.get("surface_pressure"))
    if all(v is None for v in values.values()):
        raise ProviderError("open-meteo: response without values")
    return {"observedAt": iso(observed) if observed else None, "values": values, "source": dict(OPEN_METEO_SOURCE)}


async def fetch_meteomatics(client: httpx.AsyncClient, lat: float, lon: float, *,
                          include_pressure: bool = True) -> dict[str, Any]:
    user = os.environ.get("METEOMATICS_USERNAME", "")
    password = os.environ.get("METEOMATICS_PASSWORD", "")
    fields = {p: k for p, k in METEOMATICS_FIELDS.items() if include_pressure or k != "surfacePressurePa"}
    url = f"{METEOMATICS_URL}/now/{','.join(fields)}/{lat:.4f},{lon:.4f}/json"
    try:
        resp = await client.get(url, params={"model": "mix"}, auth=(user, password), timeout=METEOMATICS_TIMEOUT)
        if include_pressure and resp.status_code in (400, 403, 422):
            raise OptionalPressureError("meteomatics: query with pressure rejected")
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "OK":
            raise ProviderError("meteomatics: provider status not OK")
        values: dict[str, float | None] = {key: None for key in VALUE_KEYS}
        observations: list[datetime | None] = []
        for item in payload["data"]:
            if not isinstance(item, dict):
                continue
            key = fields.get(item.get("parameter"))
            if not key:
                continue
            try:
                reading = item["coordinates"][0]["dates"][0]
                values[key] = (_pressure_pa(reading.get("value"), "Pa") if key == "surfacePressurePa"
                               else _num(reading.get("value")))
                if values[key] is not None:
                    observations.append(parse_iso(reading.get("date")))
            except (KeyError, TypeError, IndexError, AttributeError):
                continue  # Un parámetro opcional malformado no elimina los demás.
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError, AttributeError) as exc:
        raise ProviderError(f"meteomatics: {exc}") from exc
    if all(v is None for v in values.values()):
        raise ProviderError("meteomatics: response without values")
    # Si hay tiempos distintos, usar el más antiguo; un tiempo ausente no se inventa.
    observed = min(observations) if observations and all(t is not None for t in observations) else None
    return {"observedAt": iso(observed) if observed else None, "values": values, "source": dict(METEOMATICS_SOURCE)}


# ------------------------------------------------------------------- servicio

class TelemetryService:
    def __init__(self, snapshot_path: Path, ttl: float = CACHE_TTL_SECONDS,
                 meteomatics_daily_budget: int | None = None) -> None:
        self.snapshot_path = snapshot_path
        self.ttl = ttl
        self.meteomatics_daily_budget = meteomatics_daily_budget if meteomatics_daily_budget is not None else int(
            os.environ.get("METEOMATICS_DAILY_BUDGET", "900"))
        self._cache: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}
        self._locks: dict[tuple[float, float], asyncio.Lock] = {}
        self._mm_day = ""
        self._mm_count = 0
        self._mm_pressure_disabled = False
        self._snapshot: dict[str, Any] | None = None
        self._snapshot_mtime = 0.0

    # -- utilidades
    def clear(self) -> None:
        self._cache.clear()
        self._mm_day, self._mm_count = "", 0
        self._mm_pressure_disabled = False

    def _meteomatics_allowed(self) -> bool:
        today = utc_now().strftime("%Y-%m-%d")
        if today != self._mm_day:
            self._mm_day, self._mm_count = today, 0
        return self._mm_count < self.meteomatics_daily_budget

    def _load_snapshot(self) -> dict[str, Any]:
        try:
            mtime = self.snapshot_path.stat().st_mtime
            if self._snapshot is None or mtime != self._snapshot_mtime:
                self._snapshot = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
                self._snapshot_mtime = mtime
        except (OSError, ValueError):
            self._snapshot = {}
        return self._snapshot or {}

    async def _fetch_live(self, lat: float, lon: float) -> tuple[str, dict[str, Any]]:
        errors: list[str] = []
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
            if weather_provider_name() == "meteomatics" and self._meteomatics_allowed():
                self._mm_count += 1
                try:
                    return "meteomatics", await fetch_meteomatics(
                        client, lat, lon, include_pressure=not self._mm_pressure_disabled)
                except OptionalPressureError as exc:
                    self._mm_pressure_disabled = True
                    errors.append(str(exc))
                    if self._meteomatics_allowed():
                        self._mm_count += 1  # El reintento también consume presupuesto.
                        try:
                            return "meteomatics", await fetch_meteomatics(client, lat, lon, include_pressure=False)
                        except ProviderError as retry_exc:
                            errors.append(str(retry_exc))
                except ProviderError as exc:
                    log.warning("telemetry: Meteomatics failed, using Open-Meteo: %s", exc)
                    errors.append(str(exc))
            try:
                return "open-meteo", await fetch_open_meteo(client, lat, lon)
            except ProviderError as exc:
                log.warning("telemetry: Open-Meteo failed: %s", exc)
                errors.append(str(exc))
        raise ProviderError("; ".join(errors))

    def _snapshot_reading(self, lat: float, lon: float, site: str | None) -> dict[str, Any] | None:
        snapshot = self._load_snapshot()
        entry = snapshot.get(site) if site else None
        if entry is None and site and site.startswith("zone-"):
            return None  # Scout zones have no archive; a nearby site's reading is never relabelled as theirs
        if entry is None:
            # Sitio más cercano del snapshot (máx. ~1° ≈ 110 km) para no inventar lecturas lejanas.
            best, best_d = None, 1.0
            for key, item in snapshot.items():
                try:
                    d = math.hypot(item["lat"] - lat, (item["lon"] - lon) * math.cos(math.radians(lat)))
                except (KeyError, TypeError):
                    continue
                if d <= best_d:
                    best, best_d = (key, item), d
            if best is None:
                return None
            site = site or best[0]
            entry = best[1]
        observed = parse_iso(entry.get("observedAt"))
        observation_age = max(0, int(time.time() - observed.timestamp())) if observed else None
        fetched = parse_iso(entry.get("fetchedAt"))
        return {
            "site": site,
            "lat": entry.get("lat", lat),
            "lon": entry.get("lon", lon),
            "observedAt": iso(observed) if observed else None,
            "fetchedAt": iso(fetched) if fetched else None,
            "observationAgeSeconds": observation_age,
            "provider": "snapshot",
            "live": False,
            "cached": False,
            "ageSeconds": observation_age,
            "values": _values(entry.get("values") or {}),
            "source": entry.get("source") or {"label": "Local snapshot", "url": ""},
        }

    @staticmethod
    def _response(site: str | None, lat: float, lon: float, provider: str, reading: dict[str, Any],
                  fetched_at: float, *, live: bool, cached: bool) -> dict[str, Any]:
        now = time.time()
        observed = parse_iso(reading.get("observedAt"))
        age = now - observed.timestamp() if observed else None
        recent = age is not None and -OBSERVATION_FUTURE_TOLERANCE_SECONDS <= age <= OBSERVATION_MAX_AGE_SECONDS
        return {
            "site": site,
            "lat": lat,
            "lon": lon,
            "observedAt": iso(observed) if observed else None,
            "fetchedAt": iso(datetime.fromtimestamp(fetched_at, timezone.utc)),
            "observationAgeSeconds": max(0, int(age)) if age is not None else None,
            "provider": provider,
            "live": live and recent and provider in ("open-meteo", "meteomatics"),
            "cached": cached,
            "ageSeconds": max(0, int(now - fetched_at)),
            "values": _values(reading["values"]),
            "source": dict(reading["source"]),
        }

    async def get(self, lat: float, lon: float, site: str | None = None) -> dict[str, Any] | None:
        key = cache_key(lat, lon)
        rlat, rlon = key
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < self.ttl:
                provider, reading = hit[1]["provider"], hit[1]["reading"]
                return self._response(site, rlat, rlon, provider, reading, hit[0], live=True, cached=True)
            try:
                provider, reading = await self._fetch_live(lat, lon)
            except ProviderError:
                if hit:  # caché vieja: ya no es «en vivo»
                    return self._response(site, rlat, rlon, hit[1]["provider"], hit[1]["reading"], hit[0],
                                          live=False, cached=True)
                return self._snapshot_reading(lat, lon, site)
            now = time.time()
            self._cache[key] = (now, {"provider": provider, "reading": reading})
            if len(self._cache) > 2000:  # cota de memoria
                oldest = min(self._cache, key=lambda k: self._cache[k][0])
                self._cache.pop(oldest, None)
                self._locks.pop(oldest, None)
            return self._response(site, rlat, rlon, provider, reading, now, live=True, cached=False)
