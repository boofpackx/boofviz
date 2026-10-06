import { create } from 'zustand';
import { MAX_LAYERS, type Layer, type Preset, type Scene } from '@shared/types/engine';
import { BUILTIN_PRESETS, BUILTIN_TEMPLATES, DEFAULT_PRESET_ID, userId, type PresetEntry } from '@/engine/library';
import { newLayerId, normalizePreset, sceneOf, serializePreset, slugify, toTemplate } from '@/engine/presetIO';
import { defaultParams, effectDef, generatorDef } from '@/engine/registry';

const HISTORY_LIMIT = 120;

interface ShowState {
  /** The working look (what is live in preview and output). */
  doc: Preset;
  /** Library entry the doc was loaded from (null for imported / unsaved). */
  sourceId: string | null;
  dirty: boolean;
  past: Preset[];
  future: Preset[];
  selectedLayer: number;
  userPresets: PresetEntry[];
  toast: string | null;
  /** A preset waiting to go live on a beat / bar / phrase boundary. */
  queued: { entry: PresetEntry; atBeat: number } | null;

  load(entry: PresetEntry): void;
  /** Go live now, or queue for `atBeat` (both windows switch on that beat). */
  launch(entry: PresetEntry, atBeat?: number): void;
  cancelQueued(): void;
  /** Undoable edit. Consecutive edits sharing a `coalesce` key within one gesture (one drag) merge into one undo step. */
  edit(fn: (draft: Preset) => void, coalesce?: string): void;
  undo(): void;
  redo(): void;
  selectLayer(i: number): void;
  addLayer(kind: string): void;
  removeLayer(i: number): void;
  moveLayer(i: number, dir: -1 | 1): void;
  setMacro(i: number, v: number): void;

  refreshUser(): Promise<void>;
  save(): Promise<void>;
  saveAs(name: string, template?: boolean): Promise<void>;
  deleteUser(entry: PresetEntry): Promise<void>;
  importFiles(jsons: string[]): Promise<number>;
  exportCurrent(): Promise<void>;
  restoreSession(): Promise<void>;
  notify(msg: string): void;
}

let lastCoalesce = '';
let toastTimer = 0;

// A new pointer press or key press starts a new gesture, so the next edit is its own undo step.
if (typeof window !== 'undefined') {
  const breakGesture = (): void => void (lastCoalesce = '');
  window.addEventListener('pointerdown', breakGesture, true);
  window.addEventListener('keydown', breakGesture, true);
}

function entryFor(id: string | null, user: PresetEntry[]): PresetEntry | undefined {
  return [...user, ...BUILTIN_PRESETS, ...BUILTIN_TEMPLATES].find((e) => e.id === id);
}

export const useShow = create<ShowState>((set, get) => ({
  doc: (BUILTIN_PRESETS.find((e) => e.id === DEFAULT_PRESET_ID) ?? BUILTIN_PRESETS[0]).preset,
  sourceId: DEFAULT_PRESET_ID,
  dirty: false,
  past: [],
  future: [],
  selectedLayer: 0,
  userPresets: [],
  toast: null,
  queued: null,

  load: (entry) => {
    const { doc, past } = get();
    lastCoalesce = '';
    set({
      doc: structuredClone(entry.preset),
      sourceId: entry.id,
      dirty: false,
      // Loading is undoable too: undo returns to the previous look.
      past: [...past, doc].slice(-HISTORY_LIMIT),
      future: [],
      selectedLayer: Math.max(0, entry.preset.layers.length - 1),
    });
  },

  launch: (entry, atBeat) => {
    if (atBeat === undefined) {
      set({ queued: null });
      get().load(entry);
    } else set({ queued: { entry, atBeat } });
  },

  cancelQueued: () => set({ queued: null }),

  edit: (fn, coalesce) => {
    const { doc, past } = get();
    const draft = structuredClone(doc);
    fn(draft);
    const next = normalizePreset(draft);
    const merge = !!coalesce && coalesce === lastCoalesce;
    lastCoalesce = coalesce ?? '';
    set({ doc: next, dirty: true, past: merge ? past : [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },

  undo: () => {
    const { past, doc, future } = get();
    if (!past.length) return;
    lastCoalesce = '';
    const prev = past[past.length - 1];
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY_LIMIT), dirty: true, selectedLayer: Math.min(get().selectedLayer, prev.layers.length - 1) });
  },

  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    lastCoalesce = '';
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), dirty: true });
  },

  selectLayer: (i) => set({ selectedLayer: i }),

  addLayer: (kind) => {
    if (get().doc.layers.length >= MAX_LAYERS) return get().notify(`A scene holds up to ${MAX_LAYERS} layers`);
    get().edit((d) => {
      const layer: Layer = {
        id: newLayerId(d.layers),
        name: generatorDef(kind)?.label ?? kind,
        enabled: true,
        source: { type: 'generator', kind, params: defaultParams(generatorDef(kind)) },
        fx: [],
        blend: d.layers.length ? 'screen' : 'normal',
        opacity: 1,
        modulators: [],
      };
      d.layers.push(layer);
    });
    set({ selectedLayer: get().doc.layers.length - 1 });
  },

  removeLayer: (i) => {
    get().edit((d) => {
      d.layers.splice(i, 1);
      // Re-point macro targets past the removed layer; drop the ones on it.
      for (const m of d.macros) {
        m.targets = m.targets
          .filter((t) => !t.path.startsWith(`layers.${i}.`))
          .map((t) => {
            const m2 = /^layers\.(\d+)\.(.*)$/.exec(t.path);
            return m2 && Number(m2[1]) > i ? { ...t, path: `layers.${Number(m2[1]) - 1}.${m2[2]}` } : t;
          });
      }
    });
    set({ selectedLayer: Math.max(0, Math.min(i, get().doc.layers.length - 1)) });
  },

  moveLayer: (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= get().doc.layers.length) return;
    get().edit((d) => {
      [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
      for (const m of d.macros) {
        m.targets = m.targets.map((t) => {
          const m2 = /^layers\.(\d+)\.(.*)$/.exec(t.path);
          if (!m2) return t;
          const k = Number(m2[1]);
          return { ...t, path: `layers.${k === i ? j : k === j ? i : k}.${m2[2]}` };
        });
      }
    });
    set({ selectedLayer: j });
  },

  setMacro: (i, v) => get().edit((d) => void (d.macros[i].value = Math.min(1, Math.max(0, v))), `macro:${i}`),

  refreshUser: async () => {
    const stored = await window.boofviz.listUserPresets();
    const user: PresetEntry[] = [];
    for (const s of stored) {
      try {
        const preset = normalizePreset(JSON.parse(s.json));
        if (s.template) preset.isTemplate = true;
        user.push({ id: `${s.template ? 'user-template' : 'user'}:${s.file}`, source: 'user', preset });
      } catch {
        /* skip unreadable */
      }
    }
    user.sort((a, b) => a.preset.name.localeCompare(b.preset.name));
    set({ userPresets: user });
  },

  save: async () => {
    const { doc, sourceId } = get();
    // Built-ins are read-only: saving one writes a user copy with the same name.
    if (sourceId?.startsWith('user')) {
      const slug = sourceId.split(':')[1];
      await window.boofviz.saveUserPreset(slug, serializePreset(doc), !!doc.isTemplate);
      await get().refreshUser();
      set({ dirty: false });
      get().notify(`Saved “${doc.name}”`);
    } else await get().saveAs(doc.name, !!doc.isTemplate);
  },

  saveAs: async (name, template = false) => {
    const base = get().doc;
    const preset = template ? toTemplate(base, name) : { ...structuredClone(base), name, isTemplate: undefined };
    if (!template) delete preset.isTemplate;
    const normalized = normalizePreset(preset);
    await window.boofviz.saveUserPreset(slugify(name), serializePreset(normalized), template);
    await get().refreshUser();
    if (template) get().notify(`Saved template “${name}”`);
    else {
      set({ doc: normalized, sourceId: userId(normalized), dirty: false });
      get().notify(`Saved “${name}”`);
    }
  },

  deleteUser: async (entry) => {
    if (entry.source !== 'user') return;
    await window.boofviz.deleteUserPreset(entry.id.split(':')[1], !!entry.preset.isTemplate);
    await get().refreshUser();
    if (get().sourceId === entry.id) set({ sourceId: null, dirty: true });
    get().notify(`Deleted “${entry.preset.name}”`);
  },

  importFiles: async (jsons) => {
    let first: Preset | null = null;
    let n = 0;
    for (const json of jsons) {
      try {
        const p = normalizePreset(JSON.parse(json));
        await window.boofviz.saveUserPreset(slugify(p.name), serializePreset(p), !!p.isTemplate);
        first ??= p;
        n++;
      } catch {
        /* not a preset */
      }
    }
    await get().refreshUser();
    if (first) {
      const entry = entryFor(userId(first), get().userPresets);
      if (entry) get().load(entry);
    }
    get().notify(n ? `Imported ${n} preset${n > 1 ? 's' : ''}` : 'No valid presets found');
    return n;
  },

  exportCurrent: async () => {
    const { doc } = get();
    if (await window.boofviz.exportPreset(slugify(doc.name), serializePreset(doc))) get().notify(`Exported “${doc.name}”`);
  },

  restoreSession: async () => {
    await get().refreshUser();
    const raw = await window.boofviz.readSession();
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as { doc: unknown; sourceId: string | null; dirty: boolean };
      set({ doc: normalizePreset(s.doc), sourceId: s.sourceId ?? null, dirty: !!s.dirty, selectedLayer: 0 });
    } catch {
      /* corrupt session: keep the default look */
    }
  },

  notify: (msg) => {
    window.clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
  },
}));

export function currentScene(): Scene {
  return sceneOf(useShow.getState().doc);
}

export function libraryEntries(): { presets: PresetEntry[]; templates: PresetEntry[] } {
  const user = useShow.getState().userPresets;
  return {
    presets: [...user.filter((e) => !e.preset.isTemplate), ...BUILTIN_PRESETS],
    templates: [...user.filter((e) => e.preset.isTemplate), ...BUILTIN_TEMPLATES],
  };
}

/** Defaults for a newly added effect. */
export function newEffect(kind: string) {
  return { type: kind, enabled: true, params: defaultParams(effectDef(kind)) };
}
