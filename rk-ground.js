/* ==========================================================================
   RAPIDKERT — THE LIVING GROUND  (Phase 2)
   --------------------------------------------------------------------------
   ONE renderer. ONE scene. ONE master scroll timeline.

   The homepage is not a stack of sections with animation between them: it is
   a single procedural terrain specimen — a rectangular cross-section of land
   lifted out of the ground — that the visitor descends into, watches irrigate
   itself, sees taken apart as an architectural exploded section, then watches
   rebuild from raw earth into a finished garden, before the rendered surface
   hands over to a real photograph.

   Art direction, in order of priority:
     ARCHITECTURAL MODEL · LANDSCAPE SECTION · ENGINEERING VISUALISATION
   Explicitly NOT: photoreal garden, video game terrain, generic Three.js demo.

   Everything is procedural. The library has no 3D scans, no drone footage and
   no renders, so nothing here pretends to be photographic. The only real
   imagery in the experience is the single photograph the surface resolves
   into at the very end — and that contrast IS the point.

   Structure of this file
     01  environment, tiers, constants
     02  deterministic noise (JS)  + shader chunks (GLSL)
     03  geometry builders   — stratified slabs, tubes, blades
     04  materials           — soil, gravel, root, pipe, water, hardscape
     05  the specimen        — assembling the object
     06  lighting
     07  the timeline        — camera track + scalar tracks
     08  annotations         — 3D-anchored DOM labels with leader lines
     09  the photo handover
     10  loop, resize, lifecycle
   ========================================================================== */

import * as THREE from './vendor/three.module.min.js';

const root = document.documentElement;
const stage = document.getElementById('gdStage');
const canvas = document.getElementById('gdCanvas');
const section = document.getElementById('ground');

/* Nothing to do on pages that do not mount the experience. */
if (stage && canvas && section) boot();

function boot() {

/* ==========================================================================
   01 — ENVIRONMENT
   ========================================================================== */

/* Not a load-time constant. The preference can be switched from the OS
   accessibility panel with this page open, and rk.css §20 already answers
   that live through its own media query — only the timeline was still
   reading it once and animating underneath a visitor who had just asked it
   to stop. §10 keeps this binding current.                      [PHASE 3.2B] */
const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = RMQ.matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const params = new URLSearchParams(location.search);

/* Deterministic debug states. Harmless in production: without ?scene= the
   whole branch is dead. Used for visual checkpoints during development —
   ?scene=hero|descent|ground|water|exploded|life|photo, or ?scene=0.42 */
const SCENES = {
  hero: 0.00, descent: 0.170, ground: 0.320, water: 0.556, exploded: 0.720,
  terep: 0.798, viz: 0.826, struktura: 0.852, noveny: 0.878, kesz: 0.906,
  photo: 0.972, release: 1
};
const frozen = (() => {
  const v = params.get('scene');
  if (v === null) return null;
  if (v in SCENES) return SCENES[v];
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : null;
})();

/* -- quality tiers ---------------------------------------------------------
   The concept must survive every tier: what changes is instance counts,
   shadow resolution, shader octaves and DPR — never the narrative.        */
function pickTier() {
  const force = params.get('tier');
  if (force === 'low' || force === 'med' || force === 'high') return force;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const w = innerWidth;
  if (coarse || w < 760 || cores <= 4 || mem <= 2) return 'low';
  if (w < 1280 || cores < 8 || mem <= 4) return 'med';
  return 'high';
}

let tier = pickTier();

/* `grass` is now the SILHOUETTE blade count only — the density of the sward
   itself comes from `shells`, which costs a fraction as much per unit of
   apparent blade count. See makeShells(). */
const TIERS = {
  high: { dpr: 2.0, grass: 2800, gravel: 150, shadow: 1024, oct: 4, rootSys: 24, tubSeg: 26, radSeg: 6, aa: true,  shells: 10, capX: 44, capZ: 32, lattice: 2 },
  med:  { dpr: 1.6, grass: 1500, gravel: 92,  shadow: 512,  oct: 3, rootSys: 17, tubSeg: 20, radSeg: 5, aa: true,  shells: 7,  capX: 34, capZ: 24, lattice: 2 },
  low:  { dpr: 1.4, grass: 620,  gravel: 48,  shadow: 0,    oct: 2, rootSys: 11, tubSeg: 14, radSeg: 4, aa: false, shells: 4,  capX: 24, capZ: 16, lattice: 1 }
};
let Q = TIERS[tier];

/* -- the specimen's dimensions, in metres-ish -------------------------------
   Wide, shallow, and deep enough to read as a lifted block of land rather
   than a column. All layer boundaries are quoted from the surface (y = 0). */
const W = 9.0;          // width  (x)
const D = 6.4;          // depth  (z)

/* Colours are authored in sRGB and converted to linear by three's colour
   management, so a value that "looks like dark soil" as a hex swatch is
   roughly a quarter as bright once it reaches the shader. Real soil sits
   around 0.10-0.20 linear albedo; these are picked to land there, which is
   why they read lighter than expected as flat swatches. */
/* ex/dx/dz are the exploded-view offsets. The vertical steps are deliberately
   UNEQUAL and each stratum drifts a few centimetres sideways: a set of slabs
   separated by an identical gap on a perfect axis reads as a stack of cards,
   whereas a physical assembly drawing always has the parts eased apart by
   hand. The drift is under 3% of the block's width, so the object still
   plainly aligns on one vertical axis — which is the other half of the rule. */
const LAYERS = [
  /* id            top     bottom   colour      rough  explode          kind  */
  { id: 'surface', top:  0.00, bot: -0.36, color: 0x5E6B48, rough: 0.99, ex:  2.95, dx:  0.00, dz:  0.00, kind: 'turf'   },
  { id: 'topsoil', top: -0.36, bot: -1.68, color: 0x574229, rough: 1.00, ex:  1.62, dx:  0.22, dz: -0.14, kind: 'soil'   },
  { id: 'root',    top: -1.68, bot: -3.10, color: 0x7C6444, rough: 0.98, ex:  0.48, dx: -0.18, dz:  0.10, kind: 'root'   },
  { id: 'drain',   top: -3.10, bot: -4.50, color: 0x7B7362, rough: 0.84, ex: -1.06, dx:  0.12, dz:  0.20, kind: 'gravel' },
  { id: 'base',    top: -4.50, bot: -6.35, color: 0x655D4C, rough: 0.92, ex: -2.42, dx: -0.08, dz: -0.08, kind: 'base'   }
];

const PIPE_Y = -2.42;       // irrigation main + laterals, inside the root zone
/* The network's own explode offset. Set so the pipes land in the OPEN GAP
   between the topsoil and the root zone rather than resting on the root
   slab's top face — at the old value the two coincided and the irrigation
   read as something lying on the layer instead of a part in its own right. */
const PIPE_EX = 1.86;
const DRAIN_Y = -3.95;      // perforated drainage pipe, inside the aggregate
/* The four laterals' nominal x positions. Quoted by the irrigation geometry
   AND baked into the root-zone shader, which measures the wetted band from
   them — the two must not drift apart. */
const LATERAL_X = [-3.35, -1.05, 1.15, 3.40];

/* -- the paved footprint ---------------------------------------------------
   Authored ONCE, here, because three separate systems have to agree on it to
   the centimetre: the paving geometry, the sward (no grass grows under a
   slab), and the turf shader (the ground darkens as it approaches one). When
   those three disagreed the stones read as cutouts laid on top of a lawn
   rather than set into it — which is exactly what §13 of the brief is about.

   Each entry is a footprint: centre x/z and half-extents. The stones walk
   away from the viewer on a slight curve; the terrace sits back-right.     */
const PAVERS = [];
for (let i = 0; i < 6; i++) {
  /* Deliberately not a clone run: each slab is its own size and sits at its
     own angle. The variation is small — this is a cut-stone path, not a
     rockery — but it is what stops the eye finding the repeat. */
  const wob = [0.02, -0.031, 0.014, 0.036, -0.019, 0.027][i];
  PAVERS.push({
    x: Math.sin(i * 0.8) * 0.24,
    z: -D / 2 + 0.62 + i * 1.02,
    hx: 0.425 + [0.018, -0.014, 0.026, -0.008, 0.020, -0.022][i],
    hz: 0.355 + [-0.012, 0.022, -0.006, 0.018, -0.020, 0.010][i],
    ry: wob,
    /* small differential settlement — a path that has been walked on */
    dy: [0.004, -0.006, 0.002, -0.009, 0.005, -0.003][i]
  });
}
const TERRACE = { x: 2.72, z: -1.85, hx: 1.50, hz: 1.05 };

/* The same footprints as a flat vec4 array the shaders can walk. */
const PAVE_U = [...PAVERS.map(p => new THREE.Vector4(p.x, p.z, p.hx, p.hz)),
                new THREE.Vector4(TERRACE.x, TERRACE.z, TERRACE.hx, TERRACE.hz)];
const PAVE_N = PAVE_U.length;

/* ==========================================================================
   02 — NOISE
   ========================================================================== */

/* JS-side value noise, seeded — geometry must be identical on every load so
   the composition never shifts between visits or between two devices side by
   side in a meeting. */
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(20260807);

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, oct = 3) {
  let s = 0, amp = 0.5, fx = x, fy = y;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(fx, fy); fx *= 2.03; fy *= 1.97; amp *= 0.5; }
  return s;
}

/* GLSL: shared by every soil material. Kept deliberately cheap — value noise,
   not simplex. The look comes from layering and colour discipline, not from
   an expensive noise function. */
const GLSL_NOISE = `
float rkHash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rkNoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rkHash(i + vec3(0,0,0)), rkHash(i + vec3(1,0,0)), f.x),
                 mix(rkHash(i + vec3(0,1,0)), rkHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rkHash(i + vec3(0,0,1)), rkHash(i + vec3(1,0,1)), f.x),
                 mix(rkHash(i + vec3(0,1,1)), rkHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float rkFbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < RK_OCT; i++){ s += a * rkNoise(p); p = p * 2.03 + 19.19; a *= 0.5; }
  return s;
}
vec2 rkHash2(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
/* Cellular distance — reads as compacted aggregate on the cut faces. */
float rkCell(vec2 p){
  vec2 n = floor(p), f = fract(p);
  float d = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = rkHash2(n + g);
    d = min(d, length(g + o - f));
  }
  return d;
}
`;

/* Declared by every material that needs the paved footprint, and by no other
   — the array is a uniform, so a material that includes the helper without
   the declaration will not link. */
const GLSL_PAVE = `
#define RK_PAVE ${PAVE_N}
uniform vec4 uPave[RK_PAVE];
/* Signed distance to the nearest paved footprint, negative inside it. This is
   how the hardscape is attached to the ground: the sward stops at it and the
   soil darkens toward it, without a shadow map or an SSAO pass. */
float rkPaveSD(vec2 p){
  float d = 1e3;
  for (int i = 0; i < RK_PAVE; i++){
    vec2 q = abs(p - uPave[i].xy) - uPave[i].zw;
    d = min(d, min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))));
  }
  return d;
}`;

/* Cheap 2D noise for the sward. Separate from GLSL_NOISE on purpose: the
   grass shader runs at up to ten shells of overdraw, so every instruction in
   it is paid for ten times and it cannot afford the 3D variant. */
const GLSL_GRASS = `
float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 gHash2(vec2 p){
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float gNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gFbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++){ s += a * gNoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
  return s;
}
/* ONE lattice of tapered strands, sampled at height \`shell\`. Every cell owns
   a single blade with its own height, tone and jitter; the blade's radius
   shrinks with height, so the stack of shells cuts a real taper rather than
   a stack of discs. Two lattices at unrelated scales are unioned by the
   caller, which is what stops the sward resolving into the grid it is
   actually built on. */
float rkStrand(vec2 p, float dens, float seed, float shell, vec2 lean, float lawn, out float tone){
  vec2 q = p * dens + seed;
  vec2 c = floor(q), f = fract(q);
  vec2 o = 0.18 + 0.64 * gHash2(c + seed);
  float hgt = (0.46 + 0.54 * gHash(c * 1.7 + seed)) * lawn;
  tone = gHash(c * 3.1 + seed);
  if (shell > hgt) return 0.0;
  float u = shell / max(hgt, 0.001);
  return step(length(f - o - lean * u * u), 0.30 * (1.0 - 0.82 * u));
}`;

/* ==========================================================================
   03 — GEOMETRY BUILDERS
   ========================================================================== */

/* THE EXCAVATION.
   A solid block hides everything that makes this site's argument: the roots,
   the dripline, the drainage. Ghosting the soil to translucent would solve it
   and would look like a glass effect, which is the one thing an architectural
   specimen must never look like. So the specimen is physically excavated
   instead — the front-right corner of the upper strata is cut away down to
   the drainage course, exactly like a trench opened across a lawn.

   Everything follows from that: the internals are genuinely visible from the
   first viewport, the extra inner faces double the amount of readable
   section, and the drainage layer's top surface becomes the trench floor. */
const NOTCH = { x0: 1.35, z0: 0.35 };   // extends to the +x / +z block edges

/* A stratum is NOT a box. It is a closed solid whose top and bottom surfaces
   are independently displaced, so every cut face shows a real, irregular
   sediment boundary instead of a machined straight line. Top, bottom and each
   wall own their vertices, which keeps the silhouette crisp while the
   surfaces themselves stay smooth.

   aFace: 0 = top surface, 1 = cut face, 2 = underside.                     */
/* mode: 'full'     — the whole footprint
         'notched'  — the whole footprint minus the excavated corner
         'plug'     — ONLY the excavated corner, i.e. the backfill that drops
                      into the trench when the garden is completed          */
function makeStratum(topFn, botFn, segX, segZ, mode) {
  const pos = [], nor = [], uv = [], face = [], idx = [];
  const hw = W / 2, hd = D / 2;
  const notched = mode === 'notched';
  const plug = mode === 'plug';

  /* The backfill is inset by a hair on its two buried faces. Without it the
     plug's walls are exactly coplanar with the trench walls, both are
     front-facing, and the pair z-fights into a shimmering seam. */
  const EPS = plug ? 0.006 : 0;
  const px = (i) => -hw + (i / segX) * W;
  const pz = (j) => -hd + (j / segZ) * D;

  /* The excavation is snapped to the grid so the removed cells and the inner
     walls share vertices exactly — an unsnapped rectangle leaves hairline
     gaps along the trench edge that catch the light like cracks. */
  const i0 = (notched || plug) ? Math.ceil(((NOTCH.x0 + hw) / W) * segX) : segX + 1;
  const j0 = (notched || plug) ? Math.ceil(((NOTCH.z0 + hd) / D) * segZ) : segZ + 1;
  const cut = (i, j) => notched && i >= i0 && j >= j0;   // quad (i,j) removed
  const iA = plug ? i0 : 0, jA = plug ? j0 : 0;          // grid start

  function grid(fn, faceId, flip) {
    const base = pos.length / 3;
    const cols = segX - iA + 1;
    for (let j = jA; j <= segZ; j++) {
      for (let i = iA; i <= segX; i++) {
        const x = px(i) + (plug && i === iA ? EPS : 0);
        const z = pz(j) + (plug && j === jA ? EPS : 0);
        pos.push(x, fn(x, z), z);
        nor.push(0, flip ? -1 : 1, 0);
        uv.push(i / segX, j / segZ);
        face.push(faceId);
      }
    }
    for (let j = jA; j < segZ; j++) {
      for (let i = iA; i < segX; i++) {
        if (cut(i, j)) continue;
        const a = base + (j - jA) * cols + (i - iA), b = a + 1;
        const c = a + cols, d = c + 1;
        if (flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }

  grid(topFn, 0, false);
  grid(botFn, 2, true);

  /* A wall strip: `get(k)` walks the edge, `skip(k)` drops the segments that
     fall inside the excavation. `rev` selects the winding that puts the face
     normal on `nrm`. */
  let run = 0;
  function wall(n, get, nrm, rev, skip) {
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const [x, z] = get(k);
      const u = (run + k) / (segX + segZ);
      pos.push(x, topFn(x, z), z); nor.push(nrm[0], nrm[1], nrm[2]); uv.push(u, 0); face.push(1);
      pos.push(x, botFn(x, z), z); nor.push(nrm[0], nrm[1], nrm[2]); uv.push(u, 1); face.push(1);
    }
    for (let k = 0; k < n; k++) {
      if (skip && skip(k)) continue;
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      if (rev) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
    run += n;
  }

  if (plug) {
    /* The backfill block: its two buried faces point back out at the trench
       walls, its two outer faces continue the block's own elevations. */
    wall(segZ - j0, (k) => [px(i0) + EPS, pz(j0 + k)], [-1, 0, 0], false, null);
    wall(segX - i0, (k) => [px(i0 + k), pz(j0) + EPS], [0, 0, -1], true, null);
    wall(segZ - j0, (k) => [px(segX), pz(j0 + k)], [1, 0, 0], true, null);
    wall(segX - i0, (k) => [px(segX - k), pz(segZ)], [0, 0, 1], true,
         (k) => (segX - 1 - k) < i0);
  } else {
    /* Outer perimeter. Walked in order so the wall UV's u coordinate is a
       continuous perimeter distance — the sediment banding in the shader then
       wraps around the corners instead of restarting on every face. */
    wall(segX, (k) => [px(k), pz(0)], [0, 0, -1], true, null);
    wall(segZ, (k) => [px(segX), pz(k)], [1, 0, 0], true,
         notched ? (k) => k >= j0 : null);
    wall(segX, (k) => [px(segX - k), pz(segZ)], [0, 0, 1], true,
         notched ? (k) => (segX - 1 - k) >= i0 : null);
    wall(segZ, (k) => [px(0), pz(segZ - k)], [-1, 0, 0], true, null);

    /* Inner faces of the excavation. These are the two most valuable surfaces
       on the whole model: they are what the visitor actually reads the soil
       profile from. Normals point INTO the trench. */
    if (notched) {
      wall(segZ - j0, (k) => [px(i0), pz(j0 + k)], [1, 0, 0], true, null);
      wall(segX - i0, (k) => [px(i0 + k), pz(j0)], [0, 0, 1], false, null);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
  g.setIndex(idx);
  return g;
}

/* THE SWARD.
   Instanced blades alone cannot make a lawn. Real turf runs to five figures
   of shoots per square metre; at the few thousand a geometry budget allows,
   blades stop being a surface and become stipple — which is precisely how
   the lawn was reading at close range.

   So the sward is built the way fur is: a stack of shells lifted off the
   surface along its normal, each one discarding every fragment that is not
   inside a blade's cross-section at that height. Ten shells over a 44x32
   grid cost ~34k triangles and yield a density no instanced field could
   reach, and because the whole stack is ONE merged geometry the entire lawn
   is one draw call.

   Shells alone fail at a grazing angle, where the stack shows as terracing.
   That case is covered by keeping a few thousand real blades for the
   silhouette — see sow() — and by culling back faces, so from below grade
   the lawn simply is not there.

   `mode` matches makeStratum: 'notched' is the intact ground, 'plug' is the
   sward that rides on the backfill. */
function makeShells(topFn, segX, segZ, mode, shells) {
  const pos = [], nor = [], uv = [], sh = [], idx = [];
  const hw = W / 2, hd = D / 2;
  const notched = mode === 'notched', plug = mode === 'plug';
  const px = (i) => -hw + (i / segX) * W;
  const pz = (j) => -hd + (j / segZ) * D;
  const i0 = (notched || plug) ? Math.ceil(((NOTCH.x0 + hw) / W) * segX) : segX + 1;
  const j0 = (notched || plug) ? Math.ceil(((NOTCH.z0 + hd) / D) * segZ) : segZ + 1;
  const cut = (i, j) => notched && i >= i0 && j >= j0;
  const iA = plug ? i0 : 0, jA = plug ? j0 : 0;
  const cols = segX - iA + 1;
  const EPS = 0.05;

  for (let s = 0; s < shells; s++) {
    const base = pos.length / 3;
    /* 1..shells rather than 0..shells-1: shell zero would sit exactly on the
       cap and z-fight with the soil it is standing on. */
    const t = (s + 1) / shells;
    for (let j = jA; j <= segZ; j++) {
      for (let i = iA; i <= segX; i++) {
        const x = px(i), z = pz(j);
        /* A real normal from the height field, not (0,1,0). The surface
           undulates by ~9cm across nine metres and without this the whole
           lawn shades as one flat card. */
        const dx = (topFn(x + EPS, z) - topFn(x - EPS, z)) / (2 * EPS);
        const dz = (topFn(x, z + EPS) - topFn(x, z - EPS)) / (2 * EPS);
        const l = Math.hypot(dx, 1, dz);
        pos.push(x, topFn(x, z), z);
        nor.push(-dx / l, 1 / l, -dz / l);
        uv.push(i / segX, j / segZ);
        sh.push(t);
      }
    }
    for (let j = jA; j < segZ; j++) {
      for (let i = iA; i < segX; i++) {
        if (cut(i, j)) continue;
        const a = base + (j - jA) * cols + (i - iA), b = a + 1;
        const c = a + cols, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aShell', new THREE.Float32BufferAttribute(sh, 1));
  g.setIndex(idx);
  /* The shells are lifted off the cap at draw time, so the authored bounds
     are 5cm short and the lawn pops out at the frame edge without this. */
  g.computeBoundingSphere();
  g.boundingSphere.radius += 0.2;
  return g;
}

/* Merge indexed geometries that share an attribute set. Written here rather
   than pulling in BufferGeometryUtils: it is thirty lines, and it keeps the
   vendored surface to exactly one file. */
function mergeGeoms(list) {
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  let vTotal = 0, iTotal = 0;
  for (const g of list) { vTotal += g.attributes.position.count; iTotal += g.index.count; }

  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(vTotal * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const ind = new Uint32Array(iTotal);
  let io = 0, vo = 0;
  for (const g of list) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i++) ind[io + i] = a[i] + vo;
    io += a.length; vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  return out;
}

/* A tapering tube along a curve, carrying aT = normalised distance along the
   whole network so a single uniform can drive growth and water travel. */
function tube(curve, radius, taper, tSeg, rSeg, tStart, tEnd) {
  const g = new THREE.TubeGeometry(curve, tSeg, radius, rSeg, false);
  const pos = g.attributes.position;
  const ring = rSeg + 1;
  const aT = new Float32Array(pos.count);

  for (let v = 0; v < pos.count; v++) {
    const r = Math.floor(v / ring);
    const t = r / tSeg;
    aT[v] = tStart + (tEnd - tStart) * t;
    if (taper !== 1) {
      const c = curve.getPointAt(Math.min(t, 1));
      const k = 1 - (1 - taper) * t;
      pos.setXYZ(v,
        c.x + (pos.getX(v) - c.x) * k,
        c.y + (pos.getY(v) - c.y) * k,
        c.z + (pos.getZ(v) - c.z) * k);
    }
  }
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  g.deleteAttribute('uv');
  return g;
}

/* ONE SAWN PAVER.
   A slab is not a box. What tells the eye a stone was cut rather than drawn
   is the arris — the narrow chamfer where the top face turns down into the
   side — because it is the one part of the slab that catches the key light
   at a completely different angle from everything around it. Below that
   comes a real body, most of which is buried: the embed is what attaches the
   paving to the ground.

   `seed` is baked into every vertex so that a whole path can merge into one
   buffer and the shader can still vary tone and grain stone by stone.      */
function paverGeometry(hx, hz, hy, c, seed) {
  const pos = [], nor = [], uv = [], sd = [], idx = [];
  const add = (x, y, z, n) => {
    pos.push(x, y, z); nor.push(n[0], n[1], n[2]);
    uv.push((x + hx) / (2 * hx), (z + hz) / (2 * hz)); sd.push(seed);
    return pos.length / 3 - 1;
  };
  /* Wound counter-clockwise as seen from above, which makes every wall's
     winding fall out of the ring order instead of needing a special case. */
  const ring = (rx, rz) => [[-rx, rz], [rx, rz], [rx, -rz], [-rx, -rz]];
  const outer = ring(hx, hz), inset = ring(hx - c, hz - c);
  const yT = hy, yC = hy - c, yB = -hy;
  const UP = [0, 1, 0], DN = [0, -1, 0];
  const OUT = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];

  const T = inset.map(([x, z]) => add(x, yT, z, UP));
  idx.push(T[0], T[1], T[2], T[0], T[2], T[3]);
  const B = outer.map(([x, z]) => add(x, yB, z, DN));
  idx.push(B[0], B[3], B[2], B[0], B[2], B[1]);

  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4, n = OUT[k];
    const cn = [n[0] * 0.707, 0.707, n[2] * 0.707];
    const o0 = add(outer[k][0], yC, outer[k][1], cn);
    const o1 = add(outer[k1][0], yC, outer[k1][1], cn);
    const i0 = add(inset[k][0], yT, inset[k][1], cn);
    const i1 = add(inset[k1][0], yT, inset[k1][1], cn);
    idx.push(o0, o1, i1, o0, i1, i0);
    const b0 = add(outer[k][0], yB, outer[k][1], n);
    const b1 = add(outer[k1][0], yB, outer[k1][1], n);
    const c0 = add(outer[k][0], yC, outer[k][1], n);
    const c1 = add(outer[k1][0], yC, outer[k1][1], n);
    idx.push(b0, b1, c1, b0, c1, c0);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.setIndex(idx);
  return g;
}

/* One grass blade: a tapered strip, four segments, single mesh instanced a
   few thousand times. Never a sphere, never a billboard sprite. */
function bladeGeometry() {
  const seg = 4, h = 1, w = 0.030;
  const pos = [], nor = [], uv = [], idx = [];
  /* The normal points mostly UP rather than out of the blade's face. A blade
     is two triangles seen edge-on from most angles; shading it by its own
     face normal makes a random half of the sward catch the key light head-on
     and flare white. Tilting the normal skyward makes the lawn read as one
     lit surface, which is what a mown lawn actually looks like. */
  const NX = 0, NY = 0.86, NZ = 0.51;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const hwid = (w * (1 - t * 0.88)) / 2;
    pos.push(-hwid, t * h, t * t * 0.22); nor.push(NX, NY, NZ); uv.push(0, t);
    pos.push(hwid, t * h, t * t * 0.22); nor.push(NX, NY, NZ); uv.push(1, t);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ==========================================================================
   04 — MATERIALS
   --------------------------------------------------------------------------
   Every material is MeshStandardMaterial with its shader rewritten in place.
   Using the standard PBR core keeps the lighting physically coherent (which
   is what makes it read as a photographed architectural model); the injected
   chunks supply the earth.
   ========================================================================== */

const U = {
  time:    { value: 0 },
  moist:   { value: 0 },   // root-zone wetting, 0..1
  veg:     { value: 1 },   // surface vegetation presence, 0..1
  raw:     { value: 0 },   // 1 = stripped back to bare terrain (chapter TEREP)
  grow:    { value: 1 },   // root extension, 0..1
  pulse:   { value: -1 },  // water head position along the network, 0..1.2
  flow:    { value: 0 },   // network illumination, 0..1
  rootFade:{ value: 1 },
  explode: { value: 0 },
  warm:    { value: 0 },   // final warm grade in the KÉSZ KERT state
  pave:    { value: PAVE_U },
  grassH:  { value: 0.052 },
  built:   { value: 1 }    // hardscape presence — drives its contact shading
};

/* Formats a depth the way a survey sheet would, with a Hungarian decimal
   comma. Used by the live readout on the horizon rule. */
const fmtDepth = (m) => (m < 0.005 ? '0,00' : m.toFixed(2).replace('.', ',')) + ' m';

const EMIT = [
  new THREE.Vector3(-3.05, PIPE_Y, 0.6), new THREE.Vector3(-1.05, PIPE_Y, 1.5),
  new THREE.Vector3(1.05, PIPE_Y, 0.4), new THREE.Vector3(3.05, PIPE_Y, 1.7),
  new THREE.Vector3(-2.05, PIPE_Y, -0.9), new THREE.Vector3(2.15, PIPE_Y, -0.6)
];
U.emit = { value: EMIT };

function inject(mat, opts) {
  mat.userData.rk = opts.key;
  mat.customProgramCacheKey = () => opts.key + '|' + Q.oct;

  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: U.time, uMoist: U.moist, uVeg: U.veg, uRaw: U.raw,
      uGrow: U.grow, uPulse: U.pulse, uFlow: U.flow, uRootFade: U.rootFade,
      uWarm: U.warm, uEmit: U.emit, uExplode: U.explode,
      uTop: { value: opts.top ?? 0 }, uBot: { value: opts.bot ?? -1 }
    });
    if (opts.pave) Object.assign(sh.uniforms, { uPave: U.pave, uBuilt: U.built });

    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aFace;
        varying vec3 vObj;
        varying float vFace;
        uniform float uTime;
        uniform float uVeg;
        uniform float uRaw;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObj = position;
        vFace = aFace;
        ${opts.vertex || ''}`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        #define RK_OCT ${Q.oct}
        varying vec3 vObj;
        varying float vFace;
        uniform float uTime, uMoist, uVeg, uRaw, uWarm, uFlow, uPulse, uExplode;
        uniform float uTop, uBot;
        uniform vec3 uEmit[6];
        ${GLSL_NOISE}
        ${opts.pave ? 'uniform float uBuilt;\n' + GLSL_PAVE : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${opts.frag || ''}`);

    if (opts.rough) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${opts.rough}`);
    }
  };
  return mat;
}

/* -- soil ------------------------------------------------------------------
   The whole look of the piece lives in these ~25 lines. Three things stop it
   reading as a coloured cube:
     · sediment banding that only appears on the cut faces
     · a fine mineral grain at a much higher frequency than the banding
     · a darker, damper band immediately under each layer boundary          */
const SOIL_FRAG = `
  float depth = clamp((vObj.y - uBot) / max(uTop - uBot, 0.001), 0.0, 1.0);

  // large-scale mottling — patches of richer and poorer earth
  float m = rkFbm(vObj * 0.62 + vec3(0.0, 3.1, 0.0));
  // mineral grain — deliberately near pixel scale on the cut faces
  float grain = rkNoise(vObj * 42.0) * 0.5 + rkNoise(vObj * 128.0) * 0.5;
  // sedimentation: horizontal strata that wobble, never ruled lines
  float band = sin(vObj.y * 15.0 + rkFbm(vObj * 1.4) * 6.2) * 0.5 + 0.5;

  float cut = step(0.5, vFace) * step(vFace, 1.5);   // 1 on the cut faces only

  vec3 c = diffuseColor.rgb;
  c *= 0.80 + 0.42 * m;
  c *= 1.0 - cut * band * 0.16;
  c *= 0.90 + 0.20 * grain;
  // damp, compacted band just below each boundary
  c *= mix(1.0, 0.80, smoothstep(0.92, 1.0, depth));
  // subtle warm lift toward the top of every stratum
  c = mix(c, c * vec3(1.14, 1.03, 0.90), depth * 0.5);
  diffuseColor.rgb = c;
`;

const SOIL_ROUGH = `
  roughnessFactor *= 0.86 + 0.20 * rkNoise(vObj * 9.0);
`;

function soilMaterial(L) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(L.color), roughness: L.rough, metalness: 0.0
  });
  return inject(m, { key: 'soil-' + L.id, top: L.top, bot: L.bot, frag: SOIL_FRAG, rough: SOIL_ROUGH });
}

/* Root zone: the same earth, plus the moisture field. Wet soil is darker and
   slightly more saturated — that is the entire effect. No blue tint, no
   cartoon droplets, no particle spray. */
function rootZoneMaterial(L) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(L.color), roughness: L.rough, metalness: 0.0
  });
  return inject(m, {
    key: 'rootzone', top: L.top, bot: L.bot,
    /* Wet soil is not merely darker, it is SMOOTHER. On earth this dark a
       pure albedo shift was physically correct and visually invisible — the
       reported "moisture is too subtle". Half the read now comes from the
       roughness: the wetted field picks up a sheen the dry soil around it
       cannot, so it separates under any light instead of only under a bright
       one. No droplets, no blue, no glow. */
    rough: SOIL_ROUGH + `
      roughnessFactor *= 1.0 - wet * 0.60;`,
    frag: SOIL_FRAG + `
      /* The reach is floored well above zero. At uMoist == 0 the two
         smoothstep edges would otherwise collide, the divide inside it
         returns NaN, and the NaN propagates through the mix and paints the
         whole root zone black — which is exactly what it did. */
      /* Deliberately SHORTER than the root zone is thick. A reach that fills
         the layer edge to edge just darkens a stripe of the diagram and
         reads as a different soil; a reach that stops short leaves dry earth
         above and below it, and the shape between them is what the eye
         recognises as water spreading. */
      /* PHASE 2.2. The reach used to be 1.12, which — measured through the
         0.58 lateral squash and the 1.05 vertical one — put the front 1.93m
         either side of a dripline and 1.07m above and below it. The laterals
         are 2.30m apart and the root zone is 1.42m thick, so the bands MET
         each other sideways and OVERRAN the stratum vertically: the whole
         layer went dark to its own edges and the eye read "this stratum is a
         different soil", not "water is spreading". The shape only exists if
         there is dry earth on the other side of it. */
      float reach = max(0.52 * uMoist, 0.02);
      float wet = 0.0;

      /* THE WETTED BAND.
         Point bulbs around the six emitters were physically reasonable and
         compositionally useless: the emitters hang in the OPEN TRENCH, where
         the soil that would show the wetting has been dug away, so the only
         evidence was a partial disc on a wall a metre and a half behind
         them. Subsurface drip does not wet in spheres anyway — it wets in a
         continuous band along the dripline. Measuring from the lateral's
         AXIS instead puts the effect on the full height of every cut face a
         lateral crosses, which is the surface the visitor is actually
         looking at.  */
      float lat = 1e3;
      ${LATERAL_X.map(x => `lat = min(lat, abs(vObj.x - (${x.toFixed(2)})));`).join('\n      ')}
      float axial = length(vec2(lat * 0.58, (vObj.y - (${PIPE_Y})) * 1.05));
      /* Soil is not homogeneous, so a wetting front is never an ellipse.
         Warping the distance before the falloff is cheaper than warping the
         result and keeps the boundary irregular at every scale. */
      axial *= 0.84 + 0.32 * rkFbm(vObj * 1.9 + vec3(11.0, 0.0, 5.0));
      /* the laterals only run forward of the main line */
      float along = smoothstep(-2.05, -1.35, vObj.z);
      wet = (1.0 - smoothstep(reach * 0.16, reach, axial)) * along;

      /* The emitters still mark where the water actually enters: a local
         intensification on top of the band, not the whole story. */
      for (int i = 0; i < 6; i++){
        vec3 e = uEmit[i];
        // an oblate bulb: water spreads wider than it sinks
        vec3 d = vec3((vObj.x - e.x) * 0.56, (vObj.y - e.y) * 1.00, (vObj.z - e.z) * 0.56);
        float r = length(d);
        wet = max(wet, (1.0 - smoothstep(reach * 0.26, reach, r)) * 1.06);
      }
      wet *= uMoist;
      wet *= 0.90 + 0.24 * rkFbm(vObj * 2.4 + vec3(0.0, uTime * 0.03, 0.0));
      wet = clamp(wet, 0.0, 1.0);
      /* Darker and a shade cooler — soaked earth, not tinted earth. */
      /* The band is now a third the size it was, so it has to be a stronger
         read per square metre or the honesty of the shape buys nothing. The
         extra contrast is albedo and roughness only — no emissive term, no
         blue, nothing added to the frame that is not soil. */
      diffuseColor.rgb = mix(diffuseColor.rgb,
                             diffuseColor.rgb * vec3(0.42, 0.415, 0.470), wet);
      /* THE WETTING FRONT. A narrow darker rim at the edge of the bulb. In a
         photograph of an opened trench this boundary is the single thing
         that tells you water is moving through the soil rather than that the
         soil happens to be dark there, and it costs two smoothsteps. */
      float front = smoothstep(0.50, 0.78, wet) * (1.0 - smoothstep(0.78, 0.97, wet));
      diffuseColor.rgb *= 1.0 - front * 0.26;
    `
  });
}

/* Aggregate. Cellular distance on the two dominant axes of the face gives
   packed, rounded stone without a texture download or a voronoi 3D loop. */
function gravelMaterial(L) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(L.color), roughness: L.rough, metalness: 0.0
  });
  return inject(m, {
    key: 'gravel', top: L.top, bot: L.bot,
    rough: `roughnessFactor *= 0.72 + 0.34 * rkNoise(vObj * 14.0);`,
    frag: `
      float cut = step(0.5, vFace) * step(vFace, 1.5);
      vec2 q = mix(vObj.xz, vec2(vObj.x + vObj.z * 0.75, vObj.y), cut);
      /* Warping the lattice before sampling is what stops washed aggregate
         from reading as polka dots on a grid: real stone has no lattice. */
      q += vec2(rkFbm(vObj * 1.7) - 0.5, rkFbm(vObj * 1.7 + 41.0) - 0.5) * 1.6;
      float c1 = rkCell(q * 4.6);
      float c2 = rkCell(q * 9.3 + 31.7);
      /* Seams between the stones, not discs in the middle of them. */
      float seam = 1.0 - smoothstep(0.0, 0.16, c1);
      float seam2 = 1.0 - smoothstep(0.0, 0.11, c2);
      /* Per-stone tonal variation — every pebble is a slightly different rock.
         The cell id is 2D; rkNoise is 3D, so it has to be lifted explicitly. */
      float lot = rkNoise(vec3(floor(q * 4.6) * 1.31, 5.0));
      vec3 col = diffuseColor.rgb;
      col *= 0.62 + 0.54 * lot;
      col *= 0.86 + 0.30 * rkFbm(vObj * 2.4);
      col *= 0.93 + 0.14 * rkNoise(vObj * 44.0);
      // the voids between stones read as shadow, which is what sells depth
      col *= 1.0 - seam * 0.62 - seam2 * 0.22;
      diffuseColor.rgb = col;
    `
  });
}

/* Compacted sub-base — denser, cooler, almost geological. Very little
   variation on purpose: it has to feel like the bottom of the specimen. */
function baseMaterial(L) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(L.color), roughness: L.rough, metalness: 0.0
  });
  return inject(m, {
    key: 'base', top: L.top, bot: L.bot,
    rough: SOIL_ROUGH + `
      /* The compacted lifts are denser AND smoother than the loose material
         between them, which is most of why a cut through a sub-base reads as
         built rather than as a block of colour. */
      roughnessFactor *= 0.92 + 0.14 * lift;`,
    frag: `
      float cut = step(0.5, vFace) * step(vFace, 1.5);
      float m1 = rkFbm(vec3(vObj.x * 0.5, vObj.y * 1.9, vObj.z * 0.5));

      /* THE LARGEST AND QUIETEST LAYER.
         It occupies nearly a third of the section and had almost nothing in
         it — a smooth gradient with one sine through it. The problem with
         solving that is that anything interesting enough to reward a close
         look is also loud enough to pull attention off the root zone above,
         which is where the argument actually is. So every term here is
         low-contrast and none of them is coloured: the layer earns its
         detail from STRUCTURE, not from tone. */

      /* Compression bands. A sub-base is laid and compacted in lifts, so it
         is horizontally stratified at a coarser pitch than sediment. */
      float lift = sin(vObj.y * 3.4 + m1 * 2.2) * 0.5 + 0.5;
      lift = smoothstep(0.32, 0.72, lift);

      /* Two aggregate grades, warped so neither resolves into a lattice. */
      vec2 q = mix(vObj.xz, vec2(vObj.x + vObj.z * 0.6, vObj.y), cut);
      q += vec2(rkFbm(vObj * 1.3) - 0.5, rkFbm(vObj * 1.3 + 27.0) - 0.5) * 1.1;
      float fine = 1.0 - smoothstep(0.0, 0.13, rkCell(q * 11.0));
      float coarse = 1.0 - smoothstep(0.0, 0.15, rkCell(q * 5.2 + 8.3));

      /* Occasional oversize inclusions — one stone in maybe thirty is much
         bigger than the rest, and finding them is the reward for looking. */
      float lot = rkNoise(vec3(floor(q * 2.6) * 1.7, 3.0));
      float big = smoothstep(0.80, 0.94, lot) *
                  (1.0 - smoothstep(0.0, 0.30, rkCell(q * 2.6 + 4.1)));

      vec3 col = diffuseColor.rgb * (0.80 + 0.36 * m1);
      /* slow tonal stratification — deeper is marginally cooler and denser */
      float depth = clamp((vObj.y - uBot) / max(uTop - uBot, 0.001), 0.0, 1.0);
      col *= mix(0.90, 1.06, depth);
      col = mix(col, col * vec3(0.97, 0.99, 1.03), (1.0 - depth) * 0.5);
      col *= 1.0 + cut * (lift - 0.5) * 0.13;
      col *= 1.0 - cut * (fine * 0.13 + coarse * 0.16);
      col *= 1.0 + cut * big * 0.20;
      col *= 0.94 + 0.12 * rkNoise(vObj * 36.0);
      diffuseColor.rgb = col;
    `
  });
}

/* Surface cap. Carries the turf, and dissolves back to bare earth for the
   TEREP state via uRaw — the same mesh, never a swapped model. */
function turfMaterial(L) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(L.color), roughness: L.rough, metalness: 0.0
  });
  return inject(m, {
    key: 'turf', top: L.top, bot: L.bot, rough: SOIL_ROUGH, pave: true,
    frag: `
      float cut = step(0.5, vFace) * step(vFace, 1.5);
      float top = 1.0 - cut;
      float f = rkFbm(vObj * 3.1);
      float fine = rkNoise(vObj * 58.0);
      /* The top face is no longer the lawn — the shells are. It is the soil
         and thatch the visitor glimpses BETWEEN the blades, so it is much
         darker and warmer than the sward standing on it. Left as bright as
         the grass it produced a flat green card with hair on top. */
      vec3 turf = diffuseColor.rgb * (0.34 + 0.40 * f) * (0.90 + 0.20 * fine);
      // mown banding, only where the mower would have gone
      turf *= 1.0 + top * sin(vObj.x * 1.62) * 0.05;
      // the thatch/soil line on the cut edge
      vec3 thatch = vec3(0.196, 0.152, 0.104) * (0.8 + 0.5 * f);
      float depth = clamp((vObj.y - uBot) / max(uTop - uBot, 0.001), 0.0, 1.0);
      vec3 col = mix(thatch, turf, smoothstep(0.34, 0.88, depth));
      // TEREP: the same block, stripped back to raw graded soil
      vec3 bare = vec3(0.290, 0.222, 0.152) * (0.72 + 0.60 * f) * (0.92 + 0.18 * fine);
      col = mix(col, bare, uRaw);
      /* CONTACT. The ground darkens as it runs under a slab and picks up a
         thin bright lip at the joint — an occlusion gradient and an edge
         highlight, which together are what stop the paving reading as a prop
         resting on a plane. Costs seven box distances, no SSAO pass. */
      float pd = rkPaveSD(vObj.xz);
      float occl = 1.0 - 0.62 * (1.0 - smoothstep(-0.04, 0.30, pd));
      float lip = (1.0 - smoothstep(0.0, 0.045, abs(pd))) * 0.22;
      col *= mix(1.0, occl, top * uBuilt);
      col += col * lip * top * uBuilt;
      col = mix(col, col * vec3(1.10, 1.05, 0.94), uWarm * 0.6);
      diffuseColor.rgb = col;
    `
  });
}

/* -- roots -----------------------------------------------------------------
   Pale, dry, fibrous. Grown by discarding beyond uGrow along the tube, which
   costs nothing and gives a real advancing tip.                            */
function rootMaterial() {
  /* Darker than it looks on a swatch. Against soil this deep a pale root
     reads as a white worm, and a lawn's roots are not pale — they are the
     colour of dry straw at a fraction of its brightness. */
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x8E7C61), roughness: 0.94, metalness: 0.0,
    transparent: true, depthWrite: true
  });
  m.customProgramCacheKey = () => 'root';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uGrow: U.grow, uFade: U.rootFade, uMoist: U.moist });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aT; varying float vT; varying vec3 vObj;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vT = aT; vObj = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vT; varying vec3 vObj;
        uniform float uGrow, uFade, uMoist;
        ${GLSL_NOISE.replace('RK_OCT', '2')}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (vT > uGrow) discard;
        /* THE EXCAVATION CUTS THE ROOTS TOO.
           Roots grown inside the trench volume were dug out with the soil, so
           they are clipped against exactly the same corner the strata are.
           This is what lets the generator seed systems right up against the
           cut face: the laterals that cross it stop flush with the wall and
           read as severed root ends standing proud of the section — instead
           of the metre of pale spaghetti hanging in the open trench that
           seeding them anywhere near it used to produce. */
        if (vObj.x > ${NOTCH.x0 + 0.22} && vObj.z > ${NOTCH.z0 + 0.22}) discard;
        float fib = rkNoise(vObj * 30.0);
        diffuseColor.rgb *= 0.72 + 0.46 * fib;
        // fine root hair darkens toward the tip
        diffuseColor.rgb *= mix(1.0, 0.68, smoothstep(0.4, 1.0, vT));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72,0.66,0.58), uMoist * 0.5);
        diffuseColor.a *= uFade;`);
  };
  return m;
}

/* -- pipe ------------------------------------------------------------------
   Matte polymer. Deliberately NOT blue: real buried irrigation is black or
   dark brown, and a blue pipe is the single fastest way to make this look
   like a diagram from a hardware catalogue.                                */
function pipeMaterial(color, rough, live) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: 0.06 });
  m.customProgramCacheKey = () => 'pipe' + color + (live ? 'L' : '');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uFlow: U.flow, uPulse: U.pulse });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj;
        ${live ? 'attribute float aT; varying float vT;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObj = position;
        ${live ? 'vT = aT;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj; uniform float uFlow, uPulse;
        ${live ? 'varying float vT;' : ''}
        ${GLSL_NOISE.replace('RK_OCT', '2')}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= 0.86 + 0.28 * rkNoise(vObj * 24.0);
        ${live ? `
        /* MATERIAL RESPONSE. The polymer stays matte and dark — what changes
           as the charge passes is that the wall is very slightly lifted from
           the inside. This is the thing that stops the water reading as a
           light source travelling ALONGSIDE a pipe rather than a pressure
           front travelling THROUGH one. */
        float head = uPulse - vT;
        float near = exp(-head * head * 26.0) * uFlow;
        diffuseColor.rgb *= 1.0 + near * 0.42;` : `
        diffuseColor.rgb *= 1.0 + uFlow * 0.06;`}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${live ? 'roughnessFactor *= 1.0 - near * 0.20;' : ''}`);
  };
  return m;
}

/* -- water -----------------------------------------------------------------
   An additive sleeve just outside the pipe wall. It is not a glowing tube:
   it is a narrow travelling window, so at any instant only ~8% of the network
   is lit. That restraint is what keeps it out of cyberpunk territory.      */
function waterMaterial() {
  /* Not the brand's water blue, and not a lifted version of it either: a
     cool grey with barely any chroma left. Additive blending brightens
     whatever it lands on, so ANY saturation here compounds into the neon
     worm the brief asked to get rid of. What should read is pressure. */
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x5F6C72), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 1
  });
  m.customProgramCacheKey = () => 'water';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uPulse: U.pulse, uFlow: U.flow, uTime: U.time });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aT;\nvarying float vT;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvT = aT;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vT; uniform float uPulse, uFlow, uTime;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float head = uPulse - vT;
        /* WIDER AND DIMMER. The old head was a 30cm spike at nearly half
           opacity — an LED in a tube. This one spreads over roughly a fifth
           of the network at a third of the brightness, with a soft leading
           edge and a much shorter luminance range, so it reads as a charge
           of water arriving rather than a light switching on. The pipe's own
           material picks up the rest of the story. */
        float lead = exp(-head * head * 62.0);
        float ease = smoothstep(-0.20, 0.02, head);   // soft front, hard back
        // the charged line behind it: present, never bright
        float filled = smoothstep(0.0, 0.09, head) * 0.13;
        float a = (lead * ease * 0.26 + filled) * uFlow;
        if (a < 0.004) discard;
        diffuseColor.a *= clamp(a, 0.0, 0.30);`);
  };
  return m;
}

/* -- hardscape -------------------------------------------------------------
   Warm limestone paving with sawn edges. Small, restrained, and the only
   thing on the specimen that is allowed to look manufactured.              */
function stoneMaterial(color, r, seeded) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: r, metalness: 0.0 });
  m.customProgramCacheKey = () => 'stone' + color + (seeded ? 's' : '');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uWarm: U.warm });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj;
        ${seeded ? 'attribute float aSeed; varying float vSeed;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObj = position;
        ${seeded ? 'vSeed = aSeed;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj; uniform float uWarm;
        ${seeded ? 'varying float vSeed;' : ''}
        ${GLSL_NOISE.replace('RK_OCT', '3')}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${seeded ? `
        /* Per-slab identity. The whole path is one buffer, so without this
           the grain runs straight across the joints and six stones read as
           one printed strip. The seed offsets the noise domain AND the tone,
           which is the difference between six copies and six stones. */
        vec3 sp = vObj + vec3(vSeed * 17.3, vSeed * 5.1, vSeed * 23.7);
        float lot = fract(sin(vSeed * 91.7) * 43758.5453);
        diffuseColor.rgb *= 0.88 + 0.24 * lot;` : `
        vec3 sp = vObj;`}
        float g = rkFbm(sp * 5.5);
        diffuseColor.rgb *= 0.82 + 0.34 * g;
        /* sawn-face grain: fine, directional, and much stronger than the
           mottling — a cut stone's surface is scratched, not clouded */
        diffuseColor.rgb *= 0.90 + 0.20 * rkNoise(sp * vec3(70.0, 26.0, 190.0));
        diffuseColor.rgb *= 0.95 + 0.10 * rkNoise(sp * 70.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.10,1.04,0.93), uWarm * 0.7);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 0.86 + 0.22 * rkNoise(sp * 12.0);`);
  };
  return m;
}

/* -- the sward: shells -----------------------------------------------------
   The bulk of the lawn. See makeShells() for why it is built this way. The
   fragment shader is the whole material: geometry supplies only a stack of
   offset copies of the ground, and every blade in the frame is a discard
   test against a jittered lattice.                                         */
function shellMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.86, metalness: 0.0, side: THREE.FrontSide
  });
  m.customProgramCacheKey = () => 'shell|' + Q.lattice;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: U.time, uVeg: U.veg, uWarm: U.warm, uMoist: U.moist,
      uPave: U.pave, uGrassH: U.grassH
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aShell;
        varying float vShell;
        varying vec3 vObj;
        uniform float uTime, uVeg, uGrassH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vShell = aShell;
        /* The UNDISPLACED position, so the strand lattice is anchored to the
           ground plane. Sampling it after the lift would make every blade
           slide sideways as the shells rise, and the sward would swim. */
        vObj = position;
        transformed += normal * (aShell * uGrassH * uVeg);
        float ph = position.x * 1.7 + position.z * 2.3;
        float bend = aShell * aShell;
        transformed.x += (sin(uTime * 1.05 + ph) * 0.030 + sin(uTime * 2.6 + ph * 1.8) * 0.011) * bend * uVeg;
        transformed.z += cos(uTime * 0.86 + ph) * 0.020 * bend * uVeg;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        #define RK_LATTICE ${Q.lattice}
        varying float vShell;
        varying vec3 vObj;
        uniform float uTime, uVeg, uWarm, uMoist;
        ${GLSL_PAVE}
        ${GLSL_GRASS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (uVeg < 0.02) discard;
        vec2 gp = vObj.xz;

        /* Nothing grows under a slab, and what grows beside one is shorter
           and darker. That fringe is what sets the paving INTO the lawn
           instead of laying it on top. */
        float pd = rkPaveSD(gp);
        if (pd < 0.010) discard;
        float edge = smoothstep(0.010, 0.32, pd);

        /* Patchiness. A lawn with uniform vigour is a carpet; the whole
           difference is that some of it is doing better than the rest. */
        float clump = gFbm(gp * 1.55);
        float lawn = (0.60 + 0.64 * clump) * (0.52 + 0.48 * edge);

        /* Mown bands: adjacent passes lay the grass in opposite directions,
           which is the only reason stripes exist on a real lawn. */
        float band = step(0.0, sin(gp.x * 1.62));
        vec2 wind = vec2(sin(uTime * 1.02 + gp.x * 1.9 + gp.y * 1.3),
                         cos(uTime * 0.79 + gp.x * 1.1)) * 0.055;
        vec2 lean = vec2(0.06, mix(-0.30, 0.30, band))
                  + wind + (gNoise(gp * 0.7) - 0.5) * 0.14;

        float t1 = 0.0, t2 = 0.0;
        float cov = rkStrand(gp, 31.0, 0.0, vShell, lean, lawn, t1);
        #if RK_LATTICE > 1
          float covB = rkStrand(gp, 49.0, 21.7, vShell, lean * 1.5, lawn * 0.92, t2);
          float tone = cov > 0.5 ? t1 : t2;
          if (cov + covB < 0.5) discard;
        #else
          float tone = t1;
          if (cov < 0.5) discard;
        #endif

        /* Two greens, both controlled: the richer one where the sward is
           dense, the drier one where it thins. Neither is a saturated
           vegetation green — this is turf in an architectural render. */
        vec3 rich = vec3(0.084, 0.120, 0.046);
        vec3 dry  = vec3(0.176, 0.199, 0.090);
        vec3 col = mix(rich, dry, clamp(clump * 1.30 - 0.12, 0.0, 1.0));
        col *= 0.84 + 0.32 * tone;
        /* Almost no light reaches the soil inside the sward; all of it
           reaches the tip. This gradient IS the difference between turf and
           a green surface with hair on it. */
        col *= mix(0.32, 1.30, pow(vShell, 0.62));
        col = mix(col, col * vec3(1.18, 1.06, 0.76), smoothstep(0.66, 1.0, vShell) * 0.5);
        col *= 1.0 + (band * 2.0 - 1.0) * 0.05;
        col *= 0.70 + 0.30 * edge;
        col = mix(col, col * vec3(0.88, 0.99, 0.86), uMoist * 0.30);
        col = mix(col, col * vec3(1.10, 1.05, 0.90), uWarm * 0.7);
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        /* The mown bands differ in specular response, not only in albedo —
           that is what makes stripes survive a change of light. */
        roughnessFactor *= 0.80 + 0.24 * band + 0.14 * tone;`);
  };
  return m;
}

/* -- the sward: silhouette blades ------------------------------------------
   A few thousand real blades, kept only for the edges: a shell stack has
   nothing to show at a grazing angle, and the block's own horizon is exactly
   where the lawn is seen edge-on. uVeg collapses them for the TEREP state.  */
function grassMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.90, metalness: 0.0, side: THREE.DoubleSide
  });
  m.customProgramCacheKey = () => 'grass';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: U.time, uVeg: U.veg, uWarm: U.warm, uMoist: U.moist });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uVeg; varying float vH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vH = uv.y;
        float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
        float bend = uv.y * uv.y;
        transformed.y *= uVeg;
        transformed.x += (sin(uTime * 1.15 + ph) * 0.048 + sin(uTime * 2.7 + ph * 1.9) * 0.019) * bend * uVeg;
        transformed.z += cos(uTime * 0.9 + ph) * 0.030 * bend * uVeg;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vH; uniform float uWarm, uMoist;`)
      /* THE BLACK SWARD BUG.
         A blade is a near-vertical strip carrying a normal that points at the
         sky, so the lawn shades as one lit surface. But it is drawn double
         sided, and for a back face three flips that normal to point at the
         GROUND — where the only light is the hemisphere's dark soil term. A
         randomly rotated blade is a coin toss, so half the sward rendered
         black and the lawn read as dark stipple at every camera position.
         Cancelling the flip costs one multiply and fixes the whole surface. */
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal *= faceDirection;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // darker at the base where light does not reach into the sward,
        // brighter at the tip where it does — that gradient IS the lawn
        diffuseColor.rgb *= mix(0.34, 0.98, vH);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06,1.10,0.92), uMoist * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12,1.06,0.90), uWarm * 0.8);`);
  };
  return m;
}

/* ==========================================================================
   05 — THE SPECIMEN
   ========================================================================== */

const scene = new THREE.Scene();
/* Aerial perspective. Without it the far bottom corner of the specimen has
   exactly the same contrast as the near top corner and the block reads flat,
   like an isometric icon rather than a photographed object. */
scene.fog = new THREE.FogExp2(0x0E0F0B, 0.0125);
const core = new THREE.Group();          // everything that is the object
scene.add(core);

const layerGroups = {};
const disposables = [];

/* Layer boundary surfaces. Each boundary gets its own displacement field, so
   no two strata share an edge profile — that is what stops the block reading
   as five stacked slabs. */
function boundary(index, y, amp, freq) {
  /* Two octaves at unrelated frequencies. One wave alone reads as a ruled
     line that someone bent; the beat between two reads as sediment. */
  return (x, z) => y
    + (fbm(x * freq + index * 11.3, z * freq + index * 7.7, 3) - 0.5) * amp
    + (vnoise(x * freq * 3.7 + index * 5.1, z * freq * 3.3 + index * 9.4) - 0.5) * amp * 0.42;
}

const BOUND = [
  boundary(0, LAYERS[0].top, 0.09, 0.55),   // the mown surface — nearly flat
  boundary(1, LAYERS[0].bot, 0.17, 0.85),
  boundary(2, LAYERS[1].bot, 0.46, 0.62),
  boundary(3, LAYERS[2].bot, 0.52, 0.44),
  boundary(4, LAYERS[3].bot, 0.50, 0.38),
  boundary(5, LAYERS[4].bot, 0.34, 0.52)
];

const segX = tier === 'low' ? 26 : tier === 'med' ? 40 : 56;
const segZ = tier === 'low' ? 18 : tier === 'med' ? 28 : 40;

/* The trench is cut through everything above the drainage course; the
   drainage layer keeps its full top surface and becomes the trench floor. */
const NOTCHED = { surface: true, topsoil: true, root: true, drain: false, base: false };

/* The backfill. Rapidkert's actual job is to open the ground, build the
   system and close it again, so the excavation is not permanent: during
   STRUKTÚRA the three excavated strata drop back into the trench and the
   finished garden hands over to the photograph as an unbroken lawn. */
const backfill = new THREE.Group();
core.add(backfill);

LAYERS.forEach((L, i) => {
  const g = new THREE.Group();
  const geo = makeStratum(BOUND[i], BOUND[i + 1], segX, segZ, NOTCHED[L.id] ? 'notched' : 'full');
  const mat =
    L.kind === 'turf'   ? turfMaterial(L) :
    L.kind === 'gravel' ? gravelMaterial(L) :
    L.kind === 'base'   ? baseMaterial(L) :
    L.kind === 'root'   ? rootZoneMaterial(L) : soilMaterial(L);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;   // the strata are one solid; nothing to cast onto
  mesh.receiveShadow = true;
  g.add(mesh);
  g.userData.ex = L.ex;
  core.add(g);
  layerGroups[L.id] = g;
  disposables.push(geo, mat);

  /* The matching backfill piece, sharing the stratum's material so the
     closed ground is continuous with the ground around it. */
  if (NOTCHED[L.id]) {
    const pg = makeStratum(BOUND[i], BOUND[i + 1], segX, segZ, 'plug');
    const pm = new THREE.Mesh(pg, mat);
    pm.receiveShadow = true;
    backfill.add(pm);
    disposables.push(pg);
  }
});

/* -- surface vegetation ----------------------------------------------------
   Two systems, one lawn: the shells carry the density, the blades carry the
   silhouette. Each exists in two copies, because the sward over the backfill
   travels with the soil under it when the trench closes.                    */
const PATH = { x0: -1.05, x1: 1.05, z0: -D / 2, z1: 1.1 };   // path corridor

/* The JS twin of rkPaveSD — the sward has to be sown against exactly the
   footprint the shader carves out, or blades sprout through the slabs. */
function paveSD(x, z) {
  let d = Infinity;
  for (const p of PAVE_U) {
    const qx = Math.abs(x - p.x) - p.z, qz = Math.abs(z - p.y) - p.w;
    d = Math.min(d, Math.min(Math.max(qx, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qz, 0)));
  }
  return d;
}

const blade = bladeGeometry();
const grassMat = grassMaterial();
const shellMat = shellMaterial();
disposables.push(blade, grassMat, shellMat);

const inNotch = (x, z) => x > NOTCH.x0 && z > NOTCH.z0;

/* The shells. One mesh each for the intact ground and the backfill. */
function sward(mode, parent) {
  const g = makeShells(BOUND[0], Q.capX, Q.capZ, mode, Q.shells);
  const m = new THREE.Mesh(g, shellMat);
  m.castShadow = false;
  /* The sward receives the paving's shadow — with the shells opaque and
     depth-writing this is the one place a real shadow map still earns its
     keep, and it is what puts the slabs ON the lawn rather than over it. */
  m.receiveShadow = true;
  m.renderOrder = 1;
  parent.add(m);
  disposables.push(g);
}
sward('notched', layerGroups.surface);
sward('plug', backfill);

/* The blades. Weighted hard toward the block's own edges: that is where the
   lawn is seen end-on, where a shell stack has nothing left to draw, and
   where a soft silhouette instantly reads as a rendering rather than a
   model. In the middle of the plot the shells already have it covered. */
function sow(count, accept) {
  const im = new THREE.InstancedMesh(blade, grassMat, count);
  im.frustumCulled = false;
  im.castShadow = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const e = new THREE.Euler(), s = new THREE.Vector3(), pt = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 26) {
    const x = (rand() - 0.5) * (W - 0.10);
    const z = (rand() - 0.5) * (D - 0.10);
    if (paveSD(x, z) < 0.03) continue;
    if (!accept(x, z)) continue;
    /* distance to the nearest silhouette edge: the block's perimeter and the
       trench lip both qualify */
    const rim = Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z),
                         Math.max(Math.abs(x - NOTCH.x0), Math.abs(z - NOTCH.z0)) * 0.9);
    if (rand() > Math.exp(-rim * 1.35) * 0.94 + 0.06) continue;
    pt.set(x, BOUND[0](x, z) - 0.016, z);
    e.set((rand() - 0.5) * 0.40, rand() * Math.PI * 2, (rand() - 0.5) * 0.40);
    q.setFromEuler(e);
    /* Slightly taller than the shell stack reaches, so the blades break its
       top plane instead of hiding inside it. */
    const h = 0.062 + rand() * 0.052;
    s.set(0.72 + rand() * 0.55, h, 1);
    m4.compose(pt, q, s);
    im.setMatrixAt(n, m4);
    /* Colour variation is the difference between a lawn and a green carpet.
       Authored in the renderer's working (linear) space, so these are much
       darker as swatches than the numbers suggest. */
    const t = fbm(x * 0.7, z * 0.7, 2);
    col.setHSL(0.232 + t * 0.034, 0.30 + rand() * 0.14, 0.090 + t * 0.055 + rand() * 0.024);
    im.setColorAt(n, col);
    n++;
  }
  im.count = n;
  return im;
}

layerGroups.surface.add(sow(Math.round(Q.grass * 0.80), (x, z) => !inNotch(x, z)));
backfill.add(sow(Math.round(Q.grass * 0.20), inNotch));

/* -- hardscape: a paved path and a small terrace ---------------------------
   Enough constructed landscape to prove this is a built garden, not a field.
   Anything more competes with the strata for attention.

   These were the most placeholder-like objects in the piece: scaled copies
   of one unit box, laid ON the grass with no edge, no thickness and no
   contact. They are now cut stone — a chamfered top arris, a real body below
   grade, per-slab dimensions and a seed baked into the vertices so a merged
   run still varies stone by stone. Everything still merges down to two draw
   calls.                                                                     */
const stoneMat = stoneMaterial(0xB0A78F, 0.70, true);
const bedMat = stoneMaterial(0x8A8271, 0.95, true);
const hardscape = new THREE.Group();
{
  disposables.push(stoneMat, bedMat);
  const tops = [], beds = [];

  /* The local grade over a footprint. A constructed plate is flat, so it has
     to be set from the HIGHEST point it covers — set from the average it
     hovers over one corner of an undulating lawn and sinks into another. */
  const crest = (cx, cz, hx, hz) => {
    let y = -9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      y = Math.max(y, BOUND[0](cx + i * hx * 0.92, cz + j * hz * 0.92));
    }
    return y;
  };

  /* proud: how far the finished surface stands above grade.
     deep:  how far the body continues below it — the embed that makes the
            slab part of the ground rather than an object resting on it. */
  const lay = (list, mat, cx, cz, hx, hz, proud, deep, ry, seed) => {
    const y = crest(cx, cz, hx, hz);
    const hy = (proud + deep) / 2;
    const g = paverGeometry(hx, hz, hy, Math.min(0.016, hy * 0.34), seed);
    if (ry) g.rotateY(ry);
    g.translate(cx, y + proud - hy, cz);
    list.push(g);
  };

  /* stepping-stone path, walking away from the viewer */
  PAVERS.forEach((p, i) => {
    lay(tops, stoneMat, p.x, p.z, p.hx, p.hz, 0.020 + p.dy, 0.115, p.ry, i * 0.37 + 0.11);
    /* the bedding course under each slab — a coarser, duller stone, and the
       only reason the path does not look like six tiles floating on soil
       once the section comes apart */
    lay(beds, bedMat, p.x, p.z, p.hx + 0.055, p.hz + 0.055, -0.100, 0.135, p.ry, i * 0.91);
  });

  /* THE TERRACE.
     Large-format pavers on a joint grid, not one plate: three by two, laid
     with a real joint, on a bedding course that oversails them all round.
     It occupies a small part of the frame and still has to look designed. */
  const JT = 0.022;                                   // joint width
  const cx = (TERRACE.hx * 2 - 2 * JT) / 3 / 2;
  const cz = (TERRACE.hz * 2 - JT) / 2 / 2;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const px = TERRACE.x + (i - 1) * (cx * 2 + JT);
      const pz = TERRACE.z + (j - 0.5) * (cz * 2 + JT);
      /* a hair of differential settlement across the field, so the joints
         catch the light instead of vanishing */
      lay(tops, stoneMat, px, pz, cx, cz, 0.046 + (i - 1) * 0.0035 + (j - 0.5) * 0.004,
          0.085, 0, 7.3 + i * 1.7 + j * 4.1);
    }
  }
  /* the bedding slab, oversailing on every side */
  lay(beds, bedMat, TERRACE.x, TERRACE.z, TERRACE.hx + 0.06, TERRACE.hz + 0.06, -0.020, 0.175, 0, 3.3);

  const put = (list, mat) => {
    const g = mergeGeoms(list);
    list.forEach(x => x.dispose());
    disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = Q.shadow > 0;
    m.receiveShadow = true;
    hardscape.add(m);
  };
  put(tops, stoneMat);
  put(beds, bedMat);
}
/* Everything constructed on the surface is carried in one group, so the
   TEREP state can sink it back into the ground and STRUKTÚRA can build it
   again — the same meshes, no swapped model, no second scene. */
const built = new THREE.Group();
built.add(hardscape);
layerGroups.surface.add(built);

/* -- irrigation ------------------------------------------------------------
   A conceptual system: source, main, four laterals, inline emitters, and a
   valve box at grade. It is not a copy of anyone's as-built drawing, and it
   does not claim to be.                                                     */
const pipes = new THREE.Group();
pipes.userData.ex = PIPE_EX;
core.add(pipes);

const pipeMat = pipeMaterial(0x211F1A, 0.52, true);
const dripMat = pipeMaterial(0x2B2721, 0.62);
const brassMat = new THREE.MeshStandardMaterial({ color: 0x6E6252, roughness: 0.44, metalness: 0.55 });
const waterMat = waterMaterial();
disposables.push(pipeMat, dripMat, brassMat, waterMat);

const netCurves = [];       // { curve, t0, t1, r } — shared by pipe and water
{
  const cp = (x, y, z) => new THREE.Vector3(x, y, z);

  /* main line: from the valve box on the left, running the width of the plot */
  const main = new THREE.CatmullRomCurve3([
    cp(-W / 2 + 0.30, PIPE_Y + 0.30, -D / 2 + 0.95),
    cp(-3.55, PIPE_Y + 0.04, -1.62),
    cp(-1.20, PIPE_Y - 0.05, -1.55),
    cp(1.40, PIPE_Y + 0.03, -1.68),
    cp(3.62, PIPE_Y - 0.02, -1.58)
  ], false, 'catmullrom', 0.4);
  netCurves.push({ curve: main, t0: 0.0, t1: 0.34, r: 0.078 });

  /* four laterals stepping forward into the root zone */
  LATERAL_X.forEach((x, i) => {
    const c = new THREE.CatmullRomCurve3([
      cp(x, PIPE_Y + 0.02, -1.60),
      cp(x + 0.16, PIPE_Y - 0.04, -0.55),
      cp(x - 0.12, PIPE_Y + 0.05, 0.62),
      cp(x + 0.10, PIPE_Y - 0.02, 1.72),
      cp(x - 0.05, PIPE_Y + 0.02, D / 2 - 0.55)
    ], false, 'catmullrom', 0.4);
    netCurves.push({ curve: c, t0: 0.34 + i * 0.012, t1: 0.94 + i * 0.014, r: 0.052 });
  });

  const pipeGeos = [], waterGeos = [];
  for (const n of netCurves) {
    pipeGeos.push(tube(n.curve, n.r, 1, Q.tubSeg * 2, Q.radSeg + 2, n.t0, n.t1));
    waterGeos.push(tube(n.curve, n.r * 1.32, 1, Q.tubSeg * 2, Q.radSeg + 2, n.t0, n.t1));
  }
  const pg = mergeGeoms(pipeGeos);
  const wg = mergeGeoms(waterGeos);
  pipeGeos.forEach(g => g.dispose());
  waterGeos.forEach(g => g.dispose());
  disposables.push(pg, wg);

  const pipeMesh = new THREE.Mesh(pg, pipeMat);
  pipeMesh.castShadow = false;
  pipes.add(pipeMesh);

  const waterMesh = new THREE.Mesh(wg, waterMat);
  waterMesh.renderOrder = 4;
  pipes.add(waterMesh);

  /* inline drip emitters at the six wetted points */
  const emitGeo = new THREE.CylinderGeometry(0.072, 0.072, 0.10, 10);
  disposables.push(emitGeo);
  for (const e of EMIT) {
    const m = new THREE.Mesh(emitGeo, dripMat);
    m.position.copy(e);
    m.rotation.z = Math.PI / 2;
    pipes.add(m);
  }

  /* valve box at grade — the one piece of visible plant on the surface */
  const box = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.62, 0.62), stoneMaterial(0x4A4B44, 0.86));
  shell.position.set(-W / 2 + 0.86, -0.28, -D / 2 + 0.95);
  shell.castShadow = Q.shadow > 0;
  shell.receiveShadow = true;
  box.add(shell);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.90, 0.05, 0.66), stoneMaterial(0x2F312B, 0.70));
  lid.position.set(-W / 2 + 0.86, 0.03, -D / 2 + 0.95);
  lid.castShadow = Q.shadow > 0;
  box.add(lid);
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.55, 8), brassMat);
  riser.position.set(-W / 2 + 0.62, -0.25, -D / 2 + 0.95);
  box.add(riser);
  built.add(box);
}

/* -- drainage -------------------------------------------------------------- */
{
  const dp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.20, 0.20, W - 0.5, tier === 'low' ? 10 : 16, 1, true),
    pipeMaterial(0x35322A, 0.74)
  );
  dp.rotation.z = Math.PI / 2;
  dp.position.set(0, DRAIN_Y, 0.55);
  layerGroups.drain.add(dp);

  /* Loose aggregate resting on the drainage course. Invisible until the
     section explodes, at which point it is the detail that proves the layer
     is stone and not a brown rectangle. */
  const peb = new THREE.IcosahedronGeometry(0.085, 0);
  const pebMat = stoneMaterial(0x7B7264, 0.90);
  disposables.push(peb, pebMat);
  const gravelIM = new THREE.InstancedMesh(peb, pebMat, Q.gravel);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < Q.gravel; i++) {
    const x = (rand() - 0.5) * (W - 0.5);
    const z = (rand() - 0.5) * (D - 0.5);
    p.set(x, BOUND[3](x, z) - 0.04 - rand() * 0.06, z);
    e.set(rand() * 3.14, rand() * 3.14, rand() * 3.14);
    q.setFromEuler(e);
    const sc = 0.6 + rand() * 0.8;
    s.set(sc, sc * (0.6 + rand() * 0.5), sc);
    m4.compose(p, q, s);
    gravelIM.setMatrixAt(i, m4);
  }
  gravelIM.castShadow = Q.shadow > 0;
  gravelIM.receiveShadow = true;
  layerGroups.drain.add(gravelIM);
}

/* -- roots ----------------------------------------------------------------- */
const rootMat = rootMaterial();
disposables.push(rootMat);
{
  const geos = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  for (let i = 0; i < Q.rootSys; i++) {
    let sx, sz, tries = 0;
    do {
      sx = (rand() - 0.5) * (W - 1.4);
      sz = (rand() - 0.5) * (D - 1.4);
      tries++;
      /* Only the paving is a true keep-out. The EXCAVATION deliberately is
         not: a system rooted just outside the trench sends its laterals
         straight through the cut face, and severed roots standing proud of a
         trench wall are the single most convincing thing in a photograph of
         an opened lawn. The old rule pushed every system away from the one
         place the visitor can actually see into. */
    } while (tries < 24 && (
      (paveSD(sx, sz) < 0.45) ||
      (sx > NOTCH.x0 && sz > NOTCH.z0)));

    const sy = BOUND[0](sx, sz) - 0.05;
    /* A real sward is not one plant repeated: some systems are established
       and deep, most are shallower. The spread of scales IS the hierarchy. */
    const vigour = 0.55 + rand() * 0.75;
    const reach = -2.20 - rand() * 0.95 * vigour;

    /* taproot — wanders, never a straight line */
    const pts = [V(sx, sy, sz)];
    const k = 5;
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      pts.push(V(
        sx + (rand() - 0.5) * 1.05 * t,
        sy + (reach - sy) * t,
        sz + (rand() - 0.5) * 1.05 * t
      ));
    }
    const trunk = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.45);
    geos.push(tube(trunk, (0.026 + rand() * 0.016) * vigour, 0.22, Q.tubSeg, Q.radSeg, 0, 0.62));

    /* laterals, biased into the irrigated band */
    const nb = 2 + Math.floor(rand() * 3);
    for (let b = 0; b < nb; b++) {
      const t0 = 0.20 + rand() * 0.55;
      const o = trunk.getPointAt(t0);
      const dir = rand() * Math.PI * 2;
      const len = (0.55 + rand() * 0.95) * vigour;
      const bp = [o.clone()];
      for (let j = 1; j <= 3; j++) {
        const t = j / 3;
        bp.push(V(
          o.x + Math.cos(dir) * len * t + (rand() - 0.5) * 0.30,
          o.y - (0.18 + rand() * 0.55) * t,
          o.z + Math.sin(dir) * len * t + (rand() - 0.5) * 0.30
        ));
      }
      const bc = new THREE.CatmullRomCurve3(bp, false, 'catmullrom', 0.45);
      const bt0 = t0 * 0.62 + 0.06;
      geos.push(tube(bc, (0.013 + rand() * 0.009) * vigour, 0.14,
        Math.max(8, Q.tubSeg - 8), Math.max(3, Q.radSeg - 1), bt0, 1.0));

      /* THIRD ORDER. Two or three fine roots off each lateral, at a third of
         its diameter. Without them the system is a trunk and some branches —
         a diagram of a root rather than a root — and the sward reads as
         spaghetti because every strand is the same weight. They are the
         cheapest tubes in the scene and they carry the whole hierarchy. */
      if (tier === 'low') continue;
      const nf = 2 + Math.floor(rand() * 2);
      for (let f = 0; f < nf; f++) {
        const ft = 0.35 + rand() * 0.55;
        const fo = bc.getPointAt(ft);
        const fdir = dir + (rand() - 0.5) * 2.2;
        const flen = (0.20 + rand() * 0.34) * vigour;
        const fp = [fo.clone()];
        for (let j = 1; j <= 2; j++) {
          const t = j / 2;
          fp.push(V(
            fo.x + Math.cos(fdir) * flen * t + (rand() - 0.5) * 0.16,
            fo.y - (0.10 + rand() * 0.30) * t,
            fo.z + Math.sin(fdir) * flen * t + (rand() - 0.5) * 0.16
          ));
        }
        const fc = new THREE.CatmullRomCurve3(fp, false, 'catmullrom', 0.4);
        geos.push(tube(fc, (0.005 + rand() * 0.004) * vigour, 0.10,
          8, 3, bt0 + (1 - bt0) * ft, 1.0));
      }
    }
  }

  const rg = mergeGeoms(geos);
  geos.forEach(g => g.dispose());
  disposables.push(rg);
  const roots = new THREE.Mesh(rg, rootMat);
  roots.renderOrder = 2;
  layerGroups.root.add(roots);
}

/* -- exploded-view assembly guides ----------------------------------------
   Four vertical axes at the corners plus a set of measurement ticks. These
   are what turn "floating rectangles" into "architectural exploded drawing",
   so they fade in with the explosion and are invisible otherwise.          */
const guides = new THREE.Group();
const guideMat = new THREE.LineBasicMaterial({
  color: 0xE8E5DA, transparent: true, opacity: 0, depthWrite: false
});
disposables.push(guideMat);
{
  const pts = [];
  const corners = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
  for (const [x, z] of corners) {
    /* dashed by construction — short segments with gaps, no extra material */
    for (let y = 4.6; y > -9.6; y -= 0.42) {
      pts.push(x, y, z, x, y - 0.20, z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  disposables.push(g);
  guides.add(new THREE.LineSegments(g, guideMat));
  core.add(guides);
}

/* ==========================================================================
   06 — LIGHTING
   --------------------------------------------------------------------------
   One key, one warm rim, one hemisphere fill, plus a cool subsurface bounce
   that only exists once the camera is below grade. Every intensity is on the
   timeline, because the light IS the transition between chapters.
   ========================================================================== */

const key = new THREE.DirectionalLight(0xFFF3E2, 2.6);
key.position.set(7.5, 11.0, 8.0);
if (Q.shadow) {
  key.castShadow = true;
  key.shadow.mapSize.set(Q.shadow, Q.shadow);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.022;
}
scene.add(key);

const rim = new THREE.DirectionalLight(0xC98A55, 1.05);
rim.position.set(-8.5, 2.4, -7.0);
scene.add(rim);

const hemi = new THREE.HemisphereLight(0x7C8B96, 0x2E2118, 0.78);
scene.add(hemi);

/* THE SECTION LIGHT.
   The cut faces are the subject of this entire piece, and they are all
   near-vertical. A key placed high enough to model the surface leaves them at
   a grazing angle, so the strata collapse into one dark mass and the block
   reads as a silhouette. This is the soft frontal fill every architectural
   section drawing has: placed close to the camera axis, low intensity, no
   shadow — its only job is to make the layers legible. */
const sect = new THREE.DirectionalLight(0xF2E4CE, 1.55);
sect.position.set(4.0, 2.2, 13.0);
scene.add(sect);

/* Sits inside the trench. Below grade the only credible light is what falls
   into the opening, and putting the source there means the excavation reads
   as the source of the light rather than a black hole in the model. */
const sub = new THREE.PointLight(0x9DB2BC, 0.0, 20, 2);
sub.position.set(3.1, -0.4, 2.4);
scene.add(sub);

const fillWarm = new THREE.PointLight(0xE0A468, 0.0, 20, 2);
fillWarm.position.set(3.0, 1.6, 4.2);
scene.add(fillWarm);

/* THE TRENCH FLOOR BOUNCE.
   Raising the ambient to make the excavation readable flattens the whole
   model — the underground has to stay darker than the surface or crossing
   grade means nothing. So the light is SHAPED instead: this one sits low in
   the trench, close to the drainage course, and its falloff does the work.
   It lifts the base of the cut walls and the aggregate they stand on, and
   reaches almost nothing else. */
const trench = new THREE.PointLight(0x8FA0A8, 0.0, 9.5, 2);
trench.position.set(2.55, -3.30, 2.35);
scene.add(trench);

/* THE UNDERSIDE BOUNCE.
   Every stratum's soffit faces straight down, and in a scene lit entirely
   from above that means five black rectangles hanging in the frame the
   moment the section separates. That single fact was most of why the
   exploded view read as "five slabs moving apart" rather than as a drawing:
   the parts had no thickness, because you could not see the bottom of any of
   them. This is the light bouncing back off the ground the model is standing
   on, and it exists only while the section is open. */
const under = new THREE.DirectionalLight(0x93A0AA, 0.0);
under.position.set(-3.0, -14.0, 6.0);
scene.add(under);

/* THE LIP.
   One narrow warm source just above the excavation's inside corner. Without
   it the cut edge — the single most important line in the whole model, the
   one that says "this ground has been opened" — dissolves into the wall
   behind it at every camera angle below grade. */
const lip = new THREE.PointLight(0xE8C08A, 0.0, 4.6, 2);
lip.position.set(1.55, 0.22, 0.55);
scene.add(lip);

/* ==========================================================================
   07 — RENDERER + CAMERA
   ========================================================================== */

/* -- the two failure flags -------------------------------------------------
   Declared here, above the renderer, because fail() can be called by the
   constructor's own catch — and a `let` read from inside its temporal dead
   zone throws a second error on top of the first.               [PHASE 3.2]

     dead  the stacked layout has taken over. Permanent, never retried.
     lost  the GL context is gone but may still come back. Nothing may be
           drawn, but the pinned layout stays exactly as it is.            */
let dead = false, lost = false, restoreT = 0;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: Q.aa, alpha: true, powerPreference: 'high-performance',
    stencil: false, depth: true
  });
} catch (err) {
  /* The head probe said WebGL was available and the constructor disagreed —
     a driver blocklist, an exhausted context pool, a GPU process that died
     between the two. The page has a complete layout for exactly this, so the
     only thing left to do is hand over to it. Rethrowing here used to put an
     uncaught error on a page that was, at that moment, working: the fallback
     was already up.                                             [PHASE 3.2] */
  console.warn('[rk] WebGL renderer unavailable — using the stacked layout.', err);
  fail();
  return;
}
/* A constructor that returns without a context is the same failure wearing a
   different coat. This used to fall through and call setClearColor on it. */
if (!renderer || !renderer.getContext()) {
  console.warn('[rk] WebGL context could not be created — using the stacked layout.');
  fail();
  return;
}

renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
if (Q.shadow) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

const camera = new THREE.PerspectiveCamera(27, 1, 0.5, 90);
scene.add(camera);

function fail() {
  if (dead) return;                       // one handover, never a retry loop
  dead = true;
  /* Dropping .gd-on collapses the pinned stage and with it the ~7½ viewports
     of scroll that .gd__scroll contributes. At init that is free — nobody has
     scrolled yet. After a context loss halfway down the narrative it is not:
     the visitor would be thrown into a different part of the page, or clamped
     to its new end, by an event that has nothing to do with them. So the
     shrinkage is measured and subtracted.                       [PHASE 3.2] */
  const before = section.getBoundingClientRect();
  const inOrPast = before.top < 0;
  root.classList.remove('gd-on');
  root.classList.add('gd-off');
  if (inOrPast) {
    const delta = before.height - section.getBoundingClientRect().height;
    if (delta > 0) {
      /* html{scroll-behavior:smooth} would otherwise animate a correction
         that is meant to be invisible. */
      scrollTo({ top: Math.max(0, scrollY - delta), behavior: 'instant' });
    }
  }
}

/* ==========================================================================
   08 — THE TIMELINE
   --------------------------------------------------------------------------
   A single normalised progress p in [0,1] drives camera, target, layer
   separation, light, water, roots and DOM chapter activation. There is no
   second scroll observer anywhere in the experience.
   ========================================================================== */

/* Camera keyframes. pos/tgt are in world space; pan shifts the subject in
   SCREEN space (negative panX pushes the specimen to the right, which is how
   the hero keeps its left half free for the headline). */
const KEYS = [
  /*  p        camera position          look-at target        screen pan     */
  /* The hero's vertical framing is NOT authored here — the datum lock in
     apply() solves it against the headline. What is authored is the lateral
     push that keeps the block's near corner clear of the copy column, and a
     little more elevation than before, because the sward is now worth
     showing. */
  { p: 0.000, pos: [13.90,  5.30, 23.60], tgt: [ 0.0, -2.75,  0.0], pan: [-4.05, -0.10] },
  { p: 0.110, pos: [11.80,  2.05, 19.90], tgt: [ 0.0, -2.60,  0.0], pan: [-2.45,  0.00] },
  { p: 0.200, pos: [10.30, -0.70, 17.40], tgt: [ 0.0, -2.35,  0.0], pan: [-1.60,  0.20] },
  /* GROUND had the block bleeding off all four edges — no silhouette, and no
     obvious subject inside a wall of soil. Pulled back far enough to close
     the object's outline and pushed right so the copy owns a real column
     rather than a scrim over the model. */
  { p: 0.280, pos: [12.50, -2.30, 20.80], tgt: [-0.1, -2.55,  0.0], pan: [-1.35,  0.28] },
  { p: 0.380, pos: [11.40, -2.20, 19.30], tgt: [ 0.2, -2.30, -0.1], pan: [ 0.35,  0.18] },
  /* WATER — RECOMPOSED IN PHASE 2.2.
     The old framing put the emitter and its label on the right of the frame
     and the strongest wetted face away on the left, so cause and evidence
     were never in one glance. Two changes, both compositional:

       · pulled back about 18%, because the block used to bleed off three
         edges and there was no silhouette to read the trench against;
       · panned harder left, which parks the excavation — the labelled
         emitter, the lateral running out of it, and the cut wall 0.20m from
         the x=1.15 dripline that carries the wetted lens — inside the left
         two thirds, and hands the right third to the copy column instead of
         making the copy sit on soil.

     The lens the visitor is asked to look at is now BEHIND the thing the
     leader line points at, in the same third of the frame. */
  { p: 0.470, pos: [12.10,  0.90, 18.80], tgt: [ 1.5, -2.35,  0.8], pan: [ 2.55,  0.24] },
  { p: 0.550, pos: [10.10,  2.35, 15.90], tgt: [ 2.3, -2.45,  1.7], pan: [ 2.30,  0.06] },
  { p: 0.630, pos: [10.80, -2.20, 19.60], tgt: [ 0.0, -2.10, -0.1], pan: [ 0.10,  0.00] },
  /* The exploded section is the one shot that wants a drawing's angle rather
     than a photograph's: lifted enough that every stratum shows its top face
     AND its thickness, which is how an assembly drawing proves the parts are
     solids. Held flat-on, as it was, they read as five cards. */
  { p: 0.700, pos: [15.40,  5.40, 26.20], tgt: [ 0.0, -2.35,  0.0], pan: [-2.70,  0.05] },
  { p: 0.760, pos: [13.60,  3.60, 23.40], tgt: [ 0.0, -2.20,  0.0], pan: [-2.20,  0.05] },
  { p: 0.840, pos: [11.20,  2.40, 19.20], tgt: [ 0.0, -2.20,  0.0], pan: [-1.60,  0.25] },
  { p: 0.900, pos: [ 9.60,  4.60, 16.20], tgt: [ 0.0, -1.90,  0.0], pan: [-1.30,  0.25] },
  /* THE HANDOVER FRAME.
     Not a plan view any more. The photograph the render dissolves into was
     taken standing on a lawn looking down across it at about forty degrees,
     with paving running out to one side — so the last camera stands in the
     same place. A plan view clipped more neatly to the top face, but a neat
     clip is not the point: the point is the half second in which the visitor
     cannot tell which of the two they are looking at, and that only happens
     if the two frames were shot from the same position. */
  { p: 0.955, pos: [ 2.20,  9.00, 12.60], tgt: [ 0.2, -0.60, -0.2], pan: [ 0.00,  0.00] },
  { p: 1.000, pos: [ 0.70,  6.90,  9.00], tgt: [ 0.3,  0.05, -0.6], pan: [ 0.00,  0.00] }
];

/* A centripetal Catmull-Rom through the keyframes gives C1-continuous camera
   motion with no cusps and no overshoot — uniform parameterisation swings
   wide when the keyframes are unevenly spaced, which they are. The p values
   are mapped into curve space separately, so the authored timing survives. */
const camCurve = new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...k.pos)), false, 'centripetal');
const tgtCurve = new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...k.tgt)), false, 'centripetal');

function toCurveU(p) {
  const n = KEYS.length - 1;
  for (let i = 0; i < n; i++) {
    if (p <= KEYS[i + 1].p || i === n - 1) {
      const span = KEYS[i + 1].p - KEYS[i].p;
      const local = span > 0 ? (p - KEYS[i].p) / span : 0;
      return (i + Math.min(Math.max(local, 0), 1)) / n;
    }
  }
  return 1;
}

function lerpKeyPan(p, out) {
  const n = KEYS.length - 1;
  for (let i = 0; i < n; i++) {
    if (p <= KEYS[i + 1].p || i === n - 1) {
      const span = KEYS[i + 1].p - KEYS[i].p;
      const t = span > 0 ? Math.min(Math.max((p - KEYS[i].p) / span, 0), 1) : 0;
      const e = t * t * (3 - 2 * t);
      out.x = KEYS[i].pan[0] + (KEYS[i + 1].pan[0] - KEYS[i].pan[0]) * e;
      out.y = KEYS[i].pan[1] + (KEYS[i + 1].pan[1] - KEYS[i].pan[1]) * e;
      return out;
    }
  }
  return out.set(0, 0);
}

/* Scalar tracks — plain keyframed values, smoothstepped between stops. */
function track(stops) {
  return (p) => {
    for (let i = 0; i < stops.length - 1; i++) {
      const [pa, va] = stops[i], [pb, vb] = stops[i + 1];
      if (p <= pb || i === stops.length - 2) {
        const t = pb > pa ? Math.min(Math.max((p - pa) / (pb - pa), 0), 1) : 0;
        const e = t * t * (3 - 2 * t);
        return va + (vb - va) * e;
      }
    }
    return stops[stops.length - 1][1];
  };
}

/* Every stop below is quoted against a chapter boundary in index.html. If a
   chapter is retimed there, its stops move here — that pairing is the whole
   contract between the copy and the scene. */
const T = {
  /* STRUCTURE (.650–.768): the section comes apart, then reassembles */
  explode:  track([[0, 0], [0.600, 0], [0.700, 1], [0.752, 1], [0.782, 0], [1, 0]]),
  /* The WATER close-up window (see apply()). Opens after GROUND's copy has
     gone (.396) and shuts before STRUCTURE's arrives (.650), so the two
     chapters either side of it are solved exactly as they were. The ramps
     are wide — 52 and 46 thousandths, roughly a second and a half of
     reading each — because a dolly that snaps on reads as a zoom, and a
     dolly that eases on reads as the camera moving in to look. */
  waterIn:  track([[0, 0], [0.400, 0], [0.452, 1], [0.578, 1], [0.624, 0], [1, 0]]),
  /* WATER (.424–.584) charges the network; VÍZ (.812–.840) charges it again */
  flow:     track([[0, 0], [0.418, 0], [0.452, 1], [0.578, 1], [0.612, 0],
                   [0.802, 0], [0.818, 0.90], [0.848, 0.25], [1, 0.18]]),
  /* The wetting used to be complete BEFORE the charge reached the emitters —
     the soil went dark and then the water arrived. It now follows the head:
     the pulse hits the last emitter at ~.532 and the bulb opens over the
     next thirty thousandths, which at reading speed is about a second. */
  moist:    track([[0, 0], [0.526, 0], [0.560, 1], [0.616, 0.90], [0.700, 0.30],
                   [0.792, 0.10], [0.836, 0.62], [0.892, 0.46], [1, 0.40]]),
  /* roots are present from GROUND, stripped for TEREP, fully grown at NÖVÉNYZET */
  grow:     track([[0, 0.52], [0.290, 0.74], [0.500, 0.88], [0.640, 0.88],
                   [0.792, 0.16], [0.864, 0.16], [0.898, 1], [1, 1]]),
  rootFade: track([[0, 0.88], [0.290, 1], [0.664, 1], [0.706, 0.10], [0.756, 0.10], [0.788, 1], [1, 1]]),
  /* TEREP (.782–.812): the surface is stripped back to graded soil */
  raw:      track([[0, 0], [0.778, 0], [0.794, 1], [0.852, 1], [0.878, 0], [1, 0]]),
  veg:      track([[0, 1], [0.778, 1], [0.794, 0], [0.862, 0], [0.898, 1], [1, 1]]),
  /* STRUKTÚRA (.840–.866): paving, terrace and valve box are rebuilt */
  struct:   track([[0, 1], [0.778, 1], [0.792, 0], [0.838, 0], [0.862, 1], [1, 1]]),
  /* ...and the trench is backfilled, so the finished garden hands over to the
     photograph as unbroken ground rather than an open excavation. */
  fill:     track([[0, 0], [0.838, 0], [0.868, 1], [1, 1]]),
  /* KÉSZ KERT (.892–.922): the grade warms up */
  warm:     track([[0, 0], [0.874, 0], [0.906, 1], [1, 1]]),
  /* light: bright above grade, cool and low below it, warm again at the end */
  lKey:     track([[0, 2.6], [0.200, 2.1], [0.300, 0.85], [0.550, 0.70], [0.664, 1.35],
                   [0.790, 1.9], [0.906, 2.9], [1, 3.2]]),
  lSect:    track([[0, 1.55], [0.280, 1.75], [0.550, 1.60], [0.700, 1.45], [0.906, 1.20], [1, 1.05]]),
  lRim:     track([[0, 1.05], [0.280, 0.55], [0.500, 0.42], [0.700, 0.85], [0.900, 1.25], [1, 1.10]]),
  lHemi:    track([[0, 0.78], [0.300, 0.40], [0.550, 0.34], [0.720, 0.55], [1, 0.88]]),
  lSub:     track([[0, 0], [0.240, 0], [0.320, 1.55], [0.550, 1.90], [0.680, 1.10], [0.820, 0.35], [1, 0]]),
  lWarmPt:  track([[0, 0.25], [0.300, 0], [0.800, 0], [0.906, 1.15], [1, 1.40]]),
  /* The trench's own two lights. Both are off above grade and off again once
     the section comes apart — an excavation that is no longer holding the
     camera has no business being the brightest thing in the frame. */
  lTrench:  track([[0, 0], [0.250, 0], [0.340, 1.30], [0.470, 2.30], [0.578, 2.60],
                   [0.660, 1.20], [0.760, 0.45], [0.840, 0.30], [1, 0]]),
  lLip:     track([[0, 0], [0.230, 0], [0.320, 0.55], [0.470, 0.95], [0.578, 1.05],
                   [0.680, 0.60], [0.780, 0], [1, 0]]),
  /* the specimen turns very slightly through the piece — never orbits */
  spin:     track([[0, -0.16], [0.280, -0.06], [0.550, 0.10], [0.700, 0.02], [0.900, -0.05], [1, 0]]),
  /* the render hands over to the photograph. Held at full much later than
     before: the plate is graded to match, so the render should stay crisp
     underneath it rather than dissolving out from under a growing photo. */
  reveal:   track([[0, 1], [0.972, 1], [0.996, 0.15], [1, 0]]),
  /* THE PAGE ANSWERS THE CAMERA.
     0 above grade, 1 below it. The DOM background carries a warm pool behind
     the specimen while the camera is in the open and a cold, low one once it
     is underground, so crossing grade changes the whole frame and not just
     the part of it that is WebGL. Without this the canvas is an asset
     floating in front of an unrelated page. */
  bg:       track([[0, 0], [0.130, 0], [0.300, 1], [0.660, 1], [0.860, 0.30],
                   [0.930, 0], [1, 0]]),
  /* the horizon rule belongs to the two chapters above grade */
  horizon:  track([[0, 1], [0.170, 1], [0.240, 0], [1, 0]]),
  /* THE HANDOVER OVERLAY.
     Phase 2.2 overlaps the projects section over this one by a viewport, so
     that for one viewport of scroll the SAME photograph is on screen twice —
     once here and once as the first plate of the field — and the join
     disappears. Two identical pictures only look identical if what is laid
     over them is identical too, and this frame carries three things the
     plate below does not: a vertical vignette on the photo, a vertical
     scrim on the stage, and a bottom band. Read against a copy that is
     scrolled 400px away, every one of those is a horizontal step across the
     picture. So over the last chapter they all resolve to a FLAT wash, which
     is what the plate underneath opens with. */
  out:      track([[0, 0], [0.930, 0], [0.986, 1], [1, 1]])
};

/* ==========================================================================
   08.5 — PACING
   --------------------------------------------------------------------------
   SCROLL TIME IS NOT SCENE TIME.

   Everything above — the camera keys, every track, every chapter's data-from
   in index.html, the reduced-motion stops — is authored in SCENE time, and
   that authoring is correct: the scene states are right, and retiming forty
   tuned stop values by hand to fix pacing is how a working sequence gets
   broken.

   What was wrong was the SHARE OF SCROLL each of those scene segments was
   given. LAND -> LIFE ran five complete transformations of the object in
   0.028 of the timeline each, while six quiet beats between chapters — where
   nothing happens but a camera move — held 0.181 of it between them, and the
   REALITY handover, which is the hinge of the whole page, had 0.056.

   So the fix is a monotone map from scroll to scene, and NOTHING else moves.
   The beats are compressed by roughly half, GROUND / WATER / STRUCTURE give
   up about 15% each, and that budget is spent where the object is actually
   being built: the five construction steps get ~75% more scroll apiece and
   the handover gets 2.2x. The page does not get longer.

   Fritsch-Carlson monotone cubic rather than straight line segments: a
   piecewise-linear map has a velocity step at every knot, and a velocity step
   in the middle of a continuous camera move reads as a gear change.
   ========================================================================== */
const WARP = [
  /* scroll   scene        what the segment is                              */
  [0.000,   0.000],   /* SURFACE                                            */
  [0.100,   0.105],   /* beat                                               */
  [0.112,   0.128],   /* DESCENT                                            */
  [0.172,   0.212],   /* beat                                               */
  [0.186,   0.240],   /* GROUND                                             */
  [0.316,   0.396],   /* beat                                               */
  [0.330,   0.424],   /* WATER                                              */
  [0.470,   0.584],   /* beat                                               */
  [0.500,   0.650],   /* STRUCTURE                                          */
  [0.600,   0.768],   /* beat                                               */
  [0.610,   0.782],   /* TEREP                                              */
  [0.662,   0.812],   /* VÍZ                                                */
  [0.712,   0.840],   /* STRUKTÚRA                                          */
  [0.760,   0.866],   /* NÖVÉNYZET                                          */
  [0.808,   0.892],   /* KÉSZ KERT                                          */
  [0.860,   0.922],   /* beat                                               */
  [0.876,   0.944],   /* REALITY — the handover into the projects field     */
  [1.000,   1.000]
];
const WS = WARP.map(k => k[0]);
const WV = WARP.map(k => k[1]);
const WM = (() => {
  const n = WS.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (WV[i + 1] - WV[i]) / (WS[i + 1] - WS[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] + d[i]) * 0.5;
  /* The limiter is what guarantees the curve cannot overshoot and run
     BACKWARDS between two knots — a scroll that briefly rewinds the scene is
     the one failure mode this map must not have. */
  for (let i = 0; i < n - 1; i++) {
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
})();

function warp(s) {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  let i = 0;
  while (i < WS.length - 2 && s > WS[i + 1]) i++;
  const h = WS[i + 1] - WS[i], t = (s - WS[i]) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * WV[i]
       + (t3 - 2 * t2 + t) * h * WM[i]
       + (-2 * t3 + 3 * t2) * WV[i + 1]
       + (t3 - t2) * h * WM[i + 1];
}

/* Water head travel. Two passes: one deliberate sweep through the WATER
   chapter (main line, then branches, then the emitters), and a slower
   recirculation once the finished garden is running. */
function pulseAt(p, t) {
  if (p >= 0.428 && p <= 0.616) {
    /* The charge runs the network over the first two thirds of the chapter
       and then STAYS at the far end, so the remaining third is the soil
       responding rather than the pipe still filling. Cause, then effect. */
    return Math.min((p - 0.428) / 0.117, 1) * 1.06;
  }
  if (p > 0.802) return (t * 0.115) % 1.30;
  return -1;
}

/* ==========================================================================
   09 — LAYOUT (desktop / tablet / mobile)
   --------------------------------------------------------------------------
   The narrative is identical everywhere. Only the framing changes: on narrow
   screens the camera pulls back and the specimen is pushed into the upper
   half so the copy owns the lower half.
   ========================================================================== */

const layout = { dist: 1, panX: 1, panY: 0, fov: 27, elev: 0, tight: 0, banded: 0 };

function measureLayout() {
  frameLayout();
  /* AERIAL PERSPECTIVE IS RELATIVE, NOT ABSOLUTE.
     The fog is an exponential function of distance from the camera, and a
     portrait viewport pulls the camera back by up to 2.45x to fit the block
     — at which point the fog was eating half the specimen and the phone hero
     rendered as a grey ghost of itself. Dividing the density by the framing
     distance keeps the same amount of depth cue ACROSS the object on every
     viewport, which is the only thing the fog was ever there to do. */
  scene.fog.density = 0.0125 / layout.dist;
}

function frameLayout() {
  const w = innerWidth, h = innerHeight;
  const ar = Math.max(w / h, 0.30);

  /* IS THE COPY A BAND UNDER THE MODEL?                         [PHASE 3.1]
     True for the stacked portrait layout rk.css opens below 860 — and false
     in landscape, where §31.85 gives the copy a column beside the specimen
     and there is lateral room for a label again. 1.4 is 7/5, the same ratio
     that rule is written against. This gates the annotation floor. */
  layout.banded = (w < 1024 && ar < 1.4) ? 1 : 0;

  if (w >= 1024) {
    layout.dist = 1.0; layout.panX = 1; layout.panY = 0; layout.fov = 27; layout.elev = 0;
    layout.tight = 0;
    if (ar > 2.1) layout.dist *= 0.94;          // ultrawide
    if (ar < 1.05) layout.dist *= 1.14;         // portrait desktop / split screen
    return;
  }

  /* Below 1024 the viewport is portrait, often steeply so, and a fixed
     multiplier per breakpoint does not survive that: the framing that fits a
     9-unit-wide block at 375x812 leaves it stranded and tiny at 577x757.

     So the framing is DERIVED instead. Solve for the distance at which the
     block occupies a fixed share of the width, lift the subject by a fixed
     share of the height so the copy band below it stays clear, and add
     elevation in proportion to how portrait the viewport is — pulled back on
     a long lens the top face foreshortens to a sliver and the specimen stops
     reading as a solid. */
  const NEED = 11.8;                    // world units of width the block claims
  const BASE = 27.2;                    // the hero keyframe's own distance
  layout.fov = ar < 0.62 ? 30 : 29;
  const halfTan = Math.tan((layout.fov * Math.PI) / 360);

  layout.dist = Math.min(Math.max(NEED / (2 * halfTan * ar * BASE), 0.95), 2.45);
  layout.panX = w < 700 ? 0 : 0.45;

  const visibleH = NEED / ar;           // world units of height on screen
  layout.panY = -(w < 700 ? 0.245 : 0.185) * visibleH;
  /* Less elevation than the old value. Looking further down foreshortens the
     cut faces, and on a phone the section IS the subject — there is no room
     to show both it and a wide top surface. */
  layout.elev = Math.min(3.0 / ar - 0.6, 7);

  /* HOW STARVED IS THIS FRAME, 0..1.                            [PHASE 3.1]
     Quoted against layout.dist — how far back the solver above actually had
     to stand to fit the block's width — rather than against aspect ratio
     directly. The first version of this used the ratio, and gave a 768x1024
     tablet four fifths of a correction calibrated for a 390x844 phone. Seen
     at that size it was plainly wrong: WATER lost its silhouette and its
     grade reference completely and became a wall of soil with a pipe in it.

     Distance is the honest variable. The dead air and the shrunken emitter
     this corrects are both consequences of standing back, so the correction
     should be a function of standing back:

         390x844  dist 1.75 -> 1.00      320x568  dist 1.44 -> 1.00
         768x1024 dist 1.12 -> 0.00      844x390  dist 0.95 -> 0.00

     Tablet portrait is at the floor, which is the right answer: at 0.75 it
     is not a starved frame, and the brief for this phase is explicit that
     it wants an intermediate composition rather than the phone's rules. A
     600x900 tablet lands near 0.43 and gets a proportionate share. */
  layout.tight = Math.min(Math.max((layout.dist - 1.12) / 0.32, 0), 1);
}

/* ==========================================================================
   10 — ANNOTATIONS
   ========================================================================== */

const anno = document.getElementById('gdAnno');
const annoSvg = document.getElementById('gdLines');
const labels = anno ? Array.from(anno.querySelectorAll('[data-anchor]')) : [];

/* Anchors sit on the +x elevation and inside the excavation — the two
   surfaces the camera is looking at through the underground chapters. An
   anchor on a face the visitor cannot see produces a leader line that points
   into the middle of a solid block, which is worse than no label at all. */
const ANCHORS = {
  turf:    { p: [W / 2, -0.16, -1.20], layer: 'surface' },
  topsoil: { p: [W / 2, -1.00, -1.20], layer: 'topsoil' },
  rootzone:{ p: [W / 2, -2.35, -1.20], layer: 'root' },
  drain:   { p: [W / 2, -3.80, -1.20], layer: 'drain' },
  base:    { p: [W / 2, -5.40, -1.20], layer: 'base' },
  paving:  { p: [0.10, 0.06, 1.60], layer: 'surface' },
  /* in the trench */
  irrig:   { p: [3.40, PIPE_Y, 2.20], group: 'pipes' },
  emit:    { p: [3.05, PIPE_Y, 1.70], group: 'pipes' },
  main:    { p: [2.05, PIPE_Y, 0.48], group: 'pipes' },
  valve:   { p: [-W / 2 + 0.86, 0.05, -D / 2 + 0.95], layer: 'surface' }
};

for (const l of labels) {
  const a = ANCHORS[l.dataset.anchor];
  if (!a) continue;
  l.__v = new THREE.Vector3(...a.p);
  l.__a = a;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('class', 'gd-lead');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('class', 'gd-dot');
  dot.setAttribute('r', '2.5');
  if (annoSvg) { annoSvg.appendChild(line); annoSvg.appendChild(dot); }
  l.__line = line;
  l.__dot = dot;
  l.__on = false;
}

const _v = new THREE.Vector3();

/* ==========================================================================
   10.5 — THE SECTION DRAWING
   --------------------------------------------------------------------------
   What separates an exploded 3D model from an exploded architectural SECTION
   is not the geometry — it is the apparatus around it. A dimension string
   down one side, a tick at every stratum boundary, a datum line at grade,
   and a caption that says what kind of drawing this is.

   Every position here is projected from the REAL layer groups, so when the
   section eases apart the drawing eases apart with it and stays true. The
   ticks carry letters, not depths: quoting figures like "-0,45" would read
   as a Rapidkert construction specification, and this is a conceptual
   diagram of a layer order, which is exactly what the caption says.
   ========================================================================== */
const dimRule = document.createElementNS('http://www.w3.org/2000/svg', 'path');
const dimTicks = document.createElementNS('http://www.w3.org/2000/svg', 'path');
const datumRule = document.createElementNS('http://www.w3.org/2000/svg', 'path');
dimRule.setAttribute('class', 'gd-dim');
dimTicks.setAttribute('class', 'gd-dim gd-dim--tick');
datumRule.setAttribute('class', 'gd-datum-line');
if (annoSvg) { annoSvg.appendChild(dimRule); annoSvg.appendChild(dimTicks); annoSvg.appendChild(datumRule); }

const dimCap = document.getElementById('gdDimCap');
const dimDatum = document.getElementById('gdDimDatum');
const dimMarks = Array.from(document.querySelectorAll('#gdAnno .gd__mark'));

/* Near-left vertical edge of each stratum, top and bottom, in its own group
   space — the edge the dimension string is measured against. */
const DIM_AT = LAYERS.map(L => ({
  g: L.id,
  top: new THREE.Vector3(-W / 2, L.top, D / 2),
  bot: new THREE.Vector3(-W / 2, L.bot, D / 2)
}));

function updateSection(ex, w, h) {
  const on = ex > 0.02;
  if (!on) {
    if (dimRule.__on !== false) {
      dimRule.__on = false;
      [dimRule, dimTicks, datumRule].forEach(e => e.style.opacity = '0');
      if (dimCap) dimCap.style.opacity = '0';
      if (dimDatum) dimDatum.style.opacity = '0';
      dimMarks.forEach(m => m.style.opacity = '0');
    }
    return;
  }
  dimRule.__on = true;

  /* Project both ends of every stratum's near edge. */
  const ys = [], xs = [];
  for (const d of DIM_AT) {
    const g = layerGroups[d.g];
    g.updateWorldMatrix(true, false);
    for (const pt of [d.top, d.bot]) {
      _v.copy(pt).applyMatrix4(g.matrixWorld).project(camera);
      if (_v.z > 1) return;                       // behind the camera: bail
      xs.push((_v.x * 0.5 + 0.5) * w);
      ys.push((-_v.y * 0.5 + 0.5) * h);
    }
  }

  /* Tight against the object. The string used to stand well off the drawing,
     which on a left-aligned chapter put it straight through the body copy —
     an annotation system arguing with the paragraph it annotates. */
  const xL = Math.min(...xs);
  const x0 = Math.max(xL - (w < 860 ? 22 : 32), w < 860 ? 18 : 30);
  const yTop = Math.min(...ys), yBot = Math.max(...ys);
  const o = String(Math.min(1, ex * 1.4));

  /* The rule itself, with a closed tick at each end. */
  const arm = w < 860 ? 5 : 7;
  dimRule.setAttribute('d',
    `M ${(x0 - arm).toFixed(1)} ${yTop.toFixed(1)} L ${(x0 + arm).toFixed(1)} ${yTop.toFixed(1)} ` +
    `M ${x0.toFixed(1)} ${yTop.toFixed(1)} L ${x0.toFixed(1)} ${yBot.toFixed(1)} ` +
    `M ${(x0 - arm).toFixed(1)} ${yBot.toFixed(1)} L ${(x0 + arm).toFixed(1)} ${yBot.toFixed(1)}`);

  /* One tick per boundary, extended out to the stratum it belongs to. */
  let d = '';
  for (let i = 0; i < ys.length; i++) {
    d += `M ${x0.toFixed(1)} ${ys[i].toFixed(1)} L ${(xs[i] - 6).toFixed(1)} ${ys[i].toFixed(1)} `;
  }
  dimTicks.setAttribute('d', d);

  /* The datum is a LEVEL, not a part: it stays where grade is in the
     assembled object while the strata travel away from it. Reading it off
     the surface stratum instead sent it up with the lawn and straight
     through the site header. */
  core.updateWorldMatrix(true, false);
  _v.set(0, 0, D / 2).applyMatrix4(core.matrixWorld).project(camera);
  const dy = (-_v.y * 0.5 + 0.5) * h;
  /* Starts at the drawing, not at the page edge: run full bleed it crosses
     the chapter headline, and the annotation layer sits ABOVE the copy. */
  datumRule.setAttribute('d', `M ${x0.toFixed(1)} ${dy.toFixed(1)} L ${(w - 26).toFixed(1)} ${dy.toFixed(1)}`);

  [dimRule, dimTicks, datumRule].forEach(e => e.style.opacity = o);
  if (dimDatum) {
    /* At the far end of the datum, where the frame is empty — except on a
       phone, where the far end is under the stratum labels and the only
       clear space is back at the dimension string. */
    dimDatum.style.opacity = o;
    const dxp = w < 860 ? x0 + 2 : w - 26;
    dimDatum.style.transform = `translate3d(${dxp.toFixed(1)}px,${(dy - 10).toFixed(1)}px,0)`;
  }
  if (dimCap) {
    dimCap.style.opacity = o;
    /* Kept off the floor of the stage: on a short viewport the drawing's
       bottom tick can sit low enough that the caption's second line falls
       off the screen, which is worse than the caption riding a little high. */
    const cy = Math.min(yBot + 16, h - 52);
    dimCap.style.transform = `translate3d(${x0.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
  }
  /* The stratum letters ride the dimension string, one per part. */
  dimMarks.forEach((m, i) => {
    const yi = (ys[i * 2] + ys[i * 2 + 1]) * 0.5;
    m.style.opacity = o;
    m.style.transform = `translate3d(${(x0 - 13).toFixed(1)}px,${yi.toFixed(1)}px,0)`;
  });
}

function updateAnnotations(p, w, h) {
  const live = [];
  for (const l of labels) {
    const from = +l.dataset.from, to = +l.dataset.to;
    const on = p >= from && p <= to;
    const fade = on ? Math.min(
      (p - from) / Math.max((to - from) * 0.16, 0.004),
      (to - p) / Math.max((to - from) * 0.16, 0.004), 1) : 0;

    if (on !== l.__on) {
      l.classList.toggle('is-on', on);
      l.__line.classList.toggle('is-on', on);
      l.__dot.classList.toggle('is-on', on);
      l.__on = on;
      /* GHOST LABELS. The opacity below is written as an INLINE style, which
         outranks the stylesheet's opacity:0 — so a label that stops being
         current has to be zeroed explicitly. It was not, and the only thing
         hiding it was the fact that a slow scroll passes through the fade
         band and lands near zero on its own. Scroll fast, restore a scroll
         position, or jump the timeline, and the last frame inside the window
         could still be at 40% — which left GROUND's strata, WATER's pipes and
         EXPLODED's letters all on screen at once, over each other and over
         the headline. */
      if (!on) {
        l.style.opacity = '0';
        l.__line.style.opacity = '0';
        l.__dot.style.opacity = '0';
      }
    }
    if (!on) continue;

    const a = l.__a;
    const parent = a.group === 'pipes' ? pipes : (a.layer ? layerGroups[a.layer] : core);
    _v.copy(l.__v);
    parent.updateWorldMatrix(true, false);
    _v.applyMatrix4(parent.matrixWorld).project(camera);

    const sx = (_v.x * 0.5 + 0.5) * w;
    const sy = (-_v.y * 0.5 + 0.5) * h;
    /* Behind the camera, or projected off the stage — either way the leader
       line would run off to nowhere. */
    if (_v.z > 1 || sx < 4 || sx > w - 4 || sy < 4 || sy > h - 4) {
      l.style.opacity = '0'; l.__line.style.opacity = '0'; l.__dot.style.opacity = '0';
      continue;
    }

    /* The authored side is a preference, not a rule. On a narrow viewport an
       anchor on the +x elevation projects close to the right edge, and a
       right-hand label would run off the stage; it flips rather than
       disappears. */
    let side = l.dataset.side === 'right' ? 1 : -1;
    if (side === 1 && sx > w * 0.60) side = -1;
    else if (side === -1 && sx < w * 0.32) side = 1;

    /* data-off is NOT slack to be scaled down on a small screen. WATER's two
       anchors sit at the same depth and project within 38px of each other;
       -34 and +40 are what hold ZÓNA · OLDALÁG and CSEPEGTETŐ apart. Scaled
       to 0.55 for a phone they closed to 3px and the two labels printed over
       each other. The offsets stay authored; clearance is handled below. */
    const off = parseFloat(l.dataset.off || '0');
    const gap = w < 700 ? 46 : 108;
    const lx = sx + side * gap;
    let ly = sy + off;

    live.push({ l, lx, ly, sx, sy, side, fade, lh: l.offsetHeight || 22 });
  }

  /* THE LEADERS STOP AT THE COPY.                               [PHASE 3.1]
     Measured at 320x568 on WATER — and on the Phase 3 baseline too, so this
     is an old defect the close-up only made easier to see: the CSEPEGTETŐ
     label sat at y 254-276 with the chapter's eyebrow at 248-259 and the
     headline opening at 272. Three pieces of type in the same 28 pixels,
     one of them a leader line.

     On a narrow viewport the copy is a band across the foot of the stage
     rather than a column beside the model, so a label has no lateral escape
     the way it does on a desktop — it walks straight into the headline.

     Placement is a second pass rather than a nudge inside the first,
     because the two things being fixed pull in opposite directions and a
     per-label rule cannot see both. Resolving collisions in place pushed
     GROUND's 02 TERMŐTALAJ above its own 01 FELSZÍN — five labels that are
     a numbered list read top to bottom, inverted to clear a 1px overlap.

     Two ordered passes instead. Down first, in anchor order, which is the
     order the strata are numbered in. Then up from the bottom, each label
     yielding to the copy and then to the one below it — so only the labels
     that actually violate the floor move at all. Shifting the whole group
     by the worst offender's excess was the first attempt and it cost more
     than it fixed: at 320 it lifted EXPLODED's six letters 32px as a block
     to rescue F ALAP, and landed C ÖNTÖZÉS on the ±0,00 FELSZÍN datum
     caption, which had been clear. The DOTS never move in either pass, so
     every leader still points at the real thing. */
  if (layout.banded && live.length) {
    let bottom = -Infinity;
    for (const s of live) {
      if (s.ly < bottom + 6) s.ly = bottom + 6;
      bottom = s.ly + s.lh;
    }
    if (annoFloor < Infinity) {
      let ceil = annoFloor - 8;
      for (let i = live.length - 1; i >= 0; i--) {
        const s = live[i];
        if (s.ly + s.lh > ceil) s.ly = ceil - s.lh;
        ceil = s.ly - 6;
      }
    }
  }

  for (const s of live) {
    const { l, lx, sx, sy, side, fade, lh } = s;
    /* Pushed off the top of the stage, or pushed so far from its own anchor
       that the leader has stopped being a leader. Either way it is a line
       to nowhere, and the drawing is better without it — the deepest strata
       are the ones this drops, which is the same set §31.8 already lets
       descend into the scrim on a phone. */
    if (layout.banded && (s.ly < 6 || s.ly + lh > h - 4)) {
      l.style.opacity = '0'; l.__line.style.opacity = '0'; l.__dot.style.opacity = '0';
      continue;
    }
    const ly = s.ly;
    const o = String(Math.max(0, Math.min(1, fade)));
    l.style.opacity = o;
    l.__line.style.opacity = o;
    l.__dot.style.opacity = o;
    l.style.transform = `translate3d(${lx.toFixed(1)}px,${ly.toFixed(1)}px,0)`;
    l.style.setProperty('--side', side === 1 ? '0%' : '-100%');

    /* An architect's leader: a short horizontal shoulder off the label, then
       a straight run to the point being called out. */
    const shoulder = side * 22;
    l.__line.setAttribute('d',
      `M ${lx.toFixed(1)} ${ly.toFixed(1)} L ${(lx - shoulder).toFixed(1)} ${ly.toFixed(1)} L ${sx.toFixed(1)} ${sy.toFixed(1)}`);
    l.__dot.setAttribute('cx', sx.toFixed(1));
    l.__dot.setAttribute('cy', sy.toFixed(1));
  }
}

/* ==========================================================================
   11 — CHAPTERS + PHOTO HANDOVER
   ========================================================================== */

const chapters = Array.from(section.querySelectorAll('[data-ch]'));
/* Fade width scales with the chapter's own length: the five LAND → LIFE
   steps are only ~0.03 of the timeline each, and a fixed fade would mean
   none of them ever reached full opacity. */
const CH_RANGE = chapters.map(c => {
  const from = +c.dataset.from, to = +c.dataset.to;
  return [
    from, to,
    Math.min(0.030, (to - from) * 0.30),
    /* A chapter that starts at 0 has nothing to fade in FROM — the hero has
       to be complete in the very first painted frame, not ramping up from
       transparent while the visitor is already reading it. Same at the far
       end of the timeline. */
    from <= 0.0001, to >= 0.9999
  ];
});
const chState = chapters.map(() => -1);

/* WHERE THE COPY STARTS, PER CHAPTER.                           [PHASE 3.1]
   Stage-relative, so it is in the same space as the projected label
   positions in updateAnnotations. Measured on resize rather than per frame:
   the copy block's height is a layout fact, and the only thing that moves it
   between frames is the chapter's own fade transform — which is subtracted
   here by taking the inner's top RELATIVE to its chapter, since both carry
   it. Infinity means "this chapter has no copy to protect". */
const chCopyTop = chapters.map(() => Infinity);
let annoFloor = Infinity;

function measureChapterTops() {
  for (let i = 0; i < chapters.length; i++) {
    const inner = chapters[i].querySelector('.gd__inner');
    const r = inner && inner.getBoundingClientRect();
    chCopyTop[i] = (r && r.height > 1)
      ? r.top - chapters[i].getBoundingClientRect().top
      : Infinity;
  }
}

function updateChapters(p) {
  for (let i = 0; i < chapters.length; i++) {
    const [from, to, fade, openStart, openEnd] = CH_RANGE[i];
    const o = Math.min(
      openStart ? 1 : Math.min(Math.max((p - from) / fade, 0), 1),
      openEnd ? 1 : Math.min(Math.max((to - p) / fade, 0), 1)
    );
    const el = chapters[i];
    const vis = o > 0.002;
    if (Math.abs(o - chState[i]) < 0.003 && vis === el.__vis) continue;
    chState[i] = o;
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translate3d(0,${((1 - o) * (p > (from + to) / 2 ? -26 : 26)).toFixed(1)}px,0)`;
    /* A chapter that is not on screen must leave the accessibility tree and
       the tab order — otherwise the hero's call to action is still tabbable
       while the visitor is six chapters further down, and a screen reader
       announces all twelve chapters as one run-on block. */
    if (vis !== el.__vis) {
      el.__vis = vis;
      el.style.visibility = vis ? 'visible' : 'hidden';
      el.inert = !vis;
      el.setAttribute('aria-hidden', vis ? 'false' : 'true');
    }
  }

  /* The highest copy block currently on screen. Taken over everything
     visible rather than over the chapter that owns p, because chapters
     cross-fade: for ~30 thousandths of the timeline two copy blocks are
     both painted, and a label that clears the incoming one can still be
     sitting on the outgoing one. The stricter of the two wins. */
  let f = Infinity;
  for (let i = 0; i < chapters.length; i++) {
    if (chState[i] > 0.05 && chCopyTop[i] < f) f = chCopyTop[i];
  }
  annoFloor = f;
}

/* -- the workflow rail ---------------------------------------------------- */
const railItems = Array.from(document.querySelectorAll('#gdRail li'));
const RAIL_AT = [0.782, 0.812, 0.840, 0.866, 0.892];
let railLive = -1;
function updateRail(p) {
  let step = -1;
  for (let i = 0; i < RAIL_AT.length; i++) if (p >= RAIL_AT[i]) step = i;
  if (p > 0.922 || p < 0.778) step = -1;
  if (step === railLive) return;
  railLive = step;
  railItems.forEach((li, i) => li.classList.toggle('is-live', i === step));
}

/* -- the horizon ----------------------------------------------------------
   Pinned to the projected top face of the specimen and carrying a live depth
   readout, so FELSZÍN stops being a graphic and starts being a measurement. */
const horizon = document.getElementById('gdHorizon');
const depthEl = document.getElementById('gdDepth');
const _hz = new THREE.Vector3();
let lastDepth = '';

/* -- THE HERO DATUM --------------------------------------------------------
   The band the headline opens between its second and third lines: above it
   the copy is above ground, below it the copy is below ground. The hero
   camera is SOLVED so the specimen's own grade plane projects onto exactly
   that band — so the rule dividing the typography is the model's surface,
   measured, not a hairline someone placed by eye.

   This is what replaced the scrim. The type and the object are no longer
   overlapping in the same rectangle and being separated by a wash; they are
   sharing one horizontal system, and the frame holds without help.

   Measured on resize and after webfonts land — never per frame. */
const datumEl = document.querySelector('.gd__ch--hero .gd__datum');
const datumCh = datumEl ? datumEl.closest('.gd__ch') : null;
let heroDatum = -1;

function measureDatum() {
  heroDatum = -1;
  if (!datumEl || !datumCh || !vh) return;
  const r = datumEl.getBoundingClientRect();
  if (r.height < 1) return;                       // fallback layout: no datum
  /* Where in the band the grade plane is pinned. Authored in CSS next to the
     band's height, because the two only make sense together: desktop opens a
     thin gap and centres the plane in it, mobile opens a tall band for the
     whole specimen and pins the plane near its top. */
  const anchor = parseFloat(getComputedStyle(datumEl).getPropertyValue('--anchor')) || 0.5;
  const y = r.top + r.height * anchor - datumCh.getBoundingClientRect().top;
  /* A very short viewport can push the headline's gap almost to the floor,
     and solving for that would drop the specimen off the bottom of the
     stage. Past these bounds the composition is the camera's again. */
  heroDatum = Math.min(Math.max(y, vh * 0.18), vh * 0.66);
}

function updateHorizon(p, h) {
  if (!horizon) return;
  const o = T.horizon(p);
  if (o < 0.002) {
    if (horizon.__on !== false) { horizon.__on = false; horizon.style.opacity = '0'; }
    return;
  }
  horizon.__on = true;
  layerGroups.surface.updateWorldMatrix(true, false);
  _hz.set(0, 0, 0).applyMatrix4(layerGroups.surface.matrixWorld).project(camera);
  const y = (-_hz.y * 0.5 + 0.5) * h;
  /* The label sits ~1.9em above the rule, so a horizon that rides up into
     the header takes FELSZÍN with it and it collides with the logo. It fades
     out as it approaches rather than being clipped. */
  const clear = Math.min(Math.max((y - 82) / 46, 0), 1);
  horizon.style.opacity = (o * clear).toFixed(3);
  horizon.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;

  if (depthEl) {
    const d = fmtDepth(Math.max(0, -camera.position.y));
    if (d !== lastDepth) { lastDepth = d; depthEl.textContent = d; }
  }
}

/* -- the handover ----------------------------------------------------------
   At the end the camera is directly above the specimen and the top face
   fills the frame. We project that face's four corners, set the photograph's
   clip rectangle to exactly that quad's bounds, then open it to full bleed.
   The photograph therefore grows OUT of the rendered surface rather than
   dissolving over it.                                                       */
const photo = document.getElementById('gdPhoto');
const photoImg = photo ? photo.querySelector('img') : null;
const CORNERS = [
  new THREE.Vector3(-W / 2, 0, -D / 2), new THREE.Vector3(W / 2, 0, -D / 2),
  new THREE.Vector3(W / 2, 0, D / 2), new THREE.Vector3(-W / 2, 0, D / 2)
];

function updatePhoto(p, w, h) {
  if (!photo) return;
  const start = 0.942;
  if (p < start) {
    if (photo.__on !== false) { photo.__on = false; photo.style.opacity = '0'; photo.style.visibility = 'hidden'; }
    return;
  }
  if (photo.__on !== true) { photo.__on = true; photo.style.visibility = 'visible'; }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  core.updateWorldMatrix(true, false);
  for (const c of CORNERS) {
    _v.copy(c).applyMatrix4(core.matrixWorld).project(camera);
    const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  /* Finished BEFORE the end of the timeline, not at it. Phase 2.2 hands this
     plate on to the projects field, and the join only disappears if the last
     stretch of the Living Ground is a HELD full-bleed photograph rather than
     one still opening as the sticky stage releases — a rectangle that is
     still growing while the thing it is growing inside starts to travel is
     two movements at once, and the eye reads the seam. */
  const t = Math.min(Math.max((p - start) / (0.986 - start), 0), 1);
  const e = t * t * (3 - 2 * t);
  const L = minX * (1 - e), R = (w - maxX) * (1 - e);
  const T_ = minY * (1 - e), B = (h - maxY) * (1 - e);

  photo.style.clipPath = `inset(${Math.max(0, T_).toFixed(1)}px ${Math.max(0, R).toFixed(1)}px ${Math.max(0, B).toFixed(1)}px ${Math.max(0, L).toFixed(1)}px)`;
  /* Full opacity almost immediately. The plate is already graded to the
     render's palette, so it does NOT need to fade in — fading it in is what
     turns a handover into a cross-dissolve, and a cross-dissolve is the
     thing that tells the visitor the two frames never matched. */
  photo.style.opacity = Math.min(1, t * 4.5).toFixed(3);
  if (photoImg) {
    const s = 1.10 - 0.10 * e;
    photoImg.style.transform = `scale(${s.toFixed(3)})`;
    /* The grade resolves AFTER the clip has opened, not with it: first the
       photograph takes the frame while still looking like the model, then it
       becomes a photograph. That lag is the ambiguous moment. */
    const grade = Math.min(Math.max((t - 0.34) / 0.52, 0), 1);
    const g = (grade * grade * (3 - 2 * grade)).toFixed(3);
    if (photo.__g !== g) { photo.__g = g; photo.style.setProperty('--ph', g); }
  }
}

/* ==========================================================================
   12 — POINTER
   ========================================================================== */

let ptrX = 0, ptrY = 0, ptrTX = 0, ptrTY = 0;
/* Reduced motion is checked where the values are USED (apply(), below) rather
   than here, because `reduced` is now live: gating the listener on it would
   leave a visitor who switched the preference off with a dead pointer until
   they reloaded. Tracking two floats costs nothing.             [PHASE 3.2B] */
if (!coarse) {
  addEventListener('pointermove', (e) => {
    ptrTX = (e.clientX / innerWidth - 0.5) * 2;
    ptrTY = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });
}

/* ==========================================================================
   13 — LOOP
   ========================================================================== */

/* `pScroll` is where the visitor is; `p` is where the SCENE is. warp() is the
   only thing between them, and the damping deliberately happens on the scroll
   side — damp in scene time and a stretched segment would also become a
   sluggish one, which is the opposite of what stretching it was for. */
let p = 0, pScroll = 0, pTarget = 0, running = false, visible = true, raf = 0;

/* THE ENTRANCE.
   Six beats, ~2.1s, and then it never runs again: the background is already
   there, the specimen rises the last metre into position, the strata settle
   with small staggered offsets, the surface line resolves, one charge of
   water runs through the network, and only then does the scroll cue appear.
   Deliberately short. An eight-second theatrical loader on a scene that is
   entirely procedural would be a lie about how long it took to build. */
let introT0 = 0;
const INTRO_MS = reduced ? 0 : 2100;
function introEase() {
  if (!introT0) return 1;
  const e = Math.min(Math.max((performance.now() - introT0) / INTRO_MS, 0), 1);
  return e >= 1 ? 1 : 1 - Math.pow(1 - e, 3);
}
let vw = 0, vh = 0, dpr = 1, lastBg = '', lastOut = '', lastHanded = false;
let last = performance.now(), slow = 0, downgraded = false, lastDrawn = -1;

function readProgress() {
  if (frozen !== null) return frozen;
  const r = section.getBoundingClientRect();
  const total = r.height - innerHeight;
  if (total <= 0) return 0;
  return Math.min(Math.max(-r.top / total, 0), 1);
}

/* Reduced motion: snap to the nearest authored chapter instead of travelling
   through the timeline. The visitor still gets every composition — surface,
   underground, water, exploded section, finished garden — as a set of stills. */
/* Every stop lands INSIDE an authored chapter, never in the quiet beats
   between them — otherwise a reduced-motion visitor can come to rest on a
   composition with no copy on it at all. */
const SNAP = [0, 0.165, 0.320, 0.566, 0.710, 0.796, 0.826, 0.852, 0.878, 0.906, 0.975];
function snapProgress(v) {
  let best = SNAP[0], bd = Infinity;
  for (const s of SNAP) { const d = Math.abs(s - v); if (d < bd) { bd = d; best = s; } }
  return best;
}

function resize() {
  const w = stage.clientWidth || innerWidth;
  const h = stage.clientHeight || innerHeight;
  if (w === vw && h === vh) return false;
  vw = w; vh = h;
  measureLayout();
  dpr = Math.min(devicePixelRatio || 1, Q.dpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = layout.fov;
  camera.updateProjectionMatrix();
  if (annoSvg) annoSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  measureDatum();
  measureChapterTops();
  return true;
}

const _pos = new THREE.Vector3(), _tgt = new THREE.Vector3();
/* Midway between the labelled emitter (ANCHORS.emit, x=3.05) and the wetted
   lens carried on the cut wall by the x=1.15 dripline, dropped a little below
   the pipe line because the bulb spreads down and out from it — an oblate
   lens, not a sphere. The WATER close-up aims here. */
const WATER_FOCUS = new THREE.Vector3(2.35, -2.66, 1.55);
const _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
const _pan = new THREE.Vector2();

function apply(now) {
  /* Under reduced motion the clock is stopped, not merely slowed: the grass
     sway, the shimmer on the water and the recirculating pulse are all
     driven by it, and a visitor who has asked for no motion should get a
     held image, not a slower one. */
  const t = reduced ? 3.2 : now * 0.001;
  U.time.value = t;

  const u = toCurveU(p);
  camCurve.getPoint(u, _pos);
  tgtCurve.getPoint(u, _tgt);

  /* Framing. panX/panY shift the subject in SCREEN space by moving camera and
     target together along the view's right/up axes — which is how the hero
     keeps its left half clear for the headline without ever rotating the
     model away from its best angle. */
  _pos.multiplyScalar(layout.dist);

  /* WATER IS A CLOSE-UP ON A NARROW SCREEN.                     [PHASE 3.1]
     Measured at 390x844: the emitter, the lateral running out of it and the
     wetted lens together occupied about 90x60 CSS px inside an 844px-tall
     frame, with ~110px of empty black above the block and a featureless
     aggregate mass filling the lower left. The visitor could see the whole
     specimen and still not see the irrigation event — which is the one
     thing this chapter exists to show.

     The correction is deliberately NOT a global phone offset: the brief
     that produced this scene protected HERO's datum solve and EXPLODED's
     silhouette from exactly that. It is a dolly along the chapter's own
     view axis, gated by the WATER window and scaled by layout.tight, so
     nothing outside .400-.624 and nothing on a landscape or desktop frame
     can feel it. Lerping toward _tgt rather than scaling _pos keeps the
     authored angle — the emitter stays in the left two thirds and the copy
     keeps its column, per the Phase 2.2 recomposition — and only shortens
     the distance, which is the variable that was actually wrong.

     Peripheral terrain is lost. That trade is the point: the mechanism
     beats the complete-object silhouette here, and the silhouette is
     already established twice, in GROUND before this and in EXPLODED
     after it. */
  const wz = T.waterIn(p) * layout.tight;
  if (wz > 0.0005) {
    /* Aim between the two things that have to be in one glance before
       magnifying, or magnification pushes them apart: the labelled emitter
       at x=3.05 and the wetted lens on the cut wall by the x=1.15 dripline.
       A dolly alone drove the emitter off the right edge by 0.56 — the pair
       spreads as the frame tightens, and this is the ceiling on how hard
       WATER can be cropped before cause and evidence stop sharing a shot. */
    _tgt.lerp(WATER_FOCUS, 0.38 * wz);
    _pos.lerp(_tgt, 0.46 * wz);
  }

  /* The responsive lift and pan are quoted against the HERO's viewing
     distance, so they have to be scaled by how far the camera actually is
     right now. Applied raw, the same 5-unit lift that reframes a 27-unit-away
     establishing shot throws a 13-unit-away close-up completely off the
     subject — which is exactly what it did to the WATER chapter. */
  const distNow = _pos.distanceTo(_tgt);
  /* Relative to the HERO's distance AT THIS LAYOUT — layout.dist is already
     baked into distNow, and dividing by the raw hero distance instead made
     the correction 35% too strong on any viewport that pulls the camera
     back, which is every portrait one. */
  const rel = Math.min(distNow / (27.2 * layout.dist), 1.0);
  /* Released over the last chapter so the top-down handover shot is the same
     composition on every device. */
  const resp = rel * (1 - Math.min(Math.max((p - 0.880) / 0.075, 0), 1));

  /* The lift exists so the hero's copy band has clear air under the model.
     From the DESCENT onward the copy is a short block at the bottom of the
     screen and the model is the subject, so holding the full hero lift just
     pushes the top of the specimen — and the FELSZÍN label with it — off the
     stage. It decays to under half once the narrative is underground. */
  const liftScale = 1 - 0.55 * Math.min(Math.max((p - 0.100) / 0.150, 0), 1);

  _pos.y += layout.elev * resp * liftScale;
  lerpKeyPan(p, _pan);
  _dir.copy(_pos).sub(_tgt).normalize();
  _right.crossVectors(_up, _dir).normalize();

  /* The last shot is a plate: it must be centred, so the layout offset is
     released as the camera comes over the top. */
  const framed = 1 - Math.min(Math.max((p - 0.900) / 0.100, 0), 1);
  const panX = _pan.x * layout.panX;
  const panY = _pan.y + layout.panY * resp * liftScale;
  _pos.addScaledVector(_right, panX).addScaledVector(_up, panY);
  _tgt.addScaledVector(_right, panX).addScaledVector(_up, panY);

  /* Pointer parallax. Two or three degrees, heavily damped, released before
     the handover — the object has to feel physical, not stuck to the cursor. */
  if (!coarse && !reduced) {
    ptrX += (ptrTX - ptrX) * 0.045;
    ptrY += (ptrTY - ptrY) * 0.045;
    _pos.addScaledVector(_right, -ptrX * 0.42 * framed);
    _pos.y += -ptrY * 0.26 * framed;
  }

  camera.position.copy(_pos);
  camera.lookAt(_tgt);

  /* the object itself */
  core.rotation.y = T.spin(p) + (reduced ? 0 : ptrX * 0.030 * framed);
  core.rotation.x = reduced ? 0 : -ptrY * 0.016 * framed;

  const ex = T.explode(p);
  U.explode.value = ex;

  /* The entrance lifts the whole specimen the last metre into place and lets
     each stratum arrive a beat after the one above it — the same explode
     axis the STRUCTURE chapter uses later, at a twentieth of the amplitude. */
  const iv = introEase();
  const lift = (1 - iv) * -1.05;
  core.position.y = lift;
  let li = 0;
  for (const L of LAYERS) {
    const stagger = Math.min(Math.max((iv - li * 0.06) / 0.72, 0), 1);
    const g = layerGroups[L.id];
    g.position.y = L.ex * ex + L.ex * 0.055 * (1 - stagger);
    g.position.x = L.dx * ex;
    g.position.z = L.dz * ex;
    li++;
  }
  pipes.position.y = PIPE_EX * ex;
  guideMat.opacity = ex * 0.80;
  guides.visible = ex > 0.01;

  /* TEREP sinks everything constructed back into the ground; STRUKTÚRA
     builds it again. Below the surface cap it is simply occluded by the
     topsoil, which is cheaper and reads better than fading it out. */
  const st = T.struct(p);
  built.position.y = -1.15 * (1 - st);
  built.visible = st > 0.02;
  /* The paving's contact shading travels with the paving: when TEREP sinks
     it into the ground its occlusion has to go with it, or the bare graded
     site keeps the shadows of stones that are not there. */
  U.built.value = st;

  const fl = T.fill(p);
  backfill.position.y = -3.6 * (1 - fl);
  backfill.visible = fl > 0.02;

  /* THE DATUM LOCK. Run here, after the strata have taken their positions,
     because the plane being solved for is the surface layer's — and released
     over the first tenth of the timeline, so it composes the hero and then
     gets out of the way of the descent. One linear step converges: over the
     range this ever corrects, screen height is very nearly linear in the
     vertical pan. */
  camera.updateMatrixWorld(true);
  const lock = heroDatum > 0 ? 1 - Math.min(Math.max((p - 0.006) / 0.086, 0), 1) : 0;
  if (lock > 0.002) {
    layerGroups.surface.updateWorldMatrix(true, false);
    _hz.set(0, 0, 0).applyMatrix4(layerGroups.surface.matrixWorld).project(camera);
    const cur = (-_hz.y * 0.5 + 0.5) * vh;
    const shift = (heroDatum - cur) * lock;
    const d = (shift / vh) * 2 * camera.position.distanceTo(_tgt)
            * Math.tan(camera.fov * Math.PI / 360);
    camera.position.addScaledVector(_up, d);
    _tgt.addScaledVector(_up, d);
    camera.lookAt(_tgt);
    camera.updateMatrixWorld(true);
  }

  U.moist.value = T.moist(p);
  U.veg.value = T.veg(p);
  U.raw.value = T.raw(p);
  U.grow.value = T.grow(p);
  U.rootFade.value = T.rootFade(p);
  U.flow.value = T.flow(p);
  U.warm.value = T.warm(p);
  U.pulse.value = pulseAt(p, t);
  if (iv < 1 && p < 0.05) {
    /* beat 5: a single controlled pulse, mapped to the tail of the entrance */
    const w = Math.min(Math.max((iv - 0.42) / 0.58, 0), 1);
    if (w > 0 && w < 1) { U.flow.value = Math.sin(w * Math.PI) * 0.9; U.pulse.value = w * 1.1; }
  }

  key.intensity = T.lKey(p);
  rim.intensity = T.lRim(p);
  sect.intensity = T.lSect(p);
  hemi.intensity = T.lHemi(p);
  sub.intensity = T.lSub(p);
  fillWarm.intensity = T.lWarmPt(p);
  trench.intensity = T.lTrench(p);
  lip.intensity = T.lLip(p);
  /* Driven straight off the explode value rather than its own track: the
     soffits only exist while the section is open, so the two cannot drift. */
  under.intensity = ex * 1.75;

  canvas.style.opacity = T.reveal(p).toFixed(3);

  /* Only written when it actually moves — a custom property on the root
     invalidates style for the document, and at sixty hertz that is not free. */
  const bg = T.bg(p).toFixed(2);
  if (bg !== lastBg) { lastBg = bg; root.style.setProperty('--gd-below', bg); }
  const out = T.out(p).toFixed(3);
  if (out !== lastOut) { lastOut = out; root.style.setProperty('--gd-out', out); }

  updateChapters(p);
  updateRail(p);
  updateHorizon(p, vh);
  updateSection(ex, vw, vh);
  updateAnnotations(p, vw, vh);
  updatePhoto(p, vw, vh);
}

function frame(now) {
  raf = 0;
  if (!visible || dead || lost) { running = false; return; }

  const dt = now - last;
  last = now;

  /* One-shot quality guard. If the device cannot hold ~38fps over ninety
     frames, drop DPR once. Never the narrative, never the geometry. */
  if (!downgraded && dt > 26) {
    if (++slow > 90) {
      downgraded = true;
      Q = Object.assign({}, Q, { dpr: Math.max(1, Q.dpr * 0.72) });
      dpr = Math.min(devicePixelRatio || 1, Q.dpr);
      renderer.setPixelRatio(dpr);
    }
  } else if (slow > 0) slow--;

  pTarget = readProgress();
  if (frozen !== null) {
    /* ?scene= quotes SCENE time, so it bypasses the map entirely. */
    p = pScroll = frozen;
  } else if (reduced) {
    p = snapProgress(warp(pTarget));
  } else {
    /* Damped, not linear: the whole piece has to feel weighted. */
    pScroll += (pTarget - pScroll) * 0.085;
    if (Math.abs(pTarget - pScroll) < 0.00012) pScroll = pTarget;
    p = warp(pScroll);
  }

  /* THE SWAP.
     Beyond this point the Living Ground's sticky stage has let go and starts
     travelling up the page, while the projects section — pulled up by exactly
     one viewport in rk.css — has pinned an IDENTICAL copy of the same
     photograph directly underneath it. Matching the two overlays made the
     tone continuous, but two copies of one picture offset by four hundred
     pixels still show the picture starting again, and that repeat is the
     visible cut.

     So at the one frame where the two coincide exactly, this frame stops
     drawing its own copy and lets the pinned one through. Same pixels, same
     grade, same rectangle — nothing to see. What keeps travelling up is the
     REALITY copy, which is the thing that SHOULD leave.

     Keyed to the raw scroll position, never to the damped p: the swap is a
     geometric fact about where the two rectangles are, and easing it would
     put it a few frames away from the only place it is invisible. */
  const handed = pTarget >= 0.9999;
  if (handed !== lastHanded) {
    lastHanded = handed;
    section.classList.toggle('is-handed', handed);
  }

  const resized = resize();

  /* With the clock stopped, a frame is only worth drawing when the timeline
     has actually moved. This turns reduced motion into a genuinely idle
     page instead of one redrawing an identical image sixty times a second. */
  if (!reduced || resized || p !== lastDrawn) {
    apply(now);
    renderer.render(scene, camera);
    lastDrawn = p;
  }

  raf = requestAnimationFrame(frame);
  running = true;
}

function start() {
  if (running || !visible || dead || lost) return;
  last = performance.now();
  running = true;
  raf = requestAnimationFrame(frame);
}
/* The single place anything outside the loop is allowed to put a frame on
   screen. Drawing into a lost or abandoned context is how one GPU hiccup
   becomes a console full of identical errors.                   [PHASE 3.2] */
function draw() {
  if (dead || lost) return;
  apply(performance.now());
  renderer.render(scene, camera);
}
function stop() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/* Rendering is paused the moment the experience leaves the viewport: below
   the fold the homepage is ordinary DOM and must not pay for a GPU loop. */
const io = new IntersectionObserver((entries) => {
  visible = entries[0].isIntersecting;
  if (visible) start(); else stop();
}, { rootMargin: '10% 0px 10% 0px' });
io.observe(section);

addEventListener('resize', () => { resize(); if (!running) draw(); }, { passive: true });
/* The datum is a typographic measurement, so it is only true once the display
   face has actually rendered — measured against the fallback it can be most
   of a line out, and the specimen would sit visibly off the headline. */
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { measureDatum(); measureChapterTops(); if (!running) draw(); });
}
/* Rotation resizes in two stages on iOS: the event fires while the old
   geometry is still reported, and the visual viewport settles a moment later.
   vw = 0 forces resize() past its own no-op guard so the second reading is
   always acted on. The visualViewport pass catches the third movement — the
   browser chrome collapsing or expanding under a thumb — which emits no
   window resize at all on iOS Safari and would otherwise leave the stage
   sized to a viewport that no longer exists.                    [PHASE 3.2] */
addEventListener('orientationchange', () => setTimeout(() => { vw = 0; resize(); if (!running) draw(); }, 260));
if (window.visualViewport) {
  let vvT = 0;
  visualViewport.addEventListener('resize', () => {
    /* Coalesced, not throttled: toolbar collapse fires a burst and only the
       state it settles in is worth a projection-matrix rebuild. */
    clearTimeout(vvT);
    vvT = setTimeout(() => { if (resize() && !running) draw(); }, 120);
  }, { passive: true });
}
/* rk.js §15 re-seats the scroll after a rotation so the visitor keeps their
   place in the story rather than their place in the document. That is a
   teleport, and the damping in frame() must not treat it as travel: left
   alone it would sweep the camera through every chapter between the two
   positions at 8.5% a frame — a two-second flight nobody asked for, arriving
   exactly where they already were.                              [PHASE 3.2B] */
/* Switching the OS preference is a change of composition, not a journey, so
   the scene is re-seated on the spot rather than allowed to travel there:
   entering reduced motion snaps to the nearest authored chapter, leaving it
   lands on the visitor's actual scroll position. Either way the transit is
   one frame — a damped sweep would be motion introduced by the act of asking
   for less of it.                                               [PHASE 3.2B] */
if (RMQ.addEventListener) {
  RMQ.addEventListener('change', (e) => {
    if (e.matches === reduced) return;
    reduced = e.matches;
    pScroll = pTarget = readProgress();
    p = frozen !== null ? frozen : (reduced ? snapProgress(warp(pTarget)) : warp(pScroll));
    lastDrawn = -1;
    draw();
    start();
  });
}
addEventListener('rk:reseat', () => {
  vw = 0;
  resize();
  pScroll = pTarget = readProgress();
  p = frozen !== null ? frozen : (reduced ? snapProgress(warp(pTarget)) : warp(pScroll));
  draw();
});
addEventListener('pageshow', () => { vw = 0; resize(); start(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

/* -- context loss ----------------------------------------------------------
   preventDefault() is what makes a restore possible at all, so it is
   unconditional. What must NOT be unconditional is the handover: dropping
   .gd-on collapses the pinned stage under a visitor who may be standing in
   the middle of it, and a GPU that is about to hand the context straight back
   would have caused that reflow for nothing. So the loop stops at once — a
   lost context must never be drawn into — and the page waits one beat.
   If the restore does not come, the stacked layout does.        [PHASE 3.2] */
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  lost = true;
  stop();
  clearTimeout(restoreT);
  restoreT = setTimeout(() => { if (lost) fail(); }, 1600);
});
canvas.addEventListener('webglcontextrestored', () => {
  clearTimeout(restoreT);
  if (dead) return;                 // the fallback already won; do not fight it
  lost = false;
  /* three re-uploads its own resources on this event. What it cannot know is
     the size and the frame, both of which belong to this file. */
  vw = 0;
  resize();
  draw();
  start();
});

/* -- first frame -----------------------------------------------------------
   Everything is procedural, so there is nothing to preload and no loader to
   show. The scene is compiled and drawn before the class flips, which means
   the hero never appears as an empty rectangle. */
resize();
pScroll = pTarget = readProgress();
p = frozen !== null ? frozen : warp(pScroll);
apply(performance.now());
renderer.compile(scene, camera);
renderer.render(scene, camera);
introT0 = performance.now();
root.classList.add('gd-ready');
start();

/* Expose a minimal handle for debugging without leaking the whole scene. */
if (frozen !== null || params.has('tier')) {
  window.RK_GROUND = {
    get p() { return p; },
    set p(v) { p = pScroll = pTarget = v; apply(performance.now()); renderer.render(scene, camera); },
    tier, scene, camera, core, layerGroups, T, U, warp,
    info: () => renderer.info,
    /* Hold a uniform at a value and redraw, so a shader effect can be judged
       against its own absence instead of against a memory of the last
       screenshot. Overwritten by the next apply(). */
    hold(name, v) { U[name].value = v; renderer.render(scene, camera); },
    /* Strips the DOM overlays so a screenshot shows the render alone. */
    bare() {
      document.querySelectorAll('.gd__ui,.gd__anno,.rk-nav,.gd__horizon').forEach(e => e.style.display = 'none');
      const st = document.createElement('style');
      st.textContent = '.gd__stage::after{display:none!important}';
      document.head.appendChild(st);
    }
  };
}

/* Not used at runtime — kept so a future SPA shell can tear the scene down
   without leaking GPU memory. */
window.addEventListener('rk:ground:dispose', () => {
  stop(); io.disconnect();
  disposables.forEach(d => d.dispose && d.dispose());
  renderer.dispose();
}, { once: true });

}
