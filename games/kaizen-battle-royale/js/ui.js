'use strict';
/* HUD, minimap, lobby, and all input (keyboard, mouse + pointer lock, multi-touch). */
KBR.profile = { kp: 500, wins: 0, matches: 0, kills: 0, best: 0, char: 0, dmgLvl: 1, hpLvl: 1, quality: 'auto', diff: 'normal', sens: 1, assist: 1, training: 0, sound: 1 };
(function loadProfile() {
  try { const raw = localStorage.getItem('kbr_profile_v1'); if (raw) Object.assign(KBR.profile, JSON.parse(raw)); } catch (e) { /* storage unavailable */ }
})();
KBR.saveProfile = function () { try { localStorage.setItem('kbr_profile_v1', JSON.stringify(KBR.profile)); } catch (e) { /* ignore */ } };

KBR.UI = (function () {
  const U = {};
  const $ = (id) => document.getElementById(id);
  const W = KBR.World, P = () => KBR.Player;
  const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  U.isTouch = IS_TOUCH;
  let mapImg = null, mm, mmc, bm, bmc, popupT = 0, toastT = 0, hitT = 0, flashT = 0, lastSig = '', cache = {}, fpsT = 0;
  const kb = { w: 0, a: 0, s: 0, d: 0 }, joy = { f: 0, r: 0 };

  // ---------------------------------------------------------------- small helpers
  const setText = (id, v) => { const e = $(id); if (cache[id] !== v) { cache[id] = v; e.textContent = v; } };
  const setW = (el, pct) => { const v = pct.toFixed(1); if (cache[el.id + 'w'] !== v) { cache[el.id + 'w'] = v; el.firstElementChild.style.width = v + '%'; } };
  const icon = (n) => '<svg class="i"><use href="#i-' + n + '"/></svg>';
  U.show = (id, on) => $(id).classList.toggle('hidden', !on);

  // ---------------------------------------------------------------- feedback API (used by player/game)
  U.hitMarker = function (head, kill) {
    const h = $('hit'); h.className = kill ? 'kill' : head ? 'head' : ''; h.style.opacity = '1'; clearTimeout(hitT); hitT = setTimeout(() => { h.style.opacity = '0'; }, 120);
  };
  U.damageIndicator = function (ang) {
    const d = document.createElement('div'); d.className = 'dir'; d.style.transform = 'rotate(' + (-ang * 180 / Math.PI) + 'deg)'; d.style.opacity = '1'; $('dmg-ring').appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '0'; }); setTimeout(() => d.remove(), 1000);
  };
  U.popup = function (t, s, kind) {
    const p = $('popup'); $('pop-t').textContent = t; $('pop-s').textContent = s || ''; p.className = 'on ' + (kind || 'gold'); clearTimeout(popupT); popupT = setTimeout(() => { p.className = ''; }, 2100);
  };
  U.toast = function (t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 1600); };
  U.flash = function (kind) {
    const v = $('vignette'); v.className = kind || ''; v.style.opacity = '1'; clearTimeout(flashT); flashT = setTimeout(() => { v.style.opacity = '0'; }, kind === 'zone' ? 120 : 220);
  };
  U.setScope = (on) => { $('scope').classList.toggle('hidden', !on); $('xh').style.display = on ? 'none' : ''; };
  U.setHeal = function (p) { const b = $('heal-bar'); if (p === null) { b.classList.add('hidden'); return; } b.classList.remove('hidden'); b.firstElementChild.style.width = (p * 100) + '%'; };
  U.setPrompt = function (info) {
    const e = $('prompt'), tp = $('t-pick');
    if (!info) { e.classList.add('hidden'); tp.classList.add('hidden'); cache.prompt = null; return; }
    const sig = info.title + info.sub; if (cache.prompt !== sig) { cache.prompt = sig; $('pn').textContent = info.title; $('ps').textContent = info.sub; $('pk').textContent = IS_TOUCH ? 'TAP' : 'F'; }
    e.classList.remove('hidden'); if (IS_TOUCH) tp.classList.remove('hidden');
  };
  U.setSkydive = () => { /* banner handled per-frame */ };
  U.pulseCrosshair = function () { const x = $('xh'); x.classList.add('pulse'); setTimeout(() => x.classList.remove('pulse'), 70); };
  U.killFeed = function (text, cls) {
    const f = $('feed'), d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; f.prepend(d);
    while (f.children.length > 5) f.lastElementChild.remove(); setTimeout(() => d.remove(), 5200);
  };
  U.setBanner = function (text, kind) {
    const b = $('banner'); if (!text) { b.classList.add('hidden'); cache.banner = ''; return; }
    if (cache.banner !== text + kind) { cache.banner = text + kind; b.textContent = text; b.className = kind; }
  };

  // ---------------------------------------------------------------- island map (pre-rendered once)
  function renderIslandMap(size) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), img = g.createImageData(size, size);
    const S = W.SIZE, k = S / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const wx = (x + 0.5) * k - S / 2, wz = (y + 0.5) * k - S / 2, h = W.heightAt(wx, wz), i = (y * size + x) * 4;
      let r, gg, b;
      if (h < -4) { r = 18; gg = 76; b = 118; } else if (h < -0.3) { const t = clamp((h + 4) / 3.7, 0, 1); r = lerp(26, 70, t); gg = lerp(110, 170, t); b = lerp(160, 205, t); }
      else if (h < 0.5) { r = 232; gg = 218; b = 168; }
      else { const t = clamp(h / 24, 0, 1); r = lerp(106, 120, t); gg = lerp(190, 150, t); b = lerp(100, 88, t); if (h > 20) { r = 150; gg = 150; b = 142; } }
      const sh = clamp(1 + (W.heightAt(wx - 5, wz - 5) - W.heightAt(wx + 5, wz + 5)) * 0.05, 0.75, 1.25);
      img.data[i] = clamp(r * sh, 0, 255); img.data[i + 1] = clamp(gg * sh, 0, 255); img.data[i + 2] = clamp(b * sh, 0, 255); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(240,235,220,0.9)'; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pts of W.roads) { g.beginPath(); pts.forEach((p, i) => { const px = (p[0] + S / 2) / k, py = (p[1] + S / 2) / k; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
    return c;
  }
  U.buildMaps = function () { mapImg = renderIslandMap(640); };

  const pings = []; // enemy gunshots shown briefly on the minimap
  U.ping = function (x, z) { pings.push({ x, z, t: 2 }); if (pings.length > 24) pings.shift(); };

  function drawZone(g, Z, sc) {
    g.save(); g.lineWidth = 2.5 / sc;
    g.fillStyle = 'rgba(70,60,255,0.22)'; g.beginPath(); g.rect(-W.HALF * 2, -W.HALF * 2, W.SIZE * 4, W.SIZE * 4); g.arc(Z.cur.x, Z.cur.z, Z.cur.r, 0, TAU, true); g.fill('evenodd');
    g.strokeStyle = '#5de0e6'; g.beginPath(); g.arc(Z.cur.x, Z.cur.z, Z.cur.r, 0, TAU); g.stroke();
    g.strokeStyle = '#fff'; g.setLineDash([8 / sc, 6 / sc]); g.beginPath(); g.arc(Z.target.x, Z.target.z, Z.target.r, 0, TAU); g.stroke();
    g.restore();
  }
  function drawMini() {
    const pl = P(), Z = KBR.Game.zone, g = mmc, size = mm.width, c = size / 2, sc = c / 150; // 150 m radius
    g.clearRect(0, 0, size, size); g.save(); g.beginPath(); g.arc(c, c, c - 2, 0, TAU); g.clip();
    g.fillStyle = '#0e2740'; g.fillRect(0, 0, size, size);
    g.translate(c, c); g.rotate(pl.yaw); g.scale(sc, sc); g.translate(-pl.x, -pl.z);
    g.imageSmoothingEnabled = true; g.drawImage(mapImg, -W.HALF, -W.HALF, W.SIZE, W.SIZE);
    drawZone(g, Z, sc);
    g.font = '700 ' + (11 / sc) + 'px "Mona Sans",sans-serif'; g.textAlign = 'center';
    for (const p of KBR.POIS) { g.save(); g.translate(p.x, p.z); g.rotate(-pl.yaw); g.fillStyle = 'rgba(11,16,32,.8)'; g.fillText(p.name, 0.5 / sc, 0.5 / sc); g.fillStyle = p.major ? '#fff' : '#d8dcee'; g.fillText(p.name, 0, 0); g.restore(); }
    for (const d of KBR.Loot.drops) if (d.state !== 'OPENED') { g.fillStyle = '#ffc857'; g.fillRect(d.x - 4 / sc, d.z - 4 / sc, 8 / sc, 8 / sc); }
    for (const b of KBR.Bots.list) { if (!b.alive || b.state === 'WAIT') continue; const d = Math.hypot(b.x - pl.x, b.z - pl.z); if (d < 46) { g.fillStyle = '#ff4d6a'; g.beginPath(); g.arc(b.x, b.z, 4 / sc, 0, TAU); g.fill(); } }
    for (const p of pings) { const a = clamp(p.t / 2, 0, 1); g.strokeStyle = 'rgba(255,77,106,' + a + ')'; g.lineWidth = 2 / sc; g.beginPath(); g.arc(p.x, p.z, (2.5 - p.t) * 8 / sc + 3 / sc, 0, TAU); g.stroke(); }
    g.restore();
    g.save(); g.translate(c, c); g.fillStyle = '#6ff0a0'; g.strokeStyle = '#04200f'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.fillStyle = '#fff'; g.font = '800 14px "Mona Sans",sans-serif'; g.textAlign = 'center'; g.fillText('N', c + Math.sin(pl.yaw) * (c - 12) * 1, c - Math.cos(pl.yaw) * (c - 12) * 1 + 5);
  }
  function drawBig() {
    const g = bmc, size = bm.width, pl = P(), Z = KBR.Game.zone, sc = size / W.SIZE;
    g.clearRect(0, 0, size, size); g.save(); g.scale(sc, sc); g.translate(W.HALF, W.HALF); g.drawImage(mapImg, -W.HALF, -W.HALF, W.SIZE, W.SIZE);
    drawZone(g, Z, sc); g.font = '800 ' + (13 / sc) + 'px "Mona Sans","Noto Sans JP",sans-serif'; g.textAlign = 'center';
    for (const p of KBR.POIS) { g.fillStyle = 'rgba(11,16,32,.85)'; g.fillText(p.name, p.x + 1 / sc, p.z + 1 / sc); g.fillStyle = p.major ? '#fff' : '#d8dcee'; g.fillText(p.name, p.x, p.z); g.font = '600 ' + (10 / sc) + 'px "Noto Sans JP",sans-serif'; g.fillStyle = '#ffd3e1'; g.fillText(p.jp, p.x, p.z + 14 / sc); g.font = '800 ' + (13 / sc) + 'px "Mona Sans","Noto Sans JP",sans-serif'; }
    for (const d of KBR.Loot.drops) if (d.state !== 'OPENED') { g.fillStyle = '#ffc857'; g.fillRect(d.x - 6 / sc, d.z - 6 / sc, 12 / sc, 12 / sc); }
    g.translate(pl.x, pl.z); g.rotate(-pl.yaw); g.fillStyle = '#6ff0a0'; g.strokeStyle = '#04200f'; g.lineWidth = 2 / sc; g.beginPath(); g.moveTo(0, -12 / sc); g.lineTo(8 / sc, 9 / sc); g.lineTo(0, 5 / sc); g.lineTo(-8 / sc, 9 / sc); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  U.toggleMap = function (on) {
    const open = on === undefined ? $('bigmap').classList.contains('hidden') : on;
    $('bigmap').classList.toggle('hidden', !open); if (open) { drawBig(); if (document.pointerLockElement) document.exitPointerLock(); }
    KBR.Game.mapOpen = open;
  };

  // ---------------------------------------------------------------- per-frame HUD
  function slotsSig(pl) { return pl.slots.map((s) => s ? s.id + s.rarity : '-').join() + pl.active; }
  function buildSlots(pl) {
    const box = $('slots'); box.innerHTML = '';
    pl.slots.forEach((s, i) => {
      const d = document.createElement('div'); d.className = 'slot p' + (i === pl.active ? ' on' : '') + (s ? '' : ' empty');
      if (s) { const w = KBR.WEAPONS[s.id], rc = '#' + KBR.RARITY[s.rarity].color.toString(16).padStart(6, '0'); d.style.setProperty('--c', rc); d.innerHTML = w.cls + '<small>' + (i + 1) + ' &middot; ' + KBR.RARITY[s.rarity].name + '</small>'; d.onclick = () => pl.select(i); } else d.innerHTML = 'EMPTY<small>' + (i + 1) + '</small>';
      box.appendChild(d);
    });
  }
  U.frame = function (dt, now) {
    const pl = P(), G = KBR.Game, Z = G.zone;
    // vitals
    setText('hp-t', Math.ceil(pl.hp) + ' HP'); setW($('hpb'), pl.hp / pl.maxHp * 100); setW($('arb'), pl.armorMax ? pl.armor / pl.armorMax * 100 : 0); setW($('epb'), pl.ep / KBR.PLAYER.maxEp * 100);
    $('lowhp').style.opacity = pl.hp < pl.maxHp * 0.3 && pl.alive ? (0.55 + 0.35 * Math.sin(now * 7)).toFixed(2) : '0';
    setText('alive', String(G.aliveCount())); setText('kills', String(pl.kills));
    setText('n-barrier', KBR.profile.training ? '∞' : String(pl.barriers)); setText('n-heal', KBR.profile.training ? '∞' : String(pl.medkits));
    const sk = $('it-skill'); sk.classList.toggle('cd', pl.skillCd > 0); sk.dataset.cd = pl.skillCd > 0 ? String(Math.ceil(pl.skillCd)) : '';
    setText('sk-n', pl.char.skill.toUpperCase());
    // weapon
    const sig = slotsSig(pl); if (sig !== lastSig) { lastSig = sig; buildSlots(pl); }
    const ws = pl.cur(), w = pl.def(); setText('wn', w.name.toUpperCase()); setText('mag', pl.reloading > 0 ? '--' : String(ws.mag)); setText('res', KBR.profile.training ? '∞' : String(pl.ammo[ws.id]));
    const rb = $('reload-bar'); if (pl.reloading > 0) { rb.classList.remove('hidden'); rb.firstElementChild.style.width = (pl.reloading * 100) + '%'; } else rb.classList.add('hidden');
    // crosshair spread in pixels
    if (pl.phase === 'GROUND') {
      const fovT = Math.tan(THREE.MathUtils.degToRad(G.camera.fov) / 2), gap = 6 + Math.tan(pl.currentSpread()) / fovT * (window.innerHeight / 2), xh = $('xh').children;
      const g2 = gap.toFixed(1); if (cache.gap !== g2) { cache.gap = g2; xh[0].style.top = -(+g2 + 9) + 'px'; xh[1].style.top = (+g2) + 'px'; xh[2].style.left = -(+g2 + 9) + 'px'; xh[3].style.left = (+g2) + 'px'; }
      const target = G.aimedEnemy; for (let i = 0; i < 4; i++) xh[i].style.background = target ? '#ff4d6a' : '#fff';
    }
    // compass + place
    const deg = Math.round(((-pl.yaw * 180 / Math.PI) % 360 + 360) % 360), dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    setText('hdg', dirs[Math.round(deg / 45) % 8] + ' ' + String(deg).padStart(3, '0'));
    const poi = W.poiAt(pl.x, pl.z); setText('poi', poi ? poi.name : W.nearestPoi(pl.x, pl.z).name.toLowerCase().replace(/^./, (c) => c.toUpperCase()) + ' (near)');
    // zone
    const shrinking = Z.state === 'SHRINK';
    setText('zone-t', fmtTime(Z.timer)); setText('zone-ph', (Math.min(Z.phase + 1, KBR.ZONE.phases.length)) + '/' + KBR.ZONE.phases.length);
    const zs = $('zone-state'); const zl = shrinking ? 'CLOSING' : 'ZONE'; if (cache.zl !== zl) { cache.zl = zl; zs.firstElementChild.textContent = zl; zs.firstElementChild.style.color = shrinking ? '#ff7a90' : '#5de0e6'; }
    // banners
    const inside = Math.hypot(pl.x - Z.cur.x, pl.z - Z.cur.z) <= Z.cur.r;
    if (pl.phase === 'PLANE') U.setBanner(IS_TOUCH ? 'Tap JUMP to leave the plane' : 'Press SPACE to jump from the plane', 'info');
    else if (pl.phase === 'FREEFALL') U.setBanner(IS_TOUCH ? 'Free-falling: push forward to dive' : 'Free-falling: W dives, S slows. Chute opens low (Space = now)', 'info');
    else if (pl.phase === 'CHUTE') U.setBanner('Parachute open: steer to the loot pillars', 'info');
    else if (!inside && pl.alive) U.setBanner('OUTSIDE THE STORM! Run to the white circle', 'warn');
    else U.setBanner(null);
    if (pl.alive) { $('jump-l').textContent = pl.phase === 'PLANE' ? 'JUMP' : pl.phase === 'FREEFALL' || pl.phase === 'CHUTE' ? 'OPEN' : 'JUMP'; }
    // minimap (every other frame is plenty)
    fpsT += dt; if (fpsT > 0.04) { fpsT = 0; for (let i = pings.length - 1; i >= 0; i--) { pings[i].t -= 0.04; if (pings[i].t <= 0) pings.splice(i, 1); } drawMini(); }
    if (G.mapOpen) drawBig();
  };

  // ---------------------------------------------------------------- input
  function applyMove() { const p = P(); p.input.f = clamp(kb.w - kb.s + joy.f, -1, 1); p.input.r = clamp(kb.d - kb.a + joy.r, -1, 1); }
  U.applyInput = applyMove;
  function lockPointer() { const c = $('game'); if (!IS_TOUCH && c.requestPointerLock && !document.pointerLockElement) { try { c.requestPointerLock(); } catch (e) { /* ignore */ } } }
  U.lockPointer = lockPointer;
  const act = {
    reload: () => P().reload(), pick: () => KBR.Game.interact(), barrier: () => P().placeBarrier(), heal: () => P().useMedkit(), skill: () => P().useSkill(),
    jump: () => { const p = P(); if (p.phase === 'PLANE' || p.phase === 'FREEFALL' || p.phase === 'CHUTE') p.eject(); else p.input.jump = true; },
  };
  function bindKeyboard() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const G = KBR.Game, p = P(), c = e.code;
      if (c === 'KeyM' && G.state === 'PLAY') { U.toggleMap(); return; }
      if (c === 'Escape' && G.state === 'PLAY' && !G.mapOpen) { G.pause(true); return; }
      if (G.state !== 'PLAY' || G.paused) return;
      if (c === 'KeyW' || c === 'ArrowUp') kb.w = 1; else if (c === 'KeyS' || c === 'ArrowDown') kb.s = 1; else if (c === 'KeyA' || c === 'ArrowLeft') kb.a = 1; else if (c === 'KeyD' || c === 'ArrowRight') kb.d = 1;
      else if (c === 'ShiftLeft' || c === 'ShiftRight') p.input.sprint = true;
      else if (c === 'Space') { act.jump(); e.preventDefault(); }
      else if (c === 'KeyR') act.reload(); else if (c === 'KeyF' || c === 'KeyE') act.pick(); else if (c === 'KeyQ') act.barrier(); else if (c === 'Digit4' || c === 'KeyH') act.heal(); else if (c === 'KeyV') act.skill();
      else if (c === 'Digit1') p.select(0); else if (c === 'Digit2') p.select(1); else if (c === 'Digit3') p.select(2);
      else if (c === 'Tab') { e.preventDefault(); U.toggleMap(); }
    });
    addEventListener('keyup', (e) => {
      const c = e.code, p = P();
      if (c === 'KeyW' || c === 'ArrowUp') kb.w = 0; else if (c === 'KeyS' || c === 'ArrowDown') kb.s = 0; else if (c === 'KeyA' || c === 'ArrowLeft') kb.a = 0; else if (c === 'KeyD' || c === 'ArrowRight') kb.d = 0;
      else if (c === 'ShiftLeft' || c === 'ShiftRight') p.input.sprint = false;
    });
    addEventListener('blur', () => { kb.w = kb.a = kb.s = kb.d = 0; const p = P(); p.input.fire = false; p.input.sprint = false; });
  }
  function bindMouse() {
    const canvas = $('game');
    canvas.addEventListener('mousedown', (e) => {
      const G = KBR.Game; if (G.state !== 'PLAY' || G.paused) return;
      KBR.Audio.init(); if (!document.pointerLockElement) { lockPointer(); return; }
      const p = P(); if (e.button === 0) { if (p.phase === 'PLANE') p.eject(); else p.input.fire = true; } else if (e.button === 2) p.input.ads = true;
    });
    addEventListener('mouseup', (e) => { const p = P(); if (e.button === 0) p.input.fire = false; else if (e.button === 2) p.input.ads = false; });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas && KBR.Game.state === 'PLAY' && !KBR.Game.paused) P().look(e.movementX, e.movementY); });
    addEventListener('wheel', (e) => { if (KBR.Game.state === 'PLAY' && !KBR.Game.paused) P().cycle(); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { const G = KBR.Game; if (!document.pointerLockElement && G.state === 'PLAY' && !G.paused && !G.mapOpen && !IS_TOUCH && !G.ending) G.pause(true); });
  }
  function bindTouch() {
    document.body.classList.add('touch');
    const joyEl = $('joy'), base = $('joy-base'), knob = $('joy-knob'), look = $('lookpad');
    let joyId = null, jx = 0, jy = 0, lookId = null, lx = 0, ly = 0;
    const R = 52;
    joyEl.addEventListener('pointerdown', (e) => { if (joyId !== null) return; KBR.Audio.init(); joyId = e.pointerId; joyEl.setPointerCapture(joyId); const r = joyEl.getBoundingClientRect(); jx = e.clientX; jy = e.clientY; base.style.left = (jx - r.left) + 'px'; base.style.top = (jy - r.top) + 'px'; base.style.display = 'block'; knob.style.transform = ''; });
    joyEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return; const dx = e.clientX - jx, dy = e.clientY - jy, d = Math.hypot(dx, dy), k = Math.min(1, d / R); const nx = d ? dx / d * k : 0, ny = d ? dy / d * k : 0;
      knob.style.transform = 'translate(' + nx * R + 'px,' + ny * R + 'px)'; const dead = 0.12; joy.r = Math.abs(nx) < dead ? 0 : nx; joy.f = Math.abs(ny) < dead ? 0 : -ny; P().input.sprint = k > 0.93 && joy.f > 0.5;
    });
    const endJoy = (e) => { if (e.pointerId !== joyId) return; joyId = null; base.style.display = 'none'; joy.f = joy.r = 0; P().input.sprint = false; };
    joyEl.addEventListener('pointerup', endJoy); joyEl.addEventListener('pointercancel', endJoy);
    look.addEventListener('pointerdown', (e) => { if (lookId !== null) return; KBR.Audio.init(); lookId = e.pointerId; look.setPointerCapture(lookId); lx = e.clientX; ly = e.clientY; });
    look.addEventListener('pointermove', (e) => { if (e.pointerId !== lookId || KBR.Game.state !== 'PLAY') return; P().look(e.clientX - lx, e.clientY - ly, 1.55); lx = e.clientX; ly = e.clientY; });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    look.addEventListener('pointerup', endLook); look.addEventListener('pointercancel', endLook);
    const hold = (id, down, up, drag) => {
      const el = $(id); let pid = null, px = 0, py = 0;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); KBR.Audio.init(); pid = e.pointerId; el.setPointerCapture(pid); el.classList.add('down'); px = e.clientX; py = e.clientY; down && down(); });
      if (drag) el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) { P().look(e.clientX - px, e.clientY - py, 1.55); px = e.clientX; py = e.clientY; } });
      const end = (e) => { if (pid !== null && e.pointerId === pid) { pid = null; el.classList.remove('down'); up && up(); } };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    };
    hold('t-fire', () => { const p = P(); if (p.phase === 'PLANE') p.eject(); else p.input.fire = true; }, () => { P().input.fire = false; }, true);
    hold('t-ads', () => { const p = P(); p.input.ads = !p.input.ads; $('t-ads').classList.toggle('on', p.input.ads); });
    hold('t-jump', act.jump); hold('t-reload', act.reload); hold('t-swap', () => P().cycle()); hold('t-barrier', act.barrier); hold('t-heal', act.heal); hold('t-skill', act.skill); hold('t-pick', act.pick);
    $('t-ads').addEventListener('pointerdown', () => {}, { passive: true });
  }

  // ---------------------------------------------------------------- lobby
  function renderChars() {
    const box = $('chars'); box.innerHTML = '';
    KBR.CHARACTERS.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'ch' + (i === KBR.profile.char ? ' sel' : '');
      d.innerHTML = '<div class="kj" style="background:#' + c.color.toString(16).padStart(6, '0') + '">' + c.kanji + '</div><div><b>' + c.name + ' <small style="color:var(--gold)">' + c.skill + '</small></b><small>' + c.desc + '</small></div>';
      d.onclick = () => { KBR.profile.char = i; KBR.saveProfile(); KBR.Audio.click(); renderChars(); }; box.appendChild(d);
    });
  }
  function seg(id, key, parse) {
    const box = $(id); const mark = () => [...box.children].forEach((b) => b.classList.toggle('on', String(KBR.profile[key]) === b.dataset.v));
    [...box.children].forEach((b) => b.onclick = () => { KBR.profile[key] = parse ? parse(b.dataset.v) : b.dataset.v; KBR.saveProfile(); mark(); KBR.Audio.click(); if (key === 'quality') KBR.Game.applyQuality(); if (key === 'diff') KBR.Bots.setDifficulty(KBR.profile.diff); if (key === 'assist') P().input.touchAssist = !!KBR.profile.assist && IS_TOUCH; });
    mark();
  }
  U.refreshLobby = function () {
    const p = KBR.profile, rk = KBR.rankFor(p.wins);
    $('st-rank').textContent = rk.name; $('st-wins').textContent = p.wins; $('st-kp').textContent = p.kp;
    $('lv-dmg').textContent = p.dmgLvl; $('lv-hp').textContent = p.hpLvl;
    $('up-dmg').firstChild.textContent = (100 + p.dmgLvl * 50) + ' KP (Lv.'; $('up-hp').firstChild.textContent = (100 + p.hpLvl * 50) + ' KP (Lv.';
    renderChars();
  };
  function bindLobby() {
    seg('seg-q', 'quality'); seg('seg-d', 'diff'); seg('seg-a', 'assist', (v) => +v); seg('seg-t', 'training', (v) => +v);
    document.querySelectorAll('.touchonly').forEach((e) => { e.style.display = IS_TOUCH ? '' : 'none'; });
    document.querySelectorAll('.kbonly').forEach((e) => { if (IS_TOUCH) e.style.display = 'none'; });
    const s = $('sens'); s.value = KBR.profile.sens; s.oninput = () => { KBR.profile.sens = +s.value; P().sens = KBR.profile.sens; KBR.saveProfile(); };
    $('up-dmg').onclick = () => { const c = 100 + KBR.profile.dmgLvl * 50; if (KBR.profile.kp >= c) { KBR.profile.kp -= c; KBR.profile.dmgLvl++; KBR.saveProfile(); KBR.Audio.pickup(); U.refreshLobby(); } };
    $('up-hp').onclick = () => { const c = 100 + KBR.profile.hpLvl * 50; if (KBR.profile.kp >= c) { KBR.profile.kp -= c; KBR.profile.hpLvl++; KBR.saveProfile(); KBR.Audio.pickup(); U.refreshLobby(); } };
    $('go').onclick = () => { KBR.Audio.init(); KBR.Game.startMatch(false); };
    $('go-hot').onclick = () => { KBR.Audio.init(); KBR.Game.startMatch(true); };
    $('b-pause').onclick = () => KBR.Game.pause(true); $('p-resume').onclick = () => KBR.Game.pause(false); $('p-quit').onclick = () => KBR.Game.quitToLobby();
    $('b-map').onclick = () => U.toggleMap(); $('bigmap').onclick = () => U.toggleMap(false);
    $('b-snd').onclick = () => { KBR.profile.sound = KBR.profile.sound ? 0 : 1; KBR.Audio.setEnabled(!!KBR.profile.sound); $('b-snd').style.opacity = KBR.profile.sound ? 1 : 0.4; KBR.saveProfile(); };
    $('it-barrier').onclick = act.barrier; $('it-heal').onclick = act.heal; $('it-skill').onclick = act.skill; $('b-rl').onclick = act.reload; $('prompt').onclick = act.pick;
    $('banner').onclick = () => { const p = P(); if (p.phase === 'PLANE' || p.phase === 'FREEFALL') p.eject(); };
    $('mm').onclick = () => U.toggleMap(true);
  }
  U.showResult = function (r) {
    $('result').classList.remove('hidden'); $('res-t').textContent = r.win ? 'SHOURI! 勝利  #1 / 30' : 'ELIMINATED  #' + r.rank + ' / 30';
    $('res-s').textContent = 'Eliminations ' + r.kills + '  |  Damage ' + Math.round(r.dmg) + '  |  Survived ' + fmtTime(r.time) + '  |  +' + r.kp + ' Kaizen Points';
    U.refreshLobby(); U.show('lobby', true); U.show('hud', false); $('touch').classList.remove('on');
  };

  U.init = function () {
    mm = $('mm'); mmc = mm.getContext('2d'); bm = $('bm'); bmc = bm.getContext('2d');
    bindKeyboard(); bindMouse(); bindLobby(); if (IS_TOUCH) bindTouch();
    P().input.touchAssist = !!KBR.profile.assist && IS_TOUCH; P().sens = KBR.profile.sens;
    $('b-snd').style.opacity = KBR.profile.sound ? 1 : 0.4; KBR.Audio.setEnabled(!!KBR.profile.sound);
    U.refreshLobby();
  };
  return U;
})();
