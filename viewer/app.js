import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const nl = (v, digits = 3) => v.toLocaleString('nl-NL', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const css = (name) => getComputedStyle($('app')).getPropertyValue(name).trim();

// Logged values we know how to present; anything else is ignored
const VALUE_LABELS = {
  drag: { title: 'Weerstand', sub: 'Cd', digits: 4 },
  losses: { title: 'Drukverlies', sub: 'totale drukverlies-flux', digits: 4, sci: true },
};

// ---------------------------------------------------------------- 3D scene
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(css('--page'));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 1000);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(1, 1.5, 2);
camera.add(keyLight);  // light follows the view, so the side you look at is always lit

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- state
let data = null;
let cyclePos = [];          // Float32Array per cycle
let normals0 = null;        // outward vertex normals of cycle 1
let surface = null, ghost = null, wire = null, arrow = null;
let scales = {};            // colour scale (max |value|) per mode
let t = 1;                  // current (fractional) cycle, 1-based
let playing = false;

const colNeg = new THREE.Color(css('--div-neg'));
const colMid = new THREE.Color(css('--div-mid'));
const colPos = new THREE.Color(css('--div-pos'));
const colAllowed = new THREE.Color(css('--seq-allowed'));
const colPriority = new THREE.Color(css('--seq-priority'));

// paint channels, one weight in [0, 1] per surface point (indices of the export)
let paint = { allowed: new Float32Array(0), priority: new Float32Array(0) };

function positionsAt(time, out) {
  const n = cyclePos.length;
  const tc = Math.min(Math.max(time, 1), n);
  const i = Math.max(0, Math.min(Math.floor(tc), n - 1) - 1);
  const j = Math.min(i + 1, n - 1);
  const f = i === j ? 0 : tc - 1 - i;
  const a = cyclePos[i], b = cyclePos[j];
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}

// signed normal displacement per vertex for a mode, at a (fractional) cycle
let bufA = new Float32Array(0), bufB = new Float32Array(0);
function signedDisplacement(mode, time, out) {
  positionsAt(time, bufA);
  const ref = mode === 'start' ? cyclePos[0] : positionsAt(time - 1, bufB);
  for (let v = 0; v < data.nPoints; v++) {
    const k = 3 * v;
    out[v] = (bufA[k] - ref[k]) * normals0[k]
           + (bufA[k + 1] - ref[k + 1]) * normals0[k + 1]
           + (bufA[k + 2] - ref[k + 2]) * normals0[k + 2];
  }
  return out;
}

function buildScene() {
  for (const o of [surface, ghost, wire, arrow]) if (o) scene.remove(o);

  cyclePos = data.cycles.map((c) => new Float32Array(c.positions));
  bufA = new Float32Array(cyclePos[0].length);
  bufB = new Float32Array(cyclePos[0].length);

  // OpenFOAM faces point out of the fluid; flip so normals point outward as seen by the viewer
  const tri = data.triangles.slice();
  if (data.outwardSign < 0) {
    for (let k = 0; k < tri.length; k += 3) [tri[k + 1], tri[k + 2]] = [tri[k + 2], tri[k + 1]];
  }

  const g0 = new THREE.BufferGeometry();
  g0.setAttribute('position', new THREE.BufferAttribute(cyclePos[0].slice(), 3));
  g0.setIndex(tri);
  g0.computeVertexNormals();
  normals0 = g0.getAttribute('normal').array.slice();

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(cyclePos[0].slice(), 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cyclePos[0].length), 3));
  geom.setIndex(tri);
  geom.computeVertexNormals();

  surface = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide,
  }));
  scene.add(surface);

  ghost = new THREE.Mesh(g0, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
    // where the shape has not moved, keep the ghost just behind it (no z-fighting)
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4,
  }));
  ghost.renderOrder = 1;
  ghost.visible = $('ghost').checked;
  scene.add(ghost);

  wire = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    color: 0x000000, wireframe: true, transparent: true, opacity: 0.25,
  }));
  wire.visible = $('wire').checked;
  scene.add(wire);

  // camera framing on the union of all cycles, so later shapes stay in view
  const box = new THREE.Box3();
  for (const p of cyclePos) {
    for (let k = 0; k < p.length; k += 3) box.expandByPoint(new THREE.Vector3(p[k], p[k + 1], p[k + 2]));
  }
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  modelRadius = radius;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(-1.2, 0.9, 2.2).normalize().multiplyScalar(radius * 3.4));
  camera.near = radius / 100; camera.far = radius * 100;
  camera.updateProjectionMatrix();

  if (data.flow) {
    const dir = new THREE.Vector3(...data.flow).normalize();
    const origin = center.clone().addScaledVector(dir, -radius * 1.7);
    arrow = new THREE.ArrowHelper(dir, origin, radius * 0.7, 0x898781, radius * 0.18, radius * 0.1);
    scene.add(arrow);
  }

  // colour scale per mode: fixed over all cycles, so cycles compare honestly
  const tmp = new Float32Array(data.nPoints);
  scales = {};
  for (const mode of ['start', 'prev']) {
    let m = 0;
    for (let c = 1; c <= cyclePos.length; c++) {
      signedDisplacement(mode, c, tmp);
      for (const v of tmp) m = Math.max(m, Math.abs(v));
    }
    scales[mode] = m;
  }
}

const dispBuf = { arr: new Float32Array(0) };
function updateSurface() {
  const geom = surface.geometry;
  const pos = geom.getAttribute('position');
  positionsAt(t, pos.array);
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();  // keeps raycasting (painting) correct on the deformed shape
  geom.computeBoundingBox();
  updateColors();

  const ds = signedDisplacement('start', t, new Float32Array(data.nPoints));
  let out = 0, inw = 0;
  for (const v of ds) { out = Math.max(out, v); inw = Math.min(inw, v); }
  $('stats').textContent = `T.o.v. begin: max ${nl(out, 3)} ${data.unit} naar buiten, ${nl(-inw, 3)} ${data.unit} naar binnen`;
}

function updateColors() {
  const mode = $('colorMode').value;
  const col = surface.geometry.getAttribute('color');
  const c = new THREE.Color();
  const n = data.nPoints;
  if (mode === 'allowed' || mode === 'priority' || mode === 'effective') {
    const w = mode === 'effective' ? effectiveAllowed() : paint[mode];
    const hue = mode === 'priority' ? colPriority : colAllowed;
    for (let v = 0; v < n; v++) c.copy(colMid).lerp(hue, w[v]).toArray(col.array, 3 * v);
  } else if (mode === 'none' || !scales[mode]) {
    for (let v = 0; v < n; v++) colMid.toArray(col.array, 3 * v);
  } else {
    if (dispBuf.arr.length !== n) dispBuf.arr = new Float32Array(n);
    const d = signedDisplacement(mode, t, dispBuf.arr);
    for (let v = 0; v < n; v++) {
      const x = Math.max(-1, Math.min(1, d[v] / scales[mode]));
      if (x >= 0) c.copy(colMid).lerp(colPos, x); else c.copy(colMid).lerp(colNeg, -x);
      c.toArray(col.array, 3 * v);
    }
  }
  col.needsUpdate = true;

  // colour bar: diverging for displacement, sequential for paint
  const cb = $('colorbar');
  cb.classList.toggle('off', mode === 'none');
  const bar = cb.querySelector('.bar');
  if (mode === 'allowed' || mode === 'priority' || mode === 'effective') {
    bar.style.background = `linear-gradient(90deg, ${css('--div-mid')}, ${css(mode === 'priority' ? '--seq-priority' : '--seq-allowed')})`;
    const maxD = data.box && data.box.maxDisplacement;
    $('cbMin').textContent = '0 %'; $('cbMid').textContent = '';
    $('cbMax').textContent = mode !== 'priority' && maxD ? `100 % = ${nl(maxD, 2)} ${data.unit}` : '100 %';
    $('cbLeft').textContent = mode === 'priority' ? 'geen voorkeur' : 'vast';
    $('cbRight').textContent = mode === 'priority' ? 'sterke voorkeur'
      : mode === 'effective' && !paint.allowed.some((v) => v > 0) ? 'niets geschilderd: alles vrij' : 'vrij';
  } else {
    bar.style.background = '';
    const m = scales[mode] || 0;
    $('cbMin').textContent = mode === 'none' ? '' : '−' + nl(m, 3) + ' ' + data.unit;
    $('cbMid').textContent = '0';
    $('cbMax').textContent = mode === 'none' ? '' : '+' + nl(m, 3) + ' ' + data.unit;
    $('cbLeft').textContent = 'naar binnen'; $('cbRight').textContent = 'naar buiten';
  }
}

// ---------------------------------------------------------------- charts
const tooltip = $('tooltip');
let charts = [];

function chartSeries() {
  const series = [];
  for (const [key, meta] of Object.entries(VALUE_LABELS)) {
    const pts = data.cycles.map((c) => [c.cycle, c.values[key]]).filter(([, v]) => v !== undefined);
    if (pts.length) series.push({ key, ...meta, pts, fmt: (v) => meta.sci ? v.toExponential(3) : nl(v, meta.digits) });
  }
  if (data.body && data.cycles[0].volume) {
    const v0 = data.cycles[0].volume;
    series.push({
      key: 'volume', title: 'Volume', sub: 't.o.v. start, in %', pts: data.cycles.map((c) => [c.cycle, (c.volume / v0 - 1) * 100]),
      fmt: (v) => (v > 0 ? '+' : '') + nl(v, 2) + ' %',
    });
  }
  return series;
}

function niceTicks(lo, hi, n = 3) {
  if (lo === hi) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1; }
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= step0);
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

function buildCharts() {
  const root = $('charts');
  root.innerHTML = '';
  charts = [];
  const N = data.cycles.length;
  const W = 300, H = 120, ml = 52, mr = 10, mt = 8, mb = 22;
  for (const s of chartSeries()) {
    const div = document.createElement('div');
    div.className = 'chart';
    div.innerHTML = `<h2>${s.title}</h2><p class="sub">${s.sub}<span class="delta"></span></p>`;
    const ys = s.pts.map(([, v]) => v);
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const sx = (c) => ml + (N === 1 ? 0.5 : (c - 1) / (N - 1)) * (W - ml - mr);
    const sy = (v) => mt + (1 - (v - y0) / (y1 - y0)) * (H - mt - mb);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let html = '';
    for (const v of ticks) {
      html += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${sy(v)}" y2="${sy(v)}"/>`;
      html += `<text class="tick" x="${ml - 6}" y="${sy(v) + 4}" text-anchor="end">${s.fmt(v)}</text>`;
    }
    html += `<line class="axis" x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}"/>`;
    for (let c = 1; c <= N; c++) html += `<text class="tick" x="${sx(c)}" y="${H - 6}" text-anchor="middle">${c}</text>`;
    html += `<line class="cursor" y1="${mt}" y2="${H - mb}" visibility="hidden"/>`;
    html += `<path class="line" d="${s.pts.map(([c, v], i) => (i ? 'L' : 'M') + sx(c) + ' ' + sy(v)).join('')}"/>`;
    for (const [c, v] of s.pts) html += `<circle class="dot" cx="${sx(c)}" cy="${sy(v)}" r="4"/>`;
    html += `<circle class="now" r="7"/>`;
    const colW = (W - ml - mr) / Math.max(N - 1, 1);
    for (const [c] of s.pts) html += `<rect class="hit" data-c="${c}" x="${sx(c) - colW / 2}" y="0" width="${colW}" height="${H}"/>`;
    svg.innerHTML = html;
    div.appendChild(svg);
    root.appendChild(div);

    const cursor = svg.querySelector('.cursor');
    for (const r of svg.querySelectorAll('.hit')) {
      const c = +r.dataset.c;
      const v = s.pts.find(([cc]) => cc === c)[1];
      r.addEventListener('pointermove', (e) => {
        cursor.setAttribute('x1', sx(c)); cursor.setAttribute('x2', sx(c)); cursor.setAttribute('visibility', 'visible');
        tooltip.hidden = false;
        tooltip.textContent = `Cyclus ${c}: ${s.fmt(v)}`;
        tooltip.style.left = e.clientX + 12 + 'px';
        tooltip.style.top = e.clientY - 28 + 'px';
      });
      r.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); tooltip.hidden = true; });
      r.addEventListener('click', () => setCycle(c));
    }
    charts.push({ s, svg, sx, sy, div });
  }
}

function updateCharts() {
  for (const { s, svg, sx, sy, div } of charts) {
    const last = s.pts[s.pts.length - 1][0];
    const tc = Math.min(t, last);
    const i = s.pts.findIndex(([c]) => c >= tc);
    let v;
    if (i <= 0) v = s.pts[0][1];
    else {
      const [c0, v0] = s.pts[i - 1], [c1, v1] = s.pts[i];
      v = v0 + (v1 - v0) * (tc - c0) / (c1 - c0);
    }
    const now = svg.querySelector('.now');
    now.setAttribute('cx', sx(tc)); now.setAttribute('cy', sy(v));
    const first = s.pts[0][1];
    let delta = '';
    if (s.key !== 'volume' && first) delta = ` · nu ${s.fmt(v)} (${v >= first ? '+' : '−'}${nl(Math.abs(v / first - 1) * 100, 1)} % t.o.v. start)`;
    if (s.key === 'volume') delta = ` · nu ${s.fmt(v)}`;
    div.querySelector('.delta').textContent = delta;
  }
}

function buildTable() {
  const series = chartSeries();
  let html = '<tr><th>Cyclus</th>' + series.map((s) => `<th>${s.title}</th>`).join('') + '</tr>';
  for (const c of data.cycles) {
    html += `<tr><td>${c.cycle}</td>` + series.map((s) => {
      const p = s.pts.find(([cc]) => cc === c.cycle);
      return `<td>${p ? s.fmt(p[1]) : '–'}</td>`;
    }).join('') + '</tr>';
  }
  $('table').innerHTML = html;
}

// ---------------------------------------------------------------- paint -> control points
// Mirrors tools/paint_to_bounds.py: paint is averaged onto the morphing-box
// control points (weighted by their B-spline basis at each point), and the
// effective 'allowed' of a point is the basis-weighted sum of those weights.
let support = null;        // per point: { cp: Int32Array, w: Float64Array } or null outside the box
let effectiveBuf = new Float32Array(0);

function basisFn(u, n, p, kv) {
  u = Math.min(u, 1 - 1e-12);
  const N = new Float64Array(n + p);
  for (let i = 0; i < n + p; i++) N[i] = kv[i] <= u && u < kv[i + 1] ? 1 : 0;
  for (let q = 1; q <= p; q++) {
    for (let i = 0; i < n + p - q; i++) {
      const d1 = kv[i + q] - kv[i], d2 = kv[i + q + 1] - kv[i + 1];
      N[i] = (d1 > 0 ? (u - kv[i]) / d1 * N[i] : 0) + (d2 > 0 ? (kv[i + q + 1] - u) / d2 * N[i + 1] : 0);
    }
  }
  return N.subarray(0, n);
}

function buildSupport() {
  support = null;
  effectiveBuf = new Float32Array(data.nPoints);
  const opt = [...$('colorMode').options].find((o) => o.value === 'effective');
  opt.hidden = !data.box;
  if (!data.box) return;
  const { n: [nu, nv, nw], degree, knots, param } = data.box;
  support = [];
  for (let v = 0; v < data.nPoints; v++) {
    if (param[3 * v] < 0) { support.push(null); continue; }
    const bu = basisFn(param[3 * v], nu, degree[0], knots[0]);
    const bv = basisFn(param[3 * v + 1], nv, degree[1], knots[1]);
    const bw = basisFn(param[3 * v + 2], nw, degree[2], knots[2]);
    const cp = [], w = [];
    for (let k = 0; k < nw; k++) {
      if (!bw[k]) continue;
      for (let j = 0; j < nv; j++) {
        if (!bv[j]) continue;
        for (let i = 0; i < nu; i++) {
          if (!bu[i]) continue;
          cp.push(i + j * nu + k * nu * nv);
          w.push(bu[i] * bv[j] * bw[k]);
        }
      }
    }
    support.push({ cp: Int32Array.from(cp), w: Float64Array.from(w) });
  }
}

function effectiveAllowed() {
  const out = effectiveBuf, a = paint.allowed;
  if (!support || !a.some((v) => v > 0)) { out.fill(1); return out; }  // nothing painted: unrestricted
  const [nu, nv, nw] = data.box.n;
  const num = new Float64Array(nu * nv * nw), den = new Float64Array(nu * nv * nw);
  for (let v = 0; v < data.nPoints; v++) {
    const s = support[v];
    if (!s) continue;
    for (let k = 0; k < s.cp.length; k++) { num[s.cp[k]] += s.w[k] * a[v]; den[s.cp[k]] += s.w[k]; }
  }
  for (let c = 0; c < num.length; c++) num[c] = den[c] > 1e-12 ? num[c] / den[c] : 0;
  for (let v = 0; v < data.nPoints; v++) {
    const s = support[v];
    let e = 0;
    if (s) for (let k = 0; k < s.cp.length; k++) e += s.w[k] * num[s.cp[k]];
    out[v] = e;
  }
  return out;
}

// ---------------------------------------------------------------- painting
const TOOL_HELP = {
  view: 'Draaien: slepen. Zoomen: scrollen of knijpen.',
  allowed: 'Spuit waar de vorm mag veranderen: 0 % = vast, 100 % = vrij. Zolang er niets geschilderd is, mag alles. Draaien: rechts slepen of twee vingers.',
  priority: 'Spuit waar je verwacht dat veranderen het meeste oplevert; daar zet de optimalisatie grotere stappen. Draaien: rechts slepen of twee vingers.',
};
let tool = 'view';
let api = false;            // true when a viewer server stores the paint
let modelRadius = 1;
let stroke = null;          // { channel, before, changed }
const undoStack = [];
let hit = null;             // { point, normal } under the pointer
const activePointers = new Set();
let shiftDown = false;
let saveTimer = null;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const cursor = new THREE.Mesh(
  new THREE.RingGeometry(0.92, 1, 64),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
);
cursor.renderOrder = 3;
cursor.visible = false;
scene.add(cursor);

function brush() {
  return {
    radius: +$('size').value * modelRadius,
    opacity: +$('opacity').value,
    flow: +$('flow').value,
    hardness: +$('hardness').value,
    erase: $('erase').checked || shiftDown,
  };
}

function updateBrushLabels() {
  $('sizeOut').textContent = nl(+$('size').value * modelRadius, 2) + ' ' + (data ? data.unit : '');
  $('opacityOut').textContent = Math.round(+$('opacity').value * 100) + ' %';
  $('flowOut').textContent = Math.round(+$('flow').value * 100) + ' %';
  $('hardnessOut').textContent = Math.round(+$('hardness').value * 100) + ' %';
  cursor.scale.setScalar(brush().radius);
}

function setTool(name) {
  tool = name;
  for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.tool === name);
  const painting = name !== 'view';
  $('brush').hidden = !painting;
  $('toolHelp').textContent = TOOL_HELP[name];
  view.classList.toggle('painting', painting);
  // While painting the left button / one finger paints; rotate with right button / two fingers
  controls.mouseButtons = painting
    ? { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = painting
    ? { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE }
    : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  if (painting) $('colorMode').value = name;
  if (!painting) cursor.visible = false;
  if (data) updateColors();
}

function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(surface, false);
  if (!hits.length) { hit = null; cursor.visible = false; return; }
  const h = hits[0];
  const normal = h.face.normal.clone();
  if (normal.dot(raycaster.ray.direction) > 0) normal.negate();  // the side facing the camera
  hit = { point: h.point.clone(), normal };
  cursor.position.copy(h.point).addScaledVector(normal, 0.002 * modelRadius);
  cursor.lookAt(h.point.clone().add(normal));
  cursor.visible = true;
}

function startStroke() {
  stroke = { channel: tool, before: paint[tool].slice(), changed: false };
}

function cancelStroke() {
  if (!stroke) return;
  paint[stroke.channel].set(stroke.before);
  stroke = null;
  updateColors();
}

function endStroke() {
  if (!stroke) return;
  if (stroke.changed) {
    undoStack.push({ channel: stroke.channel, before: stroke.before });
    if (undoStack.length > 30) undoStack.shift();
    scheduleSave();
  }
  stroke = null;
}

// Airbrush: while held, each point under the brush moves towards the target
// at a rate set by flow and the brush falloff. Painting never lowers a value
// (opacity caps a stroke, like an airbrush); the eraser only lowers.
function sprayStep(dt) {
  const b = brush();
  const w = paint[stroke.channel];
  const pos = surface.geometry.getAttribute('position').array;
  const nrm = surface.geometry.getAttribute('normal').array;
  const { point: p, normal: hn } = hit;
  const r2 = b.radius * b.radius;
  const rate = 1 + 11 * b.flow;  // 1/s
  for (let v = 0; v < data.nPoints; v++) {
    const k = 3 * v;
    const dx = pos[k] - p.x, dy = pos[k + 1] - p.y, dz = pos[k + 2] - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    // only the side facing the brush, so paint does not bleed through to the back
    if (nrm[k] * hn.x + nrm[k + 1] * hn.y + nrm[k + 2] * hn.z <= 0.1) continue;
    const x = Math.sqrt(d2) / b.radius;
    let f = 1;
    if (x > b.hardness) {
      const s = (x - b.hardness) / (1 - b.hardness + 1e-9);
      f = 1 - s * s * (3 - 2 * s);
    }
    const a = 1 - Math.exp(-rate * f * dt);
    if (b.erase) w[v] = w[v] * (1 - a) < 0.005 ? 0 : w[v] * (1 - a);  // reach a clean zero
    else if (w[v] < b.opacity) w[v] = Math.min(b.opacity, w[v] + (b.opacity - w[v]) * a);
  }
  stroke.changed = true;
  updateColors();
}

function undo() {
  const u = undoStack.pop();
  if (!u) return;
  paint[u.channel].set(u.before);
  updateColors();
  scheduleSave();
}

function fillAll(value) {
  if (tool === 'view') return;
  undoStack.push({ channel: tool, before: paint[tool].slice() });
  paint[tool].fill(value);
  updateColors();
  scheduleSave();
}

function scheduleSave() {
  if (!api) { $('saveState').textContent = 'Niet opgeslagen: deze pagina draait zonder viewer-server.'; return; }
  $('saveState').textContent = 'Opslaan…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePaint, 600);
}

async function savePaint() {
  const round = (a) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
  const body = JSON.stringify({
    patch: data.patch, nPoints: data.nPoints,
    channels: { allowed: round(paint.allowed), priority: round(paint.priority) },
  });
  try {
    const res = await fetch(`api/paint/${$('case').value}`, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
    const msg = await res.json();
    $('saveState').textContent = res.ok ? 'Opgeslagen.' : `Opslaan mislukt: ${msg.error}`;
  } catch (err) {
    $('saveState').textContent = `Opslaan mislukt: ${err.message}`;
  }
}

async function loadPaint(id) {
  paint = { allowed: new Float32Array(data.nPoints), priority: new Float32Array(data.nPoints) };
  undoStack.length = 0;
  try {
    const res = await fetch(`api/paint/${id}`, { cache: 'no-cache' });
    api = (res.headers.get('content-type') || '').includes('json');
    if (!api) { $('saveState').textContent = 'Alleen bekijken: opslaan werkt via de viewer-server.'; return; }
    const saved = await res.json();
    if (!res.ok) { $('saveState').textContent = `Verf laden mislukt: ${saved.error}`; return; }
    if (saved === null) { $('saveState').textContent = 'Nog geen verf. Wat je schildert wordt automatisch opgeslagen.'; return; }
    if (saved.nPoints !== data.nPoints || saved.patch !== data.patch) {
      $('saveState').textContent = 'Opgeslagen verf hoort bij een ander mesh en is niet geladen.';
      return;
    }
    for (const ch of ['allowed', 'priority']) if (saved.channels[ch]) paint[ch].set(saved.channels[ch]);
    $('saveState').textContent = 'Opgeslagen verf geladen.';
  } catch (err) {
    api = false;
    $('saveState').textContent = `Verf laden mislukt: ${err.message}`;
  }
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  activePointers.add(e.pointerId);
  if (tool === 'view' || !data) return;
  if (activePointers.size > 1) { cancelStroke(); return; }  // second finger: rotate, not paint
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pick(e);
  startStroke();
});
canvas.addEventListener('pointermove', (e) => { if (tool !== 'view' && data && activePointers.size <= 1) pick(e); });
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, (e) => { activePointers.delete(e.pointerId); endStroke(); });
}
canvas.addEventListener('pointerleave', () => { if (!stroke) { hit = null; cursor.visible = false; } });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') shiftDown = true;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => setTool(b.dataset.tool));
for (const id of ['size', 'opacity', 'flow', 'hardness']) $(id).addEventListener('input', updateBrushLabels);
$('undo').addEventListener('click', undo);
$('fill').addEventListener('click', () => fillAll(1));
$('clear').addEventListener('click', () => fillAll(0));

// ---------------------------------------------------------------- controls
function setCycle(value) {
  t = value;
  $('slider').value = value;
  const N = data.cycles.length;
  $('cycleLabel').textContent = `cyclus ${nl(t, Number.isInteger(t) ? 0 : 1)} / ${N}`;
  updateSurface();
  updateCharts();
}

$('slider').addEventListener('input', (e) => { playing = false; $('play').textContent = '▶'; setCycle(+e.target.value); });
$('colorMode').addEventListener('change', updateColors);
$('ghost').addEventListener('change', (e) => { ghost.visible = e.target.checked; });
$('wire').addEventListener('change', (e) => { wire.visible = e.target.checked; });
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').textContent = playing ? '❚❚' : '▶';
  if (playing && t >= data.cycles.length) setCycle(1);
});
$('case').addEventListener('change', (e) => {
  const u = new URL(location.href); u.searchParams.set('case', e.target.value); history.replaceState(null, '', u);
  loadCase(e.target.value);
});

let lastFrame = performance.now();
function frame(now) {
  const dt = (now - lastFrame) / 1000; lastFrame = now;
  if (playing && data) {
    const N = data.cycles.length;
    let nt = t + dt * 1.0;  // one cycle per second
    if (nt >= N) { nt = N; playing = false; $('play').textContent = '▶'; }
    setCycle(nt);
  }
  if (stroke && hit) sprayStep(Math.min(dt, 0.05));
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function loadCase(id) {
  data = await (await fetch(`data/${id}.json`, { cache: 'no-cache' })).json();
  $('title').textContent = data.title;
  $('slider').max = data.cycles.length;
  buildScene();
  buildSupport();
  await loadPaint(id);
  buildCharts();
  buildTable();
  updateBrushLabels();
  setTool(tool);
  setCycle(1);
}

async function init() {
  resize();
  const cases = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
  const sel = $('case');
  for (const c of cases) sel.add(new Option(c.title, c.id));
  const wanted = new URL(location.href).searchParams.get('case');
  const id = cases.some((c) => c.id === wanted) ? wanted : cases[0].id;
  sel.value = id;
  await loadCase(id);
  requestAnimationFrame(frame);
}

// for checks from the browser console / tests
window.adjointPaint = { effectiveAllowed: () => Array.from(effectiveAllowed()) };

init();
