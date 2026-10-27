'use strict';
/*
 * Ground loot and airdrops. All pickups of one kind share one InstancedMesh (plus one for the rings and one for the
 * light pillars), so ~200 items cost about a dozen draw calls. Rarity sets the glow colour and a damage multiplier.
 */
KBR.Loot = (function () {
  const L = {};
  const W = KBR.World;
  const KINDS = ['w:pistol', 'w:rifle', 'w:smg', 'w:shotgun', 'w:sniper', 'medkit', 'barrier', 'ammo', 'vest'];
  const CAP = 260;
  let scene, meshes = {}, ring, beam, group;
  L.items = []; L.drops = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), YA = new THREE.Vector3(0, 1, 0), Zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const col = new THREE.Color();
  let used = {}, ringUsed = 0, free = [], t = 0;

  L.init = function (sceneRef) {
    scene = sceneRef; group = new THREE.Group(); scene.add(group);
    const toon = KBR.Models.charMat();
    for (const k of KINDS) {
      const im = new THREE.InstancedMesh(KBR.Models.lootGeo(k), toon, CAP); im.count = 0; im.castShadow = false; im.frustumCulled = false; group.add(im); meshes[k] = im; used[k] = 0;
    }
    ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.62, 0.92, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }), CAP * 2);
    beam = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 8, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), CAP * 2);
    for (const m of [ring, beam]) { m.count = 0; m.frustumCulled = false; group.add(m); }
  };

  function weightedPick(r, table) { let t = 0; for (const e of table) t += e[1]; let x = r.next() * t; for (const e of table) { x -= e[1]; if (x <= 0) return e[0]; } return table[0][0]; }
  const KIND_TABLE = [['w:rifle', 13], ['w:smg', 12], ['w:shotgun', 9], ['w:sniper', 4], ['w:pistol', 6], ['medkit', 14], ['barrier', 13], ['ammo', 20], ['vest', 9]];
  const RARITY = { major: [0.5, 0.3, 0.15, 0.05], minor: [0.62, 0.26, 0.1, 0.02], wild: [0.74, 0.19, 0.06, 0.01] };
  function rollRarity(r, tier) { let x = r.next(), t = RARITY[tier]; for (let i = 0; i < 4; i++) { x -= t[i]; if (x <= 0) return i; } return 0; }

  /** Adds one pickup. `data` may carry {amount, wid} for ammo, {level} for vests. Returns the item. */
  L.add = function (kind, x, z, rarity, data, y0) {
    const k = kind;
    const idx = used[k]++; meshes[k].count = Math.max(meshes[k].count, idx + 1);
    if (idx >= CAP) { used[k]--; return null; }
    const ri = ringUsed++; ring.count = Math.max(ring.count, ri + 1); beam.count = ring.count;
    const it = { kind: k, x, z, y: y0 !== undefined ? y0 : W.heightAt(x, z), rarity, data: data || {}, taken: false, idx, ri, spin: Math.random() * 6.28 };
    if (k === 'ammo' && !it.data.wid) it.data.wid = ['rifle', 'smg', 'pistol', 'shotgun', 'sniper'][rng.int(5)];
    if (k === 'vest') it.data.level = it.data.level || 1 + Math.min(2, rarity);
    const rc = KBR.RARITY[rarity].color; col.setHex(rc); ring.setColorAt(it.ri, col); beam.setColorAt(it.ri, col);
    if (ring.instanceColor) ring.instanceColor.needsUpdate = beam.instanceColor.needsUpdate = true;
    L.items.push(it); place(it, 0); return it;
  };
  function place(it, bob) {
    const hover = 0.55 + Math.sin(bob) * 0.08, h = it.y;
    M.compose(V.set(it.x, h + hover, it.z), Q.setFromAxisAngle(YA, it.spin), S.set(1, 1, 1)); meshes[it.kind].setMatrixAt(it.idx, M); meshes[it.kind].instanceMatrix.needsUpdate = true;
    M.compose(V.set(it.x, h + 0.08, it.z), Q.identity(), S.set(1, 1, 1)); ring.setMatrixAt(it.ri, M);
    M.compose(V.set(it.x, h, it.z), Q.identity(), S.set(1, 3 + it.rarity * 2.2, 1)); beam.setMatrixAt(it.ri, M);
    ring.instanceMatrix.needsUpdate = beam.instanceMatrix.needsUpdate = true;
  }
  L.take = function (it) {
    if (it.taken) return;
    it.taken = true; meshes[it.kind].setMatrixAt(it.idx, Zero); ring.setMatrixAt(it.ri, Zero); beam.setMatrixAt(it.ri, Zero);
    meshes[it.kind].instanceMatrix.needsUpdate = ring.instanceMatrix.needsUpdate = beam.instanceMatrix.needsUpdate = true;
    KBR.Fx.sparkle(it.x, it.y + 0.4, it.z, KBR.RARITY[it.rarity].color, 8, 0.8);
  };
  L.label = function (it) {
    const r = KBR.RARITY[it.rarity].name;
    if (it.kind.startsWith('w:')) return { title: KBR.WEAPONS[it.kind.slice(2)].name, sub: r + ' ' + KBR.WEAPONS[it.kind.slice(2)].cls, icon: 'gun' };
    if (it.kind === 'medkit') return { title: 'Field Medkit', sub: 'Heals 75 HP over 2.5s', icon: 'heal' };
    if (it.kind === 'barrier') return { title: 'Ofuda Barrier x2', sub: 'Paper-seal wall, ' + KBR.Combat.barrierSpec.hp + ' HP', icon: 'shield' };
    if (it.kind === 'vest') return { title: 'Vest Lv.' + it.data.level, sub: 'Soaks 55% of damage, ' + KBR.ARMOR[it.data.level] + ' pts', icon: 'vest' };
    return { title: KBR.WEAPONS[it.data.wid].cls + ' Ammo', sub: '+' + (it.data.amount || KBR.WEAPONS[it.data.wid].mag) + ' rounds', icon: 'ammo' };
  };

  /** Fills the island. Major locations are richer; the rest is scattered across land. */
  L.spawnAll = function (r) {
    const spots = [];
    const tryPoint = (cx, cz, rad) => {
      for (let i = 0; i < 25; i++) {
        const a = r.next() * TAU, d = Math.sqrt(r.next()) * rad, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = W.heightAt(x, z);
        if (h < 0.8 || !W.circleFree(x, z, 0.9, h, 0.6)) continue;
        return [x, z];
      }
      return null;
    };
    for (const p of KBR.POIS) {
      const n = p.major ? 16 : 7, tier = p.major ? 'major' : 'minor';
      for (let i = 0; i < n; i++) { const pt = tryPoint(p.x, p.z, p.pad * 0.95); if (pt) spots.push([pt[0], pt[1], tier]); }
    }
    for (let i = 0; i < 46; i++) { const pt = tryPoint(0, 0, 430); if (pt) spots.push([pt[0], pt[1], 'wild']); }
    for (const [x, z, tier] of spots) {
      const kind = weightedPick(r, KIND_TABLE); let rar = rollRarity(r, tier);
      if (kind === 'w:pistol') rar = Math.min(rar, 2); if (kind === 'w:sniper' && tier === 'wild') rar = Math.max(rar, 1);
      L.add(kind, x, z, rar);
    }
  };
  L.reset = function () {
    for (const k of KINDS) { meshes[k].count = 0; used[k] = 0; }
    ring.count = beam.count = 0; ringUsed = 0; L.items.length = 0;
    for (const d of L.drops) scene.remove(d.group); L.drops.length = 0;
  };

  L.nearest = function (x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const it of L.items) { if (it.taken) continue; const dx = it.x - x, dz = it.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = it; } }
    for (const d of L.drops) { if (d.state !== 'LANDED') continue; const dx = d.x - x, dz = d.z - z, dd = dx * dx + dz * dz; if (dd < bd && dd < maxD * maxD) { bd = dd; best = d; } }
    return best;
  };

  // ---------------------------------------------------------------- airdrops
  L.spawnDrop = function (x, z) {
    const g = KBR.Models.makeCrate(); g.position.set(x, 260, z); scene.add(g);
    const d = { isDrop: true, kind: 'drop', x, z, y: 260, group: g, state: 'FALL', smoke: 0, taken: false, rarity: 3 };
    L.drops.push(d); return d;
  };
  L.openDrop = function (d) { if (d.state !== 'LANDED') return; d.state = 'OPENED'; d.taken = true; d.group.userData.chute.visible = false; KBR.Fx.confetti(d.x, d.y + 1.5, d.z); };
  L.dropLabel = () => ({ title: 'Supply Crate', sub: 'Legendary gear', icon: 'crate' });
  L.update = function (dt, px, pz) {
    t += dt;
    for (const it of L.items) {
      if (it.taken) continue;
      const dx = it.x - px, dz = it.z - pz;
      if (dx * dx + dz * dz < 3600) { it.spin += dt * 1.6; place(it, t * 2 + it.idx); }
    }
    for (const d of L.drops) {
      if (d.state === 'FALL') {
        d.y -= 14 * dt; const gy = W.heightAt(d.x, d.z);
        if (d.y <= gy) { d.y = gy; d.state = 'LANDED'; KBR.Fx.ring(d.x, gy + 0.3, d.z, 0xff7a59); }
        d.group.position.y = d.y; d.group.rotation.y += dt * 0.3;
      }
      if (d.state !== 'FALL') { d.smoke -= dt; if (d.smoke <= 0 && d.state === 'LANDED') { d.smoke = 0.1; KBR.Fx.smoke(d.x, d.y + 1.5, d.z, 0xff6a4a); } }
    }
  };
  return L;
})();
