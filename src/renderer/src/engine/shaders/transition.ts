import { FULLSCREEN_VERT } from './common';

export const TRANSITION_VERT = FULLSCREEN_VERT;

/** Transition kinds the blend pass draws (others fall back to a crossfade). */
export const TRANSITION_INDEX: Record<string, number> = { crossfade: 0, flashBlack: 1, flashWhite: 2, lumaWipe: 3, zoomThrough: 4, glitchCut: 5 };

/**
 * Blends the outgoing look (uA) into the incoming one (uB) in linear HDR,
 * before tonemapping. uT runs 0..1 over the transition's length in beats.
 */
export const TRANSITION_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uT;
uniform int uType;
uniform vec2 uRes;
in vec2 vUv;
out vec4 fragColor;

float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 at(sampler2D s, vec2 uv) { return texture(s, clamp(uv, 0.0, 1.0)).rgb; }

void main() {
  float t = clamp(uT, 0.0, 1.0);
  vec3 a = at(uA, vUv);
  vec3 b = at(uB, vUv);
  vec3 c;
  if (uType == 1) {
    // Dip through black.
    c = t < 0.5 ? a * (1.0 - ease(t * 2.0)) : b * ease(t * 2.0 - 1.0);
  } else if (uType == 2) {
    // One white flash at the midpoint (a single flash, photosensitivity-safe).
    float f = 1.0 - abs(t * 2.0 - 1.0);
    c = mix(a, b, step(0.5, t)) + vec3(1.6) * f * f * f;
  } else if (uType == 3) {
    // Luma wipe: the incoming look's dark areas arrive first, highlights last.
    float l = clamp(luma(b) / (1.0 + luma(b)) * 1.6, 0.0, 1.0);
    float edge = t * 1.3 - 0.15;
    c = mix(a, b, smoothstep(l - 0.15, l + 0.15, edge));
  } else if (uType == 4) {
    // Zoom through: fly into the old look as the new one settles in from slightly small.
    vec2 p = vUv - 0.5;
    vec3 za = at(uA, 0.5 + p / (1.0 + 2.5 * t * t));
    vec3 zb = at(uB, 0.5 + p * (1.0 + 0.25 * (1.0 - ease(t))));
    c = mix(za * (1.0 + t), zb, ease(t));
  } else if (uType == 5) {
    // Glitch cut: blocks flip to the new look in stepped bursts, with a colour split.
    float stepT = floor(t * 8.0) / 8.0;
    vec2 blk = floor(vUv * vec2(24.0, 14.0));
    float h = hash(blk + stepT * 17.0);
    float shift = (hash(vec2(blk.y, stepT * 31.0)) - 0.5) * 0.06 * (1.0 - t);
    bool showB = h < t * 1.15;
    vec2 uv = vUv + vec2(shift, 0.0);
    vec3 g = showB ? vec3(texture(uB, uv + vec2(0.004, 0.0)).r, texture(uB, uv).g, texture(uB, uv - vec2(0.004, 0.0)).b)
                   : vec3(texture(uA, uv - vec2(0.004, 0.0)).r, texture(uA, uv).g, texture(uA, uv + vec2(0.004, 0.0)).b);
    c = t >= 1.0 ? b : g;
  } else {
    c = mix(a, b, ease(t));
  }
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;
