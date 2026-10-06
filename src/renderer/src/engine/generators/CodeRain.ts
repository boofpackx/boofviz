import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const COLS = 16;
const ROWS = 8;
const CELL = 64;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uGlyphs;
uniform float uColumns, uSpeed, uTrail, uGlowAmt, uChange, uMirror;
uniform vec2 uGlyphRange;     // first index, count
uniform float uRainT;

float glyph(float index, vec2 f) {
  float gx = mod(index, ${COLS}.0);
  float gy = floor(index / ${COLS}.0);
  vec2 uv = (vec2(gx, gy) + vec2(uMirror > 0.5 ? 1.0 - f.x : f.x, 1.0 - f.y)) / vec2(${COLS}.0, ${ROWS}.0);
  return texture(uGlyphs, uv).r;
}

void main() {
  float cw = uRes.x / uColumns;
  float ch = cw * 1.35;
  vec2 cellF = gl_FragCoord.xy / vec2(cw, ch);
  vec2 id = floor(cellF);
  vec2 f = fract(cellF);
  float rows = uRes.y / ch;
  vec3 col = vec3(0.0);
  // Two drops per column at different speeds and offsets.
  for (int k = 0; k < 2; k++) {
    float h = hash21(vec2(id.x, float(k) * 17.0));
    float sp = uSpeed * (0.55 + 0.9 * hash11(h * 91.0));
    float len = uTrail * (8.0 + 18.0 * hash11(h * 33.0));
    float period = rows + len + 6.0;
    float head = mod(uRainT * sp * 6.0 + h * period, period);
    // Distance (in cells) from the head down the trail; rows count down from the top.
    float rowFromTop = rows - 1.0 - id.y;
    float d = head - rowFromTop;
    if (d < 0.0 || d > len) continue;
    float t = d / len;
    float idx = uGlyphRange.x + floor(hash21(vec2(id.x * 3.1 + float(k), rowFromTop + floor(uRainT * uChange * (0.5 + h)))) * uGlyphRange.y);
    float gl = glyph(idx, f);
    vec3 c = d < 1.0 ? uPal[4] * (1.6 + uHat * 0.8) : mix(uPal[3], uPal[1], t) * (1.0 - t) * (1.0 + uKick * 0.5);
    col += c * gl;
    col += c * gl * 0.3 * uGlowAmt;
  }
  fragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 2.0, 0.0, 1.0));
}
`;

const SETS: Record<string, [number, number]> = {
  katakana: [0, 66],
  binary: [66, 2],
  hex: [66, 16],
  latin: [82, 26],
};

/** Falling columns of glyphs: mirrored half-width katakana and digits, film-style. */
export class CodeRain extends ShaderGenerator {
  readonly kind = 'codeRain';

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#000';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const chars: string[] = [];
    for (let cp = 0xff66; cp <= 0xff9d; cp++) chars.push(String.fromCodePoint(cp)); // 56 half-width katakana
    chars.push(...'012345789Z'.split('')); // pad to 66 with digits that read well in the rain
    chars.push(...'0123456789ABCDEF'.split(''));
    chars.push(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
    chars.forEach((ch, i) => {
      const x = (i % COLS) * CELL + CELL / 2;
      const y = Math.floor(i / COLS) * CELL + CELL / 2;
      c.font = `bold ${CELL * 0.78}px "MS Gothic", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans Mono CJK JP", "DejaVu Sans Mono", monospace`;
      c.fillText(ch, x, y);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    super(FRAG, {
      uGlyphs: { value: tex },
      uColumns: { value: 90 },
      uSpeed: { value: 1 },
      uTrail: { value: 1 },
      uGlowAmt: { value: 1 },
      uChange: { value: 4 },
      uMirror: { value: 1 },
      uGlyphRange: { value: new THREE.Vector2(0, 66) },
      uRainT: { value: 0 },
    });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uColumns.value = Math.round(num(p.columns, 90));
    u.uSpeed.value = num(p.speed, 1);
    u.uTrail.value = num(p.trail, 1);
    u.uGlowAmt.value = num(p.glow, 1);
    u.uChange.value = num(p.change, 4);
    u.uMirror.value = p.mirror === false ? 0 : 1;
    const set = SETS[String(p.glyphs ?? 'katakana')] ?? SETS.katakana;
    (u.uGlyphRange.value as THREE.Vector2).set(set[0], set[1]);
    // Rain speed follows the tempo (1× at 120 BPM).
    u.uRainT.value = ctx.beat * 0.5;
  }
}
