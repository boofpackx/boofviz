// End-to-end check of archive footage against a local mock Internet Archive
// (scripts/mock-services.mjs): search → metadata → one cached download →
// playback in both windows, the same clip in preview and output, a clip
// change on the slot boundary, and the lyrics toggle.
//   npm run build && npm run archive:e2e        (Linux CI: wrap in xvfb-run)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { startMockServices } from './mock-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
const configDir = join(outDir, 'archive-config');
mkdirSync(outDir, { recursive: true });
rmSync(configDir, { recursive: true, force: true });

// One of "my videos": a generated clip in the user's videos folder.
const videosDir = join(configDir, 'BOOFVIZ', 'videos');
mkdirSync(videosDir, { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=size=320x240:rate=25', '-t', '12', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', join(videosDir, 'My_Band_Live.mp4')]);
const mock = await startMockServices({ port: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const env = { ...process.env, XDG_CONFIG_HOME: configDir, BOOFVIZ_ARCHIVE_URL: `${mock.url}/archive`, BOOFVIZ_ARCHIVE_WAIT_MS: '2500', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
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
async function waitFor(page, fn, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
  }
  return null;
}

try {
  check(!!control && !!output, 'control and output windows open');
  await control.waitForLoadState('load');
  await sleep(1000);
  const ok = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.load('builtin:archive-ad-break'));
  check(ok, 'archive preset loads');
  // Before any footage has arrived the screen shows filler programming, not snow.
  const early = (await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.archive();
    return s.showing ? s : null;
  }, 5000)) ?? { showing: false };
  check(!!early.showing, `something is on screen before the first clip arrives (${early.filler ? `filler: ${early.title}` : early.title || 'nothing'})`);

  const a = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.archive();
    return s.showing && !s.filler ? s : null;
  }, 40000);
  check(!!a, `output plays an archive clip (${a ? `${a.title}, ${a.year}` : 'nothing'})`);
  const b = await waitFor(control, () => {
    const s = window.__BOOFVIZ_DEBUG__.archive();
    return s.showing && !s.filler ? s : null;
  }, 20000);
  check(!!b && b.title === a?.title, `preview plays the same clip (${b?.title ?? 'nothing'})`);
  check(/invented/.test(a?.title ?? ''), 'clip came from the (mock) archive search');
  const stats = mock.stats().counts;
  const downloads = Object.entries(stats).filter(([p]) => p.startsWith('/archive/download/'));
  check(downloads.length >= 1 && downloads.every(([, n]) => n === 1), `each clip downloaded once for both windows (${downloads.map(([p, n]) => `${p.split('/')[3]}×${n}`).join(', ')})`);
  await sleep(1500);
  await output.screenshot({ path: join(outDir, 'archive-output.png') });
  await control.screenshot({ path: join(outDir, 'archive-control.png') });

  // "Next clip" (macro 2) bumps the slot: both windows switch to a different film.
  await control.evaluate(() => window.__BOOFVIZ_DEBUG__.show().setMacro(1, 0.05));
  let switched = null;
  for (const end = Date.now() + 30000; Date.now() < end && !switched; await sleep(200)) {
    const s = await output.evaluate(() => window.__BOOFVIZ_DEBUG__.archive());
    if (s.showing && !s.filler && s.title !== a?.title) switched = s.title;
  }
  check(!!switched, `Next clip switches the output to another film (${switched ?? 'still the same'})`);
  let previewSwitched = null;
  for (const end = Date.now() + 15000; Date.now() < end && !previewSwitched; await sleep(200)) {
    const s = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.archive());
    if (s.showing && !s.filler && s.title === switched) previewSwitched = s.title;
  }
  check(!!previewSwitched, 'the preview switches to the same film');
  await output.screenshot({ path: join(outDir, 'archive-output-next.png') });

  // A stalled connection: the next clip falls back to footage already in the cache.
  await fetch(`${mock.url}/archive/__stall?on=1`);
  await control.evaluate(() => window.__BOOFVIZ_DEBUG__.show().setMacro(1, 0.1));
  let fallback = null;
  for (const end = Date.now() + 12000; Date.now() < end && !fallback; await sleep(250)) {
    const s = await output.evaluate(() => window.__BOOFVIZ_DEBUG__.archive());
    if (s.showing && !s.filler && s.title !== switched) fallback = s.title;
  }
  check(!!fallback, `with the connection stalled, a cached clip plays instead of static (${fallback ?? 'none'})`);
  await fetch(`${mock.url}/archive/__stall?on=0`);

  // Channel surfing on a TV set: a channel number, and the set drawn around the picture.
  check(await control.evaluate(() => window.__BOOFVIZ_DEBUG__.load('builtin:retro-tv-channel-surfing-88')), 'retro TV preset loads');
  const ch = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.archive();
    return s.showing && !s.filler && s.channel ? s : null;
  }, 30000);
  check(!!ch, `channel surfing shows a channel (${ch ? `CH ${ch.channel}: ${ch.title}` : 'none'})`);
  await sleep(2500);
  await output.screenshot({ path: join(outDir, 'archive-retro-tv.png') });
  // The global "watch on a TV" switch over an ordinary look.
  await control.evaluate(() => window.__BOOFVIZ_DEBUG__.updateSettings({ retroTv: { enabled: true, set: 'screen' } }));
  await control.evaluate(() => window.__BOOFVIZ_DEBUG__.load('builtin:lost-media-emergency-test'));
  await sleep(2500);
  await output.screenshot({ path: join(outDir, 'archive-global-tv.png') });

  // My videos: the user's own clip plays through the retro chain.
  check(await control.evaluate(() => window.__BOOFVIZ_DEBUG__.load('builtin:retro-tv-my-music-videos')), 'my-videos look loads');
  const mine = await waitFor(output, () => {
    const s = window.__BOOFVIZ_DEBUG__.archive();
    return s.showing && !s.filler && /My Band Live/.test(s.title) ? s : null;
  }, 20000);
  check(!!mine, `plays the clip from the videos folder (${mine?.title ?? 'nothing'})`);
  await sleep(2000);
  await output.screenshot({ path: join(outDir, 'archive-my-videos.png') });

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  check(false, `exception: ${err?.stack ?? err}`);
} finally {
  await app.close().catch(() => undefined);
  await mock.close();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed. Screenshots in ${outDir}`);
