import * as THREE from 'three';
import { FIRE_FRAG, FIRE_VERT } from './shaders';
import type { VenueFrame } from './venueTypes';
import { FONT_TITLE } from './hud';

/** Deterministic 0..1 noise from an integer. */
export function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 0 on the beat, up and back down by the next. */
export function bounce(beat: number): number {
  return Math.sin((beat - Math.floor(beat)) * Math.PI);
}

/** A texture painted once on a canvas. */
export function paintTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export function title(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, stroke = 'rgba(0,0,0,0.8)', font = FONT_TITLE): void {
  g.font = `${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.12;
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

/** Boards (or planks), a few tones, seams and grain. */
export function planks(g: CanvasRenderingContext2D, w: number, h: number, pw: number, base: [number, number, number], seed: number, vertical = true): void {
  const n = Math.ceil((vertical ? w : h) / pw);
  for (let i = 0; i < n; i++) {
    const t = 0.75 + hash(seed + i) * 0.45;
    g.fillStyle = `rgb(${base[0] * t},${base[1] * t},${base[2] * t})`;
    if (vertical) g.fillRect(i * pw, 0, pw + 0.5, h);
    else g.fillRect(0, i * pw, w, pw + 0.5);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    if (vertical) g.fillRect(i * pw, 0, Math.max(1, pw * 0.06), h);
    else g.fillRect(0, i * pw, w, Math.max(1, pw * 0.06));
    g.strokeStyle = 'rgba(0,0,0,0.14)';
    g.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const o = hash(seed * 3 + i * 7 + k) * pw;
      g.beginPath();
      if (vertical) {
        g.moveTo(i * pw + o, 0);
        g.lineTo(i * pw + o + pw * 0.1, h);
      } else {
        g.moveTo(0, i * pw + o);
        g.lineTo(w, i * pw + o + pw * 0.1);
      }
      g.stroke();
    }
  }
}

/** A speaker cabinet front: grille cloth, piping, chrome corners, a logo plate. */
export function grille(g: CanvasRenderingContext2D, w: number, h: number, cloth = '#2b2620', logo = ''): void {
  g.fillStyle = '#0c0c0e';
  g.fillRect(0, 0, w, h);
  const m = Math.min(w, h) * 0.07;
  g.fillStyle = cloth;
  g.fillRect(m, m, w - 2 * m, h - 2 * m);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < (w - 2 * m) / 3; i++) {
    g.beginPath();
    g.moveTo(m + i * 3, m);
    g.lineTo(m + i * 3, h - m);
    g.stroke();
  }
  g.strokeStyle = 'rgba(210,200,170,0.3)';
  g.lineWidth = Math.max(1, m * 0.25);
  g.strokeRect(m, m, w - 2 * m, h - 2 * m);
  g.fillStyle = '#b8b8c4';
  const c = m * 1.1;
  for (const [cx, cy] of [
    [0, 0],
    [w - c, 0],
    [0, h - c],
    [w - c, h - c],
  ])
    g.fillRect(cx, cy, c, c);
  if (logo) title(g, logo, w / 2, m + h * 0.09, h * 0.1, '#d8d0b8', 'rgba(0,0,0,0.5)');
}

/** A poster: painted, then aged (a yellowed wash, a torn corner, tape). */
export function poster(paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 352): THREE.CanvasTexture {
  return paintTexture(w, h, (g) => {
    paint(g, w, h);
    g.fillStyle = 'rgba(120,90,40,0.2)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(40,28,18,1)';
    g.beginPath();
    g.moveTo(w, h);
    g.lineTo(w - w * 0.12, h);
    g.lineTo(w, h - h * 0.08);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(230,220,180,0.85)';
    for (const [x, r] of [
      [w * 0.06, -0.6],
      [w * 0.94, 0.6],
    ]) {
      g.save();
      g.translate(x, 0);
      g.rotate(r);
      g.fillRect(-w * 0.08, -h * 0.02, w * 0.16, h * 0.05);
      g.restore();
    }
  });
}

/** A soft round glow (for lights, bulbs, lamps). */
export function glowTexture(): THREE.CanvasTexture {
  return paintTexture(64, 64, (g, w) => {
    const r = w / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
  });
}

export function lambert(color: number | THREE.Texture, emissive = 0x000000, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return typeof color === 'number' ? new THREE.MeshLambertMaterial({ color, emissive, ...opts }) : new THREE.MeshLambertMaterial({ map: color, emissive, ...opts });
}

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 16): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
}

/** A picture on the wall: a plane with a texture. */
export function picture(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lambert(tex));
  m.position.set(x, y, z);
  m.rotation.set(0, ry, rz);
  return m;
}

const BEAM_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
out float vAlong;
out float vEdge;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - w.xyz);
  vAlong = -position.y;
  vEdge = abs(dot(n, v));
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const BEAM_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
in float vAlong;
in float vEdge;
out vec4 fragColor;
void main() {
  float a = pow(vEdge, 1.6) * (1.0 - smoothstep(0.0, 1.0, vAlong)) * uIntensity;
  fragColor = vec4(uColor * a, 0.0);
}
`;

/** A beam of light: an open cone pointing down its −y axis, glowing where you look through the most of it. */
export class Beam {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.RawShaderMaterial;
  constructor(length: number, radius: number, color: THREE.ColorRepresentation) {
    const geo = new THREE.ConeGeometry(radius, length, 24, 1, true);
    geo.translate(0, -length / 2, 0);
    geo.scale(1, 1 / length, 1);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.scale.set(1, length, 1);
    this.mesh.renderOrder = 10;
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Additive glows (sprites) for lights: one per light, positioned and sized each frame. */
export class Glows {
  readonly group = new THREE.Group();
  private readonly tex = glowTexture();
  readonly sprites: THREE.Sprite[] = [];
  add(color: THREE.ColorRepresentation, x: number, y: number, z: number, size: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.renderOrder = 11;
    this.group.add(s);
    this.sprites.push(s);
    return s;
  }
  dispose(): void {
    this.tex.dispose();
    for (const s of this.sprites) s.material.dispose();
  }
}

/** Pyro and burning things in the venue: the highway's fire shader on camera-facing quads. */
export class Flames {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mat: THREE.RawShaderMaterial;
  constructor(readonly max: number) {
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3));
    this.geo.setAttribute('aFire', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    this.geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3));
    this.geo.instanceCount = 0;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }
  /** Flames as [x, y, z, size, tint?]; held flames flicker on their own. */
  set(time: number, list: Array<{ x: number; y: number; z: number; size: number; tint?: [number, number, number]; seed: number }>): void {
    const p = this.geo.getAttribute('aPos') as THREE.InstancedBufferAttribute;
    const f = this.geo.getAttribute('aFire') as THREE.InstancedBufferAttribute;
    const c = this.geo.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    const n = Math.min(this.max, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      p.setXYZ(i, l.x, l.y, l.z);
      f.setXYZW(i, time - 0.1, l.seed, l.size, 2);
      c.setXYZ(i, ...(l.tint ?? ([1, 0.55, 0.15] as [number, number, number])));
    }
    p.needsUpdate = f.needsUpdate = c.needsUpdate = true;
    this.geo.instanceCount = n;
    this.mat.uniforms.uTime.value = time;
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** A camera shot: where the camera is and looks over the shot's progress (0..1). */
export interface Shot {
  pos: (u: number, f: VenueFrame) => [number, number, number];
  look: (u: number, f: VenueFrame) => [number, number, number];
  fov: number;
}

/** For the capture script: hold one shot (its index; the hero shot after the rest), or −1 to direct. */
export const directorDebug = { shot: -1 };

/**
 * Cuts between shots on the bar, like the game's venue cameras: a new shot
 * every two bars (picked from the beat count, so every window cuts the same
 * way), never the same one twice running, the hero shot when star power
 * goes off. The camera drifts within each shot and shakes a little on kicks.
 */
export class Director {
  private lastPower = 0;
  private heroUntil = -1;

  constructor(
    private readonly shots: Shot[],
    private readonly hero: Shot,
  ) {}

  update(cam: THREE.PerspectiveCamera, f: VenueFrame): void {
    const bpb = Math.max(1, f.beatsPerBar);
    const len = bpb * 2;
    const k = Math.floor((f.beat - f.barStart) / len + f.barStart / len + 1e-6);
    const start = k * len;
    if (f.power > 0.5 && this.lastPower <= 0.5) this.heroUntil = f.beat + len;
    this.lastPower = f.power;
    let shot: Shot;
    let u: number;
    if (directorDebug.shot >= 0) {
      shot = directorDebug.shot >= this.shots.length ? this.hero : this.shots[directorDebug.shot];
      u = 0.5;
    } else if (f.beat < this.heroUntil) {
      shot = this.hero;
      u = 1 - (this.heroUntil - f.beat) / len;
    } else {
      // A shot per two bars, never the same twice running.
      const pick = (i: number): number => Math.floor(hash(i * 7919 + 13) * this.shots.length);
      let idx = pick(k);
      if (idx === pick(k - 1)) idx = (idx + 1) % this.shots.length;
      shot = this.shots[idx];
      u = clamp((f.beat - start) / len, 0, 1);
    }
    const p = shot.pos(u, f);
    const l = shot.look(u, f);
    const shake = f.kick * 0.012;
    cam.position.set(p[0] + Math.sin(f.t * 37) * shake, p[1] + Math.cos(f.t * 41) * shake, p[2]);
    cam.lookAt(l[0], l[1], l[2]);
    cam.fov = shot.fov;
    cam.aspect = f.aspect;
    cam.updateProjectionMatrix();
  }
}
