# S.E.L.E.N.E. Scout · Trace your analogue

Scout turns a user-drawn Earth zone into a mission the rest of the console can evaluate. It implements
section 4–6 of the team plan ([revision-propuesta-y-referentes-2025.md](../product/revision-propuesta-y-referentes-2025.md)).
Page: `scout.html` (`src/scout/`). Backend: `server/zones.py`, `server/scout_engine.py`, `server/scout_geometry.py`.

## Flow

1. **Trace.** On the map, mark a **point** (a 2.4–12 km square search area around it), **draw** a polygon, or
   import **GeoJSON** (one `Point` or `Polygon`, `[longitude, latitude]`). Before anything runs, the preview
   shows centre, area, extent, the number of disjoint 2400 m windows, the search scales, and validation errors.
   The backend repeats the same validation (`scout_geometry.normalize_zone`). A test checks that the JS
   preview and the server agree.
2. **Connect.** Choose the target (Marius Hills, Shackleton rim, Jezero, Valles Marineris), the operation, and the
   search scales (7200 m only when the zone is at least 7.2 km on its shorter side).
3. **Analyse.** `POST /api/zones` stores the zone. `POST /api/zones/{id}/analyses` creates a **revision** and
   returns a `jobId`. The page polls `GET /api/jobs/{jobId}/events` and re-reads the revision manifest. Each
   layer shows its state, product, coverage and reason. Nothing is shown as a percentage of completion.
4. **Activate.** Each micro-site has **Activate mission**, which links to
   `index.html#zone=<id>&rev=<n>&site=<rank>`. Mission Control fetches the scenario from the API, adds it to
   the destination list (labelled `SCOUT ZONE`) and opens it. `scenarios.json` is not edited. The same link
   reopens the analysis later; `scout.html#zone=<id>&rev=<n>` reopens it in Scout, with no earlier browser
   session needed.
5. **Update data** creates a new revision. Earlier revisions and their artefacts are never overwritten.

Discovery candidates have **Trace zone in Scout** (`scout.html#lat=…&lon=…&target=…&from=<candidateId>`), which
pre-fills a point zone. The zone then records `source.kind = "discovery-candidate"` and keeps the candidate id.

## Terrain recipe (same as the reference scenarios)

- DEM: Copernicus GLO-30 (Planetary Computer `cop-dem-glo-30`), bilinear to 37.5 m in a local azimuthal
  equidistant frame centred on the zone (row 0 north, column 0 west). Nodes at or below 0 m are treated as
  sea and excluded. Windows with sea or nodata are never ranked.
- Search: `scripts/analog_match.py` (`window_metrics`, `index_field`, `rank`) over every 2400 m window whose
  **centre** lies inside the polygon. The drawn shape is not forced into a single grid. At 7200 m the region is
  block-averaged to 112.5 m (65 nodes per window) and compared with the 2400 m target window, to find
  landform-scale matches.
- Every micro-site is then **rebuilt as a standard 2400 m grid** (GLO-30 at 30 m → 65×65 at 37.5 m, the
  `fetch-scenarios-earth.py` recipe). Its metrics come from `scripts/terrain_metrics.py`, and it is scored again
  with `geometric_index`. That is the same number `similarity.mjs` shows. `searchIndex` keeps the search-grid
  value.
- Affinity map: the geometric index of the 2400 m window centred on each search cell inside the zone.

## Layers and absences

| Layer | Source | State when missing |
| --- | --- | --- |
| `dem`, `ranking`, `terrainMetrics` | GLO-30 | `unavailable` with reason (no geospatial stack, no coverage, all sea) |
| `imagery` | Sentinel-2 L2A, clear complete scene ≤ 400 days, top 3 micro-sites | `partial` / `unavailable` |
| `sarRoughness` | Sentinel-1 RTC mean γ0 dB, top 3 micro-sites (proxy; not compared with Moon CPR) | `partial` / `unavailable` |
| `climateContext` | ERA5 via Open-Meteo archive: diurnal 2 m air amplitude and aridity. **Context only**: not in the index, not `thermal` | `partial` / `unavailable` |
| `forecast72h` | Live by coordinates when the mission opens | `on-demand`. The backend **never** substitutes a nearby site's archived telemetry or forecast for a `zone-*` site (`telemetry._snapshot_reading`, `forecast._from_snapshot`) |
| `sarHistory`, `subsurface`, `materials`, `hazards` | not generated for zones | `absent` with an explicit reason |

In Mission Control a zone uses its own grid, weather and forecast. The 12-month radar history shows *not
published for this site*. M2 uses the base profile of the reference destination with the same target
(`getMissionBaseProfile`).

## Identity, storage and exports

- Zone id: `zone-<sha256(normalized polygon)[:10]>`. The same outline gives the same zone, whatever the drawing
  direction or start vertex.
- Micro-site Earth id: `zone-<hash>-r<revision>-s<rank>`. It is valid as `telemetry.site` (`SITE_PATTERN`) and
  unique per revision, so caches never mix revisions.
- Storage: `SCOUT_DATA_DIR`, by default `.scout/` in the repository. It is a dot-directory, so it is never served
  and is git-ignored. If that directory is not writable, the system temp directory is used. On an ephemeral
  host such as Cloud Run, zones last as long as the instance unless `SCOUT_DATA_DIR` points to a mounted volume.
- `CandidateAnalogPayload` v1.0.0 keeps its fields. When the scenario comes from Scout, `scenario.zone`
  (`id`, `revision`, `rank`, `geometry`, `source`, `manifestUrl`) is added. The mission JSON export adds
  `scenario.zone` as well.

## Optional dependencies

The analysis needs `numpy`, `rasterio`, `pyproj`, `pystac-client`, `planetary-computer` and `Pillow`
(`server/requirements-scout.txt`). Without them, `/api/scout/health` reports `dem: unavailable`. Zones are still
validated and stored, and every analysis records the DEM layer as unavailable with the missing modules. The
production `Dockerfile` installs only `server/requirements.txt`. Enabling Scout analyses in production is a
deployment decision: install `requirements-scout.txt` in the image. `.dockerignore` already ships
`scripts/terrain_metrics.py` and `scripts/analog_match.py`, which the engine imports.

Rate limit: `SCOUT_ANALYSIS_RATE_PER_MIN` (default 4 per IP) and `SCOUT_ANALYSIS_GLOBAL_RATE_PER_MIN` (20).
Zones are at most 25 km per side and 500 vertices. Two analysis workers run at a time.

## Limits

- The index compares terrain geometry only: it does not reproduce gravity, regolith, illumination or chemistry.
- Micro-sites are proposals for further investigation, not verified field-test sites. No literature or novelty
  check is made.
- 37.5 m nodes do not resolve rocks, cave entrances or rover-scale clearance.
- Cancelling stops the job between stages and between micro-sites. A provider read already in progress
  finishes first.
