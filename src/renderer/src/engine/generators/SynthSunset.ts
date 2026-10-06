import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform float uSun, uStripes, uHorizon, uMountains, uGlow, uStars;
uniform float uSpec[24];

void main() {
  vec2 uv = vUv;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float hy = uHorizon - 0.5;            // horizon in p-space
  vec3 col;
  if (p.y > hy) {
    // Sky gradient and stars.
    float h = (p.y - hy) / (0.5 - hy);
    col = mix(uPal[2] * 0.35, uPal[0] * 0.6, smoothstep(0.0, 1.0, h));
    vec2 sc = floor(gl_FragCoord.xy / 3.0);
    float st = step(0.997, hash21(sc)) * (0.5 + 0.5 * sin(uTime * 3.0 + hash21(sc + 3.0) * 30.0));
    col += vec3(st) * uStars * smoothstep(0.2, 1.0, h);
    // Sun: vertical gradient disc with horizontal slits that thicken toward the bottom.
    vec2 sp = p - vec2(0.0, hy + uSun * 0.8);
    float r = uSun * (1.0 + 0.03 * uKick);
    float d = length(sp) - r;
    float t = clamp((sp.y + r) / (2.0 * r), 0.0, 1.0);
    vec3 sun = mix(palette(0.55), palette(0.95), t) * (1.6 + 0.8 * uBass);
    float slit = 1.0;
    if (t < 0.6) {
      float n = uStripes;
      float band = fract(t * n + uBeat * 0.25);
      float w = (0.6 - t) / 0.6 * 0.6;
      slit = step(w, band);
    }
    col = mix(col, sun, (1.0 - smoothstep(0.0, 0.004, d)) * slit);
    col += palette(0.6) * exp(-max(d, 0.0) * 9.0) * 0.6 * uGlow;
    // Mountains: a spectrum-driven ridge in front of the sun.
    float x = uv.x;
    float fi = abs(x - 0.5) * 2.0 * 23.0;
    int i0 = int(floor(fi));
    float spec = mix(uSpec[min(i0, 23)], uSpec[min(i0 + 1, 23)], fract(fi));
    float ridge = hy + (0.03 + 0.18 * spec * uMountains) * (0.4 + 0.6 * abs(x - 0.5) * 2.0);
    if (p.y < ridge) {
      col = uPal[0] * 0.25;
      col += palette(0.75) * (1.0 - smoothstep(0.0, 0.004, ridge - p.y)) * 1.5;
    }
  } else {
    // Perspective grid floor scrolling one line per beat.
    float depth = (hy - p.y);
    float z = 0.2 / max(depth, 1e-3);
    float gz = z + uBeat;
    float lz = 1.0 - smoothstep(0.0, fwidth(gz) * 1.5, 0.5 - abs(fract(gz) - 0.5));
    float gx = p.x * z * 1.5;
    float lx = 1.0 - smoothstep(0.0, fwidth(gx) * 1.5, 0.5 - abs(fract(gx) - 0.5));
    col = uPal[0] * 0.3;
    float fade = exp(-z * 0.08);
    col += palette(0.62) * max(lz, lx) * fade * (0.9 + 1.2 * uKick + 0.6 * uBass);
    col += palette(0.62) * exp(-depth * 30.0) * 0.4 * uGlow;
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** Synthwave sunset: slit sun, spectrum mountains, beat-scrolling grid. */
export class SynthSunset extends ShaderGenerator {
  readonly kind = 'synthSunset';
  constructor() {
    super(FRAG, { uSun: { value: 0.22 }, uStripes: { value: 9 }, uHorizon: { value: 0.42 }, uMountains: { value: 1 }, uGlow: { value: 1 }, uStars: { value: 1 }, uSpec: { value: new Array<number>(24).fill(0) } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const spec = u.uSpec.value as number[];
    const b = ctx.frame.bands32;
    const k = 1 - Math.exp(-ctx.dt / 0.08);
    for (let i = 0; i < 24; i++) spec[i] += (Math.min(1, b[Math.min(31, 2 + i)] * ctx.globals.reactivity) - spec[i]) * k;
    u.uSun.value = num(p.sun, 0.22);
    u.uStripes.value = num(p.stripes, 9);
    u.uHorizon.value = num(p.horizon, 0.42);
    u.uMountains.value = num(p.mountains, 1);
    u.uGlow.value = num(p.glow, 1);
    u.uStars.value = num(p.stars, 1);
  }
}
