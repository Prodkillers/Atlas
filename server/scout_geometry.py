"""Scout zone geometry: GeoJSON validation, extent and stable zone identity (docs/modules/scout.md).

GeoJSON positions are [longitude, latitude]; every value returned to the app contract uses
[latitude, longitude] (`center`). Areas and extents use a local equirectangular frame centred on the
zone, which is accurate to well under 1 % for the ≤ 25 km zones Scout accepts.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

EARTH_RADIUS_M = 6_371_008.8
WINDOW_M = 2400.0
MAX_SIDE_M = 25_000.0
MIN_AREA_KM2 = 0.05
MAX_VERTICES = 500
MIN_POINT_SEARCH_M = 2400.0
MAX_POINT_SEARCH_M = 12_000.0
MAX_ABS_LAT = 84.0


class GeometryError(ValueError):
    """The submitted geometry cannot become a Scout zone; the message is safe to show to users."""


def _finite_position(pos: Any) -> tuple[float, float]:
    if not isinstance(pos, (list, tuple)) or len(pos) < 2:
        raise GeometryError("Each position must be [longitude, latitude].")
    lon, lat = pos[0], pos[1]
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lon, lat)):
        raise GeometryError("Coordinates must be finite numbers.")
    if not -180 <= lon <= 180:
        raise GeometryError("Longitude must be within [-180, 180]; GeoJSON order is [longitude, latitude].")
    if not -MAX_ABS_LAT <= lat <= MAX_ABS_LAT:
        raise GeometryError(f"Latitude must be within ±{MAX_ABS_LAT:g}°; GeoJSON order is [longitude, latitude].")
    return float(lon), float(lat)


def extract_geometry(obj: Any) -> dict[str, Any]:
    """Accept a Geometry, Feature or single-feature FeatureCollection (the GeoJSON import formats)."""
    if not isinstance(obj, dict):
        raise GeometryError("GeoJSON must be an object.")
    kind = obj.get("type")
    if kind == "FeatureCollection":
        features = obj.get("features")
        if not isinstance(features, list) or len(features) != 1:
            raise GeometryError("Import exactly one feature (one point or one polygon).")
        return extract_geometry(features[0])
    if kind == "Feature":
        return extract_geometry(obj.get("geometry"))
    if kind in ("Point", "Polygon"):
        return obj
    if kind == "MultiPolygon":
        raise GeometryError("MultiPolygon is not supported: import one polygon per zone.")
    raise GeometryError("Supported geometry types are Point and Polygon.")


def _project(lon: float, lat: float, lon0: float, lat0: float) -> tuple[float, float]:
    k = math.cos(math.radians(lat0))
    return (math.radians(lon - lon0) * EARTH_RADIUS_M * k, math.radians(lat - lat0) * EARTH_RADIUS_M)


def _unproject(east: float, north: float, lon0: float, lat0: float) -> tuple[float, float]:
    k = math.cos(math.radians(lat0))
    return (lon0 + math.degrees(east / (EARTH_RADIUS_M * k)), lat0 + math.degrees(north / EARTH_RADIUS_M))


def _segments_cross(p1, p2, p3, p4) -> bool:
    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return 0 if abs(v) < 1e-18 else (1 if v > 0 else -1)
    o1, o2, o3, o4 = orient(p1, p2, p3), orient(p1, p2, p4), orient(p3, p4, p1), orient(p3, p4, p2)
    return o1 != o2 and o3 != o4 and 0 not in (o1, o2, o3, o4)


def _clean_ring(raw: Any) -> list[tuple[float, float]]:
    if not isinstance(raw, list):
        raise GeometryError("Polygon coordinates must be a list of rings.")
    ring = [_finite_position(p) for p in raw]
    if ring and ring[0] == ring[-1]:
        ring = ring[:-1]
    dedup: list[tuple[float, float]] = []
    for p in ring:
        if not dedup or p != dedup[-1]:
            dedup.append(p)
    if len(dedup) < 3:
        raise GeometryError("A polygon needs at least three distinct vertices.")
    if len(dedup) > MAX_VERTICES:
        raise GeometryError(f"A polygon may have at most {MAX_VERTICES} vertices.")
    lons = [p[0] for p in dedup]
    if max(lons) - min(lons) > 180:
        raise GeometryError("Zones crossing the antimeridian are not supported.")
    return dedup


def square_ring(lon: float, lat: float, side_m: float) -> list[tuple[float, float]]:
    h = side_m / 2
    return [_unproject(e, n, lon, lat) for e, n in ((-h, h), (h, h), (h, -h), (-h, -h))]


def normalize_zone(geojson: Any, search_meters: float | None = None) -> dict[str, Any]:
    """Validate and describe a zone. Points become a square search area of `search_meters` side."""
    geom = extract_geometry(geojson)
    if geom["type"] == "Point":
        lon, lat = _finite_position(geom.get("coordinates"))
        side = float(search_meters or WINDOW_M)
        if not MIN_POINT_SEARCH_M <= side <= MAX_POINT_SEARCH_M:
            raise GeometryError(f"Point search size must be {MIN_POINT_SEARCH_M:g}–{MAX_POINT_SEARCH_M:g} m.")
        ring = square_ring(lon, lat, side)
        input_kind, point = "point", [lat, lon]
    else:
        rings = geom.get("coordinates")
        if not isinstance(rings, list) or not rings:
            raise GeometryError("Polygon has no coordinates.")
        if len(rings) > 1:
            raise GeometryError("Polygons with holes are not supported.")
        ring = _clean_ring(rings[0])
        input_kind, point, side = "polygon", None, None

    lon0 = sum(p[0] for p in ring) / len(ring)
    lat0 = sum(p[1] for p in ring) / len(ring)
    xy = [_project(lon, lat, lon0, lat0) for lon, lat in ring]
    n = len(xy)
    for i in range(n):
        for j in range(i + 1, n):
            if abs(i - j) in (1, n - 1):
                continue
            if _segments_cross(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n]):
                raise GeometryError("The polygon outline crosses itself.")
    area2 = sum(xy[i][0] * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * xy[i][1] for i in range(n))
    area_m2 = abs(area2) / 2
    if area2 < 0:  # RFC 7946: exterior ring counter-clockwise
        ring, xy = ring[::-1], xy[::-1]
    # Area centroid, then extents measured around it.
    cx = sum((xy[i][0] + xy[(i + 1) % n][0]) * (xy[i][0] * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * xy[i][1])
             for i in range(n)) / (3 * abs(area2)) if area2 else 0.0
    cy = sum((xy[i][1] + xy[(i + 1) % n][1]) * (xy[i][0] * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * xy[i][1])
             for i in range(n)) / (3 * abs(area2)) if area2 else 0.0
    clon, clat = _unproject(cx, cy, lon0, lat0)
    if input_kind == "point":
        clat, clon = point
    xs, ys = [p[0] for p in xy], [p[1] for p in xy]
    ew, ns = max(xs) - min(xs), max(ys) - min(ys)
    if area_m2 / 1e6 < MIN_AREA_KM2:
        raise GeometryError(f"Zone area must be at least {MIN_AREA_KM2} km².")
    if max(ew, ns) > MAX_SIDE_M:
        raise GeometryError(f"Zone extent must be ≤ {MAX_SIDE_M / 1000:g} km on each side (got {max(ew, ns) / 1000:.1f} km).")
    coords = [[round(lon, 6), round(lat, 6)] for lon, lat in ring]
    start = coords.index(min(coords))       # canonical start vertex: same outline → same zone id
    coords = coords[start:] + coords[:start]
    coords.append(coords[0])
    geometry = {"type": "Polygon", "coordinates": [coords]}
    lons, lats = [c[0] for c in coords], [c[1] for c in coords]
    windows = max(1, math.floor(max(ew, WINDOW_M) / WINDOW_M)) * max(1, math.floor(max(ns, WINDOW_M) / WINDOW_M))
    return {
        "geometry": geometry,
        "input": {"kind": input_kind, "point": point, "searchMeters": side},
        "center": [round(clat, 6), round(clon, 6)],
        "bbox": [min(lons), min(lats), max(lons), max(lats)],
        "areaKm2": round(area_m2 / 1e6, 3),
        "extentMeters": {"eastWest": round(ew), "northSouth": round(ns)},
        "window": {"extentMeters": WINDOW_M, "gridSize": 65, "spacingMeters": 37.5},
        "approxDisjointWindows": windows,
        "scales": [s for s in (2400, 7200) if s == 2400 or min(ew, ns) >= s - 1],
    }


def zone_id(geometry: dict[str, Any]) -> str:
    """Stable `zone-<10 hex>` from the normalized polygon (valid as telemetry `site`)."""
    canon = json.dumps(geometry["coordinates"], separators=(",", ":"))
    return "zone-" + hashlib.sha256(canon.encode()).hexdigest()[:10]


def contains(ring_lonlat: list[list[float]], lon: float, lat: float) -> bool:
    """Even-odd point-in-polygon on the closed exterior ring ([lon, lat])."""
    inside = False
    pts = ring_lonlat[:-1] if ring_lonlat[0] == ring_lonlat[-1] else ring_lonlat
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside
