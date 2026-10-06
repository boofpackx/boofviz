import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uMode;          // 0 polka (infinity dots), 1 circles (Kandinsky)
uniform float uDensity, uSize, uPulse, uDriftT, uZoom;

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col;
  if (uMode == 0) {
    // Infinity dots: endless polka field slowly zooming, dots swell with the bass.
    float z = fract(uDriftT * 0.05);
    vec3 bg = uPal[2];
    col = bg;
    for (int layer = 0; layer < 2; layer++) {
      float s = exp2(float(layer) - z) * uDensity * 6.0;
      vec2 g = p * s / uZoom;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      // Same hash at every octave, so the fine layer becomes the coarse one seamlessly at the wrap.
      vec2 j = (hash22(id) - 0.5) * 0.3;
      float r = (0.12 + 0.24 * hash21(id + 7.0)) * uSize * (1.0 + uPulse * (0.6 * uBass + 0.4 * uKick));
      r = min(r, 0.48 - max(abs(j.x), abs(j.y)));   // stay inside the cell: no clipped, square dots
      float d = length(f - j) - r;
      float a = 1.0 - smoothstep(-0.02, 0.02, d);
      // The coarse octave leaves as it grows, the fine one arrives while small: dots stay solid.
      float fade = layer == 0 ? 1.0 - smoothstep(0.5, 1.0, z) : smoothstep(0.0, 0.5, z);
      // A thin ring of background keeps overlapping dots apart, as in the paintings.
      float ring = 1.0 - smoothstep(0.03, 0.06, d);
      col = mix(col, bg, ring * fade);
      col = mix(col, uPal[4] * 1.35, a * fade);
    }
  } else {
    // Several circles: translucent discs with dark halos, sized by the spectrum.
    col = uPal[0] * 0.35 + vec3(0.01);
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      vec2 c = (hash22(vec2(fi, 3.7)) - 0.5) * vec2(uRes.x / uRes.y * 0.85, 0.85);
      c += 0.03 * vec2(sin(uDriftT * 0.2 + fi), cos(uDriftT * 0.17 + fi * 1.3));
      float band = i < 5 ? uBass : i < 10 ? uMids : uHighs;
      float r = (0.04 + 0.13 * hash11(fi * 9.1)) * uSize * (1.0 + uPulse * band * 0.6);
      float d = length(p - c) - r;
      vec3 cc = palette(0.25 + 0.75 * hash11(fi * 4.3));
      // Dark halo ring, then the disc mixed like translucent paint.
      col *= 1.0 - 0.5 * exp(-max(d, 0.0) * 40.0) * step(0.0, d);
      float a = 1.0 - smoothstep(-0.003, 0.003, d);
      col = mix(col, col * 0.4 + cc * (0.8 + 0.6 * band), a * 0.85);
    }
  }
  fragColor = vec4(col, 1.0);
}
`;

/** Polka-dot infinity field or a Kandinsky-style circle composition. */
export class Dots extends ShaderGenerator {
  readonly kind = 'dots';
  constructor() {
    super(FRAG, { uMode: { value: 0 }, uDensity: { value: 1 }, uSize: { value: 1 }, uPulse: { value: 0.5 }, uDriftT: { value: 0 }, uZoom: { value: 1 } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uMode.value = p.mode === 'circles' ? 1 : 0;
    u.uDensity.value = num(p.density, 1);
    u.uSize.value = num(p.size, 1);
    u.uPulse.value = num(p.pulse, 0.5);
    u.uDriftT.value = ctx.time * num(p.drift, 1);
    u.uZoom.value = num(p.zoom, 1);
  }
}
