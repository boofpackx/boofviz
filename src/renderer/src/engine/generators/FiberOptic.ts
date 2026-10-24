import type * as THREE from 'three';
import { StrokeBatch } from '../three/StrokeBatch';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Fiber Optic Lamp: the novelty lamp. Hundreds of fine fibres spring from a
 * point at the bottom in a spray, faint along their length and bright at the
 * tips; the colour wheel in the base turns through the palette a notch on each
 * beat (one colour, two split across the spray, or a rainbow); the spray sways
 * together, breathes wider with the bass, the hats make tips sparkle and the
 * drop spins the wheel right round. A new spray shape every phrase.
 */

const FIBRES = 340;
const SEG = 10;
type Shape = 'dome' | 'fountain' | 'fan';
const SHAPES: Shape[] = ['dome', 'fountain', 'fan'];

export class FiberOptic implements Generator {
  readonly kind = 'fiberOptic';
  private readonly batch = new StrokeBatch(90000);
  private readonly fibre = new Float32Array((SEG + 1) * 2);
  private readonly tip = new Float32Array(4);
  private ctx: GenContext | null = null;
  private step = 0;
  private frac = 0;
  private spin = 0;
  private dropAt = -99;

  update(ctx: GenContext): void {
    this.ctx = ctx;
    const f = ctx.frame;
    // The wheel steps one colour on the beat and spins on the drop. The change
    // sweeps across the spray fibre by fibre (as the filter wheel turns past
    // the light), so the lamp rests on pure palette colours, never a muddy mix.
    const beat = ctx.beat * num(ctx.params.wheel, 1);
    this.step = Math.floor(beat);
    this.frac = beat - this.step;
    if (f.drop) this.dropAt = ctx.beat;
    this.spin = Math.max(0, 1 - (ctx.beat - this.dropAt) / 2) ** 2 * 2;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const ctx = this.ctx;
    const b = this.batch;
    b.setBlend('additive');
    b.begin();
    if (!ctx) {
      b.draw(renderer, target, true);
      return;
    }
    const p = ctx.params;
    const f = ctx.frame;
    const env = ctx.env;
    const W = target.width, H = target.height;
    const px = H / 1080;
    const pal = ctx.palette;
    const bpp = Math.max(4, f.beatsPerPhrase || 16);
    const phrase = Math.floor(ctx.beat / bpp);
    const fixed = String(p.shape ?? 'mixed');
    const shape: Shape = fixed !== 'mixed' && (SHAPES as string[]).includes(fixed) ? (fixed as Shape) : SHAPES[Math.floor(hash01(phrase, 31) * SHAPES.length)];
    const mode = String(p.colours ?? 'split');
    const baseX = W / 2, baseY = H * 0.2;
    const len = H * 0.58 * num(p.size, 1) * Math.min(1, W / H / 1.25);
    const breathe = 1 + env.bass * 0.18 * num(p.react, 1);
    const sway = Math.sin(ctx.time * 0.7) * 0.05 + Math.sin(ctx.time * 1.9) * 0.015;
    const quiet = env.energy < 0.18;
    const colourAt = (u: number): [number, number, number] => {
      const sweep = Math.min(1, Math.max(0, (this.frac - u * 0.45) * 5));
      const w = (this.step + sweep * sweep * (3 - 2 * sweep)) * 0.25 + this.spin + (mode === 'rainbow' ? u : mode === 'split' ? (u < 0.5 ? 0 : 0.5) : 0);
      const x = (((w % 1) + 1) % 1) * 4;
      const i = Math.floor(x), fr = x - i;
      const a = (1 + (i % 4)) * 3, c = (1 + ((i + 1) % 4)) * 3;
      const s = fr * fr * (3 - 2 * fr);
      return [pal[a] + (pal[c] - pal[a]) * s, pal[a + 1] + (pal[c + 1] - pal[a + 1]) * s, pal[a + 2] + (pal[c + 2] - pal[a + 2]) * s];
    };
    // The reflection pool on the table and the lit base.
    const pool = colourAt(0.5);
    this.tip[0] = baseX - W * 0.2;
    this.tip[1] = baseY;
    this.tip[2] = baseX + W * 0.2;
    this.tip[3] = baseY;
    b.stroke(this.tip, 2, H * 0.05, pool[0], pool[1], pool[2], 0.12, 1, false);
    b.dot(baseX, baseY, H * 0.06, pool[0], pool[1], pool[2], 0.5 + env.bass * 0.3);
    for (let i = 0; i < FIBRES; i++) {
      const u = i / (FIBRES - 1);
      const h1 = hash01(i, 3), h2 = hash01(i, 5), h3 = hash01(i, 7);
      // Launch angle and length by shape.
      let ang: number, l: number;
      if (shape === 'dome') {
        ang = (u - 0.5) * Math.PI * 0.95;
        l = len * (0.75 + h1 * 0.3);
      } else if (shape === 'fountain') {
        ang = (u - 0.5) * Math.PI * 0.55;
        l = len * (0.85 + h1 * 0.35);
      } else {
        ang = (u - 0.5) * Math.PI * 1.15;
        l = len * (0.6 + h1 * 0.25);
      }
      ang = ang * breathe + sway * (0.6 + h2 * 0.8) + (h3 - 0.5) * 0.06;
      // A fibre: rises along its launch angle and droops under its own weight.
      const droop = (shape === 'fountain' ? 0.9 : 0.55) * (0.6 + h2 * 0.6);
      for (let k = 0; k <= SEG; k++) {
        const t = k / SEG;
        const s = t * l;
        const x = Math.sin(ang) * s;
        const y = Math.cos(ang) * s - droop * (t * t) * l * Math.abs(Math.sin(ang)) * 0.9;
        this.fibre[k * 2] = baseX + x;
        this.fibre[k * 2 + 1] = baseY + y;
      }
      const c = colourAt(u);
      b.stroke(this.fibre, SEG + 1, Math.max(0.6, 0.9 * px), c[0], c[1], c[2], quiet ? 0.14 : 0.22, 0, false);
      // The tip: bright, sparkling on the hats.
      const tx = this.fibre[SEG * 2], ty = this.fibre[SEG * 2 + 1];
      const sparkle = env.hat > 0.3 && hash01(i, Math.floor(ctx.time * 20)) < 0.08 ? 2.2 : 1;
      const flare = (1 + env.kick * 0.5) * sparkle;
      b.dot(tx, ty, Math.max(5, 16 * px), c[0], c[1], c[2], 0.6 * flare);
      b.dot(tx, ty, Math.max(1.3, 3 * px), c[0] * 0.75 + 0.25, c[1] * 0.75 + 0.25, c[2] * 0.75 + 0.25, Math.min(1, flare), false);
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
