/**
 * Audio contracts shared by the control window, the output window, the
 * analysis worklet and the tempo worker.
 */

export type BandName = 'sub' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'presence' | 'air';

export const BAND_NAMES: readonly BandName[] = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'air'];

/** Frequency edges (Hz) for the seven named bands. */
export const BAND_EDGES: Record<BandName, [number, number]> = {
  sub: [20, 60],
  bass: [60, 250],
  lowMid: [250, 500],
  mid: [500, 2000],
  highMid: [2000, 4000],
  presence: [4000, 6000],
  air: [6000, 20000],
};

export type Bands = Record<BandName, number>;

export type OnsetKind = 'kick' | 'snare' | 'hat';

export type EnergyTrend = 'building' | 'dropping' | 'steady';

export type TempoSourceKind = 'auto' | 'tap' | 'link' | 'midiClock';

/**
 * The single object every visual reads from. One instance is reused per
 * consumer and mutated in place each render frame (no per-frame allocation).
 */
export interface AudioFrame {
  /**
   * Continuous audio-clock time in seconds for this frame (latency offset
   * applied). Identical across windows, so time-based animation stays in sync.
   */
  time: number;

  // Spectrum
  /** 2048 bins, log-frequency (20 Hz → Nyquist), dB-mapped to 0..1, smoothed. */
  fft: Float32Array;
  /** Seven named bands, 0..1, auto-normalized, per-band attack/release. */
  bands: Bands;
  /** 32-band log EQ, 0..1. */
  bands32: Float32Array;
  /** Mono time-domain samples (post gain), -1..1. */
  waveform: Float32Array;
  stereo: {
    left: Float32Array;
    right: Float32Array;
    /** 0 = mono, 1 = very wide. */
    width: number;
    /** Inter-channel correlation, -1..1 (1 = in phase). */
    phase: number;
    /** -1 = hard left, 1 = hard right. */
    balance: number;
  };

  // Dynamics
  rms: number;
  peak: number;
  /** Momentary loudness (400 ms, K-weighted). */
  loudnessLUFS: number;
  /** 0..1 slow-moving "how hyped is the track". */
  energy: number;
  energyTrend: EnergyTrend;

  // Events: true for exactly one rendered frame.
  onsets: { kick: boolean; snare: boolean; hat: boolean; any: boolean };

  // Musical time
  bpm: number;
  /** Continuous beat counter, e.g. 137.42. */
  beat: number;
  beatPhase: number;
  barPhase: number;
  phrasePhase: number;
  isDownbeat: boolean;
  isPhraseStart: boolean;
  /** 0..1 confidence of the current tempo estimate. */
  bpmConfidence: number;
  tempoSource: TempoSourceKind;
  beatsPerBar: number;
  beatsPerPhrase: number;

  // Character (smoothed, slow)
  brightness: number;
  flux: number;
  drop: boolean;
  silence: boolean;
}

export interface BandSmoothing {
  attackMs: number;
  releaseMs: number;
}

/** User-facing analysis settings (persisted). */
export interface AnalysisSettings {
  /** Input gain in dB, -24..+24. */
  gainDb: number;
  /** Noise gate threshold in dBFS; below this the input counts as silence. */
  gateDb: number;
  autoGain: boolean;
  /** Visual latency offset in ms, -200..+200. Positive delays visuals. */
  latencyMs: number;
  beatsPerPhrase: 8 | 16 | 32;
  onsetSensitivity: Record<OnsetKind, number>;
  bandSmoothing: Record<BandName, BandSmoothing>;
  /** Smoothing for the fft/bands32 display data. */
  spectrumSmoothing: BandSmoothing;
  bpmRange: [number, number];
  tempoSource: TempoSourceKind;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  gainDb: 0,
  gateDb: -60,
  autoGain: true,
  latencyMs: 0,
  beatsPerPhrase: 16,
  onsetSensitivity: { kick: 0.6, snare: 0.5, hat: 0.5 },
  bandSmoothing: {
    sub: { attackMs: 8, releaseMs: 180 },
    bass: { attackMs: 8, releaseMs: 160 },
    lowMid: { attackMs: 10, releaseMs: 140 },
    mid: { attackMs: 10, releaseMs: 120 },
    highMid: { attackMs: 6, releaseMs: 100 },
    presence: { attackMs: 5, releaseMs: 90 },
    air: { attackMs: 4, releaseMs: 80 },
  },
  spectrumSmoothing: { attackMs: 10, releaseMs: 140 },
  bpmRange: [70, 180],
  tempoSource: 'auto',
};

// ---------------------------------------------------------------------------
// Wire protocol (worklet → tempo/analysis worker → consumers)
// ---------------------------------------------------------------------------

export const FFT_SIZE = 4096;
export const ONSET_FFT_SIZE = 1024;
export const HOP_SIZE = 512;
export const SPECTRUM_BINS = 2048;
export const WAVEFORM_SIZE = 1024;

/** Raw per-hop measurement posted by the AudioWorklet. */
export interface RawHop {
  type: 'hop';
  /** AudioContext time (s) of the newest sample in this hop. */
  t: number;
  sampleRate: number;
  /** FFT_SIZE/2 linear magnitudes (Hann-windowed, normalized so a full-scale sine ≈ 1). */
  mag: Float32Array;
  /** Mono waveform, WAVEFORM_SIZE samples. */
  wave: Float32Array;
  left: Float32Array;
  right: Float32Array;
  /** Half-wave rectified log-magnitude flux per onset band from the short FFT. */
  fluxKick: number;
  fluxSnare: number;
  fluxHat: number;
  fluxAll: number;
  rms: number;
  peak: number;
  /** Momentary loudness (LUFS). */
  lufs: number;
  rmsL: number;
  rmsR: number;
  /** Inter-channel correlation for this hop. */
  corr: number;
  /** Side/mid energy ratio. */
  sideRatio: number;
  /** Linear gain the worklet applied (manual × auto). */
  appliedGain: number;
  /** Input level before auto-gain (dBFS, mono mean square over the hop). */
  inputDb: number;
}

/** Tempo clock state. Consumers extrapolate beat = anchorBeat + (t - anchorTime) * bpm / 60. */
export interface TempoState {
  bpm: number;
  anchorTime: number;
  anchorBeat: number;
  confidence: number;
  source: TempoSourceKind;
  beatsPerBar: number;
  beatsPerPhrase: number;
  /** Beat index (mod beatsPerBar) treated as the downbeat. */
  downbeatOffset: number;
  /** Phrase start beat offset (mod beatsPerPhrase). */
  phraseOffset: number;
}

/** Fully analysed packet the worker broadcasts to every consumer at hop rate. */
export interface AnalysisPacket {
  type: 'analysis';
  t: number;
  fft: Float32Array;
  bands: Float32Array; // 7, in BAND_NAMES order
  bands32: Float32Array;
  wave: Float32Array;
  left: Float32Array;
  right: Float32Array;
  rms: number;
  peak: number;
  lufs: number;
  energy: number;
  energyTrend: EnergyTrend;
  kick: boolean;
  snare: boolean;
  hat: boolean;
  any: boolean;
  /** Onset detection values (for the HUD), 0..1-ish. */
  odfKick: number;
  odfSnare: number;
  odfHat: number;
  brightness: number;
  flux: number;
  drop: boolean;
  silence: boolean;
  width: number;
  phase: number;
  balance: number;
  inputLevelDb: number;
  appliedGain: number;
  /** Effective visual delay in ms (user offset + automatic output-latency compensation). */
  latencyMs: number;
  tempo: TempoState;
  /** Clock sync: audio-context time ↔ epoch ms, so other windows can extrapolate. */
  clock: ClockSync;
}

export interface ClockSync {
  ctxTime: number;
  epochMs: number;
}

/** Messages a consumer may receive on its analysis port. */
export type ConsumerMessage = AnalysisPacket | { type: 'tempo'; tempo: TempoState; clock: ClockSync };
