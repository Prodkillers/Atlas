// S.E.L.E.N.E. Scout page: trace a zone, run a server analysis revision, inspect layers and micro-sites,
// and hand a micro-site to Mission Control (docs/modules/scout.md).
import { compareTerrain } from '../shared/similarity.mjs';
import { createDiscoveryScene } from '../discovery/discovery-scene.mjs';
import { createScoutMap, TILE_ATTRIBUTION } from './scout-map.mjs';
import {
  TARGETS, OPERATIONS, LAYER_LABELS, layerBadge, previewZone, parseGeoJSONText, polygonFromVertices,
  parseScoutHash, missionLink, affinityColor, formatKm2, formatLatLon,
} from './scout-geo.mjs';

const $ = id => document.getElementById(id);
const STORE_KEY = 'selene-scout-zones';
const POLL_MS = 1000;
const TERMINAL = new Set(['ready', 'unavailable', 'failed', 'cancelled']);
const state = {
  mode: 'point', point: null, vertices: [], closed: false, imported: null, targetId: TARGETS[0].id,
  source: { kind: 'user-point' }, backend: null, zone: null, revision: null, jobId: null, manifest: null,
  cursor: 0, token: null, sites: [], selected: null, targetGrids: new Map(),
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function api(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method, signal: controller.signal, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(data?.message || data?.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  } finally { clearTimeout(timer); }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------------ geometry state
function currentGeometry() {
  if (state.zone && !state.dirty) return state.zone.geometry;
  if (state.mode === 'point') return state.point ? { type: 'Point', coordinates: state.point } : null;
  if (state.mode === 'polygon') return state.closed && state.vertices.length >= 3 ? polygonFromVertices(state.vertices) : null;
  return state.imported;
}
function searchMeters() { return Number($('point-size').value); }
function preview() {
  const geometry = currentGeometry();
  return previewZone(geometry, { searchMeters: searchMeters() });
}
function geometryChanged() {
  if (state.zone) cancelRun('Zone changed: previous analysis detached.');
  state.zone = null; state.revision = null; state.manifest = null; state.sites = []; state.selected = null;
  state.dirty = false;
  renderPreview(); renderLayers(); renderSites(); map.redraw();
}

function renderPreview() {
  const box = $('zone-preview');
  box.replaceChildren();
  const p = preview();
  const drawing = state.mode === 'polygon' && !state.closed && state.vertices.length;
  if (!currentGeometry() && !drawing) { syncAnalyze(p); return; }
  if (drawing) box.append(el('p', '', `${state.vertices.length} vertices · double-click or “Close area” to finish.`));
  else {
    const dl = el('dl');
    const add = (k, v) => dl.append(el('dt', '', k), el('dd', '', v));
    add('Type', state.zone ? `saved zone ${state.zone.id}` : p.kind === 'point' ? `point · ${searchMeters() / 1000} km search square` : 'polygon');
    add('Centre', p.center ? formatLatLon(p.center[0], p.center[1]) : '—');
    add('Area', formatKm2(p.areaKm2));
    if (p.extent) add('Extent', `${(p.extent.eastWest / 1000).toFixed(1)} × ${(p.extent.northSouth / 1000).toFixed(1)} km`);
    add('Analysis', `2400 m windows (65×65 at 37.5 m) · ≈${p.windows} disjoint · scales ${p.scales.join(' + ') || '—'} m`);
    add('Coverage', 'Copernicus GLO-30 (global land); sea and nodata windows are discarded');
    box.append(dl);
    for (const error of p.errors) box.append(el('p', 'scout-error', error));
  }
  syncAnalyze(p);
}
function syncAnalyze(p = preview()) {
  const running = state.jobId && !TERMINAL.has(state.jobStatus);
  $('analyze').disabled = !state.backend || running || !currentGeometry() || p.errors.length > 0;
  $('cancel').hidden = !running;
  $('refresh').hidden = !state.zone || running;
  const scale7200 = document.querySelector('input[name=scale][value="7200"]');
  scale7200.disabled = !p.scales.includes(7200);
}

// ------------------------------------------------------------------ map
function drawOverlay(ctx, m) {
  const manifest = state.manifest;
  if (manifest?.affinity && $('show-affinity').checked) {
    const size = Math.max(2, manifest.affinity.cellMeters / m.metersPerPixel());
    for (const [lat, lon, index] of manifest.affinity.cells) {
      const [x, y] = m.toScreen(lon, lat);
      ctx.fillStyle = affinityColor(index);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
  const p = preview();
  const ring = p.geometry?.coordinates?.[0];
  if (ring && currentGeometry()) {
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => { const [x, y] = m.toScreen(lon, lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = p.errors.length ? 'rgba(255,120,100,.10)' : 'rgba(232,240,40,.07)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.errors.length ? '#ff9f8f' : '#e8f028';
    ctx.stroke();
  }
  if (state.mode === 'polygon' && !state.closed && state.vertices.length && !state.zone) {
    ctx.beginPath();
    state.vertices.forEach(([lon, lat], i) => { const [x, y] = m.toScreen(lon, lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = '#e8f028'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    for (const [lon, lat] of state.vertices) { const [x, y] = m.toScreen(lon, lat); ctx.fillStyle = '#e8f028'; ctx.fillRect(x - 3, y - 3, 6, 6); }
  }
  if (state.mode === 'point' && state.point && !state.zone) {
    const [x, y] = m.toScreen(...state.point);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#e8f028'; ctx.fill();
  }
  for (const site of state.sites) {
    const [x, y] = m.toScreen(site.center[1], site.center[0]);
    const selected = site.rank === state.selected;
    if (selected) {
      const half = 1200 / m.metersPerPixel();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(x - half, y - half, half * 2, half * 2);
    }
    ctx.beginPath(); ctx.arc(x, y, selected ? 11 : 9, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#e8f028' : '#07173f'; ctx.fill();
    ctx.strokeStyle = '#e8f028'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = selected ? '#07173f' : '#e8f028'; ctx.font = '700 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(state.sites.indexOf(site) + 1), x, y + 0.5);
  }
}
function onMapClick(lon, lat) {
  if (state.zone && !state.dirty) {
    const hit = state.sites.find(site => { const [x, y] = map.toScreen(site.center[1], site.center[0]); const [cx, cy] = map.toScreen(lon, lat); return Math.hypot(x - cx, y - cy) < 12; });
    if (hit) { selectSite(hit.rank); return; }
    if (state.mode === 'geojson') return;
  }
  if (state.mode === 'point') { state.point = [round6(lon), round6(lat)]; state.source = { kind: 'user-point' }; geometryChanged(); }
  else if (state.mode === 'polygon') {
    if (state.closed || state.zone) { state.vertices = []; state.closed = false; }
    state.vertices.push([round6(lon), round6(lat)]); state.source = { kind: 'user-drawn' }; geometryChanged();
  }
}
const round6 = v => Math.round(v * 1e6) / 1e6;
const map = createScoutMap($('scout-map'), {
  onClick: onMapClick,
  onDoubleClick: () => { if (state.mode === 'polygon' && state.vertices.length >= 3) { state.closed = true; geometryChanged(); } },
  onDraw: drawOverlay,
  onMove: m => { const mpp = m.metersPerPixel(); $('map-scale').textContent = `100 px ≈ ${mpp * 100 >= 1000 ? `${(mpp / 10).toFixed(1)} km` : `${Math.round(mpp * 100)} m`}`; },
});
$('map-attribution').textContent = `Basemap: ${TILE_ATTRIBUTION}. The basemap is visual context only; analyses use the DEM and imagery listed per layer.`;
map.setView(-20, 22, 2.4);

// ------------------------------------------------------------------ controls
function setMode(mode) {
  state.mode = mode;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  for (const node of document.querySelectorAll('[data-for]')) node.hidden = node.dataset.for !== mode;
  $('mode-help').textContent = {
    point: 'Click the map to mark a point. A square search area of the chosen size is analysed around it.',
    polygon: 'Click to add vertices; double-click or “Close area” to finish. Up to 25 km per side.',
    geojson: 'Paste or load one GeoJSON Point or Polygon. Positions are [longitude, latitude].',
  }[mode];
  if (state.zone) { state.dirty = true; geometryChanged(); } else { renderPreview(); map.redraw(); }
}
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
$('point-size').addEventListener('change', () => { if (state.mode === 'point') geometryChanged(); });
$('undo-vertex').addEventListener('click', () => { state.closed = false; state.vertices.pop(); geometryChanged(); });
$('close-area').addEventListener('click', () => { if (state.vertices.length >= 3) { state.closed = true; geometryChanged(); } });
$('clear-zone').addEventListener('click', () => {
  state.point = null; state.vertices = []; state.closed = false; state.imported = null;
  history.replaceState(null, '', location.pathname); geometryChanged();
});
$('geojson-file').addEventListener('change', async e => { const file = e.target.files?.[0]; if (file) $('geojson-text').value = (await file.text()).slice(0, 500000); });
$('geojson-import').addEventListener('click', () => {
  try {
    state.imported = parseGeoJSONText($('geojson-text').value);
    state.source = { kind: 'geojson-import' };
    geometryChanged();
    const p = preview();
    if (p.geometry) fitGeometry(p.geometry);
  } catch (error) { $('zone-preview').replaceChildren(el('p', 'scout-error', error.message)); }
});
$('goto-form').addEventListener('submit', e => {
  e.preventDefault();
  const lat = Number($('goto-lat').value), lon = Number($('goto-lon').value);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 84 && Math.abs(lon) <= 180) map.setView(lon, lat, 12);
});
$('map-zoom-in').addEventListener('click', () => map.zoomIn());
$('map-zoom-out').addEventListener('click', () => map.zoomOut());
$('show-affinity').addEventListener('change', () => map.redraw());
function fitGeometry(geometry) {
  const ring = geometry.coordinates[0];
  const lons = ring.map(p => p[0]), lats = ring.map(p => p[1]);
  map.fit([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], 60);
}

for (const target of TARGETS) {
  const b = el('button');
  b.type = 'button'; b.dataset.target = target.id;
  b.append(document.createTextNode(target.label), el('small', '', `${target.body.toUpperCase()} · ${target.note}`));
  b.addEventListener('click', () => selectTarget(target.id));
  $('scout-targets').append(b);
}
function selectTarget(id) {
  state.targetId = id;
  for (const b of $('scout-targets').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.target === id));
}
selectTarget(state.targetId);
for (const [value, label] of OPERATIONS) { const o = el('option', '', label); o.value = value; $('operation').append(o); }

// ------------------------------------------------------------------ analysis lifecycle
function cancelRun(message) {
  if (state.jobId && !TERMINAL.has(state.jobStatus)) api(`/api/jobs/${state.jobId}/cancel`, { method: 'POST' }).catch(() => {});
  state.token = null; state.jobId = null; state.jobStatus = null;
  if (message) $('analyze-status').textContent = message;
}
async function analyze(refresh = false) {
  const p = preview();
  if (!refresh && p.errors.length) return;
  cancelRun();
  const token = Symbol('run');
  state.token = token;
  $('event-log').replaceChildren();
  try {
    if (!refresh || !state.zone) {
      const geometry = currentGeometry();
      $('analyze-status').textContent = 'Saving zone…';
      const zone = await api('/api/zones', { method: 'POST', body: {
        geojson: geometry, name: $('zone-name').value || null, searchMeters: geometry.type === 'Point' ? searchMeters() : null, source: state.source } });
      if (state.token !== token) return;
      state.zone = zone; state.dirty = false; rememberZone(zone);
    }
    const scales = [...document.querySelectorAll('input[name=scale]:checked:not(:disabled)')].map(i => Number(i.value));
    const job = await api(`/api/zones/${state.zone.id}/analyses`, { method: 'POST', body: {
      targetId: state.targetId, operation: $('operation').value, scales: [2400, ...scales.filter(s => s !== 2400)] } });
    if (state.token !== token) return;
    Object.assign(state, { jobId: job.jobId, jobStatus: job.status, revision: job.revision, cursor: 0, manifest: null, sites: [], selected: null });
    history.replaceState(null, '', `#zone=${state.zone.id}&rev=${job.revision}`);
    $('analyze-status').textContent = `Revision ${job.revision} running…`;
    renderSites(); syncAnalyze();
    await poll(token);
  } catch (error) {
    if (state.token === token) { $('analyze-status').textContent = `Could not analyse: ${error.message}`; state.jobStatus = 'failed'; syncAnalyze(); }
  }
}
async function poll(token) {
  while (state.token === token) {
    let snap;
    try { snap = await api(`/api/jobs/${state.jobId}/events?after=${state.cursor}`); }
    catch (error) {
      if (error.status === 404) { $('analyze-status').textContent = 'The server no longer tracks this job (restart?). Showing the saved manifest.'; await loadManifest(token); state.jobStatus = state.manifest?.status || 'failed'; syncAnalyze(); return; }
      await sleep(POLL_MS * 2); continue;
    }
    if (state.token !== token) return;
    state.cursor = snap.next; state.jobStatus = snap.status;
    for (const event of snap.events) {
      const li = el('li', '', `${event.at.slice(11, 19)} · ${event.stage} · ${event.message}`);
      $('event-log').append(li);
    }
    if (snap.events.length) await loadManifest(token);
    if (TERMINAL.has(snap.status)) {
      $('analyze-status').textContent = snap.events.at(-1)?.message || `Revision ${state.revision}: ${snap.status}.`;
      syncAnalyze(); renderMyZones(); return;
    }
    await sleep(POLL_MS);
  }
}
async function loadManifest(token = state.token) {
  if (!state.zone || !state.revision) return;
  try {
    const manifest = await api(`/api/zones/${state.zone.id}/revisions/${state.revision}`);
    if (token && state.token !== token) return;
    state.manifest = manifest;
    state.sites = manifest.sites || [];
    renderLayers(); renderSites(); map.redraw();
  } catch { /* manifest not written yet */ }
}
$('analyze').addEventListener('click', () => analyze(false));
$('refresh').addEventListener('click', () => analyze(true));
$('cancel').addEventListener('click', () => { if (state.jobId) api(`/api/jobs/${state.jobId}/cancel`, { method: 'POST' }).catch(() => {}); $('analyze-status').textContent = 'Cancelling…'; });

// ------------------------------------------------------------------ rendering
function renderLayers() {
  const list = $('layer-list');
  list.replaceChildren();
  const m = state.manifest;
  const badge = $('revision-badge');
  badge.textContent = m ? `${state.zone?.id} · REV ${m.revision} · ${String(m.status).toUpperCase()}` : 'NO REVISION';
  badge.dataset.kind = !m ? 'none' : m.status === 'ready' ? 'real' : m.status === 'running' ? 'model' : 'none';
  if (!m?.layers) return;
  for (const [key, layer] of Object.entries(m.layers)) {
    const li = el('li');
    const b = layerBadge(layer.status);
    const tag = el('span', 'data-badge', b.label); tag.dataset.kind = b.kind;
    li.append(el('strong', '', LAYER_LABELS[key] || key), tag);
    const detail = [layer.product, layer.resolution, layer.coverage !== undefined ? `coverage ${typeof layer.coverage === 'number' ? `${Math.round(layer.coverage * 100)} %` : layer.coverage}` : null, layer.reason, layer.method]
      .filter(Boolean).join(' · ');
    if (detail) li.append(el('p', '', detail));
    list.append(li);
  }
}
function renderSites() {
  const list = $('site-list');
  list.replaceChildren();
  const target = state.manifest?.target;
  state.sites.forEach((site, i) => {
    const card = el('article', 'scout-site');
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-current', String(site.rank === state.selected));
    const head = el('header');
    head.append(el('span', 'micro', `#${i + 1} · ${site.earthId}`), el('strong', '', String(site.index)));
    card.append(head);
    if (site.imagery?.path) { const img = el('img'); img.src = site.imagery.path; img.alt = `Sentinel-2 image of micro-site ${i + 1}`; img.loading = 'lazy'; card.append(img); }
    const m = site.metrics || {};
    card.append(el('p', '', `${formatLatLon(site.center[0], site.center[1])} · found at ${site.foundAtScaleMeters} m (search index ${site.searchIndex})`));
    card.append(el('p', '', `Slope p50 ${m.slopeP50Deg}° / p90 ${m.slopeP90Deg}° · relief ${m.reliefP95P5M} m · TRI ${m.triMeanM} m` +
      (target?.metrics ? ` — target ${target.metrics.slopeP50Deg}° / ${target.metrics.slopeP90Deg}° · ${target.metrics.reliefP95P5M} m · ${target.metrics.triMeanM} m` : '')));
    const extras = [];
    extras.push(site.imagery ? `S2 ${String(site.imagery.acquired || '').slice(0, 10)}` : 'no imagery');
    extras.push(site.roughness ? `S1 ${site.roughness.polarization} ${site.roughness.value} dB` : 'no radar');
    extras.push(site.climateContext ? `ERA5 ${site.climateContext.aridity}, ΔT ${site.climateContext.amplitudeK} K` : 'no climate context');
    card.append(el('p', '', extras.join(' · ')));
    const actions = el('div', 'scout-site-actions');
    const view = el('button', '', 'View 3D'); view.type = 'button'; view.addEventListener('click', () => selectSite(site.rank));
    const activate = el('a', 'scout-activate', 'Activate mission ↗'); activate.href = missionLink(state.zone.id, state.manifest.revision, site.rank);
    actions.append(view, activate);
    card.append(actions);
    list.append(card);
  });
}

// ------------------------------------------------------------------ 3D
const viewport = $('scene-viewport');
const scene = createDiscoveryScene($('scout-scene'), {});
if (!scene.webgl) { $('scout-scene').hidden = true; $('scene-fallback').hidden = false; }
else {
  scene.start();
  const resize = () => { const r = viewport.getBoundingClientRect(); scene.resize(Math.round(r.width), Math.round(r.height)); };
  new ResizeObserver(resize).observe(viewport); resize();
  $('scene-center').addEventListener('click', () => scene.centerCamera());
  $('scene-zoom-in').addEventListener('click', () => scene.zoomIn());
  $('scene-zoom-out').addEventListener('click', () => scene.zoomOut());
  for (const pane of ['earth', 'target']) $(`split-tab-${pane}`).addEventListener('click', () => {
    scene.setSplitPane(pane); $('split-overlay').dataset.pane = pane;
    $('split-tab-earth').setAttribute('aria-pressed', String(pane === 'earth')); $('split-tab-target').setAttribute('aria-pressed', String(pane === 'target'));
  });
}
async function selectSite(rank) {
  const site = state.sites.find(s => s.rank === rank);
  if (!site || !state.manifest) return;
  state.selected = rank;
  renderSites(); map.redraw();
  const token = state.token, manifest = state.manifest;
  try {
    const targetPath = manifest.target.path;
    if (!state.targetGrids.has(targetPath)) state.targetGrids.set(targetPath, api(targetPath, { timeout: 30000 }));
    const [grid, target] = await Promise.all([api(site.gridPath, { timeout: 30000 }), state.targetGrids.get(targetPath)]);
    if (state.manifest !== manifest || state.selected !== rank || state.token !== token) return;
    const shown = compareTerrain(grid, target);
    $('split-earth-name').textContent = `${grid.name} · index ${shown.index}`;
    $('split-target-name').textContent = target.name;
    $('scene-coordinate').textContent = `${formatLatLon(grid.center[0], grid.center[1], 3)} / EARTH · DEM`;
    if (scene.webgl) await scene.setPair(grid, target);
  } catch (error) { $('scene-coordinate').textContent = `Could not load the micro-site grid (${error.message}).`; }
}

// ------------------------------------------------------------------ my zones / reopen
function myZones() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
function rememberZone(zone) {
  const list = [{ id: zone.id, name: zone.name }, ...myZones().filter(z => z.id !== zone.id)].slice(0, 20);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* storage disabled */ }
  renderMyZones();
}
function renderMyZones() {
  const list = $('my-zones');
  list.replaceChildren();
  const zones = myZones();
  if (!zones.length) { list.append(el('li', '', 'No saved zones yet. Saved zones can also be reopened from their link.')); return; }
  for (const z of zones) {
    const li = el('li');
    const label = el('span', '', z.name); label.append(el('small', '', z.id));
    const open = el('button', '', 'Open'); open.type = 'button';
    open.addEventListener('click', () => { location.hash = `zone=${z.id}`; });
    li.append(label, open);
    list.append(li);
  }
}
async function reopen(zoneId, rev) {
  cancelRun();
  const token = Symbol('reopen');
  state.token = token;
  try {
    const zone = await api(`/api/zones/${zoneId}`);
    if (state.token !== token) return;
    state.zone = zone; state.dirty = false; rememberZone(zone);
    $('zone-name').value = zone.name;
    const revision = zone.revisions.find(r => r.revision === rev) || zone.revisions.at(-1);
    fitGeometry(zone.geometry);
    if (!revision) { $('analyze-status').textContent = 'Zone saved without analyses yet.'; renderPreview(); map.redraw(); return; }
    state.revision = revision.revision; selectTarget(revision.targetId); $('operation').value = revision.operation || 'general';
    await loadManifest(token);
    renderPreview();
    if (!TERMINAL.has(revision.status)) { state.jobId = revision.jobId; state.jobStatus = revision.status; syncAnalyze(); await poll(token); }
    else $('analyze-status').textContent = `Revision ${revision.revision} · ${revision.status} · ${revision.finishedAt || ''}`;
  } catch (error) { if (state.token === token) $('analyze-status').textContent = `Could not open ${zoneId}: ${error.message}`; }
}
function applyHash() {
  const h = parseScoutHash(location.hash);
  if (h.zone) { if (state.backend) reopen(h.zone, h.rev); return; }
  if (h.lat !== null && h.lon !== null) {
    setMode('point');
    state.point = [h.lon, h.lat];
    state.source = h.from ? { kind: 'discovery-candidate', ref: h.from } : { kind: 'user-point' };
    if (h.from) $('zone-name').value = `Around ${h.from}`;
    if (h.target) selectTarget(h.target);
    geometryChanged();
    map.setView(h.lon, h.lat, 12);
  }
}
window.addEventListener('hashchange', applyHash);

async function boot() {
  renderMyZones(); renderPreview(); renderLayers();
  try {
    const health = await api('/api/scout/health', { timeout: 4000 });
    state.backend = health;
    $('scout-backend').textContent = health.dem === 'available' ? 'BACKEND · DEM PROVIDER AVAILABLE'
      : `BACKEND · DEM PROVIDER UNAVAILABLE (${health.missingModules.join(', ')})`;
    if (health.dem !== 'available') $('analyze-status').textContent = 'This server lacks the optional geospatial stack: zones are saved, and analyses report the DEM layer as unavailable.';
  } catch {
    state.backend = null;
    $('scout-backend').textContent = 'NO BACKEND · STATIC MODE';
    $('analyze-status').textContent = 'Scout needs the FastAPI backend (npm start) to save and analyse zones. Drawing and the preview still work.';
  }
  applyHash();
  renderPreview();
}
boot();
