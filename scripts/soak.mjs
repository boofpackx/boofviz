// Soak test: plays the test track on a loop with auto-shuffle changing the look
// every bar, and watches both windows for errors, leaks (GPU resources, JS heap)
// and frame-rate collapse.
//
//   npm run build && SOAK_MINUTES=10 npm run soak     (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'soak-config'), { recursive: true, force: true });
const wav = join(outDir, 'test-128bpm.wav');
if (!existsSync(wav)) execFileSync(process.execPath, [join(root, 'scripts/make-test-track.mjs'), wav], { stdio: 'inherit' });
const minutes = Number(process.env.SOAK_MINUTES ?? 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = ['--enable-precise-memory-info', root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const app = await electron.launch({ executablePath: electronPath, args, env: { ...process.env, XDG_CONFIG_HOME: join(outDir, 'soak-config') }, cwd: root });
let control;
let output;
for (let i = 0; i < 150 && !(control && output); i++) {
  for (const w of app.windows()) {
    if (w.url().includes('control.html') && !control) control = w;
    if (w.url().includes('output.html') && !output) output = w;
  }
  await sleep(200);
}
const errors = [];
for (const [name, w] of [['control', control], ['output', output]]) {
  w.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  w.on('console', (m) => {
    if (m.type() === 'error' || /Shader Error|WebGLProgram/.test(m.text())) errors.push(`${name}: ${m.text().slice(0, 300)}`);
  });
}

const sample = async () => {
  const heap = (w) => w.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0));
  return {
    t: 0,
    look: await control.evaluate(() => window.__BOOFVIZ_DEBUG__.show().doc.name),
    outGpu: await output.evaluate(() => window.__BOOFVIZ_DEBUG__.gpu()),
    prevGpu: await control.evaluate(() => window.__BOOFVIZ_DEBUG__.gpu()),
    heapControl: await heap(control),
    heapOutput: await heap(output),
    packets: await output.evaluate(() => window.__BOOFVIZ_DEBUG__.packets()),
  };
};

const samples = [];
let looks = new Set();
try {
  await control.waitForLoadState('load');
  await sleep(1500);
  await control.getByRole('button', { name: 'Input', exact: true }).click();
  await control.setInputFiles('input[type=file]', wav);
  await sleep(3000);
  await control.evaluate(() => window.__BOOFVIZ_DEBUG__.updateSettings({ library: { autoShuffle: true, shuffleBars: 1, shufflePool: 'all' } }));
  const t0 = Date.now();
  while (Date.now() - t0 < minutes * 60000) {
    await sleep(15000);
    const s = await sample();
    s.t = (Date.now() - t0) / 1000;
    samples.push(s);
    looks.add(s.look);
    console.log(`t=${s.t.toFixed(0)}s  ${s.look.padEnd(22)} output gpu ${JSON.stringify(s.outGpu)}  heap ctl ${s.heapControl.toFixed(0)} MB / out ${s.heapOutput.toFixed(0)} MB`);
  }
} finally {
  await app.close();
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const half = samples.slice(Math.floor(samples.length / 2));
const first = samples[Math.min(1, samples.length - 1)];
const last = samples[samples.length - 1];
const maxOf = (list, f) => Math.max(...list.map(f));
check(errors.length === 0, `no errors${errors.length ? `: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : ''}`);
check(looks.size >= Math.min(4, samples.length), `auto-shuffle kept changing the look (${looks.size} looks sampled)`);
check(last.packets > first.packets, 'analysis kept flowing to the output');
// Live resources depend on the look; a leak shows as steady growth on top of that.
check(maxOf(half, (s) => s.outGpu.textures) <= maxOf(samples, (s) => s.outGpu.textures) && last.outGpu.textures < 80, `output textures bounded (last ${last.outGpu.textures}, max ${maxOf(samples, (s) => s.outGpu.textures)})`);
check(last.outGpu.geometries < 120, `output geometries bounded (last ${last.outGpu.geometries})`);
check(last.heapOutput < first.heapOutput * 1.5 + 20 && last.heapControl < first.heapControl * 1.5 + 40, `JS heap stable (control ${first.heapControl.toFixed(0)} → ${last.heapControl.toFixed(0)} MB, output ${first.heapOutput.toFixed(0)} → ${last.heapOutput.toFixed(0)} MB)`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nSoak passed (${minutes} min).`);
process.exit(failures.length ? 1 : 0);
