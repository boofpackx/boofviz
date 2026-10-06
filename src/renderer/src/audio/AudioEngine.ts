import type { AnalysisSettings, ClockSync } from '@shared/types/audio';
import type { InputSettings } from '@shared/settings';
import workletUrl from './worklet/analyzer.worklet.ts?worker&url';
import AnalysisWorker from './analysis.worker.ts?worker';
import type { WorkerInMessage } from './analysis.worker';
import type { TempoCommand } from './tempo/beatClock';
import { AudioFrameBuilder, epochNow } from './frameBuilder';

export interface InputDevice {
  deviceId: string;
  label: string;
  isVirtualCable: boolean;
}

export type EngineStatus =
  | { state: 'idle' }
  | { state: 'starting'; label: string }
  | { state: 'running'; label: string; channels: number; sampleRate: number }
  | { state: 'error'; label: string; message: string; hint?: 'loopback-unsupported' | 'permission' | 'device' };

const VIRTUAL_CABLE = /cable output|vb-audio|voicemeeter|blackhole|loopback audio|soundflower|virtual/i;

type TempoCommandInput = TempoCommand extends infer C ? (C extends { t: number } ? Omit<C, 't'> : never) : never;

/**
 * Control-window audio graph: capture source → (channel pair) → analysis
 * worklet → analysis worker → consumers (this window's preview and the output
 * window, each over its own MessagePort).
 */
export class AudioEngine {
  readonly builder = new AudioFrameBuilder();
  status: EngineStatus = { state: 'idle' };
  onStatus: (s: EngineStatus) => void = () => {};

  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private source: AudioNode | null = null;
  private routing: AudioNode[] = [];
  private stream: MediaStream | null = null;
  private media: HTMLAudioElement | null = null;
  private mediaUrl: string | null = null;
  private clockTimer = 0;
  private clockOffsets: number[] = [];
  private analysis: AnalysisSettings | null = null;
  private fileMode = false;

  async init(): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'boofviz-analyzer', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    // Keep the node pulled by the graph without making a sound.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    this.node = node;

    const worker = new AnalysisWorker();
    this.worker = worker;
    const hops = new MessageChannel();
    node.port.postMessage({ type: 'connect', port: hops.port1 }, [hops.port1]);
    this.post({ type: 'init', port: hops.port2 }, [hops.port2]);

    const own = new MessageChannel();
    this.addConsumer('control', own.port2);
    this.builder.attach(own.port1);

    this.clockTimer = window.setInterval(() => this.syncClock(), 200);
    this.syncClock();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  }

  private post(m: WorkerInMessage, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, transfer);
  }

  addConsumer(id: string, port: MessagePort): void {
    this.post({ type: 'addConsumer', id, port }, [port]);
  }

  /**
   * Map the audio clock to epoch time so other windows can extrapolate the beat.
   * ctx.currentTime advances in render quanta, so keep the max offset seen recently.
   */
  private syncClock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const epoch = epochNow();
    this.clockOffsets.push(ctx.currentTime - epoch / 1000);
    if (this.clockOffsets.length > 10) this.clockOffsets.shift();
    const offset = Math.max(...this.clockOffsets);
    const clock: ClockSync = { ctxTime: offset + epoch / 1000, epochMs: epoch };
    this.post({ type: 'clock', clock });
  }

  setAnalysisSettings(a: AnalysisSettings): void {
    this.analysis = a;
    this.node?.port.postMessage({ type: 'settings', settings: { gainDb: a.gainDb, autoGain: a.autoGain, gateDb: a.gateDb } });
    this.pushWorkerSettings();
  }

  private pushWorkerSettings(): void {
    if (!this.analysis || !this.ctx) return;
    // A local file plays through our own output, so compensate its output latency automatically.
    const extra = this.fileMode ? ((this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)) * 1000 : 0;
    this.post({ type: 'settings', analysis: this.analysis, extraLatencyMs: extra });
  }

  tempo(cmd: TempoCommandInput): void {
    if (!this.ctx) return;
    this.post({ type: 'tempo', command: { ...cmd, t: this.ctx.currentTime } as TempoCommand });
  }

  async listDevices(): Promise<InputDevice[]> {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some((d) => d.kind === 'audioinput' && !d.label)) {
      // Labels stay hidden until media permission has been exercised once.
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        /* keep unlabeled list */
      }
    }
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}`, isVirtualCable: VIRTUAL_CABLE.test(d.label) }));
  }

  private setStatus(s: EngineStatus): void {
    this.status = s;
    this.onStatus(s);
  }

  private teardownSource(): void {
    this.source?.disconnect();
    for (const n of this.routing) n.disconnect();
    this.routing = [];
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.media) {
      this.media.pause();
      this.media.removeAttribute('src');
      this.media.load();
      this.media = null;
    }
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = null;
    this.fileMode = false;
  }

  async setInput(input: InputSettings): Promise<void> {
    if (input.kind === 'file') return; // files are started with loadFile()
    const ctx = this.ctx;
    if (!ctx || !this.node) return;
    this.teardownSource();
    const label = input.kind === 'loopback' ? 'System Audio' : (input.deviceLabel ?? 'Input device');
    this.setStatus({ state: 'starting', label });
    try {
      if (input.kind === 'loopback') {
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        stream.getVideoTracks().forEach((t) => {
          t.stop();
          stream.removeTrack(t);
        });
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach((t) => t.stop());
          throw Object.assign(new Error('System audio capture is not available on this OS.'), { hint: 'loopback-unsupported' as const });
        }
        this.stream = stream;
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: input.deviceId ? { exact: input.deviceId } : undefined,
            channelCount: { ideal: 8 },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      const track = this.stream.getAudioTracks()[0];
      track.addEventListener('ended', () => this.setStatus({ state: 'error', label, message: 'The audio source stopped.', hint: 'device' }));
      const src = ctx.createMediaStreamSource(this.stream);
      const channels = track.getSettings().channelCount ?? src.channelCount ?? 2;
      this.source = src;
      this.connectToAnalyzer(src, channels, input.channelPair);
      if (ctx.state !== 'running') await ctx.resume();
      this.pushWorkerSettings();
      this.setStatus({ state: 'running', label, channels, sampleRate: ctx.sampleRate });
    } catch (err) {
      const e = err as Error & { hint?: 'loopback-unsupported' };
      const permission = e.name === 'NotAllowedError' || e.name === 'SecurityError';
      this.setStatus({
        state: 'error',
        label,
        message: e.message || String(err),
        hint: e.hint ?? (permission ? 'permission' : 'device'),
      });
    }
  }

  /** Route a (possibly multi-channel) source into the analyzer, picking one stereo pair. */
  private connectToAnalyzer(src: AudioNode, channels: number, pair: number): void {
    const ctx = this.ctx!;
    if (channels <= 2 || pair <= 0) {
      src.connect(this.node!);
      return;
    }
    const first = Math.min(pair, channels - 2);
    const splitter = ctx.createChannelSplitter(channels);
    const merger = ctx.createChannelMerger(2);
    src.connect(splitter);
    splitter.connect(merger, first, 0);
    splitter.connect(merger, first + 1, 1);
    merger.connect(this.node!);
    this.routing = [splitter, merger];
  }

  /** Play a local audio file through the speakers and analyse it. */
  async loadFile(file: File): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.node) return;
    this.teardownSource();
    this.setStatus({ state: 'starting', label: file.name });
    try {
      const url = URL.createObjectURL(file);
      const el = new Audio();
      el.src = url;
      el.loop = true;
      el.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(el);
      src.connect(ctx.destination);
      src.connect(this.node);
      this.source = src;
      this.media = el;
      this.mediaUrl = url;
      this.fileMode = true;
      if (ctx.state !== 'running') await ctx.resume();
      await el.play();
      this.pushWorkerSettings();
      this.setStatus({ state: 'running', label: file.name, channels: 2, sampleRate: ctx.sampleRate });
    } catch (err) {
      this.setStatus({ state: 'error', label: file.name, message: (err as Error).message, hint: 'device' });
    }
  }

  get filePlayer(): HTMLAudioElement | null {
    return this.media;
  }

  dispose(): void {
    window.clearInterval(this.clockTimer);
    this.teardownSource();
    this.worker?.terminate();
    void this.ctx?.close();
  }
}
