import type { TempoSourceKind, TempoState } from '@shared/types/audio';
import type { TempoEstimate } from './bpm';

export function beatAt(s: TempoState, t: number): number {
  return s.anchorBeat + ((t - s.anchorTime) * s.bpm) / 60;
}

export type TempoCommand =
  | { cmd: 'tap'; t: number }
  | { cmd: 'nudge'; beats: number; t: number }
  | { cmd: 'bpmNudge'; delta: number; t: number }
  | { cmd: 'half'; t: number }
  | { cmd: 'double'; t: number }
  | { cmd: 'resyncDownbeat'; t: number };

/**
 * Owns the authoritative tempo clock. Auto-BPM estimates are folded in with a
 * phase-locked loop (small, continuous corrections; octave jumps need
 * agreement over several estimates) so the beat counter never lurches.
 */
export class TempoTracker {
  state: TempoState = {
    bpm: 120,
    anchorTime: 0,
    anchorBeat: 0,
    confidence: 0,
    source: 'auto',
    beatsPerBar: 4,
    beatsPerPhrase: 16,
    downbeatOffset: 0,
    phraseOffset: 0,
  };

  private locked = false;
  private lastEstimateTime = 0;
  private lastJumpTime = -Infinity;
  private pendingBpm = 0;
  private pendingCount = 0;
  private lastErr = 0;
  private manualDownbeat = false;
  private externalAt = -Infinity;

  /** True when the user pinned the downbeat, or an external clock defines the bar. */
  get downbeatLocked(): boolean {
    return this.manualDownbeat || this.state.source === 'link' || this.state.source === 'midiClock';
  }

  /** Seconds since the last external (Link / MIDI) update, at audio time t. */
  externalAge(t: number): number {
    return t - this.externalAt;
  }

  setSource(source: TempoSourceKind): void {
    if (source === this.state.source) return;
    const external = source === 'link' || source === 'midiClock';
    // Leaving or joining an external clock: its bar grid replaces ours (and vice versa).
    this.state = { ...this.state, source, confidence: external ? 0 : this.state.confidence };
    this.manualDownbeat = false;
    this.externalAt = -Infinity;
  }

  /**
   * Follow an external clock (Ableton Link or MIDI Clock): `beat` is the
   * session beat at audio time `t`, already shifted by any offset. Beat 0 is a
   * bar start. Snaps when far off, otherwise re-anchors in tiny steps so the
   * beat counter stays smooth.
   */
  applyExternal(source: 'link' | 'midiClock', bpm: number, beat: number, t: number): boolean {
    if (this.state.source !== source || !(bpm > 0)) return false;
    this.externalAt = t;
    const predicted = beatAt(this.state, t);
    const err = predicted - beat;
    const tempoChanged = Math.abs(bpm / this.state.bpm - 1) > 1e-4;
    if (this.state.confidence < 0.5 || Math.abs(err) > 0.25 || tempoChanged || Math.abs(err) > 0.002) {
      const bar = this.state.beatsPerBar;
      this.state = {
        ...this.state,
        bpm,
        anchorTime: t,
        anchorBeat: beat,
        confidence: 1,
        downbeatOffset: this.manualDownbeat ? this.state.downbeatOffset : 0,
        phraseOffset: this.manualDownbeat ? this.state.phraseOffset : ((this.state.phraseOffset % bar) + bar) % bar === 0 ? this.state.phraseOffset : 0,
      };
      this.locked = true;
    }
    return true;
  }

  /** An external clock went quiet: keep the tempo running, but say we're unsure. */
  markStale(): void {
    if (this.state.confidence > 0.25) this.state = { ...this.state, confidence: 0.25 };
  }

  /** Apply downbeat / phrase offsets found by the meter tracker. */
  setMeter(downbeatOffset: number, phraseOffset: number): void {
    if (this.manualDownbeat) return;
    const down = this.downbeatLocked ? this.state.downbeatOffset : downbeatOffset;
    if (down !== this.state.downbeatOffset || phraseOffset !== this.state.phraseOffset) {
      this.state = { ...this.state, downbeatOffset: down, phraseOffset };
    }
  }

  /** The tracker has a beat grid worth measuring meter against. */
  get isLocked(): boolean {
    return this.locked;
  }

  setBeatsPerPhrase(n: number): void {
    this.state = { ...this.state, beatsPerPhrase: n };
  }

  /** Re-anchor at time t, keeping beat continuity, with a new bpm. */
  private reanchor(t: number, bpm: number, beatShift = 0): void {
    const beat = beatAt(this.state, t) + beatShift;
    this.state = { ...this.state, bpm, anchorTime: t, anchorBeat: beat };
  }

  applyEstimate(est: TempoEstimate, now: number, range: [number, number]): boolean {
    if (this.state.source !== 'auto') return false;
    let { bpm } = est;
    while (bpm < range[0]) bpm *= 2;
    while (bpm > range[1]) bpm /= 2;
    if (est.confidence < 0.08) {
      this.state = { ...this.state, confidence: this.state.confidence * 0.9 };
      return true;
    }

    if (!this.locked) {
      // First lock: snap tempo and phase directly.
      const beatsSince = ((now - est.beatTime) * bpm) / 60;
      this.state = { ...this.state, bpm, anchorTime: est.beatTime, anchorBeat: Math.round(beatAt(this.state, now) - beatsSince), confidence: est.confidence };
      this.locked = true;
      return true;
    }

    const cur = this.state.bpm;
    const ratio = bpm / cur;
    if (Math.abs(ratio - 1) > 0.04) {
      // Possible tempo change (or octave error): require consistent agreement first.
      if (this.pendingBpm && Math.abs(bpm / this.pendingBpm - 1) < 0.03) this.pendingCount++;
      else {
        this.pendingBpm = bpm;
        this.pendingCount = 1;
      }
      const isOctave = Math.abs(ratio - 2) < 0.08 || Math.abs(ratio - 0.5) < 0.04;
      if (this.pendingCount < (isOctave ? 8 : 3)) {
        this.state = { ...this.state, confidence: this.state.confidence * 0.97 };
        return true;
      }
      this.pendingCount = 0;
      this.locked = false;
      return this.applyEstimate({ ...est, bpm }, now, range);
    }
    this.pendingCount = 0;

    // PI phase-locked loop: slew tempo toward the estimate, pull phase toward the
    // observed beat (harder when far off, e.g. after a cue jump), and integrate
    // the residual phase error into tempo so a small BPM bias can't drift.
    const predicted = beatAt(this.state, est.beatTime);
    const err = predicted - Math.round(predicted); // -0.5..0.5 beats
    // The same large error twice in a row is a jump (cue, loop, new track): snap to it.
    const jump = Math.abs(err) > 0.12 && Math.abs(err - this.lastErr) < 0.06;
    this.lastErr = err;
    // Big, confident errors are corrected almost fully; small ones gently (jitter).
    const gain = jump ? 1 : Math.abs(err) > 0.15 ? 0.85 : Math.abs(err) > 0.06 ? 0.6 : 0.35;
    const correction = -err * gain * (jump ? 1 : Math.min(1, est.confidence * 2));
    const dtEst = this.lastEstimateTime ? now - this.lastEstimateTime : 0;
    // A large error is a phase jump (cue, loop, new track), not a tempo error:
    // hold the integrator off until the loop has settled to avoid overshoot.
    if (Math.abs(err) > 0.1) this.lastJumpTime = now;
    const settled = now - this.lastJumpTime > 4;
    const integral = settled && dtEst > 0.2 && dtEst < 2 ? (-err / dtEst) * 60 * 0.05 : 0;
    this.lastEstimateTime = now;
    const newBpm = cur + (bpm - cur) * 0.25 + integral;
    this.reanchor(now, newBpm, correction);
    this.state = { ...this.state, confidence: this.state.confidence + (est.confidence - this.state.confidence) * 0.3 };
    return true;
  }

  command(c: TempoCommand, tap: (t: number) => { bpm: number; lastTap: number } | null): void {
    switch (c.cmd) {
      case 'tap': {
        const res = tap(c.t);
        if (!res) return;
        const beat = Math.round(beatAt(this.state, res.lastTap));
        this.state = { ...this.state, bpm: res.bpm, anchorTime: res.lastTap, anchorBeat: beat, confidence: 1, source: 'tap' };
        this.locked = true;
        return;
      }
      case 'nudge':
        this.reanchor(c.t, this.state.bpm, c.beats);
        return;
      case 'bpmNudge':
        this.reanchor(c.t, Math.max(30, this.state.bpm + c.delta));
        return;
      case 'half':
        this.reanchor(c.t, this.state.bpm / 2);
        return;
      case 'double':
        this.reanchor(c.t, this.state.bpm * 2);
        return;
      case 'resyncDownbeat': {
        // The nearest beat to "now" becomes beat 1 of the bar and of the phrase.
        const nearest = Math.round(beatAt(this.state, c.t));
        const bar = this.state.beatsPerBar;
        const phrase = this.state.beatsPerPhrase;
        this.state = {
          ...this.state,
          downbeatOffset: ((nearest % bar) + bar) % bar,
          phraseOffset: ((nearest % phrase) + phrase) % phrase,
        };
        this.manualDownbeat = true;
        return;
      }
    }
  }
}
