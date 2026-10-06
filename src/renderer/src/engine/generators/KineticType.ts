import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const ATLAS_W = 2048;
const ROW_H = 256;
const MAX_WORDS = 8;
const FONT_PX = 200;

/** Canvas font stacks (Windows first, with common Linux/macOS fallbacks). Also used by the lyrics generator. */
export const FONT_STACKS: Record<string, string> = {
  heavy: `900 {px}px "Segoe UI Black", "Arial Black", "Helvetica Neue", Arial, sans-serif`,
  condensed: `700 {px}px Impact, "Bahnschrift Condensed", "Arial Narrow", "Roboto Condensed", sans-serif`,
  mono: `700 {px}px "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Courier New", monospace`,
  serif: `700 {px}px Georgia, "Times New Roman", "DejaVu Serif", serif`,
};

export function fontCss(name: string, px: number): string {
  return (FONT_STACKS[name] ?? FONT_STACKS.heavy).replace('{px}', String(px));
}

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uAtlas;     // R = fill, G = outline
uniform float uAtlasRows;
uniform float uWidths[${MAX_WORDS + 1}];   // row text width / atlas width
uniform float uCapFrac;       // cap height / row height
uniform int uMode;
uniform float uRowsN, uScroll, uSize, uStretch, uOutline, uSkew, uPunch;
uniform float uWord, uWordT;
uniform vec2 uBounce;          // badge position 0..1 within the free area
uniform float uBounceHue, uFlash, uLines, uCrawl;

// Sample row r at text-space coords: x in em (row heights), y 0..1 across the cap height.
vec2 glyph(int r, float x, float y) {
  float w = uWidths[r] * ${ATLAS_W}.0 / ${ROW_H}.0;      // text width in em
  if (x < 0.0 || x > w || y < -0.25 || y > 1.25) return vec2(0.0);
  float v = 0.5 + (0.5 - y) * uCapFrac;                   // canvas rows run top-down
  vec2 raw = texture(uAtlas, vec2(x / w * uWidths[r], (float(r) + v) / uAtlasRows)).rg;
  // When magnified, re-threshold the bilinear mask for crisp edges (poor man's SDF).
  vec2 fw = fwidth(raw);
  return mix(smoothstep(0.5 - fw, 0.5 + fw, raw), raw, step(0.25, fw));
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 fillCol = palette(0.72) * (1.15 + 0.9 * uKick);
  vec3 lineCol = palette(0.95) * 1.3;
  vec3 col = vec3(0.0);
  float a = 0.0;

  if (uMode == 0 || uMode == 3) {
    // Stacked rows (or one marquee row) of repeating, scrolling text.
    float rows = uMode == 3 ? 1.0 : uRowsN;
    float rowH = uRes.y / rows;
    float y = p.y / rowH;
    float ri = floor(y);
    float ly = fract(y);
    float s = uMode == 3 ? uSize : 1.0;
    float capPx = rowH * 0.86 * min(s, 1.0);
    float stretch = 1.0 + uStretch * uBass * 0.35;
    float gy = (ly - 0.5) * rowH / (capPx * stretch) + 0.5;
    float w = uWidths[0] * ${ATLAS_W}.0 / ${ROW_H}.0;
    float period = w + 0.6;
    float dir = mod(ri, 2.0) > 0.5 ? -1.0 : 1.0;
    float x = (p.x + uSkew * (ly - 0.5) * rowH) / (capPx / uCapFrac * 1.0);
    x = x + dir * uScroll * period + ri * 0.37 * period;
    float gx = mod(x, period);
    vec2 gl = glyph(0, gx, gy);
    bool outline = hash11(ri * 3.7 + 1.0) < uOutline;
    bool hot = mod(floor(uBeat) * 3.0, rows) == ri && uMode == 0;
    float cov = outline && !hot ? gl.g : gl.r;
    col = (hot ? palette(0.45) * 1.6 : outline ? lineCol : fillCol) * cov;
    a = cov;
  } else if (uMode == 4) {
    // Bouncing logo: changes colour on every wall hit, flashes on a corner hit.
    float w = uWidths[0] * ${ATLAS_W}.0 / ${ROW_H}.0;
    float emPx = uRes.y * 0.16 * uSize;
    vec2 box = vec2(w * emPx, emPx * uCapFrac * 1.4);
    vec2 pos = uBounce * (uRes - box);
    vec2 q = p - pos;
    float gy = q.y / (emPx * uCapFrac) - 0.2;
    float gx = q.x / emPx;
    vec2 gl = glyph(0, gx, gy);
    vec3 c = palette(0.3 + 0.7 * fract(uBounceHue * 0.618)) * (1.4 + 2.0 * uFlash);
    col = c * max(gl.r, gl.g * 0.5);
    a = max(gl.r, gl.g * 0.5);
    col += vec3(1.0) * uFlash * 0.25;
    a = max(a, uFlash * 0.25);
  } else if (uMode == 5) {
    // Opening crawl: lines receding up a tilted plane toward the horizon.
    float s = p.y / uRes.y;
    float horizon = 0.92;
    if (s < horizon) {
      float d = 1.0 / (1.0 - s / horizon * 0.94);          // depth: 1 at the bottom, large near the horizon
      float x = (p.x - 0.5 * uRes.x) / uRes.y * d;
      // Text coordinate: line 0 leads, furthest away; the block recedes as uCrawl grows.
      float v = uCrawl - (d - 1.0) * 0.55;
      float lineH = 0.32 * uSize;
      float li = floor(v / lineH);
      if (li >= 0.0 && li < uLines) {
        int r = 1 + int(li);
        float w = uWidths[r] * ${ATLAS_W}.0 / ${ROW_H}.0;
        float em = 0.36 * uSize;
        float gx = x / em + w * 0.5;
        float gy = 1.0 - fract(v / lineH) * 1.6 + 0.3;
        vec2 gl = glyph(r, gx, gy);
        float fade = 1.0 - smoothstep(horizon * 0.55, horizon, s);
        col = fillCol * gl.r * fade;
        a = gl.r * fade;
      }
    }
  } else {
    // Punch (whole text) or one word per beat, centred and fitted.
    int r = uMode == 2 ? 1 + int(uWord) : 0;
    float w = uWidths[r] * ${ATLAS_W}.0 / ${ROW_H}.0;   // em
    float emPx = min(uRes.x * 0.8 / max(w, 0.1), uRes.y * 0.42 / uCapFrac) * uSize;
    float scale = 1.0 + uPunch * uKick;
    if (uMode == 2) scale *= mix(1.18, 1.0, easeOutBack(clamp(uWordT * 4.0, 0.0, 1.0)));
    // Never let a punch push the word off the frame.
    emPx = min(emPx * scale, uRes.x * 0.95 / max(w, 0.1));
    vec2 c = 0.5 * uRes;
    float stretch = 1.0 + uStretch * uBass * 0.5;
    float capPx = emPx * uCapFrac * stretch;
    float gy = (p.y - c.y) / capPx + 0.5;
    float gx = (p.x - c.x + uSkew * (p.y - c.y)) / emPx + w * 0.5;
    vec2 gl = glyph(r, gx, gy);
    col = fillCol * gl.r + lineCol * gl.g * uOutline;
    a = max(gl.r, gl.g * uOutline);
  }
  fragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

/** Kinetic typography: the user's text rendered to an atlas, animated on the beat. */
export class KineticType extends ShaderGenerator {
  readonly kind = 'kineticType';
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: THREE.CanvasTexture;
  private key = '';
  private words: string[] = [];
  private lastWord = -1;
  private wordStart = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = ROW_H * (MAX_WORDS + 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    super(FRAG, {
      uAtlas: { value: tex },
      uAtlasRows: { value: MAX_WORDS + 1 },
      uWidths: { value: new Array<number>(MAX_WORDS + 1).fill(0.1) },
      uCapFrac: { value: 0.6 },
      uMode: { value: 0 },
      uRowsN: { value: 5 },
      uScroll: { value: 0 },
      uSize: { value: 0.8 },
      uStretch: { value: 0.3 },
      uOutline: { value: 0.5 },
      uSkew: { value: 0 },
      uPunch: { value: 0.2 },
      uWord: { value: 0 },
      uWordT: { value: 1 },
      uBounce: { value: new THREE.Vector2() },
      uBounceHue: { value: 0 },
      uFlash: { value: 0 },
      uLines: { value: 1 },
      uCrawl: { value: 0 },
    });
    this.canvas = canvas;
    this.tex = tex;
  }

  private draw(text: string, font: string): void {
    const ctx = this.canvas.getContext('2d')!;
    const upper = text.toUpperCase();
    const full = upper.replace(/\s*\/\s*/g, ' ').trim() || ' ';
    // "/" separates words or lines (crawl); otherwise split on spaces.
    this.words = (upper.includes('/') ? upper.split('/') : upper.split(/\s+/)).map((w) => w.trim()).filter(Boolean).slice(0, MAX_WORDS);
    if (!this.words.length) this.words = [' '];
    const rows = [full, ...this.words];
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = fontCss(font, FONT_PX);
    const cap = ctx.measureText('H').actualBoundingBoxAscent || FONT_PX * 0.72;
    const widths = this.u.uWidths.value as number[];
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    rows.forEach((row, i) => {
      const pad = 24;
      let w = ctx.measureText(row).width;
      const maxW = ATLAS_W - pad * 2;
      const scale = w > maxW ? maxW / w : 1;
      w *= scale;
      const top = i * ROW_H;
      const baseline = top + ROW_H / 2 + (cap * scale) / 2;
      ctx.save();
      ctx.translate(pad, baseline);
      ctx.scale(scale, scale);
      // Fill in red, outline in green: one texture, two looks.
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff0000';
      ctx.fillText(row, 0, 0);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = FONT_PX * 0.035;
      ctx.strokeText(row, 0, 0);
      ctx.restore();
      widths[i] = (w + pad * 2) / ATLAS_W;
    });
    this.u.uCapFrac.value = cap / ROW_H;
    this.tex.needsUpdate = true;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const text = String(p.text ?? 'BOOFVIZ');
    const font = String(p.font ?? 'heavy');
    const key = `${font}|${text}`;
    if (key !== this.key) {
      this.key = key;
      this.draw(text, font);
    }
    const u = this.u;
    const mode = String(p.mode ?? 'stack');
    u.uMode.value = mode === 'punch' ? 1 : mode === 'words' ? 2 : mode === 'marquee' ? 3 : mode === 'bounce' ? 4 : mode === 'crawl' ? 5 : 0;
    if (mode === 'bounce') {
      // Pure function of time: x and y are triangle waves, each wall hit bumps the colour.
      const t = ctx.time * num(p.speed, 1) * 0.11;
      const vx = 1;
      const vy = 1.37;
      const tri = (x: number): number => {
        const f = ((x % 2) + 2) % 2;
        return f < 1 ? f : 2 - f;
      };
      (u.uBounce.value as THREE.Vector2).set(tri(t * vx), tri(t * vy));
      u.uBounceHue.value = Math.floor(t * vx) + Math.floor(t * vy);
      const near = (x: number): number => Math.min(x - Math.floor(x), Math.ceil(x) - x);
      const corner = Math.max(near(t * vx), near(t * vy)) < 0.012;
      u.uFlash.value = corner ? 1 : Math.max(0, (u.uFlash.value as number) - ctx.dt * 1.5);
    }
    u.uLines.value = this.words.length;
    u.uCrawl.value = (ctx.time * num(p.speed, 1) * 0.08) % (this.words.length * 0.32 * num(p.size, 0.8) + 3);
    u.uRowsN.value = Math.round(num(p.rows, 5));
    u.uScroll.value = (num(p.speed, 1) * ctx.beat) / 4;
    u.uSize.value = num(p.size, 0.8);
    u.uStretch.value = num(p.stretch, 0.3);
    u.uOutline.value = num(p.outline, 0.5);
    u.uSkew.value = num(p.skew, 0);
    u.uPunch.value = num(p.punch, 0.2);
    const per = Math.max(1, Math.round(num(p.wordBeats, 1)));
    const wordIdx = Math.floor(ctx.beat / per);
    const word = ((wordIdx % this.words.length) + this.words.length) % this.words.length;
    if (wordIdx !== this.lastWord) {
      this.lastWord = wordIdx;
      this.wordStart = ctx.beat;
    }
    u.uWord.value = word;
    u.uWordT.value = Math.min(1, (ctx.beat - this.wordStart) / per);
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
