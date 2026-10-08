import { describe, expect, it } from 'vitest';
import { coverColours } from '@/engine/coverPalette';

const lum = (hex: string): number => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};

/** A 16×16 cover: blocks of given colours covering given shares. */
function cover(parts: Array<[[number, number, number], number]>): Uint8ClampedArray {
  const px = new Uint8ClampedArray(16 * 16 * 4);
  let i = 0;
  for (const [c, share] of parts) {
    const n = Math.round(share * 256);
    for (let k = 0; k < n && i < 256; k++, i++) px.set([...c, 255], i * 4);
  }
  for (; i < 256; i++) px.set([...parts[0][0], 255], i * 4);
  return px;
}

describe('album cover colours', () => {
  it('gives five colours, dark to light, with a dark base and a light top', () => {
    const pal = coverColours(cover([[[200, 30, 40], 0.5], [[20, 60, 200], 0.3], [[240, 220, 40], 0.2]]), 16, 16);
    expect(pal).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(lum(pal[i])).toBeGreaterThanOrEqual(lum(pal[i - 1]) - 1e-6);
    expect(lum(pal[0])).toBeLessThanOrEqual(0.121);
    expect(lum(pal[4])).toBeGreaterThanOrEqual(0.74);
  });

  it("keeps the cover's main colours", () => {
    const pal = coverColours(cover([[[200, 30, 40], 0.6], [[20, 60, 200], 0.4]]), 16, 16);
    const near = (hex: string, c: number[]): boolean => Math.hypot(...[1, 3, 5].map((i, k) => parseInt(hex.slice(i, i + 2), 16) - c[k])) < 70;
    expect(pal.some((h) => near(h, [200, 30, 40]))).toBe(true);
    expect(pal.some((h) => near(h, [20, 60, 200]))).toBe(true);
  });

  it('is the same every time for the same cover (both windows agree)', () => {
    const px = cover([[[90, 140, 60], 0.7], [[250, 250, 250], 0.3]]);
    expect(coverColours(px, 16, 16)).toEqual(coverColours(px, 16, 16));
    expect(coverColours(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toHaveLength(5);
  });
});
