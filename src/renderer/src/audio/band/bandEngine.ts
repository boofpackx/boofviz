import { GRID_HORIZON, type RawHop, type TempoState } from '@shared/types/audio';
import type { HopFeatures } from '../dsp/analysisCore';
import { BandAnalyzer } from './bandAnalyzer';
import { PartGrid } from './partGrid';
import { Predictor } from './predictor';

/** The trackers' longest delay (s: the bass holds a note back while its pitch settles). */
export const BAND_LATENCY = 0.26;

/** Slots a slot has to be old before every tracker has written it. */
export function settleSlots(bpm: number): number {
  return Math.ceil((BAND_LATENCY * Math.max(40, bpm) * 4) / 60);
}

/**
 * The band chart, live: the part trackers, the heard rows of the note grid
 * and the predictor that writes the expected rows ahead. One per analysis
 * worker; every window and look reads the grid it keeps.
 */
export class BandEngine {
  readonly analyzer: BandAnalyzer;
  readonly grid: PartGrid;
  readonly predictor = new Predictor();
  private horizon = Number.NaN;

  constructor(
    readonly sampleRate: number,
    hopRate: number,
  ) {
    this.analyzer = new BandAnalyzer(sampleRate);
    this.grid = new PartGrid(1 / hopRate);
  }

  /** One hop. `singing`: what synced lyrics say (null: no lyrics). */
  process(f: HopFeatures, hop: RawHop, tempo: TempoState, singing: boolean | null = null): void {
    const band = this.analyzer.process(f, hop, singing);
    const grid = this.grid;
    grid.update(band, tempo, f.silence);
    const bar = Math.max(4, tempo.beatsPerBar * 4);
    const now = grid.state.slot;
    if (grid.restarted) {
      this.predictor.reset();
      this.analyzer.reset();
      this.horizon = now + GRID_HORIZON - 1;
    }
    // A slot is final for the predictor once every tracker has had time to write it.
    const lag = settleSlots(tempo.bpm);
    this.predictor.ahead = GRID_HORIZON + 1 + lag;
    for (const s of grid.finished) this.predictor.finish(grid, s - lag, bar);
    const target = now + GRID_HORIZON;
    const from = Number.isNaN(this.horizon) ? target : Math.max(this.horizon + 1, target - 32);
    for (let s = from; s <= target; s++) this.predictor.predict(grid, s, bar, now - 1 - lag);
    this.horizon = Math.max(Number.isNaN(this.horizon) ? target : this.horizon, target);
  }
}
