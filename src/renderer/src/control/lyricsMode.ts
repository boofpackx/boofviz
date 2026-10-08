import type { ParamBag, Preset, Scene } from '@shared/types/engine';
import type { LyricsSettings } from '@shared/settings';
import { BUILTIN_TREATMENTS, LYRICS_MODES, findTreatment, routeLyrics, themeTreatment, type LookChoice, type LyricTreatment, type LyricsMode, type Routed } from '@shared/lyricRouter';
import { sceneOf } from '@/engine/presetIO';
import { useControl } from './store';
import { useShow } from './show';

/**
 * Lyrics mode, the control side: routes every look sent to the screens (and
 * the preview) through the lyric router with your settings, and the actions
 * behind the L key, the MIDI functions and the Lyrics tab.
 */

const lyrics = (): LyricsSettings => useControl.getState().settings.lyrics;

/** What the router makes of a look. `tryParams`: a treatment being tried in the preview. */
export function routed(preset: Preset, lookId: string | null, l: LyricsSettings = lyrics(), tryParams?: ParamBag | null): Routed {
  const choice: LookChoice | undefined = lookId ? l.lookChoice[lookId] : undefined;
  return routeLyrics(sceneOf(preset), {
    mode: l.mode,
    force: tryParams,
    choice,
    themes: l.themes,
    allLooks: l.allLooks,
    custom: l.custom,
    tune: l.tune,
  });
}

/** The scene the screens get for a look. */
export function liveScene(preset: Preset, lookId: string | null): Scene {
  return routed(preset, lookId).scene;
}

/** The look being edited / playing, routed (the preview also shows a treatment being tried). */
export function currentRouted(tryParams: ParamBag | null = null): Routed {
  const { doc, sourceId } = useShow.getState();
  return routed(doc, sourceId, lyrics(), tryParams);
}

/** Every treatment, built-in first, then yours. */
export function allTreatments(l: LyricsSettings = lyrics()): LyricTreatment[] {
  return [...BUILTIN_TREATMENTS, ...l.custom];
}

const modeLabel = (m: LyricsMode): string => LYRICS_MODES.find((x) => x.id === m)?.label ?? m;

export function setLyricsMode(mode: LyricsMode): void {
  const st = useControl.getState();
  st.update({ lyrics: mode === 'off' ? { mode } : { mode, lastMode: mode } });
  useShow.getState().notify(`Lyrics: ${modeLabel(mode)}`);
}

/** L: Off, or back to the last mode. */
export function toggleLyrics(): void {
  const l = lyrics();
  setLyricsMode(l.mode === 'off' ? l.lastMode : 'off');
}

/**
 * Shift+L: the next (or previous) treatment for the look playing now: its
 * theme's row, or the one-for-all treatment when that is set. Turns on
 * Everywhere so the change is seen.
 */
export function stepTreatment(dir: 1 | -1): void {
  const l = lyrics();
  const { doc } = useShow.getState();
  const list = allTreatments(l);
  const cur = themeTreatment(doc.category, l);
  const i = list.findIndex((t) => t.id === cur);
  const next = list[(i + dir + list.length) % list.length];
  const patch: Partial<LyricsSettings> = l.allLooks ? { allLooks: next.id } : { themes: { ...l.themes, [doc.category]: next.id } };
  if (l.mode !== 'everywhere') Object.assign(patch, { mode: 'everywhere', lastMode: 'everywhere' });
  useControl.getState().update({ lyrics: patch });
  const where = l.allLooks ? 'All looks' : doc.category;
  const own = routed(doc, useShow.getState().sourceId, {
    ...l,
    ...patch,
  } as LyricsSettings).result;
  useShow.getState().notify(`${where} lyrics: ${next.name}${own === 'own' || own === 'switched-on' ? ' (this look shows its own)' : ''}`);
}

export function setLookChoice(lookId: string, choice: LookChoice): void {
  useControl.getState().update({ lyrics: { lookChoice: { [lookId]: choice } } });
}

export function setThemeTreatment(category: string, id: string): void {
  useControl.getState().update({ lyrics: { themes: { [category]: id } } });
}

/** Save params as a treatment of your own; returns its id. */
export function saveTreatment(name: string, params: LyricTreatment['params']): string {
  const l = lyrics();
  const id = `yours-${Date.now().toString(36)}`;
  useControl.getState().update({
    lyrics: {
      custom: [...l.custom, { id, name: name.trim() || 'My lyrics', family: 'Yours', params }],
    },
  });
  return id;
}

export function deleteTreatment(id: string): void {
  const l = lyrics();
  const themes = Object.fromEntries(Object.entries(l.themes).map(([k, v]) => [k, v === id ? '' : v]));
  const lookChoice = Object.fromEntries(Object.entries(l.lookChoice).map(([k, v]) => [k, v === id ? 'theme' : v]));
  useControl.getState().update({
    lyrics: {
      custom: l.custom.filter((t) => t.id !== id),
      themes,
      lookChoice,
      allLooks: l.allLooks === id ? '' : l.allLooks,
    },
  });
}

export const treatmentName = (id: string, l: LyricsSettings = lyrics()): string => findTreatment(id, l.custom)?.name ?? id;
