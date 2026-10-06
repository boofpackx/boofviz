/// Analysis worker: musical features, onsets, tempo. Fans packets out to every consumer.
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisPacket, type AnalysisSettings, type ClockSync, type RawHop } from '@shared/types/audio';
import { AnalysisCore, type HopFeatures } from './dsp/analysisCore';
import { BpmEstimator, TapTempo } from './tempo/bpm';
import { TempoTracker, type TempoCommand } from './tempo/beatClock';

export type WorkerInMessage =
  | { type: 'init'; port: MessagePort }
  | { type: 'settings'; analysis: AnalysisSettings; extraLatencyMs: number }
  | { type: 'addConsumer'; id: string; port: MessagePort }
  | { type: 'removeConsumer'; id: string }
  | { type: 'clock'; clock: ClockSync }
  | { type: 'tempo'; command: TempoCommand };

let settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS;
let extraLatencyMs = 0;
let core: AnalysisCore | null = null;
let features: HopFeatures = AnalysisCore.allocFeatures();
let estimator: BpmEstimator | null = null;
let workletPort: MessagePort | null = null;
let clock: ClockSync = { ctxTime: 0, epochMs: 0 };
let hopsSinceEstimate = 0;
const tracker = new TempoTracker();
const tap = new TapTempo();
const consumers = new Map<string, MessagePort>();

function applySettings(): void {
  core?.setSettings(settings);
  tracker.setBeatsPerPhrase(settings.beatsPerPhrase);
  if (tracker.state.source !== settings.tempoSource && (settings.tempoSource === 'auto' || settings.tempoSource === 'tap')) {
    tracker.setSource(settings.tempoSource);
  }
}

function onHop(hop: RawHop): void {
  if (!core || core.sampleRate !== hop.sampleRate) {
    core = new AnalysisCore(hop.sampleRate);
    features = AnalysisCore.allocFeatures();
    estimator = new BpmEstimator(core.hopRate);
    applySettings();
  }
  const f = core.process(hop, features);

  // Tempo: estimate twice a second from the onset-strength envelope.
  estimator!.push(f.tempoOdf, f.t);
  if (++hopsSinceEstimate >= Math.round(core.hopRate / 2)) {
    hopsSinceEstimate = 0;
    if (!f.silence) {
      const est = estimator!.update(settings.bpmRange[0], settings.bpmRange[1]);
      if (est) tracker.applyEstimate(est, f.t, settings.bpmRange);
    }
  }
  if (f.kick) tracker.observeKick(f.t, Math.min(2, f.odfKick), f.bassLevel);

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
    tempo: tracker.state,
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
    case 'tempo':
      tracker.command(m.command, (t) => tap.tap(t));
      if (m.command.cmd === 'tap' && settings.tempoSource !== 'tap') settings = { ...settings, tempoSource: 'tap' };
      break;
  }
};
