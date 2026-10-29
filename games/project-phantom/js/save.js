// LocalStorage persistence with validation against corrupted / tampered data.
import { WEAPONS, WEAPON_ORDER, UPGRADES, DIFFICULTY, levelFromXp } from './data.js';

const KEY = 'projectPhantom.save.v1';

export const defaultSettings = () => ({
  sens: 1.0, adsSens: 0.7, fov: 80, volume: 0.7, quality: 'medium', invertY: false,
  difficulty: 'normal', headBob: true, showCones: true,
});

export const defaultSave = () => ({
  v: 1, credits: 0, xp: 0, maxMission: 0,           // maxMission = highest unlocked index
  owned: { spectre: true }, equipped: ['spectre'],
  upgrades: {},
  ranks: {}, best: {},                              // per mission index
  stats: { kills: 0, headshots: 0, shots: 0, hits: 0, missions: 0, deaths: 0, takedowns: 0, playtime: 0 },
  gifts: {},                                        // first-clear rewards already granted
  settings: defaultSettings(),
});

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

export function sanitize(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const s = d;
  s.credits = Math.floor(num(raw.credits, 0, 1e9, 0));
  s.xp = Math.floor(num(raw.xp, 0, 1e9, 0));
  s.maxMission = Math.floor(num(raw.maxMission, 0, 2, 0));
  if (raw.owned && typeof raw.owned === 'object') {
    for (const id of WEAPON_ORDER) if (raw.owned[id] === true) s.owned[id] = true;
  }
  s.owned.spectre = true;
  if (Array.isArray(raw.equipped)) {
    const eq = [];
    for (const id of raw.equipped) if (WEAPONS[id] && s.owned[id] && !eq.includes(id) && eq.length < 4) eq.push(id);
    if (eq.length) s.equipped = eq;
  }
  if (raw.upgrades && typeof raw.upgrades === 'object') {
    for (const id of WEAPON_ORDER) {
      const u = raw.upgrades[id];
      if (!u || typeof u !== 'object') continue;
      s.upgrades[id] = {};
      for (const k of Object.keys(UPGRADES)) s.upgrades[id][k] = Math.floor(num(u[k], 0, UPGRADES[k].max, 0));
    }
  }
  for (const k of [0, 1, 2]) {
    const r = raw.ranks && raw.ranks[k];
    if (['S', 'A', 'B', 'C'].includes(r)) s.ranks[k] = r;
    const b = raw.best && raw.best[k];
    if (typeof b === 'number' && isFinite(b) && b > 0) s.best[k] = b;
  }
  if (raw.stats && typeof raw.stats === 'object') {
    for (const k of Object.keys(s.stats)) s.stats[k] = num(raw.stats[k], 0, 1e9, 0);
  }
  if (raw.gifts && typeof raw.gifts === 'object') for (const k of [0, 1, 2]) if (raw.gifts[k] === true) s.gifts[k] = true;
  const st = raw.settings;
  if (st && typeof st === 'object') {
    const ds = s.settings;
    ds.sens = num(st.sens, 0.2, 3, ds.sens);
    ds.adsSens = num(st.adsSens, 0.2, 1.5, ds.adsSens);
    ds.fov = num(st.fov, 60, 110, ds.fov);
    ds.volume = num(st.volume, 0, 1, ds.volume);
    if (['low', 'medium', 'high'].includes(st.quality)) ds.quality = st.quality;
    if (DIFFICULTY[st.difficulty]) ds.difficulty = st.difficulty;
    ds.invertY = bool(st.invertY, ds.invertY);
    ds.headBob = bool(st.headBob, ds.headBob);
    ds.showCones = bool(st.showCones, ds.showCones);
  }
  return s;
}

export function loadSave() {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt) return { data: defaultSave(), existed: false };
    return { data: sanitize(JSON.parse(txt)), existed: true };
  } catch (e) {
    return { data: defaultSave(), existed: false };
  }
}

export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export { levelFromXp };
