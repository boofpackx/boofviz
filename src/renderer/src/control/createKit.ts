import type { Layer, Modulator, ParamBag, ParamSpec, Preset } from '@shared/types/engine';
import { defaultParams, effectDef, generatorDef, isNumericSpec } from '@/engine/registry';

/**
 * The Create tab's building blocks, kept apart from the UI so tests and the
 * thumbnail script can drive them: which layer plays which role, putting a
 * generator or effect in place, the three Feel knobs (macros) and the plain
 * music reactions (modulators).
 */

export type Role = 'bg' | 'main' | 'words' | 'fx';

export const BACKGROUNDS = [
  'background',
  'warp',
  'synthSunset',
  'glassMeadow',
  'opArt',
  'dots',
  'memphis',
  'tiles',
  'codeRain',
  'liquidChrome',
  'orb',
  'prism',
  'lines',
  'deStijl',
  'swissGrid',
  'spectrogram',
  'concrete',
  'lostScene',
  'archiveFootage',
  'clipEngine',
];
export const MAINS = [
  'spectrumBars',
  'radialSpectrum',
  'barCity',
  'scope',
  'polygon',
  'twistCube',
  'ricochet',
  'pipes',
  'screensaver90',
  'pixelArcade',
  'demoParts',
  'platinumStage',
  'lowPoly',
  'orb',
  'prism',
  'lines',
];
export const EFFECT_PICKS = [
  'bloom',
  'feedback',
  'kaleidoscope',
  'mirror',
  'rgbSplit',
  'vhs',
  'crt',
  'filmStock',
  'halftone',
  'grain',
  'vignette',
  'ledScreen',
  'popGrid',
  'retroPalette',
  'digitalRot',
  'tvSet',
  'tapeStack',
  'print2',
  'gradientMap',
  'grade',
];
const WORD_KINDS = new Set(['lyrics', 'lyricVideo', 'kineticType', 'stepChart', 'hotMetal', 'keyframes']);
/** Looks that draw a whole scene unless told to draw only their words over another. */
const OVERLAY_KINDS = new Set(['stepChart', 'hotMetal', 'keyframes']);

/** Where a role lives in a look: by id in looks made in Create, by kind or place in others. */
export function roleIndex(d: Preset, role: Role): number {
  const byId = d.layers.findIndex((l) => l.id === role);
  if (byId >= 0) return byId;
  if (role === 'fx') return d.layers.findIndex((l) => l.source.kind === 'adjust');
  if (role === 'words') return d.layers.findIndex((l) => WORD_KINDS.has(l.source.kind));
  const plain = d.layers.map((l, i) => ({ l, i })).filter(({ l }) => !WORD_KINDS.has(l.source.kind) && l.source.kind !== 'adjust');
  return (role === 'bg' ? plain[0]?.i : plain[1]?.i) ?? -1;
}

export function makeLayer(id: Role, kind: string, params: ParamBag = {}): Layer {
  return {
    id,
    name: generatorDef(kind)?.label ?? kind,
    enabled: true,
    source: { type: 'generator', kind, params: { ...defaultParams(generatorDef(kind)), ...params, ...(OVERLAY_KINDS.has(kind) ? { overlay: true } : {}) } },
    fx: [],
    blend: id === 'main' ? 'screen' : 'normal',
    opacity: 1,
    modulators: [],
  };
}

/** Put `kind` in a role (null: take the role out). Mutates the draft. */
export function applyRole(d: Preset, role: Role, kind: string | null, params?: ParamBag): void {
  const i = roleIndex(d, role);
  if (kind === null) {
    if (i >= 0) d.layers.splice(i, 1);
  } else if (i >= 0) {
    const old = d.layers[i];
    const reaction = reactionOf(old);
    d.layers[i] = { ...makeLayer(role, kind, params), id: old.id, opacity: old.opacity, blend: role === 'bg' && i === 0 ? 'normal' : old.blend, fx: old.fx };
    setReaction(d.layers[i], reaction);
  } else {
    const layer = makeLayer(role, kind, params);
    // Background at the bottom, then the main element, the words, the effects on top.
    const order: Role[] = ['bg', 'main', 'words', 'fx'];
    let at = 0;
    for (const r of order.slice(0, order.indexOf(role))) {
      const k = roleIndex(d, r);
      if (k >= 0) at = Math.max(at, k + 1);
    }
    if (role === 'bg') at = 0;
    if (!d.layers.length) layer.blend = 'normal';
    d.layers.splice(at, 0, layer);
  }
  rebuildFeel(d);
}

export function toggleEffect(d: Preset, type: string): void {
  let i = roleIndex(d, 'fx');
  if (i < 0) {
    d.layers.push({ ...makeLayer('fx', 'adjust'), name: 'Effects' });
    i = d.layers.length - 1;
  }
  const fx = d.layers[i].fx;
  const k = fx.findIndex((f) => f.type === type);
  if (k >= 0) fx.splice(k, 1);
  else fx.push({ type, enabled: true, params: defaultParams(effectDef(type)) });
  if (!fx.length) d.layers.splice(i, 1);
  rebuildFeel(d);
}

// ---------------------------------------------------------------- Feel knobs

export const FEEL = ['Energy', 'Speed', 'Punch'] as const;
export type FeelName = (typeof FEEL)[number];

const FEEL_MATCH: Record<FeelName, RegExp> = {
  Speed: /^(speed|rate|spin|scroll|scrollSpeed|copperSpeed|flow|drift|rise|sway|rotate|rotation|motion|travel)$/i,
  Punch: /(punch|react|kick|bounce|pulse|pump|shake|jump|burst|explode|beatMorph)/i,
  Energy: /(glow|glints|beams|intensity|amount|density|count|cells|bright|energy|stars|bubbles|particles|lines|bars|detail)/i,
};

function feelOf(spec: ParamSpec): FeelName | null {
  for (const name of ['Speed', 'Punch', 'Energy'] as const) if (FEEL_MATCH[name].test(spec.key) || FEEL_MATCH[name].test(spec.label)) return name;
  return null;
}

/**
 * Point the Energy, Speed and Punch knobs at the look's current settings. Each
 * knob's middle is the setting as it is now, so the knobs never change the
 * look until they are turned. Called after every structural change.
 */
export function rebuildFeel(d: Preset): void {
  // Only looks built in Create: a library look's own knobs are never retargeted.
  if (!d.layers.some((l) => l.id === 'bg' || l.id === 'main' || l.id === 'words' || l.id === 'fx')) return;
  const targets: Record<FeelName, Preset['macros'][number]['targets']> = { Energy: [], Speed: [], Punch: [] };
  d.layers.forEach((l, li) => {
    if (l.source.kind === 'adjust') return;
    for (const spec of generatorDef(l.source.kind)?.params ?? []) {
      if (!isNumericSpec(spec) || spec.key === 'lead') continue;
      const feel = feelOf(spec);
      if (!feel) continue;
      const cur = typeof l.source.params[spec.key] === 'number' ? (l.source.params[spec.key] as number) : Number(spec.default);
      const lo = spec.min ?? 0;
      const hi = spec.max ?? Math.max(1, cur * 2);
      // How far a full turn reaches: twice as far for punch, a little gentler for the rest.
      const k = feel === 'Punch' ? 1 : feel === 'Speed' ? 0.75 : 0.6;
      const span = Math.max(Math.abs(cur) * k, (hi - lo) * 0.15);
      targets[feel].push({ path: `layers.${li}.source.params.${spec.key}`, range: [cur - span, cur + span] });
    }
  });
  for (const name of FEEL) {
    let m = d.macros.find((x) => x.name === name);
    if (!m) {
      m = d.macros.find((x) => !x.name && !x.targets.length);
      if (!m) continue;
      m.name = name;
      m.value = 0.5;
    }
    // Keep the knob where it is: wherever it sits, it gives the setting the look holds now
    // (values past a setting's limits are clamped when the look is drawn).
    const v = m.value;
    m.targets = targets[name].map((t) => {
      const w = t.range[1] - t.range[0];
      const cur = (t.range[0] + t.range[1]) / 2;
      return { ...t, range: [cur - w * v, cur + w * (1 - v)] as [number, number] };
    });
  }
}

// ---------------------------------------------------------------- music reactions

export const REACTIONS = [
  { id: 'steady', label: 'Steady' },
  { id: 'kick', label: 'Pulses on the kick' },
  { id: 'snare', label: 'Flashes on the snare' },
  { id: 'bass', label: 'Grows with the bass' },
  { id: 'vocals', label: 'Shows when someone sings' },
  { id: 'instrumental', label: 'Shows in the instrumental parts' },
  { id: 'energy', label: 'Swells with the energy' },
] as const;
export type ReactionId = (typeof REACTIONS)[number]['id'];

const SIZE_KEYS = /^(size|scale|zoom|radius|height|amount)$/i;

function sizeParam(l: Layer): string | null {
  const spec = (generatorDef(l.source.kind)?.params ?? []).find((p) => isNumericSpec(p) && SIZE_KEYS.test(p.key));
  return spec ? `source.params.${spec.key}` : null;
}

function recipe(l: Layer, id: ReactionId): Modulator[] {
  const size = sizeParam(l);
  switch (id) {
    case 'kick':
      return [{ target: 'opacity', source: 'audio.onset.kick', amount: 0.55, offset: -0.55, decayMs: 260 }];
    case 'snare':
      return [{ target: 'opacity', source: 'audio.onset.snare', amount: 0.6, offset: -0.6, decayMs: 200 }];
    case 'bass':
      return size ? [{ target: size, source: 'audio.bass', amount: 0.35 }] : [{ target: 'opacity', source: 'audio.bass', amount: 0.6, offset: -0.6 }];
    case 'vocals':
      return [{ target: 'opacity', source: 'audio.vocals', amount: 0.8, offset: -0.8 }];
    case 'instrumental':
      return [{ target: 'opacity', source: 'audio.instrumental', amount: 0.85, offset: -0.85 }];
    case 'energy':
      return size ? [{ target: size, source: 'audio.energy', amount: 0.4 }] : [{ target: 'opacity', source: 'audio.energy', amount: 0.5, offset: -0.5 }];
    default:
      return [];
  }
}

const REACTION_SOURCES = new Set(['audio.onset.kick', 'audio.onset.snare', 'audio.bass', 'audio.vocals', 'audio.instrumental', 'audio.energy']);

/** Which plain reaction a layer has (its modulators made by Create). */
export function reactionOf(l: Layer): ReactionId {
  for (const r of REACTIONS) {
    const rec = recipe(l, r.id);
    if (rec.length && rec.every((m) => l.modulators.some((x) => x.target === m.target && x.source === m.source))) return r.id;
  }
  return 'steady';
}

/** Swap the layer's Create-made reaction for another (the look's own modulators stay). */
export function setReaction(l: Layer, id: ReactionId): void {
  const mine = new Set(REACTIONS.flatMap((r) => recipe(l, r.id)).map((m) => `${m.target}|${m.source}`));
  l.modulators = l.modulators.filter((m) => !(REACTION_SOURCES.has(m.source) && mine.has(`${m.target}|${m.source}`)));
  l.modulators.push(...recipe(l, id));
}
