// The fret highway in the real app with real audio: plays a synthetic band
// (drums, a plucked riff, a bass line, two breakdowns and drops) through the
// whole pipeline, captures frames of each venue and reports how the chart did:
//   npm run build && xvfb-run -a node scripts/fret-capture.mjs
// Frames go to test-output/fret/<venue>-<n>.png; the hit rate is printed.
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output', 'fret');
const configDir = join(root, 'test-output', 'fret-config');
mkdirSync(outDir, { recursive: true });
rmSync(configDir, { recursive: true, force: true });
const wav = join(root, 'test-output', 'fret-band.wav');
writeFileSync(wav, bandTrack());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required');
const env = { ...process.env, XDG_CONFIG_HOME: configDir, BOOFVIZ_SMTC: 'off' };
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
const venues = (process.env.VENUES ?? 'garage,arena,neon,stadium').split(',');
const report = [];
try {
  await control.waitForLoadState('load');
  await sleep(1000);
  await output.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
  await control.getByRole('button', { name: 'Input', exact: true }).click();
  await control.setInputFiles('input[type=file]', wav);
  const t0 = Date.now();
  const at = async (sec) => {
    const wait = t0 + sec * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  };
  // Each venue gets a stretch of the song; the chart keeps its history across looks.
  const plan = [
    ['garage', 6, [12, 16, 33]],
    ['arena', 36, [40, 44]],
    ['neon', 46, [50, 56]],
    ['stadium', 58, [62, 66, 72]],
  ].filter(([v]) => venues.includes(v));
  for (const [venue, start, shots] of plan) {
    await at(start);
    await dbg(control, (x) => window.__BOOFVIZ_DEBUG__.load(x), `builtin:fret-highway-${venue}`);
    await sleep(400);
    const before = await dbg(output, () => window.__BOOFVIZ_DEBUG__.fret());
    for (let n = 0; n < shots.length; n++) {
      await at(shots[n]);
      await output.screenshot({ path: join(outDir, `${venue}-${n}.png`) });
    }
    const after = await dbg(output, () => window.__BOOFVIZ_DEBUG__.fret());
    const frame = await dbg(output, () => window.__BOOFVIZ_DEBUG__.frame());
    const hits = after.hits - before.hits;
    const misses = after.misses - before.misses;
    report.push({ venue, bpm: +frame.bpm.toFixed(1), conf: +frame.bpmConfidence.toFixed(2), shown: after.shown - before.shown, hits, misses, live: after.live - before.live, hitRate: +(hits / Math.max(1, hits + misses)).toFixed(3), streak: after.streak, score: after.score, star: +after.star.toFixed(2), power: after.power, section: after.section });
    console.log(JSON.stringify(report.at(-1)));
  }
  const pf = await dbg(output, () => window.__BOOFVIZ_DEBUG__.gpu());
  console.log('gpu', JSON.stringify(pf));
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
  else console.log('no page errors');
} finally {
  await app.close().catch(() => {});
}

/**
 * 128 BPM, 40 bars, 48 kHz stereo WAV: an intro of drums, verses with a
 * plucked two-bar riff and a bass line, a breakdown (riff only, no kick or
 * bass) into a drop, a short second breakdown and a last drop.
 */
function bandTrack() {
  const sr = 48000;
  const bpm = 128;
  const beat = 60 / bpm;
  const bars = 40;
  const n = Math.round((bars * 4 * beat + 1) * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let seed = 5;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const add = (t0, len, fn, pan = 0) => {
    const st = Math.round(t0 * sr);
    for (let i = 0; i < len * sr && st + i < n; i++) {
      const v = fn(i / sr);
      L[st + i] += v * (1 - pan);
      R[st + i] += v * (1 + pan);
    }
  };
  const kick = (t0) => {
    let ph = 0;
    add(t0, 0.3, (t) => {
      ph += (2 * Math.PI * (48 + 120 * Math.exp(-t * 30))) / sr;
      return 0.8 * Math.sin(ph) * Math.exp(-t * 8);
    });
  };
  const snare = (t0) => add(t0, 0.18, (t) => (0.34 * (rand() * 2 - 1) + 0.2 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 22));
  const hat = (t0) => {
    let prev = 0;
    add(t0, 0.05, (t) => {
      const x = rand() * 2 - 1;
      const v = 0.15 * (x - prev) * Math.exp(-t * 80);
      prev = x;
      return v;
    }, 0.2);
  };
  const crash = (t0) => add(t0, 1.2, (t) => 0.2 * (rand() * 2 - 1) * Math.exp(-t * 3));
  const pluck = (t0, f, len) =>
    add(t0, len, (t) => {
      const env = Math.min(1, t * 400) * Math.exp(-t * 2.5);
      return 0.17 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.3 * Math.sin(6 * Math.PI * f * t) + 0.15 * Math.sin(8 * Math.PI * f * t));
    }, -0.15);
  const bassNote = (t0, f, len) => add(t0, len, (t) => 0.22 * Math.min(1, t * 150) * Math.exp(-t * 1.2) * Math.sin(2 * Math.PI * f * t));
  // [eighth in the two-bar figure, semitones above A3, length in eighths]
  const riff = [[1, 0, 1], [3, 3, 1], [4, 5, 1], [5, 7, 2], [7, 10, 1], [9, 12, 3], [12, 10, 1], [13, 7, 1], [14, 5, 1], [15, 3, 1]];
  const roots = [55, 55, 43.65, 49];
  for (let bar = 0; bar < bars; bar++) {
    const tb = bar * 4 * beat;
    const intro = bar < 4;
    const breakdown = (bar >= 16 && bar < 20) || (bar >= 28 && bar < 30);
    if (bar === 20 || bar === 30 || bar === 0) crash(tb);
    for (let k = 0; k < 4; k++) {
      const t0 = tb + k * beat;
      if (!breakdown) {
        if (k === 0 || k === 2) kick(t0);
        if (k === 2) kick(t0 + beat / 2);
        if (k === 1 || k === 3) snare(t0);
        hat(t0);
        hat(t0 + beat / 2);
      } else if (k === 3 && bar % 2) snare(t0 + beat / 2);
    }
    if (!intro) {
      for (const [e, semi, len] of riff) {
        const inBar = e - (bar % 2) * 8;
        if (inBar < 0 || inBar >= 8) continue;
        pluck(tb + (inBar * beat) / 2, 220 * Math.pow(2, semi / 12), (len * beat) / 2);
      }
      if (!breakdown) for (let k = 0; k < 4; k += 2) bassNote(tb + k * beat, roots[Math.floor(bar / 2) % 4], beat * 1.9);
    }
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 0.7 * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 0.7 * 32767))), 46 + i * 4);
  }
  return buf;
}
