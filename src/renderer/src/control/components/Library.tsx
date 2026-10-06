import { useMemo, useState } from 'react';
import type { PresetEntry } from '@/engine/library';
import { libraryEntries, useShow } from '../show';
import { contextMenu } from './ContextMenu';
import { Swatch } from './Inspector';
import { Button, Segmented } from './ui';

type Tab = 'presets' | 'templates';

/** Presets/templates visible under the current filters (also drives Tab = next preset). */
export function filteredEntries(tab: Tab, query: string, category: string, tag: string | null): PresetEntry[] {
  const { presets, templates } = libraryEntries();
  const q = query.trim().toLowerCase();
  return (tab === 'presets' ? presets : templates).filter((e) => {
    const p = e.preset;
    if (category !== 'All' && p.category !== category) return false;
    if (tag && !p.tags.includes(tag)) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q)) || p.category.toLowerCase().includes(q);
  });
}

export const libraryView = { tab: 'presets' as Tab, query: '', category: 'All', tag: null as string | null };

export function Library() {
  const [tab, setTab] = useState<Tab>(libraryView.tab);
  const [query, setQuery] = useState(libraryView.query);
  const [category, setCategory] = useState(libraryView.category);
  const [tag, setTag] = useState<string | null>(libraryView.tag);
  const [confirm, setConfirm] = useState<string | null>(null);
  const userPresets = useShow((s) => s.userPresets);
  const sourceId = useShow((s) => s.sourceId);
  const dirty = useShow((s) => s.dirty);
  const { load, deleteUser, importFiles } = useShow.getState();
  Object.assign(libraryView, { tab, query, category, tag });

  const entries = useMemo(() => filteredEntries(tab, query, category, tag), [tab, query, category, tag, userPresets]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = tab === 'presets' ? libraryEntries().presets : libraryEntries().templates;
  const categories = ['All', ...Array.from(new Set(all.map((e) => e.preset.category)))];
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of all) for (const t of e.preset.tags) if (t !== 'template' && t !== 'structure') counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);
  }, [all]);

  const groups = new Map<string, PresetEntry[]>();
  for (const e of entries) {
    const g = groups.get(e.preset.category) ?? [];
    g.push(e);
    groups.set(e.preset.category, g);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-ink-700/70 p-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'presets', label: `Presets · ${libraryEntries().presets.length}` },
            { value: 'templates', label: `Templates · ${libraryEntries().templates.length}` },
          ]}
        />
        <input
          type="search"
          placeholder="Search name, tag, category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[12px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-2"
        />
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded-full border px-2 py-0.5 text-[10px] ${category === c ? 'border-accent bg-accent/15 text-ink-100' : 'border-ink-600 text-ink-400 hover:text-ink-200'}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} className={`rounded px-1.5 py-0.5 text-[10px] ${tag === t ? 'bg-accent-2/25 text-accent-2' : 'bg-ink-800 text-ink-400 hover:text-ink-200'}`}>
              #{t}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 && <p className="p-3 text-center text-ink-400">Nothing matches.</p>}
        {[...groups.entries()].map(([cat, list]) => (
          <div key={cat} className="mb-3">
            <div className="px-1 pb-1 text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">{cat}</div>
            <div className="space-y-1">
              {list.map((e) => {
                const active = e.id === sourceId;
                const p = e.preset;
                return (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => load(e)}
                    onKeyDown={(ev) => ev.key === 'Enter' && load(e)}
                    onContextMenu={contextMenu(() => [
                      { label: 'Load', onSelect: () => load(e) },
                      { label: 'Delete', disabled: e.source !== 'user', hint: e.source !== 'user' ? 'built-in' : '', onSelect: () => setConfirm(e.id) },
                    ])}
                    title={p.description}
                    className={`group cursor-pointer rounded border px-2 py-1.5 transition-colors ${active ? 'border-accent/70 bg-accent/10' : 'border-ink-700 bg-ink-850 hover:border-ink-500'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Swatch name={p.palette} custom={p.customPalettes} />
                      <span className="min-w-0 flex-1 truncate text-ink-100">
                        {p.name}
                        {active && dirty && <span className="text-warn"> •</span>}
                      </span>
                      {e.source === 'user' && <span className="rounded bg-accent-2/20 px-1 text-[9px] font-semibold text-accent-2">USER</span>}
                      <span className="flex gap-0.5" title={`Energy ${p.energy}/5`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= p.energy ? 'bg-accent' : 'bg-ink-600'}`} />
                        ))}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate pl-[42px] text-[10px] text-ink-400">
                      {p.layers.length} layer{p.layers.length > 1 ? 's' : ''}
                      {p.bpmHint && ` · ${p.bpmHint[0]}–${p.bpmHint[1]} bpm`}
                      {p.tags.length > 0 && ` · ${p.tags.slice(0, 3).join(', ')}`}
                    </div>
                    {confirm === e.id && (
                      <div className="mt-1 flex items-center gap-2 pl-[42px]" onClick={(ev) => ev.stopPropagation()}>
                        <span className="text-[11px] text-bad">Delete this preset file?</span>
                        <Button
                          tone="danger"
                          onClick={() => {
                            setConfirm(null);
                            void deleteUser(e);
                          }}
                        >
                          Delete
                        </Button>
                        <Button onClick={() => setConfirm(null)}>Keep</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-t border-ink-700/70 p-2">
        <Button onClick={() => void window.boofviz.importPresets().then((jsons) => jsons.length && importFiles(jsons))} title="Import preset .json files (or drop them on the window)">
          Import…
        </Button>
        <Button onClick={() => void window.boofviz.openPresetFolder()} title="Open %APPDATA%/BOOFVIZ/presets">
          Open folder
        </Button>
      </div>
    </div>
  );
}
