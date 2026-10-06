import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const MAXC = 24;
const MAXR = 24;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uState;     // per cell: from quarter-turns, to quarter-turns, flip start time
uniform float uCells, uNow, uFlipDur, uStroke, uColors, uPulse;
uniform int uStyle;

vec3 pick(float h) { return uPal[1 + int(floor(h * min(uColors, 4.0))) % 4]; }

void main() {
  vec2 p = gl_FragCoord.xy / uRes.y;
  vec2 c = 0.5 * uRes / uRes.y;
  p = (p - c) * (1.0 - uPulse * uKick) + c;
  float cell = (uRes.x / uRes.y) / uCells;
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec4 st = texelFetch(uState, ivec2(mod(id, vec2(${MAXC}.0, ${MAXR}.0))), 0);
  float t = clamp((uNow - st.z) / uFlipDur, 0.0, 1.0);
  float ang = mix(st.x, st.y, easeOutBack(t)) * 1.5707963;
  vec2 q = rot2(ang) * f;
  float h = hash21(id * 1.31 + 4.7);
  vec3 bgc = pick(hash21(id + 9.1));
  vec3 fgc = pick(hash21(id + 2.3) + 0.37);
  if (length(bgc - fgc) < 0.05) fgc = uPal[4];
  float px = 1.5 / (cell * uRes.y);
  vec3 col;
  if (uStyle == 0) {
    float kind = floor(h * 6.0);
    float d;
    if (kind < 1.0) d = length(q + 0.5) - 1.0;                          // quarter disc
    else if (kind < 2.0) d = length(q + vec2(0.0, 0.5)) - 0.5;          // half disc
    else if (kind < 3.0) d = length(q) - 0.34;                          // circle
    else if (kind < 4.0) d = sdBox(q, vec2(0.28));                       // square
    else if (kind < 5.0) d = (q.x + q.y) * 0.7071;                       // diagonal half
    else d = abs(fract(q.x * 3.0 + 0.25) - 0.5) - 0.25;                  // stripes
    col = mix(bgc, fgc, 1.0 - smoothstep(-px, px, d));
  } else {
    float d1 = length(q + 0.5) - 0.5;
    float d2 = length(q - 0.5) - 0.5;
    if (uStyle == 1) {
      float d = min(abs(d1), abs(d2)) - uStroke * 0.5;
      col = mix(uPal[0] * 0.6, paletteWrap(0.2 + hash21(id) * 0.5), 1.0 - smoothstep(-px, px, d));
    } else {
      float inside = max(1.0 - smoothstep(-px, px, d1), 1.0 - smoothstep(-px, px, d2));
      col = mix(uPal[1], uPal[3], inside);
      float edge = min(abs(d1), abs(d2)) - uStroke * 0.25;
      col = mix(col, uPal[4], 1.0 - smoothstep(-px, px, edge));
    }
  }
  // Fresh flips glow briefly.
  col *= 1.0 + 0.6 * (1.0 - t) * step(0.001, st.z);
  fragColor = vec4(col, 1.0);
}
`;

const TRIGGERS = ['hat', 'snare', 'kick', 'beat', 'bar'] as const;

/** Bauhaus / Truchet tiles; a fraction of tiles turn 90° on each trigger. */
export class Tiles extends ShaderGenerator {
  readonly kind = 'tiles';
  private readonly state: Float32Array;
  private readonly tex: THREE.DataTexture;
  private triggers = 0;
  private lastBeat = Number.NaN;
  private base = Number.NaN;

  constructor() {
    const state = new Float32Array(MAXC * MAXR * 4);
    const tex = new THREE.DataTexture(state, MAXC, MAXR, THREE.RGBAFormat, THREE.FloatType);
    super(FRAG, { uState: { value: tex }, uCells: { value: 6 }, uNow: { value: 0 }, uFlipDur: { value: 0.3 }, uStroke: { value: 0.12 }, uColors: { value: 4 }, uPulse: { value: 0.05 }, uStyle: { value: 0 } });
    this.state = state;
    this.tex = tex;
    for (let i = 0; i < MAXC * MAXR; i++) {
      const r = Math.floor(hash01(i, 77) * 4);
      state[i * 4] = r;
      state[i * 4 + 1] = r;
      state[i * 4 + 2] = -1e4;
    }
    tex.needsUpdate = true;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const { frame } = ctx;
    if (Number.isNaN(this.base)) this.base = frame.time;
    const now = frame.time - this.base;
    const on = String(p.flipOn ?? 'hat') as (typeof TRIGGERS)[number];
    const beatInt = Math.floor(ctx.beat);
    let fire = false;
    if (on === 'hat' || on === 'snare' || on === 'kick') fire = frame.onsets[on];
    else if (beatInt !== this.lastBeat && !Number.isNaN(this.lastBeat)) fire = on === 'beat' || beatInt % Math.max(1, frame.beatsPerBar) === 0;
    this.lastBeat = beatInt;

    const cells = Math.round(num(p.cells, 6));
    const rows = Math.min(MAXR, Math.ceil(cells * (ctx.height / Math.max(1, ctx.width))) + 1);
    if (fire) {
      this.triggers++;
      const total = cells * rows;
      const flips = Math.max(1, Math.round(num(p.flipAmount, 0.35) * total));
      for (let k = 0; k < flips; k++) {
        const ci = Math.floor(hash01(this.triggers * 131 + k, 5) * total);
        const x = ci % cells;
        const y = Math.floor(ci / cells);
        const i = (y * MAXC + x) * 4;
        const dir = hash01(this.triggers * 977 + k, 9) < 0.5 ? -1 : 1;
        this.state[i] = this.state[i + 1];
        this.state[i + 1] += dir;
        this.state[i + 2] = now;
      }
      this.tex.needsUpdate = true;
    }
    const u = this.u;
    u.uCells.value = cells;
    u.uNow.value = now;
    u.uFlipDur.value = 0.08 + 0.6 * num(p.ease, 0.5) * (60 / Math.max(60, frame.bpm));
    u.uStroke.value = num(p.stroke, 0.12);
    u.uColors.value = Math.round(num(p.colors, 4));
    u.uPulse.value = num(p.pulse, 0.05);
    u.uStyle.value = p.style === 'truchet' ? 1 : p.style === 'arcs' ? 2 : 0;
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
