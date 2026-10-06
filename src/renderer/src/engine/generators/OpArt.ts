import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uMode;          // 0 waves (Riley), 1 bulge (Vasarely Vega), 2 moiré
uniform float uFreq, uAmp, uContrast, uColorize, uMotion;

vec3 ink(float v) {
  vec3 bw = vec3(v);
  vec3 pal = mix(uPal[0] * 0.6, palette(0.4 + 0.55 * v), v);
  return mix(bw, pal, uColorize);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float px = 1.0 / uRes.y;
  float v;
  if (uMode == 0) {
    // Wavy stripes whose phase rolls across the frame; the bass deepens the swell.
    float amp = uAmp * (0.05 + 0.08 * uBass);
    float w = p.x + amp * sin(p.y * 7.0 + uTime * 0.9 * uMotion + 3.0 * p.x) + amp * 0.5 * sin(p.y * 13.0 - uTime * 1.3 * uMotion);
    float s = w * uFreq * 20.0;
    float aa = fwidth(s) * 1.2;
    v = smoothstep(-aa, aa, sin(s * 3.14159) * uContrast);
  } else if (uMode == 1) {
    // Checkerboard bulging into a sphere that breathes with the bass.
    float R = 0.32 + 0.04 * uBass + 0.03 * uKick;
    float r = length(p);
    vec2 q = p;
    if (r < R) {
      float z = sqrt(R * R - r * r);
      q = p * (1.0 - uAmp * 0.6 * z / R);
    }
    vec2 g = q * uFreq * 14.0 + vec2(uTime * 0.1 * uMotion, 0.0);
    vec2 aa = fwidth(g) * 1.2;
    vec2 c = smoothstep(-aa, aa, sin(g * 3.14159));
    v = abs(c.x - c.y);
    // Shade the sphere so it reads as volume.
    if (r < R) v = mix(v, v * (0.55 + 0.45 * (1.0 - r / R)), 0.5);
  } else {
    // Two sets of concentric rings drifting apart: interference blooms on the beat.
    vec2 off = vec2(sin(uTime * 0.3 * uMotion), cos(uTime * 0.23 * uMotion)) * (0.05 + 0.1 * uAmp * (0.3 + uBass));
    float a = sin(length(p - off) * uFreq * 120.0);
    float b = sin(length(p + off) * uFreq * 120.0 + uKick * 2.0);
    v = smoothstep(-0.2, 0.2, a * b * uContrast);
  }
  fragColor = vec4(ink(v), 1.0);
}
`;

/** Op-art: Riley-style waves, a Vasarely-style bulging checkerboard, or moiré rings. */
export class OpArt extends ShaderGenerator {
  readonly kind = 'opArt';
  constructor() {
    super(FRAG, { uMode: { value: 0 }, uFreq: { value: 1 }, uAmp: { value: 0.6 }, uContrast: { value: 1 }, uColorize: { value: 0 }, uMotion: { value: 1 } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uMode.value = p.mode === 'bulge' ? 1 : p.mode === 'moire' ? 2 : 0;
    u.uFreq.value = num(p.frequency, 1);
    u.uAmp.value = num(p.amplitude, 0.6);
    u.uContrast.value = num(p.contrast, 1);
    u.uColorize.value = num(p.colorize, 0);
    u.uMotion.value = num(p.motion, 1);
  }
}
