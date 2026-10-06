import type { AudioFrame, BandName } from '@shared/types/audio';
import type { ModCurve, ModShape, Modulator } from '@shared/types/engine';

/**
 * Evaluates modulators. Everything derives from the shared audio clock, the
 * beat counter and onset events, so the preview and the output window compute
 * the same values without talking to each other (random values are hashed
 * from the beat index, not drawn from Math.random).
 */

export function applyCurve(x: number, curve: ModCurve | undefined): number {
  const v = x < 0 ? 0 : x > 1 ? 1 : x;
  switch (curve) {
    case 'exp':
      return v * v;
    case 'log':
      return Math.sqrt(v);
    case 'smooth':
      return v * v * (3 - 2 * v);
    default:
      return v;
  }
}

/** Periodic waveform, phase 0..1 → 0..1. */
export function shapeWave(p: number, shape: ModShape | undefined): number {
  const x = p - Math.floor(p);
  switch (shape) {
    case 'saw':
      return x;
    case 'ramp':
      return 1 - x;
    case 'square':
      return x < 0.5 ? 1 : 0;
    case 'bounce':
      return Math.abs(Math.sin(Math.PI * x));
    case 'stepped':
      return Math.floor(x * 4) / 3;
    default:
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
  }
}

/** Deterministic hash → [0, 1). */
export function hash01(n: number, seed: number): number {
  let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

function smoothNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash01(i, seed) * (1 - u) + hash01(i + 1, seed) * u;
}

/** Beat index (mod phrase) that starts a phrase, recovered from the frame. */
export function phraseOrigin(f: AudioFrame): number {
  const p = f.beatsPerPhrase;
  const start = Math.round(f.beat - f.phrasePhase * p);
  return ((start % p) + p) % p;
}

/** Beats elapsed since a phrase-aligned origin; tempo and random modulators count from here. */
export function alignedBeat(f: AudioFrame): number {
  return f.beat - phraseOrigin(f);
}

interface ModState {
  trigTime: number;
  seed: number;
}

const BANDS = new Set<string>(['sub', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'air']);

export class ModulationEngine {
  private readonly states = new Map<string, ModState>();

  private state(key: string): ModState {
    let s = this.states.get(key);
    if (!s) {
      s = { trigTime: -Infinity, seed: seedOf(key) };
      this.states.set(key, s);
    }
    return s;
  }

  /** Drop state for modulators that no longer exist. */
  retain(keys: Set<string>): void {
    for (const k of this.states.keys()) if (!keys.has(k)) this.states.delete(k);
  }

  /** Source value 0..1 before curve/invert/amount. `key` identifies the modulator instance. */
  sample(m: Modulator, key: string, f: AudioFrame): number {
    const src = m.source;
    if (src.startsWith('audio.')) {
      const name = src.slice(6);
      if (BANDS.has(name)) return f.bands[name as BandName];
      switch (name) {
        case 'rms':
          return Math.min(1, f.rms / 0.25);
        case 'energy':
          return f.energy;
        case 'flux':
          return f.flux;
        case 'brightness':
          return f.brightness;
      }
      if (name.startsWith('onset.')) {
        // A one-frame trigger is useless as a level, so onsets become a fast decay.
        const kind = name.slice(6) as 'kick' | 'snare' | 'hat' | 'any';
        return this.envelope(m, key, f, f.onsets[kind], 0, 0, m.decayMs ?? 150);
      }
      return 0;
    }
    if (src.startsWith('tempo.')) {
      const defaultRate = src === 'tempo.beat' ? 1 : src === 'tempo.bar' ? f.beatsPerBar : f.beatsPerPhrase;
      const rate = Math.max(0.0625, m.rate ?? defaultRate);
      return shapeWave(alignedBeat(f) / rate, m.shape);
    }
    if (src === 'lfo') return shapeWave(f.time * (m.hz ?? 0.25), m.shape);
    if (src === 'envelope') {
      const trig = m.trigger ?? 'onset.kick';
      const fired =
        trig === 'drop' ? f.drop : trig === 'downbeat' ? f.isDownbeat : trig === 'phrase' ? f.isPhraseStart : f.onsets[trig.slice(6) as 'kick' | 'snare' | 'hat' | 'any'];
      return this.envelope(m, key, f, fired, m.attackMs ?? 5, m.holdMs ?? 30, m.decayMs ?? 250);
    }
    if (src === 'random') {
      const s = this.state(key);
      if (m.randomMode === 'smooth') return smoothNoise(f.time * (m.hz ?? 0.3), s.seed);
      const rate = Math.max(0.25, m.rate ?? 1);
      return hash01(Math.floor(alignedBeat(f) / rate), s.seed);
    }
    return 0;
  }

  private envelope(m: Modulator, key: string, f: AudioFrame, fired: boolean, attackMs: number, holdMs: number, decayMs: number): number {
    const s = this.state(key);
    if (fired) s.trigTime = f.time;
    const t = (f.time - s.trigTime) * 1000;
    if (!(t >= 0)) return 0;
    if (t < attackMs) return t / attackMs;
    if (t < attackMs + holdMs) return 1;
    const x = 1 - (t - attackMs - holdMs) / Math.max(1, decayMs);
    if (x <= 0) return 0;
    // Envelope curve shapes the decay; the modulator curve is applied later on top.
    return m.source === 'envelope' ? x : x * x;
  }

  /**
   * Contribution in parameter-range units: offset + amount × curve(source),
   * inverted / clamped as configured. Audio-driven sources scale with `reactivity`.
   */
  contribution(m: Modulator, key: string, f: AudioFrame, reactivity = 1): number {
    let v = applyCurve(this.sample(m, key, f), m.curve);
    if (m.invert) v = 1 - v;
    const audioDriven = m.source.startsWith('audio.') || (m.source === 'envelope' && (m.trigger ?? 'onset.kick').startsWith('onset.'));
    let c = (m.offset ?? 0) + m.amount * (audioDriven ? reactivity : 1) * v;
    if (m.clamp) c = Math.min(m.clamp[1], Math.max(m.clamp[0], c));
    return c;
  }
}
