import { describe, expect, it } from 'vitest';
import { describeMapping, interpret, matches, MIDI_TARGETS, parseMidi } from '@/control/midiCore';

describe('MIDI learn', () => {
  it('reads CCs and notes, and ignores clock and other system messages', () => {
    expect(parseMidi([0xb6, 16, 100])).toEqual({ type: 'cc', channel: 6, number: 16, value: 100 });
    expect(parseMidi([0x97, 0, 127])).toEqual({ type: 'note', channel: 7, number: 0, value: 127 });
    expect(parseMidi([0x87, 0, 64])).toEqual({ type: 'note', channel: 7, number: 0, value: 0 });
    expect(parseMidi([0xf8])).toBeNull();
    expect(parseMidi([0xe0, 0, 64])).toBeNull();
  });

  it('fires buttons once per press, holds while down, levels for knobs, steps for endless knobs', () => {
    const note = (v: number) => ({ type: 'note' as const, channel: 0, number: 1, value: v });
    const cc = (v: number) => ({ type: 'cc' as const, channel: 0, number: 2, value: v });
    expect(interpret('trigger', note(127), false)).toEqual({ press: true });
    expect(interpret('trigger', note(127), true)).toEqual({});
    expect(interpret('hold', note(0), true)).toEqual({ release: true });
    expect(interpret('toggle', cc(127), false)).toEqual({ press: true });
    expect(interpret('toggle', cc(0), true)).toEqual({ release: true });
    expect(interpret('value', cc(127), false)).toEqual({ value: 1 });
    expect(interpret('value', cc(0), false)).toEqual({ value: 0 });
    expect(interpret('relative', cc(1), false)).toEqual({ steps: 1 });
    expect(interpret('relative', cc(127), false)).toEqual({ steps: -1 });
  });

  it('matches a mapping on its message (and its controller, when one is set)', () => {
    const map = { target: 'go', input: 'DDJ', type: 'note' as const, channel: 7, number: 0 };
    const m = { type: 'note' as const, channel: 7, number: 0, value: 127 };
    expect(matches(map, 'DDJ', m)).toBe(true);
    expect(matches(map, 'Other', m)).toBe(false);
    expect(matches({ ...map, input: '' }, 'Other', m)).toBe(true);
    expect(matches(map, 'DDJ', { ...m, number: 1 })).toBe(false);
    expect(describeMapping(map)).toBe('Note 0 · ch 8');
  });

  it('has a unique id for every function', () => {
    expect(new Set(MIDI_TARGETS.map((t) => t.id)).size).toBe(MIDI_TARGETS.length);
  });
});
