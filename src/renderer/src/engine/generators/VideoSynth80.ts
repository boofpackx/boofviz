import * as THREE from 'three';
import { FULLSCREEN_VERT, PALETTE_GLSL, UTIL_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { hdrTarget } from '../fx/effects';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * An 80s video synthesizer and colourizer. The music's waveform is drawn as
 * a line, a ring or both and fed back into itself through a zoom and a turn,
 * so it leaves tunnels and spirals of its own past; the feedback pumps on the
 * kick and turns with the mids. The glow is then cut into flat bands of the
 * look's palette like the colourizers did, with dark contour lines between
 * the bands, the colours stepping round every beat, and an optional mirror.
 */

const WAVE = 512;

const FB = /* glsl */ `
precision highp float;
${UTIL_GLSL}
uniform sampler2D uPrev, uWave;
uniform float uAspect, uZoom, uRot, uDecay, uAmp, uThick, uShape;
uniform vec2 uShift;
in vec2 vUv;
out vec4 fragColor;
float wave(float x) { return texture(uWave, vec2(fract(x), 0.5)).r; }
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  vec2 q = rot2(uRot) * p / uZoom + uShift;
  q.x /= uAspect;
  float prev = texture(uPrev, q + 0.5).r * uDecay;
  // Outside the old frame there is nothing to feed back.
  if (any(lessThan(q + 0.5, vec2(0.0))) || any(greaterThan(q + 0.5, vec2(1.0)))) prev = 0.0;
  float s = 0.0;
  if (uShape < 0.5 || uShape > 1.5) {
    float y = wave(vUv.x) * uAmp * 0.35;
    s = max(s, smoothstep(uThick, 0.0, abs(p.y - y)));
  }
  if (uShape > 0.5) {
    float a = atan(p.y, p.x) / 6.2831853 + 0.5;
    float r = 0.22 + wave(a) * uAmp * 0.12;
    s = max(s, smoothstep(uThick, 0.0, abs(length(p) - r)));
  }
  fragColor = vec4(vec3(max(prev, s)), 1.0);
}
`;

const OUT = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
uniform sampler2D uBuf;
uniform float uBands, uCycle, uMirror, uKick;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 uv = vUv;
  if (uMirror > 0.5) uv.x = 0.5 + abs(uv.x - 0.5);
  if (uMirror > 1.5) uv.y = 0.5 + abs(uv.y - 0.5);
  float l = texture(uBuf, uv).r;
  float x = l * uBands;
  float band = floor(x);
  float f = x - band;
  vec3 col = uPal[0] * 0.5;
  if (l > 0.06) {
    // Older echoes are dimmer, so the tunnel has depth.
    col = paletteWrap(band / max(uBands, 1.0) * 0.999 + uCycle) * mix(0.3, 1.0, l) * (1.0 + uKick * 0.3);
    // Dark contour lines where one band meets the next.
    float edge = fwidth(x) * 1.2;
    col *= smoothstep(0.0, edge + 0.02, f) * smoothstep(0.0, edge + 0.02, 1.0 - f) * 0.35 + 0.65;
  }
  fragColor = vec4(col, 1.0);
}
`;

export class VideoSynth80 implements Generator {
  readonly kind = 'vsynth80';
  private a: THREE.WebGLRenderTarget | null = null;
  private b: THREE.WebGLRenderTarget | null = null;
  private readonly waveData = new Float32Array(WAVE);
  private readonly waveTex: THREE.DataTexture;
  private readonly fb: FullscreenPass;
  private readonly out: FullscreenPass;
  private lines = 360;
  private phase = 0;

  constructor() {
    this.waveTex = new THREE.DataTexture(this.waveData, WAVE, 1, THREE.RedFormat, THREE.FloatType);
    this.waveTex.minFilter = THREE.NearestFilter;
    this.waveTex.magFilter = THREE.NearestFilter;
    this.waveTex.needsUpdate = true;
    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial =>
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms });
    this.fb = new FullscreenPass(
      mat(FB, {
        uPrev: { value: null },
        uWave: { value: this.waveTex },
        uAspect: { value: 16 / 9 },
        uZoom: { value: 1.02 },
        uRot: { value: 0.01 },
        uDecay: { value: 0.95 },
        uAmp: { value: 1 },
        uThick: { value: 0.01 },
        uShape: { value: 2 },
        uShift: { value: new THREE.Vector2() },
      }),
    );
    this.out = new FullscreenPass(
      mat(OUT, {
        uBuf: { value: null },
        uBands: { value: 6 },
        uCycle: { value: 0 },
        uMirror: { value: 0 },
        uKick: { value: 0 },
        uPal: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
      }),
    );
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const wf = f.waveform;
    // Smooth the waveform a little so the trace reads as a line, not noise.
    for (let k = 0; k < WAVE; k++) {
      const i = Math.floor((k / WAVE) * Math.max(1, wf.length - 3));
      this.waveData[k] = ((wf[i] ?? 0) + (wf[i + 1] ?? 0) + (wf[i + 2] ?? 0)) / 3;
    }
    this.waveTex.needsUpdate = true;
    this.lines = Math.round(num(p.lines, 360));
    const u = this.fb.material.uniforms;
    u.uAspect.value = ctx.width / Math.max(1, ctx.height);
    const react = num(p.react, 1);
    u.uZoom.value = num(p.zoom, 1.02) + ctx.env.kick * 0.04 * react;
    this.phase += ctx.dt * (num(p.turn, 0.6) + ctx.env.mids * 0.8 * react);
    u.uRot.value = Math.sin(this.phase * 0.7) * 0.03 * num(p.turn, 0.6) + num(p.turn, 0.6) * 0.012;
    (u.uShift.value as THREE.Vector2).set(Math.sin(ctx.beat * 0.25) * 0.004 * num(p.drift, 1), Math.cos(ctx.beat * 0.19) * 0.004 * num(p.drift, 1));
    u.uDecay.value = Math.exp(-ctx.dt / Math.max(0.05, num(p.trail, 0.6)));
    u.uAmp.value = num(p.gain, 1.4) * (f.silence ? 0 : 1);
    u.uThick.value = 0.006 * num(p.thickness, 1);
    u.uShape.value = p.shape === 'line' ? 0 : p.shape === 'ring' ? 1 : 2;
    const o = this.out.material.uniforms;
    o.uBands.value = num(p.bands, 6);
    o.uCycle.value = (Math.floor(ctx.beat * num(p.cycle, 1)) / Math.max(1, num(p.bands, 6))) % 1;
    o.uMirror.value = p.mirror === 'quad' ? 2 : p.mirror === 'sides' ? 1 : 0;
    o.uKick.value = ctx.env.kick * react;
    const pal = o.uPal.value as THREE.Vector3[];
    for (let i = 0; i < 5; i++) pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const H = Math.max(90, Math.min(target.height, this.lines));
    const W = Math.max(90, Math.round(H * (target.width / Math.max(1, target.height))));
    if (!this.a || this.a.width !== W || this.a.height !== H) {
      this.a?.dispose();
      this.b?.dispose();
      this.a = hdrTarget(W, H);
      this.b = hdrTarget(W, H);
      for (const t of [this.a, this.b]) {
        renderer.setRenderTarget(t);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, false, false);
      }
    }
    this.fb.material.uniforms.uPrev.value = this.a.texture;
    this.fb.render(renderer, this.b);
    const done = this.b!;
    this.b = this.a;
    this.a = done;
    this.out.material.uniforms.uBuf.value = done.texture;
    this.out.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [this.fb, this.out];
  }

  dispose(): void {
    this.a?.dispose();
    this.b?.dispose();
    this.waveTex.dispose();
    this.fb.dispose();
    this.out.dispose();
  }
}
