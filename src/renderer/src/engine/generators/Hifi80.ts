import type { GenContext } from './Generator';
import { CanvasLook } from './CanvasLook';
import { num } from './ShaderGenerator';
import { liveText, type TextSource } from '../lyricsFeed';
import { drawSegText, marquee, meshPattern, phosphor, segTextWidth } from './vfd';

/** A palette stop (linear) as a CSS colour, brought up to `min` brightness (a lit segment is light). */
function lightCss(pal: Float32Array, i: number, min: number, alpha = 1, scale = 1): string {
  const o = i * 3;
  const m = Math.max(pal[o], pal[o + 1], pal[o + 2], 1e-4);
  const k = (m < min ? min / m : 1) * scale;
  const ch = (v: number): number => {
    const x = Math.min(1, v * k);
    return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
  };
  return `rgba(${ch(pal[o])},${ch(pal[o + 1])},${ch(pal[o + 2])},${alpha})`;
}

/**
 * The glowing display of an 80s stereo spectrum analyzer, filling the
 * screen: columns of vacuum-fluorescent segments with amber and red tops,
 * peak hold, the unlit segments faintly visible through the glass, the fine
 * wire mesh and filaments in front, and the song scrolling in 14-segment
 * letters along the top. Mirror grows the columns up and down from the middle.
 */

const FREQS_10 = ['32', '63', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];

export class Hifi80 extends CanvasLook {
  readonly kind = 'hifi80';
  private mesh: CanvasPattern | null = null;
  private meshKey = '';
  private readonly levels = new Float32Array(48);
  private readonly peaks = new Float32Array(48);
  private readonly peakAt = new Float32Array(48);

  protected resized(): void {
    this.mesh = null;
    this.meshKey = '';
  }

  /** Band levels with a fast attack, a VFD-like fall and peak hold. */
  private analyse(ctx: GenContext, n: number): void {
    const b = ctx.frame.bands32;
    const gain = num(ctx.params.gain, 1.1);
    const hold = num(ctx.params.peakHold, 0.6);
    const t = ctx.time;
    for (let i = 0; i < n; i++) {
      // Each column averages its share of the 32-band EQ.
      const a = Math.floor((i / n) * 30);
      const z = Math.max(a + 1, Math.floor(((i + 1) / n) * 30));
      let s = 0;
      for (let k = a; k < z; k++) s += b[k] ?? 0;
      const tilt = 1 + (i / n) * 0.35;
      const v = Math.min(1, Math.pow((s / (z - a)) * gain * tilt, 1.15));
      this.levels[i] = Math.max(v, this.levels[i] - ctx.dt * 1.7);
      if (this.levels[i] >= this.peaks[i]) {
        this.peaks[i] = this.levels[i];
        this.peakAt[i] = t;
      } else if (t - this.peakAt[i] > hold) this.peaks[i] = Math.max(this.levels[i], this.peaks[i] - ctx.dt * 0.8);
    }
  }

  /** What the display spells: the lyric or song, your text, or the tempo. */
  private words(ctx: GenContext, fallback: string): string {
    const p = ctx.params;
    const live = liveText(String(p.source ?? 'title') as TextSource, Date.now());
    if (live.kind === 'text') return String(p.text ?? '') || fallback;
    if (live.kind === 'title') return live.lines.join(' - ') || fallback;
    return live.lines[live.current] || fallback;
  }

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    // The look's palette (stop 2 lights the segments, 3 and 4 the amber and red tops), or a fixed phosphor.
    const usePal = (p.phosphor ?? 'palette') === 'palette';
    const pal = ctx.palette;
    const ph = usePal ? { lit: lightCss(pal, 2, 0.75), glow: lightCss(pal, 2, 0.6), ghost: lightCss(pal, 2, 0.6, 0.075) } : phosphor(p.phosphor);
    const mid = usePal ? { lit: lightCss(pal, 3, 0.75), glow: lightCss(pal, 3, 0.6) } : { lit: '#ffc46b', glow: '#ff9a1f' };
    const top = usePal ? { lit: lightCss(pal, 4, 0.75), glow: lightCss(pal, 4, 0.6) } : { lit: '#ff7a6a', glow: '#ff2a1a' };
    const n = Math.round(num(p.bands, 20));
    const S = Math.round(num(p.segments, 16));
    const zones = p.zones !== false;
    const mirror = p.mirror === true;
    this.analyse(ctx, n);
    // The glass stays dark whatever the palette's darkest colour.
    g.fillStyle = usePal ? lightCss(pal, 0, 0, 1, 0.35) : '#030405';
    g.fillRect(0, 0, W, H);
    const u = Math.min(W / 16, H / 9);
    const pad = u * 0.6;

    // The song along the top in 14-segment letters, a few indicators beside it.
    const textH = H * 0.09;
    const showText = p.header !== false;
    let y0 = pad;
    if (showText) {
      const cells = Math.max(8, Math.floor((W * 0.62) / segTextWidth(1, textH)));
      const text = marquee(this.words(ctx, `${Math.round(ctx.frame.bpm || 120)} BPM  STEREO`), cells, ctx.beat * num(p.scroll, 2));
      drawSegText(g, text, pad, y0, textH, { lit: ph.lit, ghost: ph.ghost, glow: ph.glow });
      g.font = `700 ${Math.round(textH * 0.32)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      const ind = (label: string, on: boolean, y: number, color = ph.lit): void => {
        g.fillStyle = on ? color : ph.ghost;
        g.shadowColor = color;
        g.shadowBlur = on ? textH * 0.3 : 0;
        g.fillText(label, W - pad, y);
        g.shadowBlur = 0;
      };
      ind('STEREO', true, y0 + textH * 0.2);
      ind('PEAK HOLD', num(p.peakHold, 0.6) > 0, y0 + textH * 0.6);
      ind('OVER', ctx.env.kick > 0.6 && ctx.env.energy > 0.55, y0 + textH * 1.0, top.lit);
      y0 += textH * 1.6;
    }

    // The analyzer.
    const labels = p.labels !== false;
    const ax = pad + (labels ? u * 0.5 : 0), ay = y0;
    const aw = W - ax - pad, ah = H - ay - pad - (labels ? u * 0.4 : 0);
    const colW = aw / n;
    const segH = (mirror ? ah / 2 : ah) / S;
    const lit = new Path2D(), amber = new Path2D(), red = new Path2D(), ghost = new Path2D();
    const base = mirror ? ay + ah / 2 : ay + ah;
    for (let i = 0; i < n; i++) {
      const lv = Math.round(this.levels[i] * S);
      const pk = Math.min(S - 1, Math.round(this.peaks[i] * S) - 1);
      const x = ax + i * colW + colW * 0.12;
      const w = colW * 0.76;
      for (let s = 0; s < S; s++) {
        const on = s < lv || (s === pk && pk > 0);
        const target = !on ? ghost : !zones ? lit : s >= S - Math.max(1, Math.round(S * 0.12)) ? red : s >= S - Math.round(S * 0.3) ? amber : lit;
        target.rect(x, base - (s + 1) * segH + segH * 0.2, w, segH * 0.62);
        if (mirror) target.rect(x, base + s * segH + segH * 0.18, w, segH * 0.62);
      }
    }
    g.fillStyle = ph.ghost;
    g.fill(ghost);
    g.save();
    g.shadowBlur = segH * 0.9;
    g.shadowColor = ph.glow;
    g.fillStyle = ph.lit;
    g.fill(lit);
    g.shadowColor = mid.glow;
    g.fillStyle = mid.lit;
    g.fill(amber);
    g.shadowColor = top.glow;
    g.fillStyle = top.lit;
    g.fill(red);
    g.restore();
    if (labels) {
      // dB scale and frequencies, printed on the glass.
      g.font = `600 ${Math.round(u * 0.22)}px "Helvetica Neue", Arial, sans-serif`;
      g.fillStyle = ph.lit;
      g.globalAlpha = 0.5;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      if (!mirror) for (const [db, f] of [['0', 1], ['-6', 0.7], ['-12', 0.45], ['-24', 0.2]] as Array<[string, number]>) g.fillText(db, ax - u * 0.12, ay + ah - f * ah + segH * 0.5);
      g.textAlign = 'center';
      for (let k = 0; k < FREQS_10.length; k++) {
        const i = Math.round(((k + 0.5) / FREQS_10.length) * n - 0.5);
        g.fillText(FREQS_10[k], ax + (i + 0.5) * colW, ay + ah + u * 0.25);
      }
      g.globalAlpha = 1;
    }
    // The wire mesh and filaments in front of everything lit.
    const key = String(Math.round(u * 0.09));
    if (this.meshKey !== key) {
      this.mesh = meshPattern(g, u * 0.09, 0.55);
      this.meshKey = key;
    }
    if (this.mesh) {
      g.fillStyle = this.mesh;
      g.globalAlpha = 0.45;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    g.strokeStyle = 'rgba(160,170,170,0.1)';
    g.lineWidth = Math.max(1, u * 0.012);
    for (let k = 1; k < 5; k++) {
      g.beginPath();
      g.moveTo(0, (H * k) / 5);
      g.lineTo(W, (H * k) / 5 + u * 0.03);
      g.stroke();
    }
  }
}
