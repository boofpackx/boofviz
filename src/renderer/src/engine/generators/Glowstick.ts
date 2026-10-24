import type * as THREE from 'three';
import { StrokeBatch } from '../three/StrokeBatch';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Glowstick Rave: late-90s raves in total darkness, lit only by glowsticks.
 * Each dancer swings a mirrored pair, and the eye (and the camera) sees long
 * exposures: loops, figure eights, poi flowers, waves and pendulum swings,
 * every path locked to the beat, fading over a bar. The pattern changes every
 * bar, more dancers join through the phrase, the hats add wrist flicks, and
 * on the drop the sticks are thrown up spinning and caught.
 *
 * Trails are computed, not smeared: each stick's path over the last bar is
 * drawn every frame, so the picture is crisp and the same in every window.
 * Colours: palette stops 2-5 (the classic green, magenta, blue, yellow).
 */

const PATTERNS = ['circles', 'eights', 'flowers', 'waves', 'pendulum', 'antispin'] as const;
type Pattern = (typeof PATTERNS)[number];
const SAMPLES = 260;

export class Glowstick implements Generator {
  readonly kind = 'glowstick';
  private readonly batch = new StrokeBatch(60000);
  private cmds: Array<{ xy: Float32Array; n: number; c: [number, number, number]; a: number; w: number; glow: boolean }> = [];
  private W = 1;
  private H = 1;
  private dropAt = -99;

  /** Tip of a stick (world units, y up, height 2) at beat time t. */
  private tip(pattern: Pattern, t: number, cx: number, cy: number, side: number, R: number, hat: number, seed: number, dropT: number): [number, number] {
    const w = Math.PI * 2;
    let x = 0, y = 0;
    switch (pattern) {
      case 'circles':
        x = Math.cos(w * t * side) * R;
        y = Math.sin(w * t) * R;
        break;
      case 'eights':
        x = Math.sin(w * t * 0.5) * R * 1.2;
        y = Math.sin(w * t) * R * 0.6;
        break;
      case 'flowers': {
        // Poi flowers: a big circle with a small fast one riding on it.
        x = Math.cos(w * t * 0.5) * R + Math.cos(w * t * 2) * R * 0.45;
        y = Math.sin(w * t * 0.5) * R + Math.sin(w * t * 2) * R * 0.45;
        break;
      }
      case 'antispin':
        x = Math.cos(w * t * 0.25) * R - Math.cos(-w * t * 0.75) * R * 0.5;
        y = Math.sin(w * t * 0.25) * R - Math.sin(-w * t * 0.75) * R * 0.5;
        break;
      case 'waves':
        x = Math.sin(w * t * 0.5) * R * 1.6;
        y = Math.sin(w * t * 1.5 + seed) * R * 0.5;
        break;
      default: {
        // Pendulum: hanging on a string, swinging a half circle each beat.
        const a = Math.sin(w * t * 0.5) * 1.3;
        x = Math.sin(a) * R * 1.3;
        y = -Math.cos(a) * R * 1.3 + R * 0.5;
      }
    }
    // Wrist flicks on the hats.
    x += Math.sin(t * 40 + seed) * hat * R * 0.08;
    y += Math.cos(t * 37 + seed) * hat * R * 0.08;
    // The drop: thrown up, spinning, and caught a beat later.
    if (dropT >= 0 && dropT < 1) {
      const up = Math.sin(Math.PI * dropT) * 0.9;
      const spin = dropT * Math.PI * 6;
      const cs = Math.cos(spin), sn = Math.sin(spin);
      const rx = x * cs - y * sn, ry = x * sn + y * cs;
      x = rx;
      y = ry + up;
    }
    return [cx + x * side, cy + y];
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    this.W = ctx.width;
    this.H = ctx.height;
    this.cmds = [];
    const A = this.W / this.H;
    const bpb = f.beatsPerBar || 4;
    const bpp = Math.max(4, f.beatsPerPhrase || 16);
    if (f.drop) this.dropAt = ctx.beat;
    const beat = ctx.beat;
    const phrase = Math.floor(beat / bpp);
    const within = (beat - phrase * bpp) / bpp;
    // Dancers join through the phrase; the breakdown leaves one pair.
    const maxPairs = Math.max(1, Math.round(num(p.pairs, 3)));
    const pairs = ctx.env.energy < 0.18 ? 1 : Math.min(maxPairs, 1 + Math.floor(within * maxPairs + 0.25));
    const trailBeats = num(p.trail, 1) * bpb;
    const spd = num(p.speed, 1);
    const fixed = String(p.pattern ?? 'mixed');
    const R = 0.44 * num(p.size, 1) * (pairs > 2 ? 0.7 : pairs > 1 ? 0.85 : 1) * Math.min(1, A / 1.78);
    for (let d = 0; d < pairs; d++) {
      const cx = pairs === 1 ? 0 : (d / (pairs - 1) - 0.5) * A * 0.95;
      const cy = -0.05 + Math.sin(d * 2.1) * 0.1;
      for (const side of [-1, 1]) {
        const k = d * 2 + (side > 0 ? 1 : 0);
        const ci = 1 + ((k + phrase) % 4);
        const o = ci * 3;
        const c: [number, number, number] = [ctx.palette[o], ctx.palette[o + 1], ctx.palette[o + 2]];
        const seed = hash01(k, 3) * 6.28;
        const handX = cx + side * 0.22;
        // Sample the trail backwards over the last bar.
        const n = SAMPLES;
        const xy = new Float32Array(n * 2);
        for (let s = 0; s < n; s++) {
          const tb = beat - (1 - s / (n - 1)) * trailBeats;
          const b = Math.floor(tb / bpb);
          const patOf = (bb: number): Pattern => (fixed !== 'mixed' && (PATTERNS as readonly string[]).includes(fixed) ? (fixed as Pattern) : PATTERNS[Math.floor(hash01(bb * 7 + d, 21) * PATTERNS.length)]);
          const hat = s === n - 1 ? ctx.env.hat : 0;
          const dropT = (tb - this.dropAt) / 1.2;
          let [x, y] = this.tip(patOf(b), tb * spd, handX, cy, side, R, hat, seed, dropT);
          // Ease from the last bar's pattern into this one over the first beat, so trails never jump.
          const into = tb - b * bpb;
          if (into < 1 && patOf(b - 1) !== patOf(b)) {
            const [px0, py0] = this.tip(patOf(b - 1), tb * spd, handX, cy, side, R, hat, seed, dropT);
            const e = into * into * (3 - 2 * into);
            x = px0 + (x - px0) * e;
            y = py0 + (y - py0) * e;
          }
          xy[s * 2] = this.W / 2 + x * this.H * 0.5;
          xy[s * 2 + 1] = this.H / 2 + y * this.H * 0.5;
        }
        // Fade along the trail in chunks: older is dimmer.
        const chunks = 6;
        const per = Math.floor(n / chunks);
        const flare = 1 + ctx.env.kick * 0.6;
        for (let ch = 0; ch < chunks; ch++) {
          const a0 = ch * per, a1 = Math.min(n - 1, (ch + 1) * per + 1);
          const seg = xy.slice(a0 * 2, (a1 + 1) * 2);
          const fade = Math.pow((ch + 1) / chunks, 1.6);
          this.cmds.push({ xy: seg, n: a1 - a0 + 1, c, a: 0.32 * fade * flare, w: 36, glow: true });
          this.cmds.push({ xy: seg, n: a1 - a0 + 1, c: [c[0] * 0.6 + 0.4 * fade, c[1] * 0.6 + 0.4 * fade, c[2] * 0.6 + 0.4 * fade], a: 0.95 * fade, w: 5.5, glow: false });
        }
        // The stick itself, bright, along the direction of travel.
        const lx = xy[(n - 1) * 2], ly = xy[(n - 1) * 2 + 1], px = xy[(n - 4) * 2], py = xy[(n - 4) * 2 + 1];
        const dl = Math.hypot(lx - px, ly - py) || 1;
        const L = this.H * 0.035;
        const stick = new Float32Array([lx - ((lx - px) / dl) * L, ly - ((ly - py) / dl) * L, lx, ly]);
        this.cmds.push({ xy: stick, n: 2, c, a: 0.7 * flare, w: 44, glow: true });
        this.cmds.push({ xy: stick, n: 2, c: [1, 1, 1], a: 1, w: 7, glow: false });
      }
      // The haze around each dancer, lit by their sticks.
      const hx = this.W / 2 + cx * this.H * 0.5, hy = this.H / 2 + cy * this.H * 0.5;
      const o = (1 + ((d * 2 + phrase) % 4)) * 3;
      this.cmds.push({ xy: new Float32Array([hx, hy]), n: 1, c: [ctx.palette[o], ctx.palette[o + 1], ctx.palette[o + 2]], a: 0.05 * num(p.haze, 1) * (1 + ctx.env.bass), w: 380, glow: true });
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const b = this.batch;
    b.setBlend('additive');
    b.begin();
    const k = target.height / Math.max(1, this.H);
    for (const c of this.cmds) {
      const xy = c.xy;
      if (k !== 1) for (let i = 0; i < xy.length; i++) xy[i] *= k;
      // A single point is a round glow.
      if (c.n === 1) b.dot(xy[0], xy[1], c.w * k * (this.H / 1080), c.c[0], c.c[1], c.c[2], c.a);
      else b.stroke(xy, c.n, c.w * k * (this.H / 1080), c.c[0], c.c[1], c.c[2], c.a, c.glow ? 1 : 0, false);
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
