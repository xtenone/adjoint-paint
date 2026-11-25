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

function positionsAt(time, out) {
  const n = cyclePos.length;
  const tc = Math.min(Math.max(time, 1), n);
  const i = Math.min(Math.floor(tc), n - 1) - 1;
  const j = Math.min(i + 1, n - 1);
  const f = tc - 1 - i;
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

  const mode = $('colorMode').value;
  const col = geom.getAttribute('color');
  if (dispBuf.arr.length !== data.nPoints) dispBuf.arr = new Float32Array(data.nPoints);
  const c = new THREE.Color();
  if (mode === 'none' || !scales[mode]) {
    for (let v = 0; v < data.nPoints; v++) colMid.toArray(col.array, 3 * v);
  } else {
    const d = signedDisplacement(mode, t, dispBuf.arr);
    for (let v = 0; v < data.nPoints; v++) {
      const x = Math.max(-1, Math.min(1, d[v] / scales[mode]));
      if (x >= 0) c.copy(colMid).lerp(colPos, x); else c.copy(colMid).lerp(colNeg, -x);
      c.toArray(col.array, 3 * v);
    }
  }
  col.needsUpdate = true;

  // colour bar + stats
  const cb = $('colorbar');
  cb.classList.toggle('off', mode === 'none');
  const m = scales[mode] || 0;
  $('cbMin').textContent = mode === 'none' ? '' : '−' + nl(m, 3) + ' ' + data.unit;
  $('cbMax').textContent = mode === 'none' ? '' : '+' + nl(m, 3) + ' ' + data.unit;

  const ds = mode === 'start' && scales.start ? dispBuf.arr : signedDisplacement('start', t, new Float32Array(data.nPoints));
  let out = 0, inw = 0;
  for (const v of ds) { out = Math.max(out, v); inw = Math.min(inw, v); }
  $('stats').textContent = `T.o.v. begin: max ${nl(out, 3)} ${data.unit} naar buiten, ${nl(-inw, 3)} ${data.unit} naar binnen`;
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
$('colorMode').addEventListener('change', () => setCycle(t));
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
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function loadCase(id) {
  data = await (await fetch(`data/${id}.json`, { cache: 'no-cache' })).json();
  $('title').textContent = data.title;
  $('slider').max = data.cycles.length;
  buildScene();
  buildCharts();
  buildTable();
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

init();
