// Procedural sound recipes. Every function schedules nodes on the engine and returns immediately.
// Nothing here is sampled: no WC3 / CS / DotA audio is used.
import type { AudioEngine, Bus, Pos3 } from './engine';

type P = Pos3 | null | undefined;

const jitter = (v: number, amount: number): number => v * (1 + (Math.random() * 2 - 1) * amount);

// ---------------------------------------------------------------------------
// Rifle
// ---------------------------------------------------------------------------

/** Big bolt-action boom with an outdoor tail. `scale` > 1 for Assassinate. */
export const rifleShot = (e: AudioEngine, scale = 1, pos?: P): void => {
  const t = e.now + 0.005;
  const out = e.out(pos, 'sfx', 600);
  // Transient click.
  e.noise(t, 0.04, 'highpass', 2500, 0.7, e.env(t, 0.001, 0.7 * scale, 0.035, out));
  // Supersonic crack.
  e.noise(t, 0.16, 'bandpass', 1500 * jitter(1, 0.05), 0.7, e.env(t, 0.002, 1.0 * scale, 0.13, out));
  // Body thump, driven for grit.
  const body = e.env(t, 0.003, 0.9 * scale, 0.42 * scale, e.drive);
  e.tone(t, 0.5, 'sine', 118, body, 36);
  e.tone(t, 0.25, 'triangle', 240, e.env(t, 0.002, 0.3, 0.12, out), 70);
  // Rolling tail (and the reverb send).
  const tail = e.env(t, 0.012, 0.65 * scale, 1.1 * scale, out);
  e.noise(t, 1.3 * scale, 'lowpass', 1100, 0.5, tail, 160);
  const send = e.env(t, 0.004, 0.9 * scale, 0.5, e.reverb);
  e.noise(t, 0.6, 'bandpass', 900, 0.6, send, 300);
};

/** One metallic bolt clack. */
export const boltClack = (e: AudioEngine, at: number, pitch = 1): void => {
  const out = e.bus('sfx');
  e.noise(at, 0.05, 'bandpass', 3200 * pitch, 3, e.env(at, 0.001, 0.35, 0.04, out));
  e.tone(at, 0.03, 'square', 1700 * pitch, e.env(at, 0.001, 0.07, 0.025, out), 1200 * pitch);
  e.tone(at, 0.06, 'sine', 420 * pitch, e.env(at, 0.001, 0.12, 0.05, out), 300 * pitch);
};

/** Bolt cycle timed to the fire interval: pull back, then push forward. */
export const boltCycle = (e: AudioEngine, fireInterval: number): void => {
  const [a, b] = boltTimes(fireInterval);
  boltClack(e, e.now + a, 1.0);
  boltClack(e, e.now + b, 0.82);
};

/** Bolt clack times after the shot (seconds) for a fire interval. Pure. */
export const boltTimes = (fireInterval: number): [number, number] => {
  const i = Math.max(0.4, fireInterval);
  return [i * 0.36, i * 0.64];
};

export const zoomClick = (e: AudioEngine, level: number): void => {
  const t = e.now;
  const out = e.bus('sfx');
  const f = level === 0 ? 1500 : level === 1 ? 2300 : 2900;
  e.noise(t, 0.03, 'highpass', 3500, 0.7, e.env(t, 0.001, 0.25, 0.02, out));
  e.tone(t, 0.04, 'sine', f, e.env(t, 0.001, 0.18, 0.035, out), f * 0.75);
};

export const hitTick = (e: AudioEngine): void => {
  const t = e.now + 0.03;
  const out = e.bus('sfx');
  e.tone(t, 0.04, 'sine', 1900, e.env(t, 0.001, 0.22, 0.03, out), 1500);
  e.noise(t, 0.03, 'bandpass', 4000, 2, e.env(t, 0.001, 0.12, 0.02, out));
};

/** CS-style helmet "dink". */
export const headshotDink = (e: AudioEngine): void => {
  const t = e.now + 0.03;
  const out = e.bus('sfx');
  for (const [f, g, d] of [
    [2240, 0.28, 0.42],
    [3410, 0.16, 0.3],
    [5180, 0.1, 0.18],
    [1210, 0.12, 0.25],
  ] as const) {
    e.tone(t, d + 0.05, 'sine', f, e.env(t, 0.001, g, d, out), f * 0.985);
  }
  e.noise(t, 0.03, 'highpass', 5000, 0.7, e.env(t, 0.001, 0.3, 0.02, out));
  e.noise(t, 0.2, 'bandpass', 3000, 6, e.env(t, 0.001, 0.15, 0.18, e.reverb));
};

// ---------------------------------------------------------------------------
// Shrapnel / Assassinate / Town Portal
// ---------------------------------------------------------------------------

export const shrapnelLaunch = (e: AudioEngine, pos?: P): void => {
  const t = e.now;
  const out = e.out(pos, 'sfx', 500);
  e.tone(t, 0.35, 'sine', 80, e.env(t, 0.004, 0.9, 0.3, out), 42);
  e.noise(t, 0.3, 'lowpass', 700, 0.6, e.env(t, 0.003, 0.6, 0.25, out), 200);
  e.noise(t, 0.08, 'highpass', 1800, 0.7, e.env(t, 0.001, 0.3, 0.06, out));
  // Incoming shell whistle.
  e.tone(t + 0.15, 0.6, 'sine', 1500, e.env(t + 0.15, 0.2, 0.06, 0.45, out), 520);
};

/** One shell explosion. */
export const shellImpact = (e: AudioEngine, at: number, pos?: P, size = 1): void => {
  const out = e.out(pos, 'sfx', 450);
  e.noise(at, 0.7, 'lowpass', 1600, 0.6, e.env(at, 0.004, 0.75 * size, 0.6, out), 220);
  e.tone(at, 0.35, 'sine', 70, e.env(at, 0.003, 0.8 * size, 0.3, out), 34);
  e.noise(at, 0.06, 'bandpass', 2600, 1, e.env(at, 0.001, 0.4 * size, 0.05, out));
  e.noise(at, 0.5, 'bandpass', 700, 0.8, e.env(at, 0.004, 0.35 * size, 0.4, e.reverb));
};

/** Opening burst of the Shrapnel field: several staggered shells. */
export const shrapnelBurst = (e: AudioEngine, delay: number, pos?: P): void => {
  const t = e.now + delay;
  for (let i = 0; i < 5; i++) shellImpact(e, t + i * 0.07 + Math.random() * 0.05, pos, i === 0 ? 1 : 0.55);
};

/** Small crackle for a damage tick inside the field. */
export const shrapnelCrackle = (e: AudioEngine, at: number, pos?: P): void => {
  const out = e.out(pos, 'sfx', 350);
  for (let i = 0; i < 4; i++) {
    const tt = at + Math.random() * 0.35;
    e.noise(tt, 0.05, 'bandpass', jitter(1800, 0.4), 2, e.env(tt, 0.001, 0.22, 0.04, out));
  }
};

export interface Voice {
  stop(fade?: number): void;
}

/** Assassinate aim: a rising, trembling whine for `aimTime` seconds. */
export const assassinateCharge = (e: AudioEngine, aimTime: number): Voice => {
  const ctx = e.ctx!;
  const t = e.now;
  const out = e.bus('sfx');
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + aimTime * 0.9);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(3500, t + aimTime);
  lp.Q.value = 6;
  lp.connect(g);
  g.connect(out);
  const a = ctx.createOscillator();
  a.type = 'sawtooth';
  a.frequency.setValueAtTime(180, t);
  a.frequency.exponentialRampToValueAtTime(880, t + aimTime);
  const b = ctx.createOscillator();
  b.type = 'square';
  b.frequency.setValueAtTime(181.5, t);
  b.frequency.exponentialRampToValueAtTime(885, t + aimTime);
  const trem = ctx.createOscillator();
  trem.frequency.setValueAtTime(7, t);
  trem.frequency.linearRampToValueAtTime(18, t + aimTime);
  const tremGain = ctx.createGain();
  tremGain.gain.value = 0.06;
  trem.connect(tremGain);
  tremGain.connect(g.gain);
  a.connect(lp);
  b.connect(lp);
  for (const o of [a, b, trem]) o.start(t);
  const end = t + aimTime + 0.6;
  for (const o of [a, b, trem]) o.stop(end);
  // Lock-on beep at the end of the aim.
  e.tone(t + aimTime - 0.08, 0.1, 'sine', 1760, e.env(t + aimTime - 0.08, 0.002, 0.12, 0.08, out));
  let stopped = false;
  return {
    stop(fade = 0.08) {
      if (stopped) return;
      stopped = true;
      const n = e.now;
      g.gain.cancelScheduledValues(n);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n);
      g.gain.exponentialRampToValueAtTime(0.0001, n + fade);
      for (const o of [a, b, trem]) o.stop(n + fade + 0.02);
    },
  };
};

export const assassinateShot = (e: AudioEngine): void => {
  rifleShot(e, 1.35);
  const t = e.now;
  // Extra high whizz for the homing round.
  e.noise(t, 0.5, 'bandpass', 5000, 4, e.env(t, 0.01, 0.2, 0.45, e.bus('sfx')), 1200);
};

/** Town Portal channel hum; call stop() when it ends / is interrupted. */
export const tpHum = (e: AudioEngine, duration: number): Voice => {
  const ctx = e.ctx!;
  const t = e.now;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.4);
  g.gain.setValueAtTime(0.16, t + Math.max(0.4, duration - 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 4;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 4;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 450;
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);
  lp.connect(g);
  g.connect(e.bus('sfx'));
  const oscs = [110, 111.6, 220.4, 330].map((f, i) => {
    const o = ctx.createOscillator();
    o.type = i < 2 ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.5, t + duration);
    o.connect(lp);
    return o;
  });
  for (const o of [...oscs, lfo]) {
    o.start(t);
    o.stop(t + duration + 0.4);
  }
  let stopped = false;
  return {
    stop(fade = 0.15) {
      if (stopped) return;
      stopped = true;
      const n = e.now;
      g.gain.cancelScheduledValues(n);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n);
      g.gain.exponentialRampToValueAtTime(0.0001, n + fade);
      for (const o of [...oscs, lfo]) o.stop(n + fade + 0.02);
    },
  };
};

export const tpWhoosh = (e: AudioEngine): void => {
  const t = e.now;
  const out = e.bus('sfx');
  e.noise(t, 0.7, 'bandpass', 300, 2, e.env(t, 0.08, 0.6, 0.55, out), 4500);
  e.tone(t, 0.5, 'sine', 300, e.env(t, 0.02, 0.15, 0.45, out), 1400);
  e.noise(t, 0.8, 'bandpass', 1200, 1, e.env(t, 0.05, 0.4, 0.7, e.reverb), 3000);
};

// ---------------------------------------------------------------------------
// World: creeps, towers, footsteps
// ---------------------------------------------------------------------------

export type AttackSound = 'melee' | 'ranged' | 'siege' | 'tower' | 'hero_melee' | 'hero_ranged';

export const attackSound = (e: AudioEngine, kind: AttackSound, pos: P): void => {
  const t = e.now;
  const out = e.out(pos, 'sfx', kind === 'tower' ? 500 : 260);
  switch (kind) {
    case 'melee':
    case 'hero_melee': {
      const big = kind === 'hero_melee' ? 1.3 : 1;
      e.noise(t, 0.1, 'lowpass', jitter(900, 0.2), 0.8, e.env(t, 0.002, 0.45 * big, 0.08, out));
      e.tone(t, 0.12, 'sine', jitter(150, 0.15), e.env(t, 0.002, 0.35 * big, 0.1, out), 85);
      e.noise(t, 0.04, 'bandpass', jitter(2400, 0.2), 3, e.env(t, 0.001, 0.15, 0.03, out));
      return;
    }
    case 'ranged':
    case 'hero_ranged':
      e.tone(t, 0.14, 'triangle', jitter(700, 0.1), e.env(t, 0.002, 0.25, 0.12, out), 320);
      e.noise(t, 0.12, 'bandpass', 2600, 2, e.env(t, 0.005, 0.12, 0.1, out), 900);
      return;
    case 'siege':
      e.tone(t, 0.3, 'sine', 90, e.env(t, 0.003, 0.6, 0.25, out), 45);
      e.noise(t, 0.3, 'lowpass', 600, 0.6, e.env(t, 0.004, 0.4, 0.25, out), 150);
      return;
    case 'tower':
      e.tone(t, 0.4, 'sawtooth', 340, e.env(t, 0.005, 0.22, 0.35, out), 110);
      e.tone(t, 0.3, 'sine', 120, e.env(t, 0.003, 0.5, 0.25, out), 60);
      e.noise(t, 0.35, 'bandpass', 1400, 1.5, e.env(t, 0.004, 0.3, 0.3, out), 400);
      return;
  }
};

export const footstep = (e: AudioEngine, left: boolean): void => {
  const t = e.now;
  const out = e.bus('sfx');
  const f = left ? 650 : 560;
  e.noise(t, 0.08, 'lowpass', jitter(f, 0.15), 1, e.env(t, 0.004, 0.22, 0.07, out));
  e.tone(t, 0.06, 'sine', jitter(90, 0.1), e.env(t, 0.003, 0.18, 0.05, out), 60);
  e.noise(t, 0.03, 'bandpass', jitter(2200, 0.2), 2, e.env(t + 0.01, 0.002, 0.05, 0.025, out));
};

// ---------------------------------------------------------------------------
// Rewards / UI
// ---------------------------------------------------------------------------

const note = (e: AudioEngine, at: number, f: number, dur: number, gain: number, bus: Bus = 'sfx', type: OscillatorType = 'triangle'): void => {
  e.tone(at, dur + 0.05, type, f, e.env(at, 0.008, gain, dur, e.bus(bus)));
};

export const runePickup = (e: AudioEngine): void => {
  const t = e.now;
  [784, 1047, 1319, 1568].forEach((f, i) => note(e, t + i * 0.06, f, 0.35, 0.16, 'sfx', 'sine'));
  e.noise(t, 0.6, 'highpass', 6000, 0.7, e.env(t, 0.05, 0.08, 0.5, e.bus('sfx')));
};

export const levelUp = (e: AudioEngine): void => {
  const t = e.now;
  [523, 659, 784, 1047].forEach((f, i) => note(e, t + i * 0.09, f, 0.5, 0.17));
  [523, 659, 784].forEach((f) => note(e, t + 0.4, f, 0.9, 0.08, 'sfx', 'sine'));
};

export const goldClink = (e: AudioEngine, big = false): void => {
  const t = e.now;
  const out = e.bus('sfx');
  const n = big ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const at = t + i * 0.07;
    e.tone(at, 0.14, 'sine', jitter(2650, 0.03), e.env(at, 0.001, 0.12, 0.12, out));
    e.tone(at, 0.1, 'sine', jitter(3970, 0.03), e.env(at, 0.001, 0.07, 0.08, out));
  }
};

export const purchase = (e: AudioEngine): void => {
  goldClink(e, true);
  const t = e.now;
  e.noise(t, 0.12, 'bandpass', 900, 1.2, e.env(t, 0.005, 0.15, 0.1, e.bus('sfx')));
};

export const deathThud = (e: AudioEngine): void => {
  const t = e.now;
  e.tone(t, 0.9, 'sine', 90, e.env(t, 0.005, 0.5, 0.8, e.bus('stinger')), 40);
  [392, 311, 262].forEach((f, i) => note(e, t + 0.1 + i * 0.22, f, 0.6, 0.1, 'stinger', 'sawtooth'));
};

// ---------------------------------------------------------------------------
// Stingers (announcer is text-only; these are short synth cues)
// ---------------------------------------------------------------------------

/** Brass-ish chord stab through a lowpass. */
const stab = (e: AudioEngine, at: number, freqs: readonly number[], dur: number, gain: number, cutoff = 1800): void => {
  const ctx = e.ctx!;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(cutoff * 0.4, at);
  lp.frequency.exponentialRampToValueAtTime(cutoff, at + 0.06);
  lp.frequency.exponentialRampToValueAtTime(cutoff * 0.5, at + dur);
  const g = e.env(at, 0.02, gain, dur, e.bus('stinger'));
  lp.connect(g);
  for (const f of freqs) {
    e.tone(at, dur + 0.05, 'sawtooth', f, lp, undefined, -6);
    e.tone(at, dur + 0.05, 'sawtooth', f, lp, undefined, 7);
  }
};

const timpani = (e: AudioEngine, at: number, f = 55, gain = 0.6): void => {
  e.tone(at, 0.8, 'sine', f * 1.5, e.env(at, 0.003, gain, 0.7, e.bus('stinger')), f);
  e.noise(at, 0.2, 'lowpass', 400, 0.7, e.env(at, 0.002, gain * 0.4, 0.15, e.bus('stinger')));
};

export type StingerKind = 'firstblood' | 'multikill' | 'streak' | 'tower' | 'roshan' | 'rune' | 'aegis' | 'generic' | 'playerKill';

/** Which stinger an announcer line gets. Pure. */
export const stingerFor = (text: string): StingerKind => {
  const s = text.toLowerCase();
  if (s.includes('first blood')) return 'firstblood';
  if (/double kill|triple kill|ultra kill|rampage/.test(s)) return 'multikill';
  if (/killing spree|dominating|mega kill|unstoppable|wicked sick|monster kill|godlike|holy shit/.test(s)) return 'streak';
  if (/tower|barracks|rax/.test(s)) return 'tower';
  if (s.includes('aegis')) return 'aegis';
  if (s.includes('roshan')) return 'roshan';
  if (s.includes('rune')) return 'rune';
  return 'generic';
};

/** Multi-kill count from an announcer line (2 = double … 5 = rampage). Pure. */
export const multiKillCount = (text: string): number => {
  const s = text.toLowerCase();
  if (s.includes('rampage')) return 5;
  if (s.includes('ultra kill')) return 4;
  if (s.includes('triple kill')) return 3;
  return 2;
};

export const stinger = (e: AudioEngine, kind: StingerKind, text = ''): void => {
  const t = e.now + 0.02;
  switch (kind) {
    case 'firstblood':
      timpani(e, t, 49, 0.8);
      stab(e, t, [110, 165, 220], 1.1, 0.16, 1400);
      stab(e, t + 0.35, [98, 147, 196], 1.3, 0.14, 1100);
      return;
    case 'multikill': {
      const n = multiKillCount(text);
      const base = [262, 330, 392, 523, 659];
      for (let i = 0; i < n; i++) stab(e, t + i * 0.13, [base[i]!, base[i]! * 1.5], 0.22 + (i === n - 1 ? 0.5 : 0), 0.12, 2400);
      timpani(e, t + (n - 1) * 0.13, 65, 0.5);
      return;
    }
    case 'streak':
      stab(e, t, [196, 247, 294], 0.18, 0.12, 2200);
      stab(e, t + 0.18, [220, 277, 330], 0.18, 0.12, 2200);
      stab(e, t + 0.36, [262, 330, 392], 0.8, 0.14, 2600);
      timpani(e, t + 0.36, 65, 0.5);
      return;
    case 'tower':
      timpani(e, t, 41, 0.8);
      e.noise(t, 1.4, 'lowpass', 900, 0.6, e.env(t, 0.01, 0.4, 1.2, e.bus('stinger')), 120);
      stab(e, t + 0.1, [87, 131], 1.2, 0.12, 900);
      return;
    case 'roshan':
      e.tone(t, 1.6, 'sawtooth', 55, e.env(t, 0.2, 0.18, 1.3, e.bus('stinger')), 41);
      e.noise(t, 1.5, 'bandpass', 220, 3, e.env(t, 0.3, 0.3, 1.1, e.bus('stinger')), 140);
      timpani(e, t + 0.6, 37, 0.7);
      return;
    case 'aegis':
      [523, 784, 1047, 1568].forEach((f, i) => note(e, t + i * 0.08, f, 0.8, 0.1, 'stinger', 'sine'));
      return;
    case 'rune':
      runePickup(e);
      return;
    case 'playerKill':
      stab(e, t, [330, 494], 0.14, 0.1, 2800);
      stab(e, t + 0.14, [440, 659], 0.45, 0.11, 3000);
      return;
    case 'generic':
      [659, 880].forEach((f, i) => note(e, t + i * 0.12, f, 0.5, 0.1, 'stinger', 'sine'));
      return;
  }
};

/** The 0:00 horn: detuned saw stack swelling in, with a fifth on top. */
export const matchHorn = (e: AudioEngine): void => {
  const ctx = e.ctx!;
  const t = e.now + 0.02;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.linearRampToValueAtTime(1300, t + 0.5);
  lp.frequency.linearRampToValueAtTime(900, t + 2.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.45);
  g.gain.setValueAtTime(0.22, t + 2.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  lp.connect(g);
  g.connect(e.bus('stinger'));
  for (const [f, d] of [
    [146.8, -8],
    [146.8, 9],
    [73.4, 0],
    [220, 4],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.94, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.25);
    o.detune.value = d;
    o.connect(lp);
    o.start(t);
    o.stop(t + 3.3);
  }
  e.noise(t, 3, 'bandpass', 600, 1, e.env(t, 0.5, 0.25, 2.4, e.reverb));
};

export const victory = (e: AudioEngine): void => {
  const t = e.now + 0.05;
  const seq: Array<[number, number[], number]> = [
    [0, [262, 330, 392], 0.25],
    [0.28, [262, 330, 392], 0.12],
    [0.42, [294, 370, 440], 0.25],
    [0.72, [330, 415, 494], 0.25],
    [1.02, [392, 494, 587, 784], 1.8],
  ];
  for (const [dt, freqs, dur] of seq) stab(e, t + dt, freqs, dur, 0.13, 2800);
  timpani(e, t, 65, 0.6);
  timpani(e, t + 1.02, 49, 0.8);
};

export const defeat = (e: AudioEngine): void => {
  const t = e.now + 0.05;
  const seq: Array<[number, number[], number]> = [
    [0, [220, 262, 330], 0.7],
    [0.75, [196, 233, 294], 0.7],
    [1.5, [175, 208, 262], 0.7],
    [2.25, [147, 175, 220], 2.2],
  ];
  for (const [dt, freqs, dur] of seq) stab(e, t + dt, freqs, dur, 0.12, 1100);
  timpani(e, t + 2.25, 37, 0.8);
};
