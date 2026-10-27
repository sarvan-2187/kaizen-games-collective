'use strict';
/* Kaizen Battle Royale: shared math helpers. Everything hangs off the KBR namespace (plain scripts, no build step). */
const KBR = { cfg: {}, quality: null };
const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing: moves a toward b; `lambda` is the response speed per second. */
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** Shortest signed angle from a to b, in (-PI, PI]. */
const angleDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d <= -Math.PI) d += TAU; return d; };
const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

/** Small, fast, seedable PRNG (mulberry32). */
class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() { let t = (this.s += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  pick(arr) { return arr[this.int(arr.length)]; }
  chance(p) { return this.next() < p; }
  /** Standard normal sample (Box-Muller). */
  gauss() { const u = Math.max(1e-9, this.next()), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
  /** Uniform point in the unit disc (sqrt keeps the density even, unlike a plain random radius). */
  disc() { const r = Math.sqrt(this.next()), a = this.next() * TAU; return [r * Math.cos(a), r * Math.sin(a)]; }
}
const rng = new RNG((Date.now() ^ 0x9e3779b9) >>> 0); // gameplay randomness (spread, bot errors)

/** 2D Perlin noise + fBm. */
function makeNoise(seed) {
  const r = new RNG(seed), perm = new Uint8Array(512), base = [];
  for (let i = 0; i < 256; i++) base.push(i);
  for (let i = 255; i > 0; i--) { const j = r.int(i + 1); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => { const g = G[h & 7]; return g[0] * x + g[1] * y; };
  function noise2(x, y) {
    const xf = Math.floor(x), yf = Math.floor(y), X = xf & 255, Y = yf & 255;
    x -= xf; y -= yf;
    const u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
    return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
  }
  /** Sum of octaves, normalised to roughly [-1, 1]. */
  function fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise2(x * f, y * f) * amp; norm += amp; amp *= gain; f *= lac; }
    return sum / norm;
  }
  return { noise2, fbm };
}

/** Averages normals of vertices that share a position, so an inverted-hull outline has no gaps on hard edges. */
function smoothedNormals(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, map = new Map(), out = new Float32Array(nor.count * 3);
  const key = (i) => Math.round(pos.getX(i) * 1000) + ',' + Math.round(pos.getY(i) * 1000) + ',' + Math.round(pos.getZ(i) * 1000);
  for (let i = 0; i < pos.count; i++) {
    const k = key(i); let e = map.get(k);
    if (!e) { e = [0, 0, 0]; map.set(k, e); }
    e[0] += nor.getX(i); e[1] += nor.getY(i); e[2] += nor.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const e = map.get(key(i)), l = Math.hypot(e[0], e[1], e[2]) || 1;
    out[i * 3] = e[0] / l; out[i * 3 + 1] = e[1] / l; out[i * 3 + 2] = e[2] / l;
  }
  return out;
}

/** Collects transformed primitive geometry (with vertex colours) into one BufferGeometry: one draw call for many parts. */
class GeoBatch {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = []; this.n = 0; }
  /** geo: any THREE.BufferGeometry; m: THREE.Matrix4; color: hex; uvFn(i, u, v) -> [u, v] optionally remaps UVs. */
  add(geo, m, color, uvFn) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      if (u) { const t = uvFn ? uvFn(i, u.getX(i), u.getY(i)) : [u.getX(i), u.getY(i)]; this.uv.push(t[0], t[1]); }
      else this.uv.push(0, 0);
    }
    this.n += p.count;
    g.dispose();
    return this;
  }
  /** Fast path: a box centred at (x,y,z) with size (w,h,d) and optional yaw. */
  box(w, h, d, x, y, z, color, yaw = 0) {
    const g = KBR._box || (KBR._box = new THREE.BoxGeometry(1, 1, 1));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(w, h, d));
    return this.add(g, m, color);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
