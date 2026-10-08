import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { PRESET_CATEGORIES, type ParamBag } from '@shared/types/engine';
import { LYRICS_MODES, THEME_DEFAULTS, TREATMENT_FAMILIES, describeRoute, findTreatment, themeTreatment, treatmentParams, type LyricTreatment, type LyricsMode } from '@shared/lyricRouter';
import { fontCss } from '@/engine/generators/KineticType';
import { lyricAt } from '@/engine/lyricsFeed';
import { useControl } from '../store';
import { useShow } from '../show';
import { useTicker } from '../hooks';
import { allTreatments, currentRouted, deleteTreatment, saveTreatment, setLookChoice, setLyricsMode, setThemeTreatment } from '../lyricsMode';
import { Button, Kbd, Section, Segmented, Slider } from './ui';

/**
 * The lyric settings: the three-way mode, the gallery of treatments (hover to
 * try one in the preview, click to apply), the theme table and the choice for
 * the look playing now.
 */

const SELECT = 'rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100';

export function ModeSection() {
  useTicker(4);
  const mode = useControl((s) => s.settings.lyrics.mode);
  const l = useControl((s) => s.settings.lyrics);
  useShow((s) => s.doc);
  const r = currentRouted();
  return (
    <Section title="Lyrics mode" right={<span className="text-[10px] text-ink-400">This look: {describeRoute(r, l.custom)}</span>}>
      <Segmented<LyricsMode> value={mode} onChange={setLyricsMode} options={LYRICS_MODES.map((m) => ({ value: m.id, label: m.label }))} />
      <p className="text-[10px] leading-snug text-ink-400">
        {mode === 'off' && 'No lyrics on any look, their own lyric layers included.'}
        {mode === 'own' && 'Every look as it was made: lyrics where it has them, none where it does not.'}
        {mode === 'everywhere' && 'Every look shows lyrics: its own when it has them (switched on if they are off), otherwise the style for its theme.'} <Kbd>L</Kbd> off / back on · <Kbd>Shift L</Kbd>{' '}
        next style
      </p>
    </Section>
  );
}

/** A tiny stand-in for how a treatment looks (the preview shows the real thing on hover). */
function sampleStyle(p: ParamBag): CSSProperties {
  const style = String(p.style ?? '');
  const mat = String(p.material ?? '');
  const ownFont: Record<string, string> = {
    teletext: 'mono',
    credits: 'serif',
    highscore: 'mono',
    jcard: 'marker',
  };
  const font = String(p.font ?? (p.kind === 'lyrics' ? 'heavy' : (ownFont[style] ?? 'heavy')));
  const css: CSSProperties = {
    font: fontCss(font, 15),
    color: '#fff',
    lineHeight: 1.1,
    textTransform: p.uppercase === false || style === 'ransom' ? 'none' : 'uppercase',
  };
  const clip = (bg: string): CSSProperties => ({
    backgroundImage: bg,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  });
  if (p.kind === 'stepChart') return { ...css, font: fontCss('arcade', 15), color: '#ffe25a', textShadow: '0 0 4px #ff5a76' };
  if (p.kind === 'hotMetal') return { ...css, font: fontCss('garamond', 15), color: '#1b1820', background: '#efe6cf', padding: '0 3px', textTransform: 'none' };
  if (p.kind === 'keyframes') return { ...css, font: fontCss('rounded', 15), color: '#ff9a3a', WebkitTextStroke: '1px #111', textTransform: 'none' };
  if (mat === 'chrome' || style === 'infomercial') Object.assign(css, clip('linear-gradient(180deg,#fff 0%,#9aa4b4 45%,#3d4452 52%,#e9eef7 100%)'));
  else if (mat === 'holo' || style === 'glitter') Object.assign(css, clip('linear-gradient(100deg,#ff9ad5,#9ee7ff,#c9ffb0,#ffe59a,#d2a8ff)'));
  else if (mat === 'jelly') Object.assign(css, clip('linear-gradient(180deg,#ffb3e1,#ff4fa8)'));
  else if (mat === 'neon' || style === 'neonalley' || style === 'laser' || mat === 'laser')
    Object.assign(css, {
      color: '#ff7cf2',
      textShadow: '0 0 6px #ff3de8, 0 0 12px #ff3de8',
    });
  else if (mat === 'led' || mat === 'phosphor' || style === 'highscore') Object.assign(css, { color: '#7dff8a', textShadow: '0 0 5px #2bff4f' });
  else if (style === 'teletext')
    Object.assign(css, {
      color: '#ffef3a',
      background: '#000',
      padding: '0 3px',
    });
  else if (mat === 'mimeo')
    Object.assign(css, {
      color: '#5b4fd6',
      background: '#f4f1e8',
      padding: '0 3px',
    });
  else if (mat === 'paper' || style === 'jcard')
    Object.assign(css, {
      color: '#1b1b1b',
      background: '#efe6cf',
      padding: '0 3px',
    });
  else if (mat === 'melt') Object.assign(css, { color: '#ffb347', transform: 'skewY(4deg)' });
  else if (mat === 'stencil' || mat === 'rubdown') Object.assign(css, { letterSpacing: '0.06em' });
  else if (style === 'glitch') Object.assign(css, { textShadow: '-2px 0 #ff2a55, 2px 0 #20e6ff' });
  else if (p.kind === 'lyrics' && p.mode === 'karaoke') Object.assign(css, clip('linear-gradient(90deg,#ffe14d 50%,#fff 50%)'));
  return css;
}

type Target = 'look' | 'theme' | 'all';

export function StyleSection() {
  useTicker(2);
  const l = useControl((s) => s.settings.lyrics);
  const set = useControl((s) => s.set);
  const update = useControl((s) => s.update);
  const doc = useShow((s) => s.doc);
  const sourceId = useShow((s) => s.sourceId);
  const notify = useShow((s) => s.notify);
  const [target, setTarget] = useState<Target>('theme');
  const [query, setQuery] = useState('');
  const list = allTreatments(l);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((t) => `${t.name} ${t.family} ${t.params.style ?? ''} ${t.params.material ?? ''}`.toLowerCase().includes(q)) : list;
  }, [list, query]);
  const sample = lyricAt(Date.now(), 150).text.split(/\s+/).slice(0, 2).join(' ');
  const active = target === 'all' ? l.allLooks : target === 'theme' ? themeTreatment(doc.category, { ...l, allLooks: '' }) : sourceId ? l.lookChoice[sourceId] : undefined;
  const tryIt = (t: LyricTreatment | null): void => set({ lyricTry: t ? treatmentParams(t.id, l) : null });

  const apply = (t: LyricTreatment): void => {
    if (target === 'all') update({ lyrics: { allLooks: t.id } });
    else if (target === 'theme') {
      setThemeTreatment(doc.category, t.id);
      if (l.allLooks) update({ lyrics: { allLooks: '' } });
    } else if (sourceId) setLookChoice(sourceId, t.id);
    if (l.mode !== 'everywhere') update({ lyrics: { mode: 'everywhere', lastMode: 'everywhere' } });
    notify(`${t.name} → ${target === 'all' ? 'all looks' : target === 'theme' ? doc.category : doc.name}`);
  };
  // Arrow keys move through the cards (trying each one), Enter applies.
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-card]'));
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[e.key];
    if (step === undefined || i < 0) return;
    e.preventDefault();
    cards[Math.max(0, Math.min(cards.length - 1, i + step))]?.focus();
  };
  const families = TREATMENT_FAMILIES.filter((f) => shown.some((t) => t.family === f));

  return (
    <Section title="Lyric style" right={l.allLooks ? <span className="text-[10px] text-accent">one style for all looks</span> : <span className="text-[10px] text-ink-400">by theme</span>}>
      <div className="flex items-center gap-1 text-[11px] text-ink-300">
        <span>Apply to</span>
        <div className="flex-1">
          <Segmented<Target>
            value={target}
            onChange={setTarget}
            options={[
              {
                value: 'theme',
                label: doc.category,
                title: 'Every look in this theme',
              },
              {
                value: 'look',
                label: 'This look',
                title: doc.name,
                disabled: !sourceId,
              },
              { value: 'all', label: 'All looks' },
            ]}
          />
        </div>
      </div>
      <input
        className="w-full rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-[11px] text-ink-100 placeholder:text-ink-500"
        placeholder="Search styles (chrome, neon, 90s…)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex items-center gap-1">
        <Button onClick={() => apply(list[Math.floor(Math.random() * list.length)])} title="Apply a random style">
          Surprise me
        </Button>
        {l.allLooks && (
          <Button onClick={() => update({ lyrics: { allLooks: '' } })} title="Each theme gets its own style again">
            By theme
          </Button>
        )}
      </div>
      <p className="text-[10px] text-ink-400">Hover or arrow onto a style to try it in the preview (never on the screen); click or Enter applies it.</p>
      <div onKeyDown={onKey} onMouseLeave={() => tryIt(null)} className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
        {families.map((f) => (
          <div key={f}>
            <div className="mb-1 text-[9px] font-semibold tracking-[0.14em] text-ink-500 uppercase">{f}</div>
            <div className="grid grid-cols-2 gap-1">
              {shown
                .filter((t) => t.family === f)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    data-card
                    title={t.family === 'Yours' ? `${t.name} (right-click to delete)` : t.name}
                    onMouseEnter={() => tryIt(t)}
                    onFocus={() => tryIt(t)}
                    onBlur={() => tryIt(null)}
                    onClick={() => apply(t)}
                    onContextMenu={(e) => {
                      if (t.family !== 'Yours') return;
                      e.preventDefault();
                      deleteTreatment(t.id);
                    }}
                    className={`flex h-14 flex-col items-stretch justify-between overflow-hidden rounded border p-1 text-left transition-colors ${active === t.id ? 'border-accent bg-accent/10' : 'border-ink-700 bg-ink-900 hover:border-ink-400 focus:border-ink-300 focus:outline-none'}`}
                  >
                    <span className="truncate" style={sampleStyle(t.params)}>
                      {sample || t.name}
                    </span>
                    <span className="truncate text-[10px] text-ink-300">{t.name}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <FineTune />
    </Section>
  );
}

const VIDEO_STYLES = [
  'drop',
  'slam',
  'pop',
  'shuffle',
  'flip',
  'spin3d',
  'zoomthrough',
  'stack',
  'wave',
  'glitch',
  'scatter',
  'orbit3d',
  'highway',
  'credits',
  'infomercial',
  'ransom',
  'teletext',
  'screensaver',
  'neonalley',
  'jcard',
  'laser',
  'highscore',
  'explosion',
  'shatterdrop',
  'jelly',
  'glitter',
];
const MATERIALS = ['auto', 'plain', 'chrome', 'neon', 'paper', 'led', 'phosphor', 'stencil', 'mimeo', 'rubdown', 'laser', 'holo', 'jelly', 'melt'];
const FONTS = ['heavy', 'condensed', 'mono', 'serif', 'marker', 'rounded', 'arcade', 'garamond', 'book', 'wood', 'pixel', 'wide'];

function Pick({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
      <span>{label}</span>
      <select className={SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Size and position over every style, and making a style of your own from the one in use. */
function FineTune() {
  const l = useControl((s) => s.settings.lyrics);
  const update = useControl((s) => s.update);
  const set = useControl((s) => s.set);
  const doc = useShow((s) => s.doc);
  const [draft, setDraft] = useState<ParamBag | null>(null);
  const [name, setName] = useState('');
  const start = (): void => {
    const base = findTreatment(themeTreatment(doc.category, l), l.custom)?.params ?? { kind: 'lyricVideo', style: 'drop' };
    setDraft({ ...base });
    set({ lyricTry: { ...base } });
  };
  const change = (patch: ParamBag): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    set({ lyricTry: next });
  };
  const close = (): void => {
    setDraft(null);
    set({ lyricTry: null });
  };
  const video = draft?.kind !== 'lyrics';
  return (
    <details className="rounded border border-ink-700 px-2 py-1">
      <summary className="cursor-pointer text-[11px] text-ink-300">Fine-tune</summary>
      <div className="mt-2 space-y-2">
        <Slider label="Size (all styles)" value={l.tune.size} min={0.5} max={2} defaultValue={1} onChange={(size) => update({ lyrics: { tune: { size } } })} />
        <Segmented
          value={l.tune.position}
          onChange={(position) => update({ lyrics: { tune: { position } } })}
          options={[
            { value: 'auto', label: 'Style’s own' },
            { value: 'upper', label: 'Top' },
            { value: 'center', label: 'Center' },
            { value: 'lower', label: 'Bottom' },
          ]}
        />
        {!draft ? (
          <Button onClick={start} title="Start from the style this look's theme uses, try changes in the preview, save it as your own">
            Make your own style…
          </Button>
        ) : (
          <div className="space-y-1.5 rounded bg-ink-850 p-1.5">
            <Segmented
              value={video ? 'lyricVideo' : 'lyrics'}
              onChange={(kind) => change(kind === 'lyrics' ? { kind, mode: 'karaoke' } : { kind, style: 'drop' })}
              options={[
                { value: 'lyricVideo', label: 'Music video' },
                { value: 'lyrics', label: 'Classic' },
              ]}
            />
            {video ? (
              <>
                <Pick label="Style" value={String(draft.style ?? 'drop')} options={VIDEO_STYLES} onChange={(style) => change({ style })} />
                <Pick label="Letters made of" value={String(draft.material ?? 'auto')} options={MATERIALS} onChange={(material) => change({ material })} />
                <Pick label="Colour" value={String(draft.colorMode ?? 'palette')} options={['palette', 'gradient', 'white', 'rainbow']} onChange={(colorMode) => change({ colorMode })} />
                <Pick label="Lines leave by" value={String(draft.exit ?? 'auto')} options={['auto', 'style', 'fade', 'shatter', 'burn']} onChange={(exit) => change({ exit })} />
              </>
            ) : (
              <Pick label="Mode" value={String(draft.mode ?? 'karaoke')} options={['karaoke', 'punch', 'typewriter']} onChange={(mode) => change({ mode })} />
            )}
            <Pick label="Font" value={String(draft.font ?? 'heavy')} options={FONTS} onChange={(font) => change({ font })} />
            <div className="flex items-center gap-1">
              <input
                className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                tone="accent"
                onClick={() => {
                  const id = saveTreatment(name, draft);
                  setThemeTreatment(doc.category, id);
                  setName('');
                  close();
                }}
                title={`Save, and use it for ${doc.category}`}
              >
                Save
              </Button>
              <Button onClick={close}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function TreatmentSelect({ value, onChange, extra }: { value: string; onChange: (v: string) => void; extra?: Array<[string, string]> }) {
  const l = useControl((s) => s.settings.lyrics);
  const list = allTreatments(l);
  return (
    <select className={`${SELECT} max-w-[60%]`} value={value} onChange={(e) => onChange(e.target.value)}>
      {extra?.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
      {TREATMENT_FAMILIES.filter((f) => list.some((t) => t.family === f)).map((f) => (
        <optgroup key={f} label={f}>
          {list
            .filter((t) => t.family === f)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function ThemesSection() {
  const l = useControl((s) => s.settings.lyrics);
  const update = useControl((s) => s.update);
  const changed = PRESET_CATEGORIES.some((c) => l.themes[c]);
  return (
    <Section
      title="Themes"
      right={
        changed ? (
          <Button
            onClick={() =>
              update({
                lyrics: {
                  themes: Object.fromEntries(PRESET_CATEGORIES.map((c) => [c, ''])),
                },
              })
            }
          >
            Reset all
          </Button>
        ) : undefined
      }
    >
      <p className="text-[10px] text-ink-400">
        The style each theme gets in Everywhere
        {l.allLooks ? ' (one style for all looks is on, so these wait)' : ''}.
      </p>
      {PRESET_CATEGORIES.map((c) => (
        <label key={c} className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
          <span className={l.themes[c] ? 'text-ink-100' : ''}>{c}</span>
          <TreatmentSelect value={l.themes[c] || THEME_DEFAULTS[c] || 'drop'} onChange={(id) => setThemeTreatment(c, id === THEME_DEFAULTS[c] ? '' : id)} />
        </label>
      ))}
    </Section>
  );
}

export function ThisLookSection() {
  const l = useControl((s) => s.settings.lyrics);
  const doc = useShow((s) => s.doc);
  const sourceId = useShow((s) => s.sourceId);
  const choice = sourceId ? (l.lookChoice[sourceId] ?? 'theme') : 'theme';
  return (
    <Section title="This look" right={<span className="max-w-[55%] truncate text-[10px] text-ink-400">{doc.name}</span>}>
      <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
        <span>In Everywhere</span>
        {sourceId ? (
          <TreatmentSelect
            value={choice}
            onChange={(v) => setLookChoice(sourceId, v)}
            extra={[
              ['theme', `Theme style (${findTreatment(themeTreatment(doc.category, l), l.custom)?.name ?? 'default'})`],
              ['own', 'Its own lyrics only'],
              ['never', 'Never lyrics'],
            ]}
          />
        ) : (
          <span className="text-ink-400">save the look first</span>
        )}
      </label>
      <p className="text-[10px] text-ink-400">Saved per look (your favourites too) without changing the look itself. Also on the library’s right-click menu.</p>
    </Section>
  );
}
