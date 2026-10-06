import { useState } from 'react';
import { BLEND_MODES, MAX_LAYERS, type BlendMode, type Layer, type Modulator, type Preset } from '@shared/types/engine';
import { PALETTE_NAMES, paletteHexes } from '@/engine/palettes';
import { newLayerId } from '@/engine/presetIO';
import { defaultParams, EFFECTS, effectDef, GENERATORS, generatorDef, MOD_SOURCES, modSourceLabel, specForLayerPath } from '@/engine/registry';
import { newEffect, useShow } from '../show';
import { contextMenu } from './ContextMenu';
import { formatNum, ParamControl } from './ParamControl';
import { Section, Segmented, Slider, Toggle } from './ui';

export function Inspector() {
  const doc = useShow((s) => s.doc);
  const sel = useShow((s) => s.selectedLayer);
  const layer = doc.layers[sel];
  return (
    <div className="h-full overflow-y-auto">
      <SceneSection doc={doc} />
      <LayerList doc={doc} selected={sel} />
      {layer && <LayerDetail key={layer.id} layer={layer} index={sel} doc={doc} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Swatch({ name, custom, size = 'sm' }: { name: string; custom?: Record<string, string[]>; size?: 'sm' | 'md' }) {
  return (
    <span className={`inline-flex overflow-hidden rounded-sm ${size === 'md' ? 'h-3' : 'h-2'}`}>
      {paletteHexes(name, custom).map((c, i) => (
        <span key={i} className={size === 'md' ? 'w-3' : 'w-2'} style={{ background: c }} />
      ))}
    </span>
  );
}

export { Swatch };

function SceneSection({ doc }: { doc: Preset }) {
  const edit = useShow((s) => s.edit);
  const names = [...Object.keys(doc.customPalettes ?? {}), ...PALETTE_NAMES];
  const cyc = doc.paletteCycle;
  const hue = doc.hueRotate;
  return (
    <Section title="Scene · colour">
      <div className="grid grid-cols-[86px_1fr] items-center gap-2">
        <span className="text-ink-300">Palette</span>
        <div className="flex items-center gap-2">
          <select value={doc.palette} onChange={(e) => edit((d) => void (d.palette = e.target.value))} className="min-w-0 flex-1">
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="shrink-0 pr-1">
            <Swatch name={doc.palette} custom={doc.customPalettes} size="md" />
          </span>
        </div>
        <span className="text-ink-300">Cycle</span>
        <Segmented
          value={cyc.mode}
          onChange={(v) => edit((d) => void (d.paletteCycle = { ...d.paletteCycle, mode: v, list: d.paletteCycle.list.length ? d.paletteCycle.list : [d.palette, names.find((n) => n !== d.palette) ?? d.palette] }))}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'beat', label: 'Beat' },
            { value: 'bar', label: 'Bar' },
            { value: 'phrase', label: 'Phrase' },
            { value: 'drop', label: 'Drop' },
            { value: 'energy', label: 'Energy' },
          ]}
        />
      </div>
      {cyc.mode !== 'off' && (
        <>
          {cyc.mode !== 'energy' && (
            <Slider label="Every" value={cyc.every} min={1} max={16} step={1} format={(v) => `${v} ${cyc.mode}${v > 1 ? 's' : ''}`} onChange={(v) => edit((d) => void (d.paletteCycle.every = v), 'cycle:every')} />
          )}
          {cyc.mode !== 'energy' && <Slider label="Fade" value={cyc.fadeBeats} min={0} max={16} step={0.5} format={(v) => `${v} beats`} onChange={(v) => edit((d) => void (d.paletteCycle.fadeBeats = v), 'cycle:fade')} />}
          <div className="flex flex-wrap gap-1">
            {names.map((n) => {
              const on = cyc.list.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  title={n}
                  onClick={() => edit((d) => void (d.paletteCycle.list = on ? d.paletteCycle.list.filter((x) => x !== n) : [...d.paletteCycle.list, n]))}
                  className={`flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] ${on ? 'border-accent-2/70 text-ink-100' : 'border-ink-700 text-ink-400 opacity-60'}`}
                >
                  <Swatch name={n} custom={doc.customPalettes} />
                  {on && <span className="font-mono">{cyc.list.indexOf(n) + 1}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="grid grid-cols-[86px_1fr] items-center gap-2">
        <span className="text-ink-300">Hue rotate</span>
        <Segmented
          value={hue.mode}
          onChange={(v) => edit((d) => void (d.hueRotate = { mode: v, rate: v === 'lfo' ? 0.05 : v === 'off' ? 0 : 6, amount: v === 'lfo' ? 40 : 0 }))}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'beat', label: 'Beat' },
            { value: 'bar', label: 'Bar' },
            { value: 'lfo', label: 'LFO' },
          ]}
        />
      </div>
      {hue.mode === 'lfo' && (
        <>
          <Slider label="LFO rate" value={hue.rate} min={0.005} max={1} step={0.005} format={(v) => `${v.toFixed(3)} Hz`} onChange={(v) => edit((d) => void (d.hueRotate.rate = v), 'hue:rate')} />
          <Slider label="Swing" value={hue.amount} min={0} max={180} step={1} unit="°" onChange={(v) => edit((d) => void (d.hueRotate.amount = v), 'hue:amount')} />
        </>
      )}
      {(hue.mode === 'beat' || hue.mode === 'bar') && <Slider label="Degrees" value={hue.rate} min={-90} max={90} step={1} format={(v) => `${v}°/${hue.mode}`} onChange={(v) => edit((d) => void (d.hueRotate.rate = v), 'hue:rate')} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function LayerList({ doc, selected }: { doc: Preset; selected: number }) {
  const { selectLayer, addLayer, removeLayer, moveLayer, edit } = useShow.getState();
  const [renaming, setRenaming] = useState<number | null>(null);
  // Top layer first, like every compositing tool.
  const order = doc.layers.map((_, i) => i).reverse();
  return (
    <Section
      title={`Layers · ${doc.layers.length}/${MAX_LAYERS}`}
      right={
        <select value="" onChange={(e) => e.target.value && addLayer(e.target.value)} title="Add a layer" className="text-[11px]" disabled={doc.layers.length >= MAX_LAYERS}>
          <option value="">+ Layer</option>
          {GENERATORS.map((g) => (
            <option key={g.kind} value={g.kind}>
              {g.label}
            </option>
          ))}
        </select>
      }
    >
      <div className="space-y-1">
        {order.map((i) => {
          const l = doc.layers[i];
          const active = i === selected;
          return (
            <div
              key={l.id}
              onClick={() => selectLayer(i)}
              onContextMenu={contextMenu(() => [
                { label: 'Rename', onSelect: () => setRenaming(i) },
                { label: 'Duplicate', disabled: doc.layers.length >= MAX_LAYERS, onSelect: () => edit((d) => void d.layers.splice(i + 1, 0, { ...structuredClone(d.layers[i]), id: newLayerId(d.layers), name: `${d.layers[i].name} copy` })) },
                { label: 'Move up', disabled: i === doc.layers.length - 1, onSelect: () => moveLayer(i, 1) },
                { label: 'Move down', disabled: i === 0, onSelect: () => moveLayer(i, -1) },
                { separator: true, label: '' },
                { label: 'Delete layer', onSelect: () => removeLayer(i) },
              ])}
              className={`group flex cursor-pointer items-center gap-2 rounded border px-2 py-1 ${active ? 'border-accent/60 bg-accent/10' : 'border-ink-700 bg-ink-850 hover:border-ink-500'}`}
            >
              <button
                type="button"
                title={l.enabled ? 'Hide layer' : 'Show layer'}
                onClick={(e) => {
                  e.stopPropagation();
                  edit((d) => void (d.layers[i].enabled = !d.layers[i].enabled));
                }}
                className={`h-3 w-3 shrink-0 rounded-sm border ${l.enabled ? 'border-ok bg-ok/70' : 'border-ink-500'}`}
              />
              <div className="min-w-0 flex-1">
                {renaming === i ? (
                  <input
                    autoFocus
                    defaultValue={l.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) edit((d) => void (d.layers[i].name = v));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-full rounded border border-accent-2 bg-ink-800 px-1 text-[12px] outline-none"
                  />
                ) : (
                  <div className="truncate text-ink-100" onDoubleClick={() => setRenaming(i)}>
                    {l.name}
                  </div>
                )}
                <div className="truncate text-[10px] text-ink-400">
                  {generatorDef(l.source.kind)?.label ?? l.source.kind}
                  {l.fx.length > 0 && ` · ${l.fx.length} fx`}
                  {l.modulators.length > 0 && ` · ${l.modulators.length} mod`}
                  {l.mask && ' · mask'}
                </div>
              </div>
              <select
                value={l.blend}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => edit((d) => void (d.layers[i].blend = e.target.value as BlendMode))}
                className="w-[88px] text-[10px]"
                title="Blend mode"
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="w-8 text-right font-mono text-[10px] text-ink-300">{Math.round(l.opacity * 100)}%</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

/** Rewrite modulator and macro targets after an FX is moved or removed. */
function remapFx(d: Preset, layerIndex: number, map: (i: number) => number | null): void {
  const layer = d.layers[layerIndex];
  const fix = (path: string): string | null => {
    const m = /^fx\.(\d+)\.(.*)$/.exec(path);
    if (!m) return path;
    const j = map(Number(m[1]));
    return j === null ? null : `fx.${j}.${m[2]}`;
  };
  layer.modulators = layer.modulators.flatMap((mod) => {
    const t = fix(mod.target);
    return t === null ? [] : [{ ...mod, target: t }];
  });
  const prefix = `layers.${layerIndex}.`;
  for (const macro of d.macros) {
    macro.targets = macro.targets.flatMap((t) => {
      if (!t.path.startsWith(prefix)) return [t];
      const p = fix(t.path.slice(prefix.length));
      return p === null ? [] : [{ ...t, path: prefix + p }];
    });
  }
}

function LayerDetail({ layer, index, doc }: { layer: Layer; index: number; doc: Preset }) {
  const edit = useShow((s) => s.edit);
  const gen = generatorDef(layer.source.kind);
  const [openFx, setOpenFx] = useState<number | null>(layer.fx.length ? 0 : null);

  const changeKind = (kind: string): void =>
    edit((d) => {
      const l = d.layers[index];
      l.source = { type: 'generator', kind, params: defaultParams(generatorDef(kind)) };
      l.name = l.name === (generatorDef(layer.source.kind)?.label ?? '') ? (generatorDef(kind)?.label ?? kind) : l.name;
      // Drop routing that pointed at the old generator's params.
      l.modulators = l.modulators.filter((m) => !m.target.startsWith('source.'));
      for (const m of d.macros) m.targets = m.targets.filter((t) => !t.path.startsWith(`layers.${index}.source.`));
    });

  return (
    <>
      <Section title={`Layer · ${layer.name}`}>
        <Slider label="Opacity" value={layer.opacity} min={0} max={1} onChange={(v) => edit((d) => void (d.layers[index].opacity = v), `opacity:${layer.id}`)} />
        <div className="grid grid-cols-[86px_1fr] items-center gap-2">
          <span className="text-ink-300">Generator</span>
          <select value={layer.source.kind} onChange={(e) => changeKind(e.target.value)} title={gen?.description}>
            {GENERATORS.map((g) => (
              <option key={g.kind} value={g.kind}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        {gen && <p className="text-[11px] leading-snug text-ink-400">{gen.description} Right-click a parameter to modulate it or put it on a macro.</p>}
        {gen?.params.map((spec) => (
          <ParamControl key={spec.key} layer={layer} layerIndex={index} path={`source.params.${spec.key}`} spec={spec} value={layer.source.params[spec.key] ?? spec.default} />
        ))}
      </Section>

      <MaskSection layer={layer} index={index} doc={doc} />

      <Section
        title={`Effects · ${layer.fx.length}`}
        right={
          <select
            value=""
            onChange={(e) => {
              const kind = e.target.value;
              if (!kind) return;
              edit((d) => void d.layers[index].fx.push(newEffect(kind)));
              setOpenFx(layer.fx.length);
            }}
            className="text-[11px]"
          >
            <option value="">+ Effect</option>
            {EFFECTS.map((x) => (
              <option key={x.kind} value={x.kind}>
                {x.label}
              </option>
            ))}
          </select>
        }
      >
        {layer.fx.length === 0 && <p className="text-[11px] text-ink-400">No effects. Add trails, bloom, kaleidoscope…</p>}
        {layer.fx.map((fx, fi) => {
          const def = effectDef(fx.type);
          const open = openFx === fi;
          return (
            <div key={fi} className="rounded border border-ink-700 bg-ink-850">
              <div className="flex items-center gap-2 px-2 py-1">
                <button
                  type="button"
                  title={fx.enabled ? 'Bypass' : 'Enable'}
                  onClick={() => edit((d) => void (d.layers[index].fx[fi].enabled = !d.layers[index].fx[fi].enabled))}
                  className={`h-3 w-3 shrink-0 rounded-full border ${fx.enabled ? 'border-accent bg-accent/70' : 'border-ink-500'}`}
                />
                <button type="button" className="flex-1 truncate text-left text-ink-100" onClick={() => setOpenFx(open ? null : fi)} title={def?.description}>
                  {def?.label ?? fx.type}
                </button>
                <button
                  type="button"
                  className="px-1 text-ink-400 hover:text-ink-100 disabled:opacity-30"
                  disabled={fi === 0}
                  title="Earlier in the chain"
                  onClick={() =>
                    edit((d) => {
                      const f = d.layers[index].fx;
                      [f[fi - 1], f[fi]] = [f[fi], f[fi - 1]];
                      remapFx(d, index, (k) => (k === fi ? fi - 1 : k === fi - 1 ? fi : k));
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="px-1 text-ink-400 hover:text-ink-100 disabled:opacity-30"
                  disabled={fi === layer.fx.length - 1}
                  title="Later in the chain"
                  onClick={() =>
                    edit((d) => {
                      const f = d.layers[index].fx;
                      [f[fi + 1], f[fi]] = [f[fi], f[fi + 1]];
                      remapFx(d, index, (k) => (k === fi ? fi + 1 : k === fi + 1 ? fi : k));
                    })
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="px-1 text-ink-400 hover:text-bad"
                  title="Remove effect"
                  onClick={() =>
                    edit((d) => {
                      d.layers[index].fx.splice(fi, 1);
                      remapFx(d, index, (k) => (k === fi ? null : k > fi ? k - 1 : k));
                    })
                  }
                >
                  ✕
                </button>
              </div>
              {open && (
                <div className="space-y-2 border-t border-ink-700 px-2 py-2">
                  {def?.params.map((spec) => (
                    <ParamControl key={spec.key} layer={layer} layerIndex={index} path={`fx.${fi}.params.${spec.key}`} spec={spec} value={fx.params[spec.key] ?? spec.default} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <ModulatorSection layer={layer} index={index} />
    </>
  );
}

function MaskSection({ layer, index, doc }: { layer: Layer; index: number; doc: Preset }) {
  const edit = useShow((s) => s.edit);
  const mask = layer.mask;
  const mode = mask ? mask.type : 'none';
  return (
    <Section title="Mask">
      <Segmented
        value={mode}
        onChange={(v) =>
          edit((d) => {
            if (v === 'none') delete d.layers[index].mask;
            else d.layers[index].mask = { type: v, layer: v === 'luma' ? Math.max(0, index - 1) : undefined, shape: v === 'shape' ? 'circle' : undefined, size: 0.6, feather: 0.1, invert: false };
          })
        }
        options={[
          { value: 'none', label: 'None' },
          { value: 'luma', label: 'Luma', disabled: index === 0, title: 'Use the brightness of a lower layer' },
          { value: 'shape', label: 'Shape' },
        ]}
      />
      {mask?.type === 'luma' && (
        <div className="grid grid-cols-[86px_1fr] items-center gap-2">
          <span className="text-ink-300">Source layer</span>
          <select value={mask.layer ?? 0} onChange={(e) => edit((d) => void (d.layers[index].mask!.layer = Number(e.target.value)))}>
            {doc.layers.slice(0, index).map((l, i) => (
              <option key={l.id} value={i}>
                {i + 1}. {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {mask?.type === 'luma' && <p className="text-[11px] text-ink-400">Tip: set the source layer’s opacity to 0 to use it only as a matte.</p>}
      {mask?.type === 'shape' && (
        <>
          <Segmented
            value={mask.shape ?? 'circle'}
            onChange={(v) => edit((d) => void (d.layers[index].mask!.shape = v))}
            options={[
              { value: 'circle', label: 'Circle' },
              { value: 'rect', label: 'Rect' },
              { value: 'ring', label: 'Ring' },
              { value: 'linear', label: 'Linear' },
              { value: 'triangle', label: 'Tri' },
            ]}
          />
          <Slider label="Size" value={mask.size} min={0} max={2} onChange={(v) => edit((d) => void (d.layers[index].mask!.size = v), `mask:size:${layer.id}`)} />
        </>
      )}
      {mask && (
        <>
          <Slider label="Feather" value={mask.feather} min={0} max={1} onChange={(v) => edit((d) => void (d.layers[index].mask!.feather = v), `mask:feather:${layer.id}`)} />
          <Toggle label="Invert" checked={mask.invert} onChange={(v) => edit((d) => void (d.layers[index].mask!.invert = v))} />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

const RATES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

function ModulatorSection({ layer, index }: { layer: Layer; index: number }) {
  const edit = useShow((s) => s.edit);
  const [open, setOpen] = useState<number | null>(null);
  const upd = (mi: number, patch: Partial<Modulator>, key?: string): void => edit((d) => void Object.assign(d.layers[index].modulators[mi], patch), key);
  return (
    <Section title={`Modulators · ${layer.modulators.length}`}>
      {layer.modulators.length === 0 && <p className="text-[11px] text-ink-400">Right-click any parameter above and choose “Modulate by…”.</p>}
      {layer.modulators.map((m, mi) => {
        const spec = specForLayerPath(layer, m.target);
        const fxIdx = /^fx\.(\d+)\./.exec(m.target)?.[1];
        const where = fxIdx !== undefined ? effectDef(layer.fx[Number(fxIdx)]?.type ?? '')?.label : m.target === 'opacity' ? 'Layer' : generatorDef(layer.source.kind)?.label;
        const isOpen = open === mi;
        const tempo = m.source.startsWith('tempo.');
        return (
          <div key={mi} className="rounded border border-ink-700 bg-ink-850">
            <div className="flex items-center gap-2 px-2 py-1">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : mi)}>
                <div className="truncate text-ink-100">
                  {spec?.label ?? m.target} <span className="text-ink-400">← {modSourceLabel(m)}</span>
                </div>
                <div className="truncate text-[10px] text-ink-500">{where}</div>
              </button>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={m.amount}
                title="Amount (fraction of the parameter's range)"
                onChange={(e) => upd(mi, { amount: Number(e.target.value) }, `mod:${layer.id}:${mi}`)}
                className="w-20"
              />
              <span className="w-9 text-right font-mono text-[10px] text-ink-300">{m.amount.toFixed(2)}</span>
              <button type="button" className="px-1 text-ink-400 hover:text-bad" title="Remove" onClick={() => edit((d) => void d.layers[index].modulators.splice(mi, 1))}>
                ✕
              </button>
            </div>
            {isOpen && (
              <div className="space-y-2 border-t border-ink-700 px-2 py-2">
                <div className="grid grid-cols-[86px_1fr] items-center gap-2">
                  <span className="text-ink-300">Source</span>
                  <select
                    value={MOD_SOURCES.findIndex((s) => s.source === m.source && (s.init?.trigger ?? null) === (m.trigger ?? null) && (s.init?.randomMode ?? null) === (m.randomMode ?? null))}
                    onChange={(e) => {
                      const o = MOD_SOURCES[Number(e.target.value)];
                      edit((d) => void (d.layers[index].modulators[mi] = { target: m.target, source: o.source, amount: m.amount, ...o.init }));
                    }}
                  >
                    {MOD_SOURCES.map((s, si) => (
                      <option key={si} value={si}>
                        {s.group} · {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-ink-300">Curve</span>
                  <Segmented
                    value={m.curve ?? 'linear'}
                    onChange={(v) => upd(mi, { curve: v })}
                    options={[
                      { value: 'linear', label: 'Lin' },
                      { value: 'exp', label: 'Exp' },
                      { value: 'log', label: 'Log' },
                      { value: 'smooth', label: 'Smooth' },
                    ]}
                  />
                  {(tempo || m.source === 'lfo') && (
                    <>
                      <span className="text-ink-300">Shape</span>
                      <select value={m.shape ?? 'sine'} onChange={(e) => upd(mi, { shape: e.target.value as Modulator['shape'] })}>
                        {['sine', 'saw', 'ramp', 'square', 'bounce', 'stepped'].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {(tempo || (m.source === 'random' && m.randomMode !== 'smooth')) && (
                    <>
                      <span className="text-ink-300">Rate</span>
                      <select value={m.rate ?? (m.source === 'tempo.bar' ? 4 : m.source === 'tempo.phrase' ? 16 : 1)} onChange={(e) => upd(mi, { rate: Number(e.target.value) })}>
                        {RATES.map((r) => (
                          <option key={r} value={r}>
                            {r < 1 ? `1/${1 / r}` : r} beat{r === 1 ? '' : 's'}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {m.source === 'envelope' && (
                    <>
                      <span className="text-ink-300">Trigger</span>
                      <select value={m.trigger ?? 'onset.kick'} onChange={(e) => upd(mi, { trigger: e.target.value as Modulator['trigger'] })}>
                        {['onset.kick', 'onset.snare', 'onset.hat', 'onset.any', 'drop', 'downbeat', 'phrase'].map((s) => (
                          <option key={s} value={s}>
                            {s.replace('onset.', '')}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                {(m.source === 'lfo' || m.randomMode === 'smooth') && <Slider label="Frequency" value={m.hz ?? 0.25} min={0.01} max={8} step={0.01} unit=" Hz" onChange={(v) => upd(mi, { hz: v }, `mod:hz:${mi}`)} />}
                {m.source === 'envelope' && (
                  <>
                    <Slider label="Attack" value={m.attackMs ?? 5} min={0} max={1000} step={1} unit=" ms" onChange={(v) => upd(mi, { attackMs: v }, `mod:a:${mi}`)} />
                    <Slider label="Hold" value={m.holdMs ?? 30} min={0} max={2000} step={5} unit=" ms" onChange={(v) => upd(mi, { holdMs: v }, `mod:h:${mi}`)} />
                    <Slider label="Decay" value={m.decayMs ?? 250} min={10} max={8000} step={10} unit=" ms" onChange={(v) => upd(mi, { decayMs: v }, `mod:d:${mi}`)} />
                  </>
                )}
                {m.source.startsWith('audio.onset') && <Slider label="Decay" value={m.decayMs ?? 150} min={20} max={2000} step={5} unit=" ms" onChange={(v) => upd(mi, { decayMs: v }, `mod:d:${mi}`)} />}
                <Slider label="Offset" value={m.offset ?? 0} min={-1} max={1} onChange={(v) => upd(mi, { offset: v }, `mod:o:${mi}`)} />
                <Toggle label="Invert" checked={!!m.invert} onChange={(v) => upd(mi, { invert: v })} />
                {spec && (
                  <p className="text-[10px] text-ink-500">
                    Range {formatNum(spec.min ?? 0, spec)}–{formatNum(spec.max ?? 1, spec)}. Amount 1.00 sweeps the full range.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
