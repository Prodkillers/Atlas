// Propuestas de diseño para planificar ensayos; no son mediciones ni fichas NASA.
import { ROVER_CONFIG } from '../shared/rover-config.mjs';

export const BASE_PROFILE_VERSION = '1.0.0';
const SOURCE = 'docs/modules/perfiles-base-m2.md';
const DESIGN = 'prototype-design';
const KINDS = new Set([DESIGN, 'reference', 'derived-design', 'not-applicable']);
const SCOPES = new Set(['rover-total', 'included-in-rover', 'external-kit', 'test-equipment']);
const THERMAL_UNITS = { areaM2: 'm²', surfaceK: 'K', surroundingsK: 'K', hWm2K: 'W/m²/K', emissivity: '1' };
const UNITS = {
  massKg: 'kg', powerW: 'W', radiusM: 'm', widthM: 'm', lengthM: 'm', heightM: 'm',
  diameterM: 'm', depthM: 'm', operatingMinK: 'K', operatingMaxK: 'K',
  supportedMassKg: 'kg', thrustN: 'N', torqueNm: 'N·m', pressurePa: 'Pa',
  doseRateMinGyS: 'Gy/s', doseRateMaxGyS: 'Gy/s', environmentalDoseRateGyS: 'Gy/s',
  resolutionM: 'm', fieldOfViewRad: 'rad', windSetpointMs: 'm/s',
  slopeSetpointRad: 'rad', sampleCapacityKg: 'kg', heatSetpointK: 'K',
};
const TOOL_PARAMETERS = {
  rover: ['lengthM', 'widthM'],
  wheels: ['radiusM', 'widthM', 'supportedMassKg'],
  sampler: ['diameterM', 'depthM', 'thrustN', 'torqueNm'],
  cameras: ['resolutionM', 'fieldOfViewRad'],
  'thermal-control': ['heatSetpointK'],
  dosimeter: ['doseRateMinGyS', 'doseRateMaxGyS', 'environmentalDoseRateGyS'],
  'support-bench': ['lengthM', 'widthM', 'pressurePa'],
  'external-kit': [],
};
const p = (key, label, value, unit, rationale, kind = DESIGN) => ({ key, label, value, unit, kind, source: SOURCE, rationale });
const na = (key, label, reason) => p(key, label, `Not applicable: ${reason}`, 'Not applicable', reason, 'not-applicable');
const quantity = (value, unit, rationale) => ({ value, unit, kind: DESIGN, source: SOURCE, rationale });
const limits = (min, max, rationale) => [
  p('operatingMinK', 'Proposed lower test limit', min, 'K', rationale),
  p('operatingMaxK', 'Proposed upper test limit', max, 'K', rationale),
];
const tool = (id, name, purpose, role, count, massScope, parameters) => ({
  id, name, purpose, role, quantity: count, massScope, status: 'proposed-design', connected: false, parameters,
});

// Todos los números siguientes son decisiones nominales de ingeniería para un futuro ensayo.
const SPECS = {
  'lava-tube': {
    title: 'Marius Hills · basaltic inspection',
    purpose: 'Prepare inspection of basaltic walls, shallow drilling and low-speed mobility in a lava-tube analog.',
    sampler: { name: 'Basaltic inspection drill', mass: 18, power: 100, diameter: 0.02, depth: 0.08, thrust: 120, torque: 8, min: 263.15, max: 313.15 },
    wheel: { radius: 0.25, width: 0.16, mass: 4.5, power: 35 },
    camera: { name: 'Inspection camera with lighting', count: 2, mass: 1.2, power: 18, resolution: 0.002, fov: 1.2 },
    thermal: { area: 0.8, surface: 293.15, surroundings: 283.15, h: 6, emissivity: 0.85, mass: 16, power: 150, min: 263.15, max: 313.15 },
    roverPower: 650,
    support: { name: 'Basalt bench and thermal enclosure', mass: 120, power: 1200, length: 2.4, width: 1.6, pressure: 101325, min: 263.15, max: 313.15,
      reason: 'Earth bench with basalt blocks and controlled air; setpoint pressure, not pressure measured in Lanzarote or lunar vacuum.' },
    kit: { name: 'Test support winch', mass: 25, power: 250, key: 'lengthM', label: 'Proposed cable length', value: 20, unit: 'm',
      purpose: 'External support to recover the prototype on the basalt bench; it does not enable a real descent into a lunar tube.' },
    method: 'Earth bench with linear convection and grey radiation to a uniform enclosure; it does not reproduce the Marius Hills vacuum.',
  },
  'polar-shadow': {
    title: 'Shackleton · shadow and cold test',
    purpose: 'Plan shallow extraction in chilled simulant and check an instrumented thermal capsule in a chamber, without claiming cryogenic survival of the rover.',
    sampler: { name: 'Cold core extractor', mass: 24, power: 140, diameter: 0.025, depth: 0.12, thrust: 90, torque: 6, min: 253.15, max: 303.15 },
    wheel: { radius: 0.27, width: 0.2, mass: 5, power: 40 },
    camera: { name: 'Shadow navigation camera with active lighting', count: 2, mass: 1.5, power: 24, resolution: 0.003, fov: 1.4 },
    thermal: { area: 1, surface: 273.15, surroundings: 150, h: 0, emissivity: 0.8, mass: 32, power: 600, min: 253.15, max: 303.15 },
    roverPower: 1200,
    support: { name: 'Thermal and technical-vacuum test chamber', mass: 800, power: 5000, length: 2.5, width: 2, pressure: 1, min: 150, max: 303.15,
      reason: 'Proposed 1 Pa technical-vacuum setpoint for the chamber; h=0 idealizes the residual gas and requires experimental validation.' },
    kit: { name: 'Cold trap and core container', mass: 12, power: 120, key: 'sampleCapacityKg', label: 'Proposed sample capacity', value: 0.5, unit: 'kg',
      purpose: 'Preserve cold-bench samples outside the rover; it does not represent ice detection at Shackleton.' },
    method: 'Idealized grey-radiation chamber: capsule at 273.15 K facing a 150 K wall with h=0; ignores residual gas and conduction through mounts.',
  },
  'hyperarid-salt': {
    title: 'Jezero · salt sampling',
    purpose: 'Plan surface extraction and separate handling of saline simulants, with grain inspection and controlled abrasion.',
    sampler: { name: 'Auger for saline simulant', mass: 14, power: 80, diameter: 0.03, depth: 0.1, thrust: 70, torque: 5, min: 273.15, max: 323.15 },
    wheel: { radius: 0.25, width: 0.18, mass: 4.5, power: 30 },
    camera: { name: 'Grain and salt macro camera', count: 1, mass: 1.8, power: 15, resolution: 0.0001, fov: 0.7 },
    thermal: { area: 0.6, surface: 303.15, surroundings: 293.15, h: 8, emissivity: 0.9, mass: 20, power: 180, min: 273.15, max: 323.15 },
    roverPower: 600,
    support: { name: 'Dust and saline simulant bench', mass: 180, power: 1800, length: 2.2, width: 1.8, pressure: 101325, min: 273.15, max: 323.15,
      reason: 'Earth bench in air at nominal lab pressure; not observed Atacama pressure or Jezero atmospheric pressure.' },
    kit: { name: 'Passive salt container set', mass: 3, power: false, key: 'sampleCapacityKg', label: 'Proposed total sample capacity', value: 1, unit: 'kg',
      purpose: 'Separate samples and handling blanks outside the rover budget.' },
    method: 'Heated Earth bench with controlled air: linear convection h=8 and grey radiation to the enclosure; it does not represent the Martian atmosphere.',
  },
  'wind-canyon': {
    title: 'Coprates · navigation and wind erosion',
    purpose: 'Plan navigation on a bench slope and exposure to controlled wind; the scenario keeps its targetId valles-marineris.',
    sampler: { name: 'Surface sand collector', mass: 8, power: 35, diameter: 0.06, depth: 0.03, thrust: 30, torque: 2, min: 263.15, max: 323.15 },
    wheel: { radius: 0.3, width: 0.22, mass: 5.5, power: 50 },
    camera: { name: 'Stereo navigation camera pair', count: 2, mass: 1.4, power: 20, resolution: 0.01, fov: 1.6 },
    thermal: { area: 0.9, surface: 293.15, surroundings: 283.15, h: 12, emissivity: 0.85, mass: 18, power: 220, min: 263.15, max: 323.15 },
    roverPower: 750,
    support: { name: 'Wind channel with adjustable ramp', mass: 600, power: 4000, length: 4, width: 2, pressure: 101325, min: 263.15, max: 323.15,
      reason: 'Lab air setpoint; wind and slope are test inputs, not Coprates observations or stability thresholds.' },
    kit: { name: 'Bench reference anemometer mast', mass: 2, power: 4, key: 'heightM', label: 'Proposed measurement height', value: 1, unit: 'm',
      purpose: 'Instrument the wind-channel flow from an external mount.' },
    method: 'Earth bench in forced flow: h=12 is a closure hypothesis, not derived from wind nor declared a planetary coefficient.',
  },
};

function buildProfile(scenarioId, s) {
  const operating = limits(s.thermal.min, s.thermal.max, 'Target range for protected equipment; not environmental qualification or a safety threshold.');
  const tools = [
    tool('rover', 'Atlas design-reference rover', 'Total mass and power budget of the complete prototype.', 'platform', 1, 'rover-total', [
      p('massKg', 'Total prototype mass', ROVER_CONFIG.massKg, 'kg', 'Single global mass: ROVER_CONFIG.massKg; included parts are already part of this total.'),
      p('powerW', 'Nominal power budget', s.roverPower, 'W', 'Proposed simultaneous power with margin; not measured consumption or validated endurance.'),
      p('lengthM', 'Proposed envelope length', 1.5, 'm', 'Preliminary prototype integration space.'),
      p('widthM', 'Proposed envelope width', 1.2, 'm', 'Preliminary prototype integration space.'), ...operating,
    ]),
    tool('wheels', 'Wheels and drive', 'Plan contact with the simulant and uniform nominal load split.', 'mobility', 6, 'included-in-rover', [
      p('massKg', 'Mass per wheel assembly', s.wheel.mass, 'kg', 'Target mass of one driven wheel; count six units within the 350 kg.'),
      p('powerW', 'Nominal power per wheel', s.wheel.power, 'W', 'Per-wheel motor budget for the test, not a measured traction curve.'),
      p('radiusM', 'Nominal wheel radius', s.wheel.radius, 'm', 'Proposed geometry based on mission terrain and mobility.'),
      p('widthM', 'Nominal wheel width', s.wheel.width, 'm', 'Proposed contact geometry with the simulant.'),
      p('supportedMassKg', 'Nominal supported mass per wheel', ROVER_CONFIG.massKg / 6, 'kg', 'ROVER_CONFIG.massKg/6: uniform split on level ground; not a measured distribution or the wheel’s own mass.', 'derived-design'),
      ...operating,
    ]),
    tool('sampler', s.sampler.name, 'Test acquisition of a sample of the selected simulant.', 'sampling', 1, 'included-in-rover', [
      p('massKg', 'Sampler mass', s.sampler.mass, 'kg', 'Preliminary allocation within the 350 kg.'),
      p('powerW', 'Nominal sampler power', s.sampler.power, 'W', 'Proposed power budget for intermittent sampling.'),
      p('diameterM', 'Active diameter', s.sampler.diameter, 'm', 'Proposed geometry for the simulant sample.'),
      p('depthM', 'Test depth', s.sampler.depth, 'm', 'Target bench stroke, not demonstrated penetration capability.'),
      p('thrustN', 'Test axial thrust', s.sampler.thrust, 'N', 'Actuator setpoint independent of m·g, not validated against the material.'),
      p('torqueNm', 'Test torque', s.sampler.torque, 'N·m', 'Setpoint independent of thrust; not measured strength of rock, ice or salts.'),
      ...limits(s.sampler.min, s.sampler.max, 'Target range of the protected mechanism; not sample temperature or cryogenic qualification.'),
    ]),
    tool('cameras', s.camera.name, 'Record geometry and texture during the test, with a calibratable scale.', 'inspection', s.camera.count, 'included-in-rover', [
      p('massKg', 'Mass per equipped camera', s.camera.mass, 'kg', 'Includes housing and light where applicable; per-unit allocation within the rover.'),
      p('powerW', 'Nominal power per camera', s.camera.power, 'W', 'Power allocation per camera, including proposed lighting.'),
      p('resolutionM', 'Target resolution at the test plane', s.camera.resolution, 'm', 'Detail target at a bench distance to be defined; not validated optical performance.'),
      p('fieldOfViewRad', 'Proposed field of view', s.camera.fov, 'rad', 'Preliminary optics target for the task, not a product specification.'), ...operating,
    ]),
    tool('thermal-control', 'Capsule and thermal control', 'Regulate the protected equipment and measure exchanges on the proposed bench.', 'thermal-control', 1, 'included-in-rover', [
      p('massKg', 'Thermal assembly mass', s.thermal.mass, 'kg', 'Insulation, plate and control budget included in the 350 kg.'),
      p('powerW', 'Thermal power budget', s.thermal.power, 'W', 'Proposed nominal capacity; the baseline balance omits conduction and transients.'),
      p('heatSetpointK', 'Equipment surface setpoint', s.thermal.surface, 'K', 'Same surface as the thermal model; not terrain or air temperature.'), ...operating,
    ]),
    tool('dosimeter', 'Electronic test dosimeter', 'Prepare future instrument acquisition without assigning ambient radiation to the scenario.', 'radiation-monitoring', 1, 'included-in-rover', [
      p('massKg', 'Target dosimeter mass', 0.8, 'kg', 'Housing and electronics budget; not a commercial datasheet.'),
      p('powerW', 'Target dosimeter power', 2, 'W', 'Power allocation for future acquisition.'),
      p('doseRateMinGyS', 'Target lower end of the instrument range', 1e-9, 'Gy/s', 'Instrument selection target; no calibration or ambient reading.'),
      p('doseRateMaxGyS', 'Target upper end of the instrument range', 1e-4, 'Gy/s', 'Selection target, without converting absorbed dose to equivalent dose or risk.'),
      na('environmentalDoseRateGyS', 'Ambient dose rate', 'no ambient measurement or source; the instrument range is not a mission dose'), ...operating,
    ]),
    tool('support-bench', s.support.name, 'Provide reproducible lab conditions separate from the real mission.', 'test-support', 1, 'test-equipment', [
      p('massKg', 'Proposed bench mass', s.support.mass, 'kg', 'Fixed lab equipment, excluded from the rover mass.'),
      p('powerW', 'Proposed bench power', s.support.power, 'W', 'External installation budget, excluded from rover consumption.'),
      p('lengthM', 'Usable bench length', s.support.length, 'm', 'Initial envelope to plan the test installation.'),
      p('widthM', 'Usable bench width', s.support.width, 'm', 'Initial envelope to plan the test installation.'),
      p('pressurePa', 'Bench absolute pressure setpoint', s.support.pressure, 'Pa', s.support.reason),
      ...limits(s.support.min, s.support.max, 'Proposed wall or enclosure range; in a cold chamber it differs from the protected equipment temperature.'),
      ...(scenarioId === 'wind-canyon' ? [
        p('windSetpointMs', 'Nominal channel speed', 12, 'm/s', 'Earth test input; not observed wind or a Martian saltation threshold.'),
        p('slopeSetpointRad', 'Nominal ramp slope', 0.17, 'rad', 'About 10 degrees as an initial test, without claiming a rollover or traction limit.'),
      ] : []),
    ]),
    tool('external-kit', s.kit.name, s.kit.purpose, 'external-support', 1, 'external-kit', [
      p('massKg', 'External kit mass', s.kit.mass, 'kg', 'Separate support equipment; do not add to the 350 kg without an integration redesign.'),
      ...(s.kit.power === false ? [na('powerW', 'Kit power', 'passive containers with no electrical power')] : [
        p('powerW', 'Nominal kit power', s.kit.power, 'W', 'Proposed external power, outside the rover power budget.'),
      ]),
      p(s.kit.key, s.kit.label, s.kit.value, s.kit.unit, 'Proposed nominal dimension or capacity for the support task.'),
      ...limits(273.15, 313.15, 'Target range of the external kit in the lab area; it must not be placed inside the cold chamber without redesign.'),
    ]),
  ];
  return {
    schema: 'MissionBaseProfile', version: BASE_PROFILE_VERSION, id: `m2-base-${scenarioId}`, scenarioId,
    title: s.title, revisionDate: '2026-11-14', purpose: s.purpose, kind: DESIGN, source: SOURCE,
    assumptions: [
      'Static-version design proposal; not an observation, telemetry, NASA flight datasheet or validated safety threshold. All equipment is disconnected.',
      'The rover’s only total mass is ROVER_CONFIG.massKg = 350 kg; component masses and powers are per unit and included, not added again to the rover.',
      'massScope distinguishes rover-total, included-in-rover, external-kit and test-equipment; the remaining mass is reserved for structure, power and cabling without a validated breakdown.',
      'Six wheels on level ground with a uniform nominal split of 350/6 kg per wheel; it does not represent load transfer on slopes or a measured distribution.',
      'Rover power is a simultaneous nominal budget with margin; bench and external kit have separate supply. No endurance is estimated and this consumption is not attributed to Perseverance.',
      'Sampler thrust and torque are independent actuator setpoints, not forces derived from mass times gravity, and not completed material tests.',
      s.method,
      'thermal describes only equipment surface and bench wall; not meteorological air, NASA/Diviner surface or real mission temperature. Area, emissivity and h are test hypotheses.',
      'Baseline model: Qconv=h·A·(Ts−Twall); Qrad=ε·σ·A·(Ts⁴−Twall⁴), unit view factor, steady state. Excludes Sun, conduction, dust, residual gas and internal heat; not validated thermal sizing.',
      'Operating ranges are selection targets for protected equipment, separate from wall and sample setpoints; they do not certify survival in planetary environments.',
      'The dosimeter only defines a proposed instrument range; ambient dose rate is not applicable for lack of measurement and source. No dose is inferred from NASA images or colors.',
    ],
    thermal: {
      areaM2: quantity(s.thermal.area, 'm²', 'Effective area of the proposed capsule for the bench model.'),
      surfaceK: quantity(s.thermal.surface, 'K', 'Protected equipment surface setpoint; not ground or air temperature.'),
      surroundingsK: quantity(s.thermal.surroundings, 'K', 'Bench radiative wall setpoint; not an observed planetary temperature.'),
      hWm2K: quantity(s.thermal.h, 'W/m²/K', s.method),
      emissivity: quantity(s.thermal.emissivity, '1', 'Grey emissivity assumed for design; not derived from NASA colors or textures.'),
    }, tools,
  };
}

const PROFILES = Object.fromEntries(Object.entries(SPECS).map(([id, spec]) => [id, buildProfile(id, spec)]));

// Scout zones reuse the base profile of the reference destination with the same planetary target.
const TARGET_PROFILE = Object.freeze({ 'marius-hills': 'lava-tube', shackleton: 'polar-shadow', jezero: 'hyperarid-salt', 'valles-marineris': 'wind-canyon' });

export function getMissionBaseProfile(scenarioOrId) {
  const zoneTarget = typeof scenarioOrId === 'object' && scenarioOrId?.zone ? TARGET_PROFILE[scenarioOrId.targetId] : null;
  const id = zoneTarget || (typeof scenarioOrId === 'string' ? scenarioOrId : scenarioOrId?.id);
  if (typeof id !== 'string' || !Object.hasOwn(PROFILES, id)) {
    throw new RangeError(`Unsupported mission base profile: ${String(id)}`);
  }
  return structuredClone(PROFILES[id]);
}

export function validateMissionBaseProfile(profile) {
  const errors = [];
  const error = (path, message) => errors.push(`${path}: ${message}`);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const nonempty = value => typeof value === 'string' && value.trim().length > 0 && value.trim().toLowerCase() !== 'null';
  const seen = new WeakSet();
  function scan(value, path) {
    if (value === null || value === undefined) return error(path, 'null or missing value');
    if (typeof value === 'number' && !Number.isFinite(value)) return error(path, 'non-finite number');
    if (typeof value === 'string' && !nonempty(value)) return error(path, 'empty or null text');
    if (typeof value === 'object') {
      if (seen.has(value)) return error(path, 'cyclic structure');
      seen.add(value);
      for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`);
      seen.delete(value);
    } else if (!['string', 'number', 'boolean'].includes(typeof value)) error(path, 'tipo no serializable');
  }
  scan(profile, 'profile');
  if (!object(profile)) return { valid: false, errors: [...errors, 'profile: an object is required'] };
  for (const [key, expected] of Object.entries({ schema: 'MissionBaseProfile', version: BASE_PROFILE_VERSION, revisionDate: '2026-11-14', kind: DESIGN, source: SOURCE })) {
    if (profile[key] !== expected) error(key, `${expected} required`);
  }
  if (!Object.hasOwn(SPECS, profile.scenarioId ?? '')) error('scenarioId', 'unsupported mission');
  if (profile.id !== `m2-base-${profile.scenarioId}`) error('id', 'must match scenarioId');
  for (const key of ['title', 'purpose']) if (!nonempty(profile[key])) error(key, 'text required');
  if (!Array.isArray(profile.assumptions) || !profile.assumptions.length || !profile.assumptions.every(nonempty)) error('assumptions', 'non-empty list of assumptions required');
  function provenance(item, path, allowNA = false) {
    if (!object(item)) { error(path, 'a quantity with provenance is required'); return false; }
    if (!KINDS.has(item.kind) || (!allowNA && item.kind === 'not-applicable')) error(`${path}.kind`, 'clase no permitida');
    if (!nonempty(item.source) || !/^(docs\/[^\s]+\.md(?:#[^\s]+)?|https:\/\/[^\s]+)$/.test(item.source)) error(`${path}.source`, 'local document or HTTPS URL required');
    if (!nonempty(item.rationale)) error(`${path}.rationale`, 'rationale required');
    if (!nonempty(item.unit)) error(`${path}.unit`, 'unit required');
    const value = item.value;
    if (!(typeof value === 'number' && Number.isFinite(value)) && !(typeof value === 'string' && nonempty(value)) && typeof value !== 'boolean') error(`${path}.value`, 'finite scalar value required');
    if (item.kind === 'not-applicable' && (typeof value !== 'string' || !/^Not applicable: .+/.test(value) || item.unit !== 'Not applicable')) error(path, 'not-applicable must have a reason and unit Not applicable');
    return true;
  }
  if (!object(profile.thermal)) error('thermal', 'test model required');
  else for (const [key, unit] of Object.entries(THERMAL_UNITS)) {
    const q = profile.thermal[key], path = `thermal.${key}`;
    if (!provenance(q, path)) continue;
    if (q.unit !== unit) error(`${path}.unit`, `${unit} required`);
    if (typeof q.value !== 'number' || !Number.isFinite(q.value) || (key === 'hWm2K' ? q.value < 0 : q.value <= 0) || (key === 'emissivity' && q.value > 1)) error(`${path}.value`, 'outside the model’s physical range');
  }
  if (!Array.isArray(profile.tools) || !profile.tools.length) error('tools', 'tools required');
  else {
    const ids = new Set(); let includedMass = 0, includedPower = 0;
    for (const [i, t] of profile.tools.entries()) {
      const path = `tools[${i}]`;
      if (!object(t)) { error(path, 'invalid tool'); continue; }
      for (const key of ['id', 'name', 'purpose', 'role']) if (!nonempty(t[key])) error(`${path}.${key}`, 'text required');
      if (ids.has(t.id)) error(`${path}.id`, 'duplicate identifier'); ids.add(t.id);
      if (!Number.isInteger(t.quantity) || t.quantity <= 0) error(`${path}.quantity`, 'positive integer required');
      if (!SCOPES.has(t.massScope)) error(`${path}.massScope`, 'mass scope not allowed');
      if (t.status !== 'proposed-design' || t.connected !== false) error(path, 'must be a disconnected proposed design');
      if (!Array.isArray(t.parameters) || !t.parameters.length) { error(`${path}.parameters`, 'parameters required'); continue; }
      const keys = new Set(), values = new Map();
      for (const [j, param] of t.parameters.entries()) {
        const pp = `${path}.parameters[${j}]`;
        if (!provenance(param, pp, true)) continue;
        for (const key of ['key', 'label']) if (!nonempty(param[key])) error(`${pp}.${key}`, 'text required');
        if (keys.has(param.key)) error(`${pp}.key`, 'duplicate parameter'); keys.add(param.key); values.set(param.key, param.value);
        if (param.kind !== 'not-applicable' && UNITS[param.key]) {
          if (param.unit !== UNITS[param.key]) error(`${pp}.unit`, `${UNITS[param.key]} required`);
          if (typeof param.value !== 'number' || !Number.isFinite(param.value) || param.value < 0) error(`${pp}.value`, 'non-negative SI quantity required');
          if ((param.key.endsWith('K') || ['massKg', 'radiusM', 'widthM', 'lengthM', 'heightM', 'diameterM', 'depthM', 'resolutionM', 'fieldOfViewRad'].includes(param.key)) && param.value <= 0) error(`${pp}.value`, 'strictly positive quantity required');
          if (param.key === 'fieldOfViewRad' && param.value > 2 * Math.PI) error(`${pp}.value`, 'field of view greater than one turn');
          if (param.key === 'slopeSetpointRad' && param.value >= Math.PI / 2) error(`${pp}.value`, 'ramp outside the test interval');
        }
      }
      const requiredParameters = Object.hasOwn(TOOL_PARAMETERS, t.id) ? TOOL_PARAMETERS[t.id] : [];
      for (const key of ['massKg', 'powerW', 'operatingMinK', 'operatingMaxK', ...requiredParameters]) if (!keys.has(key)) error(`${path}.parameters`, `missing ${key} (use not-applicable with a reason if appropriate)`);
      if (typeof values.get('operatingMinK') === 'number' && typeof values.get('operatingMaxK') === 'number' && values.get('operatingMinK') > values.get('operatingMaxK')) error(path, 'inverted thermal range');
      if (t.massScope === 'included-in-rover' && Number.isFinite(values.get('massKg'))) includedMass += t.quantity * values.get('massKg');
      if (t.massScope === 'included-in-rover' && Number.isFinite(values.get('powerW'))) includedPower += t.quantity * values.get('powerW');
      if (t.id === 'rover' && (t.massScope !== 'rover-total' || t.quantity !== 1 || values.get('massKg') !== ROVER_CONFIG.massKg)) error(path, 'total mass must be ROVER_CONFIG.massKg, without adding components');
      if (t.id === 'wheels' && (t.massScope !== 'included-in-rover' || t.quantity !== 6 || values.get('supportedMassKg') !== ROVER_CONFIG.massKg / 6 || t.parameters.find(v => v?.key === 'supportedMassKg')?.kind !== 'derived-design')) error(path, 'uniform nominal split requires six wheels and mass derived from ROVER_CONFIG');
      if (t.id === 'dosimeter' && t.parameters.find(v => v?.key === 'environmentalDoseRateGyS')?.kind !== 'not-applicable') error(path, 'inventing an ambient dose is not allowed');
      if (t.id === 'thermal-control' && values.get('heatSetpointK') !== profile.thermal?.surfaceK?.value) error(path, 'thermal setpoint must match the model surface');
      for (const [min, max] of [['doseRateMinGyS', 'doseRateMaxGyS']]) if (values.has(min) && values.has(max) && values.get(min) > values.get(max)) error(path, 'inverted instrument range');
    }
    for (const id of ['rover', 'wheels', 'sampler', 'cameras', 'thermal-control', 'dosimeter', 'support-bench', 'external-kit']) if (!ids.has(id)) error('tools', `missing tool ${id}`);
    if (includedMass > ROVER_CONFIG.massKg) error('tools', 'included masses exceed the total rover mass');
    const roverParameters = profile.tools.find(t => t?.id === 'rover')?.parameters;
    const roverPower = Array.isArray(roverParameters) ? roverParameters.find(p => p?.key === 'powerW')?.value : undefined;
    if (Number.isFinite(roverPower) && includedPower > roverPower) error('tools', 'simultaneous component power exceeds the rover budget');
  }
  return { valid: errors.length === 0, errors };
}
