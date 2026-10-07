import { useRef, useState } from 'react';
import type { Macro } from '@shared/types/engine';
import { generatorDef, specForLayerPath } from '@/engine/registry';
import { splitScenePath } from '@/engine/scenePlan';
import { useShow } from '../show';
import { useControl } from '../store';
import { engine } from '../runtime';
import { useTicker } from '../hooks';
import { poolLabel, shuffleNow, toggleAuto } from '../launcher';
import { PLAYLISTS } from '../autopilot';
import type { LaunchQuantize, ShufflePool, TransitionType } from '@shared/settings';
import { contextMenu } from './ContextMenu';
import { Button, Segmented, Toggle } from './ui';

/** Rotary knob: drag up/down (Shift = fine), wheel, double-click resets to the preset's value. */
function Knob({ value, onChange, onReset, active }: { value: number; onChange: (v: number) => void; onReset: () => void; active: boolean }) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const a0 = -135;
  const a1 = a0 + 270 * value;
  const r = 16;
  const arc = (from: number, to: number): string => {
    const p = (deg: number): string => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return `${20 + r * Math.cos(rad)} ${20 + r * Math.sin(rad)}`;
    };
    return `M ${p(from)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`;
  };
  return (
    <svg
      width={40}
      height={40}
      className="cursor-ns-resize touch-none"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: value };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const k = e.shiftKey ? 0.0015 : 0.006;
        onChange(Math.min(1, Math.max(0, drag.current.v + (drag.current.y - e.clientY) * k)));
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={onReset}
      onWheel={(e) => onChange(Math.min(1, Math.max(0, value - Math.sign(e.deltaY) * 0.02)))}
    >
      <path d={arc(a0, 135)} stroke="#2e2e39" strokeWidth={4} fill="none" strokeLinecap="round" />
      {value > 0.002 && <path d={arc(a0, a1)} stroke={active ? '#ff2e88' : '#6f6f7f'} strokeWidth={4} fill="none" strokeLinecap="round" />}
      <circle cx={20} cy={20} r={9} fill="#18181f" stroke="#4a4a58" />
      <line x1={20} y1={20} x2={20 + 8 * Math.cos(((a1 - 90) * Math.PI) / 180)} y2={20 + 8 * Math.sin(((a1 - 90) * Math.PI) / 180)} stroke="#ececf2" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function targetLabel(path: string): string {
  const doc = useShow.getState().doc;
  const split = splitScenePath(path);
  if (!split) return path;
  const layer = doc.layers[split[0]];
  if (!layer) return path;
  const mod = /^modulators\.(\d+)\.amount$/.exec(split[1]);
  if (mod) return `${layer.name} · modulator ${Number(mod[1]) + 1} depth`;
  const spec = specForLayerPath(layer, split[1]);
  const fx = /^fx\.(\d+)\./.exec(split[1]);
  const where = fx ? layer.fx[Number(fx[1])]?.type : generatorDef(layer.source.kind)?.label;
  return `${layer.name} · ${where} · ${spec?.label ?? split[1]}`;
}

/** Bottom performance strip: 8 macros, preset title, save / undo. */
export function MacroStrip() {
  const doc = useShow((s) => s.doc);
  const dirty = useShow((s) => s.dirty);
  const sourceId = useShow((s) => s.sourceId);
  const canUndo = useShow((s) => s.past.length > 0);
  const canRedo = useShow((s) => s.future.length > 0);
  const toast = useShow((s) => s.toast);
  const { setMacro, save, saveAs, undo, redo, exportCurrent, edit } = useShow.getState();
  const [naming, setNaming] = useState<null | 'preset' | 'template'>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const original = useRef<{ id: string | null; values: number[] }>({ id: null, values: [] });
  if (original.current.id !== sourceId) original.current = { id: sourceId, values: doc.macros.map((m) => m.value) };

  return (
    <div className="relative flex h-[88px] shrink-0 items-stretch gap-3 border-t border-ink-700 bg-ink-900 px-3">
      <div className="flex w-56 shrink-0 flex-col justify-center gap-1.5">
        <div className="truncate text-[13px] font-semibold text-ink-100" title={doc.description}>
          {doc.name}
          {dirty && <span className="text-warn" title="Unsaved changes"> •</span>}
        </div>
        <div className="truncate text-[10px] text-ink-400">
          {doc.isTemplate ? 'Template' : doc.category} · {sourceId?.startsWith('user') ? 'user' : sourceId ? 'built-in' : 'unsaved'}
        </div>
        {naming ? (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void saveAs(name.trim(), naming === 'template');
              setNaming(null);
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
              placeholder={naming === 'template' ? 'Template name' : 'Preset name'}
              className="min-w-0 flex-1 rounded border border-accent-2 bg-ink-800 px-1.5 text-[12px] text-ink-100 outline-none"
            />
          </form>
        ) : (
          <div className="flex gap-1">
            <Button tone="accent" title="Save (Ctrl+S). Built-ins save as a user copy." onClick={() => void save()}>
              Save
            </Button>
            <Button
              title="Save as a new preset"
              onClick={() => {
                setName(`${doc.name} 2`);
                setNaming('preset');
              }}
            >
              Save as
            </Button>
            <Button
              title="Save as Template: keeps layers and routing, clears colours"
              onClick={() => {
                setName(`${doc.name} template`);
                setNaming('template');
              }}
            >
              Template
            </Button>
            <Button title="Export .json" onClick={() => void exportCurrent()}>
              ⤓
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center gap-2">
        {doc.macros.map((m, i) => (
          <div
            key={i}
            className="flex w-[72px] flex-col items-center"
            onContextMenu={contextMenu(() => [
              { label: 'Edit targets…', onSelect: () => setEditing(i) },
              { label: 'Reset to preset value', onSelect: () => setMacro(i, original.current.values[i] ?? 0.5) },
              { label: 'Clear all targets', disabled: !m.targets.length, onSelect: () => edit((d) => void (d.macros[i].targets = [])) },
            ])}
            title={m.targets.length ? m.targets.map((t) => targetLabel(t.path)).join('\n') : 'Right-click a parameter → Assign to macro'}
          >
            <Knob value={m.value} active={m.targets.length > 0} onChange={(v) => setMacro(i, v)} onReset={() => setMacro(i, original.current.values[i] ?? 0.5)} />
            <button type="button" onClick={() => setEditing(editing === i ? null : i)} className={`max-w-full truncate text-[10px] ${m.targets.length ? 'text-ink-200' : 'text-ink-500'}`}>
              <span className="font-mono text-ink-500">{i + 1}</span> {m.name || '—'}
            </button>
            <span className="font-mono text-[9px] text-ink-500">{Math.round(m.value * 100)}</span>
          </div>
        ))}
      </div>

      <LaunchControls />

      <div className="flex w-20 shrink-0 flex-col justify-center gap-1">
        <Button onClick={undo} title="Undo (Ctrl+Z)" className={canUndo ? '' : 'opacity-40'}>
          ↶ Undo
        </Button>
        <Button onClick={redo} title="Redo (Ctrl+Shift+Z)" className={canRedo ? '' : 'opacity-40'}>
          ↷ Redo
        </Button>
      </div>

      {editing !== null && <MacroEditor index={editing} macro={doc.macros[editing]} onClose={() => setEditing(null)} />}
      {toast && <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1 text-[11px] text-ink-100 shadow-lg">{toast}</div>}
    </div>
  );
}

/** Launch quantize, shuffle and auto-shuffle, plus the queued-launch countdown. */
function LaunchControls() {
  useTicker(12);
  const lib = useControl((s) => s.settings.library);
  const update = useControl((s) => s.update);
  const queued = useShow((s) => s.queued);
  const cancel = useShow((s) => s.cancelQueued);
  const [open, setOpen] = useState(false);
  const beatsLeft = queued ? Math.max(0, queued.atBeat - engine.builder.frame.beat) : 0;
  const q: Array<[LaunchQuantize, string]> = [
    ['now', 'Now'],
    ['beat', 'Beat'],
    ['bar', 'Bar'],
    ['phrase', 'Phr'],
  ];
  const rhythm = lib.autoMode === 'drops' ? 'drops' : lib.autoMode === 'phrases' ? `${lib.autoPhrases} phr` : `${lib.shuffleBars} bars`;
  return (
    <div className="relative flex w-[196px] shrink-0 flex-col justify-center gap-1">
      <div className="flex rounded border border-ink-600 bg-ink-850 p-0.5" title="When a picked preset goes live">
        {q.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => update({ library: { quantize: v } })}
            className={`flex-1 rounded-sm px-1 py-0.5 text-[10px] ${lib.quantize === v ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <Button onClick={shuffleNow} title={`Shuffle (S) from ${poolLabel()}`} className="flex-1">
          ⤮ Shuffle
        </Button>
        <Button active={lib.autoShuffle} onClick={toggleAuto} title={`Auto-play (A): changes looks every ${rhythm}`}>
          Auto · {rhythm}
        </Button>
        <Button active={open} onClick={() => setOpen(!open)} title="Auto-play, pool and transition settings">
          ⚙
        </Button>
      </div>
      <div className="flex h-4 items-center gap-1 text-[10px]">
        {queued ? (
          <>
            <span className="truncate text-accent-2">
              Next: {queued.entry.preset.name} in {beatsLeft.toFixed(1)} beats
            </span>
            <button type="button" onClick={cancel} className="text-ink-400 hover:text-bad" title="Cancel (Esc)">
              ✕
            </button>
          </>
        ) : (
          <button type="button" className="truncate text-ink-500 hover:text-ink-300" onClick={() => setOpen(true)} title="Shuffle pool">
            Pool: {poolLabel()}
          </button>
        )}
      </div>
      {open && <AutoPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

const TRANSITIONS: Array<[TransitionType, string]> = [
  ['cut', 'Cut'],
  ['crossfade', 'Crossfade'],
  ['flashBlack', 'Dip to black'],
  ['flashWhite', 'White flash'],
  ['lumaWipe', 'Luma wipe'],
  ['zoomThrough', 'Zoom through'],
  ['glitchCut', 'Glitch cut'],
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

const sel = 'rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100';

function AutoPanel({ onClose }: { onClose: () => void }) {
  const lib = useControl((s) => s.settings.library);
  const update = useControl((s) => s.update);
  const set = (patch: Partial<typeof lib>): void => update({ library: patch });
  return (
    <div className="absolute right-0 bottom-[86px] z-40 w-[300px] space-y-2 rounded-md border border-ink-600 bg-ink-850 p-3 shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-ink-300 uppercase">Auto-play</span>
        <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-100">
          ✕
        </button>
      </div>
      <Row label="Pick from">
        <select className={sel} value={lib.shufflePool} onChange={(e) => set({ shufflePool: e.target.value as ShufflePool })}>
          <option value="favorites">★ Favorites</option>
          <option value="all">All presets</option>
          <option value="category">Same category as now</option>
          <option value="view">What the Library shows</option>
          <optgroup label="Playlists">
            {PLAYLISTS.map((pl) => (
              <option key={pl.id} value={`playlist:${pl.id}`}>
                ▶ {pl.name}
              </option>
            ))}
          </optgroup>
          {lib.pools.map((p) => (
            <option key={p.id} value={`pool:${p.id}`}>
              ● {p.name} ({p.ids.length})
            </option>
          ))}
        </select>
      </Row>
      <div className="-mt-1 text-right text-[10px] text-ink-500">{poolLabel()}</div>
      <Row label="Change">
        <span className="flex gap-1">
          <select className={sel} value={lib.autoMode} onChange={(e) => set({ autoMode: e.target.value as typeof lib.autoMode })}>
            <option value="bars">every N bars</option>
            <option value="phrases">every N phrases</option>
            <option value="drops">on drops</option>
          </select>
          {lib.autoMode === 'bars' && (
            <select className={sel} value={lib.shuffleBars} onChange={(e) => set({ shuffleBars: Number(e.target.value) })}>
              {[4, 8, 16, 32, 64].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          {lib.autoMode === 'phrases' && (
            <select className={sel} value={lib.autoPhrases} onChange={(e) => set({ autoPhrases: Number(e.target.value) })}>
              {[1, 2, 4, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </span>
      </Row>
      {lib.autoMode !== 'drops' && <Toggle label="Also change on every drop" checked={lib.alsoOnDrop} onChange={(alsoOnDrop) => set({ alsoOnDrop })} />}
      <Toggle label="Match the music's energy" hint="Calm looks in breakdowns, high-energy looks at the peak (uses each preset's energy rating)" checked={lib.energyMatch} onChange={(energyMatch) => set({ energyMatch })} />
      <Row label="Order">
        <Segmented
          value={lib.order}
          onChange={(order) => set({ order })}
          options={[
            { value: 'random', label: 'Random' },
            { value: 'sequence', label: 'In order' },
          ]}
        />
      </Row>
      <Row label="Don't repeat the last">
        <select className={sel} value={lib.noRepeat} onChange={(e) => set({ noRepeat: Number(e.target.value) })}>
          {[0, 2, 4, 8, 16].map((n) => (
            <option key={n} value={n}>
              {n} looks
            </option>
          ))}
        </select>
      </Row>
      <Row label="Transition">
        <span className="flex gap-1">
          <select className={sel} value={lib.transition.type} onChange={(e) => set({ transition: { ...lib.transition, type: e.target.value as TransitionType } })}>
            {TRANSITIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {lib.transition.type !== 'cut' && (
            <select className={sel} value={lib.transition.beats} onChange={(e) => set({ transition: { ...lib.transition, beats: Number(e.target.value) } })}>
              {[0.5, 1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'beat' : 'beats'}
                </option>
              ))}
            </select>
          )}
        </span>
      </Row>
      <div className="text-[10px] leading-snug text-ink-500">Build named pools in the Library: right-click a look → Add to pool. Keys: S shuffle · A auto-play · Esc cancel the next look.</div>
    </div>
  );
}

function MacroEditor({ index, macro, onClose }: { index: number; macro: Macro; onClose: () => void }) {
  const edit = useShow((s) => s.edit);
  return (
    <div className="absolute bottom-[92px] left-1/2 z-40 w-[440px] -translate-x-1/2 rounded-md border border-ink-600 bg-ink-850 p-3 shadow-2xl">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-ink-500">{index + 1}</span>
        <input
          value={macro.name}
          placeholder="Macro name"
          onChange={(e) => edit((d) => void (d.macros[index].name = e.target.value.slice(0, 24)), `macro:name:${index}`)}
          className="flex-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[12px] text-ink-100 outline-none focus:border-accent-2"
        />
        <Button onClick={onClose}>Done</Button>
      </div>
      {macro.targets.length === 0 && <p className="text-[11px] text-ink-400">No targets yet. Right-click any parameter in the inspector → Assign to macro {index + 1}.</p>}
      <div className="space-y-1">
        {macro.targets.map((t, ti) => (
          <div key={ti} className="grid grid-cols-[1fr_64px_64px_20px] items-center gap-2">
            <span className="truncate text-[11px] text-ink-300" title={t.path}>
              {targetLabel(t.path)}
            </span>
            {[0, 1].map((k) => (
              <input
                key={k}
                type="number"
                step="any"
                value={Number(t.range[k].toFixed(4))}
                title={k ? 'Value at 100%' : 'Value at 0%'}
                onChange={(e) => edit((d) => void (d.macros[index].targets[ti].range[k] = Number(e.target.value)), `macro:range:${index}:${ti}:${k}`)}
                className="rounded border border-ink-600 bg-ink-800 px-1 text-[11px] text-ink-100 outline-none"
              />
            ))}
            <button type="button" className="text-ink-400 hover:text-bad" onClick={() => edit((d) => void d.macros[index].targets.splice(ti, 1))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
