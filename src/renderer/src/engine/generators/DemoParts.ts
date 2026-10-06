import * as THREE from 'three';
import { FULLSCREEN_VERT, GEN_HEADER } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext } from './Generator';
import { fontCss } from './KineticType';
import { num, ShaderGenerator, type Uniforms } from './ShaderGenerator';

/** The fixed internal "machine" resolution. Everything is drawn here, then upscaled with sharp pixels. */
const LW = 320;
const LH = 256;
const BALLS = 64;
const MAX_CHARS = 128;
const MAX_BARS = 12;
/** Lines of the band layout: effect area, a 4-line copper divider, then the scroller band. */
const BAND_EFF_H = 196;

/**
 * Copper bars: per raster line, a stack of bouncing gradient bars in 12-bit
 * colour. Shared by the low-res pass (seen through colour 0) and the upscale
 * pass (the opened side and top/bottom borders), so both line up exactly.
 */
const COPPER_GLSL = /* glsl */ `
uniform float uCopN, uCopBuild, uCopPhase, uCopFast, uCopJump, uCopH, uCopCentre, uCopAmp, uRainbow, uCopGain;
// 4 bits per channel, quantized in display (gamma) space like the real colour registers.
vec3 q12(vec3 lin) {
  vec3 s = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  s = floor(s * 15.0 + 0.5) / 15.0;
  return pow(s, vec3(2.2));
}
vec3 hueLin(float h) {
  vec3 c = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return c * c;
}
vec4 copper(float line) {
  float bestZ = -9.0;
  vec4 res = vec4(0.0);
  int n = int(uCopN + 0.5);
  int total = n + (uCopBuild > 0.5 ? n : 0);
  float nf = max(float(n), 1.0);
  for (int k = 0; k < ${MAX_BARS * 2}; k++) {
    if (k >= total) break;
    bool extra = k >= n;
    float i = extra ? float(k - n) : float(k);
    float ph = (extra ? uCopFast + 0.4 : uCopPhase) + i * 6.2831853 / nf * (extra ? 0.5 : 1.0);
    float amp = uCopAmp * (extra ? 0.7 : 1.0);
    float y = uCopCentre + amp * sin(ph) + uCopJump * (0.55 + 0.45 * cos(i * 1.7));
    float z = cos(ph);
    float s = (line - floor(y)) / uCopH;
    if (abs(s) < 1.0 && z > bestZ) {
      bestZ = z;
      float sh = 1.0 - abs(s);
      float hue = (i + (extra ? 0.5 : 0.0)) / nf;
      vec3 base = mix(palette(0.42 + 0.58 * fract(i * 0.381 + (extra ? 0.19 : 0.0))), hueLin(hue), uRainbow);
      vec3 c = base * (0.08 + 1.0 * sh) + vec3(1.0) * pow(sh, 7.0) * 0.55;
      c *= mix(0.45, 1.0, z * 0.5 + 0.5);
      res = vec4(q12(c) * uCopGain, 1.0);
    }
  }
  return res;
}
`;

const LOW_FRAG = /* glsl */ `${GEN_HEADER}
${COPPER_GLSL}
uniform sampler2D uFont;        // 1-bit glyph strip, 16 px per character, row 0 = top
uniform float uTextLen;
uniform int uPart, uNext;
uniform float uWipe, uCycle, uEffH, uBeatN;
uniform int uScroller;          // 0 band, 1 over, 2 off
uniform float uScrollX, uWaveAmp, uWaveFreq, uWavePhase, uStarX;
uniform float uPlasT;
uniform vec4 uRoto;             // angle, zoom (texels per pixel), pan x, pan y
uniform vec4 uTun;              // travel, twist, centre x, centre y
uniform vec4 uBalls[${BALLS}];      // x, line, radius, nearness (sorted near first)
uniform vec4 uShadows[${BALLS}];    // x, line, rx, ry
uniform vec4 uFloor;            // horizon line, eye height × focal, scroll, focal

const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  return (BAYER[q.x + q.y * 4] + 0.5) / 16.0;
}
// The 32-entry colour ramp built from the preset palette (12-bit, like the hardware).
vec3 rampI(float i) { return q12(palette(clamp(floor(i + 0.5), 0.0, 31.0) / 31.0)); }
// Continuous shade onto the ramp with 4×4 ordered dither.
vec3 rampT(float t, vec2 p) { return rampI(min(floor(clamp(t, 0.0, 1.0) * 31.0 + bayer4(p)), 31.0)); }

bool glyphBit(float gx, float gy) {
  if (gx < 0.0 || gy < 0.0 || gy > 15.0 || gx >= uTextLen * 16.0) return false;
  return texelFetch(uFont, ivec2(int(gx), int(gy)), 0).r > 0.5;
}

// ---- (a) plasma with true colour cycling: the index rotates, not the hue.
vec3 plasma(vec2 q) {
  float t = uPlasT;
  vec2 c1 = vec2(160.0 + 70.0 * sin(t * 0.43), uEffH * 0.5 + 55.0 * cos(t * 0.31));
  float v = sin(q.x * 0.043 + t) + sin(q.y * 0.051 - t * 1.27) + sin((q.x * 0.6 + q.y) * 0.031 + t * 0.71) + sin(length(q - c1) * 0.065 - t * 1.13);
  float idx = mod(floor((v + 4.0) * 4.5 + uCycle), 32.0);
  // Cyclic 32-step ramp: up through the even entries, back down through the odd ones.
  float r = idx < 16.0 ? idx * 2.0 : 63.0 - idx * 2.0;
  return rampI(r);
}

// ---- 64×64 procedural tile: bevelled checker plate with a faceted diamond stud in a shaded ring.
float tileT(ivec2 q) {
  ivec2 e = min(q, 63 - q);
  int edge = min(e.x, e.y);
  bool chk = (((q.x >> 3) + (q.y >> 3)) & 1) == 0;
  float t = chk ? 0.3 : 0.21;
  vec2 d = vec2(q) - 31.5;
  float r = length(d);
  const vec2 L = vec2(-0.7071, -0.7071);
  if (r > 22.5 && r < 28.5) {
    float across = (r - 25.5) / 3.0;
    t = 0.55 + 0.42 * across * dot(d / r, L) + 0.08 * (1.0 - abs(across));
    if (abs(across) > 0.8) t = 0.07;
  }
  float m = abs(d.x) + abs(d.y);
  if (m < 19.0) {
    if (m > 17.5) t = 0.06;
    else if (m < 6.0) t = 0.84;
    else if (d.x < 0.0 && d.y < 0.0) t = 1.0;
    else if (d.y < 0.0) t = 0.64;
    else if (d.x < 0.0) t = 0.46;
    else t = 0.27;
  }
  if (edge < 2) t = (e.x < e.y ? q.x < 32 : q.y < 32) ? 0.58 : 0.1;
  if (edge < 1) t = 0.04;
  return t;
}
vec3 rotozoom(vec2 q) {
  vec2 d = (q - vec2(160.0, uEffH * 0.5)) * uRoto.y;
  d = rot2(uRoto.x) * d + uRoto.zw;
  ivec2 t = ivec2(floor(d)) & 63;
  return rampI(tileT(t) * 31.0);
}

// ---- (c) polar-mapped textured tunnel (XOR texture) with depth falloff.
vec3 tunnel(vec2 q) {
  vec2 d = q - uTun.zw;
  d.x *= 0.94;
  float r = max(length(d), 0.5);
  float a = atan(d.y, d.x) / 6.2831853;
  float u = (a + uTun.y) * 256.0;
  float v = 3600.0 / r + uTun.x;
  ivec2 iuv = ivec2(floor(vec2(u, v))) & 63;
  float tex = float(iuv.x ^ iuv.y) / 63.0;
  bool band = ((iuv.y >> 4) & 1) == 0;
  tex = mix(tex, band ? 0.85 : 0.45, 0.35);
  float fog = clamp((r - 4.0) / 85.0, 0.0, 1.0);
  return rampT(tex * fog * (0.35 + 0.65 * fog) * 1.1, q);
}

// ---- dot starfield, three planes at three speeds.
float stars(float x, float line) {
  float s = 0.0;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float h = hash11(line * 1.371 + fk * 91.7);
    float plane = floor(h * 3.0);
    float sx = floor(fract(hash11(line * 7.13 + fk * 13.1 + 5.0) - uStarX * (plane + 1.0) / 320.0) * 320.0);
    float len = plane > 1.5 ? 2.0 : 1.0;
    if (x >= sx && x < sx + len) s = max(s, 0.3 + plane * 0.33);
  }
  return s;
}

// ---- (d) pre-shaded vector balls over a checker floor with shadows.
vec3 balls(vec2 q) {
  vec2 pc = q + 0.5;
  for (int i = 0; i < ${BALLS}; i++) {
    vec4 b = uBalls[i];
    vec2 d = (pc - b.xy) / b.z;
    float r2 = dot(d, d);
    if (r2 < 1.0) {
      float rim = 1.0 - 1.0 / b.z;
      if (r2 > rim * rim) return rampI(1.0);
      vec3 n = vec3(d.x, -d.y, sqrt(1.0 - r2));
      vec3 L = normalize(vec3(-0.45, 0.62, 0.65));
      float diff = max(dot(n, L), 0.0);
      float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 28.0);
      float t = (0.16 + 0.78 * diff) * mix(0.68, 1.0, b.w) + 0.6 * spec;
      return rampT(t, q);
    }
  }
  float hz = uFloor.x;
  if (q.y > hz) {
    float z = uFloor.y / (pc.y - hz);
    float X = (pc.x - 160.0) * z / uFloor.w;
    float chk = mod(floor(X * 1.6) + floor(z * 1.6 + uFloor.z), 2.0);
    float fog = clamp(1.25 - z / 11.0, 0.0, 1.0);
    float t = (chk > 0.5 ? 0.5 : 0.2) * fog * fog;
    for (int i = 0; i < ${BALLS}; i++) {
      vec4 s = uShadows[i];
      vec2 d = (pc - s.xy) / s.zw;
      if (dot(d, d) < 1.0) { t *= 0.45; break; }
    }
    return rampT(t, q);
  }
  // Sky is colour 0: the copper shows through, over the starfield.
  vec4 cp = copper(q.y);
  if (cp.a > 0.0) return cp.rgb * 0.5;
  float st = stars(q.x, q.y);
  return st > 0.0 ? rampI(10.0 + st * 21.0) : vec3(0.0);
}

vec3 part(int p, vec2 q) {
  if (p == 0) return plasma(q);
  if (p == 1) return rotozoom(q);
  if (p == 2) return tunnel(q);
  return balls(q);
}

// ---- 16×16 bitmap sine scroller.
bool scrollBit(float x, float line, float base, out float letter, out float row) {
  float yo = floor(uWaveAmp * sin(x * uWaveFreq + uWavePhase) + 0.5);
  float r = line - (base - 8.0 + yo);
  if (r < 0.0 || r > 15.0) return false;
  float period = (uTextLen + 4.0) * 16.0;
  float m = mod(x + floor(uScrollX), period);
  letter = floor(m / 16.0);
  row = r;
  return glyphBit(m, r);
}

void main() {
  vec2 fc = floor(gl_FragCoord.xy);
  float x = fc.x;
  float line = ${LH - 1}.0 - fc.y;
  vec2 q = vec2(x, line);
  vec3 col = vec3(0.0);
  bool bandMode = uScroller == 0;

  if (line < uEffH) {
    int p = uPart;
    float edge = -1.0;
    if (uWipe > 0.0) {
      // Raster-line wipe: line pairs sweep in from alternating sides, top first,
      // and the bottom line completes exactly as the wipe (and the phrase) ends.
      float delay = line / uEffH * 0.45;
      float w = clamp((uWipe - delay) / 0.55, 0.0, 1.0);
      bool fromLeft = mod(floor(line * 0.5), 2.0) < 0.5;
      float xx = fromLeft ? x : ${LW - 1}.0 - x;
      float e = floor(w * ${LW + 8}.0) - 4.0;
      if (xx < e) p = uNext;
      edge = abs(xx - e);
      if (w <= 0.0 || w >= 1.0) edge = -1.0;
    }
    col = part(p, q);
    if (edge >= 0.0 && edge < 4.0) col = q12(mix(hueLin(line / 64.0 + uBeatN * 0.13), vec3(1.0), 0.5)) * (edge < 2.0 ? 1.3 : 0.7);
  } else if (bandMode) {
    float dl = line - uEffH;
    if (dl < 4.0) {
      // Divider: an 8-pixel-step copper colour scroll.
      float h = floor((x + floor(uScrollX * 0.5)) / 8.0) * 0.035 + uBeatN * 0.125;
      vec3 c = mix(palette(0.5 + 0.5 * fract(h * 2.0)), hueLin(h), uRainbow);
      col = q12(c * (dl > 0.5 && dl < 2.5 ? 1.1 : 0.4));
    } else {
      float st = stars(x, line);
      col = st > 0.0 ? rampI(10.0 + st * 21.0) : vec3(0.0);
    }
  }

  if (uScroller != 2) {
    float base = bandMode ? uEffH + 4.0 + (${LH}.0 - uEffH - 4.0) * 0.5 : ${LH}.0 - 34.0;
    bool allowed = !bandMode || line >= uEffH + 4.0;
    float letter, row, l2, r2;
    if (allowed && scrollBit(x, line, base, letter, row)) {
      vec3 rb = hueLin(letter * 0.083 + row * 0.028 - uBeatN * 0.0417);
      vec3 pc = palette(0.62 + 0.38 * (1.0 - row / 15.0) * (0.75 + 0.25 * fract(letter * 0.618)));
      vec3 c = mix(pc, rb, uRainbow) * (1.2 - row / 15.0 * 0.45) + vec3(max(0.0, 0.5 - row * 0.17));
      col = q12(c);
    } else if (allowed && scrollBit(x - 2.0, line - 2.0, base, l2, r2)) {
      col = rampI(1.0) * 0.5;
    }
  }
  fragColor = vec4(col, 1.0);
}
`;

const UP_FRAG = /* glsl */ `${GEN_HEADER}
${COPPER_GLSL}
uniform sampler2D uLow;
uniform float uBorder, uScan;
uniform vec2 uShake;
void main() {
  float playH = floor(uRes.y * (1.0 - 2.0 * uBorder));
  float playW = min(floor(playH * 4.0 / 3.0), uRes.x);
  vec2 org = floor((uRes - vec2(playW, playH)) * 0.5);
  vec2 lp = (gl_FragCoord.xy - org) / vec2(playW, playH) * vec2(${LW}.0, ${LH}.0);
  vec3 col;
  if (lp.x >= 0.0 && lp.x < ${LW}.0 && lp.y >= 0.0 && lp.y < ${LH}.0) {
    vec2 sp = lp - uShake;
    if (sp.x < 0.0 || sp.x >= ${LW}.0 || sp.y < 0.0 || sp.y >= ${LH}.0) col = vec3(0.0);
    else {
      // Sharp upscale: nearest pixels, with only the pixel edges anti-aliased.
      vec2 px = sp - 0.5;
      vec2 i = floor(px);
      vec2 f = px - i;
      vec2 sc = 1.0 / max(fwidth(sp), vec2(1e-4));
      vec2 a = clamp((f - 0.5) * sc + 0.5, 0.0, 1.0);
      col = texture(uLow, (i + 0.5 + a) / vec2(${LW}.0, ${LH}.0)).rgb;
    }
  } else {
    // The opened border: copper bars keep running on every raster line.
    col = copper(floor(${LH}.0 - lp.y)).rgb;
  }
  float fy = fract(lp.y);
  col *= mix(1.0, 0.4 + 0.8 * sin(3.14159265 * fy), uScan);
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

interface FontAtlas {
  data: Uint8Array;
  len: number;
  /** Per character: lit cells of an 8×8 grid as [gx, gy, …]. */
  cells: number[][];
  /** Character indices of the first word (spelled by the vector balls). */
  word: number[];
  }

function buildFont(text: string): FontAtlas {
  const chars = Array.from(text.toUpperCase().replace(/\s+/g, ' ').trim()).slice(0, MAX_CHARS);
  if (!chars.length) chars.push(' ');
  const n = chars.length;
  const S = 4;
  const C = 16;
  const cv = document.createElement('canvas');
  cv.width = n * C * S;
  cv.height = C * S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.font = fontCss('mono', 64);
  const cap = g.measureText('H').actualBoundingBoxAscent || 46;
  const adv = g.measureText('M').width || 38;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineWidth = 4.5;
  g.textBaseline = 'alphabetic';
  chars.forEach((ch, k) => {
    g.save();
    g.translate(k * C * S + 1.2 * S, 14.4 * S);
    g.scale((13.4 * S) / adv, (12.8 * S) / cap);
    g.fillText(ch, 0, 0);
    g.strokeText(ch, 0, 0);
    g.restore();
  });
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const W = n * C;
  const data = new Uint8Array(W * C);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) sum += img[((y * S + sy) * cv.width + x * S + sx) * 4 + 3];
      data[y * W + x] = sum / (S * S * 255) > 0.45 ? 255 : 0;
    }
  }
  const cells: number[][] = [];
  for (let k = 0; k < n; k++) {
    const list: number[] = [];
    for (let gy = 0; gy < 8; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        let lit = 0;
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) if (data[(gy * 2 + sy) * W + k * C + gx * 2 + sx]) lit++;
        if (lit >= 2) list.push(gx, gy);
      }
    }
    cells.push(list);
  }
  const firstWord: number[] = [];
  for (let k = 0; k < n && chars[k] !== ' '; k++) if (cells[k].length) firstWord.push(k);
  return { data, len: n, cells, word: firstWord };
}

// ---- Vector-ball formations (model space, ~±1.2 units).
function cubeFormation(): Float32Array {
  const out = new Float32Array(BALLS * 3);
  for (let k = 0; k < BALLS; k++) {
    out[k * 3] = ((k % 4) - 1.5) * 0.6;
    out[k * 3 + 1] = ((Math.floor(k / 4) % 4) - 1.5) * 0.6;
    out[k * 3 + 2] = (Math.floor(k / 16) - 1.5) * 0.6;
  }
  return out;
}
function sphereFormation(): Float32Array {
  const out = new Float32Array(BALLS * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < BALLS; k++) {
    const y = 1 - ((k + 0.5) / BALLS) * 2;
    const r = Math.sqrt(1 - y * y);
    out[k * 3] = Math.cos(k * ga) * r * 1.22;
    out[k * 3 + 1] = y * 1.22;
    out[k * 3 + 2] = Math.sin(k * ga) * r * 1.22;
  }
  return out;
}
function torusFormation(): Float32Array {
  const out = new Float32Array(BALLS * 3);
  for (let k = 0; k < BALLS; k++) {
    const a = ((k % 16) / 16) * Math.PI * 2;
    const b = (Math.floor(k / 16) / 4) * Math.PI * 2 + (k % 2) * 0.4;
    const rr = 1.0 + 0.4 * Math.cos(b);
    out[k * 3] = Math.cos(a) * rr;
    out[k * 3 + 1] = Math.sin(b) * 0.4;
    out[k * 3 + 2] = Math.sin(a) * rr;
  }
  return out;
}
function letterFormation(cells: number[], fallback: Float32Array): Float32Array {
  const n = cells.length / 2;
  if (!n) return fallback;
  const out = new Float32Array(BALLS * 3);
  let minX = 9;
  let maxX = -1;
  let minY = 9;
  let maxY = -1;
  for (let c = 0; c < n; c++) {
    minX = Math.min(minX, cells[c * 2]);
    maxX = Math.max(maxX, cells[c * 2]);
    minY = Math.min(minY, cells[c * 2 + 1]);
    maxY = Math.max(maxY, cells[c * 2 + 1]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const layers = Math.min(3, Math.ceil(BALLS / n));
  for (let k = 0; k < BALLS; k++) {
    const c = k % n;
    const layer = Math.floor(k / n) % layers;
    out[k * 3] = (cells[c * 2] - cx) * 0.36;
    out[k * 3 + 1] = (cy - cells[c * 2 + 1]) * 0.36;
    out[k * 3 + 2] = (layer - (layers - 1) / 2) * 0.32;
  }
  return out;
}

const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Sine-scroller waves picked per bar: [height in lines, frequency in rad/pixel]. */
const WAVES: Array<[number, number]> = [
  [7, 0.034],
  [11, 0.021],
  [4, 0.068],
  [12, 0.015],
  [8, 0.047],
  [2, 0.11],
];

const PARTS = ['plasma', 'rotozoom', 'tunnel', 'balls'];

// Ball camera (model units → 320×256 pixels).
const FOCAL = 205;
const CAM_D = 4.7;
const EYE_Y = 0.95;
const FLOOR_Y = -1.6;
const BALL_R = 0.17;

/**
 * A 320×256, 32-colour demoscene megademo in phrase-sequenced parts: plasma
 * with true colour cycling, a rotozoomer, a textured tunnel and shaded vector
 * balls, joined by raster-line wipes that land on the phrase downbeat, with a
 * bitmap sine scroller and copper bars running through the opened borders.
 * Everything is a pure function of the beat clock, so every window agrees.
 */
export class DemoParts extends ShaderGenerator {
  readonly kind = 'demoParts';
  private readonly low: THREE.WebGLRenderTarget;
  private readonly up: FullscreenPass;
  private readonly upU: Uniforms;
  private font: FontAtlas | null = null;
  private fontTex: THREE.DataTexture | null = null;
  private text = '';
  private readonly forms = new Map<string, Float32Array>();
  private readonly cube = cubeFormation();
  private readonly sphere = sphereFormation();
  private readonly torus = torusFormation();
  private readonly pos = new Float32Array(BALLS * 3);
  private readonly proj = new Float32Array(BALLS * 4);
  private readonly order = new Int32Array(BALLS);
  private readonly depth = new Float32Array(BALLS);

  constructor() {
    const copperU: Uniforms = {
      uCopN: { value: 7 },
      uCopBuild: { value: 0 },
      uCopPhase: { value: 0 },
      uCopFast: { value: 0 },
      uCopJump: { value: 0 },
      uCopH: { value: 9 },
      uCopCentre: { value: LH / 2 },
      uCopAmp: { value: 118 },
      uRainbow: { value: 1 },
      uCopGain: { value: 1 },
    };
    super(LOW_FRAG, {
      ...copperU,
      uFont: { value: null },
      uTextLen: { value: 1 },
      uPart: { value: 0 },
      uNext: { value: 1 },
      uWipe: { value: 0 },
      uCycle: { value: 0 },
      uEffH: { value: BAND_EFF_H },
      uBeatN: { value: 0 },
      uScroller: { value: 0 },
      uScrollX: { value: 0 },
      uWaveAmp: { value: 6 },
      uWaveFreq: { value: 0.03 },
      uWavePhase: { value: 0 },
      uStarX: { value: 0 },
      uPlasT: { value: 0 },
      uRoto: { value: new THREE.Vector4(0, 0.5, 0, 0) },
      uTun: { value: new THREE.Vector4(0, 0, LW / 2, BAND_EFF_H / 2) },
      uBalls: { value: new Float32Array(BALLS * 4) },
      uShadows: { value: new Float32Array(BALLS * 4) },
      uFloor: { value: new THREE.Vector4(60, 2, 0, FOCAL) },
    });
    this.low = new THREE.WebGLRenderTarget(LW, LH, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.upU = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uPal: this.u.uPal,
      uLow: { value: this.low.texture },
      uBorder: { value: 0.04 },
      uScan: { value: 0.35 },
      uShake: { value: new THREE.Vector2() },
    };
    for (const k of Object.keys(copperU)) this.upU[k] = this.u[k];
    this.up = new FullscreenPass(
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: UP_FRAG, uniforms: this.upU, depthTest: false, depthWrite: false }),
    );
    this.setText('BOOFVIZ');
  }

  private setText(text: string): void {
    this.text = text;
    const font = buildFont(text);
    this.font = font;
    this.fontTex?.dispose();
    const tex = new THREE.DataTexture(font.data, font.len * 16, 16, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.fontTex = tex;
    this.u.uFont.value = tex;
    this.u.uTextLen.value = font.len;
    this.forms.clear();
  }

  /** Formation shown from integer beat k: cube, sphere, torus bars, then one letter per beat. */
  private formationKey(k: number, bpb: number): string {
    const bar = Math.floor(k / bpb);
    const sel = mod(bar, 4);
    if (sel < 3) return ['cube', 'sphere', 'torus'][sel];
    const word = this.font!.word;
    if (!word.length) return 'sphere';
    const n = Math.floor(bar / 4) * bpb + mod(k, bpb);
    return `L${word[mod(n, word.length)]}`;
  }

  private formation(key: string): Float32Array {
    if (key === 'cube') return this.cube;
    if (key === 'sphere') return this.sphere;
    if (key === 'torus') return this.torus;
    let f = this.forms.get(key);
    if (!f) {
      f = letterFormation(this.font!.cells[Number(key.slice(1))] ?? [], this.sphere);
      this.forms.set(key, f);
    }
    return f;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const { frame, env } = ctx;
    const text = String(p.text ?? 'BOOFVIZ');
    if (text !== this.text) this.setText(text);

    const beat = ctx.beat;
    const time = ctx.time;
    const bpb = Math.max(1, Math.round(frame.beatsPerBar) || 4);
    const bpp = Math.max(bpb, Math.round(frame.beatsPerPhrase) || 16);
    const kInt = Math.floor(beat);
    const bp = beat - kInt;
    u.uBeatN.value = kInt;

    // ---- Part sequencer: the part is a pure function of the phrase-aligned beat.
    const lock = String(p.part ?? 'sequence');
    const seq = PARTS.includes(lock) ? [PARTS.indexOf(lock)] : [0, 1, 2, 3];
    const partLen = bpp * Math.max(1, Math.round(num(p.partPhrases, 1)));
    const partIdx = Math.floor(beat / partLen);
    const local = beat - partIdx * partLen;
    const cur = seq[mod(partIdx, seq.length)];
    const next = seq[mod(partIdx + 1, seq.length)];
    const wipeBeats = Math.min(partLen / 2, Math.max(0.25, num(p.wipeBeats, 2)));
    u.uPart.value = cur;
    u.uNext.value = next;
    u.uWipe.value = next !== cur ? clamp01((local - (partLen - wipeBeats)) / wipeBeats) : 0;

    const mode = String(p.scroller ?? 'band');
    const scroller = mode === 'over' ? 1 : mode === 'off' ? 2 : 0;
    u.uScroller.value = scroller;
    const effH = scroller === 0 ? BAND_EFF_H : LH;
    u.uEffH.value = effH;

    // ---- Copper bars: beat-locked swing plus a damped jump restarted on every beat.
    const bars = Math.max(0, Math.min(MAX_BARS, Math.round(num(p.bars, 7))));
    const cs = num(p.copperSpeed, 1);
    u.uCopN.value = bars;
    u.uCopBuild.value = frame.energyTrend === 'building' ? 1 : 0;
    u.uCopPhase.value = ((beat * Math.PI * 2) / (bpb * 2)) * cs;
    u.uCopFast.value = ((beat * Math.PI * 2) / bpb) * cs * 1.5;
    const kickF = 0.45 + 0.55 * clamp01(env.kick * 1.4);
    u.uCopJump.value = -num(p.jump, 1) * 20 * kickF * Math.exp(-5 * bp) * Math.sin(bp * Math.PI * 2.5);
    u.uRainbow.value = clamp01(num(p.rainbow, 1));
    u.uCopGain.value = num(p.copperGlow, 1);

    // ---- Colour cycling: one stepped notch per beat, plus an optional steady drift.
    u.uCycle.value = kInt * Math.round(num(p.cycleStep, 2)) + Math.floor(time * num(p.cycleRate, 8));
    u.uPlasT.value = time * 0.55;

    // ---- Rotozoomer: spin, a 4-bar zoom swing, kick pump.
    const zoomSwing = 0.5 - 0.5 * Math.cos((beat * Math.PI * 2) / (bpb * 4));
    const zoom = (0.28 + 1.05 * zoomSwing) * (1 - 0.06 * env.kick);
    (u.uRoto.value as THREE.Vector4).set(time * 0.42 + 0.5 * Math.sin(time * 0.23), zoom, time * 18, time * 11);

    // ---- Tunnel: surges forward on every beat, slow twist, wandering centre.
    const travel = (kInt + easeOut(bp)) * 14;
    (u.uTun.value as THREE.Vector4).set(travel, time * 0.05, LW / 2 + 46 * Math.sin(time * 0.63), effH / 2 + 26 * Math.sin(time * 0.87));

    // ---- Starfield: steady drift that ticks forward on every 8th note.
    const e8 = beat * 2;
    u.uStarX.value = num(p.stars, 1) * (time * 22 + 7 * (Math.floor(e8) + easeOut(e8 - Math.floor(e8))));

    // ---- Scroller: the wave switches on every downbeat.
    const bar = Math.floor(beat / bpb);
    const wA = WAVES[Math.floor(hash01(bar, 401) * WAVES.length)];
    const wB = WAVES[Math.floor(hash01(bar - 1, 401) * WAVES.length)];
    const wm = easeInOut(clamp01((beat - bar * bpb) / 0.35));
    const waveK = num(p.wave, 1);
    u.uWaveAmp.value = (wB[0] + (wA[0] - wB[0]) * wm) * waveK * (scroller === 0 ? 1 : 1.6);
    u.uWaveFreq.value = wB[1] + (wA[1] - wB[1]) * wm;
    u.uWavePhase.value = time * 2.6;
    u.uScrollX.value = beat * num(p.scrollSpeed, 40);

    // ---- Drop: time since the drop from the decaying drop envelope (pure function of it).
    const bpm = frame.bpm > 0 ? frame.bpm : 120;
    const since = env.drop > 1e-4 ? ((-3 * Math.log(env.drop) * bpm) / 60) * (ctx.globals.speed || 1) : Infinity;
    const shake = Math.pow(clamp01(1 - since / bpb), 2) * num(p.shake, 1);
    const sk = Math.floor(time * 25);
    (this.upU.uShake.value as THREE.Vector2).set(Math.round((hash01(sk, 11) * 2 - 1) * 3 * shake), Math.round((hash01(sk, 12) * 2 - 1) * 3 * shake));
    let burst = 0;
    if (since < Infinity) {
      const dropBeat = beat - since;
      const reform = (Math.floor(dropBeat / bpb + 0.25) + 1) * bpb;
      const e = (beat - dropBeat) / Math.max(0.5, reform - dropBeat);
      if (e >= 0 && e < 1) burst = Math.sin(Math.PI * Math.pow(e, 0.55)) * num(p.explode, 1);
    }

    this.updateBalls(ctx, beat, bpb, effH, burst);
    this.upU.uBorder.value = num(p.border, 0.04);
    this.upU.uScan.value = num(p.scanlines, 0.35);
  }

  private updateBalls(ctx: GenContext, beat: number, bpb: number, effH: number, burst: number): void {
    const kInt = Math.floor(beat);
    const fr = beat - kInt;
    const keyA = this.formationKey(kInt - 1, bpb);
    const keyB = this.formationKey(kInt, bpb);
    const A = this.formation(keyA);
    const B = this.formation(keyB);
    const letterA = keyA[0] === 'L';
    const letterB = keyB[0] === 'L';
    let m = 1;
    if (keyA !== keyB) m = easeInOut(clamp01(fr / (letterA && letterB ? 0.5 : 1)));
    const pos = this.pos;
    for (let i = 0; i < BALLS * 3; i++) pos[i] = A[i] + (B[i] - A[i]) * m;

    // Letters turn to face the viewer; shapes tumble.
    const textW = letterA && letterB ? 1 : letterB ? m : letterA ? 1 - m : 0;
    const t = ctx.time;
    let yaw = t * 0.8 + 0.35 * Math.sin((beat * Math.PI) / (bpb * 2));
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    yaw = yaw + (0.28 * Math.sin(t * 1.3) - yaw) * textW;
    const pitch = 0.42 + 0.22 * Math.sin(t * 0.37) + (0.08 * Math.sin(t * 0.9) - 0.42 - 0.22 * Math.sin(t * 0.37)) * textW;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const pump = 1 + 0.04 * num(ctx.params.pump, 1) * ctx.env.kick;
    const horizon = Math.round(effH * 0.3);
    const proj = this.proj;
    const depth = this.depth;
    const shadows = this.u.uShadows.value as Float32Array;
    for (let k = 0; k < BALLS; k++) {
      let x = pos[k * 3] * pump;
      let y = pos[k * 3 + 1] * pump;
      let z = pos[k * 3 + 2] * pump;
      if (burst > 0) {
        const len = Math.hypot(x, y, z) || 1;
        const j = 1.6 + hash01(k, 77) * 1.8;
        x += (x / len + (hash01(k, 78) - 0.5) * 0.8) * burst * j;
        y += (y / len + (hash01(k, 79) - 0.3) * 0.8) * burst * j;
        z += (z / len + (hash01(k, 80) - 0.5) * 0.8) * burst * j;
      }
      // Yaw about Y, then pitch about X.
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const zc = Math.max(0.6, z2 + CAM_D);
      const s = FOCAL / zc;
      proj[k * 4] = LW / 2 + x1 * s;
      proj[k * 4 + 1] = horizon + (EYE_Y - y2) * s;
      proj[k * 4 + 2] = Math.max(1.5, BALL_R * s);
      proj[k * 4 + 3] = clamp01((CAM_D + 1.4 - zc) / 2.8);
      depth[k] = zc;
      // Shadow: the ball dropped straight onto the floor plane.
      shadows[k * 4] = LW / 2 + x1 * s;
      shadows[k * 4 + 1] = horizon + (EYE_Y - FLOOR_Y) * s;
      shadows[k * 4 + 2] = BALL_R * 1.05 * s;
      shadows[k * 4 + 3] = (BALL_R * 1.05 * s * (EYE_Y - FLOOR_Y)) / zc;
    }
    // Depth sort, nearest first (the shader stops at the first hit).
    const order = this.order;
    for (let k = 0; k < BALLS; k++) {
      let j = k;
      while (j > 0 && depth[order[j - 1]] > depth[k]) {
        order[j] = order[j - 1];
        j--;
      }
      order[j] = k;
    }
    const balls = this.u.uBalls.value as Float32Array;
    for (let k = 0; k < BALLS; k++) {
      const o = order[k] * 4;
      balls[k * 4] = proj[o];
      balls[k * 4 + 1] = proj[o + 1];
      balls[k * 4 + 2] = proj[o + 2];
      balls[k * 4 + 3] = proj[o + 3];
    }
    (this.u.uFloor.value as THREE.Vector4).set(horizon, (EYE_Y - FLOOR_Y) * FOCAL, beat * 1.6, FOCAL);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    (this.u.uRes.value as THREE.Vector2).set(LW, LH);
    this.pass.render(renderer, this.low);
    (this.upU.uRes.value as THREE.Vector2).set(target.width, target.height);
    this.up.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [this.pass, this.up];
  }

  dispose(): void {
    super.dispose();
    this.up.dispose();
    this.low.dispose();
    this.fontTex?.dispose();
  }
}
