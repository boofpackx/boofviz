// Loads every built-in preset and template in the running app, plays a test
// track, and screenshots the clean output window for each. Fails on any page or
// shader error.   npm run build && npm run tour   (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output', 'tour');
mkdirSync(outDir, { recursive: true });
const wav = join(root, 'test-output', 'test-128bpm.wav');
if (!existsSync(wav)) execFileSync(process.execPath, [join(root, 'scripts/make-test-track.mjs'), wav], { stdio: 'inherit' });
const dwell = Number(process.env.TOUR_DWELL_MS ?? 2500);
const only = process.argv[2];

const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const app = await electron.launch({ executablePath: electronPath, args, env: { ...process.env, XDG_CONFIG_HOME: join(outDir, 'config') }, cwd: root });
const errors = [];
let control;
let output;
for (let i = 0; i < 150 && !(control && output); i++) {
  for (const w of app.windows()) {
    if (w.url().includes('control.html') && !control) control = w;
    if (w.url().includes('output.html') && !output) output = w;
  }
  await new Promise((r) => setTimeout(r, 200));
}
let current = '(startup)';
for (const [name, w] of [['control', control], ['output', output]]) {
  w.on('pageerror', (e) => errors.push(`${current} ${name}: ${e.message}`));
  w.on('console', (m) => {
    if (m.type() === 'error' || /Shader Error|WebGLProgram/.test(m.text())) errors.push(`${current} ${name}: ${m.text().slice(0, 400)}`);
  });
}
try {
  await control.waitForLoadState('load');
  await new Promise((r) => setTimeout(r, 1500));
  // The file input lives in the Input tab.
  await control.getByRole('button', { name: 'Input', exact: true }).click();
  await control.setInputFiles('input[type=file]', wav);
  await new Promise((r) => setTimeout(r, 4000));
  const ids = (await control.evaluate(() => window.__BOOFVIZ_DEBUG__.presets())).filter((id) => !only || id.includes(only));
  for (const id of ids) {
    current = id;
    const ok = await control.evaluate((x) => window.__BOOFVIZ_DEBUG__.load(x), id);
    if (!ok) errors.push(`could not load ${id}`);
    await new Promise((r) => setTimeout(r, dwell));
    const file = join(outDir, `${id.replace(/[:/]/g, '_')}.png`);
    await output.screenshot({ path: file });
    console.log(`shot ${id}`);
  }
} finally {
  await app.close();
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):\n${[...new Set(errors)].join('\n')}`);
  process.exit(1);
}
console.log(`\nAll presets rendered without errors. Screenshots in ${outDir}`);
