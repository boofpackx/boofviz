import { GRID_PREDICTED_ROWS, GRID_ROW, GRID_ROWS, GRID_SLOTS, type NoteGridState, type TempoState } from '@shared/types/audio';
import { beatAt } from '../tempo/beatClock';
import type { BandHop } from './bandAnalyzer';

const MASK = GRID_SLOTS - 1;
/** Rows a new slot clears (the heard ones; the expected ones were written ahead). */
const HEARD_ROWS = GRID_PREDICTED_ROWS + 1;
/** Longest hold recorded (slots: two bars). */
const MAX_HOLD = 32;

type Pitched = 'bass' | 'guitar' | 'vocals';
const ROWS: Record<Pitched, { on: number; pitch: number; hold: number }> = {
  bass: { on: GRID_ROW.bass, pitch: GRID_ROW.bassPitch, hold: GRID_ROW.bassHold },
  guitar: { on: GRID_ROW.guitar, pitch: GRID_ROW.guitarPitch, hold: GRID_ROW.guitarHold },
  vocals: { on: GRID_ROW.vocals, pitch: GRID_ROW.vocalsPitch, hold: GRID_ROW.vocalsHold },
};

const byte = (v: number): number => Math.max(1, Math.min(255, Math.round(v * 255)));
const pitchByte = (m: number): number => Math.max(1, Math.min(127, Math.round(m)));

/**
 * The heard rows of the note grid: every part's onsets laid on the beat
 * clock's 16th-note slots (each dated by its tracker, so it lands in the slot
 * it was played in), with its pitch and, once it has ended, how long it held.
 * The predictor fills the expected rows. Restarts after a silence or a jump
 * of the beat clock.
 */
export class PartGrid {
  readonly state: NoteGridState = { slot: 0, valid: 0, data: new Uint8Array(GRID_ROWS * GRID_SLOTS) };
  /** Changed since it was last sent. */
  dirty = true;
  /** Slots that became final on the last update (oldest first). */
  readonly finished: number[] = [];
  /** The grid restarted on the last update. */
  restarted = false;
  private started = false;
  private quietSec = 0;
  private readonly open: Record<Pitched, number | null> = { bass: null, guitar: null, vocals: null };

  constructor(private readonly hopSec: number) {}

  index(row: number, slot: number): number {
    return row * GRID_SLOTS + (slot & MASK);
  }

  get(row: number, slot: number): number {
    const st = this.state;
    if (slot > st.slot + GRID_SLOTS / 2 || slot <= st.slot - st.valid) return 0;
    return st.data[this.index(row, slot)];
  }

  set(row: number, slot: number, v: number): void {
    const i = this.index(row, slot);
    if (this.state.data[i] !== v) {
      this.state.data[i] = v;
      this.dirty = true;
    }
  }

  private put(row: number, slot: number, v: number): void {
    const i = this.index(row, slot);
    if (v > this.state.data[i]) {
      this.state.data[i] = v;
      this.dirty = true;
    }
  }

  reset(slot: number): void {
    this.state.data.fill(0);
    this.state.valid = 1;
    this.state.slot = slot;
    this.open.bass = this.open.guitar = this.open.vocals = null;
    this.restarted = true;
    this.dirty = true;
  }

  update(band: BandHop, tempo: TempoState, silent: boolean): void {
    const st = this.state;
    this.finished.length = 0;
    this.restarted = false;
    const now = Math.round(beatAt(tempo, band.t) * 4);
    if (!this.started) {
      this.started = true;
      this.reset(now);
    }
    const step = now - st.slot;
    if (step < -8 || step > 64) this.reset(now);
    else if (step > 0) {
      for (let s = st.slot + 1; s <= now; s++) for (let r = 0; r < HEARD_ROWS; r++) st.data[this.index(r, s)] = 0;
      for (let s = st.slot; s < now; s++) this.finished.push(s);
      st.slot = now;
      st.valid = Math.min(GRID_SLOTS - 32, st.valid + step);
      this.dirty = true;
    }
    this.quietSec = silent ? this.quietSec + this.hopSec : 0;
    if (this.quietSec > 2 && st.valid > 1) this.reset(now);

    // A dated onset's slot (only into the recent past).
    const slotOf = (t: number): number | null => {
      const s = Math.round(beatAt(tempo, t) * 4);
      return s <= now && now - s < 48 && s > now - st.valid ? s : null;
    };
    const d = band.drums;
    const ds = slotOf(d.t);
    if (ds !== null) {
      if (d.kick) this.put(GRID_ROW.kick, ds, byte(d.kick));
      if (d.snare) this.put(GRID_ROW.snare, ds, byte(d.snare));
      if (d.hat) this.put(GRID_ROW.hat, ds, byte(d.hat));
    }
    if (d.crash) {
      const cs = slotOf(d.crash.t);
      if (cs !== null) this.put(GRID_ROW.crash, cs, byte(d.crash.strength));
    }
    for (const part of ['bass', 'guitar', 'vocals'] as const) {
      const ev = band[part];
      const rows = ROWS[part];
      if (ev.end !== null) this.close(part, slotOf(ev.end) ?? now);
      if (ev.onset) {
        const s = slotOf(ev.onset.t);
        if (s === null) continue;
        this.close(part, s);
        this.put(rows.on, s, byte(ev.onset.strength));
        this.set(rows.pitch, s, pitchByte(ev.onset.midi));
        if (part === 'guitar') this.set(GRID_ROW.guitarChord, s, (ev.onset as { chord?: number }).chord ?? 1);
        this.open[part] = s;
      }
    }
    if (band.vocalMidi > 0) {
      const vs = slotOf(band.vocalT);
      if (vs !== null) this.set(GRID_ROW.vocalsLine, vs, pitchByte(band.vocalMidi));
    }
  }

  /** The note sounding in `part` ended at slot `at`: write how long it held. */
  private close(part: Pitched, at: number): void {
    const s = this.open[part];
    if (s === null) return;
    this.open[part] = null;
    const len = at - s;
    if (len >= 2 && this.state.slot - s < GRID_SLOTS / 2) this.set(ROWS[part].hold, s, Math.min(MAX_HOLD, len));
  }
}
