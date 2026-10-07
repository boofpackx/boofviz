import { createHash } from 'node:crypto';
import { matchKey, normalizeTitle, positionAt, type NowPlaying } from '@shared/lyrics';
import type { MediaSessionSource, SmtcSample } from './smtc';
import type { CurrentlyPlaying, SpotifyTrack } from './spotify';

/**
 * Hybrid now playing. While the Windows media session (SMTC) shows Spotify, it
 * leads: track changes, play / pause, and seeks when its timeline reports one.
 * The Web API is only asked for exact checks: once per new song (its track id,
 * which the lyrics need, plus duration and exact position), when the audio
 * hints at a change the media session didn't explain ('sync'), and a drift
 * check every ~45 s while playing. Without Spotify in the media session the
 * host's adaptive polling takes over again. No Electron imports; timers are
 * the global ones (faked in tests).
 */

export const HYBRID = {
  /** Ask Spotify this long after the media session shows a new song (quick skips coalesce; the Web API catches up). */
  trackDelayMs: 400,
  /** The Web API still names the previous song: ask again after this, at most `idRetries` times. */
  idRetryMs: 1200,
  idRetries: 2,
  /** Publish a new song under a media-session id if Spotify hasn't named it by then. */
  idWaitMs: 3500,
  /** A song published from the media session is checked with Spotify this soon after (album art, exact length, better lyrics). */
  confirmMs: 8000,
  /** Exact-position check while playing... */
  driftMs: 45000,
  /** ...or this long after the song should have ended without the media session showing the next (repeat, a missed change)... */
  endGraceMs: 1500,
  /** ...but never sooner than this after a resume. */
  settleMs: 2000,
  /** A change heard in the audio waits this long for the media session to explain it... */
  syncDelayMs: 1000,
  /** ...is ignored this soon after a media-session event... */
  explainedMs: 3000,
  /** ...and at most one is checked per this long. */
  syncGapMs: 5000,
  /** Web API checks per rolling minute, whatever the reason. */
  perMinute: 6,
  /** A timeline updated at most this long before the sample is a new event. */
  freshMs: 3000,
  /** A fresh timeline this far from our position is a seek (the first one is confirmed with the Web API). */
  seekMs: 1500,
  /** Seeks the Web API contradicts before the timeline is ignored. */
  timelineStrikes: 2,
  /** Our own play / pause wins over a media session that still says otherwise for this long. */
  expectMs: 2500,
  /** Spotify gone from the media session (or no title) this long: back to polling. */
  goneMs: 3000,
  /** No sample at all for this long: the reader is dead, poll instead. */
  staleMs: 8000,
};

/** Track ids made from the media session (Spotify couldn't name the song in time). */
export const SMTC_ID_PREFIX = 'smtc:';

/** Identity of a media-session song. */
export function songKey(s: Pick<SmtcSample, 'title' | 'artist' | 'album'>): string {
  return [s.title, s.artist, s.album].join('\u0000');
}

/** Stable id for a song Spotify didn't name (also the lyrics cache key). */
export function smtcTrackId(key: string): string {
  return SMTC_ID_PREFIX + createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** Spotify's track is the media session's song: same title, and an artist in common when both name one. */
export function sameSong(a: { title: string; artists: string[] }, b: { title: string; artist: string }): boolean {
  const loose = (s: string): string => matchKey(normalizeTitle(s));
  const title = a.title.trim().toLowerCase() === b.title.trim().toLowerCase() || (matchKey(a.title) !== '' && matchKey(a.title) === matchKey(b.title)) || (loose(a.title) !== '' && loose(a.title) === loose(b.title));
  if (!title) return false;
  const artist = matchKey(b.artist);
  if (!artist || !a.artists.length) return true;
  return a.artists.some((name) => {
    const k = matchKey(name);
    return k !== '' && (artist.includes(k) || k.includes(artist));
  });
}

/** Song length from the timeline (0: none). */
export function smtcDuration(s: SmtcSample): number {
  const start = s.startMs ?? 0;
  return s.endMs !== null && s.endMs > start ? s.endMs - start : 0;
}

/** Song position (ms) at `at` from the timeline, or null without one. */
export function smtcPosition(s: SmtcSample, at: number): number | null {
  const d = smtcDuration(s);
  if (!d || s.positionMs === null || s.updatedEpochMs === null) return null;
  const p = s.positionMs - (s.startMs ?? 0) + (s.status === 'playing' ? Math.max(0, at - s.updatedEpochMs) : 0);
  return Math.min(d, Math.max(0, p));
}

/** The sample's own clock if it is sane, else ours. */
function sampleTime(s: SmtcSample, now: number): number {
  return Math.abs(s.sampleEpochMs - now) <= 2000 ? s.sampleEpochMs : now;
}

export interface HybridHost {
  now(): number;
  state(): NowPlaying;
  /** Merge into the published now playing (broadcast to both windows). */
  set(patch: Partial<NowPlaying>): void;
  /** The published song changed: lyrics lookup and album art (null: not a track). */
  track(t: SpotifyTrack | null): void;
  /** Album art for a song that Spotify confirmed after it was published. */
  art(trackId: string, images: SpotifyTrack['images']): void;
  /** Spotify's own metadata for a song published from the media session (a lyrics search that found nothing can retry). */
  refine?(t: SpotifyTrack): void;
  /** One Web API currently-playing request. */
  current(): Promise<CurrentlyPlaying>;
  /** No Web API requests before this (Retry-After). */
  limitedUntil(): number;
  /** Adaptive polling on (fallback) or off (the media session leads). */
  polling(on: boolean): void;
}

type Reason = 'sync' | 'drift' | 'track';
const RANK: Record<Reason, number> = { sync: 0, drift: 1, track: 2 };
const higher = (a: Reason | null, b: Reason): Reason => (a && RANK[a] >= RANK[b] ? a : b);

type TrackAnswer = Extract<CurrentlyPlaying, { kind: 'track' }>;
type OtherAnswer = Extract<CurrentlyPlaying, { kind: 'other' }>;

interface Song {
  key: string;
  /** Latest media-session sample for it. */
  sample: SmtcSample;
  /** When the media session first showed it; null if it was on before hybrid mode began. */
  seenAt: number | null;
  /** Published under `id` (null: not a track), or still waiting for Spotify to name it. */
  published: boolean;
  id: string | null;
  /** Spotify confirmed it (exact positions apply, art fetched). */
  confirmed: boolean;
  tries: number;
}

export class HybridNowPlaying {
  /** The media session leads (adaptive polling is off). */
  active = false;
  private running = false;
  private song: Song | null = null;
  /** The latest cover from the media session, for the song it belongs to. */
  private art: { key: string; url: string } | null = null;
  /** Id published before the current song (spots a Web API that still names the previous one). */
  private prevId: string | null = null;
  /** Last timeline stamp seen. */
  private stamp: number | null = null;
  /** Whether the app's timeline holds up: a seek it reports is checked with the Web API until one is confirmed. */
  private timelineTrust: 'unknown' | 'trusted' | 'ignored' = 'unknown';
  private strikes = 0;
  /** A timeline seek waiting for the Web API to confirm it. */
  private seek: { at: number; to: number; from: number; playing: boolean } | null = null;
  private goneSince: number | null = null;
  private lastSample = 0;
  private lastEvent = -Infinity;
  private lastCheck = -Infinity;
  private checks: number[] = [];
  private expected: { playing: boolean; until: number } | null = null;
  private pending: { at: number; reason: Reason; timer: ReturnType<typeof setTimeout> } | null = null;
  private busy = false;
  private again: Reason | null = null;
  private idTimer: ReturnType<typeof setTimeout> | null = null;
  private driftTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly host: HybridHost,
    private readonly source: MediaSessionSource,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastSample = this.host.now();
    this.goneSince = null;
    this.timelineTrust = 'unknown';
    this.strikes = 0;
    this.source.start((s) => this.onSample(s));
    this.watchdog = setInterval(() => {
      if (this.active && this.host.now() - this.lastSample > HYBRID.staleMs) this.leave(true);
    }, 1000);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.source.stop();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.leave(false);
  }

  /** The audio changed (a seek, skip or pause): ask Spotify soon, unless the media session explains it first. */
  sync(): void {
    if (!this.active || this.host.now() - this.lastEvent < HYBRID.explainedMs) return;
    this.request('sync', HYBRID.syncDelayMs);
  }

  /** Our own play / pause went out: a media session that hasn't caught up yet must not undo it. */
  expect(playing: boolean): void {
    if (!this.active) return;
    const now = this.host.now();
    this.expected = { playing, until: now + HYBRID.expectMs };
    this.event(now);
    this.armDrift();
  }

  private onSample(s: SmtcSample): void {
    if (!this.running) return;
    const now = this.host.now();
    this.lastSample = now;
    if (!s.ok || !s.app || !s.title) {
      // Spotify closed (or nothing loaded, or the reader died): poll instead, after a grace period.
      this.goneSince ??= now;
      if (this.active && now - this.goneSince >= HYBRID.goneMs) this.leave(true);
      return;
    }
    this.goneSince = null;
    if (!this.active) this.enter();
    const key = songKey(s);
    if (s.art) this.art = { key, url: s.art };
    if (!this.song || key !== this.song.key) this.newSong(s, key, now);
    else {
      this.song.sample = s;
      if (this.song.published) this.follow(s, now);
    }
    this.applyArt();
  }

  /** The media session's cover for the published song, until (or unless) Spotify's own arrives. */
  private applyArt(): void {
    const song = this.song;
    const st = this.host.state();
    if (!song?.published || !song.id || !this.art || this.art.key !== song.key || st.trackId !== song.id || st.artDataUrl) return;
    this.host.set({ artDataUrl: this.art.url });
  }

  private enter(): void {
    this.active = true;
    this.song = null;
    this.host.polling(false);
  }

  /** Hybrid mode off; back to adaptive polling unless stopping. */
  private leave(poll: boolean): void {
    for (const t of [this.idTimer, this.driftTimer, this.pending?.timer]) if (t) clearTimeout(t);
    this.idTimer = this.driftTimer = this.pending = null;
    this.song = null;
    this.expected = this.again = this.seek = null;
    const was = this.active;
    this.active = false;
    if (was && poll) this.host.polling(true);
  }

  private newSong(s: SmtcSample, key: string, now: number): void {
    const prev = this.song;
    const st = this.host.state();
    this.prevId = prev ? prev.id : st.trackId;
    for (const t of [this.idTimer, this.driftTimer]) if (t) clearTimeout(t);
    this.idTimer = this.driftTimer = null;
    this.expected = this.seek = null;
    this.stamp = s.updatedEpochMs;
    this.event(now);
    const song: Song = { key, sample: s, seenAt: prev ? sampleTime(s, now) : null, published: false, id: null, confirmed: false, tries: 0 };
    this.song = song;
    if (!prev && st.trackId && sameSong(st, s)) {
      // Hybrid mode began on the song polling already named: keep its id (the lyrics stay put).
      this.markPublished(song, st.trackId, !st.trackId.startsWith(SMTC_ID_PREFIX));
      this.follow(s, now);
      this.armDrift();
      return;
    }
    // Hold the song back until Spotify names it (one id per song, so lyrics load once).
    if (now < this.host.limitedUntil()) return this.publishSmtc(song);
    this.idTimer = setTimeout(() => {
      if (this.song === song && !song.published) this.publishSmtc(song);
    }, HYBRID.idWaitMs);
    this.request('track', HYBRID.trackDelayMs);
  }

  /** Play / pause and seeks of the published song. */
  private follow(s: SmtcSample, now: number): void {
    const st = this.host.state();
    const at = sampleTime(s, now);
    let timeline: number | null = null;
    if (s.updatedEpochMs !== null && s.updatedEpochMs !== this.stamp) {
      this.stamp = s.updatedEpochMs;
      const d = smtcDuration(s);
      // A new timeline event, for this song (same length as what we show).
      if (this.timelineTrust !== 'ignored' && at - s.updatedEpochMs <= HYBRID.freshMs && (!st.durationMs || !d || Math.abs(d - st.durationMs) <= 2500)) timeline = smtcPosition(s, at);
    }
    if (s.status === 'changing') return;
    const playing = s.status === 'playing';
    let confirmed = false;
    if (this.expected) {
      if (this.expected.playing !== playing && now < this.expected.until) return;
      confirmed = this.expected.playing === playing;
      this.expected = null;
    }
    const ours = positionAt(st, at);
    if (playing !== st.playing || (confirmed && timeline !== null)) {
      // Play / pause doesn't move the song: the timeline refines our position, but a far-off one isn't believed.
      this.event(now);
      this.host.set({ playing, progressMs: timeline !== null && Math.abs(timeline - ours) <= HYBRID.seekMs ? timeline : ours, sampleEpochMs: at });
      this.armDrift();
    } else if (timeline !== null && Math.abs(timeline - ours) > HYBRID.seekMs) {
      // A seek in Spotify: follow it at once; until the timeline has proved itself, the Web API confirms it.
      this.event(now);
      this.host.set({ progressMs: timeline, sampleEpochMs: at });
      if (this.timelineTrust === 'unknown') {
        // Where we were before the first unconfirmed seek: that's what a bogus timeline gets compared with.
        const k = this.seek;
        this.seek = { at, to: timeline, from: k ? k.from + (k.playing ? at - k.at : 0) : ours, playing };
        this.request('sync', HYBRID.syncDelayMs);
      }
      this.armDrift();
    }
  }

  /** The Web API's position after a timeline seek: the seek (trust the timeline) or where we were (a strike). */
  private judgeTimeline(r: TrackAnswer): void {
    const k = this.seek;
    if (!k || this.lastCheck < k.at) return;
    this.seek = null;
    const dt = k.playing ? r.sampleEpochMs - k.at : 0;
    if (Math.abs(r.progressMs - (k.to + dt)) <= HYBRID.seekMs) {
      this.timelineTrust = 'trusted';
      this.strikes = 0;
    } else if (Math.abs(r.progressMs - (k.from + dt)) <= HYBRID.seekMs && ++this.strikes >= HYBRID.timelineStrikes) this.timelineTrust = 'ignored';
  }

  /** The media session explained a change: an audio-triggered check waiting for it is moot. */
  private event(now: number): void {
    this.lastEvent = now;
    if (this.pending?.reason === 'sync') {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }

  private markPublished(song: Song, id: string | null, confirmed: boolean): void {
    Object.assign(song, { published: true, id, confirmed });
    if (this.idTimer) clearTimeout(this.idTimer);
    this.idTimer = null;
    if (this.pending?.reason === 'track') {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }

  /** Spotify named the song: publish it with Spotify's metadata and exact position. */
  private publishSong(song: Song, r: TrackAnswer): void {
    const playing = song.sample.status === 'changing' ? r.playing : song.sample.status === 'playing';
    this.markPublished(song, r.track.id, true);
    const t = r.track;
    this.host.set({ error: undefined, playing, trackId: t.id, title: t.title, artists: t.artists, album: t.album, artDataUrl: undefined, durationMs: t.durationMs, ...this.exact(r, t.durationMs, playing) });
    this.host.track(t);
    this.applyArt();
    this.armDrift();
  }

  /** A podcast, an ad or a local file: show it, no lyrics (as polling does). */
  private publishOther(song: Song, r: OtherAnswer): void {
    const playing = song.sample.status === 'changing' ? r.playing : song.sample.status === 'playing';
    this.markPublished(song, null, true);
    this.host.track(null);
    this.host.set({ error: undefined, playing, trackId: null, title: r.title || song.sample.title, artists: [], album: '', artDataUrl: undefined, durationMs: r.durationMs, ...this.exact(r, r.durationMs, playing) });
    this.armDrift();
  }

  /** Spotify can't name the song now (rate limited, unreachable, lagging): publish it from the media session. */
  private publishSmtc(song: Song): void {
    const s = song.sample;
    const now = this.host.now();
    const playing = s.status === 'playing';
    const durationMs = smtcDuration(s);
    const timeline = this.timelineTrust === 'ignored' ? null : smtcPosition(s, now);
    let progressMs = 0;
    // The timeline if it belongs to this song (updated around when it showed up), else time since it showed up.
    if (timeline !== null && (song.seenAt === null || (s.updatedEpochMs ?? 0) >= song.seenAt - HYBRID.freshMs)) progressMs = timeline;
    else if (song.seenAt !== null && playing) progressMs = Math.max(0, now - song.seenAt);
    if (durationMs) progressMs = Math.min(durationMs, progressMs);
    this.stamp = s.updatedEpochMs;
    const id = smtcTrackId(song.key);
    const track: SpotifyTrack = { id, title: s.title, artists: s.artist ? [s.artist] : [], album: s.album, durationMs, images: [] };
    this.markPublished(song, id, false);
    this.host.set({ playing, trackId: id, title: track.title, artists: track.artists, album: track.album, artDataUrl: undefined, durationMs, progressMs, sampleEpochMs: now });
    this.host.track(track);
    this.applyArt();
    this.armDrift();
    this.request('drift', HYBRID.confirmMs);
  }

  /** Spotify's sample as is, or re-anchored to now when it disagrees with the media session about playing. */
  private exact(r: { playing: boolean; progressMs: number; sampleEpochMs: number }, durationMs: number, playing: boolean): Pick<NowPlaying, 'progressMs' | 'sampleEpochMs'> {
    if (r.playing === playing) return { progressMs: r.progressMs, sampleEpochMs: r.sampleEpochMs };
    const now = this.host.now();
    return { progressMs: positionAt({ playing: r.playing, progressMs: r.progressMs, sampleEpochMs: r.sampleEpochMs, durationMs }, now), sampleEpochMs: now };
  }

  private onCheck(r: CurrentlyPlaying): void {
    const song = this.song;
    if (!song) return;
    if (r.kind === 'limited' || r.kind === 'error') {
      if (!song.published) this.publishSmtc(song);
      else this.armDrift();
      return;
    }
    const st = this.host.state();
    // Right after a skip the Web API may still name the previous song.
    const match = r.kind === 'track' && sameSong(r.track, song.sample) && (song.published || r.track.id !== this.prevId);
    if (!song.published) {
      if (r.kind === 'track' && match) return this.publishSong(song, r);
      if (r.kind === 'other') return this.publishOther(song, r);
      if (song.tries < HYBRID.idRetries) {
        song.tries++;
        this.request('track', HYBRID.idRetryMs);
      }
      // Otherwise the id timer publishes it under a media-session id.
      return;
    }
    if (r.kind === 'track' && match && song.id) {
      this.judgeTimeline(r);
      // Exact position and length; never a new id (the lyrics stay put). Skipped while the two disagree about playing.
      const patch: Partial<NowPlaying> = { error: undefined, durationMs: r.track.durationMs || st.durationMs };
      if (r.playing === st.playing) Object.assign(patch, { progressMs: r.progressMs, sampleEpochMs: r.sampleEpochMs });
      this.host.set(patch);
      if (!song.confirmed) {
        song.confirmed = true;
        this.host.art(song.id, r.track.images);
        if (song.id.startsWith(SMTC_ID_PREFIX)) this.host.refine?.({ ...r.track, id: song.id });
      }
    } else if (st.error) this.host.set({ error: undefined });
    this.armDrift();
  }

  /** Ask Spotify within the budget: coalesced, never before Retry-After. */
  private request(reason: Reason, delayMs = 0): void {
    if (!this.active) return;
    const now = this.host.now();
    let at = now + delayMs;
    if (reason === 'sync') at = Math.max(at, this.lastCheck + HYBRID.syncGapMs);
    at = Math.max(at, this.budgetAt(now), this.host.limitedUntil());
    const p = this.pending;
    const merged = higher(p?.reason ?? null, reason);
    if (p && p.at <= at) {
      p.reason = merged;
      return;
    }
    if (p) clearTimeout(p.timer);
    this.pending = { at, reason: merged, timer: setTimeout(() => void this.run(), at - now) };
  }

  /** When the next check fits in `perMinute`. */
  private budgetAt(now: number): number {
    this.checks = this.checks.filter((t) => now - t < 60000);
    return this.checks.length < HYBRID.perMinute ? now : this.checks[this.checks.length - HYBRID.perMinute] + 60000;
  }

  private async run(): Promise<void> {
    const p = this.pending;
    this.pending = null;
    if (!p || !this.active) return;
    if (this.busy) {
      this.again = higher(this.again, p.reason);
      return;
    }
    const now = this.host.now();
    if (now < this.host.limitedUntil()) return this.request(p.reason);
    this.busy = true;
    this.lastCheck = now;
    this.checks.push(now);
    let r: CurrentlyPlaying;
    try {
      r = await this.host.current();
    } catch {
      r = { kind: 'error', message: 'Spotify unreachable.' };
    } finally {
      this.busy = false;
    }
    if (!this.active) return;
    this.onCheck(r);
    const again = this.again;
    this.again = null;
    // A song that changed while the request was out still needs its own answer.
    if (again && !(again === 'track' && this.song?.published)) this.request(again);
  }

  /** The next drift check: ~45 s after the last check, or just after the song should end. */
  private armDrift(): void {
    if (this.driftTimer) clearTimeout(this.driftTimer);
    this.driftTimer = null;
    const st = this.host.state();
    if (!this.active || !this.song?.published || !st.playing) return;
    const now = this.host.now();
    const drift = (Number.isFinite(this.lastCheck) ? this.lastCheck : now) + HYBRID.driftMs;
    const end = st.durationMs > 0 ? now + Math.max(0, st.durationMs - positionAt(st, now)) + HYBRID.endGraceMs : Infinity;
    const at = Math.max(now + HYBRID.settleMs, Math.min(drift, end));
    this.driftTimer = setTimeout(() => {
      this.driftTimer = null;
      this.request('drift');
    }, at - now);
  }
}
