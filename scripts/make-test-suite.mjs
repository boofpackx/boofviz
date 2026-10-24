#!/usr/bin/env node
// Synthesizes the look-check test tracks into test-output/suite/ (48 kHz stereo 16-bit WAV):
//   club-128.wav   128 BPM four-on-the-floor: intro, groove, 16-bar build, drop, breakdown, drop, outro (~3 min)
//   half-85.wav    85 BPM half-time groove with a sung-like melody line (vocal detection)
//   break-174.wav  174 BPM breakbeat with busy hats and a reese bass
//   quiet-stop.wav near-silent intro, a groove, then a hard stop into silence
// The sections are listed in suite.json so look-check can jump to them.
//   node scripts/make-test-suite.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output', 'suite');
mkdirSync(outDir, { recursive: true });
const SR = 48000;

function track(seconds) {
  const n = Math.round(seconds * SR);
  return { n, L: new Float32Array(n), R: new Float32Array(n) };
}

function writeWav(file, { n, L, R }) {
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
  }
  writeFileSync(file, buf);
}

/** Drum and synth voices writing into a track. */
function voices(tr, seed) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const add = (t0, len, fn, pan = 0) => {
    const st = Math.round(t0 * SR);
    const m = Math.round(len * SR);
    for (let i = 0; i < m && st + i < tr.n; i++) {
      if (st + i < 0) continue;
      const v = fn(i / SR);
      tr.L[st + i] += v * (1 - Math.max(0, pan));
      tr.R[st + i] += v * (1 + Math.min(0, pan));
    }
  };
  return {
    kick: (t0, gain = 1) => {
      let ph = 0;
      add(t0, 0.35, (t) => {
        ph += (2 * Math.PI * (46 + 130 * Math.exp(-t * 32))) / SR;
        return 0.9 * gain * Math.sin(ph) * Math.exp(-t * 7);
      });
    },
    snare: (t0, gain = 1) => add(t0, 0.22, (t) => gain * (0.42 * rand() + 0.22 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 18)),
    clap: (t0) => add(t0, 0.2, (t) => 0.35 * rand() * (Math.exp(-t * 30) + 0.6 * Math.exp(-Math.max(0, t - 0.012) * 25)), 0.1),
    hat: (t0, open = false, pan = 0.2) => {
      let prev = 0;
      add(t0, open ? 0.25 : 0.06, (t) => {
        const x = rand();
        const v = (x - prev) * 0.22 * Math.exp(-t * (open ? 12 : 70));
        prev = x;
        return v;
      }, pan);
    },
    crash: (t0) => add(t0, 1.6, (t) => 0.28 * rand() * Math.exp(-t * 2.4), -0.2),
    bass: (t0, f, len, gain = 1) => add(t0, len, (t) => gain * 0.32 * Math.min(1, t * 200) * Math.exp(-t * 1.5) * Math.tanh(2.2 * Math.sin(2 * Math.PI * f * t))),
    reese: (t0, f, len) => add(t0, len, (t) => 0.22 * Math.min(1, t * 80) * (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.007 * t + 1) + 0.5 * Math.sin(2 * Math.PI * f * 2 * t))),
    pad: (t0, freqs, len, gain = 1) =>
      add(t0, len, (t) => {
        const env = Math.min(1, t / 0.6) * Math.min(1, (len - t) / 0.6);
        let v = 0;
        for (const fq of freqs) v += Math.sin(2 * Math.PI * fq * t + fq) + 0.4 * Math.sin(2 * Math.PI * fq * 2.003 * t);
        return gain * 0.035 * env * v;
      }, 0),
    riser: (t0, len) => add(t0, len, (t) => 0.18 * (t / len) ** 2 * rand() * (0.5 + 0.5 * Math.sin(2 * Math.PI * (200 + 1800 * (t / len)) * t))),
    /** A sung-like line: a sawtooth with vibrato through two vowel formants. */
    voice: (t0, f, len) => {
      let y1 = 0, y2 = 0, z1 = 0, z2 = 0, ph = 0;
      const vowel = Math.floor((t0 * 7) % 3);
      const [F1, F2] = [[700, 1220], [400, 2000], [550, 900]][vowel];
      const bp = (F, Q) => {
        const w = (2 * Math.PI * F) / SR, a = Math.sin(w) / (2 * Q);
        return { b0: a, a1: -2 * Math.cos(w), a2: 1 - a, n: 1 + a };
      };
      const c1 = bp(F1, 6), c2 = bp(F2, 8);
      let x1 = 0, x2 = 0, u1 = 0, u2 = 0;
      add(t0, len, (t) => {
        const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 3);
        ph = (ph + (f * vib) / SR) % 1;
        const x = (ph * 2 - 1) * Math.min(1, t * 25) * Math.min(1, (len - t) * 10);
        const o1 = (c1.b0 * x - c1.b0 * x2 - c1.a1 * y1 - c1.a2 * y2) / c1.n;
        y2 = y1;
        y1 = o1;
        const o2 = (c2.b0 * x - c2.b0 * u2 - c2.a1 * z1 - c2.a2 * z2) / c2.n;
        z2 = z1;
        z1 = o2;
        x2 = x1;
        x1 = x;
        u2 = u1;
        u1 = x;
        return (o1 * 1.6 + o2) * 0.5;
      }, -0.05);
    },
  };
}

const sections = {};

// ── club-128: 96 bars, ~3 minutes ────────────────────────────────────────
{
  const bpm = 128, beat = 60 / bpm, bar = beat * 4;
  const plan = [['intro', 8], ['groove', 16], ['build', 16], ['drop', 16], ['breakdown', 8], ['build2', 8], ['drop2', 16], ['outro', 8]];
  const total = plan.reduce((a, [, b]) => a + b, 0);
  const tr = track(total * bar + 2);
  const v = voices(tr, 11);
  const roots = [55, 49, 41.2, 43.65];
  let b0 = 0;
  const marks = {};
  for (const [name, bars] of plan) {
    marks[name] = +(b0 * bar).toFixed(3);
    for (let b = 0; b < bars; b++) {
      const gb = b0 + b, t = gb * bar, root = roots[gb % 4];
      const drums = name !== 'breakdown';
      const full = name.startsWith('drop');
      v.pad(t, [root * 4, root * 5, root * 6], bar, name === 'breakdown' ? 2.2 : 1);
      for (let k = 0; k < 4; k++) {
        const tk = t + k * beat;
        if (drums && name !== 'intro') v.kick(tk, full ? 1.15 : 1);
        if (drums) v.hat(tk + beat / 2, k === 3 && full);
        if (full) v.hat(tk + beat / 4, false, -0.3);
        if (drums && name !== 'intro' && (k === 1 || k === 3)) (full ? v.clap : v.snare)(tk);
        if (name !== 'intro' && name !== 'breakdown') v.bass(tk + beat / 2, root, beat * 0.45, full ? 1.3 : 1);
      }
      if (name.startsWith('build')) {
        // Snare roll speeding up over the build, a riser under it.
        const pos = b / bars;
        const hits = pos < 0.5 ? 4 : pos < 0.75 ? 8 : 16;
        for (let k = 0; k < hits; k++) v.snare(t + (k * bar) / hits, 0.35 + pos * 0.6);
        if (b === 0) v.riser(t, bars * bar);
      }
      if (full && b === 0) v.crash(t);
    }
    b0 += bars;
  }
  writeWav(join(outDir, 'club-128.wav'), tr);
  sections['club-128'] = { bpm, seconds: +(total * bar).toFixed(2), marks };
}

// ── half-85: half-time groove with a sung-like melody ────────────────────
{
  const bpm = 85, beat = 60 / bpm, bar = beat * 4, bars = 32;
  const tr = track(bars * bar + 2);
  const v = voices(tr, 23);
  const melody = [0, 3, 5, 7, 5, 3, 0, -2];
  const marks = { start: 0, verse: +(4 * bar).toFixed(3), instrumental: +(20 * bar).toFixed(3) };
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    v.pad(t, [110, 130.8, 164.8], bar, 0.8);
    v.kick(t);
    v.kick(t + beat * 2.5, 0.7);
    v.snare(t + beat * 2);
    for (let k = 0; k < 8; k++) v.hat(t + k * beat * 0.5 + (k % 2 ? beat * 0.08 : 0), false, 0.25);
    v.bass(t, 55, beat * 1.5);
    v.bass(t + beat * 2.5, 49, beat);
    // Sung bars 4-19 and 24-31; bars 20-23 are instrumental.
    if ((b >= 4 && b < 20) || b >= 24) {
      for (let k = 0; k < 2; k++) {
        const note = melody[(b * 2 + k) % melody.length];
        v.voice(t + k * beat * 2, 220 * 2 ** (note / 12), beat * 1.8);
      }
    }
  }
  writeWav(join(outDir, 'half-85.wav'), tr);
  sections['half-85'] = { bpm, seconds: +(bars * bar).toFixed(2), marks };
}

// ── break-174: breakbeat, busy hats, reese bass ──────────────────────────
{
  const bpm = 174, beat = 60 / bpm, bar = beat * 4, bars = 48;
  const tr = track(bars * bar + 2);
  const v = voices(tr, 37);
  const marks = { intro: 0, drop: +(16 * bar).toFixed(3), roller: +(32 * bar).toFixed(3) };
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    const on = b >= 8;
    if (on) {
      // Two-step break: kick on 1 and the "and" of 3, snare on 2 and 4.
      v.kick(t);
      v.kick(t + beat * 2.5);
      v.snare(t + beat);
      v.snare(t + beat * 3);
      if (b % 2) v.snare(t + beat * 3.75, 0.5);
    }
    for (let k = 0; k < 16; k++) if (b >= 4) v.hat(t + (k * beat) / 4, k % 8 === 6, k % 2 ? 0.3 : -0.3);
    if (b >= 16) v.reese(t, [43.65, 41.2, 36.7, 49][b % 4], bar);
    else v.pad(t, [174.6, 220, 261.6], bar, 0.7);
    if (b === 16 || b === 32) v.crash(t);
  }
  writeWav(join(outDir, 'break-174.wav'), tr);
  sections['break-174'] = { bpm, seconds: +(bars * bar).toFixed(2), marks };
}

// ── quiet-stop: near silence, a groove, a hard stop ──────────────────────
{
  const bpm = 120, beat = 60 / bpm, bar = beat * 4;
  const tr = track(8 * bar + 16 * bar + 10);
  const v = voices(tr, 41);
  for (let b = 0; b < 8; b++) v.pad(b * bar, [220, 277], bar, 0.08);
  for (let b = 8; b < 24; b++) {
    const t = b * bar;
    v.pad(t, [110, 138.6, 164.8], bar, 0.9);
    for (let k = 0; k < 4; k++) {
      v.kick(t + k * beat);
      v.hat(t + k * beat + beat / 2);
      if (k % 2) v.snare(t + k * beat);
    }
  }
  writeWav(join(outDir, 'quiet-stop.wav'), tr);
  sections['quiet-stop'] = { bpm, seconds: +(24 * bar + 10).toFixed(2), marks: { quiet: 0, groove: +(8 * bar).toFixed(3), stop: +(24 * bar).toFixed(3) } };
}

writeFileSync(join(outDir, 'suite.json'), JSON.stringify(sections, null, 2));
console.log(`wrote ${Object.keys(sections).length} tracks to ${outDir}`);
