// WebAudio engine: lazily created AudioContext (after the first user gesture, per autoplay policy),
// master / sfx / ambient / stinger buses, a procedural reverb and small synthesis primitives.

export type Bus = 'sfx' | 'ambient' | 'stinger';

export interface Pos3 {
  x: number;
  y: number;
  z: number;
}

/** Distance (three.js units = WC3 units) beyond which positional one-shots are skipped. */
export const AUDIBLE_RANGE = 3200;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private reverbIn!: GainNode;
  private noiseBuf!: AudioBuffer;
  private shaper!: WaveShaperNode;
  private readonly volumes = { master: 0.8, sfx: 0.9 };
  private readonly unlockEvents = ['pointerdown', 'keydown', 'mousedown', 'touchstart'] as const;
  private readonly onReady = new Set<() => void>();
  /** Listener position in three.js space (for range culling). */
  readonly listener = { x: 0, y: 0, z: 0 };
  private disposed = false;

  constructor() {
    for (const ev of this.unlockEvents) window.addEventListener(ev, this.unlock, { capture: true });
  }

  /** Called when the context starts (first gesture). */
  whenReady(fn: () => void): void {
    if (this.ctx) fn();
    else this.onReady.add(fn);
  }

  private readonly unlock = (): void => {
    if (this.disposed) return;
    if (!this.ctx) this.create();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  };

  private create(): void {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.buses = { sfx: ctx.createGain(), ambient: ctx.createGain(), stinger: ctx.createGain() };
    this.buses.sfx.connect(this.master);
    this.buses.ambient.connect(this.master);
    this.buses.stinger.connect(this.master);
    this.buses.ambient.gain.value = 0.55;
    this.buses.stinger.gain.value = 0.8;

    // White noise (2 s) shared by every noise voice.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }

    // Procedural outdoor reverb: decaying stereo noise impulse.
    const irLen = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const t = i / irLen;
        // Sparse early reflections, then a smooth tail.
        const early = i < ctx.sampleRate * 0.08 && seed % 97 === 0 ? 0.8 : 0;
        data[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - t, 3.2) * 0.6 + early;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.5;
    this.reverbIn.connect(conv);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    conv.connect(wet);
    wet.connect(this.buses.sfx);

    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    this.shaper.curve = curve;
    this.shaper.connect(this.buses.sfx);

    this.applyVolumes();
    for (const fn of this.onReady) fn();
    this.onReady.clear();
  }

  setVolume(kind: 'master' | 'sfx', v: number): void {
    this.volumes[kind] = Math.min(1, Math.max(0, v));
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Squared slider → gain feels closer to perceived loudness.
    this.master.gain.setTargetAtTime(this.volumes.master * this.volumes.master, t, 0.02);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx * this.volumes.sfx, t, 0.02);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  bus(b: Bus): AudioNode {
    return this.buses[b];
  }

  get reverb(): AudioNode {
    return this.reverbIn;
  }

  get drive(): AudioNode {
    return this.shaper;
  }

  /** True if a positional sound at `pos` would be audible at all. */
  inRange(pos: Pos3 | null | undefined, range = AUDIBLE_RANGE): boolean {
    if (!pos) return true;
    const dx = pos.x - this.listener.x;
    const dy = pos.y - this.listener.y;
    const dz = pos.z - this.listener.z;
    return dx * dx + dy * dy + dz * dz <= range * range;
  }

  /**
   * Output node for a one-shot: a PannerNode at `pos` (three.js space) feeding the bus, or the bus
   * itself for non-positional sounds.
   */
  out(pos: Pos3 | null | undefined, bus: Bus = 'sfx', refDistance = 300): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return this.buses[bus];
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.maxDistance = 10000;
    p.rolloffFactor = 1.1;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else {
      (p as PannerNode & { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    }
    p.connect(this.buses[bus]);
    return p;
  }

  /** Listener pose from a camera world matrix (three.js column-major elements). */
  setListener(m: ArrayLike<number>): void {
    this.listener.x = m[12]!;
    this.listener.y = m[13]!;
    this.listener.z = m[14]!;
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    // Camera looks down its local -Z; up is local +Y.
    const fx = -m[8]!;
    const fy = -m[9]!;
    const fz = -m[10]!;
    if (l.positionX) {
      l.positionX.setTargetAtTime(m[12]!, t, 0.01);
      l.positionY.setTargetAtTime(m[13]!, t, 0.01);
      l.positionZ.setTargetAtTime(m[14]!, t, 0.01);
      l.forwardX.setTargetAtTime(fx, t, 0.01);
      l.forwardY.setTargetAtTime(fy, t, 0.01);
      l.forwardZ.setTargetAtTime(fz, t, 0.01);
      l.upX.setTargetAtTime(m[4]!, t, 0.01);
      l.upY.setTargetAtTime(m[5]!, t, 0.01);
      l.upZ.setTargetAtTime(m[6]!, t, 0.01);
    } else {
      const legacy = l as AudioListener & {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(m[12]!, m[13]!, m[14]!);
      legacy.setOrientation(fx, fy, fz, m[4]!, m[5]!, m[6]!);
    }
  }

  // --- primitives ---------------------------------------------------------------------------------

  /** Gain with an attack → exponential decay envelope. */
  env(t: number, attack: number, peak: number, decay: number, dest: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  /** Noise burst through a filter. Returns the source (already scheduled). */
  noise(t: number, dur: number, filter: BiquadFilterType, freq: number, q: number, dest: AudioNode, freqEnd?: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    f.Q.value = q;
    src.connect(f);
    f.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
    };
    return src;
  }

  /** Oscillator with an optional exponential pitch sweep. */
  tone(t: number, dur: number, type: OscillatorType, f0: number, dest: AudioNode, f1?: number, detune = 0): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => o.disconnect();
    return o;
  }

  dispose(): void {
    this.disposed = true;
    for (const ev of this.unlockEvents) window.removeEventListener(ev, this.unlock, { capture: true });
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
