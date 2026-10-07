/**
 * Music-video lyric motion: lays a sung line out as letters and words, times
 * each word to the singing, and poses every letter for a style. Everything is
 * a pure function of the song time, beat and indices, so the preview and the
 * output draw the same frame (no state carried between frames).
 */

export const LYRIC_STYLES = [
  'drop', 'slam', 'pop', 'shuffle', 'flip', 'spin3d', 'zoomthrough', 'stack', 'wave', 'glitch', 'scatter', 'orbit3d',
  // Lyric Cinema
  'highway', 'credits', 'infomercial', 'ransom', 'teletext', 'screensaver',
] as const;
export type LyricStyle = (typeof LYRIC_STYLES)[number];

export const LETTER_MATERIALS = ['plain', 'chrome', 'neon', 'paper', 'led', 'phosphor', 'stencil', 'mimeo', 'rubdown'] as const;
export type LetterMaterial = (typeof LETTER_MATERIALS)[number];

/** Material each style uses when the look leaves it on 'auto'. */
export const STYLE_MATERIAL: Partial<Record<LyricStyle, LetterMaterial>> = { infomercial: 'chrome', screensaver: 'chrome', ransom: 'paper' };

/** Styles that show several lines at once (a scrolling roll, a teletext page). */
export const MULTI_LINE: ReadonlySet<LyricStyle> = new Set<LyricStyle>(['credits', 'teletext']);
/** Styles that show words before they are sung (coming down the road, the whole line tumbling). */
const PRESHOW: ReadonlySet<LyricStyle> = new Set<LyricStyle>(['highway', 'credits', 'teletext', 'screensaver']);
/** Styles drawn front-on with no camera moves. */
export const FLAT: ReadonlySet<LyricStyle> = new Set<LyricStyle>(['credits', 'teletext']);

/** A line to show: its words and when each one is sung (seconds). */
export interface TimedLine {
  text: string;
  start: number;
  end: number;
  words: Array<{ text: string; start: number }>;
}

export interface LetterLayout {
  ch: string;
  /** Letter centre in em, relative to the line block centre. */
  x: number;
  y: number;
  word: number;
  /** Index of the letter within its word, and the word's letter count. */
  li: number;
  wl: number;
  /** Index of the letter within the whole line. */
  index: number;
}

export interface WordLayout {
  /** Word centre in em. */
  x: number;
  y: number;
  scale: number;
  rz: number;
  width: number;
}

export interface LineLayout {
  letters: LetterLayout[];
  words: WordLayout[];
  width: number;
  height: number;
}

export interface Pose {
  /** Pivot position (em, block space; +z toward the camera). */
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
  /** Letter centre relative to the pivot, before rotation (em). */
  ox: number;
  oy: number;
  a: number;
  /** Extra brightness: the word being sung, landings, glitches. */
  glow: number;
}

/** Deterministic 0..1 hash of two integers. */
export function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
const inCubic = (x: number): number => Math.pow(clamp01(x), 3);
function outBack(x: number, k = 1.70158): number {
  const t = clamp01(x) - 1;
  return 1 + (k + 1) * t * t * t + k * t * t;
}
function outBounce(x: number): number {
  let t = clamp01(x);
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
function outElastic(x: number): number {
  const t = clamp01(x);
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

/**
 * When each word is sung: the file's word stamps if it has them, otherwise
 * spread over the first 70% of the line in proportion to word length.
 */
export function timeWords(text: string, start: number, end: number, stamps?: Array<{ t: number; text: string }>): TimedLine {
  const parts = text.split(/\s+/).filter(Boolean);
  if (stamps && stamps.length >= parts.length && parts.length) {
    return { text, start, end, words: parts.map((w, i) => ({ text: w, start: stamps[i].t / 1000 })) };
  }
  const span = Math.max(0.2, (end - start) * 0.7);
  const total = parts.reduce((n, w) => n + w.length + 1, 0) || 1;
  let acc = 0;
  const words = parts.map((w) => {
    const s = start + (acc / total) * span;
    acc += w.length + 1;
    return { text: w, start: s };
  });
  return { text, start, end, words };
}

export type LayoutMode = 'flow' | 'stack' | 'scatter' | 'orbit';

export function layoutFor(style: LyricStyle): LayoutMode {
  return style === 'stack' ? 'stack' : style === 'scatter' ? 'scatter' : style === 'orbit3d' || style === 'highway' ? 'orbit' : 'flow';
}

/**
 * Lay a line out in em: `advance(ch)` gives glyph widths. Flow wraps words into
 * centred rows no wider than `maxWidth`; stack puts each word on its own row
 * at a varied size; scatter throws words around the frame; orbit spaces them
 * round a ring (the style turns the ring).
 */
export function layoutLine(words: string[], advance: (ch: string) => number, mode: LayoutMode, maxWidth: number, seed: number, hero?: { index: number; scale: number }): LineLayout {
  const space = advance(' ') || 0.28;
  const widthOf = (w: string): number => [...w].reduce((n, ch) => n + advance(ch), 0);
  const letters: LetterLayout[] = [];
  const out: WordLayout[] = [];
  let index = 0;
  // Letter offsets are unscaled; a word's scale is applied by its pose.
  const place = (w: string, wi: number, cx: number, cy: number): void => {
    const width = widthOf(w);
    let pen = -width / 2;
    [...w].forEach((ch, li) => {
      const a = advance(ch);
      letters.push({ ch, x: cx + pen + a / 2, y: cy, word: wi, li, wl: w.length, index: index++ });
      pen += a;
    });
  };
  if (mode === 'stack') {
    const scales = words.map((_, i) => 0.65 + 0.95 * hash2(seed, i * 7 + 1));
    const rowH = scales.map((s) => s * 1.08);
    const total = rowH.reduce((a, b) => a + b, 0);
    let y = total / 2;
    words.forEach((w, i) => {
      const s = Math.min(scales[i], maxWidth / Math.max(0.1, widthOf(w)));
      y -= rowH[i] / 2;
      out.push({ x: 0, y, scale: s, rz: 0, width: widthOf(w) * s });
      place(w, i, 0, y);
      y -= rowH[i] / 2;
    });
    return { letters, words: out, width: Math.max(...out.map((o) => o.width), 0), height: total };
  }
  if (mode === 'scatter' || mode === 'orbit') {
    words.forEach((w, i) => {
      const s = mode === 'scatter' ? 0.75 + 0.6 * hash2(seed, i * 5 + 2) : 1;
      const x = mode === 'scatter' ? (hash2(seed, i * 5 + 3) - 0.5) * maxWidth * 0.8 : 0;
      const y = mode === 'scatter' ? (hash2(seed, i * 5 + 4) - 0.5) * 2.6 : 0;
      const rz = mode === 'scatter' ? (hash2(seed, i * 5 + 5) - 0.5) * 0.5 : 0;
      out.push({ x, y, scale: s, rz, width: widthOf(w) * s });
      place(w, i, 0, 0);
    });
    // Letters are laid out about their own word centre; the style moves words into place.
    return { letters, words: out, width: maxWidth, height: 3 };
  }
  // Flow: greedy wrap into rows. A hero word gets a row of its own at its own scale
  // (its letters keep unscaled offsets about the word centre; the renderer scales them).
  const hi = hero && hero.index >= 0 && hero.index < words.length && hero.scale > 1.01 ? hero.index : -1;
  const hs = hi >= 0 ? hero!.scale : 1;
  const rows: number[][] = [[]];
  let rowW = 0;
  words.forEach((w, i) => {
    const ww = widthOf(w);
    const cur = rows[rows.length - 1];
    if (i === hi || (hi >= 0 && i === hi + 1)) {
      if (cur.length) rows.push([]);
      rows[rows.length - 1].push(i);
      rowW = ww;
      if (i === hi) {
        rows.push([]);
        rowW = 0;
      }
      return;
    }
    const add = cur.length ? space + ww : ww;
    if (rowW + add > maxWidth && cur.length) {
      rows.push([i]);
      rowW = ww;
    } else {
      cur.push(i);
      rowW += add;
    }
  });
  const used = rows.filter((r) => r.length);
  const lineH = 1.18;
  const rowH = used.map((row) => (row.includes(hi) ? lineH * hs * 0.92 : lineH));
  const height = rowH.reduce((a, b) => a + b, 0);
  let width = 0;
  let top = height / 2;
  used.forEach((row, r) => {
    const big = row.includes(hi);
    const rw = row.reduce((n, i, k) => n + widthOf(words[i]) * (big ? hs : 1) + (k ? space : 0), 0);
    width = Math.max(width, rw);
    let pen = -rw / 2;
    const y = top - rowH[r] / 2;
    top -= rowH[r];
    row.forEach((i) => {
      const ww = widthOf(words[i]) * (i === hi ? hs : 1);
      out[i] = { x: pen + ww / 2, y, scale: i === hi ? hs : 1, rz: 0, width: ww };
      place(words[i], i, pen + ww / 2, y);
      pen += ww + space;
    });
  });
  return { letters, words: out, width, height };
}

export interface MotionInput {
  /** Song time now and the line's timing (seconds). */
  now: number;
  line: TimedLine;
  /** 0..1 kick envelope, the beat counter and seconds per beat. */
  kick: number;
  beat: number;
  spb: number;
  /** Animation speed multiplier. */
  speed: number;
  /** Seed for this line (hashes). */
  seed: number;
  /** Index of the word being sung now (−1 before the first). */
  current: number;
  /** Lyric Cinema: line offset from the sung line (0 = this line), progress through the sung line, how big the moment is, and the view in em. */
  rel?: number;
  frac?: number;
  intensity?: number;
  viewW?: number;
  viewH?: number;
  /** Multi-line styles: this line's vertical place in em (the renderer stacks lines by their real heights). */
  rowY?: number;
}

/** Pose one letter for a style; a = 0 means hidden. */
export function poseLetter(style: LyricStyle, L: LetterLayout, W: WordLayout, m: MotionInput): Pose {
  const sp = Math.max(0.2, m.speed);
  const wordStart = m.line.words[L.word]?.start ?? m.line.start;
  const tw = (m.now - wordStart) * sp;
  const tOut = (m.now - m.line.end) * sp;
  const outT = clamp01(tOut / 0.35);
  const h = (k: number): number => hash2(m.seed * 131 + L.index, k);
  const isCurrent = L.word === m.current;
  // Scatter and orbit lay each word out about 0,0 (the style places the word).
  const local = style === 'scatter' || style === 'orbit3d' || style === 'highway';
  const p: Pose = { x: L.x, y: L.y, z: 0, rx: 0, ry: 0, rz: 0, s: 1, ox: 0, oy: 0, a: 1, glow: isCurrent ? 0.35 : 0 };
  const wordPivot = (): void => {
    p.x = W.x;
    p.y = W.y;
    p.ox = local ? L.x : L.x - W.x;
    p.oy = local ? L.y : L.y - W.y;
  };
  if (tw < 0 && !PRESHOW.has(style)) return { ...p, a: 0 };
  const I = m.intensity ?? 1;
  switch (style) {
    case 'drop': {
      const a = tw / 0.55;
      p.y += (1 - outBounce(a)) * 3.2;
      // Squash on the first landing.
      const land = Math.max(0, 1 - Math.abs(a - 0.36) * 9);
      p.s = 1 + 0.12 * land;
      p.y -= inCubic(outT) * 4;
      p.rz += (h(1) - 0.5) * 0.6 * outT;
      p.a = 1 - outT;
      p.glow += land * 0.6;
      break;
    }
    case 'slam': {
      wordPivot();
      const a = outCubic(tw / 0.22);
      p.s = 3.4 - 2.4 * a;
      p.z = (1 - a) * 2.5;
      p.a = clamp01(tw / 0.08);
      const shake = Math.max(0, 1 - tw / 0.3);
      p.x += (h(2) - 0.5) * 0.18 * shake;
      p.y += (h(3) - 0.5) * 0.18 * shake;
      p.glow += shake * 0.8;
      p.s *= 1 + outT * 1.2;
      p.a *= 1 - outT;
      break;
    }
    case 'pop': {
      wordPivot();
      p.s = outElastic(tw / 0.6);
      // The word being sung swells, then settles: big, then small.
      if (isCurrent) p.s *= 1 + 0.35 * Math.max(0, 1 - tw / (m.spb * 1.2));
      p.s *= 1 - outT;
      p.a = 1 - outT;
      break;
    }
    case 'shuffle': {
      const a = outCubic((tw - L.li * 0.025) / 0.5);
      const fx = (h(4) - 0.5) * 9;
      const fy = (h(5) - 0.5) * 5;
      const fr = (h(6) - 0.5) * Math.PI * 2;
      p.x += fx * (1 - a);
      p.y += fy * (1 - a);
      p.rz = fr * (1 - a);
      p.z = (h(7) - 0.5) * 3 * (1 - a);
      p.a = clamp01(a * 3);
      const o = inCubic(outT);
      p.x += (h(8) - 0.5) * 9 * o;
      p.y += (h(9) - 0.5) * 5 * o;
      p.rz += (h(10) - 0.5) * 3 * o;
      p.a *= 1 - outT;
      break;
    }
    case 'flip': {
      const a = (tw - L.li * 0.045) / 0.4;
      if (a < 0) return { ...p, a: 0 };
      p.rx = (1 - outBack(a)) * (Math.PI / 2);
      p.rx -= outT * (Math.PI / 2);
      p.a = clamp01(a * 4) * (1 - outT);
      break;
    }
    case 'spin3d': {
      wordPivot();
      const a = outBack(tw / 0.55, 1.3);
      p.ry = (1 - a) * (Math.PI / 2) * (L.word % 2 ? -1 : 1);
      p.z = -(1 - outCubic(tw / 0.55)) * 3;
      p.ry -= outT * Math.PI * 0.6;
      p.a = clamp01(tw / 0.15) * (1 - outT);
      break;
    }
    case 'zoomthrough': {
      wordPivot();
      const a = outCubic(tw / 0.6);
      p.z = -14 * (1 - a) + 7 * inCubic(outT);
      p.rz = (h(11) - 0.5) * 0.4 * (1 - a);
      p.a = clamp01(a * 2) * (1 - outT);
      p.glow += (1 - a) * 0.5;
      break;
    }
    case 'stack': {
      wordPivot();
      const a = outCubic(tw / 0.35);
      p.x += (1 - a) * 6 * (L.word % 2 ? -1 : 1);
      p.s = W.scale * (isCurrent ? 1 + 0.08 * m.kick : 1);
      p.y += inCubic(outT) * 3;
      p.a = clamp01(a * 2) * (1 - outT);
      break;
    }
    case 'wave': {
      const a = outBack((tw - L.li * 0.03) / 0.4);
      p.y -= (1 - a) * 1.2;
      // Letters ride a wave that rolls with the beat, bouncing on the kick.
      p.y += Math.sin(m.beat * Math.PI - L.index * 0.55) * 0.16 + m.kick * 0.12 * (L.index % 2 ? 1 : -1);
      p.rz = Math.sin(m.beat * Math.PI * 0.5 - L.index * 0.4) * 0.08;
      p.y -= inCubic(outT) * 2.5;
      p.a = clamp01(a * 3) * (1 - outT);
      break;
    }
    case 'glitch': {
      const step = Math.floor(tw * 24);
      const settle = Math.max(0, 1 - tw / 0.45);
      p.x += (hash2(step, L.index + m.seed) - 0.5) * 0.9 * settle;
      p.y += (hash2(step + 7, L.word) - 0.5) * 0.25 * settle;
      p.a = settle > 0 && hash2(step, L.index * 3) < 0.25 * settle ? 0.15 : 1;
      p.glow += settle;
      p.x += (hash2(Math.floor(tOut * 30), L.index) - 0.5) * 1.5 * outT;
      p.a *= 1 - outT;
      break;
    }
    case 'scatter': {
      wordPivot();
      p.x = W.x;
      p.y = W.y;
      p.rz = W.rz;
      const a = outBack(tw / 0.4, 2.2);
      p.s = W.scale * a;
      p.a = (isCurrent || L.word > m.current ? 1 : 0.55) * (1 - outT);
      p.s *= 1 + outT * 0.4;
      break;
    }
    case 'orbit3d': {
      wordPivot();
      const n = Math.max(1, m.line.words.length);
      const step = (Math.PI * 2) / Math.max(n, 5);
      const r = Math.max(2.6, (n * 1.4) / (Math.PI * 2) + 1.6);
      // The ring turns so the word being sung faces front.
      const cur = Math.max(0, m.current);
      const curStart = m.line.words[cur]?.start ?? m.line.start;
      const turn = cur - 1 + outCubic((m.now - curStart) * sp / 0.45);
      const ang = (L.word - Math.min(turn, n - 1)) * step + outT * 1.5;
      p.x = Math.sin(ang) * r;
      p.z = Math.cos(ang) * r - r;
      p.y = 0;
      p.ry = ang;
      p.a = clamp01(tw / 0.2) * (0.35 + 0.65 * Math.max(0, Math.cos(ang))) * (1 - outT);
      break;
    }
    case 'highway': {
      // Words painted on the road come at you from the distance and pass under the camera.
      wordPivot();
      const z = tw * 6 * sp;
      p.x = 0;
      p.y = -0.9;
      p.z = z;
      p.rx = -Math.PI / 2 + 0.35;
      p.a = clamp01((z + 20) / 6) * clamp01((5 - z) / 2.5);
      p.glow += isCurrent ? 0.5 : 0;
      p.s = 2.2;
      break;
    }
    case 'credits': {
      // End credits: every line rolls up the screen at the song's pace.
      const rel = (m.rel ?? 0) - (m.frac ?? 0);
      p.y = L.y + (m.rowY ?? -rel * 1.55);
      const edge = Math.abs(p.y);
      const half = (m.viewH ?? 9) * 0.5;
      p.a = clamp01((half - 0.4 - edge) / 1.5);
      p.s = (m.rel ?? 0) === 0 ? 1.08 : 0.92;
      p.glow = (m.rel ?? 0) === 0 ? 0.25 : 0;
      break;
    }
    case 'infomercial': {
      // Chrome supers: each word swooshes in from the side, spinning, and overshoots into place.
      wordPivot();
      const a = outBack(tw / 0.45, 1.6);
      const dir = L.word % 2 ? -1 : 1;
      p.x += (1 - a) * 14 * dir;
      p.ry = (1 - a) * Math.PI * 1.5 * dir;
      p.a = clamp01(tw / 0.12);
      p.s = 1 + (isCurrent ? 0.08 * Math.sin(m.beat * Math.PI * 2) * I : 0);
      p.z = inCubic(outT) * 8;
      p.a *= 1 - outT;
      break;
    }
    case 'ransom': {
      // Letters cut from magazines, slapped down one by one and taped crooked.
      const a = outBack((tw - L.li * 0.05) / 0.28, 2.4);
      if (tw - L.li * 0.05 < 0) return { ...p, a: 0 };
      p.y += (1 - a) * 1.4;
      p.rz = (h(12) - 0.5) * 0.35 + (1 - a) * (h(13) - 0.5) * 1.5 + m.kick * 0.05 * (h(14) - 0.5);
      p.s = (0.85 + 0.4 * h(15)) * (1 + (1 - clamp01(a)) * 0.6);
      p.y += (h(16) - 0.5) * 0.18;
      p.x += inCubic(outT) * (h(17) - 0.5) * 6;
      p.y -= inCubic(outT) * 4;
      p.rz += outT * (h(18) - 0.5) * 4;
      p.a = 1 - outT;
      break;
    }
    case 'teletext': {
      // A teletext page: lines appear whole on their row; a new page every four lines.
      const rel = m.rel ?? 0;
      const tl = (m.now - m.line.start) * sp;
      if (rel > 0 || tl < 0) return { ...p, a: 0 };
      p.s = rel === 0 ? 1.12 : 1;
      p.a = 1;
      break;
    }
    case 'screensaver': {
      // The whole line as one chrome object, tumbling and bouncing round the screen.
      const vw = m.viewW ?? 14;
      const vh = m.viewH ?? 8;
      const b = bounceAt(m.now, Math.max(0, vw - 6), Math.max(0, vh - 2.5));
      p.x = b.x;
      p.y = b.y;
      p.ox = L.x;
      p.oy = L.y;
      p.ry = Math.sin(m.now * 0.9) * 0.9;
      p.rx = Math.sin(m.now * 0.63) * 0.35;
      const tl = (m.now - m.line.start) * sp;
      const grow = outBack(tl / 0.5);
      p.s = Math.max(0, grow) * (1 - outT);
      p.ry += (1 - clamp01(tl / 0.5)) * Math.PI + outT * Math.PI;
      p.a = clamp01(tl / 0.15) * (1 - outT);
      break;
    }
  }
  // Every style breathes with the kick (bigger in big moments).
  p.s *= 1 + 0.06 * m.kick * (0.6 + 0.6 * I);
  return p;
}

/** Same triangle-wave bounce as lyricCinema.bounce (kept local to avoid an import cycle). */
function bounceAt(now: number, rangeX: number, rangeY: number): { x: number; y: number } {
  const tri = (u: number): number => 1 - 4 * Math.abs(u - Math.floor(u + 0.5));
  return { x: tri(now * 0.13 + 0.25) * rangeX * 0.5, y: tri(now * 0.097 + 0.1) * rangeY * 0.5 };
}
