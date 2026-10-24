import type * as THREE from 'three';
import { GRID_ROW, GRID_SLOTS } from '@shared/types/audio';
import { StrokeBatch } from '../three/StrokeBatch';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Synesthesia Rail: the 2001 trance rail shooter. Flying through a glowing,
 * translucent wireframe world that changes form every phrase (a grid ocean, a
 * tunnel, a lattice, the void); wireframe targets drift in, thin brackets
 * lock on a beat ahead, and each one is hit exactly on a note of the song with
 * a beam from the reticle and a burst of line fragments. The notes come from
 * the music itself: the last bar's kicks, snares and hats on the 16th-note
 * grid, predicted one bar ahead. The drop bursts everything on screen.
 */

type World = 'ocean' | 'tunnel' | 'lattice' | 'void';
const WORLDS: World[] = ['ocean', 'tunnel', 'lattice', 'void'];
type RGB = [number, number, number];

interface Target { slot: number; row: number; x: number; y: number; z0: number; shape: number; spin: number; hit: boolean }
interface Frag { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; c: RGB }

const SHAPES: number[][][] = [
  // Octahedron, cube, tetrahedron (edges as point pairs).
  (() => {
    const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const e: number[][] = [];
    for (const a of [0, 1]) for (const b of [2, 3, 4, 5]) e.push([...v[a], ...v[b]]);
    for (const [a, b] of [[2, 4], [4, 3], [3, 5], [5, 2]]) e.push([...v[a], ...v[b]]);
    return e;
  })(),
  (() => {
    const e: number[][] = [];
    const c = (i: number): number[] => [i & 1 ? 0.7 : -0.7, i & 2 ? 0.7 : -0.7, i & 4 ? 0.7 : -0.7];
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) e.push([...c(i), ...c(i | bit)]);
    return e;
  })(),
  (() => {
    const v = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((p) => p.map((x) => x * 0.75));
    const e: number[][] = [];
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) e.push([...v[a], ...v[b]]);
    return e;
  })(),
];

export class Rail implements Generator {
  readonly kind = 'rail';
  private readonly batch = new StrokeBatch(90000);
  private readonly seg = new Float32Array(64);
  private ctx: GenContext | null = null;
  private targets: Target[] = [];
  private frags: Frag[] = [];
  private beams: Array<{ x: number; y: number; z: number; life: number; c: RGB }> = [];
  private travel = 0;
  private lastSlot = -1;

  update(ctx: GenContext): void {
    this.ctx = ctx;
    const p = ctx.params;
    const f = ctx.frame;
    const dt = Math.min(0.05, ctx.dt);
    this.travel += dt * num(p.speed, 1) * (4 + ctx.env.energy * 6);
    // Predict the next beat's notes from the bar before, and give each a target.
    const g = f.grid;
    const now = ctx.beat * 4;
    const rows = [GRID_ROW.kick, GRID_ROW.snare, GRID_ROW.hat];
    const density = num(p.density, 1);
    // A jump back in the song (a seek or a new track) starts the prediction over.
    if (now < this.lastSlot - 32) {
      this.lastSlot = -1;
      this.targets = [];
    }
    for (let s = Math.floor(now) + 1; s <= Math.floor(now) + 8; s++) {
      if (s <= this.lastSlot) continue;
      const src = s - 16;
      if (src > g.slot || g.slot - src >= g.valid) continue;
      for (const [ri, row] of rows.entries()) {
        const v = g.data[row * GRID_SLOTS + (((src % GRID_SLOTS) + GRID_SLOTS) % GRID_SLOTS)];
        if (!v) continue;
        if (row === GRID_ROW.hat && hash01(s, 5) > 0.35 * density) continue;
        if (this.targets.length >= 18) continue;
        this.targets.push({ slot: s, row: ri, x: (hash01(s * 3 + ri, 1) - 0.5) * 7, y: (hash01(s * 3 + ri, 2) - 0.5) * 3.6 + 0.4, z0: 10 + hash01(s, 3) * 6, shape: Math.floor(hash01(s, 4) * 3), spin: hash01(s, 6) * 6, hit: false });
      }
      this.lastSlot = s;
    }
    // Hits land on their slot; the drop bursts everything.
    for (const t of this.targets) {
      if (!t.hit && (now >= t.slot || f.drop)) {
        t.hit = true;
        const pos = this.targetPos(t, now);
        const c = this.colour(ctx, t.row + 2);
        for (let k = 0; k < 14; k++) {
          const a = hash01(k + t.slot, 8) * Math.PI * 2, e = hash01(k + t.slot, 9) - 0.5;
          this.frags.push({ x: pos[0], y: pos[1], z: pos[2], vx: Math.cos(a) * 3, vy: e * 4, vz: Math.sin(a) * 3, life: 0.7, c });
        }
        this.beams.push({ x: pos[0], y: pos[1], z: pos[2], life: 0.18, c });
      }
    }
    this.targets = this.targets.filter((t) => !t.hit && now < t.slot + 1);
    for (const fr of this.frags) {
      fr.x += fr.vx * dt;
      fr.y += fr.vy * dt;
      fr.z += fr.vz * dt;
      fr.life -= dt;
    }
    this.frags = this.frags.filter((x) => x.life > 0).slice(-300);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  private colour(ctx: GenContext, stop: number): RGB {
    const o = stop * 3;
    const r = ctx.palette[o], g = ctx.palette[o + 1], b = ctx.palette[o + 2];
    const m = Math.max(r, g, b, 1e-4);
    const k = m < 0.85 ? 0.85 / m : 1;
    return [r * k, g * k, b * k];
  }

  /** A target drifts toward the camera, arriving in range as its note comes. */
  private targetPos(t: Target, now: number): [number, number, number] {
    const ahead = (t.slot - now) / 8; // 1 = two beats away
    return [t.x, t.y, 4 + Math.max(0, ahead) * (t.z0 - 4)];
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const ctx = this.ctx;
    const b = this.batch;
    b.setBlend('additive');
    b.begin();
    if (!ctx) return void b.draw(renderer, target, true);
    const p = ctx.params;
    const f = ctx.frame;
    const W = target.width, H = target.height;
    const px = H / 1080;
    const focal = H * 0.9;
    const roll = Math.sin(ctx.beat * 0.13) * 0.06;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const proj = (x: number, y: number, z: number): [number, number] | null => {
      if (z < 0.25) return null;
      const sx = (x / z) * focal, sy = (y / z) * focal;
      return [W / 2 + sx * cr - sy * sr, H / 2 + sx * sr + sy * cr];
    };
    const line = (pts: number[][], c: RGB, a: number, w = 1.8, glow = true): void => {
      let n = 0;
      const flush = (): void => {
        if (n >= 2) {
          if (glow) b.stroke(this.seg, n, w * 5 * px, c[0], c[1], c[2], a * 0.18, 1, false);
          b.stroke(this.seg, n, w * px, c[0], c[1], c[2], a, 0, false);
        }
        n = 0;
      };
      for (const q of pts) {
        const s = proj(q[0], q[1], q[2]);
        if (!s || n >= 31) {
          flush();
          if (!s) continue;
        }
        this.seg[n * 2] = s[0];
        this.seg[n * 2 + 1] = s[1];
        n++;
      }
      flush();
    };
    const bpp = Math.max(4, f.beatsPerPhrase || 16);
    const phrase = Math.floor(ctx.beat / bpp);
    const fixed = String(p.world ?? 'mixed');
    const world: World = ctx.env.energy < 0.15 ? 'void' : fixed !== 'mixed' && (WORLDS as string[]).includes(fixed) ? (fixed as World) : WORLDS[phrase % WORLDS.length];
    const wc = this.colour(ctx, 1), wc2 = this.colour(ctx, 4);
    const pulse = 0.7 + ctx.env.kick * 0.5;
    const tr = this.travel;
    const far = 30;
    if (world === 'ocean') {
      const step = 1.4;
      const z0 = step - (tr % step);
      for (let z = z0; z < far; z += step) {
        const row: number[][] = [];
        for (let x = -16; x <= 16; x += 1) row.push([x, -1.6 + Math.sin(x * 0.5 + (z + tr) * 0.35 + ctx.time) * 0.35 * (0.5 + ctx.env.bass), z]);
        line(row, wc, pulse * Math.min(1, (far - z) / 10));
      }
      for (let x = -16; x <= 16; x += 2) {
        const col: number[][] = [];
        for (let z = 0.5; z < far; z += 1) col.push([x, -1.6 + Math.sin(x * 0.5 + (z + tr) * 0.35 + ctx.time) * 0.35 * (0.5 + ctx.env.bass), z]);
        line(col, wc, pulse * 0.6);
      }
    } else if (world === 'tunnel') {
      const step = 2;
      const z0 = step - (tr % step);
      const sides = 8;
      for (let z = z0; z < far; z += step) {
        const ring: number[][] = [];
        const rot = (z + tr) * 0.05 + ctx.beat * 0.1;
        for (let k = 0; k <= sides; k++) {
          const a = (k / sides) * Math.PI * 2 + rot;
          ring.push([Math.cos(a) * 3.5, Math.sin(a) * 3.5, z]);
        }
        line(ring, wc, pulse * Math.min(1, (far - z) / 10));
      }
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + ctx.beat * 0.1;
        line([[Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0.5], [Math.cos(a) * 3.5, Math.sin(a) * 3.5, far]], wc, pulse * 0.5);
      }
    } else if (world === 'lattice') {
      const step = 4;
      const z0 = step - (tr % step);
      for (const x of [-6, -2, 2, 6]) for (const y of [-4, 0, 4]) line([[x, y, 0.5], [x, y, far]], wc, pulse * 0.45);
      for (let z = z0; z < far; z += step) {
        for (const y of [-4, 0, 4]) line([[-6, y, z], [6, y, z]], wc, pulse * 0.4 * Math.min(1, (far - z) / 10));
        for (const x of [-6, -2, 2, 6]) line([[x, -4, z], [x, 4, z]], wc, pulse * 0.4 * Math.min(1, (far - z) / 10));
      }
    } else {
      for (let k = 0; k < 120; k++) {
        const z = far - (((hash01(k, 1) * far + tr * 0.6) % far) + far) % far;
        const x = (hash01(k, 2) - 0.5) * 20, y = (hash01(k, 3) - 0.5) * 12;
        line([[x, y, z], [x, y, z + 0.4 + ctx.env.energy]], wc2, 0.5, 1, false);
      }
    }
    // Targets, with brackets closing in during the last beat.
    const now = ctx.beat * 4;
    for (const t of this.targets) {
      const [x, y, z] = this.targetPos(t, now);
      const c = this.colour(ctx, t.row + 2);
      const ang = ctx.time * 1.2 + t.spin;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const s = 0.75;
      for (const e of SHAPES[t.shape]) {
        const rot = (vx: number, vy: number, vz: number): number[] => [x + (vx * ca + vz * sa) * s, y + vy * s, z + (-vx * sa + vz * ca) * s];
        line([rot(e[0], e[1], e[2]), rot(e[3], e[4], e[5])], c, 1.2, 2.4);
      }
      const until = t.slot - now;
      if (until <= 4) {
        const sp = proj(x, y, z);
        if (sp) {
          const r = (0.95 / z) * focal * (1 + until * 0.35);
          const L = r * 0.35;
          for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const cx = sp[0] + dx * r, cy = sp[1] + dy * r;
            this.seg.set([cx - dx * L, cy, cx, cy, cx, cy - dy * L]);
            b.stroke(this.seg, 3, 2.4 * px, c[0], c[1], c[2], 1, 0, false);
          }
        }
      }
    }
    // Beams from the reticle and the fragments of every hit.
    for (const bm of this.beams) {
      const sp = proj(bm.x, bm.y, bm.z);
      if (!sp) continue;
      this.seg.set([W / 2, H * 0.32, sp[0], sp[1]]);
      b.stroke(this.seg, 2, 12 * px, bm.c[0], bm.c[1], bm.c[2], bm.life * 2, 1, false);
      b.stroke(this.seg, 2, 2 * px, 1, 1, 1, bm.life * 5, 0, false);
    }
    for (const fr of this.frags) line([[fr.x, fr.y, fr.z], [fr.x + fr.vx * 0.06, fr.y + fr.vy * 0.06, fr.z + fr.vz * 0.06]], fr.c, fr.life * 1.4, 1.4);
    // The reticle.
    const rc = this.colour(ctx, 4);
    const R = H * 0.025, cx0 = W / 2, cy0 = H * 0.32;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      this.seg.set([cx0 + dx * R * 0.5, cy0 + dy * R * 0.5, cx0 + dx * R * 1.4, cy0 + dy * R * 1.4]);
      b.stroke(this.seg, 2, 1.6 * px, rc[0], rc[1], rc[2], 0.9, 0, false);
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
