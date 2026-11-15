import json
import math

import httpx
import pytest
import respx

from server import forecast, main, scout_engine, telemetry, zones
from server.scout_geometry import GeometryError, contains, normalize_zone, zone_id

POLY = {"type": "Polygon", "coordinates": [[[-13.475, 29.145], [-13.415, 29.145], [-13.415, 29.195],
                                            [-13.475, 29.195], [-13.475, 29.145]]]}


def test_polygon_is_normalized_with_lat_lon_center_and_stable_id():
    info = normalize_zone({"type": "Feature", "geometry": POLY, "properties": {}})
    assert info["center"][0] == pytest.approx(29.17, abs=1e-3)
    assert info["center"][1] == pytest.approx(-13.445, abs=1e-3)
    assert info["bbox"] == [-13.475, 29.145, -13.415, 29.195]
    assert 5000 < info["extentMeters"]["eastWest"] < 6000 and 5000 < info["extentMeters"]["northSouth"] < 6000
    assert info["scales"] == [2400]
    zid = zone_id(info["geometry"])
    assert zid.startswith("zone-") and len(zid) == 15
    # The same outline drawn clockwise is the same zone.
    clockwise = {"type": "Polygon", "coordinates": [POLY["coordinates"][0][::-1]]}
    assert zone_id(normalize_zone(clockwise)["geometry"]) == zid


def test_point_becomes_square_search_area():
    info = normalize_zone({"type": "Point", "coordinates": [-70.1, -24.1]}, 4800)
    assert info["input"]["kind"] == "point" and info["center"] == [-24.1, -70.1]
    assert info["extentMeters"]["eastWest"] == pytest.approx(4800, abs=2)
    assert info["areaKm2"] == pytest.approx(23.04, rel=0.01)


@pytest.mark.parametrize("geojson,message", [
    ({"type": "Polygon", "coordinates": [[[29.1, -13.4], [29.2, -13.4], [29.2, 95], [29.1, -13.4]]]}, "Latitude"),
    ({"type": "Polygon", "coordinates": [[[0, 0], [0.1, 0.1], [0.1, 0], [0, 0.1], [0, 0]]]}, "crosses itself"),
    ({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}, "≤ 25 km"),
    ({"type": "Polygon", "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]]]}, "at least"),
    ({"type": "MultiPolygon", "coordinates": []}, "MultiPolygon"),
    ({"type": "FeatureCollection", "features": []}, "exactly one"),
    ({"type": "Point", "coordinates": [10, 10]}, None),
])
def test_invalid_geometries_are_rejected(geojson, message):
    if message is None:
        with pytest.raises(GeometryError):
            normalize_zone(geojson, 50_000)
        return
    with pytest.raises(GeometryError, match=message):
        normalize_zone(geojson)


def test_contains_even_odd():
    ring = POLY["coordinates"][0]
    assert contains(ring, -13.44, 29.17)
    assert not contains(ring, -13.40, 29.17)


# ------------------------------------------------------------------ offline pipeline
class FakeProviders:
    """Synthetic hills; mirrors the provider interface without network."""

    def __init__(self, dem_missing=False):
        self.dem_missing = dem_missing

    @staticmethod
    def _z(east, north):
        import numpy as np
        return 100 + 25 * np.sin(east / 900) * np.cos(north / 700) + 0.004 * east

    def to_geo(self, lat0, lon0):
        k = math.cos(math.radians(lat0))
        return lambda e, n: (lat0 + math.degrees(n / 6_371_008.8), lon0 + math.degrees(e / (6_371_008.8 * k)))

    def region_dem(self, lat, lon, n, spacing):
        if self.dem_missing:
            raise scout_engine.LayerUnavailable("server geospatial stack not installed (rasterio)")
        import numpy as np
        half = (n - 1) * spacing / 2
        axis = np.linspace(-half, half, n)
        east, north = np.meshgrid(axis, axis[::-1])
        return self._z(east, north), ["fake-tile"]

    def window_dem(self, lat, lon):
        return [round(100 + 20 * math.sin(c / 9) * math.cos(r / 7), 1) for r in range(65) for c in range(65)], ["fake"]

    def imagery(self, lat, lon, out_path):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"\xff\xd8\xff\xd9")
        return {"credit": "test", "acquired": "2026-01-01T00:00:00Z", "source": "test"}

    def roughness(self, lat, lon):
        raise scout_engine.LayerUnavailable("no Sentinel-1 RTC scene")

    def climate(self, lat, lon):
        return {"kind": "era5-climatology", "amplitudeK": 9.5}


@pytest.fixture
def store(tmp_path):
    pytest.importorskip("numpy")
    s = zones.ZoneStore(tmp_path / "scout", main.REPO_ROOT, providers=FakeProviders())
    zones.set_store(s)
    main.analysis_limiter.reset()
    yield s
    zones.set_store(None)


def _run(client, store, body=None):
    created = client.post("/api/zones", json={"geojson": POLY, "name": "Test zone", "source": {"kind": "user-drawn"}})
    assert created.status_code in (200, 201)
    zid = created.json()["id"]
    r = client.post(f"/api/zones/{zid}/analyses", json=body or {"targetId": "marius-hills", "operation": "mobility"})
    assert r.status_code == 202
    job = r.json()
    zones.wait_for(store.jobs[job["jobId"]])
    return zid, job


def test_zone_create_is_idempotent_and_listed(client, store):
    first = client.post("/api/zones", json={"geojson": POLY, "name": "A"})
    again = client.post("/api/zones", json={"geojson": POLY, "name": "B"})
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"] and again.json()["name"] == "A"
    assert [z["id"] for z in client.get("/api/zones").json()["zones"]] == [first.json()["id"]]
    assert client.get(f"/api/zones/{first.json()['id']}").json()["areaKm2"] > 0


def test_invalid_geometry_returns_message(client, store):
    r = client.post("/api/zones", json={"geojson": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1]]]}})
    assert r.status_code == 422 and r.json()["error"] == "invalid-geometry"


def test_analysis_produces_manifest_sites_grids_and_events(client, store):
    zid, job = _run(client, store)
    events = client.get(f"/api/jobs/{job['jobId']}/events").json()
    assert events["status"] == "ready"
    stages = [e["stage"] for e in events["events"]]
    assert stages[0] == "queued" and stages[-1] == "done" and "dem" in stages and "ranking" in stages
    later = client.get(f"/api/jobs/{job['jobId']}/events", params={"after": events["next"]}).json()
    assert later["events"] == []

    manifest = client.get(f"/api/zones/{zid}/revisions/1").json()
    assert manifest["status"] == "ready" and manifest["target"]["id"] == "marius-hills"
    assert 1 <= len(manifest["sites"]) <= 5
    assert manifest["layers"]["imagery"]["status"] == "ready"
    assert manifest["layers"]["sarRoughness"]["status"] == "unavailable"
    assert manifest["layers"]["forecast72h"]["status"] == "on-demand"
    assert manifest["layers"]["sarHistory"]["status"] == "absent"
    ring = POLY["coordinates"][0]
    assert all(contains(ring, lon, lat) for lat, lon, _ in manifest["affinity"]["cells"])

    site = manifest["sites"][0]
    grid = client.get(site["gridPath"]).json()
    assert grid["gridSize"] == 65 and len(grid["elevation"]) == 4225 and grid["spacingMeters"] == 37.5
    assert grid["id"] == f"{zid}-r1-s{site['rank']}" and grid["zone"]["revision"] == 1
    assert grid["climateContext"]["kind"] == "era5-climatology" and grid["thermal"] is None
    assert client.get(grid["imagery"]["path"]).status_code == 200

    scenario = client.get(f"/api/zones/{zid}/revisions/1/scenario", params={"site": site["rank"]}).json()
    assert scenario["earthId"] == grid["id"] and scenario["targetId"] == "marius-hills" and scenario["body"] == "moon"
    assert scenario["earth"] == site["gridPath"] and scenario["zone"]["geometry"] == POLY | {"coordinates": scenario["zone"]["geometry"]["coordinates"]}
    assert scenario["zone"]["link"] == f"index.html#zone={zid}&rev=1&site={site['rank']}"


def test_refresh_creates_new_revision(client, store):
    zid, _ = _run(client, store)
    _, job2 = _run(client, store, {"targetId": "jezero", "scales": [2400]})
    assert job2["revision"] == 2
    zone = client.get(f"/api/zones/{zid}").json()
    assert [r["targetId"] for r in zone["revisions"]] == ["marius-hills", "jezero"]
    assert client.get(f"/api/zones/{zid}/revisions/1").json()["target"]["id"] == "marius-hills"


def test_missing_dem_stack_is_declared_not_invented(client, store):
    store.providers = FakeProviders(dem_missing=True)
    zid, job = _run(client, store)
    manifest = client.get(f"/api/zones/{zid}/revisions/1").json()
    assert manifest["status"] == "unavailable" and manifest["sites"] == []
    assert "geospatial stack" in manifest["layers"]["dem"]["reason"]
    assert client.get(f"/api/zones/{zid}/revisions/1/scenario").status_code == 404


def test_cancel_marks_pending_layers(client, store, monkeypatch):
    created = client.post("/api/zones", json={"geojson": POLY}).json()
    real = scout_engine.run_analysis

    def cancelling(zone, revision, target, providers, out, emit, cancelled):
        job = next(iter(store.jobs.values()))
        job.cancel_requested = True
        return real(zone, revision, target, providers, out, emit, cancelled)
    monkeypatch.setattr(scout_engine, "run_analysis", cancelling)
    job = client.post(f"/api/zones/{created['id']}/analyses", json={"targetId": "shackleton"}).json()
    assert zones.wait_for(store.jobs[job["jobId"]]) == "cancelled"
    manifest = client.get(f"/api/zones/{created['id']}/revisions/1").json()
    assert manifest["layers"]["dem"]["status"] == "cancelled"
    assert client.post(f"/api/jobs/{job['jobId']}/cancel").json()["cancelRequested"] is True


def test_bad_ids_and_targets(client, store):
    assert client.get("/api/zones/../etc").status_code == 404
    assert client.get("/api/zones/zone-XYZ").status_code == 404
    assert client.get("/api/jobs/job-nope/events").status_code == 404
    zid = client.post("/api/zones", json={"geojson": POLY}).json()["id"]
    assert client.post(f"/api/zones/{zid}/analyses", json={"targetId": "olympus-mons"}).status_code == 422
    assert client.get(f"/api/zones/{zid}/revisions/1/sites/9/grid").status_code == 404


def test_scout_data_dir_is_not_served(client, store):
    assert client.get("/.scout/zones").status_code == 404


@respx.mock
def test_zone_telemetry_never_borrows_nearby_snapshot(client):
    respx.get(telemetry.OPEN_METEO_URL).mock(return_value=httpx.Response(500))
    r = client.get("/api/telemetry", params={"lat": -24.102, "lon": -70.138, "site": "zone-0123456789-r1-s1"})
    assert r.status_code == 503
    # Reference sites keep their archive.
    assert client.get("/api/telemetry", params={"lat": -24.102, "lon": -70.138, "site": "atacama"}).status_code == 200


def test_zone_forecast_never_borrows_nearby_snapshot(tmp_path, monkeypatch):
    snap = tmp_path / "f.json"
    snap.write_text(json.dumps({"atacama": {"lat": -24.1, "lon": -70.14, "hours": []}}))
    svc = forecast.ForecastService(snap)
    assert svc._from_snapshot("zone-0123456789-r1-s1", -24.1, -70.14) is None
    assert svc._from_snapshot("atacama", -24.1, -70.14) is not None
