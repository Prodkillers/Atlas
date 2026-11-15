# Docs index

One topic, one file, in the folder that matches it. Add new docs here. **ES** = still in Spanish
(legacy; translate when you touch it, see `AGENTS.md` §1.8).

## Root of `docs/`

| File | What it is |
| --- | --- |
| [contracts.md](contracts.md) | Shared integration contracts and the «Cambios» log (partly ES) |
| [candidate-analog-payload.schema.json](candidate-analog-payload.schema.json) | JSON Schema of `CandidateAnalogPayload` |
| [ejecucion-mise.md](ejecucion-mise.md) | Running and replicating the project with `mise` (ES) |

## `modules/` — per-module contracts, specs and usage guides

| File | What it is |
| --- | --- |
| [m1-discovery.md](modules/m1-discovery.md), [module-1-discovery-spec.md](modules/module-1-discovery-spec.md) | M1 discovery: data contract and spec (ES) |
| [m2-audit.md](modules/m2-audit.md), [modulo-2.md](modules/modulo-2.md), [perfiles-base-m2.md](modules/perfiles-base-m2.md) | M2 analogy breakdown, mission base profiles (ES) |
| [m3-processes.md](modules/m3-processes.md) | M3 dynamic processes, weather, 3D scene (ES) |
| [m4-routes.md](modules/m4-routes.md) | M4 terrain, radar, subsurface and route exploration |
| [scout.md](modules/scout.md) | Scout: trace a zone, zone registry, analysis revisions and activation |
| [surface-assessment.md](modules/surface-assessment.md) | Flight Director, rocks and cavities |
| [descenso-modelo.md](modules/descenso-modelo.md), [descenso-uso.md](modules/descenso-uso.md) | Powered-descent model and usage guide (ES) |
| [earth-expedition.md](modules/earth-expedition.md) | Earth analogue field expeditions |
| [earth-analysis.md](modules/earth-analysis.md) | Independent Earth M2 inspector, automatic surface evidence and active-site processes |
| [ai-context.md](modules/ai-context.md) | Provider context and decision coverage for the copilot |
| [nasa-assets.md](modules/nasa-assets.md) | Local NASA visual assets, preparation and credits (ES) |

## `product/` — competition and pitch material

| File | What it is |
| --- | --- |
| [challenge.md](product/challenge.md) | The NASA Space Apps challenge text |
| [arquitectura_y_entregables_s_e_l_e_n_e_ops.md](product/arquitectura_y_entregables_s_e_l_e_n_e_ops.md) | Product vision, 5 modules, deliverables, user flow (ES) |
| [pitch.md](product/pitch.md) | Pitch structure (ES) |
| [demo-script.md](product/demo-script.md), [demo-script.es.md](product/demo-script.es.md) | 3-minute demo script, EN and ES |
| [recomendaciones-modulos.md](product/recomendaciones-modulos.md), [revision-propuesta-y-referentes-2025.md](product/revision-propuesta-y-referentes-2025.md) (+ `.pdf`) | Proposal review and references (ES) |

## `qa/` — verification, source audits, past reviews

| File | What it is |
| --- | --- |
| [app-status-2026-11-15.md](qa/app-status-2026-11-15.md) | Application status snapshot |
| [qa.md](qa/qa.md) | M2/NASA and M3/weather pre-merge verification (ES) |
| [source-audit.md](qa/source-audit.md), [targets-sources.md](qa/targets-sources.md) | Source audits for the 14 sites and the Moon/Mars targets (ES) |
| [design.md](qa/design.md), [plan-visual-refactor.md](qa/plan-visual-refactor.md) | Visual review and visual refactor plan (ES) |

## `evidencias/`

QA evidence written by `scripts/` (screenshots, reports, workbooks). Heavy and excluded from the Docker
image. Do not add files over 1 MB.
