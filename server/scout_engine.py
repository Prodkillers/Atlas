"""Scout analysis pipeline: rank 2400 m micro-sites inside a user zone against a planetary target.

The geometry recipe is the scenario recipe (docs/contracts.md §1.1, §2): Copernicus GLO-30 resampled to
37.5 m in a local azimuthal-equidistant frame (row 0 north, column 0 west), metrics from
scripts/terrain_metrics.py and window search from scripts/analog_match.py, so a zone's index is the same
number similarity.mjs shows for the four reference scenarios.

Data access goes through `Providers` so tests can run offline. The default provider needs the optional
geospatial stack in server/requirements-scout.txt; without it the DEM layer is reported unavailable and
nothing is invented.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from terrain_metrics import bilinear_resample, compute_metrics, geometric_index  # noqa: E402

from .scout_geometry import contains  # noqa: E402

N, SPACING = 65, 37.5
WINDOW_M = (N - 1) * SPACING
HALF = WINDOW_M / 2
NATIVE_RES = 30.0
TOP_SITES = 5
DETAIL_SITES = 3
MAX_AFFINITY_CELLS = 3000
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
DEM_DATASET = "Copernicus DEM GLO-30 (Planetary Computer cop-dem-glo-30)"
DEM_LICENSE = "https://spacedata.copernicus.eu/documents/20126/0/CSCDA_ESA_Mission-specific+Annex.pdf"
DEM_CREDIT = ("© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS "
              "by the European Union and ESA; all rights reserved")
SENTINEL_LICENSE = "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice"
S1_RTC_LICENSE = "https://creativecommons.org/licenses/by/4.0/"
ERA5_URL = "https://archive-api.open-meteo.com/v1/archive"
EARTH_ENV = {"gravityMs2": 9.81, "solarConstantWm2": 1361,
             "atmosphere": "N₂ 78 % · O₂ 21 % · ~101 kPa at sea level (lower with altitude)", "dayLengthHours": 24}
GEO_MODULES = ("numpy", "rasterio", "pyproj", "pystac_client", "planetary_computer", "PIL")
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
                GDAL_HTTP_MULTIRANGE="YES", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES", VSI_CACHE="TRUE",
                GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2", GDAL_HTTP_TIMEOUT="60",
                GDAL_HTTP_CONNECTTIMEOUT="20")
SCALE_NOTE = ("7200 m search windows (65 nodes at 112.5 m) are compared with the 2400 m target window: they find "
              "landform-scale matches. Every published micro-site is then rebuilt as a standard 2400 m window and "
              "scored again at the same scale as the target.")
ABSENT_LAYERS = {
    "sarHistory": "12-month Sentinel-1 process history is generated offline for the four reference sites only; "
                  "it has not been produced for this zone.",
    "subsurface": "No cavity map, ERT or sounding exists in the system for this zone.",
    "materials": "No material or lithology characterisation is available for this zone.",
    "hazards": "Rover-scale hazards are not detected; DEM slope metrics are regional (37.5 m nodes).",
}


class Cancelled(Exception):
    pass


class LayerUnavailable(RuntimeError):
    """A provider cannot supply a layer here (missing stack, no coverage, no clear scene)."""


def missing_geo_modules() -> list[str]:
    import importlib.util
    return [m for m in GEO_MODULES if importlib.util.find_spec(m) is None]


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())


# --------------------------------------------------------------------------- providers
class PlanetaryComputerProviders:
    """Copernicus GLO-30, Sentinel-2 L2A and Sentinel-1 RTC from Microsoft Planetary Computer; ERA5 from Open-Meteo."""

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        missing = missing_geo_modules()
        self.missing = missing

    def require(self) -> None:
        if self.missing:
            raise LayerUnavailable("server geospatial stack not installed (" + ", ".join(self.missing)
                                   + "); install server/requirements-scout.txt")

    # ---- shared helpers
    def _catalog(self):
        import planetary_computer as pc
        import pystac_client
        return pystac_client.Client.open(STAC, modifier=pc.sign_inplace)

    @staticmethod
    def _crs(lat, lon):
        from pyproj import CRS
        return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs")

    def to_geo(self, lat, lon):
        from pyproj import Transformer
        tr = Transformer.from_crs(self._crs(lat, lon), "EPSG:4326", always_xy=True)
        return lambda east, north: tuple(reversed(tr.transform(east, north)))

    def _bbox(self, lat, lon, half):
        geo = self.to_geo(lat, lon)
        pts = [geo(x, y) for x in (-half, 0, half) for y in (-half, 0, half)]
        return [min(p[1] for p in pts), min(p[0] for p in pts), max(p[1] for p in pts), max(p[0] for p in pts)]

    def _warp(self, href, lat, lon, n, pixel, resampling, src_nodata=None, dtype="float32", dst_nodata=float("nan")):
        import rasterio
        from rasterio.transform import from_origin
        from rasterio.vrt import WarpedVRT
        half = (n - 1) * pixel / 2
        transform = from_origin(-half - pixel / 2, half + pixel / 2, pixel, pixel)
        with rasterio.Env(**GDAL_ENV), rasterio.open(href) as src:
            nod = src_nodata if src_nodata is not None else src.nodata
            with WarpedVRT(src, crs=self._crs(lat, lon), transform=transform, width=n, height=n,
                           resampling=resampling, src_nodata=nod, nodata=dst_nodata, dtype=dtype) as vrt:
                t = vrt.transform
                if not (t.a > 0 and t.e < 0 and t.b == 0 and t.d == 0):
                    raise RuntimeError(f"unexpected geotransform {t}")
                return vrt.read(1)

    def _dem(self, lat, lon, n, pixel, resampling_name):
        import numpy as np
        import planetary_computer as pc
        from rasterio.enums import Resampling
        self.require()
        half = (n - 1) * pixel / 2
        items = list(self._catalog().search(collections=["cop-dem-glo-30"], bbox=self._bbox(lat, lon, half + 100)).items())
        if not items:
            raise LayerUnavailable("cop-dem-glo-30: no tile covers this zone")
        z = np.full((n, n), np.nan, dtype="float64")
        for it in items:
            part = self._warp(pc.sign(it.assets["data"].href), lat, lon, n, pixel, getattr(Resampling, resampling_name))
            z = np.where(np.isfinite(z), z, part)
        return z, [it.id for it in items]

    # ---- layers
    def region_dem(self, lat, lon, n, spacing):
        key = hashlib.sha256(f"glo30|{lat:.6f}|{lon:.6f}|{n}|{spacing}".encode()).hexdigest()[:16]
        cache = self.cache_dir / f"region-{key}.npz"
        import numpy as np
        if cache.exists():
            data = np.load(cache, allow_pickle=False)
            return data["z"], [str(t) for t in data["tiles"]]
        z, tiles = self._dem(lat, lon, n, spacing, "bilinear")
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache, z=z, tiles=np.array(tiles))
        return z, tiles

    def window_dem(self, lat, lon):
        native_n = round(WINDOW_M / NATIVE_RES) + 1
        native, tiles = self._dem(lat, lon, native_n, NATIVE_RES, "bilinear")
        import numpy as np
        if not np.isfinite(native).all():
            raise LayerUnavailable(f"DEM window incomplete: {int((~np.isfinite(native)).sum())} nodes without data")
        if (native <= 0).any():
            raise LayerUnavailable("window touches sea level (GLO-30 fills the sea with 0 m)")
        grid = bilinear_resample([float(v) for v in native.ravel()], native_n, N)
        return [round(v, 1) for v in grid], tiles

    def imagery(self, lat, lon, out_path: Path):
        import numpy as np
        import planetary_computer as pc
        from PIL import Image
        from rasterio.enums import Resampling
        self.require()
        end = dt.date.today()
        start = end - dt.timedelta(days=400)
        items = self._catalog().search(collections=["sentinel-2-l2a"], bbox=self._bbox(lat, lon, HALF),
                                       datetime=f"{start}/{end}", query={"eo:cloud_cover": {"lt": 10}},
                                       sortby=[{"field": "datetime", "direction": "desc"}], max_items=30).items()
        chosen = None
        for it in items:
            try:
                scl = self._warp(pc.sign(it.assets["SCL"].href), lat, lon, 120, 20.0, Resampling.nearest,
                                 src_nodata=0, dtype="uint8", dst_nodata=0)
            except Exception:  # noqa: BLE001 - skip unreadable scenes
                continue
            total = scl.size
            cloud = int(np.isin(scl, [3, 8, 9, 10]).sum())
            if int((scl == 0).sum()) == 0 and cloud / total < 0.01 and int((scl == 7).sum()) / total < 0.05:
                chosen = (it, round(cloud / total, 4))
                break
        if not chosen:
            raise LayerUnavailable("no clear, complete Sentinel-2 L2A scene in the last 400 days")
        it, cloud_frac = chosen
        baseline = float(it.properties.get("s2:processing_baseline") or "0")
        offset = 1000 if baseline >= 4 else 0
        px = 768
        bands = [self._warp(pc.sign(it.assets[b].href), lat, lon, px, WINDOW_M / px, Resampling.cubic, src_nodata=0)
                 for b in ("B04", "B03", "B02")]
        refl = (np.stack(bands, -1) - offset) / 10000
        lo, hi = float(np.nanpercentile(refl, 0.5)), float(np.nanpercentile(refl, 99.7))
        rgb = np.clip((refl - lo) / (hi - lo), 0, 1) ** (1 / 1.2)
        img = Image.fromarray(np.nan_to_num(rgb * 255).astype("uint8"), "RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80, optimize=True, progressive=True)
        atomic_write(out_path, buf.getvalue())
        acquired = it.properties.get("datetime")
        return {
            "credit": f"Contains modified Copernicus Sentinel data {str(acquired)[:4]} (Sentinel-2 L2A, {it.id}), "
                      "processed by ESA; distributed via Microsoft Planetary Computer",
            "license": SENTINEL_LICENSE,
            "source": f"{STAC}/collections/sentinel-2-l2a/items/{it.id}",
            "product": "Sentinel-2 L2A surface reflectance B04/B03/B02 (10 m) cropped to the 2400 m window, cubic "
                       f"resampling to 768 px, common linear stretch [{lo:.4f}, {hi:.4f}] and gamma 1/1.2",
            "acquired": acquired,
            "sceneCloudCoverPct": it.properties.get("eo:cloud_cover"),
            "windowCloudFraction": cloud_frac,
        }

    def roughness(self, lat, lon):
        import numpy as np
        import planetary_computer as pc
        from rasterio.enums import Resampling
        self.require()
        end = dt.date.today()
        start = end - dt.timedelta(days=90)
        items = self._catalog().search(collections=["sentinel-1-rtc"], bbox=self._bbox(lat, lon, HALF),
                                       datetime=f"{start}/{end}", sortby=[{"field": "datetime", "direction": "desc"}],
                                       max_items=10).items()
        for it in items:
            pol = "vv" if "vv" in it.assets else "hh" if "hh" in it.assets else None
            if not pol:
                continue
            arr = self._warp(pc.sign(it.assets[pol].href), lat, lon, 240, 10.0, Resampling.nearest)
            valid = np.isfinite(arr) & (arr > 0)
            if valid.mean() < 0.95:
                continue
            db = 10 * np.log10(arr[valid])
            return {
                "value": round(float(db.mean()), 2), "unit": "dB", "polarization": pol.upper(),
                "stdDb": round(float(db.std()), 2), "acquired": it.properties.get("datetime"),
                "method": f"Mean gamma0 {pol.upper()} (RTC, terrain-flattened) in dB over the 2400 m window "
                          "(240×240 px at 10 m, nearest neighbour). C-band surface roughness proxy, not measured "
                          "geometric roughness. Single scene.",
                "source": f"{STAC}/collections/sentinel-1-rtc/items/{it.id}",
                "license": S1_RTC_LICENSE,
                "credit": "Sentinel-1 RTC (Planetary Computer, CC BY 4.0) · contains modified Copernicus Sentinel data",
            }
        raise LayerUnavailable("no Sentinel-1 RTC scene with ≥95 % valid pixels in the last 90 days")

    def climate(self, lat, lon):
        import httpx
        end = dt.date(dt.date.today().year - 1, 12, 31)
        start = dt.date(end.year - 1, 1, 1)
        params = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "start_date": start.isoformat(),
                  "end_date": end.isoformat(), "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
                  "timezone": "UTC"}
        try:
            r = httpx.get(ERA5_URL, params=params, timeout=30, headers={"User-Agent": "SELENE-Ops-Scout/1.0"})
            r.raise_for_status()
            daily = r.json()["daily"]
        except Exception as exc:  # noqa: BLE001
            raise LayerUnavailable(f"ERA5 archive unavailable ({type(exc).__name__})") from exc
        tmax = [t for t in daily.get("temperature_2m_max") or [] if t is not None]
        tmin = [t for t in daily.get("temperature_2m_min") or [] if t is not None]
        precip = [p for p in daily.get("precipitation_sum") or [] if p is not None]
        if not tmax or not tmin:
            raise LayerUnavailable("ERA5 returned no temperature for this cell")
        amp = sum(hi - lo for hi, lo in zip(tmax, tmin)) / min(len(tmax), len(tmin))
        years = max(1, (end - start).days / 365.25)
        annual = sum(precip) / years
        return {
            "kind": "era5-climatology", "amplitudeK": round(amp, 2), "minK": round(min(tmin) + 273.15, 1),
            "maxK": round(max(tmax) + 273.15, 1), "annualPrecipMm": round(annual, 1),
            "aridity": "Arid" if annual < 250 else "Semi-arid" if annual < 500 else "Humid",
            "period": [start.isoformat(), end.isoformat()],
            "source": "ERA5 reanalysis daily 2 m air temperature and precipitation via Open-Meteo archive API",
            "url": "https://open-meteo.com/en/docs/historical-weather-api",
            "note": "Earth-side climate context (2 m air). It is not compared with the target surface temperature "
                    "and does not enter the geometric index.",
        }


# --------------------------------------------------------------------------- search
def region_size(zone: dict[str, Any], spacing: float = SPACING) -> int:
    """Odd node count, multiple of 3 with an odd block count, covering the zone plus half a window."""
    lat0, lon0 = zone["center"]
    k = math.cos(math.radians(lat0))
    reach = 0.0
    for lon, lat in zone["geometry"]["coordinates"][0]:
        reach = max(reach, abs(math.radians(lon - lon0)) * 6_371_008.8 * k, abs(math.radians(lat - lat0)) * 6_371_008.8)
    half = reach + HALF + spacing
    m = math.ceil((2 * math.ceil(half / spacing) + 1) / 3)
    if m % 2 == 0:
        m += 1
    return 3 * m


def block_mean3(z):
    import numpy as np
    m = z.shape[0] // 3
    blocks = z[:3 * m, :3 * m].reshape(m, 3, m, 3)
    out = blocks.mean(axis=(1, 3))          # NaN propagates: incomplete blocks stay without data
    return out


def search_zone(zone, z, to_geo, target_metrics, scales, emit=lambda *a, **k: None):
    """Rank window centres inside the polygon at each scale; return (sites, affinity)."""
    import numpy as np
    from analog_match import index_field, rank, window_metrics
    ring = zone["geometry"]["coordinates"][0]
    n = z.shape[0]
    stride = 4 if n <= 420 else 8

    def allow(east, north):
        lat, lon = to_geo(east, north)
        return contains(ring, lon, lat)

    found = []
    for scale in scales:
        if scale == 2400:
            zz, sp, st, sep = z, SPACING, stride, 600.0
        else:
            zz = block_mean3(z)
            if zz.shape[0] < N:
                emit("ranking", "info", "Zone too small for 7200 m windows; scale skipped.")
                continue
            zz, sp, st, sep = zz, SPACING * 3, 2, 1800.0
        picked = rank(zz, target_metrics, sp, st, allow, TOP_SITES * 3, sep)
        for p in picked:
            p["scaleMeters"] = scale
        found.extend(picked)
        emit("ranking", "info", f"{scale} m windows: {len(picked)} candidate centres inside the zone.")
    found.sort(key=lambda p: (-p["index"], p["distance"]))
    sites = []
    for p in found:
        if all(math.hypot(p["east"] - s["east"], p["north"] - s["north"]) >= 600.0 for s in sites):
            sites.append(p)
        if len(sites) >= TOP_SITES * 2:   # spares if a window fails to rebuild
            break

    rows, cols, m = window_metrics(z, SPACING, N, stride)
    idx = index_field(m, target_metrics)
    half = (n - 1) * SPACING / 2
    cells = []
    for i, r in enumerate(rows):
        for j, c in enumerate(cols):
            if not np.isfinite(idx[i, j]):
                continue
            east, north = -half + (c + N // 2) * SPACING, half - (r + N // 2) * SPACING
            lat, lon = to_geo(east, north)
            if contains(ring, lon, lat):
                cells.append([round(lat, 5), round(lon, 5), int(idx[i, j])])
    step = max(1, math.ceil(len(cells) / MAX_AFFINITY_CELLS))
    affinity = {"cellMeters": stride * SPACING, "windowMeters": WINDOW_M, "cells": cells[::step],
                "method": "Geometric index of the 2400 m window centred on each cell (scripts/analog_match.py); "
                          "cells are window centres, not independent pixels."}
    return sites, affinity


# --------------------------------------------------------------------------- pipeline
def _layer(status, **extra):
    return {"status": status, **{k: v for k, v in extra.items() if v is not None}}


def run_analysis(zone: dict[str, Any], revision: dict[str, Any], target: dict[str, Any], providers,
                 out_dir: Path, emit: Callable[..., None], cancelled: Callable[[], bool]) -> dict[str, Any]:
    """Execute one revision. Writes manifest.json and sites/<rank>/{grid.json,imagery.jpg} under out_dir."""
    rev = revision["revision"]
    zid = zone["id"]
    target_metrics = target.get("metrics") or {}
    base = f"/api/zones/{zid}/revisions/{rev}"
    manifest: dict[str, Any] = {
        "version": 1, "zoneId": zid, "revision": rev, "status": "running", "startedAt": utc_now(), "finishedAt": None,
        "target": {"id": target.get("id"), "name": target.get("name"), "body": target.get("body"),
                   "metrics": {k: target_metrics.get(k) for k in ("slopeP50Deg", "slopeP90Deg", "reliefP95P5M", "triMeanM")},
                   "dataset": target.get("dataset"), "path": revision["targetPath"]},
        "operation": revision.get("operation"),
        "geometry": zone["geometry"], "center": zone["center"], "areaKm2": zone["areaKm2"],
        "window": {"extentMeters": WINDOW_M, "gridSize": N, "spacingMeters": SPACING},
        "scales": revision["scales"],
        "layers": {
            "geometry": _layer("ready", method="GeoJSON [lon, lat] validated; centre and extent in a local frame."),
            "dem": _layer("pending"), "terrainMetrics": _layer("pending"), "ranking": _layer("pending"),
            "imagery": _layer("pending"), "sarRoughness": _layer("pending"), "climateContext": _layer("pending"),
            "forecast72h": _layer("on-demand", method="Queried by coordinates when the mission opens (Meteomatics or "
                                  "Open-Meteo model). No archived forecast exists for zones; a nearby site's archive "
                                  "is never substituted."),
            **{k: _layer("absent", reason=v) for k, v in ABSENT_LAYERS.items()},
        },
        "sites": [], "affinity": None, "caveats": [
            "Geometric similarity index, not planetary: terrain shape alone does not reproduce gravity, regolith, "
            "illumination or chemistry.", SCALE_NOTE,
            "Micro-sites are proposals for further investigation, not verified field-test sites.",
        ],
    }

    def save():
        write_json(out_dir / "manifest.json", manifest)

    def check():
        if cancelled():
            raise Cancelled()

    def layer(name, status, **extra):
        manifest["layers"][name] = _layer(status, **extra)
        save()
        emit(name, status, extra.get("message") or extra.get("reason") or status, {"layer": manifest["layers"][name]})

    save()
    try:
        check()
        if not all(isinstance(target_metrics.get(k), (int, float)) for k in ("slopeP50Deg", "slopeP90Deg", "reliefP95P5M", "triMeanM")):
            raise LayerUnavailable("target grid has no published metrics")
        lat0, lon0 = zone["center"]
        n = region_size(zone)
        layer("dem", "running", message=f"Reading Copernicus GLO-30 over {n}×{n} nodes at 37.5 m.")
        try:
            z, tiles = providers.region_dem(lat0, lon0, n, SPACING)
        except LayerUnavailable as exc:
            layer("dem", "unavailable", reason=str(exc))
            for name in ("terrainMetrics", "ranking", "imagery", "sarRoughness", "climateContext"):
                manifest["layers"][name] = _layer("unavailable", reason="requires the DEM layer")
            manifest["status"] = "unavailable"
            manifest["finishedAt"] = utc_now()
            save()
            emit("done", "unavailable", "No DEM: the zone cannot be ranked.")
            return manifest
        import numpy as np
        z = np.asarray(z, dtype="float64")
        z[z <= 0] = np.nan                  # GLO-30 fills the sea with 0 m: a window with sea is not an analogue
        to_geo = providers.to_geo(lat0, lon0)
        valid = float(np.isfinite(z).mean())
        layer("dem", "ready", product=DEM_DATASET, resolution="30 m native, resampled to 37.5 m (bilinear)",
              coverage=round(valid, 3), tiles=tiles, license=DEM_LICENSE,
              message=f"GLO-30 region ready ({valid:.0%} land nodes with data).")
        check()

        layer("ranking", "running", message="Searching 2400 m windows inside the zone.")
        candidates, affinity = search_zone(zone, z, to_geo, target_metrics, revision["scales"], emit)
        manifest["affinity"] = affinity
        if not candidates:
            layer("ranking", "unavailable", reason="no complete land window has its centre inside the zone")
            for name in ("terrainMetrics", "imagery", "sarRoughness", "climateContext"):
                manifest["layers"][name] = _layer("unavailable", reason="no micro-site")
            manifest["status"] = "unavailable"
            manifest["finishedAt"] = utc_now()
            save()
            emit("done", "unavailable", "No complete window inside the zone.")
            return manifest
        layer("ranking", "ready", cells=len(affinity["cells"]), method=affinity["method"],
              message=f"{len(candidates)} candidate centres; rebuilding the best as standard grids.")
        check()

        layer("terrainMetrics", "running", message="Rebuilding micro-sites as standard 65×65 grids.")
        sites = []
        for cand in candidates:
            check()
            lat, lon = to_geo(cand["east"], cand["north"])
            try:
                elevation, site_tiles = providers.window_dem(lat, lon)
            except LayerUnavailable as exc:
                emit("terrainMetrics", "info", f"Window at {lat:.4f}, {lon:.4f} skipped: {exc}.")
                continue
            metrics = compute_metrics(elevation, N, SPACING, NATIVE_RES)
            rank_no = len(sites) + 1
            earth_id = f"{zid}-r{rev}-s{rank_no}"
            index = geometric_index(metrics, target_metrics)
            grid = {
                "id": earth_id, "body": "earth", "name": f"{zone['name']} · micro-site {rank_no}",
                "center": [round(lat, 5), round(lon, 5)], "gridSize": N, "spacingMeters": SPACING,
                "extentMeters": WINDOW_M, "elevation": elevation, "imagery": None, "dataset": DEM_DATASET,
                "nativeResolutionMeters": NATIVE_RES, "source": f"{STAC}/collections/cop-dem-glo-30",
                "license": DEM_LICENSE, "demCredit": DEM_CREDIT, "fetchedAt": utc_now(), "metrics": metrics,
                "thermal": None, "environment": EARTH_ENV, "climateContext": None,
                "zone": {"id": zid, "revision": rev, "rank": rank_no, "foundAtScaleMeters": cand["scaleMeters"],
                         "searchIndex": cand["index"], "targetId": target.get("id"), "geometry": zone["geometry"],
                         "source": zone.get("source")},
                "provenance": [{"label": f"Copernicus DEM GLO-30 tiles {', '.join(site_tiles)} (Planetary Computer)",
                                "url": f"{STAC}/collections/cop-dem-glo-30"}],
                "notes": [f"Micro-site generated by S.E.L.E.N.E. Scout inside user zone {zid} (revision {rev}): the "
                          f"window with rank {rank_no} against {target.get('id')} found at the {cand['scaleMeters']} m "
                          "search scale. It is not a published field-test site.",
                          "Same grid recipe as the reference scenarios: GLO-30 at 30 m, bilinear to 65×65 at 37.5 m, "
                          "row 0 north, column 0 west."],
            }
            write_json(out_dir / "sites" / str(rank_no) / "grid.json", grid)
            sites.append({"rank": rank_no, "earthId": earth_id, "center": grid["center"], "index": index,
                          "searchIndex": cand["index"], "foundAtScaleMeters": cand["scaleMeters"], "metrics": metrics,
                          "gridPath": f"{base}/sites/{rank_no}/grid", "imagery": None, "roughness": None,
                          "climateContext": None})
            if len(sites) >= TOP_SITES:
                break
        if not sites:
            layer("terrainMetrics", "unavailable", reason="no candidate window could be rebuilt completely")
            manifest["status"] = "unavailable"
            manifest["finishedAt"] = utc_now()
            save()
            emit("done", "unavailable", "No complete micro-site window.")
            return manifest
        # Present by the authoritative same-scale index; keep ids stable (they name artefacts).
        sites.sort(key=lambda s: (-s["index"], s["rank"]))
        manifest["sites"] = sites
        layer("terrainMetrics", "ready", product=DEM_DATASET, resolution="65×65 at 37.5 m (2400 m)",
              message=f"{len(sites)} micro-sites rebuilt; best index {sites[0]['index']}.")

        def update_grid(site, **fields):
            path = out_dir / "sites" / str(site["rank"]) / "grid.json"
            grid = json.loads(path.read_text(encoding="utf-8"))
            for key, value in fields.items():
                if key == "roughness":
                    grid["metrics"]["roughness"] = value
                else:
                    grid[key] = value
            write_json(path, grid)

        detail = sites[:DETAIL_SITES]
        for name, fn, label in (("imagery", "imagery", "Sentinel-2 L2A"), ("sarRoughness", "roughness", "Sentinel-1 RTC"),
                                ("climateContext", "climate", "ERA5")):
            check()
            targets = detail if name != "climateContext" else sites
            layer(name, "running", message=f"{label} for {len(targets)} micro-sites.")
            ok, reasons = 0, []
            for site in targets:
                check()
                lat, lon = site["center"]
                try:
                    if name == "imagery":
                        jpg = out_dir / "sites" / str(site["rank"]) / "imagery.jpg"
                        meta = providers.imagery(lat, lon, jpg)
                        meta["path"] = f"{base}/sites/{site['rank']}/imagery.jpg"
                        site["imagery"] = meta
                        update_grid(site, imagery=meta)
                    elif name == "sarRoughness":
                        site["roughness"] = providers.roughness(lat, lon)
                        update_grid(site, roughness=site["roughness"])
                    else:
                        site["climateContext"] = providers.climate(lat, lon)
                        update_grid(site, climateContext=site["climateContext"])
                    ok += 1
                except LayerUnavailable as exc:
                    reasons.append(f"site {site['rank']}: {exc}")
                except Exception as exc:  # noqa: BLE001 - provider failure keeps the layer state visible
                    reasons.append(f"site {site['rank']}: {type(exc).__name__}")
                save()
            status = "ready" if ok == len(targets) else "partial" if ok else "unavailable"
            scope = f"{ok}/{len(targets)} micro-sites" + ("" if name == "climateContext" else f" (top {DETAIL_SITES} only)")
            layer(name, status, coverage=scope, reason="; ".join(reasons) or None, message=f"{label}: {scope}.")
        manifest["status"] = "ready"
        manifest["finishedAt"] = utc_now()
        save()
        emit("done", "ready", f"Analysis ready: {len(sites)} micro-sites, best index {sites[0]['index']}.")
        return manifest
    except Cancelled:
        manifest["status"] = "cancelled"
        manifest["finishedAt"] = utc_now()
        for name, value in manifest["layers"].items():
            if value["status"] in ("pending", "running"):
                manifest["layers"][name] = _layer("cancelled")
        save()
        emit("done", "cancelled", "Analysis cancelled.")
        return manifest
    except LayerUnavailable as exc:
        manifest["status"] = "unavailable"
        manifest["finishedAt"] = utc_now()
        save()
        emit("done", "unavailable", str(exc))
        return manifest
