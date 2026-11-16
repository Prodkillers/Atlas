# A.R.E.S. Twin — contratos de integración (núcleo compartido)

Fuente única para formatos que cruzan módulos. Contratos **por módulo** (Discovery, auditoría,
procesos): [`docs/modules/`](modules/). Propiedad de archivos: `AGENTS.md` §3.

Si un módulo necesita cambiar un contrato compartido, lo anota en «Cambios» y avisa; no cambia
silenciosamente el formato.

Principio de honestidad (heredado del README): nada se presenta como «% de similitud planetaria» ni como «en vivo» si no lo es. Todo dato lleva `source`/`provenance`; todo valor de literatura o modelado se marca como tal (`kind`).

## 1. Escenarios — `assets/data/scenarios.json` (fijo)

Cuatro escenarios de la demo. Cada uno empareja un gemelo terrestre con un objetivo extraterrestre:

| id | Tierra (`earthId`) | Objetivo (`targetId`) | Cuerpo |
| --- | --- | --- | --- |
| `lava-tube` | `la-corona` | `marius-hills` | moon |
| `polar-shadow` | `wright-valley` | `shackleton` | moon |
| `hyperarid-salt` | `atacama` | `jezero` | mars |
| `wind-canyon` | `wadi-rum` | `valles-marineris` | mars |

`wadi-rum` y `la-corona` son sitios solo de escenario: no se añaden a `data.js` (el catálogo documental se mantiene en 14 sitios y sus tests). `la-corona` sustituye a Caldera Blanca (`lanzarote`, que sigue en el catálogo) porque esa ventana caía sobre el borde de un cráter (pendiente p90 31°) y no sobre un campo de lava con tubo.

### 1.1 Elección de ventanas y correspondencia entre cuerpos

La correspondencia entre una ventana terrestre y una extraterrestre se mide siempre con la misma receta: ventana de 2400 m, rejilla 65×65 a 37.5 m (fila 0 = norte), métricas de `scripts/terrain_metrics.py` e índice de `similarity.mjs`. `terrain_metrics.geometric_index` replica ese índice en Python (sin rugosidad) y `tests/analog-match.test.mjs` comprueba que ambos dan el mismo entero.

`scripts/analog_match.py` busca, alrededor de un punto de referencia, la ventana con mayor índice frente a una referencia:

- `earth --lat --lon --ref <rejilla>`: ventanas de GLO-30 (30 m remuestreado a 37.5 m) en la Tierra; descarta ventanas con mar o sin dato (GLO-30 rellena el mar con 0 m).
- `target --id <targetId> --ref <rejilla>`: ventanas del DEM nativo del objetivo (`fetch-targets.py`), remuestreado al mismo paso.

Los centros terrestres de los cuatro escenarios salen de esa búsqueda a pocos km de un punto de referencia documentado, que queda en `anchor` de la rejilla; el centro elegido no es un punto de ensayo publicado. Una selección manual de área debe usar esta misma receta (misma extensión, paso, orientación, métricas y exclusión de nodata) para que su índice sea comparable con el de los escenarios. El índice solo mide geometría: no sustituye a la temperatura, iluminación, atmósfera ni a la resolución nativa (`comparable`).

## 2. Rejilla de terreno (Tierra y objetivos)

Archivos: `assets/data/scenarios/earth/<earthId>.json` y `assets/data/scenarios/targets/<targetId>.json`.

```jsonc
{
  "id": "atacama",                 // earthId o targetId
  "body": "earth",                 // "earth" | "moon" | "mars"
  "name": "Desierto de Atacama · Yungay",
  "center": [-24.10945, -70.10923], // lat, lon planetocéntricos (este positivo)
  "anchor": { "center": [-24.102, -70.138], "label": "data.js (ARADS)" },  // solo Tierra: punto de referencia documentado (§1.1)
  "gridSize": 65,                  // N, rejilla N×N
  "spacingMeters": 37.5,           // separación métrica entre nodos
  "extentMeters": 2400,            // (N-1)·spacing
  "elevation": [/* N*N metros, fila 0 = NORTE, columna 0 = OESTE (row-major) */],
  "imagery": { "path": "assets/data/scenarios/earth/atacama.jpg", "credit": "…", "license": "…", "source": "…" } ,  // o null
  "dataset": "Copernicus DEM GLO-30 (Planetary Computer cop-dem-glo-30)",
  "nativeResolutionMeters": 30,
  "source": "https://…",
  "fetchedAt": "ISO-8601",
  "metrics": {                     // calculadas con scripts/terrain_metrics.py SOBRE ESTA REJILLA
    "slopeP50Deg": 0, "slopeP90Deg": 0, "reliefP95P5M": 0, "triMeanM": 0,
    "comparable": true,            // false si la resolución nativa > 2× spacingMeters (dato interpolado)
    "roughness": { "value": 0, "unit": "dB | CPR | …", "method": "…", "source": "…" }  // o null
  },
  "thermal": {                     // o null
    "kind": "live | diviner | literature | model",
    "minK": 0, "maxK": 0, "meanK": 0,
    "curve": [{ "hourLocal": 0, "tempK": 0 }],   // o null
    "source": "…"
  },
  "environment": { "gravityMs2": 9.81, "solarConstantWm2": 1361, "atmosphere": "…", "dayLengthHours": 24 },
  "provenance": [{ "label": "…", "url": "https://…" }],
  "notes": ["limitaciones en español"]
}
```

Ventana estándar de comparación: **2400 m × 2400 m, 65×65 nodos a 37.5 m**. Si el producto nativo es más grueso (p. ej. MOLA 463 m), se remuestrea igualmente pero `metrics.comparable=false` y se explica en `notes`.

## 3. API del backend (FastAPI, `server/`)

Todo bajo el mismo origen que los estáticos (el contenedor sirve el repo en `/`).

- `GET /api/health` → `{ "status":"ok", "version":"2.0.0", "providers": { "weather":"meteomatics|open-meteo", "ai":"openai|none" } }`
- `GET /api/telemetry?lat=<f>&lon=<f>&site=<id>` →
  ```jsonc
  { "site":"atacama", "lat":-24.1, "lon":-70.1, "observedAt":"ISO", "provider":"meteomatics|open-meteo|snapshot",
    "live": true, "cached": false, "ageSeconds": 0, "fetchedAt":"ISO", "observationAgeSeconds":0,
    "values": { "solarRadiationWm2":0, "temperatureC":0, "windSpeedMs":0, "windGustMs":0, "relativeHumidityPct":0, "cloudCoverPct":0, "surfacePressurePa":null, "windDirDeg":0, "precipMm":0 },
    "source": { "label":"…", "url":"https://…" } }
  ```
  Caché en memoria de 10 min por (lat,lon redondeados a 0.01). Si el proveedor falla: último valor en caché o `assets/data/telemetry-snapshot.json` con `live:false, provider:"snapshot"`.
- `POST /api/copilot` body `{ "question": "…", "context": { …ver §5… } }` → `{ "answer":"texto en español", "provider":"openai", "model":"…", "grounded":["earth.telemetry.temperatureC", …], "generatedAt":"ISO", "disclaimer":"…" }`. El backend consume la API compatible con OpenAI configurada por `OPENAI_BASE_URL` (por defecto `https://ai.edream.dev/v1`), primero con `OPENAI_MODEL` (`gpt-6.1-sol`) y si falla con `OPENAI_FALLBACK_MODEL` (`gemini-3.8-flash`). Ambos usan la misma clave y URL. No se aplica un límite local estimado de tokens; el contexto se proyecta a un conjunto acotado y equilibrado de campos antes de enviarse. Sin clave configurada → **HTTP 503** `{ "error":"no-ai-provider" }` y el frontend usa `copilot-rules.mjs`.
- `POST /api/copilot` acepta opcionalmente `history`: hasta 20 mensajes `{ "role":"user|assistant", "content":"…" }` recientes, enviados por el navegador desde memoria de la pestaña para dar contexto conversacional. El backend no persiste el historial; al recargar o cerrar la pestaña se pierde.

Variables de entorno: `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_FALLBACK_MODEL`, `ALLOWED_ORIGINS`, `DOSSIER_RATE_PER_MIN`, `DOSSIER_GLOBAL_RATE_PER_MIN`. La clave se mantiene en el backend y nunca se incluye en solicitudes del navegador. The dossier defaults to 3 requests per IP and 20 requests globally per minute.

`assets/data/telemetry-snapshot.json`: `{ "<siteId>": <respuesta de /api/telemetry> }` para los 14 sitios + `wadi-rum` y `la-corona`. Lo usa el frontend cuando no hay backend (p. ej. GitHub Pages).

Pronóstico y procesos dinámicos: ver [`modules/m3-processes.md`](modules/m3-processes.md).

Scout zones (detail in [`modules/scout.md`](modules/scout.md)):

- `GET /api/scout/health` → `{ "status":"ok", "dem":"available|unavailable", "missingModules":[…], "targets":[…], "operations":[…] }`
- `POST /api/zones` body `{ "geojson": <Point|Polygon|Feature|FeatureCollection(1)>, "name"?, "searchMeters"? (Point, 2400–12000), "source"?: { "kind":"user-drawn|user-point|geojson-import|discovery-candidate", "ref"? } }` → `201` (new) or `200` (same outline already stored) with `{ id:"zone-<10 hex>", name, geometry (Polygon, [lon,lat]), center:[lat,lon], bbox:[W,S,E,N], areaKm2, extentMeters, scales, revisions:[…] }`. Invalid geometry → `422 { "error":"invalid-geometry", "message":"…" }`.
- `GET /api/zones`, `GET /api/zones/{id}`.
- `POST /api/zones/{id}/analyses` body `{ "targetId", "operation":"general|mobility|sampling|drilling|habitat", "scales":[2400,7200] }` → `202 { jobId, zoneId, revision, eventsUrl, manifestUrl }`. Each call creates a new immutable revision.
- `GET /api/jobs/{jobId}/events?after=<seq>` → `{ status:"queued|running|ready|unavailable|failed|cancelled", events:[{ seq, at, stage, status, message, data? }], next }`; `POST /api/jobs/{jobId}/cancel`.
- `GET /api/zones/{id}/revisions/{n}` → manifest `{ status, target, geometry, layers:{ <name>:{ status:"ready|partial|running|pending|unavailable|absent|on-demand|cancelled", product?, resolution?, coverage?, reason?, method? } }, sites:[{ rank, earthId:"zone-<hash>-r<n>-s<rank>", center, index, searchIndex, foundAtScaleMeters, metrics, gridPath, imagery, roughness, climateContext }], affinity:{ cellMeters, cells:[[lat,lon,index]] }, caveats }`.
- `GET /api/zones/{id}/revisions/{n}/sites/{rank}/grid` → §2 grid (same fields as `assets/data/scenarios/earth/*.json`, plus `zone` and `climateContext`); `…/imagery.jpg`.
- `GET /api/zones/{id}/revisions/{n}/scenario?site=<rank>` → §1 scenario object plus `zone` (Mission Control opens it from `index.html#zone=…&rev=…&site=…`).
- `/api/telemetry` and `/api/processes/forecast` with `site=zone-*`: if the provider fails, no archived snapshot from another site is returned (`503`).

- `POST /api/dossier` body `{ "context": { … }, "userNotes": "…" }` returns `{ "markdown":"…", "provider":"openai", "model":"…", "grounded":[…], "generatedAt":"ISO", "disclaimer":"…" }`. Optional `userNotes` is limited to 4,000 characters and is explicitly labeled unverified in a dedicated dossier section; it is not source evidence. It uses the same server-only OpenAI-compatible configuration as `/api/copilot`, produces English Markdown, and explicitly preserves missing, archived, modelled, and literature data as such. It returns `503 no-ai-provider|ai-provider-unavailable`, `429 rate-limited`, or `422 invalid-input`. Output budget: 4096 tokens. Primary and fallback models are each tried once (60-second hard wall-time budget per attempt); no local estimated-token gate is used.

## 4. Módulos JS puros (sin DOM, con tests `node --test`)

`sim-physics.mjs`
- `BODY_ENV[body]` → `{ gravityMs2, solarConstantWm2, dayLengthHours, atmosphere }` para earth/moon/mars.
- `attitude(grid, x, z, headingDeg)` → `{ pitchDeg, rollDeg }` (usa `sampleHeight` de `mission-math.mjs`; positivo = morro arriba / inclinado a la derecha).
- `solarPowerW({ irradianceWm2, panelAreaM2=2, efficiency=0.28, tiltDeg=0 })` → W.
- `batteryStep({ batteryPct, capacityWh=1000, solarW, loadW, dtSeconds })` → nuevo %.
- `driveLoadW({ speedMs, slopeDeg, gravityMs2, massKg=350 })` → W.
- `thermalStatus({ ambientK, minOpK=233, maxOpK=323 })` → `{ level:"nominal|caution|critical", marginK, text }`.

`similarity.mjs`
- `compareTerrain(earth, target)` → `{ index: 0-100 | null, comparable, components:[{ key, label, earth, target, score, weight }], caveats:[…] }` usando solo `metrics` medidas (pendiente p50/p90, desnivel, TRI, rugosidad si ambas existen). `index` es «índice de similitud geométrica», nunca «similitud planetaria». `null` si faltan métricas.

`copilot-rules.mjs`
- `answerLocally(question, context)` → misma forma que `/api/copilot` con `provider:"rules"`.

## 5. Contexto del copiloto (lo arma `mission.js`)

```jsonc
{ "scenario": { "id", "title", "focus" },
  "earth":  { "id", "name", "metrics", "telemetry": /* respuesta §3 */, "thermal" },
  "target": { "id", "name", "body", "metrics", "thermal", "environment" },
  "rover":  { "pitchDeg", "rollDeg", "batteryPct", "solarW", "slopeDeg", "thermal": /* thermalStatus */ },
  "similarity": /* compareTerrain */,
  "analogyAudit": /* resumen módulo 2, §6; null si no disponible */,
  "processes": /* summarizeProcesses; ver modules/m3-processes.md; null si no disponible */ }
```

## 6. Módulo 2 — candidato, auditoría y dossier v1.0.0

Contrato aditivo implementado en `analog-audit.mjs`: `CandidateAnalogPayload` **1.0.0**, `AnalogAuditResult` **1.0.0** y `AnalogAuditDossier` **1.0.0**. [Esquema JSON del candidato](candidate-analog-payload.schema.json) y [uso, estructura de resultados, fórmulas, fuentes y límites](modules/modulo-2.md). No reemplaza los JSON de escenarios/rejillas de §1–2 ni el índice de geometría. Más detalle por módulo: [`modules/m2-audit.md`](modules/m2-audit.md).

- `buildCandidateAnalogPayload({scenario, earthGrid, targetGrid, telemetry})` conserva identidad, coordenadas, escala, métricas, térmica superficial, telemetría y procedencia. Cantidades: `{value,unit,kind,source,observedAt}`, ausencias `null`. Aire y superficie permanecen separados. Gravedades son referencias, presión terrestre no se infiere del texto de atmósfera, Luna 0 Pa es vacío ideal y Marte 636 Pa es referencia al radio medio, no dato del sitio.
- `auditAnalog(payload, inputs)` devuelve `matrix:[{id,label,status,strength,breakdown,action,evidence}]`, `counts`, `geometry`, `calibration`, `sources` y `limitations`. Estados `valid|partial|breakdown|unknown`, por alcance de fila; no porcentaje físico global. `calibration` contiene `valid`, errores por campo, `inputs` en SI, `kind:"user-assumption"`, `equipment`, `targetBody`, `gravity`, `pressure`, `thermal`, fórmulas y supuestos. Parámetros inválidos anulan sus resultados; parámetros ausentes quedan desconocidos.
- `createDossier` copia `{schema,version,exportedAt,candidate,audit,disclaimer}`; `dossierMarkdown` lo convierte a informe local con evidencia/fuentes. Exportación JSON de misión añade `analogyDossier` o `null`. No existe importación UI ni PDF en esta versión.
- Contexto §5 añade `analogyAudit:{version,scenarioId,counts,matrix:[{id,status,breakdown}],calibration,limitation}`. Calibración compacta: `{kind,equipment,targetBody,massKg,gravity,pressure,thermal}` o `null` si inválida. El cuerpo del cálculo puede ser hipotético y distinto del objetivo: no cambiar la identidad de la matriz. El LLM sigue siendo opcional; el copiloto local consume este resumen.
- El adaptador solo acepta presión terrestre en la extensión opcional explícita `telemetry.values.surfacePressurePa` (Pa absolutos a la superficie). Open-Meteo y Meteomatics la entregan cuando está disponible, con validación de unidades y respaldo sin presión opcional; nunca se convierte presión MSL. Telemetría de otro sitio se descarta. Las rejillas cruzadas invalidan la auditoría.

## Cambios

- Project README refresh (documentation only): updates the S.E.L.E.N.E. Ops identity, current src/ layout, startup commands, Earth/destination workflows, independent Earth analysis, Discovery, Scout, Route Explorer and source/model limits. Keeps the existing Markdown/JSON field exports and Scout integration from main. Runtime code, shared schemas and published assets are unchanged.

- S.E.L.E.N.E. Scout (additive): new `scout.html` page and `src/scout/`, zone registry and analysis jobs in `server/zones.py` / `server/scout_engine.py` (§3, [`modules/scout.md`](modules/scout.md)). Shared files touched minimally: `src/mission/mission.js` opens `#zone=…&rev=…&site=…` as an extra scenario (scenario buttons factored into `appendScenarioButton`, mission export adds `scenario.zone`); `src/audit/analog-audit.mjs` adds optional `scenario.zone` to `CandidateAnalogPayload` (v1.0.0 fields unchanged); `src/audit/mission-profiles.mjs` resolves a zone to the base profile of the reference destination with the same target; `server/telemetry.py` and `server/forecast.py` no longer relabel a nearby site's snapshot for `zone-*` sites; Discovery adds a “Trace zone in Scout” link; navigation adds Scout. Optional server dependencies in `server/requirements-scout.txt`.

- Earth workspace integration with the modular repository layout: field analysis files now live in `src/expedition/`, automatic surface evidence in `src/mission/`, and the ID helper in `src/shared/`. Entry-page resources, imports, test fixtures and moved module-guide links use the new locations. The Discovery chat, its context reservation/prompt rules, English UI and existing landing/dossier/hazard modules are preserved. A public-page dependency check covers local module imports and stylesheet assets so missing files after a move fail before publication. Existing evidence directories remain historical cutoffs; the combined integration has its own QA evidence.

- Automatic surface / Earth analysis workspace (M5, additive M2/M3 reuse): Terrain 3D exposes its own namespaced M2 Test Inspector, explicit planetary reference and active-site Processes 72 h. Destination M2 sessions and descent records stay independent. Optional `createAuditPanel(root, { idPrefix })` / `createNasaBench(..., { idPrefix })` support unique static IDs; an Earth audit adds `analysisContext` and a session/DEM/reference `scopeKey`. `earth-analysis*.mjs/css` owns the adapter, asynchronous selection guards and Earth-only tracking. Mission JSON adds `earthAnalysis`; Earth copilot context includes the matching audit and process summary. `surface-assessment-ui.mjs` now populates regional DEM evidence automatically; the former manual Rock envelope and Marius load controls are superseded. `surface-assessment/1` adds `automatic`; legacy calculations/readers remain supported. Compact automatic evidence fits the existing 55-field surface reservation. Only lunar Marius receives the published pit dimensions; La Corona documentary context does not supply interior geometry. Shared `mission.js` / `index.html` changes preserve the simulator-first layout and English UI. See [Earth analysis](modules/earth-analysis.md) and [surface evidence](modules/surface-assessment.md).

- Field Expedition presentation (M5): the scoped `earth-expedition.css` now uses Mission Control color and typography tokens, segmented preparation steps, status badges, instrument cards and a blue DEM/yellow route map legend. The DOM adapter adds display-only metric slots and an expandable recorded-evidence section. Plan/run transitions, validation, DEM values, report schemas and provider contexts are unchanged. Shared console styles and destination preparation are untouched. See [Earth expeditions](modules/earth-expedition.md).

- Surface-reference discoverability: the Marius reference card and source/load actions are visible before the geometry fields in both estimate tabs. Loading remains restricted to its own Moon/Marius identity; other locations offer an explicit destination-navigation action that awaits selection, verifies the active scenario and opens the matching drawer before loading the reference. `createSurfaceLab` adds `onOpenReference` and `usePublishedReference()`; report/provider schemas are unchanged. Shared `mission.js` wiring preserves location/session/DEM isolation.

- Repo layout (no contract change): front-end code moved from the repo root into `src/<module>/` (`shared`, `mission`, `discovery`, `audit`, `processes`, `landing`, `expedition`, `dossier`, `hazards`); pages (`index.html`, `discovery.html`, `dossier.html`, `route-explorer.html`) stay at the root, so public URLs and `assets/**` paths do not change. Docs moved into `docs/modules/`, `docs/product/` and `docs/qa/` (index in `docs/README.md`); `docs/contracts.md` and the payload schema stay in place. Static `/data.js` is now `/src/mission/data.js`. Discovery chat (`discovery-chat.mjs`) lives in `src/discovery/`. File names, exports and data are unchanged; `git log --follow` keeps history. Branches in flight should rebase on `main` and put new files in their `src/<module>/` folder.

- Earth expedition departure UX (M5): confirmation still holds the rover without recording evidence. `startExpedition` now records the sourced departure DEM baseline once and activates the traverse toward stop 2; later stops still require an explicit inspection. Inspection JSON and compact copilot entries add `recordingMethod: "departure-baseline" | "operator-inspection"`; Markdown labels the distinction. `earth-expedition-ui.mjs/css` adds phase guidance, a stop checklist, keyboard focus continuity, action controls before the map on mobile, and Inspect & continue / Record & stay paused. Existing shared rover controls, destination descent and M2 contracts are unchanged. Existing reports without `recordingMethod` remain readable as operator inspections. See [Earth expeditions](modules/earth-expedition.md).

- Mission Control surface planning: both Terrain 3D and destination missions expose Flight Director in `decision-workspace` inside the simulator-first Flight Director drawer; the Earth jump button uses `revealInDrawer`. Additive `surface-assessment/1` separates rock/cavity assumptions, modeled outputs, null unknowns and the documented Marius pit comparison. Mission JSON adds `surfaceAssessment`; Earth JSON/MD freeze a matching snapshot at closure. Provider root `surfaceAssessment` has a 55-field reservation and recognized citation paths. Location/DEM/session/revision changes invalidate conversation results. No landing, fixed M2 spreadsheet or rover physics contract changes; no DEM obstacle or subsurface detection is inferred. New logic/styles live in `surface-assessment*.mjs/css`; shared wiring is documented in [surface assessment](modules/surface-assessment.md). Untargeted console and prompt copy retains its inherited language as a localization shortcut.

- Module 5 simulator-first layout (plan phase 1, `docs/qa/plan-visual-refactor.md`): `index.html` is re-laid out as setup steps (left: Destination → Earth analog → Weather), a dominant 3D stage with one bottom bar (Energy · Thermal · Tilt · Similarity indicators, launch/rover controls, camera tools) and a right drawer, closed by default, with tabs Compare (panels 04–06 + M2 audit) · Processes 72 h (09) · Flight Director (07) · Technical details (02, radar, 03, operations log, NASA explorer) · Sources (08, provenance, methodology). **No element ID was removed**; panels were moved, and `#landing-panel` stays inside `.viewport-panel` (required by `landing-view.mjs`). New scoped module `sim-layout.mjs` (drawer, ARIA tabs, in-page links to drawer content open the right tab, weather chips that drive the existing `#weather-earth` / `#weather-target` selects and their `change` handlers, top-bar Earth/Moon/Mars switch, `setIndicator`). `mission.js` adds only the import, `data-body` on scenario buttons, indicator calls and `revealInDrawer` for the similarity chip, plus English for primary visible strings (numbers now `en-US`). Static UI text in `index.html` is English; `tests/atlas.test.cjs` now asserts the English methodology sentence («does not reproduce gravity, regolith, illumination or chemistry»). Removed classes (no JS references): `dashboard`, `left-column`, `right-column`, `bottom-grid`, `ares-col`, `mission-heading`, `status-strip`, `catalog-link`.

- Hi-res scenario imagery (`scripts/fetch-hires-imagery.py`, additive): each scenario grid's `imagery.path` now points to `<id>-hires.jpg` (Jezero HiRISE 0.25 m at 4096 px; La Corona IGN PNOA 0.20 m; Valles CTX mosaic ~5 m, re-registered; Marius Kaguya TC 10.6 m; Shackleton hillshade from LOLA 5 m; other Earth sites Sentinel-2 10 m resampled for display). New `imagery` fields: `previewPath` (old image), `nativeResolutionM`, `widthPx`, `note`, `alignmentCheck`, `jpegQuality`, `bytes`, `tiles`/`levels`, `preview*`. Elevation and metrics unchanged. Re-running `fetch-scenarios-earth.py --force` drops these fields; run the hi-res script again afterwards.
- M5 landing visuals (branch `feature/m5-landing-cinematic`, additive, physics unchanged): `landing-stage.mjs` swaps the schematic lander for NASA's Apollo Lunar Module GLB on the Moon (`lander-visual.mjs`, asset `apollo-lunar-module` in `assets/data/nasa-assets.json`; ramp deployment labelled conceptual) and for a procedural Mars 2020 sky crane on Mars (`skycrane-visual.mjs`: lowers Perseverance on 7.6 m bridles from 20 m, cuts them and flies away; the rig gets a display-only lift because hardware is drawn ×14 while altitude is 1×). Landers, the sky crane and the rover it carries are drawn ×14 (`LANDER_VISUAL_SCALE` in `landing-stage.mjs`, equal to `ROVER_SCALE` in `mission.js`), so the delivered rover is never bigger than its vehicle; Mars uses close rig shots (`lowering`, `touchdown`, `cut`) that frame rover, bridles and stage together. The cinematic camera fades the slope grid and the forecast line during descent/contact/deployment (other cameras keep them); the old contact-shadow disc is drawn only when real shadow maps are off; nozzle halos and a ground light pool scale with throttle (additive, no post-processing). `landing-cinematic.mjs` adds the cinematic camera (new default «Cinematic» option), engine plumes, engine light, body-specific dust and touchdown bounce. `landing-view.mjs` gains `focusPosition(key)` and a few wiring lines.
- Lighting (`scene-lighting.mjs`, `terrain-shader.mjs`): ACES tone mapping, per-scene exposure (`exposureFor`), one focus shadow map per terrain scene, terrain material patched via `onBeforeCompile` (display-only micro-detail, slope tint, frost/dust from WeatherState); scene-fx's context ring is patched from outside by name (`fx-context-ring`).
- `tests/mission-audit.test.mjs` (M2): the `Recursos_NASA` row count is now derived from the manifest (`assets.length + 6`) instead of a hard-coded 15, because a NASA asset was added; same value as before.

- Module 5 lander visual (additive): `assets/data/nasa-assets.json` gains an eighth GLB, `apollo-lunar-module` (role `lander-visual`, NASA/Michael D. Carbajal, Draco decoded offline). The seven required IDs in §7 are unchanged and it is not part of the NASA explorer gallery. `lander-visual.mjs` exposes `createLunarLander` / `createSchematicLanderFallback` (origin on the foot-pad plane, forward −Z, real metres × `unitsPerMeter` × `visualScale`). Ramp deployment stays conceptual: the Apollo LM never deployed rovers by ramp. Shared test touched: `tests/mission-audit.test.mjs` now derives the `Recursos_NASA` row count from the manifest (`assets.length + 6`) instead of hard-coding 15.
- Mission Control physics summary remediation: `physics-evidence.mjs` presents existing regional pitch/roll and Earth/target thermal-model states without changing physics, simulation or export contracts. Combined tilt requires two finite components; missing/partial readings remain unknown, and every tilt summary explicitly disclaims local stability certification. Thermal conclusions retain both input states and model margins, reserve joint nominal wording for two known nominal readings, and keep missing/inconsistent outputs unknown. Source domains remain distinct from measured rover hardware temperature. `mission.js` only wires these summaries into the existing plain cards; the legacy energy card is unchanged.

- Module 5 Earth expedition: added the independent `earth-expedition/1` plan/run/report domain, scoped Terrain 3D preparation and inspection controls, actual planned 3D stops, and standalone JSON/Markdown evidence. Mission JSON adds optional `earthExpedition`; provider context uses the same bounded `earthExpedition` root. Earth sessions never enter `LandingRunPayload`, fixed M2 profiles or destination tracking. Shared wiring is limited to selection, active rover/control dispatch, report identity and copilot scope in `mission.js` / `index.html`; styles and pure logic are separate files. See [Earth expedition contract](#earth-expedition-domain) and [usage/model](modules/earth-expedition.md).
- Module 5 dossier: `dossier-session.mjs` owns scenario selection and generation revisions. Superseded loads, errors and provider cleanup cannot publish into another selection; context is committed only with matching scenario/Earth/target IDs. Loading or failed terrain leaves generation disabled, and downloaded Markdown retains its requesting scenario. Request/response schemas are unchanged. Evidence: [dossier request isolation](evidencias/dossier-session/README.md).
- AI transport: both endpoints use bounded `provider-context/1` projection through `flatten_context`, with independent decision-section budgets and reserved `contextProjection` / `contextProjection.sections.<section>` completeness and omission metadata. Original factual paths, values, units and nulls remain intact; raw raster/path/history series are excluded explicitly. Dossier values use JSON null/boolean syntax. Expedition, scenario/site/DEM, landing and preparation citation roots are additive; provider configuration, endpoint schemas and input-token limits are unchanged. Full details and provider-wire verification: [AI context coverage](modules/ai-context.md).
- Earth execution wiring: the shared navigation radar uses expedition stops in both Auto and Manual, with a next-stop indicator. Earth integrates elapsed wall time (maximum 1 s per rendered frame) in bounded 0.1 s rover substeps, and pauses on page hiding; destination flight/rover timing is unchanged. Pilot selection is retained with each Earth/destination session rather than carried across modes. Site telemetry captures its requested ID before awaiting, source-table grid labels reflect the actual selected DEM, and final Earth evidence has an explicit closure cutoff. The scoped panel links directly to existing 3D/camera/drive controls.
- Module 5 / Earth expedition (additive, `earth-expedition/1`): Terrain 3D owns independent `earth-…` preparation/run/report sessions and a frozen, fingerprinted DEM snapshot. The existing shared rover controls and kinematics execute confirmed Earth stops; destination landing and M2 recording retain their own identities. `mission.js` selection prefers existing paired Earth DEMs with an explicit catalogue fallback, renders the same planned stops in 3D, and guards late site/benchmark loads. No new dependency or regenerated data is required.
- Mission JSON now adds `earthExpedition` only for the current loaded Earth expedition (otherwise null). Its `site` is resolved from the active mode, and `site.lat/lon` describe the DEM centre with `catalogueReference` retained separately; `dem` additively exposes id, body, fingerprint, centre/bbox, extent and native/effective resolution. This fixes the pre-existing destination export using an unrelated catalogue site. Existing landing, preparation, dossier, path and spreadsheet contracts remain intact. Standalone Earth JSON/Markdown carry plan/load, inspected stops, actual path, UTC/SIM/source domains, limitations and next validation actions; no Earth run is passed as a LandingRunPayload or fixed M2 destination profile.
- Copilot context dispatch now follows active domain/site/session. Earth uses bounded `earthExpedition` evidence, explicit missing-data reasons and local rules when needed; globe has no run context, while destination retains its existing provider/audit/process context. Conversation history resets on identity changes, and late responses are gated by scope plus epoch. The Earth context excludes raw DEM/path/events and all destination flight/M2 tracking evidence. Copy and report exports use the same source session. See `docs/modules/earth-expedition.md` for model/usage and `docs/evidencias/earth-expedition/` for acceptance artifacts.

- Integration: preserved local landing/preparation and M2 inspector work alongside the latest Discovery, AI provider and Mission Dossier modules. Shared startup accepts `.venv`, `.venv-server` and `ATLAS_PYTHON`; `npm run check` retains the team's automatic syntax discovery. No published terrain data was regenerated.
- shortcut: inherited Spanish UI and documentation from the preserved local work remain until a dedicated localization pass; new Earth expedition surfaces use English.
- Frente 5: `thermalStatus` sin temperatura devuelve `level:"unknown"` y `marginK:null` (cuarto nivel, como `slopeAlert`).
- Frente 5: `attitude` con rejilla inválida devuelve `{ pitchDeg:null, rollDeg:null }`; comprobar antes de formatear.
- Frente 1: campos aditivos `metrics.roughness.{stdDb, polarization, acquired, license, credit}`, `imagery.{product, acquired, sceneCloudCoverPct, windowCloudFraction}` y en raíz `license`, `demCredit`. La rugosidad Tierra (dB, S1 RTC) nunca coincide en unidad con Luna (CPR, Mini-RF), así que `compareTerrain` ya la excluye; no hace falta comparar polarización mientras no haya pares Tierra–Tierra.
- Frente 3: errores extra 503 `ai-provider-unavailable`/`telemetry-unavailable`, 429, 413, 422; caché vieja con `live:false, cached:true`; cualquier valor de `values` puede ser `null`.
- Frente 4: si `/api/health` da `ai:"none"`, el frontend no llama a `/api/copilot` y usa reglas locales.
- Frente 5: `compareTerrain` acepta una rejilla §2, el objeto de contexto §5 o un objeto `metrics` directamente.
- Repo: contratos por módulo movidos a `docs/modules/`; propiedad de archivos solo en `AGENTS.md` §3.
- Módulo 2: extensión aditiva §6 con contrato v1.0.0, auditoría/cálculo JS puro, dossier JSON/Markdown y contexto `analogyAudit`; los contratos anteriores permanecen vigentes.
- Module 5: added `POST /api/dossier` and the S.E.L.E.N.E. Ops Mission Dossier workspace. The endpoint shares the protected OpenAI-compatible provider configuration with `/api/copilot`; it does not expose credentials. Shared primary navigation is now Mission Control, Discovery, and Mission Dossier.

## 7. Recursos NASA y presentación M2

`assets/data/nasa-assets.json`: `NasaVisualAssets` **1.0.0**, `{schema,version,assets:[{id,label,body,role,localPath,format,sourceUrl,downloadUrl,credit,bytes,sha256,licenseUrl,notes,available}]}`. Siete IDs GLB obligatorios: `scarecrow`, `perseverance`, `moon`, `mars`, `lro`, `block-island`, `apollo-11`; texturas `moon-color`/`mars-color` adicionales. `available:false` es pendiente, nunca éxito de carga. Solo rutas bajo `assets/models/nasa/` o `assets/textures/nasa/`; GLB embebidos sin solicitudes externas. [Adquisición y metadatos](modules/nasa-assets.md).

La UI añade opcionalmente `visualPresentation` al dossier/misión (`AnalogVisualPresentation` 1.0.0): `{schema,version,mode:"offload"|"equivalent",factor,roverReference,normalizedScale:true,scientificSource:false,inspectionSource:"mission"|"design"|"manual",methodRelevant:boolean}`. `inspectionSource` records the selected calibration source; individual factor views may also display independently sourced scenario DEM/environment data. `methodRelevant` is true only for gravity/contact factors, and normalized scale applies to the NASA mesh rather than the explicitly scaled DEM/quantity diagrams. Es metadata de presentación, no entrada de calibración ni extensión del contrato de servidor. `createDossier` puro sigue siendo independiente de escenas. El cuerpo, masa y resultados de `audit.calibration` conservan su significado original; la masa equivalente se deriva de su resultado `gravity.equivalentEarthMassKg` y no reemplaza `inputs.massKg`. [Modos, coordenadas y límites](modules/modulo-2.md#banco-visual-3d-y-explorador-nasa).


## M2 automático, sesión y workbook

`rover-config.mjs` exporta `ROVER_CONFIG` (`id=atlas-prototype-v1`, `source=prototype-config`, `massKg=350`). Simulación y `automaticEngineering(candidate)` consumen esa fuente. `calibration.kind=mission-config` añade `origins` por variable (`mission-config/reference/idealization/weather-model/archive/missing`); la calculadora pura conserva `user-assumption`. Se mantiene CandidateAnalogPayload 1.0.0 con `scenario.focus` opcional; metadatos meteorológicos nuevos son aditivos.

Sesión: `{id, scenario, startedAt, endedAt, latest, rover[], weather[], events[], policy}`. Muestra rover `{utc, elapsed, x, z, heading, speed, distance, battery, latitude, longitude, slopeDeg, pitchDeg, rollDeg, loadW, solarW, kind:sim}`. `elapsed` usa segundos SIM ×20; UTC usa reloj real. Intervalo10s/max2160, clima256 (dedup sitio/proveedor/observedAt), eventos500, sesiones6; memoria sin persistencia al reload. Cambio/reinicio cierra y abre sesión. Muestras del escenario anterior y respuestas tardías nunca se añaden a la nueva sesión.

`missionWorkbook({cutoffUTC,candidate,audit,session,manifest})` escribe OOXML/ZIP STORE+CRC32 de 12 hojas sin fórmulas/código externo. El snapshot es copia aislada tomada al clic; el laboratorio manual no es fuente de los reportes ni del copiloto. Excel conserva fuentes y ausencias, cuerpos, coordenadas, resoluciones y fechas del DEM, observación/captura, unidad por variable, modelo/cache/archive/sim/unknown y las dos alternativas estáticas. Datos fuente faltantes nunca se sustituyen por hipótesis ocultas.

## 8. Módulo 3 · Procesos y clima visual

Pronóstico, ventanas de proceso, `WeatherState`, escena 3D y contexto ampliado: [`modules/m3-processes.md`](modules/m3-processes.md).

### MissionBaseProfile y representación XLSX

`mission-profiles.mjs` expone `BASE_PROFILE_VERSION`, `getMissionBaseProfile(scenarioOrId)` y `validateMissionBaseProfile(profile)`. Su esquema y sus cuatro IDs están documentados en [perfiles-base-m2.md](modules/perfiles-base-m2.md). `missionDesignEngineering(candidate, profile?)` devuelve `{profile, calibration, scope, airSource}` y evalúa únicamente el banco propuesto, con gas a la temperatura de pared declarada. No modifica `automaticEngineering`, el candidato, la configuración del rover ni el historial.

Los snapshots de descarga y los dossiers JSON añaden `baseProfile` de forma compatible. El exportador permite snapshots previos sin ese campo, resuelve exclusivamente `candidate.scenario.id` y valida que un perfil adjunto pertenezca a la misión. Los valores ausentes del JSON canónico se mantienen como `null`; sus celdas XLSX contienen estado y causa, y ninguna ausencia se convierte en lectura cero. Las filas decorativas, fusiones y el espacio bajo el gráfico son vacíos estructurales; las regiones de datos rectangulares desde la fila 7 no admiten celdas vacías.

Los números térmicos base son setpoints del banco, sin fecha de observación; `revisionDate` fecha el perfil y no una lectura. Las observaciones meteorológicas disponibles conservan prioridad y su fecha/fuente. La columna de masa de instrumentos se expresa por unidad y con ámbito; los 350 kg del prototipo siguen siendo independientes de mallas NASA y de propuestas de componentes.

## 11. Descenso final y captura de misión M2

`landing-profiles.mjs` y `landing-physics.mjs` son el motor puro descrito en [descenso-modelo.md](modules/descenso-modelo.md). `getLandingProfile(body)` devuelve una copia `LandingProfile` 1.0.0 propuesta; `evaluateLandingZones(grid,{profile,sciencePoint})` produce `LandingZonePlan` 1.0.0 con candidatos regionales y `selectedId` anulable. `createDescent`, `stepDescent`, `abortDescent` y `summarizeDescent` conservan estados aislados; el resumen exportable es `LandingRunSummary` 1.0.0, sin raster. Cero candidatos elegibles impide forzar un contacto. `outcome.success` significa exclusivamente cumplir chequeos del modelo.

`createLandingController().configure(config)` usa por defecto `missionMode:'target-first'`, `primarySide:'target'`: solo vuela Luna/Marte. `missionMode:'paired-legacy'` explícito conserva dos vuelos virtuales y `primarySide:'earth'`. Los perfiles/planes Tierra pueden mantenerse como referencia de evaluación; nunca equivalen a un descenso terrestre realizado. La misión elige zona y combustible del objetivo; no solicita un segundo aterrizaje. Cada configuración inicia una sesión lista con opciones `{timeScale:1,deploymentMode:'manual'}`; cada configuración limpia captura, historial, eventos y autorización anteriores. `setOptions({timeScale?,deploymentMode?})` devuelve booleano: admite tasas numéricas `0.5|1|2|4` y modo `manual|automatic`; un campo desconocido, valor inválido o cambio de modo después de `start` rechaza toda la actualización sin mutar estado ni emitir eventos. Repetir el mismo modo es válido. `view().options`, `inspect().options` y `snapshot().options` son copias aisladas. `FLIGHT_RATE=4` sigue exportado para compatibilidad legacy; el factor activo proviene de las opciones, no de esa constante.

La tasa puede cambiar en vuelo o pausa: conserva posiciones, masas, velocidades, fase, estado de pausa y `simSeconds`; publica inmediatamente el factor vigente y un evento `time-scale-change` solo cuando cambia después del inicio. No agrega una muestra ni avanza SIM por el cambio. Cada `step(realDt)` limita el frame real a un segundo e integra el descenso con `min(realDt,1)*timeScale`; el motor conserva subpasos SI de hasta 0,05 s. Preparación y demoras de despliegue conservan segundos de frame real. UTC, SIM descenso y SIM rover no se sustituyen entre sí.

En target-first manual, cuando el vuelo objetivo termina con contacto nominal, la fase global pasa a `contact`, `running=false`, publica inmediatamente y emite una sola espera `deployment-waiting`; `endedAtUTC` permanece `null` y el rover sigue retenido indefinidamente. `pause(true)` o reanudar no autorizan despliegue. `requestDeployment()->boolean` solo acepta esa fase con objetivo en `contact`; publica `phase:'deployment'`, `running:true`, demora cero y `deployment-authorized`. El siguiente `step` inicia el despliegue existente (`deployment`), y al completar la demora libera el rover/callback una sola vez (`exploration`). Reintentos, vuelo en curso, fallo objetivo, aborto o ausencia de DEM objetivo rechazan autorización sin eventos. La ausencia del DEM Tierra no bloquea descenso ni despliegue objetivo; limita el espejo. El fallo objetivo bloquea aunque la referencia Tierra sea válida. En paired-legacy, los gates antiguos se mantienen: ambos vuelos terminales y contacto Tierra nominal. En modo `automatic`, seleccionado antes de iniciar, se conserva el flujo de contacto, demora y despliegue automático; no emite espera ni autorización de operador.

`start(missionId,{initial})` conserva las condiciones SI del motor, compartidas o por lado: `{earth:{propellantKg},target:{propellantKg}}`. La interfaz convierte el porcentaje elegido del presupuesto del perfil objetivo a kg (por ambos lados solo en paired-legacy) antes de invocarlo. La captura inicial y `initial-conditions` conservan esos valores reales, incluidos combustible reducido o cero; los máximos de perfil, masa seca y tolerancias permanecen iguales. Agotar combustible conserva el fallo físico y no convierte un contacto fuera de tolerancias en éxito.

El productor de interfaz entrega `createAuditPanel(...).landing(payload)` después de obtener `snapshot().session.id` de la sesión iniciada/reiniciada. Devuelve `{valid,errors}`; un rechazo conserva atómicamente la última captura válida. El método y `createMissionRecorder().landing(...)` aceptan:

```js
{
  schema: 'LandingRunPayload', version: '1.0.0',
  missionId, scenarioId, startedAtUTC, endedAtUTC: null, phase,
  missionMode: 'target-first', primarySide: 'target',
  explorationOrigins: {
    earth: {x: 0, z: 0, elevationM, gridId: earthId, georeference: null,
      role: 'analogue-test-origin'}, // o null si no hay superficie válida
    target: null // solo contacto nominal: {x,z,gridId,georeference,role:'target-contact',...}
  },
  mirrorAvailable: false,
  timeScale: 1, options: {timeScale: 1, deploymentMode: 'manual'},
  profiles: {earth: earthProfile, target: targetProfile},
  plans: {earth: earthPlan, target: targetPlan},
  runs: {earth: null, target: targetSummary},
  history: [{utc, simSeconds, earth: null, target: targetSummary}],
  events: [{utc, simSeconds, type, detail}], limitations: ['...']
}
```

Cada lado de `profiles` y `plans` puede ser `null` cuando falta. En target-first `runs.earth` y cada `history[].earth` son obligatoriamente `null`: **No aplica: sin descenso terrestre**, no un fallo ni un dato de vuelo faltante. `runs.target` puede ser `null` cuando no hay captura; nunca equivale a contacto. Un payload histórico 1.0.0 sin las cuatro extensiones mantiene su validación previa; no se le infiere target-first. La fase global es `ready|preparation|descent|contact|deployment|exploration|hard-contact|aborted|unavailable`. Cada resumen físico conserva `ready|descent|contact|hard-contact|aborted|unavailable`, aunque el rover se esté desplegando/explorando. `landingId`, `timeScale` y `options` son extensiones opcionales del productor, sin reemplazar la identidad de sesión; `payload.timeScale` y `payload.options.timeScale` reflejan siempre el factor vigente al corte. Los eventos nuevos mantienen `{utc,simSeconds,type,detail}` con detalle textual y SIM obtenido de los vuelos, también durante espera o cambio de tasa sin avance físico.

El reporte comprueba schema/version, perfiles, IDs exactos de misión/escenario/DEM/cuerpo, UTC, números SI finitos y magnitudes no negativas donde corresponde. Rechaza raster/mallas, poses corruptas, contacto sin AGL cero y chequeos, capturas anteriores al inicio de sesión, retroceso SIM y regresiones de fases terminales. Valida missionMode/primarySide, roles, orígenes y coherencia con plan/cuerpo/DEM/contacto; rechaza vuelo Tierra inventado en target-first, espejo sin orígenes y contacto/despliegue/exploración globales cuando falla el objetivo. Conserva copias acotadas a las últimas **1200 muestras y 300 eventos**; el productor muestrea a 2–5 Hz como máximo, sin capturar cada frame. `begin`/reinicio/cambio deja `landing:null` y una captura antigua no puede adjuntarse a la nueva misión.

`snapshot().landing` y `snapshot().session.landing` son copias de la misma captura al corte; `dossier().landing` y `dossier().mission.landing` conservan esa evidencia en JSON. Antes del ensayo son `null`. Markdown incluye perfiles, planes, resultados, razones y límites mediante `landingMarkdown`. `context().landing` añade al resumen automático `analogyAudit` perfiles, estados y candidatos seleccionados propios; omite historial/eventos/raster. El laboratorio manual y el replay no sustituyen esta captura automática. El exportador XLSX rechaza IDs cruzados o dos capturas discrepantes entre snapshot y sesión.

**Tres relojes:** UTC de captura/observación, `simSeconds` del descenso y `elapsed` del rover acelerado ×20 tienen ámbitos diferentes. `verticalSpeedMs` es velocidad con signo, positivo hacia arriba; la velocidad vertical de `contact` es la magnitud relativa al suelo usada por los chequeos. `altitudeM` es AGL y `yM`/`groundElevationM` usan datum DEM. x este/z sur están en metros SI; exageración visual ×2 no cambia la dinámica. En target-first Tierra tiene un origen automático sobre superficie válida del DEM (centro o referencia), con rol `analogue-test-origin`; no es contacto de nave. El objetivo tiene origen `target-contact` solo desde contacto nominal, con x/z/elevación/DEM/georreferencia consistentes con su resumen. `mirrorAvailable` requiere ambos orígenes y contacto objetivo, independientemente de autorización de despliegue. Se conserva `S.rover` como conducción/ensayo Tierra: `targetRover = contactoTarget + (roverEarth − origenEarth)`. Cada cuerpo conserva su georreferencia; compartir desplazamiento no afirma homología geográfica. No hay telemetría de hardware.

El libro mantiene **12 hojas sin ensayo y 15 con captura**: añade `Descenso`, `Trayectoria` y `Zona_ensayo`, con filtros A6/congelado A7 y estilos Mission Control. La portada resume fases sin mover las referencias del gráfico estático (`Resumen!A25:C26`). En target-first Descenso presenta primero objetivo principal y después Tierra análogo/referencia, con propósito y orígenes; los perfiles Tierra se identifican como referencia, sin vuelo. Trayectoria incluye únicamente vuelos realizados (una fila por muestra objetivo; no filas Tierra nulas). Descenso separa masa seca/carga útil/propelente de la nave y los 350 kg del rover, Isp, empuje, condiciones, hipótesis y tolerancias propuestas. Trayectoria conserva UTC/SIM, AGL, velocidades, empuje, combustible y pose; Zona conserva ranking razonado, selección, fuentes, resolución nativa/efectiva, cobertura y distancia al centro científico. JSON usa ausencias `null`; Excel muestra su causa, sin sustituirlas por cero ni por una base de diseño.

El copiloto local detecta aterrizaje/descenso/landing/combustible/contacto; responde desde `analogyAudit.landing` (o `landing` explícito), declara faltantes y rutas `grounded`. La recomendación de descenso expresa alcance exploratorio, sin autorización operativa. No se añadió endpoint ni se probó proveedor LLM externo. M2 mantiene Tierra vs objetivo como evaluación: no intercambia cuerpos, gravedad ni presiones al renombrar la misión. Clima Tierra y herramientas propuestas no se atribuyen al planeta. `context().roverBody` sigue `earth`; `targetBody` y los roles son independientes. Tierra es análogo/control simulado (comparación virtual de vuelo solo en paired-legacy), Luna sin atmósfera y Marte solo tramo propulsado final idealizado; no hay entrada/paracaídas, TRN/visión NASA implementados ni zona segura certificada.

Evidencia target-first: [misión destino y reportes](evidencias/mision-destino-reportes/informe.md). Evidencia histórica paired: [descenso-informe](evidencias/descenso-informe/INFORME.md), sin sobrescribir los ejemplos aprobados de Excel previos.

- M1: `terrain_metrics.geometric_index` y `geo_index` (discover-analogs) acumulan con bucle simple en vez de `sum()` (compensada desde Python 3.12) para coincidir con `similarity.mjs` en empates exactos de .5; sin cambio de contrato.

## Earth expedition domain

`earth-expedition.mjs` defines an independent `earth-expedition/1` schema with `domain:earth-field-expedition`, `body:earth` and an `earth-…` session ID. `createExpedition` snapshots the selected Earth site, a deeply frozen DEM, objective/configuration, ordered stops and an optional published planetary benchmark. The DEM fingerprint includes its source, date, centre, dimensions and elevations; it is an identity check, not a claim of survey accuracy. Catalogue coordinates remain a separate reference from the actual DEM centre.

Preparation validates finite configuration, 2–6 distinct stops, supported DEM coverage, sampled direct-leg slopes and the illustrative drive allowance. Explicit confirmation captures configuration/stops/DEM identity and positions the held rover at stop 1. Starting is a separate action. Changed assumptions, stops, DEM or site invalidate readiness or stop an incompatible run; reset creates a new identity. Auto follows the selected stops; Manual uses the same Earth kinematics. Arrival pauses for an explicit inspection at the actual pose. Finish preserves complete or partial coverage and a corresponding next-validation decision. UTC, source acquisition and accelerated SIM are separate clocks. Hidden/paused sessions do not advance.

`expeditionReport` produces an isolated cutoff with site/DEM/source/scale, objective, confirmed preparation, current rover, actual path, inspections, observations, environmental context, bounded events, benchmark, decision, model assumptions and limitations. Inspections distinguish DEM-derived interpolation, simulated rover/battery, archived/current site-window weather and operator interpretation; no material, subsurface or hardware measurement is inferred. Missing weather/benchmark remains null with a reason. The last three started reports may be retained in the tab; this is not durable server storage.

Mission JSON's optional `earthExpedition` is populated only in Terrain mode. Existing destination `scenario`, `analogyDossier`, `landing`, `preparation` and target-rover fields keep their own domain and are absent/null for an Earth expedition. Site/DEM metadata must describe the active Earth window rather than a stale catalogue selection; an optional catalogue reference is identified separately. The fixed destination M2 workbook contract and `CandidateAnalogPayload` remain unchanged; standalone Earth JSON/Markdown is the actual field-run report, while Mission Dossier remains explicitly scenario synthesis.

`expeditionContext` omits raw DEM/path/event histories and retains bounded objective/configuration/stops, inspection evidence, source/scale, benchmark and decision. Copilot ownership is keyed by active mode/site/session and a request epoch; stale replies and history must not cross a mode or session change, including returning to the same identity after visiting another view. Earth local rules use their captured context; available provider transport retains its existing interface and applies the bounded projection described in [AI context coverage](modules/ai-context.md).

These constraints support remote reconnaissance and experiment planning. A completed SIM traverse is neither a certified field route nor planetary equivalence. Published topography comparison uses four existing geometry components with explicit scale caveats; geology, traction, structure, radiation and other missing dimensions require their own evidence. Full model, source roles, controls and verification: [Earth expeditions](modules/earth-expedition.md).
## Module 4 evidence contracts

- M4: Discovery links to the standalone route explorer with `target` and `candidate` identifiers in the URL. It reads the published Module 1 DEM without changing the candidate schema. Optional local-relief constraints and modeled shadow remain local to Module 4. Valid routes can be exported as `M4RouteEvidenceGeoJSON` version 1 with approximate coordinates, settings, source resolution, and caveats; route results are not yet in the shared dossier. All 19 published Discovery candidates and four fixed Earth references read their own `M4SpatialSarPair` version 1 under `assets/data/m4/`; fixed references also read Module 3 SAR histories. The Marius reference reads `M4SurfaceDtmCrop` version 1 and LROC pit measurements. Reference evidence never transfers to Discovery candidates. These are additive M4 files and do not change `CandidateAnalogPayload`, scenario grids, or the Module 3 process-history format. See [Module 4 sources, schemas, and limits](modules/m4-routes.md).
- M4: Added two optional, site-bound published evidence files under `assets/data/m4/`: `M4CaveSections` version 1 for La Corona's 74 independent local 2-D interior outlines, and `M4LocalDemCrop` version 1 for a 1 m USGS bare-earth patch at `cand-valles-marineris-05`. Missing station coordinates, section-specific roof depths, and vertical-accuracy metadata remain `null`. The local terrain-break residual is a scenario screen and does not alter the regional route or claim object detection. Neither format changes `CandidateAnalogPayload` or any other module's schema. See [Module 4 sources, schemas, and limits](modules/m4-routes.md).

shortcut: This shared contract file retains legacy Spanish prose; translate it in a coordinated shared-document pass to avoid a large cross-module diff.
