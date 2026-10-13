import { describe, expect, it } from 'vitest';
import type { Scene } from '@shared/types/engine';
import { BUILTIN_PRESETS } from '@/engine/library';
import { normalizePreset } from '@/engine/presetIO';
import { applyMacros } from '@/engine/scenePlan';
import { BACKGROUNDS, MAINS, applyRole, makeLayer, reactionOf, rebuildFeel, setReaction, toggleEffect } from '@/control/createKit';

function fresh() {
  const d = normalizePreset({ name: 'Mine', layers: [makeLayer('bg', 'background')] });
  rebuildFeel(d);
  return d;
}

const params = (scene: Scene) => scene.layers.map((l) => l.source.params);

describe('Create kit', () => {
  it('gives a fresh look the Energy, Speed and Punch knobs', () => {
    const d = fresh();
    expect(d.macros.map((m) => m.name).filter(Boolean)).toEqual(['Energy', 'Speed', 'Punch']);
  });

  it('puts each role in its place and keeps the effects on top', () => {
    const d = fresh();
    toggleEffect(d, 'bloom');
    applyRole(d, 'main', 'spectrumBars');
    applyRole(d, 'bg', 'synthSunset');
    expect(d.layers.map((l) => l.id)).toEqual(['bg', 'main', 'fx']);
    expect(d.layers.map((l) => l.source.kind)).toEqual(['synthSunset', 'spectrumBars', 'adjust']);
    toggleEffect(d, 'bloom');
    expect(d.layers.map((l) => l.id)).toEqual(['bg', 'main']);
  });

  it('never changes the look until a Feel knob is turned, wherever the knob sits', () => {
    const d = fresh();
    applyRole(d, 'bg', 'synthSunset');
    applyRole(d, 'main', 'spectrumBars');
    expect(d.macros.some((m) => m.name && m.targets.length)).toBe(true);
    expect(params(applyMacros(d))).toEqual(params(d));
    // Turn a knob, change the look: the knob stays where it is and still gives the look as it is now.
    const energy = d.macros.find((m) => m.name === 'Energy')!;
    energy.value = 0.8;
    applyRole(d, 'main', 'barCity');
    const out = params(applyMacros(d));
    for (const t of energy.targets) {
      const [, li, , , key] = t.path.split('.');
      expect(out[Number(li)][key]).toBeCloseTo(Number(d.layers[Number(li)].source.params[key]), 5);
    }
  });

  it('every card answers at least one Feel knob', () => {
    for (const k of new Set([...BACKGROUNDS, ...MAINS])) {
      const d = fresh();
      applyRole(d, 'bg', k);
      expect(
        d.macros.reduce((n, m) => n + (m.name ? m.targets.length : 0), 0),
        k,
      ).toBeGreaterThan(0);
    }
  });

  it('turning Speed up speeds things up', () => {
    const d = fresh();
    applyRole(d, 'bg', 'warp');
    const speed = d.macros.find((m) => m.name === 'Speed')!;
    expect(speed.targets.length).toBeGreaterThan(0);
    speed.value = 1;
    const t = speed.targets[0];
    const key = t.path.split('.').pop()!;
    expect(Number(applyMacros(d).layers[0].source.params[key])).toBeGreaterThan(Number(d.layers[0].source.params[key]));
  });

  it('swaps music reactions and keeps the layer’s own modulators', () => {
    const d = fresh();
    applyRole(d, 'main', 'spectrumBars');
    const l = d.layers[1];
    l.modulators.push({ target: 'opacity', source: 'lfo.sine', amount: 0.2 } as never);
    setReaction(l, 'kick');
    expect(reactionOf(l)).toBe('kick');
    setReaction(l, 'vocals');
    expect(reactionOf(l)).toBe('vocals');
    expect(l.modulators.some((m) => m.source === 'audio.onset.kick')).toBe(false);
    setReaction(l, 'steady');
    expect(reactionOf(l)).toBe('steady');
    expect(l.modulators.map((m) => m.source)).toEqual(['lfo.sine']);
    // A new element in the same role keeps the reaction.
    setReaction(l, 'bass');
    applyRole(d, 'main', 'radialSpectrum');
    expect(reactionOf(d.layers[1])).toBe('bass');
  });

  it('leaves a library look’s own knobs alone', () => {
    const d = normalizePreset(structuredClone(BUILTIN_PRESETS[0]));
    const before = structuredClone(d.macros);
    rebuildFeel(d);
    expect(d.macros).toEqual(before);
  });
});
