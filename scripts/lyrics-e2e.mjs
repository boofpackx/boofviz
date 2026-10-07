// End-to-end check of Spotify now playing + synced lyrics against local mock
// services (scripts/mock-services.mjs): PKCE login, now playing, LRCLIB lookup,
// the lyrics overlay in sync in preview and output, pause, next track and
// disconnect.
//
//   npm run build && npm run lyrics:e2e      (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockServices } from './mock-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
const configDir = join(outDir, 'lyrics-config');
mkdirSync(outDir, { recursive: true });
rmSync(configDir, { recursive: true, force: true });
const tokenFile = join(configDir, 'BOOFVIZ', 'spotify-token.bin');

const mock = await startMockServices({ port: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const env = {
  ...process.env,
  XDG_CONFIG_HOME: configDir,
  BOOFVIZ_SPOTIFY_ACCOUNTS_URL: `${mock.url}/accounts`,
  BOOFVIZ_SPOTIFY_API_URL: `${mock.url}/v1`,
  BOOFVIZ_LRCLIB_URL: `${mock.url}/lrclib`,
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
async function waitFor(page, fn, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
  }
  return null;
}
const button = (name) => control.getByRole('button', { name, exact: true }).first();

try {
  check(!!control && !!output, 'control and output windows open');
  await control.waitForLoadState('load');
  await sleep(1000);

  // ---- Connect (PKCE against the mock accounts service) ---------------------
  await button('Lyrics').click();
  await control.getByPlaceholder('Spotify Client ID').fill('mock-client-id');
  await button('Connect').click();
  const np = await waitFor(control, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    return s.connected && s.trackId ? s : null;
  });
  check(!!np && np.trackId === 'mocktrack1' && np.title === 'Paper Lanterns - 2011 Remaster' && np.artists[0] === 'The Placeholder Ensemble', `connected; now playing the mock track (${np ? `${np.title} by ${np.artists.join(', ')}` : 'nothing'})`);
  check((await dbg(control, () => window.__BOOFVIZ_DEBUG__.settings().spotify.clientId)) === 'mock-client-id', 'client id saved in settings');
  const card = control.getByText('Paper Lanterns - 2011 Remaster', { exact: true });
  check(await card.isVisible(), 'now-playing card shows the track');
  const art = await waitFor(control, () => !!document.querySelector('img[src^="data:image/"]'), 5000);
  check(!!art, 'album art arrives as a data: URL');

  // ---- Lyrics lookup ----------------------------------------------------------
  const lyr = await waitFor(control, () => {
    const l = window.__BOOFVIZ_DEBUG__.trackLyrics();
    return l.trackId === 'mocktrack1' && !l.loading && l.source !== 'none' ? { source: l.source, lines: l.synced?.length ?? 0 } : null;
  });
  check(lyr?.source === 'lrclib' && lyr.lines > 10, `lyrics found on (mock) LRCLIB via the normalized title (${lyr ? `${lyr.source}, ${lyr.lines} synced lines` : 'none'})`);
  const outLyr = await waitFor(output, () => window.__BOOFVIZ_DEBUG__.trackLyrics().synced?.length ?? 0, 5000);
  check(outLyr === lyr?.lines, `output window received the same lyrics (${outLyr} lines)`);

  // ---- Overlay: same line in preview and output -------------------------------
  // The classic line overlay first (new installs default to music-video lyrics, checked further down).
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { overlay: { params: { kind: 'lyrics' } } } }));
  await control.getByRole('button', { name: /Show lyrics over every look/ }).click();
  const on = await waitFor(output, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay(), 8000);
  check(!!on, 'overlay is on in the output window');
  check(!!(await dbg(control, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay())), 'overlay is on in the preview');
  let same = 0;
  let worstPos = 0;
  for (let i = 0; i < 10; i++) {
    const at = Date.now() + 150;
    const a = await dbg(control, (ms) => window.__BOOFVIZ_DEBUG__.lyricsAt(ms), at);
    const b = await dbg(output, (ms) => window.__BOOFVIZ_DEBUG__.lyricsAt(ms), at);
    if (a.index === b.index && a.text === b.text) same++;
    worstPos = Math.max(worstPos, Math.abs(a.positionMs - b.positionMs));
    await sleep(370);
  }
  check(same >= 9 && worstPos < 40, `preview and output agree on the current line at the same instant (${same}/10 samples, worst position gap ${worstPos.toFixed(0)} ms)`);
  // What each renderer actually drew last frame (frames are not simultaneous, so allow a boundary).
  let rendered = 0;
  let renderedSame = 0;
  for (let i = 0; i < 8; i++) {
    const [a, b] = await Promise.all([dbg(control, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay()), dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay())]);
    if (a && b && a.index >= 0) rendered++;
    if (a && b && Math.abs(a.index - b.index) <= 1) renderedSame += a.index === b.index ? 1 : 0.5;
    await sleep(410);
  }
  check(rendered === 8 && renderedSame >= 6, `both renderers draw the same line (${renderedSame}/8 frames identical, ${rendered}/8 with a line)`);
  const shown = await dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay());
  check(!!shown?.text && !shown.card, `output overlay shows a lyric line ("${shown?.text}")`);
  await output.screenshot({ path: join(outDir, 'lyrics.png') });
  await control.screenshot({ path: join(outDir, 'lyrics-control.png') });

  // ---- Text looks sing along ------------------------------------------------------
  await control.getByRole('button', { name: /Show lyrics over every look/ }).click();
  check((await dbg(output, () => window.__BOOFVIZ_DEBUG__.liveText('text'))).kind === 'text', 'text looks keep their own words by default');
  await control.getByRole('button', { name: /Put lyrics into text looks/ }).click();
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.load('builtin:space-crawl'));
  await sleep(2500);
  const sung = await dbg(output, () => ({ live: window.__BOOFVIZ_DEBUG__.liveText('text'), at: window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now()) }));
  const singing = sung.live.kind === 'lyrics' && sung.live.lines[sung.live.current] === (sung.at.text || '♪');
  check(singing, `text looks show the line being sung ("${sung.live.lines[sung.live.current] ?? ''}", ${sung.live.lines.length} lines in the crawl window)`);
  await output.screenshot({ path: join(outDir, 'lyrics-crawl.png') });
  await control.getByRole('button', { name: /Put lyrics into text looks/ }).click();
  await control.getByRole('button', { name: /Show lyrics over every look/ }).click();
  await waitFor(output, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay(), 8000);

  // ---- Music-video lyrics over a look -------------------------------------------
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.load('builtin:twist-cube'));
  for (const style of ['drop', 'slam', 'shuffle', 'zoomthrough', 'stack', 'orbit3d']) {
    await dbg(control, (st) => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { overlay: { params: { kind: 'lyricVideo', style: st } } } }), style);
    await sleep(1800);
    await output.screenshot({ path: join(outDir, `lyrics-video-${style}.png`) });
  }
  const vid = await dbg(output, () => ({ info: window.__BOOFVIZ_DEBUG__.lyricsOverlay(), at: window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now()) }));
  check(!!vid.info && vid.info.index >= 0 && Math.abs(vid.info.index - vid.at.index) <= 1 && !!vid.info.text, `music-video lyrics show the sung line over the look ("${vid.info?.text ?? ''}")`);
  const [va, vb] = await Promise.all([dbg(control, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay()), dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsOverlay())]);
  check(!!va && !!vb && Math.abs(va.index - vb.index) <= 1, `preview and output agree on the music-video line (${va?.index} / ${vb?.index})`);
  // Lyric Cinema styles with the real synced lines (the mock song repeats lines, so it has a chorus).
  for (const style of ['credits', 'teletext', 'infomercial', 'ransom']) {
    await dbg(control, (st) => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { overlay: { params: { kind: 'lyricVideo', style: st } } } }), style);
    await sleep(1800);
    await output.screenshot({ path: join(outDir, `lyrics-cinema-${style}.png`) });
  }
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { overlay: { enabled: false, params: { kind: 'lyrics' } } } }));
  // ---- The song as TV: the music channel with the real album art -------------------
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.load('builtin:retro-tv-music-channel-96'));
  await sleep(2500);
  await output.screenshot({ path: join(outDir, 'lyrics-music-channel.png') });
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.load('builtin:retro-tv-album-art-tv'));
  await sleep(2500);
  await output.screenshot({ path: join(outDir, 'lyrics-album-art-tv.png') });
  // Back to a look without its own captions, so the overlay checks below see the overlay.
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.load('builtin:twist-cube'));
  await dbg(control, () => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { overlay: { enabled: true } } }));
  await sleep(600);

  // ---- Pause freezes the position ---------------------------------------------
  await button('Pause').click();
  await waitFor(control, () => !window.__BOOFVIZ_DEBUG__.nowPlaying().playing, 5000);
  await sleep(1300); // let a poll confirm the paused state
  const p1 = await dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now()).positionMs);
  await sleep(1500);
  const p2 = await dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now()).positionMs);
  check(Math.abs(p2 - p1) < 20 && mock.stats().player.playing === false, `pause freezes the song position (moved ${Math.abs(p2 - p1).toFixed(0)} ms in 1.5 s)`);
  await button('Play').click();
  await sleep(1500);
  const p3 = await dbg(output, () => window.__BOOFVIZ_DEBUG__.lyricsAt(Date.now()).positionMs);
  check(p3 - p2 > 1000, `play resumes (moved ${(p3 - p2).toFixed(0)} ms)`);

  // ---- Next track: no lyrics → title card ----------------------------------------
  await button('Next').click();
  const next = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    const l = window.__BOOFVIZ_DEBUG__.trackLyrics();
    const o = window.__BOOFVIZ_DEBUG__.lyricsOverlay();
    return s.trackId === 'mocktrack2' && l.trackId === 'mocktrack2' && !l.loading && o?.card ? { source: l.source, text: o.text } : null;
  });
  check(next?.source === 'none', `next track switches lyrics (source ${next?.source ?? '?'})`);
  check(!!next?.text.includes('Quiet Interlude') && next.text.includes('Nobody In Particular'), `title card shown for the track without lyrics ("${next?.text ?? ''}")`);
  await sleep(500);
  await output.screenshot({ path: join(outDir, 'lyrics-card.png') });

  // ---- Disconnect clears the token ---------------------------------------------------
  const storedBefore = existsSync(tokenFile);
  console.log(`      refresh token ${storedBefore ? 'was stored encrypted on disk' : 'was kept in memory only (no OS keychain here)'}`);
  await button('Disconnect').click();
  const off = await waitFor(control, () => !window.__BOOFVIZ_DEBUG__.nowPlaying().connected, 5000);
  check(!!off && !existsSync(tokenFile), 'Disconnect clears the stored token');
  const n1 = mock.stats().apiTimes.length;
  await sleep(2500);
  const n2 = mock.stats().apiTimes.length;
  check(n2 === n1, `polling stops after Disconnect (${n2 - n1} requests in 2.5 s)`);
  const idle = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.nowPlaying();
    return !s.connected && s.trackId === null;
  }, 3000);
  check(!!idle, 'output window shows nothing playing after Disconnect');
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  check(false, `unexpected error: ${err.stack ?? err}`);
} finally {
  await app.close();
  await mock.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
