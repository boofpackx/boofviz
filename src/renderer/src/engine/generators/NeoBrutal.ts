import * as THREE from 'three';
import { lineIndexAt } from '@shared/lyrics';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import { currentLines, lyricsFeed, songPositionMs } from '../lyricsFeed';
import { hash2 } from '../lostMedia';
import type { GenContext } from './Generator';
import { heroWord } from './lyricCinema';
import { timeWords, type TimedLine } from './lyricVideoMotion';
import { num, ShaderGenerator } from './ShaderGenerator';

const W = 960;

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform sampler2D uTex;
void main() {
  // Drawn in display colours: hand the output pass exactly what it needs to show them as drawn.
  fragColor = vec4(fromDisplay(texture(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb), 1.0);
}
`;

export const NEO_MODES = ['cards', 'html', 'numbers', 'stickers', 'eq', 'data', 'marquee', 'grid'] as const;

const FLAT = ['#b8ff3c', '#ff4fd8', '#2b59ff', '#ffe14a', '#ff7a1a', '#3cf0ff'];
const INK = '#111111';
const PAPER = '#f5f2ea';
const SERIF = `{px}px "Times New Roman", Times, serif`;
const GROT = `900 {px}px "Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const MONO = `bold {px}px "Courier New", Consolas, monospace`;
const f = (font: string, px: number): string => font.replace('{px}', String(Math.round(px)));
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const outBack = (x: number): number => {
  const t = clamp01(x) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
};

interface Lines {
  current: TimedLine;
  index: number;
  previous: string[];
  now: number;
}

/**
 * Neo-brutal graphics, drawn flat: thick black borders, hard offset shadows,
 * loud flat colour, giant grotesk and raw default type, moving in hard beat
 * steps. Lyric cards slamming into a stack, an unstyled web page breaking on
 * the beat, split-flap numbers, a sticker bomb, an oversized mixer, a data
 * dump, a wall of marquees and Swiss-grid lyrics.
 */
export class NeoBrutal extends ShaderGenerator {
  readonly kind = 'neoBrutal';
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = 540;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    super(FRAG, { uTex: { value: tex } });
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.tex = tex;
  }

  /** The sung line with word timings (or the look's own words, a line every few beats). */
  private lines(ctx: GenContext): Lines {
    const p = ctx.params;
    const upper = p.uppercase !== false;
    const fix = (s: string): string => (upper ? s.toUpperCase() : s);
    const synced = String(p.source ?? 'lyrics') === 'lyrics' && lyricsFeed.now.connected ? currentLines() : null;
    if (synced?.length) {
      const posMs = songPositionMs(Date.now(), num(p.lead, 120));
      const i = lineIndexAt(synced, posMs);
      if (i >= 0) {
        const at = (k: number): TimedLine => {
          const l = synced[k];
          const start = l.t / 1000;
          return timeWords(fix(l.text || '♪'), start, synced[k + 1] ? synced[k + 1].t / 1000 : start + 4, l.words);
        };
        const previous: string[] = [];
        for (let k = i - 1; k >= Math.max(0, i - 8); k--) previous.push(fix(synced[k].text || '♪'));
        return { current: at(i), index: i, previous, now: posMs / 1000 };
      }
    }
    const rows = String(p.text ?? 'RAW / LOUD / HONEST / NO DECORATION').split('/').map((s) => s.trim()).filter(Boolean);
    const lineBeats = Math.max(1, num(p.lineBeats, 8));
    const spb = 60 / Math.max(40, ctx.frame.bpm || 120);
    const idx = Math.floor(ctx.beat / lineBeats);
    const row = (k: number): string => fix(rows[((k % rows.length) + rows.length) % rows.length] || ' ');
    const start = idx * lineBeats * spb;
    const previous: string[] = [];
    for (let k = idx - 1; k >= idx - 8; k--) previous.push(row(k));
    return { current: timeWords(row(idx), start, start + lineBeats * spb), index: idx, previous, now: ctx.beat * spb };
  }

  /** A flat card: hard shadow, fill, thick border. */
  private card(x: number, y: number, w: number, h: number, fill: string, shadow = 10, border = 5): void {
    const g = this.g;
    g.fillStyle = INK;
    g.fillRect(x + shadow, y + shadow, w, h);
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
    g.lineWidth = border;
    g.strokeStyle = INK;
    g.strokeRect(x, y, w, h);
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const H = Math.max(300, Math.round((W * ctx.height) / Math.max(1, ctx.width)));
    if (this.canvas.height !== H) this.canvas.height = H;
    const mode = String(ctx.params.mode ?? 'cards');
    const g = this.g;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    if (mode === 'html') this.html(ctx, H);
    else if (mode === 'numbers') this.numbers(ctx, H);
    else if (mode === 'stickers') this.stickers(ctx, H);
    else if (mode === 'eq') this.eq(ctx, H);
    else if (mode === 'data') this.data(ctx, H);
    else if (mode === 'marquee') this.marquee(ctx, H);
    else if (mode === 'grid') this.grid(ctx, H);
    else this.cards(ctx, H);
    this.tex.needsUpdate = true;
  }

  private colour(k: number): string {
    return FLAT[((k % FLAT.length) + FLAT.length) % FLAT.length];
  }

  // ---- Card stack: each word on a card that slams down as it is sung.
  private cards(ctx: GenContext, H: number): void {
    const g = this.g;
    const bar = Math.floor(ctx.beat / Math.max(1, ctx.frame.beatsPerBar));
    g.fillStyle = this.colour(bar + 3);
    g.fillRect(0, 0, W, H);
    this.dotGrid(H, 'rgba(0,0,0,0.18)');
    const { current, index, now } = this.lines(ctx);
    const hero = heroWord(current.text);
    let y = 70;
    let x = 60;
    current.words.forEach((w, i) => {
      const t = now - w.start;
      if (t < 0) return;
      const big = i === hero;
      const px = big ? 92 : 50;
      g.font = f(GROT, px);
      const tw = g.measureText(w.text).width;
      const cw = tw + 40;
      const ch = px * 1.15;
      if (x + cw > W - 50) {
        x = 60;
        y += ch + 26;
      }
      const land = outBack(t / 0.22);
      const drop = (1 - clamp01(t / 0.22)) * -160;
      const rot = (hash2(index * 31 + i, 7) - 0.5) * 0.12;
      g.save();
      g.translate(x + cw / 2, y + ch / 2 + drop);
      g.rotate(rot);
      g.scale(0.6 + 0.4 * land, 0.6 + 0.4 * land);
      this.card(-cw / 2, -ch / 2, cw, ch, big ? INK : PAPER, big ? 14 : 10);
      g.fillStyle = big ? this.colour(index) : INK;
      g.fillText(w.text, -cw / 2 + 20, ch / 2 - px * 0.28);
      g.restore();
      x += cw + 22;
    });
  }

  // ---- Raw HTML: an unstyled page that knocks itself apart on the beat.
  private html(ctx: GenContext, H: number): void {
    const g = this.g;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    const { current, previous } = this.lines(ctx);
    const step = Math.floor(ctx.beat);
    const broken = Math.min(1, ctx.env.drop * 1.5 + ctx.env.kick * 0.3);
    const jolt = (k: number): [number, number, number] => {
      const s = broken + (hash2(step, k) < 0.25 ? 0.4 : 0);
      return [(hash2(step, k + 50) - 0.5) * 60 * s, (hash2(step, k + 90) - 0.5) * 30 * s, (hash2(step, k + 130) - 0.5) * 0.25 * s];
    };
    const at = (k: number, fn: () => void): void => {
      const [dx, dy, r] = jolt(k);
      g.save();
      g.translate(dx, dy);
      g.rotate(r);
      fn();
      g.restore();
    };
    g.fillStyle = '#000';
    at(1, () => {
      g.font = `bold ${f(SERIF, 54)}`;
      g.fillText(current.text.toLowerCase(), 24, 74, W - 48);
    });
    at(2, () => {
      g.fillStyle = '#808080';
      g.fillRect(24, 92, W - 48, 2);
    });
    previous.slice(0, 5).forEach((line, i) =>
      at(3 + i, () => {
        g.font = f(SERIF, 20);
        g.fillStyle = '#0000ee';
        g.fillText(`• ${line.toLowerCase()}`, 40, 134 + i * 30);
        const w = g.measureText(`• ${line.toLowerCase()}`).width;
        g.fillRect(52, 138 + i * 30, w - 12, 1.5);
      }),
    );
    ['Submit', 'Reset', 'Click here'].forEach((label, i) =>
      at(10 + i, () => {
        const x = 24 + i * 140;
        const yy = Math.min(H - 70, 300);
        g.fillStyle = '#e0e0e0';
        g.fillRect(x, yy, 120, 34);
        g.strokeStyle = '#767676';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, yy + 0.5, 119, 33);
        g.font = f(SERIF, 18);
        g.fillStyle = '#000';
        g.fillText(label, x + 14, yy + 23);
      }),
    );
    at(20, () => {
      g.font = f(SERIF, 16);
      g.fillStyle = '#000';
      g.fillText(`bpm: ${Math.round(ctx.frame.bpm || 0)} | beat: ${step} | last updated: today`, 24, Math.min(H - 20, 370));
    });
  }

  // ---- Big numbers: BPM, bar, beat and time on a split-flap grid.
  private numbers(ctx: GenContext, H: number): void {
    const g = this.g;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    const secs = ctx.beat * (60 / Math.max(40, ctx.frame.bpm || 120));
    const cells: Array<[string, string, number]> = [
      ['BPM', String(Math.round(ctx.frame.bpm || 0)), 0],
      ['BAR', String(Math.floor(ctx.beat / bpb) + 1).padStart(3, '0'), 1],
      ['BEAT', String((Math.floor(ctx.beat) % bpb) + 1), 2],
      ['TIME', `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`, 3],
    ];
    const cw = W / 2;
    const ch = H / 2;
    cells.forEach(([label, value, i]) => {
      const x = (i % 2) * cw;
      const y = Math.floor(i / 2) * ch;
      g.fillStyle = i === Math.floor(ctx.beat) % 4 ? this.colour(i) : PAPER;
      g.fillRect(x, y, cw, ch);
      g.font = f(MONO, 22);
      g.fillStyle = INK;
      g.fillText(label, x + 24, y + 40);
      // Split-flap: the top half flips down as each beat lands.
      const flip = clamp01((ctx.beat - Math.floor(ctx.beat)) / 0.12);
      g.font = f(GROT, Math.min(ch * 0.62, (cw - 48) / Math.max(2, value.length) * 1.5));
      g.save();
      g.beginPath();
      g.rect(x, y + ch * 0.25, cw, ch * 0.75);
      g.clip();
      g.translate(x + 24, y + ch * 0.85);
      g.scale(1, i === 2 ? 0.4 + 0.6 * flip : 1);
      g.fillText(value, 0, 0);
      g.restore();
      g.fillStyle = INK;
      g.fillRect(x, y + ch * 0.6, cw, 3);
    });
    g.fillStyle = INK;
    g.fillRect(cw - 4, 0, 8, H);
    g.fillRect(0, ch - 4, W, 8);
  }

  // ---- Sticker bomb: stickers slapped down on the kicks, peeled off every phrase.
  private stickers(ctx: GenContext, H: number): void {
    const g = this.g;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    this.dotGrid(H, 'rgba(0,0,0,0.12)');
    const phrase = 32;
    const into = ctx.beat - Math.floor(ctx.beat / phrase) * phrase;
    const seed = Math.floor(ctx.beat / phrase);
    const n = Math.min(40, Math.floor(into * 1.2) + 1);
    const { current } = this.lines(ctx);
    const words = current.words.map((w) => w.text);
    for (let k = 0; k < n; k++) {
      const x = 60 + hash2(seed * 97 + k, 1) * (W - 120);
      const y = 50 + hash2(seed * 97 + k, 2) * (H - 100);
      const r = (hash2(seed * 97 + k, 3) - 0.5) * 0.8;
      const s = 0.7 + hash2(seed * 97 + k, 4) * 0.8;
      const born = k / 1.2;
      const slap = outBack((into - born) / 0.18);
      const kind = Math.floor(hash2(seed * 97 + k, 5) * 5);
      g.save();
      g.translate(x, y);
      g.rotate(r);
      g.scale(s * (0.5 + 0.5 * slap), s * (0.5 + 0.5 * slap));
      this.sticker(kind, this.colour(k + seed), k === n - 1 ? words[k % Math.max(1, words.length)] : undefined);
      g.restore();
    }
  }

  private sticker(kind: number, fill: string, word?: string): void {
    const g = this.g;
    const path = (): void => {
      g.beginPath();
      if (kind === 0) {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const r = i % 2 ? 22 : 50;
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
      } else if (kind === 1) {
        g.moveTo(-50, -14);
        g.lineTo(14, -14);
        g.lineTo(14, -34);
        g.lineTo(54, 0);
        g.lineTo(14, 34);
        g.lineTo(14, 14);
        g.lineTo(-50, 14);
      } else if (kind === 2) {
        g.arc(0, 0, 46, 0, Math.PI * 2);
      } else if (kind === 3) {
        g.moveTo(-10, -50);
        g.lineTo(26, -50);
        g.lineTo(6, -6);
        g.lineTo(30, -6);
        g.lineTo(-20, 52);
        g.lineTo(-4, 6);
        g.lineTo(-28, 6);
      } else {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const r = 40 + 10 * Math.sin(i * 2.7);
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
      }
      g.closePath();
    };
    g.save();
    g.translate(9, 9);
    path();
    g.fillStyle = INK;
    g.fill();
    g.restore();
    path();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = INK;
    g.stroke();
    if (word) {
      g.font = f(GROT, 18);
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.fillText(word.slice(0, 10), 0, 6);
      g.textAlign = 'left';
    }
  }

  // ---- EQ controls: oversized faders that are the real bands, buttons that press on the beat.
  private eq(ctx: GenContext, H: number): void {
    const g = this.g;
    g.fillStyle = this.colour(2);
    g.fillRect(0, 0, W, H);
    const b = ctx.frame.bands32;
    const bands = Array.from({ length: 8 }, (_, i) => {
      let s = 0;
      for (let k = 0; k < 4; k++) s += b?.[i * 4 + k] ?? 0;
      return clamp01((s / 4) * 1.4);
    });
    const pad = 40;
    const tw = (W - pad * 2) / 8;
    const top = 40;
    const bottom = H - 130;
    bands.forEach((v, i) => {
      const x = pad + i * tw + tw / 2;
      g.fillStyle = INK;
      g.fillRect(x - 6, top, 12, bottom - top);
      const ky = bottom - v * (bottom - top);
      this.card(x - tw * 0.32, ky - 18, tw * 0.64, 36, this.colour(i), 7, 4);
      g.fillStyle = INK;
      g.fillRect(x - tw * 0.25, ky - 2, tw * 0.5, 4);
    });
    const beat = Math.floor(ctx.beat);
    for (let i = 0; i < 4; i++) {
      const pressed = beat % 4 === i && ctx.beat - beat < 0.25;
      const x = pad + i * ((W - pad * 2) / 4) + 10;
      const y = H - 100;
      const w = (W - pad * 2) / 4 - 30;
      const off = pressed ? 7 : 0;
      this.card(x + off, y + off, w, 64, pressed ? this.colour(i + 1) : PAPER, 10 - off, 5);
      g.font = f(GROT, 22);
      g.fillStyle = INK;
      g.fillText(['KICK', 'SNARE', 'HAT', 'DROP'][i], x + off + 18, y + off + 42);
    }
  }

  // ---- Data dump: the live analysis as monospace tables, a row inverted on each hit.
  private data(ctx: GenContext, H: number): void {
    const g = this.g;
    g.fillStyle = INK;
    g.fillRect(0, 0, W, H);
    g.font = f(MONO, 15);
    const rowH = 22;
    const rows = Math.ceil(H / rowH) + 1;
    const scroll = (ctx.beat * 4) % 1;
    const base = Math.floor(ctx.beat * 4);
    const b = ctx.frame.bands32;
    for (let r = 0; r < rows; r++) {
      const k = base - r;
      const y = H - (r - scroll) * rowH;
      const hit = hash2(k, 1) < 0.15 + 0.3 * ctx.env.energy;
      if (hit) {
        g.fillStyle = this.colour(k);
        g.fillRect(0, y - rowH + 4, W, rowH);
      }
      g.fillStyle = hit ? INK : '#d8ffd8';
      const vals = [String(k).padStart(6, '0'), (k / 4).toFixed(2).padStart(8, ' '), ...Array.from({ length: 8 }, (_, i) => ((b?.[(i * 4 + k) % 32] ?? 0) * 100 * (0.6 + hash2(k, i) * 0.8)).toFixed(1).padStart(6, ' '))];
      g.fillText(vals.join('  '), 16, y);
    }
    this.card(W - 290, 24, 260, 90, this.colour(Math.floor(ctx.beat)), 10, 5);
    g.font = f(GROT, 40);
    g.fillStyle = INK;
    g.fillText(`${Math.round(ctx.frame.bpm || 0)} BPM`, W - 272, 86);
  }

  // ---- Marquee wall: full-width bands of lyric lines scrolling in alternate directions.
  private marquee(ctx: GenContext, H: number): void {
    const g = this.g;
    const { current, previous } = this.lines(ctx);
    const lines = [current.text, ...previous].filter(Boolean);
    const rows = 6;
    const rh = H / rows;
    for (let r = 0; r < rows; r++) {
      const text = `${lines[r % Math.max(1, lines.length)] ?? ''}  ★  `;
      g.fillStyle = r % 2 ? INK : this.colour(r + Math.floor(ctx.beat / 8));
      g.fillRect(0, r * rh, W, rh);
      g.font = f(GROT, rh * 0.62);
      const tw = Math.max(40, g.measureText(text).width);
      const dir = r % 2 ? 1 : -1;
      const speed = 110 * (r === 0 ? 1.4 : 1) * num(ctx.params.speed, 1);
      const off = (((ctx.time * speed * dir) % tw) + tw) % tw;
      g.fillStyle = r % 2 ? this.colour(r) : INK;
      for (let x = -off; x < W; x += tw) g.fillText(text, x, r * rh + rh * 0.76);
      g.fillStyle = INK;
      g.fillRect(0, r * rh - 2, W, 4);
    }
  }

  // ---- Grid lyrics: words snapped into a 12-column grid, the hero word spanning six.
  private grid(ctx: GenContext, H: number): void {
    const g = this.g;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    const cols = 12;
    const cw = W / cols;
    const rh = H / 6;
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1;
    for (let c = 1; c < cols; c++) {
      g.beginPath();
      g.moveTo(c * cw, 0);
      g.lineTo(c * cw, H);
      g.stroke();
    }
    const { current, index, now } = this.lines(ctx);
    const hero = heroWord(current.text);
    let col = 0;
    let row = 0;
    current.words.forEach((w, i) => {
      const span = i === hero ? 6 : Math.min(6, Math.max(2, Math.ceil(w.text.length / 2)));
      if (col + span > cols) {
        col = 0;
        row += i === hero ? 2 : 1;
      }
      const t = now - w.start;
      const shown = t >= 0;
      const x = col * cw;
      const y = row * rh + 20;
      const h = i === hero ? rh * 2 - 10 : rh - 10;
      if (shown) {
        const snap = outBack(t / 0.18);
        g.save();
        g.translate(x, y + (1 - snap) * -30);
        g.fillStyle = i === hero ? this.colour(index) : i % 3 === 0 ? INK : PAPER;
        g.fillRect(0, 0, span * cw, h);
        g.strokeStyle = INK;
        g.lineWidth = 4;
        g.strokeRect(0, 0, span * cw, h);
        g.font = f(GROT, Math.min(h * 0.7, (span * cw * 1.6) / Math.max(2, w.text.length)));
        g.fillStyle = i % 3 === 0 && i !== hero ? PAPER : INK;
        g.fillText(w.text, 12, h * 0.78, span * cw - 20);
        g.restore();
      }
      col += span;
    });
    g.font = f(MONO, 14);
    g.fillStyle = INK;
    g.fillText(`${String(index).padStart(3, '0')} / ${Math.round(ctx.frame.bpm || 0)} BPM`, 16, H - 16);
  }

  private dotGrid(H: number, colour: string): void {
    const g = this.g;
    g.fillStyle = colour;
    for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) g.fillRect(x - 2, y - 2, 4, 4);
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
