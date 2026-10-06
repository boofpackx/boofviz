import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisSettings, type RawHop } from '@shared/types/audio';
import { HopAnalyzer } from '@/audio/dsp/hopAnalyzer';
import { AnalysisCore } from '@/audio/dsp/analysisCore';
import { beatAt } from '@/audio/tempo/beatClock';
import { MidiClockTracker } from '@/audio/tempo/midiClock';
import { TempoPipeline } from '@/audio/tempo/pipeline';
import { drumLoop, rng, SR, structuredTrack } from './signals';

/** Run audio through the real front end + analysis + tempo pipeline, calling `each` per hop. */
function run(samples: Float32Array, settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS, each?: (t: number, p: TempoPipeline) => void): TempoPipeline {
  const core = new AnalysisCore(SR);
  core.setSettings(settings);
  const pipe = new TempoPipeline(core.hopRate);
  pipe.configure(settings);
  const feats = AnalysisCore.allocFeatures();
  const front = new HopAnalyzer(SR, (h: RawHop) => {
    const f = core.process(h, feats);
    pipe.process(f, settings);
    each?.(f.t, pipe);
  });
  front.setSettings({ gainDb: 0, autoGain: true, gateDb: -60 });
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    const b = samples.subarray(i, i + 128);
    front.process(b, b, 128, i / SR);
  }
  return pipe;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

describe('MIDI Clock', () => {
  it('fits tempo from jittery 24 ppqn pulses and counts beats from Start', () => {
    const c = new MidiClockTracker();
    const rand = rng(3);
    const bpm = 127.5;
    const tick = 60000 / bpm / 24;
    c.message([0xfa], 1000);
    let t = 1000;
    for (let i = 0; i <= 24 * 8; i++) {
      c.message([0xf8], t + (rand() - 0.5) * 2); // ±1 ms USB jitter
      t += tick;
    }
    const r = c.reading()!;
    expect(Math.abs(r.bpm - bpm)).toBeLessThan(0.15);
    // 193 pulses after Start: the last one is beat 8 exactly.
    expect(r.beat).toBeCloseTo(8, 6);
    expect(Math.abs(r.epochMs - (t - tick))).toBeLessThan(1);
    c.message([0xfc], t);
    expect(c.reading()!.running).toBe(false);
  });

  it('honours Song Position Pointer', () => {
    const c = new MidiClockTracker();
    c.message([0xf2, 32, 0], 0); // 32 sixteenths = beat 8
    for (let i = 0; i < 24; i++) c.message([0xf8], i * 20);
    expect(c.reading()!.beat).toBeCloseTo(8 + 23 / 24, 6);
  });
});

describe('External clock (Link)', () => {
  it('follows session tempo and phase within a millisecond, smoothly', () => {
    const settings = { ...DEFAULT_ANALYSIS_SETTINGS, tempoSource: 'link' as const };
    const pipe = new TempoPipeline(93.75);
    pipe.configure(settings);
    const bpm = 128;
    const rand = rng(5);
    let last = -Infinity;
    let worstMs = 0;
    for (let k = 0; k < 200; k++) {
      const t = 10 + k * 0.05;
      const trueBeat = 1000 + (t * bpm) / 60;
      // Snapshot timestamps carry ~0.3 ms of jitter.
      const jitter = (rand() - 0.5) * 0.0006;
      pipe.external('link', bpm, trueBeat + (jitter * bpm) / 60, t);
      const shown = beatAt(pipe.state, t + 0.025);
      worstMs = Math.max(worstMs, Math.abs(((shown - (1000 + ((t + 0.025) * bpm) / 60)) * 60000) / bpm));
      expect(shown).toBeGreaterThan(last - 0.01);
      last = shown;
    }
    expect(worstMs).toBeLessThan(1);
    expect(pipe.state.source).toBe('link');
    expect(pipe.state.confidence).toBe(1);
    // Beat 0 of the Link session (quantum 4) is a bar start.
    expect(pipe.state.downbeatOffset).toBe(0);
  });
});

describe('Auto beat tracking', { timeout: 60000 }, () => {
  it('finds the downbeat and the phrase start of a structured track', () => {
    const bpm = 126;
    const { samples, barStarts, phraseStarts } = structuredTrack({ bpm, bars: 48, phraseBars: 4 });
    const pipe = run(samples);
    const s = pipe.state;
    expect(Math.abs(s.bpm - bpm)).toBeLessThan(0.6);
    // Every true bar start in the last third must sit on beat 1.
    const late = barStarts.filter((t) => t > (barStarts[barStarts.length - 1] * 2) / 3);
    const downOk = late.filter((t) => mod(Math.round(beatAt(s, t)) - s.downbeatOffset, 4) === 0).length;
    expect(downOk / late.length).toBeGreaterThan(0.9);
    // And phrase starts (every 4 bars = 16 beats) on the phrase boundary.
    const latePhr = phraseStarts.filter((t) => t > (barStarts[barStarts.length - 1] * 2) / 3);
    const phrOk = latePhr.filter((t) => mod(Math.round(beatAt(s, t)) - s.phraseOffset, 16) === 0).length;
    expect(phrOk / latePhr.length).toBeGreaterThan(0.9);
  });

  it('re-locks within ~2 s after a cue jump', () => {
    const bpm = 126;
    const a = drumLoop({ bpm, seconds: 14, snare: true, hats: true }).samples;
    // Jump: restart the same groove 0.35 beats late.
    const gap = Math.round(((0.35 * 60) / bpm) * SR);
    const b = drumLoop({ bpm, seconds: 10, snare: true, hats: true }).samples;
    const all = new Float32Array(a.length + gap + b.length);
    all.set(a, 0);
    all.set(b, a.length + gap);
    const jumpAt = (a.length + gap) / SR;
    const beatDur = 60 / bpm;
    let relockedAt = Infinity;
    run(all, DEFAULT_ANALYSIS_SETTINGS, (t, p) => {
      if (t < jumpAt + 0.2 || relockedAt < Infinity) return;
      // Phase error relative to the new kick grid (kicks at jumpAt + n·beat).
      const kicksSince = Math.round((t - jumpAt) / beatDur);
      const kickT = jumpAt + kicksSince * beatDur;
      const b2 = beatAt(p.state, kickT);
      const errMs = Math.abs(b2 - Math.round(b2)) * beatDur * 1000;
      if (errMs < 20) relockedAt = t;
    });
    expect(relockedAt - jumpAt).toBeLessThan(2.5);
  });
});
