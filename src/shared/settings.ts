import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisSettings } from './types/audio';
import { DEFAULT_GLOBALS, type GlobalControls, type ParamBag } from './types/engine';
import type { LyricTreatment, LyricsMode } from './lyricRouter';

export type InputKind = 'loopback' | 'device' | 'file';

export interface InputSettings {
  kind: InputKind;
  deviceId?: string;
  deviceLabel?: string;
  /** First channel of the stereo pair for multi-channel interfaces. */
  channelPair: number;
}

export interface OutputSettings {
  displayId?: number;
  fullscreen: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  renderScale: number;
  openOnLaunch: boolean;
}

export type LaunchQuantize = 'now' | 'beat' | 'bar' | 'phrase';

/** A named set of looks for shuffle and auto-play. */
export interface PresetPool {
  id: string;
  name: string;
  ids: string[];
}

/** Where shuffle picks from: favorites, everything, the current look's category, what the Library shows, or a named pool. */
export type ShufflePool = 'favorites' | 'all' | 'category' | 'view' | `pool:${string}` | `playlist:${string}`;

export type TransitionType = 'cut' | 'crossfade' | 'flashBlack' | 'flashWhite' | 'lumaWipe' | 'zoomThrough' | 'glitchCut' | 'blurDissolve' | 'feedbackSmear';

export interface LibrarySettings {
  /** Preset ids starred by the user, in the order they were starred (keys 1–9 launch the first nine). */
  favorites: string[];
  /** When a picked preset goes live. */
  quantize: LaunchQuantize;
  /** Auto-play: change looks by itself. */
  autoShuffle: boolean;
  /** Auto-play rhythm: every N bars, every N phrases, or on each drop. */
  autoMode: 'bars' | 'phrases' | 'drops';
  /** Interval for autoMode 'bars'. */
  shuffleBars: number;
  /** Interval for autoMode 'phrases'. */
  autoPhrases: number;
  /** In bars/phrases mode, also change on the next beat after a drop. */
  alsoOnDrop: boolean;
  /** Prefer looks whose energy rating matches the music right now. */
  energyMatch: boolean;
  /** Random picks, or the pool in Library order. */
  order: 'random' | 'sequence';
  /** Don't repeat any of the last N looks. */
  noRepeat: number;
  shufflePool: ShufflePool;
  pools: PresetPool[];
  /** How every new look comes in (a preset's own transitionIn wins). */
  transition: { type: TransitionType; beats: number };
}

export interface LyricsSettings {
  /** Added to the song position: positive shows lyrics earlier. */
  offsetMs: number;
  /** Look lyrics up on LRCLIB when there's no local .lrc or cache entry. */
  online: boolean;
  /** Off: no lyrics anywhere · own: each look as made · everywhere: every look shows lyrics (see lyricRouter). */
  mode: LyricsMode;
  /** The mode L brings back after Off. */
  lastMode: Exclude<LyricsMode, 'off'>;
  /** One treatment for every look in Everywhere ('' : by theme). */
  allLooks: string;
  /** Theme (preset category) → treatment id; missing or '': the built-in default. */
  themes: Record<string, string>;
  /** Look id → 'theme' | 'own' | 'never' | a treatment id (Everywhere only). */
  lookChoice: Record<string, string>;
  /** Treatments you saved. */
  custom: LyricTreatment[];
  /** Over every added treatment: a size multiplier and a position ('auto': the treatment's own). */
  tune: { size: number; position: 'auto' | 'center' | 'lower' | 'upper' };
  /** Time the lyrics automatically from how late songs are heard to start (on top of offsetMs). */
  autoTiming: boolean;
  /** The last few measured delays (ms the sound started after the player said), newest last. */
  timing: number[];
}

/** The median of the measured delays once there are three or more (0 before). */
export function measuredDelayMs(timing: readonly number[]): number {
  if (timing.length < 3) return 0;
  const s = [...timing].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

/** The lyrics offset both windows use: the slider, plus the measured delay when automatic timing is on. */
export function lyricsOffsetMs(l: Pick<LyricsSettings, 'offsetMs' | 'autoTiming' | 'timing'>): number {
  return l.offsetMs - (l.autoTiming ? measuredDelayMs(l.timing ?? []) : 0);
}

/** "Make it lost media": ages whatever look is playing (tape, film or early web video). */
export interface LostMediaSettings {
  enabled: boolean;
  style: 'camcorder' | 'vhs' | 'broadcast' | 'super8' | 'archive' | 'web';
  /** 0..2 */
  wear: number;
  /** Tape events, 0..1. */
  events: number;
  /** 0 cozy · 1 eerie */
  mood: number;
  date: string;
  station: string;
}

/** "Old TV screen": every look plays on old curved glass (optionally inside a whole TV set). */
export interface RetroTvSettings {
  enabled: boolean;
  set: 'screen' | 'console60' | 'portable70' | 'woodgrain80' | 'black90';
  /** 0 = the whole set · 1 = the screen fills the frame. */
  zoom: number;
  /** Blackout collapses the picture to a line and a dot, like switching a tube off. */
  powerFx: boolean;
}

/** "Neo-brutal flat" over any look: flat loud colours, black outlines, hard offset shadows. */
/** Looks take their colours from the playing song's album cover. */
export interface CoverColorsSettings {
  enabled: boolean;
  /** 0..1: how much of the cover's colours replace the look's own. */
  amount: number;
}

export interface NeoFlatSettings {
  enabled: boolean;
  colours: 'neo' | 'look';
  outline: number;
  shadow: number;
}

/** One MIDI control mapped to a BOOFVIZ function (see control/midiMap.ts for the targets). */
export interface MidiMapping {
  target: string;
  /** Input port name ('' = any controller). */
  input: string;
  type: 'cc' | 'note';
  /** 0–15. */
  channel: number;
  number: number;
}

export interface Settings {
  version: 1;
  input: InputSettings;
  analysis: AnalysisSettings;
  output: OutputSettings;
  globals: GlobalControls;
  ui: { showHud: boolean };
  library: LibrarySettings;
  spotify: { clientId: string };
  lyrics: LyricsSettings;
  lostMedia: LostMediaSettings;
  retroTv: RetroTvSettings;
  neoFlat: NeoFlatSettings;
  midiMap: { mappings: MidiMapping[] };
  coverColors: CoverColorsSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  input: { kind: 'loopback', channelPair: 0 },
  analysis: DEFAULT_ANALYSIS_SETTINGS,
  output: { fullscreen: false, renderScale: 1, openOnLaunch: true },
  globals: DEFAULT_GLOBALS,
  ui: { showHud: true },
  library: {
    favorites: [],
    quantize: 'bar',
    autoShuffle: false,
    autoMode: 'bars',
    shuffleBars: 16,
    autoPhrases: 1,
    alsoOnDrop: false,
    energyMatch: true,
    order: 'random',
    noRepeat: 4,
    shufflePool: 'all',
    pools: [],
    transition: { type: 'crossfade', beats: 2 },
  },
  spotify: { clientId: '' },
  lyrics: { offsetMs: 0, online: true, autoTiming: true, timing: [], mode: 'own',
    lastMode: 'everywhere',
    allLooks: '',
    themes: { }, lookChoice: { },
    custom: [], tune: { size: 1, position: 'auto' } },
  lostMedia: { enabled: false, style: 'vhs', wear: 1, events: 0.3, mood: 0.3, date: 'JUN 14 1994', station: 'CHANNEL 9' },
  retroTv: { enabled: false, set: 'screen', zoom: 0.1, powerFx: true },
  neoFlat: { enabled: false, colours: 'neo', outline: 4, shadow: 12 },
  midiMap: { mappings: [] },
  coverColors: { enabled: false, amount: 1 },
};

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type SettingsPatch = DeepPartial<Settings>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
}

/**
 * Bring a settings file from an older version up to date (before it is merged
 * with the defaults). The old "lyrics over every look" switch becomes the
 * Everywhere mode; a style picked there becomes a saved treatment for all looks.
 */
export function migrateSettings(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  let raw: Record<string, unknown> = input;
  // Shuffle used to default to the favourites, so a handful of looks kept coming round: move to all looks once.
  if (isPlainObject(raw.library) && raw.library.shufflePool === 'favorites' && !raw.library.shuffleAllOnce) raw = { ...raw, library: { ...raw.library, shufflePool: 'all', shuffleAllOnce: true } };
  if (!isPlainObject(raw.lyrics)) return raw;
  const l = { ...raw.lyrics };
  if (l.mode === undefined && isPlainObject(l.overlay)) {
    const o = l.overlay as { enabled?: boolean; params?: ParamBag };
    l.mode = o.enabled ? 'everywhere' : 'own';
    const p = o.params ?? {};
    const picked = p.kind === 'lyrics' || (p.style !== undefined && p.style !== 'auto');
    if (picked) {
      const mine: LyricTreatment = {
        id: 'yours-1',
        name: 'Your style',
        family: 'Yours',
        params: { ...p, kind: p.kind === 'lyrics' ? 'lyrics' : 'lyricVideo' },
      };
      l.custom = [mine];
      l.allLooks = mine.id;
    }
  }
  delete l.overlay;
  delete l.textLooks;
  return { ...raw, lyrics: l };
}

/** Deep-merge `patch` into `base`, returning a new object. Arrays are replaced. */
export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(out[k]) && isPlainObject(v) ? mergeSettings(out[k], v) : v;
  }
  return out as T;
}
