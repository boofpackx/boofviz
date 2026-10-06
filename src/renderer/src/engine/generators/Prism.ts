import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform float uSize, uSpread, uBeam, uGlow, uPaletteMix, uTilt;
uniform float uBands[7];

vec3 rainbow(int i) {
  if (i == 0) return vec3(1.0, 0.05, 0.03);
  if (i == 1) return vec3(1.0, 0.28, 0.0);
  if (i == 2) return vec3(1.0, 0.85, 0.0);
  if (i == 3) return vec3(0.1, 0.85, 0.15);
  if (i == 4) return vec3(0.0, 0.35, 1.0);
  return vec3(0.4, 0.05, 0.9);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.5 / uRes.y;
  float R = uSize * (1.0 + 0.04 * uKick);
  // Equilateral triangle, apex up.
  float tri = sdTriangleEq(p - vec2(0.0, -R * 0.1), R);
  vec3 col = vec3(0.0);

  // Outline with a soft inner sheen.
  col += vec3(0.8, 0.85, 0.95) * (1.0 - smoothstep(0.0, px * 2.0, abs(tri) - 0.002)) * 1.3;
  col += vec3(0.25, 0.28, 0.35) * exp(-abs(tri) * 60.0) * uGlow;

  // Entry / exit points on the left and right faces.
  float k = 1.7320508;
  vec2 inP = vec2(-R * 0.45, -R * 0.1 + R * 0.12);
  vec2 outP = vec2(R * 0.42, -R * 0.1 + R * 0.2);
  // Incoming white beam from the left edge.
  vec2 src = vec2(-aspect * 0.5 - 0.1, inP.y - 0.18 + uTilt);
  float dBeam = sdSegment(p, src, inP);
  float beamW = uBeam * (0.004 + 0.006 * uEnergy + 0.004 * uKick);
  col += vec3(1.0) * (1.0 - smoothstep(beamW, beamW + px, dBeam)) * 1.6;
  col += vec3(0.8) * exp(-dBeam / (beamW * 4.0 + 0.002)) * 0.35 * uGlow;
  // Faint dispersion inside the glass.
  if (tri < 0.0) {
    float d = sdSegment(p, inP, outP);
    col += vec3(0.6, 0.6, 0.7) * exp(-d * 40.0) * 0.25;
  }
  // Outgoing spectrum fan: six bands, each lit by a frequency band.
  vec2 v = p - outP;
  if (v.x > 0.0) {
    float ang = atan(v.y, v.x);
    float a0 = 0.05 + 0.02 * uTilt;
    float fan = 0.06 + 0.22 * uSpread;
    float t = (a0 - ang) / fan;          // 0 = top (red) … 1 = bottom (violet)
    if (t > 0.0 && t < 1.0) {
      int i = int(floor(t * 6.0));
      float level = uBands[min(i + 1, 6)] * 0.7 + uBands[max(i, 0)] * 0.3;
      vec3 c = mix(rainbow(i), palette(0.2 + float(i) / 7.0), uPaletteMix);
      float edge = smoothstep(0.0, 0.02, fract(t * 6.0)) * smoothstep(1.0, 0.98, fract(t * 6.0));
      col += c * (0.35 + 1.6 * level) * mix(0.85, 1.0, edge) * smoothstep(0.0, 0.03, v.x);
    }
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** White light in, the spectrum out: each colour band is lit by its frequency band. */
export class Prism extends ShaderGenerator {
  readonly kind = 'prism';
  constructor() {
    super(FRAG, { uSize: { value: 0.28 }, uSpread: { value: 0.5 }, uBeam: { value: 1 }, uGlow: { value: 0.8 }, uPaletteMix: { value: 0 }, uTilt: { value: 0 }, uBands: { value: new Array<number>(7).fill(0) } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const b = ctx.frame.bands;
    const arr = u.uBands.value as number[];
    const vals = [b.sub, b.bass, b.lowMid, b.mid, b.highMid, b.presence, b.air];
    const k = 1 - Math.exp(-ctx.dt / 0.06);
    for (let i = 0; i < 7; i++) arr[i] += (Math.min(1, vals[i] * ctx.globals.reactivity) - arr[i]) * k;
    u.uSize.value = num(p.size, 0.28);
    u.uSpread.value = num(p.spread, 0.5);
    u.uBeam.value = num(p.beam, 1);
    u.uGlow.value = num(p.glow, 0.8);
    u.uPaletteMix.value = num(p.paletteMix, 0);
    u.uTilt.value = num(p.tilt, 0);
  }
}
