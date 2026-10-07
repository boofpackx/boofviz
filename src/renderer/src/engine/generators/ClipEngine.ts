import * as THREE from 'three';
import type { ArchiveClip, ArchiveRequest } from '@shared/archive';
import { hash2 } from '../lostMedia';
import { lyricsFeed, songPositionMs } from '../lyricsFeed';
import { FULLSCREEN_VERT, GEN_HEADER } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import type { CompileTarget, GenContext } from './Generator';
import { LostScene } from './LostScene';
import { num, ShaderGenerator } from './ShaderGenerator';

/** Frames kept for stutter, reverse, scratch and freeze (about 0.8 s at 60 fps). */
const RING = 48;
const CAP_W = 640;

const DECADES: Record<string, [number, number]> = { '30s': [1930, 1939], '40s': [1940, 1949], '50s': [1950, 1959], '60s': [1960, 1969], '70s': [1970, 1979], '80s': [1980, 1989], '90s': [1990, 1999], '00s': [2000, 2002] };

export const CLIP_FX = ['mix', 'stutter', 'reverse', 'scratch', 'freeze', 'off'] as const;
export type ClipFx = Exclude<(typeof CLIP_FX)[number], 'mix' | 'off'>;

/** A beat-synced trick on the footage: frames replayed from the ring instead of the live picture. */
export interface ClipTrick {
  kind: ClipFx;
  /** Beat it starts on, and how long it lasts (beats). */
  start: number;
  len: number;
}

/**
 * Which trick (if any) plays at `beat`: in the last beat of a bar (the last
 * two at the end of a phrase), on `amount` of the bars, picked per bar for
 * 'mix'. Pure, so every window plays the same trick at the same moment.
 */
export function clipTrick(beat: number, beatsPerBar: number, mode: string, amount: number, seed = 0): ClipTrick | null {
  if (mode === 'off' || amount <= 0) return null;
  const bpb = Math.max(1, beatsPerBar);
  const bar = Math.floor(beat / bpb);
  const phraseEnd = ((bar % 4) + 4) % 4 === 3;
  const len = phraseEnd ? Math.min(2, bpb) : 1;
  const start = bar * bpb + bpb - len;
  if (beat < start || hash2(bar, 7919 + seed) >= amount) return null;
  const kinds: ClipFx[] = ['stutter', 'reverse', 'scratch', 'freeze'];
  const kind = mode === 'mix' ? kinds[Math.floor(hash2(bar, 104729 + seed) * kinds.length)] : (mode as ClipFx);
  return { kind, start, len };
}

/** Which beat's frame a trick shows at `beat` (frames older than the ring show its oldest). */
export function trickSourceBeat(t: ClipTrick, beat: number): number {
  const into = Math.max(0, beat - t.start);
  switch (t.kind) {
    case 'stutter': {
      // Beat repeat: the quarter beat before the trick, over and over (eighths at a phrase end).
      const loop = t.len > 1 ? 0.125 : 0.25;
      return t.start - loop + (into % loop);
    }
    case 'reverse':
      return t.start - into;
    case 'scratch':
      // Back and forth across a quarter beat, twice a beat, like a hand on the record.
      return t.start - 0.25 * (0.5 - 0.5 * Math.cos(into * Math.PI * 4));
    case 'freeze':
      return t.start;
  }
  return beat;
}

/**
 * Clip index for cut `c` in a pool of `k`: shuffled rounds (every clip once
 * per round), a round never starting with the clip the last one ended on, so
 * the same clip never plays twice running.
 */
export function cutClip(c: number, k: number, reel: number): number {
  if (k <= 1) return 0;
  if (k === 2) return (((c + reel) % 2) + 2) % 2;
  const perm = (b: number): number[] => Array.from({ length: k }, (_, i) => i).sort((x, y) => hash2(x, b * 131 + reel * 977) - hash2(y, b * 131 + reel * 977));
  const b = Math.floor(c / k);
  const order = perm(b);
  if (order[0] === perm(b - 1)[k - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[c - b * k];
}

const CAPTURE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uVideo;
uniform vec2 uRes;
uniform float uVAspect, uFit;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 q = vUv - 0.5;
  float ra = uRes.x / uRes.y;
  if (uFit < 0.5) {
    if (uVAspect > ra) q.x *= ra / uVAspect; else q.y *= uVAspect / ra;
  } else {
    if (uVAspect > ra) q.y *= uVAspect / ra; else q.x *= ra / uVAspect;
  }
  vec2 t = q + 0.5;
  float inside = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);
  fragColor = vec4(texture(uVideo, clamp(t, 0.0, 1.0)).rgb * inside, 1.0);
}
`;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uFrame;
uniform float uFlash, uZoom, uTrick, uStrobe;
void main() {
  vec2 q = (vUv - 0.5) / (1.0 + uZoom) + 0.5;
  // Tricks shift the colour channels a touch, so the repeat reads as an edit.
  vec2 off = vec2(0.004 * uTrick, 0.0);
  vec3 c = vec3(texture(uFrame, q + off).r, texture(uFrame, q).g, texture(uFrame, q - off).b);
  c = pow(c, vec3(2.2));
  c *= 1.0 - uStrobe;
  c = mix(c, vec3(1.0), uFlash);
  fragColor = vec4(c, 1.0);
}
`;

interface Player {
  key: string;
  clip: ArchiveClip | null;
  video: HTMLVideoElement | null;
  tex: THREE.VideoTexture | null;
  failedAt: number;
}

/**
 * Clips cut to the beat: a pool of archive or own clips, cut every few
 * beats with a different clip and in-point each time (the next clip is
 * cued up before its cut, so cuts are instant), plus beat-synced tricks
 * (stutter, reverse, scratch, freeze) replayed from the last frames shown.
 * In music-video mode it plays your own video for the song that's on,
 * in time with the song.
 */
export class ClipEngine extends ShaderGenerator {
  readonly kind = 'clipEngine';
  private readonly capture: FullscreenPass;
  private readonly cu: Record<string, THREE.IUniform>;
  private ring: THREE.WebGLRenderTarget[] = [];
  private ringBeat = new Float64Array(RING).fill(-1e9);
  private head = 0;
  private ringH = 0;
  private readonly players = new Map<string, Player>();
  private queryKey = '';
  private live: Player | null = null;
  private trick: ClipTrick | null = null;
  private showBeat = 0;
  private filler: LostScene | null = null;
  private fillerOn = false;
  private mv: { trackId: string; asked: number; player: Player | null } = { trackId: '', asked: 0, player: null };
  private readonly blank: THREE.DataTexture;
  /** Set by update: capture this frame into the ring at render (not during a trick). */
  private pendingCapture = false;
  private pendingBeat = 0;
  /** Debug hooks: what is on screen. */
  info = { mode: 'clips', clip: '', cut: 0, trick: '', musicVideo: '' };

  constructor() {
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;
    super(FRAG, { uFrame: { value: blank }, uFlash: { value: 0 }, uZoom: { value: 0 }, uTrick: { value: 0 }, uStrobe: { value: 0 } });
    this.blank = blank;
    this.cu = { uVideo: { value: blank }, uRes: { value: new THREE.Vector2(16, 9) }, uVAspect: { value: 4 / 3 }, uFit: { value: 0 } };
    this.capture = new FullscreenPass(new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: CAPTURE_FRAG, uniforms: this.cu, depthTest: false, depthWrite: false }));
  }

  private request(p: GenContext['params'], slot: number): ArchiveRequest {
    const decade = DECADES[String(p.decade ?? 'any')];
    return { collection: String(p.collection ?? 'ephemeral'), search: String(p.search ?? ''), yearFrom: decade ? decade[0] : 1930, yearTo: decade ? decade[1] : 2002, slot };
  }

  private open(key: string, get: () => Promise<ArchiveClip | null> | undefined): Player {
    let pl = this.players.get(key);
    if (pl && !(pl.failedAt && performance.now() - pl.failedAt > 15000)) return pl;
    if (pl) this.drop(pl);
    pl = { key, clip: null, video: null, tex: null, failedAt: 0 };
    this.players.set(key, pl);
    const player = pl;
    const req = get();
    if (!req) {
      player.failedAt = performance.now();
      return player;
    }
    void req
      .then((clip) => {
        if (this.players.get(key) !== player) return;
        if (!clip) {
          player.failedAt = performance.now();
          return;
        }
        player.clip = clip;
        const v = document.createElement('video');
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.preload = 'auto';
        v.src = clip.url;
        v.addEventListener('error', () => (player.failedAt = performance.now()));
        const tex = new THREE.VideoTexture(v);
        tex.colorSpace = THREE.NoColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        player.video = v;
        player.tex = tex;
      })
      .catch(() => (player.failedAt = performance.now()));
    return player;
  }

  private drop(pl: Player): void {
    if (pl.video) {
      pl.video.pause();
      pl.video.removeAttribute('src');
      pl.video.load();
    }
    pl.tex?.dispose();
    if (this.live === pl) this.live = null;
  }

  private static ready(pl: Player | null | undefined): pl is Player & { video: HTMLVideoElement; clip: ArchiveClip; tex: THREE.VideoTexture } {
    return !!pl?.video && !!pl.clip && !!pl.tex && pl.video.readyState >= 2;
  }

  /** Keep a player at `t` seconds, playing or paused, seeking only when it has drifted. */
  private hold(v: HTMLVideoElement, t: number, playing: boolean, rate: number, slack: number): void {
    if (!v.seeking && Math.abs(v.currentTime - t) > slack) v.currentTime = t;
    v.playbackRate = Math.min(4, Math.max(0.25, rate));
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }

  /** Your own music video for the song that's on (asked once per song, again every 20 s while there's none). */
  private musicVideo(): Player | null {
    const np = lyricsFeed.now;
    if (!np.connected || !np.trackId) return null;
    const api = typeof window !== 'undefined' ? window.boofviz : undefined;
    const now = performance.now();
    if (np.trackId !== this.mv.trackId || (!this.mv.player && now - this.mv.asked > 20000)) {
      if (this.mv.player && np.trackId !== this.mv.trackId) {
        this.drop(this.mv.player);
        this.players.delete(this.mv.player.key);
      }
      this.mv = { trackId: np.trackId, asked: now, player: null };
      if (api?.musicVideo) {
        const trackId = np.trackId;
        void api
          .musicVideo({ title: np.title, artists: np.artists })
          .then((clip) => {
            if (!clip || this.mv.trackId !== trackId) return;
            this.mv.player = this.open(`mv:${trackId}`, () => Promise.resolve(clip));
          })
          .catch(() => undefined);
      }
    }
    return this.mv.player;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    const spb = 60 / Math.max(30, ctx.frame.bpm || 120) / Math.max(0.25, ctx.globals.speed || 1);
    const k = Math.max(1, Math.min(6, Math.round(num(p.pool, 3))));
    const key = JSON.stringify(this.request(p, 0)) + k + num(p.skip, 0);
    if (key !== this.queryKey) {
      this.queryKey = key;
      for (const [id, pl] of this.players) {
        if (id.startsWith('mv:')) continue;
        this.drop(pl);
        this.players.delete(id);
      }
    }

    // Music video first (when asked for and found), else the clip pool.
    const wantMv = String(p.footage ?? 'clips') === 'musicvideo';
    const mv = wantMv ? this.musicVideo() : null;
    let show: Player | null = null;
    const rate = num(p.rate, 1);
    let cut = 0;
    let cutStart = 0;
    if (ClipEngine.ready(mv)) {
      const np = lyricsFeed.now;
      const t = songPositionMs(Date.now()) / 1000 + num(p.offset, 0);
      const dur = Number.isFinite(mv.video.duration) ? mv.video.duration : 0;
      this.hold(mv.video, dur > 0 ? Math.min(Math.max(0, t), dur - 0.05) : Math.max(0, t), np.playing, 1, 0.3);
      mv.video.loop = false;
      show = mv;
      this.info.musicVideo = mv.clip.title;
    } else if (!wantMv || String(p.fallback ?? 'clips') === 'clips') {
      this.info.musicVideo = '';
      const reelBeats = Math.max(1, Math.round(num(p.reelBars, 32))) * bpb;
      const reel = Math.floor(ctx.beat / reelBeats) + Math.round(num(p.skip, 0)) * 100000;
      const slotOf = (r: number, j: number): string => `c:${r}:${j}`;
      const pool: Player[] = [];
      for (let j = 0; j < k; j++) pool.push(this.open(slotOf(reel, j), () => window.boofviz?.archiveClip?.(this.request(p, reel * 8 + j))));
      // The next reel's clips load during the last quarter of this one.
      if (ctx.beat - (Math.floor(ctx.beat / reelBeats) * reelBeats) > reelBeats * 0.75) for (let j = 0; j < k; j++) this.open(slotOf(reel + 1, j), () => window.boofviz?.archiveClip?.(this.request(p, (reel + 1) * 8 + j)));
      for (const [id, pl] of this.players) {
        if (id.startsWith('mv:')) continue;
        const r = Number(id.split(':')[1]);
        if (r !== reel && r !== reel + 1 && pl !== this.live) {
          this.drop(pl);
          this.players.delete(id);
        }
      }
      // Cuts: every `cut` beats, twice as fast for a bar after the drop.
      const dropFast = p.dropCuts !== false && ctx.env.drop > 0.55;
      const len = Math.max(0.125, num(p.cut, 1)) * (dropFast ? 0.5 : 1);
      cut = Math.floor(ctx.beat / len) + (dropFast ? 1 << 24 : 0);
      cutStart = (cut - (dropFast ? 1 << 24 : 0)) * len;
      const inPoint = (c: number, pl: Player & { video: HTMLVideoElement; clip: ArchiveClip }): number => {
        const dur = Number.isFinite(pl.video.duration) && pl.video.duration > 1 ? pl.video.duration : Math.max(2, pl.clip.duration);
        return (0.05 + 0.85 * hash2(c, Math.floor(pl.clip.seed * 1e6) + 17)) * dur;
      };
      const j = cutClip(cut, k, reel);
      let cur = pool[j];
      if (!ClipEngine.ready(cur)) cur = pool.find((pl) => ClipEngine.ready(pl)) ?? (ClipEngine.ready(this.live) ? this.live! : cur);
      if (ClipEngine.ready(cur)) {
        const tIn = inPoint(cut, cur) + (ctx.beat - cutStart) * spb * rate;
        this.hold(cur.video, tIn % Math.max(1, cur.video.duration || 1), true, rate, 0.35);
        show = cur;
      }
      // Cue the other clips at their next in-point, paused, so their cut lands on the right frame.
      for (let jj = 0; jj < k; jj++) {
        const pl = pool[jj];
        if (pl === show || !ClipEngine.ready(pl)) continue;
        let next = -1;
        for (let c = cut + 1; c < cut + 4 * k + 8; c++) {
          if (cutClip(c, k, reel) === jj) {
            next = c;
            break;
          }
        }
        if (next >= 0) this.hold(pl.video, inPoint(next, pl), false, rate, 0.05);
      }
      if (show?.clip) this.info.clip = show.clip.title;
    }
    if (show !== this.live && this.live && this.live !== this.mv.player && !this.players.has(this.live.key)) this.drop(this.live);
    this.live = show;

    // Tricks replay captured frames; the ring stops filling while one plays.
    this.trick = clipTrick(ctx.beat, bpb, String(p.fx ?? 'mix'), num(p.fxAmount, 0.5), Math.round(num(p.skip, 0)));
    this.showBeat = this.trick ? trickSourceBeat(this.trick, ctx.beat) : ctx.beat;
    this.info.cut = cut;
    this.info.trick = this.trick?.kind ?? '';
    if (ClipEngine.ready(show)) {
      this.cu.uVideo.value = show.tex;
      this.cu.uVAspect.value = show.video.videoWidth && show.video.videoHeight ? show.video.videoWidth / show.video.videoHeight : 4 / 3;
      this.cu.uFit.value = p.fit === 'contain' ? 1 : 0;
      this.fillerOn = false;
    } else {
      this.cu.uVideo.value = this.blank;
      // Nothing to cut yet (first run, offline, no music video): filler programming rather than snow.
      if (wantMv && String(p.fallback ?? 'clips') !== 'clips') this.fillerOn = false;
      else {
        this.filler ??= new LostScene();
        this.filler.update({ ...ctx, params: { scene: 'scenic', variant: 0, react: 1, tint: 0, eerie: 0, spin: 0.5 } });
        this.fillerOn = true;
      }
    }
    const sinceCut = ctx.beat - cutStart;
    u.uFlash.value = num(p.flash, 0.3) * (show && show !== mv ? Math.max(0, 1 - sinceCut / 0.12) : 0) * 0.6;
    u.uZoom.value = num(p.punch, 0.3) * ctx.env.kick * 0.06;
    u.uTrick.value = this.trick ? 1 : 0;
    // Stutters flicker on each repeat, like a gated edit.
    u.uStrobe.value = this.trick?.kind === 'stutter' && num(p.gate, 0.4) > 0 ? num(p.gate, 0.4) * 0.5 * (((ctx.beat - this.trick.start) % 0.25) / 0.25 > 0.7 ? 1 : 0) : 0;
    this.u.uFrame.value = this.ring.length ? this.ring[this.pickFrame()].texture : this.blank;
    this.pendingCapture = !this.trick && !!show;
    this.pendingBeat = ctx.beat;
  }

  /** The ring frame captured nearest the beat to show (the newest when live). */
  private pickFrame(): number {
    if (!this.trick) return this.head;
    let best = this.head;
    let bestD = Infinity;
    for (let i = 0; i < RING; i++) {
      const d = Math.abs(this.ringBeat[i] - this.showBeat);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private ensureRing(w: number, h: number): void {
    const rh = Math.max(90, Math.round((CAP_W * h) / Math.max(1, w)));
    if (this.ring.length && rh === this.ringH) return;
    for (const rt of this.ring) rt.dispose();
    this.ringH = rh;
    this.ring = Array.from({ length: RING }, () => new THREE.WebGLRenderTarget(CAP_W, rh, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace }));
    this.ringBeat.fill(-1e9);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    if (this.fillerOn && this.filler) {
      this.filler.render(renderer, target);
      return;
    }
    this.ensureRing(target.width, target.height);
    if (this.pendingCapture) {
      // Newest frame into the ring, then shown (live) unless a trick picks an older one.
      this.head = (this.head + 1) % RING;
      (this.cu.uRes.value as THREE.Vector2).set(target.width, target.height);
      this.capture.render(renderer, this.ring[this.head]);
      this.ringBeat[this.head] = this.pendingBeat;
      this.u.uFrame.value = this.ring[this.pickFrame()].texture;
    }
    super.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [this.pass, this.capture];
  }

  dispose(): void {
    this.filler?.dispose();
    for (const pl of this.players.values()) this.drop(pl);
    this.players.clear();
    for (const rt of this.ring) rt.dispose();
    this.capture.dispose();
    this.blank.dispose();
    super.dispose();
  }
}
