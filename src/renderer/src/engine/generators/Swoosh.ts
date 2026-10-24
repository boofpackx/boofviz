import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Trance Swoosh: 2000s trance compilation art. A glowing core on deep blue,
 * electric light swooshes sweeping round it on tilted orbits (thin at the
 * tail, bright at the head), each launched on a kick and fading over a bar;
 * a long horizontal anamorphic lens streak through the core that flashes on
 * the snare, starburst rays on the drop, hairline orbit rings and a faint
 * hexagon grid fading in and out with the phrase. Everything over-glowed.
 *
 * Colours: stop 1 the deep background, 2 and 3 the swooshes, 4 the core.
 */

const MAX = 8;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform vec4 uSw[${MAX}];    // radius x, radius y (tilt), rotation, colour t
uniform vec4 uSt[${MAX}];    // head angle, length (radians), brightness, width
uniform float uCore, uStreak, uBurst, uHex, uRings, uAspect;

float hexGrid(vec2 p) {
  p *= 9.0;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 a = mod(p, r) - r * 0.5, b = mod(p - r * 0.5, r) - r * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  float d = max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x);
  return smoothstep(0.03, 0.0, abs(d - 0.5));
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r = length(p);
  // Deep background with a lighter middle.
  vec3 col = mix(uPal[1] * 0.35, uPal[0], smoothstep(0.0, 0.9, r));
  col += mix(uPal[2], uPal[4], 0.5) * 0.25 * exp(-r * r * 6.0);
  // Faint hexagon grid, strongest away from the core.
  col += uPal[2] * 0.06 * uHex * hexGrid(p) * smoothstep(0.1, 0.6, r);
  // Swooshes.
  for (int i = 0; i < ${MAX}; i++) {
    vec4 s = uSw[i];
    vec4 t = uSt[i];
    if (t.z <= 0.001) continue;
    vec2 q = rot2(-s.z) * p;
    vec2 e = q / s.xy;
    float er = length(e);
    float ang = atan(e.y, e.x);
    // How far behind the head this point is along the arc (0 at the head).
    float behind = mod(t.x - ang, 6.2831853);
    if (behind > t.y) continue;
    float u = behind / t.y;
    float w = t.w * (1.0 - u) * (1.0 - u) + 0.0008;
    float d = abs(er - 1.0) * min(s.x, s.y);
    vec3 c = palette(0.45 + 0.5 * s.w);
    float core = exp(-d * d / (w * w * 0.25));
    float glow = exp(-d * d / (w * w * 6.0));
    col += (c * glow * 0.6 + mix(c, vec3(1.0), 0.6) * core) * t.z * (1.0 - u * 0.6);
  }
  // Hairline orbit rings.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = rot2(-0.3 - fi * 0.5) * p;
    vec2 rad = vec2(0.32 + fi * 0.12, (0.32 + fi * 0.12) * (0.25 + fi * 0.08));
    float d = abs(length(q / rad) - 1.0) * rad.y;
    col += uPal[2] * 0.25 * uRings * smoothstep(0.0012, 0.0, d);
  }
  // The core.
  col += mix(uPal[4], vec3(1.0), 0.5) * (exp(-r * r * 900.0) * 3.0 + exp(-r * r * 60.0) * 0.8) * uCore;
  // Anamorphic streak: long, thin, horizontal.
  col += mix(uPal[2], vec3(1.0), 0.3) * exp(-p.y * p.y * 9000.0) * exp(-abs(p.x) * 1.4) * uStreak;
  // Starburst rays.
  if (uBurst > 0.001) {
    float a = atan(p.y, p.x);
    float rays = pow(abs(cos(a * 6.0)), 60.0) + pow(abs(cos(a * 6.0 + 1.5708)), 200.0) * 0.6;
    col += mix(uPal[4], vec3(1.0), 0.6) * rays * exp(-r * 2.5) * uBurst * 1.5;
  }
  fragColor = vec4(col, 1.0);
}
`;

interface Sw { born: number; rx: number; ry: number; rot: number; ct: number; speed: number; dir: number; start: number }

export class Swoosh extends ShaderGenerator {
  readonly kind = 'swoosh';
  private readonly sw = Array.from({ length: MAX }, () => new THREE.Vector4());
  private readonly st = Array.from({ length: MAX }, () => new THREE.Vector4());
  private live: Sw[] = [];
  private dropAt = -99;
  private snare = 0;
  private count = 0;

  constructor() {
    super(FRAG, {
      uSw: { value: [] as THREE.Vector4[] },
      uSt: { value: [] as THREE.Vector4[] },
      uCore: { value: 1 },
      uStreak: { value: 0.5 },
      uBurst: { value: 0 },
      uHex: { value: 0 },
      uRings: { value: 1 },
      uAspect: { value: 16 / 9 },
    });
    this.u.uSw.value = this.sw;
    this.u.uSt.value = this.st;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const f = ctx.frame;
    const u = this.u;
    const bpb = f.beatsPerBar || 4;
    const bpp = Math.max(4, f.beatsPerPhrase || 16);
    const life = bpb * num(p.life, 1);
    // A new swoosh on each kick (not too many at once; one slow one in the breakdown).
    const quiet = ctx.env.energy < 0.18;
    if ((f.onsets.kick || (this.live.length === 0 && Math.floor(ctx.beat) % 2 === 0)) && this.live.length < (quiet ? 1 : MAX)) {
      const k = this.count++;
      const tilt = 0.18 + hash01(k, 2) * 0.55;
      const rx = 0.22 + hash01(k, 1) * 0.35;
      this.live.push({ born: ctx.beat, rx, ry: rx * tilt, rot: (hash01(k, 3) - 0.5) * 1.2 + Math.floor(ctx.beat / bpp) * 0.4, ct: hash01(k, 4), speed: (1.4 + hash01(k, 5) * 1.6) * num(p.speed, 1) * (f.energyTrend === 'building' ? 1.5 : 1), dir: hash01(k, 6) < 0.5 ? 1 : -1, start: hash01(k, 7) * Math.PI * 2 });
    }
    this.live = this.live.filter((s) => ctx.beat - s.born < life);
    if (f.drop) this.dropAt = ctx.beat;
    const burst = Math.max(0, 1 - (ctx.beat - this.dropAt) / bpb);
    for (let i = 0; i < MAX; i++) {
      const s = this.live[i];
      if (!s) {
        this.st[i].set(0, 0, 0, 0);
        continue;
      }
      const age = (ctx.beat - s.born) / life;
      const head = s.start + s.dir * age * s.speed * Math.PI;
      const len = Math.min(Math.PI * 1.4, 0.4 + age * 4) * num(p.length, 1);
      const bright = Math.sin(Math.PI * Math.min(1, age * 1.15)) * (1 + burst);
      this.sw[i].set(s.rx, s.ry, s.rot, s.ct);
      // The shader measures "behind the head" one way round, so a reversed swoosh flips its ellipse.
      if (s.dir < 0) this.sw[i].set(s.rx, -s.ry, s.rot, s.ct);
      this.st[i].set(s.dir < 0 ? -head : head, len, bright, 0.012 * num(p.width, 1));
    }
    this.snare = Math.max(ctx.env.snare, this.snare - ctx.dt * 3);
    u.uCore.value = 0.7 + ctx.env.bass * 0.7 + burst;
    u.uStreak.value = (0.35 + this.snare * 1.4 + burst) * num(p.streak, 1);
    u.uBurst.value = burst;
    const phase = (ctx.beat % bpp) / bpp;
    u.uHex.value = Math.sin(Math.PI * phase) * num(p.hex, 1);
    u.uRings.value = num(p.rings, 1);
    u.uAspect.value = ctx.width / Math.max(1, ctx.height);
  }
}
