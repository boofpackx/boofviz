import { flameSprite, FONT_HUD, FONT_TITLE, glowSprite, hash } from './fretArt';

/**
 * The venues behind the fret highway, painted from code: a rehearsal garage,
 * a metal arena with a horned skull, a neon '80s club and a stadium at night.
 * Each paints its still scenery once per size (cached) and animates the rest
 * on top every frame: lights, the band, the crowd, pyro.
 */

export interface VenueFrame {
  t: number;
  beat: number;
  spb: number;
  kick: number;
  snare: number;
  bass: number;
  mids: number;
  highs: number;
  energy: number;
  drop: number;
  /** Star power glow, 0..1. */
  power: number;
  /** Stage-light strength, 0..1.5. */
  stage: number;
  /** 32-band EQ, 0..1. */
  bands: Float32Array;
  /** The rock meter, 0..1 (how the crowd feels). */
  rock: number;
}

export interface Venue {
  draw(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame): void;
  dispose?(): void;
}

function layer(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d')!];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const TAU = Math.PI * 2;

/** Ease a beat phase into a bounce (0 at the beat, up and back by the next). */
function bounce(beat: number): number {
  const ph = beat - Math.floor(beat);
  return Math.sin(ph * Math.PI);
}

abstract class PaintedVenue implements Venue {
  private still: HTMLCanvasElement | null = null;
  private key = '';
  /** How far the camera may drift; the still is painted that much larger. */
  protected readonly margin: number = 0.04;

  protected abstract paintStill(g: CanvasRenderingContext2D, w: number, h: number): void;
  protected abstract paintLive(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame): void;
  /** Camera offset (fractions of the frame) and zoom for this frame. */
  protected camera(_f: VenueFrame): [number, number, number] {
    return [0, 0, 1];
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame): void {
    const key = `${w}x${h}`;
    if (key !== this.key || !this.still) {
      this.key = key;
      const [c, sg] = layer(w, h);
      this.paintStill(sg, w, h);
      this.still = c;
    }
    const [dx, dy, zoom] = this.camera(f);
    const k = 1 + this.margin + (zoom - 1);
    g.save();
    g.translate(w / 2 + dx * w, h / 2 + dy * h);
    g.scale(k, k);
    g.translate(-w / 2, -h / 2);
    g.drawImage(this.still, 0, 0, w, h);
    this.paintLive(g, w, h, f);
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// Shared bits of scenery
// ---------------------------------------------------------------------------

function planks(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pw: number, base: [number, number, number], seed: number, vertical = true): void {
  const n = Math.ceil((vertical ? w : h) / pw);
  for (let i = 0; i < n; i++) {
    const t = 0.75 + hash(seed + i) * 0.45;
    g.fillStyle = `rgb(${base[0] * t},${base[1] * t},${base[2] * t})`;
    if (vertical) g.fillRect(x + i * pw, y, pw + 0.5, h);
    else g.fillRect(x, y + i * pw, w, pw + 0.5);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    if (vertical) g.fillRect(x + i * pw, y, Math.max(1, pw * 0.06), h);
    else g.fillRect(x, y + i * pw, w, Math.max(1, pw * 0.06));
    // Grain.
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const o = hash(seed * 3 + i * 7 + k) * pw;
      g.beginPath();
      if (vertical) {
        g.moveTo(x + i * pw + o, y);
        g.lineTo(x + i * pw + o + pw * 0.1, y + h);
      } else {
        g.moveTo(x, y + i * pw + o);
        g.lineTo(x + w, y + i * pw + o + pw * 0.1);
      }
      g.stroke();
    }
  }
}

/** A speaker cabinet: black tolex, grille cloth, chrome corners. */
function cabinet(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, grille = '#2b2620', logo = ''): void {
  g.fillStyle = '#0c0c0e';
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(w, h) * 0.05);
  g.fill();
  const m = Math.min(w, h) * 0.07;
  g.fillStyle = grille;
  g.fillRect(x + m, y + m, w - 2 * m, h - 2 * m);
  // The weave.
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (let i = 0; i < (w - 2 * m) / 3; i++) {
    g.beginPath();
    g.moveTo(x + m + i * 3, y + m);
    g.lineTo(x + m + i * 3, y + h - m);
    g.stroke();
  }
  g.strokeStyle = 'rgba(210,200,170,0.25)';
  g.lineWidth = Math.max(1, m * 0.25);
  g.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m);
  g.fillStyle = '#b8b8c4';
  const c = m * 1.1;
  for (const [cx, cy] of [
    [x, y],
    [x + w - c, y],
    [x, y + h - c],
    [x + w - c, y + h - c],
  ])
    g.fillRect(cx, cy, c, c);
  if (logo) {
    g.fillStyle = '#d8d0b8';
    g.font = `italic ${h * 0.09}px ${FONT_TITLE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(logo, x + w / 2, y + m + h * 0.08);
  }
}

/** A dark figure with a guitar, lit from behind (rim light in `rim`). */
function rocker(g: CanvasRenderingContext2D, x: number, y: number, s: number, f: VenueFrame, seed: number, rim: string, hair = 1, bass = false): void {
  const bang = f.kick * 0.5 + bounce(f.beat + hash(seed) * 0.2) * 0.5;
  const lean = Math.sin(f.beat * Math.PI * 0.5 + seed) * 0.05;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.rotate(lean);
  g.fillStyle = '#060508';
  g.strokeStyle = rim;
  g.lineWidth = 2.2;
  // Legs apart, a rock stance.
  g.beginPath();
  g.moveTo(-14, 0);
  g.lineTo(-30, 92);
  g.lineTo(-18, 94);
  g.lineTo(0, 30);
  g.lineTo(18, 94);
  g.lineTo(30, 92);
  g.lineTo(14, 0);
  g.closePath();
  g.fill();
  // Torso.
  g.beginPath();
  g.moveTo(-18, 2);
  g.quadraticCurveTo(-22, -40, -16, -62);
  g.lineTo(16, -62);
  g.quadraticCurveTo(22, -40, 18, 2);
  g.closePath();
  g.fill();
  g.stroke();
  // Head and hair, banging on the kick.
  const hy = -76 + bang * 10;
  const hx = bang * 4;
  g.beginPath();
  g.arc(hx, hy, 11, 0, TAU);
  g.fill();
  g.beginPath();
  g.moveTo(hx - 12, hy - 4);
  g.quadraticCurveTo(hx - 18 * hair, hy + 22 * hair, hx - 8, hy + 30 * hair * (0.8 + bang * 0.4));
  g.lineTo(hx + 8, hy + 30 * hair * (0.8 + bang * 0.4));
  g.quadraticCurveTo(hx + 18 * hair, hy + 22 * hair, hx + 12, hy - 4);
  g.closePath();
  g.fill();
  g.stroke();
  // The guitar across the body, the neck up and out.
  g.save();
  g.translate(0, -20);
  g.rotate(-0.42 - bang * 0.08);
  g.beginPath();
  g.ellipse(-6, 10, bass ? 20 : 18, bass ? 13 : 15, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.fillRect(8, 6, bass ? 70 : 58, 5);
  g.fillRect(bass ? 76 : 64, 3, 12, 11);
  g.restore();
  // Arms: the strumming one moves with the beat.
  const strum = Math.sin(f.beat * Math.PI * 2) * 6;
  g.lineWidth = 7;
  g.strokeStyle = '#060508';
  g.beginPath();
  g.moveTo(-14, -56);
  g.lineTo(-20, -24 + strum);
  g.lineTo(-6, -8 + strum);
  g.moveTo(14, -56);
  g.lineTo(34, -42);
  g.lineTo(46, -52);
  g.stroke();
  g.restore();
}

let lighter: HTMLCanvasElement | null = null;

/** A row of cheering heads and hands along the bottom. */
function crowd(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame, y0: number, rows: number, color: string, rim: string, lighters = false): void {
  for (let r = 0; r < rows; r++) {
    const y = y0 + r * h * 0.035;
    const size = h * (0.028 + r * 0.006);
    const n = Math.ceil(w / (size * 1.5));
    for (let i = 0; i < n; i++) {
      const seed = r * 1000 + i;
      const x = (i + hash(seed) * 0.6) * size * 1.5;
      const jump = (hash(seed + 7) > 0.4 ? bounce(f.beat + hash(seed + 3) * 0.3) : 0) * size * 0.45 * (0.5 + f.energy);
      const hy = y - jump;
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, hy, size * 0.42, 0, TAU);
      g.fill();
      g.fillRect(x - size * 0.55, hy + size * 0.3, size * 1.1, h);
      // Hands up: the horns on the kick, a lighter in slow songs.
      if (hash(seed + 11) < 0.35 + f.rock * 0.4) {
        const side = hash(seed + 13) > 0.5 ? 1 : -1;
        const ax = x + side * size * 0.45;
        const ay = hy - size * (0.9 + 0.4 * f.kick);
        g.strokeStyle = color;
        g.lineWidth = size * 0.22;
        g.beginPath();
        g.moveTo(x + side * size * 0.3, hy + size * 0.35);
        g.lineTo(ax, ay);
        g.stroke();
        g.beginPath();
        g.arc(ax, ay - size * 0.08, size * 0.16, 0, TAU);
        g.fill();
        if (lighters && hash(seed + 17) < 0.5) {
          const fl = size * (0.35 + 0.1 * Math.sin(f.t * 9 + seed));
          lighter ??= glowSprite('rgba(255,200,110,1)', 32);
          g.drawImage(lighter, ax - fl, ay - size * 0.4 - fl, fl * 2, fl * 2);
        }
      }
    }
  }
  // Rim light along the tops of the heads.
  const rimG = g.createLinearGradient(0, y0 - h * 0.05, 0, y0 + h * 0.05);
  rimG.addColorStop(0, rim);
  rimG.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.25;
  g.fillStyle = rimG;
  g.fillRect(0, y0 - h * 0.05, w, h * 0.1);
  g.restore();
}

/** A beam of light from (x, y), pointing at angle a (0 = straight down). */
function beam(g: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, spread: number, color: string, alpha: number): void {
  if (alpha <= 0.002) return;
  g.save();
  g.translate(x, y);
  g.rotate(a);
  const grd = g.createLinearGradient(0, 0, 0, len);
  grd.addColorStop(0, color.replace('A', String(alpha)));
  grd.addColorStop(1, color.replace('A', '0'));
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(-len * 0.01, 0);
  g.lineTo(-len * spread, len);
  g.lineTo(len * spread, len);
  g.lineTo(len * 0.01, 0);
  g.closePath();
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------------------
// The garage: a rehearsal room
// ---------------------------------------------------------------------------

function poster(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): void {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(rot);
  g.translate(-w / 2, -h / 2);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(w * 0.03, h * 0.03, w, h);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  paint(g, w, h);
  // Age: a yellowed wash and a torn corner.
  g.fillStyle = 'rgba(120,90,40,0.18)';
  g.fillRect(0, 0, w, h);
  g.restore();
  g.fillStyle = '#2a1e14';
  g.beginPath();
  g.moveTo(w, h);
  g.lineTo(w - w * 0.12, h);
  g.lineTo(w, h - h * 0.08);
  g.closePath();
  g.fill();
  // Tape at the top corners.
  g.fillStyle = 'rgba(230,220,180,0.75)';
  g.save();
  g.translate(w * 0.06, 0);
  g.rotate(-0.6);
  g.fillRect(-w * 0.08, -h * 0.02, w * 0.16, h * 0.04);
  g.restore();
  g.save();
  g.translate(w * 0.94, 0);
  g.rotate(0.6);
  g.fillRect(-w * 0.08, -h * 0.02, w * 0.16, h * 0.04);
  g.restore();
  g.restore();
}

function title(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, stroke = 'rgba(0,0,0,0.8)', font = FONT_TITLE): void {
  g.font = `${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.12;
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

class Garage extends PaintedVenue {
  protected readonly margin = 0.02;

  protected camera(f: VenueFrame): [number, number, number] {
    return [Math.sin(f.t * 0.21) * 0.004, Math.sin(f.t * 0.17) * 0.003 + f.kick * 0.0015, 1 + f.kick * 0.004];
  }

  protected paintStill(g: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w / 2;
    // Walls: old boards, darker toward the corners.
    planks(g, 0, 0, w, h, h * 0.045, [88, 70, 44], 11);
    // The ceiling: boards and rafters.
    planks(g, 0, 0, w, h * 0.13, h * 0.03, [62, 44, 28], 23, false);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, h * 0.125, w, h * 0.012);
    for (const [x0, x1] of [
      [-0.05, 0.3],
      [0.18, 0.46],
      [0.54, 0.82],
      [0.7, 1.05],
    ]) {
      g.save();
      g.beginPath();
      g.moveTo(w * x0, 0);
      g.lineTo(w * x0 + h * 0.05, 0);
      g.lineTo(w * x1 + h * 0.05, h * 0.13);
      g.lineTo(w * x1, h * 0.13);
      g.closePath();
      const grd = g.createLinearGradient(0, 0, 0, h * 0.13);
      grd.addColorStop(0, '#2e1d10');
      grd.addColorStop(1, '#5a3a20');
      g.fillStyle = grd;
      g.fill();
      g.restore();
    }

    // The window at the back with blinds and green curtains.
    const wx = cx - h * 0.12;
    const wy = h * 0.17;
    const ww = h * 0.24;
    const wh = h * 0.2;
    g.fillStyle = '#c8b48c';
    g.fillRect(wx - h * 0.012, wy - h * 0.012, ww + h * 0.024, wh + h * 0.024);
    const glass = g.createLinearGradient(0, wy, 0, wy + wh);
    glass.addColorStop(0, '#9ab4c8');
    glass.addColorStop(1, '#5e7488');
    g.fillStyle = glass;
    g.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(40,40,40,0.55)';
    for (let i = 0; i < 14; i++) g.fillRect(wx, wy + (i * wh) / 14, ww, Math.max(1, wh * 0.025));
    for (const side of [-1, 1]) {
      const curX = side < 0 ? wx - h * 0.06 : wx + ww - h * 0.01;
      const cw = h * 0.07;
      const cg = g.createLinearGradient(curX, 0, curX + cw, 0);
      for (let i = 0; i <= 6; i++) cg.addColorStop(i / 6, i % 2 ? '#3d6a3a' : '#1e3a1e');
      g.fillStyle = cg;
      g.beginPath();
      g.moveTo(curX, wy - h * 0.03);
      g.lineTo(curX + cw, wy - h * 0.03);
      g.quadraticCurveTo(curX + cw * (side < 0 ? 0.8 : 0.2), wy + wh * 0.6, curX + cw * (side < 0 ? 0.9 : 0.1), wy + wh + h * 0.06);
      g.lineTo(curX + (side < 0 ? 0 : cw) * 1, wy + wh + h * 0.06);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#3a2a1a';
    g.fillRect(wx - h * 0.08, wy - h * 0.035, ww + h * 0.16, h * 0.01);

    // An old couch under the window, a red guitar left on it.
    const sy = h * 0.4;
    g.fillStyle = '#8a7a5a';
    g.beginPath();
    g.roundRect(cx - h * 0.3, sy, h * 0.6, h * 0.11, h * 0.02);
    g.fill();
    g.fillStyle = '#a8966e';
    g.beginPath();
    g.roundRect(cx - h * 0.28, sy - h * 0.035, h * 0.56, h * 0.06, h * 0.02);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(cx - h * 0.3, sy + h * 0.06, h * 0.6, h * 0.05);
    g.save();
    g.translate(cx + h * 0.06, sy + h * 0.02);
    g.rotate(-0.25);
    g.fillStyle = '#c41a1a';
    g.beginPath();
    g.ellipse(0, 0, h * 0.05, h * 0.03, 0, 0, TAU);
    g.ellipse(-h * 0.04, h * 0.005, h * 0.035, h * 0.025, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#2a1408';
    g.fillRect(h * 0.03, -h * 0.006, h * 0.12, h * 0.012);
    g.restore();

    // Posters on the walls (left).
    poster(g, w * 0.02, h * 0.14, h * 0.19, h * 0.24, -0.05, (pg, pw, ph) => {
      const bg = pg.createLinearGradient(0, 0, 0, ph);
      bg.addColorStop(0, '#f08a2a');
      bg.addColorStop(1, '#a8240c');
      pg.fillStyle = bg;
      pg.fillRect(0, 0, pw, ph);
      pg.fillStyle = '#1a0a04';
      pg.beginPath();
      pg.moveTo(pw * 0.58, ph * 0.22);
      pg.lineTo(pw * 0.3, ph * 0.58);
      pg.lineTo(pw * 0.5, ph * 0.58);
      pg.lineTo(pw * 0.38, ph * 0.9);
      pg.lineTo(pw * 0.74, ph * 0.48);
      pg.lineTo(pw * 0.54, ph * 0.48);
      pg.lineTo(pw * 0.68, ph * 0.22);
      pg.closePath();
      pg.fill();
      title(pg, 'WILD', pw / 2, ph * 0.1, pw * 0.26, '#fff2c0');
      title(pg, 'STATIC', pw / 2, ph * 0.94, pw * 0.2, '#fff2c0');
    });
    poster(g, w * 0.14, h * 0.15, h * 0.17, h * 0.21, 0.04, (pg, pw, ph) => {
      pg.fillStyle = '#141838';
      pg.fillRect(0, 0, pw, ph);
      pg.fillStyle = '#e8c41c';
      pg.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? pw * 0.12 : pw * 0.28;
        pg.lineTo(pw / 2 + Math.cos(a) * r, ph * 0.55 + Math.sin(a) * r);
      }
      pg.closePath();
      pg.fill();
      title(pg, 'BRASS', pw / 2, ph * 0.13, pw * 0.24, '#f6d62a', '#000');
      title(pg, 'KNUCKLE', pw / 2, ph * 0.27, pw * 0.17, '#f6d62a', '#000');
      title(pg, 'FRI 9PM', pw / 2, ph * 0.9, pw * 0.13, '#e8e0d0', '#000', FONT_HUD);
    });
    poster(g, w * 0.255, h * 0.2, h * 0.15, h * 0.17, -0.02, (pg, pw, ph) => {
      pg.fillStyle = '#4a1858';
      pg.fillRect(0, 0, pw, ph);
      for (let i = 9; i > 0; i--) {
        pg.fillStyle = i % 2 ? '#ff5ab4' : '#ffd23a';
        pg.beginPath();
        pg.arc(pw / 2, ph * 0.5, (i / 9) * pw * 0.48, 0, TAU);
        pg.fill();
      }
      pg.fillStyle = '#ffffff';
      pg.beginPath();
      pg.ellipse(pw / 2, ph * 0.5, pw * 0.14, pw * 0.08, 0, 0, TAU);
      pg.fill();
      pg.fillStyle = '#18082a';
      pg.beginPath();
      pg.arc(pw / 2, ph * 0.5, pw * 0.06, 0, TAU);
      pg.fill();
    });
    // Posters (right).
    poster(g, w * 0.69, h * 0.13, h * 0.16, h * 0.25, 0.03, (pg, pw, ph) => {
      pg.fillStyle = '#1c6a6a';
      pg.fillRect(0, 0, pw, ph);
      pg.fillStyle = '#0a1a1a';
      for (const [px, s] of [
        [0.32, 1],
        [0.68, 0.9],
      ]) {
        pg.beginPath();
        pg.arc(pw * px, ph * 0.38, pw * 0.09 * s, 0, TAU);
        pg.fill();
        pg.fillRect(pw * (px - 0.1 * s), ph * 0.45, pw * 0.2 * s, ph * 0.4);
      }
      title(pg, 'NIGHT', pw / 2, ph * 0.1, pw * 0.22, '#f0f0e0', '#000');
      title(pg, 'DRIVERS', pw / 2, ph * 0.92, pw * 0.18, '#f0f0e0', '#000');
    });
    poster(g, w * 0.84, h * 0.15, h * 0.2, h * 0.24, -0.04, (pg, pw, ph) => {
      pg.fillStyle = '#e8e2d0';
      pg.fillRect(0, 0, pw, ph);
      pg.fillStyle = '#121212';
      pg.beginPath();
      pg.arc(pw / 2, ph * 0.48, pw * 0.24, Math.PI, 0);
      pg.lineTo(pw * 0.68, ph * 0.66);
      pg.lineTo(pw * 0.32, ph * 0.66);
      pg.closePath();
      pg.fill();
      pg.fillStyle = '#e8e2d0';
      pg.beginPath();
      pg.arc(pw * 0.41, ph * 0.5, pw * 0.06, 0, TAU);
      pg.arc(pw * 0.59, ph * 0.5, pw * 0.06, 0, TAU);
      pg.fill();
      for (let i = 0; i < 5; i++) pg.fillRect(pw * (0.35 + i * 0.065), ph * 0.66, pw * 0.04, ph * 0.06);
      title(pg, 'TOUR 2005', pw / 2, ph * 0.12, pw * 0.15, '#121212', '#e8e2d0', FONT_HUD);
      title(pg, 'BONES', pw / 2, ph * 0.86, pw * 0.22, '#c41a1a', '#000');
    });

    // Floorboards along the bottom.
    const fy = h * 0.82;
    planks(g, 0, fy, w, h - fy, h * 0.03, [70, 46, 26], 41, false);
    const floorShade = g.createLinearGradient(0, fy, 0, h);
    floorShade.addColorStop(0, 'rgba(0,0,0,0.55)');
    floorShade.addColorStop(1, 'rgba(0,0,0,0.15)');
    g.fillStyle = floorShade;
    g.fillRect(0, fy, w, h - fy);

    // Left: the amp stack, a guitar leaning on it, milk crates.
    const ax = w * 0.02;
    cabinet(g, ax, h * 0.5, h * 0.32, h * 0.34, '#2a241c');
    g.fillStyle = '#0e0e10';
    g.beginPath();
    g.roundRect(ax + h * 0.005, h * 0.41, h * 0.31, h * 0.09, h * 0.008);
    g.fill();
    const plate = g.createLinearGradient(0, h * 0.43, 0, h * 0.47);
    plate.addColorStop(0, '#e6cf8a');
    plate.addColorStop(1, '#8a6a2a');
    g.fillStyle = plate;
    g.fillRect(ax + h * 0.02, h * 0.445, h * 0.28, h * 0.035);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = '#141414';
      g.beginPath();
      g.arc(ax + h * (0.05 + i * 0.032), h * 0.4625, h * 0.009, 0, TAU);
      g.fill();
      g.fillStyle = '#c8c8c8';
      g.fillRect(ax + h * (0.05 + i * 0.032) - 0.5, h * 0.455, 1.2, h * 0.007);
    }
    title(g, 'Boof', ax + h * 0.16, h * 0.425, h * 0.03, '#f2e8c8', 'rgba(0,0,0,0.6)');
    title(g, 'BOOF', ax + h * 0.16, h * 0.53, h * 0.026, '#d8d0b8', 'rgba(0,0,0,0.6)', FONT_HUD);
    // Milk crates.
    for (const [mx, my] of [
      [w * 0.0, h * 0.86],
      [w * 0.0 + h * 0.17, h * 0.88],
    ]) {
      g.fillStyle = '#e0601a';
      g.fillRect(mx, my, h * 0.16, h * 0.14);
      g.fillStyle = '#7a2a08';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.fillRect(mx + h * (0.015 + i * 0.037), my + h * (0.02 + j * 0.04), h * 0.025, h * 0.025);
    }
    // A sunburst guitar leaning on the amp.
    g.save();
    g.translate(ax + h * 0.2, h * 0.75);
    g.rotate(-0.16);
    const burst = g.createRadialGradient(0, h * 0.01, h * 0.01, 0, 0, h * 0.09);
    burst.addColorStop(0, '#f0b040');
    burst.addColorStop(0.6, '#b04a10');
    burst.addColorStop(1, '#2a0a04');
    g.fillStyle = burst;
    // A single-cut body: a full lower bout, a waist, a smaller upper bout with one horn.
    const u = h * 0.01;
    g.beginPath();
    g.moveTo(0, 10.5 * u);
    g.bezierCurveTo(7.5 * u, 10.5 * u, 8 * u, 3 * u, 6 * u, -1 * u);
    g.bezierCurveTo(5 * u, -3 * u, 6 * u, -6 * u, 5 * u, -9 * u);
    g.bezierCurveTo(4 * u, -12 * u, 1 * u, -13 * u, -1 * u, -11 * u);
    g.lineTo(-2 * u, -9 * u);
    g.bezierCurveTo(-5 * u, -11 * u, -6.5 * u, -7 * u, -5.5 * u, -3 * u);
    g.bezierCurveTo(-8 * u, 1 * u, -7.5 * u, 10.5 * u, 0, 10.5 * u);
    g.closePath();
    g.fill();
    g.strokeStyle = '#f6e6c0';
    g.lineWidth = Math.max(1, h * 0.003);
    g.stroke();
    g.fillStyle = '#1a0c06';
    g.fillRect(-h * 0.009, -h * 0.32, h * 0.018, h * 0.2);
    g.fillRect(-h * 0.017, -h * 0.37, h * 0.034, h * 0.06);
    g.fillStyle = '#c8c8c8';
    g.fillRect(-h * 0.03, -h * 0.01, h * 0.06, h * 0.012);
    g.restore();

    // Right: crates of records, a pizza box, a speaker.
    const kx = w * 0.82;
    for (let i = 0; i < 2; i++) {
      const by = h * (0.62 + i * 0.19);
      g.fillStyle = '#8a6a3a';
      g.fillRect(kx, by, w * 0.18, h * 0.18);
      g.fillStyle = '#5a4020';
      for (let j = 0; j < 3; j++) g.fillRect(kx, by + j * h * 0.06, w * 0.18, h * 0.008);
      // Record sleeves poking out.
      for (let r = 0; r < 7; r++) {
        g.fillStyle = ['#e83a2a', '#2a8ae8', '#f2d22a', '#ffffff', '#1aa85a', '#c83aa8', '#ff8a1a'][(r + i * 3) % 7];
        g.fillRect(kx + w * 0.01 + r * w * 0.023, by - h * 0.03, w * 0.02, h * 0.04);
      }
    }
    g.save();
    g.translate(kx + w * 0.09, h * 0.585);
    g.rotate(-0.05);
    g.fillStyle = '#f2ece0';
    g.fillRect(-w * 0.08, -h * 0.025, w * 0.16, h * 0.035);
    g.fillStyle = '#c41a1a';
    g.fillRect(-w * 0.08, -h * 0.025, w * 0.16, h * 0.008);
    title(g, 'PIZZA', 0, -h * 0.004, h * 0.02, '#c41a1a', 'rgba(255,255,255,0.4)', FONT_HUD);
    g.restore();
    cabinet(g, w * 0.69, h * 0.6, h * 0.22, h * 0.26, '#1a1814');

    // A lamp's warm corner and the room's shadows.
    const vig = g.createRadialGradient(cx, h * 0.25, h * 0.1, cx, h * 0.45, w * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.7, 'rgba(10,4,0,0.35)');
    vig.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);
  }

  protected paintLive(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame): void {
    const cx = w / 2;
    // The speaker's woofer pumps with the bass.
    const sx = w * 0.69 + h * 0.11;
    const sy = h * 0.73;
    const push = 1 + f.bass * 0.06 + f.kick * 0.05;
    g.fillStyle = '#060606';
    g.beginPath();
    g.arc(sx, sy, h * 0.085, 0, TAU);
    g.fill();
    const cone = g.createRadialGradient(sx - h * 0.01, sy - h * 0.01, h * 0.005, sx, sy, h * 0.075 * push);
    cone.addColorStop(0, '#5a5a5a');
    cone.addColorStop(0.3, '#1a1a1a');
    cone.addColorStop(0.85, '#2a2a2a');
    cone.addColorStop(1, '#0a0a0a');
    g.fillStyle = cone;
    g.beginPath();
    g.arc(sx, sy, h * 0.075 * push, 0, TAU);
    g.fill();
    g.fillStyle = '#3a3a3a';
    g.beginPath();
    g.arc(sx, sy, h * 0.02 * push, 0, TAU);
    g.fill();
    // The amp's jewel light.
    g.fillStyle = `rgba(255,${40 + f.kick * 60},20,${0.7 + 0.3 * f.kick})`;
    g.beginPath();
    g.arc(w * 0.02 + h * 0.3, h * 0.4625, h * 0.008, 0, TAU);
    g.fill();

    // The bare bulb, swinging a little on its cord, every bar.
    const swing = Math.sin((f.beat / 4) * TAU) * 0.08 * (0.6 + f.energy * 0.6);
    const len = h * 0.11;
    const bx = cx + Math.sin(swing) * len;
    const by = Math.cos(swing) * len;
    g.strokeStyle = '#141414';
    g.lineWidth = Math.max(1, h * 0.003);
    g.beginPath();
    g.moveTo(cx, 0);
    g.lineTo(bx, by);
    g.stroke();
    const glowR = h * (0.42 + f.kick * 0.04);
    const warm = f.power > 0.02 ? `rgba(${255 - f.power * 120},${235 - f.power * 30},${200 + f.power * 55},` : 'rgba(255,225,170,';
    g.save();
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(bx, by + h * 0.015, 0, bx, by + h * 0.015, glowR);
    halo.addColorStop(0, warm + `${0.55 + f.kick * 0.15})`);
    halo.addColorStop(0.15, warm + '0.2)');
    halo.addColorStop(1, warm + '0)');
    g.fillStyle = halo;
    g.fillRect(bx - glowR, by - glowR, glowR * 2, glowR * 2);
    g.restore();
    g.fillStyle = '#fff8e0';
    g.beginPath();
    g.ellipse(bx, by + h * 0.015, h * 0.012, h * 0.016, swing, 0, TAU);
    g.fill();
    g.fillStyle = '#6a6a6a';
    g.fillRect(bx - h * 0.006, by - h * 0.004, h * 0.012, h * 0.008);
    // The light moves the shadows: darker on the far side of the swing.
    const shade = g.createLinearGradient(0, 0, w, 0);
    const side = Math.sin(swing) * 4;
    shade.addColorStop(0, `rgba(0,0,0,${clamp(0.12 + side, 0, 0.3)})`);
    shade.addColorStop(0.5, 'rgba(0,0,0,0)');
    shade.addColorStop(1, `rgba(0,0,0,${clamp(0.12 - side, 0, 0.3)})`);
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
    // Dust in the light.
    g.fillStyle = 'rgba(255,240,210,0.35)';
    for (let i = 0; i < 40; i++) {
      const px = cx + (hash(i) - 0.5) * h * 0.8 + Math.sin(f.t * 0.3 + i) * h * 0.03;
      const py = (hash(i + 50) * h * 0.6 + f.t * h * 0.01 * (0.5 + hash(i + 9))) % (h * 0.6);
      const sz = Math.max(1, h * 0.002 * (0.5 + hash(i + 3)));
      g.fillRect(px, py + h * 0.05, sz, sz);
    }
  }
}

// ---------------------------------------------------------------------------
// The arena: a metal stage under a horned skull
// ---------------------------------------------------------------------------

class Arena extends PaintedVenue {
  private flame: HTMLCanvasElement | null = null;
  private glowR: HTMLCanvasElement | null = null;
  private glowM: HTMLCanvasElement | null = null;
  private glowB: HTMLCanvasElement | null = null;
  protected readonly margin = 0.05;

  protected camera(f: VenueFrame): [number, number, number] {
    return [Math.sin(f.t * 0.23) * 0.012, Math.sin(f.t * 0.31) * 0.006, 1 + f.kick * 0.008 + f.power * 0.02];
  }

  protected paintStill(g: CanvasRenderingContext2D, w: number, h: number): void {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#05030a');
    bg.addColorStop(0.55, '#0e0618');
    bg.addColorStop(1, '#030206');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // A huge black backdrop curtain with folds.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${30 + hash(i) * 20},${10 + hash(i + 1) * 10},${40 + hash(i + 2) * 20},0.35)`;
      g.fillRect((i / 40) * w, h * 0.08, w / 80, h * 0.6);
    }
    // Red backlight, then the skull totem, centre-right behind the neck.
    const back = g.createRadialGradient(w * 0.66, h * 0.3, h * 0.05, w * 0.66, h * 0.3, h * 0.55);
    back.addColorStop(0, 'rgba(255,40,20,0.55)');
    back.addColorStop(0.5, 'rgba(140,10,30,0.25)');
    back.addColorStop(1, 'rgba(60,0,30,0)');
    g.fillStyle = back;
    g.fillRect(0, 0, w, h);
    this.skull(g, w * 0.66, h * 0.33, h * 0.27);
    // Speaker walls each side.
    for (const side of [0, 1]) {
      const x0 = side ? w * 0.8 : w * 0.0;
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) cabinet(g, x0 + c * w * 0.067, h * (0.3 + r * 0.105), w * 0.064, h * 0.1, '#1e1e24', r === 0 && c === 1 ? 'Boof' : '');
    }
    // Truss across the top and its towers.
    this.truss(g, 0, h * 0.04, w, h * 0.05, true);
    this.truss(g, w * 0.255, h * 0.06, w * 0.02, h * 0.62, false);
    this.truss(g, w * 0.725, h * 0.06, w * 0.02, h * 0.62, false);
    // The stage deck and its glowing front edge.
    const deck = g.createLinearGradient(0, h * 0.64, 0, h);
    deck.addColorStop(0, '#18121e');
    deck.addColorStop(1, '#040306');
    g.fillStyle = deck;
    g.fillRect(0, h * 0.64, w, h * 0.36);
    g.fillStyle = 'rgba(255,90,40,0.5)';
    g.fillRect(0, h * 0.64, w, Math.max(1, h * 0.004));
    // A drum riser at the back.
    g.fillStyle = '#0c0a10';
    g.fillRect(w * 0.36, h * 0.54, w * 0.2, h * 0.1);
    g.fillStyle = 'rgba(200,180,255,0.15)';
    g.fillRect(w * 0.36, h * 0.54, w * 0.2, Math.max(1, h * 0.004));
  }

  private truss(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, horizontal: boolean): void {
    g.save();
    g.strokeStyle = '#6a6a78';
    g.lineWidth = Math.max(1, Math.min(w, h) * 0.12);
    g.strokeRect(x, y, w, h);
    g.lineWidth = Math.max(1, Math.min(w, h) * 0.06);
    const step = horizontal ? h : w;
    g.beginPath();
    if (horizontal)
      for (let px = x; px < x + w; px += step) {
        g.moveTo(px, y);
        g.lineTo(px + step, y + h);
        g.moveTo(px + step, y);
        g.lineTo(px, y + h);
      }
    else
      for (let py = y; py < y + h; py += step) {
        g.moveTo(x, py);
        g.lineTo(x + w, py + step);
        g.moveTo(x + w, py);
        g.lineTo(x, py + step);
      }
    g.stroke();
    g.restore();
  }

  private skull(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    g.save();
    g.translate(x, y);
    // Horns: sweeping up and out.
    for (const side of [-1, 1]) {
      const horn = g.createLinearGradient(side * s * 0.3, 0, side * s * 1.0, -s * 0.9);
      horn.addColorStop(0, '#3a0a0a');
      horn.addColorStop(0.6, '#7a1a12');
      horn.addColorStop(1, '#e8d8b8');
      g.fillStyle = horn;
      g.beginPath();
      g.moveTo(side * s * 0.32, -s * 0.18);
      g.bezierCurveTo(side * s * 0.9, -s * 0.2, side * s * 1.05, -s * 0.6, side * s * 0.82, -s * 1.0);
      g.bezierCurveTo(side * s * 0.82, -s * 0.62, side * s * 0.62, -s * 0.42, side * s * 0.28, -s * 0.38);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = Math.max(1, s * 0.012);
      g.stroke();
      // Ridges on the horn.
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        g.beginPath();
        g.moveTo(side * s * (0.32 + t * 0.6), -s * (0.2 + t * 0.55));
        g.lineTo(side * s * (0.28 + t * 0.48), -s * (0.36 + t * 0.48));
        g.stroke();
      }
    }
    // The cranium.
    const bone = g.createRadialGradient(-s * 0.12, -s * 0.3, s * 0.05, 0, -s * 0.05, s * 0.6);
    bone.addColorStop(0, '#f4ead2');
    bone.addColorStop(0.55, '#b8a888');
    bone.addColorStop(1, '#4a3e30');
    g.fillStyle = bone;
    g.beginPath();
    g.moveTo(-s * 0.38, s * 0.08);
    g.bezierCurveTo(-s * 0.52, -s * 0.3, -s * 0.3, -s * 0.58, 0, -s * 0.58);
    g.bezierCurveTo(s * 0.3, -s * 0.58, s * 0.52, -s * 0.3, s * 0.38, s * 0.08);
    g.lineTo(s * 0.26, s * 0.22);
    g.lineTo(s * 0.24, s * 0.42);
    g.lineTo(-s * 0.24, s * 0.42);
    g.lineTo(-s * 0.26, s * 0.22);
    g.closePath();
    g.fill();
    // Cracks.
    g.strokeStyle = 'rgba(60,40,20,0.6)';
    g.lineWidth = Math.max(1, s * 0.008);
    g.beginPath();
    g.moveTo(-s * 0.05, -s * 0.58);
    g.lineTo(-s * 0.1, -s * 0.44);
    g.lineTo(-s * 0.04, -s * 0.36);
    g.moveTo(s * 0.2, -s * 0.5);
    g.lineTo(s * 0.26, -s * 0.38);
    g.stroke();
    // Sockets, nose, teeth.
    g.fillStyle = '#0a0404';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(side * s * 0.04, -s * 0.14);
      g.quadraticCurveTo(side * s * 0.12, -s * 0.3, side * s * 0.3, -s * 0.2);
      g.quadraticCurveTo(side * s * 0.32, -s * 0.02, side * s * 0.14, -s * 0.0);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.moveTo(0, s * 0.02);
    g.lineTo(-s * 0.06, s * 0.14);
    g.lineTo(s * 0.06, s * 0.14);
    g.closePath();
    g.fill();
    g.fillStyle = '#e8dcc0';
    for (let i = -3; i <= 3; i++) {
      g.fillRect(i * s * 0.06 - s * 0.024, s * 0.22, s * 0.048, s * 0.12);
      g.strokeStyle = '#2a1a0a';
      g.strokeRect(i * s * 0.06 - s * 0.024, s * 0.22, s * 0.048, s * 0.12);
    }
    g.restore();
  }

  protected paintLive(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame): void {
    this.flame ??= flameSprite();
    this.glowR ??= glowSprite('rgba(255,40,20,1)');
    this.glowM ??= glowSprite('rgba(220,60,255,1)');
    this.glowB ??= glowSprite('rgba(80,170,255,1)');
    const st = f.stage;
    g.save();
    g.globalCompositeOperation = 'lighter';
    // Wash lights from the sides, magenta, pulsing on the snare.
    for (const [x, y] of [
      [w * 0.12, h * 0.2],
      [w * 0.88, h * 0.2],
      [w * 0.3, h * 0.08],
      [w * 0.7, h * 0.08],
    ]) {
      const r = h * (0.34 + 0.06 * f.snare);
      g.globalAlpha = (0.26 + 0.28 * f.snare) * st;
      g.drawImage(f.power > 0.5 ? this.glowB : this.glowM, x - r, y - r, r * 2, r * 2);
    }
    // Spotlights sweeping down from the truss.
    for (let i = 0; i < 5; i++) {
      const x = w * (0.18 + i * 0.16);
      const a = Math.sin(f.t * 0.45 + i * 1.7) * 0.32 + (i - 2) * 0.06;
      const col = f.power > 0.5 ? 'rgba(140,210,255,A)' : i % 2 ? 'rgba(170,190,255,A)' : 'rgba(255,255,240,A)';
      const lit = (0.16 + 0.24 * f.kick + 0.1 * f.energy) * st;
      beam(g, x, h * 0.07, a, h * 0.9, 0.075, col, lit);
      const r = h * 0.05;
      g.globalAlpha = clamp(lit * 2.5, 0, 1);
      g.drawImage(f.power > 0.5 ? this.glowB : this.glowM, x - r, h * 0.07 - r, r * 2, r * 2);
      g.globalAlpha = 1;
    }
    // Par cans on the truss, stepping colour each beat.
    const bi = Math.floor(f.beat);
    for (let i = 0; i < 12; i++) {
      const x = w * (0.04 + i * 0.084);
      const on = (i + bi) % 3 === 0;
      const r = h * 0.03;
      g.globalAlpha = (on ? 0.9 : 0.25) * st;
      g.drawImage(i % 2 ? this.glowM : f.power > 0.5 ? this.glowB : this.glowR, x - r, h * 0.065 - r, r * 2, r * 2);
    }
    // The skull's eyes burn (blue in star power).
    const ex = w * 0.66;
    const ey = h * 0.33 - h * 0.27 * 0.12;
    for (const side of [-1, 1]) {
      const r = h * (0.05 + 0.03 * f.bass + 0.02 * f.kick);
      g.globalAlpha = 0.8 + 0.2 * f.kick;
      g.drawImage(f.power > 0.5 ? this.glowB : this.glowR, ex + side * h * 0.27 * 0.17 - r, ey - r, r * 2, r * 2);
    }
    // Pyro: flame jets along the stage front on drops, in star power, and a low burn always.
    const pyro = clamp(f.drop * 1.2 + f.power * 0.8, 0, 1);
    for (let i = 0; i < 9; i++) {
      const x = w * (0.08 + i * 0.105);
      const lick = 0.35 + 0.15 * Math.sin(f.t * 11 + i * 2.1) + pyro * (0.9 + 0.3 * Math.sin(f.t * 17 + i));
      const fw = h * 0.08;
      const fh = h * 0.2 * lick;
      g.globalAlpha = clamp(0.5 + pyro * 0.5, 0, 1);
      g.drawImage(this.flame, x - fw / 2, h * 0.645 - fh * 0.92, fw, fh);
    }
    g.restore();
    // The band: a guitarist each side and a drummer on the riser.
    const rim = f.power > 0.5 ? 'rgba(140,210,255,0.9)' : 'rgba(255,120,200,0.8)';
    rocker(g, w * 0.17, h * 0.53, h * 0.0012, f, 1, rim, 1.3);
    rocker(g, w * 0.84, h * 0.53, h * 0.0012, f, 5, rim, 1.1, true);
    this.drummer(g, w * 0.46, h * 0.53, h * 0.001, f, rim);
    // Haze.
    const haze = g.createLinearGradient(0, h * 0.35, 0, h * 0.75);
    haze.addColorStop(0, 'rgba(120,80,160,0)');
    haze.addColorStop(1, `rgba(120,80,160,${0.12 + 0.08 * f.energy})`);
    g.fillStyle = haze;
    g.fillRect(0, h * 0.35, w, h * 0.4);
    crowd(g, w, h, f, h * 0.95, 2, '#030205', 'rgba(255,120,200,1)');
  }

  private drummer(g: CanvasRenderingContext2D, x: number, y: number, s: number, f: VenueFrame, rim: string): void {
    g.save();
    g.translate(x, y);
    g.scale(s * 100, s * 100);
    g.fillStyle = '#060508';
    g.strokeStyle = rim;
    g.lineWidth = 0.025;
    // Kit: kick drum, toms and cymbals.
    g.beginPath();
    g.arc(0, -0.25, 0.32, 0, TAU);
    g.fill();
    g.stroke();
    for (const [cxx, cyy, r] of [
      [-0.42, -0.55, 0.14],
      [0.42, -0.55, 0.14],
    ]) {
      g.beginPath();
      g.arc(cxx, cyy, r, 0, TAU);
      g.fill();
    }
    const crash = f.snare * 0.15;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(side * 0.75, -0.95 - crash * (side > 0 ? 1 : 0), 0.24, 0.05, side * 0.2, 0, TAU);
      g.fill();
      g.stroke();
    }
    // The drummer behind it, sticks up on the off-beat.
    const hit = bounce(f.beat * 2);
    g.beginPath();
    g.arc(0, -1.05 + f.kick * 0.04, 0.13, 0, TAU);
    g.fill();
    g.fillRect(-0.2, -0.92, 0.4, 0.4);
    g.lineWidth = 0.05;
    g.strokeStyle = '#060508';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(side * 0.18, -0.85);
      g.lineTo(side * 0.38, -0.7 - hit * 0.25 * (side > 0 ? 1 : 1 - f.snare));
      g.lineTo(side * 0.5, -0.95 - hit * 0.4);
      g.stroke();
    }
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// The neon '80s club
// ---------------------------------------------------------------------------

class NeonClub extends PaintedVenue {
  private glowLayer: HTMLCanvasElement | null = null;
  private glowKey = '';
  protected readonly margin = 0.03;

  protected camera(f: VenueFrame): [number, number, number] {
    return [Math.sin(f.t * 0.27) * 0.008, 0, 1 + f.kick * 0.006];
  }

  private tubes(g: CanvasRenderingContext2D, w: number, h: number, lit: boolean): void {
    const tube = (color: string, width: number, path: () => void): void => {
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (lit) {
        g.shadowColor = color;
        g.shadowBlur = h * 0.03;
      }
      g.strokeStyle = lit ? color : 'rgba(80,60,90,0.9)';
      g.lineWidth = width;
      path();
      g.stroke();
      if (lit) {
        g.shadowBlur = 0;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = width * 0.35;
        path();
        g.stroke();
      }
      g.restore();
    };
    const u = h * 0.006;
    // A lightning bolt (pink), a star (teal) and LOUD in script.
    tube('#ff3ab4', u, () => {
      g.beginPath();
      g.moveTo(w * 0.17, h * 0.12);
      g.lineTo(w * 0.12, h * 0.27);
      g.lineTo(w * 0.16, h * 0.27);
      g.lineTo(w * 0.11, h * 0.42);
      g.lineTo(w * 0.21, h * 0.23);
      g.lineTo(w * 0.17, h * 0.23);
      g.lineTo(w * 0.22, h * 0.12);
      g.closePath();
    });
    tube('#38f0ff', u, () => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? h * 0.045 : h * 0.1;
        g.lineTo(w * 0.85 + Math.cos(a) * r, h * 0.25 + Math.sin(a) * r);
      }
      g.closePath();
    });
    g.save();
    g.font = `italic ${h * 0.13}px ${FONT_TITLE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (lit) {
      g.shadowColor = '#ffd23a';
      g.shadowBlur = h * 0.03;
    }
    g.strokeStyle = lit ? '#ffd23a' : 'rgba(80,70,50,0.9)';
    g.lineWidth = u;
    g.strokeText('Loud', w * 0.5, h * 0.17);
    if (lit) {
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = u * 0.35;
      g.strokeText('Loud', w * 0.5, h * 0.17);
    }
    g.restore();
    // Neon strips along the stage edge.
    tube('#ff3ab4', u * 0.8, () => {
      g.beginPath();
      g.moveTo(0, h * 0.6);
      g.lineTo(w, h * 0.6);
    });
  }

  protected paintStill(g: CanvasRenderingContext2D, w: number, h: number): void {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a0620');
    bg.addColorStop(0.6, '#1e0a3a');
    bg.addColorStop(1, '#06030e');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // Brick wall.
    g.fillStyle = 'rgba(60,30,80,0.35)';
    for (let r = 0; r < 26; r++)
      for (let c = 0; c < 40; c++) {
        if (hash(r * 40 + c) < 0.3) continue;
        g.fillRect((c + (r % 2) * 0.5) * (w / 40), r * h * 0.023, w / 40 - 2, h * 0.02);
      }
    this.tubes(g, w, h, false);
    // White amp stacks with neon edges.
    for (const side of [0, 1]) {
      const x0 = side ? w * 0.82 : w * 0.02;
      for (let r = 0; r < 2; r++) {
        g.fillStyle = '#e8e4f0';
        g.fillRect(x0, h * (0.36 + r * 0.12), w * 0.15, h * 0.11);
        g.fillStyle = '#2a2236';
        g.fillRect(x0 + w * 0.008, h * (0.37 + r * 0.12), w * 0.134, h * 0.09);
      }
    }
    // Checkerboard floor in perspective.
    const fy = h * 0.6;
    for (let r = 0; r < 10; r++) {
      const z0 = r / 10;
      const z1 = (r + 1) / 10;
      const y0 = fy + (h - fy) * z0 * z0;
      const y1 = fy + (h - fy) * z1 * z1;
      for (let c = -12; c < 12; c++) {
        const xa = (cc: number, z: number): number => w / 2 + cc * (w * 0.03 + w * 0.09 * z);
        g.fillStyle = (r + c) % 2 ? '#e8e0f0' : '#120a1c';
        g.beginPath();
        g.moveTo(xa(c, z0), y0);
        g.lineTo(xa(c + 1, z0), y0);
        g.lineTo(xa(c + 1, z1), y1);
        g.lineTo(xa(c, z1), y1);
        g.closePath();
        g.fill();
      }
    }
    const fade = g.createLinearGradient(0, fy, 0, h);
    fade.addColorStop(0, 'rgba(20,0,40,0.75)');
    fade.addColorStop(1, 'rgba(10,0,20,0.35)');
    g.fillStyle = fade;
    g.fillRect(0, fy, w, h - fy);
  }

  protected paintLive(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame): void {
    const key = `${w}x${h}`;
    if (key !== this.glowKey || !this.glowLayer) {
      this.glowKey = key;
      const [c, lg] = layer(w, h);
      this.tubes(lg, w, h, true);
      this.glowLayer = c;
    }
    // The tubes buzz on with the beat (and flicker now and then).
    const flicker = hash(Math.floor(f.t * 12)) < 0.03 ? 0.4 : 1;
    g.globalAlpha = clamp((0.65 + 0.35 * f.kick) * flicker, 0, 1);
    g.drawImage(this.glowLayer, 0, 0, w, h);
    g.globalAlpha = 1;
    // A mirror ball throws specks across the walls.
    const mbx = w * 0.5;
    const mby = h * 0.05;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const a = hash(i) * TAU + f.t * 0.4;
      const r = (0.2 + hash(i + 70) * 0.9) * w * 0.5;
      const px = mbx + Math.cos(a) * r;
      const py = mby + h * 0.15 + Math.abs(Math.sin(a * 1.3 + i)) * h * 0.45;
      g.fillStyle = `rgba(255,255,255,${0.25 + 0.4 * f.highs})`;
      g.fillRect(px, py, h * 0.006, h * 0.004);
    }
    // Lasers fanning from the stage on drops and in star power.
    const laser = clamp(f.drop + f.power * 0.7 + f.energy * 0.15, 0, 1) * f.stage;
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + (i - 3.5) * 0.12 + Math.sin(f.t * 1.3 + i) * 0.1;
      g.strokeStyle = i % 2 ? `rgba(60,255,120,${0.5 * laser})` : `rgba(255,60,200,${0.5 * laser})`;
      g.lineWidth = Math.max(1, h * 0.003);
      g.beginPath();
      g.moveTo(w * 0.5, h * 0.6);
      g.lineTo(w * 0.5 + Math.sin(a) * w, h * 0.6 + Math.cos(a) * w);
      g.stroke();
    }
    g.restore();
    // The ball itself.
    const ball = g.createRadialGradient(mbx - h * 0.01, mby - h * 0.01, 0, mbx, mby, h * 0.045);
    ball.addColorStop(0, '#ffffff');
    ball.addColorStop(0.5, '#a8a8c0');
    ball.addColorStop(1, '#3a3a50');
    g.fillStyle = ball;
    g.beginPath();
    g.arc(mbx, mby, h * 0.045, 0, TAU);
    g.fill();
    const rim = f.power > 0.5 ? 'rgba(140,210,255,0.9)' : 'rgba(56,240,255,0.85)';
    rocker(g, w * 0.17, h * 0.58, h * 0.0011, f, 2, rim, 1.7);
    rocker(g, w * 0.84, h * 0.58, h * 0.0011, f, 9, 'rgba(255,58,180,0.85)', 1.8, true);
    crowd(g, w, h, f, h * 0.93, 2, '#05020a', 'rgba(255,58,180,1)');
  }
}

// ---------------------------------------------------------------------------
// The stadium at night
// ---------------------------------------------------------------------------

class Stadium extends PaintedVenue {
  private flare: HTMLCanvasElement | null = null;
  private warm: HTMLCanvasElement | null = null;
  private cool: HTMLCanvasElement | null = null;
  protected readonly margin = 0.05;

  protected camera(f: VenueFrame): [number, number, number] {
    return [Math.sin(f.t * 0.15) * 0.014, Math.sin(f.t * 0.2) * 0.005, 1 + f.kick * 0.006 + f.power * 0.02];
  }

  protected paintStill(g: CanvasRenderingContext2D, w: number, h: number): void {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, '#02030c');
    sky.addColorStop(1, '#141a3a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + hash(i) * 0.5})`;
      g.fillRect(hash(i + 1) * w, hash(i + 2) * h * 0.3, 1, 1);
    }
    // The stands: tiers curving round, full of people (dots).
    for (let t = 0; t < 4; t++) {
      const y0 = h * (0.22 + t * 0.09);
      g.fillStyle = `rgb(${18 + t * 6},${20 + t * 6},${34 + t * 8})`;
      g.beginPath();
      g.moveTo(0, y0 + h * 0.06);
      g.quadraticCurveTo(w / 2, y0 - h * 0.05, w, y0 + h * 0.06);
      g.lineTo(w, y0 + h * 0.14);
      g.quadraticCurveTo(w / 2, y0 + h * 0.03, 0, y0 + h * 0.14);
      g.closePath();
      g.fill();
      for (let i = 0; i < 500; i++) {
        const px = hash(t * 999 + i) * w;
        const bow = (1 - Math.pow((px / w) * 2 - 1, 2)) * h * 0.1;
        const py = y0 + h * 0.06 - bow * 0.95 + hash(t * 777 + i) * h * 0.07;
        g.fillStyle = `rgba(${150 + hash(i) * 100},${120 + hash(i + 5) * 80},${120 + hash(i + 9) * 100},0.35)`;
        g.fillRect(px, py, Math.max(1, h * 0.002), Math.max(1, h * 0.002));
      }
    }
    // The stage roof: a chrome arch of truss, and video screens either side.
    g.strokeStyle = '#8a8ea8';
    g.lineWidth = Math.max(2, h * 0.008);
    g.beginPath();
    g.moveTo(w * 0.22, h * 0.62);
    g.lineTo(w * 0.24, h * 0.1);
    g.quadraticCurveTo(w / 2, -h * 0.02, w * 0.76, h * 0.1);
    g.lineTo(w * 0.78, h * 0.62);
    g.stroke();
    for (const x of [w * 0.03, w * 0.79]) {
      g.fillStyle = '#1a1c24';
      g.fillRect(x - h * 0.01, h * 0.11, w * 0.18 + h * 0.02, h * 0.26);
      g.fillStyle = '#04050a';
      g.fillRect(x, h * 0.12, w * 0.18, h * 0.24);
    }
    const deck = g.createLinearGradient(0, h * 0.62, 0, h);
    deck.addColorStop(0, '#12141e');
    deck.addColorStop(1, '#030308');
    g.fillStyle = deck;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = 'rgba(160,200,255,0.4)';
    g.fillRect(0, h * 0.62, w, Math.max(1, h * 0.003));
  }

  protected paintLive(g: CanvasRenderingContext2D, w: number, h: number, f: VenueFrame): void {
    this.flare ??= glowSprite('rgba(255,255,255,1)', 64);
    this.warm ??= glowSprite('rgba(255,200,120,1)', 64);
    this.cool ??= glowSprite('rgba(120,190,255,1)', 64);
    // The LED wall behind the band: rings of fire that pump with the kick.
    const lx = w * 0.29;
    const ly = h * 0.13;
    const lw = w * 0.42;
    const lh = h * 0.44;
    g.save();
    g.beginPath();
    g.rect(lx, ly, lw, lh);
    g.clip();
    g.fillStyle = '#06040a';
    g.fillRect(lx, ly, lw, lh);
    const pulse = f.kick * 0.25;
    for (let i = 7; i >= 0; i--) {
      const r = (i / 7 + ((f.beat * 0.25) % (1 / 7))) * lw * 0.62 * (1 + pulse * 0.2);
      g.fillStyle = f.power > 0.5 ? (i % 2 ? '#0a3a8a' : '#3aa8ff') : i % 2 ? '#8a1a0a' : '#ff7a1a';
      g.globalAlpha = 0.35 + 0.4 * (1 - i / 7) + pulse;
      g.beginPath();
      g.arc(lx + lw / 2, ly + lh * 0.55, r, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    for (let y = 0; y < lh; y += Math.max(2, h * 0.006)) g.fillRect(lx, ly + y, lw, Math.max(1, h * 0.002));
    for (let x = 0; x < lw; x += Math.max(2, h * 0.006)) g.fillRect(lx + x, ly, Math.max(1, h * 0.002), lh);
    g.restore();
    g.strokeStyle = '#2a2c38';
    g.lineWidth = Math.max(2, h * 0.006);
    g.strokeRect(lx, ly, lw, lh);
    // The video screens show the music as LED bars.
    for (const x of [w * 0.03, w * 0.79]) {
      const sw = w * 0.18;
      const sh = h * 0.24;
      const n = 16;
      for (let i = 0; i < n; i++) {
        const v = f.bands[Math.min(31, i * 2)] ?? 0;
        const bh = Math.max(0.04, v) * sh * 0.92;
        const grd = g.createLinearGradient(0, h * 0.36, 0, h * 0.36 - sh);
        grd.addColorStop(0, f.power > 0.5 ? '#3aa8ff' : '#ff3a2a');
        grd.addColorStop(0.6, f.power > 0.5 ? '#c8ecff' : '#ffd23a');
        grd.addColorStop(1, '#ffffff');
        g.fillStyle = grd;
        g.fillRect(x + (i * sw) / n + 1, h * 0.36 - bh, sw / n - 2, bh);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = 0; y < sh; y += 3) g.fillRect(x, h * 0.12 + y, sw, 1);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    // Searchlights into the sky.
    for (let i = 0; i < 6; i++) {
      const x = w * (0.26 + i * 0.096);
      const a = Math.PI + Math.sin(f.t * 0.35 + i * 1.3) * 0.45;
      beam(g, x, h * 0.6, a, h * 1.1, 0.04, f.power > 0.5 ? 'rgba(130,200,255,A)' : 'rgba(255,250,230,A)', (0.16 + 0.18 * f.kick) * f.stage);
    }
    // Lamps along the roof arch, chasing on the beat.
    const bi = Math.floor(f.beat * 2);
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const ax = w * 0.24 + (w * 0.52) * t;
      const ay = h * 0.1 - Math.sin(t * Math.PI) * h * 0.055;
      const on = (i + bi) % 4 === 0 || f.power > 0.5;
      const r = h * (on ? 0.05 : 0.025) * (1 + f.kick * 0.3);
      g.globalAlpha = (on ? 0.95 : 0.45) * f.stage;
      g.drawImage(i % 2 ? this.cool! : this.warm!, ax - r, ay - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    // Camera flashes in the stands.
    for (let i = 0; i < 18; i++) {
      const seed = Math.floor(f.t * 6) * 31 + i;
      if (hash(seed) > 0.35) continue;
      const px = hash(seed + 1) * w;
      const py = h * (0.22 + hash(seed + 2) * 0.3);
      const r = h * 0.012;
      g.globalAlpha = 0.8;
      g.drawImage(this.flare, px - r, py - r, r * 2, r * 2);
    }
    // Fireworks on drops and in star power.
    const boom = clamp(f.drop + f.power, 0, 1);
    if (boom > 0.05) {
      for (let k = 0; k < 3; k++) {
        const cycle = f.t * 0.8 + k * 0.33;
        const age = cycle - Math.floor(cycle);
        const seed = Math.floor(cycle) * 7 + k;
        const bx = w * (0.25 + hash(seed) * 0.5);
        const by = h * (0.08 + hash(seed + 1) * 0.15);
        const col = ['rgba(255,80,60,', 'rgba(80,200,255,', 'rgba(255,220,80,'][k];
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * TAU;
          const r = age * h * 0.16;
          g.fillStyle = col + `${(1 - age) * boom})`;
          g.fillRect(bx + Math.cos(a) * r, by + Math.sin(a) * r + age * age * h * 0.05, Math.max(1, h * 0.004), Math.max(1, h * 0.004));
        }
      }
    }
    g.restore();
    const rim = f.power > 0.5 ? 'rgba(140,210,255,0.9)' : 'rgba(255,240,200,0.8)';
    rocker(g, w * 0.3, h * 0.6, h * 0.001, f, 3, rim, 1.1);
    rocker(g, w * 0.7, h * 0.6, h * 0.001, f, 7, rim, 0.9, true);
    crowd(g, w, h, f, h * 0.88, 3, '#020206', 'rgba(255,240,200,1)', true);
  }
}

export function createVenue(kind: string): Venue {
  switch (kind) {
    case 'arena':
      return new Arena();
    case 'neon':
      return new NeonClub();
    case 'stadium':
      return new Stadium();
    default:
      return new Garage();
  }
}
