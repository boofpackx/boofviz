import { lyricsOffsetMs } from '@shared/settings';
import { PORT_MESSAGE_TAG } from '@shared/ipc';
import { archiveNow } from '@/engine/generators/ArchiveFootage';
import { AudioEngine } from '@/audio/AudioEngine';
import type { ThreeRenderer } from '@/engine/three/ThreeRenderer';
import { connectLyricsFeed, lyricAt, lyricsFeed } from '@/engine/lyricsFeed';
import { libraryEntries, useShow } from './show';
import { useControl } from './store';

/** Process-wide singletons for the control window (outside React's lifecycle). */
export const engine = new AudioEngine();

/** The preview renderer (for live modulation meters). */
export const preview: { renderer: ThreeRenderer | null } = { renderer: null };

/** Current value (0..1 of its range) of a modulated parameter, or undefined. */
export function liveValue(layerId: string, path: string): number | undefined {
  return preview.renderer?.live?.get(`${layerId}|${path}`);
}

// Read-only snapshot hook for automated smoke tests.
(window as unknown as { __BOOFVIZ_DEBUG__: unknown }).__BOOFVIZ_DEBUG__ = {
  frame: () => ({ ...engine.builder.frame, fft: undefined, waveform: undefined, bands32: Array.from(engine.builder.frame.bands32), stereo: undefined }),
  status: () => engine.status,
  packets: () => engine.builder.packetCount,
  beatAtEpoch: (ms: number) => engine.builder.beatAtEpoch(ms),
  builder: engine.builder,
  presets: () => [...libraryEntries().presets, ...libraryEntries().templates].map((e) => e.id),
  load: (id: string) => {
    const all = [...libraryEntries().presets, ...libraryEntries().templates];
    const e = all.find((x) => x.id === id);
    if (e) useShow.getState().load(e);
    return !!e;
  },
  show: () => useShow.getState(),
  settings: () => useControl.getState().settings,
  updateSettings: (patch: Parameters<ReturnType<typeof useControl.getState>['update']>[0]) => useControl.getState().update(patch),
  gpu: () => preview.renderer?.gpuInfo ?? null,
  previewLastSwitch: () => preview.renderer?.lastSwitch ?? null,
  /** Current lyric line at an epoch time (with the overlay's lead), and what the preview's overlay drew last frame. */
  lyricsAt: (ms: number) => lyricAt(ms, overlayLead()),
  archive: () => ({ ...archiveNow }),
  lyricsOverlay: () => preview.renderer?.lyricsInfo ?? null,
  nowPlaying: () => ({ ...lyricsFeed.now, artDataUrl: lyricsFeed.now.artDataUrl ? '(data url)' : undefined }),
  trackLyrics: () => lyricsFeed.lyrics,
};

function overlayLead(): number {
  const lead = useControl.getState().settings.lyrics.overlay.params.lead;
  return typeof lead === 'number' ? lead : 150;
}

// Now playing + lyrics from main (registered at load, so main's replay is never missed).
connectLyricsFeed(window.boofviz, () => useControl.setState({ nowPlaying: lyricsFeed.now, trackLyrics: lyricsFeed.lyrics }));
useControl.subscribe((s) => {
  lyricsFeed.offsetMs = lyricsOffsetMs(s.settings.lyrics);
  lyricsFeed.textLooks = s.settings.lyrics.textLooks;
});

let ready = false;
const pendingPorts: MessagePort[] = [];

// The output window's analysis port can arrive before the audio engine exists.
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window || e.data?.tag !== PORT_MESSAGE_TAG || !e.ports[0]) return;
  if (ready) engine.addConsumer('output', e.ports[0]);
  else pendingPorts.push(e.ports[0]);
});

let initPromise: Promise<void> | null = null;

export function initEngine(): Promise<void> {
  return (initPromise ??= engine.init().then(() => {
    ready = true;
    const last = pendingPorts.pop();
    pendingPorts.length = 0;
    if (last) engine.addConsumer('output', last);
  }));
}
