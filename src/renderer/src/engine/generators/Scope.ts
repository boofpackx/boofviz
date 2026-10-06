import type * as THREE from 'three';
import { StrokeBatch } from '../three/StrokeBatch';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

const N = 1024;

function palAt(pal: Float32Array, t: number, out: Float32Array): void {
  const x = Math.min(1, Math.max(0, t)) * 4;
  const i = Math.min(3, Math.floor(x));
  let f = x - i;
  f = f * f * (3 - 2 * f);
  for (let c = 0; c < 3; c++) out[c] = pal[i * 3 + c] + (pal[(i + 1) * 3 + c] - pal[i * 3 + c]) * f;
}

/** Oscilloscope: triggered waveform, stereo vectorscope or polar ring, phosphor glow. */
export class Scope implements Generator {
  readonly kind = 'scope';
  private readonly batch = new StrokeBatch(N * 6 + 16);
  private readonly pts = new Float32Array(N * 2);
  private readonly smooth = new Float32Array(N);
  private readonly rgb = new Float32Array(3);
  private w = 1;
  private h = 1;
  private count = 0;
  private closed = false;
  private thick = 3;
  private glow = 1;
  private bright = 1;

  update(ctx: GenContext): void {
    const p = ctx.params;
    const { frame } = ctx;
    this.w = ctx.width;
    this.h = ctx.height;
    const gain = num(p.gain, 1.2) * (frame.silence ? 0 : 1);
    const H = this.h;
    const W = this.w;
    const mode = p.mode ?? 'wave';
    const k = 1 + Math.round(num(p.smoothing, 0.3) * 8);
    const src = frame.waveform;
    // Moving-average smoothing (box filter of width k).
    let acc = 0;
    for (let i = 0; i < N; i++) {
      acc += src[i];
      if (i >= k) acc -= src[i - k];
      this.smooth[i] = acc / Math.min(i + 1, k);
    }
    this.thick = num(p.thickness, 3) * (H / 1080);
    this.glow = num(p.glow, 1);
    this.bright = 1 + 0.8 * ctx.env.kick;
    palAt(ctx.palette, num(p.color, 0.6), this.rgb);

    if (mode === 'lissajous') {
      const L = frame.stereo.left;
      const R = frame.stereo.right;
      const s = 0.42 * H * gain;
      for (let i = 0; i < N; i++) {
        this.pts[i * 2] = W / 2 + (L[i] - R[i]) * 0.7071 * s;
        this.pts[i * 2 + 1] = H / 2 + (L[i] + R[i]) * 0.7071 * s;
      }
      this.count = N;
      this.closed = false;
    } else if (mode === 'circle') {
      const R0 = num(p.radius, 0.28) * H * (1 + 0.08 * ctx.env.kick);
      const pts = 512;
      for (let i = 0; i < pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const v = this.smooth[i * 2] * gain * 0.18 * H;
        this.pts[i * 2] = W / 2 + Math.cos(a) * (R0 + v);
        this.pts[i * 2 + 1] = H / 2 + Math.sin(a) * (R0 + v);
      }
      this.count = pts;
      this.closed = true;
    } else {
      // Trigger on a rising zero crossing for a stable trace.
      const len = Math.max(64, Math.round(num(p.length, 1) * 640));
      let start = 0;
      for (let i = 1; i < N - len; i++) {
        if (this.smooth[i - 1] < 0 && this.smooth[i] >= 0) {
          start = i;
          break;
        }
      }
      const margin = W * 0.04;
      for (let i = 0; i < len; i++) {
        this.pts[i * 2] = margin + ((W - 2 * margin) * i) / (len - 1);
        this.pts[i * 2 + 1] = H / 2 + this.smooth[start + i] * gain * 0.38 * H;
      }
      this.count = len;
      this.closed = false;
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const b = this.batch;
    const [r, g, bl] = this.rgb;
    b.setBlend('additive');
    b.begin();
    if (this.glow > 0) b.stroke(this.pts, this.count, this.thick * 5, r, g, bl, 0.35 * this.glow * this.bright, 1, this.closed);
    b.stroke(this.pts, this.count, this.thick, r * 1.8 + 0.25, g * 1.8 + 0.25, bl * 1.8 + 0.25, this.bright, 0, this.closed);
    b.draw(renderer, target, true);
  }

  compileTargets(): CompileTarget[] {
    return [this.batch.compileTarget];
  }

  dispose(): void {
    this.batch.dispose();
  }
}
