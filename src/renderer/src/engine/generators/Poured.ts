import { lyricsFeed } from '../lyricsFeed';
import type { GenContext } from './Generator';
import { CanvasLook } from './CanvasLook';
import { fontCss } from './KineticType';
import { num } from './ShaderGenerator';
import { wordHash, wordStream, type StreamLine, type WordStream } from '../wordStream';

/**
 * Poured: brutalist construction. Every line is cast in concrete: timber
 * formwork goes up around the letters on the beat, concrete pours into each
 * word from the crane's skip as it is sung (rippling on the kick), then the
 * boards strip off to show board-marked letters with tie-holes. Finished
 * lines stack into a tower of the song's words while the camera pulls back.
 * The sky follows the song from dawn through hard noon to a sodium-lit
 * night, when the tie-holes glow like windows; the chorus is cast big on a
 * plinth and the drop shakes the site. Blueprint draws it all as an
 * architect's line drawing.
 */

const ease = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const h01 = (s: string): number => (wordHash(s) % 10000) / 10000;
const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c: number[], a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

interface Slab {
  canvas: HTMLCanvasElement;
  wet: HTMLCanvasElement;
  /** Word boxes in canvas px (rows wrap). */
  words: Array<{ x0: number; x1: number; top: number; bottom: number }>;
  /** Where the letters sit in the canvas (the face, without the extrusion). */
  face: { x: number; y: number; w: number; h: number };
  px: number;
}

/** Sky colours: dawn, noon, dusk, night (top, horizon). */
const SKY = {
  dawn: [
    [72, 70, 120],
    [246, 168, 128],
  ],
  noon: [
    [38, 92, 170],
    [170, 205, 232],
  ],
  dusk: [
    [52, 40, 92],
    [240, 120, 70],
  ],
  night: [
    [8, 10, 22],
    [40, 30, 34],
  ],
};

export class Poured extends CanvasLook {
  readonly kind = 'poured';
  private slabs = new Map<string, Slab>();
  private board: HTMLCanvasElement | null = null;

  protected resized(): void {
    this.slabs.clear();
  }

  /** Board-marked concrete: planks pressed into the face, with grain and a little tone change per board. */
  private boardTexture(px: number): HTMLCanvasElement {
    if (this.board && this.board.height === Math.max(8, Math.round(px * 1.2))) return this.board;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.max(8, Math.round(px * 1.2));
    const g = c.getContext('2d')!;
    const plank = c.height / 5;
    for (let i = 0; i < 5; i++) {
      const v = 172 + (h01(`p${i}`) - 0.5) * 12;
      g.fillStyle = rgb([v, v - 2, v - 6]);
      g.fillRect(0, i * plank, 512, plank);
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = `rgba(80,74,66,${0.03 + h01(`g${i}${k}`) * 0.04})`;
        g.lineWidth = 0.8;
        const y = i * plank + h01(`y${i}${k}`) * plank;
        g.beginPath();
        g.moveTo(h01(`x${i}${k}`) * 512, y);
        g.bezierCurveTo(200, y + 1.5, 300, y - 1.5, 512, y + (h01(`e${i}${k}`) - 0.5) * 2);
        g.stroke();
      }
      g.fillStyle = 'rgba(60,56,50,0.22)';
      g.fillRect(0, i * plank, 512, 1);
    }
    // Aggregate speckle.
    for (let k = 0; k < 1400; k++) {
      g.fillStyle = `rgba(${h01(`s${k}`) > 0.5 ? '230,226,218' : '70,66,60'},${0.06 + h01(`a${k}`) * 0.1})`;
      g.fillRect(h01(`sx${k}`) * 512, h01(`sy${k}`) * c.height, 1.2, 1.2);
    }
    this.board = c;
    return c;
  }

  /** A line of concrete letters, rendered once: extruded sides, board-marked faces, tie-holes. Wraps to `maxW`. */
  private slab(line: StreamLine, px: number, maxW: number, blue: boolean, flat = false): Slab {
    const key = `${line.index}|${line.text}|${px}|${Math.round(maxW)}|${blue ? 1 : 0}|${flat ? 1 : 0}`;
    const hit = this.slabs.get(key);
    if (hit) return hit;
    const font = fontCss('wide', px);
    const m = document.createElement('canvas').getContext('2d')!;
    m.font = font;
    const space = px * 0.3;
    const lh = px * 1.12;
    const widths = line.words.map((w) => m.measureText(w.text).width);
    // Rows, then each row centred.
    const rows: number[][] = [[]];
    let rw = 0;
    widths.forEach((w, i) => {
      if (rows[rows.length - 1].length && rw + space + w > maxW) {
        rows.push([]);
        rw = 0;
      }
      rw += (rows[rows.length - 1].length ? space : 0) + w;
      rows[rows.length - 1].push(i);
    });
    const rowW = rows.map((r) => r.reduce((n, i) => n + widths[i], 0) + space * Math.max(0, r.length - 1));
    const textW = Math.max(...rowW, 1);
    const depth = Math.round(px * 0.14);
    const pad = Math.round(px * 0.2);
    const cw = Math.ceil(textW + depth + pad * 2);
    const ch = Math.ceil(lh * rows.length + px * 0.2 + depth + pad);
    const fx = pad;
    const words: Slab['words'] = new Array(line.words.length);
    rows.forEach((r, ri) => {
      let x = fx + (textW - rowW[ri]) / 2;
      const base = pad + px * 0.95 + ri * lh;
      for (const i of r) {
        words[i] = { x0: x, x1: x + widths[i], top: base - px * 0.95, bottom: base + px * 0.12 };
        x += widths[i] + space;
      }
    });
    const base = (i: number): number => words[i].top + px * 0.95;
    const make = (wet: boolean): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d')!;
      g.font = font;
      g.textBaseline = 'alphabetic';
      if (blue) {
        g.strokeStyle = 'rgba(235,245,255,0.95)';
        g.lineWidth = Math.max(2, px * 0.025);
        line.words.forEach((w, i) => g.strokeText(w.text, words[i].x0, base(i)));
        return c;
      }
      // A hard shadow behind the letters, and a thin dark foot for their thickness.
      g.fillStyle = 'rgba(0,0,0,0.42)';
      line.words.forEach((w, i) => g.fillText(w.text, words[i].x0 + depth * 0.75, base(i) + depth * 0.75));
      g.fillStyle = wet ? '#3c3d41' : '#5e5b56';
      line.words.forEach((w, i) => g.fillText(w.text, words[i].x0 + Math.max(1, depth * 0.18), base(i) + Math.max(1, depth * 0.18)));
      // The face on its own canvas, so texture and tie-holes stay inside the letters.
      const f = document.createElement('canvas');
      f.width = cw;
      f.height = ch;
      const fg = f.getContext('2d')!;
      fg.font = font;
      fg.textBaseline = 'alphabetic';
      if (wet) {
        const wetG = fg.createLinearGradient(0, 0, 0, ch);
        wetG.addColorStop(0, '#6c6d72');
        wetG.addColorStop(1, '#45464b');
        fg.fillStyle = wetG;
      } else if (flat) fg.fillStyle = '#c4c1bb';
      else {
        const pat = fg.createPattern(this.boardTexture(px), 'repeat')!;
        pat.setTransform(new DOMMatrix().translate(0, pad));
        fg.fillStyle = pat;
      }
      line.words.forEach((w, i) => {
        // On the tower the hero word is painted safety yellow, like a stencilled site sign.
        if (flat && !wet && i === line.hero) {
          fg.save();
          fg.fillStyle = '#f2c400';
          fg.fillText(w.text, words[i].x0, base(i));
          fg.restore();
        } else fg.fillText(w.text, words[i].x0, base(i));
      });
      fg.globalCompositeOperation = 'source-atop';
      if (wet) {
        // A wet sheen across the top of each row.
        for (const r of rows) {
          const top = words[r[0]].top;
          const sheen = fg.createLinearGradient(0, top, 0, top + px * 0.5);
          sheen.addColorStop(0, 'rgba(255,255,255,0.4)');
          sheen.addColorStop(1, 'rgba(255,255,255,0)');
          fg.fillStyle = sheen;
          fg.fillRect(0, top, cw, px * 0.5);
        }
      } else {
        // Tie-holes in rows, a lit top edge, a darker foot.
        const step = px * 0.4;
        // Aggregate speckle.
        for (let k = 0; k < (cw * ch) / 90; k++) {
          fg.fillStyle = h01(`ag${k}`) > 0.5 ? 'rgba(235,232,226,0.35)' : 'rgba(60,57,52,0.3)';
          fg.fillRect(h01(`agx${k}`) * cw, h01(`agy${k}`) * ch, 1.3, 1.3);
        }
        rows.forEach((r) => {
          const top = words[r[0]].top;
          if (flat) return;
          for (let ty = top + step * 0.6; ty < top + px * 0.95; ty += step) {
            for (let tx = fx + step * 0.5; tx < fx + textW; tx += step) {
              fg.fillStyle = 'rgba(38,36,34,0.85)';
              fg.beginPath();
              fg.arc(tx, ty, Math.max(1.2, px * 0.026), 0, Math.PI * 2);
              fg.fill();
            }
          }
          const lit = fg.createLinearGradient(0, top, 0, top + px);
          lit.addColorStop(0, 'rgba(255,250,240,0.12)');
          lit.addColorStop(0.3, 'rgba(255,250,240,0)');
          lit.addColorStop(1, 'rgba(0,0,0,0.12)');
          fg.fillStyle = lit;
          fg.fillRect(0, top, cw, px);
        });
      }
      g.drawImage(f, 0, 0);
      g.strokeStyle = 'rgba(30,28,26,0.6)';
      g.lineWidth = Math.max(1, px * 0.02);
      g.lineJoin = 'round';
      line.words.forEach((w, i) => g.strokeText(w.text, words[i].x0, base(i)));
      return c;
    };
    const slab: Slab = { canvas: make(false), wet: make(true), words, face: { x: fx, y: pad, w: textW, h: lh * rows.length }, px };
    this.slabs.set(key, slab);
    if (this.slabs.size > 18) this.slabs.delete(this.slabs.keys().next().value!);
    return slab;
  }

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    const variant = String(p.variant ?? 'song');
    const blue = variant === 'blueprint';
    const s = wordStream(ctx, 6, 1);
    const np = lyricsFeed.now;
    const frac = np.durationMs > 0 ? Math.min(1, Math.max(0, (s.now * 1000) / np.durationMs)) : 0.5;
    // Time of day: dawn → noon → dusk → night over the song (or fixed).
    const tod = variant === 'day' ? 0.4 : variant === 'night' ? 1 : frac;
    const night = Math.max(0, Math.min(1, (tod - 0.72) / 0.2));
    const drop = ctx.env.drop;
    const shake = (drop * 0.012 + ctx.env.kick * 0.002 * num(p.react, 1)) * H;
    const sx = Math.sin(ctx.time * 53) * shake;
    const sy = Math.cos(ctx.time * 41) * shake;

    // ---- Sky ----
    if (blue) {
      g.fillStyle = '#1d4f9c';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(200,225,255,0.12)';
      g.lineWidth = 1;
      const grid = H / 24;
      for (let x = 0; x < W; x += grid) g.fillRect(x, 0, 1, H);
      for (let y = 0; y < H; y += grid) g.fillRect(0, y, W, 1);
    } else {
      const stops =
        tod < 0.35 ? mix(SKY.dawn[0], SKY.noon[0], tod / 0.35) : tod < 0.7 ? mix(SKY.noon[0], SKY.dusk[0], (tod - 0.35) / 0.35) : mix(SKY.dusk[0], SKY.night[0], Math.min(1, (tod - 0.7) / 0.2));
      const horizonC =
        tod < 0.35 ? mix(SKY.dawn[1], SKY.noon[1], tod / 0.35) : tod < 0.7 ? mix(SKY.noon[1], SKY.dusk[1], (tod - 0.35) / 0.35) : mix(SKY.dusk[1], SKY.night[1], Math.min(1, (tod - 0.7) / 0.2));
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, rgb(stops));
      sky.addColorStop(1, rgb(horizonC));
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      // The sun crosses the sky; at night, sodium lamps glow low.
      if (night < 1) {
        const a = Math.PI * (1 - Math.min(1, tod / 0.85));
        const sunX = W * (0.5 + Math.cos(a) * 0.42);
        const sunY = H * (0.75 - Math.sin(a) * 0.6);
        const halo = g.createRadialGradient(sunX, sunY, H * 0.035, sunX, sunY, H * 0.12);
        halo.addColorStop(0, `rgba(255,244,214,${0.35 * (1 - night)})`);
        halo.addColorStop(1, 'rgba(255,244,214,0)');
        g.fillStyle = halo;
        g.fillRect(sunX - H * 0.12, sunY - H * 0.12, H * 0.24, H * 0.24);
        g.fillStyle = `rgba(255,250,236,${1 - night})`;
        g.beginPath();
        g.arc(sunX, sunY, H * 0.035, 0, Math.PI * 2);
        g.fill();
      }
      if (night > 0) {
        const glow = g.createRadialGradient(W * 0.5, H * 1.1, 0, W * 0.5, H * 1.1, H * 0.9);
        glow.addColorStop(0, `rgba(255,150,40,${0.45 * night})`);
        glow.addColorStop(1, 'rgba(255,150,40,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);
      }
    }

    g.save();
    g.translate(sx, sy);
    // ---- The line being cast, big; finished lines below it, smaller, as the tower. ----
    const cur = s.current >= 0 ? s.lines[s.current] : null;
    const next = s.lines.find((l) => l.index > (cur?.index ?? -1) && l.start > s.now);
    const casting = cur ?? (next && next.start - s.now < 2 ? next : null);
    const zoom = 1 - 0.25 * frac * num(p.pullback, 1);
    const castPx = Math.round(H * 0.092 * zoom * (casting?.chorus && s.synced ? 1.22 : 1));
    const castW = W * 0.86;
    const towerPx = Math.round(H * 0.075 * zoom);
    const castTop = H * 0.16;
    const castSlab = casting ? this.slab(casting, castPx, castW, blue) : null;
    const finished = s.lines.filter((l) => l !== casting && l.end <= s.now + 0.001 && (!casting || l.index < casting.index));
    let y = castTop + (castSlab ? castSlab.canvas.height : H * 0.2) + H * 0.03;
    const stack = finished.slice(-4);
    for (let k = stack.length - 1; k >= 0; k--) {
      const l = stack[k];
      const age = stack.length - 1 - k;
      const sl = this.slab(l, towerPx, W * 2, blue, true);
      const kx = Math.min(1, (W * 0.84) / sl.canvas.width);
      const w = sl.canvas.width * kx;
      const h = sl.canvas.height * kx;
      const x = (W - w) / 2;
      // The line just finished is craned down from where it was cast.
      const since = casting ? s.now - casting.start : 9;
      g.globalAlpha = 1 - age * 0.18;
      if (k === stack.length - 1 && since >= -0.2 && since < 0.6) {
        const big = this.slab(l, castPx, castW, blue);
        const t = ease((since + 0.2) / 0.8);
        const bx = (W - big.canvas.width) / 2;
        g.drawImage(big.canvas, bx + (x - bx) * t, castTop + (y - castTop) * t, big.canvas.width + (w - big.canvas.width) * t, big.canvas.height + (h - big.canvas.height) * t);
      } else {
        // Each finished line is a floor of the tower: a dark concrete beam, the words in light relief.
        if (!blue) {
          const beam = g.createLinearGradient(0, y, 0, y + h);
          beam.addColorStop(0, '#5a5650');
          beam.addColorStop(1, '#3e3b37');
          g.fillStyle = beam;
          g.fillRect(W * 0.06, y, W * 0.88, h * 0.96);
          g.fillStyle = 'rgba(255,250,240,0.18)';
          g.fillRect(W * 0.06, y, W * 0.88, Math.max(1, h * 0.04));
          // A chorus floor juts out on a plinth.
          if (l.chorus && s.synced) {
            g.fillStyle = '#6e6a63';
            g.fillRect(W * 0.04, y + h * 0.82, W * 0.92, h * 0.16);
          }
        }
        g.drawImage(sl.canvas, x, y, w, h);
        if (night > 0 && !blue) {
          g.fillStyle = `rgba(8,8,16,${0.55 * night})`;
          g.fillRect(x, y, w, h);
          this.windows(g, sl, x, y, kx, night, l.index, drop);
        }
      }
      g.globalAlpha = 1;
      y += h * 0.98;
      if (y > H * 1.1) break;
    }
    // The ground under the tower while it's short enough to see it.
    if (y < H) {
      g.fillStyle = blue ? 'rgba(235,245,255,0.9)' : night > 0.5 ? '#16120f' : '#6a6157';
      g.fillRect(-sx - 10, y, W + 20, H - y + 20);
      if (blue) {
        g.fillStyle = '#1d4f9c';
        g.fillRect(-sx - 10, y + 2, W + 20, H - y + 20);
      } else {
        const dirt = g.createLinearGradient(0, y, 0, H);
        dirt.addColorStop(0, 'rgba(0,0,0,0.25)');
        dirt.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = dirt;
        g.fillRect(-sx - 10, y, W + 20, H - y + 20);
      }
    }
    if (casting && castSlab) this.cast(g, W, castTop, casting, castSlab, s, ctx, blue, night, () => this.crane(g, W, H, castTop, casting, castSlab, s, blue, night));
    else this.crane(g, W, H, castTop, casting, castSlab, s, blue, night);
    g.restore();

    // The drop kicks up dust.
    if (drop > 0.15 && !blue) {
      g.fillStyle = `rgba(200,190,170,${Math.min(0.35, drop * 0.4)})`;
      for (let i = 0; i < 40; i++) {
        const r = H * (0.02 + h01(`d${i}`) * 0.08) * (0.6 + drop);
        g.beginPath();
        g.arc(h01(`dx${i}`) * W + Math.sin(ctx.time + i) * 20, H * (0.75 + h01(`dy${i}`) * 0.3), r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** Tie-holes lit like windows at night (all of them when the drop lights the tower). */
  private windows(g: CanvasRenderingContext2D, sl: Slab, x: number, y: number, k: number, night: number, seed: number, drop: number): void {
    const px = sl.px;
    const step = px * 0.4;
    g.fillStyle = `rgba(255,190,90,${0.9 * night})`;
    const rows = new Set(sl.words.map((w) => w.top));
    for (const top of rows) {
      for (let ty = top + step * 0.6; ty < top + px * 0.95; ty += step) {
        for (let tx = sl.face.x + step * 0.5; tx < sl.face.x + sl.face.w; tx += step) {
          if (drop < 0.5 && h01(`w${seed}${Math.round(tx)}${Math.round(ty)}`) > 0.45) continue;
          if (!sl.words.some((w) => tx > w.x0 && tx < w.x1 && ty > w.top && ty < w.bottom)) continue;
          g.fillRect(x + (tx - px * 0.035) * k, y + (ty - px * 0.035) * k, px * 0.07 * k, px * 0.07 * k);
        }
      }
    }
  }

  /** Formwork up on the beat, concrete poured word by word, boards stripped at the end. */
  private cast(g: CanvasRenderingContext2D, W: number, top: number, line: StreamLine, sl: Slab, s: WordStream, ctx: GenContext, blue: boolean, night: number, crane: () => void): void {
    const px = sl.px;
    const x = (W - sl.canvas.width) / 2;
    const y = top;
    const spb = 60 / s.bpm;
    const last = line.words[line.words.length - 1];
    const stripAt = Math.min(line.end - 0.25, (last?.t ?? line.start) + 0.9);
    const strip = ease((s.now - stripAt) / 0.5);
    const fx = x + sl.face.x;
    const fy = y + sl.face.y;
    const fw = sl.face.w;
    const fh = sl.face.h;
    const upFrom = line.start - spb * 2;
    // The plywood form face, with the letters as dark voids waiting for concrete.
    const formUp = ease((s.now - upFrom) / (spb * 1.5));
    if (strip < 1 && formUp > 0) {
      g.save();
      g.globalAlpha = (1 - strip) * formUp;
      if (blue) {
        g.strokeStyle = 'rgba(235,245,255,0.45)';
        g.setLineDash([8, 6]);
        g.strokeRect(fx - px * 0.3, fy - px * 0.15, fw + px * 0.6, fh + px * 0.3);
        g.setLineDash([]);
      } else {
        const ply = g.createLinearGradient(0, fy, 0, fy + fh);
        const dim = 1 - 0.55 * night;
        ply.addColorStop(0, rgb([232 * dim, 204 * dim, 156 * dim]));
        ply.addColorStop(1, rgb([206 * dim, 168 * dim, 112 * dim]));
        g.fillStyle = ply;
        g.fillRect(fx - px * 0.3, fy - px * 0.15, fw + px * 0.6, fh + px * 0.3);
        g.fillStyle = 'rgba(120,80,40,0.25)';
        for (let k = 1; k < 4; k++) g.fillRect(fx - px * 0.3 + ((fw + px * 0.6) * k) / 4, fy - px * 0.15, 1.5, fh + px * 0.3);
      }
      if (!blue) {
        g.font = fontCss('wide', px);
        g.textBaseline = 'alphabetic';
        g.fillStyle = 'rgba(40,28,16,0.88)';
        line.words.forEach((w, i) => g.fillText(w.text, x + sl.words[i].x0, y + sl.words[i].top + px * 0.95));
      }
      g.restore();
    }
    // The crane and its skip sit behind the concrete: the stream runs down into the form.
    crane();
    // Concrete pours into each word as it is sung, rippling on the kick.
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const fill = ease((s.now - w.t) / Math.max(0.6, Math.min(1.2, w.end - w.t)));
      if (fill <= 0) continue;
      const box = sl.words[i];
      const level = (box.bottom - box.top) * fill;
      const ripple = ctx.env.kick * px * 0.05 * (1 - strip);
      const x0 = x + box.x0 - 2;
      const x1 = x + box.x1 + px * 0.2;
      const yb = y + box.bottom + px * 0.2;
      const yl = y + box.bottom - level;
      g.save();
      g.beginPath();
      g.moveTo(x0, yb);
      g.lineTo(x0, yl);
      for (let k = 0; k <= 12; k++) g.lineTo(x0 + ((x1 - x0) * k) / 12, yl + Math.sin(k * 1.7 + ctx.time * 18) * ripple);
      g.lineTo(x1, yb);
      g.closePath();
      g.clip();
      g.drawImage(strip > 0.5 || blue ? sl.canvas : sl.wet, x, y);
      g.restore();
    }
    if (strip >= 1 && night > 0 && !blue) this.windows(g, sl, x, y, 1, night, line.index, ctx.env.drop);
    // Timber boards: up one per beat before the line, flying off when it has set.
    const boards = 8;
    for (let b = 0; b < boards; b++) {
      const shown = (s.now - (upFrom + (b * spb * 2) / boards)) / 0.15;
      if (shown <= 0) continue;
      const off = strip * (b % 2 ? 1 : -1) * W * 0.4;
      const fall = strip * strip * px * 6;
      const rot = strip * (h01(`r${b}`) - 0.5) * 1.2;
      const horiz = b < 4;
      const bw = horiz ? fw + px * 0.9 : px * 0.24;
      const bh = horiz ? px * 0.22 : fh + px * 0.75;
      const bx = horiz ? fx - px * 0.45 : b % 2 ? fx + fw + px * 0.21 : fx - px * 0.45;
      const by = horiz ? (b % 2 ? fy - px * 0.37 : fy + fh + px * 0.15) : fy - px * 0.37;
      g.save();
      g.globalAlpha = Math.min(1, shown) * (1 - strip * 0.6);
      g.translate(bx + bw / 2 + off, by + bh / 2 + fall);
      g.rotate(rot);
      if (blue) {
        g.strokeStyle = 'rgba(235,245,255,0.8)';
        g.setLineDash([6, 5]);
        g.lineWidth = 1.5;
        g.strokeRect(-bw / 2, -bh / 2, bw, bh);
        g.setLineDash([]);
      } else {
        const wood = g.createLinearGradient(0, -bh / 2, 0, bh / 2);
        wood.addColorStop(0, '#c9a06a');
        wood.addColorStop(1, '#94703f');
        g.fillStyle = wood;
        g.fillRect(-bw / 2, -bh / 2, bw, bh);
        g.strokeStyle = 'rgba(80,52,20,0.7)';
        g.lineWidth = 1;
        g.strokeRect(-bw / 2, -bh / 2, bw, bh);
        g.fillStyle = 'rgba(40,30,20,0.85)';
        for (let n = 0; n < 8; n++) {
          const nx = horiz ? -bw / 2 + (bw * (n + 0.5)) / 8 : 0;
          const ny = horiz ? 0 : -bh / 2 + (bh * (n + 0.5)) / 8;
          g.fillRect(nx - 1.5, ny - 1.5, 3, 3);
        }
      }
      g.restore();
    }
    // At night a floodlight washes the form.
    if (night > 0 && !blue) {
      const cone = g.createRadialGradient(fx + fw / 2, fy - px * 1.5, px * 0.3, fx + fw / 2, fy + fh * 0.4, fw * 0.75);
      cone.addColorStop(0, `rgba(255,236,190,${0.32 * night})`);
      cone.addColorStop(1, 'rgba(255,236,190,0)');
      g.save();
      g.globalCompositeOperation = 'screen';
      g.fillStyle = cone;
      g.fillRect(fx - px * 2, fy - px * 2.5, fw + px * 4, fh + px * 4);
      g.restore();
    }
    // Blueprint: a dimension line under the line.
    if (blue) {
      g.strokeStyle = 'rgba(235,245,255,0.8)';
      g.fillStyle = 'rgba(235,245,255,0.9)';
      g.lineWidth = 1;
      const dy = fy + fh + px * 0.5;
      g.beginPath();
      g.moveTo(fx, dy);
      g.lineTo(fx + fw, dy);
      g.stroke();
      g.font = fontCss('mono', Math.round(px * 0.18));
      g.textAlign = 'center';
      g.fillText(`${(fw / px).toFixed(2)} m`, fx + fw / 2, dy - 8);
      g.textAlign = 'left';
    }
  }

  /** A tower crane: lattice mast, jib over the line, the skip pouring into the word being sung. */
  private crane(g: CanvasRenderingContext2D, W: number, H: number, top: number, line: StreamLine | null, sl: Slab | null, s: WordStream, blue: boolean, night: number): void {
    const mastX = W * 0.955;
    const jibY = top - H * 0.16;
    const col = blue ? 'rgba(235,245,255,0.85)' : night > 0.5 ? '#2a2420' : '#e0a21a';
    g.strokeStyle = col;
    g.lineWidth = Math.max(1.5, H * 0.004);
    const mw = H * 0.035;
    g.beginPath();
    g.moveTo(mastX - mw / 2, H);
    g.lineTo(mastX - mw / 2, jibY);
    g.moveTo(mastX + mw / 2, H);
    g.lineTo(mastX + mw / 2, jibY);
    for (let yy = jibY; yy < H; yy += mw) {
      g.moveTo(mastX - mw / 2, yy);
      g.lineTo(mastX + mw / 2, yy + mw);
      g.moveTo(mastX - mw / 2, yy);
      g.lineTo(mastX + mw / 2, yy);
    }
    // Jib to the left, counter-jib to the right.
    g.moveTo(mastX + W * 0.08, jibY);
    g.lineTo(W * 0.06, jibY);
    g.moveTo(mastX + W * 0.08, jibY + mw * 0.8);
    g.lineTo(W * 0.06, jibY + mw * 0.8);
    for (let xx = W * 0.06; xx < mastX + W * 0.08; xx += mw * 1.2) {
      g.moveTo(xx, jibY);
      g.lineTo(xx + mw * 0.6, jibY + mw * 0.8);
      g.lineTo(xx + mw * 1.2, jibY);
    }
    g.moveTo(mastX, jibY);
    g.lineTo(mastX, jibY - mw * 2.2);
    g.lineTo(W * 0.1, jibY);
    g.stroke();
    if (!blue) {
      g.fillStyle = night > 0.5 ? '#1a1614' : '#6d6a66';
      g.fillRect(mastX + W * 0.035, jibY - mw * 0.2, W * 0.04, mw * 1.4);
    }
    if (!line || !sl) return;
    const px = sl.px;
    // The skip over the word being sung.
    const cur = [...line.words].reverse().find((w) => w.t <= s.now + 0.25) ?? line.words[0];
    if (!cur) return;
    const lx = (W - sl.canvas.width) / 2;
    const span = sl.words[cur.i];
    if (!span) return;
    const tx = lx + (span.x0 + span.x1) / 2;
    const prev = line.words[cur.i - 1];
    const fromX = prev ? lx + (sl.words[prev.i].x0 + sl.words[prev.i].x1) / 2 : tx;
    const k = ease((s.now - (cur.t - 0.25)) / 0.25);
    const hx = fromX + (tx - fromX) * k;
    const hy = top - px * 0.62;
    g.strokeStyle = blue ? 'rgba(235,245,255,0.7)' : '#222';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(hx, jibY + mw * 0.8);
    g.lineTo(hx, hy);
    g.stroke();
    g.fillStyle = blue ? 'rgba(235,245,255,0.2)' : '#555a5f';
    g.beginPath();
    g.moveTo(hx - px * 0.35, hy);
    g.lineTo(hx + px * 0.35, hy);
    g.lineTo(hx + px * 0.12, hy + px * 0.45);
    g.lineTo(hx - px * 0.12, hy + px * 0.45);
    g.closePath();
    g.fill();
    if (blue) g.stroke();
    // Concrete stream while the word fills.
    const pour = s.now - cur.t;
    if (pour > -0.05 && pour < Math.max(0.6, Math.min(1.2, cur.end - cur.t)) && !blue) {
      g.fillStyle = 'rgba(80,80,84,0.9)';
      g.fillRect(hx - px * 0.05, hy + px * 0.45, px * 0.1, top + span.bottom - hy - px * 0.5);
    }
  }
}
