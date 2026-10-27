'use strict';
/*
 * The player: skydive -> parachute -> ground movement, weapons (recoil, bloom, reload), vest, healing, skills,
 * barrier placement and the third-person camera. Implements the combat "entity" contract (x/y/z feet, yaw, hp...).
 */
KBR.Player = (function () {
  const W = KBR.World, C = KBR.Combat, CFG = KBR.PLAYER;
  const P = { kind: 'player', name: 'YOU', id: -1 };
  const input = { f: 0, r: 0, fire: false, ads: false, sprint: false, jump: false, touchAssist: false };
  P.input = input;
  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Vector3(), _p = new THREE.Vector3(), _o = new THREE.Vector3();
  let scene, camera, rig = null, domeMesh = null, auraTimer = 0, camY = 0, stepAcc = 0, camShake = new THREE.Vector3(), lastGroundY = 0, healFx = 0;
  P.sens = 1; P.camera = null;

  const sidearm = () => ({ id: 'pistol', rarity: 0, mag: 12 });
  P.init = function (sceneRef, cameraRef) { scene = sceneRef; camera = cameraRef; P.camera = cameraRef; };

  P.reset = function (opts) {
    const ch = KBR.CHARACTERS[KBR.profile.char];
    P.char = ch; P.alive = true; P.phase = 'PLANE';
    P.maxHp = CFG.hp + (KBR.profile.hpLvl - 1) * 20; P.hp = P.maxHp; P.armor = 0; P.armorMax = 0; P.ep = 60; P.dome = false;
    P.dmgMul = 1 + (KBR.profile.dmgLvl - 1) * 0.05;
    P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0; P.recoil = 0; P.bloom = 0; P.grounded = false;
    P.slots = [null, null, sidearm()]; P.active = 2; P.ammo = { pistol: 48, rifle: 0, smg: 0, shotgun: 0, sniper: 0 };
    if (opts && opts.hot) { P.slots[0] = { id: 'rifle', rarity: 0, mag: 30 }; P.ammo.rifle = 90; P.active = 0; }
    P.barriers = 2; P.medkits = 1; P.kills = 0; P.damageDealt = 0; P.lastShot = -9; P.reloading = 0; P.reloadT = 0; P.healT = 0; P.landed = false;
    P.skillCd = 0; P.skillT = 0; P.dashT = 0; P.ads = false; P.chuteT = 0; P.fallT = 0; P.sprinting = false; P.killer = null; P.speed = 0; P.invul = 0; P.swim = false; P.damageTaken = 0;
    auraTimer = 0; camY = 0;
    if (rig) { scene.remove(rig.root); rig.dispose(); }
    rig = KBR.Models.makeCharacter({ outfit: ch.outfit, accent: ch.accent, hair: ch.hair, eye: ch.accent, acc: ch.id === 'hikari' ? 'headband' : ch.id === 'kage' ? 'hood' : 'goggles', hairStyle: ch.id === 'kage' ? 'bob' : 'spiky' });
    rig.root.traverse((o) => { o.castShadow = true; }); scene.add(rig.root); rig.setWeapon(P.cur().id); P.rig = rig;
    if (domeMesh) { scene.remove(domeMesh); domeMesh = null; }
    P.syncRig();
  };
  P.cur = () => P.slots[P.active] || P.slots[2];
  P.def = () => KBR.WEAPONS[P.cur().id];
  P.eyeY = () => P.y + CFG.eye;
  P.headPos = (out) => out.set(P.x, P.y + CFG.eye, P.z);
  P.isScoped = () => P.phase === 'GROUND' && P.ads && !!P.def().scopeFov && P.def().scopeFov < 20;

  // ---------------------------------------------------------------- damage (entity contract)
  P.onDamaged = function (dmg, raw, zone, source, wid, dir) {
    P.invul = 0; P.damageTaken += dmg;
    if (P.healT > 0) { P.healT = 0; KBR.UI.setHeal(null); KBR.UI.toast('Healing interrupted'); }
    KBR.Audio.hurt(); KBR.Fx.shake(0.28); KBR.UI.flash('hurt');
    if (source && source.x !== undefined && source !== P) KBR.UI.damageIndicator(Math.atan2(-(source.x - P.x), -(source.z - P.z)) - P.yaw);
    if (rig) rig.flinch = 1;
  };
  P.die = function (source, zone, wid) {
    P.alive = false; P.phase = 'DEAD'; P.killer = source; P.dome = false; P.input.fire = false; P.ads = false;
    KBR.Audio.defeat(); KBR.UI.setScope(false); KBR.UI.setPrompt(null); KBR.UI.setHeal(null);
    if (rig) rig.chute.visible = false;
    KBR.Game.onPlayerDied(source, wid);
  };
  /** Zone / fall / drown damage ignores the vest. */
  P.envDamage = function (amount, why) {
    if (!P.alive || P.invul > 0 || amount <= 0) return;
    P.hp -= amount; KBR.UI.flash(why === 'zone' ? 'zone' : 'hurt');
    if (P.healT > 0 && amount > 0.6) { P.healT = 0; KBR.UI.setHeal(null); }
    if (P.hp <= 0) { P.hp = 0; P.die({ name: why === 'zone' ? 'the storm' : 'the sea' }, '', why); }
  };
  P.heal = function (amount) { P.hp = Math.min(P.maxHp, P.hp + amount); };

  // ---------------------------------------------------------------- inventory
  P.giveWeapon = function (id, rarity) {
    const def = KBR.WEAPONS[id];
    for (let i = 0; i < 3; i++) { const s = P.slots[i]; if (s && s.id === id) { P.ammo[id] = Math.min(240, P.ammo[id] + def.mag); if (rarity > s.rarity) s.rarity = rarity; return 'Ammo +' + def.mag; } }
    let slot;
    if (id === 'pistol') slot = 2; else if (!P.slots[0]) slot = 0; else if (!P.slots[1]) slot = 1; else slot = P.active < 2 ? P.active : 0;
    const old = P.slots[slot];
    if (old && old.id !== 'pistol' || (old && slot === 2 && old.id === 'pistol')) { const l = KBR.Loot.add('w:' + old.id, P.x + rng.range(-1, 1), P.z + rng.range(-1, 1), old.rarity); if (l) l.y = W.heightAt(l.x, l.z); }
    P.slots[slot] = { id, rarity, mag: def.mag }; P.ammo[id] = Math.min(240, P.ammo[id] + def.reserve);
    P.select(slot); return 'Equipped';
  };
  P.pickup = function (it) {
    if (!it || it.taken || P.phase !== 'GROUND') return false;
    let msg = '';
    if (it.isDrop) {
      KBR.Loot.openDrop(it);
      P.giveWeapon('sniper', 3); P.armorMax = KBR.ARMOR[3]; P.armor = P.armorMax; P.medkits += 2; P.barriers += 2; P.ammo.sniper = Math.min(240, P.ammo.sniper + 20); P.ammo.rifle = Math.min(240, P.ammo.rifle + 60);
      KBR.UI.popup('SUPPLY CRATE', 'Legendary rifle, vest Lv.3, medkits and barriers', 'gold'); KBR.Audio.pickup(); KBR.Audio.heal(); return true;
    }
    if (it.kind.startsWith('w:')) { msg = P.giveWeapon(it.kind.slice(2), it.rarity); KBR.UI.popup(KBR.WEAPONS[it.kind.slice(2)].name.toUpperCase(), KBR.RARITY[it.rarity].name + ' - ' + msg, 'gold'); }
    else if (it.kind === 'medkit') { P.medkits = Math.min(6, P.medkits + 2); KBR.UI.popup('MEDKIT x2', 'Press 4 or HEAL', 'green'); }
    else if (it.kind === 'barrier') { P.barriers = Math.min(6, P.barriers + 2); KBR.UI.popup('OFUDA BARRIER x2', 'Press Q to place a wall', 'cyan'); }
    else if (it.kind === 'ammo') { const w = KBR.WEAPONS[it.data.wid], amt = it.data.amount || w.mag; P.ammo[it.data.wid] = Math.min(240, P.ammo[it.data.wid] + amt); KBR.UI.popup(w.cls + ' AMMO', '+' + amt + ' rounds', 'gold'); }
    else if (it.kind === 'vest') {
      const lvl = it.data.level, max = KBR.ARMOR[lvl];
      if (max >= P.armorMax || P.armor <= 0) { P.armorMax = max; P.armor = max; KBR.UI.popup('VEST LV.' + lvl, 'Soaks 55% of damage', 'gold'); } else { KBR.UI.toast('You already wear a better vest'); return false; }
    }
    KBR.Loot.take(it); KBR.Audio.pickup(); return true;
  };
  P.select = function (i) {
    if (i < 0 || i > 2 || !P.slots[i] || P.phase !== 'GROUND') return;
    if (P.active !== i) { P.active = i; P.reloading = 0; P.healT = 0; KBR.UI.setHeal(null); rig.setWeapon(P.cur().id); KBR.Audio.click(); }
  };
  P.cycle = function () { for (let k = 1; k <= 3; k++) { const i = (P.active + k) % 3; if (P.slots[i]) { P.select(i); return; } } };

  // ---------------------------------------------------------------- actions
  P.reload = function () {
    const ws = P.cur(), w = P.def();
    if (P.reloading > 0 || ws.mag >= w.mag || (P.ammo[ws.id] <= 0 && !KBR.profile.training) || P.phase !== 'GROUND') return;
    P.reloading = 1; P.reloadT = w.reload; KBR.Audio.reload(0); P.ads = false; KBR.UI.setScope(false);
  };
  P.useMedkit = function () {
    if (P.phase !== 'GROUND' || P.healT > 0 || P.hp >= P.maxHp) return;
    if (P.medkits <= 0 && !KBR.profile.training) { KBR.UI.toast('No medkits'); return; }
    if (!KBR.profile.training) P.medkits--;
    P.healT = 2.5; KBR.Audio.heal(); KBR.UI.setHeal(0);
  };
  P.placeBarrier = function () {
    if (P.phase !== 'GROUND') return;
    if (P.barriers <= 0 && !KBR.profile.training) { KBR.UI.toast('No barriers'); return; }
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    for (const d of [3.2, 4.2, 2.6]) {
      const x = P.x + fx * d, z = P.z + fz * d, h = W.heightAt(x, z);
      if (h > P.y + 1.4 || h < 0.3 || !W.circleFree(x, z, 0.6, h, 0.3)) continue;
      if (!KBR.profile.training) P.barriers--;
      C.placeBarrier(x, z, P.yaw, P); KBR.Audio.barrier(); KBR.Fx.ring(x, h + 0.4, z, 0x7aeaf2); KBR.Fx.shake(0.06); return;
    }
    KBR.UI.toast('No room for a barrier here');
  };
  P.useSkill = function () {
    if (P.phase !== 'GROUND' || P.skillCd > 0) return;
    const ch = P.char; P.skillCd = ch.cooldown; P.skillT = ch.duration; KBR.Audio.skill(ch.kind);
    KBR.UI.popup(ch.skill.toUpperCase(), ch.name + ' used a skill', 'gold');
    if (ch.kind === 'dome') { P.dome = true; makeDome(); }
    if (ch.kind === 'dash') {
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), mx = input.f * fx + input.r * Math.cos(P.yaw), mz = input.f * fz - input.r * Math.sin(P.yaw), l = Math.hypot(mx, mz) || 1;
      const dx = l > 0.05 && (input.f || input.r) ? mx / l : fx, dz = l > 0.05 && (input.f || input.r) ? mz / l : fz;
      P.vx = dx * 26; P.vz = dz * 26; P.dashT = 0.35; P.heal(60); P.ep = Math.min(CFG.maxEp, P.ep + 25); KBR.Fx.ring(P.x, P.y + 0.5, P.z, 0x4fe3c1);
    }
  };
  function makeDome() {
    if (domeMesh) scene.remove(domeMesh);
    domeMesh = new THREE.Mesh(new THREE.SphereGeometry(C.DOME_R, 24, 16), new THREE.MeshBasicMaterial({ color: 0x9a86ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    domeMesh.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(C.DOME_R, 12, 8)), new THREE.LineBasicMaterial({ color: 0xcfc2ff, transparent: true, opacity: 0.4 })));
    scene.add(domeMesh);
  }

  P.look = function (dx, dy, scale) {
    const sens = P.sens * (P.isScoped() ? 0.32 : P.ads ? 0.62 : 1) * (scale || 1);
    P.yaw -= dx * 0.0026 * sens; P.pitch = clamp(P.pitch - dy * 0.0026 * sens, -1.25, 1.35);
  };

  // ---------------------------------------------------------------- shooting
  function spreadNow(w, ws) {
    let s = w.spread + P.bloom;
    const sp = clamp(P.speed / CFG.sprint, 0, 1);
    s += sp * (w.cls === 'SNIPER' ? 0.04 : 0.011) + (P.grounded ? 0 : 0.02);
    if (w.cls === 'SNIPER' && !P.ads) s += 0.05;
    if (P.ads) s *= w.cls === 'SNIPER' ? 0.15 : 0.5;
    return s;
  }
  P.currentSpread = () => spreadNow(P.def(), P.cur());

  function tryFire(now) {
    if (P.phase !== 'GROUND' || P.reloading > 0 || P.healT > 0) return;
    const ws = P.cur(), w = P.def();
    if (now - P.lastShot < w.rate) return;
    if (ws.mag <= 0) { P.lastShot = now + 0.25; KBR.Audio.empty(); P.reload(); return; }
    P.lastShot = now; P.lastShotAt = KBR.Game.time; ws.mag--;
    // camera ray -> aim point
    camera.getWorldDirection(_f);
    _p.copy(camera.position);
    const along = _m.set(P.x - _p.x, P.y + CFG.eye - _p.y, P.z - _p.z).dot(_f);
    _o.copy(_p).addScaledVector(_f, Math.max(0, along));
    const res = C.trace(_o.x, _o.y, _o.z, _f.x, _f.y, _f.z, w.range, P);
    const aim = res ? _c.copy(res.point) : _c.copy(_o).addScaledVector(_f, Math.min(w.range, 300));
    rig.muzzleWorld(_m);
    const toAim = _p.copy(aim).sub(_m), dist = toAim.length();
    const dir = dist > 2.5 ? toAim.divideScalar(dist) : _f;
    const mul = KBR.RARITY[ws.rarity].dmg;
    const sum = C.fire(P, w, mul, _m, dir, spreadNow(w, ws), w.color);
    // recoil: view climbs, drifts sideways, bloom grows
    const kick = w.recoilV * (0.85 + Math.random() * 0.3) * (P.ads ? 0.7 : 1);
    P.pitch += kick; P.recoil += kick; P.yaw += (Math.random() - 0.5) * 2 * w.recoilH * (P.ads ? 0.7 : 1);
    P.bloom = Math.min(w.bloomMax, P.bloom + w.bloomShot);
    rig.kick = 1; KBR.Fx.muzzle(_m, w.color, w.cls === 'SHOTGUN' || w.cls === 'SNIPER' ? 1.5 : 0.9, true); KBR.Audio.shot(w.sound, null);
    KBR.Fx.shake(w.cls === 'SNIPER' ? 0.3 : w.cls === 'SHOTGUN' ? 0.22 : 0.05);
    if (sum.hit) onShotConnected(sum, w);
    if (ws.mag <= 0 && (P.ammo[ws.id] > 0 || KBR.profile.training)) setTimeout(() => P.alive && P.reload(), 180);
    KBR.UI.pulseCrosshair();
  }
  function onShotConnected(sum, w) {
    P.damageDealt += sum.dmg;
    KBR.Audio.hit(sum.head); KBR.UI.hitMarker(sum.head, sum.killed);
    if (sum.point) KBR.Fx.text(sum.point, String(Math.round(sum.dmg)), sum.head ? 'head' : '');
  }
  C.onPlayerShot = onShotConnected;

  // ---------------------------------------------------------------- per-frame
  function aimAssist(dt) {
    if (!input.touchAssist || !input.fire || P.phase !== 'GROUND') return;
    camera.getWorldDirection(_f);
    let best = null, bestA = 0.07; // ~4 degrees
    for (const e of C.getTargets()) {
      if (e === P || !e.alive) continue;
      _m.set(e.x - camera.position.x, e.y + 1.2 - camera.position.y, e.z - camera.position.z); const d = _m.length(); if (d > 110 || d < 2) continue;
      _m.divideScalar(d); const a = Math.acos(clamp(_f.dot(_m), -1, 1));
      if (a < bestA && W.hasLOS(camera.position.x, camera.position.y, camera.position.z, e.x, e.y + 1.2, e.z)) { bestA = a; best = _m.clone(); }
    }
    if (!best) return;
    const ty = Math.atan2(-best.x, -best.z), tp = Math.asin(clamp(best.y, -1, 1)), cp = Math.asin(clamp(_f.y, -1, 1));
    const k = clamp(dt * 3.2, 0, 1) * 0.5; // gentle pull toward the body, never snaps
    P.yaw += angleDiff(P.yaw, ty) * k; P.pitch += (tp - cp) * k;
  }

  function groundMove(dt) {
    const w = P.def(), sinY = Math.sin(P.yaw), cosY = Math.cos(P.yaw);
    let mf = input.f, mr = input.r; const len = Math.hypot(mf, mr); if (len > 1) { mf /= len; mr /= len; }
    const wantSprint = input.sprint && mf > 0.2 && !P.ads && P.reloading <= 0 && !input.fire && P.healT <= 0;
    P.sprinting = wantSprint;
    let speed = P.ads ? CFG.ads : wantSprint ? CFG.sprint : CFG.walk;
    speed *= w.moveMul * (P.char.passiveSpeed || 1) * (P.char.kind === 'aura' && P.skillT > 0 ? 1.25 : 1) * (P.healT > 0 ? 0.55 : 1);
    P.swim = W.heightAt(P.x, P.z) < -0.55;
    if (P.swim) speed *= 0.5;
    const dx = (-sinY * mf + cosY * mr), dz = (-cosY * mf - sinY * mr), mag = Math.min(1, Math.hypot(mf, mr));
    const tx = dx * speed * (mag > 0 ? 1 : 0), tz = dz * speed * (mag > 0 ? 1 : 0);
    if (P.dashT > 0) { P.dashT -= dt; } else { const lam = P.grounded ? 13 : 2.2; P.vx = damp(P.vx, tx, lam, dt); P.vz = damp(P.vz, tz, lam, dt); }
    let nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    // slope limit: refuse to climb more than ~44 degrees
    const stepLen = Math.hypot(nx - P.x, nz - P.z);
    if (stepLen > 1e-4 && P.grounded) {
      const rise = W.heightAt(nx, nz) - W.heightAt(P.x, P.z);
      if (rise / stepLen > 0.95 && W.heightAt(nx, nz) > P.y + 0.3) { P.vx *= 0.2; P.vz *= 0.2; nx = P.x; nz = P.z; }
    }
    const mv = W.moveCircle(nx, nz, CFG.radius, P.y, CFG.stepHeight, P.y + 1.8); nx = mv.x; nz = mv.z;
    const rr = Math.hypot(nx, nz); if (rr > 520) { nx *= 520 / rr; nz *= 520 / rr; }
    P.speed = Math.hypot(nx - P.x, nz - P.z) / Math.max(dt, 1e-4);
    P.x = nx; P.z = nz;
    // vertical
    const g = W.groundY(P.x, P.z, P.y, CFG.stepHeight);
    if (P.grounded && input.jump && !P.swim) { P.vy = CFG.jump; P.grounded = false; KBR.Audio.step(false, 1.6); }
    input.jump = false;
    if (P.grounded) {
      if (g > P.y + 0.001 && g - P.y <= CFG.stepHeight + 0.05) P.y = g; // step up
      else if (P.y - g > 0.35) { P.grounded = false; P.vy = 0; } // walked off an edge
      else P.y = g;
    }
    if (!P.grounded) {
      P.vy -= CFG.gravity * dt; P.y += P.vy * dt;
      if (P.y <= g && P.vy <= 0) {
        const impact = -P.vy; P.y = g; P.vy = 0; P.grounded = true;
        if (impact > 13) { P.envDamage((impact - 13) * 5, 'fall'); KBR.Fx.shake(0.3); }
        if (impact > 4) { KBR.Audio.step(false, 2); KBR.Fx.impact(_m.set(P.x, P.y, P.z), null, 'terrain'); }
      }
    }
    // footsteps / swimming splashes
    if (P.grounded && P.speed > 1) {
      stepAcc += P.speed * dt; if (stepAcc > (wantSprint ? 2.2 : 1.7)) { stepAcc = 0; P.swim ? KBR.Audio.splash() : KBR.Audio.step(W.roadDist(P.x, P.z) < 3.5, wantSprint ? 1.3 : 0.9); if (P.swim) KBR.Fx.impact(_m.set(P.x, 0, P.z), null, 'water'); }
    }
    if (P.swim && W.heightAt(P.x, P.z) < -3.2) P.envDamage(6 * dt, 'sea');
  }

  function skydive(dt) {
    const sinY = Math.sin(P.yaw), cosY = Math.cos(P.yaw), g = W.heightAt(P.x, P.z);
    if (P.phase === 'FREEFALL') {
      P.fallT += dt;
      const dive = input.f > 0.3, brake = input.f < -0.3;
      const fwd = dive ? 36 : brake ? 9 : 22, term = dive ? 74 : brake ? 40 : 56;
      const tx = -sinY * fwd + cosY * input.r * 10, tz = -cosY * fwd - sinY * input.r * 10;
      P.vx = damp(P.vx, tx, 1.3, dt); P.vz = damp(P.vz, tz, 1.3, dt);
      // quadratic drag: dv/dt = -g + k*v^2, k = g / terminal^2  (so vy settles at -terminal)
      const k = 20 / (term * term); P.vy += (-20 + k * P.vy * P.vy) * dt;
      P.x += P.vx * dt; P.z += P.vz * dt; P.y += P.vy * dt;
      if ((P.y < g + 95 && P.fallT > 1.2) || (input.jump && P.fallT > 1.2)) openChute();
      input.jump = false;
    } else {
      P.chuteT += dt;
      const dive = input.f > 0.3, flare = input.f < -0.3;
      const fwd = dive ? 20 : flare ? 7 : 14, sink = dive ? -11 : flare ? -4.2 : -7;
      const tx = -sinY * fwd + cosY * input.r * 5, tz = -cosY * fwd - sinY * input.r * 5;
      P.vx = damp(P.vx, tx, 1.6, dt); P.vz = damp(P.vz, tz, 1.6, dt); P.vy = damp(P.vy, sink, 1.4, dt);
      P.x += P.vx * dt; P.z += P.vz * dt; P.y += P.vy * dt;
      if (P.y <= g + 0.05) land();
    }
    const rr = Math.hypot(P.x, P.z); if (rr > 560) { P.x *= 560 / rr; P.z *= 560 / rr; }
    P.speed = Math.hypot(P.vx, P.vz);
  }
  function openChute() { P.phase = 'CHUTE'; P.chuteT = 0; KBR.Audio.chute(); KBR.Fx.shake(0.35); KBR.UI.popup('PARACHUTE OPEN', 'W to dive forward, S to slow down', 'cyan'); }
  function land() {
    P.phase = 'GROUND'; P.y = Math.max(W.heightAt(P.x, P.z), P.y); P.grounded = true; P.vy = 0; P.vx *= 0.3; P.vz *= 0.3; P.landed = true;
    if (rig) rig.chute.visible = false;
    KBR.UI.popup('TOUCHDOWN', 'Find a weapon. Glowing pillars mark loot.', 'gold'); KBR.Audio.step(false, 2); KBR.Fx.impact(_m.set(P.x, P.y, P.z), null, 'terrain');
    KBR.Game.onLanded();
  }
  P.eject = function () {
    if (P.phase !== 'PLANE') { if (P.phase === 'FREEFALL' || P.phase === 'CHUTE') input.jump = true; return; }
    const pl = KBR.Game.plane;
    P.phase = 'FREEFALL'; P.fallT = 0; P.x = pl.x; P.y = pl.y - 3; P.z = pl.z; P.vx = pl.vx * 0.55; P.vz = pl.vz * 0.55; P.vy = -4;
    KBR.Audio.chute(); KBR.UI.popup('JUMP!', 'Steer with the mouse. W dives, S slows.', 'cyan'); KBR.UI.setSkydive(true);
  };

  P.update = function (dt, now) {
    if (P.phase === 'LOBBY') return;
    const ws = P.alive ? P.cur() : null, w = ws ? P.def() : null;
    if (P.alive) {
      P.skillCd = Math.max(0, P.skillCd - dt); P.invul = Math.max(0, P.invul - dt);
      if (P.skillT > 0) { P.skillT -= dt; if (P.char.kind === 'aura') { P.heal(15 * dt); auraTimer -= dt; if (auraTimer <= 0) { auraTimer = 0.12; KBR.Fx.sparkle(P.x, P.y, P.z, 0xffd36b, 1, 2.6); } } if (P.skillT <= 0 && P.dome) { P.dome = false; if (domeMesh) { scene.remove(domeMesh); domeMesh = null; } } }
      if (P.phase === 'PLANE') {
        const pl = KBR.Game.plane; P.x = pl.x; P.y = pl.y; P.z = pl.z; P.speed = 0;
      } else if (P.phase === 'FREEFALL' || P.phase === 'CHUTE') skydive(dt);
      else if (P.phase === 'GROUND') {
        groundMove(dt); aimAssist(dt);
        // weapon timers
        P.bloom = Math.max(0, P.bloom - dt * (w.bloomMax * 2.2 + 0.01));
        if (!input.fire && P.recoil > 0) { const back = Math.min(P.recoil, P.recoil * (1 - Math.exp(-5 * dt)) + 0.0005); P.pitch -= back * 0.6; P.recoil -= back; }
        if (P.reloading > 0) {
          P.reloadT -= dt; const total = w.reload; P.reloading = clamp(1 - P.reloadT / total, 0.001, 1);
          if (P.reloadT <= total * 0.3 && !P.reloadClick) { P.reloadClick = true; KBR.Audio.reload(1); }
          if (P.reloadT <= 0) { const need = w.mag - ws.mag, take = KBR.profile.training ? need : Math.min(need, P.ammo[ws.id]); ws.mag += take; if (!KBR.profile.training) P.ammo[ws.id] -= take; P.reloading = 0; P.reloadClick = false; }
        } else P.reloadClick = false;
        if (P.healT > 0) { P.healT -= dt; P.heal(30 * dt); KBR.UI.setHeal(clamp(1 - P.healT / 2.5, 0, 1)); healFx -= dt; if (healFx <= 0) { healFx = 0.15; KBR.Fx.sparkle(P.x, P.y, P.z, 0x6ff0a0, 1, 1.2); } if (P.healT <= 0) KBR.UI.setHeal(null); }
        if (input.fire) tryFire(now);
        if (input.ads !== P.ads && P.reloading <= 0) { P.ads = input.ads; KBR.UI.setScope(P.isScoped()); }
        // ki energy slowly converts to HP
        if (P.ep > 0 && P.hp < P.maxHp) { const t = Math.min(P.ep, 6 * dt); P.ep -= t; P.hp = Math.min(P.maxHp, P.hp + t); }
      }
    }
    P.syncRig(dt, now);
    if (P.alive && P.phase !== 'PLANE') KBR.Audio.setAmbience(now, P.phase === 'GROUND' ? 0.08 : clamp(Math.abs(P.vy) / 70, 0.2, 1), clamp((40 - Math.hypot(P.x, P.z) * 0.06), 0.1, 1));
  };

  P.syncRig = function (dt, now) {
    if (!rig) return;
    const phase = P.phase === 'DEAD' ? 'dead' : P.phase === 'FREEFALL' ? 'fall' : P.phase === 'CHUTE' ? 'chute' : 'ground';
    rig.root.position.set(P.x, P.y, P.z); rig.root.rotation.y = P.yaw;
    rig.root.visible = P.phase !== 'PLANE' && !(P.isScoped());
    KBR.Models.animate(rig, dt || 0.016, { speed: P.grounded ? P.speed : 0, sprint: P.sprinting, aiming: P.ads, firing: input.fire, pitch: P.pitch, reload: P.reloading, phase, time: now || 0 });
    if (domeMesh) { domeMesh.position.set(P.x, P.y + 1.2, P.z); domeMesh.material.opacity = 0.18 + Math.sin((now || 0) * 6) * 0.05; domeMesh.rotation.y += (dt || 0) * 0.5; }
  };

  // ---------------------------------------------------------------- camera
  const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _want = new THREE.Vector3(), _piv = new THREE.Vector3();
  P.updateCamera = function (dt, now) {
    const w = P.alive ? P.def() : null;
    let fov = 70;
    if (P.phase === 'PLANE') {
      const pl = KBR.Game.plane, a = P.yaw;
      camera.position.set(pl.x + Math.sin(a) * 50, pl.y + 24, pl.z + Math.cos(a) * 50); camera.lookAt(pl.x - Math.sin(a) * 30, pl.y - 14, pl.z - Math.cos(a) * 30); camera.fov = 66;
    } else if (P.phase === 'DEAD') {
      return; // the game moves the camera (kill cam)
    } else {
      const cp = Math.cos(P.pitch), fwd = _fw.set(-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp), right = _rt.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
      camY = camY ? damp(camY, P.y, 18, dt) : P.y; if (Math.abs(camY - P.y) > 1.5) camY = P.y;
      const sky = P.phase === 'FREEFALL' || P.phase === 'CHUTE', scoped = P.isScoped();
      _piv.set(P.x, camY + (sky ? 1.0 : CFG.eye), P.z);
      let dist = sky ? (P.phase === 'CHUTE' ? 7.5 : 6.5) : P.ads ? 1.5 : 3.1, side = sky ? 0 : P.ads ? 0.5 : 0.72, up = sky ? 1.3 : 0.18;
      if (scoped) { dist = 0; side = 0; up = 0; }
      _want.copy(_piv).addScaledVector(fwd, -dist).addScaledVector(right, side); _want.y += up;
      if (dist > 0) { // pull the camera in front of walls and keep it above the ground
        _m.copy(_want).sub(_piv); const d = _m.length(); _m.divideScalar(d);
        const hit = W.raycast(_piv.x, _piv.y, _piv.z, _m.x, _m.y, _m.z, d + 0.25, false);
        if (hit) _want.copy(_piv).addScaledVector(_m, Math.max(0.35, hit.t - 0.25));
        _want.y = Math.max(_want.y, W.heightAt(_want.x, _want.z) + 0.35);
      } else _want.addScaledVector(fwd, 0.25);
      KBR.Fx.shakeOffset(_o, now); camera.position.copy(_want).add(_o);
      _m.copy(camera.position).add(fwd); camera.lookAt(_m);
      if (P.phase === 'FREEFALL') fov = 76 + clamp((-P.vy - 40) * 0.25, 0, 10);
      else if (P.phase === 'CHUTE') fov = 70;
      else fov = P.ads && w ? (w.adsFov && !scoped ? w.adsFov : w.scopeFov || 50) : (P.sprinting ? 76 : 70);
    }
    camera.fov = damp(camera.fov, fov, 11, dt); camera.updateProjectionMatrix();
  };

  P.pos = () => _p.set(P.x, P.y, P.z);
  return P;
})();
