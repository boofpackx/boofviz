import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { positionAt, type NowPlaying } from '@shared/lyrics';
import { HYBRID, SMTC_ID_PREFIX, sameSong, smtcDuration, smtcPosition, smtcTrackId, songKey } from '../src/main/hybrid';
import { createMediaSource, HttpSmtcSource, parseSmtcSample, PowerShellSmtcSource, SMTC_SCRIPT, type MediaSessionSource, type SmtcSample } from '../src/main/smtc';
import { POLL, SpotifyClient, type TokenStore } from '../src/main/spotify';

// All titles and names below are invented placeholders.

const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
const CP = '/v1/me/player/currently-playing';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function smtc(p: Partial<SmtcSample> = {}): SmtcSample {
  return { ok: true, app: 'Spotify.exe', title: 'Paper Lanterns', artist: 'The Placeholders', album: 'Invented', status: 'playing', positionMs: null, startMs: null, endMs: null, updatedEpochMs: null, sampleEpochMs: Date.now(), ...p };
}

class FakeSource implements MediaSessionSource {
  cb: ((s: SmtcSample) => void) | null = null;
  starts = 0;
  stops = 0;
  start(cb: (s: SmtcSample) => void): void {
    this.cb = cb;
    this.starts++;
  }
  stop(): void {
    this.cb = null;
    this.stops++;
  }
  commands: string[] = [];
  command(cmd: string): boolean {
    this.commands.push(cmd);
    return true;
  }
}

interface FakeTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
}
const LANTERNS: FakeTrack = { id: 'abc', name: 'Paper Lanterns', artist: 'The Placeholders', album: 'Invented', durationMs: 201000 };
const INTERLUDE: FakeTrack = { id: 'def', name: 'Quiet Interlude', artist: 'Nobody In Particular', album: 'Blank Tapes', durationMs: 120000 };
const asSmtc = (t: FakeTrack, p: Partial<SmtcSample> = {}): Partial<SmtcSample> => ({ title: t.name, artist: t.artist, album: t.album, ...p });

/** A connected client with a fake media session, a fake Web API (progress runs in fake time) and fake timers. */
async function setup(o: { loggedIn?: boolean } = {}) {
  const api = { track: LANTERNS, playing: true, anchor: 42000, at: Date.now(), status: 200, retryAfter: '30' };
  const progress = (): number => Math.min(api.track.durationMs, api.anchor + (api.playing ? Date.now() - api.at : 0));
  const reanchor = (patch: Partial<typeof api>): void => void Object.assign(api, { anchor: progress(), at: Date.now() }, patch);
  const calls: Array<{ path: string; at: number }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, at: Date.now() });
    if (url.pathname === '/api/token') return json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 });
    if (url.pathname === CP) {
      if (api.status === 429) return json({}, 429, { 'Retry-After': api.retryAfter });
      const t = api.track;
      return json({ is_playing: api.playing, progress_ms: progress(), currently_playing_type: 'track', item: { id: t.id, name: t.name, duration_ms: t.durationMs, artists: [{ name: t.artist }], album: { name: t.album, images: [{ url: `http://img.test/${t.id}.png`, width: 300, height: 300 }] } } });
    }
    if (url.pathname === '/v1/me/player/pause' && init.method === 'PUT') return reanchor({ playing: false }), new Response(null, { status: 204 });
    if (url.pathname === '/v1/me/player/play' && init.method === 'PUT') return reanchor({ playing: true }), new Response(null, { status: 204 });
    if (url.pathname === '/v1/me/player/next') return Object.assign(api, { track: INTERLUDE, anchor: 0, at: Date.now(), playing: true }), new Response(null, { status: 204 });
    if (url.pathname.endsWith('.png')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  const tokens: TokenStore = { load: () => (o.loggedIn === false ? null : 'rt'), save: () => undefined, clear: () => undefined };
  const src = new FakeSource();
  const tracks: Array<string | null> = [];
  const published: NowPlaying[] = [];
  const c = new SpotifyClient({
    fetch: fetchFn,
    now: () => Date.now(),
    accountsUrl: 'http://accounts.test',
    apiUrl: 'http://api.test/v1',
    clientId: () => 'cid',
    tokens,
    openExternal: async () => undefined,
    publish: (s) => published.push(s),
    onTrack: (t) => tracks.push(t?.id ?? null),
    media: src,
  });
  /** What the media session shows now (re-sent every 500 ms, like the reader's heartbeat). */
  let shown: Partial<SmtcSample> = asSmtc(LANTERNS);
  const show = (p: Partial<SmtcSample>): void => {
    shown = p;
    src.cb?.(smtc(shown));
  };
  const play = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 500) {
      src.cb?.(smtc(shown));
      await vi.advanceTimersByTimeAsync(Math.min(500, ms - t));
    }
  };
  const cp = (): number => calls.filter((x) => x.path === CP).length;
  c.start();
  await vi.advanceTimersByTimeAsync(0);
  return { c, api, progress, reanchor, calls, cp, src, tracks, published, show, play, get shown() { return shown; } };
}

/** Connected, polled once, then the media session shows the same song: hybrid mode on. */
async function hybrid() {
  const h = await setup();
  h.show(asSmtc(LANTERNS));
  expect(h.c.hybridActive).toBe(true);
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('no login: following the player through Windows alone', () => {
  it('publishes the song from the media session with no Spotify login and never calls the Web API', async () => {
    const h = await setup({ loggedIn: false });
    expect(h.c.state.connected).toBe(false);
    h.show(asSmtc(LANTERNS, { startMs: 0, endMs: 201000, positionMs: 5000, updatedEpochMs: Date.now(), art: 'data:image/jpeg;base64,AAAA' }));
    expect(h.c.state).toMatchObject({ connected: true, source: 'media', player: 'Spotify', title: 'Paper Lanterns', artists: ['The Placeholders'], durationMs: 201000, playing: true, artDataUrl: 'data:image/jpeg;base64,AAAA' });
    await h.play(60000);
    expect(h.calls).toHaveLength(0);
    // Another player, playing: followed the same way (and named).
    h.show({ app: 'chrome.exe', title: 'Quiet Interlude', artist: 'Nobody In Particular', status: 'playing' });
    expect(h.c.state).toMatchObject({ title: 'Quiet Interlude', player: 'Chrome', source: 'media' });
    // Playback through Windows: no Premium, no Web API.
    expect(await h.c.control('pause')).toBeNull();
    expect(h.src.commands).toEqual(['pause']);
    expect(h.calls).toHaveLength(0);
    h.c.dispose();
  });

  it('logged in, a player other than Spotify is still never looked up in the Web API', async () => {
    const h = await hybrid();
    const before = h.cp();
    h.show({ app: 'chrome.exe', title: 'Quiet Interlude', artist: 'Nobody In Particular', status: 'playing' });
    await h.play(HYBRID.driftMs + 5000);
    expect(h.c.state).toMatchObject({ title: 'Quiet Interlude', player: 'Chrome' });
    expect(h.cp()).toBe(before);
    h.c.dispose();
  });
});

describe('hybrid now playing: the media session leads', () => {
  it('takes over from polling when Spotify shows up, keeping the polled song (one lyrics load)', async () => {
    const h = await setup();
    expect(h.cp()).toBe(1);
    expect(h.c.state).toMatchObject({ trackId: 'abc', playing: true });
    expect(h.c.hybridActive).toBe(false);
    h.show(asSmtc(LANTERNS));
    expect(h.c.hybridActive).toBe(true);
    await h.play(40000);
    // No polling (it would have asked ~10 times by now) and no check before the drift check.
    expect(h.cp()).toBe(1);
    expect(h.tracks).toEqual(['abc']);
    expect(Math.abs(positionAt(h.c.state, Date.now()) - h.progress())).toBeLessThan(5);
    h.c.dispose();
    expect(h.src.stops).toBe(1);
  });

  it('holds a new song until one Web API call names it, then publishes it once with the exact position', async () => {
    const h = await hybrid();
    await h.play(5000);
    Object.assign(h.api, { track: INTERLUDE, anchor: 0, at: Date.now() });
    h.show(asSmtc(INTERLUDE));
    // Held back: still the previous song, no SMTC-made id.
    expect(h.c.state.trackId).toBe('abc');
    await vi.advanceTimersByTimeAsync(HYBRID.trackDelayMs - 1);
    expect(h.cp()).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(h.cp()).toBe(2);
    expect(h.c.state).toMatchObject({ trackId: 'def', title: 'Quiet Interlude', artists: ['Nobody In Particular'], durationMs: 120000, playing: true });
    expect(Math.abs(positionAt(h.c.state, Date.now()) - h.progress())).toBeLessThan(5);
    await h.play(30000);
    expect(h.cp()).toBe(2);
    expect(h.tracks).toEqual(['abc', 'def']);
    expect(h.published.some((s) => s.trackId?.startsWith(SMTC_ID_PREFIX))).toBe(false);
    h.c.dispose();
  });

  it('quick skips coalesce into one call', async () => {
    const h = await hybrid();
    await h.play(5000);
    h.show(asSmtc({ ...LANTERNS, name: 'Skipped Past' }));
    await vi.advanceTimersByTimeAsync(150);
    h.show(asSmtc({ ...LANTERNS, name: 'Also Skipped' }));
    await vi.advanceTimersByTimeAsync(150);
    Object.assign(h.api, { track: INTERLUDE, anchor: 0, at: Date.now() });
    h.show(asSmtc(INTERLUDE));
    await h.play(3000);
    expect(h.cp()).toBe(2);
    expect(h.tracks).toEqual(['abc', 'def']);
    h.c.dispose();
  });

  it('when the Web API lags it retries, then publishes under an SMTC id that never flips to the Spotify id', async () => {
    const h = await hybrid();
    await h.play(5000);
    // The media session moves on; the Web API still names the previous song.
    h.show(asSmtc(INTERLUDE, { endMs: 120000, startMs: 0, positionMs: 0, updatedEpochMs: Date.now() }));
    await h.play(HYBRID.idWaitMs + 100);
    expect(h.cp()).toBe(1 + 1 + HYBRID.idRetries);
    const id = smtcTrackId(songKey(smtc(asSmtc(INTERLUDE))));
    expect(h.c.state).toMatchObject({ trackId: id, title: 'Quiet Interlude', artists: ['Nobody In Particular'], album: 'Blank Tapes', durationMs: 120000, playing: true });
    expect(positionAt(h.c.state, Date.now())).toBeGreaterThan(3000);
    expect(positionAt(h.c.state, Date.now())).toBeLessThan(4200);
    // Spotify catches up; a check soon after confirms the song: exact position and art, same id.
    Object.assign(h.api, { track: INTERLUDE, anchor: 9000, at: Date.now() });
    await h.play(HYBRID.confirmMs);
    expect(h.cp()).toBe(5);
    expect(h.c.state.trackId).toBe(id);
    expect(h.c.state.artDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Math.abs(positionAt(h.c.state, Date.now()) - h.progress())).toBeLessThan(5);
    expect(h.tracks).toEqual(['abc', id]);
    h.c.dispose();
  });

  it('rate limited: no request before Retry-After; new songs are published from the media session at once', async () => {
    const h = await hybrid();
    await h.play(5000);
    h.api.status = 429;
    h.api.retryAfter = '30';
    h.show(asSmtc(INTERLUDE, { startMs: 0, endMs: 120000, positionMs: 0, updatedEpochMs: Date.now() }));
    await vi.advanceTimersByTimeAsync(HYBRID.trackDelayMs + 1);
    expect(h.cp()).toBe(2);
    expect(h.c.state.trackId).toBe(smtcTrackId(songKey(smtc(asSmtc(INTERLUDE)))));
    expect(h.c.state.error).toMatch(/slow down; checking again in 30 s\. Lyrics keep running\./);
    // The next song inside the Retry-After: published straight away, no request.
    await h.play(10000);
    const other = { ...LANTERNS, name: 'Borrowed Coin' };
    h.show(asSmtc(other, { startMs: 0, endMs: 150000, positionMs: 0, updatedEpochMs: Date.now() }));
    expect(h.c.state).toMatchObject({ trackId: smtcTrackId(songKey(smtc(asSmtc(other)))), title: 'Borrowed Coin', durationMs: 150000 });
    await h.play(15000);
    expect(h.cp()).toBe(2);
    expect(h.tracks).toEqual(['abc', smtcTrackId(songKey(smtc(asSmtc(INTERLUDE)))), smtcTrackId(songKey(smtc(asSmtc(other))))]);
    h.c.dispose();
  });

  it("shows the media session's cover at once when Spotify can't answer, and Spotify's own once it does", async () => {
    const h = await hybrid();
    await h.play(5000);
    h.api.status = 429;
    h.api.retryAfter = '30';
    const cover = 'data:image/jpeg;base64,AAAA';
    h.show(asSmtc(INTERLUDE, { startMs: 0, endMs: 120000, positionMs: 0, updatedEpochMs: Date.now() }));
    await vi.advanceTimersByTimeAsync(HYBRID.trackDelayMs + 1);
    expect(h.c.state.trackId).toBe(smtcTrackId(songKey(smtc(asSmtc(INTERLUDE)))));
    expect(h.c.state.artDataUrl).toBeUndefined();
    // The reader sends the cover a moment later, once.
    h.show(asSmtc(INTERLUDE, { startMs: 0, endMs: 120000, positionMs: 0, updatedEpochMs: Date.now(), art: cover }));
    expect(h.c.state.artDataUrl).toBe(cover);
    // Later samples (no cover) keep it.
    h.show(asSmtc(INTERLUDE, { startMs: 0, endMs: 120000, positionMs: 0, updatedEpochMs: Date.now() }));
    expect(h.c.state.artDataUrl).toBe(cover);
    // Spotify answers again and confirms the song: its (bigger) cover replaces the media session's.
    Object.assign(h.api, { status: 200, track: INTERLUDE, anchor: 9000, at: Date.now() });
    await h.play(40000);
    expect(h.c.state.artDataUrl).toMatch(/^data:image\/png;base64,/);
    h.c.dispose();
  });

  it('follows play, pause and seeks from the media session; only the first seek is confirmed with the Web API', async () => {
    const h = await hybrid();
    await h.play(3000);
    const base = asSmtc(LANTERNS, { startMs: 0, endMs: 201000 });
    // Paused in Spotify: its fresh timeline gives the exact spot.
    h.reanchor({ playing: false });
    const p = Math.round(h.progress());
    h.show({ ...base, status: 'paused', positionMs: p - 120, updatedEpochMs: Date.now() - 120 });
    expect(h.c.state).toMatchObject({ playing: false, progressMs: p - 120 });
    await h.play(5000);
    expect(positionAt(h.c.state, Date.now())).toBe(p - 120);
    // Resumed.
    h.reanchor({ playing: true, anchor: p - 120 });
    h.show({ ...base, status: 'playing', positionMs: p - 120, updatedEpochMs: Date.now() });
    expect(h.c.state.playing).toBe(true);
    await h.play(2000);
    expect(Math.abs(positionAt(h.c.state, Date.now()) - (p - 120 + 2000))).toBeLessThan(5);
    expect(h.cp()).toBe(1);
    // A seek in Spotify: followed at once, then one check confirms the timeline can be trusted.
    h.reanchor({ anchor: 120000 });
    h.show({ ...base, positionMs: 120000, updatedEpochMs: Date.now() });
    expect(Math.abs(positionAt(h.c.state, Date.now()) - 120000)).toBeLessThan(5);
    await h.play(1500);
    expect(h.cp()).toBe(2);
    // Later seeks cost nothing; small differences don't make the position jitter; old timelines are ignored.
    h.reanchor({ anchor: 30000 });
    h.show({ ...base, positionMs: 30000, updatedEpochMs: Date.now() });
    expect(Math.abs(positionAt(h.c.state, Date.now()) - 30000)).toBeLessThan(5);
    h.show({ ...base, positionMs: 30400, updatedEpochMs: Date.now() });
    h.show({ ...base, positionMs: 10000, updatedEpochMs: Date.now() - 60000 });
    expect(Math.abs(positionAt(h.c.state, Date.now()) - 30000)).toBeLessThan(5);
    await h.play(6000);
    expect(h.cp()).toBe(2);
    // Without a timeline a pause freezes the extrapolated position; a far-off timeline at a pause isn't believed.
    h.show(asSmtc(LANTERNS, { status: 'paused' }));
    expect(h.c.state.playing).toBe(false);
    expect(Math.abs(h.c.state.progressMs - 36000)).toBeLessThan(5);
    h.show({ ...base, status: 'playing', positionMs: 0, updatedEpochMs: Date.now() });
    expect(h.c.state.playing).toBe(true);
    expect(Math.abs(h.c.state.progressMs - 36000)).toBeLessThan(5);
    h.c.dispose();
  });

  it('stops believing a media-session timeline that the Web API keeps contradicting', async () => {
    const h = await hybrid();
    await h.play(6000);
    // An app that keeps stamping its timeline with a stuck position.
    const stuck = (): void => h.show(asSmtc(LANTERNS, { startMs: 0, endMs: 201000, positionMs: 0, updatedEpochMs: Date.now() }));
    for (let i = 0; i < 10; i++) {
      stuck();
      await h.play(1000);
    }
    expect(Math.abs(positionAt(h.c.state, Date.now()) - h.progress())).toBeLessThan(5);
    expect(h.cp()).toBe(1 + HYBRID.timelineStrikes);
    for (let i = 0; i < 20; i++) {
      stuck();
      await h.play(1000);
    }
    expect(Math.abs(positionAt(h.c.state, Date.now()) - h.progress())).toBeLessThan(5);
    expect(h.cp()).toBe(1 + HYBRID.timelineStrikes);
    h.c.dispose();
  });

  it('checks for drift every ~45 s while playing, never while paused', async () => {
    const h = await hybrid();
    await h.play(HYBRID.driftMs - 500);
    expect(h.cp()).toBe(1);
    // Spotify's clock drifted from ours by 700 ms: the check corrects it.
    h.reanchor({ anchor: h.progress() + 700 });
    await h.play(1000);
    expect(h.cp()).toBe(2);
    expect(Math.abs(positionAt(h.c.state, Date.now()) - h.progress())).toBeLessThan(5);
    await h.play(HYBRID.driftMs);
    expect(h.cp()).toBe(3);
    h.reanchor({ playing: false });
    h.show(asSmtc(LANTERNS, { status: 'paused' }));
    await h.play(120000);
    expect(h.cp()).toBe(3);
    h.c.dispose();
  });

  it('checks just after the song should have ended if the media session shows no next song (repeat one)', async () => {
    const h = await hybrid();
    await h.play(3000);
    h.show(asSmtc(LANTERNS, { startMs: 0, endMs: 201000, positionMs: 195000, updatedEpochMs: Date.now() }));
    h.reanchor({ anchor: 195000 });
    await h.play(6000);
    expect(h.cp()).toBe(2); // the first seek is confirmed
    // Spotify starts the song again; the media session shows no change.
    h.reanchor({ anchor: 0 });
    await h.play(1000);
    expect(h.cp()).toBe(2);
    await h.play(1000);
    expect(h.cp()).toBe(3);
    expect(positionAt(h.c.state, Date.now())).toBeLessThan(3000);
    expect(h.tracks).toEqual(['abc']);
    h.c.dispose();
  });

  it('asks on an audio-heard change unless the media session explained it, debounced and within budget', async () => {
    const h = await hybrid();
    await h.play(5000);
    await h.c.control('sync');
    await h.play(HYBRID.syncDelayMs - 100);
    expect(h.cp()).toBe(1);
    await h.c.control('sync'); // coalesces with the first
    await h.play(500);
    expect(h.cp()).toBe(2);
    // A pause the media session reports: the audio's 'sync' a moment later is already explained.
    h.show(asSmtc(LANTERNS, { status: 'paused' }));
    await h.play(800);
    await h.c.control('sync');
    await h.play(5000);
    expect(h.cp()).toBe(2);
    // A 'sync' waiting for its delay is dropped when the media session explains it meanwhile.
    await h.c.control('sync');
    await vi.advanceTimersByTimeAsync(300);
    h.show(asSmtc(LANTERNS, { status: 'playing' }));
    await h.play(3000);
    expect(h.cp()).toBe(2);
    // However choppy the audio, never more than the budget per minute.
    const before = h.cp();
    for (let i = 0; i < 30; i++) {
      await h.c.control('sync');
      await h.play(2000);
    }
    expect(h.cp() - before).toBeLessThanOrEqual(HYBRID.perMinute);
    h.c.dispose();
  });

  it("our own pause isn't undone by a media session that hasn't caught up, and needs no follow-up poll", async () => {
    const h = await hybrid();
    await h.play(5000);
    expect(await h.c.control('pause')).toBeNull();
    expect(h.c.state.playing).toBe(false);
    const frozen = h.c.state.progressMs;
    await h.play(1000); // still says 'playing'
    expect(h.c.state.playing).toBe(false);
    h.show(asSmtc(LANTERNS, { status: 'paused' }));
    await h.play(3000);
    expect(h.c.state).toMatchObject({ playing: false, progressMs: frozen });
    expect(await h.c.control('play')).toBeNull();
    h.show(asSmtc(LANTERNS, { status: 'playing' }));
    await h.play(1000);
    expect(h.c.state.playing).toBe(true);
    expect(h.cp()).toBe(1);
    // Sent through Windows, not the Web API (no Premium needed).
    expect(h.src.commands).toEqual(['pause', 'play']);
    expect(h.calls.filter((x) => x.path.startsWith('/v1/me/player/p'))).toHaveLength(0);
    // Next (through Windows): the player skips, the media session shows the new song, which costs one call.
    expect(await h.c.control('next')).toBeNull();
    expect(h.src.commands.at(-1)).toBe('next');
    Object.assign(h.api, { track: INTERLUDE, anchor: 0, at: Date.now(), playing: true });
    h.show(asSmtc(INTERLUDE));
    await h.play(3000);
    expect(h.c.state.trackId).toBe('def');
    expect(h.cp()).toBe(2);
    h.c.dispose();
  });

  it('falls back to polling when Spotify leaves the media session or the reader dies, and comes back', async () => {
    const h = await hybrid();
    await h.play(5000);
    // Spotify closed: no session for a few seconds.
    h.show({ app: null, title: '' });
    await h.play(HYBRID.goneMs - 600);
    expect(h.c.hybridActive).toBe(true);
    await h.play(1500);
    expect(h.c.hybridActive).toBe(false);
    const fellBack = h.cp();
    expect(fellBack).toBe(2); // polls at once
    await h.play(12000);
    expect(h.cp() - fellBack).toBeGreaterThanOrEqual(Math.floor(12000 / POLL.playing));
    // Reopened: hybrid again, polling stops, same song and id.
    h.show(asSmtc(LANTERNS));
    expect(h.c.hybridActive).toBe(true);
    const back = h.cp();
    await h.play(30000);
    expect(h.cp()).toBe(back);
    expect(h.tracks).toEqual(['abc']);
    // The reader goes silent: polling after a few seconds.
    await vi.advanceTimersByTimeAsync(HYBRID.staleMs + 1500);
    expect(h.c.hybridActive).toBe(false);
    expect(h.cp()).toBeGreaterThan(back);
    h.c.dispose();
  });

  it("falling back during a Retry-After waits it out, and keeps an SMTC id for the same song", async () => {
    const h = await hybrid();
    await h.play(5000);
    h.api.status = 429;
    h.api.retryAfter = '30';
    h.show(asSmtc(INTERLUDE, { startMs: 0, endMs: 120000, positionMs: 0, updatedEpochMs: Date.now() }));
    await h.play(1000);
    const id = smtcTrackId(songKey(smtc(asSmtc(INTERLUDE))));
    expect(h.c.state.trackId).toBe(id);
    const limitedAt = h.calls.filter((x) => x.path === CP).at(-1)!.at;
    h.api.status = 200;
    Object.assign(h.api, { track: INTERLUDE, anchor: 1000, at: Date.now() });
    // Spotify leaves the media session: polling resumes, but not before the Retry-After.
    h.show({ app: null, title: '' });
    await h.play(5000);
    expect(h.c.hybridActive).toBe(false);
    expect(h.cp()).toBe(2);
    await h.play(30000);
    const polls = h.calls.filter((x) => x.path === CP).slice(2);
    expect(polls.length).toBeGreaterThan(0);
    expect(polls[0].at - limitedAt).toBeGreaterThanOrEqual(30000);
    // Same song: it keeps its SMTC id, no second lyrics load.
    expect(h.c.state.trackId).toBe(id);
    expect(h.tracks).toEqual(['abc', id]);
    h.c.dispose();
  });

  it('stops the media session reader on disconnect', async () => {
    const h = await hybrid();
    h.c.disconnect();
    expect(h.src.stops).toBe(1);
    expect(h.c.hybridActive).toBe(false);
    const n = h.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.calls.length).toBe(n);
  });
});

describe('hybrid helpers', () => {
  it('matches Spotify tracks to media-session songs loosely', () => {
    expect(sameSong({ title: 'Paper Lanterns - 2011 Remaster', artists: ['The Placeholders'] }, { title: 'Paper Lanterns - 2011 Remaster', artist: 'The Placeholders' })).toBe(true);
    expect(sameSong({ title: 'Paper Lanterns (feat. Someone)', artists: ['The Placeholders', 'Someone'] }, { title: 'Paper Lanterns', artist: 'The Placeholders, Someone' })).toBe(true);
    expect(sameSong({ title: 'Paper Lanterns', artists: ['The Placeholders'] }, { title: 'Paper Lanterns', artist: '' })).toBe(true);
    expect(sameSong({ title: 'Paper Lanterns', artists: ['Other Band'] }, { title: 'Paper Lanterns', artist: 'The Placeholders' })).toBe(false);
    expect(sameSong({ title: 'Quiet Interlude', artists: ['The Placeholders'] }, { title: 'Paper Lanterns', artist: 'The Placeholders' })).toBe(false);
    expect(sameSong({ title: 'Бумажные фонари', artists: ['Группа'] }, { title: 'Бумажные Фонари', artist: 'Группа' })).toBe(true);
  });

  it('reads position and length from the timeline', () => {
    const s = smtc({ positionMs: 30000, startMs: 0, endMs: 180000, updatedEpochMs: T0 });
    expect(smtcDuration(s)).toBe(180000);
    expect(smtcPosition(s, T0 + 2500)).toBe(32500);
    expect(smtcPosition({ ...s, status: 'paused' }, T0 + 2500)).toBe(30000);
    expect(smtcPosition({ ...s, positionMs: 179000 }, T0 + 5000)).toBe(180000);
    expect(smtcPosition(smtc(), T0)).toBeNull();
    expect(smtcDuration(smtc({ startMs: 0, endMs: 0 }))).toBe(0);
  });

  it('makes stable ids per song', () => {
    const a = smtcTrackId(songKey({ title: 'Paper Lanterns', artist: 'The Placeholders', album: 'Invented' }));
    expect(a).toMatch(/^smtc:[0-9a-f]{16}$/);
    expect(smtcTrackId(songKey({ title: 'Paper Lanterns', artist: 'The Placeholders', album: 'Invented' }))).toBe(a);
    expect(smtcTrackId(songKey({ title: 'Paper Lanterns', artist: 'The Placeholders', album: 'Live' }))).not.toBe(a);
  });

  it('parses reader lines: status names, Spotify sessions only, failures', () => {
    const line = { ok: true, app: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify', title: ' Paper Lanterns ', artist: 'The Placeholders', album: 'Invented', status: 'Paused', positionMs: 1000, startMs: 0, endMs: 180000, updatedEpochMs: T0, sampleEpochMs: T0 + 5 };
    expect(parseSmtcSample(line, 0)).toEqual({ ...line, title: 'Paper Lanterns', status: 'paused', sampleEpochMs: T0 + 5 });
    expect(parseSmtcSample({ ...line, status: 'changing' }, 0)?.status).toBe('changing');
    expect(parseSmtcSample({ ...line, art: 'data:image/jpeg;base64,QUJD' }, 0)?.art).toBe('data:image/jpeg;base64,QUJD');
    expect(parseSmtcSample({ ...line, art: 'javascript:alert(1)' }, 0)?.art).toBeUndefined();
    expect(parseSmtcSample({ ...line, status: 'Closed' }, 0)?.status).toBe('stopped');
    expect(parseSmtcSample({ ...line, status: '4' }, 0)?.status).toBe('playing');
    // Any player is followed; browser titles like "Artist - Title (Official Video)" are split and tidied.
    expect(parseSmtcSample({ ...line, app: 'chrome.exe', title: 'The Placeholders - Paper Lanterns (Official Video)', artist: 'ThePlaceholdersVEVO' }, 0)).toMatchObject({ app: 'chrome.exe', title: 'Paper Lanterns', artist: 'The Placeholders' });
    expect(parseSmtcSample({ ...line, app: 'TIDAL.exe', title: 'Night Bus', artist: 'Ann' }, 0)).toMatchObject({ title: 'Night Bus', artist: 'Ann' });
    expect(parseSmtcSample({ ...line, positionMs: 'soon' }, 0)?.positionMs).toBeNull();
    expect(parseSmtcSample({ ok: false, fatal: true, error: 'no WinRT' }, 7)).toMatchObject({ ok: false, app: null, sampleEpochMs: 7 });
    expect(parseSmtcSample('nope', 0)).toBeNull();
  });

  it('picks a source: the URL in tests, PowerShell on Windows only', () => {
    const base = { scriptPath: '/tmp/x.ps1', fetch: (async () => new Response()) as typeof fetch, now: () => 0 };
    expect(createMediaSource({ ...base, platform: 'linux', env: {} })).toBeNull();
    expect(createMediaSource({ ...base, platform: 'linux', env: { BOOFVIZ_SMTC_URL: 'http://127.0.0.1:1/smtc' } })).toBeInstanceOf(HttpSmtcSource);
    expect(createMediaSource({ ...base, platform: 'win32', env: {} })).toBeInstanceOf(PowerShellSmtcSource);
    expect(createMediaSource({ ...base, platform: 'win32', env: { BOOFVIZ_SMTC: 'off' } })).toBeNull();
  });
});

describe('media session readers', () => {
  it('the PowerShell script is plain ASCII and uses the WinRT session manager', () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(SMTC_SCRIPT)).toBe(true);
    for (const s of ['GlobalSystemMediaTransportControlsSessionManager', 'ContentType = WindowsRuntime', 'AsTask', 'GetTimelineProperties', 'LastUpdatedTime', "-match 'spotify'", 'HasExited']) expect(SMTC_SCRIPT).toContain(s);
  });

  class FakeChild extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    killed = false;
    kill(): boolean {
      this.killed = true;
      setTimeout(() => this.emit('close', null), 0);
      return true;
    }
  }

  function powershell() {
    const children: FakeChild[] = [];
    const spawns: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
    const samples: SmtcSample[] = [];
    const src = new PowerShellSmtcSource({
      scriptPath: 'C:\\Users\\x\\AppData\\Roaming\\BOOFVIZ\\smtc.ps1',
      now: () => Date.now(),
      writeScript: () => undefined,
      log: () => undefined,
      spawn: ((cmd: string, args: string[], opts: Record<string, unknown>) => {
        spawns.push({ cmd, args, opts });
        const child = new FakeChild();
        children.push(child);
        return child;
      }) as unknown as typeof import('node:child_process').spawn,
    });
    src.start((s) => samples.push(s));
    return { src, children, spawns, samples };
  }

  it('runs one hidden Windows PowerShell and reads its JSON lines', async () => {
    const p = powershell();
    expect(p.spawns).toHaveLength(1);
    expect(p.spawns[0].cmd).toMatch(/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
    expect(p.spawns[0].args.slice(0, 6)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\Users\\x\\AppData\\Roaming\\BOOFVIZ\\smtc.ps1']);
    expect(p.spawns[0].args.slice(6)).toEqual(['-ParentPid', String(process.pid)]);
    expect(p.spawns[0].opts).toMatchObject({ windowsHide: true });
    p.children[0].stdout.write('{"ok":true,"app":"Spotify.exe","title":"Paper Lanterns","artist":"The Placeholders","album":"Invented","status":"playing","positionMs":null,"startMs":null,"endMs":null,"updatedEpochMs":null,"sampleEpochMs":5}\nnot json\n{"ok":true,"app":"Spotify.exe","title":"B\\u00e4r","status":"paused","sampleEpochMs":6}\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(p.samples.map((s) => [s.title, s.status])).toEqual([
      ['Paper Lanterns', 'playing'],
      ['Bär', 'paused'],
    ]);
    p.src.stop();
    expect(p.children[0].killed).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(p.spawns).toHaveLength(1);
  });

  it('restarts a reader that died, with backoff, and kills a hung one', async () => {
    const p = powershell();
    p.children[0].emit('close', 1);
    expect(p.samples.at(-1)?.ok).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(p.spawns).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.spawns).toHaveLength(2);
    p.children[1].emit('close', 1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(p.spawns).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.spawns).toHaveLength(3);
    // Silent for too long: killed, and restarted after the next backoff step.
    await vi.advanceTimersByTimeAsync(12000);
    expect(p.children[2].killed).toBe(true);
    expect(p.spawns).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(p.spawns).toHaveLength(4);
    // A good line resets the backoff.
    p.children[3].stdout.write('{"ok":true,"app":"Spotify.exe","title":"Paper Lanterns","status":"playing","sampleEpochMs":1}\n');
    await vi.advanceTimersByTimeAsync(0);
    p.children[3].emit('close', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.spawns).toHaveLength(5);
    p.src.stop();
  });

  it('gives up when WinRT media sessions are missing', async () => {
    const p = powershell();
    p.children[0].stdout.write('{"ok":false,"fatal":true,"error":"Unable to find type","sampleEpochMs":1}\n');
    await vi.advanceTimersByTimeAsync(0);
    p.children[0].emit('close', 2);
    await vi.advanceTimersByTimeAsync(120000);
    expect(p.spawns).toHaveLength(1);
    expect(p.samples.every((s) => !s.ok)).toBe(true);
    p.src.stop();
  });

  it('gives up on a reader that never says anything (e.g. scripts blocked by policy)', async () => {
    const p = powershell();
    for (let i = 0; i < 12; i++) {
      p.children.at(-1)!.emit('close', 1);
      await vi.advanceTimersByTimeAsync(61000);
    }
    expect(p.spawns).toHaveLength(9);
    p.src.stop();
  });

  it('a missing powershell.exe is not retried', async () => {
    const p = powershell();
    p.children[0].emit('error', Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }));
    p.children[0].emit('close', -2);
    await vi.advanceTimersByTimeAsync(120000);
    expect(p.spawns).toHaveLength(1);
    p.src.stop();
  });

  it('the URL source polls and reports itself down when unreachable', async () => {
    let up = true;
    const urls: string[] = [];
    const src = new HttpSmtcSource('http://127.0.0.1:9/smtc', {
      now: () => Date.now(),
      fetch: (async (u: string) => {
        urls.push(u);
        if (!up) throw new Error('ECONNREFUSED');
        return json({ ok: true, app: 'Spotify.exe', title: 'Paper Lanterns', status: 'playing', sampleEpochMs: Date.now() });
      }) as unknown as typeof fetch,
    });
    const samples: SmtcSample[] = [];
    src.start((s) => samples.push(s));
    await vi.advanceTimersByTimeAsync(1100);
    expect(urls.length).toBe(3);
    expect(samples.every((s) => s.ok && s.title === 'Paper Lanterns')).toBe(true);
    up = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(samples.at(-1)?.ok).toBe(false);
    src.stop();
    const n = urls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(urls.length).toBe(n);
  });
});
