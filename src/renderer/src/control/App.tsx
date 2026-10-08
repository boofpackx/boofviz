import { useEffect, useState } from 'react';
import { liveScene, stepTreatment, toggleLyrics } from './lyricsMode';
import { engine, initEngine } from './runtime';
import { useControl } from './store';
import { useShow } from './show';
import { applyTempoSource, initExternalTempo } from './externalTempo';
import { cueGo, favoriteEntries, launchQuantized, setCue, shuffleNow, startLauncher, stepPreset, toggleAuto, transitionFor } from './launcher';
import { startSpotifyAutoSync } from './spotifySync';
import { TopBar } from './components/TopBar';
import { SourcePanel, useFileDrop } from './components/SourcePanel';
import { Preview } from './components/Preview';
import { AnalysisPanel, MasterPanel } from './components/AnalysisPanel';
import { Inspector } from './components/Inspector';
import { Library } from './components/Library';
import { MacroStrip } from './components/MacroStrip';
import { ContextMenuHost } from './components/ContextMenu';
import { LyricsPanel } from './components/LyricsPanel';
import { PerformPanel } from './components/PerformPanel';
import { startMidiMap } from './midiMap';
import { addMeasurement, startAutoTiming } from './autoTiming';
import { lyricsFeed } from '@/engine/lyricsFeed';
import { Kbd, Segmented } from './components/ui';

function useBootstrap(): void {
  const hydrate = useControl((s) => s.hydrate);
  const set = useControl((s) => s.set);

  useEffect(() => {
    const api = window.boofviz;
    engine.onStatus = (engineStatus) => set({ engineStatus });
    const offSettings = api.onSettings((s) => useControl.setState({ settings: s }));
    const offOutput = api.onOutputStatus((output) => set({ output }));
    const offLink = initExternalTempo();

    // The look follows the working preset: output gets it (throttled while dragging), session autosaves.
    let pending = false;
    let timer = 0;
    const pushQueued = (): void => {
      const q = useShow.getState().queued;
      if (q) api.sendOutputCommand({ scene: liveScene(q.entry.preset, q.entry.id), applyAtBeat: q.atBeat, transition: transitionFor(q.entry.preset) });
    };
    // `look`: a new look (blend it in); `send: false` when the output already holds it (a queued launch going live).
    const pushScene = (look = false, send = true): void => {
      pending = false;
      const { doc, sourceId, dirty } = useShow.getState();
      const scene = liveScene(doc, sourceId);
      if (send && !useControl.getState().cue) api.sendOutputCommand(look ? { scene, transition: transitionFor(doc) } : { scene });
      pushQueued();
      api.writeSession(JSON.stringify({ doc, sourceId, dirty }));
    };
    const unsubscribe = useShow.subscribe((s, prev) => {
      if (s.queued !== prev.queued) {
        // Newly queued launch: hand it to the output now so it switches on the same beat.
        if (s.queued) pushQueued();
        else if (s.doc === prev.doc && !useControl.getState().cue) api.sendOutputCommand({ scene: liveScene(s.doc, s.sourceId) });
      }
      if (s.doc === prev.doc && s.sourceId === prev.sourceId && s.dirty === prev.dirty) return;
      if (s.sourceId !== prev.sourceId) {
        // A new look goes out at once, before this window spends a frame building its preview.
        window.clearTimeout(timer);
        const fromQueue = !!prev.queued && !s.queued && prev.queued.entry.id === s.sourceId;
        pushScene(true, !fromQueue);
        return;
      }
      if (pending) return;
      pending = true;
      timer = window.setTimeout(pushScene, 33);
    });
    // Lyrics mode, themes or per-look choices changed: the screen re-routes the look it shows (no transition).
    const offLyrics = useControl.subscribe((s, prev) => {
      const a = s.settings.lyrics;
      const b = prev.settings.lyrics;
      if (a.mode !== b.mode || a.allLooks !== b.allLooks || a.themes !== b.themes || a.lookChoice !== b.lookChoice || a.custom !== b.custom || a.tune !== b.tune) pushScene();
    });
    const stopLauncher = startLauncher();
    void startMidiMap();
    const stopAutoTiming = startAutoTiming({
      silent: () => (engine.builder.connected ? engine.builder.frame.silence : null),
      now: () => Date.now(),
      song: () => lyricsFeed.now,
      enabled: () => useControl.getState().settings.lyrics.autoTiming,
      report: (d) => useControl.getState().update({ lyrics: { timing: addMeasurement(useControl.getState().settings.lyrics.timing, d) } }),
    });
    const stopSpotifySync = startSpotifyAutoSync();

    void (async () => {
      const settings = await api.getSettings();
      hydrate(settings);
      await useShow.getState().restoreSession();
      pushScene();
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
      offLink();
      unsubscribe();
      offLyrics();
      stopLauncher();
      stopAutoTiming();
      stopSpotifySync();
      window.clearTimeout(timer);
    };
  }, [hydrate, set]);

  // Push analysis settings to the worklet/worker whenever they change.
  const analysis = useControl((s) => s.settings.analysis);
  const loaded = useControl((s) => s.loaded);
  useEffect(() => {
    if (loaded) engine.setAnalysisSettings(analysis);
  }, [analysis, loaded]);

  // Link networking / MIDI listening follow the chosen tempo source.
  useEffect(() => {
    if (loaded) void applyTempoSource(analysis.tempoSource, analysis.midiInputId);
  }, [analysis.tempoSource, analysis.midiInputId, loaded]);
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      const typing = (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      const show = useShow.getState();
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !typing) {
          if (e.shiftKey) show.redo();
          else show.undo();
        } else if (k === 'y' && !typing) show.redo();
        else if (k === 's') void show.save();
        else return;
        e.preventDefault();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const s = useControl.getState();
      switch (e.key.toLowerCase()) {
        case 'tab':
          stepPreset(e.shiftKey ? -1 : 1);
          break;
        case 's':
          shuffleNow();
          break;
        case 'a':
          toggleAuto();
          break;
        case 'escape':
          if (!show.queued) return;
          show.cancelQueued();
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
          const fav = favoriteEntries()[Number(e.key) - 1];
          if (!fav) return;
          launchQuantized(fav);
          break;
        }
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
        case 'c':
          setCue(!s.cue);
          break;
        case 'g':
          if (s.cue) cueGo();
          break;
        case 'l':
          if (e.shiftKey) stepTreatment(1);
          else toggleLyrics();
          break;
        case '[':
          engine.tempo({ cmd: 'nudge', beats: -1 / 16 });
          break;
        case ']':
          engine.tempo({ cmd: 'nudge', beats: 1 / 16 });
          break;
        case 'enter':
          if (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button') return;
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

type LeftTab = 'library' | 'input' | 'lyrics' | 'perform';
type RightTab = 'layers' | 'audio' | 'master';

export function App() {
  useBootstrap();
  useShortcuts();
  const hideUi = useControl((s) => s.hideUi);
  const drop = useFileDrop();
  const [left, setLeft] = useState<LeftTab>('library');
  const [right, setRight] = useState<RightTab>('layers');

  return (
    <div className="flex h-full flex-col" {...drop}>
      {!hideUi && <TopBar />}
      <div className="flex min-h-0 flex-1">
        {!hideUi && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
            <div className="border-b border-ink-700/70 p-2">
              <Segmented
                value={left}
                onChange={setLeft}
                options={[
                  { value: 'library', label: 'Library' },
                  { value: 'input', label: 'Input' },
                  { value: 'lyrics', label: 'Lyrics' },
                  { value: 'perform', label: 'Perform' },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1">{left === 'library' ? <Library /> : left === 'input' ? <SourcePanel /> : left === 'lyrics' ? <LyricsPanel /> : <PerformPanel />}</div>
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Preview />
          </div>
          {!hideUi && <MacroStrip />}
        </main>
        {!hideUi && (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-ink-700 bg-ink-900">
            <div className="border-b border-ink-700/70 p-2">
              <Segmented
                value={right}
                onChange={setRight}
                options={[
                  { value: 'layers', label: 'Layers' },
                  { value: 'audio', label: 'Audio' },
                  { value: 'master', label: 'Master' },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1">{right === 'layers' ? <Inspector /> : right === 'audio' ? <AnalysisPanel /> : <MasterPanel />}</div>
          </aside>
        )}
      </div>
      {!hideUi && (
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-ink-700 bg-ink-900 px-3 text-[10px] text-ink-400">
          <span>
            <Kbd>Tab</Kbd> next preset
          </span>
          <span>
            <Kbd>S</Kbd> shuffle
          </span>
          <span>
            <Kbd>1–9</Kbd> favorites
          </span>
          <span>
            <Kbd>Ctrl Z</Kbd> undo
          </span>
          <span>
            <Kbd>Ctrl S</Kbd> save
          </span>
          <span>
            <Kbd>T</Kbd> tap
          </span>
          <span>
            <Kbd>[</Kbd>
            <Kbd>]</Kbd> nudge
          </span>
          <span>
            <Kbd>F</Kbd> fullscreen out
          </span>
          <span>
            <Kbd>B</Kbd> blackout
          </span>
          <span>
            <Kbd>L</Kbd> lyrics
          </span>
          <span>
            <Kbd>D</Kbd> HUD
          </span>
          <span>
            <Kbd>H</Kbd> hide UI
          </span>
          <span className="ml-auto">Phase 3 · Beat engine</span>
        </footer>
      )}
      <ContextMenuHost />
    </div>
  );
}
