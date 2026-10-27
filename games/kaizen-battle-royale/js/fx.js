'use strict';
/* Visual effects: particle systems, tracers, muzzle flashes, floating damage numbers, screen shake, falling petals. */
KBR.Fx = (function () {
  const F = {};
  let scene, camera, layer, quality, light;
  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);

  const PV = `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
    void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp(size * uScale / -mv.z, 0.0, 160.0); gl_Position = projectionMatrix * mv; }`;
  const PF = `varying vec3 vC; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.15, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }`;

  class Particles {
    constructor(max, additive) {
      this.max = max; this.i = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
      this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
      this.uniforms = { uScale: { value: 600 } };
      this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: PV, fragmentShader: PF, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
      this.geo = g;
    }
    emit(x, y, z, vx, vy, vz, color, size, life, o) {
      o = o || {};
      const i = this.i; this.i = (this.i + 1) % this.max; const k = i * 3;
      this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
      const c = color; this.col[k] = ((c >> 16) & 255) / 255; this.col[k + 1] = ((c >> 8) & 255) / 255; this.col[k + 2] = (c & 255) / 255;
      this.size[i] = size; this.life[i] = this.maxLife[i] = life; this.grav[i] = o.g === undefined ? 9 : o.g; this.grow[i] = o.grow || 0; this.a0[i] = o.a === undefined ? 1 : o.a; this.drag[i] = o.drag === undefined ? 0.5 : o.drag;
      this.alpha[i] = this.a0[i];
    }
    update(dt) {
      let any = false;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; any = true; } continue; }
        any = true; const k = i * 3, l = this.life[i] -= dt;
        if (l <= 0) { this.alpha[i] = 0; continue; }
        const dr = Math.exp(-this.drag[i] * dt);
        this.vel[k] *= dr; this.vel[k + 2] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt;
        this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
        const t = l / this.maxLife[i]; this.alpha[i] = this.a0[i] * Math.min(1, t * 2.2); this.size[i] += this.grow[i] * dt;
      }
      if (any) { const a = this.geo.attributes; a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true; }
    }
  }

  let soft, glow, petals, tracers = [], flashes = [], texts = [], petalData = null;
  const MAX_TRACERS = 36;

  function starTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,230,160,0.95)'); gr.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,240,200,0.95)'; for (let k = 0; k < 4; k++) { g.save(); g.translate(32, 32); g.rotate(k * Math.PI / 4); g.beginPath(); g.moveTo(-30, 0); g.lineTo(0, -2.5); g.lineTo(30, 0); g.lineTo(0, 2.5); g.fill(); g.restore(); }
    return new THREE.CanvasTexture(c);
  }

  F.init = function (sceneRef, cameraRef, q, layerEl) {
    scene = sceneRef; camera = cameraRef; quality = q; layer = layerEl;
    soft = new Particles(700, false); glow = new Particles(500, true);
    scene.add(soft.mesh, glow.mesh);
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m); tracers.push({ m, on: false, t: 0, dist: 0, dir: new THREE.Vector3(), s: new THREE.Vector3(), speed: 1500, tail: 14, life: 0 });
    }
    const tex = starTexture();
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.visible = false; scene.add(sp); flashes.push({ sp, life: 0 });
    }
    light = new THREE.PointLight(0xffd9a0, 0, 16, 2); scene.add(light);
    if (q.petals > 0) {
      const n = q.petals; petalData = { n, p: new Float32Array(n * 3), ph: new Float32Array(n) };
      for (let i = 0; i < n; i++) { petalData.p[i * 3] = (Math.random() - 0.5) * 70; petalData.p[i * 3 + 1] = Math.random() * 30; petalData.p[i * 3 + 2] = (Math.random() - 0.5) * 70; petalData.ph[i] = Math.random() * 6.28; }
      petals = new Particles(n, false); petals.mesh.renderOrder = 4; scene.add(petals.mesh);
      for (let i = 0; i < n; i++) { petals.life[i] = 1e9; petals.maxLife[i] = 1e9; petals.size[i] = 0.32; petals.alpha[i] = 0.85; const k = i * 3; petals.col[k] = 1; petals.col[k + 1] = 0.68 + Math.random() * 0.12; petals.col[k + 2] = 0.8; }
    }
    F.resize();
  };
  F.resize = function () {
    const s = window.innerHeight * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (F.pixelRatio || 1);
    for (const p of [soft, glow, petals]) if (p) p.uniforms.uScale.value = s / 1;
  };
  F.setQuality = (q) => { quality = q; };

  // ------------------------------------------------------------ tracers & flashes
  /** Streak from `a` to `b`. A short tail keeps long shots from becoming beams. */
  F.tracer = function (a, b, color, o) {
    o = o || {};
    let t = null; for (const x of tracers) if (!x.on) { t = x; break; }
    if (!t) return;
    _v.subVectors(b, a); const d = _v.length();
    if (d < 0.5) return;
    t.on = true; t.t = 0; t.dist = d; t.dir.copy(_v).divideScalar(d); t.a = t.a || new THREE.Vector3(); t.a.copy(a);
    t.speed = o.speed || 1400; t.tail = o.tail || 12; t.w = o.w || 0.03; t.m.material.color.setHex(color || 0xffe9a8); t.m.visible = true; t.life = d / t.speed + 0.05;
  };
  F.muzzle = function (pos, color, size, withLight) {
    for (const f of flashes) if (f.life <= 0) {
      f.life = 0.06; f.sp.position.copy(pos); f.sp.scale.setScalar(size || 0.9); f.sp.material.rotation = Math.random() * 6.28; f.sp.material.color.setHex(color || 0xffe0a0); f.sp.visible = true;
      if (withLight) { light.position.copy(pos); light.intensity = 2.6; light.userData.t = 0.06; }
      return;
    }
  };

  // ------------------------------------------------------------ particle bursts
  const rnd = () => Math.random() - 0.5;
  F.impact = function (p, n, kind) {
    const nx = n ? n.x : 0, ny = n ? n.y : 1, nz = n ? n.z : 0;
    const spray = (cnt, color, size, speed, life, pool, o) => { for (let i = 0; i < cnt; i++) pool.emit(p.x, p.y, p.z, nx * speed + rnd() * speed, ny * speed + Math.random() * speed * 0.8, nz * speed + rnd() * speed, color, size, life * (0.6 + Math.random() * 0.6), o); };
    switch (kind) {
      case 'terrain': spray(5, 0x9a8466, 0.45, 2.2, 0.55, soft, { g: 4, grow: 0.9, a: 0.8, drag: 1 }); spray(3, 0x5a4a38, 0.14, 4, 0.4, soft, { g: 14, a: 1 }); break;
      case 'water': spray(9, 0xe6f7ff, 0.28, 3.5, 0.6, soft, { g: 11, a: 0.9 }); spray(3, 0xffffff, 0.7, 1.4, 0.5, soft, { g: 0, grow: 1.4, a: 0.5 }); break;
      case 'wood': spray(5, 0x8a6240, 0.16, 4, 0.5, soft, { g: 14 }); spray(3, 0xffb7cf, 0.3, 2, 0.9, soft, { g: 2, a: 0.9 }); break;
      case 'barrier': spray(10, 0x7aeaf2, 0.22, 4.5, 0.4, glow, { g: 4 }); break;
      case 'hit': spray(7, 0xffffff, 0.3, 4.5, 0.38, glow, { g: 3 }); spray(3, 0xff8fb0, 0.5, 2.5, 0.35, glow, { g: 0, grow: 1.3 }); break;
      case 'head': spray(12, 0xffd34d, 0.34, 6, 0.5, glow, { g: 2 }); spray(4, 0xffffff, 0.8, 2, 0.3, glow, { g: 0, grow: 3 }); break;
      case 'dome': spray(8, 0xb9a8ff, 0.3, 4, 0.4, glow, { g: 2 }); break;
      default: spray(4, 0xaaa59a, 0.4, 2, 0.5, soft, { g: 3, grow: 0.8, a: 0.7 }); spray(4, 0xffd36b, 0.12, 6, 0.28, glow, { g: 12 });
    }
  };
  F.sparkle = function (x, y, z, color, n, spread) { for (let i = 0; i < n; i++) glow.emit(x + rnd() * spread, y + Math.random() * 1.8, z + rnd() * spread, rnd() * 1.2, 0.6 + Math.random() * 1.6, rnd() * 1.2, color, 0.34, 0.9 + Math.random() * 0.6, { g: -0.3, a: 0.9 }); };
  F.smoke = function (x, y, z, color) { soft.emit(x + rnd() * 0.5, y, z + rnd() * 0.5, rnd() * 0.8, 3 + Math.random() * 1.5, rnd() * 0.8, color, 1.8, 3.2, { g: -0.2, grow: 2.2, a: 0.5, drag: 0.3 }); };
  F.confetti = function (x, y, z) { const cols = [0xff7aa8, 0xffd34d, 0x5de0e6, 0xc084fc, 0xffffff]; for (let i = 0; i < 90; i++) glow.emit(x, y, z, rnd() * 14, 6 + Math.random() * 10, rnd() * 14, cols[i % 5], 0.45, 2.2 + Math.random(), { g: 6, drag: 0.8 }); };
  F.ring = function (x, y, z, color) { for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; glow.emit(x, y, z, Math.cos(a) * 5, 0.6, Math.sin(a) * 5, color, 0.5, 0.5, { g: 0, drag: 2 }); } };

  // ------------------------------------------------------------ screen shake & floating numbers
  let trauma = 0;
  F.shake = (a) => { trauma = Math.min(1, trauma + a); };
  F.shakeOffset = function (out, t) { const s = trauma * trauma * 0.06; out.set(Math.sin(t * 61) * s, Math.sin(t * 77 + 2) * s, Math.sin(t * 53 + 5) * s); return out; };

  F.text = function (pos, str, kind) {
    if (!layer) return;
    let el = null; for (const t of texts) if (!t.on) { el = t; break; }
    if (!el) { if (texts.length >= 20) return; const d = document.createElement('div'); layer.appendChild(d); el = { d, on: false, p: new THREE.Vector3(), t: 0, vx: 0 }; texts.push(el); }
    el.on = true; el.t = 0; el.p.copy(pos); el.vx = (Math.random() - 0.5) * 30; el.d.textContent = str; el.d.className = 'dmg ' + (kind || '');
  };

  F.update = function (dt, focus, t) {
    soft.update(dt); glow.update(dt);
    for (const x of tracers) {
      if (!x.on) continue;
      x.t += dt; const head = Math.min(x.dist, x.t * x.speed), tail = Math.max(0, head - x.tail), len = head - tail;
      if (x.t * x.speed > x.dist + x.tail) { x.on = false; x.m.visible = false; continue; }
      const mid = (head + tail) / 2; x.m.position.set(x.a.x + x.dir.x * mid, x.a.y + x.dir.y * mid, x.a.z + x.dir.z * mid);
      x.m.quaternion.setFromUnitVectors(Z, x.dir); x.m.scale.set(x.w, x.w, Math.max(0.05, len));
      x.m.material.opacity = 0.35 + 0.55 * Math.max(0, 1 - Math.max(0, x.t * x.speed - x.dist) / x.tail);
    }
    for (const f of flashes) if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.sp.visible = false; }
    if (light.intensity > 0) { light.userData.t -= dt; if (light.userData.t <= 0) light.intensity = 0; }
    trauma = Math.max(0, trauma - dt * 1.7);
    // falling petals around the camera
    if (petals && petalData) {
      const P = petalData, a = petals.pos;
      for (let i = 0; i < P.n; i++) {
        const k = i * 3; P.p[k + 1] -= dt * (0.9 + (i % 5) * 0.12); P.p[k] += Math.sin(t * 0.7 + P.ph[i]) * dt * 0.9 + dt * 0.6; P.p[k + 2] += Math.cos(t * 0.6 + P.ph[i]) * dt * 0.7;
        if (P.p[k + 1] < -4) { P.p[k + 1] = 30; }
        if (P.p[k] > 35) P.p[k] -= 70; else if (P.p[k] < -35) P.p[k] += 70;
        if (P.p[k + 2] > 35) P.p[k + 2] -= 70; else if (P.p[k + 2] < -35) P.p[k + 2] += 70;
        a[k] = focus.x + P.p[k]; a[k + 1] = focus.y + P.p[k + 1] - 2; a[k + 2] = focus.z + P.p[k + 2];
      }
      petals.geo.attributes.position.needsUpdate = true;
    }
    // floating text
    const w = window.innerWidth, h = window.innerHeight;
    for (const e of texts) {
      if (!e.on) continue;
      e.t += dt; if (e.t > 0.9) { e.on = false; e.d.className = 'dmg'; e.d.style.display = 'none'; continue; }
      _v.copy(e.p); _v.y += e.t * 1.4; _v.project(camera);
      if (_v.z > 1 || _v.z < -1) { e.d.style.display = 'none'; continue; }
      e.d.style.display = 'block'; e.d.style.opacity = String(1 - e.t / 0.9);
      e.d.style.transform = 'translate(' + ((_v.x * 0.5 + 0.5) * w + e.vx * e.t) + 'px,' + ((-_v.y * 0.5 + 0.5) * h) + 'px) translate(-50%,-50%) scale(' + (1 + Math.max(0, 0.25 - e.t) * 2) + ')';
    }
  };
  F.clear = function () {
    for (const x of tracers) { x.on = false; x.m.visible = false; }
    for (const e of texts) { e.on = false; e.d.style.display = 'none'; }
    for (const p of [soft, glow]) { p.life.fill(0); p.alpha.fill(0); }
  };
  return F;
})();
