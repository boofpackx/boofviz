import type { LibrarySettings, ShufflePool } from '@shared/settings';
import type { PresetEntry } from '@/engine/library';

/**
 * Pure shuffle / auto-play decisions (no app state, so they are unit tested):
 * which looks a pool holds, which one plays next, and when auto-play fires.
 */

export interface PickContext {
  /** Every preset, in Library order. */
  all: PresetEntry[];
  /** What the Library shows right now (for the 'view' pool). */
  view: PresetEntry[];
  currentId: string | null;
  /** Recently played ids, newest last. */
  recent: string[];
  /** Music energy right now, 0..1. */
  energy: number;
  /** 0..1, one per pick. */
  rand: number;
  /** How many times each look has played (fair shuffle: the least-played go first). */
  plays?: Record<string, number>;
}

const WORD_KINDS = new Set(['lyrics', 'lyricVideo', 'kineticType', 'platinumType']);
/** Generators that show the sung line when their source is lyrics. */
const LYRIC_SOURCE_KINDS = new Set(['desktop90']);
const hasWords = (e: PresetEntry): boolean =>
  e.preset.layers.some((l) => l.enabled && (WORD_KINDS.has(l.source.kind) || (LYRIC_SOURCE_KINDS.has(l.source.kind) && l.source.params.source !== 'text' && l.source.params.mode !== 'pet') || (l.source.kind === 'broadcast' && !!l.source.params.captions && l.source.params.captions !== 'off')));
const tagged = (e: PresetEntry, tags: string[]): boolean => e.preset.tags.some((t) => tags.includes(t));

/** Premade playlists: rules, not fixed lists, so new presets join automatically. */
export const PLAYLISTS: Array<{ id: string; name: string; test: (e: PresetEntry) => boolean }> = [
  { id: 'lyrics', name: 'With lyrics', test: hasWords },
  { id: 'nowords', name: 'No words', test: (e) => !hasWords(e) && e.preset.layers.every((l) => l.source.kind !== 'demoParts') },
  { id: 'nineties', name: '90s night', test: (e) => ['Real 90s', 'Retro Type', 'Retro / Glitch'].includes(e.preset.category) || tagged(e, ['90s', 'arcade', 'crt', 'vhs', 'lcd', 'terminal', 'old hardware', '8-bit', 'screensaver', 'dial-up', 'camcorder', 'home video', 'cable']) },
  { id: 'vintage', name: 'Vintage & analog', test: (e) => e.preset.category === 'Retro Type' || tagged(e, ['vintage', 'film', 'sepia', 'tape', 'vhs', 'photocopy', 'neon', 'silent film', 'home video']) },
  { id: 'y2k', name: 'Y2K & glossy', test: (e) => e.preset.category === 'Y2K & Aero' || tagged(e, ['y2k', 'chrome', 'glossy', 'candy', 'vaporwave', 'synthwave']) },
  { id: 'chill', name: 'Chill', test: (e) => e.preset.energy <= 2 },
  { id: 'peak', name: 'Peak time', test: (e) => e.preset.energy >= 4 },
  { id: 'space', name: '3D & trippy', test: (e) => ['3D Worlds', 'Trippy / Psychedelic'].includes(e.preset.category) || tagged(e, ['3d', 'space', 'psychedelic', 'trippy', 'tunnel']) },
  { id: 'retrotv', name: 'Retro TV', test: (e) => e.preset.category === 'Retro TV' || e.preset.layers.some((l) => l.enabled && l.fx.some((f) => f.enabled && f.type === 'tvSet')) },
  { id: 'brutalist', name: 'Brutalist', test: (e) => e.preset.category === 'Brutalist' || tagged(e, ['brutalist', 'concrete', 'neo-brutal']) },
  { id: 'eq', name: 'Classic EQ', test: (e) => e.preset.category === 'Equalizers' },
  { id: 'lostmedia', name: 'Lost media', test: (e) => e.preset.category === 'Lost Media' || e.preset.category === 'Retro TV' || tagged(e, ['lost media', 'found footage', 'archive']) },
];

export interface ResolvedPool {
  entries: PresetEntry[];
  label: string;
  /** The chosen pool had fewer than two looks, so everything is used instead. */
  fellBack: boolean;
}

/** The looks a pool holds (falls back to every preset when it has fewer than two). */
export function resolvePool(lib: Pick<LibrarySettings, 'shufflePool' | 'favorites' | 'pools'>, ctx: Pick<PickContext, 'all' | 'view' | 'currentId'>): ResolvedPool {
  const byId = new Map(ctx.all.map((e) => [e.id, e]));
  const pick = (ids: string[]): PresetEntry[] => ids.map((id) => byId.get(id)).filter((e): e is PresetEntry => !!e);
  const pool: ShufflePool = lib.shufflePool;
  let entries: PresetEntry[];
  let label: string;
  if (pool === 'favorites') {
    entries = pick(lib.favorites);
    label = '★ favorites';
  } else if (pool === 'category') {
    const cat = ctx.currentId ? byId.get(ctx.currentId)?.preset.category : undefined;
    entries = cat ? ctx.all.filter((e) => e.preset.category === cat) : [];
    label = cat ?? 'same category';
  } else if (pool === 'view') {
    entries = ctx.view;
    label = 'Library view';
  } else if (pool.startsWith('playlist:')) {
    const pl = PLAYLISTS.find((x) => `playlist:${x.id}` === pool);
    entries = pl ? ctx.all.filter(pl.test) : [];
    label = pl ? `▶ ${pl.name}` : 'missing playlist';
  } else if (pool.startsWith('pool:')) {
    const p = lib.pools.find((x) => `pool:${x.id}` === pool);
    entries = p ? pick(p.ids) : [];
    label = p ? p.name : 'missing pool';
  } else {
    entries = ctx.all;
    label = 'all presets';
  }
  if (entries.length >= 2 || pool === 'all') return { entries, label: `${label} (${entries.length})`, fellBack: false };
  return { entries: ctx.all, label: `${label} (${entries.length}) → all presets`, fellBack: true };
}

/** Preset energy rating (1–5) that suits music energy 0..1. */
export function energyTarget(energy: number): number {
  return 1 + Math.round(Math.min(1, Math.max(0, energy)) * 4);
}

/** Energy-match weight by distance between a look's energy rating and the music's (0..4). */
const ENERGY_WEIGHT = [1, 0.7, 0.45, 0.3, 0.2];

/** The next look to play, or null when the pool has nothing but the current one. */
export function pickNext(lib: LibrarySettings, ctx: PickContext): PresetEntry | null {
  const { entries } = resolvePool(lib, ctx);
  if (!entries.length) return null;
  if (lib.order === 'sequence') {
    const i = entries.findIndex((e) => e.id === ctx.currentId);
    const next = entries[(i + 1) % entries.length];
    return next.id === ctx.currentId ? null : next;
  }
  // Never the current look; never the last few either, while that still leaves a choice.
  const others = entries.filter((e) => e.id !== ctx.currentId);
  if (!others.length) return null;
  const window = Math.min(Math.max(0, lib.noRepeat), others.length - 1);
  const keepOut = new Set(window > 0 ? ctx.recent.slice(-window) : []);
  const allowed = others.filter((e) => !keepOut.has(e.id));
  // Shuffle bag: only the least-played looks are in the running, so every look in
  // the pool plays once before any plays twice.
  const plays = ctx.plays ?? {};
  const least = Math.min(...allowed.map((e) => plays[e.id] ?? 0));
  const choices = allowed.filter((e) => (plays[e.id] ?? 0) === least);
  // Energy only steers the order within the round (gently), it never starves a look.
  const target = energyTarget(ctx.energy);
  const weights = choices.map((e) => (lib.energyMatch ? ENERGY_WEIGHT[Math.min(4, Math.abs(e.preset.energy - target))] : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.min(0.999999, Math.max(0, ctx.rand)) * total;
  for (let i = 0; i < choices.length; i++) {
    r -= weights[i];
    if (r < 0) return choices[i];
  }
  return choices[choices.length - 1];
}

/** Beats between automatic changes for the interval modes. */
export function autoInterval(lib: Pick<LibrarySettings, 'autoMode' | 'shuffleBars' | 'autoPhrases'>, beatsPerBar: number, beatsPerPhrase: number): number {
  if (lib.autoMode === 'phrases') return Math.max(1, lib.autoPhrases) * Math.max(1, beatsPerPhrase);
  return Math.max(1, lib.shuffleBars) * Math.max(1, beatsPerBar);
}

/** First change point after `beat`, on a multiple of `every` counted from the current phrase start. */
export function nextAutoBeat(beat: number, phrasePhase: number, beatsPerPhrase: number, every: number): number {
  const start = Math.round(beat - phrasePhase * beatsPerPhrase);
  return start + every * Math.ceil((beat - start + 0.5) / every);
}
