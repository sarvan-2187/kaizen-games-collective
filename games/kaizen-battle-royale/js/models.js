'use strict';
/*
 * Procedural 3D models: cel-shaded anime-style characters (rigged from a few merged meshes), weapons,
 * parachutes, the cargo plane, airdrop crates and loot pickups. No external assets.
 */
KBR.Models = (function () {
  const M = {};
  let ramp, charMat, outlineMat, outlinesOn = true;
  const cache = {};
  const YA = new THREE.Vector3(0, 1, 0);
  const M4 = new THREE.Matrix4(), Qt = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const Eu = new THREE.Euler();

  function xf(x, y, z, sx, sy, sz, rx, ry, rz) {
    Qt.setFromEuler(Eu.set(rx || 0, ry || 0, rz || 0, 'YXZ')); return M4.compose(V.set(x, y, z), Qt, S.set(sx, sy, sz));
  }
  const G = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    cyl: () => new THREE.CylinderGeometry(1, 1, 1, 10),
    cone: () => new THREE.ConeGeometry(1, 1, 7),
    sph: () => new THREE.SphereGeometry(1, 12, 9),
  };
  const g = (k) => cache['g_' + k] || (cache['g_' + k] = G[k]());
  /** parts: [{k, x,y,z, sx,sy,sz, rx,ry,rz, c}] -> one merged, vertex-coloured geometry. */
  function merge(parts) {
    const b = new GeoBatch();
    for (const p of parts) b.add(g(p.k), xf(p.x || 0, p.y || 0, p.z || 0, p.sx || 1, p.sy || 1, p.sz || 1, p.rx, p.ry, p.rz), p.c);
    return b.build();
  }
  /** Inflated copy for the inverted-hull outline. */
  function outlineOf(geo, w) {
    const o = geo.clone(), p = o.attributes.position, n = smoothedNormals(geo);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n[i * 3] * w, p.getY(i) + n[i * 3 + 1] * w, p.getZ(i) + n[i * 3 + 2] * w);
    o.deleteAttribute('color'); return o;
  }

  M.init = function (q) {
    ramp = KBR.World.toonRamp(3);
    charMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
    outlineMat = new THREE.MeshBasicMaterial({ color: 0x1c1432, side: THREE.BackSide });
    outlinesOn = q.outlines;
  };
  M.setOutlines = function (on) { outlinesOn = on; M._rigs.forEach((r) => r.outlines.forEach((o) => { o.visible = on && !r.farLod; })); };
  M._rigs = new Set();

  // ---------------------------------------------------------------- weapons
  /** Each weapon is built facing -z with the grip at the origin. `muzzle` is where bullets and flashes start. */
  const WEAPON_BUILD = {
    pistol: (c) => ({ muzzle: [0, 0.03, -0.3], parts: [{ k: 'box', sx: 0.065, sy: 0.085, sz: 0.3, y: 0.04, z: -0.13, c: 0x4a5160 }, { k: 'box', sx: 0.05, sy: 0.15, sz: 0.07, y: -0.07, z: 0.01, rx: -0.2, c: 0x2d3340 }, { k: 'box', sx: 0.07, sy: 0.03, sz: 0.2, y: 0.095, z: -0.12, c }] }),
    rifle: (c) => ({ muzzle: [0, 0.05, -0.78], parts: [{ k: 'box', sx: 0.075, sy: 0.1, sz: 0.4, y: 0.04, z: -0.12, c: 0x4a5160 }, { k: 'box', sx: 0.08, sy: 0.075, sz: 0.3, y: 0.03, z: -0.44, c }, { k: 'cyl', sx: 0.018, sy: 0.3, sz: 0.018, y: 0.045, z: -0.69, rx: Math.PI / 2, c: 0x252a35 }, { k: 'box', sx: 0.07, sy: 0.1, sz: 0.28, y: 0.0, z: 0.26, c: 0x3a4050 }, { k: 'box', sx: 0.055, sy: 0.2, sz: 0.085, y: -0.14, z: -0.1, rx: 0.12, c: 0x2d3340 }, { k: 'box', sx: 0.05, sy: 0.15, sz: 0.06, y: -0.1, z: 0.05, rx: -0.25, c: 0x2d3340 }, { k: 'box', sx: 0.05, sy: 0.05, sz: 0.14, y: 0.115, z: -0.15, c: 0x1c2030 }] }),
    smg: (c) => ({ muzzle: [0, 0.04, -0.46], parts: [{ k: 'box', sx: 0.08, sy: 0.1, sz: 0.34, y: 0.04, z: -0.12, c: 0x4a5160 }, { k: 'box', sx: 0.082, sy: 0.04, sz: 0.2, y: 0.1, z: -0.14, c }, { k: 'cyl', sx: 0.02, sy: 0.16, sz: 0.02, y: 0.045, z: -0.38, rx: Math.PI / 2, c: 0x252a35 }, { k: 'box', sx: 0.05, sy: 0.26, sz: 0.07, y: -0.17, z: -0.1, rx: 0.08, c: 0x2d3340 }, { k: 'box', sx: 0.05, sy: 0.14, sz: 0.06, y: -0.09, z: 0.05, rx: -0.25, c: 0x2d3340 }, { k: 'box', sx: 0.05, sy: 0.07, sz: 0.2, y: 0.03, z: 0.17, c: 0x3a4050 }] }),
    shotgun: (c) => ({ muzzle: [0, 0.04, -0.98], parts: [{ k: 'box', sx: 0.08, sy: 0.1, sz: 0.3, y: 0.03, z: -0.1, c: 0x4a5160 }, { k: 'cyl', sx: 0.03, sy: 0.78, sz: 0.03, y: 0.055, z: -0.58, rx: Math.PI / 2, c: 0x252a35 }, { k: 'cyl', sx: 0.026, sy: 0.6, sz: 0.026, y: 0.0, z: -0.52, rx: Math.PI / 2, c: 0x3a4050 }, { k: 'box', sx: 0.075, sy: 0.07, sz: 0.2, y: -0.02, z: -0.5, c }, { k: 'box', sx: 0.075, sy: 0.13, sz: 0.3, y: -0.01, z: 0.22, c: 0x6a4a35 }, { k: 'box', sx: 0.05, sy: 0.14, sz: 0.06, y: -0.1, z: 0.05, rx: -0.25, c: 0x2d3340 }] }),
    sniper: (c) => ({ muzzle: [0, 0.05, -1.22], parts: [{ k: 'box', sx: 0.075, sy: 0.1, sz: 0.5, y: 0.03, z: -0.15, c: 0x4a5160 }, { k: 'cyl', sx: 0.022, sy: 0.85, sz: 0.022, y: 0.05, z: -0.82, rx: Math.PI / 2, c: 0x252a35 }, { k: 'cyl', sx: 0.04, sy: 0.3, sz: 0.04, y: 0.115, z: -0.22, rx: Math.PI / 2, c: 0x1c2030 }, { k: 'cyl', sx: 0.046, sy: 0.04, sz: 0.046, y: 0.115, z: -0.38, rx: Math.PI / 2, c: 0x6ad0ff }, { k: 'box', sx: 0.07, sy: 0.12, sz: 0.34, y: 0.0, z: 0.3, c }, { k: 'box', sx: 0.03, sy: 0.18, sz: 0.03, y: -0.08, z: -0.78, rx: 0.5, c: 0x2d3340 }, { k: 'box', sx: 0.05, sy: 0.15, sz: 0.06, y: -0.1, z: 0.05, rx: -0.25, c: 0x2d3340 }] }),
  };
  M.weapon = function (id) {
    const key = 'w_' + id;
    if (!cache[key]) { const w = WEAPON_BUILD[id](KBR.WEAPONS[id].color), geo = merge(w.parts); cache[key] = { geo, muzzle: new THREE.Vector3(...w.muzzle) }; }
    return cache[key];
  };

  // ---------------------------------------------------------------- characters
  const SKIN = 0xffdcc2;
  function bodyParts(look) {
    const o = look.outfit, a = look.accent, h = look.hair, parts = [];
    parts.push({ k: 'box', sx: 0.46, sy: 0.14, sz: 0.28, y: 0.07, c: 0x2a2f45 });                       // hips
    parts.push({ k: 'box', sx: 0.5, sy: 0.5, sz: 0.3, y: 0.39, c: o });                                  // torso
    parts.push({ k: 'box', sx: 0.52, sy: 0.07, sz: 0.32, y: 0.55, c: a });                               // jacket stripe
    parts.push({ k: 'box', sx: 0.34, sy: 0.36, sz: 0.14, y: 0.4, z: 0.21, c: 0x3a3f55 });               // pack
    parts.push({ k: 'cyl', sx: 0.07, sy: 0.08, sz: 0.07, y: 0.66, c: SKIN });                            // neck
    parts.push({ k: 'sph', sx: 0.18, sy: 0.19, sz: 0.18, y: 0.84, c: SKIN });                            // head
    for (const s of [-1, 1]) {                                                                           // anime eyes
      parts.push({ k: 'box', sx: 0.055, sy: 0.08, sz: 0.02, x: s * 0.075, y: 0.84, z: -0.168, c: 0x1c1432 });
      parts.push({ k: 'box', sx: 0.04, sy: 0.05, sz: 0.02, x: s * 0.075, y: 0.835, z: -0.176, c: look.eye });
      parts.push({ k: 'box', sx: 0.018, sy: 0.02, sz: 0.02, x: s * 0.07 + 0.012, y: 0.862, z: -0.18, c: 0xffffff });
    }
    parts.push({ k: 'box', sx: 0.04, sy: 0.012, sz: 0.02, y: 0.77, z: -0.177, c: 0xc86a6a });          // mouth
    // hair
    parts.push({ k: 'sph', sx: 0.2, sy: 0.17, sz: 0.2, y: 0.9, z: 0.015, c: h });
    parts.push({ k: 'box', sx: 0.38, sy: 0.07, sz: 0.1, y: 0.915, z: -0.13, c: h });                     // fringe
    for (let i = 0; i < 3; i++) parts.push({ k: 'cone', sx: 0.05, sy: 0.14, sz: 0.04, x: (i - 1) * 0.11, y: 0.855, z: -0.172, rx: Math.PI, c: h });
    const spikes = look.hairStyle === 'spiky' ? 7 : 3;
    for (let i = 0; i < spikes; i++) {
      const ang = i / spikes * TAU + 0.4, lean = 0.7;
      parts.push({ k: 'cone', sx: 0.075, sy: 0.26 + (i % 3) * 0.04, sz: 0.075, x: Math.sin(ang) * 0.1, y: 1.0, z: Math.cos(ang) * 0.1 + 0.03, rx: -Math.cos(ang) * lean, rz: Math.sin(ang) * lean, c: h });
    }
    if (look.hairStyle === 'long') parts.push({ k: 'box', sx: 0.34, sy: 0.4, sz: 0.1, y: 0.7, z: 0.17, c: h });
    // accessories
    const acc = look.acc;
    if (acc === 'headband') { parts.push({ k: 'box', sx: 0.4, sy: 0.04, sz: 0.4, y: 0.92, c: a }); parts.push({ k: 'box', sx: 0.14, sy: 0.04, sz: 0.04, x: 0.14, y: 0.9, z: 0.24, c: a }); }
    if (acc === 'goggles') { for (const s of [-1, 1]) parts.push({ k: 'cyl', sx: 0.065, sy: 0.05, sz: 0.065, x: s * 0.08, y: 0.97, z: -0.13, rx: Math.PI / 2, c: 0x6ad0ff }); parts.push({ k: 'box', sx: 0.42, sy: 0.03, sz: 0.4, y: 0.95, c: 0x2d3340 }); }
    if (acc === 'ears') { for (const s of [-1, 1]) parts.push({ k: 'cone', sx: 0.075, sy: 0.17, sz: 0.04, x: s * 0.1, y: 1.07, z: 0.0, rz: -s * 0.25, c: h }); }
    if (acc === 'mask') { parts.push({ k: 'box', sx: 0.17, sy: 0.18, sz: 0.04, x: 0.13, y: 0.93, z: -0.13, ry: -0.5, c: 0xf6f2ea }); parts.push({ k: 'box', sx: 0.05, sy: 0.02, sz: 0.045, x: 0.13, y: 0.93, z: -0.135, ry: -0.5, c: 0xd9423f }); }
    if (acc === 'scarf') { parts.push({ k: 'box', sx: 0.36, sy: 0.1, sz: 0.34, y: 0.69, c: a }); parts.push({ k: 'box', sx: 0.1, sy: 0.34, sz: 0.05, x: 0.1, y: 0.5, z: 0.2, c: a }); }
    if (acc === 'hood') { parts.push({ k: 'sph', sx: 0.235, sy: 0.22, sz: 0.235, y: 0.86, z: 0.04, c: o }); parts.push({ k: 'box', sx: 0.3, sy: 0.14, sz: 0.1, y: 0.76, z: -0.15, c: 0x14122a }); parts.push({ k: 'box', sx: 0.2, sy: 0.02, sz: 0.03, y: 0.82, z: -0.2, c: a }); }
    return parts;
  }
  const armGeo = (look) => { const k = 'arm_' + look.outfit + '_' + look.accent; return cache[k] || (cache[k] = merge([{ k: 'box', sx: 0.14, sy: 0.4, sz: 0.14, y: -0.2, c: look.outfit }, { k: 'box', sx: 0.145, sy: 0.07, sz: 0.145, y: -0.09, c: look.accent }, { k: 'box', sx: 0.115, sy: 0.12, sz: 0.115, y: -0.46, c: SKIN }])); };
  const legGeo = (look) => { const k = 'leg_' + look.outfit; return cache[k] || (cache[k] = merge([{ k: 'box', sx: 0.18, sy: 0.7, sz: 0.2, y: -0.35, c: 0x2a2f45 }, { k: 'box', sx: 0.2, sy: 0.1, sz: 0.3, y: -0.74, z: -0.04, c: 0xe8e2d6 }, { k: 'box', sx: 0.2, sy: 0.03, sz: 0.31, y: -0.69, z: -0.04, c: look.accent }])); };

  /**
   * look: {outfit, accent, hair, eye, acc, hairStyle}. Returns a rig:
   * root (yaw) -> legs + upper (pivot at the hips) -> body, arms, weaponPivot -> weapon. Faces -z.
   */
  M.makeCharacter = function (look) {
    const key = 'body_' + [look.outfit, look.accent, look.hair, look.eye, look.acc, look.hairStyle].join('_');
    const bodyG = cache[key] || (cache[key] = merge(bodyParts(look))), aG = armGeo(look), lG = legGeo(look);
    const root = new THREE.Group(), upper = new THREE.Group(), outlines = [];
    const mk = (geo, parent, x, y, z) => {
      const m = new THREE.Mesh(geo, charMat); m.position.set(x, y, z); m.castShadow = true; parent.add(m);
      const okey = 'o_' + geo.uuid, og = cache[okey] || (cache[okey] = outlineOf(geo, 0.016)), o = new THREE.Mesh(og, outlineMat); o.visible = outlinesOn; m.add(o); outlines.push(o);
      return m;
    };
    const legL = mk(lG, root, -0.11, 0.78, 0), legR = mk(lG, root, 0.11, 0.78, 0);
    upper.position.y = 0.78; root.add(upper);
    mk(bodyG, upper, 0, 0, 0);
    const armR = mk(aG, upper, 0.33, 0.54, 0), armL = mk(aG, upper, -0.33, 0.54, 0);
    armR.rotation.order = armL.rotation.order = 'YXZ';
    const weaponPivot = new THREE.Group(); weaponPivot.position.set(0.04, 0.5, -0.28); upper.add(weaponPivot);
    const chute = M.makeParachute(look.accent); chute.visible = false; chute.position.y = 0.2; root.add(chute);
    const rig = { root, upper, armL, armR, legL, legR, weaponPivot, weaponMesh: null, muzzleLocal: new THREE.Vector3(0, 0, -0.5), chute, outlines, look, t: Math.random() * 6, aim: 0.3, kick: 0, flinch: 0, farLod: false, deadT: 0, weaponId: null };
    rig.setWeapon = (id) => {
      if (rig.weaponId === id) return;
      rig.weaponId = id;
      if (rig.weaponMesh) { weaponPivot.remove(rig.weaponMesh); }
      if (!id) { rig.weaponMesh = null; return; }
      const w = M.weapon(id), m = new THREE.Mesh(w.geo, charMat); m.castShadow = true; weaponPivot.add(m); rig.weaponMesh = m; rig.muzzleLocal.copy(w.muzzle);
    };
    rig.muzzleWorld = (out) => { weaponPivot.updateWorldMatrix(true, false); return out.copy(rig.muzzleLocal).applyMatrix4(rig.weaponMesh ? rig.weaponMesh.matrixWorld : weaponPivot.matrixWorld); };
    M._rigs.add(rig);
    rig.dispose = () => { M._rigs.delete(rig); };
    return rig;
  };

  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  /**
   * Procedural animation. s: {speed, sprint, aiming, firing, pitch, reload(0..1), phase: 'ground'|'chute'|'fall'|'dead', time}
   */
  M.animate = function (rig, dt, s) {
    rig.t += dt * Math.min(s.speed, 10) * 1.55;
    const amp = clamp(s.speed / 6, 0, 1.25) * 0.8, sw = Math.sin(rig.t);
    const { root, upper, armL, armR, legL, legR, weaponPivot } = rig;
    rig.kick = Math.max(0, rig.kick - dt * 9); rig.flinch = Math.max(0, rig.flinch - dt * 5);
    if (s.phase === 'dead') {
      rig.deadT += dt; const k = ease(rig.deadT / 0.6);
      root.rotation.x = -Math.PI / 2 * k;
      legL.rotation.x = legR.rotation.x = 0; rig.chute.visible = false; return;
    }
    rig.deadT = 0; root.rotation.x = 0;
    const lowered = s.phase === 'ground' ? (s.sprint && !s.firing ? 1 : (s.aiming || s.firing ? 0 : 0.35)) : 0.6;
    rig.aim = damp(rig.aim, 1 - lowered, 9, dt);
    const pitch = clamp(s.pitch || 0, -0.9, 1.0);
    let wp = lerp(-0.75, pitch, rig.aim);
    if (s.reload > 0) wp -= 0.55 * Math.sin(Math.min(1, s.reload) * Math.PI);
    wp += rig.flinch * 0.15 + rig.kick * 0.1;
    weaponPivot.rotation.x = wp; weaponPivot.position.z = -0.28 + rig.kick * 0.09; weaponPivot.position.y = 0.5 + Math.sin(rig.t * 0.5 + s.time) * 0.004;
    armR.rotation.set(Math.PI / 2 + wp, 0.32, 0); armL.rotation.set(Math.PI / 2 + wp, -0.28, 0);
    rig.chute.visible = s.phase === 'chute';
    if (s.phase === 'ground') {
      legL.rotation.x = sw * amp; legR.rotation.x = -sw * amp;
      upper.position.y = 0.78 + Math.abs(sw) * 0.035 * amp; upper.rotation.x = damp(upper.rotation.x, (s.sprint ? 0.2 : 0.04) + rig.flinch * 0.2, 9, dt); upper.rotation.z = sw * 0.03 * amp;
    } else if (s.phase === 'chute') {
      legL.rotation.x = legR.rotation.x = 0.2; upper.rotation.x = 0; upper.position.y = 0.78;
      armR.rotation.set(Math.PI * 0.95, 0.2, -0.2); armL.rotation.set(Math.PI * 0.95, -0.2, 0.2);
    } else { // freefall: belly-down star pose
      root.rotation.x = damp(root.rotation.x, -1.25, 6, dt);
      legL.rotation.x = -0.25; legR.rotation.x = -0.25; upper.position.y = 0.78; upper.rotation.x = 0;
      armR.rotation.set(0.2, 0, 1.3); armL.rotation.set(0.2, 0, -1.3);
    }
  };

  // ---------------------------------------------------------------- parachute, plane, crate
  M.makeParachute = function (accent) {
    const grp = new THREE.Group(), N = 12;
    const dome = new THREE.SphereGeometry(2.7, 24, 8, 0, TAU, 0, Math.PI / 2), pos = dome.attributes.position, cols = [];
    for (let i = 0; i < pos.count; i++) { const a = Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI, gore = Math.floor(a / TAU * N) % 2; const c = new THREE.Color(gore ? 0xf7f3ea : accent); cols.push(c.r, c.g, c.b); }
    dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); dome.scale(1, 0.62, 1);
    const m = new THREE.Mesh(dome, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, side: THREE.DoubleSide })); m.position.y = 3.4; m.castShadow = true; grp.add(m);
    const pts = [];
    for (let i = 0; i < N; i++) { const a = i / N * TAU; pts.push(new THREE.Vector3(Math.cos(a) * 2.7, 3.4, Math.sin(a) * 2.7), new THREE.Vector3((i % 2 ? 0.18 : -0.18), 1.35, 0)); }
    grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xeeeeee })));
    return grp;
  };

  M.makePlane = function () {
    const grp = new THREE.Group(), white = 0xf4f1ea, red = 0xd9423f, grey = 0x8d96a8;
    const body = merge([
      { k: 'cyl', sx: 2.5, sy: 22, sz: 2.5, rx: Math.PI / 2, c: white }, { k: 'cone', sx: 2.5, sy: 5, sz: 2.5, z: -13.4, rx: -Math.PI / 2, c: grey },
      { k: 'cone', sx: 2.5, sy: 7, sz: 2.2, z: 14.4, rx: Math.PI / 2, c: white },
      { k: 'box', sx: 36, sy: 0.55, sz: 5.5, y: 0.9, z: -1.5, c: white }, { k: 'box', sx: 14, sy: 0.4, sz: 3.2, y: 0.5, z: 13.5, c: white },
      { k: 'box', sx: 0.5, sy: 6, sz: 5, y: 3.6, z: 13.4, c: white },
      { k: 'box', sx: 5.2, sy: 0.7, sz: 18, y: -0.5, z: 0, c: red }, { k: 'cyl', sx: 1.5, sy: 0.12, sz: 1.5, y: 1.25, z: -1.5, c: red }, { k: 'cyl', sx: 1.6, sy: 0.12, sz: 1.6, x: 0.35, y: 5.0, z: 13.4, rz: Math.PI / 2, c: red },
      { k: 'box', sx: 6, sy: 0.8, sz: 0.3, y: 0.7, z: -12.6, c: 0x274a7a },
    ]);
    const b = new THREE.Mesh(body, charMat); b.castShadow = true; grp.add(b);
    const engines = merge([-12, -5.5, 5.5, 12].map((x) => ({ k: 'cyl', sx: 0.75, sy: 3.6, sz: 0.75, x, y: 0.2, z: -3.8, rx: Math.PI / 2, c: grey })));
    grp.add(new THREE.Mesh(engines, charMat));
    grp.userData.props = [];
    for (const x of [-12, -5.5, 5.5, 12]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.4, 0.35), new THREE.MeshBasicMaterial({ color: 0x252a35, transparent: true, opacity: 0.55 })); p.position.set(x, 0.2, -5.7); grp.add(p); grp.userData.props.push(p);
    }
    return grp;
  };

  M.makeCrate = function () {
    const grp = new THREE.Group();
    const b = merge([{ k: 'box', sx: 2.2, sy: 2.0, sz: 2.2, y: 1.0, c: 0xb98a55 }, { k: 'box', sx: 2.26, sy: 0.25, sz: 2.26, y: 1.5, c: 0xd9423f }, { k: 'box', sx: 2.26, sy: 0.25, sz: 2.26, y: 0.5, c: 0xd9423f }, { k: 'box', sx: 0.3, sy: 2.05, sz: 2.26, y: 1.0, c: 0xf6f2ea }, { k: 'box', sx: 2.26, sy: 2.05, sz: 0.3, y: 1.0, c: 0xf6f2ea }]);
    const m = new THREE.Mesh(b, charMat); m.castShadow = true; grp.add(m);
    const ch = M.makeParachute(0xd9423f); ch.scale.setScalar(1.7); ch.position.y = 0.4; grp.add(ch); grp.userData.chute = ch;
    return grp;
  };

  // ---------------------------------------------------------------- loot visuals (one geometry per kind)
  M.lootGeo = function (kind) {
    const key = 'loot_' + kind;
    if (cache[key]) return cache[key];
    let geo;
    if (kind.startsWith('w:')) geo = M.weapon(kind.slice(2)).geo.clone().scale(1.5, 1.5, 1.5);
    else if (kind === 'medkit') geo = merge([{ k: 'box', sx: 0.5, sy: 0.36, sz: 0.34, y: 0.18, c: 0xf4f6f8 }, { k: 'box', sx: 0.3, sy: 0.08, sz: 0.04, y: 0.2, z: -0.18, c: 0xe63946 }, { k: 'box', sx: 0.08, sy: 0.3, sz: 0.04, y: 0.2, z: -0.18, c: 0xe63946 }, { k: 'box', sx: 0.16, sy: 0.07, sz: 0.1, y: 0.4, c: 0x9aa4b2 }]);
    else if (kind === 'barrier') geo = merge([{ k: 'box', sx: 0.34, sy: 0.7, sz: 0.04, y: 0.35, c: 0xf8f3e3 }, { k: 'box', sx: 0.3, sy: 0.05, sz: 0.05, y: 0.62, c: 0xe63946 }, { k: 'box', sx: 0.05, sy: 0.4, sz: 0.05, y: 0.36, c: 0xe63946 }, { k: 'box', sx: 0.4, sy: 0.06, sz: 0.06, y: 0.72, c: 0x5de0e6 }, { k: 'box', sx: 0.4, sy: 0.06, sz: 0.06, y: 0.0, c: 0x5de0e6 }]);
    else if (kind === 'ammo') geo = merge([{ k: 'box', sx: 0.5, sy: 0.3, sz: 0.34, y: 0.15, c: 0x5a6b45 }, { k: 'box', sx: 0.52, sy: 0.07, sz: 0.36, y: 0.3, c: 0x3f4d30 }, { k: 'box', sx: 0.2, sy: 0.12, sz: 0.02, y: 0.17, z: -0.18, c: 0xf2c14e }]);
    else if (kind === 'vest') geo = merge([{ k: 'box', sx: 0.56, sy: 0.55, sz: 0.2, y: 0.3, c: 0x3a86ff }, { k: 'box', sx: 0.16, sy: 0.2, sz: 0.22, x: -0.18, y: 0.65, c: 0x3a86ff }, { k: 'box', sx: 0.16, sy: 0.2, sz: 0.22, x: 0.18, y: 0.65, c: 0x3a86ff }, { k: 'box', sx: 0.4, sy: 0.12, sz: 0.22, y: 0.35, c: 0xf2c14e }]);
    else geo = merge([{ k: 'box', sx: 0.4, sy: 0.4, sz: 0.4, y: 0.2, c: 0xffffff }]);
    cache[key] = geo; return geo;
  };
  M.charMat = () => charMat;
  return M;
})();
