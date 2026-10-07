import * as THREE from 'three';
import { hash2 } from '../lostMedia';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

const GX = 14;
const GY = 9;
const GZ = 9;
const MAX_SEG = 900;
const DIRS: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface PipeSeg {
  a: [number, number, number];
  b: [number, number, number];
  pipe: number;
  /** A ball joint where the pipe turns (or starts). */
  joint: boolean;
}

/** One screenful of pipes: random walks through a grid that never cross, in growth order (interleaved across pipes). */
export function growPipes(seed: number, pipes = 7, maxLen = 120): PipeSeg[] {
  const used = new Uint8Array(GX * GY * GZ);
  const idx = (x: number, y: number, z: number): number => (z * GY + y) * GX + x;
  const free = (x: number, y: number, z: number): boolean => x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ && !used[idx(x, y, z)];
  const runs: PipeSeg[][] = [];
  let n = 0;
  for (let p = 0; p < pipes; p++) {
    let pos: [number, number, number] = [0, 0, 0];
    for (let tries = 0; tries < 30; tries++) {
      pos = [Math.floor(hash2(seed + p, n++) * GX), Math.floor(hash2(seed + p, n++) * GY), Math.floor(hash2(seed + p, n++) * GZ)];
      if (free(...pos)) break;
    }
    if (!free(...pos)) continue;
    used[idx(...pos)] = 1;
    const run: PipeSeg[] = [];
    let dir = Math.floor(hash2(seed, n++) * 6);
    for (let k = 0; k < maxLen; k++) {
      // Mostly straight; turn now and then, or when blocked.
      let d = dir;
      if (hash2(seed + p * 7, n++) < 0.22) d = Math.floor(hash2(seed + p * 13, n++) * 6);
      const opts = [d, ...[0, 1, 2, 3, 4, 5].sort((a, b) => hash2(a, n + p) - hash2(b, n + p))];
      const next = opts.find((o) => free(pos[0] + DIRS[o][0], pos[1] + DIRS[o][1], pos[2] + DIRS[o][2]));
      n++;
      if (next === undefined) break;
      const np: [number, number, number] = [pos[0] + DIRS[next][0], pos[1] + DIRS[next][1], pos[2] + DIRS[next][2]];
      used[idx(...np)] = 1;
      run.push({ a: pos, b: np, pipe: p, joint: k === 0 || next !== dir });
      dir = next;
      pos = np;
    }
    runs.push(run);
  }
  // Interleave so every pipe grows at once.
  const out: PipeSeg[] = [];
  for (let k = 0; out.length < MAX_SEG; k++) {
    let any = false;
    for (const r of runs) {
      if (k < r.length) {
        out.push(r[k]);
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
}

/**
 * The 3D pipes screensaver: shiny pipes grow through space one segment at a
 * time with ball joints at the turns, on the beat; when the screen is full it
 * clears and starts again.
 */
export class Pipes implements Generator {
  readonly kind = 'pipes';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  private readonly cyl: THREE.InstancedMesh;
  private readonly balls: THREE.InstancedMesh;
  private readonly mat = new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.28 });
  private readonly cylGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 14, 1, true);
  private readonly ballGeo = new THREE.SphereGeometry(0.3, 16, 12);
  private segs: PipeSeg[] = [];
  /** Segment ends in world space (computed once per screenful). */
  private ends: Array<{ a: THREE.Vector3; b: THREE.Vector3 }> = [];
  private readonly end = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private episode = -1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly col = new THREE.Color();

  constructor() {
    this.cyl = new THREE.InstancedMesh(this.cylGeo, this.mat, MAX_SEG);
    this.balls = new THREE.InstancedMesh(this.ballGeo, this.mat, MAX_SEG);
    for (const mesh of [this.cyl, this.balls]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.scene.add(mesh);
    }
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(5, 8, 10);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x99aaff, 0.8);
    rim.position.set(-8, -3, -4);
    this.scene.add(rim);
    this.camera.position.set(0, 0, 21);
    this.camera.lookAt(0, 0, 0);
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const perBeat = Math.max(0.25, num(p.rate, 4));
    const fillBeats = Math.max(4, num(p.clearBars, 32) * ctx.frame.beatsPerBar);
    const ep = Math.floor(ctx.beat / fillBeats);
    if (ep !== this.episode) {
      this.episode = ep;
      this.segs = growPipes(Math.round(num(p.seed, 0)) * 1000 + ep, Math.round(num(p.pipes, 7)));
      const off = (c: [number, number, number]): THREE.Vector3 => new THREE.Vector3(c[0] - (GX - 1) / 2, c[1] - (GY - 1) / 2, c[2] - (GZ - 1) / 2);
      this.ends = this.segs.map((sg) => ({ a: off(sg.a), b: off(sg.b) }));
    }
    const grown = (ctx.beat - ep * fillBeats) * perBeat;
    const n = Math.min(this.segs.length, Math.floor(grown) + 1);
    const frac = Math.min(1, grown - Math.floor(grown));
    const pal = ctx.palette;
    let bi = 0;
    for (let i = 0; i < n; i++) {
      const s = this.segs[i];
      const { a, b } = this.ends[i];
      const t = i === n - 1 ? frac : 1;
      this.end.copy(a).lerp(b, t);
      this.mid.copy(a).add(this.end).multiplyScalar(0.5);
      this.v.copy(b).sub(a).normalize();
      this.q.setFromUnitVectors(this.up, this.v);
      this.m.compose(this.mid, this.q, this.scl.set(1, Math.max(1e-3, t), 1));
      this.cyl.setMatrixAt(i, this.m);
      const k = (s.pipe * 0.17 + 0.1) % 1;
      const ci = Math.min(3, Math.floor(k * 4));
      const f = k * 4 - ci;
      this.col.setRGB(pal[ci * 3] + (pal[ci * 3 + 3] - pal[ci * 3]) * f, pal[ci * 3 + 1] + (pal[ci * 3 + 4] - pal[ci * 3 + 1]) * f, pal[ci * 3 + 2] + (pal[ci * 3 + 5] - pal[ci * 3 + 2]) * f);
      this.col.multiplyScalar(1.2);
      this.cyl.setColorAt(i, this.col);
      if (s.joint) {
        this.m.compose(a, this.q.identity(), this.scl.set(1, 1, 1));
        this.balls.setMatrixAt(bi, this.m);
        this.balls.setColorAt(bi, this.col);
        bi++;
      }
    }
    this.cyl.count = n;
    this.balls.count = bi;
    this.cyl.instanceMatrix.needsUpdate = true;
    this.balls.instanceMatrix.needsUpdate = true;
    if (this.cyl.instanceColor) this.cyl.instanceColor.needsUpdate = true;
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true;
    // A slow drift and a kick nudge, like the screensaver's gentle camera.
    const drift = num(p.drift, 0.3);
    const a = Math.sin(ctx.time * 0.05) * 0.35 * drift;
    this.camera.aspect = ctx.width / Math.max(1, ctx.height);
    this.camera.position.set(Math.sin(a) * 15, Math.sin(ctx.time * 0.037) * 2 * drift, Math.cos(a) * 15 * (1 - 0.02 * ctx.env.kick * num(p.punch, 1)));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
  }

  compileTargets(): CompileTarget[] {
    return [{ scene: this.scene, camera: this.camera }];
  }

  dispose(): void {
    this.cylGeo.dispose();
    this.ballGeo.dispose();
    this.mat.dispose();
  }
}
