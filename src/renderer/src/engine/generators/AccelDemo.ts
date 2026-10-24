import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Accelerator Demo: the demo that showed off a new 3D card around 1999. A
 * bump-mapped planet with coloured lights sweeping across it, a chrome ring
 * orbiting with the room reflected in it, a multi-element lens flare, stars
 * and a little fog, all in 16-bit colour with its banding and ordered dither.
 * The lights sweep on the beat, the ring tilts every bar, the flare blooms on
 * the kick.
 *
 * Colours: stop 1 space, 2 and 3 the lights, 4 the planet, 5 the flare.
 */

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform vec3 uL1, uL2;
uniform float uRingTilt, uRingAng, uFlare, uBits, uSpin;

float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }

float bump(vec3 n) {
  vec2 s = vec2(atan(n.z, n.x) + uSpin, asin(clamp(n.y, -1.0, 1.0)));
  return fbm(s * 3.0) * 0.6 + fbm(s * 9.0) * 0.4;
}

vec3 env(vec3 r) {
  // The room the chrome reflects: a gradient, a bright panel and the lights.
  vec3 c = mix(uPal[0], uPal[3] * 0.4, r.y * 0.5 + 0.5);
  c += uPal[1] * pow(max(dot(r, normalize(uL1)), 0.0), 20.0) * 2.0;
  c += uPal[2] * pow(max(dot(r, normalize(uL2)), 0.0), 20.0) * 2.0;
  c += vec3(1.0) * smoothstep(0.92, 0.97, r.y) * 0.6;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.y, uRes.x * 1.1); // fits the width on tall screens
  vec3 ro = vec3(0.0, 0.3, 4.2);
  vec3 rd = normalize(vec3(uv, -1.4));
  // Stars and a little nebula.
  vec3 col = uPal[0] * 0.4 + uPal[3] * 0.06 * fbm(uv * 3.0 + 7.0);
  vec2 sg = floor(gl_FragCoord.xy / 3.0);
  col += vec3(step(0.997, hash21(sg))) * 0.8;
  float tHit = 1e3;
  // The planet.
  vec3 oc = ro;
  float b = dot(oc, rd), c = dot(oc, oc) - 1.0;
  float h = b * b - c;
  if (h > 0.0) {
    float t = -b - sqrt(h);
    vec3 p = ro + rd * t;
    vec3 n = normalize(p);
    // Bump mapping: tilt the normal by the height field's slope.
    float e = 0.01;
    vec3 tx = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + 1e-4), ty = cross(n, tx);
    float h0 = bump(n), hx = bump(normalize(n + tx * e)), hy = bump(normalize(n + ty * e));
    vec3 bn = normalize(n - (tx * (hx - h0) + ty * (hy - h0)) * 9.0);
    vec3 alb = uPal[3] * (0.6 + h0 * 0.8);
    vec3 lc = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      vec3 L = normalize(i == 0 ? uL1 : uL2);
      vec3 lcol = i == 0 ? uPal[1] : uPal[2];
      float d = max(dot(bn, L), 0.0);
      float s = pow(max(dot(reflect(-L, bn), -rd), 0.0), 40.0);
      lc += lcol * (alb * d * 1.4 + s * 1.2);
    }
    col = lc + alb * 0.04;
    // Atmosphere rim.
    col += uPal[1] * pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * 0.6;
    tHit = t;
  }
  // The chrome ring (raymarched).
  float t = 1.5;
  mat2 ra = rot2(uRingAng), rt = rot2(uRingTilt);
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    vec3 q = p;
    q.yz = rt * q.yz;
    q.xz = ra * q.xz;
    float d = sdTorus(q, vec2(1.6, 0.06));
    if (d < 0.001) {
      if (t < tHit) {
        vec2 eps = vec2(0.001, 0.0);
        vec3 nn = normalize(vec3(
          sdTorus(vec3(q.x + eps.x, q.y, q.z), vec2(1.6, 0.06)) - d,
          sdTorus(vec3(q.x, q.y + eps.x, q.z), vec2(1.6, 0.06)) - d,
          sdTorus(vec3(q.x, q.y, q.z + eps.x), vec2(1.6, 0.06)) - d));
        // Back to world space (inverse of the ring's turns).
        nn.xz = transpose(ra) * nn.xz;
        nn.yz = transpose(rt) * nn.yz;
        col = env(reflect(rd, nn)) * 1.2;
      }
      break;
    }
    t += d;
    if (t > 8.0) break;
  }
  // Multi-element lens flare from the first light.
  vec3 lp = normalize(uL1);
  vec2 fl = lp.xy / max(0.2, -lp.z + 1.4) * 0.8;
  vec2 axis = -fl;
  float fsum = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c2 = fl + axis * (0.35 + fi * 0.33);
    float rr = 0.02 + 0.04 * fract(fi * 0.37);
    fsum += smoothstep(rr, rr * 0.6, length(uv - c2)) * (0.25 - fi * 0.03);
  }
  col += uPal[4] * (fsum + exp(-length(uv - fl) * 18.0) * 1.2) * uFlare;
  // A little fog towards the bottom.
  col = mix(col, uPal[3] * 0.25, smoothstep(0.1, -0.5, uv.y) * 0.25);
  // 16-bit colour: 5-6-5 bits with ordered dither, in display space.
  vec3 s = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 ip = ivec2(gl_FragCoord.xy) % 4;
  float dth = (B[ip.y * 4 + ip.x] + 0.5) / 16.0 - 0.5;
  vec3 lv = vec3(31.0, 63.0, 31.0) * uBits + vec3(255.0) * (1.0 - uBits);
  s = floor(s * lv + 0.5 + dth) / lv;
  fragColor = vec4(fromDisplay(s), 1.0);
}
`;

export class AccelDemo extends ShaderGenerator {
  readonly kind = 'accelDemo';
  private sweep = 0;
  private flare = 0;
  private spin = 0;

  constructor() {
    super(FRAG, { uL1: { value: new THREE.Vector3(1, 0.5, 0.6) }, uL2: { value: new THREE.Vector3(-1, -0.2, 0.5) }, uRingTilt: { value: 0.4 }, uRingAng: { value: 0 }, uFlare: { value: 1 }, uBits: { value: 1 }, uSpin: { value: 0 } });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const f = ctx.frame;
    const u = this.u;
    // The lights sweep a step each beat (eased), opposite ways round.
    const b = Math.floor(ctx.beat), fr = ctx.beat - b;
    this.sweep = (b + (1 - Math.pow(1 - fr, 3))) * 0.35 * num(p.sweep, 1);
    (u.uL1.value as THREE.Vector3).set(Math.cos(this.sweep), 0.45, Math.sin(this.sweep) * 0.8 + 0.4);
    (u.uL2.value as THREE.Vector3).set(Math.cos(-this.sweep * 0.7 + 2.5), -0.25, Math.sin(-this.sweep * 0.7 + 2.5) * 0.8 + 0.3);
    // The ring tilts to a new angle every bar.
    const bar = Math.floor(ctx.beat / (f.beatsPerBar || 4));
    const target = 0.25 + ((bar * 0.37) % 0.6);
    u.uRingTilt.value += (target - (u.uRingTilt.value as number)) * (1 - Math.exp(-ctx.dt * 4));
    u.uRingAng.value = ctx.time * 0.4 * num(p.spin, 1);
    this.spin += ctx.dt * 0.05 * num(p.spin, 1);
    u.uSpin.value = this.spin;
    this.flare = Math.max(ctx.env.kick, this.flare - ctx.dt * 3);
    u.uFlare.value = (0.5 + this.flare) * num(p.flare, 1);
    u.uBits.value = p.bits16 === false ? 0 : 1;
  }
}
