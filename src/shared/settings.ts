import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisSettings } from './types/audio';
import { DEFAULT_GLOBALS, type GlobalControls } from './types/engine';

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

export interface LibrarySettings {
  /** Preset ids starred by the user, in the order they were starred (keys 1–9 launch the first nine). */
  favorites: string[];
  /** When a picked preset goes live. */
  quantize: LaunchQuantize;
  autoShuffle: boolean;
  /** Auto-shuffle interval in bars. */
  shuffleBars: number;
  /** Shuffle from favorites (falls back to every preset when there are none). */
  shufflePool: 'favorites' | 'all';
}

export interface Settings {
  version: 1;
  input: InputSettings;
  analysis: AnalysisSettings;
  output: OutputSettings;
  globals: GlobalControls;
  ui: { showHud: boolean };
  library: LibrarySettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  input: { kind: 'loopback', channelPair: 0 },
  analysis: DEFAULT_ANALYSIS_SETTINGS,
  output: { fullscreen: false, renderScale: 1, openOnLaunch: true },
  globals: DEFAULT_GLOBALS,
  ui: { showHud: true },
  library: { favorites: [], quantize: 'bar', autoShuffle: false, shuffleBars: 16, shufflePool: 'favorites' },
};

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type SettingsPatch = DeepPartial<Settings>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
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
