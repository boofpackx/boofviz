/** A note found by a tracker: when it started (s, audio clock), its pitch and how hard it hit (0..1). */
export interface NoteOnset {
  t: number;
  midi: number;
  strength: number;
}

export interface SegmenterOptions {
  /** Hops a pitch must hold before it counts as a note. */
  stableHops: number;
  /** Semitones a held pitch must move to be a new note. */
  jump: number;
  /** Semitones of wobble a held pitch may have (vibrato, noise). */
  tolerance: number;
  /** A rise of this many dB within a few hops re-strikes the note. */
  reattackDb: number;
  /** Unvoiced hops that end a note. */
  releaseHops: number;
  /** The tracker's delay (s): onsets are dated this much earlier. */
  latency: number;
  /** Shortest note (s) before a re-strike counts. */
  minNote: number;
}

function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/**
 * Turns a per-hop pitch track (voiced?, MIDI pitch, level in dB) into notes:
 * a pitch that holds for a few hops starts a note, a held move to another
 * pitch starts the next one, a sharp rise in level re-strikes the same pitch,
 * and a few unvoiced hops end it. Pure: one instance per tracker.
 */
export class NoteSegmenter {
  private cand: { t: number; midi: number; count: number; sum: number } | null = null;
  private jumpCand: { t: number; midi: number; count: number; sum: number } | null = null;
  /** The note sounding now. */
  note: { t: number; midi: number; peakDb: number } | null = null;
  private unvoiced = 0;
  private unvoicedAt = 0;
  private readonly levels: number[] = [];
  private readonly pitches: number[] = [];

  constructor(private readonly o: SegmenterOptions) {}

  reset(): void {
    this.cand = this.jumpCand = this.note = null;
    this.unvoiced = 0;
    this.levels.length = 0;
    this.pitches.length = 0;
  }

  /**
   * One hop. Returns the note that started (if any) and the time the previous
   * one ended (if it did): a new note ends the old one at its start.
   */
  step(t: number, voiced: boolean, midiRaw: number, levelDb: number, strength: number): { onset: NoteOnset | null; end: number | null } {
    const o = this.o;
    let onset: NoteOnset | null = null;
    let end: number | null = null;
    this.levels.push(levelDb);
    if (this.levels.length > 6) this.levels.shift();
    if (!voiced) {
      this.pitches.length = 0;
      this.cand = this.jumpCand = null;
      if (this.unvoiced++ === 0) this.unvoicedAt = t;
      if (this.note && this.unvoiced >= o.releaseHops) {
        end = this.unvoicedAt - o.latency;
        this.note = null;
      }
      return { onset, end };
    }
    this.unvoiced = 0;
    this.pitches.push(midiRaw);
    if (this.pitches.length > 3) this.pitches.shift();
    const p = this.pitches;
    const midi = p.length === 3 ? median3(p[0], p[1], p[2]) : midiRaw;
    const start = (from: { t: number; sum: number; count: number }): void => {
      if (this.note) end = from.t - o.latency;
      const m = from.sum / from.count;
      this.note = { t: from.t, midi: m, peakDb: levelDb };
      onset = { t: from.t - o.latency, midi: m, strength };
    };
    if (!this.note) {
      if (this.cand && Math.abs(midi - this.cand.sum / this.cand.count) <= o.tolerance) {
        this.cand.count++;
        this.cand.sum += midi;
      } else this.cand = { t, midi, count: 1, sum: midi };
      if (this.cand.count >= o.stableHops) {
        start(this.cand);
        this.cand = null;
      }
      return { onset, end };
    }
    const n = this.note;
    if (Math.abs(midi - n.midi) >= o.jump) {
      if (this.jumpCand && Math.abs(midi - this.jumpCand.sum / this.jumpCand.count) <= o.tolerance) {
        this.jumpCand.count++;
        this.jumpCand.sum += midi;
      } else this.jumpCand = { t, midi, count: 1, sum: midi };
      if (this.jumpCand.count >= o.stableHops) {
        start(this.jumpCand);
        this.jumpCand = null;
      }
      return { onset, end };
    }
    this.jumpCand = null;
    n.midi += (midi - n.midi) * 0.2;
    n.peakDb = Math.max(n.peakDb, levelDb);
    // Re-struck: the level dipped and came back up sharply.
    const lv = this.levels;
    let low = Infinity;
    for (let i = 0; i < lv.length - 1; i++) low = Math.min(low, lv[i]);
    if (t - n.t >= o.minNote && lv.length >= 4 && levelDb - low >= o.reattackDb) {
      start({ t, sum: n.midi, count: 1 });
      this.levels.length = 0;
    }
    return { onset, end };
  }
}
