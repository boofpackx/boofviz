import * as THREE from 'three';
import { Crowd, Drummer, Guitar, Rocker, Singer, shadowTexture, type GuitarShape, type Look, type Player } from './band';
import { FONT_HUD, FONT_SECTION } from './hud';
import {
  bannerTexture,
  brickTexture,
  checkerTexture,
  crateTexture,
  curtainTexture,
  deckTexture,
  garagePosters,
  neonTexture,
  pizzaTexture,
  plateTexture,
  rugTexture,
  skyTexture,
  sleeveTexture,
  smokeTexture,
  standsTexture,
  windowTexture,
} from './venueArt';
import { Beam, Director, Flames, Glows, bounce, box, clamp, cyl, glowTexture, grille, hash, lambert, paintTexture, picture, planks, type Shot } from './venueKit';
import type { Venue, VenueFrame } from './venueTypes';

/**
 * The venues: a garage rehearsal room, a metal arena with a horned skull, a
 * neon '80s club and a stadium at night. Each is a 3D set with the band on
 * it (see band.ts), lights that play to the beat, and a camera director
 * cutting between shots of the band every couple of bars.
 */

type Vec = [number, number, number];
/** A player's spot: x, y (the floor they stand on), z, which way they face. */
type Spot = [number, number, number, number];

interface Cast {
  guitar: Look;
  bass: Look;
  singer: Look;
  drums: Look;
  guitarShape: GuitarShape;
  guitarColor: number;
  burst?: boolean;
  guard?: number;
  bassColor: number;
  bassGuard?: number;
  shell: number;
  logo: string;
}

const SKIN = { pale: 0xf3d2b4, light: 0xe8b890, tan: 0xc88a5e, brown: 0x8e5a3a, dark: 0x5e3a24 };

function disposeTree(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mm) for (const x of Array.isArray(mm) ? mm : [mm]) mats.add(x);
  });
  const texs = new Set<THREE.Texture>();
  for (const m of mats) {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) texs.add(v);
    const u = (m as THREE.ShaderMaterial).uniforms;
    if (u) for (const x of Object.values(u)) if (x.value instanceof THREE.Texture) texs.add(x.value);
  }
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t.dispose());
}

const ease = (u: number): number => u * u * (3 - 2 * u);
const mix3 = (a: Vec, b: Vec, u: number): Vec => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** A camera move from a to b (eased over the shot), looking from la to lb. */
function dolly(a: Vec, b: Vec, la: Vec, lb: Vec = la, fov = 50): Shot {
  return { pos: (u) => mix3(a, b, ease(u)), look: (u) => mix3(la, lb, ease(u)), fov };
}

/**
 * A shot of one player, put at (sx, sy) on screen (−1..1; off to a side, so
 * the highway in the middle doesn't hide them): `dist` away at `h` above
 * their floor, from `yaw` round from the front, swinging `drift` over the shot.
 */
function framing(spot: Spot, sx: number, sy: number, dist: number, h: number, fov: number, yaw = 0, drift = 0.25, chest = 1.3): Shot {
  const t = Math.tan((fov * Math.PI) / 360);
  const [x, y, z, face] = spot;
  return {
    pos: (u) => {
      const a = face + yaw + (u - 0.5) * drift;
      return [x + Math.sin(a) * dist, y + h, z + Math.cos(a) * dist];
    },
    look: (u, f) => {
      const a = face + yaw + (u - 0.5) * drift;
      const off = -sx * dist * t * f.aspect;
      return [x + Math.cos(a) * off, y + chest - sy * dist * t, z - Math.sin(a) * off];
    },
    fov,
  };
}

abstract class Stage implements Venue {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 900);
  protected readonly players: Player[] = [];
  protected readonly crowds: Crowd[] = [];
  protected director: Director | null = null;
  protected readonly shadow = shadowTexture();
  private lastPower = 0;
  private lastDrop = 0;

  update(f: VenueFrame): void {
    for (const p of this.players) p.update(f);
    for (const c of this.crowds) c.update(f);
    const powerOn = f.power > 0.5 && this.lastPower <= 0.5;
    const dropOn = f.drop > 0.6 && this.lastDrop <= 0.6;
    this.lastPower = f.power;
    this.lastDrop = f.drop;
    this.animate(f, powerOn || dropOn);
    this.director?.update(this.camera, f);
  }

  /** Animate the set; `big` when star power or a drop just went off (pyro, fireworks). */
  protected abstract animate(f: VenueFrame, big: boolean): void;

  protected band(cast: Cast, at: { guitar: Spot; bass: Spot; singer: Spot; drums: Spot }): void {
    const players: Array<[Player, Spot]> = [
      [new Rocker(cast.guitar, 'guitar', cast.guitarShape, cast.guitarColor, 3, { burst: cast.burst, guard: cast.guard, shadow: this.shadow }), at.guitar],
      [new Rocker(cast.bass, 'bass', 'bass', cast.bassColor, 7, { guard: cast.bassGuard, shadow: this.shadow }), at.bass],
      [new Singer(cast.singer, 11, { shadow: this.shadow }), at.singer],
      [new Drummer(cast.drums, cast.shell, cast.logo, { shadow: this.shadow }), at.drums],
    ];
    for (const [p, s] of players) {
      p.root.position.set(s[0], s[1], s[2]);
      p.root.rotation.y = s[3];
      this.scene.add(p.root);
      this.players.push(p);
    }
  }

  dispose(): void {
    disposeTree(this.scene);
    this.shadow.dispose();
  }
}

/** Faces of a box (+x, −x, +y, −y, +z, −z) with one face different. */
function faced(base: THREE.Material, face: THREE.Material, which = 4): THREE.Material[] {
  return [0, 1, 2, 3, 4, 5].map((i) => (i === which ? face : base));
}

/** A speaker cabinet. */
function cabinet(w: number, h: number, d: number, front: THREE.Material, tolex: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), faced(tolex, front));
}

function hot(r: number, g: number, b: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
}

// ---------------------------------------------------------------------------
// The garage
// ---------------------------------------------------------------------------

class Garage extends Stage {
  private readonly bulb = new THREE.PointLight(0xffc27a, 10, 0, 2);
  private readonly bulbMesh: THREE.Mesh;
  private readonly cord: THREE.Mesh;
  private readonly glows = new Glows();
  private readonly bulbGlow: THREE.Sprite;
  private readonly fairy: Array<{ s: THREE.Sprite; c: THREE.Color }> = [];
  private readonly lamps: Array<{ light: THREE.PointLight; glow: THREE.Sprite; color: THREE.Color; on: 'kick' | 'snare' }> = [];
  private readonly woofer: THREE.Mesh;
  private readonly curtains: THREE.Mesh[] = [];
  private readonly pivot = new THREE.Vector3(0.5, 3.1, -0.7);
  private swing = { ax: 0.1, vx: 0, az: 0, vz: 0 };

  constructor() {
    super();
    const s = this.scene;
    s.background = new THREE.Color(0x040302);
    const W = 4.6;
    const D0 = -3.8;
    const D1 = 3.4;
    const H = 3.1;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, D1 - D0), lambert(paintTexture(512, 512, (g, w, h) => planks(g, w, h, 40, [104, 70, 40], 41, false), [3, 3])));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, (D0 + D1) / 2);
    s.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.9), lambert(rugTexture()));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.1, 0.004, -0.9);
    s.add(rug);
    const wall = (seed: number, rep: [number, number]): THREE.Material => lambert(paintTexture(512, 256, (g, w, h) => planks(g, w, h, 30, [118, 88, 54], seed), rep));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, H), wall(11, [3, 1]));
    back.position.set(0, H / 2, D0);
    s.add(back);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(D1 - D0, H), wall(17 + side, [2.4, 1]));
      m.position.set(side * W, H / 2, (D0 + D1) / 2);
      m.rotation.y = (-side * Math.PI) / 2;
      s.add(m);
    }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, H), wall(29, [3, 1]));
    front.position.set(0, H / 2, D1);
    front.rotation.y = Math.PI;
    s.add(front);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, D1 - D0), lambert(paintTexture(512, 256, (g, w, h) => planks(g, w, h, 24, [70, 50, 32], 23, false), [2, 2])));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H, (D0 + D1) / 2);
    s.add(ceil);
    const rafter = lambert(0x4a301a);
    for (let z = D0 + 0.5; z < D1; z += 1.15) s.add(box(2 * W, 0.2, 0.12, rafter, 0, H - 0.1, z));

    // The window at the back, blinds down, green curtains.
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshBasicMaterial({ map: windowTexture() }));
    win.position.set(0.5, 1.8, D0 + 0.01);
    s.add(win);
    const trim = lambert(0xd8ccb0);
    s.add(box(1.76, 0.07, 0.08, trim, 0.5, 2.38, D0 + 0.03), box(1.76, 0.07, 0.08, trim, 0.5, 1.22, D0 + 0.03), box(0.07, 1.2, 0.08, trim, -0.33, 1.8, D0 + 0.03), box(0.07, 1.2, 0.08, trim, 1.33, 1.8, D0 + 0.03), box(1.95, 0.05, 0.18, trim, 0.5, 1.18, D0 + 0.08));
    const curtain = lambert(curtainTexture('#1e3a1e', '#3d6a3a'));
    curtain.side = THREE.DoubleSide;
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.7), curtain);
      c.position.set(0.5 + side * 1.02, 1.62, D0 + 0.13);
      s.add(c);
      this.curtains.push(c);
    }
    const rod = cyl(0.016, 0.016, 2.7, lambert(0x6a5030), 6);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0.5, 2.5, D0 + 0.13);
    s.add(rod);

    // The old couch under it, a guitar left on it.
    const fabric = lambert(0x7a6440);
    const cz = D0 + 0.58;
    s.add(box(2.3, 0.42, 0.9, fabric, 0.5, 0.21, cz), box(2.3, 0.64, 0.24, fabric, 0.5, 0.62, cz - 0.36), box(0.24, 0.64, 0.92, fabric, -0.63, 0.32, cz), box(0.24, 0.64, 0.92, fabric, 1.63, 0.32, cz));
    const cushion = lambert(0x8e7a52);
    s.add(box(1.0, 0.12, 0.72, cushion, 0.0, 0.48, cz + 0.06), box(1.0, 0.12, 0.72, cushion, 1.02, 0.48, cz + 0.06));
    const spare = new Guitar('double', 0xb01818, { guard: 0xf0f0f0 });
    spare.group.position.set(0.95, 0.58, cz + 0.08);
    spare.group.rotation.set(-Math.PI / 2 + 0.2, 0, 0.4);
    s.add(spare.group);

    // Posters, a banner.
    const P = garagePosters();
    s.add(picture(P[0], 0.62, 0.78, -3.75, 1.95, D0 + 0.02, 0, -0.05));
    s.add(picture(P[1], 0.56, 0.69, -2.9, 2.02, D0 + 0.02, 0, 0.04));
    s.add(picture(P[2], 0.5, 0.57, -2.15, 1.82, D0 + 0.02, 0, -0.03));
    s.add(picture(P[3], 0.52, 0.81, 2.35, 1.95, D0 + 0.02, 0, 0.03));
    s.add(picture(P[4], 0.64, 0.77, 3.35, 1.9, D0 + 0.02, 0, -0.04));
    s.add(picture(bannerTexture('THE BOOFS', 'live in the garage'), 2.4, 0.9, -W + 0.02, 2.15, -0.9, Math.PI / 2, 0.02));
    s.add(picture(P[1], 0.56, 0.69, W - 0.02, 1.95, -1.8, -Math.PI / 2, 0.05));
    s.add(picture(P[3], 0.52, 0.81, W - 0.02, 1.9, 0.6, -Math.PI / 2, -0.04));

    // The amp stack (back left), a bass amp with its speaker showing (back right).
    const tolex = lambert(0x141414);
    const cloth = lambert(paintTexture(256, 256, (g, w, h) => grille(g, w, h, '#2a241c')));
    for (const [y, h] of [
      [0.42, 0.84],
      [1.26, 0.84],
    ] as const) {
      const c = cabinet(0.9, h, 0.45, cloth, tolex);
      c.position.set(-3.45, y, -3.2);
      c.rotation.y = 0.4;
      s.add(c);
    }
    const head = cabinet(0.9, 0.32, 0.42, lambert(plateTexture('BOOF')), tolex);
    head.position.set(-3.45, 1.84, -3.2);
    head.rotation.y = 0.4;
    s.add(head);
    const bassAmp = cabinet(0.8, 0.9, 0.5, lambert(0x1c1c1e), tolex);
    bassAmp.position.set(3.25, 0.45, -3.05);
    bassAmp.rotation.y = -0.45;
    s.add(bassAmp);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.12, 20, 1, true), new THREE.MeshPhongMaterial({ color: 0x2a2a2a, shininess: 10, side: THREE.DoubleSide }));
    cone.rotation.x = -Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0x3a3a3a, shininess: 40 }));
    cap.rotation.x = Math.PI;
    cap.position.y = 0.03;
    cone.add(cap);
    this.woofer = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 24), new THREE.MeshPhongMaterial({ color: 0xa0a0a8, shininess: 80 }));
    this.woofer.add(cone);
    cone.position.z = 0.0;
    this.woofer.position.set(3.25 + Math.sin(-0.45) * 0.26, 0.42, -3.05 + Math.cos(-0.45) * 0.26);
    this.woofer.rotation.y = -0.45;
    s.add(this.woofer);
    const combo = cabinet(0.62, 0.5, 0.3, cloth, tolex);
    combo.position.set(2.45, 0.25, -3.4);
    combo.rotation.y = -0.2;
    s.add(combo);

    // Milk crates, records, a pizza box.
    const crate = (x: number, y: number, z: number, ry: number, color: string): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.33, 0.42), lambert(crateTexture(color)));
      m.position.set(x, y + 0.165, z);
      m.rotation.y = ry;
      s.add(m);
    };
    crate(-2.45, 0, -3.42, 0.1, '#e07018');
    crate(-2.45, 0.33, -3.42, -0.08, '#2860c0');
    crate(-1.95, 0, -3.5, 0.3, '#c8c8c8');
    for (let i = 0; i < 3; i++) {
      const r = picture(sleeveTexture(i), 0.31, 0.31, -2.55 + i * 0.05, 0.16, -3.12 + i * 0.03, 0.1, 0);
      r.rotation.x = -0.22;
      s.add(r);
    }
    const card = lambert(0xb8a07a);
    const pizza = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), faced(card, lambert(pizzaTexture()), 2));
    pizza.position.set(2.6, 0.025, 1.4);
    pizza.rotation.y = 0.5;
    s.add(pizza);
    const can = new THREE.MeshPhongMaterial({ color: 0xc81818, shininess: 90 });
    for (const [x, z] of [
      [2.3, 1.9],
      [2.95, 1.1],
      [-2.9, 1.5],
    ]) {
      const c = cyl(0.033, 0.033, 0.12, can, 10);
      c.position.set(x, 0.06, z);
      s.add(c);
    }

    // The bare bulb, the clamp lights on the rafters, fairy lights along the back.
    this.cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 4).translate(0, -0.5, 0), lambert(0x111111));
    this.cord.position.copy(this.pivot);
    s.add(this.cord);
    this.bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), hot(6, 4.2, 2.2));
    s.add(this.bulbMesh, this.bulb);
    s.add(this.glows.group);
    this.bulbGlow = this.glows.add(0xffc890, 0, 0, 0, 0.9);
    for (const [x, z, color, on] of [
      [-3.6, 1.2, 0xff2a20, 'kick'],
      [3.6, 0.9, 0x2a5aff, 'snare'],
      [-0.6, 2.3, 0xffb040, 'kick'],
    ] as const) {
      const light = new THREE.PointLight(color, 0, 0, 2);
      light.position.set(x, H - 0.45, z);
      s.add(light);
      const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 10, 1, true), new THREE.MeshPhongMaterial({ color: 0x909098, side: THREE.DoubleSide }));
      lamp.position.set(x, H - 0.32, z);
      s.add(lamp);
      this.lamps.push({ light, glow: this.glows.add(color, x, H - 0.42, z, 0.5), color: new THREE.Color(color), on });
    }
    const palette = [0xff3030, 0x30ff60, 0x3070ff, 0xffd030, 0xff40c0];
    const wire: number[] = [];
    for (let i = 0; i < 26; i++) {
      const u = i / 25;
      const x = -W + 0.15 + u * (2 * W - 0.3);
      const y = H - 0.22 - Math.sin(((u * 6) % 1) * Math.PI) * 0.14;
      const c = new THREE.Color(palette[i % palette.length]);
      this.fairy.push({ s: this.glows.add(c, x, y, D0 + 0.08, 0.2), c });
      wire.push(x, y + 0.02, D0 + 0.06);
    }
    s.add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: 0x0a0a0a })));
    s.add(new THREE.HemisphereLight(0xffe2b8, 0x3a2818, 1.8));

    // The band.
    const spots: Record<'guitar' | 'bass' | 'singer' | 'drums', Spot> = {
      guitar: [-1.45, 0, 0.05, 0.25],
      bass: [1.75, 0, -0.35, -0.3],
      singer: [0.2, 0, 0.65, 0],
      drums: [-1.5, 0, -2.15, 0.3],
    };
    this.band(
      {
        guitar: { skin: SKIN.light, shirt: 0x26262a, print: 'skull', pants: 0x2c3e5e, hair: 0x2a180c, style: 'long', beard: true },
        bass: { skin: SKIN.brown, shirt: 0xb02020, vest: 0x161616, bare: true, print: 'none', pants: 0x161618, hair: 0x40d050, style: 'mohawk' },
        singer: { skin: SKIN.pale, shirt: 0xe6ded0, print: 'star', pants: 0x26262c, hair: 0xd8b060, style: 'bob' },
        drums: { skin: SKIN.tan, shirt: 0x3a5a3a, bare: true, print: 'none', pants: 0x3a3a3c, hair: 0x2a1a0a, style: 'bandana', band: 0x1a3aa0, glasses: true },
        guitarShape: 'double',
        guitarColor: 0x000000,
        burst: true,
        guard: 0x161616,
        bassColor: 0x2050c0,
        bassGuard: 0xf0f0f0,
        shell: 0x8a1010,
        logo: 'BOOF',
      },
      spots,
    );
    this.director = new Director(
      [
        dolly([-0.9, 1.75, 3.2], [0.9, 1.7, 3.2], [0, 1.15, -1.3], [0, 1.15, -1.3], 64),
        framing(spots.guitar, -0.48, 0.16, 2.5, 1.55, 44, -0.5),
        framing(spots.bass, 0.48, 0.16, 2.5, 1.55, 44, 0.35),
        framing(spots.singer, 0.46, 0.2, 2.4, 1.62, 42, 0.35),
        framing(spots.drums, 0.45, 0.1, 2.6, 2.1, 48, 0.55, 0.3, 1.0),
        dolly([1.4, 0.55, 3.1], [-1.4, 0.6, 3.1], [0.2, 1.5, -1.5], [-0.2, 1.5, -1.5], 58),
        dolly([-4.2, 2.0, 2.8], [-4.2, 1.9, 1.8], [0.4, 1.0, -1.3], [0.4, 1.0, -1.3], 56),
      ],
      dolly([0, 0.9, 3.2], [0, 1.25, 2.3], [-0.3, 1.5, -0.6], [-0.3, 1.65, -0.6], 56),
    );
  }

  protected animate(f: VenueFrame): void {
    // The bulb swings on its cord; the kicks shake the house.
    const L = 0.95;
    const sw = this.swing;
    const dt = Math.min(f.dt, 0.05);
    sw.vx += (-(9.8 / L) * Math.sin(sw.ax) - sw.vx * 0.25 + f.kick * 1.4 * (hash(Math.floor(f.t * 10)) - 0.35)) * dt;
    sw.vz += (-(9.8 / L) * Math.sin(sw.az) - sw.vz * 0.25 + f.snare * 0.8 * (hash(Math.floor(f.t * 10) + 7) - 0.5)) * dt;
    sw.ax = clamp(sw.ax + sw.vx * dt, -0.5, 0.5);
    sw.az = clamp(sw.az + sw.vz * dt, -0.5, 0.5);
    const bp = new THREE.Vector3(Math.sin(sw.ax) * L, -Math.cos(sw.ax) * Math.cos(sw.az) * L, Math.sin(sw.az) * L).add(this.pivot);
    this.cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), bp.clone().sub(this.pivot).normalize());
    this.cord.scale.y = L - 0.05;
    this.bulbMesh.position.copy(bp);
    this.bulb.position.copy(bp).y -= 0.05;
    const flicker = 0.92 + 0.08 * Math.sin(f.t * 53) * Math.sin(f.t * 17);
    this.bulb.intensity = 10 * flicker * (0.8 + 0.25 * f.stage);
    this.bulbGlow.position.copy(bp);
    // Clamp lights on the kick and the snare.
    for (const l of this.lamps) {
      const k = l.on === 'kick' ? f.kick : f.snare;
      const v = f.stage * (0.25 + 1.6 * k + f.power * 0.6);
      l.light.intensity = 9 * v;
      l.light.color.copy(f.power > 0.5 ? new THREE.Color(0x40a0ff) : l.color);
      (l.glow.material as THREE.SpriteMaterial).color.copy(l.light.color).multiplyScalar(0.4 + v);
    }
    // Fairy lights chase on the beat.
    const step = Math.floor(f.beat * 2);
    this.fairy.forEach((b, i) => {
      const on = (i + step) % 3 === 0 ? 1 : 0.35;
      (b.s.material as THREE.SpriteMaterial).color.copy(b.c).multiplyScalar(on * (1.2 + f.highs));
    });
    // The bass speaker pumps.
    const cone = this.woofer.children[0];
    cone.position.z = 0.03 + f.bass * 0.05 * Math.sin(f.t * 60) + f.kick * 0.03;
    for (const [i, c] of this.curtains.entries()) c.rotation.y = Math.sin(f.t * 0.7 + i * 2) * 0.05 + f.kick * 0.02;
  }
}

// ---------------------------------------------------------------------------
// The arena: a metal stage, a giant horned skull with burning eyes
// ---------------------------------------------------------------------------

function hornedSkull(): { group: THREE.Group; eyes: THREE.Vector3[] } {
  const g = new THREE.Group();
  const bone = lambert(0xd6c8a8);
  const dark = new THREE.MeshBasicMaterial({ color: 0x030101 });
  const tooth = lambert(0xece2c6);
  const horn = new THREE.MeshPhongMaterial({ color: 0x241a12, shininess: 35, specular: 0x5a4632 });
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(2.1, 26, 18), bone);
  cranium.scale.set(1, 0.95, 0.85);
  cranium.position.y = 0.75;
  g.add(cranium);
  const face = new THREE.Mesh(new THREE.SphereGeometry(1.55, 22, 14), bone);
  face.scale.set(1.05, 0.95, 0.9);
  face.position.set(0, -0.55, 0.62);
  g.add(face);
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), bone);
    cheek.position.set(s * 1.05, -0.62, 1.12);
    g.add(cheek);
  }
  const eyes: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.56, 14, 10), dark);
    e.scale.set(1.12, 0.92, 0.5);
    e.position.set(s * 0.74, -0.05, 1.78);
    g.add(e);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.26, 0.5), bone);
    brow.position.set(s * 0.72, 0.52, 1.72);
    brow.rotation.z = s * 0.28;
    g.add(brow);
    eyes.push(new THREE.Vector3(s * 0.74, -0.05, 2.05));
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.62, 3), dark);
  nose.rotation.z = Math.PI;
  nose.scale.z = 0.4;
  nose.position.set(0, -0.86, 2.02);
  g.add(nose);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.55, 1.4), bone);
  jaw.position.set(0, -2.2, 0.85);
  g.add(jaw);
  g.add(box(2.0, 0.09, 0.2, dark, 0, -1.78, 1.85));
  for (let i = -3; i <= 3; i++) {
    const z = 1.88 - Math.abs(i) * 0.08;
    g.add(box(0.22, 0.42, 0.2, tooth, i * 0.27, -1.53, z), box(0.22, 0.36, 0.2, tooth, i * 0.27, -2.0, z - 0.04));
  }
  for (const s of [-1, 1]) {
    const pts = [
      [1.55, 1.3, 0.2],
      [2.55, 1.75, 0.4],
      [3.4, 2.75, 0.6],
      [3.65, 4.0, 0.9],
      [3.25, 5.05, 1.2],
      [2.6, 5.65, 1.45],
    ].map(([x, y, z]) => new THREE.Vector3(x * s, y, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = curve.getPoint(i / N);
      const b = curve.getPoint((i + 1) / N);
      const r0 = 0.58 * (1 - i / N) + 0.03;
      const r1 = 0.58 * (1 - (i + 1) / N) + 0.03;
      const len = a.distanceTo(b);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 12, 1).translate(0, 0.5, 0), horn);
      seg.position.copy(a);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      seg.scale.y = len;
      g.add(seg);
      const joint = new THREE.Mesh(new THREE.SphereGeometry(r1, 10, 6), horn);
      joint.position.copy(b);
      g.add(joint);
    }
  }
  return { group: g, eyes };
}

const BEAM_COLORS = [
  [0xff2a1a, 0xffa020],
  [0xb030ff, 0xff2a8a],
  [0x2a6aff, 0xffffff],
  [0xff7a10, 0xff2a1a],
  [0x30ff80, 0x2a6aff],
];

interface Par {
  beam: Beam;
  glow: THREE.Sprite;
  at: THREE.Vector3;
  aim: THREE.Vector3;
  i: number;
}

class Arena extends Stage {
  private readonly glows = new Glows();
  private readonly pars: Par[] = [];
  private readonly eyes: THREE.Vector3[];
  private readonly eyeLight = new THREE.PointLight(0xff7a20, 30, 0, 2);
  private readonly eyeGlows: THREE.Sprite[] = [];
  private readonly flames = new Flames(32);
  private readonly washes: THREE.PointLight[] = [];
  private readonly key = new THREE.SpotLight(0xffe8d0, 600, 0, 0.6, 0.6, 2);
  private readonly skullLights: THREE.PointLight[] = [];
  private readonly smoke: THREE.Sprite[] = [];
  private readonly foot: THREE.Sprite[] = [];
  private pyroAt = -1e9;

  constructor() {
    super();
    const s = this.scene;
    s.background = new THREE.Color(0x020104);
    s.fog = new THREE.FogExp2(0x08040c, 0.018);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(20, 1.6, 10), faced(lambert(0x0c0c10), lambert(deckTexture([5, 3])), 2));
    deck.position.set(0, -0.8, -2.5);
    s.add(deck);
    const lip = lambert(paintTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#0a0a0c';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#2a2a30';
      for (let x = 0; x < w; x += 8) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 8, h);
        g.stroke();
      }
    }, [8, 1]));
    const front = new THREE.Mesh(new THREE.PlaneGeometry(20, 1.6), lip);
    front.position.set(0, -0.8, 2.51);
    s.add(front);
    s.add(box(3.8, 0.6, 2.8, lambert(0x16161a), 0, 0.3, -2.7));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), lambert(0x0a0808));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.6, 20);
    s.add(floor);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), lambert(curtainTexture('#050406', '#141218')));
    curtain.position.set(0, 12, -13);
    s.add(curtain);

    const skull = hornedSkull();
    skull.group.position.set(0, 7.4, -9.2);
    skull.group.scale.setScalar(1.7);
    s.add(skull.group);
    this.eyes = skull.eyes.map((e) => e.clone().multiplyScalar(1.7).add(skull.group.position));
    this.eyeLight.position.set(0, 7.2, -4.8);
    s.add(this.eyeLight);
    s.add(this.glows.group, this.flames.mesh);
    for (const e of this.eyes) this.eyeGlows.push(this.glows.add(0xff6a10, e.x, e.y, e.z + 0.3, 3.6));

    // Speaker walls either side.
    const tolex = lambert(0x101012);
    const cloth = lambert(paintTexture(256, 192, (g, w, h) => grille(g, w, h, '#18181a', 'BOOF')));
    for (const side of [-1, 1])
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 2; c++) {
          const cab = cabinet(1.4, 1.05, 0.8, cloth, tolex);
          cab.position.set(side * (8.0 + c * 1.42), 0.53 + r * 1.06, -1.5 + c * 0.1);
          cab.rotation.y = -side * 0.12;
          s.add(cab);
        }

    // The truss and its lights.
    const metal = new THREE.MeshPhongMaterial({ color: 0x8a8a92, shininess: 60 });
    const TY = 11.2;
    s.add(box(19, 0.42, 0.42, metal, 0, TY, 1.6), box(19, 0.42, 0.42, metal, 0, TY, -5), box(0.42, 0.42, 6.6, metal, -9.3, TY, -1.7), box(0.42, 0.42, 6.6, metal, 9.3, TY, -1.7));
    for (const side of [-1, 1]) s.add(box(0.42, TY + 1.6, 0.42, metal, side * 9.3, TY / 2 - 0.8, 1.6), box(0.42, TY + 1.6, 0.42, metal, side * 9.3, TY / 2 - 0.8, -5));
    const can = new THREE.MeshPhongMaterial({ color: 0x18181a, shininess: 40 });
    let i = 0;
    for (const z of [1.6, -5])
      for (let k = 0; k < 7; k++) {
        const x = -7.5 + k * 2.5;
        const at = new THREE.Vector3(x, TY - 0.5, z);
        const c = cyl(0.17, 0.2, 0.42, can, 10);
        c.position.copy(at);
        s.add(c);
        const beam = new Beam(12, 1.4, 0xffffff);
        beam.mesh.position.copy(at);
        s.add(beam.mesh);
        this.pars.push({ beam, glow: this.glows.add(0xffffff, x, TY - 0.72, z, 0.9), at, aim: new THREE.Vector3(), i: i++ });
      }
    for (let k = 0; k < 14; k++) this.foot.push(this.glows.add(0xffa040, -9 + k * (18 / 13), 0.08, 2.45, 0.45));
    const smokeTex = smokeTexture();
    for (let k = 0; k < 7; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a5a7a, transparent: true, opacity: 0.12, depthWrite: false }));
      sp.position.set(-9 + k * 3, 0.5 + hash(k) * 0.5, -4.6 + hash(k + 9) * 1.2);
      sp.scale.setScalar(3.5 + hash(k + 3) * 1.5);
      s.add(sp);
      this.smoke.push(sp);
    }

    // Lights.
    s.add(new THREE.HemisphereLight(0x8a6ab8, 0x1a0a0a, 1.6));
    const crowdLight = new THREE.PointLight(0xffb070, 70, 0, 2);
    crowdLight.position.set(0, 6, 8);
    s.add(crowdLight);
    this.key.position.set(0, 10, 9);
    this.key.target.position.set(0, 1, -0.5);
    s.add(this.key, this.key.target);
    for (const side of [-1, 1]) {
      const l = new THREE.PointLight(0xff2010, 90, 0, 2);
      l.position.set(side * 5.5, 4.5, -5.6);
      s.add(l);
      this.skullLights.push(l);
      const w = new THREE.PointLight(0xffffff, 60, 0, 2);
      w.position.set(side * 7, 5, 1.5);
      s.add(w);
      this.washes.push(w);
    }

    this.crowds.push(
      new Crowd({ count: 420, x: [-13, 13], z: [3.4, 15], look: new THREE.Vector3(0, 1, 0), colors: [0x1a1a22, 0x2a2a3a, 0x3a1a1a, 0x202838, 0x383028, 0x4a4a4a, 0x5a1a1a], shade: 1, seed: 3, rake: () => -1.6 }),
    );
    for (const c of this.crowds) s.add(c.group);

    const spots: Record<'guitar' | 'bass' | 'singer' | 'drums', Spot> = {
      guitar: [-3.3, 0, 0.5, 0.18],
      bass: [3.4, 0, 0.2, -0.18],
      singer: [0, 0, 1.3, 0],
      drums: [0, 0.6, -2.7, 0],
    };
    this.band(
      {
        guitar: { skin: SKIN.pale, shirt: 0x141414, print: 'skull', pants: 0x0e0e10, boots: 0x0a0a0a, hair: 0x0c0c0c, style: 'long' },
        bass: { skin: SKIN.tan, shirt: 0x202020, vest: 0x3a2a1a, bare: true, print: 'none', pants: 0x1a1a1e, hair: 0x1a1a1a, style: 'shaved', beard: true },
        singer: { skin: SKIN.light, shirt: 0x1a1a1a, vest: 0x6a1010, bare: true, print: 'bolt', pants: 0x101012, hair: 0xe8d8a0, style: 'long' },
        drums: { skin: SKIN.dark, shirt: 0x1a1a1a, bare: true, print: 'none', pants: 0x202024, hair: 0x101010, style: 'spiky', glasses: true },
        guitarShape: 'vee',
        guitarColor: 0xe8e8ea,
        bassColor: 0x101012,
        shell: 0x101014,
        logo: 'BOOF',
      },
      spots,
    );
    this.director = new Director(
      [
        dolly([-2.6, 1.1, 13], [2.6, 1.3, 13], [0, 2.7, -2], [0, 2.7, -2], 48),
        framing(spots.guitar, -0.46, 0.2, 3.0, 1.5, 42, 0.4),
        framing(spots.bass, 0.46, 0.2, 3.0, 1.5, 42, -0.4),
        framing(spots.singer, 0.42, 0.24, 2.6, 1.7, 40, -0.12),
        framing(spots.drums, -0.4, 0.1, 3.4, 2.1, 46, 0.4, 0.3, 1.0),
        dolly([10, 6.5, 9.5], [-10, 6.5, 9.5], [0, 2.2, -2], [0, 2.2, -2], 55),
        dolly([4.2, 0.6, 4.4], [-4.2, 0.6, 4.4], [0, 3.4, -3], [0, 3.4, -3], 62),
      ],
      dolly([0, 1.0, 8.5], [0, 2.3, 5.8], [0, 4.0, -5], [0, 3.2, -3], 56),
    );
  }

  protected animate(f: VenueFrame, big: boolean): void {
    const bar = Math.floor(f.barStart / Math.max(1, f.beatsPerBar) + 0.5);
    const scheme = BEAM_COLORS[Math.floor(bar / 2) % BEAM_COLORS.length];
    const power = f.power > 0.5;
    const ca = new THREE.Color(power ? 0x3a8aff : scheme[0]);
    const cb = new THREE.Color(power ? 0xa0e0ff : scheme[1]);
    const chase = Math.floor(f.beat * 2);
    for (const p of this.pars) {
      const sweep = Math.sin(f.beat * Math.PI * 0.25 + p.i * 0.7) * (1.5 + f.energy * 3);
      p.aim.set(p.at.x * 0.55 + sweep, 0, p.at.z > 0 ? 0.5 + Math.cos(f.beat * 0.5 + p.i) * 1.5 : -1.5);
      const dir = p.aim.clone().sub(p.at);
      const len = dir.length();
      p.beam.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      p.beam.mesh.scale.set(1, len, 1);
      const lit = f.energy > 0.55 ? ((p.i + chase) % 3 === 0 ? 1 : 0.35) : 0.6;
      const v = f.stage * lit * (0.45 + f.kick * 0.5 + f.power * 0.4);
      const c = p.i % 2 ? ca : cb;
      p.beam.mat.uniforms.uIntensity.value = v * 0.45;
      (p.beam.mat.uniforms.uColor.value as THREE.Color).copy(c);
      (p.glow.material as THREE.SpriteMaterial).color.copy(c).multiplyScalar(0.5 + v * 2);
    }
    for (const [k, w] of this.washes.entries()) {
      w.color.copy(k ? ca : cb);
      w.intensity = 130 * f.stage * (0.45 + f.snare * 0.8 + f.power * 0.5);
    }
    for (const l of this.skullLights) {
      l.color.copy(power ? new THREE.Color(0x2a6aff) : new THREE.Color(0xff2010));
      l.intensity = 90 * f.stage * (0.5 + f.kick * 1.2);
    }
    this.key.intensity = 600 * (0.7 + 0.3 * f.stage) * (1 + f.power * 0.3);
    // The skull's eyes burn (blue in star power), flare on the kick.
    const eyeTint: [number, number, number] = power ? [0.35, 0.7, 1.6] : [1.6, 0.55, 0.12];
    this.eyeLight.color.setRGB(eyeTint[0] / 1.6, eyeTint[1] / 1.6, eyeTint[2] / 1.6);
    this.eyeLight.intensity = 26 * (0.7 + f.kick * 0.8 + f.energy * 0.4);
    for (const g of this.eyeGlows) (g.material as THREE.SpriteMaterial).color.setRGB(eyeTint[0] * (0.6 + f.kick), eyeTint[1] * (0.6 + f.kick), eyeTint[2] * (0.6 + f.kick));
    const flames: Array<{ x: number; y: number; z: number; size: number; tint?: [number, number, number]; seed: number }> = this.eyes.map((e, k) => ({ x: e.x, y: e.y - 0.15, z: e.z + 0.25, size: 1.5 + f.kick * 0.5, tint: eyeTint, seed: k * 13 + Math.floor(f.t * 6) }));
    // Pyro along the front of the stage when star power or a drop goes off.
    if (big) this.pyroAt = f.t;
    const age = f.t - this.pyroAt;
    if (age < 1.3) {
      const env = Math.min(1, age / 0.12) * clamp((1.3 - age) / 0.5, 0, 1);
      for (const x of [-7.5, -3.8, 3.8, 7.5])
        for (let k = 0; k < 4; k++) flames.push({ x, y: 0.4 + k * 0.85 * env, z: 2.2, size: (1.9 - k * 0.3) * env, tint: power ? [0.4, 0.8, 1.6] : [1.7, 0.6, 0.15], seed: x * 7 + k * 3 + Math.floor(f.t * 9) });
    }
    this.flames.set(f.t, flames);
    for (const [k, g] of this.foot.entries()) (g.material as THREE.SpriteMaterial).color.setRGB(1.2 * (0.5 + 0.5 * ((k + chase) % 2)), 0.6, 0.2).multiplyScalar(f.stage);
    for (const [k, sp] of this.smoke.entries()) {
      sp.position.x = -9 + ((k * 2.25 + f.t * 0.25) % 20);
      (sp.material as THREE.SpriteMaterial).color.copy(ca).lerp(cb, 0.5).multiplyScalar(0.25 + f.energy * 0.15);
    }
  }
}

// ---------------------------------------------------------------------------
// The neon club ('80s)
// ---------------------------------------------------------------------------

interface Sign {
  mat: THREE.MeshBasicMaterial;
  color: THREE.Color;
  flicker: number;
}

class NeonClub extends Stage {
  private readonly signs: Sign[] = [];
  private readonly ball: THREE.Mesh;
  private readonly spots: THREE.Points;
  private readonly spotDirs: THREE.Vector3[] = [];
  private readonly lasers: Array<{ mesh: THREE.Mesh; at: THREE.Vector3; i: number }> = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly strip: THREE.MeshBasicMaterial;
  private readonly key = new THREE.SpotLight(0xffd8f0, 120, 0, 0.5, 0.7, 2);

  constructor() {
    super();
    const s = this.scene;
    s.background = new THREE.Color(0x030206);
    const FL = -0.7;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 13), lambert(checkerTexture('#e8e4dc', '#141414', [10, 8])));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FL, 3);
    s.add(floor);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 5.4), faced(lambert(0x0c0a10), lambert(deckTexture([4, 2])), 2));
    deck.position.set(0, -0.35, -0.95);
    s.add(deck);
    this.strip = hot(3, 0.4, 2.2);
    s.add(box(11, 0.05, 0.05, this.strip, 0, -0.02, 1.76));
    s.add(box(3.2, 0.4, 2.2, lambert(0x1a1420), 0, 0.2, -2.3));
    const bricks = lambert(brickTexture([128, 52, 38], [5, 2]));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), bricks);
    back.position.set(0, 2.3, -3.65);
    s.add(back);
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(13, 6), lambert(brickTexture([118, 48, 36], [4, 2])));
      w.position.set(side * 8, 2.3, 2.85);
      w.rotation.y = (-side * Math.PI) / 2;
      s.add(w);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 13), lambert(0x0a080c));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 5.3, 2.85);
    s.add(ceil);

    // Neon on the walls.
    const sign = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry: number, color: THREE.Color): void => {
      const m = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      p.position.set(x, y, z);
      p.rotation.y = ry;
      p.renderOrder = 5;
      s.add(p);
      this.signs.push({ mat: m, color: color.clone(), flicker: this.signs.length * 1.7 });
    };
    sign(
      neonTexture(256, 352, '#ff3aa8', (g) => {
        g.beginPath();
        g.moveTo(160, 24);
        g.lineTo(60, 190);
        g.lineTo(130, 190);
        g.lineTo(90, 330);
        g.lineTo(206, 140);
        g.lineTo(138, 140);
        g.lineTo(190, 24);
        g.closePath();
        g.stroke();
      }),
      1.5,
      2.05,
      -4.6,
      2.6,
      -3.6,
      0,
      new THREE.Color(2.2, 2.2, 2.2),
    );
    sign(
      neonTexture(320, 320, '#2af0e0', (g) => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 ? 54 : 132;
          g.lineTo(160 + Math.cos(a) * r, 170 + Math.sin(a) * r);
        }
        g.closePath();
        g.stroke();
      }),
      1.9,
      1.9,
      4.6,
      2.7,
      -3.6,
      0,
      new THREE.Color(2.2, 2.2, 2.2),
    );
    sign(
      neonTexture(768, 288, '#ffb020', (g) => {
        g.font = `150px ${FONT_SECTION}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.strokeText('Loud', 384, 150);
      }),
      4.2,
      1.6,
      0,
      3.75,
      -3.58,
      0,
      new THREE.Color(2.4, 2.4, 2.4),
    );
    sign(
      neonTexture(512, 192, '#ff2a2a', (g) => {
        g.font = `120px ${FONT_HUD}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.strokeText('LIVE', 256, 100);
      }),
      2.4,
      0.9,
      -7.96,
      3.2,
      0.5,
      Math.PI / 2,
      new THREE.Color(2.2, 2.2, 2.2),
    );

    // The mirror ball and the spots it throws round the room.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshPhongMaterial({ color: 0x9a9aa4, specular: 0xffffff, shininess: 120, flatShading: true, emissive: 0x141418 }));
    this.ball.position.set(0, 4.6, 2.6);
    s.add(this.ball);
    s.add(box(0.02, 0.7, 0.02, lambert(0x222222), 0, 4.95 + 0.0, 2.6));
    const N = 90;
    const pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const y = -0.15 - hash(k * 3) * 0.75;
      const a = hash(k * 7) * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      this.spotDirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    this.spots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)), new THREE.PointsMaterial({ map: glowTexture(), color: new THREE.Color(1.6, 1.6, 1.8), size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.spots.frustumCulled = false;
    this.spots.renderOrder = 6;
    s.add(this.spots);

    // Lasers from the back corners.
    for (const [k, x] of [-7.4, -6.6, 6.6, 7.4].entries()) {
      const geo = new THREE.BoxGeometry(0.018, 0.018, 1).translate(0, 0, 0.5);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const at = new THREE.Vector3(x, 4.8, -3.4);
      m.position.copy(at);
      m.renderOrder = 7;
      s.add(m);
      this.lasers.push({ mesh: m, at, i: k });
    }

    s.add(new THREE.HemisphereLight(0x8a4ab0, 0x1a0a20, 1.0));
    for (const [x, c] of [
      [-5.5, 0xff2a9a],
      [5.5, 0x2ad0ff],
    ] as const) {
      const l = new THREE.PointLight(c, 30, 0, 2);
      l.position.set(x, 3.6, 0.8);
      s.add(l);
      this.lights.push(l);
    }
    const wash = new THREE.PointLight(0xffa0e0, 14, 0, 2);
    wash.position.set(0, 3.2, 5);
    s.add(wash);
    this.lights.push(wash);
    this.key.position.set(0, 5.2, 5.5);
    this.key.target.position.set(0, 1, 0.5);
    s.add(this.key, this.key.target);

    this.crowds.push(
      new Crowd({ count: 170, x: [-7.2, 7.2], z: [2.6, 9.4], look: new THREE.Vector3(0, 1, -0.5), colors: [0xff3aa0, 0x2ad0d0, 0xf0e030, 0x8a3ad0, 0xf0f0f0, 0x1a1a1a, 0x3a6aff], shade: 0.8, seed: 5, rake: () => FL }),
    );
    for (const c of this.crowds) s.add(c.group);

    const spots: Record<'guitar' | 'bass' | 'singer' | 'drums', Spot> = {
      guitar: [-2.3, 0, 0.3, 0.2],
      bass: [2.4, 0, 0.0, -0.2],
      singer: [0, 0, 0.85, 0],
      drums: [0, 0.4, -2.35, 0],
    };
    this.band(
      {
        guitar: { skin: SKIN.light, shirt: 0xff3aa0, print: 'stripes', pants: 0xeeeeee, boots: 0xf0f0f0, hair: 0xf0e070, style: 'afro' },
        bass: { skin: SKIN.brown, shirt: 0x20d0d0, print: 'bolt', pants: 0x202060, hair: 0x101010, style: 'spiky', glasses: true },
        singer: { skin: SKIN.pale, shirt: 0x8a2ad0, vest: 0x101010, print: 'star', pants: 0x101010, hair: 0x2a1408, style: 'long' },
        drums: { skin: SKIN.tan, shirt: 0xf0f020, bare: true, print: 'none', pants: 0x1a1a1a, hair: 0xe03030, style: 'bandana', band: 0xff40a0 },
        guitarShape: 'star',
        guitarColor: 0xff2a8a,
        bassColor: 0x30e0e0,
        bassGuard: 0x101010,
        shell: 0x6020c0,
        logo: 'BOOF',
      },
      spots,
    );
    this.director = new Director(
      [
        dolly([-1.6, 1.4, 9.5], [1.6, 1.5, 9.5], [0, 1.6, -1.5], [0, 1.6, -1.5], 52),
        framing(spots.guitar, -0.46, 0.2, 2.7, 1.5, 42, 0.4),
        framing(spots.bass, 0.46, 0.2, 2.7, 1.5, 42, -0.4),
        framing(spots.singer, 0.42, 0.24, 2.3, 1.65, 40, -0.15),
        framing(spots.drums, -0.4, 0.1, 3.0, 2.0, 46, 0.4, 0.3, 1.0),
        dolly([6.5, 3.6, 7.5], [-6.5, 3.6, 7.5], [0, 1.4, -1.5], [0, 1.4, -1.5], 56),
        dolly([3.4, 0.45, 2.3], [-3.4, 0.45, 2.3], [0, 2.3, -2.5], [0, 2.3, -2.5], 62),
      ],
      dolly([0, 0.6, 6.5], [0, 1.6, 4.4], [0, 3.0, -3], [0, 2.2, -2], 58),
    );
  }

  protected animate(f: VenueFrame): void {
    const power = f.power > 0.5;
    for (const sg of this.signs) {
      // A buzz now and then, brighter on the beat.
      const buzz = hash(Math.floor(f.t * 14 + sg.flicker * 100)) > 0.985 ? 0.25 : 1;
      const v = (0.75 + 0.35 * bounce(f.beat) * f.energy + f.power * 0.3) * buzz * (0.6 + 0.4 * f.stage);
      sg.mat.color.copy(sg.color).multiplyScalar(v);
      if (power) sg.mat.color.lerp(new THREE.Color(0.8, 1.6, 2.6), 0.5);
    }
    this.strip.color.setRGB(3 * (0.6 + f.kick * 0.6), 0.4, 2.2 * (0.6 + f.kick * 0.6));
    // The ball turns; its spots sweep the walls.
    const a = f.t * 0.6;
    this.ball.rotation.y = a;
    const p = (this.spots.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const c = this.ball.position;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    this.spotDirs.forEach((d, k) => {
      const dx = d.x * ca - d.z * sa;
      const dz = d.x * sa + d.z * ca;
      // Where the ray hits the room (walls x ±8, floor −0.7, back −3.6, front 9.3).
      let t = Infinity;
      if (dx !== 0) t = Math.min(t, ((dx > 0 ? 7.95 : -7.95) - c.x) / dx);
      if (d.y < 0) t = Math.min(t, (-0.68 - c.y) / d.y);
      if (dz < 0) t = Math.min(t, (-3.58 - c.z) / dz);
      else t = Math.min(t, (9.3 - c.z) / dz);
      p[k * 3] = c.x + dx * t;
      p[k * 3 + 1] = c.y + d.y * t;
      p[k * 3 + 2] = c.z + dz * t;
    });
    this.spots.geometry.getAttribute('position').needsUpdate = true;
    (this.spots.material as THREE.PointsMaterial).opacity = clamp(0.35 + f.energy * 0.6, 0, 1);
    // Lasers on the big parts.
    const on = clamp((f.energy - 0.55) * 4 + f.power, 0, 1) * f.stage;
    for (const l of this.lasers) {
      const sweep = Math.sin(f.beat * Math.PI * 0.5 + l.i * 1.3);
      const target = new THREE.Vector3(sweep * 6, 0.5 + Math.cos(f.beat * 0.75 + l.i) * 0.8, 9);
      l.mesh.lookAt(target);
      l.mesh.scale.z = l.at.distanceTo(target);
      (l.mesh.material as THREE.MeshBasicMaterial).color.setRGB(power ? 0.3 : 0.2, power ? 0.8 : 1.6, power ? 1.8 : 0.3).multiplyScalar(on * (0.6 + f.kick * 0.5));
      l.mesh.visible = on > 0.02;
    }
    this.lights[0].intensity = 30 * f.stage * (0.5 + f.kick);
    this.lights[1].intensity = 30 * f.stage * (0.5 + f.snare);
    this.key.intensity = 110 * (0.7 + 0.3 * f.stage);
  }
}

// ---------------------------------------------------------------------------
// The stadium at night
// ---------------------------------------------------------------------------

const LED_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LED_FRAG = /* glsl */ `
precision highp float;
uniform float uBands[32];
uniform float uTime;
uniform float uBeat;
uniform float uKick;
uniform float uPower;
uniform float uLevel;
uniform float uMode;
uniform vec2 uRes;
uniform vec3 uA;
uniform vec3 uB;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 cell = floor(vUv * uRes);
  vec2 q = fract(vUv * uRes) - 0.5;
  float dotm = smoothstep(0.5, 0.3, max(abs(q.x), abs(q.y)));
  vec2 c = (cell + 0.5) / uRes;
  vec3 col;
  if (uMode < 0.5) {
    // The spectrum, mirrored from the middle, a ring on each beat.
    float x = abs(c.x - 0.5) * 2.0;
    int i = int(clamp(x * 31.0, 0.0, 31.0));
    float v = uBands[i];
    float bar = step(c.y, v * 0.85 + 0.04);
    col = mix(uA, uB, c.y) * bar * (0.7 + 0.5 * uKick);
    float ph = fract(uBeat);
    float r = length((c - 0.5) * vec2(uRes.x / uRes.y, 1.0));
    col += uB * smoothstep(0.05, 0.0, abs(r - ph * 1.4)) * (1.0 - ph) * 0.9;
  } else {
    // Bands of colour rolling up on the beat.
    float w = sin((c.y * 3.0 - uBeat * 0.5) * 6.2831 + sin(c.x * 6.0 + uTime) * 0.6);
    col = mix(uA, uB, 0.5 + 0.5 * w) * (0.5 + 0.5 * uKick);
  }
  col = mix(col, vec3(0.3, 0.7, 1.6) * (0.6 + 0.4 * sin(c.x * 24.0 + uTime * 4.0)), uPower * 0.6);
  fragColor = vec4(col * dotm * uLevel, 1.0);
}
`;

function ledMaterial(res: [number, number], mode: number): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: LED_VERT,
    fragmentShader: LED_FRAG,
    uniforms: {
      uBands: { value: new Float32Array(32) },
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uKick: { value: 0 },
      uPower: { value: 0 },
      uLevel: { value: 2 },
      uMode: { value: mode },
      uRes: { value: new THREE.Vector2(res[0], res[1]) },
      uA: { value: new THREE.Color(1, 0.1, 0.3) },
      uB: { value: new THREE.Color(1, 0.7, 0.1) },
    },
  });
}

/** Fireworks: bursts of sparks that rise, spread, fall and fade. */
class Fireworks {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly base: Float32Array;
  private next = 0;
  constructor(readonly max = 1200) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), size: 1.8, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
  }
  burst(x: number, y: number, z: number, color: THREE.Color, seed: number, n = 160): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const u = hash(seed * 131 + k * 3) * 2 - 1;
      const a = hash(seed * 71 + k * 7) * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 9 + hash(seed + k) * 4;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp], i * 3);
      this.base.set([color.r, color.g, color.b], i * 3);
      this.life[i] = 1.6 + hash(k + seed * 3) * 0.6;
    }
  }
  update(dt: number): void {
    const d = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - 6 * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const v = Math.pow(clamp(this.life[i] / 1.8, 0, 1), 1.5) * 3;
      this.col[k] = this.base[k] * v;
      this.col[k + 1] = this.base[k + 1] * v;
      this.col[k + 2] = this.base[k + 2] * v;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }
}

class Stadium extends Stage {
  private readonly led = ledMaterial([200, 84], 0);
  private readonly sideLed = ledMaterial([64, 38], 1);
  private readonly glows = new Glows();
  private readonly searches: Array<{ beam: Beam; at: THREE.Vector3; i: number }> = [];
  private readonly lamps: THREE.Sprite[] = [];
  private readonly fireworks = new Fireworks();
  private readonly screenLight = new THREE.PointLight(0xff4040, 40, 0, 2);
  private readonly washes: THREE.PointLight[] = [];
  private readonly key = new THREE.SpotLight(0xfff0e0, 3200, 0, 0.42, 0.6, 2);
  private lastBar = -1;

  constructor() {
    super();
    const s = this.scene;
    s.background = new THREE.Color(0x000002);
    s.fog = new THREE.Fog(0x05040c, 60, 420);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
    s.add(sky);
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      lambert(
        paintTexture(
          256,
          256,
          (g, w, h) => {
            for (let i = 0; i < 8; i++) {
              g.fillStyle = i % 2 ? '#0e1a0c' : '#122010';
              g.fillRect(0, (i * h) / 8, w, h / 8);
            }
          },
          [8, 8],
        ),
      ),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set(0, -2.4, 40);
    s.add(field);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(38, 2.4, 13), faced(lambert(0x0a0a0e), lambert(deckTexture([8, 3])), 2));
    deck.position.set(0, -1.2, -3.5);
    s.add(deck);
    s.add(box(6.5, 1.0, 3.8, lambert(0x1a1a20), 0, 0.5, -3.3));
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, 11), this.led);
    wall.position.set(0, 6.9, -8.6);
    s.add(wall, box(27, 11.8, 0.4, lambert(0x0a0a0c), 0, 6.9, -8.85));
    for (const side of [-1, 1]) {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.8), this.sideLed);
      sc.position.set(side * 18, 8.4, -6);
      sc.rotation.y = -side * 0.35;
      s.add(sc);
    }

    // Speaker towers, line arrays, the roof arches and their lamps.
    const tolex = lambert(0x0c0c0e);
    const cloth = lambert(paintTexture(256, 512, (g, w, h) => grille(g, w, h, '#141416')));
    for (const side of [-1, 1]) {
      const t = cabinet(3.6, 10, 2.6, cloth, tolex);
      t.position.set(side * 14.8, 5, -3.6);
      s.add(t);
      for (let k = 0; k < 8; k++) {
        const c = cabinet(1.6, 0.48, 1.0, cloth, tolex);
        c.position.set(side * 11.6, 13 - k * 0.5, 1.2 + k * 0.06);
        c.rotation.x = k * 0.05;
        s.add(c);
      }
    }
    const metal = new THREE.MeshPhongMaterial({ color: 0x8a8a96, shininess: 50 });
    for (const z of [-8, 1.8]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 40; k++) pts.push(new THREE.Vector3(-Math.cos((Math.PI * k) / 40) * 20, Math.sin((Math.PI * k) / 40) * 19, z));
      s.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.42, 8, false), metal));
    }
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI * (k / 16);
      const x = -Math.cos(a) * 20;
      const y = Math.sin(a) * 19;
      s.add(box(0.3, 0.3, 9.8, metal, x, y, -3.1));
      if (k % 2 === 0) this.lamps.push(this.glows.add(0xffffff, x, y - 0.5, 1.8, 2.2));
    }
    s.add(this.glows.group);
    for (let k = 0; k < 6; k++) {
      const at = new THREE.Vector3(-15 + k * 6, 0.3, 2.6);
      const b = new Beam(140, 7, 0xbfd8ff);
      b.mesh.position.copy(at);
      s.add(b.mesh);
      this.searches.push({ beam: b, at, i: k });
    }

    // The stands and the floodlight towers.
    const stands = new THREE.MeshLambertMaterial({ map: standsTexture(), emissive: 0x0a0a12 });
    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 120), stands);
        m.position.set(side * (52 + k * 12), -2.4 + 2 + k * 6, 40);
        s.add(m);
      }
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(150, 4, 14), stands);
      m.position.set(0, -2.4 + 2 + k * 6, 110 + k * 12);
      s.add(m);
    }
    for (const [x, z] of [
      [-70, 100],
      [70, 100],
      [-70, -10],
      [70, -10],
    ]) {
      const pole = cyl(0.5, 0.8, 50, metal, 8);
      pole.position.set(x, 23, z);
      s.add(pole);
      for (let k = 0; k < 4; k++) this.lamps.push(this.glows.add(0xfff4e0, x + (k - 1.5) * 2, 49, z, 7));
    }
    s.add(this.fireworks.points);

    // Lights.
    s.add(new THREE.HemisphereLight(0x5a6ab0, 0x10121a, 1.4));
    const crowdLight = new THREE.PointLight(0xffc890, 700, 0, 2);
    crowdLight.position.set(0, 16, 22);
    s.add(crowdLight);
    this.key.position.set(0, 22, 26);
    this.key.target.position.set(0, 1.2, 0);
    s.add(this.key, this.key.target);
    this.screenLight.position.set(0, 5, -6.5);
    s.add(this.screenLight);
    for (const side of [-1, 1]) {
      const w = new THREE.PointLight(0xffffff, 120, 0, 2);
      w.position.set(side * 9, 9, 3);
      s.add(w);
      this.washes.push(w);
    }

    this.crowds.push(
      new Crowd({ count: 950, x: [-30, 30], z: [4.5, 42], look: new THREE.Vector3(0, 2, -2), colors: [0x2a2a36, 0x3a2a2a, 0x26323a, 0x3a3a30, 0x4a4050, 0x6a2020, 0x204a6a, 0xd0d0d0], shade: 1.25, seed: 9, lighters: true, rake: () => -2.4 }),
    );
    for (const c of this.crowds) s.add(c.group);

    const spots: Record<'guitar' | 'bass' | 'singer' | 'drums', Spot> = {
      guitar: [-5, 0, 0.8, 0.15],
      bass: [5, 0, 0.5, -0.15],
      singer: [0, 0, 2.0, 0],
      drums: [0, 1.0, -3.3, 0],
    };
    this.band(
      {
        guitar: { skin: SKIN.tan, shirt: 0xe8e8e8, vest: 0x1a1a1a, print: 'none', pants: 0x26324a, hair: 0x2a180c, style: 'long', glasses: true },
        bass: { skin: SKIN.light, shirt: 0x1a2a6a, print: 'star', pants: 0x161616, hair: 0x8a4a1a, style: 'bob', beard: true },
        singer: { skin: SKIN.dark, shirt: 0xb81818, vest: 0x101010, print: 'none', pants: 0x101010, hair: 0x101010, style: 'afro' },
        drums: { skin: SKIN.pale, shirt: 0x101010, print: 'skull', pants: 0x2a2a2a, hair: 0xd0a040, style: 'spiky' },
        guitarShape: 'double',
        guitarColor: 0xd8a020,
        guard: 0x101010,
        bassColor: 0xb01818,
        bassGuard: 0x101010,
        shell: 0xc0c0cc,
        logo: 'BOOF',
      },
      spots,
    );
    this.director = new Director(
      [
        dolly([-12, 13, 46], [12, 13, 46], [0, 4, -2], [0, 4, -2], 40),
        dolly([0, 1.4, 19], [0, 1.8, 13], [0, 3.6, -3], [0, 3.6, -3], 48),
        framing(spots.guitar, -0.46, 0.2, 3.4, 1.5, 42, 0.4),
        framing(spots.bass, 0.46, 0.2, 3.4, 1.5, 42, -0.4),
        framing(spots.singer, 0.42, 0.24, 2.8, 1.7, 40, -0.12),
        framing(spots.drums, -0.4, 0.1, 4.0, 2.3, 46, 0.4, 0.3, 1.0),
        dolly([22, 4.5, 9], [14, 4.5, 15], [0, 3, -2], [0, 3, -2], 55),
      ],
      dolly([0, 0.5, 8.5], [0, 3.2, 6.5], [0, 7, -6], [0, 4.2, -4], 62),
    );
  }

  protected animate(f: VenueFrame, big: boolean): void {
    const bar = Math.floor(f.barStart / Math.max(1, f.beatsPerBar) + 0.5);
    const scheme = BEAM_COLORS[Math.floor(bar / 4) % BEAM_COLORS.length];
    const ca = new THREE.Color(scheme[0]);
    const cb = new THREE.Color(scheme[1]);
    for (const m of [this.led, this.sideLed]) {
      const u = m.uniforms;
      (u.uBands.value as Float32Array).set(f.bands.subarray(0, 32));
      u.uTime.value = f.t;
      u.uBeat.value = f.beat;
      u.uKick.value = f.kick;
      u.uPower.value = f.power;
      u.uLevel.value = 1.1 * (0.6 + 0.4 * f.stage);
      (u.uA.value as THREE.Color).copy(ca);
      (u.uB.value as THREE.Color).copy(cb);
    }
    this.screenLight.color.copy(ca).lerp(cb, 0.5);
    this.screenLight.intensity = 60 * (0.4 + f.energy * 0.6 + f.kick * 0.4);
    for (const [k, w] of this.washes.entries()) {
      w.color.copy(k ? ca : cb);
      w.intensity = 420 * f.stage * (0.45 + (k ? f.snare : f.kick) * 0.9 + f.power * 0.4);
    }
    this.key.intensity = 3200 * (0.7 + 0.3 * f.stage);
    for (const [k, l] of this.lamps.entries()) (l.material as THREE.SpriteMaterial).color.setScalar((k < 9 ? 0.8 + 0.6 * ((k + Math.floor(f.beat)) % 2) * f.energy : 1.2) * f.stage);
    for (const sl of this.searches) {
      const a = f.t * 0.35 + sl.i * 1.1;
      const up = new THREE.Vector3(Math.sin(a) * 0.55, 1, -0.25 + Math.cos(a * 0.8) * 0.35).normalize();
      sl.beam.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), up);
      sl.beam.mat.uniforms.uIntensity.value = 0.22 * f.stage * (0.6 + f.energy * 0.6 + f.power);
      (sl.beam.mat.uniforms.uColor.value as THREE.Color).copy(f.power > 0.5 ? new THREE.Color(0x6ab0ff) : new THREE.Color(0xd8e4ff));
    }
    // Fireworks on the drops and star power, and on big bars.
    const palette = [0xff3a2a, 0xffd040, 0x40a0ff, 0x60ff80, 0xff50d0, 0xffffff];
    if (big)
      for (let k = 0; k < 4; k++) this.fireworks.burst(-24 + k * 16, 30 + hash(bar * 9 + k) * 12, -25 - hash(bar + k) * 15, new THREE.Color(palette[(bar + k) % palette.length]), bar * 17 + k);
    if (bar !== this.lastBar) {
      this.lastBar = bar;
      if (bar % 4 === 0 && f.energy > 0.72) this.fireworks.burst(-20 + hash(bar) * 40, 32 + hash(bar + 1) * 10, -30, new THREE.Color(palette[bar % palette.length]), bar);
    }
    this.fireworks.update(Math.min(f.dt, 0.05));
  }
}

export function createVenue(kind: string): Venue {
  switch (kind) {
    case 'arena':
      return new Arena();
    case 'neon':
      return new NeonClub();
    case 'stadium':
      return new Stadium();
    default:
      return new Garage();
  }
}
