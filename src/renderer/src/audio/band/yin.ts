/**
 * YIN pitch estimation (de Cheveigné & Kawahara 2002): the cumulative-mean
 * normalised difference function, the first dip under a threshold, and
 * parabolic interpolation. Allocation-free after construction.
 */
export class Yin {
  private readonly d: Float32Array;

  constructor(
    readonly window: number,
    readonly tauMin: number,
    readonly tauMax: number,
    readonly threshold = 0.15,
  ) {
    this.d = new Float32Array(tauMax + 2);
  }

  /**
   * `x` holds window + tauMax samples (oldest first). Returns the period in
   * samples (0: none found) and the aperiodicity at it (0 = perfectly periodic).
   */
  run(x: Float32Array, out: { period: number; aperiodicity: number }): void {
    const { window: W, tauMin, tauMax, d } = this;
    d[0] = 1;
    let sum = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let acc = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[j] - x[j + tau];
        acc += diff * diff;
      }
      sum += acc;
      d[tau] = sum > 0 ? (acc * tau) / sum : 1;
    }
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < this.threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      // No clear dip: the global minimum, reported with its (high) aperiodicity.
      let m = Infinity;
      for (let tau = tauMin; tau <= tauMax; tau++)
        if (d[tau] < m) {
          m = d[tau];
          best = tau;
        }
    }
    const a = d[best - 1] ?? d[best];
    const b = d[best];
    const c = d[best + 1] ?? d[best];
    const den = a - 2 * b + c;
    const shift = Math.abs(den) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    out.period = best + shift;
    out.aperiodicity = b;
  }
}

export function midiOf(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function hzOf(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
