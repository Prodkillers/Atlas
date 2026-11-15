"""Scout zone registry, analysis jobs and API routes (docs/modules/scout.md, docs/contracts.md §3).

A zone is a validated user geometry with a stable `zone-<hash>` id. Each analysis creates a numbered
revision whose artefacts (manifest, micro-site grids, imagery) never change afterwards; "refresh data"
creates a new revision. Storage is a directory (SCOUT_DATA_DIR); on an ephemeral host it lasts as long
as the instance.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import scout_engine
from .scout_geometry import GeometryError, normalize_zone, zone_id

TARGET_IDS = ("marius-hills", "shackleton", "jezero", "valles-marineris")
TARGET_BODY = {"marius-hills": "moon", "shackleton": "moon", "jezero": "mars", "valles-marineris": "mars"}
OPERATIONS = ("general", "mobility", "sampling", "drilling", "habitat")
ZONE_PATTERN = r"^zone-[0-9a-f]{10}$"
ZONE_RE = re.compile(ZONE_PATTERN)
JOB_RE = re.compile(r"^job-[0-9a-f]{12}$")
MAX_EVENTS = 500
MAX_LIST = 50


def _utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _default_dir(repo_root: Path) -> Path:
    configured = os.environ.get("SCOUT_DATA_DIR")
    if configured:
        return Path(configured)
    candidate = repo_root / ".scout"       # dot-directory: never served by SafeStaticFiles
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        probe = candidate / ".write-probe"
        probe.write_text("ok")
        probe.unlink()
        return candidate
    except OSError:
        return Path(tempfile.gettempdir()) / "selene-scout"


class Job:
    def __init__(self, job_id: str, zone_id_: str, revision: int) -> None:
        self.id, self.zone_id, self.revision = job_id, zone_id_, revision
        self.status = "queued"
        self.events: list[dict[str, Any]] = []
        self.cancel_requested = False
        self.lock = threading.Lock()

    def emit(self, stage: str, status: str, message: str, data: dict[str, Any] | None = None) -> None:
        with self.lock:
            event = {"seq": len(self.events) + 1, "at": _utc(), "stage": stage, "status": status, "message": message}
            if data:
                event["data"] = data
            if len(self.events) < MAX_EVENTS or stage == "done":
                self.events.append(event)
            if stage == "done":
                self.status = status

    def snapshot(self, after: int) -> dict[str, Any]:
        with self.lock:
            events = [e for e in self.events if e["seq"] > after]
            return {"jobId": self.id, "zoneId": self.zone_id, "revision": self.revision, "status": self.status,
                    "cancelRequested": self.cancel_requested, "events": events,
                    "next": events[-1]["seq"] if events else after}


class ZoneStore:
    def __init__(self, root: Path, repo_root: Path, providers=None, workers: int = 2) -> None:
        self.root = root
        self.repo_root = repo_root
        self.providers = providers
        self.jobs: dict[str, Job] = {}
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="scout")

    # ---- paths
    def zone_dir(self, zid: str) -> Path:
        return self.root / "zones" / zid

    def revision_dir(self, zid: str, rev: int) -> Path:
        return self.zone_dir(zid) / "revisions" / str(rev)

    def get_providers(self):
        if self.providers is None:
            self.providers = scout_engine.PlanetaryComputerProviders(self.root / "cache")
        return self.providers

    # ---- zones
    def load(self, zid: str) -> dict[str, Any] | None:
        if not ZONE_RE.match(zid):
            return None
        path = self.zone_dir(zid) / "zone.json"
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def save(self, zone: dict[str, Any]) -> None:
        scout_engine.write_json(self.zone_dir(zone["id"]) / "zone.json", zone)

    def create(self, geojson: Any, name: str | None, search_meters: float | None,
               source: dict[str, Any] | None) -> tuple[dict[str, Any], bool]:
        info = normalize_zone(geojson, search_meters)
        zid = zone_id(info["geometry"])
        with self.lock:
            existing = self.load(zid)
            if existing:
                return existing, False
            lat, lon = info["center"]
            zone = {"id": zid, "name": (name or "").strip()[:80] or f"Zone {lat:.3f}, {lon:.3f}",
                    "createdAt": _utc(), "source": source or {"kind": "user-drawn"}, **info, "revisions": []}
            self.save(zone)
            return zone, True

    def list(self) -> list[dict[str, Any]]:
        base = self.root / "zones"
        if not base.exists():
            return []
        zones = [z for z in (self.load(p.name) for p in base.iterdir() if p.is_dir()) if z]
        zones.sort(key=lambda z: z.get("createdAt", ""), reverse=True)
        return [summary(z) for z in zones[:MAX_LIST]]

    # ---- analyses
    def start(self, zid: str, target_id: str, operation: str, scales: list[int]) -> dict[str, Any] | None:
        with self.lock:
            zone = self.load(zid)
            if not zone:
                return None
            allowed = [s for s in scales if s in zone["scales"]] or [2400]
            rev = len(zone["revisions"]) + 1
            job = Job(f"job-{uuid.uuid4().hex[:12]}", zid, rev)
            target_path = f"assets/data/scenarios/targets/{target_id}.json"
            revision = {"revision": rev, "targetId": target_id, "targetPath": target_path, "body": TARGET_BODY[target_id],
                        "operation": operation, "scales": sorted(set(allowed)), "jobId": job.id, "status": "queued",
                        "createdAt": _utc(), "finishedAt": None}
            zone["revisions"].append(revision)
            self.save(zone)
            self.jobs[job.id] = job
        job.emit("queued", "queued", f"Revision {rev} queued: {target_id}, {', '.join(map(str, revision['scales']))} m.")
        self.pool.submit(self._run, job, zone, revision)
        return {"jobId": job.id, "zoneId": zid, "revision": rev, "status": "queued",
                "eventsUrl": f"/api/jobs/{job.id}/events", "manifestUrl": f"/api/zones/{zid}/revisions/{rev}"}

    def _finish(self, zid: str, rev: int, status: str) -> None:
        with self.lock:
            zone = self.load(zid)
            if not zone:
                return
            for r in zone["revisions"]:
                if r["revision"] == rev:
                    r["status"], r["finishedAt"] = status, _utc()
            self.save(zone)

    def _run(self, job: Job, zone: dict[str, Any], revision: dict[str, Any]) -> None:
        job.status = "running"
        rev = revision["revision"]
        out = self.revision_dir(zone["id"], rev)
        try:
            target = json.loads((self.repo_root / revision["targetPath"]).read_text(encoding="utf-8"))
            manifest = scout_engine.run_analysis(zone, revision, target, self.get_providers(), out, job.emit,
                                                 lambda: job.cancel_requested)
            status = manifest["status"]
        except Exception as exc:  # noqa: BLE001 - surface the failure as a job state, never a hung job
            status = "failed"
            scout_engine.write_json(out / "manifest.json", {"version": 1, "zoneId": zone["id"], "revision": rev,
                                                            "status": "failed", "error": type(exc).__name__,
                                                            "finishedAt": _utc(), "layers": {}, "sites": []})
            job.emit("done", "failed", f"Analysis failed ({type(exc).__name__}: {str(exc)[:200]}).")
        self._finish(zone["id"], rev, status)

    def manifest(self, zid: str, rev: int) -> dict[str, Any] | None:
        if not ZONE_RE.match(zid):
            return None
        try:
            return json.loads((self.revision_dir(zid, rev) / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None


def summary(zone: dict[str, Any]) -> dict[str, Any]:
    return {k: zone.get(k) for k in ("id", "name", "createdAt", "source", "center", "bbox", "areaKm2",
                                     "extentMeters", "input", "scales", "geometry", "revisions")}


def scenario_for(zone: dict[str, Any], manifest: dict[str, Any], rank: int) -> dict[str, Any] | None:
    """Mission Control scenario object for one micro-site (same fields as assets/data/scenarios.json)."""
    site = next((s for s in manifest.get("sites") or [] if s["rank"] == rank), None)
    if not site:
        return None
    target = manifest["target"]
    rev = manifest["revision"]
    return {
        "id": f"{site['earthId']}--{target['id']}",
        "title": f"Scout zone · {zone['name']}",
        "earthId": site["earthId"], "targetId": target["id"], "body": target["body"],
        "focus": f"User-traced Earth zone matched to {target.get('name') or target['id']} "
                 f"(operation: {manifest.get('operation') or 'general'}). Geometric index {site['index']}; "
                 "absent layers stay marked as absent.",
        "earth": site["gridPath"], "target": target["path"],
        "earthLabel": f"{zone['name']} · micro-site {site['rank']}",
        "targetLabel": (target.get("name") or target["id"]).split(" · ")[0],
        "zone": {"id": zone["id"], "revision": rev, "rank": site["rank"], "name": zone["name"],
                 "geometry": zone["geometry"], "center": zone["center"], "areaKm2": zone["areaKm2"],
                 "source": zone.get("source"), "operation": manifest.get("operation"),
                 "manifestUrl": f"/api/zones/{zone['id']}/revisions/{rev}",
                 "layers": {k: v.get("status") for k, v in (manifest.get("layers") or {}).items()},
                 "link": f"index.html#zone={zone['id']}&rev={rev}&site={site['rank']}"},
    }


# --------------------------------------------------------------------------- API
class ZoneRequest(BaseModel):
    geojson: dict[str, Any]
    name: str | None = Field(default=None, max_length=80)
    searchMeters: float | None = Field(default=None, ge=2400, le=12000, allow_inf_nan=False)
    source: dict[str, str] | None = None


class AnalysisRequest(BaseModel):
    targetId: Literal["marius-hills", "shackleton", "jezero", "valles-marineris"]
    operation: Literal["general", "mobility", "sampling", "drilling", "habitat"] = "general"
    scales: list[Literal[2400, 7200]] = Field(default_factory=lambda: [2400, 7200], min_length=1, max_length=2)


def build_router(get_store, limiter, client_ip) -> APIRouter:
    router = APIRouter(prefix="/api")

    def not_found():
        return JSONResponse(status_code=404, content={"error": "not-found"})

    @router.get("/scout/health")
    async def scout_health():
        missing = scout_engine.missing_geo_modules()
        return {"status": "ok", "dem": "unavailable" if missing else "available", "missingModules": missing,
                "targets": list(TARGET_IDS), "operations": list(OPERATIONS)}

    @router.post("/zones")
    async def create_zone(body: ZoneRequest):
        source = None
        if body.source:
            kind = body.source.get("kind")
            if kind not in ("user-drawn", "user-point", "geojson-import", "discovery-candidate"):
                return JSONResponse(status_code=422, content={"error": "invalid-input", "fields": ["source.kind"]})
            source = {"kind": kind, **({"ref": body.source["ref"][:80]} if body.source.get("ref") else {})}
        try:
            zone, created = get_store().create(body.geojson, body.name, body.searchMeters, source)
        except GeometryError as exc:
            return JSONResponse(status_code=422, content={"error": "invalid-geometry", "message": str(exc)})
        return JSONResponse(status_code=201 if created else 200, content={**summary(zone), "created": created})

    @router.get("/zones")
    async def list_zones():
        return {"zones": get_store().list()}

    @router.get("/zones/{zid}")
    async def get_zone(zid: str):
        zone = get_store().load(zid)
        return summary(zone) if zone else not_found()

    @router.post("/zones/{zid}/analyses")
    async def start_analysis(zid: str, body: AnalysisRequest, request: Request):
        store = get_store()
        if not store.load(zid):
            return not_found()
        if not limiter.allow(client_ip(request)):
            return JSONResponse(status_code=429, content={"error": "rate-limited"}, headers={"Retry-After": "60"})
        return JSONResponse(status_code=202, content=store.start(zid, body.targetId, body.operation, list(body.scales)))

    @router.get("/jobs/{job_id}/events")
    async def job_events(job_id: str, after: int = Query(0, ge=0)):
        job = get_store().jobs.get(job_id) if JOB_RE.match(job_id) else None
        return job.snapshot(after) if job else not_found()

    @router.post("/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str):
        job = get_store().jobs.get(job_id) if JOB_RE.match(job_id) else None
        if not job:
            return not_found()
        job.cancel_requested = True
        return {"jobId": job.id, "status": job.status, "cancelRequested": True}

    @router.get("/zones/{zid}/revisions/{rev}")
    async def get_manifest(zid: str, rev: int):
        manifest = get_store().manifest(zid, rev)
        return manifest or not_found()

    @router.get("/zones/{zid}/revisions/{rev}/sites/{rank}/grid")
    async def get_grid(zid: str, rev: int, rank: int):
        store = get_store()
        if not ZONE_RE.match(zid) or not 1 <= rank <= scout_engine.TOP_SITES:
            return not_found()
        path = store.revision_dir(zid, rev) / "sites" / str(rank) / "grid.json"
        if not path.is_file():
            return not_found()
        return JSONResponse(content=json.loads(path.read_text(encoding="utf-8")))

    @router.get("/zones/{zid}/revisions/{rev}/sites/{rank}/imagery.jpg")
    async def get_imagery(zid: str, rev: int, rank: int):
        store = get_store()
        if not ZONE_RE.match(zid) or not 1 <= rank <= scout_engine.TOP_SITES:
            return not_found()
        path = store.revision_dir(zid, rev) / "sites" / str(rank) / "imagery.jpg"
        if not path.is_file():
            return not_found()
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    @router.get("/zones/{zid}/revisions/{rev}/scenario")
    async def get_scenario(zid: str, rev: int, site: int = Query(1, ge=1, le=scout_engine.TOP_SITES)):
        store = get_store()
        zone, manifest = store.load(zid), store.manifest(zid, rev)
        if not zone or not manifest:
            return not_found()
        scenario = scenario_for(zone, manifest, site)
        return scenario or not_found()

    return router


_store: ZoneStore | None = None


def get_store_factory(repo_root: Path):
    def get_store() -> ZoneStore:
        global _store
        if _store is None:
            _store = ZoneStore(_default_dir(repo_root), repo_root)
        return _store
    return get_store


def set_store(store: ZoneStore | None) -> None:
    """Tests replace the store (temporary directory, offline providers)."""
    global _store
    _store = store


def wait_for(job: Job, timeout: float = 10.0) -> str:
    """Test helper: block until the job reaches a terminal state."""
    end = time.monotonic() + timeout
    while time.monotonic() < end and job.status in ("queued", "running"):
        time.sleep(0.02)
    return job.status
