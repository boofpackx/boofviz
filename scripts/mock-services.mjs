// Local stand-ins for the Spotify accounts service, the Spotify Web API,
// Spotify's Windows media session (SMTC) and LRCLIB, for offline end-to-end
// tests (scripts/lyrics-e2e.mjs, scripts/lyrics-smtc-e2e.mjs).
//
//   node scripts/mock-services.mjs [port]      (default 43890)
//
// Point the app at it with
//   BOOFVIZ_SPOTIFY_ACCOUNTS_URL=http://127.0.0.1:<port>/accounts
//   BOOFVIZ_SPOTIFY_API_URL=http://127.0.0.1:<port>/v1
//   BOOFVIZ_LRCLIB_URL=http://127.0.0.1:<port>/lrclib
//   BOOFVIZ_SMTC_URL=http://127.0.0.1:<port>/smtc   (the media session, as the
//     PowerShell reader reports it; same player as the Web API)
//   BOOFVIZ_ARCHIVE_URL=http://127.0.0.1:<port>/archive   (Internet Archive search,
//     metadata and downloads; clips are ffmpeg test patterns)
//
// Test controls: /__player?action=pause|play|next|previous|seek[&ms=]
// (acting in Spotify itself, not through the Web API), /smtc/__set?app=0|1
// (Spotify closed / open), /__limit?s=N (the Web API answers 429 for N s).
//
// All lyric lines are invented placeholder text.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INVENTED = [
  'paper lanterns over the parking lot',
  'we count the static on the radio',
  'somebody left the porch light on',
  'and the vending machine hums in C',
  'tell me again about the yellow bus',
  'all the pigeons know my name by now',
  'ooh, the elevator music never ends',
  'cardboard castles in the rain',
  'we were orbiting the laundromat',
  'and the moon was a borrowed coin',
  'hold the door, hold the door',
  'paper lanterns, paper lanterns',
];

// Track 1 has synced lyrics on LRCLIB (under its normalized title); track 2 has none anywhere.
export const TRACKS = [
  { id: 'mocktrack1', name: 'Paper Lanterns - 2011 Remaster', lookupName: 'Paper Lanterns', artist: 'The Placeholder Ensemble', album: 'Invented Weather', durationMs: 180000, color: '#ff2e88' },
  { id: 'mocktrack2', name: 'Quiet Interlude', lookupName: 'Quiet Interlude', artist: 'Nobody In Particular', album: 'Blank Tapes', durationMs: 120000, color: '#39d5ff' },
];

/** One line every 2.5 s from 1 s in, cycling through the invented lines. */
export function syncedLyrics(durationMs) {
  const out = [];
  for (let t = 1000, i = 0; t < durationMs - 2000; t += 2500, i++) {
    const m = Math.floor(t / 60000);
    const s = ((t % 60000) / 1000).toFixed(2).padStart(5, '0');
    out.push(`[${String(m).padStart(2, '0')}:${s}]${INVENTED[i % INVENTED.length]}`);
  }
  return out.join('\n');
}

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Invented archive items: each is an ffmpeg test pattern, made on first download. */
export const ARCHIVE_ITEMS = [
  { identifier: 'MockFilm1957', title: 'Your Friend The Kitchen (invented)', year: 1957, source: 'smptebars' },
  { identifier: 'MockFilm1964', title: 'Highways Of Tomorrow (invented)', year: 1964, source: 'testsrc' },
  { identifier: 'MockFilm1972', title: 'A Day At The Plant (invented)', year: 1972, source: 'testsrc2' },
];

function archiveClip(item) {
  const file = join(tmpdir(), `boofviz-mock-${item.identifier}.mp4`);
  if (!existsSync(file)) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `${item.source}=size=320x240:rate=25`, '-t', '24', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-g', '25', '-movflags', '+faststart', file]);
  }
  return readFileSync(file);
}

export function startMockServices({ port = 43890, host = '127.0.0.1' } = {}) {
  const counts = {};
  const apiTimes = [];
  const codes = new Map(); // code → { challenge, clientId, redirectUri }
  const access = new Set();
  const refresh = new Set();
  // Player state: progress advances in real time while playing. The anchor moves
  // on every play / pause / seek / skip, like the media session's timeline.
  const player = { index: 0, playing: true, anchorProgress: 0, anchorAt: Date.now() };
  const smtc = { app: true };
  let limitedUntil = 0;
  const progress = () => {
    const t = TRACKS[player.index];
    const p = player.anchorProgress + (player.playing ? Date.now() - player.anchorAt : 0);
    return Math.min(t.durationMs, Math.max(0, p));
  };
  const setPlayer = (patch) => {
    const p = progress();
    Object.assign(player, { anchorProgress: p, anchorAt: Date.now() }, patch);
  };
  let base = '';
  let archiveStalled = false;

  const send = (res, status, body, headers = {}) => {
    const isJson = body !== undefined && typeof body !== 'string';
    res.writeHead(status, { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers });
    res.end(body === undefined ? undefined : isJson ? JSON.stringify(body) : body);
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });
  const issue = () => {
    const at = `at_${b64url(randomBytes(12))}`;
    const rt = `rt_${b64url(randomBytes(12))}`;
    access.add(at);
    refresh.add(rt);
    return { access_token: at, token_type: 'Bearer', expires_in: 3600, refresh_token: rt, scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state' };
  };
  const record = (t) => ({ id: TRACKS.indexOf(t) + 1, trackName: t.lookupName, artistName: t.artist, albumName: t.album, duration: t.durationMs / 1000, instrumental: false, plainLyrics: INVENTED.join('\n'), syncedLyrics: syncedLyrics(t.durationMs) });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const path = url.pathname;
    counts[path] = (counts[path] ?? 0) + 1;
    const q = url.searchParams;

    // ---- Internet Archive ------------------------------------------------------
    if (path === '/archive/__stall') {
      archiveStalled = q.get('on') === '1';
      return send(res, 200, { stalled: archiveStalled });
    }
    // A stalled connection: requests hang (the app should fall back to its cache).
    if (archiveStalled && path.startsWith('/archive/')) return;
    if (path === '/archive/advancedsearch.php') {
      const rows = Number(q.get('rows') ?? 50);
      return send(res, 200, { response: { numFound: ARCHIVE_ITEMS.length, docs: rows ? ARCHIVE_ITEMS.map(({ identifier, title, year }) => ({ identifier, title, year })) : [] } });
    }
    if (path.startsWith('/archive/metadata/')) {
      const item = ARCHIVE_ITEMS.find((i) => i.identifier === decodeURIComponent(path.split('/')[3]));
      if (!item) return send(res, 200, {});
      return send(res, 200, {
        metadata: { title: item.title, year: String(item.year) },
        files: [
          { name: `${item.identifier}.ogv`, format: 'Ogg Video', size: '900000' },
          { name: `${item.identifier}_512kb.mp4`, format: '512Kb MPEG4', size: '400000', length: '24.0' },
          { name: `${item.identifier}.mp4`, format: 'h.264', size: '2000000', length: '24.0' },
        ],
      });
    }
    if (path.startsWith('/archive/download/')) {
      const item = ARCHIVE_ITEMS.find((i) => i.identifier === decodeURIComponent(path.split('/')[3]));
      if (!item) return send(res, 404, 'no such item');
      const buf = archiveClip(item);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length });
      return res.end(buf);
    }

    // ---- Accounts -----------------------------------------------------------
    if (path === '/accounts/authorize' && req.method === 'GET') {
      const redirectUri = q.get('redirect_uri') ?? '';
      if (!q.get('client_id') || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !redirectUri.startsWith('http://127.0.0.1:')) {
        return send(res, 400, { error: 'invalid_request' });
      }
      const code = `code_${b64url(randomBytes(9))}`;
      codes.set(code, { challenge: q.get('code_challenge'), clientId: q.get('client_id'), redirectUri });
      const to = new URL(redirectUri);
      to.searchParams.set('code', code);
      to.searchParams.set('state', q.get('state') ?? '');
      return send(res, 302, '', { Location: to.toString() });
    }
    if (path === '/accounts/api/token' && req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req));
      if (f.get('grant_type') === 'authorization_code') {
        const c = codes.get(f.get('code'));
        codes.delete(f.get('code'));
        const verifier = f.get('code_verifier') ?? '';
        if (!c || c.clientId !== f.get('client_id') || c.redirectUri !== f.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid authorization code' });
        if (b64url(createHash('sha256').update(verifier).digest()) !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'code_verifier was incorrect' });
        return send(res, 200, issue());
      }
      if (f.get('grant_type') === 'refresh_token') {
        const rt = f.get('refresh_token');
        if (!rt || !refresh.has(rt) || !f.get('client_id')) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid refresh token' });
        refresh.delete(rt); // rotation: the old refresh token stops working
        return send(res, 200, issue());
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }

    // ---- Media session (SMTC) and test controls -------------------------------
    if (path === '/smtc') {
      const now = Date.now();
      if (!smtc.app) return send(res, 200, { ok: true, app: null, title: '', artist: '', album: '', status: 'closed', positionMs: null, startMs: null, endMs: null, updatedEpochMs: null, sampleEpochMs: now });
      const t = TRACKS[player.index];
      const p = progress();
      const ended = player.playing && p >= t.durationMs;
      return send(res, 200, { ok: true, app: 'Spotify.exe', title: t.name, artist: t.artist, album: t.album, status: player.playing && !ended ? 'playing' : 'paused', positionMs: Math.round(player.anchorProgress), startMs: 0, endMs: t.durationMs, updatedEpochMs: player.anchorAt, sampleEpochMs: now });
    }
    if (path === '/smtc/__set') {
      if (q.has('app')) smtc.app = q.get('app') === '1';
      return send(res, 200, { ...smtc });
    }
    if (path === '/__limit') {
      limitedUntil = Date.now() + Number(q.get('s') ?? 0) * 1000;
      return send(res, 200, { limitedUntil });
    }
    if (path === '/__player' || (path === '/smtc/command' && req.method === 'POST')) {
      // Test controls, or a playback command sent to the player through the media session.
      const action = q.get('action') ?? q.get('cmd');
      if (action === 'pause' || action === 'play') setPlayer({ playing: action === 'play' });
      else if (action === 'seek') Object.assign(player, { anchorProgress: Math.max(0, Number(q.get('ms') ?? 0)), anchorAt: Date.now() });
      else if (action === 'next') Object.assign(player, { index: (player.index + 1) % TRACKS.length, playing: true, anchorProgress: 0, anchorAt: Date.now() });
      else if (action === 'previous') Object.assign(player, { index: (player.index + TRACKS.length - 1) % TRACKS.length, playing: true, anchorProgress: 0, anchorAt: Date.now() });
      else return send(res, 400, { error: 'unknown action' });
      return send(res, 200, { ...player, progress: progress() });
    }

    // ---- Web API ------------------------------------------------------------
    if (path.startsWith('/v1/')) {
      const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!access.has(auth)) return send(res, 401, { error: { status: 401, message: 'Invalid access token' } });
      if (path === '/v1/me/player/currently-playing' && req.method === 'GET') {
        apiTimes.push(Date.now());
        const wait = limitedUntil - Date.now();
        if (wait > 0) return send(res, 429, { error: { status: 429, message: 'API rate limit exceeded' } }, { 'Retry-After': String(Math.ceil(wait / 1000)) });
        const t = TRACKS[player.index];
        return send(res, 200, {
          timestamp: Date.now(),
          is_playing: player.playing,
          progress_ms: progress(),
          currently_playing_type: 'track',
          item: {
            id: t.id,
            name: t.name,
            duration_ms: t.durationMs,
            artists: [{ name: t.artist }],
            album: { name: t.album, images: [640, 300, 64].map((w) => ({ url: `${base}/art/${t.id}-${w}.svg`, width: w, height: w })) },
          },
        });
      }
      if ((path === '/v1/me/player/pause' || path === '/v1/me/player/play') && req.method === 'PUT') {
        setPlayer({ playing: path.endsWith('/play') });
        return send(res, 204);
      }
      if (path === '/v1/me/player/next' && req.method === 'POST') {
        Object.assign(player, { index: (player.index + 1) % TRACKS.length, playing: true, anchorProgress: 0, anchorAt: Date.now() });
        return send(res, 204);
      }
      if (path === '/v1/me/player/previous' && req.method === 'POST') {
        const index = progress() > 3000 ? player.index : (player.index + TRACKS.length - 1) % TRACKS.length;
        Object.assign(player, { index, playing: true, anchorProgress: 0, anchorAt: Date.now() });
        return send(res, 204);
      }
      return send(res, 404, { error: { status: 404, message: 'Not found' } });
    }
    const art = /^\/art\/(\w+)-(\d+)\.svg$/.exec(path);
    if (art) {
      const t = TRACKS.find((x) => x.id === art[1]);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${art[2]}" height="${art[2]}" viewBox="0 0 10 10"><rect width="10" height="10" fill="#111"/><circle cx="5" cy="5" r="3.5" fill="${t?.color ?? '#888'}"/></svg>`;
      return send(res, 200, svg, { 'Content-Type': 'image/svg+xml' });
    }

    // ---- LRCLIB -------------------------------------------------------------
    if (path === '/lrclib/get') {
      const t = TRACKS.find((x) => key(x.lookupName) === key(q.get('track_name')) && key(x.artist) === key(q.get('artist_name')) && Math.abs(x.durationMs / 1000 - Number(q.get('duration'))) <= 2);
      if (!t || t.id === 'mocktrack2') return send(res, 404, { code: 404, name: 'TrackNotFound', message: 'Failed to find specified track' });
      return send(res, 200, record(t));
    }
    if (path === '/lrclib/search') {
      const t = TRACKS.find((x) => key(x.lookupName) === key(q.get('track_name')));
      if (!t || t.id === 'mocktrack2') return send(res, 200, []);
      // A decoy edit with the wrong length, then the real one.
      return send(res, 200, [{ ...record(t), id: 99, duration: t.durationMs / 1000 + 30, syncedLyrics: '[00:01.00]wrong edit' }, record(t)]);
    }

    if (path === '/__stats') return send(res, 200, { counts, apiTimes, player: { ...player, progress: progress() } });
    return send(res, 404, { error: 'not found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      base = `http://${host}:${actual}`;
      resolve({ server, port: actual, url: base, stats: () => ({ counts: { ...counts }, apiTimes: [...apiTimes], player: { ...player } }), close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMockServices({ port: Number(process.argv[2] ?? process.env.BOOFVIZ_MOCK_PORT ?? 43890) });
  console.log(`Mock Spotify + LRCLIB on ${m.url}  (accounts ${m.url}/accounts · api ${m.url}/v1 · lrclib ${m.url}/lrclib)`);
}
