import { GRID_EXPECTED, GRID_HORIZON, GRID_PREDICTED_ROWS, GRID_ROW, PARTS, type Part } from '@shared/types/audio';
import type { PartGrid } from './partGrid';

/** Slots of history the predictor keeps (128 bars of 4/4: verse and chorus come round again). */
const HIST = 2048;
const HMASK = HIST - 1;
/** The bars compared when looking for an earlier section like this one. */
const MATCH_BARS = 4;

/** Rows each part's onsets are on, and the rows that go with them (pitch, hold, chord). */
export const PART_ROWS: Record<Part, { onsets: number[]; extra: number[]; conf: number }> = {
  drums: { onsets: [GRID_ROW.kick, GRID_ROW.snare, GRID_ROW.hat, GRID_ROW.crash], extra: [], conf: GRID_ROW.confDrums },
  bass: { onsets: [GRID_ROW.bass], extra: [GRID_ROW.bassPitch, GRID_ROW.bassHold], conf: GRID_ROW.confBass },
  guitar: { onsets: [GRID_ROW.guitar], extra: [GRID_ROW.guitarPitch, GRID_ROW.guitarChord, GRID_ROW.guitarHold], conf: GRID_ROW.confGuitar },
  vocals: { onsets: [GRID_ROW.vocals], extra: [GRID_ROW.vocalsPitch, GRID_ROW.vocalsHold], conf: GRID_ROW.confVocals },
};
/** Rows that say where a section is (compared to find the earlier one it repeats). */
const MATCH_ROWS = [GRID_ROW.kick, GRID_ROW.snare, GRID_ROW.hat, GRID_ROW.bass, GRID_ROW.guitar, GRID_ROW.vocals];
const PITCH_OF: Record<number, number> = { [GRID_ROW.bass]: GRID_ROW.bassPitch, [GRID_ROW.guitar]: GRID_ROW.guitarPitch, [GRID_ROW.vocals]: GRID_ROW.vocalsPitch };

/** The ways a slot can be foretold: the same slot one, two or four bars back, or in the earlier section this one repeats. */
const METHODS = ['bar', 'twoBars', 'fourBars', 'section'] as const;
type Method = (typeof METHODS)[number];

/**
 * Writes the expected rows of the note grid: what each part will play on the
 * slot GRID_HORIZON slots ahead. Music repeats (a groove every bar, a riff
 * every two or four, a chorus every minute or so), so a slot is copied from
 * where the music last went the same way. Each way of looking back keeps a
 * score per part of how often it has been right lately, and the best one
 * for each part writes that part's notes, with its score as the confidence.
 */
export class Predictor {
  private readonly hist = new Uint8Array(GRID_PREDICTED_ROWS * HIST);
  private histValid = 0;
  /** Per part × method: decayed true positives, false positives, misses. */
  private readonly scores = new Float32Array(PARTS.length * METHODS.length * 3);
  private sectionLag = 0;
  private sectionSim = 0;
  private lastBarMatched = Number.NaN;
  /** How far ahead of the newest final slot the expected rows are written (set by the engine). */
  ahead = GRID_HORIZON + 4;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.hist.fill(0);
    this.histValid = 0;
    this.sectionLag = 0;
    this.sectionSim = 0;
    // A small prior: the loops start out trusted a little, the section match not at all.
    for (let p = 0; p < PARTS.length; p++)
      for (let m = 0; m < METHODS.length; m++) {
        const i = (p * METHODS.length + m) * 3;
        const prior = METHODS[m] === 'section' ? 0 : 1;
        this.scores[i] = prior;
        this.scores[i + 1] = prior;
        this.scores[i + 2] = prior;
      }
  }

  private h(row: number, slot: number): number {
    return this.hist[row * HIST + (slot & HMASK)];
  }

  private lag(method: Method, bar: number): number {
    switch (method) {
      case 'bar':
        return bar;
      case 'twoBars':
        return 2 * bar;
      case 'fourBars':
        return 4 * bar;
      default:
        return this.sectionLag;
    }
  }

  /** The slot `method` copies when foretelling slot s, `ahead` slots past the newest final one, or null. */
  private source(method: Method, s: number, bar: number, newest: number, ahead = s - newest): number | null {
    const L = this.lag(method, bar);
    if (L <= 0) return null;
    const m = Math.ceil(ahead / L);
    const src = s - m * L;
    return src <= newest && src > newest - this.histValid ? src : null;
  }

  /** Score of `method` for `part` (0..1). */
  score(part: Part, method: Method): number {
    const i = (PARTS.indexOf(part) * METHODS.length + METHODS.indexOf(method)) * 3;
    const [tp, fp, fn] = [this.scores[i], this.scores[i + 1], this.scores[i + 2]];
    return (2 * tp) / Math.max(1e-6, 2 * tp + fp + fn);
  }

  /** The best way to foretell `part` right now, and how good it has been. */
  best(part: Part): { method: Method; score: number } {
    let method: Method = 'bar';
    let score = -1;
    for (const m of METHODS) {
      const sc = this.score(part, m);
      if (sc > score + 0.02) {
        score = sc;
        method = m;
      }
    }
    return { method, score: Math.max(0, score) };
  }

  /** Slot s has become final in the grid: keep it, and score how each method would have foretold the slot before it. */
  finish(grid: PartGrid, s: number, bar: number): void {
    for (let r = 0; r < GRID_PREDICTED_ROWS; r++) this.hist[r * HIST + (s & HMASK)] = grid.get(r, s);
    this.histValid = Math.min(HIST - 64, this.histValid + 1);
    // Score slot s−1 (its neighbours are both final now, for a one-slot tolerance), as it was foretold:
    // from the newest final slot back when it was written (it was `ahead` slots ahead of it).
    const f = s - 1;
    if (this.histValid > 4) {
      for (let p = 0; p < PARTS.length; p++) {
        const part = PARTS[p];
        for (let m = 0; m < METHODS.length; m++) {
          const src = this.source(METHODS[m], f, bar, s, this.ahead);
          const i = (p * METHODS.length + m) * 3;
          this.scores[i] *= 0.996;
          this.scores[i + 1] *= 0.996;
          this.scores[i + 2] *= 0.996;
          for (const row of PART_ROWS[part].onsets) {
            const pred = src !== null && this.h(row, src) > 0;
            const near = this.h(row, f) > 0 || this.h(row, f - 1) > 0 || this.h(row, s) > 0;
            if (pred && near) this.scores[i]++;
            else if (pred) this.scores[i + 1]++;
            else if (this.h(row, f) > 0) this.scores[i + 2]++;
          }
        }
      }
    }
    // Once a bar: look for the earlier section the last few bars repeat.
    const barIndex = Math.floor(s / bar);
    if (barIndex !== this.lastBarMatched && s % bar === bar - 1) {
      this.lastBarMatched = barIndex;
      this.matchSection(s, bar);
    }
  }

  /** The lag (whole bars, beyond the plain loops) whose bars best match the last MATCH_BARS bars. */
  private matchSection(newest: number, bar: number): void {
    const W = MATCH_BARS * bar;
    let bestLag = 0;
    let bestSim = 0;
    for (let n = 3; n * bar + W <= this.histValid; n++) {
      if (n === 4) continue;
      const L = n * bar;
      let inter = 0;
      let union = 0;
      for (let s = newest - W + 1; s <= newest; s++) {
        for (const row of MATCH_ROWS) {
          const a = this.h(row, s) > 0;
          const b = this.h(row, s - L) > 0;
          if (a || b) union++;
          if (a && b) {
            inter++;
            // The same note, not just a note: a tune repeating.
            const pr = PITCH_OF[row];
            if (pr !== undefined && Math.abs(this.h(pr, s) - this.h(pr, s - L)) <= 1) inter += 0.5;
          }
        }
      }
      const sim = union > 8 ? inter / union : 0;
      if (sim > bestSim + 0.01) {
        bestSim = sim;
        bestLag = L;
      }
    }
    this.sectionLag = bestSim > 0.45 ? bestLag : 0;
    this.sectionSim = bestSim;
  }

  /** Write the expected rows of slot s (GRID_HORIZON ahead of `newest`) into the grid. */
  predict(grid: PartGrid, s: number, bar: number, newest: number): void {
    for (const part of PARTS) {
      const rows = PART_ROWS[part];
      for (const r of [...rows.onsets, ...rows.extra]) grid.set(r + GRID_EXPECTED, s, 0);
      const { method, score } = this.best(part);
      grid.set(rows.conf, s, Math.round(score * 255));
      if (score < 0.3) continue;
      const src = this.source(method, s, bar, newest);
      if (src === null) continue;
      for (const r of [...rows.onsets, ...rows.extra]) grid.set(r + GRID_EXPECTED, s, this.h(r, src));
    }
  }

  /** For the HUD and tests: what each part is being foretold from. */
  describe(): Record<Part, { method: Method; score: number }> & { sectionLag: number; sectionSim: number } {
    return { guitar: this.best('guitar'), bass: this.best('bass'), drums: this.best('drums'), vocals: this.best('vocals'), sectionLag: this.sectionLag, sectionSim: this.sectionSim };
  }
}
