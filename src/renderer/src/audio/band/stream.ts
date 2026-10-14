import { HOP_SIZE, type RawHop } from '@shared/types/audio';
import { Biquad } from '../dsp/loudness';

/** RBJ low-pass biquad (Q = 1/√2 for Butterworth stages). */
export function lowpass(sampleRate: number, f0: number, q: number): Biquad {
  const w = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return new Biquad((1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0);
}

/**
 * The analysis stream rebuilt from the worklet's hops: every hop carries the
 * newest WAVEFORM_SIZE samples of each channel, of which the newest HOP_SIZE
 * are new. Keeps the last `size` samples of mid ((L+R)/2) and side ((L−R)/2),
 * and a low-passed, decimated mid stream for the bass tracker.
 */
export class StereoStream {
  readonly mid: Float32Array;
  readonly side: Float32Array;
  /** Index of the next sample to write (mid/side rings). */
  write = 0;
  readonly low: Float32Array;
  lowWrite = 0;
  /** Decimation factor and rate of the low stream. */
  readonly decimate: number;
  readonly lowRate: number;
  private readonly lp: Biquad[];
  private phase = 0;

  constructor(
    readonly sampleRate: number,
    readonly size = 8192,
    lowCutoff = 180,
    lowTargetRate = 6000,
  ) {
    this.mid = new Float32Array(size);
    this.side = new Float32Array(size);
    this.decimate = Math.max(1, Math.round(sampleRate / lowTargetRate));
    this.lowRate = sampleRate / this.decimate;
    this.low = new Float32Array(2048);
    // Fourth-order Butterworth: two stages with the matching Qs.
    this.lp = [lowpass(sampleRate, lowCutoff, 0.5412), lowpass(sampleRate, lowCutoff, 1.3066)];
  }

  push(hop: RawHop): void {
    const n = hop.left.length;
    const mask = this.size - 1;
    const lowMask = this.low.length - 1;
    const [a, b] = this.lp;
    for (let i = n - HOP_SIZE; i < n; i++) {
      const l = hop.left[i];
      const r = hop.right[i];
      const m = 0.5 * (l + r);
      this.mid[this.write] = m;
      this.side[this.write] = 0.5 * (l - r);
      this.write = (this.write + 1) & mask;
      const y = b.process(a.process(m));
      if (++this.phase >= this.decimate) {
        this.phase = 0;
        this.low[this.lowWrite] = y;
        this.lowWrite = (this.lowWrite + 1) & lowMask;
      }
    }
  }

  /** Copy the newest `out.length` samples of a ring into `out`, oldest first. */
  static latest(ring: Float32Array, write: number, out: Float32Array): void {
    const mask = ring.length - 1;
    const n = out.length;
    for (let i = 0; i < n; i++) out[i] = ring[(write - n + i + ring.length * 4) & mask];
  }
}
