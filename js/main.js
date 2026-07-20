// GARGANTUA — Schwarzschild Black Hole Raytracer
// Real-time relativistic raytracing: renderer, cinematic camera, HUD,
// parameter console, quality profiles, audio, URL automation.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RAY_VERT, RAY_FRAG, COMPOSITE_VERT, COMPOSITE_FRAG } from './shaders.js';

/* ================================================================ constants */
const STORE_KEY = 'gargantua.params.v1';
const LOOP_SECONDS = 176;            // main score length; 2 x 88 s camera loops

const QUALITY = {
  standard:  { label: 'STANDARD',  steps: 200, dpr: 1.0 },
  high:      { label: 'HIGH',      steps: 320, dpr: 1.5 },
  cinematic: { label: 'CINEMATIC', steps: 460, dpr: 2.0 },
};
const QUALITY_ORDER = ['standard', 'high', 'cinematic'];
// drawing-buffer pixel budgets per profile (DPR never persisted)
const PIXEL_BUDGET = { standard: 1.4e6, high: 2.4e6, cinematic: 3.8e6 };

const PRESETS = {
  poster: { r: 24, inc: 38, az: 30  },
  edge:   { r: 26, inc: 6,  az: 10  },
  polar:  { r: 28, inc: 82, az: 0   },
  close:  { r: 9,  inc: 14, az: 55  },
};

// closed cinematic path: (radius, inclination deg, azimuth deg), 11 s each
const CINE_KEYS = [
  [58, 12, -30], [36, 6, 10], [26, 24, 55], [14, 14, 100],
  [20, 52, 150], [34, 80, 200], [46, 35, 270], [36, 8, 330],
];

const PARAM_DEFS = [
  { key: 'uSteps',        label: 'GEODESIC STEPS',      min: 60,  max: 600,  step: 10,    def: 460,  fmt: v => v.toFixed(0) },
  { key: 'uDin',          label: 'DISK INNER EDGE',     min: 2,   max: 4,    step: 0.05,  def: 2.75, fmt: v => v.toFixed(2) + ' RS' },
  { key: 'uDout',         label: 'DISK OUTER EDGE',     min: 10,  max: 80,   step: 1,     def: 40,   fmt: v => v.toFixed(0) + ' RS' },
  { key: 'uDopMax',       label: 'DOPPLER CAP',         min: 1,   max: 3,    step: 0.05,  def: 1.85, fmt: v => v.toFixed(2) },
  { key: 'uOpNear',       label: 'OPACITY NEAR',        min: 0.5, max: 1,    step: 0.01,  def: 0.90, fmt: v => v.toFixed(2) },
  { key: 'uOpFar',        label: 'OPACITY FAR',         min: 0.3, max: 1,    step: 0.01,  def: 0.80, fmt: v => v.toFixed(2) },
  { key: 'uDiskBright',   label: 'DISK BRIGHTNESS',     min: 0.2, max: 3,    step: 0.05,  def: 1,    fmt: v => v.toFixed(2) },
  { key: 'uStarBright',   label: 'STAR BRIGHTNESS',     min: 0.2, max: 3,    step: 0.05,  def: 1,    fmt: v => v.toFixed(2) },
  { key: 'uSkyFloor',     label: 'SKY FLOOR',           min: 0,   max: 0.15, step: 0.005, def: 0.04, fmt: v => v.toFixed(3) },
  { key: 'uRotSpeed',     label: 'DISK ROTATION',       min: 0,   max: 3,    step: 0.05,  def: 1,    fmt: v => v.toFixed(2) },
  { key: 'bloomStrength', label: 'BLOOM STRENGTH',      min: 0,   max: 1.5,  step: 0.05,  def: 0.55, fmt: v => v.toFixed(2) },
  { key: 'bloomRadius',   label: 'BLOOM RADIUS',        min: 0,   max: 1,    step: 0.05,  def: 0.35, fmt: v => v.toFixed(2) },
  { key: 'bloomThreshold',label: 'BLOOM THRESHOLD',     min: 0,   max: 1,    step: 0.05,  def: 0.55, fmt: v => v.toFixed(2) },
  { key: 'vignette',      label: 'VIGNETTE',            min: 0,   max: 1.5,  step: 0.05,  def: 1,    fmt: v => v.toFixed(2) },
  { key: 'grain',         label: 'FILM GRAIN',          min: 0,   max: 0.15, step: 0.005, def: 0.045,fmt: v => v.toFixed(3) },
  { key: 'ca',            label: 'CHROMATIC ABERRATION',min: 0,   max: 0.01, step: 0.0005,def: 0.0028,fmt: v => (v*1000).toFixed(1) + 'e-3' },
  { key: 'fov',           label: 'FIELD OF VIEW',       min: 25,  max: 80,   step: 1,     def: 44,   fmt: v => v.toFixed(0) + '°' },
  { key: 'maxDistance',   label: 'MAX DISTANCE',        min: 40,  max: 300,  step: 5,     def: 150,  fmt: v => v.toFixed(0) + ' RS' },
  { key: 'orbitSpeed',    label: 'ORBIT SPEED',         min: 0,   max: 1,    step: 0.02,  def: 0.12, fmt: v => v.toFixed(2) },
  { key: 'cineSegment',   label: 'CINE SEGMENT',        min: 4,   max: 30,   step: 1,     def: 11,   fmt: v => v.toFixed(0) + ' s' },
  { key: 'debug',         label: 'DEBUG MODE',          min: 0,   max: 9,    step: 1,     def: 0,    fmt: v => v.toFixed(0) },
];

/* ==================================================================== state */
const qs = new URLSearchParams(location.search);
const reducedMotion = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = {
  params: {},
  quality: 'cinematic',
  urlSteps: null, urlDebug: null,
  shot: qs.has('shot'),
  cineMode: false,
  cineTime: 0,
  cineBlend: 1,               // 1 = fully on path
  cineFrom: new THREE.Vector3(),
  flight: null,               // preset flight {t,dur,from,to}
  autoRotateUser: !reducedMotion,
  soundOn: false,
  hudVisible: true,
  firstFrame: false,
  frames: 0,
  shotDone: false,
  captureCanvas: qs.get('capture') === 'canvas', // opt-in canvas readback for shot mode
  renderFault: false,
  fatalShown: false,
  hintShownOnce: false,
  fpsSmooth: 0,
  fpsAccum: 0, fpsTime: 0,
  hudTime: 0,
  audioFailT: 0,
  storageOk: true,
  overrides: new Set(),
};

// quality from URL: none -> CINEMATIC, invalid -> HIGH
(function initQuality(){
  const q = (qs.get('q') || '').toLowerCase();
  if(!q) S.quality = 'cinematic';
  else if(QUALITY[q]) S.quality = q;
  else S.quality = 'high';
})();

// defaults -> params
for(const d of PARAM_DEFS) S.params[d.key] = d.def;
S.params.uSteps = QUALITY[S.quality].steps;

// storage merge (finite + clamped only)
try {
  const raw = localStorage.getItem(STORE_KEY);
  if(raw){
    const saved = JSON.parse(raw);
    for(const d of PARAM_DEFS){
      const v = saved ? saved[d.key] : undefined;
      if(typeof v === 'number' && Number.isFinite(v)){
        S.params[d.key] = Math.min(d.max, Math.max(d.min, v));
      }
    }
  }
} catch(e){ S.storageOk = false; }

// URL overrides for this run only
(function urlOverrides(){
  if(qs.has('steps')){
    const v = parseInt(qs.get('steps'), 10);
    if(Number.isFinite(v)){ S.urlSteps = Math.min(600, Math.max(60, v)); S.params.uSteps = S.urlSteps; S.overrides.add('uSteps'); }
  }
  if(qs.has('debug')){
    const v = parseInt(qs.get('debug'), 10);
    if(Number.isFinite(v)){ S.urlDebug = Math.min(9, Math.max(0, v)); S.params.debug = S.urlDebug; S.overrides.add('debug'); }
  }
})();

function saveParams(){
  if(!S.storageOk) return;
  try {
    const out = {};
    for(const d of PARAM_DEFS){
      if(S.overrides.has(d.key)) continue;
      out[d.key] = S.params[d.key];
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch(e){ S.storageOk = false; notify('STORAGE UNAVAILABLE — SETTINGS NOT SAVED'); }
}

/* ============================================================ renderer core */
const canvas = document.getElementById('view');
let renderer, composer, bloomPass, compositePass, controls;
let halfFloatOK = true;

try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch(e){
  fatal('RENDERER OFFLINE', 'WebGL could not be initialised on this terminal.', e);
  throw e;
}
// final shader applies ACES manually — keep the pipe linear, no tone mapping
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = (gl.getProgramInfoLog(program) || '') + '\n' +
              (gl.getShaderInfoLog(vs) || '') + '\n' + (gl.getShaderInfoLog(fs) || '');
  fatal('SHADER FAULT', 'Raytracing kernel failed to compile/link.', new Error(log.slice(0, 900)));
};

// Capture-phase manual takeover is registered BEFORE OrbitControls is
// constructed, so at the target phase this listener runs first: a mid-flight
// or mid-cinema gesture cancels the automation and the same gesture then
// drives OrbitControls from the interpolated position.
canvas.addEventListener('pointerdown', manualTakeover, { capture: true });
canvas.addEventListener('wheel', manualTakeover, { capture: true, passive: true });

(function detectHalfFloat(){
  try {
    const gl = renderer.getContext();
    halfFloatOK = !!(gl.getExtension('EXT_color_buffer_float') ||
                     gl.getExtension('EXT_color_buffer_half_float'));
  } catch(e){ halfFloatOK = false; }
})();

// fullscreen pass scene: ONE 2x2 plane, orthographic camera, nothing else
const fsScene = new THREE.Scene();
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uRes:        { value: new THREE.Vector2(1, 1) },
  uTime:       { value: 0 },
  uCamPos:     { value: new THREE.Vector3(4.49, 2.72, 25.46) },
  uCamTarget:  { value: new THREE.Vector3(0, 0, 0) },
  uFov:        { value: 1/Math.tan(THREE.MathUtils.degToRad(44)/2) },
  uSteps:      { value: S.params.uSteps|0 },
  uRotSign:    { value: 1 },
  uDebug:      { value: S.params.debug|0 },
  uDin:        { value: S.params.uDin },
  uDout:       { value: S.params.uDout },
  uDopMax:     { value: S.params.uDopMax },
  uOpNear:     { value: S.params.uOpNear },
  uOpFar:      { value: S.params.uOpFar },
  uDiskBright: { value: S.params.uDiskBright },
  uStarBright: { value: S.params.uStarBright },
  uSkyFloor:   { value: S.params.uSkyFloor },
  uRotSpeed:   { value: S.params.uRotSpeed },
};

const fsMat = new THREE.ShaderMaterial({
  vertexShader: RAY_VERT,
  fragmentShader: RAY_FRAG,
  uniforms,
  depthTest: false,
  depthWrite: false,
});
fsScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fsMat));

// observer camera: supplies position / FOV only, never renders geometry
const camera = new THREE.PerspectiveCamera(S.params.fov, 1, 0.01, 200);
camera.position.set(4.49, 2.72, 25.46);
camera.lookAt(0, 0, 0);

(function buildComposer(){
  const rtType = halfFloatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: rtType, depthBuffer: false });
  composer = new EffectComposer(renderer, rt);          // rt1/rt2 share the type
  composer.addPass(new RenderPass(fsScene, fsCam));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(2, 2),
    S.params.bloomStrength, S.params.bloomRadius, S.params.bloomThreshold);
  bloomPass.enabled = halfFloatOK && (S.params.debug|0) <= 2;   // debug 3-9: raw passes, no bloom
  if(!halfFloatOK){
    setTimeout(() => notify('HALF-FLOAT RT UNSUPPORTED — BLOOM DISABLED'), 1200);
  }
  composer.addPass(bloomPass);
  compositePass = new ShaderPass(new THREE.ShaderMaterial({
    vertexShader: COMPOSITE_VERT,
    fragmentShader: COMPOSITE_FRAG,
    uniforms: {
      tDiffuse:  { value: null },
      uRes:      { value: new THREE.Vector2(1, 1) },
      uTime:     { value: 0 },
      uVignette: { value: S.params.vignette },
      uGrain:    { value: S.params.grain },
      uCA:       { value: S.params.ca },
    },
  }));
  composer.addPass(compositePass);
})();

/* ============================================================ camera system */
controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.62;
controls.maxDistance = S.params.maxDistance;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.7;
controls.autoRotate = false;
controls.autoRotateSpeed = S.params.orbitSpeed;

const D2R = Math.PI/180;
const K_R = CINE_KEYS.map(k => k[0]);
const K_I = CINE_KEYS.map(k => k[1]*D2R);
const K_A = CINE_KEYS.map(k => k[2]*D2R);   // ascending: unwrap via cycles

function cr(p0, p1, p2, p3, t){
  const t2 = t*t, t3 = t2*t;
  return 0.5*((2*p1) + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3);
}
function wrapIdx(k, n){ return ((k%n)+n)%n; }
function cinePath(time, out){
  const n = CINE_KEYS.length;
  const seg = Math.max(1, S.params.cineSegment);
  const tt = time/seg;
  const i = Math.floor(tt);
  const t = tt - i;
  const v = (arr, k) => arr[wrapIdx(k, n)];
  const az = k => K_A[wrapIdx(k, n)] + 2*Math.PI*Math.floor(k/n);
  const r   = cr(v(K_R,i-1), v(K_R,i), v(K_R,i+1), v(K_R,i+2), t);
  const inc = cr(v(K_I,i-1), v(K_I,i), v(K_I,i+1), v(K_I,i+2), t);
  const a   = cr(az(i-1), az(i), az(i+1), az(i+2), t);
  out.set(r*Math.cos(inc)*Math.sin(a), r*Math.sin(inc), r*Math.cos(inc)*Math.cos(a));
  return out;
}
const easeCubic = k => k < 0.5 ? 4*k*k*k : 1 - Math.pow(-2*k+2, 3)/2;
function presetVec(name){
  const p = PRESETS[name];
  const inc = p.inc*D2R, az = p.az*D2R;
  return new THREE.Vector3(
    p.r*Math.cos(inc)*Math.sin(az), p.r*Math.sin(inc), p.r*Math.cos(inc)*Math.cos(az));
}

const _v1 = new THREE.Vector3();
function setCineMode(on){
  if(on === S.cineMode) return;
  S.cineMode = on;
  if(on){
    S.flight = null;
    S.cineFrom.copy(camera.position);
    S.cineBlend = 0;
    controls.enabled = false;
    controls.autoRotate = false;      // cinema forces auto-orbit off
    syncAudioToCine();
  }else{
    controls.enabled = true;
    controls.autoRotate = S.autoRotateUser;
    controls.update();
  }
  updateDeck();
}
// Shared manual takeover: cancels preset flight and/or cinema, keeps the
// current interpolated position, hands control to OrbitControls.
function manualTakeover(){
  if(typeof controls === 'undefined' || !controls) return;
  const hadFlight = !!S.flight;
  if(hadFlight) S.flight = null;
  const wasCine = S.cineMode;
  if(wasCine) setCineMode(false);
  if(hadFlight || wasCine){
    controls.enabled = true;
    controls.autoRotate = S.autoRotateUser;
    controls.update();
    if(!S.hintShownOnce){
      S.hintShownOnce = true;
      showHint(6000);
    }
    updateDeck();
  }
}
function flyToPreset(name){
  if(S.flight) S.flight = null;
  setCineMode(false);
  S.flight = { t: 0, dur: 2.6, from: camera.position.clone(), to: presetVec(name) };
  controls.enabled = false;            // flight owns the camera until done
  updateDeck();
}
function toggleAuto(){
  if(S.cineMode){
    // AUTO during cinema exits cinema and turns auto-orbit on
    setCineMode(false);
    S.autoRotateUser = true;
  }else{
    S.autoRotateUser = !S.autoRotateUser;
  }
  controls.autoRotate = S.autoRotateUser;
  updateDeck();
}

/* ==================================================================== audio */
const audioIntro = document.createElement('audio');
const audioMain = document.createElement('audio');
(function initAudio(){
  const probe = document.createElement('audio');
  const can = t => { try { return probe.canPlayType(t) !== ''; } catch(e){ return false; } };
  let src = 'audio/gargantua-main.mp3';
  if(can('audio/ogg; codecs="opus"')) src = 'audio/gargantua-main.opus';
  else if(can('audio/mpeg')) src = 'audio/gargantua-main.mp3';
  else if(can('audio/ogg; codecs="vorbis"')) src = 'audio/gargantua-main.ogg';
  audioIntro.src = 'audio/gargantua-intro.mp3';
  audioMain.src = src;
  audioIntro.preload = 'auto';
  audioMain.preload = 'auto';
  audioMain.loop = true;
  audioIntro.volume = 0.85;
  audioMain.volume = 0.85;
  document.body.appendChild(audioIntro);
  document.body.appendChild(audioMain);
  audioIntro.addEventListener('ended', () => {
    if(!S.soundOn) return;
    seekMain(S.cineMode ? S.cineTime : 0);   // chain on the cinema loop phase
    audioMain.volume = 0.85;
    playMain(false);
  });
  const onAudioError = () => { if(S.soundOn) audioBlocked(); };
  audioIntro.addEventListener('error', onAudioError);
  audioMain.addEventListener('error', onAudioError);
  audioMain.addEventListener('loadedmetadata', () => {
    if(S.cineMode) seekMain(S.cineTime);
  });
})();

function mainDur(){
  return (isFinite(audioMain.duration) && audioMain.duration > 0)
    ? audioMain.duration : LOOP_SECONDS;
}
// metadata-safe seek: no-op until the duration is known
function seekMain(t){
  try {
    if(audioMain.readyState >= 1) audioMain.currentTime = t % mainDur();
  } catch(e){ /* metadata not ready yet */ }
}

let fadeTimer = null;
function fadeMainTo(target, seconds){
  clearInterval(fadeTimer);
  const start = audioMain.volume;
  const t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now()-t0)/(seconds*1000));
    audioMain.volume = start + (target-start)*k;
    if(k >= 1) clearInterval(fadeTimer);
  }, 50);
}
function playMain(fadeIn){
  try {
    if(fadeIn){ audioMain.volume = 0.35; }
    const p = audioMain.play();
    if(p && p.catch) p.catch(audioBlocked);
    if(fadeIn) fadeMainTo(0.85, 0.8);
  } catch(e){ audioBlocked(e); }
}
function syncAudioToCine(){
  if(!S.soundOn || !S.cineMode || audioMain.paused) return;
  try {
    const want = S.cineTime % LOOP_SECONDS;
    if(Math.abs(audioMain.currentTime - want) > 0.3) audioMain.currentTime = want;
  } catch(e){ /* seek unsupported yet */ }
}
function audioBlocked(){
  clearInterval(fadeTimer);
  S.soundOn = false;
  try { audioMain.pause(); audioIntro.pause(); } catch(e){}
  const btn = document.getElementById('btnSound');
  if(btn){
    btn.textContent = '⚠ SOUND: BLOCKED';
    btn.classList.remove('active');
    setTimeout(updateDeck, 2500);
  }
}
function toggleSound(){
  S.soundOn = !S.soundOn;
  if(S.soundOn){
    const introVisible = !document.body.classList.contains('ready');
    if(introVisible){
      try {
        audioIntro.currentTime = 0;
        const p = audioIntro.play();
        if(p && p.catch) p.catch(audioBlocked);
      } catch(e){ audioBlocked(e); }
    }else{
      if(S.cineMode) seekMain(S.cineTime);
      playMain(true);
    }
  }else{
    clearInterval(fadeTimer);
    try { audioMain.pause(); audioIntro.pause(); } catch(e){}
  }
  updateDeck();
}

/* ==================================================================== HUD */
const $ = id => document.getElementById(id);
const deckTitle = () => $('deckTitle');

function fmtClock(ms){
  const s = Math.floor(ms/1000);
  const hh = String(Math.floor(s/3600)).padStart(2, '0');
  const mm = String(Math.floor((s%3600)/60)).padStart(2, '0');
  const ss = String(s%60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function updateHUD(){
  $('mClock').textContent = fmtClock(performance.now());
  const r = camera.position.length();
  $('tDist').textContent = r.toFixed(2) + ' RS';
  $('tIncl').textContent = (Math.asin(THREE.MathUtils.clamp(camera.position.y/Math.max(r,1e-6), -1, 1))/D2R).toFixed(1) + '°';
  $('tSteps').textContent = String(uniforms.uSteps.value);
  $('tProfile').textContent = QUALITY[S.quality].label;
  $('tFps').textContent = S.fpsSmooth > 0 ? S.fpsSmooth.toFixed(0) + ' FPS' : '—';
}

function updateDeck(){
  const cine = $('btnCine'), hud = $('btnHud'), snd = $('btnSound'),
        auto = $('btnAuto'), qual = $('btnQuality'), par = $('btnParams');
  deckTitle().textContent = S.cineMode ? 'CINEMATIC SEQUENCE' : 'NAVIGATION';
  cine.classList.toggle('active', S.cineMode);
  cine.setAttribute('aria-pressed', String(S.cineMode));
  hud.classList.toggle('active', S.hudVisible);
  hud.setAttribute('aria-pressed', String(S.hudVisible));
  auto.classList.toggle('active', S.autoRotateUser && !S.cineMode);
  auto.setAttribute('aria-pressed', String(S.autoRotateUser && !S.cineMode));
  par.classList.toggle('active', !$('params').classList.contains('hidden'));
  par.setAttribute('aria-pressed', String(!$('params').classList.contains('hidden')));
  qual.textContent = QUALITY[S.quality].label;
  if(S.soundOn){
    snd.textContent = '🔊 SOUND: ON';
    snd.classList.add('active');
  }else{
    snd.textContent = '🔇 SOUND: OFF';
    snd.classList.remove('active');
  }
  snd.setAttribute('aria-pressed', String(S.soundOn));
}

let hintTimer = null;
function showHint(ms){
  const el = $('hint');
  el.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('show'), ms);
}

let toastTimer = null;
function notify(msg){
  const el = $('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

function fatal(title, msg, err){
  console.error('[GARGANTUA]', title, msg, err || '');
  S.fatalShown = true;
  const el = $('fatal');
  if(!el) return;
  $('fatalTitle').textContent = title;
  $('fatalMsg').textContent = msg + (err && err.message ? ' — ' + String(err.message).slice(0, 300) : '');
  el.hidden = false;
}

/* ============================================================ params console */
const rowRefs = {};
function applyParam(key){
  const v = S.params[key];
  switch(key){
    case 'uSteps':       uniforms.uSteps.value = v|0; break;
    case 'uDin':         uniforms.uDin.value = v; break;
    case 'uDout':        uniforms.uDout.value = v; break;
    case 'uDopMax':      uniforms.uDopMax.value = v; break;
    case 'uOpNear':      uniforms.uOpNear.value = v; break;
    case 'uOpFar':       uniforms.uOpFar.value = v; break;
    case 'uDiskBright':  uniforms.uDiskBright.value = v; break;
    case 'uStarBright':  uniforms.uStarBright.value = v; break;
    case 'uSkyFloor':    uniforms.uSkyFloor.value = v; break;
    case 'uRotSpeed':    uniforms.uRotSpeed.value = v; break;
    case 'bloomStrength':  bloomPass.strength = v; break;
    case 'bloomRadius':    bloomPass.radius = v; break;
    case 'bloomThreshold': bloomPass.threshold = v; break;
    case 'vignette': compositePass.uniforms.uVignette.value = v; break;
    case 'grain':    compositePass.uniforms.uGrain.value = v; break;
    case 'ca':       compositePass.uniforms.uCA.value = v; break;
    case 'fov':
      camera.fov = v;
      camera.updateProjectionMatrix();
      uniforms.uFov.value = 1/Math.tan(v*D2R/2);
      break;
    case 'maxDistance': controls.maxDistance = v; break;
    case 'orbitSpeed':  controls.autoRotateSpeed = v; break;
    case 'cineSegment': break;                    // read live by cinePath
    case 'debug':
      uniforms.uDebug.value = v|0;
      if(bloomPass) bloomPass.enabled = halfFloatOK && (v|0) <= 2;   // debug 3-9 disables bloom
      break;
  }
  const ref = rowRefs[key];
  if(ref){
    const def = PARAM_DEFS.find(d => d.key === key);
    ref.val.textContent = def.fmt(v);
    if(document.activeElement !== ref.input) ref.input.value = String(v);
  }
}
function applyAllParams(){ for(const d of PARAM_DEFS) applyParam(d.key); }

function buildParams(){
  const body = $('paramsBody');
  for(const d of PARAM_DEFS){
    const row = document.createElement('div');
    row.className = 'prow';
    const head = document.createElement('div');
    head.className = 'phead';
    const lab = document.createElement('label');
    lab.className = 'plabel';
    lab.textContent = d.label;
    lab.htmlFor = 'pin_' + d.key;
    const val = document.createElement('span');
    val.className = 'pval';
    val.textContent = d.fmt(S.params[d.key]);
    head.appendChild(lab); head.appendChild(val);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = 'pin_' + d.key;
    input.min = String(d.min); input.max = String(d.max); input.step = String(d.step);
    input.value = String(S.params[d.key]);
    input.setAttribute('aria-label', d.label);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if(!Number.isFinite(v)) return;
      S.params[d.key] = Math.min(d.max, Math.max(d.min, v));
      S.overrides.delete(d.key);       // manual change owns the value again
      applyParam(d.key);
      saveParams();
    });
    row.appendChild(head); row.appendChild(input);
    body.appendChild(row);
    rowRefs[d.key] = { input, val };
  }
}

function resetParams(){
  try { localStorage.removeItem(STORE_KEY); } catch(e){}
  S.overrides.clear();
  for(const d of PARAM_DEFS) S.params[d.key] = d.def;
  S.params.uSteps = QUALITY[S.quality].steps;
  // URL steps/debug overrides still rule this run after a reset
  if(S.urlSteps !== null){ S.params.uSteps = S.urlSteps; S.overrides.add('uSteps'); }
  if(S.urlDebug !== null){ S.params.debug = S.urlDebug; S.overrides.add('debug'); }
  applyAllParams();
  updateHUD();
  notify('PARAMETERS RESET TO DEFAULTS');
}

/* ================================================================== quality */
const _dbSize = new THREE.Vector2();
function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  // capped DPR: min(device DPR, profile cap, pixel-budget limit), floor .65
  const devDpr = window.devicePixelRatio || 1;
  const byPixels = Math.sqrt((PIXEL_BUDGET[S.quality] || 1.4e6)/Math.max(1, w*h));
  const dpr = Math.max(0.65, Math.min(devDpr, QUALITY[S.quality].dpr, byPixels));
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w/Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(_dbSize);
  uniforms.uRes.value.copy(_dbSize);
  compositePass.uniforms.uRes.value.copy(_dbSize);
  layoutParams();
}
function setQuality(q){
  if(!QUALITY[q]) return;
  S.quality = q;
  // quality choice always applies its profile step budget and lifts any URL override on uSteps
  S.overrides.delete('uSteps');
  S.params.uSteps = QUALITY[q].steps;
  applyParam('uSteps');
  resize();
  updateDeck();
}
function cycleQuality(){
  const i = QUALITY_ORDER.indexOf(S.quality);
  setQuality(QUALITY_ORDER[(i+1)%QUALITY_ORDER.length]);
}

function layoutParams(){
  const deck = $('deck'), params = $('params');
  if(!deck || !params) return;
  const top = deck.getBoundingClientRect().top;
  params.style.maxHeight = Math.max(180, top - 88 - 12) + 'px';
}

/* ================================================================ main loop */
let rafId = 0;
let lastNow = performance.now();
let simTime = 0;
let contextLost = false;

function frame(){
  // real wall-clock delta for FPS; clamped simDelta for all animation
  const now = performance.now();
  const realDelta = Math.max(0.0005, (now - lastNow)/1000);
  lastNow = now;
  const dt = Math.min(realDelta, 0.1);
  simTime += dt;
  const t = simTime;

  // camera: preset flight wins, then cinema, then manual controls
  if(S.flight){
    const f = S.flight;
    if(!f.purged){
      // purge residual orbit momentum once, invisibly: with damping off,
      // update() applies any pending delta a final time and zeroes it;
      // the lerp below re-asserts the camera before anything is presented
      f.purged = true;
      const damp = controls.enableDamping;
      controls.enableDamping = false;
      controls.autoRotate = false;
      controls.update();
      controls.enableDamping = damp;
    }
    f.t += dt;
    const k = easeCubic(Math.min(1, f.t/f.dur));
    camera.position.lerpVectors(f.from, f.to, k);
    camera.lookAt(0, 0, 0);
    if(f.t >= f.dur){
      S.flight = null;
      controls.enabled = true;
      camera.position.copy(f.to);
      camera.lookAt(0, 0, 0);
      controls.update();
      updateDeck();
    }
  }else if(S.cineMode){
    S.cineTime += dt;
    cinePath(S.cineTime, _v1);
    if(S.cineBlend < 1){
      S.cineBlend = Math.min(1, S.cineBlend + dt/2);
      _v1.lerpVectors(S.cineFrom, _v1, easeCubic(S.cineBlend));
    }
    camera.position.copy(_v1);
    camera.lookAt(0, 0, 0);
  }else{
    controls.autoRotate = S.autoRotateUser;
    controls.autoRotateSpeed = S.params.orbitSpeed;
    controls.update();
  }

  // shader uniforms (cheap scalar/vector writes only)
  uniforms.uTime.value = t;
  uniforms.uCamPos.value.copy(camera.position);
  uniforms.uCamTarget.value.copy(controls.target);
  compositePass.uniforms.uTime.value = t;

  try {
    composer.render();
  } catch(err){
    if(!S.renderFault){
      S.renderFault = true;
      fatal('RENDER FAULT', 'Frame pipeline failed.', err);
    }
    rafId = 0;                            // stop further renders
    return;
  }

  // first rendered frame dismisses the intro
  if(!S.firstFrame){
    S.firstFrame = true;
    document.body.classList.add('ready');
    setTimeout(() => { if(!S.shotDone) showHint(10000); }, 2500);
  }

  // shot mode: 4 rendered frames -> freeze, signal, one HUD update
  if(S.shot && !S.shotDone){
    S.frames++;
    if(S.frames === 3 && S.captureCanvas){
      // explicit automation helper, only behind ?capture=canvas
      try { window.__SHOT_PNG = renderer.domElement.toDataURL('image/png'); } catch(e){}
    }
    if(S.frames >= 4){
      S.shotDone = true;
      updateHUD();
      document.title = 'SHOT_OK';
      window.__SHOT_DONE = true;
      rafId = 0;                          // no further frames
      return;
    }
  }

  // FPS: real 1 s window, EMA after the first valid sample
  S.fpsAccum++; S.fpsTime += realDelta;
  if(S.fpsTime >= 1){
    const f = S.fpsAccum/S.fpsTime;
    S.fpsSmooth = S.fpsSmooth === 0 ? f : S.fpsSmooth*0.6 + f*0.4;
    S.fpsAccum = 0; S.fpsTime = 0;
  }

  // HUD at 4 Hz
  S.hudTime += dt;
  if(S.hudTime >= 0.25){
    S.hudTime = 0;
    updateHUD();
    syncAudioToCine();
  }

  // schedule the next frame only at the end; stay paused while hidden
  if(!document.hidden) rafId = requestAnimationFrame(frame);
  else rafId = 0;
}

/* ==================================================================== boot */
function toggleHud(){
  S.hudVisible = !S.hudVisible;
  $('hud').classList.toggle('off', !S.hudVisible);
  updateDeck();
}
function toggleParams(){
  $('params').classList.toggle('hidden');
  layoutParams();
  updateDeck();
}

function bindUI(){
  $('btnCine').addEventListener('click', () => setCineMode(!S.cineMode));
  $('btnAuto').addEventListener('click', toggleAuto);
  $('btnQuality').addEventListener('click', cycleQuality);
  $('btnParams').addEventListener('click', toggleParams);
  $('btnHud').addEventListener('click', toggleHud);
  $('btnSound').addEventListener('click', toggleSound);
  $('btnReset').addEventListener('click', resetParams);
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => flyToPreset(btn.getAttribute('data-preset')));
  });

  // canvas pointerdown/wheel capture listeners were registered before
  // OrbitControls construction (see renderer setup); this is the fallback
  controls.addEventListener('start', manualTakeover);

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  window.addEventListener('keydown', e => {
    const tag = e.target && e.target.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    switch(e.key){
      case '1': flyToPreset('poster'); break;
      case '2': flyToPreset('edge'); break;
      case '3': flyToPreset('polar'); break;
      case '4': flyToPreset('close'); break;
      case 'c': case 'C': setCineMode(!S.cineMode); break;
      case 'r': case 'R': toggleAuto(); break;
      case 'p': case 'P': toggleParams(); break;
      case 'm': case 'M': toggleSound(); break;
      case 'h': case 'H': toggleHud(); break;
    }
  });

  // pause the render loop while hidden; resume once, discarding the gap
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      if(rafId){ cancelAnimationFrame(rafId); rafId = 0; }
    }else{
      lastNow = performance.now();
      if(!rafId && !S.shotDone && !contextLost && !S.fatalShown){
        rafId = requestAnimationFrame(frame);
      }
    }
  });

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    contextLost = true;
    if(rafId){ cancelAnimationFrame(rafId); rafId = 0; }
    fatal('SIGNAL LOST', 'WebGL context lost. Reinitialise or step down the render profile.');
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  $('fatalRetry').addEventListener('click', () => location.reload());
  $('fatalLower').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch(e){}
    const order = QUALITY_ORDER;
    const i = Math.max(0, order.indexOf(S.quality)-1);
    location.href = location.pathname + '?q=' + order[i];
  });
}

(function boot(){
  buildParams();
  applyAllParams();
  bindUI();

  // cinema default ON unless nocine / reduced motion / direct preset shot
  const wantCine = !qs.has('nocine') && !reducedMotion && !qs.has('cam');
  S.cineMode = false;
  controls.enabled = true;
  if(wantCine) setCineMode(true);
  else { controls.autoRotate = S.autoRotateUser; }

  // URL start time inside the cinematic loop
  if(qs.has('ctime')){
    const v = parseFloat(qs.get('ctime'));
    if(Number.isFinite(v)) S.cineTime = Math.max(0, v);
  }

  // URL preset camera (exact jump — used by automated captures)
  const cam = (qs.get('cam') || '').toLowerCase();
  if(PRESETS[cam]){
    camera.position.copy(presetVec(cam));
    camera.lookAt(0, 0, 0);
    S.autoRotateUser = false;         // captures stay exactly on the preset
    controls.autoRotate = false;
    controls.update();
  }

  if(S.shot){
    document.body.classList.add('ready');
    const intro = $('intro');
    if(intro) intro.style.display = 'none';
  }
  // 9 s safety escape for the intro no matter what
  setTimeout(() => document.body.classList.add('ready'), 9000);

  resize();
  updateDeck();
  updateHUD();
  frame();
})();

// minimal introspection handle (used by the automated acceptance harness)
window.__G = { S, uniforms, camera, controls, QUALITY,
  get cineMode(){ return S.cineMode; },
  get rafId(){ return rafId; },
  setCineMode, flyToPreset, cycleQuality, toggleParams, toggleHud, toggleSound, resetParams, manualTakeover, toggleAuto };
