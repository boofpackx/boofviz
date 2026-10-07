import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Glossy mid-2000s "aero" wallpaper world. Everything behind the glass is one
 * procedural function, world(p), so orbs and dew drops refract it by simply
 * evaluating it again at a bent coordinate (no textures, no extra passes).
 */
const FRAG = /* glsl */ `${GEN_HEADER}
uniform vec4 uTodW;            // time-of-day weights: morning, noon, golden hour, twilight
uniform float uWind;           // beat-locked wind phase (one eased notch per beat, mod 4)
uniform float uBarIdx, uBarBeat;
uniform float uRibHead, uRibTail, uRibDir, uRibSeed, uRibAmp;
uniform float uBuild, uDropT, uDropEnv;
uniform float uOrbs, uOrbSize, uRise, uHero, uRefract, uBubbles, uSway, uClouds, uAurora, uFlare, uDew, uBurst, uHQ;

float gAsp;
vec3 gZen, gHor, gSunCol, gLight, gCloudLit, gCloudShade;
vec2 gSun;
float gStars, gAur, gFlareK, gDay;

const float HZ = -0.03;

float fbmN(vec2 p, int n) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

void setupTod() {
  vec4 w = uTodW;
  gZen = w.x * mix(uPal[1], uPal[0], 0.15) + w.y * uPal[1] * 1.15 + w.z * mix(uPal[1] * 0.4, vec3(0.2, 0.08, 0.3), 0.5) + w.w * uPal[0] * 0.45;
  gHor = w.x * mix(uPal[3], vec3(1.0, 0.74, 0.52), 0.35) + w.y * mix(uPal[3], uPal[4], 0.2) + w.z * vec3(1.3, 0.52, 0.16) + w.w * mix(uPal[0], vec3(0.14, 0.1, 0.4), 0.6);
  gSunCol = w.x * vec3(1.0, 0.84, 0.62) + w.y * vec3(1.0, 0.97, 0.9) + w.z * vec3(1.0, 0.48, 0.14) + w.w * vec3(0.5, 0.25, 0.5);
  gLight = w.x * vec3(1.0, 0.94, 0.8) + w.y * vec3(1.08) + w.z * vec3(1.0, 0.66, 0.36) * 0.85 + w.w * vec3(0.09, 0.14, 0.3);
  gCloudLit = w.x * vec3(1.2, 1.02, 0.88) + w.y * uPal[4] * 1.25 + w.z * vec3(1.4, 0.7, 0.34) + w.w * vec3(0.1, 0.1, 0.2);
  gCloudShade = w.x * mix(uPal[1], vec3(0.8, 0.66, 0.7), 0.6) + w.y * mix(uPal[1], uPal[4], 0.55) + w.z * vec3(0.42, 0.2, 0.3) + w.w * vec3(0.025, 0.03, 0.07);
  gSun = w.x * vec2(-0.6, 0.12) + w.y * vec2(0.3, 0.33) + w.z * vec2(0.58, 0.055) + w.w * vec2(0.42, -0.14);
  gSun.x *= gAsp / 1.7778;
  gStars = w.w;
  gDay = 1.0 - w.w;
  gAur = 0.25 * w.z + 1.0 * w.w;
  gFlareK = w.x + 0.8 * w.y + 1.1 * w.z;
}

float ridgeFar(float x) { return HZ + 0.012 + 0.03 * sin(1.15 * x + 0.9) + 0.016 * sin(2.6 * x + 2.2) + 0.005 * sin(6.3 * x + 0.4); }
float ridgeMain(float x) { return -0.19 + 0.15 * exp(-pow((x + 0.4) / 0.8, 2.0)) + 0.035 * sin(1.7 * x + 1.3) + 0.008 * sin(4.9 * x); }
float ridgeFront(float x) {
  float s = x / gAsp * 1.7778;
  return -0.4 + 0.12 * exp(-pow((s - 0.62) / 0.42, 2.0)) + 0.025 * sin(2.1 * s + 0.5);
}

// Beat-locked wind: the gust wave advances one eased notch per beat; kicks lean the blades.
float wind(float x, float r) {
  float w = sin(uWind * 1.5708 - x * 2.6 + r * 0.04) * 0.24 + sin(uTime * 1.6 + x * 9.0 + r * 1.7) * 0.05;
  return (w + uKick * 0.07) * uSway;
}

// One grass field below a ridge line. Rows are spaced in log depth (perspective), each row a
// column of hashed blades that taper and bend with the wind. Returns colour + coverage.
vec4 field(vec2 p, float ridge, float slope, float K, float R, float d0, float seed, float haze, bool hq) {
  float d = ridge - p.y;
  float sunSide = clamp((gSun.x - p.x) * 2.5, -1.0, 1.0);
  float lam = clamp(0.9 - slope * sunSide * 1.8, 0.5, 1.3);
  float shadow = gDay * smoothstep(0.5, 0.72, vnoise(vec2(p.x * 1.8 - uTime * 0.025, max(d, 0.0) * 5.0 + seed)));
  vec3 lightC = gLight * lam * (1.0 - 0.32 * shadow);
  vec3 ground = uPal[2] * lightC * (0.22 + 0.16 * vnoise(p * vec2(90.0, 40.0)));
  vec3 bladeAvg = uPal[2] * lightC * mix(0.85, 1.05, exp(-max(d, 0.0) * 12.0));
  float a = clamp(d * uRes.y + 0.5, 0.0, 1.0);
  vec3 col = mix(ground, bladeAvg, 0.8) * (0.88 + 0.24 * vnoise(vec2(p.x * 420.0, p.y * 140.0)));
  float dd = max(d, 0.0) + d0;
  float rowPx = (1.0 + K * dd) / (K * R) * uRes.y;
  float lod = hq ? smoothstep(2.0, 7.0, rowPx) * uHQ : 0.0;
  if (lod > 0.0) {
    col = mix(col, mix(ground, bladeAvg, 0.35), lod);
    float r0 = floor(log(1.0 + K * dd) * R);
    for (int j = 0; j < 4; j++) {
      float r = r0 + float(j);
      float e0 = exp((r + 0.5) / R);
      float dr = (e0 - 1.0) / K - d0;
      float rh = e0 / (K * R);
      float cw = rh * 1.05;
      float ci = floor(p.x / cw);
      for (int c = -1; c <= 1; c++) {
        float cc = ci + float(c);
        vec2 hA = hash22(vec2(cc, r + seed));
        float hB = hash21(vec2(r * 1.37 + seed, cc * 0.71));
        float rootX = (cc + 0.5 + (hA.x - 0.5) * 0.8) * cw;
        float rootD = dr + (hA.y - 0.5) * rh;
        float H = rh * (2.0 + 2.2 * hB);
        float s = (rootD - d) / H;
        if (s <= 0.0 || s >= 1.0) continue;
        float lean = ((hA.y - 0.5) * 0.6 + wind(rootX, r)) * H;
        float bx = rootX + lean * s * s;
        float wid = cw * 0.42 * pow(1.0 - s, 0.85);
        float dx = p.x - bx;
        float cov = clamp((wid - abs(dx)) * uRes.y + 0.5, 0.0, 1.0);
        if (cov <= 0.0) continue;
        vec3 bc = mix(uPal[2], uPal[2] * vec3(1.7, 1.08, 0.4) + vec3(0.04, 0.035, 0.0), hB * 0.5 + s * 0.25);
        float side = clamp(dx / max(wid, 1e-5), -1.0, 1.0) * clamp((gSun.x - bx) * 6.0, -1.0, 1.0);
        vec3 c3 = bc * lightC * mix(0.3, 1.2, s) * (0.82 + 0.3 * side);
        c3 += gSunCol * lightC * smoothstep(0.35, 0.95, side) * s * 0.45;
        col = mix(col, mix(bladeAvg, c3, lod), cov);
        a = max(a, cov * lod);
      }
    }
  }
  col = mix(col, gHor * 0.75, haze * exp(-max(d, 0.0) * 28.0));
  return vec4(col, a);
}

// An aurora / light ribbon: a sum-of-sines curve with a Gaussian core and a streaked veil above.
vec3 ribbon(vec2 p, float seed, float dir, float head, float tail, float amp, bool hq) {
  float x = p.x * dir;
  float yc = 0.31 - 0.17 * x * x + 0.045 * sin(1.4 * x + seed) + 0.02 * sin(3.1 * x + seed * 1.7 + uTime * 0.2);
  float dy = p.y - yc;
  float w = 0.02 + 0.016 * (0.5 + 0.5 * sin(1.7 * x + seed * 3.0));
  float core = exp(-dy * dy / (w * w));
  float glow = exp(-abs(dy) / (w * 2.5)) * 0.3;
  float veil = dy > 0.0 ? exp(-dy * 7.0) * (hq ? 0.3 + 0.7 * vnoise(vec2(x * 22.0 + seed * 10.0 + uTime * 0.25, seed)) : 0.6) : 0.0;
  float twist = 0.55 + 0.45 * sin(x * 3.3 + seed * 2.0 + uTime * 0.15);
  float m = smoothstep(tail, tail + 0.45, x) * (1.0 - smoothstep(head - 0.06, head, x));
  float hd = exp(-pow((x - head + 0.07) / 0.15, 2.0));
  float night = clamp(gStars + 0.45 * uTodW.z, 0.0, 1.0);
  vec3 cDay = mix(uPal[3], uPal[4], 0.45);
  vec3 cNight = mix(uPal[2] * 1.5 + vec3(0.02, 0.18, 0.08), uPal[3], smoothstep(-0.01, 0.1, dy));
  vec3 c = mix(cDay, cNight, night);
  return c * ((core * twist + glow) * (1.0 + 1.4 * hd) + veil * 0.3 * night) * m * amp;
}

vec3 sky(vec2 p, bool hq) {
  float yy = p.y - HZ;
  float h = clamp(yy / (0.55 - HZ), 0.0, 1.0);
  vec3 col = mix(gHor, gZen, pow(h, 0.55));
  float ds = length(p - gSun);
  col += gSunCol * (0.55 * exp(-ds * 7.0) + 0.16 * exp(-ds * 2.0)) * (1.0 - 0.55 * gStars) * (1.0 + 0.5 * uBuild);
  if (gStars > 0.01) {
    vec2 g = p * 160.0;
    vec2 id = floor(g);
    float hs = hash21(id);
    vec2 jo = hash22(id + 3.1) - 0.5;
    float st = step(0.985, hs) * smoothstep(0.22, 0.0, length(fract(g) - 0.5 - jo * 0.5));
    col += vec3(0.75, 0.85, 1.0) * st * gStars * smoothstep(0.05, 0.3, yy) * (0.8 + 0.6 * sin(uTime * 2.3 + hs * 60.0));
  }
  if (yy > 0.0 && uClouds > 0.0) {
    // Cumulus: isotropic fbm puffs that shrink toward the horizon and bank up just above it.
    float sc = 2.4 / (0.32 + yy);
    vec2 cp = vec2(p.x * sc + uTime * 0.03, yy * sc * 1.15);
    int oct = hq ? 5 : 3;
    float n = fbmN(cp, oct) + 0.16 * (1.0 - smoothstep(0.0, 0.32, yy)) - 0.06 * smoothstep(0.25, 0.5, yy);
    float cover = 0.66 - 0.1 * uClouds;
    float den = smoothstep(cover, cover + 0.1, n) * smoothstep(0.0, 0.03, yy) * min(uClouds * 2.0, 1.0);
    if (den > 0.0) {
      vec2 toL = normalize(mix(vec2(0.0, 1.0), normalize(gSun - p + vec2(1e-4, 1e-3)), 0.6));
      float n2 = hq ? fbmN(cp + toL * 0.22, oct) : n - 0.03;
      float lit = clamp(0.6 + (n - n2) * 4.0, 0.0, 1.0);
      float thick = smoothstep(0.0, 0.2, n - cover);
      vec3 cc = mix(gCloudShade, gCloudLit, lit);
      cc = mix(cc, gCloudShade * 0.9, (1.0 - lit) * thick * 0.4);
      cc += gSunCol * exp(-ds * 3.5) * (1.0 - thick) * 1.6 * gDay;
      col = mix(col, cc, den);
    }
  }
  return col;
}

vec3 world(vec2 p, bool hq) {
  vec3 col = sky(p, hq);
  // Light ribbons: the bar sweep plus a faint resident aurora (strong at twilight).
  col += ribbon(p, uRibSeed, uRibDir, uRibHead, uRibTail, uRibAmp * uAurora * (0.4 + 0.6 * gStars), hq);
  if (gAur > 0.0) col += ribbon(p + vec2(0.0, 0.07), 2.4, -1.0, 9.0, -9.0, gAur * uAurora * 0.3, hq);
  float ds = length(p - gSun);
  col = mix(col, gSunCol * 9.0 * (1.0 + 0.4 * uBuild), smoothstep(0.03, 0.025, ds) * gDay);
  // Far hazy ridge.
  float rf = ridgeFar(p.x);
  if (p.y < rf + 0.002) {
    float d = rf - p.y;
    vec3 fc = mix(uPal[2] * gLight * 0.75, gHor * 0.9, 0.55 - 0.25 * smoothstep(0.0, 0.08, d));
    col = mix(col, fc, clamp(d * uRes.y + 0.5, 0.0, 1.0));
  }
  float rm = ridgeMain(p.x);
  float rfr = ridgeFront(p.x);
  if (p.y >= rfr && p.y < rm + 0.03) {
    float sl = (ridgeMain(p.x + 0.01) - ridgeMain(p.x - 0.01)) * 50.0;
    vec4 f = field(p, rm, sl, 40.0, 18.0, 0.002, 1.0, 0.35, hq);
    col = mix(col, f.rgb, f.a);
  }
  if (p.y < rfr + 0.07) {
    float sl = (ridgeFront(p.x + 0.01) - ridgeFront(p.x - 0.01)) * 50.0;
    vec4 f = field(p, rfr, sl, 40.0, 14.0, 0.08, 7.0, 0.0, hq);
    col = mix(col, f.rgb, f.a);
  }
  return col;
}

// Orb i: 0..23 drifting orbs, 24..26 the downbeat orbs of this bar and the two before.
bool orbAt(int i, out vec2 c, out float R, out float seed) {
  if (i < 24) {
    float fi = float(i);
    if (fi >= uOrbs) return false;
    float h1 = hash11(fi * 12.9898 + 3.1), h2 = hash11(fi * 78.233 + 1.7), h3 = hash11(fi * 37.719 + 9.2), h4 = hash11(fi * 4.581 + 5.5);
    R = mix(0.02, 0.068, h2 * h2) * uOrbSize * (1.0 + 0.03 * uKick);
    float ph = fract(uBeat * uRise / mix(10.0, 20.0, h3) + h4);
    c = vec2((h1 - 0.5) * (gAsp - 0.1) + 0.035 * sin(uBeat * 0.3927 + h1 * 40.0), mix(-0.5 - R - 0.02, 0.5 + R + 0.02, ph));
    seed = h1 * 7.0 + h2;
    return true;
  }
  if (uHero < 0.5) return false;
  float k = float(i - 24);
  float m = uBarIdx - k;
  float age = uBarBeat + k * uBeatsPerBar;
  float g1 = hash11(m * 0.618 + 0.123), g2 = hash11(m * 1.3247 + 4.56), g3 = hash11(m * 2.2361 + 7.89);
  R = mix(0.1, 0.15, g2) * uOrbSize;
  float side = fract(m * 0.5) > 0.25 ? 1.0 : -1.0;
  float restY = mix(-0.2, -0.04, g3);
  float y = mix(-0.5 - R - 0.03, restY, easeOutBack(age / 1.4)) + 0.34 * max(age - 1.0, 0.0) / uBeatsPerBar;
  c = vec2(side * mix(0.12, gAsp * 0.5 - 0.3, g1) + 0.02 * sin(age * 0.785 + g1 * 20.0), y);
  seed = g1 * 5.0 + g3;
  return age < 3.0 * uBeatsPerBar;
}

vec4 bubbleLayer(vec2 p, float scale, float spd, float dens, float seed) {
  vec2 g = p * scale;
  g.y -= uBeat * spd;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id + seed);
  if (h > dens) return vec4(0.0);
  vec2 o = (hash22(id + seed * 1.3) - 0.5) * 0.45;
  o.x += 0.1 * sin(uTime * 1.7 + h * 40.0 + g.y * 1.3);
  float rad = mix(0.1, 0.2, fract(h * 137.7));
  vec2 q = (f - o) / rad;
  float d = length(q);
  float aa = scale / (rad * uRes.y);
  float body = clamp((1.0 - d) / aa + 0.5, 0.0, 1.0);
  if (body <= 0.0) return vec4(0.0);
  float ring = smoothstep(0.55, 1.0, d) * body;
  float tw = uHat * step(0.55, hash21(id + floor(uBeat * 2.0) * 7.31));
  vec2 sq = q - vec2(-0.38, 0.4);
  float spec = exp(-dot(sq, sq) * 22.0) * (1.0 + 3.5 * tw);
  vec3 c = mix(uPal[3], uPal[4], 0.5) * (ring * 0.6 + body * 0.05) + uPal[4] * spec * 1.6 * body;
  return vec4(c, ring * 0.5 + body * 0.06);
}

vec3 lensFlare(vec2 p) {
  vec3 acc = vec3(0.0);
  float vis = smoothstep(-0.005, 0.03, gSun.y - ridgeMain(gSun.x)) * smoothstep(-0.005, 0.02, gSun.y - ridgeFar(gSun.x));
  float k = uFlare * gFlareK * vis * (1.0 + 1.3 * uBuild);
  if (k > 0.001) {
    vec2 axis = -gSun;
    for (int j = 0; j < 6; j++) {
      float fj = float(j);
      float t = 0.38 + fj * 0.31 + 0.08 * sin(fj * 3.1);
      float rad = 0.018 + 0.055 * fract(fj * 0.618 + 0.3);
      vec2 gp = gSun + axis * t;
      float sd = (j == 1 || j == 4) ? sdPolygon(rot2(0.3) * (p - gp), rad, 6.0) : length(p - gp) - rad;
      float disc = clamp(-sd * uRes.y * 0.5 + 0.5, 0.0, 1.0) * (0.3 + 0.7 * smoothstep(-rad, 0.0, sd));
      vec3 tint = mix(uPal[3], vec3(1.0, 0.72, 0.38), fract(fj * 0.37 + 0.2));
      acc += tint * disc * 0.05;
    }
    float dd = length(p - gSun);
    float ring = exp(-pow((dd - 0.24) / 0.012, 2.0));
    acc += (0.5 + 0.5 * cos(6.2832 * ((dd - 0.24) * 16.0 + vec3(0.0, 0.33, 0.67)))) * ring * 0.05;
    acc += mix(uPal[3], vec3(1.0), 0.5) * exp(-abs(p.y - gSun.y) * 170.0) * exp(-abs(p.x - gSun.x) * 2.4) * 0.3;
    acc *= gSunCol * k;
  }
  // Drop: a slowly turning star-filter flare that blooms and fades over a couple of seconds.
  float star = uBurst * uFlare * smoothstep(0.0, 0.1, uDropT) * exp(-uDropT / 2.2);
  if (star > 0.001) {
    vec2 v = p - gSun;
    float dd = length(v);
    float an = atan(v.y, v.x) + uDropT * 0.06;
    float rays = pow(abs(cos(an * 3.0)), 260.0) + 0.45 * pow(abs(cos(an * 3.0 + 0.5236)), 700.0);
    acc += mix(gSunCol, vec3(1.0), 0.5) * (rays * exp(-dd * 5.0) * 2.6 + exp(-dd * 11.0) * 1.4) * star;
  }
  return acc;
}

void main() {
  gAsp = uRes.x / uRes.y;
  setupTod();
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float px = 1.0 / uRes.y;
  vec3 col = world(p, true);

  // Glass orbs: the frontmost (largest) orb under the pixel refracts the world upside-down.
  float burstOn = step(0.001, uBurst);
  float orbVis = mix(1.0, smoothstep(2.2, 5.0, uDropT), burstOn);
  vec2 c; float R; float sd;
  if (orbVis > 0.001) {
    float bestR = 0.0; vec2 bestC = vec2(0.0); float bestS = 0.0;
    for (int i = 0; i < 27; i++) {
      if (!orbAt(i, c, R, sd)) continue;
      if (R > bestR && length(p - c) < R + px) { bestR = R; bestC = c; bestS = sd; }
    }
    if (bestR > 0.0) {
      vec2 q = (p - bestC) / bestR;
      float r2 = dot(q, q);
      float r = sqrt(r2);
      float cov = clamp((1.0 - r) * bestR * uRes.y + 0.5, 0.0, 1.0) * orbVis;
      float z = sqrt(max(1.0 - r2, 0.0));
      vec3 refr = world(bestC - q * (1.0 + 0.6 * r2) * bestR * (1.4 + 1.6 * uRefract), false);
      vec3 oc = refr * mix(vec3(1.0), uPal[3], 0.2) * (0.95 - 0.3 * r2);
      vec3 env = mix(uPal[2] * gLight * 0.35, mix(gHor, gZen, clamp(q.y, 0.0, 1.0)) * 1.1, smoothstep(-0.35, 0.15, q.y));
      float F = 0.04 + 0.96 * pow(1.0 - z, 4.0);
      oc = mix(oc, env, F * 0.85);
      vec2 wq = rot2(0.3) * ((q * (1.0 + 0.35 * r2) - vec2(-0.26, 0.47)) / vec2(0.36, 0.17));
      float win = 1.0 - smoothstep(-0.12, 0.05, sdRoundBox(wq, vec2(1.0), 0.7));
      float mull = smoothstep(0.03, 0.08, abs(wq.x - 0.28));
      vec3 specC = mix(gSunCol, vec3(1.0), 0.6) * (0.35 + 0.65 * gDay);
      oc += specC * win * mull * mix(0.5, 2.2, smoothstep(-1.0, 0.8, wq.y));
      vec2 s2 = q - vec2(0.42, -0.5);
      oc += specC * exp(-dot(s2, s2) * 90.0) * 0.7;
      vec2 cq = (q - vec2(0.18, -0.58)) * vec2(1.7, 3.4);
      float caus = exp(-dot(cq, cq)) * smoothstep(1.0, 0.85, r);
      oc += (gSunCol * 0.5 + uPal[3] * 0.6) * caus * (0.4 + 1.8 * uKick);
      float rim = smoothstep(0.8, 0.985, r);
      oc += (0.5 + 0.5 * cos(6.2832 * (r * 1.6 + bestS + vec3(0.0, 0.33, 0.67)))) * rim * 0.22;
      oc += uPal[4] * smoothstep(0.93, 0.985, r) * 0.5;
      col = mix(col, oc, cov);
    }
  }

  // Drop burst: every orb pops into a ring of glossy beads flying toward the lens.
  if (burstOn > 0.0 && uDropT < 0.8) {
    float e = uDropT / 0.8;
    float ee = 1.0 - pow(1.0 - e, 3.0);
    for (int i = 0; i < 27; i++) {
      if (!orbAt(i, c, R, sd)) continue;
      float dc = length(p - c);
      if (dc > R * 3.4) continue;
      col += mix(uPal[3], uPal[4], 0.5) * exp(-pow((dc / R - (1.0 + 1.6 * ee)) * 9.0, 2.0)) * (1.0 - e) * 0.5;
      for (int j = 0; j < 7; j++) {
        float an = float(j) * 0.8976 + sd * 6.2832;
        vec2 bp = c + vec2(cos(an), sin(an)) * R * (0.5 + 2.4 * ee);
        float br = R * (0.1 + 0.12 * ee);
        vec2 bq = (p - bp) / br;
        float bd = length(bq);
        float bc = clamp((1.0 - bd) * br * uRes.y + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.6, 1.0, e));
        if (bc <= 0.0) continue;
        vec3 bcol = mix(col, uPal[3] * 0.5, 0.4) * (0.7 + 0.5 * bd) + uPal[4] * exp(-dot(bq - vec2(-0.35, 0.4), bq - vec2(-0.35, 0.4)) * 12.0) * 2.0;
        col = mix(col, bcol, bc);
      }
    }
  }

  // Bubbles (hats make a few twinkle); a fast stream joins them during a build.
  if (uBubbles > 0.0) {
    vec4 b1 = bubbleLayer(p, 22.0, 1.2, 0.035 * uBubbles, 1.0);
    vec4 b2 = bubbleLayer(p + vec2(0.31, 0.0), 12.0, 0.6, 0.025 * uBubbles, 5.0);
    col = col * (1.0 - 0.25 * (b1.a + b2.a)) + b1.rgb + b2.rgb;
    if (uBuild > 0.01) {
      vec4 b3 = bubbleLayer(p + vec2(0.13, 0.0), 16.0, 3.2, 0.08 * uBubbles, 9.0);
      col = col * (1.0 - 0.25 * b3.a * uBuild) + b3.rgb * uBuild;
    }
  }

  // Dew on a glass pane in front of the lens; after a drop the burst lands here as bigger drops.
  float dCov = 0.0; vec2 dq = vec2(0.0); vec2 dc = vec2(0.0); float dR = 0.0;
  if (uDew > 0.0) {
    float cs = 0.045;
    vec2 g = p / cs;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    if (hash21(id + 31.7) < uDew * 0.4) {
      vec2 hh = hash22(id + 5.3);
      float rr = mix(0.07, 0.24, hh.x * hh.x);
      vec2 o = (hh - 0.5) * (0.9 - 2.0 * rr);
      vec2 qq = (f - o) / rr;
      qq.y *= qq.y > 0.0 ? 1.12 : 0.95;
      float cov = clamp((1.0 - length(qq)) * rr * cs * uRes.y + 0.5, 0.0, 1.0);
      if (cov > 0.0) { dCov = cov; dq = qq; dc = (id + 0.5 + o) * cs; dR = rr * cs; }
    }
  }
  if (burstOn > 0.0 && uDropT < 15.0) {
    float cs = 0.1;
    vec2 g = p / cs + vec2(0.37, 0.61);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float vis = smoothstep(0.03, 0.3, uDropEnv);
    if (hash21(id + 77.1) < 0.32 * uBurst && vis > 0.0) {
      vec2 hh = hash22(id + 9.1);
      float tA = 0.25 + 0.6 * hash21(id + 3.3);
      float rr = mix(0.14, 0.3, hh.x) * easeOutBack((uDropT - tA) / 0.2);
      vec2 o = (hh - 0.5) * 0.3;
      o.y -= min(max(uDropT - tA - 1.5, 0.0) * 0.012 * hh.y, 0.08);
      vec2 qq = (f - o) / max(rr, 1e-4);
      qq.y *= qq.y > 0.0 ? 1.12 : 0.95;
      float cov = clamp((1.0 - length(qq)) * rr * cs * uRes.y + 0.5, 0.0, 1.0) * vis;
      if (rr > 0.0 && cov > dCov) { dCov = cov; dq = qq; dc = (id + 0.5 + o - vec2(0.37, 0.61)) * cs; dR = rr * cs; }
    }
  }
  if (dCov > 0.0) {
    vec3 refr = world(dc - dq * dR * 8.0, false);
    float r = length(dq);
    vec3 dcol = refr * (1.0 + 0.2 * (1.0 - r * r));
    dcol *= mix(1.0, 0.3, smoothstep(0.68, 1.0, r));
    vec2 hl = dq - vec2(-0.3, 0.42);
    dcol += uPal[4] * exp(-dot(hl, hl) * 38.0) * 2.2;
    dcol += gSunCol * 0.45 * exp(-pow((dq.y + 0.62) * 5.0, 2.0)) * smoothstep(0.7, 0.0, abs(dq.x));
    col = mix(col, dcol, dCov);
  }

  col += lensFlare(p);
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

const TOD_SEQ: Record<string, number[]> = {
  cycle: [0, 1, 2, 3],
  day: [0, 1],
  dusk: [2, 3],
  morning: [0],
  noon: [1],
  golden: [2],
  twilight: [3],
};

const mod = (a: number, n: number) => ((a % n) + n) % n;
const smooth = (x: number) => x * x * (3 - 2 * x);
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Glass meadow: a glossy aero world. Drifting glass orbs refract a swaying
 * green hill and a cumulus sky; a big orb bounces up on every downbeat, a light
 * ribbon sweeps the sky each bar, the time of day steps every phrase, and on a
 * drop every orb bursts into droplets that land on the lens with a star flare.
 */
export class GlassMeadow extends ShaderGenerator {
  readonly kind = 'glassMeadow';
  private build = 0;

  constructor() {
    super(FRAG, {
      uTodW: { value: new THREE.Vector4(1, 0, 0, 0) },
      uWind: { value: 0 },
      uBarIdx: { value: 0 },
      uBarBeat: { value: 0 },
      uRibHead: { value: -9 },
      uRibTail: { value: -9 },
      uRibDir: { value: 1 },
      uRibSeed: { value: 0 },
      uRibAmp: { value: 1 },
      uBuild: { value: 0 },
      uDropT: { value: 1e3 },
      uDropEnv: { value: 0 },
      uOrbs: { value: 14 },
      uOrbSize: { value: 1 },
      uRise: { value: 1 },
      uHero: { value: 1 },
      uRefract: { value: 1 },
      uBubbles: { value: 1 },
      uSway: { value: 1 },
      uClouds: { value: 1 },
      uAurora: { value: 1 },
      uFlare: { value: 1 },
      uDew: { value: 0.35 },
      uBurst: { value: 1 },
      uHQ: { value: 1 },
    });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const f = ctx.frame;
    const beat = ctx.beat;
    const bpb = Math.max(1, Math.round(f.beatsPerBar || 4));
    const bpp = Math.max(bpb, Math.round(f.beatsPerPhrase || 16));

    // Time of day: one step per phrase, crossfading over the first bar.
    const seq = TOD_SEQ[String(p.timeOfDay)] ?? TOD_SEQ.cycle;
    const phrase = Math.floor(beat / bpp);
    const fade = smooth(Math.min(1, (beat - phrase * bpp) / bpb));
    const w = [0, 0, 0, 0];
    w[seq[mod(phrase - 1, seq.length)]] += 1 - fade;
    w[seq[mod(phrase, seq.length)]] += fade;
    (u.uTodW.value as THREE.Vector4).set(w[0], w[1], w[2], w[3]);

    // Wind steps one eased notch per beat.
    const bi = Math.floor(beat);
    u.uWind.value = mod(bi, 4) + easeOutCubic(Math.min(1, (beat - bi) / 0.4));

    // Bars: the downbeat orb and the ribbon sweep (head enters on beat 1, tail gone by the bar end).
    const bar = Math.floor(beat / bpb);
    const barBeat = beat - bar * bpb;
    u.uBarIdx.value = bar;
    u.uBarBeat.value = barBeat;
    const x = barBeat / bpb;
    const span = (ctx.width / Math.max(1, ctx.height)) * 0.5 + 0.45;
    u.uRibHead.value = -span + 2 * span * easeOutCubic(Math.min(1, x / 0.55));
    u.uRibTail.value = -span - 0.4 + (2 * span + 0.8) * easeInOutCubic(x);
    u.uRibDir.value = mod(bar, 2) === 0 ? 1 : -1;
    u.uRibSeed.value = hash01(bar, 71) * 6.2832;
    u.uRibAmp.value = smooth(Math.min(1, x * 8));

    // Build: a slow envelope of the energy trend (drives flare, sun and a fast bubble stream).
    const k = 1 - Math.exp(-Math.min(ctx.dt, 0.1) / 1.2);
    this.build += ((f.energyTrend === 'building' ? 1 : 0) - this.build) * k;
    u.uBuild.value = this.build;
    // Seconds since the last drop, recovered from the drop envelope (exp(-t / 3)).
    const de = ctx.env.drop;
    u.uDropEnv.value = de;
    u.uDropT.value = de > 1e-3 ? -3 * Math.log(de) : 1e3;
    const dbg = num(p.dew, 0.35); if (dbg > 0.9) { u.uDropT.value = (dbg - 0.9) * 20; u.uDropEnv.value = Math.exp(-u.uDropT.value / 3); } // DEBUG-REMOVE

    u.uOrbs.value = Math.round(num(p.orbs, 14));
    u.uOrbSize.value = num(p.orbSize, 1);
    u.uRise.value = num(p.rise, 1);
    u.uHero.value = p.heroOrb === false ? 0 : 1;
    u.uRefract.value = num(p.refraction, 1);
    u.uBubbles.value = num(p.bubbles, 1);
    u.uSway.value = num(p.sway, 1);
    u.uClouds.value = num(p.clouds, 1);
    u.uAurora.value = num(p.aurora, 1);
    u.uFlare.value = num(p.flare, 1);
    u.uDew.value = Math.min(0.9, num(p.dew, 0.35)); // DEBUG-REMOVE min
    u.uBurst.value = num(p.burst, 1);
    u.uHQ.value = p.quality === 'low' ? 0 : 1;
  }
}
