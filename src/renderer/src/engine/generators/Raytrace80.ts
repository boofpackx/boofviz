import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * The early-80s raytrace reel: chrome, glass and painted spheres over an
 * endless chequered floor under a graded sky, with true reflections,
 * refraction and hard sun shadows, rendered at a slightly coarse resolution
 * with no anti-aliasing, like the frames that took a night each.
 *
 * The spheres hop in a 1-3-2-4 pattern, each landing (and squashing) on its
 * beat, and fly up together on the drop. The camera cuts to a new angle
 * every phrase, and each new view renders down the screen a line at a time,
 * the beam of the raytracer showing where it has got to.
 *
 * Colours come from the look's palette: stops 2 and 3 the sky (zenith,
 * horizon), stops 4 and 5 the floor checks, the painted spheres the palette.
 */

const MAX = 8;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform vec4 uSph[${MAX}];    // centre xyz, radius
uniform vec4 uMat[${MAX}];    // material (0 chrome, 1 glass, 2 painted), palette t, squash, -
uniform int uN;
uniform vec3 uCam, uTgt, uSun;
uniform float uLines, uReveal, uCheck, uFloorRefl, uFov, uFog;

vec3 sky(vec3 rd) {
  float t = clamp(rd.y * 1.3 + 0.05, 0.0, 1.0);
  vec3 c = mix(uPal[2], uPal[1], pow(t, 0.55));
  float s = max(dot(rd, uSun), 0.0);
  c += vec3(1.0, 0.92, 0.78) * (pow(s, 400.0) * 6.0 + pow(s, 12.0) * 0.12);
  return c;
}

// Ray against an ellipsoid (a sphere squashed on landing). Returns near and far t.
vec2 ell(vec3 ro, vec3 rd, vec4 s, float sq) {
  vec3 R = vec3(s.w / sqrt(sq), s.w * sq, s.w / sqrt(sq));
  vec3 o = (ro - s.xyz) / R, d = rd / R;
  float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
  float h = b * b - a * c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2((-b - h) / a, (-b + h) / a);
}
vec3 ellN(vec3 p, vec4 s, float sq) {
  vec3 R = vec3(s.w / sqrt(sq), s.w * sq, s.w / sqrt(sq));
  return normalize((p - s.xyz) / (R * R));
}

float trace(vec3 ro, vec3 rd, out int id) {
  float best = 1e9;
  id = -1;
  if (rd.y < -1e-4) {
    float t = -ro.y / rd.y;
    if (t > 1e-3) { best = t; id = 100; }
  }
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    vec2 t = ell(ro, rd, uSph[i], uMat[i].z);
    if (t.x > 1e-3 && t.x < best) { best = t.x; id = i; }
  }
  return best;
}

float shadow(vec3 p) {
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    vec2 t = ell(p, uSun, uSph[i], uMat[i].z);
    if (t.x > 1e-3) return uMat[i].x > 0.5 && uMat[i].x < 1.5 ? 0.6 : 0.3;
  }
  return 1.0;
}

vec3 render(vec3 ro, vec3 rd) {
  vec3 col = vec3(0.0), thr = vec3(1.0);
  for (int b = 0; b < 5; b++) {
    int id;
    float t = trace(ro, rd, id);
    if (id < 0) { col += thr * sky(rd); break; }
    vec3 p = ro + rd * t;
    if (id == 100) {
      vec2 q = floor(p.xz / uCheck);
      float ch = mod(q.x + q.y, 2.0);
      vec3 base = mix(uPal[3], uPal[4], ch);
      float diff = max(uSun.y, 0.0) * shadow(p + vec3(0.0, 1e-3, 0.0)) * 0.85 + 0.15;
      float fog = exp(-t * uFog);
      vec3 hz = sky(normalize(vec3(rd.x, 0.0, rd.z)));
      col += thr * mix(hz, base * diff, fog) * (1.0 - uFloorRefl * fog);
      thr *= uFloorRefl * fog;
      ro = p + vec3(0.0, 1e-3, 0.0);
      rd = reflect(rd, vec3(0.0, 1.0, 0.0));
      continue;
    }
    vec4 s = uSph[id];
    vec4 m = uMat[id];
    vec3 n = ellN(p, s, m.z);
    float spec = pow(max(dot(reflect(rd, n), uSun), 0.0), 80.0);
    if (m.x < 0.5) {
      // Chrome, a little tinted.
      col += thr * spec * 3.0;
      thr *= mix(vec3(0.95), paletteWrap(m.y) * 1.4, 0.18);
      ro = p + n * 1e-3;
      rd = reflect(rd, n);
    } else if (m.x < 1.5) {
      // Glass: a Fresnel glint, then through and out the other side.
      float cosi = clamp(-dot(rd, n), 0.0, 1.0);
      float F = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
      col += thr * (F * sky(reflect(rd, n)) + spec * 3.0);
      vec3 r2 = refract(rd, n, 1.0 / 1.5);
      vec2 tt = ell(p - n * 2e-3, r2, s, m.z);
      vec3 p2 = p - n * 2e-3 + r2 * max(tt.y, 0.0);
      vec3 n2 = -ellN(p2, s, m.z);
      vec3 r3 = refract(r2, n2, 1.5);
      if (dot(r3, r3) < 1e-4) r3 = reflect(r2, n2);
      thr *= (1.0 - F) * vec3(0.9, 0.96, 1.0);
      ro = p2 - n2 * 2e-3;
      rd = r3;
    } else {
      // Painted: lit, shadowed, with a sharp highlight and a touch of gloss.
      vec3 c = paletteWrap(m.y);
      float diff = max(dot(n, uSun), 0.0) * shadow(p + n * 1e-3);
      col += thr * (c * (0.18 + 0.82 * diff) + spec * 1.5);
      thr *= 0.12;
      ro = p + n * 1e-3;
      rd = reflect(rd, n);
    }
  }
  return col;
}

void main() {
  // Coarse pixels, no anti-aliasing: one ray per block.
  float cell = max(1.0, floor(uRes.y / uLines));
  vec2 fc = (floor(gl_FragCoord.xy / cell) + 0.5) * cell;
  // A new view renders down the screen; below the beam it is still black.
  float scan = (1.0 - uReveal) * uRes.y;
  if (uReveal < 1.0 && fc.y < scan - cell) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  vec3 fw = normalize(uTgt - uCam);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * uFov + uv.x * rt + uv.y * up);
  vec3 col = render(uCam, rd);
  if (uReveal < 1.0 && fc.y < scan + cell) col += vec3(0.6, 0.9, 1.0) * 1.5;
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

const ORDER = [0, 2, 1, 3];

export class Raytrace80 extends ShaderGenerator {
  readonly kind = 'raytrace80';
  private readonly sph = Array.from({ length: MAX }, () => new THREE.Vector4());
  private readonly mat = Array.from({ length: MAX }, () => new THREE.Vector4());
  private dropAt = -99;

  constructor() {
    super(FRAG, {
      uSph: { value: [] as THREE.Vector4[] },
      uMat: { value: [] as THREE.Vector4[] },
      uN: { value: 5 },
      uCam: { value: new THREE.Vector3(0, 2, 6) },
      uTgt: { value: new THREE.Vector3(0, 0.6, 0) },
      uSun: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      uLines: { value: 270 },
      uReveal: { value: 1 },
      uCheck: { value: 1 },
      uFloorRefl: { value: 0.25 },
      uFov: { value: 1.6 },
      uFog: { value: 0.03 },
    });
    this.u.uSph.value = this.sph;
    this.u.uMat.value = this.mat;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const f = ctx.frame;
    const beat = ctx.beat;
    const bpb = f.beatsPerBar || 4;
    const bpp = Math.max(4, f.beatsPerPhrase || 16) * Math.max(1, Math.round(num(p.cutPhrases, 1)));
    const n = Math.max(1, Math.min(MAX, Math.round(num(p.spheres, 5))));
    u.uN.value = n;
    if (f.drop) this.dropAt = beat;
    // The drop throws every sphere up; they fall back over two bars.
    const dt = (beat - this.dropAt) / (2 * bpb);
    const dropLift = dt >= 0 && dt < 1 ? 4 * dt * (1 - dt) : 0;
    const hop = num(p.hop, 1) * (0.5 + ctx.env.energy * 0.9);
    const layout = String(p.layout ?? 'ring');
    const materials = String(p.materials ?? 'mixed');
    const ringR = n === 1 ? 0 : 1.1 + n * 0.28;
    const b = Math.floor(beat), fr = beat - b;
    for (let k = 0; k < MAX; k++) {
      const r = 0.55 + 0.25 * hash01(k, 7);
      const land = ORDER[k % 4] % bpb;
      // Airborne through the beat before its landing beat; squashed just after landing.
      const airborne = (b + 1) % bpb === land;
      const landed = b % bpb === land && fr < 0.18;
      const h = (airborne ? 4 * fr * (1 - fr) : 0) * hop * 1.6 + dropLift * (1 + hash01(k, 3) * 1.2);
      const sq = landed ? 1 - 0.28 * (1 - fr / 0.18) * Math.min(1, hop) : 1;
      let x: number, z: number;
      if (layout === 'row') {
        x = (k - (n - 1) / 2) * 1.7;
        z = 0;
      } else {
        const a = (k / n) * Math.PI * 2 + beat * 0.01 * num(p.spin, 1);
        x = Math.cos(a) * ringR;
        z = Math.sin(a) * ringR;
      }
      this.sph[k].set(x, r * sq + h, z, r);
      const type = materials === 'chrome' ? 0 : materials === 'glass' ? 1 : materials === 'painted' ? 2 : [0, 1, 0, 2][k % 4];
      this.mat[k].set(type, (k * 0.29 + 0.1) % 1, sq, 0);
    }
    // A new camera angle every phrase, drifting a little within it.
    const phrase = Math.floor(beat / bpp);
    const within = beat - phrase * bpp;
    const ang = hash01(phrase, 11) * Math.PI * 2 + within * 0.015;
    const height = 0.7 + hash01(phrase, 12) * 2.6 - ctx.env.kick * 0.06;
    const dist = (5.5 + hash01(phrase, 13) * 3) * (0.8 + ringR * 0.12);
    (u.uCam.value as THREE.Vector3).set(Math.cos(ang) * dist, height, Math.sin(ang) * dist);
    (u.uTgt.value as THREE.Vector3).set(0, 0.7, 0);
    const reveal = num(p.revealBeats, 1);
    u.uReveal.value = reveal > 0 ? Math.min(1, within / reveal) : 1;
    u.uLines.value = num(p.lines, 270);
    u.uCheck.value = num(p.check, 1);
    u.uFloorRefl.value = num(p.floorShine, 0.25);
    u.uFog.value = num(p.fog, 0.03);
    const sunA = num(p.sun, 0.6);
    (u.uSun.value as THREE.Vector3).set(Math.cos(sunA * 3) * 0.6, 0.45 + sunA * 0.4, Math.sin(sunA * 3) * 0.6).normalize();
  }
}
