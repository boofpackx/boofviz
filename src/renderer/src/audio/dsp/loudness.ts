/** Biquad in transposed direct form II. */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = this.z2 = 0;
  }
}

/** ITU-R BS.1770 K-weighting (pre-filter shelf + RLB high-pass) for any sample rate. */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf (+4 dB above ~1.7 kHz).
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf = new Biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // Stage 2: high-pass.
  const hf0 = 38.13547087602444;
  const hQ = 0.5003270373238773;
  const hK = Math.tan((Math.PI * hf0) / sampleRate);
  const ha0 = 1 + hK / hQ + hK * hK;
  const highpass = new Biquad(1, -2, 1, (2 * (hK * hK - 1)) / ha0, (1 - hK / hQ + hK * hK) / ha0);
  return [shelf, highpass];
}

/**
 * Momentary loudness (400 ms rectangular window) from per-block K-weighted
 * sums of squares. Feed one block at a time; read `lufs`.
 */
export class MomentaryLoudness {
  private readonly sums: Float64Array;
  private readonly counts: Uint32Array;
  private idx = 0;
  private total = 0;
  private totalCount = 0;
  lufs = -70;

  constructor(blocksPerWindow: number) {
    this.sums = new Float64Array(Math.max(1, blocksPerWindow));
    this.counts = new Uint32Array(Math.max(1, blocksPerWindow));
  }

  /** `sumSq` is Σ over channels of Σ samples² for this block; `frames` is samples per channel. */
  push(sumSq: number, frames: number): number {
    this.total += sumSq - this.sums[this.idx];
    this.totalCount += frames - this.counts[this.idx];
    this.sums[this.idx] = sumSq;
    this.counts[this.idx] = frames;
    this.idx = (this.idx + 1) % this.sums.length;
    const ms = this.totalCount > 0 ? Math.max(0, this.total) / this.totalCount : 0;
    this.lufs = ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -70;
    return this.lufs;
  }
}
