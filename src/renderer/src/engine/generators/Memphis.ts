import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform float uDensity, uScale, uDriftT, uJitter, uSquiggle, uOutline, uBackground;

float shapeSdf(vec2 q, float kind, float stroke) {
  if (stroke > 0.5) {
    if (kind < 1.0) return max(abs(q.y - 0.06 * sin(q.x * 26.0)) - 0.028, abs(q.x) - 0.3);          // squiggle
    if (kind < 2.0) {                                                                               // zigzag
      float y = 0.09 * (abs(fract(q.x * 4.0) - 0.5) * 4.0 - 1.0);
      return max(abs(q.y - y) * 0.75 - 0.026, abs(q.x) - 0.3);
    }
    return abs(length(q) - 0.2) - 0.035;                                                            // ring
  }
  if (kind < 1.0) return length(q) - 0.2;                                                           // dot
  if (kind < 2.0) return sdTriangleEq(q, 0.22);                                                     // triangle
  if (kind < 3.0) return max(length(q) - 0.24, -q.y);                                              // half disc
  if (kind < 4.0) return sdBox(q, vec2(0.26, 0.07));                                                // bar
  vec2 g = fract(q * 7.0 + 0.5) - 0.5;                                                              // dot grid
  return max(length(g) / 7.0 - 0.022, sdBox(q, vec2(0.21)));
}

void main() {
  vec2 p = gl_FragCoord.xy / uRes.y;
  float n = 5.0 * uDensity;
  p += vec2(uDriftT * 0.03, uDriftT * 0.017);
  vec2 g = p * n;
  vec2 cid = floor(g);
  vec3 col = uPal[4] * uBackground;
  // Background speckle.
  float speck = step(0.93, hash21(floor(gl_FragCoord.xy / 3.0)));
  col = mix(col, uPal[0], speck * 0.06 * uBackground);
  float beatI = floor(uBeat);
  float hop = easeOutBack(clamp(fract(uBeat) * 3.0, 0.0, 1.0));
  float px = 1.5 / uRes.y * n / uScale;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 c = cid + vec2(float(dx), float(dy));
      float h = hash21(c);
      vec2 o = mix(hash22(c + beatI - 1.0) - 0.5, hash22(c + beatI) - 0.5, hop) * uJitter * 0.6;
      vec2 q = (g - (c + 0.5 + o)) / uScale;
      float spin = mix(hash11(h * 31.0 + beatI - 1.0), hash11(h * 31.0 + beatI), hop) * uJitter;
      q = rot2(hash11(h * 91.0) * 6.2831 + spin * 3.1416) * q;
      float stroke = step(hash11(h * 17.0), uSquiggle);
      float kind = floor(hash11(h * 13.7) * (stroke > 0.5 ? 3.0 : 5.0));
      float d = shapeSdf(q, kind, stroke);
      vec3 sc = uPal[1 + int(floor(hash11(h * 5.3) * 3.0))];
      float fill = 1.0 - smoothstep(-px, px, d);
      float edge = (1.0 - smoothstep(-px, px, abs(d) - 0.012)) * uOutline * (1.0 - stroke);
      // Drop shadow offset for that 80s print feel.
      float sh = 1.0 - smoothstep(-px, px, shapeSdf(q - vec2(0.03, -0.03), kind, stroke));
      col = mix(col, uPal[0], sh * 0.85 * uOutline * (1.0 - fill));
      col = mix(col, sc * (1.0 + 0.4 * uKick), fill);
      col = mix(col, uPal[0], edge);
    }
  }
  fragColor = vec4(col, coverAlpha(col, uBackground));
}
`;

/** Memphis-design confetti that hops to new positions on every beat. */
export class Memphis extends ShaderGenerator {
  readonly kind = 'memphis';
  private drift = 0;
  constructor() {
    super(FRAG, { uDensity: { value: 1 }, uScale: { value: 1 }, uDriftT: { value: 0 }, uJitter: { value: 0.4 }, uSquiggle: { value: 0.5 }, uOutline: { value: 0.5 }, uBackground: { value: 1 } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uDensity.value = num(p.density, 1);
    u.uScale.value = num(p.scale, 1);
    this.drift = ctx.time * num(p.drift, 0.4);
    u.uDriftT.value = this.drift;
    u.uJitter.value = num(p.jitter, 0.4);
    u.uSquiggle.value = num(p.squiggle, 0.5);
    u.uOutline.value = num(p.outline, 0.5);
    u.uBackground.value = num(p.background, 1);
  }
}
