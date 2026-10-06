import type * as THREE from 'three';
import { StrokeBatch } from '../three/StrokeBatch';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

const PTS = 128;
const MAX_LINES = 80;

/**
 * Minimal line work. "joy": stacked spectrum-history ridge lines with hidden-
 * line occlusion (the classic post-punk pulsar-plot sleeve). "horizontal": lines displaced by
 * the waveform. "radial": concentric rings deformed by the spectrum.
 */
export class Lines implements Generator {
  readonly kind = 'lines';
  private readonly batch = new StrokeBatch(MAX_LINES * PTS * 6 + 64);
  private readonly hist = new Float32Array(MAX_LINES * PTS);
  private readonly row = new Float32Array(PTS);
  private readonly pts = new Float32Array((PTS + 1) * 2);
  private head = 0;
  private nextPush = 0;
  private ctx: GenContext | null = null;

  update(ctx: GenContext): void {
    this.ctx = ctx;
    const rate = 12 * num(ctx.params.speed, 1); // rows per second
    const t = ctx.frame.time;
    if (Math.abs(t - this.nextPush) > 2) this.nextPush = t;
    let pushed = 0;
    while (rate > 0 && t >= this.nextPush && pushed < 4) {
      this.push(ctx);
      this.nextPush += 1 / rate;
      pushed++;
    }
  }

  private push(ctx: GenContext): void {
    const fft = ctx.frame.fft;
    const n = fft.length;
    const lo = Math.log(35 / 20) / Math.log(1000);
    const hi = Math.log(9000 / 20) / Math.log(1000);
    for (let k = 0; k < PTS; k++) {
      // Mirror the spectrum so the ridge peaks in the middle (lows centred).
      const x = Math.abs(k / (PTS - 1) - 0.5) * 2;
      const idx = Math.floor((lo + (hi - lo) * x) * n);
      this.row[k] = ctx.frame.silence ? 0 : Math.max(0, fft[Math.min(n - 1, idx)] - 0.25) / 0.75;
    }
    const r = this.head % MAX_LINES;
    this.hist.set(this.row, r * PTS);
    this.head++;
  }

  private histRow(age: number): number {
    return (((this.head - 1 - age) % MAX_LINES) + MAX_LINES) % MAX_LINES;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = ctx.params;
    const W = target.width;
    const H = target.height;
    const count = Math.max(4, Math.min(MAX_LINES, Math.round(num(p.count, 36))));
    const amp = num(p.amplitude, 0.5) * ctx.globals.reactivity;
    const thick = num(p.thickness, 1.5) * (H / 1080);
    const glow = num(p.glow, 0.3);
    const spread = num(p.spread, 0.75);
    const persp = num(p.perspective, 0.3);
    const pal = ctx.palette;
    const ct = num(p.color, 0.85) * 4;
    const ci = Math.min(3, Math.floor(ct));
    const cf = ct - ci;
    const cr = pal[ci * 3] + (pal[ci * 3 + 3] - pal[ci * 3]) * cf;
    const cg = pal[ci * 3 + 1] + (pal[ci * 3 + 4] - pal[ci * 3 + 1]) * cf;
    const cb = pal[ci * 3 + 2] + (pal[ci * 3 + 5] - pal[ci * 3 + 2]) * cf;
    const lift = 1.4 + 1.2 * ctx.env.kick;
    const b = this.batch;
    b.begin();
    const mode = p.mode ?? 'joy';

    if (mode === 'joy') {
      b.setBlend('over');
      const bottom = H * (0.5 - spread * 0.42);
      const top = H * (0.5 + spread * 0.42);
      const gapY = (top - bottom) / count;
      // Back (top, oldest) to front (bottom, newest): fills hide the lines behind.
      for (let li = count - 1; li >= 0; li--) {
        const depth = li / Math.max(1, count - 1);
        const width = W * 0.56 * (1 - persp * depth * 0.45);
        const x0 = W / 2 - width / 2;
        const base = bottom + li * gapY;
        const hr = this.histRow(li) * PTS;
        for (let k = 0; k < PTS; k++) {
          const xn = k / (PTS - 1);
          // Bell window: flat edges, lively centre.
          const w = Math.pow(Math.sin(Math.PI * xn), 3);
          this.pts[k * 2] = x0 + xn * width;
          this.pts[k * 2 + 1] = base + this.hist[hr + k] * w * amp * H * 0.22;
        }
        // Opaque black fill under each ridge hides the lines behind it.
        b.fillToBaseline(this.pts, PTS, base - thick * 2, 0, 0, 0);
        const fade = 1 - depth * 0.55;
        b.stroke(this.pts, PTS, thick, cr * lift * fade, cg * lift * fade, cb * lift * fade, 1, 0, false);
      }
    } else if (mode === 'horizontal') {
      b.setBlend('additive');
      const wave = ctx.frame.waveform;
      for (let li = 0; li < count; li++) {
        const y = H * (0.5 + (li / (count - 1) - 0.5) * spread);
        const off = (li * 37) % 512;
        const hr = this.histRow(li) * PTS;
        for (let k = 0; k < PTS; k++) {
          const xn = k / (PTS - 1);
          const w = Math.sin(Math.PI * xn);
          this.pts[k * 2] = W * (0.04 + 0.92 * xn);
          this.pts[k * 2 + 1] = y + (wave[(off + k * 4) % wave.length] * 0.6 + this.hist[hr + k] * 0.4) * w * amp * H * 0.12;
        }
        const tt = li / count;
        if (glow > 0) b.stroke(this.pts, PTS, thick * 4, cr, cg, cb, 0.25 * glow, 1, false);
        b.stroke(this.pts, PTS, thick, cr * lift * (0.6 + tt * 0.6), cg * lift, cb * lift * (1.2 - tt * 0.4), 1, 0, false);
      }
    } else if (mode === 'flow') {
      // Streamlines of a uniform flow around a moving ball (potential flow past a
      // cylinder): ψ = y·(1 − R²/r²). Each line keeps its ψ, so it bends around the ball.
      b.setBlend('additive');
      const R = H * (0.12 + 0.05 * ctx.env.bass) * (0.6 + amp);
      const t = ctx.time * num(p.speed, 1) * 0.15;
      const bx = W * (0.5 + 0.28 * Math.sin(t * 0.9));
      const by = H * (0.5 + 0.22 * Math.sin(t * 1.3 + 1));
      const pts = PTS;
      for (let li = 0; li < count; li++) {
        const psi = (li / (count - 1) - 0.5) * H * spread * 1.15;
        for (let k = 0; k < pts; k++) {
          const x = (k / (pts - 1)) * W * 1.1 - W * 0.05;
          const dx = x - bx;
          // Solve y·(1 − R²/(dx² + y²)) = ψ for y on the same side as ψ (a few Newton steps).
          let y = psi + Math.sign(psi || 1) * R * 0.5;
          for (let it = 0; it < 6; it++) {
            const r2 = dx * dx + y * y;
            const f = y * (1 - (R * R) / r2) - psi;
            const df = 1 - (R * R) / r2 + (2 * R * R * y * y) / (r2 * r2);
            y -= f / (Math.abs(df) > 1e-3 ? df : 1e-3);
          }
          if (Math.abs(y) < R * 1.01 && Math.sign(y) !== Math.sign(psi || 1)) y = Math.sign(psi || 1) * R * 1.01;
          this.pts[k * 2] = x;
          this.pts[k * 2 + 1] = by + y;
        }
        const tt = li / (count - 1);
        const c0 = Math.min(3, Math.floor(tt * 3) + 1);
        const f = tt * 3 - (c0 - 1);
        const r = pal[c0 * 3] + (pal[Math.min(4, c0 + 1) * 3] - pal[c0 * 3]) * f;
        const g = pal[c0 * 3 + 1] + (pal[Math.min(4, c0 + 1) * 3 + 1] - pal[c0 * 3 + 1]) * f;
        const bl = pal[c0 * 3 + 2] + (pal[Math.min(4, c0 + 1) * 3 + 2] - pal[c0 * 3 + 2]) * f;
        b.stroke(this.pts, pts, thick, r * lift, g * lift, bl * lift, 1, 0, false);
      }
    } else {
      b.setBlend('additive');
      const maxR = H * 0.5 * spread;
      for (let li = 0; li < count; li++) {
        const r0 = maxR * (0.12 + (0.88 * li) / count);
        const hr = this.histRow(li) * PTS;
        for (let k = 0; k < PTS; k++) {
          const a = (k / PTS) * Math.PI * 2;
          // Mirror around the ring so it closes seamlessly.
          const v = this.hist[hr + Math.min(PTS - 1, k < PTS / 2 ? k * 2 : (PTS - 1 - k) * 2)];
          const r = r0 + v * amp * H * 0.05 * (1 + li / count);
          this.pts[k * 2] = W / 2 + Math.cos(a) * r;
          this.pts[k * 2 + 1] = H / 2 + Math.sin(a) * r;
        }
        const fade = 1 - (li / count) * 0.6;
        if (glow > 0) b.stroke(this.pts, PTS, thick * 4, cr, cg, cb, 0.25 * glow * fade, 1, true);
        b.stroke(this.pts, PTS, thick, cr * lift * fade, cg * lift * fade, cb * lift * fade, 1, 0, true);
      }
    }
    b.draw(renderer, target, true);
  }

  compileTargets(): CompileTarget[] {
    return [this.batch.compileTarget];
  }

  dispose(): void {
    this.batch.dispose();
  }
}
