// End-to-end check of hybrid now playing: a (mock) Windows media session leads
// and the Spotify Web API is only asked for exact checks. Runs the app with
// BOOFVIZ_SMTC_URL pointing at scripts/mock-services.mjs, whose media session
// follows the same mock player as its Web API. Checks lyrics in both windows,
// pause / resume / next from BOOFVIZ and from "Spotify itself", the request
// count against polling, a rate limit, Spotify closing and reopening, and that
// track ids never flip within a song.
//
//   npm run build && npm run lyrics:smtc:e2e      (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockServices } from './mock-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
const configDir = join(outDir, 'lyrics-smtc-config');
mkdirSync(outDir, { recursive: true });
rmSync(configDir, { recursive: true, force: true });

const mock = await startMockServices({ port: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const requests = () => mock.stats().apiTimes.length;
const smtcReads = () => mock.stats().counts['/smtc'] ?? 0;
const ctl = (path) => fetch(`${mock.url}${path}`).then((r) => r.json());
/** The mock player's position right now. */
const mockPosition = async () => (await ctl('/__stats')).player.progress;

const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const env = {
  ...process.env,
  XDG_CONFIG_HOME: configDir,
  BOOFVIZ_SPOTIFY_ACCOUNTS_URL: `${mock.url}/accounts`,
  BOOFVIZ_SPOTIFY_API_URL: `${mock.url}/v1`,
  BOOFVIZ_LRCLIB_URL: `${mock.url}/lrclib`,
  BOOFVIZ_SMTC_URL: `${mock.url}/smtc`,
  BOOFVIZ_OPEN_EXTERNAL: 'fetch',
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
};
const app = await electron.launch({ executablePath: electronPath, args, env, cwd: root });
const errors = [];
let control;
let output;
for (let i = 0; i < 150 && !(control && output); i++) {
  for (const w of app.windows()) {
    if (w.url().includes('control.html') && !control) control = w;
    if (w.url().includes('output.html') && !output) output = w;
  }
  await sleep(200);
}
for (const [name, w] of [['control', control], ['output', output]]) w?.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));

const dbg = (page, fn, arg) => page.evaluate(fn, arg);
/** Poll `fn` in `page` until it returns truthy (or time out). */
async function waitFor(page, fn, ms = 15000, arg) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
  }
  return null;
}
const button = (name) => control.getByRole('button', { name, exact: true }).first();
const outputPosition = () => dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now()).positionMs);
/** The song position the output window extrapolates from its last sample (no lyrics lead or offset). */
const songPosition = () =>
  dbg(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    const p = s.playing ? s.progressMs + (Date.now() - s.sampleEpochMs) : s.progressMs;
    return Math.max(0, s.durationMs > 0 ? Math.min(s.durationMs, p) : p);
  });
/** Every distinct track id and every lyrics broadcast the output window receives. */
async function recordOutput() {
  await output.evaluate(() => {
    window.__seen = { ids: [], loads: [] };
    window.boofviz.onNowPlaying((s) => {
      const ids = window.__seen.ids;
      if (ids[ids.length - 1] !== s.trackId) ids.push(s.trackId);
    });
    window.boofviz.onLyrics((l) => {
      if (l.loading) window.__seen.loads.push(l.trackId);
    });
  });
}
/** Song position in the output window vs the mock player (ms). */
async function positionGap() {
  const [a, b] = await Promise.all([songPosition(), mockPosition()]);
  return Math.abs(a - b);
}

try {
  check(!!control && !!output, 'control and output windows open');
  await control.waitForLoadState('load');
  await output.waitForLoadState('load');
  await sleep(1000);
  await recordOutput();

  // ---- No login: the song comes from the media session alone ------------------------
  const pre = await waitFor(control, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    return s.connected && s.source === 'media' && s.trackId ? s : null;
  });
  check(pre?.title === 'Paper Lanterns - 2011 Remaster' && pre.player === 'Spotify' && (mock.stats().counts['/v1/me/player/currently-playing'] ?? 0) === 0, `before any login: following Spotify through Windows, no Web API calls (${pre ? `${pre.title} via ${pre.player}` : 'nothing'})`);

  // ---- Connect --------------------------------------------------------------------
  await button('Lyrics').click();
  await control.getByPlaceholder('Spotify Client ID').fill('mock-client-id');
  await button('Connect').click();
  const np = await waitFor(control, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    return s.connected && s.trackId === 'mocktrack1' ? s : null;
  });
  check(np?.trackId === 'mocktrack1' && np.title === 'Paper Lanterns - 2011 Remaster', `connected; now playing the mock track under its Spotify id (${np ? `${np.trackId}: ${np.title}` : 'nothing'})`);
  const lyr = await waitFor(output, () => {
    const l = window.__BOOFVIZ_DEBUG__.trackLyrics();
    return l.trackId === 'mocktrack1' && !l.loading && l.source !== 'none' ? { source: l.source, lines: l.synced?.length ?? 0 } : null;
  });
  check(lyr?.source === 'lrclib' && lyr.lines > 10, `lyrics found (${lyr ? `${lyr.source}, ${lyr.lines} synced lines` : 'none'})`);
  const ctlLines = await dbg(control, () => window.__BOOFVIZ_DEBUG__.trackLyrics().synced?.length ?? 0);
  check(ctlLines === lyr?.lines, `control window has the same lyrics (${ctlLines} lines)`);
  await waitFor(control, () => !!document.querySelector('img[src^="data:image/"]'), 5000);

  // ---- Hybrid: far fewer Web API requests ----------------------------------------
  const n0 = requests();
  const reads0 = smtcReads();
  const t0 = Date.now();
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { overlay: { enabled: true, params: { kind: 'lyrics' } } } }));
  await waitFor(output, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay(), 8000);
  let same = 0;
  let worstPos = 0;
  for (let i = 0; i < 10; i++) {
    const at = Date.now() + 150;
    const a = await dbg(control, (ms) => window.__BOOFVIZ_DEBUG__.lyricsAt(ms), at);
    const b = await dbg(output, (ms) => window.__BOOFVIZ_DEBUG__.lyricsAt(ms), at);
    if (a.index === b.index && a.text === b.text && a.index >= 0) same++;
    worstPos = Math.max(worstPos, Math.abs(a.positionMs - b.positionMs));
    await sleep(370);
  }
  check(same >= 9 && worstPos < 40, `preview and output show the same line at the same instant (${same}/10, worst gap ${worstPos.toFixed(0)} ms)`);
  const gap0 = await positionGap();
  check(gap0 < 250, `song position matches the player (${gap0.toFixed(0)} ms off)`);
  await output.screenshot({ path: join(outDir, 'lyrics-smtc.png') });
  await sleep(Math.max(0, t0 + 20000 - Date.now()));
  const hybridRequests = requests() - n0;
  const reads = smtcReads() - reads0;
  check(hybridRequests <= 1, `hybrid mode: ${hybridRequests} currently-playing request(s) in 20 s`);
  check(reads >= 25, `media session read ${reads} times in 20 s`);

  // ---- Pause / resume from BOOFVIZ ----------------------------------------------------
  let n = requests();
  await button('Pause').click();
  await waitFor(output, () => !window.__BOOFVIZ_DEBUG__.nowPlaying().playing, 5000);
  await sleep(1300);
  const p1 = await outputPosition();
  await sleep(1500);
  const p2 = await outputPosition();
  check(Math.abs(p2 - p1) < 20 && mock.stats().player.playing === false, `Pause freezes the position (moved ${Math.abs(p2 - p1).toFixed(0)} ms in 1.5 s)`);
  await button('Play').click();
  await sleep(1500);
  const p3 = await outputPosition();
  check(p3 - p2 > 1000 && (await positionGap()) < 300, `Play resumes in step with the player (moved ${(p3 - p2).toFixed(0)} ms)`);
  check(requests() === n, `pause and play needed no currently-playing request (${requests() - n})`);

  // ---- In Spotify itself: the media session alone ------------------------------------
  n = requests();
  await ctl('/__player?action=pause');
  const paused = await waitFor(output, () => !window.__BOOFVIZ_DEBUG__.nowPlaying().playing, 3000);
  await sleep(600);
  const g1 = await positionGap();
  check(!!paused && g1 < 100, `pause in Spotify freezes the lyrics at the right spot (${g1.toFixed(0)} ms off)`);
  await ctl('/__player?action=play');
  const resumed = await waitFor(output, () => window.__BOOFVIZ_DEBUG__.nowPlaying().playing, 3000);
  await sleep(1000);
  const g2 = await positionGap();
  check(!!resumed && g2 < 150, `resume in Spotify (${g2.toFixed(0)} ms off)`);
  check(requests() === n, `pause and resume in Spotify needed no currently-playing request (${requests() - n})`);
  /** Seek in Spotify and wait for the output window to follow. */
  const seekTo = async (ms) => {
    await ctl(`/__player?action=seek&ms=${ms}`);
    return waitFor(
      output,
      (target) => {
        const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
        const p = s.progressMs + (s.playing ? Date.now() - s.sampleEpochMs : 0);
        return p > target - 1000 && p < target + 3000 ? Math.round(target / 1000) : null;
      },
      3000,
      ms,
    );
  };
  const seek1 = await seekTo(60000);
  await sleep(500);
  const g3 = await positionGap();
  check(seek1 === 60 && g3 < 150, `seek in Spotify moves the lyrics at once (${g3.toFixed(0)} ms off)`);
  await sleep(1500);
  check(requests() - n === 1, `the first seek is confirmed with one request (${requests() - n})`);
  n = requests();
  const seek2 = await seekTo(90000);
  await sleep(2000);
  const g3b = await positionGap();
  check(seek2 === 90 && g3b < 150 && requests() === n, `later seeks need no request (${g3b.toFixed(0)} ms off, ${requests() - n} request(s))`);

  // ---- Next from BOOFVIZ: one check names the new song ---------------------------------
  n = requests();
  await button('Next').click();
  const next = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    const l = window.__BOOFVIZ_DEBUG__.trackLyrics();
    const o = window.__BOOFVIZ_DEBUG__.lyricsOverlay();
    return s.trackId === 'mocktrack2' && l.trackId === 'mocktrack2' && !l.loading && o?.card ? { source: l.source, text: o.text } : null;
  });
  check(next?.source === 'none' && next.text.includes('Quiet Interlude'), `Next: the new song under its Spotify id, title card without lyrics ("${next?.text ?? ''}")`);
  check(requests() - n === 1, `one currently-playing request for the new song (${requests() - n})`);

  // ---- Next in Spotify itself ---------------------------------------------------------
  n = requests();
  await ctl('/__player?action=next');
  const back = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    const l = window.__BOOFVIZ_DEBUG__.trackLyrics();
    return s.trackId === 'mocktrack1' && l.trackId === 'mocktrack1' && !l.loading && l.synced?.length ? l.source : null;
  });
  check(back === 'cache', `next in Spotify: back to the first song, lyrics from the cache (${back})`);
  check(requests() - n === 1, `one request for it (${requests() - n})`);
  await sleep(1500);
  const g4 = await positionGap();
  check(g4 < 150, `in step with the player after the skip (${g4.toFixed(0)} ms off)`);

  // ---- Spotify closed: back to polling; reopened: hybrid again ------------------------
  await ctl('/smtc/__set?app=0');
  await sleep(4500);
  n = requests();
  await sleep(20000);
  const polled = requests() - n;
  check(polled >= 4, `Spotify gone from the media session: polling again (${polled} requests in 20 s)`);
  check(hybridRequests * 4 <= polled, `hybrid mode asks far less than polling (${hybridRequests} vs ${polled} requests per 20 s)`);
  await ctl('/smtc/__set?app=1');
  await sleep(2500);
  n = requests();
  await sleep(12000);
  const after = requests() - n;
  check(after <= 1, `Spotify back in the media session: hybrid again (${after} request(s) in 12 s)`);

  // ---- Rate limited: the media session carries on ------------------------------------
  n = requests();
  await ctl('/__limit?s=20');
  const limitEnds = Date.now() + 20000;
  await ctl('/__player?action=next');
  const limited = await waitFor(control, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    return s.trackId?.startsWith('smtc:') && s.title === 'Quiet Interlude' ? s : null;
  }, 8000);
  check(!!limited && /slow down/.test(limited.error ?? ''), `rate limited: the song comes from the media session ("${limited?.title}", "${limited?.error ?? ''}")`);
  await sleep(1000);
  await ctl('/__player?action=next');
  const smtcSong = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    const l = window.__BOOFVIZ_DEBUG__.trackLyrics();
    return s.trackId?.startsWith('smtc:') && s.title === 'Paper Lanterns - 2011 Remaster' && l.trackId === s.trackId && !l.loading && l.synced?.length ? { id: s.trackId, source: l.source, lines: l.synced.length } : null;
  }, 8000);
  check((smtcSong?.source === 'lrclib' || smtcSong?.source === 'cache') && smtcSong.lines > 10, `lyrics found from the media session's title, artist and length (${smtcSong ? `${smtcSong.source}, ${smtcSong.lines} lines` : 'none'})`);
  await sleep(1200);
  const g5 = await positionGap();
  const [la, lb] = await Promise.all([dbg(control, () => window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now() + 100)), dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now() + 100))]);
  check(g5 < 250 && la.index === lb.index && la.index >= 0, `and in step in both windows (${g5.toFixed(0)} ms off, line ${la.index} / ${lb.index})`);
  check(requests() - n === 1, `one (refused) request while rate limited (${requests() - n})`);
  await output.screenshot({ path: join(outDir, 'lyrics-smtc-limited.png') });
  await sleep(Math.max(0, limitEnds - Date.now() + 500));

  // ---- A switch to polling mid-song keeps the media-session id ------------------------
  await ctl('/smtc/__set?app=0');
  n = requests();
  await sleep(5000);
  const kept = await dbg(output, () => window.__BOOFVIZ_DEBUG__.nowPlaying().trackId);
  check(requests() > n && kept === smtcSong?.id, `polling names the same song: it keeps its id (${kept}, ${requests() - n} request(s))`);
  await ctl('/smtc/__set?app=1');
  await sleep(2000);

  // ---- One id per song, one lyrics load per song ------------------------------------------
  const seen = await dbg(output, () => window.__seen);
  const ids = seen.ids.filter((id) => id !== null);
  const expected = ['mocktrack1', 'mocktrack2', 'mocktrack1', limited?.trackId, smtcSong?.id];
  // Before the login the song was followed under its media-session id; logging in names it once with Spotify.
  check(JSON.stringify(ids) === JSON.stringify([pre?.trackId, ...expected]), `track ids never flip within a song (${ids.join(' → ')})`);
  check(JSON.stringify(seen.loads) === JSON.stringify(expected), `one lyrics lookup per song (${seen.loads.length})`);

  // ---- Disconnect -----------------------------------------------------------------------
  await button('Disconnect').click();
  // Logged out: no more Web API requests, and the player is still followed through Windows.
  const off = await waitFor(control, () => window.__BOOFVIZ_DEBUG__.nowPlaying().source === 'media', 5000);
  await sleep(1000);
  const r1 = requests();
  const s1 = smtcReads();
  await sleep(2500);
  check(!!off && requests() === r1 && smtcReads() > s1, `Disconnect stops the Web API and keeps following the player through Windows (${requests() - r1} request(s), ${smtcReads() - s1} reads)`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  check(false, `unexpected error: ${err.stack ?? err}`);
} finally {
  await app.close();
  await mock.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
