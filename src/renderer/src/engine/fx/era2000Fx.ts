import * as THREE from 'three';
import type { ParamBag } from '@shared/types/engine';
import { FULLSCREEN_VERT, UTIL_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { hdrTarget, type Effect, type FxContext } from './effects';

/**
 * Screens and cameras of the late 90s and 2000s: the skate-video fisheye,
 * DV tape with its interlaced fields, and the first flat panels. Damage is
 * seeded from the beat, so preview and output agree.
 */

const HEADER = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
uniform vec2 uRes;
in vec2 vUv;
out vec4 fragColor;
${UTIL_GLSL}
`;

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

function mat(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms: { uInput: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, ...uniforms },
    depthTest: false,
    depthWrite: false,
  });
}

// ── Skate fisheye ──────────────────────────────────────────────────────────

const FISHEYE = /* glsl */ `${HEADER}
uniform float uAmount, uHood, uFringe, uCrush;
vec2 warp(vec2 uv, float k) {
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(p);
  // Fisheye: the middle bulges, the edges squeeze (the source radius grows like a tangent).
  float rmax = 0.5 * length(vec2(uRes.x / uRes.y, 1.0));
  float a = clamp(k, 0.01, 1.0) * 1.35 / rmax;
  float t = tan(r * a) / tan(rmax * a) * rmax;
  vec2 q = r > 1e-5 ? p / r * t : p;
  return q / vec2(uRes.x / uRes.y, 1.0) + 0.5;
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(p);
  float k = uAmount;
  // Colour fringing grows towards the edge.
  float fr = uFringe * 0.012 * r * r;
  vec3 c;
  c.r = texture(uInput, warp(vUv, k * (1.0 + fr * 4.0))).r;
  c.g = texture(uInput, warp(vUv, k)).g;
  c.b = texture(uInput, warp(vUv, k * (1.0 - fr * 4.0))).b;
  // The camcorder's crushed colour: more contrast and saturation, highlights clipping.
  float l = luma(c);
  c = mix(vec3(l), c, 1.0 + uCrush * 0.35);
  c = (c - 0.04) * (1.0 + uCrush * 0.25);
  // The lens hood: a soft black circle eating the corners.
  float hood = 1.0 - smoothstep(0.93 * uHood, 1.02 * uHood, r / (0.5 * length(vec2(uRes.x / uRes.y, 1.0))));
  c *= hood;
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

// ── DV interlace ───────────────────────────────────────────────────────────

const DV = /* glsl */ `${HEADER}
uniform sampler2D uPrev;
uniform float uComb, uDrop, uChroma, uSeed;
vec3 toYUV(vec3 c) { return mat3(0.299, -0.147, 0.615, 0.587, -0.289, -0.515, 0.114, 0.436, -0.100) * c; }
vec3 fromYUV(vec3 c) { return mat3(1.0, 1.0, 1.0, 0.0, -0.395, 2.032, 1.140, -0.581, 0.0) * c; }
void main() {
  vec2 px = 1.0 / uRes;
  float line = floor(gl_FragCoord.y);
  // Interlace: odd lines come from the previous field, so anything moving combs.
  vec3 cur = texture(uInput, vUv).rgb;
  vec3 prev = texture(uPrev, vUv).rgb;
  vec3 c = mod(line, 2.0) < 1.0 ? cur : mix(cur, prev, uComb);
  // 4:1:1 colour: the chroma is shared across four pixels.
  vec3 yuv = toYUV(c);
  float x0 = (floor(gl_FragCoord.x / 4.0) * 4.0 + 2.0) * px.x;
  vec3 cc = toYUV(texture(uInput, vec2(x0, vUv.y)).rgb);
  yuv.yz = mix(yuv.yz, cc.yz, uChroma);
  c = fromYUV(yuv);
  // DV dropouts: 8x8 blocks frozen or shifted for a moment.
  vec2 blk = floor(gl_FragCoord.xy / 8.0);
  float h = hash21(blk + uSeed);
  if (h < uDrop * 0.02) c = texture(uPrev, vUv + vec2((hash21(blk) - 0.5) * 0.03, 0.0)).rgb;
  else if (h < uDrop * 0.025) c = vec3(luma(c)) * vec3(0.4, 1.0, 0.6);
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

// ── Early LCD ──────────────────────────────────────────────────────────────

const LCD = /* glsl */ `${HEADER}
uniform sampler2D uPrev;
uniform float uGhost, uGrid, uBlacks, uAngle, uCell;
void main() {
  vec3 c = texture(uInput, vUv).rgb;
  // Slow pixels: the last frame lingers.
  c = mix(c, texture(uPrev, vUv).rgb, uGhost);
  fragColor = vec4(c, 1.0);
}
`;

const LCD_OUT = /* glsl */ `${HEADER}
uniform float uGrid, uBlacks, uAngle, uCell;
void main() {
  vec3 c = texture(uInput, vUv).rgb;
  // The visible pixel grid with its RGB stripes.
  vec2 cell = gl_FragCoord.xy / uCell;
  vec2 f = fract(cell);
  float gap = smoothstep(0.0, 0.12, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.x) * smoothstep(1.0, 0.88, f.y);
  vec3 sub = vec3(step(f.x, 0.36), step(0.33, f.x) * step(f.x, 0.69), step(0.66, f.x));
  c *= mix(vec3(1.0), mix(vec3(0.25), sub * 1.9 + 0.15, 0.6) * gap, uGrid);
  // Washed-out blacks with a cold cast.
  c = c * (1.0 - uBlacks * 0.08) + vec3(0.045, 0.05, 0.065) * uBlacks;
  // Viewing angle: the colours shift and the gamma drifts towards the top of the panel.
  float v = vUv.y;
  c = pow(max(c, 0.0), vec3(1.0 + uAngle * (v - 0.5) * 0.6));
  c = mix(c, c.bgr * 0.9 + c * 0.1, uAngle * smoothstep(0.6, 1.0, v) * 0.25);
  fragColor = vec4(c, 1.0);
}
`;

class HistoryEffect implements Effect {
  protected prev: THREE.WebGLRenderTarget | null = null;
  protected readonly copy = new FullscreenPass(mat(`${HEADER} void main() { fragColor = texture(uInput, vUv); }`, {}));

  constructor(
    readonly kind: string,
    protected readonly pass: FullscreenPass,
    private readonly apply: (u: Record<string, THREE.IUniform>, p: ParamBag, ctx: FxContext) => void,
    private readonly second?: FullscreenPass,
    private readonly applySecond?: (u: Record<string, THREE.IUniform>, p: ParamBag, ctx: FxContext) => void,
  ) {}

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, params: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget {
    if (!this.prev || this.prev.width !== out.width || this.prev.height !== out.height) {
      this.prev?.dispose();
      this.prev = hdrTarget(out.width, out.height);
      this.copy.material.uniforms.uInput.value = input.texture;
      this.copy.render(renderer, this.prev);
    }
    const u = this.pass.material.uniforms;
    u.uInput.value = input.texture;
    u.uPrev.value = this.prev.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    this.apply(u, params, ctx);
    this.pass.render(renderer, out);
    // Keep this frame (the ghosting looks at the shown frame; the fields at the input).
    this.copy.material.uniforms.uInput.value = this.second ? out.texture : input.texture;
    this.copy.render(renderer, this.prev);
    if (this.second && this.applySecond) {
      const s = this.second.material.uniforms;
      s.uInput.value = this.prev.texture;
      (s.uRes.value as THREE.Vector2).set(out.width, out.height);
      this.applySecond(s, params, ctx);
      this.second.render(renderer, out);
    }
    return out;
  }

  compileTargets(): FullscreenPass[] {
    return [this.pass, this.copy, ...(this.second ? [this.second] : [])];
  }

  dispose(): void {
    this.prev?.dispose();
    this.pass.dispose();
    this.copy.dispose();
    this.second?.dispose();
  }
}

class Fisheye implements Effect {
  readonly kind = 'fisheye';
  private readonly pass = new FullscreenPass(mat(FISHEYE, { uAmount: { value: 0.8 }, uHood: { value: 1 }, uFringe: { value: 1 }, uCrush: { value: 1 } }));

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, p: ParamBag): THREE.WebGLRenderTarget {
    const u = this.pass.material.uniforms;
    u.uInput.value = input.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    u.uAmount.value = n(p.amount, 0.8);
    u.uHood.value = n(p.hood, 1);
    u.uFringe.value = n(p.fringe, 1);
    u.uCrush.value = n(p.crush, 1);
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

export function createEra2000Effect(kind: string): Effect | null {
  if (kind === 'fisheye') return new Fisheye();
  if (kind === 'dvInterlace')
    return new HistoryEffect('dvInterlace', new FullscreenPass(mat(DV, { uPrev: { value: null }, uComb: { value: 1 }, uDrop: { value: 0.3 }, uChroma: { value: 0.8 }, uSeed: { value: 0 } })), (u, p, ctx) => {
      u.uComb.value = n(p.combing, 1);
      u.uChroma.value = n(p.chroma, 0.8);
      // Dropouts come in short bursts on the kick, more with the wear setting.
      const burst = ctx.kick > 0.7 ? 1 : 0.15;
      u.uDrop.value = n(p.dropouts, 0.3) * burst;
      u.uSeed.value = Math.floor(ctx.time * 12) * 7.13;
    });
  if (kind === 'earlyLcd')
    return new HistoryEffect(
      'earlyLcd',
      new FullscreenPass(mat(LCD, { uPrev: { value: null }, uGhost: { value: 0.5 }, uGrid: { value: 0.6 }, uBlacks: { value: 1 }, uAngle: { value: 0.5 }, uCell: { value: 4 } })),
      (u, p) => {
        u.uGhost.value = Math.min(0.92, n(p.ghost, 0.55));
      },
      new FullscreenPass(mat(LCD_OUT, { uGrid: { value: 0.6 }, uBlacks: { value: 1 }, uAngle: { value: 0.5 }, uCell: { value: 4 } })),
      (u, p) => {
        u.uGrid.value = n(p.grid, 0.6);
        u.uBlacks.value = n(p.blacks, 1);
        u.uAngle.value = n(p.angle, 0.5);
        u.uCell.value = Math.max(2, n(p.pixel, 4) * ((u.uRes.value as THREE.Vector2).y / 1080));
      },
    );
  return null;
}
