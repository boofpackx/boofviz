import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform float uSides, uRound, uSize, uCopies, uSpread, uNested, uNestScale, uTwist, uRot;
uniform float uStroke, uFill, uGlow, uColorSpread, uBackground, uNestOffset, uOffsetY;
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y - vec2(0.0, uOffsetY);
  float px = 1.25 / uRes.y;
  vec3 bg = mix(uPal[1] * 0.18, uPal[0] * 0.5, smoothstep(0.0, 0.9, length(p))) * uBackground;
  vec3 col = vec3(0.0);
  vec3 glow = vec3(0.0);
  float n0 = floor(uSides);
  float fr = uSides - n0;
  for (int c = 0; c < 12; c++) {
    float fc = float(c);
    if (fc >= uCopies) break;
    float ca = 6.28318531 * fc / uCopies;
    vec2 center = uCopies > 1.5 ? vec2(cos(ca), sin(ca)) * uSpread : vec2(0.0);
    vec2 q = rot2(ca) * (p - center);
    for (int l = 0; l < 12; l++) {
      float fl = float(l);
      if (fl >= uNested) break;
      float s = uSize * pow(uNestScale, fl);
      // Nest offset slides each inner shape down (Albers' squares sit low in the frame).
      vec2 qq = rot2(uRot + uTwist * fl * 6.28318531) * (q + vec2(0.0, uNestOffset * fl * s));
      float d = mix(sdPolygon(qq, s, n0), sdPolygon(qq, s, n0 + 1.0), fr);
      d = mix(d, length(qq) - s * 0.9, uRound);
      vec3 base = paletteWrap(0.1 + uColorSpread * fl / max(uNested, 1.0) + fc * 0.17);
      float fillA = (1.0 - smoothstep(-px, px, d)) * uFill;
      col = mix(col, base * (0.25 + 0.5 * uMids), fillA);
      float edge = uStroke > 0.0 ? 1.0 - smoothstep(-px, px, abs(d) - uStroke) : 1.0 - smoothstep(-px, px, d);
      col += base * edge * (1.2 + 1.4 * uKick) * (uStroke > 0.0 ? 1.0 : 0.6);
      glow += base * exp(-abs(d) * 45.0) * uGlow * (0.2 + 0.7 * uBass) / (1.0 + fl * 0.35);
    }
  }
  col = bg + col + glow * 0.5;
  col = max(col, 0.0);
  fragColor = vec4(col, coverAlpha(col, uBackground));
}
`;

const MORPH = [3, 4, 6, 24];

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = Math.min(1, Math.max(0, x));
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Shape play: morphing polygons, N-fold instancing and nested rotating recursion. */
export class Polygon extends ShaderGenerator {
  readonly kind = 'polygon';

  constructor() {
    super(FRAG, {
      uSides: { value: 6 },
      uRound: { value: 0 },
      uSize: { value: 0.25 },
      uCopies: { value: 1 },
      uSpread: { value: 0.25 },
      uNested: { value: 1 },
      uNestScale: { value: 0.78 },
      uTwist: { value: 0.1 },
      uRot: { value: 0 },
      uStroke: { value: 0.012 },
      uFill: { value: 0 },
      uGlow: { value: 0.6 },
      uColorSpread: { value: 0.6 },
      uBackground: { value: 0.3 },
      uNestOffset: { value: 0 },
      uOffsetY: { value: 0 },
    });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    // Beat morph: step triangle → square → hexagon → circle, overshooting into each shape.
    const morph = num(p.beatMorph, 0);
    let sides = num(p.sides, 6);
    let round = num(p.roundness, 0);
    if (morph > 0) {
      const i = Math.floor(ctx.beat);
      const ph = ctx.beat - i;
      const a = MORPH[((i - 1) % 4 + 4) % 4];
      const b = MORPH[((i % 4) + 4) % 4];
      const t = easeOutBack(ph / 0.35);
      const ms = a + (b - a) * t;
      const mr = b === 24 ? Math.min(1, t) : a === 24 ? Math.max(0, 1 - t) : 0;
      sides = sides + (Math.min(12, ms) - sides) * morph;
      round = round + (mr - round) * morph;
    }
    u.uSides.value = Math.max(3, Math.min(12.99, sides));
    u.uRound.value = Math.min(1, Math.max(0, round));
    u.uSize.value = num(p.size, 0.25) * (1 + num(p.pulse, 0.15) * ctx.env.kick);
    u.uCopies.value = Math.round(num(p.copies, 1));
    u.uSpread.value = num(p.spread, 0.25);
    u.uNested.value = Math.round(num(p.nested, 1));
    u.uNestScale.value = num(p.nestScale, 0.78);
    u.uTwist.value = num(p.twist, 0.1);
    u.uRot.value = (num(p.angle, 0) * Math.PI) / 180 + (2 * Math.PI * num(p.spin, 0.25) * ctx.beat) / Math.max(1, ctx.frame.beatsPerBar);
    u.uStroke.value = num(p.stroke, 0.012);
    u.uFill.value = num(p.fill, 0);
    u.uGlow.value = num(p.glow, 0.6);
    u.uColorSpread.value = num(p.colorSpread, 0.6);
    u.uBackground.value = num(p.background, 0.3);
    u.uNestOffset.value = num(p.nestOffset, 0);
    u.uOffsetY.value = num(p.offsetY, 0);
  }
}
