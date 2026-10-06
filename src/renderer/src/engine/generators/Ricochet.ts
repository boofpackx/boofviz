import type * as THREE from 'three';
import { hash01 } from '../modulation';
import { StrokeBatch } from '../three/StrokeBatch';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/** Triangle wave 0..1..0 with period 2. */
function tri(x: number): number {
  const f = ((x % 2) + 2) % 2;
  return f < 1 ? f : 2 - f;
}

/**
 * The bouncing-polygon screensaver: vertices ricochet off the edges, echoed
 * as a fading trail. Positions are a pure function of time (triangle waves),
 * so every window draws the same shapes.
 */
export class Ricochet implements Generator {
  readonly kind = 'ricochet';
  private readonly batch = new StrokeBatch(4096);
  private readonly pts = new Float32Array(64);
  private ctx: GenContext | null = null;

  update(ctx: GenContext): void {
    this.ctx = ctx;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = ctx.params;
    const W = target.width;
    const H = target.height;
    const shapes = Math.round(num(p.shapes, 2));
    const verts = Math.round(num(p.vertices, 4));
    const trail = Math.round(num(p.trail, 6));
    const gap = num(p.gap, 0.08);
    const speed = num(p.speed, 1) * (ctx.frame.bpm / 120);
    const thick = num(p.thickness, 1.6) * (H / 1080);
    const t0 = ctx.time * speed * 0.12;
    const b = this.batch;
    b.setBlend('additive');
    b.begin();
    for (let s = 0; s < shapes; s++) {
      const pal = ctx.palette;
      const ci = ((s * 2 + 2 + Math.floor(ctx.beat / 8)) % 4) + 1;
      for (let k = trail - 1; k >= 0; k--) {
        const t = t0 - k * gap;
        for (let v = 0; v < verts; v++) {
          const sx = 0.6 + 0.9 * hash01(s * 31 + v, 3);
          const sy = 0.6 + 0.9 * hash01(s * 31 + v, 5);
          this.pts[v * 2] = W * (0.03 + 0.94 * tri(t * sx + hash01(s * 7 + v, 9) * 2));
          this.pts[v * 2 + 1] = H * (0.03 + 0.94 * tri(t * sy + hash01(s * 11 + v, 13) * 2));
        }
        const fade = (1 - k / trail) * (1 + 0.6 * ctx.env.kick);
        b.stroke(this.pts, verts, thick, pal[ci * 3] * 1.6, pal[ci * 3 + 1] * 1.6, pal[ci * 3 + 2] * 1.6, fade, 0, true);
        if (k === 0) b.stroke(this.pts, verts, thick * 4, pal[ci * 3], pal[ci * 3 + 1], pal[ci * 3 + 2], 0.3 * num(p.glow, 1), 1, true);
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
