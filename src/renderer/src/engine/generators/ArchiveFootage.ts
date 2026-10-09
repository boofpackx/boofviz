import * as THREE from 'three';
import type { ArchiveClip, ArchiveRequest } from '@shared/archive';
import { ARCHIVE_COLLECTIONS } from '@shared/archive';
import { GEN_HEADER } from '../shaders/common';
import { hash2 } from '../lostMedia';
import type { GenContext } from './Generator';
import { LostScene } from './LostScene';
import { num, ShaderGenerator } from './ShaderGenerator';

/** What the archive layer is showing (read by the broadcast text's 'archive' kit in the same window). */
export const archiveNow = { title: '', year: null as number | null, source: '', slotStart: 0, showing: false, channel: 0, filler: false };

/** Procedural "filler programming" shown until real footage is on hand (never a screen of snow). */
const FILLER: Array<{ scene: string; variant: number; title: string }> = [
  { scene: 'studio', variant: 1, title: 'Local Access Hour' },
  { scene: 'globe', variant: 0, title: 'Corporate Orientation' },
  { scene: 'scenic', variant: 0, title: 'Scenic Interlude' },
  { scene: 'puppet', variant: 0, title: 'Morning Puppet Show' },
  { scene: 'lake', variant: 0, title: 'Home Movies' },
  { scene: 'radar', variant: 0, title: 'Overnight Weather' },
  { scene: 'cctv', variant: 0, title: 'Security Feed' },
  { scene: 'candles', variant: 1, title: 'Birthday Tape' },
];

/** Channel numbers for surfing (the collections a set of old channels would have carried). */
export const CHANNEL_NUMBERS: Record<string, number> = { cartoons: 3, classictv: 4, commercials: 5, ephemeral: 7, newsreels: 9, space: 11, government: 13, homemovies: 22, films: 24, scifi: 27, silent: 32, travel: 36, sports: 41, dance: 45, custom: 30 };

const DECADES: Record<string, [number, number]> = { '30s': [1930, 1939], '40s': [1940, 1949], '50s': [1950, 1959], '60s': [1960, 1969], '70s': [1970, 1979], '80s': [1980, 1989], '90s': [1990, 1999], '00s': [2000, 2002] };

/** The channel list for surfing ('' = no surfing). */
export function channelList(v: unknown): string[] {
  return String(v ?? '')
    .split(/[\s,]+/)
    .filter((c) => c in CHANNEL_NUMBERS);
}

/** Which collection a slot plays: one collection, or a channel picked per slot (never the same twice running). */
export function collectionFor(p: Record<string, unknown>, slot: number): string {
  const list = channelList(p.channels);
  if (!list.length) {
    // Found footage is archive footage: an old saved look set to your own videos plays home movies instead.
    const c = String(p.collection ?? 'ephemeral');
    return c === 'myvideos' ? 'homemovies' : c;
  }
  const pick = (s: number): number => Math.floor(hash2(s, 4441) * list.length);
  let i = pick(slot);
  if (list.length > 1 && i === pick(slot - 1)) i = (i + 1) % list.length;
  return list[i];
}

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uVideo;
uniform float uHas, uVAspect, uFit, uZoom, uChange;
void main() {
  vec2 q = vUv - 0.5;
  float ra = uRes.x / uRes.y;
  q /= 1.0 + uZoom;
  if (uFit < 0.5) {
    if (uVAspect > ra) q.x *= ra / uVAspect; else q.y *= uVAspect / ra;
  } else {
    if (uVAspect > ra) q.y *= uVAspect / ra; else q.x *= ra / uVAspect;
  }
  vec2 t = q + 0.5;
  // Changing channel: the picture rolls and tears for a moment.
  t.y = fract(t.y + uChange * uChange * 0.8);
  t.x += (hash21(vec2(floor(vUv.y * 120.0), floor(uTime * 30.0))) - 0.5) * 0.08 * uChange;
  vec3 c;
  if (uHas > 0.5) {
    float inside = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);
    c = pow(texture(uVideo, clamp(t, 0.0, 1.0)).rgb, vec3(2.2)) * inside;
  } else {
    // Still finding the tape: tuning snow with a slow roll.
    float n = hash21(floor(gl_FragCoord.xy / 2.0) + floor(uTime * 30.0) * 17.0);
    c = vec3(n * 0.45) * (0.7 + 0.3 * sin(vUv.y * 8.0 - uTime * 5.0));
  }
  float snow = hash21(floor(gl_FragCoord.xy / 2.0) + floor(uTime * 30.0) * 13.0);
  c = mix(c, vec3(snow * 0.6), smoothstep(0.35, 0.9, uChange));
  fragColor = vec4(c, 1.0);
}
`;

interface Player {
  slot: number;
  clip: ArchiveClip | null;
  video: HTMLVideoElement | null;
  tex: THREE.VideoTexture | null;
  failedAt: number;
}

/**
 * Real archive footage: a random old film or TV clip per slot (every N bars),
 * fetched and cached by the main process. Both windows ask for the same slot
 * and seek to the same beat-derived position, so preview and output match.
 */
export class ArchiveFootage extends ShaderGenerator {
  readonly kind = 'archiveFootage';
  private readonly players = new Map<number, Player>();
  private queryKey = '';
  private shown: Player | null = null;
  private filler: LostScene | null = null;
  private fillerOn = false;
  private readonly blank: THREE.DataTexture;
  /** Debug hooks: what is loaded. */
  info = { slot: 0, title: '', ready: false, time: 0 };

  constructor() {
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;
    super(FRAG, { uVideo: { value: blank }, uHas: { value: 0 }, uVAspect: { value: 4 / 3 }, uFit: { value: 0 }, uZoom: { value: 0 }, uChange: { value: 0 } });
    this.blank = blank;
  }

  private request(p: GenContext['params'], slot: number): ArchiveRequest {
    const decade = DECADES[String(p.decade ?? 'any')];
    return {
      collection: collectionFor(p, slot),
      search: String(p.search ?? ''),
      yearFrom: decade ? decade[0] : num(p.yearFrom, 1930),
      yearTo: decade ? decade[1] : num(p.yearTo, 2002),
      slot,
    };
  }

  private ensure(p: GenContext['params'], slot: number): Player {
    let pl = this.players.get(slot);
    if (pl && !(pl.failedAt && performance.now() - pl.failedAt > 10000)) return pl;
    if (pl) this.drop(pl);
    pl = { slot, clip: null, video: null, tex: null, failedAt: 0 };
    this.players.set(slot, pl);
    const player = pl;
    const api = typeof window !== 'undefined' ? window.boofviz : undefined;
    if (!api?.archiveClip) {
      player.failedAt = performance.now();
      return player;
    }
    void api
      .archiveClip(this.request(p, slot))
      .then((clip) => {
        if (this.players.get(slot) !== player) return;
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
        void v.play().catch(() => undefined);
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
    if (this.shown === pl) this.shown = null;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const key = JSON.stringify({ ...this.request(p, 0), collection: channelList(p.channels).join(',') || p.collection });
    if (key !== this.queryKey) {
      this.queryKey = key;
      for (const pl of this.players.values()) this.drop(pl);
      this.players.clear();
    }
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    const every = Math.max(1, Math.round(num(p.changeBars, 16))) * bpb;
    const raw = Math.floor(ctx.beat / every);
    const slot = raw + Math.round(num(p.skip, 0)) * 100000;
    const slotStart = raw * every;
    const cur = this.ensure(p, slot);
    // Fetch the next clip straight away, so it has the whole slot to arrive.
    this.ensure(p, slot + 1);
    for (const [s, pl] of this.players) {
      if (s !== slot && s !== slot + 1 && pl !== this.shown) {
        this.drop(pl);
        this.players.delete(s);
      }
    }
    const ready = (pl: Player | null): pl is Player & { video: HTMLVideoElement; clip: ArchiveClip } => !!pl?.video && !!pl.clip && pl.video.readyState >= 2;
    if (ready(cur) && this.shown !== cur) {
      // Keep the previous clip on screen until the next one has a frame (no flash of snow).
      const old = this.shown;
      this.shown = cur;
      if (old && !this.players.has(old.slot)) this.drop(old);
      else if (old && old.slot !== slot && old.slot !== slot + 1) {
        this.drop(old);
        this.players.delete(old.slot);
      }
    }
    const show = this.shown;
    const u = this.u;
    if (ready(show)) {
      const v = show.video;
      const dur = v.duration && Number.isFinite(v.duration) ? v.duration : show.clip.duration;
      if (dur > 1 && show.slot === slot) {
        const spb = 60 / Math.max(30, ctx.frame.bpm || 120) / Math.max(0.25, ctx.globals.speed || 1);
        const elapsed = ctx.beat - slotStart;
        const jump = Math.max(0, Math.round(num(p.jumpBeats, 0)));
        let base: number;
        let t: number;
        if (jump > 0) {
          const j = Math.floor(elapsed / jump);
          base = (0.08 + 0.8 * hash2(Math.floor(show.clip.seed * 1e6), j)) * dur;
          t = base + (elapsed - j * jump) * spb;
        } else {
          base = (0.06 + 0.7 * show.clip.seed) * dur;
          t = base + elapsed * spb;
        }
        t %= dur;
        if (!v.seeking && Math.abs(v.currentTime - t) > (jump > 0 ? 0.25 : 0.6)) v.currentTime = t;
        if (v.paused) void v.play().catch(() => undefined);
      }
      u.uVideo.value = show.tex;
      u.uHas.value = 1;
      u.uVAspect.value = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
      archiveNow.title = show.clip.title;
      archiveNow.year = show.clip.year;
      const col = collectionFor(p, show.slot);
      archiveNow.source = ARCHIVE_COLLECTIONS.find((c) => c.id === col)?.label ?? 'Archive';
      archiveNow.channel = CHANNEL_NUMBERS[col] ?? 0;
      archiveNow.slotStart = show.slot === slot ? slotStart : archiveNow.slotStart;
      archiveNow.showing = true;
      archiveNow.filler = false;
      this.fillerOn = false;
      this.info = { slot, title: show.clip.title, ready: true, time: v.currentTime };
    } else {
      u.uVideo.value = this.blank;
      u.uHas.value = 0;
      // Nothing on hand yet (first run, offline): filler programming instead of snow.
      const fill = FILLER[((raw % FILLER.length) + FILLER.length) % FILLER.length];
      this.filler ??= new LostScene();
      this.filler.update({ ...ctx, params: { scene: fill.scene, variant: fill.variant, react: 1, tint: 0, eerie: 0, spin: 0.5 } });
      archiveNow.title = fill.title;
      archiveNow.year = null;
      archiveNow.source = 'Local programming';
      archiveNow.channel = CHANNEL_NUMBERS[collectionFor(p, slot)] ?? 3;
      archiveNow.slotStart = slotStart;
      archiveNow.showing = true;
      archiveNow.filler = true;
      this.fillerOn = true;
      this.info = { slot, title: '', ready: false, time: 0 };
    }
    u.uFit.value = p.fit === 'contain' ? 1 : 0;
    u.uZoom.value = num(p.punch, 0.3) * ctx.env.kick * 0.06;
    // Channel-change static for the first half beat of a new slot (and while the next clip loads).
    const since = ctx.beat - slotStart;
    u.uChange.value = num(p.switchStatic, 0) * (since >= 0 && since < 0.6 ? 1 - since / 0.6 : 0);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    if (this.fillerOn && this.filler) this.filler.render(renderer, target);
    else super.render(renderer, target);
  }

  dispose(): void {
    this.filler?.dispose();
    for (const pl of this.players.values()) this.drop(pl);
    if (this.shown) this.drop(this.shown);
    this.players.clear();
    this.blank.dispose();
    super.dispose();
  }
}
