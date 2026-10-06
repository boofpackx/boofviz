import { useId } from 'react';
import type { Layer, Modulator, ParamSpec, ParamValue, Preset } from '@shared/types/engine';
import { MOD_SOURCES, type ModSourceOption } from '@/engine/registry';
import { getPath, setPath } from '@/engine/scenePlan';
import { useTicker } from '../hooks';
import { liveValue } from '../runtime';
import { useShow } from '../show';
import { contextMenu, type MenuItem } from './ContextMenu';

/** Write a layer-relative param in an undoable edit (slider drags coalesce). */
export function editParam(layerIndex: number, path: string, value: ParamValue): void {
  const layer = useShow.getState().doc.layers[layerIndex];
  useShow.getState().edit((d) => {
    setPath(d.layers[layerIndex], path, value);
  }, `param:${layer?.id}:${path}`);
}

export function addModulator(layerIndex: number, path: string, opt: ModSourceOption): void {
  useShow.getState().edit((d) => {
    const m: Modulator = { target: path, source: opt.source, amount: 0.3, ...opt.init };
    d.layers[layerIndex].modulators.push(m);
  });
  useShow.getState().notify(`Modulating by ${opt.label}`);
}

function assignToMacro(doc: Preset, layerIndex: number, path: string, spec: ParamSpec, macro: number): void {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const cur = Number(getPath(doc.layers[layerIndex], path));
  useShow.getState().edit((d) => {
    const m = d.macros[macro];
    const full = `layers.${layerIndex}.${path}`;
    m.targets = m.targets.filter((t) => t.path !== full);
    if (!m.targets.length) {
      // First target: full range, and move the knob to where the param already is.
      m.targets.push({ path: full, range: [min, max] });
      m.value = max > min ? (cur - min) / (max - min) : 0.5;
      if (!m.name) m.name = spec.label;
    } else {
      // Fit a half-range window around the current value so nothing jumps.
      const span = (max - min) * 0.5;
      const lo = Math.max(min, Math.min(max - span, cur - m.value * span));
      m.targets.push({ path: full, range: [lo, lo + span] });
    }
  });
  useShow.getState().notify(`Assigned ${spec.label} to macro ${macro + 1}`);
}

export function modulateMenu(onPick: (o: ModSourceOption) => void): MenuItem[] {
  const groups = ['Audio', 'Onset', 'Tempo', 'Envelope', 'LFO', 'Random'] as const;
  return groups.map((g) => ({
    label: g,
    items: MOD_SOURCES.filter((s) => s.group === g).map((s) => ({ label: s.label, onSelect: () => onPick(s) })),
  }));
}

interface Props {
  layer: Layer;
  layerIndex: number;
  path: string;
  spec: ParamSpec;
  value: ParamValue;
}

/** One parameter row: control, right-click menu (modulate / macro / reset), live modulation meter. */
export function ParamControl({ layer, layerIndex, path, spec, value }: Props) {
  const id = useId();
  const mods = layer.modulators.filter((m) => m.target === path);
  const numeric = spec.type === 'float' || spec.type === 'int';
  const menu = contextMenu(() => {
    const doc = useShow.getState().doc;
    const items: MenuItem[] = [];
    if (numeric) {
      items.push({ label: 'Modulate by…', items: modulateMenu((o) => addModulator(layerIndex, path, o)) });
      items.push({
        label: 'Assign to macro',
        items: doc.macros.map((m, i) => ({ label: `${i + 1}  ${m.name || '—'}`, hint: m.targets.length ? `${m.targets.length}` : '', onSelect: () => assignToMacro(doc, layerIndex, path, spec, i) })),
      });
      if (mods.length) {
        items.push({
          label: 'Remove modulation',
          onSelect: () => useShow.getState().edit((d) => void (d.layers[layerIndex].modulators = d.layers[layerIndex].modulators.filter((m) => m.target !== path))),
        });
      }
      items.push({ separator: true, label: '' });
    }
    items.push({ label: 'Reset to default', onSelect: () => editParam(layerIndex, path, spec.default) });
    return items;
  });

  let control: React.ReactNode;
  if (spec.type === 'bool') {
    control = (
      <button type="button" onClick={() => editParam(layerIndex, path, !value)} className={`relative h-3.5 w-7 justify-self-start rounded-full ${value ? 'bg-accent' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${value ? 'left-4' : 'left-0.5'}`} />
      </button>
    );
  } else if (spec.type === 'enum') {
    control = (
      <select id={id} value={String(value)} onChange={(e) => editParam(layerIndex, path, e.target.value)} className="w-full">
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (spec.type === 'text') {
    control = (
      <input
        id={id}
        type="text"
        value={String(value)}
        maxLength={200}
        onChange={(e) => editParam(layerIndex, path, e.target.value)}
        className="w-full rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[12px] text-ink-100 outline-none focus:border-accent-2"
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 0.01}
        value={Number(value)}
        onChange={(e) => editParam(layerIndex, path, Number(e.target.value))}
      />
    );
  }

  return (
    <div className="grid grid-cols-[86px_1fr_48px] items-center gap-2" onContextMenu={menu} title={spec.hint}>
      <label htmlFor={id} className={`flex items-center gap-1 truncate ${mods.length ? 'text-accent-2' : 'text-ink-300'}`}>
        {mods.length > 0 && <span className="rounded bg-accent-2/20 px-0.5 font-mono text-[9px] text-accent-2">{mods.length}</span>}
        <span className="truncate">{spec.label}</span>
      </label>
      <div className="relative">
        {control}
        {numeric && mods.length > 0 && <LiveMeter layerId={layer.id} path={path} />}
      </div>
      <span className="text-right font-mono text-[11px] text-ink-200 tabular-nums">{numeric ? formatNum(Number(value), spec) : ''}</span>
    </div>
  );
}

export function formatNum(v: number, spec: ParamSpec): string {
  if (spec.type === 'int') return v.toFixed(0);
  const range = (spec.max ?? 1) - (spec.min ?? 0);
  return range >= 100 ? v.toFixed(0) : range >= 10 ? v.toFixed(1) : range < 0.2 ? v.toFixed(3) : v.toFixed(2);
}

/** Thin bar under a modulated slider showing where the param actually is right now. */
function LiveMeter({ layerId, path }: { layerId: string; path: string }) {
  useTicker(24);
  const v = liveValue(layerId, path) ?? 0;
  return (
    <div className="pointer-events-none absolute right-0 -bottom-0.5 left-0 h-[2px] rounded bg-ink-700">
      <div className="h-full rounded bg-accent-2 shadow-[0_0_4px_#39d5ff]" style={{ width: `${Math.round(v * 100)}%` }} />
    </div>
  );
}
