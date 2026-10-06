import * as THREE from 'three';
import { hdrTarget } from '../fx/effects';
import { hash01 } from '../modulation';
import { FULLSCREEN_VERT, GEN_HEADER } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import type { CompileTarget, GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/** Spheres in the field: 1 main body + up to 7 satellites + up to 4 orbiting droplets. */
const MAXS = 12;

const FRAG = /* glsl */ `${GEN_HEADER}
#define MAXS ${MAXS}
const float FLOOR_Y = -1.0;
const float FOCAL = 1.75;
uniform vec4 uS[MAXS];          // xyz centre, w radius
uniform int uCount, uSteps;
uniform float uK, uJelly, uPad, uRipple, uRippleY;
uniform vec3 uCenter, uCamPos, uCamTarget;
uniform float uYaw, uIrid, uHolo, uFilmShift, uRoom, uGridGlow, uMirror, uStar, uStarRot, uTemp;

vec3 gKey;

// World → cluster-local (undo the cluster's yaw) in the xz plane.
vec2 toLocal(vec2 w) { float c = cos(uYaw), s = sin(uYaw); return vec2(w.x * c - w.y * s, w.x * s + w.y * c); }

// ---- SDF: polynomial smooth-min union of spheres, kick squash, snare ripple ----
float map(vec3 p) {
  vec3 q = p - uCenter;
  float sy = 1.0 + uJelly, sx = 1.0 - 0.5 * uJelly;
  vec3 pp = uCenter + q / vec3(sx, sy, sx);
  float d = 1e3;
  for (int i = 0; i < MAXS; i++) {
    if (i >= uCount) break;
    float di = length(pp - uS[i].xyz) - uS[i].w;
    float h = max(uK - abs(d - di), 0.0) / uK;
    d = min(d, di) - h * h * uK * 0.25;
  }
  d *= min(sx, sy);
  float y = p.y - uRippleY;
  d -= uRipple * exp(-y * y * 9.0) * sin(y * 24.0);
  return d;
}

// Entry/exit of the ray through the union of padded spheres (the bounding volume).
vec2 bounds(vec3 ro, vec3 rd) {
  float tn = 1e9, tf = -1e9;
  for (int i = 0; i < MAXS; i++) {
    if (i >= uCount) break;
    vec3 oc = ro - uS[i].xyz;
    float r = uS[i].w + uPad;
    float b = dot(oc, rd);
    float h = b * b - dot(oc, oc) + r * r;
    if (h > 0.0) { h = sqrt(h); tn = min(tn, -b - h); tf = max(tf, -b + h); }
  }
  return vec2(max(tn, 0.0), tf);
}

// Sphere tracing with a pixel cone: returns (t, coverage). Near misses give soft, anti-aliased edges.
vec2 march(vec3 ro, vec3 rd, vec2 b, int steps, float cone0, float pxA) {
  float t = b.x, best = 1e9, tb = b.x;
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float d = map(ro + rd * t);
    float cone = cone0 + pxA * t;
    if (d < cone * 0.5) return vec2(t, 1.0);
    float ratio = d / cone;
    if (ratio < best) { best = ratio; tb = t; }
    t += d * 0.85;
    if (t > b.y) break;
  }
  return vec2(tb, 1.0 - smoothstep(0.5, 1.6, best));
}

vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0015;
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

float calcAO(vec3 p, vec3 n) {
  float o = 0.0, w = 1.0;
  for (int i = 0; i < 3; i++) {
    float h = 0.06 + 0.13 * float(i);
    o += (h - map(p + n * h)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 1.7 * o, 0.0, 1.0);
}

// ---- Thin-film interference (wavelength based) ----
vec3 thinFilm(float cosi, float thick) {
  const float n = 1.38;
  float sint = sqrt(max(0.0, 1.0 - cosi * cosi)) / n;
  float cost = sqrt(max(0.0, 1.0 - sint * sint));
  vec3 ph = 12.566 * n * thick * cost / vec3(650.0, 532.0, 450.0);
  return 0.12 + 0.98 * (0.5 + 0.5 * cos(ph));
}

// ---- Procedural studio environment ----
float softbox(vec3 rd, vec3 dir, vec3 rt, vec2 size, float soft) {
  float c = dot(rd, dir);
  if (c < 0.05) return 0.0;
  vec3 up = cross(dir, rt);
  vec2 q = vec2(dot(rd, rt), dot(rd, up)) / c;
  vec2 e = abs(q) - size;
  float d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  return (1.0 - smoothstep(-soft, soft, d)) * (0.85 + 0.15 * (1.0 - clamp(length(q / size) * 0.7, 0.0, 1.0)));
}

// The cyclorama gradient alone (also used as the haze colour).
vec3 wall(vec3 rd) {
  float y = rd.y;
  vec3 light = mix(mix(uPal[4], uPal[3], 0.3), uPal[2], smoothstep(0.0, 0.32, y));
  light = mix(light, uPal[3], smoothstep(0.28, 0.9, y)) * 0.85;
  vec3 dark = mix(uPal[1] * 0.14, uPal[0] * 0.35, smoothstep(0.0, 0.5, y));
  vec3 c = mix(dark, light, uRoom);
  // The camera side of the studio is darker so the chrome has something to contrast against.
  float back = smoothstep(-0.15, 0.75, rd.z);
  vec3 backCol = mix(uPal[0] * 0.12, mix(uPal[1], uPal[0], 0.35) * 0.5, uRoom);
  return mix(c, backCol, back) * gKey;
}

// Cyclorama plus a pool of light on the backdrop behind the cluster (also the haze colour).
vec3 backdrop(vec3 rd) {
  float yy = rd.y - 0.06;
  return wall(rd) + mix(palette(0.6) * 0.22, uPal[4] * 0.28, uRoom) * gKey * exp(-(rd.x * rd.x * 5.0 + yy * yy * 14.0)) * max(-rd.z, 0.0);
}

vec3 sky(vec3 rd) {
  vec3 c = backdrop(rd);
  // Softboxes: a big overhead, two vertical strips and a thin rim bar behind.
  vec3 lt = mix(uPal[2] * 1.4, vec3(1.0), 0.15 + 0.7 * uRoom);
  vec3 rtc = mix(uPal[3] * 1.4, vec3(1.0), 0.15 + 0.7 * uRoom);
  c += gKey * 4.5 * softbox(rd, vec3(0.0, 0.958, -0.287), vec3(1.0, 0.0, 0.0), vec2(0.62, 0.4), 0.05);
  c += lt * 6.0 * softbox(rd, vec3(-0.958, 0.242, 0.151), vec3(0.155, 0.0, 0.988), vec2(0.09, 0.8), 0.03);
  c += rtc * 3.8 * softbox(rd, vec3(0.938, 0.094, -0.333), vec3(-0.335, 0.0, -0.942), vec2(0.07, 0.62), 0.03);
  c += gKey * 3.0 * softbox(rd, vec3(-0.3, 0.55, -0.78), vec3(0.933, 0.0, -0.359), vec2(0.3, 0.05), 0.02);
  // A slowly turning starburst behind the camera, only ever seen mirrored in the metal.
  vec3 S = vec3(0.0, 0.119, 0.993);
  float cs = dot(rd, S);
  if (cs > 0.0 && uStar > 0.0) {
    vec3 q = rd - S * cs;
    float ang = atan(q.y, q.x) + uStarRot;
    float rad = length(q) / cs;
    float rays = pow(abs(cos(ang * 6.0)), 60.0) + 0.5 * pow(abs(cos(ang * 6.0 + 1.5708)), 120.0);
    float star = rays * exp(-rad * 1.6) + exp(-rad * rad * 40.0) * 1.5;
    c += uStar * star * mix(palette(0.75), uPal[4], 0.45) * 1.6;
  }
  return c;
}

float floorAO(vec3 P) {
  float o = 0.0;
  for (int i = 0; i < MAXS; i++) {
    if (i >= uCount) break;
    vec3 d = uS[i].xyz - P;
    float l = length(d);
    o += uS[i].w * uS[i].w * d.y / (l * l * l);
  }
  return clamp(1.0 - 1.15 * o, 0.12, 1.0);
}

// Floor diffuse + silver cyber-grid (fp = pixel footprint in world units).
vec3 floorCol(vec3 P, float fp) {
  vec2 g = toLocal(P.xz) * 1.6;
  vec2 dl = 0.5 - abs(fract(g) - 0.5);          // distance to the nearest line, in cells
  float w = fp * 1.6;
  const float lw = 0.013;
  vec2 l = 1.0 - smoothstep(lw - w * 0.5, lw + w * 0.5, dl);
  float line = max(l.x, l.y) * min(1.0, 2.5 * lw / (lw + w));
  vec3 base = mix(uPal[0] * 0.16, mix(uPal[2], uPal[4], 0.4) * 0.38, uRoom);
  vec2 dc = P.xz - uCenter.xz;
  base *= (0.5 + 0.8 * exp(-dot(dc, dc) * 0.12)) * gKey;
  vec3 silver = mix(palette(0.62) * 1.5, mix(uPal[2], uPal[4], 0.7) * 1.0, uRoom);
  vec3 rainbow = 0.55 + 0.45 * cos(6.2832 * (g.x * 0.05 + g.y * 0.07 + uTime * 0.25 + vec3(0.0, 0.33, 0.67)));
  vec3 lineCol = mix(silver, rainbow * 2.4, uHolo) * uGridGlow;
  return (base + lineCol * line) * floorAO(P);
}

// Distance haze; the floor also curves seamlessly into the backdrop near the horizon (an infinite cyc).
vec3 haze(vec3 c, vec3 rd, float t) {
  float hz = max(1.0 - exp(-max(t - 2.0, 0.0) * 0.075), smoothstep(-0.13, 0.0, rd.y));
  return mix(c, backdrop(normalize(vec3(rd.x, 0.0, rd.z))), hz);
}

vec3 env(vec3 ro, vec3 rd) {
  if (rd.y < -0.001) {
    float t = (FLOOR_Y - ro.y) / rd.y;
    if (t > 0.0) return haze(floorCol(ro + rd * t, 0.05 + t * 0.07), rd, t);
  }
  return sky(rd);
}

// Liquid mercury: perfect mirror with Schlick Fresnel and a thin-film rainbow at grazing angles.
vec3 chrome(vec3 p, vec3 rd, bool full) {
  vec3 n = calcNormal(p);
  vec3 r = reflect(rd, n);
  float cosi = clamp(dot(n, -rd), 0.0, 1.0);
  vec3 e = env(p + n * 0.01, r);
  float fr = pow(1.0 - cosi, 5.0);
  vec3 F0 = vec3(0.8, 0.82, 0.86);
  vec3 F = F0 + (1.0 - F0) * fr;
  vec3 q = p - uCenter;
  q.xz = toLocal(q.xz);
  float field = sin(q.x * 2.3 + q.y * 1.3 + uTime * 0.35) * sin(q.y * 2.7 - q.z * 1.1 - uTime * 0.27);
  float thick = 320.0 + 170.0 * field + uFilmShift + uHolo * 260.0 * q.y;
  vec3 film = thinFilm(cosi, thick);
  float w = clamp(uIrid * smoothstep(0.35, 0.95, 1.0 - cosi) + uHolo, 0.0, 1.0);
  vec3 refl = mix(F, film * (1.0 + 0.15 * uHolo), w);
  float ao = full ? calcAO(p, n) : 1.0;
  return e * refl * (0.25 + 0.75 * ao);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  // Key-light colour: drifts between the cool and warm palette stops per phrase.
  vec3 key = mix(uPal[2], uPal[3], 0.5 + 0.5 * uTemp);
  gKey = mix(vec3(1.0), key / max(luma(key), 1e-3), 0.3);

  vec3 ro = uCamPos;
  vec3 F = normalize(uCamTarget - ro);
  vec3 R = normalize(cross(F, vec3(0.0, 1.0, 0.0)));
  vec3 U = cross(R, F);
  vec3 rd = normalize(p.x * R + p.y * U + FOCAL * F);
  float pxA = 1.0 / (uRes.y * FOCAL);

  vec3 col;
  float tFloor = rd.y < 0.0 ? (FLOOR_Y - ro.y) / rd.y : 1e9;
  if (tFloor < 1e8) {
    vec3 P = ro + rd * tFloor;
    col = floorCol(P, pxA * tFloor * mix(1.0, 1.0 / max(-rd.y, 0.04), 0.5));
    if (uMirror > 0.0) {
      // Mirror floor: a second, shorter march of the reflected ray, only where it can reach a blob.
      vec3 rr = vec3(rd.x, -rd.y, rd.z);
      vec3 refl = sky(rr);
      vec2 b = bounds(P, rr);
      if (b.y > b.x) {
        vec2 m = march(P, rr, b, uSteps / 2, pxA * tFloor, pxA);
        if (m.y > 0.0) refl = mix(refl, chrome(P + rr * m.x, rr, false), m.y);
      }
      col = mix(col, refl, uMirror * (0.3 + 0.55 * pow(1.0 + rd.y, 6.0)));
    }
    col = haze(col, rd, tFloor);
  } else {
    col = sky(rd);
  }

  vec2 b = bounds(ro, rd);
  b.y = min(b.y, tFloor);
  if (b.y > b.x) {
    vec2 m = march(ro, rd, b, uSteps, 0.0, pxA);
    if (m.y > 0.0) col = mix(col, chrome(ro + rd * m.x, rd, true), m.y);
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

const BLIT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(tSrc, vUv); }
`;

const COUNTS = [3, 5, 8];
/** Key-light temperature per phrase (−1 cool … +1 warm). */
const TEMPS = [0, 0.85, -0.7, 0.45];
const TAU = Math.PI * 2;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeOut3 = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn3 = (x: number): number => Math.pow(clamp01(x), 3);
const mod = (x: number, m: number): number => ((x % m) + m) % m;
/** Damped spring 0 → 1 with ~13% overshoot, settled after about one beat. */
const spring = (x: number): number => (x <= 0 ? 0 : 1 - Math.exp(-5 * x) * Math.cos(7 * x));

/**
 * Liquid chrome: raymarched mercury metaballs in a pale studio. Every blob
 * position is a closed-form function of the beat: the cluster coalesces into
 * one sphere by the last beat of the cycle and bursts on the downbeat into
 * 3 → 5 → 8 blobs, the formation changes per phrase (cluster → ring → stack),
 * droplets pinch off every second beat and orbit one step per beat, and a drop
 * turns the chrome into thin-film rainbow foil.
 */
export class LiquidChrome extends ShaderGenerator {
  readonly kind = 'liquidChrome';
  private readonly blit: FullscreenPass;
  private readonly blitU: { tSrc: THREE.IUniform };
  private rt: THREE.WebGLRenderTarget | null = null;
  private scale = 1;

  constructor() {
    super(FRAG, {
      uS: { value: Array.from({ length: MAXS }, () => new THREE.Vector4()) },
      uCount: { value: 1 },
      uSteps: { value: 84 },
      uK: { value: 0.3 },
      uJelly: { value: 0 },
      uPad: { value: 0.1 },
      uRipple: { value: 0 },
      uRippleY: { value: 0 },
      uCenter: { value: new THREE.Vector3(0, 0.2, 0) },
      uCamPos: { value: new THREE.Vector3(0, 0.15, 6.2) },
      uCamTarget: { value: new THREE.Vector3(0, -0.1, 0) },
      uYaw: { value: 0 },
      uIrid: { value: 0.6 },
      uHolo: { value: 0 },
      uFilmShift: { value: 0 },
      uRoom: { value: 1 },
      uGridGlow: { value: 0.7 },
      uMirror: { value: 0.6 },
      uStar: { value: 0.6 },
      uStarRot: { value: 0 },
      uTemp: { value: 0 },
    });
    this.blitU = { tSrc: { value: null } };
    this.blit = new FullscreenPass(
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: BLIT_FRAG, uniforms: this.blitU, depthTest: false, depthWrite: false }),
    );
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const f = ctx.frame;
    const env = ctx.env;
    const u = this.u;
    const beat = ctx.beat;
    const time = ctx.time;
    const B = Math.max(1, Math.round(f.beatsPerBar) || 4);
    const P = Math.max(B, Math.round(f.beatsPerPhrase) || 16);
    const size = num(p.size, 1);
    const R0 = 0.78 * size;

    // Coalesce / burst cycle.
    const L = B * Math.min(4, Math.max(1, Math.round(num(p.cycleBars, 1))));
    const cyc = Math.floor(beat / L);
    const bb = beat - cyc * L;
    const c0 = L - Math.min(2.2, L * 0.55);
    const c1 = L - 0.4;
    const pull = smooth((bb - c0) / (c1 - c0));
    const cycPhrase = Math.floor((cyc * L) / P);
    const form = p.formation === 'cluster' ? 0 : p.formation === 'ring' ? 1 : p.formation === 'stack' ? 2 : mod(cycPhrase, 3);
    const n = p.count === '3' ? 3 : p.count === '5' ? 5 : p.count === '8' ? 8 : COUNTS[mod(cyc, 3)];
    const M = n - 1;
    const yaw = (TAU * num(p.spin, 0.15) * beat) / (4 * B);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const C = u.uCenter.value as THREE.Vector3;
    C.set(0, 0.2 + 0.04 * Math.sin(time * 0.5), 0);
    const S = u.uS.value as THREE.Vector4[];
    const put = (k: number, x: number, y: number, z: number, r: number): void => {
      S[k].set(C.x + x * cy + z * sy, C.y + y, C.z - x * sy + z * cy, r);
    };

    // Kick: +6% pulse and a damped-sine jelly squash started on the beat grid.
    const ph = beat - Math.floor(beat);
    const amp = num(p.punch, 1) * clamp01(0.3 + 1.2 * env.energy);
    const pulse = 1 + 0.06 * amp * Math.exp(-5 * ph);
    const jelly = -0.08 * amp * Math.exp(-3.2 * ph) * Math.cos(TAU * 1.9 * ph);

    // Main body.
    const s0 = spring(bb) * (1 - pull);
    const Rm = R0 * (1 - 0.28 * clamp01(s0));
    // Stack: the whole column (body included) spans from just above the floor to the top of frame.
    const mi = Math.floor(M / 2);
    const stackLo = Math.max(-0.82 * size, -0.78);
    const stackStep = (0.95 * size - stackLo) / Math.max(1, M);
    // Beads zigzag left/right so neighbours neck instead of fusing into one column.
    const stackX = (idx: number): number => (idx % 2 === 0 ? -1 : 1) * 0.28 * size;
    const stackY = (idx: number): number => stackLo + idx * stackStep;
    put(0, form === 2 ? stackX(mi) * s0 : 0, form === 2 ? stackY(mi) * s0 : 0, 0, Rm * pulse);

    // Satellites burst out of the body into the formation, then get pulled back in.
    const rsFull = R0 * 0.5 * Math.cbrt(2 / Math.max(1, M));
    const gap = 0.18 * R0;
    const tilt = (hash01(cyc, 11) - 0.5) * 0.8;
    const spinSeed = hash01(cyc, 23) * TAU;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    for (let j = 1; j <= M; j++) {
      const sj = spring(bb - j * 0.035) * (1 - pull);
      const rFull = form === 2 ? rsFull * 0.85 : rsFull;
      const r = R0 * 0.15 + (rFull - R0 * 0.15) * smooth(sj / 0.5);
      let x = 0;
      let y = 0;
      let z = 0;
      if (form === 0) {
        // Cluster: Fibonacci shell around the body, re-tilted per cycle.
        const yy = 1 - (2 * (j - 0.5)) / M;
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        const a = j * 2.39996 + spinSeed;
        const D = Rm + rsFull + gap;
        const lx = rr * Math.cos(a);
        const ly = yy * 0.85;
        const lz = rr * Math.sin(a);
        x = lx * D;
        y = (ly * ct - lz * st) * D;
        z = (ly * st + lz * ct) * D;
      } else if (form === 1) {
        // Ring: a tilted halo around the body.
        const a = (TAU * (j - 1)) / M + spinSeed;
        const D = Rm + rsFull + gap * 1.8 + (M > 4 ? 0.12 : 0);
        x = Math.cos(a) * D;
        const lz = Math.sin(a) * D;
        const ly = 0.08 * Math.sin(a * 2 + time);
        y = ly * Math.cos(0.32) - lz * Math.sin(0.32);
        z = ly * Math.sin(0.32) + lz * Math.cos(0.32);
      } else {
        // Stack: a gooey vertical column with a slow helical sway.
        const idx = j - 1 < mi ? j - 1 : j;
        y = stackY(idx);
        x = stackX(idx) + 0.08 * size * Math.sin(idx * 1.9 + time * 0.8);
        z = 0.12 * size * Math.cos(idx * 1.9 + time * 0.8);
      }
      // A little drift while spread.
      x += 0.05 * R0 * Math.sin(time * 0.9 + j * 1.7);
      y += 0.05 * R0 * Math.sin(time * 1.1 + j * 2.3);
      z += 0.05 * R0 * Math.cos(time * 0.8 + j * 1.3);
      put(j, x * sj, y * sj, z * sj, r);
    }

    // Droplets: one pinches off every second beat, orbits one step per beat, falls back in.
    const Dn = Math.min(4, Math.max(0, Math.round(num(p.droplets, 4))));
    const life = 2 * Math.max(Dn, 2);
    const Ro = 1.85 * size;
    const stepB = Math.floor(beat) + easeOut3(ph * 2);
    let count = n;
    for (let m = 0; m < Dn; m++) {
      const a = mod(beat - 2 * m, life);
      const rho = a < 1 ? easeOut3(a) : a > life - 1 ? 1 - easeIn3(a - (life - 1)) : 1;
      const th = (TAU * m) / Dn + (stepB * TAU) / P;
      put(count++, Math.cos(th) * Ro * rho, 0.22 * size * Math.sin(th * 2 + m * 1.7) * rho, Math.sin(th) * Ro * rho, 0.12 * size * (0.6 + 0.4 * rho));
    }
    u.uCount.value = count;

    // Build: stickier necks. Snare: a ripple band running down the surface.
    const build = f.energyTrend === 'building' ? smooth(f.phrasePhase) : 0;
    const k = Math.max(0.02, num(p.goo, 0.34) * size * (1 + 0.8 * build));
    u.uK.value = k;
    u.uJelly.value = jelly;
    const ripple = num(p.ripple, 1) * 0.009 * size * clamp01(env.snare);
    u.uRipple.value = ripple;
    u.uRippleY.value = C.y + R0 * 1.3 - easeOut3(ph * 1.4) * R0 * 2.8;
    u.uPad.value = k * 0.25 + Math.abs(jelly) * (Ro + 0.3) + ripple + 0.02;
    u.uYaw.value = yaw;

    // Drop: rainbow foil for ~2 bars as the drop envelope decays; the thickness sweep rides the decay.
    const holo = num(p.holo, 1) * smooth((env.drop - 0.22) / 0.48);
    u.uHolo.value = holo;
    u.uFilmShift.value = 650 * env.drop;
    u.uIrid.value = num(p.iridescence, 0.6);
    u.uGridGlow.value = num(p.grid, 0.7) * (1 + 2.5 * holo);
    u.uRoom.value = num(p.room, 1);
    u.uMirror.value = num(p.mirror, 0.6);
    u.uStar.value = num(p.starburst, 0.6);

    // Phrase: the studio's colour temperature shifts; the starburst steps round on the bar.
    const phrase = Math.floor(beat / P);
    u.uTemp.value = TEMPS[mod(phrase - 1, 4)] + (TEMPS[mod(phrase, 4)] - TEMPS[mod(phrase - 1, 4)]) * smooth((beat - phrase * P) / 2);
    const bar = Math.floor(beat / B);
    u.uStarRot.value = 0.1 * (bar + smooth(((beat - bar * B) / B) * 2)) + time * 0.01;

    (u.uCamPos.value as THREE.Vector3).set(0.18 * Math.sin(time * 0.09), 0.15 + 0.06 * Math.sin(time * 0.13), 6.2);
    (u.uCamTarget.value as THREE.Vector3).set(0.06 * Math.sin(time * 0.07), -0.1, 0);

    const q = p.quality;
    u.uSteps.value = q === 'low' ? 40 : q === 'medium' ? 60 : 84;
    this.scale = q === 'low' ? 0.75 : 1;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    if (this.scale >= 0.999) {
      super.render(renderer, target);
      return;
    }
    const w = Math.max(1, Math.round(target.width * this.scale));
    const h = Math.max(1, Math.round(target.height * this.scale));
    if (!this.rt) this.rt = hdrTarget(w, h);
    else if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    (this.u.uRes.value as THREE.Vector2).set(w, h);
    this.pass.render(renderer, this.rt);
    this.blitU.tSrc.value = this.rt.texture;
    this.blit.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [this.pass, this.blit];
  }

  dispose(): void {
    super.dispose();
    this.blit.dispose();
    this.rt?.dispose();
  }
}
