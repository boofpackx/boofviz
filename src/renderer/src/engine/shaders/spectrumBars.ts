import { GEN_HEADER } from './common';

/**
 * Spectrum bar EQ on a reflective stage floor. Bars are rounded SDF boxes (or
 * LED segments) with an analytic glow; the floor grid scrolls one line per beat.
 */
export const SPECTRUM_BARS_FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uBars;      // R = height, G = peak cap
uniform float uCount;
uniform float uGap;
uniform float uHorizon;
uniform float uMaxHeight;
uniform float uGlow;
uniform int uMirror;          // 0 none, 1 center (up+down)
uniform float uSegments;
uniform float uRoundness;
uniform int uColorMode;       // 0 frequency, 1 level
uniform float uCaps;
uniform float uReflection;
uniform float uFloor;
uniform float uBackground;

vec3 barColor(float j, float level) {
  float t = j / max(uCount - 1.0, 1.0);
  return uColorMode == 1 ? palette(0.3 + 0.7 * level) : palette(0.22 + 0.76 * t);
}

void shadeBar(float j, vec2 p, float x0, float cell, float y0, float maxH, inout vec3 col, inout vec3 glow, float weight) {
  if (j < 0.0 || j >= uCount) return;
  vec4 tx = texelFetch(uBars, ivec2(int(j), 0), 0);
  float h = tx.r;
  float peak = tx.g;
  float hw = cell * (1.0 - uGap) * 0.5;
  float cx = x0 + (j + 0.5) * cell;
  float lift = 0.55 + 1.9 * h * h + 0.9 * uKick;
  float r = min(hw, 0.012 * uRes.y) * uRoundness;
  float d;
  vec3 base;
  if (uSegments > 0.5) {
    // LED segments: light every segment below the level.
    float segH = maxH / uSegments;
    float s = floor((p.y - y0) / segH);
    float lit = floor(h * uSegments + 0.5);
    float sc = clamp(s, 0.0, max(lit - 1.0, 0.0));
    vec2 c = vec2(cx, y0 + (sc + 0.5) * segH);
    d = sdRoundBox(p - c, vec2(hw, segH * 0.5 * 0.72), min(r, segH * 0.3));
    if (lit < 0.5) d = 1e5;
    base = barColor(j, (sc + 0.5) / uSegments);
    lift = 0.7 + 1.2 * (sc + 0.5) / uSegments + 0.6 * uKick;
  } else {
    float hp = max(h * maxH, 1.5);
    vec2 c = vec2(cx, y0 + hp * 0.5);
    d = sdRoundBox(p - c, vec2(hw, hp * 0.5), r);
    float v = clamp((p.y - y0) / hp, 0.0, 1.0);
    base = barColor(j, uColorMode == 1 ? v * h : h);
    lift *= mix(0.35, 1.25, v * v);
  }
  float aa = 1.0 - smoothstep(-0.8, 0.8, d);
  col += base * lift * aa * weight;
  glow += base * (0.35 + 1.2 * h) * exp(-max(d, 0.0) / (0.018 * uRes.y)) * uGlow * weight;

  if (uCaps > 0.5 && peak > 0.01) {
    float capY = y0 + peak * maxH + 0.006 * uRes.y;
    float dc = sdRoundBox(p - vec2(cx, capY), vec2(hw, 0.0022 * uRes.y), 0.002 * uRes.y);
    vec3 capCol = mix(base, palette(1.0), 0.6) * (1.6 + 1.5 * uKick);
    col += capCol * (1.0 - smoothstep(-0.8, 0.8, dc)) * weight;
  }
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float y0 = uHorizon * uRes.y;
  float maxH = uMaxHeight * uRes.y;
  float margin = 0.06 * uRes.x;
  float cell = (uRes.x - 2.0 * margin) / uCount;

  float gy = p.y / uRes.y;
  vec3 bg = mix(uPal[0] * 0.35, uPal[1] * 0.22, smoothstep(0.0, 1.0, gy));
  bg += uPal[1] * 0.08 * uKick;
  vec3 col = bg * uBackground;
  vec3 glow = vec3(0.0);

  bool below = p.y < y0;
  vec2 q = p;
  float weight = 1.0;
  if (below) {
    if (uMirror == 1) {
      q.y = 2.0 * y0 - p.y;
    } else {
      float depth = (y0 - p.y) / uRes.y;
      q.x += sin(depth * 140.0 - uTime * 3.0) * depth * 6.0 * (0.3 + uBass);
      q.y = y0 + (y0 - p.y) * 1.15;
      weight = 0.22 * exp(-depth * 7.0) * uReflection;
    }
  }
  float i = floor((q.x - margin) / cell);
  if (weight > 0.001) for (float k = -2.0; k <= 2.0; k += 1.0) shadeBar(i + k, q, margin, cell, y0, maxH, col, glow, weight);
  col += glow;

  if (below && uMirror == 0 && uFloor > 0.0) {
    float depth = max(y0 - p.y, 1.0) / uRes.y;
    float z = 0.08 / depth;
    float gz = z + uBeatPhase;
    float dz = 0.5 - abs(fract(gz) - 0.5);
    float hLine = 1.0 - smoothstep(0.0, fwidth(gz) * 1.2, dz);
    float gx = (p.x - 0.5 * uRes.x) / uRes.y * z * 2.0;
    float dx = 0.5 - abs(fract(gx) - 0.5);
    float vLine = 1.0 - smoothstep(0.0, fwidth(gx) * 1.2, dx);
    float fade = smoothstep(0.0, 0.25, depth) * exp(-z * 0.35);
    col += palette(0.55) * (hLine + vLine) * fade * (0.05 + 0.18 * uEnergy + 0.25 * uKick) * uFloor;
  }

  float hd = abs(p.y - y0) / uRes.y;
  if (uMirror == 0) {
    col += palette(0.62) * exp(-hd * 260.0) * (0.25 + 0.9 * uBass + 0.6 * uKick) * max(uFloor, uReflection);
    col += palette(0.5) * exp(-hd * 25.0) * 0.06 * (0.4 + uEnergy) * uBackground;
  }
  vec2 uv = vUv - 0.5;
  col *= mix(1.0, 1.0 - 0.55 * dot(uv, uv) * 1.6, uBackground);
  col = max(col, 0.0);
  fragColor = vec4(col, coverAlpha(col, uBackground));
}
`;
