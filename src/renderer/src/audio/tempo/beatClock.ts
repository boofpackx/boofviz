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
  private readonly downbeatScore = new Float64Array(4);
  private lastDownbeatBeat = -1;
  private manualDownbeat = false;

  setSource(source: TempoSourceKind): void {
    this.state = { ...this.state, source };
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
    const gain = Math.abs(err) > 0.1 ? 0.6 : 0.35;
    const correction = -err * gain * Math.min(1, est.confidence * 2);
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

  /** Feed kick onsets (with strength) to estimate which beat of the bar is the downbeat. */
  observeKick(t: number, strength: number, bassLevel: number): void {
    if (this.manualDownbeat || !this.locked) return;
    const b = beatAt(this.state, t);
    const nearest = Math.round(b);
    const dist = Math.abs(b - nearest);
    if (dist > 0.2) return;
    const pos = ((nearest % 4) + 4) % 4;
    for (let i = 0; i < 4; i++) this.downbeatScore[i] *= 0.995;
    this.downbeatScore[pos] += strength * (0.5 + bassLevel) * (1 - dist * 4);
    if (nearest - this.lastDownbeatBeat < 16) return;
    let best = 0;
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      sum += this.downbeatScore[i];
      if (this.downbeatScore[i] > this.downbeatScore[best]) best = i;
    }
    if (this.downbeatScore[best] > (sum / 4) * 1.2 && best !== this.state.downbeatOffset) {
      this.state = { ...this.state, downbeatOffset: best, phraseOffset: best };
      this.lastDownbeatBeat = nearest;
    }
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
