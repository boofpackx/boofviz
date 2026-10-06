/// Clean output window: no UI, no cursor, no overlays. Only the rendered frame.
import './output.css';
import { PORT_MESSAGE_TAG } from '@shared/ipc';
import { DEFAULT_GLOBALS, type GlobalControls } from '@shared/types/engine';
import { AudioFrameBuilder } from '@/audio/frameBuilder';
import { ThreeRenderer } from '@/engine/three/ThreeRenderer';
import { RenderLoop } from '@/engine/RenderLoop';
import { DEFAULT_SCENE } from '@/engine/defaultScene';

const api = window.boofviz;
const builder = new AudioFrameBuilder();
let globals: GlobalControls = { ...DEFAULT_GLOBALS };

// Read-only snapshot hook for automated smoke tests.
(window as unknown as { __BOOFVIZ_DEBUG__: unknown }).__BOOFVIZ_DEBUG__ = {
  frame: () => ({ ...builder.frame, fft: undefined, waveform: undefined, bands32: undefined, stereo: undefined }),
  packets: () => builder.packetCount,
  beatAtEpoch: (ms: number) => builder.beatAtEpoch(ms),
};

// Register before any await so the analysis port can't arrive unheard.
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source === window && e.data?.tag === PORT_MESSAGE_TAG && e.ports[0]) builder.attach(e.ports[0]);
});
api.onOutputCommand((cmd) => {
  if (cmd.globals) globals = cmd.globals;
});

async function start(): Promise<void> {
  const canvas = document.getElementById('out') as HTMLCanvasElement;
  const settings = await api.getSettings();
  globals = { ...settings.globals, blackout: false };
  const renderer = new ThreeRenderer();
  try {
    await renderer.init(canvas, { renderScale: settings.output.renderScale, isOutput: true });
  } catch (err) {
    // Stay black on the projector; the control window reports the problem.
    console.error('BOOFVIZ output: WebGL2 unavailable', err);
    return;
  }
  renderer.setScene(DEFAULT_SCENE);

  const fit = (): void => renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  fit();
  window.addEventListener('resize', fit);
  api.onSettings((s) => renderer.setRenderScale(s.output.renderScale));

  const loop = new RenderLoop(renderer, builder, () => globals);
  loop.run();

  setInterval(() => {
    api.reportOutputStats({ fps: Math.round(loop.fps), width: renderer.stats.width, height: renderer.stats.height });
  }, 1000);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') void api.toggleOutputFullscreen();
  });
  window.addEventListener('dblclick', () => void api.toggleOutputFullscreen());
}

void start();
