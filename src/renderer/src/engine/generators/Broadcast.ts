import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { liveText, lyricsFeed, songPositionMs } from '../lyricsFeed';
import { camClock, hash2, osdText, tapeEventAt, timecode } from '../lostMedia';
import { eventKinds } from '../fx/tapeFx';
import { archiveNow } from './ArchiveFootage';
import type { GenContext } from './Generator';
import { fontCss } from './KineticType';
import { num, ShaderGenerator } from './ShaderGenerator';

const CANVAS_W = 960;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uTex;
void main() {
  vec4 t = texture(uTex, vec2(vUv.x, 1.0 - vUv.y));
  fragColor = vec4(pow(t.rgb, vec3(2.2)) * 1.1, t.a);
}
`;

const HAND = `700 {px}px "Segoe Print", "Comic Sans MS", "Bradley Hand", "Chalkboard SE", cursive`;
const CITIES = ['RIVERSIDE', 'LAKEVIEW', 'OAK HILL', 'PINE BLUFF', 'HARBOR CITY', 'MILLBROOK', 'FAIRVIEW', 'CEDAR FALLS', 'NORTHGATE', 'SPRINGDALE'];
const SKIES = ['SUNNY', 'P/CLOUDY', 'SHOWERS', 'T-STORMS', 'FAIR', 'FOG', 'CLEAR', 'WINDY'];

/**
 * The text printed on an old recording: camcorder date stamps, VCR on-screen
 * display, a channel bug and lower third, CCTV labels, a weather crawl, and
 * lyrics as closed captions, teletext subtitles, a karaoke wipe, a silent-film
 * intertitle or a handwritten slate. Drawn to a small canvas each frame.
 */
export class Broadcast extends ShaderGenerator {
  readonly kind = 'broadcast';
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  /** What was drawn last frame (debug hooks and tests). */
  info = { kit: '', osd: '', caption: '' };
  /** Layout width (the canvas, or its 4:3 middle). */
  private vw = CANVAS_W;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
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

  update(ctx: GenContext): void {
    super.update(ctx);
    const H = Math.max(200, Math.round((CANVAS_W * ctx.height) / Math.max(1, ctx.width)));
    if (this.canvas.height !== H) this.canvas.height = H;
    const g = this.g;
    g.clearRect(0, 0, CANVAS_W, H);
    const p = ctx.params;
    // 4:3 safe area: lay the text out inside the middle of the frame (for looks shown on an old TV).
    const W = p.safe43 === true ? Math.round((H * 4) / 3) : CANVAS_W;
    this.vw = W;
    g.save();
    g.translate((CANVAS_W - W) / 2, 0);
    const kit = String(p.kit ?? 'camcorder');
    const epoch = Date.now();
    const playing = lyricsFeed.now.connected && !!lyricsFeed.now.trackId;
    const secs = playing ? songPositionMs(epoch) / 1000 : ctx.time;
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    const bar = Math.floor(ctx.beat / bpb);
    const s = H / 540;
    const seed = Math.round(num(p.seed, 0));
    const ev = tapeEventAt(ctx.beat, bpb, num(p.events, 0), seed, eventKinds(p.eventList));
    const date = String(p.date ?? 'JUN 14 1994');
    const station = String(p.station ?? 'CHANNEL 9');
    const title = String(p.title ?? '');
    this.info = { kit, osd: '', caption: '' };

    const text = (t: string, x: number, y: number, px: number, color = '#fff', align: CanvasTextAlign = 'left', font = 'mono', shadow = true): void => {
      g.font = font.includes('{px}') ? font.replace('{px}', String(Math.round(px * s))) : fontCss(font, Math.round(px * s));
      g.textAlign = align;
      g.textBaseline = 'alphabetic';
      if (shadow) {
        g.fillStyle = 'rgba(0,0,0,0.85)';
        g.fillText(t, x + 2 * s, y + 2 * s);
      }
      g.fillStyle = color;
      g.fillText(t, x, y);
    };
    const box = (x: number, y: number, w: number, h: number, color: string): void => {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    };

    // ---- kits
    if (kit === 'camcorder') {
      if (Math.floor(ctx.time * 1.6) % 2 === 0) {
        g.fillStyle = '#ff2a1a';
        g.beginPath();
        g.arc(52 * s, 50 * s, 9 * s, 0, Math.PI * 2);
        g.fill();
      }
      text('REC', 70 * s, 59 * s, 26);
      // Battery, draining over the song.
      const bx = W - 110 * s;
      g.strokeStyle = '#fff';
      g.lineWidth = 3 * s;
      g.strokeRect(bx, 36 * s, 56 * s, 24 * s);
      box(bx + 56 * s, 42 * s, 5 * s, 12 * s, '#fff');
      const cells = Math.max(1, 3 - Math.floor((secs / 120) % 3));
      for (let i = 0; i < cells; i++) box(bx + (5 + i * 17) * s, 40 * s, 13 * s, 16 * s, '#fff');
      text(camClock(secs), 46 * s, H - 78 * s, 26, '#ffe9a8');
      text(date, 46 * s, H - 44 * s, 30, '#ffe9a8');
      text('SP', W - 46 * s, H - 44 * s, 24, '#fff', 'right');
      this.info.osd = 'REC';
    } else if (kit === 'vcr') {
      const prevEv = tapeEventAt((bar - 1) * bpb + 0.01, bpb, num(p.events, 0), seed, eventKinds(p.eventList));
      const label = ev.kind !== 'none' ? osdText(ev.kind) : prevEv.kind !== 'none' || bar % 32 === 0 ? 'PLAY ▶' : '';
      if (label) text(label, 56 * s, 70 * s, 40, '#7dff9a');
      if (ev.kind === 'eat') {
        for (let i = 0; i < 12; i++) box((56 + i * 22) * s, 90 * s, 16 * s, 18 * s, i < 4 + Math.floor(ev.t * 8) ? '#7dff9a' : 'rgba(125,255,154,0.25)');
      }
      text(`SP ${timecode(secs).slice(1, 8)}`, W - 56 * s, H - 50 * s, 30, '#7dff9a', 'right');
      this.info.osd = label;
    } else if (kit === 'tv') {
      g.globalAlpha = 0.75;
      text(station, W - 40 * s, H - 46 * s, 26, '#fff', 'right', 'heavy');
      g.globalAlpha = 1;
      const np = lyricsFeed.now;
      const showLower = bar % 16 < 6;
      const lt1 = playing ? np.title : title;
      const lt2 = playing ? np.artists.join(', ') : '';
      if (showLower && lt1) {
        const y = H - 150 * s;
        box(0, y, 620 * s, 74 * s, 'rgba(10,10,30,0.82)');
        box(0, y, 10 * s, 74 * s, '#ffcc00');
        text(lt1.toUpperCase().slice(0, 34), 28 * s, y + 34 * s, 26, '#fff', 'left', 'heavy', false);
        if (lt2) text(lt2.slice(0, 40), 28 * s, y + 62 * s, 20, '#ffcc00', 'left', 'heavy', false);
        this.info.osd = lt1;
      }
      const ticker = String(p.ticker ?? '');
      if (ticker) {
        const y = H - 34 * s;
        box(0, y, W, 34 * s, 'rgba(0,0,0,0.8)');
        g.font = fontCss('heavy', Math.round(20 * s));
        const msg = `${ticker}   •   `;
        const tw = g.measureText(msg).width;
        const off = (ctx.time * 90 * s) % tw;
        for (let x = -off; x < W; x += tw) text(msg, x, y + 24 * s, 20, '#fff', 'left', 'heavy', false);
      }
    } else if (kit === 'cctv') {
      const labels = ['CAM 03', 'CAM 04', 'CAM 01', 'CAM 02'];
      for (let i = 0; i < 4; i++) {
        const x = (i % 2) * (W / 2);
        const y = Math.floor(i / 2) * (H / 2);
        text(labels[i], x + 18 * s, y + 34 * s, 20);
      }
      text(`${date}  ${camClock(secs, 23.6).slice(3)}`, W / 2, H - 18 * s, 20, '#fff', 'center');
      if (Math.floor(ctx.time) % 2 === 0) text('● REC', W - 20 * s, 34 * s, 20, '#ff3b2a', 'right');
    } else if (kit === 'weather') {
      box(40 * s, 40 * s, 420 * s, 50 * s, 'rgba(10,30,120,0.85)');
      text('LOCAL FORECAST', 56 * s, 75 * s, 28, '#fff', 'left', 'heavy', false);
      const page = Math.floor(bar / 2);
      box(40 * s, 96 * s, 420 * s, 230 * s, 'rgba(0,0,40,0.6)');
      for (let i = 0; i < 5; i++) {
        const c = Math.floor(hash2(page * 5 + i, seed) * CITIES.length);
        const temp = 55 + Math.floor(hash2(page, i + seed) * 35);
        const sky = SKIES[Math.floor(hash2(i, page + 3) * SKIES.length)];
        const y = (132 + i * 42) * s;
        text(CITIES[c], 56 * s, y, 22, '#fff');
        text(sky, 300 * s, y, 18, '#9fd8ff');
        text(`${temp}°`, 444 * s, y, 22, '#ffe066', 'right');
      }
      text(station, W - 40 * s, H - 46 * s, 24, '#fff', 'right', 'heavy');
    } else if (kit === 'corporate') {
      const ph = (ctx.beat / bpb) % 8;
      const a = Math.min(1, Math.max(0, Math.min(ph * 2, (2 - ph) * 2)));
      if (a > 0 && title) {
        g.globalAlpha = a;
        text(title.toUpperCase(), W / 2, H / 2 - 10 * s, 52, '#fff', 'center', 'heavy');
        text(`MODULE ${1 + (Math.floor(bar / 8) % 9)}`, W / 2, H / 2 + 40 * s, 24, '#ffd76a', 'center', 'heavy');
        g.globalAlpha = 1;
      }
      text(station, 40 * s, H - 40 * s, 20, 'rgba(255,255,255,0.8)', 'left', 'heavy');
    } else if (kit === 'shortwave') {
      const groups: string[] = [];
      for (let i = 0; i < 5; i++) groups.push(String(Math.floor(hash2(bar, i + seed * 7) * 10)));
      text(groups.join(' '), W / 2, H - 70 * s, 54, '#ffb347', 'center');
      text(`${(6.8 + hash2(Math.floor(bar / 16), seed) * 3).toFixed(3)} MHz`, W - 60 * s, 60 * s, 24, '#ffb347', 'right');
    } else if (kit === 'test') {
      const y = H * 0.5 - 30 * s;
      box(W / 2 - 230 * s, y, 460 * s, 66 * s, '#000');
      text(station, W / 2, y + 30 * s, 26, '#fff', 'center', 'heavy', false);
      text(playing ? lyricsFeed.now.title : title, W / 2, y + 56 * s, 18, '#fff', 'center', 'mono', false);
    } else if (kit === 'signoff') {
      const ph = (ctx.beat / bpb) % 16;
      const a = Math.min(1, Math.max(0, Math.min((ph - 2) / 2, (14 - ph) / 2)));
      g.globalAlpha = a;
      text(station, W / 2, H * 0.3, 40, '#fff', 'center', 'serif');
      text(title || 'THIS CONCLUDES OUR BROADCAST DAY', W / 2, H * 0.3 + 44 * s, 22, '#fff', 'center', 'serif');
      g.globalAlpha = 1;
    } else if (kit === 'web') {
      const stall = tapeEventAt(ctx.beat, bpb, num(p.events, 0), seed + 101, ['pause']);
      const np = lyricsFeed.now;
      text((playing ? `${np.title} - ${np.artists.join(', ')}` : title).slice(0, 48), W / 2 - 0.4 * H, H / 2 - 0.29 * H, 20, '#123', 'left', 'serif', false);
      const tot = playing && np.durationMs ? np.durationMs / 1000 : 240;
      const fmt = (v: number): string => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
      text(`${fmt(secs % tot)} / ${fmt(tot)}`, W / 2 + 0.4 * H, H / 2 + 0.31 * H, 16, '#222', 'right', 'mono', false);
      if (stall.kind !== 'none') {
        const pct = Math.floor(stall.t * 100);
        text(`Buffering… ${pct}%`, W / 2, H / 2 + 0.04 * H, 26, '#fff', 'center');
        this.info.osd = 'Buffering';
      }
    } else if (kit === 'archive') {
      // A catalogue card for each new clip: source, year and title, for the first two bars.
      const since = ctx.beat - archiveNow.slotStart;
      if (archiveNow.showing && since >= 0 && since < bpb * 2 && archiveNow.title) {
        const a = Math.min(1, since * 2, (bpb * 2 - since) * 2);
        g.globalAlpha = a;
        const y = 44 * s;
        g.font = fontCss('mono', Math.round(20 * s));
        const head = `${archiveNow.source.toUpperCase()}${archiveNow.year ? ` · ${archiveNow.year}` : ''}`;
        const ttl = archiveNow.title.toUpperCase().slice(0, 44);
        const w = Math.max(g.measureText(head).width, g.measureText(ttl).width) + 32 * s;
        box(30 * s, y, w, 66 * s, 'rgba(0,0,0,0.72)');
        text(head, 46 * s, y + 26 * s, 18, '#ffd76a', 'left', 'mono', false);
        text(ttl, 46 * s, y + 52 * s, 20, '#fff', 'left', 'mono', false);
        g.globalAlpha = 1;
        this.info.osd = ttl;
      }
      text(station, W - 40 * s, H - 40 * s, 20, 'rgba(255,255,255,0.75)', 'right', 'heavy');
    } else if (kit === 'channel') {
      // Cable-box style: a big green channel number and a "now showing" banner after each change.
      const since = ctx.beat - archiveNow.slotStart;
      if (archiveNow.showing && since >= 0 && since < bpb * 2) {
        g.globalAlpha = Math.min(1, (bpb * 2 - since) * 2);
        text(`CH ${String(archiveNow.channel || 3).padStart(2, '0')}`, W - 50 * s, 82 * s, 58, '#5dff7a', 'right', 'mono');
        if (since > 0.5 && archiveNow.title) {
          const y = H - 96 * s;
          box(0, y, W * 0.7, 56 * s, 'rgba(0,0,40,0.75)');
          text(archiveNow.source.toUpperCase(), 24 * s, y + 22 * s, 16, '#9fd8ff', 'left', 'mono', false);
          text(`${archiveNow.title.toUpperCase().slice(0, 40)}${archiveNow.year ? ` (${archiveNow.year})` : ''}`, 24 * s, y + 46 * s, 20, '#fff', 'left', 'mono', false);
        }
        g.globalAlpha = 1;
        this.info.osd = `CH ${archiveNow.channel}`;
      }
    } else if (kit === 'desktop') {
      text(title || 'DEMO.EXE', W / 2 - 0.44 * H, H / 2 - 0.283 * H, 15, '#fff', 'left', 'heavy', false);
    }

    // ---- captions (the sung line)
    const cap = String(p.captions ?? 'off');
    if (cap !== 'off' && num(p.lyrics, 1) >= 0.5) this.drawCaption(cap, ctx, title, H, s, text, box);

    g.restore();
    this.tex.needsUpdate = true;
  }

  private drawCaption(
    cap: string,
    ctx: GenContext,
    title: string,
    H: number,
    s: number,
    text: (t: string, x: number, y: number, px: number, color?: string, align?: CanvasTextAlign, font?: string, shadow?: boolean) => void,
    box: (x: number, y: number, w: number, h: number, color: string) => void,
  ): void {
    const g = this.g;
    const W = this.vw;
    const lead = num(ctx.params.lead, 150);
    const live = liveText('lyrics', Date.now(), lead, 1, 1);
    const lyrics = live.kind === 'lyrics' || live.kind === 'title';
    const cur = lyrics ? live.lines[live.current] ?? '' : title;
    const prev = lyrics && live.current > 0 ? live.lines[live.current - 1] : '';
    const next = lyrics ? live.lines[live.current + 1] ?? '' : '';
    if (!cur) return;
    this.info.caption = cur;
    if (cap === 'cc') {
      // Line-21 captions: white monospace on black cells, rolling up two rows.
      const rows = [prev, cur].filter(Boolean).map((r) => r.toUpperCase().slice(0, 32));
      g.font = fontCss('mono', Math.round(26 * s));
      rows.forEach((r, i) => {
        const y = H - (rows.length - i) * 40 * s - 40 * s;
        const w = g.measureText(r).width + 24 * s;
        box(W / 2 - w / 2, y - 30 * s, w, 38 * s, '#000');
        text(r, W / 2, y, 26, '#fff', 'center', 'mono', false);
      });
    } else if (cap === 'teletext') {
      const colors = ['#ffff00', '#00ffff', '#ffffff', '#00ff00'];
      const r = cur.slice(0, 36);
      g.save();
      g.font = fontCss('mono', Math.round(24 * s));
      const w = g.measureText(r).width + 20 * s;
      g.translate(W / 2, H - 70 * s);
      g.scale(1, 1.8);
      box(-w / 2, -24 * s, w, 30 * s, '#000');
      g.fillStyle = colors[Math.max(0, live.current) % colors.length];
      g.textAlign = 'center';
      g.fillText(r, 0, 0);
      g.restore();
    } else if (cap === 'karaoke') {
      // Karaoke tape: the line wipes from white to warm as it is sung; the next line waits below.
      const px = 40;
      g.font = fontCss('heavy', Math.round(px * s));
      const w = Math.min(W * 0.9, g.measureText(cur).width);
      const x0 = W / 2 - w / 2;
      const y = H - 120 * s;
      g.save();
      g.textAlign = 'left';
      g.lineWidth = 6 * s;
      g.strokeStyle = '#0a1a6a';
      g.strokeText(cur, x0, y, W * 0.9);
      g.fillStyle = '#fff';
      g.fillText(cur, x0, y, W * 0.9);
      g.beginPath();
      g.rect(x0, y - px * s, w * live.progress, px * s * 1.4);
      g.clip();
      g.fillStyle = '#ff7a1a';
      g.fillText(cur, x0, y, W * 0.9);
      g.restore();
      if (next) text(next, W / 2, H - 70 * s, 26, '#cfe3ff', 'center', 'heavy');
    } else if (cap === 'intertitle') {
      const lines = wrap(g, cur, fontCss('serif', Math.round(46 * s)), W * 0.62);
      lines.forEach((l, i) => text(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * 58 * s + 16 * s, 46, '#efe8d6', 'center', 'serif', false));
    } else if (cap === 'slate') {
      const lines = wrap(g, cur, HAND.replace('{px}', String(Math.round(36 * s))), W * 0.5);
      const h = (lines.length * 46 + 40) * s;
      g.save();
      g.translate(W / 2, H * 0.66);
      g.rotate(-0.03 + 0.02 * Math.sin(Math.floor(Math.max(0, live.current)) * 1.7));
      box(-W * 0.29, -h / 2, W * 0.58, h, '#f4f1e6');
      lines.forEach((l, i) => text(l, 0, -h / 2 + (40 + i * 46) * s, 36, '#1a1a8a', 'center', HAND, false));
      g.restore();
    }
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}

function wrap(g: CanvasRenderingContext2D, t: string, font: string, max: number): string[] {
  g.font = font;
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (line && g.measureText(tryLine).width > max) {
      out.push(line);
      line = word;
    } else line = tryLine;
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}
