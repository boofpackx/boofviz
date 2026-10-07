import * as THREE from 'three';
import { lineIndexAt, type LyricLine } from '@shared/lyrics';
import { currentLines, lyricsFeed, songPositionMs } from '../lyricsFeed';
import { UTIL_GLSL } from '../shaders/common';
import { sdfAtlas, type SdfAtlas } from '../text/sdfAtlas';
import type { CompileTarget, GenContext, Generator } from './Generator';
import type { LyricsRenderInfo } from './Lyrics';
import { bounce, directShot, heroWord, intensityFor, songMap, type SongMap } from './lyricCinema';
import {
  FLAT,
  hash2,
  layoutFor,
  layoutLine,
  LETTER_MATERIALS,
  LYRIC_STYLES,
  lockTime,
  MULTI_LINE,
  poseLetter,
  STYLE_MATERIAL,
  timeWords,
  type LetterMaterial,
  type LineLayout,
  type LyricStyle,
  type MotionInput,
  type Pose,
  type TimedLine,
} from './lyricVideoMotion';
import { num } from './ShaderGenerator';

const MAX = 4096;
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
in vec4 aFx;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
out vec2 vLocal;
out vec4 vCol;
out vec2 vKind;
out vec4 vFx;
void main() {
  vUv = mix(aUv.xy, aUv.zw, vec2(uv.x, 1.0 - uv.y));
  vLocal = uv;
  vCol = aCol;
  vKind = aKind;
  vFx = aFx;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform float uOutline, uGlow, uShadow, uTime, uShine, uDot, uMelt;
uniform vec2 uRes;
uniform vec3 uOutlineCol, uGlowCol;
in vec2 vUv;
in vec2 vLocal;
in vec4 vCol;
in vec2 vKind;
in vec4 vFx;     // x material (0 plain 1 chrome 2 neon 3 paper 4 led 5 phosphor 6 stencil 7 mimeo 8 rub-down 9 laser 10 holo 11 jelly 12 melt) · y burn · z per-letter random · w solid card
out vec4 fragColor;
${UTIL_GLSL}
void main() {
  int mat = int(vFx.x + 0.5);
  if (vFx.w > 0.5) {
    // A solid card behind a letter: torn paper (ransom notes) or a teletext cell.
    vec2 q = abs(vLocal - 0.5) * 2.0;
    float rough = mat == 3 ? hash21(floor(vLocal * 30.0) + vFx.z * 97.0) * 0.07 : 0.0;
    float cover = 1.0 - smoothstep(0.93 - rough, 0.97 - rough, max(q.x, q.y));
    vec3 c = vCol.rgb * (mat == 3 ? 0.9 + 0.1 * vnoise(vLocal * 40.0 + vFx.z * 13.0) : 1.0);
    fragColor = vec4(c * cover, cover) * vCol.a;
    return;
  }
  // Signed distance: > 0 inside the glyph; ±0.5 spans the field's spread.
  float d = texture(uAtlas, vUv).r - 0.5;
  float w = max(fwidth(d), 1e-4) * 0.75;
  float face = smoothstep(-w, w, d);
  float cover = face;
  vec3 col = vCol.rgb;
  bool front = vKind.x < 0.5;
  if (mat == 12) {
    // Melting: the letter sags in waves and drips run down from its lower edges (side layers sag with it).
    float gh = length(vec2(dFdx(vUv.y), dFdy(vUv.y))) / max(1e-5, length(vec2(dFdx(vLocal.y), dFdy(vLocal.y))));
    float sag = uMelt * gh * 0.09 * (0.5 + 0.5 * sin(vLocal.x * 9.0 + vFx.z * 20.0));
    vec2 uv2 = vUv - vec2(0.0, sag * (1.0 - vLocal.y));
    d = texture(uAtlas, uv2).r - 0.5;
    face = smoothstep(-w, w, d);
    float colr = hash21(vec2(floor(vLocal.x * 13.0), vFx.z * 7.0));
    float len = uMelt * gh * 0.3 * colr * colr;
    float drip = 0.0;
    for (int k = 1; k <= 6; k++) drip = max(drip, step(0.0, texture(uAtlas, uv2 - vec2(0.0, len * float(k) / 6.0)).r - 0.5));
    float thin = step(abs(fract(vLocal.x * 13.0) - 0.5), 0.3 - 0.2 * smoothstep(0.0, 1.0, colr));
    face = max(face, drip * thin * step(0.55, colr) * step(vLocal.y, 0.5));
    cover = face;
  }
  if (front && mat == 1) {
    // Chrome: sky above a hard horizon, warm ground below, and a shine sweeping across.
    float y = vLocal.y;
    vec3 sky = mix(vec3(0.35, 0.45, 0.75), vec3(1.15), smoothstep(0.52, 0.95, y));
    vec3 ground = mix(vec3(0.18, 0.09, 0.03), vec3(1.0, 0.72, 0.4), smoothstep(0.05, 0.47, y));
    vec3 chrome = y > 0.5 ? sky : ground;
    chrome = mix(chrome, vec3(0.03), smoothstep(0.035, 0.0, abs(y - 0.5)) * 0.85);
    chrome = mix(chrome, chrome * vCol.rgb * 1.6, 0.25);
    vec2 sp = gl_FragCoord.xy / uRes;
    chrome += vec3(1.4) * smoothstep(0.05, 0.0, abs(sp.x + sp.y * 0.35 - uShine));
    col = chrome;
  } else if (front && mat == 2) {
    // Neon: a bright tube just inside the outline, dark glass inside, flickering now and then.
    float tube = smoothstep(0.08, 0.0, abs(d - 0.06));
    float flick = step(0.04, hash21(vec2(floor(uTime * 18.0), vFx.z * 91.0)));
    col = vCol.rgb * tube * 2.6 * flick + vec3(1.0) * smoothstep(0.03, 0.0, abs(d - 0.06)) * flick + vCol.rgb * 0.06 * face;
    cover = max(tube, face * 0.35);
  } else if (front && mat == 3) {
    col = vCol.rgb;
  } else if (front && mat == 4) {
    // LED sign: the letter lit through a grid of round dots.
    vec2 cell = fract(gl_FragCoord.xy / uDot) - 0.5;
    float dotm = smoothstep(0.42, 0.28, length(cell));
    col = vCol.rgb * dotm * 1.6;
    cover = face * max(dotm, 0.15);
  } else if (front && mat == 6) {
    // Spray stencil: bridges cut through the letters, overspray speckle round the edges, a few drips.
    float bridge = step(abs(fract(vLocal.x * 2.3 + vFx.z) - 0.5), 0.035) * step(0.3, vLocal.y) * step(vLocal.y, 0.75);
    face *= 1.0 - bridge;
    float spray = step(0.55, hash21(floor(gl_FragCoord.xy * 0.7) + vFx.z * 50.0)) * smoothstep(-0.22, 0.0, d) * (1.0 - face);
    float dripCol = step(0.86, hash21(vec2(floor(vLocal.x * 18.0), vFx.z * 20.0)));
    float above = max(texture(uAtlas, vUv - vec2(0.0, 0.006)).r, texture(uAtlas, vUv - vec2(0.0, 0.014)).r) - 0.5;
    float drip = dripCol * step(0.0, above) * (1.0 - face) * step(0.08, vLocal.y);
    cover = clamp(face + spray * 0.55 + drip, 0.0, 1.0);
    col = vCol.rgb;
  } else if (front && mat == 7) {
    // Mimeograph: purple ditto ink, rolled on unevenly, soft edges and a faint second impression.
    float roll = 0.55 + 0.45 * fbm(vec2(vLocal.y * 14.0 + vFx.z * 9.0, vLocal.x * 1.5));
    float soft = smoothstep(-w * 3.0, w * 3.0, d + (vnoise(vLocal * 30.0) - 0.5) * 0.06);
    float ghost = smoothstep(-w * 3.0, w * 3.0, texture(uAtlas, vUv + vec2(0.004, 0.003)).r - 0.5) * 0.25;
    cover = clamp(soft * roll + ghost, 0.0, 1.0);
    col = mix(vec3(0.42, 0.16, 0.72), vCol.rgb, 0.2);
  } else if (front && mat == 8) {
    // Rub-down transfer letters: cracked where the film didn't fully stick, a few chips missing.
    float crack = smoothstep(0.035, 0.0, abs(vnoise(vLocal * 9.0 + vFx.z * 17.0) - 0.5));
    float chip = step(0.82, vnoise(vLocal * 5.0 + vFx.z * 3.0));
    face *= (1.0 - crack * 0.9) * (1.0 - chip);
    cover = face;
    col = vCol.rgb;
  } else if (front && mat == 9) {
    // Laser: a thin vector beam tracing the outline, scanning and flickering.
    float beam = smoothstep(0.045, 0.0, abs(d - 0.01));
    float scan = 0.7 + 0.3 * step(0.5, fract(gl_FragCoord.y * 0.5 + uTime * 47.0));
    col = vCol.rgb * beam * 2.4 * scan + vec3(1.0) * smoothstep(0.015, 0.0, abs(d - 0.01)) * 0.7;
    cover = beam;
  } else if (front && mat == 10) {
    // Holographic foil: a rainbow that slides with position and time, fine diffraction lines, glitter twinkles.
    vec2 sp = gl_FragCoord.xy / uRes;
    float ph = sp.x * 1.3 + sp.y * 0.7 + vFx.z * 0.6 + uTime * 0.15 + vLocal.y * 0.35;
    vec3 rb = 0.55 + 0.45 * cos(6.2832 * (ph + vec3(0.0, 0.33, 0.67)));
    float lines = 0.86 + 0.14 * sin((sp.x - sp.y) * uRes.y * 0.9);
    float tw = step(0.982, hash21(floor(gl_FragCoord.xy / 3.0) + floor(uTime * 8.0) * 0.37 + vFx.z * 11.0));
    col = mix(rb * 1.25, vCol.rgb, 0.15) * lines * (0.85 + 0.25 * smoothstep(0.0, 0.2, d)) + vec3(2.2) * tw;
  } else if (front && mat == 11) {
    // Gummy: see-through, deeper colour where it's thick, a wet highlight and a bright rim.
    float thick = smoothstep(0.0, 0.3, d);
    float e = 0.004;
    float gx = texture(uAtlas, vUv + vec2(e, 0.0)).r - texture(uAtlas, vUv - vec2(e, 0.0)).r;
    float gy = texture(uAtlas, vUv - vec2(0.0, e)).r - texture(uAtlas, vUv + vec2(0.0, e)).r;
    vec3 nrm = normalize(vec3(-gx, -gy, 0.03 + 0.25 * thick));
    float spec = pow(max(dot(nrm, normalize(vec3(-0.45, 0.6, 0.8))), 0.0), 28.0);
    float rim = smoothstep(0.06, 0.0, d) * face;
    col = vCol.rgb * (0.5 + 0.7 * thick) + vec3(1.0) * spec * 1.4 + vCol.rgb * rim * 0.8;
    cover = face * (0.55 + 0.35 * thick) + spec * face * 0.4;
  } else if (front && mat == 12) {
    col = vCol.rgb * (0.85 + 0.3 * smoothstep(0.0, 0.2, d));
  } else if (front && mat == 5) {
    // Phosphor: one glowing colour, scanlines, a slow persistence bloom.
    col = vCol.rgb * (1.2 + 0.4 * smoothstep(0.0, 0.25, d)) * (0.72 + 0.28 * sin(gl_FragCoord.y * 3.14159));
  }
  if (uOutline > 0.0 && mat != 2) {
    cover = max(cover, smoothstep(-w, w, d + uOutline * 0.32));
    col = mix(uOutlineCol, col, face);
  }
  // Drawn in: handwriting or a laser trace reveals the letter left to right.
  if (vFx.y < 0.0) {
    float r = -vFx.y;
    float m = 1.0 - smoothstep(r - 0.05, r + 0.001, vLocal.x);
    cover *= m;
    col += vec3(1.0) * smoothstep(0.06, 0.0, abs(vLocal.x - r)) * face * 0.6;
  }
  // Burning away: the letter erodes from a noise front with a glowing edge.
  if (vFx.y > 0.0) {
    float nz = vnoise(vLocal * 6.0 + vFx.z * 31.0) * 0.8 + vnoise(vLocal * 19.0) * 0.2;
    float keep = smoothstep(vFx.y - 0.02, vFx.y + 0.02, nz);
    float rim = smoothstep(0.1, 0.0, nz - vFx.y) * keep;
    col = mix(col, vec3(1.6, 0.6, 0.12), rim);
    cover *= keep;
  }
  vec3 rgb = col * cover;
  float a = cover;
  if (front) {
    // A tight light glow and a dark soft shadow from the distance field; the shadow keeps words readable over busy looks.
    float halo = smoothstep(mat == 2 ? -0.42 : -0.32, 0.0, d) * (1.0 - cover);
    rgb += (mat == 2 ? vCol.rgb : uGlowCol) * halo * (uGlow + vKind.y + (mat == 2 ? 0.8 : 0.0)) * 0.6;
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
  'Real 90s': 'teletext',
  'Y2K & Aero': 'infomercial',
  'Retro Type': 'credits',
  'Lost Media': 'credits',
  'Retro TV': 'teletext',
  'Neo 90s': 'glitter',
  Vintage: 'jcard',
  Lyrics: 'drop',
};

const TELETEXT: Array<[number, number, number]> = [
  [1, 1, 0],
  [0, 1, 1],
  [1, 1, 1],
  [0, 1, 0],
  [1, 0, 1],
];
const PAPERS: Array<[number, number, number]> = [
  [0.95, 0.93, 0.86],
  [1, 0.85, 0.15],
  [0.95, 0.45, 0.6],
  [0.25, 0.45, 0.9],
  [0.06, 0.06, 0.06],
  [0.85, 0.2, 0.15],
];
const MATERIAL_INDEX: Record<LetterMaterial, number> = { plain: 0, chrome: 1, neon: 2, paper: 3, led: 4, phosphor: 5, stencil: 6, mimeo: 7, rubdown: 8, laser: 9, holo: 10, jelly: 11, melt: 12 };

/** Glyph quad centre offset from the pen position (em). */
const qx0 = (g: { x: number; w: number; advance: number }): number => g.x + g.w / 2 - g.advance / 2;
const qy0 = (g: { y: number; h: number }, cap: number): number => g.y + g.h / 2 - cap / 2;

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

type Rgb = [number, number, number];
interface Slot {
  z: number;
  m: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  kind: Float32Array;
  fx: Float32Array;
}
interface ShownLine {
  line: TimedLine;
  seed: number;
  /** Offset from the sung line (0 = the sung line). */
  rel: number;
  chorus: boolean;
  hero: number;
}

/**
 * Music-video lyrics: every letter is its own object in a 3D scene, posed by
 * a style on the sung timing of its word, with chunky extruded depth and crisp
 * distance-field glyphs. Lyric Cinema on top: the song's shape sets how big
 * each moment is, a hero word takes the frame, a director moves the camera,
 * letters can be chrome, neon, paper, LED or phosphor, and lines can leave by
 * shattering or burning away.
 */
export class LyricVideo implements Generator {
  readonly kind = 'lyricVideo';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly mat: THREE.RawShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly aUv = new Float32Array(MAX * 4);
  private readonly aCol = new Float32Array(MAX * 4);
  private readonly aKind = new Float32Array(MAX * 2);
  private readonly aFx = new Float32Array(MAX * 4);
  private readonly uvAttr: THREE.InstancedBufferAttribute;
  private readonly colAttr: THREE.InstancedBufferAttribute;
  private readonly kindAttr: THREE.InstancedBufferAttribute;
  private readonly fxAttr: THREE.InstancedBufferAttribute;
  private atlas: SdfAtlas | null = null;
  private font = '';
  private readonly layouts = new Map<string, LineLayout>();
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Matrix4();
  private readonly e = new THREE.Euler();
  private readonly mm = new THREE.Matrix4();
  // Draw pool (reused every frame) and its back-to-front order.
  private readonly pool: Slot[] = [];
  private readonly order: number[] = [];
  private drawCount = 0;
  private map: SongMap | null = null;
  private mapKey = '';
  /** What it showed last frame (debug hooks), shaped like the classic lyrics generator's. */
  info: LyricsRenderInfo & { style?: string; chorus?: boolean; hero?: string; intensity?: number } = { index: -1, text: '', card: false, positionMs: 0 };

  constructor() {
    this.uvAttr = new THREE.InstancedBufferAttribute(this.aUv, 4).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.InstancedBufferAttribute(this.aCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.kindAttr = new THREE.InstancedBufferAttribute(this.aKind, 2).setUsage(THREE.DynamicDrawUsage);
    this.fxAttr = new THREE.InstancedBufferAttribute(this.aFx, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aUv', this.uvAttr);
    this.geo.setAttribute('aCol', this.colAttr);
    this.geo.setAttribute('aKind', this.kindAttr);
    this.geo.setAttribute('aFx', this.fxAttr);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uAtlas: { value: null },
        uOutline: { value: 0 },
        uGlow: { value: 0.2 },
        uShadow: { value: 0.6 },
        uTime: { value: 0 },
        uShine: { value: -1 },
        uDot: { value: 6 },
        uMelt: { value: 0.6 },
        uRes: { value: new THREE.Vector2(1, 1) },
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
    this.camera.position.set(1.1, 0.8, CAM_Z);
    this.camera.lookAt(0, 0, 0);
  }

  /** Chorus lines and hero words for the track playing now (recomputed when the lyrics change). */
  private songShape(synced: LyricLine[]): SongMap {
    const key = `${lyricsFeed.version}|${synced.length}`;
    if (!this.map || key !== this.mapKey) {
      this.map = songMap(synced);
      this.mapKey = key;
    }
    return this.map;
  }

  /** The lines on screen now: the sung line, the previous one while it leaves, or a window of lines for roll / page styles. */
  private lines(ctx: GenContext, upper: boolean, speed: number, style: LyricStyle, exitSecs: number): { list: ShownLine[]; now: number; frac: number; card: boolean; index: number } {
    const p = ctx.params;
    const source = String(p.source ?? 'lyrics');
    const fix = (s: string): string => (upper ? s.toUpperCase() : s);
    const multi = MULTI_LINE.has(style);
    const synced = source === 'lyrics' && lyricsFeed.now.connected ? currentLines() : null;
    if (synced?.length) {
      const posMs = songPositionMs(Date.now(), num(p.lead, 120));
      const i = lineIndexAt(synced, posMs);
      if (i >= 0) {
        const shape = this.songShape(synced);
        const now = posMs / 1000;
        const at = (k: number): TimedLine => {
          const l = synced[k];
          const start = l.t / 1000;
          const end = synced[k + 1] ? synced[k + 1].t / 1000 : start + 4;
          return timeWords(fix(l.text || '♪'), start, end, l.words);
        };
        const cur = at(i);
        const frac = Math.min(1, Math.max(0, (now - cur.start) / Math.max(0.3, cur.end - cur.start)));
        const make = (k: number): ShownLine => ({ line: at(k), seed: k, rel: k - i, chorus: shape.chorus[k] ?? false, hero: shape.hero[k] ?? -1 });
        const list: ShownLine[] = [];
        if (multi) {
          const from = style === 'teletext' ? Math.floor(i / 4) * 4 : Math.max(0, i - 4);
          const to = style === 'teletext' ? i : Math.min(synced.length - 1, i + 4);
          for (let k = from; k <= to; k++) list.push(make(k));
        } else {
          if (i > 0 && now - synced[i].t / 1000 < exitSecs / speed) list.push(make(i - 1));
          list.push(make(i));
          if (style === 'highway' && i + 1 < synced.length) list.push(make(i + 1));
        }
        return { list, now, frac, card: false, index: i };
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
    const make = (k: number): ShownLine => {
      const start = k * lineBeats * spb;
      const t = fix(rows[((k % rows.length) + rows.length) % rows.length] || ' ');
      return { line: timeWords(t, start, start + lineBeats * spb), seed: k, rel: k - idx, chorus: rows.length > 1 && k % 4 >= 2, hero: heroWord(t) };
    };
    const frac = (ctx.beat - idx * lineBeats) / lineBeats;
    const list: ShownLine[] = [];
    if (multi) {
      const from = style === 'teletext' ? Math.floor(idx / 4) * 4 : idx - 4;
      const to = style === 'teletext' ? idx : idx + 4;
      for (let k = from; k <= to; k++) list.push(make(k));
    } else {
      if (now - idx * lineBeats * spb < exitSecs / speed) list.push(make(idx - 1));
      list.push(make(idx));
      if (style === 'highway') list.push(make(idx + 1));
    }
    return { list, now, frac, card: !!titled, index: -1 };
  }

  private slot(): Slot | null {
    if (this.drawCount >= MAX) return null;
    return (this.pool[this.drawCount++] ??= { z: 0, m: new Float32Array(16), uv: new Float32Array(4), col: new Float32Array(4), kind: new Float32Array(2), fx: new Float32Array(4) });
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const font = String(p.font ?? 'heavy');
    const chosen = String(p.style ?? 'auto');
    const style: LyricStyle = (LYRIC_STYLES as readonly string[]).includes(chosen) ? (chosen as LyricStyle) : (AUTO_STYLE[ctx.category ?? ''] ?? 'drop');
    // Some styles have a typeface of their own unless the look picks one.
    const STYLE_FONT: Partial<Record<LyricStyle, string>> = { teletext: 'mono', credits: 'serif', highscore: 'mono', jcard: 'marker' };
    const styleFont = p.font === undefined || p.font === 'heavy' ? (STYLE_FONT[style] ?? font) : font;
    if (styleFont !== this.font || !this.atlas) {
      this.font = styleFont;
      this.atlas = sdfAtlas(styleFont);
      this.mat.uniforms.uAtlas.value = this.atlas.texture;
      this.layouts.clear();
    }
    const atlas = this.atlas;
    const speed = Math.max(0.25, num(p.speed, 1));
    const upper = style === 'ransom' ? false : p.uppercase !== false;
    const chosenMat = String(p.material ?? 'auto');
    const material: LetterMaterial = (LETTER_MATERIALS as readonly string[]).includes(chosenMat) ? (chosenMat as LetterMaterial) : (STYLE_MATERIAL[style] ?? 'plain');
    const exitChoice = String(p.exit ?? 'auto');
    const heroAmt = Math.max(0, num(p.hero, 0.6));
    const camAmt = Math.max(0, num(p.camera, 0.5));
    const drama = Math.max(0, Math.min(1, num(p.drama, 0.7)));
    const exitSecs = exitChoice === 'shatter' || exitChoice === 'burn' || exitChoice === 'auto' ? 0.9 : 0.6;
    const { list, now, frac, card, index } = this.lines(ctx, upper, speed, style, exitSecs);
    const sung = list.find((l) => l.rel === 0) ?? list[list.length - 1];
    const intensity = intensityFor(!!sung?.chorus, ctx.env.energy, ctx.env.drop, drama);

    // Scale: size 1 puts the cap height at ~10% of the frame; long lines shrink to fit.
    this.camera.aspect = ctx.width / Math.max(1, ctx.height);
    const viewH = 2 * CAM_Z * Math.tan((FOV * Math.PI) / 360);
    const viewW = viewH * this.camera.aspect;
    const sizeK = style === 'teletext' ? 0.62 : style === 'credits' ? 0.72 : 1;
    const kBase = (viewH * 0.1 * num(p.size, 1) * sizeK) / atlas.cap;
    const pos = String(p.position ?? 'center');
    const blockY = FLAT.has(style) || style === 'screensaver' || style === 'highway' ? 0 : pos === 'lower' ? -viewH * 0.24 : pos === 'upper' ? viewH * 0.24 : 0;
    const advance = (ch: string): number => atlas.glyphs.get(ch)?.advance ?? atlas.glyphs.get('?')!.advance;
    const depthLayers = style === 'teletext' || style === 'credits' || material === 'neon' || material === 'led' ? 0 : Math.round(Math.max(0, Math.min(1, num(p.depth, style === 'screensaver' ? 0.9 : 0.5))) * 10);
    const dz = 0.04;
    const dimPast = Math.max(0, Math.min(1, num(p.dimPast, 0.25)));
    const pal = ctx.palette;
    const mode = String(p.colorMode ?? 'palette');
    const stop = (i: number): Rgb => [pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]];
    const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const u = this.mat.uniforms;
    (u.uGlowCol.value as THREE.Vector3).set(...mix3(stop(3), stop(4), 0.5));
    (u.uOutlineCol.value as THREE.Vector3).set(...mix3(stop(0), [0, 0, 0], 0.6));
    u.uOutline.value = num(p.outline, 0);
    u.uGlow.value = num(p.glow, 0.2);
    u.uShadow.value = num(p.shadow, 0.6);
    u.uTime.value = ctx.time;
    (u.uRes.value as THREE.Vector2).set(ctx.width, ctx.height);
    u.uDot.value = Math.max(3, ctx.height / 150);
    // Chrome shine: one sweep across the frame as each line arrives.
    u.uShine.value = sung ? -0.3 + ((now - sung.line.start) * speed) / 0.7 : -1;
    const matIndex = MATERIAL_INDEX[material];
    // Melting letters sag and drip more as the line goes on, and all at once on the drop.
    u.uMelt.value = Math.min(1.4, num(p.melt, 0.7) * (0.3 + 0.7 * Math.min(1, frac)) + ctx.env.drop * 0.5);

    // Director: camera per style and moment.
    const heroStart = sung && sung.hero >= 0 ? sung.line.words[sung.hero]?.start ?? null : null;
    if (style === 'highway') {
      this.camera.fov = 55;
      this.camera.position.set(0, viewH * 0.06, CAM_Z * 0.5);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, -viewH * 0.12, -CAM_Z * 1.2);
    } else {
      const shot = directShot({
        amount: style === 'screensaver' ? 0 : camAmt,
        intensity,
        lineStart: sung?.line.start ?? 0,
        lineEnd: sung?.line.end ?? 1,
        now,
        heroStart,
        chorus: !!sung?.chorus,
        beat: ctx.beat,
        drop: ctx.env.drop,
        seed: sung?.seed ?? 0,
        flat: FLAT.has(style) || style === 'screensaver',
      });
      this.camera.fov = FOV * shot.fov;
      this.camera.position.set(shot.px * viewH, shot.py * viewH, CAM_Z * shot.pz);
      this.camera.up.set(Math.sin(shot.roll), Math.cos(shot.roll), 0);
      this.camera.lookAt(shot.tx * viewH, shot.ty * viewH, shot.tz);
    }
    this.camera.updateProjectionMatrix();

    this.drawCount = 0;
    const flowMode = layoutFor(style) === 'flow';
    const lmode = layoutFor(style);
    const prepared = list.map((shown) => {
      const { line, seed } = shown;
      const words = line.words.map((w) => w.text);
      const maxW = (viewW * (style === 'screensaver' ? 0.5 : 0.86)) / kBase;
      // The hero word gets its own row, bigger in big moments.
      const heroScale = flowMode && !MULTI_LINE.has(style) && style !== 'screensaver' && shown.hero >= 0 ? 1 + heroAmt * (shown.chorus ? 1.5 : 0.75) * Math.min(1.2, intensity) : 1;
      const key = `${style}|${seed}|${line.text}|${maxW.toFixed(1)}|${heroScale.toFixed(2)}`;
      let lay = this.layouts.get(key);
      if (!lay) {
        lay = layoutLine(words, advance, lmode, maxW, seed, heroScale > 1 ? { index: shown.hero, scale: heroScale } : undefined);
        this.layouts.set(key, lay);
        if (this.layouts.size > 96) this.layouts.delete(this.layouts.keys().next().value!);
      }
      const fit =
        style === 'teletext' || style === 'highway'
          ? 1
          : style === 'credits'
            ? Math.min(1, (viewW * 0.9) / Math.max(1e-3, lay.width * kBase))
            : lmode === 'flow' || lmode === 'stack'
              ? Math.min(1, (viewW * 0.88) / Math.max(1e-3, lay.width * kBase), (viewH * 0.8) / Math.max(1e-3, lay.height * kBase))
              : 1;
      return { shown, lay, heroScale, k: kBase * fit };
    });
    // Multi-line styles: stack the lines by their real heights (world units, then back to each line's em).
    const rowY = new Map<number, number>();
    if (MULTI_LINE.has(style) && prepared.length) {
      const gap = kBase * (style === 'teletext' ? 0.25 : 0.55);
      const h = prepared.map((x) => x.lay.height * x.k * (style === 'teletext' && x.shown.rel === 0 ? 1.6 : 1));
      const c: number[] = new Array(prepared.length).fill(0);
      if (style === 'teletext') {
        let y = viewH * 0.36;
        prepared.forEach((_, i) => {
          c[i] = y - h[i] / 2;
          y -= h[i] + gap;
        });
      } else {
        const cur = Math.max(0, prepared.findIndex((x) => x.shown.rel === 0));
        for (let i = cur + 1; i < prepared.length; i++) c[i] = c[i - 1] - (h[i - 1] / 2 + gap + h[i] / 2);
        for (let i = cur - 1; i >= 0; i--) c[i] = c[i + 1] + (h[i + 1] / 2 + gap + h[i] / 2);
        const step = cur + 1 < prepared.length ? c[cur] - c[cur + 1] : h[cur] + gap;
        for (let i = 0; i < prepared.length; i++) c[i] += frac * step;
      }
      prepared.forEach((x, i) => rowY.set(x.shown.seed, c[i] / x.k));
    }
    for (const { shown, lay, heroScale, k } of prepared) {
      const { line, seed, rel } = shown;
      let current = -1;
      line.words.forEach((w, i) => {
        if (now >= w.start) current = i;
      });
      // Exits: a look can override the style's own exit with a shatter or a burn.
      const exit = exitChoice === 'auto' ? (shown.chorus && ['slam', 'pop', 'zoomthrough', 'infomercial', 'drop', 'spin3d', 'explosion'].includes(style) ? 'shatter' : 'style') : exitChoice;
      const leaving = rel < 0 && !MULTI_LINE.has(style) && exit !== 'style' && now > line.end;
      const outT = leaving ? Math.min(1, ((now - line.end) * speed) / 0.8) : 0;
      const motion: MotionInput = {
        now: leaving ? line.end - 0.001 : now,
        line,
        kick: ctx.env.kick * num(p.punch, 1),
        beat: ctx.beat,
        spb: 60 / Math.max(40, ctx.frame.bpm || 120),
        speed,
        seed,
        current,
        rel,
        frac,
        intensity,
        viewW: viewW / k,
        viewH: viewH / k,
        rowY: rowY.get(seed),
        chorus: shown.chorus,
      };
      // Shatter drop: the drop breaks the sung line apart, then it re-forms.
      const dropAge = ctx.env.drop > 0.02 ? -3 * Math.log(ctx.env.drop) : 99;
      const dropBurst = style === 'shatterdrop' && rel === 0 && dropAge < 2;
      // High-score entry: which letter is spinning right now.
      let entering = -1;
      if (style === 'highscore') for (const L of lay.letters) if (L.ch !== ' ' && entering < 0 && lockTime(line, L) > now) entering = L.index;
      // Teletext: the page header, then each row on black cells.
      const ttCol = TELETEXT[((seed % 5) + 5) % 5];
      const hueHits = style === 'screensaver' ? bounce(now, Math.max(0, viewW / k - 6), Math.max(0, viewH / k - 2.5)).hits : 0;
      for (const L of lay.letters) {
        if (L.ch === ' ' && style !== 'teletext') continue;
        let ch = style === 'ransom' && hash2(seed * 977 + L.index, 3) < 0.45 ? L.ch.toUpperCase() : L.ch;
        let hsState = 0; // high score: 0 locked, 1 spinning, 2 waiting
        if (style === 'highscore' && lockTime(line, L) > now) {
          hsState = L.index === entering ? 1 : 2;
          ch = hsState === 1 ? String.fromCharCode(65 + ((Math.floor(now * 16) + L.index * 7) % 26)) : '_';
        }
        const g = atlas.glyphs.get(ch) ?? atlas.glyphs.get('?')!;
        const W = lay.words[L.word];
        const pose: Pose = poseLetter(style, L, W, motion);
        if (pose.a <= 0.003 || pose.s <= 1e-3) continue;
        // Hero word: scale the letters about the word's centre.
        if (heroScale > 1 && L.word === shown.hero && W) {
          if (pose.ox === 0 && pose.oy === 0) {
            pose.x = W.x + (pose.x - W.x) * heroScale;
            pose.y = W.y + (pose.y - W.y) * heroScale;
          }
          pose.s *= heroScale;
          pose.glow += 0.4 * (L.word === current ? 1 : 0.4);
        }
        if (style === 'teletext') {
          // Rows from the top of the page down, the sung row double height.
          pose.y = (rowY.get(seed) ?? 0) + L.y * (rel === 0 ? 1.6 : 1);
          pose.x = L.x;
        }
        // Colour.
        let face: Rgb;
        let side: Rgb = mix3(stop(2), stop(3), 0.3);
        if (style === 'teletext') face = ttCol;
        else if (style === 'highscore') face = hsState === 0 ? [1, 0.88, 0.15] : hsState === 1 ? (Math.floor(now * 6) % 2 ? [1, 1, 1] : [1, 0.3, 0.3]) : [0.2, 0.85, 1];
        else if (material === 'laser') face = mode === 'palette' ? [0.25, 1, 0.35] : mix3(stop(3), [1, 1, 1], 0.2);
        else if (material === 'neon' && mode === 'palette') {
          // Neon glows in the look's own colours, alternating tube colours word by word.
          const c = L.word % 2 ? stop(3) : stop(2);
          face = [c[0] * 1.5, c[1] * 1.5, c[2] * 1.5];
        } else if (style === 'jcard' && mode === 'palette') face = [stop(1)[0] * 0.9, stop(1)[1] * 0.9, stop(1)[2] * 0.9];
        else if (style === 'screensaver') face = hsv((hueHits * 0.21) % 1, 0.55, 1);
        else if (material === 'phosphor') face = mode === 'palette' ? [0.35, 1, 0.45] : mix3(stop(4), [1, 1, 1], 0.3);
        else if (mode === 'white') face = [1, 1, 1];
        else if (mode === 'rainbow') {
          face = hsv((L.index * 0.07 + ctx.beat * 0.05) % 1, 0.7, 1);
          side = [face[0] * 0.45, face[1] * 0.45, face[2] * 0.45];
        } else if (mode === 'gradient') face = mix3(stop(2), stop(4), lay.width > 0 ? Math.min(1, Math.max(0, (L.x + lay.width / 2) / lay.width)) : 0.5);
        else face = mix3(stop(4), [1, 1, 1], 0.55);
        let paper: Rgb | null = null;
        if (style === 'ransom') {
          paper = PAPERS[Math.floor(hash2(seed * 31 + L.index, 5) * PAPERS.length)];
          const dark = paper[0] + paper[1] + paper[2] < 1.2;
          face = dark ? [1, 1, 1] : hash2(seed + L.index, 6) < 0.25 ? [0.8, 0.1, 0.08] : [0.04, 0.04, 0.04];
        }
        const bright = (L.word < current && !MULTI_LINE.has(style) ? 1 - dimPast : 1) * (1 + pose.glow * 0.35) * (style === 'credits' && rel !== 0 ? 0.7 : 1);
        face = [face[0] * bright, face[1] * bright, face[2] * bright];
        // Letter matrix: block → pivot → rotation → scale → offset to the letter.
        this.m.makeTranslation(pose.x * k, blockY + pose.y * k, pose.z * k);
        this.t.makeRotationFromEuler(this.e.set(pose.rx, pose.ry, pose.rz, 'XYZ'));
        this.m.multiply(this.t);
        this.t.makeScale(pose.s * k * (style === 'teletext' && rel === 0 ? 0.9 : 1) * (pose.sx ?? 1), pose.s * k * (style === 'teletext' && rel === 0 ? 1.6 : 1) * (pose.sy ?? 1), pose.s * k);
        this.m.multiply(this.t);
        this.t.makeTranslation(pose.ox, pose.oy, 0);
        this.m.multiply(this.t);
        const rand = hash2(seed * 7 + L.index, 9);
        // Cards behind letters: ransom paper, teletext cells.
        if (paper || style === 'teletext') {
          const s = this.slot();
          if (!s) break;
          const mm = this.mm.copy(this.m);
          const cw = style === 'teletext' ? advance(L.ch) * 1.02 : g.advance * 1.25;
          const chh = atlas.cap * (style === 'teletext' ? 1.5 : 1.55);
          this.t.makeTranslation(0, 0, -0.02);
          mm.multiply(this.t);
          if (paper) {
            this.t.makeRotationZ((hash2(seed + L.index, 8) - 0.5) * 0.3);
            mm.multiply(this.t);
          }
          this.t.makeScale(cw, chh, 1);
          mm.multiply(this.t);
          s.z = mm.elements[14] - 1e-4;
          s.m.set(mm.elements);
          s.uv.set([0, 0, 0, 0]);
          const cc = paper ?? [0, 0, 0];
          s.col.set([cc[0], cc[1], cc[2], pose.a]);
          s.kind[0] = 1;
          s.kind[1] = 0;
          s.fx.set([paper ? 3 : 0, 0, rand, 1]);
          if (L.ch === ' ') continue;
        }
        const qx = g.x + g.w / 2 - g.advance / 2;
        const qy = g.y + g.h / 2 - atlas.cap / 2;
        let ot = outT;
        let shatter = exit === 'shatter' && outT > 0;
        let alpha = pose.a * (shatter ? 1 - outT : exit === 'fade' ? 1 - outT : 1);
        if (dropBurst) {
          if (dropAge < 1.2) {
            shatter = true;
            ot = dropAge / 1.2;
            alpha = pose.a * (1 - ot);
          } else alpha = pose.a * ((dropAge - 1.2) / 0.8);
        }
        // Burn eats the letter (positive); a reveal draws it left to right (negative).
        const burn = exit === 'burn' ? ot : pose.reveal !== undefined && pose.reveal < 1 ? -Math.max(0.001, pose.reveal) : 0;
        // Pieces per side: quarters when shattering, glitter flakes when scattering.
        const glitter = pose.scatter !== undefined && !shatter;
        const n = shatter ? 2 : glitter ? 5 : 1;
        const pieces = n * n;
        const sc = glitter ? pose.scatter! : 0;
        // Neon alley: each letter reflected in the wet street below, rippling.
        if (style === 'neonalley' && !shatter) {
          const s = this.slot();
          if (s) {
            const floorY = blockY - viewH * 0.3;
            const mm = this.mm.copy(this.m);
            this.t.makeTranslation(qx0(g), qy0(g, atlas.cap), 0);
            mm.multiply(this.t);
            this.t.makeScale(g.w, g.h, 1);
            mm.multiply(this.t);
            const e = mm.elements;
            // Mirror about the floor: y' = 2·floor − y (rows 1 of the matrix), plus a ripple.
            for (const i of [1, 5, 9]) e[i] = -e[i];
            e[13] = 2 * floorY - e[13];
            e[12] += Math.sin(now * 3 + e[13] * 2) * 0.05 * k;
            s.z = e[14] - 0.01;
            s.m.set(e);
            s.uv.set([g.u0, g.v0, g.u1, g.v1]);
            s.col.set([face[0] * 0.5, face[1] * 0.5, face[2] * 0.5, alpha * 0.35]);
            s.kind[0] = 0;
            s.kind[1] = 0;
            s.fx.set([matIndex, 0, rand, 0]);
          }
        }
        // Laser show: a beam from the projector to each word's first letter.
        if (style === 'laser' && L.li === 0 && !shatter) {
          const s = this.slot();
          if (s) {
            const tx = pose.x * k;
            const ty = blockY + pose.y * k;
            const ox = 0;
            const oy = -viewH * 0.55;
            const len = Math.hypot(tx - ox, ty - oy);
            const ang = Math.atan2(ty - oy, tx - ox);
            this.mm.makeTranslation((tx + ox) / 2, (ty + oy) / 2, -0.5);
            this.t.makeRotationZ(ang);
            this.mm.multiply(this.t);
            this.t.makeScale(len, 0.02 * k, 1);
            this.mm.multiply(this.t);
            s.z = this.mm.elements[14];
            s.m.set(this.mm.elements);
            s.uv.set([0, 0, 0, 0]);
            const flick = 0.12 + 0.12 * ctx.env.kick;
            s.col.set([face[0] * flick, face[1] * flick, face[2] * flick, flick * alpha]);
            s.kind[0] = 1;
            s.kind[1] = 0;
            s.fx.set([0, 0, rand, 1]);
          }
        }
        for (let piece = 0; piece < pieces; piece++) {
          // Shatter: each letter breaks into quarters that fly apart, spin and fall. Glitter: flakes swirl in from a cloud.
          const pu = piece % n;
          const pv = Math.floor(piece / n);
          const cu = (pu + 0.5) / n - 0.5;
          const cv = (pv + 0.5) / n - 0.5;
          const fly = shatter ? ot * (2.5 + 3 * hash2(L.index * 4 + piece, seed)) : 0;
          const fr = (j: number): number => hash2(L.index * 37 + piece, seed * 3 + j);
          for (let d = glitter ? 0 : depthLayers; d >= 0; d--) {
            const s = this.slot();
            if (!s) break;
            const mm = this.mm.copy(this.m);
            if (shatter) {
              this.t.makeTranslation(cu * g.w + 2 * cu * fly, cv * g.h + 2 * cv * fly - ot * ot * 4, fly * 0.6);
              mm.multiply(this.t);
              this.t.makeRotationFromEuler(this.e.set(ot * 8 * cv, ot * 6 * cu, ot * 6 * (hash2(piece, L.index) - 0.5)));
              mm.multiply(this.t);
            } else if (glitter) {
              // Out in the cloud the flakes orbit the letter; they spiral in as the scatter falls to 0.
              const r = sc * (1.2 + 2.4 * fr(1));
              const ang = fr(2) * Math.PI * 2 + sc * 4 + now * 1.5 * sc;
              this.t.makeTranslation(cu * g.w + Math.cos(ang) * r, cv * g.h + Math.sin(ang) * r * 0.7 + sc * (fr(3) - 0.3) * 1.5, sc * (fr(4) - 0.5) * 3);
              mm.multiply(this.t);
              this.t.makeRotationFromEuler(this.e.set(sc * 9 * (fr(5) - 0.5), sc * 9 * (fr(6) - 0.5), sc * 6 * (fr(7) - 0.5)));
              mm.multiply(this.t);
            }
            this.t.makeTranslation(qx, qy, -d * dz);
            mm.multiply(this.t);
            this.t.makeScale(g.w / n, g.h / n, 1);
            mm.multiply(this.t);
            s.z = mm.elements[14];
            s.m.set(mm.elements);
            if (n > 1) {
              const u0 = g.u0 + ((g.u1 - g.u0) * pu) / n;
              const v0 = g.v0 + ((g.v1 - g.v0) * (n - 1 - pv)) / n;
              s.uv.set([u0, v0, u0 + (g.u1 - g.u0) / n, v0 + (g.v1 - g.v0) / n]);
            } else s.uv.set([g.u0, g.v0, g.u1, g.v1]);
            // Sides shade darker toward the back; the face takes the glow.
            const shade = d === 0 ? 1 : 0.9 - 0.55 * (d / Math.max(1, depthLayers));
            if (d === 0) s.col.set([face[0], face[1], face[2], alpha]);
            else s.col.set([side[0] * shade, side[1] * shade, side[2] * shade, alpha]);
            s.kind[0] = d === 0 ? 0 : 1;
            s.kind[1] = pose.glow;
            s.fx.set([matIndex, burn, glitter ? fr(8) : rand, 0]);
          }
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
      this.aFx.set(d.fx, i * 4);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.kindAttr.needsUpdate = true;
    this.fxAttr.needsUpdate = true;
    const shownLine = sung?.line;
    this.info = {
      index,
      text: shownLine?.text ?? '',
      card,
      positionMs: now * 1000,
      style,
      chorus: !!sung?.chorus,
      hero: sung && sung.hero >= 0 ? sung.line.words[sung.hero]?.text ?? '' : '',
      intensity,
    };
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
