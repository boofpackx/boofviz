import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import { liveText, lyricsFeed, type TextSource } from '../lyricsFeed';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * 8-bit home computers loading from cassette, drawn at the machine's own
 * resolution and colours and shown with sharp pixels.
 *
 * - micro48: the British rubber-keyed 48K micro. LOAD "", red and cyan pilot
 *   stripes, blue and yellow data stripes that come from the music itself
 *   (the colour flips on each zero crossing of the waveform, like the tape
 *   signal), then the loading screen arriving in the machine's odd memory
 *   order, a third of the screen at a time, a line of every character row at
 *   once, before the colours flood in. The album cover (or a loading screen
 *   made from the song name) is converted with real attribute clash: two
 *   colours per 8×8 cell. Now and then: "Tape loading error".
 * - micro64: the American 64K breadbox. The blue boot screen, LOAD, PRESS
 *   PLAY ON TAPE, FOUND, a turbo loader's raster stripes in the border while
 *   the picture loads in multicolour (four colours per 4×8 cell), then the
 *   first program everyone typed: 10 PRINT the lyric, 20 GOTO 10 — or the
 *   one-line diagonal maze.
 */

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uSoft;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 px = 1.0 / uSize;
  vec3 c = texture(uTex, uv).rgb;
  // Composite video smears a little sideways.
  vec3 l = texture(uTex, uv - vec2(px.x, 0.0)).rgb;
  vec3 r = texture(uTex, uv + vec2(px.x, 0.0)).rgb;
  c = mix(c, (l + c * 2.0 + r) * 0.25, uSoft);
  fragColor = vec4(fromDisplay(c), 1.0);
}
`;

/** Public-domain 8×8 font, characters 0x20–0x5F, one byte per row, bit 0 = leftmost pixel. */
const FONT = [
  '0000000000000000', '183c3c1818001800', '3636000000000000', '36367f367f363600', '0c3e031e301f0c00', '006333180c666300', '1c361c6e3b336e00', '0606030000000000',
  '180c0606060c1800', '060c1818180c0600', '00663cff3c660000', '000c0c3f0c0c0000', '00000000000c0c06', '0000003f00000000', '00000000000c0c00', '6030180c06030100',
  '3e63737b6f673e00', '0c0e0c0c0c0c3f00', '1e33301c06333f00', '1e33301c30331e00', '383c36337f307800', '3f031f3030331e00', '1c06031f33331e00', '3f3330180c0c0c00',
  '1e33331e33331e00', '1e33333e30180e00', '000c0c00000c0c00', '000c0c00000c0c06', '180c0603060c1800', '00003f00003f0000', '060c1830180c0600', '1e3330180c000c00',
  '3e637b7b7b031e00', '0c1e33333f333300', '3f66663e66663f00', '3c66030303663c00', '1f36666666361f00', '7f46161e16467f00', '7f46161e16060f00', '3c66030373667c00',
  '3333333f33333300', '1e0c0c0c0c0c1e00', '7830303033331e00', '6766361e36666700', '0f06060646667f00', '63777f7f6b636300', '63676f7b73636300', '1c36636363361c00',
  '3f66663e06060f00', '1e3333333b1e3800', '3f66663e36666700', '1e33070e38331e00', '3f2d0c0c0c0c1e00', '3333333333333f00', '33333333331e0c00', '6363636b7f776300',
  '6363361c1c366300', '3333331e0c0c1e00', '7f6331184c667f00', '1e06060606061e00', '03060c1830604000', '1e18181818181e00', '081c366300000000', '00000000000000ff',
].map((h) => Array.from({ length: 8 }, (_, k) => parseInt(h.slice(k * 2, k * 2 + 2), 16)));

/** The maze's two diagonals: two pixels thick and corner to corner, so neighbours join up. */
const DOWN = [0x03, 0x06, 0x0c, 0x18, 0x30, 0x60, 0xc0, 0x80];
const UP = [0xc0, 0x60, 0x30, 0x18, 0x0c, 0x06, 0x03, 0x01];

function glyph(ch: string): number[] {
  if (ch === '╲') return DOWN;
  if (ch === '╱') return UP;
  let c = ch.toUpperCase().charCodeAt(0);
  if (Number.isNaN(c) || c < 0x20 || c > 0x5f) c = 0x20;
  return FONT[c - 0x20];
}

const rgb = (r: number, g: number, b: number): number => (255 << 24) | (b << 16) | (g << 8) | r;
const hexc = (h: number): number => rgb((h >> 16) & 255, (h >> 8) & 255, h & 255);

/** The 48K micro's 8 colours, normal and bright. */
const ZX: number[][] = [
  [0, 0, 0], [0, 0, 215], [215, 0, 0], [215, 0, 215], [0, 215, 0], [0, 215, 215], [215, 215, 0], [215, 215, 215],
  [0, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 255], [0, 255, 0], [0, 255, 255], [255, 255, 0], [255, 255, 255],
];
const ZXC = ZX.map(([r, g, b]) => rgb(r, g, b));

/** The 64K breadbox's 16 colours (a measured palette). */
const C64H = [0x000000, 0xffffff, 0x68372b, 0x70a4b2, 0x6f3d86, 0x588d43, 0x352879, 0xb8c76f, 0x6f4f25, 0x433900, 0x9a6759, 0x444444, 0x6c6c6c, 0x9ad284, 0x6c5eb5, 0x959595];
const C64 = C64H.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
const C64C = C64H.map(hexc);
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A 256×192 picture with attribute clash: one bit per pixel, ink/paper/bright per 8×8 cell. */
interface ZxPicture { bits: Uint8Array; ink: Uint8Array; paper: Uint8Array }
/** A 160×200 multicolour picture (fat pixels), one palette index per pixel. */
interface MultiPicture { px: Uint8Array }

function toZx(rgba: Uint8ClampedArray): ZxPicture {
  const bits = new Uint8Array(256 * 192), ink = new Uint8Array(768), paper = new Uint8Array(768);
  for (let cy = 0; cy < 24; cy++) {
    for (let cx = 0; cx < 32; cx++) {
      let best = Infinity, bi = 0, bp = 7;
      for (let bright = 0; bright < 2; bright++) {
        for (let i = 0; i < 8; i++) {
          for (let p = i; p < 8; p++) {
            const ci = ZX[i + bright * 8], cp = ZX[p + bright * 8];
            let err = 0;
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const o = ((cy * 8 + y) * 256 + cx * 8 + x) * 4;
                const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
                const ei = (r - ci[0]) ** 2 + (g - ci[1]) ** 2 + (b - ci[2]) ** 2;
                const ep = (r - cp[0]) ** 2 + (g - cp[1]) ** 2 + (b - cp[2]) ** 2;
                err += Math.min(ei, ep);
              }
            }
            if (err < best) {
              best = err;
              bi = i + bright * 8;
              bp = p + bright * 8;
            }
          }
        }
      }
      const c = cy * 32 + cx;
      ink[c] = bi;
      paper[c] = bp;
      const ci = ZX[bi], cp = ZX[bp];
      // Ordered dither along the ink–paper line, so gradients survive the two colours.
      const ax = cp[0] - ci[0], ay = cp[1] - ci[1], az = cp[2] - ci[2];
      const len2 = ax * ax + ay * ay + az * az || 1;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const X = cx * 8 + x, Y = cy * 8 + y;
          const o = (Y * 256 + X) * 4;
          const t = ((rgba[o] - ci[0]) * ax + (rgba[o + 1] - ci[1]) * ay + (rgba[o + 2] - ci[2]) * az) / len2;
          bits[Y * 256 + X] = t < (BAYER4[(Y & 3) * 4 + (X & 3)] + 0.5) / 16 ? 1 : 0;
        }
      }
    }
  }
  return { bits, ink, paper };
}

function nearest64(r: number, g: number, b: number, allowed?: number[]): number {
  let best = Infinity, bi = 0;
  const list = allowed ?? C64.map((_, i) => i);
  for (const i of list) {
    const c = C64[i];
    const e = (r - c[0]) ** 2 * 0.3 + (g - c[1]) ** 2 * 0.59 + (b - c[2]) ** 2 * 0.11;
    if (e < best) {
      best = e;
      bi = i;
    }
  }
  return bi;
}

function toMulticolour(rgba: Uint8ClampedArray, bg: number): MultiPicture {
  const px = new Uint8Array(160 * 200);
  const tmp = new Uint8Array(32);
  for (let cy = 0; cy < 25; cy++) {
    for (let cx = 0; cx < 40; cx++) {
      const count = new Array(16).fill(0);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 4; x++) {
          const X = cx * 4 + x, Y = cy * 8 + y;
          const o = (Y * 160 + X) * 4;
          const d = (BAYER4[(Y & 3) * 4 + (X & 3)] / 16 - 0.5) * 48;
          const i = nearest64(rgba[o] + d, rgba[o + 1] + d, rgba[o + 2] + d);
          tmp[y * 4 + x] = i;
          count[i]++;
        }
      }
      // Background plus the three commonest colours in the cell.
      count[bg] = -1;
      const top = count.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter((a) => a[0] > 0).map((a) => a[1]);
      const allowed = [bg, ...top];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 4; x++) {
          const i = tmp[y * 4 + x];
          const c = C64[i];
          px[(cy * 8 + y) * 160 + cx * 4 + x] = allowed.includes(i) ? i : nearest64(c[0], c[1], c[2], allowed);
        }
      }
    }
  }
  return { px };
}

/** Load an image (data URL) into a w×h RGBA buffer, cover-fitted into a box, on a background. */
function drawInto(img: HTMLImageElement, w: number, h: number, box: [number, number, number, number], bg: string, after?: (g: CanvasRenderingContext2D) => void): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.drawImage(img, box[0], box[1], box[2], box[3]);
  after?.(g);
  return g.getImageData(0, 0, w, h).data;
}

/** A loading screen made from the song's name: a night skyline, a moon, the stripes and the title. */
function titleScreen(w: number, h: number, title: string, artist: string, seed: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0000d7';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#000000';
  g.fillRect(0, h * 0.62, w, h);
  // Stars and a moon.
  g.fillStyle = '#ffffff';
  for (let k = 0; k < 40; k++) g.fillRect(Math.floor(hash01(k, seed) * w), Math.floor(hash01(k, seed + 1) * h * 0.55), 1, 1);
  g.fillStyle = '#ffff00';
  g.beginPath();
  g.arc(w * 0.8, h * 0.18, h * 0.08, 0, Math.PI * 2);
  g.fill();
  // Skyline with lit windows.
  let x = 0;
  for (let k = 0; x < w; k++) {
    const bw = 16 + Math.floor(hash01(k, seed + 2) * 4) * 8, bh = h * (0.18 + hash01(k, seed + 3) * 0.32);
    g.fillStyle = '#000000';
    g.fillRect(x, h * 0.62 - bh, bw, bh);
    g.fillStyle = hash01(k, seed + 4) < 0.5 ? '#d7d700' : '#00d7d7';
    for (let wy = h * 0.62 - bh + 4; wy < h * 0.6; wy += 8) for (let wx = x + 3; wx < x + bw - 3; wx += 6) if (hash01(wx * 31 + wy, seed + 5) < 0.45) g.fillRect(wx, wy, 2, 3);
    x += bw;
  }
  // The four rainbow stripes in the corner.
  const cols = ['#ff0000', '#ffff00', '#00ff00', '#00ffff'];
  cols.forEach((col, k) => {
    g.fillStyle = col;
    g.beginPath();
    const x0 = w - 64 + k * 12;
    g.moveTo(x0, h);
    g.lineTo(x0 + 12, h);
    g.lineTo(x0 + 12 + 40, h - 40);
    g.lineTo(x0 + 40, h - 40);
    g.fill();
  });
  // Title in big blocky letters, the artist under it.
  const big = (s: string, y: number, scale: number, col: string): void => {
    const t = s.toUpperCase().slice(0, Math.floor(w / (8 * scale)));
    const x0 = Math.floor((w - t.length * 8 * scale) / 2);
    g.fillStyle = col;
    for (let i = 0; i < t.length; i++) {
      const gl = glyph(t[i]);
      for (let r = 0; r < 8; r++) for (let b = 0; b < 8; b++) if (gl[r] & (1 << b)) g.fillRect(x0 + (i * 8 + b) * scale, y + r * scale, scale, scale);
    }
  };
  big(title || 'NOW PLAYING', Math.floor(h * 0.68), title.length > 10 ? 2 : 3, '#ffffff');
  if (artist) big(artist, Math.floor(h * 0.86), 1, '#00ffff');
  return g.getImageData(0, 0, w, h).data;
}

/** Packed pixels with the drawing helpers the machines need. */
class Pixels {
  data: Uint32Array;
  constructor(public w: number, public h: number) {
    this.data = new Uint32Array(w * h);
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
    for (let Y = y0; Y < y1; Y++) this.data.fill(c, Y * this.w + x0, Y * this.w + x1);
  }

  text(x: number, y: number, s: string, ink: number, paper?: number): void {
    for (let i = 0; i < s.length; i++) {
      const gl = glyph(s[i]);
      for (let r = 0; r < 8; r++) {
        const Y = y + r;
        if (Y < 0 || Y >= this.h) continue;
        for (let b = 0; b < 8; b++) {
          const X = x + i * 8 + b;
          if (X < 0 || X >= this.w) continue;
          if (gl[r] & (1 << b)) this.data[Y * this.w + X] = ink;
          else if (paper !== undefined) this.data[Y * this.w + X] = paper;
        }
      }
    }
  }
}

export class Loader8 extends ShaderGenerator {
  readonly kind = 'loader8';
  private px = new Pixels(16, 16);
  private tex: THREE.DataTexture;
  private zx: { key: string; pic: ZxPicture | null } = { key: '', pic: null };
  private multi: { key: string; pic: MultiPicture | null } = { key: '', pic: null };
  private loading = '';
  // The 64's screen while a program runs.
  private rows: string[] = [];
  private printed = 0;
  private runCycle = -1;
  private lastProg = 0;
  private textColour = 14;

  constructor() {
    const tex = Loader8.texture(16, 16, new Uint8Array(16 * 16 * 4));
    super(FRAG, { uTex: { value: tex }, uSize: { value: new THREE.Vector2(16, 16) }, uSoft: { value: 0.5 } });
    this.tex = tex;
  }

  private static texture(w: number, h: number, data: Uint8Array): THREE.DataTexture {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const machine = String(p.machine ?? 'micro48');
    const LH = machine === 'micro64' ? 250 : 240;
    const LW = Math.max(LH, Math.round((LH * ctx.width) / Math.max(1, ctx.height)));
    if (this.px.w !== LW || this.px.h !== LH) {
      this.px = new Pixels(LW, LH);
      this.tex.dispose();
      this.tex = Loader8.texture(LW, LH, new Uint8Array(this.px.data.buffer));
      this.u.uTex.value = this.tex;
      (this.u.uSize.value as THREE.Vector2).set(LW, LH);
    }
    this.u.uSoft.value = num(p.soft, 0.5);
    if (machine === 'micro64') this.draw64(ctx);
    else this.draw48(ctx);
    this.tex.needsUpdate = true;
  }

  /** Song name and artist, or the look's own text. */
  private names(ctx: GenContext): [string, string] {
    const p = ctx.params;
    const own = String(p.text ?? '').trim();
    const { now } = lyricsFeed;
    if (String(p.source ?? 'lyrics') === 'text' && own) return [own, ''];
    if (now.connected && now.trackId) return [now.title, now.artists.join(', ')];
    return [own || 'BOOFVIZ', ''];
  }

  private lyric(ctx: GenContext): string {
    const p = ctx.params;
    const src = String(p.source ?? 'lyrics') as TextSource;
    const live = liveText(src, Date.now());
    if (live.kind === 'text') return String(p.text ?? '').trim() || 'HELLO';
    if (live.kind === 'title') return live.lines[0] ?? 'HELLO';
    return (live.lines[live.current] ?? '').replace(/♪/g, '').trim() || this.names(ctx)[0];
  }

  /** Decode the cover (once per track) into the machine's picture format. */
  private picture<T>(slot: { key: string; pic: T | null }, ctx: GenContext, make: (img: HTMLImageElement | null, title: string, artist: string) => T): T | null {
    const art = ctx.params.picture === 'title' ? undefined : lyricsFeed.now.artDataUrl;
    const [title, artist] = this.names(ctx);
    const key = `${art ? art.length + art.slice(-32) : 'none'}|${title}|${artist}`;
    if (slot.key === key) return slot.pic;
    if (!art) {
      slot.key = key;
      slot.pic = make(null, title, artist);
      return slot.pic;
    }
    if (this.loading === key) return slot.pic;
    this.loading = key;
    const img = new Image();
    img.onload = () => {
      slot.key = key;
      slot.pic = make(img, title, artist);
      this.loading = '';
    };
    img.onerror = () => {
      slot.key = key;
      slot.pic = make(null, title, artist);
      this.loading = '';
    };
    img.src = art;
    return slot.pic;
  }

  /**
   * Per-line stripe colours for the whole frame, like the tape signal: a
   * stream of short and long pulses (0 and 1 bits) whose bits are read off
   * the music's waveform, so the stripes move with the song. Pilot tone:
   * long even pulses.
   */
  private stripes(ctx: GenContext, lines: number, pilot: boolean): Uint8Array {
    const out = new Uint8Array(lines);
    const wf = ctx.frame.waveform;
    const n = wf.length || 1;
    const scale = Math.max(0.34, num(ctx.params.stripeStride, 3) / 3);
    // The signal runs past the beam much faster than the frame rate: start somewhere new each frame.
    const run = ctx.time * 15734;
    let k = Math.floor(run / 3);
    let acc = -((run % 8) * scale);
    let col = k & 1;
    for (let y = 0; y < lines; y++) {
      while (acc <= y) {
        const bit = pilot ? 1 : wf[(k * 13) % n] > 0 ? 1 : 0;
        acc += (pilot ? 9 : bit ? 4 : 2) * scale;
        col ^= 1;
        k++;
      }
      out[y] = col;
    }
    return out;
  }

  // ── The 48K micro ───────────────────────────────────────────────────────

  private draw48(ctx: GenContext): void {
    const p = ctx.params;
    const px = this.px;
    const W = px.w, H = px.h;
    const x0 = Math.floor((W - 256) / 2), y0 = 24;
    const bpb = ctx.frame.beatsPerBar || 4;
    const len = Math.max(2, num(p.cycleBars, 16)) * bpb;
    const cyc = Math.floor(ctx.beat / len);
    const t = ctx.beat / len - cyc;
    const pic = this.picture(this.zx, ctx, (img, title, artist) => {
      const rgba = img
        ? drawInto(img, 256, 192, [44, 2, 168, 168], '#000000', (g) => {
            g.imageSmoothingEnabled = false;
            g.fillStyle = '#000000';
            g.fillRect(0, 172, 256, 20);
          })
        : titleScreen(256, 192, title, artist, cyc);
      const zx = toZx(rgba);
      if (img) {
        // Title and artist under the cover, in the machine's own letters.
        const put = (s: string, row: number, ink: number): void => {
          const t2 = s.toUpperCase().slice(0, 32);
          const col0 = Math.floor((32 - t2.length) / 2);
          for (let i = 0; i < t2.length; i++) {
            const gl = glyph(t2[i]);
            const cx = col0 + i;
            zx.ink[row * 32 + cx] = ink;
            zx.paper[row * 32 + cx] = 0;
            for (let r = 0; r < 8; r++) for (let b = 0; b < 8; b++) zx.bits[(row * 8 + r) * 256 + cx * 8 + b] = gl[r] & (1 << b) ? 1 : 0;
          }
        };
        put(title, 22, 15);
        put(artist, 23, 13);
      }
      return zx;
    });
    const [title] = this.names(ctx);
    const failed = hash01(cyc, 404) < num(p.errors, 0.15);
    // Timeline (fractions of the cycle).
    const stage = (a: number, b: number): number => Math.max(0, Math.min(1, (t - a) / (b - a)));
    const typed = stage(0, 0.02);
    const pilot = (t > 0.03 && t < 0.08) || (t > 0.09 && t < 0.12) || (t > 0.13 && t < 0.15) || (t > 0.65 && t < 0.68);
    const data = (t >= 0.08 && t <= 0.09) || (t >= 0.12 && t <= 0.13) || (t >= 0.15 && t <= 0.65) || t >= 0.68;
    const bytes = Math.floor(stage(0.15, 0.55) * 6144);
    const attrs = Math.floor(stage(0.55, 0.65) * 768);
    const error = failed && t > 0.86;
    // Border.
    const WHITE = ZXC[7], BLACK = ZXC[0];
    const lines = this.stripes(ctx, H, pilot);
    for (let y = 0; y < H; y++) {
      let c = WHITE;
      if (!error && pilot) c = lines[y] ? ZXC[2] : ZXC[5];
      else if (!error && data) c = lines[y] ? ZXC[1] : ZXC[6];
      else if (t > 0.65 && !error) c = BLACK;
      px.data.fill(c, y * W, y * W + W);
    }
    // Screen: white paper with the BASIC lines until the picture's bytes arrive.
    px.rect(x0, y0, 256, 192, WHITE);
    if (t < 0.03) {
      const cmd = 'LOAD ""'.slice(0, Math.ceil(typed * 7));
      px.text(x0, y0 + 184, cmd, BLACK, WHITE);
      if (Math.floor(ctx.beat * 2) % 2 === 0 || typed < 1) px.text(x0 + cmd.length * 8, y0 + 184, 'L', WHITE, BLACK);
    }
    if (t > 0.09) px.text(x0, y0, `Program: ${title.toUpperCase().slice(0, 10)}`, BLACK, WHITE);
    if (t > 0.13) px.text(x0, y0 + 8, `Bytes: ${title.toUpperCase().slice(0, 10)}`, BLACK, WHITE);
    if (pic && bytes > 0) {
      const bits = pic.bits;
      // Every pixel shows the picture once its byte has loaded, in the machine's memory order.
      for (let y = 0; y < 192; y++) {
        const rowAddr = ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
        if (rowAddr >= bytes) continue;
        const cy = y >> 3;
        for (let bx = 0; bx < 32; bx++) {
          if (rowAddr + bx >= bytes) break;
          const cell = cy * 32 + bx;
          const coloured = cell < attrs;
          // FLASH: the title cells swap ink and paper on the beat once loaded.
          const flash = coloured && t > 0.7 && cy >= 22 && Math.floor(ctx.beat) % 2 === 1 && p.flash !== false;
          let ink = coloured ? ZXC[pic.ink[cell]] : BLACK;
          let paper = coloured ? ZXC[pic.paper[cell]] : WHITE;
          if (flash) [ink, paper] = [paper, ink];
          const base = (y0 + y) * W + x0 + bx * 8;
          for (let b = 0; b < 8; b++) px.data[base + b] = bits[y * 256 + bx * 8 + b] ? ink : paper;
        }
      }
    }
    if (error) {
      px.rect(x0, y0 + 176, 256, 16, WHITE);
      px.text(x0, y0 + 184, 'R Tape loading error, 0:1', BLACK, WHITE);
    }
  }

  // ── The 64K breadbox ────────────────────────────────────────────────────

  private draw64(ctx: GenContext): void {
    const p = ctx.params;
    const px = this.px;
    const W = px.w, H = px.h;
    const x0 = Math.floor((W - 320) / 2), y0 = 25;
    const bpb = ctx.frame.beatsPerBar || 4;
    const len = Math.max(2, num(p.cycleBars, 16)) * bpb;
    const cyc = Math.floor(ctx.beat / len);
    const t = ctx.beat / len - cyc;
    const LB = C64C[14], BG = C64C[6];
    const pic = this.picture(this.multi, ctx, (img, title, artist) => {
      const rgba = img ? drawInto(img, 160, 200, [30, 0, 100, 200], '#000000') : titleScreen(160, 200, title, artist, cyc);
      return toMulticolour(rgba, 0);
    });
    const [title] = this.names(ctx);
    const stage = (a: number, b: number): number => Math.max(0, Math.min(1, (t - a) / (b - a)));
    const program = String(p.program ?? 'both');
    const maze = program === 'maze' || (program === 'both' && cyc % 2 === 1);
    // Screen text rows (40 × 25) for the boot and listing phases.
    const rows: string[] = [];
    const cursorOn = Math.floor(ctx.beat * 2) % 2 === 0;
    let cursor: [number, number] | null = null;
    const type = (s: string, a: number, b: number): string => s.slice(0, Math.ceil(stage(a, b) * s.length));
    const blank = (t > 0.065 && t < 0.1) || (t > 0.14 && t < 0.16);
    const loadingPic = t >= 0.16 && t < 0.6;
    const listing = t >= 0.6 && t < 0.7;
    const running = t >= 0.7;
    if (t < 0.16) {
      rows[1] = '    **** HOME COMPUTER 64 BASIC V2 ****';
      rows[3] = ' 64K RAM SYSTEM  38911 BASIC BYTES FREE';
      rows[5] = 'READY.';
      rows[6] = type('LOAD', 0.02, 0.035);
      cursor = [rows[6].length, 6];
      if (t > 0.04) {
        rows[8] = 'PRESS PLAY ON TAPE';
        cursor = null;
      }
      if (t > 0.06) rows[9] = 'OK';
      if (t > 0.1) {
        rows[11] = 'SEARCHING';
        if (t > 0.115) rows[12] = `FOUND ${title.toUpperCase().slice(0, 16)}`;
        if (t > 0.135) rows[13] = 'LOADING';
      }
    } else if (listing) {
      const line = this.lyric(ctx).toUpperCase().replace(/"/g, "'").slice(0, 28);
      rows[1] = 'READY.';
      rows[2] = type('LIST', 0.605, 0.615);
      if (t > 0.62) {
        rows[4] = maze ? '10 PRINT CHR$(205.5+RND(1));' : `10 PRINT "${line} ";`;
        rows[5] = '20 GOTO 10';
        rows[6] = 'READY.';
        rows[7] = type('RUN', 0.64, 0.66);
        cursor = [rows[7].length, 7];
      } else cursor = [rows[2].length, 2];
    }
    // Border: turbo-loader stripes while loading, plain otherwise.
    const loadingStripes = t >= 0.16 && t < 0.6;
    const lines = loadingStripes ? this.stripes(ctx, H, false) : null;
    const stripeCols = [C64C[6], C64C[14], C64C[3], C64C[1], C64C[7], C64C[10], C64C[4], C64C[13]];
    const textCol = running ? C64C[this.textColour] : LB;
    let run = 0;
    for (let y = 0; y < H; y++) {
      let c = LB;
      if (lines) {
        // Each flip steps to the next colour of a short rainbow.
        if (y === 0 || lines[y] !== lines[y - 1]) run++;
        c = stripeCols[run % stripeCols.length];
      }
      px.data.fill(c, y * W, y * W + W);
    }
    if (blank) return;
    px.rect(x0, y0, 320, 200, loadingPic ? C64C[0] : BG);
    if (loadingPic && pic) {
      // The bitmap arrives cell by cell, left to right, row by row.
      const cells = Math.floor(stage(0.17, 0.55) * 1000);
      for (let cy = 0; cy < 25; cy++) {
        for (let cx = 0; cx < 40; cx++) {
          if (cy * 40 + cx >= cells) break;
          for (let y = 0; y < 8; y++) {
            const base = (y0 + cy * 8 + y) * W + x0 + cx * 8;
            for (let x = 0; x < 4; x++) {
              const c = C64C[pic.px[(cy * 8 + y) * 160 + cx * 4 + x]];
              px.data[base + x * 2] = c;
              px.data[base + x * 2 + 1] = c;
            }
          }
        }
      }
      return;
    }
    if (running) {
      this.run(ctx, maze, cyc, t, len);
      for (let r = 0; r < 25; r++) px.text(x0, y0 + r * 8, this.rows[r] ?? '', textCol);
      return;
    }
    for (let r = 0; r < 25; r++) if (rows[r]) px.text(x0, y0 + r * 8, rows[r], LB);
    if (cursor && cursorOn) px.rect(x0 + cursor[0] * 8, y0 + cursor[1] * 8, 8, 8, LB);
  }

  /** The program running: characters printed at two screen lines per beat, scrolling up. */
  private run(ctx: GenContext, maze: boolean, cyc: number, t: number, len: number): void {
    if (this.runCycle !== cyc) {
      this.runCycle = cyc;
      this.rows = [];
      this.printed = 0;
      this.lastProg = 0;
      this.textColour = 14;
    }
    const prog = (t - 0.7) * len;
    const rate = 80 * num(ctx.params.printSpeed, 1);
    const target = Math.floor(prog * rate);
    if (Math.floor(prog / (ctx.frame.beatsPerBar || 4)) !== Math.floor(this.lastProg / (ctx.frame.beatsPerBar || 4)) && maze) {
      // A new text colour every bar, like poking the colour register.
      const cols = [14, 3, 13, 7, 1, 15, 10];
      this.textColour = cols[Math.floor(prog / 4) % cols.length];
    }
    this.lastProg = prog;
    const line = `${this.lyric(ctx).toUpperCase()} `;
    let cur = this.rows.length ? this.rows[this.rows.length - 1] : '';
    if (!this.rows.length) this.rows.push('');
    while (this.printed < target) {
      const ch = maze ? (hash01(this.printed, cyc * 31 + 7) < 0.5 ? '╱' : '╲') : line[this.printed % line.length];
      cur += ch;
      this.printed++;
      if (cur.length >= 40) {
        this.rows[this.rows.length - 1] = cur;
        this.rows.push('');
        cur = '';
        if (this.rows.length > 25) this.rows.shift();
      }
    }
    this.rows[this.rows.length - 1] = cur;
  }

  dispose(): void {
    this.tex.dispose();
    super.dispose();
  }
}
