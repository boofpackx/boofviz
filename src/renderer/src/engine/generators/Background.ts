import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uStyle;
uniform float uFrom, uTo, uIntensity, uMotion, uPulse;
void main() {
  vec2 p = vUv;
  float m = uMotion;
  float t;
  if (uStyle == 1) t = length((p - 0.5) * vec2(uRes.x / uRes.y, 1.0)) * 1.3 + 0.08 * sin(uTime * 0.4) * m;
  else if (uStyle == 2) t = (p.x + p.y) * 0.5 + 0.15 * sin(uTime * 0.25 + p.x * 2.0) * m;
  else if (uStyle == 3) t = fbm(p * vec2(uRes.x / uRes.y, 1.0) * 2.5 + vec2(uTime * 0.04, uTime * 0.025) * (0.3 + m * 2.0));
  else t = p.y + 0.06 * sin(uTime * 0.35 + p.x * 3.0) * m;
  vec3 c = mix(palette(uFrom), palette(uTo), smoothstep(0.0, 1.0, t));
  c *= uIntensity * (1.0 + uPulse * (0.6 * uKick + 0.3 * uBass));
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

export class Background extends ShaderGenerator {
  readonly kind = 'background';
  constructor() {
    super(FRAG, { uStyle: { value: 0 }, uFrom: { value: 0 }, uTo: { value: 0.4 }, uIntensity: { value: 0.6 }, uMotion: { value: 0.2 }, uPulse: { value: 0.2 } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uStyle.value = ['vertical', 'radial', 'diagonal', 'noise'].indexOf(String(p.style ?? 'vertical'));
    u.uFrom.value = num(p.from, 0);
    u.uTo.value = num(p.to, 0.4);
    u.uIntensity.value = num(p.intensity, 0.6);
    u.uMotion.value = num(p.motion, 0.2);
    u.uPulse.value = num(p.pulse, 0.2);
  }
}
