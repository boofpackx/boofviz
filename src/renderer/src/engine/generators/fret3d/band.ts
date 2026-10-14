import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bounce, clamp, glowTexture, hash, paintTexture, title } from './venueKit';
import type { VenueFrame } from './venueTypes';

/**
 * The band on stage, in the console's low-poly style: rockers (guitar,
 * bass, the singer at the mic) and a drummer at the kit, posed every frame
 * by two-bone IK so the hands stay on the strings, the neck, the mic and the
 * drums. They play along to the song: strums land on the part's notes, the
 * fretting hand slides with the pitch, the sticks come down on the kicks,
 * snares, hats and crashes, the singer sings when there's singing, and
 * everyone rocks harder as the rock meter climbs (star power: necks up).
 * Then the crowd: instanced people jumping on the beat, arms up as the gig
 * heats up, lighters out when it goes quiet.
 */

const DOWN = new THREE.Vector3(0, -1, 0);
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _m = new THREE.Matrix4();

function css(hex: number, k = 1): string {
  const c = new THREE.Color(hex);
  return `rgb(${Math.round(Math.min(255, c.r * 255 * k))},${Math.round(Math.min(255, c.g * 255 * k))},${Math.round(Math.min(255, c.b * 255 * k))})`;
}

function mat(color: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

function shiny(color: number, shininess = 60, opts: THREE.MeshPhongMaterialParameters = {}): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ color, shininess, specular: 0x777777, ...opts });
}

/** A limb segment (a tapered tube hung from its top) stretched between two points each frame. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, r0: number, r1: number, material: THREE.Material, seg = 7) {
    const g = new THREE.CylinderGeometry(r0, r1, 1, seg, 1);
    g.translate(0, -0.5, 0);
    this.mesh = new THREE.Mesh(g, material);
    parent.add(this.mesh);
  }
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    _d.subVectors(b, a);
    const len = Math.max(1e-4, _d.length());
    this.mesh.position.copy(a);
    this.mesh.quaternion.setFromUnitVectors(DOWN, _d.divideScalar(len));
    this.mesh.scale.set(1, len, 1);
  }
}

/**
 * Two-bone IK: where the elbow (or knee) goes for a limb from s reaching for
 * t (bone lengths a, b), bent toward `pole`. Pulls t in when it's out of
 * reach. Writes the joint into `joint`.
 */
function solve(s: THREE.Vector3, t: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, joint: THREE.Vector3): void {
  _d.subVectors(t, s);
  let len = _d.length();
  const max = (a + b) * 0.995;
  if (len > max) {
    _d.multiplyScalar(max / len);
    t.copy(s).add(_d);
    len = max;
  }
  len = Math.max(len, Math.abs(a - b) + 1e-3);
  _d.normalize();
  const x = (a * a - b * b + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1);
  _p.normalize();
  joint.copy(s).addScaledVector(_d, x).addScaledVector(_p, h);
}

export type HairStyle = 'long' | 'mohawk' | 'spiky' | 'afro' | 'shaved' | 'bandana' | 'bob';

export interface Look {
  skin: number;
  shirt: number;
  /** An open vest (or jacket) over the shirt. */
  vest?: number;
  /** Bare arms (a tank or a vest) instead of sleeves. */
  bare?: boolean;
  print?: 'skull' | 'star' | 'bolt' | 'stripes' | 'none';
  pants: number;
  boots?: number;
  hair: number;
  style: HairStyle;
  glasses?: boolean;
  beard?: boolean;
  /** The bandana's colour (style 'bandana'). */
  band?: number;
}

/** The torso texture (the front is the middle of the canvas). */
function shirtTexture(look: Look): THREE.Texture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = css(look.shirt);
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    if (look.print === 'stripes') {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let y = 6; y < h; y += 16) g.fillRect(0, y, w, 7);
    }
    g.save();
    g.translate(cx, h * 0.38);
    const s = h * 0.2;
    if (look.print === 'skull') {
      g.fillStyle = '#ece6d6';
      g.beginPath();
      g.arc(0, 0, s, Math.PI * 0.9, Math.PI * 0.1);
      g.lineTo(s * 0.55, s * 0.9);
      g.lineTo(-s * 0.55, s * 0.9);
      g.closePath();
      g.fill();
      g.fillStyle = css(look.shirt, 0.5);
      for (const x of [-0.42, 0.42]) {
        g.beginPath();
        g.ellipse(x * s, s * 0.15, s * 0.26, s * 0.3, 0, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = -2; i <= 2; i++) g.fillRect(i * s * 0.2 - s * 0.05, s * 0.7, s * 0.1, s * 0.22);
    } else if (look.print === 'star') {
      g.fillStyle = '#f2d23c';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? s * 0.45 : s * 1.1;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    } else if (look.print === 'bolt') {
      g.fillStyle = '#f6e23a';
      g.beginPath();
      g.moveTo(s * 0.3, -s);
      g.lineTo(-s * 0.5, s * 0.15);
      g.lineTo(0, s * 0.15);
      g.lineTo(-s * 0.3, s);
      g.lineTo(s * 0.55, -s * 0.2);
      g.lineTo(0.05 * s, -s * 0.2);
      g.closePath();
      g.fill();
    }
    g.restore();
    if (look.vest !== undefined) {
      g.fillStyle = css(look.vest);
      g.fillRect(0, 0, cx - w * 0.12, h);
      g.fillRect(cx + w * 0.12, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(cx - w * 0.12 - 3, 0, 3, h);
      g.fillRect(cx + w * 0.12, 0, 3, h);
    }
    // Shading toward the sides and a hem.
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.25)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, h - 6, w, 6);
  });
}

/** The face, painted where the head sphere faces forward (u = 0.25). */
function faceTexture(look: Look): THREE.Texture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = css(look.skin);
    g.fillRect(0, 0, w, h);
    const cx = w * 0.25;
    const ey = h * 0.46;
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.beginPath();
    g.moveTo(cx, ey + 4);
    g.lineTo(cx - 4, h * 0.57);
    g.lineTo(cx + 3, h * 0.58);
    g.fill();
    for (const s of [-1, 1]) {
      g.fillStyle = '#f2ece2';
      g.beginPath();
      g.ellipse(cx + s * 10, ey, 5, 3, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#24160e';
      g.beginPath();
      g.arc(cx + s * 10, ey + 0.5, 2.3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = css(look.hair, 0.7);
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(cx + s * 4, ey - 6);
      g.lineTo(cx + s * 15, ey - 7 + s * 0);
      g.stroke();
    }
    g.strokeStyle = '#6e2c26';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - 6, h * 0.645);
    g.quadraticCurveTo(cx, h * 0.665, cx + 6, h * 0.645);
    g.stroke();
    // Cheeks and a little shade under the jaw.
    g.fillStyle = 'rgba(200,60,60,0.08)';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(cx + s * 13, h * 0.58, 6, 0, Math.PI * 2);
      g.fill();
    }
    const jaw = g.createLinearGradient(0, h * 0.7, 0, h);
    jaw.addColorStop(0, 'rgba(0,0,0,0)');
    jaw.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = jaw;
    g.fillRect(0, h * 0.7, w, h * 0.3);
  });
}

/** Hair (and what's worn on the head), added to the head group. Returns the long hair's swinging part. */
function buildHair(head: THREE.Group, look: Look): THREE.Group | null {
  const hm = mat(look.hair);
  const cap = (r: number, m: THREE.Material, back = -0.42, down = 0.55): THREE.Mesh => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * down), m);
    c.rotation.x = back;
    c.position.set(0, 0.012, -0.008);
    head.add(c);
    return c;
  };
  let swing: THREE.Group | null = null;
  switch (look.style) {
    case 'long':
    case 'bob': {
      cap(0.127, hm, -0.78, 0.6);
      swing = new THREE.Group();
      swing.position.set(0, 0.05, -0.06);
      const len = look.style === 'long' ? 0.36 : 0.2;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.25, len, 0.08), hm);
      back.position.set(0, -len / 2, -0.035);
      swing.add(back);
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, len * 0.8, 0.12), hm);
        side.position.set(s * 0.115, -len * 0.38, 0.03);
        swing.add(side);
      }
      head.add(swing);
      break;
    }
    case 'mohawk': {
      cap(0.118, mat(look.skin, { color: new THREE.Color(look.skin).multiplyScalar(0.8) }), -0.45, 0.5);
      for (let i = 0; i < 6; i++) {
        const a = -0.9 + i * 0.42;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), hm);
        c.scale.set(0.35, 1, 1);
        c.position.set(0, Math.cos(a) * 0.13, Math.sin(a) * 0.13);
        c.rotation.x = a;
        head.add(c);
      }
      break;
    }
    case 'spiky': {
      cap(0.124, hm, -0.45, 0.52);
      for (let i = 0; i < 11; i++) {
        const th = 0.3 + hash(i * 3 + 1) * 0.75;
        const ph = (i / 11) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph) - 0.15).normalize();
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 4), hm);
        c.position.copy(dir).multiplyScalar(0.12);
        c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        head.add(c);
      }
      break;
    }
    case 'afro': {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9), hm);
      a.position.set(0, 0.06, -0.035);
      a.scale.set(1.05, 0.95, 1);
      head.add(a);
      break;
    }
    case 'shaved':
      cap(0.118, hm, -0.5, 0.5);
      break;
    case 'bandana': {
      cap(0.124, hm, -0.6, 0.62);
      const bm = mat(look.band ?? 0xb01818);
      cap(0.128, bm, -0.3, 0.42);
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.03), bm);
      knot.position.set(0.02, -0.02, -0.13);
      knot.rotation.z = 0.4;
      head.add(knot);
      break;
    }
  }
  if (look.glasses) {
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.038, 0.03), shiny(0x0a0a0c, 90));
    gl.position.set(0, 0.012, 0.105);
    head.add(gl);
  }
  if (look.beard) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hm);
    b.position.set(0, -0.07, 0.05);
    b.scale.set(1.05, 0.9, 0.95);
    head.add(b);
  }
  return swing;
}

/** Where a body is put each frame: the pelvis and feet in the root's space, the hands in the chest's. */
export interface Pose {
  pelvis: THREE.Vector3;
  /** The spine: x leans forward, y twists, z leans sideways. */
  lean: THREE.Euler;
  nod: number;
  turn: number;
  feet: [THREE.Vector3, THREE.Vector3];
  hands: [THREE.Vector3, THREE.Vector3];
  /** Which way the elbows bend (chest space; right, left). */
  elbows: [THREE.Vector3, THREE.Vector3];
  /** Which way the knees bend (root space). */
  knees?: THREE.Vector3;
  /** Heels lifted (radians; right, left). */
  heels?: [number, number];
}

const UPPER = 0.29;
const FORE = 0.28;
const THIGH = 0.46;
const SHIN = 0.45;
const SHOULDER = new THREE.Vector3(0.19, 0.47, 0);

/** A body: legs and hips in the root's space, the rest on the chest (which bends at the pelvis). */
export class Body {
  readonly root = new THREE.Group();
  readonly chest = new THREE.Group();
  readonly head = new THREE.Group();
  readonly mouth: THREE.Mesh | null = null;
  private readonly hips: THREE.Mesh;
  private readonly thigh: Limb[] = [];
  private readonly shin: Limb[] = [];
  private readonly knee: THREE.Mesh[] = [];
  private readonly boot: THREE.Mesh[] = [];
  private readonly upper: Limb[] = [];
  private readonly fore: Limb[] = [];
  private readonly elbow: THREE.Mesh[] = [];
  private readonly hand: THREE.Mesh[] = [];
  private readonly hair: THREE.Group | null;
  private hairAngle = 0;
  private hairVel = 0;
  private readonly shadow: THREE.Mesh;

  constructor(look: Look, opts: { mouth?: boolean; shadow?: THREE.Texture } = {}) {
    // A little glow of its own keeps faces readable under coloured stage light.
    const skin = mat(look.skin, { emissive: new THREE.Color(look.skin).multiplyScalar(0.14) });
    const shirt = new THREE.MeshLambertMaterial({ map: shirtTexture(look) });
    const sleeve = mat(look.vest ?? look.shirt);
    const pants = mat(look.pants);
    const boots = shiny(look.boots ?? 0x141414, 30);
    this.root.add(this.chest);

    this.hips = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.16, 0.2), pants);
    this.root.add(this.hips);
    for (let i = 0; i < 2; i++) {
      this.thigh.push(new Limb(this.root, 0.078, 0.062, pants));
      this.shin.push(new Limb(this.root, 0.06, 0.046, pants));
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.062, 7, 5), pants);
      this.root.add(k);
      this.knee.push(k);
      const bg = new THREE.BoxGeometry(0.11, 0.09, 0.27);
      bg.translate(0, 0, 0.06);
      const b = new THREE.Mesh(bg, boots);
      this.root.add(b);
      this.boot.push(b);
    }

    const torsoGeo = new THREE.CylinderGeometry(0.19, 0.15, 0.5, 12, 1, false, Math.PI, Math.PI * 2);
    torsoGeo.scale(1, 1, 0.64);
    torsoGeo.translate(0, 0.3, 0);
    this.chest.add(new THREE.Mesh(torsoGeo, shirt));
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.05, 12), shiny(0x1a1410, 20));
    belt.scale.set(1, 1, 0.66);
    belt.position.y = 0.06;
    this.chest.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.045, 0.02), shiny(0xd8d8e0, 90));
    buckle.position.set(0, 0.06, 0.1);
    this.chest.add(buckle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.14, 8), skin);
    neck.position.y = 0.58;
    this.chest.add(neck);
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), look.bare ? skin : sleeve);
      sh.position.set(s * SHOULDER.x, SHOULDER.y, 0);
      this.chest.add(sh);
    }
    for (let i = 0; i < 2; i++) {
      this.upper.push(new Limb(this.chest, 0.056, 0.047, look.bare ? skin : sleeve));
      this.fore.push(new Limb(this.chest, 0.045, 0.036, skin));
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.047, 6, 5), look.bare ? skin : sleeve);
      this.chest.add(e);
      this.elbow.push(e);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.046, 7, 5), skin);
      h.scale.set(1, 1.15, 0.85);
      this.chest.add(h);
      this.hand.push(h);
    }

    this.head.position.set(0, 0.71, 0.01);
    this.chest.add(this.head);
    const face = faceTexture(look);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), new THREE.MeshLambertMaterial({ map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.14 }));
    headMesh.scale.set(0.94, 1.1, 1);
    this.head.add(headMesh);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), skin);
      ear.position.set(s * 0.108, 0, 0);
      ear.scale.set(0.5, 1, 0.8);
      this.head.add(ear);
    }
    this.hair = buildHair(this.head, look);
    if (opts.mouth) {
      this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), mat(0x3a0c0c));
      this.mouth.position.set(0, -0.058, 0.103);
      this.mouth.scale.set(1, 0.2, 0.4);
      this.head.add(this.mouth);
    }
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: opts.shadow ?? null, color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.shadow.visible = !!opts.shadow;
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.006;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }

  /** Root space → chest space (for hand targets placed in the room: a mic, a drum). */
  toChest(v: THREE.Vector3): THREE.Vector3 {
    this.chest.updateMatrix();
    return v.applyMatrix4(_m.copy(this.chest.matrix).invert());
  }

  pose(p: Pose, dt: number): void {
    this.chest.position.copy(p.pelvis);
    this.chest.rotation.copy(p.lean);
    this.hips.position.copy(p.pelvis).y -= 0.02;
    this.hips.rotation.set(0, p.lean.y * 0.4, p.lean.z * 0.5);
    this.head.rotation.set(p.nod, p.turn, 0);
    this.shadow.position.set(p.pelvis.x, 0.006, p.pelvis.z);
    // Legs: hips to the planted feet, knees bent forward.
    const knees = p.knees ?? new THREE.Vector3(0, 0.1, 1);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hip = new THREE.Vector3(side * 0.095, -0.04, 0).applyEuler(new THREE.Euler(0, p.lean.y * 0.4, 0)).add(p.pelvis);
      const ankle = p.feet[i].clone();
      ankle.y += 0.075;
      const kneeAt = new THREE.Vector3();
      solve(hip, ankle, THIGH, SHIN, _e.copy(knees).setX(knees.x + side * 0.15), kneeAt);
      this.thigh[i].set(hip, kneeAt);
      this.shin[i].set(kneeAt, ankle);
      this.knee[i].position.copy(kneeAt);
      this.boot[i].position.set(ankle.x, p.feet[i].y + 0.045, ankle.z);
      this.boot[i].rotation.set(-(p.heels?.[i] ?? 0), p.lean.y * 0.3 + side * 0.12, 0);
    }
    // Arms: shoulders to the hands.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const sh = new THREE.Vector3(side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
      const wrist = p.hands[i].clone();
      const el = new THREE.Vector3();
      solve(sh, wrist, UPPER, FORE, p.elbows[i], el);
      this.upper[i].set(sh, el);
      this.fore[i].set(el, wrist);
      this.elbow[i].position.copy(el);
      this.hand[i].position.copy(wrist);
    }
    // Long hair swings behind a nod.
    if (this.hair) {
      const target = -p.nod * 0.85 - p.lean.x * 0.6;
      this.hairVel += (target - this.hairAngle) * 90 * dt;
      this.hairVel *= Math.exp(-7 * dt);
      this.hairAngle += this.hairVel * dt;
      this.hair.rotation.x = clamp(this.hairAngle, -1.2, 0.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Guitars
// ---------------------------------------------------------------------------

export type GuitarShape = 'double' | 'vee' | 'star' | 'bass';

function guitarOutline(kind: GuitarShape): THREE.Shape {
  const s = new THREE.Shape();
  if (kind === 'vee') {
    s.moveTo(0.12, -0.035);
    s.lineTo(-0.36, -0.215);
    s.lineTo(-0.385, -0.13);
    s.lineTo(-0.12, -0.02);
    s.lineTo(-0.385, 0.13);
    s.lineTo(-0.36, 0.215);
    s.lineTo(0.12, 0.035);
  } else if (kind === 'star') {
    s.moveTo(0.12, -0.035);
    s.lineTo(0.03, -0.2);
    s.lineTo(-0.07, -0.09);
    s.lineTo(-0.31, -0.15);
    s.lineTo(-0.21, 0.0);
    s.lineTo(-0.3, 0.17);
    s.lineTo(-0.04, 0.09);
    s.lineTo(0.22, 0.22);
    s.lineTo(0.12, 0.035);
  } else {
    const k = kind === 'bass' ? 1.1 : 1;
    s.moveTo(0.12, -0.035);
    s.bezierCurveTo(0.14 * k, -0.06 * k, 0.2 * k, -0.09 * k, 0.17 * k, -0.125 * k);
    s.bezierCurveTo(0.12 * k, -0.17 * k, 0.02 * k, -0.12 * k, -0.06 * k, -0.15 * k);
    s.bezierCurveTo(-0.16 * k, -0.19 * k, -0.27 * k, -0.14 * k, -0.27 * k, 0);
    s.bezierCurveTo(-0.27 * k, 0.14 * k, -0.16 * k, 0.18 * k, -0.06 * k, 0.14 * k);
    s.bezierCurveTo(0.03 * k, 0.11 * k, 0.13 * k, 0.18 * k, (kind === 'bass' ? 0.26 : 0.22) * k, 0.13 * k);
    s.bezierCurveTo(0.17 * k, 0.09 * k, 0.14 * k, 0.06 * k, 0.12, 0.035);
  }
  s.closePath();
  return s;
}

function sunburst(): THREE.Texture {
  const t = paintTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w * 0.42, h / 2, 2, w * 0.45, h / 2, w * 0.55);
    grd.addColorStop(0, '#f2b440');
    grd.addColorStop(0.45, '#d06a18');
    grd.addColorStop(0.75, '#5a1808');
    grd.addColorStop(1, '#1a0604');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  t.repeat.set(1.6, 1.6);
  t.offset.set(0.5, 0.5);
  return t;
}

/** A guitar (or bass): x runs up the neck, y across the body, z out of its face. */
export class Guitar {
  readonly group = new THREE.Group();
  /** The neck's two ends (x): where the frets start (the nut) and end. */
  readonly nut: number;
  readonly top: number;

  constructor(kind: GuitarShape, color: number, opts: { burst?: boolean; guard?: number } = {}) {
    const bass = kind === 'bass';
    const body = new THREE.ExtrudeGeometry(guitarOutline(kind), { depth: 0.045, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.007, bevelSegments: 1, curveSegments: 10 });
    body.translate(0, 0, -0.0225);
    const finish = opts.burst ? new THREE.MeshPhongMaterial({ map: sunburst(), shininess: 70, specular: 0x666666 }) : shiny(color, 70);
    this.group.add(new THREE.Mesh(body, finish));
    if (opts.guard !== undefined) {
      const guard = new THREE.Shape();
      guard.moveTo(0.1, -0.03);
      guard.bezierCurveTo(0.02, -0.13, -0.12, -0.12, -0.17, -0.06);
      guard.bezierCurveTo(-0.1, -0.02, 0.0, 0.0, 0.1, 0.03);
      guard.closePath();
      const gm = new THREE.Mesh(new THREE.ShapeGeometry(guard), shiny(opts.guard, 40));
      gm.position.z = 0.0315;
      this.group.add(gm);
    }
    this.nut = bass ? 0.86 : 0.6;
    this.top = 0.12;
    const wood = mat(0x7a4a22);
    const neckLen = this.nut - 0.06;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(neckLen, bass ? 0.055 : 0.05, 0.026), wood);
    neck.position.set(0.06 + neckLen / 2, 0, 0.012);
    this.group.add(neck);
    const board = new THREE.Mesh(new THREE.BoxGeometry(neckLen - 0.06, bass ? 0.054 : 0.048, 0.008), mat(0x241208));
    board.position.set(0.09 + (neckLen - 0.06) / 2, 0, 0.028);
    this.group.add(board);
    const headGeo = new THREE.BoxGeometry(bass ? 0.18 : 0.15, 0.07, 0.02);
    headGeo.translate((bass ? 0.18 : 0.15) / 2, 0, 0);
    const headstock = new THREE.Mesh(headGeo, kind === 'vee' || kind === 'star' ? finish : wood);
    headstock.position.set(this.nut, 0.006, 0.006);
    headstock.rotation.set(0, 0.22, kind === 'star' ? -0.25 : 0.06);
    this.group.add(headstock);
    const black = shiny(0x0c0c0e, 50);
    const chrome = shiny(0xd0d0d8, 100);
    for (const [x, m] of [
      [-0.05, black],
      [0.04, black],
    ] as const) {
      const pu = new THREE.Mesh(new THREE.BoxGeometry(0.032, bass ? 0.085 : 0.075, 0.012), m);
      pu.position.set(x, 0, 0.032);
      this.group.add(pu);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.016), chrome);
    bridge.position.set(-0.13, 0, 0.032);
    this.group.add(bridge);
    for (const [x, y] of [
      [-0.17, -0.09],
      [-0.12, -0.11],
    ]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 8), chrome);
      k.rotation.x = Math.PI / 2;
      k.position.set(x, y, 0.035);
      this.group.add(k);
    }
    const n = bass ? 4 : 6;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const y = (i - (n - 1) / 2) * (bass ? 0.011 : 0.0075);
      pts.push(-0.13, y, 0.041, this.nut, y * 0.8, 0.034);
    }
    const strings = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0x6e6c66 }));
    this.group.add(strings);
  }

  /** A point on the guitar (its own space) in its parent's space. */
  at(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrix();
    return out.set(x, y, z).applyMatrix4(this.group.matrix);
  }
}

// ---------------------------------------------------------------------------
// The players
// ---------------------------------------------------------------------------

export interface Player {
  readonly root: THREE.Group;
  update(f: VenueFrame): void;
}

/** A soft dark spot for under the players' feet. */
export function shadowTexture(): THREE.Texture {
  return paintTexture(64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
  });
}

/** How much a player's into it: the music's energy, the crowd, star power. */
function hypeOf(f: VenueFrame): number {
  return clamp(0.3 + f.energy * 0.55 + f.rock * 0.3 + f.power * 0.25, 0.2, 1.3);
}

/** A guitarist or bassist: strums on the part's notes, frets with its pitch. */
export class Rocker implements Player {
  readonly body: Body;
  readonly guitar: Guitar;
  private lastNote = -1e9;
  private strumAt = -1e9;
  private down = false;
  private fret = 0.4;
  private fretTarget = 0.4;
  private neckUp = 0;
  private readonly pose: Pose;
  private readonly phase: number;
  private readonly stance: number;
  private readonly strap: Limb;

  constructor(
    look: Look,
    readonly part: 'guitar' | 'bass',
    shape: GuitarShape,
    color: number,
    readonly seed: number,
    opts: { burst?: boolean; guard?: number; shadow?: THREE.Texture } = {},
  ) {
    this.body = new Body(look, { shadow: opts.shadow });
    this.guitar = new Guitar(part === 'bass' ? 'bass' : shape, color, opts);
    this.body.chest.add(this.guitar.group);
    this.strap = new Limb(this.body.chest, 0.014, 0.014, mat(0x1c120c), 4);
    this.phase = hash(seed) * 0.2;
    this.stance = 0.2 + hash(seed + 5) * 0.06;
    this.pose = {
      pelvis: new THREE.Vector3(),
      lean: new THREE.Euler(),
      nod: 0,
      turn: 0,
      feet: [new THREE.Vector3(), new THREE.Vector3()],
      hands: [new THREE.Vector3(), new THREE.Vector3()],
      elbows: [new THREE.Vector3(-1, -0.6, -0.7), new THREE.Vector3(0.8, -1, -0.3)],
    };
  }

  get root(): THREE.Group {
    return this.body.root;
  }

  update(f: VenueFrame): void {
    const bass = this.part === 'bass';
    const note = bass ? f.notes.bass : f.notes.guitar;
    if (note !== this.lastNote) {
      this.lastNote = note;
      if (note > 0) {
        this.strumAt = note;
        this.down = !this.down;
      }
    }
    const pitch = bass ? f.bassPitch : f.guitarPitch;
    if (pitch > 0) this.fretTarget = clamp(bass ? (pitch - 28) / 24 : (pitch - 40) / 34, 0, 1);
    this.fret += (this.fretTarget - this.fret) * Math.min(1, f.dt * 12);
    const hype = hypeOf(f);
    const beat = f.beat + this.phase;
    const b = bounce(beat);
    const sway = Math.sin(beat * Math.PI) * 0.035 * hype;
    this.neckUp += (f.power - this.neckUp) * Math.min(1, f.dt * 3);
    const p = this.pose;
    const squat = 0.035 * b * hype + this.neckUp * 0.06;
    p.pelvis.set(sway, 0.95 - squat, 0);
    const bang = (bass ? 0.18 : 0.42) * b * hype * clamp(f.energy * 1.4, 0.25, 1);
    p.lean.set(0.06 + b * 0.08 * hype - this.neckUp * 0.32, Math.sin(beat * 0.25 * Math.PI) * 0.15, -sway * 1.5);
    p.nod = bang - this.neckUp * 0.25;
    p.turn = Math.sin(f.beat * 0.125 * Math.PI + this.seed) * 0.25;
    const st = this.stance;
    p.feet[0].set(-st, 0, 0.04);
    p.feet[1].set(st, 0, 0.1);
    // The guitar on its strap; star power swings the neck up.
    const g = this.guitar.group;
    g.position.set(-0.04, 0.17 + this.neckUp * 0.06, 0.2);
    g.rotation.set(0.22 + this.neckUp * 0.25, -0.2 + this.neckUp * 0.12, (bass ? 0.32 : 0.4) + this.neckUp * 0.75 + b * 0.04 * hype);
    // Strumming hand: a stroke across the strings on each note (alternating down and up).
    const age = f.t - this.strumAt;
    const k = clamp(age / 0.07, 0, 1);
    let y = this.down ? 0.07 - 0.14 * k : -0.07 + 0.14 * k;
    y = THREE.MathUtils.lerp(y, 0.03, clamp((age - 0.6) / 0.4, 0, 1));
    this.guitar.at(bass ? 0.02 : -0.03, y, 0.075 - 0.02 * Math.sin(k * Math.PI), p.hands[0]);
    // Fretting hand slides with the pitch.
    const nx = THREE.MathUtils.lerp(this.guitar.nut - 0.05, this.guitar.nut * 0.45 + 0.08, this.fret);
    this.guitar.at(nx, -0.045, -0.01, p.hands[1]);
    this.guitar.at(0.2, 0.14, -0.03, _e);
    this.strap.set(new THREE.Vector3(0.15, 0.53, -0.02), _e);
    this.body.pose(p, f.dt);
  }
}

/** The singer: at the mic when there's singing, rocking out between lines. */
export class Singer implements Player {
  readonly body: Body;
  private readonly stand = new THREE.Group();
  private readonly mic = new THREE.Group();
  private sing = 0;
  private open = 0;
  private lastLine = -1e9;
  private readonly pose: Pose;

  constructor(look: Look, readonly seed: number, opts: { shadow?: THREE.Texture } = {}) {
    this.body = new Body(look, { mouth: true, shadow: opts.shadow });
    const chrome = shiny(0xc8c8d0, 90);
    const black = shiny(0x101012, 40);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.025, 14), black);
    base.position.y = 0.012;
    this.stand.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 1.44, 6), chrome);
    pole.position.y = 0.73;
    this.stand.add(pole);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.15, 8), black);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.04;
    this.mic.add(body);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.029, 8, 6), chrome);
    ball.position.z = -0.045;
    this.mic.add(ball);
    this.mic.position.set(0, 1.49, 0);
    this.mic.rotation.x = 0.35;
    this.stand.add(this.mic);
    this.stand.position.set(0, 0, 0.36);
    this.body.root.add(this.stand);
    this.pose = {
      pelvis: new THREE.Vector3(),
      lean: new THREE.Euler(),
      nod: 0,
      turn: 0,
      feet: [new THREE.Vector3(), new THREE.Vector3()],
      hands: [new THREE.Vector3(), new THREE.Vector3()],
      elbows: [new THREE.Vector3(-1, -0.8, -0.2), new THREE.Vector3(1, -0.8, -0.2)],
    };
  }

  get root(): THREE.Group {
    return this.body.root;
  }

  update(f: VenueFrame): void {
    const singing = f.singing > 0;
    if (singing) this.lastLine = f.t;
    // Stays at the mic through the gaps between words.
    const at = f.t - this.lastLine < 0.9 ? 1 : 0;
    this.sing += (at - this.sing) * Math.min(1, f.dt * 5);
    const hype = hypeOf(f);
    const b = bounce(f.beat);
    const p = this.pose;
    const high = singing ? clamp((f.singing - 62) / 14, 0, 1) : 0;
    const back = (1 - this.sing) * 0.3;
    const roam = (1 - this.sing) * Math.sin(f.beat * 0.25 * Math.PI) * 0.35;
    p.pelvis.set(roam, 0.95 - 0.03 * b * hype, -back);
    p.lean.set(0.1 * this.sing - 0.18 * high + 0.08 * b * hype * (1 - this.sing), Math.sin(f.beat * 0.5) * 0.1 * (1 - this.sing), Math.sin(f.beat * Math.PI) * 0.04);
    p.nod = this.sing * (0.12 - high * 0.35) + (1 - this.sing) * 0.3 * b * hype;
    p.turn = (1 - this.sing) * Math.sin(f.beat * 0.25 + this.seed) * 0.4;
    p.feet[0].set(-0.17 + roam, 0, 0.02 - back);
    p.feet[1].set(0.16 + roam, 0, 0.14 - back);
    // Hands: on the mic when singing; a fist pumped on the beat between lines.
    const mic = this.body.toChest(new THREE.Vector3(-0.03, 1.47, 0.36));
    const pump = new THREE.Vector3(-0.32, 0.86 + 0.14 * b, 0.12);
    p.hands[0].copy(pump).lerp(mic, this.sing);
    const hip = new THREE.Vector3(0.24, 0.1, 0.05);
    const stand = this.body.toChest(new THREE.Vector3(0.02, 1.15, 0.36));
    p.hands[1].copy(hip).lerp(stand, this.sing * 0.9);
    // The mouth: open on the words, wider on the high notes.
    const target = singing ? 0.45 + 0.45 * Math.abs(Math.sin(f.t * 9.5 + this.seed)) + high * 0.3 : 0.12;
    this.open += (target - this.open) * Math.min(1, f.dt * 18);
    this.body.mouth?.scale.set(1, this.open, 0.4);
    this.body.pose(p, f.dt);
  }
}

// ---------------------------------------------------------------------------
// The drummer
// ---------------------------------------------------------------------------

interface Hit {
  at: number;
  /** Where the stick comes down (root space). */
  point: THREE.Vector3;
}

interface Cymbal {
  mesh: THREE.Object3D;
  base: THREE.Euler;
  at: number;
}

function drum(r: number, h: number, shell: THREE.Material, head: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18, 1), [shell, head, head]);
}

export class Drummer implements Player {
  readonly body: Body;
  readonly kit = new THREE.Group();
  private readonly sticks: Limb[] = [];
  private readonly hits: [Hit, Hit];
  private kickAt = -1e9;
  private readonly last = { kick: -1e9, snare: -1e9, hat: -1e9, crash: -1e9 };
  private readonly kick: THREE.Group;
  private readonly hat: THREE.Mesh;
  private readonly cymbals: { crash: Cymbal; ride: Cymbal; hat: Cymbal };
  private readonly spots: Record<'snare' | 'hat' | 'crash' | 'ride' | 'tom1' | 'tom2' | 'floor', THREE.Vector3>;
  private fill = 0;
  private readonly pose: Pose;

  constructor(look: Look, shellColor: number, logo: string, opts: { shadow?: THREE.Texture } = {}) {
    this.body = new Body(look, { shadow: opts.shadow });
    this.body.root.add(this.kit);
    const shell = shiny(shellColor, 80, { specular: 0x999999 });
    const head = mat(0xe8e2d4);
    const chrome = shiny(0xc8c8d0, 100);
    const brass = shiny(0xc89a38, 90, { specular: 0xffe0a0, emissive: 0x1a1000 });

    // Kick drum, its front head with the band's name.
    this.kick = new THREE.Group();
    const kd = drum(0.29, 0.42, shell, head);
    kd.rotation.x = Math.PI / 2;
    this.kick.add(kd);
    const front = new THREE.Mesh(
      new THREE.CircleGeometry(0.285, 24),
      new THREE.MeshLambertMaterial({
        map: paintTexture(256, 256, (g, w, h) => {
          g.fillStyle = '#16120e';
          g.fillRect(0, 0, w, h);
          g.strokeStyle = css(shellColor, 1.3);
          g.lineWidth = 10;
          g.beginPath();
          g.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
          g.stroke();
          title(g, logo, w / 2, h / 2, w * 0.24, '#f2e8d0', 'rgba(0,0,0,0.9)');
        }),
      }),
    );
    front.position.z = 0.211;
    this.kick.add(front);
    this.kick.position.set(0, 0.3, 0.66);
    this.kit.add(this.kick);

    const place = (o: THREE.Object3D, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Object3D => {
      o.position.set(x, y, z);
      o.rotation.set(rx, 0, rz);
      this.kit.add(o);
      return o;
    };
    const standTo = (x: number, y: number, z: number): void => {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, y, 6), chrome);
      s.position.set(x, y / 2, z);
      this.kit.add(s);
      const legs = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 3, 1, true), chrome);
      legs.position.set(x, 0.09, z);
      this.kit.add(legs);
    };
    place(drum(0.17, 0.13, shell, head), 0.17, 0.68, 0.36, -0.18, 0.08);
    standTo(0.17, 0.62, 0.36);
    place(drum(0.13, 0.16, shell, head), 0.15, 0.92, 0.6, -0.5, 0.1);
    place(drum(0.14, 0.17, shell, head), -0.16, 0.93, 0.6, -0.5, -0.1);
    place(drum(0.21, 0.36, shell, head), -0.46, 0.5, 0.32, -0.06, -0.05);
    for (const [x, z] of [
      [-0.62, 0.42],
      [-0.32, 0.42],
      [-0.47, 0.16],
    ])
      place(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 4), chrome), x, 0.18, z);

    const cymbal = (r: number, x: number, y: number, z: number, rx: number, rz: number): Cymbal => {
      const c = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, r, 0.025, 28), brass);
      c.add(disc);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), brass);
      bell.position.y = 0.01;
      c.add(bell);
      place(c, x, y, z, rx, rz);
      standTo(x, y - 0.02, z);
      return { mesh: c, base: c.rotation.clone(), at: -1e9 };
    };
    const crash = cymbal(0.27, 0.52, 1.42, 0.66, -0.4, -0.25);
    const ride = cymbal(0.3, -0.62, 1.22, 0.58, -0.3, 0.25);
    const hatTop = cymbal(0.18, 0.47, 1.0, 0.32, -0.08, -0.05);
    this.hat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.03, 0.022, 24), brass);
    this.hat.position.set(0.47, 0.965, 0.32);
    this.hat.rotation.set(-0.08, 0, -0.05);
    this.kit.add(this.hat);
    this.cymbals = { crash, ride, hat: hatTop };

    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 14), mat(0x141414));
    stool.position.set(0, 0.5, -0.1);
    this.kit.add(stool);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 6), chrome);
    post.position.set(0, 0.23, -0.1);
    this.kit.add(post);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.26), chrome);
    pedal.position.set(-0.13, 0.03, 0.37);
    this.kit.add(pedal);

    this.spots = {
      snare: new THREE.Vector3(0.15, 0.76, 0.36),
      hat: new THREE.Vector3(0.43, 1.03, 0.3),
      crash: new THREE.Vector3(0.44, 1.46, 0.56),
      ride: new THREE.Vector3(-0.5, 1.28, 0.5),
      tom1: new THREE.Vector3(0.14, 1.0, 0.56),
      tom2: new THREE.Vector3(-0.15, 1.01, 0.56),
      floor: new THREE.Vector3(-0.44, 0.7, 0.32),
    };
    this.hits = [
      { at: -1e9, point: this.spots.hat.clone() },
      { at: -1e9, point: this.spots.snare.clone() },
    ];
    const wood = mat(0xd8b080);
    for (let i = 0; i < 2; i++) this.sticks.push(new Limb(this.body.chest, 0.009, 0.012, wood, 5));
    this.pose = {
      pelvis: new THREE.Vector3(0, 0.62, -0.1),
      lean: new THREE.Euler(0.12, 0, 0),
      nod: 0,
      turn: 0,
      feet: [new THREE.Vector3(-0.13, 0.02, 0.36), new THREE.Vector3(0.24, 0.02, 0.3)],
      hands: [new THREE.Vector3(), new THREE.Vector3()],
      elbows: [new THREE.Vector3(-1, -0.4, -0.6), new THREE.Vector3(1, -0.4, -0.6)],
      knees: new THREE.Vector3(0, 0.8, 1),
      heels: [0, 0],
    };
  }

  get root(): THREE.Group {
    return this.body.root;
  }

  private strike(hand: 0 | 1, point: THREE.Vector3, t: number): void {
    this.hits[hand].at = t;
    this.hits[hand].point.copy(point);
  }

  update(f: VenueFrame): void {
    const t = f.t;
    const n = f.notes;
    const inBar = (f.beat - f.barStart) / Math.max(1, f.beatsPerBar);
    // A fill on the last beat of every fourth bar: the snare hand goes round the toms.
    const bar = Math.floor(f.barStart / Math.max(1, f.beatsPerBar) + 0.5);
    const filling = bar % 4 === 3 && inBar > (f.beatsPerBar - 1) / f.beatsPerBar;
    if (n.kick !== this.last.kick) {
      this.last.kick = n.kick;
      this.kickAt = n.kick;
    }
    if (n.snare !== this.last.snare) {
      this.last.snare = n.snare;
      if (filling) {
        const i = this.fill++ % 4;
        this.strike(([1, 0, 0, 1] as const)[i], [this.spots.tom1, this.spots.tom2, this.spots.floor, this.spots.floor][i], n.snare);
      } else this.strike(1, this.spots.snare, n.snare);
    }
    let crashed = false;
    if (n.crash !== this.last.crash) {
      this.last.crash = n.crash;
      this.strike(Math.abs(n.crash - n.snare) < 0.04 ? 0 : 1, this.spots.crash, n.crash);
      this.cymbals.crash.at = n.crash;
      crashed = true;
    }
    if (n.hat !== this.last.hat) {
      this.last.hat = n.hat;
      // Big parts on the ride, the rest on the hats.
      const ride = f.energy > 0.72;
      if (!crashed || this.hits[0].at !== n.crash) this.strike(0, ride ? this.spots.ride : this.spots.hat, n.hat);
      (ride ? this.cymbals.ride : this.cymbals.hat).at = n.hat;
    }
    const hype = hypeOf(f);
    const b = bounce(f.beat);
    const p = this.pose;
    p.pelvis.set(0, 0.62 + b * 0.012 * hype, -0.1);
    p.lean.set(0.14 + b * 0.05 * hype, 0, 0);
    p.nod = 0.1 + b * 0.3 * hype;
    p.turn = Math.sin(f.beat * 0.25) * 0.2;
    // The kick foot stamps; the heel rises between.
    const kAge = t - this.kickAt;
    p.heels![0] = 0.35 * clamp(kAge / 0.12, 0, 1) * clamp(1 - (kAge - 0.4) / 0.4, 0.3, 1);
    p.feet[0].set(-0.13, 0.02 + 0.05 * clamp(kAge / 0.12, 0, 1) * clamp(1 - (kAge - 0.4), 0.3, 1), 0.36);
    this.kick.scale.setScalar(1 + 0.03 * Math.exp(-kAge * 25));
    // Each hand: down on the hit, up again after (the stick tip rising further than the hand).
    for (let i = 0; i < 2; i++) {
      const h = this.hits[i];
      const age = t - h.at;
      const lift = 0.16 * (1 - Math.exp(-age * 16)) * (0.6 + 0.4 * hype);
      const tip = h.point.clone();
      tip.y += lift * 1.6;
      const wrist = h.point.clone().add(new THREE.Vector3(i === 0 ? -0.06 : 0.06, 0.08 + lift, -0.3));
      const wc = this.body.toChest(wrist.clone());
      p.hands[i].copy(wc);
      const tc = this.body.toChest(tip);
      _d.subVectors(tc, wc).normalize();
      this.sticks[i].set(wc.clone().addScaledVector(_d, -0.04), wc.clone().addScaledVector(_d, 0.38));
    }
    // Cymbals swing when they're hit.
    for (const c of Object.values(this.cymbals)) {
      const age = t - c.at;
      const w = age < 3 ? Math.exp(-age * 3.5) * Math.sin(age * 22) : 0;
      c.mesh.rotation.set(c.base.x + w * 0.22, c.base.y, c.base.z + w * 0.1);
    }
    const hatAge = t - this.cymbals.hat.at;
    this.cymbals.hat.mesh.position.y = 1.0 + (hatAge < 0.08 ? 0 : 0.015);
    this.body.pose(p, f.dt);
  }
}

// ---------------------------------------------------------------------------
// The crowd
// ---------------------------------------------------------------------------

export interface CrowdOpts {
  count: number;
  /** Where they stand: x and z ranges (z = rows back from the stage). */
  x: [number, number];
  z: [number, number];
  /** Where they look (the stage). */
  look: THREE.Vector3;
  colors: number[];
  /** Brightness of their clothes (they're lit from the stage). */
  shade?: number;
  lighters?: boolean;
  seed?: number;
  size?: number;
  /** Where the floor is under each row (raked seats). */
  rake?: (z: number) => number;
}

interface Fan {
  x: number;
  z: number;
  y: number;
  size: number;
  phase: number;
  jump: number;
  hype: number;
  yaw: number;
}

export class Crowd {
  readonly group = new THREE.Group();
  private readonly bodies: THREE.InstancedMesh;
  private readonly armsUp: THREE.InstancedMesh;
  private readonly armsDown: THREE.InstancedMesh;
  private readonly fans: Fan[] = [];
  private readonly lights: THREE.Points | null = null;
  private readonly lightPos: Float32Array | null = null;
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(readonly o: CrowdOpts) {
    const seed = o.seed ?? 1;
    const parts = [new THREE.BoxGeometry(0.34, 0.84, 0.2).translate(0, 0.42, 0), new THREE.BoxGeometry(0.44, 0.6, 0.25).translate(0, 1.13, 0), new THREE.SphereGeometry(0.125, 8, 6).translate(0, 1.6, 0)];
    const body = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    const up = mergeGeometries(
      [-1, 1].map((s) => {
        const a = new THREE.BoxGeometry(0.09, 0.62, 0.09).translate(0, 0.31, 0);
        a.rotateZ(-s * 0.32);
        return a.translate(s * 0.2, 1.38, 0).toNonIndexed();
      }),
    );
    const down = mergeGeometries([-1, 1].map((s) => new THREE.BoxGeometry(0.085, 0.56, 0.1).translate(s * 0.27, 1.13, 0.02).toNonIndexed()));
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.bodies = new THREE.InstancedMesh(body, m, o.count);
    this.armsUp = new THREE.InstancedMesh(up, m, o.count);
    this.armsDown = new THREE.InstancedMesh(down, m, o.count);
    const c = new THREE.Color();
    for (let i = 0; i < o.count; i++) {
      const r = (k: number): number => hash(seed * 7919 + i * 31 + k);
      const z = THREE.MathUtils.lerp(o.z[0], o.z[1], Math.sqrt(r(1)));
      const x = THREE.MathUtils.lerp(o.x[0], o.x[1], r(2));
      this.fans.push({ x, z, y: o.rake ? o.rake(z) : 0, size: (o.size ?? 1) * (0.88 + r(3) * 0.22), phase: (r(4) - 0.5) * 0.25, jump: r(5), hype: r(6), yaw: Math.atan2(o.look.x - x, o.look.z - z) + (r(7) - 0.5) * 0.5 });
      c.set(o.colors[Math.floor(r(8) * o.colors.length)]).multiplyScalar((o.shade ?? 1) * (0.55 + r(9) * 0.6));
      this.bodies.setColorAt(i, c);
      this.armsUp.setColorAt(i, c);
      this.armsDown.setColorAt(i, c);
    }
    for (const im of [this.bodies, this.armsUp, this.armsDown]) {
      im.frustumCulled = false;
      this.group.add(im);
    }
    if (o.lighters) {
      this.lightPos = new Float32Array(o.count * 3);
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3));
      this.lights = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffc070, size: 0.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.lights.frustumCulled = false;
      this.lights.renderOrder = 11;
      this.group.add(this.lights);
    }
  }

  update(f: VenueFrame): void {
    const e = clamp(0.2 + f.rock * 0.55 + f.energy * 0.5 + f.power * 0.35 + f.drop * 0.3, 0, 1.4);
    const quiet = f.energy < 0.33 ? clamp((0.33 - f.energy) / 0.12, 0, 1) : 0;
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let lit = 0;
    for (let i = 0; i < this.fans.length; i++) {
      const fan = this.fans[i];
      const ph = f.beat + fan.phase;
      const jumper = fan.jump < e * 0.7;
      const hop = jumper ? 0.2 * e * bounce(ph) : 0.03 * bounce(ph);
      pos.set(fan.x, fan.y + hop, fan.z);
      q.setFromAxisAngle(up, fan.yaw + Math.sin(ph * 0.5 + i) * 0.08);
      scl.setScalar(fan.size);
      _m.compose(pos, q, scl);
      this.bodies.setMatrixAt(i, _m);
      const raised = fan.hype < e - 0.45 || (quiet > 0.5 && fan.hype < 0.35);
      this.armsUp.setMatrixAt(i, raised ? _m : this.hidden);
      this.armsDown.setMatrixAt(i, raised ? this.hidden : _m);
      if (this.lightPos) {
        const on = quiet > 0.5 && fan.hype < 0.35;
        const k = lit * 3;
        if (on) {
          this.lightPos[k] = fan.x + Math.sin(fan.yaw) * 0.1 + 0.36 * fan.size;
          this.lightPos[k + 1] = fan.y + hop + 1.98 * fan.size;
          this.lightPos[k + 2] = fan.z;
          lit++;
        }
      }
    }
    for (const im of [this.bodies, this.armsUp, this.armsDown]) im.instanceMatrix.needsUpdate = true;
    if (this.lights && this.lightPos) {
      const g = this.lights.geometry;
      g.setDrawRange(0, lit);
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.lights.material as THREE.PointsMaterial).opacity = 0.6 + 0.4 * Math.sin(f.t * 3);
    }
  }
}
