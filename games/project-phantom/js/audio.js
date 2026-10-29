// Procedural Web Audio: every sound is synthesised, no audio files.
// The AudioContext is only created after a user gesture (autoplay policy).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.noiseBuf = null;
    this.alarm = null;
    this.ambient = null;
    this.lastPlay = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ---- building blocks
  _out(pan) {
    const c = this.ctx;
    if (!pan || !c.createStereoPanner) return this.master;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  _noise(dur, { type = 'lowpass', f0 = 1000, f1 = f0, q = 1, gain = 0.3, attack = 0.002, pan = 0, delay = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this._out(pan));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  _tone(type, f0, f1, dur, { gain = 0.2, attack = 0.003, pan = 0, delay = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this._out(pan));
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---- public: one-shot effects. opts: {vol, pan}
  play(name, o = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const minGap = { step: 0.08, spark: 0.03, enemyShot: 0.03, tick: 0.02 }[name];
    if (minGap) { if (now - (this.lastPlay[name] || 0) < minGap) return; this.lastPlay[name] = now; }
    const v = o.vol == null ? 1 : o.vol, pan = o.pan || 0;
    switch (name) {
      case 'pistol': // suppressed: soft thump + air hiss
        this._noise(0.12, { f0: 2500, f1: 500, gain: 0.16 * v, pan });
        this._tone('sine', 200, 70, 0.1, { gain: 0.18 * v, pan });
        break;
      case 'rifle':
        this._noise(0.16, { type: 'bandpass', f0: 2600, f1: 500, q: 0.8, gain: 0.5 * v, pan });
        this._tone('square', 170, 55, 0.12, { gain: 0.25 * v, pan });
        break;
      case 'smg':
        this._noise(0.1, { type: 'bandpass', f0: 3400, f1: 900, q: 0.9, gain: 0.42 * v, pan });
        this._tone('sawtooth', 240, 90, 0.07, { gain: 0.14 * v, pan });
        break;
      case 'sniper':
        this._noise(0.55, { f0: 3000, f1: 120, gain: 0.8 * v, pan });
        this._tone('sawtooth', 130, 30, 0.35, { gain: 0.45 * v, pan });
        this._noise(0.4, { type: 'bandpass', f0: 700, f1: 250, gain: 0.25 * v, pan, delay: 0.07 });
        break;
      case 'arc':
        this._tone('sawtooth', 1800, 180, 0.25, { gain: 0.2 * v, pan });
        this._tone('square', 900, 90, 0.2, { gain: 0.12 * v, pan });
        this._noise(0.2, { type: 'highpass', f0: 4000, f1: 1500, gain: 0.25 * v, pan });
        break;
      case 'enemyShot':
        this._noise(0.14, { type: 'bandpass', f0: 1800, f1: 400, q: 1.2, gain: 0.3 * v, pan });
        this._tone('square', 120, 50, 0.1, { gain: 0.12 * v, pan });
        break;
      case 'dry': this._tone('square', 900, 700, 0.04, { gain: 0.07 }); break;
      case 'reload':
        this._noise(0.05, { type: 'bandpass', f0: 1500, q: 3, gain: 0.25 });
        this._tone('square', 420, 300, 0.05, { gain: 0.08 });
        this._noise(0.06, { type: 'bandpass', f0: 900, q: 3, gain: 0.3, delay: 0.55 * (o.t || 1) });
        this._tone('square', 300, 220, 0.06, { gain: 0.09, delay: 0.55 * (o.t || 1) });
        break;
      case 'reloadDone':
        this._noise(0.07, { type: 'bandpass', f0: 2000, q: 4, gain: 0.35 });
        this._tone('square', 600, 400, 0.05, { gain: 0.1 });
        break;
      case 'step': this._noise(0.09, { f0: 380, f1: 120, gain: 0.22 * v, pan }); break;
      case 'land': this._noise(0.14, { f0: 300, f1: 70, gain: 0.4 * v }); break;
      case 'hit': this._tone('sine', 900, 700, 0.04, { gain: 0.12 }); break;
      case 'headshot':
        this._tone('triangle', 1700, 1300, 0.09, { gain: 0.22 });
        this._tone('sine', 900, 600, 0.12, { gain: 0.15, delay: 0.02 });
        break;
      case 'kill':
        this._tone('triangle', 500, 900, 0.08, { gain: 0.18 });
        this._tone('triangle', 800, 1300, 0.1, { gain: 0.16, delay: 0.07 });
        break;
      case 'enemyHit': this._noise(0.08, { f0: 900, f1: 200, gain: 0.3 * v, pan }); break;
      case 'hurt':
        this._noise(0.2, { f0: 600, f1: 90, gain: 0.5 });
        this._tone('sine', 140, 50, 0.25, { gain: 0.35 });
        break;
      case 'whiz': this._noise(0.12, { type: 'bandpass', f0: 4200, f1: 1800, q: 4, gain: 0.18 * v, pan }); break;
      case 'spark': this._noise(0.04, { type: 'highpass', f0: 5000, f1: 3000, gain: 0.07 * v, pan }); break;
      case 'impact': this._noise(0.1, { type: 'bandpass', f0: 1500, f1: 600, q: 1, gain: 0.12 * v, pan }); break;
      case 'explosion':
        this._noise(0.9, { f0: 1800, f1: 60, gain: 0.8 * v, pan });
        this._tone('sine', 110, 28, 0.7, { gain: 0.6 * v, pan });
        break;
      case 'suspicious':
        this._tone('sine', 520, 640, 0.12, { gain: 0.14 * v, pan });
        break;
      case 'detect':
        this._tone('square', 520, 520, 0.08, { gain: 0.14 * v, pan });
        this._tone('square', 780, 780, 0.14, { gain: 0.16 * v, pan, delay: 0.09 });
        break;
      case 'emp':
        this._tone('sawtooth', 2400, 60, 0.7, { gain: 0.3 });
        this._noise(0.6, { type: 'bandpass', f0: 4000, f1: 200, q: 2, gain: 0.35 });
        break;
      case 'zap': this._tone('sawtooth', 1500, 100, 0.3, { gain: 0.18 * v, pan }); this._noise(0.25, { type: 'highpass', f0: 3000, gain: 0.2 * v, pan }); break;
      case 'door':
        this._noise(0.4, { type: 'bandpass', f0: 300, f1: 900, q: 1.5, gain: 0.25 * v, pan });
        this._tone('sine', 120, 180, 0.3, { gain: 0.1 * v, pan });
        break;
      case 'locked': this._tone('square', 180, 150, 0.12, { gain: 0.12 }); this._tone('square', 180, 150, 0.12, { gain: 0.12, delay: 0.16 }); break;
      case 'hack': this._tone('square', 1200 + Math.random() * 600, 1000, 0.04, { gain: 0.05 }); break;
      case 'hackDone':
        [660, 880, 1320].forEach((f, i) => this._tone('triangle', f, f, 0.14, { gain: 0.18, delay: i * 0.08 }));
        break;
      case 'pickup':
        this._tone('sine', 600, 1000, 0.09, { gain: 0.18 }); this._tone('sine', 900, 1500, 0.12, { gain: 0.16, delay: 0.07 });
        break;
      case 'takedown': this._noise(0.12, { f0: 700, f1: 150, gain: 0.3 * v, pan }); this._tone('sine', 160, 60, 0.15, { gain: 0.2 * v, pan }); break;
      case 'tick': this._tone('square', 1000, 1000, 0.015, { gain: 0.03 }); break;
      case 'ui': this._tone('triangle', 700, 900, 0.05, { gain: 0.1 }); break;
      case 'uiBack': this._tone('triangle', 500, 350, 0.06, { gain: 0.1 }); break;
      case 'buy': [500, 750, 1000].forEach((f, i) => this._tone('triangle', f, f * 1.02, 0.1, { gain: 0.16, delay: i * 0.06 })); break;
      case 'success':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone('triangle', f, f, 0.35, { gain: 0.2, delay: i * 0.12 }));
        break;
      case 'fail':
        [392, 330, 262, 196].forEach((f, i) => this._tone('sawtooth', f, f * 0.97, 0.45, { gain: 0.16, delay: i * 0.2 }));
        break;
      default: break;
    }
  }

  // ---- looping beds
  startAlarm() {
    if (!this.ctx || this.alarm) return;
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const lfo = c.createOscillator(); lfo.frequency.value = 1.1;
    const lg = c.createGain(); lg.gain.value = 180;
    lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 620;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = c.createGain(); g.gain.value = 0.0001; g.gain.linearRampToValueAtTime(0.09, c.currentTime + 0.3);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(); lfo.start();
    this.alarm = { o, lfo, g };
  }

  stopAlarm() {
    if (!this.alarm) return;
    const { o, lfo, g } = this.alarm; const c = this.ctx;
    g.gain.cancelScheduledValues(c.currentTime);
    g.gain.setValueAtTime(g.gain.value, c.currentTime);
    g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.3);
    o.stop(c.currentTime + 0.35); lfo.stop(c.currentTime + 0.35);
    this.alarm = null;
  }

  startAmbient(hum = 55, bright = 400) {
    if (!this.ctx) return;
    this.stopAmbient();
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.0001; g.gain.linearRampToValueAtTime(0.12, c.currentTime + 2);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = bright;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = hum;
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = hum * 1.503;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12;
    const lg = c.createGain(); lg.gain.value = bright * 0.5;
    lfo.connect(lg); lg.connect(f.frequency);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.5;
    const ng = c.createGain(); ng.gain.value = 0.03;
    n.connect(nf); nf.connect(ng); ng.connect(g);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start(); n.start();
    this.ambient = { nodes: [o1, o2, lfo, n], g };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const a = this.ambient; this.ambient = null;
    try {
      a.g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.4);
      a.nodes.forEach((n) => n.stop(this.ctx.currentTime + 0.45));
    } catch (e) { /* already stopped */ }
  }

  stopAll() { this.stopAlarm(); this.stopAmbient(); }
}
