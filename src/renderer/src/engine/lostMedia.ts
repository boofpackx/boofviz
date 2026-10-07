import type { LostMediaSettings, NeoFlatSettings, RetroTvSettings } from '@shared/settings';
import type { ParamBag } from '@shared/types/engine';

/**
 * Lost-media "tape events": the shared, deterministic schedule of things that
 * happen to an old recording (rewind, pause, signal loss...). The tape effect
 * and the on-screen display both call tapeEventAt with the same beat, so the
 * picture and its "◀◀ REW" label agree, and preview and output match.
 */

export const TAPE_EVENTS = ['rewind', 'ffwd', 'pause', 'signal', 'eat', 'overwrite', 'focus'] as const;
export type TapeEventKind = 'none' | (typeof TAPE_EVENTS)[number];

export interface TapeEvent {
  kind: TapeEventKind;
  /** Index into TAPE_EVENTS + 1 (0 = none), for shaders. */
  index: number;
  /** Beat the event started on. */
  start: number;
  /** Length in beats. */
  beats: number;
  /** 0..1 progress through the event. */
  t: number;
  /** Envelope: eases in and out, 1 in the middle. */
  amount: number;
}

const NONE: TapeEvent = { kind: 'none', index: 0, start: 0, beats: 0, t: 0, amount: 0 };

/** 0..1 hash of an integer pair (stable across platforms). */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Length in beats of each event kind, as a fraction of a bar (capped to one bar). */
const LENGTH: Record<Exclude<TapeEventKind, 'none'>, number> = {
  rewind: 1,
  ffwd: 0.75,
  pause: 0.5,
  signal: 0.25,
  eat: 0.5,
  overwrite: 1,
  focus: 0.75,
};

/** Relative weights; `kinds` can restrict which events a look uses. */
const WEIGHT: Record<Exclude<TapeEventKind, 'none'>, number> = {
  rewind: 1,
  ffwd: 1,
  pause: 1.2,
  signal: 0.8,
  eat: 0.6,
  overwrite: 0.9,
  focus: 0.7,
};

/**
 * The tape event at `beat`, if any. `freq` 0..1 is how often (1 ≈ every other
 * bar). Events start on a bar line and last at most one bar; fast-forward
 * prefers the bar before a phrase change (it "runs into" the next section).
 */
export function tapeEventAt(beat: number, beatsPerBar: number, freq: number, seed = 0, kinds?: readonly TapeEventKind[]): TapeEvent {
  if (freq <= 0 || !Number.isFinite(beat)) return NONE;
  const bpb = Math.max(1, beatsPerBar);
  const bar = Math.floor(beat / bpb);
  const chance = Math.min(0.6, freq * 0.5) * (bar % 4 === 3 ? 1.4 : 1);
  if (hash2(bar, seed) >= chance) return NONE;
  const allowed = (kinds?.length ? kinds : TAPE_EVENTS).filter((k): k is Exclude<TapeEventKind, 'none'> => k !== 'none');
  if (!allowed.length) return NONE;
  const w = allowed.map((k) => WEIGHT[k] * (k === 'ffwd' && bar % 4 === 3 ? 2.5 : 1));
  let r = hash2(bar, seed + 7919) * w.reduce((a, b) => a + b, 0);
  let kind = allowed[allowed.length - 1];
  for (let i = 0; i < allowed.length; i++) {
    r -= w[i];
    if (r < 0) {
      kind = allowed[i];
      break;
    }
  }
  const start = bar * bpb;
  const beats = Math.max(0.5, LENGTH[kind] * bpb);
  const t = (beat - start) / beats;
  if (t < 0 || t >= 1) return NONE;
  const edge = Math.min(0.2, 0.5 / beats);
  const amount = Math.min(1, t / edge, (1 - t) / edge);
  return { kind, index: TAPE_EVENTS.indexOf(kind) + 1, start, beats, t, amount };
}

/** On-screen display text for an event (VCR style). */
export function osdText(kind: TapeEventKind): string {
  switch (kind) {
    case 'rewind':
      return '◀◀ REW';
    case 'ffwd':
      return '▶▶ FF';
    case 'pause':
      return 'II PAUSE';
    case 'signal':
      return 'NO SIGNAL';
    case 'eat':
      return 'TRACKING';
    default:
      return '';
  }
}

/** Seconds → "HH:MM:SS:FF" (30 fps timecode). */
export function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const f = Math.floor((s % 1) * 30);
  const p = (v: number): string => String(Math.floor(v)).padStart(2, '0');
  return `${p(s / 3600)}:${p((s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
}

/** Seconds → camcorder clock "PM 7:42:13", starting from a fixed time of day. */
export function camClock(seconds: number, startHour = 19.7): string {
  const total = Math.floor(startHour * 3600 + Math.max(0, seconds)) % 86400;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total / 60) % 60);
  const s = total % 60;
  return `${h >= 12 ? 'PM' : 'AM'} ${h % 12 || 12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** A post chain applied over the whole picture: text printed before the damage, effects, then a clean display on top. */
export interface PostSpec {
  under: ParamBag | null;
  fx: Array<{ type: string; params: ParamBag }>;
  over: ParamBag | null;
  /** The TV set, last (so the VCR display sits on the screen, not over the cabinet). */
  tv?: { type: string; params: ParamBag };
}

/** The global "make it lost media" chain for a style (null when off). */
export function lostMediaPost(s: LostMediaSettings | undefined): PostSpec | null {
  if (!s?.enabled) return null;
  const { wear, events, mood, date, station } = s;
  const stamp = (kit: string, extra: ParamBag = {}): ParamBag => ({ kit, captions: 'off', date, station, events, seed: 0, eventList: 'all', ...extra });
  switch (s.style) {
    case 'camcorder':
      return {
        under: stamp('camcorder'),
        fx: [{ type: 'tapeStack', params: { format: 'hi8', generation: 1 + Math.round(wear * 1.5), wear: wear * 0.7, events, eventList: 'focus,pause,signal', mood } }],
        over: null,
      };
    case 'broadcast':
      return {
        under: stamp('tv'),
        fx: [{ type: 'tapeStack', params: { format: 'broadcast', generation: 2, wear, events: events * 0.6, eventList: 'signal,eat,overwrite', mood } }],
        over: null,
      };
    case 'super8':
      return { under: null, fx: [{ type: 'filmStock', params: { stock: 'super8', tone: 'color', fps: 18, wear, weave: 1.2, dust: wear, flicker: 1, fade: 0.25 + 0.3 * mood, leaks: 0.6 * (1 - mood) + 0.1, splices: events * 0.6 } }], over: null };
    case 'archive':
      return { under: null, fx: [{ type: 'filmStock', params: { stock: 'nitrate', tone: mood > 0.6 ? 'bw' : 'sepia', fps: 16, wear: 0.6 + wear * 0.7, weave: 1.6, dust: 1.4, flicker: 1.6, fade: 0, leaks: 0, splices: events * 0.7 } }], over: null };
    case 'web':
      return { under: null, fx: [{ type: 'digitalRot', params: { lowres: 0.5 + 0.25 * wear, blocks: 0.3 + 0.3 * wear, bitrate: 0.25 + 0.25 * wear, mosh: events * 0.6, buffering: events * 0.5 } }], over: null };
    default:
      return {
        under: null,
        fx: [{ type: 'tapeStack', params: { format: 'vhs', generation: 2 + Math.round(wear * 2), wear, events, mood } }],
        over: stamp('vcr'),
      };
  }
}

/** The global post chain: lost media first (the picture ages), then the TV set it plays on. */
export function globalPost(lm: LostMediaSettings | undefined, tv: RetroTvSettings | undefined, neo?: NeoFlatSettings): PostSpec | null {
  let base = lostMediaPost(lm);
  // Neo-brutal flat goes first: the flat graphic is what then ages or plays on the TV.
  if (neo?.enabled) {
    const flat = { type: 'neoFlat', params: { colours: neo.colours, outline: neo.outline, shadow: neo.shadow, flatten: 1 } };
    base = base ? { ...base, fx: [flat, ...base.fx] } : { under: null, fx: [flat], over: null };
  }
  if (!tv?.enabled) return base;
  const set = { type: 'tvSet', params: { set: tv.set, zoom: tv.zoom, curve: 1, glare: 1, room: 1, powerOn: true } };
  return base ? { ...base, fx: [...base.fx], over: base.over, tv: set } : { under: null, fx: [], over: null, tv: set };
}
