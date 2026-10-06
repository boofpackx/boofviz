import * as THREE from 'three';

const VERT = /* glsl */ `
precision highp float;
in vec2 position;
in vec3 aEdge;   // x: -1..1 across the stroke, y: kind (0 core, 1 glow, 2 fill), z: half width in px
in vec4 aColor;  // linear rgb, w = intensity
uniform vec2 uRes;
out vec3 vEdge;
out vec4 vColor;
void main() {
  vEdge = aEdge;
  vColor = aColor;
  gl_Position = vec4(position / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vEdge;
in vec4 vColor;
out vec4 fragColor;
void main() {
  float a;
  if (vEdge.y > 1.5) a = 1.0;                                  // fill
  else if (vEdge.y > 0.5) a = exp(-vEdge.x * vEdge.x * 4.0);    // glow
  else {
    float aa = 1.2 / max(vEdge.z, 0.5);
    a = smoothstep(0.0, aa, 1.0 - abs(vEdge.x));                // anti-aliased core
  }
  a *= vColor.w;
  fragColor = vec4(vColor.rgb * a, vEdge.y > 1.5 ? 1.0 : clamp(a, 0.0, 1.0));
}
`;

export type StrokeKind = 0 | 1 | 2;

/**
 * Batches anti-aliased polylines (with optional glow halo) and filled strips
 * into one dynamic mesh, coordinates in pixels. Triangles draw in submission
 * order, so fills submitted first are painted over (painter's algorithm).
 */
export class StrokeBatch {
  private readonly maxVerts: number;
  private readonly pos: Float32Array;
  private readonly edge: Float32Array;
  private readonly col: Float32Array;
  private readonly idx: Uint32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.RawShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private v = 0;
  private i = 0;

  /** For background shader compilation. */
  get compileTarget(): { scene: THREE.Object3D; camera: THREE.Camera } {
    return { scene: this.scene, camera: this.camera };
  }

  constructor(maxVerts: number) {
    this.maxVerts = maxVerts;
    this.pos = new Float32Array(maxVerts * 2);
    this.edge = new Float32Array(maxVerts * 3);
    this.col = new Float32Array(maxVerts * 4);
    this.idx = new Uint32Array(maxVerts * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aEdge', new THREE.BufferAttribute(this.edge, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    // 2D positions: give Three a fixed bound so it never tries to compute one from xy data.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) } },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** additive: glowing light (scopes). over: premultiplied "over" (occluding fills). */
  setBlend(mode: 'additive' | 'over'): void {
    this.mat.blendDst = mode === 'additive' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  }

  begin(): void {
    this.v = 0;
    this.i = 0;
  }

  private vert(x: number, y: number, e: number, kind: number, hw: number, r: number, g: number, b: number, a: number): number {
    const v = this.v++;
    this.pos[v * 2] = x;
    this.pos[v * 2 + 1] = y;
    this.edge[v * 3] = e;
    this.edge[v * 3 + 1] = kind;
    this.edge[v * 3 + 2] = hw;
    this.col[v * 4] = r;
    this.col[v * 4 + 1] = g;
    this.col[v * 4 + 2] = b;
    this.col[v * 4 + 3] = a;
    return v;
  }

  private quad(a: number, b: number, c: number, d: number): void {
    // a,b = previous pair; c,d = next pair
    this.idx[this.i++] = a;
    this.idx[this.i++] = b;
    this.idx[this.i++] = c;
    this.idx[this.i++] = b;
    this.idx[this.i++] = d;
    this.idx[this.i++] = c;
  }

  /**
   * Polyline through `count` points (xy pairs, pixels) with mitered joins.
   * kind 0 = crisp core, 1 = soft glow halo.
   */
  stroke(pts: Float32Array, count: number, halfWidth: number, r: number, g: number, b: number, a: number, kind: StrokeKind = 0, closed = false): void {
    if (count < 2 || this.v + count * 2 + 2 > this.maxVerts) return;
    const first = this.v;
    for (let k = 0; k < count; k++) {
      const pk = closed ? (k - 1 + count) % count : Math.max(0, k - 1);
      const nk = closed ? (k + 1) % count : Math.min(count - 1, k + 1);
      // Segment normals either side of the point, averaged into a miter.
      let ax = pts[k * 2] - pts[pk * 2];
      let ay = pts[k * 2 + 1] - pts[pk * 2 + 1];
      let bx = pts[nk * 2] - pts[k * 2];
      let by = pts[nk * 2 + 1] - pts[k * 2 + 1];
      let la = Math.hypot(ax, ay);
      let lb = Math.hypot(bx, by);
      if (la < 1e-6) {
        ax = bx;
        ay = by;
        la = lb;
      }
      if (lb < 1e-6) {
        bx = ax;
        by = ay;
        lb = la;
      }
      if (la < 1e-6) {
        ax = 1;
        ay = 0;
        la = 1;
        bx = 1;
        by = 0;
        lb = 1;
      }
      const n0x = -ay / la;
      const n0y = ax / la;
      const n1x = -by / lb;
      const n1y = bx / lb;
      let mx = n0x + n1x;
      let my = n0y + n1y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const scale = halfWidth / Math.max(0.35, mx * n1x + my * n1y);
      const x = pts[k * 2];
      const y = pts[k * 2 + 1];
      this.vert(x + mx * scale, y + my * scale, 1, kind, halfWidth, r, g, b, a);
      this.vert(x - mx * scale, y - my * scale, -1, kind, halfWidth, r, g, b, a);
    }
    const segs = closed ? count : count - 1;
    for (let k = 0; k < segs; k++) {
      const a0 = first + k * 2;
      const c0 = first + ((k + 1) % count) * 2;
      this.quad(a0, a0 + 1, c0, c0 + 1);
    }
  }

  /** Solid fill between a polyline and a horizontal baseline (for occluding ridge lines). */
  fillToBaseline(pts: Float32Array, count: number, baseY: number, r: number, g: number, b: number): void {
    if (count < 2 || this.v + count * 2 > this.maxVerts) return;
    const first = this.v;
    for (let k = 0; k < count; k++) {
      this.vert(pts[k * 2], pts[k * 2 + 1], 0, 2, 1, r, g, b, 1);
      this.vert(pts[k * 2], baseY, 0, 2, 1, r, g, b, 1);
    }
    for (let k = 0; k < count - 1; k++) this.quad(first + k * 2, first + k * 2 + 1, first + k * 2 + 2, first + k * 2 + 3);
  }

  draw(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, clear = true): void {
    (this.mat.uniforms.uRes.value as THREE.Vector2).set(target.width, target.height);
    const attrs = ['position', 'aEdge', 'aColor'] as const;
    const sizes = [2, 3, 4];
    attrs.forEach((name, k) => {
      const attr = this.geo.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.v * sizes[k]);
      attr.needsUpdate = true;
    });
    const index = this.geo.getIndex()!;
    index.clearUpdateRanges();
    index.addUpdateRange(0, this.i);
    index.needsUpdate = true;
    this.geo.setDrawRange(0, this.i);
    renderer.setRenderTarget(target);
    if (clear) {
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
    }
    if (this.i > 0) renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
