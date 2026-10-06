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

// ---------------------------------------------------------------------------

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
    default:
      return null;
  }
}
