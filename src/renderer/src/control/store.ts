import { create } from 'zustand';
import type { DisplayInfo, OutputStatus } from '@shared/ipc';
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch } from '@shared/settings';
import { DEFAULT_GLOBALS, type GlobalControls } from '@shared/types/engine';
import type { EngineStatus, InputDevice } from '@/audio/AudioEngine';

interface ControlState {
  settings: Settings;
  loaded: boolean;
  engineStatus: EngineStatus;
  devices: InputDevice[];
  displays: DisplayInfo[];
  output: OutputStatus;
  globals: GlobalControls;
  hud: boolean;
  hideUi: boolean;
  fileName: string | null;
  showGuide: boolean;

  hydrate(s: Settings): void;
  update(patch: SettingsPatch): void;
  setGlobals(patch: Partial<GlobalControls>): void;
  set(patch: Partial<Omit<ControlState, 'hydrate' | 'update' | 'setGlobals' | 'set'>>): void;
}

export const useControl = create<ControlState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  engineStatus: { state: 'idle' },
  devices: [],
  displays: [],
  output: { open: false, fullscreen: false, fps: 0, width: 0, height: 0 },
  globals: { ...DEFAULT_GLOBALS },
  hud: true,
  hideUi: false,
  fileName: null,
  showGuide: false,

  hydrate: (s) => set({ settings: s, loaded: true, hud: s.ui.showHud, globals: { ...s.globals, blackout: false } }),
  update: (patch) => {
    // Optimistic local update; main persists and echoes back.
    set({ settings: mergeSettings(get().settings, patch) });
    void window.boofviz.updateSettings(patch);
  },
  setGlobals: (patch) => {
    const globals = { ...get().globals, ...patch };
    set({ globals });
    window.boofviz.sendOutputCommand({ globals });
    const { blackout: _ignored, ...persist } = globals;
    void window.boofviz.updateSettings({ globals: { ...persist, blackout: false } });
  },
  set: (patch) => set(patch),
}));
