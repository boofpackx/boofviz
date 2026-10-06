import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const MAX = 24;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform vec4 uRects[${MAX}];   // x0, y0, x1, y1 in 0..1
uniform float uFill[${MAX}];   // 0 white, 1..3 palette colour, 4 black
uniform float uLevel[${MAX}];
uniform float uCount, uLine;

void main() {
  vec2 uv = vUv;
  vec3 col = vec3(0.0);
  float px = 1.0 / uRes.y;
  for (int i = 0; i < ${MAX}; i++) {
    if (float(i) >= uCount) break;
    vec4 r = uRects[i];
    if (uv.x >= r.x && uv.x < r.z && uv.y >= r.y && uv.y < r.w) {
      float f = uFill[i];
      vec3 c = f < 0.5 ? uPal[4] * 0.92 : f > 3.5 ? uPal[0] * 0.2 : uPal[int(f)];
      // Coloured cells flash with their band; white cells stay paper.
      if (f > 0.5 && f < 3.5) c *= 0.75 + 0.9 * uLevel[i];
      // Thick black borders (in pixels, aspect-correct).
      vec2 d = min(uv - r.xy, r.zw - uv) * uRes;
      float edge = min(d.x, d.y);
      col = mix(vec3(0.0), c, smoothstep(uLine * uRes.y - 0.75, uLine * uRes.y + 0.75, edge));
    }
  }
  fragColor = vec4(col, 1.0);
}
`;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** De Stijl grid: recursive splits re-drawn every phrase, primaries flashing to the music. */
export class DeStijl extends ShaderGenerator {
  readonly kind = 'deStijl';
  private seed = -1;

  constructor() {
    super(FRAG, {
      uRects: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
      uFill: { value: new Array<number>(MAX).fill(0) },
      uLevel: { value: new Array<number>(MAX).fill(0) },
      uCount: { value: 0 },
      uLine: { value: 0.012 },
    });
  }

  private build(seed: number, cells: number, colorRatio: number): void {
    const rects: Rect[] = [{ x0: 0, y0: 0, x1: 1, y1: 1 }];
    let k = 0;
    while (rects.length < cells && k < 200) {
      k++;
      // Split the largest-ish rectangle, alternating orientation by its shape.
      let bi = 0;
      for (let i = 1; i < rects.length; i++) {
        const a = (rects[i].x1 - rects[i].x0) * (rects[i].y1 - rects[i].y0);
        const b = (rects[bi].x1 - rects[bi].x0) * (rects[bi].y1 - rects[bi].y0);
        if (a * (0.7 + 0.6 * hash01(k * 13 + i, seed)) > b) bi = i;
      }
      const r = rects[bi];
      const w = (r.x1 - r.x0) * (16 / 9);
      const h = r.y1 - r.y0;
      const t = 0.3 + 0.4 * hash01(k, seed + 1);
      if (w > h) {
        const x = r.x0 + (r.x1 - r.x0) * t;
        rects.splice(bi, 1, { ...r, x1: x }, { ...r, x0: x });
      } else {
        const y = r.y0 + h * t;
        rects.splice(bi, 1, { ...r, y1: y }, { ...r, y0: y });
      }
    }
    const v = this.u.uRects.value as THREE.Vector4[];
    const fill = this.u.uFill.value as number[];
    rects.forEach((r, i) => {
      v[i].set(r.x0, r.y0, r.x1, r.y1);
      const h = hash01(i * 7 + 3, seed + 2);
      fill[i] = h < colorRatio ? 1 + Math.floor(hash01(i, seed + 3) * 3) : h > 0.94 ? 4 : 0;
    });
    this.u.uCount.value = rects.length;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const cells = Math.round(num(p.cells, 11));
    const per = p.reshuffle === 'bar' ? ctx.frame.beatsPerBar : p.reshuffle === 'off' ? Infinity : ctx.frame.beatsPerPhrase;
    const seed = Number.isFinite(per) ? Math.floor(ctx.beat / per) : 0;
    const key = seed * 1000 + cells * 10 + Math.round(num(p.color, 0.35) * 9);
    if (key !== this.seed) {
      this.seed = key;
      this.build(seed, cells, num(p.color, 0.35));
    }
    const level = this.u.uLevel.value as number[];
    const b32 = ctx.frame.bands32;
    for (let i = 0; i < MAX; i++) level[i] += (Math.min(1, b32[(i * 5) % 32] * ctx.globals.reactivity) - level[i]) * (1 - Math.exp(-ctx.dt / 0.07));
    this.u.uLine.value = num(p.line, 0.012);
  }
}
