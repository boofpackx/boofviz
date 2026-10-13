// End-to-end check of lyrics for BOOFVIZ's own file player: a tagged WAV the
// mock LRCLIB knows gets its synced lyrics, the lyrics follow the file
// (seek, pause), an .lrc beside the file wins, and the beat finds itself
// again quickly after a seek.
//
//   npm run build && npm run lyrics:file:e2e      (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockServices } from './mock-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
const configDir = join(outDir, 'lyrics-file-config');
const songDir = join(outDir, 'local-songs');
mkdirSync(outDir, { recursive: true });
rmSync(configDir, { recursive: true, force: true });
rmSync(songDir, { recursive: true, force: true });
mkdirSync(songDir, { recursive: true });

// Three minutes at 128 BPM (kick on every beat from 0 s), tagged like the mock's "Paper Lanterns".
const BPM = 128;
function taggedWav(path, title, artist, seconds) {
  const sr = 22050;
  const n = sr * seconds;
  const pcm = Buffer.alloc(n * 2);
  const beat = 60 / BPM;
  let seed = 3;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = t % beat;
    const kick = 0.7 * Math.sin(2 * Math.PI * (50 + 110 * Math.exp(-k * 30)) * k) * Math.exp(-k * 9);
    const h = (t + beat / 2) % beat;
    const hat = h < 0.04 ? 0.12 * rand() * Math.exp(-h * 80) : 0;
    const pad = 0.05 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(t));
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, kick + hat + pad)) * 32000), i * 2);
  }
  const sub = (id, v) => {
    const s = Buffer.from(v + '\0');
    return Buffer.concat([Buffer.from(id), u32(s.length), s, s.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const info = Buffer.concat([Buffer.from('INFO'), sub('INAM', title), sub('IART', artist)]);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(sr, 4);
  fmt.writeUInt32LE(sr * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const body = Buffer.concat([Buffer.from('WAVE'), Buffer.from('fmt '), u32(16), fmt, Buffer.from('LIST'), u32(info.length), info, Buffer.from('data'), u32(pcm.length), pcm]);
  writeFileSync(path, Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]));
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
}
const wav = join(songDir, 'lanterns.wav');
taggedWav(wav, 'Paper Lanterns', 'The Placeholder Ensemble', 180);

const mock = await startMockServices({ port: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const env = { ...process.env, XDG_CONFIG_HOME: configDir, BOOFVIZ_LRCLIB_URL: `${mock.url}/lrclib`, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
const app = await electron.launch({ executablePath: electronPath, args, env, cwd: root });
let control;
for (let i = 0; i < 150 && !control; i++) {
  control = app.windows().find((w) => w.url().includes('control.html'));
  await sleep(200);
}
const errors = [];
control.on('pageerror', (e) => errors.push(e.message));
const dbg = (fn, arg) => control.evaluate(fn, arg);
const waitFor = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 200) {
    if (await dbg(fn).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
};

/** Beat-phase error against the file (kicks on every beat), in beats, -0.5..0.5. */
const phaseErr = () =>
  dbg((bpm) => {
    const D = window.__BOOFVIZ_DEBUG__;
    const p = D.filePosition();
    const e = D.beatAtEpoch(Date.now()) - (p * bpm) / 60;
    return e - Math.round(e);
  }, BPM);

try {
  await control.waitForLoadState('load');
  await sleep(1500);
  await control.getByRole('button', { name: 'Input', exact: true }).click();
  await control.setInputFiles('input[type=file]', wav);
  const known = await waitFor(() => window.__BOOFVIZ_DEBUG__.nowPlaying().source === 'file');
  const np = await dbg(() => window.__BOOFVIZ_DEBUG__.nowPlaying());
  check(known && np.title === 'Paper Lanterns' && np.artists[0] === 'The Placeholder Ensemble', `the file's tags name the song (${np.title} · ${np.artists.join(', ')})`);
  check(Math.abs(np.durationMs - 180000) < 50, `its length comes from the file (${(np.durationMs / 1000).toFixed(1)} s)`);
  const found = await waitFor(() => (window.__BOOFVIZ_DEBUG__.trackLyrics().synced?.length ?? 0) > 0);
  const lyr = await dbg(() => window.__BOOFVIZ_DEBUG__.trackLyrics());
  check(found && lyr.source === 'lrclib', `synced lyrics found online for the file (${lyr.synced?.length ?? 0} lines, ${lyr.source})`);

  // The lyric clock is the file's clock.
  const off = await dbg(() => {
    const D = window.__BOOFVIZ_DEBUG__;
    return D.lyricsAt(Date.now()).positionMs - D.filePosition() * 1000;
  });
  check(Math.abs(off) < 250, `lyrics follow the file's position (${off.toFixed(0)} ms apart)`);
  // Give the beat tracker time to lock on from the start.
  await sleep(9000);
  const base = [];
  for (let i = 0; i < 10; i++) {
    base.push(await phaseErr());
    await sleep(200);
  }
  // Phases wrap at ±0.5 beat: compare them round the circle.
  const wrap = (d) => d - Math.round(d);
  const baseErr = base[0] + base.reduce((a, b) => a + wrap(b - base[0]), 0) / base.length;
  check(
    base.every((e) => Math.abs(wrap(e - baseErr)) < 0.1),
    `the beat is locked to the file (phase ${baseErr.toFixed(2)} beats, spread ${Math.max(...base.map((e) => Math.abs(wrap(e - baseErr)))).toFixed(2)})`,
  );

  await dbg(() => window.__BOOFVIZ_DEBUG__.seekFile(60.23));
  await sleep(400);
  const seek = await dbg(() => {
    const D = window.__BOOFVIZ_DEBUG__;
    return { pos: D.lyricsAt(Date.now()).positionMs, file: D.filePosition() * 1000, line: D.lyricsAt(Date.now()).text };
  });
  check(Math.abs(seek.pos - seek.file) < 250 && seek.line, `a seek moves the lyrics with it (${(seek.pos / 1000).toFixed(1)} s: "${seek.line}")`);
  // How long until the beat sits on the file's kicks again.
  const t0 = Date.now();
  const trace = [];
  while (Date.now() - t0 < 12000) {
    trace.push({ t: Date.now() - t0, e: await phaseErr() });
    await sleep(200);
  }
  let settled = null;
  for (let i = trace.length - 1; i >= 0; i--) {
    if (Math.abs(wrap(trace[i].e - baseErr)) > 0.08) break;
    settled = trace[i].t;
  }
  console.log(
    `      phase after the seek: ${trace
      .filter((_, i) => i % 5 === 0)
      .map((x) => `${(x.t / 1000).toFixed(0)}s ${x.e.toFixed(2)}`)
      .join(' · ')}`,
  );
  check(settled !== null && settled < 3000, `the beat finds the kicks again after a seek (${settled === null ? 'not within 12 s' : `${(settled / 1000).toFixed(1)} s`})`);

  await dbg(() => window.__BOOFVIZ_DEBUG__.pauseFile());
  check(await waitFor(() => window.__BOOFVIZ_DEBUG__.nowPlaying().playing === false, 3000), 'pausing the file pauses the lyrics');

  // An .lrc beside the file wins over the online lyrics.
  writeFileSync(join(songDir, 'lanterns.lrc'), '[00:00.50]words from beside the file\n[00:03.00]second line from beside the file\n');
  await control.setInputFiles('input[type=file]', wav);
  const side = await waitFor(() => window.__BOOFVIZ_DEBUG__.trackLyrics().synced?.[0]?.text === 'words from beside the file');
  check(side, `an .lrc next to the file is used first (${(await dbg(() => window.__BOOFVIZ_DEBUG__.trackLyrics().synced?.[0]?.text)) ?? 'none'})`);

  await control.getByRole('button', { name: 'Lyrics', exact: true }).first().click();
  await sleep(500);
  await control.screenshot({ path: join(outDir, 'lyrics-file.png') });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await app.close().catch(() => {});
  await mock.close?.();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
