// Enemy models, perception and behaviour.
// Behaviour chain: PATROL -> SUSPICIOUS -> INVESTIGATE -> ALERT -> SEARCH -> PATROL
import { CS, ENEMY_TYPES, DIFFICULTY } from './data.js';

const THREE = window.THREE;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const S = { PATROL: 'PATROL', SUSPICIOUS: 'SUSPICIOUS', INVESTIGATE: 'INVESTIGATE', ALERT: 'ALERT', SEARCH: 'SEARCH', DISABLED: 'DISABLED', DEAD: 'DEAD' };
const CONE_COL = { PATROL: 0x4dffa0, SUSPICIOUS: 0xffd23f, INVESTIGATE: 0xff9a2e, ALERT: 0xff2a4a, SEARCH: 0xff9a2e, DISABLED: 0x000000, DEAD: 0x000000 };
const VISOR_COL = { PATROL: 0x33e0ff, SUSPICIOUS: 0xffd23f, INVESTIGATE: 0xff9a2e, ALERT: 0xff2244, SEARCH: 0xff9a2e };

const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---------------------------------------------------------------- ray helpers
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const l2 = lx * lx + ly * ly + lz * lz;
  if (tca < 0 && l2 > r * r) return -1;
  const d2 = l2 - tca * tca; if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2); const t0 = tca - thc;
  return t0 >= 0 ? t0 : tca + thc;
}
function rayCyl(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  const a = dx * dx + dz * dz; if (a < 1e-8) return -1;
  const lx = ox - cx, lz = oz - cz; const b = lx * dx + lz * dz; const c = lx * lx + lz * lz - r * r;
  const disc = b * b - a * c; if (disc < 0) return -1;
  const sq = Math.sqrt(disc); let t = (-b - sq) / a; if (t < 0) t = (-b + sq) / a; if (t < 0) return -1;
  const y = oy + dy * t; if (y < y0 || y > y1) return -1;
  return t;
}

// ---------------------------------------------------------------- shared geometry
const GEO = {};
function geo(key, make) { return GEO[key] || (GEO[key] = make()); }
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
export function disposeEnemyGeometry() { for (const k of Object.keys(GEO)) { GEO[k].dispose(); delete GEO[k]; } }

function buildModel(def, hvt) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);          // tilts on death
  const bodyMat = new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.5, metalness: 0.6, emissive: 0x000000 });
  const accentMat = new THREE.MeshBasicMaterial({ color: def.accent });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.6, metalness: 0.5 });
  const mats = [bodyMat, accentMat, darkMat];
  const parts = { body, bodyMat, accentMat, mats };
  const s = def.scale;
  const add = (g, m, x, y, z, parent = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };

  if (def.id === 'drone') {
    parts.hover = new THREE.Group(); body.add(parts.hover);
    const sph = geo('dsph', () => new THREE.SphereGeometry(0.3, 14, 10));
    const bod = add(sph, bodyMat, 0, 0, 0, parts.hover); bod.scale.set(1, 0.7, 1);
    add(geo('dtor', () => new THREE.TorusGeometry(0.42, 0.04, 6, 20)), darkMat, 0, 0.05, 0, parts.hover).rotation.x = Math.PI / 2;
    parts.rotor = add(geo('drot', () => new THREE.TorusGeometry(0.22, 0.025, 6, 14)), accentMat, 0, 0.26, 0, parts.hover); parts.rotor.rotation.x = Math.PI / 2;
    add(geo('deye', () => new THREE.SphereGeometry(0.1, 10, 8)), accentMat, 0, -0.02, -0.26, parts.hover);
    add(box(0.04, 0.3, 0.04), darkMat, 0.2, 0.3, 0.1, parts.hover);
    parts.height = 0;
    return { root, parts };
  }
  if (def.id === 'turret') {
    add(geo('tbase', () => new THREE.CylinderGeometry(0.5, 0.6, 0.5, 10)), darkMat, 0, 0.25, 0);
    parts.head = new THREE.Group(); parts.head.position.y = 0.95; body.add(parts.head);
    add(box(0.7, 0.45, 0.7), bodyMat, 0, 0, 0, parts.head);
    add(box(0.1, 0.1, 0.8), darkMat, -0.18, 0, -0.65, parts.head);
    add(box(0.1, 0.1, 0.8), darkMat, 0.18, 0, -0.65, parts.head);
    add(box(0.5, 0.06, 0.04), accentMat, 0, 0.1, -0.36, parts.head);
    add(box(0.14, 0.5, 0.14), darkMat, 0, -0.45, 0, parts.head);
    return { root, parts };
  }
  if (def.id === 'camera') {
    add(box(0.25, 0.25, 0.3), darkMat, 0, 2.85, 0.55);
    parts.head = new THREE.Group(); parts.head.position.set(0, 2.78, 0.2); body.add(parts.head);
    add(box(0.28, 0.24, 0.55), bodyMat, 0, 0, -0.1, parts.head);
    add(geo('clens', () => new THREE.CylinderGeometry(0.09, 0.11, 0.1, 10)), accentMat, 0, 0, -0.4, parts.head).rotation.x = Math.PI / 2;
    add(box(0.05, 0.05, 0.05), accentMat, 0.1, 0.15, 0.1, parts.head);
    parts.head.rotation.x = -0.3;
    return { root, parts };
  }

  // humanoids ---------------------------------------------------
  const elite = def.id === 'elite', heavy = def.id === 'heavy';
  const w = heavy ? 0.62 : elite ? 0.44 : 0.5;
  parts.legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.12 * s, 0.86 * s, 0); body.add(hip);
    add(box(0.17 * s, 0.86 * s, 0.2 * s), bodyMat, 0, -0.43 * s, 0, hip);
    add(box(0.19 * s, 0.12 * s, 0.3 * s), darkMat, 0, -0.82 * s, -0.04 * s, hip);
    parts.legs.push(hip);
  }
  add(box(w * s, 0.62 * s, 0.3 * s), bodyMat, 0, 1.16 * s, 0);
  add(box(w * 0.7 * s, 0.1 * s, 0.02), accentMat, 0, 1.3 * s, -0.16 * s);
  add(box(w * s, 0.12 * s, 0.32 * s), darkMat, 0, 0.88 * s, 0);
  const head = add(box(0.24 * s, 0.26 * s, 0.26 * s), heavy ? darkMat : bodyMat, 0, 1.62 * s, 0);
  add(box(0.2 * s, 0.07 * s, 0.03), accentMat, 0, 1.64 * s, -0.135 * s);
  parts.head = head;
  if (heavy) {
    add(box(0.28 * s, 0.2 * s, 0.34 * s), bodyMat, -0.4 * s, 1.42 * s, 0); add(box(0.28 * s, 0.2 * s, 0.34 * s), bodyMat, 0.4 * s, 1.42 * s, 0);
    add(box(0.3 * s, 0.1 * s, 0.3 * s), bodyMat, 0, 1.78 * s, 0);
  }
  if (elite) add(box(0.5 * s, 0.05, 0.02), accentMat, 0, 1.0 * s, -0.16 * s);
  if (hvt) { add(box(0.34 * s, 0.05, 0.34 * s), accentMat, 0, 1.82 * s, 0); add(box(0.6 * s, 0.4 * s, 0.1), accentMat, 0, 1.2 * s, 0.2 * s); }
  parts.arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * (w / 2 + 0.09) * s, 1.4 * s, 0); body.add(sh);
    add(box(0.14 * s, 0.56 * s, 0.16 * s), bodyMat, 0, -0.26 * s, 0, sh);
    parts.arms.push(sh);
  }
  // weapon held in the right arm group so it follows the aim pose
  const gun = new THREE.Group(); gun.position.set(0, -0.5 * s, -0.12 * s); parts.arms[1].add(gun);
  add(box(0.08 * s, 0.14 * s, (heavy ? 0.85 : 0.65) * s), darkMat, 0, 0, -0.25 * s, gun);
  add(box(0.04 * s, 0.04 * s, 0.1), accentMat, 0, 0.09 * s, -0.3 * s, gun);
  parts.gun = gun;
  return { root, parts };
}

// ---------------------------------------------------------------- Enemy
export class Enemy {
  constructor(mgr, spec, id) {
    const def = ENEMY_TYPES[spec.type];
    this.mgr = mgr; this.g = mgr.g; this.def = def; this.id = id; this.spec = spec;
    const w = this.g.world;
    this.x = w.center(spec.x); this.z = w.center(spec.z); this.y = 0;
    this.yaw = spec.yaw != null ? spec.yaw : Math.random() * TAU;
    this.baseYaw = this.yaw;
    this.r = 0.34 * def.scale;
    this.hvt = !!spec.hvt; this.name = spec.name || def.name; this.group = spec.group || null;
    const diff = DIFFICULTY[this.g.settings.difficulty] || DIFFICULTY.normal;
    this.hpMax = Math.round((spec.hp || def.hp) * diff.hp); this.hp = this.hpMax;
    this.state = S.PATROL; this.prevState = S.PATROL;
    this.aware = 0; this.dead = false; this.found = false;
    this.stim = { x: this.x, z: this.z }; this.lastKnown = { x: this.x, z: this.z };
    this.sees = false; this.lastSeen = -99;
    this.timer = 0; this.waitT = 0; this.path = null; this.pi = 0; this.repathT = 0;
    this.stuckT = 0; this.sx = this.x; this.sz = this.z; this.stuckCheck = 0;
    this.patrol = (spec.patrol || []).map(([cx, cz]) => ({ x: w.center(cx), z: w.center(cz) }));
    this.pwi = 0; this.pdir = 1; this.loop = !!spec.loop;
    this.walk = 0; this.moving = false; this.speedNow = 0;
    this.flash = 0; this.stagger = 0; this.deadT = 0;
    this.percT = Math.random() * 0.1; this.percAcc = 0;
    this.aimT = 0; this.burstLeft = 0; this.burstT = 0; this.cd = 0.5 + Math.random();
    this.loseT = 0; this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 1;
    this.disabledT = 0; this.perm = false;
    this.phase = 'fire'; this.phaseT = 2.5; this.cover = null; this.firePos = null;
    this.flankT = 0; this.flankGoal = null;
    this.doorT = 0; this.coneT = Math.random();
    this.scanT = Math.random() * 6;
    this.sweep = (spec.sweep || (def.id === 'camera' ? 50 : 0)) * DEG;
    this.period = spec.period || 7;
    this.baseY = def.flying ? 2.1 : 0;
    if (def.flying) this.y = this.baseY;
    if (def.id === 'camera') { this.x += -Math.sin(this.yaw) * -0.8; this.z += -Math.cos(this.yaw) * -0.8; this.y = 0; }
    const m = buildModel(def, this.hvt);
    this.group3 = m.root; this.parts = m.parts;
    this.g.scene.add(this.group3);
    this.cone = null;
    this.syncModel(0);
    this.setVisor();
  }

  // ------------------------------------------------------------ visuals
  setVisor() {
    const st = this.disabledT > 0 ? S.DISABLED : this.state;
    this.parts.accentMat.color.setHex(st === S.DISABLED || st === S.DEAD ? 0x111111 : (VISOR_COL[st] || 0x33e0ff));
    if (this.cone) this.cone.material.color.setHex(CONE_COL[st] || 0);
  }

  syncModel(dt) {
    const gr = this.group3, p = this.parts, def = this.def;
    gr.position.set(this.x, this.y, this.z);
    gr.rotation.y = this.yaw;
    if (def.id === 'drone') {
      p.hover.position.y = this.dead ? 0 : Math.sin(this.g.time * 3 + this.id) * 0.07;
      if (p.rotor && !this.dead && this.disabledT <= 0) p.rotor.rotation.z += dt * 18;
      if (this.disabledT > 0 && !this.dead) p.hover.rotation.z = Math.sin(this.g.time * 20) * 0.08;
    } else if (def.id === 'turret') {
      p.head.rotation.x = this.disabledT > 0 || this.dead ? 0.5 : 0;
    } else if (def.id === 'camera') {
      p.head.rotation.x = this.disabledT > 0 || this.dead ? 0.7 : -0.3 + (this.state === S.ALERT ? -0.1 : 0);
    } else if (!this.dead) {
      const sw = Math.sin(this.walk) * (this.moving ? 0.7 : 0);
      p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw;
      const aim = (this.state === S.ALERT && this.sees) || this.burstLeft > 0;
      p.arms[0].rotation.x = aim ? -1.35 : -sw * 0.6;
      p.arms[1].rotation.x = aim ? -1.4 : sw * 0.6;
      p.body.rotation.x = this.stagger > 0 ? 0.25 * (this.stagger / 0.25) : 0;
    }
    if (this.flash > 0 || this._flashed) {
      p.bodyMat.emissive.setRGB(this.flash * 0.9, this.flash * 0.25, this.flash * 0.1); this._flashed = this.flash > 0;
    }
  }

  updateCone(dt) {
    const sh = this.g.settings.showCones;
    const dead = this.dead || this.disabledT > 0;
    if (!sh || dead) { if (this.cone) this.cone.visible = false; return; }
    const g = this.g, p = g.player;
    if (Math.abs(p.x - this.x) + Math.abs(p.z - this.z) > 46) { if (this.cone) this.cone.visible = false; return; }
    this.coneT -= dt; if (this.coneT > 0 && this.cone) { this.cone.visible = true; return; }
    this.coneT = 0.05;
    const N = 18;
    if (!this.cone) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 2) * 3), 3));
      const idx = []; for (let i = 0; i < N; i++) idx.push(0, i + 1, i + 2);
      geom.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4dffa0, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      this.cone = new THREE.Mesh(geom, mat); this.cone.frustumCulled = false; this.cone.renderOrder = 2;
      g.scene.add(this.cone); this.setVisor();
    }
    this.cone.visible = true;
    const def = this.def, diff = DIFFICULTY[g.settings.difficulty] || DIFFICULTY.normal;
    const range = def.sight * diff.sight;
    const half = Math.min(def.fov, 180) * DEG;
    const arr = this.cone.geometry.attributes.position.array;
    const ey = def.id === 'camera' ? 1.0 : 1.0;
    arr[0] = this.x; arr[1] = 0.06; arr[2] = this.z;
    const full = def.fov >= 180;
    for (let i = 0; i <= N; i++) {
      const a = this.yaw + (full ? (i / N) * TAU : -half + (2 * half * i) / N);
      const dx = -Math.sin(a), dz = -Math.cos(a);
      let d = range;
      if (g.world.raycast(this.x, ey, this.z, dx, 0, dz, range, g.tmpHit)) d = g.tmpHit.t;
      arr[(i + 1) * 3] = this.x + dx * d; arr[(i + 1) * 3 + 1] = 0.06; arr[(i + 1) * 3 + 2] = this.z + dz * d;
    }
    this.cone.geometry.attributes.position.needsUpdate = true;
    this.cone.material.opacity = this.state === S.ALERT ? 0.3 : 0.2;
  }

  // ------------------------------------------------------------ geometry queries
  muzzle(out) {
    const s = this.def.scale, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (this.def.id === 'drone') { out.x = this.x + fx * 0.3; out.y = this.y; out.z = this.z + fz * 0.3; return out; }
    if (this.def.id === 'turret') { out.x = this.x + fx * 1.0; out.y = 0.95; out.z = this.z + fz * 1.0; return out; }
    out.x = this.x + fx * 0.75 * s - fz * 0.15; out.y = 1.25 * s; out.z = this.z + fz * 0.75 * s + fx * 0.15;
    return out;
  }

  eyeY() { return this.y + this.def.eyeH * (this.def.id === 'drone' ? 0.0 : 1) + (this.def.id === 'drone' ? 0 : 0); }

  intersect(ox, oy, oz, dx, dy, dz, maxT, out) {
    const s = this.def.scale, id = this.def.id;
    let t = -1; out.head = false;
    if (id === 'drone') {
      t = raySphere(ox, oy, oz, dx, dy, dz, this.x, this.y, this.z, 0.42);
    } else if (id === 'camera') {
      t = raySphere(ox, oy, oz, dx, dy, dz, this.x, 2.75, this.z, 0.38);
    } else if (id === 'turret') {
      t = rayCyl(ox, oy, oz, dx, dy, dz, this.x, this.z, 0.5, 0, 1.3);
    } else {
      const th = raySphere(ox, oy, oz, dx, dy, dz, this.x, 1.62 * s, this.z, 0.22 * s);
      const tb = rayCyl(ox, oy, oz, dx, dy, dz, this.x, this.z, 0.36 * s, 0, 1.48 * s);
      if (th >= 0 && (tb < 0 || th <= tb + 0.05)) { t = th; out.head = true; } else t = tb;
    }
    return t >= 0 && t < maxT ? t : -1;
  }

  // ------------------------------------------------------------ damage
  isUnaware() { return this.state === S.PATROL || this.state === S.SUSPICIOUS || this.state === S.INVESTIGATE || this.state === S.SEARCH; }

  takeDamage(amount, head, opts = {}) {
    if (this.dead) return null;
    let dmg = amount * (head ? 2.5 : 1);
    if (this.def.armor && !head) dmg *= (1 - this.def.armor);
    const unaware = this.isUnaware() && this.def.id !== 'camera';
    if (unaware) dmg *= 1.7;
    this.hp -= dmg; this.flash = 1;
    if (this.def.id === 'humanoid' || !this.def.fixed) this.stagger = this.def.id === 'heavy' ? 0.05 : 0.2;
    const res = { dmg, killed: false, unaware };
    if (this.hp <= 0) { this.die(head, opts.silent); res.killed = true; return res; }
    // reaction: knows where the shot came from
    const p = this.g.player;
    if (this.def.id !== 'camera') {
      this.lastKnown.x = p.x; this.lastKnown.z = p.z; this.aware = 1;
      if (this.state !== S.ALERT && this.disabledT <= 0) this.enterAlert();
    }
    return res;
  }

  die(head, silent) {
    this.dead = true; this.state = S.DEAD; this.deadT = 0; this.sees = false; this.path = null;
    this.setVisor();
    if (this.cone) this.cone.visible = false;
    this.deadHead = head; this.fallDir = Math.random() < 0.7 ? 1 : -1;
    const fx = this.g.fx;
    if (this.def.elec) {
      fx.explosion(this.x, this.y + 1, this.z, 0.8); this.g.audio.play('explosion', { vol: 0.6 });
    }
    this.g.onEnemyKilled(this, head, !!silent);
  }

  emp(duration) {
    if (!this.def.elec || this.dead) return false;
    this.disabledT = Math.max(this.disabledT, duration);
    this.state = S.DISABLED; this.sees = false; this.burstLeft = 0; this.path = null;
    this.g.fx.spark(this.x, this.y + 1, this.z, 16, 0.4, 0.8, 1, 4, 0.5);
    this.g.audio.play('zap', { vol: 0.8 });
    this.setVisor();
    return true;
  }

  disablePermanent() {
    if (this.dead || !this.def.elec) return;
    this.perm = true; this.emp(1e9);
  }

  // ------------------------------------------------------------ state transitions
  enterState(s) {
    if (this.state === s) return;
    this.prevState = this.state; this.state = s; this.timer = 0; this.path = null; this.pi = 0;
    this.setVisor();
  }

  enterSuspicious(x, z) {
    this.stim.x = x; this.stim.z = z; this.enterState(S.SUSPICIOUS); this.timer = 1.1 + Math.random() * 0.5;
    this.g.audio.play('suspicious', { vol: this.audioVol(), pan: this.pan() });
  }

  enterInvestigate(x, z) {
    this.stim.x = x; this.stim.z = z; this.enterState(S.INVESTIGATE); this.arrived = false; this.lookT = 0;
    this.setPath(x, z);
  }

  enterAlert() {
    const first = this.state !== S.ALERT;
    this.enterState(S.ALERT);
    this.aware = 1; this.aimT = 0; this.loseT = 0; this.cd = 0.3; this.flankGoal = null; this.phase = 'fire'; this.phaseT = 2 + Math.random();
    this.firePos = null;
    if (first) this.mgr.onAlert(this);
  }

  enterSearch() {
    this.enterState(S.SEARCH); this.timer = this.def.id === 'elite' ? 26 : 14; this.searchT = 0;
    this.setPath(this.lastKnown.x, this.lastKnown.z);
  }

  returnToPatrol() {
    this.enterState(S.PATROL); this.aware = 0; this.waitT = 0;
    // go back to nearest waypoint
    if (this.patrol.length) {
      let bi = 0, bd = 1e9;
      this.patrol.forEach((w, i) => { const d = (w.x - this.x) ** 2 + (w.z - this.z) ** 2; if (d < bd) { bd = d; bi = i; } });
      this.pwi = bi;
    }
  }

  // ------------------------------------------------------------ audio helpers
  audioVol() { const p = this.g.player; const d = Math.hypot(this.x - p.x, this.z - p.z); return Math.max(0.05, 1 - d / 40); }
  pan() {
    const p = this.g.player; const dx = this.x - p.x, dz = this.z - p.z;
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const d = Math.hypot(dx, dz) || 1;
    return (dx * rx + dz * rz) / d * 0.8;
  }

  // ------------------------------------------------------------ perception
  perceive(dtp) {
    const g = this.g, p = g.player, def = this.def, w = g.world;
    if (def.id === 'camera' && g.camerasDown) return;
    const diff = DIFFICULTY[g.settings.difficulty] || DIFFICULTY.normal;
    const dx = p.x - this.x, dz = p.z - this.z; const dist = Math.hypot(dx, dz);
    let seen = false;
    if (!p.dead) {
      let range = def.sight * diff.sight * (p.crouched ? 0.72 : 1) * (p.sprinting ? 1.2 : 1) * (this.state === S.ALERT ? 1.3 : 1) * (g.alarmActive ? 1.15 : 1);
      if (dist < range) {
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        const inCone = def.fov >= 180 || dot >= Math.cos(def.fov * DEG);
        let ok = inCone;
        if (def.id === 'drone') ok = p.speed > def.moveThreshold || dist < def.near || p.noisy > 0;
        else if (!ok) ok = dist < def.near && (p.speed > 0.6 || p.noisy > 0);
        if (ok) {
          const ex = this.x, ez = this.z, ey = def.id === 'drone' ? this.y : (def.id === 'camera' ? 2.7 : def.eyeH);
          seen = w.los(ex, ey, ez, p.x, p.y + p.eye, p.z, g.tmpHit) || w.los(ex, ey, ez, p.x, p.y + (p.crouched ? 0.55 : 1.0), p.z, g.tmpHit);
        }
        if (seen) {
          const f = 1 - dist / range;
          let rate = (0.5 + 1.6 * f) * diff.gain;
          if (p.crouched) rate *= p.speed < 0.5 ? 0.5 : 0.75; else if (p.sprinting) rate *= 1.4; else if (p.speed < 0.5) rate *= 0.85;
          if (p.noisy > 0) rate *= 1.7;
          if (this.state === S.ALERT) rate = 10; else if (this.state === S.SEARCH) rate *= 1.5; else if (this.state === S.INVESTIGATE) rate *= 1.2;
          if (def.id === 'camera') rate *= 1.0;
          this.aware = Math.min(1, this.aware + rate * dtp);
          this.lastKnown.x = p.x; this.lastKnown.z = p.z; this.stim.x = p.x; this.stim.z = p.z; this.lastSeen = g.time;
        }
      }
    }
    this.sees = seen;
    if (!seen && this.state !== S.ALERT) {
      this.aware = Math.max(0, this.aware - (this.state === S.SEARCH ? 0.1 : 0.2) * dtp);
    }
    // bodies of fallen colleagues
    if (!seen && this.def.id !== 'drone' && !def.fixed && (this.state === S.PATROL)) {
      const list = this.mgr.list;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (!o.dead || o.found || o.def.fixed || o.def.id === 'drone') continue;
        const bx = o.x - this.x, bz = o.z - this.z, bd = Math.hypot(bx, bz);
        if (bd > 13) continue;
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        if ((bx * fx + bz * fz) / (bd || 1) < Math.cos(70 * DEG)) continue;
        if (w.los(this.x, def.eyeH, this.z, o.x, 0.3, o.z, g.tmpHit)) {
          o.found = true; this.aware = Math.max(this.aware, 0.75); this.enterSuspicious(o.x, o.z); g.onBodyFound(this, o); break;
        }
      }
    }
  }

  hear(x, z, radius, gain, fromPlayer) {
    if (this.dead || this.disabledT > 0 || this.def.hearing <= 0) return;
    const w = this.g.world;
    const d = Math.hypot(x - this.x, z - this.z);
    if (d > radius * this.def.hearing * 1.2) return;
    const eff = d * (1 + 0.85 * w.wallsBetween(x, z, this.x, this.z)) / this.def.hearing;
    if (eff > radius) return;
    const f = 1 - eff / radius;
    this.aware = Math.min(1, Math.max(this.aware, 0.2 * gain + 0.4 * f * gain) + 0.2 * f * gain);
    this.stim.x = x; this.stim.z = z;
    if (fromPlayer) { this.lastKnown.x = x; this.lastKnown.z = z; }
    if (this.state === S.ALERT) return;
    if (this.aware >= 1) { this.lastKnown.x = x; this.lastKnown.z = z; this.enterAlert(); return; }
    if (this.aware >= 0.3) {
      if (this.state === S.PATROL) this.enterSuspicious(x, z);
      else if (this.state === S.INVESTIGATE || this.state === S.SEARCH) { this.setPath(x, z); }
    }
  }

  // ------------------------------------------------------------ movement
  turnTo(yaw, rate, dt) {
    const d = angDiff(yaw, this.yaw); const step = rate * dt;
    this.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
    return Math.abs(d);
  }

  setPath(tx, tz) {
    const p = this.g.world.findPath(this.x, this.z, tx, tz, this.r + 0.08);
    this.path = p; this.pi = 0; this.pathGoal = { x: tx, z: tz }; this.repathT = 0.5; this.stuckT = 0;
    return !!p;
  }

  steer(dt, tx, tz, speed, face = true) {
    const dx = tx - this.x, dz = tz - this.z; const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.moving = false; return true; }
    if (face) {
      const want = Math.atan2(-dx, -dz);
      const diff = this.turnTo(want, this.def.id === 'drone' ? 6 : 8, dt);
      if (diff > 1.3) { this.moving = false; return false; }
    }
    const step = Math.min(d, speed * dt);
    const w = this.g.world;
    const px = this.x, pz = this.z;
    w.moveCircle(this, (dx / d) * step, (dz / d) * step, this.r, this.def.flying ? this.y : 0);
    this.moving = true; this.speedNow = speed;
    this.walk += speed * dt * 2.6;
    return false;
  }

  followPath(dt, speed) {
    if (!this.path || this.pi >= this.path.length) return true;
    const n = this.path[this.pi];
    const last = this.pi === this.path.length - 1;
    const arrived = this.steer(dt, n.x, n.z, speed);
    if (arrived || Math.hypot(n.x - this.x, n.z - this.z) < (last ? 0.25 : 0.45)) { this.pi++; if (this.pi >= this.path.length) { this.path = null; return true; } }
    // stuck handling
    this.stuckCheck += dt;
    if (this.stuckCheck > 0.6) {
      const moved = Math.hypot(this.x - this.sx, this.z - this.sz);
      this.sx = this.x; this.sz = this.z; this.stuckCheck = 0;
      if (moved < speed * 0.6 * 0.25 && this.stagger <= 0) {
        this.stuckT += 1;
        if (this.stuckT >= 2 && this.pathGoal) { this.setPath(this.pathGoal.x, this.pathGoal.z); }
        if (this.stuckT >= 4) { const c = this.g.world.nearestNav(this.g.world.cx(this.x), this.g.world.cx(this.z)); if (c >= 0) { this.x += (this.g.world.center(c % this.g.world.W) - this.x) * 0.5; this.z += (this.g.world.center(Math.floor(c / this.g.world.W)) - this.z) * 0.5; } this.stuckT = 0; }
      } else this.stuckT = 0;
    }
    return false;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.g, def = this.def;
    if (this.dead) { this.updateDead(dt); this.syncModel(dt); return; }
    this.flash = Math.max(0, this.flash - dt * 4);
    this.stagger = Math.max(0, this.stagger - dt);
    if (this.disabledT > 0) {
      if (!this.perm) this.disabledT -= dt;
      if (def.flying) this.y = Math.max(0.3, this.y - dt * 3);
      if (this.disabledT <= 0) { this.y = this.baseY; this.state = S.PATROL; this.aware = 0; this.setVisor(); this.g.fx.spark(this.x, this.y + 0.5, this.z, 8, 0.4, 1, 0.8, 3, 0.4); }
      else { if (Math.random() < dt * 2) g.fx.spark(this.x, this.y + 1, this.z, 2, 0.5, 0.8, 1, 2, 0.3); this.syncModel(dt); this.updateCone(dt); return; }
    }
    // perception on a staggered 10 Hz cadence
    this.percAcc += dt; this.percT -= dt;
    if (this.percT <= 0) { this.percT = 0.1; const a = this.percAcc; this.percAcc = 0; this.perceive(a); }
    this.moving = false;
    // doors
    this.doorT -= dt;
    if (this.doorT <= 0 && !def.fixed) { this.doorT = 0.25; g.world.openDoorsNear(this.x, this.z, this.state === S.ALERT ? 2.4 : 2.0); }

    if (this.stagger > 0 && def.id !== 'heavy') { this.syncModel(dt); this.updateCone(dt); return; }

    if (def.fixed) this.updateFixed(dt);
    else {
      switch (this.state) {
        case S.PATROL: this.doPatrol(dt); break;
        case S.SUSPICIOUS: this.doSuspicious(dt); break;
        case S.INVESTIGATE: this.doInvestigate(dt); break;
        case S.ALERT: this.doAlert(dt); break;
        case S.SEARCH: this.doSearch(dt); break;
        default: break;
      }
      this.separate(dt);
    }
    if (def.flying && this.disabledT <= 0) this.y += (this.baseY - this.y) * Math.min(1, dt * 4);
    this.syncModel(dt);
    this.updateCone(dt);
  }

  separate(dt) {
    // soft push apart so enemies do not stack
    const list = this.mgr.list;
    for (let i = 0; i < list.length; i++) {
      const o = list[i]; if (o === this || o.dead || o.def.fixed) continue;
      const dx = this.x - o.x, dz = this.z - o.z; const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-4) { const d = Math.sqrt(d2); const push = (0.8 - d) * 2.5 * dt; this.g.world.moveCircle(this, (dx / d) * push, (dz / d) * push, this.r, this.def.flying ? this.y : 0); }
    }
  }

  updateDead(dt) {
    this.deadT += dt;
    const p = this.parts;
    if (this.def.flying) {
      this.y = Math.max(0.2, this.y - dt * 7);
      p.hover.rotation.z += dt * 6 * (this.deadT < 0.6 ? 1 : 0);
    } else if (!this.def.fixed) {
      const k = Math.min(1, this.deadT * 2.2);
      p.body.rotation.x = this.fallDir * (Math.PI / 2) * k * k;
      p.body.position.y = 0.12 * k;
      p.arms[0].rotation.x = -0.4 * k; p.arms[1].rotation.x = 0.4 * k; p.legs[0].rotation.x = 0.15 * k; p.legs[1].rotation.x = -0.1 * k;
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.flash > 0) p.bodyMat.emissive.setRGB(this.flash * 0.6, 0.1 * this.flash, 0);
  }

  // ---- PATROL
  doPatrol(dt) {
    const def = this.def;
    if (this.aware >= 1) { this.enterAlert(); return; }
    if (this.aware >= 0.3) { this.enterSuspicious(this.stim.x, this.stim.z); return; }
    if (!this.patrol.length) { this.yaw += Math.sin(this.g.time * 0.7 + this.id) * dt * 0.6; return; }
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.yaw += Math.sin(this.g.time * 1.3 + this.id) * dt * 1.1;      // look around
      return;
    }
    const wp = this.patrol[this.pwi];
    if (!this.path) {
      if (Math.hypot(wp.x - this.x, wp.z - this.z) < 0.6) { this.advanceWp(); return; }
      if (!this.setPath(wp.x, wp.z)) { this.advanceWp(); return; }
    }
    if (this.followPath(dt, def.speed)) { this.path = null; this.waitT = 0.8 + Math.random() * 1.8; this.advanceWp(); }
  }

  advanceWp() {
    const n = this.patrol.length;
    if (n <= 1) return;
    if (this.loop) this.pwi = (this.pwi + 1) % n;
    else { this.pwi += this.pdir; if (this.pwi >= n) { this.pwi = n - 2; this.pdir = -1; } else if (this.pwi < 0) { this.pwi = 1; this.pdir = 1; } }
    this.path = null;
  }

  // ---- SUSPICIOUS
  doSuspicious(dt) {
    const want = Math.atan2(-(this.stim.x - this.x), -(this.stim.z - this.z));
    this.turnTo(want, 3.2, dt);
    this.timer -= dt;
    if (this.aware >= 1) { this.enterAlert(); return; }
    if (this.aware < 0.12) { this.returnToPatrol(); return; }
    if (this.timer <= 0) {
      if (this.aware >= 0.3) this.enterInvestigate(this.stim.x, this.stim.z);
      else this.returnToPatrol();
    }
  }

  // ---- INVESTIGATE
  doInvestigate(dt) {
    if (this.aware >= 1) { this.enterAlert(); return; }
    if (!this.arrived) {
      if (!this.path) this.setPath(this.stim.x, this.stim.z);
      const done = !this.path || this.followPath(dt, this.def.speed * 1.45);
      if (done || Math.hypot(this.stim.x - this.x, this.stim.z - this.z) < 1.0) { this.arrived = true; this.timer = 2.8; }
    } else {
      this.timer -= dt;
      this.yaw += Math.sin(this.g.time * 2.2 + this.id) * dt * 1.8;
      if (this.timer <= 0) this.returnToPatrol();
    }
  }

  // ---- SEARCH
  doSearch(dt) {
    if (this.aware >= 1) { this.enterAlert(); return; }
    this.timer -= dt;
    if (this.timer <= 0) { this.returnToPatrol(); return; }
    this.searchT -= dt;
    if (this.path) {
      const done = this.followPath(dt, this.def.speed * 1.5);
      if (done) { this.path = null; this.lookT = 1.5; }
    } else if (this.lookT > 0) {
      this.lookT -= dt; this.yaw += Math.sin(this.g.time * 2.6 + this.id) * dt * 2.4;
    } else {
      const spot = this.g.world.randomNavNear(this.lastKnown.x, this.lastKnown.z, this.def.id === 'elite' ? 8 : 5);
      if (spot) this.setPath(spot.x, spot.z); else this.lookT = 1;
    }
  }

  // ---- ALERT
  doAlert(dt) {
    const g = this.g, def = this.def, p = g.player;
    if (p.dead) { this.returnToPatrol(); return; }
    const dist = Math.hypot(p.x - this.x, p.z - this.z);
    if (this.sees) {
      this.loseT = 0;
      this.engage(dt, dist);
    } else {
      this.loseT += dt; this.burstLeft = 0; this.aimT = 0;
      const wait = def.id === 'elite' ? 1.0 : 2.2;
      if (this.loseT > wait) this.hunt(dt);
      else this.turnTo(Math.atan2(-(this.lastKnown.x - this.x), -(this.lastKnown.z - this.z)), 5, dt);
    }
    if (this.loseT > 14) this.enterSearch();
  }

  hunt(dt) {
    // chase last known position; elites use alternate flanking approaches
    const def = this.def, w = this.g.world, p = this.g.player;
    this.repathT -= dt;
    if (def.id === 'elite') {
      this.flankT -= dt;
      if (!this.flankGoal || this.flankT <= 0) { this.pickFlank(); this.flankT = 5; }
    }
    if (!this.path || this.repathT <= 0) {
      const goal = (def.id === 'elite' && this.flankGoal && this.loseT < 8) ? this.flankGoal : this.lastKnown;
      if (!this.setPath(goal.x, goal.z)) this.repathT = 1;
      this.repathT = 0.9;
    }
    const done = this.followPath(dt, def.run);
    if (done) {
      this.path = null;
      if (this.flankGoal && def.id === 'elite' && Math.hypot(this.lastKnown.x - this.x, this.lastKnown.z - this.z) > 3) { this.flankGoal = null; this.repathT = 0; return; }
      if (Math.hypot(this.lastKnown.x - this.x, this.lastKnown.z - this.z) < 2.0) this.enterSearch();
    }
  }

  pickFlank() {
    const g = this.g, w = g.world, p = g.player;
    const base = Math.random() * TAU;
    const myAng = Math.atan2(this.z - p.z, this.x - p.x);
    let best = null, bd = 1e9;
    for (let k = 0; k < 12; k++) {
      const a = base + (k * TAU) / 12, r = 6 + (k % 3) * 1.5;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const c = w.cx(x), cz = w.cx(z);
      if (!w.inB(c, cz) || !w.nav[w.idx(c, cz)]) continue;
      if (Math.abs(angDiff(a, myAng)) < 1.1) continue;
      if (!w.los(x, 1.0, z, p.x, p.y + p.eye, p.z, g.tmpHit)) continue;
      const d = Math.hypot(x - this.x, z - this.z);
      if (d < bd) { bd = d; best = { x: w.center(c), z: w.center(cz) }; }
    }
    this.flankGoal = best;
  }

  engage(dt, dist) {
    const g = this.g, def = this.def, p = g.player, w = g.world;
    const want = Math.atan2(-(p.x - this.x), -(p.z - this.z));
    const off = this.turnTo(want, def.id === 'drone' ? 5 : 7, dt);
    this.aimT += dt;
    // positioning
    const ideal = { guard: 9, heavy: 12, elite: 6.5, drone: 6 }[def.id] || 9;
    if (def.id === 'heavy') this.heavyCover(dt, dist);
    else if (def.id === 'elite' && dist > ideal + 3) {
      this.flankT -= dt;
      if (!this.flankGoal && this.flankT <= 0) { this.pickFlank(); this.flankT = 4; }
      this.repathT -= dt;
      if (this.flankGoal && Math.hypot(this.flankGoal.x - this.x, this.flankGoal.z - this.z) > 1.5) {
        if (!this.path || this.repathT <= 0) { this.setPath(this.flankGoal.x, this.flankGoal.z); this.repathT = 1; }
        this.followPath(dt, def.run);
      } else {
        this.flankGoal = null;
        if (!this.path || this.repathT <= 0) { this.setPath(p.x, p.z); this.repathT = 0.6; }
        this.followPath(dt, def.run);
      }
    } else if (dist > ideal + 4) {
      this.repathT -= dt;
      if (!this.path || this.repathT <= 0) { this.setPath(p.x, p.z); this.repathT = 0.6; }
      this.followPath(dt, def.run * 0.9);
    } else {
      // strafe while firing
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 1.2 + Math.random() * 2; }
      const rx = Math.cos(this.yaw) * this.strafe, rz = -Math.sin(this.yaw) * this.strafe;
      const sp = def.speed * (def.id === 'drone' ? 1.2 : 0.8);
      const px = this.x, pz = this.z;
      const hit = w.moveCircle(this, rx * sp * dt, rz * sp * dt, this.r, def.flying ? this.y : 0);
      if (hit) this.strafe = -this.strafe;
      this.moving = true; this.walk += sp * dt * 2.6;
      if (dist < ideal - 3.5 && !def.flying) w.moveCircle(this, -Math.sin(want) * -1 * -sp * dt * 0, 0, this.r, 0);
    }
    this.shootLogic(dt, off, dist);
  }

  heavyCover(dt, dist) {
    const g = this.g, w = g.world, p = g.player;
    this.phaseT -= dt;
    if (this.phase === 'fire') {
      if (this.phaseT <= 0) {
        const c = this.findCover();
        if (c) { this.firePos = { x: this.x, z: this.z }; this.cover = c; this.phase = 'toCover'; this.setPath(c.x, c.z); this.burstLeft = 0; }
        else this.phaseT = 2;
      } else {
        this.strafeT -= dt; if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 1.5 + Math.random() * 1.5; }
        const rx = Math.cos(this.yaw) * this.strafe, rz = -Math.sin(this.yaw) * this.strafe;
        if (w.moveCircle(this, rx * 0.9 * dt, rz * 0.9 * dt, this.r, 0)) this.strafe = -this.strafe;
        this.moving = true; this.walk += dt * 2.5;
      }
    } else if (this.phase === 'toCover') {
      const done = !this.path || this.followPath(dt, this.def.run);
      if (done) { this.phase = 'hold'; this.phaseT = 1.4 + Math.random(); this.path = null; }
    } else if (this.phase === 'hold') {
      this.burstLeft = 0; this.aimT = 0;
      if (this.phaseT <= 0) { this.phase = 'toFire'; if (this.firePos) this.setPath(this.firePos.x, this.firePos.z); }
    } else if (this.phase === 'toFire') {
      const done = !this.path || this.followPath(dt, this.def.run);
      if (done || this.sees) { this.phase = 'fire'; this.phaseT = 2.2 + Math.random() * 1.5; this.path = null; }
    }
  }

  findCover() {
    const g = this.g, w = g.world, p = g.player;
    const cx0 = w.cx(this.x), cz0 = w.cx(this.z);
    let best = null, bd = 1e9;
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      if (!w.inB(cx, cz) || w.ch[w.idx(cx, cz)] !== '.') continue;
      const x = w.center(cx), z = w.center(cz);
      if (Math.hypot(x - p.x, z - p.z) < 3.5) continue;
      if (w.los(p.x, p.y + p.eye, p.z, x, 1.0, z, g.tmpHit)) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = { x, z }; }
    }
    return best;
  }

  shootLogic(dt, off, dist) {
    const g = this.g, def = this.def;
    if (this.phase === 'toCover' || this.phase === 'hold' || this.phase === 'toFire') return;
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) { this.fire(dist); this.burstLeft--; this.burstT = def.burstGap; if (this.burstLeft === 0) this.cd = def.cooldown * (0.8 + Math.random() * 0.5); }
    } else {
      this.cd -= dt;
      if (this.cd <= 0 && this.aimT >= def.aim && off < 0.3 && dist < def.sight * 1.3) { this.burstLeft = def.burst; this.burstT = 0; }
    }
  }

  fire(dist) {
    const g = this.g, def = this.def, p = g.player, diff = DIFFICULTY[g.settings.difficulty] || DIFFICULTY.normal;
    const m = this.muzzle(g.tmpV);
    let pHit = def.acc * (1 - 0.5 * Math.min(1, dist / 28));
    if (p.speed > 2.5) pHit *= 0.8; if (p.crouched) pHit *= 0.78; if (p.ads) pHit *= 0.9;
    // cover check: only count a hit if the line to the chest is clear
    const tx = p.x, ty = p.y + (p.crouched ? 0.6 : 1.1), tz = p.z;
    const clear = g.world.los(m.x, m.y, m.z, tx, ty, tz, g.tmpHit);
    const hit = clear && Math.random() < pHit;
    g.audio.play('enemyShot', { vol: this.audioVol(), pan: this.pan() });
    if (hit) {
      g.fx.tracer(m.x, m.y, m.z, tx, ty, tz, 0xff4466, 0.03, 0.09);
      g.hurtPlayer(def.dmg * diff.dmg * (0.85 + Math.random() * 0.3), this);
    } else {
      const sp = 0.9 + dist * 0.04;
      const ex = tx + (Math.random() - 0.5) * sp * 1.6, ey = ty + (Math.random() - 0.5) * sp, ez = tz + (Math.random() - 0.5) * sp * 1.6;
      let dx = ex - m.x, dy = ey - m.y, dz = ez - m.z; const d = Math.hypot(dx, dy, dz); dx /= d; dy /= d; dz /= d;
      let t = Math.min(d + 6, 60);
      if (g.world.raycast(m.x, m.y, m.z, dx, dy, dz, t, g.tmpHit)) { t = g.tmpHit.t; g.fx.impact(m.x + dx * t, m.y + dy * t, m.z + dz * t, g.tmpHit.nx, g.tmpHit.ny, g.tmpHit.nz); }
      g.fx.tracer(m.x, m.y, m.z, m.x + dx * t, m.y + dy * t, m.z + dz * t, 0xff4466, 0.03, 0.09);
      if (clear && dist < 30) g.audio.play('whiz', { vol: 0.8, pan: this.pan() });
    }
  }

  // ---- cameras and turrets
  updateFixed(dt) {
    const def = this.def, g = this.g;
    if (def.id === 'camera' && g.camerasDown) { return; }
    if (this.state === S.ALERT) {
      if (this.sees) { this.loseT = 0; const p = g.player; this.turnTo(Math.atan2(-(p.x - this.x), -(p.z - this.z)), 3.5, dt); if (def.id === 'turret') { this.aimT += dt; this.shootLogic(dt, 0, Math.hypot(p.x - this.x, p.z - this.z)); } }
      else { this.loseT += dt; this.burstLeft = 0; this.aimT = 0; if (this.loseT > (def.id === 'camera' ? 3.5 : 4)) { this.state = S.PATROL; this.aware = 0.1; this.setVisor(); } }
      if (def.id === 'camera' && this.state === S.ALERT && !this.tripped) { this.tripped = true; g.onCameraTrip(this); }
      if (def.id === 'camera' && this.state === S.ALERT && this.sees) g.keepAlarm();
    } else {
      this.tripped = false;
      this.scanT += dt;
      const sweep = this.sweep || 40 * DEG;
      this.yaw = this.baseYaw + Math.sin((this.scanT / this.period) * TAU) * sweep;
      if (this.aware >= 1) this.enterAlert();
      else if (this.aware >= 0.3 && this.state === S.PATROL) { this.state = S.SUSPICIOUS; this.setVisor(); }
      else if (this.aware < 0.15 && this.state === S.SUSPICIOUS) { this.state = S.PATROL; this.setVisor(); }
    }
  }
}

// ---------------------------------------------------------------- manager
export class EnemyManager {
  constructor(game) { this.g = game; this.list = []; this.nextId = 1; this.tmp = { head: false }; }

  spawn(spec) { const e = new Enemy(this, spec, this.nextId++); this.list.push(e); return e; }

  clear() {
    for (const e of this.list) {
      this.g.scene.remove(e.group3);
      for (const m of e.parts.mats) m.dispose();
      if (e.cone) { this.g.scene.remove(e.cone); e.cone.geometry.dispose(); e.cone.material.dispose(); }
    }
    this.list.length = 0;
  }

  update(dt) { for (let i = 0; i < this.list.length; i++) this.list[i].update(dt); }

  alive() { let n = 0; for (const e of this.list) if (!e.dead && !e.def.fixed && e.def.id !== 'drone') n++; return n; }

  /** nearest enemy intersected by a ray, or null. out.t / out.head are filled. */
  rayHit(ox, oy, oz, dx, dy, dz, maxT, out) {
    let best = null, bt = maxT;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i]; if (e.dead) continue;
      const t = e.intersect(ox, oy, oz, dx, dy, dz, bt, this.tmp);
      if (t >= 0 && t < bt) { bt = t; best = e; out.head = this.tmp.head; }
    }
    out.t = bt; return best;
  }

  noise(x, z, radius, gain = 1, fromPlayer = true) {
    for (let i = 0; i < this.list.length; i++) this.list[i].hear(x, z, radius, gain, fromPlayer);
  }

  onAlert(src) {
    // shout to nearby allies
    this.g.onEnemyAlert(src);
    const w = this.g.world;
    for (const o of this.list) {
      if (o === src || o.dead || o.disabledT > 0 || o.def.fixed) continue;
      const d = Math.hypot(o.x - src.x, o.z - src.z);
      const eff = d * (1 + 0.6 * w.wallsBetween(src.x, src.z, o.x, o.z));
      if (eff > (src.def.id === 'drone' ? 40 : 20)) continue;
      o.lastKnown.x = src.lastKnown.x; o.lastKnown.z = src.lastKnown.z;
      o.aware = Math.max(o.aware, 0.55);
      if (o.state === S.PATROL || o.state === S.SUSPICIOUS || o.state === S.SEARCH) o.enterInvestigate(src.lastKnown.x, src.lastKnown.z);
      else if (o.state === S.INVESTIGATE) o.setPath(src.lastKnown.x, src.lastKnown.z);
    }
  }

  /** global alarm: everyone converges on the position */
  alarm(x, z) {
    for (const o of this.list) {
      if (o.dead || o.disabledT > 0 || o.def.fixed) continue;
      o.lastKnown.x = x; o.lastKnown.z = z; o.aware = Math.max(o.aware, 0.6);
      if (o.state !== S.ALERT) o.enterInvestigate(x, z);
    }
  }

  emp(x, z, radius, duration) {
    let n = 0;
    for (const o of this.list) {
      if (o.dead || !o.def.elec) continue;
      if (Math.hypot(o.x - x, o.z - z) <= radius) { if (o.emp(duration)) n++; }
    }
    return n;
  }

  disableGroup(group) { for (const o of this.list) if (o.group === group && o.def.elec && !o.dead) o.disablePermanent(); }
  disableAllElectronics(kind) { for (const o of this.list) if (o.def.id === kind && !o.dead) o.disablePermanent(); }
}
