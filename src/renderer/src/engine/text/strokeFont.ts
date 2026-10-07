/**
 * A single-stroke font for a drawing toy whose pen never lifts: each glyph is
 * one polyline (retracing where needed) in a cell 4 wide and 6 tall, y up from
 * the baseline. Letters are joined by straight runs from one glyph's end to
 * the next one's start, so a whole line is a single continuous path.
 */
const G: Record<string, number[]> = {
  A: [0, 0, 1, 3, 3, 3, 1, 3, 2, 6, 4, 0],
  B: [0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3, 3, 3, 4, 2, 4, 1, 3, 0, 0, 0],
  C: [4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1],
  D: [0, 0, 0, 6, 2, 6, 4, 4, 4, 2, 2, 0, 0, 0],
  E: [0, 0, 0, 6, 4, 6, 0, 6, 0, 3, 3, 3, 0, 3, 0, 0, 4, 0],
  F: [0, 0, 0, 6, 4, 6, 0, 6, 0, 3, 3, 3],
  G: [4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 3, 2, 3, 4, 3, 4, 0],
  H: [0, 0, 0, 6, 0, 3, 4, 3, 4, 6, 4, 0],
  I: [0, 0, 2, 0, 2, 6, 0, 6, 4, 6, 2, 6, 2, 0, 4, 0],
  J: [0, 1, 1, 0, 3, 0, 4, 1, 4, 6, 4, 0],
  K: [0, 0, 0, 6, 0, 2, 4, 6, 1, 3, 4, 0],
  L: [0, 6, 0, 0, 4, 0],
  M: [0, 0, 0, 6, 2, 3, 4, 6, 4, 0],
  N: [0, 0, 0, 6, 4, 0, 4, 6, 4, 0],
  O: [1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0, 3, 0],
  P: [0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3, 0, 0],
  Q: [1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0, 3, 0, 2, 2, 4, 0],
  R: [0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3, 2, 3, 4, 0],
  S: [0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5],
  T: [2, 0, 2, 6, 0, 6, 4, 6, 2, 6, 2, 0],
  U: [0, 6, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6, 4, 0],
  V: [0, 6, 2, 0, 4, 6],
  W: [0, 6, 1, 0, 2, 4, 3, 0, 4, 6],
  X: [0, 0, 4, 6, 2, 3, 0, 6, 4, 0],
  Y: [0, 6, 2, 3, 4, 6, 2, 3, 2, 0],
  Z: [0, 6, 4, 6, 0, 0, 4, 0],
  '0': [1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0, 0, 1, 4, 5, 4, 1, 3, 0],
  '1': [1, 5, 2, 6, 2, 0, 0, 0, 4, 0],
  '2': [0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 0, 0, 4, 0],
  '3': [0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1, 3, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1],
  '4': [3, 0, 3, 6, 0, 2, 4, 2],
  '5': [4, 6, 0, 6, 0, 3, 3, 3, 4, 2, 4, 1, 3, 0, 0, 0],
  '6': [4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3],
  '7': [0, 6, 4, 6, 1, 0],
  '8': [1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3],
  '9': [4, 3, 1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 0, 0],
  '!': [2, 0, 2, 6],
  '?': [0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 2, 3, 2, 0],
  '.': [1, 0, 1, 0.6, 2, 0.6, 2, 0],
  ',': [1, 0, 2, 0.5, 1, -1],
  '-': [0, 3, 3, 3],
  '&': [4, 0, 1, 4, 1, 5, 2, 6, 3, 5, 0, 2, 0, 1, 1, 0, 2, 0, 4, 2],
  '♪': [0, 0, 1, 1, 2, 0, 2, 6, 4, 5],
  // Cyrillic letters with no Latin twin.
  Б: [4, 6, 0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3],
  Г: [0, 0, 0, 6, 4, 6],
  Д: [0, -1, 0, 0, 4, 0, 4, -1, 4, 0, 3, 0, 3, 6, 2, 6, 1, 0],
  Ж: [0, 0, 2, 3, 0, 6, 2, 3, 2, 6, 2, 0, 2, 3, 4, 6, 2, 3, 4, 0],
  И: [0, 6, 0, 0, 4, 6, 4, 0],
  Л: [0, 0, 1, 1, 1, 6, 4, 6, 4, 0],
  П: [0, 0, 0, 6, 4, 6, 4, 0],
  Ф: [2, 0, 2, 6, 2, 5, 0, 4, 0, 2, 2, 1, 4, 2, 4, 4, 2, 5, 2, 0],
  Ц: [0, 6, 0, 0, 3, 0, 3, 6, 3, 0, 4, 0, 4, -1],
  Ч: [0, 6, 0, 3, 1, 2, 4, 2, 4, 6, 4, 0],
  Ш: [0, 6, 0, 0, 2, 0, 2, 6, 2, 0, 4, 0, 4, 6, 4, 0],
  Щ: [0, 6, 0, 0, 2, 0, 2, 6, 2, 0, 4, 0, 4, 6, 4, 0, 4.6, 0, 4.6, -1],
  Ъ: [0, 6, 1, 6, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3],
  Ы: [0, 6, 0, 0, 2, 0, 3, 1, 3, 2, 2, 3, 0, 3, 0, 0, 4, 0, 4, 6, 4, 0],
  Ь: [0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3],
  Э: [0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0, 0, 1, 1, 0, 3, 0, 4, 1, 4, 3, 1, 3],
  Ю: [0, 0, 0, 6, 0, 3, 1, 3, 1, 5, 2, 6, 3, 6, 4, 5, 4, 1, 3, 0, 2, 0, 1, 1, 1, 3],
  Я: [4, 0, 4, 6, 1, 6, 0, 5, 0, 4, 1, 3, 4, 3, 2, 3, 0, 0],
};

/** Cyrillic letters drawn like their Latin look-alikes. */
const ALIAS: Record<string, string> = { А: 'A', В: 'B', Е: 'E', Ё: 'E', З: '3', Й: 'И', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', Є: 'E', І: 'I', Ї: 'I' };

/** The glyph polyline for a character (flat x,y pairs), or null for a gap. */
export function strokeGlyph(ch: string): number[] | null {
  const up = ch.toUpperCase();
  return G[up] ?? G[ALIAS[up] ?? ''] ?? null;
}

export const STROKE_ADVANCE = 5.4;

export interface StrokePath {
  /** Flat x,y points in cell units (y up), one continuous line. */
  pts: number[];
  /** Arc length at each point. */
  len: number[];
  /** Arc length where each word's drawing ends (connectors belong to the following word). */
  wordEnd: number[];
  width: number;
  rows: number;
}

/**
 * Lay a line out as one continuous stroke, wrapping into rows `maxCols` cells
 * wide. Row r sits at y = −r × 9 (rows go down).
 */
export function strokeLine(text: string, maxCols = 18): StrokePath {
  const words = text.split(/\s+/).filter(Boolean);
  const pts: number[] = [];
  const wordEnd: number[] = [];
  let col = 0;
  let row = 0;
  let width = 0;
  for (const word of words) {
    const n = [...word].length;
    if (col > 0 && col + n > maxCols) {
      col = 0;
      row++;
    }
    for (const ch of word) {
      const gl = strokeGlyph(ch);
      const ox = col * STROKE_ADVANCE;
      const oy = -row * 9;
      if (gl) for (let k = 0; k < gl.length; k += 2) pts.push(ox + gl[k], oy + gl[k + 1]);
      col++;
      width = Math.max(width, col * STROKE_ADVANCE);
    }
    col++;
    wordEnd.push(pts.length / 2 - 1);
  }
  if (!pts.length) pts.push(0, 0);
  const len: number[] = [0];
  for (let k = 2; k < pts.length; k += 2) len.push(len[len.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
  return { pts, len, wordEnd: wordEnd.map((i) => len[Math.max(0, i)] ?? 0), width: Math.max(width - 1.4, 4), rows: row + 1 };
}
