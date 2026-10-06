// End-to-end Ableton Link check: this process joins a Link session as a peer,
// the built app follows it, and the app's beat clock must match the session
// timeline within ±10 ms, including after a tempo change on the peer.
//
//   npm run link:build && npm run build && npm run link:e2e   (Linux CI: wrap in xvfb-run)
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const addon = join(root, 'native/link/build/Release/boofviz_link.node');
if (!existsSync(addon)) {
  console.log('Link add-on not built (npm run link:build): skipping.');
  process.exit(0);
}
const { LinkSession } = createRequire(import.meta.url)(addon);
const outDir = join(root, 'test-output');
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'link-config'), { recursive: true, force: true });
const wav = join(outDir, 'test-128bpm.wav');
if (!existsSync(wav)) execFileSync(process.execPath, [join(root, 'scripts/make-test-track.mjs'), wav], { stdio: 'inherit' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const epochNow = () => performance.timeOrigin + performance.now();
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

// The peer: a second Link participant at 124 BPM.
const peer = new LinkSession(124);
peer.enable(true);
const peerBeatAt = (epochMs) => {
  const now = epochNow();
  const s = peer.snapshot(4);
  return { beat: s.beat + ((epochMs - now) / 1000) * (s.tempo / 60), tempo: s.tempo, peers: s.peers };
};

const args = [root];
if (process.platform === 'linux') args.unshift('--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const app = await electron.launch({ executablePath: electronPath, args, env: { ...process.env, XDG_CONFIG_HOME: join(outDir, 'link-config') }, cwd: root });
let control;
for (let i = 0; i < 150 && !control; i++) {
  control = app.windows().find((w) => w.url().includes('control.html'));
  await sleep(200);
}

/**
 * Worst |app − session| over n samples, in ms. Link aligns phase within the
 * quantum (a 4-beat bar), not absolute beat numbers, so compare modulo a bar.
 */
async function worstOffset(n) {
  let worst = 0;
  let tempo = 0;
  for (let i = 0; i < n; i++) {
    const at = epochNow() + 200;
    const a = await control.evaluate((ms) => window.__BOOFVIZ_DEBUG__.beatAtEpoch(ms), at);
    const p = peerBeatAt(at);
    tempo = p.tempo;
    const d = a - p.beat;
    worst = Math.max(worst, Math.abs(((d - 4 * Math.round(d / 4)) * 60000) / p.tempo));
    await sleep(100);
  }
  return { worst, tempo };
}

try {
  await control.waitForLoadState('load');
  await sleep(1500);
  await control.getByRole('button', { name: 'Input', exact: true }).click();
  await control.setInputFiles('input[type=file]', wav);
  await sleep(2000);
  await control.getByRole('button', { name: 'Link', exact: true }).first().click();
  let joined = false;
  for (let i = 0; i < 50 && !joined; i++) {
    joined = peerBeatAt(epochNow()).peers > 0;
    await sleep(200);
  }
  check(joined, 'app joins the Link session');
  await sleep(3000);

  const f = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.frame());
  const session = peerBeatAt(epochNow());
  check(Math.abs(f.bpm - session.tempo) < 0.05, `app tempo follows Link (${f.bpm.toFixed(2)} vs session ${session.tempo.toFixed(2)} BPM)`);
  const a = await worstOffset(20);
  check(a.worst < 10, `beats and bars match the session timeline (worst ${a.worst.toFixed(2)} ms over 20 samples)`);
  const down = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.builder.tempo?.downbeatOffset);
  check(down === 0, `bar 1 is the Link bar (downbeat offset ${down})`);

  peer.setTempo(131.5);
  await sleep(2500);
  const f2 = await control.evaluate(() => window.__BOOFVIZ_DEBUG__.frame());
  check(Math.abs(f2.bpm - 131.5) < 0.05, `tempo change on the peer reaches the app (${f2.bpm.toFixed(2)} BPM)`);
  const b = await worstOffset(20);
  check(b.worst < 10, `still within ±10 ms after the tempo change (worst ${b.worst.toFixed(2)} ms)`);
} finally {
  await app.close();
  peer.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll Link checks passed.');
process.exit(failures.length ? 1 : 0);
