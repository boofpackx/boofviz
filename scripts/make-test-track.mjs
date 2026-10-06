#!/usr/bin/env node
// Synthesize a 128 BPM test track: groove → breakdown (no kick) → drop. 48 kHz stereo 16-bit WAV.
import { writeFileSync } from 'node:fs';
const sr = 48000, bpm = 128, beat = 60 / bpm;
const sections = [[16, true], [8, false], [24, true]]; // [beats, kick on]
const totalBeats = sections.reduce((a, [b]) => a + b, 0);
const seconds = totalBeats * beat + 1;
const n = Math.round(seconds * sr);
const L = new Float32Array(n), R = new Float32Array(n);
let s = 7; const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
let b0 = 0;
for (const [beats, kickOn] of sections) {
  for (let b = 0; b < beats; b++) {
    const gb = b0 + b; const t0 = gb * beat; const st = Math.round(t0 * sr);
    if (kickOn) { let ph = 0; for (let i = 0; i < 0.3 * sr && st + i < n; i++) { const t = i / sr; ph += 2 * Math.PI * (48 + 120 * Math.exp(-t * 30)) / sr; const v = 0.75 * Math.sin(ph) * Math.exp(-t * 8); L[st + i] += v; R[st + i] += v; } }
    if (gb % 2 === 1) { for (let i = 0; i < 0.2 * sr && st + i < n; i++) { const t = i / sr; const v = (0.3 * (rand() * 2 - 1) + 0.2 * Math.sin(2 * Math.PI * 185 * t)) * Math.exp(-t * 20); L[st + i] += v * 0.9; R[st + i] += v; } }
    for (const sub of [0.5]) { const sh = Math.round((t0 + sub * beat) * sr); let prev = 0; for (let i = 0; i < 0.06 * sr && sh + i < n; i++) { const x = rand() * 2 - 1; const v = 0.18 * (x - prev) * Math.exp(-i / sr * 70); prev = x; L[sh + i] += v * 0.7; R[sh + i] += v; } }
  }
  b0 += beats;
}
// Chord pad + bass line.
for (let i = 0; i < n; i++) { const t = i / sr; const bar = Math.floor(t / (beat * 4)) % 4; const root = [55, 49, 41.2, 43.65][bar];
  const pad = 0.035 * (Math.sin(2 * Math.PI * root * 4 * t) + Math.sin(2 * Math.PI * root * 5 * t + 1) + Math.sin(2 * Math.PI * root * 6 * t + 2));
  L[i] += pad; R[i] += pad * 0.9 + 0.02 * Math.sin(2 * Math.PI * root * 8.01 * t); }
const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 0.8 * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 0.8 * 32767))), 46 + i * 4); }
writeFileSync(process.argv[2], buf);
console.log('wrote', process.argv[2], seconds.toFixed(1), 's');
