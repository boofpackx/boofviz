import * as THREE from 'three';
import { BOARD_FRAG, BOARD_VERT, FIRE_FRAG, FIRE_VERT, GEM_FRAG, GEM_VERT, SOLID_FRAG, SOLID_VERT, SPARK_FRAG, SPARK_VERT, TAIL_FRAG, TAIL_VERT } from './shaders';

/** Linear (HDR) lane colours: green, red, yellow, blue, orange. */
export const LANE_RGB: Array<[number, number, number]> = [
  [0.06, 1.05, 0.12],
  [1.25, 0.06, 0.05],
  [1.35, 0.98, 0.04],
  [0.07, 0.32, 1.45],
  [1.45, 0.42, 0.02],
];
/** Drum pads: red, yellow, blue, green; the kick bar is orange. */
export const PAD_RGB: Array<[number, number, number]> = [LANE_RGB[1], LANE_RGB[2], LANE_RGB[3], LANE_RGB[0]];
export const KICK_RGB: [number, number, number] = [1.45, 0.42, 0.02];
export const POWER_RGB: [number, number, number] = [0.6, 1.1, 2.0];
const FIRE_TINT: [number, number, number] = [1, 0.55, 0.15];

/** Board length (world units), half width and lane spacing. */
export const BOARD_LEN = 26;
export const BOARD_HALF = 2.75;

export interface GemDraw {
  x: number;
  z: number;
  rgb: [number, number, number];
  alpha: number;
  hopo: boolean;
  power: boolean;
  glow: number;
}

export interface TailDraw {
  x: number;
  z0: number;
  z1: number;
  rgb: [number, number, number];
  /** 1 held (burning), 0 waiting, −1 dropped. */
  held: number;
}

export interface FireDraw {
  x: number;
  z: number;
  start: number;
  seed: number;
  size: number;
  /** 0 a burst of flame, 1 a flash, 2 a flame held on (a sustain). */
  kind: number;
  tint: [number, number, number];
}

export interface HighwayFrame {
  beat: number;
  unitsPerBeat: number;
  barOffset: number;
  beatsPerBar: number;
  power: number;
  time: number;
  whammy: number;
  theme: number;
  tint: [number, number, number];
  /** Per lane, how lit the row of frets is (hits). */
  flash: number[];
  /** Per lane, 0..1: the button pressed down. */
  pressed: number[];
  gems: GemDraw[];
  stars: GemDraw[];
  kicks: GemDraw[];
  tails: TailDraw[];
  fires: FireDraw[];
}

const PREMULT = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
const ADD = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

function raw(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms, ...extra });
}

/** A chrome puck with a domed cap (the cap starts at y = 0.1). */
function puckGeometry(): THREE.BufferGeometry {
  const pts = [
    [0, 0],
    [0.38, 0],
    [0.41, 0.025],
    [0.415, 0.075],
    [0.4, 0.1],
    [0.345, 0.101],
    [0.335, 0.135],
    [0.29, 0.18],
    [0.2, 0.215],
    [0, 0.228],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 28);
  g.computeVertexNormals();
  return g;
}

/** A five-point star gem, lying flat (its top face is the cap). */
function starGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.21 : 0.5;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.035, 0);
  g.computeVertexNormals();
  return g;
}

/** The ribbon a sustain tail is drawn on: x across (−½..½), y along (0..1). */
function ribbonGeometry(segments: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) pos.push(-0.5, i / segments, 0, 0.5, i / segments, 0);
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function quadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

class GemBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly info: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();

  constructor(
    geo: THREE.BufferGeometry,
    readonly max: number,
    split: number,
    ringR: number,
    order: number,
    private readonly scale: [number, number, number] = [1, 1, 1],
  ) {
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    geo.setAttribute('aColor', this.color);
    geo.setAttribute('aInfo', this.info);
    const mat = raw(GEM_VERT, GEM_FRAG, { uSplit: { value: split }, uRingR: { value: ringR } }, { transparent: true, depthWrite: true, ...PREMULT });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.count = 0;
  }

  set(list: GemDraw[]): void {
    const n = Math.min(this.max, list.length);
    for (let i = 0; i < n; i++) {
      const g = list[i];
      this.m.makeScale(this.scale[0], this.scale[1], this.scale[2]).setPosition(g.x, 0, g.z);
      this.mesh.setMatrixAt(i, this.m);
      this.color.setXYZ(i, g.rgb[0], g.rgb[1], g.rgb[2]);
      this.info.setXYZW(i, g.alpha, g.hopo ? 1 : 0, g.power ? 1 : 0, g.glow);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.color.needsUpdate = true;
    this.info.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** One fret button: a chrome rim, a coloured ring and a disc that lights when pressed. */
class Fret {
  readonly group = new THREE.Group();
  private readonly ringMat: THREE.RawShaderMaterial;
  private readonly discMat: THREE.RawShaderMaterial;
  private readonly disc: THREE.Mesh;

  constructor(
    private readonly rgb: [number, number, number],
    geos: { rim: THREE.BufferGeometry; ring: THREE.BufferGeometry; disc: THREE.BufferGeometry },
    rimMat: THREE.RawShaderMaterial,
  ) {
    const rim = new THREE.Mesh(geos.rim, rimMat);
    rim.position.y = 0.035;
    this.ringMat = raw(SOLID_VERT, SOLID_FRAG, { uColor: { value: new THREE.Vector3(...rgb) }, uGlow: { value: new THREE.Vector3() }, uMetal: { value: 0.15 } });
    const ring = new THREE.Mesh(geos.ring, this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.085;
    this.discMat = raw(SOLID_VERT, SOLID_FRAG, { uColor: { value: new THREE.Vector3(0.02, 0.02, 0.025) }, uGlow: { value: new THREE.Vector3() }, uMetal: { value: 0.3 } });
    this.disc = new THREE.Mesh(geos.disc, this.discMat);
    this.disc.position.y = 0.075;
    this.group.add(rim, ring, this.disc);
    for (const m of [rim, ring, this.disc]) m.renderOrder = 2;
  }

  set(pressed: number, power: boolean): void {
    const c = power ? POWER_RGB : this.rgb;
    (this.discMat.uniforms.uGlow.value as THREE.Vector3).set(c[0] * pressed * 1.4, c[1] * pressed * 1.4, c[2] * pressed * 1.4);
    (this.ringMat.uniforms.uGlow.value as THREE.Vector3).set(c[0] * (0.35 + pressed), c[1] * (0.35 + pressed), c[2] * (0.35 + pressed));
    this.disc.position.y = 0.075 - 0.03 * pressed;
  }

  dispose(): void {
    this.ringMat.dispose();
    this.discMat.dispose();
  }
}

const SPARKS = 256;

/**
 * One highway: the neck, its frets, the gems on their way down, sustain
 * tails, fire at the frets and sparks. Built once; each frame the generator
 * hands it what to draw (positions in world units: lanes one unit apart,
 * the frets at z = 0, the far end at z = −BOARD_LEN).
 */
export class Highway {
  readonly group = new THREE.Group();
  readonly lanes: number;
  readonly laneW: number;
  private readonly board: THREE.Mesh;
  private readonly boardMat: THREE.RawShaderMaterial;
  private readonly frets: Fret[] = [];
  private readonly fretGeos: { rim: THREE.BufferGeometry; ring: THREE.BufferGeometry; disc: THREE.BufferGeometry };
  private readonly rimMat: THREE.RawShaderMaterial;
  private readonly gems: GemBatch;
  private readonly stars: GemBatch;
  private readonly kicks: GemBatch;
  private readonly tails: THREE.Mesh;
  private readonly tailGeo: THREE.InstancedBufferGeometry;
  private readonly tailMat: THREE.RawShaderMaterial;
  private readonly fire: THREE.Mesh;
  private readonly fireGeo: THREE.InstancedBufferGeometry;
  private readonly fireMat: THREE.RawShaderMaterial;
  private readonly sparks: THREE.Points;
  private readonly sparkMat: THREE.RawShaderMaterial;
  private sparkNext = 0;

  constructor(readonly drums: boolean) {
    this.lanes = drums ? 4 : 5;
    this.laneW = drums ? 1.25 : 1;
    // The neck.
    const boardGeo = new THREE.PlaneGeometry(BOARD_HALF * 2, BOARD_LEN + 2, 1, 1);
    boardGeo.rotateX(-Math.PI / 2);
    boardGeo.translate(0, 0, -(BOARD_LEN + 2) / 2 + 2);
    this.boardMat = raw(
      BOARD_VERT,
      BOARD_FRAG,
      {
        uBeat: { value: 0 },
        uUnitsPerBeat: { value: 6 },
        uBarOffset: { value: 0 },
        uBeatsPerBar: { value: 4 },
        uLen: { value: BOARD_LEN },
        uHalf: { value: BOARD_HALF },
        uLanes: { value: this.lanes },
        uLaneW: { value: this.laneW },
        uPower: { value: 0 },
        uTime: { value: 0 },
        uTheme: { value: 0 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uFlash: { value: [0, 0, 0, 0, 0] },
        uDrums: { value: drums ? 1 : 0 },
      },
      { transparent: true, depthWrite: true, ...PREMULT },
    );
    this.board = new THREE.Mesh(boardGeo, this.boardMat);
    this.board.renderOrder = 0;
    this.group.add(this.board);
    // Frets.
    this.fretGeos = { rim: new THREE.CylinderGeometry(0.47, 0.5, 0.07, 32), ring: new THREE.TorusGeometry(0.36, 0.07, 10, 32), disc: new THREE.CylinderGeometry(0.29, 0.29, 0.05, 28) };
    this.rimMat = raw(SOLID_VERT, SOLID_FRAG, { uColor: { value: new THREE.Vector3(0.9, 0.9, 0.95) }, uGlow: { value: new THREE.Vector3() }, uMetal: { value: 0.95 } });
    const colours = drums ? [...PAD_RGB] : LANE_RGB;
    for (let i = 0; i < this.lanes; i++) {
      const f = new Fret(colours[i], this.fretGeos, this.rimMat);
      f.group.position.set(this.laneX(i), 0, 0);
      this.frets.push(f);
      this.group.add(f.group);
    }
    // Gems.
    this.gems = new GemBatch(puckGeometry(), 128, 0.1005, 0.315, 3, drums ? [1.12, 1, 1.12] : [1, 1, 1]);
    this.stars = new GemBatch(starGeometry(), 64, 0.1, 9, 3, drums ? [1.1, 1, 1.1] : [1, 1, 1]);
    const kickGeo = new THREE.BoxGeometry(this.lanes * this.laneW - 0.2, 0.09, 0.2);
    kickGeo.translate(0, 0.045, 0);
    this.kicks = new GemBatch(kickGeo, 32, 0.07, 9, 3);
    this.group.add(this.gems.mesh, this.stars.mesh, this.kicks.mesh);
    // Sustain tails.
    this.tailGeo = ribbonGeometry(40);
    this.tailGeo.setAttribute('aTail', new THREE.InstancedBufferAttribute(new Float32Array(32 * 4), 4));
    this.tailGeo.setAttribute('aState', new THREE.InstancedBufferAttribute(new Float32Array(32 * 4), 4));
    this.tailGeo.instanceCount = 0;
    this.tailMat = raw(TAIL_VERT, TAIL_FRAG, { uTime: { value: 0 }, uWhammy: { value: 0 }, uLen: { value: BOARD_LEN } }, { transparent: true, depthWrite: false, ...PREMULT });
    this.tails = new THREE.Mesh(this.tailGeo, this.tailMat);
    this.tails.frustumCulled = false;
    this.tails.renderOrder = 1;
    this.group.add(this.tails);
    // Fire and flashes.
    this.fireGeo = quadGeometry();
    this.fireGeo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(48 * 3), 3));
    this.fireGeo.setAttribute('aFire', new THREE.InstancedBufferAttribute(new Float32Array(48 * 4), 4));
    this.fireGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(48 * 3), 3));
    this.fireGeo.instanceCount = 0;
    this.fireMat = raw(FIRE_VERT, FIRE_FRAG, { uTime: { value: 0 } }, { transparent: true, depthWrite: false, depthTest: false, ...ADD });
    this.fire = new THREE.Mesh(this.fireGeo, this.fireMat);
    this.fire.frustumCulled = false;
    this.fire.renderOrder = 5;
    this.group.add(this.fire);
    // Sparks.
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sg.setAttribute('aVel', new THREE.Float32BufferAttribute(new Float32Array(SPARKS * 3), 3));
    const life = new Float32Array(SPARKS * 2);
    for (let i = 0; i < SPARKS; i++) life[i * 2] = -100;
    sg.setAttribute('aLife', new THREE.Float32BufferAttribute(life, 2));
    this.sparkMat = raw(SPARK_VERT, SPARK_FRAG, { uTime: { value: 0 }, uScale: { value: 30 }, uColor: { value: new THREE.Vector3(1.4, 1.0, 0.45) } }, { transparent: true, depthWrite: false, depthTest: false, ...ADD });
    this.sparks = new THREE.Points(sg, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 6;
    this.group.add(this.sparks);
  }

  /** World x of lane i. */
  laneX(i: number): number {
    return (i - (this.lanes - 1) / 2) * this.laneW;
  }

  /** Throw `n` sparks up from (x, z) at clock time t. */
  sparksAt(x: number, z: number, t: number, n: number, seed: number, power: boolean): void {
    const g = this.sparks.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const vel = g.getAttribute('aVel') as THREE.BufferAttribute;
    const life = g.getAttribute('aLife') as THREE.BufferAttribute;
    for (let k = 0; k < n; k++) {
      const i = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % SPARKS;
      const h = (j: number): number => {
        const v = Math.sin((seed * 97.13 + k * 13.7 + j * 3.1) * 12.9898) * 43758.5453;
        return v - Math.floor(v);
      };
      pos.setXYZ(i, x + (h(1) - 0.5) * 0.3, 0.15, z + (h(2) - 0.5) * 0.2);
      const a = (h(3) - 0.5) * 2.2;
      const sp = 2.2 + h(4) * 3.2;
      vel.setXYZ(i, Math.sin(a) * sp * 0.6, 2.5 + h(5) * 3.5, -h(6) * 1.2);
      life.setXY(i, t, 0.35 + h(7) * 0.35);
    }
    pos.needsUpdate = vel.needsUpdate = life.needsUpdate = true;
    if (power) (this.sparkMat.uniforms.uColor.value as THREE.Vector3).set(0.9, 1.4, 2.2);
    else (this.sparkMat.uniforms.uColor.value as THREE.Vector3).set(1.5, 1.05, 0.45);
  }

  update(f: HighwayFrame): void {
    const u = this.boardMat.uniforms;
    u.uBeat.value = f.beat;
    u.uUnitsPerBeat.value = f.unitsPerBeat;
    u.uBarOffset.value = f.barOffset;
    u.uBeatsPerBar.value = f.beatsPerBar;
    u.uPower.value = f.power;
    u.uTime.value = f.time;
    u.uTheme.value = f.theme;
    (u.uTint.value as THREE.Vector3).set(...f.tint);
    const flash = u.uFlash.value as number[];
    for (let i = 0; i < 5; i++) flash[i] = f.flash[i] ?? 0;
    for (let i = 0; i < this.lanes; i++) this.frets[i].set(f.pressed[i] ?? 0, f.power > 0.5);
    this.gems.set(f.gems);
    this.stars.set(f.stars);
    this.kicks.set(f.kicks);
    // Tails.
    const tail = this.tailGeo.getAttribute('aTail') as THREE.InstancedBufferAttribute;
    const st = this.tailGeo.getAttribute('aState') as THREE.InstancedBufferAttribute;
    const nt = Math.min(32, f.tails.length);
    for (let i = 0; i < nt; i++) {
      const t = f.tails[i];
      tail.setXYZW(i, t.x, t.z0, t.z1, this.drums ? 0.2 : 0.17);
      st.setXYZW(i, t.rgb[0], t.rgb[1], t.rgb[2], t.held);
    }
    tail.needsUpdate = st.needsUpdate = true;
    this.tailGeo.instanceCount = nt;
    this.tailMat.uniforms.uTime.value = f.time;
    this.tailMat.uniforms.uWhammy.value = f.whammy;
    // Fire.
    const fp = this.fireGeo.getAttribute('aPos') as THREE.InstancedBufferAttribute;
    const ff = this.fireGeo.getAttribute('aFire') as THREE.InstancedBufferAttribute;
    const ftint = this.fireGeo.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    const nf = Math.min(48, f.fires.length);
    for (let i = 0; i < nf; i++) {
      const fi = f.fires[i];
      fp.setXYZ(i, fi.x, fi.kind === 1 ? 0.12 : 0.05, fi.z);
      ff.setXYZW(i, fi.start, fi.seed, fi.size, fi.kind);
      ftint.setXYZ(i, ...(fi.tint ?? FIRE_TINT));
    }
    fp.needsUpdate = ff.needsUpdate = ftint.needsUpdate = true;
    this.fireGeo.instanceCount = nf;
    this.fireMat.uniforms.uTime.value = f.time;
    this.sparkMat.uniforms.uTime.value = f.time;
  }

  dispose(): void {
    this.board.geometry.dispose();
    this.boardMat.dispose();
    for (const f of this.frets) f.dispose();
    this.fretGeos.rim.dispose();
    this.fretGeos.ring.dispose();
    this.fretGeos.disc.dispose();
    this.rimMat.dispose();
    this.gems.dispose();
    this.stars.dispose();
    this.kicks.dispose();
    this.tailGeo.dispose();
    this.tailMat.dispose();
    this.fireGeo.dispose();
    this.fireMat.dispose();
    this.sparks.geometry.dispose();
    this.sparkMat.dispose();
  }
}

export const FIRE_DEFAULT_TINT = FIRE_TINT;
