import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Two of the 80s home computer's most famous sights, at fat-pixel resolution.
 *
 * - lightSynth: the mid-80s light synthesizers. Mirror-symmetric bursts of
 *   chunky pixels bloom out from the middle, two a beat, in rings that step
 *   through a colour sequence; newer bursts paint over older ones and the
 *   whole palette rotates a notch every beat.
 * - boing: the 1984 checkered-ball demo. A red and white ball spinning on a
 *   tilted axis bounces across a purple grid, landing on the beat, with its
 *   shadow on the wall; it turns back at each wall and reverses its spin.
 */

const BURSTS = 24;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uMode;          // 0 light synth, 1 ball
uniform float uLines;       // vertical resolution in fat pixels
uniform float uRate, uGrow, uWidth, uStep, uSym, uShape, uColourMode, uCycle;
uniform float uBounceBeats, uCrossBars, uBallSize, uSpin;

// Colour sequences, display sRGB (converted below).
vec3 seqClassic(int i) {
  i = i % 8;
  if (i == 0) return vec3(0.20, 0.16, 0.62);
  if (i == 1) return vec3(0.44, 0.24, 0.53);
  if (i == 2) return vec3(0.75, 0.22, 0.30);
  if (i == 3) return vec3(0.85, 0.45, 0.15);
  if (i == 4) return vec3(0.95, 0.85, 0.30);
  if (i == 5) return vec3(1.00, 1.00, 1.00);
  if (i == 6) return vec3(0.44, 0.82, 0.86);
  return vec3(0.40, 0.75, 0.30);
}
vec3 toLin(vec3 s) { return pow(s, vec3(2.2)); }

float shapeDist(vec2 d, float shape) {
  d = abs(d);
  if (shape < 0.5) return d.x + d.y;                 // diamond
  if (shape < 1.5) return max(d.x, d.y);             // square
  if (shape < 2.5) return min(d.x, d.y) * 2.5 + max(d.x, d.y) * 0.35; // cross
  return length(d);                                  // round
}

vec3 lightSynth(vec2 cell, vec2 grid) {
  vec2 q = cell - floor(grid * 0.5);
  // Fold into the symmetric wedge (4- or 8-way).
  q = abs(q);
  if (uSym > 6.0 && q.y > q.x) q = q.yx;
  float now = uBeat * uRate;
  float newest = floor(now);
  vec3 col = vec3(0.0);
  for (int k = 0; k < ${BURSTS}; k++) {
    float idx = newest - float(k);
    float age = (now - idx) / uRate;            // beats
    vec2 c = vec2(hash11(idx * 1.731 + 0.3), hash11(idx * 3.117 + 0.7)) * grid * vec2(0.42, 0.42);
    if (uSym > 6.0 && c.y > c.x) c = c.yx;
    float shape = uShape < 3.5 ? uShape : floor(hash11(idx * 5.3) * 4.0);
    float r = age * uGrow;
    float d = shapeDist(q - c, shape);
    float into = r - d;
    if (into >= 0.0 && into < uWidth) {
      int ci = int(floor(into / uStep) + idx * 3.0 + floor(uBeat * uCycle));
      vec3 s = uColourMode < 0.5 ? toLin(seqClassic(ci)) : paletteWrap(float(ci) * 0.13);
      // Rings fade out as the burst grows old.
      col = s * (1.0 - smoothstep(uWidth * 0.75, uWidth, into)) * (1.0 + uKick * 0.35);
      break;
    }
  }
  return col;
}

vec3 ball(vec2 cell, vec2 grid) {
  vec3 bg = toLin(vec3(0.67, 0.67, 0.67));
  vec3 purple = toLin(vec3(0.62, 0.0, 0.62));
  float floorY = grid.y * 0.18;
  float sq = floor(grid.y / 12.0);
  vec3 col = bg;
  // Back wall grid and a floor grid in perspective.
  if (cell.y > floorY) {
    vec2 g = mod(cell - vec2(floor(grid.x * 0.5), floorY), sq);
    if (g.x < 1.0 || g.y < 1.0) col = purple;
  } else {
    float depth = (floorY - cell.y) / floorY;           // 0 at the wall, 1 at the front
    float x = (cell.x - grid.x * 0.5) / (1.0 + depth * 1.6);
    if (mod(x, sq) < 1.0) col = purple;
    float rows = floor(log2(1.0 + depth * 7.0) * 2.0);
    float rowsPrev = floor(log2(1.0 + max(0.0, depth - 1.0 / floorY) * 7.0) * 2.0);
    if (rows != rowsPrev) col = purple;
  }
  float R = grid.y * uBallSize;
  // Across the room and back; the bounce lands on the beat.
  float cross = uBeat / (uBeatsPerBar * uCrossBars);
  float tri = abs(fract(cross * 0.5) * 2.0 - 1.0);
  float left = R + sq, right = grid.x - R - sq;
  float bx = mix(left, right, tri);
  float dir = fract(cross * 0.5) < 0.5 ? 1.0 : -1.0;
  float f = fract(uBeat / uBounceBeats);
  float h = 1.0 - (2.0 * f - 1.0) * (2.0 * f - 1.0);
  float by = floorY + R * 0.6 + h * (grid.y - floorY - R * 2.2);
  // Shadow on the wall, up and to the right.
  vec2 sp = cell - vec2(bx + R * 0.35, by + R * 0.12);
  if (dot(sp, sp) < R * R && cell.y > floorY) col *= 0.45;
  vec2 d = (cell - vec2(bx, by)) / R;
  float rr = dot(d, d);
  if (rr < 1.0) {
    vec3 n = vec3(d, sqrt(1.0 - rr));
    // Tilted spin axis.
    float tilt = 0.35;
    n.xy = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * n.xy;
    float spin = uBeat * uSpin * dir;
    float lon = atan(n.z, n.x) + spin;
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float ch = mod(floor(lon / (6.2831853 / 16.0)) + floor(lat / (3.14159265 / 8.0)), 2.0);
    col = ch < 0.5 ? toLin(vec3(0.95, 0.0, 0.0)) : toLin(vec3(1.0));
  }
  return col;
}

void main() {
  float px = max(1.0, uRes.y / uLines);
  vec2 grid = floor(uRes / px);
  vec2 cell = floor(gl_FragCoord.xy / px);
  vec3 col = uMode == 0 ? lightSynth(cell, grid) : ball(cell, grid);
  fragColor = vec4(col, 1.0);
}
`;

export class Demo80 extends ShaderGenerator {
  readonly kind = 'demo80';

  constructor() {
    super(FRAG, {
      uMode: { value: 0 },
      uLines: { value: 180 },
      uRate: { value: 2 },
      uGrow: { value: 24 },
      uWidth: { value: 40 },
      uStep: { value: 3 },
      uSym: { value: 8 },
      uShape: { value: 4 },
      uColourMode: { value: 0 },
      uCycle: { value: 1 },
      uBounceBeats: { value: 2 },
      uCrossBars: { value: 2 },
      uBallSize: { value: 0.2 },
      uSpin: { value: 1.2 },
    });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const ballMode = p.mode === 'boing';
    u.uMode.value = ballMode ? 1 : 0;
    u.uLines.value = num(p.lines, ballMode ? 200 : 150);
    u.uRate.value = num(p.rate, 2);
    u.uGrow.value = num(p.grow, 24);
    u.uWidth.value = num(p.width, 40);
    u.uStep.value = num(p.step, 3);
    u.uSym.value = p.symmetry === '4' ? 4 : 8;
    u.uShape.value = ['diamond', 'square', 'cross', 'round'].indexOf(String(p.shape)) === -1 ? 4 : ['diamond', 'square', 'cross', 'round'].indexOf(String(p.shape));
    u.uColourMode.value = p.colours === 'look' ? 1 : 0;
    u.uCycle.value = num(p.cycle, 1);
    u.uBounceBeats.value = num(p.bounceBeats, 2);
    u.uCrossBars.value = num(p.crossBars, 2);
    u.uBallSize.value = num(p.ballSize, 0.2);
    u.uSpin.value = num(p.spin, 1.2);
  }
}
