import * as THREE from 'three';
import type { AudioFrame } from '@shared/types/audio';
import type { ParamBag, ParamSpec, RenderContext } from '@shared/types/engine';
import { FullscreenPass } from '../three/fullscreen';
import { SPECTRUM_BARS_FRAG, SPECTRUM_BARS_VERT } from '../shaders/spectrumBars';
import type { Generator } from './Generator';

const MAX_BARS = 256;
const F_LO = 28;
const F_HI = 16000;
const SPECTRUM_F_MIN = 20;
const SPECTRUM_F_MAX = 20000;

const PARAMS: ParamSpec[] = [
  { key: 'bars', label: 'Bars', type: 'int', default: 64, min: 8, max: MAX_BARS, step: 1 },
  { key: 'gap', label: 'Gap', type: 'float', default: 0.28, min: 0, max: 0.8 },
  { key: 'height', label: 'Height', type: 'float', default: 0.58, min: 0.1, max: 0.9 },
  { key: 'horizon', label: 'Horizon', type: 'float', default: 0.3, min: 0.05, max: 0.6 },
  { key: 'glow', label: 'Glow', type: 'float', default: 0.6, min: 0, max: 2 },
  { key: 'release', label: 'Fall time', type: 'float', default: 0.14, min: 0.02, max: 1 },
  { key: 'punch', label: 'Kick punch', type: 'float', default: 0.1, min: 0, max: 0.4 },
];

/**
 * Classic spectrum bar EQ: log-frequency bars with fast attack, eased fall,
 * gravity peak caps, kick punch and a beat-locked reflective floor.
 */
export class SpectrumBars implements Generator {
  readonly kind = 'spectrumBars';
  readonly params = PARAMS;
  private p = Object.fromEntries(PARAMS.map((s) => [s.key, s.default as number])) as Record<string, number>;
  private readonly pass: FullscreenPass;
  private readonly data = new Float32Array(MAX_BARS * 4);
  private readonly tex: THREE.DataTexture;
  private readonly heights = new Float32Array(MAX_BARS);
  private readonly targets = new Float32Array(MAX_BARS);
  private readonly peaks = new Float32Array(MAX_BARS);
  private readonly peakHold = new Float32Array(MAX_BARS);
  private readonly peakVel = new Float32Array(MAX_BARS);
  private kick = 0;
  private bass = 0;
  private energy = 0;
  private ceiling = 0.6;

  constructor() {
    this.tex = new THREE.DataTexture(this.data, MAX_BARS, 1, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPECTRUM_BARS_VERT,
      fragmentShader: SPECTRUM_BARS_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uBars: { value: this.tex },
        uCount: { value: 64 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uKick: { value: 0 },
        uBeatPhase: { value: 0 },
        uBass: { value: 0 },
        uEnergy: { value: 0 },
        uGap: { value: 0.28 },
        uHorizon: { value: 0.3 },
        uMaxHeight: { value: 0.58 },
        uGlow: { value: 0.6 },
        uPal: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
      },
    });
    this.pass = new FullscreenPass(material);
  }

  setParams(params: ParamBag): void {
    for (const [k, v] of Object.entries(params)) if (typeof v === 'number') this.p[k] = v;
  }

  setPalette(linear: Float32Array): void {
    const pal = this.pass.material.uniforms.uPal.value as THREE.Vector3[];
    pal.forEach((v, i) => v.set(linear[i * 3], linear[i * 3 + 1], linear[i * 3 + 2]));
  }

  update(frame: AudioFrame, ctx: RenderContext): void {
    const dt = Math.min(ctx.dt, 0.1);
    const count = Math.max(8, Math.min(MAX_BARS, Math.round(this.p.bars)));
    const fft = frame.fft;
    const n = fft.length;
    const reactivity = ctx.globals.reactivity;

    // Adaptive ceiling keeps bars using the full height for quiet and loud material alike.
    let frameMax = 0;
    const raw = this.targets;
    const toIndex = (f: number): number => (Math.log(f / SPECTRUM_F_MIN) / Math.log(SPECTRUM_F_MAX / SPECTRUM_F_MIN)) * n;
    for (let b = 0; b < count; b++) {
      const f0 = F_LO * Math.pow(F_HI / F_LO, b / count);
      const f1 = F_LO * Math.pow(F_HI / F_LO, (b + 1) / count);
      const i0 = Math.max(0, Math.floor(toIndex(f0)));
      const i1 = Math.min(n - 1, Math.max(i0, Math.ceil(toIndex(f1))));
      let sum = 0;
      let mx = 0;
      for (let i = i0; i <= i1; i++) {
        sum += fft[i];
        if (fft[i] > mx) mx = fft[i];
      }
      const v = 0.5 * (sum / (i1 - i0 + 1)) + 0.5 * mx;
      raw[b] = v;
      if (v > frameMax) frameMax = v;
    }
    this.ceiling = frameMax > this.ceiling ? frameMax : this.ceiling + (frameMax - this.ceiling) * (1 - Math.exp(-dt / 4));
    const ceil = Math.max(this.ceiling, 0.25);
    const window = 0.42 / Math.max(0.25, reactivity);

    this.kick = frame.onsets.kick ? 1 : this.kick * Math.exp(-dt / 0.16);
    const punch = 1 + this.p.punch * this.kick;
    const fall = Math.exp(-dt / Math.max(0.02, this.p.release));

    for (let b = 0; b < count; b++) {
      let target = (raw[b] - (ceil - window)) / window;
      target = target < 0 ? 0 : target > 1 ? 1 : target;
      target = Math.pow(target, 1.35) * punch;
      // Fast attack, eased release.
      const h = Math.max(target, this.heights[b] * fall + target * (1 - fall));
      this.heights[b] = frame.silence ? this.heights[b] * fall : h;

      // Peak caps: hold, then fall with gravity.
      if (this.heights[b] >= this.peaks[b]) {
        this.peaks[b] = this.heights[b];
        this.peakHold[b] = 0.22;
        this.peakVel[b] = 0;
      } else if ((this.peakHold[b] -= dt) <= 0) {
        this.peakVel[b] += 4 * dt;
        this.peaks[b] = Math.max(this.heights[b], this.peaks[b] - this.peakVel[b] * dt);
      }
      this.data[b * 4] = this.heights[b];
      this.data[b * 4 + 1] = this.peaks[b];
    }
    for (let b = count; b < MAX_BARS; b++) this.heights[b] = 0;
    this.tex.needsUpdate = true;

    this.bass += ((frame.bands.sub + frame.bands.bass) * 0.5 - this.bass) * (1 - Math.exp(-dt / 0.08));
    this.energy += (frame.energy - this.energy) * (1 - Math.exp(-dt / 0.5));

    const u = this.pass.material.uniforms;
    u.uCount.value = count;
    u.uTime.value = ctx.time;
    u.uKick.value = easeOutCubic(this.kick);
    u.uBeatPhase.value = frame.beatPhase;
    u.uBass.value = this.bass;
    u.uEnergy.value = this.energy;
    u.uGap.value = this.p.gap;
    u.uHorizon.value = this.p.horizon;
    u.uMaxHeight.value = this.p.height;
    u.uGlow.value = this.p.glow;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    (this.pass.material.uniforms.uRes.value as THREE.Vector2).set(target.width, target.height);
    this.pass.render(renderer, target);
  }

  dispose(): void {
    this.pass.dispose();
    this.tex.dispose();
  }
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}
