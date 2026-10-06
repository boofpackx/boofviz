import type { Settings, SettingsPatch } from './settings';
import type { GlobalControls, Scene } from './types/engine';

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  refreshRate: number;
  primary: boolean;
}

export interface OutputStatus {
  open: boolean;
  displayId?: number;
  fullscreen: boolean;
  fps: number;
  width: number;
  height: number;
}

/** Runtime state the control window pushes to the output window. */
export interface OutputCommand {
  globals?: GlobalControls;
  scene?: Scene;
}

export interface StoredPreset {
  file: string;
  template: boolean;
  json: string;
}

/** API exposed on `window.boofviz` by the preload script. */
export interface BoofvizApi {
  platform: 'win32' | 'darwin' | 'linux' | string;
  role: 'control' | 'output';
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  onSettings(cb: (s: Settings) => void): () => void;
  listDisplays(): Promise<DisplayInfo[]>;
  openOutput(displayId?: number): Promise<void>;
  closeOutput(): Promise<void>;
  toggleOutputFullscreen(): Promise<void>;
  onOutputStatus(cb: (s: OutputStatus) => void): () => void;
  reportOutputStats(s: { fps: number; width: number; height: number }): void;
  sendOutputCommand(cmd: OutputCommand): void;
  onOutputCommand(cb: (cmd: OutputCommand) => void): () => void;
  /** Ask main for a fresh analysis channel to the output window. */
  requestAnalysisPort(): void;
  /** Path of a dropped File (Electron webUtils). */
  pathForFile(file: File): string;
  // Presets
  listUserPresets(): Promise<StoredPreset[]>;
  saveUserPreset(slug: string, json: string, template: boolean): Promise<void>;
  deleteUserPreset(slug: string, template: boolean): Promise<void>;
  importPresets(): Promise<string[]>;
  exportPreset(slug: string, json: string): Promise<boolean>;
  openPresetFolder(): Promise<void>;
  readSession(): Promise<string | null>;
  writeSession(json: string): void;
}

export const IPC = {
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  settingsChanged: 'settings:changed',
  listDisplays: 'displays:list',
  openOutput: 'output:open',
  closeOutput: 'output:close',
  toggleOutputFullscreen: 'output:toggleFullscreen',
  outputStatus: 'output:status',
  outputStats: 'output:stats',
  outputCommand: 'output:command',
  analysisPort: 'analysis:port',
  requestAnalysisPort: 'analysis:requestPort',
  listUserPresets: 'presets:list',
  saveUserPreset: 'presets:save',
  deleteUserPreset: 'presets:delete',
  importPresets: 'presets:import',
  exportPreset: 'presets:export',
  openPresetFolder: 'presets:openFolder',
  readSession: 'session:read',
  writeSession: 'session:write',
} as const;

/** window.postMessage tag the preload uses to hand a MessagePort to the page. */
export const PORT_MESSAGE_TAG = 'boofviz:analysis-port';
