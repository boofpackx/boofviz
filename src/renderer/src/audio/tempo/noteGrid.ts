import { FFT_SIZE, GRID_ROW, GRID_ROWS, GRID_SLOTS, type NoteGridState, type TempoState } from '@shared/types/audio';
import type { HopFeatures } from '../dsp/analysisCore';
import { OnsetDetector } from '../dsp/onset';
import { beatAt } from './beatClock';

const MASK = GRID_SLOTS - 1;
const TONE_LO_HZ = 180;
const TONE_HI_HZ = 3000;
/** Longest sustain recorded (slots). */
const MAX_HOLD = 16;
/** How late a note's partials stand clear of its attack in the long FFT (s). */
const TONE_DELAY_SEC = 0.02;
/** Share of the rise at clear partials that makes it a note. */
const TONAL_SHARE = 0.12;

/**
 * The music's onsets laid on the beat clock's 16th-note grid, for looks that
 * show what's coming (a note highway charts the next bar from the bars just
 * played: music repeats in one-, two- and four-bar loops).
 *
 * Kept in the analysis worker so every window reads one grid, whichever look
 * is on screen and whenever it was loaded. Drums come from the onset detectors;
 * "tone" onsets are new partials at sharp spectral peaks of the long FFT
 * between 180 Hz and 3 kHz (notes of a riff, a melody, a bass line's
 * harmonics; above a kick's body), each with where in that range it sits and
 * how long it holds. Pure: tests drive it directly.
 */
export class NoteGrid {
  readonly state: NoteGridState = { slot: 0, valid: 0, data: new Uint8Array(GRID_ROWS * GRID_SLOTS) };
  private readonly tone: OnsetDetector;
  private prevLog: Float32Array | null = null;
  private logPos: Float32Array | null = null;
  private binRate = 0;
  private started = false;
  private quietSec = 0;
  private open: { slot: number; ref: number } | null = null;
  private candidate: { t: number; level: number; age: number } | null = null;

  constructor(private readonly hopRate: number) {
    this.tone = new OnsetDetector(hopRate, 0.5, 0.09);
    this.tone.sensitivity = 0.5;
  }

  private at(row: number, slot: number): number {
    return row * GRID_SLOTS + (slot & MASK);
  }

  reset(): void {
    this.state.data.fill(0);
    this.state.valid = 0;
    this.open = null;
    this.candidate = null;
  }

  process(f: HopFeatures, mag: Float32Array, sampleRate: number, tempo: TempoState): void {
    const st = this.state;
    const dt = 1 / this.hopRate;

    // ---- Tone flux: rises of log magnitude at sharp spectral peaks (partials, not noise) ----
    if (!this.prevLog || this.prevLog.length !== mag.length || this.binRate !== sampleRate) {
      this.prevLog = new Float32Array(mag.length);
      this.logPos = new Float32Array(mag.length);
      this.binRate = sampleRate;
      const span = Math.log2(TONE_HI_HZ / TONE_LO_HZ);
      for (let i = 1; i < mag.length; i++) this.logPos[i] = Math.min(1, Math.max(0, Math.log2((i * sampleRate) / FFT_SIZE / TONE_LO_HZ) / span));
    }
    const prev = this.prevLog;
    const pos = this.logPos!;
    const lo = Math.max(3, Math.floor((TONE_LO_HZ * FFT_SIZE) / sampleRate));
    const hi = Math.min(mag.length - 4, Math.ceil((TONE_HI_HZ * FFT_SIZE) / sampleRate));
    let flux = 0;
    let total = 0;
    let where = 0;
    let energy = 0;
    for (let i = lo; i <= hi; i++) {
      const m = mag[i];
      const l = Math.log1p(m * 1000);
      const d = l - prev[i];
      prev[i] = l;
      energy += m * m;
      if (d <= 0) continue;
      total += d;
      // A partial stands well clear of the spectrum three bins away (past the window's main lobe).
      if (m >= mag[i - 1] && m >= mag[i + 1] && m > 4 * 0.5 * (mag[i - 3] + mag[i + 3])) {
        flux += d;
        where += d * pos[i];
      }
    }
    // A note's attack smears across the long FFT for a few hops before its partials stand
    // clear; a snare's noise never clears. So a rise is a note once its partials carry it.
    if (this.tone.step(flux, f.silence)) this.candidate = { t: f.t - TONE_DELAY_SEC, level: this.tone.level, age: 0 };
    let toneAt = Number.NaN;
    let toneLevel = 0;
    let pitch = 0.5;
    const cand = this.candidate;
    if (cand) {
      if (flux > 0 && flux >= TONAL_SHARE * total) {
        toneAt = cand.t;
        toneLevel = cand.level;
        pitch = where / flux;
        this.candidate = null;
      } else if (++cand.age > 5) this.candidate = null;
    }

    // ---- Where on the grid ----
    const slot = Math.round(beatAt(tempo, f.t) * 4);
    if (!this.started) {
      this.started = true;
      st.slot = slot;
    }
    const step = slot - st.slot;
    if (step < -8 || step > 64) {
      // The beat clock jumped (a re-lock, a resync): the old grid no longer lines up.
      this.reset();
      st.slot = slot;
    } else if (step > 0) {
      for (let s = st.slot + 1; s <= slot; s++) for (let r = 0; r < GRID_ROWS; r++) st.data[this.at(r, s)] = 0;
      st.slot = slot;
      st.valid = Math.min(GRID_SLOTS, st.valid + step);
    }
    if (st.valid === 0) st.valid = 1;

    // A new song after a silence starts from an empty grid.
    this.quietSec = f.silence ? this.quietSec + dt : 0;
    if (this.quietSec > 2 && st.valid > 1) this.reset();

    // ---- Onsets into the slot ----
    const put = (row: number, level: number): void => {
      const i = this.at(row, slot);
      st.data[i] = Math.max(st.data[i], Math.min(255, Math.max(1, Math.round(level * 64))));
    };
    if (f.kick) put(GRID_ROW.kick, f.odfKick);
    if (f.snare) put(GRID_ROW.snare, f.odfSnare);
    if (f.hat) put(GRID_ROW.hat, f.odfHat);

    // ---- Tone notes and how long they hold ----
    const toneSlot = Number.isNaN(toneAt) ? Number.NaN : Math.round(beatAt(tempo, toneAt) * 4);
    const o = this.open;
    if (o && (!Number.isNaN(toneSlot) || energy < o.ref * 0.35 || slot - o.slot >= MAX_HOLD || slot < o.slot)) {
      const len = (Number.isNaN(toneSlot) ? slot : toneSlot) - o.slot;
      if (len >= 2) st.data[this.at(GRID_ROW.hold, o.slot)] = Math.min(MAX_HOLD, len);
      this.open = null;
    }
    if (!Number.isNaN(toneSlot) && toneSlot <= slot && slot - toneSlot < 4) {
      const i = this.at(GRID_ROW.tone, toneSlot);
      st.data[i] = Math.max(st.data[i], Math.min(255, Math.max(1, Math.round(toneLevel * 64))));
      st.data[this.at(GRID_ROW.pitch, toneSlot)] = Math.round(Math.min(1, Math.max(0, pitch)) * 255);
      this.open = { slot: toneSlot, ref: energy };
    }
  }
}
