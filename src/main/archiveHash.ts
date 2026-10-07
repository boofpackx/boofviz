/** Deterministic 0..1 hash of a slot number (stable across runs). */
export function hashSlot(n: number): number {
  let h = Math.imul(Math.round(n) | 0, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
