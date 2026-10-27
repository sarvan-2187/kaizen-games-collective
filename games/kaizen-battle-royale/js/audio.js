'use strict';
/* Synthesised audio: layered gunshots with distance low-pass, stereo panning and echo, plus ambience. No audio files. */
KBR.Audio = (function () {
  const A = {};
  let ctx = null, master = null, comp = null, echoIn = null, noiseBuf = null, amb = null;
  A.enabled = true; A.volume = 0.8;
  const L = { x: 0, y: 0, z: 0, yaw: 0 };

  A.init = function () {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = A.volume; master.connect(comp);
      const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = b;
      // shared echo bus for big guns
      const delay = ctx.createDelay(1); delay.delayTime.value = 0.23;
      const fb = ctx.createGain(); fb.gain.value = 0.32;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      echoIn = ctx.createGain(); echoIn.gain.value = 0.5;
      echoIn.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
  };
  A.setVolume = (v) => { A.volume = v; if (master) master.gain.value = A.enabled ? v : 0; };
  A.setEnabled = (on) => { A.enabled = on; if (master) master.gain.value = on ? A.volume : 0; };
  A.setListener = (x, y, z, yaw) => { L.x = x; L.y = y; L.z = z; L.yaw = yaw; };

  /** gain + pan + brightness for a sound at world position `p` (null = at the listener). */
  function spatial(p) {
    if (!p) return { g: 1, pan: 0, lp: 16000, d: 0 };
    const dx = p.x - L.x, dy = (p.y || 0) - L.y, dz = p.z - L.z, d = Math.hypot(dx, dy, dz);
    // listener forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw)
    const pan = d < 0.5 ? 0 : clamp((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d, -1, 1);
    return { g: 1 / (1 + Math.pow(d / 28, 1.6)), pan: pan * 0.9, lp: 14000 / (1 + d / 55), d };
  }
  function chain(sp, vol, extra) {
    const g = ctx.createGain(); g.gain.value = vol * sp.g;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = sp.lp;
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = sp.pan; g.connect(f); f.connect(p); p.connect(master); } else { g.connect(f); f.connect(master); }
    if (extra && extra.echo) { const e = ctx.createGain(); e.gain.value = extra.echo * sp.g; f.connect(e); e.connect(echoIn); }
    return out;
  }
  function tone(f0, f1, dur, type, vol, sp, extra) {
    const t = ctx.currentTime, o = ctx.createOscillator(), env = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env.gain.setValueAtTime(vol, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(env); env.connect(chain(sp, 1, extra)); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, freq, q, vol, sp, type, extra) {
    const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), env = ctx.createGain();
    s.buffer = noiseBuf; s.loop = false; f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 0.8;
    env.gain.setValueAtTime(vol, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(env); env.connect(chain(sp, 1, extra)); s.start(t, Math.random() * 1.5, dur + 0.05);
  }
  const ok = () => ctx && A.enabled;

  A.shot = function (kind, pos) {
    if (!ok()) return;
    const sp = spatial(pos), v = pos ? 1 : 0.9;
    if (sp.g < 0.01) return;
    switch (kind) {
      case 'pistol': noise(0.09, 2400, 0.7, 0.5 * v, sp); tone(900, 160, 0.08, 'square', 0.16 * v, sp); tone(140, 55, 0.12, 'sine', 0.35 * v, sp); break;
      case 'rifle': noise(0.12, 1700, 0.6, 0.6 * v, sp); tone(520, 90, 0.1, 'sawtooth', 0.2 * v, sp); tone(95, 40, 0.18, 'sine', 0.45 * v, sp, { echo: 0.12 }); break;
      case 'smg': noise(0.07, 2700, 0.7, 0.45 * v, sp); tone(720, 150, 0.06, 'square', 0.15 * v, sp); tone(120, 50, 0.08, 'sine', 0.25 * v, sp); break;
      case 'shotgun': noise(0.32, 900, 0.5, 0.9 * v, sp, 'lowpass', { echo: 0.3 }); noise(0.1, 3200, 0.6, 0.45 * v, sp); tone(160, 38, 0.28, 'sawtooth', 0.3 * v, sp); break;
      case 'sniper': noise(0.2, 3600, 0.7, 0.85 * v, sp, 'highpass', { echo: 0.55 }); tone(110, 26, 0.6, 'sine', 0.75 * v, sp, { echo: 0.45 }); tone(300, 60, 0.15, 'sawtooth', 0.25 * v, sp); break;
    }
  };
  A.hit = (head) => { if (!ok()) return; const sp = spatial(null); if (head) { tone(1500, 2300, 0.14, 'triangle', 0.32, sp); setTimeout(() => ctx && tone(2300, 3000, 0.12, 'sine', 0.22, spatial(null)), 45); } else tone(650, 280, 0.06, 'triangle', 0.22, sp); };
  A.hurt = () => { if (!ok()) return; const sp = spatial(null); tone(180, 60, 0.18, 'sawtooth', 0.4, sp); noise(0.1, 600, 0.6, 0.35, sp); };
  A.impact = (pos, kind) => { if (!ok()) return; const sp = spatial(pos); if (sp.g < 0.05) return; noise(0.05, kind === 'wood' ? 700 : 2400, 1, 0.12, sp); };
  A.whiz = (pos) => { if (!ok()) return; const sp = spatial(pos); tone(2600, 900, 0.09, 'sine', 0.1, sp); };
  A.step = (road, vol) => { if (!ok()) return; noise(0.05, road ? 1500 : 650, 0.9, 0.12 * (vol || 1), spatial(null), road ? 'bandpass' : 'lowpass'); };
  A.splash = () => ok() && noise(0.22, 1200, 0.6, 0.22, spatial(null));
  A.pickup = () => { if (!ok()) return; const sp = spatial(null); tone(520, 880, 0.09, 'sine', 0.22, sp); setTimeout(() => ctx && tone(880, 1180, 0.1, 'triangle', 0.2, spatial(null)), 70); };
  A.reload = (phase) => { if (!ok()) return; const sp = spatial(null); if (phase === 0) { tone(360, 520, 0.07, 'triangle', 0.2, sp); noise(0.04, 1800, 1, 0.2, sp); } else { tone(580, 920, 0.09, 'triangle', 0.22, sp); noise(0.05, 2200, 1, 0.25, sp); } };
  A.empty = () => ok() && tone(900, 700, 0.04, 'square', 0.12, spatial(null));
  A.heal = () => { if (!ok()) return; const sp = spatial(null); tone(440, 880, 0.25, 'sine', 0.22, sp); setTimeout(() => ctx && tone(660, 1320, 0.25, 'sine', 0.18, spatial(null)), 120); };
  A.barrier = () => { if (!ok()) return; const sp = spatial(null); tone(240, 900, 0.18, 'sine', 0.3, sp); noise(0.14, 1600, 0.8, 0.2, sp); };
  A.skill = (kind) => { if (!ok()) return; const sp = spatial(null); if (kind === 'dash') { noise(0.3, 2400, 0.4, 0.35, sp, 'bandpass'); tone(400, 1400, 0.25, 'sawtooth', 0.15, sp); } else { tone(300, 1200, 0.4, 'sine', 0.3, sp); tone(450, 1800, 0.4, 'triangle', 0.15, sp); } };
  A.chute = () => ok() && noise(0.5, 500, 0.5, 0.35, spatial(null), 'lowpass');
  A.zone = () => { if (!ok()) return; const sp = spatial(null); tone(520, 520, 0.12, 'square', 0.12, sp); setTimeout(() => ctx && tone(520, 520, 0.12, 'square', 0.12, spatial(null)), 200); };
  A.kill = () => { if (!ok()) return; const sp = spatial(null); tone(700, 1400, 0.1, 'triangle', 0.3, sp); setTimeout(() => ctx && tone(1050, 2100, 0.16, 'triangle', 0.28, spatial(null)), 90); };
  A.click = () => ok() && tone(660, 520, 0.05, 'triangle', 0.1, spatial(null));
  A.victory = () => { if (!ok()) return; [293.66, 392, 440, 587.33, 698.46, 880].forEach((f, i) => setTimeout(() => ctx && tone(f, f * 1.01, 0.5, 'triangle', 0.26, spatial(null)), i * 130)); };
  A.defeat = () => { if (!ok()) return; [392, 349.2, 293.66, 220].forEach((f, i) => setTimeout(() => ctx && tone(f, f * 0.98, 0.5, 'sine', 0.26, spatial(null)), i * 220)); };

  /** Ocean + wind ambience. `wind` 0..1 scales the wind layer (louder when skydiving). */
  A.startAmbience = function () {
    if (!ctx || amb) return;
    const mk = (type, freq, vol) => {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true; f.type = type; f.frequency.value = freq; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start(); return { s, g, f };
    };
    amb = { sea: mk('lowpass', 420, 0.07), wind: mk('bandpass', 800, 0.0) };
  };
  A.setAmbience = function (t, wind, seaLevel) {
    if (!amb) return;
    amb.wind.g.gain.value = 0.02 + wind * 0.28; amb.wind.f.frequency.value = 500 + wind * 1500;
    amb.sea.g.gain.value = (0.05 + 0.04 * Math.sin(t * 0.35)) * clamp(seaLevel, 0.1, 1);
  };
  A.stopAmbience = function () { if (!amb) return; try { amb.sea.s.stop(); amb.wind.s.stop(); } catch (e) { /* ignore */ } amb = null; };
  return A;
})();
