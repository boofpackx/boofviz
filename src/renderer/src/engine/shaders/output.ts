import { FULLSCREEN_VERT } from './common';

export const OUTPUT_VERT = FULLSCREEN_VERT;

/**
 * Final pass: exposure, saturation, ACES (Hill fit, with RRT/ODT matrices),
 * linear → sRGB, interleaved-gradient-noise dither (kills 8-bit banding) and
 * blackout fade.
 */
export const OUTPUT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform float uExposure;
uniform float uSaturation;
uniform float uHueShift;
uniform float uBlackout;
uniform float uFrame;
in vec2 vUv;
out vec4 fragColor;

const mat3 ACES_IN = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602);

vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 acesFitted(vec3 c) {
  c = ACES_IN * c;
  c = rrtOdtFit(c);
  return clamp(ACES_OUT * c, 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 c = texture(uScene, vUv).rgb * uExposure;
  if (uHueShift != 0.0) c = max(hueRotate(c, uHueShift), 0.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSaturation), 0.0);
  c = linearToSrgb(acesFitted(c));
  c += (ign(gl_FragCoord.xy + uFrame * 5.588238) - 0.5) / 255.0;
  c *= 1.0 - uBlackout;
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
