// Ambient bed: soft wind always, forest birds by day, crickets by night. Scheduled a little ahead
// from update(); everything goes to the ambient bus with random stereo placement.
import type { AudioEngine } from './engine';

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Ambient {
  private nextBird = 1;
  private nextCricket = 0.5;
  private wind: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private dayMix = 1;

  constructor(private readonly e: AudioEngine) {}

  private pan(value: number): AudioNode {
    const ctx = this.e.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = value;
    p.connect(this.e.bus('ambient'));
    return p;
  }

  private startWind(): void {
    const ctx = this.e.ctx!;
    const src = ctx.createBufferSource();
    // Own looped brown-noise buffer: a smooth, low wind bed.
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise.
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.998;
      d[i] = last * 3;
    }
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.e.bus('ambient'));
    src.start();
    lfo.start();
    this.wind = { gain, src };
  }

  private bird(at: number): void {
    const e = this.e;
    const out = this.pan(rand(-0.9, 0.9));
    const base = rand(2600, 4200);
    const notes = Math.floor(rand(2, 6));
    const gain = 0.05 * this.dayMix;
    for (let i = 0; i < notes; i++) {
      const t = at + i * rand(0.08, 0.14);
      const o = e.tone(t, 0.09, 'sine', base * rand(0.9, 1.15), e.env(t, 0.008, gain, 0.07, out), base * rand(1.2, 1.5));
      // Fast vibrato for the warble.
      const ctx = e.ctx!;
      const v = ctx.createOscillator();
      v.frequency.value = rand(30, 60);
      const vg = ctx.createGain();
      vg.gain.value = base * 0.04;
      v.connect(vg);
      vg.connect(o.frequency);
      v.start(t);
      v.stop(t + 0.12);
    }
  }

  private cricket(at: number): void {
    const e = this.e;
    const out = this.pan(rand(-1, 1));
    const f = rand(4200, 5200);
    const gain = 0.03 * (1 - this.dayMix);
    const pulses = Math.floor(rand(3, 5));
    for (let i = 0; i < pulses; i++) {
      const t = at + i * 0.035;
      e.tone(t, 0.03, 'sine', f, e.env(t, 0.003, gain, 0.022, out));
    }
  }

  /** dt in seconds; isDay from the sim (or true without one). */
  update(dt: number, isDay: boolean): void {
    if (!this.e.ctx || this.e.ctx.state !== 'running') return;
    if (!this.wind) this.startWind();
    // Cross-fade day ↔ night over ~4 s.
    this.dayMix += ((isDay ? 1 : 0) - this.dayMix) * Math.min(1, dt / 4);
    const now = this.e.now;
    this.nextBird -= dt;
    this.nextCricket -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = rand(1.5, 5);
      if (this.dayMix > 0.15) this.bird(now + 0.05);
    }
    if (this.nextCricket <= 0) {
      this.nextCricket = rand(0.35, 1.1);
      if (this.dayMix < 0.85) this.cricket(now + 0.05);
    }
  }

  dispose(): void {
    if (this.wind) {
      try {
        this.wind.src.stop();
      } catch {
        // Already stopped.
      }
      this.wind = null;
    }
  }
}
