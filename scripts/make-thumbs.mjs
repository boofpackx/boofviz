// Picture cards for the Create tab: renders every background, main element and
// effect with the test track playing and saves a small JPEG of each to
// src/renderer/src/control/thumbs/ (<kind>.jpg, fx-<effect>.jpg).
//   npm run build && xvfb-run -a npm run thumbs -- [only these ids…]
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'renderer', 'src', 'control', 'thumbs');
const tmp = join(root, 'test-output');
const configDir = join(tmp, 'thumbs-config');
mkdirSync(outDir, { recursive: true });
rmSync(configDir, { recursive: true, force: true });
const wav = join(tmp, 'test-128bpm.wav');
execFileSync(process.execPath, [join(root, 'scripts/make-test-track.mjs'), wav], { stdio: 'inherit' });
const only = new Set(process.argv.slice(2));
const want = (id) => !only.size || only.has(id);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const app = await electron.launch({ executablePath: electronPath, args, env: { ...process.env, XDG_CONFIG_HOME: configDir }, cwd: root });
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
output.on('pageerror', (e) => errors.push(e.message));

/** Build a scene in the control window: role/kind pairs, then effects. */
const build = (spec) =>
  control.evaluate((s) => {
    const D = window.__BOOFVIZ_DEBUG__;
    D.show().edit((d) => {
      d.layers = [];
      d.macros = [];
      d.palette = 'Neon';
      d.camera = undefined;
      d.paletteCycle = { ...d.paletteCycle, mode: 'off' };
      d.hueRotate = { ...d.hueRotate, mode: 'off' };
      for (const [role, kind] of s.layers) D.kit.applyRole(d, role, kind);
      for (const t of s.fx ?? []) D.kit.toggleEffect(d, t);
    });
  }, spec);

const shoot = async (name, spec, settle = 2600) => {
  await build(spec);
  await sleep(settle);
  await output.screenshot({ path: join(outDir, `${name}.jpg`), type: 'jpeg', quality: 70 });
  console.log(`thumb ${name}`);
};

try {
  await control.waitForLoadState('load');
  await sleep(1500);
  await output.setViewportSize({ width: 320, height: 180 }).catch(() => {});
  await control.getByRole('button', { name: 'Input', exact: true }).click();
  await control.setInputFiles('input[type=file]', wav);
  await sleep(4000);
  const { BACKGROUNDS, MAINS, EFFECT_PICKS } = await control.evaluate(() => {
    const k = window.__BOOFVIZ_DEBUG__.kit;
    return { BACKGROUNDS: k.BACKGROUNDS, MAINS: k.MAINS, EFFECT_PICKS: k.EFFECT_PICKS };
  });
  // Footage needs the internet (and your own clips); those cards stay plain.
  for (const k of new Set([...BACKGROUNDS, ...MAINS])) if (want(k) && k !== 'archiveFootage' && k !== 'clipEngine') await shoot(k, { layers: [['bg', k]] });
  // Effects on one shared scene, so the cards compare like for like.
  for (const t of EFFECT_PICKS)
    if (want(`fx-${t}`))
      await shoot(`fx-${t}`, {
        layers: [
          ['bg', 'synthSunset'],
          ['main', 'spectrumBars'],
        ],
        fx: [t],
      });
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
} finally {
  await app.close().catch(() => {});
}
