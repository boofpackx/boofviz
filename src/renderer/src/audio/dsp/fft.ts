/**
 * Iterative radix-2 complex FFT with precomputed twiddles and bit reversal.
 * Allocation-free after construction, so it is safe on the audio thread.
 */
export class FFT {
  readonly size: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  private readonly window: Float32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.window = hann(size);
  }

  /**
   * Hann-window `input` (oldest → newest, length `size`) and write `size/2`
   * magnitudes to `out`, scaled so a full-scale sine reads ≈ 1.0.
   */
  magnitudes(input: ArrayLike<number>, out: Float32Array): void {
    const n = this.size;
    const { re, im, rev, window } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      re[j] = input[i] * window[i];
      im[j] = 0;
    }
    this.transform();
    const scale = 4 / n; // Hann coherent gain 0.5, one-sided spectrum ×2.
    const half = n / 2;
    for (let k = 0; k < half; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
  }

  private transform(): void {
    const n = this.size;
    const { re, im, cos, sin } = this;
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < halfLen; k++) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = start + k;
          const b = a + halfLen;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
