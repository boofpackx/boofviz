/** One-pole coefficient for a time constant `tauSec` at update interval `dtSec`. */
export function coef(dtSec: number, tauSec: number): number {
  return tauSec <= 0 ? 1 : 1 - Math.exp(-dtSec / tauSec);
}

/** Attack/release follower (separate rise and fall times). */
export class AttackRelease {
  value = 0;
  private a = 1;
  private r = 1;

  constructor(dtSec: number, attackMs: number, releaseMs: number) {
    this.set(dtSec, attackMs, releaseMs);
  }

  set(dtSec: number, attackMs: number, releaseMs: number): void {
    this.a = coef(dtSec, attackMs / 1000);
    this.r = coef(dtSec, releaseMs / 1000);
  }

  step(x: number): number {
    this.value += (x - this.value) * (x > this.value ? this.a : this.r);
    return this.value;
  }
}

/**
 * Auto-normalizer for a level in dB: tracks a decaying recent maximum and maps
 * [max - range, max] → [0, 1]. Quiet sources still drive visuals fully, while
 * a breakdown reads low until the tracker relaxes.
 */
export class DbNormalizer {
  private max: number;
  private readonly decay: number;

  constructor(
    dtSec: number,
    private readonly range = 24,
    decaySec = 8,
    private readonly floorDb = -75,
  ) {
    this.max = floorDb + range;
    this.decay = coef(dtSec, decaySec);
  }

  step(db: number): number {
    if (db > this.max) this.max = db;
    else this.max += (Math.max(db, this.floorDb + this.range) - this.max) * this.decay;
    const v = (db - (this.max - this.range)) / this.range;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  get reference(): number {
    return this.max;
  }
}

/** Fixed-size ring of numbers with running mean/variance helpers. */
export class RingStats {
  private readonly buf: Float64Array;
  private idx = 0;
  private count = 0;

  constructor(size: number) {
    this.buf = new Float64Array(size);
  }

  push(x: number): void {
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
  }

  get length(): number {
    return this.count;
  }

  mean(): number {
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.buf[i];
    return this.count ? s / this.count : 0;
  }

  std(mean = this.mean()): number {
    let s = 0;
    for (let i = 0; i < this.count; i++) s += (this.buf[i] - mean) ** 2;
    return this.count ? Math.sqrt(s / this.count) : 0;
  }
}
