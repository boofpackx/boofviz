import * as THREE from 'three';
import { FULLSCREEN_VERT, PALETTE_GLSL, UTIL_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

const SHARED = /* glsl */ `
uniform float uZ, uSnap;
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float centerX(float z) { return sin(z * 0.015) * 10.0 + sin(z * 0.037) * 4.0; }
float height(vec2 w) {
  float c = abs(w.x - centerX(w.y));
  return smoothstep(4.0, 20.0, c) * 10.0 * (0.55 + 0.6 * vn(w * 0.06)) + vn(w * 0.25) * 1.0 * smoothstep(3.0, 6.0, c);
}
// 32-bit console wobble: snap the projected vertex to a coarse screen grid.
vec4 snapClip(vec4 c) {
  vec2 ndc = c.xy / c.w;
  ndc = floor(ndc * uSnap + 0.5) / uSnap;
  return vec4(ndc * c.w, c.zw);
}
`;

const TERRAIN_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
${SHARED}
out vec3 vWorld;
void main() {
  float cell = 2.0;
  vec3 w = position + vec3(0.0, 0.0, -floor(uZ / cell) * cell);
  w.y = height(w.xz);
  vWorld = w;
  gl_Position = snapClip(projectionMatrix * viewMatrix * vec4(w, 1.0));
}
`;

const DITHER = /* glsl */ `
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i.y * 4 + i.x]) + 0.5) / 16.0;
}
// 15-bit colour with ordered dither, like the hardware.
vec3 crush(vec3 c) {
  vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
  g = floor(g * 31.0 + bayer4(gl_FragCoord.xy)) / 31.0;
  return pow(g, vec3(2.2));
}
`;

const TERRAIN_FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
${SHARED}
${DITHER}
uniform vec3 uCamPos, uFog;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  float lam = 0.35 + 0.75 * max(dot(n, normalize(vec3(0.4, 0.8, 0.3))), 0.0);
  float c = abs(vWorld.x - centerX(vWorld.z));
  vec3 col;
  if (c < 3.2) {
    col = vec3(0.12);
    if (c < 0.15 && fract(vWorld.z * 0.12) < 0.5) col = vec3(0.9, 0.85, 0.3);
    if (abs(c - 3.0) < 0.12) col = vec3(0.8);
  } else {
    float h = vWorld.y;
    col = mix(palette(0.25) * 0.6 + vec3(0.05, 0.12, 0.03), palette(0.5) * 0.7 + vec3(0.12, 0.08, 0.05), smoothstep(1.5, 6.0, h));
    col = mix(col, vec3(0.9), smoothstep(8.5, 10.0, h));
    // Checker "texture" on the rock, like a tiled 64 px texture.
    col *= 0.85 + 0.15 * mod(floor(vWorld.x * 0.5) + floor(vWorld.z * 0.5), 2.0);
  }
  col *= lam;
  float d = distance(vWorld, uCamPos);
  col = mix(col, uFog, smoothstep(30.0, 95.0, d));
  fragColor = vec4(crush(col), 1.0);
}
`;

const RING_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in mat4 instanceMatrix;
uniform mat4 viewMatrix, projectionMatrix;
${SHARED}
out vec3 vWorld;
void main() {
  vec4 w = instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = snapClip(projectionMatrix * viewMatrix * w);
}
`;

const RING_FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
${DITHER}
uniform float uKick, uZ, uSnap;
uniform vec3 uFog, uCamPos;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float lam = 0.5 + 0.5 * abs(dot(n, normalize(vec3(0.3, 0.8, 0.5))));
  vec3 col = palette(0.85) * (1.2 + 1.5 * uKick) * lam;
  col = mix(col, uFog, smoothstep(40.0, 100.0, distance(vWorld, uCamPos)));
  fragColor = vec4(crush(col), 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
${UTIL_GLSL}
uniform vec2 uRes;
uniform vec3 uFog;
uniform float uHorizon;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float y = vUv.y - uHorizon;
  vec3 c = mix(uFog, palette(0.15) * 0.5 + vec3(0.02, 0.04, 0.12), smoothstep(0.0, 0.5, y));
  vec2 sp = (gl_FragCoord.xy - vec2(0.62, uHorizon + 0.18) * uRes) / uRes.y;
  c += palette(0.95) * smoothstep(0.08, 0.075, length(sp)) * 1.5;
  fragColor = vec4(c, 1.0);
}
`;

const UPSCALE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(uInput, vUv); }
`;

/**
 * A 32-bit console flythrough: a low-poly canyon road with rings to fly
 * through, rendered at 240 lines and scaled up with chunky pixels, wobbling
 * vertices, 15-bit dithered colour and distance fog.
 */
export class LowPoly implements Generator {
  readonly kind = 'lowPoly';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 4 / 3, 0.1, 400);
  private readonly terrainMat: THREE.RawShaderMaterial;
  private readonly ringMat: THREE.RawShaderMaterial;
  private readonly terrainGeo: THREE.PlaneGeometry;
  private readonly ringGeo = new THREE.TorusGeometry(2.4, 0.35, 4, 8);
  private readonly rings: THREE.InstancedMesh;
  private readonly sky: FullscreenPass;
  private readonly upscale: FullscreenPass;
  private low: THREE.WebGLRenderTarget | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly shared: Record<string, THREE.IUniform>;

  constructor() {
    this.shared = { uZ: { value: 0 }, uSnap: { value: 120 }, uFog: { value: new THREE.Vector3(0.3, 0.3, 0.4) }, uCamPos: { value: new THREE.Vector3() }, uPal: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) } };
    this.terrainGeo = new THREE.PlaneGeometry(90, 120, 45, 60);
    this.terrainGeo.rotateX(-Math.PI / 2);
    this.terrainGeo.translate(0, 0, -50);
    this.terrainMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: this.shared });
    const terrain = new THREE.Mesh(this.terrainGeo, this.terrainMat);
    terrain.frustumCulled = false;
    this.scene.add(terrain);
    this.ringMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: { ...this.shared, uKick: { value: 0 } }, side: THREE.DoubleSide });
    this.rings = new THREE.InstancedMesh(this.ringGeo, this.ringMat, 8);
    this.rings.frustumCulled = false;
    this.scene.add(this.rings);
    const mat = (frag: string, u: Record<string, THREE.IUniform>): THREE.RawShaderMaterial =>
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms: u, depthTest: false, depthWrite: false });
    this.sky = new FullscreenPass(mat(SKY_FRAG, { uRes: { value: new THREE.Vector2(1, 1) }, uFog: this.shared.uFog, uHorizon: { value: 0.5 }, uPal: this.shared.uPal }));
    this.upscale = new FullscreenPass(mat(UPSCALE_FRAG, { uInput: { value: null } }));
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const lines = Math.max(120, Math.round(num(p.lines, 240)));
    const aspect = ctx.width / Math.max(1, ctx.height);
    const w = Math.max(160, Math.round(lines * aspect));
    if (!this.low || this.low.height !== lines || this.low.width !== w) {
      this.low?.dispose();
      this.low = new THREE.WebGLRenderTarget(w, lines, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    }
    const pal = this.shared.uPal.value as THREE.Vector3[];
    for (let i = 0; i < 5; i++) pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
    (this.shared.uFog.value as THREE.Vector3).set(pal[2].x * 0.5 + 0.08, pal[2].y * 0.5 + 0.08, pal[2].z * 0.5 + 0.12);
    const z = ctx.beat * num(p.speed, 1) * 6;
    this.shared.uZ.value = z;
    this.shared.uSnap.value = (lines / 2) * Math.max(0.25, 1.2 - num(p.wobble, 0.6));
    const cx = (zz: number): number => Math.sin(zz * 0.015) * 10 + Math.sin(zz * 0.037) * 4;
    const camZ = -z;
    const bob = Math.sin(ctx.beat * Math.PI) * 0.15;
    this.camera.aspect = aspect;
    this.camera.position.set(cx(camZ), 2.4 + bob, camZ);
    this.camera.up.set(Math.sin((cx(camZ - 12) - cx(camZ)) * -0.02), 1, 0).normalize();
    this.camera.lookAt(cx(camZ - 16), 1.8, camZ - 16);
    this.camera.updateProjectionMatrix();
    (this.shared.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    // Rings every 24 units down the road, pulsing on the kick.
    const spacing = 24;
    const first = Math.ceil(-camZ / spacing);
    for (let i = 0; i < 8; i++) {
      const rz = -(first + i) * spacing;
      const s = 1 + 0.15 * ctx.env.kick;
      this.m.makeRotationZ((first + i) * 0.4).premultiply(new THREE.Matrix4().makeScale(s, s, s)).setPosition(cx(rz), 2.6, rz);
      this.rings.setMatrixAt(i, this.m);
    }
    this.rings.instanceMatrix.needsUpdate = true;
    this.ringMat.uniforms.uKick.value = ctx.env.kick * num(p.punch, 1);
    (this.sky.material.uniforms.uRes.value as THREE.Vector2).set(w, lines);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const low = this.low!;
    renderer.setRenderTarget(low);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    this.sky.render(renderer, low);
    renderer.render(this.scene, this.camera);
    this.upscale.material.uniforms.uInput.value = low.texture;
    this.upscale.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [{ scene: this.scene, camera: this.camera }, this.sky, this.upscale];
  }

  dispose(): void {
    this.terrainGeo.dispose();
    this.ringGeo.dispose();
    this.terrainMat.dispose();
    this.ringMat.dispose();
    this.sky.dispose();
    this.upscale.dispose();
    this.low?.dispose();
  }
}
