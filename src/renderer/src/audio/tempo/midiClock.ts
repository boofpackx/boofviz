/**
 * MIDI Clock follower: 24 pulses per quarter note, plus Start / Continue /
 * Stop and Song Position Pointer. Tempo is a least-squares fit over the last
 * two beats of pulses, so USB jitter averages out.
 */
export interface ClockReading {
  bpm: number;
  /** Beat position at `epochMs` (beats since Start / song position). */
  beat: number;
  epochMs: number;
  running: boolean;
}

const PPQN = 24;
const WINDOW = 48;

export class MidiClockTracker {
  private ticks = 0;
  private running = false;
  private readonly times = new Float64Array(WINDOW);
  private readonly counts = new Float64Array(WINDOW);
  private n = 0;
  private head = 0;
  private lastTickEpoch = 0;

  /** Feed one MIDI message (status byte first) received at `epochMs`. */
  message(data: ArrayLike<number>, epochMs: number): void {
    const status = data[0];
    switch (status) {
      case 0xf8: // timing clock
        this.ticks++;
        this.lastTickEpoch = epochMs;
        this.times[this.head] = epochMs;
        this.counts[this.head] = this.ticks;
        this.head = (this.head + 1) % WINDOW;
        if (this.n < WINDOW) this.n++;
        // Many DJ apps send clock without Start; treat a running clock as playing.
        this.running = true;
        break;
      case 0xfa: // start
        this.ticks = -1; // the next pulse is beat 0
        this.n = 0;
        this.running = true;
        break;
      case 0xfb: // continue
        this.running = true;
        break;
      case 0xfc: // stop
        this.running = false;
        break;
      case 0xf2: // song position pointer, in 16th notes (6 pulses each)
        if (data.length >= 3) {
          this.ticks = (data[1] | (data[2] << 7)) * 6 - 1;
          this.n = 0;
        }
        break;
    }
  }

  /** Current estimate, or null until there are enough pulses. */
  reading(): ClockReading | null {
    if (this.n < 12) return null;
    // Least squares: time = a + b * tick.
    let st = 0;
    let sc = 0;
    let scc = 0;
    let sct = 0;
    const t0 = this.times[(this.head - this.n + WINDOW) % WINDOW];
    for (let i = 0; i < this.n; i++) {
      const k = (this.head - this.n + i + WINDOW) % WINDOW;
      const c = this.counts[k];
      const t = this.times[k] - t0;
      st += t;
      sc += c;
      scc += c * c;
      sct += c * t;
    }
    const b = (this.n * sct - sc * st) / (this.n * scc - sc * sc);
    if (!(b > 0)) return null;
    const a = (st - b * sc) / this.n;
    const lastCount = this.counts[(this.head - 1 + WINDOW) % WINDOW];
    const fittedEpoch = t0 + a + b * lastCount;
    return { bpm: 60000 / (b * PPQN), beat: lastCount / PPQN, epochMs: fittedEpoch, running: this.running };
  }

  /** ms since the last pulse (for "no clock" detection). */
  silenceMs(now: number): number {
    return this.lastTickEpoch ? now - this.lastTickEpoch : Infinity;
  }
}
