import { createHash, randomBytes } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { EMPTY_NOW_PLAYING, SPOTIFY_REDIRECT_PORT, SPOTIFY_REDIRECT_URI, type NowPlaying, type SpotifyCommand } from '@shared/lyrics';
import { HybridNowPlaying, SMTC_ID_PREFIX, sameSong, type HybridHost } from './hybrid';
import type { MediaSessionSource } from './smtc';

/**
 * Spotify Web API client: Authorization Code + PKCE login (no client secret),
 * token refresh, now playing and playback control. While a media session
 * (Windows SMTC, see hybrid.ts) shows Spotify, it follows the song and the Web
 * API is only asked for exact checks; otherwise adaptive polling. No Electron
 * imports: storage, the browser and the clock are injected (see nowPlaying.ts),
 * so this is unit-testable with a mocked fetch.
 */

export const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
/** Base retry step for errors (doubles per failure). */
const POLL_MS = 1000;
/**
 * Polling is adaptive: the song position is extrapolated locally between
 * samples, so a steady poll every few seconds is plenty, plus one right when
 * the track should end (to catch the next song at once). Far fewer requests
 * than polling every second, which is what trips Spotify's rate limit.
 */
export const POLL = { playing: 4000, paused: 3000, idle: 8000, min: 1000, endGrace: 400, slowFactor: 2, slowForMs: 10 * 60 * 1000 };
const MAX_BACKOFF_MS = 30000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface TokenStore {
  load(): string | null;
  save(refreshToken: string): void;
  clear(): void;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  images: Array<{ url: string; width: number | null; height: number | null }>;
}

export interface SpotifyDeps {
  fetch: typeof fetch;
  now: () => number;
  accountsUrl: string;
  apiUrl: string;
  clientId: () => string;
  tokens: TokenStore;
  openExternal: (url: string) => Promise<void>;
  /** Every state change and every poll (the fresh sample keeps both windows in step). */
  publish: (s: NowPlaying) => void;
  /** The track changed (null: nothing / not a track). */
  onTrack?: (t: SpotifyTrack | null) => void;
  /** Spotify named a song first published from the media session (same id, better metadata). */
  onRefine?: (t: SpotifyTrack) => void;
  redirectPort?: number;
  /** Windows media session: while it shows Spotify it leads, and polling stops. */
  media?: MediaSessionSource | null;
}

/** One currently-playing answer. */
export type CurrentlyPlaying =
  | { kind: 'track'; track: SpotifyTrack; playing: boolean; progressMs: number; sampleEpochMs: number }
  /** A podcast, an ad or a local file. */
  | { kind: 'other'; title: string; playing: boolean; progressMs: number; durationMs: number; sampleEpochMs: number }
  | { kind: 'idle'; sampleEpochMs: number }
  /** 429: the slow-down message is set; no requests for `waitMs`. */
  | { kind: 'limited'; waitMs: number }
  /** `stop`: the session is gone (back to Connect). */
  | { kind: 'error'; message: string; stop?: boolean };

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export class SpotifyAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const base64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE pair: a 43–128 char verifier and its S256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(64));
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function authorizeUrl(accountsUrl: string, clientId: string, challenge: string, state: string, redirectUri = SPOTIFY_REDIRECT_URI): string {
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, code_challenge_method: 'S256', code_challenge: challenge, state, scope: SPOTIFY_SCOPES });
  return `${accountsUrl}/authorize?${q}`;
}

/** POST {accounts}/api/token (form-encoded, no client secret). */
export async function requestToken(fetchFn: typeof fetch, accountsUrl: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchFn(`${accountsUrl}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const code = body.error ?? `http_${res.status}`;
    throw new SpotifyAuthError(res.status, code, body.error_description ?? code);
  }
  return body as TokenResponse;
}

/** Smallest image at least 300 px wide (else the largest). */
export function pickArt(images: SpotifyTrack['images']): string | null {
  if (!images.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 300) ?? sorted[sorted.length - 1]).url;
}

export async function fetchDataUrl(fetchFn: typeof fetch, url: string): Promise<string | null> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

interface CallbackServer {
  code: Promise<string>;
  /** Answer the browser tab (after the token exchange). */
  reply(ok: boolean, message: string): void;
  close(): void;
}

function page(title: string, message: string): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>BOOFVIZ</title></head><body style="background:#0a0a0c;color:#e6e6ea;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:22px;margin:0 0 8px">${esc(title)}</h1><p style="color:#9a9aa6;margin:0">${esc(message)}</p></div></body></html>`;
}

function send(res: ServerResponse, status: number, title: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close', 'Cache-Control': 'no-store' });
  res.end(page(title, message));
}

/** Temporary http server on 127.0.0.1:<port> that waits for the OAuth redirect. */
function listenForCallback(port: number, state: string): Promise<CallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let pending: ServerResponse | null = null;
    let settle!: { resolve: (code: string) => void; reject: (e: Error) => void };
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
    code.catch(() => undefined);
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { Connection: 'close' }).end();
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        send(res, 400, 'Not connected', 'Spotify login was cancelled. You can close this tab.');
        settle.reject(new Error(err === 'access_denied' ? 'Spotify login was cancelled.' : `Spotify login failed (${err}).`));
        return;
      }
      if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
        send(res, 400, 'Not connected', 'This login link is stale. Start again from BOOFVIZ.');
        settle.reject(new Error('Spotify login failed: state mismatch. Try again.'));
        return;
      }
      pending?.destroy();
      pending = res;
      settle.resolve(url.searchParams.get('code')!);
    });
    let closed = false;
    const timer = setTimeout(() => settle.reject(new Error('Spotify login timed out. Try again.')), LOGIN_TIMEOUT_MS);
    server.once('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      rejectServer(new Error(e.code === 'EADDRINUSE' ? `Port ${port} is busy (another app or login is using it). Close it and try again.` : `Could not start the login callback server: ${e.message}`));
    });
    server.listen(port, '127.0.0.1', () =>
      resolveServer({
        code,
        reply: (ok, message) => {
          if (pending) send(pending, ok ? 200 : 400, ok ? 'Connected' : 'Not connected', message);
          pending = null;
        },
        close: () => {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          settle.reject(new Error('cancelled'));
          pending?.destroy();
          server.close();
          server.closeAllConnections();
        },
      }),
    );
  });
}

export class SpotifyClient {
  state: NowPlaying = { ...EMPTY_NOW_PLAYING };
  private refreshToken: string | null = null;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;
  private login: CallbackServer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastSendMs = 0;
  private generation = 0;
  private lastTrackId: string | null = null;
  /** Track whose album art was last requested. */
  private artFor: string | null = null;
  /** Retry-After of the last 429: no Web API requests before this (hybrid checks, polling after a fallback). */
  private limitedUntil = 0;
  private readonly hybrid: HybridNowPlaying | null;

  constructor(private readonly deps: SpotifyDeps) {
    const host: HybridHost = {
      now: () => this.deps.now(),
      state: () => this.state,
      set: (patch) => this.set(patch),
      track: (t) => this.applyTrack(t),
      art: (id, images) => this.fetchArt(id, images),
      refine: (t) => this.deps.onRefine?.(t),
      current: () => this.current(),
      limitedUntil: () => this.limitedUntil,
      polling: (on) => (on ? this.beginPolling(Math.max(0, this.limitedUntil - this.deps.now())) : this.stopPolling()),
    };
    this.hybrid = deps.media ? new HybridNowPlaying(host, deps.media) : null;
  }

  /** The media session leads (hybrid mode) rather than polling. */
  get hybridActive(): boolean {
    return this.hybrid?.active ?? false;
  }

  /** Resume a stored session (if any) and start following Spotify. */
  start(): void {
    this.refreshToken = this.deps.tokens.load();
    if (this.refreshToken && this.deps.clientId().trim()) this.run();
  }

  /** Poll now; the media session (if any) takes over once it shows Spotify. */
  private run(): void {
    this.hybrid?.stop();
    this.beginPolling();
    this.hybrid?.start();
  }

  private halt(): void {
    this.hybrid?.stop();
    this.stopPolling();
  }

  private set(patch: Partial<NowPlaying>): void {
    this.state = { ...this.state, ...patch };
    this.deps.publish(this.state);
  }

  async connect(): Promise<void> {
    const clientId = this.deps.clientId().trim();
    if (!clientId) return this.set({ error: 'Paste your Spotify Client ID first.' });
    this.login?.close();
    this.set({ connecting: true, error: undefined });
    const { verifier, challenge } = createPkce();
    const state = base64url(randomBytes(16));
    const port = this.deps.redirectPort ?? SPOTIFY_REDIRECT_PORT;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    let server: CallbackServer | null = null;
    try {
      server = await listenForCallback(port, state);
      this.login = server;
      await this.deps.openExternal(authorizeUrl(this.deps.accountsUrl, clientId, challenge, state, redirectUri));
      const code = await server.code;
      try {
        const tok = await requestToken(this.deps.fetch, this.deps.accountsUrl, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });
        this.accept(tok);
        server.reply(true, 'Connected — you can close this tab and go back to BOOFVIZ.');
      } catch (err) {
        server.reply(false, `Spotify refused the login: ${(err as Error).message}`);
        throw err;
      }
      this.set({ connected: true, connecting: false, error: undefined });
      this.run();
    } catch (err) {
      const msg = (err as Error).message;
      // A newer connect() or a disconnect() closed this login: stay quiet.
      if (msg === 'cancelled') return;
      this.set({ connecting: false, error: err instanceof SpotifyAuthError ? `Spotify login failed: ${err.message}` : msg });
    } finally {
      server?.close();
      if (this.login === server) this.login = null;
    }
  }

  disconnect(): void {
    this.login?.close();
    this.login = null;
    this.halt();
    this.refreshToken = null;
    this.accessToken = null;
    this.deps.tokens.clear();
    this.applyTrack(null);
    this.set({ ...EMPTY_NOW_PLAYING });
  }

  private accept(tok: TokenResponse): void {
    this.accessToken = tok.access_token;
    // Renew a minute early so a poll never races the expiry.
    this.expiresAt = this.deps.now() + Math.max(60, tok.expires_in - 60) * 1000;
    // Spotify may rotate the refresh token; keep the newest one.
    if (tok.refresh_token && tok.refresh_token !== this.refreshToken) {
      this.refreshToken = tok.refresh_token;
      this.deps.tokens.save(tok.refresh_token);
    }
  }

  /** Exchange the refresh token for a new access token (single flight). */
  refresh(): Promise<string> {
    return (this.refreshing ??= (async () => {
      try {
        const rt = this.refreshToken;
        if (!rt) throw new SpotifyAuthError(401, 'not_connected', 'Not connected to Spotify.');
        try {
          const tok = await requestToken(this.deps.fetch, this.deps.accountsUrl, { grant_type: 'refresh_token', refresh_token: rt, client_id: this.deps.clientId().trim() });
          this.accept(tok);
          return tok.access_token;
        } catch (err) {
          if (err instanceof SpotifyAuthError && err.status >= 400 && err.status < 500) this.authLost();
          throw err;
        }
      } finally {
        this.refreshing = null;
      }
    })());
  }

  /** The refresh token was revoked or belongs to another client id: back to "Connect". */
  private authLost(): void {
    this.halt();
    this.refreshToken = null;
    this.accessToken = null;
    this.deps.tokens.clear();
    this.applyTrack(null);
    this.set({ ...EMPTY_NOW_PLAYING, error: 'Spotify session expired. Connect again.' });
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.deps.now() < this.expiresAt) return this.accessToken;
    return this.refresh();
  }

  /** Authorized API call; a 401 refreshes the token and retries once. */
  private async api(method: 'GET' | 'PUT' | 'POST', path: string, retry = true): Promise<Response> {
    const token = await this.token();
    this.lastSendMs = this.deps.now();
    const res = await this.deps.fetch(`${this.deps.apiUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && retry) {
      this.accessToken = null;
      await this.refresh();
      return this.api(method, path, false);
    }
    return res;
  }

  /** Adaptive polling; `delayMs` holds the first request back (a Retry-After still running). */
  private beginPolling(delayMs = 0): void {
    this.stopPolling();
    const gen = ++this.generation;
    this.failures = 0;
    this.set(delayMs > 0 ? { connected: true } : { connected: true, error: undefined });
    const loop = async (): Promise<void> => {
      const delay = await this.pollOnce();
      if (gen !== this.generation || delay < 0) return;
      this.timer = setTimeout(() => void loop(), delay);
    };
    if (delayMs > 0) this.timer = setTimeout(() => void loop(), delayMs);
    else void loop();
  }

  private stopPolling(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    // Re-poll soon after a playback command (keeps the 1 Hz loop otherwise).
    const gen = this.generation;
    setTimeout(() => {
      if (gen === this.generation) void this.pollOnce();
    }, ms);
  }

  /** After a rate limit, poll slower for a while. */
  private slowUntil = 0;

  /** Delay to the next poll in a steady state. */
  private steady(kind: 'playing' | 'paused' | 'idle', progressMs = 0, durationMs = 0): number {
    let ms = POLL[kind];
    // Catch the track change: poll just after the song should end.
    if (kind === 'playing' && durationMs > 0) ms = Math.min(ms, Math.max(POLL.min, durationMs - progressMs + POLL.endGrace));
    if (this.deps.now() < this.slowUntil) ms *= POLL.slowFactor;
    return ms;
  }

  private backoff(error: string): number {
    this.failures++;
    this.set({ error });
    return Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** this.failures);
  }

  /** One currently-playing request, parsed. A 429 also sets the slow-down message and the Retry-After. */
  async current(): Promise<CurrentlyPlaying> {
    let res: Response;
    try {
      res = await this.api('GET', '/me/player/currently-playing');
    } catch (err) {
      if (err instanceof SpotifyAuthError) return this.refreshToken ? { kind: 'error', message: `Spotify: ${err.message}` } : { kind: 'error', message: err.message, stop: true };
      return { kind: 'error', message: 'Spotify unreachable. Retrying…' };
    }
    // Sample time: midpoint of send and receive.
    const sampleEpochMs = Math.round((this.lastSendMs + this.deps.now()) / 2);
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      const wait = Math.max(POLL_MS, (Number.isFinite(after) && after > 0 ? after : 5) * 1000);
      this.slowUntil = this.deps.now() + POLL.slowForMs;
      this.limitedUntil = this.deps.now() + wait;
      const secs = Math.round(wait / 1000);
      this.set({ error: `Spotify asked us to slow down; checking again in ${secs >= 90 ? `${Math.round(secs / 60)} min` : `${secs} s`}. Lyrics keep running.` });
      return { kind: 'limited', waitMs: wait };
    }
    if (res.status >= 500) return { kind: 'error', message: `Spotify error ${res.status}. Retrying…` };
    if (res.status === 204 || res.status === 202) return { kind: 'idle', sampleEpochMs };
    if (!res.ok) return { kind: 'error', message: `Spotify error ${res.status}.` };
    type Body = {
      is_playing?: boolean;
      progress_ms?: number | null;
      currently_playing_type?: string;
      item?: { id?: string; name?: string; duration_ms?: number; artists?: Array<{ name: string }>; album?: { name?: string; images?: SpotifyTrack['images'] } } | null;
    };
    const body = (await res.json().catch(() => ({}))) as Body;
    const item = body.item;
    const playing = body.is_playing === true;
    const progressMs = Math.max(0, body.progress_ms ?? 0);
    if (body.currently_playing_type !== 'track' || !item?.id) {
      const label = body.currently_playing_type === 'ad' ? 'Advertisement' : body.currently_playing_type === 'episode' ? 'Podcast episode' : '';
      return { kind: 'other', title: item?.name ?? label, playing, progressMs, durationMs: item?.duration_ms ?? 0, sampleEpochMs };
    }
    const track: SpotifyTrack = {
      id: item.id,
      title: item.name ?? '',
      artists: (item.artists ?? []).map((a) => a.name),
      album: item.album?.name ?? '',
      durationMs: item.duration_ms ?? 0,
      images: item.album?.images ?? [],
    };
    return { kind: 'track', track, playing, progressMs, sampleEpochMs };
  }

  /** One poll (adaptive polling). Returns the delay before the next one (−1: stop). */
  async pollOnce(): Promise<number> {
    if (!this.refreshToken) return -1;
    const r = await this.current();
    // The media session took over while the request was out.
    if (this.hybrid?.active) return -1;
    if (r.kind === 'error') return r.stop ? -1 : this.backoff(r.message);
    if (r.kind === 'limited') return r.waitMs;
    this.failures = 0;
    if (r.kind === 'idle') {
      this.applyTrack(null);
      this.set({ error: undefined, playing: false, trackId: null, title: '', artists: [], album: '', artDataUrl: undefined, durationMs: 0, progressMs: 0, sampleEpochMs: r.sampleEpochMs });
      return this.steady('idle');
    }
    if (r.kind === 'other') {
      // Podcast, ad or unknown: show what we can, no lyrics.
      this.applyTrack(null);
      this.set({ error: undefined, playing: r.playing, trackId: null, title: r.title, artists: [], album: '', artDataUrl: undefined, durationMs: r.durationMs, progressMs: r.progressMs, sampleEpochMs: r.sampleEpochMs });
      return r.playing ? this.steady('playing', r.progressMs, r.durationMs) : this.steady('paused');
    }
    const { playing, progressMs, sampleEpochMs } = r;
    const track = this.keepSmtcId(r.track);
    const changed = track.id !== this.state.trackId;
    this.set({
      error: undefined,
      playing,
      trackId: track.id,
      title: track.title,
      artists: track.artists,
      album: track.album,
      artDataUrl: changed ? undefined : this.state.artDataUrl,
      durationMs: track.durationMs,
      progressMs,
      sampleEpochMs,
    });
    if (changed) this.applyTrack(track);
    // Same song but no art yet (published from the media session, or the image failed): fetch it now.
    else if (!this.state.artDataUrl && this.artFor !== track.id) this.fetchArt(track.id, track.images);
    return playing ? this.steady('playing', progressMs, track.durationMs) : this.steady('paused');
  }

  /** Back to polling mid-song: a song published under a media-session id keeps it (no second lyrics load). */
  private keepSmtcId(track: SpotifyTrack): SpotifyTrack {
    const s = this.state;
    return s.trackId?.startsWith(SMTC_ID_PREFIX) && sameSong(track, { title: s.title, artist: s.artists.join(', ') }) ? { ...track, id: s.trackId } : track;
  }

  private applyTrack(track: SpotifyTrack | null): void {
    const id = track?.id ?? null;
    if (id === this.lastTrackId) return;
    this.lastTrackId = id;
    this.deps.onTrack?.(track);
    if (track) this.fetchArt(track.id, track.images);
  }

  private fetchArt(trackId: string, images: SpotifyTrack['images'], retry = true): void {
    const art = pickArt(images);
    if (!art) return;
    this.artFor = trackId;
    void fetchDataUrl(this.deps.fetch, art).then((dataUrl) => {
      if (this.state.trackId !== trackId) return;
      if (dataUrl) this.set({ artDataUrl: dataUrl });
      // One more try for a dropped image download.
      else if (retry) setTimeout(() => this.state.trackId === trackId && !this.state.artDataUrl && this.fetchArt(trackId, images, false), 3000);
    });
  }

  /** Play / pause / next / previous. Resolves to an error message, or null. */
  async control(cmd: SpotifyCommand): Promise<string | null> {
    if (!this.refreshToken) return 'Not connected to Spotify.';
    if (cmd === 'sync') {
      // The audio changed (a seek or a skip in Spotify itself): check now, or soon in hybrid mode.
      if (this.hybrid?.active) this.hybrid.sync();
      else this.schedule(0);
      return null;
    }
    const route: Record<Exclude<SpotifyCommand, 'sync'>, ['PUT' | 'POST', string]> = {
      play: ['PUT', '/me/player/play'],
      pause: ['PUT', '/me/player/pause'],
      next: ['POST', '/me/player/next'],
      previous: ['POST', '/me/player/previous'],
    };
    const [method, path] = route[cmd];
    let res: Response;
    try {
      res = await this.api(method, path);
    } catch (err) {
      return err instanceof SpotifyAuthError ? `Spotify: ${err.message}` : 'Spotify unreachable.';
    }
    if (res.status === 403) return 'Spotify Premium required for playback control.';
    if (res.status === 404) return 'No active Spotify device. Start playback in Spotify first.';
    if (res.status === 429) return 'Spotify rate limit. Try again in a moment.';
    if (!res.ok) return `Spotify error ${res.status}.`;
    if (cmd === 'play' || cmd === 'pause') {
      // Re-anchor the sample so the position freezes / resumes at once in both windows.
      const now = this.deps.now();
      const s = this.state;
      const progressMs = s.playing ? Math.min(s.durationMs || Infinity, s.progressMs + (now - s.sampleEpochMs)) : s.progressMs;
      this.set({ playing: cmd === 'play', progressMs, sampleEpochMs: now });
      this.hybrid?.expect(cmd === 'play');
    }
    // In hybrid mode the media session reports the result itself.
    if (!this.hybrid?.active) this.schedule(cmd === 'next' || cmd === 'previous' ? 250 : 400);
    return null;
  }

  dispose(): void {
    this.login?.close();
    this.halt();
  }
}
