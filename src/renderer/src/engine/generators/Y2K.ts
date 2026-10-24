import type { GenContext } from './Generator';
import { CanvasLook, paletteCss } from './CanvasLook';
import { num } from './ShaderGenerator';
import { hash01 } from '../modulation';
import { liveText } from '../lyricsFeed';

/**
 * Y2K Rollover: New Year's Eve 1999, as it went out live. A two-phrase cycle:
 *
 * 1. The countdown: DEC 31 1999 and a red LED clock at 23:59, the seconds
 *    climbing, then a giant 10 … 1 slamming in one per beat so that zero
 *    lands exactly on the next phrase downbeat.
 * 2. Midnight: 00:00:00 and a huge 2000, fireworks bursting on every kick,
 *    crackling on the hats; then the bug: the year flickers to 1900, the
 *    segments scramble, and the screen falls into the blue fatal-error page
 *    (its error quoting the lyric) until the countdown reboots.
 *
 * The drop jumps straight to the bug. Broadcast dressing: faint interlace and
 * a LIVE bug in the corner. Colours: stop 2 the LEDs, stop 1 the error page,
 * stops 3-5 the fireworks.
 */

/** Seven-segment masks: a b c d e f g. */
const SEG7: Record<string, number> = {
  '0': 0b1111110, '1': 0b0110000, '2': 0b1101101, '3': 0b1111001, '4': 0b0110011,
  '5': 0b1011011, '6': 0b1011111, '7': 0b1110000, '8': 0b1111111, '9': 0b1111011, '-': 0b0000001, ' ': 0,
};

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: number; glitter: boolean }
interface Rocket { x: number; y: number; vy: number; tx: number; ty: number; c: number }

export class Y2K extends CanvasLook {
  readonly kind = 'y2k';
  private sparks: Spark[] = [];
  private rockets: Rocket[] = [];
  private bugAt = -99;
  private seed = 1;

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** One seven-segment digit, top-left at (x, y), `h` tall; unlit segments faint. */
  private digit(g: CanvasRenderingContext2D, ch: string, x: number, y: number, h: number, lit: string, ghost: string, scramble = 0): void {
    let mask = SEG7[ch] ?? 0;
    if (scramble > 0) mask ^= Math.floor(this.rand() * 128) & (scramble > 0.5 ? 127 : 0b0101010);
    const w = h * 0.5, t = h * 0.1, sk = h * 0.06;
    const seg = (i: number, x0: number, y0: number, x1: number, y1: number): void => {
      const on = (mask >> (6 - i)) & 1;
      g.fillStyle = on ? lit : ghost;
      const horiz = y0 === y1;
      g.beginPath();
      if (horiz) {
        g.moveTo(x0 + t * 0.6, y0);
        g.lineTo(x0 + t * 1.1, y0 - t / 2);
        g.lineTo(x1 - t * 1.1, y0 - t / 2);
        g.lineTo(x1 - t * 0.6, y0);
        g.lineTo(x1 - t * 1.1, y0 + t / 2);
        g.lineTo(x0 + t * 1.1, y0 + t / 2);
      } else {
        g.moveTo(x0, y0 + t * 0.6);
        g.lineTo(x0 + t / 2, y0 + t * 1.1);
        g.lineTo(x1 + t / 2, y1 - t * 1.1);
        g.lineTo(x1, y1 - t * 0.6);
        g.lineTo(x1 - t / 2, y1 - t * 1.1);
        g.lineTo(x0 - t / 2, y0 + t * 1.1);
      }
      g.closePath();
      g.fill();
    };
    // Slanted a little, like the big public clocks.
    const X = (yy: number): number => x + sk * (1 - (yy - y) / h);
    seg(0, X(y), y, X(y) + w, y);
    seg(1, X(y) + w, y, X(y + h / 2) + w, y + h / 2);
    seg(2, X(y + h / 2) + w, y + h / 2, X(y + h) + w, y + h);
    seg(3, X(y + h), y + h, X(y + h) + w, y + h);
    seg(4, X(y + h / 2), y + h / 2, X(y + h), y + h);
    seg(5, X(y), y, X(y + h / 2), y + h / 2);
    seg(6, X(y + h / 2), y + h / 2, X(y + h / 2) + w, y + h / 2);
  }

  private display(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, h: number, lit: string, ghost: string, glow: string, scramble = 0): void {
    // Never wider than the screen (a tall LED strip shrinks the digits).
    const raw = [...text].reduce((a, c) => a + (c === ':' ? 0.3 : 0.72), 0);
    h = Math.min(h, (g.canvas.width * 0.9) / raw);
    const pitch = h * 0.72, colon = h * 0.3;
    const width = [...text].reduce((a, c) => a + (c === ':' ? colon : pitch), 0);
    let x = cx - width / 2;
    g.save();
    g.shadowColor = glow;
    g.shadowBlur = h * 0.12;
    for (const c of text) {
      if (c === ':') {
        g.fillStyle = lit;
        for (const fy of [0.32, 0.68]) {
          g.beginPath();
          g.arc(x + colon * 0.45, cy - h / 2 + h * fy, h * 0.05, 0, Math.PI * 2);
          g.fill();
        }
        x += colon;
        continue;
      }
      this.digit(g, c, x, cy - h / 2, h, lit, ghost, scramble);
      x += pitch;
    }
    g.restore();
  }

  private burst(x: number, y: number, n: number, W: number, colour: number, glitter: boolean): void {
    const speed = W * (0.22 + this.rand() * 0.14);
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2, v = speed * (0.35 + Math.sqrt(this.rand()) * 0.65);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.6 + this.rand() * 1.1, max: 2, c: colour, glitter });
    }
    if (this.sparks.length > 2500) this.sparks.splice(0, this.sparks.length - 2500);
  }

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const pal = ctx.palette;
    const bpp = Math.max(8, f.beatsPerPhrase || 16);
    const cycle = bpp * 2;
    const beat = ctx.beat;
    const c0 = Math.floor(beat / cycle);
    const t = beat - c0 * cycle;
    this.seed = (Math.floor(ctx.time * 60) * 2654435761) >>> 0 || 1;
    if (f.drop) this.bugAt = beat;
    const dt = Math.min(0.05, ctx.dt);
    const led = paletteCss(pal, 2), ledGhost = paletteCss(pal, 2, -0.85, 0.35), ledGlow = paletteCss(pal, 2, 0.1);
    // Which part of the cycle: countdown, midnight, bug, error page.
    const sinceBug = beat - this.bugAt;
    const forcedBug = sinceBug >= 0 && sinceBug < bpp * 0.75;
    const midnight = t >= bpp;
    const into = t - bpp;
    const bugStart = bpp * Math.min(0.9, num(p.bugAt, 0.5));
    const phase = forcedBug ? (sinceBug < 2 ? 'bug' : 'error') : !midnight ? 'countdown' : into < bugStart ? 'midnight' : into < bugStart + 2 ? 'bug' : 'error';
    // Background: black for the broadcast, blue for the crash.
    if (phase === 'error') {
      this.errorPage(g, W, H, ctx, forcedBug ? sinceBug - 2 : into - bugStart - 2);
      this.sparks = [];
      this.rockets = [];
      return;
    }
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const u = Math.min(W / 16, H / 9);
    if (phase === 'countdown') {
      const left = bpp - t;
      if (left > 10) {
        // The clock: 23:59:SS, the seconds reaching 50 as the final ten begins.
        const secs = Math.min(50, Math.max(0, Math.floor(50 - (left - 10) * (50 / Math.max(1, bpp - 10)) * 0.6)));
        g.font = `700 ${Math.round(u * 0.55)}px "Helvetica Neue", Arial, sans-serif`;
        g.textAlign = 'center';
        g.fillStyle = led;
        g.fillText('DEC 31 1999', W / 2, H * 0.24);
        this.display(g, `23:59:${String(secs).padStart(2, '0')}`, W / 2, H * 0.52, H * 0.26, led, ledGhost, ledGlow);
      } else {
        // The final ten, one per beat, each digit slamming in.
        const n = Math.ceil(left);
        const fr = left - Math.floor(left);
        const slam = 1 + Math.pow(fr, 4) * 0.35;
        this.display(g, String(n), W / 2, H * 0.52, H * 0.62 * slam, led, ledGhost, ledGlow);
      }
    } else {
      // Midnight: 2000, then the bug flickers it to 1900 with scrambling segments.
      const bug = phase === 'bug';
      const flick = bug && Math.floor(ctx.time * 4) % 2 === 0;
      const year = bug ? (flick ? '1900' : '2000') : '2000';
      g.font = `700 ${Math.round(u * 0.45)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = led;
      g.fillText(bug ? 'JAN 01 19O0' : 'JAN 01 2000', W / 2, H * 0.17);
      this.display(g, bug ? '00:00:0-' : '00:00:00', W / 2, H * 0.28, H * 0.1, led, ledGhost, ledGlow, bug ? 0.4 : 0);
      this.display(g, year, W / 2, H * 0.62, H * 0.42, led, ledGhost, ledGlow, bug && !flick && this.rand() < 0.5 ? 0.3 : 0);
      // Fireworks: a rocket on each kick, crackle on the hats.
      if (!bug && (f.onsets.kick || (into < 0.1 && this.rockets.length === 0))) {
        const tx = W * (0.15 + this.rand() * 0.7), ty = H * (0.12 + this.rand() * 0.35);
        this.rockets.push({ x: tx + (this.rand() - 0.5) * W * 0.1, y: H, vy: -H * 1.6, tx, ty, c: 2 + Math.floor(this.rand() * 3) });
      }
      if (f.onsets.hat && this.sparks.length && !bug) {
        const s = this.sparks[Math.floor(this.rand() * this.sparks.length)];
        this.burst(s.x, s.y, 6, W * 0.25, 4, true);
      }
    }
    // Fireworks physics and drawing (they keep falling into the bug).
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const r of this.rockets) {
      r.y += r.vy * dt;
      r.vy *= 1 - dt * 0.6;
      g.fillStyle = paletteCss(pal, r.c, 0.5);
      g.fillRect(r.x - 2, r.y - 2, 4, 10);
      for (let k = 1; k < 6; k++) {
        g.globalAlpha = 0.5 - k * 0.08;
        g.fillRect(r.x - 1 + (this.rand() - 0.5) * 3, r.y + k * 10, 2, 6);
      }
      g.globalAlpha = 1;
      if (r.y <= r.ty) {
        this.burst(r.x, r.y, 170 + Math.floor(ctx.env.energy * 120), W, r.c, this.rand() < 0.4);
        r.y = -1e9;
      }
    }
    this.rockets = this.rockets.filter((r) => r.y > -1e8);
    const size = Math.max(2, u * 0.065);
    for (const s of this.sparks) {
      s.vx *= 1 - dt * 1.4;
      s.vy = s.vy * (1 - dt * 1.4) + H * 0.35 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0) continue;
      const a = Math.min(1, s.life / 0.8) * (s.glitter ? (this.rand() < 0.5 ? 1 : 0.15) : 1);
      g.globalAlpha = a;
      g.strokeStyle = g.fillStyle = paletteCss(pal, s.c, s.life > 1.8 ? 0.6 : 0.1);
      // A short trail behind each spark.
      g.lineWidth = size * 0.7;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x - s.vx * 0.05, s.y - s.vy * 0.05);
      g.stroke();
      g.fillRect(s.x - size / 2, s.y - size / 2, size, size);
    }
    g.globalAlpha = 1;
    g.restore();
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.broadcast(g, W, H, ctx);
  }

  /** A LIVE bug in the corner and faint interlace. */
  private broadcast(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const u = Math.min(W / 16, H / 9);
    g.save();
    g.globalAlpha = 0.85;
    g.fillStyle = '#d01c1c';
    g.fillRect(W - u * 2.2, u * 0.5, u * 1.1, u * 0.42);
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(u * 0.3)}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('LIVE', W - u * 1.65, u * 0.72);
    g.globalAlpha = 0.6;
    g.beginPath();
    g.arc(W - u * 0.75, u * 0.71, u * 0.2, 0, Math.PI * 2);
    g.lineWidth = u * 0.05;
    g.strokeStyle = '#fff';
    g.stroke();
    g.globalAlpha = 0.07;
    g.fillStyle = '#000';
    const off = Math.floor(ctx.time * 60) % 2;
    for (let y = off; y < H; y += 3) g.fillRect(0, y, W, 1);
    g.restore();
  }

  /** The blue fatal-error page, its error quoting the lyric. */
  private errorPage(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext, t: number): void {
    const pal = ctx.palette;
    g.fillStyle = paletteCss(pal, 1);
    g.fillRect(0, 0, W, H);
    const live = liveText('lyrics', Date.now());
    const lyric = (live.kind === 'lyrics' ? live.lines[live.current] : live.lines[0]) || 'THE YEAR 2000';
    const cols = 64;
    const px = Math.floor(W / (cols * 0.62));
    g.font = `700 ${px}px "Lucida Console", "Cascadia Mono", "DejaVu Sans Mono", monospace`;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    const x0 = (W - cols * px * 0.6) / 2;
    let y = H * 0.24;
    const line = (s: string, invert = false): void => {
      const w = g.measureText(s).width;
      if (invert) {
        g.fillStyle = '#c0c0c0';
        g.fillRect(W / 2 - w / 2 - px * 0.3, y - px * 0.1, w + px * 0.6, px * 1.15);
        g.fillStyle = paletteCss(pal, 1);
        g.fillText(s, W / 2 - w / 2, y);
      } else {
        g.fillStyle = '#ffffff';
        g.fillText(s, x0, y);
      }
      y += px * 1.45;
    };
    line(' SYSTEM ', true);
    y += px * 0.6;
    const addr = `0028:C0${String(Math.floor(hash01(Math.floor(ctx.beat / 32), 5) * 9999)).padStart(4, '0')}2000`;
    line(`A fatal exception 0E has occurred at ${addr}.`);
    const lq = `"${lyric.toUpperCase().slice(0, 40)}"`;
    line(`The date ${lq}`);
    line('could not be stored in two digits.');
    y += px;
    line('*  Press any key to terminate the current application.');
    line('*  Press any key again to restart your computer.');
    line('   You will lose any unsaved information.');
    y += px;
    const blink = Math.floor(ctx.beat * 2) % 2 === 0 ? '_' : ' ';
    line(`        Press any key to continue ${blink}`);
    // The reboot: a flash of black lines as the countdown comes back.
    if (t < 0.3) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      for (let k = 0; k < 6; k++) g.fillRect(0, hash01(k, Math.floor(ctx.time * 30)) * H, W, H * 0.03);
    }
  }
}
