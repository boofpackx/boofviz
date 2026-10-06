/// AudioWorklet: sample-accurate front end. Runs on the audio rendering thread.
import { allocHopBuffers, HopAnalyzer, type HopAnalyzerSettings, type HopBuffers } from '../dsp/hopAnalyzer';
import type { RawHop } from '@shared/types/audio';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor & { process(inputs: Float32Array[][]): boolean }): void;

type InMessage = { type: 'settings'; settings: HopAnalyzerSettings } | { type: 'connect'; port: MessagePort };

const POOL_LIMIT = 24;

class AnalyzerProcessor extends AudioWorkletProcessor {
  private readonly pool: HopBuffers[] = [];
  private out: MessagePort | null = null;
  private readonly analyzer: HopAnalyzer;

  constructor() {
    super();
    this.analyzer = new HopAnalyzer(
      sampleRate,
      (hop, buf) => this.send(hop, buf),
      () => this.pool.pop() ?? allocHopBuffers(),
    );
    this.port.onmessage = (e: MessageEvent<InMessage>) => {
      const m = e.data;
      if (m.type === 'settings') this.analyzer.setSettings(m.settings);
      else if (m.type === 'connect') {
        this.out = m.port;
        // The worker hands buffers back so the audio thread never allocates in steady state.
        this.out.onmessage = (ev: MessageEvent<HopBuffers>) => {
          if (this.pool.length < POOL_LIMIT) this.pool.push(ev.data);
        };
      }
    };
  }

  private send(hop: RawHop, buf: HopBuffers): void {
    if (!this.out) {
      if (this.pool.length < POOL_LIMIT) this.pool.push(buf);
      return;
    }
    this.out.postMessage(hop, [buf.mag.buffer, buf.wave.buffer, buf.left.buffer, buf.right.buffer]);
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0];
    const left = ch?.[0];
    const frames = left?.length ?? 128;
    this.analyzer.process(left, ch?.[1], frames, currentTime);
    return true;
  }
}

registerProcessor('boofviz-analyzer', AnalyzerProcessor);
