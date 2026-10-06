import * as THREE from 'three';
import { PALETTE_GLSL, UTIL_GLSL } from '../shaders/common';
import { BarAnalyzer } from './barAnalyzer';
import type { GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

const MAX = 64;

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 aCell;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D uHist;
uniform float uHead, uFrac, uRows, uCols, uSpacing, uHeight, uGap, uVisible;
out vec3 vNormal;
out vec3 vWorld;
out vec2 vFace;
out float vH;
out float vCol;
out float vAge;
void main() {
  float col = aCell.x;
  float row = aCell.y;
  float age = mod(uHead - row + uRows, uRows);
  float h = texelFetch(uHist, ivec2(int(col), int(row)), 0).r;
  float height = 0.01 + h * uHeight;
  float w = uSpacing * (1.0 - uGap);
  vec3 world = vec3(
    (col - uCols * 0.5 + 0.5) * uSpacing + position.x * w,
    (position.y + 0.5) * height,
    -(age + uFrac) * uSpacing + position.z * w);
  // Collapse unused columns and rows that have scrolled past the far end.
  if (col >= uCols || age >= uVisible - 1.0) world = vec3(0.0, -100.0, 0.0);
  vNormal = normal;
  vWorld = world;
  vFace = abs(normal.x) > 0.5 ? vec2(world.z, world.y) : vec2(world.x, world.y);
  vH = h;
  vCol = col / max(uCols - 1.0, 1.0);
  vAge = age / uRows;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
${UTIL_GLSL}
uniform float uFog, uWindows, uGlow, uKick, uSpacing;
uniform vec3 uCam;
in vec3 vNormal;
in vec3 vWorld;
in vec2 vFace;
in float vH;
in float vCol;
in float vAge;
out vec4 fragColor;
void main() {
  vec3 base = palette(0.25 + 0.7 * vCol);
  vec3 col;
  if (vNormal.y > 0.5) {
    col = base * (1.2 + 3.0 * vH + 1.2 * uKick);                 // glowing roof
  } else {
    col = base * (0.06 + 0.25 * vH);
    // Window grid on the side faces.
    vec2 g = vFace / uSpacing * vec2(4.0, 10.0);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
    float lit = step(hash21(cell + floor(vCol * 64.0) * 13.1), uWindows * (0.35 + vH));
    col += palette(0.95) * win * lit * (0.6 + 0.8 * vH) * uGlow;
    // Bright vertical edge so silhouettes read.
    col += base * pow(1.0 - min(min(f.x, 1.0 - f.x) * 4.0, 1.0), 6.0) * 0.4 * uGlow;
  }
  float dist = length(vWorld - uCam);
  vec3 fogCol = uPal[1] * 0.12;
  col = mix(col, fogCol, 1.0 - exp(-dist * uFog * 0.35));
  fragColor = vec4(col, 1.0);
}
`;

const GROUND_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
void main() {
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
uniform float uSpacing, uFrac, uFog, uKick, uBass;
uniform vec3 uCam;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  vec2 g = vec2(vWorld.x / uSpacing + 0.5, vWorld.z / uSpacing + uFrac);
  vec2 d = abs(fract(g) - 0.5);
  vec2 w = fwidth(g) * 1.2;
  float line = max(1.0 - smoothstep(0.5 - w.x, 0.5, d.x), 1.0 - smoothstep(0.5 - w.y, 0.5, d.y));
  vec3 col = uPal[0] * 0.05 + palette(0.55) * line * (0.15 + 0.4 * uBass + 0.4 * uKick);
  float dist = length(vWorld - uCam);
  col = mix(col, uPal[1] * 0.12, 1.0 - exp(-dist * uFog * 0.35));
  fragColor = vec4(col, 1.0);
}
`;

/** Spectrum history extruded into a glowing city, with a beat-locked camera swing. */
export class BarCity implements Generator {
  readonly kind = 'barCity';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 100);
  private readonly hist = new Float32Array(MAX * MAX);
  private readonly tex: THREE.DataTexture;
  private readonly mat: THREE.RawShaderMaterial;
  private readonly groundMat: THREE.RawShaderMaterial;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly bars = new BarAnalyzer(MAX);
  private head = 0;
  private nextPush = 0;
  private cols = 32;
  private rows = 40;
  private readonly spacing = 0.2;

  constructor() {
    this.tex = new THREE.DataTexture(this.hist, MAX, MAX, THREE.RedFormat, THREE.FloatType);
    this.tex.needsUpdate = true;
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = box.index;
    this.geo.setAttribute('position', box.getAttribute('position'));
    this.geo.setAttribute('normal', box.getAttribute('normal'));
    const cells = new Float32Array(MAX * MAX * 2);
    for (let r = 0; r < MAX; r++) for (let c = 0; c < MAX; c++) cells.set([c, r], (r * MAX + c) * 2);
    this.geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));

    const pal = { value: Array.from({ length: 5 }, () => new THREE.Vector3()) };
    const cam = { value: new THREE.Vector3() };
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uHist: { value: this.tex },
        uHead: { value: 0 },
        uFrac: { value: 0 },
        uRows: { value: MAX },
        uVisible: { value: 40 },
        uCols: { value: 32 },
        uSpacing: { value: this.spacing },
        uHeight: { value: 1.4 },
        uGap: { value: 0.25 },
        uFog: { value: 0.5 },
        uWindows: { value: 0.6 },
        uGlow: { value: 1 },
        uKick: { value: 0 },
        uPal: pal,
        uCam: cam,
      },
    });
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.groundMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: { uSpacing: { value: this.spacing }, uFrac: { value: 0 }, uFog: { value: 0.5 }, uKick: { value: 0 }, uBass: { value: 0 }, uPal: pal, uCam: cam },
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2).translate(0, -0.001, -10), this.groundMat);
    this.scene.add(ground);
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const { frame, env } = ctx;
    this.cols = Math.max(8, Math.min(MAX, Math.round(num(p.columns, 32))));
    this.rows = Math.max(8, Math.min(MAX, Math.round(num(p.rows, 40))));
    this.bars.update(frame.fft, this.cols, ctx.dt, { release: 0.12, reactivity: ctx.globals.reactivity, silence: frame.silence, fHi: 12000 });

    // Push a row every 1/speed beats on the shared audio clock.
    const speed = num(p.speed, 1);
    const interval = speed > 0 ? 60 / Math.max(40, frame.bpm) / speed : Infinity;
    const t = frame.time;
    if (Math.abs(t - this.nextPush) > 2) this.nextPush = t;
    let pushed = 0;
    while (t >= this.nextPush && pushed < 4) {
      const row = this.head % MAX;
      for (let c = 0; c < MAX; c++) this.hist[row * MAX + c] = c < this.cols ? this.bars.heights[c] : 0;
      this.head++;
      this.nextPush += interval;
      pushed++;
    }
    if (pushed) this.tex.needsUpdate = true;
    // Live row: the newest row follows the music between pushes.
    const live = (this.head - 1 + MAX) % MAX;
    for (let c = 0; c < this.cols; c++) this.hist[live * MAX + c] = Math.max(this.hist[live * MAX + c] * 0.9, this.bars.heights[c]);
    this.tex.needsUpdate = true;
    const frac = Number.isFinite(interval) ? Math.min(1, Math.max(0, 1 - (this.nextPush - t) / interval)) : 0;

    const u = this.mat.uniforms;
    // The ring holds MAX rows; map the visible window onto it.
    u.uHead.value = live;
    u.uFrac.value = frac;
    u.uRows.value = MAX;
    u.uVisible.value = this.rows;
    u.uCols.value = this.cols;
    u.uHeight.value = num(p.height, 1.4);
    u.uGap.value = num(p.gap, 0.25);
    u.uFog.value = num(p.fog, 0.5) * (40 / this.rows);
    u.uWindows.value = num(p.windows, 0.6);
    u.uGlow.value = num(p.glow, 1);
    u.uKick.value = env.kick;
    const pal = u.uPal.value as THREE.Vector3[];
    for (let i = 0; i < 5; i++) pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
    const g = this.groundMat.uniforms;
    g.uFrac.value = frac;
    g.uFog.value = u.uFog.value;
    g.uKick.value = env.kick;
    g.uBass.value = env.bass;

    // Camera: slow phrase-long swing, beat breathing, kick FOV punch.
    const swing = num(p.swing, 0.3);
    const phrase = ctx.beat / Math.max(1, frame.beatsPerPhrase);
    const width = this.cols * this.spacing;
    const camH = num(p.camHeight, 1);
    const cx = Math.sin(phrase * Math.PI * 2) * swing * width * 0.35;
    const cy = 0.18 + camH * 0.55 + 0.02 * Math.sin(ctx.beat * Math.PI * 2);
    const cz = 0.55 + 0.15 * Math.cos(phrase * Math.PI * 2) * swing;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(cx * 0.2, 0.32, -this.rows * this.spacing * 0.75);
    this.camera.aspect = ctx.width / Math.max(1, ctx.height);
    this.camera.fov = 55 - 5 * env.kick;
    this.camera.updateProjectionMatrix();
    (u.uCam.value as THREE.Vector3).copy(this.camera.position);
    this.geo.instanceCount = MAX * MAX;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.groundMat.dispose();
    this.tex.dispose();
  }
}
