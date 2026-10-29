// Static game data: weapons, upgrades, enemy archetypes, difficulty, ranks.

export const CS = 2;            // world size of one grid cell (m)
export const WALL_H = 3.6;      // indoor wall height

export const WEAPONS = {
  spectre: {
    id: 'spectre', name: 'Spectre-9', tag: 'Suppressed pistol', cost: 0,
    dmg: 30, rate: 0.2, auto: false, range: 55, mag: 12, reserve: 60, reload: 1.3,
    recoil: 1.1, spread: 0.35, hipSpread: 1.1, noise: 8, suppressed: true, zoom: 1.3,
    color: 0x66ccff, sound: 'pistol', desc: 'Whisper-quiet sidearm. Unaware targets die to a clean head shot.',
  },
  vortex: {
    id: 'vortex', name: 'Vortex AR', tag: 'Assault rifle', cost: 350,
    dmg: 22, rate: 0.1, auto: true, range: 80, mag: 30, reserve: 150, reload: 1.9,
    recoil: 1.0, spread: 0.5, hipSpread: 2.2, noise: 42, suppressed: false, zoom: 1.6,
    color: 0x44ffcc, sound: 'rifle', desc: 'Reliable full-auto rifle. Loud. Good all-rounder when stealth fails.',
  },
  reaper: {
    id: 'reaper', name: 'Reaper SMG', tag: 'Rapid-fire SMG', cost: 650,
    dmg: 13, rate: 0.055, auto: true, range: 38, mag: 40, reserve: 200, reload: 2.1,
    recoil: 1.7, spread: 0.9, hipSpread: 3.0, noise: 38, suppressed: false, zoom: 1.35,
    color: 0xffaa33, sound: 'smg', desc: 'Huge rate of fire with heavy climb. Close-quarters shredder.',
  },
  longshot: {
    id: 'longshot', name: 'Longshot', tag: 'Precision rifle', cost: 950,
    dmg: 105, rate: 1.05, auto: false, range: 220, mag: 5, reserve: 30, reload: 2.7,
    recoil: 4.5, spread: 0.02, hipSpread: 5.5, noise: 34, suppressed: false, zoom: 3.4, scope: true,
    color: 0xff5577, sound: 'sniper', desc: 'Bolt-action. One body shot drops a guard; scope in for range.',
  },
  arc: {
    id: 'arc', name: 'Arc Caster', tag: 'Energy weapon', cost: 1300,
    dmg: 34, rate: 0.42, auto: false, range: 45, mag: 20, reserve: 80, reload: 1.9,
    recoil: 0.6, spread: 0.3, hipSpread: 1.6, noise: 14, suppressed: false, zoom: 1.4, emp: true,
    color: 0xaa66ff, sound: 'arc', desc: 'Energy bolts that fry electronics: drones, cameras and turrets are disabled.',
  },
};
export const WEAPON_ORDER = ['spectre', 'vortex', 'reaper', 'longshot', 'arc'];

export const UPGRADES = {
  dmg:  { name: 'Damage',   desc: '+12% damage per level',            max: 3, cost: [150, 300, 500] },
  mag:  { name: 'Magazine', desc: '+25% magazine & reserve per level', max: 3, cost: [120, 240, 400] },
  hand: { name: 'Handling', desc: '-12% reload time, -10% recoil',     max: 3, cost: [130, 260, 420] },
};

// sight / hearing in metres; fov = half-angle in degrees
export const ENEMY_TYPES = {
  guard: {
    id: 'guard', name: 'Patrol Guard', hp: 70, armor: 0, speed: 1.9, run: 4.3, sight: 17, fov: 55, near: 2.2,
    hearing: 1.0, dmg: 6, burst: 3, burstGap: 0.16, cooldown: 1.2, aim: 0.55, acc: 0.72, eyeH: 1.6, scale: 1,
    body: 0x24324a, accent: 0x33e0ff, score: 100,
  },
  heavy: {
    id: 'heavy', name: 'Heavy Trooper', hp: 190, armor: 0.4, speed: 1.4, run: 3.1, sight: 16, fov: 50, near: 2.0,
    hearing: 0.8, dmg: 9, burst: 5, burstGap: 0.12, cooldown: 1.7, aim: 0.7, acc: 0.78, eyeH: 1.75, scale: 1.22,
    body: 0x5a3b22, accent: 0xff9a2e, score: 200,
  },
  drone: {
    id: 'drone', name: 'Scout Drone', hp: 45, armor: 0, speed: 2.2, run: 4.2, sight: 10, fov: 180, near: 3.5,
    hearing: 0.5, dmg: 4, burst: 2, burstGap: 0.2, cooldown: 0.9, aim: 0.4, acc: 0.6, eyeH: 2.3, scale: 1,
    body: 0x39414f, accent: 0xff3355, score: 120, elec: true, flying: true, moveThreshold: 1.3,
  },
  elite: {
    id: 'elite', name: 'Elite Hunter', hp: 140, armor: 0.15, speed: 2.4, run: 5.4, sight: 22, fov: 65, near: 3.0,
    hearing: 1.35, dmg: 8, burst: 4, burstGap: 0.1, cooldown: 0.9, aim: 0.4, acc: 0.82, eyeH: 1.65, scale: 1.05,
    body: 0x1a1a24, accent: 0xff2850, score: 300,
  },
  turret: {
    id: 'turret', name: 'Sentry Turret', hp: 120, armor: 0.3, speed: 0, run: 0, sight: 20, fov: 45, near: 0,
    hearing: 0, dmg: 5, burst: 6, burstGap: 0.1, cooldown: 1.1, aim: 0.5, acc: 0.7, eyeH: 1.4, scale: 1,
    body: 0x3a3f4a, accent: 0xff3355, score: 150, elec: true, fixed: true,
  },
  camera: {
    id: 'camera', name: 'Security Camera', hp: 50, armor: 0, speed: 0, run: 0, sight: 18, fov: 24, near: 0,
    hearing: 0, dmg: 0, burst: 0, burstGap: 1, cooldown: 1, aim: 0, acc: 0, eyeH: 2.9, scale: 1,
    body: 0x2c3340, accent: 0xff2244, score: 50, elec: true, fixed: true,
  },
};

export const DIFFICULTY = {
  easy:   { name: 'Easy',   dmg: 0.7,  sight: 0.85, gain: 0.8,  hp: 0.85 },
  normal: { name: 'Normal', dmg: 1.0,  sight: 1.0,  gain: 1.0,  hp: 1.0 },
  hard:   { name: 'Hard',   dmg: 1.35, sight: 1.15, gain: 1.25, hp: 1.2 },
};

export const RANKS = [
  { min: 1000, id: 'S' }, { min: 800, id: 'A' }, { min: 600, id: 'B' }, { min: 0, id: 'C' },
];
export const RANK_VALUE = { '-': 0, C: 1, B: 2, A: 3, S: 4 };

export const levelFromXp = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 150));
export const xpForLevel = (lv) => Math.round(Math.pow(lv - 1, 2) * 150);

export const TACTICAL = { name: 'EMP Pulse', radius: 14, duration: 8, cooldown: 22 };

export const PLAYER = {
  hp: 100, armor: 50, radius: 0.32, eye: 1.65, eyeCrouch: 1.0, walk: 4.2, sprint: 6.9, crouch: 2.1,
  jump: 6.0, gravity: 18,
};
