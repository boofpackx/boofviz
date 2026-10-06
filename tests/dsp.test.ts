import { describe, expect, it } from 'vitest';
import { HOP_SIZE, type RawHop } from '@shared/types/audio';
import { FFT } from '@/audio/dsp/fft';
import { kWeighting, MomentaryLoudness } from '@/audio/dsp/loudness';
import { HopAnalyzer } from '@/audio/dsp/hopAnalyzer';
import { AnalysisCore } from '@/audio/dsp/analysisCore';
import { BpmEstimator, TapTempo } from '@/audio/tempo/bpm';
import { TempoTracker, beatAt } from '@/audio/tempo/beatClock';
import { drumLoop, sine, SR } from './signals';

/** Run a mono signal through the worklet front end + worker analysis, like the real pipeline. */
function analyse(samples: Float32Array, autoGain = true) {
  const hops: RawHop[] = [];
  const front = new HopAnalyzer(SR, (h) => hops.push({ ...h, mag: h.mag.slice() }));
  front.setSettings({ gainDb: 0, autoGain, gateDb: -60 });
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    const block = samples.subarray(i, i + 128);
    front.process(block, block, 128, i / SR);
  }
  const core = new AnalysisCore(SR);
  const feats = hops.map((h) => ({ ...core.process(h, AnalysisCore.allocFeatures()), bands: undefined }));
  return { hops, feats, core };
}

describe('FFT', () => {
  it('puts a full-scale bin-centred sine at magnitude ≈ 1 in the right bin', () => {
    const n = 4096;
    const fft = new FFT(n);
    const k = 100;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * k * i) / n);
    const out = new Float32Array(n / 2);
    fft.magnitudes(input, out);
    let best = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[best]) best = i;
    expect(best).toBe(k);
    expect(out[k]).toBeCloseTo(1, 2);
  });
});

describe('Loudness', () => {
  it('reads a 997 Hz full-scale sine on both channels at ≈ 0 LUFS', () => {
    const [a, b] = kWeighting(SR);
    const [c, d] = kWeighting(SR);
    const m = new MomentaryLoudness(Math.round((0.4 * SR) / HOP_SIZE));
    const sig = sine(997, 2);
    let lufs = -70;
    for (let i = 0; i + HOP_SIZE <= sig.length; i += HOP_SIZE) {
      let sum = 0;
      for (let j = 0; j < HOP_SIZE; j++) {
        const l = b.process(a.process(sig[i + j]));
        const r = d.process(c.process(sig[i + j]));
        sum += l * l + r * r;
      }
      lufs = m.push(sum, HOP_SIZE);
    }
    expect(lufs).toBeGreaterThan(-0.5);
    expect(lufs).toBeLessThan(0.5);
  });
});

describe('Onsets', () => {
  it('detects kicks within one hop of the true hit and does not double-fire', () => {
    const { samples, kickTimes } = drumLoop({ bpm: 128, seconds: 12, snare: true, hats: true, offset: 0.5 });
    const { feats } = analyse(samples);
    const hits = feats.filter((f) => f.kick).map((f) => f.t);
    // Skip the first two seconds while thresholds adapt.
    const truth = kickTimes.filter((t) => t > 2.5);
    const detected = hits.filter((t) => t > 2.4);
    let matched = 0;
    for (const t of truth) if (detected.some((h) => h >= t - 0.005 && h - t < 0.035)) matched++;
    expect(matched / truth.length).toBeGreaterThan(0.95);
    // No more detections than kicks (allowing a couple of strays).
    expect(detected.length).toBeLessThanOrEqual(truth.length + 2);
  });

  it('detects snares on 2 and 4', () => {
    const { samples, snareTimes } = drumLoop({ bpm: 120, seconds: 12, snare: true, offset: 0.5 });
    const { feats } = analyse(samples);
    const hits = feats.filter((f) => f.snare).map((f) => f.t);
    const truth = snareTimes.filter((t) => t > 2.5);
    let matched = 0;
    for (const t of truth) if (hits.some((h) => h >= t - 0.005 && h - t < 0.035)) matched++;
    expect(matched / truth.length).toBeGreaterThan(0.85);
  });

  it('stays silent (no onsets, silence flag) on digital silence', () => {
    const { feats } = analyse(new Float32Array(SR * 3));
    expect(feats.some((f) => f.kick || f.snare || f.hat)).toBe(false);
    expect(feats[feats.length - 1].silence).toBe(true);
  });
});

describe('Tempo', () => {
  for (const bpm of [92, 100, 110, 118, 124, 128, 132, 140, 150, 160, 174]) {
    it(`estimates ${bpm} BPM from a drum loop`, () => {
      const { samples } = drumLoop({ bpm, seconds: 14, snare: true, hats: true });
      const { feats, core } = analyse(samples);
      const est = new BpmEstimator(core.hopRate);
      for (const f of feats) est.push(f.tempoOdf, f.t);
      const range: [number, number] = bpm > 160 ? [120, 190] : [70, 180];
      const r = est.update(range[0], range[1]);
      expect(r).not.toBeNull();
      expect(Math.abs(r!.bpm - bpm)).toBeLessThan(1);
    });
  }

  it('locks beat phase to the kicks (±15 ms)', () => {
    const bpm = 126;
    const { samples, kickTimes } = drumLoop({ bpm, seconds: 16, snare: true, hats: true });
    const { feats, core } = analyse(samples);
    const est = new BpmEstimator(core.hopRate);
    const tracker = new TempoTracker();
    let i = 0;
    for (const f of feats) {
      est.push(f.tempoOdf, f.t);
      if (++i % 47 === 0) {
        const e = est.update(70, 180);
        if (e) tracker.applyEstimate(e, f.t, [70, 180]);
      }
    }
    const lastKick = kickTimes[kickTimes.length - 1];
    const b = beatAt(tracker.state, lastKick);
    const errBeats = b - Math.round(b);
    const errMs = (errBeats * 60000) / bpm;
    expect(Math.abs(tracker.state.bpm - bpm)).toBeLessThan(0.6);
    // Onset detection lags the true transient by up to one hop; allow that.
    expect(Math.abs(errMs)).toBeLessThan(15);
  });

  it('tap tempo averages taps', () => {
    const tap = new TapTempo();
    let r = null;
    for (let i = 0; i < 6; i++) r = tap.tap(10 + i * 0.5 + (i % 2 ? 0.004 : -0.004));
    expect(r!.bpm).toBeGreaterThan(119);
    expect(r!.bpm).toBeLessThan(121);
  });
});

describe('Drop detection', () => {
  it('fires once when the bass returns after a breakdown', () => {
    const groove = drumLoop({ bpm: 128, seconds: 8, snare: true, hats: true }).samples;
    const breakdown = drumLoop({ bpm: 128, seconds: 6, kick: false, snare: true, hats: true }).samples;
    const drop = drumLoop({ bpm: 128, seconds: 6, snare: true, hats: true }).samples;
    const all = new Float32Array(groove.length + breakdown.length + drop.length);
    all.set(groove, 0);
    all.set(breakdown, groove.length);
    all.set(drop, groove.length + breakdown.length);
    const { feats } = analyse(all);
    const drops = feats.filter((f) => f.drop).map((f) => f.t);
    expect(drops.length).toBe(1);
    const dropAt = (groove.length + breakdown.length) / SR;
    expect(drops[0]).toBeGreaterThan(dropAt - 0.05);
    expect(drops[0]).toBeLessThan(dropAt + 0.5);
  });
});
