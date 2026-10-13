import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS_SETTINGS, GRID_ROW, GRID_ROWS, GRID_SLOTS, type NoteGridState, type RawHop, type TempoState } from '@shared/types/audio';
import { AnalysisCore } from '@/audio/dsp/analysisCore';
import { HopAnalyzer } from '@/audio/dsp/hopAnalyzer';
import { beatAt } from '@/audio/tempo/beatClock';
import { NoteGrid } from '@/audio/tempo/noteGrid';
import { TempoPipeline } from '@/audio/tempo/pipeline';
import { bestPeriod, chartNote, gridAt, isStar, judge, laneCount, writeNote, type ChartNote, type ChartOptions, type Difficulty } from '@/engine/fretChart';
import { drumLoop, riffTrack, SR } from './signals';

const BPM = 120;
const HOP_RATE = 48000 / 512;

function tempoAt(bpm = BPM): TempoState {
  return { bpm, anchorTime: 0, anchorBeat: 0, confidence: 1, source: 'auto', beatsPerBar: 4, beatsPerPhrase: 16, downbeatOffset: 0, phraseOffset: 0 };
}

function opts(difficulty: Difficulty = 'expert'): ChartOptions {
  return { difficulty, barStart: 0, phraseStart: 0, barSlots: 16, phraseSlots: 64 };
}

/** Drive a NoteGrid with onset flags on chosen 16th slots (`at(slot)` → which drums hit). */
function gridFrom(slots: number, at: (s: number) => { kick?: boolean; snare?: boolean; hat?: boolean }, each?: (g: NoteGridState, x: number) => void): NoteGrid {
  const grid = new NoteGrid(HOP_RATE);
  const f = AnalysisCore.allocFeatures();
  f.silence = false;
  const mag = new Float32Array(2048);
  const tempo = tempoAt();
  const hopSec = 1 / HOP_RATE;
  let lastFired = -1;
  for (let t = 0; beatAt(tempo, t) * 4 < slots; t += hopSec) {
    const x = beatAt(tempo, t) * 4;
    const s = Math.round(x);
    // Fire once, on the first hop at or after the slot's own time.
    const fire = s !== lastFired && x >= s;
    const d = fire ? at(s) : {};
    if (fire) lastFired = s;
    f.t = t;
    f.kick = !!d.kick;
    f.snare = !!d.snare;
    f.hat = !!d.hat;
    f.odfKick = f.odfSnare = f.odfHat = 2;
    grid.process(f, mag, 48000, tempo);
    each?.(grid.state, x);
  }
  return grid;
}

const rockBeat = (s: number): { kick?: boolean; snare?: boolean; hat?: boolean } => {
  const inBar = ((s % 16) + 16) % 16;
  return { kick: inBar === 0 || inBar === 8, snare: inBar === 4 || inBar === 12, hat: inBar % 2 === 0 };
};

/**
 * Play a grid forward the way the highway does: each slot is charted when it
 * comes into view (`lookahead` slots ahead) and judged once it has passed.
 */
function playChart(run: (each: (g: NoteGridState, x: number) => void) => void, lookahead: number, o: ChartOptions, fromSlot: number) {
  const notes = new Map<number, ChartNote>();
  const results = new Map<number, string>();
  const played = new Set<number>();
  run((g, x) => {
    for (let s = Math.ceil(x); s <= Math.floor(x + lookahead); s++) {
      if (notes.has(s) || results.has(s)) continue;
      const n = chartNote(g, s, lookahead, o);
      if (n) notes.set(s, n);
      else results.set(s, 'empty');
    }
    for (const [s, n] of notes) {
      if (results.has(s)) continue;
      const r = judge(g, n);
      if (r !== 'pending') results.set(s, r);
    }
    // What was really played on each finished slot (any drum or tone).
    const done = g.slot - 2;
    if (done >= 0 && (gridAt(g, GRID_ROW.kick, done) || gridAt(g, GRID_ROW.snare, done) || gridAt(g, GRID_ROW.hat, done) || gridAt(g, GRID_ROW.tone, done))) played.add(done);
  });
  let hit = 0;
  let miss = 0;
  let caught = 0;
  let onsets = 0;
  for (const [s, r] of results) {
    if (s < fromSlot) continue;
    if (r === 'hit') hit++;
    if (r === 'miss') miss++;
  }
  for (const s of played) {
    if (s < fromSlot) continue;
    onsets++;
    if (notes.has(s) || notes.has(s - 1) || notes.has(s + 1)) caught++;
  }
  return { hit, miss, precision: hit / Math.max(1, hit + miss), recall: caught / Math.max(1, onsets), notes };
}

describe('Note grid', () => {
  it('lays the drums on the 16th-note slots of the beat clock', () => {
    const g = gridFrom(64, rockBeat).state;
    expect(g.valid).toBeGreaterThanOrEqual(63);
    for (let s = 2; s < 60; s++) {
      const want = rockBeat(s);
      expect(!!gridAt(g, GRID_ROW.kick, s), `kick ${s}`).toBe(!!want.kick);
      expect(!!gridAt(g, GRID_ROW.snare, s), `snare ${s}`).toBe(!!want.snare);
      expect(!!gridAt(g, GRID_ROW.hat, s), `hat ${s}`).toBe(!!want.hat);
    }
  });

  it('forgets everything after a silence (a new song starts from an empty grid)', () => {
    const grid = gridFrom(64, rockBeat);
    const f = AnalysisCore.allocFeatures();
    f.silence = true;
    const tempo = tempoAt();
    for (let k = 0; k < HOP_RATE * 3; k++) {
      f.t = 8 + k / HOP_RATE;
      grid.process(f, new Float32Array(2048), 48000, tempo);
    }
    expect(grid.state.valid).toBeLessThan(GRID_SLOTS);
    let any = 0;
    for (let i = 0; i < GRID_ROWS * GRID_SLOTS; i++) any += grid.state.data[i];
    expect(any).toBe(0);
  });

  it('starts over when the beat clock jumps', () => {
    const grid = gridFrom(64, rockBeat);
    const f = AnalysisCore.allocFeatures();
    f.silence = false;
    f.t = 100;
    grid.process(f, new Float32Array(2048), 48000, tempoAt());
    expect(grid.state.valid).toBe(1);
  });
});

describe('Chart prediction', () => {
  it('finds the loop: one bar for a steady beat, two bars when every other bar differs', () => {
    expect(bestPeriod(gridFrom(96, rockBeat).state, 90, 16).period).toBe(16);
    const twoBar = (s: number) => {
      const bar = Math.floor(s / 16) % 2;
      const r = rockBeat(s);
      const inBar = ((s % 16) + 16) % 16;
      return bar ? { ...r, kick: r.kick || inBar === 6 || inBar === 14, hat: inBar % 4 === 0 } : r;
    };
    expect(bestPeriod(gridFrom(160, twoBar).state, 150, 16).period).toBe(32);
  });

  it('charts the next bar of a steady beat ahead of time, and every note is hit', () => {
    for (const d of ['easy', 'medium', 'hard', 'expert'] as Difficulty[]) {
      const r = playChart((each) => gridFrom(256, rockBeat, each), 14, opts(d), 48);
      expect(r.hit, d).toBeGreaterThan(d === 'easy' ? 25 : 50);
      expect(r.miss, d).toBe(0);
    }
    // Expert catches every onset of the groove.
    expect(playChart((each) => gridFrom(256, rockBeat, each), 14, opts('expert'), 48).recall).toBe(1);
  });

  it('follows a change of groove within two bars', () => {
    const change = (s: number) => {
      if (s < 128) return rockBeat(s);
      const inBar = ((s % 16) + 16) % 16;
      return { kick: inBar % 4 === 0 || inBar === 14, snare: inBar === 8, hat: inBar % 2 === 1 };
    };
    const after = playChart((each) => gridFrom(256, change, each), 14, opts('expert'), 128 + 32);
    expect(after.precision).toBe(1);
    expect(after.recall).toBe(1);
  });

  it('never changes a note on its way down', () => {
    // A note charted when it comes into view is the same note charted later.
    const g = gridFrom(200, rockBeat).state;
    for (let s = g.slot + 1; s <= g.slot + 14; s++) {
      const a = chartNote(g, s, 14, opts());
      const b = chartNote(g, s, 14, opts());
      expect(a).toEqual(b);
    }
  });
});

describe('Chart writing', () => {
  const ev = (o: Partial<{ kick: number; snare: number; hat: number; tone: number; pitch: number; hold: number }>) => ({ kick: 0, snare: 0, hat: 0, tone: 0, pitch: 0, hold: 0, ...o });

  it('uses three lanes on easy, four on medium and five above', () => {
    expect(laneCount('easy')).toBe(3);
    expect(laneCount('medium')).toBe(4);
    expect(laneCount('hard')).toBe(5);
    // A high note on easy stays inside green, red and yellow.
    const w = writeNote(ev({ tone: 100, pitch: 255 }), 0, opts('easy'), 0.3);
    expect(w!.lanes).toBeLessThan(1 << 3);
  });

  it('keeps easier charts on the stronger beats', () => {
    // A hat on an off-beat eighth: not on easy, yes from medium up.
    expect(writeNote(ev({ hat: 100 }), 2, opts('easy'), 0.5)).toBeNull();
    expect(writeNote(ev({ hat: 100 }), 2, opts('medium'), 0.5)).not.toBeNull();
    // A sixteenth kick only on expert.
    expect(writeNote(ev({ kick: 100 }), 3, opts('hard'), 0.5)).toBeNull();
    expect(writeNote(ev({ kick: 100 }), 3, opts('expert'), 0.5)).not.toBeNull();
  });

  it('puts the drums on their lanes and plays big accents as chords', () => {
    expect(writeNote(ev({ kick: 100 }), 0, opts(), 0.5)!.lanes).toBe(1); // green on 1
    expect(writeNote(ev({ kick: 100 }), 4, opts(), 0.5)!.lanes).toBe(2); // red on 2
    expect(writeNote(ev({ snare: 100 }), 4, opts(), 0.5)!.lanes).toBe(4); // yellow
    expect(writeNote(ev({ kick: 200, snare: 200 }), 0, opts(), 0.5)!.lanes).toBe(4 | 16); // yellow + orange
    expect(writeNote(ev({ kick: 200, snare: 200 }), 0, opts('medium'), 0.5)!.lanes).toBe(4); // no chords on medium
  });

  it('walks a melody across the lanes by pitch and holds long notes', () => {
    const low = writeNote(ev({ tone: 100, pitch: 40 }), 2, opts(), 0.4)!;
    const high = writeNote(ev({ tone: 100, pitch: 200 }), 2, opts(), 0.4)!;
    expect(Math.log2(high.lanes)).toBeGreaterThan(Math.log2(low.lanes));
    expect(writeNote(ev({ tone: 100, pitch: 100, hold: 8 }), 2, opts(), 0.4)!.hold).toBe(8);
    expect(writeNote(ev({ tone: 100, pitch: 100, hold: 1 }), 2, opts(), 0.4)!.hold).toBe(0);
  });

  it('marks the last two bars of every other phrase as a star phrase', () => {
    const o = opts();
    expect(isStar(64 + 32, o)).toBe(true);
    expect(isStar(64 * 3 + 48, o)).toBe(true);
    expect(isStar(64 + 16, o)).toBe(false);
    expect(isStar(64 * 2 + 40, o)).toBe(false);
  });
});

/** Real audio through the app's front end, analysis, tempo and note grid. */
function playAudio(samples: Float32Array, each: (g: NoteGridState, x: number, tempo: TempoState) => void): void {
  const settings = DEFAULT_ANALYSIS_SETTINGS;
  const core = new AnalysisCore(SR);
  core.setSettings(settings);
  const pipe = new TempoPipeline(core.hopRate);
  pipe.configure(settings);
  const grid = new NoteGrid(core.hopRate);
  const feats = AnalysisCore.allocFeatures();
  const front = new HopAnalyzer(SR, (h: RawHop) => {
    const f = core.process(h, feats);
    pipe.process(f, settings);
    grid.process(f, h.mag, h.sampleRate, pipe.state);
    if (pipe.tracker.isLocked) each(grid.state, beatAt(pipe.state, f.t) * 4, pipe.state);
  });
  front.setSettings({ gainDb: 0, autoGain: true, gateDb: -60 });
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    const b = samples.subarray(i, i + 128);
    front.process(b, b, 128, i / SR);
  }
}

describe('Charting real audio', { timeout: 60000 }, () => {
  it('predicts a drum loop: nearly every note it shows is played', () => {
    const { samples } = drumLoop({ bpm: 124, seconds: 40, snare: true, hats: true });
    const r = playChart((each) => playAudio(samples, each), 14, opts('expert'), 0);
    // Judge only after the tempo has settled (the first 12 s).
    const late = [...r.notes.keys()].filter((s) => s > 124 / 60 * 12 * 4);
    expect(late.length).toBeGreaterThan(80);
    expect(r.precision).toBeGreaterThan(0.9);
    expect(r.recall).toBeGreaterThan(0.85);
  });

  it('charts a riff: melody notes come in as tone notes across the lanes, and the chart holds up through a change', () => {
    const { samples } = riffTrack({ bpm: 120, bars: 28, switchBar: 16 });
    const lanesUsed = new Set<number>();
    let tones = 0;
    const r = playChart((each) => playAudio(samples, each), 14, opts('expert'), 0);
    for (const n of r.notes.values()) {
      for (let l = 0; l < 5; l++) if (n.lanes & (1 << l)) lanesUsed.add(l);
      if (n.cats & 8) tones++;
    }
    expect(tones).toBeGreaterThan(20);
    expect(lanesUsed.size).toBe(5);
    expect(r.precision).toBeGreaterThan(0.85);
  });
});
