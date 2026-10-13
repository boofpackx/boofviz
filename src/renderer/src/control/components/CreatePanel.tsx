import { useEffect, useState, type ReactNode } from 'react';
import { PRESET_CATEGORIES, type Preset } from '@shared/types/engine';
import { BUILTIN_TREATMENTS } from '@shared/lyricRouter';
import { effectDef, generatorDef } from '@/engine/registry';
import { normalizePreset } from '@/engine/presetIO';
import { PALETTES, PALETTE_NAMES } from '@/engine/palettes';
import { useShow } from '../show';
import { useControl } from '../store';
import { BACKGROUNDS, EFFECT_PICKS, FEEL, MAINS, REACTIONS, applyRole, makeLayer, reactionOf, rebuildFeel, roleIndex, setReaction, toggleEffect, type ReactionId, type Role } from '../createKit';
import { Button, Section, Slider } from './ui';

/**
 * Create: build a visual from scratch in six steps (background, main element,
 * words, effects, colours, feel). Picture cards show each choice; hovering one
 * tries it in the preview only, clicking puts it in the look. Every step can
 * be re-rolled (dice) or kept (lock) when Surprise me rolls the rest.
 */

const thumbs = import.meta.glob('../thumbs/*.jpg', { eager: true, import: 'default' }) as Record<string, string>;
const thumb = (name: string): string | undefined => thumbs[`../thumbs/${name}.jpg`];

const SKIP_PARAMS = new Set(['lead', 'lineBeats', 'seed', 'size']);
const WORDS = BUILTIN_TREATMENTS.filter((t) => t.family !== 'Yours');
type Step = 'bg' | 'main' | 'words' | 'fx' | 'colours';

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const blurb = (kind: string): string => (generatorDef(kind)?.description ?? '').split(/[:.]/)[0].slice(0, 70);

/** One step's worth of randomness, applied to a draft. */
function roll(d: Preset, step: Step): void {
  if (step === 'bg') applyRole(d, 'bg', pick(BACKGROUNDS.filter((k) => k !== 'archiveFootage' && k !== 'clipEngine')));
  else if (step === 'main') applyRole(d, 'main', pick(MAINS));
  else if (step === 'words') {
    const t = pick(WORDS);
    applyRole(d, 'words', String(t.params.kind), { ...t.params, source: 'lyrics' });
  } else if (step === 'fx') {
    const i = roleIndex(d, 'fx');
    if (i >= 0) d.layers.splice(i, 1);
    const picks = new Set([pick(EFFECT_PICKS), ...(Math.random() > 0.5 ? [pick(EFFECT_PICKS)] : [])]);
    for (const t of picks) toggleEffect(d, t);
  } else d.palette = pick(PALETTE_NAMES);
}

export function CreatePanel() {
  const doc = useShow((s) => s.doc);
  const edit = useShow((s) => s.edit);
  const set = useControl((s) => s.set);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<string>('');
  const [locked, setLocked] = useState<Set<Step>>(new Set());
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
    // Normalising fills the eight macro slots; then the Feel knobs claim three of them.
    edit((d) => rebuildFeel(d));
    useShow.setState({ sourceId: null, selectedLayer: 0 });
    setName('');
  };
  const surprise = (): void => commit((d) => (['bg', 'main', 'fx', 'colours'] as Step[]).filter((s) => !locked.has(s)).forEach((s) => roll(d, s)));
  const lockToggle = (s: Step): void => {
    const next = new Set(locked);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setLocked(next);
  };
  const tools = (s: Step): ReactNode => (
    <span className="flex items-center gap-1">
      <button type="button" title="Roll this step" className="rounded px-1 text-[13px] leading-none text-ink-300 hover:bg-ink-700 hover:text-ink-100" onClick={() => commit((d) => roll(d, s))}>
        🎲
      </button>
      <button
        type="button"
        title={locked.has(s) ? 'Locked: Surprise me leaves this step alone (click to unlock)' : 'Lock: keep this step when you Surprise me'}
        className={`rounded px-1 text-[12px] leading-none hover:bg-ink-700 ${locked.has(s) ? 'text-accent' : 'text-ink-500 hover:text-ink-200'}`}
        onClick={() => lockToggle(s)}
      >
        {locked.has(s) ? '🔒' : '🔓'}
      </button>
    </span>
  );

  const bgIdx = roleIndex(doc, 'bg');
  const mainIdx = roleIndex(doc, 'main');
  const wordsIdx = roleIndex(doc, 'words');
  const fxIdx = roleIndex(doc, 'fx');
  const kindAt = (i: number): string | null => (i >= 0 ? doc.layers[i].source.kind : null);
  const activeFx = new Set(fxIdx >= 0 ? doc.layers[fxIdx].fx.map((f) => f.type) : []);
  const wordsChoice =
    wordsIdx >= 0 ? WORDS.find((t) => t.params.kind === kindAt(wordsIdx) && Object.entries(t.params).every(([k, v]) => k === 'kind' || doc.layers[wordsIdx].source.params[k] === v))?.id : 'none';
  const feel = FEEL.map((n) => ({ n, i: doc.macros.findIndex((m) => m.name === n) })).filter((x) => x.i >= 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section
        title="Make a visual"
        right={
          <span className="text-[10px] text-ink-400">
            {doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}
          </span>
        }
      >
        <p className="text-[11px] leading-snug text-ink-400">Hover a card to try it in the preview (never on the screen), click to use it. 🎲 rolls one step; 🔒 keeps a step when you Surprise me.</p>
        <div className="flex flex-wrap gap-1">
          <Button tone="accent" onClick={fresh} title="Start an empty visual (the look you had is one undo away)">
            Start from scratch
          </Button>
          <Button onClick={surprise} title="Roll every unlocked step">
            Surprise me
          </Button>
          <Button onClick={() => useShow.getState().undo()}>Undo</Button>
        </div>
      </Section>

      <StepBox n={1} title="Background" note={kindAt(bgIdx) ? generatorDef(kindAt(bgIdx)!)?.label : 'none yet'} tools={tools('bg')}>
        <Cards
          items={BACKGROUNDS.filter((k) => generatorDef(k)).map((k) => ({ id: k, label: generatorDef(k)!.label, hint: blurb(k), img: thumb(k) }))}
          active={kindAt(bgIdx)}
          onTry={(k) => tryIt(k ? (d) => applyRole(d, 'bg', k) : null)}
          onPick={(k) => commit((d) => applyRole(d, 'bg', k))}
        />
        {bgIdx >= 0 && <Tweak index={bgIdx} role="bg" />}
      </StepBox>

      <StepBox n={2} title="Main element" note={kindAt(mainIdx) ? generatorDef(kindAt(mainIdx)!)?.label : 'optional'} tools={tools('main')}>
        <Cards
          items={[
            { id: '', label: 'None', hint: 'just the background' },
            ...MAINS.filter((k) => generatorDef(k)).map((k) => ({ id: k, label: generatorDef(k)!.label, hint: blurb(k), img: thumb(k) })),
          ]}
          active={kindAt(mainIdx) ?? ''}
          onTry={(k) => tryIt(k === null ? null : (d) => applyRole(d, 'main', k || null))}
          onPick={(k) => commit((d) => applyRole(d, 'main', k || null))}
        />
        {mainIdx >= 0 && <Tweak index={mainIdx} role="main" />}
      </StepBox>

      <StepBox n={3} title="Words" note={wordsChoice === 'none' ? 'none' : (WORDS.find((t) => t.id === wordsChoice)?.name ?? 'custom')} tools={tools('words')}>
        <Cards
          items={[{ id: 'none', label: 'No words', hint: '' }, ...WORDS.map((t) => ({ id: t.id, label: t.name, hint: t.family }))]}
          active={wordsChoice ?? null}
          onTry={(id) => {
            const t = WORDS.find((x) => x.id === id);
            tryIt(id === null ? null : (d) => applyRole(d, 'words', t ? String(t.params.kind) : null, t ? { ...t.params, source: 'lyrics' } : undefined));
          }}
          onPick={(id) => {
            const t = WORDS.find((x) => x.id === id);
            commit((d) => applyRole(d, 'words', t ? String(t.params.kind) : null, t ? { ...t.params, source: 'lyrics' } : undefined));
          }}
        />
        <p className="text-[10px] text-ink-400">The words are the song's lyrics (or its name when there are none).</p>
        {wordsIdx >= 0 && <Tweak index={wordsIdx} role="words" />}
      </StepBox>

      <StepBox n={4} title="Effects" note={activeFx.size ? `${activeFx.size} on` : 'none'} tools={tools('fx')}>
        <div className="grid grid-cols-3 gap-1" onMouseLeave={() => tryIt(null)}>
          {EFFECT_PICKS.filter((t) => effectDef(t)).map((t) => (
            <button
              key={t}
              type="button"
              title={effectDef(t)!.description}
              onMouseEnter={() => tryIt((d) => toggleEffect(d, t))}
              onClick={() => commit((d) => toggleEffect(d, t))}
              className={`overflow-hidden rounded border text-left transition-colors ${activeFx.has(t) ? 'border-accent bg-accent/15' : 'border-ink-700 hover:border-ink-400'}`}
            >
              {thumb(`fx-${t}`) && <img src={thumb(`fx-${t}`)} alt="" className="aspect-video w-full object-cover" draggable={false} />}
              <span className="block truncate px-1 py-0.5 text-[10px] text-ink-200">
                {activeFx.has(t) ? '✓ ' : ''}
                {effectDef(t)!.label}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-ink-400">Effects treat the whole picture. Click again to take one off.</p>
      </StepBox>

      <StepBox n={5} title="Colours" note={doc.palette} tools={tools('colours')}>
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
      </StepBox>

      <StepBox n={6} title="Feel" note="the knobs under the preview too">
        {feel.length ? (
          feel.map(({ n, i }) => (
            <Slider
              key={n}
              label={n}
              value={doc.macros[i].value}
              min={0}
              max={1}
              defaultValue={0.5}
              format={(v) => (v < 0.45 ? 'less' : v > 0.55 ? 'more' : 'as made')}
              onChange={(v) => useShow.getState().setMacro(i, v)}
            />
          ))
        ) : (
          <p className="text-[11px] text-ink-400">Start from scratch to get the Energy, Speed and Punch knobs for your visual.</p>
        )}
        <p className="text-[10px] leading-snug text-ink-400">
          Energy: how busy and bright · Speed: how fast things move · Punch: how hard it hits on the beat. They also sit on the knobs under the preview, so you can play them live or map them to MIDI.
        </p>
      </StepBox>

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

function StepBox({ n, title, note, tools, children }: { n: number; title: string; note?: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <Section
      title={`${n} · ${title}`}
      right={
        <span className="flex max-w-[65%] items-center gap-1.5">
          {note && <span className="truncate text-[10px] text-ink-300">{note}</span>}
          {tools}
        </span>
      }
    >
      {children}
    </Section>
  );
}

function Cards({
  items,
  active,
  onTry,
  onPick,
}: {
  items: Array<{ id: string; label: string; hint: string; img?: string }>;
  active: string | null;
  onTry: (id: string | null) => void;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pictures = items.some((it) => it.img);
  const first = pictures ? 9 : 8;
  const shown = open ? items : items.slice(0, first);
  return (
    <div onMouseLeave={() => onTry(null)}>
      <div className={`grid ${pictures ? 'grid-cols-3' : 'grid-cols-2'} gap-1`}>
        {shown.map((it) => (
          <button
            key={it.id}
            type="button"
            title={it.hint}
            onMouseEnter={() => onTry(it.id)}
            onFocus={() => onTry(it.id)}
            onClick={() => onPick(it.id)}
            className={`flex flex-col overflow-hidden rounded border text-left transition-colors ${active === it.id ? 'border-accent bg-accent/10' : 'border-ink-700 bg-ink-900 hover:border-ink-400'}`}
          >
            {pictures &&
              (it.img ? (
                <img src={it.img} alt="" className="aspect-video w-full object-cover" draggable={false} />
              ) : (
                <span className="flex aspect-video w-full items-center justify-center bg-ink-850 text-[10px] text-ink-500">{it.id ? '' : 'none'}</span>
              ))}
            <span className={`truncate px-1.5 ${pictures ? 'py-0.5 text-[10px]' : 'pt-1.5 text-[11px]'} text-ink-100`}>{it.label}</span>
            {!pictures && it.hint && <span className="truncate px-1.5 pb-1.5 text-[9px] text-ink-400">{it.hint}</span>}
          </button>
        ))}
      </div>
      {items.length > first && (
        <button type="button" className="mt-1 text-[10px] text-ink-400 hover:text-ink-200" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** How the layer reacts to the music, a few of its own controls, and how strongly it shows. */
function Tweak({ index, role }: { index: number; role: Role }) {
  const layer = useShow((s) => s.doc.layers[index]);
  const edit = useShow((s) => s.edit);
  if (!layer) return null;
  const def = generatorDef(layer.source.kind);
  const specs = (def?.params ?? []).filter((p) => (p.type === 'float' || p.type === 'int') && !SKIP_PARAMS.has(p.key)).slice(0, 4);
  return (
    <div className="space-y-1.5">
      <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
        <span>Music</span>
        <select
          className="max-w-[65%] rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100"
          value={reactionOf(layer)}
          onChange={(e) => edit((d) => setReaction(d.layers[index], e.target.value as ReactionId))}
        >
          {REACTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <details className="rounded border border-ink-700 px-2 py-1">
        <summary className="cursor-pointer text-[11px] text-ink-300">Adjust</summary>
        <div className="mt-1 space-y-1.5">
          <Slider
            label={role === 'bg' ? 'Brightness' : 'Strength'}
            value={layer.opacity}
            min={0}
            max={1}
            defaultValue={1}
            onChange={(v) => edit((d) => void (d.layers[index].opacity = v), `create:${role}:opacity`)}
          />
          {specs.map((p) => (
            <Slider
              key={p.key}
              label={p.label}
              value={typeof layer.source.params[p.key] === 'number' ? (layer.source.params[p.key] as number) : Number(p.default)}
              min={p.min ?? 0}
              max={p.max ?? 1}
              step={p.step}
              defaultValue={Number(p.default)}
              onChange={(v) =>
                edit((d) => {
                  d.layers[index].source.params[p.key] = v;
                  // The Feel knobs follow the new setting.
                  rebuildFeel(d);
                }, `create:${role}:${p.key}`)
              }
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
    </div>
  );
}
