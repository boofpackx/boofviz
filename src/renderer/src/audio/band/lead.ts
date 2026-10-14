import { FFT_SIZE } from '@shared/types/audio';
import { OnsetDetector } from '../dsp/onset';
import { Salience, peaksOf } from './salience';
import type { NoteOnset } from './segmenter';

/** Guitar and keys: E2 .. E6. */
const LO = 40;
const HI = 80;
const F_LO = 150;
const F_HI = 4000;
/** A rise is a note once this share of it is at clear partials. */
const TONAL_SHARE = 0.08;
/** Its partials stand clear of the attack about this late (s). */
const DELAY = 0.02;

export interface LeadOnset extends NoteOnset {
  /** Notes struck together: 1, or 2 for a chord (a power chord's root and fifth, a strum). */
  chord: number;
}

/**
 * The guitar (and keys): new partials at sharp spectral peaks between 150 Hz
 * and 4 kHz, outside the sung pitch's harmonics, are a note being struck; a
 * chord when a second harmonic series (not an octave) struck with it. A
 * strike's attack smears for a few hops before its partials stand clear; a
 * drum's noise never clears, so a rise only counts once its partials carry it.
 */
export class LeadTracker {
  private readonly prevLog = new Float32Array(FFT_SIZE / 2);
  private readonly rise = new Float32Array(FFT_SIZE / 2);
  private readonly peaks = new Float32Array(FFT_SIZE / 2);
  private readonly masked = new Uint8Array(FFT_SIZE / 2);
  private readonly salience: Salience;
  private readonly det: OnsetDetector;
  private readonly lo: number;
  private readonly hi: number;
  private candidate: { t: number; level: number; age: number } | null = null;
  private open: { t: number; ref: number } | null = null;
  /** Energy of the band now (for the hold). */
  energy = 0;

  constructor(readonly sampleRate: number) {
    const binHz = sampleRate / FFT_SIZE;
    this.lo = Math.max(3, Math.floor(F_LO / binHz));
    this.hi = Math.min(FFT_SIZE / 2 - 4, Math.ceil(F_HI / binHz));
    this.salience = new Salience(sampleRate, LO, HI, 0.5, 10, 0.75);
    this.det = new OnsetDetector(sampleRate / 512, 0.5, 0.08);
    this.det.sensitivity = 0.5;
  }

  reset(): void {
    this.candidate = this.open = null;
  }

  /**
   * One hop. `mag`: the mid spectrum; `vocal`: the sung pitch's salience
   * candidate index now (−1: not singing) and its tracker, so its harmonics
   * are left out.
   */
  step(mag: Float32Array, t: number, silent: boolean, vocal: { candidate: number; salience: Salience }): { onset: LeadOnset | null; end: number | null } {
    const masked = this.masked;
    masked.fill(0);
    if (vocal.candidate >= 0) {
      for (let h = 0; h < vocal.salience.harmonics; h++) {
        const [a, b] = vocal.salience.harmonicBins(vocal.candidate, h);
        for (let k = Math.max(0, a - 1); k <= b + 1 && k < masked.length; k++) masked[k] = 1;
      }
    }
    let flux = 0;
    let total = 0;
    let energy = 0;
    const rise = this.rise;
    rise.fill(0);
    for (let k = this.lo; k <= this.hi; k++) {
      const m = mag[k];
      const l = Math.log1p(m * 1000);
      const d = l - this.prevLog[k];
      this.prevLog[k] = l;
      if (masked[k]) continue;
      energy += m * m;
      if (d <= 0) continue;
      total += d;
      if (m >= mag[k - 1] && m >= mag[k + 1] && m > 1.5 * (mag[k - 2] + mag[k + 2])) {
        flux += d;
        rise[k] = m;
      }
    }
    this.energy = energy;
    if (this.det.step(flux, silent)) this.candidate = { t: t - DELAY, level: this.det.level, age: 0 };
    let onset: LeadOnset | null = null;
    let end: number | null = null;
    const c = this.candidate;
    if (c) {
      if (flux > 0 && flux >= TONAL_SHARE * total) {
        // Pitch the sound as it stands now (the new partials alone lean to the top of a distorted
        // chord); a second series (not an octave of the first) makes it a chord.
        for (let k = 0; k < this.peaks.length; k++) rise[k] = masked[k] ? 0 : mag[k];
        peaksOf(rise, this.peaks, this.lo, this.hi);
        const s = this.salience;
        const best = s.compute(this.peaks);
        const top = s.values[best];
        let second = 0;
        for (let i = 0; i < s.values.length; i++) {
          const d = Math.abs(s.midi[i] - s.midi[best]);
          if (d < 2.5 || Math.abs(d - 12) < 1 || Math.abs(d - 24) < 1) continue;
          second = Math.max(second, s.values[i]);
        }
        onset = { t: c.t, midi: s.midi[best], strength: Math.min(1, c.level / 3), chord: second > top * 0.75 ? 2 : 1 };
        this.candidate = null;
        if (this.open) end = c.t;
        this.open = { t: c.t, ref: energy };
      } else if (++c.age > 5) this.candidate = null;
    }
    // A note ends when its band has died down (or the next note ends it).
    if (!onset && this.open && energy < this.open.ref * 0.3) {
      end = t;
      this.open = null;
    }
    return { onset, end };
  }
}
