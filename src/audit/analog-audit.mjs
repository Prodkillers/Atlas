// Módulo 2: motor puro, sin DOM/red. SI; referencias y límites en docs/modules/modulo-2.md.
import { BODY_ENV } from '../shared/sim-physics.mjs';
import { compareTerrain } from '../shared/similarity.mjs';

export const CONTRACT_VERSION = '1.0.0';
export const AUDIT_VERSION = '1.0.0';
export const SIGMA = 5.670374419e-8; // W m⁻² K⁻⁴, NIST CODATA (redondeado)
export const SOURCES = Object.freeze({
  gravity: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html',
  moon: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
  mars: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
  weight: 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/weight-equation-2/',
  thermal: 'https://www.nasa.gov/smallsat-institute/sst-soa/thermal-control/',
  sigma: 'https://physics.nist.gov/cgi-bin/cuu/Value?sigma',
  radiation: 'https://www.nasa.gov/directorates/esdmd/hhp/space-radiation/',
});
export const LIMITS = Object.freeze([
  'Mass (kg) does not change with the body; weight is a force (N).',
  'Vertical offloading matches only the static load on level ground; it does not reproduce inertia, dynamics, cohesion, soil confinement, traction or terramechanics.',
  'For a wheel, the mass is the one supported by that wheel; no uniform distribution is assumed. For a drill, cutting force, torque and active thrust are not calculated.',
  'Vacuum, convection, ionizing radiation, chemistry and dust are not offset by a universal factor. Dedicated tests are required.',
  'Air temperature, surface temperature and radiative sink are distinct quantities. None is automatically substituted for another.',
  'Froude number, speed, time, dose and GO/NO-GO authorization are not evaluated; no site or instrument is certified.',
]);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (v) => structuredClone(v);
const quantity = (value, unit, kind, source, observedAt = null) => ({ value: finite(value) ? value : null, unit, kind: finite(value) ? kind : 'unknown', source: source || null, observedAt });
const pressureRef = (body) => body === 'moon'
  ? quantity(0, 'Pa', 'idealization', SOURCES.moon) // vacío ideal; NO presión medida de la exosfera
  : body === 'mars' ? quantity(636, 'Pa', 'reference', SOURCES.mars) : quantity(null, 'Pa', 'unknown', null);
export function referencePressure(body) { return pressureRef(body); }

function adaptSite(grid, body, id, telemetry = null) {
  const env = BODY_ENV[body];
  const gravity = finite(grid?.environment?.gravityMs2) ? grid.environment.gravityMs2 : env?.gravityMs2;
  const source = body === 'moon' ? SOURCES.moon : body === 'mars' ? SOURCES.mars : SOURCES.gravity;
  const surface = grid?.thermal;
  const weather = telemetry && telemetry.site === id ? telemetry : null;
  const kind = weather?.provider === 'snapshot' || weather?.live !== true ? 'archive' : 'weather-model';
  // Solo presión de superficie explícita; nunca pressureMslPa ni texto "101 kPa".
  const localPressure = weather?.values?.surfacePressurePa;
  return {
    id: id || null, name: grid?.name || id || null, body,
    center: clone(grid?.center || null), environment: clone(grid?.environment || null),
    grid: grid ? { gridSize: grid.gridSize ?? null, spacingMeters: grid.spacingMeters ?? null,
      extentMeters: grid.extentMeters ?? null, nativeResolutionMeters: grid.nativeResolutionMeters ?? null,
      dataset: grid.dataset || null, source: grid.source || null, fetchedAt: grid.fetchedAt || null,
      license: grid.license || null, credit: grid.demCredit || null } : null,
    metrics: clone(grid?.metrics || null),
    gravity: quantity(gravity, 'm/s²', 'reference', source),
    pressure: body === 'earth' ? quantity(localPressure, 'Pa', kind, weather?.source?.url, weather?.observedAt) : pressureRef(body),
    airTemperature: quantity(body === 'earth' && finite(weather?.values?.temperatureC) ? weather.values.temperatureC + 273.15 : null,
      'K', kind, weather?.source?.url, weather?.observedAt),
    surfaceTemperature: { minK: surface?.minK ?? null, maxK: surface?.maxK ?? null, meanK: surface?.meanK ?? null,
      kind: surface?.kind || 'unknown', source: surface?.source || null },
    ionizingDoseRate: quantity(null, 'Sv/s', 'unknown', null),
    telemetry: clone(weather),
    provenance: clone(grid?.provenance || []), notes: clone(grid?.notes || []),
  };
}

/** Adaptador de los escenarios/rejillas reales de Atlas; no modifica sus entradas. */
export function buildCandidateAnalogPayload(input = {}) {
  const { scenario, earthGrid = null, targetGrid = null, telemetry = null } = input || {};
  return {
    schema: 'CandidateAnalogPayload', version: CONTRACT_VERSION,
    scenario: scenario ? { id: scenario.id, title: scenario.title, earthId: scenario.earthId, targetId: scenario.targetId, body: scenario.body, focus: scenario.focus || null,
      ...(scenario.zone ? { zone: { id: scenario.zone.id, revision: scenario.zone.revision, rank: scenario.zone.rank, geometry: scenario.zone.geometry || null, source: scenario.zone.source || null, manifestUrl: scenario.zone.manifestUrl || null } } : {}) } : null,
    earth: adaptSite(earthGrid, 'earth', scenario?.earthId, telemetry),
    target: adaptSite(targetGrid, scenario?.body, scenario?.targetId),
    adaptationWarnings: [
      ...(earthGrid && earthGrid.id !== scenario?.earthId ? ['Grid mismatch: the Earth grid does not match the scenario.'] : []),
      ...(targetGrid && (targetGrid.id !== scenario?.targetId || targetGrid.body !== scenario?.body) ? ['Grid mismatch: the target grid does not match the scenario.'] : []),
      ...(telemetry && telemetry.site !== scenario?.earthId ? ['Telemetry from another site discarded.'] : []),
    ],
  };
}

/** Validación explícita en la frontera pública. Los desconocidos se representan por null. */
export function validateCandidateAnalogPayload(p) {
  const errors = [];
  if (p?.schema !== 'CandidateAnalogPayload' || p?.version !== CONTRACT_VERSION) errors.push('Incompatible contract or version.');
  if (!['id', 'title', 'earthId', 'targetId'].every(k => typeof p?.scenario?.[k] === 'string' && p.scenario[k].length > 0) || !['moon', 'mars'].includes(p.scenario.body)) errors.push('Incomplete scenario or unsupported body.');
  for (const side of ['earth', 'target']) {
    const s = p?.[side];
    if (!s || s.id !== p?.scenario?.[side === 'earth' ? 'earthId' : 'targetId'] || s.body !== (side === 'earth' ? 'earth' : p?.scenario?.body)) errors.push(`${side}: inconsistent identity.`);
    for (const [key, unit, min, max] of [['gravity', 'm/s²', 0.001, 100], ['pressure', 'Pa', 0, 1e9], ['airTemperature', 'K', 0.001, 5000], ['ionizingDoseRate', 'Sv/s', 0, 1e9]]) {
      const q = s?.[key];
      if (!q || q.unit !== unit || (q.value !== null && (!finite(q.value) || q.value < min || q.value > max)) || (q.value !== null && (typeof q.source !== 'string' || !q.source || q.kind === 'unknown')) || (q && !['reference', 'idealization', 'weather-model', 'archive', 'unknown'].includes(q.kind))) errors.push(`${side}.${key}: invalid SI quantity or provenance.`);
    }
    if (!Array.isArray(s?.provenance) || s.provenance.some(v => typeof v?.label !== 'string' || typeof v?.url !== 'string')) errors.push(`${side}.provenance: invalid source list.`);
    if (!Array.isArray(s?.notes) || s.notes.some(v => typeof v !== 'string')) errors.push(`${side}.notes: invalid notes list.`);
    const th = s?.surfaceTemperature;
    if (!th || ['minK', 'maxK', 'meanK'].some(k => th[k] !== null && (!finite(th[k]) || th[k] <= 0 || th[k] > 5000))
      || (finite(th?.minK) && finite(th?.maxK) && th.minK > th.maxK)) errors.push(`${side}.surfaceTemperature: invalid range.`);
    if (s?.grid && (!finite(s.grid.spacingMeters) || s.grid.spacingMeters <= 0 || !Number.isInteger(s.grid.gridSize) || s.grid.gridSize < 2
      || !finite(s.grid.extentMeters) || s.grid.extentMeters <= 0)) errors.push(`${side}.grid: invalid scale.`);
    if (s?.metrics) {
      for (const key of ['slopeP50Deg', 'slopeP90Deg', 'reliefP95P5M', 'triMeanM']) {
        const v = s.metrics[key];
        if (v != null && (!finite(v) || v < 0 || (key.startsWith('slope') && v > 90))) errors.push(`${side}.metrics.${key}: invalid metric.`);
      }
    }
  }
  if (!Array.isArray(p?.adaptationWarnings) || p.adaptationWarnings.some(v => typeof v !== 'string')) errors.push('adaptationWarnings: invalid list.');
  else errors.push(...p.adaptationWarnings.filter(v => v.startsWith('Grid mismatch')));
  return { valid: errors.length === 0, errors };
}

/** Calculadora independiente: todos los parámetros son hipótesis del usuario en SI. */
export function calibrateEngineering(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...calibrateEngineering(), valid: false, errors: [{ field: 'input', message: 'Engineering parameters must be an object.' }] };
  const values = {}, errors = [];
  const ranges = {
    massKg: [0, 1e7, true], earthGravityMs2: [0.001, 100], targetGravityMs2: [0.001, 100],
    earthPressurePa: [0, 1e9], targetPressurePa: [0, 1e9], areaM2: [0, 1e6, true],
    surfaceK: [0, 5000, true], airK: [0, 5000, true], surroundingsK: [0, 5000, true],
    hWm2K: [0, 1e5], emissivity: [0, 1],
  };
  for (const [key, [min, max, exclusive]] of Object.entries(ranges)) {
    const v = input[key];
    values[key] = v == null ? null : v;
    if (v != null && (!finite(v) || v < min || v > max || (exclusive && v === min))) {
      errors.push({ field: key, message: `${key}: must be a number ${exclusive ? 'greater than' : 'from'} ${min} to ${max} in SI.` });
      values[key] = null;
    }
  }
  const targetBody = input.targetBody ?? null;
  if (targetBody !== null && !['earth', 'moon', 'mars'].includes(targetBody)) errors.push({ field: 'targetBody', message: 'Unsupported calculation body.' });
  const equipment = input.equipment ?? 'rover';
  if (!['rover', 'wheel', 'drill'].includes(equipment)) errors.push({ field: 'equipment', message: 'Unsupported equipment.' });
  const v = values;
  const has = (...keys) => keys.every(k => finite(v[k]));
  const gravity = { earthWeightN: null, targetWeightN: null, targetToEarthRatio: null, offloadForceN: null, equivalentEarthMassKg: null };
  if (has('massKg', 'earthGravityMs2')) gravity.earthWeightN = v.massKg * v.earthGravityMs2;
  if (has('massKg', 'targetGravityMs2')) gravity.targetWeightN = v.massKg * v.targetGravityMs2;
  if (has('earthGravityMs2', 'targetGravityMs2')) gravity.targetToEarthRatio = v.targetGravityMs2 / v.earthGravityMs2;
  if (has('massKg', 'earthGravityMs2', 'targetGravityMs2')) {
    gravity.offloadForceN = v.massKg * (v.earthGravityMs2 - v.targetGravityMs2);
    gravity.equivalentEarthMassKg = v.massKg * gravity.targetToEarthRatio;
  }
  const pressure = { targetToEarthRatio: null, earthToTargetRatio: null, differencePa: null };
  if (has('earthPressurePa', 'targetPressurePa')) {
    pressure.differencePa = v.earthPressurePa - v.targetPressurePa;
    if (v.earthPressurePa > 0) pressure.targetToEarthRatio = v.targetPressurePa / v.earthPressurePa;
    if (v.targetPressurePa > 0) pressure.earthToTargetRatio = v.earthPressurePa / v.targetPressurePa;
    for (const key of ['targetToEarthRatio', 'earthToTargetRatio']) {
      if (pressure[key] !== null && !finite(pressure[key])) {
        pressure[key] = null;
        errors.push({ field: 'earthPressurePa', message: 'Pressure ratio outside the representable numeric range; check both pressures.' });
      }
    }
  }
  const thermal = {
    convectionW: has('hWm2K', 'areaM2', 'surfaceK', 'airK') ? v.hWm2K * v.areaM2 * (v.surfaceK - v.airK) : null,
    radiationW: has('emissivity', 'areaM2', 'surfaceK', 'surroundingsK') ? v.emissivity * SIGMA * v.areaM2 * (v.surfaceK ** 4 - v.surroundingsK ** 4) : null,
    universalCorrectionFactor: null,
  };
  return { version: AUDIT_VERSION, valid: errors.length === 0, errors, equipment, targetBody, inputs: values, kind: 'user-assumption', gravity, pressure, thermal,
    formulas: ['W = m·g', 'r_g = g_target/g_Earth', 'F_offload = m·(g_Earth − g_target)', 'm_equiv = m·r_g (static load only)',
      'r_p = p_target/p_Earth (p_Earth > 0)', 'Q_conv = h·A·(T_surface − T_air)', 'Q_rad = ε·σ·A·(T_surface⁴ − T_surroundings⁴)'],
    assumptions: ['Level ground, same mass, quasi-static vertical support; positive F_offload points upward and a negative value requires additional load.',
      'Positive Q = heat loss. Isothermal grey surface in a large black enclosure, view factor 1; explicit h for the gas/test, not derived from pressure.',
      'Not a full thermal balance: excludes conduction, Sun, albedo, internal dissipation and transients. External ideal vacuum: Q_conv = 0; Mars requires its own h.'],
    limitations: [...LIMITS], sources: clone(SOURCES) };
}

const evidence = (path, data) => ({ path, data: clone(data ?? null) });
function row(id, label, status, strength, breakdown, action, evidences) {
  return { id, label, status, strength, breakdown, action, evidence: evidences };
}
export function auditAnalog(candidate, engineeringInputs = {}) {
  const validation = validateCandidateAnalogPayload(candidate);
  if (!validation.valid) return { schema: 'AnalogAuditResult', version: AUDIT_VERSION, valid: false, errors: validation.errors, matrix: [], calibration: null };
  const e = candidate.earth, t = candidate.target;
  const geometry = compareTerrain(e, t);
  const scaleKnown = !!e.grid && !!t.grid;
  const sameScale = scaleKnown && e.grid.gridSize === t.grid.gridSize && e.grid.spacingMeters === t.grid.spacingMeters && e.grid.extentMeters === t.grid.extentMeters;
  const nativeOK = [e, t].every(s => s.grid && finite(s.grid.nativeResolutionMeters) && s.grid.nativeResolutionMeters <= 2 * s.grid.spacingMeters && s.metrics?.comparable !== false);
  const gravityKnown = finite(e.gravity.value) && finite(t.gravity.value);
  const pressureKnown = finite(e.pressure.value) && finite(t.pressure.value);
  const matrix = [
    row('scale', 'Regional scale', !scaleKnown ? 'unknown' : sameScale && nativeOK ? 'valid' : 'partial',
      sameScale ? 'Same window and sampling: reproducible regional comparison.' : 'Grids keep their documented scale.',
      'The grid does not resolve wheel/soil contacts, rocks or cavities; native resolution and interpolation limit the test.',
      'Measure at instrument scale before designing the test.', [evidence('earth.grid', e.grid), evidence('target.grid', t.grid)]),
    row('geometry', 'Relief · Strength vs. Breakdown', geometry.index === null ? 'unknown' : 'partial',
      geometry.index === null ? 'Insufficient metrics.' : `Geometric index ${geometry.index}/100; slopes, relief and TRI documented.`,
      'The index does not measure physical similarity; radar roughness in dB and CPR are not interchangeable.',
      'Use components and warnings to choose tasks, with no universal validity threshold.', [evidence('geometry', geometry)]),
    row('gravity', 'Gravity and static load', !gravityKnown ? 'unknown' : e.gravity.value === t.gravity.value ? 'valid' : 'breakdown',
      'Static load can be adjusted with vertical support for an explicit mass.',
      'Reduced gravity cannot be reproduced in the field on Earth; offloading weight keeps the mass and its inertia.',
      'Compute F=m·g and offload; validate dynamics and terramechanics separately.', [evidence('earth.gravity', e.gravity), evidence('target.gravity', t.gravity)]),
    row('atmosphere', 'Atmosphere and vacuum', 'breakdown', 'The terrain allows testing geometry and procedures outdoors.',
      t.body === 'moon' ? 'Earth’s atmosphere does not reproduce the lunar vacuum (exosphere). Zero Pa is a calculation idealization.' : 'Earth’s atmosphere does not reproduce the thin CO₂ gas of Mars. The pressure reference is not a site measurement.',
      'Test in a chamber with controlled composition/pressure; no scalar turns Earth air into the target.', [evidence('target.pressure', t.pressure), evidence('reference.atmosphere', t.body === 'moon' ? SOURCES.moon : SOURCES.mars)]),
    row('pressure', 'Quantitative local pressure', pressureKnown ? 'partial' : 'unknown',
      pressureKnown ? 'Explicit pressures allow computing the difference and ratios with a positive denominator.' : 'No local absolute pressure on Earth: difference and ratio unknown.',
      'Sea-level pressure is not converted to local pressure, and there is no division by the lunar zero.',
      'Keep local absolute pressure and its date; without data no difference is computed. It does not imply aerodynamic equivalence.', [evidence('earth.pressure', e.pressure), evidence('target.pressure', t.pressure)]),
    row('temperature', 'Air / surface temperature', 'unknown', 'The target thermal product and the provenance of Earth weather are kept.',
      'Earth air temperature is not surface temperature; there is no comparable Earth surface pair or synchronized series.',
      'Measure surface, air and radiative sink separately; keep nulls (including the Shackleton minimum).', [evidence('earth.airTemperature', e.airTemperature), evidence('earth.surfaceTemperature', e.surfaceTemperature), evidence('target.surfaceTemperature', t.surfaceTemperature)]),
    row('heat-transfer', 'Convection and thermal radiation', 'breakdown', 'Q_conv and Q_rad can be explored with explicit test parameters.',
      'Ideal vacuum: no external convection. Mars: unknown h coefficient. There is no universal thermal factor.',
      'Thermal chamber and model with their own geometry/materials, conduction and heat sources.', [evidence('reference.thermal', SOURCES.thermal)]),
    row('radiation', 'Ionizing radiation', 'breakdown', 'Operations and shielding geometry can be tested.',
      'Earth’s atmosphere and magnetic field alter the environment; solar irradiance in W/m² is not ionizing dose. There is no local dosimetry.',
      'Characterize spectrum, dose and shielding with dedicated tests; no scalar correction or invented dose.', [evidence('earth.ionizingDoseRate', e.ionizingDoseRate), evidence('target.ionizingDoseRate', t.ionizingDoseRate), evidence('reference.radiation', SOURCES.radiation)]),
    row('regolith', 'Regolith, dust and subsurface', 'unknown', 'The scenario provides regional context for mobility or drilling.',
      'There is no grain-size distribution, cohesion, contact moisture or mechanical strength from samples; a DEM cannot determine them.',
      'Obtain samples and mechanical tests; do not infer ice or shielding from relief or CPR.', []),
  ];
  return { schema: 'AnalogAuditResult', version: AUDIT_VERSION, candidateVersion: candidate.version, scenarioId: candidate.scenario.id,
    valid: true, errors: [], geometry, matrix, counts: Object.fromEntries(['valid', 'partial', 'breakdown', 'unknown'].map(status => [status, matrix.filter(r => r.status === status).length])),
    calibration: calibrateEngineering(engineeringInputs && typeof engineeringInputs === 'object' && !Array.isArray(engineeringInputs)
      ? { earthGravityMs2: e.gravity.value, targetGravityMs2: t.gravity.value, targetBody: t.body, ...engineeringInputs } : engineeringInputs),
    limitations: [...LIMITS], sources: clone(SOURCES) };
}

export function createDossier(candidate, audit, exportedAt = new Date().toISOString()) {
  if (!validateCandidateAnalogPayload(candidate).valid || !audit?.valid || !audit.calibration?.valid || audit.scenarioId !== candidate.scenario.id) throw new TypeError('Invalid dossier or uncorrected parameters.');
  if (!Number.isFinite(Date.parse(exportedAt))) throw new TypeError('Invalid export date.');
  return clone({ schema: 'AnalogAuditDossier', version: AUDIT_VERSION, exportedAt, candidate, audit,
    disclaimer: 'Local exploratory audit; it does not certify physical similarity, safety or mission readiness. Calculator parameters are user hypotheses.' });
}
const md = (v) => String(v ?? 'unknown').replace(/[\\`*_[\]<>#|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
export function dossierMarkdown(dossier) {
  const { candidate: c, audit: a } = dossier;
  const lines = [`# Local dossier · ${md(c.scenario.title)}`, '', `Contract ${md(c.version)} · Auditor ${md(a.version)} · ${md(dossier.exportedAt)}`, '',
    `${md(c.earth.name)} ↔ ${md(c.target.name)}`, '', md(dossier.disclaimer), '', '## Strength vs. Breakdown', '',
    '| Parameter | Status | Strength | Breakdown | Action |', '| --- | --- | --- | --- | --- |'];
  for (const r of a.matrix) lines.push(`| ${md(r.label)} | ${md(r.status)} | ${md(r.strength)} | ${md(r.breakdown)} | ${md(r.action)} |`);
  lines.push('', '## Test calculation (SI; provenance indicated in kind/origins)', '', '```json', JSON.stringify(a.calibration, null, 2), '```', '', '## Evidence and provenance', '');
  for (const r of a.matrix) for (const ev of r.evidence) lines.push(`- ${md(r.id)} / ${md(ev.path)}: ${md(JSON.stringify(ev.data))}`);
  for (const side of ['earth', 'target']) {
    lines.push('', `### ${side}`, '', `Telemetry: ${md(c[side].telemetry ? JSON.stringify(c[side].telemetry) : null)}`);
    for (const p of c[side].provenance) lines.push(`- ${md(p.label)}: ${md(p.url)}`);
    for (const n of c[side].notes) lines.push(`- ${md(n)}`);
  }
  lines.push('', '## Assumptions and limits', '', ...a.limitations.map(l => `- ${md(l)}`), '', '## References', '', ...Object.entries(a.sources).map(([label, url]) => `- ${label}: ${url}`));
  return lines.join('\n') + '\n';
}
