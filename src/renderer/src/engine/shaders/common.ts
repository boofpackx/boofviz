/** Shared GLSL snippets. All shading happens in linear light. */

export const FULLSCREEN_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const PALETTE_GLSL = /* glsl */ `
uniform vec3 uPal[5];
// Smooth 5-stop palette lookup, t in 0..1.
vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(floor(t), 3.0));
  float f = t - float(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(uPal[i], uPal[i + 1], f);
}
// Wrapping lookup that skips the darkest (background) stop.
vec3 paletteWrap(float t) {
  return palette(0.25 + 0.75 * fract(t));
}
`;

export const SDF_GLSL = /* glsl */ `
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// Regular n-gon (iq), circumradius r; n may be fractional.
float sdPolygon(vec2 p, float r, float n) {
  float an = 3.14159265 / n;
  vec2 acs = vec2(cos(an), sin(an));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p.y += clamp(-p.y, 0.0, r * acs.y);
  return length(p) * sign(p.x);
}
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float sdTriangleEq(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
`;

export const UTIL_GLSL = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
float easeOutBack(float x) { const float c1 = 1.70158; const float c3 = c1 + 1.0; x = clamp(x, 0.0, 1.0); return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0); }
float easeInOut(float x) { x = clamp(x, 0.0, 1.0); return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Coverage alpha for generators drawn without a background (so 'normal' blend overlays).
float coverAlpha(vec3 c, float bg) { return mix(clamp(max(c.r, max(c.g, c.b)) * 2.0, 0.0, 1.0), 1.0, clamp(bg, 0.0, 1.0)); }
`;

/** Standard uniforms every shader generator receives. */
export const GEN_HEADER = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uBeat;
uniform float uBeatPhase;
uniform float uBarPhase;
uniform float uKick;
uniform float uSnare;
uniform float uHat;
uniform float uBass;
uniform float uMids;
uniform float uHighs;
uniform float uEnergy;
uniform float uBeatsPerBar;
in vec2 vUv;
out vec4 fragColor;
${PALETTE_GLSL}
${SDF_GLSL}
${UTIL_GLSL}
`;

/**
 * For flat graphics drawn in display colours (canvas UI, posters): the scene
 * value that the output pass (ACES fit, sRGB) turns back into exactly this
 * sRGB colour, so whites stay white and loud colours stay loud.
 */
export const DISPLAY_GLSL = /* glsl */ `
vec3 fromDisplay(vec3 srgb) {
  const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 y = mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, srgb));
  vec3 v = clamp(inverse(ACES_OUT) * clamp(y, 0.0, 1.0), 0.0, 0.995);
  // Invert the RRT/ODT rational fit per channel (positive root of a quadratic).
  vec3 a = 1.0 - 0.983729 * v;
  vec3 b = 0.0245786 - 0.4329510 * v;
  vec3 c = -(0.000090537 + 0.238081 * v);
  vec3 u = (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
  return max(inverse(ACES_IN) * u, 0.0);
}
`;
