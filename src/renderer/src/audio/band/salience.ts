import { FFT_SIZE } from '@shared/types/audio';
import { hzOf } from './yin';

/**
 * Harmonic salience: for each candidate pitch, the weighted sum of the
 * spectrum's peaks at its harmonics. A pitch's own harmonics all line up, so
 * its sum beats the octave below (which only collects every other one) and
 * the octave above (half of them). The bin ranges are worked out once.
 */
export class Salience {
  readonly midi: Float32Array;
  /** Per candidate × harmonic: first and last bin to look in. */
  private readonly k0: Int16Array;
  private readonly k1: Int16Array;
  private readonly w: Float32Array;
  readonly values: Float32Array;

  constructor(
    readonly sampleRate: number,
    readonly loMidi: number,
    readonly hiMidi: number,
    readonly step = 0.25,
    readonly harmonics = 10,
    decay = 0.84,
    readonly fftSize = FFT_SIZE,
  ) {
    const n = Math.floor((hiMidi - loMidi) / step) + 1;
    this.midi = new Float32Array(n);
    this.values = new Float32Array(n);
    this.k0 = new Int16Array(n * harmonics);
    this.k1 = new Int16Array(n * harmonics);
    this.w = new Float32Array(harmonics);
    for (let h = 0; h < harmonics; h++) this.w[h] = Math.pow(decay, h);
    const binHz = sampleRate / fftSize;
    const half = fftSize / 2 - 1;
    for (let c = 0; c < n; c++) {
      const m = loMidi + c * step;
      this.midi[c] = m;
      const f = hzOf(m);
      for (let h = 0; h < harmonics; h++) {
        const fh = f * (h + 1);
        // ±1/4 semitone around the harmonic, at least the nearest bin.
        const a = Math.floor((fh * 0.9856) / binHz);
        const b = Math.ceil((fh * 1.0146) / binHz);
        const i = c * harmonics + h;
        this.k0[i] = Math.min(half, Math.max(1, a));
        this.k1[i] = Math.min(half, Math.max(this.k0[i], b));
      }
    }
  }

  /**
   * Fill `values` from a peak spectrum (amplitudes at peaks, 0 elsewhere);
   * returns the best candidate. A real pitch has its odd harmonics too (the
   * fundamental, the 3rd, the 5th); the octave below a note collects only the
   * note's own harmonics, at its even ones, so it is marked down. `contrast`
   * is the best value over the mean: high for one clear harmonic series.
   */
  compute(peaks: Float32Array): number {
    const { harmonics: H, k0, k1, w, values } = this;
    let best = 0;
    let total = 0;
    for (let c = 0; c < values.length; c++) {
      let s = 0;
      let odd = 0;
      for (let h = 0; h < H; h++) {
        const i = c * H + h;
        let m = 0;
        for (let k = k0[i]; k <= k1[i]; k++) if (peaks[k] > m) m = peaks[k];
        s += m * w[h];
        if ((h & 1) === 0) odd += m * w[h];
      }
      const v = s > 0 ? s * (0.25 + 1.5 * Math.min(0.5, odd / s)) : 0;
      values[c] = v;
      total += v;
      if (v > values[best]) best = c;
    }
    this.contrast = total > 0 ? (values[best] * values.length) / total : 0;
    return best;
  }

  contrast = 0;

  /** Bin ranges of the harmonics of candidate c (to mask them out of a spectrum). */
  harmonicBins(c: number, h: number): [number, number] {
    const i = c * this.harmonics + h;
    return [this.k0[i], this.k1[i]];
  }
}

/** Keep a spectrum's local peaks (sqrt-compressed), zero elsewhere. */
export function peaksOf(mag: Float32Array, out: Float32Array, from: number, to: number, floor = 0): void {
  out.fill(0);
  for (let k = Math.max(1, from); k < Math.min(mag.length - 1, to); k++) {
    const m = mag[k];
    if (m > floor && m >= mag[k - 1] && m >= mag[k + 1]) out[k] = Math.sqrt(m);
  }
}
