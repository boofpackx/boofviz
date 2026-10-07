import {
  BLEND_MODES,
  MACRO_COUNT,
  MAX_LAYERS,
  PRESET_CATEGORIES,
  type BlendMode,
  type FxInstance,
  type HueRotate,
  type Layer,
  type LayerMask,
  type Macro,
  type Modulator,
  type PaletteCycle,
  type ParamBag,
  type Preset,
  type PresetCategory,
  type Scene,
} from '@shared/types/engine';
import { effectDef, generatorDef } from './registry';
import { PALETTES } from './palettes';

/**
 * Preset (de)serialization. `normalizePreset` turns any parsed JSON into a
 * complete, valid Preset (filling defaults, clamping, dropping garbage) and is
 * idempotent, so normalize → serialize → parse → normalize round-trips exactly.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, min = -Infinity, max = Infinity): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(max, Math.max(min, n));
};
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

export const PALETTE_CYCLE_OFF: PaletteCycle = { mode: 'off', every: 1, fadeBeats: 1, list: [] };
export const HUE_ROTATE_OFF: HueRotate = { mode: 'off', rate: 0, amount: 0 };

function normalizeParams(raw: unknown, kind: string, isFx: boolean): ParamBag {
  const def = isFx ? effectDef(kind) : generatorDef(kind);
  const src = isObj(raw) ? raw : {};
  const out: ParamBag = {};
  if (!def) {
    // Unknown module (e.g. from a newer version): keep its params verbatim.
    for (const [k, v] of Object.entries(src)) if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v;
    return out;
  }
  for (const p of def.params) {
    const v = src[p.key];
    switch (p.type) {
      case 'float':
        out[p.key] = num(v, p.default as number, p.min, p.max);
        break;
      case 'int':
        out[p.key] = Math.round(num(v, p.default as number, p.min, p.max));
        break;
      case 'bool':
        out[p.key] = typeof v === 'boolean' ? v : (p.default as boolean);
        break;
      case 'enum':
        out[p.key] = oneOf(v, p.options ?? [], p.default as string);
        break;
      case 'text':
        out[p.key] = str(v, p.default as string).slice(0, 200);
        break;
    }
  }
  return out;
}

function normalizeModulator(raw: unknown): Modulator | null {
  if (!isObj(raw) || typeof raw.target !== 'string' || typeof raw.source !== 'string') return null;
  const m: Modulator = { target: raw.target, source: raw.source as Modulator['source'], amount: num(raw.amount, 0.5, -4, 4) };
  if (raw.offset !== undefined) m.offset = num(raw.offset, 0, -4, 4);
  if (raw.curve !== undefined) m.curve = oneOf(raw.curve, ['linear', 'exp', 'log', 'smooth'] as const, 'linear');
  if (Array.isArray(raw.clamp) && raw.clamp.length === 2) m.clamp = [num(raw.clamp[0], -1), num(raw.clamp[1], 1)];
  if (raw.invert !== undefined) m.invert = raw.invert === true;
  if (raw.shape !== undefined) m.shape = oneOf(raw.shape, ['sine', 'saw', 'square', 'ramp', 'bounce', 'stepped'] as const, 'sine');
  if (raw.rate !== undefined) m.rate = num(raw.rate, 1, 0.0625, 64);
  if (raw.hz !== undefined) m.hz = num(raw.hz, 0.25, 0.001, 30);
  if (raw.trigger !== undefined) m.trigger = oneOf(raw.trigger, ['onset.kick', 'onset.snare', 'onset.hat', 'onset.any', 'drop', 'downbeat', 'phrase'] as const, 'onset.kick');
  if (raw.attackMs !== undefined) m.attackMs = num(raw.attackMs, 5, 0, 10000);
  if (raw.holdMs !== undefined) m.holdMs = num(raw.holdMs, 0, 0, 10000);
  if (raw.decayMs !== undefined) m.decayMs = num(raw.decayMs, 250, 1, 20000);
  if (raw.randomMode !== undefined) m.randomMode = oneOf(raw.randomMode, ['hold', 'smooth'] as const, 'hold');
  return m;
}

function normalizeMask(raw: unknown): LayerMask | undefined {
  if (!isObj(raw)) return undefined;
  const type = oneOf(raw.type, ['luma', 'shape'] as const, 'shape');
  const mask: LayerMask = { type, size: num(raw.size, 0.5, 0, 2), feather: num(raw.feather, 0.1, 0, 1), invert: raw.invert === true };
  if (type === 'luma') mask.layer = Math.round(num(raw.layer, 0, 0, MAX_LAYERS - 1));
  else mask.shape = oneOf(raw.shape, ['circle', 'rect', 'ring', 'linear', 'triangle'] as const, 'circle');
  return mask;
}

function normalizeLayer(raw: unknown, index: number): Layer | null {
  if (!isObj(raw) || !isObj(raw.source)) return null;
  const kind = str(raw.source.kind, 'background');
  const fx: FxInstance[] = (Array.isArray(raw.fx) ? raw.fx : [])
    .filter(isObj)
    .map((x) => ({ type: str(x.type, 'bloom'), enabled: x.enabled !== false, params: normalizeParams(x.params, str(x.type, 'bloom'), true) }));
  const layer: Layer = {
    id: str(raw.id, `layer${index + 1}`),
    name: str(raw.name, generatorDef(kind)?.label ?? kind),
    enabled: raw.enabled !== false,
    source: { type: oneOf(raw.source.type, ['generator', 'clip', 'text', 'logo', 'camera'] as const, 'generator'), kind, params: normalizeParams(raw.source.params, kind, false) },
    fx,
    blend: oneOf(raw.blend, BLEND_MODES, 'normal' as BlendMode),
    opacity: num(raw.opacity, 1, 0, 1),
    modulators: (Array.isArray(raw.modulators) ? raw.modulators : []).map(normalizeModulator).filter((m): m is Modulator => m !== null),
  };
  const mask = normalizeMask(raw.mask);
  if (mask) layer.mask = mask;
  return layer;
}

function normalizeMacros(raw: unknown): Macro[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Macro[] = [];
  for (let i = 0; i < MACRO_COUNT; i++) {
    const m = isObj(list[i]) ? (list[i] as Obj) : {};
    out.push({
      name: str(m.name, ''),
      value: num(m.value, 0.5, 0, 1),
      targets: (Array.isArray(m.targets) ? m.targets : [])
        .filter(isObj)
        .filter((tg) => typeof tg.path === 'string')
        .map((tg) => {
          const target: Macro['targets'][number] = { path: tg.path as string, range: Array.isArray(tg.range) && tg.range.length === 2 ? [num(tg.range[0], 0), num(tg.range[1], 1)] : [0, 1] };
          if (tg.curve !== undefined) target.curve = oneOf(tg.curve, ['linear', 'exp', 'log', 'smooth'] as const, 'linear');
          return target;
        }),
    });
  }
  return out;
}

function normalizeCycle(raw: unknown): PaletteCycle {
  if (!isObj(raw)) return { ...PALETTE_CYCLE_OFF };
  return {
    mode: oneOf(raw.mode, ['off', 'beat', 'bar', 'phrase', 'drop', 'energy'] as const, 'off'),
    every: Math.round(num(raw.every, 1, 1, 64)),
    fadeBeats: num(raw.fadeBeats, 1, 0, 64),
    list: (Array.isArray(raw.list) ? raw.list : []).filter((x): x is string => typeof x === 'string'),
  };
}

function normalizeHue(raw: unknown): HueRotate {
  if (!isObj(raw)) return { ...HUE_ROTATE_OFF };
  return { mode: oneOf(raw.mode, ['off', 'lfo', 'beat', 'bar'] as const, 'off'), rate: num(raw.rate, 0, -360, 360), amount: num(raw.amount, 0, 0, 360) };
}

export function normalizePreset(raw: unknown): Preset {
  const r = isObj(raw) ? raw : {};
  const layers = (Array.isArray(r.layers) ? r.layers : [])
    .slice(0, MAX_LAYERS)
    .map((l, i) => normalizeLayer(l, i))
    .filter((l): l is Layer => l !== null);
  // Layer ids must be unique: they key modulator state and live meters.
  const seen = new Set<string>();
  layers.forEach((l, i) => {
    if (seen.has(l.id)) l.id = `${l.id}_${i}`;
    seen.add(l.id);
  });
  const customPalettes: Record<string, string[]> = {};
  if (isObj(r.customPalettes)) {
    for (const [k, v] of Object.entries(r.customPalettes)) {
      if (Array.isArray(v) && v.length === 5 && v.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) customPalettes[k] = v as string[];
    }
  }
  const palette = str(r.palette, 'Neon');
  const preset: Preset = {
    schema: 1,
    name: str(r.name, 'Untitled').slice(0, 80),
    category: oneOf(r.category, PRESET_CATEGORIES, 'Equalizers' as PresetCategory),
    tags: (Array.isArray(r.tags) ? r.tags : []).filter((x): x is string => typeof x === 'string').slice(0, 16),
    energy: Math.round(num(r.energy, 3, 1, 5)) as Preset['energy'],
    palette: PALETTES[palette] || customPalettes[palette] ? palette : 'Neon',
    paletteCycle: normalizeCycle(r.paletteCycle),
    hueRotate: normalizeHue(r.hueRotate),
    layers,
    macros: normalizeMacros(r.macros),
  };
  if (Object.keys(customPalettes).length) preset.customPalettes = customPalettes;
  if (Array.isArray(r.bpmHint) && r.bpmHint.length === 2) preset.bpmHint = [num(r.bpmHint[0], 120, 40, 250), num(r.bpmHint[1], 130, 40, 250)];
  if (typeof r.description === 'string') preset.description = r.description.slice(0, 400);
  if (r.isTemplate === true) preset.isTemplate = true;
  if (isObj(r.transitionIn)) {
    preset.transitionIn = {
      type: oneOf(r.transitionIn.type, ['crossfade', 'cut', 'lumaWipe', 'blurDissolve', 'glitchCut', 'zoomThrough', 'feedbackSmear', 'flashWhite', 'flashBlack'] as const, 'crossfade'),
      beats: num(r.transitionIn.beats, 4, 0, 64),
      quantize: oneOf(r.transitionIn.quantize, ['none', 'beat', 'bar', 'phrase'] as const, 'bar'),
    };
  }
  if (isObj(r.camera)) preset.camera = r.camera as unknown as Preset['camera'];
  return preset;
}

/** Stable, human-readable JSON (2-space indent, trailing newline). */
export function serializePreset(p: Preset): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}

export function parsePreset(json: string): Preset {
  return normalizePreset(JSON.parse(json));
}

/** "Save as Template": keep structure and routing, clear colours (and, later, clips). */
export function toTemplate(p: Preset, name = `${p.name} (template)`): Preset {
  const t = structuredClone(p);
  t.name = name;
  t.isTemplate = true;
  t.palette = 'Mono';
  t.paletteCycle = { ...PALETTE_CYCLE_OFF };
  t.hueRotate = { ...HUE_ROTATE_OFF };
  delete t.customPalettes;
  return t;
}

export function sceneOf(p: Preset): Scene {
  const scene: Scene = { layers: p.layers, palette: p.palette, paletteCycle: p.paletteCycle, hueRotate: p.hueRotate, macros: p.macros };
  if (p.customPalettes) scene.customPalettes = p.customPalettes;
  if (p.camera) scene.camera = p.camera;
  if (p.category) scene.category = p.category;
  return scene;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'preset'
  );
}

export function newLayerId(layers: Layer[]): string {
  let n = layers.length + 1;
  while (layers.some((l) => l.id === `layer${n}`)) n++;
  return `layer${n}`;
}
