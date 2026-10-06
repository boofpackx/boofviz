import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { BlocksSim, Grid, AliensSim, MazeSim, PaddleSim, RacersSim, SnakeSim, type ArcadeSim } from './arcadeSims';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const STRIDE = 64;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uCells;
uniform vec2 uGrid;
uniform float uGlow, uPaletteMix, uScanlines;
uniform int uLook;            // 0 arcade (black), 1 LCD

vec3 colorOf(float id) {
  int i = int(id + 0.5);
  vec3 c = vec3(0.0);
  if (i == 1) c = vec3(0.0, 0.85, 0.95);
  else if (i == 2) c = vec3(1.0, 0.86, 0.0);
  else if (i == 3) c = vec3(0.62, 0.15, 0.9);
  else if (i == 4) c = vec3(0.1, 0.95, 0.25);
  else if (i == 5) c = vec3(1.0, 0.08, 0.1);
  else if (i == 6) c = vec3(0.1, 0.3, 1.0);
  else if (i == 7) c = vec3(1.0, 0.5, 0.0);
  else if (i == 8) c = vec3(0.95, 0.95, 0.95);
  else if (i == 9) c = vec3(1.0, 0.55, 0.8);
  else if (i == 10) c = vec3(0.13, 0.2, 1.0);
  else if (i == 11) c = uPal[0];
  else if (i == 12) c = vec3(0.45);
  else if (i == 13) c = vec3(0.2, 0.25, 1.0);
  return mix(c, palette(0.25 + 0.75 * fract(id * 0.137)), uPaletteMix * step(0.5, id) * (1.0 - step(10.5, id) * step(id, 11.5)));
}

vec4 cellAt(vec2 id) {
  if (id.x < 0.0 || id.y < 0.0 || id.x >= uGrid.x || id.y >= uGrid.y) return vec4(0.0);
  // Row 0 is the top of the board.
  return texelFetch(uCells, ivec2(int(id.x), int(id.y)), 0);
}

bool isWall(vec2 id) { vec4 c = cellAt(id); return c.r * 255.0 > 0.5 && abs(c.b * 255.0 - 3.0) < 0.5; }
bool isTrail(vec2 id, float colorId) { vec4 c = cellAt(id); return abs(c.b * 255.0 - 4.0) < 0.5 && abs(c.r * 255.0 - colorId) < 0.5; }

void main() {
  float cell = floor(min(uRes.x / uGrid.x, uRes.y / uGrid.y));
  vec2 origin = floor((uRes - uGrid * cell) * 0.5);
  vec2 g = (gl_FragCoord.xy - origin) / cell;
  g.y = uGrid.y - g.y;                       // flip so row 0 is at the top
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  f.y = -f.y;
  vec3 bg = uLook == 1 ? uPal[4] * 0.85 : vec3(0.0);
  vec3 col = bg;
  vec4 c = cellAt(id);
  float colorId = c.r * 255.0;
  float inten = c.g;
  float style = c.b * 255.0;
  float px = 1.0 / cell;
  if (colorId > 0.5) {
    vec3 base = colorOf(colorId) * inten;
    if (style < 0.5) {
      // Bevelled block.
      float d = max(abs(f.x), abs(f.y));
      float inside = 1.0 - smoothstep(0.44, 0.44 + px, d);
      float light = clamp(0.5 + (-f.x + f.y) * 1.4, 0.0, 1.0);
      float bevel = smoothstep(0.3, 0.42, d);
      vec3 b = base * mix(1.0, mix(0.45, 1.6, light), bevel);
      col = mix(col, b * (1.1 + 0.4 * uKick), inside);
    } else if (style < 1.5) {
      col = mix(col, base * 1.4, 1.0 - smoothstep(0.1, 0.1 + px, length(f)));
    } else if (style < 2.5) {
      col = mix(col, base * (1.3 + uKick), 1.0 - smoothstep(0.3, 0.3 + px, length(f)));
    } else if (style < 3.5) {
      // Maze wall: a double neon line joining neighbouring wall cells.
      float d = 1e3;
      bool r = isWall(id + vec2(1, 0)), l = isWall(id + vec2(-1, 0)), dn = isWall(id + vec2(0, 1)), up = isWall(id + vec2(0, -1));
      vec2 q = abs(f);
      if (r) d = min(d, f.x >= 0.0 ? abs(f.y) : 1e3);
      if (l) d = min(d, f.x <= 0.0 ? abs(f.y) : 1e3);
      if (dn) d = min(d, f.y <= 0.0 ? abs(f.x) : 1e3);
      if (up) d = min(d, f.y >= 0.0 ? abs(f.x) : 1e3);
      if (!(r || l || dn || up)) d = max(q.x, q.y) - 0.2;
      d = min(d, length(f) - 0.0);
      float line = 1.0 - smoothstep(0.035, 0.035 + px * 1.5, abs(d - 0.22));
      col += base * line * 1.6;
      col += base * exp(-abs(d - 0.22) * 14.0) * 0.25 * uGlow;
    } else if (style < 4.5) {
      // Light-cycle trail: a bright line through connected trail cells.
      float d = 1e3;
      if (isTrail(id + vec2(1, 0), colorId)) d = min(d, f.x >= 0.0 ? abs(f.y) : 1e3);
      if (isTrail(id + vec2(-1, 0), colorId)) d = min(d, f.x <= 0.0 ? abs(f.y) : 1e3);
      if (isTrail(id + vec2(0, 1), colorId)) d = min(d, f.y <= 0.0 ? abs(f.x) : 1e3);
      if (isTrail(id + vec2(0, -1), colorId)) d = min(d, f.y >= 0.0 ? abs(f.x) : 1e3);
      d = min(d, length(f));
      col += base * (1.0 - smoothstep(0.08, 0.08 + px, d)) * 1.8;
      col += base * exp(-d * 6.0) * 0.4 * uGlow;
    } else if (style < 5.5) {
      float d = max(abs(f.x), abs(f.y));
      col = mix(col, base * 1.3, 1.0 - smoothstep(0.46, 0.46 + px, d));
    } else if (style < 6.5) {
      // LCD pixel with a soft drop shadow.
      float d = max(abs(f.x), abs(f.y));
      col = mix(col, uPal[0] * 0.6, (1.0 - smoothstep(0.4, 0.4 + px, max(abs(f.x - 0.06), abs(f.y + 0.06)))) * 0.25);
      col = mix(col, uPal[0], 1.0 - smoothstep(0.4, 0.4 + px, d));
    } else {
      float d = length(f);
      col = mix(col, base * (1.2 + 0.6 * uKick), 1.0 - smoothstep(0.42, 0.42 + px, d));
      col += base * exp(-d * 5.0) * 0.35 * uGlow;
    }
  } else if (uLook == 0) {
    // Faint board grid.
    vec2 e = abs(f);
    col += vec3(0.03) * (1.0 - smoothstep(0.47, 0.5, max(e.x, e.y))) * step(0.0, id.x) * step(id.x, uGrid.x - 1.0) * step(0.0, id.y) * step(id.y, uGrid.y - 1.0);
  }
  if (uLook == 1) col *= 0.92 + 0.08 * sin(gl_FragCoord.y * 3.14159);
  else col *= 1.0 - uScanlines * 0.35 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

type Mode = 'blocks' | 'maze' | 'aliens' | 'paddle' | 'snake' | 'racers';

function makeSim(mode: Mode): ArcadeSim {
  switch (mode) {
    case 'maze':
      return new MazeSim();
    case 'aliens':
      return new AliensSim();
    case 'paddle':
      return new PaddleSim();
    case 'snake':
      return new SnakeSim();
    case 'racers':
      return new RacersSim();
    default:
      return new BlocksSim();
  }
}

/**
 * Retro arcade looks driven by the beat. Each cycle replays deterministically
 * from its first beat (seeded by the cycle number), so preview and output agree.
 */
export class PixelArcade extends ShaderGenerator {
  readonly kind = 'pixelArcade';
  private readonly grid: Grid;
  private readonly tex: THREE.DataTexture;
  private sim: ArcadeSim | null = null;
  private mode: Mode | null = null;
  private cycle = Number.NaN;
  private tick = 0;

  constructor() {
    const grid = new Grid(64, 36, STRIDE);
    const tex = new THREE.DataTexture(grid.cells, STRIDE, 64, THREE.RGBAFormat, THREE.UnsignedByteType);
    super(FRAG, { uCells: { value: tex }, uGrid: { value: new THREE.Vector2(32, 18) }, uGlow: { value: 1 }, uPaletteMix: { value: 0 }, uScanlines: { value: 0.3 }, uLook: { value: 0 } });
    this.grid = grid;
    this.tex = tex;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const mode = String(p.mode ?? 'blocks') as Mode;
    if (mode !== this.mode) {
      this.mode = mode;
      this.sim = makeSim(mode);
      this.cycle = Number.NaN;
    }
    const sim = this.sim!;
    const speed = Math.max(0.25, num(p.speed, 1));
    const cycleBeats = Math.max(4, Math.round(num(p.cycleBars, 16)) * ctx.frame.beatsPerBar);
    const beat = Math.max(0, ctx.beat);
    const cycle = Math.floor(beat / cycleBeats);
    const target = Math.floor((beat - cycle * cycleBeats) * sim.tpb * speed);
    if (cycle !== this.cycle || target < this.tick) {
      this.cycle = cycle;
      sim.reset(cycle * 7919 + 13);
      this.tick = 0;
    }
    // Catch up (bounded) to the tick the beat clock says we should be on.
    let steps = 0;
    while (this.tick < target && steps < 4096) {
      sim.step(++this.tick);
      steps++;
    }
    const g = this.grid;
    g.w = sim.w;
    g.h = sim.h;
    g.clear();
    sim.draw(g, ctx.beat - Math.floor(ctx.beat));
    this.tex.needsUpdate = true;
    const u = this.u;
    (u.uGrid.value as THREE.Vector2).set(sim.w, sim.h);
    u.uGlow.value = num(p.glow, 1);
    u.uPaletteMix.value = num(p.paletteMix, 0);
    u.uScanlines.value = num(p.scanlines, 0.3);
    u.uLook.value = mode === 'snake' ? 1 : 0;
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
