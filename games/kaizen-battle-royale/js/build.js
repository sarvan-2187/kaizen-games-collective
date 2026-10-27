'use strict';
/*
 * Static world content: buildings for every named location, props, neon signs and instanced vegetation.
 * Geometry is merged into a few batches (facades, plain, signs) and instanced (trees, rocks), so the whole
 * island costs a few dozen draw calls. Every solid piece registers a collider with KBR.World.
 */
KBR.Build = (function () {
  const B = {};
  const W = KBR.World;
  let group, rngB, ramp;
  const P = { plain: null, facade: null, sign: null };
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), YA = new THREE.Vector3(0, 1, 0);
  const geos = {};
  const TILE_W = 4.0, TILE_H = 3.5;

  const col = (h) => new THREE.Color(h);
  const tint = (hex, k) => { const c = col(hex); c.multiplyScalar(k); return c.getHex(); };
  const jitter = (hex, amt) => { const c = col(hex); c.offsetHSL((rngB.next() - 0.5) * amt * 0.2, (rngB.next() - 0.5) * amt * 0.5 - 0.08, (rngB.next() - 0.5) * amt * 0.5 - 0.06); return c.getHex(); };

  function geo(name, make) { return geos[name] || (geos[name] = make()); }
  const boxGeo = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
  const cylGeo = () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 14));
  const hipGeo = () => geo('hip', () => { const g = new THREE.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI / 4); return g; });
  const prismGeo = () => geo('prism', () => {
    const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g;
  });
  const planeGeo = () => geo('plane', () => new THREE.PlaneGeometry(1, 1));

  function mat4(x, y, z, sx, sy, sz, yaw) {
    Q.setFromAxisAngle(YA, yaw || 0); return M4.compose(V.set(x, y, z), Q, S.set(sx, sy, sz));
  }
  const plain = (g, x, y, z, sx, sy, sz, color, yaw) => P.plain.add(g, mat4(x, y, z, sx, sy, sz, yaw), color);
  const box = (w, h, d, x, y, z, color, yaw) => plain(boxGeo(), x, y, z, w, h, d, color, yaw);
  const cyl = (r, h, x, y, z, color) => plain(cylGeo(), x, y, z, r, h, r, color, 0);

  /** Textured wall block: UVs follow real-world size so windows keep their proportions. */
  function wall(w, h, d, x, y, z, color) {
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    P.facade.add(boxGeo(), mat4(x, y, z, w, h, d, 0), color, (i, u, v) => { const f = Math.min(5, (i / 6) | 0); return [u * dims[f][0] / TILE_W, v * dims[f][1] / TILE_H]; });
  }
  const hipRoof = (x, y, z, w, d, h, color) => plain(hipGeo(), x, y + h / 2, z, w / 1.4142, h, d / 1.4142, color, 0);
  /** Gable roof; ridge runs along z unless `alongX`. */
  function gableRoof(x, y, z, w, d, h, color, alongX) {
    if (alongX) plain(prismGeo(), x, y, z, d, h, w, color, Math.PI / 2);
    else plain(prismGeo(), x, y, z, w, h, d, color, 0);
  }

  // ---------------------------------------------------------------- textures
  function facadeTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f3efe6'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(80,70,60,0.07)'; for (let i = 0; i < 200; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 3, 2);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 248, 256, 8); // floor band
    // window
    const wx = 77, wy = 62, ww = 102, wh = 118;
    g.fillStyle = '#5b5f6e'; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
    const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, '#9fcdf0'); gr.addColorStop(1, '#3e6b9a');
    g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(wx + 8, wy + wh - 6); g.lineTo(wx + 40, wy + 6); g.lineTo(wx + 56, wy + 6); g.lineTo(wx + 24, wy + wh - 6); g.fill();
    g.fillStyle = '#5b5f6e'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh / 2 - 2, ww, 4);
    g.fillStyle = '#d9d2c4'; g.fillRect(wx - 12, wy + wh + 6, ww + 24, 9); // sill
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  const SIGNS = ['ラーメン', '居酒屋', '酒', 'ゲーム', 'カラオケ', '電気', 'ホテル', 'KAIZEN', 'OPEN', '薬', '寿司', 'BAR', 'CLOCK', 'KOJO', 'MINATO', '桜'];
  const SIGN_COL = ['#ff5fa2', '#ffd166', '#5de0e6', '#b06cff', '#ff7a59', '#7cf08a', '#7aa8ff', '#ffffff'];
  function signAtlas() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    SIGNS.forEach((s, i) => {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
      if (s === 'CLOCK') {
        g.fillStyle = '#f7f3e8'; g.beginPath(); g.arc(x + 128, y + 64, 60, 0, TAU); g.fill();
        g.strokeStyle = '#2b2f45'; g.lineWidth = 5; g.stroke(); g.lineCap = 'round';
        for (let k = 0; k < 12; k++) { const a = k * TAU / 12; g.beginPath(); g.moveTo(x + 128 + Math.sin(a) * 50, y + 64 - Math.cos(a) * 50); g.lineTo(x + 128 + Math.sin(a) * 56, y + 64 - Math.cos(a) * 56); g.stroke(); }
        g.lineWidth = 6; g.beginPath(); g.moveTo(x + 128, y + 64); g.lineTo(x + 128 + Math.sin(-1.05) * 30, y + 64 - Math.cos(-1.05) * 30); g.stroke();
        g.lineWidth = 4; g.beginPath(); g.moveTo(x + 128, y + 64); g.lineTo(x + 128 + Math.sin(1.05) * 46, y + 64 - Math.cos(1.05) * 46); g.stroke();
        return;
      }
      g.fillStyle = '#14122a'; g.fillRect(x + 4, y + 4, 248, 120);
      const colr = SIGN_COL[i % SIGN_COL.length];
      g.strokeStyle = colr; g.lineWidth = 4; g.strokeRect(x + 10, y + 10, 236, 108);
      g.fillStyle = colr; g.shadowColor = colr; g.shadowBlur = 14; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold ' + (s.length > 3 ? 46 : 60) + 'px "Noto Sans JP","Hiragino Sans","Yu Gothic","Mona Sans",sans-serif';
      g.fillText(s, x + 128, y + 66); g.shadowBlur = 0;
    });
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  /** Sign board facing +z (or -z / ±x by yaw). */
  function sign(idx, w, h, x, y, z, yaw) {
    const col4 = idx % 4, row = Math.floor(idx / 4);
    P.sign.add(planeGeo(), mat4(x, y, z, w, h, 1, yaw), 0xffffff, (i, u, v) => [(col4 + u) / 4, 1 - (row + 1 - v) / 4]);
  }

  // ---------------------------------------------------------------- building helpers
  /** Axis-aligned building; returns {x,z,w,d,h,by}. */
  function building(x, z, w, d, floors, color, o) {
    o = o || {};
    const by = Math.max(W.heightAt(x - w / 2, z - d / 2), W.heightAt(x + w / 2, z - d / 2), W.heightAt(x - w / 2, z + d / 2), W.heightAt(x + w / 2, z + d / 2), W.heightAt(x, z));
    const h = floors * TILE_H;
    box(w + 0.6, 2.2, d + 0.6, x, by - 0.9, z, 0x8a8478); // foundation hides terrain gaps
    wall(w, h, d, x, by + h / 2, z, color);
    const roof = o.roof || 'hip', rc = o.roofColor || jitter(0x39425a, 0.25);
    if (roof === 'hip') hipRoof(x, by + h, z, w + 2.4, d + 2.4, Math.max(2.4, Math.min(w, d) * 0.3), rc);
    else if (roof === 'gable') gableRoof(x, by + h, z, w + 1.6, d + 1.6, Math.max(2.2, Math.min(w, d) * 0.34), rc, d > w ? false : true);
    else if (roof === 'sawtooth') { const n = Math.max(2, Math.floor(w / 7)); for (let i = 0; i < n; i++) gableRoof(x - w / 2 + (i + 0.5) * (w / n), by + h, z, w / n, d, 2.6, rc, false); }
    else if (roof === 'flat') { box(w + 0.8, 0.6, d + 0.8, x, by + h + 0.3, z, 0x59606e); if (rngB.chance(0.7)) box(2.4, 1.6, 2.4, x + rngB.range(-w / 3, w / 3), by + h + 1.3, z + rngB.range(-d / 3, d / 3), 0xa3a9b5); }
    const door = o.door === undefined ? 1 : o.door;
    if (door) box(1.9, 2.7, 0.3, x + (o.doorX || 0), by + 1.35, z + d / 2 + 0.05, 0x4a3a30);
    W.addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, by - 1, by + h, 'wall');
    return { x, z, w, d, h, by };
  }
  /** Low cover: a crate or stone wall the player can hop onto (top within jump reach). */
  function crate(x, z, w, h, d, color) {
    const by = W.heightAt(x, z); box(w, h, d, x, by + h / 2, z, color);
    W.addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, by - 0.5, by + h, 'crate');
  }
  function pillar(x, z, r, h, color) {
    const by = W.heightAt(x, z); cyl(r, h, x, by + h / 2, z, color); W.addCircle(x, z, r + 0.05, by - 0.5, by + h, 'pillar');
  }
  function torii(x, z, w, yawAlongX) {
    const by = W.heightAt(x, z), red = 0xe0343f, h = 6.2;
    const ax = yawAlongX ? 1 : 0, az = yawAlongX ? 0 : 1; // gate spans along this axis
    for (const s of [-1, 1]) {
      const px = x + ax * s * w / 2, pz = z + az * s * w / 2;
      cyl(0.42, h, px, by + h / 2, pz, red); cyl(0.5, 0.5, px, by + 0.25, pz, 0x222222);
      W.addCircle(px, pz, 0.5, by - 0.5, by + h, 'pillar');
    }
    box(ax ? w + 2.4 : 0.55, 0.5, az ? w + 2.4 : 0.55, x, by + h + 0.3, z, 0x1b1b1f);
    box(ax ? w + 1.2 : 0.4, 0.45, az ? w + 1.2 : 0.4, x, by + h - 1.15, z, red);
  }
  function lantern(x, z) {
    const by = W.heightAt(x, z); box(0.9, 0.5, 0.9, x, by + 0.25, z, 0x8f8f95); cyl(0.2, 1.0, x, by + 1.0, z, 0x9b9ba2);
    box(0.9, 0.7, 0.9, x, by + 1.8, z, 0xb3b3ba); box(0.55, 0.45, 0.55, x, by + 1.85, z, 0xffd98a); hipRoof(x, by + 2.15, z, 1.4, 1.4, 0.6, 0x6b6b72);
    W.addCircle(x, z, 0.5, by - 0.2, by + 2.6, 'lantern');
  }
  function stoneWall(x, z, len, alongX, h) {
    const by = W.heightAt(x, z), hh = h || 1.0, w = alongX ? len : 0.7, d = alongX ? 0.7 : len;
    box(w, hh, d, x, by + hh / 2, z, 0x9a968c); W.addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, by - 0.5, by + hh, 'crate');
  }
  function container(x, z, alongX, color, stack) {
    const by = W.heightAt(x, z), L = 12, Wd = 2.5, Hh = 2.6;
    for (let s = 0; s < (stack || 1); s++) {
      const cc = s ? jitter(color, 0.6) : color, w = alongX ? L : Wd, d = alongX ? Wd : L, y = by + Hh / 2 + s * Hh;
      box(w, Hh, d, x, y, z, cc);
      for (let k = -2; k <= 2; k++) box(alongX ? 0.22 : Wd + 0.1, Hh - 0.3, alongX ? Wd + 0.1 : 0.22, x + (alongX ? k * 2.4 : 0), y, z + (alongX ? 0 : k * 2.4), tint(cc, 0.82));
    }
    const w = alongX ? L : Wd, d = alongX ? Wd : L;
    W.addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, by - 0.5, by + Hh * (stack || 1), 'wall');
  }
  const lights = [];

  // ---------------------------------------------------------------- location builders
  const STYLE = {
    shrine(p) {
      const by = W.heightAt(p.x, p.z), x = p.x, z = p.z;
      box(46, 1.2, 36, x, by + 0.2, z - 4, 0xbdb7aa); box(52, 0.8, 42, x, by - 0.2, z - 4, 0x9d978c); // two-tier stone platform
      W.addBox(x - 23, x + 23, z - 22, z + 14, by - 1, by + 0.8, 'crate');
      const hall = building(x, z - 8, 18, 11, 1.4, 0xf6e9dd, { roof: 'none', door: 0 });
      for (let i = -3; i <= 3; i++) cyl(0.4, 4.9, x + i * 2.7, hall.by + 2.5, z - 2, 0xd62f3a);
      hipRoof(x, hall.by + hall.h, z - 8, 23, 16, 4.6, 0x2c3347); hipRoof(x, hall.by + hall.h + 4.4, z - 8, 12, 8, 3.2, 0x232a3d);
      const honden = building(x, z - 25, 9, 8, 1.2, 0xf1d9c6, { roof: 'hip', roofColor: 0x2c3347 });
      // five-storey pagoda
      const pgx = x - 26, pgz = z + 8, pby = W.heightAt(pgx, pgz);
      for (let i = 0; i < 5; i++) {
        const w = 8 - i * 1.1, y = pby + i * 5.0;
        wall(w, 3.4, w, pgx, y + 1.7 + 0.2, pgz, 0xd9423f); hipRoof(pgx, y + 3.6, pgz, w + 3.6, w + 3.6, 1.5, 0x2c3347);
      }
      cyl(0.18, 4, pgx, pby + 5 * 5.0 + 1.4, pgz, 0xf2c14e); W.addBox(pgx - 4, pgx + 4, pgz - 4, pgz + 4, pby - 1, pby + 14, 'wall');
      for (const tz of [30, 42, 54]) torii(x, z + tz, 8, true);
      for (let k = 0; k < 7; k++) { lantern(x - 6.5, z + 14 + k * 7.5); lantern(x + 6.5, z + 14 + k * 7.5); }
      for (const [dx, dz] of [[18, 10], [-14, 18], [16, -22], [-20, -14], [26, 24]]) crate(x + dx, z + dz, 3 + rngB.range(0, 2), 1.1, 2.4, 0xb88a5e);
      stoneWall(x + 22, z + 22, 12, false); stoneWall(x - 40, z + 26, 14, true);
    },
    tower(p) {
      const x = p.x, z = p.z;
      const t = building(x, z, 11, 11, 8.5, 0xdfe7f5, { roof: 'none', door: 1 });
      hipRoof(x, t.by + t.h, z, 14, 14, 11, 0x2f4a86); cyl(0.2, 5, x, t.by + t.h + 13, z, 0xf2c14e);
      box(12, 1, 12, x, t.by + t.h - 5, z, 0x4b5a86);
      for (const [sx, sz, yaw] of [[0, 5.7, 0], [0, -5.7, Math.PI], [5.7, 0, Math.PI / 2], [-5.7, 0, -Math.PI / 2]]) sign(12, 7, 3.5, x + sx, t.by + t.h - 6.5, z + sz, yaw);
      const ring = [[-27, -8, 14, 9, 3], [-24, 22, 12, 10, 4], [25, -22, 15, 10, 3], [30, 8, 10, 12, 5], [8, 28, 18, 9, 3], [-6, -29, 16, 9, 4]];
      for (const [dx, dz, w, d, f] of ring) building(x + dx, z + dz, w, d, f, jitter(p.tint, 0.5), { roof: rngB.chance(0.5) ? 'flat' : 'hip' });
      cyl(3.4, 0.9, x + 14, W.heightAt(x + 14, z - 14) + 0.45, z - 14, 0x9ad0e8); W.addCircle(x + 14, z - 14, 3.4, W.heightAt(x + 14, z - 14) - 0.5, W.heightAt(x + 14, z - 14) + 0.9, 'crate');
      for (const [dx, dz] of [[-12, 8], [18, 16], [12, -8], [-16, -16], [6, 12]]) crate(x + dx, z + dz, 2.4, 1.0, 1.4, 0x7a8aa8);
    },
    village(p) {
      const x = p.x, z = p.z;
      const spots = [[-28, -22], [0, -26], [28, -20], [-30, 4], [30, 6], [-24, 28], [2, 30], [28, 26], [-6, -6]];
      spots.forEach(([dx, dz], i) => building(x + dx + rngB.range(-3, 3), z + dz + rngB.range(-3, 3), rngB.range(9, 12.5), rngB.range(8, 10.5), i % 3 === 0 ? 2 : 1.4, jitter(i % 2 ? 0xf0d9bd : 0xe9c9a0, 0.5), { roof: 'gable', roofColor: jitter(0x4a4f63, 0.3) }));
      const wy = W.heightAt(x + 8, z + 6); cyl(1.3, 1.1, x + 8, wy + 0.55, z + 6, 0x8f8f95); W.addCircle(x + 8, z + 6, 1.4, wy - 0.5, wy + 1.1, 'crate');
      for (const [dx, dz, c] of [[14, 12, 0xd9534f], [-14, 14, 0x4f8fd9], [4, 18, 0xe0b04f], [-4, -16, 0x6fc27a]]) {
        const by = W.heightAt(x + dx, z + dz); box(3.2, 1.0, 2.0, x + dx, by + 0.5, z + dz, 0x9a7650); box(3.8, 0.2, 2.8, x + dx, by + 2.3, z + dz, c); cyl(0.07, 2.2, x + dx - 1.7, by + 1.1, z + dz - 1.1, 0x6b4a32); cyl(0.07, 2.2, x + dx + 1.7, by + 1.1, z + dz - 1.1, 0x6b4a32);
        W.addBox(x + dx - 1.6, x + dx + 1.6, z + dz - 1, z + dz + 1, by - 0.5, by + 1.0, 'crate');
      }
      torii(x, z + 40, 7, true);
      for (let k = -3; k <= 3; k += 2) lantern(x + k * 5, z + 12);
    },
    factory(p) {
      const x = p.x, z = p.z;
      building(x - 20, z - 16, 32, 14, 2.6, 0xc9ced8, { roof: 'sawtooth', roofColor: 0x6b7280, door: 0 });
      building(x + 22, z - 20, 24, 12, 2.4, 0xd7d0c2, { roof: 'gable', roofColor: 0x5a606d });
      building(x + 2, z + 22, 38, 16, 2.2, 0xc8d3d9, { roof: 'flat' });
      for (const [dx, dz] of [[38, 8], [-40, 12]]) { const by = W.heightAt(x + dx, z + dz); for (let i = 0; i < 6; i++) cyl(2.3, 5, x + dx, by + 2.5 + i * 5, z + dz, i % 2 ? 0xf5f5f5 : 0xd9423f); W.addCircle(x + dx, z + dz, 2.4, by - 1, by + 31, 'pillar'); }
      for (const [dx, dz] of [[-40, -30], [-30, -34], [38, -4]]) { const by = W.heightAt(x + dx, z + dz); cyl(5, 9, x + dx, by + 4.5, z + dz, 0xb8bfca); cyl(5.2, 0.6, x + dx, by + 9.2, z + dz, 0x8a919e); W.addCircle(x + dx, z + dz, 5.1, by - 1, by + 9.5, 'pillar'); }
      container(x - 4, z + 2, true, 0xd9534f, 1); container(x + 12, z + 4, false, 0x4f8fd9, 2); container(x - 22, z + 14, false, 0xe0b04f, 1); container(x + 30, z + 18, true, 0x6fc27a, 1);
      for (const [dx, dz] of [[-10, -4], [18, -6], [6, 8], [-32, 2], [28, -34]]) crate(x + dx, z + dz, 2.2, 1.1, 2.2, 0x9a7650);
    },
    harbor(p) {
      const x = p.x, z = p.z;
      building(x - 20, z - 18, 30, 14, 2.6, 0xd9e0e8, { roof: 'gable', roofColor: 0x4a5a78 });
      building(x - 28, z + 14, 13, 11, 3, jitter(p.tint, 0.4), { roof: 'flat' });
      const rows = [[8, -26], [8, -10], [8, 6]];
      rows.forEach(([dx, dz], r) => { for (let i = 0; i < 4; i++) container(x + dx + i * 13.5, z + dz, true, [0xd9534f, 0x4f8fd9, 0xe0b04f, 0x6fc27a, 0xb06cff][(i + r * 2) % 5], (i + r) % 3 === 0 ? 2 : 1); });
      // pier along +x into the sea (stair-stepped boxes so it is walkable)
      const pz = z + 6, by = 0.55;
      box(8, 0.5, 8, x + 40, by - 0.3, pz, 0x7a6248);
      for (let px = x + 44; px < x + 170; px += 8) { box(8.2, 0.5, 7, px, by - 0.25, pz, 0x8a6f52); W.addBox(px - 4.1, px + 4.1, pz - 3.5, pz + 3.5, -3, by, 'crate'); box(0.5, 1.2, 0.5, px, by + 0.6, pz - 3.3, 0x5c4630); box(0.5, 1.2, 0.5, px, by + 0.6, pz + 3.3, 0x5c4630); }
      for (const [bx, bz] of [[x + 110, pz - 8], [x + 150, pz + 9]]) { box(14, 1.6, 4.4, bx, 0.3, bz, 0xf0f0f0); box(5, 2.2, 3.2, bx - 2, 1.8, bz, 0xd9534f); box(14.4, 0.4, 4.6, bx, 1.1, bz, 0x2b4a7a); }
      const cby = W.heightAt(x + 6, z + 34);
      for (const sx of [-5, 5]) for (const sz of [-3, 3]) { box(0.8, 22, 0.8, x + 6 + sx, cby + 11, z + 34 + sz, 0xf2a93b); W.addCircle(x + 6 + sx, z + 34 + sz, 0.6, cby - 1, cby + 22, 'pillar'); }
      box(16, 1.2, 8, x + 6, cby + 22.5, z + 34, 0xf2a93b); box(30, 1.2, 1.6, x + 14, cby + 24, z + 34, 0xd98a1f);
    },
    neon(p) {
      const x = p.x, z = p.z, cols = [0x6a4c93, 0x2a9d8f, 0xd14d72, 0x3a86ff, 0xe09f3e, 0x7b2cbf];
      let k = 0;
      for (const side of [-1, 1]) {
        for (let dz = -38; dz < 40;) {
          const d = rngB.range(9, 14), w = rngB.range(10, 13), f = 3 + rngB.int(4);
          const bx = x + side * (7 + w / 2), bz = z + dz + d / 2;
          building(bx, bz, w, d, f, jitter(cols[k++ % cols.length], 0.25), { roof: 'flat', door: 0 });
          sign([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11][rngB.int(11)], 5.5, 2.75, bx - side * (w / 2 + 0.08), W.heightAt(bx, bz) + 6.2 + rngB.int(2) * 3.5, bz, side > 0 ? -Math.PI / 2 : Math.PI / 2);
          sign([2, 4, 8, 10][rngB.int(4)], 3.4, 1.7, bx - side * (w / 2 + 0.08), W.heightAt(bx, bz) + 2.6, bz + 3, side > 0 ? -Math.PI / 2 : Math.PI / 2);
          dz += d + rngB.range(4.5, 7);
        }
      }
      for (let dz = -30; dz <= 30; dz += 15) { const by = W.heightAt(x + 4, z + dz); box(1.0, 1.9, 0.8, x + 4, by + 0.95, z + dz, 0xff5fa2); box(0.9, 1.6, 0.05, x + 4, by + 1.05, z + dz + 0.43, 0xfff3a0); W.addBox(x + 3.5, x + 4.5, z + dz - 0.4, z + dz + 0.4, by - 0.3, by + 1.9, 'crate'); }
      for (const [dx, dz] of [[-2, -10], [2, 6], [-1, 22], [1, -26]]) crate(x + dx, z + dz, 2.0, 1.0, 1.6, 0x5a4d7a);
    },
    onsen(p) {
      const x = p.x, z = p.z;
      building(x - 6, z - 10, 18, 11, 1.4, 0xd8b88c, { roof: 'hip', roofColor: 0x4b3a33 });
      for (const [dx, dz, w, d] of [[8, 8, 10, 7], [-10, 11, 8, 6]]) { const by = W.heightAt(x + dx, z + dz); box(w + 1, 0.5, d + 1, x + dx, by + 0.15, z + dz, 0x8d8a82); box(w, 0.3, d, x + dx, by + 0.38, z + dz, 0x8fe8f5); }
      for (let a = 0; a < 30; a++) { const ang = a / 30 * TAU, fx = x + Math.cos(ang) * 30, fz = z + Math.sin(ang) * 26; if (a % 6 === 0) continue; const by = W.heightAt(fx, fz); box(1.4, 2.6, 1.4, fx, by + 1.3, fz, 0xb6c97a); W.addCircle(fx, fz, 0.9, by - 0.5, by + 2.6, 'crate'); }
      lantern(x + 12, z - 2); lantern(x - 14, z + 3); crate(x + 2, z + 4, 2.4, 1.1, 1.8, 0xa07a54);
    },
    dojo(p) {
      const x = p.x, z = p.z;
      building(x - 6, z - 8, 20, 12, 1.3, 0xe9d5b1, { roof: 'gable', roofColor: 0x4a3f3a });
      building(x + 14, z + 8, 12, 10, 1.2, 0xe2caa0, { roof: 'hip', roofColor: 0x4a3f3a });
      for (let i = 0; i < 6; i++) pillar(x - 10 + i * 4, z + 12, 0.28, 1.9, 0x9b7a55);
      torii(x - 6, z + 22, 5, true);
    },
    lighthouse(p) {
      const x = p.x, z = p.z, by = W.heightAt(x, z);
      for (let i = 0; i < 6; i++) cyl(4.2 - i * 0.28, 5, x, by + 2.5 + i * 5, z, i % 2 ? 0xd9423f : 0xf6f6f6);
      cyl(2.9, 3.2, x, by + 31.6, z, 0x9fe8f5); cyl(3.4, 0.5, x, by + 33.4, z, 0x2b2f45); plain(hipGeo(), x, by + 35, z, 3.6, 3, 3.6, 0xd9423f, 0);
      W.addCircle(x, z, 4.2, by - 1, by + 34, 'pillar');
      building(x + 12, z + 6, 9, 8, 1.2, 0xf1f1ec, { roof: 'hip', roofColor: 0xb5473d });
      crate(x - 8, z + 7, 2.4, 1.1, 1.8, 0xa07a54);
    },
    farm(p) {
      const x = p.x, z = p.z;
      building(x - 4, z - 6, 16, 11, 2, 0xc0463f, { roof: 'gable', roofColor: 0x3c3f4a });
      for (const [dx, dz] of [[14, 8], [18, -4], [-18, 8]]) { const by = W.heightAt(x + dx, z + dz); cyl(1.8, 2.4, x + dx, by + 1.2, z + dz, 0xe6c15a); plain(hipGeo(), x + dx, by + 3.2, z + dz, 3.6, 1.6, 3.6, 0xd4a93d, 0); W.addCircle(x + dx, z + dz, 1.9, by - 0.5, by + 2.6, 'crate'); }
      for (const [dx, dz] of [[-10, 14], [6, 18]]) { const by = W.heightAt(x + dx, z + dz); box(0.2, 2.2, 0.2, x + dx, by + 1.1, z + dz, 0x6b4a32); box(1.8, 0.2, 0.2, x + dx, by + 1.8, z + dz, 0x6b4a32); box(0.7, 0.9, 0.5, x + dx, by + 1.3, z + dz, 0xd9a14a); }
    },
  };

  // ---------------------------------------------------------------- vegetation
  function mergedGeo(parts) {
    const b = new GeoBatch();
    for (const p of parts) b.add(p.g, mat4(p.x || 0, p.y || 0, p.z || 0, p.sx || 1, p.sy || 1, p.sz || 1, p.yaw || 0), p.c);
    return b.build();
  }
  function treeGeos() {
    const cone = new THREE.ConeGeometry(1, 1, 9), ico = new THREE.IcosahedronGeometry(1, 1), cy = new THREE.CylinderGeometry(1, 1.25, 1, 7), cy2 = new THREE.CylinderGeometry(0.5, 0.5, 1, 5);
    const T = {};
    T.cedar = mergedGeo([{ g: cy, y: 1.6, sx: 0.3, sy: 3.2, sz: 0.3, c: 0x6b4a32 }, { g: cone, y: 4.7, sx: 2.2, sy: 3.6, sz: 2.2, c: 0x2c6b3e }, { g: cone, y: 6.8, sx: 1.7, sy: 3.4, sz: 1.7, c: 0x347a45 }, { g: cone, y: 8.7, sx: 1.2, sy: 3.0, sz: 1.2, c: 0x3d8a4f }]);
    T.broad = mergedGeo([{ g: cy, y: 1.7, sx: 0.36, sy: 3.4, sz: 0.36, c: 0x6a4a35 }, { g: ico, y: 4.7, sx: 2.4, sy: 2.0, sz: 2.4, c: 0x4fa34a }, { g: ico, x: 1.2, y: 4.2, z: 0.6, sx: 1.7, sy: 1.5, sz: 1.7, c: 0x5db856 }, { g: ico, x: -1.1, y: 5.0, z: -0.7, sx: 1.6, sy: 1.5, sz: 1.6, c: 0x449441 }]);
    T.sakura = mergedGeo([{ g: cy, y: 1.5, sx: 0.34, sy: 3.0, sz: 0.34, c: 0x4a3830 }, { g: ico, y: 4.4, sx: 2.5, sy: 1.9, sz: 2.5, c: 0xffb3cb }, { g: ico, x: 1.6, y: 3.9, z: 0.5, sx: 1.7, sy: 1.4, sz: 1.7, c: 0xff9fbf }, { g: ico, x: -1.5, y: 4.0, z: -0.6, sx: 1.8, sy: 1.5, sz: 1.8, c: 0xffc7d9 }, { g: ico, x: 0.2, y: 5.4, z: -0.9, sx: 1.5, sy: 1.2, sz: 1.5, c: 0xffa9c6 }]);
    T.maple = mergedGeo([{ g: cy, y: 1.5, sx: 0.32, sy: 3.0, sz: 0.32, c: 0x5a4034 }, { g: ico, y: 4.2, sx: 2.2, sy: 1.8, sz: 2.2, c: 0xe2572b }, { g: ico, x: 1.3, y: 3.8, z: 0.6, sx: 1.6, sy: 1.3, sz: 1.6, c: 0xf08a24 }, { g: ico, x: -1.2, y: 4.6, z: -0.5, sx: 1.5, sy: 1.3, sz: 1.5, c: 0xc9381f }]);
    const stalks = [];
    for (let i = 0; i < 8; i++) { const a = i * 0.85, r = 0.35 + (i % 3) * 0.22, h = 8 + (i % 4) * 1.2; stalks.push({ g: cy2, x: Math.cos(a) * r, z: Math.sin(a) * r, y: h / 2, sx: 0.12, sy: h, sz: 0.12, c: i % 2 ? 0x9bcf5a : 0x87c04d }); stalks.push({ g: ico, x: Math.cos(a) * r, z: Math.sin(a) * r, y: h, sx: 0.55, sy: 0.7, sz: 0.55, c: 0x5aa84c }); }
    T.bamboo = mergedGeo(stalks);
    const rock = new THREE.DodecahedronGeometry(1, 0); const rp = rock.attributes.position; for (let i = 0; i < rp.count; i++) { const k = 0.82 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.3; rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k, rp.getZ(i) * k); }
    T.rock = mergedGeo([{ g: rock, y: 0.5, sx: 1.2, sy: 0.9, sz: 1.0, c: 0x8d909b }]);
    T.bush = mergedGeo([{ g: ico, y: 0.5, sx: 1.0, sy: 0.7, sz: 1.0, c: 0x3f9747 }, { g: ico, x: 0.7, y: 0.4, z: 0.3, sx: 0.7, sy: 0.55, sz: 0.7, c: 0x4eae52 }]);
    return T;
  }
  function plantVegetation(q) {
    const T = treeGeos(), noise = makeNoise(99), r = new RNG(2024);
    const toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
    const plans = [
      { k: 'cedar', n: 560, r: 0.58, h: 9.5, forest: 1, c: 0.6 }, { k: 'broad', n: 280, r: 0.6, h: 7, forest: 0.8, c: 0.5 },
      { k: 'maple', n: 100, r: 0.55, h: 6.5, forest: 0.5, c: 0.5, near: 'torii' }, { k: 'sakura', n: 130, r: 0.55, h: 6.5, forest: 0.3, c: 0.45, near: 'sakura' },
      { k: 'bamboo', n: 70, r: 1.1, h: 11, forest: 1, c: 0.4 }, { k: 'rock', n: 150, r: 0, h: 2, forest: 0, c: 0.3, big: true }, { k: 'bush', n: 420, r: 0, h: 1, forest: 0.4, c: 0.7 },
    ];
    const P0 = KBR.POIS;
    for (const pl of plans) {
      const mats = [], cols = [], want = Math.round(pl.n * q.veg);
      let tries = 0;
      while (mats.length < want && tries++ < want * 60) {
        let x, z;
        if (pl.near && r.chance(0.55)) { const p = P0.find((o) => o.id === pl.near), a = r.next() * TAU, d = r.range(18, 80); x = p.x + Math.cos(a) * d; z = p.z + Math.sin(a) * d; }
        else { const a = r.next() * TAU, d = Math.sqrt(r.next()) * 455; x = Math.cos(a) * d; z = Math.sin(a) * d; }
        const h = W.heightAt(x, z);
        if (h < (pl.k === 'rock' ? 0.2 : 1.0)) continue;
        if (W.slopeAt(x, z) > (pl.k === 'rock' ? 0.6 : 0.2)) continue;
        if (W.roadDist(x, z) < 7) continue;
        let blocked = false;
        for (const p of P0) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.pad * (pl.near === p.id ? 0.55 : 1.0)) { blocked = true; break; } }
        if (blocked) continue;
        const dens = smoothstep(-0.1, 0.35, noise.fbm(x * 0.009 + 5, z * 0.009 - 3, 3)) * pl.forest + (1 - pl.forest) * 0.5;
        if (r.next() > dens + 0.08) continue;
        const sc = pl.k === 'rock' ? r.range(0.6, pl.big ? 2.6 : 1.4) : r.range(0.8, 1.35), yaw = r.next() * TAU;
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.15, z), new THREE.Quaternion().setFromAxisAngle(YA, yaw), new THREE.Vector3(sc, sc * (pl.k === 'rock' ? r.range(0.7, 1.1) : 1), sc)));
        const c = new THREE.Color(1, 1, 1); c.offsetHSL(r.range(-0.015, 0.015), r.range(-0.08, 0.05), r.range(-0.1, 0.08)); cols.push(c);
        if (pl.k === 'rock') { if (sc > 1.0) W.addCircle(x, z, sc * 1.05, h - 1, h + sc * 1.3, 'rock'); }
        else if (pl.r > 0) W.addCircle(x, z, pl.r * sc, h - 1, h + pl.h * sc, 'tree');
      }
      const im = new THREE.InstancedMesh(T[pl.k], toon, mats.length);
      for (let i = 0; i < mats.length; i++) { im.setMatrixAt(i, mats[i]); im.setColorAt(i, cols[i]); }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = pl.k !== 'bush'; im.receiveShadow = false; im.frustumCulled = false; im.name = 'veg-' + pl.k;
      group.add(im);
    }
  }

  B.build = function (g, q) {
    group = g; rngB = new RNG(555); ramp = W.toonRamp(4);
    P.plain = new GeoBatch(); P.facade = new GeoBatch(); P.sign = new GeoBatch();
    for (const p of KBR.POIS) { try { STYLE[p.style](p); } catch (e) { console.error('poi', p.id, e); } }
    const plainMesh = new THREE.Mesh(P.plain.build(), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
    const facadeMesh = new THREE.Mesh(P.facade.build(), new THREE.MeshToonMaterial({ vertexColors: true, map: facadeTexture(), gradientMap: ramp }));
    const signMesh = new THREE.Mesh(P.sign.build(), new THREE.MeshBasicMaterial({ map: signAtlas(), side: THREE.DoubleSide, fog: true }));
    for (const m of [plainMesh, facadeMesh]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; }
    signMesh.frustumCulled = false; plainMesh.name = 'plain'; facadeMesh.name = 'facade'; signMesh.name = 'signs';
    group.add(plainMesh, facadeMesh, signMesh);
    plantVegetation(q);
  };
  return B;
})();
