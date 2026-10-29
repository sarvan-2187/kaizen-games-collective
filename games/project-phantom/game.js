// PROJECT PHANTOM: game orchestration (renderer, input, player, combat, missions, progression).
import { CS, WEAPONS, WEAPON_ORDER, UPGRADES, PLAYER, TACTICAL, DIFFICULTY, RANKS, RANK_VALUE, levelFromXp } from './js/data.js';
import { loadSave, writeSave, defaultSave } from './js/save.js';
import { AudioEngine } from './js/audio.js';
import { FX } from './js/fx.js';
import { MISSIONS, buildGrid } from './js/missions.js';
import { World, THEMES } from './js/world.js';
import { EnemyManager, S, disposeEnemyGeometry } from './js/enemies.js';
import { WeaponSystem } from './js/weapons.js';
import { UI, fmtTime } from './js/ui.js';

const THREE = window.THREE;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GAME_KEYS = new Set(['Tab', 'Space', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function fatal(msg) {
  const e = $('err-msg'); if (e) e.textContent = msg;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 's-error'));
}

class Game {
  constructor() {
    this.save = loadSave().data;
    this.audio = new AudioEngine();
    this.audio.setVolume(this.save.settings.volume);
    this.state = 'menu';
    this.nolock = /[?&]nolock/.test(location.search);
    this.locked = false; this.lockWas = false;
    this.time = 0; this.last = 0; this.frame = 0;
    this.keys = Object.create(null);
    this.mouse = { l: false, r: false }; this.fireBuf = 0; this.mdx = 0; this.mdy = 0;
    this.eHeld = false; this.eEdge = false;
    this.tmpHit = { t: 0, nx: 0, ny: 0, nz: 0, kind: '' };
    this.tmpHit2 = { t: 0, head: false };
    this.tmpV = { x: 0, y: 0, z: 0 };
    this.world = null; this.m = null; this.missionIdx = 0;
    this.alarm = { active: false, t: 0 }; this.alarmActive = false; this.camerasDown = false;
    this.player = {
      x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, armor: 50, dead: false, deadT: 0,
      grounded: true, crouched: false, sprinting: false, ads: false, speed: 0, eye: PLAYER.eye, stepD: 0, bobT: 0,
      noisy: 0, noiseVal: 0, recDebt: 0, sinceShot: 1, lookX: 0, lookY: 0, shake: 0, abCd: 0, hurtT: 0, roll: 0,
    };
    this.mv = { speed: 0, grounded: true, crouched: false };
    this.interact = { target: null, progress: 0, noiseT: 0 };
    this.initRenderer();
    this.fx = new FX(this.scene);
    this.mgr = new EnemyManager(this);
    this.ws = new WeaponSystem(this.vmScene, this.audio);
    this.ui = new UI(this);
    this.bindInput();
    this.applySettings();
    this.ui.refreshMenu();
    window.__phantom = this;
    requestAnimationFrame((t) => this.loop(t));
  }

  get settings() { return this.save.settings; }
  get scene() { return this._scene; }

  // ------------------------------------------------------------ setup
  initRenderer() {
    const canvas = $('gl');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
    const r = this.renderer;
    r.autoClear = false; r.outputEncoding = THREE.sRGBEncoding; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this._scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.05, 260); this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene(); this.vmCam = new THREE.PerspectiveCamera(58, 1, 0.02, 6);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1); this._scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.5); this._scene.add(this.sun); this._scene.add(this.sun.target);
    this.lamp = new THREE.PointLight(0xaee8ff, 0.7, 16, 2); this._scene.add(this.lamp);
    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 12, 2); this._scene.add(this.muzzleLight);
    this.alarmLight = new THREE.PointLight(0xff2030, 0, 28, 2); this._scene.add(this.alarmLight);
    this.vmScene.add(new THREE.HemisphereLight(0xcfe8ff, 0x203040, 1.1));
    const vd = new THREE.DirectionalLight(0xffffff, 0.8); vd.position.set(0.5, 1, 0.8); this.vmScene.add(vd);
    const vl = new THREE.PointLight(0x66ccff, 0.6, 3); vl.position.set(0, 0, -0.3); this.vmScene.add(vl);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); this.ctxLost = true;
      if (this.state === 'playing') this.pause();
      const el = $('lock-overlay'); el.classList.remove('hidden'); el.querySelector('h2').textContent = 'GRAPHICS RESET';
      el.querySelector('p').textContent = 'The GPU context was lost. Restoring…';
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.ctxLost = false; if (this.world) this.world.refreshEnv();
      const el = $('lock-overlay'); el.classList.add('hidden'); el.querySelector('h2').textContent = 'CLICK TO ENGAGE';
      el.querySelector('p').innerHTML = 'Mouse control must be captured by the game.<br>Click anywhere to resume; press <b>ESC</b> to pause.';
    });
    window.addEventListener('resize', () => this.onResize());
  }

  applySettings() {
    const s = this.settings;
    this.audio.setVolume(s.volume);
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(s.quality === 'low' ? Math.min(0.75, dpr) : s.quality === 'medium' ? Math.min(1, dpr) : Math.min(1.75, dpr));
    this.onResize();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCam.aspect = w / h; this.vmCam.updateProjectionMatrix();
    this.W = w; this.H = h;
  }

  persist() { writeSave(this.save); }
  hasProgress() { const s = this.save; return s.credits > 0 || s.xp > 0 || s.maxMission > 0 || Object.keys(s.ranks).length > 0 || s.stats.shots > 0; }

  // ------------------------------------------------------------ campaign / menu actions
  newCampaign() {
    const keep = this.save.settings;
    this.save = defaultSave(); this.save.settings = keep; this.persist();
    this.ui.selMission = 0; this.ui.goto('s-briefing');
  }
  continueCampaign() { this.ui.selMission = Math.min(2, this.save.maxMission); this.ui.goto('s-briefing'); }
  eraseSave() { const keep = this.save.settings; this.save = defaultSave(); this.save.settings = keep; this.persist(); this.ui.refreshMenu(); }

  buyWeapon(id) {
    const w = WEAPONS[id], sv = this.save;
    if (sv.owned[id] || sv.credits < w.cost) { this.audio.play('locked'); return false; }
    sv.credits -= w.cost; sv.owned[id] = true;
    if (sv.equipped.length < 4) { sv.equipped.push(id); this.sortEquipped(); }
    this.audio.play('buy'); this.persist(); return true;
  }
  sortEquipped() { this.save.equipped.sort((a, b) => WEAPON_ORDER.indexOf(a) - WEAPON_ORDER.indexOf(b)); }
  toggleEquip(id) {
    const sv = this.save, i = sv.equipped.indexOf(id);
    if (i >= 0) { if (sv.equipped.length <= 1) return; sv.equipped.splice(i, 1); }
    else if (sv.equipped.length < 4) { sv.equipped.push(id); this.sortEquipped(); } else { this.audio.play('locked'); return; }
    this.audio.play('ui'); this.persist();
  }
  buyUpgrade(id, key) {
    const sv = this.save, u = UPGRADES[key]; const ups = sv.upgrades[id] || (sv.upgrades[id] = {});
    const lv = ups[key] || 0;
    if (lv >= u.max || sv.credits < u.cost[lv] || !sv.owned[id]) { this.audio.play('locked'); return false; }
    sv.credits -= u.cost[lv]; ups[key] = lv + 1; this.audio.play('buy'); this.persist(); return true;
  }

  // ------------------------------------------------------------ mission lifecycle
  deploy(idx) {
    this.audio.init();
    this.missionIdx = idx; this.state = 'loading';
    this.ui.stack = ['s-menu']; this.ui.show('s-loading');
    $('load-title').textContent = MISSIONS[idx].name.toUpperCase();
    setTimeout(() => {
      try { this.loadMission(idx); } catch (e) { console.error(e); fatal('Failed to build the level: ' + (e && e.message ? e.message : e)); }
    }, 60);
  }
  restartMission() { this.deploy(this.missionIdx); }

  unloadMission() {
    this.mgr.clear();
    if (this.world) { this.world.dispose(); this.world = null; }
    this.fx.reset(); this.fx.clearAmbient();
    this.audio.stopAll();
    this.alarm.active = false; this.alarmActive = false; this.camerasDown = false;
  }

  loadMission(idx) {
    this.unloadMission();
    const m = MISSIONS[idx], T = THEMES[m.theme], q = this.settings.quality;
    this.m = m;
    const grid = buildGrid(m);
    const world = new World(this._scene, m, grid, q, this.renderer);
    this.world = world;
    world.onDoor = (d, open) => {
      const dx = d.x - this.player.x, dz = d.z - this.player.z, dist = Math.hypot(dx, dz);
      this.audio.play('door', { vol: clamp(1 - dist / 30, 0.1, 1) });
    };
    // lighting & atmosphere
    this._scene.fog = new THREE.FogExp2(T.fog, T.fogD);
    this.hemi.color.setHex(T.hemiSky); this.hemi.groundColor.setHex(T.hemiGround); this.hemi.intensity = T.hemiI;
    this.sun.color.setHex(T.sun); this.sun.intensity = T.sunI;
    const shadows = q === 'high';
    this.renderer.shadowMap.enabled = shadows; this.sun.castShadow = shadows;
    if (shadows) {
      const sc = this.sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90; sc.updateProjectionMatrix();
      this.sun.shadow.mapSize.set(1536, 1536); this.sun.shadow.bias = -0.0006;
    }
    this.lamp.intensity = m.theme === 'neon' ? 0.9 : 0.8;
    this.fx.setAmbient(T.rain ? 'rain' : T.space ? 'space' : 'dust');
    // actors
    const rf = this.m.reinforce || [];
    for (const spec of m.enemies) this.mgr.spawn(spec);
    this.reinforced = false;
    // player
    const P = this.player;
    P.x = world.center(m.start.x); P.z = world.center(m.start.z); P.y = 0; P.vx = P.vz = P.vy = 0;
    P.yaw = m.start.yaw; P.pitch = 0; P.hp = PLAYER.hp; P.armor = PLAYER.armor; P.dead = false; P.deadT = 0;
    P.crouched = false; P.sprinting = false; P.ads = false; P.eye = PLAYER.eye; P.abCd = 0; P.noisy = 0; P.noiseVal = 0; P.recDebt = 0; P.shake = 0; P.roll = 0; P.hurtT = 0;
    this.gravity = m.gravity; this.jumpV = Math.sqrt(2 * m.gravity * (m.theme === 'orbital' ? 1.7 : 1.05));
    // mission state
    this.ms = { time: 0, kills: 0, headshots: 0, shots: 0, hits: 0, damageTaken: 0, incidents: 0, camTrips: 0, takedowns: 0, alarms: 0, destroyed: 0, lastIncident: -99, intel: 0, bypass: false };
    this.objs = {}; this.defenseCount = 0; this.countdown = 0; this.extractionToast = 0;
    for (const o of m.objectives) this.objs[o.id] = { id: o.id, text: o.text, optional: !!o.optional, total: o.count || 0, count: 0, done: false, failed: false };
    this.extractionActive = false;
    this.ws.setLoadout(this.save);
    this.time = 0;
    this.interact.progress = 0; this.interact.target = null;
    this.ui.prepareMinimap(world);
    this.refreshObjectives(); this.lastWeaponKey = ''; this.ui.cache = {};
    $('hud-mission').textContent = m.name.toUpperCase();
    $('alarm-banner').classList.add('hidden'); $('vignette').style.opacity = 0;
    this.audio.startAmbient(T.hum, m.theme === 'neon' ? 700 : 450);
    this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix();
    // go
    this.ui.hideAll(); this.ui.showHud();
    this.state = 'playing';
    this.requestLock();
    this.ui.toast(`${m.name.toUpperCase()}: ${m.objectives[0].text}`, '', 4);
    this.updateCamera(0);
  }

  requestLock() {
    if (this.nolock) { this.locked = true; this.syncLockOverlay(); return; }
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.syncLockOverlay(); });
    } catch (e) { /* needs gesture */ }
    this.syncLockOverlay();
  }

  syncLockOverlay() {
    const need = this.state === 'playing' && !this.locked && !this.nolock;
    $('lock-overlay').classList.toggle('hidden', !need);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.keys = Object.create(null); this.mouse.l = this.mouse.r = false; this.eHeld = false;
    $('tab-panel').classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.locked = false; this.lockWas = false;
    if (this.audio.ctx && this.audio.ctx.state === 'running') this.audio.ctx.suspend();
    this.ui.stack = ['s-pause']; this.ui.show('s-pause'); this.syncLockOverlay();
  }

  resume() {
    if (this.state !== 'paused') return;
    if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
    this.ui.hideAll(); this.state = 'playing'; this.requestLock();
  }

  abortMission() { this.finishSession(); this.toMenu(); }

  toMenu() {
    this.finishSession();
    this.unloadMission(); this.ui.hideHud();
    this.state = 'menu'; this.ui.goto('s-menu');
  }

  finishSession() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.locked = false; this.lockWas = false; this.audio.stopAlarm();
    if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
  }

  // ------------------------------------------------------------ objectives
  refreshObjectives() {
    const list = []; let done = 0, total = 0, firstOpen = true;
    for (const o of this.m.objectives) {
      const s = this.objs[o.id];
      let text = s.text;
      if (s.total) text += ` (${s.count}/${s.total})`;
      let cls = '';
      if (s.done) cls = 'done'; else if (s.failed) cls = 'fail';
      else if (!s.optional && firstOpen) { cls = 'cur'; firstOpen = false; }
      if (s.optional && !s.done && !s.failed) cls = 'opt';
      if (!s.optional) { total++; if (s.done) done++; }
      list.push({ text, cls });
    }
    this.ui.setObjectives(list, total ? done / total : 0);
  }

  completeObjective(id, silent) {
    const o = this.objs[id]; if (!o || o.done || o.failed) return;
    o.done = true; this.audio.play(o.optional ? 'pickup' : 'hackDone');
    if (!silent) this.ui.toast(`${o.optional ? 'BONUS' : 'OBJECTIVE'} COMPLETE: ${o.text}`, 'good', 3.2);
    this.refreshObjectives(); this.afterObjective(id);
  }

  failObjective(id) {
    const o = this.objs[id]; if (!o || o.done || o.failed) return;
    o.failed = true; this.ui.toast(`BONUS LOST: ${o.text}`, 'warn', 2.6); this.refreshObjectives();
  }

  afterObjective(id) {
    const w = this.world;
    if (id === 'hvt') { this.unlockAllDoors(); this.ui.toast('TARGET DEALT WITH. EXIT GATE UNLOCKED', 'good', 3.5); }
    if (id === 'download') {
      this.unlockAllDoors();
      if (this.m.id === 2) { this.countdown = 150; this.triggerAlarm(this.player.x, this.player.z, true); this.ui.toast('STATION LOCKDOWN INITIATED. EXTRACT NOW', 'bad', 4); }
    }
    const pending = this.m.objectives.some((o) => !o.optional && o.id !== 'extract' && !this.objs[o.id].done);
    if (!pending && !this.extractionActive) {
      this.extractionActive = true; w.setExtractionActive(true);
      this.audio.play('success', { vol: 0.5 });
      this.ui.toast('EXTRACTION POINT ACTIVE', 'good', 3.5);
    }
  }

  unlockAllDoors() { for (const d of this.world.doors) if (d.locked) this.world.setDoorLocked(d, false); }

  // ------------------------------------------------------------ events from enemies
  incident() {
    if (this.time - this.ms.lastIncident > 7) { this.ms.incidents++; }
    this.ms.lastIncident = this.time;
    this.failObjective('ghost');
  }

  onEnemyAlert(src) {
    if (src.def.id === 'camera') return;
    this.audio.play('detect', { vol: src.audioVol(), pan: src.pan() });
    this.incident();
    if (this.time - (this.lastSpotToast || -9) > 5) { this.lastSpotToast = this.time; this.ui.toast('YOU HAVE BEEN SPOTTED', 'bad', 2.2); }
  }

  onBodyFound(by, body) {
    if (this.time - (this.lastBodyToast || -9) > 5) { this.lastBodyToast = this.time; this.ui.toast('A GUARD FOUND A BODY', 'warn', 2.4); }
  }

  onCameraTrip(cam) {
    this.ms.camTrips++; this.failObjective('cams'); this.incident();
    this.ui.toast('SECURITY CAMERA SPOTTED YOU', 'bad', 2.6);
    this.triggerAlarm(this.player.x, this.player.z, false);
  }

  keepAlarm() { if (this.alarm.active) this.alarm.t = Math.max(this.alarm.t, 25); }

  triggerAlarm(x, z, scripted) {
    const a = this.alarm;
    if (!a.active) {
      a.active = true; this.alarmActive = true; this.audio.startAlarm();
      $('alarm-banner').classList.remove('hidden');
      if (!scripted) { this.ms.alarms++; this.failObjective('noalarm'); }
    }
    a.t = scripted ? 60 : 40;
    this.mgr.alarm(x, z);
  }

  onEnemyKilled(e, head, silent) {
    const ms = this.ms, sv = this.save;
    if (e.def.fixed || e.def.id === 'drone') { ms.destroyed++; this.ui.toast(`${e.def.name.toUpperCase()} DESTROYED`, '', 1.6); }
    else { ms.kills++; if (head) ms.headshots++; if (silent) ms.takedowns++; }
    if (e.hvt) {
      if (!this.objs.hvt.done) this.completeObjective('hvt', true), this.ui.toast('TARGET ELIMINATED', 'good', 3);
    }
    if (this.mgr.list.length && this.m.id === 0) { /* no scripted kills in mission 1 */ }
  }

  hurtPlayer(dmg, enemy) {
    const P = this.player; if (P.dead) return;
    if (P.armor > 0) { const ab = Math.min(P.armor, dmg * 0.6); P.armor -= ab; dmg -= ab; }
    P.hp -= dmg; this.ms.damageTaken += dmg; P.shake = Math.min(1, P.shake + 0.25); P.hurtT = 0.4;
    $('vignette').style.opacity = 0.9;
    if (enemy) {
      const dx = enemy.x - P.x, dz = enemy.z - P.z;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      this.ui.dmgDir(Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz));
    }
    this.audio.play('hurt');
    if (P.hp <= 0) { P.hp = 0; P.dead = true; P.deadT = 0; this.mouse.l = false; this.mouse.r = false; this.audio.play('fail'); this.audio.stopAlarm(); }
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const d = document;
    d.addEventListener('keydown', (e) => this.onKey(e, true));
    d.addEventListener('keyup', (e) => this.onKey(e, false));
    d.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || !(this.locked || this.nolock)) return;
      this.mdx += e.movementX || 0; this.mdy += e.movementY || 0;
    });
    d.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (!this.locked && !this.nolock) return;
      if (e.button === 0) { this.mouse.l = true; this.fireBuf = 0.18; } else if (e.button === 2) this.mouse.r = true;
      e.preventDefault();
    });
    d.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; else if (e.button === 2) this.mouse.r = false; });
    d.addEventListener('contextmenu', (e) => { if (this.state === 'playing') e.preventDefault(); });
    d.addEventListener('wheel', (e) => { if (this.state === 'playing' && !this.player.dead) this.ws.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    $('lock-overlay').addEventListener('click', () => { this.audio.init(); if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume(); this.requestLock(); });
    d.addEventListener('pointerlockchange', () => {
      this.locked = d.pointerLockElement === this.canvas;
      if (!this.locked && this.lockWas && this.state === 'playing') this.pause();
      this.lockWas = this.locked; this.syncLockOverlay();
    });
    d.addEventListener('pointerlockerror', () => { this.locked = false; this.syncLockOverlay(); });
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.mouse.l = this.mouse.r = false; this.eHeld = false; if (this.nolock && this.state === 'playing') this.pause(); });
    d.addEventListener('visibilitychange', () => { if (d.hidden && this.state === 'playing') this.pause(); });
  }

  onKey(e, down) {
    if (this.state === 'playing' && GAME_KEYS.has(e.code)) e.preventDefault();
    if (down && e.repeat) return;
    if (!down) {
      this.keys[e.code] = false;
      if (e.code === 'KeyE') this.eHeld = false;
      if (e.code === 'Tab') $('tab-panel').classList.add('hidden');
      return;
    }
    this.keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.state === 'playing') { this.pause(); return; }
      if (this.state === 'paused' && e.code === 'Escape') return;
    }
    if (this.state !== 'playing' || this.player.dead) return;
    switch (e.code) {
      case 'KeyR': this.tryReload(); break;
      case 'KeyQ': this.useAbility(); break;
      case 'KeyE': this.eHeld = true; this.eEdge = true; break;
      case 'Tab': $('tab-panel').classList.remove('hidden'); this.updateTabPanel(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.ws.switchTo(parseInt(e.code.slice(5), 10) - 1); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ main loop
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0); this.last = now; this.frame++;
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05 : 60;
    if (this.state === 'playing' && (this.locked || this.nolock) && !this.ctxLost) { try { this.step(dt); } catch (e) { console.error(e); } }
    if (this.world && this.state !== 'menu' && this.state !== 'loading' && !this.ctxLost) this.render();
  }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this._scene, this.camera);
    r.clearDepth();
    if (!this.player.dead) r.render(this.vmScene, this.vmCam);
  }

  step(dt) {
    const P = this.player;
    this.time += dt; this.ms.time += dt;
    if (!P.dead) this.updatePlayer(dt);
    else this.updateDead(dt);
    this.updateWeapons(dt);
    this.updateInteraction(dt);
    this.mgr.update(dt);
    this.fx.update(dt, P.x, P.y, P.z);
    const actors = this._actors || (this._actors = []);
    actors.length = 0; actors.push(P); for (const e of this.mgr.list) if (!e.dead) actors.push(e);
    this.world.update(dt, this.time, actors);
    this.updatePickups();
    this.updateMissionLogic(dt);
    this.updateCamera(dt);
    this.updateHud(dt);
  }

  // ------------------------------------------------------------ player
  updatePlayer(dt) {
    const P = this.player, s = this.settings, k = this.keys, w = this.world;
    // look
    const zoomK = this.camera.fov / s.fov;
    const ls = 0.0021 * s.sens * (P.ads ? s.adsSens * zoomK : 1);
    P.lookX = this.mdx; P.lookY = this.mdy;
    P.yaw -= this.mdx * ls; P.pitch = clamp(P.pitch - this.mdy * ls * (s.invertY ? -1 : 1), -1.5, 1.5);
    this.mdx = 0; this.mdy = 0;
    // stance
    const fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), str = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    P.crouched = !!(k.ControlLeft || k.ControlRight || k.KeyC);
    P.ads = this.mouse.r && !P.sprinting;
    const wantSprint = (k.ShiftLeft || k.ShiftRight) && fwd > 0 && !P.crouched && !this.mouse.l && !this.mouse.r;
    P.sprinting = !!wantSprint;
    let speed = P.crouched ? PLAYER.crouch : P.sprinting ? PLAYER.sprint : PLAYER.walk;
    if (P.ads) speed *= 0.62;
    if (fwd < 0) speed *= 0.8;
    const len = Math.hypot(fwd, str) || 1;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const tx = ((-sy * fwd + cy * str) / len) * speed * (fwd || str ? 1 : 0), tz = ((-cy * fwd - sy * str) / len) * speed * (fwd || str ? 1 : 0);
    const ac = Math.min(1, dt * (P.grounded ? 11 : 2.2));
    P.vx += (tx - P.vx) * ac; P.vz += (tz - P.vz) * ac;
    const ox = P.x, oz = P.z;
    w.moveCircle(P, P.vx * dt, P.vz * dt, PLAYER.radius, P.y);
    P.speed = Math.hypot(P.x - ox, P.z - oz) / Math.max(dt, 1e-4);
    // vertical
    if (P.grounded && k.Space && !P.crouched) { P.vy = this.jumpV; P.grounded = false; this.makeNoise(4, 0.4); }
    P.vy -= this.gravity * dt; P.y += P.vy * dt;
    const gy = w.groundAt(P.x, P.z, PLAYER.radius, P.y);
    if (P.vy <= 0 && P.y <= gy) {
      if (!P.grounded && P.vy < -5) { this.audio.play('land', { vol: clamp(-P.vy / 12, 0.3, 1) }); this.makeNoise(P.vy < -9 ? 9 : 5.5, 0.6); }
      P.y = gy; P.vy = 0; P.grounded = true;
    } else if (P.y > gy + 0.02) P.grounded = false;
    if (P.y + P.eye + 0.2 > w.ceilY && P.vy > 0) P.vy = 0;
    P.eye += ((P.crouched ? PLAYER.eyeCrouch : PLAYER.eye) - P.eye) * Math.min(1, dt * 12);
    // footsteps
    if (P.grounded && P.speed > 0.6) {
      P.stepD += P.speed * dt;
      const stride = P.sprinting ? 1.75 : P.crouched ? 2.6 : 2.1;
      if (P.stepD > stride) {
        P.stepD = 0;
        const rad = P.sprinting ? 13 : P.crouched ? 2.4 : 6.5;
        this.makeNoise(rad, 0.55);
        this.audio.play('step', { vol: P.sprinting ? 1 : P.crouched ? 0.3 : 0.65 });
      }
    }
    P.noisy = Math.max(0, P.noisy - dt);
    P.noiseVal = Math.max(0, P.noiseVal - dt * 1.6);
    P.sinceShot += dt;
    P.shake = Math.max(0, P.shake - dt * 2.5); P.hurtT = Math.max(0, P.hurtT - dt);
    // recoil recovery
    if (P.sinceShot > 0.13 && P.recDebt > 0) { const r = Math.min(P.recDebt, P.recDebt * dt * 5 + 0.003 * dt); P.pitch -= r; P.recDebt -= r; }
    // ability cooldown
    P.abCd = Math.max(0, P.abCd - dt);
    this.mv.speed = P.speed; this.mv.grounded = P.grounded; this.mv.crouched = P.crouched;
  }

  updateDead(dt) {
    const P = this.player; P.deadT += dt;
    P.eye += (0.35 - P.eye) * Math.min(1, dt * 4); P.roll += (0.9 - P.roll) * Math.min(1, dt * 3);
    P.pitch += (0.2 - P.pitch) * Math.min(1, dt * 2);
    if (P.deadT > 1.8 && this.state === 'playing') this.failMission(this.deathReason || 'Operative down.');
  }

  makeNoise(radius, gain) {
    const P = this.player;
    P.noiseVal = Math.max(P.noiseVal, Math.min(1, radius / 28));
    this.mgr.noise(P.x, P.z, radius, gain, true);
  }

  // ------------------------------------------------------------ weapons & combat
  tryReload() {
    if (this.ws.startReload()) this.interact.progress = this.interact.progress;
    else if (this.ws.w.reserve <= 0 && this.ws.w.mag < this.ws.w.st.mag) this.ui.toast('NO RESERVE AMMO', 'warn', 1.2);
  }

  updateWeapons(dt) {
    const P = this.player, ws = this.ws;
    this.fireBuf = Math.max(0, this.fireBuf - dt);
    if (!P.dead) {
      const st = ws.w.st;
      const wantFire = st.auto ? this.mouse.l : this.fireBuf > 0;
      if (wantFire) {
        if (ws.canFire()) { this.shoot(); this.fireBuf = 0; }
        else if (ws.w.mag <= 0 && ws.reloadT <= 0 && ws.pendingSwitch < 0 && ws.fireT <= 0) {
          if (ws.w.reserve > 0) ws.startReload();
          else if (this.fireBuf > 0 || this.mouse.l) { if (!this.dryClick || this.time - this.dryClick > 0.4) { this.audio.play('dry'); this.dryClick = this.time; } this.fireBuf = 0; }
        }
      }
      if (!ws.slots[ws.cur] || (ws.w.mag === 0 && ws.reloadT <= 0 && ws.w.reserve > 0 && !this.mouse.l)) ws.startReload();
    }
    ws.update(dt, {
      ads: P.ads && !P.dead, speed: P.speed, sprinting: P.sprinting, crouched: P.crouched, grounded: P.grounded, lookX: P.lookX, lookY: P.lookY,
    });
    P.lookX = P.lookY = 0;
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 60);
  }

  shoot() {
    const P = this.player, ws = this.ws, w = this.world, cam = this.camera;
    const st = ws.fire();
    this.ms.shots++; this.save.stats.shots++;
    const sp = (ws.spreadDeg(this.mv) * Math.PI) / 180;
    const a = Math.random() * 6.2832, rr = Math.sqrt(Math.random()) * Math.tan(sp);
    const cp = Math.cos(P.pitch), sp_ = Math.sin(P.pitch), sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const fx = -sy * cp, fy = sp_, fz = -cy * cp, rx = cy, rz = -sy, ux = sy * sp_, uy = cp, uz = cy * sp_;
    const ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
    let dx = fx + rx * ca + ux * sa, dy = fy + uy * sa, dz = fz + rz * ca + uz * sa;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let tw = st.range; const hitW = w.raycast(ox, oy, oz, dx, dy, dz, st.range, this.tmpHit);
    const wnx = this.tmpHit.nx, wny = this.tmpHit.ny, wnz = this.tmpHit.nz;
    if (hitW) tw = this.tmpHit.t;
    const e = this.mgr.rayHit(ox, oy, oz, dx, dy, dz, tw, this.tmpHit2);
    const ads = ws.adsT;
    const mx = ox + fx * 0.65 + rx * 0.17 * (1 - ads), my = oy + fy * 0.65 - 0.13 * (1 - ads) - 0.015, mz = oz + fz * 0.65 + rz * 0.17 * (1 - ads);
    let endT = hitW ? tw : Math.min(st.range, 60);
    let hitKind = '';
    if (e) {
      const t = this.tmpHit2.t, head = this.tmpHit2.head; endT = t;
      const fall = (t > st.range * 0.6 && st.id !== 'longshot') ? 1 - 0.3 * (t - st.range * 0.6) / (st.range * 0.4) : 1;
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      const res = e.takeDamage(st.dmg * fall, head);
      if (st.emp && e.def.elec) e.emp(10);
      this.fx.spark(px, py, pz, head ? 10 : 6, 1, 0.8, 0.4, 3.5, 0.3, -dx, 0.3, -dz);
      this.ms.hits++; this.save.stats.hits++;
      if (res) hitKind = res.killed ? 'kill' : head ? 'head' : 'hit';
      this.ui.hitmarker(hitKind || 'hit');
      this.audio.play(hitKind === 'kill' ? 'kill' : head ? 'headshot' : 'hit');
      this.audio.play('enemyHit', { vol: 0.5 });
    } else if (hitW) {
      this.fx.impact(ox + dx * tw, oy + dy * tw, oz + dz * tw, wnx, wny, wnz);
      this.audio.play('impact', { vol: 0.5 });
    }
    // tracer
    const col = st.suppressed ? 0x88ccff : st.emp ? 0xcc88ff : 0xffe9a8;
    this.fx.tracer(mx, my, mz, ox + dx * endT, oy + dy * endT, oz + dz * endT, col, st.emp ? 0.05 : 0.022, st.emp ? 0.12 : 0.06);
    if (st.emp) this.fx.spark(mx + fx * 0.2, my + fy * 0.2, mz + fz * 0.2, 4, 0.6, 0.4, 1, 2, 0.2);
    // recoil
    const rk = (st.recoil * Math.PI / 180) * (P.ads ? 0.62 : 1) * (P.crouched ? 0.85 : 1);
    P.pitch += rk; P.recDebt += rk; P.yaw += (Math.random() - 0.5) * rk * 0.7; P.sinceShot = 0;
    // noise
    P.noisy = st.suppressed ? 0 : 0.9;
    this.makeNoise(st.noise, 1.5);
    this.audio.play(st.sound);
    this.muzzleLight.position.set(ox + fx * 0.9, oy + fy * 0.9 - 0.1, oz + fz * 0.9);
    this.muzzleLight.intensity = st.suppressed ? 0.6 : 3.2;
    if (ws.w.mag <= 0 && ws.w.reserve > 0) { /* auto-reload handled in updateWeapons */ }
  }

  useAbility() {
    const P = this.player;
    if (P.abCd > 0 || P.dead) { if (P.abCd > 0) this.ui.toast(`EMP RECHARGING ${Math.ceil(P.abCd)}s`, 'warn', 1); return; }
    P.abCd = TACTICAL.cooldown;
    const n = this.mgr.emp(P.x, P.z, TACTICAL.radius, TACTICAL.duration);
    this.fx.ring(P.x, 0.2, P.z, TACTICAL.radius, 0x66ccff, 0.8);
    this.audio.play('emp');
    this.ui.toast(n ? `EMP: ${n} DEVICE${n > 1 ? 'S' : ''} DISABLED` : 'EMP: NO TARGETS IN RANGE', n ? 'good' : 'warn', 2);
  }

  // ------------------------------------------------------------ interaction
  updateInteraction(dt) {
    const P = this.player, w = this.world, I = this.interact;
    if (P.dead) { this.ui.setPrompt(null); return; }
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bestScore = -1;
    // silent takedown
    for (const e of this.mgr.list) {
      if (e.dead || e.def.fixed || e.def.id === 'drone' || e.disabledT > 0 || !e.isUnaware()) continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
      if (d > 1.9) continue;
      const efx = -Math.sin(e.yaw), efz = -Math.cos(e.yaw);
      if ((dx * efx + dz * efz) / (d || 1) < 0.25) continue;        // player must be behind the guard
      if ((dx * fx + dz * fz) / (d || 1) < 0.7) continue;
      const sc = 10 - d; if (sc > bestScore) { bestScore = sc; best = { kind: 'takedown', e, text: `Silent takedown: ${e.def.name}` }; }
    }
    if (!best) {
      const consider = (kind, ref, x, z, maxD, minDot, text, extra) => {
        const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
        if (d > maxD) return;
        const dot = (dx * fx + dz * fz) / (d || 1);
        if (dot < minDot && d > 1.0) return;
        const sc = 8 - d + dot; if (sc > bestScore) { bestScore = sc; best = Object.assign({ kind, ref, text }, extra); }
      };
      for (const t of w.terminals) if (t.state !== 'done') consider('terminal', t, t.x, t.z, 2.6, 0.5, `Hold to hack: ${t.def.label}`, { time: t.def.time });
      for (const i of w.intel) if (!i.taken) consider('intel', i, i.x, i.z, 2.3, 0.5, `Hold to collect: ${i.def.label}`, { time: 1.1 });
      for (const d of w.doors) consider('door', d, d.x, d.z, 2.7, 0.45, d.locked ? 'Door locked' : d.open ? 'Close door' : 'Open door', {});
    }
    // focus change resets progress (except terminals which remember)
    const sameTarget = best && I.target && best.kind === I.target.kind && (best.ref ? best.ref === I.target.ref : best.e === I.target.e);
    if (!sameTarget) {
      if (I.target && I.target.kind === 'intel') I.progress = 0;
      I.progress = best && best.kind === 'terminal' ? best.ref.progress : 0;
    }
    I.target = best;
    if (!best) { this.ui.setPrompt(null); this.eEdge = false; return; }
    if (best.kind === 'door' || best.kind === 'takedown') {
      this.ui.setPrompt(best.text);
      if (this.eEdge) {
        if (best.kind === 'door') {
          const d = best.ref;
          if (d.locked) { this.audio.play('locked'); this.ui.toast('ACCESS DENIED. Find the security terminal.', 'warn', 1.8); }
          else { w.setDoorOpen(d, !d.open); this.makeNoise(4.5, 0.4); }
        } else {
          best.e.takeDamage(99999, false, { silent: true });
          this.audio.play('takedown'); this.mgr.noise(best.e.x, best.e.z, 3.5, 0.5, false);
        }
      }
    } else {
      const hacking = this.eHeld;
      const total = best.time;
      if (hacking) {
        I.progress += dt / total;
        I.noiseT -= dt; if (I.noiseT <= 0) { I.noiseT = 0.18; this.audio.play('hack'); }
        if (best.kind === 'terminal') { best.ref.state = 'hacking'; best.ref.progress = I.progress; best.ref.redraw = this.frame % 5 === 0; }
        if (I.progress >= 1) { this.completeInteract(best); I.progress = 0; }
        if (best.ref.def && best.ref.def.action === 'download') { this.triggerDownloadStart(); }
      } else if (best.kind === 'terminal' && best.ref.state === 'hacking') { best.ref.state = 'idle'; best.ref.redraw = true; if (best.ref.def.action !== 'download') { I.progress = 0; best.ref.progress = 0; } }
      else if (best.kind === 'intel') I.progress = 0;
      this.ui.setPrompt(hacking ? best.text.replace('Hold to ', '').replace(/^./, (c) => c.toUpperCase()) + '…' : best.text, I.progress);
    }
    this.eEdge = false;
  }

  triggerDownloadStart() {
    if (this.reinforced || this.m.id !== 2) return;
    this.reinforced = true;
    this.triggerAlarm(this.player.x, this.player.z, true);
    this.ui.toast('DOWNLOAD DETECTED. ELITE REINFORCEMENTS INBOUND', 'bad', 3.5);
    for (const spec of this.m.reinforce || []) {
      const e = this.mgr.spawn(spec);
      e.lastKnown.x = this.player.x; e.lastKnown.z = this.player.z; e.aware = 0.7; e.enterInvestigate(this.player.x, this.player.z);
    }
  }

  completeInteract(t) {
    const w = this.world;
    if (t.kind === 'intel') {
      t.ref.taken = true; for (const mm of t.ref.meshes) mm.visible = false;
      this.ms.intel++; this.completeObjective(t.ref.def.objective);
      return;
    }
    const term = t.ref; term.state = 'done'; term.progress = 1; term.redraw = true;
    this.audio.play('hackDone');
    const act = term.def.action;
    if (act === 'unlockDoors') { this.unlockAllDoors(); this.mgr.disableAllElectronics('camera'); this.ui.toast('SECURITY DOWN. VAULT DOORS UNLOCKED, CAMERAS OFFLINE', 'good', 3.5); this.completeObjective('terminal', true); }
    else if (act === 'disableCameras') { this.mgr.disableAllElectronics('camera'); if (this.alarm.active) { this.alarm.t = 0.1; } this.ui.toast('CAMERA NETWORK OFFLINE', 'good', 3); }
    else if (act === 'bypassHVT') { this.ms.bypass = true; this.completeObjective('hvt'); }
    else if (act === 'disableTurretsA' || act === 'disableTurretsB') {
      this.mgr.disableGroup(act === 'disableTurretsA' ? 'A' : 'B');
      const o = this.objs.defense; o.count++; this.refreshObjectives();
      this.ui.toast(`SENTRY GRID ${o.count}/2 OFFLINE`, 'good', 2.6);
      if (o.count >= o.total) this.completeObjective('defense');
    } else if (act === 'download') this.completeObjective('download');
  }

  // ------------------------------------------------------------ pickups & mission rules
  updatePickups() {
    const P = this.player; if (P.dead) return;
    for (const p of this.world.pickups) {
      if (p.taken) continue;
      const dx = p.x - P.x, dz = p.z - P.z;
      if (dx * dx + dz * dz > 1.2 * 1.2) continue;
      let used = false;
      if (p.kind === 'med' && P.hp < PLAYER.hp) { P.hp = Math.min(PLAYER.hp, P.hp + 45); used = true; this.ui.toast('MEDKIT +45 HP', 'good', 1.6); }
      else if (p.kind === 'armor' && P.armor < PLAYER.armor) { P.armor = Math.min(PLAYER.armor, P.armor + 50); used = true; this.ui.toast('ARMOUR RESTORED', 'good', 1.6); }
      else if (p.kind === 'ammo' && this.ws.addAmmo(0.5)) { used = true; this.ui.toast('AMMO RESUPPLIED', 'good', 1.6); }
      if (used) { p.taken = true; for (const m of p.meshes) m.visible = false; this.audio.play('pickup'); }
    }
  }

  updateMissionLogic(dt) {
    const P = this.player, ms = this.ms, w = this.world;
    // alarm decay
    if (this.alarm.active) {
      this.alarm.t -= dt;
      this.alarmLight.intensity = 2.2 * (0.5 + 0.5 * Math.sin(this.time * 7)); this.alarmLight.position.set(P.x, P.y + 2.4, P.z);
      if (this.alarm.t <= 0 && this.countdown <= 0) { this.alarm.active = false; this.alarmActive = false; this.audio.stopAlarm(); $('alarm-banner').classList.add('hidden'); this.alarmLight.intensity = 0; this.ui.toast('ALARM STOOD DOWN', '', 2); }
    }
    // lockdown countdown (mission 3)
    if (this.countdown > 0) {
      this.countdown -= dt; this.alarm.t = 5;
      $('alarm-banner').textContent = `LOCKDOWN ${fmtTime(Math.max(0, this.countdown))}`;
      if (this.countdown <= 0) { this.deathReason = 'The station sealed itself before you reached the pod bay.'; this.failMission(this.deathReason); return; }
    } else if (this.alarm.active) $('alarm-banner').textContent = 'ALARM TRIGGERED';
    // timed bonus
    if (!this.objs.time || this.objs.time.failed) { /* nothing */ } else if (ms.time > this.m.par) this.failObjective('time');
    // extraction
    const dx = P.x - w.exX, dz = P.z - w.exZ;
    if (dx * dx + dz * dz < 2.2 * 2.2 && !P.dead) {
      if (this.extractionActive) this.completeMission();
      else if (this.time - this.extractionToast > 3) { this.extractionToast = this.time; this.ui.toast('COMPLETE THE OBJECTIVES BEFORE EXTRACTING', 'warn', 2.2); }
    }
    // low-ammo timeout for the damage vignette
    if (P.hurtT <= 0) $('vignette').style.opacity = P.hp < 30 ? 0.35 + Math.sin(this.time * 5) * 0.12 : 0;
  }

  // ------------------------------------------------------------ results
  tally(won) {
    const ms = this.ms, sv = this.save;
    sv.stats.kills += ms.kills; sv.stats.headshots += ms.headshots; sv.stats.takedowns += ms.takedowns; sv.stats.playtime += ms.time;
    if (won) sv.stats.missions++; else sv.stats.deaths++;
  }

  failMission(reason) {
    if (this.state !== 'playing') return;
    this.state = 'failed';
    this.tally(false); this.persist();
    this.finishSession(); this.audio.stopAlarm(); this.audio.stopAmbient();
    this.ui.showFailed(reason, [['Time', fmtTime(this.ms.time)], ['Eliminations', this.ms.kills], ['Times spotted', this.ms.incidents], ['Damage taken', Math.round(this.ms.damageTaken)]]);
    this.deathReason = null;
  }

  completeMission() {
    if (this.state !== 'playing') return;
    this.state = 'complete';
    const ms = this.ms, m = this.m, sv = this.save, idx = m.id;
    // optional objectives
    const opt = m.objectives.filter((o) => o.optional);
    const ghost = this.objs.ghost, noalarm = this.objs.noalarm, cams = this.objs.cams;
    if (ghost && !ghost.failed) this.objs.ghost.done = true;
    if (noalarm && !noalarm.failed) this.objs.noalarm.done = true;
    if (cams && !cams.failed) this.objs.cams.done = true;
    if (this.objs.time && !this.objs.time.failed && ms.time <= m.par) this.objs.time.done = true;
    const optDone = opt.filter((o) => this.objs[o.id].done).length;
    const stealth = ms.incidents === 0 ? 300 : Math.max(0, 300 - 100 * ms.incidents);
    const speed = Math.round(clamp((m.par - ms.time) / m.par, 0, 1) * 200);
    const dmgPen = Math.min(150, Math.round(ms.damageTaken * 0.8));
    const alarmPen = ms.alarms ? 100 : 0;
    const bonus = Math.min(100, ms.kills * 10) + Math.min(50, ms.headshots * 5) + ms.takedowns * 10;
    const score = Math.max(0, 500 + optDone * 150 + stealth + speed - dmgPen - alarmPen + Math.min(150, bonus));
    const rank = RANKS.find((r) => score >= r.min).id;
    const first = !sv.ranks[idx];
    const newBest = !first && (!sv.best[idx] || ms.time < sv.best[idx]);
    const mult = first ? 1 : 0.6;
    let credits = Math.round((m.reward + score * 0.15) * mult), xp = Math.round((120 * m.difficulty + score / 3) * (first ? 1 : 0.5));
    const lvBefore = levelFromXp(sv.xp);
    sv.xp += xp; const lvAfter = levelFromXp(sv.xp);
    const unlocks = [];
    if (lvAfter > lvBefore) { const bonusC = (lvAfter - lvBefore) * 150; credits += bonusC; unlocks.push(`LEVEL UP: ${lvAfter} (+${bonusC} credits)`); }
    sv.credits += credits;
    if (!sv.ranks[idx] || RANK_VALUE[rank] > RANK_VALUE[sv.ranks[idx]]) sv.ranks[idx] = rank;
    if (!sv.best[idx] || ms.time < sv.best[idx]) sv.best[idx] = Math.round(ms.time);
    if (idx + 1 > sv.maxMission && idx < 2) { sv.maxMission = idx + 1; unlocks.push(`MISSION UNLOCKED: ${MISSIONS[idx + 1].name}`); }
    const gifts = { 0: 'vortex', 1: 'reaper' };
    if (gifts[idx] && !sv.gifts[idx]) {
      sv.gifts[idx] = true;
      if (!sv.owned[gifts[idx]]) { sv.owned[gifts[idx]] = true; if (sv.equipped.length < 4) { sv.equipped.push(gifts[idx]); this.sortEquipped(); } unlocks.push(`WEAPON UNLOCKED: ${WEAPONS[gifts[idx]].name}`); }
    }
    this.tally(true); this.persist();
    this.finishSession(); this.audio.stopAlarm(); this.audio.stopAmbient(); this.audio.play('success');
    const acc = ms.shots ? Math.round((ms.hits / ms.shots) * 100) + '%' : '-';
    const rows = [
      ['Time', `${fmtTime(ms.time)} (par ${fmtTime(m.par)})`, ms.time <= m.par ? 'good' : ''],
      ['Eliminations', `${ms.kills} (${ms.takedowns} silent)`], ['Headshots', ms.headshots], ['Accuracy', acc],
      ['Times spotted', ms.incidents, ms.incidents ? 'bad' : 'good'], ['Damage taken', Math.round(ms.damageTaken)],
      ...opt.map((o) => [o.text, this.objs[o.id].done ? 'DONE' : 'MISSED', this.objs[o.id].done ? 'good' : 'bad']),
    ];
    this.ui.showComplete({ mission: m, rank, score, rows, credits, xp, unlocks, first, newBest });
  }

  // ------------------------------------------------------------ camera & HUD
  updateCamera(dt) {
    const P = this.player, cam = this.camera, s = this.settings, ws = this.ws;
    let bx = 0, by = 0;
    if (s.headBob && P.grounded && P.speed > 0.6 && !P.dead) {
      P.bobT += dt * P.speed * 1.55;
      const amp = (P.sprinting ? 1.35 : P.crouched ? 0.5 : 1) * (1 - ws.adsT * 0.8);
      by = Math.abs(Math.sin(P.bobT)) * 0.032 * amp - 0.012 * amp; bx = Math.cos(P.bobT) * 0.016 * amp;
    }
    const sh = P.shake * P.shake * 0.02;
    const cyaw = Math.cos(P.yaw), syaw = Math.sin(P.yaw);
    cam.position.set(P.x + cyaw * bx, P.y + P.eye + by + (Math.random() - 0.5) * sh, P.z - syaw * bx);
    const strafeRoll = -((this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0)) * 0.012 * (P.grounded ? 1 : 0.4);
    P.rollNow = (P.rollNow || 0) + (strafeRoll - (P.rollNow || 0)) * Math.min(1, dt * 8);
    cam.rotation.set(P.pitch + (Math.random() - 0.5) * sh, P.yaw + (Math.random() - 0.5) * sh, P.rollNow + P.roll);
    const zoom = 1 + (ws.w ? (ws.w.st.zoom - 1) : 0) * ws.adsT;
    const target = (s.fov * (P.sprinting ? 1.07 : 1)) / zoom;
    if (Math.abs(cam.fov - target) > 0.05) { cam.fov += (target - cam.fov) * Math.min(1, dt * 14 + (dt === 0 ? 1 : 0)); cam.updateProjectionMatrix(); }
    // lights follow
    this.lamp.position.set(P.x, P.y + 2.3, P.z);
    this.sun.position.set(P.x + 10, 26, P.z + 8); this.sun.target.position.set(P.x, 0, P.z);
    cam.updateMatrixWorld();
  }

  updateHud(dt) {
    const ui = this.ui, P = this.player, ws = this.ws, w = ws.w;
    ui.tickToast(dt); ui.tickHit(dt);
    ui.set('hp-num', 'text', Math.ceil(P.hp)); ui.set('hp-fill', 'w', `${clamp(P.hp, 0, 100)}%`);
    ui.set('ar-num', 'text', Math.ceil(P.armor)); ui.set('ar-fill', 'w', `${(P.armor / PLAYER.armor) * 100}%`);
    ui.set('weapon-name', 'text', w.st.name.toUpperCase());
    ui.set('ammo-mag', 'text', w.mag); ui.set('ammo-res', 'text', w.reserve);
    ui.set('ammo-mag', 'cls', '');
    const low = w.mag <= Math.ceil(w.st.mag * 0.25);
    const am = document.querySelector('.ammo'); if (am) am.classList.toggle('low', low);
    const key = ws.slots.map((s, i) => `${i}${s.id}${i === ws.cur ? '*' : ''}`).join();
    if (key !== this.lastWeaponKey) { this.lastWeaponKey = key; $('weapon-slots').innerHTML = ws.slots.map((s, i) => `<span class="${i === ws.cur ? 'cur' : ''}">${i + 1} ${WEAPONS[s.id].name.split(' ')[0]}</span>`).join(''); }
    $('reload-hint').classList.toggle('hidden', !(w.mag === 0 && ws.reloadT <= 0 && w.reserve > 0 && ws.pendingSwitch < 0) && !(low && w.mag > 0 && false));
    const cd = P.abCd / TACTICAL.cooldown;
    $('ab-ring').style.strokeDashoffset = (107 * cd).toFixed(1); $('ability').classList.toggle('cool', cd > 0);
    $('hud-time').textContent = fmtTime(this.ms.time);
    // stealth meters
    const still = P.speed < 0.5;
    const vis = P.crouched ? (still ? 0.15 : 0.32) : P.sprinting ? 1 : still ? 0.5 : 0.7;
    const visF = vis * (P.ads ? 0.9 : 1) * (P.noisy > 0 ? 1.3 : 1);
    const vc = visF < 0.35 ? '#4dffa0' : visF < 0.7 ? '#ffd23f' : '#ff3355';
    ui.set('vis-fill', 'w', `${Math.min(100, Math.round(visF * 100))}%`); $('vis-fill').style.background = vc;
    const nz = P.noiseVal; ui.set('noi-fill', 'w', `${Math.round(nz * 100)}%`); $('noi-fill').style.background = nz < 0.4 ? '#4dffa0' : nz < 0.7 ? '#ffd23f' : '#ff3355';
    // crosshair
    const scoped = w.st.scope && ws.adsT > 0.85;
    $('scope').style.display = scoped ? 'block' : 'none';
    const spreadRad = (ws.spreadDeg(this.mv) * Math.PI) / 180;
    const px = Math.tan(spreadRad) * (this.H / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
    const tgt = this.mgr.list.some((e) => !e.dead && e.sees && false);
    ui.drawCrosshair(clamp(px, 0, 45), P.noisy > 0 ? '#ffd23f' : '#ffffff', ws.adsT > 0.5, scoped);
    ui.updateMarkers(this.mgr.list, this.camera, this.W, this.H, this.world, P);
    if (this.frame % 3 === 0) ui.drawMinimap(this.world, P, this.mgr.list);
  }

  updateTabPanel() {
    const ms = this.ms;
    $('tab-stats').innerHTML = `<span>TIME ${fmtTime(ms.time)}</span><span>ELIMINATIONS ${ms.kills}</span><span>SPOTTED ${ms.incidents}</span><span>HEADSHOTS ${ms.headshots}</span>`;
  }
}

if (!window.THREE) {
  fatal('Three.js failed to load. Project Phantom needs an internet connection to fetch it from the cdnjs CDN. Check your connection and reload.');
} else {
  try { new Game(); } catch (e) { console.error(e); fatal('Could not initialise WebGL: ' + (e && e.message ? e.message : e)); }
}
