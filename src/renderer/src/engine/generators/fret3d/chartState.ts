import type { NoteGridState, Part } from '@shared/types/audio';
import { chartNote, judge, pitchRange, type ChartNote, type ChartOptions, type NoteResult, type PitchRange } from '../../fretChart';

export interface LiveNote {
  note: ChartNote;
  result: NoteResult;
  /** Beat it was judged (its fire waits for the gem to reach the frets). */
  judgedBeat: number;
  /** Its fire has been lit. */
  burst: boolean;
}

/**
 * One part's notes on a highway: charted as their slots come into view
 * (from the expected rows, so each is fixed from then on), judged against
 * what the part really played once they reach the frets.
 */
export class PartChart {
  readonly notes = new Map<number, LiveNote>();
  private readonly empty = new Set<number>();
  private readonly ranges = new Map<number, PitchRange>();
  private last: ChartNote | null = null;

  constructor(readonly part: Part) {}

  clear(): void {
    this.notes.clear();
    this.empty.clear();
    this.ranges.clear();
    this.last = null;
  }

  /** Where this part's pitches sit for the bar of slot s (worked out once per bar, from the bars before). */
  private range(g: NoteGridState, s: number, o: ChartOptions): PitchRange {
    if (this.part === 'drums') return { median: 0, spread: 6 };
    const bar = Math.floor((s - o.barStart) / o.barSlots);
    let r = this.ranges.get(bar);
    if (!r) {
      r = pitchRange(g, this.part, o.barStart + bar * o.barSlots - o.barSlots * 2, o.barSlots);
      this.ranges.set(bar, r);
      for (const k of this.ranges.keys()) if (k < bar - 8) this.ranges.delete(k);
    }
    return r;
  }

  /**
   * Chart the slots coming into view (up to `x + lookahead`, x = the slot
   * position now), judge the notes reaching the frets and forget old ones.
   * Returns the notes judged on this call.
   */
  update(g: NoteGridState, x: number, lookahead: number, o: ChartOptions, bpm: number, beat: number, locked: boolean): LiveNote[] {
    if (locked) {
      for (let s = Math.ceil(x - 1); s <= Math.floor(x + lookahead); s++) {
        if (this.notes.has(s) || this.empty.has(s)) continue;
        const prev = this.last && s - this.last.slot <= 4 ? this.last : null;
        const n = chartNote(g, this.part, s, o, this.range(g, s, o), prev);
        if (n) {
          this.notes.set(s, { note: n, result: 'pending', judgedBeat: 0, burst: false });
          this.last = n;
        } else this.empty.add(s);
      }
    }
    const judged: LiveNote[] = [];
    for (const [s, ln] of this.notes) {
      if (s < x - 40) {
        this.notes.delete(s);
        continue;
      }
      if (ln.result !== 'pending') continue;
      const r = judge(g, ln.note, bpm);
      if (r === 'pending') continue;
      ln.result = r;
      ln.judgedBeat = beat;
      judged.push(ln);
    }
    for (const s of this.empty) if (s < x - 40) this.empty.delete(s);
    return judged;
  }

  /** The next note after `n` sharing one of its lanes (for where its tail ends), or Infinity. */
  nextInLane(n: ChartNote): number {
    let next = Infinity;
    for (const [s, ln] of this.notes) if (s > n.slot && s < next && (ln.note.lanes & n.lanes || (n.part === 'vocals' && s > n.slot))) next = s;
    return next;
  }
}
