import { lineIndexAt, type LyricLine } from '@shared/lyrics';
import type { GenContext } from './generators/Generator';
import { songMap, type SongMap } from './generators/lyricCinema';
import { timeWords } from './generators/lyricVideoMotion';
import { lyricMoment } from './lyricText';
import { currentLines, lyricsFeed, songPositionMs } from './lyricsFeed';

/**
 * The words around now, each with the song time it is sung, for looks that
 * show what's coming (notes scrolling in, moulds dropping, keyframes on a
 * timeline). Pure of the clock, the beat and the lyrics feed, so the preview
 * and the output agree.
 */

export interface StreamWord {
  text: string;
  /** Song time (s) the word is sung. */
  t: number;
  /** When the next word starts (or the line's sung part ends). */
  end: number;
  /** Line number in the song, and the word's place in it. */
  line: number;
  i: number;
  last: boolean;
}

export interface StreamLine {
  index: number;
  text: string;
  start: number;
  end: number;
  chorus: boolean;
  hero: number;
  words: StreamWord[];
}

export interface WordStream {
  /** Song time now (s). */
  now: number;
  lines: StreamLine[];
  /** Index into `lines` of the line being sung (−1: before the first, or nothing). */
  current: number;
  /** Real timed lyrics (false: a still title, the look's own words, or nothing). */
  synced: boolean;
  bpm: number;
  /** Words in the song's lines before the first of `lines` (for running counts). */
  before: number;
  /** The musical beat (continuous) at song time t. */
  beatAt(t: number): number;
}

const maps = new WeakMap<readonly LyricLine[], SongMap>();

function lineWords(index: number, text: string, start: number, end: number, stamps?: Array<{ t: number; text: string }>): StreamWord[] {
  const tl = timeWords(text, start, end, stamps);
  return tl.words.map((w, i) => {
    const next = tl.words[i + 1]?.start;
    // The last word holds a little past its start, not through an instrumental gap.
    const e = next ?? Math.min(end, w.start + Math.max(0.45, Math.min(1.6, ((w.start - start) / Math.max(1, i)) * 2)));
    return { text: w.text, t: w.start, end: e, line: index, i, last: i === tl.words.length - 1 };
  });
}

export function wordStream(ctx: GenContext, back = 2, ahead = 3): WordStream {
  const p = ctx.params;
  const upper = p.uppercase !== false;
  const fix = (s: string): string => (upper ? s.toUpperCase() : s);
  const bpm = Math.max(40, ctx.frame.bpm || 120);
  const synced = String(p.source ?? 'lyrics') === 'lyrics' && lyricsFeed.now.connected ? currentLines() : null;
  if (synced?.length) {
    const lead = typeof p.lead === 'number' ? p.lead : 0;
    const nowMs = songPositionMs(Date.now(), lead);
    const now = nowMs / 1000;
    const beatNow = ctx.frame.beat;
    let map = maps.get(synced);
    if (!map) {
      map = songMap(synced);
      maps.set(synced, map);
    }
    const i = lineIndexAt(synced, nowMs);
    const lines: StreamLine[] = [];
    for (let k = Math.max(0, i - back); k <= Math.min(synced.length - 1, i + ahead); k++) {
      const l = synced[k];
      if (!l.text.trim()) continue;
      const start = l.t / 1000;
      const end = synced[k + 1] ? synced[k + 1].t / 1000 : start + 4;
      lines.push({ index: k, text: fix(l.text), start, end, chorus: map.chorus[k], hero: map.hero[k], words: lineWords(k, fix(l.text), start, end, l.words) });
    }
    const current = lines.findIndex((l) => l.index === i);
    let before = 0;
    for (let k = 0; k < (lines[0]?.index ?? 0); k++) before += synced[k].text.split(/\s+/).filter(Boolean).length;
    return { now, lines, current, synced: true, bpm, before, beatAt: (t) => beatNow + ((t - now) * bpm) / 60 };
  }
  // A still title or the look's own words: one line, as lyricMoment has it.
  const m = lyricMoment(ctx);
  const text = m.current.text;
  const beatNow = ctx.frame.beat;
  const line: StreamLine = {
    index: m.index,
    text,
    start: m.current.start,
    end: m.current.end,
    chorus: false,
    hero: m.hero,
    words: text ? lineWords(m.index, text, m.current.start, m.current.end) : [],
  };
  return { now: m.now, lines: text ? [line] : [], current: text ? 0 : -1, synced: false, bpm, before: 0, beatAt: (t) => beatNow + ((t - m.now) * bpm) / 60 };
}

/** Where a time falls in the beat: 4 (on the beat), 8 (off-beat), 16 (a sixteenth), 12 (a triplet), or 0 (none). */
export function rhythmOf(beat: number, tolerance = 0.07): 4 | 8 | 12 | 16 | 0 {
  const f = beat - Math.floor(beat);
  const near = (x: number): boolean => Math.abs(f - x) < tolerance || Math.abs(f - x - 1) < tolerance || Math.abs(f - x + 1) < tolerance;
  if (near(0)) return 4;
  if (near(0.5)) return 8;
  if (near(0.25) || near(0.75)) return 16;
  if (near(1 / 3) || near(2 / 3)) return 12;
  return 0;
}

/** A stable small number for a word (same word, same number). */
export function wordHash(s: string): number {
  let h = 2166136261;
  for (const ch of s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}
