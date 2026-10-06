import type { AudioFrame } from '@shared/types/audio';
import type { Layer, Macro, ParamBag, Scene } from '@shared/types/engine';
import { applyCurve, type ModulationEngine } from './modulation';
import { specForLayerPath, isNumericSpec } from './registry';

/** Read a dotted path ("layers.0.source.params.height") from an object. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Write a dotted path in place. Returns false when a parent is missing. */
export function setPath(obj: unknown, path: string, value: unknown): boolean {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur === null || typeof cur !== 'object') return false;
  (cur as Record<string, unknown>)[parts[parts.length - 1]] = value;
  return true;
}

/** Split "layers.3.source.params.x" into [3, "source.params.x"]. */
export function splitScenePath(path: string): [number, string] | null {
  const m = /^layers\.(\d+)\.(.+)$/.exec(path);
  return m ? [Number(m[1]), m[2]] : null;
}

/** Value a macro writes into one of its targets. */
export function macroValue(macro: Macro, target: Macro['targets'][number]): number {
  const v = applyCurve(macro.value, target.curve);
  return target.range[0] + (target.range[1] - target.range[0]) * v;
}

/**
 * Apply macros to a deep copy of the scene: each macro target's value is set
 * from the macro knob (later macros win on shared targets). Integer params are
 * rounded and everything is clamped to the parameter's declared range.
 */
export function applyMacros(scene: Scene): Scene {
  const out = structuredClone(scene);
  for (const macro of out.macros) {
    for (const target of macro.targets) {
      const split = splitScenePath(target.path);
      if (!split) continue;
      const layer = out.layers[split[0]];
      if (!layer) continue;
      let v = macroValue(macro, target);
      const spec = specForLayerPath(layer, split[1]);
      if (spec && isNumericSpec(spec)) {
        v = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, v));
        if (spec.type === 'int') v = Math.round(v);
      }
      setPath(layer, split[1], v);
    }
  }
  return out;
}

interface CompiledMod {
  key: string;
  liveKey: string;
  mod: Layer['modulators'][number];
  /** Bag holding the param, or null for layer opacity. */
  bag: ParamBag | null;
  param: string;
  layerIndex: number;
  min: number;
  max: number;
  base: number;
  int: boolean;
}

export interface ResolvedLayer {
  layer: Layer;
  /** Live generator params (numeric fields modulated each frame). */
  source: ParamBag;
  /** Live FX params, one bag per FX instance. */
  fx: ParamBag[];
  opacity: number;
}

/**
 * A scene compiled for rendering: macros applied once, modulator targets
 * resolved once; per frame only numbers are rewritten (no allocation).
 */
export class ScenePlan {
  readonly scene: Scene;
  readonly layers: ResolvedLayer[];
  private readonly mods: CompiledMod[] = [];
  /** Current value of every modulated param, normalized 0..1 in its range ("layerId|path"). */
  readonly live = new Map<string, number>();
  readonly modKeys = new Set<string>();

  constructor(scene: Scene) {
    this.scene = applyMacros(scene);
    this.layers = this.scene.layers.map((layer) => ({
      layer,
      source: { ...layer.source.params },
      fx: layer.fx.map((x) => ({ ...x.params })),
      opacity: layer.opacity,
    }));
    this.scene.layers.forEach((layer, li) => {
      layer.modulators.forEach((mod, mi) => {
        const spec = specForLayerPath(layer, mod.target);
        if (!isNumericSpec(spec)) return;
        const r = this.layers[li];
        let bag: ParamBag | null = null;
        let param = 'opacity';
        const parts = mod.target.split('.');
        if (parts[0] === 'source') {
          bag = r.source;
          param = parts[2];
        } else if (parts[0] === 'fx') {
          bag = r.fx[Number(parts[1])] ?? null;
          param = parts[3];
          if (!bag) return;
        }
        const base = Number(bag ? bag[param] : r.opacity);
        const key = `${layer.id}:${mi}:${mod.source}`;
        this.modKeys.add(key);
        this.mods.push({ key, liveKey: `${layer.id}|${mod.target}`, mod, bag, param, layerIndex: li, min: spec!.min ?? 0, max: spec!.max ?? 1, base: Number.isFinite(base) ? base : 0, int: spec!.type === 'int' });
      });
    });
  }

  /** Re-evaluate all modulated params for this frame. */
  resolve(frame: AudioFrame, engine: ModulationEngine, reactivity: number): void {
    // Reset modulated params to their (macro-applied) base, then sum contributions.
    for (const c of this.mods) {
      if (c.bag) c.bag[c.param] = c.base;
      else this.layers[c.layerIndex].opacity = c.base;
    }
    for (const c of this.mods) {
      const delta = engine.contribution(c.mod, c.key, frame, reactivity) * (c.max - c.min);
      if (c.bag) c.bag[c.param] = (c.bag[c.param] as number) + delta;
      else this.layers[c.layerIndex].opacity += delta;
    }
    for (const c of this.mods) {
      let v = c.bag ? (c.bag[c.param] as number) : this.layers[c.layerIndex].opacity;
      v = Math.min(c.max, Math.max(c.min, v));
      if (c.int) v = Math.round(v);
      if (c.bag) c.bag[c.param] = v;
      else this.layers[c.layerIndex].opacity = v;
      this.live.set(c.liveKey, c.max > c.min ? (v - c.min) / (c.max - c.min) : 0);
    }
  }
}
