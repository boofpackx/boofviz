import { PORT_MESSAGE_TAG } from '@shared/ipc';
import { AudioEngine } from '@/audio/AudioEngine';

/** Process-wide singletons for the control window (outside React's lifecycle). */
export const engine = new AudioEngine();

// Read-only snapshot hook for automated smoke tests.
(window as unknown as { __BOOFVIZ_DEBUG__: unknown }).__BOOFVIZ_DEBUG__ = {
  frame: () => ({ ...engine.builder.frame, fft: undefined, waveform: undefined, bands32: Array.from(engine.builder.frame.bands32), stereo: undefined }),
  status: () => engine.status,
  packets: () => engine.builder.packetCount,
  beatAtEpoch: (ms: number) => engine.builder.beatAtEpoch(ms),
  builder: engine.builder,
};

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
