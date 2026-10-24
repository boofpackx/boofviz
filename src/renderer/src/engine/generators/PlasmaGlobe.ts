import * as THREE from 'three';
import { FULLSCREEN_VERT, PALETTE_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { StrokeBatch } from '../three/StrokeBatch';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Plasma Globe: the novelty lamp. A dark glass sphere with a bright core,
 * violet lightning tendrils crawling from the core to the glass, wriggling,
 * forking near the glass, a hot spot where each one lands. It is 3D: tendrils
 * reaching the front of the sphere land inside the disc. On every kick the
 * tendrils gather to one point as if a fingertip touched the glass, letting go
 * over a beat; the drop makes the whole globe crackle.
 *
 * Colours: palette stop 2 the tendrils, 3 the core, 4 the hot spots.
 */

const GLASS_FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
uniform vec2 uRes;
uniform float uR, uCore, uTouchA, uTouch;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(p) / uR;
  vec3 c = vec3(0.0);
  if (r < 1.0) {
    // Faint gas glow inside, the glass edge brighter.
    c += uPal[1] * 0.06 * (1.0 - r * r);
    c += uPal[2] * 0.05 * smoothstep(0.85, 1.0, r);
  }
  // The core: a bright ball with a soft halo.
  float cr = length(p) / (uR * 0.12);
  c += mix(uPal[3], vec3(1.0), 0.5) * (smoothstep(1.0, 0.7, cr) * 1.6 + exp(-cr * cr * 0.6) * 0.6) * uCore;
  // The rim, and a window reflection on the glass.
  c += vec3(0.6, 0.6, 0.7) * 0.18 * smoothstep(0.035, 0.0, abs(r - 1.0));
  vec2 g = p / uR - vec2(-0.42, 0.5);
  c += vec3(0.8) * 0.12 * smoothstep(0.18, 0.0, length(g * vec2(1.0, 2.2)));
  // A fingertip glow where the tendrils gather.
  vec2 tp = vec2(cos(uTouchA), sin(uTouchA)) * uR;
  c += uPal[4] * uTouch * 0.8 * exp(-dot(p - tp, p - tp) / (uR * uR * 0.004));
  fragColor = vec4(c, 1.0);
}
`;

interface Tendril { th: number; ph: number; seed: number }

export class PlasmaGlobe implements Generator {
  readonly kind = 'plasmaGlobe';
  private readonly glass: FullscreenPass;
  private readonly batch = new StrokeBatch(80000);
  private readonly pal = Array.from({ length: 5 }, () => new THREE.Vector3());
  private cmds: Array<{ xy: Float32Array; n: number; c: [number, number, number]; a: number; w: number; glow: boolean; dot?: boolean }> = [];
  private tendrils: Tendril[] = [];
  private W = 1;
  private H = 1;
  private touch = 0;
  private touchA = 0;
  private dropAt = -99;

  constructor() {
    this.glass = new FullscreenPass(
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: GLASS_FRAG, depthTest: false, depthWrite: false, uniforms: { uRes: { value: new THREE.Vector2(16, 9) }, uR: { value: 0.42 }, uCore: { value: 1 }, uTouchA: { value: 0 }, uTouch: { value: 0 }, uPal: { value: this.pal } } }),
    );
  }

  /** Smooth 1-D noise. */
  private n1(x: number, seed: number): number {
    const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
    return (hash01(i, seed) * (1 - s) + hash01(i + 1, seed) * s) * 2 - 1;
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    this.W = ctx.width;
    this.H = ctx.height;
    this.cmds = [];
    for (let i = 0; i < 5; i++) this.pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
    // The glass fits the width on tall screens.
    const R = 0.42 * num(p.size, 1) * Math.min(1, ctx.width / ctx.height / 0.95);
    const bpb = f.beatsPerBar || 4;
    const t = ctx.time * num(p.speed, 1);
    // Tendrils: more in the busy parts, few in the breakdown.
    const count = Math.round(num(p.tendrils, 11) * (ctx.env.energy < 0.18 ? 0.45 : 1));
    while (this.tendrils.length < count) this.tendrils.push({ th: hash01(this.tendrils.length, 1) * Math.PI * 2, ph: Math.acos(hash01(this.tendrils.length, 2) * 2 - 1), seed: this.tendrils.length * 17 + 3 });
    this.tendrils.length = count;
    // The fingertip: on each kick the tendrils gather at a point that moves every bar.
    if (f.onsets.kick) this.touch = 1;
    this.touch = Math.max(0, this.touch - ctx.dt * (f.bpm || 120) / 60 * 1.2);
    this.touchA = (Math.floor(ctx.beat / bpb) * 2.39996) % (Math.PI * 2) - Math.PI * 0.5;
    if (f.drop) this.dropAt = ctx.beat;
    const crackle = Math.max(0, 1 - (ctx.beat - this.dropAt) / bpb);
    const gu = this.glass.material.uniforms;
    gu.uR.value = R;
    gu.uCore.value = 0.8 + ctx.env.bass * 0.6 + crackle * 0.5;
    gu.uTouchA.value = this.touchA;
    gu.uTouch.value = this.touch * num(p.touch, 1);
    // The glass radius is R screen heights (as in the glass shader).
    const cx = this.W / 2, cy = this.H / 2, S = this.H;
    const col = (i: number, k = 0): [number, number, number] => [ctx.palette[i * 3] * (1 + k) + k, ctx.palette[i * 3 + 1] * (1 + k) + k, ctx.palette[i * 3 + 2] * (1 + k) + k];
    const tend = col(2), hot = col(4, 0.3), white = col(2, 1.2);
    const touchStr = this.touch * num(p.touch, 1);
    for (const td of this.tendrils) {
      // The landing point wanders over the sphere; the kick pulls it to the fingertip.
      const th = td.th + this.n1(t * 0.25, td.seed) * 1.6;
      const ph = td.ph + this.n1(t * 0.21, td.seed + 1) * 0.9;
      let ex = Math.sin(ph) * Math.cos(th), ey = Math.cos(ph), ez = Math.sin(ph) * Math.sin(th);
      const tx = Math.cos(this.touchA), ty = Math.sin(this.touchA);
      ex += (tx - ex) * touchStr * 0.9;
      ey += (ty - ey) * touchStr * 0.9;
      ez += (0 - ez) * touchStr * 0.9;
      const el = Math.hypot(ex, ey, ez) || 1;
      ex /= el;
      ey /= el;
      ez /= el;
      const segs = 24;
      const xy = new Float32Array((segs + 1) * 2);
      const pts3: number[][] = [];
      for (let k = 0; k <= segs; k++) {
        const u = k / segs;
        // Wriggle: two octaves of noise across the tendril, strongest in the middle.
        const amp = Math.sin(Math.PI * u) * 0.18 * (1 + crackle);
        const wx = this.n1(u * 5 + t * 3, td.seed + 5) * amp + this.n1(u * 13 + t * 9, td.seed + 6) * amp * 0.35;
        const wy = this.n1(u * 5 + t * 3.3, td.seed + 7) * amp + this.n1(u * 13 + t * 8, td.seed + 8) * amp * 0.35;
        const rr = 0.12 + u * 0.88;
        const x = ex * rr + wx, y = ey * rr + wy, z = ez * rr;
        pts3.push([x, y, z]);
        xy[k * 2] = cx + x * R * S;
        xy[k * 2 + 1] = cy + y * R * S;
      }
      const flick = 0.75 + 0.25 * Math.sin(t * 40 + td.seed) + ctx.env.hat * 0.3;
      // Tendrils at the back are dimmer.
      const depth = 0.55 + 0.45 * (1 - (ez + 1) / 2);
      const thick = 1 + ctx.env.bass * 0.6 + crackle;
      this.cmds.push({ xy, n: segs + 1, c: tend, a: 0.35 * flick * depth, w: 16 * thick, glow: true });
      this.cmds.push({ xy, n: segs + 1, c: white, a: 0.9 * flick * depth, w: 2.2 * thick, glow: false });
      // Forks near the glass (more when it crackles).
      const forks = 1 + Math.floor(crackle * 3) + (hash01(td.seed, Math.floor(t * 6)) < 0.4 ? 1 : 0);
      for (let fk = 0; fk < forks; fk++) {
        const at = 16 + Math.floor(hash01(td.seed + fk, 9) * 6);
        const base = pts3[at];
        const fxy: number[] = [cx + base[0] * R * S, cy + base[1] * R * S];
        let bx = base[0], by = base[1];
        const dir = (hash01(td.seed + fk, Math.floor(t * 4)) - 0.5) * 0.9;
        for (let k = 1; k <= 5; k++) {
          bx += (ex * 0.05) + Math.cos(dir + k) * 0.02;
          by += (ey * 0.05) + Math.sin(dir + k) * 0.02;
          const l = Math.hypot(bx, by);
          if (l > 0.98) {
            bx *= 0.98 / l;
            by *= 0.98 / l;
          }
          fxy.push(cx + bx * R * S, cy + by * R * S);
        }
        this.cmds.push({ xy: new Float32Array(fxy), n: fxy.length / 2, c: tend, a: 0.5 * flick * depth, w: 1.4 * thick, glow: false });
      }
      // The hot spot where it lands on the glass.
      const lx = xy[segs * 2], ly = xy[segs * 2 + 1];
      this.cmds.push({ xy: new Float32Array([lx, ly]), n: 1, c: hot, a: 0.7 * flick, w: 26 * thick, glow: true, dot: true });
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    (this.glass.material.uniforms.uRes.value as THREE.Vector2).set(target.width, target.height);
    this.glass.render(renderer, target);
    const b = this.batch;
    b.setBlend('additive');
    b.begin();
    const k = target.height / Math.max(1, this.H);
    const scale = this.H / 1080;
    for (const c of this.cmds) {
      if (k !== 1) for (let i = 0; i < c.xy.length; i++) c.xy[i] *= k;
      if (c.dot) b.dot(c.xy[0], c.xy[1], Math.max(2, c.w * scale * k), c.c[0], c.c[1], c.c[2], c.a);
      else b.stroke(c.xy, c.n, Math.max(0.6, c.w * scale * k), c.c[0], c.c[1], c.c[2], c.a, c.glow ? 1 : 0, false);
    }
    b.draw(renderer, target, false);
  }

  compileTargets(): CompileTarget[] {
    return [this.glass, this.batch.compileTarget];
  }

  dispose(): void {
    this.glass.dispose();
    this.batch.dispose();
  }
}
