# A.R.E.S. Twin · Analog Atlas

A Mission Control console for characterizing Earth analogues and preparing Moon/Mars exploration methods: real terrain, Earth field expeditions, a simulated rover, source-labelled current or archived weather-model context, geometric comparisons and a Flight Director copilot.

**V2.0:** 14 documented sites plus **4 twin scenarios** with real elevation at the same scale (65×65 nodes every 37.5 m, 2.4 km window). The catalog ranking remains documentary and **the scenario index is geometric, not a planetary-similarity percentage**.

Independent prototype for the [NASA Space Apps 2026 challenge](https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/). It does not imply NASA affiliation or endorsement.

> Spanish version: [README.es.md](README.es.md).

## S.E.L.E.N.E. Scout · trace your analogue

`scout.html` lets you mark a point, draw an area (≤ 25 km per side) or import GeoJSON, pick a Moon/Mars target and operation, and run a server analysis. The analysis ranks 2400 m micro-sites inside the zone with the same GLO-30 terrain recipe and geometric index as the scenarios, and returns an affinity map, Sentinel-2/Sentinel-1/ERA5 layers with their states, and an **Activate mission** link that opens the micro-site in Mission Control (`index.html#zone=…&rev=…&site=…`). Each analysis is a saved revision; missing layers are marked absent instead of borrowed from a nearby site. Requires the FastAPI backend; analyses need the optional `server/requirements-scout.txt`. See [Scout](docs/modules/scout.md).

## Earth field expeditions

**Terrain 3D prepares an evidence-backed reconnaissance plan.** Choose a catalogue site or one of the four paired Earth windows, select a mobility, sampling or shelter-reconnaissance objective, set a conceptual payload and assumed constraints, and edit inspection stops on the actual DEM. Review and confirm the plan, then drive the rover in Auto or Manual and explicitly inspect each reached stop.

The resulting JSON/Markdown report distinguishes complete and partial coverage, preserves site/session/source/scale and observations, explains the available topographic analogy and its breakdowns, and identifies the next field validation. Weather remains site/window context; DEM interpolation and illustrative SIM energy are labelled. Destination preparation, landing, M2 reports, Discovery and Mission Dossier retain their separate purposes. See [controls, model and evidence](docs/modules/earth-expedition.md) and the [shared contracts](docs/contracts.md#earth-expedition-domain).

## A.R.E.S. scenarios

| Scenario | Earth (DEM · imagery · radar) | Target (DEM · thermal) | Geometric index |
| --- | --- | --- | --- |
| Lava tube | La Corona (Lanzarote) · GLO-30 · S2 L2A · S1 RTC | Marius Hills · Kaguya TC 33 m · Diviner | 72 |
| Shadowed polar crater | Wright Valley · GLO-30 · S2 L2A · S1 RTC (HH) | Shackleton · LOLA 5 m · Diviner + Mini-RF | 97 |
| Hyperarid plain | Atacama · GLO-30 · S2 L2A · S1 RTC | Jezero · HiRISE 1 m · Mars Climate Database (model) | 82 |
| Wind-eroded canyon | Wadi Rum · GLO-30 · S2 L2A · S1 RTC | Valles Marineris (Coprates) · CTX 20 m · MCD (model) | 83 |

The index (0–100) combines p50 slope (0.30), p90 slope (0.25), p95–p5 relief (0.20) and mean TRI (0.15) using `100·smaller/larger` per component; roughness (0.10) is only included when both sides measure it in the same unit. Earth centers are chosen with `scripts/analog_match.py` (same recipe, §1.1 of the contracts). Details in `similarity.mjs`, sources in [docs/qa/targets-sources.md](docs/qa/targets-sources.md) and contracts in [docs/contracts.md](docs/contracts.md).

## Running the demo

**One command for API and web**, from `Atlas`:

```bash
npm run dev
```

Open [localhost:8000](http://localhost:8000) for the web app, [health API](http://localhost:8000/api/health) and [API docs](http://localhost:8000/api/docs). From the parent folder use `npm --prefix Atlas run dev`. Use `npm run dev -- --port 8027` for another port; `npm start` serves the same app without reload.

The launcher detects `.venv`, `.venv-server`, or `ATLAS_PYTHON`. If dependencies are missing it prepares `.venv-server` from the existing requirements; the first setup needs network access. It loads the local environment file when present without displaying its contents. Open-Meteo and local copilot rules work without an AI key. `Ctrl+C` stops the server.

For reproducible setup with **mise**, manual virtual-environment activation, optional AI providers, Docker and Cloud Run, see [the mise guide](docs/ejecucion-mise.md) and [backend setup](server/README.md).

**Static mode without the API:** `npm run start:static -- 8028`, [localhost:8028](http://localhost:8028). Weather comes from the archive and keeps its date; it is not labelled as current. Calculations and Excel work locally.

1. **Explorer:** choose a profile and a site, click “Start mission” and drive the rover (WASD or the pad; autonomous mode by default).
2. **A.R.E.S. scenarios:** choose a scenario to see Earth | Target side by side with the same camera. Below: compared telemetry, rover physics, geometric index and Flight Director.
3. **Module 2 · Automatic tracking:** choose a scenario without filling in fields; the shared prototype configuration (350 kg) and the scenario sources feed the 3D bench, matrix and calibration. Start the rover to record samples every 10 s; download a real 12-sheet Excel workbook with history, tools, provenance and limits, plus JSON/Markdown. The optional manual lab is isolated from the report. [Usage, formulas and limits](docs/modules/modulo-2.md).
4. **Rover feed:** ⛶ button (or the F key) in the 3D view: full screen with a rover-camera look, Chase / Mast / Orbital cameras (C key), heading, artificial horizon and telemetry. It is a **simulated feed**: there is no real link to any rover.
5. **Active processes · 72 h test window (Module 3):** in scenario mode, panel 09 crosses the hourly forecast (Meteomatics or Open-Meteo) with the target's diurnal curve (LRO Diviner or Mars Climate Database) and marks at which local hour the analogue replicates the **shape** of heating or cooling, when sand **saltation** occurs (the process behind Martian dust storms) and rapid **freezing** crossings; it adds 12 months of surface change from Sentinel-1 radar. Absolute temperatures and intensities do not match: shape, phase and process are compared.

## 3D bench and NASA collection

When a scenario is chosen, the M2 bench connects the Earth/target/support weight arrows to the automatic mission configuration and its references. It keeps the original mass and the test mass separately; the reduced mass changes inertia. Wheel and drill use explicit Atlas schematics. Models never provide scientific parameters.

**Explore Moon and Mars models and targets**, below M2, opens seven local assets with a fact sheet and attribution: Scarecrow, Perseverance, Moon, Mars, LRO, Block Island and Apollo 11. The cartographic globes use official equirectangular textures separate from the GLBs; their markers open the four existing scenarios. The Apollo 11 terrain carries Z×60 and is excluded from slopes; Block Island is a synthetic scene independent of Jezero/Earth.

Drag the scene or use the arrows, `+`/`−` and `Home` on its focused canvas. Ambient rotation is optional and respects reduced motion. Models load on demand; on failure there are schematics/fact sheets and accessible values. [M2 usage and limits](docs/modules/modulo-2.md#banco-visual-3d-y-explorador-nasa), [asset preparation and credits](docs/modules/nasa-assets.md), [visual evidence](docs/evidencias/nasa-3d/).

M2 preview with backend: [localhost:8027](http://localhost:8027), command `npm start -- --port 8027` from `Atlas`. The previous static preview on 8016 is kept. Leave the server terminal open while reviewing. [Real Excel and evidence](docs/evidencias/m2-automatico/).

## Data and regeneration

| Script | Output | Source |
| --- | --- | --- |
| `scripts/fetch-terrain.py` | 9×9 DEM + imagery for 14 sites | Copernicus GLO-90 (Open-Meteo), EOxCloudless 2024 |
| `scripts/fetch-scenarios-earth.py` | `assets/data/scenarios/earth/*` | Planetary Computer STAC: cop-dem-glo-30, sentinel-2-l2a, sentinel-1-rtc |
| `scripts/prefilter-regions.py` | `assets/data/discovery/regions-<targetId>.json` | Coarse global region prefilter (Open-Meteo Elevation · GLO-90) |
| `scripts/discover-analogs.py` | `assets/data/discovery/<targetId>.json` | Multi-scale refinement with JAXA ALOS World 3D-30m (AW3D30, Planetary Computer `alos-dem`) + thermal/aridity context (Open-Meteo ERA5) |
| `scripts/fetch-targets.py` | `assets/data/scenarios/targets/*` | PGDA LOLA, USGS Astrogeology (Kaguya TC, HiRISE, CTX), PDS Diviner and Mini-RF, Mars Climate Database |
| `python -m server.snapshot` | `assets/data/telemetry-snapshot.json` | Open-Meteo |
| `python -m server.forecast_snapshot` | `assets/data/processes-forecast-snapshot.json` (72 h per site) | Open-Meteo |
| `scripts/fetch-process-history.py` | `assets/data/processes/*` (Sentinel-1, 12 months) | Planetary Computer sentinel-1-rtc, Open-Meteo Archive |

Terrain metrics are always computed with `scripts/terrain_metrics.py`. `.venv-*` environments are not committed.

### Discovering analogues

The two-stage search uses `.venv-data`: a **coarse global prefilter** selects regions, then **fine refinement** scans them at multiple scales and adds climate context (thermal amplitude and aridity).

```bash
# 1) Prefilter: scan continental belts and rank regions for refinement
.venv-data/bin/python scripts/prefilter-regions.py marius-hills --step 1.0 --top-regions 6
# 2) Refine: scan selected regions with JAXA AW3D30, multiple scales + ERA5, diverse Top-N
.venv-data/bin/python scripts/discover-analogs.py marius-hills --region auto --scales 2400,7200 --top 5 --min-distance-km 25 --max-per-region 2
# Alternative: choose a declared region; --limit bounds the scan to measure coverage and latency
.venv-data/bin/python scripts/discover-analogs.py marius-hills --region centroamerica-volcanic --limit 20
.venv-data/bin/python scripts/discover-analogs.py --self-check   # runs without pyproj
```

Outputs are written to `assets/data/discovery/`; resumable per-cell cache lives in `$XDG_CACHE_HOME/ares-twin-discovery/` (default `~/.cache`). `--force` recomputes cached cells. Open the panel at `discovery.html`. The authoritative scoring DEM is JAXA ALOS World 3D-30m (AW3D30), served without authentication through Planetary Computer `alos-dem`; the coarse prefilter remains Open-Meteo GLO-90, and the catalog scenario twins remain Copernicus GLO-30. The exploratory index compares geometry (slope/relief/TRI) **and thermal amplitude**; aridity is Earth-side context and is not scored against Moon or Mars. Candidates are not published field-test sites. Thermal amplitude compares diurnal air temperature (ERA5) with surface temperature (Diviner/MCD): it is a proxy, not a claim of physical equivalence. AW3D30 uses EGM96 and Copernicus uses EGM2008; that vertical-datum difference is effectively constant and sub-meter across a 2.4 km window, so it does not materially affect relative terrain metrics.

## How it is calculated

| Profile | Criteria and weights |
| --- | --- |
| Mars · Dunes | Dune field (50), dry environment (20), crescent dunes (20), mobility tests (10) |
| Moon · Rocky terrain | Rocky surface (35), irregular relief (30), volcanic terrain (15), long-shadow testing (15), dry environment (5) |
| Mars · Sampling | Documented hyperaridity (55), dry environment (15), documented drilling (30) |

For each site the weights of the recorded tags are added up. A criterion with no data in the fact sheet adds zero, **without claiming the attribute is absent**. Ties favor a precedent for the profile and then the name, with Spanish collation. There is no randomness. The configuration is at the top of `app.js`; `createRanking` and `readCriteria` are the same functions used by the interface and the tests.

The weights are prototype decisions, not parameters calibrated against Mars or the Moon. Precedents influence this documentary ranking. In a future geometric comparison they should be shown separately, without favoring a place for its prestige. “Rocky” and “irregular” are qualitative descriptions, not comparable measurements of blocks, roughness or slope.

## Evidence and limits

- Fact sheets distinguish documented precedents from candidates proposed for evaluation. A precedent can be robotics, human training or a scientific comparison; the fact sheet specifies which.
- Coordinates locate regions of interest and are not test polygons. Unless a point source says otherwise, they have not been cartographically revalidated. The Haughton evidence for lunar operations refers to the crater, not necessarily to the Drill Hill point.
- The hyperaridity of Pampas de La Joya is documented in regional sectors, but those points are not granted to the dune marker without showing it coincides with the studied sector.
- The sample is not exhaustive and does not show that a site is accessible or safe. Test-scale measurements, permits, environmental assessment and field verification are required.
- Earth relief alone does not reproduce the gravity, illumination, regolith, atmosphere, chemistry or biology of another world.
- [Next sprint for modules 1, 3, 4 and 5](docs/product/recomendaciones-modulos.md); previous context and updated scope in [Module 2](docs/modules/modulo-2.md#copiloto-y-otros-módulos).
- [Documentary audit of the 14 sites](docs/qa/source-audit.md), with cross-checked sources, availability and pending limits.

## Sources and attribution

The institutional sources and publications for each place are in `data.js` and visible in the fact sheet. The four terrain illustrations are original SVGs created for the interface. They summarize catalog categories; they do not represent measured geometry or photographs of the places. The bars encode documentary points only.

The map geometry uses [Natural Earth, 1:110m land](https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/), public domain, in equirectangular projection. No third-party maps or images are served in real time.

The terrain rover is the [official Perseverance 3D model](https://science.nasa.gov/resource/mars-perseverance-rover-3d-model/) (NASA/JPL-Caltech, `assets/models/perseverance.glb`, 11.7 MB), loaded only when the terrain view opens; until then, or if it fails, a schematic rover is used.

Each dataset keeps its own terms, credits and attribution requirements, recorded in each JSON (`provenance`, `imagery.credit`, `license`).

## Checks

```bash
npm run check                                   # JavaScript syntax and tests
mise run check                                  # full check: JavaScript + Python backend
# Without mise, with the virtual environment active:
python -m pytest server/tests -q                # backend tests, no network
```

The harnesses do not replace visual review or a full accessibility evaluation. See the [QA report](docs/qa/qa.md).

## Files

- `index.html`, `styles.css`, `mission.js`: Mission Control console. `app.js`, `data.js`: documentary ranking engine and the 14 sites.
- `nasa-visual-math.mjs`, `nasa-stage.mjs`, `nasa-bench.mjs`, `nasa-explorer.mjs`: load projection, local loader, bench and gallery/globes, separate from the scientific engine.
- `rover-config.mjs`, `mission-audit.mjs`, `xlsx-report.mjs`: shared configuration, sessions and local OOXML Excel.
- `analog-audit.mjs`, `analog-audit-ui.mjs`: Module 2 audit and calibration; contract, export and sources in [docs/modules/modulo-2.md](docs/modules/modulo-2.md).
- `mission-math.mjs`, `sim-physics.mjs`, `similarity.mjs`, `copilot-rules.mjs`: pure logic with tests in `tests/`.
- `processes.mjs`, `weather-sim.mjs`, `solar.mjs`, `scene-fx.mjs`: 72 h processes, weather, solar position and 3D scene presentation.
- `server/`: FastAPI (telemetry, copilot, static files), `Dockerfile`, `scripts/deploy-cloudrun.sh`.
- `assets/data/`: DEMs, imagery, scenarios and archived readings. `assets/vendor/`: Three.js with its license.
- `docs/`: contracts, sources, audit, QA, pitch and demo script.

## Limits

- Exploratory simulation, not a validated digital twin. The rover is kinematic and its energy uses assumptions documented in `sim-physics.mjs`.
- 2.4 km windows: they do not resolve rocks or rover-scale obstacles. The Marius Hills pit (~65 m) is not resolved at 37.5 m; the LOLA LDEM is heavily interpolated.
- Mars thermal data is modelled (MCD); Shackleton's has no minimum in the product used. Earth roughness (dB) and lunar roughness (CPR) are not compared with each other.
- The Wadi Rum center is the team's choice, not a published test point.

The Module 2 Excel uses a Mission Control dossier with a native chart, eight base tools per mission and base values kept separate from observations. See [downloadable examples and visual review](docs/evidencias/m2-excel-diseno/index.html) and [proposed profiles](docs/modules/perfiles-base-m2.md). Local preview: `http://localhost:8027/`; from Atlas start it with `npm start -- --port 8027`.

## Final 3D descent and exploration from contact

The four A.R.E.S. scenarios start with **choose a lunar or Martian destination → prepare the mission (Destination zone / Payload and summary) → confirm preparation → start descent → review and authorize → explore with the mirror rover**. Preparation is a dialog over the viewer: confirming enables the start without launching it; closing/Escape does not confirm. Editing zone/payload, resetting or changing scenario requires a new confirmation. Camera, rate and comparison keep the confirmation. The central gate covers CTA, play, viewer, keyboard and feed; with no valid candidate the flight is not forced, and 0 % is a deliberate test with a warning. There is a single landing map and fuel budget, the destination's. Earth is an optional reference, with no second lander and no second contact; after deployment the **Test rover** stays authoritative and the destination shows **Mirror rover · simulated**, synchronized by relative displacement from their own origins. Each DEM evaluates its own ground; absolute coordinates are not copied and there is no hardware link. If the Earth origin is missing, the destination can land but the mirror stays disabled with an explanation. A target failure holds the rover. Flight is **1× SIM by default**, speeds 0.5×/1×/2×/4× and **manual** authorization after contact; rover SIM ×20. Camera, pause, reset, modelled Earth weather and the M2 log keep their functions and session identity.

Everything runs locally with the start commands above. [Usage and validation guide](docs/modules/descenso-uso.md) · [Model, limits and sources](docs/modules/descenso-modelo.md) · [Destination mission evidence](docs/evidencias/mision-destino/informe.md) · [Preparation, tests and measured performance](docs/evidencias/preparacion-rendimiento/informe.md). The Earth catalog keeps direct rover exploration. Regional DEMs do not certify terrain or resolve legs, rocks or cavities; Mars represents only the idealized final powered segment, without entry or parachutes.
