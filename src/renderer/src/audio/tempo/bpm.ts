/**
 * Autocorrelation tempo estimator over an onset-strength envelope.
 *
 * Every `update()` it detrends the last ~8 s of envelope, scores candidate beat
 * periods with a harmonic comb (lag, 2·lag, 4·lag) and a mild tempo prior,
 * refines the winning lag with parabolic interpolation, then finds the beat
 * phase by folding the envelope at that period.
 */
export interface TempoEstimate {
  bpm: number;
  confidence: number;
  /** Envelope-time (seconds) of the most recent beat. */
  beatTime: number;
}

export class BpmEstimator {
  private static readonly KERNEL = (() => {
    const k = [-3, -2, -1, 0, 1, 2, 3].map((i) => Math.exp(-0.5 * (i / 1.5) ** 2));
    const sum = k.reduce((a, b) => a + b, 0);
    return Float32Array.from(k.map((v) => v / sum));
  })();
  private readonly env: Float32Array;
  private readonly times: Float64Array;
  private write = 0;
  private filled = 0;
  private readonly work: Float32Array;
  private readonly ac: Float32Array;

  constructor(
    private readonly hopRate: number,
    windowSec = 8,
  ) {
    const n = Math.round(windowSec * hopRate);
    this.env = new Float32Array(n);
    this.times = new Float64Array(n);
    this.work = new Float32Array(n);
    this.ac = new Float32Array(n);
  }

  push(value: number, time: number): void {
    this.env[this.write] = value;
    this.times[this.write] = time;
    this.write = (this.write + 1) % this.env.length;
    if (this.filled < this.env.length) this.filled++;
  }

  get secondsBuffered(): number {
    return this.filled / this.hopRate;
  }

  reset(): void {
    this.filled = 0;
    this.write = 0;
  }

  update(minBpm: number, maxBpm: number): TempoEstimate | null {
    const n = this.filled;
    if (n < this.hopRate * 4) return null;
    const N = this.env.length;
    const x = this.work;
    const start = (this.write - n + N) % N;
    // Light Gaussian blur (σ ≈ 1.5 hops) so one- or two-hop-wide onset spikes
    // still correlate at fractional lags; then remove the mean.
    const kernel = BpmEstimator.KERNEL;
    const half = (kernel.length - 1) / 2;
    let mean = 0;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let k = 0; k < kernel.length; k++) {
        const j = i + k - half;
        if (j >= 0 && j < n) v += kernel[k] * this.env[(start + j) % N];
      }
      x[i] = v;
      mean += v;
    }
    mean /= n;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      x[i] -= mean;
      energy += x[i] * x[i];
    }
    if (energy < 1e-9) return null;

    // Search a slightly wider range than requested so octave folding has room.
    const lagMin = Math.max(2, Math.floor((60 * this.hopRate) / (maxBpm * 1.05)));
    const lagMax = Math.min(Math.floor(n / 2) - 1, Math.ceil((60 * this.hopRate) / (minBpm * 0.95)));
    const acMax = Math.min(n - 2, lagMax * 4 + 6);
    const ac = this.ac;
    for (let lag = 1; lag <= acMax; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
      ac[lag] = s / (energy * (n - lag) / n);
    }

    const acAt = (l: number): number => {
      const k = Math.floor(l);
      if (k + 1 > acMax) return 0;
      const f = l - k;
      return ac[k] * (1 - f) + ac[k + 1] * f;
    };

    // Full harmonic comb: a true beat period correlates at 1, 2, 3 and 4 beats,
    // while a 3/4- or 4/3-beat impostor only lines up on some of them.
    const comb = (l: number): number => (acAt(l) + acAt(2 * l) + acAt(3 * l) + acAt(4 * l)) / 4;

    let bestLag = -1;
    let bestScore = -Infinity;
    const scores: number[] = [];
    const STEP = 0.25;
    for (let lag = lagMin; lag <= lagMax; lag += STEP) {
      const bpm = (60 * this.hopRate) / lag;
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 125) / 1.1) ** 2);
      const score = comb(lag) * (0.75 + 0.25 * prior);
      scores.push(score);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    if (bestLag < 0 || bestScore <= 0) return null;

    // Octave check: if half the period is itself strongly periodic (a kick on
    // every beat, not just every other), the faster tempo is the beat.
    const halfLag = bestLag / 2;
    if (halfLag >= lagMin && acAt(halfLag) > 0.35 * acAt(bestLag) && comb(halfLag) > 0.6 * comb(bestLag)) {
      bestLag = halfLag;
      bestScore = comb(halfLag);
    }

    // Fine search around the winner: the comb's higher multiples give sub-hop precision.
    let lag = bestLag;
    let fineBest = comb(bestLag);
    for (let l = bestLag - STEP; l <= bestLag + STEP; l += 0.01) {
      const c = comb(l);
      if (c > fineBest) {
        fineBest = c;
        lag = l;
      }
    }

    let bpm = (60 * this.hopRate) / lag;
    while (bpm < minBpm) bpm *= 2;
    while (bpm > maxBpm) bpm /= 2;
    const period = (60 * this.hopRate) / bpm;

    // Confidence: how far the winner stands above the typical score.
    const sorted = scores.slice().sort((p, q) => p - q);
    const median = sorted[Math.floor(sorted.length / 2)];
    const confidence = Math.max(0, Math.min(1, (bestScore - Math.max(0, median)) / (Math.abs(bestScore) + 1e-6)));

    // Phase: fold the envelope at `period`, weighting recent beats more.
    const steps = Math.max(8, Math.round(period));
    let bestPhase = 0;
    let bestFold = -Infinity;
    for (let s = 0; s < steps; s++) {
      const offset = (s / steps) * period; // hops back from newest sample
      let fold = 0;
      let w = 1;
      for (let pos = n - 1 - offset; pos >= 1; pos -= period) {
        const k = Math.floor(pos);
        const f = pos - k;
        const v = x[k] * (1 - f) + x[k + 1 < n ? k + 1 : k] * f;
        fold += v * w;
        w *= 0.93;
      }
      if (fold > bestFold) {
        bestFold = fold;
        bestPhase = offset;
      }
    }
    const newestTime = this.times[(this.write - 1 + N) % N];
    return { bpm, confidence, beatTime: newestTime - bestPhase / this.hopRate };
  }
}

/** Tap tempo: averages the last 4–8 taps by least squares; resets after a 2 s gap. */
export class TapTempo {
  private taps: number[] = [];

  tap(t: number): { bpm: number; lastTap: number } | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && t - last > 2) this.taps = [];
    this.taps.push(t);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length < 2) return null;
    const n = this.taps.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += i;
      sy += this.taps[i];
      sxx += i * i;
      sxy += i * this.taps[i];
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    if (!(slope > 0)) return null;
    return { bpm: 60 / slope, lastTap: t };
  }

  get count(): number {
    return this.taps.length;
  }
}
