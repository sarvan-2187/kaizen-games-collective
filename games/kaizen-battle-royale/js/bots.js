'use strict';
/*
 * Bot AI. Each bot parachutes toward a landing spot, loots what is nearby, roams, rotates with the safe zone and
 * fights whoever it can SEE or HEAR (player or other bots) using exactly the same ballistics as the player.
 *
 *   perception  vision cone + range by weapon + real line-of-sight rays (throttled), hearing of recent gunshots
 *   reaction    a delay before the first shot after spotting someone, scaled by difficulty
 *   aim         gaussian angular error that grows with distance and with target/bot movement; sniper leads the target
 *   movement    steering with obstacle probes, stuck detection, strafe + preferred range, cover when hurt
 */
KBR.Bots = (function () {
  const B = { list: [] };
  const W = KBR.World, C = KBR.Combat, CFG = KBR.BOTS;
  let scene, diff = KBR.DIFFICULTY.normal, spawnRng;
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const OUTFITS = [0xd9423f, 0x3a86ff, 0x2a9d8f, 0xe09f3e, 0x7b2cbf, 0xff5fa2, 0x5a6b7a, 0x6fc27a, 0x1d3557, 0xb5651d];
  const ACCENTS = [0xf6f2ea, 0xffc857, 0x5de0e6, 0xff7aa8, 0xb6f36b, 0xc084fc];
  const HAIRS = [0x1c1432, 0x4a3020, 0xffd36b, 0xff9ec0, 0x5de0e6, 0xb06cff, 0xd9423f, 0xf6f2ea, 0x2d6a4f];
  const ACC = ['headband', 'goggles', 'ears', 'mask', 'scarf', 'none', 'hood'];
  const PRIMARIES = ['rifle', 'smg', 'shotgun', 'rifle', 'smg', 'sniper'];
  const SIGHT = { PISTOL: 55, SMG: 80, RIFLE: 120, SHOTGUN: 50, SNIPER: 190 };
  const PREF = { PISTOL: 18, SMG: 20, RIFLE: 34, SHOTGUN: 9, SNIPER: 70 };

  B.init = function (sceneRef) { scene = sceneRef; };
  B.setDifficulty = (k) => { diff = KBR.DIFFICULTY[k] || KBR.DIFFICULTY.normal; };

  /** Picks a landing spot; of several candidates it takes the one farthest from bots already placed, so the lobby spreads out. */
  function landingSpot(r, taken) {
    let best = null, bestD = -1;
    for (let c = 0; c < 7; c++) {
      const poi = r.chance(0.8) ? KBR.POIS[r.chance(0.7) ? r.int(6) : r.int(KBR.POIS.length)] : null;
      let tx = 0, tz = 0;
      for (let k = 0; k < 30; k++) {
        if (poi) { const a = r.next() * TAU, d = Math.sqrt(r.next()) * poi.pad * 0.95; tx = poi.x + Math.cos(a) * d; tz = poi.z + Math.sin(a) * d; }
        else { const a = r.next() * TAU, d = Math.sqrt(r.next()) * 400; tx = Math.cos(a) * d; tz = Math.sin(a) * d; }
        if (W.heightAt(tx, tz) > 1.0) break;
      }
      let md = 1e9; for (const o of taken) md = Math.min(md, Math.hypot(o.tx - tx, o.tz - tz));
      if (md > bestD) { bestD = md; best = [tx, tz]; }
    }
    return best;
  }

  function makeBot(i, plane, r) {
    let [tx, tz] = landingSpot(r, B.list);
    // jump from the point on the plane path nearest the landing spot (within glide reach)
    const px = tx - plane.sx, pz = tz - plane.sz, along = clamp(px * plane.dx + pz * plane.dz, 0, plane.len);
    const jx = plane.sx + plane.dx * along, jz = plane.sz + plane.dz * along, dist = Math.hypot(tx - jx, tz - jz);
    if (dist > 380) { const k = 380 / dist; tx = jx + (tx - jx) * k; tz = jz + (tz - jz) * k; }
    const look = { outfit: r.pick(OUTFITS), accent: r.pick(ACCENTS), hair: r.pick(HAIRS), eye: r.pick(ACCENTS), acc: r.pick(ACC), hairStyle: r.pick(['spiky', 'bob', 'long', 'spiky']) };
    const rig = KBR.Models.makeCharacter(look); rig.setWeapon('pistol'); rig.root.visible = false; scene.add(rig.root);
    const bot = {
      kind: 'bot', id: i, name: KBR.BOT_NAMES[i % KBR.BOT_NAMES.length] + (i >= KBR.BOT_NAMES.length ? i : ''), rig, look,
      x: jx, y: plane.y, z: jz, yaw: Math.atan2(-(tx - jx), -(tz - jz)), vx: 0, vz: 0, alive: true, hp: CFG.hp, armor: 0, armorMax: 0, dome: false, dmgMul: diff.dmg,
      state: 'WAIT', jumpT: along / plane.speed + r.range(0, 1.5), tx, tz, goalX: tx, goalZ: tz, goalT: 0, think: r.range(0, 0.3),
      skill: r.range(0.8, 1.2) * diff.aim, weapon: { id: 'pistol', rarity: 0, mag: 12 }, medkits: r.chance(0.4) ? 1 : 0,
      target: null, seenT: -9, reactT: 0, burst: 0, pause: 0, fireT: 0, reloadT: 0, alertT: 0, lastShotAt: -9, strafe: r.chance(0.5) ? 1 : -1, strafeT: r.range(0.5, 2), healT: 0,
      lootT: r.range(14, 30), settleAt: -9, stateT: 0, noPrimaryT: 0, stuckT: 0, lastX: jx, lastZ: jz, stuckCheck: 1, wanderT: 0, kills: 0, spd: 0, lod: 0, accum: 0, coverX: 0, coverZ: 0, lastKnownX: 0, lastKnownZ: 0, hasLast: false,
      onDamaged, die,
    };
    return bot;
  }

  B.spawn = function (count, plane, seed) {
    B.clear(); spawnRng = new RNG(seed || 9);
    for (let i = 0; i < count; i++) B.list.push(makeBot(i, plane, spawnRng));
  };
  B.clear = function () { for (const b of B.list) { scene.remove(b.rig.root); b.rig.dispose(); } B.list.length = 0; };
  B.alive = () => B.list.filter((b) => b.alive);

  // ---------------------------------------------------------------- entity contract
  function onDamaged(dmg, raw, zone, source) {
    const b = this; b.alertT = 5; b.rig.flinch = 1;
    if (source && source !== b && source.alive) { b.target = source; b.seenT = KBR.Game.time; b.hasLast = true; b.lastKnownX = source.x; b.lastKnownZ = source.z; if (b.state === 'ROAM' || b.state === 'LOOT' || b.state === 'ROTATE') b.state = 'FIGHT'; }
    if (b.hp < CFG.hp * 0.4 && b.state === 'FIGHT' && rng.chance(0.5)) pickCover(b);
  }
  function die(source, zone, wid) {
    const b = this; b.alive = false; b.state = 'DEAD'; b.deadAt = KBR.Game.time; b.rig.setWeapon(null);
    const L = KBR.Loot, x = b.x, z = b.z;
    if (b.weapon.id !== 'pistol') L.add('w:' + b.weapon.id, x + rng.range(-0.6, 0.6), z + rng.range(-0.6, 0.6), b.weapon.rarity);
    if (b.armorMax > 0 && rng.chance(0.5)) L.add('vest', x + 1, z, 0, { level: Math.max(1, KBR.ARMOR.indexOf(b.armorMax)) });
    if (b.medkits > 0) L.add('medkit', x - 1, z, 0);
    L.add('ammo', x, z + 1, 0);
    KBR.Fx.sparkle(x, b.y, z, 0xffffff, 10, 1.2);
    if (KBR.Game.onBotDied) KBR.Game.onBotDied(b, source, wid);
  }

  // ---------------------------------------------------------------- helpers
  const def = (b) => KBR.WEAPONS[b.weapon.id];
  const eye = (b, out) => out.set(b.x, b.y + CFG.eye, b.z);
  function pickGoalNear(b, rad) {
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * TAU, d = 12 + Math.random() * rad, x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
      if (W.heightAt(x, z) > 0.8 && W.circleFree(x, z, 0.6, W.heightAt(x, z), 0.6)) { b.goalX = x; b.goalZ = z; b.goalT = 8 + Math.random() * 8; return; }
    }
    b.goalX = b.x; b.goalZ = b.z; b.goalT = 2;
  }
  function pickRotateGoal(b) {
    const z = KBR.Game.zone, t = z.target, a = Math.random() * TAU, d = Math.sqrt(Math.random()) * t.r * 0.75;
    b.goalX = t.x + Math.cos(a) * d; b.goalZ = t.z + Math.sin(a) * d; b.goalT = 20;
  }
  /** Finds a spot behind the nearest solid object, on the far side from the threat. */
  function pickCover(b) {
    const T = b.target; if (!T) return;
    let best = null, bd = 30 * 30;
    const cx = Math.floor((b.x + W.HALF) / 20), cz = Math.floor((b.z + W.HALF) / 20);
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * TAU, d = 4 + Math.random() * 18, px = b.x + Math.cos(a) * d, pz = b.z + Math.sin(a) * d, ph = W.heightAt(px, pz);
      if (ph < 0.6 || !W.circleFree(px, pz, 0.55, ph, 0.6)) continue;
      if (!W.hasLOS(T.x, T.y + 1.5, T.z, px, ph + 1.3, pz)) { const dd = (px - b.x) ** 2 + (pz - b.z) ** 2; if (dd < bd) { bd = dd; best = [px, pz]; } }
    }
    if (best) { b.coverX = best[0]; b.coverZ = best[1]; b.state = 'COVER'; b.stateT = 6; }
  }

  /** Steers toward (gx,gz) with obstacle probes; writes velocity and position. */
  function steer(b, gx, gz, speed, dt, face) {
    const dx = gx - b.x, dz = gz - b.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { b.vx = damp(b.vx, 0, 10, dt); b.vz = damp(b.vz, 0, 10, dt); b.spd = 0; return d; }
    let ang = Math.atan2(dz, dx);
    const look = Math.min(d, speed * 0.55 + 1.4), gy = W.heightAt(b.x, b.z);
    let chosen = null;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
      const a = ang + off, px = b.x + Math.cos(a) * look, pz = b.z + Math.sin(a) * look, ph = W.heightAt(px, pz);
      if (ph < -0.3 || ph - gy > look * 0.9) continue;
      if (W.circleFree(px, pz, 0.55, Math.max(ph, gy), 0.6)) { chosen = a; break; }
    }
    if (chosen === null) { chosen = ang + (b.strafe > 0 ? 1.6 : -1.6); b.stuckT += dt; }
    const tvx = Math.cos(chosen) * speed, tvz = Math.sin(chosen) * speed;
    b.vx = damp(b.vx, tvx, 7, dt); b.vz = damp(b.vz, tvz, 7, dt);
    if (face) b.yaw = dampAngle(b.yaw, Math.atan2(-b.vx, -b.vz), 9, dt);
    return d;
  }
  function integrate(b, dt) {
    const mv = W.moveCircle(b.x + b.vx * dt, b.z + b.vz * dt, CFG.radius, b.y, 0.62, b.y + 1.8);
    b.spd = Math.hypot(mv.x - b.x, mv.z - b.z) / Math.max(dt, 1e-4);
    b.x = mv.x; b.z = mv.z;
    const r = Math.hypot(b.x, b.z); if (r > 515) { b.x *= 515 / r; b.z *= 515 / r; }
    const g = W.groundY(b.x, b.z, b.y, 0.62); b.y = b.y > g + 0.1 ? Math.max(g, b.y - 25 * dt) : g;
  }

  // ---------------------------------------------------------------- perception
  function canSee(b, T) {
    const w = def(b), range = (SIGHT[w.cls] || 80) * diff.sight, dx = T.x - b.x, dz = T.z - b.z, d = Math.hypot(dx, dz);
    const heard = (KBR.Game.time - (T.lastShotAt || -9)) < 1.4 && d < 85, alerted = b.alertT > 0;
    if (d > range && !(heard && d < 85)) return false;
    if (!heard && !alerted) { const toYaw = Math.atan2(-dx, -dz); if (Math.abs(angleDiff(b.yaw, toYaw)) > 1.35) return false; }
    eye(b, _o);
    return W.hasLOS(_o.x, _o.y, _o.z, T.x, T.y + 1.35, T.z) || W.hasLOS(_o.x, _o.y, _o.z, T.x, T.y + 1.65, T.z);
  }
  function perceive(b) {
    let best = null, bd = 1e9;
    const consider = (T) => { if (!T || T === b || !T.alive || T.phase === 'PLANE') return; const d = (T.x - b.x) ** 2 + (T.z - b.z) ** 2; if (d < bd && canSee(b, T)) { bd = d; best = T; } };
    consider(C.player);
    for (const o of B.list) if (o !== b && o.alive && o.state !== 'WAIT' && o.state !== 'CHUTE') { const d = (o.x - b.x) ** 2 + (o.z - b.z) ** 2; if (d < 130 * 130) consider(o); }
    if (best && needsLoot(b) === 'w' && !b.alertT && (best.x - b.x) ** 2 + (best.z - b.z) ** 2 > 28 * 28) best = null; // unarmed bots look for a gun first
    if (best) {
      if (b.target !== best) { b.reactT = diff.react * (0.6 + Math.random() * 0.8); b.burst = 0; b.pause = 0.1; }
      b.target = best; b.seenT = KBR.Game.time; b.hasLast = true; b.lastKnownX = best.x; b.lastKnownZ = best.z;
      if (b.state !== 'COVER' && b.state !== 'HEAL' && b.state !== 'FIGHT') b.state = 'FIGHT';
    } else if (b.target && KBR.Game.time - b.seenT > 3.2) {
      b.target = null; if (b.state === 'FIGHT') { b.state = b.hasLast ? 'SEARCH' : 'ROAM'; b.goalX = b.lastKnownX; b.goalZ = b.lastKnownZ; b.stateT = 7; }
    }
  }

  // ---------------------------------------------------------------- shooting
  const _tgt = new THREE.Vector3();
  function shoot(b, now) {
    const T = b.target, w = def(b);
    eye(b, _o);
    // aim at chest, sometimes head (better aim = more head attempts)
    const head = Math.random() < 0.06 * b.skill;
    _tgt.set(T.x, T.y + (head ? 1.62 : 1.2), T.z);
    const tvx = T.vx || 0, tvz = T.vz || 0, d0 = _tgt.distanceTo(_o);
    if (w.projectile) { // lead the target and compensate drop: t = d / v, y += 0.5 g t^2
      const t = d0 / w.projectile.speed; _tgt.x += tvx * t; _tgt.z += tvz * t; _tgt.y += 0.5 * w.projectile.gravity * t * t;
    }
    _d.subVectors(_tgt, _o); const dist = _d.length(); _d.divideScalar(dist);
    // gaussian angular error: grows with distance, target speed, own movement; shrinks right after settling on a target
    const tSpeed = Math.hypot(tvx, tvz), settle = clamp(1 - (now - b.settleAt) / 0.9, 0, 1);
    let sigma = (0.017 + 0.00008 * dist) / b.skill + clamp(tSpeed / 8, 0, 1) * 0.009 + clamp(b.spd / 6, 0, 1) * 0.008 + settle * 0.02;
    if (w.cls === 'SNIPER') sigma *= 0.35;
    _r.crossVectors(_d, UP).normalize(); _u.crossVectors(_r, _d).normalize();
    _d.addScaledVector(_r, rng.gauss() * sigma).addScaledVector(_u, rng.gauss() * sigma).normalize();
    // muzzle sits just in front of the chest
    _v.set(b.x - Math.sin(b.yaw) * 0.6 - Math.cos(b.yaw) * 0.2, b.y + 1.35, b.z - Math.cos(b.yaw) * 0.6 + Math.sin(b.yaw) * 0.2);
    b.weapon.mag--; b.lastShotAt = KBR.Game.time;
    C.fire(b, w, KBR.RARITY[b.weapon.rarity].dmg, _v, _d, w.spread * 0.5, w.color);
    const cam = KBR.Game.camera.position, near = (_v.x - cam.x) ** 2 + (_v.z - cam.z) ** 2 < 260 * 260;
    if (near) { KBR.Fx.muzzle(_v, w.color, 0.8, false); KBR.Audio.shot(w.sound, _v); }
    b.rig.kick = 1;
  }

  // ---------------------------------------------------------------- state update
  function gotoGoalOrNew(b, dt, speed, kind) {
    b.goalT -= dt;
    const d = steer(b, b.goalX, b.goalZ, speed, dt, true);
    if (d < 3 || b.goalT <= 0) { if (kind === 'ROTATE') { pickGoalNear(b, 25); } else pickGoalNear(b, 55); }
  }
  function needsLoot(b) {
    if (b.weapon.id === 'pistol') return 'w';
    if (b.armorMax <= 0) return 'vest'; if (b.medkits < 1) return 'medkit';
    return null;
  }
  function takeLoot(b, it) {
    if (it.kind.startsWith('w:')) { const id = it.kind.slice(2); if (id === 'pistol') return false; const cur = b.weapon; if (cur.id === 'pistol' || it.rarity > cur.rarity + (cur.id === id ? 0 : 1)) { b.weapon = { id, rarity: it.rarity, mag: KBR.WEAPONS[id].mag }; b.rig.setWeapon(id); } else return false; }
    else if (it.kind === 'medkit') b.medkits++;
    else if (it.kind === 'vest') { const m = KBR.ARMOR[it.data.level]; if (m > b.armorMax) { b.armorMax = m; b.armor = m; } else return false; }
    else if (it.kind === 'ammo' || it.kind === 'barrier') { /* bots have unlimited ammo; barriers unused */ }
    KBR.Loot.take(it); return true;
  }
  function findLoot(b) {
    const want = needsLoot(b); let best = null, bd = 75 * 75;
    for (const it of KBR.Loot.items) {
      if (it.taken) continue;
      const k = it.kind;
      if (want === 'w' && !k.startsWith('w:')) continue;
      if (want === 'vest' && k !== 'vest') continue;
      if (want === 'medkit' && k !== 'medkit') continue;
      if (!want && !(k.startsWith('w:') && it.rarity > b.weapon.rarity)) continue;
      const d = (it.x - b.x) ** 2 + (it.z - b.z) ** 2; if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  function updateBot(b, dt, now) {
    const Z = KBR.Game.zone;
    if (b.state === 'WAIT') {
      if (KBR.Game.planeT >= b.jumpT) { b.state = 'CHUTE'; b.rig.root.visible = true; b.y = KBR.PLANE.altitude - 3; b.chuteSpeed = clamp(Math.hypot(b.tx - b.x, b.tz - b.z) / ((b.y - W.heightAt(b.tx, b.tz)) / 10), 6, 22); }
      else return;
    }
    if (b.state === 'CHUTE') {
      const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz) || 1, sp = Math.min(b.chuteSpeed, d / Math.max(dt, 0.001));
      b.x += dx / d * sp * dt; b.z += dz / d * sp * dt; b.y -= 10 * dt; b.yaw = dampAngle(b.yaw, Math.atan2(-dx, -dz), 3, dt);
      const g = W.heightAt(b.x, b.z); b.vx = dx / d * sp; b.vz = dz / d * sp;
      if (b.y <= g) { b.y = g; b.state = 'LOOT'; b.vx = b.vz = 0; b.lootAt = KBR.Game.time; b.rig.chute.visible = false; }
      return;
    }
    // storm damage (ignores vest)
    const zr = Math.hypot(b.x - Z.cur.x, b.z - Z.cur.z);
    if (zr > Z.cur.r && Z.dps > 0) { b.hp -= Z.dps * dt; if (b.hp <= 0) { b.hp = 0; b.die({ name: 'the storm' }, '', 'zone'); return; } }
    b.alertT = Math.max(0, b.alertT - dt); b.stateT = (b.stateT || 0) - dt; b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = 0.7 + Math.random() * 1.8; }
    // reload
    if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) b.weapon.mag = def(b).mag; }
    else if (b.weapon.mag <= 0) b.reloadT = def(b).reload * 1.15;
    // perception (throttled per bot)
    b.think -= dt; if (b.think <= 0) { b.think = 0.22 + Math.random() * 0.12; const had = b.target; perceive(b); if (b.target && b.target !== had) b.settleAt = now; }
    if (b.target && !b.target.alive) { b.target = null; if (b.state === 'FIGHT') b.state = 'ROAM'; }
    // storm rotation has priority when outside or about to be
    const outside = zr > Z.cur.r * 0.96 || (Z.state === 'SHRINK' && zr > Z.target.r * 0.9);
    switch (b.state) {
      case 'LOOT': {
        if (!b.lootIt || b.lootIt.taken) b.lootIt = findLoot(b);
        if (b.weapon.id === 'pistol' && now - (b.lootAt || 0) > 24 && !b.lootIt) { const id = PRIMARIES[Math.floor(Math.random() * PRIMARIES.length)]; b.weapon = { id, rarity: 0, mag: KBR.WEAPONS[id].mag }; b.rig.setWeapon(id); }
        if (b.lootIt && now - (b.lootAt || 0) < b.lootT + 18) {
          const d = steer(b, b.lootIt.x, b.lootIt.z, CFG.sprint * 0.9, dt, true);
          if (d < 1.6) { takeLoot(b, b.lootIt); b.lootIt = null; }
        } else { b.state = outside ? 'ROTATE' : 'ROAM'; pickGoalNear(b, 50); }
        break;
      }
      case 'ROAM': {
        if (outside) { b.state = 'ROTATE'; pickRotateGoal(b); break; }
        if (needsLoot(b) && Math.random() < 0.004) { b.state = 'LOOT'; b.lootAt = now; }
        // occasionally hunt toward the player or another bot
        if (Math.random() < 0.0012) { const T = Math.random() < 0.4 && C.player.alive ? C.player : B.list[Math.floor(Math.random() * B.list.length)]; if (T && T.alive && T !== b && Math.hypot(T.x - b.x, T.z - b.z) < 260) { b.goalX = T.x + (Math.random() - 0.5) * 30; b.goalZ = T.z + (Math.random() - 0.5) * 30; b.goalT = 14; } }
        gotoGoalOrNew(b, dt, CFG.walk, 'ROAM'); break;
      }
      case 'ROTATE': { if (!outside && b.goalT <= 0) { b.state = 'ROAM'; pickGoalNear(b, 50); break; } gotoGoalOrNew(b, dt, CFG.sprint, 'ROTATE'); break; }
      case 'SEARCH': { const d = steer(b, b.goalX, b.goalZ, CFG.walk * 1.1, dt, true); if (d < 4 || b.stateT <= 0) { b.state = 'ROAM'; pickGoalNear(b, 50); } break; }
      case 'HEAL': { b.vx = damp(b.vx, 0, 10, dt); b.vz = damp(b.vz, 0, 10, dt); b.healT -= dt; b.hp = Math.min(CFG.hp, b.hp + 30 * dt); if (b.healT <= 0) { b.state = b.target ? 'FIGHT' : 'ROAM'; } break; }
      case 'COVER': {
        const d = steer(b, b.coverX, b.coverZ, CFG.sprint, dt, true);
        if (d < 1.2 || b.stateT <= 0) {
          if (b.medkits > 0 && b.hp < CFG.hp * 0.7 && (!b.target || !W.hasLOS(b.target.x, b.target.y + 1.5, b.target.z, b.x, b.y + 1.3, b.z))) { b.medkits--; b.healT = 2.5; b.state = 'HEAL'; }
          else b.state = b.target ? 'FIGHT' : 'ROAM';
        }
        break;
      }
      case 'FIGHT': {
        const T = b.target; if (!T) { b.state = 'ROAM'; break; }
        const w = def(b), dx = T.x - b.x, dz = T.z - b.z, dist = Math.hypot(dx, dz), want = PREF[w.cls] || 25;
        b.yaw = dampAngle(b.yaw, Math.atan2(-dx, -dz), 10, dt);
        // hurt and no enemy chance: take cover / heal
        if (b.hp < CFG.hp * 0.35 && b.medkits > 0 && Math.random() < 0.01) pickCover(b);
        // position: close in or back off to the preferred range, strafing across the line of fire
        let fwd = dist > want * 1.25 ? 1 : dist < want * 0.55 ? -0.7 : 0.15;
        const toX = dx / (dist || 1), toZ = dz / (dist || 1), sx = -toZ * b.strafe, sz = toX * b.strafe;
        const sp = CFG.walk * (b.reloadT > 0 ? 1.2 : 0.9), gx = b.x + (toX * fwd + sx * 0.8) * 10, gz = b.z + (toZ * fwd + sz * 0.8) * 10;
        const yaw0 = b.yaw; steer(b, gx, gz, sp, dt, false); b.yaw = yaw0;
        // fire control
        b.reactT -= dt;
        const seeNow = now - b.seenT < 0.6;
        if (b.reactT <= 0 && seeNow && b.reloadT <= 0 && dist < w.range * 0.85 && (dist < (SIGHT[w.cls] || 90) * diff.sight + 25)) {
          b.fireT -= dt;
          if (b.burst <= 0) { b.pause -= dt; if (b.pause <= 0) { b.burst = Math.round(rng.range(w.burst[0], w.burst[1])); } }
          else if (b.fireT <= 0) { shoot(b, now); b.burst--; b.fireT = w.rate * (1.25 + Math.random() * 0.3); if (b.burst <= 0) b.pause = rng.range(w.pause[0], w.pause[1]) / Math.max(0.7, b.skill); }
        }
        break;
      }
    }
    integrate(b, dt);
  }

  /** Updates all bots. Far bots tick at a lower rate; dead bots play their fall then disappear. */
  B.update = function (dt, now) {
    const pl = C.player, camPos = KBR.Game.camera.position;
    for (const b of B.list) {
      if (!b.alive) {
        if (b.rig.root.visible) { KBR.Models.animate(b.rig, dt, { phase: 'dead', time: now }); if (now - b.deadAt > 6) { b.rig.root.visible = false; } }
        continue;
      }
      const dp = Math.hypot(b.x - camPos.x, b.z - camPos.z);
      b.lod = dp > 240 ? 2 : dp > 120 ? 1 : 0;
      b.accum += dt;
      const step = b.lod === 2 ? 0.12 : b.lod === 1 ? 0.05 : 0;
      if (b.accum >= step) { const h = b.accum; b.accum = 0; updateBot(b, h, now); }
      // visuals
      const r = b.rig, vis = b.state !== 'WAIT' && dp < 460;
      r.root.visible = vis;
      if (vis) {
        r.root.position.set(b.x, b.y, b.z); r.root.rotation.y = b.yaw;
        const far = dp > 70; if (far !== r.farLod) { r.farLod = far; r.outlines.forEach((o) => { o.visible = !far; }); }
        if (b.lod < 2) KBR.Models.animate(r, dt, { speed: b.spd, sprint: b.state === 'ROTATE' || b.state === 'LOOT', aiming: b.state === 'FIGHT', firing: b.state === 'FIGHT' && b.burst > 0, pitch: 0.02, reload: b.reloadT > 0 ? 1 - b.reloadT / def(b).reload : 0, phase: b.state === 'CHUTE' ? 'chute' : 'ground', time: now });
      }
    }
  };
  return B;
})();
