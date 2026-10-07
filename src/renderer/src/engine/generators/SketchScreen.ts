import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import { hash2 } from '../lostMedia';
import { lyricMoment } from '../lyricText';
import { strokeLine, type StrokePath } from '../text/strokeFont';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const W = 960;

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform sampler2D uTex;
void main() {
  fragColor = vec4(fromDisplay(texture(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb), 1.0);
}
`;

/**
 * The red drawing toy with the grey screen and two white knobs: each lyric
 * line is drawn as one unbroken line, the stylus reaching each word as it is
 * sung and the knobs turning with it, then the whole toy is shaken clear for
 * the next line (and shaken hard on the drop).
 */
export class SketchScreen extends ShaderGenerator {
  readonly kind = 'sketchScreen';
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly paths = new Map<string, StrokePath>();
  private powder: HTMLCanvasElement | null = null;
  private carpet: HTMLCanvasElement | null = null;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = 540;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    super(FRAG, { uTex: { value: tex } });
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.tex = tex;
  }

  private path(text: string, cols: number): StrokePath {
    const key = `${cols}|${text}`;
    let p = this.paths.get(key);
    if (!p) {
      p = strokeLine(text, cols);
      this.paths.set(key, p);
      if (this.paths.size > 24) this.paths.delete(this.paths.keys().next().value!);
    }
    return p;
  }

  /** Aluminium-powder screen texture and a 90s carpet behind the toy (cached by size). */
  private textures(H: number): void {
    if (this.powder?.height === H) return;
    const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      return [c, c.getContext('2d')!];
    };
    const [pc, pg] = mk();
    const img = pg.createImageData(W, H);
    for (let k = 0; k < W * H; k++) {
      const v = 182 + (hash2(k, 3) - 0.5) * 26 + (hash2(Math.floor(k / W / 3), 5) - 0.5) * 6;
      img.data[k * 4] = v;
      img.data[k * 4 + 1] = v + 1;
      img.data[k * 4 + 2] = v - 2;
      img.data[k * 4 + 3] = 255;
    }
    pg.putImageData(img, 0, 0);
    this.powder = pc;
    const [cc, cg] = mk();
    cg.fillStyle = '#16123a';
    cg.fillRect(0, 0, W, H);
    const cols = ['#e83a8a', '#2ad8e8', '#f2d03a', '#8a4af2', '#3ae87a'];
    for (let k = 0; k < 420; k++) {
      const x = hash2(k, 1) * W;
      const y = hash2(k, 2) * H;
      cg.strokeStyle = cols[k % cols.length];
      cg.lineWidth = 3;
      cg.beginPath();
      if (k % 3 === 0) cg.arc(x, y, 5 + hash2(k, 4) * 6, 0, Math.PI * (1 + hash2(k, 5)));
      else if (k % 3 === 1) {
        cg.moveTo(x, y);
        for (let s = 1; s < 4; s++) cg.lineTo(x + s * 7, y + (s % 2 ? -7 : 0));
      } else cg.rect(x, y, 6, 6);
      cg.stroke();
    }
    this.carpet = cc;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const H = Math.max(300, Math.round((W * ctx.height) / Math.max(1, ctx.width)));
    if (this.canvas.height !== H) this.canvas.height = H;
    this.textures(H);
    const g = this.g;
    const p = ctx.params;
    const m = lyricMoment(ctx, 'DRAW / SHAKE / DRAW AGAIN');
    const cols = Math.max(6, Math.round(num(p.cols, 16)));
    const line = this.path(m.current.text, cols);
    const start = m.current.start;
    const dur = Math.max(0.5, m.current.end - start);
    const t = m.now - start;
    const shakeDur = Math.min(0.6, dur * 0.2);
    const shaking = num(p.shake, 1) > 0 && t < shakeDur;

    // Body shake: clearing between lines, hard on the drop, a nudge on the kick.
    const drop = ctx.env.drop * ctx.env.drop * ctx.env.drop;
    const amp = (shaking ? 16 * (1 - t / shakeDur) : 0) + 22 * drop * num(p.shake, 1) + ctx.env.kick * 2 * num(p.react, 1);
    const sx0 = Math.sin(ctx.time * 47) * amp;
    const sy0 = Math.cos(ctx.time * 39) * amp * 0.6;

    g.drawImage(this.carpet!, 0, 0);
    // The toy.
    const bw = Math.min(W * 0.92, H * 1.5);
    const bh = Math.min(H * 0.92, bw * 0.8);
    const bx = (W - bw) / 2 + sx0;
    const by = (H - bh) / 2 + sy0;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    this.round(g, bx + 10, by + 14, bw, bh, bh * 0.08);
    g.fill();
    const body = g.createLinearGradient(0, by, 0, by + bh);
    body.addColorStop(0, '#e2363a');
    body.addColorStop(0.5, '#c81e26');
    body.addColorStop(1, '#9a1218');
    g.fillStyle = body;
    this.round(g, bx, by, bw, bh, bh * 0.08);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 3;
    this.round(g, bx + 4, by + 4, bw - 8, bh - 8, bh * 0.07);
    g.stroke();
    // Gold flourish on the top rail.
    g.strokeStyle = '#e8c35a';
    g.lineWidth = 2.5;
    g.beginPath();
    for (let k = 0; k <= 40; k++) {
      const x = bx + bw * 0.3 + (k / 40) * bw * 0.4;
      const y = by + bh * 0.055 + Math.sin(k * 0.9) * bh * 0.012;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    // Screen.
    const sx = bx + bw * 0.1;
    const sy = by + bh * 0.11;
    const sw = bw * 0.8;
    const sh = bh * 0.66;
    g.save();
    this.round(g, sx, sy, sw, sh, 10);
    g.clip();
    g.drawImage(this.powder!, sx, sy, sw, sh, sx, sy, sw, sh);
    const vig = g.createRadialGradient(sx + sw / 2, sy + sh / 2, sh * 0.3, sx + sw / 2, sy + sh / 2, sw * 0.7);
    vig.addColorStop(0, 'rgba(255,255,255,0.06)');
    vig.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = vig;
    g.fillRect(sx, sy, sw, sh);

    // The line: the previous one fading as it is shaken off, then the new one drawn up to the sung word.
    let tip: [number, number] = [0.5, 0.5];
    if (shaking && m.previous[0]) {
      const prev = this.path(m.previous[0], cols);
      g.globalAlpha = Math.max(0, 1 - t / shakeDur) ** 1.5;
      this.stroke(g, prev, prev.len[prev.len.length - 1], sx, sy, sw, sh, amp * 0.3, ctx.time);
      g.globalAlpha = 1;
      // Powder washing back over it.
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(190,191,188,${0.25 * (t / shakeDur)})`;
        g.fillRect(sx, sy + hash2(k, Math.floor(ctx.time * 20)) * sh, sw, sh * 0.08);
      }
    } else {
      const total = line.len[line.len.length - 1];
      let L = 0;
      const words = m.current.words;
      for (let k = 0; k < words.length; k++) {
        const a = Math.max(words[k].start, start + shakeDur);
        const next = words[k + 1]?.start ?? m.current.end;
        const b = Math.max(a + 0.15, Math.min(next - 0.04, a + 1.4));
        const from = k ? line.wordEnd[k - 1] : 0;
        const to = line.wordEnd[k] ?? total;
        if (m.now >= a) L = from + (to - from) * Math.min(1, (m.now - a) / (b - a));
      }
      if (!words.length) L = total;
      tip = this.stroke(g, line, L, sx, sy, sw, sh, 0, ctx.time);
    }
    g.restore();
    // Screen bevel.
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 4;
    this.round(g, sx, sy, sw, sh, 10);
    g.stroke();

    // Knobs: left turns with the stylus across, right with it up and down.
    const kr = bh * 0.085;
    this.knob(g, bx + bw * 0.09, by + bh * 0.88, kr, tip[0] * 9);
    this.knob(g, bx + bw * 0.91, by + bh * 0.88, kr, tip[1] * 9);
    this.tex.needsUpdate = true;
  }

  /** Draw the path up to arc length L; returns the stylus tip (0..1 of the screen). */
  private stroke(g: CanvasRenderingContext2D, path: StrokePath, L: number, sx: number, sy: number, sw: number, sh: number, wobble: number, time: number): [number, number] {
    const scale = Math.min((sw * 0.86) / path.width, (sh * 0.8) / (path.rows * 9 - 3));
    const ox = sx + (sw - path.width * scale) / 2;
    const oy = sy + (sh - (path.rows * 9 - 3) * scale) / 2 + 6 * scale;
    const X = (k: number): number => ox + (path.pts[k * 2] + (hash2(k, 7) - 0.5) * 0.14) * scale + Math.sin(time * 40 + k) * wobble;
    const Y = (k: number): number => oy - (path.pts[k * 2 + 1] + (hash2(k, 8) - 0.5) * 0.14) * scale + Math.cos(time * 37 + k) * wobble;
    g.strokeStyle = '#43464b';
    g.lineWidth = Math.max(1.6, scale * 0.24);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(X(0), Y(0));
    let tx = X(0);
    let ty = Y(0);
    const n = path.len.length;
    for (let k = 1; k < n; k++) {
      if (path.len[k] <= L) {
        tx = X(k);
        ty = Y(k);
        g.lineTo(tx, ty);
        continue;
      }
      const seg = path.len[k] - path.len[k - 1];
      const f = seg > 0 ? (L - path.len[k - 1]) / seg : 0;
      tx = X(k - 1) + (X(k) - X(k - 1)) * f;
      ty = Y(k - 1) + (Y(k) - Y(k - 1)) * f;
      g.lineTo(tx, ty);
      break;
    }
    g.stroke();
    // The stylus point.
    g.fillStyle = '#2a2c30';
    g.beginPath();
    g.arc(tx, ty, g.lineWidth * 0.9, 0, Math.PI * 2);
    g.fill();
    return [(tx - sx) / sw, (ty - sy) / sh];
  }

  private knob(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number): void {
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.arc(x + 4, y + 6, r, 0, Math.PI * 2);
    g.fill();
    const face = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    face.addColorStop(0, '#ffffff');
    face.addColorStop(1, '#cfcac0');
    g.fillStyle = face;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    // Knurled rim, turning.
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1.5;
    for (let k = 0; k < 28; k++) {
      const t = a + (k / 28) * Math.PI * 2;
      g.beginPath();
      g.moveTo(x + Math.cos(t) * r * 0.82, y + Math.sin(t) * r * 0.82);
      g.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
      g.stroke();
    }
  }

  private round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
