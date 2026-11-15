import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  previewZone, parseGeoJSONText, parseScoutHash, missionLink, zoneScenarioUrl, lonLatToWorld, worldToLonLat,
  squareAround, layerBadge, polygonFromVertices,
} from '../src/scout/scout-geo.mjs';
import { buildCandidateAnalogPayload, validateCandidateAnalogPayload } from '../src/audit/analog-audit.mjs';

const POLY = { type: 'Polygon', coordinates: [[[-13.475, 29.145], [-13.415, 29.145], [-13.415, 29.195], [-13.475, 29.195], [-13.475, 29.145]]] };

test('polygon preview reports lat/lon centre, area, extent and scales', () => {
  const p = previewZone(POLY);
  assert.deepEqual(p.errors, []);
  assert.ok(Math.abs(p.center[0] - 29.17) < 1e-3 && Math.abs(p.center[1] + 13.445) < 1e-3);
  assert.ok(p.areaKm2 > 30 && p.areaKm2 < 35);
  assert.deepEqual(p.scales, [2400]);
  assert.ok(p.windows >= 4);
});

test('point preview is a square search area of the chosen size', () => {
  const p = previewZone({ type: 'Point', coordinates: [-70.1, -24.1] }, { searchMeters: 7200 });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.center, [-24.1, -70.1]);
  assert.ok(Math.abs(p.extent.eastWest - 7200) < 1 && Math.abs(p.extent.northSouth - 7200) < 1);
  assert.deepEqual(p.scales, [2400, 7200]);
});

test('preview rejects what the backend rejects', () => {
  assert.match(previewZone({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }).errors.join(), /25 km/);
  assert.match(previewZone(polygonFromVertices([[0, 0], [0.1, 0.1], [0.1, 0], [0, 0.1]])).errors.join(), /crosses itself/);
  assert.match(previewZone({ type: 'Polygon', coordinates: [[[29.1, -13.4], [29.2, -13.4], [29.2, 95]]] }).errors.join(), /Latitude/);
  assert.match(previewZone(null).errors.join(), /Choose/);
});

test('GeoJSON import accepts one Feature and explains bad input', () => {
  assert.equal(parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: POLY }] })).type, 'Polygon');
  assert.throws(() => parseGeoJSONText('{'), /Not valid JSON/);
  assert.throws(() => parseGeoJSONText(JSON.stringify({ type: 'MultiPolygon', coordinates: [] })), /MultiPolygon/);
  assert.throws(() => parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', features: [] })), /exactly one/);
});

test('hash links round-trip between Scout, Discovery and Mission Control', () => {
  const link = missionLink('zone-0123456789', 2, 3);
  assert.equal(link, 'index.html#zone=zone-0123456789&rev=2&site=3');
  assert.deepEqual(parseScoutHash(link.split('index.html')[1]), { zone: 'zone-0123456789', rev: 2, site: 3, target: null, lat: null, lon: null, from: null });
  const discovery = parseScoutHash('#lat=34.09&lon=-106.92&target=marius-hills&from=cand-marius-hills-01');
  assert.equal(discovery.lat, 34.09); assert.equal(discovery.target, 'marius-hills'); assert.equal(discovery.from, 'cand-marius-hills-01');
  assert.equal(parseScoutHash('#zone=../../etc&rev=1').zone, null);
  assert.equal(parseScoutHash('#explorador').zone, null);
  assert.equal(zoneScenarioUrl('zone-0123456789', 1, 2), '/api/zones/zone-0123456789/revisions/1/scenario?site=2');
});

test('web mercator round trip and square geometry', () => {
  const [x, y] = lonLatToWorld(-13.44, 29.17, 12);
  const [lon, lat] = worldToLonLat(x, y, 12);
  assert.ok(Math.abs(lon + 13.44) < 1e-9 && Math.abs(lat - 29.17) < 1e-9);
  const sq = squareAround(0, 0, 2400).coordinates[0];
  assert.equal(sq.length, 5); assert.deepEqual(sq[0], sq[4]);
  assert.equal(layerBadge('absent').label, 'ABSENT');
  assert.equal(layerBadge('ready').kind, 'real');
});

test('CandidateAnalogPayload keeps Scout zone identity additively and stays valid', () => {
  const zone = { id: 'zone-0123456789', revision: 1, rank: 2, geometry: POLY, source: { kind: 'user-drawn' }, manifestUrl: '/api/zones/zone-0123456789/revisions/1' };
  const scenario = { id: 'zone-0123456789-r1-s2--marius-hills', title: 'Scout zone · test', earthId: 'zone-0123456789-r1-s2', targetId: 'marius-hills', body: 'moon', zone };
  const p = buildCandidateAnalogPayload({ scenario });
  assert.deepEqual(p.scenario.zone, zone);
  assert.equal(validateCandidateAnalogPayload(p).valid, true);
  const plain = buildCandidateAnalogPayload({ scenario: { ...scenario, zone: undefined } });
  assert.equal('zone' in plain.scenario, false);
});

const python = ['.venv-server/bin/python', '.venv/bin/python'].find(p => existsSync(new URL(`../${p}`, import.meta.url)));
test('JS preview and server geometry agree on area and centre', { skip: !python && 'no Python environment' }, () => {
  const code = `import json,sys; sys.path.insert(0,'.'); from server.scout_geometry import normalize_zone; print(json.dumps(normalize_zone(json.loads(sys.argv[1]))))`;
  const server = JSON.parse(execFileSync(python, ['-c', code, JSON.stringify(POLY)], { cwd: new URL('../', import.meta.url) }).toString());
  const js = previewZone(POLY);
  assert.ok(Math.abs(server.areaKm2 - js.areaKm2) < 0.01);
  assert.ok(Math.abs(server.center[0] - js.center[0]) < 1e-5 && Math.abs(server.center[1] - js.center[1]) < 1e-5);
});
