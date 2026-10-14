import { FFT_SIZE } from '@shared/types/audio';
import { FFT } from '../dsp/fft';
import { Salience, peaksOf } from './salience';
import { NoteSegmenter, type NoteOnset } from './segmenter';
import { StereoStream } from './stream';

/** Sung range: C3 .. C6. */
const LO = 48;
const HI = 84;
/** How far one harmonic series must stand out of the rest to be a voice. */
const CONTRAST = 3.2;

/**
 * The lead vocal: a singer is mixed in the centre and guitars are panned, so
 * the side signal is subtracted from the mid one (what's left is mostly the
 * centre), then the strongest harmonic series between C3 and C6 in what's
 * left is the sung pitch. Voiced when that series is strong and the centre
 * carries a good share of the sound; a held pitch is a note (vibrato stays
 * inside the tolerance), a new syllable re-strikes it.
 */
export class MelodyTracker {
  private readonly fft = new FFT(FFT_SIZE);
  private readonly sideIn = new Float32Array(FFT_SIZE);
  private readonly side = new Float32Array(FFT_SIZE / 2);
  /** The centre spectrum (mid minus side), shared with the lead tracker. */
  readonly centre = new Float32Array(FFT_SIZE / 2);
  private readonly peaks = new Float32Array(FFT_SIZE / 2);
  readonly salience: Salience;
  private readonly seg: NoteSegmenter;
  private readonly lo: number;
  private readonly hi: number;
  private salMax = 1e-6;
  private prevMidi = 0;
  /** Now: sung pitch (MIDI, 0 = not singing), its candidate index, and the centre level (dB). */
  midi = 0;
  candidate = -1;
  voiced = false;
  levelDb = -100;

  constructor(readonly sampleRate: number) {
    this.salience = new Salience(sampleRate, LO, HI, 0.25, 12, 0.85);
    this.seg = new NoteSegmenter({ stableHops: 3, jump: 0.8, tolerance: 0.55, reattackDb: 6, releaseHops: 4, latency: 0.045, minNote: 0.08 });
    const binHz = sampleRate / FFT_SIZE;
    this.lo = Math.round(180 / binHz);
    this.hi = Math.round(5000 / binHz);
  }

  reset(): void {
    this.seg.reset();
    this.prevMidi = 0;
  }

  /** One hop: `mag` is the mid spectrum of this hop. */
  step(mag: Float32Array, stream: StereoStream, t: number, silent: boolean): { onset: NoteOnset | null; end: number | null } {
    StereoStream.latest(stream.side, stream.write, this.sideIn);
    this.fft.magnitudes(this.sideIn, this.side);
    let cE = 0;
    let mE = 0;
    for (let k = 0; k < this.centre.length; k++) {
      const c = Math.max(0, mag[k] - 1.5 * this.side[k]);
      this.centre[k] = c;
      if (k >= this.lo && k < this.hi) {
        cE += c * c;
        mE += mag[k] * mag[k];
      }
    }
    const share = mE > 0 ? cE / mE : 0;
    this.levelDb = 10 * Math.log10(cE + 1e-12);
    peaksOf(this.centre, this.peaks, this.lo, this.hi);
    const best = this.salience.compute(this.peaks);
    // Prefer staying near the last pitch (a singer glides, they don't jump octaves at random).
    let pick = best;
    if (this.prevMidi) {
      let top = 0;
      const v = this.salience.values;
      for (let c = 0; c < v.length; c++) {
        const d = (this.salience.midi[c] - this.prevMidi) / 1.5;
        const s = v[c] * (1 + 0.3 * Math.exp(-d * d));
        if (s > top) {
          top = s;
          pick = c;
        }
      }
    }
    const sal = this.salience.values[pick];
    this.salMax = Math.max(sal, this.salMax * 0.9995);
    const voiced = !silent && sal > this.salMax * 0.2 && share > 0.3 && this.salience.contrast > CONTRAST;
    this.voiced = voiced;
    this.candidate = voiced ? pick : -1;
    this.midi = voiced ? this.salience.midi[pick] : 0;
    this.prevMidi = voiced ? this.midi : 0;
    const strength = Math.min(1, Math.max(0.05, sal / this.salMax));
    return this.seg.step(t, voiced, this.midi, this.levelDb, strength);
  }
}
