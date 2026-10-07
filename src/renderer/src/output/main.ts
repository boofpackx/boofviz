/// Clean output window: no UI, no cursor, no overlays. Only the rendered frame.
import './output.css';
import { archiveNow } from '@/engine/generators/ArchiveFootage';
import { PORT_MESSAGE_TAG } from '@shared/ipc';
import { DEFAULT_GLOBALS, type GlobalControls } from '@shared/types/engine';
import { AudioFrameBuilder } from '@/audio/frameBuilder';
import { ThreeRenderer } from '@/engine/three/ThreeRenderer';
import { RenderLoop } from '@/engine/RenderLoop';
import { connectLyricsFeed, liveText, lyricAt, lyricsFeed, type TextSource } from '@/engine/lyricsFeed';
import type { Settings } from '@shared/settings';
import type { Scene } from '@shared/types/engine';

const api = window.boofviz;
const builder = new AudioFrameBuilder();
let globals: GlobalControls = { ...DEFAULT_GLOBALS };
let scene: Scene | null = null;
let applyAtBeat: number | undefined;
let renderer: ThreeRenderer | null = null;

// Read-only snapshot hook for automated smoke tests.
(window as unknown as { __BOOFVIZ_DEBUG__: unknown }).__BOOFVIZ_DEBUG__ = {
  frame: () => ({ ...builder.frame, fft: undefined, waveform: undefined, bands32: undefined, stereo: undefined }),
  packets: () => builder.packetCount,
  scene: () => scene,
  pendingBeat: () => renderer?.pendingBeat ?? null,
  lastSwitch: () => renderer?.lastSwitch ?? null,
  transition: () => renderer?.transitionInfo ?? null,
  gpu: () => renderer?.gpuInfo ?? null,
  beatAtEpoch: (ms: number) => builder.beatAtEpoch(ms),
  /** Current lyric line at an epoch time (with the overlay's lead), and what the overlay drew last frame. */
  lyricsAt: (ms: number) => lyricAt(ms, overlayLead()),
  archive: () => ({ ...archiveNow }),
  lyricsOverlay: () => renderer?.lyricsInfo ?? null,
  liveText: (source: TextSource) => liveText(source, Date.now(), 150, 3, 4),
  nowPlaying: () => ({ ...lyricsFeed.now, artDataUrl: lyricsFeed.now.artDataUrl ? '(data url)' : undefined }),
  trackLyrics: () => lyricsFeed.lyrics,
};

let lyricsSettings: Settings['lyrics'] | null = null;
const overlayLead = (): number => {
  const lead = lyricsSettings?.overlay.params.lead;
  return typeof lead === 'number' ? lead : 150;
};
const applyLyricsSettings = (s: Settings): void => {
  lyricsSettings = s.lyrics;
  lyricsFeed.offsetMs = s.lyrics.offsetMs;
  lyricsFeed.textLooks = s.lyrics.textLooks;
  renderer?.setLyricsOverlay(s.lyrics.overlay);
  renderer?.setLostMedia(s.lostMedia);
  renderer?.setRetroTv(s.retroTv);
};

// Register before any await so the analysis port can't arrive unheard.
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source === window && e.data?.tag === PORT_MESSAGE_TAG && e.ports[0]) builder.attach(e.ports[0]);
});
connectLyricsFeed(api);
api.onOutputCommand((cmd) => {
  if (cmd.globals) globals = cmd.globals;
  if (cmd.scene) {
    scene = cmd.scene;
    applyAtBeat = cmd.applyAtBeat;
    renderer?.setScene(scene, applyAtBeat, cmd.transition);
  }
});

async function start(): Promise<void> {
  const canvas = document.getElementById('out') as HTMLCanvasElement;
  const settings = await api.getSettings();
  globals = { ...settings.globals, blackout: false };
  const r = new ThreeRenderer();
  try {
    await r.init(canvas, { renderScale: settings.output.renderScale, isOutput: true });
  } catch (err) {
    // Stay black on the projector; the control window reports the problem.
    console.error('BOOFVIZ output: WebGL2 unavailable', err);
    return;
  }
  renderer = r;
  applyLyricsSettings(settings);
  // Black until the control window sends the scene (main replays it on load).
  if (scene) r.setScene(scene, applyAtBeat);

  const fit = (): void => r.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  fit();
  window.addEventListener('resize', fit);
  api.onSettings((s) => {
    r.setRenderScale(s.output.renderScale);
    applyLyricsSettings(s);
  });

  const loop = new RenderLoop(r, builder, () => globals);
  loop.run();

  setInterval(() => {
    api.reportOutputStats({ fps: Math.round(loop.fps), width: r.stats.width, height: r.stats.height });
  }, 1000);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') void api.toggleOutputFullscreen();
  });
  window.addEventListener('dblclick', () => void api.toggleOutputFullscreen());
}

void start();
