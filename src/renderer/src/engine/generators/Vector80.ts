import * as THREE from 'three';
import { FULLSCREEN_VERT } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { StrokeBatch } from '../three/StrokeBatch';
import { liveText, type TextSource } from '../lyricsFeed';
import { hash01 } from '../modulation';
import { strokeGlyph, STROKE_ADVANCE } from '../text/strokeFont';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Vector arcade: the early-80s cabinets that drew with a beam instead of
 * pixels. Every line is the beam's path, bright where it lingers on a corner,
 * with the phosphor's glow (persistence comes from the look's feedback
 * effect). Four games play themselves to the music:
 *
 * - rocks: a white rock field; the ship shoots on the hats, every kick
 *   splits the nearest rock, a saucer crosses on the phrase.
 * - web: a 16-lane tube in colour, its lanes lit by the spectrum; the claw
 *   rides the loudest lane, flippers climb on the snare, spikes grow with the
 *   band, a new tube shape every phrase.
 * - tank: a green wireframe battlefield seen through the gun sight, under a
 *   red radar and score strip; the cannon fires on the kick, the glass
 *   cracks on the drop.
 * - trench: flying down a trench whose catwalks pass exactly on the beat,
 *   lasers on the kick and a target flash on the phrase.
 * - laser: a planetarium laser show, a new routine every phrase: a figure
 *   drawn by the left and right channels under fanning beams, a sheet of
 *   light rippling with the waveform, a cone of light breathing with the
 *   bass, a spirograph, and four scanners chasing on the beat.
 * - fractal: a low, fast flight over a glowing wireframe fractal landscape,
 *   peaks rising with the bass and towering on the drop.
 */

type Mode = 'rocks' | 'web' | 'tank' | 'trench' | 'laser' | 'fractal';
type RGB = [number, number, number];

const MAX_PTS = 24000;

interface Cmd {
  start: number;
  count: number;
  r: number;
  g: number;
  b: number;
  i: number;
  closed: boolean;
  dots: boolean;
}

interface Rock { x: number; y: number; vx: number; vy: number; r: number; a: number; spin: number; shape: number[] }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: RGB }
interface Shot { x: number; y: number; vx: number; vy: number; life: number }
interface Climber { lane: number; z: number; flip: number }

const WHITE: RGB = [0.85, 0.9, 1];

/**
 * Tinted overlay: the home vector console drew in white and came with a
 * coloured plastic sheet laid over the screen, so a beam took the colour of
 * wherever it was. Multiplied over the beams.
 */
const OVERLAY = /* glsl */ `
precision highp float;
uniform vec3 uA, uB, uC;
uniform float uMode, uAspect;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c;
  if (uMode < 1.5) {
    float top = smoothstep(0.74, 0.76, vUv.y), bottom = 1.0 - smoothstep(0.24, 0.26, vUv.y);
    c = mix(mix(uB, uA, top), uC, bottom);
  } else {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    c = mix(uB, uA, smoothstep(0.4, 0.42, length(p)));
  }
  fragColor = vec4(c, 1.0);
}
`;

/** Tube rims: 16 lanes, closed shapes have 16 points, open ones 17. */
function rim(shape: number, out: number[]): boolean {
  out.length = 0;
  const R = 0.98;
  const pushPolar = (k: number, r: number): void => {
    const a = Math.PI / 2 - (k / 16) * Math.PI * 2;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  };
  switch (shape % 9) {
    case 0: // circle
      for (let k = 0; k < 16; k++) pushPolar(k, R);
      return true;
    case 1: { // square
      for (let k = 0; k < 16; k++) {
        const side = Math.floor(k / 4), f = (k % 4) / 4;
        const c = [[-1, 1], [1, 1], [1, -1], [-1, -1]][side], n = [[1, 1], [1, -1], [-1, -1], [-1, 1]][side];
        out.push((c[0] + (n[0] - c[0]) * f) * R * 0.8, (c[1] + (n[1] - c[1]) * f) * R * 0.8);
      }
      return true;
    }
    case 2: { // plus
      const P = [[-0.33, 1], [0.33, 1], [0.33, 0.33], [1, 0.33], [1, -0.33], [0.33, -0.33], [0.33, -1], [-0.33, -1], [-0.33, -0.33], [-1, -0.33], [-1, 0.33], [-0.33, 0.33]];
      for (let k = 0; k < 16; k++) {
        const t = (k / 16) * P.length, i = Math.floor(t), f = t - i;
        const a = P[i], b = P[(i + 1) % P.length];
        out.push((a[0] + (b[0] - a[0]) * f) * R * 0.85, (a[1] + (b[1] - a[1]) * f) * R * 0.85);
      }
      return true;
    }
    case 3: // star
      for (let k = 0; k < 16; k++) pushPolar(k, k % 2 ? R * 0.55 : R);
      return true;
    case 4: // clover
      for (let k = 0; k < 16; k++) pushPolar(k, R * (0.62 + 0.38 * Math.abs(Math.cos((k / 16) * Math.PI * 2))));
      return true;
    case 5: // V
      for (let k = 0; k <= 16; k++) {
        const x = -1 + k / 8;
        out.push(x * R * 1.1, (Math.abs(x) * 1.25 - 0.55) * R);
      }
      return false;
    case 6: // U
      for (let k = 0; k <= 16; k++) {
        const a = Math.PI + (k / 16) * Math.PI;
        out.push(Math.cos(a) * R, Math.sin(a) * R * 0.9 + 0.15);
      }
      return false;
    case 7: // steps
      for (let k = 0; k <= 16; k++) out.push((-1 + k / 8) * R * 1.1, (Math.floor(Math.abs(k - 8) / 2) * 0.16 - 0.55) * R);
      return false;
    default: // flat
      for (let k = 0; k <= 16; k++) out.push((-1 + k / 8) * R * 1.15, -0.55 * R);
      return false;
  }
}

export class Vector80 implements Generator {
  readonly kind = 'vector80';
  private readonly batch = new StrokeBatch(MAX_PTS * 10);
  private readonly overlayPass = new FullscreenPass(
    new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: OVERLAY,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      uniforms: { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3() }, uMode: { value: 1 }, uAspect: { value: 16 / 9 } },
    }),
  );
  private overlay = 0;
  private readonly pts = new Float32Array(MAX_PTS * 2);
  private readonly tmp = new Float32Array(8);
  private n = 0;
  private readonly cmds: Cmd[] = [];
  private W = 1;
  private H = 1;
  private thick = 1.5;
  private glow = 1;
  private jx = 0;
  private jy = 0;
  private mode: Mode = 'rocks';
  private score = 0;
  // rocks
  private rocks: Rock[] = [];
  private sparks: Spark[] = [];
  private shots: Shot[] = [];
  private shipA = Math.PI / 2;
  private saucer = -1;
  private saucerY = 0.5;
  private lastFire = 0;
  // web
  private climbers: Climber[] = [];
  private webShots: Array<{ lane: number; z: number }> = [];
  private clawLane = 0;
  private readonly rimPts: number[] = [];
  // tank
  private camX = 0;
  private camZ = 0;
  private yaw = 0;
  private enemy = { x: 0, z: 12, a: 0, dead: -1 };
  private shell = -1;
  private crack = -1;
  private crackSeed = 0;
  private erupt = -1;
  // trench
  private trenchY = 0;
  private flash = 0;
  private lasers = -1;
  private lastBeat = 0;

  update(ctx: GenContext): void {
    const p = ctx.params;
    this.W = ctx.width;
    this.H = ctx.height;
    this.n = 0;
    this.cmds.length = 0;
    const mode = String(p.mode ?? 'rocks') as Mode;
    if (mode !== this.mode) {
      this.mode = mode;
      this.rocks = [];
      this.sparks = [];
      this.shots = [];
      this.climbers = [];
      this.webShots = [];
      this.score = 0;
    }
    this.thick = Math.max(0.6, (this.H / 1080) * 1.6 * num(p.beam, 1));
    this.glow = num(p.glow, 1);
    this.overlay = p.overlay === 'bands' ? 1 : p.overlay === 'centre' ? 2 : 0;
    if (this.overlay) {
      const ou = this.overlayPass.material.uniforms;
      const pal = ctx.palette;
      const fixed = String(p.color ?? 'palette') !== 'palette';
      const set = (v: THREE.Vector3, stop: number, fb: RGB): void => {
        const o = stop * 3;
        const m = Math.max(pal[o], pal[o + 1], pal[o + 2], 1e-4);
        if (fixed) v.set(fb[0], fb[1], fb[2]);
        else v.set(pal[o] / m, pal[o + 1] / m, pal[o + 2] / m);
      };
      set(ou.uA.value as THREE.Vector3, 2, [1, 0.15, 0.1]);
      set(ou.uB.value as THREE.Vector3, 1, [0.2, 0.9, 1]);
      set(ou.uC.value as THREE.Vector3, 3, [1, 0.85, 0.15]);
      ou.uMode.value = this.overlay;
      ou.uAspect.value = ctx.width / Math.max(1, ctx.height);
    }
    // A little beam jitter, the same in every window.
    const fr = Math.floor(ctx.time * 60);
    const jit = num(p.jitter, 1) * 0.0012;
    this.jx = (hash01(fr, 11) - 0.5) * jit;
    this.jy = (hash01(fr, 12) - 0.5) * jit;
    if (mode === 'web') this.web(ctx);
    else if (mode === 'tank') this.tank(ctx);
    else if (mode === 'trench') this.trench(ctx);
    else if (mode === 'laser') this.laser(ctx);
    else if (mode === 'fractal') this.fractal(ctx);
    else this.rocksGame(ctx);
    this.lastBeat = ctx.beat;
  }

  // ── Drawing helpers (world units: y up, −1..1 tall, x scaled the same) ──

  private sx(x: number): number {
    return this.W / 2 + (x + this.jx) * this.H * 0.5;
  }

  private sy(y: number): number {
    return this.H / 2 + (y + this.jy) * this.H * 0.5;
  }

  private get aspect(): number {
    return this.W / Math.max(1, this.H);
  }

  /** A polyline in world units. */
  private line(xy: ArrayLike<number>, c: RGB, i = 1, closed = false, dots = true): void {
    const count = xy.length / 2;
    if (count < 2 || this.n + count > MAX_PTS) return;
    const start = this.n;
    for (let k = 0; k < count; k++) {
      this.pts[(start + k) * 2] = this.sx(xy[k * 2]);
      this.pts[(start + k) * 2 + 1] = this.sy(xy[k * 2 + 1]);
    }
    this.n += count;
    this.cmds.push({ start, count, r: c[0], g: c[1], b: c[2], i, closed, dots });
  }

  private dot(x: number, y: number, c: RGB, i = 1): void {
    const d = 0.0025;
    this.line([x - d, y, x + d, y], c, i * 1.4, false, false);
  }

  /** Vector lettering (the stroke font), `size` = cap height in world units. */
  private text(s: string, x: number, y: number, size: number, c: RGB, i = 1, align: 'left' | 'center' | 'right' = 'left'): void {
    const k = size / 6;
    const width = s.length * STROKE_ADVANCE * k;
    let ox = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    for (const ch of s) {
      const gl = strokeGlyph(ch);
      if (gl) {
        const xy: number[] = [];
        for (let m = 0; m < gl.length; m += 2) xy.push(ox + gl[m] * k, y + gl[m + 1] * k);
        this.line(xy, c, i, false, false);
      }
      ox += STROKE_ADVANCE * k;
    }
  }

  private words(ctx: GenContext): string {
    const live = liveText(String(ctx.params.source ?? 'text') as TextSource, Date.now());
    if (live.kind === 'text') return String(ctx.params.text ?? '');
    if (live.kind === 'title') return live.lines.join(' - ');
    return live.lines[live.current] ?? '';
  }

  /**
   * A game element's colour. With the look's palette (the default), element
   * slots 0–3 take palette stops 1–4, brought up to full brightness because
   * a beam is light; each look ships a palette of its game's own colours.
   */
  private colour(ctx: GenContext, c: RGB, slot: number): RGB {
    const mode = String(ctx.params.color ?? 'palette');
    // Under an overlay the console draws in white and the sheet does the colouring.
    if (this.overlay) return [1, 1, 1];
    if (mode === 'classic') return c;
    if (mode === 'white') return WHITE;
    if (mode === 'green') return [0.25, 1, 0.35];
    const o = (1 + (((slot % 4) + 4) % 4)) * 3;
    const r = ctx.palette[o], g = ctx.palette[o + 1], b = ctx.palette[o + 2];
    const m = Math.max(r, g, b, 1e-4);
    const k = m < 0.9 ? 0.9 / m : 1;
    return [r * k, g * k, b * k];
  }

  private sparkUpdate(dt: number): void {
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life > 0) this.dot(s.x, s.y, s.c, s.life / s.max);
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  private burst(x: number, y: number, c: RGB, n: number, speed: number, seed: number): void {
    for (let k = 0; k < n; k++) {
      const a = hash01(k, seed) * Math.PI * 2, v = speed * (0.4 + hash01(k, seed + 1) * 0.8);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + hash01(k, seed + 2) * 0.4, max: 0.9, c });
    }
    if (this.sparks.length > 400) this.sparks.splice(0, this.sparks.length - 400);
  }

  // ── Rocks ───────────────────────────────────────────────────────────────

  private spawnRock(r: number, x: number, y: number, seed: number): Rock {
    const shape: number[] = [];
    const sides = 10 + Math.floor(hash01(seed, 1) * 3);
    for (let k = 0; k < sides; k++) shape.push(0.72 + hash01(seed, k + 3) * 0.32);
    const a = hash01(seed, 2) * Math.PI * 2;
    const v = (0.08 + hash01(seed, 4) * 0.12) * (0.18 / Math.max(0.05, r)) ** 0.5;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r, a: 0, spin: (hash01(seed, 5) - 0.5) * 1.2, shape };
  }

  private rocksGame(ctx: GenContext): void {
    const p = ctx.params;
    const A = this.aspect;
    const dt = Math.min(0.05, ctx.dt) * num(p.speed, 1);
    const f = ctx.frame;
    const col = this.colour(ctx, WHITE, 0);
    const seed = Math.floor(ctx.time * 1000);
    if (this.rocks.length < 3 && (f.isDownbeat || this.rocks.length === 0)) {
      const want = Math.round(num(p.rocks, 5));
      for (let k = 0; k < want; k++) {
        const s = seed + k * 17;
        const side = hash01(s, 9) < 0.5;
        this.rocks.push(this.spawnRock(0.21, side ? -A - 0.1 : (hash01(s, 7) * 2 - 1) * A, side ? hash01(s, 8) * 2 - 1 : 1.1, s));
      }
    }
    for (const r of this.rocks) {
      r.x += r.vx * dt * (1 + ctx.env.energy);
      r.y += r.vy * dt * (1 + ctx.env.energy);
      r.a += r.spin * dt;
      if (r.x > A + r.r) r.x -= 2 * (A + r.r);
      if (r.x < -A - r.r) r.x += 2 * (A + r.r);
      if (r.y > 1 + r.r) r.y -= 2 + 2 * r.r;
      if (r.y < -1 - r.r) r.y += 2 + 2 * r.r;
    }
    // The ship turns to the nearest rock.
    let target: Rock | null = null;
    let best = 1e9;
    for (const r of this.rocks) {
      const d = Math.hypot(r.x, r.y);
      if (d < best) {
        best = d;
        target = r;
      }
    }
    if (target) {
      const want = Math.atan2(target.y, target.x);
      let d = want - this.shipA;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.shipA += Math.max(-7 * dt, Math.min(7 * dt, d));
    }
    // Every kick lands a shot on the nearest rock; hats and snares spray.
    const fire = (aim: number): void => {
      const v = 1.8;
      this.shots.push({ x: Math.cos(this.shipA) * 0.05, y: Math.sin(this.shipA) * 0.05, vx: Math.cos(aim) * v, vy: Math.sin(aim) * v, life: 1.1 });
    };
    if (f.onsets.kick && target) {
      this.shipA = Math.atan2(target.y, target.x);
      fire(this.shipA);
    } else if ((f.onsets.hat || f.onsets.snare) && ctx.time - this.lastFire > 0.12) {
      this.lastFire = ctx.time;
      fire(this.shipA + (hash01(seed, 3) - 0.5) * 0.25);
    }
    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      for (let k = 0; k < this.rocks.length; k++) {
        const r = this.rocks[k];
        if (s.life > 0 && Math.hypot(s.x - r.x, s.y - r.y) < r.r * 0.95) {
          s.life = 0;
          this.rocks.splice(k, 1);
          this.burst(r.x, r.y, col, 10, 0.5, seed + k);
          this.score += r.r > 0.12 ? 20 : r.r > 0.07 ? 50 : 100;
          if (r.r > 0.06) for (const m of [0, 1]) this.rocks.push(this.spawnRock(r.r * 0.55, r.x, r.y, seed + k * 7 + m));
          break;
        }
      }
      if (s.life > 0) this.dot(s.x, s.y, col, 1.3);
    }
    this.shots = this.shots.filter((s) => s.life > 0);
    for (const r of this.rocks) {
      const xy: number[] = [];
      const sides = r.shape.length;
      for (let k = 0; k < sides; k++) {
        const a = r.a + (k / sides) * Math.PI * 2;
        xy.push(r.x + Math.cos(a) * r.r * r.shape[k], r.y + Math.sin(a) * r.r * r.shape[k]);
      }
      this.line(xy, col, 0.85, true);
    }
    // The ship, and its flame on the bass.
    const s = 0.045, ca = Math.cos(this.shipA - Math.PI / 2), sa = Math.sin(this.shipA - Math.PI / 2);
    const tr = (x: number, y: number): [number, number] => [(x * ca - y * sa) * s, (x * sa + y * ca) * s];
    const ship = [tr(-0.6, -0.8), tr(0, 1), tr(0.6, -0.8)].flat();
    this.line(ship, col, 1.1);
    this.line([...tr(-0.42, -0.42), ...tr(0.42, -0.42)], col, 1.1);
    if (ctx.env.bass > 0.45 && Math.floor(ctx.time * 30) % 2 === 0) this.line([...tr(-0.25, -0.42), ...tr(0, -1.1 - ctx.env.bass * 0.6), ...tr(0.25, -0.42)], col, 0.9);
    // The saucer crosses on each phrase.
    if (f.isPhraseStart) {
      this.saucer = 0;
      this.saucerY = hash01(seed, 21) * 1.2 - 0.6;
    }
    if (this.saucer >= 0) {
      this.saucer += dt / (8 * (60 / Math.max(60, f.bpm || 120)));
      const x = -A - 0.1 + this.saucer * (2 * A + 0.2), y = this.saucerY + Math.sin(this.saucer * 12) * 0.05, k = 0.055;
      const hull = [-1, 0, 1, 0, 0.45, 0.35, -0.45, 0.35, -1, 0, -0.45, -0.35, 0.45, -0.35, 1, 0];
      this.line(hull.map((v, m) => (m % 2 ? y + v * k : x + v * k)), col, 1);
      this.line([-0.25, 0.35, -0.15, 0.6, 0.15, 0.6, 0.25, 0.35].map((v, m) => (m % 2 ? y + v * k : x + v * k)), col, 1);
      if (this.saucer > 1) this.saucer = -1;
    }
    this.sparkUpdate(dt);
    // Score, spare ships and the words along the bottom.
    this.text(String(this.score).padStart(2, '0'), -A + 0.25, 0.82, 0.07, col, 0.9, 'right');
    for (let k = 0; k < 3; k++) {
      const x0 = -A + 0.1 + k * 0.05, y0 = 0.74;
      this.line([x0 - 0.016, y0 - 0.022, x0, y0 + 0.028, x0 + 0.016, y0 - 0.022], col, 0.8);
    }
    this.text(String(Math.max(this.score, 9480)), 0, 0.84, 0.04, col, 0.7, 'center');
    const w = this.words(ctx);
    if (w) this.text(w.toUpperCase().slice(0, 40), 0, -0.88, 0.055, col, 0.9, 'center');
  }

  // ── Web ─────────────────────────────────────────────────────────────────

  private web(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const dt = Math.min(0.05, ctx.dt) * num(p.speed, 1);
    const bpp = Math.max(4, f.beatsPerPhrase || 16) * Math.max(1, Math.round(num(p.shapePhrases, 1)));
    const level = Math.floor(ctx.beat / bpp);
    const inPhrase = ctx.beat / bpp - level;
    const closed = rim(level, this.rimPts);
    const pts = this.rimPts;
    const nv = pts.length / 2;
    const far = 0.12;
    const fc: [number, number] = closed ? [0, 0.04] : [0, 0.22];
    // Fly down the tube in the last beat of the phrase, the next tube grows in.
    const flyBeats = 1.5 / bpp;
    const zoom = inPhrase > 1 - flyBeats ? 1 + ((inPhrase - (1 - flyBeats)) / flyBeats) ** 2 * 7 : inPhrase < 0.04 ? 0.3 + (inPhrase / 0.04) * 0.7 : 1;
    const fade = inPhrase > 1 - flyBeats ? 1 - (inPhrase - (1 - flyBeats)) / flyBeats : 1;
    const P = (k: number, z: number): [number, number] => {
      const s = 1 - (1 - far) * (1 - 1 / (1 + z * 7.3)) / (1 - 1 / 8.3);
      const x = fc[0] + (pts[k * 2] - fc[0]) * s, y = fc[1] + (pts[k * 2 + 1] - fc[1]) * s;
      return [x * zoom, y * zoom];
    };
    const blue = this.colour(ctx, [0.15, 0.25, 1], 1);
    const yellow = this.colour(ctx, [1, 0.9, 0.15], 2);
    const red = this.colour(ctx, [1, 0.12, 0.1], 3);
    const green = this.colour(ctx, [0.2, 1, 0.3], 0);
    const lanes = closed ? 16 : 16;
    const band = (lane: number): number => f.bands32[Math.min(31, Math.floor((lane / lanes) * 28))] ?? 0;
    // The claw rides the loudest lane, moving on the beat.
    if (Math.floor(ctx.beat * 2) !== Math.floor(this.lastBeat * 2)) {
      let bl = 0, bv = -1;
      for (let l = 0; l < lanes; l++) if (band(l) > bv) (bv = band(l)), (bl = l);
      const step = Math.sign(bl - this.clawLane);
      this.clawLane = closed ? (this.clawLane + (Math.abs(bl - this.clawLane) > 8 ? -step : step) + 16) % 16 : Math.max(0, Math.min(15, this.clawLane + step));
    }
    const kickFlash = 1 + ctx.env.kick * 0.8;
    // Rims and lane lines, lit by the spectrum.
    const near: number[] = [], farR: number[] = [];
    for (let k = 0; k < nv; k++) {
      near.push(...P(k, 0));
      farR.push(...P(k, 1));
    }
    this.line(near, blue, 0.9 * kickFlash * fade, closed);
    this.line(farR, blue, 0.7 * fade, closed);
    for (let k = 0; k < nv; k++) {
      const lv = Math.max(band(k % 16), band((k + 15) % 16));
      const onClaw = k === this.clawLane || k === (this.clawLane + 1) % nv;
      this.line([...P(k, 0), ...P(k, 1)], onClaw ? yellow : blue, (0.35 + lv * 0.9) * fade, false, false);
    }
    // Spikes grow up the lanes with each band.
    for (let l = 0; l < lanes; l++) {
      const len = band(l) * num(p.spikes, 1) * 0.55;
      if (len < 0.05) continue;
      const k2 = (l + 1) % nv;
      const mid = (z: number): [number, number] => {
        const a = P(l, z), b = P(k2, z);
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      };
      this.line([...mid(1), ...mid(1 - len)], green, 0.8 * fade);
    }
    // Flippers climb on the snare; shots on the hats.
    const seed = Math.floor(ctx.time * 1000);
    if (f.onsets.snare && this.climbers.length < 14) this.climbers.push({ lane: Math.floor(hash01(seed, 31) * lanes), z: 1, flip: 0 });
    if ((f.onsets.hat || f.onsets.kick) && this.webShots.length < 8) this.webShots.push({ lane: this.clawLane, z: 0 });
    const climb = dt * (0.18 + ctx.env.energy * 0.35);
    for (const c of this.climbers) {
      if (c.z > 0) c.z = Math.max(0, c.z - climb);
      else if (Math.floor(ctx.beat) !== Math.floor(this.lastBeat)) c.lane = closed ? (c.lane + 1) % 16 : Math.min(15, c.lane + 1);
    }
    for (const s of this.webShots) {
      s.z += dt * 2.2;
      for (const c of this.climbers) {
        if (c.lane === s.lane && Math.abs(c.z - s.z) < 0.08 && s.z < 1.1) {
          const a = P(c.lane, c.z), b = P((c.lane + 1) % nv, c.z);
          this.burst((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, red, 8, 0.35, seed + c.lane);
          c.z = -9;
          s.z = 9;
          this.score += 150;
        }
      }
    }
    // Drop: the zapper clears the tube.
    if (f.drop) for (const c of this.climbers) if (c.z > -1) (c.z = -9), this.burst(0, 0, red, 4, 0.6, seed + c.lane);
    this.climbers = this.climbers.filter((c) => c.z > -1);
    this.webShots = this.webShots.filter((s) => s.z < 1.05);
    for (const c of this.climbers) {
      const a = P(c.lane, c.z), b = P((c.lane + 1) % nv, c.z);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const h = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.35;
      // A bow-tie across the lane.
      this.line([a[0], a[1], mx, my + h, b[0], b[1], mx, my - h, a[0], a[1]], red, 1 * fade);
    }
    for (const s of this.webShots) {
      const a = P(s.lane, s.z), b = P((s.lane + 1) % nv, s.z);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12;
      this.line([mx - d, my, mx, my + d, mx + d, my, mx, my - d], yellow, 1.2, true, false);
    }
    // The claw.
    {
      const a = P(this.clawLane, 0), b = P((this.clawLane + 1) % nv, 0);
      const mx = (a[0] + b[0]) / 2 - fc[0], my = (a[1] + b[1]) / 2 - fc[1];
      const ml = Math.hypot(mx, my) || 1;
      const nx = mx / ml, ny = my / ml;
      const L = (t: number, o: number): [number, number] => [a[0] + (b[0] - a[0]) * t + nx * o, a[1] + (b[1] - a[1]) * t + ny * o];
      this.line([...a, ...L(0.15, 0.1), ...L(0.5, 0.045), ...L(0.85, 0.1), ...b, ...L(0.7, 0.03), ...L(0.3, 0.03)], yellow, 1.3 * fade, true);
    }
    this.sparkUpdate(dt);
    const A = this.aspect;
    this.text(String(this.score).padStart(6, '0'), -A + 0.1, 0.84, 0.06, green, 0.9);
    this.text(`LEVEL ${String(level + 1).padStart(2, '0')}`, A - 0.1, 0.84, 0.045, blue, 0.9, 'right');
    const w = this.words(ctx);
    if (w) this.text(w.toUpperCase().slice(0, 40), 0, -0.92, 0.05, yellow, 0.9, 'center');
  }

  // ── Tank ────────────────────────────────────────────────────────────────

  private tank(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const dt = Math.min(0.05, ctx.dt) * num(p.speed, 1);
    const A = this.aspect;
    const green = this.colour(ctx, [0.2, 1, 0.3], 0);
    const red = this.colour(ctx, [1, 0.15, 0.12], 3);
    const seed = Math.floor(ctx.time * 1000);
    // Drive forward, turning a little through the phrase.
    const spd = 1.4 * (0.4 + ctx.env.energy);
    this.yaw += dt * (Math.sin(ctx.beat * 0.07) * 0.18 + Math.sin(ctx.beat * 0.023) * 0.1);
    this.camX += Math.sin(this.yaw) * spd * dt;
    this.camZ += Math.cos(this.yaw) * spd * dt;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const camH = 0.55, horizon = 0.12, focal = 1.3;
    const proj = (x: number, y: number, z: number): [number, number, number] => {
      const dx = x - this.camX, dz = z - this.camZ;
      const cx = dx * cy - dz * sy, cz = dx * sy + dz * cy;
      return [(cx / cz) * focal, horizon + ((y - camH) / cz) * focal, cz];
    };
    const seg3 = (a: number[], b: number[], c: RGB, i: number): void => {
      let pa = proj(a[0], a[1], a[2]), pb = proj(b[0], b[1], b[2]);
      const near = 0.35;
      if (pa[2] < near && pb[2] < near) return;
      if (pa[2] < near || pb[2] < near) {
        const t = (near - pa[2]) / (pb[2] - pa[2]);
        const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        if (pa[2] < near) pa = proj(m[0], m[1], m[2]);
        else pb = proj(m[0], m[1], m[2]);
      }
      if (Math.abs(pa[0]) > A * 3 && Math.abs(pb[0]) > A * 3) return;
      const fadeZ = Math.max(0, Math.min(1, (40 - Math.min(pa[2], pb[2])) / 15));
      this.line([pa[0], pa[1], pb[0], pb[1]], c, i * fadeZ);
    };
    // The horizon, the mountains all around, the volcano and the moon.
    this.line([-A, horizon, A, horizon], green, 0.8, false, false);
    const ridge: number[] = [];
    let volcanoX = 9;
    for (let k = 0; k <= 96; k++) {
      const x = -A + (k / 96) * 2 * A;
      const az = this.yaw + Math.atan(x / focal);
      const t = az * 3;
      const jag = Math.abs(Math.sin(t * 2.1)) * 0.11 + Math.abs(Math.sin(t * 5.3 + 1)) * 0.06 + Math.abs(Math.sin(t * 11.7 + 2)) * 0.025;
      const vd = Math.atan2(Math.sin(az - 0.6), Math.cos(az - 0.6));
      const volcano = Math.max(0, 0.26 - Math.abs(vd) * 1.6);
      if (Math.abs(vd) < 0.02) volcanoX = x;
      ridge.push(x, horizon + jag + volcano);
    }
    this.line(ridge, green, 0.7, false, false);
    if (f.drop || f.isPhraseStart) this.erupt = 0;
    if (this.erupt >= 0 && volcanoX < 9) {
      this.erupt += dt;
      for (let k = 0; k < 14; k++) {
        const a = Math.PI / 2 + (hash01(k, 41) - 0.5) * 1.6, v = 0.25 + hash01(k, 42) * 0.25, t = this.erupt;
        this.dot(volcanoX + Math.cos(a) * v * t, horizon + 0.27 + Math.sin(a) * v * t - 0.35 * t * t, green, Math.max(0, 1 - t / 1.5));
      }
      if (this.erupt > 1.5) this.erupt = -1;
    }
    const moonAz = Math.atan2(Math.sin(-0.9 - this.yaw), Math.cos(-0.9 - this.yaw));
    const mx = Math.tan(-moonAz) * focal;
    if (Math.abs(moonAz) < 1.1) {
      const arc = (r: number, off: number, from: number, to: number): number[] => {
        const xy: number[] = [];
        for (let k = 0; k <= 12; k++) {
          const a = from + ((to - from) * k) / 12;
          xy.push(mx + off + Math.cos(a) * r, 0.55 + Math.sin(a) * r);
        }
        return xy;
      };
      this.line(arc(0.06, 0, Math.PI * 0.35, Math.PI * 1.65), green, 0.6, false, false);
      this.line(arc(0.05, -0.022, Math.PI * 0.4, Math.PI * 1.6), green, 0.6, false, false);
    }
    // Obstacles from a grid around the camera.
    const cell = 6;
    const gx0 = Math.floor(this.camX / cell), gz0 = Math.floor(this.camZ / cell);
    for (let gx = gx0 - 6; gx <= gx0 + 6; gx++) {
      for (let gz = gz0 - 6; gz <= gz0 + 6; gz++) {
        const h = hash01(gx * 7919 + gz, 77);
        if (h > 0.34) continue;
        const ox = gx * cell + hash01(gx, gz + 3) * cell * 0.6, oz = gz * cell + hash01(gz, gx + 5) * cell * 0.6;
        const s = 0.9 + hash01(gx + gz, 9) * 1.1;
        if (h < 0.17) {
          const top = [ox, s * 1.6, oz];
          const base = [[ox - s, 0, oz - s], [ox + s, 0, oz - s], [ox + s, 0, oz + s], [ox - s, 0, oz + s]];
          for (let k = 0; k < 4; k++) {
            seg3(base[k], base[(k + 1) % 4], green, 0.8);
            seg3(base[k], top, green, 0.8);
          }
        } else {
          const y1 = s * 0.9;
          const c = [[ox - s, oz - s], [ox + s, oz - s], [ox + s, oz + s], [ox - s, oz + s]];
          for (let k = 0; k < 4; k++) {
            const a = c[k], b = c[(k + 1) % 4];
            seg3([a[0], 0, a[1]], [b[0], 0, b[1]], green, 0.8);
            seg3([a[0], y1, a[1]], [b[0], y1, b[1]], green, 0.8);
            seg3([a[0], 0, a[1]], [a[0], y1, a[1]], green, 0.8);
          }
        }
      }
    }
    // The enemy tank: placed ahead, it turns toward you; the cannon fires on the kick.
    const e = this.enemy;
    if (e.dead < 0 && Math.hypot(e.x - this.camX, e.z - this.camZ) > 40) e.dead = 0.01;
    if (e.dead >= 0) {
      e.dead += dt;
      if (e.dead > 2) {
        const a = this.yaw + (hash01(seed, 51) - 0.5) * 0.9, d = 12 + hash01(seed, 52) * 10;
        e.x = this.camX + Math.sin(a) * d;
        e.z = this.camZ + Math.cos(a) * d;
        e.dead = -1;
      }
    } else e.a += dt * 0.4;
    const ep = proj(e.x, 0.3, e.z);
    const onTarget = e.dead < 0 && ep[2] > 1 && Math.abs(ep[0]) < 0.12;
    if (f.onsets.kick && this.shell < 0) this.shell = 0;
    if (this.shell >= 0) {
      this.shell += dt * 2.2;
      const t = this.shell;
      const tx = onTarget || e.dead >= 0 ? ep[0] : 0, ty = onTarget ? ep[1] : horizon;
      const x0 = tx * t, y0 = -0.95 + (ty + 0.95) * t;
      this.line([x0 - 0.012, y0 - 0.03, x0 + 0.012, y0 - 0.03, x0, y0 + 0.02], green, 1.2, true);
      if (t >= 1) {
        if (onTarget) {
          e.dead = 0;
          this.score += 1000;
        }
        this.shell = -1;
      }
    }
    if (ep[2] > 0.5) {
      const parts = this.tankModel();
      const blast = e.dead >= 0 ? e.dead * 2.2 : 0;
      const ca = Math.cos(e.a), sa = Math.sin(e.a);
      parts.forEach((part, pi) => {
        const dir = [(hash01(pi, 61) - 0.5) * 2, 0.6 + hash01(pi, 62), (hash01(pi, 63) - 0.5) * 2];
        for (let k = 0; k + 5 < part.length; k += 6) {
          const tf = (x: number, y: number, z: number): number[] => [e.x + (x * ca - z * sa) * 1.7 + dir[0] * blast, Math.max(0, y * 1.7 + dir[1] * blast - blast * blast * 0.6), e.z + (x * sa + z * ca) * 1.7 + dir[2] * blast];
          seg3(tf(part[k], part[k + 1], part[k + 2]), tf(part[k + 3], part[k + 4], part[k + 5]), green, e.dead >= 0 ? Math.max(0, 1 - e.dead / 1.6) : 1);
        }
      });
    }
    // The gun sight.
    const sight = onTarget ? 1.4 : 0.9;
    this.line([0, 0.32, 0, 0.12], green, sight, false, false);
    this.line([0, -0.12, 0, -0.32], green, sight, false, false);
    this.line([-0.14, 0.08, -0.14, 0.14, 0.14, 0.14, 0.14, 0.08], green, sight, false);
    this.line([-0.14, -0.08, -0.14, -0.14, 0.14, -0.14, 0.14, -0.08], green, sight, false);
    if (ctx.env.kick > 0.6) this.line([-0.05, 0, 0.05, 0], green, 1.2, false, false);
    // The red strip: radar, score and the warnings.
    const rr = 0.13, rx = 0, ry = 0.8;
    const circ: number[] = [];
    for (let k = 0; k < 24; k++) circ.push(rx + Math.cos((k / 24) * Math.PI * 2) * rr, ry + Math.sin((k / 24) * Math.PI * 2) * rr);
    this.line(circ, red, 0.8, true, false);
    const sweep = -f.barPhase * Math.PI * 2 + Math.PI / 2;
    this.line([rx, ry, rx + Math.cos(sweep) * rr, ry + Math.sin(sweep) * rr], red, 1, false, false);
    if (e.dead < 0) {
      const dx = e.x - this.camX, dz = e.z - this.camZ;
      const bx = (dx * cy - dz * sy) / 30, bz = (dx * sy + dz * cy) / 30;
      if (Math.hypot(bx, bz) < 1) this.dot(rx + bx * rr, ry + bz * rr, red, 1.3);
    }
    this.text(`SCORE ${this.score}`, A - 0.1, 0.84, 0.05, red, 0.9, 'right');
    this.text('HIGH SCORE 100000', A - 0.1, 0.74, 0.035, red, 0.7, 'right');
    if (onTarget && Math.floor(ctx.time * 3) % 2 === 0) this.text('ENEMY IN RANGE', -A + 0.1, 0.84, 0.045, red, 0.9);
    else if (e.dead < 0 && !onTarget) this.text(ep[2] < 0.5 ? 'ENEMY TO REAR' : ep[0] < 0 ? 'ENEMY TO LEFT' : 'ENEMY TO RIGHT', -A + 0.1, 0.84, 0.045, red, Math.floor(ctx.time * 2) % 2 ? 0.9 : 0.3);
    const w = this.words(ctx);
    if (w) this.text(w.toUpperCase().slice(0, 40), 0, -0.9, 0.05, green, 0.9, 'center');
    // Drop: the glass cracks from a hit and fades over two beats.
    if (f.drop) {
      this.crack = 0;
      this.crackSeed = seed;
    }
    if (this.crack >= 0) {
      this.crack += dt / Math.max(0.3, (60 / Math.max(60, f.bpm || 120)) * 2);
      const i = Math.max(0, 1 - this.crack);
      const hx = (hash01(this.crackSeed, 1) - 0.5) * 0.8, hy = (hash01(this.crackSeed, 2) - 0.5) * 0.6;
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + hash01(this.crackSeed, k + 5);
        const xy = [hx, hy];
        let x = hx, y = hy, ang = a;
        for (let m = 0; m < 6; m++) {
          ang += (hash01(this.crackSeed + k, m) - 0.5) * 0.7;
          const len = 0.08 + hash01(this.crackSeed + k, m + 9) * 0.2;
          x += Math.cos(ang) * len;
          y += Math.sin(ang) * len;
          xy.push(x, y);
        }
        this.line(xy, green, i * 1.3, false, false);
      }
      if (this.crack >= 1) this.crack = -1;
    }
  }

  /** The enemy tank as line segments (x, y, z pairs of points), in parts that fly apart. */
  private tankModel(): number[][] {
    const box = (x0: number, x1: number, y0: number, y1: number, zb0: number, zb1: number, zt0: number, zt1: number): number[] => {
      const b = [[x0, y0, zb0], [x1, y0, zb0], [x1, y0, zb1], [x0, y0, zb1]];
      const t = [[x0 * 0.85, y1, zt0], [x1 * 0.85, y1, zt0], [x1 * 0.85, y1, zt1], [x0 * 0.85, y1, zt1]];
      const out: number[] = [];
      for (let k = 0; k < 4; k++) {
        out.push(...b[k], ...b[(k + 1) % 4], ...t[k], ...t[(k + 1) % 4], ...b[k], ...t[k]);
      }
      return out;
    };
    return [
      box(-0.55, 0.55, 0, 0.3, -0.9, 0.9, -0.7, 0.8),
      box(-0.3, 0.3, 0.3, 0.55, -0.35, 0.25, -0.25, 0.2),
      [0, 0.45, 0.2, 0, 0.45, 1.2, 0.06, 0.45, 0.2, 0.06, 0.45, 1.2, 0, 0.45, 1.2, 0.06, 0.45, 1.2],
    ];
  }

  // ── Trench ──────────────────────────────────────────────────────────────

  private trench(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const dt = Math.min(0.05, ctx.dt);
    const A = this.aspect;
    const cyan = this.colour(ctx, [0.2, 0.55, 1], 1);
    const green = this.colour(ctx, [0.25, 1, 0.4], 0);
    const orange = this.colour(ctx, [1, 0.45, 0.1], 2);
    const yellow = this.colour(ctx, [1, 0.9, 0.2], 3);
    // Distance is measured in beats, so a catwalk placed at beat b passes the camera on beat b.
    const unit = 4 * num(p.speed, 1);
    const camZ = ctx.beat * unit;
    const nextBar = Math.ceil(ctx.beat);
    const barHeight = (b: number): number => (hash01(b, 81) < 0.5 ? 0.45 : -0.45);
    // Duck away from the next catwalk.
    const want = -barHeight(nextBar) * 0.8;
    this.trenchY += (want - this.trenchY) * (1 - Math.exp(-dt * 5));
    const camX = Math.sin(ctx.beat * 0.25) * 0.3;
    const focal = 1.1;
    const proj = (x: number, y: number, z: number): [number, number] | null => {
      const cz = z - camZ;
      if (cz < 0.2) return null;
      return [((x - camX) / cz) * focal, ((y - this.trenchY) / cz) * focal];
    };
    const seg = (a: number[], b: number[], c: RGB, i: number): void => {
      let za = a[2], zb = b[2];
      const near = camZ + 0.25;
      if (za < near && zb < near) return;
      const pa = a.slice(), pb = b.slice();
      if (za < near) {
        const t = (near - za) / (zb - za);
        for (let k = 0; k < 3; k++) pa[k] = a[k] + (b[k] - a[k]) * t;
        za = near;
      }
      if (zb < near) {
        const t = (near - zb) / (za - zb);
        for (let k = 0; k < 3; k++) pb[k] = b[k] + (a[k] - b[k]) * t;
      }
      const A2 = proj(pa[0], pa[1], pa[2]), B2 = proj(pb[0], pb[1], pb[2]);
      if (!A2 || !B2) return;
      const depth = Math.min(pa[2], pb[2]) - camZ;
      this.line([A2[0], A2[1], B2[0], B2[1]], c, i * Math.max(0, Math.min(1, (unit * 8 - depth) / (unit * 3))), false, false);
    };
    const W2 = 1, FL = -1, TOP = 1;
    const zFar = camZ + unit * 8;
    // Long lines down the trench.
    for (const [x, y] of [[-W2, FL], [W2, FL], [-W2, TOP], [W2, TOP]]) seg([x, y, camZ], [x, y, zFar], cyan, 0.8);
    for (const x of [-3, 3]) seg([x, TOP, camZ], [x, TOP, zFar], green, 0.5);
    // Ribs every half beat, panels on the walls.
    const step = unit / 2;
    for (let z = Math.ceil(camZ / step) * step; z < zFar; z += step) {
      const idx = Math.round(z / step);
      seg([-W2, TOP, z], [-W2, FL, z], cyan, 0.7);
      seg([-W2, FL, z], [W2, FL, z], cyan, 0.7);
      seg([W2, FL, z], [W2, TOP, z], cyan, 0.7);
      seg([-W2, TOP, z], [-3, TOP, z], green, 0.35);
      seg([W2, TOP, z], [3, TOP, z], green, 0.35);
      for (const side of [-1, 1]) {
        if (hash01(idx, side + 90) < 0.5) continue;
        const y0 = -0.6 + hash01(idx, side + 92) * 0.8, y1 = y0 + 0.2 + hash01(idx, side + 93) * 0.3;
        const z0 = z + step * 0.15, z1 = z + step * (0.4 + hash01(idx, side + 94) * 0.4);
        const x = side * W2;
        seg([x, y0, z0], [x, y1, z0], cyan, 0.5);
        seg([x, y1, z0], [x, y1, z1], cyan, 0.5);
        seg([x, y1, z1], [x, y0, z1], cyan, 0.5);
        seg([x, y0, z1], [x, y0, z0], cyan, 0.5);
      }
      // Turrets on the rims.
      if (hash01(idx, 97) < 0.18) {
        const x = hash01(idx, 98) < 0.5 ? -1.6 : 1.6;
        const s = 0.18;
        seg([x - s, TOP, z], [x - s, TOP + s * 2, z], yellow, 0.8);
        seg([x - s, TOP + s * 2, z], [x + s, TOP + s * 2, z], yellow, 0.8);
        seg([x + s, TOP + s * 2, z], [x + s, TOP, z], yellow, 0.8);
      }
    }
    // Catwalks: one per beat, reaching the camera on the beat.
    for (let b = Math.ceil(ctx.beat); b < ctx.beat + 8; b++) {
      if (hash01(b, 85) < 0.35) continue;
      const z = b * unit, y = barHeight(b), h = 0.16;
      seg([-W2, y - h, z], [W2, y - h, z], orange, 1);
      seg([-W2, y + h, z], [W2, y + h, z], orange, 1);
      seg([-W2, y - h, z], [-W2, y + h, z], orange, 1);
      seg([W2, y - h, z], [W2, y + h, z], orange, 1);
      seg([-W2, y + h, z], [W2, y - h, z], orange, 0.5);
    }
    // The target on the floor at the end of each phrase, and its flash.
    const bpp = f.beatsPerPhrase || 16;
    const portBeat = Math.ceil(ctx.beat / bpp) * bpp;
    if (portBeat - ctx.beat < 8) {
      const z = portBeat * unit, s = 0.3;
      seg([-s, FL, z - s], [s, FL, z - s], yellow, 1.2);
      seg([s, FL, z - s], [s, FL, z + s], yellow, 1.2);
      seg([s, FL, z + s], [-s, FL, z + s], yellow, 1.2);
      seg([-s, FL, z + s], [-s, FL, z - s], yellow, 1.2);
      seg([-s * 1.6, FL, z], [s * 1.6, FL, z], yellow, 0.8);
      seg([0, FL, z - s * 1.6], [0, FL, z + s * 1.6], yellow, 0.8);
    }
    if (f.isPhraseStart) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (this.flash > 0) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, r0 = (1 - this.flash) * 1.5;
        this.line([Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * (r0 + 0.4), Math.sin(a) * (r0 + 0.4)], [1, 1, 1], this.flash * 1.5, false, false);
      }
    }
    // Cross-hair and lasers on the kick.
    const hx = Math.sin(ctx.time * 0.7) * 0.08, hy = Math.cos(ctx.time * 0.5) * 0.05;
    const g2 = 0.025, L = 0.07;
    this.line([hx - L, hy, hx - g2, hy], orange, 1, false, false);
    this.line([hx + g2, hy, hx + L, hy], orange, 1, false, false);
    this.line([hx, hy - L, hx, hy - g2], orange, 1, false, false);
    this.line([hx, hy + g2, hx, hy + L], orange, 1, false, false);
    if (f.onsets.kick || f.onsets.snare) this.lasers = 0;
    if (this.lasers >= 0) {
      this.lasers += dt * 5;
      const t = Math.min(1, this.lasers * 1.5);
      for (const [x0, y0] of [[-A, -1], [A, -1], [-A, -0.6], [A, -0.6]]) {
        const xa = x0 + (hx - x0) * Math.max(0, t - 0.35), ya = y0 + (hy - y0) * Math.max(0, t - 0.35);
        const xb = x0 + (hx - x0) * t, yb = y0 + (hy - y0) * t;
        this.line([xa, ya, xb, yb], green, 1.2, false, false);
      }
      if (this.lasers > 1) this.lasers = -1;
    }
    // Shield blocks along the top and the score.
    const shields = 6 - (Math.floor(ctx.beat / 4) % 7);
    for (let k = 0; k < 6; k++) {
      const x = -0.35 + k * 0.12;
      this.line([x, 0.82, x + 0.09, 0.82, x + 0.09, 0.88, x, 0.88], k < shields ? green : orange, k < shields ? 0.9 : 0.3, true, false);
    }
    this.score = Math.floor(ctx.beat) * 25;
    this.text(String(this.score).padStart(6, '0'), A - 0.1, 0.82, 0.055, orange, 0.9, 'right');
    const w = this.words(ctx);
    if (w) this.text(w.toUpperCase().slice(0, 40), 0, -0.9, 0.05, yellow, 0.9, 'center');
  }

  // ── Laser show ──────────────────────────────────────────────────────────

  private tunnel = -1;

  private laser(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const dt = Math.min(0.05, ctx.dt) * num(p.speed, 1);
    const LASERS: RGB[] = [[0.1, 1, 0.15], [0.15, 0.3, 1], [1, 0.08, 0.05], [0.1, 0.9, 1], [1, 0.1, 0.9], [1, 0.75, 0.1]];
    const bpb = f.beatsPerBar || 4;
    const bar = Math.floor(ctx.beat / bpb);
    const c1 = this.colour(ctx, LASERS[bar % LASERS.length], bar);
    const c2 = this.colour(ctx, LASERS[(bar + 2) % LASERS.length], bar + 2);
    const haze = num(p.haze, 1);
    const phrase = Math.floor(ctx.beat / Math.max(4, f.beatsPerPhrase || 16));
    const ROUTINES = ['figure', 'sheet', 'cone', 'spiro', 'scan'];
    const fixed = String(p.routine ?? 'sequence');
    const routine = fixed !== 'sequence' && ROUTINES.includes(fixed) ? fixed : ROUTINES[phrase % ROUTINES.length];
    const ox = 0, oy = -1.05;
    const beam = (x: number, y: number, c: RGB, i: number, x0 = ox, y0 = oy): void => {
      // Extend the beam past the point so it reads as light through the room.
      const dx = x - x0, dy = y - y0, l = Math.hypot(dx, dy) || 1;
      this.line([x0, y0, x0 + (dx / l) * 3.4, y0 + (dy / l) * 3.4], c, i * haze, false, false);
    };
    const L = f.stereo.left, R = f.stereo.right;
    const wf = f.waveform;
    if (routine === 'figure') {
      const beams = 12, spread = 1.1 * (0.5 + ctx.env.energy * 0.8);
      const centre = Math.sin((ctx.beat * Math.PI) / 4) * 0.45;
      for (let k = 0; k < beams; k++) {
        const a = Math.PI / 2 + centre + (k / (beams - 1) - 0.5) * spread;
        beam(ox + Math.cos(a), oy + Math.sin(a), k % 2 ? c1 : c2, 0.25 + ctx.env.kick * 0.6);
      }
      const ratios = [[1, 2], [2, 3], [3, 4], [3, 5], [4, 5], [1, 3]];
      const [ra, rb] = ratios[bar % ratios.length];
      const n = 220, amp = 0.35 + ctx.env.bass * 0.3, ph = ctx.beat * 0.5;
      const xy: number[] = [];
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * Math.PI * 2, s = Math.floor((k / n) * (L.length - 1));
        xy.push(Math.sin(ra * t + ph) * amp * 1.2 + (L[s] ?? 0) * 0.18, 0.15 + Math.sin(rb * t) * amp + (R[s] ?? 0) * 0.18);
      }
      this.line(xy, c1, 1.1, false, false);
    } else if (routine === 'sheet') {
      // A sheet of light over the crowd: dozens of beams to a rippling edge.
      const n = 48, tilt = Math.sin(ctx.beat * 0.125) * 0.25;
      const edge: number[] = [];
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        const x = (u * 2 - 1) * 2.2;
        const s = Math.floor(u * (wf.length - 1));
        const y = 0.35 + tilt * (u * 2 - 1) + (wf[s] ?? 0) * 0.3 + Math.sin(u * 9 + ctx.beat * 1.5) * 0.04;
        edge.push(x, y);
        this.line([ox, oy + 0.35, x, y], c1, 0.13 * haze * (1 + ctx.env.kick), false, false);
      }
      this.line(edge, c1, 0.9, false, false);
    } else if (routine === 'cone') {
      // A tunnel of light: beams to a circle that breathes with the bass.
      const n = 40, cx = Math.sin(ctx.beat * 0.25) * 0.5, cy = 0.25 + Math.cos(ctx.beat * 0.19) * 0.2;
      const r = 0.25 + ctx.env.bass * 0.3 + ctx.env.kick * 0.08;
      const ring: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + ctx.beat * 0.5;
        const x = cx + Math.cos(a) * r * 1.2, y = cy + Math.sin(a) * r;
        ring.push(x, y);
        this.line([ox, oy + 0.2, x + (x - ox) * 0.6, y + (y - oy - 0.2) * 0.6], k % 2 ? c1 : c2, 0.16 * haze, false, false);
      }
      this.line(ring, c2, 1.1, true, false);
    } else if (routine === 'spiro') {
      // A spirograph whose wheel changes every bar.
      const Rr = 5, rr = 2 + (bar % 4), d = 2.2 + Math.sin(ctx.beat * 0.25) * 1.2;
      const n = 420, sc = 0.11 * (1 + ctx.env.bass * 0.3);
      const xy: number[] = [];
      const turns = rr / this.gcd(Rr, rr);
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * Math.PI * 2 * turns + ctx.beat * 0.1;
        xy.push(((Rr - rr) * Math.cos(t) + d * Math.cos(((Rr - rr) / rr) * t)) * sc * 1.15, 0.12 + ((Rr - rr) * Math.sin(t) - d * Math.sin(((Rr - rr) / rr) * t)) * sc);
      }
      this.line(xy, bar % 2 ? c1 : c2, 1, false, false);
      for (let k = 0; k < 4; k++) beam(xy[k * 100] ?? 0, xy[k * 100 + 1] ?? 0, c1, 0.18);
    } else {
      // Scanners: four projectors chasing in turns on the beat.
      const beat = Math.floor(ctx.beat), fr = ctx.beat - beat;
      for (let pj = 0; pj < 4; pj++) {
        const x0 = -1.2 + pj * 0.8, y0 = -1.05;
        const dir = (beat + pj) % 2 ? 1 : -1;
        const sweep = dir * (fr * 2 - 1) * 0.6;
        for (let k = 0; k < 5; k++) {
          const a = Math.PI / 2 + sweep + (k - 2) * 0.12;
          beam(x0 + Math.cos(a), y0 + Math.sin(a), pj % 2 ? c1 : c2, 0.3 + ctx.env.kick * 0.5, x0, y0);
        }
      }
    }
    // A cone of light on each phrase: rings racing outward.
    if (f.isPhraseStart || f.drop) this.tunnel = 0;
    if (this.tunnel >= 0) {
      this.tunnel += dt * 0.8;
      for (let r = 0; r < 4; r++) {
        const rad = (this.tunnel + r * 0.12) * 1.6;
        const ring: number[] = [];
        for (let k = 0; k < 48; k++) ring.push(Math.cos((k / 48) * Math.PI * 2) * rad * 1.1, 0.15 + Math.sin((k / 48) * Math.PI * 2) * rad);
        this.line(ring, c2, Math.max(0, 1 - this.tunnel) * 1.2, true, false);
      }
      if (this.tunnel > 1) this.tunnel = -1;
    }
    const w = this.words(ctx);
    if (w) this.text(w.toUpperCase().slice(0, 32), 0, -0.75, 0.09, c2, 1.1, 'center');
  }

  private gcd(a: number, b: number): number {
    return b ? this.gcd(b, a % b) : a;
  }

  // ── Fractal flyover ─────────────────────────────────────────────────────

  private flyZ = 0;
  private flyDrop = -99;

  /** Smooth value noise, then a ridged sum of octaves: sharp peaks like the early fractal films. */
  private noise(x: number, z: number): number {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const h = (i: number, j: number): number => hash01(i * 73856093 + j * 19349663, 5);
    const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }

  private ridge(x: number, z: number): number {
    let v = 0, amp = 0.55, fq = 0.2;
    for (let o = 0; o < 4; o++) {
      const n = 1 - Math.abs(this.noise(x * fq, z * fq) * 2 - 1);
      v += n * n * amp;
      amp *= 0.5;
      fq *= 2.1;
    }
    return v;
  }

  private fractal(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const A = this.aspect;
    const dt = Math.min(0.05, ctx.dt);
    const lo = this.colour(ctx, [0.1, 0.35, 1], 1);
    const hi = this.colour(ctx, [0.2, 1, 0.6], 2);
    const peak = this.colour(ctx, [1, 0.95, 0.8], 3);
    this.flyZ += dt * num(p.speed, 1) * (2.2 + ctx.env.energy * 3);
    if (f.drop) this.flyDrop = ctx.beat;
    const bpb = f.beatsPerBar || 4;
    const dd = (ctx.beat - this.flyDrop) / (2 * bpb);
    const rise = dd >= 0 && dd < 1 ? Math.sin(Math.PI * dd) : 0;
    const amp = (1.1 + ctx.env.bass * 0.8 + rise * 1.6) * num(p.peaks, 1);
    const cols = 40, rows = 38, step = 0.45;
    const z0 = Math.floor(this.flyZ / step);
    const camH = 1.35 + amp * 0.5, horizon = 0.32, focal = 1.25;
    const roll = Math.sin(ctx.beat * 0.25) * 0.08;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const proj = (x: number, y: number, z: number): [number, number] => {
      const sx0 = (x / z) * focal, sy0 = ((y - camH) / z) * focal;
      return [sx0 * cr - sy0 * sr, horizon + sx0 * sr + sy0 * cr];
    };
    const height = (x: number, z: number): number => {
      const h = this.ridge(x, z) * amp;
      // A valley down the middle so the flight path stays clear.
      return h * (0.35 + Math.min(1, Math.abs(x) / 2.5) * 0.65);
    };
    // Stars above the horizon.
    for (let k = 0; k < 70; k++) this.dot((hash01(k, 21) * 2 - 1) * A, horizon + 0.05 + hash01(k, 22) * 0.8, [0.8, 0.85, 1], 0.4 + 0.4 * hash01(k, 23));
    const grid: Array<Array<[number, number]>> = [];
    const hs: number[][] = [];
    for (let r = rows - 1; r >= 0; r--) {
      const zw = (z0 + r) * step;
      const zc = zw - this.flyZ + 0.6;
      const row: Array<[number, number]> = [];
      const hr: number[] = [];
      for (let c = 0; c < cols; c++) {
        const xw = (c - (cols - 1) / 2) * step * 1.1;
        const h = height(xw, zw);
        hr.push(h);
        row.push(zc > 0.3 ? proj(xw, h, zc) : [NaN, NaN]);
      }
      grid[r] = row;
      hs[r] = hr;
    }
    // Rows across, fading into the distance, coloured by how high they reach.
    for (let r = rows - 1; r >= 0; r--) {
      const fade = Math.min(1, (rows - r) / 14) * Math.min(1, r / 2);
      const xy: number[] = [];
      let top = 0;
      for (let c = 0; c < cols; c++) {
        if (Number.isNaN(grid[r][c][0])) continue;
        xy.push(grid[r][c][0], grid[r][c][1]);
        top = Math.max(top, hs[r][c]);
      }
      const col = top > amp * 0.75 ? peak : top > amp * 0.45 ? hi : lo;
      this.line(xy, col, 0.85 * fade, false, false);
    }
    // Lines along the flight, every other column.
    for (let c = 0; c < cols; c += 2) {
      const xy: number[] = [];
      for (let r = 0; r < rows; r++) if (!Number.isNaN(grid[r][c][0])) xy.push(grid[r][c][0], grid[r][c][1]);
      this.line(xy, lo, 0.45, false, false);
    }
    const w = this.words(ctx);
    if (w) this.text(w.toUpperCase().slice(0, 32), 0, 0.82, 0.06, peak, 1, 'center');
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const b = this.batch;
    b.setBlend('additive');
    b.begin();
    const t = this.thick * (target.height / Math.max(1, this.H));
    const pts = this.pts;
    const sub = this.tmp;
    for (const c of this.cmds) {
      const view = pts.subarray(c.start * 2, (c.start + c.count) * 2);
      const i = Math.min(2, c.i);
      if (i <= 0.01) continue;
      if (this.glow > 0) b.stroke(view, c.count, t * 4.5, c.r, c.g, c.b, 0.22 * this.glow * i, 1, c.closed);
      b.stroke(view, c.count, t, c.r * 1.5 + 0.2, c.g * 1.5 + 0.2, c.b * 1.5 + 0.2, i, 0, c.closed);
      if (c.dots) {
        // The beam lingers on each corner, so corners burn brighter.
        for (let k = 0; k < c.count; k++) {
          const x = view[k * 2], y = view[k * 2 + 1];
          sub[0] = x - t * 0.5;
          sub[1] = y;
          sub[2] = x + t * 0.5;
          sub[3] = y;
          b.stroke(sub, 2, t * 1.3, c.r + 0.5, c.g + 0.5, c.b + 0.5, 0.6 * i, 0, false);
        }
      }
    }
    b.draw(renderer, target, true);
    if (this.overlay) this.overlayPass.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [this.batch.compileTarget, this.overlayPass];
  }

  dispose(): void {
    this.batch.dispose();
    this.overlayPass.dispose();
  }
}
