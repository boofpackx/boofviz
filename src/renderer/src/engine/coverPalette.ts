import { hexToLinear } from './palettes';

/**
 * Five colours from an album cover, as a look palette (dark → light): the
 * cover's main colours by how much of it they cover and how vivid they are,
 * with a dark base and a light top so every look keeps its contrast. Pure and
 * deterministic, so the preview and the output pick the same colours.
 */
export function coverColours(rgba: ArrayLike<number>, w: number, h: number): string[] {
  type Px = [number, number, number];
  const px: Px[] = [];
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    px.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  }
  if (!px.length) return ['#000000', '#333333', '#777777', '#bbbbbb', '#ffffff'];
  // Median cut into up to 12 boxes.
  let boxes: Px[][] = [px];
  while (boxes.length < 12) {
    let bi = -1;
    let best = 0;
    let axis = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255;
        let hi = 0;
        for (const p of b) {
          lo = Math.min(lo, p[a]);
          hi = Math.max(hi, p[a]);
        }
        const score = (hi - lo) * Math.sqrt(b.length);
        if (score > best) {
          best = score;
          bi = i;
          axis = a;
        }
      }
    });
    if (bi < 0 || best < 1) break;
    const b = boxes[bi].slice().sort((p, q) => p[axis] - q[axis] || p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const mid = b.length >> 1;
    boxes = [...boxes.slice(0, bi), b.slice(0, mid), b.slice(mid), ...boxes.slice(bi + 1)];
  }
  const sat = (c: Px): number => {
    const mx = Math.max(...c);
    const mn = Math.min(...c);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  const lum = (c: Px): number => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const cands = boxes
    .map((b) => {
      const avg: Px = [0, 0, 0];
      for (const p of b) for (let a = 0; a < 3; a++) avg[a] += p[a] / b.length;
      return { c: avg, n: b.length / px.length };
    })
    .map((x) => ({ ...x, score: x.n * (0.35 + sat(x.c)) }))
    .sort((a, b) => b.score - a.score);
  // Up to five distinct colours.
  const pick: Px[] = [];
  for (const x of cands) {
    if (pick.length >= 5) break;
    if (pick.every((p) => Math.hypot(p[0] - x.c[0], p[1] - x.c[1], p[2] - x.c[2]) > 40)) pick.push(x.c);
  }
  for (const x of cands) {
    if (pick.length >= 5) break;
    if (!pick.includes(x.c)) pick.push(x.c);
  }
  while (pick.length < 5) pick.push(pick[pick.length - 1].map((v) => Math.min(255, v * 1.4 + 20)) as Px);
  pick.sort((a, b) => lum(a) - lum(b));
  // A dark base and a light top; the middle a little more vivid.
  const mixTo = (c: Px, t: Px, k: number): Px => [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k];
  if (lum(pick[0]) > 0.12) pick[0] = mixTo(pick[0], [0, 0, 0], 1 - 0.12 / lum(pick[0]));
  if (lum(pick[4]) < 0.75) pick[4] = mixTo(pick[4], [255, 255, 255], (0.75 - lum(pick[4])) / Math.max(0.01, 1 - lum(pick[4])));
  for (let i = 1; i < 4; i++) {
    const c = pick[i];
    const m = (c[0] + c[1] + c[2]) / 3;
    pick[i] = c.map((v) => Math.min(255, Math.max(0, m + (v - m) * 1.2))) as Px;
  }
  return pick.map((c) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`);
}

const cache = new Map<string, Float32Array | null>();

/** The cover's palette in linear colour, or null while it is still being read (or there is none). */
export function coverPaletteFor(url: string | undefined): Float32Array | null {
  if (!url || typeof document === 'undefined') return null;
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  cache.set(url, null);
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.drawImage(img, 0, 0, 48, 48);
    const hexes = coverColours(g.getImageData(0, 0, 48, 48).data, 48, 48);
    const out = new Float32Array(15);
    hexes.forEach((h, i) => hexToLinear(h, out, i * 3));
    cache.set(url, out);
  };
  img.src = url;
  return null;
}
