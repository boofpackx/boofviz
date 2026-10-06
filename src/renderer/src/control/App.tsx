import { useEffect } from 'react';
import { engine, initEngine } from './runtime';
import { useControl } from './store';
import { TopBar } from './components/TopBar';
import { SourcePanel, useFileDrop } from './components/SourcePanel';
import { Preview } from './components/Preview';
import { AnalysisPanel } from './components/AnalysisPanel';
import { Kbd } from './components/ui';

function useBootstrap(): void {
  const hydrate = useControl((s) => s.hydrate);
  const set = useControl((s) => s.set);

  useEffect(() => {
    const api = window.boofviz;
    engine.onStatus = (engineStatus) => set({ engineStatus });
    const offSettings = api.onSettings((s) => useControl.setState({ settings: s }));
    const offOutput = api.onOutputStatus((output) => set({ output }));

    void (async () => {
      const settings = await api.getSettings();
      hydrate(settings);
      await initEngine();
      engine.setAnalysisSettings(settings.analysis);
      api.sendOutputCommand({ globals: useControl.getState().globals });
      const devices = await engine.listDevices();
      set({ devices });
      const input = settings.input;
      // One-click magic: on Windows start System Audio straight away.
      if (input.kind === 'loopback' && api.platform === 'win32') await engine.setInput(input);
      else if (input.kind === 'device') {
        const dev = devices.find((d) => d.deviceId === input.deviceId) ?? devices.find((d) => d.label === input.deviceLabel);
        if (dev) await engine.setInput({ ...input, deviceId: dev.deviceId });
      }
    })();

    return () => {
      offSettings();
      offOutput();
    };
  }, [hydrate, set]);

  // Push analysis settings to the worklet/worker whenever they change.
  const analysis = useControl((s) => s.settings.analysis);
  const loaded = useControl((s) => s.loaded);
  useEffect(() => {
    if (loaded) engine.setAnalysisSettings(analysis);
  }, [analysis, loaded]);
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const s = useControl.getState();
      switch (e.key.toLowerCase()) {
        case 't':
          engine.tempo({ cmd: 'tap' });
          if (s.settings.analysis.tempoSource !== 'tap') s.update({ analysis: { tempoSource: 'tap' } });
          break;
        case 'f':
          if (s.output.open) void window.boofviz.toggleOutputFullscreen();
          else void window.boofviz.openOutput();
          break;
        case 'o':
          if (s.output.open) void window.boofviz.closeOutput();
          else void window.boofviz.openOutput();
          break;
        case 'h':
          s.set({ hideUi: !s.hideUi });
          break;
        case 'd':
          s.set({ hud: !s.hud });
          s.update({ ui: { showHud: !s.hud } });
          break;
        case 'b':
          s.setGlobals({ blackout: !s.globals.blackout });
          break;
        case '[':
          engine.tempo({ cmd: 'nudge', beats: -1 / 16 });
          break;
        case ']':
          engine.tempo({ cmd: 'nudge', beats: 1 / 16 });
          break;
        case 'enter':
          engine.tempo({ cmd: 'resyncDownbeat' });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useBootstrap();
  useShortcuts();
  const hideUi = useControl((s) => s.hideUi);
  const drop = useFileDrop();

  return (
    <div className="flex h-full flex-col" {...drop}>
      {!hideUi && <TopBar />}
      <div className="flex min-h-0 flex-1">
        {!hideUi && (
          <aside className="w-72 shrink-0 border-r border-ink-700 bg-ink-900">
            <SourcePanel />
          </aside>
        )}
        <main className="min-w-0 flex-1">
          <Preview />
        </main>
        {!hideUi && (
          <aside className="w-80 shrink-0 border-l border-ink-700 bg-ink-900">
            <AnalysisPanel />
          </aside>
        )}
      </div>
      {!hideUi && (
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-ink-700 bg-ink-900 px-3 text-[10px] text-ink-400">
          <span>
            <Kbd>T</Kbd> tap
          </span>
          <span>
            <Kbd>[</Kbd>
            <Kbd>]</Kbd> nudge
          </span>
          <span>
            <Kbd>Enter</Kbd> resync downbeat
          </span>
          <span>
            <Kbd>F</Kbd> fullscreen output
          </span>
          <span>
            <Kbd>B</Kbd> blackout
          </span>
          <span>
            <Kbd>D</Kbd> HUD
          </span>
          <span>
            <Kbd>H</Kbd> hide UI
          </span>
          <span className="ml-auto">Phase 1 · Foundation</span>
        </footer>
      )}
    </div>
  );
}
