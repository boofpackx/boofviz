/** Synthetic test signals. */
export const SR = 48000;

export function sine(freq: number, seconds: number, amp = 1, sr = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/** Deterministic PRNG so tests are reproducible. */
export function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface DrumPattern {
  bpm: number;
  seconds: number;
  /** Kick on every beat. */
  kick?: boolean;
  /** Snare on beats 2 and 4. */
  snare?: boolean;
  /** Closed hats on 8ths. */
  hats?: boolean;
  /** Seconds of silence before the pattern starts. */
  offset?: number;
  sr?: number;
}

/** Simple four-on-the-floor drum loop with a sustained pad underneath. */
export function drumLoop(p: DrumPattern): { samples: Float32Array; kickTimes: number[]; snareTimes: number[]; hatTimes: number[] } {
  const sr = p.sr ?? SR;
  const total = Math.round((p.seconds + (p.offset ?? 0)) * sr);
  const out = new Float32Array(total);
  const rand = rng(7);
  const beat = 60 / p.bpm;
  const kickTimes: number[] = [];
  const snareTimes: number[] = [];
  const hatTimes: number[] = [];
  const offset = p.offset ?? 0;
  // Quiet pad so the gate stays open and the spectrum is never empty.
  for (let i = Math.round(offset * sr); i < total; i++) {
    const t = i / sr;
    out[i] += 0.04 * (Math.sin(2 * Math.PI * 220 * t) + 0.6 * Math.sin(2 * Math.PI * 330 * t));
  }
  for (let b = 0; (b + 1) * beat <= p.seconds; b++) {
    const t0 = offset + b * beat;
    if (p.kick !== false) {
      kickTimes.push(t0);
      const start = Math.round(t0 * sr);
      let phase = 0;
      for (let i = 0; i < 0.25 * sr && start + i < total; i++) {
        const t = i / sr;
        const f = 50 + 110 * Math.exp(-t * 30);
        phase += (2 * Math.PI * f) / sr;
        out[start + i] += 0.8 * Math.sin(phase) * Math.exp(-t * 9);
      }
    }
    if (p.snare && b % 2 === 1) {
      snareTimes.push(t0);
      const start = Math.round(t0 * sr);
      for (let i = 0; i < 0.18 * sr && start + i < total; i++) {
        const t = i / sr;
        out[start + i] += (0.35 * (rand() * 2 - 1) + 0.25 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 22);
      }
    }
    if (p.hats) {
      for (const sub of [0.5]) {
        const th = t0 + sub * beat;
        hatTimes.push(th);
        const start = Math.round(th * sr);
        let prev = 0;
        for (let i = 0; i < 0.05 * sr && start + i < total; i++) {
          const n = rand() * 2 - 1;
          const hp = n - prev; // crude high-pass
          prev = n;
          out[start + i] += 0.2 * hp * Math.exp((-i / sr) * 90);
        }
      }
    }
  }
  return { samples: out, kickTimes, snareTimes, hatTimes };
}
