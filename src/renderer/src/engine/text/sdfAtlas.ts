import * as THREE from 'three';
import { fontCss } from '../generators/KineticType';

/** One glyph in a signed-distance-field atlas (all sizes in em, uv in 0..1). */
export interface Glyph {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Quad size and offset from the pen position (baseline origin), in em. */
  w: number;
  h: number;
  x: number;
  y: number;
  advance: number;
}

export interface SdfAtlas {
  texture: THREE.DataTexture;
  glyphs: Map<string, Glyph>;
  /** Cap height in em, for vertical centring. */
  cap: number;
  /** Distance-field spread in em (shaders use it for outlines and glow). */
  spread: number;
}

const SIZE = 1024;
const CELL = 64;
const FONT_PX = 44;
const PAD = 10;
const CHARS = (() => {
  let s = '';
  for (let c = 32; c < 127; c++) s += String.fromCharCode(c);
  return s + 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ¿¡’‘“”–—…♪·';
})();

const cache = new Map<string, SdfAtlas>();

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** 2D squared distance to the nearest "on" pixel, in place over `grid` (0 = on, 1e20 = off). */
function edt2d(grid: Float32Array, w: number, h: number): void {
  const n = Math.max(w, h);
  const f = new Float32Array(n);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
}

/**
 * Glyph atlas with a signed distance field, built once per font and shared:
 * letters stay crisp at any size (a word can fill the screen), and outlines,
 * glow and soft shadows come straight from the distance.
 */
export function sdfAtlas(font: string): SdfAtlas {
  const hit = cache.get(font);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#fff';
  ctx.font = fontCss(font, FONT_PX);
  ctx.textBaseline = 'alphabetic';
  const cols = SIZE / CELL;
  const baseline = CELL - PAD - 8;
  const cap = (ctx.measureText('H').actualBoundingBoxAscent || FONT_PX * 0.72) / FONT_PX;
  const glyphs = new Map<string, Glyph>();
  [...CHARS].forEach((ch, i) => {
    const cx = (i % cols) * CELL;
    const cy = Math.floor(i / cols) * CELL;
    const m = ctx.measureText(ch);
    // Squeeze glyphs wider than the cell rather than clip them.
    const scale = Math.min(1, (CELL - PAD * 2) / Math.max(1, m.width));
    ctx.save();
    ctx.translate(cx + PAD, cy + baseline);
    ctx.scale(scale, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    glyphs.set(ch, {
      u0: cx / SIZE,
      v0: cy / SIZE,
      u1: (cx + CELL) / SIZE,
      v1: (cy + CELL) / SIZE,
      w: CELL / FONT_PX,
      h: CELL / FONT_PX,
      x: -PAD / FONT_PX,
      y: -(CELL - baseline) / FONT_PX,
      advance: (m.width * scale) / FONT_PX,
    });
  });
  const img = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const inside = new Float32Array(SIZE * SIZE);
  const outside = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const on = img[i * 4] > 127;
    inside[i] = on ? 1e20 : 0;
    outside[i] = on ? 0 : 1e20;
  }
  edt2d(inside, SIZE, SIZE);
  edt2d(outside, SIZE, SIZE);
  // Encode signed distance (+inside) into 0..255 around 0.5, ±PAD pixels of range.
  const data = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const sd = Math.sqrt(inside[i]) - Math.sqrt(outside[i]);
    data[i] = Math.max(0, Math.min(255, Math.round(127.5 + (sd / PAD) * 127.5)));
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const atlas: SdfAtlas = { texture, glyphs, cap, spread: PAD / FONT_PX };
  cache.set(font, atlas);
  return atlas;
}
