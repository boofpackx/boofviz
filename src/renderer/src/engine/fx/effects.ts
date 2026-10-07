import * as THREE from 'three';
import type { ParamBag } from '@shared/types/engine';
import { FULLSCREEN_VERT, PALETTE_GLSL, UTIL_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';

export interface FxContext {
  palette: Float32Array;
  dt: number;
  time: number;
  /** Phrase-aligned beat × speed. */
  beat: number;
  beatsPerBar: number;
  kick: number;
  frameIndex: number;
}

/** A post-processing pass. Returns the target holding its result. */
export interface Effect {
  readonly kind: string;
  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, params: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget;
  resize?(w: number, h: number): void;
  /** Passes whose shaders can be compiled in the background before first use. */
  compileTargets?(): FullscreenPass[];
  dispose(): void;
}

const HEADER = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
uniform vec2 uRes;
in vec2 vUv;
out vec4 fragColor;
${UTIL_GLSL}
`;

export function hdrTarget(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: depth,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
}

function material(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms: { uInput: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, ...uniforms },
    depthTest: false,
    depthWrite: false,
  });
}

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/** Single-pass effect: set uniforms from params, draw input → out. */
class SimpleEffect implements Effect {
  protected readonly pass: FullscreenPass;
  constructor(
    readonly kind: string,
    frag: string,
    uniforms: Record<string, THREE.IUniform>,
    private readonly apply: (u: Record<string, THREE.IUniform>, p: ParamBag, ctx: FxContext) => void,
  ) {
    this.pass = new FullscreenPass(material(frag, uniforms));
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, params: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget {
    const u = this.pass.material.uniforms;
    u.uInput.value = input.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    this.apply(u, params, ctx);
    this.pass.render(renderer, out);
    return out;
  }

  compileTargets(): FullscreenPass[] {
    return [this.pass];
  }

  dispose(): void {
    this.pass.dispose();
  }
}

// ---------------------------------------------------------------------------

const MIRROR = `${HEADER}
uniform int uMode; uniform bool uFlip;
void main() {
  vec2 uv = vUv;
  if (uMode == 0 || uMode == 2) { if (uFlip ? uv.x < 0.5 : uv.x > 0.5) uv.x = 1.0 - uv.x; }
  if (uMode == 1 || uMode == 2) { if (uFlip ? uv.y > 0.5 : uv.y < 0.5) uv.y = 1.0 - uv.y; }
  fragColor = texture(uInput, uv);
}`;

const KALEIDO = `${HEADER}
uniform float uSegments; uniform float uAngle; uniform float uZoom;
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) / uZoom;
  float r = length(p);
  float a = atan(p.y, p.x) + uAngle;
  float seg = 6.28318531 / uSegments;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 q = r * vec2(cos(a), sin(a));
  vec2 uv = q / vec2(aspect, 1.0) + 0.5;
  // Mirror-repeat so the fold never samples outside the frame.
  uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  fragColor = texture(uInput, uv);
}`;

const RGB_SPLIT = `${HEADER}
uniform float uAmount; uniform float uAngle; uniform float uRadial;
void main() {
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  vec2 rad = (vUv - 0.5);
  vec2 off = mix(dir, rad * 2.0, uRadial) * uAmount;
  vec4 c = texture(uInput, vUv);
  float r = texture(uInput, vUv + off).r;
  float b = texture(uInput, vUv - off).b;
  fragColor = vec4(r, c.g, b, c.a);
}`;

const GRADIENT_MAP = `${HEADER}
${PALETTE_GLSL}
uniform float uMix; uniform float uOffset; uniform float uContrast;
void main() {
  vec4 c = texture(uInput, vUv);
  float l = luma(c.rgb);
  // Tonemap-ish so HDR highlights land on the top stop instead of clipping.
  float t = clamp(pow(l / (1.0 + l), 1.0 / uContrast) * 1.6, 0.0, 1.0);
  // Ping-pong wrap so animating the offset cycles smoothly through the palette.
  t = 1.0 - abs(1.0 - mod(t + uOffset * 2.0, 2.0));
  vec3 g = palette(t);
  g *= 1.0 + max(l - 1.0, 0.0);
  fragColor = vec4(mix(c.rgb, g, uMix), c.a);
}`;

const GRADE = `${HEADER}
uniform float uExposure; uniform float uContrast; uniform float uSaturation; uniform float uHue; uniform float uTemp;
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec4 src = texture(uInput, vUv);
  vec3 c = src.rgb * exp2(uExposure);
  // Contrast around linear mid-grey in log space.
  c = 0.18 * pow(max(c, 1e-5) / 0.18, vec3(uContrast));
  c = max(hueRotate(c, uHue), 0.0);
  float l = luma(c);
  c = max(mix(vec3(l), c, uSaturation), 0.0);
  c *= vec3(1.0 + 0.25 * uTemp, 1.0, 1.0 - 0.25 * uTemp);
  fragColor = vec4(c, src.a);
}`;

const VIGNETTE = `${HEADER}
uniform float uAmount; uniform float uSize; uniform float uSoft;
void main() {
  vec4 c = texture(uInput, vUv);
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float d = length(p) / (0.5 * uSize * 1.4);
  float v = 1.0 - uAmount * smoothstep(1.0 - uSoft, 1.0 + uSoft * 0.5, d);
  fragColor = vec4(c.rgb * v, c.a);
}`;

const GRAIN = `${HEADER}
uniform float uAmount; uniform float uSize; uniform float uSeed;
void main() {
  vec4 c = texture(uInput, vUv);
  vec2 cell = floor(gl_FragCoord.xy / uSize);
  float g = hash21(cell + uSeed * 17.0) + hash21(cell * 1.7 + uSeed * 31.0) - 1.0;
  float l = luma(c.rgb);
  // Grain strongest in the mid-tones, like film.
  float w = 4.0 * l / (1.0 + l) * (1.0 - l / (1.0 + l));
  fragColor = vec4(max(c.rgb + g * uAmount * (0.35 + w), 0.0), c.a);
}`;

const HALFTONE = `${HEADER}
${PALETTE_GLSL}
uniform float uCell; uniform float uAngle; uniform int uMode; uniform float uMix;
float screenDot(vec2 frag, float ang, float cell, out vec2 center) {
  mat2 r = rot2(ang);
  vec2 q = r * frag / cell;
  vec2 id = floor(q) + 0.5;
  center = transpose(r) * (id * cell);
  return length(q - id);
}
void main() {
  vec4 src = texture(uInput, vUv);
  vec2 frag = gl_FragCoord.xy;
  vec3 col;
  if (uMode == 2) {
    // CMYK screens at the classic angles, printed on paper.
    vec3 paper = vec3(0.95, 0.93, 0.88);
    col = paper;
    float angs[4] = float[4](0.2618, 1.309, 0.0, 0.7854);
    vec3 inks[4] = vec3[4](vec3(0.0, 0.6, 0.85), vec3(0.85, 0.1, 0.5), vec3(0.98, 0.85, 0.0), vec3(0.08));
    for (int i = 0; i < 4; i++) {
      vec2 c;
      float d = screenDot(frag, angs[i] + uAngle, uCell, c);
      vec3 s = clamp(texture(uInput, c / uRes).rgb, 0.0, 1.0);
      vec3 cmy = 1.0 - s;
      float k = min(cmy.r, min(cmy.g, cmy.b));
      float amt = i == 0 ? cmy.r - k : i == 1 ? cmy.g - k : i == 2 ? cmy.b - k : k;
      float r = sqrt(max(amt, 0.0)) * 0.62;
      float on = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
      col = mix(col, col * inks[i] * 1.05, on * 0.92);
    }
  } else {
    vec2 c;
    float d = screenDot(frag, uAngle, uCell, c);
    vec3 s = texture(uInput, c / uRes).rgb;
    float l = clamp(luma(s), 0.0, 1.0);
    float r = sqrt(l) * 0.62;
    float on = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
    // 0: dots in the image's own colours on black; 1: palette ink on paper (comic print).
    col = uMode == 0 ? s * on * 1.5 : mix(uPal[4], uPal[0], on);
  }
  fragColor = vec4(mix(src.rgb, col, uMix), max(src.a, uMix));
}`;

const LED_SCREEN = `${HEADER}
uniform float uCell; uniform float uGap; uniform float uGlowAmt;
void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 f = fract(gl_FragCoord.xy / uCell) - 0.5;
  vec4 s = texture(uInput, (cell + 0.5) * uCell / uRes);
  float d = length(f);
  float r = 0.5 - uGap;
  float led = 1.0 - smoothstep(r - 0.08, r + 0.02, d);
  vec3 c = s.rgb * led * 1.5 + s.rgb * exp(-d * 6.0) * 0.25 * uGlowAmt;
  // Unlit diodes stay faintly visible, like a real panel.
  c += vec3(0.02) * led;
  fragColor = vec4(c, 1.0);
}`;

const POP_GRID = `${HEADER}
${PALETTE_GLSL}
uniform float uTiles; uniform float uHueStep; uniform float uLevels;
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec2 g = vUv * uTiles;
  vec2 id = floor(g);
  vec2 uv = fract(g);
  vec3 s = texture(uInput, uv).rgb;
  // Each tile: posterised, then pushed to its own flat colour scheme (screen-print look).
  float l = clamp(luma(s) / (1.0 + luma(s)) * 1.8, 0.0, 1.0);
  float q = floor(l * uLevels) / max(uLevels - 1.0, 1.0);
  float tileIdx = id.x + id.y * uTiles;
  vec3 c = palette(fract(q * 0.85 + tileIdx * 0.21));
  c = max(hueRotate(c, tileIdx * uHueStep), 0.0) * (0.6 + 0.8 * q);
  // Thin white gutters between tiles.
  vec2 e = min(uv, 1.0 - uv) * uRes / uTiles;
  c = mix(vec3(0.95), c, smoothstep(1.0, 3.0, min(e.x, e.y)));
  fragColor = vec4(c, 1.0);
}`;

const CRT = `${HEADER}
uniform float uCurve; uniform float uScan; uniform float uMask; uniform float uVig;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p *= 1.0 + uCurve * 0.12 * dot(p.yx, p.yx);
  vec2 uv = p * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float off = 1.2 / uRes.x;
  vec3 c = vec3(texture(uInput, uv + vec2(off, 0.0)).r, texture(uInput, uv).g, texture(uInput, uv - vec2(off, 0.0)).b);
  float line = 0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159);
  c *= mix(1.0, 0.55 + 0.6 * line, uScan);
  int m = int(mod(gl_FragCoord.x, 3.0));
  vec3 mask = m == 0 ? vec3(1.0, 0.7, 0.7) : m == 1 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
  c *= mix(vec3(1.0), mask * 1.15, uMask);
  c *= 1.0 - uVig * 0.8 * dot(p * 0.5, p * 0.5) * 1.6;
  fragColor = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------------------


const RETRO_PALETTE = `${HEADER}
uniform float uPixel; uniform float uDither; uniform vec3 uCols[8]; uniform int uCount;
// Display-ish space for colour matching (input is linear HDR).
vec3 disp(vec3 c) { return pow(c / (1.0 + c), vec3(1.0 / 2.2)); }
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i.y * 4 + i.x]) + 0.5) / 16.0;
}
void main() {
  vec2 cell = floor(gl_FragCoord.xy / uPixel);
  vec2 uv = (cell + 0.5) * uPixel / uRes;
  vec4 src = texture(uInput, uv);
  vec3 c = disp(src.rgb) + (bayer4(cell) - 0.5) * 0.35 * uDither;
  vec3 best = uCols[0];
  float bd = 1e9;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    vec3 d = c - disp(uCols[i]);
    float dd = dot(d, d);
    if (dd < bd) { bd = dd; best = uCols[i]; }
  }
  fragColor = vec4(best, max(src.a, 1.0));
}`;

const VHS = `${HEADER}
uniform float uAmount; uniform float uTracking; uniform float uNoise; uniform float uBleed; uniform float uTime; uniform float uKick;
void main() {
  vec2 uv = vUv;
  float line = floor(uv.y * 240.0);
  float t = floor(uTime * 30.0);
  // Line jitter, a slow wobble, and a tracking band rolling down the frame.
  float jitter = (hash21(vec2(line, t)) - 0.5) * 0.0025 * uAmount;
  float wobble = sin(uv.y * 9.0 + uTime * 1.7) * 0.0012 * uAmount;
  float bandY = 1.0 - fract(uTime * 0.07);
  float band = smoothstep(0.04, 0.0, abs(uv.y - bandY)) * uTracking;
  float head = smoothstep(0.06, 0.0, uv.y) * uAmount;   // head-switching noise at the bottom
  float shift = jitter + wobble + band * (hash21(vec2(line, t + 3.0)) - 0.3) * 0.04 + head * (hash21(vec2(line, t)) * 0.05) + uKick * 0.002 * uAmount;
  uv.x += shift;
  // Chroma bleeds sideways; luma stays sharper (tape's low colour bandwidth).
  float b = 0.004 * uBleed;
  vec3 c = texture(uInput, uv).rgb;
  vec3 cl = (texture(uInput, uv - vec2(b, 0.0)).rgb + texture(uInput, uv - vec2(2.0 * b, 0.0)).rgb) * 0.5;
  vec3 cr = (texture(uInput, uv + vec2(b, 0.0)).rgb + texture(uInput, uv + vec2(2.0 * b, 0.0)).rgb) * 0.5;
  float y = luma(c);
  vec3 chroma = (cl + cr) * 0.5 - luma((cl + cr) * 0.5);
  vec3 col = vec3(y) + chroma * 0.9 + vec3(cl.r - c.r, 0.0, cr.b - c.b) * 0.5 * uBleed;
  // Tape noise: fine grain, sparse dropout streaks, snow in the band and head area.
  float n = hash21(gl_FragCoord.xy + t * 7.0) - 0.5;
  col += n * 0.06 * uNoise;
  float drop = step(0.998 - 0.002 * uNoise, hash21(vec2(line, t * 1.3)));
  col += drop * vec3(0.8) * smoothstep(0.0, 0.2, hash21(vec2(floor(uv.x * 60.0), line)));
  col = mix(col, vec3(hash21(gl_FragCoord.xy * 0.5 + t)), clamp((band * 0.35 + head * 0.6) * uNoise, 0.0, 1.0));
  col *= 0.94 + 0.06 * sin(gl_FragCoord.y * 3.14159);
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

const FEEDBACK = `${HEADER}
uniform sampler2D uPrev;
uniform float uAmount; uniform float uZoom; uniform float uRotate; uniform vec2 uShift; uniform float uHue; uniform int uBlend;
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  p = rot2(uRotate) * p / (1.0 + uZoom);
  vec2 uv = p / vec2(aspect, 1.0) + 0.5 - uShift;
  vec4 prev = texture(uPrev, uv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) prev = vec4(0.0);
  prev.rgb = max(hueRotate(prev.rgb, uHue), 0.0) * uAmount;
  prev.a *= uAmount;
  vec4 cur = texture(uInput, vUv);
  vec3 c;
  if (uBlend == 1) c = cur.rgb + prev.rgb;
  else if (uBlend == 2) c = cur.rgb + prev.rgb * (1.0 - clamp(cur.rgb, 0.0, 1.0));
  else c = max(cur.rgb, prev.rgb);
  fragColor = vec4(c, max(cur.a, prev.a));
}`;

/** "Trails": re-feeds its own previous output, zoomed/rotated/faded. Frame-rate independent. */
class FeedbackEffect implements Effect {
  readonly kind = 'feedback';
  private readonly pass = new FullscreenPass(
    material(FEEDBACK, {
      uPrev: { value: null },
      uAmount: { value: 0.85 },
      uZoom: { value: 0 },
      uRotate: { value: 0 },
      uShift: { value: new THREE.Vector2() },
      uHue: { value: 0 },
      uBlend: { value: 0 },
    }),
  );
  private a: THREE.WebGLRenderTarget | null = null;
  private b: THREE.WebGLRenderTarget | null = null;

  resize(w: number, h: number): void {
    if (this.a && this.a.width === w && this.a.height === h) return;
    this.a?.dispose();
    this.b?.dispose();
    this.a = hdrTarget(w, h);
    this.b = hdrTarget(w, h);
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, p: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget {
    this.resize(out.width, out.height);
    const k = Math.min(4, ctx.dt * 60); // normalise to 60 fps
    const u = this.pass.material.uniforms;
    u.uInput.value = input.texture;
    u.uPrev.value = this.a!.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    u.uAmount.value = Math.pow(n(p.amount, 0.85), k);
    u.uZoom.value = n(p.zoom, 0) * k;
    u.uRotate.value = n(p.rotate, 0) * k;
    (u.uShift.value as THREE.Vector2).set(n(p.shiftX, 0) * k, n(p.shiftY, 0) * k);
    u.uHue.value = n(p.hueDrift, 0) * k;
    u.uBlend.value = p.blend === 'add' ? 1 : p.blend === 'screen' ? 2 : 0;
    this.pass.render(renderer, this.b!);
    const result = this.b!;
    this.b = this.a;
    this.a = result;
    return result;
  }

  compileTargets(): FullscreenPass[] {
    return [this.pass];
  }

  dispose(): void {
    this.pass.dispose();
    this.a?.dispose();
    this.b?.dispose();
  }
}

// ---------------------------------------------------------------------------

const BLOOM_PREFILTER = `${HEADER}
uniform float uThreshold; uniform float uKnee;
void main() {
  vec3 c = texture(uInput, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uKnee + 1e-4;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  fragColor = vec4(min(c * w, vec3(64.0)), 1.0);
}`;

const BLOOM_DOWN = `${HEADER}
uniform vec2 uTexel;
void main() {
  vec2 o = uTexel;
  vec3 s = texture(uInput, vUv).rgb * 4.0;
  s += texture(uInput, vUv + vec2(-o.x, -o.y)).rgb;
  s += texture(uInput, vUv + vec2(o.x, -o.y)).rgb;
  s += texture(uInput, vUv + vec2(-o.x, o.y)).rgb;
  s += texture(uInput, vUv + vec2(o.x, o.y)).rgb;
  fragColor = vec4(s / 8.0, 1.0);
}`;

const BLOOM_UP = `${HEADER}
uniform sampler2D uLow; uniform vec2 uTexel; uniform float uRadius;
void main() {
  vec2 o = uTexel;
  vec3 s = texture(uLow, vUv + vec2(-2.0 * o.x, 0.0)).rgb;
  s += texture(uLow, vUv + vec2(2.0 * o.x, 0.0)).rgb;
  s += texture(uLow, vUv + vec2(0.0, -2.0 * o.y)).rgb;
  s += texture(uLow, vUv + vec2(0.0, 2.0 * o.y)).rgb;
  s += texture(uLow, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  s += texture(uLow, vUv + vec2(o.x, -o.y)).rgb * 2.0;
  s += texture(uLow, vUv + vec2(-o.x, o.y)).rgb * 2.0;
  s += texture(uLow, vUv + vec2(o.x, o.y)).rgb * 2.0;
  fragColor = vec4(texture(uInput, vUv).rgb + s / 12.0 * uRadius, 1.0);
}`;

const BLOOM_COMBINE = `${HEADER}
uniform sampler2D uBloom; uniform float uStrength;
void main() {
  vec4 c = texture(uInput, vUv);
  vec3 b = texture(uBloom, vUv).rgb * uStrength;
  fragColor = vec4(c.rgb + b, clamp(c.a + luma(b), 0.0, 1.0));
}`;

/** Dual-filter bloom over a 6-level pyramid. */
class BloomEffect implements Effect {
  readonly kind = 'bloom';
  private readonly prefilter = new FullscreenPass(material(BLOOM_PREFILTER, { uThreshold: { value: 0.6 }, uKnee: { value: 0.5 } }));
  private readonly down = new FullscreenPass(material(BLOOM_DOWN, { uTexel: { value: new THREE.Vector2() } }));
  private readonly up = new FullscreenPass(material(BLOOM_UP, { uLow: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.6 } }));
  private readonly combine = new FullscreenPass(material(BLOOM_COMBINE, { uBloom: { value: null }, uStrength: { value: 0.8 } }));
  private levels: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private size = { w: 0, h: 0 };

  resize(w: number, h: number): void {
    if (this.size.w === w && this.size.h === h) return;
    this.size = { w, h };
    [...this.levels, ...this.ups].forEach((t) => t.dispose());
    this.levels = [];
    this.ups = [];
    let lw = Math.max(1, w >> 1);
    let lh = Math.max(1, h >> 1);
    for (let i = 0; i < 6; i++) {
      this.levels.push(hdrTarget(lw, lh));
      this.ups.push(hdrTarget(lw, lh));
      lw = Math.max(1, lw >> 1);
      lh = Math.max(1, lh >> 1);
    }
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, p: ParamBag): THREE.WebGLRenderTarget {
    this.resize(out.width, out.height);
    const pu = this.prefilter.material.uniforms;
    pu.uInput.value = input.texture;
    pu.uThreshold.value = n(p.threshold, 0.6);
    pu.uKnee.value = n(p.knee, 0.5);
    this.prefilter.render(renderer, this.levels[0]);
    const du = this.down.material.uniforms;
    for (let i = 1; i < this.levels.length; i++) {
      const src = this.levels[i - 1];
      du.uInput.value = src.texture;
      (du.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.down.render(renderer, this.levels[i]);
    }
    const uu = this.up.material.uniforms;
    uu.uRadius.value = 0.4 + 1.2 * n(p.radius, 0.6);
    let low = this.levels[this.levels.length - 1];
    for (let i = this.levels.length - 2; i >= 0; i--) {
      uu.uInput.value = this.levels[i].texture;
      uu.uLow.value = low.texture;
      (uu.uTexel.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
      this.up.render(renderer, this.ups[i]);
      low = this.ups[i];
    }
    const cu = this.combine.material.uniforms;
    cu.uInput.value = input.texture;
    cu.uBloom.value = low.texture;
    cu.uStrength.value = n(p.strength, 0.8) * 0.25;
    this.combine.render(renderer, out);
    return out;
  }

  compileTargets(): FullscreenPass[] {
    return [this.prefilter, this.down, this.up, this.combine];
  }

  dispose(): void {
    [this.prefilter, this.down, this.up, this.combine].forEach((x) => x.dispose());
    [...this.levels, ...this.ups].forEach((t) => t.dispose());
  }
}

// ---------------------------------------------------------------------------

function palUniform(): THREE.IUniform {
  return { value: Array.from({ length: 5 }, () => new THREE.Vector3()) };
}

function setPal(u: Record<string, THREE.IUniform>, pal: Float32Array): void {
  const v = u.uPal.value as THREE.Vector3[];
  for (let i = 0; i < 5; i++) v[i].set(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]);
}


/** Colour sets of old machines (sRGB), for the retroPalette effect. */
const RETRO_SETS: Record<string, string[]> = {
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  ega: ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#ffff55', '#ffffff'],
  amber: ['#000000', '#3a1f00', '#a65e00', '#ffb000'],
  green: ['#000000', '#003300', '#00a020', '#33ff66'],
  teletext: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'],
  mono: ['#000000', '#ffffff'],
  lcd: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
};

export function createEffect(kind: string): Effect | null {
  switch (kind) {
    case 'feedback':
      return new FeedbackEffect();
    case 'bloom':
      return new BloomEffect();
    case 'mirror':
      return new SimpleEffect('mirror', MIRROR, { uMode: { value: 0 }, uFlip: { value: false } }, (u, p) => {
        u.uMode.value = p.mode === 'vertical' ? 1 : p.mode === 'quad' ? 2 : 0;
        u.uFlip.value = p.flip === true;
      });
    case 'kaleidoscope':
      return new SimpleEffect('kaleidoscope', KALEIDO, { uSegments: { value: 6 }, uAngle: { value: 0 }, uZoom: { value: 1 } }, (u, p, ctx) => {
        u.uSegments.value = Math.max(2, Math.round(n(p.segments, 6)));
        u.uAngle.value = 2 * Math.PI * (n(p.angle, 0) + (n(p.spin, 0.05) * ctx.beat) / ctx.beatsPerBar);
        u.uZoom.value = n(p.zoom, 1);
      });
    case 'rgbSplit':
      return new SimpleEffect('rgbSplit', RGB_SPLIT, { uAmount: { value: 0 }, uAngle: { value: 0 }, uRadial: { value: 0.5 } }, (u, p) => {
        u.uAmount.value = n(p.amount, 0.006);
        u.uAngle.value = n(p.angle, 0) * 2 * Math.PI;
        u.uRadial.value = n(p.radial, 0.5);
      });
    case 'gradientMap':
      return new SimpleEffect('gradientMap', GRADIENT_MAP, { uMix: { value: 1 }, uOffset: { value: 0 }, uContrast: { value: 1 }, uPal: palUniform() }, (u, p, ctx) => {
        u.uMix.value = n(p.mix, 1);
        u.uOffset.value = n(p.offset, 0);
        u.uContrast.value = n(p.contrast, 1);
        setPal(u, ctx.palette);
      });
    case 'grade':
      return new SimpleEffect('grade', GRADE, { uExposure: { value: 0 }, uContrast: { value: 1 }, uSaturation: { value: 1 }, uHue: { value: 0 }, uTemp: { value: 0 } }, (u, p) => {
        u.uExposure.value = n(p.exposure, 0);
        u.uContrast.value = n(p.contrast, 1);
        u.uSaturation.value = n(p.saturation, 1);
        u.uHue.value = (n(p.hue, 0) * Math.PI) / 180;
        u.uTemp.value = n(p.temperature, 0);
      });
    case 'vignette':
      return new SimpleEffect('vignette', VIGNETTE, { uAmount: { value: 0.4 }, uSize: { value: 0.8 }, uSoft: { value: 0.5 } }, (u, p) => {
        u.uAmount.value = n(p.amount, 0.4);
        u.uSize.value = n(p.size, 0.8);
        u.uSoft.value = n(p.softness, 0.5);
      });
    case 'grain':
      return new SimpleEffect('grain', GRAIN, { uAmount: { value: 0.05 }, uSize: { value: 1 }, uSeed: { value: 0 } }, (u, p, ctx) => {
        u.uAmount.value = n(p.amount, 0.05);
        u.uSize.value = n(p.size, 1);
        u.uSeed.value = ctx.frameIndex % 97;
      });
    case 'halftone':
      return new SimpleEffect('halftone', HALFTONE, { uCell: { value: 8 }, uAngle: { value: 0.785 }, uMode: { value: 0 }, uMix: { value: 1 }, uPal: palUniform() }, (u, p, ctx) => {
        u.uCell.value = n(p.cell, 8) * (u.uRes.value as THREE.Vector2).y / 1080;
        u.uAngle.value = (n(p.angle, 45) * Math.PI) / 180;
        u.uMode.value = p.mode === 'ink' ? 1 : p.mode === 'cmyk' ? 2 : 0;
        u.uMix.value = n(p.mix, 1);
        setPal(u, ctx.palette);
      });
    case 'ledScreen':
      return new SimpleEffect('ledScreen', LED_SCREEN, { uCell: { value: 10 }, uGap: { value: 0.12 }, uGlowAmt: { value: 1 } }, (u, p) => {
        u.uCell.value = Math.max(2, n(p.cell, 10) * (u.uRes.value as THREE.Vector2).y / 1080);
        u.uGap.value = n(p.gap, 0.12);
        u.uGlowAmt.value = n(p.glow, 1);
      });
    case 'popGrid':
      return new SimpleEffect('popGrid', POP_GRID, { uTiles: { value: 2 }, uHueStep: { value: 1.2 }, uLevels: { value: 4 }, uPal: palUniform() }, (u, p, ctx) => {
        u.uTiles.value = Math.round(n(p.tiles, 2));
        u.uHueStep.value = n(p.hueStep, 1.2);
        u.uLevels.value = Math.round(n(p.levels, 4));
        setPal(u, ctx.palette);
      });
    case 'crt':
      return new SimpleEffect('crt', CRT, { uCurve: { value: 0.5 }, uScan: { value: 0.6 }, uMask: { value: 0.4 }, uVig: { value: 0.5 } }, (u, p) => {
        u.uCurve.value = n(p.curvature, 0.5);
        u.uScan.value = n(p.scanlines, 0.6);
        u.uMask.value = n(p.mask, 0.4);
        u.uVig.value = n(p.vignette, 0.5);
      });
    case 'retroPalette':
      return new SimpleEffect('retroPalette', RETRO_PALETTE, { uPixel: { value: 4 }, uDither: { value: 1 }, uCols: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uCount: { value: 4 } }, (u, p, ctx) => {
        u.uPixel.value = Math.max(1, n(p.pixel, 4) * (u.uRes.value as THREE.Vector2).y / 1080);
        u.uDither.value = n(p.dither, 1);
        const cols = u.uCols.value as THREE.Vector3[];
        const set = String(p.palette ?? 'cga');
        if (set === 'look') {
          for (let i = 0; i < 5; i++) cols[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
          u.uCount.value = 5;
        } else {
          const hex = RETRO_SETS[set] ?? RETRO_SETS.cga;
          hex.forEach((h, i) => {
            const c = new THREE.Color(h);
            cols[i].set(c.r, c.g, c.b);
          });
          u.uCount.value = hex.length;
        }
      });
    case 'vhs':
      return new SimpleEffect('vhs', VHS, { uAmount: { value: 1 }, uTracking: { value: 0.5 }, uNoise: { value: 0.6 }, uBleed: { value: 1 }, uTime: { value: 0 }, uKick: { value: 0 } }, (u, p, ctx) => {
        u.uAmount.value = n(p.amount, 1);
        u.uTracking.value = n(p.tracking, 0.5);
        u.uNoise.value = n(p.noise, 0.6);
        u.uBleed.value = n(p.bleed, 1);
        u.uTime.value = ctx.time;
        u.uKick.value = ctx.kick;
      });
    default:
      return null;
  }
}
