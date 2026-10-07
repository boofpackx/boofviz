import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type LibrarySettings } from '@shared/settings';
import type { PresetEntry } from '@/engine/library';
import { autoInterval, energyTarget, nextAutoBeat, pickNext, resolvePool, type PickContext } from '@/control/autopilot';

const entry = (id: string, category: string, energy: number): PresetEntry =>
  ({ id, source: 'builtin', preset: { name: id, category, energy, layers: [], tags: [] } }) as unknown as PresetEntry;

const ALL = [entry('a', 'Equalizers', 1), entry('b', 'Equalizers', 2), entry('c', '2D Graphic', 3), entry('d', '2D Graphic', 4), entry('e', 'Pop Culture', 5)];
const lib = (patch: Partial<LibrarySettings>): LibrarySettings => ({ ...DEFAULT_SETTINGS.library, ...patch });
const ctx = (patch: Partial<PickContext>): PickContext => ({ all: ALL, view: ALL, currentId: 'a', recent: [], energy: 0.5, rand: 0.5, ...patch });

describe('shuffle pools', () => {
  it('resolves favorites, category, view and named pools', () => {
    expect(resolvePool(lib({ shufflePool: 'favorites', favorites: ['c', 'e'] }), ctx({})).entries.map((e) => e.id)).toEqual(['c', 'e']);
    expect(resolvePool(lib({ shufflePool: 'category' }), ctx({ currentId: 'c' })).entries.map((e) => e.id)).toEqual(['c', 'd']);
    expect(resolvePool(lib({ shufflePool: 'view' }), ctx({ view: [ALL[1], ALL[4]] })).entries.map((e) => e.id)).toEqual(['b', 'e']);
    const pools = [{ id: 'p1', name: 'Peak', ids: ['d', 'e', 'missing'] }];
    const r = resolvePool(lib({ shufflePool: 'pool:p1', pools }), ctx({}));
    expect(r.entries.map((e) => e.id)).toEqual(['d', 'e']);
    expect(r.label).toBe('Peak (2)');
  });

  it('falls back to every preset when a pool has fewer than two looks', () => {
    const r = resolvePool(lib({ shufflePool: 'favorites', favorites: ['c'] }), ctx({}));
    expect(r.fellBack).toBe(true);
    expect(r.entries).toHaveLength(ALL.length);
  });
});

describe('picking the next look', () => {
  it('never repeats the current look or the last N', () => {
    for (let i = 0; i < 50; i++) {
      const pick = pickNext(lib({ shufflePool: 'all', noRepeat: 2, energyMatch: false }), ctx({ currentId: 'a', recent: ['b', 'c'], rand: i / 50 }));
      expect(['d', 'e']).toContain(pick?.id);
    }
  });

  it('still picks when the no-repeat window would leave nothing', () => {
    const pick = pickNext(lib({ shufflePool: 'favorites', favorites: ['a', 'b'], noRepeat: 8 }), ctx({ currentId: 'a', recent: ['b'] }));
    expect(pick?.id).toBe('b');
  });

  it('plays the pool in order when asked', () => {
    expect(pickNext(lib({ shufflePool: 'all', order: 'sequence' }), ctx({ currentId: 'c' }))?.id).toBe('d');
    expect(pickNext(lib({ shufflePool: 'all', order: 'sequence' }), ctx({ currentId: 'e' }))?.id).toBe('a');
  });

  it('leans toward looks whose energy matches the music', () => {
    const count = (energy: number): Record<string, number> => {
      const n: Record<string, number> = {};
      for (let i = 0; i < 200; i++) {
        const id = pickNext(lib({ shufflePool: 'all', noRepeat: 0, energyMatch: true }), ctx({ currentId: 'c', energy, rand: (i + 0.5) / 200 }))!.id;
        n[id] = (n[id] ?? 0) + 1;
      }
      return n;
    };
    expect(energyTarget(0)).toBe(1);
    expect(energyTarget(1)).toBe(5);
    const calm = count(0);
    const peak = count(1);
    expect(calm.a).toBeGreaterThan(calm.e ?? 0);
    expect(peak.e).toBeGreaterThan(peak.a ?? 0);
  });
});

describe('auto-play timing', () => {
  it('lands changes on phrase-aligned multiples of the interval', () => {
    expect(autoInterval(lib({ autoMode: 'bars', shuffleBars: 8 }), 4, 16)).toBe(32);
    expect(autoInterval(lib({ autoMode: 'phrases', autoPhrases: 2 }), 4, 32)).toBe(64);
    // Beat 37.5, phrase started at beat 32: next 32-beat point is 64.
    expect(nextAutoBeat(37.5, 5.5 / 16, 16, 32)).toBe(64);
    expect(nextAutoBeat(62, 14 / 16, 16, 16)).toBe(64);
    // Too close to make it (under half a beat): the following point.
    expect(nextAutoBeat(63.9, 15.9 / 16, 16, 16)).toBe(80);
  });
});

describe('premade playlists', () => {
  it('splits looks with and without words, and by energy', async () => {
    const { PLAYLISTS } = await import('@/control/autopilot');
    const withText = { ...entry('t', 'Lyrics', 3), preset: { ...entry('t', 'Lyrics', 3).preset, layers: [{ enabled: true, source: { kind: 'lyricVideo' } }] } } as unknown as PresetEntry;
    const plain = { ...entry('p', 'Equalizers', 5), preset: { ...entry('p', 'Equalizers', 5).preset, layers: [{ enabled: true, source: { kind: 'spectrumBars' } }] } } as unknown as PresetEntry;
    const pl = (id: string) => PLAYLISTS.find((x) => x.id === id)!;
    expect(pl('lyrics').test(withText)).toBe(true);
    expect(pl('nowords').test(withText)).toBe(false);
    expect(pl('nowords').test(plain)).toBe(true);
    expect(pl('peak').test(plain)).toBe(true);
    const r = resolvePool(lib({ shufflePool: 'playlist:lyrics' }), ctx({ all: [withText, plain, ...ALL] }));
    expect(r.label).toContain('With lyrics');
  });
});

describe('fair shuffle', () => {
  it('plays every look once before any look plays twice, even with energy matching', () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(`p${i}`, 'Equalizers', 1 + (i % 5)));
    const plays: Record<string, number> = {};
    const recent: string[] = [];
    let current: string | null = null;
    let seed = 1;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 300; n++) {
      const pick: PresetEntry = pickNext(lib({ shufflePool: "all", noRepeat: 4, energyMatch: true }), { all: many, view: many, currentId: current, recent, energy: 0.9, rand: rand(), plays })!;
      plays[pick.id] = (plays[pick.id] ?? 0) + 1;
      recent.push(pick.id);
      current = pick.id;
      const counts = many.map((e) => plays[e.id] ?? 0);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    const counts = many.map((e) => plays[e.id]);
    expect(Math.min(...counts)).toBe(10);
    expect(Math.max(...counts)).toBe(10);
  });

  it('still leans toward matching energy within a round', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(`q${i}`, 'Equalizers', i < 5 ? 1 : 5));
    let firstHigh = 0;
    for (let t = 0; t < 200; t++) {
      const pick = pickNext(lib({ shufflePool: 'all', noRepeat: 0, energyMatch: true }), { all: many, view: many, currentId: null, recent: [], energy: 1, rand: (t + 0.5) / 200, plays: {} })!;
      if (pick.preset.energy === 5) firstHigh++;
    }
    expect(firstHigh).toBeGreaterThan(130);
  });
});
