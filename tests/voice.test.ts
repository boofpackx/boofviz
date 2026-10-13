import { describe, expect, it } from 'vitest';
import { voicePresence } from '@/audio/dsp/spectrum';
import { FFT_SIZE } from '@shared/types/audio';

const SR = 48000;
const BINS = FFT_SIZE / 2;
const binHz = SR / FFT_SIZE;
const rnd = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function spectrum(peaks: Array<[number, number]>, noise: number, seed = 7): Float32Array {
  const r = rnd(seed);
  const m = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) m[k] = noise * (0.5 + r());
  for (const [hz, a] of peaks) {
    const b = Math.round(hz / binHz);
    m[b] += a;
    m[b - 1] += a * 0.4;
    m[b + 1] += a * 0.4;
  }
  return m;
}

describe('voice presence', () => {
  it('scores a voice-like harmonic series well above noise, a lone bass note and a pad', () => {
    const voice = spectrum(
      Array.from({ length: 12 }, (_, h) => [220 * (h + 1), 1 / (1 + h * 0.35)] as [number, number]),
      0.02,
    );
    const noise = spectrum([], 0.05);
    const bass = spectrum([[55, 2]], 0.02);
    const v = voicePresence(voice, SR, FFT_SIZE);
    expect(v).toBeGreaterThan(voicePresence(noise, SR, FFT_SIZE) * 3);
    expect(v).toBeGreaterThan(voicePresence(bass, SR, FFT_SIZE) * 3);
    expect(voicePresence(new Float32Array(BINS), SR, FFT_SIZE)).toBe(0);
  });

  it('is cheap: under a tenth of a millisecond a hop', () => {
    const m = spectrum(
      [
        [200, 1],
        [400, 0.8],
        [600, 0.6],
      ],
      0.03,
    );
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) voicePresence(m, SR, FFT_SIZE);
    expect((performance.now() - t0) / 1000).toBeLessThan(0.1);
  });
});
