import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform float uCols, uRows, uMargin, uGutter, uAccent, uLines, uShift, uPaper, uBar;
uniform int uMode;
uniform float uBands[32];

float rowOffset(float row, float bar) {
  return floor((hash11(row * 7.13 + bar * 3.71) - 0.5) * 2.0 * uShift * 3.0 + 0.5);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 paper = uPaper > 0.5 ? uPal[4] : uPal[0] * 0.5;
  vec3 ink = uPaper > 0.5 ? uPal[0] : uPal[4];
  vec3 accent = uPal[2] * (uPaper > 0.5 ? 1.0 : 1.4);
  vec3 col = paper;
  float m = uMargin * uRes.y;
  vec2 a0 = vec2(m, m);
  vec2 size = uRes - 2.0 * a0;
  vec2 cellPx = size / vec2(uCols, uRows);
  vec2 g = (px - a0) / cellPx;
  float gut = uGutter * uRes.y;
  if (g.x >= 0.0 && g.y >= 0.0 && g.x < uCols && g.y < uRows) {
    float row = floor(g.y);
    // Rows slide by whole cells at each bar change (eased over half a beat).
    float t = easeInOut(clamp(uBarPhase * uBeatsPerBar / 0.5, 0.0, 1.0));
    float off = mix(rowOffset(row, uBar - 1.0), rowOffset(row, uBar), t);
    float gx = mod(g.x + off, uCols);
    vec2 cell = vec2(floor(gx), row);
    vec2 f = vec2(fract(gx), fract(g.y));
    float level = uBands[int(clamp(floor(cell.x / uCols * 32.0), 0.0, 31.0))];
    // Inner box (cell minus gutter), in px from the cell centre.
    vec2 q = (f - 0.5) * cellPx;
    float box = sdBox(q, cellPx * 0.5 - gut);
    bool isAccent = hash21(cell + vec2(uBar * 1.7, 3.1)) < uAccent * 0.22 + uKick * 0.08;
    vec3 fill = isAccent ? accent : ink;
    float on = 0.0;
    if (uMode == 0) {
      // Bars: the column fills upward to its level, cut at the gutter.
      float top = level * uRows;
      float yIn = cell.y + f.y;
      on = step(yIn, top) * (1.0 - smoothstep(-0.75, 0.75, box));
    } else if (uMode == 1) {
      float h = hash21(cell * 1.31 + floor(uBeat * 0.5) * vec2(7.7, 1.3));
      on = step(h, 0.18 + 0.55 * level) * (1.0 - smoothstep(-0.75, 0.75, box));
    } else {
      float r = min(cellPx.x, cellPx.y) * (0.08 + 0.42 * level * (0.6 + 0.4 * (1.0 - cell.y / uRows)));
      on = 1.0 - smoothstep(-0.75, 0.75, length(q) - r);
    }
    col = mix(col, fill, on);
  }
  // Hairline grid + a heavy top rule, Swiss-poster style.
  vec2 gl = abs(fract(g + 0.5) - 0.5) * cellPx;
  float inside = step(-0.01, g.x) * step(g.x, uCols + 0.01) * step(-0.01, g.y) * step(g.y, uRows + 0.01);
  float hair = (1.0 - smoothstep(0.0, 1.0, min(gl.x, gl.y))) * inside;
  col = mix(col, ink, hair * uLines * 0.35);
  float rule = step(abs(px.y - (uRes.y - m * 0.5)), max(2.0, uRes.y * 0.006)) * step(m, px.x) * step(px.x, uRes.x - m);
  col = mix(col, ink, rule * step(0.001, uMargin));
  fragColor = vec4(col, 1.0);
}
`;

/** International-typographic-style modular grid driven by the 32-band EQ. */
export class SwissGrid extends ShaderGenerator {
  readonly kind = 'swissGrid';

  constructor() {
    super(FRAG, {
      uCols: { value: 8 },
      uRows: { value: 5 },
      uMargin: { value: 0.06 },
      uGutter: { value: 0.01 },
      uAccent: { value: 0.5 },
      uLines: { value: 0.6 },
      uShift: { value: 0.5 },
      uPaper: { value: 1 },
      uBar: { value: 0 },
      uMode: { value: 0 },
      uBands: { value: new Array<number>(32).fill(0) },
    });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    // Smooth the EQ a touch more than raw so the blocks read as design, not noise.
    const k = 1 - Math.exp(-ctx.dt / 0.08);
    const bands = u.uBands.value as number[];
    for (let i = 0; i < 32; i++) bands[i] += (Math.min(1, ctx.frame.bands32[i] * ctx.globals.reactivity) - bands[i]) * k;
    u.uCols.value = Math.round(num(p.cols, 8));
    u.uRows.value = Math.round(num(p.rows, 5));
    u.uMargin.value = num(p.margin, 0.06);
    u.uGutter.value = num(p.gutter, 0.01);
    u.uAccent.value = num(p.accent, 0.5);
    u.uLines.value = num(p.lines, 0.6);
    u.uShift.value = num(p.shift, 0.5);
    u.uPaper.value = p.paper === false ? 0 : 1;
    u.uBar.value = Math.floor(ctx.beat / Math.max(1, ctx.frame.beatsPerBar));
    u.uMode.value = p.mode === 'blocks' ? 1 : p.mode === 'dots' ? 2 : 0;
  }
}
