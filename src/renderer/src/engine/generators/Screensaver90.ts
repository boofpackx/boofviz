import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { hash2 } from '../lostMedia';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

export const SAVER_SCENES = ['maze', 'flyers', 'polylines', 'fractal'] as const;

const MAZE_W = 15;
const GRID = MAZE_W * 2 + 1;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uScene;
uniform sampler2D uMaze;
uniform vec2 uCam;
uniform float uAng, uBob, uReact, uCount, uSmiley, uZoom;
float PX;
vec3 S(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float fillD(float d) { return clamp(0.5 - d / PX, 0.0, 1.0); }

// ---------------------------------------------------------------- 3D maze (grid raycaster)
float wallAt(vec2 c) {
  if (c.x < 0.0 || c.y < 0.0 || c.x >= ${GRID}.0 || c.y >= ${GRID}.0) return 1.0;
  return texture(uMaze, (c + 0.5) / ${GRID}.0).r;
}
vec3 brick(vec2 uv, float shade) {
  vec2 b = uv * vec2(4.0, 8.0);
  b.x += step(1.0, mod(floor(b.y), 2.0)) * 0.5;
  vec2 f = fract(b);
  float mortar = step(f.x, 0.06) + step(f.y, 0.1);
  float n = hash21(floor(b)) * 0.25;
  vec3 c = mix(S(vec3(0.62, 0.22, 0.14)) * (0.85 + n), S(vec3(0.7, 0.68, 0.62)), clamp(mortar, 0.0, 1.0));
  return c * shade;
}
vec3 sceneMaze(vec2 uv) {
  float fov = 1.15;
  vec2 dir = vec2(cos(uAng), sin(uAng));
  vec2 plane = vec2(-dir.y, dir.x) * fov * 0.5 * (uRes.x / uRes.y) * 0.75;
  float camX = uv.x * 2.0 - 1.0;
  vec2 rd = dir + plane * camX;
  vec2 pos = uCam;
  vec2 cell = floor(pos);
  vec2 delta = abs(1.0 / max(abs(rd), vec2(1e-5)));
  vec2 stepv = sign(rd);
  vec2 side = (stepv * (cell - pos) + stepv * 0.5 + 0.5) * delta;
  float hitSide = 0.0;
  float dist = 30.0;
  for (int i = 0; i < 64; i++) {
    if (side.x < side.y) { side.x += delta.x; cell.x += stepv.x; hitSide = 0.0; }
    else { side.y += delta.y; cell.y += stepv.y; hitSide = 1.0; }
    if (wallAt(cell) > 0.5) {
      dist = hitSide < 0.5 ? side.x - delta.x : side.y - delta.y;
      break;
    }
  }
  float h = 1.0 / max(dist, 0.05);
  float horizon = 0.5 + uBob;
  float top = horizon + h * 0.5;
  float bot = horizon - h * 0.5;
  vec3 c;
  if (uv.y > top) {
    float d = 0.5 / max(uv.y - horizon, 1e-3);
    vec2 w = uCam + rd * d;
    c = S(vec3(0.32, 0.36, 0.5)) * (0.75 + 0.25 * step(0.5, fract(w.x) + 0.0) * step(0.5, fract(w.y))) / (1.0 + d * 0.2);
  } else if (uv.y < bot) {
    float d = 0.5 / max(horizon - uv.y, 1e-3);
    vec2 w = uCam + rd * d;
    float chk = mod(floor(w.x * 2.0) + floor(w.y * 2.0), 2.0);
    c = mix(S(vec3(0.25)), S(vec3(0.4)), chk) / (1.0 + d * 0.25);
  } else {
    vec2 hit = pos + rd * dist;
    float wx = hitSide < 0.5 ? hit.y : hit.x;
    float v = (uv.y - bot) / max(top - bot, 1e-4);
    c = brick(vec2(fract(wx), v), hitSide < 0.5 ? 1.0 : 0.72) / (1.0 + dist * 0.12);
  }
  return c * (1.0 + 0.15 * uKick * uReact);
}

// ---------------------------------------------------------------- flying disks
vec3 sceneFlyers(vec2 p) {
  vec3 c = vec3(0.0);
  float asp = uRes.x / uRes.y;
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    if (fi >= uCount) break;
    float depth = 0.55 + 0.45 * hash11(fi * 3.7);
    float speed = 0.07 * depth;
    vec2 start = vec2(hash11(fi * 1.3) * (asp + 0.6), hash11(fi * 2.9) * 1.6);
    vec2 q = vec2(mod(start.x - uTime * speed * 1.6, asp + 0.6) - asp * 0.5 - 0.3, mod(start.y - uTime * speed, 1.6) - 0.8);
    vec2 l = (p - q) / (0.075 * depth);
    // Wings beat with the music: one flap per beat, bigger on kicks.
    float flap = sin(uBeat * 6.28318 + fi) * (0.6 + 0.4 * uKick * uReact);
    for (int s = -1; s <= 1; s += 2) {
      vec2 w = l - vec2(float(s) * 0.55, 0.35);
      w = rot2(float(s) * (0.5 + 0.6 * flap)) * w;
      float wing = length(w * vec2(1.0, 2.6)) - 0.55;
      float feathers = step(0.5, fract(w.x * 6.0));
      vec3 wc = mix(S(vec3(0.92)), S(vec3(0.75)), feathers);
      if (wing < 0.0) c = mix(c, wc * depth, fillD(wing * 0.075 * depth));
    }
    // A floppy disk body: shutter, label, write-protect notch.
    float body = sdBox(l, vec2(0.5));
    if (body < 0.0) {
      vec3 bc = palette(0.2 + 0.6 * hash11(fi * 5.1)) * 0.8;
      if (sdBox(l - vec2(0.05, 0.3), vec2(0.28, 0.2)) < 0.0) bc = S(vec3(0.78, 0.8, 0.85)) * (0.8 + 0.2 * step(0.5, fract(l.x * 10.0)));
      if (sdBox(l - vec2(0.0, -0.22), vec2(0.38, 0.24)) < 0.0) bc = S(vec3(0.95, 0.93, 0.86)) - vec3(0.25) * step(0.85, fract(l.y * 8.0 + 0.5));
      if (sdBox(l - vec2(0.42, 0.42), vec2(0.04)) < 0.0) bc = vec3(0.0);
      c = mix(c, bc * depth, fillD(body * 0.075 * depth));
    }
  }
  return c;
}

// ---------------------------------------------------------------- bouncing lines
vec2 bounceV(float t, float seed) {
  vec2 sp = vec2(0.11 + 0.08 * hash11(seed), 0.09 + 0.07 * hash11(seed + 3.0));
  vec2 u = t * sp + vec2(hash11(seed + 7.0), hash11(seed + 9.0));
  return (1.0 - 4.0 * abs(u - floor(u + 0.5))) * vec2(uRes.x / uRes.y * 0.47, 0.46);
}
vec3 scenePolylines(vec2 p) {
  vec3 c = vec3(0.0);
  for (int poly = 0; poly < 2; poly++) {
    float ps = float(poly) * 17.0;
    vec3 col = palette(fract(0.15 + float(poly) * 0.45 + uTime * 0.02)) * 1.6;
    for (int k = 0; k < 7; k++) {
      float t = uTime * (1.0 + 0.6 * uEnergy * uReact) - float(k) * 0.09;
      vec2 a = bounceV(t, ps + 1.0), b = bounceV(t, ps + 2.0), cc = bounceV(t, ps + 3.0), dd = bounceV(t, ps + 4.0);
      float d = min(min(sdSegment(p, a, b), sdSegment(p, b, cc)), min(sdSegment(p, cc, dd), sdSegment(p, dd, a)));
      float fade = 1.0 - float(k) / 7.0;
      c += col * fade * fillD(d - 0.0012) ;
    }
  }
  return c;
}

// ---------------------------------------------------------------- rave flyer fractal
vec3 sceneFractal(vec2 p) {
  float zoom = 1.25 * uZoom * (1.0 - 0.06 * uKick * uReact);
  vec2 z = p * 2.4 / zoom;
  float a = uTime * 0.05;
  vec2 cst = vec2(-0.75 + 0.12 * cos(a), 0.12 + 0.12 * sin(a * 1.3));
  float it = 0.0;
  for (int i = 0; i < 80; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + cst;
    if (dot(z, z) > 16.0) break;
    it += 1.0;
  }
  float sm = it - log2(max(1.0, log2(max(dot(z, z), 1.0001))));
  vec3 c = it >= 79.0 ? vec3(0.0) : palette(fract(sm * 0.035 + uTime * 0.03 + uBeat * 0.02)) * 1.2;
  // An acid smiley bouncing on the beat.
  if (uSmiley > 0.0) {
    vec2 sp = p - vec2(0.0, 0.03 * abs(sin(uBeat * 3.14159)));
    float r = 0.2 * uSmiley;
    float face = length(sp) - r;
    float eyes = min(length((sp - vec2(-0.07, 0.06) * uSmiley) * vec2(1.0, 0.55)), length((sp - vec2(0.07, 0.06) * uSmiley) * vec2(1.0, 0.55))) - 0.022 * uSmiley;
    float mouth = abs(length(sp - vec2(0.0, 0.03) * uSmiley) - 0.12 * uSmiley) - 0.014 * uSmiley;
    mouth = max(mouth, sp.y + 0.0);
    vec3 fc = S(vec3(1.0, 0.86, 0.05)) * 1.2;
    c = mix(c, vec3(0.0), fillD(face - 0.008));
    c = mix(c, fc, fillD(face));
    c = mix(c, vec3(0.0), fillD(min(eyes, mouth)));
  }
  return c;
}

void main() {
  PX = 1.2 / uRes.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 c;
  if (uScene == 0) c = sceneMaze(vUv);
  else if (uScene == 1) c = sceneFlyers(p);
  else if (uScene == 2) c = scenePolylines(p);
  else c = sceneFractal(p);
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

/** A perfect maze (depth-first) and the walk that tours it, as grid cells. */
export function buildMaze(seed: number): { grid: Uint8Array; path: Array<[number, number]> } {
  const grid = new Uint8Array(GRID * GRID).fill(255);
  const seen = new Uint8Array(MAZE_W * MAZE_W);
  const path: Array<[number, number]> = [];
  const stack: Array<[number, number]> = [[0, 0]];
  seen[0] = 1;
  grid[1 * GRID + 1] = 0;
  path.push([1, 1]);
  let n = 0;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>).filter(([dx, dy]) => {
      const x = cx + dx;
      const y = cy + dy;
      return x >= 0 && y >= 0 && x < MAZE_W && y < MAZE_W && !seen[y * MAZE_W + x];
    });
    if (opts.length) {
      const [dx, dy] = opts[Math.floor(hash2(seed, n++) * opts.length)];
      const x = cx + dx;
      const y = cy + dy;
      seen[y * MAZE_W + x] = 1;
      grid[(cy * 2 + 1 + dy) * GRID + cx * 2 + 1 + dx] = 0;
      grid[(y * 2 + 1) * GRID + x * 2 + 1] = 0;
      path.push([cx * 2 + 1 + dx, cy * 2 + 1 + dy], [x * 2 + 1, y * 2 + 1]);
      stack.push([x, y]);
    } else {
      stack.pop();
      const back = stack[stack.length - 1];
      if (back) path.push([(cx + back[0]) + 1, (cy + back[1]) + 1], [back[0] * 2 + 1, back[1] * 2 + 1]);
    }
  }
  return { grid, path };
}

/**
 * Old desktop screensavers: walking a brick 3D maze, winged floppy disks
 * flying across the screen, bouncing line polygons with trails, and a rave
 * flyer fractal with an acid smiley.
 */
export class Screensaver90 extends ShaderGenerator {
  readonly kind = 'screensaver90';
  private readonly mazeTex: THREE.DataTexture;
  private maze: ReturnType<typeof buildMaze> | null = null;
  private mazeSeed = -1;

  constructor() {
    const tex = new THREE.DataTexture(new Uint8Array(GRID * GRID), GRID, GRID, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    super(FRAG, {
      uScene: { value: 0 },
      uMaze: { value: tex },
      uCam: { value: new THREE.Vector2(1.5, 1.5) },
      uAng: { value: 0 },
      uBob: { value: 0 },
      uReact: { value: 1 },
      uCount: { value: 12 },
      uSmiley: { value: 0 },
      uZoom: { value: 1 },
    });
    this.mazeTex = tex;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const scene = Math.max(0, SAVER_SCENES.indexOf(String(p.scene ?? 'maze') as (typeof SAVER_SCENES)[number]));
    u.uScene.value = scene;
    u.uReact.value = num(p.react, 1);
    u.uCount.value = Math.round(num(p.count, 12));
    u.uSmiley.value = num(p.smiley, 0);
    u.uZoom.value = num(p.zoom, 1);
    if (scene === 0) {
      const seed = Math.round(num(p.seed, 0));
      if (seed !== this.mazeSeed || !this.maze) {
        this.maze = buildMaze(seed);
        this.mazeSeed = seed;
        (this.mazeTex.image.data as Uint8Array).set(this.maze.grid);
        this.mazeTex.needsUpdate = true;
      }
      // Walk the tour: a cell per beat (× speed), turning smoothly at corners and dead ends.
      const path = this.maze.path;
      const s = (ctx.beat * num(p.speed, 1) * 0.5) % (path.length - 1);
      const i = Math.floor(s);
      const f = s - i;
      const a = path[i];
      const b = path[i + 1];
      const heading = (k: number): number => {
        const q = path[Math.max(0, Math.min(path.length - 2, k))];
        const r = path[Math.max(1, Math.min(path.length - 1, k + 1))];
        return Math.atan2(r[1] - q[1], r[0] - q[0]);
      };
      const h0 = heading(i - 1);
      let h1 = heading(i);
      while (h1 - h0 > Math.PI) h1 -= Math.PI * 2;
      while (h1 - h0 < -Math.PI) h1 += Math.PI * 2;
      // Straight on: keep walking. At a corner or dead end: stop, turn, then go.
      const turning = Math.abs(h1 - h0) > 0.01;
      const turn = Math.min(1, f / 0.45);
      const ease = turn * turn * (3 - 2 * turn);
      const move = turning ? Math.max(0, (f - 0.35) / 0.65) : f;
      (u.uCam.value as THREE.Vector2).set(a[0] + 0.5 + (b[0] - a[0]) * move, a[1] + 0.5 + (b[1] - a[1]) * move);
      u.uAng.value = h0 + (h1 - h0) * ease;
      u.uBob.value = Math.sin(ctx.beat * Math.PI) * 0.006;
    }
  }

  dispose(): void {
    this.mazeTex.dispose();
    super.dispose();
  }
}
