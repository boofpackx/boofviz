// Quality capture for new looks (see docs/plans/late90s-2000s-plan.md, Part 1).
// Plays the test-track suite through the built app and screenshots the clean
// output window into test-output/look-check/<mode>/.
//
//   npm run build && node scripts/make-test-suite.mjs
//   xvfb-run -a node scripts/look-check.mjs <mode> <preset-id-filter>[,<filter>…]
//
// Modes:
//   sheet    the moments of the music test: groove (a frame every half beat for two beats),
//            the end of the build, the drop, the breakdown, a sung part, a breakbeat, silence
//   long     the long-run test: a frame every 10 s for three minutes of the club track
//   aspect   16:9, 4:3, 21:9 and 9:16 during the groove
//   palette  the look's own palette, then Mono, Pastel and Infrared, then bar-by-bar palette cycling
//   flash    frames as fast as the window allows across the first drop (for flash counting)
//   perf     frames per second over 4 s for each look and three reference looks
// Fails on any page or shader error.
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode = 'sheet', filter = ''] = process.argv.slice(2);
const suiteDir = join(root, 'test-output', 'suite');
if (!existsSync(join(suiteDir, 'suite.json'))) throw new Error('run node scripts/make-test-suite.mjs first');
const suite = JSON.parse(readFileSync(join(suiteDir, 'suite.json'), 'utf8'));
const outDir = join(root, 'test-output', 'look-check', mode);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const app = await electron.launch({ executablePath: electronPath, args, env: { ...process.env, XDG_CONFIG_HOME: join(outDir, 'config') }, cwd: root });
let control, output;
for (let i = 0; i < 150 && !(control && output); i++) {
  for (const w of app.windows()) {
    if (w.url().includes('control.html') && !control) control = w;
    if (w.url().includes('output.html') && !output) output = w;
  }
  await sleep(200);
}
const errors = [];
let current = '(startup)';
for (const [name, w] of [['control', control], ['output', output]]) {
  w.on('pageerror', (e) => errors.push(`${current} ${name}: ${e.message}`));
  w.on('console', (m) => {
    if (m.type() === 'error' || /Shader Error|WebGLProgram/.test(m.text())) errors.push(`${current} ${name}: ${m.text().slice(0, 300)}`);
  });
}
const dbg = (fn, arg) => control.evaluate(fn, arg);
const safe = (s) => s.replace(/[:/]/g, '_');

async function play(trackName) {
  await control.getByRole('button', { name: 'Input', exact: true }).click();
  await control.setInputFiles('input[type=file]', join(suiteDir, `${trackName}.wav`));
  for (let i = 0; i < 50; i++) {
    if ((await dbg(() => window.__BOOFVIZ_DEBUG__.filePosition())) !== null) break;
    await sleep(100);
  }
}

/** Jump to `t` seconds with a lead-in so the beat clock re-locks, then wait for `t`. */
async function at(t, lead = 6) {
  await dbg((s) => window.__BOOFVIZ_DEBUG__.seekFile(s), Math.max(0, t - lead));
  for (let i = 0; i < 400; i++) {
    const p = await dbg(() => window.__BOOFVIZ_DEBUG__.filePosition());
    if (p !== null && p >= t) return;
    await sleep(25);
  }
}

async function shot(id, label) {
  await output.screenshot({ path: join(outDir, `${safe(id)}__${label}.png`) });
}

async function load(id) {
  current = id;
  const ok = await dbg((x) => window.__BOOFVIZ_DEBUG__.load(x), id);
  if (!ok) errors.push(`could not load ${id}`);
  await sleep(1500);
}

const fps = async (ms = 4000) =>
  output.evaluate(
    (dur) =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else res((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

try {
  await control.waitForLoadState('load');
  await sleep(1500);
  const filters = filter.split(',').filter(Boolean);
  const ids = (await dbg(() => window.__BOOFVIZ_DEBUG__.presets())).filter((id) => !filters.length || filters.some((f) => id.includes(f)));
  if (!ids.length) throw new Error(`no presets match ${filter}`);
  const club = suite['club-128'];
  const beat = 60 / club.bpm;
  const results = {};

  if (mode === 'sheet') {
    for (const id of ids) {
      await play('club-128');
      await load(id);
      const g = club.marks.groove + 8;
      await at(g);
      for (let k = 0; k < 4; k++) {
        await shot(id, `a-groove-${k}`);
        await sleep(beat * 500);
      }
      await at(club.marks.drop - beat * 2);
      await shot(id, 'b-build-end');
      await at(club.marks.drop + beat * 0.25, 0.5);
      await shot(id, 'c-drop');
      await sleep(beat * 2000);
      await shot(id, 'd-drop-2beats');
      await at(club.marks.breakdown + beat * 8);
      await shot(id, 'e-breakdown');
      await play('half-85');
      await load(id);
      await at(suite['half-85'].marks.verse + 6);
      await shot(id, 'f-sung');
      await play('break-174');
      await load(id);
      await at(suite['break-174'].marks.drop + 4);
      await shot(id, 'g-breakbeat');
      await play('quiet-stop');
      await load(id);
      await at(suite['quiet-stop'].marks.stop + 4);
      await shot(id, 'h-silence');
      console.log(`sheet ${id}`);
    }
  } else if (mode === 'long') {
    for (const id of ids) {
      await play('club-128');
      await load(id);
      // Let the song play through (no seeking, so the beat clock stays locked).
      for (let t = 10; t <= 180; t += 10) {
        for (let i = 0; i < 1200; i++) {
          const pos = await dbg(() => window.__BOOFVIZ_DEBUG__.filePosition());
          if (pos !== null && pos >= t) break;
          await sleep(25);
        }
        await shot(id, `t${String(t).padStart(3, '0')}`);
      }
      console.log(`long ${id}`);
    }
  } else if (mode === 'aspect') {
    const sizes = [['16x9', 1280, 720], ['4x3', 960, 720], ['21x9', 1680, 720], ['9x16', 405, 720]];
    await play('club-128');
    for (const id of ids) {
      await load(id);
      for (const [name, w, h] of sizes) {
        await app.evaluate(({ BrowserWindow }, s) => {
          const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('output.html'));
          win?.setContentSize(s.w, s.h);
        }, { w, h });
        await at(club.marks.groove + 10);
        await shot(id, `aspect-${name}`);
      }
      console.log(`aspect ${id}`);
    }
  } else if (mode === 'palette') {
    await play('club-128');
    for (const id of ids) {
      await load(id);
      const own = await dbg(() => window.__BOOFVIZ_DEBUG__.show().doc.palette);
      for (const pal of [own, 'Mono', 'Pastel', 'Infrared']) {
        await dbg((p) => window.__BOOFVIZ_DEBUG__.show().edit((d) => { d.palette = p; }), pal);
        await at(club.marks.groove + 10);
        await shot(id, `palette-${safe(pal)}`);
      }
      await dbg(() => window.__BOOFVIZ_DEBUG__.show().edit((d) => { d.paletteCycle = { mode: 'bar', every: 1, fadeBeats: 1, list: ['Neon', 'Sunset', 'Ocean', 'Acid'] }; }));
      await at(club.marks.groove + 16);
      await shot(id, 'palette-cycling');
      console.log(`palette ${id}`);
    }
  } else if (mode === 'flash') {
    for (const id of ids) {
      await play('club-128');
      await load(id);
      await at(club.marks.drop - 3);
      const t0 = Date.now();
      let k = 0;
      while (Date.now() - t0 < 8000) {
        await output.screenshot({ path: join(outDir, `${safe(id)}__f${String(k).padStart(3, '0')}_${Date.now() - t0}.png`), scale: 'css' });
        k++;
      }
      console.log(`flash ${id}: ${k} frames in 8 s`);
    }
  } else if (mode === 'perf') {
    await play('club-128');
    const refs = ['builtin:neon-stage', 'builtin:real-90s-megademo-classic', 'builtin:real-80s-raytrace-reel'];
    for (const id of [...refs, ...ids]) {
      await load(id);
      await at(club.marks.drop + 4);
      results[id] = +(await fps()).toFixed(1);
      console.log(`perf ${id}: ${results[id]} fps`);
    }
    writeFileSync(join(outDir, 'perf.json'), JSON.stringify(results, null, 2));
  } else throw new Error(`unknown mode ${mode}`);
} finally {
  await app.close();
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):\n${[...new Set(errors)].join('\n')}`);
  process.exit(1);
}
console.log(`\nDone. Captures in ${outDir}`);
