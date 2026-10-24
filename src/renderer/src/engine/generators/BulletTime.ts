import * as THREE from 'three';
import { FULLSCREEN_VERT, PALETTE_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { hash01 } from '../modulation';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Bullet Time: the 1999 frozen-moment shot. On each phrase downbeat a burst
 * of glass shards and water droplets flies out from a point; within a beat
 * time all but stops and the camera swings round the frozen cloud in an arc
 * that steps a little, as if cut from a row of still cameras. Dust hangs in a
 * shaft of light. On the drop time snaps back and everything flies again.
 * Shards and droplets streak only while time is running.
 *
 * Colours: the cool green grade of the era, from the palette (stop 1 the
 * shadows, 2 the light, 3 and 4 the glints).
 */

const SHARDS = 220;
const DROPS = 260;
const DUST = 500;

const BG_FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
uniform vec2 uRes;
uniform float uShaft;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uRes.x / uRes.y;
  vec3 c = mix(uPal[0] * 0.6, uPal[1] * 0.5, smoothstep(0.9, -0.3, length(p)));
  // A diagonal shaft of light.
  float d = abs(dot(p, normalize(vec2(1.0, 1.6))) - 0.05);
  c += uPal[2] * 0.05 * uShaft * smoothstep(0.35, 0.0, d);
  fragColor = vec4(c, 1.0);
}
`;

const OBJ_VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aSeed;
uniform float uStreak;
varying vec3 vN;
varying vec3 vView;
varying float vSeed;
void main() {
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  // Streak along the motion while time runs: the leading half stretches forward.
  vec3 dir = aVel;
  float sp = length(dir);
  if (sp > 1e-4 && uStreak > 0.0) {
    vec3 n = dir / sp;
    vec3 c = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float f = dot(wp.xyz - c, n);
    wp.xyz += n * max(f, 0.0) * sp * uStreak * 6.0;
  }
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vView = cameraPosition - wp.xyz;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const OBJ_FRAG = /* glsl */ `
uniform vec3 uPal[5];
uniform int uKind;   // 0 shard (mirror glass), 1 droplet (refractive)
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vView;
varying float vSeed;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  if (!gl_FrontFacing) n = -n;
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  vec3 r = reflect(-v, n);
  // A fake room: a dark green world with one bright window, like the set.
  float window = smoothstep(0.75, 0.95, dot(r, uLight));
  vec3 env = mix(uPal[0], uPal[1], r.y * 0.5 + 0.5) + uPal[3] * window * 3.0;
  float spec = pow(max(dot(r, uLight), 0.0), 120.0);
  vec3 col;
  float alpha;
  if (uKind == 0) {
    // Glass: you see through it except at the edges and where it catches the window.
    col = env * (0.35 + fres * 2.4) + vec3(1.0) * spec * 6.0;
    alpha = clamp(0.14 + fres * 0.95 + spec + window * 0.4, 0.0, 1.0);
  } else if (uKind == 1) {
    // A droplet: clear, a bright rim and a hard highlight.
    col = env * fres * 2.0 + uPal[4] * spec * 8.0 + uPal[2] * 0.05;
    alpha = clamp(0.08 + fres * 1.1 + spec, 0.0, 1.0);
  } else {
    // The bullet: bright chrome.
    col = env * 1.3 + vec3(1.0) * spec * 8.0 + uPal[3] * fres;
    alpha = 1.0;
  }
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uPal[5];
uniform float uAlpha;
varying vec2 vUv;
void main() {
  // A ring of displaced air: bright at its edge, clear in the middle.
  float r = length(vUv - 0.5) * 2.0;
  float rim = smoothstep(0.7, 0.95, r) * smoothstep(1.0, 0.95, r);
  gl_FragColor = vec4(mix(uPal[2], vec3(1.0), 0.5) * rim * uAlpha, 1.0);
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RINGS = 6;

function shardGeometry(seed: number): THREE.BufferGeometry {
  // A thin irregular triangle prism.
  const a = [hash01(seed, 1) - 0.5, hash01(seed, 2) * 0.6 + 0.4];
  const b = [hash01(seed, 3) * 0.6 + 0.3, -hash01(seed, 4) * 0.5];
  const c = [-hash01(seed, 5) * 0.6 - 0.3, -hash01(seed, 6) * 0.5];
  const t = 0.04;
  const v = [a, b, c].flatMap(([x, y]) => [x, y, t]).concat([a, b, c].flatMap(([x, y]) => [x, y, -t]));
  const idx = [0, 1, 2, 5, 4, 3, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

export class BulletTime implements Generator {
  readonly kind = 'bulletTime';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 100);
  private readonly bg: FullscreenPass;
  private readonly shards: THREE.InstancedMesh;
  private readonly drops: THREE.InstancedMesh;
  private readonly dust: THREE.Points;
  private readonly dustPos = new Float32Array(DUST * 3);
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly pal = Array.from({ length: 5 }, () => new THREE.Vector3());
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private dropAt = -99;
  private aspect = 16 / 9;
  private readonly bullet: THREE.Mesh;
  private readonly rings: THREE.Mesh[] = [];

  constructor() {
    this.bg = new FullscreenPass(
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false, uniforms: { uRes: { value: new THREE.Vector2(16, 9) }, uShaft: { value: 1 }, uPal: { value: this.pal } } }),
    );
    const mat = (kind: number): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        vertexShader: OBJ_VERT,
        fragmentShader: OBJ_FRAG,
        side: THREE.DoubleSide,
        transparent: kind < 2,
        depthWrite: kind === 2,
        premultipliedAlpha: true,
        blending: kind < 2 ? THREE.CustomBlending : THREE.NormalBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: { uPal: { value: this.pal }, uKind: { value: kind }, uLight: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() }, uStreak: { value: 0 } },
      });
      this.mats.push(m);
      return m;
    };
    const shardGeo = shardGeometry(7);
    this.shards = new THREE.InstancedMesh(shardGeo, mat(0), SHARDS);
    const dropGeo = new THREE.IcosahedronGeometry(1, 2);
    this.drops = new THREE.InstancedMesh(dropGeo, mat(1), DROPS);
    for (const [mesh, n] of [[this.shards, SHARDS], [this.drops, DROPS]] as Array<[THREE.InstancedMesh, number]>) {
      mesh.geometry.setAttribute('aVel', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      mesh.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: n }, (_, i) => hash01(i, 3)), 1));
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.012, color: 0xd8ffe0, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    // The bullet: a small chrome slug, and the rings of air it leaves behind.
    this.bullet = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 6, 12), mat(2));
    this.bullet.frustumCulled = false;
    this.bullet.geometry.setAttribute('aVel', new THREE.Float32BufferAttribute(new Float32Array(this.bullet.geometry.getAttribute('position').count * 3), 3));
    this.bullet.geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(this.bullet.geometry.getAttribute('position').count), 1));
    this.scene.add(this.bullet);
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    for (let k = 0; k < RINGS; k++) {
      const m = new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uPal: { value: this.pal }, uAlpha: { value: 0.5 } } });
      this.mats.push(m);
      const ring = new THREE.Mesh(ringGeo, m);
      ring.frustumCulled = false;
      this.rings.push(ring);
      this.scene.add(ring);
    }
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    this.aspect = ctx.width / Math.max(1, ctx.height);
    for (let i = 0; i < 5; i++) this.pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
    const bpp = Math.max(4, f.beatsPerPhrase || 16) * Math.max(1, Math.round(num(p.phrasesPerShot, 1)));
    if (f.drop) this.dropAt = ctx.beat;
    // The shot: a burst at the phrase downbeat (or the drop), then almost frozen time.
    const sinceDrop = ctx.beat - this.dropAt;
    const useDrop = sinceDrop >= 0 && sinceDrop < bpp;
    const shot = useDrop ? Math.floor(this.dropAt * 7) + 1000 : Math.floor(ctx.beat / bpp);
    const b = useDrop ? sinceDrop : ctx.beat - Math.floor(ctx.beat / bpp) * bpp;
    const burstBeats = num(p.burstBeats, 1);
    const creep = num(p.creep, 0.05) * (1 + (f.energyTrend === 'building' ? 1 : 0));
    // Fast for the burst, then a slow creep: tau is "seconds of real motion".
    const fast = Math.min(b, burstBeats);
    const tau = 0.35 * (1 - Math.pow(1 - fast / burstBeats, 2)) + Math.max(0, b - burstBeats) * creep * 0.06;
    const rate = b < burstBeats ? 1 - b / burstBeats : 0;
    for (const m of this.mats) if (m.uniforms.uStreak) m.uniforms.uStreak.value = rate * num(p.streak, 1);
    // Burst origin per shot, a little off centre.
    const ox = (hash01(shot, 1) - 0.5) * 0.6, oy = (hash01(shot, 2) - 0.5) * 0.4, oz = (hash01(shot, 3) - 0.5) * 0.6;
    const place = (mesh: THREE.InstancedMesh, n: number, sizeMin: number, sizeMax: number, speed: number, salt: number, round: boolean): void => {
      const vel = mesh.geometry.getAttribute('aVel') as THREE.InstancedBufferAttribute;
      for (let i = 0; i < n; i++) {
        const k = i * 13 + salt + shot * 101;
        // Directions spread over a sphere, biased sideways like a shattered pane.
        const u = hash01(k, 4) * 2 - 1, th = hash01(k, 5) * Math.PI * 2, r = Math.sqrt(1 - u * u);
        const sp = speed * (0.4 + hash01(k, 6) * 1.2);
        const dx = Math.cos(th) * r * 1.3, dy = u * 0.8, dz = Math.sin(th) * r * 1.3;
        const x = ox + dx * sp * tau, y = oy + dy * sp * tau - 0.6 * tau * tau, z = oz + dz * sp * tau;
        const size = sizeMin + (sizeMax - sizeMin) * Math.pow(hash01(k, 7), 2);
        if (round) {
          this.s.set(size, size * (1 + rate * 0.3), size);
          this.q.identity();
        } else {
          this.e.set(hash01(k, 8) * 6.28 + tau * 3 * (hash01(k, 9) - 0.5), hash01(k, 10) * 6.28, hash01(k, 11) * 6.28 + tau * 2);
          this.q.setFromEuler(this.e);
          this.s.set(size, size, size);
        }
        this.v.set(x, y, z);
        this.m.compose(this.v, this.q, this.s);
        mesh.setMatrixAt(i, this.m);
        vel.setXYZ(i, dx * sp * rate * 0.05, dy * sp * rate * 0.05, dz * sp * rate * 0.05);
      }
      mesh.instanceMatrix.needsUpdate = true;
      vel.needsUpdate = true;
    };
    const mix = num(p.mix, 0.5);
    this.shards.count = Math.round(SHARDS * Math.min(1, (1 - mix) * 2));
    this.drops.count = Math.round(DROPS * Math.min(1, mix * 2));
    place(this.shards, this.shards.count, 0.04, 0.16, 2.2, 1, false);
    place(this.drops, this.drops.count, 0.012, 0.05, 1.8, 7, true);
    // Dust hangs in the shaft, drifting very slowly.
    for (let i = 0; i < DUST; i++) {
      const t = ctx.time * 0.01;
      this.dustPos[i * 3] = (hash01(i, 21) - 0.5) * 6 + Math.sin(t + i) * 0.05;
      this.dustPos[i * 3 + 1] = (hash01(i, 22) - 0.5) * 4;
      this.dustPos[i * 3 + 2] = (hash01(i, 23) - 0.5) * 6;
    }
    (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // The bullet crosses the burst point just after the burst and crawls on through the freeze.
    const bth = hash01(shot, 40) * Math.PI * 2;
    const bdir = this.v.set(Math.cos(bth), (hash01(shot, 41) - 0.5) * 0.3, Math.sin(bth)).normalize().clone();
    const travel = (tau - 0.3) * 3;
    const bx = ox + bdir.x * travel, by = oy + bdir.y * travel, bz = oz + bdir.z * travel;
    this.bullet.position.set(bx, by, bz);
    this.bullet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bdir);
    this.rings.forEach((ring, k) => {
      const back = 0.07 * (k + 1);
      ring.position.set(bx - bdir.x * back, by - bdir.y * back, bz - bdir.z * back);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bdir);
      const r = 0.05 + 0.035 * k;
      ring.scale.set(r * 2, r * 2, 1);
      (ring.material as THREE.ShaderMaterial).uniforms.uAlpha.value = (1 - k / RINGS) * 0.55 * (travel > back ? 1 : 0);
    });
    // The camera arc: round the bullet through the shot, stepping on the 16ths like a row of stills.
    const arc = num(p.arc, 1) * (Math.PI * (0.9 + ctx.env.energy * 0.6));
    const dir = hash01(shot, 30) < 0.5 ? 1 : -1;
    const smooth = (b / bpp) * arc;
    const step = arc / (bpp * 4);
    const stutter = num(p.stutter, 0.6);
    const ang = hash01(shot, 31) * Math.PI * 2 + dir * (smooth * (1 - stutter) + Math.floor(smooth / step) * step * stutter);
    const height = (hash01(shot, 32) - 0.4) * 1.2 + Math.sin((b / bpp) * Math.PI) * 0.3;
    const dist = 2.0 - ctx.env.kick * 0.03;
    // Frame the bullet, with the burst behind it.
    const fx0 = ox + (bx - ox) * 0.8, fy0 = oy + (by - oy) * 0.8, fz0 = oz + (bz - oz) * 0.8;
    this.camera.position.set(fx0 + Math.cos(ang) * dist, fy0 + height * 0.5, fz0 + Math.sin(ang) * dist);
    this.camera.lookAt(fx0, fy0, fz0);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    (this.bg.material.uniforms.uShaft as THREE.IUniform).value = 1 - rate * 0.5;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    (this.bg.material.uniforms.uRes.value as THREE.Vector2).set(target.width, target.height);
    this.bg.render(renderer, target);
    renderer.setRenderTarget(target);
    renderer.clear(false, true, false);
    renderer.render(this.scene, this.camera);
  }

  compileTargets(): CompileTarget[] {
    return [this.bg, { scene: this.scene, camera: this.camera }];
  }

  dispose(): void {
    this.bg.dispose();
    this.shards.geometry.dispose();
    this.drops.geometry.dispose();
    this.dust.geometry.dispose();
    this.bullet.geometry.dispose();
    this.rings[0]?.geometry.dispose();
    (this.dust.material as THREE.Material).dispose();
    for (const m of this.mats) m.dispose();
  }
}
