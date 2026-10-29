// DOM UI: menus, armory, settings, HUD helpers, minimap and awareness markers.
import { WEAPONS, WEAPON_ORDER, UPGRADES, DIFFICULTY, levelFromXp, xpForLevel, CS } from './data.js';
import { MISSIONS } from './missions.js';
import { effectiveStats } from './weapons.js';
import { S } from './enemies.js';

const THREE = window.THREE;
const $ = (id) => document.getElementById(id);
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export { fmtTime };

export class UI {
  constructor(game) {
    this.g = game;
    this.stack = ['s-menu'];
    this.selMission = 0;
    this.selWeapon = 'spectre';
    this.toastT = 0;
    this.lastCross = '';
    this.markerEls = [];
    this.dirEls = [];
    this.hmT = 0;
    this.v = new THREE.Vector3();
    this.mapCache = null;
    this._bind();
    this._initHud();
  }

  // ------------------------------------------------------------ screen routing
  show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    this.current = id;
  }
  hideAll() { document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active')); this.current = null; }
  push(id) { this.stack.push(id); this.show(id); this.g.audio.play('ui'); this._refresh(id); }
  back() {
    if (this.stack.length > 1) this.stack.pop();
    const id = this.stack[this.stack.length - 1];
    this.show(id); this.g.audio.play('uiBack'); this._refresh(id);
  }
  goto(id) { this.stack = [id]; this.show(id); this._refresh(id); }
  _refresh(id) {
    if (id === 's-menu') this.refreshMenu();
    else if (id === 's-missions') this.buildMissionCards();
    else if (id === 's-armory') this.buildArmory();
    else if (id === 's-settings') this.syncSettings();
    else if (id === 's-briefing') this.buildBriefing(this.selMission);
  }

  _bind() {
    const g = this.g, on = (id, fn) => $(id).addEventListener('click', () => { g.audio.init(); fn(); });
    on('btn-continue', () => g.continueCampaign());
    on('btn-new', () => { if (g.hasProgress()) $('new-confirm').classList.remove('hidden'); else g.newCampaign(); });
    on('btn-new-yes', () => { $('new-confirm').classList.add('hidden'); g.newCampaign(); });
    on('btn-new-no', () => $('new-confirm').classList.add('hidden'));
    on('btn-missions', () => this.push('s-missions'));
    on('btn-armory', () => this.push('s-armory'));
    on('btn-settings', () => this.push('s-settings'));
    on('btn-credits', () => this.push('s-credits'));
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => this.back()));
    on('br-armory', () => this.push('s-armory'));
    on('br-deploy', () => g.deploy(this.selMission));
    on('p-resume', () => g.resume());
    on('p-restart', () => g.restartMission());
    on('p-settings', () => this.push('s-settings'));
    on('p-abort', () => g.abortMission());
    on('c-menu', () => g.toMenu());
    on('c-replay', () => g.deploy(g.missionIdx));
    on('c-next', () => { this.selMission = Math.min(2, g.missionIdx + 1); this.goto('s-briefing'); });
    on('f-menu', () => g.toMenu());
    on('f-retry', () => g.restartMission());
    // settings
    const S_ = g.save.settings;
    const bindRange = (id, key, fmt) => {
      const el = $(id), out = $('o-' + id.slice(4));
      el.addEventListener('input', () => { g.save.settings[key] = parseFloat(el.value); out.textContent = fmt(parseFloat(el.value)); g.applySettings(); g.persist(); });
    };
    bindRange('set-sens', 'sens', (v) => v.toFixed(2));
    bindRange('set-ads', 'adsSens', (v) => v.toFixed(2));
    bindRange('set-fov', 'fov', (v) => `${v | 0}`);
    bindRange('set-vol', 'volume', (v) => `${Math.round(v * 100)}%`);
    $('set-quality').addEventListener('change', (e) => { g.save.settings.quality = e.target.value; g.applySettings(); g.persist(); });
    $('set-diff').addEventListener('change', (e) => { g.save.settings.difficulty = e.target.value; g.persist(); });
    $('set-invert').addEventListener('change', (e) => { g.save.settings.invertY = e.target.checked; g.persist(); });
    $('set-bob').addEventListener('change', (e) => { g.save.settings.headBob = e.target.checked; g.persist(); });
    $('set-cones').addEventListener('change', (e) => { g.save.settings.showCones = e.target.checked; g.persist(); });
    let armed = false;
    $('btn-reset').addEventListener('click', () => {
      if (!armed) { armed = true; $('reset-msg').textContent = 'Click again to permanently erase all progress.'; setTimeout(() => { armed = false; $('reset-msg').textContent = ''; }, 4000); return; }
      armed = false; g.eraseSave(); $('reset-msg').textContent = 'Save data erased.'; this.syncSettings();
    });
  }

  syncSettings() {
    const s = this.g.save.settings;
    $('set-sens').value = s.sens; $('o-sens').textContent = s.sens.toFixed(2);
    $('set-ads').value = s.adsSens; $('o-ads').textContent = s.adsSens.toFixed(2);
    $('set-fov').value = s.fov; $('o-fov').textContent = `${s.fov | 0}`;
    $('set-vol').value = s.volume; $('o-vol').textContent = `${Math.round(s.volume * 100)}%`;
    $('set-quality').value = s.quality; $('set-diff').value = s.difficulty;
    $('set-invert').checked = s.invertY; $('set-bob').checked = s.headBob; $('set-cones').checked = s.showCones;
  }

  // ------------------------------------------------------------ main menu
  refreshMenu() {
    const sv = this.g.save, lv = levelFromXp(sv.xp);
    const lo = xpForLevel(lv), hi = xpForLevel(lv + 1);
    $('pf-level').textContent = lv;
    $('pf-xp').style.width = `${Math.min(100, ((sv.xp - lo) / (hi - lo)) * 100)}%`;
    $('pf-xptxt').textContent = `${sv.xp} / ${hi} XP`;
    $('pf-credits').textContent = sv.credits;
    $('pf-kills').textContent = sv.stats.kills;
    $('pf-missions').textContent = sv.stats.missions;
    $('pf-acc').textContent = sv.stats.shots ? `${Math.round((sv.stats.hits / sv.stats.shots) * 100)}%` : '0%';
    $('btn-continue').disabled = !this.g.hasProgress();
    $('new-confirm').classList.add('hidden');
  }

  buildMissionCards() {
    const wrap = $('mission-cards'); wrap.innerHTML = '';
    const sv = this.g.save;
    MISSIONS.forEach((m, i) => {
      const locked = i > sv.maxMission;
      const b = document.createElement('button');
      b.className = 'mcard panel' + (locked ? ' locked' : '');
      const rank = sv.ranks[i];
      b.innerHTML = `<small>OPERATION 0${i + 1}</small><h3>${m.name}</h3><p>${locked ? 'Locked. Complete the previous operation.' : m.location}</p>
        <div class="diff">${[0, 1, 2].map((k) => `<i class="${k < m.difficulty ? 'on' : ''}"></i>`).join('')}</div>
        <div class="meta"><span>${sv.best[i] ? 'BEST ' + fmtTime(sv.best[i]) : locked ? 'LOCKED' : 'NOT COMPLETED'}</span><div class="mrank ${rank ? '' : 'none'}">${rank || '-'}</div></div>`;
      if (!locked) b.addEventListener('click', () => { this.g.audio.init(); this.selMission = i; this.push('s-briefing'); });
      wrap.appendChild(b);
    });
  }

  buildBriefing(i) {
    const m = MISSIONS[i], sv = this.g.save;
    $('br-code').textContent = `OPERATION 0${i + 1}`;
    $('br-name').textContent = m.name; $('br-loc').textContent = m.location; $('br-text').textContent = m.brief;
    $('br-diff').innerHTML = [0, 1, 2].map((k) => `<i class="${k < m.difficulty ? 'on' : ''}"></i>`).join('');
    $('br-obj').innerHTML = m.objectives.map((o) => `<li class="${o.optional ? 'opt' : ''}">${o.text}${o.optional ? ' (optional)' : ''}</li>`).join('');
    $('br-tips').innerHTML = m.tips.map((t) => `<li>${t}</li>`).join('');
    $('br-loadout').innerHTML = sv.equipped.map((id, k) => `<span class="chip">${k + 1} &middot; ${WEAPONS[id].name}</span>`).join('');
  }

  // ------------------------------------------------------------ armory
  buildArmory() {
    const g = this.g, sv = g.save;
    $('ar-credits').textContent = sv.credits;
    const list = $('weapon-list'); list.innerHTML = '';
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id], owned = sv.owned[id], eq = sv.equipped.includes(id);
      const b = document.createElement('button');
      b.className = 'witem' + (this.selWeapon === id ? ' sel' : '') + (eq ? ' eq' : '');
      b.innerHTML = `<div><b>${w.name}</b><br><span>${w.tag}</span></div><span class="${owned ? 'tag' : 'price'}">${owned ? (eq ? 'SLOT ' + (sv.equipped.indexOf(id) + 1) : 'OWNED') : w.cost + ' CR'}</span>`;
      b.addEventListener('click', () => { this.selWeapon = id; g.audio.play('ui'); this.buildArmory(); });
      list.appendChild(b);
    }
    const id = this.selWeapon, w = WEAPONS[id], owned = sv.owned[id], ups = sv.upgrades[id] || {};
    const st = effectiveStats(id, ups);
    const bar = (label, val, max, txt) => `<div class="statrow"><span>${label}</span><div class="bar"><b style="width:${Math.max(3, Math.min(100, (val / max) * 100))}%"></b></div><span>${txt}</span></div>`;
    let html = `<h3>${w.name}</h3><div class="sub">${w.tag}${w.suppressed ? ' &middot; suppressed' : ''}${w.emp ? ' &middot; EMP' : ''}</div><p>${w.desc}</p>`;
    html += bar('DAMAGE', st.dmg, 120, st.dmg.toFixed(0)) + bar('FIRE RATE', 1 / st.rate, 18, `${Math.round(60 / st.rate)}rpm`) + bar('RANGE', st.range, 220, `${st.range}m`) +
      bar('MAGAZINE', st.mag, 60, `${st.mag}/${st.reserve}`) + bar('RELOAD', 3 - st.reload, 3, `${st.reload.toFixed(1)}s`) + bar('STABILITY', 5 - st.recoil, 5, `${st.recoil.toFixed(1)}°`) +
      bar('NOISE', 50 - st.noise, 50, `${st.noise}m`);
    html += '<div style="margin-top:14px" class="row">';
    if (!owned) html += `<button class="btn primary sm" id="wb-buy" ${sv.credits < w.cost ? 'disabled' : ''}>Buy &middot; ${w.cost} CR</button>`;
    else {
      const eq = sv.equipped.includes(id);
      html += `<button class="btn sm ${eq ? '' : 'primary'}" id="wb-eq" ${eq && sv.equipped.length <= 1 ? 'disabled' : ''}>${eq ? 'Unequip' : 'Equip'}</button>`;
    }
    html += '</div>';
    if (owned) {
      html += '<h4 style="margin-top:18px">UPGRADES</h4>';
      for (const k of Object.keys(UPGRADES)) {
        const u = UPGRADES[k], lv = ups[k] || 0, cost = u.cost[lv];
        html += `<div class="upg"><div><b>${u.name}</b> <small>${u.desc}</small><div class="pips">${Array.from({ length: u.max }, (_, n) => `<i class="${n < lv ? 'on' : ''}"></i>`).join('')}</div></div>
          ${lv >= u.max ? '<span class="dim">MAX</span>' : `<button class="btn sm" data-up="${k}" ${sv.credits < cost ? 'disabled' : ''}>${cost} CR</button>`}</div>`;
      }
    }
    const det = $('weapon-detail'); det.innerHTML = html;
    const buy = $('wb-buy'); if (buy) buy.addEventListener('click', () => { if (g.buyWeapon(id)) this.buildArmory(); });
    const eqb = $('wb-eq'); if (eqb) eqb.addEventListener('click', () => { g.toggleEquip(id); this.buildArmory(); });
    det.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { if (g.buyUpgrade(id, b.dataset.up)) this.buildArmory(); }));
  }

  // ------------------------------------------------------------ results
  showComplete(r) {
    $('c-name').textContent = r.mission.name;
    $('c-rank').textContent = r.rank; $('c-score').textContent = `SCORE ${r.score}`;
    $('c-new').textContent = r.newBest ? 'NEW PERSONAL BEST' : (r.first ? 'FIRST CLEAR' : '');
    $('c-stats').innerHTML = r.rows.map((x) => `<tr class="${x[2] || ''}"><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('');
    $('c-credits').textContent = r.credits; $('c-xp').textContent = r.xp;
    const u = $('c-unlock'); u.classList.toggle('hidden', !r.unlocks.length); u.innerHTML = r.unlocks.join('<br>');
    $('c-next').classList.toggle('hidden', r.mission.id >= 2);
    this.hideHud(); this.show('s-complete');
  }

  showFailed(reason, rows) {
    $('f-reason').textContent = reason;
    $('f-stats').innerHTML = rows.map((x) => `<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('');
    this.hideHud(); this.show('s-failed');
  }

  // ------------------------------------------------------------ HUD
  _initHud() {
    const mk = $('markers');
    for (let i = 0; i < 10; i++) {
      const d = document.createElement('div'); d.className = 'mk'; d.innerHTML = '<b></b><div class="mb"><i></i></div><small></small>'; mk.appendChild(d);
      this.markerEls.push({ el: d, b: d.firstChild, bar: d.querySelector('i'), sm: d.querySelector('small') });
    }
    const dd = $('dmgdirs');
    for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'dmgdir'; dd.appendChild(d); this.dirEls.push({ el: d, t: 0 }); }
    this.dirHead = 0;
    this.cross = $('cross').getContext('2d');
    this.hm = $('hitmarker');
    this.map = $('minimap').getContext('2d');
    this.hp = { hp: -1, ar: -1 };
    this.cache = {};
  }

  showHud() { $('hud').classList.remove('hidden'); }
  hideHud() { $('hud').classList.add('hidden'); $('lock-overlay').classList.add('hidden'); $('tab-panel').classList.add('hidden'); }

  set(id, prop, val) { // write DOM only when the value changes
    const k = id + prop;
    if (this.cache[k] === val) return;
    this.cache[k] = val; const el = $(id);
    if (prop === 'text') el.textContent = val; else if (prop === 'w') el.style.width = val; else if (prop === 'cls') el.className = val; else if (prop === 'html') el.innerHTML = val;
  }

  toast(msg, type = '', time = 2.8) {
    const t = $('toast'); t.textContent = msg; t.className = 'show ' + type; this.toastT = time;
  }

  tickToast(dt) { if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); } }

  hitmarker(kind) {
    const h = this.hm; h.className = 'show ' + (kind === 'kill' ? 'kill' : kind === 'head' ? 'head' : '');
    void h.offsetWidth; this.hmT = 0.12;
  }
  tickHit(dt) { if (this.hmT > 0) { this.hmT -= dt; if (this.hmT <= 0) this.hm.classList.add('fade'), this.hm.classList.remove('show'); } }

  dmgDir(angle) {
    const d = this.dirEls[this.dirHead]; this.dirHead = (this.dirHead + 1) % this.dirEls.length;
    d.el.style.transition = 'none'; d.el.style.opacity = 1; d.el.style.transform = `rotate(${angle}rad)`;
    void d.el.offsetWidth; d.el.style.transition = 'opacity 0.9s'; d.el.style.opacity = 0;
  }

  setObjectives(list, progress) {
    const html = list.map((o) => `<li class="${o.cls}">${o.text}</li>`).join('');
    this.set('obj-list', 'html', html);
    this.set('obj-fill', 'w', `${Math.round(progress * 100)}%`);
    $('tab-obj').innerHTML = list.map((o) => `<div class="${o.cls}">${o.cls === 'done' ? '&#10003;' : o.cls === 'fail' ? '&#10007;' : '&#9656;'} ${o.text}</div>`).join('');
  }

  setPrompt(text, progress = -1) {
    const p = $('prompt');
    if (!text) { if (!p.classList.contains('hidden')) p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    this.set('prompt-text', 'text', text);
    const bar = $('prompt-bar');
    if (progress >= 0) { bar.classList.remove('hidden'); $('prompt-fill').style.width = `${Math.round(progress * 100)}%`; } else bar.classList.add('hidden');
  }

  drawCrosshair(gapPx, color, ads, scoped) {
    const key = `${Math.round(gapPx)}|${color}|${ads ? 1 : 0}|${scoped ? 1 : 0}`;
    if (key === this.lastCross) return; this.lastCross = key;
    const c = this.cross; c.clearRect(0, 0, 128, 128);
    if (scoped) return;
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 2.5; c.shadowColor = '#000'; c.shadowBlur = 3;
    const gap = 5 + gapPx, len = 9;
    c.beginPath();
    c.moveTo(64 - gap - len, 64); c.lineTo(64 - gap, 64); c.moveTo(64 + gap, 64); c.lineTo(64 + gap + len, 64);
    c.moveTo(64, 64 - gap - len); c.lineTo(64, 64 - gap); c.moveTo(64, 64 + gap); c.lineTo(64, 64 + gap + len);
    c.stroke();
    c.beginPath(); c.arc(64, 64, 1.6, 0, 7); c.fill();
  }

  // ---- awareness markers (projected above enemy heads)
  updateMarkers(enemies, camera, w, h, world, P) {
    let n = 0;
    const cand = [];
    for (const e of enemies) {
      if (e.dead || e.disabledT > 0) continue;
      const hot = e.state === S.ALERT || e.state === S.SUSPICIOUS || e.state === S.INVESTIGATE || e.state === S.SEARCH || e.aware > 0.06;
      if (!hot && !e.hvt) continue;
      const top0 = e.def.id === 'drone' ? e.y : e.def.id === 'camera' ? 2.7 : 1.6;
      if (!world.los(P.x, P.y + P.eye, P.z, e.x, top0, e.z, this.scratch || (this.scratch = {}))) continue;
      cand.push(e);
    }
    cand.sort((a, b) => b.aware - a.aware);
    for (const e of cand) {
      if (n >= this.markerEls.length) break;
      const top = e.def.id === 'drone' ? e.y + 0.7 : e.def.id === 'camera' ? 3.4 : e.def.id === 'turret' ? 1.8 : 2.1 * e.def.scale;
      this.v.set(e.x, top, e.z).project(camera);
      if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) continue;
      const m = this.markerEls[n++];
      const sx = (this.v.x * 0.5 + 0.5) * w, sy = (-this.v.y * 0.5 + 0.5) * h;
      m.el.style.display = 'block'; m.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
      const st = e.state;
      const alert = st === S.ALERT;
      const col = alert ? '#ff3355' : (st === S.SUSPICIOUS ? '#ffd23f' : '#ff9a2e');
      m.b.textContent = alert ? '!' : (e.aware > 0.06 || st !== S.PATROL ? '?' : '');
      m.el.style.color = e.aware > 0.06 || st !== S.PATROL ? col : '#ffd23f';
      m.bar.style.width = `${Math.round(e.aware * 100)}%`;
      m.sm.textContent = e.hvt ? 'TARGET' : '';
    }
    for (let i = n; i < this.markerEls.length; i++) if (this.markerEls[i].el.style.display !== 'none') this.markerEls[i].el.style.display = 'none';
  }

  // ---- minimap
  prepareMinimap(world) {
    const sc = 5, cv = document.createElement('canvas'); cv.width = world.W * sc; cv.height = world.H * sc;
    const c = cv.getContext('2d');
    for (let z = 0; z < world.H; z++) for (let x = 0; x < world.W; x++) {
      const ch = world.ch[z * world.W + x];
      c.fillStyle = ch === '#' || ch === 'P' ? '#0a1a26' : ch === 'D' || ch === 'L' ? '#ffb347' : (ch === 'B' || ch === 'M' || ch === 'H' || ch === 'T' || ch === 'I') ? '#1d5a70' : '#0f3345';
      c.fillRect(x * sc, z * sc, sc, sc);
    }
    this.mapCache = { cv, sc };
  }

  drawMinimap(world, player, enemies) {
    if (!this.mapCache) return;
    const c = this.map, { cv, sc } = this.mapCache, R = 80;
    c.clearRect(0, 0, 160, 160);
    c.save(); c.beginPath(); c.arc(R, R, R - 1, 0, 7); c.clip();
    c.translate(R, R); c.rotate(player.yaw); c.translate(-player.x / CS * sc, -player.z / CS * sc);
    c.drawImage(cv, 0, 0);
    const dot = (x, z, col, r) => { c.fillStyle = col; c.beginPath(); c.arc(x / CS * sc, z / CS * sc, r, 0, 7); c.fill(); };
    for (const t of world.terminals) if (t.state !== 'done') dot(t.x, t.z, '#33e0ff', 3);
    for (const i of world.intel) if (!i.taken) dot(i.x, i.z, i.def.optional ? '#ffd23f' : '#4dffa0', 3);
    dot(world.exX, world.exZ, world.exActive ? '#4dffa0' : '#ff3355', 4);
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.state === S.ALERT) dot(e.x, e.z, '#ff3355', 3);
      else if (e.sees) dot(e.x, e.z, '#ffd23f', 3);
    }
    c.restore();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(R, R - 6); c.lineTo(R - 4.5, R + 5); c.lineTo(R + 4.5, R + 5); c.closePath(); c.fill();
  }
}
