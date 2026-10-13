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

/**
 * A structured dance track: four-on-the-floor kick (equal on every beat), snare
 * on 2 & 4, 8th hats, a bass note that changes on every downbeat, and every
 * `phraseBars` bars a new section (crash + a pad chord that toggles), so both
 * the downbeat and the phrase start are musically marked, as in real tracks.
 */
export function structuredTrack(p: { bpm: number; bars: number; phraseBars: number; sr?: number }): { samples: Float32Array; barStarts: number[]; phraseStarts: number[] } {
  const sr = p.sr ?? SR;
  const beat = 60 / p.bpm;
  const total = Math.round(p.bars * 4 * beat * sr);
  const out = new Float32Array(total);
  const rand = rng(11);
  const barStarts: number[] = [];
  const phraseStarts: number[] = [];
  const roots = [55, 65.41, 49, 73.42];
  for (let bar = 0; bar < p.bars; bar++) {
    const tb = bar * 4 * beat;
    barStarts.push(tb);
    const phraseStart = bar % p.phraseBars === 0;
    if (phraseStart) phraseStarts.push(tb);
    const section = Math.floor(bar / p.phraseBars) % 2;
    // Bass note for the whole bar.
    const f0 = roots[bar % roots.length];
    const s0 = Math.round(tb * sr);
    const len = Math.round(4 * beat * sr);
    for (let i = 0; i < len && s0 + i < total; i++) {
      const t = i / sr;
      const env = Math.min(1, t * 200) * (0.6 + 0.4 * Math.exp(-t * 3));
      out[s0 + i] += 0.18 * env * Math.sin(2 * Math.PI * f0 * t);
      // Pad chord only in odd sections: a big spectral change at phrase boundaries.
      if (section === 1) out[s0 + i] += 0.05 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554.4 * t) + Math.sin(2 * Math.PI * 659.3 * t));
    }
    if (phraseStart) {
      for (let i = 0; i < 0.6 * sr && s0 + i < total; i++) out[s0 + i] += 0.25 * (rand() * 2 - 1) * Math.exp((-i / sr) * 5);
    }
    for (let b = 0; b < 4; b++) {
      const t0 = tb + b * beat;
      const st = Math.round(t0 * sr);
      let ph = 0;
      for (let i = 0; i < 0.25 * sr && st + i < total; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * (50 + 110 * Math.exp(-t * 30))) / sr;
        out[st + i] += 0.7 * Math.sin(ph) * Math.exp(-t * 9);
      }
      if (b % 2 === 1) for (let i = 0; i < 0.15 * sr && st + i < total; i++) out[st + i] += 0.3 * (rand() * 2 - 1) * Math.exp((-i / sr) * 25);
      const sh = Math.round((t0 + beat / 2) * sr);
      let prev = 0;
      for (let i = 0; i < 0.04 * sr && sh + i < total; i++) {
        const x = rand() * 2 - 1;
        out[sh + i] += 0.15 * (x - prev) * Math.exp((-i / sr) * 90);
        prev = x;
      }
    }
  }
  return { samples: out, barStarts, phraseStarts };
}

/**
 * A band with a riff: kick on 1 and 3, snare on 2 and 4, 8th hats, and a
 * plucked lead riff on the 8ths between them (a two-bar figure, so the tune
 * repeats every two bars while the drums repeat every bar). `switchBar` swaps
 * to a different groove and riff from that bar on.
 */
export function riffTrack(p: { bpm: number; bars: number; switchBar?: number; sr?: number }): { samples: Float32Array } {
  const sr = p.sr ?? SR;
  const beat = 60 / p.bpm;
  const total = Math.round((p.bars * 4 * beat + 0.5) * sr);
  const out = new Float32Array(total);
  const rand = rng(23);
  const add = (t0: number, len: number, fn: (t: number) => number): void => {
    const st = Math.round(t0 * sr);
    for (let i = 0; i < len * sr && st + i < total; i++) out[st + i] += fn(i / sr);
  };
  const kick = (t0: number): void => {
    let ph = 0;
    add(t0, 0.25, (t) => {
      ph += (2 * Math.PI * (50 + 110 * Math.exp(-t * 30))) / sr;
      return 0.75 * Math.sin(ph) * Math.exp(-t * 9);
    });
  };
  const snare = (t0: number): void => add(t0, 0.16, (t) => (0.32 * (rand() * 2 - 1) + 0.2 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 24));
  const hat = (t0: number): void => {
    let prev = 0;
    add(t0, 0.04, (t) => {
      const x = rand() * 2 - 1;
      const v = 0.14 * (x - prev) * Math.exp(-t * 90);
      prev = x;
      return v;
    });
  };
  // A plucked note: a few harmonics with a fast attack and a decay.
  const pluck = (t0: number, f: number, len: number): void =>
    add(t0, len, (t) => {
      const env = Math.min(1, t * 400) * Math.exp(-t * 3.5);
      return 0.16 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
    });
  // Riff notes as [eighth in the two-bar figure, semitones above A3 (220 Hz), length in eighths].
  const riffA: Array<[number, number, number]> = [[1, 0, 1], [3, 3, 1], [5, 7, 1], [7, 5, 2], [9, 0, 1], [11, 10, 1], [13, 12, 2], [15, 7, 1]];
  const riffB: Array<[number, number, number]> = [[1, 12, 1], [2, 10, 1], [5, 7, 3], [9, 3, 1], [10, 5, 1], [13, 0, 3]];
  for (let bar = 0; bar < p.bars; bar++) {
    const tb = bar * 4 * beat;
    const b = p.switchBar !== undefined && bar >= p.switchBar;
    for (let k = 0; k < 4; k++) {
      const t0 = tb + k * beat;
      // Groove A: kick 1 & 3, snare 2 & 4. Groove B: kick on every beat and the "and" of 4, snare on 3.
      if (!b ? k % 2 === 0 : true) kick(t0);
      if (b && k === 3) kick(t0 + beat / 2);
      if (!b ? k % 2 === 1 : k === 2) snare(t0);
      hat(t0 + beat / 2);
    }
    const riff = b ? riffB : riffA;
    for (const [e, semi, len] of riff) {
      const inBar = e - (bar % 2) * 8;
      if (inBar < 0 || inBar >= 8) continue;
      pluck(tb + (inBar * beat) / 2, 220 * Math.pow(2, semi / 12), (len * beat) / 2);
    }
  }
  return { samples: out };
}
