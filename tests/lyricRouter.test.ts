import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS } from '@/engine/library';
import { sceneOf } from '@/engine/presetIO';
import { BUILTIN_TREATMENTS, routeLyrics, showsLyrics, THEME_DEFAULTS } from '@shared/lyricRouter';
import { DEFAULT_SETTINGS, mergeSettings, migrateSettings } from '@shared/settings';
import { PRESET_CATEGORIES, type Layer, type Scene } from '@shared/types/engine';

/** How many things put the sung line on screen: lyric layers plus an overlay. */
const lyricSources = (s: Scene): number => s.layers.filter(showsLyrics).length + (s.lyricOverlay ? 1 : 0);

const layer = (kind: string, params: Record<string, string | number | boolean> = {}, enabled = true): Layer =>
  ({
    id: `${kind}-${Math.random()}`,
    enabled,
    opacity: 1,
    blend: 'normal',
    source: { kind, params },
    fx: [],
  }) as unknown as Layer;
const scene = (layers: Layer[], category = 'Pop Culture'): Scene =>
  ({
    layers,
    palette: 'x',
    paletteCycle: { mode: 'off' },
    hueRotate: { mode: 'off' },
    macros: [],
    category,
  }) as unknown as Scene;

describe('lyric router', () => {
  it('every built-in look: one source of lyrics in Everywhere, none in Off, unchanged in Looks’ own', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThan(100);
    for (const e of BUILTIN_PRESETS) {
      const s = sceneOf(e.preset);
      // Never a second copy: a look made with lyrics keeps exactly what it has.
      const every = routeLyrics(s, { mode: 'everywhere' });
      expect(lyricSources(every.scene), `${e.id} everywhere`).toBe(Math.max(1, lyricSources(s)));
      const off = routeLyrics(s, { mode: 'off' });
      expect(lyricSources(off.scene), `${e.id} off`).toBe(0);
      const own = routeLyrics(s, { mode: 'own' });
      expect(own.scene.layers, `${e.id} own`).toEqual(s.layers);
      expect(own.scene.lyricOverlay ?? null).toBeNull();
    }
  });

  it('keeps a look that already shows lyrics exactly as it is', () => {
    const s = scene([layer('plasma'), layer('lyrics')]);
    const r = routeLyrics(s, { mode: 'everywhere' });
    expect(r.result).toBe('own');
    expect(r.scene.layers).toEqual(s.layers);
    expect(r.scene.lyricOverlay).toBeNull();
  });

  it('switches a look’s own lyrics on before adding anything', () => {
    const off = routeLyrics(scene([layer('plasma'), layer('lyricVideo', {}, false)]), { mode: 'everywhere' });
    expect(off.result).toBe('switched-on');
    expect(off.scene.layers[1].enabled).toBe(true);
    const text = routeLyrics(scene([layer('kineticType', { source: 'text', text: 'HELLO' })]), { mode: 'everywhere' });
    expect(text.result).toBe('switched-on');
    expect(text.scene.layers[0].source.params.source).toBe('lyrics');
    const neo = routeLyrics(scene([layer('neo90', { words: 'off' })]), {
      mode: 'everywhere',
    });
    expect(neo.scene.layers[0].source.params.words).toBe('line');
    // A layout without words can't sing: it gets its theme's style instead.
    const pet = routeLyrics(scene([layer('desktop90', { mode: 'pet' })], 'Real 90s'), { mode: 'everywhere' });
    expect(pet.result).toBe('themed');
    expect(pet.treatment).toBe('teletext');
  });

  it('gives a look without lyrics its theme’s treatment, or your picks', () => {
    const s = scene([layer('plasma')], 'Brutalist');
    expect(routeLyrics(s, { mode: 'everywhere' }).scene.lyricOverlay?.material).toBe('stencil');
    expect(routeLyrics(s, { mode: 'everywhere', themes: { Brutalist: 'mimeo' } }).treatment).toBe('mimeo');
    expect(
      routeLyrics(s, {
        mode: 'everywhere',
        themes: { Brutalist: 'mimeo' },
        allLooks: 'holo',
      }).treatment,
    ).toBe('holo');
    expect(
      routeLyrics(s, {
        mode: 'everywhere',
        tune: { size: 1.5, position: 'upper' },
      }).scene.lyricOverlay,
    ).toMatchObject({ size: 1.5, position: 'upper' });
  });

  it('per-look choice wins: own only, never, or a treatment (which replaces the look’s own lyrics)', () => {
    const s = scene([layer('plasma'), layer('lyrics')]);
    expect(routeLyrics(s, { mode: 'everywhere', choice: 'own' }).scene.layers).toEqual(s.layers);
    expect(lyricSources(routeLyrics(s, { mode: 'everywhere', choice: 'never' }).scene)).toBe(0);
    const picked = routeLyrics(s, { mode: 'everywhere', choice: 'laser' });
    expect(picked.result).toBe('chosen');
    expect(lyricSources(picked.scene)).toBe(1);
    expect(picked.scene.lyricOverlay?.style).toBe('laser');
    // The choice only applies in Everywhere.
    expect(routeLyrics(s, { mode: 'own', choice: 'never' }).scene.layers).toEqual(s.layers);
  });

  it('a treatment being tried replaces everything, even in Off', () => {
    const r = routeLyrics(scene([layer('lyrics')]), {
      mode: 'off',
      force: { kind: 'lyricVideo', style: 'pop' },
    });
    expect(lyricSources(r.scene)).toBe(1);
    expect(r.scene.lyricOverlay?.style).toBe('pop');
  });

  it('every theme has a default treatment that exists', () => {
    for (const c of PRESET_CATEGORIES)
      expect(
        BUILTIN_TREATMENTS.some((t) => t.id === THEME_DEFAULTS[c]),
        c,
      ).toBe(true);
    expect(new Set(BUILTIN_TREATMENTS.map((t) => t.id)).size).toBe(BUILTIN_TREATMENTS.length);
  });

  it('old settings move to the new mode: the overlay switch becomes Everywhere, a picked style a treatment', () => {
    const a = mergeSettings(
      DEFAULT_SETTINGS,
      migrateSettings({
        lyrics: {
          textLooks: true,
          overlay: {
            enabled: true,
            params: { kind: 'lyricVideo', style: 'auto' },
          },
        },
      }),
    );
    expect(a.lyrics.mode).toBe('everywhere');
    expect(a.lyrics.allLooks).toBe('');
    expect('overlay' in a.lyrics).toBe(false);
    const b = mergeSettings(
      DEFAULT_SETTINGS,
      migrateSettings({
        lyrics: {
          overlay: {
            enabled: false,
            params: { kind: 'lyricVideo', style: 'laser' },
          },
        },
      }),
    );
    expect(b.lyrics.mode).toBe('own');
    expect(b.lyrics.custom[0].params.style).toBe('laser');
    expect(b.lyrics.allLooks).toBe(b.lyrics.custom[0].id);
    expect(mergeSettings(DEFAULT_SETTINGS, migrateSettings({})).lyrics.mode).toBe('own');
  });
});
