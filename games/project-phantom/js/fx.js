// Pooled visual effects: sparks, tracers, bullet decals, shock rings, dust and rain.
// Everything is preallocated; nothing is created per shot.

const THREE = window.THREE;

const SPARKS = 480, TRACERS = 28, DECALS = 56, RINGS = 4, DUST = 140, RAIN = 380;

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.t = 0;

    // ---- sparks
    this.sp = {
      pos: new Float32Array(SPARKS * 3), col: new Float32Array(SPARKS * 3), vel: new Float32Array(SPARKS * 3),
      life: new Float32Array(SPARKS), max: new Float32Array(SPARKS), base: new Float32Array(SPARKS * 3), head: 0, grav: new Float32Array(SPARKS),
    };
    this.sp.pos.fill(-1000);
    this.spGeo = new THREE.BufferGeometry();
    this.spGeo.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3));
    this.spGeo.setAttribute('color', new THREE.BufferAttribute(this.sp.col, 3));
    this.dotTex = dotTexture();
    this.spMat = new THREE.PointsMaterial({ size: 0.12, map: this.dotTex, alphaTest: 0.02, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.spPts = new THREE.Points(this.spGeo, this.spMat);
    this.spPts.frustumCulled = false;
    this.group.add(this.spPts);

    // ---- tracers
    this.tr = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    this.trGeo = tg;
    for (let i = 0; i < TRACERS; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.frustumCulled = false; this.group.add(m);
      this.tr.push({ m, life: 0, max: 0.08 });
    }
    this.trHead = 0;

    // ---- decals
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.5, 'rgba(10,10,10,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(255,170,60,0.55)'; g.lineWidth = 2; g.beginPath(); g.arc(32, 32, 8, 0, 7); g.stroke();
    this.decalTex = new THREE.CanvasTexture(c);
    this.decalGeo = new THREE.PlaneGeometry(0.28, 0.28);
    this.decalMat = new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.decals = [];
    for (let i = 0; i < DECALS; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat); m.visible = false; this.group.add(m); this.decals.push(m);
    }
    this.decalHead = 0;

    // ---- shock rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.92, 1, 48);
    this.ringGeo = rg;
    for (let i = 0; i < RINGS; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; this.group.add(m);
      this.rings.push({ m, t: 0, max: 0.8, r: 1 });
    }
    this.ringHead = 0;

    // ---- ambient dust (indoor) and rain (outdoor)
    this.dust = null; this.rain = null;
    this.ambient = { x: 0, y: 0, z: 0 };
  }

  setAmbient(kind) {
    this.clearAmbient();
    if (kind === 'rain') {
      const pos = new Float32Array(RAIN * 6);
      this.rainSeed = new Float32Array(RAIN * 3);
      for (let i = 0; i < RAIN; i++) { this.rainSeed[i * 3] = Math.random() * 30 - 15; this.rainSeed[i * 3 + 1] = Math.random() * 14; this.rainSeed[i * 3 + 2] = Math.random() * 30 - 15; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.35, depthWrite: false }));
      this.rain.frustumCulled = false; this.group.add(this.rain);
    } else {
      const pos = new Float32Array(DUST * 3);
      this.dustSeed = new Float32Array(DUST * 3);
      for (let i = 0; i < DUST; i++) { this.dustSeed[i * 3] = Math.random() * 24 - 12; this.dustSeed[i * 3 + 1] = Math.random() * 4; this.dustSeed[i * 3 + 2] = Math.random() * 24 - 12; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: kind === 'space' ? 0xbfe0ff : 0x8fdfff, size: 0.05, map: this.dotTex, alphaTest: 0.02, transparent: true, opacity: 0.55, depthWrite: false }));
      this.dust.frustumCulled = false; this.group.add(this.dust);
    }
  }

  clearAmbient() {
    for (const k of ['dust', 'rain']) {
      if (this[k]) { this.group.remove(this[k]); this[k].geometry.dispose(); this[k].material.dispose(); this[k] = null; }
    }
  }

  reset() {
    const s = this.sp; s.life.fill(0); s.pos.fill(-1000); this.spGeo.attributes.position.needsUpdate = true;
    for (const t of this.tr) t.m.visible = false;
    for (const d of this.decals) d.visible = false;
    for (const r of this.rings) r.m.visible = false;
  }

  // ---- emitters
  spark(x, y, z, n, r, g, b, speed = 4, life = 0.45, nx = 0, ny = 1, nz = 0, grav = 9) {
    const s = this.sp;
    for (let k = 0; k < n; k++) {
      const i = s.head; s.head = (s.head + 1) % SPARKS;
      const i3 = i * 3;
      s.pos[i3] = x; s.pos[i3 + 1] = y; s.pos[i3 + 2] = z;
      const sp = speed * (0.35 + Math.random() * 0.8);
      s.vel[i3] = (nx * 0.8 + (Math.random() - 0.5) * 1.6) * sp;
      s.vel[i3 + 1] = (ny * 0.8 + (Math.random() - 0.3) * 1.4) * sp;
      s.vel[i3 + 2] = (nz * 0.8 + (Math.random() - 0.5) * 1.6) * sp;
      s.base[i3] = r; s.base[i3 + 1] = g; s.base[i3 + 2] = b;
      s.life[i] = s.max[i] = life * (0.6 + Math.random() * 0.6);
      s.grav[i] = grav;
    }
  }

  impact(x, y, z, nx, ny, nz) {
    this.spark(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, 7, 1, 0.75, 0.3, 3.5, 0.35, nx, ny, nz);
    this.decal(x, y, z, nx, ny, nz);
  }

  tracer(ax, ay, az, bx, by, bz, color = 0xffffcc, width = 0.025, life = 0.07) {
    const t = this.tr[this.trHead]; this.trHead = (this.trHead + 1) % TRACERS;
    const dx = bx - ax, dy = by - ay, dz = bz - az; const len = Math.hypot(dx, dy, dz) || 0.001;
    const m = t.m; m.visible = true;
    m.position.set(ax + dx / 2, ay + dy / 2, az + dz / 2);
    m.scale.set(width, width, len);
    m.lookAt(bx, by, bz);
    m.material.color.setHex(color); m.material.opacity = 0.9;
    t.life = t.max = life;
  }

  decal(x, y, z, nx, ny, nz) {
    const m = this.decals[this.decalHead]; this.decalHead = (this.decalHead + 1) % DECALS;
    m.visible = true; m.position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    m.lookAt(x + nx, y + ny, z + nz);
    m.rotateZ(Math.random() * 6.28);
    const s = 0.7 + Math.random() * 0.7; m.scale.set(s, s, 1);
  }

  ring(x, y, z, radius, color = 0x66ccff, time = 0.7) {
    const r = this.rings[this.ringHead]; this.ringHead = (this.ringHead + 1) % RINGS;
    r.m.visible = true; r.m.position.set(x, y, z); r.t = r.max = time; r.r = radius; r.m.material.color.setHex(color);
  }

  explosion(x, y, z, scale = 1) {
    this.spark(x, y, z, 40, 1, 0.6, 0.2, 7 * scale, 0.7, 0, 1, 0, 6);
    this.spark(x, y, z, 24, 1, 0.95, 0.7, 4 * scale, 0.35, 0, 0.5, 0, 2);
  }

  // ---- per frame
  update(dt, px, py, pz) {
    this.t += dt;
    const s = this.sp; let dirty = false;
    for (let i = 0; i < SPARKS; i++) {
      if (s.life[i] <= 0) { if (s.pos[i * 3 + 1] > -900) { s.pos[i * 3 + 1] = -1000; s.col[i * 3] = s.col[i * 3 + 1] = s.col[i * 3 + 2] = 0; dirty = true; } continue; }
      s.life[i] -= dt; const i3 = i * 3;
      s.vel[i3 + 1] -= s.grav[i] * dt;
      s.pos[i3] += s.vel[i3] * dt; s.pos[i3 + 1] += s.vel[i3 + 1] * dt; s.pos[i3 + 2] += s.vel[i3 + 2] * dt;
      if (s.pos[i3 + 1] < 0.02) { s.pos[i3 + 1] = 0.02; s.vel[i3 + 1] *= -0.3; s.vel[i3] *= 0.6; s.vel[i3 + 2] *= 0.6; }
      const f = Math.max(0, s.life[i] / s.max[i]);
      s.col[i3] = s.base[i3] * f; s.col[i3 + 1] = s.base[i3 + 1] * f; s.col[i3 + 2] = s.base[i3 + 2] * f;
      dirty = true;
    }
    if (dirty) { this.spGeo.attributes.position.needsUpdate = true; this.spGeo.attributes.color.needsUpdate = true; }

    for (const t of this.tr) {
      if (!t.m.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.m.visible = false; else t.m.material.opacity = t.life / t.max;
    }
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.t -= dt;
      if (r.t <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.t / r.max; r.m.scale.setScalar(Math.max(0.01, r.r * k)); r.m.material.opacity = 0.8 * (1 - k);
    }
    if (this.dust) {
      const a = this.dust.geometry.attributes.position.array, sd = this.dustSeed;
      for (let i = 0; i < DUST; i++) {
        const i3 = i * 3;
        sd[i3 + 1] += dt * 0.08; if (sd[i3 + 1] > 4) sd[i3 + 1] -= 4;
        a[i3] = px + (((sd[i3] + this.t * 0.05 + 12) % 24) - 12);
        a[i3 + 1] = sd[i3 + 1];
        a[i3 + 2] = pz + (((sd[i3 + 2] + 12) % 24) - 12);
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }
    if (this.rain) {
      const a = this.rain.geometry.attributes.position.array, sd = this.rainSeed;
      for (let i = 0; i < RAIN; i++) {
        const i3 = i * 3, i6 = i * 6;
        sd[i3 + 1] -= dt * 22; if (sd[i3 + 1] < 0) sd[i3 + 1] += 14;
        const x = px + (((sd[i3] + 15) % 30) - 15), z = pz + (((sd[i3 + 2] + 15) % 30) - 15);
        a[i6] = x; a[i6 + 1] = sd[i3 + 1]; a[i6 + 2] = z;
        a[i6 + 3] = x - 0.04; a[i6 + 4] = sd[i3 + 1] + 0.7; a[i6 + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    this.clearAmbient();
    this.scene.remove(this.group);
    this.dotTex.dispose(); this.spGeo.dispose(); this.spMat.dispose(); this.trGeo.dispose();
    for (const t of this.tr) t.m.material.dispose();
    this.decalTex.dispose(); this.decalGeo.dispose(); this.decalMat.dispose();
    this.ringGeo.dispose(); for (const r of this.rings) r.m.material.dispose();
  }
}
