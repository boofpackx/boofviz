import { describe, expect, it } from 'vitest';
import { addMeasurement, measureStartDelay, type LevelSample } from '@/control/autoTiming';
import { lyricsOffsetMs, measuredDelayMs } from '@shared/settings';

/** 20 ms samples from `from` to `to`, silent outside [soundFrom, soundTo). */
function levels(from: number, to: number, sound: Array<[number, number]>): LevelSample[] {
  const out: LevelSample[] = [];
  for (let t = from; t < to; t += 20) out.push({ t, silent: !sound.some(([a, b]) => t >= a && t < b) });
  return out;
}

describe('automatic lyric timing', () => {
  it('measures when a song is heard after the gap, against when the player said it started', () => {
    // Previous song until 9.6 s, a gap, the new song heard from 10.24 s; the player said 10.0 s.
    const s = levels(5000, 14000, [[5000, 9600], [10240, 14000]]);
    expect(measureStartDelay(s, 10000)).toBe(240);
    // Heard a little before the player's report (it reports late).
    expect(measureStartDelay(levels(5000, 14000, [[5000, 9000], [9800, 14000]]), 10000)).toBe(-200);
  });

  it('measures nothing for a crossfade (no gap), a blip, or a start far from the report', () => {
    expect(measureStartDelay(levels(5000, 14000, [[5000, 14000]]), 10000)).toBeNull();
    expect(measureStartDelay(levels(5000, 14000, [[5000, 9000], [10100, 10160]]), 10000)).toBeNull();
    expect(measureStartDelay(levels(5000, 16000, [[5000, 9000], [13500, 16000]]), 10000)).toBeNull();
  });

  it('times the lyrics by the median of three or more songs, the slider on top', () => {
    expect(measuredDelayMs([200])).toBe(0);
    expect(measuredDelayMs([200, 1900, 240])).toBe(240);
    expect(measuredDelayMs([200, 260, 240, 220])).toBe(230);
    expect(lyricsOffsetMs({ offsetMs: 100, autoTiming: true, timing: [200, 260, 240] })).toBe(100 - 240);
    expect(lyricsOffsetMs({ offsetMs: 100, autoTiming: false, timing: [200, 260, 240] })).toBe(100);
    expect(addMeasurement([1, 2, 3, 4, 5, 6, 7], 8.4)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
});
