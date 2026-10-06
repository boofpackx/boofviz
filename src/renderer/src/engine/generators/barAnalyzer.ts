const SPECTRUM_F_MIN = 20;
const SPECTRUM_F_MAX = 20000;

/**
 * Turns the 2048-bin log spectrum into N display bars: log-spaced bands with an
 * adaptive ceiling (uses the full height for quiet and loud material alike),
 * fast attack / eased fall, and gravity peak caps.
 */
export class BarAnalyzer {
  readonly heights: Float32Array;
  readonly peaks: Float32Array;
  private readonly targets: Float32Array;
  private readonly hold: Float32Array;
  private readonly vel: Float32Array;
  private ceiling = 0.6;

  constructor(readonly max: number) {
    this.heights = new Float32Array(max);
    this.peaks = new Float32Array(max);
    this.targets = new Float32Array(max);
    this.hold = new Float32Array(max);
    this.vel = new Float32Array(max);
  }

  update(
    fft: Float32Array,
    count: number,
    dt: number,
    o: { release: number; reactivity: number; silence: boolean; punch?: number; kick?: number; fLo?: number; fHi?: number; capHold?: number; capGravity?: number },
  ): void {
    const n = fft.length;
    const fLo = o.fLo ?? 28;
    const fHi = o.fHi ?? 16000;
    const toIndex = (f: number): number => (Math.log(f / SPECTRUM_F_MIN) / Math.log(SPECTRUM_F_MAX / SPECTRUM_F_MIN)) * n;
    let frameMax = 0;
    for (let b = 0; b < count; b++) {
      const f0 = fLo * Math.pow(fHi / fLo, b / count);
      const f1 = fLo * Math.pow(fHi / fLo, (b + 1) / count);
      const i0 = Math.max(0, Math.floor(toIndex(f0)));
      const i1 = Math.min(n - 1, Math.max(i0, Math.ceil(toIndex(f1))));
      let sum = 0;
      let mx = 0;
      for (let i = i0; i <= i1; i++) {
        sum += fft[i];
        if (fft[i] > mx) mx = fft[i];
      }
      const v = 0.5 * (sum / (i1 - i0 + 1)) + 0.5 * mx;
      this.targets[b] = v;
      if (v > frameMax) frameMax = v;
    }
    this.ceiling = frameMax > this.ceiling ? frameMax : this.ceiling + (frameMax - this.ceiling) * (1 - Math.exp(-dt / 4));
    const ceil = Math.max(this.ceiling, 0.25);
    const window = 0.42 / Math.max(0.25, o.reactivity);
    const punch = 1 + (o.punch ?? 0) * (o.kick ?? 0);
    const fall = Math.exp(-dt / Math.max(0.02, o.release));
    const capHold = o.capHold ?? 0.22;
    const gravity = o.capGravity ?? 4;

    for (let b = 0; b < count; b++) {
      let t = (this.targets[b] - (ceil - window)) / window;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      t = Math.pow(t, 1.35) * punch;
      const h = Math.max(t, this.heights[b] * fall + t * (1 - fall));
      this.heights[b] = o.silence ? this.heights[b] * fall : h;
      if (this.heights[b] >= this.peaks[b]) {
        this.peaks[b] = this.heights[b];
        this.hold[b] = capHold;
        this.vel[b] = 0;
      } else if ((this.hold[b] -= dt) <= 0) {
        this.vel[b] += gravity * dt;
        this.peaks[b] = Math.max(this.heights[b], this.peaks[b] - this.vel[b] * dt);
      }
    }
    for (let b = count; b < this.max; b++) this.heights[b] = this.peaks[b] = 0;
  }
}
