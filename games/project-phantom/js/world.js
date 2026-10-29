// Level construction, grid collision, 3D grid raycasting and A* pathfinding.
import { CS } from './data.js';

const THREE = window.THREE;
const STEP = 0.35;          // max height the player/enemies can step onto
const BIG = 99;

export const THEMES = {
  lab: {
    fog: 0x07121c, fogD: 0.034, wallH: 3.6, ceil: true, wall: '#2b3b4e', trim: '#37e8ff', floor: '#17222d', floorLine: '#2c4256',
    hemiSky: 0x78b6d8, hemiGround: 0x101a24, hemiI: 1.05, sun: 0xaee0ff, sunI: 0.45, neon: [0x33eaff, 0x33eaff, 0x3f8cff], hum: 52,
    skyline: false, wallEmis: 1.0,
  },
  neon: {
    fog: 0x120824, fogD: 0.016, wallH: 7.5, ceil: false, wall: '#1a1830', trim: '#ff2fb6', floor: '#14121f', floorLine: '#2a2644',
    hemiSky: 0x7a5cc8, hemiGround: 0x150c24, hemiI: 1.05, sun: 0xb18cff, sunI: 0.5, neon: [0xff2fb6, 0x2ff0ff, 0xb066ff, 0xffd23f], hum: 60,
    skyline: true, wallEmis: 1.0, rain: true,
  },
  orbital: {
    fog: 0x050a14, fogD: 0.015, wallH: 4.8, ceil: false, wall: '#3a4658', trim: '#7fd0ff', floor: '#1b2330', floorLine: '#35465e',
    hemiSky: 0x9ec4ff, hemiGround: 0x0b101a, hemiI: 1.0, sun: 0xffffff, sunI: 0.6, neon: [0x9fe0ff, 0x6fb4ff, 0xff3355], hum: 46,
    skyline: false, wallEmis: 1.0, space: true,
  },
};

function canvasTex(w, h, draw, repeat = null, srgb = true, aniso = 4) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

const hash = (x, z, s = 0) => {
  let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};

export class World {
  constructor(scene, mission, grid, quality, renderer) {
    this.scene = scene;
    this.m = mission;
    this.theme = THEMES[mission.theme];
    this.quality = quality;
    this.renderer = renderer;
    this.W = mission.W; this.H = mission.H;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.disposables = [];
    this.spinners = [];
    this.floaters = [];
    this.ceilY = mission.ceiling ? this.theme.wallH : 1000;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const n = this.W * this.H;
    this.ch = new Array(n);
    this.hgt = new Float32Array(n);
    this.nav = new Uint8Array(n);
    this.cellDoor = new Int16Array(n).fill(-1);
    for (let z = 0; z < this.H; z++) for (let x = 0; x < this.W; x++) {
      const c = grid.get(x, z); const i = z * this.W + x;
      this.ch[i] = c;
      this.hgt[i] = { '#': BIG, P: BIG, B: 1.2, M: 2.4, H: 1.0, T: 1.25, I: 0.9, D: BIG, L: BIG }[c] || 0;
      this.nav[i] = (c === '.' || c === 'D' || c === 'L') ? 1 : 0;
    }
    // path search scratch
    this._g = new Float32Array(n); this._par = new Int32Array(n); this._stamp = new Uint32Array(n); this._cur = 0;
    this._hk = []; this._hv = [];

    this.doors = [];
    this.terminals = [];
    this.intel = [];
    this.pickups = [];
    this.neonCount = 0;
    this.onDoor = null;

    this._environment();
    this._materials();
    this._floorAndCeiling();
    this._walls();
    this._props();
    this._doors();
    this._terminals();
    this._intel();
    this._pickups();
    this._extraction();
    this._sky();
  }

  // ------------------------------------------------------------ helpers
  idx(cx, cz) { return cz * this.W + cx; }
  cx(x) { return Math.floor(x / CS); }
  center(c) { return (c + 0.5) * CS; }
  inB(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.W && cz < this.H; }
  track(o) { this.disposables.push(o); return o; }
  add(o) { this.group.add(o); return o; }

  // ------------------------------------------------------------ materials
  _materials() {
    const T = this.theme, a = this.aniso;
    const wallH = T.wallH;
    // wall colour + emissive maps
    const neonCols = T.neon.map((c) => '#' + new THREE.Color(c).getHexString());
    const isCity = this.m.theme === 'neon';
    this.wallMap = this.track(canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = T.wall; g.fillRect(0, 0, w, h);
      if (isCity) {
        for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 10 + Math.random() * 40, 3); }
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 4);
        for (let y = 20; y < h; y += 64) for (let x = 16; x < w; x += 48) { g.fillStyle = 'rgba(8,6,20,0.8)'; g.fillRect(x, y, 26, 30); }
      } else {
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 4;
        g.strokeRect(2, 2, w - 4, h - 4); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
        g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 8; i++) { g.fillRect(14 + (i % 4) * 62, 20 + Math.floor(i / 4) * 128, 8, 8); }
        for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      }
    }, [1, wallH / CS], true, a));
    this.wallEmis = this.track(canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      if (isCity) {
        for (let y = 20; y < h; y += 64) for (let x = 16; x < w; x += 48) {
          if (Math.random() < 0.55) { g.fillStyle = Math.random() < 0.3 ? neonCols[Math.floor(Math.random() * neonCols.length)] : '#ffe9a8'; g.globalAlpha = 0.35 + Math.random() * 0.5; g.fillRect(x, y, 26, 30); }
        }
        g.globalAlpha = 1;
      } else {
        g.fillStyle = T.trim; g.globalAlpha = 0.9; g.fillRect(4, h / 2 - 2, w - 8, 4); g.globalAlpha = 0.55;
        g.fillRect(4, 4, w - 8, 2); g.fillRect(4, h - 6, w - 8, 2);
      }
    }, [1, wallH / CS], true, a));
    this.wallMat = this.track(new THREE.MeshStandardMaterial({
      map: this.wallMap, emissiveMap: this.wallEmis, emissive: 0xffffff, emissiveIntensity: isCity ? 0.9 : 0.55, roughness: 0.6, metalness: 0.45, envMap: this.envMap, envMapIntensity: 0.7,
    }));

    this.floorMap = this.track(canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = T.floor; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
      g.strokeStyle = T.floorLine; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, h - 2);
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.fillStyle = T.trim; g.globalAlpha = 0.18; g.fillRect(w / 2 - 3, h / 2 - 3, 6, 6);
    }, [this.W / 2, this.H / 2], true, a));
    this.floorMat = this.track(new THREE.MeshStandardMaterial({ map: this.floorMap, roughness: 0.42, metalness: 0.55, envMap: this.envMap, envMapIntensity: 0.55 }));

    this.crateMap = this.track(canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#3a4350'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#4a5666'; g.fillRect(8, 8, w - 16, h - 16);
      g.strokeStyle = '#1b2028'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = '#e8b21e'; for (let i = -4; i < 8; i++) { g.save(); g.translate(i * 22, h - 22); g.rotate(-0.6); g.fillRect(0, 0, 12, 40); g.restore(); }
      g.fillStyle = '#10151c'; g.fillRect(0, h - 26, w, 3); g.fillRect(0, h - 4, w, 4);
    }, null, true, a));
    this.crateEmis = this.track(canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = T.trim; g.globalAlpha = 0.8; g.fillRect(12, 12, w - 24, 3); g.fillRect(12, 22, 30, 3);
    }, null, true, a));
    this.crateMat = this.track(new THREE.MeshStandardMaterial({ map: this.crateMap, emissiveMap: this.crateEmis, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.55, metalness: 0.5, envMap: this.envMap, envMapIntensity: 0.6 }));

    this.machMap = this.track(canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#242c38'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#18202a'; for (let y = 30; y < h - 30; y += 14) g.fillRect(18, y, w - 36, 6);
      g.strokeStyle = '#0c1118'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    }, null, true, a));
    this.machEmis = this.track(canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) { g.fillStyle = ['#33ff99', '#ffaa22', '#33e0ff', '#ff3355'][i % 4]; g.globalAlpha = 0.9; g.fillRect(12 + i * 18, 10, 8, 8); }
      g.globalAlpha = 0.6; g.fillStyle = T.trim; g.fillRect(10, h - 22, w - 20, 4);
    }, null, true, a));
    this.machMat = this.track(new THREE.MeshStandardMaterial({ map: this.machMap, emissiveMap: this.machEmis, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.5, metalness: 0.6, envMap: this.envMap, envMapIntensity: 0.6 }));
    this.darkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.5, metalness: 0.6, envMap: this.envMap }));
  }

  _environment() {
    // tiny procedural environment map for metallic reflections
    this.envMap = null;
    try {
      const es = new THREE.Scene();
      const sph = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshBasicMaterial({
        side: THREE.BackSide, map: canvasTex(8, 64, (g, w, h) => {
          const gr = g.createLinearGradient(0, 0, 0, h);
          gr.addColorStop(0, '#6a82a0'); gr.addColorStop(0.5, '#2a3446'); gr.addColorStop(1, '#0a0e14'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        }),
      }));
      es.add(sph);
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ color: this.theme.neon[i % this.theme.neon.length], side: THREE.DoubleSide }));
        p.position.set(Math.cos(i * 1.05) * 8, 2 + (i % 3), Math.sin(i * 1.05) * 8); p.lookAt(0, 0, 0); es.add(p);
      }
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.envRT = pm.fromScene(es, 0.04);
      this.envMap = this.envRT.texture;
      pm.dispose();
      sph.geometry.dispose(); sph.material.map.dispose(); sph.material.dispose();
    } catch (e) { this.envMap = null; }
  }

  _floorAndCeiling() {
    const w = this.W * CS, h = this.H * CS;
    const fg = this.track(new THREE.PlaneGeometry(w, h));
    const floor = new THREE.Mesh(fg, this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(w / 2, 0, h / 2); floor.receiveShadow = true;
    this.add(floor);
    if (this.m.ceiling) {
      const cm = this.track(new THREE.MeshStandardMaterial({
        map: this.track(canvasTex(128, 128, (g, ww, hh) => {
          g.fillStyle = '#1a232e'; g.fillRect(0, 0, ww, hh); g.strokeStyle = '#0a0f15'; g.lineWidth = 4; g.strokeRect(0, 0, ww, hh);
        }, [this.W / 2, this.H / 2], true, this.aniso)),
        emissiveMap: this.track(canvasTex(128, 128, (g, ww, hh) => {
          g.fillStyle = '#000'; g.fillRect(0, 0, ww, hh); g.fillStyle = '#bfefff'; g.fillRect(34, 50, 60, 28);
        }, [this.W / 2, this.H / 2], true, this.aniso)),
        emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.8, metalness: 0.2,
      }));
      const ceil = new THREE.Mesh(fg, cm);
      ceil.rotation.x = Math.PI / 2; ceil.position.set(w / 2, this.theme.wallH, h / 2);
      this.add(ceil);
    }
  }

  // ------------------------------------------------------------ walls, strips, props
  _walls() {
    const T = this.theme, H = T.wallH;
    const wallCells = [], pillars = [];
    const exposed = (cx, cz) => {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (this.inB(nx, nz) && this.nav[this.idx(nx, nz)] || (this.inB(nx, nz) && ['B', 'M', 'H', 'T', 'I', 'P'].includes(this.ch[this.idx(nx, nz)]))) return true;
      }
      return false;
    };
    for (let z = 0; z < this.H; z++) for (let x = 0; x < this.W; x++) {
      const c = this.ch[this.idx(x, z)];
      if (c === '#' && exposed(x, z)) wallCells.push([x, z]);
      else if (c === 'P') pillars.push([x, z]);
    }
    const wg = this.track(new THREE.BoxGeometry(CS, H, CS));
    const wm = new THREE.InstancedMesh(wg, this.wallMat, wallCells.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    wallCells.forEach(([x, z], i) => {
      m4.makeTranslation(this.center(x), H / 2, this.center(z)); wm.setMatrixAt(i, m4);
      const v = 0.85 + hash(x, z, 1) * 0.3; wm.setColorAt(i, col.setRGB(v, v, v));
    });
    wm.castShadow = true; wm.receiveShadow = true;
    this.add(wm);

    // pillars
    if (pillars.length) {
      const pg = this.track(new THREE.BoxGeometry(1.1, H, 1.1));
      const pm = new THREE.InstancedMesh(pg, this.wallMat, pillars.length);
      pillars.forEach(([x, z], i) => { m4.makeTranslation(this.center(x), H / 2, this.center(z)); pm.setMatrixAt(i, m4); pm.setColorAt(i, col.setRGB(1, 1, 1)); });
      pm.castShadow = true; pm.receiveShadow = true;
      this.add(pm);
    }

    // neon strips on exposed wall faces + floor glow pools
    const strips = []; // {x,y,z,sx,sy,sz,color}
    const glows = [];
    const faces = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    wallCells.forEach(([cx, cz]) => {
      faces.forEach(([dx, dz], fi) => {
        const nx = cx + dx, nz = cz + dz;
        if (!this.inB(nx, nz) || !this.nav[this.idx(nx, nz)]) return;
        const r = hash(cx, cz, fi + 7);
        if (r > (this.m.theme === 'neon' ? 0.4 : 0.3)) return;
        const colHex = T.neon[Math.floor(hash(cx, cz, fi + 99) * T.neon.length)];
        const px = this.center(cx) + dx * (CS / 2 + 0.03), pz = this.center(cz) + dz * (CS / 2 + 0.03);
        const vertical = this.m.theme === 'neon' && hash(cx, cz, fi + 3) < 0.5;
        const along = dx !== 0 ? [0.07, 0.07, 1.5] : [1.5, 0.07, 0.07];
        if (vertical) strips.push({ x: px, y: 2.2, z: pz, sx: dx !== 0 ? 0.07 : 0.1, sy: 3.4, sz: dz !== 0 ? 0.07 : 0.1, color: colHex });
        else strips.push({ x: px, y: this.m.theme === 'neon' ? 1.2 + hash(cx, cz, 5) * 3 : 2.5, z: pz, sx: along[0], sy: along[1], sz: along[2], color: colHex });
        glows.push({ x: this.center(cx) + dx * (CS / 2 + 0.9), z: this.center(cz) + dz * (CS / 2 + 0.9), color: colHex });
      });
    });
    pillars.forEach(([x, z]) => {
      const colHex = T.neon[Math.floor(hash(x, z, 4) * T.neon.length)];
      for (const y of [0.25, 1.9]) strips.push({ x: this.center(x), y, z: this.center(z), sx: 1.18, sy: 0.07, sz: 1.18, color: colHex });
      glows.push({ x: this.center(x), z: this.center(z), color: colHex });
    });
    const sg = this.track(new THREE.BoxGeometry(1, 1, 1));
    const sm = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const si = new THREE.InstancedMesh(sg, sm, Math.max(1, strips.length));
    strips.forEach((s, i) => {
      m4.compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion(), new THREE.Vector3(s.sx, s.sy, s.sz));
      si.setMatrixAt(i, m4); si.setColorAt(i, col.set(s.color));
    });
    si.count = strips.length;
    this.add(si);

    // soft light pools on the floor
    if (glows.length) {
      const gt = this.track(canvasTex(64, 64, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }, null, false));
      const gg = this.track(new THREE.PlaneGeometry(2.6, 2.6));
      const gm = this.track(new THREE.MeshBasicMaterial({ map: gt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 }));
      const gi = new THREE.InstancedMesh(gg, gm, glows.length);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      glows.forEach((s, i) => {
        m4.compose(new THREE.Vector3(s.x, 0.02, s.z), q, new THREE.Vector3(1, 1, 1)); gi.setMatrixAt(i, m4); gi.setColorAt(i, col.set(s.color));
      });
      gi.renderOrder = 1;
      this.add(gi);
    }
    this.neonCount = strips.length;
  }

  _props() {
    const list = (ch) => { const r = []; for (let z = 0; z < this.H; z++) for (let x = 0; x < this.W; x++) if (this.ch[this.idx(x, z)] === ch) r.push([x, z]); return r; };
    const m4 = new THREE.Matrix4();
    const crates = list('B');
    if (crates.length) {
      const g = this.track(new THREE.BoxGeometry(1.7, 1.2, 1.7));
      const im = new THREE.InstancedMesh(g, this.crateMat, crates.length);
      crates.forEach(([x, z], i) => {
        m4.makeRotationY((hash(x, z, 2) - 0.5) * 0.25); m4.setPosition(this.center(x), 0.6, this.center(z)); im.setMatrixAt(i, m4);
      });
      im.castShadow = true; im.receiveShadow = true; this.add(im);
    }
    const machs = list('M');
    if (machs.length) {
      const g = this.track(new THREE.BoxGeometry(1.8, 2.4, 1.8));
      const im = new THREE.InstancedMesh(g, this.machMat, machs.length);
      machs.forEach(([x, z], i) => { m4.makeTranslation(this.center(x), 1.2, this.center(z)); im.setMatrixAt(i, m4); });
      im.castShadow = true; im.receiveShadow = true; this.add(im);
      const rg = this.track(new THREE.TorusGeometry(0.55, 0.06, 6, 16));
      machs.forEach(([x, z], i) => {
        if (hash(x, z, 8) > 0.55) return;
        const rm = this.track(new THREE.MeshBasicMaterial({ color: this.theme.neon[i % this.theme.neon.length] }));
        const ring = new THREE.Mesh(rg, rm); ring.position.set(this.center(x), 2.5, this.center(z)); ring.rotation.x = Math.PI / 2;
        this.add(ring); this.spinners.push({ o: ring, ax: 'z', s: 1.2 + hash(x, z, 9) * 1.5 });
      });
    }
    // holo tables
    const holos = list('H');
    if (holos.length) {
      const bg = this.track(new THREE.CylinderGeometry(0.75, 0.9, 1.0, 10));
      const hg = this.track(new THREE.IcosahedronGeometry(0.38, 1));
      const dg = this.track(new THREE.CircleGeometry(0.7, 20));
      holos.forEach(([x, z], i) => {
        const col = this.theme.neon[i % this.theme.neon.length];
        const b = new THREE.Mesh(bg, this.darkMat); b.position.set(this.center(x), 0.5, this.center(z)); b.castShadow = true; this.add(b);
        const dm = this.track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        const d = new THREE.Mesh(dg, dm); d.rotation.x = -Math.PI / 2; d.position.set(this.center(x), 1.01, this.center(z)); this.add(d);
        const hm = this.track(new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        const h = new THREE.Mesh(hg, hm); h.position.set(this.center(x), 1.65, this.center(z)); this.add(h);
        this.spinners.push({ o: h, ax: 'y', s: 0.9 }); this.floaters.push({ o: h, base: 1.65, a: 0.07, f: 1.6, p: i });
      });
    }
  }

  // ------------------------------------------------------------ doors
  _doors() {
    const seen = new Set();
    const g = this.track(new THREE.BoxGeometry(1, 1, 1));
    for (let z = 0; z < this.H; z++) for (let x = 0; x < this.W; x++) {
      const i = this.idx(x, z); const c = this.ch[i];
      if (c !== 'D' && c !== 'L') continue;
      if (seen.has(i)) continue;
      const door = { id: this.doors.length, cells: [], open: false, locked: c === 'L', anim: 0, idleT: 0, meshes: [], x: 0, z: 0 };
      // group contiguous door cells
      const stack = [[x, z]]; seen.add(i);
      while (stack.length) {
        const [cx, cz] = stack.pop(); const ci = this.idx(cx, cz);
        door.cells.push(ci); this.cellDoor[ci] = door.id;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, nz = cz + dz, ni = this.inB(nx, nz) ? this.idx(nx, nz) : -1;
          if (ni >= 0 && !seen.has(ni) && (this.ch[ni] === 'D' || this.ch[ni] === 'L')) { seen.add(ni); stack.push([nx, nz]); }
        }
      }
      for (const ci of door.cells) {
        const cx = ci % this.W, cz = Math.floor(ci / this.W);
        const wallX = this.hgt[this.idx(cx - 1, cz)] >= BIG && this.hgt[this.idx(cx + 1, cz)] >= BIG;
        const mat = this.track(new THREE.MeshStandardMaterial({
          color: 0x2a3340, roughness: 0.4, metalness: 0.7, emissive: door.locked ? 0xff2244 : 0x33e0ff, emissiveIntensity: 0.0, envMap: this.envMap,
        }));
        const panel = new THREE.Mesh(g, mat);
        const th = 0.34, H = this.theme.wallH;
        panel.scale.set(wallX ? CS : th, H, wallX ? th : CS);
        panel.position.set(this.center(cx), H / 2, this.center(cz));
        panel.castShadow = true;
        // glowing frame light (child of the scaled panel, so sizes are in panel-local units)
        const lm = this.track(new THREE.MeshBasicMaterial({ color: door.locked ? 0xff2244 : 0x33e0ff }));
        const light = new THREE.Mesh(g, lm);
        light.scale.set(wallX ? 0.8 : 1.3, 0.12 / H, wallX ? 1.3 : 0.8);
        light.position.set(0, (1.7 - H / 2) / H, 0);
        panel.add(light);
        this.add(panel);
        door.meshes.push({ panel, mat, lm, baseY: H / 2 });
      }
      door.x = (door.cells.reduce((a, c) => a + (c % this.W), 0) / door.cells.length + 0.5) * CS;
      door.z = (door.cells.reduce((a, c) => a + Math.floor(c / this.W), 0) / door.cells.length + 0.5) * CS;
      this.doors.push(door);
    }
  }

  setDoorOpen(door, open) {
    if (door.open === open) return;
    door.open = open; door.idleT = 0;
    for (const ci of door.cells) this.hgt[ci] = open ? 0 : BIG;
    if (this.onDoor) this.onDoor(door, open);
  }

  setDoorLocked(door, locked) {
    door.locked = locked;
    for (const m of door.meshes) m.lm.color.setHex(locked ? 0xff2244 : 0x33e0ff);
  }

  doorAt(x, z) { const ci = this.cellDoor[this.idx(this.cx(x), this.cx(z))]; return ci >= 0 ? this.doors[ci] : null; }

  /** Open every door whose centre is within r of (x,z). Used by enemies. */
  openDoorsNear(x, z, r) {
    for (const d of this.doors) {
      if (d.open) { d.idleT = 0; continue; }
      const dx = d.x - x, dz = d.z - z;
      if (dx * dx + dz * dz < r * r) this.setDoorOpen(d, true);
    }
  }

  // ------------------------------------------------------------ interactables
  _terminals() {
    const mk = (t) => {
      const cx = t.x, cz = t.z;
      const dirs = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
      let face = t.face || 'S';
      const open = (f) => { const [dx, dz] = dirs[f]; return this.inB(cx + dx, cz + dz) && this.nav[this.idx(cx + dx, cz + dz)]; };
      if (!open(face)) face = ['S', 'N', 'E', 'W'].find(open) || 'S';
      const [fx, fz] = dirs[face];
      const grp = new THREE.Group();
      grp.position.set(this.center(cx), 0, this.center(cz));
      grp.rotation.y = Math.atan2(fx, fz);
      const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.2, 1.1, 0.9)), this.darkMat); base.position.y = 0.55; base.castShadow = true; grp.add(base);
      const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 112;
      const tex = new THREE.CanvasTexture(canvas); tex.encoding = THREE.sRGBEncoding; this.track(tex);
      const scr = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.1, 0.64)), this.track(new THREE.MeshBasicMaterial({ map: tex })));
      scr.position.set(0, 1.35, 0.1); scr.rotation.x = -0.25; grp.add(scr);
      const frame = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.2, 0.74, 0.12)), this.darkMat); frame.position.set(0, 1.35, 0.03); frame.rotation.x = -0.25; grp.add(frame);
      this.add(grp);
      const rec = { def: t, x: this.center(cx), z: this.center(cz), cx, cz, fx, fz, canvas, tex, state: 'idle', progress: 0, redraw: true, face };
      return rec;
    };
    this.terminals = this.m.terminals.map(mk);
    for (const t of this.terminals) this.drawTerminal(t);
  }

  drawTerminal(t) {
    const g = t.canvas.getContext('2d'), w = t.canvas.width, h = t.canvas.height;
    g.fillStyle = '#031018'; g.fillRect(0, 0, w, h);
    const done = t.state === 'done', col = done ? '#4dff9a' : (t.state === 'hacking' ? '#ffd23f' : '#33e0ff');
    g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = col; g.font = 'bold 15px monospace'; g.textAlign = 'center';
    g.fillText(t.def.label.toUpperCase().slice(0, 20), w / 2, 28);
    g.font = '13px monospace';
    g.fillText(done ? 'ACCESS GRANTED' : t.state === 'hacking' ? 'BREACHING...' : 'LOCKED', w / 2, 52);
    g.strokeRect(24, 72, w - 48, 14);
    g.fillRect(26, 74, (w - 52) * (done ? 1 : t.progress), 10);
    g.globalAlpha = 0.3; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.globalAlpha = 1;
    t.tex.needsUpdate = true;
  }

  _intel() {
    const cg = this.track(new THREE.OctahedronGeometry(0.28, 0));
    const pg = this.track(new THREE.CylinderGeometry(0.4, 0.5, 0.9, 10));
    const bg = this.track(new THREE.CylinderGeometry(0.32, 0.32, 3.2, 12, 1, true));
    this.intel = this.m.intel.map((d) => {
      const col = d.optional ? 0xffd23f : 0x55ffb0;
      const p = new THREE.Mesh(pg, this.darkMat); p.position.set(this.center(d.x), 0.45, this.center(d.z)); this.add(p);
      const chip = new THREE.Mesh(cg, this.track(new THREE.MeshBasicMaterial({ color: col, wireframe: false })));
      chip.position.set(this.center(d.x), 1.3, this.center(d.z)); this.add(chip);
      const beam = new THREE.Mesh(bg, this.track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
      beam.position.set(this.center(d.x), 2.4, this.center(d.z)); this.add(beam);
      this.spinners.push({ o: chip, ax: 'y', s: 2.2 }); this.floaters.push({ o: chip, base: 1.3, a: 0.1, f: 2.2, p: d.x });
      return { def: d, x: this.center(d.x), z: this.center(d.z), meshes: [chip, beam], taken: false };
    });
  }

  _pickups() {
    const cols = { med: 0x44ff88, ammo: 0xffc233, armor: 0x44aaff };
    const geo = this.track(new THREE.BoxGeometry(0.42, 0.3, 0.3));
    const geoA = this.track(new THREE.OctahedronGeometry(0.28));
    this.pickups = this.m.pickups.map((p) => {
      const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x20262e, emissive: cols[p.kind], emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.5 }));
      const mesh = new THREE.Mesh(p.kind === 'armor' ? geoA : geo, mat);
      mesh.position.set(this.center(p.x), 0.6, this.center(p.z)); this.add(mesh);
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(0.42, 0.5, 20)), this.track(new THREE.MeshBasicMaterial({ color: cols[p.kind], transparent: true, opacity: 0.6, side: THREE.DoubleSide })));
      ring.rotation.x = -Math.PI / 2; ring.position.set(this.center(p.x), 0.03, this.center(p.z)); this.add(ring);
      this.spinners.push({ o: mesh, ax: 'y', s: 1.8 }); this.floaters.push({ o: mesh, base: 0.65, a: 0.06, f: 2.5, p: p.x });
      return { kind: p.kind, x: this.center(p.x), z: this.center(p.z), meshes: [mesh, ring], taken: false };
    });
  }

  _extraction() {
    const e = this.m.extraction, x = this.center(e.x), z = this.center(e.z);
    this.exMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(1.5, 1.8, 36)), this.exMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.04, z); this.add(ring);
    this.exBeamMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const beam = new THREE.Mesh(this.track(new THREE.CylinderGeometry(1.6, 1.6, 6, 24, 1, true)), this.exBeamMat);
    beam.position.set(x, 3, z); this.add(beam);
    this.exX = x; this.exZ = z; this.exRing = ring;
    this.exActive = false;
  }

  setExtractionActive(on) {
    this.exActive = on;
    const c = on ? 0x44ffaa : 0xff3355;
    this.exMat.color.setHex(c); this.exBeamMat.color.setHex(c);
  }

  // ------------------------------------------------------------ sky & distant scenery
  _sky() {
    const T = this.theme, w = this.W * CS, h = this.H * CS;
    this.skyObjs = [];
    if (T.skyline) {
      this.scene.background = new THREE.Color(0x0e0620);
      const sky = new THREE.Mesh(this.track(new THREE.SphereGeometry(300, 24, 16)), this.track(new THREE.MeshBasicMaterial({
        side: THREE.BackSide, fog: false, depthWrite: false,
        map: this.track(canvasTex(8, 256, (g, ww, hh) => {
          const gr = g.createLinearGradient(0, 0, 0, hh);
          gr.addColorStop(0, '#05020f'); gr.addColorStop(0.55, '#1c0a3c'); gr.addColorStop(0.78, '#6a1a7a'); gr.addColorStop(0.9, '#c43a8a'); gr.addColorStop(1, '#2a1030');
          g.fillStyle = gr; g.fillRect(0, 0, ww, hh);
        }, null, true, 1)),
      })));
      sky.position.set(w / 2, 0, h / 2); this.add(sky); this.sky = sky;
      // distant towers
      const n = 70, bg = this.track(new THREE.BoxGeometry(1, 1, 1));
      const bm = this.track(new THREE.MeshStandardMaterial({ map: this.wallMap, emissiveMap: this.wallEmis, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.8, metalness: 0.2, fog: false }));
      const im = new THREE.InstancedMesh(bg, bm, n); const m4 = new THREE.Matrix4(); const col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + hash(i, 1) * 0.1, r = 85 + hash(i, 2) * 70;
        const bw = 8 + hash(i, 3) * 14, bh = 30 + hash(i, 4) * 90;
        m4.compose(new THREE.Vector3(w / 2 + Math.cos(a) * r * 1.3, bh / 2 - 2, h / 2 + Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(bw, bh, bw));
        im.setMatrixAt(i, m4); const v = 0.5 + hash(i, 5) * 0.6; im.setColorAt(i, col.setRGB(v, v * (0.7 + hash(i, 6) * 0.4), v));
      }
      im.frustumCulled = false; this.add(im);
    } else if (T.space) {
      this.scene.background = new THREE.Color(0x02040a);
      const stars = new THREE.Mesh(this.track(new THREE.SphereGeometry(400, 24, 16)), this.track(new THREE.MeshBasicMaterial({
        side: THREE.BackSide, fog: false, depthWrite: false,
        map: this.track(canvasTex(1024, 512, (g, ww, hh) => {
          g.fillStyle = '#01030a'; g.fillRect(0, 0, ww, hh);
          for (let i = 0; i < 900; i++) { const s = Math.random(); g.fillStyle = `rgba(255,255,255,${0.3 + s * 0.7})`; g.fillRect(Math.random() * ww, Math.random() * hh, s > 0.93 ? 2 : 1, s > 0.93 ? 2 : 1); }
          const nb = g.createRadialGradient(ww * 0.3, hh * 0.4, 10, ww * 0.3, hh * 0.4, 260);
          nb.addColorStop(0, 'rgba(80,60,200,0.25)'); nb.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = nb; g.fillRect(0, 0, ww, hh);
        }, null, true, 1)),
      })));
      stars.position.set(w / 2, 0, h / 2); this.add(stars); this.sky = stars;
      const planet = new THREE.Mesh(this.track(new THREE.SphereGeometry(160, 40, 28)), this.track(new THREE.MeshBasicMaterial({
        fog: false,
        map: this.track(canvasTex(512, 256, (g, ww, hh) => {
          g.fillStyle = '#0b3a7a'; g.fillRect(0, 0, ww, hh);
          for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(${40 + Math.random() * 60},${120 + Math.random() * 80},${60 + Math.random() * 50},${0.35 + Math.random() * 0.4})`; g.beginPath(); g.ellipse(Math.random() * ww, Math.random() * hh, 10 + Math.random() * 50, 4 + Math.random() * 18, Math.random() * 3, 0, 7); g.fill(); }
          for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.35})`; g.beginPath(); g.ellipse(Math.random() * ww, Math.random() * hh, 20 + Math.random() * 70, 2 + Math.random() * 6, Math.random() * 0.4, 0, 7); g.fill(); }
        }, null, true, 1)),
      })));
      planet.position.set(w * 0.2, -110, h * 1.4);
      this.add(planet);
      const atmo = new THREE.Mesh(this.track(new THREE.SphereGeometry(166, 32, 20)), this.track(new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.18, side: THREE.BackSide, fog: false, blending: THREE.AdditiveBlending, depthWrite: false })));
      atmo.position.copy(planet.position); this.add(atmo);
    } else {
      this.scene.background = new THREE.Color(this.theme.fog);
    }
  }

  // ------------------------------------------------------------ per-frame
  update(dt, t, actors) {
    for (const s of this.spinners) s.o.rotation[s.ax] += s.s * dt;
    for (const f of this.floaters) f.o.position.y = f.base + Math.sin(t * f.f + f.p) * f.a;
    // beacon pulse
    const pulse = 0.65 + Math.sin(t * 4) * 0.25;
    this.exMat.opacity = pulse; this.exBeamMat.opacity = this.exActive ? 0.2 + Math.sin(t * 3) * 0.06 : 0.07;
    this.exRing.scale.setScalar(1 + Math.sin(t * 2.5) * 0.04);
    // doors: animate + auto-close
    for (const d of this.doors) {
      const target = d.open ? 1 : 0;
      if (d.anim !== target) {
        d.anim += Math.sign(target - d.anim) * dt * 2.6;
        if (Math.abs(target - d.anim) < 0.05) d.anim = target;
        for (const m of d.meshes) m.panel.position.y = m.baseY + d.anim * (this.theme.wallH - 0.2);
      }
      const glow = d.open ? 0.0 : 0.35;
      for (const m of d.meshes) m.mat.emissiveIntensity = d.locked ? 0.5 + Math.sin(t * 5) * 0.2 : glow;
      if (d.open) {
        let near = false;
        for (const a of actors) { const dx = a.x - d.x, dz = a.z - d.z; if (dx * dx + dz * dz < 2.6 * 2.6) { near = true; break; } }
        d.idleT = near ? 0 : d.idleT + dt;
        if (d.idleT > 4.5) this.setDoorOpen(d, false);
      }
    }
    for (const tm of this.terminals) {
      if (tm.redraw) { tm.redraw = false; this.drawTerminal(tm); }
    }
  }

  // ------------------------------------------------------------ collision
  blocked(x, z, r, y) {
    const x0 = Math.floor((x - r) / CS), x1 = Math.floor((x + r) / CS), z0 = Math.floor((z - r) / CS), z1 = Math.floor((z + r) / CS);
    const lim = y + STEP;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return true;
      if (this.hgt[cz * this.W + cx] > lim) {
        const minx = cx * CS, minz = cz * CS;
        const qx = x < minx ? minx : (x > minx + CS ? minx + CS : x), qz = z < minz ? minz : (z > minz + CS ? minz + CS : z);
        const dx = x - qx, dz = z - qz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /** Slide-move circle p by (dx,dz). Returns true if blocked on either axis. */
  moveCircle(p, dx, dz, r, y) {
    if (this.blocked(p.x, p.z, r, y)) this.unstick(p, r, y);
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / 0.2)), sx = dx / n, sz = dz / n;
    let hit = false;
    for (let i = 0; i < n; i++) {
      if (!this.blocked(p.x + sx, p.z, r, y)) p.x += sx; else hit = true;
      if (!this.blocked(p.x, p.z + sz, r, y)) p.z += sz; else hit = true;
    }
    return hit;
  }

  unstick(p, r, y) {
    for (let it = 0; it < 8; it++) {
      if (!this.blocked(p.x, p.z, r, y)) return;
      // push toward the centre of the nearest nav cell
      const c = this.nearestNav(this.cx(p.x), this.cx(p.z));
      if (c < 0) return;
      const tx = this.center(c % this.W), tz = this.center(Math.floor(c / this.W));
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1;
      p.x += (dx / d) * Math.min(0.25, d); p.z += (dz / d) * Math.min(0.25, d);
    }
  }

  groundAt(x, z, r, y) {
    const rr = r * 0.8;
    const x0 = Math.floor((x - rr) / CS), x1 = Math.floor((x + rr) / CS), z0 = Math.floor((z - rr) / CS), z1 = Math.floor((z + rr) / CS);
    let g = 0; const lim = y + STEP;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) continue;
      const h = this.hgt[cz * this.W + cx];
      if (h <= lim && h > g) g = h;
    }
    return g;
  }

  wallsBetween(ax, az, bx, bz) {
    // count solid (tall) cells along a segment, used for sound attenuation
    const d = Math.hypot(bx - ax, bz - az); const n = Math.ceil(d / (CS * 0.5));
    let last = -1, count = 0;
    for (let i = 1; i < n; i++) {
      const t = i / n; const cx = this.cx(ax + (bx - ax) * t), cz = this.cx(az + (bz - az) * t);
      if (!this.inB(cx, cz)) continue; const k = cz * this.W + cx;
      if (k !== last && this.hgt[k] >= 2.5) { count++; last = k; }
    }
    return count;
  }

  // ------------------------------------------------------------ 3D grid raycast
  /** dir must be normalised. out: {t,nx,ny,nz,kind}. Returns true on hit within maxT. */
  raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
    const W = this.W, H = this.H;
    let cx = Math.floor(ox / CS), cz = Math.floor(oz / CS);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CS / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CS / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (cx + 1) * CS - ox : ox - cx * CS) / Math.abs(dx)) : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (cz + 1) * CS - oz : oz - cz * CS) / Math.abs(dz)) : Infinity;
    let t = 0, nx = -dx, nz = -dz;
    const ceil = this.ceilY;
    for (let guard = 0; guard < 600; guard++) {
      const tExit = Math.min(tmx, tmz, maxT);
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) { out.t = t; out.nx = nx; out.ny = 0; out.nz = nz; out.kind = 'wall'; return true; }
      const h = this.hgt[cz * W + cx];
      const yIn = oy + dy * t, yOut = oy + dy * tExit;
      if (h > 0 && yIn < h) {
        out.t = t; out.nx = nx; out.ny = 0; out.nz = nz; out.kind = 'wall'; return true;
      }
      // top of low obstacle / floor / ceiling within this cell span
      let th = Infinity, ny = 0;
      if (h > 0 && yOut < h && dy < 0) { th = (h - oy) / dy; ny = 1; }
      if (dy < 0 && yOut <= 0) { const tf = -oy / dy; if (tf < th) { th = tf; ny = 1; } }
      if (dy > 0 && yOut >= ceil) { const tc = (ceil - oy) / dy; if (tc < th) { th = tc; ny = -1; } }
      if (th < Infinity && th <= tExit + 1e-6 && th >= 0 && th <= maxT) {
        out.t = Math.max(t, th); out.nx = 0; out.ny = ny; out.nz = 0; out.kind = ny > 0 ? 'floor' : 'ceil'; return true;
      }
      if (tExit >= maxT) return false;
      if (tmx < tmz) { cx += sx; t = tmx; tmx += tdx; nx = -sx; nz = 0; } else { cz += sz; t = tmz; tmz += tdz; nz = -sz; nx = 0; }
    }
    return false;
  }

  /** true if nothing solid between the two points */
  los(ax, ay, az, bx, by, bz, scratch) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz); if (d < 1e-4) return true;
    dx /= d; dy /= d; dz /= d;
    return !this.raycast(ax, ay, az, dx, dy, dz, d - 0.05, scratch || (this._s || (this._s = {})));
  }

  // ------------------------------------------------------------ navigation
  nearestNav(cx, cz) {
    if (this.inB(cx, cz) && this.nav[this.idx(cx, cz)]) return this.idx(cx, cz);
    for (let r = 1; r < 8; r++) {
      let best = -1, bd = 1e9;
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r || !this.inB(x, z)) continue;
        const i = this.idx(x, z);
        if (this.nav[i]) { const d = (x - cx) * (x - cx) + (z - cz) * (z - cz); if (d < bd) { bd = d; best = i; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  pathClear(x0, z0, x1, z1, r) {
    const d = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.ceil(d / 0.35));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (this.blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r, 0)) return false;
    }
    return true;
  }

  _hpush(k, v) {
    const K = this._hk, V = this._hv; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }

  _hpop() {
    const K = this._hk, V = this._hv; const top = V[0]; const lk = K.pop(), lv = V.pop(); const n = K.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= lk) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = lk; V[i] = lv;
    }
    return top;
  }

  /** A* over the nav grid. Returns array of {x,z} (start excluded) or null. */
  findPath(sx, sz, tx, tz, r = 0.4) {
    const W = this.W;
    let s = this.nearestNav(this.cx(sx), this.cx(sz)), g = this.nearestNav(this.cx(tx), this.cx(tz));
    if (s < 0 || g < 0) return null;
    if (s === g) return [{ x: tx, z: tz }];
    this._cur++; const cur = this._cur;
    const gS = this._g, par = this._par, st = this._stamp;
    this._hk.length = 0; this._hv.length = 0;
    const gx = g % W, gz = Math.floor(g / W);
    gS[s] = 0; par[s] = -1; st[s] = cur * 2; // open
    this._hpush(0, s);
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false, iter = 0;
    while (this._hv.length && iter++ < 6000) {
      const c = this._hpop();
      if (st[c] === cur * 2 + 1) continue;
      st[c] = cur * 2 + 1; // closed
      if (c === g) { found = true; break; }
      const cx = c % W, cz = (c / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + D[k][0], nz = cz + D[k][1];
        if (nx < 0 || nz < 0 || nx >= W || nz >= this.H) continue;
        const ni = nz * W + nx;
        if (!this.nav[ni]) continue;
        if (k >= 4 && (!this.nav[cz * W + nx] || !this.nav[nz * W + cx])) continue;
        if (st[ni] === cur * 2 + 1) continue;
        const ng = gS[c] + D[k][2];
        if (st[ni] === cur * 2 && gS[ni] <= ng) continue;
        gS[ni] = ng; par[ni] = c; st[ni] = cur * 2;
        const dx = Math.abs(nx - gx), dz = Math.abs(nz - gz);
        this._hpush(ng + (dx + dz) + (1.414 - 2) * Math.min(dx, dz), ni);
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = g; c !== s && c >= 0; c = par[c]) cells.push(c);
    cells.reverse();
    // string-pull smoothing
    const out = []; let px = sx, pz = sz, i = 0;
    while (i < cells.length) {
      let j = Math.min(cells.length - 1, i + 12);
      for (; j > i; j--) {
        const cxj = this.center(cells[j] % W), czj = this.center((cells[j] / W) | 0);
        if (this.pathClear(px, pz, cxj, czj, r)) break;
      }
      const c = cells[j];
      px = this.center(c % W); pz = this.center((c / W) | 0);
      out.push({ x: px, z: pz });
      i = j + 1;
    }
    // final exact target if it lies in a reachable cell
    if (out.length && this.nav[this.idx(this.cx(tx), this.cx(tz))]) out[out.length - 1] = { x: tx, z: tz };
    return out;
  }

  randomNavNear(x, z, radiusCells) {
    const cx0 = this.cx(x), cz0 = this.cx(z);
    for (let tries = 0; tries < 20; tries++) {
      const cx = cx0 + Math.round((Math.random() * 2 - 1) * radiusCells), cz = cz0 + Math.round((Math.random() * 2 - 1) * radiusCells);
      if (this.inB(cx, cz) && this.nav[this.idx(cx, cz)] && this.ch[this.idx(cx, cz)] === '.') return { x: this.center(cx), z: this.center(cz) };
    }
    return null;
  }

  refreshEnv() {
    if (this.envRT) this.envRT.dispose();
    this._environment();
    for (const d of this.disposables) if (d && d.isMeshStandardMaterial && d.envMap !== undefined) { d.envMap = this.envMap; d.needsUpdate = true; }
  }

  // ------------------------------------------------------------ teardown
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry && !this.disposables.includes(o.geometry)) o.geometry.dispose(); });
    for (const d of this.disposables) { if (d && d.dispose) d.dispose(); }
    if (this.envRT) this.envRT.dispose();
    this.disposables.length = 0;
  }
}
