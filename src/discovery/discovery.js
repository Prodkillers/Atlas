import { compareTerrain } from '../shared/similarity.mjs';
import { createDiscoveryScene } from './discovery-scene.mjs';
import {
  relativeCenterProfiles,
  bestCandidateByRegion,
  pairedBarMax,
  thermalBands,
  profilePath,
  analogySummary,
  toGeoJSON,
  formatCoordinates,
  scoreBand,
} from './discovery-math.mjs';
import { gridExtent, validGrid } from '../shared/mission-math.mjs';
import { answerDiscoveryLocally, buildDiscoveryChatContext, discoveryChatContextKey } from './discovery-chat.mjs';

const TARGETS = [
  { id: 'marius-hills', label: 'Marius Hills', body: 'Moon' },
  { id: 'shackleton', label: 'Shackleton', body: 'Moon' },
  { id: 'jezero', label: 'Jezero', body: 'Mars' },
  { id: 'valles-marineris', label: 'Valles Marineris', body: 'Mars' },
];

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobileQuery = matchMedia('(max-width: 760px)');

const status = $('discovery-status');
const candidateList = $('candidate-list');
const targetButtons = $('target-buttons');
const compareIndex = $('compare-index');
const compareMetrics = $('compare-metrics');
const profileSvg = $('profile-svg');
const thermalChart = $('thermal-chart');
const sourcesList = $('sources-list');
const viewport = $('scene-viewport');
const canvas = $('discovery-scene');
const sceneFallback = $('scene-fallback');

const componentMeta = {
  slopeP50Deg: { name: 'Median slope (p50)', hint: 'Typical hill steepness inside the window.' },
  slopeP90Deg: { name: 'Slope (p90)', hint: 'Steeper terrain tail; captures cliffs and scarps.' },
  reliefP95P5M: { name: 'Relief (p95–p5)', hint: 'Vertical range between high and low ground.' },
  triMeanM: { name: 'Mean terrain ruggedness (TRI)', hint: 'Local bumpiness versus neighbors.' },
  roughness: { name: 'Radar roughness', hint: 'Only when both sides publish radar metrics.' },
  thermalAmplitudeK: { name: 'Daily thermal amplitude', hint: 'Diurnal swing (ERA5 air vs Diviner/MCD surface); not physical equivalence.' },
};

const PLACE_TITLE = 'Nearest named place from OpenStreetMap (Nominatim); not the official site name.';

const state = {
  targetId: TARGETS[0].id,
  discovery: null,
  target: null,
  regions: null,
  selectedId: null,
  comparisons: new Map(),
  view: 'split',
  splitPane: 'earth',
  motion: !reducedMotion.matches,
  chatHistory: [],
  chatScope: '',
  chatBusy: false,
};

const CHAT_SUGGESTIONS = [
  'What does this geometric index mean?',
  'Which metric contributes most to this comparison?',
  'What data sources and limitations should I know about?',
];

function candidateTitle(candidate) {
  if (candidate.place?.name) return candidate.place.name;
  if (candidate.name && !/candidate\s+\d/i.test(candidate.name)) return candidate.name;
  const [lat, lon] = candidate.center || [];
  return formatCoordinates(lat, lon);
}

function candidateSubtitle(candidate, discovery) {
  const bits = [];
  if (candidate.place?.country) bits.push(candidate.place.country);
  if (candidate.region?.name) bits.push(candidate.region.name);
  const scale = candidate.scaleMeters || discovery?.window?.extentMeters || 2400;
  bits.push(`${scale} m window`);
  return bits.join(' · ');
}

function datasetShortLabel(dataset) {
  if (!dataset) return '—';
  if (/ALOS|AW3D30|JAXA/i.test(dataset)) return 'JAXA ALOS AW3D30';
  return dataset.split('·')[0].trim();
}

function syncHash() {
  if (!state.discovery) return;
  const rank = state.discovery.candidates.find((c) => c.id === state.selectedId)?.rank;
  const hash = new URLSearchParams({ target: state.targetId, ...(rank ? { c: String(rank) } : {}) });
  const next = `#${hash.toString()}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function parseHashTarget() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const target = params.get('target');
  if (target && TARGETS.some((t) => t.id === target)) return { targetId: target, rank: Number(params.get('c')) || null };
  return null;
}

function renderHowStrip(discovery) {
  const el = $('discovery-how');
  if (!discovery) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  const regionCount = discovery.regions?.length ?? 0;
  const cells = discovery.scannedCells ?? 0;
  const dem = datasetShortLabel(discovery.candidates?.[0]?.dataset);
  el.textContent = `1 Scan — ${cells} cells across ${regionCount} regions (${dem}) · 2 Rank — geometry + daily thermal amplitude · 3 Compare — pick a candidate`;
  el.hidden = false;
}

function renderCalcList(components) {
  const list = $('compare-calc-list');
  list.replaceChildren();
  const sorted = [...(components || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const component of sorted) {
    const meta = componentMeta[component.key] || { name: component.label || component.key, hint: '' };
    const li = document.createElement('li');
    li.textContent = `${meta.name} — ${Math.round((component.weight || 0) * 100)}% weight. ${meta.hint}`;
    list.append(li);
  }
}

function addText(parent, tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  parent.append(el);
  return el;
}

function selectedCandidate() {
  return state.discovery?.candidates?.find((c) => c.id === state.selectedId) || null;
}

function comparisonFor(candidate) {
  if (!candidate) return null;
  return state.comparisons.get(candidate.id) || compareTerrain(candidate, state.target);
}

function initTargetButtons() {
  targetButtons.replaceChildren();
  for (const target of TARGETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.targetId = target.id;
    button.setAttribute('aria-pressed', String(target.id === state.targetId));
    button.textContent = target.label;
    const small = document.createElement('small');
    small.textContent = target.body.toUpperCase();
    button.append(small);
    button.addEventListener('click', () => {
      if (state.targetId === target.id) return;
      state.targetId = target.id;
      for (const node of targetButtons.querySelectorAll('button')) {
        node.setAttribute('aria-pressed', String(node.dataset.targetId === state.targetId));
      }
      loadDiscovery(state.targetId);
    });
    targetButtons.append(button);
  }
}

function renderCandidateList() {
  candidateList.replaceChildren();
  if (!state.discovery) return;
  for (const candidate of state.discovery.candidates) {
    const comparison = comparisonFor(candidate);
    const index = comparison?.index;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'candidate-row';
    row.role = 'option';
    row.id = `candidate-${candidate.id}`;
    row.setAttribute('aria-selected', String(candidate.id === state.selectedId));
    if (candidate.id === state.selectedId) row.setAttribute('aria-current', 'true');
    row.addEventListener('click', () => selectCandidate(candidate.id));
    addText(row, 'span', 'candidate-rank', `#${candidate.rank}`);
    const main = document.createElement('div');
    main.className = 'candidate-row-main';
    const title = addText(main, 'strong', '', candidateTitle(candidate));
    if (candidate.place?.name) title.title = PLACE_TITLE;
    addText(main, 'span', 'candidate-row-meta', candidateSubtitle(candidate, state.discovery));
    const track = document.createElement('div');
    track.className = 'candidate-row-track';
    const fill = document.createElement('div');
    fill.className = 'candidate-row-fill';
    fill.style.width = `${Math.max(0, Math.min(100, index ?? 0))}%`;
    track.append(fill);
    main.append(track);
    const badges = document.createElement('div');
    badges.className = 'candidate-row-badges';
    if (candidate.aridity?.class) {
      const pill = addText(badges, 'span', 'candidate-pill arid', candidate.aridity.class);
      pill.title = `Aridity context (not scored): ${candidate.aridity.annualPrecipMm} mm/year`;
    }
    main.append(badges);
    row.append(main);
    addText(row, 'span', 'candidate-row-score', index == null ? '—' : `${index}`);
    candidateList.append(row);
  }
}

function gridFromCandidate(candidate) {
  return {
    elevation: candidate.elevation,
    gridSize: candidate.gridSize,
    spacingMeters: candidate.spacingMeters,
    extentMeters: candidate.extentMeters,
  };
}

function gridFromTarget(target) {
  return {
    elevation: target.elevation,
    gridSize: target.gridSize,
    spacingMeters: target.spacingMeters,
    extentMeters: target.extentMeters,
  };
}

function renderComparePanel() {
  const candidate = selectedCandidate();
  const comparison = comparisonFor(candidate);
  if (!candidate || !comparison) {
    compareIndex.textContent = '—';
    compareMetrics.replaceChildren();
    $('compare-coords').textContent = '';
    $('open-in-map').hidden = true;
    $('open-route-explorer').hidden = true;
    $('open-in-scout').hidden = true;
    profileSvg.replaceChildren();
    thermalChart.replaceChildren();
    renderCalcList([]);
    return;
  }
  compareIndex.textContent = comparison.index == null ? '—' : `${comparison.index}`;
  renderCalcList(comparison.components);
  const [lat, lon] = candidate.center || [];
  $('compare-coords').textContent = `${formatCoordinates(lat, lon)} · ${candidateSubtitle(candidate, state.discovery)}`;
  const mapLink = $('open-in-map');
  mapLink.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=12/${lat}/${lon}`;
  mapLink.hidden = lat == null || lon == null;
  const routeLink = $('open-route-explorer');
  routeLink.href = `route-explorer.html#target=${encodeURIComponent(state.targetId)}&candidate=${encodeURIComponent(candidate.id)}`;
  routeLink.hidden = false;
  const scoutLink = $('open-in-scout');
  scoutLink.href = `scout.html#lat=${lat}&lon=${lon}&target=${encodeURIComponent(state.targetId)}&from=${encodeURIComponent(candidate.id)}`;
  scoutLink.hidden = lat == null || lon == null;
  compareMetrics.replaceChildren();
  const summary = analogySummary(comparison.components);
  if (summary.strong.length || summary.weak.length) {
    const p = document.createElement('p');
    p.className = 'analogy-summary';
    const strong = summary.strong.length ? `Strong match: ${summary.strong.join(', ')}` : '';
    const weak = summary.weak.length ? `Breaks down: ${summary.weak.join(', ')}` : '';
    p.textContent = [strong, weak].filter(Boolean).join(' · ');
    compareMetrics.append(p);
  }
  const sorted = [...comparison.components].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const component of sorted) {
    const block = document.createElement('div');
    block.className = 'metric-pair';
    const header = document.createElement('header');
    const meta = componentMeta[component.key];
    addText(header, 'span', '', meta?.name || component.label);
    const weight = `${Math.round((component.weight || 0) * 100)}% weight`;
    addText(header, 'span', '', weight);
    block.append(header);
    const values = document.createElement('div');
    values.className = 'metric-values';
    const unit = component.unit ? ` ${component.unit}` : '';
    addText(values, 'span', '', `Earth ${component.earth?.toLocaleString('en', { maximumFractionDigits: 2 })}${unit}`);
    addText(values, 'span', '', `Target ${component.target?.toLocaleString('en', { maximumFractionDigits: 2 })}${unit}`);
    block.append(values);
    const bars = document.createElement('div');
    bars.className = 'metric-bars';
    const max = pairedBarMax(component.earth, component.target);
    for (const [side, value, cls] of [
      ['earth', component.earth, 'metric-bar-earth'],
      ['target', component.target, 'metric-bar-target'],
    ]) {
      const wrap = document.createElement('div');
      wrap.className = `metric-bar-track ${cls}`;
      const fill = document.createElement('div');
      fill.className = 'metric-bar-fill';
      fill.style.width = `${Math.min(100, (Math.abs(value) / max) * 100)}%`;
      wrap.append(fill);
      bars.append(wrap);
      void side;
    }
    block.append(bars);
    const foot = document.createElement('footer');
    foot.dataset.band = scoreBand(component.score);
    addText(foot, 'span', '', `Score ${component.score}`);
    block.append(foot);
    compareMetrics.append(block);
  }
  renderProfile(candidate, state.target);
  renderThermal(candidate, state.target);
}

const CHAT_PROVIDER_LABEL = { openai: 'AI', rules: 'LOCAL', none: 'UNAVAILABLE' };
function renderDiscoveryChatEmpty() {
  const log = $('discovery-chat-log');
  if (log.children.length) return;
  addText(log, 'li', 'empty', state.selectedId
    ? 'Ask about this candidate, its geometric comparison, data sources, or limitations.'
    : 'Select a candidate to start asking about its comparison with the planetary target.');
}

function syncDiscoveryChat() {
  const key = discoveryChatContextKey({ targetId: state.targetId, candidateId: state.selectedId });
  if (key !== state.chatScope) {
    state.chatScope = key;
    state.chatHistory = [];
    state.chatBusy = false;
    $('discovery-chat-log').replaceChildren();
    $('discovery-chat-provider').textContent = 'NEW COMPARISON';
    $('discovery-chat-provider').dataset.kind = 'none';
  }
  const candidate = selectedCandidate();
  const comparison = comparisonFor(candidate);
  const context = buildDiscoveryChatContext({ discovery: state.discovery, target: state.target, candidate, comparison });
  const input = $('discovery-chat-input');
  const button = $('discovery-chat-form').querySelector('button');
  input.disabled = !context;
  button.disabled = !context || state.chatBusy;
  const indexLabel = comparison?.components.some((component) => component.key === 'thermalAmplitudeK')
    ? 'terrain-comparison index' : 'geometric similarity index';
  $('discovery-chat-context').textContent = context
    ? `${candidateTitle(candidate)} · ${state.target.name || state.target.title || state.targetId} · ${indexLabel} ${comparison.index ?? 'unknown'}`
    : 'Select a candidate to ask about its comparison with the current planetary target.';
  const suggestions = $('discovery-chat-suggestions');
  suggestions.replaceChildren(...(context ? CHAT_SUGGESTIONS : []).map((question) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = question;
    item.disabled = state.chatBusy;
    item.addEventListener('click', () => submitDiscoveryQuestion(question));
    return item;
  }));
  renderDiscoveryChatEmpty();
  return { key, context };
}

async function requestDiscoveryAnswer(question, context, history) {
  let response;
  try {
    response = await fetch('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ question, context, history }),
    });
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  if (response.ok) {
    const answer = await response.json();
    if (typeof answer.answer !== 'string' || !answer.answer) throw new Error('The AI returned an empty response.');
    return answer;
  }
  if (response.status === 404 || response.status === 503) return null;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.error === 'rate-limited' ? 'The assistant is rate limited. Try again shortly.' : `Assistant request failed (${response.status}).`);
}

async function submitDiscoveryQuestion(raw) {
  const question = String(raw || '').trim().slice(0, 500);
  const { key, context } = syncDiscoveryChat();
  if (!question || !context || state.chatBusy) return;
  const history = structuredClone(state.chatHistory);
  state.chatBusy = true;
  const log = $('discovery-chat-log');
  log.querySelector('li.empty')?.remove();
  addText(log, 'li', 'user', question);
  const pending = addText(log, 'li', 'assistant pending', 'Reviewing the selected comparison…');
  $('discovery-chat-form').querySelector('button').disabled = true;
  $('discovery-chat-suggestions').querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try {
    const result = await requestDiscoveryAnswer(question, context, history)
      || { answer: answerDiscoveryLocally(question, context), provider: 'rules', grounded: [], disclaimer: 'Local response; the AI provider is unavailable.' };
    if (key !== discoveryChatContextKey({ targetId: state.targetId, candidateId: state.selectedId })) return;
    state.chatHistory.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer });
    if (state.chatHistory.length > 20) state.chatHistory.splice(0, state.chatHistory.length - 20);
    pending.className = 'assistant';
    pending.replaceChildren(
      Object.assign(document.createElement('span'), { className: 'discovery-chat-meta', textContent: CHAT_PROVIDER_LABEL[result.provider] || String(result.provider || 'assistant').toUpperCase() }),
      document.createTextNode(result.answer),
    );
    if (result.disclaimer) addText(pending, 'span', 'discovery-chat-foot', result.disclaimer);
    $('discovery-chat-provider').textContent = CHAT_PROVIDER_LABEL[result.provider] || String(result.provider || 'assistant').toUpperCase();
    $('discovery-chat-provider').dataset.kind = result.provider === 'openai' ? 'model' : 'none';
  } catch (error) {
    if (key !== discoveryChatContextKey({ targetId: state.targetId, candidateId: state.selectedId })) return;
    pending.className = 'assistant';
    pending.textContent = `Response unavailable: ${error.message}`;
  } finally {
    if (key !== discoveryChatContextKey({ targetId: state.targetId, candidateId: state.selectedId })) return;
    state.chatBusy = false;
    $('discovery-chat-form').querySelector('button').disabled = false;
    $('discovery-chat-suggestions').querySelectorAll('button').forEach((button) => { button.disabled = false; });
    log.scrollTop = log.scrollHeight;
  }
}

$('discovery-chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('discovery-chat-input');
  const question = input.value;
  input.value = '';
  submitDiscoveryQuestion(question);
});

function renderProfile(candidate, target) {
  profileSvg.replaceChildren();
  const earthGrid = gridFromCandidate(candidate);
  const targetGrid = gridFromTarget(target);
  if (!validGrid(earthGrid) || !validGrid(targetGrid)) return;
  const profiles = relativeCenterProfiles(earthGrid, targetGrid);
  const w = 320;
  const h = 120;
  const sharedMax = profiles.maxRelief;
  const earthExtent = gridExtent(earthGrid);
  const earthPath = profilePath(profiles.earth, earthExtent, sharedMax, w, h);
  const targetPath = profilePath(profiles.target, gridExtent(targetGrid), sharedMax, w, h);
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = `Center profile · 0–${Math.round(sharedMax)} m relief · ${Math.round(earthExtent)} m west–east window`;
  profileSvg.append(title);
  const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  yLabel.setAttribute('class', 'profile-axis-label');
  yLabel.setAttribute('x', '4');
  yLabel.setAttribute('y', '12');
  yLabel.textContent = `${Math.round(sharedMax)} m`;
  profileSvg.append(yLabel);
  const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  xLabel.setAttribute('class', 'profile-axis-label');
  xLabel.setAttribute('x', String(w - 4));
  xLabel.setAttribute('y', String(h - 4));
  xLabel.setAttribute('text-anchor', 'end');
  xLabel.textContent = `${Math.round(earthExtent)} m`;
  profileSvg.append(xLabel);
  if (earthPath) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'earth');
    path.setAttribute('d', earthPath);
    profileSvg.append(path);
  }
  if (targetPath) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'target');
    path.setAttribute('d', targetPath);
    profileSvg.append(path);
  }
}

function thermalAmplitude(thermal) {
  if (thermal?.amplitudeK != null) return thermal.amplitudeK;
  if (thermal?.minK != null && thermal?.maxK != null) return thermal.maxK - thermal.minK;
  return null;
}

function renderThermal(candidate, target) {
  thermalChart.replaceChildren();
  const bands = thermalBands(candidate.thermal, target.thermal);
  const ampEarth = thermalAmplitude(candidate.thermal);
  const ampTarget = thermalAmplitude(target.thermal);
  if (ampEarth != null || ampTarget != null) {
    const note = document.createElement('p');
    note.className = 'thermal-amplitude';
    note.textContent = `Daily amplitude (indexed): Earth ${ampEarth?.toFixed(1) ?? '—'} K · Target ${ampTarget?.toFixed(1) ?? '—'} K`;
    thermalChart.append(note);
  }
  const rows = [
    { label: 'Earth', band: bands.earth, cls: 'earth' },
    { label: 'Target', band: bands.target, cls: 'target' },
  ];
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'thermal-row';
    addText(el, 'span', '', row.label);
    const track = document.createElement('div');
    track.className = 'thermal-track';
    if (row.band && (row.band.min !== null || row.band.max !== null)) {
      const min = row.band.min ?? bands.minK;
      const max = row.band.max ?? bands.maxK;
      const left = ((min - bands.minK) / bands.span) * 100;
      const width = ((max - min) / bands.span) * 100;
      const band = document.createElement('div');
      band.className = `thermal-band ${row.cls}`;
      band.style.left = `${left}%`;
      band.style.width = `${Math.max(width, 2)}%`;
      track.append(band);
      el.append(track);
      addText(el, 'span', '', `${min?.toFixed(0) ?? '—'}–${max?.toFixed(0) ?? '—'} K`);
    } else {
      addText(track, 'span', '', '—');
      el.append(track);
      addText(el, 'span', '', 'no data');
    }
    thermalChart.append(el);
  }
}

function renderSources(candidate, comparison) {
  sourcesList.replaceChildren();
  const items = new Set();
  for (const item of state.discovery?.caveats || []) items.add(item);
  for (const item of comparison?.caveats || []) items.add(item);
  for (const text of items) addText(sourcesList, 'li', '', text);
  if (candidate?.place?.source) {
    addText(sourcesList, 'li', '', `Place label via ${candidate.place.source}; nearest named location, not the official site. © OpenStreetMap contributors.`);
  }
  for (const source of candidate?.provenance || []) {
    const li = document.createElement('li');
    addText(li, 'span', '', `${source.label} · `);
    const a = document.createElement('a');
    a.href = source.url;
    a.textContent = 'source';
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    li.append(a);
    sourcesList.append(li);
  }
  for (const source of state.target?.provenance || []) {
    const li = document.createElement('li');
    addText(li, 'span', '', `Target · ${source.label} · `);
    if (source.url) {
      const a = document.createElement('a');
      a.href = source.url;
      a.textContent = 'source';
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      li.append(a);
    }
    sourcesList.append(li);
  }
}

function updateSplitLabels() {
  const candidate = selectedCandidate();
  const target = state.target;
  if (!candidate || !target) return;
  const earthName = $('split-earth-name');
  earthName.textContent = `#${candidate.rank} · ${candidateTitle(candidate)}`;
  if (candidate.place?.name) earthName.title = PLACE_TITLE;
  $('split-target-name').textContent = target.name || target.id;
  $('split-target-kind').textContent = `${(target.body || 'target').toUpperCase()} / TARGET`;
  $('split-earth-kind').textContent = `EARTH / CANDIDATE · ${datasetShortLabel(candidate.dataset)}`;
  $('split-earth-note').textContent = `${candidate.scaleMeters || candidate.extentMeters} m window · DEM hillshade`;
  $('split-target-note').textContent = `${target.extentMeters} m window · ${target.dataset || 'planetary DEM'}`;
  const imagery = target.imagery;
  const credit = $('imagery-credit');
  if ($('target-imagery').checked && imagery?.credit) {
    credit.hidden = false;
    credit.textContent = imagery.credit;
  } else {
    credit.hidden = true;
    credit.textContent = '';
  }
}

function activeRegionIds() {
  return new Set((state.discovery?.candidates || []).map((c) => c.region?.id).filter(Boolean));
}

function updateSceneMarkers() {
  if (!scene?.webgl || !state.discovery) return;
  scene.setGlobeMarkers({
    regions: state.regions?.regions || [],
    candidates: state.discovery.candidates,
    activeRegionIds: activeRegionIds(),
    selectedCandidateId: state.selectedId,
  });
}

async function selectCandidate(id) {
  const candidate = state.discovery?.candidates?.find((c) => c.id === id);
  if (!candidate) return;
  state.selectedId = id;
  syncDiscoveryChat();
  renderCandidateList();
  const comparison = comparisonFor(candidate);
  renderComparePanel();
  renderSources(candidate, comparison);
  updateSplitLabels();
  updateSceneMarkers();
  if (scene?.webgl) {
    scene.setTargetImagery($('target-imagery').checked);
    await scene.setPair(candidate, state.target);
    scene.focusCandidate(candidate.center[0], candidate.center[1]);
  }
  const row = document.getElementById(`candidate-${id}`);
  row?.scrollIntoView({ block: 'nearest' });
  syncHash();
}

function setView(view) {
  state.view = view;
  viewport.dataset.view = view;
  $('view-split').classList.toggle('view-tab-active', view === 'split');
  $('view-globe').classList.toggle('view-tab-active', view === 'globe');
  $('view-split').setAttribute('aria-pressed', String(view === 'split'));
  $('view-globe').setAttribute('aria-pressed', String(view === 'globe'));
  const splitOverlay = $('split-overlay');
  splitOverlay.hidden = view !== 'split';
  scene?.setView(view);
  if (view === 'globe') updateSceneMarkers();
}

function setSplitPane(pane) {
  state.splitPane = pane;
  viewport.querySelector('.split-overlay')?.setAttribute('data-pane', pane);
  $('split-tab-earth').setAttribute('aria-pressed', String(pane === 'earth'));
  $('split-tab-target').setAttribute('aria-pressed', String(pane === 'target'));
  scene?.setSplitPane(pane);
}

let scene = null;

function initScene() {
  scene = createDiscoveryScene(canvas, {
    reducedMotion,
    onPick: (hit) => {
      if (hit.candidateId) selectCandidate(hit.candidateId);
      else if (hit.regionId) {
        const match = bestCandidateByRegion(state.discovery?.candidates || []).get(hit.regionId);
        if (match) selectCandidate(match.id);
      }
    },
  });
  if (!scene.webgl) {
    canvas.hidden = true;
    sceneFallback.hidden = false;
    $('scene-hint').hidden = true;
    document.querySelector('.discovery-scene-tools')?.setAttribute('hidden', '');
    return;
  }
  scene.start();
  const resize = () => {
    const rect = viewport.getBoundingClientRect();
    scene.resize(Math.round(rect.width), Math.round(rect.height));
  };
  new ResizeObserver(resize).observe(viewport);
  resize();
  $('scene-center').addEventListener('click', () => scene.centerCamera());
  $('scene-zoom-in').addEventListener('click', () => scene.zoomIn());
  $('scene-zoom-out').addEventListener('click', () => scene.zoomOut());
  $('scene-motion').addEventListener('click', () => {
    state.motion = !state.motion;
    scene.setMotion(state.motion);
    const button = $('scene-motion');
    button.setAttribute('aria-pressed', String(!state.motion));
    button.textContent = state.motion ? 'Ⅱ' : '▷';
  });
  reducedMotion.addEventListener?.('change', (event) => {
    if (event.matches) {
      state.motion = false;
      scene.setMotion(false);
    }
  });
}

async function loadDiscovery(targetId) {
  state.discovery = null;
  state.target = null;
  state.regions = null;
  state.selectedId = null;
  state.comparisons.clear();
  syncDiscoveryChat();
  candidateList.replaceChildren();
  status.textContent = 'Loading candidate ranking…';
  try {
    const [discoveryResponse, regionsResponse] = await Promise.all([
      fetch(`assets/data/discovery/${encodeURIComponent(targetId)}.json`),
      fetch(`assets/data/discovery/regions-${encodeURIComponent(targetId)}.json`),
    ]);
    if (!discoveryResponse.ok) throw new Error('No scan is available for this target yet.');
    const discovery = await discoveryResponse.json();
    const targetResponse = await fetch(discovery.target);
    if (!targetResponse.ok) throw new Error('Could not load the target terrain data.');
    const target = await targetResponse.json();
    state.discovery = discovery;
    state.target = target;
    if (regionsResponse.ok) state.regions = await regionsResponse.json();
    for (const candidate of discovery.candidates) {
      state.comparisons.set(candidate.id, compareTerrain(candidate, target));
    }
    const datasetEl = $('discovery-dataset');
    if (datasetEl && discovery.candidates[0]?.dataset) {
      datasetEl.textContent = datasetShortLabel(discovery.candidates[0].dataset);
    }
    renderHowStrip(discovery);
    const regionNames = (discovery.regions || []).map((r) => r.name).join(' · ');
    status.textContent = `${regionNames || targetId} · ${discovery.scannedCells} cells scanned · ${discovery.validCells ?? discovery.candidates.length} valid · ${discovery.candidates.length} shown`;
    const fromHash = parseHashTarget();
    const pickRank = fromHash?.targetId === targetId ? fromHash.rank : null;
    const pick = (pickRank && discovery.candidates.find((c) => c.rank === pickRank))
      || discovery.candidates[0];
    if (pick) await selectCandidate(pick.id);
    else renderComparePanel();
  } catch (error) {
    status.textContent = error.message;
    compareIndex.textContent = '—';
    sourcesList.replaceChildren();
  }
}

candidateList.addEventListener('keydown', (event) => {
  const rows = [...candidateList.querySelectorAll('.candidate-row')];
  const index = rows.findIndex((row) => row.id === `candidate-${state.selectedId}`);
  if (event.key === 'ArrowDown' && index < rows.length - 1) {
    event.preventDefault();
    rows[index + 1].click();
    rows[index + 1].focus();
  } else if (event.key === 'ArrowUp' && index > 0) {
    event.preventDefault();
    rows[index - 1].click();
    rows[index - 1].focus();
  }
});

$('view-split').addEventListener('click', () => setView('split'));
$('view-globe').addEventListener('click', () => setView('globe'));
$('split-tab-earth').addEventListener('click', () => setSplitPane('earth'));
$('split-tab-target').addEventListener('click', () => setSplitPane('target'));
$('target-imagery').addEventListener('change', (event) => {
  scene?.setTargetImagery(event.target.checked);
  updateSplitLabels();
  if (state.discovery && state.selectedId) {
    const candidate = selectedCandidate();
    if (candidate) scene?.setPair(candidate, state.target);
  }
});
mobileQuery.addEventListener?.('change', () => setSplitPane(state.splitPane));

$('download-geojson')?.addEventListener('click', () => {
  if (!state.discovery) return;
  const blob = new Blob([JSON.stringify(toGeoJSON(state.discovery, state.comparisons), null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `discovery-${state.targetId}-top5.geojson`;
  a.click();
  URL.revokeObjectURL(url);
});

const initialHash = parseHashTarget();
if (initialHash) state.targetId = initialHash.targetId;

initTargetButtons();
initScene();
setView('split');
loadDiscovery(state.targetId);
