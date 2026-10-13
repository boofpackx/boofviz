import { useEffect, useState, type ReactNode } from 'react';
import { PRESET_CATEGORIES, type Layer, type ParamBag, type Preset } from '@shared/types/engine';
import { BUILTIN_TREATMENTS, type LyricTreatment } from '@shared/lyricRouter';
import { defaultParams, effectDef, generatorDef } from '@/engine/registry';
import { normalizePreset } from '@/engine/presetIO';
import { PALETTES, PALETTE_NAMES } from '@/engine/palettes';
import { useShow } from '../show';
import { useControl } from '../store';
import { Button, Section, Slider } from './ui';

/**
 * Create: build a visual from scratch in five steps (background, main element,
 * words, effects, colours). Hovering a card tries it in the preview only;
 * clicking puts it in the look. Everything is undoable, and Save keeps it in
 * the library like any other look.
 */

type Role = 'bg' | 'main' | 'words' | 'fx';

const BACKGROUNDS = ['background', 'warp', 'synthSunset', 'glassMeadow', 'opArt', 'dots', 'memphis', 'tiles', 'codeRain', 'liquidChrome', 'orb', 'prism', 'lines', 'deStijl', 'swissGrid', 'spectrogram', 'concrete', 'lostScene', 'archiveFootage', 'clipEngine'];
const MAINS = ['spectrumBars', 'radialSpectrum', 'barCity', 'scope', 'polygon', 'twistCube', 'ricochet', 'pipes', 'screensaver90', 'pixelArcade', 'demoParts', 'platinumStage', 'lowPoly', 'orb', 'prism', 'lines'];
const EFFECT_PICKS = ['bloom', 'feedback', 'kaleidoscope', 'mirror', 'rgbSplit', 'vhs', 'crt', 'filmStock', 'halftone', 'grain', 'vignette', 'ledScreen', 'popGrid', 'retroPalette', 'digitalRot', 'tvSet', 'tapeStack', 'print2', 'gradientMap', 'grade'];
const WORD_KINDS = new Set(['lyrics', 'lyricVideo', 'kineticType', 'stepChart', 'hotMetal', 'keyframes']);
/** Looks that draw a whole scene unless told to draw only their words over another. */
const OVERLAY_KINDS = new Set(['stepChart', 'hotMetal', 'keyframes']);
const SKIP_PARAMS = new Set(['lead', 'lineBeats', 'seed', 'size']);

/** Where a role lives in a look: by id in looks made here, by kind or place in others. */
function roleIndex(d: Preset, role: Role): number {
  const byId = d.layers.findIndex((l) => l.id === role);
  if (byId >= 0) return byId;
  if (role === 'fx') return d.layers.findIndex((l) => l.source.kind === 'adjust');
  if (role === 'words') return d.layers.findIndex((l) => WORD_KINDS.has(l.source.kind));
  const plain = d.layers.map((l, i) => ({ l, i })).filter(({ l }) => !WORD_KINDS.has(l.source.kind) && l.source.kind !== 'adjust');
  return (role === 'bg' ? plain[0]?.i : plain[1]?.i) ?? -1;
}

function makeLayer(id: Role, kind: string, params: ParamBag = {}): Layer {
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
function applyRole(d: Preset, role: Role, kind: string | null, params?: ParamBag): void {
  const i = roleIndex(d, role);
  if (kind === null) {
    if (i >= 0) d.layers.splice(i, 1);
    return;
  }
  if (i >= 0) {
    const old = d.layers[i];
    d.layers[i] = { ...makeLayer(role, kind, params), id: old.id, opacity: old.opacity, blend: role === 'bg' && i === 0 ? 'normal' : old.blend, fx: old.fx };
    return;
  }
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

function toggleEffect(d: Preset, type: string): void {
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
}

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const blurb = (kind: string): string => (generatorDef(kind)?.description ?? '').split(/[:.]/)[0].slice(0, 70);

export function CreatePanel() {
  const doc = useShow((s) => s.doc);
  const edit = useShow((s) => s.edit);
  const set = useControl((s) => s.set);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<string>('');
  // Leaving the tab never leaves a tried change in the preview.
  useEffect(() => () => set({ previewDoc: null }), [set]);

  // Hover tries a change in the preview (never on the screen); click commits it.
  const tryIt = (fn: ((d: Preset) => void) | null): void => {
    if (!fn) return set({ previewDoc: null });
    const d = structuredClone(useShow.getState().doc);
    fn(d);
    set({ previewDoc: normalizePreset(d) });
  };
  const commit = (fn: (d: Preset) => void, coalesce?: string): void => {
    set({ previewDoc: null });
    edit(fn, coalesce);
  };

  const fresh = (): void => {
    commit((d) => {
      d.name = 'My visual';
      d.description = '';
      d.tags = ['mine'];
      d.energy = 3;
      d.palette = 'Neon';
      d.customPalettes = undefined;
      d.paletteCycle = { ...d.paletteCycle, mode: 'off' };
      d.hueRotate = { ...d.hueRotate, mode: 'off' };
      d.macros = [];
      d.camera = undefined;
      d.layers = [makeLayer('bg', 'background')];
    });
    useShow.setState({ sourceId: null, selectedLayer: 0 });
    setName('');
  };
  const surprise = (): void =>
    commit((d) => {
      applyRole(d, 'bg', pick(BACKGROUNDS.filter((k) => k !== 'archiveFootage' && k !== 'clipEngine')));
      applyRole(d, 'main', pick(MAINS));
      d.palette = pick(PALETTE_NAMES);
      const fx = roleIndex(d, 'fx');
      if (fx >= 0) d.layers.splice(fx, 1);
      for (const t of [pick(EFFECT_PICKS), Math.random() > 0.5 ? pick(EFFECT_PICKS) : null]) if (t && !d.layers.some((l) => l.fx.some((f) => f.type === t))) toggleEffect(d, t);
    });

  const bgIdx = roleIndex(doc, 'bg');
  const mainIdx = roleIndex(doc, 'main');
  const wordsIdx = roleIndex(doc, 'words');
  const fxIdx = roleIndex(doc, 'fx');
  const kindAt = (i: number): string | null => (i >= 0 ? doc.layers[i].source.kind : null);
  const activeFx = new Set(fxIdx >= 0 ? doc.layers[fxIdx].fx.map((f) => f.type) : []);
  const words = BUILTIN_TREATMENTS.filter((t) => t.family !== 'Yours');
  const wordsChoice = wordsIdx >= 0 ? words.find((t) => t.params.kind === kindAt(wordsIdx) && Object.entries(t.params).every(([k, v]) => k === 'kind' || doc.layers[wordsIdx].source.params[k] === v))?.id : 'none';

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Make a visual" right={<span className="text-[10px] text-ink-400">{doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}</span>}>
        <p className="text-[11px] leading-snug text-ink-400">Build it in five steps. Hover a card to try it in the preview (never on the screen), click to use it. Ctrl+Z undoes anything.</p>
        <div className="flex flex-wrap gap-1">
          <Button tone="accent" onClick={fresh} title="Start an empty visual (the look you had is one undo away)">
            Start from scratch
          </Button>
          <Button onClick={surprise} title="A random background, main element, colours and effects">
            Surprise me
          </Button>
          <Button onClick={() => useShow.getState().undo()}>Undo</Button>
        </div>
      </Section>

      <Step n={1} title="Background" note={kindAt(bgIdx) ? generatorDef(kindAt(bgIdx)!)?.label : 'none yet'}>
        <Cards
          items={BACKGROUNDS.filter((k) => generatorDef(k)).map((k) => ({ id: k, label: generatorDef(k)!.label, hint: blurb(k) }))}
          active={kindAt(bgIdx)}
          onTry={(k) => tryIt(k ? (d) => applyRole(d, 'bg', k) : null)}
          onPick={(k) => commit((d) => applyRole(d, 'bg', k))}
        />
        {bgIdx >= 0 && <Tweak index={bgIdx} role="bg" />}
      </Step>

      <Step n={2} title="Main element" note={kindAt(mainIdx) ? generatorDef(kindAt(mainIdx)!)?.label : 'optional'}>
        <Cards
          items={[{ id: '', label: 'None', hint: 'just the background' }, ...MAINS.filter((k) => generatorDef(k)).map((k) => ({ id: k, label: generatorDef(k)!.label, hint: blurb(k) }))]}
          active={kindAt(mainIdx) ?? ''}
          onTry={(k) => tryIt(k === null ? null : (d) => applyRole(d, 'main', k || null))}
          onPick={(k) => commit((d) => applyRole(d, 'main', k || null))}
        />
        {mainIdx >= 0 && <Tweak index={mainIdx} role="main" />}
      </Step>

      <Step n={3} title="Words" note={wordsChoice === 'none' ? 'none' : (words.find((t) => t.id === wordsChoice)?.name ?? 'custom')}>
        <Cards
          items={[{ id: 'none', label: 'No words', hint: '' }, ...words.map((t: LyricTreatment) => ({ id: t.id, label: t.name, hint: t.family }))]}
          active={wordsChoice ?? null}
          onTry={(id) => {
            const t = words.find((x) => x.id === id);
            tryIt(id === null ? null : (d) => applyRole(d, 'words', t ? String(t.params.kind) : null, t ? { ...t.params, source: 'lyrics' } : undefined));
          }}
          onPick={(id) => {
            const t = words.find((x) => x.id === id);
            commit((d) => applyRole(d, 'words', t ? String(t.params.kind) : null, t ? { ...t.params, source: 'lyrics' } : undefined));
          }}
        />
        <p className="text-[10px] text-ink-400">The words are the song's lyrics (or its name when there are none).</p>
        {wordsIdx >= 0 && <Tweak index={wordsIdx} role="words" />}
      </Step>

      <Step n={4} title="Effects" note={activeFx.size ? `${activeFx.size} on` : 'none'}>
        <div className="flex flex-wrap gap-1" onMouseLeave={() => tryIt(null)}>
          {EFFECT_PICKS.filter((t) => effectDef(t)).map((t) => (
            <button
              key={t}
              type="button"
              title={effectDef(t)!.description}
              onMouseEnter={() => tryIt((d) => toggleEffect(d, t))}
              onClick={() => commit((d) => toggleEffect(d, t))}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${activeFx.has(t) ? 'border-accent bg-accent/20 text-ink-100' : 'border-ink-600 text-ink-300 hover:border-ink-400'}`}
            >
              {activeFx.has(t) ? '✓ ' : ''}
              {effectDef(t)!.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-ink-400">Effects treat the whole picture. Click again to take one off.</p>
      </Step>

      <Step n={5} title="Colours" note={doc.palette}>
        <div className="grid grid-cols-2 gap-1" onMouseLeave={() => tryIt(null)}>
          {PALETTE_NAMES.map((p) => (
            <button
              key={p}
              type="button"
              onMouseEnter={() => tryIt((d) => void (d.palette = p))}
              onClick={() => commit((d) => void (d.palette = p))}
              className={`rounded border p-1 text-left ${doc.palette === p ? 'border-accent bg-accent/10' : 'border-ink-700 hover:border-ink-400'}`}
            >
              <div className="flex h-3 overflow-hidden rounded-sm">
                {PALETTES[p].map((c, i) => (
                  <span key={i} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-ink-300">{p}</div>
            </button>
          ))}
        </div>
      </Step>

      <Section title="Save it">
        <input
          className="w-full rounded border border-ink-600 bg-ink-850 px-1.5 py-1 text-[12px] text-ink-100 placeholder:text-ink-500"
          placeholder={doc.name || 'Name your visual'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
          <span>Theme</span>
          <select className="rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100" value={theme || doc.category} onChange={(e) => setTheme(e.target.value)}>
            {PRESET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <Button
          tone="accent"
          onClick={() => {
            const n = (name || doc.name || 'My visual').trim();
            if (theme && theme !== doc.category) edit((d) => void (d.category = theme as Preset['category']));
            void useShow.getState().saveAs(n);
          }}
          title="Saves it to your looks in the Library (in its theme)"
        >
          Save to my looks
        </Button>
      </Section>
    </div>
  );
}

function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <Section title={`${n} · ${title}`} right={note ? <span className="max-w-[55%] truncate text-[10px] text-ink-300">{note}</span> : undefined}>
      {children}
    </Section>
  );
}

function Cards({ items, active, onTry, onPick }: { items: Array<{ id: string; label: string; hint: string }>; active: string | null; onTry: (id: string | null) => void; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, 8);
  return (
    <div onMouseLeave={() => onTry(null)}>
      <div className="grid grid-cols-2 gap-1">
        {shown.map((it) => (
          <button
            key={it.id}
            type="button"
            title={it.hint}
            onMouseEnter={() => onTry(it.id)}
            onFocus={() => onTry(it.id)}
            onClick={() => onPick(it.id)}
            className={`flex h-11 flex-col justify-center overflow-hidden rounded border px-1.5 text-left transition-colors ${active === it.id ? 'border-accent bg-accent/10' : 'border-ink-700 bg-ink-900 hover:border-ink-400'}`}
          >
            <span className="truncate text-[11px] text-ink-100">{it.label}</span>
            {it.hint && <span className="truncate text-[9px] text-ink-400">{it.hint}</span>}
          </button>
        ))}
      </div>
      {items.length > 8 && (
        <button type="button" className="mt-1 text-[10px] text-ink-400 hover:text-ink-200" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** A few of the layer's own controls, plus how strongly it shows. */
function Tweak({ index, role }: { index: number; role: Role }) {
  const layer = useShow((s) => s.doc.layers[index]);
  const edit = useShow((s) => s.edit);
  const [open, setOpen] = useState(false);
  if (!layer) return null;
  const def = generatorDef(layer.source.kind);
  const specs = (def?.params ?? []).filter((p) => (p.type === 'float' || p.type === 'int') && !SKIP_PARAMS.has(p.key)).slice(0, 4);
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="rounded border border-ink-700 px-2 py-1">
      <summary className="cursor-pointer text-[11px] text-ink-300">Adjust</summary>
      <div className="mt-1 space-y-1.5">
        <Slider label={role === 'bg' ? 'Brightness' : 'Strength'} value={layer.opacity} min={0} max={1} defaultValue={1} onChange={(v) => edit((d) => void (d.layers[index].opacity = v), `create:${role}:opacity`)} />
        {specs.map((p) => (
          <Slider
            key={p.key}
            label={p.label}
            value={typeof layer.source.params[p.key] === 'number' ? (layer.source.params[p.key] as number) : Number(p.default)}
            min={p.min ?? 0}
            max={p.max ?? 1}
            step={p.step}
            defaultValue={Number(p.default)}
            onChange={(v) => edit((d) => void (d.layers[index].source.params[p.key] = v), `create:${role}:${p.key}`)}
          />
        ))}
        <Button
          onClick={() => {
            useShow.getState().selectLayer(index);
            useShow.getState().notify('Every setting for this layer is in the Layers panel on the right');
          }}
        >
          All settings…
        </Button>
      </div>
    </details>
  );
}
