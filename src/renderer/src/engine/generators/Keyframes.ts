import type { GenContext } from './Generator';
import { CanvasLook, paletteCss } from './CanvasLook';
import { fontCss } from './KineticType';
import { songTitle } from '../lyricsFeed';
import { wordHash, wordStream, type StreamLine, type StreamWord, type WordStream } from '../wordStream';

/**
 * Keyframes: the vector animation tool behind the web cartoons of 1999–2004.
 * The timeline runs with the song and every word drops a keyframe on the
 * lyrics layer; on the stage each word arrives as a motion tween with its
 * earlier positions onion-skinned behind it, the selected symbol in blue
 * handles. At the end of a line the last word shape-tweens into the first word
 * of the next. On the chorus (or the drop) the panels vanish and the test
 * movie plays: a loader, then a vector character singing the words, its mouth
 * shaped by the letters being sung, everything moving on twos.
 */

const UI = { panel: '#d6d3ce', dark: '#a9a6a1', line: '#8d8a85', work: '#bdbdbd', cell: '#ffffff', select: '#1f5fff' };
const TWOS = 12;

const back = (x: number): number => {
  const t = Math.min(1, Math.max(0, x)) - 1;
  return 1 + 2.4 * t * t * t + 1.4 * t * t;
};
const h01 = (s: string): number => (wordHash(s) % 10000) / 10000;

interface Placed {
  w: StreamWord;
  x: number;
  y: number;
  width: number;
}

export class Keyframes extends CanvasLook {
  readonly kind = 'keyframes';

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    const variant = String(p.variant ?? 'studio');
    const s = wordStream(ctx, 1, 2);
    const line = s.current >= 0 ? s.lines[s.current] : (s.lines.find((l) => l.start > s.now) ?? null);
    const loud = (line?.chorus && s.synced) || ctx.env.drop > 0.5;
    // As a lyric style over another look: just the words tweening in, onion skins and all.
    if (p.overlay === true) {
      if (line) this.stageWords(g, W * 0.08, H * 0.52, W * 0.84, H * 0.44, s, line, 1, ctx, true);
      return;
    }
    const movie = variant === 'movie' || (loud && p.testMovie !== false);
    if (movie) this.testMovie(g, W, H, s, line, ctx, variant === 'movie');
    else this.studio(g, W, H, s, line, ctx, variant === 'onion' ? 7 : 3);
  }

  // ---------------------------------------------------------------- studio

  private studio(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, line: StreamLine | null, ctx: GenContext, onion: number): void {
    g.fillStyle = UI.work;
    g.fillRect(0, 0, W, H);
    const u = H / 100;
    // Title bar, tools on the left, the timeline on top, properties below.
    const menuH = 4.6 * u;
    const tlH = 25 * u;
    const toolsW = 7 * u;
    const propH = 11 * u;
    this.titleBar(g, W, menuH, u);
    this.timeline(g, toolsW, menuH, W - toolsW, tlH, s, ctx);
    this.tools(g, 0, menuH, toolsW, H - menuH, u);
    this.panel(g, toolsW, H - propH, W - toolsW, propH);
    this.properties(g, toolsW, H - propH, W - toolsW, propH, u, ctx);
    // The stage: a white movie on the grey work area.
    const areaX = toolsW;
    const areaY = menuH + tlH;
    const areaW = W - toolsW;
    const areaH = H - propH - areaY;
    const sw = Math.min(areaW * 0.86, areaH * 0.9 * (16 / 9));
    const sh = (sw * 9) / 16;
    const sx = areaX + (areaW - sw) / 2;
    const sy = areaY + (areaH - sh) / 2;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(sx + u * 0.5, sy + u * 0.5, sw, sh);
    g.fillStyle = '#ffffff';
    g.fillRect(sx, sy, sw, sh);
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    g.save();
    g.beginPath();
    g.rect(sx, sy, sw, sh);
    g.clip();
    this.stageArt(g, sx, sy, sw, sh, ctx);
    if (line) this.stageWords(g, sx, sy, sw, sh, s, line, onion, ctx);
    g.restore();
  }

  /** A bevelled grey panel: light top-left edges, two shades of shadow bottom-right. */
  private panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    g.fillStyle = UI.panel;
    g.fillRect(x, y, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, w, 1);
    g.fillRect(x, y, 1, h);
    g.fillStyle = '#e9e7e3';
    g.fillRect(x + 1, y + 1, w - 2, 1);
    g.fillRect(x + 1, y + 1, 1, h - 2);
    g.fillStyle = '#808080';
    g.fillRect(x + 1, y + h - 2, w - 2, 1);
    g.fillRect(x + w - 2, y + 1, 1, h - 2);
    g.fillStyle = '#404040';
    g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x + w - 1, y, 1, h);
  }

  /** The window's title bar: the playing song as the movie's name. */
  private titleBar(g: CanvasRenderingContext2D, W: number, h: number, u: number): void {
    const bar = g.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#0a246a');
    bar.addColorStop(1, '#a6caf0');
    g.fillStyle = bar;
    g.fillRect(0, 0, W, h);
    const title = songTitle();
    g.font = fontCss('heavy', Math.round(h * 0.5));
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    // A little document icon (a keyframe dot on a page), then the movie's name.
    g.fillStyle = '#ffffff';
    g.fillRect(u * 1.2, h * 0.18, h * 0.5, h * 0.64);
    g.fillStyle = '#111111';
    g.beginPath();
    g.arc(u * 1.2 + h * 0.25, h * 0.5, h * 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    if (title) g.fillText(`${title}.fla`, u * 1.2 + h * 0.8, h * 0.52, W * 0.7);
    // Window buttons.
    for (let i = 0; i < 3; i++) this.panel(g, W - (i + 1) * h * 0.95 - u * 0.4, h * 0.14, h * 0.85, h * 0.72);
  }

  private tools(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number): void {
    this.panel(g, x, y, w, h);
    const icons = 14;
    const cell = Math.min(w * 0.42, (h * 0.7) / (icons / 2));
    g.strokeStyle = '#222';
    g.fillStyle = '#222';
    g.lineWidth = Math.max(1, u * 0.18);
    for (let i = 0; i < icons; i++) {
      const cx = x + w * (i % 2 ? 0.72 : 0.28);
      const cy = y + u * 2 + cell * (Math.floor(i / 2) + 0.5) * 1.15;
      if (i === 0) {
        g.fillStyle = '#c8c4bd';
        g.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
        g.fillStyle = '#222';
      }
      const r = cell * 0.3;
      g.beginPath();
      switch (i) {
        case 0: // arrow
          g.moveTo(cx - r * 0.6, cy - r);
          g.lineTo(cx - r * 0.6, cy + r * 0.8);
          g.lineTo(cx - r * 0.1, cy + r * 0.35);
          g.lineTo(cx + r * 0.6, cy + r * 0.5);
          g.closePath();
          g.fill();
          break;
        case 1:
          g.moveTo(cx - r * 0.6, cy - r);
          g.lineTo(cx - r * 0.6, cy + r * 0.8);
          g.lineTo(cx + r * 0.6, cy + r * 0.3);
          g.closePath();
          g.stroke();
          break;
        case 2: // line
          g.moveTo(cx - r, cy + r);
          g.lineTo(cx + r, cy - r);
          g.stroke();
          break;
        case 3: // lasso
          g.ellipse(cx, cy - r * 0.2, r, r * 0.6, 0, 0, Math.PI * 2);
          g.stroke();
          break;
        case 4: // pen
          g.moveTo(cx, cy - r);
          g.lineTo(cx + r * 0.6, cy + r * 0.4);
          g.lineTo(cx, cy + r);
          g.lineTo(cx - r * 0.6, cy + r * 0.4);
          g.closePath();
          g.stroke();
          break;
        case 5: // text
          g.font = fontCss('serif', Math.round(r * 2.2));
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('A', cx, cy);
          break;
        case 6:
          g.ellipse(cx, cy, r, r * 0.75, 0, 0, Math.PI * 2);
          g.stroke();
          break;
        case 7:
          g.rect(cx - r, cy - r * 0.75, r * 2, r * 1.5);
          g.stroke();
          break;
        case 8: // pencil
          g.moveTo(cx - r, cy + r);
          g.lineTo(cx + r * 0.7, cy - r * 0.7);
          g.lineTo(cx + r, cy - r * 0.4);
          g.lineTo(cx - r * 0.7, cy + r);
          g.closePath();
          g.stroke();
          break;
        case 9: // brush
          g.ellipse(cx - r * 0.3, cy + r * 0.4, r * 0.45, r * 0.55, 0.6, 0, Math.PI * 2);
          g.fill();
          g.moveTo(cx, cy);
          g.lineTo(cx + r, cy - r);
          g.stroke();
          break;
        case 10: // ink bottle
          g.rect(cx - r * 0.6, cy - r * 0.2, r * 1.2, r * 1.1);
          g.rect(cx - r * 0.25, cy - r * 0.8, r * 0.5, r * 0.6);
          g.stroke();
          break;
        case 11: // bucket
          g.moveTo(cx - r * 0.7, cy - r * 0.4);
          g.lineTo(cx + r * 0.3, cy - r);
          g.lineTo(cx + r * 0.8, cy + r * 0.2);
          g.lineTo(cx - r * 0.2, cy + r * 0.8);
          g.closePath();
          g.stroke();
          break;
        case 12: // dropper
          g.moveTo(cx - r, cy + r);
          g.lineTo(cx + r * 0.5, cy - r * 0.5);
          g.stroke();
          g.beginPath();
          g.arc(cx + r * 0.6, cy - r * 0.6, r * 0.3, 0, Math.PI * 2);
          g.fill();
          break;
        default: // eraser
          g.rect(cx - r * 0.8, cy - r * 0.4, r * 1.6, r * 0.8);
          g.stroke();
      }
    }
    // Colour wells.
    const wy = y + h * 0.72;
    g.fillStyle = '#000';
    g.fillRect(x + w * 0.22, wy, w * 0.32, w * 0.32);
    g.fillStyle = '#ff9a00';
    g.fillRect(x + w * 0.46, wy + w * 0.2, w * 0.32, w * 0.32);
    g.strokeStyle = '#555';
    g.strokeRect(x + w * 0.46, wy + w * 0.2, w * 0.32, w * 0.32);
  }

  /** The timeline: layers, frame cells, keyframes where words start, tweens, the red playhead. */
  private timeline(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: WordStream, ctx: GenContext): void {
    this.panel(g, x, y, w, h);
    const u = h / 21;
    const nameW = w * 0.16;
    const headH = 2.6 * u;
    const rows = ['lyrics', 'singer', 'stage'];
    const rowH = (h - headH - 3 * u) / rows.length;
    const cellsX = x + nameW;
    const cellsW = w - nameW - u;
    const cellW = Math.max(4, u * 0.9);
    const cells = Math.floor(cellsW / cellW);
    // The playhead sits a quarter in; frames scroll under it.
    const frameNow = s.now * TWOS;
    const first = Math.floor(frameNow - cells * 0.25);
    const fx = (f: number): number => cellsX + (f - first) * cellW;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    // Frame numbers every 5.
    g.font = fontCss('mono', Math.round(u * 1.3));
    g.fillStyle = '#333';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let f = first; f < first + cells; f++) {
      if (f % 5 === 0) {
        g.fillStyle = '#555';
        g.fillRect(fx(f), y + headH - u * 0.6, 1, u * 0.6);
        if (f % 10 === 0 && f > 0) g.fillText(String(f), fx(f) + cellW / 2, y + headH * 0.45);
      }
    }
    rows.forEach((name, r) => {
      const ry = y + headH + r * rowH;
      g.fillStyle = r === 0 ? '#2b55c8' : UI.panel;
      g.fillRect(x + 1, ry, nameW - 2, rowH - 1);
      g.fillStyle = r === 0 ? '#ffffff' : '#222';
      g.textAlign = 'left';
      g.font = fontCss('heavy', Math.round(rowH * 0.42));
      g.fillText(name, x + u * 1.4, ry + rowH / 2);
      // Cells.
      for (let f = first; f < first + cells; f++) {
        g.fillStyle = f % 5 === 0 ? '#ecebe8' : UI.cell;
        g.fillRect(fx(f), ry, cellW - 1, rowH - 1);
      }
    });
    // Lyrics row: a keyframe per word, motion tweens leading to it; shape tweens across line ends.
    const ry = y + headH;
    const words = s.lines.flatMap((l) => l.words);
    for (const wd of words) {
      const kf = Math.round(wd.t * TWOS);
      const from = Math.round((wd.t - 0.3) * TWOS);
      if (kf < first - 4 || from > first + cells) continue;
      g.fillStyle = wd.last ? '#c9f2b8' : '#cfcaf7';
      g.fillRect(fx(from), ry, (kf - from) * cellW, rowH - 1);
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(fx(from) + cellW, ry + rowH / 2);
      g.lineTo(fx(kf) - cellW * 0.3, ry + rowH / 2);
      g.lineTo(fx(kf) - cellW * 0.8, ry + rowH / 2 - u * 0.4);
      g.stroke();
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(fx(kf) + cellW / 2, ry + rowH * 0.62, Math.min(cellW, rowH) * 0.28, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(fx(from) + cellW / 2, ry + rowH * 0.62, Math.min(cellW, rowH) * 0.28, 0, Math.PI * 2);
      g.fill();
    }
    // Singer and stage rows: keyframes on the beats.
    const spb = 60 / s.bpm;
    const beat0 = Math.floor(s.beatAt(first / TWOS));
    for (let b = beat0; b < beat0 + cells / TWOS / spb + 2; b++) {
      const t = s.now + (b - s.beatAt(s.now)) * spb;
      const f = Math.round(t * TWOS);
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(fx(f) + cellW / 2, ry + rowH * (b % 4 === 0 ? 2.62 : 1.62), Math.min(cellW, rowH) * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    // Playhead.
    const px = fx(frameNow) + cellW / 2;
    g.fillStyle = '#ff2020';
    g.fillRect(px - 0.5, y + headH * 0.2, 1.5, h - headH * 0.2 - u);
    g.fillRect(px - cellW * 0.6, y + headH * 0.15, cellW * 1.2 + 1, headH * 0.7);
    g.restore();
    void ctx;
  }

  private properties(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number, ctx: GenContext): void {
    // Swatches from the look's palette, a stroke weight and a few fields: chrome, no words.
    const sw = h * 0.42;
    for (let i = 0; i < 5; i++) {
      g.fillStyle = paletteCss(ctx.palette, i);
      g.fillRect(x + u * 2 + i * (sw + u * 0.6), y + (h - sw) / 2, sw, sw);
      g.strokeStyle = '#555';
      g.strokeRect(x + u * 2 + i * (sw + u * 0.6) + 0.5, y + (h - sw) / 2 + 0.5, sw - 1, sw - 1);
    }
    for (let i = 0; i < 3; i++) {
      const fx = x + w * (0.45 + i * 0.17);
      g.fillStyle = '#fff';
      g.fillRect(fx, y + h * 0.32, w * 0.12, h * 0.36);
      g.strokeStyle = UI.line;
      g.strokeRect(fx + 0.5, y + h * 0.32 + 0.5, w * 0.12, h * 0.36);
      g.fillStyle = '#444';
      g.fillRect(fx + u, y + h * 0.47, w * 0.05 * (1 + i * 0.4), 1.5);
    }
  }

  /** A flat vector backdrop on the stage (sky, hills, sun) that bobs on the beat. */
  private stageArt(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ctx: GenContext): void {
    const pal = ctx.palette;
    const sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, paletteCss(pal, 3, 0.55));
    sky.addColorStop(1, paletteCss(pal, 4, 0.75));
    g.fillStyle = sky;
    g.fillRect(x, y, w, h);
    const bob = Math.sin(ctx.beat * Math.PI) * h * 0.01;
    g.fillStyle = paletteCss(pal, 4, 0.4);
    g.beginPath();
    g.arc(x + w * 0.82, y + h * 0.24 + bob, h * 0.11, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = Math.max(2, h * 0.008);
    g.strokeStyle = '#111';
    for (const [hx, hr, c] of [
      [0.2, 0.45, 2],
      [0.75, 0.55, 1],
    ] as const) {
      g.fillStyle = paletteCss(pal, c, 0.15);
      g.beginPath();
      g.ellipse(x + w * hx, y + h * 1.05, w * hr, h * 0.32, 0, Math.PI, 0);
      g.fill();
      g.stroke();
    }
  }

  /** Lay the line out on the stage: centred rows of bubbly words. */
  private layout(g: CanvasRenderingContext2D, words: StreamWord[], x: number, y: number, w: number, h: number, px: number): Placed[] {
    g.font = fontCss('rounded', px);
    const space = px * 0.3;
    const rows: Placed[][] = [[]];
    let cx = 0;
    for (const wd of words) {
      const ww = g.measureText(wd.text).width;
      if (cx > 0 && cx + ww > w * 0.86) {
        rows.push([]);
        cx = 0;
      }
      rows[rows.length - 1].push({ w: wd, x: cx, y: 0, width: ww });
      cx += ww + space;
    }
    const lh = px * 1.22;
    const top = y + h * 0.5 - ((rows.length - 1) * lh) / 2;
    const out: Placed[] = [];
    rows.forEach((row, r) => {
      const rw = row.length ? row[row.length - 1].x + row[row.length - 1].width : 0;
      const ox = x + (w - rw) / 2;
      for (const pl of row) out.push({ ...pl, x: ox + pl.x, y: top + r * lh });
    });
    return out;
  }

  private bubbly(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, fill: string, alpha = 1, outline = '#111'): void {
    g.globalAlpha = alpha;
    g.font = fontCss('rounded', px);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = px * 0.16;
    g.strokeStyle = outline;
    g.strokeText(text, x, y);
    g.fillStyle = fill;
    g.fillText(text, x, y);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.save();
    g.beginPath();
    g.rect(x - px, y - px * 0.6, 99999, px * 0.32);
    g.clip();
    g.fillText(text, x, y);
    g.restore();
    g.globalAlpha = 1;
  }

  private stageWords(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: WordStream, line: StreamLine, onion: number, ctx: GenContext, clear = false): void {
    const longest = Math.max(...line.words.map((wd) => wd.text.length), 4);
    const px = Math.round(Math.min(h * 0.2, (w * 0.86) / (longest * 0.62)));
    const placed = this.layout(g, line.words, x, y, w, h, px);
    const next = s.lines.find((l) => l.index > line.index);
    const lastW = line.words[line.words.length - 1];
    const morphFrom = lastW ? lastW.end : line.end;
    const morphTo = next ? next.start : morphFrom + 0.5;
    const pal = ctx.palette;
    // The tween path: in from a side, landing as the word is sung.
    const start = (pl: Placed): { x: number; y: number } => {
      const side = wordHash(pl.w.text + line.index) % 4;
      return side === 0
        ? { x: x - pl.width - w * 0.1, y: pl.y - h * 0.2 }
        : side === 1
          ? { x: x + w * 1.05, y: pl.y + h * 0.15 }
          : side === 2
            ? { x: pl.x + w * 0.1, y: y - h * 0.3 }
            : { x: pl.x - w * 0.15, y: y + h * 1.2 };
    };
    const at = (pl: Placed, t: number): { x: number; y: number; k: number } => {
      const k = back((t - (pl.w.t - 0.3)) / 0.3);
      const a = start(pl);
      return { x: a.x + (pl.x - a.x) * k, y: a.y + (pl.y - a.y) * k, k };
    };
    let selected: Placed | null = null;
    const morphing = !!next && s.now > morphFrom;
    const clearOld = morphing ? Math.min(1, (s.now - morphFrom) / Math.max(0.15, (morphTo - morphFrom) * 0.4)) : 0;
    for (const pl of placed) {
      if (s.now < pl.w.t - 0.3) continue;
      // While the last word morphs, the rest of the line clears away.
      if (clearOld > 0 && !pl.w.last) {
        if (clearOld >= 1) continue;
        g.globalAlpha = 1 - clearOld;
      }
      const fill = paletteCss(pal, 2 + (pl.w.i % 3), clear ? 0.45 : 0.05);
      const tweening = s.now < pl.w.t + 0.08;
      // Onion skin: where the word was a few frames ago, tinted.
      if (tweening || onion > 3) {
        for (let k = onion; k >= 1; k--) {
          const tt = s.now - k / TWOS;
          if (tt < pl.w.t - 0.3) continue;
          const o = at(pl, tt);
          this.bubbly(g, pl.w.text, o.x, o.y, px, k % 2 ? '#7fb2ff' : '#7fe08a', (0.2 + 0.3 * (1 - k / (onion + 1))) * (onion > 3 ? 0.55 : 1), '#2f4f8a');
        }
      }
      // The last word shape-tweens into the next line's first word.
      if (pl.w.last && next && s.now > morphFrom) {
        const k = Math.min(1, (s.now - morphFrom) / Math.max(0.2, morphTo - morphFrom));
        {
          // The shape tween: the word squashes and its outline swaps into the next one.
          g.save();
          g.translate(pl.x + pl.width / 2, pl.y);
          g.scale(1 - 0.5 * k, 1 + 0.25 * k);
          this.bubbly(g, pl.w.text, -pl.width / 2, 0, px, fill, 1 - k);
          g.restore();
          const to = next.words[0]?.text ?? '';
          g.font = fontCss('rounded', px);
          const tw = g.measureText(to).width;
          this.bubbly(g, to, pl.x + pl.width / 2 - tw / 2, pl.y, px, paletteCss(pal, 2, clear ? 0.45 : 0.05), k);
          if (!clear) selected = { ...pl, x: pl.x + pl.width / 2 - Math.max(tw, pl.width) / 2, width: Math.max(tw, pl.width) };
        }
        continue;
      }
      const o = at(pl, s.now);
      this.bubbly(g, pl.w.text, o.x, o.y, px, fill);
      g.globalAlpha = 1;
      // The latest word stays selected until the next one starts moving.
      if (!clear && s.now >= pl.w.t - 0.3) selected = { ...pl, x: o.x, y: o.y };
      void tweening;
    }
    g.globalAlpha = 1;
    // The selected symbol: blue box, handles, the registration point; the cursor drags it.
    if (selected) {
      const bx = selected.x - px * 0.12;
      const by = selected.y - px * 0.62;
      const bw = selected.width + px * 0.24;
      const bh = px * 1.24;
      g.strokeStyle = UI.select;
      g.lineWidth = 1.5;
      g.strokeRect(bx, by, bw, bh);
      const hs = Math.max(4, px * 0.08);
      for (const [hx, hy] of [
        [0, 0],
        [0.5, 0],
        [1, 0],
        [0, 0.5],
        [1, 0.5],
        [0, 1],
        [0.5, 1],
        [1, 1],
      ]) {
        g.fillStyle = '#fff';
        g.fillRect(bx + bw * hx - hs / 2, by + bh * hy - hs / 2, hs, hs);
        g.strokeRect(bx + bw * hx - hs / 2, by + bh * hy - hs / 2, hs, hs);
      }
      g.beginPath();
      g.arc(bx + bw / 2, by + bh / 2, hs * 0.8, 0, Math.PI * 2);
      g.stroke();
      if (h01(selected.w.text) > 0.4) this.cursor(g, bx + bw * 0.55, by + bh * 0.55, px * 0.5);
    }
  }

  /** The arrow pointer, dragging. */
  private cursor(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    g.save();
    g.translate(x, y);
    g.scale(size / 20, size / 20);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, 17);
    g.lineTo(4.5, 13);
    g.lineTo(7.5, 20);
    g.lineTo(10.5, 18.7);
    g.lineTo(7.5, 12);
    g.lineTo(13, 12);
    g.closePath();
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 1.3;
    g.strokeStyle = '#000';
    g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------- test movie

  private testMovie(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, line: StreamLine | null, ctx: GenContext, always: boolean): void {
    const pal = ctx.palette;
    // Everything moves on twos.
    const t2 = Math.floor(s.now * TWOS) / TWOS;
    const sinceStart = line ? s.now - line.start : 99;
    // The loader, for the first beat of a chorus.
    if (!always && line && sinceStart >= 0 && sinceStart < 60 / s.bpm) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      const pct = Math.min(100, Math.floor((sinceStart / (60 / s.bpm)) * 100));
      g.fillStyle = '#e8e8e8';
      g.fillRect(W * 0.3, H * 0.48, W * 0.4, H * 0.03);
      g.fillStyle = paletteCss(pal, 2);
      g.fillRect(W * 0.3, H * 0.48, W * 0.4 * (pct / 100), H * 0.03);
      g.strokeStyle = '#333';
      g.strokeRect(W * 0.3, H * 0.48, W * 0.4, H * 0.03);
      g.font = fontCss('pixel', Math.round(H * 0.035));
      g.fillStyle = '#333';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillText(`${pct}%`, W / 2, H * 0.45);
      return;
    }
    // Flat backdrop: rays from behind the singer, turning a notch per beat.
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, paletteCss(pal, 2, 0.1));
    bg.addColorStop(1, paletteCss(pal, 1, -0.1));
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const cx = W * 0.27;
    const cy = H * 0.36;
    g.save();
    g.translate(cx, cy);
    // The chorus spins the rays faster, in another colour.
    const loud = !!line?.chorus;
    g.rotate(Math.floor(ctx.frame.beat) * (loud ? 0.3 : 0.12));
    g.fillStyle = paletteCss(pal, loud ? 4 : 3, 0.2, loud ? 0.5 : 0.35);
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, W, (i / 12) * Math.PI * 2, (i / 12) * Math.PI * 2 + Math.PI / 12);
      g.closePath();
      g.fill();
    }
    g.restore();
    // The singer.
    const words = line?.words ?? [];
    const cur = [...words].reverse().find((wd) => wd.t <= s.now && s.now < wd.end + 0.05);
    this.singer(g, cx, cy, H * 0.22, ctx, cur, t2, loud);
    // Big bubbly words tweening round the singer (on twos).
    if (!line) return;
    // The whole line on screen: outlines first (inked), filled as each word is sung (painted), the current word bigger.
    const px = Math.round(H * 0.105);
    const placed = this.layout(g, words, W * 0.5, H * 0.08, W * 0.47, H * 0.84, px);
    const cur2 = [...words].reverse().find((wd) => wd.t <= t2 + 0.02);
    for (const pl of placed) {
      const wd = pl.w;
      const age = t2 - wd.t;
      const isCur = wd === cur2;
      const pop = age >= 0 ? 0.6 + 0.4 * back(age / 0.25) : 1;
      const k = isCur ? 1.18 : 1;
      const wobble = (h01(wd.text + wd.i) - 0.5) * 0.12;
      g.save();
      g.translate(pl.x + pl.width / 2, pl.y);
      g.rotate(wobble);
      g.scale(pop * k, pop * k);
      if (age < 0) {
        g.font = fontCss('rounded', px);
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = Math.max(2, px * 0.05);
        g.strokeStyle = 'rgba(17,17,17,0.7)';
        g.strokeText(wd.text, -pl.width / 2, 0);
      } else this.bubbly(g, wd.text, -pl.width / 2, 0, px, paletteCss(pal, 2 + (wd.i % 3), isCur ? 0.1 : 0.3));
      g.restore();
    }
  }

  /** Mouth shape for a letter: open vowels, round vowels, closed lips, teeth on lip, tongue, rest. */
  private viseme(word: StreamWord | undefined, now: number): 'A' | 'O' | 'M' | 'F' | 'L' | 'E' | 'rest' {
    if (!word) return 'rest';
    const letters = [...word.text.toUpperCase()].filter((c) => /\p{L}/u.test(c));
    if (!letters.length) return 'rest';
    const k = Math.min(letters.length - 1, Math.floor(((now - word.t) / Math.max(0.12, word.end - word.t)) * letters.length));
    const ch = letters[Math.max(0, k)];
    if ('AÁÄÀ'.includes(ch)) return 'A';
    if ('OUÓÖÚÜWQ'.includes(ch)) return 'O';
    if ('MBP'.includes(ch)) return 'M';
    if ('FV'.includes(ch)) return 'F';
    if ('LTDN'.includes(ch)) return 'L';
    if ('EIYÉÍ'.includes(ch)) return 'E';
    return 'rest';
  }

  private singer(g: CanvasRenderingContext2D, x: number, y: number, r: number, ctx: GenContext, word: StreamWord | undefined, now: number, chorus = false): void {
    const pal = ctx.palette;
    const beat = ctx.frame.beat;
    const bob = Math.abs(Math.sin(Math.floor(beat * 2) * 0.5 * Math.PI)) * r * 0.05;
    const lw = Math.max(3, r * 0.05);
    const thin = lw * 0.65;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = '#111';
    const up = Math.floor(beat) % 2 === 0;
    // Legs and shoes, stepping on the beat.
    const hipY = y + r * 1.72 - bob;
    g.lineWidth = lw * 2.2;
    g.beginPath();
    g.moveTo(x - r * 0.25, hipY);
    g.lineTo(x - r * 0.3 - (up ? r * 0.08 : 0), hipY + r * 0.42);
    g.moveTo(x + r * 0.25, hipY);
    g.lineTo(x + r * 0.3 + (up ? 0 : r * 0.08), hipY + r * 0.42);
    g.stroke();
    g.fillStyle = '#1b1b1b';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(x + sx * r * 0.36 + (sx < 0 ? (up ? -r * 0.08 : 0) : up ? 0 : r * 0.08), hipY + r * 0.48, r * 0.2, r * 0.09, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Body: a shirt with a stripe.
    g.lineWidth = lw * 1.25;
    g.fillStyle = paletteCss(pal, 1, 0.25);
    g.beginPath();
    g.roundRect(x - r * 0.55, y + r * 0.6 - bob, r * 1.1, r * 1.2, r * 0.35);
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = paletteCss(pal, 4, 0.2);
    g.fillRect(x - r * 0.6, y + r * 1.02 - bob, r * 1.2, r * 0.16);
    g.restore();
    g.stroke();
    // Arms with an elbow and round hands, swapping pose on the beat.
    g.lineWidth = lw * 1.1;
    const arm = (sx: number, raised: boolean): void => {
      const sxp = x + sx * r * 0.5;
      const syp = y + r * 0.85 - bob;
      const ex = sxp + sx * r * 0.32;
      const ey = syp + (raised ? -r * 0.12 : r * 0.28);
      const hx = ex + sx * (raised ? r * 0.1 : r * 0.2);
      const hy = ey + (raised ? -r * 0.4 : r * 0.22);
      g.beginPath();
      g.moveTo(sxp, syp);
      g.lineTo(ex, ey);
      g.lineTo(hx, hy);
      g.stroke();
      g.fillStyle = '#ffe2c4';
      g.beginPath();
      g.arc(hx, hy, r * 0.1, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = thin;
      g.stroke();
      g.lineWidth = lw * 1.1;
    };
    // Both arms up through the chorus.
    arm(-1, chorus || up);
    arm(1, chorus || !up);
    // Head.
    g.lineWidth = lw * 1.3;
    g.fillStyle = '#ffe2c4';
    g.beginPath();
    g.ellipse(x, y - bob, r * 0.72, r * 0.66, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // Cheeks and a nose.
    g.fillStyle = 'rgba(255,120,140,0.35)';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(x + sx * r * 0.42, y + r * 0.2 - bob, r * 0.1, r * 0.06, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.lineWidth = thin;
    g.beginPath();
    g.moveTo(x + r * 0.02, y + r * 0.04 - bob);
    g.quadraticCurveTo(x + r * 0.12, y + r * 0.14 - bob, x - r * 0.01, y + r * 0.17 - bob);
    g.stroke();
    // Hair spikes.
    g.lineWidth = lw * 1.2;
    g.fillStyle = paletteCss(pal, 0, 0.1);
    g.beginPath();
    g.moveTo(x - r * 0.7, y - r * 0.2 - bob);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const rr = i % 2 ? r * 0.95 : r * 0.68;
      g.lineTo(x + Math.cos(a) * rr * 1.02, y - r * 0.05 + Math.sin(a) * rr - bob);
    }
    g.closePath();
    g.fill();
    g.stroke();
    // Eyes: a blink every couple of seconds.
    const blink = now % 2.5 < 0.12;
    g.lineWidth = thin * 1.2;
    for (const sx of [-1, 1]) {
      const ex = x + sx * r * 0.26;
      const ey = y - r * 0.08 - bob;
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(ex, ey, r * 0.15, blink ? r * 0.02 : r * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (!blink) {
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(ex + r * 0.04, ey + r * 0.03, r * 0.07, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(ex + r * 0.06, ey, r * 0.022, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.lineWidth = lw;
    // Mouth from the letter being sung.
    const v = this.viseme(word, now);
    const mx = x;
    const my = y + r * 0.34 - bob;
    g.fillStyle = '#5a0f1a';
    g.beginPath();
    switch (v) {
      case 'A':
        g.ellipse(mx, my, r * 0.2, r * 0.17, 0, 0, Math.PI * 2);
        break;
      case 'O':
        g.ellipse(mx, my, r * 0.11, r * 0.15, 0, 0, Math.PI * 2);
        break;
      case 'E':
        g.ellipse(mx, my, r * 0.22, r * 0.08, 0, 0, Math.PI * 2);
        break;
      case 'L':
        g.ellipse(mx, my, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
        break;
      case 'F':
        g.rect(mx - r * 0.16, my - r * 0.04, r * 0.32, r * 0.08);
        break;
      case 'M':
        g.moveTo(mx - r * 0.16, my);
        g.lineTo(mx + r * 0.16, my);
        break;
      default:
        g.moveTo(mx - r * 0.12, my);
        g.quadraticCurveTo(mx, my + r * 0.05, mx + r * 0.12, my);
    }
    if (v === 'M' || v === 'rest') g.stroke();
    else {
      g.fill();
      g.stroke();
      if (v === 'F') {
        g.fillStyle = '#fff';
        g.fillRect(mx - r * 0.12, my - r * 0.04, r * 0.24, r * 0.035);
      }
      if (v === 'L') {
        g.fillStyle = '#e26a7a';
        g.beginPath();
        g.ellipse(mx, my + r * 0.04, r * 0.08, r * 0.04, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
