// Campaign definitions. Maps are carved programmatically on a cell grid.
// Legend: # wall  . floor  P pillar  B crate  M machinery  H holo table
//         D door  L locked door  (T terminal / I intel pedestal are placed from the lists)
// Yaw convention (three.js): 0 faces -Z (north), -PI/2 faces +X (east), PI faces +Z (south), PI/2 faces -X (west).

const PI = Math.PI;
const N = 0, E = -PI / 2, S = PI, W = PI / 2;

class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.c = Array.from({ length: h }, () => Array(w).fill('#')); }
  set(x, z, ch) { if (x >= 0 && z >= 0 && x < this.w && z < this.h) this.c[z][x] = ch; }
  get(x, z) { return (x < 0 || z < 0 || x >= this.w || z >= this.h) ? '#' : this.c[z][x]; }
  rect(x0, z0, x1, z1, ch = '.') { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, z, ch); }
  props(ch, list) { for (const [x, z] of list) this.set(x, z, ch); }
  building(x0, z0, x1, z1, dx, dz, door = 'D') {
    this.rect(x0, z0, x1, z1, '#'); this.rect(x0 + 1, z0 + 1, x1 - 1, z1 - 1, '.'); this.set(dx, dz, door);
  }
  rows() { return this.c.map((r) => r.join('')); }
}

// ------------------------------------------------------------------ Mission 1
const M1 = {
  id: 0, name: 'Blacksite Breach', location: 'Redline Research Annex, Sub-level 4', difficulty: 1,
  theme: 'lab', W: 40, H: 28, par: 360, reward: 450, gravity: 18, ceiling: true,
  brief: 'Meridian Dynamics is hiding a weapons programme inside a decommissioned research annex. ' +
    'Slip into the facility, shut down the security terminal to open the vault, recover the classified data core, and get out through the north-west extraction bay. ' +
    'Guards are unaware of you. Keep it that way.',
  tips: ['Crouch to shrink your sound and visibility.', 'Cyan cones on the floor show what each guard can see.', 'Press E behind an unaware guard for a silent takedown.'],
  build(g) {
    g.rect(2, 19, 8, 25);                              // dock (start)
    g.rect(10, 22, 13, 22); g.set(9, 22, 'D');
    g.rect(14, 15, 31, 25);                            // main hall
    g.rect(14, 3, 22, 9);                              // security office
    g.rect(18, 10, 18, 14); g.set(18, 12, 'D');
    g.rect(26, 3, 37, 9);                              // server hall
    g.rect(29, 10, 29, 14); g.set(29, 12, 'D');
    g.rect(23, 6, 25, 6); g.set(24, 6, 'D');
    g.rect(33, 17, 38, 24);                            // vault
    g.set(32, 20, 'L');
    g.rect(36, 10, 36, 15); g.set(36, 16, 'L');
    g.rect(2, 3, 8, 9);                                // extraction bay
    g.rect(9, 6, 13, 6); g.set(11, 6, 'D');
    g.props('B', [[7, 20], [7, 21], [5, 25], [22, 17], [23, 17], [22, 18], [16, 21], [16, 22], [29, 22], [29, 23], [28, 23],
      [21, 8], [22, 8], [34, 18], [38, 23], [2, 9], [3, 9], [6, 3]]);
    g.props('P', [[19, 19], [19, 23], [26, 19], [26, 23]]);
    g.props('M', [[30, 16], [31, 16], [28, 4], [30, 4], [32, 4], [34, 4], [28, 7], [30, 7], [32, 7], [34, 7]]);
    g.props('H', [[16, 17], [15, 6]]);
  },
  start: { x: 4, z: 22, yaw: E },
  extraction: { x: 4, z: 6 },
  enemies: [
    { type: 'guard', x: 16, z: 24, patrol: [[16, 24], [29, 24], [29, 18], [16, 18]], loop: true },
    { type: 'guard', x: 21, z: 16, patrol: [[21, 16], [21, 24]] },
    { type: 'guard', x: 15, z: 4, patrol: [[15, 4], [18, 5], [19, 8], [15, 8]], loop: true },
    { type: 'guard', x: 27, z: 8, patrol: [[27, 8], [35, 8], [35, 5], [27, 5]], loop: true },
    { type: 'guard', x: 3, z: 4, patrol: [[3, 4], [7, 5], [7, 8], [3, 8]], loop: true },
    { type: 'heavy', x: 35, z: 19, patrol: [[35, 19], [37, 19], [37, 23], [35, 23]], loop: true },
  ],
  cameras: [
    { x: 22, z: 15, yaw: S, sweep: 50, period: 7, group: 'sec' },
    { x: 28, z: 25, yaw: N, sweep: 50, period: 8, group: 'sec' },
    { x: 14, z: 5, yaw: E, sweep: 45, period: 6, group: 'sec' },
  ],
  terminals: [
    { id: 'sec', x: 20, z: 4, label: 'Security terminal', action: 'unlockDoors', time: 3.5, objective: 'terminal', face: 'S' },
  ],
  intel: [
    { id: 'core', x: 36, z: 21, label: 'Classified data core', objective: 'data' },
    { id: 'logs', x: 37, z: 6, label: 'Server logs', optional: true, objective: 'intel2' },
  ],
  pickups: [
    { x: 3, z: 25, kind: 'med' }, { x: 8, z: 19, kind: 'ammo' }, { x: 15, z: 9, kind: 'med' },
    { x: 37, z: 4, kind: 'armor' }, { x: 38, z: 18, kind: 'ammo' }, { x: 14, z: 25, kind: 'ammo' },
  ],
  objectives: [
    { id: 'terminal', text: 'Disable the security terminal' },
    { id: 'data', text: 'Recover the classified data core' },
    { id: 'extract', text: 'Reach the extraction point' },
    { id: 'ghost', text: 'Remain undetected', optional: true },
    { id: 'intel2', text: 'Recover the server logs', optional: true },
  ],
};

// ------------------------------------------------------------------ Mission 2
const M2 = {
  id: 1, name: 'Neon District', location: 'Kagura Heights, Nightside Compound', difficulty: 2,
  theme: 'neon', W: 44, H: 32, par: 540, reward: 750, gravity: 18, ceiling: false,
  brief: 'Syndicate boss Voss runs his empire from a walled compound in the Kagura district. ' +
    'Steal the ledger from the annex, then neutralise Voss, either by force or by forging his clearance at his office terminal. ' +
    'Cameras cover the yard: kill them at the alarm terminal in the control annex. The exit gate opens once Voss is dealt with.',
  tips: ['Cameras raise a full alarm if they see you. Shoot them, EMP them (Q) or use the alarm terminal.', 'Drones only notice movement: freeze or crouch.', 'Heavy troopers shrug off body shots. Aim high.'],
  build(g) {
    g.rect(2, 10, 41, 29);                               // the yard
    g.building(10, 12, 17, 17, 13, 17);                  // ledger annex
    g.building(22, 12, 29, 17, 25, 17);                  // control annex
    g.building(34, 12, 40, 19, 37, 19);                  // armoury
    g.rect(14, 2, 24, 8);                                // HQ lobby
    g.rect(26, 2, 32, 8); g.set(25, 5, 'D');             // Voss' office
    g.set(19, 9, 'D'); g.set(29, 9, 'D');
    g.rect(36, 2, 41, 8); g.set(38, 9, 'L');             // exit courtyard
    for (const z of [22, 23, 24, 27, 28, 29]) g.set(10, z, '#');   // start alley wall
    g.props('B', [[6, 14], [6, 15], [7, 15], [23, 21], [24, 21], [24, 22], [32, 24], [33, 24], [33, 25], [4, 20], [36, 23],
      [16, 26], [28, 20], [12, 11], [38, 12], [26, 25], [14, 4], [14, 7], [22, 7], [27, 7]]);
    g.props('M', [[14, 24], [15, 24], [14, 25], [15, 25], [26, 27], [27, 27]]);
    g.props('P', [[9, 20], [9, 26], [30, 20], [30, 26], [20, 24], [20, 13]]);
    g.props('H', [[21, 18], [31, 14], [6, 25], [19, 3], [34, 22]]);
  },
  start: { x: 4, z: 27, yaw: E },
  extraction: { x: 39, z: 5 },
  enemies: [
    { type: 'guard', x: 12, z: 20, patrol: [[12, 20], [18, 20], [18, 26], [12, 26]], loop: true },
    { type: 'guard', x: 22, z: 10, patrol: [[22, 10], [34, 10]] },
    { type: 'guard', x: 30, z: 22, patrol: [[30, 22], [40, 22], [40, 28], [30, 28]], loop: true },
    { type: 'guard', x: 19, z: 12, patrol: [[19, 12], [19, 22]] },
    { type: 'guard', x: 16, z: 4, patrol: [[16, 5], [22, 5], [22, 3], [16, 3]], loop: true },
    { type: 'guard', x: 37, z: 4, patrol: [[37, 4], [40, 7]] },
    { type: 'guard', x: 6, z: 12, patrol: [[6, 12], [14, 10], [6, 12]] },
    { type: 'heavy', x: 19, z: 7, patrol: [[16, 6], [23, 6]] },
    { type: 'heavy', x: 33, z: 26, patrol: [[33, 26], [38, 26]] },
    { type: 'heavy', x: 29, z: 5, patrol: [[28, 4], [31, 6]], hvt: true, hp: 340, name: 'VOSS' },
    { type: 'drone', x: 8, z: 12, patrol: [[8, 12], [40, 10], [40, 28], [8, 28]], loop: true },
    { type: 'drone', x: 20, z: 18, patrol: [[20, 18], [30, 18], [30, 14], [20, 14]], loop: true },
  ],
  cameras: [
    { x: 15, z: 18, yaw: S, sweep: 55, period: 7, group: 'cams' },
    { x: 26, z: 18, yaw: S, sweep: 55, period: 8, group: 'cams' },
    { x: 36, z: 20, yaw: S, sweep: 50, period: 7, group: 'cams' },
    { x: 6, z: 10, yaw: S, sweep: 55, period: 9, group: 'cams' },
    { x: 24, z: 10, yaw: S, sweep: 60, period: 9, group: 'cams' },
  ],
  terminals: [
    { id: 'alarm', x: 27, z: 14, label: 'Alarm terminal', action: 'disableCameras', time: 4, face: 'S' },
    { id: 'voss', x: 31, z: 3, label: "Voss' terminal", action: 'bypassHVT', time: 6, objective: 'hvt', face: 'S' },
  ],
  intel: [
    { id: 'ledger', x: 14, z: 14, label: 'Encrypted ledger', objective: 'intel' },
    { id: 'chip', x: 23, z: 3, label: 'Courier chip', optional: true, objective: 'intel2' },
  ],
  pickups: [
    { x: 3, z: 29, kind: 'med' }, { x: 8, z: 11, kind: 'ammo' }, { x: 38, z: 14, kind: 'armor' }, { x: 36, z: 17, kind: 'ammo' },
    { x: 24, z: 15, kind: 'med' }, { x: 12, z: 15, kind: 'ammo' }, { x: 20, z: 6, kind: 'med' }, { x: 40, z: 28, kind: 'ammo' },
  ],
  objectives: [
    { id: 'intel', text: 'Retrieve the encrypted ledger' },
    { id: 'hvt', text: 'Neutralise Voss, or forge his clearance' },
    { id: 'extract', text: 'Escape through the exit gate' },
    { id: 'cams', text: 'Trip no security camera', optional: true },
    { id: 'intel2', text: 'Recover the courier chip', optional: true },
  ],
};

// ------------------------------------------------------------------ Mission 3
const M3 = {
  id: 2, name: 'Orbital Silence', location: 'Helios Station, Low Earth Orbit', difficulty: 3,
  theme: 'orbital', W: 40, H: 34, par: 660, reward: 1050, gravity: 9.5, ceiling: false,
  brief: 'Helios Station hosts a dormant orbital strike array: Operation Silence. ' +
    'Take the sentry grid offline from the two defence terminals, reach the command deck and download the launch codes, then fight your way out. ' +
    'Gravity is reduced. Elite hunters will flank you and they do not give up easily.',
  tips: ['Sentry turrets: use the defence terminals, an EMP (Q) or the Arc Caster.', 'The download takes ten seconds and calls reinforcements. Prepare your ground first.', 'Elites flank. Watch your back and use doors to cut sight lines.'],
  build(g) {
    g.rect(2, 26, 9, 32);                              // docking bay (start)
    g.rect(11, 29, 20, 29); g.set(10, 29, 'D');
    g.rect(20, 23, 20, 28); g.set(20, 25, 'D');
    g.rect(13, 12, 27, 22);                            // reactor hub
    g.rect(20, 9, 20, 11); g.set(20, 10, 'D');
    g.rect(13, 2, 27, 8);                              // command deck
    g.rect(10, 16, 12, 16); g.set(11, 16, 'D');
    g.rect(2, 12, 9, 20);                              // west defence room
    g.rect(28, 16, 30, 16); g.set(29, 16, 'D');
    g.rect(31, 12, 38, 20);                            // east defence room
    g.rect(5, 21, 5, 25); g.set(5, 23, 'D');
    g.rect(31, 26, 38, 32);                            // extraction bay
    g.rect(21, 28, 29, 28); g.set(30, 28, 'D');
    g.rect(35, 21, 35, 25); g.set(35, 23, 'L');
    for (let z = 16; z <= 18; z++) for (let x = 19; x <= 21; x++) g.set(x, z, 'M');   // reactor core
    g.props('B', [[15, 14], [16, 14], [24, 20], [25, 20], [6, 16], [6, 17], [34, 16], [34, 17], [4, 28], [7, 28], [33, 28],
      [16, 7], [24, 7], [3, 19], [37, 19], [36, 30]]);
    g.props('P', [[15, 20], [25, 14], [15, 18], [25, 18]]);
    g.props('H', [[16, 4], [24, 4], [7, 13], [32, 13]]);
    g.props('M', [[14, 3], [26, 3], [2, 12], [38, 12]]);
  },
  start: { x: 5, z: 30, yaw: E },
  extraction: { x: 35, z: 29 },
  enemies: [
    { type: 'guard', x: 12, z: 29, patrol: [[12, 29], [19, 29]] },
    { type: 'guard', x: 3, z: 18, patrol: [[3, 18], [8, 18], [8, 13]], loop: true },
    { type: 'guard', x: 32, z: 18, patrol: [[32, 18], [37, 18], [32, 15]], loop: true },
    { type: 'elite', x: 15, z: 15, patrol: [[15, 15], [25, 15], [25, 19], [15, 19]], loop: true },
    { type: 'elite', x: 15, z: 6, patrol: [[15, 6], [25, 6]] },
    { type: 'elite', x: 33, z: 30, patrol: [[33, 30], [37, 30], [37, 27], [33, 27]], loop: true },
    { type: 'heavy', x: 22, z: 5, patrol: [[22, 5], [18, 6]] },
    { type: 'drone', x: 14, z: 14, patrol: [[14, 14], [26, 14], [26, 20], [14, 20]], loop: true },
    { type: 'drone', x: 11, z: 16, patrol: [[11, 16], [29, 16]] },
    { type: 'turret', x: 14, z: 13, yaw: 2.4, group: 'A', sweep: 40 },
    { type: 'turret', x: 14, z: 21, yaw: 0.8, group: 'A', sweep: 40 },
    { type: 'turret', x: 26, z: 13, yaw: -2.4, group: 'B', sweep: 40 },
    { type: 'turret', x: 26, z: 21, yaw: -0.8, group: 'B', sweep: 40 },
  ],
  reinforce: [
    { type: 'elite', x: 33, z: 14 }, { type: 'elite', x: 4, z: 16 }, { type: 'elite', x: 20, z: 24 },
  ],
  cameras: [
    { x: 16, z: 12, yaw: S, sweep: 55, period: 7, group: 'cams' },
    { x: 24, z: 22, yaw: N, sweep: 55, period: 8, group: 'cams' },
  ],
  terminals: [
    { id: 'def1', x: 3, z: 14, label: 'Defence terminal A', action: 'disableTurretsA', time: 4, objective: 'defense', face: 'E' },
    { id: 'def2', x: 37, z: 14, label: 'Defence terminal B', action: 'disableTurretsB', time: 4, objective: 'defense', face: 'W' },
    { id: 'core', x: 20, z: 3, label: 'Orbital Silence core', action: 'download', time: 10, objective: 'download', face: 'S' },
  ],
  intel: [],
  pickups: [
    { x: 3, z: 32, kind: 'med' }, { x: 9, z: 26, kind: 'ammo' }, { x: 8, z: 20, kind: 'armor' }, { x: 31, z: 12, kind: 'ammo' },
    { x: 26, z: 8, kind: 'med' }, { x: 14, z: 8, kind: 'ammo' }, { x: 22, z: 20, kind: 'med' }, { x: 38, z: 32, kind: 'ammo' },
    { x: 14, z: 22, kind: 'armor' },
  ],
  objectives: [
    { id: 'defense', text: 'Disable the sentry grid', count: 2 },
    { id: 'download', text: 'Download the Orbital Silence codes' },
    { id: 'extract', text: 'Extract via the pod bay' },
    { id: 'noalarm', text: 'Never trigger the alarm', optional: true },
    { id: 'time', text: 'Finish in under 11 minutes', optional: true },
  ],
};

export const MISSIONS = [M1, M2, M3];

// Build the character grid for a mission and stamp terminals / intel pedestals.
export function buildGrid(m) {
  const g = new Grid(m.W, m.H);
  m.build(g);
  for (const t of m.terminals) g.set(t.x, t.z, 'T');
  for (const i of m.intel) g.set(i.x, i.z, 'I');
  g.set(m.start.x, m.start.z, '.');
  return g;
}
