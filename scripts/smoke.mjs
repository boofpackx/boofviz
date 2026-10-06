// End-to-end smoke test: launches the built app, plays a synthetic 128 BPM track
// through the Local File input and checks analysis, tempo lock and output sync.
//
//   npm run build && npm run smoke            (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
mkdirSync(outDir, { recursive: true });
// Fresh profile every run (settings, session, user presets).
rmSync(join(outDir, 'config'), { recursive: true, force: true });
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
  await control.getByRole('button', { name: 'Input', exact: true }).click();
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

  // ---- Phase 2: library, modulation, macros, undo, save ------------------
  const dbg = (fn) => control.evaluate(fn);
  await control.getByRole('button', { name: 'Library', exact: true }).click();
  await control.getByText('Shape Morph', { exact: true }).first().click();
  await new Promise((r) => setTimeout(r, 800));
  check((await dbg(() => window.__BOOFVIZ_DEBUG__.show().doc.name)) === 'Shape Morph', 'library click loads a preset');

  await control.getByRole('button', { name: 'Layers', exact: true }).click();
  const sizeRow = control.locator('label', { hasText: /^Size$/ }).first();
  await sizeRow.click({ button: 'right' });
  await control.getByRole('button', { name: /Modulate by/ }).hover();
  // Menu items render inside the fixed-position context menu.
  const menu = control.locator('div.fixed.z-50');
  await menu.getByRole('button', { name: /^Audio/ }).hover();
  await menu.getByRole('button', { name: /^Bass$/ }).click();
  const mods = await dbg(() => window.__BOOFVIZ_DEBUG__.show().doc.layers.flatMap((l) => l.modulators));
  check(mods.some((m) => m.target === 'source.params.size' && m.source === 'audio.bass'), 'right-click → Modulate by → Bass adds a modulator');

  const knob = control.locator('svg.cursor-ns-resize').first();
  const before = await dbg(() => window.__BOOFVIZ_DEBUG__.show().doc.macros[0].value);
  const box = await knob.boundingBox();
  await control.mouse.move(box.x + 20, box.y + 20);
  await control.mouse.down();
  await control.mouse.move(box.x + 20, box.y - 40, { steps: 6 });
  await control.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const after = await dbg(() => window.__BOOFVIZ_DEBUG__.show().doc.macros[0].value);
  const outMacro = await output.evaluate(() => window.__BOOFVIZ_DEBUG__.scene()?.macros[0].value);
  check(after > before + 0.1, `macro knob drag changes the macro (${before.toFixed(2)} → ${after.toFixed(2)})`);
  check(Math.abs(outMacro - after) < 1e-6, 'output window receives the edited scene');

  await control.keyboard.press('Control+z');
  await new Promise((r) => setTimeout(r, 200));
  check(Math.abs((await dbg(() => window.__BOOFVIZ_DEBUG__.show().doc.macros[0].value)) - before) < 1e-6, 'Ctrl+Z undoes the macro move');

  await control.getByRole('button', { name: 'Save as', exact: true }).click();
  const nameInput = control.getByPlaceholder('Preset name');
  await nameInput.fill('Smoke Test Look');
  await nameInput.press('Enter');
  await new Promise((r) => setTimeout(r, 800));
  const saved = join(outDir, 'config', 'BOOFVIZ', 'presets', 'smoke-test-look.json');
  const savedOk = existsSync(saved) && JSON.parse(readFileSync(saved, 'utf8')).layers.some((l) => l.modulators.some((m) => m.source === 'audio.bass'));
  check(savedOk, 'Save as writes the preset JSON (with the new modulator) to the user folder');
  check((await dbg(() => window.__BOOFVIZ_DEBUG__.show().sourceId)) === 'user:smoke-test-look', 'saved preset becomes the active user preset');

  await control.screenshot({ path: join(outDir, 'control.png') });
  await output.screenshot({ path: join(outDir, 'output.png') });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await app.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
