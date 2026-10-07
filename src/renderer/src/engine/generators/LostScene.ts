import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/** Scene names, in shader order. */
export const LOST_SCENES = ['bars', 'testcard', 'tower', 'radar', 'candles', 'studio', 'puppet', 'cctv', 'lake', 'globe', 'scenic', 'shortwave', 'intertitle', 'desktop', 'player'] as const;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uScene, uVariant;
uniform float uReact, uEerie, uTint, uSpin;
float PX;
float ASP;

vec3 S(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float fillD(float d) { return clamp(0.5 - d / PX, 0.0, 1.0); }
float strokeD(float d, float w) { return clamp(0.5 - (abs(d) - w) / PX, 0.0, 1.0); }
float bevel(vec2 p, vec2 c, vec2 b) {
  // +1 on the lit top/left edge, -1 on the shaded bottom/right edge, 0 inside.
  vec2 q = p - c;
  float e = 2.5 * PX;
  float top = step(b.y - e, q.y) + step(q.x, -b.x + e);
  float bot = step(q.y, -b.y + e) + step(b.x - e, q.x);
  return clamp(top, 0.0, 1.0) - clamp(bot, 0.0, 1.0);
}

// ---------------------------------------------------------------- test signals
vec3 sceneBars(vec2 uv) {
  if (uVariant == 1) {
    vec3 eb[8] = vec3[8](vec3(1.0), vec3(1.0, 1.0, 0.0), vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0));
    return S(eb[int(clamp(floor(uv.x * 8.0), 0.0, 7.0))] * 0.75);
  }
  vec3 top[7] = vec3[7](vec3(0.75), vec3(0.75, 0.75, 0.0), vec3(0.0, 0.75, 0.75), vec3(0.0, 0.75, 0.0), vec3(0.75, 0.0, 0.75), vec3(0.75, 0.0, 0.0), vec3(0.0, 0.0, 0.75));
  vec3 mid[7] = vec3[7](vec3(0.0, 0.0, 0.75), vec3(0.0), vec3(0.75, 0.0, 0.75), vec3(0.0), vec3(0.0, 0.75, 0.75), vec3(0.0), vec3(0.75));
  int i = int(clamp(floor(uv.x * 7.0), 0.0, 6.0));
  if (uv.y > 0.33) return S(top[i]);
  if (uv.y > 0.25) return S(mid[i]);
  float x = uv.x * 7.0;
  if (x < 1.25) return S(vec3(0.0, 0.13, 0.3));
  if (x < 2.5) return S(vec3(1.0));
  if (x < 3.75) return S(vec3(0.2, 0.0, 0.42));
  if (x < 5.0) return vec3(0.0);
  if (x < 5.33) return S(vec3(0.0));
  if (x < 5.66) return S(vec3(0.075));
  if (x < 6.0) return S(vec3(0.15));
  return vec3(0.0);
}

vec3 sceneCard(vec2 p) {
  vec3 c = S(vec3(0.42));
  vec2 g = abs(fract(p * 9.0 + 0.5) - 0.5) / 9.0;
  c = mix(c, S(vec3(0.92)), strokeD(min(g.x, g.y), 0.0012));
  // Castellations down both sides.
  float edge = ASP * 0.5 - abs(p.x);
  if (edge < 0.05) c = mix(S(vec3(0.95)), vec3(0.0), step(0.5, fract(p.y * 9.0 + 0.5 + step(0.0, p.x) * 0.5)));
  float R = 0.42;
  float r = length(p);
  if (r < R + PX) {
    float y = p.y / R;
    float xx = p.x / R * 0.5 + 0.5;
    vec3 inner;
    if (y > 0.55) inner = S(vec3(floor(xx * 6.0) / 5.0));
    else if (y > 0.2) {
      vec3 bb[6] = vec3[6](vec3(1.0, 1.0, 0.0), vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0));
      inner = S(bb[int(clamp(floor(xx * 6.0), 0.0, 5.0))] * 0.8);
    } else if (y > -0.2) {
      inner = vec3(0.0);
      inner = mix(inner, S(vec3(0.9)), strokeD(abs(y) - 0.2, 0.0015));
    } else if (y > -0.55) {
      float seg = floor(xx * 5.0);
      inner = S(vec3(step(0.0, sin(p.x * (40.0 + seg * 60.0) * 6.28318)))) * 0.85;
    } else inner = p.x < 0.0 ? S(vec3(0.9)) : S(vec3(0.6, 0.05, 0.05));
    c = mix(c, inner, fillD(r - R));
    c = mix(c, S(vec3(0.95)), strokeD(r - R, 0.0025));
  }
  return c;
}

// ---------------------------------------------------------------- broadcast night
vec3 sceneTower(vec2 p, vec2 uv) {
  float h = uv.y;
  vec3 c = mix(S(vec3(0.95, 0.5, 0.25)), S(vec3(0.04, 0.06, 0.18)), smoothstep(0.12, 0.85, h));
  c = mix(c, S(vec3(0.55, 0.25, 0.4)), smoothstep(0.25, 0.0, abs(h - 0.32)) * 0.35);
  vec2 sg = floor(p * 140.0);
  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash21(sg) * 30.0);
  c += vec3(step(0.996, hash21(sg)) * smoothstep(0.5, 0.9, h) * tw) * 0.8;
  float cl = fbm(vec2(p.x * 2.0 + uTime * 0.02, p.y * 6.0));
  c = mix(c, c * 0.55 + S(vec3(0.28, 0.14, 0.2)), smoothstep(0.55, 0.8, cl) * smoothstep(0.15, 0.6, h) * 0.6);
  float hill = -0.3 + 0.05 * sin(p.x * 3.0 + 1.0) + 0.03 * sin(p.x * 7.0) + 0.03 * fbm(vec2(p.x * 4.0, 0.0));
  float sil = fillD(p.y - hill);
  // Lattice tower: tapered legs, zig-zag bracing, a mast and blinking warning lights.
  vec2 q = p - vec2(0.2, -0.28);
  float H = 0.6;
  if (q.y > 0.0 && q.y < H) {
    float w = mix(0.06, 0.006, q.y / H);
    float legs = abs(abs(q.x) - w);
    float s = 0.045;
    float t = fract(q.y / s);
    float slope = 2.0 * w / s;
    float diag = min(abs(q.x - mix(-w, w, t)), abs(q.x + mix(-w, w, t))) / sqrt(1.0 + slope * slope);
    float rung = abs(t - 0.5) < 0.5 ? min(t, 1.0 - t) * s : 1.0;
    float inside = step(abs(q.x), w + PX);
    sil = max(sil, strokeD(legs, 0.0018));
    sil = max(sil, strokeD(diag, 0.0009) * inside);
    sil = max(sil, strokeD(rung, 0.0008) * inside);
  }
  sil = max(sil, strokeD(q.x, 0.0012) * step(H - 0.01, q.y) * step(q.y, H + 0.08));
  c = mix(c, S(vec3(0.02, 0.02, 0.04)), sil);
  for (int i = 0; i < 4; i++) {
    float ly = float(i + 1) / 4.0 * H + (i == 3 ? 0.08 : 0.0);
    float on = step(0.5, fract(uBeat * 0.5 + float(i) * 0.25 * float(uVariant)));
    float d = length(q - vec2(0.0, ly));
    c += S(vec3(1.0, 0.1, 0.05)) * (fillD(d - 0.005) * 2.0 + exp(-d * 60.0) * 0.6) * on;
  }
  return c;
}

vec3 sceneRadar(vec2 p) {
  vec2 m = p * 2.2 + vec2(0.3, 0.1);
  float land = fbm(m * 1.3 + 3.1);
  vec3 c = mix(S(vec3(0.03, 0.1, 0.32)), S(vec3(0.16, 0.33, 0.12)), smoothstep(0.47, 0.5, land));
  c = mix(c, S(vec3(0.6, 0.7, 0.45)), (1.0 - smoothstep(0.0, 0.006, abs(land - 0.485))) * 0.7);
  vec2 gg = abs(fract(m * 3.0) - 0.5);
  c += S(vec3(0.25)) * (1.0 - smoothstep(0.0, 0.012, min(gg.x, gg.y))) * 0.3 * step(0.49, land);
  float rain = fbm(m * 2.0 - vec2(uTime * 0.05, uTime * 0.02));
  float inten = smoothstep(0.52, 0.8, rain + 0.12 * uBass * uReact);
  vec3 rc = inten < 0.33 ? mix(S(vec3(0.1, 0.55, 0.15)), S(vec3(0.15, 0.85, 0.1)), inten * 3.0)
          : inten < 0.66 ? mix(S(vec3(0.95, 0.9, 0.1)), S(vec3(1.0, 0.55, 0.05)), (inten - 0.33) * 3.0)
          : mix(S(vec3(1.0, 0.15, 0.05)), S(vec3(0.9, 0.1, 0.6)), (inten - 0.66) * 3.0);
  float swA = mod(uBeat / uBeatsPerBar * 6.28318, 6.28318);
  float behind = mod(swA - atan(p.y, p.x) + 6.28318, 6.28318);
  float glow = exp(-behind * 1.2);
  c = mix(c, rc, step(0.01, inten) * (0.55 + 0.45 * glow));
  c += S(vec3(0.1, 0.9, 0.3)) * exp(-behind * 14.0) * 0.35;
  c += S(vec3(0.2, 0.6, 0.3)) * strokeD(abs(fract(length(p) * 6.0 + 0.5) - 0.5) / 6.0, 0.0006) * 0.25;
  for (int i = 0; i < 7; i++) {
    vec2 cp = (hash22(vec2(float(i), 9.0)) - 0.5) * vec2(1.4, 0.75);
    c = mix(c, vec3(1.0), fillD(length(p - cp) - 0.006));
  }
  return c;
}

// ---------------------------------------------------------------- home video
vec3 sceneCandles(vec2 p) {
  vec3 c = S(vec3(0.05, 0.025, 0.015));
  for (int i = 0; i < 14; i++) {
    vec2 h = hash22(vec2(float(i), 3.0));
    vec2 pos = (h - 0.5) * vec2(1.9, 1.0) + vec2(sin(uTime * 0.1 + h.x * 6.0) * 0.03, 0.0);
    float d = length(p - pos) - (0.03 + 0.05 * hash11(float(i) * 7.0));
    vec3 bc = mix(S(vec3(1.0, 0.6, 0.25)), palette(h.y), uTint);
    c += bc * (fillD(d) * 0.1 + strokeD(d, 0.002) * 0.06) * (0.7 + 0.3 * sin(uTime + h.x * 10.0));
  }
  float flick = 0.85 + 0.15 * vnoise(vec2(uTime * 8.0, 1.0)) + 0.25 * uKick * uReact;
  float light = flick * exp(-length(p - vec2(0.0, -0.05)) * 2.2);
  c += S(vec3(1.0, 0.55, 0.2)) * light * 0.45;
  float cake = sdRoundBox(p - vec2(0.0, -0.37), vec2(0.42, 0.19), 0.03);
  float drip = p.y - (-0.2 - 0.025 * (0.5 + 0.5 * sin(p.x * 60.0)) * step(0.0, sin(p.x * 30.0)));
  vec3 sponge = S(vec3(0.85, 0.55, 0.65)) * (0.1 + 0.9 * light);
  vec3 frost = S(vec3(0.97, 0.9, 0.92)) * (0.12 + 0.95 * light);
  c = mix(c, mix(sponge, frost, fillD(-drip)), fillD(cake));
  int N = 3 + 2 * clamp(uVariant, 0, 3);
  for (int i = 0; i < 9; i++) {
    if (i >= N) break;
    float x = (float(i) - float(N - 1) * 0.5) * 0.08;
    float base = -0.18;
    float stick = sdBox(p - vec2(x, base + 0.06), vec2(0.009, 0.06));
    vec3 sc = mix(palette(0.2 + 0.15 * float(i)), S(vec3(0.95)), step(0.5, fract((p.y - p.x * 0.5) * 40.0)));
    c = mix(c, sc * (0.3 + 0.9 * light), fillD(stick));
    vec2 fp = p - vec2(x + 0.004 * sin(uTime * 9.0 + float(i)), base + 0.15);
    float r = 0.02 * flick;
    float fl = length(vec2(fp.x * (1.0 + max(fp.y, 0.0) * 45.0), fp.y * 0.65)) - r;
    c += S(vec3(1.0, 0.78, 0.4)) * fillD(fl) * 2.5;
    c += S(vec3(1.0, 0.5, 0.15)) * exp(-length(fp) * 28.0) * 0.8 * flick;
  }
  return c;
}

vec3 sceneStudio(vec2 p) {
  vec2 o = p - vec2(0.0, 0.12);
  float ang = atan(o.y, o.x);
  float r = length(o);
  float sw = sin(ang * 5.0 + r * 18.0 - uTime * (1.0 + uSpin) - uBeat * 0.6);
  vec3 c = mix(palette(0.2), palette(0.7), 0.5 + 0.5 * sw) * 0.55;
  c = mix(c, palette(0.95), smoothstep(0.92, 1.0, sw) * 0.5 * (0.6 + 0.4 * uKick * uReact));
  if (uVariant == 1) c = mix(c, S(vec3(0.1, 0.8, 0.2)), smoothstep(0.7, 0.95, abs(p.x) / (ASP * 0.5)) * 0.35);
  float hz = -0.12;
  if (p.y < hz) {
    float d = hz - p.y;
    float z = 0.25 / d;
    float chk = mod(floor(p.x * z * 2.0) + floor(z * 2.0 + uTime * 0.6), 2.0);
    vec3 fl = mix(palette(0.1) * 0.25, palette(0.85) * 0.7, chk);
    c = mix(c, fl, smoothstep(0.0, 0.05, d));
  }
  float desk = sdBox(p - vec2(0.0, -0.37), vec2(0.5, 0.13));
  c = mix(c, S(vec3(0.16, 0.1, 0.07)) * (0.8 + 0.2 * sin(p.x * 80.0)), fillD(desk));
  c += S(vec3(0.7, 0.5, 0.35)) * strokeD(p.y + 0.24, 0.002) * step(abs(p.x), 0.5) * 0.7;
  float mug = sdRoundBox(p - vec2(0.32, -0.2), vec2(0.025, 0.035), 0.005);
  c = mix(c, palette(0.5) * 0.6, fillD(mug));
  return c;
}

vec3 scenePuppet(vec2 p) {
  float e = uEerie;
  vec3 wall = mix(S(vec3(1.0, 0.86, 0.55)), S(vec3(0.33, 0.31, 0.29)), e);
  vec2 dp = p * 10.0;
  dp.x += 0.5 * step(1.0, mod(floor(dp.y), 2.0));
  float dots = (length(fract(dp) - 0.5) - 0.18) / 10.0;
  vec3 c = mix(wall, mix(palette(0.3), S(vec3(0.22)), e), fillD(dots));
  if (p.y < -0.3) c = mix(S(vec3(0.3, 0.6, 0.9)), S(vec3(0.18)), e) * (0.8 + 0.2 * step(0.5, fract(p.x * 6.0)));
  // A sun with a face, slowly turning.
  vec2 sp = p - vec2(ASP * 0.5 - 0.22, 0.3);
  float sr = length(sp);
  float rays = step(0.5, fract((atan(sp.y, sp.x) + uTime * 0.3) / 6.28318 * 12.0)) * step(0.1, sr) * step(sr, 0.15);
  vec3 sunC = mix(S(vec3(1.0, 0.8, 0.1)), S(vec3(0.5, 0.48, 0.4)), e);
  c = mix(c, sunC, max(fillD(sr - 0.09), rays));
  float sface = min(min(length(sp - vec2(-0.03, 0.02)), length(sp - vec2(0.03, 0.02))) - 0.009, abs(length(sp - vec2(0.0, 0.01)) - 0.045) + step(-0.01, sp.y) * 1.0);
  c = mix(c, S(vec3(0.15, 0.08, 0.02)), fillD(sface - 0.003));
  // The puppet: felt head and body, roving eyes that blink every two bars, a mouth that sings.
  float bob = abs(sin(uBeat * 3.14159)) * 0.018 * uReact * (1.0 - e);
  vec2 hp = p - vec2(-0.05, 0.03 + bob);
  vec3 felt = palette(0.55 + 0.12 * float(uVariant)) * (0.85 + 0.3 * vnoise(p * 220.0));
  felt = mix(felt, S(vec3(0.45, 0.42, 0.4)), e * 0.7);
  float body = sdRoundBox(p - vec2(-0.05, -0.33 + bob), vec2(0.16, 0.14), 0.06);
  c = mix(c, felt * 0.75, fillD(body));
  c = mix(c, felt, fillD(length(hp * vec2(1.0, 1.1)) - 0.2));
  vec2 look = vec2(sin(uTime * 0.4), cos(uTime * 0.31)) * 0.012 * (1.0 - e);
  float blink = step(0.95, fract(uBeat / (uBeatsPerBar * 2.0))) * (1.0 - e);
  for (int s = -1; s <= 1; s += 2) {
    vec2 ep = hp - vec2(float(s) * 0.075, 0.06);
    float white = length(ep * vec2(1.0, blink > 0.5 ? 9.0 : 1.0)) - 0.048;
    c = mix(c, mix(S(vec3(0.97)), S(vec3(0.8)), e), fillD(white));
    if (blink < 0.5) c = mix(c, vec3(0.0), fillD(length(ep - look) - mix(0.02, 0.04, e)));
  }
  float open = clamp(uMids * 1.4 + uBass * 0.6, 0.0, 1.0) * uReact * (1.0 - e);
  vec2 mp = hp - vec2(0.0, -0.085);
  vec2 ab = vec2(0.085, 0.085 * (0.12 + 0.8 * open));
  float mouth = (length(mp / ab) - 1.0) * min(ab.x, ab.y);
  float grin = abs(length(mp - vec2(0.0, 0.07)) - 0.11) - 0.006 + step(-0.04, mp.y);
  c = mix(c, S(vec3(0.35, 0.03, 0.05)), fillD(mix(mouth, grin, step(0.5, e))));
  return c;
}

// ---------------------------------------------------------------- security camera
vec3 cctvCam(int k, vec2 l, float t) {
  vec3 c = vec3(0.0);
  if (k == 0) {
    // Mall corridor: floor tiles, ceiling lights, lit shop fronts receding.
    vec3 rd = vec3(l.x, l.y - 0.03, 1.0);
    float tf = rd.y < 0.0 ? 0.35 / -rd.y : 1e9;
    float tc = rd.y > 0.0 ? 0.3 / rd.y : 1e9;
    float tw = 0.6 / max(abs(rd.x), 1e-4);
    float tt = min(min(tf, tc), tw);
    vec3 hp = rd * tt;
    if (tt == tf) c = vec3(0.35 + 0.15 * mod(floor(hp.x * 3.0) + floor(hp.z * 3.0), 2.0));
    else if (tt == tc) c = vec3(0.12 + 1.6 * step(fract(hp.z * 0.7), 0.15) * step(abs(hp.x), 0.25));
    else {
      float seg = floor(hp.z / 1.2);
      float lit = 0.25 + 0.6 * hash11(seg + step(0.0, rd.x) * 50.0);
      float win = step(0.15, fract(hp.z / 1.2)) * step(hp.y, 0.15) * step(-0.3, hp.y);
      c = vec3(0.08 + lit * win);
    }
    c *= exp(-tt * 0.12);
  } else if (k == 1) {
    // Fountain: a basin and spray that leaps with the bass.
    c = vec3(0.28 + 0.06 * mod(floor(l.x * 12.0) + floor(l.y * 12.0), 2.0));
    float basin = length((l - vec2(0.0, -0.22)) * vec2(1.0, 3.0)) - 0.32;
    c = mix(c, vec3(0.5), strokeD(basin * 0.5, 0.004));
    c = mix(c, vec3(0.16), fillD(basin * 0.5));
    for (int i = 0; i < 28; i++) {
      float hsh = hash11(float(i) * 3.1);
      float ph = fract(t * 0.6 + hsh);
      vec2 pp = vec2((hsh - 0.5) * 0.3 * ph, -0.2 + ph * (1.0 - ph) * 4.0 * 0.3 * (0.7 + 0.6 * uBass * uReact));
      c += vec3(0.8) * fillD(length(l - pp) - 0.006);
    }
  } else if (k == 2) {
    // Parking lot: stall lines in perspective, two pools of lamp light, a parked car.
    c = vec3(0.05);
    if (l.y < 0.05) {
      float z = 0.2 / (0.05 - l.y);
      float x = l.x * z;
      c = vec3(0.08) + vec3(0.6) * step(abs(fract(x * 1.2) - 0.5), 0.02) * step(fract(z * 0.5), 0.6);
      for (int i = 0; i < 2; i++) {
        vec2 lp = vec2(float(i) * 1.6 - 0.8, 2.5);
        c += vec3(0.5) * exp(-length(vec2(x, z) - lp) * 1.4);
      }
    }
    c = mix(c, vec3(0.02), fillD(sdRoundBox(l - vec2(0.12, -0.18), vec2(0.16, 0.05), 0.03)));
    c = mix(c, vec3(0.02), fillD(sdRoundBox(l - vec2(0.1, -0.12), vec2(0.09, 0.04), 0.03)));
  } else {
    // Escalator: steps climbing a diagonal, handrails either side.
    vec2 q = rot2(-0.55) * l;
    c = vec3(0.18);
    if (abs(q.y) < 0.12) c = vec3(0.25 + 0.3 * step(0.5, fract(q.x * 14.0 - t * 1.5)));
    c = mix(c, vec3(0.05), strokeD(abs(q.y) - 0.13, 0.008));
  }
  return c;
}

vec3 sceneCctv(vec2 uv) {
  vec2 qi = floor(uv * 2.0);
  vec2 l = fract(uv * 2.0) - 0.5;
  l.x *= ASP;
  l *= 1.0 + 0.3 * dot(l, l);
  float t = floor(uTime * 6.0) / 6.0;
  int k = int(qi.x + qi.y * 2.0);
  k = int(mod(float(k + uVariant), 4.0));
  vec3 c = cctvCam(k, l, t + float(k) * 3.0);
  c *= 1.0 - 0.9 * dot(l, l);
  c *= vec3(0.9, 1.05, 0.92);
  vec2 g = abs(fract(uv * 2.0 + 0.5) - 0.5);
  c *= smoothstep(0.0, 0.004, min(g.x, g.y));
  return c;
}

vec3 skyLake(vec2 q, vec2 sun, float hz) {
  vec3 c = mix(S(vec3(1.0, 0.82, 0.62)), S(vec3(0.32, 0.55, 0.88)), smoothstep(hz, 0.5, q.y));
  float d = length(q - sun);
  c += S(vec3(1.0, 0.8, 0.5)) * exp(-d * 6.0) * 0.8;
  c += S(vec3(1.0, 0.95, 0.85)) * fillD(d - 0.035) * 2.0;
  return c;
}

vec3 sceneLake(vec2 p) {
  float hz = -0.03;
  vec2 sun = vec2(0.25, 0.13);
  float ridge = hz + 0.035 + 0.03 * fbm(vec2(p.x * 5.0, 1.0)) + 0.025 * (1.0 - abs(fract(p.x * 38.0) - 0.5) * 2.0) * step(0.45, vnoise(vec2(p.x * 9.0, 2.0)));
  vec3 trees = S(vec3(0.05, 0.1, 0.06));
  vec3 c;
  if (p.y > hz) {
    c = mix(skyLake(p, sun, hz), trees, fillD(p.y - ridge));
  } else {
    float wob = 0.004 * sin(p.y * 140.0 + uTime * 2.0) + 0.002 * sin(p.x * 50.0 + uTime * 3.0);
    vec2 q = vec2(p.x + wob, 2.0 * hz - p.y);
    float rr = hz + 0.035 + 0.03 * fbm(vec2(q.x * 5.0, 1.0));
    c = mix(skyLake(q, sun, hz) * 0.7, trees * 0.8, step(q.y, rr)) * vec3(0.85, 0.95, 1.0);
    float col = smoothstep(0.12 * (hz - p.y + 0.05) * 4.0, 0.0, abs(p.x - sun.x));
    float sp = step(0.982 - 0.01 * uHat * uReact, hash21(floor(vec2(p.x * 320.0, p.y * 700.0)) + floor(uTime * 8.0)));
    c += S(vec3(1.0, 0.92, 0.75)) * sp * col * 2.5;
  }
  float dock = sdBox(rot2(0.12) * (p - vec2(-0.55, -0.42)), vec2(0.35, 0.06));
  vec3 wood = S(vec3(0.35, 0.22, 0.12)) * (0.7 + 0.3 * step(0.1, fract(p.x * 25.0)));
  c = mix(c, wood, fillD(dock));
  return c;
}

// ---------------------------------------------------------------- corporate & karaoke
vec3 sceneGlobe(vec2 p) {
  vec3 c = mix(S(vec3(0.02, 0.07, 0.28)), S(vec3(0.12, 0.38, 0.72)), smoothstep(-0.5, 0.5, p.y));
  float hz = -0.18;
  if (p.y < hz) {
    float z = 0.2 / (hz - p.y);
    float gx = abs(fract(p.x * z * 2.0) - 0.5);
    float gz = abs(fract(z * 2.0 + uTime * 0.4) - 0.5);
    float line = max(1.0 - smoothstep(0.0, 0.04 * z, gx * 1.0), 1.0 - smoothstep(0.0, 0.04 * z, gz));
    c = mix(c, S(vec3(0.3, 0.9, 1.0)), line * exp(-z * 0.2) * 0.8);
  }
  vec2 g = p - vec2(0.0, 0.06);
  float R = 0.26;
  float ringD = abs(length(vec2(g.x, g.y * 3.6)) - 0.4) / 3.6;
  float ring = strokeD(ringD, 0.0015);
  if (g.y > 0.0) c = mix(c, S(vec3(1.0, 0.85, 0.3)), ring);
  float d = length(g);
  if (d < R) {
    vec3 n = vec3(g, sqrt(R * R - d * d)) / R;
    float a = uTime * 0.35 + uBeat * 0.05 * uSpin;
    vec3 m = vec3(n.x * cos(a) + n.z * sin(a), n.y, -n.x * sin(a) + n.z * cos(a));
    float lat = asin(clamp(m.y, -1.0, 1.0));
    float lon = atan(m.x, m.z);
    float gl = min(abs(fract(lat / 0.3927 + 0.5) - 0.5), abs(fract(lon / 0.3927 + 0.5) - 0.5));
    vec3 sph = S(vec3(0.02, 0.1, 0.35)) * (0.4 + 0.6 * n.z);
    sph = mix(sph, S(vec3(0.4, 0.95, 1.0)), 1.0 - smoothstep(0.02, 0.06, gl));
    sph += pow(max(dot(n, normalize(vec3(-0.4, 0.5, 0.8))), 0.0), 30.0) * 0.8;
    c = mix(c, sph, fillD(d - R));
  }
  if (g.y <= 0.0) c = mix(c, S(vec3(1.0, 0.85, 0.3)), ring);
  return c;
}

vec3 scenicBeach(vec2 p) {
  vec3 c = mix(S(vec3(1.0, 0.55, 0.25)), S(vec3(0.3, 0.12, 0.4)), smoothstep(0.0, 0.5, p.y));
  float sd = length(p - vec2(0.0, 0.0)) - 0.12;
  c = mix(c, S(vec3(1.0, 0.85, 0.4)), fillD(sd) * step(0.0, p.y));
  if (p.y < 0.0) {
    c = S(vec3(0.08, 0.1, 0.25)) * (1.0 + p.y);
    float stripe = smoothstep(0.1 + p.y * -0.3, 0.0, abs(p.x)) * step(0.4, fract(p.y * 60.0 + sin(p.x * 30.0 + uTime) * 0.3));
    c += S(vec3(1.0, 0.7, 0.3)) * stripe;
  }
  for (int i = 0; i < 2; i++) {
    float x0 = (i == 0 ? -0.62 : 0.66);
    float dir = i == 0 ? 1.0 : -1.0;
    float yy = clamp(p.y, -0.5, 0.18);
    float tx = x0 + dir * 0.09 * pow(yy + 0.5, 2.0);
    float trunk = abs(p.x - tx) - 0.012 * (1.0 - (yy + 0.5) * 0.5);
    float tr = fillD(trunk) * step(p.y, 0.18);
    vec2 top = vec2(x0 + dir * 0.09 * pow(0.68, 2.0), 0.18);
    float fr = 1e9;
    for (int k = 0; k < 6; k++) {
      float a = float(k) / 6.0 * 6.28318 + 0.3 + 0.05 * sin(uTime + float(k));
      vec2 tip = top + vec2(cos(a), sin(a) * 0.5 - 0.08) * 0.18;
      vec2 mid = top + (tip - top) * 0.5 + vec2(0.0, 0.03);
      fr = min(fr, min(sdSegment(p, top, mid), sdSegment(p, mid, tip)) - 0.006);
    }
    c = mix(c, S(vec3(0.03, 0.02, 0.05)), max(tr, fillD(fr)));
  }
  return c;
}

vec3 scenicCity(vec2 p) {
  vec3 c = mix(S(vec3(0.32, 0.18, 0.3)), S(vec3(0.0, 0.0, 0.05)), smoothstep(-0.2, 0.45, p.y));
  c += S(vec3(0.95, 0.95, 0.85)) * fillD(length(p - vec2(-0.45, 0.3)) - 0.05);
  float wy = p.y < -0.22 ? -0.44 - p.y + 0.003 * sin(p.y * 200.0 + uTime * 3.0) : p.y;
  float col = floor(p.x / 0.07);
  float hgt = -0.22 + 0.08 + 0.3 * hash11(col * 1.7);
  if (wy < hgt && wy > -0.22) {
    vec2 w = vec2(fract(p.x / 0.014), fract(wy / 0.02));
    float lit = step(0.55, hash21(vec2(floor(p.x / 0.014), floor(wy / 0.02)) + floor(uTime * 0.1)));
    float edgeX = step(0.06, fract(p.x / 0.07)) * step(fract(p.x / 0.07), 0.94);
    c = S(vec3(0.05, 0.04, 0.08)) + S(vec3(1.0, 0.8, 0.45)) * lit * step(0.4, w.x) * step(0.45, w.y) * edgeX * step(wy, hgt - 0.015) * 0.9;
  }
  if (p.y < -0.22) c *= 0.55;
  return c;
}

vec3 scenicAurora(vec2 p) {
  vec3 c = mix(S(vec3(0.02, 0.04, 0.1)), S(vec3(0.0, 0.0, 0.02)), smoothstep(-0.2, 0.5, p.y));
  c += vec3(step(0.995, hash21(floor(p * 160.0)))) * 0.7;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.15 + 0.08 * fi + 0.06 * sin(p.x * (2.0 + fi) + uTime * (0.2 + 0.1 * fi));
    float band = exp(-abs(p.y - y) * 18.0) * (0.5 + 0.5 * sin(p.x * 12.0 + uTime * 0.6 + fi));
    c += mix(S(vec3(0.1, 1.0, 0.5)), S(vec3(0.6, 0.2, 0.9)), fi / 2.0) * band * 0.5 * (1.0 + 0.4 * uBass * uReact);
  }
  float ridge1 = -0.05 + 0.12 * fbm(vec2(p.x * 2.0, 3.0));
  float ridge2 = -0.2 + 0.1 * fbm(vec2(p.x * 3.0 + 5.0, 1.0));
  c = mix(c, S(vec3(0.04, 0.05, 0.08)), fillD(p.y - ridge1));
  c = mix(c, S(vec3(0.01, 0.015, 0.02)), fillD(p.y - ridge2));
  return c;
}

vec3 scenicAt(int i, vec2 p) {
  if (i == 0) return scenicBeach(p);
  if (i == 1) return scenicCity(p);
  return scenicAurora(p);
}

vec3 sceneScenic(vec2 p) {
  float len = uBeatsPerBar * 8.0;
  float ph = uBeat / len;
  float k = floor(ph);
  float f = fract(ph);
  vec2 q = p * (1.0 - 0.06 * f) + vec2(0.03 * f, 0.0);
  int a = int(mod(k + float(uVariant), 3.0));
  vec3 c = scenicAt(a, q);
  float fade = smoothstep(0.92, 1.0, f);
  if (fade > 0.0) c = mix(c, scenicAt(int(mod(float(a) + 1.0, 3.0)), p), fade);
  return c;
}

// ---------------------------------------------------------------- radio, film card, computers
vec3 sceneShortwave(vec2 p) {
  vec3 c = S(vec3(0.13, 0.13, 0.12)) * (0.85 + 0.15 * vnoise(vec2(p.x * 3.0, p.y * 400.0)));
  vec2 dc = p - vec2(0.0, 0.25);
  float win = sdRoundBox(dc, vec2(0.62, 0.09), 0.01);
  vec3 amber = S(vec3(1.0, 0.62, 0.22)) * (0.55 + 0.25 * (1.0 - abs(dc.y) * 8.0));
  vec3 dial = amber;
  float tick = abs(fract(dc.x / 0.02 + 0.5) - 0.5) * 0.02;
  float big = abs(fract(dc.x / 0.1 + 0.5) - 0.5) * 0.1;
  dial = mix(dial, S(vec3(0.1, 0.05, 0.0)), strokeD(tick, 0.0008) * step(dc.y, -0.03));
  dial = mix(dial, S(vec3(0.1, 0.05, 0.0)), strokeD(big, 0.0012) * step(dc.y, 0.0));
  float jump = (hash11(floor(uBeat / 16.0)) - 0.5) * 0.5;
  float nx = 0.4 * sin(uTime * 0.07) + jump;
  dial = mix(dial, S(vec3(0.9, 0.05, 0.02)), strokeD(dc.x - nx, 0.002));
  c = mix(c, dial, fillD(win));
  c = mix(c, S(vec3(0.3)), strokeD(win, 0.003));
  vec2 sc = p - vec2(-0.12, -0.13);
  float R = 0.22;
  if (length(sc) < R) {
    vec3 g = S(vec3(0.0, 0.08, 0.03));
    vec2 gr = abs(fract(sc / 0.044 + 0.5) - 0.5) * 0.044;
    g += S(vec3(0.0, 0.25, 0.1)) * strokeD(min(gr.x, gr.y), 0.0005) * 0.6;
    float x = sc.x;
    float amp = 0.03 + 0.09 * uBass * uReact;
    float fx = amp * sin(x * 30.0 + uTime * 6.0) + (0.02 + 0.05 * uMids * uReact) * sin(x * 90.0 - uTime * 11.0) + 0.012 * uHighs * sin(x * 260.0 + uTime * 23.0);
    float dfx = amp * 30.0 * cos(x * 30.0 + uTime * 6.0) + (0.02 + 0.05 * uMids * uReact) * 90.0 * cos(x * 90.0 - uTime * 11.0);
    float d = abs(sc.y - fx) / sqrt(1.0 + dfx * dfx);
    g += S(vec3(0.3, 1.0, 0.5)) * (fillD(d - 0.0015) * 1.5 + exp(-d * 250.0) * 0.5);
    c = mix(c, g, fillD(length(sc) - R));
  }
  c = mix(c, S(vec3(0.35)), strokeD(length(sc) - R, 0.006));
  for (int i = 0; i < 10; i++) {
    vec2 lp = p - vec2(0.38, -0.32 + float(i) * 0.04);
    float on = step(float(i) / 10.0, uEnergy * 1.3 * uReact + 0.05);
    vec3 lc = i < 6 ? S(vec3(0.1, 1.0, 0.2)) : i < 8 ? S(vec3(1.0, 0.8, 0.1)) : S(vec3(1.0, 0.1, 0.05));
    c = mix(c, lc * (0.12 + 0.9 * on), fillD(sdBox(lp, vec2(0.05, 0.012))));
  }
  return c;
}

vec3 sceneIntertitle(vec2 p) {
  vec3 c = S(vec3(0.03)) + vec3(vnoise(p * 400.0) * 0.01);
  vec3 ink = S(vec3(0.88, 0.85, 0.76));
  vec2 b = vec2(ASP * 0.5 - 0.08, 0.42);
  float r1 = sdBox(p, b);
  float r2 = sdBox(p, b - 0.025);
  c = mix(c, ink, strokeD(r1, 0.003));
  c = mix(c, ink, strokeD(r2, 0.0012));
  vec2 a = abs(p);
  vec2 cq = a - (b - 0.025);
  float fan = length(cq) - 0.08;
  float rays = abs(fract((atan(-cq.y, -cq.x)) / 1.5708 * 6.0) - 0.5) * 0.04;
  if (cq.x < 0.0 && cq.y < 0.0) {
    c = mix(c, ink, strokeD(fan, 0.0012));
    c = mix(c, ink, strokeD(rays, 0.0008) * step(fan, 0.0) * step(0.02, length(cq)));
  }
  float dia = (abs(p.x) + abs(abs(p.y) - b.y + 0.06)) - 0.02;
  c = mix(c, ink, fillD(dia));
  if (uVariant == 1) c = mix(c, ink, strokeD(abs(p.y) - 0.3, 0.001) * step(abs(p.x), 0.4));
  return c;
}

vec3 fmv(vec2 q, float cells) {
  vec2 cell = floor(q * cells);
  vec2 s = cell / cells;
  float v = sin(s.x * 10.0 + uTime) + sin(s.y * 8.0 - uTime * 1.3) + sin((s.x + s.y) * 6.0 + uTime * 0.7) + uKick * uReact;
  float d = hash21(cell) - 0.5;
  float lv = floor((v * 0.25 + 0.5) * 6.0 + d) / 6.0;
  return palette(lv) * 0.9;
}

vec3 sceneDesktop(vec2 p) {
  vec3 c = S(vec3(0.0, 0.5, 0.5)) * (0.95 + 0.05 * mod(floor(gl_FragCoord.x / 2.0) + floor(gl_FragCoord.y / 2.0), 2.0));
  vec2 ic = p - vec2(-ASP * 0.5 + 0.1, 0.38);
  float disc = length(ic) - 0.035;
  vec3 sheen = 0.5 + 0.5 * cos(6.28318 * (atan(ic.y, ic.x) / 6.28318 * 2.0 + vec3(0.0, 0.33, 0.67)));
  c = mix(c, S(mix(vec3(0.8), sheen, 0.5)), fillD(disc) * step(0.008, length(ic)));
  vec2 wb = vec2(0.46, 0.33);
  float win = sdBox(p, wb);
  vec3 face = S(vec3(0.75));
  float bv = bevel(p, vec2(0.0), wb);
  face = mix(face, bv > 0.0 ? S(vec3(1.0)) : S(vec3(0.3)), abs(bv));
  vec2 tb = p - vec2(0.0, wb.y - 0.035);
  if (abs(tb.y) < 0.022 && abs(tb.x) < wb.x - 0.01) {
    face = mix(S(vec3(0.0, 0.0, 0.5)), S(vec3(0.1, 0.5, 0.85)), (tb.x + wb.x) / (2.0 * wb.x));
    for (int i = 0; i < 3; i++) {
      vec2 bp = tb - vec2(wb.x - 0.03 - float(i) * 0.04, 0.0);
      if (sdBox(bp, vec2(0.014)) < 0.0) face = S(vec3(0.75)) + (bevel(tb, vec2(wb.x - 0.03 - float(i) * 0.04, 0.0), vec2(0.014)) * 0.25);
    }
  }
  vec2 vb = vec2(0.36, 0.21);
  vec2 vp = p - vec2(0.0, 0.02);
  if (sdBox(vp, vb) < 0.0) face = fmv(vp / vb * 0.5 + 0.5, 64.0);
  for (int i = 0; i < 4; i++) {
    vec2 bp = p - vec2(-0.27 + float(i) * 0.1, -0.27);
    float bx = sdBox(bp, vec2(0.04, 0.022));
    if (bx < 0.0) face = S(vec3(0.75)) + bevel(p, vec2(-0.27 + float(i) * 0.1, -0.27), vec2(0.04, 0.022)) * 0.2;
    if (i == 0) face = mix(face, vec3(0.0), fillD(sdTriangleEq(rot2(-1.5708) * bp, 0.012)));
  }
  c = mix(c, face, fillD(win));
  c = mix(c, vec3(0.0), fillD(sdBox(p - vec2(0.008, -0.008), wb)) * (1.0 - fillD(win)) * 0.6);
  return c;
}

vec3 scenePlayer(vec2 p) {
  bool dark = uVariant == 1;
  vec3 c = dark ? S(vec3(0.1)) : S(vec3(0.88));
  if (p.y > 0.4) c = dark ? S(vec3(0.2, 0.05, 0.05)) : S(vec3(0.1, 0.2, 0.55));
  vec2 vb = vec2(0.4, 0.24);
  vec2 vp = p - vec2(0.0, 0.04);
  float vid = sdBox(vp, vb);
  c = mix(c, fmv(vp / vb * 0.5 + 0.5, 40.0), fillD(vid));
  vec2 bp = p - vec2(0.0, -0.245);
  if (sdBox(bp, vec2(vb.x, 0.025)) < 0.0) {
    c = mix(S(vec3(0.75)), S(vec3(0.5)), (bp.y + 0.025) / 0.05);
    float prog = fract(uTime / 240.0);
    float buf = min(1.0, prog + 0.12 + 0.05 * sin(uTime * 0.3));
    float x = (bp.x + vb.x - 0.08) / (2.0 * vb.x - 0.12);
    if (abs(bp.y) < 0.006 && x > 0.0 && x < 1.0) c = x < prog ? S(vec3(0.1, 0.6, 0.2)) : x < buf ? S(vec3(0.6)) : S(vec3(0.25));
    c = mix(c, vec3(0.0), fillD(sdTriangleEq(rot2(-1.5708) * (bp - vec2(-vb.x + 0.035, 0.0)), 0.012)));
  }
  return c;
}

void main() {
  PX = 1.2 / uRes.y;
  ASP = uRes.x / uRes.y;
  vec2 uv = vUv;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 c;
  if (uScene == 0) c = sceneBars(uv);
  else if (uScene == 1) c = sceneCard(p);
  else if (uScene == 2) c = sceneTower(p, uv);
  else if (uScene == 3) c = sceneRadar(p);
  else if (uScene == 4) c = sceneCandles(p);
  else if (uScene == 5) c = sceneStudio(p);
  else if (uScene == 6) c = scenePuppet(p);
  else if (uScene == 7) c = sceneCctv(uv);
  else if (uScene == 8) c = sceneLake(p);
  else if (uScene == 9) c = sceneGlobe(p);
  else if (uScene == 10) c = sceneScenic(p);
  else if (uScene == 11) c = sceneShortwave(p);
  else if (uScene == 12) c = sceneIntertitle(p);
  else if (uScene == 13) c = sceneDesktop(p);
  else c = scenePlayer(p);
  // Tint toward the look's palette by brightness; eerie drains the colour.
  float l = luma(c);
  if (uScene != 4 && uScene != 5 && uScene != 6) c = mix(c, palette(clamp(l * 1.4, 0.0, 1.0)) * (0.3 + l * 1.2), uTint * 0.6);
  c = mix(c, vec3(l) * vec3(0.9, 1.0, 1.05), uEerie * 0.5);
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

/** Procedural sets for the lost-media looks: test signals, a weather map, a birthday cake, a kids' show... */
export class LostScene extends ShaderGenerator {
  readonly kind = 'lostScene';
  constructor() {
    super(FRAG, { uScene: { value: 0 }, uVariant: { value: 0 }, uReact: { value: 1 }, uEerie: { value: 0 }, uTint: { value: 0 }, uSpin: { value: 0 } });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uScene.value = Math.max(0, LOST_SCENES.indexOf(String(p.scene ?? 'bars') as (typeof LOST_SCENES)[number]));
    u.uVariant.value = Math.round(num(p.variant, 0));
    u.uReact.value = num(p.react, 1);
    u.uEerie.value = num(p.eerie, 0);
    u.uTint.value = num(p.tint, 0);
    u.uSpin.value = num(p.spin, 0);
  }
}
