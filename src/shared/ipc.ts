import type { ArchiveClip, ArchiveRequest } from './archive';
import type { NowPlaying, SpotifyCommand, TrackLyrics } from './lyrics';
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
  /** Apply `scene` when the beat counter reaches this beat (quantized launch). */
  applyAtBeat?: number;
  /** A new look: blend it in like this (absent for edits). */
  transition?: { type: string; beats: number };
}

/** Ableton Link session snapshot (main → control → analysis worker). */
export interface LinkState {
  available: boolean;
  enabled: boolean;
  peers: number;
  tempo: number;
  /** Session beat (quantum 4: beat 0, 4, 8… are bar starts) at `epochMs`. */
  beat: number;
  epochMs: number;
  playing: boolean;
  error?: string;
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
  // Ableton Link
  setLinkEnabled(on: boolean): Promise<LinkState>;
  onLinkState(cb: (s: LinkState) => void): () => void;
  // Spotify now playing + lyrics
  spotifyConnect(): Promise<void>;
  spotifyDisconnect(): Promise<void>;
  /** Resolves to an error message (e.g. Premium required), or null. */
  spotifyControl(cmd: SpotifyCommand): Promise<string | null>;
  getNowPlaying(): Promise<{ nowPlaying: NowPlaying; lyrics: TrackLyrics }>;
  onNowPlaying(cb: (s: NowPlaying) => void): () => void;
  onLyrics(cb: (l: TrackLyrics) => void): () => void;
  openLyricsFolder(): Promise<void>;
  /** Attach .lrc text to the track playing now. Resolves to an error message, or null. */
  saveLyricsForCurrentTrack(lrcText: string): Promise<string | null>;
  /** Archive footage: the clip for a slot (downloaded and cached by main), or null. */
  archiveClip(req: ArchiveRequest): Promise<ArchiveClip | null>;
  /** Open the folder of the user's own clips (created if missing). */
  openVideosFolder(): Promise<void>;
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
  setLinkEnabled: 'link:setEnabled',
  linkState: 'link:state',
  spotifyConnect: 'spotify:connect',
  spotifyDisconnect: 'spotify:disconnect',
  spotifyControl: 'spotify:control',
  getNowPlaying: 'spotify:get',
  nowPlaying: 'spotify:nowPlaying',
  lyrics: 'lyrics:track',
  openLyricsFolder: 'lyrics:openFolder',
  saveLyrics: 'lyrics:save',
  archiveClip: 'archive:clip',
  openVideosFolder: 'archive:openVideos',
} as const;

/** window.postMessage tag the preload uses to hand a MessagePort to the page. */
export const PORT_MESSAGE_TAG = 'boofviz:analysis-port';
