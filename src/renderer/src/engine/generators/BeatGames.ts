import type { GenContext } from './Generator';
import { CanvasLook, paletteCss } from './CanvasLook';
import { fontCss } from './KineticType';
import { wordHash, wordStream, type StreamWord, type WordStream } from '../wordStream';

/**
 * Beat Toons: flat cartoon scenes in the style of the 2000s handheld rhythm
 * games (a look, not a game). Simple characters do one action on the beat, with a wind-up
 * before it, the payoff exactly on the sung word, overshoot and settle after,
 * squash on contact and stretch on the rise. Everything idles in cycles of a
 * beat, two beats or a bar, so every loop lands on the downbeat.
 *
 *  - punch: a karate kid punches the words, tossed in one beat ahead on pots,
 *    bulbs, rocks and balls; the hero word is a golden barrel.
 *  - choir: three round singers take turns with the words (all three on the
 *    hero word), each word popping up in a bubble.
 *  - fans: an idol sings the line in a speech bubble while the fans clap on
 *    2 and 4 and jump with hearts on the hero word.
 */

const OL = '#1c1b26';
const SKIN = '#ffd9b3';
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeOut = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
const backOut = (x: number): number => {
  const t = clamp01(x) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
};
const h01 = (s: string): number => (wordHash(s) % 10000) / 10000;

/** Mouth shape for the letter being sung. */
function viseme(w: StreamWord | undefined, now: number): 'A' | 'O' | 'E' | 'M' | 'F' | 'L' | 'rest' {
  if (!w || now < w.t || now > w.end + 0.05) return 'rest';
  const letters = [...w.text.toUpperCase()].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 'rest';
  const k = Math.min(letters.length - 1, Math.floor(((now - w.t) / Math.max(0.12, w.end - w.t)) * letters.length));
  const ch = letters[Math.max(0, k)];
  if ('AÁÀÄ'.includes(ch)) return 'A';
  if ('OUÓÚÖÜWQ'.includes(ch)) return 'O';
  if ('EIYÉÍ'.includes(ch)) return 'E';
  if ('MBP'.includes(ch)) return 'M';
  if ('FV'.includes(ch)) return 'F';
  if ('LTDNR'.includes(ch)) return 'L';
  return 'A';
}

interface Toss {
  w: StreamWord | null;
  t: number;
  hero: boolean;
  kind: number;
  key: string;
}

export class BeatGames extends CanvasLook {
  readonly kind = 'beatGames';

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    const game = String(p.game ?? 'punch');
    const s = wordStream(ctx, 1, 2);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (game === 'choir') this.choir(g, W, H, s, ctx);
    else if (game === 'fans') this.fans(g, W, H, s, ctx);
    else this.punch(g, W, H, s, ctx);
    if (p.subtitles !== false && game !== 'fans') this.subtitle(g, W, H, s);
  }

  // ------------------------------------------------------------ shared art

  private ol(H: number): number {
    return Math.max(2, H * 0.0065);
  }

  private shape(g: CanvasRenderingContext2D, fill: string, H: number, stroke = true): void {
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.strokeStyle = OL;
      g.lineWidth = this.ol(H);
      g.stroke();
    }
  }

  private mouth(g: CanvasRenderingContext2D, x: number, y: number, r: number, v: ReturnType<typeof viseme>, H: number): void {
    g.beginPath();
    switch (v) {
      case 'A':
        g.ellipse(x, y, r * 0.55, r * 0.5, 0, 0, Math.PI * 2);
        break;
      case 'O':
        g.ellipse(x, y, r * 0.32, r * 0.42, 0, 0, Math.PI * 2);
        break;
      case 'E':
        g.ellipse(x, y, r * 0.6, r * 0.26, 0, 0, Math.PI * 2);
        break;
      case 'L':
        g.ellipse(x, y, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
        break;
      case 'F':
        g.roundRect(x - r * 0.42, y - r * 0.12, r * 0.84, r * 0.24, r * 0.1);
        break;
      default: {
        // A closed, happy mouth.
        g.moveTo(x - r * 0.4, y - r * 0.05);
        g.quadraticCurveTo(x, y + r * 0.3, x + r * 0.4, y - r * 0.05);
        g.strokeStyle = OL;
        g.lineWidth = this.ol(H);
        g.stroke();
        return;
      }
    }
    this.shape(g, '#7a1f33', H);
    if (v === 'A' || v === 'L' || v === 'O') {
      g.save();
      g.clip();
      g.fillStyle = '#ff7a8f';
      g.beginPath();
      g.ellipse(x, y + r * 0.35, r * 0.4, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private shadow(g: CanvasRenderingContext2D, x: number, y: number, rx: number, k = 1): void {
    g.fillStyle = `rgba(20,16,40,${0.22 * k})`;
    g.beginPath();
    g.ellipse(x, y, rx, rx * 0.22, 0, 0, Math.PI * 2);
    g.fill();
  }

  /** Bold outlined text, the games' lettering. */
  private word(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, fill: string, H: number, alpha = 1): void {
    g.globalAlpha = alpha;
    g.font = fontCss('rounded', px);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(this.ol(H) * 1.6, px * 0.16);
    g.strokeStyle = OL;
    g.strokeText(text, x, y);
    g.fillStyle = fill;
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  }

  /** The line as a clean subtitle bar: sung words dark, the rest faint. */
  private subtitle(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream): void {
    const line = s.current >= 0 ? s.lines[s.current] : null;
    if (!line || !line.words.length) return;
    const px = Math.round(H * 0.045);
    g.font = fontCss('rounded', px);
    const space = px * 0.3;
    const widths = line.words.map((w) => g.measureText(w.text).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (widths.length - 1);
    const k = Math.min(1, (W * 0.84) / total);
    const bw = total * k + px * 1.4;
    const bx = (W - bw) / 2;
    const by = H * 0.885;
    g.fillStyle = 'rgba(255,255,255,0.94)';
    g.beginPath();
    g.roundRect(bx, by, bw, px * 1.5, px * 0.75);
    g.fill();
    g.strokeStyle = OL;
    g.lineWidth = this.ol(H) * 0.8;
    g.stroke();
    g.font = fontCss('rounded', Math.round(px * k));
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    let x = bx + px * 0.7;
    line.words.forEach((w, i) => {
      const sung = s.synced ? s.now >= w.t : true;
      g.fillStyle = sung ? OL : 'rgba(28,27,38,0.28)';
      g.fillText(w.text, x, by + px * 0.76);
      x += (widths[i] + space) * k;
    });
  }

  // ------------------------------------------------------------ Pot Punch

  /** What gets thrown: every sung word, plus blank pots on the beat in the gaps. */
  private tosses(s: WordStream, spb: number): Toss[] {
    const words = s.synced ? s.lines.flatMap((l) => l.words.map((w) => ({ w, hero: w.i === l.hero && w.text.length > 2 }))) : [];
    const out: Toss[] = words.map(({ w, hero }) => ({ w, t: w.t, hero, kind: wordHash(w.text) % 4, key: `${w.line}:${w.i}` }));
    const b0 = Math.floor(s.beatAt(s.now)) - 2;
    for (let b = b0; b < b0 + 6; b++) {
      if (b % 2 !== 0) continue;
      const t = s.now + (b - s.beatAt(s.now)) * spb;
      if (words.some(({ w }) => Math.abs(w.t - t) < spb * 1.6)) continue;
      out.push({ w: null, t, hero: false, kind: ((b % 8) + 8) % 4, key: `b${b}` });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  private punch(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, ctx: GenContext): void {
    const pal = ctx.palette;
    const beat = ctx.frame.beat;
    const ph = beat - Math.floor(beat);
    const spb = 60 / s.bpm;
    const tosses = this.tosses(s, spb);
    const F = H * 0.8;
    const R = H * 0.085;
    const KX = W * 0.26;
    const hitX = KX + R * 4.6;
    const hitY = F - R * 3.9;
    // The last hero hit flashes the sky.
    const lastHero = [...tosses].reverse().find((x) => x.hero && x.t <= s.now);
    const flash = lastHero ? Math.max(0, 1 - (s.now - lastHero.t) / 0.5) : 0;

    // Sky, slow rays turning one notch a bar, the floor.
    const sky = g.createLinearGradient(0, 0, 0, F);
    sky.addColorStop(0, paletteCss(pal, 3, 0.45));
    sky.addColorStop(1, paletteCss(pal, 4, 0.7));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, F);
    g.save();
    g.translate(hitX, hitY);
    g.rotate((beat / 16) * (Math.PI / 6));
    g.fillStyle = flash > 0 ? `rgba(255,255,255,${0.25 + 0.45 * flash})` : 'rgba(255,255,255,0.13)';
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, W * 1.3, (i / 12) * Math.PI * 2, (i / 12) * Math.PI * 2 + Math.PI / 12);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.fillStyle = paletteCss(pal, 1, 0.25);
    g.fillRect(0, F, W, H - F);
    g.fillStyle = OL;
    g.fillRect(0, F - this.ol(H) / 2, W, this.ol(H));

    // The kid's punch: wind-up just before the word, the fist on it, back to guard.
    let arm = 0;
    let side = 1;
    let shout = false;
    for (let i = 0; i < tosses.length; i++) {
      const x = tosses[i];
      const d = s.now - x.t;
      if (d < -0.14 || d > 0.32) continue;
      const wind = d < -0.03 ? -smooth((d + 0.14) / 0.11) * 0.35 : 0;
      const out = d >= -0.03 ? backOut((d + 0.03) / 0.07) * (1 - smooth((d - 0.12) / 0.2)) : 0;
      arm = wind + out;
      side = i % 2 ? 1 : -1;
      shout = d > -0.03 && d < 0.18;
    }
    this.shadow(g, KX, F, R * 1.6);
    this.karateKid(g, KX, F, R, beat, ph, arm, side, shout, hitX, hitY, H);

    // Objects in flight, then shattering with the word bursting out.
    for (let ti = 0; ti < tosses.length; ti++) {
      const x = tosses[ti];
      const d = s.now - x.t;
      // The next punched word clears this one.
      const nextHit = tosses.slice(ti + 1).find((y) => y.w)?.t;
      const cleared = nextHit !== undefined && s.now > nextHit ? 1 - smooth((s.now - nextHit) / 0.1) : 1;
      const size = R * (x.hero ? 1.2 : 1) * (x.w ? Math.min(1.6, Math.max(1, x.w.text.length * 0.15 + 0.35)) : 0.85);
      if (d < -spb || d > 1) continue;
      if (d < 0) {
        // In flight: an arc from off the right edge, spinning, landing on the fist.
        const u = (d + spb) / spb;
        const x0 = W * 1.08;
        const y0 = F - R * 1.2;
        const px = x0 + (hitX - x0) * u;
        const py = y0 + (hitY - y0) * u - Math.sin(Math.PI * u) * H * 0.3;
        this.shadow(g, px, F, size * 0.9, 0.6 + 0.4 * u);
        g.save();
        g.translate(px, py);
        this.object(g, x, size, H, (1 - u) * Math.PI * (h01(x.key) > 0.5 ? 1.5 : -1.5));
        g.restore();
      } else {
        // The hit: a star, the pieces, the word.
        if (d < 0.16) {
          const k = easeOut(d / 0.08);
          g.save();
          g.translate(hitX, hitY);
          g.rotate(h01(x.key) * Math.PI);
          g.globalAlpha = 1 - smooth((d - 0.08) / 0.08);
          g.beginPath();
          for (let i = 0; i < 16; i++) {
            const rr = (i % 2 ? 0.45 : 1) * size * 1.25 * k;
            const a = (i / 16) * Math.PI * 2;
            i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          g.closePath();
          this.shape(g, '#ffffff', H);
          g.restore();
        }
        this.shards(g, x, d, hitX, hitY, size, H);
        if (x.w) {
          const pop = backOut(d / 0.16);
          const fade = (1 - smooth((d - 0.5) / 0.35)) * cleared;
          const px = Math.round(H * (x.hero ? 0.15 : 0.1));
          const alt = x.hero ? -0.1 : x.w.i % 2 ? -0.17 : 0.02;
          g.save();
          g.translate(hitX + W * 0.14 + d * W * 0.2, hitY + H * alt - d * H * 0.1);
          g.scale(pop, pop);
          g.rotate(-0.08 + (h01(x.key + 'r') - 0.5) * 0.12);
          this.word(g, x.w.text, 0, 0, px, x.hero ? '#ffd23f' : '#ffffff', H, fade);
          g.restore();
        }
      }
    }
  }

  private object(g: CanvasRenderingContext2D, x: Toss, r: number, H: number, spin = 0): void {
    g.save();
    g.rotate(spin);
    if (x.hero) {
      // A golden barrel.
      g.beginPath();
      g.ellipse(0, 0, r * 0.95, r * 1.1, 0, 0, Math.PI * 2);
      this.shape(g, '#ffc83a', H);
      g.strokeStyle = OL;
      g.lineWidth = this.ol(H);
      for (const yy of [-0.55, 0.55]) {
        g.beginPath();
        g.moveTo(-r * 0.82, yy * r);
        g.quadraticCurveTo(0, yy * r + r * 0.12, r * 0.82, yy * r);
        g.stroke();
      }
    } else if (x.kind === 0) {
      // A clay pot.
      g.beginPath();
      g.moveTo(-r * 0.55, -r * 0.75);
      g.bezierCurveTo(-r * 1.25, -r * 0.2, -r * 0.9, r * 0.95, 0, r * 0.95);
      g.bezierCurveTo(r * 0.9, r * 0.95, r * 1.25, -r * 0.2, r * 0.55, -r * 0.75);
      g.closePath();
      this.shape(g, '#e08a4f', H);
      g.beginPath();
      g.ellipse(0, -r * 0.78, r * 0.62, r * 0.18, 0, 0, Math.PI * 2);
      this.shape(g, '#b8602f', H);
    } else if (x.kind === 1) {
      // A light bulb.
      g.beginPath();
      g.arc(0, -r * 0.15, r * 0.8, 0, Math.PI * 2);
      this.shape(g, '#fff3a3', H);
      g.beginPath();
      g.rect(-r * 0.35, r * 0.55, r * 0.7, r * 0.45);
      this.shape(g, '#b9bec8', H);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.ellipse(-r * 0.32, -r * 0.45, r * 0.16, r * 0.26, -0.5, 0, Math.PI * 2);
      g.fill();
    } else if (x.kind === 2) {
      // A rock.
      g.beginPath();
      const pts = 9;
      for (let i = 0; i < pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const rr = r * (0.82 + h01(x.key + i) * 0.22);
        i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.85) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.85);
      }
      g.closePath();
      this.shape(g, '#a3a8b4', H);
    } else {
      // A ball with a stripe.
      g.beginPath();
      g.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      this.shape(g, '#ef5a52', H);
      g.save();
      g.clip();
      g.fillStyle = '#ffffff';
      g.fillRect(-r, -r * 0.16, r * 2, r * 0.32);
      g.restore();
      g.beginPath();
      g.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      g.strokeStyle = OL;
      g.lineWidth = this.ol(H);
      g.stroke();
    }
    g.restore();
    if (x.w) {
      // The word rides on the object, kept upright while it spins.
      g.font = fontCss('rounded', 100);
      const k = Math.min((r * 1.5) / Math.max(1, g.measureText(x.w.text).width), (r * 0.62) / 100);
      g.fillStyle = OL;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = fontCss('rounded', Math.round(100 * k));
      g.fillText(x.w.text, 0, x.kind === 1 && !x.hero ? -r * 0.15 : r * 0.05);
    }
  }

  private shards(g: CanvasRenderingContext2D, x: Toss, d: number, cx: number, cy: number, r: number, H: number): void {
    if (d > 0.5) return;
    const color = x.hero ? '#ffc83a' : ['#e08a4f', '#fff3a3', '#a3a8b4', '#ef5a52'][x.kind];
    const n = x.hero ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const a = -1.2 + (i / (n - 1)) * 2.0 + (h01(x.key + 'a' + i) - 0.5) * 0.4;
      const v = H * (0.45 + h01(x.key + 'v' + i) * 0.35);
      const px = cx + Math.cos(a) * v * d;
      const py = cy + Math.sin(a) * v * d + 0.5 * H * 2.6 * d * d;
      g.save();
      g.globalAlpha = 1 - smooth((d - 0.25) / 0.25);
      g.translate(px, py);
      g.rotate(d * 9 * (i % 2 ? 1 : -1));
      g.beginPath();
      g.moveTo(-r * 0.3, -r * 0.2);
      g.lineTo(r * 0.28, -r * 0.26);
      g.lineTo(r * 0.12, r * 0.24);
      g.closePath();
      this.shape(g, color, H);
      g.restore();
    }
  }

  private karateKid(g: CanvasRenderingContext2D, x: number, floor: number, R: number, beat: number, ph: number, arm: number, side: number, shout: boolean, hx: number, hy: number, H: number): void {
    // Bob on every beat: squash as it lands, stretch on the way up.
    const hop = Math.sin(Math.PI * ph);
    const squash = Math.exp(-ph * 10) * 0.1;
    const lean = Math.max(0, arm) * R * 0.5;
    const sx = 1 + squash;
    const sy = 1 - squash + hop * 0.03;
    const hipY = floor - R * 1.6;
    g.save();
    g.translate(x, floor);
    g.scale(sx, sy);
    g.translate(-x, -floor);
    // Legs in a wide stance.
    g.strokeStyle = OL;
    g.lineWidth = R * 0.42;
    g.beginPath();
    g.moveTo(x - R * 0.45, hipY);
    g.lineTo(x - R * 1.05, floor - R * 0.12);
    g.moveTo(x + R * 0.45, hipY);
    g.lineTo(x + R * 0.95, floor - R * 0.12);
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = R * 0.42 - this.ol(H) * 2;
    g.stroke();
    // Feet.
    for (const fx of [-1.15, 1.05]) {
      g.beginPath();
      g.ellipse(x + fx * R, floor - R * 0.1, R * 0.32, R * 0.14, 0, 0, Math.PI * 2);
      this.shape(g, SKIN, H);
    }
    // Body: the gi with its lapels and black belt.
    const by = hipY - R * 1.9 + hop * -R * 0.04;
    g.beginPath();
    g.moveTo(x - R * 0.85 + lean * 0.3, by);
    g.lineTo(x + R * 0.85 + lean * 0.3, by);
    g.lineTo(x + R * 0.78, hipY + R * 0.15);
    g.lineTo(x - R * 0.78, hipY + R * 0.15);
    g.closePath();
    this.shape(g, '#ffffff', H);
    g.strokeStyle = OL;
    g.lineWidth = this.ol(H);
    g.beginPath();
    g.moveTo(x - R * 0.35 + lean * 0.3, by);
    g.lineTo(x + R * 0.1 + lean * 0.2, by + R * 0.9);
    g.lineTo(x + R * 0.35 + lean * 0.3, by);
    g.stroke();
    g.beginPath();
    g.rect(x - R * 0.82, hipY - R * 0.35, R * 1.64, R * 0.32);
    this.shape(g, '#232331', H);
    // Arms: the guard, or a straight punch toward the object.
    const shoulderY = by + R * 0.35;
    const reach = Math.max(0, arm);
    for (const sd of [-1, 1]) {
      const punching = sd === side && arm !== 0;
      const sxp = x + sd * R * 0.7 + lean * 0.3;
      let fx: number;
      let fy: number;
      if (punching && arm > 0) {
        fx = sxp + (hx - R * 0.8 - sxp) * reach;
        fy = shoulderY + (hy - shoulderY) * reach;
      } else {
        const back = punching ? -arm : 0;
        fx = x + sd * R * 0.35 + R * 0.55 - back * R * 0.8;
        fy = shoulderY + R * 0.15 + Math.sin(Math.PI * ph) * R * 0.05;
      }
      g.strokeStyle = OL;
      g.lineWidth = R * 0.36;
      g.beginPath();
      g.moveTo(sxp, shoulderY);
      g.quadraticCurveTo((sxp + fx) / 2, Math.max(shoulderY, fy) + R * 0.35 * (1 - reach), fx, fy);
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = R * 0.36 - this.ol(H) * 2;
      g.stroke();
      g.beginPath();
      g.arc(fx, fy, R * 0.3 * (punching && arm > 0.5 ? 1.15 : 1), 0, Math.PI * 2);
      this.shape(g, SKIN, H);
    }
    // Head with a headband, its tails trailing the bob.
    const hy0 = by - R * 0.95;
    const hx0 = x + lean * 0.6;
    const tail = Math.sin((beat - 0.15) * Math.PI * 2) * 0.35;
    g.strokeStyle = OL;
    g.lineWidth = R * 0.2;
    for (const k of [0, 1]) {
      g.beginPath();
      g.moveTo(hx0 - R * 0.85, hy0 - R * 0.35);
      g.quadraticCurveTo(hx0 - R * 1.4, hy0 - R * 0.5 + tail * R, hx0 - R * 1.75, hy0 - R * (0.1 - k * 0.5) + tail * R * 1.4);
      g.stroke();
    }
    g.strokeStyle = '#e8433f';
    g.lineWidth = R * 0.2 - this.ol(H) * 2;
    for (const k of [0, 1]) {
      g.beginPath();
      g.moveTo(hx0 - R * 0.85, hy0 - R * 0.35);
      g.quadraticCurveTo(hx0 - R * 1.4, hy0 - R * 0.5 + tail * R, hx0 - R * 1.75, hy0 - R * (0.1 - k * 0.5) + tail * R * 1.4);
      g.stroke();
    }
    g.beginPath();
    g.arc(hx0, hy0, R, 0, Math.PI * 2);
    this.shape(g, SKIN, H);
    g.beginPath();
    g.moveTo(hx0 - R * 0.98, hy0 - R * 0.42);
    g.quadraticCurveTo(hx0, hy0 - R * 0.62, hx0 + R * 0.98, hy0 - R * 0.42);
    g.lineTo(hx0 + R * 0.92, hy0 - R * 0.12);
    g.quadraticCurveTo(hx0, hy0 - R * 0.32, hx0 - R * 0.92, hy0 - R * 0.12);
    g.closePath();
    this.shape(g, '#e8433f', H);
    // Hair tuft.
    g.beginPath();
    g.moveTo(hx0 - R * 0.6, hy0 - R * 0.6);
    g.quadraticCurveTo(hx0 - R * 0.2, hy0 - R * 1.35, hx0 + R * 0.15, hy0 - R * 0.75);
    g.quadraticCurveTo(hx0 + R * 0.45, hy0 - R * 1.25, hx0 + R * 0.7, hy0 - R * 0.62);
    this.shape(g, '#2a2233', H);
    // Eyes: determined slits, wide on the punch.
    g.fillStyle = OL;
    for (const ex of [0.05, 0.5]) {
      g.beginPath();
      if (shout) g.ellipse(hx0 + ex * R, hy0 + R * 0.08, R * 0.09, R * 0.15, 0, 0, Math.PI * 2);
      else g.ellipse(hx0 + ex * R, hy0 + R * 0.1, R * 0.12, R * 0.06, 0, 0, Math.PI * 2);
      g.fill();
    }
    this.mouth(g, hx0 + R * 0.32, hy0 + R * 0.5, R * 0.36, shout ? 'A' : 'rest', H);
    g.restore();
  }

  // ------------------------------------------------------------ Choir

  private choir(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, ctx: GenContext): void {
    const pal = ctx.palette;
    const beat = ctx.frame.beat;
    const ph = beat - Math.floor(beat);
    // Diagonal stripes sliding one stripe a bar: the loop meets itself on the downbeat.
    g.fillStyle = paletteCss(pal, 3, 0.5);
    g.fillRect(0, 0, W, H);
    const period = H * 0.16;
    const off = ((beat / 4) % 1) * period;
    g.fillStyle = paletteCss(pal, 3, 0.62);
    for (let x = -H - period + off; x < W + H; x += period) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + period * 0.5, 0);
      g.lineTo(x + period * 0.5 - H, H);
      g.lineTo(x - H, H);
      g.closePath();
      g.fill();
    }
    const F = H * 0.82;
    const R = H * 0.125;
    const xs = [W * 0.25, W * 0.5, W * 0.75];
    const rise = [R * 0.35, R * 0.8, R * 0.35];
    // Risers.
    xs.forEach((x, i) => {
      g.beginPath();
      g.rect(x - R * 1.6, F - rise[i], R * 3.2, rise[i] + H);
      this.shape(g, paletteCss(pal, 1, 0.35 + i * 0.05), H);
    });
    const words = s.synced ? s.lines.flatMap((l) => l.words.map((w) => ({ w, hero: w.i === l.hero && w.text.length > 2 }))) : [];
    const singing = (i: number): StreamWord | undefined => {
      const cur = [...words].reverse().find(({ w }) => w.t <= s.now && s.now <= w.end + 0.05);
      if (!cur) return undefined;
      return cur.hero || cur.w.i % 3 === i ? cur.w : undefined;
    };
    const colors = ['#ff8fb1', '#8fd3ff', '#ffd36b'];
    xs.forEach((x, i) => {
      const w = singing(i);
      const base = F - rise[i];
      const hop = Math.sin(Math.PI * ph);
      const squash = Math.exp(-ph * 10) * 0.09;
      const sing = w ? smooth((s.now - w.t) / 0.08) * (1 - smooth((s.now - w.end) / 0.1)) : 0;
      this.shadow(g, x, base, R * 1.1);
      g.save();
      g.translate(x, base);
      g.scale(1 + squash - sing * 0.04, 1 - squash + hop * 0.03 + sing * 0.08);
      // Body: an egg with a collar and bow tie.
      g.beginPath();
      g.ellipse(0, -R * 1.25, R * 1.0, R * 1.25, 0, 0, Math.PI * 2);
      this.shape(g, colors[i], H);
      g.beginPath();
      g.moveTo(-R * 0.22, -R * 0.55);
      g.lineTo(R * 0.22, -R * 0.35);
      g.lineTo(R * 0.22, -R * 0.55);
      g.lineTo(-R * 0.22, -R * 0.35);
      g.closePath();
      this.shape(g, '#e8433f', H);
      // Face.
      const blink = (beat + i * 0.37) % 4 > 3.9;
      g.fillStyle = OL;
      for (const ex of [-0.35, 0.35]) {
        g.beginPath();
        if (blink || (w && w.text.length > 2 && sing > 0.5 && i === 1 && singing(0) === w)) g.ellipse(ex * R, -R * 1.62, R * 0.12, R * 0.03, 0, 0, Math.PI * 2);
        else g.ellipse(ex * R, -R * 1.62, R * 0.1, R * 0.14, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(255,90,120,0.35)';
      for (const ex of [-0.62, 0.62]) {
        g.beginPath();
        g.ellipse(ex * R, -R * 1.35, R * 0.16, R * 0.09, 0, 0, Math.PI * 2);
        g.fill();
      }
      this.mouth(g, 0, -R * 1.12, R * 0.42 * (1 + sing * 0.25), viseme(w, s.now), H);
      g.restore();
    });
    // Each sung word pops up in a bubble over its singer and floats away.
    const px = Math.round(H * 0.062);
    for (const { w, hero } of words) {
      const d = s.now - w.t;
      if (d < 0 || d > 1.1) continue;
      const i = hero ? 1 : w.i % 3;
      const x = xs[i] + (hero ? 0 : (h01(`${w.line}:${w.i}`) - 0.5) * R * 0.6);
      const y = F - rise[i] - R * (hero ? 4.2 : 3.0) - d * H * 0.22;
      const pop = backOut(d / 0.2);
      const fade = 1 - smooth((d - 0.6) / 0.5);
      const size = Math.round(px * (hero ? 1.45 : 1));
      g.font = fontCss('rounded', size);
      const tw = g.measureText(w.text).width;
      g.save();
      g.globalAlpha = fade;
      g.translate(x, y);
      g.scale(pop, pop);
      g.beginPath();
      g.roundRect(-tw / 2 - size * 0.45, -size * 0.75, tw + size * 0.9, size * 1.5, size * 0.6);
      g.moveTo(-size * 0.2, size * 0.7);
      g.lineTo(0, size * 1.15);
      g.lineTo(size * 0.25, size * 0.7);
      this.shape(g, hero ? '#fff1a8' : '#ffffff', H);
      g.fillStyle = OL;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(w.text, 0, size * 0.04);
      g.restore();
    }
  }

  // ------------------------------------------------------------ Fan Club

  private fans(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, ctx: GenContext): void {
    const pal = ctx.palette;
    const beat = ctx.frame.beat;
    const ph = beat - Math.floor(beat);
    const words = s.synced ? s.lines.flatMap((l) => l.words.map((w) => ({ w, hero: w.i === l.hero && w.text.length > 2 }))) : [];
    const heroHit = [...words].reverse().find((x) => x.hero && x.w.t <= s.now);
    const jump = heroHit ? Math.max(0, 1 - (s.now - heroHit.w.t) / 0.55) : 0;
    // The hall: a dark back wall, a spotlight, the stage.
    const wall = g.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, paletteCss(pal, 0, -0.2));
    wall.addColorStop(1, paletteCss(pal, 1, -0.1));
    g.fillStyle = wall;
    g.fillRect(0, 0, W, H);
    const stageY = H * 0.6;
    const ix = W * 0.5 + Math.sin(beat * Math.PI) * H * 0.02;
    const cone = g.createLinearGradient(0, 0, 0, stageY);
    cone.addColorStop(0, 'rgba(255,250,220,0.05)');
    cone.addColorStop(1, 'rgba(255,250,220,0.35)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(ix - W * 0.04, 0);
    g.lineTo(ix + W * 0.04, 0);
    g.lineTo(ix + W * 0.16, stageY);
    g.lineTo(ix - W * 0.16, stageY);
    g.closePath();
    g.fill();
    g.beginPath();
    g.rect(-10, stageY, W + 20, H * 0.08);
    this.shape(g, paletteCss(pal, 2, 0.1), H);
    g.fillStyle = 'rgba(255,250,220,0.35)';
    g.beginPath();
    g.ellipse(ix, stageY + H * 0.01, W * 0.15, H * 0.025, 0, 0, Math.PI * 2);
    g.fill();
    // The idol, swaying over two beats, pigtails swinging behind the sway.
    const cur = [...words].reverse().find(({ w }) => w.t <= s.now && s.now <= w.end + 0.05)?.w;
    this.idol(g, ix, stageY, H * 0.09, beat, cur, s.now, pal, H);
    // The speech bubble: the line, filling in word by word.
    const line = s.current >= 0 ? s.lines[s.current] : null;
    if (line?.words.length) this.bubble(g, W, H, s, line.words, ix + H * 0.03, stageY - H * 0.33);
    // The fans, from behind: clapping on 2 and 4, jumping with hearts on the hero word.
    const n = 6;
    for (let k = 0; k < n; k++) {
      const fx = W * (0.08 + (k / (n - 1)) * 0.84);
      const fy = H * 0.99 - jump * H * 0.07 * Math.sin(Math.PI * clamp01(1 - jump));
      this.fan(g, fx, fy, H * 0.09, beat, ph, jump, H, k);
    }
    if (heroHit && jump > 0) {
      for (let k = 0; k < 8; k++) {
        const d = s.now - heroHit.w.t;
        const hx = W * (0.1 + h01(`h${k}${heroHit.w.line}`) * 0.8);
        const hy = H * 0.86 - d * H * 0.5 - h01(`hy${k}`) * H * 0.1;
        this.heart(g, hx, hy, H * 0.03 * backOut(d / 0.2), jump, H);
      }
    }
  }

  private idol(g: CanvasRenderingContext2D, x: number, floor: number, R: number, beat: number, word: StreamWord | undefined, now: number, pal: Float32Array, H: number): void {
    const sway = Math.sin(beat * Math.PI) * 0.08;
    const ph = beat - Math.floor(beat);
    const squash = Math.exp(-ph * 10) * 0.06;
    g.save();
    g.translate(x, floor);
    g.rotate(sway);
    g.scale(1 + squash, 1 - squash);
    // Legs and a flared dress.
    g.strokeStyle = OL;
    g.lineWidth = R * 0.32;
    g.beginPath();
    g.moveTo(-R * 0.3, -R * 1.2);
    g.lineTo(-R * 0.35, 0);
    g.moveTo(R * 0.3, -R * 1.2);
    g.lineTo(R * 0.35, 0);
    g.stroke();
    g.strokeStyle = SKIN;
    g.lineWidth = R * 0.32 - this.ol(H) * 2;
    g.stroke();
    g.beginPath();
    g.moveTo(-R * 0.55, -R * 3.0);
    g.lineTo(R * 0.55, -R * 3.0);
    g.lineTo(R * 1.15, -R * 1.15);
    g.quadraticCurveTo(0, -R * 0.9, -R * 1.15, -R * 1.15);
    g.closePath();
    this.shape(g, paletteCss(pal, 3, 0.1), H);
    // The arm holding the microphone up, the other waving on the beat.
    const wave = Math.sin(beat * Math.PI * 2) * 0.4;
    g.strokeStyle = OL;
    g.lineWidth = R * 0.28;
    g.beginPath();
    g.moveTo(R * 0.45, -R * 2.8);
    g.quadraticCurveTo(R * 0.9, -R * 2.6, R * 0.55, -R * 3.45);
    g.moveTo(-R * 0.45, -R * 2.8);
    g.lineTo(-R * 1.2, -R * 3.3 - wave * R);
    g.stroke();
    g.strokeStyle = SKIN;
    g.lineWidth = R * 0.28 - this.ol(H) * 2;
    g.stroke();
    // Microphone.
    g.beginPath();
    g.roundRect(R * 0.45, -R * 3.75, R * 0.2, R * 0.45, R * 0.06);
    this.shape(g, '#2a2a36', H);
    g.beginPath();
    g.arc(R * 0.55, -R * 3.8, R * 0.18, 0, Math.PI * 2);
    this.shape(g, '#c9ced8', H);
    // Pigtails trail the sway (they lag a quarter beat).
    const lag = Math.sin((beat - 0.25) * Math.PI) * 0.5;
    for (const sd of [-1, 1]) {
      g.save();
      g.translate(sd * R * 0.85, -R * 4.25);
      g.rotate(sd * 0.5 - lag);
      g.beginPath();
      g.ellipse(sd * R * 0.35, R * 0.55, R * 0.32, R * 0.6, sd * 0.2, 0, Math.PI * 2);
      this.shape(g, '#3a2a55', H);
      g.restore();
    }
    // Head and hair.
    g.beginPath();
    g.arc(0, -R * 4.0, R, 0, Math.PI * 2);
    this.shape(g, SKIN, H);
    g.beginPath();
    g.arc(0, -R * 4.15, R * 1.02, Math.PI * 1.05, Math.PI * 1.95);
    g.quadraticCurveTo(R * 0.3, -R * 4.55, -R * 0.98, -R * 4.3);
    this.shape(g, '#3a2a55', H);
    g.fillStyle = OL;
    for (const ex of [-0.35, 0.35]) {
      g.beginPath();
      g.ellipse(ex * R, -R * 4.0, R * 0.1, R * 0.16, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,90,120,0.4)';
    for (const ex of [-0.6, 0.6]) {
      g.beginPath();
      g.ellipse(ex * R, -R * 3.72, R * 0.16, R * 0.08, 0, 0, Math.PI * 2);
      g.fill();
    }
    this.mouth(g, 0, -R * 3.55, R * 0.32, viseme(word, now), H);
    g.restore();
  }

  private bubble(g: CanvasRenderingContext2D, W: number, H: number, s: WordStream, words: StreamWord[], ix: number, iy: number): void {
    const px = Math.round(H * 0.055);
    g.font = fontCss('rounded', px);
    const space = px * 0.3;
    // Beside the head, to the right, never over it.
    const left = ix + H * 0.1;
    const maxW = W * 0.97 - left - px * 1.2;
    const rows: Array<Array<{ w: StreamWord; x: number; width: number }>> = [[]];
    let x = 0;
    for (const w of words) {
      const ww = g.measureText(w.text).width;
      if (x > 0 && x + ww > maxW) {
        rows.push([]);
        x = 0;
      }
      rows[rows.length - 1].push({ w, x, width: ww });
      x += ww + space;
    }
    const lh = px * 1.25;
    const bw = Math.max(...rows.map((r) => (r.length ? r[r.length - 1].x + r[r.length - 1].width : 0))) + px * 1.2;
    const bh = rows.length * lh + px * 0.7;
    const bx = left;
    const by = Math.max(H * 0.03, iy - bh * 0.85);
    g.beginPath();
    g.roundRect(bx, by, bw, bh, px * 0.6);
    g.moveTo(bx + 1, by + bh * 0.55);
    g.lineTo(ix + H * 0.02, iy + H * 0.02);
    g.lineTo(bx + 1, by + bh * 0.8);
    this.shape(g, '#ffffff', H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    rows.forEach((row, r) => {
      for (const { w, x: wx } of row) {
        const d = s.now - w.t;
        const k = d >= 0 ? backOut(d / 0.18) : 1;
        g.save();
        g.translate(bx + px * 0.6 + wx, by + px * 0.35 + lh * (r + 0.5));
        g.scale(1, d >= 0 && d < 0.18 ? k : 1);
        g.fillStyle = d >= 0 ? OL : 'rgba(28,27,38,0.22)';
        g.font = fontCss('rounded', px);
        g.fillText(w.text, 0, 0);
        g.restore();
      }
    });
  }

  private fan(g: CanvasRenderingContext2D, x: number, y: number, R: number, beat: number, ph: number, jump: number, H: number, k: number): void {
    // Claps land on beats 2 and 4 (the odd beats counting from 0).
    const b = Math.floor(beat);
    const toClap = b % 2 === 1 ? ph : ph - 1;
    const near = Math.min(Math.abs(toClap), Math.abs(toClap + 2));
    const apart = jump > 0.2 ? 1 : smooth(near / 0.45);
    const bob = Math.sin(Math.PI * ph) * R * 0.08;
    g.save();
    g.translate(x, y - bob);
    // Arms up, hands meeting on the clap (or thrown up for the hero word).
    const handY = -R * 2.55 - jump * R * 0.4;
    const spread = R * (0.12 + 0.55 * apart) + jump * R * 0.5;
    g.strokeStyle = OL;
    g.lineWidth = R * 0.34;
    g.beginPath();
    g.moveTo(-R * 0.75, -R * 1.2);
    g.quadraticCurveTo(-R * 0.95, -R * 2.0, -spread, handY);
    g.moveTo(R * 0.75, -R * 1.2);
    g.quadraticCurveTo(R * 0.95, -R * 2.0, spread, handY);
    g.stroke();
    g.strokeStyle = '#8a5a3c';
    g.lineWidth = R * 0.34 - this.ol(H) * 2;
    g.stroke();
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.ellipse(sd * spread, handY, R * 0.24, R * 0.3, 0, 0, Math.PI * 2);
      this.shape(g, '#e7b48f', H);
    }
    // Clap lines right after the hands meet.
    if (jump < 0.2 && near < 0.12 && toClap >= 0) {
      g.strokeStyle = OL;
      g.lineWidth = this.ol(H);
      for (const a of [-0.9, -1.57, -2.24]) {
        g.beginPath();
        g.moveTo(Math.cos(a) * R * 0.55, handY + Math.sin(a) * R * 0.55);
        g.lineTo(Math.cos(a) * R * 0.95, handY + Math.sin(a) * R * 0.95);
        g.stroke();
      }
    }
    // The back of a round furry head with ears.
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.arc(sd * R * 0.95, -R * 1.25, R * 0.36, 0, Math.PI * 2);
      this.shape(g, '#8a5a3c', H);
    }
    g.beginPath();
    g.arc(0, -R * 0.95, R * 1.05, 0, Math.PI * 2);
    this.shape(g, k % 2 ? '#8a5a3c' : '#7a4e34', H);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.ellipse(-R * 0.35, -R * 1.35, R * 0.35, R * 0.22, -0.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private heart(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, H: number): void {
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.beginPath();
    g.moveTo(0, r * 0.9);
    g.bezierCurveTo(-r * 1.6, -r * 0.2, -r * 0.7, -r * 1.4, 0, -r * 0.5);
    g.bezierCurveTo(r * 0.7, -r * 1.4, r * 1.6, -r * 0.2, 0, r * 0.9);
    g.closePath();
    this.shape(g, '#ff5a8a', H);
    g.restore();
  }
}
