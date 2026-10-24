import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Aqua Gel: the glossy gel interface material of 2000-2003, as a spectrum. A
 * row of translucent candy-gel capsules on fine pinstripes: the stripes bend
 * through the gel, a bright glossy highlight sits across the top of each, the
 * bottom glows lighter, the rims are deeper, and each casts a soft shadow
 * tinted by its gel. Heights follow the bands on springs, so a kick makes
 * them wobble like jelly; the drop pops them into gel bubbles that float up.
 *
 * Drawn in display colours (like the interface it comes from). Colours: the
 * palette's stops 2-5 for the gel (one, two-tone or rainbow).
 */

const MAX = 24;

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform float uH[${MAX}];
uniform float uSq[${MAX}];
uniform int uN;
uniform float uPop, uMode, uDark, uGlint;

vec3 toS(vec3 lin) { return pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec3 gelColour(int i) {
  float t = float(i) / float(max(uN - 1, 1));
  int k = uMode < 0.5 ? 1 : uMode < 1.5 ? (i % 2 == 0 ? 1 : 2) : 1 + int(floor(t * 3.999));
  return toS(uPal[k]);
}

float stripes(vec2 px) {
  return uDark > 0.5 ? mix(0.16, 0.2, step(0.5, fract(px.y / 4.0))) : mix(0.9, 0.96, step(0.5, fract(px.y / 4.0)));
}

// Capsule: vertical segment from (x, y0 + r) to (x, y1 - r), radius r.
float capsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 p = px / uRes.y;
  float aspect = uRes.x / uRes.y;
  vec3 bg = vec3(stripes(px));
  bg *= 1.0 - 0.12 * length(vUv - vec2(0.5, 0.6));
  vec3 col = bg;
  float span = aspect * 0.82;
  float x0 = (aspect - span) * 0.5;
  float pitch = span / float(uN);
  float r = pitch * 0.34;
  float base = 0.14;
  int ci = int(floor((p.x - x0) / pitch));
  // Shadows from this capsule and its neighbours.
  for (int k = -1; k <= 1; k++) {
    int i = ci + k;
    if (i < 0 || i >= uN) continue;
    float cx = x0 + (float(i) + 0.5) * pitch;
    float top = base + r * 2.0 + uH[i] * 0.62;
    float d = capsule(p - vec2(0.012, -0.018), vec2(cx, base + r), vec2(cx, top - r), r * uSq[i]);
    col = mix(col, col * mix(vec3(1.0), gelColour(i), 0.55) * 0.82, smoothstep(0.03, -0.01, d) * 0.5);
  }
  if (ci >= 0 && ci < uN) {
    int i = ci;
    float cx = x0 + (float(i) + 0.5) * pitch;
    float top = base + r * 2.0 + uH[i] * 0.62;
    float rr = r * uSq[i];
    float d = capsule(p, vec2(cx, base + r), vec2(cx, top - r), rr);
    float aa = 1.5 / uRes.y;
    if (d < aa) {
      vec3 gel = gelColour(i);
      float u = (p.x - cx) / rr;               // -1..1 across
      float v = (p.y - base) / max(top - base, 1e-3); // 0 bottom .. 1 top
      // The stripes behind, bent by the gel's curve.
      float bend = stripes(px + vec2(0.0, u * u * 14.0 + 6.0));
      vec3 c = mix(gel * 0.75, gel * bend * 1.1, 0.35);
      // Deeper at the rims, lighter glow at the bottom.
      c *= 0.72 + 0.28 * (1.0 - u * u);
      c = mix(c, mix(gel, vec3(1.0), 0.55), smoothstep(0.35, 0.0, v) * 0.55 * (1.0 - abs(u)));
      // The gloss: a white band over the top part, fading downwards.
      float gl = smoothstep(0.92, 0.6, abs(u)) * smoothstep(0.55, 0.92, v) * smoothstep(1.02, 0.9, v + (1.0 - abs(u)) * 0.02);
      c = mix(c, vec3(1.0), gl * (0.75 + uGlint * 0.25));
      // A hard little glint near the top.
      c += vec3(1.0) * smoothstep(0.12, 0.0, length(vec2(u + 0.35, (v - 0.86) * 4.0))) * 0.6;
      // A thin bright edge.
      c = mix(c, mix(gel, vec3(1.0), 0.4), smoothstep(-aa * 3.0, 0.0, d) * 0.6);
      col = mix(col, c, smoothstep(aa, -aa, d));
    }
  }
  // Bubbles after the drop: gel spheres floating up.
  if (uPop > 0.0) {
    for (int i = 0; i < ${MAX}; i++) {
      if (i >= uN) break;
      float cx = x0 + (float(i) + 0.5) * pitch + sin(float(i) * 3.1 + uPop * 6.0) * 0.03;
      float cy = base + uPop * (0.9 + fract(float(i) * 0.37) * 0.5);
      float br = r * (0.9 + fract(float(i) * 0.61) * 0.5);
      float dd = length(p - vec2(cx, cy)) - br;
      if (dd < 0.0) {
        vec3 gel = gelColour(i);
        vec2 q = (p - vec2(cx, cy)) / br;
        vec3 c = mix(gel * 0.8, mix(gel, vec3(1.0), 0.5), smoothstep(0.0, -0.8, q.y));
        c = mix(c, vec3(1.0), smoothstep(0.35, 0.0, length(q - vec2(-0.3, 0.45))) * 0.85);
        col = mix(col, c, (1.0 - uPop * 0.7));
      }
    }
  }
  fragColor = vec4(fromDisplay(col), 1.0);
}
`;

export class AquaGel extends ShaderGenerator {
  readonly kind = 'aquaGel';
  private readonly h = new Float32Array(MAX);
  private readonly hv = new Float32Array(MAX);
  private readonly sq = new Float32Array(MAX).fill(1);
  private readonly sqv = new Float32Array(MAX);
  private dropAt = -99;

  constructor() {
    super(FRAG, { uH: { value: new Float32Array(MAX) }, uSq: { value: new Float32Array(MAX) }, uN: { value: 12 }, uPop: { value: 0 }, uMode: { value: 2 }, uDark: { value: 0 }, uGlint: { value: 0 } });
    this.u.uH.value = this.h;
    this.u.uSq.value = this.sq;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const f = ctx.frame;
    const n = Math.max(4, Math.min(MAX, Math.round(num(p.capsules, 12))));
    this.u.uN.value = n;
    const dt = Math.min(0.05, ctx.dt);
    if (f.drop) this.dropAt = ctx.beat;
    const dd = (ctx.beat - this.dropAt) / ((f.beatsPerBar || 4) * 1.5);
    const popping = dd >= 0 && dd < 1;
    const gain = num(p.gain, 1);
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * 28), z = Math.max(a + 1, Math.floor(((i + 1) / n) * 28));
      let s = 0;
      for (let k = a; k < z; k++) s += f.bands32[k] ?? 0;
      const target = popping ? 0 : Math.min(1, (s / (z - a)) * gain * (1 + (i / n) * 0.3));
      // Springy heights; the kick adds a wobble (squash and stretch).
      this.hv[i] += ((target - this.h[i]) * 90 - this.hv[i] * 11) * dt;
      this.h[i] = Math.max(0, this.h[i] + this.hv[i] * dt);
      if (f.onsets.kick) this.sqv[i] += 2.4 * num(p.wobble, 1) * (0.6 + this.h[i]);
      this.sqv[i] += ((1 - this.sq[i]) * 160 - this.sqv[i] * 9) * dt;
      this.sq[i] = Math.min(1.35, Math.max(0.7, this.sq[i] + this.sqv[i] * dt));
    }
    this.u.uPop.value = popping ? dd : 0;
    this.u.uMode.value = p.colours === 'single' ? 0 : p.colours === 'two' ? 1 : 2;
    this.u.uDark.value = p.stripes === 'graphite' ? 1 : 0;
    this.u.uGlint.value = ctx.env.hat;
  }
}
