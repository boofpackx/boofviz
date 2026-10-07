import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

export const CONCRETE_SCENES = ['panels', 'monolith', 'parking', 'walkways', 'watertower', 'wall', 'section', 'modern'] as const;
/** Scenes the slide projector cycles through. */
const SLIDES = [0, 1, 3, 2, 4];

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uScene;
uniform float uReact, uSnow, uSpeed, uLit, uView, uClunk, uLevel, uDrawT, uWarm, uTurn;
float PX;

vec3 S(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float sdBox3(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }

// Raw board-formed concrete: plank imprint and seams, form-tie holes, aggregate, rain stains.
vec3 concrete(vec2 uv) {
  float plank = floor(uv.y / 0.16);
  float grain = fbm(vec2(uv.x * 1.2 + plank * 7.3, uv.y * 22.0));
  float seam = 1.0 - smoothstep(0.0, 0.012, fract(uv.y / 0.16) * 0.16);
  vec2 tie = (fract(uv / vec2(0.6, 0.48)) - 0.5) * vec2(0.6, 0.48);
  float hole = smoothstep(0.03, 0.018, length(tie));
  float speck = step(0.94, hash21(floor(uv * 110.0))) * 0.08 - step(0.97, hash21(floor(uv * 70.0) + 3.0)) * 0.06;
  float stain = smoothstep(0.45, 0.85, fbm(vec2(uv.x * 5.0, uv.y * 0.5 + 3.0)));
  vec3 c = vec3(0.47, 0.46, 0.44) * (0.84 + 0.28 * grain) - seam * 0.07 - hole * 0.28 + speck - stain * 0.14;
  return S(c);
}

// Ray against an axis-aligned box (centre c, half size b): near/far distances and the hit normal.
vec2 boxHit(vec3 ro, vec3 rd, vec3 c, vec3 b, out vec3 n) {
  vec3 m = 1.0 / rd;
  vec3 o = ro - c;
  vec3 k = abs(m) * b;
  vec3 t1 = -m * o - k;
  vec3 t2 = -m * o + k;
  float tN = max(max(t1.x, t1.y), t1.z);
  float tF = min(min(t2.x, t2.y), t2.z);
  n = vec3(0.0);
  if (tN > tF || tF < 0.0) return vec2(-1.0);
  n = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
  return vec2(tN, tF);
}

vec3 camRay(vec2 p, vec3 ro, vec3 ta, float zoom) {
  vec3 f = normalize(ta - ro);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, r);
  return normalize(p.x * r + p.y * u + zoom * f);
}

float snowLayer(vec2 p, float scale, float speed, float t) {
  vec2 q = p * scale + vec2(t * 0.3 * speed, t * speed);
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  vec2 o = (hash22(cell) - 0.5) * 0.6;
  return smoothstep(0.08, 0.0, length(f - o)) * step(0.55, hash21(cell + 7.0));
}

// ---------------------------------------------------------------- panel blocks at night
vec3 scenePanels(vec2 p) {
  float t = uTime * 0.5 * uSpeed + uView * 37.0;
  vec3 ro = vec3(t, 1.7 + uView * 0.3, -3.0);
  vec3 rd = camRay(p, ro, ro + vec3(0.8, 1.3 + uView * 0.5, 8.0), 1.5);
  // Sky: dark with an orange city glow at the horizon.
  vec3 sky = mix(S(vec3(0.35, 0.2, 0.12)), S(vec3(0.02, 0.025, 0.05)), smoothstep(-0.02, 0.35, rd.y));
  vec3 col = sky;
  float best = 1e9;
  vec3 bn = vec3(0.0);
  vec3 bc = vec3(0.0), bb = vec3(1.0);
  float bid = 0.0;
  for (int row = 0; row < 2; row++) {
    for (int k = -2; k <= 3; k++) {
      float cell = floor(t / 14.0) + float(k);
      float h = row == 0 ? (hash11(cell * 3.1) < 0.5 ? 5.6 : 9.6) : 12.0;
      vec3 c = vec3(cell * 14.0 + (hash11(cell) - 0.5) * 3.0 + float(row) * 6.0, h * 0.5, row == 0 ? 14.0 : 30.0);
      vec3 b = vec3(row == 0 ? 5.0 : 6.5, h * 0.5, 2.0);
      vec3 n;
      vec2 hit = boxHit(ro, rd, c, b, n);
      if (hit.x > 0.0 && hit.x < best) {
        best = hit.x;
        bn = n;
        bc = c;
        bb = b;
        bid = cell * 2.0 + float(row);
      }
    }
  }
  float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  vec3 lampCol = S(vec3(1.0, 0.55, 0.16));
  if (tg < best && tg < 1e8) {
    vec3 hp = ro + rd * tg;
    vec3 snow = S(vec3(0.62, 0.66, 0.75)) * (0.85 + 0.15 * vnoise(hp.xz * 3.0));
    float pool = 0.0;
    for (int i = -1; i <= 3; i++) {
      float lx = (floor(t / 7.0) + float(i)) * 7.0;
      pool += exp(-length(hp.xz - vec2(lx, 6.0)) * 0.55);
    }
    col = snow * (0.08 + pool * 0.9 * lampCol);
    col = mix(col, sky, smoothstep(10.0, 60.0, tg));
  } else if (best < 1e8) {
    vec3 hp = ro + rd * best;
    vec2 uv = abs(bn.z) > 0.5 ? vec2(hp.x - bc.x, hp.y) : vec2(hp.z - bc.z, hp.y);
    // Prefab panels: a joint grid, and a window in every panel.
    vec2 cell = floor(uv / vec2(1.2, 0.9));
    vec2 f = fract(uv / vec2(1.2, 0.9));
    float joint = step(f.x, 0.02) + step(f.y, 0.03);
    vec3 panel = S(vec3(0.5, 0.48, 0.45)) * (0.85 + 0.15 * hash21(cell + bid));
    panel = mix(panel, panel * 0.5, clamp(joint, 0.0, 1.0));
    float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.3, f.y) * step(f.y, 0.8);
    float floors = floor(bb.y * 2.0 / 0.9);
    float bar = floor(uBeat / uBeatsPerBar);
    float h = hash21(cell + bid * 13.0 + floor(bar / 2.0) * 0.37);
    float lit = step(h, uLit * (0.35 + 0.5 * uEnergy * uReact));
    // A floor lights up with each beat, sweeping up the block; the whole block on a drop.
    float sweep = step(abs(cell.y - mod(floor(uBeat), floors)), 0.0) * step(0.5, hash11(bid));
    lit = max(lit, sweep * 0.9);
    lit = max(lit, step(0.3, uKick * uReact) * step(0.92, h));
    vec3 room = mix(S(vec3(1.0, 0.72, 0.38)), S(vec3(0.55, 0.7, 1.0)), step(0.8, hash21(cell * 1.7 + bid)));
    vec3 glass = S(vec3(0.05, 0.06, 0.09)) + room * lit * (1.3 + 0.6 * uKick);
    float side = abs(bn.x) > 0.5 ? 0.55 : 1.0;
    vec3 wall = panel * (0.1 + 0.25 * side) + lampCol * 0.12 * exp(-hp.y * 0.25);
    col = mix(wall, glass, win);
    col = mix(col, sky * 1.3, smoothstep(20.0, 80.0, best));
  }
  // Sodium lamps along the street.
  for (int i = -1; i <= 3; i++) {
    vec3 lp = vec3((floor(t / 7.0) + float(i)) * 7.0, 3.4, 6.0);
    vec3 v = lp - ro;
    float along = dot(v, rd);
    if (along > 0.0 && along < best) {
      float d = length(v - rd * along);
      col += lampCol * (exp(-d * 9.0) * 3.0 + exp(-d * 1.5) * 0.15);
    }
  }
  // Snow.
  float fall = uSnow * (0.7 + 0.3 * uEnergy);
  col += vec3(0.9, 0.9, 1.0) * (snowLayer(p, 18.0, 0.9, uTime) * 0.8 + snowLayer(p, 34.0, 0.6, uTime) * 0.5 + snowLayer(p, 60.0, 0.4, uTime) * 0.3) * fall;
  return col;
}

// ---------------------------------------------------------------- monolith in fog
vec3 sceneMonolith(vec2 p) {
  float t = uTime * 0.12 * uSpeed + uView * 5.0;
  vec3 ro = vec3(sin(t) * 12.0, 2.0 + uView * 3.0, -30.0 + cos(t * 0.7) * 4.0);
  vec3 rd = camRay(p, ro, vec3(sin(t * 0.8) * 3.0, 10.0, 0.0), 1.5);
  vec3 fogC = mix(S(vec3(0.5, 0.52, 0.55)), S(vec3(0.75, 0.75, 0.76)), smoothstep(-0.1, 0.6, rd.y));
  vec3 col = fogC;
  vec3 n;
  vec2 hit = boxHit(ro, rd, vec3(0.0, 15.0, 0.0), vec3(6.0, 15.0, 4.0), n);
  float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  if (hit.x > 0.0 && hit.x < tg) {
    vec3 hp = ro + rd * hit.x;
    vec2 uv = abs(n.z) > 0.5 ? hp.xy : hp.zy;
    vec3 c = concrete(uv * 0.5);
    float lam = 0.35 + 0.65 * max(dot(n, normalize(vec3(-0.5, 0.6, -0.6))), 0.0);
    c *= lam;
    // Light slits in the front face, opening on the kick.
    if (n.z < -0.5) {
      float slit = step(abs(fract(hp.x / 1.5) - 0.5), 0.02) * step(2.0, hp.y) * step(hp.y, 26.0);
      float band = step(abs(hp.y - 18.0), 0.25);
      float open = 0.25 + 0.75 * uKick * uReact + 0.4 * uEnergy;
      c = mix(c, palette(0.85) * (1.0 + 2.5 * open), clamp(slit + band, 0.0, 1.0) * open);
    }
    col = mix(c, fogC, 1.0 - exp(-hit.x * 0.035));
  } else if (tg < 1e8) {
    vec3 hp = ro + rd * tg;
    col = mix(concrete(hp.xz * 0.3) * 0.6, fogC, 1.0 - exp(-tg * 0.04));
  }
  return col;
}

// ---------------------------------------------------------------- parking spiral (raymarched)
float parkMap(vec3 p, out float id) {
  float d = min(p.y, 2.8 - p.y);
  id = 0.0;
  float r = length(p.xz);
  float core = r - 4.0;
  if (core < d) { d = core; id = 1.0; }
  float outer = 15.0 - r;
  if (outer < d) { d = outer; id = 1.0; }
  vec2 q = mod(p.xz + 2.5, 5.0) - 2.5;
  float col = sdBox3(vec3(q.x, p.y - 1.4, q.y), vec3(0.32, 1.4, 0.32));
  if (r > 5.5 && col < d) { d = col; id = 2.0; }
  return d;
}

float seg7(vec2 p, int digit) {
  // Seven-segment digit in a 1 × 2 box.
  int bits[10] = int[10](0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F);
  int b = bits[digit];
  float d = 1e9;
  vec2 hs[7] = vec2[7](vec2(0.0, 1.0), vec2(0.5, 0.5), vec2(0.5, -0.5), vec2(0.0, -1.0), vec2(-0.5, -0.5), vec2(-0.5, 0.5), vec2(0.0, 0.0));
  for (int i = 0; i < 7; i++) {
    if (((b >> i) & 1) == 0) continue;
    vec2 c = hs[i];
    bool horiz = i == 0 || i == 3 || i == 6;
    d = min(d, sdBox(p - c, horiz ? vec2(0.42, 0.08) : vec2(0.08, 0.42)));
  }
  return d;
}

vec3 sceneParking(vec2 p) {
  float t = uTime * 0.18 * uSpeed + uView * 2.0;
  float R = 9.5;
  vec3 ro = vec3(cos(t) * R, 1.35 + 0.05 * sin(uBeat * 3.14159), sin(t) * R);
  vec3 ta = vec3(cos(t + 0.35) * R, 1.25, sin(t + 0.35) * R);
  vec3 rd = camRay(p, ro, ta, 1.3);
  float d = 0.0;
  float id = 0.0;
  for (int i = 0; i < 80; i++) {
    vec3 q = ro + rd * d;
    float h = parkMap(q, id);
    if (h < 0.002 || d > 40.0) break;
    d += h;
  }
  vec3 hp = ro + rd * d;
  float idd;
  vec2 e = vec2(0.002, 0.0);
  vec3 n = normalize(vec3(parkMap(hp + e.xyy, idd) - parkMap(hp - e.xyy, idd), parkMap(hp + e.yxy, idd) - parkMap(hp - e.yxy, idd), parkMap(hp + e.yyx, idd) - parkMap(hp - e.yyx, idd)));
  // Fluorescent tubes on the ceiling grid, some flickering.
  vec2 tc = floor((hp.xz + 2.5) / 5.0);
  float flick = step(0.06, hash21(tc + floor(uTime * 14.0) * 0.13)) * (0.85 + 0.15 * uKick * uReact);
  vec2 tq = mod(hp.xz, 5.0) - 2.5;
  float nearTube = exp(-length(tq) * 0.45) * flick;
  vec3 light = S(vec3(0.85, 1.0, 0.92));
  vec3 col;
  if (hp.y > 2.78) {
    col = concrete(hp.xz * 0.4) * 0.35;
    float tube = step(abs(tq.x), 1.2) * step(abs(tq.y), 0.06);
    col = mix(col, light * 3.0 * flick, tube);
  } else if (hp.y < 0.01) {
    col = S(vec3(0.16)) * (0.9 + 0.2 * vnoise(hp.xz * 6.0));
    float bay = step(abs(fract(atan(hp.z, hp.x) / 6.28318 * 40.0) - 0.5), 0.02) * step(10.0, length(hp.xz)) * step(length(hp.xz), 14.0);
    col = mix(col, S(vec3(0.9, 0.85, 0.6)), bay);
  } else {
    vec2 uv = abs(n.x) > abs(n.z) ? hp.zy : hp.xy;
    col = concrete(uv * 0.6);
    // Level number stencilled on the columns, counting down the bars.
    if (id > 1.5) {
      // Face coordinates as seen from the front of each face (so the digits never read mirrored).
      vec3 centre = vec3(floor((hp.x + 2.5) / 5.0) * 5.0, 0.0, floor((hp.z + 2.5) / 5.0) * 5.0);
      vec3 fn = abs(n.x) > abs(n.z) ? vec3(sign(n.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(n.z));
      vec3 right = cross(vec3(0.0, 1.0, 0.0), fn);
      vec2 fq = vec2(dot(hp - centre, right), hp.y - 1.5);
      float dg = seg7(fq * vec2(4.0, 3.0), int(mod(uLevel, 10.0)));
      col = mix(col, S(vec3(1.0, 0.8, 0.1)), smoothstep(0.03, 0.0, dg) * 0.9);
      col = mix(col, S(vec3(1.0, 0.8, 0.1)), step(abs(hp.y - 0.5), 0.12) * 0.8 * step(mod(floor(fq.x * 4.0 + hp.y * 4.0), 2.0), 0.5));
    }
  }
  col *= 0.12 + nearTube * 1.1 * light;
  return mix(col, S(vec3(0.02, 0.025, 0.02)), smoothstep(8.0, 30.0, d));
}

// ---------------------------------------------------------------- streets in the sky
float walkMap(vec3 p, out float id) {
  float ly = mod(p.y, 3.2);
  float lvl = floor(p.y / 3.2);
  id = 0.0;
  float d = 1e9;
  if (p.y > 0.0 && p.y < 32.0) {
    float slab = sdBox3(vec3(p.x - 1.75, ly - 0.12, 0.0), vec3(1.75, 0.15, 1e3));
    float para = sdBox3(vec3(p.x - 0.12, ly - 0.75, 0.0), vec3(0.14, 0.6, 1e3));
    d = min(slab, para);
    id = para < slab ? 1.0 : 0.0;
  }
  float back = 3.6 - p.x;
  if (back < d) { d = back; id = 2.0; }
  d = min(d, p.y + 0.0);
  return d;
}

vec3 sceneWalkways(vec2 p) {
  float t = uTime * 0.9 * uSpeed + uView * 40.0;
  vec3 ro = vec3(-15.0, 7.0 + uView * 4.0, t);
  vec3 rd = camRay(p, ro, ro + vec3(10.0, 2.5, 6.0), 1.5);
  float d = 0.0;
  float id = 0.0;
  for (int i = 0; i < 90; i++) {
    float h = walkMap(ro + rd * d, id);
    if (h < 0.003 || d > 80.0) break;
    d += h;
  }
  vec3 sky = mix(S(vec3(0.62, 0.64, 0.68)), S(vec3(0.3, 0.33, 0.38)), smoothstep(0.0, 0.6, rd.y));
  if (d > 80.0) return sky;
  vec3 hp = ro + rd * d;
  float idd;
  vec2 e = vec2(0.003, 0.0);
  vec3 n = normalize(vec3(walkMap(hp + e.xyy, idd) - walkMap(hp - e.xyy, idd), walkMap(hp + e.yxy, idd) - walkMap(hp - e.yxy, idd), walkMap(hp + e.yyx, idd) - walkMap(hp - e.yyx, idd)));
  float lam = 0.3 + 0.7 * max(dot(n, normalize(vec3(-0.6, 0.7, -0.3))), 0.0);
  vec3 col = concrete((abs(n.x) > 0.5 ? hp.zy : hp.xz) * 0.5) * lam;
  if (id > 1.5) {
    // Doors along each deck, lighting in sequence with the beat.
    float lvl = floor(hp.y / 3.2);
    float ly = mod(hp.y, 3.2);
    float k = floor(hp.z / 2.6);
    float f = fract(hp.z / 2.6);
    float door = step(0.3, f) * step(f, 0.62) * step(0.3, ly) * step(ly, 2.4);
    float seq = step(abs(mod(k + lvl * 5.0, 16.0) - mod(floor(uBeat), 16.0)), 0.5);
    float lit = max(seq, step(0.85, hash21(vec2(k, lvl))));
    vec3 dc = mix(S(vec3(0.12, 0.08, 0.06)), palette(0.8) * 1.8, lit * (0.7 + 0.5 * uKick * uReact));
    col = mix(col * 0.5, dc, door);
  }
  return mix(col, sky, 1.0 - exp(-d * 0.02));
}

// ---------------------------------------------------------------- water tower at dusk
vec3 sceneWaterTower(vec2 p) {
  vec3 c = mix(S(vec3(0.85, 0.55, 0.35)), S(vec3(0.12, 0.18, 0.26)), smoothstep(-0.15, 0.4, p.y));
  c = mix(c, c * 0.7 + S(vec3(0.2, 0.22, 0.28)) * 0.3, smoothstep(0.5, 0.75, fbm(vec2(p.x * 2.0 + uTime * 0.01, p.y * 5.0))) * smoothstep(-0.1, 0.3, p.y));
  float ground = p.y + 0.3 + 0.01 * sin(p.x * 9.0);
  float tx = 0.15 + uView * 0.2;
  vec2 q = (p - vec2(tx, -0.3)) * 1.25;
  float shaft = sdBox(q - vec2(0.0, 0.25), vec2(0.035, 0.25));
  // A flared concrete bowl on the shaft, a drum above it and a shallow cone roof.
  float bowl = sdBox(q - vec2(0.0, 0.56), vec2(0.035 + clamp(q.y - 0.5, 0.0, 0.12) * 1.05, 0.06));
  float tank = sdBox(q - vec2(0.0, 0.665), vec2(0.16, 0.045));
  float roof = sdBox(q - vec2(0.0, 0.725), vec2(max(0.0, 0.17 - (q.y - 0.71) * 4.0), 0.016));
  float neck = bowl;
  float sil = min(min(shaft, neck), min(tank, roof));
  vec3 dark = S(vec3(0.05, 0.05, 0.07));
  c = mix(c, dark, clamp(0.5 - sil / PX, 0.0, 1.0));
  c = mix(c, dark * 0.8, clamp(0.5 - ground / PX, 0.0, 1.0));
  vec2 bp = q - vec2(0.0, 0.745);
  float pulse = pow(0.5 + 0.5 * cos(uBeatPhase * 6.28318), 6.0) * (0.6 + 0.6 * uKick * uReact);
  c += S(vec3(1.0, 0.1, 0.05)) * (exp(-length(bp) * 140.0) * 2.0 + exp(-length(bp) * 25.0) * 0.25) * pulse;
  return c;
}

// ---------------------------------------------------------------- wall close-up
vec3 sceneWall(vec2 p) {
  vec2 uv = p * 1.6 + vec2(uTime * 0.01 * uSpeed + uView * 3.0, 0.0);
  vec3 c = concrete(uv);
  // Raking light from one side; a stronger flash of it on the kick.
  float rake = 0.35 + 0.9 * smoothstep(1.2, -0.9, p.x) + 0.2 * uKick * uReact;
  return c * rake * mix(vec3(1.0), S(vec3(1.0, 0.9, 0.75)), uWarm);
}

// ---------------------------------------------------------------- section drawing (blueprint)
float lineSeg(vec2 p, vec2 a, vec2 b, float prog) {
  vec2 e = a + (b - a) * clamp(prog, 0.0, 1.0);
  return prog <= 0.0 ? 1e9 : sdSegment(p, a, e);
}

vec3 sceneSection(vec2 p) {
  vec3 c = S(vec3(0.06, 0.2, 0.46));
  vec2 g = abs(fract(p * 20.0 + 0.5) - 0.5) / 20.0;
  vec2 G = abs(fract(p * 4.0 + 0.5) - 0.5) / 4.0;
  c += S(vec3(0.3, 0.5, 0.8)) * (smoothstep(PX, 0.0, min(g.x, g.y)) * 0.12 + smoothstep(PX * 1.5, 0.0, min(G.x, G.y)) * 0.25);
  // The section: ground, floor slabs, columns, a stair, the roof, drawn in over the phrase.
  float total = 20.0;
  float prog = uDrawT * total;
  float d = 1e9;
  float k = 0.0;
  d = min(d, lineSeg(p, vec2(-0.8, -0.35), vec2(0.8, -0.35), prog - k)); k += 1.0;
  for (int i = 0; i < 6; i++) {
    float y = -0.35 + float(i + 1) * 0.12;
    float w = 0.55 - float(i) * 0.02 + (i == 5 ? 0.12 : 0.0);
    d = min(d, lineSeg(p, vec2(-w, y), vec2(w, y), prog - k)); k += 1.0;
  }
  for (int i = 0; i < 5; i++) {
    float x = -0.5 + float(i) * 0.25;
    d = min(d, lineSeg(p, vec2(x, -0.35), vec2(x, 0.37), prog - k)); k += 1.0;
  }
  for (int i = 0; i < 6; i++) {
    vec2 a = vec2(-0.12 + mod(float(i), 2.0) * 0.12, -0.35 + float(i) * 0.12);
    vec2 b = vec2(-0.12 + mod(float(i + 1), 2.0) * 0.12, -0.35 + float(i + 1) * 0.12);
    d = min(d, lineSeg(p, a, b, (prog - k) * 2.0)); k += 0.5;
  }
  d = min(d, lineSeg(p, vec2(-0.7, 0.48), vec2(0.7, 0.48), prog - k));
  float glow = 0.8 + 0.6 * uBass * uReact;
  c = mix(c, S(vec3(0.92, 0.96, 1.0)) * glow, smoothstep(PX * 1.6, 0.0, d));
  c += S(vec3(0.5, 0.7, 1.0)) * exp(-d * 260.0) * 0.25 * glow;
  return c;
}

// ---------------------------------------------------------------- modern concrete
float modernMap(vec3 p, out float id) {
  vec3 q = vec3(rot2(uTurn) * p.xz, p.y).xzy;
  q = vec3(q.x, p.y, q.z);
  float slab = sdBox3(q - vec3(0.0, 0.5, 0.0), vec3(2.2, 0.5, 1.4));
  float tower = sdBox3(q - vec3(-1.3, 2.2, -0.6), vec3(0.55, 1.7, 0.55));
  float lever = sdBox3(q - vec3(0.9, 1.55, 0.3), vec3(1.6, 0.25, 0.7));
  float plane = sdBox3(q - vec3(1.6, 1.0, -1.0), vec3(0.04, 1.0, 0.9));
  float disc = sdBox3(q - vec3(-0.2, 3.0, 0.9), vec3(0.8, 0.04, 0.8));
  float d = p.y;
  id = 0.0;
  if (slab < d) { d = slab; id = 1.0; }
  if (tower < d) { d = tower; id = 1.0; }
  if (lever < d) { d = lever; id = 1.0; }
  if (plane < d) { d = plane; id = 2.0; }
  if (disc < d) { d = disc; id = 3.0; }
  return d;
}

vec3 sceneModern(vec2 p) {
  vec3 ro = vec3(7.5, 4.5 + uView * 2.0, 8.5);
  vec3 rd = camRay(p, ro, vec3(0.0, 1.3, 0.0), 1.6);
  float d = 0.0;
  float id = 0.0;
  for (int i = 0; i < 90; i++) {
    float h = modernMap(ro + rd * d, id);
    if (h < 0.002 || d > 50.0) break;
    d += h;
  }
  vec3 sky = mix(S(vec3(0.93, 0.92, 0.88)), S(vec3(0.75, 0.82, 0.9)), smoothstep(0.0, 0.5, rd.y));
  if (d > 50.0) return sky;
  vec3 hp = ro + rd * d;
  float idd;
  vec2 e = vec2(0.002, 0.0);
  vec3 n = normalize(vec3(modernMap(hp + e.xyy, idd) - modernMap(hp - e.xyy, idd), modernMap(hp + e.yxy, idd) - modernMap(hp - e.yxy, idd), modernMap(hp + e.yyx, idd) - modernMap(hp - e.yyx, idd)));
  // Hard sun: a straight shadow ray, no softening.
  vec3 sun = normalize(vec3(-0.5, 0.8, 0.35));
  float sh = 1.0;
  float st = 0.02;
  for (int i = 0; i < 40; i++) {
    float h = modernMap(hp + n * 0.004 + sun * st, idd);
    if (h < 0.001) { sh = 0.0; break; }
    st += h;
    if (st > 20.0) break;
  }
  float lam = max(dot(n, sun), 0.0) * sh;
  vec3 base;
  if (id < 0.5) base = S(vec3(0.9, 0.89, 0.86));
  else if (id < 1.5) base = concrete(abs(n.y) > 0.5 ? hp.xz : (abs(n.x) > 0.5 ? hp.zy : hp.xy)) * 1.25;
  else if (id < 2.5) base = palette(0.6) * 1.1;
  else base = palette(0.9) * 1.1;
  vec3 c = base * (0.32 + 0.85 * lam) * (1.0 + 0.08 * uKick * uReact);
  return mix(c, sky, smoothstep(25.0, 50.0, d));
}

void main() {
  PX = 1.2 / uRes.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 c;
  if (uScene == 0) c = scenePanels(p);
  else if (uScene == 1) c = sceneMonolith(p);
  else if (uScene == 2) c = sceneParking(p);
  else if (uScene == 3) c = sceneWalkways(p);
  else if (uScene == 4) c = sceneWaterTower(p);
  else if (uScene == 5) c = sceneWall(p);
  else if (uScene == 6) c = sceneSection(p);
  else c = sceneModern(p);
  // Slide projector: a clunk of light and a jolt as each slide drops in.
  c *= 1.0 + uClunk * 1.5;
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

/**
 * Concrete Age: raw board-formed concrete scenes (prefab panel blocks at night
 * in the snow, a monolith in fog, a parking spiral, deck-access walkways, a
 * water tower at dusk, a wall close-up, an architect's section drawing), plus
 * a slide-projector mode that changes view every few bars.
 */
export class Concrete extends ShaderGenerator {
  readonly kind = 'concrete';

  constructor() {
    super(FRAG, {
      uScene: { value: 0 },
      uReact: { value: 1 },
      uSnow: { value: 1 },
      uSpeed: { value: 1 },
      uLit: { value: 0.6 },
      uView: { value: 0 },
      uClunk: { value: 0 },
      uLevel: { value: 1 },
      uDrawT: { value: 0 },
      uWarm: { value: 0 },
      uTurn: { value: 0 },
    });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    let scene = Math.max(0, CONCRETE_SCENES.indexOf(String(p.scene ?? 'panels') as (typeof CONCRETE_SCENES)[number]));
    let view = num(p.view, 0);
    const slideBars = Math.round(num(p.slides, 0));
    u.uClunk.value = 0;
    if (slideBars > 0) {
      // Slide projector: a new view every few bars, dropping in with a flash.
      const len = slideBars * bpb;
      const k = Math.floor(ctx.beat / len);
      scene = SLIDES[((k % SLIDES.length) + SLIDES.length) % SLIDES.length];
      view = (k * 0.618) % 1;
      const into = ctx.beat - k * len;
      u.uClunk.value = Math.max(0, 1 - into / 0.15) * 0.6;
    }
    u.uScene.value = scene;
    u.uView.value = view;
    u.uReact.value = num(p.react, 1);
    u.uSnow.value = num(p.snow, 1);
    u.uSpeed.value = num(p.speed, 1);
    u.uLit.value = num(p.lit, 0.6);
    u.uWarm.value = num(p.warm, 0.3);
    u.uLevel.value = 9 - (Math.floor(ctx.beat / (bpb * 4)) % 9);
    u.uDrawT.value = ((ctx.beat / (bpb * 8)) % 1) * 1.15;
    // Modern: a quarter turn at the top of every bar (a quick ease, then hold).
    const bar = Math.floor(ctx.beat / bpb);
    const k = Math.min(1, (ctx.beat - bar * bpb) / 0.5);
    u.uTurn.value = (bar + k * k * (3 - 2 * k)) * (Math.PI / 2);
  }
}
