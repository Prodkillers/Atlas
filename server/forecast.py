"""Pronóstico horario de 72 h para el Módulo 3 (procesos dinámicos), contrato docs/modules/m3-processes.md.

Proveedores, en orden:
1. Meteomatics (si METEOMATICS_USERNAME y METEOMATICS_PASSWORD existen): una consulta de serie
   temporal now → now+72H, como mucho una cada 30 min por celda (≈48/día por sitio, aparte del presupuesto de la telemetría).
2. Open-Meteo Forecast API (gratuita, sin clave), también respaldo si Meteomatics falla.
3. Caché vieja (live:false) y luego assets/data/processes-forecast-snapshot.json (provider:"snapshot").

Todas las horas se devuelven en UTC (ISO-8601 con «Z») junto con el huso del sitio para mostrarlas.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx

from .telemetry import (
    METEOMATICS_TIMEOUT, log, HTTP_TIMEOUT, METEOMATICS_URL, USER_AGENT, ProviderError, _num, cache_key, iso, parse_iso, utc_now,
    weather_provider_name,
)

FORECAST_TTL_SECONDS = 1800
FORECAST_HOURS = 72
HOUR_KEYS = ("tempC", "groundTempC", "windMs", "gustMs", "radiationWm2", "rhPct", "precipMm")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_HOURLY = {
    "temperature_2m": "tempC",
    "soil_temperature_0cm": "groundTempC",
    "wind_speed_10m": "windMs",
    "wind_gusts_10m": "gustMs",
    "shortwave_radiation": "radiationWm2",
    "relative_humidity_2m": "rhPct",
    "precipitation": "precipMm",
}
OPEN_METEO_SOURCE = {
    "label": "Open-Meteo Forecast API · 72 h hourly forecast (model)",
    "url": "https://open-meteo.com/en/docs",
}
METEOMATICS_PARAMS = {
    "t_2m:C": "tempC",
    "t_0m:C": "groundTempC",
    "wind_speed_10m:ms": "windMs",
    "wind_gusts_10m_1h:ms": "gustMs",
    "global_rad:W": "radiationWm2",
    "relative_humidity_2m:p": "rhPct",
    "precip_1h:mm": "precipMm",
}
METEOMATICS_SOURCE = {
    "label": "Meteomatics Weather API · serie horaria now→+72H (modelo mix)",
    "url": "https://www.meteomatics.com/en/api/getting-started/",
}


async def fetch_open_meteo_forecast(client: httpx.AsyncClient, lat: float, lon: float) -> dict[str, Any]:
    params = {
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
        "hourly": ",".join(OPEN_METEO_HOURLY), "forecast_hours": FORECAST_HOURS,
        "wind_speed_unit": "ms", "timezone": "auto",
    }
    try:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()
        hourly = data["hourly"]
        offset = int(data.get("utc_offset_seconds") or 0)
        tz = str(data.get("timezone") or "GMT")
        hours = []
        for i, local in enumerate(hourly["time"]):
            local_dt = parse_iso(f"{local}Z")
            if local_dt is None:
                continue
            row = {"time": iso(local_dt - timedelta(seconds=offset))}
            for field, key in OPEN_METEO_HOURLY.items():
                values = hourly.get(field) or []
                row[key] = _num(values[i]) if i < len(values) else None
            hours.append(row)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise ProviderError(f"open-meteo forecast: {exc}") from exc
    if not hours or all(all(h[k] is None for k in HOUR_KEYS) for h in hours):
        raise ProviderError("open-meteo forecast: no values")
    return {"timezone": tz, "utcOffsetSeconds": offset, "hours": hours, "source": dict(OPEN_METEO_SOURCE)}


async def fetch_timezone(client: httpx.AsyncClient, lat: float, lon: float) -> tuple[str, int] | None:
    """Real site time zone (Open-Meteo, no key). Meteomatics does not report it."""
    try:
        resp = await client.get(OPEN_METEO_URL, params={"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
                                                        "timezone": "auto", "current": "temperature_2m"})
        resp.raise_for_status()
        data = resp.json()
        return str(data["timezone"]), int(data["utc_offset_seconds"])
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None


async def fetch_meteomatics_forecast(client: httpx.AsyncClient, lat: float, lon: float) -> dict[str, Any]:
    user = os.environ.get("METEOMATICS_USERNAME", "")
    password = os.environ.get("METEOMATICS_PASSWORD", "")
    # Empieza en la hora en punto para alinear la serie con Open-Meteo y con los gráficos.
    start = utc_now().replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=FORECAST_HOURS - 1)
    url = (f"{METEOMATICS_URL}/{iso(start)}--{iso(end)}:PT1H/"
           f"{','.join(METEOMATICS_PARAMS)}/{lat:.4f},{lon:.4f}/json")
    try:
        resp = await client.get(url, params={"model": "mix"}, auth=(user, password), timeout=METEOMATICS_TIMEOUT)
        resp.raise_for_status()
        rows: dict[str, dict[str, Any]] = {}
        for item in resp.json()["data"]:
            key = METEOMATICS_PARAMS.get(item.get("parameter"))
            if not key:
                continue
            for reading in item["coordinates"][0]["dates"]:
                when = parse_iso(reading.get("date", ""))
                if when is None:
                    continue
                stamp = iso(when)
                rows.setdefault(stamp, {"time": stamp, **{k: None for k in HOUR_KEYS}})[key] = _num(reading.get("value"))
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
        raise ProviderError(f"meteomatics forecast: {exc}") from exc
    hours = [rows[k] for k in sorted(rows)][:FORECAST_HOURS]
    if not hours:
        raise ProviderError("meteomatics forecast: no values")
    # Meteomatics no informa el huso: se estima por longitud solo para mostrar horas locales.
    return {"timezone": "UTC (time zone estimated from longitude)", "utcOffsetSeconds": round(lon / 15) * 3600,
            "hours": hours, "source": dict(METEOMATICS_SOURCE)}


class ForecastService:
    def __init__(self, snapshot_path: Path, ttl: float = FORECAST_TTL_SECONDS,
                 transport: httpx.AsyncBaseTransport | None = None):
        self.snapshot_path = snapshot_path
        self.ttl = ttl
        self.transport = transport
        self._cache: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()
        self._snapshot: dict[str, Any] | None = None
        self._tz: dict[tuple[float, float], tuple[str, int]] = {}

    def clear(self) -> None:
        self._cache.clear()

    def _load_snapshot(self) -> dict[str, Any]:
        if self._snapshot is None:
            try:
                self._snapshot = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self._snapshot = {}
        return self._snapshot

    def _from_snapshot(self, site: str | None, lat: float, lon: float) -> dict[str, Any] | None:
        snap = self._load_snapshot()
        entry = snap.get(site) if site else None
        if entry is None and site and site.startswith("zone-"):
            return None  # Scout zones have no archived forecast; never borrow a nearby site's
        if entry is None:
            # el más cercano a menos de ~1° (≈110 km), igual que la telemetría
            best = None
            for item in snap.values():
                try:
                    d = abs(item["lat"] - lat) + abs(item["lon"] - lon)
                except (KeyError, TypeError):
                    continue
                if d < 1 and (best is None or d < best[0]):
                    best = (d, item)
            entry = best[1] if best else None
        if entry is None:
            return None
        return {**entry, "provider": "snapshot", "live": False, "cached": False}

    async def _fetch(self, lat: float, lon: float) -> tuple[str, dict[str, Any]]:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT},
                                     transport=self.transport) as client:
            if weather_provider_name() == "meteomatics":
                try:
                    data = await fetch_meteomatics_forecast(client, lat, lon)
                    key = cache_key(lat, lon)
                    tz = self._tz.get(key) or await fetch_timezone(client, lat, lon)
                    if tz:
                        self._tz[key] = tz
                        data["timezone"], data["utcOffsetSeconds"] = tz
                    return "meteomatics", data
                except ProviderError as exc:
                    log.warning("forecast: Meteomatics failed, using Open-Meteo: %s", exc)
            try:
                return "open-meteo", await fetch_open_meteo_forecast(client, lat, lon)
            except ProviderError as exc:
                log.warning("forecast: Open-Meteo failed: %s", exc)
                raise

    async def get(self, lat: float, lon: float, site: str | None) -> dict[str, Any] | None:
        key = cache_key(lat, lon)
        now = time.monotonic()
        async with self._lock:
            hit = self._cache.get(key)
        if hit and now - hit[0] < self.ttl:
            return self._shape(site, key, hit[1], cached=True, live=True, age=now - hit[0])
        try:
            provider, data = await self._fetch(*key)
        except ProviderError:
            if hit:  # caché vieja: mejor que nada, rotulada como no en vivo
                return self._shape(site, key, hit[1], cached=True, live=False, age=now - hit[0])
            return self._from_snapshot(site, lat, lon)
        payload = {"provider": provider, "fetchedAt": iso(utc_now()), **data}
        async with self._lock:
            self._cache[key] = (now, payload)
            if len(self._cache) > 500:
                self._cache.pop(min(self._cache, key=lambda k: self._cache[k][0]), None)
        return self._shape(site, key, payload, cached=False, live=True, age=0)

    @staticmethod
    def _shape(site, key, payload, *, cached: bool, live: bool, age: float) -> dict[str, Any]:
        return {
            "site": site, "lat": key[0], "lon": key[1],
            "provider": payload["provider"], "live": live, "cached": cached, "ageSeconds": round(age),
            "fetchedAt": payload["fetchedAt"], "timezone": payload["timezone"],
            "utcOffsetSeconds": payload["utcOffsetSeconds"], "hours": payload["hours"],
            "source": payload["source"],
        }
