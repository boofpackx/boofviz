// A synthetic band for testing note tracking: drums, a bass line, two rhythm
// guitars panned left and right, a lead riff and a sung melody (formant
// synthesis), in verse/chorus sections, with the ground truth of every note.
// Shared by the unit tests (tests/band.test.ts) and the in-app capture
// (scripts/fret-capture.mjs). Test material only: the words and tunes are
// made up here.

const SECTIONS = [
  ['intro', 4],
  ['verse', 8],
  ['chorus', 8],
  ['verse', 8],
  ['chorus', 8],
  ['bridge', 4],
  ['chorus', 8],
  ['outro', 2],
];

// Chords as [root MIDI note (E2 = 40), minor?] per bar.
const PROGRESSIONS = {
  intro: [[40, 1], [36, 0], [43, 0], [38, 0]],
  verse: [[40, 1], [36, 0], [43, 0], [38, 0]],
  chorus: [[36, 0], [43, 0], [38, 0], [40, 1]],
  bridge: [[45, 1], [43, 0], [41, 0], [38, 0]],
  outro: [[40, 1], [40, 1]],
};

// Melodies as [beat offset in the two-bar line, MIDI note, length in beats, syllable].
const MELODIES = {
  verse: [
    [0.5, 59, 0.5, 'we'], [1, 62, 0.5, 'drive'], [1.5, 64, 1, 'through'], [3, 62, 0.5, 'the'], [3.5, 64, 1.5, 'night'],
    [5, 66, 0.5, 'with'], [5.5, 64, 0.5, 'the'], [6, 62, 1.5, 'lights'], [7.5, 59, 0.5, 'down'],
  ],
  chorus: [
    [0, 67, 1, 'oh'], [1, 69, 0.5, 'we'], [1.5, 71, 1.5, 'run'], [3, 69, 1, 'so'], [4, 67, 0.5, 'far'],
    [4.5, 66, 0.5, 'a'], [5, 64, 1.5, 'way'], [6.5, 66, 0.5, 'to'], [7, 67, 1, 'night'],
  ],
  bridge: [[0, 64, 2, 'stay'], [2, 66, 1, 'with'], [3, 67, 3, 'me'], [6, 64, 2, 'now']],
};

// The lead riff (intro, bridge): [eighth in the bar, MIDI note].
const RIFF = [[0, 64], [1, 67], [2, 69], [3, 71], [4, 69], [5, 67], [6, 66], [7, 64]];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Vowel formants (Hz) and bandwidths for the singer. */
const VOWELS = {
  a: [[800, 80], [1150, 90], [2900, 120]],
  e: [[400, 60], [1600, 80], [2700, 120]],
  i: [[300, 50], [2100, 90], [3000, 120]],
  o: [[450, 70], [800, 80], [2830, 120]],
  u: [[325, 50], [700, 60], [2530, 120]],
};

function vowelOf(syl) {
  const m = syl.match(/[aeiouy]/);
  const v = m ? m[0] : 'a';
  return v === 'y' ? 'i' : v;
}

/**
 * Render the song. Returns stereo samples, the ground truth of every part
 * (times in seconds from the start), the lyric lines and the sections.
 */
export function bandSong(opts = {}) {
  const sr = opts.sr ?? 48000;
  const bpm = opts.bpm ?? 120;
  const sections = opts.sections ?? SECTIONS;
  const parts = opts.parts ?? { drums: true, bass: true, guitar: true, lead: true, vocals: true };
  const beat = 60 / bpm;
  const bars = sections.reduce((a, [, n]) => a + n, 0);
  const total = Math.round((bars * 4 * beat + 2) * sr);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const rand = rng(opts.seed ?? 3);
  const human = (ms) => ((rand() - 0.5) * 2 * ms) / 1000;
  const truth = { kick: [], snare: [], hat: [], crash: [], bass: [], guitar: [], lead: [], vocals: [] };
  const lyrics = [];
  const sectionTimes = [];

  const add = (t0, len, pan, fn) => {
    const st = Math.max(0, Math.round(t0 * sr));
    const n = Math.min(total - st, Math.round(len * sr));
    const gl = Math.min(1, 1 - pan);
    const gr = Math.min(1, 1 + pan);
    for (let i = 0; i < n; i++) {
      const v = fn(i / sr, i);
      L[st + i] += v * gl;
      R[st + i] += v * gr;
    }
  };

  // ---- Drums ----
  const kick = (t0, vel) => {
    truth.kick.push(t0);
    let ph = 0;
    add(t0, 0.35, 0, (t) => {
      ph += (2 * Math.PI * (48 + 110 * Math.exp(-t * 28))) / sr;
      const click = t < 0.004 ? (rand() * 2 - 1) * 0.5 * (1 - t / 0.004) : 0;
      return vel * (0.85 * Math.sin(ph) * Math.exp(-t * 7) + click);
    });
  };
  const snare = (t0, vel) => {
    truth.snare.push(t0);
    let lp = 0;
    add(t0, 0.25, 0.05, (t) => {
      const n = rand() * 2 - 1;
      lp += 0.3 * (n - lp);
      return vel * ((n - lp) * 1.1 * Math.exp(-t * 17) + 0.6 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 26));
    });
  };
  const hat = (t0, vel, open = false) => {
    (open ? truth.crash : truth.hat).push(t0);
    let prev = 0;
    add(t0, open ? 1.8 : 0.06, 0.25, (t) => {
      const n = rand() * 2 - 1;
      const v = n - prev;
      prev = n;
      return vel * v * (open ? 0.32 * Math.exp(-t * 2.2) : 0.2 * Math.exp(-t * 75));
    });
  };

  // ---- Pitched voices ----
  // Band-limited sawtooth-like tone: sin(hθ) by the Chebyshev recurrence (one sin and one cos a sample).
  const weights = new Map();
  const weightsFor = (tilt) => {
    let w = weights.get(tilt);
    if (!w) {
      w = new Float64Array(41);
      for (let h = 1; h <= 40; h++) w[h] = 1 / Math.pow(h, tilt);
      weights.set(tilt, w);
    }
    return w;
  };
  const harmonics = (th, count, w) => {
    const c = Math.cos(th);
    let s0 = 0;
    let s1 = Math.sin(th);
    let v = s1 * w[1];
    for (let h = 2; h <= count; h++) {
      const s2 = 2 * c * s1 - s0;
      v += s2 * w[h];
      s0 = s1;
      s1 = s2;
    }
    return v;
  };
  const saw = (f, t, count, tilt) => harmonics(2 * Math.PI * f * t, Math.min(count, Math.floor((sr * 0.45) / f)), weightsFor(tilt));
  const bassNote = (t0, midi, dur, vel) => {
    truth.bass.push({ t: t0, dur, midi });
    const f = hz(midi);
    add(t0, dur + 0.08, 0, (t) => {
      const env = Math.min(1, t / 0.005) * (0.55 + 0.45 * Math.exp(-t * 6)) * (t > dur ? Math.exp(-(t - dur) * 60) : 1);
      return vel * env * saw(f, t, 10, 1.4) * 0.5;
    });
  };
  const powerChord = (t0, root, dur, vel, muted) => {
    truth.guitar.push({ t: t0, dur, midi: root, chord: 3 });
    for (const [pan, detune, delay] of [
      [-0.75, 0.998, 0],
      [0.75, 1.003, 0.006],
    ]) {
      const fs = [root, root + 7, root + 12].map((m) => hz(m) * detune);
      add(t0 + delay, dur + 0.05, pan, (t) => {
        const env = Math.min(1, t / 0.004) * (muted ? Math.exp(-t * 18) : 0.6 + 0.4 * Math.exp(-t * 3)) * (t > dur ? Math.exp(-(t - dur) * 50) : 1);
        let x = 0;
        for (const fv of fs) x += saw(fv, t, muted ? 6 : 12, 1.1);
        return vel * env * Math.tanh(x * 1.6) * 0.5;
      });
    }
  };
  const leadNote = (t0, midi, dur, vel) => {
    truth.lead.push({ t: t0, dur, midi });
    const f = hz(midi);
    add(t0, dur + 0.05, -0.3, (t) => {
      const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 4);
      const env = Math.min(1, t / 0.004) * Math.exp(-t * 2.5) * (t > dur ? Math.exp(-(t - dur) * 50) : 1);
      return vel * env * Math.tanh(saw(f * vib, t, 12, 1.2) * 1.4) * 0.45;
    });
  };
  // The singer: harmonics of the pitch shaped by the vowel's formants, a little
  // vibrato after the attack, a short glide from the previous note, breath at the start.
  let lastVocal = 0;
  const sing = (t0, midi, dur, syl, vel) => {
    truth.vocals.push({ t: t0, dur, midi, syl });
    const f1 = hz(midi);
    const f0 = lastVocal && t0 - lastVocal.end < 0.2 ? lastVocal.f : f1;
    lastVocal = { f: f1, end: t0 + dur };
    const formants = VOWELS[vowelOf(syl)];
    const env = (f) => {
      let a = 0.02;
      for (const [fc, bw] of formants) a += 1 / (1 + Math.pow((f - fc) / bw, 2));
      return a;
    };
    const amps = new Float64Array(41);
    let phase = 0;
    add(t0, dur + 0.04, 0, (t) => {
      const glide = Math.min(1, t / 0.05);
      const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.6 * t) * Math.min(1, Math.max(0, (t - 0.15) * 4));
      const f = (f0 + (f1 - f0) * glide) * vib;
      const a = Math.min(1, t / 0.03) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.04) : 1);
      phase += (2 * Math.PI * f) / sr;
      const count = Math.min(40, Math.floor(5000 / f));
      for (let h = 1; h <= count; h++) amps[h] = env(f * h) / h;
      const breath = t < 0.025 ? (rand() * 2 - 1) * 0.15 * (1 - t / 0.025) : 0;
      return vel * (a * harmonics(phase, count, amps) * 0.5 + breath);
    });
  };

  // ---- The arrangement ----
  let bar = 0;
  for (const [name, nbars] of sections) {
    const sectionStart = bar * 4 * beat;
    sectionTimes.push({ name, t: sectionStart });
    const prog = PROGRESSIONS[name] ?? PROGRESSIONS.verse;
    const loud = name === 'chorus';
    for (let b = 0; b < nbars; b++) {
      const tb = (bar + b) * 4 * beat;
      const [root, minor] = prog[b % prog.length];
      void minor;
      const last = b === nbars - 1;
      // Drums: kick 1 and 3 (and the "and" of 3 in choruses), snare 2 and 4, 8th hats, a crash on each section.
      if (parts.drums && name !== 'bridge') {
        if (b === 0) hat(tb + human(4), 0.9, true);
        for (let k = 0; k < 4; k++) {
          const t0 = tb + k * beat;
          if (k === 0 || k === 2) kick(t0 + human(6), loud ? 0.95 : 0.85);
          if (loud && k === 2) kick(t0 + beat / 2 + human(6), 0.8);
          if (k === 1 || (k === 3 && !(last && name !== 'outro'))) snare(t0 + human(6), loud ? 0.75 : 0.65);
          if (k === 3 && last && name !== 'outro') for (let s = 0; s < 4; s++) snare(t0 + (s * beat) / 4 + human(4), 0.45 + 0.1 * s);
          if (!(b === 0 && k === 0)) hat(t0 + human(5), 0.8);
          hat(t0 + beat / 2 + human(5), 0.55);
        }
      }
      // Bass: 8ths on the root in verses, quarters with a move to the fifth in choruses.
      if (parts.bass && name !== 'intro') {
        // A bass player's range: E1 (28) up, an octave under the guitar where it fits.
        const bassRoot = root - 12 >= 28 ? root - 12 : root;
        if (name === 'chorus' || name === 'outro') {
          for (let k = 0; k < 4; k++) bassNote(tb + k * beat + human(5), k === 3 ? bassRoot + 7 : bassRoot, beat * 0.9, 0.8);
        } else if (name === 'bridge') {
          bassNote(tb + human(5), bassRoot, beat * 3.8, 0.7);
        } else {
          for (let e = 0; e < 8; e++) bassNote(tb + (e * beat) / 2 + human(5), e === 7 ? bassRoot + 12 : bassRoot, beat * 0.45, 0.75);
        }
      }
      // Rhythm guitars: palm-muted 8ths in verses, big open chords in choruses (E2 to D#3, an octave over the bass).
      const groot = root < 40 ? root + 12 : root;
      if (parts.guitar && name !== 'bridge') {
        if (loud || name === 'outro') {
          powerChord(tb + human(5), groot, beat * 1.45, 0.75, false);
          powerChord(tb + beat * 1.5 + human(5), groot, beat * 2.4, 0.7, false);
        } else if (name === 'verse') {
          for (let e = 0; e < 8; e++) powerChord(tb + (e * beat) / 2 + human(5), groot, beat * 0.4, 0.55, true);
        }
      }
      // The lead riff in the intro and the bridge.
      if (parts.lead && (name === 'intro' || name === 'bridge')) {
        for (const [e, m] of RIFF) leadNote(tb + (e * beat) / 2 + human(5), m + (name === 'bridge' ? 5 : 0), beat * 0.45, 0.8);
      }
      // Vocals: a line every two bars.
      if (parts.vocals && MELODIES[name] && b % 2 === 0) {
        const line = MELODIES[name];
        lyrics.push({ t: tb + line[0][0] * beat, text: line.map((n) => n[3]).join(' ') });
        for (const [off, m, len, syl] of line) sing(tb + off * beat + human(8), m, len * beat * 0.92, syl, 0.75);
      }
    }
    bar += nbars;
  }
  // Normalise (or a fixed gain, to compare parts rendered alone).
  let peak = 1e-9;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = opts.gain ?? 0.9 / peak;
  for (let i = 0; i < total; i++) {
    L[i] *= k;
    R[i] *= k;
  }
  for (const key of Object.keys(truth)) truth[key].sort((a, b) => (a.t ?? a) - (b.t ?? b));
  return { sr, bpm, L, R, truth, lyrics, sections: sectionTimes, seconds: total / sr };
}

/** 16-bit stereo WAV of a rendered song. */
export function toWav(song) {
  const { sr, L, R } = song;
  const n = L.length;
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
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  return buf;
}
