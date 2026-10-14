import { GRID_EXPECTED, GRID_ROW, GRID_SLOTS, type NoteGridState, type Part } from '@shared/types/audio';
import { settleSlots } from '@/audio/band/bandEngine';

/**
 * The chart a guitar-game highway shows, part by part, from the note grid
 * the analysis worker keeps (audio/band/): the expected rows say what each
 * part will play on the slots ahead (written once, a bar or so ahead, so a
 * gem never changes on its way down), the heard rows what it really played,
 * which judges each gem at the frets.
 *
 * Guitar and bass gems go across five lanes by pitch (around the part's
 * recent median), with chords, sustains and hammer-ons; drums are four pads
 * (snare red, hi-hat yellow, fills on blue, cymbals green) and a kick bar;
 * vocals are tubes at their pitch. Easier charts keep fewer lanes and only
 * the stronger beats. Pure: the preview and the output write the same chart.
 */

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

const MASK = GRID_SLOTS - 1;

export interface ChartNote {
  slot: number;
  part: Part;
  /** One bit per lane (guitar/bass: green … orange; drums: red, yellow, blue, green). */
  lanes: number;
  /** Drums: the kick (a bar across the highway). */
  kick: boolean;
  /** Sustain (slots, 0: a tap). */
  hold: number;
  /** A hammer-on (comes quickly after a different note, no strum). */
  hopo: boolean;
  /** Part of a star phrase. */
  star: boolean;
  /** Vocals: the pitch (MIDI). */
  pitch: number;
  /** How sure the prediction was (0..1). */
  conf: number;
}

/** Where bars and phrases fall on the slot grid. */
export interface ChartMeter {
  /** A slot that starts a bar, and one that starts a phrase. */
  barStart: number;
  phraseStart: number;
  barSlots: number;
  phraseSlots: number;
}

export interface ChartOptions extends ChartMeter {
  difficulty: Difficulty;
}

/** Where a pitched part's notes sit: the median pitch and its spread (semitones). */
export interface PitchRange {
  median: number;
  spread: number;
}

export function laneCount(d: Difficulty): number {
  return d === 'easy' ? 3 : d === 'medium' ? 4 : 5;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** A grid byte (0 for a slot the grid doesn't hold). */
export function gridAt(g: NoteGridState, row: number, s: number): number {
  if (s > g.slot + GRID_SLOTS / 2 || s <= g.slot - g.valid) return 0;
  return g.data[row * GRID_SLOTS + (s & MASK)];
}

const ROWS = {
  guitar: { on: GRID_ROW.guitar, pitch: GRID_ROW.guitarPitch, hold: GRID_ROW.guitarHold, conf: GRID_ROW.confGuitar },
  bass: { on: GRID_ROW.bass, pitch: GRID_ROW.bassPitch, hold: GRID_ROW.bassHold, conf: GRID_ROW.confBass },
  vocals: { on: GRID_ROW.vocals, pitch: GRID_ROW.vocalsPitch, hold: GRID_ROW.vocalsHold, conf: GRID_ROW.confVocals },
} as const;
const DRUM_ROWS = [GRID_ROW.kick, GRID_ROW.snare, GRID_ROW.hat, GRID_ROW.crash];

/** The rows a part's onsets are on. */
export function onsetRows(part: Part): number[] {
  return part === 'drums' ? DRUM_ROWS : [ROWS[part].on];
}

/**
 * The median and spread of a pitched part's heard notes over the eight bars
 * before slot `upTo` (for laying them across the lanes).
 */
export function pitchRange(g: NoteGridState, part: 'guitar' | 'bass' | 'vocals', upTo: number, barSlots: number): PitchRange {
  const r = ROWS[part];
  const ps: number[] = [];
  for (let s = upTo - barSlots * 8; s <= upTo; s++) if (gridAt(g, r.on, s)) ps.push(gridAt(g, r.pitch, s));
  if (ps.length < 4) return { median: 0, spread: 6 };
  ps.sort((a, b) => a - b);
  const q = (p: number): number => ps[Math.min(ps.length - 1, Math.floor(p * ps.length))];
  return { median: q(0.5), spread: Math.max(3, q(0.85) - q(0.15)) };
}

/** Is slot s in a star phrase (the last two bars of every other phrase)? */
export function isStar(s: number, m: ChartMeter): boolean {
  const phrase = Math.floor((s - m.phraseStart) / m.phraseSlots);
  const bar = Math.floor(mod(s - m.phraseStart, m.phraseSlots) / m.barSlots);
  return mod(phrase, 2) === 1 && bar >= m.phraseSlots / m.barSlots - 2;
}

/** 0 quarter note, 1 eighth, 2 sixteenth. */
function level(s: number, m: ChartMeter): number {
  const inBar = mod(s - m.barStart, m.barSlots);
  return inBar % 4 === 0 ? 0 : inBar % 2 === 0 ? 1 : 2;
}

/** The finest grid level a difficulty keeps (drums, pitched parts). */
function maxLevel(d: Difficulty): number {
  return d === 'easy' ? 0 : d === 'medium' ? 1 : 2;
}

/**
 * The chart note on slot s for `part`, from the expected rows. `prev` is the
 * note before it in the same part (for hammer-ons), `range` where the part's
 * pitches sit. Null for an empty slot.
 */
export function chartNote(g: NoteGridState, part: Part, s: number, o: ChartOptions, range: PitchRange, prev: ChartNote | null): ChartNote | null {
  const lv = level(s, o);
  if (lv > maxLevel(o.difficulty)) return null;
  const x = (row: number): number => gridAt(g, row + GRID_EXPECTED, s);
  const star = isStar(s, o);
  if (part === 'drums') {
    const kick = x(GRID_ROW.kick) > 0;
    let lanes = 0;
    if (x(GRID_ROW.snare)) {
      // A run of snares (a fill) walks onto the blue pad on the off sixteenths.
      const fill = o.difficulty !== 'easy' && lv === 2 && gridAt(g, GRID_ROW.snare + GRID_EXPECTED, s - 1) > 0;
      lanes |= fill ? 4 : 1;
    }
    if (x(GRID_ROW.hat) && (o.difficulty !== 'easy' || !lanes)) lanes |= 2;
    if (x(GRID_ROW.crash)) lanes |= 8;
    // Easy and medium don't ask for two pads and the kick at once.
    if ((o.difficulty === 'easy' || o.difficulty === 'medium') && lanes & 2 && lanes & ~2) lanes &= ~2;
    if (!kick && !lanes) return null;
    return { slot: s, part, lanes, kick, hold: 0, hopo: false, star, pitch: 0, conf: gridAt(g, GRID_ROW.confDrums, s) / 255 };
  }
  const r = ROWS[part];
  if (!x(r.on)) return null;
  const pitch = x(r.pitch);
  const hold = x(r.hold);
  const conf = gridAt(g, r.conf, s) / 255;
  if (part === 'vocals') return { slot: s, part, lanes: 0, kick: false, hold: Math.max(1, hold), hopo: false, star, pitch, conf };
  const n = laneCount(o.difficulty);
  const center = (n - 1) / 2;
  const step = Math.max(1.5, range.spread / (n - 1));
  let lane = range.median ? Math.round(center + (pitch - range.median) / step) : Math.round(center);
  lane = Math.max(0, Math.min(n - 1, lane));
  let lanes = 1 << lane;
  // Chords on harder charts: the struck chord as two lanes (three on expert for a big strum).
  const chord = part === 'guitar' ? x(GRID_ROW.guitarChord) : 1;
  if (chord > 1 && (o.difficulty === 'hard' || o.difficulty === 'expert')) {
    lanes |= 1 << (lane + 1 < n ? lane + 1 : lane - 1);
    if (o.difficulty === 'expert' && lv === 0 && lane + 2 < n) lanes |= 1 << (lane + 2);
  }
  const single = (lanes & (lanes - 1)) === 0;
  const hopo = !!prev && single && s - prev.slot <= 2 && prev.lanes !== lanes && o.difficulty !== 'easy';
  return { slot: s, part, lanes, kick: false, hold: hold >= 3 ? hold : 0, hopo, star, pitch, conf };
}

export type NoteResult = 'pending' | 'hit' | 'miss';

/**
 * How it went at the frets: a hit when the part played on the slot (or one
 * either side), a miss once the slot has passed (and every tracker has had
 * time to report it) without it.
 */
export function judge(g: NoteGridState, n: ChartNote, bpm: number): NoteResult {
  const rows = onsetRows(n.part);
  for (let d = -1; d <= 1; d++) for (const r of rows) if (gridAt(g, r, n.slot + d)) return 'hit';
  return g.slot >= n.slot + 2 + settleSlots(bpm) ? 'miss' : 'pending';
}

/** Did `part` play on slot s (heard)? For gems the chart didn't see coming. */
export function heardAt(g: NoteGridState, part: Part, s: number): boolean {
  for (const r of onsetRows(part)) if (gridAt(g, r, s)) return true;
  return false;
}

/** The sung pitch on slot s (0: not singing). */
export function vocalLine(g: NoteGridState, s: number): number {
  return gridAt(g, GRID_ROW.vocalsLine, s);
}
