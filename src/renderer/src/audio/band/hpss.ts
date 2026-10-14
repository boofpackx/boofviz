/** Log-spaced analysis bands. */
export const HPSS_BANDS = 96;
const F_LO = 40;
const F_HI = 16000;
/** Frames either side for the time median (the result is this many hops late). */
export const HPSS_DELAY = 4;
/** Bands either side for the frequency median. */
const FREQ_HALF = 5;

function median(buf: Float32Array, n: number): number {
  // Insertion sort: n is small (≤ 13).
  for (let i = 1; i < n; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j];
      j--;
    }
    buf[j + 1] = v;
  }
  return n & 1 ? buf[n >> 1] : 0.5 * (buf[(n >> 1) - 1] + buf[n >> 1]);
}

/**
 * Harmonic/percussive separation (Fitzgerald 2010) on a log-band spectrum of
 * a short FFT:
 * a tone holds still in time and is narrow in frequency, a drum hit is the
 * reverse, so a median along time keeps the tones and a median along
 * frequency keeps the hits. The time median is centred, so each result is
 * HPSS_DELAY hops late (≈ 43 ms); `delayedT` says which hop it is for.
 * The soft masks are kept per band and can be spread back onto FFT bins.
 */
export class Hpss {
  /** FFT bin range of each band. */
  readonly lo = new Int32Array(HPSS_BANDS);
  readonly hi = new Int32Array(HPSS_BANDS);
  /** Centre frequency of each band (Hz). */
  readonly centre = new Float32Array(HPSS_BANDS);
  private readonly frames: Float32Array[];
  private readonly times: number[];
  private head = 0;
  private count = 0;
  private readonly scratch = new Float32Array(Math.max(2 * HPSS_DELAY + 1, 2 * FREQ_HALF + 1));
  private readonly harmonicEst = new Float32Array(HPSS_BANDS);
  /** For the delayed frame: band power, its percussive and harmonic parts, and the percussive mask. */
  readonly power = new Float32Array(HPSS_BANDS);
  readonly perc = new Float32Array(HPSS_BANDS);
  readonly harm = new Float32Array(HPSS_BANDS);
  readonly percMask = new Float32Array(HPSS_BANDS);
  /** Band of every FFT bin (−1: outside). */
  readonly bandOfBin: Int16Array;
  delayedT = 0;
  ready = false;

  /** `fftSize`: the transform the magnitudes come from (short, for sharp hits). */
  constructor(
    readonly sampleRate: number,
    readonly fftSize = 1024,
  ) {
    const binHz = sampleRate / fftSize;
    this.bandOfBin = new Int16Array(fftSize / 2);
    const ratio = Math.pow(F_HI / F_LO, 1 / HPSS_BANDS);
    this.bandOfBin.fill(-1);
    let prevHi = 0;
    for (let b = 0; b < HPSS_BANDS; b++) {
      const f0 = F_LO * Math.pow(ratio, b);
      const f1 = f0 * ratio;
      let lo = Math.max(1, Math.round(f0 / binHz));
      lo = Math.max(lo, prevHi);
      const hi = Math.max(lo + 1, Math.round(f1 / binHz));
      this.lo[b] = lo;
      this.hi[b] = Math.min(fftSize / 2, hi);
      this.centre[b] = Math.sqrt(f0 * f1);
      for (let k = lo; k < this.hi[b]; k++) this.bandOfBin[k] = b;
      // Low bands are narrower than a bin: neighbours may share one; never go backwards.
      prevHi = Math.max(prevHi, lo);
    }
    this.frames = Array.from({ length: 2 * HPSS_DELAY + 1 }, () => new Float32Array(HPSS_BANDS));
    this.times = new Array(2 * HPSS_DELAY + 1).fill(0);
  }

  /** Bands whose centre lies in [f0, f1) Hz. */
  bandsIn(f0: number, f1: number): [number, number] {
    let a = HPSS_BANDS;
    let b = 0;
    for (let i = 0; i < HPSS_BANDS; i++)
      if (this.centre[i] >= f0 && this.centre[i] < f1) {
        a = Math.min(a, i);
        b = Math.max(b, i + 1);
      }
    return [a, b];
  }

  /** Feed one hop's magnitudes (taken at audio time t). */
  process(mag: Float32Array, t: number): void {
    const N = this.frames.length;
    const cur = this.frames[this.head];
    for (let b = 0; b < HPSS_BANDS; b++) {
      let e = 0;
      for (let k = this.lo[b]; k < this.hi[b]; k++) e += mag[k] * mag[k];
      cur[b] = e / (this.hi[b] - this.lo[b]);
    }
    this.times[this.head] = t;
    this.head = (this.head + 1) % N;
    this.count = Math.min(N, this.count + 1);
    this.ready = this.count === N;
    if (!this.ready) return;
    // The frame in the middle of the window.
    const mid = (this.head + HPSS_DELAY) % N;
    const x = this.frames[mid];
    this.delayedT = this.times[mid];
    const s = this.scratch;
    for (let b = 0; b < HPSS_BANDS; b++) {
      for (let i = 0; i < N; i++) s[i] = this.frames[i][b];
      this.harmonicEst[b] = median(s, N);
    }
    for (let b = 0; b < HPSS_BANDS; b++) {
      const a = Math.max(0, b - FREQ_HALF);
      const z = Math.min(HPSS_BANDS, b + FREQ_HALF + 1);
      for (let i = a; i < z; i++) s[i - a] = x[i];
      const p = median(s, z - a);
      const h = this.harmonicEst[b];
      const m = (p * p) / (p * p + h * h + 1e-30);
      this.power[b] = x[b];
      this.percMask[b] = m;
      this.perc[b] = x[b] * m;
      this.harm[b] = x[b] * (1 - m);
    }
  }

  /** Sum of a band range of an array. */
  static sum(a: Float32Array, range: [number, number]): number {
    let e = 0;
    for (let b = range[0]; b < range[1]; b++) e += a[b];
    return e;
  }
}
