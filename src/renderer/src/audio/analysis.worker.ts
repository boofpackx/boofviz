/// Analysis worker: musical features, onsets, tempo. Fans packets out to every consumer.
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisPacket, type AnalysisSettings, type ClockSync, type RawHop } from '@shared/types/audio';
import { AnalysisCore, type HopFeatures } from './dsp/analysisCore';
import type { TempoCommand } from './tempo/beatClock';
import { TempoPipeline } from './tempo/pipeline';

export type WorkerInMessage =
  | { type: 'init'; port: MessagePort }
  | { type: 'settings'; analysis: AnalysisSettings; extraLatencyMs: number }
  | { type: 'addConsumer'; id: string; port: MessagePort }
  | { type: 'removeConsumer'; id: string }
  | { type: 'clock'; clock: ClockSync }
  | { type: 'tempo'; command: TempoCommand }
  | { type: 'external'; source: 'link' | 'midiClock'; bpm: number; beat: number; epochMs: number };

let settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS;
let extraLatencyMs = 0;
let core: AnalysisCore | null = null;
let features: HopFeatures = AnalysisCore.allocFeatures();
let tempo: TempoPipeline | null = null;
let workletPort: MessagePort | null = null;
let clock: ClockSync = { ctxTime: 0, epochMs: 0 };
// Commands that arrive before the first hop (tap, external) wait for the pipeline.
const pending: Array<(t: TempoPipeline) => void> = [];
const consumers = new Map<string, MessagePort>();

function applySettings(): void {
  core?.setSettings(settings);
  tempo?.configure(settings);
}

function onHop(hop: RawHop): void {
  if (!core || core.sampleRate !== hop.sampleRate) {
    core = new AnalysisCore(hop.sampleRate);
    features = AnalysisCore.allocFeatures();
    tempo = new TempoPipeline(core.hopRate);
    applySettings();
    for (const fn of pending.splice(0)) fn(tempo);
  }
  const f = core.process(hop, features);
  tempo!.process(f, settings);

  const packet: AnalysisPacket = {
    type: 'analysis',
    t: f.t,
    fft: f.fft,
    bands: f.bands,
    bands32: f.bands32,
    wave: hop.wave,
    left: hop.left,
    right: hop.right,
    rms: f.rms,
    peak: f.peak,
    lufs: f.lufs,
    energy: f.energy,
    energyTrend: f.energyTrend,
    kick: f.kick,
    snare: f.snare,
    hat: f.hat,
    any: f.any,
    odfKick: f.odfKick,
    odfSnare: f.odfSnare,
    odfHat: f.odfHat,
    brightness: f.brightness,
    flux: f.flux,
    drop: f.drop,
    silence: f.silence,
    width: f.width,
    phase: f.phase,
    balance: f.balance,
    inputLevelDb: f.inputLevelDb,
    appliedGain: hop.appliedGain,
    latencyMs: settings.latencyMs + extraLatencyMs,
    tempo: tempo!.state,
    clock,
  };
  for (const port of consumers.values()) port.postMessage(packet); // structured clone (copies)

  // Return the hop's buffers to the worklet's pool.
  workletPort?.postMessage({ mag: hop.mag, wave: hop.wave, left: hop.left, right: hop.right }, [hop.mag.buffer, hop.wave.buffer, hop.left.buffer, hop.right.buffer]);
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      workletPort = m.port;
      workletPort.onmessage = (ev: MessageEvent<RawHop>) => onHop(ev.data);
      break;
    case 'settings':
      settings = m.analysis;
      extraLatencyMs = m.extraLatencyMs;
      applySettings();
      break;
    case 'addConsumer':
      consumers.get(m.id)?.close();
      consumers.set(m.id, m.port);
      break;
    case 'removeConsumer':
      consumers.get(m.id)?.close();
      consumers.delete(m.id);
      break;
    case 'clock':
      clock = m.clock;
      break;
    case 'external': {
      if (!clock.epochMs) break;
      // Session beat at epochMs → audio-clock time; consumers render at (now − latency),
      // so fold the latency (and the user's display offset) into the anchor.
      const ctx = clock.ctxTime + (m.epochMs - clock.epochMs) / 1000;
      const shift = (settings.latencyMs + extraLatencyMs + settings.externalOffsetMs) / 1000;
      const msg = m;
      const run = (t: TempoPipeline): void => t.external(msg.source, msg.bpm, msg.beat, ctx - shift);
      if (tempo) run(tempo);
      break;
    }
    case 'tempo': {
      const cmd = m.command;
      if (tempo) tempo.command(cmd);
      else pending.push((t) => t.command(cmd));
      if (cmd.cmd === 'tap' && settings.tempoSource !== 'tap') settings = { ...settings, tempoSource: 'tap' };
      break;
    }
  }
};
