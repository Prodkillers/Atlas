// Scout zone geometry helpers (pure, no DOM). Mirrors server/scout_geometry.py so the preview shows the
// same extent, scale and validation the backend will apply. GeoJSON positions are [lon, lat].

export const WINDOW_M = 2400;
export const MAX_SIDE_M = 25000;
export const MIN_AREA_KM2 = 0.05;
export const MAX_ABS_LAT = 84;
export const MAX_VERTICES = 500;
export const POINT_SEARCH_M = Object.freeze([2400, 4800, 7200, 12000]);
const R = 6371008.8;
const TILE = 256;

export const TARGETS = Object.freeze([
  { id: 'marius-hills', label: 'Marius Hills', body: 'moon', note: 'Lava-tube pit surroundings' },
  { id: 'shackleton', label: 'Shackleton rim', body: 'moon', note: 'Polar crater rim' },
  { id: 'jezero', label: 'Jezero', body: 'mars', note: 'Delta and crater floor' },
  { id: 'valles-marineris', label: 'Valles Marineris', body: 'mars', note: 'Coprates canyon wall' },
]);
export const OPERATIONS = Object.freeze([
  ['general', 'General characterisation'], ['mobility', 'Rover mobility'], ['sampling', 'Sampling'],
  ['drilling', 'Drilling'], ['habitat', 'Habitat / shelter'],
]);
export const LAYER_LABELS = Object.freeze({
  geometry: 'Zone geometry', dem: 'DEM · Copernicus GLO-30', ranking: 'Micro-site ranking + affinity',
  terrainMetrics: 'Standard 2400 m grids', imagery: 'Imagery · Sentinel-2 L2A', sarRoughness: 'Radar roughness · Sentinel-1 RTC',
  climateContext: 'Climate context · ERA5', forecast72h: 'Weather & 72 h forecast', sarHistory: '12-month SAR history',
  subsurface: 'Subsurface / cavities', materials: 'Materials', hazards: 'Rover-scale hazards',
});
const BADGES = {
  ready: ['real', 'READY'], partial: ['archive', 'PARTIAL'], running: ['model', 'RUNNING'], pending: ['none', 'PENDING'],
  'on-demand': ['live', 'ON DEMAND'], unavailable: ['none', 'UNAVAILABLE'], absent: ['none', 'ABSENT'],
  cancelled: ['none', 'CANCELLED'], failed: ['none', 'FAILED'], queued: ['none', 'QUEUED'],
};
export function layerBadge(status) {
  const [kind, label] = BADGES[status] || ['none', String(status || '—').toUpperCase()];
  return { kind, label };
}

// ---- Web Mercator (tile pixels at zoom z)
export function lonLatToWorld(lon, lat, z) {
  const size = TILE * 2 ** z;
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
  return [(lon + 180) / 360 * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}
export function worldToLonLat(x, y, z) {
  const size = TILE * 2 ** z;
  const lon = x / size * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / size;
  return [lon, 180 / Math.PI * Math.atan(Math.sinh(n))];
}

// ---- local frame
function project([lon, lat], [lon0, lat0]) {
  return [(lon - lon0) * Math.PI / 180 * R * Math.cos(lat0 * Math.PI / 180), (lat - lat0) * Math.PI / 180 * R];
}
function unproject([e, n], [lon0, lat0]) {
  return [lon0 + e / (R * Math.cos(lat0 * Math.PI / 180)) * 180 / Math.PI, lat0 + n / R * 180 / Math.PI];
}
export function squareAround(lon, lat, side) {
  const h = side / 2;
  const ring = [[-h, h], [h, h], [h, -h], [-h, -h]].map(p => unproject(p, [lon, lat]));
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
export function polygonFromVertices(vertices) {
  const ring = vertices.map(([lon, lat]) => [lon, lat]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
function crosses(a, b, c, d) {
  const o = (p, q, r) => { const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return Math.abs(v) < 1e-9 ? 0 : Math.sign(v); };
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && ![o1, o2, o3, o4].includes(0);
}

/** Extract one Point/Polygon geometry from GeoJSON text. Throws Error with a readable message. */
export function parseGeoJSONText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  const pick = o => {
    if (!o || typeof o !== 'object') throw new Error('GeoJSON must be an object.');
    if (o.type === 'FeatureCollection') {
      if (!Array.isArray(o.features) || o.features.length !== 1) throw new Error('Import exactly one feature (one point or one polygon).');
      return pick(o.features[0]);
    }
    if (o.type === 'Feature') return pick(o.geometry);
    if (o.type === 'Point' || o.type === 'Polygon') return o;
    throw new Error(o.type === 'MultiPolygon' ? 'MultiPolygon is not supported: import one polygon per zone.' : 'Supported geometry types are Point and Polygon.');
  };
  return pick(obj);
}

/** Validate and measure a zone the way the backend will; never throws. */
export function previewZone(geometry, { searchMeters = WINDOW_M } = {}) {
  const errors = [];
  const out = { kind: null, geometry: null, areaKm2: null, extent: null, center: null, scales: [], windows: 0, errors };
  if (!geometry) { errors.push('Choose a point, draw an area or import GeoJSON.'); return out; }
  const finite = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);
  let ring;
  if (geometry.type === 'Point') {
    const p = geometry.coordinates;
    if (!finite(p)) { errors.push('Point must be [longitude, latitude].'); return out; }
    if (!POINT_SEARCH_M.includes(searchMeters) && (searchMeters < 2400 || searchMeters > 12000)) errors.push('Point search size must be 2400–12000 m.');
    out.kind = 'point';
    out.geometry = squareAround(p[0], p[1], searchMeters);
    ring = out.geometry.coordinates[0].slice(0, -1);
  } else if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates;
    if (!Array.isArray(rings) || !rings.length) { errors.push('Polygon has no coordinates.'); return out; }
    if (rings.length > 1) errors.push('Polygons with holes are not supported.');
    ring = (rings[0] || []).filter(finite).map(p => [p[0], p[1]]);
    if (ring.length && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
    out.kind = 'polygon';
    out.geometry = polygonFromVertices(ring);
    if (ring.length < 3) { errors.push('A polygon needs at least three distinct vertices.'); return out; }
    if (ring.length > MAX_VERTICES) errors.push(`A polygon may have at most ${MAX_VERTICES} vertices.`);
  } else {
    errors.push('Supported geometry types are Point and Polygon.');
    return out;
  }
  if (ring.some(([lon]) => lon < -180 || lon > 180)) errors.push('Longitude must be within [-180, 180]; GeoJSON order is [longitude, latitude].');
  if (ring.some(([, lat]) => Math.abs(lat) > MAX_ABS_LAT)) errors.push(`Latitude must be within ±${MAX_ABS_LAT}°; GeoJSON order is [longitude, latitude].`);
  const lons = ring.map(p => p[0]);
  if (Math.max(...lons) - Math.min(...lons) > 180) errors.push('Zones crossing the antimeridian are not supported.');
  const o = [lons.reduce((a, b) => a + b, 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
  const xy = ring.map(p => project(p, o));
  const n = xy.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.abs(i - j) === 1 || Math.abs(i - j) === n - 1) continue;
    if (crosses(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) { errors.push('The polygon outline crosses itself.'); i = n; break; }
  }
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = xy[i], [x1, y1] = xy[(i + 1) % n], c = x0 * y1 - x1 * y0;
    a2 += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  const area = Math.abs(a2) / 2;
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const ew = Math.max(...xs) - Math.min(...xs), ns = Math.max(...ys) - Math.min(...ys);
  const centre = out.kind === 'point' ? geometry.coordinates.slice(0, 2) : a2 ? unproject([cx / (3 * a2), cy / (3 * a2)], o) : o;
  out.center = [centre[1], centre[0]];
  out.areaKm2 = area / 1e6;
  out.extent = { eastWest: ew, northSouth: ns };
  if (out.areaKm2 < MIN_AREA_KM2) errors.push(`Zone area must be at least ${MIN_AREA_KM2} km².`);
  if (Math.max(ew, ns) > MAX_SIDE_M) errors.push(`Zone extent must be ≤ ${MAX_SIDE_M / 1000} km on each side (got ${(Math.max(ew, ns) / 1000).toFixed(1)} km).`);
  out.scales = [2400, ...(Math.min(ew, ns) >= 7200 - 1 ? [7200] : [])];
  out.windows = Math.max(1, Math.floor(Math.max(ew, WINDOW_M) / WINDOW_M)) * Math.max(1, Math.floor(Math.max(ns, WINDOW_M) / WINDOW_M));
  return out;
}

/** Hash parameters shared by Scout and Mission Control (#zone=…&rev=…&site=… or #lat=…&lon=…&target=…). */
export function parseScoutHash(hash = '') {
  const params = new URLSearchParams(String(hash).replace(/^#/, ''));
  const num = k => { const v = params.get(k); return v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
  const zone = /^zone-[0-9a-f]{10}$/.test(params.get('zone') || '') ? params.get('zone') : null;
  const rev = num('rev'), site = num('site');
  const target = TARGETS.some(t => t.id === params.get('target')) ? params.get('target') : null;
  const lat = num('lat'), lon = num('lon');
  return {
    zone, rev: Number.isInteger(rev) && rev > 0 ? rev : null, site: Number.isInteger(site) && site > 0 ? site : null, target,
    lat: lat !== null && Math.abs(lat) <= 90 ? lat : null, lon: lon !== null && Math.abs(lon) <= 180 ? lon : null,
    from: (params.get('from') || '').slice(0, 80) || null,
  };
}
export function missionLink(zoneId, rev, rank) {
  return `index.html#zone=${encodeURIComponent(zoneId)}&rev=${rev}&site=${rank}`;
}
export function zoneScenarioUrl(zoneId, rev, rank) {
  return `/api/zones/${encodeURIComponent(zoneId)}/revisions/${rev}/scenario?site=${rank}`;
}

/** Colour ramp for the affinity map: low index = transparent blue, high = yellow. */
export function affinityColor(index, alpha = 0.55) {
  const t = Math.max(0, Math.min(1, (index - 30) / 60));
  const r = Math.round(40 + t * 210), g = Math.round(90 + t * 150), b = Math.round(200 - t * 170);
  return `rgba(${r},${g},${b},${(0.15 + t * 0.85) * alpha})`;
}
export function formatKm2(v) { return v == null ? '—' : v < 10 ? `${v.toFixed(2)} km²` : `${v.toFixed(1)} km²`; }
export function formatLatLon(lat, lon, digits = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  return `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? 'E' : 'W'}`;
}
