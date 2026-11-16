# S.E.L.E.N.E. Ops

**Surface Exploration, Lithology & Environment Network Engine** — a Mission Control console for finding and characterizing Earth analogues, planning simulated field expeditions, and exploring Moon and Mars mission scenarios.

Built by **ProdKillers** as an independent prototype for the [NASA Space Apps 2026 challenge](https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/). The project does not imply NASA affiliation or endorsement. Some legacy files and identifiers retain the names **A.R.E.S. Twin / Analog Atlas**.

The application combines **14 documentary catalogue sites**, **four published Earth–Moon/Mars pairs**, Discovery candidates, user-traced Scout zones, source-linked terrain and radar layers, a simulated rover, physical audits, weather-model context, and a Flight Director copilot. Its outputs support reconnaissance and follow-up planning; they do not certify analogue suitability, vehicle clearance, or field safety.

## Run locally

From the repository root, with **Node.js 18+** and Python with virtual-environment support:

```bash
npm run dev
```

Open **[localhost:8000](http://localhost:8000/)**. The same server serves the web app, [health endpoint](http://localhost:8000/api/health), and [API documentation](http://localhost:8000/api/docs).

```bash
npm run dev -- --port 8027       # API + web on another port, with backend reload
npm start -- --port 8027         # API + web without reload
npm run start:static -- 8028     # Static client and published datasets, without the API
```

There is no frontend build step. The launcher detects `.venv`, `.venv-server`, or the interpreter set in `ATLAS_PYTHON`. If backend dependencies are missing, it prepares `.venv-server` using the existing requirements; the first setup requires network access. Python 3.14 is pinned in `mise.toml`. Keep the server terminal open; `Ctrl+C` stops it.

Open-Meteo and local copilot rules work without credentials. Optional weather and OpenAI-compatible AI providers are configured on the backend; a local environment file is loaded when present. AI-assisted Mission Dossier generation requires a configured provider. See [backend configuration](server/README.md) and the [mise setup guide](docs/ejecucion-mise.md).

Static mode uses archived weather with its original dates. Local terrain exploration, audits and exports remain available; Scout analysis and provider-backed requests require the API. Scout zone analyses use the optional geospatial stack in `server/requirements-scout.txt`; without it, zone validation remains available and unavailable analysis layers retain their reason.

## Explore the application

| Workspace | What you can do | Evidence boundary |
| --- | --- | --- |
| **Mission Control** · [index.html](index.html) | Explore the globe, select an Earth site or planetary destination, inspect terrain, and open Compare, Processes, Flight Director, Technical details and Sources. | The rover, descent and camera feed are simulations. Source-backed terrain and model weather retain their own dates and provenance. |
| **Scout** · [scout.html](scout.html) | Trace a point or polygon, import GeoJSON, analyse a zone and activate a revision-specific micro-site in Mission Control. | Requires the backend and optional geospatial stack; missing layers remain absent. |
| **Discovery** · [discovery.html](discovery.html) | Browse candidates from published regional scans, compare their terrain and climate context, and open a candidate in Route Explorer. | Candidate generation does not establish scientific novelty, access, safety or an exhaustive search of Earth. |
| **Field Expedition** · Terrain 3D | Prepare an Earth traverse, inspect reached stops and produce a source-linked field report. | DEM observations describe regional terrain; they do not measure materials or validate rover-scale obstacles. |
| **Route Explorer** · [route-explorer.html](route-explorer.html) | Compare regional route hypotheses under slope/relief constraints, view terrain and SAR layers, and export GeoJSON. | Routes and radar screens require independent validation before operational use. |
| **Mission Dossier** · [dossier.html](dossier.html) | Assemble a technical report from the available mission context, with Markdown and browser Print / Save as PDF. | Generated text must preserve missing evidence and the scope of each source; it is distinct from the Earth field-run report. |

### Scout zones

`scout.html` lets you mark a point, draw an area (≤ 25 km per side) or import GeoJSON, pick a Moon/Mars target and operation, and run a server analysis. The analysis ranks 2400 m micro-sites inside the zone with the same GLO-30 terrain recipe and geometric index as the scenarios, and returns an affinity map, Sentinel-2/Sentinel-1/ERA5 layers with their states, and an **Activate mission** link that opens the micro-site in Mission Control (`index.html#zone=…&rev=…&site=…`). Each analysis is a saved revision; missing layers are marked absent instead of borrowed from a nearby site. Requires the FastAPI backend; analyses need the optional `server/requirements-scout.txt`. See [Scout](docs/modules/scout.md).

### Earth field expeditions

1. Select an Earth site and open **Terrain 3D**. The paired-window selector also provides La Corona, Wright Valley, Atacama and Wadi Rum.
2. Choose a reconnaissance, sampling or shelter-reconnaissance objective. Set the conceptual payload, regional slope ceiling and illustrative drive allowance.
3. In **Terrain & stops**, edit the ordered stops on the actual DEM. Stop 1 is the rover's departure point. Review the source, scale and direct-leg validation.
4. In **Review & confirm**, acknowledge the limits and confirm. Confirmation holds the rover without advancing SIM time or recording an inspection.
5. Press **Start expedition** once. It records the departure DEM baseline and activates the traverse toward stop 2. Auto follows the plan; Manual uses the drive pad or WASD/arrow keys with the scene focused.
6. At later arrivals, use **Inspect & continue**, **Record & stay paused**, or **Record final inspection**. Optional notes remain attached to the inspected stop. Finishing early produces an explicitly incomplete decision.
7. Download the **Markdown field report** and **JSON evidence**, or copy the bounded copilot context. The report distinguishes departure baselines from operator inspections and retains source identity, local coordinates, UTC and SIM time. It is separate from Mission Dossier and M2 audit exports.

The interface follows Mission Control's shared colors and typography, with preparation steps, phase badges, instrument cards and an expandable evidence log. SIM time pauses while the run is paused or the page is hidden; returning requires an explicit resume. Reports retained in the tab should be exported before it is closed.

[Expedition controls, model and limits](docs/modules/earth-expedition.md).

### Earth analysis and Flight Director

Terrain 3D exposes **M2 Test Inspector**, **Processes 72 h**, and **Surface, rocks & cavities · AI** for the active Earth location. A planetary comparison reference does not launch a descent. Earth and destination audits keep independent sessions and exports.

The surface workspace derives regional evidence from the active DEM. Individual rock dimensions, material density, terrestrial cavity geometry and roof stability stay unknown when no suitable source supplies them. Published Marius pit geometry belongs to its own lunar reference; it is not copied into an Earth site. Flight Director uses the captured active context, with a local rule fallback when an AI provider is unavailable.

[Earth analysis workspace](docs/modules/earth-analysis.md) · [surface evidence and reference limits](docs/modules/surface-assessment.md) · [AI context contract](docs/modules/ai-context.md).

### Destination preparation and simulated descent

For a Moon or Mars scenario, the flow is **choose destination → prepare zone and payload → confirm preparation → start descent → review contact and authorize deployment → explore with the rover**. Confirming preparation enables the start; it does not launch automatically.

The destination has one landing map and fuel budget. Earth is an optional comparison reference. After deployment, the Earth test rover and simulated destination mirror use their own terrain frames; there is no hardware link. The flight models only an idealized final powered descent, with manual deployment authorization and a default 1× flight rate. Rover motion uses SIM ×20.

The fullscreen rover feed provides Chase, Mast and Orbital cameras, heading and simulated telemetry. **F** opens the feed and **C** changes cameras. All views retain their simulation labels.

[Descent usage](docs/modules/descenso-uso.md) · [model and limits](docs/modules/descenso-modelo.md).

### Audit, processes and route evidence

- **Module 2:** inspect analogy breakdown, mission-specific proposed equipment profiles and calibration assumptions. Automatic tracking and JSON/Markdown/12-sheet Excel exports retain observations, source data and unknowns separately. The optional manual lab is isolated from the recorded report. Local NASA models and textures provide visual context, not scientific parameters. [M2 guide](docs/modules/modulo-2.md) · [proposed equipment profiles](docs/modules/perfiles-base-m2.md) · [NASA assets and credits](docs/modules/nasa-assets.md).
- **Module 3:** inspect a 72-hour model forecast and exploratory thermal, aeolian, freezing-crossing and cold-window rules. Thermal comparisons use normalized shape and phase, with air/surface and planetary-day differences stated. Weather presets are didactic scenarios; a wind threshold or temperature crossing does not prove a physical event. [Processes contract](docs/modules/m3-processes.md).
- **Module 4:** inspect DEM-derived slope, relief and TRI; compare routes; view modeled terrain shadow and source-matched spatial Sentinel-1 pairs. Published cave/pit references and finer terrain patches have specific coverage limits. SAR backscatter changes do not detect underground voids or certify hazards. [Route Explorer sources and limits](docs/modules/m4-routes.md).

## Published Earth–Moon/Mars pairs

The paired terrain windows share **2.4 × 2.4 km**, **65×65 nodes**, and **37.5 m spacing**. Context terrain extends the scene to 19.2 km at a coarser display scale and is excluded from the central window's metrics.

| Scenario | Earth terrain and imagery | Planetary terrain and thermal reference | Terrain index |
| --- | --- | --- | ---: |
| Volcanic lava tube | La Corona, Lanzarote · GLO-30 · Sentinel-2 · Sentinel-1 RTC | Marius Hills · Kaguya TC · Diviner | 72 |
| Shadowed polar crater | Wright Valley · GLO-30 · Sentinel-2 · Sentinel-1 RTC HH | Shackleton · LOLA · Diviner · Mini-RF CPR | 97 |
| Hyperarid saline plain | Atacama · GLO-30 · Sentinel-2 · Sentinel-1 RTC | Jezero · HiRISE · Mars Climate Database | 82 |
| Wind-eroded canyon | Wadi Rum · GLO-30 · Sentinel-2 · Sentinel-1 RTC | Valles Marineris · CTX · Mars Climate Database | 83 |

These indices are reproducible from the published grids with [compareTerrain](src/shared/similarity.mjs). The four pairs currently use median slope, p90 slope, p95–p5 relief and mean TRI, with editorial weights renormalized over available components. Earth radar dB and lunar CPR are excluded from direct comparison. Discovery comparisons may include an explicitly caveated thermal-amplitude term when supplied; aridity remains Earth-side context.

**An index is not a planetary-similarity percentage or a success probability.** Documentary catalogue points are a separate weighted-tag ranking; an unrecorded tag contributes no points without establishing that the property is absent. Target/analogue centers and native source resolutions must be reviewed for each intended use.

[Target sources](docs/qa/targets-sources.md) · [catalogue source audit](docs/qa/source-audit.md) · [shared data contracts](docs/contracts.md).

## Data, provenance and regeneration

Published datasets under `assets/data/` make the core demo reproducible. Products retain their source, acquisition/fetch dates, processing notes, licenses and coverage limits. A processed local product and an authenticated live provider connection are different capabilities.

| Data | Published source or access path | Preparation entry point |
| --- | --- | --- |
| Catalogue terrain and imagery | Copernicus GLO-90 through Open-Meteo Elevation; EOxCloudless 2024 | `scripts/fetch-terrain.py` |
| Paired Earth terrain, imagery and radar | Planetary Computer Copernicus GLO-30, Sentinel-2 L2A and Sentinel-1 RTC | `scripts/fetch-scenarios-earth.py` |
| Lunar/Martian terrain and thermal references | NASA GSFC PGDA, USGS Astrogeology, PDS Diviner/Mini-RF and Mars Climate Database | `scripts/fetch-targets.py` |
| Wider terrain context and display imagery | GLO-30, LOLA/Kaguya, MOLA/HRSC and the recorded image providers | `scripts/fetch-context.py`, `scripts/fetch-hires-imagery.py` |
| Discovery candidates | Coarse GLO-90 prefilter; JAXA AW3D30 through Planetary Computer; ERA5 climate context | `scripts/prefilter-regions.py`, `scripts/discover-analogs.py` |
| Weather and 72-hour forecasts | Open-Meteo; optional Meteomatics, with cache/archive fallbacks | `server/telemetry.py`, `server/forecast.py`, `python -m server.snapshot`, `python -m server.forecast_snapshot` |
| Temporal and spatial radar context | Sentinel-1 RTC and recorded archive weather context | `scripts/fetch-process-history.py`, `scripts/m4_build_sar_maps.py`, `scripts/m4_build_discovery_sar.py` |
| On-demand Scout analyses | Zone-specific GLO-30 terrain, Sentinel-2/Sentinel-1 and ERA5 context, with layer states and revision identity | `server/scout_engine.py`, `server/zones.py` |
| Local terrain and cave/pit reference products | Source-specific USGS OPR, LROC and La Corona Pyroduct publications | `scripts/m4_extract_usgs_opr.py`, `scripts/m4_extract_lroc_dtm.py`, `scripts/m4_extract_pyroduct_corona.py` |

Pipelines call external services and write published data; they are **not required to run the demo**. Regenerate deliberately using the pipeline's documented environment and options, preserving provenance and terms. Terrain metrics use `scripts/terrain_metrics.py`; local virtual environments are not versioned.

[Discovery pipeline and contract](docs/modules/m1-discovery.md) · [Module 4 publication recipes](docs/modules/m4-routes.md) · [asset preparation](docs/modules/nasa-assets.md).

## Repository layout

Pages stay at the root; implementation modules live under `src/`. The site is served directly by the backend or a static server.

```text
index.html, discovery.html, scout.html, route-explorer.html, dossier.html
src/
  shared/       Terrain math, comparison, rover physics and shared configuration
  mission/      Mission Control, layout, surface assessment and orchestration
  discovery/    Candidate discovery UI and comparison
  scout/        Zone tracing, analysis revisions and mission activation
  audit/        M2 audit, tracking, Excel, NASA bench and visual assets
  processes/    Weather, process rules, solar position and scene effects
  landing/      Preparation, final powered descent and deployment
  expedition/   Earth planning, analysis and field-run reports
  hazards/      Terrain/SAR evidence and Route Explorer
  dossier/      Mission Dossier context, generation and exports
assets/         Published datasets, models, textures, fonts and vendored Three.js
server/         FastAPI, weather, forecasts, copilot and dossier services
scripts/        Data pipelines, local launcher and QA tools
tests/          JavaScript tests and manual browser fixtures
server/tests/   Python backend tests
docs/           Contracts, module guides, source audits and validation evidence
```

[Documentation index](docs/README.md) · [contribution and module ownership rules](AGENTS.md) · [earlier Spanish overview](README.es.md).

## Checks

```bash
npm run check                                 # JavaScript syntax and tests
npm test                                      # JavaScript tests only
mise run check                                # JavaScript + Python backend tests
# Or, with the Python development environment active:
python -m pytest server/tests -q               # Backend tests without provider calls
```

Browser QA scripts and their fixtures are documented in the corresponding module guides. Historical counts and screenshots describe those particular runs, not a guarantee for another machine or deployment. See the [QA reports](docs/qa/qa.md) and [evidence index](docs/evidencias/README.md).

## Scientific and operational limits

- **Exploratory prototype:** rover motion, energy use, descent and weather effects are models with stated assumptions, not a validated digital twin or an operational command system.
- **Scale:** remeshing and interpolation add no source detail. Regional DEMs do not resolve wheel-scale obstacles, material strength or cave interiors. Finer published patches apply only to their recorded coverage.
- **Thermal and weather context:** Diviner describes lunar surface products; Mars Climate Database is a model; Earth weather is model output, not a local instrument. Shackleton's current thermal product has no supplied minimum or diurnal curve. Missing values remain unknown.
- **Subsurface and SAR:** radar surface differences, pit references and cave cross-sections do not establish underground connectivity, roof stability, local ice or safe access.
- **Analogue selection:** gravity, atmosphere, radiation, regolith, chemistry and biology differ across bodies. Candidate novelty and suitability require documentary review and independent field measurements.
- **Reports:** field-run evidence, M2 audit exports and Mission Dossier serve different scopes. Generated narrative and user notes do not create missing measurements.
- **Attribution:** each dataset and visual asset keeps its own license and credit. Review them before reuse; field work also requires permits, environmental review and local safety assessment.
