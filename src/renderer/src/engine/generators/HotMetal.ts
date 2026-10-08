import type { GenContext } from './Generator';
import { CanvasLook } from './CanvasLook';
import { fontCss } from './KineticType';
import { num } from './ShaderGenerator';
import { songTitle } from '../lyricsFeed';
import { wordHash, wordStream, type StreamLine, type WordStream } from '../wordStream';

/**
 * Hot Metal: hot-metal typesetting and letterpress. Each word's brass
 * matrices drop into the composing stick as it is sung, clicking in rhythm;
 * spacebands widen to justify the line. When the next line begins, the line
 * is cast (a hot glow, a lead slug), inked and struck onto cotton paper: a
 * deep impression, ink squeezed at the edges, a touch of misregistration. The
 * line's hero word prints in wood type; choruses add a second colour. Proof
 * press stacks the lines on a sheet, Poster prints the line huge with the
 * hero word in giant wood type, Newsroom sets lines as headlines and columns.
 */

const INK = '#1b1820';
const RED = '#c4321f';
const PAPER = ['#f3ead6', '#e9dcc0'];

const ease = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const h01 = (s: string, k: number): number => (wordHash(`${s}#${k}`) % 10000) / 10000;

interface Printed {
  line: StreamLine;
  /** When it was struck (song s). */
  at: number;
}

export class HotMetal extends CanvasLook {
  readonly kind = 'hotMetal';
  private paper: HTMLCanvasElement | null = null;
  private grain: CanvasPattern | null = null;
  private bench: HTMLCanvasElement | null = null;

  protected resized(W: number, H: number): void {
    // Cotton paper: warm base, fibres, a soft vignette.
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const base = g.createRadialGradient(W * 0.5, H * 0.45, H * 0.1, W * 0.5, H * 0.5, W * 0.75);
    base.addColorStop(0, PAPER[0]);
    base.addColorStop(1, PAPER[1]);
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < (W * H) / 900; i++) {
      const x = h01('fx', i) * W;
      const y = h01('fy', i) * H;
      const a = h01('fa', i) * Math.PI;
      const l = 3 + h01('fl', i) * 14;
      g.strokeStyle = `rgba(${120 + h01('fc', i) * 60},${100 + h01('fd', i) * 50},70,${0.05 + h01('fo', i) * 0.08})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    this.paper = c;
    // Wood grain for wood type.
    const w = document.createElement('canvas');
    w.width = 256;
    w.height = 256;
    const wg = w.getContext('2d')!;
    // Paper-coloured streaks: where the grain held no ink.
    for (let y = 0; y < 256; y += 2 + Math.round(h01('sp', y) * 3)) {
      wg.strokeStyle = `rgba(243,234,214,${0.12 + 0.3 * h01('g', y)})`;
      wg.lineWidth = 1 + h01('w', y) * 1.5;
      wg.beginPath();
      // Periodic across the tile, so the grain never shows a seam.
      for (let x = 0; x <= 256; x += 4) wg.lineTo(x, y + Math.sin((x / 256) * Math.PI * 2 * 2 + y * 0.11) * 3 + Math.sin((x / 256) * Math.PI * 2 + y * 0.37) * 4);
      wg.stroke();
    }
    this.grain = this.g.createPattern(w, 'repeat');
    // The press bed: dark iron with a little texture.
    const b = document.createElement('canvas');
    b.width = W;
    b.height = H;
    const bg = b.getContext('2d')!;
    const iron = bg.createLinearGradient(0, 0, 0, H);
    iron.addColorStop(0, '#2a2622');
    iron.addColorStop(1, '#141210');
    bg.fillStyle = iron;
    bg.fillRect(0, 0, W, H);
    for (let i = 0; i < (W * H) / 300; i++) {
      bg.fillStyle = `rgba(255,240,220,${h01('n', i) * 0.035})`;
      bg.fillRect(h01('nx', i) * W, h01('ny', i) * H, 1.5, 1.5);
    }
    this.bench = b;
  }

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    const variant = String(p.variant ?? 'proof');
    const s = wordStream(ctx, 7, 1);
    if (!this.paper) this.resized(W, H);
    const cur = s.current >= 0 ? s.lines[s.current] : null;
    // A line is struck when the next one begins (a still title: once, a beat in).
    const strikeAt = (l: StreamLine): number => {
      const next = s.lines.find((x) => x.index > l.index);
      return next ? next.start : s.synced ? l.end : l.start + 0.6;
    };
    const printed: Printed[] = s.lines.filter((l) => strikeAt(l) <= s.now).map((l) => ({ line: l, at: strikeAt(l) }));
    const setting = cur && strikeAt(cur) > s.now ? cur : null;
    const weight = Math.min(1.3, 0.75 + 0.5 * ctx.env.energy) * num(p.impression, 1);
    const strikeAge = printed.length ? s.now - printed[printed.length - 1].at : 99;

    if (p.overlay === true) {
      this.strip(g, W, H, s, printed, setting, strikeAge);
      return;
    }
    g.drawImage(this.bench!, 0, 0);
    if (variant === 'poster') {
      this.poster(g, W, H, s, printed, setting, ctx);
    } else {
      const stickH = H * (variant === 'newsroom' ? 0.24 : 0.3);
      if (variant === 'newsroom') this.newspaper(g, W, H, stickH, printed, s);
      else this.sheet(g, W, H, stickH, printed, s, weight);
      this.stick(g, W, stickH, setting, s);
    }
    // The platen comes down: a shadow sweeps the sheet and the frame jolts.
    if (strikeAge < 0.22) {
      const k = 1 - strikeAge / 0.22;
      g.fillStyle = `rgba(10,8,6,${0.35 * k * k})`;
      g.fillRect(0, 0, W, H);
    }
    // The drop pulls a proof with an ink spatter.
    const drop = ctx.env.drop;
    if (drop > 0.2) {
      const seed = Math.floor(s.now / 8);
      g.fillStyle = `rgba(27,24,32,${Math.min(0.85, drop)})`;
      for (let i = 0; i < 26; i++) {
        const x = h01(`sx${seed}`, i) * W;
        const y = H * 0.35 + h01(`sy${seed}`, i) * H * 0.6;
        const r = H * 0.004 + Math.pow(h01(`sr${seed}`, i), 3) * H * 0.03;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** The composing stick with this line's brass matrices. */
  private stick(g: CanvasRenderingContext2D, W: number, H: number, line: StreamLine | null, s: WordStream): void {
    // Machine body and the steel stick.
    const body = g.createLinearGradient(0, 0, 0, H);
    body.addColorStop(0, '#3a3530');
    body.addColorStop(1, '#22201c');
    g.fillStyle = body;
    g.fillRect(0, 0, W, H);
    const sy = H * 0.72;
    const sh = H * 0.12;
    const steel = g.createLinearGradient(0, sy, 0, sy + sh);
    steel.addColorStop(0, '#c9ccd0');
    steel.addColorStop(0.5, '#7d828a');
    steel.addColorStop(1, '#4a4e55');
    g.fillStyle = steel;
    g.fillRect(W * 0.04, sy, W * 0.92, sh);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (const bx of [0.06, 0.94]) {
      g.beginPath();
      g.arc(W * bx, sy + sh / 2, sh * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, H - H * 0.02, W, H * 0.02);
    if (!line) return;
    // Matrices: a brass mould per letter, a spaceband between words.
    const words = line.words;
    const chars = words.reduce((n, w) => n + [...w.text].length, 0) + Math.max(0, words.length - 1) * 0.6;
    const avail = W * 0.86;
    // Big moulds; a long line scrolls through the stick as it is set.
    const mh = Math.min(H * 0.46, (avail / Math.max(6, chars)) * 1.6 * 2.2);
    const mw = mh * 0.62;
    const px = Math.round(mh * 0.62);
    const last = words[words.length - 1];
    const lineEnd = last ? last.t + 0.35 : line.start;
    const justify = ease((s.now - lineEnd) / 0.25);
    const natural = chars * mw;
    const extra = words.length > 1 && natural < avail ? ((avail - natural) * justify) / (words.length - 1) : 0;
    // Where the last dropped letter sits, to keep it in view.
    let reach = 0;
    {
      let xx = 0;
      words.forEach((w, wi) => {
        [...w.text].forEach((_, ci) => {
          if (s.now >= w.t + ci * 0.035) reach = xx + mw;
          xx += mw;
        });
        if (wi < words.length - 1) xx += mw * 0.6;
      });
    }
    const shift = natural > avail ? Math.min(natural - avail, Math.max(0, reach + mw * 1.5 - avail)) : 0;
    g.save();
    g.beginPath();
    g.rect(W * 0.07 - mw * 0.2, 0, avail + mw * 0.4, H);
    g.clip();
    let x = W * 0.07 - shift;
    const baseY = sy - mh * 0.02;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = fontCss('book', px);
    const hot = Math.max(0, Math.min(1, (s.now - (lineEnd + 0.4)) / 0.5));
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      const glyphs = [...w.text];
      glyphs.forEach((ch, ci) => {
        const t0 = w.t + ci * 0.035;
        const age = s.now - t0;
        if (age < 0) return;
        // Drop from the magazine with a small bounce.
        const fall = age < 0.16 ? 1 - ease(age / 0.16) : 0;
        const bounce = age >= 0.16 && age < 0.3 ? Math.sin(((age - 0.16) / 0.14) * Math.PI) * mh * 0.06 : 0;
        const y = baseY - mh - fall * H * 0.45 - bounce;
        this.matrix(g, x, y, mw * 0.94, mh, ch, px, hot);
        x += mw;
      });
      if (wi < words.length - 1) {
        // Spaceband: a steel wedge that widens to justify the line.
        const sw = mw * 0.6 + extra;
        if (s.now >= words[wi + 1].t - 0.05 || justify > 0) {
          const wedge = g.createLinearGradient(0, baseY - mh, 0, baseY);
          wedge.addColorStop(0, '#d7dade');
          wedge.addColorStop(1, '#6e737b');
          g.fillStyle = wedge;
          g.fillRect(x + sw * 0.35, baseY - mh * 0.92, Math.max(2, sw * 0.3), mh * 0.92);
        }
        x += sw;
      }
    }
    g.restore();
    // The line fades into the machine at the ends of the stick (no hard clip).
    for (const [ex, dir] of [
      [W * 0.07 - mw * 0.2, 1],
      [W * 0.07 + avail + mw * 0.2, -1],
    ] as const) {
      const fade = g.createLinearGradient(ex, 0, ex + dir * mw * 1.2, 0);
      fade.addColorStop(0, 'rgba(34,32,28,1)');
      fade.addColorStop(1, 'rgba(34,32,28,0)');
      g.fillStyle = fade;
      g.fillRect(Math.min(ex, ex + dir * mw * 1.2), baseY - mh * 1.6, mw * 1.2, mh * 1.6);
    }
    // The cast slug: lead with the letters raised and mirrored, glowing as it sets.
    if (hot > 0) {
      g.save();
      g.globalAlpha = Math.min(1, hot * 1.5);
      // The slug stays inside the machine, whatever the stick's height.
      const slugY = Math.min(baseY + sh + mh * 0.15, H - mh * 0.5 - 2);
      const lead = g.createLinearGradient(0, slugY, 0, slugY + mh * 0.5);
      lead.addColorStop(0, '#b9bcc2');
      lead.addColorStop(1, '#6a6e76');
      g.fillStyle = lead;
      g.fillRect(W * 0.07, slugY, avail, mh * 0.5);
      g.translate(W * 0.07 + avail / 2, slugY + mh * 0.25);
      g.scale(-1, 1);
      g.font = fontCss('book', Math.round(px * 0.7));
      g.fillStyle = '#4a4d53';
      g.fillText(line.text, 0, 0, avail * 0.96);
      g.restore();
      g.fillStyle = `rgba(255,120,30,${0.35 * (1 - hot) + 0.1})`;
      g.fillRect(W * 0.07, Math.min(baseY + sh + mh * 0.15, H - mh * 0.5 - 2), avail, mh * 0.5);
    }
  }

  /** One brass matrix: bevelled, with the letter engraved (right-reading, as the moulds are read). */
  private matrix(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ch: string, px: number, hot: number): void {
    // The ears at the top that hang the matrix in the magazine, and its edge thickness.
    g.fillStyle = '#9a6d26';
    g.fillRect(x - w * 0.06, y + h * 0.04, w * 0.14, h * 0.1);
    g.fillRect(x + w * 0.92, y + h * 0.04, w * 0.14, h * 0.1);
    g.fillStyle = '#6b4714';
    g.fillRect(x + w, y + h * 0.06, Math.max(1.5, w * 0.06), h * 0.94);
    const brass = g.createLinearGradient(x, y, x + w, y + h);
    brass.addColorStop(0, '#f6dc8c');
    brass.addColorStop(0.45, '#cf9f45');
    brass.addColorStop(1, '#8c6221');
    g.fillStyle = brass;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,248,210,0.55)';
    g.fillRect(x, y, w, Math.max(1, h * 0.03));
    g.fillRect(x, y, Math.max(1, w * 0.04), h);
    g.fillStyle = 'rgba(60,35,5,0.55)';
    g.fillRect(x, y + h - Math.max(1, h * 0.03), w, Math.max(1, h * 0.03));
    g.fillRect(x + w - Math.max(1, w * 0.04), y, Math.max(1, w * 0.04), h);
    // The notches the machine reads at the top.
    g.fillStyle = 'rgba(40,25,5,0.7)';
    g.fillRect(x + w * 0.2, y + h * 0.06, w * 0.15, h * 0.08);
    g.fillRect(x + w * 0.62, y + h * 0.06, w * 0.15, h * 0.08);
    // The engraved letter: dark recess, a lit lower edge.
    const cx = x + w / 2;
    const cy = y + h * 0.58;
    g.fillStyle = 'rgba(255,236,170,0.8)';
    g.fillText(ch, cx + px * 0.025, cy + px * 0.03);
    g.fillStyle = '#3f2806';
    g.fillText(ch, cx, cy);
    if (hot > 0) {
      g.fillStyle = `rgba(255,${110 + 80 * hot},40,${0.45 * hot})`;
      g.fillRect(x, y, w, h);
    }
  }

  /** Ink on paper: the impression, squeezed ink, worn type, a little misregistration. */
  private ink(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, depth: number, seed: string, wood = false, maxW?: number): void {
    g.font = font;
    const dx = (h01(seed, 1) - 0.5) * 2.2;
    const dy = (h01(seed, 2) - 0.5) * 1.6;
    // Deboss: paper pushed down (a light lower edge, a shadowed upper edge).
    g.fillStyle = `rgba(255,255,250,${0.55 * depth})`;
    g.fillText(text, x + 1.2, y + 1.6, maxW);
    g.fillStyle = `rgba(60,45,25,${0.28 * depth})`;
    g.fillText(text, x - 0.8, y - 1, maxW);
    // Ink squeezed out at the edges.
    g.strokeStyle = color;
    g.globalAlpha = 0.22 * depth;
    g.lineWidth = 1.6 * depth;
    g.lineJoin = 'round';
    g.strokeText(text, x + dx, y + dy, maxW);
    g.globalAlpha = 0.92;
    g.fillStyle = color;
    g.fillText(text, x + dx, y + dy, maxW);
    if (wood && this.grain) {
      g.fillStyle = this.grain;
      g.fillText(text, x + dx, y + dy, maxW);
    }
    g.globalAlpha = 1;
  }

  /** Proof press: the struck lines stacked on a cotton sheet. */
  private sheet(g: CanvasRenderingContext2D, W: number, H: number, top: number, printed: Printed[], s: WordStream, weight: number): void {
    const mx = W * 0.08;
    const sy = top + H * 0.04;
    const sw = W - mx * 2;
    const sh = H - sy - H * 0.03;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = H * 0.03;
    g.shadowOffsetY = H * 0.008;
    g.drawImage(this.paper!, 0, 0, W, H, mx, sy, sw, sh);
    g.restore();
    g.save();
    g.beginPath();
    g.rect(mx, sy, sw, sh);
    g.clip();
    const rows = 5;
    const lh = sh / (rows + 0.6);
    const shown = printed.slice(-rows);
    const latest = printed[printed.length - 1];
    // A new line pushes the stack up.
    const slide = latest ? ease((s.now - latest.at) / 0.35) : 1;
    shown.forEach((pr, k) => {
      const y = sy + lh * (k + 1) + (1 - slide) * lh * (shown.length >= rows ? 1 : 0);
      const fresh = pr === latest ? Math.min(1, (s.now - pr.at) / 0.12) : 1;
      this.printedLine(g, pr.line, mx + sw * 0.06, y, sw * 0.88, lh * 0.62, weight * (0.6 + 0.4 * fresh), pr.line.chorus);
    });
    g.restore();
  }

  /** A struck line: book face, the hero word in wood type (a second colour in the chorus). */
  private printedLine(g: CanvasRenderingContext2D, line: StreamLine, x: number, y: number, maxW: number, px: number, depth: number, chorus: boolean): void {
    const words = line.text.split(/\s+/).filter(Boolean);
    const hero = line.hero >= 0 && line.hero < words.length ? line.hero : -1;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    const book = fontCss('garamond', Math.round(px * 0.72));
    const wood = fontCss('wood', Math.round(px * 1.15));
    const widths = words.map((w, i) => {
      g.font = i === hero ? wood : book;
      return g.measureText(w).width;
    });
    const space = px * 0.28;
    const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
    const k = Math.min(1, maxW / Math.max(1, total));
    let cx = x + (maxW - total * k) / 2;
    words.forEach((w, i) => {
      const isHero = i === hero;
      const f = isHero ? fontCss('wood', Math.round(px * 1.15 * k)) : fontCss('garamond', Math.round(px * 0.72 * k));
      this.ink(g, w, cx, y, f, isHero && chorus ? RED : INK, depth, `${line.index}:${i}`, isHero);
      cx += (widths[i] + space) * k;
    });
  }

  /** Newsroom: the song's name as the nameplate, the struck line as the headline, earlier lines in columns with a pull-quote. */
  private newspaper(g: CanvasRenderingContext2D, W: number, H: number, top: number, printed: Printed[], s: WordStream): void {
    const mx = W * 0.07;
    const sy = top + H * 0.03;
    const sw = W - mx * 2;
    const sh = H - sy - H * 0.03;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = H * 0.03;
    g.shadowOffsetY = H * 0.008;
    g.drawImage(this.paper!, 0, 0, W, H, mx, sy, sw, sh);
    g.restore();
    g.save();
    g.beginPath();
    g.rect(mx, sy, sw, sh);
    g.clip();
    const pad = sw * 0.035;
    const inner = sw - pad * 2;
    let y = sy + sh * 0.03;
    g.textBaseline = 'alphabetic';
    // Nameplate: the playing song, between rules.
    const name = songTitle();
    const np = Math.round(sh * 0.075);
    g.fillStyle = INK;
    g.fillRect(mx + pad, y, inner, Math.max(2, H * 0.003));
    if (name) {
      g.textAlign = 'center';
      this.ink(g, name.toUpperCase(), mx + sw / 2, y + np * 1.08, fontCss('garamond', np), INK, 0.8, `np${name}`, false, inner);
      y += np * 1.32;
    } else y += sh * 0.02;
    g.fillStyle = INK;
    g.fillRect(mx + pad, y, inner, Math.max(1, H * 0.0015));
    g.fillRect(mx + pad, y + Math.max(3, H * 0.004), inner, Math.max(2, H * 0.003));
    y += sh * 0.02;
    const latest = printed[printed.length - 1];
    if (latest) {
      // Headline, fitted to the width, centred.
      const fresh = Math.min(1, (s.now - latest.at) / 0.12);
      g.font = fontCss('wood', 100);
      const hk = Math.min((inner * 0.98) / Math.max(1, g.measureText(latest.line.text).width), (sh * 0.2) / 100);
      const hp = Math.round(100 * hk);
      g.textAlign = 'center';
      this.ink(g, latest.line.text, mx + sw / 2, y + hp * 0.98, fontCss('wood', hp), latest.line.chorus ? RED : INK, 0.6 + 0.5 * fresh, `h${latest.line.index}`, false, inner);
      y += hp * 1.18;
      g.fillStyle = INK;
      g.fillRect(mx + pad, y, inner, Math.max(1, H * 0.0015));
      y += sh * 0.035;
      // Two columns: earlier lines as body text, and a pull-quote of the hero word.
      const gap = inner * 0.05;
      const cw = (inner - gap) / 2;
      const bp = Math.round(sh * 0.052);
      const body = fontCss('book', bp);
      const bottom = sy + sh - sh * 0.04;
      g.textAlign = 'left';
      g.font = body;
      let by = y + bp;
      const colX = mx + pad;
      for (const pr of printed.slice(0, -1).reverse()) {
        let row = '';
        let full = false;
        for (const w of pr.line.text.split(/\s+/)) {
          const next = row ? `${row} ${w}` : w;
          if (row && g.measureText(next).width > cw) {
            if (by > bottom) {
              full = true;
              break;
            }
            this.ink(g, row, colX, by, body, INK, 0.7, `c${pr.line.index}${row}`);
            by += bp * 1.28;
            row = w;
          } else row = next;
        }
        if (full || by > bottom) break;
        this.ink(g, row, colX, by, body, INK, 0.7, `c${pr.line.index}e`);
        by += bp * 1.75;
      }
      // The rule between the columns.
      g.fillStyle = 'rgba(27,24,32,0.55)';
      g.fillRect(colX + cw + gap / 2, y, 1, bottom - y);
      // Pull-quote: the line's hero word, big, between rules.
      const qx = colX + cw + gap;
      const words = latest.line.text.split(/\s+/).filter(Boolean);
      const hero = words[latest.line.hero >= 0 && latest.line.hero < words.length ? latest.line.hero : words.length - 1] ?? '';
      if (hero) {
        const qp = Math.round(sh * 0.13);
        g.font = fontCss('garamond', qp);
        const qk = Math.min(1, (cw * 0.9) / Math.max(1, g.measureText(`“${hero}”`).width));
        const qs = Math.round(qp * qk);
        g.fillStyle = INK;
        g.fillRect(qx, y + sh * 0.01, cw, Math.max(2, H * 0.003));
        g.textAlign = 'center';
        this.ink(g, `“${hero}”`, qx + cw / 2, y + sh * 0.03 + qs, fontCss('garamond', qs), latest.line.chorus ? RED : INK, 0.85, `q${latest.line.index}`, false, cw);
        g.fillStyle = INK;
        g.fillRect(qx, y + sh * 0.05 + qs * 1.15, cw, Math.max(2, H * 0.003));
        g.textAlign = 'left';
      }
    }
    g.restore();
  }

  /** Poster: the line set straight onto the poster as it is sung, the hero word in giant wood type. */
  private poster(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, printed: Printed[], setting: StreamLine | null, ctx: GenContext): void {
    const line = setting ?? printed[printed.length - 1]?.line ?? null;
    g.drawImage(this.paper!, 0, 0);
    if (!line) return;
    const words = line.words;
    const hero = line.hero >= 0 && line.hero < words.length ? line.hero : words.length - 1;
    const before = words.slice(0, hero);
    const after = words.slice(hero + 1);
    const struck = (t: number): number => (s.now >= t ? Math.min(1, 0.55 + (s.now - t) / 0.15) : 0);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const small = Math.round(H * 0.075);
    const row = (ws: typeof words, y: number): void => {
      let x =
        W / 2 -
        this.rowWidth(
          g,
          ws.map((w) => w.text),
          fontCss('garamond', small),
        ) /
          2;
      g.textAlign = 'left';
      for (const w of ws) {
        const d = struck(w.t);
        g.font = fontCss('garamond', small);
        const ww = g.measureText(w.text).width;
        if (d > 0) this.ink(g, w.text, x, y, fontCss('garamond', small), INK, d, `p${line.index}${w.i}`);
        else this.blind(g, w.text, x, y);
        x += ww + small * 0.3;
      }
    };
    if (before.length) row(before, H * 0.24);
    const hw = words[hero];
    if (hw) {
      g.font = fontCss('wood', 100);
      const k = Math.min((W * 0.86) / Math.max(1, g.measureText(hw.text).width), (H * 0.42) / 100 / 0.95);
      const hp = Math.round(100 * k);
      const d = struck(hw.t);
      g.textAlign = 'center';
      if (d > 0) this.ink(g, hw.text, W / 2, H * 0.62, fontCss('wood', hp), line.chorus ? RED : INK, d * (0.8 + 0.3 * ctx.env.energy), `ph${line.index}`, true);
      else {
        g.font = fontCss('wood', hp);
        this.blind(g, hw.text, W / 2, H * 0.62);
      }
    }
    if (after.length) row(after, H * 0.82);
  }

  /** As a lyric style over another look: a strip of cotton paper along the bottom, the line struck word by word. */
  private strip(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, printed: Printed[], setting: StreamLine | null, strikeAge: number): void {
    const line = setting ?? printed[printed.length - 1]?.line ?? null;
    if (!line || !this.paper) return;
    const w = W * 0.86;
    const h = H * 0.17;
    g.save();
    g.translate(W / 2, H * 0.845);
    g.rotate(-0.008);
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = H * 0.02;
    g.shadowOffsetY = H * 0.006;
    g.drawImage(this.paper, 0, 0, W, H * 0.2, -w / 2, -h / 2, w, h);
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    const words = line.words;
    const hero = line.hero >= 0 && line.hero < words.length ? line.hero : -1;
    const px = h * 0.42;
    const fontOf = (i: number, k = 1): string => (i === hero ? fontCss('wood', Math.round(px * 1.3 * k)) : fontCss('garamond', Math.round(px * k)));
    const widths = words.map((wd, i) => {
      g.font = fontOf(i);
      return g.measureText(wd.text).width;
    });
    const space = px * 0.3;
    const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
    const k = Math.min(1, (w * 0.92) / Math.max(1, total));
    let cx = (-total * k) / 2;
    const by = h * 0.2;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    words.forEach((wd, i) => {
      const f = fontOf(i, k);
      if (s.now >= wd.t) this.ink(g, wd.text, cx, by, f, i === hero && line.chorus ? RED : INK, Math.min(1, 0.55 + (s.now - wd.t) / 0.15), `s${line.index}:${i}`, i === hero);
      else {
        g.font = f;
        this.blind(g, wd.text, cx, by);
      }
      cx += (widths[i] + space) * k;
    });
    if (strikeAge < 0.2) {
      g.fillStyle = `rgba(10,8,6,${0.3 * (1 - strikeAge / 0.2)})`;
      g.fillRect(-w / 2, -h / 2, w, h);
    }
    g.restore();
  }

  /** A blind impression: the type pressed into the paper without ink (the words still to come). */
  private blind(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    // The paper pressed down without ink: a lit lower edge, a shadowed upper edge, a darker floor.
    g.fillStyle = 'rgba(255,255,250,0.85)';
    g.fillText(text, x + 1.6, y + 2.2);
    g.fillStyle = 'rgba(70,52,28,0.42)';
    g.fillText(text, x - 1.2, y - 1.4);
    g.fillStyle = 'rgba(150,128,96,0.32)';
    g.fillText(text, x, y);
  }

  private rowWidth(g: CanvasRenderingContext2D, ws: string[], font: string): number {
    g.font = font;
    const sp = g.measureText(' ').width;
    return ws.reduce((n, w) => n + g.measureText(w).width, 0) + sp * Math.max(0, ws.length - 1);
  }
}
