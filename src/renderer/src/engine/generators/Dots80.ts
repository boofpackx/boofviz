import * as THREE from 'three';
import { FULLSCREEN_VERT, PALETTE_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { hdrTarget } from '../fx/effects';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * The late-80s demo dot effects, at a chunky resolution: hundreds of shaded
 * balls (or single pixels) forming a sphere, a torus, a cube, a double helix,
 * a rippling wave grid, a knot or a flower, turning in 3D and morphing into
 * the next shape at the end of every bar, a dot at a time. The shape swells
 * with the spectrum, pumps on the kick and bursts outward on the drop, over a
 * starfield. Tunnel: rings of dots flying at you, twisting with the beat.
 */

const DOTS = 1400;
const STARS = 260;
const TOTAL = DOTS + STARS;

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aInfo;              // x: kind (0 dot, 1 star), y: palette t
uniform float uAspect, uSize, uFocal, uLines, uDist;
out float vDepth;
out float vKind;
out float vT;
void main() {
  float z = position.z + uDist;
  vKind = aInfo.x;
  vT = aInfo.y;
  vDepth = z;
  if (z < 0.15) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec2 sp = position.xy * uFocal / z;
  sp.x /= uAspect;
  gl_Position = vec4(sp, clamp(z / 40.0, 0.0, 1.0) * 2.0 - 1.0, 1.0);
  gl_PointSize = aInfo.x > 0.5 ? 1.0 : max(1.0, uSize * uFocal / z * uLines * 0.5);
}
`;

const FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
in float vDepth;
in float vKind;
in float vT;
uniform float uStyle, uCycle, uFog, uKick;
out vec4 fragColor;
void main() {
  if (vKind > 0.5) {
    float b = clamp(1.6 - vDepth * 0.12, 0.15, 1.0);
    fragColor = vec4(vec3(b), 1.0);
    return;
  }
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  vec3 base = paletteWrap(vT + uCycle);
  float fog = exp(-max(0.0, vDepth - 2.0) * uFog);
  if (uStyle < 0.5) {
    // A shaded ball, lit from the upper left, with a hard highlight.
    if (r2 > 1.0) discard;
    vec3 n = vec3(c.x, -c.y, sqrt(1.0 - r2));
    vec3 l = normalize(vec3(-0.5, 0.6, 0.65));
    float d = max(dot(n, l), 0.0);
    float s = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
    vec3 col = base * (0.18 + 0.9 * d) + vec3(1.0) * s * 0.8;
    fragColor = vec4(col * fog * (1.0 + uKick * 0.25), 1.0);
  } else {
    // Flat dots: square pixels coloured by depth.
    fragColor = vec4(base * fog * 1.2 * (1.0 + uKick * 0.25), 1.0);
  }
}
`;

const UP = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(uTex, vUv); }
`;

type Shape = (i: number, n: number, out: Float32Array, o: number, ctx: GenContext) => void;

const SHAPES: Record<string, Shape> = {
  sphere: (i, n, out, o) => {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    out[o] = Math.cos(a) * r;
    out[o + 1] = y;
    out[o + 2] = Math.sin(a) * r;
  },
  torus: (i, n, out, o) => {
    const M = Math.round(Math.sqrt(n * 2.6));
    const a = ((i % M) / M) * Math.PI * 2, b = (Math.floor(i / M) / Math.ceil(n / M)) * Math.PI * 2;
    const R = 0.75 + 0.32 * Math.cos(b);
    out[o] = Math.cos(a) * R;
    out[o + 1] = Math.sin(b) * 0.32;
    out[o + 2] = Math.sin(a) * R;
  },
  cube: (i, n, out, o) => {
    const g = Math.max(2, Math.floor(Math.sqrt(n / 6)));
    const face = Math.floor(i / (g * g)) % 6, k = i % (g * g);
    const u = ((k % g) / (g - 1)) * 2 - 1, v = (Math.floor(k / g) / (g - 1)) * 2 - 1;
    const p = [[u, v, 1], [u, v, -1], [u, 1, v], [u, -1, v], [1, u, v], [-1, u, v]][face];
    out[o] = p[0] * 0.72;
    out[o + 1] = p[1] * 0.72;
    out[o + 2] = p[2] * 0.72;
  },
  helix: (i, n, out, o) => {
    const strand = i % 2, t = Math.floor(i / 2) / (n / 2);
    const a = t * Math.PI * 8 + strand * Math.PI;
    out[o] = Math.cos(a) * 0.55;
    out[o + 1] = (t * 2 - 1) * 1.1;
    out[o + 2] = Math.sin(a) * 0.55;
  },
  wave: (i, n, out, o, ctx) => {
    const g = Math.floor(Math.sqrt(n));
    const x = ((i % g) / (g - 1)) * 2 - 1, z = (Math.floor(i / g) / (g - 1)) * 2 - 1;
    const d = Math.hypot(x, z);
    const band = ctx.frame.bands32[Math.min(31, Math.floor(d * 22))] ?? 0;
    out[o] = x * 1.2;
    out[o + 1] = Math.sin(d * 7 - ctx.beat * Math.PI) * 0.12 + band * 0.45 - 0.2;
    out[o + 2] = z * 1.2;
  },
  knot: (i, n, out, o) => {
    const t = (i / n) * Math.PI * 2;
    const tube = ((i * 7) % 12) / 12 * Math.PI * 2;
    const x = Math.sin(t) + 2 * Math.sin(2 * t), y = Math.cos(t) - 2 * Math.cos(2 * t), z = -Math.sin(3 * t);
    out[o] = x * 0.3 + Math.cos(tube) * 0.08;
    out[o + 1] = y * 0.3 + Math.sin(tube) * 0.08;
    out[o + 2] = z * 0.3;
  },
  flower: (i, n, out, o) => {
    const y = 1 - (2 * (i + 0.5)) / n, r0 = Math.sqrt(1 - y * y), a = i * 2.399963;
    const th = Math.acos(y);
    const r = 0.7 + 0.3 * Math.sin(5 * a) * Math.sin(4 * th);
    out[o] = Math.cos(a) * r0 * r;
    out[o + 1] = y * r;
    out[o + 2] = Math.sin(a) * r0 * r;
  },
};
const ORDER = ['sphere', 'torus', 'cube', 'helix', 'wave', 'knot', 'flower'];

export class Dots80 implements Generator {
  readonly kind = 'dots80';
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos = new Float32Array(TOTAL * 3);
  private readonly info = new Float32Array(TOTAL * 2);
  private readonly a = new Float32Array(3);
  private readonly b = new Float32Array(3);
  private readonly mat: THREE.RawShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly up: FullscreenPass;
  private low: THREE.WebGLRenderTarget | null = null;
  private lines = 200;
  private aspect = 16 / 9;
  private dropAt = -99;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uAspect: { value: 16 / 9 },
        uSize: { value: 0.06 },
        uFocal: { value: 1.3 },
        uLines: { value: 200 },
        uDist: { value: 3.3 },
        uStyle: { value: 0 },
        uCycle: { value: 0 },
        uFog: { value: 0.35 },
        uKick: { value: 0 },
        uPal: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
      },
    });
    const points = new THREE.Points(this.geo, this.mat);
    points.frustumCulled = false;
    this.scene.add(points);
    for (let k = 0; k < TOTAL; k++) {
      this.info[k * 2] = k >= DOTS ? 1 : 0;
      this.info[k * 2 + 1] = k / DOTS;
    }
    this.up = new FullscreenPass(
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: UP, depthTest: false, depthWrite: false, uniforms: { uTex: { value: null } } }),
    );
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const u = this.mat.uniforms;
    this.aspect = ctx.width / Math.max(1, ctx.height);
    this.lines = Math.round(num(p.lines, 200));
    const pal = u.uPal.value as THREE.Vector3[];
    for (let i = 0; i < 5; i++) pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
    u.uAspect.value = this.aspect;
    u.uLines.value = this.lines;
    u.uSize.value = num(p.size, 0.06);
    u.uStyle.value = p.style === 'pixels' ? 1 : 0;
    u.uKick.value = ctx.env.kick;
    u.uCycle.value = ctx.beat * num(p.cycle, 0.05);
    const n = Math.max(100, Math.min(DOTS, Math.round(num(p.dots, 900))));
    if (f.drop) this.dropAt = ctx.beat;
    const bpb = f.beatsPerBar || 4;
    const pos = this.pos;
    if (p.scene === 'tunnel') this.tunnel(ctx, n);
    else {
      // Shapes in a phrase-shuffled order, the next one morphing in over the end of the bar.
      const bars = Math.max(1, Math.round(num(p.barsPerShape, 1)));
      const unit = bpb * bars;
      const idx = Math.floor(ctx.beat / unit);
      const pick = (k: number): string => {
        const list = String(p.shapes ?? 'all') === 'all' ? ORDER : String(p.shapes).split(',').map((s) => s.trim()).filter((s) => SHAPES[s]);
        const L = list.length ? list : ORDER;
        return L[Math.floor(hash01(k, 91) * L.length)];
      };
      const A = SHAPES[pick(idx)], B = SHAPES[pick(idx + 1)];
      const morphBeats = Math.min(unit, num(p.morphBeats, 1));
      const m = (ctx.beat - idx * unit - (unit - morphBeats)) / morphBeats;
      const spin = num(p.spin, 1);
      const yaw = ctx.time * 0.45 * spin, pitch = Math.sin(ctx.time * 0.31) * 0.55 + 0.25, roll = Math.sin(ctx.time * 0.17) * 0.2;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const dt = (ctx.beat - this.dropAt) / (2 * bpb);
      const burst = dt >= 0 && dt < 1 ? Math.sin(Math.PI * dt) * 1.4 : 0;
      const react = num(p.react, 1);
      const pump = 1 + ctx.env.kick * 0.1 * react;
      for (let i = 0; i < n; i++) {
        A(i, n, this.a, 0, ctx);
        B(i, n, this.b, 0, ctx);
        let t = Math.min(1, Math.max(0, m * 1.6 - (i / n) * 0.6));
        t = t * t * (3 - 2 * t);
        let x = this.a[0] + (this.b[0] - this.a[0]) * t;
        let y = this.a[1] + (this.b[1] - this.a[1]) * t;
        let z = this.a[2] + (this.b[2] - this.a[2]) * t;
        // The spectrum swells the shape in bands by height, so it ripples as one.
        const band = f.bands32[Math.min(29, Math.max(0, Math.floor(((y + 1.1) / 2.2) * 28)))] ?? 0;
        const s = pump * (1 + band * 0.16 * react + burst * (0.5 + hash01(i, 5)));
        this.info[i * 2 + 1] = (y + 1.2) * 0.3;
        x *= s;
        y *= s;
        z *= s;
        // Turn: yaw, pitch, roll.
        const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        pos[i * 3] = x1 * cr - y2 * sr;
        pos[i * 3 + 1] = x1 * sr + y2 * cr;
        pos[i * 3 + 2] = z2;
      }
      this.mat.uniforms.uDist.value = 2.1 / Math.max(0.3, num(p.zoom, 1));
    }
    for (let i = n; i < DOTS; i++) pos[i * 3 + 2] = -99;
    // Stars streaming past.
    const sp2 = num(p.stars, 1);
    for (let k = 0; k < STARS; k++) {
      const o = (DOTS + k) * 3;
      const z = 14 - ((hash01(k, 1) + ctx.time * 0.06 * sp2 * (1 + ctx.env.energy)) % 1) * 13.5;
      pos[o] = (hash01(k, 2) * 2 - 1) * 9 * this.aspect * (sp2 > 0 ? 1 : 0);
      pos[o + 1] = (hash01(k, 3) * 2 - 1) * 9;
      pos[o + 2] = sp2 > 0 ? z - this.mat.uniforms.uDist.value + 3.3 : -99;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Rings of dots flying at the camera, the tunnel bending and twisting on the beat. */
  private tunnel(ctx: GenContext, n: number): void {
    const p = ctx.params;
    const per = 32;
    const rings = Math.floor(n / per);
    const gap = 0.32;
    const T = ctx.beat * num(p.spin, 1) * 1.2;
    const first = Math.floor(T / gap);
    for (let r = 0; r < rings; r++) {
      const id = first + r;
      const z = id * gap - T;
      const far = z / (rings * gap);
      const bend = Math.sin(id * 0.07 + ctx.beat * 0.25) * 3.2 * far * far;
      const bendY = Math.cos(id * 0.05 + ctx.beat * 0.2) * 2.2 * far * far;
      const twist = id * 0.16 + ctx.beat * 0.4;
      const radius = 1 + (ctx.frame.bands32[((id % 30) + 30) % 30] ?? 0) * 0.35 + ctx.env.kick * 0.08;
      for (let k = 0; k < per; k++) {
        const i = r * per + k;
        const a = (k / per) * Math.PI * 2 + twist;
        this.pos[i * 3] = Math.cos(a) * radius + bend;
        this.pos[i * 3 + 1] = Math.sin(a) * radius + bendY;
        this.pos[i * 3 + 2] = z - 3;
        // Colour stripes travel down the tunnel a ring at a time.
        this.info[i * 2 + 1] = (((Math.floor(id / 3) * 0.23) % 1) + 1) % 1;
      }
    }
    for (let i = rings * per; i < n; i++) this.pos[i * 3 + 2] = -99;
    this.mat.uniforms.uDist.value = 3.3;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const H = Math.max(60, Math.min(target.height, this.lines));
    const W = Math.max(60, Math.round(H * (target.width / Math.max(1, target.height))));
    if (!this.low || this.low.width !== W || this.low.height !== H) {
      this.low?.dispose();
      this.low = hdrTarget(W, H, true);
      this.low.texture.minFilter = THREE.NearestFilter;
      this.low.texture.magFilter = THREE.NearestFilter;
    }
    this.geo.setDrawRange(0, TOTAL);
    renderer.setRenderTarget(this.low);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    this.up.material.uniforms.uTex.value = this.low.texture;
    this.up.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [{ scene: this.scene, camera: this.camera }, this.up];
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.up.dispose();
    this.low?.dispose();
  }
}
