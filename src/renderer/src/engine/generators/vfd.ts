/**
 * Vacuum-fluorescent display parts for the 80s gear looks: the 14-segment
 * alphanumerics of tape decks and car stereos, and the phosphor colours
 * behind their filters. Unlit segments are always drawn faintly, because on a
 * real VFD you can see them through the glass.
 */

export const PHOSPHORS: Record<string, { lit: string; glow: string; ghost: string }> = {
  cyan: { lit: '#7ffbe6', glow: '#2ee6c8', ghost: 'rgba(80,220,200,0.075)' },
  green: { lit: '#b6ff8a', glow: '#5fe83a', ghost: 'rgba(120,230,90,0.07)' },
  amber: { lit: '#ffc46b', glow: '#ff9a1f', ghost: 'rgba(255,160,60,0.07)' },
  blue: { lit: '#a9d8ff', glow: '#3f9dff', ghost: 'rgba(90,160,255,0.08)' },
  red: { lit: '#ff7a6a', glow: '#ff2a1a', ghost: 'rgba(255,60,40,0.07)' },
};

export function phosphor(name: unknown): { lit: string; glow: string; ghost: string } {
  return PHOSPHORS[String(name)] ?? PHOSPHORS.cyan;
}

/*
 * Segment names: a top, b upper right, c lower right, d bottom, e lower left,
 * f upper left, g middle left, h middle right, i diagonal to the top-left
 * corner, j upper centre, k diagonal to the top-right corner, l diagonal to
 * the bottom-left corner, m lower centre, n diagonal to the bottom-right corner.
 */
const GLYPHS: Record<string, string> = {
  '0': 'abcdefkl', '1': 'bc', '2': 'abghed', '3': 'abcdh', '4': 'fghbc', '5': 'afghcd', '6': 'afedcgh', '7': 'abc', '8': 'abcdefgh', '9': 'abcdfgh',
  A: 'abcefgh', B: 'abcdefh', C: 'adef', D: 'abcdjm', E: 'adefg', F: 'aefg', G: 'acdefh', H: 'bcefgh', I: 'adjm', J: 'bcde',
  K: 'efgkn', L: 'def', M: 'bcefik', N: 'bcefin', O: 'abcdef', P: 'abefgh', Q: 'abcdefn', R: 'abefghn', S: 'acdfgh', T: 'ajm',
  U: 'bcdef', V: 'efkl', W: 'bcefln', X: 'ikln', Y: 'ikm', Z: 'adkl',
  '-': 'gh', '+': 'ghjm', '/': 'kl', '\\': 'in', "'": 'j', '"': 'fj', '*': 'ghijklmn', '=': 'dgh', '_': 'd', '<': 'kn', '>': 'il',
  '?': 'abhm', '!': 'jm', '(': 'kn', ')': 'il', '$': 'acdfghjm', '%': 'cfghkl', '&': 'adeginj', '#': 'bcdghjm', '@': 'abdefhj',
};

/** Segment polygons in a 1 × 2 cell (x right, y down), before slant. */
const T = 0.12; // stroke half-width
const SEGS: Record<string, Array<[number, number]>> = (() => {
  const h = (x0: number, x1: number, y: number): Array<[number, number]> => [
    [x0, y], [x0 + T, y - T], [x1 - T, y - T], [x1, y], [x1 - T, y + T], [x0 + T, y + T],
  ];
  const v = (x: number, y0: number, y1: number): Array<[number, number]> => [
    [x, y0], [x + T, y0 + T], [x + T, y1 - T], [x, y1], [x - T, y1 - T], [x - T, y0 + T],
  ];
  const d = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const nx = (-dy / len) * T * 0.8, ny = (dx / len) * T * 0.8;
    const ux = (dx / len) * T * 1.4, uy = (dy / len) * T * 1.4;
    return [[x0 + ux + nx, y0 + uy + ny], [x1 - ux + nx, y1 - uy + ny], [x1 - ux - nx, y1 - uy - ny], [x0 + ux - nx, y0 + uy - ny]];
  };
  const g = 0.04;
  return {
    a: h(0 + g, 1 - g, 0), d: h(0 + g, 1 - g, 2), g: h(0 + g, 0.5 - g, 1), h: h(0.5 + g, 1 - g, 1),
    f: v(0, 0 + g, 1 - g), e: v(0, 1 + g, 2 - g), b: v(1, 0 + g, 1 - g), c: v(1, 1 + g, 2 - g),
    j: v(0.5, 0 + g, 1 - g), m: v(0.5, 1 + g, 2 - g),
    i: d(0.1, 0.12, 0.42, 0.88), k: d(0.9, 0.12, 0.58, 0.88), l: d(0.42, 1.12, 0.1, 1.88), n: d(0.58, 1.12, 0.9, 1.88),
  };
})();
const ALL = 'abcdefghijklmn';

export interface SegStyle {
  lit: string;
  ghost: string;
  /** Glow colour drawn under lit segments (skipped when empty). */
  glow?: string;
  /** Italic slant (x shift per unit of height). */
  slant?: number;
}

/**
 * Draw `text` in 14-segment characters, top-left at (x, y), each character
 * `h` tall. Returns the width drawn. Lowercase is shown as uppercase.
 */
export function drawSegText(g: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, st: SegStyle, cells = text.length): number {
  const s = h / 2;
  const pitch = s * 1.55;
  const slant = st.slant ?? 0.1;
  const up = text.toUpperCase();
  const path = (on: boolean): Path2D => {
    const p = new Path2D();
    for (let ci = 0; ci < cells; ci++) {
      const ch = up[ci] ?? ' ';
      const lit = GLYPHS[ch] ?? '';
      const ox = x + ci * pitch + s * 0.18;
      for (const seg of ALL) {
        if (lit.includes(seg) !== on) continue;
        const poly = SEGS[seg];
        poly.forEach(([px, py], k) => {
          const X = ox + px * s + (2 - py) * s * slant;
          const Y = y + py * s;
          if (k) p.lineTo(X, Y);
          else p.moveTo(X, Y);
        });
        p.closePath();
      }
      if (on && (ch === '.' || ch === ':' || ch === ',')) {
        const r = s * 0.13;
        p.moveTo(ox + s * 1.25 + r, y + 2 * s - r);
        p.arc(ox + s * 1.25, y + 2 * s - r, r, 0, Math.PI * 2);
        if (ch === ':') {
          p.moveTo(ox + s * 0.5 + s * slant + r, y + s * 0.6);
          p.arc(ox + s * 0.5 + s * slant * 1.4, y + s * 0.6, r, 0, Math.PI * 2);
          p.moveTo(ox + s * 0.5 + r, y + s * 1.4);
          p.arc(ox + s * 0.5 + s * slant * 0.6, y + s * 1.4, r, 0, Math.PI * 2);
        }
      }
    }
    return p;
  };
  g.fillStyle = st.ghost;
  g.fill(path(false));
  const lit = path(true);
  if (st.glow) {
    g.save();
    g.shadowColor = st.glow;
    g.shadowBlur = s * 0.9;
    g.fillStyle = st.glow;
    g.fill(lit);
    g.restore();
  }
  g.fillStyle = st.lit;
  g.fill(lit);
  return cells * pitch;
}

/** Width of `cells` characters at height `h`. */
export function segTextWidth(cells: number, h: number): number {
  return cells * (h / 2) * 1.55;
}

/**
 * A marquee window of `cells` characters over `text`, scrolled by `pos`
 * characters (VFD text moves a whole character at a time). Short text sits
 * still, centred.
 */
export function marquee(text: string, cells: number, pos: number): string {
  const t = text.toUpperCase().replace(/[^A-Z0-9 \-+/'"*=_<>?!().,:$%&#@]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length <= cells) {
    const pad = Math.floor((cells - t.length) / 2);
    return ' '.repeat(pad) + t + ' '.repeat(cells - t.length - pad);
  }
  const loop = t + '   ';
  const start = ((Math.floor(pos) % loop.length) + loop.length) % loop.length;
  return (loop + loop).slice(start, start + cells);
}

/** The fine wire mesh in front of a VFD (a tiled diagonal grid). */
export function meshPattern(g: CanvasRenderingContext2D, cell: number, alpha: number): CanvasPattern | null {
  const c = document.createElement('canvas');
  const n = Math.max(3, Math.round(cell));
  c.width = c.height = n;
  const m = c.getContext('2d')!;
  m.strokeStyle = `rgba(0,0,0,${alpha})`;
  m.lineWidth = Math.max(1, n * 0.18);
  m.beginPath();
  m.moveTo(0, 0);
  m.lineTo(n, n);
  m.moveTo(n, 0);
  m.lineTo(0, n);
  m.stroke();
  return g.createPattern(c, 'repeat');
}
