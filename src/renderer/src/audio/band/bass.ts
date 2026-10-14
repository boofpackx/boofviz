import type { NoteOnset } from './segmenter';
import { StereoStream } from './stream';
import { midiOf, Yin } from './yin';

const F_MIN = 36;
const F_MAX = 300;
/** YIN window (s) on the low stream. */
const WINDOW_SEC = 0.085;
/** Level window (s). */
const LEVEL_SEC = 0.02;
/** A struck string breaks the periodicity this long after the strike (s). */
const BREAK_LAG = 0.017;
/** How long after a strike its pitch may settle (s). */
const SETTLE = 0.45;
/** A note dated to a kick has to keep sounding: fading less than this (dB) over the hold-back. */
const KICK_DECAY_DB = 4.5;
/** New notes are held back this long (s) while their pitch settles. */
const HOLD_BACK = 0.09;

/**
 * The bass line: YIN on the low-passed, decimated mid signal finds the pitch
 * below 300 Hz. Notes are timed by their strikes, which show as a break in
 * the periodicity (the window holds the end of one note and the attack of
 * the next) or as a kick drum, and pitched once the tone settles again. A
 * kick's own body is a low tone that dies away fast, so a note dated to a
 * kick has to keep sounding before it counts. Legato moves (a slide, a
 * hammer-on) are new notes too.
 */
export class BassTracker {
  private readonly yin: Yin;
  private readonly buf: Float32Array;
  private readonly res = { period: 0, aperiodicity: 1 };
  private levelMax = -60;
  private readonly levels: number[] = [];
  private readonly pitches: number[] = [];
  private voicedRun = 0;
  private unvoicedRun = 0;
  private unvoicedAt = 0;
  private wasVoiced = false;
  /** Recent strikes: [time, from a kick?]. */
  private strikes: Array<[number, boolean]> = [];
  private jump: { t: number; sum: number; count: number } | null = null;
  /**
   * The newest note, held back for a moment: its pitch can still settle (a
   * second start within the moment corrects it rather than adding a note), and
   * one dated to a kick has to keep sounding.
   */
  private pending: { onset: NoteOnset; level: number; until: number; kick: boolean; strikes: Array<[number, boolean]> } | null = null;
  /** The note sounding now. */
  note: { t: number; midi: number; level: number } | null = null;
  /** Pitch and level now (for the display). */
  midi = 0;
  voiced = false;
  levelDb = -100;

  constructor(private readonly stream: StereoStream) {
    const fs = stream.lowRate;
    const W = Math.round(WINDOW_SEC * fs);
    const tauMax = Math.ceil(fs / F_MIN);
    this.yin = new Yin(W, Math.floor(fs / F_MAX), tauMax, 0.18);
    this.buf = new Float32Array(W + tauMax + 2);
  }

  reset(): void {
    this.note = this.pending = this.jump = null;
    this.strikes = [];
    this.pitches.length = 0;
    this.levels.length = 0;
    this.voicedRun = this.unvoicedRun = 0;
    this.wasVoiced = false;
  }

  /** Drop a held-back note that wasn't one; the strikes it used may still start the real note. */
  private discard(p: NonNullable<BassTracker['pending']>): void {
    this.pending = null;
    this.note = null;
    this.strikes = [...p.strikes, ...this.strikes];
  }

  /** One hop at audio time t; `kick` when the kick detector fired on it. */
  step(t: number, kick: boolean, silent: boolean): { onset: NoteOnset | null; end: number | null } {
    const s = this.stream;
    StereoStream.latest(s.low, s.lowWrite, this.buf);
    const n = Math.round(LEVEL_SEC * s.lowRate);
    let e = 0;
    for (let i = this.buf.length - n; i < this.buf.length; i++) e += this.buf[i] * this.buf[i];
    const db = 10 * Math.log10(e / n + 1e-12);
    this.levelDb = db;
    this.levelMax = Math.max(db, this.levelMax - 0.02);
    const floor = Math.max(-62, this.levelMax - 30);
    this.levels.push(db);
    if (this.levels.length > 4) this.levels.shift();
    this.yin.run(this.buf, this.res);
    const f0 = this.res.period > 0 ? s.lowRate / this.res.period : 0;
    const voiced = !silent && this.res.aperiodicity < 0.30 && f0 >= F_MIN && f0 <= F_MAX && db > floor;
    this.voiced = voiced;
    this.midi = voiced ? midiOf(f0) : 0;
    const strength = Math.min(1, Math.max(0.05, (db - floor) / 30));

    let onset: NoteOnset | null = null;
    let end: number | null = null;
    // Strikes: a kick, or the tone breaking up at full level.
    if (kick) this.strikes.push([t - 0.005, true]);
    if (this.wasVoiced && !voiced && db > floor) this.strikes.push([t - BREAK_LAG, false]);
    this.strikes = this.strikes.filter(([ts]) => t - ts < SETTLE);
    this.wasVoiced = voiced;

    // The held-back note: out once its moment has passed (a kick's only if it kept sounding).
    const p = this.pending;
    if (p && t >= p.until) {
      this.pending = null;
      if (!p.kick || (voiced && db >= p.level - KICK_DECAY_DB)) onset = p.onset;
      else this.discard(p);
    }

    if (!voiced) {
      this.pitches.length = 0;
      this.voicedRun = 0;
      this.jump = null;
      if (this.unvoicedRun++ === 0) this.unvoicedAt = t;
      if (this.note && this.unvoicedRun >= 3) {
        end = this.unvoicedAt - BREAK_LAG;
        this.note = null;
        // Gone before its moment passed: a blip (or a kick's body), not a note.
        if (this.pending) {
          this.discard(this.pending);
          end = null;
        }
      }
      return { onset, end };
    }
    this.unvoicedRun = 0;
    this.voicedRun++;
    this.pitches.push(this.midi);
    if (this.pitches.length > 3) this.pitches.shift();
    const pv = this.pitches;
    const midi = pv.length === 3 ? Math.max(Math.min(pv[0], pv[1]), Math.min(Math.max(pv[0], pv[1]), pv[2])) : this.midi;
    const stable = pv.length === 3 && Math.max(...pv) - Math.min(...pv) < 0.6;

    const begin = (at: number, m: number, fromKick: boolean): void => {
      const prev = this.pending;
      if (prev) {
        // Within the moment: the same note, its pitch corrected (dated to the earlier start).
        prev.onset.midi = m;
        if (!fromKick) prev.kick = false;
        prev.level = db;
        prev.until = t + HOLD_BACK;
        this.note = { t: prev.onset.t, midi: m, level: db };
      } else {
        if (this.note) end = at;
        this.note = { t: at, midi: m, level: db };
        this.pending = { onset: { t: at, midi: m, strength }, level: db, until: t + HOLD_BACK, kick: fromKick, strikes: this.strikes.slice() };
      }
      this.strikes = [];
      this.jump = null;
    };

    if (!this.note) {
      if (!stable) return { onset, end };
      // Dated to the earliest strike it settled from, else to when it came in.
      const first = this.strikes[0];
      if (first) begin(first[0], midi, first[1] && !this.strikes.some(([, k]) => !k));
      else begin(t - 2 * (512 / s.sampleRate) - WINDOW_SEC * 0.5, midi, false);
      return { onset, end };
    }
    const nt = this.note;
    if (Math.abs(midi - nt.midi) >= 0.75) {
      // A move to another pitch: dated to a strike if there was one, else it's legato.
      if (this.jump && Math.abs(midi - this.jump.sum / this.jump.count) < 0.45) {
        this.jump.count++;
        this.jump.sum += midi;
      } else this.jump = { t, sum: midi, count: 1 };
      if (this.jump.count >= 3) {
        const strike = this.strikes.find(([ts]) => ts > nt.t + 0.05);
        begin(strike ? strike[0] : this.jump.t - WINDOW_SEC * 0.5, this.jump.sum / this.jump.count, false);
      }
      return { onset, end };
    }
    this.jump = null;
    nt.midi += (midi - nt.midi) * 0.2;
    if (!stable || t - nt.t < 0.09) return { onset, end };
    // Re-struck at the same pitch: the tone broke up briefly, or a kick came with a jump in level.
    const broke = this.strikes.find(([ts, k]) => !k && ts > nt.t + 0.06);
    const lv = this.levels;
    const kicked = this.strikes.find(([ts, k]) => k && ts > nt.t + 0.06) && lv.length === 4 && Math.max(...lv) - Math.min(lv[0], lv[1]) >= 3;
    if (broke) begin(broke[0], nt.midi, false);
    else if (kicked) begin(this.strikes.find(([, k]) => k)![0], nt.midi, false);
    else if (lv.length === 4 && db - Math.min(lv[0], lv[1]) >= 4) begin(t - 0.012, nt.midi, false);
    return { onset, end };
  }
}
