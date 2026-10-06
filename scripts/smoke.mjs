// End-to-end smoke test: launches the built app, plays a synthetic 128 BPM track
// through the Local File input and checks analysis, tempo lock and output sync.
//
//   npm run build && npm run smoke            (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
mkdirSync(outDir, { recursive: true });
const wav = join(outDir, 'test-128bpm.wav');
execFileSync(process.execPath, [join(root, 'scripts/make-test-track.mjs'), wav], { stdio: 'inherit' });

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
for (const [name, w] of [['control', control], ['output', output]]) w?.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

try {
  check(!!control && !!output, 'control and output windows open');
  await control.waitForLoadState('load');
  await new Promise((r) => setTimeout(r, 1500));
  await control.setInputFiles('input[type=file]', wav);
  await new Promise((r) => setTimeout(r, 9000));

  const f = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.frame());
  const status = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.status());
  check(status.state === 'running', `audio engine running (${status.state})`);
  check(!f.silence && f.rms > 0.001, `signal present (rms ${f.rms.toFixed(3)}, ${f.loudnessLUFS.toFixed(1)} LUFS)`);
  check(Math.abs(f.bpm - 128) < 1, `tempo locked to 128 BPM (got ${f.bpm.toFixed(2)}, confidence ${f.bpmConfidence.toFixed(2)})`);

  const pc = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.packets());
  const po = await output.evaluate(() => window.__BOOFVIZ_DEBUG__.packets());
  check(po > 0 && Math.abs(pc - po) < 20, `output window receives analysis (${po} packets vs ${pc})`);

  let worst = 0;
  for (let i = 0; i < 8; i++) {
    const at = Date.now() + 250;
    const a = await control.evaluate((ms) => window.__BOOFVIZ_DEBUG__.beatAtEpoch(ms), at);
    const b = await output.evaluate((ms) => window.__BOOFVIZ_DEBUG__.beatAtEpoch(ms), at);
    worst = Math.max(worst, Math.abs(((a - b) * 60000) / f.bpm));
    await new Promise((r) => setTimeout(r, 120));
  }
  check(worst < 2, `control and output beat clocks agree (worst ${worst.toFixed(2)} ms)`);

  await control.screenshot({ path: join(outDir, 'control.png') });
  await output.screenshot({ path: join(outDir, 'output.png') });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await app.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
