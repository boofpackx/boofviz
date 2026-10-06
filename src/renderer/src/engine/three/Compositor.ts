import * as THREE from 'three';
import type { AudioFrame } from '@shared/types/audio';
import type { GlobalControls, Scene } from '@shared/types/engine';
import { createEffect, hdrTarget, type Effect, type FxContext } from '../fx/effects';
import type { AudioEnv, GenContext, Generator } from '../generators/Generator';
import { createGenerator } from '../generators';
import { alignedBeat, ModulationEngine } from '../modulation';
import { PaletteRuntime } from '../palettes';
import { ScenePlan } from '../scenePlan';
import { FULLSCREEN_VERT } from '../shaders/common';
import { FullscreenPass } from './fullscreen';

const BLEND_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uLayer;
uniform sampler2D uMaskTex;
uniform int uMode;        // 0 normal 1 add 2 screen 3 multiply 4 overlay 5 difference 6 lighten
uniform float uOpacity;
uniform int uMask;        // 0 none, 1 luma, 2 shape
uniform int uShape;       // 0 circle 1 rect 2 ring 3 linear 4 triangle
uniform float uSize, uFeather;
uniform bool uInvert;
uniform vec2 uRes;
in vec2 vUv;
out vec4 fragColor;

vec3 blend(vec3 b, vec3 l) {
  vec3 bc = clamp(b, 0.0, 1.0), lc = clamp(l, 0.0, 1.0);
  if (uMode == 1) return b + l;
  if (uMode == 2) return b + l - bc * lc;
  if (uMode == 3) return b * l;
  if (uMode == 4) return mix(2.0 * b * l, 1.0 - 2.0 * (1.0 - bc) * (1.0 - lc), step(0.5, bc));
  if (uMode == 5) return abs(b - l);
  if (uMode == 6) return max(b, l);
  return l;
}

float maskValue() {
  float m = 1.0;
  if (uMask == 1) {
    vec3 c = texture(uMaskTex, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    m = smoothstep(0.0, max(uFeather, 0.01) + 0.05, l);
  } else if (uMask == 2) {
    vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float f = max(uFeather, 0.002);
    float d;
    if (uShape == 1) { vec2 q = abs(p) - vec2(uSize * 0.5 * uRes.x / uRes.y, uSize * 0.5); d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
    else if (uShape == 2) d = abs(length(p) - uSize * 0.5) - uSize * 0.12;
    else if (uShape == 3) d = (vUv.y - uSize) * 0.5;
    else if (uShape == 4) {
      // Equilateral triangle, apex up, sized by height.
      vec2 q = p + vec2(0.0, uSize * 0.2);
      const float k = 1.7320508;
      float r = uSize * 0.5;
      q.x = abs(q.x) - r;
      q.y = q.y + r / k;
      if (q.x + k * q.y > 0.0) q = vec2(q.x - k * q.y, -k * q.x - q.y) / 2.0;
      q.x -= clamp(q.x, -2.0 * r, 0.0);
      d = -length(q) * sign(q.y);
    }
    else d = length(p) - uSize * 0.5;
    m = 1.0 - smoothstep(-f, f, d);
  }
  return uInvert ? 1.0 - m : m;
}

void main() {
  vec4 b = texture(uBase, vUv);
  vec4 l = texture(uLayer, vUv);
  float a = clamp(l.a, 0.0, 1.0) * uOpacity * maskValue();
  vec3 r;
  if (uMode == 1) r = b.rgb + l.rgb * uOpacity * maskValue();
  else r = mix(b.rgb, blend(b.rgb, l.rgb), a);
  fragColor = vec4(max(r, 0.0), max(b.a, a));
}
`;

const COPY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(uInput, vUv); }
`;

const BLEND_INDEX: Record<string, number> = { normal: 0, add: 1, screen: 2, multiply: 3, overlay: 4, difference: 5, lighten: 6 };
const SHAPE_INDEX: Record<string, number> = { circle: 0, rect: 1, ring: 2, linear: 3, triangle: 4 };

interface LayerRuntime {
  id: string;
  kind: string;
  gen: Generator | null;
  fx: Array<{ type: string; effect: Effect | null }>;
}

/**
 * Renders a Scene: each layer's generator → its FX chain → blended onto the
 * accumulation buffer with opacity and mask. Everything stays in linear HDR;
 * the output pass tonemaps afterwards.
 */
export class Compositor {
  private plan: ScenePlan | null = null;
  /** Layer indices used as luma-mask sources (their output is kept for later layers). */
  private maskRefs = new Set<number>();
  private readonly mods = new ModulationEngine();
  private readonly palette = new PaletteRuntime();
  private runtimes = new Map<string, LayerRuntime>();
  private accA: THREE.WebGLRenderTarget;
  private accB: THREE.WebGLRenderTarget;
  private layerA: THREE.WebGLRenderTarget;
  private layerB: THREE.WebGLRenderTarget;
  private masks = new Map<number, THREE.WebGLRenderTarget>();
  private readonly blend: FullscreenPass;
  private readonly copy: FullscreenPass;
  private trails: Effect | null = null;
  private w = 1;
  private h = 1;
  private frameIndex = 0;
  private speedOffset = 0;
  private lastSpeed = 1;
  private readonly env: AudioEnv = { kick: 0, snare: 0, hat: 0, any: 0, bass: 0, mids: 0, highs: 0, energy: 0, drop: 0 };
  /** Errors from generators that failed to build (shown in the UI, never thrown). */
  readonly errors: string[] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.accA = hdrTarget(1, 1);
    this.accB = hdrTarget(1, 1);
    this.layerA = hdrTarget(1, 1, true);
    this.layerB = hdrTarget(1, 1, true);
    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial =>
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.blend = new FullscreenPass(
      mat(BLEND_FRAG, {
        uBase: { value: null },
        uLayer: { value: null },
        uMaskTex: { value: null },
        uMode: { value: 0 },
        uOpacity: { value: 1 },
        uMask: { value: 0 },
        uShape: { value: 0 },
        uSize: { value: 0.5 },
        uFeather: { value: 0.1 },
        uInvert: { value: false },
        uRes: { value: new THREE.Vector2(1, 1) },
      }),
    );
    this.copy = new FullscreenPass(mat(COPY_FRAG, { uInput: { value: null } }));
  }

  /** Live modulated values for the UI ("layerId|path" → 0..1). */
  get live(): Map<string, number> | null {
    return this.plan?.live ?? null;
  }

  setScene(scene: Scene): void {
    this.plan = new ScenePlan(scene);
    this.palette.setScene(this.plan.scene);
    this.maskRefs = new Set(this.plan.scene.layers.filter((l) => l.enabled && l.mask?.type === 'luma' && l.mask.layer !== undefined).map((l) => l.mask!.layer!));
    this.mods.retain(this.plan.modKeys);
    const next = new Map<string, LayerRuntime>();
    for (const layer of this.plan.scene.layers) {
      let rt = this.runtimes.get(layer.id);
      if (!rt || rt.kind !== layer.source.kind) {
        rt?.gen?.dispose();
        let gen: Generator | null = null;
        try {
          gen = createGenerator(layer.source.kind);
        } catch (err) {
          this.errors.push(String(err));
        }
        rt = { id: layer.id, kind: layer.source.kind, gen, fx: rt?.fx ?? [] };
      }
      // Keep effect instances (and their history, e.g. trails) when the chain is unchanged.
      const fx = layer.fx.map((f, i) => {
        const prev = rt!.fx[i];
        if (prev && prev.type === f.type) return prev;
        prev?.effect?.dispose();
        return { type: f.type, effect: createEffect(f.type) };
      });
      for (let i = layer.fx.length; i < rt.fx.length; i++) rt.fx[i].effect?.dispose();
      rt.fx = fx;
      next.set(layer.id, rt);
    }
    for (const [id, rt] of this.runtimes) {
      if (!next.has(id)) {
        rt.gen?.dispose();
        rt.fx.forEach((f) => f.effect?.dispose());
      }
    }
    this.runtimes = next;
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const t of [this.accA, this.accB, this.layerA, this.layerB, ...this.masks.values()]) t.setSize(w, h);
  }

  private updateEnv(f: AudioFrame, dt: number): void {
    const e = this.env;
    const k = Math.exp(-dt / 0.16);
    e.kick = f.onsets.kick ? 1 : e.kick * k;
    e.snare = f.onsets.snare ? 1 : e.snare * k;
    e.hat = f.onsets.hat ? 1 : e.hat * Math.exp(-dt / 0.08);
    e.any = f.onsets.any ? 1 : e.any * k;
    e.drop = f.drop ? 1 : e.drop * Math.exp(-dt / 3);
    const s = 1 - Math.exp(-dt / 0.06);
    e.bass += ((f.bands.sub + f.bands.bass) * 0.5 - e.bass) * s;
    e.mids += ((f.bands.lowMid + f.bands.mid) * 0.5 - e.mids) * s;
    e.highs += ((f.bands.highMid + f.bands.presence + f.bands.air) / 3 - e.highs) * s;
    e.energy += (f.energy - e.energy) * (1 - Math.exp(-dt / 0.5));
  }

  /** Renders the scene and returns the accumulation target (linear HDR). */
  render(frame: AudioFrame, dt: number, globals: GlobalControls): THREE.WebGLRenderTarget {
    const r = this.renderer;
    this.frameIndex++;
    this.updateEnv(frame, dt);
    const plan = this.plan;

    // Speed multiplier: keep animation time continuous when the multiplier changes.
    const speed = globals.speed;
    if (speed !== this.lastSpeed) {
      this.speedOffset += frame.time * (this.lastSpeed - speed);
      this.lastSpeed = speed;
    }
    const time = frame.time * speed + this.speedOffset;
    const beat = alignedBeat(frame) * speed;

    r.setRenderTarget(this.accA);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    if (!plan) return this.accA;

    plan.resolve(frame, this.mods, globals.reactivity);
    const palette = this.palette.update(frame, dt);
    const fxCtx: FxContext = { palette, dt, time, beat, beatsPerBar: frame.beatsPerBar, kick: this.env.kick, frameIndex: this.frameIndex };
    const maskRefs = this.maskRefs;

    const ctx: GenContext = { frame, env: this.env, dt, time, beat, palette, params: {}, globals, width: this.w, height: this.h };
    plan.layers.forEach((rl, index) => {
      const layer = rl.layer;
      const rt = this.runtimes.get(layer.id);
      if (!layer.enabled || !rt?.gen) return;
      const needed = rl.opacity > 0.001 || maskRefs.has(index);
      if (!needed) return;

      ctx.params = rl.source;
      rt.gen.update(ctx);
      rt.gen.render(r, this.layerA);
      let cur = this.layerA;
      let spare = this.layerB;
      layer.fx.forEach((fx, i) => {
        const effect = rt.fx[i]?.effect;
        if (!fx.enabled || !effect) return;
        const result = effect.render(r, cur, spare, rl.fx[i], fxCtx);
        if (result === spare) {
          spare = cur;
          cur = result;
        } else if (result !== cur) {
          // Effect returned an internal target (e.g. feedback history): copy into the chain.
          this.copy.material.uniforms.uInput.value = result.texture;
          this.copy.render(r, spare);
          const t = cur;
          cur = spare;
          spare = t;
        }
      });

      if (maskRefs.has(index)) {
        let m = this.masks.get(index);
        if (!m) {
          m = hdrTarget(this.w, this.h);
          this.masks.set(index, m);
        }
        this.copy.material.uniforms.uInput.value = cur.texture;
        this.copy.render(r, m);
      }
      if (rl.opacity <= 0.001) return;

      const u = this.blend.material.uniforms;
      u.uBase.value = this.accA.texture;
      u.uLayer.value = cur.texture;
      u.uMode.value = BLEND_INDEX[layer.blend] ?? 0;
      u.uOpacity.value = rl.opacity;
      (u.uRes.value as THREE.Vector2).set(this.w, this.h);
      const mask = layer.mask;
      const maskTex = mask?.type === 'luma' && mask.layer !== undefined && mask.layer < index ? this.masks.get(mask.layer) : undefined;
      u.uMask.value = mask ? (mask.type === 'luma' ? (maskTex ? 1 : 0) : 2) : 0;
      u.uMaskTex.value = maskTex?.texture ?? null;
      u.uShape.value = SHAPE_INDEX[mask?.shape ?? 'circle'] ?? 0;
      u.uSize.value = mask?.size ?? 0.5;
      u.uFeather.value = mask?.feather ?? 0.1;
      u.uInvert.value = mask?.invert ?? false;
      this.blend.render(r, this.accB);
      const t = this.accA;
      this.accA = this.accB;
      this.accB = t;
    });

    // Global trails quick-control: one feedback pass over the whole composite.
    if (globals.trails > 0.001) {
      this.trails ??= createEffect('feedback');
      const res = this.trails!.render(r, this.accA, this.accB, { amount: Math.min(0.97, globals.trails), zoom: 0.004, blend: 'max' }, fxCtx);
      if (res === this.accB) {
        this.accB = this.accA;
        this.accA = res;
      } else return res;
    }
    return this.accA;
  }

  dispose(): void {
    for (const rt of this.runtimes.values()) {
      rt.gen?.dispose();
      rt.fx.forEach((f) => f.effect?.dispose());
    }
    for (const t of [this.accA, this.accB, this.layerA, this.layerB, ...this.masks.values()]) t.dispose();
    this.trails?.dispose();
    this.blend.dispose();
    this.copy.dispose();
  }
}
