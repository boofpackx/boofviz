import type { AudioFrame } from '@shared/types/audio';
import type { LaunchQuantize } from '@shared/settings';
import { BUILTIN_PRESETS, type PresetEntry } from '@/engine/library';
import { hash01 } from '@/engine/modulation';
import { engine } from './runtime';
import { libraryEntries, useShow } from './show';
import { useControl } from './store';

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
let shuffleCount = 0;

/** Pick the next shuffle preset: from favorites (or everything), never the current or the last few. */
export function pickShuffle(): PresetEntry | null {
  const lib = useControl.getState().settings.library;
  const favs = favoriteEntries();
  const pool = lib.shufflePool === 'favorites' && favs.length >= 2 ? favs : libraryEntries().presets.length ? libraryEntries().presets : BUILTIN_PRESETS;
  const current = useShow.getState().sourceId;
  const avoid = new Set([current, ...recent.slice(-Math.min(3, Math.floor(pool.length / 2)))]);
  const choices = pool.filter((e) => !avoid.has(e.id));
  const list = choices.length ? choices : pool.filter((e) => e.id !== current);
  if (!list.length) return null;
  const pick = list[Math.floor(hash01(shuffleCount++, Date.now() & 0xffff) * list.length)];
  recent.push(pick.id);
  if (recent.length > 8) recent.shift();
  return pick;
}

export function shuffleNow(): void {
  const pick = pickShuffle();
  if (pick) {
    launchQuantized(pick);
    useShow.getState().notify(`Shuffle → ${pick.preset.name}`);
  }
}

let nextAuto: number | null = null;

/** Drives queued launches and auto-shuffle off the control window's beat clock. */
export function startLauncher(): () => void {
  const id = window.setInterval(() => {
    const f = engine.builder.frame;
    const show = useShow.getState();
    const q = show.queued;
    if (q && f.beat >= q.atBeat - 0.002) show.launch(q.entry);

    const lib = useControl.getState().settings.library;
    if (!lib.autoShuffle || !engine.builder.connected) {
      nextAuto = null;
      return;
    }
    const every = Math.max(1, lib.shuffleBars) * f.beatsPerBar;
    if (nextAuto === null || nextAuto - f.beat > every + 1) {
      // Align the first auto change to the next phrase-aligned multiple of the interval.
      const start = Math.round(f.beat - f.phrasePhase * f.beatsPerPhrase);
      nextAuto = start + every * Math.ceil((f.beat - start + 0.5) / every);
    }
    // Queue a bar ahead so both windows have the scene before the boundary.
    if (!show.queued && nextAuto - f.beat <= f.beatsPerBar) {
      const pick = pickShuffle();
      if (pick) show.launch(pick, nextAuto);
      nextAuto += every;
    }
  }, 20);
  return () => window.clearInterval(id);
}

export { mod };
