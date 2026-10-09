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

  // ---- Phase 3: quantized launch, favorites, shuffle ----------------------
  const dbg = (fn) => control.evaluate(fn);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await dbg(fn)) return true;
    return false;
  };
  // Watch what the output window is told to show, and whether a transition runs, through the switch.
  await output.evaluate(() => {
    window.__seq = [];
    window.__trans = 0;
    setInterval(() => {
      const s = window.__BOOFVIZ_DEBUG__.scene();
      const k = s ? s.layers.map((l) => `${l.id}:${l.source.kind}`).join(',') : '';
      if (window.__seq[window.__seq.length - 1]?.k !== k) window.__seq.push({ k, ms: Date.now() });
      if (window.__BOOFVIZ_DEBUG__.transition()) window.__trans++;
    }, 5);
  });
  await control.getByRole('button', { name: 'Library', exact: true }).click();
  await control.getByText('Shape Morph', { exact: true }).first().click();
  const q = await dbg(() => {
    const s = window.__BOOFVIZ_DEBUG__.show();
    return s.queued && { name: s.queued.entry.preset.name, atBeat: s.queued.atBeat, beat: window.__BOOFVIZ_DEBUG__.frame().beat };
  });
  check(!!q && q.name === 'Shape Morph' && Number.isInteger(q.atBeat) && q.atBeat > q.beat && q.atBeat - q.beat <= 4.1, `library click queues the preset for the next bar (${q ? `beat ${q.beat.toFixed(2)} → ${q.atBeat}` : 'not queued'})`);
  await sleep(150);
  check((await output.evaluate(() => window.__BOOFVIZ_DEBUG__.pendingBeat())) === q?.atBeat, 'output holds the queued scene for the same beat');
  await waitFor(() => window.__BOOFVIZ_DEBUG__.show().doc.name === 'Shape Morph');
  await sleep(300);
  check((await dbg(() => window.__BOOFVIZ_DEBUG__.show().doc.name)) === 'Shape Morph', 'the queued preset goes live');
  // Each window must switch on its first frame that reaches the bar (never early, never a frame late).
  const pSw = await dbg(() => window.__BOOFVIZ_DEBUG__.previewLastSwitch());
  const oSw = await output.evaluate(() => window.__BOOFVIZ_DEBUG__.lastSwitch());
  const onTime = (s) => !!s && !!q && s.prevBeat < q.atBeat - 0.002 && s.beat >= q.atBeat - 0.002;
  const late = (s) => (s && q ? (((s.beat - q.atBeat) * 60000) / f.bpm).toFixed(1) : '?');
  check(onTime(pSw) && onTime(oSw), `preview and output both switch on the first frame of the bar (preview +${late(pSw)} ms, output +${late(oSw)} ms after the downbeat)`);
  await sleep(1500);
  const seq = (await output.evaluate(() => window.__seq)).map((x) => x.k);
  check(seq.length >= 2 && seq.indexOf(seq[seq.length - 1]) === seq.length - 1, `no flash of the old look around the switch (${seq.length} scene changes seen by the output)`);
  check((await output.evaluate(() => window.__trans)) > 0, 'the new look blends in with the default crossfade');

  for (const name of ['Prism Spectrum', 'Arcade Maze']) {
    await control.locator('div[role=button]', { hasText: name }).first().getByTitle('Add to favorites').click();
  }
  await sleep(300);
  const favs = await dbg(() => window.__BOOFVIZ_DEBUG__.settings().library.favorites);
  check(favs.length === 2 && favs[0] === 'builtin:prism-spectrum' && favs[1] === 'builtin:arcade-maze', `star adds favorites (${favs.join(', ')})`);
  await control.locator('body').click({ position: { x: 5, y: 5 } });
  await control.keyboard.press('2');
  check((await dbg(() => window.__BOOFVIZ_DEBUG__.show().queued?.entry.id)) === 'builtin:arcade-maze', 'key 2 queues favorite #2');
  await control.keyboard.press('Escape');
  check((await dbg(() => window.__BOOFVIZ_DEBUG__.show().queued)) === null, 'Esc cancels the queued launch');
  await dbg(() => window.__BOOFVIZ_DEBUG__.updateSettings({ library: { shufflePool: 'favorites' } }));
  await control.keyboard.press('s');
  const shuffled = await dbg(() => window.__BOOFVIZ_DEBUG__.show().queued?.entry.id);
  check(favs.includes(shuffled), `S shuffles from the favorites (${shuffled})`);
  await control.keyboard.press('Escape');

  // Auto-play every 4 bars from everything; then back to Shape Morph for the checks below.
  const lookBefore = await dbg(() => window.__BOOFVIZ_DEBUG__.show().sourceId);
  const autoOn = Date.now();
  await dbg(() => window.__BOOFVIZ_DEBUG__.updateSettings({ library: { autoShuffle: true, autoMode: 'bars', shuffleBars: 4, shufflePool: 'all' } }));
  let autoChanged = false;
  for (const end = Date.now() + 15000; Date.now() < end && !autoChanged; await sleep(200)) autoChanged = (await control.evaluate((id) => window.__BOOFVIZ_DEBUG__.show().sourceId !== id, lookBefore)) === true;
  check(autoChanged, 'auto-play changes the look by itself (every 4 bars)');
  // Let it change again, then make sure no change was followed by another a split second later.
  await sleep(9000);
  const changes = (await output.evaluate(() => window.__seq)).filter((x) => x.ms >= autoOn);
  let minGap = Infinity;
  for (let i = 1; i < changes.length; i++) minGap = Math.min(minGap, changes[i].ms - changes[i - 1].ms);
  check(changes.length >= 2 && minGap > 2000, `auto-play changes cleanly, one look per interval (${changes.length} changes, closest ${(minGap / 1000).toFixed(1)} s apart)`);
  await dbg(() => window.__BOOFVIZ_DEBUG__.updateSettings({ library: { autoShuffle: false } }));
  await sleep(300);
  await dbg(() => window.__BOOFVIZ_DEBUG__.load('builtin:shape-morph'));
  await sleep(1500);

  // ---- Phase 2: modulation, macros, undo, save ---------------------------

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
