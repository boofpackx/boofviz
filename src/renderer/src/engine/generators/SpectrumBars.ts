import * as THREE from 'three';
import { SPECTRUM_BARS_FRAG } from '../shaders/spectrumBars';
import { BarAnalyzer } from './barAnalyzer';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const MAX_BARS = 256;

export class SpectrumBars extends ShaderGenerator {
  readonly kind = 'spectrumBars';
  private readonly data: Float32Array;
  private readonly tex: THREE.DataTexture;
  private readonly bars = new BarAnalyzer(MAX_BARS);

  constructor() {
    const data = new Float32Array(MAX_BARS * 4);
    const tex = new THREE.DataTexture(data, MAX_BARS, 1, THREE.RGBAFormat, THREE.FloatType);
    super(SPECTRUM_BARS_FRAG, {
      uBars: { value: tex },
      uCount: { value: 64 },
      uGap: { value: 0.28 },
      uHorizon: { value: 0.3 },
      uMaxHeight: { value: 0.58 },
      uGlow: { value: 0.6 },
      uMirror: { value: 0 },
      uSegments: { value: 0 },
      uRoundness: { value: 1 },
      uColorMode: { value: 0 },
      uCaps: { value: 1 },
      uReflection: { value: 1 },
      uFloor: { value: 1 },
      uBackground: { value: 1 },
    });
    this.data = data;
    this.tex = tex;
    this.tex.needsUpdate = true;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const count = Math.max(8, Math.min(MAX_BARS, Math.round(num(p.bars, 64))));
    const sides = p.mirror === 'sides';
    const analysed = sides ? Math.ceil(count / 2) : count;
    this.bars.update(ctx.frame.fft, analysed, ctx.dt, {
      release: num(p.release, 0.14),
      reactivity: ctx.globals.reactivity,
      silence: ctx.frame.silence,
      punch: num(p.punch, 0.1),
      kick: ctx.env.kick,
    });
    for (let k = 0; k < count; k++) {
      // "sides": lows in the middle, highs toward both edges.
      const src = sides ? Math.abs(k - (count - 1) / 2) * (analysed / (count / 2)) : k;
      const b = Math.min(analysed - 1, Math.floor(src));
      this.data[k * 4] = this.bars.heights[b];
      this.data[k * 4 + 1] = this.bars.peaks[b];
    }
    this.tex.needsUpdate = true;

    const u = this.u;
    u.uCount.value = count;
    u.uGap.value = num(p.gap, 0.28);
    u.uHorizon.value = p.mirror === 'center' ? 0.5 : num(p.horizon, 0.3);
    u.uMaxHeight.value = p.mirror === 'center' ? Math.min(0.48, num(p.height, 0.58)) : num(p.height, 0.58);
    u.uGlow.value = num(p.glow, 0.6);
    u.uMirror.value = p.mirror === 'center' ? 1 : 0;
    u.uSegments.value = num(p.segments, 0);
    u.uRoundness.value = num(p.roundness, 1);
    u.uColorMode.value = p.colorMode === 'level' ? 1 : 0;
    u.uCaps.value = p.caps === false ? 0 : 1;
    u.uReflection.value = num(p.reflection, 1);
    u.uFloor.value = num(p.floor, 1);
    u.uBackground.value = num(p.background, 1);
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
