import type { AnalysisSettings, TempoState } from '@shared/types/audio';
import type { HopFeatures } from '../dsp/analysisCore';
import { beatAt, TempoTracker, type TempoCommand } from './beatClock';
import { BpmEstimator, TapTempo } from './bpm';
import { MeterTracker } from './meter';

/**
 * Everything tempo-related, per analysis hop: auto-BPM estimation, the beat
 * clock (auto / tap / Link / MIDI Clock), and downbeat + phrase detection.
 * Pure (no worker globals) so tests drive exactly what the app runs.
 */
export class TempoPipeline {
  readonly tracker = new TempoTracker();
  readonly meter = new MeterTracker();
  private readonly estimator: BpmEstimator;
  private readonly tap = new TapTempo();
  private hopsSinceEstimate = 0;

  constructor(private readonly hopRate: number) {
    this.estimator = new BpmEstimator(hopRate);
  }

  get state(): TempoState {
    return this.tracker.state;
  }

  configure(s: AnalysisSettings): void {
    this.tracker.setBeatsPerPhrase(s.beatsPerPhrase);
    this.tracker.setSource(s.tempoSource);
  }

  process(f: HopFeatures, s: AnalysisSettings): void {
    // Auto-BPM: estimate four times a second from the onset-strength envelope.
    this.estimator.push(f.tempoOdf, f.t);
    if (++this.hopsSinceEstimate >= Math.round(this.hopRate / 4)) {
      this.hopsSinceEstimate = 0;
      if (!f.silence) {
        const est = this.estimator.update(s.bpmRange[0], s.bpmRange[1]);
        if (est) this.tracker.applyEstimate(est, f.t, s.bpmRange);
      }
    }
    // Downbeat and phrase starts from accents and spectral change on the beat grid.
    if (this.tracker.isLocked) {
      const m = this.meter.update(beatAt(this.tracker.state, f.t), f.bassLevel, f.tempoOdf, f.bands32, s.beatsPerPhrase, this.tracker.downbeatLocked, f.silence);
      this.tracker.setMeter(m.downbeatOffset, m.phraseOffset);
    }
    const src = this.tracker.state.source;
    if ((src === 'link' || src === 'midiClock') && this.tracker.externalAge(f.t) > 2) this.tracker.markStale();
  }

  /** External clock reading at audio time `t` (already shifted for latency / offset). */
  external(source: 'link' | 'midiClock', bpm: number, beat: number, t: number): void {
    this.tracker.applyExternal(source, bpm, beat, t);
  }

  command(c: TempoCommand): void {
    this.tracker.command(c, (t) => this.tap.tap(t));
  }
}
