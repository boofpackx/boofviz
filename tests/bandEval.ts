/** Scoring helpers for the band trackers against a synthetic song's ground truth. */
import { DEFAULT_ANALYSIS_SETTINGS, type RawHop } from '@shared/types/audio';
import { AnalysisCore, type HopFeatures } from '@/audio/dsp/analysisCore';
import { HopAnalyzer } from '@/audio/dsp/hopAnalyzer';
import { TempoPipeline } from '@/audio/tempo/pipeline';
// @ts-expect-error: plain JS test kit shared with the capture script
import { bandSong } from '../scripts/band-song.mjs';

export interface Song {
  sr: number;
  bpm: number;
  L: Float32Array;
  R: Float32Array;
  truth: {
    kick: number[];
    snare: number[];
    hat: number[];
    crash: number[];
    bass: Array<{ t: number; dur: number; midi: number }>;
    guitar: Array<{ t: number; dur: number; midi: number; chord: number }>;
    lead: Array<{ t: number; dur: number; midi: number }>;
    vocals: Array<{ t: number; dur: number; midi: number; syl: string }>;
  };
  lyrics: Array<{ t: number; text: string }>;
  sections: Array<{ name: string; t: number }>;
  seconds: number;
}

export function makeSong(opts: Record<string, unknown> = {}): Song {
  return bandSong(opts) as Song;
}

/** Play a song through the app's front end, analysis core and tempo pipeline, calling `each` per hop. */
export function play(song: Song, each: (f: HopFeatures, hop: RawHop, tempo: TempoPipeline) => void): void {
  const settings = DEFAULT_ANALYSIS_SETTINGS;
  const core = new AnalysisCore(song.sr);
  core.setSettings(settings);
  const tempo = new TempoPipeline(core.hopRate);
  tempo.configure(settings);
  const feats = AnalysisCore.allocFeatures();
  const front = new HopAnalyzer(song.sr, (h: RawHop) => {
    const f = core.process(h, feats);
    tempo.process(f, settings);
    each(f, h, tempo);
  });
  front.setSettings({ gainDb: 0, autoGain: true, gateDb: -60 });
  const B = 128;
  for (let i = 0; i + B <= song.L.length; i += B) front.process(song.L.subarray(i, i + B), song.R.subarray(i, i + B), B, i / song.sr);
}

export interface Found {
  t: number;
  midi?: number;
}

export interface Score {
  found: number;
  truth: number;
  hits: number;
  precision: number;
  recall: number;
  f1: number;
  /** Of the hits, how many had the right pitch (±1 semitone, or an octave off counted separately). */
  pitchOk: number;
  octave: number;
  /** Mean timing error of hits (s, found − true). */
  offset: number;
}

/** Match found onsets to true ones within `tol` seconds (greedy, nearest first). */
export function score(found: Found[], truth: Array<number | { t: number; midi?: number }>, tol = 0.06, from = 0, to = Infinity): Score {
  const T = truth.map((x) => (typeof x === 'number' ? { t: x } : x)).filter((x) => x.t >= from && x.t < to);
  const F = found.filter((x) => x.t >= from - tol && x.t < to + tol);
  const used = new Set<number>();
  let hits = 0;
  let pitchOk = 0;
  let octave = 0;
  let off = 0;
  for (const tr of T) {
    let best = -1;
    let bd = tol;
    for (let i = 0; i < F.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(F[i].t - tr.t);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) continue;
    used.add(best);
    hits++;
    off += F[best].t - tr.t;
    const fm = F[best].midi;
    const tm = (tr as { midi?: number }).midi;
    if (fm !== undefined && tm !== undefined) {
      const d = Math.abs(fm - tm);
      if (d <= 1) pitchOk++;
      else if (Math.abs(d - 12) <= 1 || Math.abs(d - 24) <= 1) octave++;
    }
  }
  const precision = hits / Math.max(1, F.length);
  const recall = hits / Math.max(1, T.length);
  return { found: F.length, truth: T.length, hits, precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall), pitchOk, octave, offset: off / Math.max(1, hits) };
}

export function fmt(name: string, s: Score): string {
  return `${name.padEnd(8)} found ${String(s.found).padStart(4)} / true ${String(s.truth).padStart(4)}  P ${s.precision.toFixed(2)} R ${s.recall.toFixed(2)} F1 ${s.f1.toFixed(2)}  pitch ${s.hits ? (s.pitchOk / s.hits).toFixed(2) : '-'} oct ${s.octave}  dt ${(s.offset * 1000).toFixed(0)}ms`;
}
