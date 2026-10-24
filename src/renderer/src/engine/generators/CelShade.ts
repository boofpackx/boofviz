import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Cel-Shade: the cel-shaded console look of 2000-2003. Blobby 3D forms that
 * merge and part, rendered like a cartoon: two flat tones and a hard
 * highlight, thick constant ink outlines, a halftone sky behind. The forms
 * squash and stretch on the kick, speed lines streak in through the build,
 * and ink splats burst on the drop.
 *
 * Drawn in display colours. Colours: stop 1 the sky, 2-4 the forms, 5 the
 * halftone dots.
 */

const BLOBS = 5;

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform vec4 uB[${BLOBS}];   // centre, radius
uniform float uSquash, uSpeed, uSplat, uSplatSeed, uOutline;
uniform vec3 uCamPos;

vec3 toS(vec3 lin) { return pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2)); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// The field and which blob is nearest (for its colour).
vec2 map(vec3 p) {
  float d = 1e3, id = 0.0, best = 1e3;
  for (int i = 0; i < ${BLOBS}; i++) {
    vec3 q = p - uB[i].xyz;
    q.y /= uSquash;
    float s = length(q) - uB[i].w;
    if (s < best) { best = s; id = float(i); }
    d = smin(d, s, 0.45);
  }
  // A ring swooping through them.
  vec3 r = p;
  r.xy = rot2(uTime * 0.3) * r.xy;
  float ring = length(vec2(length(r.xz) - 1.6, r.y)) - 0.12;
  if (ring < d) id = 5.0;
  d = min(d, ring);
  return vec2(d, id);
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = uCamPos;
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.6 + uv.x * rt + uv.y * up);
  // Halftone sky: dots growing towards the bottom.
  vec3 sky = toS(uPal[0]);
  vec2 hp = gl_FragCoord.xy / (uRes.y * 0.018);
  vec2 hc = fract(rot2(0.6) * hp) - 0.5;
  float dotR = mix(0.05, 0.42, smoothstep(0.6, -0.5, uv.y));
  vec3 col = mix(sky, toS(uPal[4]), smoothstep(dotR, dotR - 0.06, length(hc)) * 0.55);
  // Speed lines through the build.
  if (uSpeed > 0.01) {
    float a = atan(uv.y, uv.x);
    float lines = step(0.985, hash11(floor(a * 90.0) + floor(uTime * 8.0)));
    col = mix(col, vec3(1.0), lines * smoothstep(0.15, 0.6, length(uv)) * uSpeed);
  }
  // March, tracking how close the ray came (for the outline).
  float t = 0.0, minD = 1e3;
  vec2 h = vec2(1e3, 0.0);
  for (int i = 0; i < 80; i++) {
    h = map(ro + rd * t);
    minD = min(minD, h.x / max(t, 0.5));
    if (h.x < 0.001 || t > 20.0) break;
    t += h.x * 0.9;
  }
  float px = 1.0 / uRes.y;
  float ink = uOutline * px * 2.4;
  if (h.x < 0.001) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    vec3 l = normalize(vec3(-0.5, 0.8, 0.4));
    float diff = dot(n, l);
    int id = int(h.y + 0.5);
    vec3 base = id == 5 ? toS(uPal[4]) : toS(uPal[1 + id % 3]);
    // Two flat tones and a hard highlight.
    vec3 c = diff > 0.15 ? base : base * 0.55;
    float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 30.0);
    c = mix(c, vec3(1.0), step(0.6, spec));
    // Ink where the surface turns away (the inner outline).
    float rim = 1.0 - abs(dot(n, -rd));
    c = mix(c, vec3(0.03), step(0.82, rim));
    col = c;
  } else if (minD < ink) {
    // The outer outline: rays that only just missed.
    col = vec3(0.03);
  }
  // Ink splats on the drop.
  if (uSplat > 0.01) {
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 c = vec2(hash11(uSplatSeed + fi) - 0.5, hash11(uSplatSeed + fi + 7.0) - 0.5) * vec2(1.4, 0.8);
      vec2 q = uv - c;
      float a = atan(q.y, q.x);
      float r = 0.08 + 0.05 * sin(a * 7.0 + fi) + 0.03 * sin(a * 13.0);
      float s = smoothstep(r * uSplat * 1.6, r * uSplat * 1.6 - px * 2.0, length(q));
      col = mix(col, i % 2 == 0 ? vec3(0.03) : toS(uPal[1 + i % 3]), s * 0.95);
    }
  }
  fragColor = vec4(fromDisplay(col), 1.0);
}
`;

export class CelShade extends ShaderGenerator {
  readonly kind = 'celShade';
  private readonly blobs = Array.from({ length: BLOBS }, () => new THREE.Vector4());
  private dropAt = -99;
  private squash = 1;
  private sqv = 0;

  constructor() {
    super(FRAG, { uB: { value: [] as THREE.Vector4[] }, uSquash: { value: 1 }, uSpeed: { value: 0 }, uSplat: { value: 0 }, uSplatSeed: { value: 0 }, uOutline: { value: 1 }, uCamPos: { value: new THREE.Vector3(0, 1, 6) } });
    this.u.uB.value = this.blobs;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const f = ctx.frame;
    const u = this.u;
    const t = ctx.time * num(p.speed, 1);
    for (let i = 0; i < BLOBS; i++) {
      const a = t * (0.4 + i * 0.13) + i * 1.3;
      const r = 1.0 + 0.5 * Math.sin(t * 0.3 + i);
      const bob = Math.abs(Math.sin(ctx.beat * Math.PI * 0.5 + i * 0.7)) * 0.4;
      this.blobs[i].set(Math.cos(a) * r, Math.sin(t * 0.5 + i * 2.1) * 0.6 + bob - 0.2, Math.sin(a) * r, 0.45 + 0.2 * hash01(i, 3) + ctx.env.bass * 0.1);
    }
    // Squash and stretch on the kick.
    if (f.onsets.kick) this.sqv -= 6 * num(p.squash, 1);
    this.sqv += ((1 - this.squash) * 160 - this.sqv * 10) * Math.min(0.05, ctx.dt);
    this.squash = Math.min(1.4, Math.max(0.6, this.squash + this.sqv * Math.min(0.05, ctx.dt)));
    u.uSquash.value = this.squash;
    u.uSpeed.value = f.energyTrend === 'building' ? Math.min(1, ctx.env.energy * 1.4) : 0;
    if (f.drop) this.dropAt = ctx.beat;
    const dd = (ctx.beat - this.dropAt) / ((f.beatsPerBar || 4) * 1);
    u.uSplat.value = dd >= 0 && dd < 1 ? Math.min(1, dd * 6) * (1 - Math.max(0, dd - 0.6) / 0.4) : 0;
    u.uSplatSeed.value = Math.floor(this.dropAt * 10);
    u.uOutline.value = num(p.outline, 1);
    const ang = ctx.time * 0.15 * num(p.orbit, 1);
    (u.uCamPos.value as THREE.Vector3).set(Math.sin(ang) * 6, 1.2 + Math.sin(ctx.time * 0.2) * 0.6, Math.cos(ang) * 6);
  }
}
