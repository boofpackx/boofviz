// Frames of looks with the mock song's synced lyrics playing, for grading:
//   npm run build && xvfb-run -a node scripts/hero-capture.mjs builtin:step-chart [more ids…]
// Frames go to test-output/hero/<slug>-<n>.png (6 per look, 1.7 s apart).
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockServices } from './mock-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output', 'hero');
const configDir = join(root, 'test-output', 'hero-config');
mkdirSync(outDir, { recursive: true });
rmSync(configDir, { recursive: true, force: true });
const ids = process.argv.slice(2);
const frames = Number(process.env.FRAMES ?? 6);
const gap = Number(process.env.GAP_MS ?? 1700);

const mock = await startMockServices({ port: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
for (const [name, w] of [
  ['control', control],
  ['output', output],
])
  w?.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
const dbg = (page, fn, arg) => page.evaluate(fn, arg);
try {
  await control.waitForLoadState('load');
  await sleep(1000);
  await output.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
  await control.getByRole('button', { name: 'Lyrics', exact: true }).first().click();
  await control.getByPlaceholder('Spotify Client ID').fill('mock-client-id');
  await control.getByRole('button', { name: 'Connect', exact: true }).first().click();
  for (let i = 0; i < 100; i++) {
    const ok = await dbg(control, () => (window.__BOOFVIZ_DEBUG__.trackLyrics().synced?.length ?? 0) > 0).catch(() => false);
    if (ok) break;
    await sleep(200);
  }
  if (process.env.LYRICS_MODE) await dbg(control, (mode) => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { mode } }), process.env.LYRICS_MODE);
  // STYLES=steps,press: capture each look once per lyric style, in Everywhere.
  const styles = process.env.STYLES ? process.env.STYLES.split(',') : [null];
  for (const style of styles)
    for (const id of ids) {
      if (style) await dbg(control, (t) => window.__BOOFVIZ_DEBUG__.updateSettings({ lyrics: { mode: 'everywhere', allLooks: t } }), style);
      await dbg(control, (x) => window.__BOOFVIZ_DEBUG__.load(x), id);
      await sleep(2500);
      const slug = id.replace(/^.*:/, '') + (style ? `-${style}` : '');
      for (let n = 0; n < frames; n++) {
        await output.screenshot({ path: join(outDir, `${slug}-${n}.png`) });
        await sleep(gap);
      }
      console.log(`captured ${slug}`);
    }
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
} finally {
  await app.close().catch(() => {});
  await mock.close?.();
}
