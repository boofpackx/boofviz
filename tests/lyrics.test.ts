import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_LYRICS, EMPTY_NOW_PLAYING, estimateLines, lineIndexAt, lrcFileName, normalizeTitle, parseLrc, positionAt } from '@shared/lyrics';
import { currentLines, liveText, lyricsFeed, setNowPlaying, setTrackLyrics } from '@/engine/lyricsFeed';
import { LRCLIB_USER_AGENT, LyricsService, primaryArtist, type TrackInfo } from '../src/main/lyrics';
import { authorizeUrl, createPkce, pickArt, pkceChallenge, SpotifyClient, type SpotifyDeps, type TokenStore } from '../src/main/spotify';

// All lyric text below is invented placeholder text.

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** fetch mock that records every call and routes by pathname. */
function mockFetch(routes: Record<string, Handler>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const h = routes[url.pathname];
    if (!h) return new Response('not found', { status: 404 });
    return h(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('parseLrc', () => {
  it('parses every timestamp precision and ignores metadata', () => {
    const { lines, offsetMs } = parseLrc(['[ar:Someone]', '[ti:Something]', '[length: 03:20]', '[by:me]', '[00:01]one', '[00:02.5]two', '[00:03.25]three', '[00:04.125]four', '[1:05.00] five ', 'no stamp here', ''].join('\n'));
    expect(offsetMs).toBe(0);
    expect(lines).toEqual([
      { t: 1000, text: 'one' },
      { t: 2500, text: 'two' },
      { t: 3250, text: 'three' },
      { t: 4125, text: 'four' },
      { t: 65000, text: 'five' },
    ]);
  });

  it('expands repeated timestamps, sorts by time and keeps empty gap lines', () => {
    const { lines } = parseLrc('[00:30.00][00:10.00]paper lanterns hum\r\n[00:20.00]\r\n[00:05.00]first');
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [5000, 'first'],
      [10000, 'paper lanterns hum'],
      [20000, ''],
      [30000, 'paper lanterns hum'],
    ]);
  });

  it('applies [offset:] (positive = earlier) and clamps at zero', () => {
    const plus = parseLrc('[offset:+500]\n[00:01.00]a\n[00:00.20]b');
    expect(plus.offsetMs).toBe(500);
    expect(plus.lines.map((l) => l.t)).toEqual([0, 500]);
    expect(parseLrc('[offset:-250]\n[00:01.00]a').lines[0].t).toBe(1250);
  });

  it('reads enhanced-LRC word stamps', () => {
    const { lines } = parseLrc('[00:12.00]<00:12.00>velvet <00:12.50>robots <00:13.10>dance\n[00:20.00][00:40.00]<00:20.00>again <00:20.40>now');
    expect(lines[0].text).toBe('velvet robots dance');
    expect(lines[0].words).toEqual([
      { t: 12000, text: 'velvet' },
      { t: 12500, text: 'robots' },
      { t: 13100, text: 'dance' },
    ]);
    // Word stamps follow a repeated line's second timestamp.
    expect(lines[2].t).toBe(40000);
    expect(lines[2].words).toEqual([
      { t: 40000, text: 'again' },
      { t: 40400, text: 'now' },
    ]);
  });

  it('copes with a BOM and empty input', () => {
    expect(parseLrc('﻿[00:01.00]x').lines).toEqual([{ t: 1000, text: 'x' }]);
    expect(parseLrc('')).toEqual({ lines: [], offsetMs: 0 });
  });
});

describe('lyric timing', () => {
  const lines = parseLrc('[00:01.00]a\n[00:02.00]b\n[00:02.00]b2\n[00:05.00]c').lines;

  it('lineIndexAt finds the line playing now', () => {
    expect(lineIndexAt(lines, 0)).toBe(-1);
    expect(lineIndexAt(lines, 999)).toBe(-1);
    expect(lineIndexAt(lines, 1000)).toBe(0);
    expect(lineIndexAt(lines, 2000)).toBe(2);
    expect(lineIndexAt(lines, 4999)).toBe(2);
    expect(lineIndexAt(lines, 1e9)).toBe(3);
    expect(lineIndexAt([], 5)).toBe(-1);
  });

  it('positionAt extrapolates while playing and freezes when paused', () => {
    const s = { playing: true, progressMs: 10000, sampleEpochMs: 1_000_000, durationMs: 200000 };
    expect(positionAt(s, 1_000_000)).toBe(10000);
    expect(positionAt(s, 1_002_500)).toBe(12500);
    expect(positionAt(s, 2_000_000)).toBe(200000);
    expect(positionAt({ ...s, playing: false }, 1_002_500)).toBe(10000);
  });
});

describe('lyrics without timestamps', () => {
  it('spreads the lines across the song by length, with stanza gaps', () => {
    const lines = estimateLines('one two three\nfour five\n\n\nsix seven eight nine', 200000)!;
    expect(lines.map((l) => l.text)).toEqual(['one two three', 'four five', '', 'six seven eight nine', '']);
    expect(lines[0].t).toBe(15000);
    for (let k = 1; k < lines.length; k++) expect(lines[k].t).toBeGreaterThan(lines[k - 1].t);
    expect(lines[lines.length - 1].t).toBe(180000);
    expect(estimateLines('short', 5000)).toBeNull();
  });

  it('the screen gets estimated lines when only plain lyrics were found', () => {
    setNowPlaying({ ...EMPTY_NOW_PLAYING, connected: true, playing: true, trackId: 'plain1', title: 'x', durationMs: 180000, progressMs: 0, sampleEpochMs: Date.now() });
    setTrackLyrics({ ...EMPTY_LYRICS, trackId: 'plain1', source: 'lrclib', plain: 'first line\nsecond line' });
    expect(currentLines()?.map((l) => l.text)).toEqual(['first line', 'second line', '']);
    setTrackLyrics({ ...EMPTY_LYRICS, trackId: 'plain1', source: 'lrclib', plain: 'x', instrumental: true });
    expect(currentLines()).toBeNull();
    setNowPlaying({ ...EMPTY_NOW_PLAYING });
    setTrackLyrics({ ...EMPTY_LYRICS });
  });
});

describe('normalizeTitle', () => {
  it('strips remaster / single-version / featuring suffixes', () => {
    expect(normalizeTitle('A Forest - 2006 Remaster')).toBe('A Forest');
    expect(normalizeTitle('1979 - Remastered 2012')).toBe('1979');
    expect(normalizeTitle('Personal Jesus - Single Version')).toBe('Personal Jesus');
    expect(normalizeTitle('Some Song - 2007 Digital Remaster')).toBe('Some Song');
    expect(normalizeTitle('Some Song (2011 Remaster)')).toBe('Some Song');
    expect(normalizeTitle('Some Song (Single Edit)')).toBe('Some Song');
    expect(normalizeTitle('Some Song (Official Version)')).toBe('Some Song');
    expect(normalizeTitle('Some Song (feat. Somebody Else)')).toBe('Some Song');
    expect(normalizeTitle('Some Song [feat. A & B] - Remastered')).toBe('Some Song');
  });

  it('leaves real titles alone', () => {
    expect(normalizeTitle('Love - Hate')).toBe('Love - Hate');
    expect(normalizeTitle('Song (Part 2)')).toBe('Song (Part 2)');
    expect(normalizeTitle('Untitled - Club Mix')).toBe('Untitled - Club Mix');
  });

  it('builds safe .lrc file names', () => {
    expect(lrcFileName('AC/DC?', 'Some Song - 2006 Remaster')).toBe('AC DC - Some Song.lrc');
  });
});

describe('LyricsService', () => {
  let dir: string;
  const track: TrackInfo = { id: 'trk1', title: 'Paper Lanterns - 2011 Remaster', artists: ['The Placeholders'], album: 'Invented', durationMs: 201400 };
  const SYNCED = '[00:01.00]paper lanterns hum\n[00:03.00]over the parking lot';
  let now = 1_000_000;
  const service = (fetchFn: typeof fetch, online = true) =>
    new LyricsService({ fetch: fetchFn, now: () => now, lyricsDir: join(dir, 'lyrics'), cacheDir: join(dir, 'cache'), baseUrl: 'http://lrclib.test/api', online: () => online });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boofviz-lyrics-'));
    now = 1_000_000;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('tries /get with the exact title, then the normalized one, and caches the hit', async () => {
    const m = mockFetch({
      '/api/get': (url) => (url.searchParams.get('track_name') === 'Paper Lanterns' ? json({ id: 1, duration: 201, syncedLyrics: SYNCED, plainLyrics: 'x', instrumental: false }) : json({ code: 404 }, 404)),
    });
    const l = await service(m.fn).lookup(track);
    expect(l.source).toBe('lrclib');
    expect(l.synced?.map((x) => x.text)).toEqual(['paper lanterns hum', 'over the parking lot']);
    expect(m.calls.map((c) => c.url.searchParams.get('track_name'))).toEqual(['Paper Lanterns - 2011 Remaster', 'Paper Lanterns']);
    const q = m.calls[0].url.searchParams;
    expect([q.get('artist_name'), q.get('album_name'), q.get('duration')]).toEqual(['The Placeholders', 'Invented', '201']);
    expect(new Headers(m.calls[0].init.headers).get('user-agent')).toBe(LRCLIB_USER_AGENT);

    // Second lookup: from the cache, no network.
    const offline = mockFetch({});
    const again = await service(offline.fn).lookup(track);
    expect(again.source).toBe('cache');
    expect(again.synced).toEqual(l.synced);
    expect(offline.calls).toHaveLength(0);
  });

  it('falls back to /search and only accepts synced results within ±2 s', async () => {
    const m = mockFetch({
      '/api/get': () => json({ code: 404 }, 404),
      '/api/search': () =>
        json([
          { id: 1, duration: 150, syncedLyrics: '[00:01.00]wrong edit' },
          { id: 2, duration: 199.0, syncedLyrics: '[00:01.00]too short by 2.4 s' },
          { id: 3, duration: 202.9, syncedLyrics: null, plainLyrics: 'plain only' },
          { id: 4, duration: 203.2, syncedLyrics: '[00:01.00]the right one' },
        ]),
    });
    const l = await service(m.fn).lookup(track);
    expect(l.synced?.[0].text).toBe('the right one');
    const search = m.calls.find((c) => c.url.pathname === '/api/search')!;
    expect(search.url.searchParams.get('track_name')).toBe('Paper Lanterns');
  });

  it('splits a several-artist name, and searches by any length when the length is unknown', async () => {
    expect(primaryArtist('The Placeholders, Somebody Else')).toBe('The Placeholders');
    expect(primaryArtist('Ann feat. Bo')).toBe('Ann');
    expect(primaryArtist('Ann & Bo')).toBe('Ann');
    expect(primaryArtist('Charli Example')).toBe('Charli Example');
    const m = mockFetch({
      '/api/get': (url) => (url.searchParams.get('artist_name') === 'The Placeholders' ? json({ id: 1, duration: 201, syncedLyrics: SYNCED }) : json({ code: 404 }, 404)),
      '/api/search': () => json([{ id: 9, duration: 95, syncedLyrics: '[00:01.00]found by search' }]),
    });
    const both = await service(m.fn).lookup({ ...track, id: 'multi', artists: ['The Placeholders, Somebody Else'] });
    expect(both.synced).not.toBeNull();
    const unknown = await service(m.fn).lookup({ ...track, id: 'nolen', durationMs: 0 });
    expect(unknown.synced?.[0].text).toBe('found by search');
  });

  it('a cached miss is searched again when better details arrive', async () => {
    const m = mockFetch({ '/api/get': () => json({ code: 404 }, 404), '/api/search': () => json([]) });
    await service(m.fn).lookup(track);
    const n = m.calls.length;
    await service(m.fn).lookup(track, true);
    expect(m.calls.length).toBeGreaterThan(n);
  });

  it('prefers a user .lrc file, matched loosely by "Artist - Title"', async () => {
    mkdirSync(join(dir, 'lyrics'));
    writeFileSync(join(dir, 'lyrics', 'the placeholders - PAPER LANTERNS.lrc'), '[00:00.50]from my own file');
    const m = mockFetch({});
    const l = await service(m.fn).lookup(track);
    expect(l.source).toBe('file');
    expect(l.synced?.[0]).toEqual({ t: 500, text: 'from my own file' });
    expect(m.calls).toHaveLength(0);
  });

  it('finds .lrc files saved by other programs: other namings, subfolders, tags inside, the track id', async () => {
    const lyr = join(dir, 'lyrics');
    const m = mockFetch({});
    const svc = service(m.fn);
    const look = (t: Partial<TrackInfo>) => svc.lookup({ ...track, ...t });
    mkdirSync(join(lyr, 'The Placeholders'), { recursive: true });
    writeFileSync(join(lyr, 'Paper Lanterns - The Placeholders.lrc'), '[00:01.00]title first');
    expect((await look({ id: 'a1' })).synced?.[0].text).toBe('title first');
    writeFileSync(join(lyr, 'The Placeholders', '03. Night Bus.lrc'), '[00:01.00]numbered in a subfolder');
    svc.invalidateFiles();
    expect((await look({ id: 'a2', title: 'Night Bus' })).synced?.[0].text).toBe('numbered in a subfolder');
    writeFileSync(join(lyr, 'x9.lrc'), '[ti:Quiet Hours]\n[ar:Ann]\n[00:02.00]matched by its tags');
    writeFileSync(join(lyr, '4uLU6hMCjMI75M1A2tKUQC.lrc'), '[00:02.00]matched by the track id');
    svc.invalidateFiles();
    expect((await look({ id: 'a3', title: 'Quiet Hours', artists: ['Ann, Bo'] })).synced?.[0].text).toBe('matched by its tags');
    expect((await look({ id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Anything' })).synced?.[0].text).toBe('matched by the track id');
    // A title shared by two files is too risky to guess.
    writeFileSync(join(lyr, 'Home.lrc'), '[00:01.00]one');
    writeFileSync(join(lyr, 'The Placeholders', 'Home.lrc'), '[00:01.00]two');
    svc.invalidateFiles();
    expect((await look({ id: 'a4', title: 'Home', artists: ['Third Band'] })).source).not.toBe('file');
    // An empty file (still being written) is not a match.
    writeFileSync(join(lyr, 'Ann - Empty.lrc'), '');
    svc.invalidateFiles();
    expect(await svc.fromFiles({ ...track, id: 'a5', title: 'Empty', artists: ['Ann'] })).toBeNull();
  });

  it('caches "not found" for 24 h and skips the network when offline', async () => {
    const m = mockFetch({ '/api/get': () => json({ code: 404 }, 404), '/api/search': () => json([]) });
    expect((await service(m.fn).lookup(track)).source).toBe('none');
    const n = m.calls.length;
    now += 23 * 3600 * 1000;
    expect((await service(m.fn).lookup(track)).source).toBe('none');
    expect(m.calls.length).toBe(n);
    now += 2 * 3600 * 1000;
    await service(m.fn).lookup(track);
    expect(m.calls.length).toBeGreaterThan(n);

    const off = mockFetch({});
    expect((await service(off.fn, false).lookup({ ...track, id: 'other' })).source).toBe('none');
    expect(off.calls).toHaveLength(0);
  });

  it('does not cache a miss caused by a network error', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect((await service(failing).lookup(track)).source).toBe('none');
    expect(existsSync(join(dir, 'cache', 'trk1.json'))).toBe(false);
  });

  it('saves a dropped .lrc for the track', async () => {
    const l = await service(mockFetch({}).fn).saveLrc(track, '[00:02.00]attached by hand');
    expect(l.source).toBe('file');
    expect(readFileSync(join(dir, 'lyrics', 'The Placeholders - Paper Lanterns.lrc'), 'utf8')).toBe('[00:02.00]attached by hand');
  });
});

describe('Spotify client', () => {
  function memoryTokens(initial: string | null = null): TokenStore & { value: string | null } {
    return {
      value: initial,
      load() {
        return this.value;
      },
      save(t) {
        this.value = t;
      },
      clear() {
        this.value = null;
      },
    };
  }

  function client(fetchFn: typeof fetch, tokens: TokenStore, clock = { t: 5_000_000 }) {
    const published: SpotifyDeps['publish'] extends (s: infer S) => void ? S[] : never = [];
    const c = new SpotifyClient({
      fetch: fetchFn,
      now: () => clock.t,
      accountsUrl: 'http://accounts.test',
      apiUrl: 'http://api.test/v1',
      clientId: () => 'cid123',
      tokens,
      openExternal: async () => undefined,
      publish: (s) => published.push(s),
    });
    // Seed the refresh token without starting the poll loop.
    (c as unknown as { refreshToken: string | null }).refreshToken = tokens.load();
    return { c, published, clock };
  }

  const form = (init: RequestInit): URLSearchParams => new URLSearchParams(String(init.body));
  const playing = (progress = 42000) =>
    json({
      is_playing: true,
      progress_ms: progress,
      currently_playing_type: 'track',
      item: { id: 'abc', name: 'Paper Lanterns', duration_ms: 201000, artists: [{ name: 'The Placeholders' }], album: { name: 'Invented', images: [] } },
    });

  it('creates a valid PKCE pair and authorize URL', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(pkceChallenge(verifier));
    // Known vector: base64url(sha256(verifier)) without padding (cross-checked with openssl).
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K9uhvrAeU2yXEJ9QCq3Z8C8XNWs')).toBe('Brlj8wbpbrHTqrj77I4I0HykvZiXfeXkKR_nCzTp90Y');
    const url = new URL(authorizeUrl('http://accounts.test', 'cid123', challenge, 'st8'));
    expect(url.pathname).toBe('/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid123',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:43821/callback',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state: 'st8',
      scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state',
    });
  });

  it('refreshes with client_id (no secret) and keeps a rotated refresh token', async () => {
    const tokens = memoryTokens('rt-old');
    const m = mockFetch({
      '/api/token': () => json({ access_token: 'at1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-new' }),
      '/v1/me/player/currently-playing': () => playing(),
    });
    const { c } = client(m.fn, tokens);
    expect(await c.pollOnce()).toBe(4000);
    const body = form(m.calls[0].init);
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-old', client_id: 'cid123' });
    expect(tokens.value).toBe('rt-new');
    expect(new Headers(m.calls[1].init.headers).get('authorization')).toBe('Bearer at1');
  });

  it('samples the position at the request midpoint', async () => {
    const clock = { t: 5_000_000 };
    const m = mockFetch({
      '/api/token': () => json({ access_token: 'at1', token_type: 'Bearer', expires_in: 3600 }),
      '/v1/me/player/currently-playing': () => {
        clock.t += 200; // 200 ms round trip
        return playing(42000);
      },
    });
    const { c } = client(m.fn, memoryTokens('rt'), clock);
    await c.pollOnce();
    expect(c.state).toMatchObject({ connected: false, playing: true, trackId: 'abc', title: 'Paper Lanterns', artists: ['The Placeholders'], progressMs: 42000, sampleEpochMs: 5_000_100, durationMs: 201000 });
  });

  it('on 401 refreshes once and retries', async () => {
    let n = 0;
    const m = mockFetch({
      '/api/token': () => json({ access_token: `at${++n}`, token_type: 'Bearer', expires_in: 3600 }),
      '/v1/me/player/currently-playing': (_u, init) => (new Headers(init.headers).get('authorization') === 'Bearer at1' ? json({ error: { status: 401 } }, 401) : playing()),
    });
    const { c } = client(m.fn, memoryTokens('rt'));
    expect(await c.pollOnce()).toBe(4000);
    expect(m.calls.map((x) => x.url.pathname)).toEqual(['/api/token', '/v1/me/player/currently-playing', '/api/token', '/v1/me/player/currently-playing']);
    expect(c.state.trackId).toBe('abc');
  });

  it('honours Retry-After on 429 and backs off on server errors', async () => {
    let status = 429;
    const m = mockFetch({
      '/api/token': () => json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }),
      '/v1/me/player/currently-playing': () => (status === 200 ? playing() : json({}, status, status === 429 ? { 'Retry-After': '7' } : {})),
    });
    const { c } = client(m.fn, memoryTokens('rt'));
    expect(await c.pollOnce()).toBe(7000);
    status = 503;
    expect(await c.pollOnce()).toBe(2000);
    expect(await c.pollOnce()).toBe(4000);
    expect(c.state.error).toMatch(/503/);
    status = 200;
    // After a rate limit it keeps polling at half speed for a while.
    expect(await c.pollOnce()).toBe(8000);
    expect(c.state.error).toBeUndefined();
  });

  it('polls gently: every few seconds, right at the end of a song, slower when paused or idle', async () => {
    let body = (): Response => playing(199500);
    const m = mockFetch({
      '/api/token': () => json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }),
      '/v1/me/player/currently-playing': () => body(),
    });
    const { c } = client(m.fn, memoryTokens('rt'));
    // 1.5 s left of a 201 s track: check just after it ends.
    expect(await c.pollOnce()).toBe(1900);
    body = () => playing(10000);
    expect(await c.pollOnce()).toBe(4000);
    body = () => new Response(null, { status: 204 });
    expect(await c.pollOnce()).toBe(8000);
  });

  it('treats 204 as nothing playing and non-tracks as no lyrics', async () => {
    let res = (): Response => new Response(null, { status: 204 });
    const tracks: Array<string | null> = [];
    const m = mockFetch({
      '/api/token': () => json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }),
      '/v1/me/player/currently-playing': () => res(),
    });
    const { c } = client(m.fn, memoryTokens('rt'));
    (c as unknown as { deps: SpotifyDeps }).deps.onTrack = (t) => tracks.push(t?.id ?? null);
    res = () => playing();
    await c.pollOnce();
    res = () => new Response(null, { status: 204 });
    expect(await c.pollOnce()).toBe(8000);
    expect(c.state).toMatchObject({ playing: false, trackId: null, title: '' });
    res = () => json({ is_playing: true, progress_ms: 5, currently_playing_type: 'episode', item: null });
    await c.pollOnce();
    expect(c.state).toMatchObject({ playing: true, trackId: null, title: 'Podcast episode' });
    expect(tracks).toEqual(['abc', null]);
  });

  it('a revoked refresh token disconnects and clears the stored token', async () => {
    const tokens = memoryTokens('rt');
    const m = mockFetch({ '/api/token': () => json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400) });
    const { c } = client(m.fn, tokens);
    expect(await c.pollOnce()).toBe(-1);
    expect(tokens.value).toBeNull();
    expect(c.state).toMatchObject({ connected: false, error: 'Spotify session expired. Connect again.' });
  });

  it('playback control: 403 means Premium, pause freezes the position', async () => {
    let premium = false;
    const clock = { t: 5_000_000 };
    const m = mockFetch({
      '/api/token': () => json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }),
      '/v1/me/player/currently-playing': () => playing(10000),
      '/v1/me/player/pause': (_u, init) => (init.method === 'PUT' && premium ? new Response(null, { status: 204 }) : json({ error: { status: 403 } }, 403)),
    });
    const { c } = client(m.fn, memoryTokens('rt'), clock);
    await c.pollOnce();
    expect(await c.control('pause')).toBe('Spotify Premium required for playback control.');
    premium = true;
    clock.t += 3000;
    expect(await c.control('pause')).toBeNull();
    expect(c.state.playing).toBe(false);
    expect(positionAt(c.state, clock.t + 5000)).toBe(13000);
    c.dispose();
  });

  it('picks the smallest album image of at least 300 px', () => {
    const img = (w: number) => ({ url: `u${w}`, width: w, height: w });
    expect(pickArt([img(640), img(300), img(64)])).toBe('u300');
    expect(pickArt([img(64), img(200)])).toBe('u200');
    expect(pickArt([])).toBeNull();
  });
});

describe('text looks', () => {
  const lines = [
    { t: 1000, text: 'first line' },
    { t: 3000, text: 'second line' },
    { t: 5000, text: '' },
    { t: 6000, text: 'third line' },
  ];
  const play = (progressMs: number): void => {
    setNowPlaying({ ...EMPTY_NOW_PLAYING, connected: true, playing: false, trackId: 't1', title: 'A Song', artists: ['An Artist'], progressMs, sampleEpochMs: 0, durationMs: 60000 });
    setTrackLyrics({ ...EMPTY_LYRICS, trackId: 't1', source: 'file', synced: lines });
  };
  beforeEach(() => {
    lyricsFeed.offsetMs = 0;
    lyricsFeed.textLooks = false;
  });

  it("keeps the look's own text only for text looks, and shows nothing when nothing plays", () => {
    play(2000);
    expect(liveText('text', 0, 0).kind).toBe('text');
    lyricsFeed.textLooks = true;
    expect(liveText('text', 0, 0).kind).toBe('lyrics');
    setNowPlaying({ ...EMPTY_NOW_PLAYING });
    // No placeholder words: lyrics and title looks go blank.
    expect(liveText('lyrics', 0, 0).lines).toEqual([]);
    expect(liveText('title', 0, 0).lines).toEqual([]);
  });

  it('shows just the song name before the first line or without lyrics, and song and artist for title looks', () => {
    play(500);
    expect(liveText('lyrics', 0, 0)).toMatchObject({ kind: 'title', lines: ['A Song'] });
    setTrackLyrics({ ...EMPTY_LYRICS, trackId: 't1', source: 'none' });
    expect(liveText('lyrics', 0, 0)).toMatchObject({ kind: 'title', lines: ['A Song'] });
    play(2000);
    expect(liveText('title', 0, 0)).toMatchObject({ kind: 'title', lines: ['A Song', 'An Artist'] });
  });

  it('gives the current line, its progress and a window for the crawl', () => {
    play(4000);
    expect(liveText('lyrics', 0, 0)).toMatchObject({ kind: 'lyrics', lines: ['second line'], current: 0, progress: 0.5 });
    const w = liveText('lyrics', 0, 0, 3, 4);
    expect(w.lines).toEqual(['first line', 'second line', '♪', 'third line']);
    expect(w.current).toBe(1);
  });
});

describe('hearing Spotify changes', () => {
  it('asks Spotify after a pause, when music comes back, and on a sudden jump, but not too often', async () => {
    const { AudioChangeDetector } = await import('@/control/audioChange');
    const d = new AudioChangeDetector();
    const loud = { silence: false, loudnessLUFS: -10 };
    const quiet = { silence: true, loudnessLUFS: -Infinity };
    let t = 0;
    const run = (f: typeof loud, ms: number): number => {
      let n = 0;
      for (let end = t + ms; t < end; t += 100) if (d.update(t, f, 100)) n++;
      return n;
    };
    expect(run(loud, 20000)).toBe(0); // steady music: nothing
    expect(run(quiet, 2000)).toBe(1); // paused: once
    expect(run(loud, 3000)).toBe(1); // resumed: once
    expect(run({ silence: false, loudnessLUFS: -28 }, 3000)).toBe(1); // skipped to a much quieter song
    // Never more than 10 a minute, however choppy the audio.
    let n = 0;
    for (let i = 0; i < 60; i++) n += run(i % 2 ? loud : quiet, 1000);
    expect(n).toBeLessThanOrEqual(10);
  });
});
