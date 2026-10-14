import { GRID_ROW, GRID_SLOTS, type NoteGridState } from '@shared/types/audio';

/**
 * The note chart for a guitar-game highway, written live from the note grid
 * (audio/tempo/noteGrid.ts). The audio only arrives as it plays, so the notes
 * still to come are predicted: music repeats in one-, two- and four-bar loops,
 * so the slot a bar (or two, or four) back says what this slot will hold. Each
 * slot is predicted from the grid as it stood when the slot came into view, so
 * a note never changes on its way down, and when it reaches the frets the
 * music says whether it was right (a hit) or not (it slides past).
 *
 * Lanes, like a chart written for the song: kicks on green and red (beats 1
 * and 3, 2 and 4), the snare on yellow, hi-hats on blue and orange, and the
 * notes of a riff or melody across all five by pitch, held ones as sustains.
 * Pure: the preview and the output write the same chart.
 */

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

const MASK = GRID_SLOTS - 1;
const DRUMS = [GRID_ROW.kick, GRID_ROW.snare, GRID_ROW.hat, GRID_ROW.tone] as const;
/** Bits of SlotEvents.cats. */
export const CAT = { kick: 1, snare: 2, hat: 4, tone: 8 } as const;

/** What the music did, or is expected to do, on one 16th-note slot. */
export interface SlotEvents {
  /** Onset strengths, 0 = none (1..255). */
  kick: number;
  snare: number;
  hat: number;
  tone: number;
  /** The tone's pitch, 0..255 (low to high). */
  pitch: number;
  /** How long the tone held (slots). */
  hold: number;
}

export interface ChartNote {
  slot: number;
  /** One bit per lane (1 = green … 16 = orange). */
  lanes: number;
  /** Sustain (slots, 0 = a tap). */
  hold: number;
  /** Part of a star phrase. */
  star: boolean;
  /** Which kinds of onset the note stands for (CAT bits). */
  cats: number;
  /** 0..1: how many of the past repeats agree. */
  conf: number;
}

/** Where bars and phrases fall on the slot grid. */
export interface ChartMeter {
  /** Any slot that starts a bar, and one that starts a phrase. */
  barStart: number;
  phraseStart: number;
  barSlots: number;
  phraseSlots: number;
}

export interface ChartOptions extends ChartMeter {
  difficulty: Difficulty;
}

export function laneCount(d: Difficulty): number {
  return d === 'easy' ? 3 : d === 'medium' ? 4 : 5;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function bits(v: number): number {
  let n = 0;
  for (let x = v; x; x &= x - 1) n++;
  return n;
}

/** A grid byte, or 0 for a slot outside what the grid holds. */
export function gridAt(g: NoteGridState, row: number, s: number): number {
  if (s > g.slot || s <= g.slot - g.valid || s <= g.slot - GRID_SLOTS) return 0;
  return g.data[row * GRID_SLOTS + (s & MASK)];
}

/** Does the grid hold slot s? */
export function inGrid(g: NoteGridState, s: number): boolean {
  return s <= g.slot && s > g.slot - g.valid && s > g.slot - GRID_SLOTS;
}

export function eventsAt(g: NoteGridState, s: number): SlotEvents {
  return {
    kick: gridAt(g, GRID_ROW.kick, s),
    snare: gridAt(g, GRID_ROW.snare, s),
    hat: gridAt(g, GRID_ROW.hat, s),
    tone: gridAt(g, GRID_ROW.tone, s),
    pitch: gridAt(g, GRID_ROW.pitch, s),
    hold: gridAt(g, GRID_ROW.hold, s),
  };
}

/** The kinds of onset on slot s (CAT bits). */
export function catsAt(g: NoteGridState, s: number): number {
  let c = 0;
  for (let i = 0; i < DRUMS.length; i++) if (gridAt(g, DRUMS[i], s)) c |= 1 << i;
  return c;
}

/**
 * The loop length (slots: one, two or four bars) that best explains the grid
 * up to slot c, and how well (0..1, overlap of the onsets). A longer loop
 * wins only when it explains clearly more (a fill every other bar).
 */
export function bestPeriod(g: NoteGridState, c: number, barSlots: number): { period: number; score: number } {
  const span = barSlots * 2;
  let period = 0;
  let score = 0;
  for (const k of [1, 2, 4]) {
    const p = k * barSlots;
    let inter = 0;
    let union = 0;
    let n = 0;
    for (let t = c - span + 1; t <= c; t++) {
      if (!inGrid(g, t) || !inGrid(g, t - p)) continue;
      n++;
      const a = catsAt(g, t);
      const b = catsAt(g, t - p);
      inter += bits(a & b);
      union += bits(a | b);
    }
    if (n < barSlots || union === 0) continue;
    const sc = inter / union;
    if (!period || sc > score + 0.04) {
      period = p;
      score = sc;
    }
  }
  return { period, score };
}

/** Median pitch (0..1) of the tones in the four bars up to slot c (0.5 with none). */
export function medianPitch(g: NoteGridState, c: number, barSlots: number): number {
  const ps: number[] = [];
  for (let t = c - barSlots * 4 + 1; t <= c; t++) if (gridAt(g, GRID_ROW.tone, t)) ps.push(gridAt(g, GRID_ROW.pitch, t) / 255);
  if (!ps.length) return 0.5;
  ps.sort((a, b) => a - b);
  return ps[ps.length >> 1];
}

const REPEAT_WEIGHTS = [1, 0.6, 0.35];

/**
 * What slot s is expected to hold, from the grid up to slot c (the last slot
 * heard when s came into view): a vote of the last three repeats of the loop.
 */
export function predictSlot(g: NoteGridState, s: number, c: number, barSlots: number): { ev: SlotEvents; cats: number; conf: number } | null {
  const { period, score } = bestPeriod(g, c, barSlots);
  if (!period || score < 0.2) return null;
  const m0 = Math.max(1, Math.ceil((s - c) / period));
  const ev: SlotEvents = { kick: 0, snare: 0, hat: 0, tone: 0, pitch: 0, hold: 0 };
  let cats = 0;
  let conf = 0;
  let tonal = false;
  for (let i = 0; i < DRUMS.length; i++) {
    let vote = 0;
    let avail = 0;
    let strength = 0;
    for (let m = 0; m < REPEAT_WEIGHTS.length; m++) {
      const t = s - (m0 + m) * period;
      if (!inGrid(g, t)) break;
      avail += REPEAT_WEIGHTS[m];
      const v = gridAt(g, DRUMS[i], t);
      if (v) {
        vote += REPEAT_WEIGHTS[m];
        if (!strength) strength = v;
        if (DRUMS[i] === GRID_ROW.tone && !tonal) {
          tonal = true;
          ev.pitch = gridAt(g, GRID_ROW.pitch, t);
          ev.hold = gridAt(g, GRID_ROW.hold, t);
        }
      }
    }
    if (!avail || vote / avail < 0.5) continue;
    cats |= 1 << i;
    conf = Math.max(conf, vote / avail);
    if (i === 0) ev.kick = strength;
    else if (i === 1) ev.snare = strength;
    else if (i === 2) ev.hat = strength;
    else ev.tone = strength;
  }
  if (!cats) return null;
  return { ev, cats, conf: conf * Math.min(1, score / 0.5) };
}

/** Is slot s in a star phrase (the last two bars of every other phrase)? */
export function isStar(s: number, m: ChartMeter): boolean {
  const phrase = Math.floor((s - m.phraseStart) / m.phraseSlots);
  const bar = Math.floor(mod(s - m.phraseStart, m.phraseSlots) / m.barSlots);
  return mod(phrase, 2) === 1 && bar >= m.phraseSlots / m.barSlots - 2;
}

/**
 * Lanes for what a slot holds, as a chart written for the song would put it:
 * the riff or melody across the lanes by pitch (around the middle lane, from
 * the recent median), drums on their own lanes, chords on big accents.
 * Easier charts keep fewer lanes and only the stronger beats.
 */
export function writeNote(ev: SlotEvents, s: number, o: ChartOptions, median: number): { lanes: number; hold: number } | null {
  const n = laneCount(o.difficulty);
  const inBar = mod(s - o.barStart, o.barSlots);
  // 0 quarter, 1 eighth, 2 sixteenth.
  const level = inBar % 4 === 0 ? 0 : inBar % 2 === 0 ? 1 : 2;
  const drumMax = o.difficulty === 'easy' ? 0 : o.difficulty === 'expert' ? 2 : 1;
  const toneMax = o.difficulty === 'easy' ? 0 : o.difficulty === 'medium' ? 1 : 2;
  const beatInBar = inBar >> 2;
  let lane = -1;
  let hold = 0;
  if (ev.tone && level <= toneMax) {
    lane = Math.round((n - 1) / 2 + (ev.pitch / 255 - median) / 0.07);
    lane = Math.max(0, Math.min(n - 1, lane));
    if (ev.hold >= 3) hold = ev.hold;
  } else if (level <= drumMax) {
    if (ev.snare) lane = Math.min(2, n - 1);
    else if (ev.kick) lane = beatInBar % 2;
    else if (ev.hat && o.difficulty !== 'easy') lane = n === 5 && ((inBar >> 1) & 3) === 3 ? 3 : n - 1;
  }
  if (lane < 0) return null;
  let lanes = 1 << lane;
  // Chords on the accents of harder charts: two kinds of hit together on the beat, hit hard.
  const kinds = (ev.kick ? 1 : 0) + (ev.snare ? 1 : 0) + (ev.tone ? 1 : 0);
  const loud = Math.max(ev.kick, ev.snare, ev.tone);
  if ((o.difficulty === 'hard' || o.difficulty === 'expert') && level === 0 && kinds >= 2 && (beatInBar === 0 || loud >= 170)) {
    lanes |= 1 << (lane + 2 < n ? lane + 2 : lane - 2);
  }
  return { lanes, hold };
}

/**
 * The chart note for slot s as seen when it came into view: `lookahead` slots
 * of highway ahead of the frets. Null for an empty slot.
 */
export function chartNote(g: NoteGridState, s: number, lookahead: number, o: ChartOptions): ChartNote | null {
  const c = Math.min(s - lookahead - 1, g.slot - 1);
  const p = predictSlot(g, s, c, o.barSlots);
  if (!p) return null;
  const w = writeNote(p.ev, s, o, medianPitch(g, c, o.barSlots));
  if (!w) return null;
  return { slot: s, lanes: w.lanes, hold: w.hold, star: isStar(s, o), cats: p.cats, conf: p.conf };
}

export type NoteResult = 'pending' | 'hit' | 'miss';

/**
 * How it went at the frets: a hit when the music played on the slot (or one
 * slot off, for what the note stands for), a miss once the slot has passed
 * without it.
 */
export function judge(g: NoteGridState, n: ChartNote): NoteResult {
  if (catsAt(g, n.slot)) return 'hit';
  if ((catsAt(g, n.slot - 1) | catsAt(g, n.slot + 1)) & n.cats) return 'hit';
  return g.slot >= n.slot + 2 ? 'miss' : 'pending';
}
