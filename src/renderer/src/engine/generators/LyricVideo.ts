import * as THREE from 'three';
import { lineIndexAt } from '@shared/lyrics';
import { currentLines, lyricsFeed, songPositionMs } from '../lyricsFeed';
import { sdfAtlas, type SdfAtlas } from '../text/sdfAtlas';
import type { CompileTarget, GenContext, Generator } from './Generator';
import type { LyricsRenderInfo } from './Lyrics';
import { layoutFor, layoutLine, LYRIC_STYLES, poseLetter, timeWords, type LineLayout, type LyricStyle, type TimedLine } from './lyricVideoMotion';
import { num } from './ShaderGenerator';

const MAX = 2048;
const FOV = 35;
const CAM_Z = 12;

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
in mat4 instanceMatrix;
in vec4 aUv;
in vec4 aCol;
in vec2 aKind;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
out vec4 vCol;
out vec2 vKind;
void main() {
  vUv = mix(aUv.xy, aUv.zw, vec2(uv.x, 1.0 - uv.y));
  vCol = aCol;
  vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform float uOutline, uGlow, uShadow;
uniform vec3 uOutlineCol, uGlowCol;
in vec2 vUv;
in vec4 vCol;
in vec2 vKind;
out vec4 fragColor;
void main() {
  // Signed distance: > 0 inside the glyph; ±0.5 spans the field's spread.
  float d = texture(uAtlas, vUv).r - 0.5;
  float w = max(fwidth(d), 1e-4) * 0.75;
  float face = smoothstep(-w, w, d);
  float cover = face;
  vec3 col = vCol.rgb;
  if (uOutline > 0.0) {
    cover = smoothstep(-w, w, d + uOutline * 0.32);
    col = mix(uOutlineCol, col, face);
  }
  vec3 rgb = col * cover;
  float a = cover;
  if (vKind.x < 0.5) {
    // Face layer only: a tight light glow and a dark soft shadow, both from the distance field;
    // the shadow keeps words readable over busy looks.
    float halo = smoothstep(-0.32, 0.0, d) * (1.0 - cover);
    rgb += uGlowCol * halo * (uGlow + vKind.y) * 0.6;
    a = max(a, halo * uShadow);
  }
  fragColor = vec4(rgb, a) * vCol.a;
}
`;

/** Lyric-video style that suits a look's category ('auto'). */
const AUTO_STYLE: Record<string, LyricStyle> = {
  Equalizers: 'slam',
  '2D Graphic': 'stack',
  '3D Worlds': 'orbit3d',
  'Trippy / Psychedelic': 'wave',
  'Mellow / Ambient': 'zoomthrough',
  'Retro / Glitch': 'glitch',
  'Club / Strobe': 'slam',
  'Logo / Branding': 'spin3d',
  'Icons & Homages': 'stack',
  'Pop Culture': 'drop',
  'Real 90s': 'flip',
  'Y2K & Aero': 'pop',
  Lyrics: 'drop',
};

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/**
 * Music-video lyrics: every letter is its own object in a 3D scene, posed by
 * a style (dropping in, slamming, shuffling into place, flipping, spinning,
 * flying through the camera, stacking, orbiting...) on the sung timing of its
 * word, with chunky extruded depth and crisp distance-field glyphs.
 */
export class LyricVideo implements Generator {
  readonly kind = 'lyricVideo';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100);
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly mat: THREE.RawShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly aUv = new Float32Array(MAX * 4);
  private readonly aCol = new Float32Array(MAX * 4);
  private readonly aKind = new Float32Array(MAX * 2);
  private readonly uvAttr: THREE.InstancedBufferAttribute;
  private readonly colAttr: THREE.InstancedBufferAttribute;
  private readonly kindAttr: THREE.InstancedBufferAttribute;
  private atlas: SdfAtlas | null = null;
  private font = '';
  private readonly layouts = new Map<string, LineLayout>();
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Matrix4();
  private readonly e = new THREE.Euler();
  private readonly mm = new THREE.Matrix4();
  // Draw pool (reused every frame) and its back-to-front order.
  private readonly pool: Array<{ z: number; m: Float32Array; uv: Float32Array; col: Float32Array; kind: Float32Array }> = [];
  private readonly order: number[] = [];
  private drawCount = 0;
  /** What it showed last frame (debug hooks), shaped like the classic lyrics generator's. */
  info: LyricsRenderInfo = { index: -1, text: '', card: false, positionMs: 0 };

  constructor() {
    this.uvAttr = new THREE.InstancedBufferAttribute(this.aUv, 4).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.InstancedBufferAttribute(this.aCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.kindAttr = new THREE.InstancedBufferAttribute(this.aKind, 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aUv', this.uvAttr);
    this.geo.setAttribute('aCol', this.colAttr);
    this.geo.setAttribute('aKind', this.kindAttr);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uAtlas: { value: null },
        uOutline: { value: 0 },
        uGlow: { value: 0.2 },
        uShadow: { value: 0.6 },
        uOutlineCol: { value: new THREE.Vector3() },
        uGlowCol: { value: new THREE.Vector3(1, 1, 1) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
    // A slight three-quarter view, so the letters' extruded sides show.
    this.camera.position.set(1.1, 0.8, CAM_Z);
    this.camera.lookAt(0, 0, 0);
  }

  /** The lines on screen now: the sung line, plus the previous one while it animates out. */
  private lines(ctx: GenContext, upper: boolean, speed: number): { list: Array<{ line: TimedLine; seed: number }>; now: number; card: boolean; index: number } {
    const p = ctx.params;
    const source = String(p.source ?? 'lyrics');
    const fix = (s: string): string => (upper ? s.toUpperCase() : s);
    const synced = source === 'lyrics' && lyricsFeed.now.connected ? currentLines() : null;
    if (synced?.length) {
      const posMs = songPositionMs(Date.now(), num(p.lead, 120));
      const i = lineIndexAt(synced, posMs);
      if (i >= 0) {
        const now = posMs / 1000;
        const list: Array<{ line: TimedLine; seed: number }> = [];
        const at = (k: number): TimedLine => {
          const l = synced[k];
          const start = l.t / 1000;
          const end = synced[k + 1] ? synced[k + 1].t / 1000 : start + 4;
          return timeWords(fix(l.text || '♪'), start, end, l.words);
        };
        if (i > 0 && now - synced[i].t / 1000 < 0.6 / speed) list.push({ line: at(i - 1), seed: i - 1 });
        list.push({ line: at(i), seed: i });
        return { list, now, card: false, index: i };
      }
    }
    // No sung line: the song title while a track plays, else the look's own words, a line every few beats.
    const np = lyricsFeed.now;
    const titled = source !== 'text' && np.connected && np.trackId;
    const text = titled ? `${np.title} / ${np.artists.join(', ')}` : String(p.text ?? 'BOOFVIZ / LYRIC VIDEO');
    const rows = text.split('/').map((s) => s.trim()).filter(Boolean);
    const lineBeats = Math.max(1, num(p.lineBeats, 8));
    const spb = 60 / Math.max(40, ctx.frame.bpm || 120);
    const now = ctx.beat * spb;
    const idx = Math.floor(ctx.beat / lineBeats);
    const make = (k: number): TimedLine => {
      const start = k * lineBeats * spb;
      return timeWords(fix(rows[((k % rows.length) + rows.length) % rows.length] || ' '), start, start + lineBeats * spb);
    };
    const list: Array<{ line: TimedLine; seed: number }> = [];
    if (now - idx * lineBeats * spb < 0.6 / speed) list.push({ line: make(idx - 1), seed: idx - 1 });
    list.push({ line: make(idx), seed: idx });
    return { list, now, card: !!titled, index: -1 };
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const font = String(p.font ?? 'heavy');
    if (font !== this.font || !this.atlas) {
      this.font = font;
      this.atlas = sdfAtlas(font);
      this.mat.uniforms.uAtlas.value = this.atlas.texture;
      this.layouts.clear();
    }
    const atlas = this.atlas;
    const chosen = String(p.style ?? 'auto');
    const style: LyricStyle = (LYRIC_STYLES as readonly string[]).includes(chosen) ? (chosen as LyricStyle) : (AUTO_STYLE[ctx.category ?? ''] ?? 'drop');
    const speed = Math.max(0.25, num(p.speed, 1));
    const upper = p.uppercase !== false;
    const { list, now, card, index } = this.lines(ctx, upper, speed);

    // Scale: size 1 puts the cap height at ~10% of the frame; long lines shrink to fit.
    this.camera.aspect = ctx.width / Math.max(1, ctx.height);
    this.camera.updateProjectionMatrix();
    const viewH = 2 * CAM_Z * Math.tan((FOV * Math.PI) / 360);
    const viewW = viewH * this.camera.aspect;
    const kBase = (viewH * 0.1 * num(p.size, 1)) / atlas.cap;
    const pos = String(p.position ?? 'center');
    const blockY = pos === 'lower' ? -viewH * 0.24 : pos === 'upper' ? viewH * 0.24 : 0;
    const advance = (ch: string): number => atlas.glyphs.get(ch)?.advance ?? atlas.glyphs.get('?')!.advance;
    const depthLayers = Math.round(Math.max(0, Math.min(1, num(p.depth, 0.5))) * 10);
    const dz = 0.04;
    const dimPast = Math.max(0, Math.min(1, num(p.dimPast, 0.25)));
    const pal = ctx.palette;
    const mode = String(p.colorMode ?? 'palette');
    const stop = (i: number): [number, number, number] => [pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]];
    const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const glowCol = mix3(stop(3), stop(4), 0.5);
    (this.mat.uniforms.uGlowCol.value as THREE.Vector3).set(...glowCol);
    (this.mat.uniforms.uOutlineCol.value as THREE.Vector3).set(...mix3(stop(0), [0, 0, 0], 0.6));
    this.mat.uniforms.uOutline.value = num(p.outline, 0);
    this.mat.uniforms.uGlow.value = num(p.glow, 0.2);
    this.mat.uniforms.uShadow.value = num(p.shadow, 0.6);

    this.drawCount = 0;
    for (const { line, seed } of list) {
      const words = line.words.map((w) => w.text);
      const lmode = layoutFor(style);
      const maxW = (viewW * 0.86) / kBase;
      const key = `${style}|${seed}|${line.text}|${maxW.toFixed(1)}`;
      let lay = this.layouts.get(key);
      if (!lay) {
        lay = layoutLine(words, advance, lmode, maxW, seed);
        this.layouts.set(key, lay);
        if (this.layouts.size > 64) this.layouts.delete(this.layouts.keys().next().value!);
      }
      const fit = lmode === 'flow' || lmode === 'stack' ? Math.min(1, (viewW * 0.88) / Math.max(1e-3, lay.width * kBase), (viewH * 0.8) / Math.max(1e-3, lay.height * kBase)) : 1;
      const k = kBase * fit;
      let current = -1;
      line.words.forEach((w, i) => {
        if (now >= w.start) current = i;
      });
      const motion = { now, line, kick: ctx.env.kick * num(p.punch, 1), beat: ctx.beat, spb: 60 / Math.max(40, ctx.frame.bpm || 120), speed, seed, current };
      for (const L of lay.letters) {
        if (L.ch === ' ') continue;
        const g = atlas.glyphs.get(L.ch) ?? atlas.glyphs.get('?')!;
        const pose = poseLetter(style, L, lay.words[L.word], motion);
        if (pose.a <= 0.003 || pose.s <= 1e-3) continue;
        // Colour: palette highlight, a gradient across the line, white, or a rainbow; past words dim a little.
        // Bright faces, sides in the look's colour (the classic lyric-video build).
        let face: [number, number, number];
        let side: [number, number, number] = mix3(stop(2), stop(3), 0.3);
        if (mode === 'white') face = [1, 1, 1];
        else if (mode === 'rainbow') {
          face = hsv((L.index * 0.07 + ctx.beat * 0.05) % 1, 0.7, 1);
          side = [face[0] * 0.45, face[1] * 0.45, face[2] * 0.45];
        } else if (mode === 'gradient') face = mix3(stop(2), stop(4), lay.width > 0 ? Math.min(1, Math.max(0, (L.x + lay.width / 2) / lay.width)) : 0.5);
        else face = mix3(stop(4), [1, 1, 1], 0.55);
        const bright = (L.word < current ? 1 - dimPast : 1) * (1 + pose.glow * 0.35);
        face = [face[0] * bright, face[1] * bright, face[2] * bright];
        // Letter matrix: block → pivot → rotation → scale → offset to the letter → glyph quad.
        this.m.makeTranslation(pose.x * k, blockY + pose.y * k, pose.z * k);
        this.t.makeRotationFromEuler(this.e.set(pose.rx, pose.ry, pose.rz, 'XYZ'));
        this.m.multiply(this.t);
        this.t.makeScale(pose.s * k, pose.s * k, pose.s * k);
        this.m.multiply(this.t);
        this.t.makeTranslation(pose.ox, pose.oy, 0);
        this.m.multiply(this.t);
        const qx = g.x + g.w / 2 - g.advance / 2;
        const qy = g.y + g.h / 2 - atlas.cap / 2;
        const uv: [number, number, number, number] = [g.u0, g.v0, g.u1, g.v1];
        for (let d = depthLayers; d >= 0 && this.drawCount < MAX; d--) {
          const mm = this.mm.copy(this.m);
          this.t.makeTranslation(qx, qy, -d * dz);
          mm.multiply(this.t);
          this.t.makeScale(g.w, g.h, 1);
          mm.multiply(this.t);
          const slot = (this.pool[this.drawCount] ??= { z: 0, m: new Float32Array(16), uv: new Float32Array(4), col: new Float32Array(4), kind: new Float32Array(2) });
          slot.z = mm.elements[14];
          slot.m.set(mm.elements);
          slot.uv.set(uv);
          // Sides shade darker toward the back; the face takes the glow.
          const shade = d === 0 ? 1 : 0.9 - 0.55 * (d / Math.max(1, depthLayers));
          if (d === 0) slot.col.set([face[0], face[1], face[2], pose.a]);
          else slot.col.set([side[0] * shade, side[1] * shade, side[2] * shade, pose.a]);
          slot.kind[0] = d === 0 ? 0 : 1;
          slot.kind[1] = pose.glow;
          this.drawCount++;
        }
        if (this.drawCount >= MAX) break;
      }
    }
    // Back to front: the camera sits on +z looking down −z.
    const n = this.drawCount;
    this.order.length = n;
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.order.sort((a, b) => this.pool[a].z - this.pool[b].z);
    const im = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const d = this.pool[this.order[i]];
      im.set(d.m, i * 16);
      this.aUv.set(d.uv, i * 4);
      this.aCol.set(d.col, i * 4);
      this.aKind.set(d.kind, i * 2);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.kindAttr.needsUpdate = true;
    const shown = list[list.length - 1]?.line;
    this.info = { index, text: shown?.text ?? '', card, positionMs: now * 1000 };
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
  }

  compileTargets(): CompileTarget[] {
    return [{ scene: this.scene, camera: this.camera }];
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
