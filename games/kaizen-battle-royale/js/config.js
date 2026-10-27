'use strict';
/* Kaizen Battle Royale: game data. All names are original (Japanese anime style). */

KBR.WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Shiro P9 Sidearm', cls: 'PISTOL', color: 0xb8c4d6, sound: 'pistol',
    dmg: 22, head: 2.0, rate: 0.17, mag: 12, reserve: 60, reload: 1.0,
    range: 110, fallStart: 22, minFall: 0.55,
    spread: 0.0035, bloomShot: 0.006, bloomMax: 0.028, recoilV: 0.011, recoilH: 0.004,
    pellets: 1, adsFov: 56, moveMul: 1.0, burst: [2, 3], pause: [0.5, 1.0],
  },
  rifle: {
    id: 'rifle', name: 'Sakura SR-7 Rifle', cls: 'RIFLE', color: 0xff9ec0, sound: 'rifle',
    dmg: 26, head: 2.2, rate: 0.1, mag: 30, reserve: 120, reload: 1.7,
    range: 230, fallStart: 55, minFall: 0.6,
    spread: 0.0022, bloomShot: 0.0045, bloomMax: 0.034, recoilV: 0.0135, recoilH: 0.0055,
    pellets: 1, adsFov: 46, scopeFov: 34, moveMul: 0.95, burst: [3, 6], pause: [0.35, 0.8],
  },
  smg: {
    id: 'smg', name: 'Kitsune K-40 SMG', cls: 'SMG', color: 0x5de0e6, sound: 'smg',
    dmg: 17, head: 1.9, rate: 0.065, mag: 35, reserve: 140, reload: 1.4,
    range: 105, fallStart: 16, minFall: 0.42,
    spread: 0.004, bloomShot: 0.0052, bloomMax: 0.05, recoilV: 0.0085, recoilH: 0.0085,
    pellets: 1, adsFov: 52, moveMul: 1.05, burst: [4, 8], pause: [0.3, 0.7],
  },
  shotgun: {
    id: 'shotgun', name: 'Oni Crusher Shotgun', cls: 'SHOTGUN', color: 0xff5470, sound: 'shotgun',
    dmg: 11, head: 1.6, rate: 0.78, mag: 5, reserve: 30, reload: 2.1,
    range: 48, fallStart: 5, minFall: 0.12,
    spread: 0.012, pelletSpread: 0.05, bloomShot: 0.0, bloomMax: 0.02, recoilV: 0.05, recoilH: 0.01,
    pellets: 9, adsFov: 56, moveMul: 0.95, burst: [1, 1], pause: [0.7, 1.1],
  },
  sniper: {
    id: 'sniper', name: 'Tengu Hawk Rifle', cls: 'SNIPER', color: 0xb6f36b, sound: 'sniper',
    dmg: 108, head: 2.4, rate: 1.25, mag: 5, reserve: 25, reload: 2.3,
    range: 520, fallStart: 400, minFall: 0.85,
    spread: 0.0006, bloomShot: 0.02, bloomMax: 0.05, recoilV: 0.045, recoilH: 0.006,
    pellets: 1, adsFov: 30, scopeFov: 13, moveMul: 0.85, burst: [1, 1], pause: [1.4, 2.2],
    projectile: { speed: 620, gravity: 9.8 },
  },
};

/** Loot rarity: multiplies damage; sets glow colour. */
KBR.RARITY = [
  { name: 'COMMON', color: 0xe2e8f0, dmg: 1.0 },
  { name: 'RARE', color: 0x5de0e6, dmg: 1.08 },
  { name: 'EPIC', color: 0xc084fc, dmg: 1.16 },
  { name: 'LEGENDARY', color: 0xffc857, dmg: 1.26 },
];

/** Vest: soaks 55% of incoming damage until its points run out. */
KBR.ARMOR = [0, 60, 100, 150];
KBR.ARMOR_SOAK = 0.55;

KBR.CHARACTERS = [
  {
    id: 'hikari', name: 'HIKARI', kanji: '光', skill: 'Radiant Pulse', icon: 'bolt',
    color: 0xffc857, hair: 0xffd36b, outfit: 0xf6f1e6, accent: 0xff7aa8,
    desc: 'A healing aura restores 15 HP/s and boosts sprint by 25% for 8s.',
    cooldown: 14, duration: 8, kind: 'aura',
  },
  {
    id: 'kage', name: 'KAGE', kanji: '影', skill: 'Void Dome', icon: 'shield',
    color: 0x8b7bff, hair: 0x2a2350, outfit: 0x2c2f4f, accent: 0x8b7bff,
    desc: 'A dome of void energy blocks every incoming bullet for 6s.',
    cooldown: 18, duration: 6, kind: 'dome',
  },
  {
    id: 'hayate', name: 'HAYATE', kanji: '疾', skill: 'Wind Step', icon: 'wind',
    color: 0x4fe3c1, hair: 0x39d6b6, outfit: 0x1f6f66, accent: 0xfff3a0,
    desc: '+10% passive speed. Active: dash forward and recover 60 HP.',
    cooldown: 12, duration: 0.35, kind: 'dash', passiveSpeed: 1.1,
  },
];

/**
 * Map locations. x/z in metres, island radius 500. `style` picks the building set; `pad` is the flattened
 * radius around the centre; `lift` raises the ground there (Torii Peak sits on a hill).
 */
KBR.POIS = [
  { id: 'torii', name: 'TORII PEAK', jp: '鳥居峰', x: 0, z: 0, pad: 62, lift: 11, style: 'shrine', tint: 0xe8384f, major: true },
  { id: 'tokei', name: 'TOKEI TOWER', jp: '時計塔', x: -240, z: -190, pad: 58, lift: 0, style: 'tower', tint: 0x6ea8ff, major: true },
  { id: 'sakura', name: 'SAKURA VILLAGE', jp: '桜村', x: 250, z: -210, pad: 60, lift: 0, style: 'village', tint: 0xff9ec0, major: true },
  { id: 'kojo', name: 'KOJO WORKS', jp: '工場', x: -230, z: 230, pad: 62, lift: 0, style: 'factory', tint: 0x8d99ae, major: true },
  { id: 'minato', name: 'MINATO HARBOR', jp: '港', x: 240, z: 220, pad: 60, lift: 0, style: 'harbor', tint: 0x2ec4b6, major: true },
  { id: 'neon', name: 'NEON ALLEY', jp: 'ネオン街', x: 0, z: -300, pad: 52, lift: 0, style: 'neon', tint: 0xb06cff, major: true },
  { id: 'onsen', name: 'ONSEN', jp: '温泉', x: 140, z: 105, pad: 34, lift: 0, style: 'onsen', tint: 0xffc857, major: false },
  { id: 'dojo', name: 'DOJO', jp: '道場', x: -135, z: 60, pad: 34, lift: 0, style: 'dojo', tint: 0xd9a066, major: false },
  { id: 'lighthouse', name: 'LIGHTHOUSE', jp: '灯台', x: -70, z: -425, pad: 26, lift: 0, style: 'lighthouse', tint: 0xf4f4f4, major: false },
  { id: 'rice', name: 'RICE FIELDS', jp: '田んぼ', x: 340, z: 10, pad: 40, lift: 0, style: 'farm', tint: 0xb7d968, major: false },
];

KBR.BOT_NAMES = [
  'Kitsune_Ren', 'SakuraBlade', 'NekoNinja77', 'RyuuAce', 'TsukiHunter', 'HoshiSniper', 'KazeNoYuki', 'OniMask_X',
  'Yuuki_Zero', 'ShadowKoi', 'AoiStrike', 'HanabiRush', 'KurokoKid', 'SenpaiDown', 'MochiTank', 'TengaiHero',
  'RamenRaider', 'AkaiTora', 'SoraDriver', 'MizuNoKen', 'DenkouJin', 'NightSakura', 'HikariHime', 'KumoSlicer',
  'TakoDash', 'ShishiKing', 'IchigoFox', 'ManekiMax', 'KabutoRex', 'YamabikoQ', 'TanukiPro', 'SumiRonin',
  'UmiTsuba', 'BentoBandit', 'HaikuHawk', 'KaijuKen', 'MangaMika', 'SushiSwift', 'MaruNinja', 'GinGinTora',
];

/** Bot skill presets: aim = 1/accuracy error scale, react = seconds before the first shot, sight = vision range multiplier. */
KBR.DIFFICULTY = {
  easy: { label: 'EASY', aim: 0.55, react: 1.0, sight: 0.8, dmg: 0.8 },
  normal: { label: 'NORMAL', aim: 0.85, react: 0.65, sight: 1.0, dmg: 1.0 },
  hard: { label: 'HARD', aim: 1.15, react: 0.4, sight: 1.15, dmg: 1.1 },
};

/**
 * Safe zone phases. Each circle lies fully inside the previous one. `hold` seconds with the next circle shown,
 * then `shrink` seconds of closing. `dps` is the damage per second outside the zone during that phase.
 */
KBR.ZONE = {
  start: { x: 0, z: 0, r: 480 },
  phases: [
    { r: 320, hold: 55, shrink: 34, dps: 1.5 },
    { r: 205, hold: 45, shrink: 30, dps: 3 },
    { r: 120, hold: 38, shrink: 26, dps: 5 },
    { r: 62, hold: 32, shrink: 22, dps: 8 },
    { r: 22, hold: 26, shrink: 18, dps: 12 },
    { r: 6, hold: 15, shrink: 12, dps: 18 },
  ],
};

KBR.PLANE = { altitude: 230, speed: 62, length: 1100 };
KBR.PLAYER = { hp: 150, ep: 100, maxEp: 150, walk: 6.0, sprint: 9.2, ads: 3.4, jump: 7.4, gravity: 21, radius: 0.45, stepHeight: 0.62, eye: 1.55 };
KBR.BOTS = { count: 29, hp: 150, walk: 5.2, sprint: 8.0, radius: 0.45, eye: 1.55 };

/** Quality presets. `pr` is the pixel ratio cap; `grid` the terrain cells per side; `veg` scales vegetation counts. */
KBR.QUALITY = {
  high: { label: 'HIGH', pr: 2, shadow: 2048, grid: 220, veg: 1.0, outlines: true, petals: 240, shadowDist: 130 },
  medium: { label: 'MEDIUM', pr: 1.5, shadow: 1024, grid: 160, veg: 0.7, outlines: true, petals: 120, shadowDist: 90 },
  low: { label: 'LOW', pr: 1, shadow: 0, grid: 120, veg: 0.4, outlines: false, petals: 0, shadowDist: 60 },
};

KBR.RANKS = [
  { wins: 0, name: 'ASHIGARU', jp: '足軽' },
  { wins: 1, name: 'SAMURAI', jp: '侍' },
  { wins: 3, name: 'HATAMOTO', jp: '旗本' },
  { wins: 6, name: 'DAIMYO', jp: '大名' },
  { wins: 10, name: 'SHOGUN', jp: '将軍' },
];

KBR.rankFor = (wins) => { let r = KBR.RANKS[0]; for (const k of KBR.RANKS) if (wins >= k.wins) r = k; return r; };
