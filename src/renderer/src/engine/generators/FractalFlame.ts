import * as THREE from 'three';
import { FULLSCREEN_VERT, PALETTE_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { hdrTarget } from '../fx/effects';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Fractal Flame: the 1999 distributed fractal screensaver. Silky filaments
 * of light like smoke, thin wisps faint and the dense folds burning white,
 * colour flowing along the structure, morphing slowly from one flame into the
 * next every phrase.
 *
 * Rendered as the chaos game on the GPU: every point runs the flame's
 * random chain of transforms in the vertex shader and lands in an HDR buffer
 * (accumulated over a few frames for the silk); log-density tone mapping turns
 * the counts into light. The bass breathes the transforms, the kick flares the
 * densest folds, the drop shatters the flame into sparks that settle back.
 */

const XF = 3;
const ITER = 22;

/** A flame: three affine transforms (a b c / d e f), their variation weights, probabilities and colours. */
interface Genome {
  aff: number[][];   // [a, b, c, d, e, f] per transform
  vars: number[][];  // weights: linear, sinusoidal, spherical, swirl, horseshoe, polar, handkerchief, heart, disc, spiral, julia, bubble
  prob: number[];
  col: number[];
  sym: number;
  scale: number;
}

const V = (o: Partial<Record<'lin' | 'sin' | 'sph' | 'swl' | 'hrs' | 'pol' | 'hnk' | 'hrt' | 'dsc' | 'spi' | 'jul' | 'bub', number>>): number[] => [
  o.lin ?? 0, o.sin ?? 0, o.sph ?? 0, o.swl ?? 0, o.hrs ?? 0, o.pol ?? 0, o.hnk ?? 0, o.hrt ?? 0, o.dsc ?? 0, o.spi ?? 0, o.jul ?? 0, o.bub ?? 0,
];

const GENOMES: Genome[] = [
  { aff: [[0.56, -0.37, 0.2, 0.37, 0.56, -0.1], [0.5, 0, -0.5, 0, 0.5, 0.3], [-0.3, 0.6, 0.1, -0.6, -0.3, 0.4]], vars: [V({ swl: 0.7, lin: 0.3 }), V({ sph: 0.9, lin: 0.1 }), V({ jul: 1 })], prob: [0.45, 0.3, 0.25], col: [0, 0.5, 1], sym: 1, scale: 0.42 },
  { aff: [[0.7, -0.4, 0, 0.4, 0.7, 0], [0.3, 0, 0.6, 0, 0.3, 0], [0.4, 0.2, -0.3, -0.2, 0.4, 0.2]], vars: [V({ spi: 0.6, lin: 0.4 }), V({ sph: 1 }), V({ sin: 0.8, lin: 0.2 })], prob: [0.6, 0.2, 0.2], col: [0.1, 0.7, 0.9], sym: 3, scale: 0.45 },
  { aff: [[0.5, 0.5, -0.2, -0.5, 0.5, 0.1], [-0.4, 0.3, 0.5, 0.3, 0.4, -0.3], [0.6, 0, 0, 0, -0.6, 0.2]], vars: [V({ jul: 0.8, lin: 0.2 }), V({ hrs: 1 }), V({ swl: 0.5, sin: 0.5 })], prob: [0.4, 0.35, 0.25], col: [0.2, 0.9, 0.55], sym: 2, scale: 1.0 },
  { aff: [[0.6, -0.2, 0.1, 0.2, 0.6, 0], [0.4, 0.3, -0.6, -0.3, 0.4, 0.2], [0.2, -0.6, 0.3, 0.6, 0.2, -0.4]], vars: [V({ hrt: 0.6, lin: 0.4 }), V({ dsc: 1 }), V({ sph: 0.6, swl: 0.4 })], prob: [0.5, 0.25, 0.25], col: [0.05, 0.6, 0.95], sym: 1, scale: 0.38 },
  { aff: [[0.8, 0, 0, 0, 0.8, 0], [0.3, -0.3, 0.7, 0.3, 0.3, 0], [0.25, 0.25, -0.4, -0.25, 0.25, 0.5]], vars: [V({ swl: 1 }), V({ pol: 0.7, lin: 0.3 }), V({ spi: 1 })], prob: [0.55, 0.25, 0.2], col: [0.3, 0.8, 0.0], sym: 5, scale: 0.5 },
  { aff: [[0.55, -0.55, 0, 0.55, 0.55, 0], [0.4, 0, 0.5, 0, 0.4, 0.4], [-0.4, 0, -0.5, 0, 0.4, 0.4]], vars: [V({ hnk: 0.7, lin: 0.3 }), V({ sin: 1 }), V({ sin: 1 })], prob: [0.5, 0.25, 0.25], col: [0.5, 0.0, 1], sym: 1, scale: 1.1 },
  { aff: [[0.3, -0.7, 0.1, 0.7, 0.3, 0], [0.5, 0.1, -0.3, -0.1, 0.5, -0.3], [0.5, -0.1, 0.3, 0.1, 0.5, 0.3]], vars: [V({ sph: 0.5, swl: 0.5 }), V({ lin: 1 }), V({ jul: 0.6, lin: 0.4 })], prob: [0.4, 0.3, 0.3], col: [0.9, 0.3, 0.6], sym: 6, scale: 0.42 },
  { aff: [[0.65, 0.3, 0, -0.3, 0.65, 0.05], [0.35, 0, 0.55, 0, 0.35, -0.25], [0.35, 0, -0.55, 0, 0.35, -0.25]], vars: [V({ bub: 0.6, lin: 0.4 }), V({ hrs: 0.6, sin: 0.4 }), V({ dsc: 0.5, lin: 0.5 })], prob: [0.5, 0.25, 0.25], col: [0.15, 0.55, 0.85], sym: 2, scale: 1.1 },
  { aff: [[0.7, -0.25, 0, 0.25, 0.7, 0], [0.45, 0.45, 0.4, -0.45, 0.45, 0], [0.2, 0, -0.2, 0, 0.2, 0.6]], vars: [V({ spi: 0.5, swl: 0.5 }), V({ jul: 1 }), V({ sph: 1 })], prob: [0.6, 0.25, 0.15], col: [0.75, 0.25, 0.0], sym: 4, scale: 0.46 },
  { aff: [[0.5, -0.5, 0.25, 0.5, 0.5, -0.25], [0.5, 0.5, -0.25, -0.5, 0.5, 0.25], [0.6, 0, 0, 0, 0.6, 0]], vars: [V({ sin: 0.6, swl: 0.4 }), V({ sin: 0.6, swl: 0.4 }), V({ hrt: 0.5, sph: 0.5 })], prob: [0.35, 0.35, 0.3], col: [0, 1, 0.5], sym: 3, scale: 0.4 },
];

const POINT_VERT = /* glsl */ `
precision highp float;
in vec3 position;
// Two flames, A then B; points from uSplit on are drawn with B (a crossfade that never collapses).
uniform float uAff[${XF * 12}];
uniform float uVars[${XF * 24}];
uniform float uCum[${XF * 2}];
uniform float uCol[${XF * 2}];
uniform vec2 uSym2, uScale2;
uniform float uSplit, uAspect, uSeed, uSpin, uShatter, uBreath;
int G;
out float vC;
uint st;
float rnd() {
  st = st * 747796405u + 2891336453u;
  uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
  return float((w >> 22u) ^ w) / 4294967295.0;
}
vec2 vary(vec2 p, int k) {
  float r2 = dot(p, p) + 1e-6, r = sqrt(r2), th = atan(p.x, p.y), ph = atan(p.y, p.x);
  int o = (G * ${XF} + k) * 12;
  vec2 q = vec2(0.0);
  q += uVars[o + 0] * p;
  q += uVars[o + 1] * sin(p);
  q += uVars[o + 2] * p / r2;
  q += uVars[o + 3] * vec2(p.x * sin(r2) - p.y * cos(r2), p.x * cos(r2) + p.y * sin(r2));
  q += uVars[o + 4] * vec2((p.x - p.y) * (p.x + p.y), 2.0 * p.x * p.y) / r;
  q += uVars[o + 5] * vec2(th / 3.14159265, r - 1.0);
  q += uVars[o + 6] * r * vec2(sin(th + r), cos(th - r));
  q += uVars[o + 7] * r * vec2(sin(th * r), -cos(th * r));
  q += uVars[o + 8] * (th / 3.14159265) * vec2(sin(3.14159265 * r), cos(3.14159265 * r));
  q += uVars[o + 9] * vec2(cos(th) + sin(r), sin(th) - cos(r)) / r;
  float jr = sqrt(r), ja = ph * 0.5 + (rnd() < 0.5 ? 0.0 : 3.14159265);
  q += uVars[o + 10] * jr * vec2(cos(ja), sin(ja));
  q += uVars[o + 11] * p * (4.0 / (r2 + 4.0));
  return q;
}
void main() {
  G = float(gl_VertexID) < uSplit ? 0 : 1;
  st = uint(gl_VertexID) * 2654435761u + uint(uSeed);
  vec2 p = vec2(rnd(), rnd()) * 2.0 - 1.0;
  float c = rnd();
  for (int i = 0; i < ${ITER}; i++) {
    float r = rnd();
    int c0 = G * ${XF};
    int k = r < uCum[c0] ? 0 : r < uCum[c0 + 1] ? 1 : 2;
    int o = (c0 + k) * 6;
    vec2 a = vec2(uAff[o] * p.x + uAff[o + 1] * p.y + uAff[o + 2], uAff[o + 3] * p.x + uAff[o + 4] * p.y + uAff[o + 5]) * uBreath;
    p = vary(a, k);
    c = (c + uCol[c0 + k]) * 0.5;
  }
  // Rotational symmetry, the slow spin, and the drop's shatter.
  float sym = G == 0 ? uSym2.x : uSym2.y;
  float m = floor(rnd() * sym);
  float ang = m * 6.2831853 / sym + uSpin;
  p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  p += (vec2(rnd(), rnd()) - 0.5) * uShatter * (1.0 + length(p));
  vC = c;
  if (any(isnan(p)) || dot(p, p) > 400.0) { gl_Position = vec4(9.0, 9.0, 9.0, 1.0); gl_PointSize = 0.0; return; }
  float scale = G == 0 ? uScale2.x : uScale2.y;
  gl_Position = vec4(p.x * scale / uAspect, p.y * scale, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const POINT_FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
in float vC;
out vec4 fragColor;
void main() {
  fragColor = vec4(paletteWrap(vC), 1.0);
}
`;

const DECAY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uPrev;
uniform float uKeep;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(uPrev, vUv) * uKeep; }
`;

const TONE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAcc;
uniform float uExposure, uGamma, uNorm;
in vec2 vUv;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 a = texture(uAcc, vUv);
  float d = a.a * uNorm;
  vec3 c = vec3(0.0);
  if (d > 0.0) {
    // Log-density: faint wisps stay faint, dense folds go towards white.
    // Compressed so dense cores keep their hue and only the very densest go white.
    float L = log(1.0 + d);
    float lum = L / (L + 2.2) * 1.5;
    vec3 hue = a.rgb / max(a.a, 1e-6);
    c = pow(hue * lum * uExposure, vec3(uGamma));
    c += vec3(1.0) * smoothstep(1.1, 1.45, lum) * 0.25 * uExposure;
  }
  c += (hash(vUv * 977.0) - 0.5) * 0.004;
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

export class FractalFlame implements Generator {
  readonly kind = 'fractalFlame';
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.RawShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly decay: FullscreenPass;
  private readonly tone: FullscreenPass;
  private a: THREE.WebGLRenderTarget | null = null;
  private b: THREE.WebGLRenderTarget | null = null;
  private readonly aff = new Float32Array(XF * 12);
  private readonly vars = new Float32Array(XF * 24);
  private readonly cum = new Float32Array(XF * 2);
  private readonly col = new Float32Array(XF * 2);
  private points = 120000;
  private lines = 540;
  private frame = 0;
  private auto = 1;
  /** Share of the points drawn with the outgoing flame. */
  private split = 1;
  private dropAt = -99;
  private spin = 0;
  private readonly pal = Array.from({ length: 5 }, () => new THREE.Vector3());

  constructor() {
    const max = 600000;
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uAff: { value: this.aff },
        uVars: { value: this.vars },
        uCum: { value: this.cum },
        uCol: { value: this.col },
        uSym2: { value: new THREE.Vector2(1, 1) },
        uScale2: { value: new THREE.Vector2(0.45, 0.45) },
        uSplit: { value: 1e9 },
        uAspect: { value: 16 / 9 },
        uSeed: { value: 0 },
        uSpin: { value: 0 },
        uShatter: { value: 0 },
        uBreath: { value: 1 },
        uPal: { value: this.pal },
      },
    });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    const fs = (frag: string, uniforms: Record<string, THREE.IUniform>): FullscreenPass =>
      new FullscreenPass(new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms }));
    this.decay = fs(DECAY_FRAG, { uPrev: { value: null }, uKeep: { value: 0.8 } });
    this.tone = fs(TONE_FRAG, { uAcc: { value: null }, uExposure: { value: 1 }, uGamma: { value: 0.9 }, uNorm: { value: 1 } });
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const u = this.mat.uniforms;
    for (let i = 0; i < 5; i++) this.pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
    // Automatic quality: fewer points when frames run long, back up when there is headroom.
    if (ctx.dt > 1 / 40) this.auto = Math.max(0.12, this.auto * 0.94);
    else if (ctx.dt < 1 / 56) this.auto = Math.min(1, this.auto * 1.02);
    this.points = Math.round(num(p.points, 160000) * this.auto);
    this.lines = Math.round(num(p.lines, 540));
    // The flame for this phrase, morphing into the next over the last part of the phrase.
    const bpp = Math.max(4, f.beatsPerPhrase || 16) * Math.max(1, Math.round(num(p.phrasesPerFlame, 1)));
    const k = Math.floor(ctx.beat / bpp);
    const into = (ctx.beat - k * bpp) / bpp;
    const morph = num(p.morph, 0.5);
    let t = morph > 0 ? Math.max(0, (into - (1 - morph)) / morph) : 0;
    t = t * t * (3 - 2 * t);
    const fixed = Math.round(num(p.flame, -1));
    const pick = (n: number): Genome => GENOMES[fixed >= 0 ? fixed % GENOMES.length : Math.floor(hash01(n, 71) * GENOMES.length)];
    const A = pick(k), B = pick(k + 1);
    // Load both flames; the share of points drawn with B grows through the morph.
    [A, B].forEach((gnm, gi) => {
      const tot = gnm.prob.reduce((sum, x) => sum + x, 0);
      let cum = 0;
      for (let x = 0; x < XF; x++) {
        const o = gi * XF + x;
        for (let j = 0; j < 6; j++) this.aff[o * 6 + j] = gnm.aff[x][j];
        for (let j = 0; j < 12; j++) this.vars[o * 12 + j] = gnm.vars[x][j];
        cum += gnm.prob[x] / tot;
        this.cum[o] = x === XF - 1 ? 1.01 : cum;
        this.col[o] = gnm.col[x];
      }
    });
    (u.uSym2.value as THREE.Vector2).set(A.sym, B.sym);
    (u.uScale2.value as THREE.Vector2).set(A.scale * num(p.zoom, 1), B.scale * num(p.zoom, 1));
    this.split = 1 - t;
    u.uAspect.value = ctx.width / Math.max(1, ctx.height);
    u.uSeed.value = (this.frame++ * 7919) % 1000000;
    this.spin += ctx.dt * 0.05 * num(p.spin, 1) * (f.energyTrend === 'building' ? 2.5 : 1);
    u.uSpin.value = this.spin;
    u.uBreath.value = 1 + ctx.env.bass * 0.05 * num(p.react, 1);
    if (f.drop) this.dropAt = ctx.beat;
    const dd = (ctx.beat - this.dropAt) / ((f.beatsPerBar || 4) * 1);
    u.uShatter.value = dd >= 0 && dd < 1 ? (1 - dd) * 0.6 : 0;
    const tu = this.tone.material.uniforms;
    tu.uExposure.value = num(p.exposure, 1) * (1 + ctx.env.kick * 0.35 * num(p.react, 1)) * (f.silence ? 0.6 : 1);
    this.decay.material.uniforms.uKeep.value = Math.exp(-ctx.dt / Math.max(0.02, num(p.silk, 0.12)));
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const H = Math.max(120, Math.min(target.height, this.lines));
    const W = Math.max(120, Math.round(H * (target.width / Math.max(1, target.height))));
    if (!this.a || this.a.width !== W || this.a.height !== H) {
      this.a?.dispose();
      this.b?.dispose();
      this.a = hdrTarget(W, H);
      this.b = hdrTarget(W, H);
      for (const t of [this.a, this.b]) {
        renderer.setRenderTarget(t);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
      }
    }
    const prev = this.a!, next = this.b!;
    // Keep most of the last frames (silk), then splat this frame's points on top.
    this.decay.material.uniforms.uPrev.value = prev.texture;
    this.decay.render(renderer, next);
    this.geo.setDrawRange(0, this.points);
    this.mat.uniforms.uSplit.value = this.points * this.split;
    renderer.setRenderTarget(next);
    renderer.render(this.scene, this.cam);
    this.a = next;
    this.b = prev;
    // Normalise the density to the buffer size and point count, so it looks the same at any resolution.
    const keep = this.decay.material.uniforms.uKeep.value as number;
    const perPixel = (this.points / (W * H)) / Math.max(0.05, 1 - keep);
    this.tone.material.uniforms.uNorm.value = 2.5 / Math.max(0.01, perPixel);
    this.tone.material.uniforms.uAcc.value = next.texture;
    this.tone.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [{ scene: this.scene, camera: this.cam }, this.decay, this.tone];
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.decay.dispose();
    this.tone.dispose();
    this.a?.dispose();
    this.b?.dispose();
  }
}
