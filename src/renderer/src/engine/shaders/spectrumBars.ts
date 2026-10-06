import { FULLSCREEN_VERT, PALETTE_GLSL, SDF_GLSL } from './common';

export const SPECTRUM_BARS_VERT = FULLSCREEN_VERT;

/**
 * Spectrum bar EQ on a reflective stage floor. Bars are rounded SDF boxes with
 * an analytic glow; the floor grid scrolls toward camera locked to the beat.
 * Output is linear HDR (values > 1 bloom through the tonemapper).
 */
export const SPECTRUM_BARS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uBars;      // R = height, G = peak cap
uniform float uCount;
uniform vec2 uRes;
uniform float uTime;
uniform float uKick;          // eased kick envelope 0..1
uniform float uBeatPhase;
uniform float uBass;
uniform float uEnergy;
uniform float uGap;           // 0..0.8 fraction of the cell left empty
uniform float uHorizon;       // floor line, 0..1 of height
uniform float uMaxHeight;     // tallest bar, 0..1 of height
uniform float uGlow;
in vec2 vUv;
out vec4 fragColor;
${PALETTE_GLSL}
${SDF_GLSL}

float barValue(float i, out float peak) {
  vec4 t = texelFetch(uBars, ivec2(int(i), 0), 0);
  peak = t.g;
  return t.r;
}

// Accumulates one bar's fill and glow at pixel p (pixel units).
void shadeBar(float j, vec2 p, float x0, float cell, float y0, float maxH, inout vec3 col, inout vec3 glow, float reflect) {
  if (j < 0.0 || j >= uCount) return;
  float peak;
  float h = barValue(j, peak);
  float hw = cell * (1.0 - uGap) * 0.5;
  float hp = max(h * maxH, 1.5);
  vec2 c = vec2(x0 + (j + 0.5) * cell, y0 + hp * 0.5);
  float r = min(hw, 0.012 * uRes.y);
  float d = sdRoundBox(p - c, vec2(hw, hp * 0.5), r);
  float t = j / max(uCount - 1.0, 1.0);
  vec3 base = palette(0.22 + 0.76 * t);
  float lift = 0.55 + 1.9 * h * h + 0.9 * uKick;
  // Brighter toward the top of each bar.
  float v = clamp((p.y - y0) / hp, 0.0, 1.0);
  vec3 fillCol = base * lift * mix(0.35, 1.25, v * v);
  float aa = 1.0 - smoothstep(-0.8, 0.8, d);
  col += fillCol * aa * reflect;
  glow += base * (0.35 + 1.2 * h) * exp(-max(d, 0.0) / (0.018 * uRes.y)) * uGlow * reflect;

  // Peak cap.
  float capY = y0 + max(peak * maxH, 0.0) + 0.006 * uRes.y;
  float dc = sdRoundBox(p - vec2(c.x, capY), vec2(hw, 0.0022 * uRes.y), 0.002 * uRes.y);
  vec3 capCol = mix(base, palette(1.0), 0.6) * (1.6 + 1.5 * uKick);
  col += capCol * (1.0 - smoothstep(-0.8, 0.8, dc)) * reflect * step(0.01, peak);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float y0 = uHorizon * uRes.y;
  float maxH = uMaxHeight * uRes.y;
  float margin = 0.06 * uRes.x;
  float areaW = uRes.x - 2.0 * margin;
  float cell = areaW / uCount;

  // Background: deep vertical gradient from the darkest palette stops.
  float gy = p.y / uRes.y;
  vec3 bg = mix(uPal[0] * 0.35, uPal[1] * 0.22, smoothstep(0.0, 1.0, gy));
  bg += uPal[1] * 0.08 * uKick;
  vec3 col = bg;
  vec3 glow = vec3(0.0);

  bool floorSide = p.y < y0;
  vec2 q = p;
  float reflect = 1.0;
  if (floorSide) {
    // Mirror into the floor with a gentle bass-driven ripple.
    float depth = (y0 - p.y) / uRes.y;
    q.x += sin(depth * 140.0 - uTime * 3.0) * depth * 6.0 * (0.3 + uBass);
    q.y = y0 + (y0 - p.y) * 1.15;
    reflect = 0.22 * exp(-depth * 7.0);
  }
  float i = floor((q.x - margin) / cell);
  for (float k = -2.0; k <= 2.0; k += 1.0) {
    shadeBar(i + k, q, margin, cell, y0, maxH, col, glow, reflect);
  }
  col += glow;

  if (floorSide) {
    // Perspective floor grid, scrolling one line per beat.
    float depth = max(y0 - p.y, 1.0) / uRes.y;
    float z = 0.08 / depth;
    float gz = z + uBeatPhase; // lines travel toward the viewer, one per beat
    float dz = 0.5 - abs(fract(gz) - 0.5);
    float hLine = 1.0 - smoothstep(0.0, fwidth(gz) * 1.2, dz);
    float gx = (p.x - 0.5 * uRes.x) / uRes.y * z * 2.0;
    float dx = 0.5 - abs(fract(gx) - 0.5);
    float vLine = 1.0 - smoothstep(0.0, fwidth(gx) * 1.2, dx);
    float fade = smoothstep(0.0, 0.25, depth) * exp(-z * 0.35);
    col += palette(0.55) * (hLine + vLine) * fade * (0.05 + 0.18 * uEnergy + 0.25 * uKick);
  }

  // Horizon line glow.
  float hd = abs(p.y - y0) / uRes.y;
  col += palette(0.62) * exp(-hd * 260.0) * (0.25 + 0.9 * uBass + 0.6 * uKick);
  col += palette(0.5) * exp(-hd * 25.0) * 0.06 * (0.4 + uEnergy);

  // Vignette.
  vec2 uv = vUv - 0.5;
  col *= 1.0 - 0.55 * dot(uv, uv) * 1.6;

  fragColor = vec4(max(col, 0.0), 1.0);
}
`;
