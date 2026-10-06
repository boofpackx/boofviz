import { describe, expect, it } from 'vitest';
import { emptyFrame } from '@/audio/frameBuilder';
import { BUILTIN_PRESETS, BUILTIN_TEMPLATES } from '@/engine/library';
import { ModulationEngine, shapeWave } from '@/engine/modulation';
import { PaletteRuntime, paletteLinear } from '@/engine/palettes';
import { normalizePreset, parsePreset, sceneOf, serializePreset, toTemplate } from '@/engine/presetIO';
import { effectDef, generatorDef, isNumericSpec, specForLayerPath } from '@/engine/registry';
import { applyMacros, ScenePlan, splitScenePath } from '@/engine/scenePlan';
import type { Modulator, Preset } from '@shared/types/engine';

function frameAt(beat: number, time = beat * 0.5) {
  const f = emptyFrame();
  f.beat = beat;
  f.time = time;
  f.beatsPerBar = 4;
  f.beatsPerPhrase = 16;
  f.phrasePhase = (((beat % 16) + 16) % 16) / 16;
  f.barPhase = (((beat % 4) + 4) % 4) / 4;
  f.bpm = 120;
  return f;
}

describe('built-in presets', () => {
  const all = [...BUILTIN_PRESETS, ...BUILTIN_TEMPLATES];

  it('ships at least 8 presets in each Phase 2 category', () => {
    const count = (c: string) => BUILTIN_PRESETS.filter((e) => e.preset.category === c).length;
    expect(count('Equalizers')).toBeGreaterThanOrEqual(8);
    expect(count('2D Graphic')).toBeGreaterThanOrEqual(8);
    expect(BUILTIN_TEMPLATES.every((t) => t.preset.isTemplate)).toBe(true);
  });

  for (const { id, preset } of all) {
    it(`${id} is valid and wired to real parameters`, () => {
      expect(preset.layers.length).toBeGreaterThan(0);
      expect(preset.macros).toHaveLength(8);
      for (const layer of preset.layers) {
        expect(generatorDef(layer.source.kind), `generator ${layer.source.kind}`).toBeDefined();
        for (const fx of layer.fx) expect(effectDef(fx.type), `fx ${fx.type}`).toBeDefined();
        for (const m of layer.modulators) expect(isNumericSpec(specForLayerPath(layer, m.target)), `mod target ${m.target}`).toBe(true);
      }
      for (const macro of preset.macros) {
        for (const t of macro.targets) {
          const split = splitScenePath(t.path);
          expect(split, t.path).not.toBeNull();
          const layer = preset.layers[split![0]];
          expect(layer, t.path).toBeDefined();
          const rel = split![1];
          const ok = /^modulators\.\d+\.amount$/.test(rel) ? layer.modulators[Number(rel.split('.')[1])] !== undefined : isNumericSpec(specForLayerPath(layer, rel));
          expect(ok, `macro target ${t.path}`).toBe(true);
        }
      }
    });

    it(`${id} round-trips through JSON with no loss`, () => {
      const json = serializePreset(preset);
      expect(parsePreset(json)).toEqual(preset);
      expect(serializePreset(parsePreset(json))).toBe(json);
    });
  }
});

describe('preset IO', () => {
  it('normalizes messy input idempotently and keeps unknown modules', () => {
    const raw = {
      name: 'Messy',
      category: 'Nope',
      energy: 9,
      layers: [
        { source: { kind: 'spectrumBars', params: { bars: 9999, gap: 'x', mirror: 'sides' } }, fx: [{ type: 'bloom', params: { strength: -5 } }], modulators: [{ target: 'source.params.height', source: 'audio.bass', amount: 0.5, curve: 'exp' }, { junk: true }] },
        { source: { kind: 'futureThing', params: { foo: 1, bar: 'baz' } } },
        { id: 'layer1', source: { kind: 'scope' } },
      ],
      macros: [{ name: 'A', value: 2, targets: [{ path: 'layers.0.source.params.height', range: [0, 1] }] }],
    };
    const p = normalizePreset(raw);
    expect(p.category).toBe('Equalizers');
    expect(p.energy).toBe(5);
    expect(p.layers[0].source.params.bars).toBe(256);
    expect(p.layers[0].source.params.gap).toBe(0.28);
    expect(p.layers[0].source.params.mirror).toBe('sides');
    expect(p.layers[0].fx[0].params.strength).toBe(0);
    expect(p.layers[0].modulators).toHaveLength(1);
    expect(p.layers[1].source.params).toEqual({ foo: 1, bar: 'baz' });
    expect(new Set(p.layers.map((l) => l.id)).size).toBe(3);
    expect(p.macros).toHaveLength(8);
    expect(p.macros[0].value).toBe(1);
    expect(normalizePreset(JSON.parse(serializePreset(p)))).toEqual(p);
  });

  it('Save as Template keeps structure and routing but clears colours', () => {
    const src = BUILTIN_PRESETS.find((e) => e.preset.paletteCycle.mode !== 'off')!.preset;
    const t = toTemplate(src);
    expect(t.isTemplate).toBe(true);
    expect(t.palette).toBe('Mono');
    expect(t.paletteCycle.mode).toBe('off');
    expect(t.customPalettes).toBeUndefined();
    expect(t.layers).toEqual(src.layers);
    expect(t.macros).toEqual(src.macros);
  });
});

describe('macros and modulation', () => {
  const base: Preset = normalizePreset({
    name: 'Test',
    layers: [
      {
        id: 'a',
        source: { kind: 'spectrumBars', params: { height: 0.5, bars: 64 } },
        fx: [{ type: 'bloom', params: { strength: 1 } }],
        modulators: [
          { target: 'source.params.height', source: 'tempo.beat', amount: 0.1, shape: 'saw', rate: 1 },
          { target: 'source.params.height', source: 'tempo.beat', amount: 0.1, shape: 'saw', rate: 1 },
          { target: 'opacity', source: 'tempo.beat', amount: -2, shape: 'square', rate: 1 },
        ],
      },
    ],
    macros: [
      { name: 'H', value: 1, targets: [{ path: 'layers.0.source.params.height', range: [0.2, 0.6] }] },
      { name: 'Bars', value: 0.5, targets: [{ path: 'layers.0.source.params.bars', range: [10, 21] }] },
    ],
  });

  it('macros set their targets (rounded and clamped to the param range)', () => {
    const s = applyMacros(sceneOf(base));
    expect(s.layers[0].source.params.height).toBeCloseTo(0.6);
    expect(s.layers[0].source.params.bars).toBe(16);
    // The source scene is untouched.
    expect(base.layers[0].source.params.height).toBe(0.5);
  });

  it('sums several modulators on one param, scaled by its range, then clamps', () => {
    const plan = new ScenePlan(sceneOf(base));
    const eng = new ModulationEngine();
    plan.resolve(frameAt(10.25), eng, 1);
    // height range 0.1..0.95: 0.6 + 2 × 0.1 × 0.25 × 0.85
    expect(plan.layers[0].source.height as number).toBeCloseTo(0.6 + 2 * 0.1 * 0.25 * 0.85, 5);
    // square is 1 in the first half of the beat: opacity 1 - 2 → clamped to 0.
    expect(plan.layers[0].opacity).toBe(0);
    plan.resolve(frameAt(10.75), eng, 1);
    expect(plan.layers[0].opacity).toBe(1);
    expect(plan.live.get('a|source.params.height')).toBeGreaterThan(0);
  });

  it('tempo modulators are phrase-aligned and shaped', () => {
    expect(shapeWave(0, 'sine')).toBeCloseTo(0);
    expect(shapeWave(0.5, 'sine')).toBeCloseTo(1);
    expect(shapeWave(0.25, 'ramp')).toBeCloseTo(0.75);
    expect(shapeWave(0.6, 'square')).toBe(0);
    const eng = new ModulationEngine();
    const m: Modulator = { target: 'x', source: 'tempo.bar', amount: 1, shape: 'saw' };
    expect(eng.sample(m, 'k', frameAt(16))).toBeCloseTo(0);
    expect(eng.sample(m, 'k', frameAt(18))).toBeCloseTo(0.5);
  });

  it('random sample-and-hold is identical in independent engines (preview = output)', () => {
    const m: Modulator = { target: 'x', source: 'random', amount: 1, randomMode: 'hold', rate: 1 };
    const a = new ModulationEngine();
    const b = new ModulationEngine();
    const va = [0, 1.2, 2.5, 3.9].map((beat) => a.sample(m, 'layer:0:random', frameAt(beat)));
    const vb = [0, 1.2, 2.5, 3.9].map((beat) => b.sample(m, 'layer:0:random', frameAt(beat)));
    expect(va).toEqual(vb);
    expect(a.sample(m, 'layer:0:random', frameAt(1.1))).toBe(a.sample(m, 'layer:0:random', frameAt(1.9)));
    expect(new Set(va).size).toBe(4);
  });

  it('envelopes attack, hold and decay from the trigger', () => {
    const eng = new ModulationEngine();
    const m: Modulator = { target: 'x', source: 'envelope', amount: 1, trigger: 'onset.kick', attackMs: 10, holdMs: 100, decayMs: 100 };
    const f = frameAt(0, 100);
    f.onsets.kick = true;
    expect(eng.sample(m, 'e', f)).toBe(0);
    f.onsets.kick = false;
    f.time = 100.005;
    expect(eng.sample(m, 'e', f)).toBeCloseTo(0.5);
    f.time = 100.05;
    expect(eng.sample(m, 'e', f)).toBe(1);
    f.time = 100.16;
    expect(eng.sample(m, 'e', f)).toBeCloseTo(0.5);
    f.time = 100.3;
    expect(eng.sample(m, 'e', f)).toBe(0);
  });

  it('invert, offset, clamp and reactivity apply in order', () => {
    const eng = new ModulationEngine();
    const f = frameAt(0);
    f.bands.bass = 0.8;
    expect(eng.contribution({ target: 'x', source: 'audio.bass', amount: 0.5 }, 'k', f, 1)).toBeCloseTo(0.4);
    expect(eng.contribution({ target: 'x', source: 'audio.bass', amount: 0.5, invert: true }, 'k', f, 1)).toBeCloseTo(0.1);
    expect(eng.contribution({ target: 'x', source: 'audio.bass', amount: 0.5, offset: -0.2, clamp: [0, 0.1] }, 'k', f, 1)).toBeCloseTo(0.1);
    expect(eng.contribution({ target: 'x', source: 'audio.bass', amount: 0.5 }, 'k', f, 2)).toBeCloseTo(0.8);
  });
});

describe('palette runtime', () => {
  it('cycles palettes on the bar with a crossfade', () => {
    const p = normalizePreset({ name: 'P', palette: 'Neon', paletteCycle: { mode: 'bar', every: 1, fadeBeats: 2, list: ['Neon', 'Ocean'] }, layers: [] });
    const rt = new PaletteRuntime();
    rt.setScene(sceneOf(p));
    const neon = paletteLinear('Neon');
    const ocean = paletteLinear('Ocean');
    // Bar 1 (beats 4..8) is Ocean; at beat 7 the fade is complete.
    let c = rt.update(frameAt(7), 0.016);
    expect(Array.from(c)).toEqual(Array.from(ocean));
    // Bar 2 starts at beat 8 fading from Ocean back to Neon; halfway at beat 9.
    c = rt.update(frameAt(9), 0.016);
    expect(c[3]).toBeCloseTo((neon[3] + ocean[3]) / 2, 5);
    c = rt.update(frameAt(11), 0.016);
    expect(Array.from(c)).toEqual(Array.from(neon));
  });
});
