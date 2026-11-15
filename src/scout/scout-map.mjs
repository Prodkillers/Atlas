// Minimal slippy map on a canvas (no dependencies): Web Mercator tiles, pan, wheel/button zoom,
// click callback and an overlay hook. Tiles: EOX Sentinel-2 cloudless 2020 (CC BY 4.0).
import { lonLatToWorld, worldToLonLat } from './scout-geo.mjs';

export const TILE_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
export const TILE_ATTRIBUTION = 'Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020) · CC BY 4.0';
const MIN_Z = 2, MAX_Z = 15, TILE = 256;

export function createScoutMap(canvas, { onClick, onDoubleClick, onDraw, onMove } = {}) {
  const ctx = canvas.getContext('2d');
  const tiles = new Map();
  let lon = 0, lat = 20, zoom = 2, width = 1, height = 1, ratio = 1, queued = false, tileErrors = 0;
  const drag = { active: false, moved: 0, x: 0, y: 0, id: null };

  function centerWorld(z = zoom) { return lonLatToWorld(lon, lat, z); }
  function toScreen(lo, la) {
    const [cx, cy] = centerWorld();
    const [x, y] = lonLatToWorld(lo, la, zoom);
    return [x - cx + width / 2, y - cy + height / 2];
  }
  function toLonLat(sx, sy) {
    const [cx, cy] = centerWorld();
    const [lo, la] = worldToLonLat(cx + sx - width / 2, cy + sy - height / 2, zoom);
    return [((lo + 540) % 360) - 180, la];
  }
  function metersPerPixel() { return 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom; }
  function tile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let t = tiles.get(key);
    if (!t) {
      t = new Image();
      t.crossOrigin = 'anonymous';
      t.decoding = 'async';
      t.onload = redraw;
      t.onerror = () => { tileErrors++; t.failed = true; redraw(); };
      t.src = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      tiles.set(key, t);
      if (tiles.size > 600) tiles.delete(tiles.keys().next().value);
    }
    return t;
  }
  function draw() {
    queued = false;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#06122f';
    ctx.fillRect(0, 0, width, height);
    const z = Math.max(MIN_Z, Math.min(MAX_Z, Math.floor(zoom)));
    const scale = 2 ** (zoom - z), size = TILE * scale, n = 2 ** z;
    const [cx, cy] = centerWorld(z);
    const x0 = Math.floor((cx - width / 2 / scale) / TILE), x1 = Math.floor((cx + width / 2 / scale) / TILE);
    const y0 = Math.max(0, Math.floor((cy - height / 2 / scale) / TILE)), y1 = Math.min(n - 1, Math.floor((cy + height / 2 / scale) / TILE));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const img = tile(z, ((tx % n) + n) % n, ty);
      const sx = (tx * TILE - cx) * scale + width / 2, sy = (ty * TILE - cy) * scale + height / 2;
      if (img.complete && img.naturalWidth && !img.failed) ctx.drawImage(img, sx, sy, size + 0.5, size + 0.5);
      else { ctx.strokeStyle = 'rgba(120,150,210,.18)'; ctx.strokeRect(sx, sy, size, size); }
    }
    onDraw?.(ctx, api);
  }
  function redraw() { if (!queued) { queued = true; requestAnimationFrame(draw); } }
  function setView(lo, la, z = zoom) {
    lon = ((lo + 540) % 360) - 180;
    lat = Math.max(-84, Math.min(84, la));
    zoom = Math.max(MIN_Z, Math.min(MAX_Z, z));
    redraw();
    onMove?.(api);
  }
  function zoomAt(factor, sx = width / 2, sy = height / 2) {
    const before = toLonLat(sx, sy);
    zoom = Math.max(MIN_Z, Math.min(MAX_Z, zoom + Math.log2(factor)));
    const after = toLonLat(sx, sy);
    setView(lon + before[0] - after[0], lat + before[1] - after[1], zoom);
  }
  function fit(bbox, pad = 40) {
    const [w, s, e, nn] = bbox;
    for (let z = MAX_Z; z >= MIN_Z; z -= 0.25) {
      const [ax, ay] = lonLatToWorld(w, nn, z), [bx, by] = lonLatToWorld(e, s, z);
      if (bx - ax <= width - 2 * pad && by - ay <= height - 2 * pad) {
        const [mlo, mla] = worldToLonLat((ax + bx) / 2, (ay + by) / 2, z);
        setView(mlo, mla, z);
        return;
      }
    }
    setView((w + e) / 2, (s + nn) / 2, MIN_Z);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    ratio = Math.min(devicePixelRatio || 1, 2);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    redraw();
  }
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => {
    drag.active = true; drag.moved = 0; drag.id = e.pointerId; [drag.x, drag.y] = local(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag.active || e.pointerId !== drag.id) return;
    const [x, y] = local(e);
    drag.moved += Math.abs(x - drag.x) + Math.abs(y - drag.y);
    if (drag.moved > 4) {
      const [cx, cy] = centerWorld();
      const [lo, la] = worldToLonLat(cx - (x - drag.x), cy - (y - drag.y), zoom);
      setView(lo, la);
    }
    drag.x = x; drag.y = y;
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag.active || e.pointerId !== drag.id) return;
    drag.active = false;
    if (drag.moved <= 4) { const [x, y] = local(e); onClick?.(...toLonLat(x, y), e); }
  });
  canvas.addEventListener('dblclick', e => { e.preventDefault(); onDoubleClick?.(); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e); zoomAt(e.deltaY < 0 ? 1.5 : 1 / 1.5, x, y); }, { passive: false });
  canvas.addEventListener('keydown', e => {
    const step = 80, [cx, cy] = centerWorld();
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); setView(...worldToLonLat(cx + moves[e.key][0], cy + moves[e.key][1], zoom)); }
    else if (e.key === '+' || e.key === '=') zoomAt(2);
    else if (e.key === '-') zoomAt(0.5);
  });
  new ResizeObserver(resize).observe(canvas);
  resize();
  const api = {
    toScreen, toLonLat, setView, fit, redraw, metersPerPixel, zoomIn: () => zoomAt(2), zoomOut: () => zoomAt(0.5),
    get view() { return { lon, lat, zoom }; }, get size() { return { width, height }; }, get tileErrors() { return tileErrors; },
  };
  return api;
}
