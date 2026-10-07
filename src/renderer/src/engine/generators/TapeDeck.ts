import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import { hash2 } from '../lostMedia';
import { lyricMoment } from '../lyricText';
import { lyricsFeed, songPositionMs } from '../lyricsFeed';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const W = 960;

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform sampler2D uTex;
void main() {
  fragColor = vec4(fromDisplay(texture(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb), 1.0);
}
`;

/** 5×7 dot-matrix glyphs (rows top to bottom, 5 bits each), like a display controller's character ROM. */
const DOTS: Record<string, number[]> = {
  A: [14, 17, 17, 17, 31, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 12, 4, 8], "'": [12, 4, 8, 0, 0, 0, 0], '’': [12, 4, 8, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0],
  ':': [0, 12, 12, 0, 12, 12, 0], '/': [0, 1, 2, 4, 8, 16, 0], '&': [12, 18, 20, 8, 21, 18, 13], '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8], '"': [10, 10, 10, 0, 0, 0, 0], '♪': [4, 6, 5, 4, 12, 28, 24], '>': [8, 12, 14, 15, 14, 12, 8],
};

const COLS = 22;
const VFD = '#46f2df';

/**
 * A late-80s double cassette deck, dubbing: the mix tape's reels turning in
 * deck A with the tape pack moving across as the song plays, deck B recording,
 * needle VU meters with peak lights, and a cyan dot-matrix fluorescent display
 * typing the lyrics out as they are sung over a spectrum analyser.
 */
export class TapeDeck extends ShaderGenerator {
  readonly kind = 'tapeDeck';
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly glyphs = new Map<string, number[]>();
  /** Hub angles: deck A supply/take-up, deck B supply/take-up. */
  private hubs = [0, 0, 0, 0];
  private vu = [0, 0];
  private peakLed = [0, 0];
  private peaks = new Float32Array(16);

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

  /** A character's dot rows; anything outside the ROM (other alphabets) is rasterised to 5×7. */
  private glyph(ch: string): number[] {
    const known = DOTS[ch] ?? DOTS[ch.toUpperCase()];
    if (known) return known;
    const hit = this.glyphs.get(ch);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 14;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.font = 'bold 13px Consolas, "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillText(ch, 5, 12.5);
    const d = g.getImageData(0, 0, 10, 14).data;
    const rows: number[] = [];
    for (let y = 0; y < 7; y++) {
      let bits = 0;
      for (let x = 0; x < 5; x++) {
        let a = 0;
        for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) a += d[((y * 2 + yy) * 10 + x * 2 + xx) * 4 + 3];
        if (a > 300) bits |= 16 >> x;
      }
      rows.push(bits);
    }
    this.glyphs.set(ch, rows);
    return rows;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const H = Math.max(300, Math.round((W * ctx.height) / Math.max(1, ctx.width)));
    if (this.canvas.height !== H) this.canvas.height = H;
    const g = this.g;
    const p = ctx.params;
    const react = num(p.react, 1);
    const black = String(p.finish ?? 'black') === 'black';
    const dt = Math.min(0.1, Math.max(0, ctx.dt));

    // Levels: needle ballistics (slow rise, slower fall), peak lights on hot transients.
    const b = ctx.frame.bands32;
    const avg = (a: number, z: number): number => {
      let s = 0;
      for (let k = a; k < z; k++) s += b[k] ?? 0;
      return s / Math.max(1, z - a);
    };
    const target = [Math.min(1.1, (avg(0, 18) * 1.1 + ctx.env.kick * 0.25) * react), Math.min(1.1, (avg(6, 32) * 1.25 + ctx.env.snare * 0.2) * react)];
    for (let k = 0; k < 2; k++) {
      const up = target[k] > this.vu[k];
      this.vu[k] += (target[k] - this.vu[k]) * Math.min(1, dt * (up ? 14 : 4));
      this.peakLed[k] = target[k] > 0.92 ? 1 : Math.max(0, this.peakLed[k] - dt * 3);
    }

    // Faceplate.
    g.fillStyle = black ? '#141416' : '#b9bbbf';
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 2) {
      g.fillStyle = black ? `rgba(255,255,255,${0.012 + 0.02 * hash2(y, 9)})` : `rgba(0,0,0,${0.03 + 0.05 * hash2(y, 9)})`;
      g.fillRect(0, y, W, 1);
    }
    const ink = black ? '#c8ccd2' : '#1c1c20';
    const sub = black ? '#7c8088' : '#4a4c52';

    // Top band: VU meters either side of the display.
    const top = H * 0.05;
    const bandH = H * 0.33;
    this.meter(g, 24, top, 190, bandH, this.vu[0], this.peakLed[0], 'L', black);
    this.meter(g, W - 214, top, 190, bandH, this.vu[1], this.peakLed[1], 'R', black);
    this.display(ctx, g, 232, top, W - 464, bandH);

    // The two cassette wells.
    const wy = top + bandH + H * 0.05;
    const wh = H * 0.42;
    const pos = lyricsFeed.now.connected && lyricsFeed.now.durationMs > 0 ? songPositionMs(Date.now()) / lyricsFeed.now.durationMs : (ctx.time / 210) % 1;
    const prog = Math.min(1, Math.max(0, pos));
    const speed = num(p.speed, 1) * (1 + ctx.env.drop * 0.5);
    // Constant tape speed: a hub turns faster the less tape it carries.
    const rMin = 0.1;
    const rMax = 0.34;
    const supply = rMin + (rMax - rMin) * Math.sqrt(1 - prog);
    const take = rMin + (rMax - rMin) * Math.sqrt(prog);
    const dub = String(p.deckB ?? 'dub') === 'dub' ? 1 : 0;
    const radii = [supply, take, rMax * 0.98, rMin * 1.02];
    for (let k = 0; k < 4; k++) this.hubs[k] -= dt * speed * 0.5 * (k < 2 ? 1 : dub) / radii[k];
    const title = String(p.label ?? '') || lyricsFeed.now.title || '';
    this.well(g, 24, wy, W / 2 - 40, wh, 'A', title, [supply, take], [this.hubs[0], this.hubs[1]], black, ctx);
    this.well(g, W / 2 + 16, wy, W / 2 - 40, wh, 'B', String(p.labelB ?? 'BLANK C90'), [radii[2], radii[3]], [this.hubs[2], this.hubs[3]], black, ctx);

    // Transport keys and labels.
    const ky = wy + wh + H * 0.03;
    const kh = Math.max(20, H - ky - H * 0.04);
    const keys = ['◀◀', '▶', '■', '▶▶', '❚❚', '●'];
    for (let deck = 0; deck < 2; deck++) {
      const x0 = deck === 0 ? 24 : W / 2 + 16;
      const kw = (W / 2 - 40) / keys.length;
      keys.forEach((k, ki) => {
        const down = (deck === 0 && ki === 1) || (deck === 1 && (ki === 5 || (ki === 1 && String(p.deckB ?? 'dub') === 'dub')));
        const x = x0 + ki * kw + 3;
        g.fillStyle = black ? (down ? '#2a2b30' : '#3a3c42') : down ? '#9a9ca2' : '#d6d8dc';
        g.fillRect(x, ky + (down ? 3 : 0), kw - 6, kh - 3);
        g.fillStyle = black ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.25)';
        g.fillRect(x, ky + kh - (down ? 0 : 3), kw - 6, down ? 0 : 3);
        g.fillStyle = ki === 5 ? '#d8352a' : ink;
        g.font = `bold ${Math.round(Math.min(18, kh * 0.45))}px Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(k, x + (kw - 6) / 2, ky + kh / 2 + (down ? 3 : 0));
      });
    }
    g.fillStyle = sub;
    g.font = 'bold 11px Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText('STEREO DOUBLE CASSETTE DECK', 24, H - 8);
    g.textAlign = 'right';
    g.fillText('HIGH SPEED DUBBING  ·  AUTO REVERSE', W - 24, H - 8);
    this.tex.needsUpdate = true;
  }

  /** An analogue VU meter: cream face, red zone, needle, peak light. */
  private meter(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, peak: number, ch: string, black: boolean): void {
    g.fillStyle = black ? '#050506' : '#2a2a2e';
    g.fillRect(x - 4, y - 4, w + 8, h + 8);
    const face = g.createLinearGradient(0, y, 0, y + h);
    face.addColorStop(0, '#f6e7b8');
    face.addColorStop(1, '#e2c784');
    g.fillStyle = face;
    g.fillRect(x, y, w, h);
    const cx = x + w / 2;
    const cy = y + h * 1.05;
    const R = h * 0.82;
    // Scale: −20 … +3 dB, red from 0.
    const ang = (t: number): number => -Math.PI / 2 + (t - 0.5) * 1.6;
    g.lineWidth = 2;
    g.strokeStyle = '#222';
    g.beginPath();
    g.arc(cx, cy, R, ang(0), ang(0.72));
    g.stroke();
    g.strokeStyle = '#c82418';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, cy, R, ang(0.72), ang(1));
    g.stroke();
    g.font = 'bold 10px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['20', '10', '7', '5', '3', '0', '+3'].forEach((s, k) => {
      const t = [0, 0.25, 0.4, 0.52, 0.62, 0.72, 1][k];
      const a = ang(t);
      g.strokeStyle = t >= 0.72 ? '#c82418' : '#222';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.lineTo(cx + Math.cos(a) * (R + 8), cy + Math.sin(a) * (R + 8));
      g.stroke();
      g.fillStyle = t >= 0.72 ? '#c82418' : '#222';
      g.fillText(s, cx + Math.cos(a) * (R + 17), cy + Math.sin(a) * (R + 17));
    });
    g.fillStyle = '#222';
    g.font = 'bold 15px Georgia, serif';
    g.fillText('VU', cx, y + h * 0.62);
    g.font = 'bold 11px Arial, sans-serif';
    g.fillText(ch, x + 14, y + h - 12);
    // Needle.
    const a = ang(Math.min(1.08, Math.max(-0.04, v)));
    g.strokeStyle = '#111';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10));
    g.stroke();
    // Lamp glow from below and the peak light.
    const lamp = g.createRadialGradient(cx, y + h, 0, cx, y + h, h);
    lamp.addColorStop(0, 'rgba(255,190,90,0.35)');
    lamp.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = lamp;
    g.fillRect(x, y, w, h);
    g.fillStyle = peak > 0.05 ? `rgba(255,${40 + 40 * (1 - peak)},30,${0.4 + 0.6 * peak})` : '#3a0c0a';
    g.beginPath();
    g.arc(x + w - 16, y + h - 14, 5, 0, Math.PI * 2);
    g.fill();
    if (peak > 0.05) {
      g.fillStyle = `rgba(255,60,40,${0.25 * peak})`;
      g.beginPath();
      g.arc(x + w - 16, y + h - 14, 12, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#222';
    g.font = 'bold 8px Arial, sans-serif';
    g.fillText('PEAK', x + w - 16, y + h - 26);
  }

  /** The fluorescent display: counter, mode lamps, the lyric typed out in dots, and a spectrum. */
  private display(ctx: GenContext, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    g.fillStyle = '#020405';
    g.fillRect(x - 4, y - 4, w + 8, h + 8);
    g.fillStyle = '#04100f';
    g.fillRect(x, y, w, h);
    const m = lyricMoment(ctx);
    const dot = Math.min((w - 20) / (COLS * 6), (h * 0.5) / 17);
    // Wrap the line into rows; show the pair with the current sung word.
    const rows: Array<{ text: string; from: number }> = [];
    let row = '';
    let from = 0;
    let at = 0;
    for (const word of m.current.text.split(/\s+/).filter(Boolean)) {
      const next = row ? `${row} ${word}` : word;
      if (row && next.length > COLS) {
        rows.push({ text: row, from });
        from = at;
        row = word;
      } else row = next;
      at += word.length + 1;
    }
    rows.push({ text: row.slice(0, COLS), from });
    // How many characters have been sung: words appear as they start, letters typing across the word.
    const words = m.current.words;
    let typed = 0;
    let off = 0;
    for (let k = 0; k < words.length; k++) {
      const s = words[k].start;
      const e = words[k + 1]?.start ?? m.current.end;
      const len = words[k].text.length;
      if (m.now >= s) typed = off + Math.min(len, Math.ceil(((m.now - s) / Math.max(0.05, Math.min(0.5, e - s))) * len));
      off += len + 1;
    }
    if (!words.length) typed = m.current.text.length;
    let rowIdx = 0;
    for (let k = 0; k < rows.length; k++) if (typed > rows[k].from) rowIdx = k;
    const pair = rows.slice(Math.max(0, rowIdx - 1), Math.max(0, rowIdx - 1) + 2);
    const tx = x + (w - COLS * 6 * dot) / 2;
    const ty = y + h * 0.1;
    for (let r = 0; r < 2; r++) {
      const rw = pair[r];
      for (let c = 0; c < COLS; c++) {
        const ch = rw && c < rw.text.length ? rw.text[c] : ' ';
        const lit = !!rw && rw.from + c < typed;
        this.cell(g, tx + c * 6 * dot, ty + r * 9 * dot, dot, lit ? this.glyph(ch) : DOTS[' '], VFD);
      }
    }
    // Counter, mode lamps.
    const ly = ty + 18 * dot + 4;
    const pos = lyricsFeed.now.connected ? songPositionMs(Date.now()) / 1000 : ctx.time;
    const counter = String(Math.floor(pos * 1.6) % 10000).padStart(4, '0');
    const small = Math.max(1.4, dot * 0.55);
    for (let k = 0; k < 4; k++) this.cell(g, x + 12 + k * 6 * small, ly + 2, small, this.glyph(counter[k]), VFD);
    g.font = `bold ${Math.round(Math.max(9, h * 0.065))}px Arial, sans-serif`;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    const lamps: Array<[string, boolean, string]> = [
      ['PLAY ▶', true, VFD],
      ['REC ●', String(ctx.params.deckB ?? 'dub') === 'dub', '#ff6a3a'],
      ['NR B', true, VFD],
      ['CrO2', true, VFD],
      ['METAL', false, VFD],
      ['DUB', ctx.env.drop > 0.3 || Math.floor(ctx.beat) % 8 < 4, '#ffb03a'],
    ];
    let lx = x + 12 + 4 * 6 * small + 14;
    for (const [s, on, col] of lamps) {
      g.fillStyle = on ? col : 'rgba(70,242,223,0.08)';
      g.fillText(s, lx, ly);
      lx += g.measureText(s).width + 12;
    }
    // Spectrum: 16 bars of segments, peak hold dots.
    const sy = ly + h * 0.12;
    const sh = y + h - 8 - sy;
    if (sh > 12) {
      const segs = 10;
      const bw = (w - 24) / 16;
      const b = ctx.frame.bands32;
      const dt = Math.min(0.1, Math.max(0, ctx.dt));
      for (let k = 0; k < 16; k++) {
        const v = Math.min(1, ((b[k * 2] ?? 0) + (b[k * 2 + 1] ?? 0)) * 0.55 * num(ctx.params.react, 1));
        this.peaks[k] = v >= this.peaks[k] ? v : Math.max(0, this.peaks[k] - dt * 0.6);
        const lit = Math.round(v * segs);
        const pk = Math.min(segs - 1, Math.round(this.peaks[k] * segs));
        for (let s = 0; s < segs; s++) {
          const on = s < lit || s === pk;
          g.fillStyle = on ? (s >= segs - 2 ? '#ff6a3a' : VFD) : 'rgba(70,242,223,0.07)';
          g.fillRect(x + 12 + k * bw, sy + sh - (s + 1) * (sh / segs) + 1, bw - 4, sh / segs - 2);
        }
      }
    }
    // Glass: a faint glow over everything lit, and a reflection.
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(70,242,223,0.035)';
    g.fillRect(x, y, w, h);
    g.restore();
    const glare = g.createLinearGradient(x, y, x + w * 0.4, y + h);
    glare.addColorStop(0, 'rgba(255,255,255,0.07)');
    glare.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = glare;
    g.fillRect(x, y, w, h);
  }

  /** One 5×7 character cell: unlit dots faintly visible, lit dots glowing. */
  private cell(g: CanvasRenderingContext2D, x: number, y: number, d: number, rows: number[], col: string): void {
    const r = d * 0.36;
    for (let yy = 0; yy < 7; yy++) {
      const bits = rows[yy] ?? 0;
      for (let xx = 0; xx < 5; xx++) {
        const on = (bits & (16 >> xx)) !== 0;
        const cx = x + xx * d + d / 2;
        const cy = y + yy * d + d / 2;
        if (on) {
          g.fillStyle = 'rgba(70,242,223,0.18)';
          g.fillRect(cx - d * 0.55, cy - d * 0.55, d * 1.1, d * 1.1);
          g.fillStyle = col;
        } else g.fillStyle = 'rgba(70,242,223,0.06)';
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }

  /** A cassette well: smoked door, the tape inside with its label and turning hubs. */
  private well(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, side: string, title: string, packs: number[], angles: number[], black: boolean, ctx: GenContext): void {
    g.fillStyle = black ? '#050506' : '#3a3c40';
    g.fillRect(x - 4, y - 4, w + 8, h + 8);
    g.fillStyle = '#0c0c0e';
    g.fillRect(x, y, w, h);
    // The cassette, slightly smaller than the well.
    const cw = Math.min(w * 0.86, h * 1.55);
    const ch = cw * 0.62;
    const cx = x + w / 2;
    const cy = y + h / 2 + 4;
    const left = cx - cw / 2;
    const tp = cy - ch / 2;
    g.fillStyle = '#2b2c30';
    g.fillRect(left, tp, cw, ch);
    // Label.
    const lab = ['#f3ecd8', '#f5d84a', '#e8e8e8', '#f2b0c6'][Math.floor(hash2(title.length, side === 'A' ? 1 : 2) * 4)];
    g.fillStyle = lab;
    g.fillRect(left + cw * 0.06, tp + ch * 0.07, cw * 0.88, ch * 0.66);
    g.fillStyle = side === 'A' ? '#d84a2a' : '#2a6ad8';
    g.fillRect(left + cw * 0.06, tp + ch * 0.07 + ch * 0.235, cw * 0.88, ch * 0.03);
    g.fillStyle = '#222';
    g.font = `bold ${Math.round(ch * 0.1)}px Arial, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(side, left + cw * 0.09, tp + ch * 0.15);
    g.textAlign = 'right';
    g.font = `bold ${Math.round(ch * 0.07)}px Arial, sans-serif`;
    g.fillText('C90 · TYPE II', left + cw * 0.91, tp + ch * 0.15);
    g.textAlign = 'center';
    g.fillStyle = '#1a2a8a';
    g.font = `700 ${Math.round(ch * 0.11)}px "Segoe Print", "Comic Sans MS", "Bradley Hand", cursive`;
    g.fillText(title.slice(0, 26), cx, tp + ch * 0.235, cw * 0.62);
    // Window with the tape packs and hubs.
    const hubDx = cw * 0.25;
    const hy = tp + ch * 0.46;
    const ww = cw * 0.66;
    const wh2 = ch * 0.24;
    g.save();
    g.beginPath();
    g.rect(cx - ww / 2, hy - wh2 / 2, ww, wh2);
    g.arc(cx - hubDx, hy, ch * 0.13, 0, Math.PI * 2);
    g.moveTo(cx + hubDx + ch * 0.13, hy);
    g.arc(cx + hubDx, hy, ch * 0.13, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#16120f';
    g.fillRect(left, tp, cw, ch);
    const rMin = ch * 0.1;
    const pack = (px: number, r: number): void => {
      const gr = g.createRadialGradient(px, hy, rMin * 0.8, px, hy, r);
      gr.addColorStop(0, '#4a2a18');
      gr.addColorStop(1, '#6a3e22');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(px, hy, r, 0, Math.PI * 2);
      g.fill();
    };
    // Hubs: packs of tape, then white rings with six teeth, turning.
    for (let h = 0; h < 2; h++) {
      const hx = cx + (h === 0 ? -hubDx : hubDx);
      pack(hx, packs[h] * ch);
      g.fillStyle = '#eeeae0';
      g.beginPath();
      g.arc(hx, hy, rMin * 0.9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#16120f';
      g.beginPath();
      g.arc(hx, hy, rMin * 0.55, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#eeeae0';
      for (let k = 0; k < 6; k++) {
        g.save();
        g.translate(hx, hy);
        g.rotate(angles[h] + (k * Math.PI) / 3);
        g.fillRect(rMin * 0.3, -rMin * 0.09, rMin * 0.3, rMin * 0.18);
        g.restore();
      }
    }
    g.restore();
    // Window frame.
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 2;
    g.strokeRect(cx - ww / 2, hy - wh2 / 2, ww, wh2);
    // Bottom trapezoid with the screw holes.
    g.fillStyle = '#232428';
    g.beginPath();
    g.moveTo(left + cw * 0.18, tp + ch);
    g.lineTo(left + cw * 0.24, tp + ch * 0.8);
    g.lineTo(left + cw * 0.76, tp + ch * 0.8);
    g.lineTo(left + cw * 0.82, tp + ch);
    g.fill();
    g.fillStyle = '#0c0c0e';
    for (const fx of [0.3, 0.42, 0.58, 0.7]) {
      g.beginPath();
      g.arc(left + cw * fx, tp + ch * 0.9, ch * 0.025, 0, Math.PI * 2);
      g.fill();
    }
    // Smoked door with glare; a red record light on deck B.
    g.fillStyle = 'rgba(20,24,34,0.32)';
    g.fillRect(x, y, w, h);
    const glare = g.createLinearGradient(x, y, x + w, y + h);
    glare.addColorStop(0, 'rgba(255,255,255,0.1)');
    glare.addColorStop(0.35, 'rgba(255,255,255,0.02)');
    glare.addColorStop(0.36, 'rgba(255,255,255,0)');
    g.fillStyle = glare;
    g.fillRect(x, y, w, h);
    g.fillStyle = black ? '#9a9ea6' : '#e6e8ec';
    g.font = 'bold 12px Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(side === 'A' ? 'DECK A  · PLAY' : 'DECK B  · PLAY / REC', x + 8, y + 6);
    if (side === 'B' && String(ctx.params.deckB ?? 'dub') === 'dub') {
      g.fillStyle = Math.floor(ctx.beat * 2) % 2 === 0 || ctx.env.drop > 0.3 ? '#ff3a2a' : '#5a1410';
      g.beginPath();
      g.arc(x + w - 16, y + 12, 5, 0, Math.PI * 2);
      g.fill();
    }
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
