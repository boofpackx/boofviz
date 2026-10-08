import type { MidiMapping } from '@shared/settings';

/**
 * MIDI learn, the pure part: what can be mapped, reading messages, and what a
 * control does (buttons fire on press, knobs and faders set levels, endless
 * encoders step). Works with any controller: a DJ controller sends its pads
 * as notes and its knobs as CCs, and MIDI learn records whichever it sends.
 */

export type MidiKind = 'trigger' | 'toggle' | 'hold' | 'value' | 'relative';

export interface MidiTarget {
  id: string;
  label: string;
  group: string;
  kind: MidiKind;
}

const t = (group: string, id: string, label: string, kind: MidiKind): MidiTarget => ({ id, label, group, kind });

export const MIDI_TARGETS: MidiTarget[] = [
  t('Looks', 'go', 'GO (cued look to the screen)', 'trigger'),
  t('Looks', 'cue', 'Cue mode on/off', 'toggle'),
  t('Looks', 'next', 'Next look', 'trigger'),
  t('Looks', 'prev', 'Previous look', 'trigger'),
  t('Looks', 'browse', 'Browse looks (endless knob)', 'relative'),
  t('Looks', 'setNext', 'Next look in the set', 'trigger'),
  t('Looks', 'setPrev', 'Previous look in the set', 'trigger'),
  t('Looks', 'shuffle', 'Shuffle', 'trigger'),
  t('Looks', 'auto', 'Autopilot on/off', 'toggle'),
  t('Looks', 'cancel', 'Cancel the queued look', 'trigger'),
  ...Array.from({ length: 9 }, (_, i) => t('Starred looks', `fav:${i + 1}`, `Starred look ${i + 1}`, 'trigger')),
  ...Array.from({ length: 8 }, (_, i) => t('Macros', `macro:${i + 1}`, `Macro ${i + 1}`, 'value')),
  t('Lyrics', 'lyricsMode', 'Lyrics off / back on', 'toggle'),
  t('Lyrics', 'lyricsNext', 'Next lyric treatment', 'trigger'),
  t('Lyrics', 'lyricsPrev', 'Previous lyric treatment', 'trigger'),
  t('Master', 'blackout', 'Blackout on/off', 'toggle'),
  t('Master', 'strobe', 'Strobe (while held)', 'hold'),
  t('Master', 'freeze', 'Freeze (while held)', 'hold'),
  t('Master', 'freezeLatch', 'Freeze on/off', 'toggle'),
  t('Master', 'brightness', 'Brightness', 'value'),
  t('Master', 'speed', 'Speed', 'value'),
  t('Master', 'reactivity', 'Reactivity', 'value'),
  t('Master', 'saturation', 'Saturation', 'value'),
  t('Master', 'hueShift', 'Hue shift', 'value'),
  t('Master', 'trails', 'Trails', 'value'),
  t('Tempo', 'tap', 'Tap tempo', 'trigger'),
  t('Tempo', 'resync', 'Downbeat here', 'trigger'),
  t('Tempo', 'nudgeBack', 'Nudge back', 'trigger'),
  t('Tempo', 'nudgeFwd', 'Nudge forward', 'trigger'),
];

export const targetById = (id: string): MidiTarget | undefined => MIDI_TARGETS.find((x) => x.id === id);

export interface MidiMsg {
  type: 'cc' | 'note';
  channel: number;
  number: number;
  /** 0–127: CC value or note velocity (0 for note off). */
  value: number;
}

/** A channel message we can map (CC, note on/off); clock and other system messages are ignored. */
export function parseMidi(data: ArrayLike<number>): MidiMsg | null {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  if (status === 0xb0) return { type: 'cc', channel, number: data[1] & 0x7f, value: data[2] & 0x7f };
  if (status === 0x90) return { type: 'note', channel, number: data[1] & 0x7f, value: data[2] & 0x7f };
  if (status === 0x80) return { type: 'note', channel, number: data[1] & 0x7f, value: 0 };
  return null;
}

export const controlKey = (input: string, m: Pick<MidiMsg, 'type' | 'channel' | 'number'>): string => `${input}|${m.type}|${m.channel}|${m.number}`;

export function matches(map: MidiMapping, input: string, m: MidiMsg): boolean {
  return map.type === m.type && map.channel === m.channel && map.number === m.number && (!map.input || map.input === input);
}

export interface MidiEffect {
  /** A button went down (or up). */
  press?: boolean;
  release?: boolean;
  /** A knob or fader level, 0..1. */
  value?: number;
  /** Endless encoder steps (+ clockwise). */
  steps?: number;
}

/**
 * What a message does for a target kind. `wasOn` is whether this control was
 * down before (buttons sending CC 127/0 or notes on/off).
 */
export function interpret(kind: MidiKind, m: MidiMsg, wasOn: boolean): MidiEffect {
  const on = m.value >= 64 || (m.type === 'note' && m.value > 0);
  if (kind === 'value') return { value: m.value / 127 };
  if (kind === 'relative') {
    if (m.type === 'note') return m.value > 0 ? { steps: 1 } : {};
    // Two's-complement encoders: 1..63 clockwise, 65..127 anticlockwise.
    if (m.value === 0 || m.value === 64) return {};
    return { steps: m.value < 64 ? 1 : -1 };
  }
  if (on && !wasOn) return { press: true };
  if (!on && wasOn) return { release: true };
  return {};
}

/** "CC 16 · ch 7" for the mapping list. */
export function describeMapping(m: MidiMapping): string {
  return `${m.type === 'cc' ? 'CC' : 'Note'} ${m.number} · ch ${m.channel + 1}`;
}
