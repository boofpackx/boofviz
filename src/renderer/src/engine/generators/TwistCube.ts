import * as THREE from 'three';
import { hash01 } from '../modulation';
import { PALETTE_GLSL } from '../shaders/common';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/** One quarter turn of a slice: axis 0/1/2 = x/y/z, layer −1/0/1, direction ±1. */
interface Move {
  axis: number;
  layer: number;
  dir: number;
}

const MAX_MOVES = 64;
const SPACING = 1;

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in mat4 instanceMatrix;
in vec3 aHome;
in float aGlint;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uRound, uCubie;
out vec3 vLocal;
out vec3 vLocalN;
out vec3 vWorld;
out vec3 vN;
out vec3 vHome;
out float vGlint;
// The box is cut 10×10×10; push the outer four cuts of each axis into the rounded band.
float remap(float x, float r) {
  float a = abs(x);
  float y = a <= 0.1 ? a / 0.1 * (0.5 - r) : 0.5 - r + (a - 0.1) / 0.4 * r;
  return sign(x) * y;
}
void main() {
  float r = uRound;
  vec3 p = vec3(remap(position.x, r), remap(position.y, r), remap(position.z, r));
  vec3 inner = clamp(p, vec3(-0.5 + r), vec3(0.5 - r));
  vec3 d = p - inner;
  vec3 n = dot(d, d) > 1e-10 ? normalize(d) : normalize(position);
  p = (inner + n * r) * uCubie;
  vLocal = p;
  vLocalN = n;
  vHome = aHome;
  vGlint = aGlint;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(m) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
uniform vec3 cameraPosition;
uniform vec3 uFace[6];
uniform vec3 uBody;
uniform float uBodyF0, uBodyRough, uStickerRough, uInset, uStickerRound, uCubie, uRim, uKick, uSnare;
in vec3 vLocal;
in vec3 vLocalN;
in vec3 vWorld;
in vec3 vN;
in vec3 vHome;
in float vGlint;
out vec4 fragColor;

// Photo-studio surround: dark sweep, a big key softbox, a coloured strip light and a floor bounce.
vec3 studio(vec3 d, float rough) {
  vec3 c = mix(vec3(0.015), vec3(0.06), smoothstep(-0.3, 0.9, d.y));
  float w = 0.02 + rough * 0.5;
  vec3 key = normalize(vec3(-0.55, 0.7, 0.45));
  c += vec3(4.0) * smoothstep(0.86 - w, 0.9 + w * 0.2, dot(d, key));
  vec3 strip = normalize(vec3(0.95, 0.05, -0.1));
  float s = smoothstep(0.035 + w, 0.0, abs(dot(d, normalize(cross(strip, vec3(0.0, 1.0, 0.0)))))) * smoothstep(0.2, 0.6, dot(d, strip));
  c += palette(0.8) * 2.5 * s;
  c += palette(0.3) * 0.25 * smoothstep(0.0, -0.6, d.y);
  return c;
}

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWorld);
  // Which face of the piece is this, and does it face outwards in the solved cube?
  vec3 an = abs(vLocalN);
  int axis = an.x > an.y ? (an.x > an.z ? 0 : 2) : (an.y > an.z ? 1 : 2);
  float sgn = axis == 0 ? sign(vLocalN.x) : axis == 1 ? sign(vLocalN.y) : sign(vLocalN.z);
  float home = axis == 0 ? vHome.x : axis == 1 ? vHome.y : vHome.z;
  vec3 face = uFace[axis * 2 + (sgn > 0.0 ? 0 : 1)];
  vec2 q = axis == 0 ? vLocal.yz : axis == 1 ? vLocal.xz : vLocal.xy;
  float flatness = smoothstep(0.97, 0.998, max(an.x, max(an.y, an.z)));
  float dq = sdRoundRect(q, vec2(0.5 * uCubie - uInset), uStickerRound);
  float sticker = abs(home - sgn) < 0.5 ? (1.0 - smoothstep(-0.003, 0.003, dq)) * flatness : 0.0;

  vec3 base = mix(uBody, face, sticker);
  float rough = mix(uBodyRough, uStickerRough, sticker);
  float f0 = mix(uBodyF0, 0.045, sticker);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.4));
  float diff = 0.3 + 1.0 * max(dot(n, L), 0.0) + 0.15 * max(dot(n, -L), 0.0);
  float nv = max(dot(n, v), 0.0);
  float fres = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
  vec3 col = base * diff * (1.0 - f0) + studio(reflect(-v, n), rough) * fres * mix(1.0, 0.6, rough);
  // Rim light from the palette, kicked by the bass drum; the turning slice catches a glint on the snare.
  col += palette(0.85) * pow(1.0 - nv, 3.0) * (uRim * 0.35 + 0.8 * uKick);
  col += face * sticker * vGlint * (0.6 + 1.5 * uSnare);
  fragColor = vec4(col, 1.0);
}
`;

const CORE_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const CORE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
out vec4 fragColor;
void main() { fragColor = vec4(uColor, 1.0); }
`;

const SHADOW_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const SHADOW_FRAG = /* glsl */ `
precision highp float;
uniform float uStrength;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  fragColor = vec4(0.0, 0.0, 0.0, uStrength * exp(-r * r * 4.5) * smoothstep(1.0, 0.7, r));
}
`;

// Standard scheme: +x red, −x orange, +y white, −y yellow, +z green, −z blue.
const CLASSIC = ['#c41e1e', '#ff6d00', '#f4f4f0', '#ffd400', '#00a650', '#0051ba'];

/** 90° rotation matrices (row-major 3×3) about x/y/z, for dir ±1. */
function rot90(axis: number, dir: number): number[] {
  if (axis === 0) return [1, 0, 0, 0, 0, -dir, 0, dir, 0];
  if (axis === 1) return [0, 0, dir, 0, 1, 0, -dir, 0, 0];
  return [0, -dir, 0, dir, 0, 0, 0, 0, 1];
}

function mul3(a: number[], b: number[], out: number[]): void {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
}

function easeOutBack(x: number): number {
  const c1 = 1.4;
  const t = Math.min(1, Math.max(0, x)) - 1;
  return 1 + (c1 + 1) * t * t * t + c1 * t * t;
}

function easeInOutCubic(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * A 3×3 twisting puzzle cube that plays to the music: one slice turn per
 * beat slot, scrambling through the first half of each cycle and undoing the
 * same moves in the second half, so it is solved again exactly on the next
 * phrase. The whole cube tumbles on the bar and bursts apart on a drop.
 *
 * The puzzle state is rebuilt from scratch every frame from the beat counter
 * (at most a few dozen integer moves), so every window shows the same cube.
 */
export class TwistCube implements Generator {
  readonly kind = 'twistCube';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
  private readonly geo: THREE.BoxGeometry;
  private readonly mat: THREE.RawShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly glint = new Float32Array(27);
  private readonly glintAttr: THREE.InstancedBufferAttribute;
  private readonly core: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly cube = new THREE.Group();
  // Puzzle state: integer position and orientation per piece.
  private readonly home: number[][] = [];
  private readonly pos: number[][] = [];
  private readonly rot: number[][] = [];
  private readonly tmp = new Array<number>(9).fill(0);
  private readonly moves: Move[] = [];
  private movesKey = '';
  private readonly m4 = new THREE.Matrix4();
  private readonly t4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly vn = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly axisVec = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

  constructor() {
    const homes = new Float32Array(27 * 3);
    let i = 0;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          this.home.push([x, y, z]);
          this.pos.push([x, y, z]);
          this.rot.push([1, 0, 0, 0, 1, 0, 0, 0, 1]);
          homes.set([x, y, z], i * 3);
          i++;
        }
    this.geo = new THREE.BoxGeometry(1, 1, 1, 10, 10, 10);
    this.geo.setAttribute('aHome', new THREE.InstancedBufferAttribute(homes, 3));
    this.glintAttr = new THREE.InstancedBufferAttribute(this.glint, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aGlint', this.glintAttr);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uRound: { value: 0.12 },
        uCubie: { value: 0.955 },
        uFace: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
        uBody: { value: new THREE.Vector3() },
        uBodyF0: { value: 0.04 },
        uBodyRough: { value: 0.5 },
        uStickerRough: { value: 0.15 },
        uInset: { value: 0.06 },
        uStickerRound: { value: 0.08 },
        uRim: { value: 0.6 },
        uKick: { value: 0 },
        uSnare: { value: 0 },
        uPal: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
      },
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, 27);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // A dark core sphere fills the gaps between pieces; being round, a turning slice never uncovers it.
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(1.42, 32, 16),
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, uniforms: { uColor: { value: new THREE.Vector3(0.004, 0.004, 0.005) } } }),
    );
    this.cube.add(this.core, this.mesh);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        uniforms: { uStrength: { value: 0.6 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -2.45;
    this.scene.add(this.shadow, this.cube);
  }

  /** The scramble for one cycle: never the same slice twice in a row, then undone in reverse. */
  private buildMoves(cycle: number, count: number, slices: boolean): void {
    const key = `${cycle}:${count}:${slices}`;
    if (key === this.movesKey) return;
    this.movesKey = key;
    this.moves.length = 0;
    const half = Math.floor(count / 2);
    let lastAxis = -1;
    for (let i = 0; i < half; i++) {
      let axis = Math.floor(hash01(i, cycle * 31 + 1) * 3);
      // Consecutive turns on the same axis read as one move: rotate to another axis.
      if (axis === lastAxis) axis = (axis + 1 + Math.floor(hash01(i, cycle * 31 + 4) * 2)) % 3;
      lastAxis = axis;
      const outer = hash01(i, cycle * 31 + 2) < 0.5 ? -1 : 1;
      const layer = slices && hash01(i, cycle * 31 + 5) < 0.2 ? 0 : outer;
      const dir = hash01(i, cycle * 31 + 3) < 0.5 ? -1 : 1;
      this.moves.push({ axis, layer, dir });
    }
    for (let i = half - 1; i >= 0; i--) {
      const m = this.moves[i];
      this.moves.push({ axis: m.axis, layer: m.layer, dir: -m.dir });
    }
  }

  private applyMove(m: Move): void {
    const r = rot90(m.axis, m.dir);
    for (let i = 0; i < 27; i++) {
      const p = this.pos[i];
      if (p[m.axis] !== m.layer) continue;
      const x = p[0];
      const y = p[1];
      const z = p[2];
      p[0] = r[0] * x + r[1] * y + r[2] * z;
      p[1] = r[3] * x + r[4] * y + r[5] * z;
      p[2] = r[6] * x + r[7] * y + r[8] * z;
      mul3(r, this.rot[i], this.tmp);
      for (let k = 0; k < 9; k++) this.rot[i][k] = this.tmp[k];
    }
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const env = ctx.env;
    const beat = ctx.beat;
    const bpb = Math.max(1, f.beatsPerBar);
    const cycleBeats = Math.max(bpb, f.beatsPerPhrase * Math.max(1, Math.round(num(p.cyclePhrases, 1))));
    const cycle = Math.floor(beat / cycleBeats);
    const local = beat - cycle * cycleBeats;

    // Slice turns: one per slot, each snapping round with an overshoot that lands on the slot start.
    const slot = bpb / Math.max(1, Math.round(num(p.turnsPerBar, 4)));
    const count = Math.min(MAX_MOVES, Math.floor(cycleBeats / slot));
    this.buildMoves(cycle, count, p.slices !== false);
    for (let i = 0; i < 27; i++) {
      const h = this.home[i];
      this.pos[i][0] = h[0];
      this.pos[i][1] = h[1];
      this.pos[i][2] = h[2];
      const r = this.rot[i];
      r.fill(0);
      r[0] = r[4] = r[8] = 1;
    }
    const k = Math.min(this.moves.length, Math.floor(local / slot));
    for (let i = 0; i < k; i++) this.applyMove(this.moves[i]);
    const cur = k < this.moves.length ? this.moves[k] : null;
    const snap = Math.max(0.05, num(p.snap, 0.35));
    const turnT = cur ? easeOutBack((local - k * slot) / slot / snap) : 0;
    const turnAngle = cur ? (cur.dir * Math.PI * 0.5 * turnT) : 0;

    // Whole-cube tumble: a 90° roll on each downbeat through the first half of the cycle, undone in the second.
    const bars = Math.floor(cycleBeats / bpb);
    const halfBars = Math.floor(bars / 2);
    const barIdx = Math.floor(local / bpb);
    const tumble = p.tumble !== false;
    this.q.identity();
    if (tumble) {
      const tumbleAt = (j: number): [number, number] => [Math.floor(hash01(j, cycle * 17 + 9) * 3), hash01(j, cycle * 17 + 10) < 0.5 ? -1 : 1];
      const step = (j: number, amount: number): void => {
        const forward = j < halfBars;
        const src = forward ? j : 2 * halfBars - 1 - j;
        if (src < 0) return;
        const [ax, d] = tumbleAt(src);
        this.q2.setFromAxisAngle(this.axisVec[ax], (forward ? d : -d) * Math.PI * 0.5 * amount);
        this.q.premultiply(this.q2);
      };
      for (let j = 0; j < Math.min(barIdx, 2 * halfBars); j++) step(j, 1);
      if (barIdx < 2 * halfBars) step(barIdx, easeInOutCubic((local - barIdx * bpb) / Math.min(bpb, 1.5)));
    }
    const spin = num(p.spin, 0.15);
    this.q2.setFromAxisAngle(this.axisVec[1], (2 * Math.PI * spin * beat) / (bpb * 4));
    this.q.premultiply(this.q2);
    const size = num(p.size, 1) * (1 + num(p.punch, 0.06) * env.kick);
    this.cube.quaternion.copy(this.q);
    this.cube.scale.setScalar(size);

    // Pieces: slice rotation, then the drop burst (each piece flies out along its position and spins).
    // The drop envelope decays slowly; a steep curve makes the burst snap back within a couple of bars.
    const burst = num(p.explode, 1.2) * Math.pow(env.drop, 4);
    for (let i = 0; i < 27; i++) {
      const pp = this.pos[i];
      const r = this.rot[i];
      this.m4.set(r[0], r[1], r[2], pp[0] * SPACING, r[3], r[4], r[5], pp[1] * SPACING, r[6], r[7], r[8], pp[2] * SPACING, 0, 0, 0, 1);
      if (burst > 1e-4) {
        this.v.set(pp[0] + 0.3 * (hash01(i, 101) - 0.5), pp[1] + 0.3 * (hash01(i, 102) - 0.5), pp[2] + 0.3 * (hash01(i, 103) - 0.5));
        this.t4.makeRotationAxis(this.vn.copy(this.v).normalize(), burst * Math.PI * (hash01(i, 104) - 0.5) * 2);
        this.m4.premultiply(this.t4);
        this.t4.makeTranslation(this.v.x * burst, this.v.y * burst, this.v.z * burst);
        this.m4.premultiply(this.t4);
      }
      const moving = cur !== null && pp[cur.axis] === cur.layer;
      if (moving) {
        this.t4.makeRotationAxis(this.axisVec[cur.axis], turnAngle);
        this.m4.premultiply(this.t4);
      }
      this.glint[i] = moving ? 1 - Math.min(1, turnT) * 0.5 : 0;
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glintAttr.needsUpdate = true;

    // Look: finish, sticker colours, palette.
    const u = this.mat.uniforms;
    const style = String(p.style ?? 'stickers');
    const pal = ctx.palette;
    const faces = u.uFace.value as THREE.Vector3[];
    const c = this.color;
    for (let fi = 0; fi < 6; fi++) {
      if (p.colors === 'palette') {
        // Five palette stops plus white, skipping the darkest (background) stop.
        const t = [1, 2, 3, 4, -1, 2.5][fi];
        if (t < 0) faces[fi].set(0.9, 0.9, 0.88);
        else {
          const i0 = Math.floor(t);
          const i1 = Math.min(4, i0 + 1);
          const w = t - i0;
          faces[fi].set(pal[i0 * 3] * (1 - w) + pal[i1 * 3] * w, pal[i0 * 3 + 1] * (1 - w) + pal[i1 * 3 + 1] * w, pal[i0 * 3 + 2] * (1 - w) + pal[i1 * 3 + 2] * w);
        }
      } else {
        c.set(CLASSIC[fi]);
        faces[fi].set(c.r, c.g, c.b);
      }
    }
    const body = u.uBody.value as THREE.Vector3;
    if (style === 'chrome') {
      body.set(0.02, 0.02, 0.025);
      u.uBodyF0.value = 0.85;
      u.uBodyRough.value = 0.06;
      u.uStickerRough.value = 0.05;
      u.uInset.value = 0.09;
      u.uStickerRound.value = 0.1;
    } else if (style === 'candy') {
      body.set(0.012, 0.012, 0.014);
      u.uBodyF0.value = 0.05;
      u.uBodyRough.value = 0.25;
      u.uStickerRough.value = 0.04;
      u.uInset.value = 0.025;
      u.uStickerRound.value = 0.14;
    } else {
      body.set(0.006, 0.006, 0.007);
      u.uBodyF0.value = 0.04;
      u.uBodyRough.value = 0.55;
      u.uStickerRough.value = 0.22;
      u.uInset.value = 0.065;
      u.uStickerRound.value = 0.07;
    }
    u.uRound.value = num(p.round, 0.12);
    u.uRim.value = num(p.glow, 0.6);
    u.uKick.value = env.kick;
    u.uSnare.value = env.snare;
    const pv = u.uPal.value as THREE.Vector3[];
    for (let i = 0; i < 5; i++) pv[i].set(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]);
    this.shadow.position.y = -2.4 * size;
    this.shadow.scale.setScalar(size);
    (this.shadow.material as THREE.RawShaderMaterial).uniforms.uStrength.value = num(p.shadow, 0.6) * (1 - Math.min(1, burst * 0.5));

    // Camera: a three-quarter view from above, pulled back to frame the cube.
    const tilt = num(p.tilt, 0.45);
    const dist = 14;
    const yaw = 0.62;
    this.camera.position.set(dist * Math.sin(yaw) * Math.cos(tilt), dist * Math.sin(tilt), dist * Math.cos(yaw) * Math.cos(tilt));
    this.camera.lookAt(0, -0.15, 0);
    this.camera.aspect = ctx.width / Math.max(1, ctx.height);
    this.camera.updateProjectionMatrix();
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
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
