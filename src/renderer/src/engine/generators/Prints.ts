import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import { hash2 } from '../lostMedia';
import { lyricMoment } from '../lyricText';
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

const HAND = `700 {px}px "Segoe Print", "Comic Sans MS", "Bradley Hand", "Chalkboard SE", "Comic Neue", cursive`;
const MONO = `bold {px}px "Courier New", Consolas, monospace`;
const SANS = `900 {px}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
const f = (font: string, px: number): string => font.replace('{px}', String(Math.round(px)));
const SKIN = ['#f1c7a5', '#d9a07a', '#a8714c', '#7a4a2e', '#f5d6c0'];
const SHIRTS = ['#d93a3a', '#3a6fd9', '#2fae6a', '#e8c23a', '#8a3ad9', '#222222', '#f2f2f2'];

/**
 * Vintage photo prints: a disposable camera's flash snapshots piling up on a
 * table (date stamp, frames-left counter, captions in marker), a photo-booth
 * strip shot four frames to the beat with each pose holding up a word of the
 * lyrics, or one big instant photo developing and shaking with the line
 * written underneath. All the photos are drawn procedurally.
 */
export class Prints extends ShaderGenerator {
  readonly kind = 'prints';
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly photos = new Map<string, HTMLCanvasElement>();

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

  /** A procedural flash photo: people at a party, in a bedroom, outdoors or at a gig (cached by seed). */
  private photo(seed: number, w: number, h: number, kind: string, sign?: string, pose = 0): HTMLCanvasElement {
    const key = `${seed}|${w}|${h}|${kind}|${sign ?? ''}|${pose}`;
    const hit = this.photos.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const r = (k: number): number => hash2(seed, k);
    const scene = kind === 'booth' ? 'booth' : ['party', 'bedroom', 'outside', 'gig'][Math.floor(r(1) * 4)];
    // Backdrop.
    if (scene === 'booth') {
      g.fillStyle = ['#e8e4dc', '#c9d8e8', '#e8d0d8'][Math.floor(r(2) * 3)];
      g.fillRect(0, 0, w, h);
    } else if (scene === 'outside') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#7fb6e8');
      sky.addColorStop(0.6, '#cfe4f2');
      sky.addColorStop(0.61, '#5f9a4a');
      sky.addColorStop(1, '#3f7a32');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
    } else {
      // Flash falloff: bright in front, the room dropping to black behind.
      const back = scene === 'gig' ? '#0a0612' : scene === 'bedroom' ? '#3a2e4a' : '#1a1210';
      g.fillStyle = back;
      g.fillRect(0, 0, w, h);
      if (scene === 'bedroom') {
        for (let i = 0; i < 4; i++) {
          g.fillStyle = ['#d93a6a', '#3ad9c9', '#e8c23a', '#6a3ad9'][i];
          g.fillRect(w * (0.08 + i * 0.24), h * 0.12, w * 0.16, h * 0.24);
        }
      } else if (scene === 'gig') {
        for (let i = 0; i < 6; i++) {
          const x = w * (0.1 + i * 0.16);
          const beam = g.createLinearGradient(x, 0, x, h);
          beam.addColorStop(0, ['#ff3a6a', '#3a8aff', '#ffe03a'][i % 3]);
          beam.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = beam;
          g.globalAlpha = 0.35;
          g.beginPath();
          g.moveTo(x - 4, 0);
          g.lineTo(x + 4, 0);
          g.lineTo(x + w * 0.12, h);
          g.lineTo(x - w * 0.12, h);
          g.fill();
          g.globalAlpha = 1;
        }
      } else {
        // Party: streamers and a mirror ball.
        for (let i = 0; i < 9; i++) {
          g.strokeStyle = SHIRTS[i % SHIRTS.length];
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(r(10 + i) * w, 0);
          g.quadraticCurveTo(r(20 + i) * w, h * 0.25, r(30 + i) * w, h * 0.12);
          g.stroke();
        }
        g.fillStyle = '#ccc';
        g.beginPath();
        g.arc(w * 0.82, h * 0.15, h * 0.08, 0, Math.PI * 2);
        g.fill();
      }
    }
    // People: two to four, posed, lit by the flash.
    const n = scene === 'booth' ? 1 + Math.floor(r(3) * 2) : 2 + Math.floor(r(3) * 3);
    for (let i = 0; i < n; i++) {
      const cx = w * ((i + 0.5) / n + (r(40 + i) - 0.5) * 0.08);
      const hy = h * (scene === 'booth' ? 0.38 : 0.45 + (r(50 + i) - 0.5) * 0.1);
      const hr = h * (scene === 'booth' ? 0.16 : 0.1) * (0.9 + r(60 + i) * 0.2);
      const tilt = ((pose + i) % 3 - 1) * 0.15;
      g.save();
      g.translate(cx, hy);
      g.rotate(tilt);
      g.fillStyle = SHIRTS[Math.floor(r(70 + i) * SHIRTS.length)];
      g.beginPath();
      g.ellipse(0, hr * 2.4, hr * 1.6, hr * 1.4, 0, Math.PI, 0);
      g.fill();
      g.fillRect(-hr * 1.6, hr * 2.4, hr * 3.2, h);
      g.fillStyle = SKIN[Math.floor(r(80 + i) * SKIN.length)];
      g.beginPath();
      g.arc(0, 0, hr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ['#2a1a10', '#d9b060', '#111', '#8a3a1a'][Math.floor(r(90 + i) * 4)];
      g.beginPath();
      g.arc(0, -hr * 0.3, hr * 1.02, Math.PI, 0);
      g.fill();
      // Eyes (with flash red-eye), and a mouth that changes with the pose.
      g.fillStyle = r(100 + i) < 0.4 && scene !== 'outside' ? '#e02020' : '#1a1a1a';
      g.beginPath();
      g.arc(-hr * 0.35, hr * 0.05, hr * 0.1, 0, Math.PI * 2);
      g.arc(hr * 0.35, hr * 0.05, hr * 0.1, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#5a1a1a';
      g.lineWidth = Math.max(2, hr * 0.08);
      g.beginPath();
      const mood = (pose + i) % 3;
      if (mood === 0) g.arc(0, hr * 0.35, hr * 0.35, 0.15 * Math.PI, 0.85 * Math.PI);
      else if (mood === 1) g.ellipse(0, hr * 0.5, hr * 0.18, hr * 0.22, 0, 0, Math.PI * 2);
      else {
        g.moveTo(-hr * 0.3, hr * 0.45);
        g.lineTo(hr * 0.3, hr * 0.4);
      }
      g.stroke();
      g.restore();
    }
    // Photo-booth sign held up with a lyric word on it.
    if (sign) {
      const sw = w * 0.7;
      const sh = h * 0.24;
      g.save();
      g.translate(w / 2, h * 0.78);
      g.rotate((r(5) - 0.5) * 0.15);
      g.fillStyle = '#fffdf2';
      g.fillRect(-sw / 2, -sh / 2, sw, sh);
      g.strokeStyle = '#333';
      g.lineWidth = 2;
      g.strokeRect(-sw / 2, -sh / 2, sw, sh);
      let px = sh * 0.7;
      g.font = f(HAND, px);
      while (px > 8 && g.measureText(sign).width > sw * 0.9) g.font = f(HAND, (px -= 2));
      g.fillStyle = '#1b2a8a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(sign, 0, 2);
      g.restore();
    }
    // Flash look: a hot centre and dark corners; a little colour cast and grain.
    const v = g.createRadialGradient(w / 2, h * 0.45, h * 0.1, w / 2, h / 2, w * 0.75);
    v.addColorStop(0, 'rgba(255,250,235,0.18)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const nz = (hash2(i, seed) - 0.5) * 22;
      img.data[i] = Math.min(255, img.data[i] * 1.04 + nz);
      img.data[i + 1] = Math.min(255, img.data[i + 1] + nz);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * 0.92 + nz);
    }
    g.putImageData(img, 0, 0);
    this.photos.set(key, c);
    if (this.photos.size > 40) this.photos.delete(this.photos.keys().next().value!);
    return c;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const H = Math.max(300, Math.round((W * ctx.height) / Math.max(1, ctx.width)));
    if (this.canvas.height !== H) this.canvas.height = H;
    const mode = String(ctx.params.mode ?? 'snapshot');
    if (mode === 'booth') this.booth(ctx, H);
    else if (mode === 'instant') this.instant(ctx, H);
    else this.snapshot(ctx, H);
    this.tex.needsUpdate = true;
  }

  private table(H: number, wood = true): void {
    const g = this.g;
    g.fillStyle = wood ? '#5a3a22' : '#1a1a1e';
    g.fillRect(0, 0, W, H);
    if (wood) {
      for (let y = 0; y < H; y += 3) {
        g.fillStyle = `rgba(0,0,0,${0.05 + 0.08 * hash2(y, 3)})`;
        g.fillRect(0, y, W, 1 + (y % 7 === 0 ? 1 : 0));
      }
    }
  }

  // ---- Disposable camera: a flash, then the print lands on the pile.
  private snapshot(ctx: GenContext, H: number): void {
    const g = this.g;
    const p = ctx.params;
    this.table(H);
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    const every = Math.max(1, num(p.every, 2)) * bpb;
    const shot = Math.floor(ctx.beat / every);
    const into = ctx.beat - shot * every;
    const m = lyricMoment(ctx);
    const captions = p.captions !== false;
    const pw = W * 0.34;
    const ph = pw / 1.5;
    for (let k = Math.max(0, shot - 7); k <= shot; k++) {
      const age = k === shot ? into : 99;
      const land = Math.min(1, age / 0.5);
      const x = W / 2 + (hash2(k, 1) - 0.5) * W * 0.5;
      const y = H / 2 + (hash2(k, 2) - 0.5) * H * 0.4 - (1 - land) * H;
      const rot = (hash2(k, 3) - 0.5) * 0.45 * land;
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(-pw / 2 + 6, -ph / 2 + 8, pw + 16, ph + 16 + (captions ? 26 : 0));
      g.fillStyle = '#f6f3ea';
      g.fillRect(-pw / 2 - 8, -ph / 2 - 8, pw + 16, ph + 16 + (captions ? 26 : 0));
      g.drawImage(this.photo(k * 7 + 3, Math.round(pw), Math.round(ph), 'snap'), -pw / 2, -ph / 2, pw, ph);
      // Orange date stamp in the corner, like the camera printed it.
      g.font = f(MONO, 15);
      g.fillStyle = '#ff9a2a';
      g.textAlign = 'right';
      g.fillText(`'98 ${String(1 + (k % 12)).padStart(2, ' ')} ${String(1 + ((k * 7) % 28)).padStart(2, '0')}`, pw / 2 - 8, ph / 2 - 8);
      if (captions) {
        const line = k === shot ? m.current.text : m.previous[shot - k - 1] ?? '';
        g.font = f(HAND, 15);
        g.fillStyle = '#1b2a8a';
        g.textAlign = 'center';
        g.fillText(line.slice(0, 40), 0, ph / 2 + 22, pw);
      }
      g.restore();
    }
    // Frames left on the camera, and the flash itself.
    g.font = f(MONO, 18);
    g.fillStyle = '#ffe9b0';
    g.textAlign = 'left';
    g.fillText(`EXP ${String(27 - (shot % 27)).padStart(2, '0')}`, 20, 32);
    const flash = Math.max(0, 1 - into / 0.18);
    if (flash > 0) {
      g.fillStyle = `rgba(255,252,240,${flash * 0.9})`;
      g.fillRect(0, 0, W, H);
    }
  }

  // ---- Photo booth: four frames, one per beat, each pose holding up a word.
  private booth(ctx: GenContext, H: number): void {
    const g = this.g;
    // Velvet curtain behind.
    for (let x = 0; x < W; x += 24) {
      const gr = g.createLinearGradient(x, 0, x + 24, 0);
      gr.addColorStop(0, '#4a0a14');
      gr.addColorStop(0.5, '#8a1a2a');
      gr.addColorStop(1, '#4a0a14');
      g.fillStyle = gr;
      g.fillRect(x, 0, 24, H);
    }
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    const strip = Math.floor(ctx.beat / (bpb * 2));
    const into = ctx.beat - strip * bpb * 2;
    const m = lyricMoment(ctx);
    const words = m.current.words.map((w) => w.text);
    const sw = H * 0.3;
    const fh = (H - 70) / 4;
    const fw = fh * 1.25;
    for (let s = 0; s < 2; s++) {
      const k = strip - s;
      const sx = W / 2 - (s === 0 ? 0 : sw * 1.6) - fw / 2 - (s === 0 ? -sw * 0.5 : 0);
      g.save();
      g.translate(sx + fw / 2, H / 2);
      g.rotate(s === 0 ? 0.02 : -0.06);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(-fw / 2 - 6, -H / 2 + 22, fw + 24, H - 30);
      g.fillStyle = '#f7f5ee';
      g.fillRect(-fw / 2 - 14, -H / 2 + 14, fw + 28, H - 30);
      for (let i = 0; i < 4; i++) {
        const shotAt = i * (bpb / 2);
        const shown = s > 0 || into >= shotAt;
        const fy = -H / 2 + 24 + i * (fh + 2);
        if (!shown) {
          g.fillStyle = '#2a2a2e';
          g.fillRect(-fw / 2, fy, fw, fh - 4);
          continue;
        }
        const word = words.length ? words[(i + (s > 0 ? 4 : 0)) % words.length] : '';
        const develop = s > 0 ? 1 : Math.min(1, (into - shotAt) / 0.8);
        g.globalAlpha = 0.3 + 0.7 * develop;
        g.drawImage(this.photo(k * 13 + i, Math.round(fw), Math.round(fh - 4), 'booth', word, i), -fw / 2, fy, fw, fh - 4);
        g.globalAlpha = 1;
      }
      g.restore();
    }
    // The flash for the frame being shot.
    const frame = Math.floor(into / (bpb / 2));
    const since = into - frame * (bpb / 2);
    if (frame < 4 && since < 0.15) {
      g.fillStyle = `rgba(255,255,255,${(1 - since / 0.15) * 0.75})`;
      g.fillRect(0, 0, W, H);
    }
    g.font = f(SANS, 16);
    g.fillStyle = '#ffd9a0';
    g.textAlign = 'left';
    g.fillText(frame < 4 ? `PHOTO ${frame + 1} OF 4` : 'DEVELOPING…', 20, 32);
  }

  // ---- Instant photo: a new one each line, developing from grey and shaking on the kick.
  private instant(ctx: GenContext, H: number): void {
    const g = this.g;
    this.table(H, false);
    const m = lyricMoment(ctx);
    const since = m.now - m.current.start;
    const develop = Math.min(1, Math.max(0, since / 3.5));
    const shake = ctx.env.kick * num(ctx.params.react, 1);
    const pw = H * 0.62;
    const ph = pw;
    g.save();
    g.translate(W / 2 + Math.sin(ctx.time * 30) * 6 * shake, H / 2 - 20);
    g.rotate((hash2(m.index, 1) - 0.5) * 0.12 + Math.sin(ctx.time * 25) * 0.03 * shake);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(-pw / 2 - 12, -ph / 2 - 10, pw + 36, ph + 110);
    g.fillStyle = '#f7f6f0';
    g.fillRect(-pw / 2 - 20, -ph / 2 - 20, pw + 40, ph + 120);
    const img = this.photo(m.index * 11 + 5, Math.round(pw), Math.round(ph), 'instant');
    g.fillStyle = '#5a6a7a';
    g.fillRect(-pw / 2, -ph / 2, pw, ph);
    g.globalAlpha = develop * develop;
    g.drawImage(img, -pw / 2, -ph / 2, pw, ph);
    g.globalAlpha = 1;
    // Chemistry still moving: a cool cast that clears as it develops.
    g.fillStyle = `rgba(80,110,140,${0.45 * (1 - develop)})`;
    g.fillRect(-pw / 2, -ph / 2, pw, ph);
    // The line written underneath, the hero word bigger.
    const hero = m.hero >= 0 ? m.current.words[m.hero]?.text ?? '' : '';
    g.textAlign = 'center';
    g.fillStyle = '#1a1a1a';
    g.font = f(HAND, 30);
    g.fillText(hero || m.current.text.slice(0, 24), 0, ph / 2 + 46, pw);
    g.font = f(HAND, 16);
    g.fillText(m.current.text.slice(0, 48), 0, ph / 2 + 76, pw);
    g.restore();
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
