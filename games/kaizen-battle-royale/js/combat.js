'use strict';
/*
 * Ballistics and damage, shared by the player and every bot so they all play by the same rules.
 *
 *  - Spread is an angular cone sampled uniformly from a disc (sqrt radius), not a square of screen units.
 *  - Damage = base x rarity x distance falloff x hit-zone multiplier. Falloff eases from fallStart to range.
 *  - A vest soaks ARMOR_SOAK of each hit until its points run out.
 *  - Hit zones (head sphere, torso box, legs box) are tested in the target's local frame, so facing matters.
 *  - The sniper fires real projectiles (travel time + gravity drop); everything else is hitscan.
 *  - Barrier walls are oriented boxes with hit points that absorb bullets from both sides.
 */
KBR.Combat = (function () {
  const C = {};
  const W = KBR.World;
  C.getTargets = () => [];
  C.player = null;
  C.barriers = [];
  C.projectiles = [];
  C.time = 0;
  C.onPlayerShot = null;   // (summary) called when the player's shot connects
  C.onEntityKilled = null; // (victim, killer, zone, weaponId)
  let scene = null, barrierTex = null;

  const HEAD = { y: 1.62, r: 0.25 }, TORSO = { y: 1.17, hx: 0.29, hy: 0.33, hz: 0.2 }, LEGS = { y: 0.4, hx: 0.22, hy: 0.4, hz: 0.18 };
  const DOME_R = 2.7;
  const ZONE_MUL = { head: 1, torso: 1, legs: 0.8 };
  const RES = { kind: 'none', t: 0, zone: '', entity: null, type: '', collider: null, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) };
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  C.init = function (sceneRef) { scene = sceneRef; };

  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
    const fx = ox - cx, fy = oy - cy, fz = oz - cz, b = fx * dx + fy * dy + fz * dz, c = fx * fx + fy * fy + fz * fz - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c; if (disc < 0) return -1;
    const t = Math.max(0, -b - Math.sqrt(disc));
    return t <= maxT ? t : -1;
  }
  /** Ray vs a target's hit zones. Returns distance or -1 and sets rayEntity.zone. */
  function rayEntity(e, ox, oy, oz, dx, dy, dz, maxT) {
    // cheap reject with a bounding sphere around the body
    if (raySphere(ox, oy, oz, dx, dy, dz, e.x, e.y + 1.0, e.z, 1.25, maxT) < 0) return -1;
    let best = -1, zone = '';
    const t0 = raySphere(ox, oy, oz, dx, dy, dz, e.x, e.y + HEAD.y, e.z, HEAD.r, maxT);
    if (t0 >= 0) { best = t0; zone = 'head'; }
    const cs = Math.cos(e.yaw), sn = Math.sin(e.yaw), rx = ox - e.x, rz = oz - e.z;
    const lox = cs * rx - sn * rz, loz = sn * rx + cs * rz, ldx = cs * dx - sn * dz, ldz = sn * dx + cs * dz, ry = oy - e.y;
    for (const [box, name] of [[TORSO, 'torso'], [LEGS, 'legs']]) {
      const t = W.rayBox(lox, ry, loz, ldx, dy, ldz, -box.hx, box.hx, box.y - box.hy, box.y + box.hy, -box.hz, box.hz, best >= 0 ? best : maxT);
      if (t >= 0 && (best < 0 || t < best)) { best = t; zone = name; }
    }
    rayEntity.zone = zone;
    return best;
  }

  /**
   * Finds the first thing a ray hits: world, barrier, an entity (with zone) or a Kage dome.
   * Returns the shared RES object, or null if nothing is hit within maxT.
   */
  C.trace = function (ox, oy, oz, dx, dy, dz, maxT, shooter) {
    let best = maxT, kind = 'none', ent = null, zone = '', type = '', col = null, nx = 0, ny = 1, nz = 0;
    const wh = W.raycast(ox, oy, oz, dx, dy, dz, maxT, false);
    if (wh) { best = wh.t; kind = wh.type === 'barrier' ? 'barrier' : 'world'; type = wh.type; col = wh.c; nx = wh.nx; ny = wh.ny; nz = wh.nz; }
    const T = C.getTargets();
    for (let i = 0; i < T.length; i++) {
      const e = T[i];
      if (e === shooter || !e.alive) continue;
      if (e.dome) {
        if (Math.hypot(ox - e.x, oy - (e.y + 1.2), oz - e.z) > DOME_R) {
          const t = raySphere(ox, oy, oz, dx, dy, dz, e.x, e.y + 1.2, e.z, DOME_R, best);
          if (t >= 0 && t < best) { best = t; kind = 'dome'; ent = e; nx = (ox + dx * t - e.x) / DOME_R; ny = (oy + dy * t - e.y - 1.2) / DOME_R; nz = (oz + dz * t - e.z) / DOME_R; continue; }
        } else continue; // shooter stands inside a dome: shots pass through
      }
      const t = rayEntity(e, ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) { best = t; kind = 'entity'; ent = e; zone = rayEntity.zone; }
    }
    if (kind === 'none') return null;
    RES.kind = kind; RES.t = best; RES.entity = ent; RES.zone = zone; RES.type = type; RES.collider = col;
    RES.point.set(ox + dx * best, oy + dy * best, oz + dz * best); RES.normal.set(nx, ny, nz);
    return RES;
  };

  // ---------------------------------------------------------------- damage model
  C.falloff = (w, d) => lerp(1, w.minFall, smoothstep(w.fallStart, w.range, d));
  /** Vest soaks a share of the hit; the rest goes to HP. Returns HP actually lost. */
  C.damageEntity = function (e, raw, zone, source, weaponId, dir) {
    if (!e.alive) return 0;
    let dmg = raw;
    if (e.armor > 0) { const soak = Math.min(e.armor, dmg * KBR.ARMOR_SOAK); e.armor -= soak; dmg -= soak; }
    e.hp -= dmg;
    if (e.onDamaged) e.onDamaged(dmg, raw, zone, source, weaponId, dir);
    if (e.hp <= 0 && e.alive) { e.hp = 0; e.die(source, zone, weaponId); if (C.onEntityKilled) C.onEntityKilled(e, source, zone, weaponId); }
    return dmg;
  };
  /** Applies the result of a trace: damage, impact effects and sounds. `dist` is the distance travelled. */
  function resolve(res, w, shooter, mul, dist, sum) {
    const F = KBR.Fx;
    if (res.kind === 'entity') {
      const e = res.entity, zm = res.zone === 'head' ? w.head : ZONE_MUL[res.zone];
      const raw = w.dmg * mul * C.falloff(w, dist) * zm * (shooter.dmgMul || 1);
      F.impact(res.point, res.normal, res.zone === 'head' ? 'head' : 'hit');
      const dir = { x: res.point.x - (shooter.x || 0), z: res.point.z - (shooter.z || 0) };
      const was = e.alive, lost = C.damageEntity(e, raw, res.zone, shooter, w.id, dir);
      if (sum) { sum.hit = true; sum.dmg += lost; sum.head = sum.head || res.zone === 'head'; sum.killed = sum.killed || (was && !e.alive); sum.entity = e; sum.point = sum.point || res.point.clone(); }
    } else if (res.kind === 'barrier') {
      const b = res.collider && res.collider.owner;
      if (b) { b.hp -= w.dmg * mul * C.falloff(w, dist); b.flash = 0.18; F.impact(res.point, res.normal, 'barrier'); KBR.Audio.impact(res.point, 'barrier'); if (b.hp <= 0) C.removeBarrier(b); }
    } else if (res.kind === 'dome') { F.impact(res.point, res.normal, 'dome'); KBR.Audio.impact(res.point, 'barrier'); }
    else {
      const kind = res.point.y < 0.05 && res.type === 'terrain' ? 'water' : res.type === 'tree' ? 'wood' : res.type === 'terrain' ? 'terrain' : 'wall';
      F.impact(res.point, res.normal, kind); KBR.Audio.impact(res.point, kind);
    }
  }

  /** Random direction inside a cone (half-angle `rad`) around `base`; written into `out`. */
  C.spreadDir = function (base, rad, out) {
    if (rad <= 0) return out.copy(base);
    _r.crossVectors(base, UP); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize();
    _u.crossVectors(_r, base).normalize();
    const [a, b] = rng.disc(), k = Math.tan(rad);
    return out.copy(base).addScaledVector(_r, a * k).addScaledVector(_u, b * k).normalize();
  };

  /**
   * Fires one trigger pull. `spread` is the cone half-angle in radians (weapon base + bloom + movement).
   * Returns a summary {hit, dmg, head, killed, entity, point}.
   */
  C.fire = function (shooter, w, mul, origin, baseDir, spread, tracerColor) {
    const sum = { hit: false, dmg: 0, head: false, killed: false, entity: null, point: null };
    const n = w.pellets || 1;
    for (let p = 0; p < n; p++) {
      C.spreadDir(baseDir, spread + (n > 1 ? w.pelletSpread : 0), _d);
      if (w.projectile) { spawnProjectile(shooter, w, mul, origin, _d); continue; }
      const res = C.trace(origin.x, origin.y, origin.z, _d.x, _d.y, _d.z, w.range, shooter);
      const end = res ? res.point : _r.copy(origin).addScaledVector(_d, w.range);
      const dist = res ? res.t : w.range;
      if (res) resolve(res, w, shooter, mul, dist, sum);
      if (n === 1 || p < 4) KBR.Fx.tracer(origin, end, tracerColor || 0xffe9a8, { w: n > 1 ? 0.018 : 0.03 });
      if (shooter !== C.player) whizCheck(shooter, origin, end);
    }
    return sum;
  };
  /** Bullets passing close to the player: crack sound and a nudge of screen shake. */
  function whizCheck(shooter, a, b) {
    const pl = C.player; if (!pl || !pl.alive) return;
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, l2 = abx * abx + aby * aby + abz * abz; if (l2 < 1) return;
    const px = pl.x - a.x, py = pl.y + 1.4 - a.y, pz = pl.z - a.z, t = clamp((px * abx + py * aby + pz * abz) / l2, 0, 1);
    const dx = a.x + abx * t - pl.x, dy = a.y + aby * t - pl.y - 1.4, dz = a.z + abz * t - pl.z, d = Math.hypot(dx, dy, dz);
    if (d < 3.2 && d > 0.45) { KBR.Audio.whiz({ x: pl.x + dx, y: pl.y + 1.4 + dy, z: pl.z + dz }); KBR.Fx.shake(0.05); if (pl.onSuppressed) pl.onSuppressed(shooter); }
  }

  // ---------------------------------------------------------------- projectiles (sniper)
  function spawnProjectile(shooter, w, mul, origin, dir) {
    const sp = w.projectile.speed;
    C.projectiles.push({ x: origin.x, y: origin.y, z: origin.z, vx: dir.x * sp, vy: dir.y * sp, vz: dir.z * sp, w, mul, shooter, dist: 0 });
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function stepProjectiles(dt) {
    for (let i = C.projectiles.length - 1; i >= 0; i--) {
      const p = C.projectiles[i]; let remaining = dt, dead = false;
      while (remaining > 1e-5 && !dead) {
        const sp = Math.hypot(p.vx, p.vy, p.vz), h = Math.min(remaining, 22 / sp);
        const nx = p.x + p.vx * h, ny = p.y + p.vy * h - 0.5 * p.w.projectile.gravity * h * h, nz = p.z + p.vz * h;
        const dx = nx - p.x, dy = ny - p.y, dz = nz - p.z, l = Math.hypot(dx, dy, dz) || 1e-6;
        const res = C.trace(p.x, p.y, p.z, dx / l, dy / l, dz / l, l, p.shooter);
        _a.set(p.x, p.y, p.z);
        if (res) {
          p.dist += res.t; const sum = p.shooter === C.player ? { hit: false, dmg: 0, head: false, killed: false, entity: null, point: null } : null;
          resolve(res, p.w, p.shooter, p.mul, p.dist, sum);
          if (sum && C.onPlayerShot) C.onPlayerShot(sum, p.w);
          KBR.Fx.tracer(_a, res.point, 0xe8ffd0, { w: 0.05, tail: 24, speed: 2500 });
          dead = true; break;
        }
        _b.set(nx, ny, nz); KBR.Fx.tracer(_a, _b, 0xe8ffd0, { w: 0.045, tail: 20, speed: 3000 });
        if (p.shooter !== C.player) whizCheck(p.shooter, _a, _b);
        p.x = nx; p.y = ny; p.z = nz; p.vy -= p.w.projectile.gravity * h; p.dist += l; remaining -= h;
        if (p.dist > p.w.range * 1.15 || p.y < -30) dead = true;
      }
      if (dead) C.projectiles.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- barrier walls
  function barrierTexture() {
    if (barrierTex) return barrierTex;
    const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d');
    g.fillStyle = 'rgba(70,200,230,0.55)'; g.fillRect(0, 0, 256, 160);
    g.strokeStyle = 'rgba(210,255,255,0.8)'; g.lineWidth = 2;
    for (let x = -20; x < 280; x += 28) for (let y = 0; y < 180; y += 32) { g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; g.lineTo(x + 14 + Math.cos(a) * 14, y + (((x / 28) | 0) % 2 ? 16 : 0) + Math.sin(a) * 14); } g.closePath(); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 96px "Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('守', 128, 84);
    barrierTex = new THREE.CanvasTexture(c); barrierTex.anisotropy = 4; return barrierTex;
  }
  const BARRIER = { hw: 1.9, hh: 2.4, hd: 0.14, hp: 380, life: 30 };
  C.barrierSpec = BARRIER;
  C.placeBarrier = function (x, z, yaw, owner) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    let base = W.heightAt(x, z);
    for (const s of [-1, 1]) base = Math.min(base, W.heightAt(x + cs * BARRIER.hw * s, z - sn * BARRIER.hw * s));
    const mat = new THREE.MeshBasicMaterial({ map: barrierTex || barrierTexture(), transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BARRIER.hw * 2, BARRIER.hh + 0.6, BARRIER.hd * 2), mat);
    mesh.position.set(x, base + (BARRIER.hh - 0.6) / 2 + 0.0, z); mesh.rotation.y = yaw;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xcfffff })); mesh.add(edges);
    scene.add(mesh);
    const b = { mesh, mat, hp: BARRIER.hp, life: BARRIER.life, flash: 0, owner, x, z, yaw, collider: null };
    b.collider = W.addObb(x, z, BARRIER.hw, BARRIER.hd, yaw, base - 0.6, base + BARRIER.hh, 'barrier', b);
    C.barriers.push(b);
    return b;
  };
  C.removeBarrier = function (b) {
    const i = C.barriers.indexOf(b); if (i >= 0) C.barriers.splice(i, 1);
    W.removeCollider(b.collider);
    KBR.Fx.ring(b.x, b.mesh.position.y + 1, b.z, 0x7aeaf2); KBR.Fx.sparkle(b.x, b.mesh.position.y, b.z, 0x7aeaf2, 14, 2.5);
    scene.remove(b.mesh); b.mat.dispose(); b.mesh.geometry.dispose();
  };

  C.update = function (dt) {
    C.time += dt;
    stepProjectiles(dt);
    for (let i = C.barriers.length - 1; i >= 0; i--) {
      const b = C.barriers[i]; b.life -= dt; b.flash = Math.max(0, b.flash - dt);
      b.mat.opacity = (b.life < 3 ? 0.35 + 0.35 * Math.sin(b.life * 14) : 0.7) + b.flash * 1.4;
      b.mat.color.setScalar(1 + b.flash * 2);
      if (b.life <= 0) C.removeBarrier(b);
    }
  };
  C.clear = function () { while (C.barriers.length) C.removeBarrier(C.barriers[0]); C.projectiles.length = 0; };
  C.DOME_R = DOME_R;
  return C;
})();
