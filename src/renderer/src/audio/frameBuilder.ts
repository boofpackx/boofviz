import {
  BAND_NAMES,
  SPECTRUM_BINS,
  WAVEFORM_SIZE,
  type AnalysisPacket,
  type AudioFrame,
  type ConsumerMessage,
  type TempoState,
} from '@shared/types/audio';

export function emptyFrame(): AudioFrame {
  return {
    time: 0,
    fft: new Float32Array(SPECTRUM_BINS),
    bands: { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, air: 0 },
    bands32: new Float32Array(32),
    waveform: new Float32Array(WAVEFORM_SIZE),
    stereo: { left: new Float32Array(WAVEFORM_SIZE), right: new Float32Array(WAVEFORM_SIZE), width: 0, phase: 1, balance: 0 },
    rms: 0,
    peak: 0,
    loudnessLUFS: -70,
    energy: 0,
    energyTrend: 'steady',
    onsets: { kick: false, snare: false, hat: false, any: false },
    bpm: 120,
    beat: 0,
    beatPhase: 0,
    barPhase: 0,
    phrasePhase: 0,
    isDownbeat: false,
    isPhraseStart: false,
    bpmConfidence: 0,
    tempoSource: 'auto',
    beatsPerBar: 4,
    beatsPerPhrase: 16,
    brightness: 0,
    flux: 0,
    drop: false,
    silence: true,
  };
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Epoch milliseconds with sub-ms precision, comparable across windows. */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * Consumer-side assembly of the per-render-frame AudioFrame. Receives analysis
 * packets at hop rate (~94/s), applies the latency offset, latches one-frame
 * events (onsets, drop, downbeat) and extrapolates the beat clock to "now".
 *
 * The AudioFrame object and its arrays are reused every frame.
 */
export class AudioFrameBuilder {
  readonly frame: AudioFrame = emptyFrame();
  /** Most recently applied packet (HUD extras like onset detection levels). */
  latest: AnalysisPacket | null = null;
  private readonly queue: AnalysisPacket[] = [];
  private tempo: TempoState | null = null;
  private clockCtx = 0;
  private clockEpoch = 0;
  private latencySec = 0;
  private lastBeat = -Infinity;
  private lastBeatInt = Number.NaN;
  private pendingKick = false;
  private pendingSnare = false;
  private pendingHat = false;
  private pendingAny = false;
  private pendingDrop = false;
  private port: MessagePort | null = null;
  /** Packets received (for connection status). */
  packetCount = 0;
  lastPacketEpoch = 0;

  attach(port: MessagePort): void {
    if (this.port) this.port.close();
    this.port = port;
    port.onmessage = (e: MessageEvent<ConsumerMessage>) => this.receive(e.data);
    port.start();
  }

  receive(m: ConsumerMessage): void {
    this.tempo = m.tempo;
    this.clockCtx = m.clock.ctxTime;
    this.clockEpoch = m.clock.epochMs;
    if (m.type !== 'analysis') return;
    this.latencySec = m.latencyMs / 1000;
    this.packetCount++;
    this.lastPacketEpoch = epochNow();
    this.queue.push(m);
    // Bounded: the max latency offset (200 ms) is ~20 packets.
    if (this.queue.length > 96) this.queue.splice(0, this.queue.length - 96);
  }

  /** Audio-clock time "now" in this window. */
  ctxNow(): number {
    if (!this.clockEpoch) return 0;
    return this.clockCtx + (epochNow() - this.clockEpoch) / 1000;
  }

  /** Beat-clock value at an absolute epoch time (for cross-window sync checks). */
  beatAtEpoch(epochMs: number): number {
    const s = this.tempo;
    if (!s || !this.clockEpoch) return Number.NaN;
    const t = this.clockCtx + (epochMs - this.clockEpoch) / 1000 - this.latencySec;
    return s.anchorBeat + ((t - s.anchorTime) * s.bpm) / 60;
  }

  get connected(): boolean {
    return this.packetCount > 0 && epochNow() - this.lastPacketEpoch < 500;
  }

  build(): AudioFrame {
    const f = this.frame;
    const now = this.ctxNow();
    const due = now - Math.max(0, this.latencySec);

    let applied: AnalysisPacket | null = null;
    while (this.queue.length && this.queue[0].t <= due) {
      const p = this.queue.shift()!;
      this.pendingKick ||= p.kick;
      this.pendingSnare ||= p.snare;
      this.pendingHat ||= p.hat;
      this.pendingAny ||= p.any;
      this.pendingDrop ||= p.drop;
      applied = p;
    }
    if (applied) this.apply(applied);
    else if (this.latest && epochNow() - this.lastPacketEpoch > 500) this.decayToSilence();

    f.onsets.kick = this.pendingKick;
    f.onsets.snare = this.pendingSnare;
    f.onsets.hat = this.pendingHat;
    f.onsets.any = this.pendingAny;
    f.drop = this.pendingDrop;
    this.pendingKick = this.pendingSnare = this.pendingHat = this.pendingAny = this.pendingDrop = false;

    // Continuous audio-clock time shared by every window (wall clock until audio starts).
    f.time = this.clockEpoch ? now - this.latencySec : performance.now() / 1000;
    this.updateClock(now - this.latencySec);
    return f;
  }

  private apply(p: AnalysisPacket): void {
    const f = this.frame;
    this.latest = p;
    f.fft.set(p.fft);
    for (let i = 0; i < BAND_NAMES.length; i++) f.bands[BAND_NAMES[i]] = p.bands[i];
    f.bands32.set(p.bands32);
    f.waveform.set(p.wave);
    f.stereo.left.set(p.left);
    f.stereo.right.set(p.right);
    f.stereo.width = p.width;
    f.stereo.phase = p.phase;
    f.stereo.balance = p.balance;
    f.rms = p.rms;
    f.peak = p.peak;
    f.loudnessLUFS = p.lufs;
    f.energy = p.energy;
    f.energyTrend = p.energyTrend;
    f.brightness = p.brightness;
    f.flux = p.flux;
    f.silence = p.silence;
  }

  /** Source vanished (worker stalled / window disconnected): fade rather than freeze. */
  private decayToSilence(): void {
    const f = this.frame;
    for (let i = 0; i < f.fft.length; i++) f.fft[i] *= 0.9;
    for (let i = 0; i < 32; i++) f.bands32[i] *= 0.9;
    for (const k of BAND_NAMES) f.bands[k] *= 0.9;
    f.waveform.fill(0);
    f.rms *= 0.9;
    f.peak *= 0.9;
    f.silence = true;
  }

  private updateClock(t: number): void {
    const f = this.frame;
    const s = this.tempo;
    f.isDownbeat = false;
    f.isPhraseStart = false;
    if (!s) return;
    let beat = s.anchorBeat + ((t - s.anchorTime) * s.bpm) / 60;
    // Phase corrections may nudge the clock back a hair; hold rather than run backwards.
    if (beat < this.lastBeat && beat > this.lastBeat - 0.5) beat = this.lastBeat;
    this.lastBeat = beat;

    f.bpm = s.bpm;
    f.bpmConfidence = s.confidence;
    f.tempoSource = s.source;
    f.beatsPerBar = s.beatsPerBar;
    f.beatsPerPhrase = s.beatsPerPhrase;
    f.beat = beat;
    f.beatPhase = mod(beat, 1);
    f.barPhase = mod(beat - s.downbeatOffset, s.beatsPerBar) / s.beatsPerBar;
    f.phrasePhase = mod(beat - s.phraseOffset, s.beatsPerPhrase) / s.beatsPerPhrase;

    const beatInt = Math.floor(beat);
    if (beatInt !== this.lastBeatInt) {
      if (!Number.isNaN(this.lastBeatInt) && beatInt > this.lastBeatInt) {
        f.isDownbeat = mod(beatInt - s.downbeatOffset, s.beatsPerBar) === 0;
        f.isPhraseStart = mod(beatInt - s.phraseOffset, s.beatsPerPhrase) === 0;
      }
      this.lastBeatInt = beatInt;
    }
  }
}
