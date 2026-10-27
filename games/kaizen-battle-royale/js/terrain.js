'use strict';
/*
 * Terrain, collision grid, ray casting, water, sky and roads.
 *
 * Coordinates: x east, z south (north is -z), y up, metres. The island is roughly 880 m across inside a
 * 1240 m terrain mesh (the rest is sea floor). heightAt() interpolates the SAME triangles the mesh renders,
 * so feet never float above or sink into the ground, whatever the mesh resolution.
 */
KBR.World = (function () {
  const W = {};
  const SIZE = 1240, HALF = SIZE / 2;
  const SEA = 0;
  let N = 160, CELL = SIZE / 160, ROW = 161, H = null, noise = null, scene = null;
  W.SIZE = SIZE; W.HALF = HALF; W.SEA = SEA;
  W.maxHeight = 40;

  // ---------------------------------------------------------------- height field
  const poiBase = [];
  function rawHeight(x, z) {
    const wob = noise.fbm(x * 0.006 + 9, z * 0.006 + 4, 3) * 46;
    const rr = Math.hypot(x, z) + wob;
    const land = 1 - smoothstep(402, 488, rr);
    const hills = noise.fbm(x * 0.0042, z * 0.0042, 4) * 0.5 + 0.5;
    const detail = noise.fbm(x * 0.016 + 30, z * 0.016 + 7, 3);
    let h = land * (2.4 + hills * hills * 25 + detail * 1.5);
    h -= (1 - land) * (2.4 + smoothstep(488, 650, rr) * 14);
    return h;
  }
  function pois() { return KBR.POIS; }
  function shapedHeight(x, z) {
    let h = rawHeight(x, z);
    const P = pois();
    for (let i = 0; i < P.length; i++) {
      const p = P[i], d = Math.hypot(x - p.x, z - p.z), end = p.pad * (p.lift > 0 ? 2.8 : 1.55);
      if (d >= end) continue;
      const target = Math.max(poiBase[i], 2.6) + p.lift;
      h = lerp(h, target, 1 - smoothstep(p.pad, end, d));
    }
    return h;
  }
  W.heightAt = function (x, z) {
    const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -16;
    const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, i = iz * ROW + ix;
    const h00 = H[i], h10 = H[i + 1], h01 = H[i + ROW], h11 = H[i + ROW + 1];
    return fx + fz <= 1 ? h00 + fx * (h10 - h00) + fz * (h01 - h00) : h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  };
  const _n = new THREE.Vector3();
  W.normalAt = function (x, z, out) {
    const e = 1.4, dx = W.heightAt(x + e, z) - W.heightAt(x - e, z), dz = W.heightAt(x, z + e) - W.heightAt(x, z - e);
    return (out || _n).set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
  };
  W.slopeAt = (x, z) => 1 - W.normalAt(x, z).y; // 0 flat .. ~0.3 steep
  W.isLand = (x, z) => W.heightAt(x, z) > 0.35;

  // ---------------------------------------------------------------- collision grid
  const GC = 20, GN = Math.ceil(SIZE / GC);
  let grid = null, stamp = 0;
  const statics = [];
  function cellRange(minX, maxX, minZ, maxZ) {
    return [Math.max(0, Math.floor((minX + HALF) / GC)), Math.min(GN - 1, Math.floor((maxX + HALF) / GC)),
      Math.max(0, Math.floor((minZ + HALF) / GC)), Math.min(GN - 1, Math.floor((maxZ + HALF) / GC))];
  }
  function insert(c) {
    const [a, b, d, e] = cellRange(c.minX, c.maxX, c.minZ, c.maxZ);
    c.cells = [];
    for (let gz = d; gz <= e; gz++) for (let gx = a; gx <= b; gx++) {
      const k = gz * GN + gx; (grid[k] || (grid[k] = [])).push(c); c.cells.push(k);
    }
    return c;
  }
  /** Axis-aligned box collider. y0/y1 are absolute heights. */
  W.addBox = function (minX, maxX, minZ, maxZ, y0, y1, tag) {
    const c = { t: 0, minX, maxX, minZ, maxZ, y0, y1, tag: tag || 'box' };
    statics.push(c); return insert(c);
  };
  /** Vertical cylinder collider (tree trunk, pillar, tank). */
  W.addCircle = function (cx, cz, r, y0, y1, tag) {
    const c = { t: 1, cx, cz, r, minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r, y0, y1, tag: tag || 'circle' };
    statics.push(c); return insert(c);
  };
  /** Oriented box (rotated wall). yaw uses three.js convention (rotation.y). */
  W.addObb = function (cx, cz, hw, hd, yaw, y0, y1, tag, owner) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw), ex = Math.abs(cs) * hw + Math.abs(sn) * hd, ez = Math.abs(sn) * hw + Math.abs(cs) * hd;
    const c = { t: 2, cx, cz, hw, hd, cs, sn, minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, y0, y1, tag: tag || 'obb', owner };
    return insert(c);
  };
  W.removeCollider = function (c) {
    if (!c || !c.cells) return;
    for (const k of c.cells) { const a = grid[k]; if (a) { const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); } }
    c.cells = null; c.dead = true;
  };
  function forNear(minX, maxX, minZ, maxZ, fn) {
    const [a, b, d, e] = cellRange(minX, maxX, minZ, maxZ);
    stamp++;
    for (let gz = d; gz <= e; gz++) for (let gx = a; gx <= b; gx++) {
      const list = grid[gz * GN + gx];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) { const c = list[i]; if (c._q !== stamp) { c._q = stamp; fn(c); } }
    }
  }

  const MOVE = { x: 0, z: 0, hit: false };
  /**
   * Pushes a circle of radius r out of every collider it overlaps. Colliders whose top is within `step`
   * of the feet are walked over, not blocked. Returns the shared MOVE object.
   */
  W.moveCircle = function (x, z, r, feetY, step, headY) {
    MOVE.hit = false;
    for (let pass = 0; pass < 2; pass++) {
      forNear(x - r, x + r, z - r, z + r, (c) => {
        if (c.y1 <= feetY + step || c.y0 >= headY) return;
        if (c.t === 0) {
          const px = clamp(x, c.minX, c.maxX), pz = clamp(z, c.minZ, c.maxZ);
          let dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          MOVE.hit = true;
          if (d2 < 1e-8) { // centre inside the box: leave through the nearest face
            const l = x - c.minX, rr = c.maxX - x, t = z - c.minZ, b = c.maxZ - z, m = Math.min(l, rr, t, b);
            if (m === l) x = c.minX - r; else if (m === rr) x = c.maxX + r; else if (m === t) z = c.minZ - r; else z = c.maxZ + r;
          } else { const d = Math.sqrt(d2), o = r - d; x += (dx / d) * o; z += (dz / d) * o; }
        } else if (c.t === 1) {
          const dx = x - c.cx, dz = z - c.cz, rr = r + c.r, d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) return;
          MOVE.hit = true;
          const d = Math.sqrt(d2) || 1e-4, o = rr - d; x += (dx / d) * o; z += (dz / d) * o;
        } else {
          const dx = x - c.cx, dz = z - c.cz, lx = c.cs * dx - c.sn * dz, lz = c.sn * dx + c.cs * dz;
          const px = clamp(lx, -c.hw, c.hw), pz = clamp(lz, -c.hd, c.hd), ddx = lx - px, ddz = lz - pz, d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r * r) return;
          MOVE.hit = true;
          let nx, nz;
          if (d2 < 1e-8) { // centre inside: exit through the nearest local face
            const a = c.hw - Math.abs(lx), b = c.hd - Math.abs(lz);
            if (a < b) { nx = Math.sign(lx) || 1; nz = 0; lx = Math.sign(lx || 1) * (c.hw + r); } else { nx = 0; nz = Math.sign(lz) || 1; lz = Math.sign(lz || 1) * (c.hd + r); }
          } else { const d = Math.sqrt(d2), o = r - d; lx += (ddx / d) * o; lz += (ddz / d) * o; }
          x = c.cx + c.cs * lx + c.sn * lz; z = c.cz - c.sn * lx + c.cs * lz;
        }
      });
    }
    MOVE.x = x; MOVE.z = z; return MOVE;
  };
  /** Is a circle free of colliders that would block something standing at feetY? */
  W.circleFree = function (x, z, r, feetY, step) {
    let free = true;
    forNear(x - r, x + r, z - r, z + r, (c) => {
      if (!free || c.y1 <= feetY + step) return;
      if (c.t === 0) { const dx = x - clamp(x, c.minX, c.maxX), dz = z - clamp(z, c.minZ, c.maxZ); if (dx * dx + dz * dz < r * r) free = false; }
      else if (c.t === 1) { const rr = r + c.r; if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < rr * rr) free = false; }
      else {
        const dx = x - c.cx, dz = z - c.cz, lx = c.cs * dx - c.sn * dz, lz = c.sn * dx + c.cs * dz;
        const ddx = lx - clamp(lx, -c.hw, c.hw), ddz = lz - clamp(lz, -c.hd, c.hd); if (ddx * ddx + ddz * ddz < r * r) free = false;
      }
    });
    return free;
  };
  /** Surface height under (x,z) for something whose feet are at feetY: terrain, or a box top it can step onto. */
  W.groundY = function (x, z, feetY, step) {
    let g = W.heightAt(x, z);
    forNear(x - 0.3, x + 0.3, z - 0.3, z + 0.3, (c) => {
      if (c.t !== 0 || c.y1 > feetY + step || c.y1 <= g) return;
      if (x >= c.minX - 0.12 && x <= c.maxX + 0.12 && z >= c.minZ - 0.12 && z <= c.maxZ + 0.12) g = c.y1;
    });
    return g;
  };

  // ---------------------------------------------------------------- ray casting
  const HIT = { t: 0, type: '', c: null, nx: 0, ny: 1, nz: 0 };
  const _ln = new THREE.Vector3();
  function rayBox(ox, oy, oz, dx, dy, dz, minX, maxX, y0, y1, minZ, maxZ, maxT) {
    let tmin = 0, tmax = maxT, axis = -1;
    // slab per axis
    let t1, t2, inv;
    if (Math.abs(dx) < 1e-9) { if (ox < minX || ox > maxX) return -1; } else { inv = 1 / dx; t1 = (minX - ox) * inv; t2 = (maxX - ox) * inv; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) { tmin = t1; axis = 0; } if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return -1; } else { inv = 1 / dy; t1 = (y0 - oy) * inv; t2 = (y1 - oy) * inv; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) { tmin = t1; axis = 1; } if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    if (Math.abs(dz) < 1e-9) { if (oz < minZ || oz > maxZ) return -1; } else { inv = 1 / dz; t1 = (minZ - oz) * inv; t2 = (maxZ - oz) * inv; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) { tmin = t1; axis = 2; } if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    rayBox.axis = axis; return tmin;
  }
  W.rayBox = rayBox;

  function hitCollider(c, ox, oy, oz, dx, dy, dz, maxT) {
    if (c.t === 0) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, c.minX, c.maxX, c.y0, c.y1, c.minZ, c.maxZ, maxT);
      if (t < 0) return -1;
      const a = rayBox.axis; HIT.nx = a === 0 ? -Math.sign(dx) : 0; HIT.ny = a === 1 ? -Math.sign(dy) : 0; HIT.nz = a === 2 ? -Math.sign(dz) : 0;
      return t;
    }
    if (c.t === 1) {
      const fx = ox - c.cx, fz = oz - c.cz, a = dx * dx + dz * dz;
      if (a < 1e-12) return -1;
      const b = fx * dx + fz * dz, cc = fx * fx + fz * fz - c.r * c.r;
      let disc = b * b - a * cc;
      if (disc < 0) return -1;
      disc = Math.sqrt(disc);
      let t = (-b - disc) / a;
      if (t < 0) t = (-b + disc) / a;
      if (t < 0 || t > maxT) return -1;
      const y = oy + dy * t; if (y < c.y0 || y > c.y1) return -1;
      const px = fx + dx * t, pz = fz + dz * t, l = Math.hypot(px, pz) || 1; HIT.nx = px / l; HIT.ny = 0; HIT.nz = pz / l;
      return t;
    }
    const rx = ox - c.cx, rz = oz - c.cz;
    const lox = c.cs * rx - c.sn * rz, loz = c.sn * rx + c.cs * rz, ldx = c.cs * dx - c.sn * dz, ldz = c.sn * dx + c.cs * dz;
    const t = rayBox(lox, oy, loz, ldx, dy, ldz, -c.hw, c.hw, c.y0, c.y1, -c.hd, c.hd, maxT);
    if (t < 0) return -1;
    const a = rayBox.axis, lnx = a === 0 ? -Math.sign(ldx) : 0, lnz = a === 2 ? -Math.sign(ldz) : 0;
    HIT.nx = c.cs * lnx + c.sn * lnz; HIT.nz = -c.sn * lnx + c.cs * lnz; HIT.ny = a === 1 ? -Math.sign(dy) : 0;
    return t;
  }

  function rayTerrain(ox, oy, oz, dx, dy, dz, maxT) {
    if (oy > W.maxHeight && dy >= 0) return -1;
    let t = 0, prevT = 0, prevF = oy - W.heightAt(ox, oz);
    if (prevF < 0) return 0;
    while (t < maxT) {
      t = Math.min(maxT, t + clamp(prevF * 0.55, 0.8, 7));
      const f = oy + dy * t - W.heightAt(ox + dx * t, oz + dz * t);
      if (f < 0) { // crossed the surface: bisect
        let a = prevT, b = t;
        for (let i = 0; i < 7; i++) { const m = (a + b) * 0.5; if (oy + dy * m - W.heightAt(ox + dx * m, oz + dz * m) < 0) b = m; else a = m; }
        return (a + b) * 0.5;
      }
      prevT = t; prevF = f;
      if (oy + dy * t > W.maxHeight && dy > 0) return -1;
    }
    return -1;
  }
  /**
   * Casts a ray (direction must be normalised). Returns the shared HIT object ({t,type,c,nx,ny,nz}) or null.
   * `skipTerrain` is used for line-of-sight checks that only care about solid objects.
   */
  W.raycast = function (ox, oy, oz, dx, dy, dz, maxT, skipTerrain) {
    let best = maxT, c0 = null, type = '', nx = 0, ny = 1, nz = 0;
    // walk the grid cells the ray crosses
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const steps = Math.max(1, Math.ceil(Math.hypot(ex - ox, ez - oz) / (GC * 0.8)));
    stamp++;
    let lastK = -1;
    for (let s = 0; s <= steps; s++) {
      const k = s / steps, px = ox + (ex - ox) * k, pz = oz + (ez - oz) * k;
      // check the cell and its neighbours so grazing rays near cell borders are not missed
      const gx = Math.floor((px + HALF) / GC), gz = Math.floor((pz + HALF) / GC);
      if (gx * 1000 + gz === lastK && steps > 1) continue;
      lastK = gx * 1000 + gz;
      for (let jz = gz - 1; jz <= gz + 1; jz++) for (let jx = gx - 1; jx <= gx + 1; jx++) {
        if (jx < 0 || jz < 0 || jx >= GN || jz >= GN) continue;
        const list = grid[jz * GN + jx];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c._r === stamp) continue;
          c._r = stamp;
          const t = hitCollider(c, ox, oy, oz, dx, dy, dz, best);
          if (t >= 0 && t < best) { best = t; c0 = c; type = c.tag; nx = HIT.nx; ny = HIT.ny; nz = HIT.nz; }
        }
      }
    }
    if (!skipTerrain) {
      const t = rayTerrain(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) { best = t; c0 = null; type = 'terrain'; const n = W.normalAt(ox + dx * t, oz + dz * t); nx = n.x; ny = n.y; nz = n.z; }
    }
    if (best >= maxT) return null;
    HIT.t = best; HIT.type = type; HIT.c = c0; HIT.nx = nx; HIT.ny = ny; HIT.nz = nz;
    return HIT;
  };
  /** True if nothing solid lies between a and b (used for bot line of sight). */
  W.hasLOS = function (ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return !W.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, false);
  };

  // ---------------------------------------------------------------- roads
  W.roads = [];
  const roadSamples = [];
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)];
  }
  function planRoads() {
    const P = Object.fromEntries(KBR.POIS.map((p) => [p.id, p]));
    const links = [['torii', 'tokei'], ['torii', 'sakura'], ['torii', 'kojo'], ['torii', 'minato'], ['torii', 'neon'], ['neon', 'tokei'], ['neon', 'sakura'],
      ['tokei', 'kojo'], ['sakura', 'minato'], ['kojo', 'minato'], ['torii', 'onsen'], ['torii', 'dojo'], ['onsen', 'minato'], ['sakura', 'rice'], ['neon', 'lighthouse'], ['dojo', 'kojo']];
    const r = new RNG(77);
    for (const [a, b] of links) {
      const A = P[a], B = P[b], dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      const off = r.range(-28, 28), mx = (A.x + B.x) / 2 - uz * off, mz = (A.z + B.z) / 2 + ux * off;
      const s = [A.x + ux * A.pad * 0.35, A.z + uz * A.pad * 0.35], e = [B.x - ux * B.pad * 0.35, B.z - uz * B.pad * 0.35];
      const pts = [s, [lerp(s[0], mx, 0.5), lerp(s[1], mz, 0.5)], [mx, mz], [lerp(mx, e[0], 0.5), lerp(mz, e[1], 0.5)], e];
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)], seg = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 6));
        for (let k = 0; k < seg; k++) out.push(catmull(p0, p1, p2, p3, k / seg));
      }
      out.push(e);
      W.roads.push(out);
      for (const q of out) roadSamples.push(q);
    }
  }
  /** Distance from (x,z) to the nearest road centre line (m). */
  W.roadDist = function (x, z) {
    let best = 1e9;
    for (let i = 0; i < roadSamples.length; i++) { const q = roadSamples[i], d = (q[0] - x) * (q[0] - x) + (q[1] - z) * (q[1] - z); if (d < best) best = d; }
    return Math.sqrt(best);
  };

  W.poiAt = function (x, z) {
    let best = null, bd = 1e9;
    for (const p of KBR.POIS) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.pad * 1.5 && d < bd) { bd = d; best = p; } }
    return best;
  };
  W.nearestPoi = function (x, z) {
    let best = KBR.POIS[0], bd = 1e9;
    for (const p of KBR.POIS) { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = p; } }
    return best;
  };

  // ---------------------------------------------------------------- meshes
  function detailTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), img = g.createImageData(128, 128), n = makeNoise(5);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const v = 0.78 + 0.22 * (n.fbm(x * 0.09, y * 0.09, 3) * 0.5 + 0.5) + (Math.random() - 0.5) * 0.05, i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 0, 1) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function toonRamp(steps) {
    const data = new Uint8Array(steps); for (let i = 0; i < steps; i++) data[i] = Math.round(255 * (0.42 + 0.58 * (i / (steps - 1))));
    const t = new THREE.DataTexture(data, steps, 1, THREE.LuminanceFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
  }
  W.toonRamp = toonRamp;

  const _c = new THREE.Color();
  function paintTerrain() {
    const col = new Float32Array((N + 1) * (N + 1) * 3), n2 = makeNoise(21), forestNoise = makeNoise(99), farm = KBR.POIS.find((p) => p.id === 'farm');
    for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
      const i = iz * ROW + ix, x = ix * CELL - HALF, z = iz * CELL - HALF, h = H[i];
      const hx = H[iz * ROW + Math.min(N, ix + 1)] - H[iz * ROW + Math.max(0, ix - 1)], hz = H[Math.min(N, iz + 1) * ROW + ix] - H[Math.max(0, iz - 1) * ROW + ix];
      const slope = Math.hypot(hx, hz) / (2 * CELL);
      const v = n2.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5, v2 = n2.fbm(x * 0.07 + 40, z * 0.07, 2) * 0.5 + 0.5;
      // base: sand -> grass, with a warm/cool variation
      _c.setRGB(0.33 + 0.16 * v, 0.58 + 0.12 * v - 0.06 * v2, 0.26 + 0.07 * v);
      const forest = smoothstep(-0.1, 0.35, forestNoise.fbm(x * 0.009 + 5, z * 0.009 - 3, 3));
      _c.lerp(new THREE.Color(0.2, 0.43, 0.22), forest * 0.45 * smoothstep(1.2, 3, h));
      const sand = [0.93, 0.85, 0.64];
      if (h < 2.0) {
        const k = smoothstep(0.5, 2.0, h);
        _c.setRGB(lerp(sand[0], _c.r, k), lerp(sand[1], _c.g, k), lerp(sand[2], _c.b, k));
      }
      if (h < 0.05) { // sea floor: sand fading to deep teal; foam line at the shore
        const d = clamp(-h / 7, 0, 1);
        _c.setRGB(lerp(0.9, 0.12, d), lerp(0.84, 0.46, d), lerp(0.66, 0.6, d));
        const foam = smoothstep(-0.55, -0.12, h) * (1 - smoothstep(-0.12, 0.05, h));
        _c.lerp(new THREE.Color(1, 1, 1), foam * 0.75);
      }
      if (h > 14) _c.lerp(new THREE.Color(0.52, 0.56, 0.42), smoothstep(14, 24, h) * 0.6);
      if (slope > 0.5) _c.lerp(new THREE.Color(0.6, 0.57, 0.52), smoothstep(0.5, 0.95, slope) * 0.85); // exposed rock
      // town pads: packed earth / stone
      for (const p of KBR.POIS) {
        const d = Math.hypot(x - p.x, z - p.z), k = 1 - smoothstep(p.pad * 0.55, p.pad * 1.0, d);
        if (k > 0 && p.style !== 'farm') _c.lerp(new THREE.Color(p.style === 'village' ? 0.82 : 0.66, p.style === 'village' ? 0.7 : 0.62, p.style === 'village' ? 0.6 : 0.56), k * 0.55);
      }
      if (farm) { // flooded rice paddies: green / water-blue checkerboard
        const d = Math.hypot(x - farm.x, z - farm.z);
        if (d < farm.pad * 1.2) {
          const cx = Math.floor((x - farm.x) / 14), cz = Math.floor((z - farm.z) / 14), alt = (cx + cz) & 1, k = 1 - smoothstep(farm.pad * 0.9, farm.pad * 1.2, d);
          _c.lerp(alt ? new THREE.Color(0.55, 0.85, 0.32) : new THREE.Color(0.52, 0.8, 0.78), k * 0.7);
        }
      }
      const rd = W.roadDist(x, z);
      if (rd < 5.5) _c.lerp(new THREE.Color(0.5, 0.47, 0.42), 1 - smoothstep(3, 5.5, rd));
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    return col;
  }

  function buildTerrainMesh(q) {
    const pos = new Float32Array((N + 1) * (N + 1) * 3), nor = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2);
    for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
      const i = iz * ROW + ix, x = ix * CELL - HALF, z = iz * CELL - HALF;
      pos[i * 3] = x; pos[i * 3 + 1] = H[i]; pos[i * 3 + 2] = z; uv[i * 2] = x / 14; uv[i * 2 + 1] = z / 14;
      const hx = H[iz * ROW + Math.min(N, ix + 1)] - H[iz * ROW + Math.max(0, ix - 1)], hz = H[Math.min(N, iz + 1) * ROW + ix] - H[Math.max(0, iz - 1) * ROW + ix];
      const sx = (Math.min(N, ix + 1) - Math.max(0, ix - 1)) * CELL, sz = (Math.min(N, iz + 1) - Math.max(0, iz - 1)) * CELL;
      const nx = -hx / sx, nz = -hz / sz, l = Math.hypot(nx, 1, nz);
      nor[i * 3] = nx / l; nor[i * 3 + 1] = 1 / l; nor[i * 3 + 2] = nz / l;
    }
    const idx = new (((N + 1) * (N + 1) > 65535) ? Uint32Array : Uint16Array)(N * N * 6);
    let k = 0;
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const a = iz * ROW + ix, b = a + 1, c = a + ROW, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; // matches heightAt()'s diagonal
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(paintTerrain(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, map: detailTexture(), gradientMap: toonRamp(5) });
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = 'terrain';
    return m;
  }

  function roadTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#4a4e5a'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 160; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    g.fillStyle = '#f2e9c8'; g.fillRect(62, 8, 4, 50); // dashed centre line
    g.fillStyle = '#c9ccd4'; g.fillRect(4, 0, 3, 128); g.fillRect(121, 0, 3, 128);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function buildRoadMesh() {
    const pos = [], uv = [], idx = [], nor = [], halfW = 3.3;
    let base = 0;
    for (const pts of W.roads) {
      let dist = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], r = pts[Math.max(0, i - 1)];
        let tx = q[0] - r[0], tz = q[1] - r[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
        for (const side of [-1, 1]) {
          const x = p[0] - tz * halfW * side, z = p[1] + tx * halfW * side, y = Math.max(W.heightAt(x, z), 0.12) + 0.14;
          pos.push(x, y, z); nor.push(0, 1, 0); uv.push(side < 0 ? 0 : 1, dist / 12);
        }
        if (i > 0) { const a = base + (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      base += pts.length * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshToonMaterial({ map: roadTexture(), gradientMap: toonRamp(5), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true; m.name = 'roads';
    return m;
  }

  function waterNormalMap() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), img = g.createImageData(256, 256), n = makeNoise(8);
    const h = (x, y) => n.fbm(x * 0.045, y * 0.045, 3);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), i = (y * 256 + x) * 4;
      img.data[i] = clamp(128 + dx * 900, 0, 255); img.data[i + 1] = clamp(128 + dy * 900, 0, 255); img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function cloudTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d'), img = g.createImageData(512, 512), n = makeNoise(13);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = n.fbm(x * 0.012, y * 0.012, 5) * 0.5 + 0.5, a = smoothstep(0.52, 0.75, v), i = (y * 512 + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 252; img.data[i + 2] = 250; img.data[i + 3] = a * 235;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  const SKY_VERT = 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }';
  const SKY_FRAG = `varying vec3 vDir; uniform vec3 sunDir;
    void main(){
      vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
      vec3 horizon = vec3(0.86,0.93,0.98), mid = vec3(0.56,0.79,0.97), zenith = vec3(0.26,0.52,0.9);
      vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h)); col = mix(col, zenith, smoothstep(0.18, 0.85, h));
      float sd = max(dot(d, normalize(sunDir)), 0.0);
      col += vec3(1.0,0.92,0.72) * (pow(sd, 1100.0) * 4.0 + pow(sd, 10.0) * 0.22 + pow(sd, 3.0) * 0.06);
      col = mix(col, horizon, smoothstep(0.0, -0.25, d.y));
      gl_FragColor = vec4(col, 1.0);
    }`;

  W.sunDir = new THREE.Vector3(0.5, 0.72, 0.38).normalize();
  let sky, clouds, water, deep, sun, hemi, fuji, waterNormal;

  function buildEnvironment(q) {
    scene.background = new THREE.Color(0xdcecf8);
    scene.fog = new THREE.FogExp2(0xd3e7f4, 0.00092);
    hemi = new THREE.HemisphereLight(0xcfe8ff, 0x7d8c5a, 0.58); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff0d4, 0.92);
    sun.position.copy(W.sunDir).multiplyScalar(300);
    scene.add(sun); scene.add(sun.target);
    if (q.shadow) {
      sun.castShadow = true; sun.shadow.mapSize.set(q.shadow, q.shadow);
      const s = sun.shadow.camera, d = q.shadowDist; s.left = -d; s.right = d; s.top = d; s.bottom = -d; s.near = 10; s.far = 800;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35;
    }
    sky = new THREE.Mesh(new THREE.SphereGeometry(2300, 24, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { sunDir: { value: W.sunDir } }, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10; scene.add(sky);
    const ct = cloudTexture(); ct.repeat.set(3, 3);
    clouds = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    clouds.rotation.x = -Math.PI / 2; clouds.position.y = 520; clouds.renderOrder = -9; scene.add(clouds);
    waterNormal = waterNormalMap(); waterNormal.repeat.set(90, 90);
    deep = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: 0x1f78a8 })); deep.rotation.x = -Math.PI / 2; deep.position.y = -17; scene.add(deep);
    water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x57c4ea, roughness: 0.16, metalness: 0.02, transparent: true, opacity: 0.74, normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35) }));
    water.rotation.x = -Math.PI / 2; water.position.y = SEA - 0.05; scene.add(water);
    // Mt. Kaizen: a distant snow-capped volcano for the skyline
    const fg = new THREE.ConeGeometry(640, 640, 36, 6, true), cp = fg.attributes.position, cc = [], fn = makeNoise(31);
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i) / 640 + 0.5, ang = Math.atan2(cp.getZ(i), cp.getX(i)), ridge = fn.noise2(ang * 3, y * 4) * 0.05;
      const snow = smoothstep(0.64 + ridge, 0.74 + ridge, y), haze = smoothstep(0.55, 0.0, y) * 0.55;
      cc.push(lerp(lerp(0.30, 0.82, haze), 0.97, snow), lerp(lerp(0.36, 0.9, haze), 0.98, snow), lerp(lerp(0.55, 0.96, haze), 1, snow));
    }
    fg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    fuji = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })); fuji.position.set(-980, 300, -1080); scene.add(fuji);
  }

  W.updateEnv = function (dt, focus, t) {
    waterNormal.offset.x = (t * 0.004) % 1; waterNormal.offset.y = (t * 0.0027) % 1;
    clouds.position.x = focus.x; clouds.position.z = focus.z;
    clouds.material.map.offset.x = (t * 0.0006) % 1;
    clouds.material.map.offset.y = (-focus.z / 5200 * 3) % 1; clouds.material.map.offset.x += focus.x / 5200 * 3;
    sky.position.set(focus.x, 0, focus.z);
    water.position.x = Math.round(focus.x / 40) * 40; water.position.z = Math.round(focus.z / 40) * 40;
  };
  /** Keeps the shadow frustum centred on the player and snapped to shadow-map texels to stop shimmering. */
  W.updateShadow = function (focus, q) {
    if (!sun.castShadow) return;
    const texel = (q.shadowDist * 2) / q.shadow, sx = Math.round(focus.x / texel) * texel, sz = Math.round(focus.z / texel) * texel;
    sun.target.position.set(sx, focus.y, sz);
    sun.position.set(sx + W.sunDir.x * 300, focus.y + W.sunDir.y * 300, sz + W.sunDir.z * 300);
  };
  W.setShadows = function (size) {
    if (!sun) return;
    sun.castShadow = size > 0;
    if (size > 0 && sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  };

  /** Builds terrain data and meshes. `sceneRef` is the THREE.Scene; returns the group holding static meshes. */
  W.init = function (sceneRef, q, seed) {
    scene = sceneRef; noise = makeNoise(seed || 1337);
    N = q.grid; CELL = SIZE / N; ROW = N + 1; H = new Float32Array(ROW * ROW);
    // POI base heights first (shapedHeight needs them)
    poiBase.length = 0;
    for (const p of KBR.POIS) poiBase.push(rawHeight(p.x, p.z));
    for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) H[iz * ROW + ix] = shapedHeight(ix * CELL - HALF, iz * CELL - HALF);
    let mx = -99; for (let i = 0; i < H.length; i++) if (H[i] > mx) mx = H[i];
    W.maxHeight = mx + 40;
    grid = new Array(GN * GN);
    planRoads();
    const group = new THREE.Group(); group.name = 'static';
    scene.add(group);
    buildEnvironment(q);
    group.add(buildTerrainMesh(q)); group.add(buildRoadMesh());
    W.group = group;
    return group;
  };
  W.rng = (seed) => new RNG(seed);
  return W;
})();
