import * as THREE from 'three';
import { FULLSCREEN_VERT, UTIL_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { StrokeBatch } from '../three/StrokeBatch';
import { hdrTarget } from '../fx/effects';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Plugin Era: the media-player visualizer plugins of 1999-2004. The last
 * frame is redrawn through a coarse warp mesh (each vertex moved by the
 * preset's zoom, turn, swirl, warp, ripple and drift, so the motion is soft
 * and slightly faceted), fades and drifts in hue, and the music is drawn on
 * top as waves, rings, dots, an XY trace or spikes, feeding the trails. Post
 * switches (video echo, centre darkening, brightening, a beat of inversion)
 * flicker in. A small buffer is stretched to the screen, as it was.
 *
 * Every phrase the next preset blends in over two bars; the drop cuts hard
 * to a new one and inverts the colours for a beat.
 */

const GX = 32, GY = 24;

interface Recipe {
  zoom: number;      // >1 trails stream outward
  zoomBass: number;
  rot: number;       // radians per frame at 60 fps
  swirl: number;
  warp: number;
  warpScale: number;
  ripple: number;
  rippleFreq: number;
  dx: number;
  dy: number;
  decay: number;     // per frame at 60 fps
  hue: number;       // hue drift per frame
  wave: 'line' | 'circle' | 'dots' | 'xy' | 'spikes';
  echo: number;      // 0 off, 1 flip x, 2 flip both, 3 zoomed copy
  darken: boolean;
}

const RECIPES: Recipe[] = [
  { zoom: 1.03, zoomBass: 0.05, rot: 0.004, swirl: 0, warp: 0.4, warpScale: 6, ripple: 0, rippleFreq: 0, dx: 0, dy: 0, decay: 0.965, hue: 0.002, wave: 'circle', echo: 0, darken: false },
  { zoom: 1.01, zoomBass: 0.03, rot: 0.03, swirl: 0.7, warp: 0.2, warpScale: 4, ripple: 0, rippleFreq: 0, dx: 0, dy: 0, decay: 0.975, hue: 0.003, wave: 'line', echo: 0, darken: true },
  { zoom: 1.0, zoomBass: 0.02, rot: 0, swirl: 0, warp: 1.3, warpScale: 5, ripple: 0, rippleFreq: 0, dx: 0, dy: -0.5, decay: 0.97, hue: 0.004, wave: 'dots', echo: 1, darken: false },
  { zoom: 0.995, zoomBass: 0.03, rot: 0.002, swirl: 0, warp: 0.2, warpScale: 3, ripple: 1.2, rippleFreq: 28, dx: 0, dy: 0, decay: 0.97, hue: 0.002, wave: 'circle', echo: 0, darken: false },
  { zoom: 1.02, zoomBass: 0.04, rot: -0.012, swirl: 0, warp: 0.3, warpScale: 4, ripple: 0, rippleFreq: 0, dx: 0, dy: 0, decay: 0.96, hue: 0.006, wave: 'xy', echo: 2, darken: false },
  { zoom: 0.97, zoomBass: -0.03, rot: 0.02, swirl: -0.5, warp: 0.3, warpScale: 5, ripple: 0, rippleFreq: 0, dx: 0, dy: 0, decay: 0.975, hue: 0.003, wave: 'line', echo: 0, darken: true },
  { zoom: 1.0, zoomBass: 0.02, rot: 0.001, swirl: 0, warp: 2.6, warpScale: 3, ripple: 0, rippleFreq: 0, dx: 0, dy: 0, decay: 0.98, hue: 0.01, wave: 'dots', echo: 0, darken: false },
  { zoom: 1.06, zoomBass: 0.06, rot: 0, swirl: 0, warp: 0.1, warpScale: 4, ripple: 0, rippleFreq: 0, dx: 0, dy: 0, decay: 0.9, hue: 0.004, wave: 'spikes', echo: 3, darken: false },
  { zoom: 1.0, zoomBass: 0.02, rot: 0, swirl: 0.2, warp: 0.5, warpScale: 6, ripple: 0, rippleFreq: 0, dx: 0.6, dy: 0, decay: 0.97, hue: 0.003, wave: 'line', echo: 1, darken: false },
  { zoom: 1.015, zoomBass: 0.05, rot: 0.01, swirl: 0.3, warp: 0.6, warpScale: 5, ripple: 0.5, rippleFreq: 14, dx: 0, dy: 0, decay: 0.955, hue: 0.005, wave: 'circle', echo: 2, darken: true },
];

const WARP_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aSrc;
out vec2 vSrc;
void main() {
  vSrc = aSrc;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const WARP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uPrev;
uniform float uDecay, uHue;
in vec2 vSrc;
out vec4 fragColor;
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec3 c = vec3(0.0);
  if (vSrc.x > 0.0 && vSrc.y > 0.0 && vSrc.x < 1.0 && vSrc.y < 1.0) c = texture(uPrev, vSrc).rgb;
  c = max(hueRot(c, uHue), 0.0) * uDecay;
  fragColor = vec4(c, 1.0);
}
`;

const OUT_FRAG = /* glsl */ `
precision highp float;
${UTIL_GLSL}
uniform sampler2D uBuf;
uniform float uEcho, uEchoMix, uDarken, uInvert, uBright, uAspect;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(uBuf, vUv).rgb;
  if (uEcho > 0.5) {
    vec2 q = vUv - 0.5;
    if (uEcho < 1.5) q.x = -q.x;
    else if (uEcho < 2.5) q = -q;
    else q *= 0.5;
    c = max(c, texture(uBuf, q + 0.5).rgb * uEchoMix);
  }
  if (uDarken > 0.5) {
    vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
    c *= smoothstep(0.02, 0.22, length(d));
  }
  c = mix(c, sqrt(max(c, 0.0)), uBright);
  c = mix(c, max(vec3(1.0) - c, 0.0), uInvert);
  fragColor = vec4(c, 1.0);
}
`;

export class PluginEra implements Generator {
  readonly kind = 'pluginEra';
  private a: THREE.WebGLRenderTarget | null = null;
  private b: THREE.WebGLRenderTarget | null = null;
  private readonly geo: THREE.PlaneGeometry;
  private readonly src: Float32Array;
  private readonly warpMat: THREE.RawShaderMaterial;
  private readonly warpScene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly out: FullscreenPass;
  private readonly waves = new StrokeBatch(6000);
  private readonly pts = new Float32Array(1200);
  private lines = 360;
  private aspect = 16 / 9;
  private time = 0;
  private recA = RECIPES[0];
  private recB = RECIPES[1];
  private blend = 1;
  private invertUntil = -1;
  private waveCmds: Array<{ start: number; count: number; rgb: [number, number, number]; i: number; closed: boolean }> = [];
  private ptsN = 0;
  private readonly tmp = new Float32Array(2400);

  constructor() {
    this.geo = new THREE.PlaneGeometry(2, 2, GX, GY);
    this.src = new Float32Array((GX + 1) * (GY + 1) * 2);
    this.geo.setAttribute('aSrc', new THREE.BufferAttribute(this.src, 2).setUsage(THREE.DynamicDrawUsage));
    this.warpMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: WARP_VERT, fragmentShader: WARP_FRAG, depthTest: false, depthWrite: false, uniforms: { uPrev: { value: null }, uDecay: { value: 0.97 }, uHue: { value: 0 } } });
    const mesh = new THREE.Mesh(this.geo, this.warpMat);
    mesh.frustumCulled = false;
    this.warpScene.add(mesh);
    this.out = new FullscreenPass(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: OUT_FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: { uBuf: { value: null }, uEcho: { value: 0 }, uEchoMix: { value: 0.8 }, uDarken: { value: 0 }, uInvert: { value: 0 }, uBright: { value: 0 }, uAspect: { value: 16 / 9 } },
      }),
    );
  }

  private recipe(k: number, ctx: GenContext): Recipe {
    const fixed = Math.round(num(ctx.params.preset, -1));
    if (fixed >= 0) return RECIPES[fixed % RECIPES.length];
    return RECIPES[Math.floor(hash01(k, 61) * RECIPES.length)];
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    this.aspect = ctx.width / Math.max(1, ctx.height);
    this.lines = Math.round(num(p.lines, 360));
    const dtn = Math.min(0.1, ctx.dt) * 60; // frames at 60 fps
    this.time += ctx.dt * num(p.speed, 1);
    // Preset schedule: the next one blends in over the last two bars of each phrase; a drop cuts.
    const bpb = f.beatsPerBar || 4;
    const bpp = Math.max(4, f.beatsPerPhrase || 16) * Math.max(1, Math.round(num(p.phrasesPerPreset, 1)));
    const k = Math.floor(ctx.beat / bpp);
    const into = ctx.beat - k * bpp;
    const blendBeats = Math.min(bpp, bpb * 2 * num(p.blendBars, 1));
    if (f.drop) {
      this.invertUntil = ctx.beat + 1;
      this.recA = this.recipe(k + 101, ctx);
    }
    const cut = this.invertUntil > ctx.beat - 0.001;
    if (!cut) {
      this.recA = this.recipe(k, ctx);
      this.recB = this.recipe(k + 1, ctx);
      this.blend = blendBeats > 0 && into > bpp - blendBeats ? (into - (bpp - blendBeats)) / blendBeats : 0;
      this.blend = this.blend * this.blend * (3 - 2 * this.blend);
    } else this.blend = 0;
    const A = this.recA, B = this.recB, t = this.blend;
    const mix = (x: number, y: number): number => x + (y - x) * t;
    const react = num(p.react, 1);
    const bass = ctx.env.bass * react, mids = ctx.env.mids * react;
    // Per-vertex source positions (the warp mesh).
    const ev = (r: Recipe, x0: number, y0: number): [number, number] => {
      let x = (x0 - 0.5) * this.aspect, y = y0 - 0.5;
      const zoom = Math.pow(r.zoom + r.zoomBass * bass, dtn);
      x /= zoom;
      y /= zoom;
      const rad = Math.hypot(x, y);
      const rot = (r.rot + r.swirl * (0.5 - rad) * 0.04 + ctx.env.snare * 0.01 * react) * dtn;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      [x, y] = [x * cr - y * sr, x * sr + y * cr];
      const w = r.warp * (1 + mids) * 0.006 * dtn;
      x += Math.sin(y * r.warpScale + this.time * 1.3) * w;
      y += Math.cos(x * r.warpScale * 1.2 + this.time * 1.1) * w;
      if (r.ripple) {
        const s = 1 + Math.sin(rad * r.rippleFreq - this.time * 3) * r.ripple * 0.004 * dtn;
        x *= s;
        y *= s;
      }
      x -= r.dx * 0.004 * dtn;
      y -= r.dy * 0.004 * dtn;
      return [x / this.aspect + 0.5, y + 0.5];
    };
    let v = 0;
    for (let j = 0; j <= GY; j++) {
      for (let i = 0; i <= GX; i++) {
        // PlaneGeometry rows run top to bottom.
        const x0 = i / GX, y0 = 1 - j / GY;
        const [ax, ay] = ev(A, x0, y0);
        if (t > 0) {
          const [bx, by] = ev(B, x0, y0);
          this.src[v++] = ax + (bx - ax) * t;
          this.src[v++] = ay + (by - ay) * t;
        } else {
          this.src[v++] = ax;
          this.src[v++] = ay;
        }
      }
    }
    (this.geo.getAttribute('aSrc') as THREE.BufferAttribute).needsUpdate = true;
    const wu = this.warpMat.uniforms;
    wu.uDecay.value = Math.pow(mix(A.decay, B.decay), dtn) * (f.silence ? 0.97 : 1);
    wu.uHue.value = mix(A.hue, B.hue) * dtn * num(p.hueDrift, 1);
    const ou = this.out.material.uniforms;
    const r = t > 0.5 ? B : A;
    ou.uEcho.value = p.echo === false ? 0 : r.echo;
    ou.uDarken.value = r.darken ? 1 : 0;
    ou.uInvert.value = cut && p.invert !== false ? 1 : 0;
    ou.uBright.value = 0.15 + ctx.env.kick * 0.25 * react;
    ou.uAspect.value = this.aspect;
    this.buildWaves(ctx, t > 0.5 ? B.wave : A.wave);
  }

  /** The music drawn on top, in buffer pixels (y up). */
  private buildWaves(ctx: GenContext, kind: Recipe['wave']): void {
    this.waveCmds = [];
    this.ptsN = 0;
    const H = Math.max(90, this.lines), W = Math.round(H * this.aspect);
    const f = ctx.frame;
    const wf = f.waveform;
    const o = (1 + (Math.floor(ctx.beat) % 4)) * 3;
    const rgb: [number, number, number] = [ctx.palette[o] * 2.2, ctx.palette[o + 1] * 2.2, ctx.palette[o + 2] * 2.2];
    const i = 0.6 + ctx.env.kick * 0.8;
    const amp = num(ctx.params.waveSize, 1);
    const push = (xy: number[], closed: boolean, c = rgb, inten = i): void => {
      const count = xy.length / 2;
      if (this.ptsN + count > this.pts.length / 2) return;
      this.pts.set(xy, this.ptsN * 2);
      this.waveCmds.push({ start: this.ptsN, count, rgb: c, i: inten, closed });
      this.ptsN += count;
    };
    const n = 160;
    const sample = (u: number): number => wf[Math.floor(u * (wf.length - 1))] ?? 0;
    if (kind === 'line') {
      const xy: number[] = [];
      for (let k = 0; k < n; k++) xy.push((k / (n - 1)) * W, H * 0.5 + sample(k / n) * H * 0.3 * amp);
      push(xy, false);
    } else if (kind === 'circle') {
      const xy: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, r = H * (0.18 + sample(k / n) * 0.12 * amp);
        xy.push(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
      }
      push(xy, true);
    } else if (kind === 'xy') {
      const L = f.stereo.left, R = f.stereo.right, xy: number[] = [];
      for (let k = 0; k < n; k++) {
        const s = Math.floor((k / n) * (L.length - 1));
        xy.push(W / 2 + ((L[s] ?? 0) - (R[s] ?? 0)) * H * 0.6 * amp, H / 2 + ((L[s] ?? 0) + (R[s] ?? 0)) * H * 0.35 * amp);
      }
      push(xy, false);
    } else if (kind === 'dots') {
      for (let k = 0; k < 32; k++) {
        const v = f.bands32[k] ?? 0;
        const x = ((k + 0.5) / 32) * W, y = H * 0.25 + v * H * 0.5 * amp;
        push([x - 1.5, y, x + 1.5, y], false, rgb, 0.5 + v * 1.5);
      }
    } else {
      for (let k = 0; k < 48; k++) {
        const v = f.bands32[Math.floor((k / 48) * 30)] ?? 0;
        const a = (k / 48) * Math.PI * 2, r0 = H * 0.08, r1 = r0 + v * H * 0.35 * amp;
        push([W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0, W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1], false);
      }
    }
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
    const prev = this.a!, next = this.b!;
    this.warpMat.uniforms.uPrev.value = prev.texture;
    renderer.setRenderTarget(next);
    renderer.render(this.warpScene, this.cam);
    // Waves are drawn at the buffer's size (the coordinates were built for `lines` rows).
    const b = this.waves;
    b.setBlend('additive');
    b.begin();
    const sx = W / Math.round(Math.max(90, this.lines) * this.aspect), sy = H / Math.max(90, this.lines);
    const tmp = this.tmp;
    for (const c of this.waveCmds) {
      for (let k = 0; k < c.count; k++) {
        tmp[k * 2] = this.pts[(c.start + k) * 2] * sx;
        tmp[k * 2 + 1] = this.pts[(c.start + k) * 2 + 1] * sy;
      }
      b.stroke(tmp, c.count, 1.6, c.rgb[0], c.rgb[1], c.rgb[2], c.i, 0, c.closed);
    }
    b.draw(renderer, next, false);
    this.a = next;
    this.b = prev;
    this.out.material.uniforms.uBuf.value = next.texture;
    this.out.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [{ scene: this.warpScene, camera: this.cam }, this.out, this.waves.compileTarget];
  }

  dispose(): void {
    this.a?.dispose();
    this.b?.dispose();
    this.geo.dispose();
    this.warpMat.dispose();
    this.out.dispose();
    this.waves.dispose();
  }
}
