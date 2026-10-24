import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Burn Disc: the CD-R mix era. A recordable disc close up, filling the
 * frame: the dye layer's tint, fine concentric track grooves, a rainbow
 * diffraction streak across the surface that swings as the light moves, a
 * broad sheen, the clear hub ring and the hole, and small capacity marks round
 * the hub turning with the disc. The burned area (darker, its edge visible)
 * grows outward a band of tracks every phrase through the song. The disc spins
 * with the tempo, the diffraction flashes on the kick, and the drop swings the
 * light right round.
 *
 * Colours: stop 2 the dye, stop 3 the burned dye, stop 4 the sheen.
 */

const FRAG = /* glsl */ `${GEN_HEADER}
uniform float uSpin, uLight, uBurn, uFlash, uR;

vec3 hue(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  // The disc is a touch off centre and slightly tilted towards us.
  p -= vec2(0.03, -0.02);
  p.y *= 1.06;
  float r = length(p) / uR;
  float a = atan(p.y, p.x);
  vec3 col = vec3(0.012, 0.012, 0.018) * (1.0 - length(vUv - 0.5));
  if (r < 1.0) {
    float hole = 0.09, hub = 0.32, data0 = 0.36;
    if (r < hole) {
      col = vec3(0.0);
    } else if (r < hub) {
      // Clear plastic hub: faint, with a stacking ring and capacity marks that turn with the disc.
      col = vec3(0.10, 0.11, 0.12) + vec3(0.25) * smoothstep(0.004, 0.0, abs(r - 0.2)) * 0.5;
      float ang = a - uSpin;
      float marks = step(0.5, fract(ang * 40.0 / 6.2831853)) * step(0.23, r) * step(r, 0.27) * step(0.0, sin(ang * 3.0));
      col += vec3(0.35) * marks * 0.4;
      col += vec3(0.6) * pow(max(0.0, cos(a - uLight)), 30.0) * 0.25;
    } else {
      vec3 dye = uPal[2];
      vec3 burned = uPal[3];
      float rr = (r - data0) / (1.0 - data0);
      // Burned from the inside out, a slightly ragged edge.
      float edge = uBurn + sin(a * 7.0 + uSpin) * 0.002;
      float isBurned = rr < edge ? 1.0 : 0.0;
      vec3 base = mix(dye, burned, isBurned * 0.8);
      // Track grooves: very fine rings, catching the light.
      float groove = 0.5 + 0.5 * sin(r * 420.0);
      base *= 0.92 + 0.08 * groove;
      // The burn edge reads as a thin brighter ring.
      base += dye * 0.6 * smoothstep(0.004, 0.0, abs(rr - edge));
      // Diffraction: a rainbow streak perpendicular to the light, colours spread with radius.
      float across = abs(sin(a - uLight));
      float streak = pow(across, 18.0);
      vec3 rainbow = hue(fract(r * 2.2 - uLight * 0.15)) * streak * (0.9 + uFlash * 1.5);
      // A broad sheen along the light direction.
      float sheen = pow(max(0.0, cos(a - uLight)), 6.0) * 0.35;
      col = base * 0.55 + rainbow * 0.8 + uPal[4] * sheen;
      // The outer rim.
      col = mix(col, vec3(0.6), smoothstep(0.985, 1.0, r) * 0.6);
    }
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

export class BurnDisc extends ShaderGenerator {
  readonly kind = 'burnDisc';
  private spin = 0;
  private light = 0.6;
  private dropAt = -99;
  private flash = 0;

  constructor() {
    super(FRAG, { uSpin: { value: 0 }, uLight: { value: 0.6 }, uBurn: { value: 0 }, uFlash: { value: 0 }, uR: { value: 0.46 } });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const f = ctx.frame;
    const u = this.u;
    // Spin with the tempo (a little faster in the busy parts), slowing to a stop in silence.
    const rate = f.silence ? 0 : ((f.bpm || 120) / 60) * 0.5 * num(p.spin, 1);
    this.spin += ctx.dt * rate * Math.PI * 2;
    u.uSpin.value = this.spin;
    // The light drifts; the drop swings it right round.
    if (f.drop) this.dropAt = ctx.beat;
    const dd = (ctx.beat - this.dropAt) / ((f.beatsPerBar || 4) * 2);
    const swing = dd >= 0 && dd < 1 ? (1 - Math.cos(Math.PI * dd)) * Math.PI : 0;
    this.light += ctx.dt * 0.12 * num(p.drift, 1) * (ctx.env.energy < 0.18 ? 0.4 : 1);
    u.uLight.value = this.light + swing;
    this.flash = Math.max(ctx.env.kick, this.flash - ctx.dt * 4);
    u.uFlash.value = this.flash * num(p.flash, 1);
    // Burn progress: one band of tracks per phrase, starting over after a full disc.
    const bpp = Math.max(4, f.beatsPerPhrase || 16);
    const phrases = Math.max(2, Math.round(num(p.phrasesToBurn, 12)));
    const prog = ((ctx.beat / bpp) % phrases) / phrases;
    u.uBurn.value = Math.floor(prog * phrases) / phrases + Math.min(1, ((ctx.beat / bpp) % 1) * 1.2) / phrases;
    u.uR.value = 0.46 * num(p.size, 1);
  }
}
