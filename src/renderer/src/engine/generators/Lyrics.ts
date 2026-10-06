import * as THREE from 'three';
import { lineIndexAt, positionAt, type LyricLine } from '@shared/lyrics';
import { GEN_HEADER } from '../shaders/common';
import { currentLines, lyricsFeed, songPositionMs } from '../lyricsFeed';
import type { GenContext } from './Generator';
import { fontCss } from './KineticType';
import { num, ShaderGenerator } from './ShaderGenerator';

const ATLAS_W = 4096;
const ROW_H = 160;
const ROWS = 3; // 0 current line · 1 next line · 2 title card / idle text
const FONT_PX = 112;
const PAD = 32;
const CARD_MS = 4000;
const AW = (ATLAS_W / ROW_H).toFixed(1);

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uAtlas;      // R = fill, G = outline
uniform float uWidths[${ROWS}];   // row width in em (1 em = one atlas row)
uniform float uCapFrac;        // cap height / row height
uniform int uMode;             // 0 karaoke 1 punch 2 typewriter
uniform int uMainRow;          // atlas row in the main slot (-1: none)
uniform float uMainAlpha, uNextAlpha, uFill, uCursor, uScale, uSize, uPosY, uGlow, uOutline, uBackdrop, uFlat;

vec2 atlasUv(int r, float x, float y) {
  float v = 0.5 + (0.5 - y) * uCapFrac;                  // canvas rows run top-down
  return vec2(x / ${AW}, (float(r) + clamp(v, 0.0, 1.0)) / ${ROWS}.0);
}

// Coverage of row r at text-space coords: x in em from the row start, y 0..1 across the cap height.
vec2 glyph(int r, float x, float y) {
  float v = 0.5 + (0.5 - y) * uCapFrac;
  if (x < 0.0 || x > uWidths[r] || v < 0.0 || v > 1.0) return vec2(0.0);
  vec2 raw = texture(uAtlas, atlasUv(r, x, y)).rg;
  vec2 fw = fwidth(raw);
  return mix(smoothstep(0.5 - fw, 0.5 + fw, raw), raw, step(0.25, fw));
}

// Soft halo from a coarse mip of the fill.
float halo(int r, float x, float y) {
  float v = 0.5 + (0.5 - y) * uCapFrac;
  if (x < -0.6 || x > uWidths[r] + 0.6 || v < 0.03 || v > 0.97) return 0.0;
  return texture(uAtlas, atlasUv(r, x, y), 3.5).r;
}

vec4 over(vec4 acc, vec3 c, float a) {
  return vec4(c * a + acc.rgb * (1.0 - a), a + acc.a * (1.0 - a));
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 hi = uPal[4] * 1.25;
  vec3 base = mix(uPal[2], uPal[3], 0.5) * 1.05;
  vec3 dark = uPal[0] * 0.15;

  // Layout: the main line is fitted to 92% of the width; the next line sits below it, smaller.
  int mr = max(uMainRow, 0);
  float capTarget = uRes.y * 0.075 * uSize;
  float emM = min(capTarget / uCapFrac, uRes.x * 0.92 / max(uWidths[mr], 0.01));
  float emN = min(capTarget * 0.62 / uCapFrac, uRes.x * 0.92 / max(uWidths[1], 0.01));
  float capM = emM * uCapFrac;
  float capN = emN * uCapFrac;
  float mainY = uPosY * uRes.y;
  float nextY = mainY - capM * 0.5 - capM * 0.75 - capN * 0.5;
  float cx = 0.5 * uRes.x;
  bool hasMain = uMainRow >= 0 && uMainAlpha > 0.001;
  bool hasNext = uNextAlpha > 0.001;

  vec4 acc = vec4(0.0);

  // Backdrop: a dark plate behind the text block (sized at rest, so punches don't make it jump).
  if (uBackdrop > 0.001 && (hasMain || hasNext)) {
    float padEm = 2.0 * ${PAD}.0 / ${ROW_H}.0;
    float wPx = max(hasMain ? (uWidths[mr] - padEm) * emM : 0.0, hasNext ? (uWidths[1] - padEm) * emN : 0.0);
    float top = hasMain ? mainY + capM * 1.15 : nextY + capN * 1.2;
    float bottom = hasNext ? nextY - capN * 1.2 : mainY - capM * 1.15;
    vec2 c = vec2(cx, 0.5 * (top + bottom));
    vec2 half_ = vec2(0.5 * wPx + capM * 0.8, 0.5 * (top - bottom));
    float d = sdRoundBox(p - c, half_, capM * 0.4);
    float a = (1.0 - smoothstep(-2.0, 2.0, d)) * uBackdrop * 0.82 * max(hasMain ? uMainAlpha : 0.0, hasNext ? min(1.0, uNextAlpha * 2.0) : 0.0);
    acc = over(acc, dark, a);
  }

  // Next line (dim preview of what comes up).
  if (hasNext) {
    float gx = (p.x - cx) / emN + uWidths[1] * 0.5;
    float gy = (p.y - nextY) / capN + 0.5;
    vec2 g = glyph(1, gx, gy);
    acc = over(acc, dark, g.g * uOutline * uNextAlpha);
    acc = over(acc, base, g.r * uNextAlpha);
  }

  if (hasMain) {
    float em = min(emM * uScale, uRes.x * 0.97 / max(uWidths[mr], 0.01));
    float cap = em * uCapFrac;
    float gx = (p.x - cx) / em + uWidths[mr] * 0.5;
    float gy = (p.y - mainY) / cap + 0.5;
    vec2 g = glyph(mr, gx, gy);
    // Typewriter: only what has been typed; karaoke: sung part highlighted.
    float vis = uMode == 2 && uFlat < 0.5 ? step(gx, uFill) : 1.0;
    float sung = uFlat > 0.5 || uMode == 1 ? 1.0 : 1.0 - smoothstep(uFill - 0.03, uFill + 0.03, gx);
    vec3 fill = mix(base * 0.8, hi, sung) * (1.0 + 0.35 * uKick * float(uMode == 1));
    float glow = uGlow > 0.001 ? halo(mr, gx, gy) * vis * mix(0.35, 1.0, sung) * uGlow : 0.0;
    vec3 glowRgb = hi * glow * 0.9 * uMainAlpha;
    acc.rgb += glowRgb;
    acc.a = clamp(acc.a + 0.5 * luma(glowRgb), 0.0, 1.0);
    acc = over(acc, dark, g.g * uOutline * vis * uMainAlpha);
    acc = over(acc, fill, g.r * vis * uMainAlpha);
    if (uMode == 2 && uCursor > 0.5) {
      // Block cursor right after the last typed character, blinking on the beat.
      vec2 q = vec2(gx - uFill - 0.05, gy);
      float box = step(0.0, q.x) * step(q.x, 0.36) * step(-0.18, q.y) * step(q.y, 1.12);
      acc = over(acc, hi, box * uMainAlpha);
    }
  }
  // Premultiplied like the other text generators: black is transparent to add / screen blends and FX.
  fragColor = vec4(acc.rgb, clamp(acc.a, 0.0, 1.0));
}
`;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = Math.min(1, Math.max(0, x)) - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
};

/** What the generator showed last frame (read by debug hooks / tests). */
export interface LyricsRenderInfo {
  index: number;
  text: string;
  card: boolean;
  positionMs: number;
}

/**
 * Synced lyrics of the track playing in the connected player: the current
 * line large with the next one dimmer, drawn from a canvas atlas that is
 * re-rendered only when the visible lines change. Song position comes from
 * the shared now-playing sample and the wall clock, so every window agrees.
 */
export class Lyrics extends ShaderGenerator {
  readonly kind = 'lyrics';
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: THREE.CanvasTexture;
  private key = '';
  /** Em position of each character boundary in the main row (karaoke / typewriter). */
  private charX: number[] = [0];
  /** Em position where each row's text ends (the typewriter cursor sits there on the title card). */
  private rowEnd: number[] = new Array<number>(ROWS).fill(0);
  private wordRanges: Array<[number, number]> = [];
  info: LyricsRenderInfo = { index: -1, text: '', card: false, positionMs: 0 };

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = ROW_H * ROWS;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    super(FRAG, {
      uAtlas: { value: tex },
      uWidths: { value: new Array<number>(ROWS).fill(0.01) },
      uCapFrac: { value: 0.5 },
      uMode: { value: 0 },
      uMainRow: { value: -1 },
      uMainAlpha: { value: 0 },
      uNextAlpha: { value: 0 },
      uFill: { value: 0 },
      uCursor: { value: 0 },
      uScale: { value: 1 },
      uSize: { value: 0.8 },
      uPosY: { value: 0.24 },
      uGlow: { value: 0.6 },
      uOutline: { value: 0.6 },
      uBackdrop: { value: 0 },
      uFlat: { value: 0 },
    });
    this.canvas = canvas;
    this.tex = tex;
  }

  private draw(rows: string[], font: string, line: LyricLine | null, upper: boolean): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = fontCss(font, FONT_PX);
    const cap = ctx.measureText('H').actualBoundingBoxAscent || FONT_PX * 0.72;
    const widths = this.u.uWidths.value as number[];
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const maxW = ATLAS_W - PAD * 2;
    rows.forEach((row, i) => {
      const full = ctx.measureText(row).width;
      // Very long lines are squeezed into the atlas (the shader fits the rest).
      const scale = full > maxW ? maxW / full : 1;
      const top = i * ROW_H;
      ctx.save();
      ctx.translate(PAD, top + ROW_H / 2 + (cap * scale) / 2);
      ctx.scale(scale, scale);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff0000';
      ctx.fillText(row, 0, 0);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = FONT_PX * 0.12;
      ctx.strokeText(row, 0, 0);
      ctx.restore();
      widths[i] = row ? (full * scale + PAD * 2) / ROW_H : 0.01;
      this.rowEnd[i] = (PAD + full * scale) / ROW_H;
      if (i === 0) {
        this.charX = Array.from({ length: row.length + 1 }, (_, k) => (PAD + ctx.measureText(row.slice(0, k)).width * scale) / ROW_H);
      }
    });
    // Word stamps → character ranges in the displayed (possibly uppercased) text.
    this.wordRanges = [];
    if (line?.words) {
      let from = 0;
      for (const w of line.words) {
        const word = upper ? w.text.toUpperCase() : w.text;
        const at = rows[0].indexOf(word, from);
        const start = at >= 0 ? at : from;
        const end = at >= 0 ? at + word.length : Math.min(rows[0].length, from + word.length);
        this.wordRanges.push([start, end]);
        from = end;
      }
    }
    this.u.uCapFrac.value = cap / ROW_H;
    this.tex.needsUpdate = true;
  }

  /** Karaoke fill edge (em) at `pos` ms. */
  private sweep(line: LyricLine, endMs: number, pos: number): number {
    const x = this.charX;
    const n = x.length - 1;
    if (line.words?.length && this.wordRanges.length === line.words.length) {
      const words = line.words;
      let i = -1;
      while (i + 1 < words.length && words[i + 1].t <= pos) i++;
      if (i < 0) return x[0];
      const [s, e] = this.wordRanges[i];
      const wEnd = i + 1 < words.length ? words[i + 1].t : Math.min(endMs, words[i].t + 1000);
      const f = Math.min(1, Math.max(0, (pos - words[i].t) / Math.max(1, wEnd - words[i].t)));
      return x[s] + (x[e] - x[s]) * f;
    }
    // No word stamps: an even sweep, a little faster than the line so it lands before the next one.
    const dur = Math.max(1, endMs - line.t);
    const sweepMs = Math.min(dur * 0.9, Math.max(1200, n * 90));
    return x[0] + (x[n] - x[0]) * Math.min(1, Math.max(0, (pos - line.t) / sweepMs));
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const mode = String(p.mode ?? 'karaoke');
    const font = String(p.font ?? 'heavy');
    const upper = p.uppercase === true;
    const now = lyricsFeed.now;
    const epoch = Date.now();
    const pos = songPositionMs(epoch, num(p.lead, 150));
    const raw = positionAt(now, epoch);
    const lines = now.connected ? currentLines() : null;
    const idx = lines ? lineIndexAt(lines, pos) : -1;
    const line = lines && idx >= 0 ? lines[idx] : null;
    const next = lines?.[idx + 1] ?? null;
    const curText = line?.text ?? '';

    // Title card at each track start and whenever there are no synced lyrics; idle text otherwise.
    const playingTrack = now.connected && !!now.title;
    let cardText = '';
    let cardAlpha = 0;
    if (playingTrack && p.titleCard !== false) {
      cardText = now.artists.length ? `${now.title} — ${now.artists.join(', ')}` : now.title;
      cardAlpha = !lines ? 1 : !curText ? smooth(0, 400, raw) * (1 - smooth(CARD_MS - 600, CARD_MS, raw)) : 0;
    } else if (!playingTrack) {
      cardText = String(p.idleText ?? '');
      cardAlpha = cardText ? 1 : 0;
    }
    const showCard = cardAlpha > 0.001 && !curText;

    const shown = (s: string): string => (upper ? s.toUpperCase() : s);
    const rows = [shown(curText), shown(next?.text ?? ''), shown(cardText)];
    const key = `${font}|${rows.join('\n')}|${idx}`;
    if (key !== this.key) {
      this.key = key;
      this.draw(rows, font, line, upper);
    }

    u.uMode.value = mode === 'punch' ? 1 : mode === 'typewriter' ? 2 : 0;
    u.uMainRow.value = curText ? 0 : showCard ? 2 : -1;
    u.uFlat.value = curText ? 0 : 1;
    u.uNextAlpha.value = next?.text ? num(p.nextLine, 0.45) : 0;
    let alpha = curText ? 1 : cardAlpha;
    let scale = 1;
    let fill = curText ? this.charX[this.charX.length - 1] : this.rowEnd[2];
    if (line && curText) {
      const endMs = next ? next.t : Math.min(line.t + 6000, now.durationMs || Infinity);
      const dur = Math.max(1, endMs - line.t);
      const elapsed = pos - line.t;
      if (mode === 'punch') {
        // Each new line slams in, then breathes with the kick.
        scale = 1.55 - 0.55 * easeOutBack(elapsed / 320);
        alpha = Math.min(1, Math.max(0, elapsed / 60));
      } else if (mode === 'typewriter') {
        const n = this.charX.length - 1;
        const typeMs = Math.min(dur * 0.6, 400 + n * 90);
        const typed = Math.min(n, Math.floor((Math.max(0, elapsed) / typeMs) * n + 1e-6));
        fill = this.charX[typed];
      } else fill = this.sweep(line, endMs, pos);
    }
    scale *= 1 + num(p.punch, 0.3) * ctx.env.kick * (mode === 'punch' ? 0.14 : 0.04);
    u.uMainAlpha.value = alpha;
    u.uScale.value = scale;
    u.uFill.value = fill;
    u.uCursor.value = mode === 'typewriter' && (curText || showCard) && ctx.beat - Math.floor(ctx.beat) < 0.5 ? 1 : 0;
    u.uSize.value = num(p.size, 0.8);
    const position = String(p.position ?? 'lower');
    u.uPosY.value = position === 'center' ? 0.55 : position === 'upper' ? 0.86 : 0.26;
    u.uGlow.value = num(p.glow, 0.6);
    u.uOutline.value = num(p.outline, 0.6);
    u.uBackdrop.value = num(p.backdrop, 0.35);
    this.info = { index: idx, text: curText || (showCard ? cardText : ''), card: showCard, positionMs: pos };
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
