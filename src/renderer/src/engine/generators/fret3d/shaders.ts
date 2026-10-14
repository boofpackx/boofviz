import { UTIL_GLSL } from '../../shaders/common';

/** A photo-studio surround for chrome and gloss: dark floor, bright top, two softbox highlights. */
export const ENV_GLSL = /* glsl */ `
vec3 studioEnv(vec3 d) {
  vec3 c = mix(vec3(0.03, 0.03, 0.04), vec3(0.75, 0.76, 0.8), smoothstep(-0.25, 0.85, d.y));
  c += vec3(3.2) * smoothstep(0.93, 0.975, dot(d, normalize(vec3(-0.45, 0.82, 0.38))));
  c += vec3(1.6) * smoothstep(0.955, 0.99, dot(d, normalize(vec3(0.62, 0.48, 0.62))));
  c += vec3(0.5, 0.45, 0.6) * smoothstep(0.6, 1.0, dot(d, vec3(0.0, -0.2, 1.0))) * 0.4;
  return c;
}
`;

/**
 * Gems, star gems and the kick bar: instanced, chrome below and a glossy
 * coloured cap on top (split by height in the model), with a white ring for
 * hammer-ons, a far-end fade and star power's blue-white.
 */
export const GEM_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in mat4 instanceMatrix;
in vec3 aColor;
in vec4 aInfo; // alpha, hammer-on, star power, glow
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uSplit;
out vec3 vN;
out vec3 vW;
out vec3 vColor;
out vec4 vInfo;
out float vCap;
out vec2 vLocal;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vColor = aColor;
  vInfo = aInfo;
  vCap = position.y > uSplit ? 1.0 : 0.0;
  vLocal = position.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const GEM_FRAG = /* glsl */ `
precision highp float;
${ENV_GLSL}
uniform vec3 cameraPosition;
uniform float uRingR;
in vec3 vN;
in vec3 vW;
in vec3 vColor;
in vec4 vInfo;
in float vCap;
in vec2 vLocal;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec3 r = reflect(-v, n);
  float nv = max(dot(n, v), 0.0);
  vec3 col;
  if (vCap < 0.5) {
    // Chrome.
    col = studioEnv(r) * vec3(0.82, 0.84, 0.9);
  } else {
    vec3 base = mix(vColor, vec3(0.75, 0.9, 1.6), vInfo.z);
    vec3 L = normalize(vec3(-0.35, 1.0, 0.45));
    float diff = 0.35 + 0.8 * max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), v), 0.0), 48.0);
    float fres = pow(1.0 - nv, 3.0);
    col = base * diff * 1.15 + vec3(spec * 2.2) + studioEnv(r) * fres * 0.35;
    // A hammer-on wears a white ring round its cap.
    float rr = length(vLocal);
    col = mix(col, vec3(2.4), vInfo.y * smoothstep(uRingR - 0.05, uRingR - 0.02, rr) * (1.0 - smoothstep(uRingR + 0.01, uRingR + 0.04, rr)));
  }
  col *= 1.0 + vInfo.w;
  fragColor = vec4(col * vInfo.x, vInfo.x);
}
`;

/** Plain lit parts (frets, rails, buttons): a colour, how metallic, a glow. */
export const SOLID_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vN;
out vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SOLID_FRAG = /* glsl */ `
precision highp float;
${ENV_GLSL}
uniform vec3 cameraPosition;
uniform vec3 uColor;
uniform vec3 uGlow;
uniform float uMetal;
in vec3 vN;
in vec3 vW;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec3 L = normalize(vec3(-0.35, 1.0, 0.45));
  float diff = 0.3 + 0.8 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), v), 0.0), 32.0);
  vec3 plain = uColor * diff + vec3(spec * 0.8);
  vec3 metal = studioEnv(reflect(-v, n)) * uColor;
  fragColor = vec4(mix(plain, metal, uMetal) + uGlow, 1.0);
}
`;

/**
 * The neck: a dark board scrolling with the song, lane lines and strings,
 * a line on every beat and a heavier one on every bar, chrome rails, the
 * far end fading into the venue, the frets' row lit by hits, and star
 * power's electric blue.
 */
export const BOARD_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const BOARD_FRAG = /* glsl */ `
precision highp float;
${UTIL_GLSL}
uniform float uBeat;
uniform float uUnitsPerBeat;
uniform float uBarOffset;
uniform float uBeatsPerBar;
uniform float uLen;
uniform float uHalf;
uniform float uLanes;
uniform float uLaneW;
uniform float uPower;
uniform float uTime;
uniform int uTheme;
uniform vec3 uTint;
uniform float uFlash[5];
uniform float uDrums;
in vec3 vP;
out vec4 fragColor;
void main() {
  float x = vP.x;
  float z = vP.z;
  float b = uBeat - z / uUnitsPerBeat; // the song beat under this point
  float d = clamp(-z / uLen, 0.0, 1.0);
  // The surface.
  vec3 base;
  vec2 q = vec2(x * 3.0, b * 1.6);
  if (uTheme == 1) {
    // Steel tread plate.
    vec2 g = fract(vec2(x * 2.2, b * 1.1)) - 0.5;
    float dia = smoothstep(0.08, 0.0, abs(abs(g.x) + abs(g.y) * 0.55 - 0.28));
    base = vec3(0.035, 0.034, 0.042) + vec3(0.05) * dia + 0.02 * fbm(q * 2.0);
  } else if (uTheme == 2) {
    // Neon: a dark grid.
    vec2 g = abs(fract(vec2(x / uLaneW, b * 0.5)) - 0.5);
    base = vec3(0.03, 0.01, 0.06) + vec3(0.5, 0.05, 0.4) * smoothstep(0.47, 0.5, g.y) * 0.25;
  } else if (uTheme == 3) {
    // Carbon fibre.
    vec2 g = fract(vec2(x * 5.0 + floor(b * 5.0) * 0.5, b * 5.0));
    base = vec3(0.025, 0.027, 0.034) + vec3(0.02) * step(0.5, g.x) * step(0.5, g.y) + 0.015 * fbm(q);
  } else {
    // Old dark wood, grain along the neck.
    float grain = fbm(vec2(x * 1.2, b * 0.35) * vec2(6.0, 1.0));
    float plank = floor((x + uHalf) / (uHalf / 3.0));
    float tone = 0.75 + 0.35 * hash11(plank * 7.1);
    base = vec3(0.11, 0.06, 0.035) * tone * (0.65 + 0.7 * grain);
    float seam = smoothstep(0.03, 0.0, abs(fract((x + uHalf) / (uHalf / 3.0)) - 0.0));
    base *= 1.0 - 0.6 * seam;
  }
  base *= uTint;
  // Lane lines, and a string down the middle of each lane.
  float lw = uLaneW;
  float lanePos = (x + uLanes * lw * 0.5) / lw;
  float edge = abs(fract(lanePos) - 0.0);
  edge = min(edge, 1.0 - edge);
  vec3 col = base;
  if (lanePos > 0.0 && lanePos < uLanes) col *= 1.0 - 0.35 * smoothstep(0.035, 0.0, edge);
  float mid = abs(fract(lanePos) - 0.5);
  if (lanePos > 0.0 && lanePos < uLanes && uDrums < 0.5) col += vec3(0.16) * smoothstep(0.022, 0.0, mid) * (1.0 - d);
  // Beat and bar lines (thicker near the camera, where they're closer).
  float fb = fract(b);
  float beatLine = smoothstep(0.035, 0.0, min(fb, 1.0 - fb));
  float bp = fract((b - uBarOffset) / uBeatsPerBar) * uBeatsPerBar;
  float barLine = smoothstep(0.07, 0.0, min(bp, uBeatsPerBar - bp));
  col += vec3(0.45, 0.45, 0.5) * beatLine * (1.0 - 0.6 * d) + vec3(0.9) * barLine * (1.0 - 0.5 * d);
  // The row the frets sit in, lit by hits in its lane.
  float row = smoothstep(0.55, 0.0, abs(z));
  int lane = int(clamp(floor(lanePos), 0.0, 4.0));
  col = mix(col, col * 0.4, row * 0.6);
  col += vec3(1.0, 0.85, 0.6) * row * uFlash[lane] * 0.9;
  // Chrome rails.
  float ax = abs(x);
  float rail = smoothstep(uHalf - 0.16, uHalf - 0.1, ax) * (1.0 - smoothstep(uHalf - 0.02, uHalf, ax));
  vec3 railCol = mix(vec3(1.1, 1.1, 1.2), vec3(0.6, 1.4, 3.0) * (0.8 + 0.4 * sin(uTime * 23.0 + b * 9.0)), uPower);
  col = mix(col, railCol * (1.0 - 0.55 * d), rail);
  // Star power: the board lights up electric blue, bolts running up the rails.
  col += vec3(0.15, 0.45, 1.2) * uPower * (0.25 + 0.2 * fbm(vec2(x * 2.0, b * 2.0 - uTime * 3.0))) * (1.0 - d);
  float bolt = smoothstep(0.08, 0.0, abs(ax - uHalf + 0.08 + 0.05 * sin(b * 31.0 + uTime * 40.0)));
  col += vec3(0.6, 1.2, 3.0) * bolt * uPower * step(0.5, fract(b * 0.5 + uTime * 2.0));
  // Fade into the venue at the far end; the board is clipped at its edges.
  float alpha = (1.0 - smoothstep(0.5, 1.0, d)) * step(ax, uHalf);
  fragColor = vec4(col * alpha, alpha);
}
`;

/** Sustain tails: ribbons down the lane, wobbling (the whammy) while held. */
export const TAIL_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec4 aTail;  // lane x, near z, far z, width
in vec4 aState; // rgb colour, held (0/1, or −1 dropped)
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uWhammy;
uniform float uLen;
out vec3 vColor;
out float vHeld;
out float vAcross;
out float vFar;
void main() {
  float z = mix(aTail.y, aTail.z, position.y);
  float held = max(aState.w, 0.0);
  float wob = held * sin(z * 2.4 - uTime * 19.0) * (0.05 + 0.08 * uWhammy);
  vec3 p = vec3(aTail.x + position.x * aTail.w + wob, 0.04, z);
  vColor = aState.rgb;
  vHeld = aState.w;
  vAcross = position.x * 2.0;
  vFar = clamp(-z / uLen, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;

export const TAIL_FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vHeld;
in float vAcross;
in float vFar;
out vec4 fragColor;
void main() {
  float a = 1.0 - smoothstep(0.65, 1.0, abs(vAcross));
  float core = smoothstep(0.35, 0.0, abs(vAcross));
  vec3 c = vHeld < -0.5 ? vec3(0.12) : vColor * (0.9 + 0.8 * vHeld) + vec3(1.6) * core * max(vHeld, 0.0);
  float alpha = a * (1.0 - smoothstep(0.75, 1.0, vFar)) * (vHeld < -0.5 ? 0.5 : 1.0);
  fragColor = vec4(c * alpha, alpha);
}
`;

/** Fire and flashes at the frets: camera-facing quads, procedural flame. */
export const FIRE_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 aPos;
in vec4 aFire; // start time, seed, size, kind (0 flame, 1 flash, 2 held flame)
in vec3 aTint;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
out vec2 vUv;
out float vAge;
out float vSeed;
out float vKind;
out vec3 vTint;
void main() {
  float age = uTime - aFire.x;
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float s = aFire.z;
  vec2 shape = aFire.w < 0.5 || aFire.w > 1.5 ? vec2(1.0, 2.3) : vec2(1.6, 1.6);
  vec2 lift = aFire.w < 0.5 || aFire.w > 1.5 ? vec2(0.0, 0.45) : vec2(0.0);
  mv.xy += (position.xy + lift) * shape * s;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  vAge = age;
  vSeed = aFire.y;
  vKind = aFire.w;
  vTint = aTint;
}
`;

export const FIRE_FRAG = /* glsl */ `
precision highp float;
${UTIL_GLSL}
uniform float uTime;
in vec2 vUv;
in float vAge;
in float vSeed;
in float vKind;
in vec3 vTint;
out vec4 fragColor;
void main() {
  if (vKind > 0.5 && vKind < 1.5) {
    // A flash: a soft burst in the lane's colour.
    float r = length(vUv - 0.5) * 2.0;
    float life = clamp(1.0 - vAge / 0.22, 0.0, 1.0);
    float a = smoothstep(1.0, 0.0, r) * life * life;
    fragColor = vec4(vTint * a * 2.5, 0.0);
    return;
  }
  float life = vKind > 1.5 ? 1.0 : clamp(1.0 - vAge / 0.42, 0.0, 1.0);
  float grow = vKind > 1.5 ? 1.0 : smoothstep(0.0, 0.07, vAge);
  vec2 uv = vUv;
  float y = uv.y;
  float n = fbm(vec2(uv.x * 3.2 + vSeed * 17.0, y * 2.4 - uTime * 4.6 - vSeed));
  // A tongue of fire: wide at the root, licking up to a point.
  float w = 0.46 * pow(max(1.0 - y, 0.0), 0.9) * smoothstep(0.0, 0.12, y + 0.05) * grow;
  float x = uv.x - 0.5 + (n - 0.5) * 0.32 * y;
  float body = smoothstep(w, w * 0.35, abs(x));
  float heat = body * (1.05 - y * 0.85) * (0.6 + 0.8 * n) * life;
  heat *= smoothstep(1.0, 0.55, y + (1.0 - life) * 0.6);
  vec3 c = mix(vec3(0.6, 0.05, 0.0), vec3(1.6, 0.45, 0.02), smoothstep(0.15, 0.45, heat));
  c = mix(c, vec3(2.4, 1.9, 0.6), smoothstep(0.45, 0.8, heat));
  c = mix(c, vec3(3.0, 3.0, 2.6), smoothstep(0.8, 1.05, heat));
  c = mix(c, vTint * 2.0 + vec3(0.6, 0.9, 1.4) * smoothstep(0.6, 1.0, heat), step(0.5, length(vTint - vec3(1.0, 0.55, 0.15))) * 0.85);
  fragColor = vec4(c * heat * 1.4, 0.0);
}
`;

/** Sparks: points thrown up from the frets, falling under gravity. */
export const SPARK_VERT = /* glsl */ `
precision highp float;
in vec3 position; // start
in vec3 aVel;
in vec2 aLife;    // start time, lifetime
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uScale;
out float vLife;
void main() {
  float age = uTime - aLife.x;
  float k = clamp(age / aLife.y, 0.0, 1.0);
  vec3 p = position + aVel * age + vec3(0.0, -6.0, 0.0) * age * age;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vLife = age >= 0.0 && age < aLife.y ? 1.0 - k : 0.0;
  gl_PointSize = vLife > 0.0 ? uScale * (0.6 + 0.4 * vLife) / -mv.z : 0.0;
}
`;

export const SPARK_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
in float vLife;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(d)) * vLife;
  fragColor = vec4(uColor * a * 3.0, 0.0);
}
`;
