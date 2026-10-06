import { RingStats } from './smoothing';

/**
 * Adaptive-threshold onset picker for one band-limited spectral-flux stream.
 *
 * threshold = mean + k·std over a short history (k from sensitivity) and a
 * floor relative to the recent peak flux, with a refractory period. Fires on
 * the upward threshold crossing, so it adds no look-ahead latency.
 */
export class OnsetDetector {
  private readonly history: RingStats;
  private readonly refractoryHops: number;
  private sinceFire = 1e9;
  private wasAbove = false;
  private peakFollow = 1e-3;
  private readonly peakDecay: number;
  /** Normalized detection value for meters/HUD (≈1 at threshold). */
  level = 0;
  sensitivity = 0.5;

  constructor(hopRate: number, historySec = 0.6, refractorySec = 0.1) {
    this.history = new RingStats(Math.max(4, Math.round(historySec * hopRate)));
    this.refractoryHops = Math.max(1, Math.round(refractorySec * hopRate));
    this.peakDecay = Math.exp(-1 / (4 * hopRate));
  }

  /** Feed one flux value; returns true on an onset. `gate` suppresses firing (e.g. silence). */
  step(flux: number, gate = false): boolean {
    const mean = this.history.length ? this.history.mean() : flux;
    const std = this.history.length ? this.history.std(mean) : 0;
    this.history.push(flux);
    this.peakFollow = Math.max(flux, this.peakFollow * this.peakDecay, 1e-4);
    this.sinceFire++;

    const s = Math.min(1, Math.max(0, this.sensitivity));
    const k = 3.2 - 2.4 * s; // 3.2σ (strict) … 0.8σ (loose)
    const floor = this.peakFollow * (0.42 - 0.3 * s);
    const threshold = Math.max(mean + k * std, floor, 1e-4);
    this.level = flux / threshold;

    const above = flux > threshold;
    const fire = above && !this.wasAbove && !gate && this.sinceFire >= this.refractoryHops;
    this.wasAbove = above;
    if (fire) this.sinceFire = 0;
    return fire;
  }
}
