import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { liveText, lyricsFeed, songPositionMs } from '../lyricsFeed';
import type { GenContext } from './Generator';
import { fontCss } from './KineticType';
import { num, ShaderGenerator } from './ShaderGenerator';

const W = 960;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uTex;
void main() {
  vec3 c = texture(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  fragColor = vec4(pow(c, vec3(2.2)), 1.0);
}
`;

const fmt = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/**
 * The song you are playing as TV: a cable music channel's now-playing screen
 * (album art, title, artist, album, a progress bar, a channel bug and a
 * rotating info panel with the sung line), or the album art itself filling
 * the screen with a slow pan and zoom, for old-TV and archive treatments.
 */
export class MusicChannel extends ShaderGenerator {
  readonly kind = 'musicChannel';
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private art: HTMLImageElement | null = null;
  private artUrl = '';
  private readonly blur: HTMLCanvasElement;
  private blurFor = '';
  /** Debug hooks. */
  info = { title: '', hasArt: false, layout: '' };

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
    this.blur = document.createElement('canvas');
    this.blur.width = 320;
    this.blur.height = 180;
  }

  private loadArt(url: string | undefined): void {
    const u = url ?? '';
    if (u === this.artUrl) return;
    this.artUrl = u;
    this.art = null;
    if (!u) return;
    const img = new Image();
    img.onload = () => {
      if (this.artUrl === u) this.art = img;
    };
    img.src = u;
  }

  /** A stand-in cover when there's no art: a record on a palette gradient. */
  private placeholder(g: CanvasRenderingContext2D, x: number, y: number, s: number, ctx: GenContext): void {
    const pal = ctx.palette;
    const rgb = (i: number): string => `rgb(${[0, 1, 2].map((k) => Math.round(255 * Math.pow(Math.min(1, pal[i * 3 + k]), 1 / 2.2))).join(',')})`;
    const gr = g.createLinearGradient(x, y, x + s, y + s);
    gr.addColorStop(0, rgb(1));
    gr.addColorStop(1, rgb(3));
    g.fillStyle = gr;
    g.fillRect(x, y, s, s);
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(x + s / 2, y + s / 2, s * 0.38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgb(4);
    g.beginPath();
    g.arc(x + s / 2, y + s / 2, s * 0.12, 0, Math.PI * 2);
    g.fill();
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const H = Math.max(300, Math.round((W * ctx.height) / Math.max(1, ctx.width)));
    if (this.canvas.height !== H) this.canvas.height = H;
    const g = this.g;
    const p = ctx.params;
    const np = lyricsFeed.now;
    const playing = np.connected && !!np.trackId;
    this.loadArt(playing ? np.artDataUrl : undefined);
    const layout = String(p.layout ?? 'cable');
    const title = playing ? np.title : String(p.title ?? '');
    const artist = playing ? np.artists.join(', ') : String(p.artist ?? '');
    const album = playing ? np.album : '';
    const pos = playing ? songPositionMs(Date.now()) / 1000 : ctx.time % 210;
    const dur = playing && np.durationMs ? np.durationMs / 1000 : 210;
    this.info = { title, hasArt: !!this.art, layout };

    // Blurred, darkened art for the background (made once per cover).
    const key = `${this.artUrl}|${!!this.art}`;
    if (key !== this.blurFor) {
      this.blurFor = key;
      const b = this.blur.getContext('2d')!;
      b.filter = 'blur(14px)';
      if (this.art) b.drawImage(this.art, -40, -60, 400, 300);
      else this.placeholder(b, -40, -100, 400, ctx);
      b.filter = 'none';
    }

    if (layout === 'art') {
      // The cover fills the screen, slowly drifting and zooming (one move per 8 bars).
      const bars = ctx.beat / Math.max(1, ctx.frame.beatsPerBar);
      const seg = Math.floor(bars / 8);
      const t = (bars % 8) / 8;
      const ease = t * t * (3 - 2 * t);
      const pan = num(p.pan, 1);
      const z0 = 1.05 + 0.25 * ((seg * 0.618) % 1) * pan;
      const z1 = 1.05 + 0.25 * (((seg + 1) * 0.618) % 1) * pan;
      const zoom = (z0 + (z1 - z0) * ease) * (1 + 0.02 * ctx.env.kick * num(p.punch, 1));
      const ox = (Math.sin(seg * 2.1) * 0.5 + (Math.sin((seg + 1) * 2.1) - Math.sin(seg * 2.1)) * 0.5 * ease) * 0.12 * pan;
      const oy = (Math.cos(seg * 1.7) * 0.5 + (Math.cos((seg + 1) * 1.7) - Math.cos(seg * 1.7)) * 0.5 * ease) * 0.12 * pan;
      g.drawImage(this.blur, 0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 0, W, H);
      const fill = String(p.fit ?? 'cover') === 'cover' ? Math.max(W, H) : H * 0.86;
      const s = fill * zoom;
      const x = W / 2 - s / 2 + ox * W;
      const y = H / 2 - s / 2 + oy * H;
      if (this.art) g.drawImage(this.art, x, y, s, s);
      else this.placeholder(g, x, y, s, ctx);
      this.tex.needsUpdate = true;
      return;
    }

    // ---- Cable music channel now-playing screen.
    const era = String(p.style ?? 'cable90');
    g.drawImage(this.blur, 0, 0, W, H);
    const shade = g.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, era === 'digital00' ? 'rgba(0,20,60,0.55)' : 'rgba(10,0,40,0.6)');
    shade.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
    const accent = era === 'digital00' ? '#36c6ff' : '#ffcc33';
    const panel = era === 'digital00' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,90,0.72)';
    // Channel bug.
    const chName = String(p.channel ?? 'RETRO ALTERNATIVE');
    const chNum = Math.round(num(p.number, 812));
    g.font = fontCss('heavy', 22);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = accent;
    g.fillText(String(chNum), 40, 52);
    const nw = g.measureText(String(chNum)).width;
    g.fillStyle = '#fff';
    g.font = fontCss('heavy', 18);
    g.fillText(chName.toUpperCase(), 52 + nw, 51);
    // Cover with a drop shadow; bounces a touch on the kick.
    const as = Math.round(H * 0.5);
    const ax = 60;
    const ay = Math.round(H * 0.2) - Math.round(ctx.env.kick * 3 * num(p.punch, 1));
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(ax + 10, ay + 10, as, as);
    if (this.art) g.drawImage(this.art, ax, ay, as, as);
    else this.placeholder(g, ax, ay, as, ctx);
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 2;
    g.strokeRect(ax, ay, as, as);
    // Text block.
    const tx = ax + as + 44;
    const tw = W - tx - 40;
    g.fillStyle = accent;
    g.font = fontCss('heavy', 16);
    g.fillText('NOW PLAYING', tx, ay + 20);
    g.fillStyle = '#fff';
    fitText(g, title, tx, ay + 64, tw, 40);
    g.fillStyle = '#d8e4ff';
    fitText(g, artist, tx, ay + 104, tw, 28);
    if (album) {
      g.fillStyle = '#9fb0cc';
      g.font = fontCss('heavy', 18);
      g.fillText(album.slice(0, 40), tx, ay + 136, tw);
    }
    // Progress bar.
    const py = ay + as - 16;
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(tx, py, tw, 8);
    g.fillStyle = accent;
    g.fillRect(tx, py, tw * Math.min(1, pos / dur), 8);
    g.fillStyle = '#fff';
    g.font = fontCss('mono', 15);
    g.fillText(fmt(pos), tx, py - 8);
    g.textAlign = 'right';
    g.fillText(fmt(dur), tx + tw, py - 8);
    g.textAlign = 'left';
    // Rotating info panel: the sung line, then the album, then the channel.
    const live = liveText('lyrics', Date.now(), 150);
    const line = live.kind === 'lyrics' ? live.lines[live.current] : '';
    const items = [line ? `“${line}”` : `${title} — ${artist}`, album ? `From the album ${album}` : 'Commercial-free music, all day', `You're watching ${chName}`];
    const slot = Math.floor(ctx.beat / (Math.max(1, ctx.frame.beatsPerBar) * 4)) % items.length;
    const iy = ay + as + 30;
    g.fillStyle = panel;
    g.fillRect(40, iy, W - 80, 46);
    g.fillStyle = accent;
    g.fillRect(40, iy, 6, 46);
    g.fillStyle = '#fff';
    g.font = fontCss('heavy', 19);
    g.fillText(items[slot].slice(0, 70), 60, iy + 30, W - 120);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}

function fitText(g: CanvasRenderingContext2D, t: string, x: number, y: number, max: number, px: number): void {
  let size = px;
  g.font = fontCss('heavy', size);
  while (size > 14 && g.measureText(t).width > max) {
    size -= 2;
    g.font = fontCss('heavy', size);
  }
  g.fillText(t, x, y, max);
}
