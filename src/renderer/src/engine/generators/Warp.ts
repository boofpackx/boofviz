import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uMode;            // 0 starfield, 1 hyperspace, 2 slit-scan corridor
uniform float uSpeed, uDensity, uStreak, uTwist, uWarpT, uJump;

vec3 starfield(vec2 p) {
  vec3 col = vec3(0.0);
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    float z = fract(uWarpT * 0.15 + fk / 6.0);
    float scale = mix(18.0, 0.6, z) * uDensity;
    vec2 q = rot2(uTwist * z) * p * scale;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    vec2 j = hash22(id + fk * 31.0) - 0.5;
    float present = step(0.55, hash21(id + fk * 7.0));
    vec2 dir = normalize(p + 1e-4);
    // Streak along the radial direction as stars get close.
    vec2 d = f - j * 0.7;
    float along = dot(d, dir);
    float across = dot(d, vec2(-dir.y, dir.x));
    float len = 0.02 + uStreak * z * z * 0.6;
    float s = exp(-(across * across) / (0.0006 + 0.002 * z) - max(abs(along) - len, 0.0) * 40.0);
    col += vec3(0.8, 0.9, 1.0) * s * present * smoothstep(0.0, 0.3, z) * (0.5 + 1.5 * z);
  }
  return col;
}

vec3 hyperspace(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float bins = 360.0 * uDensity;
  float b = floor((a / 6.28318531 + 0.5) * bins);
  float h = hash11(b * 1.37);
  float t = fract(uWarpT * (0.15 + 0.35 * h) + h * 10.0);
  float head = t * t * 1.4;
  float len = (0.05 + uStreak * 0.6 * t) * (1.0 + 2.0 * uJump);
  float band = abs(fract((a / 6.28318531 + 0.5) * bins) - 0.5);
  float w = exp(-band * band * 60.0);
  float s = smoothstep(head - len, head, r) * (1.0 - smoothstep(head, head + 0.01, r)) * w;
  vec3 c = mix(vec3(0.55, 0.75, 1.0), vec3(1.0), h) * s * (0.8 + 1.5 * t);
  c += vec3(0.6, 0.8, 1.0) * exp(-r * 8.0) * (0.2 + 2.0 * uJump);
  return c;
}

vec3 corridor(vec2 p) {
  // Two walls of light rushing toward the viewer from a slit at the centre.
  float y = abs(p.y);
  float z = 0.12 / max(y, 0.004);
  float u = p.x * z * 0.8;
  float v = z + uWarpT * 0.8;
  float n = fbm(vec2(u * 1.5, v * 0.6));
  float bands = sin(v * 6.0 + n * 6.0) * 0.5 + 0.5;
  vec3 c = palette(fract(n * 1.5 + v * 0.05 + (p.y > 0.0 ? 0.0 : 0.5))) * (0.3 + 1.6 * bands * bands);
  c *= smoothstep(0.0, 0.06, y) * (1.0 + 0.8 * uBass);
  c += vec3(1.0) * exp(-y * 120.0) * (0.6 + uKick);
  return c;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uMode == 0 ? starfield(p) : uMode == 1 ? hyperspace(p) : corridor(p);
  fragColor = vec4(col * (1.0 + 0.3 * uKick), 1.0);
}
`;

/** Starfield, hyperspace jump streaks, or the slit-scan light corridor. */
export class Warp extends ShaderGenerator {
  readonly kind = 'warp';
  private t = 0;
  private lastTime = Number.NaN;
  private jump = 0;
  constructor() {
    super(FRAG, { uMode: { value: 0 }, uSpeed: { value: 1 }, uDensity: { value: 1 }, uStreak: { value: 0.3 }, uTwist: { value: 0 }, uWarpT: { value: 0 }, uJump: { value: 0 } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const mode = p.mode === 'hyperspace' ? 1 : p.mode === 'corridor' ? 2 : 0;
    u.uMode.value = mode;
    // Travel speed follows tempo and energy; drops kick in a jump.
    this.jump = ctx.frame.drop ? 1 : this.jump * Math.exp(-ctx.dt / 1.2);
    const speed = num(p.speed, 1) * (ctx.frame.bpm / 120) * (0.6 + 0.8 * ctx.env.energy + 2.5 * this.jump + 0.5 * ctx.env.kick);
    // Integrate on the shared clock so windows stay close (they start from the same time base).
    if (Number.isNaN(this.lastTime)) this.t = ctx.time * num(p.speed, 1);
    else this.t += Math.max(0, ctx.time - this.lastTime) * speed;
    this.lastTime = ctx.time;
    u.uWarpT.value = this.t;
    u.uDensity.value = num(p.density, 1);
    u.uStreak.value = num(p.streak, 0.3);
    u.uTwist.value = num(p.twist, 0);
    u.uJump.value = this.jump;
  }
}
