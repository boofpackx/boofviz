import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { camClock, lostMediaPost, tapeEventAt, timecode, TAPE_EVENTS } from '@/engine/lostMedia';

describe('tape events', () => {
  it('are a pure function of the beat (preview and output agree)', () => {
    for (let b = 0; b < 400; b += 0.37) expect(tapeEventAt(b, 4, 0.5, 3)).toEqual(tapeEventAt(b, 4, 0.5, 3));
  });

  it('start on a bar line, last at most a bar, and ease in and out', () => {
    let seen = 0;
    for (let b = 0; b < 2000; b += 0.25) {
      const ev = tapeEventAt(b, 4, 0.8, 1);
      if (ev.kind === 'none') continue;
      seen++;
      expect(ev.start % 4).toBe(0);
      expect(ev.beats).toBeLessThanOrEqual(4);
      expect(ev.t).toBeGreaterThanOrEqual(0);
      expect(ev.t).toBeLessThan(1);
      expect(ev.amount).toBeGreaterThanOrEqual(0);
      expect(ev.amount).toBeLessThanOrEqual(1);
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('respect the frequency and the allowed kinds', () => {
    const count = (freq: number): number => {
      let n = 0;
      for (let bar = 0; bar < 1000; bar++) if (tapeEventAt(bar * 4 + 0.01, 4, freq, 5).kind !== 'none') n++;
      return n;
    };
    expect(count(0)).toBe(0);
    expect(count(0.2)).toBeLessThan(count(0.8));
    const kinds = new Set<string>();
    for (let b = 0; b < 4000; b += 1) kinds.add(tapeEventAt(b, 4, 1, 2, ['pause', 'signal']).kind);
    expect([...kinds].sort()).toEqual(['none', 'pause', 'signal']);
    const all = new Set<string>();
    for (let b = 0; b < 8000; b += 1) all.add(tapeEventAt(b, 4, 1, 2).kind);
    for (const k of TAPE_EVENTS) expect(all.has(k)).toBe(true);
  });

  it('formats timecode and the camcorder clock', () => {
    expect(timecode(3725.5)).toBe('01:02:05:15');
    expect(camClock(0, 19.5)).toBe('PM 7:30:00');
    expect(camClock(3600 * 5, 19.5)).toBe('AM 12:30:00');
  });
});

describe('make it lost media', () => {
  it('is off by default and builds a chain per style', () => {
    expect(lostMediaPost(DEFAULT_SETTINGS.lostMedia)).toBeNull();
    const on = { ...DEFAULT_SETTINGS.lostMedia, enabled: true };
    expect(lostMediaPost({ ...on, style: 'vhs' })?.fx[0].type).toBe('tapeStack');
    expect(lostMediaPost({ ...on, style: 'vhs' })?.over?.kit).toBe('vcr');
    expect(lostMediaPost({ ...on, style: 'camcorder' })?.under?.kit).toBe('camcorder');
    expect(lostMediaPost({ ...on, style: 'super8' })?.fx[0].type).toBe('filmStock');
    expect(lostMediaPost({ ...on, style: 'web' })?.fx[0].type).toBe('digitalRot');
    expect(lostMediaPost({ ...on, style: 'camcorder', station: 'MY BRAND' })?.under?.station).toBe('MY BRAND');
  });
});
