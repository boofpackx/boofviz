import type { AudioFrame } from '@shared/types/audio';
import type { LaunchQuantize, PresetPool, TransitionType } from '@shared/settings';
import type { Preset } from '@shared/types/engine';
import { BUILTIN_PRESETS, type PresetEntry } from '@/engine/library';
import { engine } from './runtime';
import { libraryEntries, useShow } from './show';
import { useControl } from './store';
import { autoInterval, nextAutoBeat, pickNext, resolvePool, type PickContext } from './autopilot';
import { filteredEntries, libraryView } from './components/Library';

/**
 * Beat-quantized launching, favorites and shuffle.
 *
 * A launch is scheduled for an absolute beat on the shared beat clock; the
 * preview and the output each apply the queued scene on the first frame that
 * reaches that beat, so they switch together, exactly on the downbeat.
 */

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** First beat / bar / phrase boundary at least `lead` beats ahead. */
export function nextBoundary(f: AudioFrame, q: LaunchQuantize, lead = 0.05): number | undefined {
  if (q === 'now') return undefined;
  const b = f.beat;
  if (q === 'beat') return Math.ceil(b + lead);
  const span = q === 'bar' ? f.beatsPerBar : f.beatsPerPhrase;
  const phase = q === 'bar' ? f.barPhase : f.phrasePhase;
  const start = Math.round(b - phase * span);
  let next = start + span;
  while (next - b < lead) next += span;
  return next;
}

export function launchQuantized(entry: PresetEntry, q?: LaunchQuantize): void {
  const quant = q ?? useControl.getState().settings.library.quantize;
  // Without audio the clock still runs, but there's no beat to wait for.
  const live = engine.builder.connected;
  useShow.getState().launch(entry, live ? nextBoundary(engine.builder.frame, quant) : undefined);
}

export function isFavorite(id: string): boolean {
  return useControl.getState().settings.library.favorites.includes(id);
}

export function toggleFavorite(id: string): void {
  const st = useControl.getState();
  const favs = st.settings.library.favorites;
  st.update({ library: { favorites: favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id] } });
}

export function favoriteEntries(): PresetEntry[] {
  const all = libraryEntries().presets;
  return useControl
    .getState()
    .settings.library.favorites.map((id) => all.find((e) => e.id === id))
    .filter((e): e is PresetEntry => !!e);
}

const recent: string[] = [];

/** Play counts per look (kept between sessions) so shuffle gives every look its turn. */
const PLAYS_KEY = 'boofviz.plays';
const plays: Record<string, number> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYS_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
})();
let playsSaveTimer: number | undefined;

/** Count a look as played (shuffle, auto-play or launched by hand). */
export function notePlayed(id: string): void {
  plays[id] = (plays[id] ?? 0) + 1;
  window.clearTimeout(playsSaveTimer);
  playsSaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(PLAYS_KEY, JSON.stringify(plays));
    } catch {
      // Storage unavailable: counts still work for this session.
    }
  }, 2000);
}

function pickContext(): PickContext {
  return {
    all: libraryEntries().presets.length ? libraryEntries().presets : BUILTIN_PRESETS,
    view: filteredEntries(libraryView.tab, libraryView.query, libraryView.category, libraryView.tag).filter((e) => !e.preset.isTemplate),
    currentId: useShow.getState().sourceId,
    recent,
    energy: engine.builder.frame.energy,
    rand: Math.random(),
    plays,
  };
}

/** What the shuffle pool holds right now, for the UI. */
export function poolLabel(): string {
  return resolvePool(useControl.getState().settings.library, pickContext()).label;
}

/** Pick the next shuffle preset from the configured pool (see autopilot.ts). */
export function pickShuffle(): PresetEntry | null {
  const pick = pickNext(useControl.getState().settings.library, pickContext());
  if (pick) {
    recent.push(pick.id);
    if (recent.length > 32) recent.shift();
    notePlayed(pick.id);
  }
  return pick;
}

export function shuffleNow(): void {
  const pick = pickShuffle();
  if (pick) {
    launchQuantized(pick);
    useShow.getState().notify(`Shuffle → ${pick.preset.name}`);
  }
}

export function toggleAuto(): void {
  const st = useControl.getState();
  const on = !st.settings.library.autoShuffle;
  st.update({ library: { autoShuffle: on } });
  useShow.getState().notify(on ? 'Auto-play on' : 'Auto-play off');
}

/** How a look comes in: its own transitionIn, else the global setting. */
export function transitionFor(preset: Preset | null): { type: TransitionType; beats: number } {
  const own = preset?.transitionIn;
  return own ? { type: own.type, beats: own.beats } : useControl.getState().settings.library.transition;
}

// ---- Named pools -------------------------------------------------------------

function setPools(pools: PresetPool[]): void {
  useControl.getState().update({ library: { pools } });
}

export function createPool(withId?: string): PresetPool {
  const pools = useControl.getState().settings.library.pools;
  let n = pools.length + 1;
  while (pools.some((p) => p.name === `Pool ${n}`)) n++;
  const pool: PresetPool = { id: Math.random().toString(36).slice(2, 9), name: `Pool ${n}`, ids: withId ? [withId] : [] };
  setPools([...pools, pool]);
  return pool;
}

export function togglePoolMember(poolId: string, presetId: string): void {
  setPools(useControl.getState().settings.library.pools.map((p) => (p.id !== poolId ? p : { ...p, ids: p.ids.includes(presetId) ? p.ids.filter((x) => x !== presetId) : [...p.ids, presetId] })));
}

export function renamePool(poolId: string, name: string): void {
  setPools(useControl.getState().settings.library.pools.map((p) => (p.id === poolId ? { ...p, name: name.trim().slice(0, 32) || p.name } : p)));
}

export function deletePool(poolId: string): void {
  const st = useControl.getState();
  setPools(st.settings.library.pools.filter((p) => p.id !== poolId));
  if (st.settings.library.shufflePool === `pool:${poolId}`) st.update({ library: { shufflePool: 'favorites' } });
}

// ---- Auto-play -----------------------------------------------------------------

let nextAuto: number | null = null;
let seenDrops = -1;
let lastChangeBeat = Number.NEGATIVE_INFINITY;

/** Drives queued launches and auto-play off the control window's beat clock. */
export function startLauncher(): () => void {
  const id = window.setInterval(() => {
    const f = engine.builder.frame;
    // The live beat, not the last rendered frame's: a busy window (loading a look) can lag frames by a beat or more.
    const live = engine.builder.beatAtEpoch(performance.timeOrigin + performance.now());
    const beat = Number.isFinite(live) ? live : f.beat;
    const show = useShow.getState();
    const q = show.queued;
    if (q && beat >= q.atBeat - 0.002) {
      show.launch(q.entry);
      lastChangeBeat = q.atBeat;
      return;
    }

    const lib = useControl.getState().settings.library;
    const drops = engine.builder.dropCount;
    const dropped = seenDrops >= 0 && drops > seenDrops;
    seenDrops = drops;
    if (!lib.autoShuffle) {
      nextAuto = null;
      return;
    }
    // A momentary stall isn't silence: keep the schedule and just wait.
    if (!engine.builder.connected) return;
    const queueAt = (atBeat: number): void => {
      const pick = pickShuffle();
      if (pick) show.launch(pick, atBeat);
    };
    // A drop is the moment: change on the very next beat (drops mode, or "also on drops").
    if (dropped && (lib.autoMode === 'drops' || lib.alsoOnDrop) && !show.queued) {
      queueAt(Math.max(Math.ceil(beat + 0.05), lastChangeBeat + 1));
      nextAuto = null;
      return;
    }
    if (lib.autoMode === 'drops') {
      // No drop for a long stretch (64 bars): move on at the next phrase anyway.
      if (beat - lastChangeBeat > 64 * f.beatsPerBar && !show.queued) queueAt(nextBoundary({ ...f, beat, phrasePhase: f.phrasePhase + (beat - f.beat) / f.beatsPerPhrase }, 'phrase') ?? Math.ceil(beat + 0.05));
      return;
    }
    const every = autoInterval(lib, f.beatsPerBar, f.beatsPerPhrase);
    if (nextAuto === null || nextAuto - beat > every + 1) nextAuto = nextAutoBeat(beat, f.phrasePhase + (beat - f.beat) / f.beatsPerPhrase, f.beatsPerPhrase, every);
    // Never in the past, and never sooner than half an interval after the last change
    // (the phrase grid can shift when the tracker re-aligns, e.g. a track looping).
    while (nextAuto <= beat + 0.05 || nextAuto < lastChangeBeat + Math.max(0.5, every / 2)) nextAuto += every;
    // Queue a bar ahead so both windows have the scene before the boundary.
    if (!show.queued && nextAuto - beat <= f.beatsPerBar) {
      queueAt(nextAuto);
      nextAuto += every;
    }
  }, 20);
  return () => window.clearInterval(id);
}

export { mod };
