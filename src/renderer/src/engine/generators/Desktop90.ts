import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import { liveText, lyricsFeed, songPositionMs } from '../lyricsFeed';
import { hash2 } from '../lostMedia';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const W = 640;

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform sampler2D uTex;
void main() {
  // Drawn in display colours: hand the output pass exactly what it needs to show them as drawn.
  fragColor = vec4(fromDisplay(texture(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb), 1.0);
}
`;

const COMIC = `bold {px}px "Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive`;
const SANS = `{px}px "MS Sans Serif", Tahoma, "Segoe UI", Arial, sans-serif`;
const MONO = `bold {px}px "Courier New", Consolas, monospace`;
const f = (font: string, px: number): string => font.replace('{px}', String(px));

const MESSAGES = [
  'The beat has performed an illegal operation and will be shut down.',
  'Not enough memory to stop dancing.',
  'Bass overflow at address 0x00FF.',
  'Please insert disk 2 of 7.',
  'Are you sure you want to feel this?',
  'Keyboard not found. Press any key to continue.',
  'Low dance floor space on drive C:.',
  'The drop could not be found. Retry, Ignore, Dance?',
];
const TITLES = ['Error', 'Warning', 'System', 'Notice', 'Alert'];

// 12×12 pet sprites ('#' = pixel).
const PET = [
  ['....####....', '..##....##..', '.#........#.', '#..##..##..#', '#..##..##..#', '#..........#', '#..#....#..#', '#...####...#', '.#........#.', '..##....##..', '..#.#..#.#..', '..##....##..'],
  ['....####....', '..##....##..', '.#........#.', '#..........#', '#..##..##..#', '#..........#', '#...####...#', '#..#....#..#', '.#..####..#.', '..##....##..', '.#..#..#..#.', '##........##'],
];

/**
 * Bits of a late-90s home computer, drawn chunky: a homemade web page (tiled
 * stars, rainbow title, under-construction banner, marquee, hit counter), a
 * desktop filling up with error boxes on the beat, a pager and a virtual pet.
 * Lyrics go in the marquee, the error boxes and the pager.
 */
export class Desktop90 extends ShaderGenerator {
  readonly kind = 'desktop90';
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly tile: HTMLCanvasElement;
  private readonly lcd: HTMLCanvasElement;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = 360;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    super(FRAG, { uTex: { value: tex } });
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.tex = tex;
    // Star tile for the web page background.
    this.tile = document.createElement('canvas');
    this.tile.width = this.tile.height = 48;
    const t = this.tile.getContext('2d')!;
    t.fillStyle = '#000033';
    t.fillRect(0, 0, 48, 48);
    for (let i = 0; i < 9; i++) {
      t.fillStyle = i % 3 ? '#8888ff' : '#ffffff';
      t.fillRect(Math.floor(hash2(i, 1) * 48), Math.floor(hash2(i, 2) * 48), 1 + (i % 4 === 0 ? 1 : 0), 1 + (i % 4 === 0 ? 1 : 0));
    }
    this.lcd = document.createElement('canvas');
    this.lcd.width = 120;
    this.lcd.height = 30;
  }

  /** The sung line (or the look's own words), plus earlier lines for the error boxes. */
  private words(ctx: GenContext, before: number): { lines: string[]; current: number; lyrics: boolean } {
    const p = ctx.params;
    const live = liveText(String(p.source ?? 'lyrics') === 'text' ? 'text' : 'lyrics', Date.now(), num(p.lead, 150), before, 0);
    if (live.kind === 'lyrics' || live.kind === 'title') return { lines: live.lines, current: live.current, lyrics: true };
    return { lines: [String(p.text ?? 'Thanks for visiting! Sign my guestbook!')], current: 0, lyrics: false };
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const H = Math.max(240, Math.round((W * ctx.height) / Math.max(1, ctx.width)));
    if (this.canvas.height !== H) this.canvas.height = H;
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.textBaseline = 'alphabetic';
    const mode = String(ctx.params.mode ?? 'web');
    if (mode === 'popups') this.popups(ctx, H);
    else if (mode === 'pager') this.pager(ctx, H);
    else if (mode === 'pet') this.pet(ctx, H);
    else if (mode === 'jcard') this.jcard(ctx, H);
    else this.web(ctx, H);
    this.tex.needsUpdate = true;
  }

  private bevel(x: number, y: number, w: number, h: number, pressed = false): void {
    const g = this.g;
    g.fillStyle = '#c0c0c0';
    g.fillRect(x, y, w, h);
    g.fillStyle = pressed ? '#404040' : '#ffffff';
    g.fillRect(x, y, w, 1);
    g.fillRect(x, y, 1, h);
    g.fillStyle = pressed ? '#ffffff' : '#404040';
    g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x + w - 1, y, 1, h);
  }

  private web(ctx: GenContext, H: number): void {
    const g = this.g;
    const p = ctx.params;
    g.fillStyle = g.createPattern(this.tile, 'repeat')!;
    g.fillRect(0, 0, W, H);
    const cx = W / 2;
    // Rainbow title.
    const title = String(p.title || 'Welcome to my Homepage!');
    g.font = f(COMIC, 30);
    g.textAlign = 'center';
    const tw = g.measureText(title).width;
    const grad = g.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
    const shift = (ctx.time * 0.3) % 1;
    ['#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#3366ff', '#ff00ff'].forEach((c, i) => grad.addColorStop((i / 6 + shift) % 1, c));
    g.lineWidth = 4;
    g.strokeStyle = '#000';
    g.strokeText(title, cx, 46);
    g.fillStyle = grad;
    g.fillText(title, cx, 46);
    // Sparkles.
    for (let i = 0; i < 6; i++) {
      if (hash2(i, Math.floor(ctx.time * 4)) < 0.5) continue;
      const sx = cx - tw / 2 + hash2(i, 9) * tw;
      const sy = 14 + hash2(i, 7) * 40;
      g.fillStyle = '#fff';
      g.fillRect(sx - 3, sy, 7, 1);
      g.fillRect(sx, sy - 3, 1, 7);
    }
    // Rainbow rule.
    const hr = g.createLinearGradient(60, 0, W - 60, 0);
    ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f'].forEach((c, i) => hr.addColorStop(i / 5, c));
    g.fillStyle = hr;
    g.fillRect(60, 60, W - 120, 4);
    // Under construction: scrolling hazard stripes, a sign and a little digger.
    const by = 76;
    g.save();
    g.beginPath();
    g.rect(cx - 170, by, 340, 44);
    g.clip();
    for (let x = -60; x < 400; x += 20) {
      g.fillStyle = '#ffcc00';
      g.beginPath();
      const o = (ctx.beat * 10) % 20;
      g.moveTo(cx - 170 + x + o, by);
      g.lineTo(cx - 160 + x + o, by);
      g.lineTo(cx - 180 + x + o + 44, by + 44);
      g.lineTo(cx - 190 + x + o + 44, by + 44);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#000';
    g.fillRect(cx - 120, by + 10, 240, 24);
    g.font = f(SANS, 16);
    g.fillStyle = '#ffcc00';
    g.fillText('UNDER CONSTRUCTION', cx + 10, by + 28);
    const dig = Math.floor(ctx.beat * 2) % 2;
    g.fillStyle = '#ffcc00';
    g.fillRect(cx - 112, by + 13, 6, 6);
    g.fillRect(cx - 113, by + 19, 8, 9);
    g.fillRect(cx - 104, by + (dig ? 18 : 22), 12, 2);
    // Marquee with the sung line.
    const { lines, current } = this.words(ctx, 0);
    const msg = `*** ${lines[current] ?? ''} ***`;
    g.fillStyle = '#000080';
    g.fillRect(70, 132, W - 140, 24);
    g.save();
    g.beginPath();
    g.rect(70, 132, W - 140, 24);
    g.clip();
    g.font = f(MONO, 16);
    g.textAlign = 'left';
    g.fillStyle = '#ffff00';
    const mw = g.measureText(msg).width + 80;
    const mx = W - 70 - ((ctx.time * 90 * num(p.speed, 1)) % (mw + W - 140));
    g.fillText(msg, mx, 150);
    g.restore();
    // Hit counter, counting the beats.
    const count = String(128000 + Math.floor(ctx.beat)).padStart(9, '0');
    g.textAlign = 'center';
    g.font = f(SANS, 13);
    g.fillStyle = '#ffffff';
    g.fillText('You are visitor number', cx, 178);
    g.fillStyle = '#000';
    g.fillRect(cx - 82, 184, 164, 26);
    g.font = f(MONO, 20);
    g.textAlign = 'left';
    for (let i = 0; i < count.length; i++) {
      g.fillStyle = '#202020';
      g.fillRect(cx - 80 + i * 18, 186, 16, 22);
      g.fillStyle = '#33ff33';
      g.fillText(count[i], cx - 77 + i * 18, 204);
    }
    // NEW! badge blinking on the beat.
    if (Math.floor(ctx.beat) % 2 === 0) {
      g.fillStyle = '#ff0000';
      g.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const r = k % 2 ? 16 : 26;
        g.lineTo(W - 110 + Math.cos(a) * r, 120 + Math.sin(a) * r);
      }
      g.fill();
      g.font = f(COMIC, 13);
      g.fillStyle = '#ffff00';
      g.textAlign = 'center';
      g.fillText('NEW!', W - 110, 125);
    }
    // Buttons and footer.
    ['Guestbook', 'My Links', 'Webring'].forEach((label, i) => {
      const x = cx - 165 + i * 115;
      this.bevel(x, 222, 100, 24, ctx.env.kick > 0.6 && i === Math.floor(ctx.beat) % 3);
      g.font = f(SANS, 13);
      g.fillStyle = '#000';
      g.textAlign = 'center';
      g.fillText(label, x + 50, 238);
    });
    g.font = f(SANS, 11);
    g.fillStyle = '#aaaaff';
    g.fillText('<< Prev | Random | Next >>', cx, 266);
    g.fillStyle = '#8888aa';
    g.fillText('Best viewed at 800x600 · Last updated 11/03/98', cx, Math.min(H - 10, 290));
  }

  private popups(ctx: GenContext, H: number): void {
    const g = this.g;
    const p = ctx.params;
    g.fillStyle = '#008080';
    g.fillRect(0, 0, W, H);
    // Desktop icons.
    ['Computer', 'Trash', 'Docs', 'Net'].forEach((label, i) => {
      const y = 14 + i * 56;
      g.fillStyle = ['#c0c0c0', '#808080', '#ffff99', '#66ccff'][i];
      g.fillRect(22, y, 28, 24);
      g.fillStyle = '#000';
      g.fillRect(22, y + 24, 28, 2);
      g.font = f(SANS, 11);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.fillText(label, 36, y + 40);
    });
    // Taskbar.
    this.bevel(0, H - 22, W, 22);
    this.bevel(3, H - 19, 54, 16);
    g.font = f(SANS, 11);
    g.fillStyle = '#000';
    g.textAlign = 'left';
    g.fillText('Menu', 14, H - 7);
    const secs = lyricsFeed.now.connected ? songPositionMs(Date.now()) / 1000 : ctx.time;
    const mins = Math.floor(secs / 60);
    this.bevel(W - 62, H - 19, 58, 16, true);
    g.fillText(`${String(9 + Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')} PM`, W - 56, H - 7);
    // Error boxes: one more every few beats through a phrase, then the desktop clears.
    const every = Math.max(1, num(p.every, 2));
    const phrase = 32;
    const into = ctx.beat - Math.floor(ctx.beat / phrase) * phrase;
    const n = Math.min(14, Math.floor(into / every) + 1);
    const { lines, current, lyrics } = this.words(ctx, 13);
    for (let k = 0; k < n; k++) {
      const x = 70 + ((k * 26) % 300);
      const y = 18 + ((k * 20) % Math.max(60, H - 170));
      const age = n - 1 - k;
      const seed = Math.floor(ctx.beat / phrase) * 31 + k;
      const msg = lyrics ? lines[current - age] ?? lines[0] ?? '' : MESSAGES[Math.floor(hash2(seed, 3) * MESSAGES.length)];
      const kind = Math.floor(hash2(seed, 4) * 3);
      const born = into - k * every;
      const pop = k === n - 1 ? Math.min(1, born / 0.15) : 1;
      g.save();
      g.translate(x + 150, y + 60);
      g.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
      g.translate(-150, -60);
      this.bevel(0, 0, 300, 120);
      const tg = g.createLinearGradient(3, 0, 297, 0);
      tg.addColorStop(0, '#000080');
      tg.addColorStop(1, '#1084d0');
      g.fillStyle = tg;
      g.fillRect(3, 3, 294, 18);
      g.font = f(SANS, 12);
      g.fillStyle = '#fff';
      g.textAlign = 'left';
      g.fillText(TITLES[Math.floor(hash2(seed, 5) * TITLES.length)], 8, 16);
      this.bevel(278, 5, 16, 14);
      g.fillStyle = '#000';
      g.fillText('x', 283, 16);
      // Icon.
      g.beginPath();
      if (kind === 0) {
        g.fillStyle = '#ff0000';
        g.arc(30, 52, 15, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(24, 46);
        g.lineTo(36, 58);
        g.moveTo(36, 46);
        g.lineTo(24, 58);
        g.stroke();
      } else if (kind === 1) {
        g.fillStyle = '#ffff00';
        g.moveTo(30, 36);
        g.lineTo(46, 66);
        g.lineTo(14, 66);
        g.fill();
        g.fillStyle = '#000';
        g.font = f(SANS, 18);
        g.textAlign = 'center';
        g.fillText('!', 30, 63);
      } else {
        g.fillStyle = '#0000ff';
        g.arc(30, 52, 15, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.font = f(SANS, 18);
        g.textAlign = 'center';
        g.fillText('i', 30, 59);
      }
      // Message, wrapped.
      g.font = f(SANS, 12);
      g.fillStyle = '#000';
      g.textAlign = 'left';
      wrapLines(g, msg, 230).slice(0, 3).forEach((l, i) => g.fillText(l, 58, 44 + i * 15));
      this.bevel(80, 90, 64, 20, k === n - 1 && ctx.env.kick > 0.7);
      this.bevel(156, 90, 64, 20);
      g.textAlign = 'center';
      g.fillText('OK', 112, 104);
      g.fillText('Cancel', 188, 104);
      g.restore();
    }
  }

  private pager(ctx: GenContext, H: number): void {
    const g = this.g;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2a2420');
    grad.addColorStop(1, '#14100e');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // The pager: black plastic body, a backlit LCD, two buttons.
    const bw = 520;
    const bh = 200;
    const bx = (W - bw) / 2;
    const byy = (H - bh) / 2;
    g.fillStyle = '#111';
    roundRect(g, bx, byy, bw, bh, 34);
    g.fill();
    g.fillStyle = '#2a2a2a';
    roundRect(g, bx + 6, byy + 6, bw - 12, 30, 20);
    g.fill();
    const { lines, current } = this.words(ctx, 0);
    const text = (lines[current] ?? '').toUpperCase();
    // Backlight flares on each new message.
    const live = liveText('lyrics', Date.now(), num(ctx.params.lead, 150));
    const fresh = live.kind === 'lyrics' ? live.progress < 0.12 : Math.floor(ctx.beat) % 8 === 0;
    const l = this.lcd.getContext('2d')!;
    l.imageSmoothingEnabled = false;
    l.fillStyle = fresh ? '#c8ff7a' : '#9cbf3a';
    l.fillRect(0, 0, 120, 30);
    l.fillStyle = '#1d2a08';
    l.font = '8px monospace';
    l.textBaseline = 'top';
    const cols = 18;
    const scroll = text.length > cols ? Math.floor(ctx.time * 5) % (text.length + 6) : 0;
    const shown = text.length > cols ? `${text}      ${text}`.slice(scroll, scroll + cols) : text;
    l.fillText(shown, 3, 13);
    l.fillText(fresh && Math.floor(ctx.time * 4) % 2 ? 'NEW MSG' : `${String(1 + (Math.floor(ctx.beat / 32) % 12)).padStart(2, '0')}:${String(Math.floor(ctx.beat / 2) % 60).padStart(2, '0')}`, 3, 3);
    l.fillRect(104, 3, 12, 6);
    l.fillStyle = fresh ? '#c8ff7a' : '#9cbf3a';
    l.fillRect(105, 4, 10 - Math.floor(ctx.time / 60) % 6, 4);
    const lx = bx + 40;
    const ly = byy + 50;
    const lw = bw - 80;
    const lh = 100;
    g.fillStyle = '#000';
    g.fillRect(lx - 6, ly - 6, lw + 12, lh + 12);
    g.drawImage(this.lcd, lx, ly, lw, lh);
    // Pixel grid.
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < lw; x += lw / 120) g.fillRect(lx + x, ly, 1, lh);
    for (let y = 0; y < lh; y += lh / 30) g.fillRect(lx, ly + y, lw, 1);
    if (fresh) {
      g.fillStyle = 'rgba(200,255,120,0.12)';
      g.fillRect(lx - 30, ly - 30, lw + 60, lh + 60);
    }
    for (let i = 0; i < 2; i++) {
      g.fillStyle = '#333';
      roundRect(g, bx + 150 + i * 140, byy + bh - 34, 80, 18, 9);
      g.fill();
    }
  }

  private pet(ctx: GenContext, H: number): void {
    const g = this.g;
    const p = ctx.params;
    g.fillStyle = '#ffd9e8';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = i % 2 ? '#ffc2d9' : '#d9f2ff';
      g.beginPath();
      g.arc(hash2(i, 1) * W, hash2(i, 2) * H, 6 + hash2(i, 3) * 10, 0, Math.PI * 2);
      g.fill();
    }
    // Egg-shaped shell.
    const cx = W / 2;
    const cy = H / 2 + 6;
    const pal = ctx.palette;
    const toHex = (i: number): string => `rgb(${[0, 1, 2].map((k) => Math.round(255 * Math.pow(Math.min(1, pal[i * 3 + k]), 1 / 2.2))).join(',')})`;
    const shell = g.createRadialGradient(cx - 40, cy - 60, 10, cx, cy, 180);
    shell.addColorStop(0, '#ffffff');
    shell.addColorStop(0.3, toHex(3));
    shell.addColorStop(1, toHex(2));
    g.fillStyle = shell;
    g.beginPath();
    g.ellipse(cx, cy, 130, 150, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#999';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy - 160, 16, 0, Math.PI * 2);
    g.stroke();
    // LCD.
    const sx = cx - 70;
    const sy = cy - 80;
    g.fillStyle = '#555';
    roundRect(g, sx - 10, sy - 10, 160, 136, 14);
    g.fill();
    g.fillStyle = '#b5c99a';
    g.fillRect(sx, sy, 140, 116);
    const ink = '#2b3320';
    // Menu icons: one lit per bar.
    const lit = Math.floor(ctx.beat / ctx.frame.beatsPerBar) % 8;
    for (let i = 0; i < 8; i++) {
      const ix = sx + 8 + (i % 4) * 34;
      const iy = i < 4 ? sy + 4 : sy + 102;
      g.fillStyle = i === lit ? ink : 'rgba(43,51,32,0.25)';
      g.fillRect(ix, iy, 10, 10);
    }
    // The pet hops on the beat.
    const jump = Math.abs(Math.sin(ctx.beat * Math.PI)) * num(p.react, 1);
    const frame = jump > 0.5 ? 1 : 0;
    const px = sx + 46 + Math.round(Math.sin(ctx.beat * Math.PI / 8) * 20);
    const py = sy + 30 - Math.round(jump * 14);
    g.fillStyle = ink;
    PET[frame].forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '#') g.fillRect(px + x * 4, py + y * 4, 4, 4);
      }),
    );
    if (ctx.env.kick > 0.6) {
      g.font = f(MONO, 16);
      g.fillText('♥', px + 54, py + 4);
    }
    // Buttons.
    for (let i = 0; i < 3; i++) {
      g.fillStyle = '#eee';
      g.beginPath();
      g.arc(cx - 40 + i * 40, cy + 90, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#bbb';
      g.beginPath();
      g.arc(cx - 40 + i * 40, cy + 92, 9, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** A cassette J-card insert: spine, ruled lines, a margin and a "side A" box (the lyrics are written over it). */
  private jcard(ctx: GenContext, H: number): void {
    const g = this.g;
    const p = ctx.params;
    g.fillStyle = '#2a2622';
    g.fillRect(0, 0, W, H);
    const cx = 40;
    const cy = 24;
    const cw = W - 80;
    const ch = H - 48;
    g.fillStyle = '#f3ecd8';
    g.fillRect(cx, cy, cw, ch);
    // Spine strip, folded.
    g.fillStyle = '#e8dfc6';
    g.fillRect(cx, cy, 70, ch);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(cx + 70, cy, 3, ch);
    g.save();
    g.translate(cx + 44, cy + ch - 20);
    g.rotate(-Math.PI / 2);
    g.font = f(COMIC, 22);
    g.fillStyle = '#1b2a8a';
    g.fillText(String(p.title || 'MIXTAPE  ·  SIDE A'), 0, 0);
    g.restore();
    // Ruled lines and a red margin.
    g.strokeStyle = 'rgba(70,110,200,0.35)';
    g.lineWidth = 1;
    for (let y = cy + 60; y < cy + ch - 10; y += 34) {
      g.beginPath();
      g.moveTo(cx + 90, y);
      g.lineTo(cx + cw - 16, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(210,60,60,0.5)';
    g.beginPath();
    g.moveTo(cx + 130, cy + 8);
    g.lineTo(cx + 130, cy + ch - 8);
    g.stroke();
    // "Side A" box and a noise-reduction tick box.
    g.strokeStyle = '#333';
    g.lineWidth = 2;
    g.strokeRect(cx + cw - 150, cy + 14, 130, 34);
    g.font = f(SANS, 14);
    g.fillStyle = '#333';
    g.fillText('SIDE', cx + cw - 140, cy + 36);
    g.font = f(COMIC, 24);
    g.fillStyle = '#c0301f';
    g.fillText(Math.floor(ctx.beat / 128) % 2 ? 'B' : 'A', cx + cw - 70, cy + 40);
    g.strokeRect(cx + 150, cy + 18, 16, 16);
    g.font = f(SANS, 13);
    g.fillStyle = '#333';
    g.fillText('NR ON', cx + 172, cy + 31);
    g.font = f(COMIC, 20);
    g.fillStyle = '#1b2a8a';
    g.fillText('✓', cx + 151, cy + 33);
    // Paper wear.
    g.fillStyle = 'rgba(120,90,40,0.06)';
    for (let i = 0; i < 40; i++) g.fillRect(cx + hash2(i, 1) * cw, cy + hash2(i, 2) * ch, 2 + hash2(i, 3) * 30, 1);
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}

function wrapLines(g: CanvasRenderingContext2D, t: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
