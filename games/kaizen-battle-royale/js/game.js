'use strict';
/*
 * Orchestrator: renderer, staged loading, lobby backdrop, match flow (plane, safe zone, airdrops, results),
 * and the main loop with a dynamic-resolution governor.
 */
KBR.Game = (function () {
  const G = { state: 'LOADING', paused: false, mapOpen: false, ending: false, time: 0, planeT: 0, aimedEnemy: false, zone: null, plane: null, camera: null };
  const W = KBR.World, P = KBR.Player, C = KBR.Combat, U = KBR.UI;
  const $ = (id) => document.getElementById(id);
  const NO_GOV = /[?&]nogov/.test(location.search);
  let renderer, scene, camera, planeMesh, zoneWall, zoneRing, q, qKey, resScale = 1, govT = 0, govN = 0, govSum = 0;
  let last = 0, matchStart = 0, targets = [], nextDrop = 0, dropsLeft = 0, stormTick = 0, aimT = 0, endT = 0, endInfo = null, lobbyT = 0;
  const _v = new THREE.Vector3(), _d = new THREE.Vector3();

  // ---------------------------------------------------------------- quality
  function autoQuality() {
    const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
    if (U.isTouch) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
    return cores <= 4 ? 'medium' : 'high';
  }
  function resolveQuality() { const k = KBR.profile.quality; return KBR.QUALITY[k] ? k : autoQuality(); }
  function applyPixelRatio() {
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.pr) * resScale);
    renderer.setPixelRatio(pr); renderer.setSize(window.innerWidth, window.innerHeight);
    KBR.Fx.pixelRatio = pr; KBR.Fx.resize();
  }
  G.applyQuality = function () {
    qKey = resolveQuality(); q = KBR.QUALITY[qKey]; resScale = 1;
    W.setShadows(q.shadow); KBR.Models.setOutlines(q.outlines); KBR.Fx.setQuality(q); applyPixelRatio();
  };
  /** Trades resolution for frame rate: shrinks the render scale when frames run long, restores it when there is headroom. */
  function govern(dt) {
    if (NO_GOV) return;
    govSum += dt; govN++; govT += dt;
    if (govT < 1.6) return;
    const avg = govSum / govN; govT = govSum = govN = 0;
    if (avg > 0.026 && resScale > 0.55) { resScale = Math.max(0.55, resScale - 0.12); applyPixelRatio(); }
    else if (avg < 0.0145 && resScale < 1) { resScale = Math.min(1, resScale + 0.06); applyPixelRatio(); }
    else if (avg > 0.034 && resScale <= 0.55 && KBR.profile.quality === 'auto' && qKey !== 'low') { qKey = 'low'; q = KBR.QUALITY.low; W.setShadows(0); KBR.Models.setOutlines(false); applyPixelRatio(); }
  }

  // ---------------------------------------------------------------- boot
  const tick = () => new Promise((r) => setTimeout(r, 16));
  async function stage(pct, text, fn) {
    $('load-i').style.width = pct + '%'; if (text) $('load-t').textContent = text;
    await tick(); if (fn) fn(); await tick();
  }
  async function boot() {
    try {
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
      qKey = resolveQuality(); q = KBR.QUALITY[qKey];
      await stage(8, 'Preparing the renderer...', () => {
        renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: !U.isTouch && qKey === 'high', powerPreference: 'high-performance' });
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.15, 2600);
        G.camera = camera; scene.add(camera);
      });
      let group;
      await stage(20, 'Raising the island from the sea...', () => { group = W.init(scene, q, 1337); });
      await stage(48, 'Building shrines, harbours and neon streets...', () => KBR.Build.build(group, q));
      await stage(66, 'Dressing the fighters...', () => { KBR.Models.init(q); KBR.Fx.init(scene, camera, q, $('fx-layer')); C.init(scene); KBR.Loot.init(scene); P.init(scene, camera); KBR.Bots.init(scene); });
      await stage(80, 'Painting the map...', () => {
        U.buildMaps();
        planeMesh = KBR.Models.makePlane(); planeMesh.visible = false; scene.add(planeMesh);
        zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 800, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0x6a5cff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        zoneWall.position.y = 300; zoneWall.frustumCulled = false; scene.add(zoneWall);
        zoneRing = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 500, 72, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, fog: false, wireframe: true }));
        zoneRing.position.y = 200; zoneRing.frustumCulled = false; scene.add(zoneRing);
        zoneWall.visible = zoneRing.visible = false;
        C.player = P; C.getTargets = () => targets;
        KBR.Bots.setDifficulty(KBR.profile.diff);
        U.init(); G.applyQuality();
        addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); applyPixelRatio(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'PLAY' && !G.paused) G.pause(true); });
      });
      await stage(100, 'Ready!', () => { G.state = 'LOBBY'; P.phase = 'LOBBY'; P.alive = false; });
      $('loading').style.display = 'none'; U.show('lobby', true);
      last = performance.now(); requestAnimationFrame(frame);
    } catch (err) {
      console.error(err); $('load-t').textContent = 'Could not start: ' + (err && err.message ? err.message : err) + ' (WebGL needed)';
    }
  }

  // ---------------------------------------------------------------- zone
  function pickTarget(cur, r) {
    let best = null;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * Math.max(0, cur.r - r) * 0.9, x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
      if (!best) best = { x, z, r };
      if (W.heightAt(x, z) > 1.2) { best = { x, z, r }; break; }
    }
    return best;
  }
  function initZone() {
    const S = KBR.ZONE.start, ph = KBR.ZONE.phases;
    G.zone = { cur: { x: S.x, z: S.z, r: S.r }, from: { x: S.x, z: S.z, r: S.r }, target: pickTarget(S, ph[0].r), phase: 0, state: 'HOLD', timer: ph[0].hold + 24, dps: ph[0].dps };
  }
  function updateZone(dt) {
    const Z = G.zone, ph = KBR.ZONE.phases, done = Z.phase >= ph.length;
    if (done) return;
    Z.timer -= dt;
    if (Z.state === 'HOLD') {
      if (Z.timer <= 0) { Z.state = 'SHRINK'; Z.timer = ph[Z.phase].shrink; Z.from = { x: Z.cur.x, z: Z.cur.z, r: Z.cur.r }; U.toast('The storm is closing in'); KBR.Audio.zone(); }
    } else {
      const k = 1 - Math.max(0, Z.timer) / ph[Z.phase].shrink;
      Z.cur.x = lerp(Z.from.x, Z.target.x, k); Z.cur.z = lerp(Z.from.z, Z.target.z, k); Z.cur.r = lerp(Z.from.r, Z.target.r, k);
      if (Z.timer <= 0) {
        Z.cur.x = Z.target.x; Z.cur.z = Z.target.z; Z.cur.r = Z.target.r; Z.phase++;
        if (Z.phase < ph.length) { Z.state = 'HOLD'; Z.timer = ph[Z.phase].hold; Z.dps = ph[Z.phase].dps; Z.target = pickTarget(Z.cur, ph[Z.phase].r); U.toast('New safe zone marked'); }
        else { Z.state = 'HOLD'; Z.timer = 0; Z.dps = ph[ph.length - 1].dps * 1.4; Z.target = { x: Z.cur.x, z: Z.cur.z, r: Z.cur.r }; }
      }
    }
  }
  function updateZoneVisual(now) {
    const Z = G.zone; zoneWall.visible = zoneRing.visible = true;
    zoneWall.scale.set(Z.cur.r, 1, Z.cur.r); zoneWall.position.x = Z.cur.x; zoneWall.position.z = Z.cur.z;
    zoneWall.material.opacity = 0.17 + Math.sin(now * 2.2) * 0.04;
    const showNext = Z.state === 'HOLD' && Z.phase < KBR.ZONE.phases.length;
    zoneRing.visible = showNext; if (showNext) { zoneRing.scale.set(Z.target.r, 1, Z.target.r); zoneRing.position.x = Z.target.x; zoneRing.position.z = Z.target.z; }
  }

  // ---------------------------------------------------------------- match
  G.aliveCount = () => { let n = P.alive ? 1 : 0; for (const b of KBR.Bots.list) if (b.alive) n++; return n; };

  G.startMatch = function (hot) {
    if (G.state !== 'LOBBY') return;
    const seed = (Math.random() * 1e9) | 0, KP = KBR.PLANE;
    // flight path crosses the island but is offset so every match has a different line
    const ang = Math.random() * TAU, dx = Math.cos(ang), dz = Math.sin(ang), off = (Math.random() - 0.5) * 300;
    const sx = -dx * KP.length / 2 - dz * off, sz = -dz * KP.length / 2 + dx * off;
    G.plane = { sx, sz, dx, dz, len: KP.length, speed: KP.speed, x: sx, y: KP.altitude, z: sz, vx: dx * KP.speed, vz: dz * KP.speed };
    G.planeT = 0; G.time = 0; G.ending = false; G.paused = false; G.mapOpen = false; endInfo = null; endT = 0; stormTick = 0; aimT = 0;
    C.clear(); KBR.Fx.clear(); KBR.Loot.reset();
    P.reset({ hot }); P.yaw = Math.atan2(-dx, -dz); P.pitch = 0; P.sens = KBR.profile.sens;
    KBR.Bots.setDifficulty(KBR.profile.diff); KBR.Bots.spawn(KBR.BOTS.count, G.plane, seed);
    targets = [P].concat(KBR.Bots.list);
    KBR.Loot.spawnAll(new RNG(seed ^ 0x5bd1e995));
    initZone(); dropsLeft = 3; nextDrop = 70;
    planeMesh.visible = true; planeMesh.rotation.y = P.yaw;
    matchStart = 0; G.state = 'PLAY';
    U.show('lobby', false); U.show('hud', true); $('result').classList.add('hidden'); $('pause').classList.add('hidden'); $('bigmap').classList.add('hidden');
    document.body.classList.add('playing'); if (U.isTouch) $('touch').classList.add('on');
    if (KBR.profile.training) U.toast('Training: infinite ammo, medkits and barriers');
    KBR.Audio.startAmbience(); U.lockPointer(); U.frame(0, 0);
    U.popup('KAIZEN BATTLE ROYALE', U.isTouch ? 'Tap JUMP over the island' : 'Press SPACE to jump over the island', 'gold');
  };

  G.pause = function (on) {
    if (G.state !== 'PLAY' || G.ending || G.paused === on) return;
    G.paused = on; U.show('pause', on); P.input.fire = false; P.input.ads = false;
    if (on && document.pointerLockElement) document.exitPointerLock();
    if (!on) { U.lockPointer(); last = performance.now(); }
  };

  function cleanup() {
    C.clear(); KBR.Fx.clear(); KBR.Loot.reset(); KBR.Bots.clear(); targets = [];
    P.phase = 'LOBBY'; P.alive = false; if (P.rig) P.rig.root.visible = false; P.input.fire = false; P.input.ads = false; U.setScope(false); U.setHeal(null); U.setPrompt(null);
    planeMesh.visible = false; zoneWall.visible = zoneRing.visible = false; KBR.Audio.stopAmbience();
    G.state = 'LOBBY'; G.paused = false; G.ending = false; G.mapOpen = false;
    if (document.pointerLockElement) document.exitPointerLock();
    U.show('pause', false); U.show('hud', false); U.show('bigmap', false); $('touch').classList.remove('on'); document.body.classList.remove('playing');
  }
  G.quitToLobby = function () { cleanup(); $('result').classList.add('hidden'); U.refreshLobby(); U.show('lobby', true); };

  function finish(win, rank) {
    if (G.ending) return;
    G.ending = true; const prof = KBR.profile, training = !!prof.training;
    const t = G.time - matchStart, kp = training ? 0 : Math.round(30 + P.kills * 50 + Math.max(0, 31 - rank) * 4 + (win ? 300 : 0));
    if (!training) { prof.kp += kp; prof.matches++; prof.kills += P.kills; prof.best = Math.max(prof.best, P.kills); if (win) prof.wins++; KBR.saveProfile(); }
    endInfo = { win, rank, kills: P.kills, dmg: P.damageDealt, time: t, kp }; endT = win ? 3 : 2.4;
    if (document.pointerLockElement) document.exitPointerLock();
    P.input.fire = false; P.input.ads = false; U.setScope(false);
  }
  G.onPlayerDied = function (source, wid) {
    const by = source && source.name ? source.name : 'the storm';
    U.killFeed(by + ' eliminated YOU', 'me'); U.popup('ELIMINATED', 'by ' + by, 'red');
    G.killer = source; finish(false, G.aliveCount() + 1);
  };
  G.onBotDied = function (b, source, wid) {
    const w = wid && KBR.WEAPONS[wid] ? KBR.WEAPONS[wid].name : '';
    if (source === P) { P.kills++; KBR.Audio.kill(); U.popup('ELIMINATED ' + b.name.toUpperCase(), (P.kills > 1 ? P.kills + ' eliminations' : 'First blood') + (w ? ' - ' + w : ''), 'gold'); U.killFeed('YOU eliminated ' + b.name, 'me'); }
    else if (source && source.kind === 'bot') { source.kills++; U.killFeed(source.name + ' eliminated ' + b.name); }
    else U.killFeed(b.name + ' was lost to ' + (source && source.name ? source.name : 'the storm'));
    if (P.alive && !G.ending && G.aliveCount() <= 1) {
      finish(true, 1); KBR.Audio.victory(); U.popup('SHOURI! 勝利', 'Last fighter standing', 'gold'); KBR.Fx.confetti(P.x, P.y + 2, P.z);
    }
  };
  G.onLanded = function () { /* hook kept for modules; landing popup is shown by the player */ };

  // ---------------------------------------------------------------- interaction
  let promptItem = null;
  function updatePrompt() {
    promptItem = null;
    if (P.phase === 'GROUND' && P.alive) {
      const it = KBR.Loot.nearest(P.x, P.z, 3.4);
      if (it && Math.abs(it.y - P.y) < 3.6) promptItem = it;
    }
    U.setPrompt(promptItem ? (promptItem.isDrop ? KBR.Loot.dropLabel() : KBR.Loot.label(promptItem)) : null);
  }
  G.interact = function () { if (promptItem) { P.pickup(promptItem); promptItem = null; } };

  // ---------------------------------------------------------------- airdrops
  function updateDrops(dt) {
    if (P.phase === 'PLANE' || dropsLeft <= 0) return;
    nextDrop -= dt;
    if (nextDrop <= 0) {
      const t = G.zone.target, a = Math.random() * TAU, d = Math.sqrt(Math.random()) * t.r * 0.7;
      let x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      for (let k = 0; k < 10 && (W.heightAt(x, z) < 1 || !W.circleFree(x, z, 1.6, W.heightAt(x, z), 0.5)); k++) { const a2 = Math.random() * TAU, d2 = Math.random() * t.r * 0.7; x = t.x + Math.cos(a2) * d2; z = t.z + Math.sin(a2) * d2; }
      KBR.Loot.spawnDrop(x, z); dropsLeft--; nextDrop = 65 + Math.random() * 25;
      U.toast('Supply crate dropping - check the map'); KBR.Audio.zone();
    }
  }

  // ---------------------------------------------------------------- frame
  function updatePlay(dt) {
    G.time += dt; const now = G.time, pl = G.plane;
    // plane
    G.planeT += dt; const run = Math.min(G.planeT, pl.len / pl.speed + 6);
    pl.x = pl.sx + pl.dx * pl.speed * run; pl.z = pl.sz + pl.dz * pl.speed * run;
    planeMesh.position.set(pl.x, pl.y, pl.z); planeMesh.visible = G.planeT < pl.len / pl.speed + 5;
    planeMesh.userData.props.forEach((p) => { p.rotation.x += dt * 40; });
    if (P.phase === 'PLANE' && G.planeT > pl.len / pl.speed + 1) P.eject();
    if (matchStart === 0 && P.phase === 'GROUND') matchStart = now;

    U.applyInput();
    P.update(dt, now);
    KBR.Bots.update(dt, now);
    C.update(dt);
    KBR.Loot.update(dt, P.x, P.z);
    updateZone(dt); updateDrops(dt);
    if (P.alive && P.phase === 'GROUND') {
      const out = Math.hypot(P.x - G.zone.cur.x, P.z - G.zone.cur.z) > G.zone.cur.r;
      stormTick += dt; if (stormTick >= 0.5) { stormTick = 0; if (out) { P.envDamage(G.zone.dps * 0.5, 'zone'); KBR.Audio.hurt(); } }
    }
    updatePrompt();
    // is the crosshair on an enemy? (a few times a second is plenty)
    aimT -= dt;
    if (aimT <= 0) {
      aimT = 0.09; G.aimedEnemy = false;
      if (P.phase === 'GROUND' && P.alive) { camera.getWorldDirection(_d); const r = C.trace(camera.position.x, camera.position.y, camera.position.z, _d.x, _d.y, _d.z, 160, P); G.aimedEnemy = !!(r && r.kind === 'entity'); }
    }
  }
  function killCam(dt, now) {
    const T = G.killer && G.killer.x !== undefined && G.killer.alive ? G.killer : null, a = now * 0.45;
    _v.set(P.x + Math.sin(a) * 6.5, P.y + 3.2, P.z + Math.cos(a) * 6.5);
    _v.y = Math.max(_v.y, W.heightAt(_v.x, _v.z) + 1.2);
    camera.position.lerp(_v, 1 - Math.exp(-3 * dt));
    camera.lookAt(T ? (P.x + T.x) / 2 : P.x, P.y + 1, T ? (P.z + T.z) / 2 : P.z); camera.fov = damp(camera.fov, 60, 6, dt); camera.updateProjectionMatrix();
  }
  function lobbyCam(dt) {
    lobbyT += dt * 0.07; const poi = KBR.POIS[0], r = 150;
    camera.position.set(poi.x + Math.cos(lobbyT) * r, 58 + Math.sin(lobbyT * 0.7) * 8, poi.z + Math.sin(lobbyT) * r);
    camera.lookAt(poi.x, 14, poi.z); camera.fov = 58; camera.updateProjectionMatrix();
  }

  /** One full simulation + presentation step. Also driven directly by tests (G.step) to fast-forward without rendering. */
  function stepPlay(dt) {
    updatePlay(dt);
    if (P.phase === 'DEAD') killCam(dt, G.time); else P.updateCamera(dt, G.time);
    if (G.ending) { endT -= dt; if (endT <= 0 && endInfo) { const r = endInfo; endInfo = null; cleanup(); U.showResult(r); return; } }
    KBR.Fx.update(dt, camera.position, G.time);
    W.updateEnv(dt, camera.position, G.time); W.updateShadow(P.phase === 'PLANE' || !P.alive ? camera.position : _v.set(P.x, P.y, P.z), q);
    KBR.Audio.setListener(camera.position.x, camera.position.y, camera.position.z, P.yaw);
    updateZoneVisual(G.time); U.frame(dt, G.time);
    govern(dt);
  }
  G.step = function (n, dt) { for (let i = 0; i < n && G.state === 'PLAY'; i++) stepPlay(dt || 1 / 30); };
  G.noRender = false;

  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.0005, (t - last) / 1000)); last = t;
    if (G.state === 'PLAY' && !G.paused) {
      stepPlay(dt);
    } else if (G.state === 'LOBBY') {
      lobbyCam(dt); G.time += dt * 0.2; W.updateEnv(dt, camera.position, G.time); W.updateShadow(_v.set(KBR.POIS[0].x, 14, KBR.POIS[0].z), q);
      KBR.Fx.update(dt, camera.position, G.time);
      for (const b of KBR.Bots.list) if (b.rig.root.visible && !b.alive) { KBR.Models.animate(b.rig, dt, { phase: 'dead', time: G.time }); }
    }
    if (!G.noRender) renderer.render(scene, camera);
  }

  boot();
  return G;
})();
