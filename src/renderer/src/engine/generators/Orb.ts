import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uMode;            // 0 black hole, 1 mirror ball
uniform float uSize, uSpin, uTilt, uBeams;

vec3 stars(vec2 q) {
  vec2 id = floor(q * 60.0);
  float s = step(0.993, hash21(id)) * hash21(id + 2.0);
  return vec3(s);
}

vec3 blackHole(vec2 p) {
  float rs = uSize * 0.35;
  float r = length(p);
  // Gravitational lensing bends the background toward the hole.
  vec2 lensed = p * (1.0 + rs * rs * 1.6 / max(r * r, 1e-4));
  vec3 col = stars(lensed + vec2(uTime * 0.002, 0.0)) * 0.8;
  float tilt = 0.18 + 0.5 * uTilt;
  float rot = uTime * uSpin * (0.4 + uEnergy);
  // Direct image of the disk (a thin, tilted ellipse).
  vec2 dp = vec2(p.x, p.y / tilt);
  float dr = length(dp);
  float disk = smoothstep(rs * 1.5, rs * 1.9, dr) * (1.0 - smoothstep(rs * 3.6, rs * 4.6, dr));
  float ang = atan(dp.y, dp.x);
  float swirl = fbm(vec2(ang * 3.0 + rot + 4.0 / max(dr, 0.05), dr * 8.0));
  float doppler = 0.55 + 0.45 * cos(ang);            // approaching side is brighter
  vec3 hot = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.93, 0.8), doppler);
  float front = step(0.0, -p.y) + step(rs * 1.05, r);     // the part behind the shadow is hidden
  col += hot * disk * (0.4 + 1.4 * swirl) * (0.5 + 1.2 * doppler) * (0.7 + 0.8 * uBass) * min(front, 1.0);
  // Lensed image of the far side: a halo arching over and under the shadow.
  float halo = exp(-pow((r - rs * 1.55) / (rs * 0.22), 2.0));
  col += hot * halo * (0.5 + 0.8 * fbm(vec2(atan(p.y, p.x) * 4.0 - rot, 3.0))) * (0.8 + 0.6 * uBass);
  // Photon ring and the shadow.
  col += vec3(1.0, 0.9, 0.75) * exp(-abs(r - rs * 1.05) * 300.0) * (1.0 + uKick);
  col *= smoothstep(rs * 0.98, rs * 1.03, r);
  return col;
}

vec3 mirrorBall(vec2 p) {
  float R = uSize * 0.42 * (1.0 + 0.02 * uKick);
  vec3 col = vec3(0.0);
  // Reflected light spots sweeping round the room.
  for (int i = 0; i < 40; i++) {
    float fi = float(i);
    float a = fi * 2.399 + uTime * uSpin * 0.6;
    float rr = 0.25 + 0.6 * hash11(fi * 3.7);
    vec2 sp = vec2(cos(a) * rr * 1.7, sin(fi * 1.3) * 0.45 + 0.05 * sin(uTime + fi));
    float d = length(p - sp);
    col += palette(0.3 + 0.7 * hash11(fi)) * exp(-d * d * 4000.0) * (0.4 + 1.6 * uHat + uKick);
  }
  // Beams from the ball.
  float ang = atan(p.y, p.x);
  float beams = pow(max(0.0, sin(ang * 6.0 + uTime * uSpin)), 40.0) * uBeams;
  col += palette(0.8) * beams * 0.15 * smoothstep(R, R * 3.0, length(p)) * (0.5 + uBass);
  float r = length(p);
  if (r < R) {
    vec3 n = vec3(p / R, sqrt(max(0.0, 1.0 - r * r / (R * R))));
    float lon = atan(n.x, n.z) + uTime * uSpin * 0.5;
    float lat = asin(n.y);
    vec2 tile = vec2(floor(lon * 12.0 / 3.14159), floor(lat * 12.0 / 3.14159));
    vec2 tf = fract(vec2(lon * 12.0 / 3.14159, lat * 12.0 / 3.14159));
    float h = hash21(tile);
    float spec = pow(max(0.0, sin(h * 40.0 + uTime * 3.0 * uSpin)), 18.0);
    float grout = smoothstep(0.0, 0.08, min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y)));
    vec3 tileCol = mix(vec3(0.25), vec3(0.85), h) * (0.3 + 0.7 * n.z);
    col = tileCol * grout + vec3(1.0) * spec * grout * (1.5 + 2.0 * uHat);
    col += palette(0.7) * pow(1.0 - n.z, 3.0) * 0.4;
  }
  return col;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uMode == 0 ? blackHole(p) : mirrorBall(p);
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** A black hole with a lensed accretion disk, or a mirror ball throwing light around the room. */
export class Orb extends ShaderGenerator {
  readonly kind = 'orb';
  constructor() {
    super(FRAG, { uMode: { value: 0 }, uSize: { value: 1 }, uSpin: { value: 1 }, uTilt: { value: 0.3 }, uBeams: { value: 1 } });
  }
  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uMode.value = p.mode === 'mirrorball' ? 1 : 0;
    u.uSize.value = num(p.size, 1);
    u.uSpin.value = num(p.spin, 1);
    u.uTilt.value = num(p.tilt, 0.3);
    u.uBeams.value = num(p.beams, 1);
  }
}
