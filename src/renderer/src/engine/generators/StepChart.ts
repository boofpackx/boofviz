import type { GenContext } from './Generator';
import { CanvasLook, paletteCss } from './CanvasLook';
import { fontCss } from './KineticType';
import { num } from './ShaderGenerator';
import { rhythmOf, wordHash, wordStream, type StreamWord, type WordStream } from '../wordStream';

/**
 * Step Chart: the late-90s arcade dance game. Every sung word is a step note
 * that scrolls up its lane and reaches the receptors exactly when it is sung;
 * the same word always gets the same arrow, so a chorus repeats its pattern.
 * Note colour follows the rhythm (on the beat, off-beat, sixteenths,
 * triplets), held words become freeze arrows, judgments come from how the word
 * sits on the beat, and the words you've danced collect into the line at the
 * side. The chorus brings fever: faster scroll, a flipped stage, rainbow
 * notes. Instrumental gaps get steps on the beat, then READY… GO.
 */

const RHYTHM_COLOR: Record<number, [string, string]> = {
  4: ['#ff5a76', '#d0102f'],
  8: ['#6fb0ff', '#1b5fe0'],
  12: ['#d48bff', '#8a2be2'],
  16: ['#ffe25a', '#e0a800'],
  0: ['#7dffc8', '#13b98a'],
};
const FREEZE: [string, string] = ['#a8ffcf', '#19c46a'];
/** Lane order on the pad: left, down, up, right. */
const ROT = [-Math.PI / 2, Math.PI, 0, Math.PI / 2];
const ARROW: Array<[number, number]> = [
  [0, -0.48],
  [0.47, 0.02],
  [0.19, 0.02],
  [0.19, 0.47],
  [-0.19, 0.47],
  [-0.19, 0.02],
  [-0.47, 0.02],
];

function arrowPath(g: CanvasRenderingContext2D, k = 1): void {
  g.beginPath();
  ARROW.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
  g.closePath();
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${((h % 360) + 360) % 360},${s}%,${l}%)`;
}

interface Note {
  lane: number;
  t: number;
  end: number;
  word: string;
  rhythm: 4 | 8 | 12 | 16 | 0;
  freeze: boolean;
}

export class StepChart extends CanvasLook {
  readonly kind = 'stepChart';
  private bgHue = 0;

  /** Notes for the words around now, plus steps on the beat in instrumental gaps. */
  private notes(s: WordStream, lanes: number, beats: number): Note[] {
    const out: Note[] = [];
    const spb = 60 / s.bpm;
    let prevLane = -1;
    const words: StreamWord[] = s.synced ? s.lines.flatMap((l) => l.words) : [];
    for (const w of words) {
      let lane = wordHash(w.text) % lanes;
      // Never the same arrow twice in a row for different words (a real chart alternates feet).
      if (lane === prevLane) lane = (lane + 1 + (wordHash(w.text + '*') % (lanes - 1))) % lanes;
      prevLane = lane;
      const held = w.end - w.t;
      out.push({ lane, t: w.t, end: w.end, word: w.text, rhythm: rhythmOf(s.beatAt(w.t)), freeze: held > Math.max(0.6, spb * 1.4) });
    }
    // Steps on the beat where nothing is sung (or the whole song when it has no timed lyrics).
    const b0 = Math.ceil(s.beatAt(s.now) - 1);
    for (let b = b0; b < b0 + beats + 2; b++) {
      const t = s.now + (b - s.beatAt(s.now)) * spb;
      if (s.synced && words.some((w) => t > w.t - spb * 1.6 && t < w.end + spb * 1.1)) continue;
      const pat = [0, 1, 2, 3, 2, 1, 3, 0];
      out.push({ lane: pat[((b % 8) + 8) % 8] % lanes, t, end: t, word: '', rhythm: 4, freeze: false });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    const variant = String(p.variant ?? 'single');
    // As a lyric style over another look: the lane at the side and the line at the bottom.
    const overlay = p.overlay === true;
    const double = variant === 'double' && !overlay;
    const reverse = variant === 'reverse' && !overlay;
    const under = double || overlay;
    const s = wordStream(ctx, 1, 3);
    const line = s.current >= 0 ? s.lines[s.current] : null;
    const fever = !!line?.chorus && s.synced;
    const hasSong = s.lines.length > 0;
    const pal = ctx.palette;
    const kick = ctx.env.kick * num(p.react, 1);
    const beat = ctx.frame.beat;
    const bph = beat - Math.floor(beat);

    // ---- The stage: rays, rings and a floor, flipped in fever (none when drawn over another look). ----
    const flip = fever ? 1 : 0;
    if (!overlay) {
      this.bgHue += ctx.dt * (fever ? 40 : 8);
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, paletteCss(pal, flip ? 3 : 0, flip ? 0.1 : -0.35));
      sky.addColorStop(0.6, paletteCss(pal, flip ? 2 : 1, flip ? -0.1 : -0.15));
      sky.addColorStop(1, paletteCss(pal, flip ? 4 : 0, flip ? -0.2 : -0.6));
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      const cx = W * (double ? 0.5 : 0.28);
      const cy = H * 0.42;
      const rays = 18;
      const spin = ctx.time * (fever ? 0.5 : 0.12);
      g.save();
      g.translate(cx, cy);
      g.globalAlpha = 0.16 + 0.1 * kick * num(p.stage, 1);
      for (let i = 0; i < rays; i++) {
        const a0 = spin + (i / rays) * Math.PI * 2;
        g.fillStyle = i % 2 ? paletteCss(pal, flip ? 1 : 3, 0.2) : paletteCss(pal, flip ? 4 : 2, 0.05);
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, W * 1.2, a0, a0 + Math.PI / rays);
        g.closePath();
        g.fill();
      }
      // A ring leaves the centre on every beat.
      g.globalAlpha = 1;
      for (let r = 0; r < 4; r++) {
        const age = r + bph;
        g.strokeStyle = paletteCss(pal, 4, 0.3, Math.max(0, 0.35 - age * 0.085) * num(p.stage, 1));
        g.lineWidth = H * 0.012;
        g.beginPath();
        g.arc(0, 0, H * (0.12 + age * 0.32), 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      // Floor grid rushing toward you.
      const horizon = H * 0.66;
      g.save();
      g.beginPath();
      g.rect(0, horizon, W, H - horizon);
      g.clip();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, horizon, W, H - horizon);
      g.strokeStyle = paletteCss(pal, 3, 0.25, 0.55 + 0.35 * kick);
      g.lineWidth = Math.max(1, H * 0.003);
      for (let i = 0; i < 9; i++) {
        const z = (i + (beat % 1)) / 9;
        const y = horizon + (H - horizon) * z * z;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      for (let i = -12; i <= 12; i++) {
        g.beginPath();
        g.moveTo(W / 2 + i * W * 0.02, horizon);
        g.lineTo(W / 2 + i * W * 0.16, H);
        g.stroke();
      }
      g.restore();
    }

    // ---- The playfield ----
    const lanes = double ? 8 : 4;
    const lane = overlay ? H * 0.082 : Math.min(H * 0.118, (W * (double ? 0.8 : 0.42)) / lanes);
    const fieldW = lane * lanes + (double ? lane * 0.4 : 0);
    const fx = double ? (W - fieldW) / 2 : overlay ? W * 0.95 - fieldW : W * 0.28 - fieldW / 2;
    const laneX = (i: number): number => fx + lane * (i + 0.5) + (double && i >= 4 ? lane * 0.4 : 0);
    const recY = reverse ? H * 0.84 : H * 0.16;
    const dir = reverse ? -1 : 1;
    const speed = num(p.speed, 1) * (fever ? 1.35 : 1);
    const pxPerBeat = H * 0.19 * speed;
    const yAt = (t: number): number => recY + ((dir * ((t - s.now) * s.bpm)) / 60) * pxPerBeat;
    // Lane backing so the notes read over a loud stage.
    g.fillStyle = overlay ? 'rgba(4,4,14,0.4)' : 'rgba(4,4,14,0.55)';
    g.fillRect(fx - lane * 0.12, 0, fieldW + lane * 0.24, overlay ? H * 0.74 : H);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 1; i < lanes; i++) g.fillRect(fx + lane * i + (double && i >= 4 ? lane * 0.4 : 0) - 0.5, 0, 1, overlay ? H * 0.74 : H);

    // Dance gauge across the top of the playfield.
    const gaugeY = reverse ? H * 0.95 : overlay ? -H : H * 0.045;
    const fill = hasSong ? Math.min(1, 0.35 + ctx.env.energy * 0.75) : 0.2;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(fx, gaugeY - H * 0.014, fieldW, H * 0.028);
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      if (i / segs > fill) break;
      g.fillStyle = fever ? hsl(this.bgHue * 3 + i * 15, 95, 60) : i / segs > 0.8 ? '#ff4d6d' : '#46f08a';
      g.fillRect(fx + (fieldW * i) / segs + 1, gaugeY - H * 0.01, fieldW / segs - 2, H * 0.02);
    }

    const notes = hasSong ? this.notes(s, lanes, 6) : [];
    // Over another look the notes stay inside their lane, clear of the line at the bottom.
    g.save();
    if (overlay) {
      g.beginPath();
      g.rect(0, 0, W, H * 0.74);
      g.clip();
    }
    const sinceHit = (n: Note): number => s.now - n.t;

    // Receptors (flash when a note lands).
    for (let i = 0; i < lanes; i++) {
      const hit = notes.find((n) => n.lane === i && sinceHit(n) >= 0 && (sinceHit(n) < 0.16 || (n.freeze && s.now < n.end)));
      const glow = hit ? (hit.freeze && s.now < hit.end ? 0.75 : 1 - sinceHit(hit) / 0.16) : 0.12 * Math.max(0, 1 - bph * 3);
      g.save();
      g.translate(laneX(i), recY);
      g.rotate(ROT[i % 4]);
      const size = lane * 0.92 * (1 + 0.06 * glow);
      g.scale(size, size);
      arrowPath(g);
      g.fillStyle = `rgba(20,20,34,${0.85 - glow * 0.4})`;
      g.fill();
      g.lineJoin = 'round';
      g.lineWidth = 0.075;
      g.strokeStyle = hit?.freeze && s.now < hit.end ? FREEZE[0] : `rgba(${200 + 55 * glow},${200 + 55 * glow},${215 + 40 * glow},1)`;
      g.stroke();
      if (glow > 0.2) {
        g.shadowColor = 'rgba(255,255,255,0.9)';
        g.shadowBlur = 30 * glow;
        g.lineWidth = 0.03;
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.stroke();
        g.shadowBlur = 0;
      }
      g.restore();
    }

    // Notes, freeze bodies first.
    const span = (H / pxPerBeat) * (60 / s.bpm);
    const visible = notes.filter((n) => n.end > s.now - 0.3 && n.t < s.now + span);
    for (const n of visible) {
      if (!n.freeze) continue;
      const y0 = s.now > n.t ? recY : yAt(n.t);
      const y1 = yAt(n.end);
      if ((y1 - y0) * dir <= 0) continue;
      const x = laneX(n.lane);
      const w = lane * 0.62;
      const top = Math.min(y0, y1);
      const h = Math.abs(y1 - y0);
      const body = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      body.addColorStop(0, 'rgba(25,196,106,0.75)');
      body.addColorStop(0.5, 'rgba(168,255,207,0.9)');
      body.addColorStop(1, 'rgba(25,196,106,0.75)');
      g.fillStyle = body;
      g.beginPath();
      g.roundRect(x - w / 2, top, w, h, w * 0.3);
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = w * 0.18;
      const off = ((ctx.time * pxPerBeat) / 2) % (w * 0.7);
      for (let yy = top - w + off * dir; yy < top + h + w; yy += w * 0.7) {
        g.beginPath();
        g.moveTo(x - w, yy);
        g.lineTo(x + w, yy + w * 0.6);
        g.stroke();
      }
      g.restore();
    }
    g.textBaseline = 'middle';
    for (const n of visible) {
      const held = n.freeze && s.now >= n.t && s.now < n.end;
      if (s.now > n.t + 0.02 && !held) continue;
      const x = laneX(n.lane);
      const y = held ? recY : yAt(n.t);
      const [hi, lo] = n.freeze ? FREEZE : fever ? [hsl(this.bgHue * 4 + n.lane * 70 + n.t * 90, 100, 72), hsl(this.bgHue * 4 + n.lane * 70 + n.t * 90 + 30, 95, 48)] : RHYTHM_COLOR[n.rhythm];
      const size = lane * 0.9 * (n.word ? 1 : 0.8);
      g.save();
      g.translate(x, y);
      g.rotate(ROT[n.lane % 4]);
      g.scale(size, size);
      arrowPath(g);
      const grad = g.createLinearGradient(0, -0.5, 0, 0.5);
      grad.addColorStop(0, hi);
      grad.addColorStop(1, lo);
      g.fillStyle = n.word ? grad : 'rgba(210,214,230,0.55)';
      g.fill();
      g.lineJoin = 'round';
      g.lineWidth = 0.08;
      g.strokeStyle = '#0a0a16';
      g.stroke();
      arrowPath(g, 0.72);
      g.lineWidth = 0.035;
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.stroke();
      g.restore();
    }

    // Upcoming words, in a column beside their arrows (under them in Double).
    const tagPx = Math.round(lane * (double ? 0.24 : overlay ? 0.3 : 0.33));
    g.font = fontCss('arcade', tagPx);
    g.lineJoin = 'round';
    for (const n of visible) {
      if (!n.word || s.now > n.t) continue;
      const y = yAt(n.t);
      const x = under ? laneX(n.lane) : fx + fieldW + lane * 0.35;
      g.textAlign = under ? 'center' : 'left';
      const ty = under ? y + dir * lane * 0.62 : y;
      if (!under) {
        g.strokeStyle = n.freeze ? 'rgba(168,255,207,0.45)' : 'rgba(255,255,255,0.22)';
        g.lineWidth = Math.max(1, lane * 0.02);
        g.setLineDash([lane * 0.06, lane * 0.06]);
        g.beginPath();
        g.moveTo(laneX(n.lane) + lane * 0.45, y);
        g.lineTo(x - lane * 0.1, y);
        g.stroke();
        g.setLineDash([]);
      }
      const a = Math.min(1, Math.max(0, ((yAt(n.t) - recY) * dir) / (lane * 0.5)));
      g.globalAlpha = 0.35 + 0.65 * a;
      g.lineWidth = tagPx * 0.22;
      g.strokeStyle = '#05050d';
      g.strokeText(n.word, x, ty);
      g.fillStyle = n.freeze ? FREEZE[0] : fever ? '#ffffff' : RHYTHM_COLOR[n.rhythm][0];
      g.fillText(n.word, x, ty);
      g.globalAlpha = 1;
    }

    // Hit bursts.
    for (const n of notes) {
      const age = sinceHit(n);
      if (!n.word || age < 0 || age > 0.3) continue;
      const x = laneX(n.lane);
      const k = age / 0.3;
      g.strokeStyle = n.freeze ? `rgba(168,255,207,${1 - k})` : `rgba(255,255,255,${1 - k})`;
      g.lineWidth = lane * 0.06 * (1 - k);
      g.beginPath();
      g.arc(x, recY, lane * (0.45 + k * 0.5), 0, Math.PI * 2);
      g.stroke();
    }

    g.restore();

    // ---- Judgment and combo ----
    const words = s.synced ? s.lines.flatMap((l) => l.words) : [];
    const last = [...words].reverse().find((w) => w.t <= s.now);
    const jy = reverse ? H * 0.38 : H * 0.48;
    const jx = double ? W / 2 : fx + fieldW / 2;
    if (last && s.now - last.t < 0.75) {
      const age = s.now - last.t;
      const r = rhythmOf(s.beatAt(last.t), 0.08);
      const perfect = r === 4 || r === 8 || r === 16;
      const pop = age < 0.08 ? 1.3 - (age / 0.08) * 0.3 : 1;
      g.save();
      g.translate(jx, jy);
      g.transform(1, 0, -0.18, 1, 0, 0);
      g.scale(pop, pop);
      g.globalAlpha = age > 0.5 ? 1 - (age - 0.5) / 0.25 : 1;
      const jp = Math.round(lane * 0.62);
      g.font = fontCss('arcade', jp);
      g.textAlign = 'center';
      const label = perfect ? 'PERFECT' : 'GREAT';
      const tw = g.measureText(label).width;
      const jg = g.createLinearGradient(-tw / 2, -jp / 2, tw / 2, jp / 2);
      if (perfect) ['#ff5ad1', '#ffd23f', '#5affc8', '#5ab4ff', '#c45aff'].forEach((c, i) => jg.addColorStop(i / 4, c));
      else ['#ffe86b', '#9cff5a'].forEach((c, i) => jg.addColorStop(i, c));
      g.lineWidth = jp * 0.16;
      g.strokeStyle = '#0a0a16';
      g.strokeText(label, 0, 0);
      g.lineWidth = jp * 0.05;
      g.strokeStyle = '#ffffff';
      g.strokeText(label, 0, 0);
      g.fillStyle = jg;
      g.fillText(label, 0, 0);
      // The combo: every word danced so far in the song.
      const combo = this.combo(s, last);
      if (combo >= 4) {
        const cp = Math.round(jp * 0.95);
        g.font = fontCss('arcade', cp);
        g.lineWidth = cp * 0.14;
        g.textAlign = 'right';
        g.strokeText(String(combo), cp * 0.1, jp * 1.15);
        g.fillStyle = '#ffffff';
        g.fillText(String(combo), cp * 0.1, jp * 1.15);
        g.font = fontCss('arcade', Math.round(cp * 0.38));
        g.textAlign = 'left';
        g.strokeText('COMBO', cp * 0.22, jp * 1.25);
        g.fillStyle = '#ffd23f';
        g.fillText('COMBO', cp * 0.22, jp * 1.25);
      }
      g.restore();
    }

    // READY… GO before the next line after a gap.
    const nextWord = words.find((w) => w.t > s.now);
    if (s.synced && nextWord && (!last || nextWord.t - last.end > (60 / s.bpm) * 6)) {
      const beatsTo = ((nextWord.t - s.now) * s.bpm) / 60;
      const label = beatsTo < 2 && beatsTo > 0.25 ? 'GO!' : beatsTo < 4.5 && beatsTo >= 2 ? 'READY' : '';
      if (label) {
        const rp = Math.round(lane * (label === 'GO!' ? 0.95 : 0.7));
        g.save();
        g.translate(jx, jy);
        const pulse = 1 + 0.08 * Math.max(0, 1 - bph * 4);
        g.scale(pulse, pulse);
        g.font = fontCss('arcade', rp);
        g.textAlign = 'center';
        g.lineWidth = rp * 0.16;
        g.strokeStyle = '#0a0a16';
        g.strokeText(label, 0, 0);
        g.fillStyle = label === 'GO!' ? '#ffd23f' : '#ffffff';
        g.fillText(label, 0, 0);
        g.restore();
      }
    }

    // ---- The words you've danced, collecting into the line ----
    if (line && s.synced) this.collected(g, W, H, s, under, fever);
    else if (hasSong) this.banner(g, W, H, s.lines[0].text, under);
  }

  /** Words sung so far in the song (the combo never breaks: you never miss a word). */
  private combo(s: WordStream, last: StreamWord): number {
    let n = 0;
    for (const l of s.lines) for (const w of l.words) if (w.t <= last.t) n++;
    return n + s.before;
  }

  private collected(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, double: boolean, fever: boolean): void {
    const line = s.lines[s.current];
    const x0 = double ? W * 0.1 : W * 0.58;
    const maxW = double ? W * 0.8 : W * 0.38;
    const px = Math.round(H * (double ? 0.05 : 0.062));
    g.font = fontCss('arcade', px);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    // Lay the line out in rows, then show the words sung so far.
    const rows: Array<Array<{ w: StreamWord; x: number }>> = [[]];
    let x = 0;
    const space = px * 0.32;
    for (const w of line.words) {
      const ww = g.measureText(w.text).width;
      if (x > 0 && x + ww > maxW) {
        rows.push([]);
        x = 0;
      }
      rows[rows.length - 1].push({ w, x });
      x += ww + space;
    }
    const lh = px * 1.18;
    const y0 = double ? H * 0.93 - (rows.length - 1) * lh : H * 0.5 - ((rows.length - 1) * lh) / 2;
    // The previous line, small and dim, above.
    const prev = s.lines[s.current - 1];
    if (prev && !double) {
      g.font = fontCss('arcade', Math.round(px * 0.5));
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText(prev.text, x0, y0 - lh * 1.1, maxW);
      g.font = fontCss('arcade', px);
    }
    g.lineJoin = 'round';
    rows.forEach((row, r) => {
      for (const { w, x: wx } of row) {
        const age = s.now - w.t;
        if (age < 0) {
          g.fillStyle = 'rgba(255,255,255,0.12)';
          g.fillText(w.text, x0 + wx, y0 + r * lh);
          continue;
        }
        const pop = age < 0.12 ? 1 + (1 - age / 0.12) * 0.12 : 1;
        g.save();
        const ww = g.measureText(w.text).width;
        g.translate(x0 + wx + ww / 2, y0 + r * lh - px * 0.35);
        g.scale(pop, pop);
        g.lineWidth = px * 0.16;
        g.strokeStyle = '#0a0a16';
        g.strokeText(w.text, -ww / 2, px * 0.35);
        const hue = (wordHash(w.text) % 360) + (fever ? s.now * 120 : 0);
        g.fillStyle = age < 0.25 ? '#ffffff' : fever ? hsl(hue, 100, 70) : '#ffffff';
        g.fillText(w.text, -ww / 2, px * 0.35);
        g.restore();
      }
    });
  }

  /** No timed lyrics: the song's name on a banner, like the song wheel. */
  private banner(g: CanvasRenderingContext2D, W: number, H: number, title: string, double: boolean): void {
    const px = Math.round(H * 0.05);
    g.font = fontCss('arcade', px);
    const tw = Math.min(W * 0.36, g.measureText(title).width);
    const x = double ? W / 2 - tw / 2 : W * 0.6;
    const y = double ? H * 0.9 : H * 0.5;
    g.fillStyle = 'rgba(5,5,16,0.7)';
    g.beginPath();
    g.roundRect(x - px * 0.6, y - px * 0.95, tw + px * 1.2, px * 1.5, px * 0.3);
    g.fill();
    g.strokeStyle = '#ffd23f';
    g.lineWidth = Math.max(2, px * 0.06);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(title, x, y, W * 0.36);
  }
}
