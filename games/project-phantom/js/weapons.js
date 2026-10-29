// Weapon state (ammo, reload, recoil springs) and procedural first-person viewmodels.
import { WEAPONS, UPGRADES } from './data.js';

const THREE = window.THREE;

export function effectiveStats(id, ups) {
  const w = WEAPONS[id], u = ups || {};
  const d = u.dmg || 0, m = u.mag || 0, h = u.hand || 0;
  return Object.assign({}, w, {
    dmg: w.dmg * (1 + 0.12 * d),
    mag: Math.round(w.mag * (1 + 0.25 * m)),
    reserve: Math.round(w.reserve * (1 + 0.25 * m)),
    reload: w.reload * (1 - 0.12 * h),
    recoil: w.recoil * (1 - 0.1 * h),
  });
}

// ------------------------------------------------------------------ viewmodels
function buildViewmodel(id, color) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.4, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0f1319, roughness: 0.6, metalness: 0.5 });
  const accent = new THREE.MeshBasicMaterial({ color });
  const glove = new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.8, metalness: 0.1 });
  const mats = [metal, dark, accent, glove];
  const geos = [];
  const bx = (w, h, d, m, x, y, z, rx = 0) => {
    const ge = new THREE.BoxGeometry(w, h, d); geos.push(ge);
    const o = new THREE.Mesh(ge, m); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o;
  };
  const cyl = (r, len, m, x, y, z) => {
    const ge = new THREE.CylinderGeometry(r, r, len, 12); geos.push(ge);
    const o = new THREE.Mesh(ge, m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); g.add(o); return o;
  };
  let muzzleZ = -0.45, adsY = 0.0;
  if (id === 'spectre') {
    bx(0.055, 0.075, 0.3, metal, 0, 0, -0.1);
    bx(0.045, 0.12, 0.06, dark, 0, -0.09, 0.02, 0.25);
    cyl(0.026, 0.22, dark, 0, 0.0, -0.36);
    bx(0.02, 0.012, 0.22, accent, 0, 0.042, -0.1);
    bx(0.01, 0.02, 0.02, dark, 0, 0.05, -0.22);
    muzzleZ = -0.47; adsY = 0.055;
  } else if (id === 'vortex') {
    bx(0.07, 0.1, 0.5, metal, 0, 0, -0.15);
    bx(0.03, 0.03, 0.28, dark, 0, 0.01, -0.54);
    bx(0.05, 0.16, 0.08, dark, 0, -0.12, -0.12, 0.2);
    bx(0.055, 0.1, 0.22, dark, 0, -0.01, 0.2);
    bx(0.05, 0.1, 0.06, dark, 0, -0.1, 0.04, 0.3);
    bx(0.025, 0.012, 0.34, accent, 0, 0.054, -0.15);
    bx(0.02, 0.04, 0.1, dark, 0, 0.085, -0.1);
    bx(0.074, 0.02, 0.1, accent, 0, -0.02, -0.36);
    muzzleZ = -0.7; adsY = 0.095;
  } else if (id === 'reaper') {
    bx(0.07, 0.1, 0.36, metal, 0, 0, -0.08);
    bx(0.03, 0.03, 0.18, dark, 0, 0.01, -0.34);
    bx(0.045, 0.24, 0.06, dark, 0, -0.17, -0.1, 0.05);
    bx(0.05, 0.09, 0.05, dark, 0, -0.09, 0.05, 0.3);
    bx(0.04, 0.09, 0.05, dark, 0, -0.07, -0.26);
    bx(0.025, 0.012, 0.26, accent, 0, 0.054, -0.08);
    bx(0.01, 0.02, 0.2, dark, 0, 0.07, -0.05);
    muzzleZ = -0.45; adsY = 0.075;
  } else if (id === 'longshot') {
    bx(0.07, 0.1, 0.46, metal, 0, 0, -0.1);
    bx(0.035, 0.035, 0.6, dark, 0, 0.012, -0.64);
    bx(0.06, 0.1, 0.3, dark, 0, -0.015, 0.28);
    bx(0.05, 0.1, 0.06, dark, 0, -0.1, 0.04, 0.3);
    cyl(0.04, 0.26, dark, 0, 0.1, -0.12);
    cyl(0.032, 0.02, accent, 0, 0.1, -0.26);
    bx(0.025, 0.012, 0.26, accent, 0, 0.054, -0.1);
    muzzleZ = -0.98; adsY = 0.115;
  } else { // arc
    bx(0.1, 0.12, 0.38, metal, 0, 0, -0.1);
    bx(0.05, 0.12, 0.06, dark, 0, -0.1, 0.04, 0.3);
    bx(0.06, 0.08, 0.2, dark, 0, -0.01, 0.2);
    for (let i = 0; i < 3; i++) {
      const tg = new THREE.TorusGeometry(0.06 + i * 0.008, 0.012, 6, 16); geos.push(tg);
      const t = new THREE.Mesh(tg, accent); t.position.set(0, 0.0, -0.32 - i * 0.07); g.add(t);
    }
    const sg = new THREE.SphereGeometry(0.035, 10, 8); geos.push(sg);
    const core = new THREE.Mesh(sg, accent); core.position.set(0, 0.0, -0.2); g.add(core);
    bx(0.03, 0.03, 0.2, dark, 0, 0, -0.55);
    muzzleZ = -0.66; adsY = 0.065;
  }
  // gloved hands and forearms
  bx(0.075, 0.07, 0.11, glove, 0.0, -0.075, 0.03);
  bx(0.05, 0.05, 0.3, glove, 0.03, -0.14, 0.2, -0.4);
  bx(0.075, 0.07, 0.11, glove, 0.0, -0.06, -0.26);
  bx(0.05, 0.05, 0.3, glove, -0.09, -0.13, -0.12, 0.1).rotation.z = 0.5;
  // muzzle flash sprite + anchor
  const fc = document.createElement('canvas'); fc.width = fc.height = 64;
  const fg = fc.getContext('2d');
  const gr = fg.createRadialGradient(32, 32, 1, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,220,120,0.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
  fg.fillStyle = gr; fg.fillRect(0, 0, 64, 64);
  fg.strokeStyle = 'rgba(255,230,160,0.9)'; fg.lineWidth = 3; fg.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; fg.moveTo(32, 32); fg.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31); } fg.stroke();
  const ft = new THREE.CanvasTexture(fc);
  const fm = new THREE.MeshBasicMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fgeo = new THREE.PlaneGeometry(0.22, 0.22); geos.push(fgeo);
  const flash = new THREE.Mesh(fgeo, fm); flash.position.set(0, 0.0, muzzleZ); flash.visible = false; g.add(flash);
  mats.push(fm); mats.push({ dispose() { ft.dispose(); } });
  g.userData = { flash, muzzleZ, adsY, dispose() { geos.forEach((x) => x.dispose()); mats.forEach((m) => m.dispose()); } };
  return g;
}

// ------------------------------------------------------------------ weapon system
export class WeaponSystem {
  constructor(vmScene, audio) {
    this.vmScene = vmScene; this.audio = audio;
    this.slots = []; this.cur = 0; this.models = {};
    this.fireT = 0; this.reloadT = 0; this.reloadDur = 1; this.switchT = 0; this.pendingSwitch = -1;
    this.kick = 0; this.kickRot = 0; this.adsT = 0; this.bob = 0; this.sprintT = 0; this.flashT = 0;
    this.sway = { x: 0, y: 0 };
    this.holder = new THREE.Group(); vmScene.add(this.holder);
    this.holder.position.set(0.2, -0.2, -0.52); this.holder.scale.setScalar(0.72);
  }

  setLoadout(save) {
    for (const k of Object.keys(this.models)) { this.holder.remove(this.models[k]); this.models[k].userData.dispose(); }
    this.models = {};
    this.slots = save.equipped.map((id) => {
      const st = effectiveStats(id, save.upgrades[id]);
      return { id, st, mag: st.mag, reserve: st.reserve };
    });
    this.cur = 0; this.reloadT = 0; this.fireT = 0; this.switchT = 0; this.pendingSwitch = -1;
    this.showModel();
  }

  get w() { return this.slots[this.cur]; }

  showModel() {
    for (const k of Object.keys(this.models)) this.models[k].visible = false;
    const id = this.w.id;
    if (!this.models[id]) { this.models[id] = buildViewmodel(id, WEAPONS[id].color); this.holder.add(this.models[id]); }
    this.models[id].visible = true;
  }

  switchTo(i) {
    if (i < 0 || i >= this.slots.length || i === this.cur || this.pendingSwitch >= 0) return false;
    this.pendingSwitch = i; this.switchT = 0.32; this.reloadT = 0;
    return true;
  }

  cycle(dir) { const n = this.slots.length; if (n > 1) this.switchTo((this.cur + dir + n) % n); }

  canFire() { return this.fireT <= 0 && this.reloadT <= 0 && this.pendingSwitch < 0 && this.switchT <= 0 && this.w.mag > 0; }

  fire() {
    const w = this.w;
    w.mag--; this.fireT = w.st.rate;
    this.kick = Math.min(1.4, this.kick + 1); this.kickRot = (Math.random() - 0.5) * 0.4;
    if (!w.st.suppressed) this.flashT = 0.05; else this.flashT = 0.02;
    return w.st;
  }

  needsReload() { return this.w.mag < this.w.st.mag && this.w.reserve > 0; }

  startReload() {
    const w = this.w;
    if (this.reloadT > 0 || this.pendingSwitch >= 0 || !this.needsReload()) return false;
    this.reloadDur = this.reloadT = w.st.reload;
    this.audio.play('reload', { t: this.reloadDur });
    return true;
  }

  addAmmo(frac) {
    let got = false;
    for (const s of this.slots) {
      const cap = s.st.reserve + s.st.mag;
      const have = s.reserve + s.mag;
      if (have < cap * 1.6) { s.reserve += Math.ceil(s.st.reserve * frac); got = true; }
    }
    return got;
  }

  update(dt, st) {
    // st: {firing, ads, speed, sprinting, crouched, grounded, t}
    this.fireT = Math.max(0, this.fireT - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        const w = this.w, need = w.st.mag - w.mag, take = Math.min(need, w.reserve);
        w.mag += take; w.reserve -= take;
        this.audio.play('reloadDone');
      }
    }
    if (this.pendingSwitch >= 0) {
      this.switchT -= dt;
      if (this.switchT <= 0) { this.cur = this.pendingSwitch; this.pendingSwitch = -1; this.switchT = 0.3; this.showModel(); }
    } else if (this.switchT > 0) this.switchT -= dt;

    const wantAds = st.ads && this.reloadT <= 0 && this.pendingSwitch < 0 && !st.sprinting;
    this.adsT += ((wantAds ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    this.sprintT += ((st.sprinting && st.speed > 1 ? 1 : 0) - this.sprintT) * Math.min(1, dt * 9);
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flashT = Math.max(0, this.flashT - dt);

    const model = this.models[this.w.id];
    if (!model) return;
    const U = model.userData;
    this.bob += dt * st.speed * 2.1;
    const bobAmt = st.grounded ? Math.min(1, st.speed / 4) * (1 - this.adsT * 0.85) : 0;
    const bx = Math.sin(this.bob) * 0.008 * bobAmt, by = Math.abs(Math.cos(this.bob)) * 0.01 * bobAmt;
    // sway from look input
    this.sway.x += (-st.lookX * 0.0003 - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (st.lookY * 0.0003 - this.sway.y) * Math.min(1, dt * 8);
    const sx = Math.max(-0.03, Math.min(0.03, this.sway.x)), sy = Math.max(-0.03, Math.min(0.03, this.sway.y));
    const a = this.adsT;
    let px = 0.2 * (1 - a) + bx + sx;
    let py = -0.2 * (1 - a) + (-(U.adsY * 0.72 + 0.012)) * a + by + sy;
    let pz = -0.52 * (1 - a) + -0.42 * a + this.kick * 0.04 * (1 - a * 0.6);
    let rx = this.kick * 0.07 * (1 - a * 0.5), ry = 0, rz = this.kickRot * this.kick * 0.1;
    // reload dip
    if (this.reloadT > 0) {
      const p = 1 - this.reloadT / this.reloadDur, k = Math.sin(p * Math.PI);
      py -= k * 0.16; rx -= k * 0.5; rz += k * 0.5; px -= k * 0.05;
    }
    // switching
    if (this.pendingSwitch >= 0) { const k = 1 - Math.max(0, this.switchT) / 0.32; py -= k * 0.4; rx -= k * 0.6; }
    else if (this.switchT > 0) { const k = this.switchT / 0.3; py -= k * 0.4; rx -= k * 0.6; }
    // sprint pose
    py -= this.sprintT * 0.08; rx -= this.sprintT * 0.35; ry += this.sprintT * 0.55; px -= this.sprintT * 0.05;
    this.holder.position.set(px, py, pz);
    this.holder.rotation.set(rx, ry, rz);
    U.flash.visible = this.flashT > 0;
    if (U.flash.visible) { U.flash.rotation.z = Math.random() * 6; const s = (this.w.st.suppressed ? 0.35 : 0.8) + Math.random() * 0.4; U.flash.scale.set(s, s, 1); }
    // hide the model when looking through the sniper scope
    model.visible = !(this.w.st.scope && a > 0.85);
  }

  /** accuracy cone in degrees for the crosshair & shot spread */
  spreadDeg(st) {
    const w = this.w.st;
    const base = w.hipSpread + (w.spread - w.hipSpread) * this.adsT;
    const mv = Math.min(1, st.speed / 5) * (st.grounded ? 1 : 1.6);
    return base * (1 + mv * 0.9 + this.kick * 0.25) * (st.crouched ? 0.7 : 1);
  }

  dispose() {
    for (const k of Object.keys(this.models)) this.models[k].userData.dispose();
    this.vmScene.remove(this.holder);
  }
}

export { UPGRADES };
